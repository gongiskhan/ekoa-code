/*
 * Confirmação de triagem - a MESMA sequência de escritas para a confirmação
 * individual (NotificacaoPage) e para a confirmação em lote (caixa de entrada).
 * Extraída de NotificacaoPage.onConfirmar sem alterar os payloads: prazo,
 * evento, update da notificação e sino são exactamente o que a confirmação
 * individual sempre escreveu - incluindo o contrato 'matched' + prazoId que
 * bloqueia reentregas no intake automático (citius-process.mjs).
 */
import { getShared, createShared, updateShared, notify, appHref } from '../shared.js';
import { computePrazo } from '../engine/prazo.mjs';
import { isNeedsReview, regraForAto, isValidDateStr } from './triage.js';

/**
 * Confirma uma notificação em revisão: cria prazo + evento, marca a linha como
 * 'matched' e escreve no sino. Idempotente entre abas/sessões: relê a linha
 * ANTES de escrever; se já não está em revisão devolve { status: 'ja-tratada' }
 * sem duplicar nada.
 */
export async function confirmarTriagem({ notifId, processoId, ato, dataActo, numeroProcesso }) {
  const regra = regraForAto(ato);
  if (!regra) throw new Error(`ato sem regra de prazo automática: ${String(ato)}`);
  if (!isValidDateStr(dataActo)) throw new Error('data do acto inválida - nunca a adivinhamos');
  if (!processoId) throw new Error('processo por associar');

  const current = await getShared('citius_notificacoes', notifId);
  if (!current || current.estado !== 'needs-review') {
    return { status: 'ja-tratada', notif: current || null };
  }

  const r = computePrazo({ dataNotificacao: dataActo, dias: regra.dias, contagem: regra.contagem });
  const prazo = await createShared('prazos', {
    processoId,
    titulo: ato,
    descricao: ato,
    dataNotificacao: dataActo,
    regraAplicada: `${ato} - ${regra.dias} dias ${regra.contagem}`,
    dataLimite: r.dataLimite,
    multaAte: r.multaAte,
    tipoContagem: regra.contagem,
    estado: 'pendente',
    origem: 'citius',
    showWork: { passos: r.passos, multaDias: r.multaDias },
    metadata: { notificacaoId: notifId },
  });
  await createShared('eventos', {
    processoId,
    tipo: 'citius-notificacao',
    titulo: `Notificação Citius: ${ato}`,
    descricao: `Prazo confirmado na triagem (data-limite ${r.dataLimite}).`,
    data: dataActo,
    origem: 'citius',
    metadata: { prazoId: prazo.id, notificacaoId: notifId },
  });
  await updateShared('citius_notificacoes', notifId, {
    // 'matched' + prazoId é o CONTRATO do motor (citius-process.mjs): só esse
    // par bloqueia a reentrega do mesmo email no intake automático.
    estado: 'matched',
    processoId,
    // Reconcilia o número com o processo efectivamente associado.
    numeroProcesso: numeroProcesso || current.numeroProcesso,
    ato,
    dataActo,
    prazoId: prazo.id,
    prazoIds: [prazo.id],
    dataLimite: r.dataLimite,
    motivo: null,
  });
  await notify({
    tipo: 'citius',
    titulo: 'Prazo confirmado a partir do Citius',
    corpo: `${ato} - data-limite ${r.dataLimite} (${numeroProcesso}).`,
    processoId,
    href: appHref('legal-citius', `notificacao/${notifId}`),
  });
  const fresh = await getShared('citius_notificacoes', notifId);
  return {
    status: 'confirmada',
    prazoId: prazo.id,
    dataLimite: r.dataLimite,
    notif: fresh || { ...current, estado: 'matched', prazoId: prazo.id, prazoIds: [prazo.id], dataLimite: r.dataLimite },
  };
}

/**
 * Proposta automática para a confirmação em lote - a regra de ouro da triagem
 * aplicada sem UI: só devolve algo quando o processo está inequivocamente
 * emparelhado na espinha, o ato tem regra automática E a data do acto é
 * válida. Qualquer lacuna devolve null - a notificação fica para revisão
 * individual, nunca se confirma um prazo adivinhado.
 */
export function propostaAutomatica(notif, processos) {
  if (!isNeedsReview(notif)) return null;
  if (!regraForAto(notif.ato)) return null;
  if (!isValidDateStr(notif.dataActo)) return null;
  let pid = notif.processoId || '';
  if (!pid && notif.numeroProcesso) {
    const match = (processos || []).find((p) => (p.numeroProcesso || '').trim() === notif.numeroProcesso);
    if (match) pid = match.id;
  }
  if (!pid) return null;
  const processo = (processos || []).find((p) => p.id === pid);
  if (!processo) return null;
  return {
    notifId: notif.id,
    processoId: pid,
    ato: notif.ato,
    dataActo: notif.dataActo,
    numeroProcesso: processo.numeroProcesso || notif.numeroProcesso,
  };
}

/**
 * Origem de uma linha da caixa, derivada dos refs do motor: o fluxo "colar"
 * não passa sourceRef, pelo que o motor usa o hash do conteúdo (sourceRef ===
 * contentRef); a intake de email passa o id da mensagem (refs diferentes).
 * Linhas antigas sem refs devolvem null - mostrar honestamente "desconhecida".
 */
export function origemNotif(n) {
  if (!n || !n.sourceRef || !n.contentRef) return null;
  return n.sourceRef === n.contentRef ? 'colada' : 'email';
}
