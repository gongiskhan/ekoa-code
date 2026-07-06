// backend/index.js — Jurídico · Agenda (Layer 2).
//
// Server-side code owned by the Agenda artifact. Two exported handlers, both
// invoked by the Ekoa event-sourcing layer with (input, ekoa):
//
//   onWebhook   — the PAYMENT CALLBACK target. In production a trigger
//                 (integrationKey 'ifthenpay' | 'stripe', a GET/POST callback,
//                 target = this artifact's backend, entrypoint 'onWebhook')
//                 delivers the provider's callback here. The provider's query
//                 params carry the reference + amount; we confirm the matching
//                 reserva — RE-CHECKING the slot first so a double-booking is
//                 refused, never silently confirmed twice.
//   expireHolds — a cheap maintenance sweep that marks stale holds 'expirada'.
//                 Also run at the top of every onWebhook (any invocation heals
//                 drift), so a separate schedule is optional.
//
// This handler is THIN. Every decision — which reserva, confirm vs cancel, the
// evento/credito payloads, which holds expired — is the pure engine's, the SAME
// single source of truth the frontend runs (ekoa-data/legal-engines/agenda.mjs,
// vendored). The handler only binds the engine to the owner-SHARED spine via the
// injected `ekoa` handle (it holds no credentials) and surfaces the outcome.
import {
  decidirConfirmacao,
  construirEventoDeReserva,
  construirCreditoDeReserva,
  construirAgendaPublica,
  holdsExpirados,
} from '../frontend/src/engine/agenda.mjs';

// The suite's shared bell feed (read by the NotificationsBell across the pack).
const BELL = 'notificacoes';

/* Extracts { ref, orderId, valor } from a provider callback, defensively — the
 * Ifthenpay GET callback dispatches its query params as the payload; other
 * providers nest them under payload/body. We read the common spellings. */
function lerCallback(input) {
  const src = (input && (input.payload || input.query || input.body)) || input || {};
  const ref = src.referencia ?? src.reference ?? src.ref ?? src.requestId ?? null;
  const orderId = src.orderId ?? src.order_id ?? src.id ?? null;
  const valorRaw = src.valor ?? src.amount ?? null;
  const valor = valorRaw == null ? null : Number(valorRaw);
  return { ref, orderId, valor: Number.isFinite(valor) ? valor : null };
}

/* Marks every stale hold 'expirada'. Shared by expireHolds and onWebhook. */
async function varrerHoldsExpirados(ekoa, agora, { excetoId } = {}) {
  const shared = ekoa.appData.shared;
  let reservas = [];
  try { reservas = await shared.list('reservas'); } catch { return { expiradas: 0 }; }
  // A varredura corre DEPOIS da decisão do callback e nunca toca na reserva
  // que está a ser paga: um pagamento que chega após o expiraEm confirma-se
  // na mesma se o horário continuar livre (a decisão é do motor).
  const ids = holdsExpirados(reservas, agora).filter((id) => id !== excetoId);
  let expiradas = 0;
  for (const id of ids) {
    try { await shared.update('reservas', id, { estado: 'expirada' }); expiradas += 1; } catch { /* não fatal */ }
  }
  if (expiradas > 0) ekoa.info('Holds expirados varridos', { expiradas });
  return { expiradas };
}

export async function expireHolds(input, ekoa) {
  const agora = new Date().toISOString();
  const resultado = await varrerHoldsExpirados(ekoa, agora);
  await refrescarAgendaPublica(ekoa, agora);
  return resultado;
}

