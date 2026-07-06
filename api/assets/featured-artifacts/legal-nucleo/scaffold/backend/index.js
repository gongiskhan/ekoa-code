// backend/index.js — Jurídico · Núcleo (Layer 2) — captura de comunicações.
//
// Invoked by the Ekoa event-sourcing layer for each new inbound communication in
// a connected channel. Two entrypoints, one per source:
//
//   onEmail   — a new email in the connected mailbox (M365 / Gmail); trigger
//               event 'email.received', target = this backend, entrypoint 'onEmail'.
//   onMessage — a new WhatsApp Business message; trigger event 'whatsapp.message',
//               target = this backend, entrypoint 'onMessage'.
//
// Both capture the communication into the owner-SHARED spine collection
// `comunicacoes` — the single feed the Dossiê's "Comunicações" tab (and the
// cliente detail view) read. Capture is CONSERVATIVE: a message is only
// auto-linked to a cliente when the evidence is unambiguous (email equality, or a
// unique phone match). Anything else lands as `por-associar` for a human to
// triage — we never guess among multiple candidates and never auto-link a
// processo (v1 contract: association to a processo is always a manual decision in
// the Dossiê).
//
// The handler holds NO credentials and reaches data solely through the injected,
// capability-scoped `ekoa` handle (`ekoa.appData.shared.*`, owner-scoped, shared
// by the whole legal pack). It is idempotent by message id: dispatch retries
// re-deliver the same message, so a row whose `sourceRef` already exists is a
// no-op.
//
//   onEmail   input : EmailInput   { id, from:{address,name?}, subject, body, bodyContentType, receivedAt, webLink? }
//   onMessage input : MessageInput { channel:'whatsapp', id, from, name?, text, media?, timestamp, phoneNumberId, raw }
//   ekoa            : { appData:{...,shared:{list,get,create,update,delete}}, llm, notify:{inApp,email}, info/warn/error }
import { isCitiusNotification } from '../frontend/src/engine/citius-detect.mjs';

/** The shared spine collection the Dossiê / cliente views read. */
const COMUNICACOES = 'comunicacoes';
/** The suite's own bell feed (read by the NotificationsBell across the pack). */
const BELL = 'notificacoes';

// ---------------------------------------------------------------------------
// onEmail — capture a client email into `comunicacoes`.
// ---------------------------------------------------------------------------
export async function onEmail(input, ekoa) {
  const i = input && typeof input === 'object' ? input : null;

  // Citius notifications are owned by the legal-citius backend (which turns them
  // into prazos/eventos). Capturing them here too would double-record them, so
  // gate them out FIRST. The detector is conservative and total (never throws),
  // but guard defensively regardless.
  try {
    if (i && isCitiusNotification(i)) {
      ekoa.info('Email Citius — ignorado (capturado pelo backend legal-citius)', { subject: i && i.subject });
      return { skipped: 'citius' };
    }
  } catch (e) {
    ekoa.warn('isCitiusNotification lançou — a continuar como email normal', { error: errMsg(e) });
  }

  // A capture needs a sender (the match key) and a stable id (the dedup key).
  const from = i && i.from && typeof i.from === 'object' ? i.from : null;
  const fromAddr = from && from.address != null ? String(from.address).trim() : '';
  const sourceRef = i && i.id != null ? String(i.id) : '';
  if (!i || !fromAddr || !sourceRef) {
    ekoa.warn('onEmail: input malformado — ignorado', { hasFrom: Boolean(fromAddr), hasId: Boolean(sourceRef) });
    return { skipped: 'malformed' };
  }

  const dataApi = ekoa.appData.shared;

  // Idempotency: a re-delivery of a message we already captured is a no-op.
  if (await sourceRefSeen(dataApi, sourceRef)) {
    ekoa.info('Email já capturado — ignorado', { sourceRef });
    return { skipped: 'duplicate' };
  }

  // Match by exact, case-insensitive email equality against the clientes spine.
  // No fuzzy matching, no processo auto-link.
  const clientes = await listSafe(dataApi, 'clientes');
  const key = normalizeEmail(fromAddr);
  const matched = key ? clientes.find((c) => c && normalizeEmail(c.email) === key) : undefined;

  // Body: plain text as-is; HTML stripped minimally so the timeline shows text.
  const rawBody = i.body == null ? '' : String(i.body);
  const body = i.bodyContentType === 'html' ? stripHtmlMinimal(rawBody) : rawBody;

  const row = {
    canal: 'email',
    direction: 'in',
    fromAddr,
    body,
    sourceRef,
    receivedAt: isoOrNow(i.receivedAt),
    status: matched ? 'associada' : 'por-associar',
  };
  if (from.name != null && String(from.name).trim()) row.fromName = String(from.name).trim();
  if (i.subject != null && String(i.subject)) row.subject = String(i.subject);
  if (i.webLink != null && String(i.webLink)) row.webLink = String(i.webLink);
  if (matched) {
    row.clienteId = matched.id;
    row.matchInfo = { rule: 'email', value: key, matchedAt: new Date().toISOString() };
  }

  const created = await dataApi.create(COMUNICACOES, row);

  // Noise control (brief decision): only surface por-associar rows. An auto-linked
  // message needs no attention, so it stays quiet.
  if (row.status === 'por-associar') {
    await notifyPorAssociar(ekoa, dataApi, 'email');
  }

  return { status: row.status, comunicacaoId: created && created.id, clienteId: matched ? matched.id : null };
}

