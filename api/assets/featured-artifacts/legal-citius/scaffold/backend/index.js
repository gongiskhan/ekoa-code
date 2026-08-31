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
import { processarNotificacao, processarNotificacaoEstruturada } from '../frontend/src/engine/citius-process.mjs';
import { classifyCitius } from '../frontend/src/engine/citius-detect.mjs';
import { ATOS } from '../frontend/src/engine/citius-parser.mjs';
import { computePrazo } from '../frontend/src/engine/prazo.mjs';

// The suite's own bell feed (read by the NotificationsBell across the pack).
const BELL = 'notificacoes';
// The needs-review inbox itself (the engine's own collection name).
const NOTIFS = 'citius_notificacoes';

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
        const row = await dataApi.get(NOTIFS, r.notificacaoId);
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

  await alertar(r, dataApi, ekoa);
  return r;
}

/**
 * Tell the lawyer, the two durable ways, whatever the intake was.
 *
 * Shared by both handlers deliberately: the email path and the portal path must not be able to
 * describe the same outcome differently, and the alerted-stamp that suppresses a re-alert has to
 * be the SAME stamp or a notification seen by email would alert again when the portal poll finds it.
 */
async function alertar(r, dataApi, ekoa) {
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
        await dataApi.update(NOTIFS, r.notificacaoId, { alertedAt: new Date().toISOString() });
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
}

// ---------------------------------------------------------------------------------------------
// Layer 1 intake: the Portal dos Mandatarios listener.
// ---------------------------------------------------------------------------------------------

/**
 * A new notification observed on the CITIUS/eTribunal portal itself.
 *
 * Invoked by the event-sourcing layer for each NEW row the `citius` integration's listener sees
 * (`listenerConfig.pollAction = consultar_notificacoes`, event `notificacao.recebida`), one call
 * per notification, deduped upstream by the queue's UNIQUE(triggerId, dedupKey) on the
 * notification's own portal id.
 *
 *   input : { event: <a notification row from the portal>, trigger: { id, eventName } }
 *   ekoa  : the same capability-scoped handle onEmail gets.
 *
 * WHY THIS EXISTS BESIDE onEmail, and which one is authoritative. The court also sends an email,
 * and that email arrives first: it is the LOW-LATENCY ALERT. The portal is the FETCHER OF RECORD -
 * it is the court's own list, it cannot be forged by anyone who can send mail, and it carries the
 * prazo the court itself states. So a notification seen here is trusted for automation
 * (`provenance: 'portal'`), where a text-only email match never is. Both paths land in the SAME
 * triage engine and dedupe against each other through `sourceRef`, so whichever arrives second
 * updates the row rather than creating a twin.
 *
 * THE PORTAL'S OWN PRAZO IS CHECKED, NOT ADOPTED, AND NOT IGNORED. When the portal states a
 * data-limite and our rule table computes a different one, that disagreement is the single most
 * important thing a lawyer could be shown, and it must never be resolved by a machine picking a
 * winner. It goes to review with both dates named. When the portal states nothing, the rule table
 * answers alone, exactly as it does for email.
 */
export async function onNotificacaoCitius(input, ekoa) {
  const n = (input && input.event) || {};
  const numeroProcesso = texto(n.processo || n.numeroProcesso);
  const ato = texto(n.ato || n.acto || n.tipoActo || n.tipo);
  const dataActo = texto(n.data || n.dataNotificacao);
  const id = texto(n.id || n.referencia);

  if (!numeroProcesso || !ato) {
    // Never a silent drop: a row we cannot even name is one a human has to look at.
    ekoa.warn('Notificacao do portal sem processo ou sem acto - enviada para revisao', { id });
  }

  // The rule table is the engine's, reached through the same parser the email path uses, so the two
  // intakes can never drift onto different definitions of "Contestacao, 30 dias uteis".
  const regra = regraDoActo(ato);

  // The `parsed` shape the triage engine expects. `textoCompleto` is the fingerprint the engine
  // dedupes on, so it is built from the fields that IDENTIFY the notification and nothing else -
  // including the portal id, which makes a re-poll of the same row collide with itself, and
  // excluding anything that could differ between two views of one notification.
  const linha = `${numeroProcesso} | ${dataActo} | ${ato}`;
  const parsed = {
    numeroProcesso: numeroProcesso || null,
    ato: ato || null,
    regra,
    dataExplicita: dataActo || null,
    dataConflito: false,
    ok: Boolean(numeroProcesso && ato),
    motivo: !numeroProcesso ? 'processo nao identificado' : !ato ? 'ato nao reconhecido' : null,
    texto: linha.slice(0, 500),
    textoCompleto: `${id} | ${linha}`,
  };

  const dataApi = ekoa.appData.shared;
  const declarada = texto(n.dataLimite);

  // THE DISAGREEMENT CHECK, made BEFORE the engine runs, because the engine's job is to compute and
  // this is a question about whether computing is safe at all. Only asked when we have both answers.
  let r;
  if (declarada && parsed.ok && regra && regra.dias != null && dataActo) {
    const nosso = computePrazo({ dataNotificacao: dataActo, dias: regra.dias, contagem: regra.contagem });
    if (nosso.dataLimite !== declarada) {
      // `forceReview` is the engine's existing "match the processo, do NOT create the prazo" route.
      r = await processarNotificacaoEstruturada(parsed, dataApi, { sourceRef: id || undefined, forceReview: true });
      if (r && r.notificacaoId) {
        try {
          await dataApi.update(NOTIFS, r.notificacaoId, {
            motivo: `prazo do portal (${declarada}) diferente do calculado (${nosso.dataLimite}) - confirme qual vale`,
            dataLimitePortal: declarada,
            dataLimiteCalculada: nosso.dataLimite,
          });
        } catch { /* the row stands with the engine's own motivo; the alert below still fires */ }
      }
    }
  }
  if (!r) {
    r = await processarNotificacaoEstruturada(parsed, dataApi, { sourceRef: id || undefined });
  }

  await alertar(r, dataApi, ekoa);
  return r;
}

/** Trim to a string, treating null/undefined as absent. */
function texto(v) {
  return v == null ? '' : String(v).trim();
}

/** The prazo rule for an act name, from the engine's own table (never a second table here). */
function regraDoActo(ato) {
  if (!ato) return null;
  for (const a of ATOS) if (a.re.test(ato)) return a;
  return null;
}
