/**
 * Email source hydration (2A-S2) — the ONE place email specifics live in the dispatch path.
 * Ported from ekoa-dev (cortex/src/services/event-sources/email-hydrate.ts); the normalizers are
 * pure and carried near-verbatim. The ekoa-code adaptation is only the seam boundary: this module
 * lives in `integrations/event-sources/`, so it imports its provider predicate + call-result type
 * from its sibling `platform-poll.ts` and stays fully decoupled from `events/` (see BINDING below).
 *
 * The listener enqueues the lightweight `list_emails` item (id, subject, from, receivedDateTime,
 * bodyPreview — NO full body). When the dispatch target is an artifact backend and the source is an
 * email provider, core hydrates the FULL message via `read_email` and hands the artifact a
 * normalized `EmailInput`. The artifact never touches Graph or OAuth — core fetches the message
 * (the OAuth-refreshing `callPlatformIntegration`, bound to the trigger's org, is injected as `call`).
 *
 * Hard boundary: this normalizes the provider's message shape (Microsoft Graph OR Gmail) into a
 * neutral envelope. It contains NO domain or business logic (no classification, mapping, or customer
 * concepts) — that lives in the consuming artifact's backend.
 *
 * BINDING (integrations/event-sources/): provider-specific; may import integrations/ siblings +
 * data/, never apps/ or web/, and never events/ (events/ imports THIS direction, not the reverse).
 */

import { isPlatformProvider } from './platform-poll.js';
import type { PlatformCallResult } from './platform-poll.js';

/**
 * FROZEN INTERFACE CONTRACT (2A-S2). Neutral, provider-agnostic email envelope delivered to an
 * artifact backend's `onEmail` entrypoint. The BSM ERP `onEmail` backend consumes this exact shape
 * (the ERP import in 2B-S5/S6 depends on it) — DO NOT reshape, rename, or drop a field. It is a
 * runtime JSON envelope (structured-clone-safe: only strings / plain objects / string-maps), handed
 * across the worker boundary, so it has no shared/ zod schema and needs none — the shape here IS the
 * contract. New fields may be ADDED (backend consumers ignore unknown keys); existing fields are
 * frozen.
 */
export interface EmailInput {
  id: string;
  /** The watched mailbox address, when derivable. */
  mailbox: string;
  from: { address: string; name?: string };
  subject: string;
  /** ISO timestamp. */
  receivedAt: string;
  /** Full message body (falls back to the list-item preview ONLY when there is no id to hydrate). */
  body: string;
  bodyContentType?: 'text' | 'html';
  /** Selected provider headers (e.g. internet-message-id), best-effort. */
  headers: Record<string, string>;
  /**
   * Deep link to open the original message in the provider's web client (Graph `webLink` for M365;
   * a best-effort Gmail permalink). Lets a consuming backend cite the source email. Absent if the
   * provider didn't supply one.
   */
  webLink?: string;
}

export interface EmailHydrateDeps {
  /** Calls the platform integration (read_email). Core's credential boundary — bound to the
   *  trigger's org by the composition root so the artifact never touches a token. */
  call(args: Record<string, unknown>): Promise<PlatformCallResult>;
  /** Watched mailbox address, when known (e.g. the connected account). */
  mailbox?: string;
}

/** True when a trigger's source is a platform email provider (M365 / Google). */
export function isEmailSource(trigger: { integrationKey: string }): boolean {
  return isPlatformProvider(trigger.integrationKey);
}

/**
 * Build an `EmailInput` from the enqueued list item, hydrating the full body via `read_email`.
 * `listItem` is the parsed `list_emails` item (the durable event's persisted payload).
 *
 * Failure policy (LOAD-BEARING — so a transient Graph error never silently truncates the body):
 *   - read_email FAILS (or throws) ⇒ THROW. The dispatcher propagates this and the event queue
 *     retries with backoff — the artifact NEVER receives a preview-only body that was then marked
 *     dispatched as final.
 *   - no extractable id ⇒ cannot hydrate, and a retry would not help; degrade to what the list item
 *     carries (subject / from / bodyPreview). This is the ONLY sanctioned preview fallback.
 */
