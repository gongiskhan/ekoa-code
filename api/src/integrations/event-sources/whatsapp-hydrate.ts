/**
 * WhatsApp source hydration (2A-S3) — the ONE place WhatsApp-envelope specifics live in the
 * dispatch path. Sibling of email-hydrate.ts. Ported from ekoa-dev
 * (cortex/src/services/event-sources/whatsapp-hydrate.ts); `extractWhatsAppMessages` and its
 * readers are carried near-verbatim. The ekoa-code adaptations are only at the seams: the trigger
 * projection is a structural `{ integrationKey }` (no persistence type imported), plus two additions
 * the ekoa-code rails need — `hydrateWhatsAppMessages` (the durable queue stores payloads as JSON
 * TEXT) and `whatsAppDedupKey` (the ingress's wamid-derived dedup key).
 *
 * A Meta WhatsApp Cloud API webhook batches messages inside a nested envelope:
 *
 *   { object, entry: [ { id, changes: [ { field: 'messages', value: {
 *       messaging_product, metadata: { phone_number_id, ... },
 *       contacts: [ { profile: { name }, wa_id } ],
 *       messages: [ { from, id, timestamp, type, text|image|... } ],
 *       statuses: [ ... ]   // delivery receipts — NOT inbound messages
 *   } } ] } ] }
 *
 * `extractWhatsAppMessages` flattens that into a neutral `MessageInput[]` — one per inbound
 * message. It is PURE (no I/O, no throw): a malformed payload yields `[]` rather than an exception,
 * and a statuses-only notification (no `messages`) yields `[]` so the dispatcher can skip it. No
 * domain/business logic lives here — matching, dedup-by-id and persistence are the consuming
 * artifact backend's job.
 *
 * BINDING (integrations/event-sources/): provider-specific; may import integrations/ siblings +
 * data/, never apps/ or web/, and never events/ (events/ imports THIS direction, not the reverse).
 */

import { createHash } from 'node:crypto';

/** Media kinds WhatsApp can attach to a message. */
export type WhatsAppMediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker';

/** A media attachment reference (the bytes are fetched later via get_media_url). */
export interface WhatsAppMedia {
  /** Media id — resolve a temporary download URL with the get_media_url action. */
  id: string;
  mimeType?: string;
  kind: WhatsAppMediaKind;
}

/**
 * FROZEN INTERFACE CONTRACT (2A-S3), the WhatsApp sibling of `EmailInput`. Neutral inbound-message
 * envelope delivered to an artifact backend — ONE invocation per message (the webhook envelope
 * fans out). It is a runtime JSON envelope handed across the worker boundary, so it has no shared/
 * zod schema and needs none — the shape here IS the contract. New fields may be ADDED (backend
 * consumers ignore unknown keys); existing fields are frozen.
 */
export interface MessageInput {
  channel: 'whatsapp';
  /** wamid — stable message id; the backend MUST dedupe on this. */
  id: string;
  /** Sender's phone in WhatsApp form (digits, no '+'), e.g. 351912345678. */
  from: string;
  /** Sender's WhatsApp profile name, when the provider included it. */
  name?: string;
  /** Message body — text body, media caption, or a `[tipo]` marker for media without a caption. */
  text: string;
  /** Present for media messages (image/video/audio/document/sticker). */
  media?: WhatsAppMedia;
  /** ISO timestamp; empty string when the provider's timestamp is unparseable. */
  timestamp: string;
  /** The business phone number id that received the message (value.metadata.phone_number_id). */
  phoneNumberId: string;
  /** The original provider message object, for the backend to cite / inspect. */
  raw: unknown;
}

/** True when a trigger's source is the WhatsApp Business integration. */
export function isWhatsAppSource(trigger: { integrationKey: string }): boolean {
  return trigger.integrationKey === 'whatsapp';
}

/** PT-PT marker text for a media message that carried no caption. */
const MEDIA_MARKER: Record<string, string> = {
  image: '[imagem]',
  video: '[vídeo]',
  audio: '[áudio]',
  document: '[documento]',
  sticker: '[autocolante]',
  location: '[localização]',
  contacts: '[contacto]',
};

const MEDIA_KINDS: ReadonlySet<string> = new Set<WhatsAppMediaKind>([
  'image', 'video', 'audio', 'document', 'sticker',
]);

/**
 * Flatten a WhatsApp webhook envelope into one `MessageInput` per inbound
 * message. Pure and total: never throws; returns `[]` for malformed input,
 * statuses-only notifications, or an envelope with no messages.
 */
export function extractWhatsAppMessages(payload: unknown): MessageInput[] {
  const out: MessageInput[] = [];
  const entries = asArray(record(payload)?.entry);
  for (const entry of entries) {
    const changes = asArray(record(entry)?.changes);
    for (const change of changes) {
      const value = record(record(change)?.value);
      if (!value) continue;
      const messages = asArray(value.messages);
      if (messages.length === 0) continue; // statuses-only / no inbound messages

      const phoneNumberId = str(record(value.metadata)?.phone_number_id);
      const contacts = asArray(value.contacts);

      for (const raw of messages) {
        const msg = record(raw);
        if (!msg) continue;
        const id = str(msg.id);
        const from = str(msg.from);
        if (!id) continue; // a message without a wamid is not addressable — skip
        out.push({
          channel: 'whatsapp',
          id,
          from,
          name: nameFor(contacts, from),
          text: textFor(msg),
          media: mediaFor(msg),
          timestamp: isoTimestamp(msg.timestamp),
          phoneNumberId,
          raw,
        });
      }
    }
  }
  return out;
}