export async function onWebhook(input, ekoa) {
  const shared = ekoa.appData.shared;
  const agora = new Date().toISOString();

  const { ref, orderId, valor } = lerCallback(input);
  if (ref == null && orderId == null) {
    ekoa.warn('Callback de pagamento sem referência nem orderId — ignorado');
    return { skipped: 'no-ref' };
  }

  const reservas = await shared.list('reservas');
  const decisao = decidirConfirmacao({ reservas, ref, orderId });

  if (!decisao.encontrada || decisao.decisao === 'ignorar') {
    ekoa.info('Callback sem acção', { ref, orderId, motivo: decisao.motivo });
    await varrerHoldsExpirados(ekoa, agora, { excetoId: decisao.reservaId });
    await refrescarAgendaPublica(ekoa, agora);
    return { status: 'ignored', motivo: decisao.motivo };
  }

  const reserva = reservas.find((r) => r && r.id === decisao.reservaId) || null;

  // Double-booking guard: the slot was taken between hold and payment.
  if (decisao.decisao === 'cancelar_sobreposicao') {
    try { await shared.update('reservas', decisao.reservaId, { estado: 'cancelada', motivoCancelamento: decisao.motivo }); } catch { /* não fatal */ }
    await surgirNoSino(shared, {
      titulo: 'Reserva cancelada — horário já ocupado',
      corpo: `A marcação de ${reserva && reserva.nome ? reserva.nome : 'um cliente'} não pôde ser confirmada: o horário foi entretanto ocupado.`,
    });
    await ekoa.notify.inApp('Reserva cancelada', 'O horário foi ocupado antes da confirmação do pagamento.', { source: 'agenda', reservaId: decisao.reservaId });
    await varrerHoldsExpirados(ekoa, agora, { excetoId: decisao.reservaId });
    await refrescarAgendaPublica(ekoa, agora);
    return { status: 'cancelled_overlap', reservaId: decisao.reservaId };
  }

  // Confirmar: usa o valor do callback quando presente, senão o da reserva.
  const reservaValor = reserva && reserva.pagamento && Number(reserva.pagamento.valor);
  const valorFinal = valor != null ? valor : (Number.isFinite(reservaValor) ? reservaValor : null);
  const pagamentoRef = (reserva && reserva.pagamento && reserva.pagamento.ref) || ref || null;

  await shared.update('reservas', decisao.reservaId, { estado: 'confirmada', confirmadaEm: agora });

  // Cria o evento de agenda (mesma linha que a simulação de dev escreve).
  let sessaoTipo = null;
  try { sessaoTipo = reserva && reserva.sessaoTipoId ? await shared.get('sessao_tipos', reserva.sessaoTipoId) : null; } catch { sessaoTipo = null; }
  let eventoId = null;
  try {
    const evento = await shared.create('eventos', construirEventoDeReserva(reserva, sessaoTipo));
    eventoId = evento && evento.id;
    if (eventoId) { try { await shared.update('reservas', decisao.reservaId, { eventoId }); } catch { /* não fatal */ } }
  } catch (e) {
    ekoa.warn('Falha ao criar o evento da reserva confirmada', { error: String(e && e.message ? e.message : e) });
  }

  // Crédito na conta corrente quando há valor pago - com o cliente RESOLVIDO
  // (reserva.clienteId ou correspondência por email), para que o movimento
  // apareça na conta corrente das Finanças.
  let clienteIdResolvido = (reserva && reserva.clienteId) || null;
  if (!clienteIdResolvido && reserva && reserva.email) {
    try {
      const clientes = await shared.list('clientes');
      const emailNorm = String(reserva.email).trim().toLowerCase();
      const hit = (Array.isArray(clientes) ? clientes : []).find(
        (c) => c && c.email && String(c.email).trim().toLowerCase() === emailNorm,
      );
      if (hit) clienteIdResolvido = hit.id;
    } catch { /* não fatal */ }
  }
  const credito = construirCreditoDeReserva(
    { ...reserva, pagamento: { ...(reserva && reserva.pagamento), ref: pagamentoRef, valor: valorFinal } },
    { clienteId: clienteIdResolvido },
  );
  if (credito) {
    try { await shared.create('conta_corrente', credito); } catch (e) { ekoa.warn('Falha ao registar o crédito do pagamento', { error: String(e && e.message ? e.message : e) }); }
  }

  await surgirNoSino(shared, {
    titulo: 'Reserva confirmada',
    corpo: `${reserva && reserva.nome ? reserva.nome : 'Um cliente'} confirmou o pagamento e a marcação${sessaoTipo && sessaoTipo.nome ? ` de ${sessaoTipo.nome}` : ''}.`,
  });
  await ekoa.notify.inApp('Reserva confirmada', 'Pagamento confirmado; a marcação entrou na agenda.', {
    source: 'agenda', reservaId: decisao.reservaId, eventoId,
  });

  await varrerHoldsExpirados(ekoa, agora, { excetoId: decisao.reservaId });
  await refrescarAgendaPublica(ekoa, agora);
  return { status: 'confirmed', reservaId: decisao.reservaId, eventoId };
}

/*
 * Reconstrói a colecção SANEADA `agenda_publica` (apenas {sessaoTipoId, inicio,
 * fim} dos horários livres dos tipos públicos, 14 dias) - a ÚNICA fonte que a
 * página pública de reservas lê. Os dados privados (reservas de terceiros,
 * eventos, disponibilidades, ausências) nunca saem do lado servidor/equipa.
 */
async function refrescarAgendaPublica(ekoa, agora) {
  const shared = ekoa.appData.shared;
  try {
    const [sessaoTipos, disponibilidades, eventos, ausencias, reservas, atuais] = await Promise.all([
      shared.list('sessao_tipos'), shared.list('disponibilidades'), shared.list('eventos'),
      shared.list('ausencias'), shared.list('reservas'), shared.list('agenda_publica'),
    ]);
    const deDate = String(agora).slice(0, 10);
    const ate = new Date(agora); ate.setDate(ate.getDate() + 14);
    const ateDate = ate.toISOString().slice(0, 10);
    const linhas = construirAgendaPublica({ sessaoTipos, disponibilidades, eventos, ausencias, reservas, deDate, ateDate, agora });
    const chave = (l) => `${l.sessaoTipoId}|${l.inicio}|${l.fim}`;
    const desejadas = new Set(linhas.map(chave));
    const existentes = new Map((Array.isArray(atuais) ? atuais : []).map((l) => [chave(l), l]));
    for (const [k, row] of existentes) {
      if (!desejadas.has(k)) { try { await shared.delete('agenda_publica', row.id); } catch { /* não fatal */ } }
    }
    for (const linha of linhas) {
      if (!existentes.has(chave(linha))) { try { await shared.create('agenda_publica', linha); } catch { /* não fatal */ } }
    }
  } catch (e) {
    ekoa.warn('Falha ao refrescar a agenda pública', { error: String(e && e.message ? e.message : e) });
  }
}

/* Escreve uma linha na campainha partilhada (não fatal em erro). */
async function surgirNoSino(shared, { titulo, corpo }) {
  try {
    await shared.create(BELL, {
      tipo: 'agenda',
      titulo,
      corpo,
      href: '/apps/legal-agenda/',
      lida: false,
      data: new Date().toISOString(),
    });
  } catch { /* não fatal */ }
}