export async function hydrateEmailInput(
  trigger: { integrationKey: string },
  listItem: unknown,
  deps: EmailHydrateDeps,
): Promise<EmailInput> {
  const item = coerceEmailListItem(listItem);
  const id = String(item.id ?? '');

  if (!id) {
    // Cannot hydrate without an id; retry won't help — use the list item as-is.
    return normalizeMessage(trigger.integrationKey, '', item, item, deps.mailbox);
  }

  const res = await deps.call({ integrationKey: trigger.integrationKey, actionName: 'read_email', args: { messageId: id } });
  if (!res.success || !res.data || typeof res.data !== 'object') {
    // Transient/permanent read failure → dispatch failure → queue retry (NEVER a truncated body).
    throw new Error(`read_email failed for message ${id}${res.status ? ` (${res.status})` : ''}: ${res.error ?? 'no message body'}`);
  }

  return normalizeMessage(trigger.integrationKey, id, res.data as Record<string, unknown>, item, deps.mailbox);
}

/**
 * Decode the enqueued email payload into the object the normalizers read.
 *
 * LOAD-BEARING (2A-S2 wiring): the durable event queue persists the enqueued item as JSON TEXT —
 * both the listener rail (`enqueueListenerEvent` stores `rawBody.toString('utf8')`) and the webhook
 * ingress store the payload as a UTF-8 STRING, and nothing between `claimNext` and here re-parses it.
 * So an email-source payload normally arrives here as a STRING, not an object. If we skipped this
 * parse, `typeof string !== 'object'` collapsed the item to `{}`, no id was found, `read_email` was
 * never called, and an EMPTY EmailInput was delivered and marked `delivered` — a SILENT empty
 * delivery, strictly worse than the truncated body the throw-on-read-failure invariant forbids.
 *
 * A payload that does NOT decode to a message object (malformed JSON, or valid JSON that isn't an
 * object) is a corrupt/poison email event: THROW so the delivery pipeline retries and ultimately
 * dead-letters, rather than masquerading as a successful empty delivery. An already-parsed object
 * (e.g. a GET-callback query map) passes straight through.
 */
function coerceEmailListItem(listItem: unknown): Record<string, unknown> {
  if (typeof listItem === 'string') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(listItem);
    } catch {
      throw new Error('email dispatch payload is not valid JSON; cannot hydrate the message');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('email dispatch payload did not decode to a message object; cannot hydrate');
    }
    return parsed as Record<string, unknown>;
  }
  return listItem && typeof listItem === 'object' ? (listItem as Record<string, unknown>) : {};
}

/** Normalize a provider message into the neutral EmailInput (Gmail vs Graph). */
function normalizeMessage(
  integrationKey: string,
  id: string,
  msg: Record<string, unknown>,
  listItem: Record<string, unknown>,
  mailbox: string | undefined,
): EmailInput {
  return integrationKey === 'google-workspace'
    ? normalizeGmailMessage(id, msg, listItem, mailbox)
    : normalizeGraphMessage(id, msg, listItem, mailbox);
}

function normalizeGraphMessage(
  id: string,
  msg: Record<string, unknown>,
  listItem: Record<string, unknown>,
  mailbox: string | undefined,
): EmailInput {
  const fromAddr = readEmailAddress(msg.from) ?? readEmailAddress(listItem.from) ?? { address: '' };

  const bodyObj = msg.body as { contentType?: string; content?: string } | undefined;
  const body = (typeof bodyObj?.content === 'string' && bodyObj.content)
    || (typeof msg.bodyPreview === 'string' ? msg.bodyPreview : '')
    || (typeof listItem.bodyPreview === 'string' ? listItem.bodyPreview : '');
  const bodyContentType = normalizeContentType(bodyObj?.contentType);

  const receivedAt = String(msg.receivedDateTime ?? listItem.receivedDateTime ?? '');
  const subject = String(msg.subject ?? listItem.subject ?? '');

  const headers: Record<string, string> = {};
  if (typeof msg.internetMessageId === 'string') headers['internet-message-id'] = msg.internetMessageId;

  const resolvedMailbox = mailbox
    ?? readEmailAddress((msg.toRecipients as unknown[] | undefined)?.[0])?.address
    ?? '';

  // Graph returns `webLink` (the Outlook deep link) by default on /me/messages/{id}.
  const webLink = typeof msg.webLink === 'string' ? msg.webLink : undefined;

  return { id, mailbox: resolvedMailbox, from: fromAddr, subject, receivedAt, body, bodyContentType, headers, ...(webLink ? { webLink } : {}) };
}