// ---------------------------------------------------------------------------
// onMessage — capture a WhatsApp message into `comunicacoes`.
// ---------------------------------------------------------------------------
export async function onMessage(input, ekoa) {
  const i = input && typeof input === 'object' ? input : null;

  // A capture needs a sender phone, a stable id (dedup key), and a body.
  const fromRaw = i && i.from != null ? String(i.from).trim() : '';
  const sourceRef = i && i.id != null ? String(i.id) : '';
  const text = i && i.text != null ? String(i.text) : '';
  if (!i || !fromRaw || !sourceRef || !text) {
    ekoa.warn('onMessage: input malformado — ignorado', {
      hasFrom: Boolean(fromRaw), hasId: Boolean(sourceRef), hasText: Boolean(text),
    });
    return { skipped: 'malformed' };
  }

  const dataApi = ekoa.appData.shared;

  if (await sourceRefSeen(dataApi, sourceRef)) {
    ekoa.info('Mensagem já capturada — ignorada', { sourceRef });
    return { skipped: 'duplicate' };
  }

  // Match by phone: exact digits, or a UNIQUE last-9-digit (PT national number)
  // suffix. Zero or multiple candidates → por-associar (never guess).
  const clientes = await listSafe(dataApi, 'clientes');
  const inDigits = digitsOnly(fromRaw);
  const candidates = matchByPhone(clientes, inDigits);
  const matched = candidates.length === 1 ? candidates[0] : undefined;

  const row = {
    canal: 'whatsapp',
    direction: 'in',
    fromAddr: fromRaw,
    body: text,
    sourceRef,
    receivedAt: isoOrNow(i.timestamp),
    status: matched ? 'associada' : 'por-associar',
  };
  if (i.name != null && String(i.name).trim()) row.fromName = String(i.name).trim();
  const media = i.media && typeof i.media === 'object' ? i.media : null;
  if (media && media.id != null && String(media.id)) {
    row.mediaId = String(media.id);
    if (media.mimeType != null && String(media.mimeType)) row.mediaMime = String(media.mimeType);
  }
  if (matched) {
    row.clienteId = matched.id;
    row.matchInfo = { rule: 'phone', value: inDigits, matchedAt: new Date().toISOString() };
  }

  const created = await dataApi.create(COMUNICACOES, row);

  if (row.status === 'por-associar') {
    await notifyPorAssociar(ekoa, dataApi, 'whatsapp');
  }

  return { status: row.status, comunicacaoId: created && created.id, clienteId: matched ? matched.id : null };
}

// ---------------------------------------------------------------------------
// Helpers (small, dependency-free)
// ---------------------------------------------------------------------------

/** True when a communication with this sourceRef was already captured. */
async function sourceRefSeen(dataApi, sourceRef) {
  const rows = await listSafe(dataApi, COMUNICACOES);
  return rows.some((r) => r && r.sourceRef === sourceRef);
}

/** List a shared collection, degrading to [] on any read failure. */
async function listSafe(dataApi, collection) {
  try {
    const rows = await dataApi.list(collection);
    return Array.isArray(rows) ? rows : [];
  } catch (_e) {
    return [];
  }
}

/** Write the por-associar notification: a shared bell row AND the in-app toast. */
async function notifyPorAssociar(ekoa, dataApi, canal) {
  const titulo = 'Nova mensagem por associar';
  const corpo = canal === 'whatsapp'
    ? 'Nova mensagem de WhatsApp por associar a um cliente.'
    : 'Novo email por associar a um cliente.';
  const href = '/apps/legal-nucleo/';
  try {
    await dataApi.create(BELL, {
      tipo: 'comunicacao',
      titulo,
      corpo,
      href,
      lida: false,
      data: new Date().toISOString(),
    });
  } catch (e) {
    ekoa.warn('Falha ao escrever a notificação na campainha', { error: errMsg(e) });
  }
  await ekoa.notify.inApp(titulo, corpo, { source: 'comunicacao', canal, href });
}

/** Candidate clientes for an inbound phone: exact digits, or last-9 suffix. */
function matchByPhone(clientes, inDigits) {
  if (!inDigits) return [];
  const inSuffix = last9(inDigits);
  return clientes.filter((c) => {
    const cd = digitsOnly(c && c.telefone);
    if (!cd) return false;
    if (cd === inDigits) return true;
    const cs = last9(cd);
    return inSuffix !== '' && cs !== '' && cs === inSuffix;
  });
}

/** Last nine digits (a PT national number), or '' when fewer than nine. */
function last9(digits) {
  return digits.length >= 9 ? digits.slice(-9) : '';
}

/** Digits only, e.g. '+351 912 000 001' → '351912000001'. */
function digitsOnly(value) {
  return String(value == null ? '' : value).replace(/\D+/g, '');
}

/** Lowercased, trimmed email for equality comparison. */
function normalizeEmail(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

/** Keep an existing (ISO) timestamp; fall back to now when absent/blank. */
function isoOrNow(value) {
  const s = value == null ? '' : String(value).trim();
  return s || new Date().toISOString();
}

/** Minimal, dependency-free HTML→text: drop script/style, tags, common entities. */
function stripHtmlMinimal(html) {
  return String(html == null ? '' : html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function errMsg(e) {
  return String(e && e.message ? e.message : e);
}
