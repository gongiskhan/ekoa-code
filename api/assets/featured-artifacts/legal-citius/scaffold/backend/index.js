// backend/index.js — Jurídico · Caixa Citius (Layer 2).
//
// Invoked by the Ekoa event-sourcing layer for each new email in the connected
// mailbox. The trigger (integrationKey 'microsoft-365' | 'google-workspace' |
// 'imap', event 'email.received', target = this artifact's backend, entrypoint
// 'onEmail') watches the inbox; for every new message core hydrates a normalized
// EmailInput and calls onEmail.
//
// onEmail turns a Citius notification email into prazos + eventos + a
// needs-review inbox row via the DETERMINISTIC engines — the SAME single source
// of truth the frontend "colar" test box runs. It writes ONLY through the
// injected, capability-scoped `ekoa` handle; it holds no credentials and reaches
// data solely via the owner-SHARED spine (`ekoa.appData.shared.*`), which the
// whole legal pack shares.
//
//   input : { id, mailbox, from:{address,name?}, subject, body, bodyContentType, receivedAt, webLink? }
//   ekoa  : { appData:{...,shared:{list,get,create,update,delete}}, llm, notify:{inApp,email}, info/warn/error }
//
// The engine owns the logic (parse -> match the processo on the spine -> compute
// the prazo -> write). This handler is thin: gate non-Citius mail out, bind the
// data API to the shared spine, run the engine, then surface the outcome.
import { processarNotificacao } from '../frontend/src/engine/citius-process.mjs';
import { classifyCitius } from '../frontend/src/engine/citius-detect.mjs';

// The suite's own bell feed (read by the NotificationsBell across the pack).
const BELL = 'notificacoes';

export async function onEmail(input, ekoa) {
  // Conservative gate: only genuine Citius notifications reach the engine. A
  // client email or newsletter must NEVER become a prazo. `classifyCitius` also
  // tells us HOW we recognised it: 'sender' (authoritative @citius.mj.pt) is
  // trusted for automation; 'text' (content markers only) is forgeable, so we
  // force human review before any prazo is created.
  const { match, provenance } = classifyCitius(input);
  if (!match) {
    ekoa.info('Email não-Citius — ignorado', { subject: input && input.subject });
    return { skipped: 'not-citius' };
  }

  // The engine's injected dataApi ({ list, create, update }) matches the shared
  // handle's signatures exactly, so the shared spine IS the data API — one code
  // path, frontend and backend.
  const dataApi = ekoa.appData.shared;

  // Pass the raw body: the parser strips HTML defensively (hidden blocks, tags)
  // so it is robust whether the provider gave us text or html. `forceReview` on
  // an unauthenticated (text-only) origin routes even a full match to needs-review.
  const raw = String((input && input.body) || '');
  const r = await processarNotificacao(raw, dataApi, {
    sourceRef: input && input.id,
    forceReview: provenance === 'text',
  });

  // Do not re-notify for a message we've already SURFACED. `duplicate`/`reused`
  // alone não chegam: se a PRIMEIRA entrega falhou a alertar (campainha em erro,
  // evento re-tentado), a reentrega tem de voltar a tentar. O carimbo
  // `alertedAt` na própria linha needs-review é a prova durável de que o alerta
  // chegou a ser escrito - só então suprimimos.
  if (r && (r.duplicate || r.reused)) {
    let alerted = !!r.duplicate; // um prazo criado já alertou no run que o criou
    if (!alerted && r.notificacaoId) {
      try {
        const row = await dataApi.get('citius_notificacoes', r.notificacaoId);
        alerted = !!(row && row.alertedAt);
      } catch { alerted = false; }
    }
    if (alerted) {
      ekoa.info('Notificação Citius já vista - sem nova notificação', {
        notificacaoId: r && r.notificacaoId,
        duplicate: !!(r && r.duplicate),
        reused: !!(r && r.reused),
      });
      return r;
    }
    // reused mas nunca alertada: cai para o bloco de notificação abaixo.
  }

  // Surface the outcome two ways: the platform in-app toast, AND a persisted row
  // in the suite's shared bell feed. matched -> a prazo was registered; anything
  // else -> the notification needs a human to review it in the Caixa Citius.
  const matched = r && r.status === 'matched';
  const titulo = matched ? 'Prazo Citius registado' : 'Notificação Citius para rever';
  const corpo = matched
    ? `Data-limite ${r.dataLimite}. Prazo criado automaticamente a partir de uma notificação Citius.`
    : `Notificação recebida${r && r.motivo ? ` — ${r.motivo}` : ''}. Rever na Caixa Citius.`;
  const href = matched ? '/apps/legal-prazos/' : '/apps/legal-citius/';

  try {
    await dataApi.create(BELL, {
      tipo: 'citius',
      titulo,
      corpo,
      processoId: (r && r.processoId) || null,
      href,
      lida: false,
      data: new Date().toISOString(),
    });
    // Alerta durável escrito: carimba a linha needs-review para que uma
    // reentrega futura não volte a notificar. (Campo adicional; o motor
    // ignora chaves desconhecidas.)
    if (r && r.notificacaoId && r.status !== 'matched') {
      try {
        await dataApi.update('citius_notificacoes', r.notificacaoId, { alertedAt: new Date().toISOString() });
      } catch { /* sem carimbo -> a reentrega tenta alertar de novo (seguro) */ }
    }
  } catch (e) {
    ekoa.warn('Falha ao escrever a notificação na campainha', {
      error: String(e && e.message ? e.message : e),
    });
  }

  await ekoa.notify.inApp(titulo, corpo, {
    source: 'citius',
    notificacaoId: r && r.notificacaoId,
    prazoId: r && r.prazoId,
    processoId: r && r.processoId,
    href,
  });

  return r;
}