/**
 * Decode the DURABLE payload and flatten it (the dispatch-path entry point).
 *
 * LOAD-BEARING (the 2A-S2 wiring lesson): the event queue persists the enqueued payload as JSON
 * TEXT — the webhook ingress stores `rawBody.toString('utf8')` and nothing between `claimNext` and
 * here re-parses it. `extractWhatsAppMessages` is total, so handing it the raw STRING would return
 * `[]` and every real inbound message would be silently swallowed as a "statuses-only no-op". So we
 * parse first, and a payload that is NOT valid JSON THROWS (the delivery pipeline retries and
 * ultimately dead-letters) rather than masquerading as an empty, successfully-dispatched delivery.
 * An already-parsed object passes straight through.
 */
export function hydrateWhatsAppMessages(payload: unknown): MessageInput[] {
  return extractWhatsAppMessages(decodeEnvelope(payload));
}

/**
 * Deterministic dedup key for a WhatsApp delivery, derived from the wamids the envelope carries
 * (ingress → `UNIQUE(triggerId, dedupKey)`).
 *
 * The wamid is the provider's stable per-message identity, so keying on the SET of wamids in the
 * envelope collapses a Meta retry even when the retry is re-serialised (different bytes, same
 * messages) — something the raw-body hash cannot do. Two properties are load-bearing:
 *   - it is the WHOLE set, not `messages[0].id`: a first-message key would let a later batch
 *     `[m1, m2]` collide with an already-seen `[m1]` and LOSE m2.
 *   - it is order-independent (ids sorted) and hashed, so the derived key is bounded (the queue's
 *     `_id` is `triggerId::dedupKey`) regardless of batch size.
 *
 * Returns null when the envelope carries no inbound messages (statuses-only, or malformed) — the
 * caller then falls back to the body hash so such a delivery is still deduped, never dropped.
 */
export function whatsAppDedupKey(payload: unknown): string | null {
  const ids = extractWhatsAppMessages(decodeEnvelopeSafe(payload)).map((m) => m.id);
  if (ids.length === 0) return null;
  const canonical = [...ids].sort().join('\n');
  return `wamid:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Payload decoding
// ---------------------------------------------------------------------------

/** Parse a JSON-TEXT payload; THROW on non-JSON (see hydrateWhatsAppMessages). */
function decodeEnvelope(payload: unknown): unknown {
  if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
    const text = typeof payload === 'string' ? payload : payload.toString('utf8');
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('whatsapp dispatch payload is not valid JSON; cannot hydrate the messages');
    }
  }
  return payload;
}

/** Total variant for the ingress dedup path: an undecodable payload yields undefined → null key
 *  → the caller's body-hash fallback (the ingress must never throw on a signed delivery). */
function decodeEnvelopeSafe(payload: unknown): unknown {
  try {
    return decodeEnvelope(payload);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Per-message extraction (defensive — every reader tolerates missing fields)
// ---------------------------------------------------------------------------

/** Resolve the display text: text body, media caption, or a `[tipo]` marker. */
function textFor(msg: Record<string, unknown>): string {
  const type = str(msg.type);
  if (type === 'text') {
    const body = str(record(msg.text)?.body);
    return body;
  }
  // Media types can carry a caption; degrade to a PT marker when absent.
  const sub = record(msg[type]);
  const caption = str(sub?.caption);
  if (caption) return caption;
  if (type === 'button') return str(record(msg.button)?.text);
  if (type === 'interactive') {
    const interactive = record(msg.interactive);
    const reply = record(interactive?.button_reply) ?? record(interactive?.list_reply);
    const title = str(reply?.title);
    if (title) return title;
  }
  return MEDIA_MARKER[type] ?? (type ? `[${type}]` : '[mensagem]');
}

/** Extract a media reference for image/video/audio/document/sticker messages. */
function mediaFor(msg: Record<string, unknown>): WhatsAppMedia | undefined {
  const type = str(msg.type);
  if (!MEDIA_KINDS.has(type)) return undefined;
  const sub = record(msg[type]);
  const id = str(sub?.id);
  if (!id) return undefined;
  const mimeType = str(sub?.mime_type) || undefined;
  return { id, mimeType, kind: type as WhatsAppMediaKind };
}

/** Sender profile name: prefer the contact whose wa_id matches the sender. */
function nameFor(contacts: unknown[], from: string): string | undefined {
  if (contacts.length === 0) return undefined;
  const matched = contacts
    .map(record)
    .find((c) => c && str(c.wa_id) === from && from !== '');
  const chosen = matched ?? record(contacts[0]);
  const name = str(record(chosen?.profile)?.name);
  return name || undefined;
}

/** WhatsApp timestamps are unix seconds as a string; convert to ISO (empty on failure).
 *  The upper bound is the ECMAScript max time value: without it a nonsense timestamp
 *  (e.g. 1e300) makes `toISOString()` throw a RangeError, breaking the never-throws contract. */
const MAX_TIME_VALUE_MS = 8.64e15;
function isoTimestamp(ts: unknown): string {
  const n = Number(typeof ts === 'string' || typeof ts === 'number' ? ts : NaN);
  if (!Number.isFinite(n) || n <= 0) return '';
  const ms = n * 1000;
  if (ms > MAX_TIME_VALUE_MS) return '';
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Tiny defensive coercers
// ---------------------------------------------------------------------------

function record(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : typeof v === 'number' ? String(v) : '';
}