/** Pull `{ address, name }` out of a Graph `from`/recipient node. */
function readEmailAddress(node: unknown): { address: string; name?: string } | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const ea = (node as { emailAddress?: { address?: unknown; name?: unknown } }).emailAddress;
  if (!ea || typeof ea !== 'object') return undefined;
  const address = typeof ea.address === 'string' ? ea.address : '';
  const name = typeof ea.name === 'string' ? ea.name : undefined;
  return { address, ...(name ? { name } : {}) };
}

function normalizeContentType(ct: unknown): 'text' | 'html' | undefined {
  if (typeof ct !== 'string') return undefined;
  const lc = ct.toLowerCase();
  if (lc === 'html') return 'html';
  if (lc === 'text') return 'text';
  return undefined;
}

// ---------------------------------------------------------------------------
// Gmail (google-workspace) message shape:
//   { id, threadId, snippet, internalDate (epoch MS string),
//     payload: { mimeType, headers:[{name,value}], body:{data}, parts:[...] } }
// Headers (From/Subject/Message-ID/To) live in payload.headers[] as name/value;
// body is base64url in payload.body.data or in a text/plain|html entry under parts.
// ---------------------------------------------------------------------------

function normalizeGmailMessage(
  id: string,
  msg: Record<string, unknown>,
  listItem: Record<string, unknown>,
  mailbox: string | undefined,
): EmailInput {
  const payload = (msg.payload && typeof msg.payload === 'object' ? msg.payload : {}) as Record<string, unknown>;
  const hdrs = Array.isArray(payload.headers) ? (payload.headers as Array<{ name?: unknown; value?: unknown }>) : [];
  const header = (name: string): string => {
    const lc = name.toLowerCase();
    const h = hdrs.find((x) => typeof x.name === 'string' && x.name.toLowerCase() === lc);
    return h && typeof h.value === 'string' ? h.value : '';
  };

  const from = parseRfc5322Address(header('From'));
  const subject = header('Subject') || (typeof listItem.subject === 'string' ? listItem.subject : '');

  const internalMs = Number(msg.internalDate);
  const receivedAt = Number.isFinite(internalMs) && internalMs > 0 ? new Date(internalMs).toISOString() : '';

  const { body, contentType } = extractGmailBody(payload, typeof msg.snippet === 'string' ? msg.snippet : '');

  const headers: Record<string, string> = {};
  const mid = header('Message-ID') || header('Message-Id');
  if (mid) headers['internet-message-id'] = mid;

  const resolvedMailbox = mailbox || parseRfc5322Address(header('To')).address || '';

  // Gmail has no webLink field; a permalink by message id opens the thread.
  const webLink = `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`;

  return { id, mailbox: resolvedMailbox, from, subject, receivedAt, body, bodyContentType: contentType, headers, webLink };
}

/** Parse an RFC 5322 address ("Name <addr>" or bare "addr") into {address, name?}. */
function parseRfc5322Address(raw: string): { address: string; name?: string } {
  const s = (raw ?? '').trim();
  if (!s) return { address: '' };
  const m = s.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  if (m) {
    const name = (m[1] ?? '').trim();
    return { address: (m[2] ?? '').trim(), ...(name ? { name } : {}) };
  }
  return { address: s };
}

/** Prefer text/plain, then text/html, walking payload.parts; fall back to snippet. */
function extractGmailBody(payload: Record<string, unknown>, snippet: string): { body: string; contentType?: 'text' | 'html' } {
  const collected: Array<{ mime: string; data: string }> = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    const mime = typeof o.mimeType === 'string' ? o.mimeType.toLowerCase() : '';
    const data = readNestedString(o, ['body', 'data']);
    if (data && (mime === 'text/plain' || mime === 'text/html')) collected.push({ mime, data });
    if (Array.isArray(o.parts)) for (const p of o.parts) walk(p);
  };
  walk(payload);

  const plain = collected.find((c) => c.mime === 'text/plain');
  if (plain) { const d = decodeBase64Url(plain.data); if (d) return { body: d, contentType: 'text' }; }
  const html = collected.find((c) => c.mime === 'text/html');
  if (html) { const d = decodeBase64Url(html.data); if (d) return { body: d, contentType: 'html' }; }

  // Single-part message: body.data at the top level.
  const topData = readNestedString(payload, ['body', 'data']);
  if (topData) {
    const d = decodeBase64Url(topData);
    if (d) return { body: d, contentType: normalizeContentType((payload.mimeType as string | undefined)?.split('/')[1]) };
  }
  return { body: snippet, contentType: undefined };
}

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function readNestedString(obj: Record<string, unknown>, path: string[]): string {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object') return '';
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : '';
}
