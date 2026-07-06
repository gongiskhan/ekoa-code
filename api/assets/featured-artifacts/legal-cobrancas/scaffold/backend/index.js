// backend/index.js — Jurídico · Cobranças (Layer 2).
//
// Server-side code owned by the Cobranças artifact. One exported handler,
// invoked by the Ekoa event-sourcing layer with (input, ekoa):
//
//   onWebhook — the PAYMENT CALLBACK target and the REAL reconciliation point.
//               In production a trigger (integrationKey 'ifthenpay' | 'stripe',
//               a GET/POST callback, target = this artifact's backend,
//               entrypoint 'onWebhook') delivers the provider's callback here.
//               The Ifthenpay GET callback dispatches its query params
//               (chave/referencia/valor/datahorapag) as the payload; we find the
//               cobrança by refPagamento.referencia (spaces normalised), confirm
//               the amount, mark it 'paga' (or 'parcial'), and WRITE the credit
//               into the shared conta_corrente — a paid cobrança WITHOUT its
//               conta_corrente entry is a reconciliation failure (§3.3).
//
// This handler is THIN. Every decision — matched or not, paga vs parcial, the
// credito payload, idempotency — is the pure engine's, the SAME single source of
// truth the frontend dev-sim runs (engine/cobrancas.mjs, vendored). The handler
// only binds the engine to the owner-SHARED spine via the injected `ekoa` handle
// (it holds no credentials) and surfaces the outcome. Idempotent: the engine
// never issues a second credit for a referencia already reconciled.
import { reconcileCobranca, normalizarRef } from '../frontend/src/engine/cobrancas.mjs';

// The suite's shared bell feed (read by the NotificationsBell across the pack).
const BELL = 'notificacoes';

/* Extracts { referencia, valor } from a provider callback, defensively. The
 * Ifthenpay GET callback dispatches its query params as the payload; other
 * providers nest them under payload/body. We read the common spellings. */
function lerCallback(input) {
  const src = (input && (input.payload || input.query || input.body)) || input || {};
  const referencia = src.referencia ?? src.reference ?? src.ref ?? null;
  const valorRaw = src.valor ?? src.amount ?? null;
  const valor = valorRaw == null ? null : Number(valorRaw);
  const dataHoraPag = src.datahorapag ?? src.dataHoraPag ?? src.datahora ?? null;
  return { referencia, valor: Number.isFinite(valor) ? valor : null, dataHoraPag };
}

export async function onWebhook(input, ekoa) {
  const shared = ekoa.appData.shared;
  const agora = new Date().toISOString();

  const { referencia, valor, dataHoraPag } = lerCallback(input);
  if (referencia == null || normalizarRef(referencia) === '') {
    ekoa.warn('Callback de pagamento sem referência — ignorado');
    return { skipped: 'no-ref' };
  }

  let cobrancas = [];
  try { cobrancas = await shared.list('cobrancas'); } catch { cobrancas = []; }
  const refNorm = normalizarRef(referencia);
  const cobranca = cobrancas.find(
    (c) => c && c.refPagamento && normalizarRef(c.refPagamento.referencia) === refNorm,
  ) || null;

  if (!cobranca) {
    ekoa.info('Callback sem cobrança correspondente', { referencia });
    return { status: 'ignored', motivo: 'sem-cobranca' };
  }

  let contaCorrente = [];
  try { contaCorrente = await shared.list('conta_corrente'); } catch { contaCorrente = []; }

  const plan = reconcileCobranca({ cobranca, referencia, valor, dataHoraPag, contaCorrente, agora });
  if (!plan.matched) {
    ekoa.info('Callback sem acção', { referencia, motivo: plan.motivo });
    return { status: 'ignored', motivo: plan.motivo };
  }

  // Idempotente: já reconciliado, mesmo estado e crédito — no-op.
  if (plan.alreadyReconciled && !plan.credito && !plan.atualizarEstado) {
    ekoa.info('Callback já reconciliado — idempotente', { referencia, cobrancaId: cobranca.id });
    return { status: 'already', cobrancaId: cobranca.id, estado: plan.estado };
  }

  if (plan.atualizarEstado) {
    try { await shared.update('cobrancas', cobranca.id, { estado: plan.estado, pagoEm: agora }); }
    catch (e) { ekoa.warn('Falha ao atualizar o estado da cobrança', { error: String(e && e.message ? e.message : e) }); }
  }

  // RECONCILIAÇÃO (§3.3): o crédito na conta corrente é obrigatório num pagamento.
  if (plan.credito) {
    try { await shared.create('conta_corrente', plan.credito); }
    catch (e) { ekoa.warn('Falha ao registar o crédito do pagamento', { error: String(e && e.message ? e.message : e) }); }
  }

  await surgirNoSino(shared, {
    titulo: plan.estado === 'parcial' ? 'Pagamento parcial recebido' : 'Pagamento recebido',
    corpo: `A cobrança ${cobranca.descricao || ''} foi ${plan.estado === 'parcial' ? 'parcialmente ' : ''}paga e reconciliada na conta corrente.`,
  });
  try {
    await ekoa.notify.inApp(
      plan.estado === 'parcial' ? 'Pagamento parcial' : 'Pagamento recebido',
      `A cobrança ${cobranca.descricao || ''} foi reconciliada na conta corrente do cliente.`,
      { source: 'cobrancas', cobrancaId: cobranca.id, estado: plan.estado },
    );
  } catch { /* não fatal */ }

  return { status: plan.estado, cobrancaId: cobranca.id };
}

/* Escreve uma linha na campainha partilhada (não fatal em erro). */
async function surgirNoSino(shared, { titulo, corpo }) {
  try {
    await shared.create(BELL, {
      tipo: 'cobrancas',
      titulo,
      corpo,
      href: '/apps/legal-cobrancas/',
      lida: false,
      data: new Date().toISOString(),
    });
  } catch { /* não fatal */ }
}
