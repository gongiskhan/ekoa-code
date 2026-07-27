/**
 * Trigger + webhook-ingress service (ch03 §3.8.17, ch09 invariant 9). Owns the triggers +
 * event-queue + webhook-audit stores. The ingress pipeline order is fixed (invariant 9):
 * signature → disabled-check (after signature) → dedup enqueue → audit — with the disabled
 * endpoint returning 410 on a VALID signature and 401 on an invalid one.
 */
import { createHash } from 'node:crypto';
import { triggers, webhookAudit } from '../data/stores.js';
import { envelopeDecrypt, decrypt, encrypt } from '../data/crypto.js';
import { getDefinition, findConfigForOwner } from '../integrations/index.js';
import { enqueue } from './queue.js';
import { wakeDelivery } from './delivery.js';
import { deleteListenerCursor } from './listener-state.js';
import { verifyHmac, hubChallenge, safeEqual, type WebhookAlgorithm } from './webhook-verifiers.js';
import { isWhatsAppSource, whatsAppDedupKey } from '../integrations/event-sources/whatsapp-hydrate.js';
import type { Actor } from '@ekoa/shared';
import type { Doc } from '../data/store.js';

/** How a listener trigger polls its source (2A-S1). Absent on webhook triggers. */
export interface TriggerPollConfig {
  /** The list-action the source polls (defaults to the provider's built-in poll action). */
  actionName: string;
  /** Poll cadence in ms. */
  intervalMs: number;
}

export interface TriggerDoc extends Doc {
  ownerUserId: string;
  orgId: string;
  integrationKey: string;
  eventName: string;
  targetKind: 'automation' | 'artifact-backend';
  automationId?: string;
  artifactId?: string;
  entrypoint?: string;
  secretCiphertext?: string;
  algorithm: WebhookAlgorithm;
  disabled: boolean;
  /** How the event is SOURCED (2A-S1). ABSENT ⇒ 'webhook' (migration-free — existing rows keep
   *  working). 'listener' triggers are polled by the listener supervisor instead of receiving
   *  inbound webhooks; `kind` is orthogonal to `targetKind` (where the event is delivered). */
  kind?: 'webhook' | 'listener';
  /** Listener-only polling configuration (2A-S1). */
  pollConfig?: TriggerPollConfig;
}

export type IngressOutcome = 'accepted' | 'duplicate' | 'rejected_signature' | 'rejected_unknown_trigger' | 'rejected_disabled' | 'rejected_other';

export interface Deps { now: () => number; genId: () => string }

export function triggerView(t: TriggerDoc, publicUrlBase: string) {
  return {
    id: t._id,
    integrationKey: t.integrationKey,
    eventName: t.eventName,
    automationId: t.automationId,
    artifactId: t.artifactId,
    disabled: t.disabled,
    // `kind` absent on a legacy row surfaces as 'webhook' (migration-free semantic, 2A-S1);
    // pollConfig only appears for listeners. The publicUrl is meaningful for webhook triggers.
    kind: t.kind ?? 'webhook',
    ...(t.pollConfig ? { pollConfig: t.pollConfig } : {}),
    publicUrl: `${publicUrlBase}/hooks/${t._id}`, // secret stays redacted (landmine 3)
  };
}

export async function listTriggers(actor: Actor): Promise<TriggerDoc[]> {
  return triggers.find({ orgId: actor.orgId }) as Promise<TriggerDoc[]>;
}

export async function createTrigger(actor: Actor, input: {
  targetKind: 'automation' | 'artifact-backend'; integrationKey: string; eventName: string;
  automationId?: string; artifactId?: string; entrypoint?: string; secret?: string; algorithm?: WebhookAlgorithm;
  kind?: 'webhook' | 'listener'; pollConfig?: TriggerPollConfig;
}, deps: Deps): Promise<{ trigger: TriggerDoc; secret?: string }> {
  const id = deps.genId();
  const secret = input.secret ?? deps.genId();
  const doc: TriggerDoc = {
    _id: id,
    ownerUserId: actor.userId,
    orgId: actor.orgId,
    integrationKey: input.integrationKey,
    eventName: input.eventName,
    targetKind: input.targetKind,
    automationId: input.automationId,
    artifactId: input.artifactId,
    entrypoint: input.entrypoint,
    secretCiphertext: encrypt(secret), // encrypted at rest, decrypted only at verify time
    algorithm: input.algorithm ?? 'hmac-sha256-hex',
    disabled: false,
    // `kind` absent ⇒ persist as webhook implicitly (leave the field off for migration-free parity
    // with legacy rows); only stamp it for an explicit listener. 2A-S1.
    ...(input.kind === 'listener' ? { kind: 'listener' as const, pollConfig: input.pollConfig } : {}),
  };
  await triggers.insert(doc as never);
  return { trigger: doc, secret }; // secret returned exactly once (landmine 2)
}

export async function deleteTrigger(actor: Actor, id: string): Promise<boolean> {
  const t = (await triggers.get(id)) as TriggerDoc | null;
  if (!t || t.orgId !== actor.orgId) return false;
  const deleted = await triggers.delete(id);
  // Drop any listener-state row so a deleted listener's cursor never lingers (2A-S1). No-op for
  // webhook triggers (no row) and harmless if the supervisor already stopped the loop.
  if (deleted) await deleteListenerCursor(id);
  return deleted;
}

async function audit(triggerId: string, outcome: IngressOutcome, deps: Deps): Promise<void> {
  await webhookAudit.insert({ _id: deps.genId(), triggerId, outcome, at: new Date(deps.now()).toISOString() });
}

export interface IngressResult {
  status: number;
  body: unknown;
  outcome: IngressOutcome;
}

/** How an integration declares WHERE the expected webhook secret comes from. `'trigger'` (or
 *  absent) = the secret WE generated and handed the provider; `{credentialField}` = one of the
 *  provider's OWN credentials the owner stored (Meta signs WhatsApp webhooks with the app secret). */
type WebhookSecretSource = 'trigger' | { credentialField: string };

/** The trigger's integration declaration of `webhookConfig.secretSource`, or undefined. */
function secretSourceFor(integrationKey: string): WebhookSecretSource | undefined {
  const src = getDefinition(integrationKey)?.webhookConfig?.secretSource;
  if (src === 'trigger') return 'trigger';
  if (src && typeof src === 'object' && typeof (src as { credentialField?: unknown }).credentialField === 'string') {
    return { credentialField: (src as { credentialField: string }).credentialField };
  }
  return undefined;
}

/**
 * Resolve the CLEARTEXT secret a delivery must verify against (2A-S3). Returns null when it cannot
 * be resolved — callers FAIL CLOSED (never verify against a fallback/empty secret).
 *
 * `{credentialField}` reads the OWNER's decrypted integration credential (e.g. WhatsApp's
 * `app_secret`); anything else decrypts the trigger's own generated secret. The value is returned to
 * the verifier and NEVER logged, audited or echoed in a response.
 */
async function resolveWebhookSecret(t: TriggerDoc, source: WebhookSecretSource | undefined): Promise<string | null> {
  if (source && typeof source === 'object') {
    const cfg = await findConfigForOwner(t.orgId, t.ownerUserId, t.integrationKey);
    if (!cfg?.credentialsCiphertext) return null;
    try {
      // Cofre B-4: the integration credential blob is org-bound v2 now; v1 rows still read.
      const fields = JSON.parse(await envelopeDecrypt(cfg.credentialsCiphertext, cfg.orgId)) as Record<string, unknown>;
      const v = fields[source.credentialField];
      return typeof v === 'string' && v !== '' ? v : null;
    } catch {
      return null;
    }
  }
  if (!t.secretCiphertext) return null; // no secret on record ⇒ nothing can verify ⇒ fail closed
  try {
    return decrypt(t.secretCiphertext);
  } catch {
    return null;
  }
}

/**
 * Per-delivery dedup key (`UNIQUE(triggerId, dedupKey)`).
 *
 * DEFAULT: the BODY HASH, not the signature header — a signature can carry cosmetic variation
 * (prefix, case) that verifies but slips a header-keyed dedup, letting one captured delivery replay
 * unboundedly. The body hash is the stable per-delivery identity (byte-identical retries dedup;
 * distinct events differ) — the §12.3 body-hash fallback made the primary key.
 *
 * WHATSAPP (2A-S3): keyed on the SET of wamids the envelope carries, which is strictly stronger —
 * a Meta retry that re-serialises the envelope (different bytes, same messages) still dedups, while
 * a later batch [m1,m2] stays distinct from an already-seen [m1] so m2 is never lost. An envelope
 * with no inbound messages (statuses-only) has no wamid and falls back to the body hash, so it is
 * still enqueued exactly once rather than dropped.
 */
function deriveDedupKey(t: TriggerDoc, rawBody: Buffer): string {
  if (isWhatsAppSource(t)) {
    const k = whatsAppDedupKey(rawBody);
    if (k) return k;
  }
  return createHash('sha256').update(rawBody).digest('hex');
}

/** The webhook ingress pipeline (invariant 9). `rawBody` is the UNMODIFIED request bytes. */
export async function handleIngress(triggerId: string, rawBody: Buffer, signature: string | undefined, deps: Deps): Promise<IngressResult> {
  const t = (await triggers.get(triggerId)) as TriggerDoc | null;
  if (!t) {
    await audit(triggerId, 'rejected_unknown_trigger', deps);
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Trigger não encontrado.' } }, outcome: 'rejected_unknown_trigger' };
  }
  // 1. Signature FIRST (invariant 9 step 2 ordering). The expected secret is the trigger's own
  // generated secret UNLESS the integration declares `secretSource:{credentialField}` — Meta signs
  // every WhatsApp webhook with the app secret, so the owner's stored `app_secret` is the ONLY
  // secret that can verify it. An unresolvable secret fails CLOSED (500, nothing enqueued): we
  // never fall back to the trigger secret or to an empty key, which would make forged deliveries
  // verifiable. The message names no credential and carries no secret material.
  const secret = await resolveWebhookSecret(t, secretSourceFor(t.integrationKey));
  if (secret === null) {
    await audit(triggerId, 'rejected_other', deps);
    return { status: 500, body: { error: { code: 'INTERNAL', message: 'Segredo de verificação indisponível.' } }, outcome: 'rejected_other' };
  }
  const sigOk = signature !== undefined && verifyHmac(t.algorithm, secret, rawBody, signature);
  if (!sigOk) {
    await audit(triggerId, 'rejected_signature', deps);
    return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Assinatura inválida.' } }, outcome: 'rejected_signature' };
  }
  // 2. Disabled-check AFTER a valid signature → 410 (deliberate ordering; boot self-test probes it).
  if (t.disabled) {
    await audit(triggerId, 'rejected_disabled', deps);
    return { status: 410, body: { error: { code: 'TRIGGER_DISABLED', message: 'Trigger desativado.' } }, outcome: 'rejected_disabled' };
  }
  // 3. Dedup enqueue (UNIQUE(trigger_id, dedup_key)) — see deriveDedupKey for the key policy.
  const dedupKey = deriveDedupKey(t, rawBody);
  const enq = await enqueue(triggerId, dedupKey, rawBody.toString('utf8'), new Date(deps.now()).toISOString());
  if (enq.duplicate) {
    await audit(triggerId, 'duplicate', deps);
    return { status: 200, body: { duplicate: true }, outcome: 'duplicate' };
  }
  await audit(triggerId, 'accepted', deps);
  wakeDelivery(deps.now); // nudge the drain loop; the 5s safety net covers a missed wake (§12.3)
  return { status: 200, body: { accepted: true }, outcome: 'accepted' };
}

// --- GET-as-EVENT callback ingress (Ifthenpay et al.; carried webhooks-handler semantics) ----

interface GetCallbackConfig {
  keyParam: string;
  secretSource?: 'trigger' | { credentialField: string };
  dedupParams?: string[];
  responseBody?: string;
}

/** The trigger's integration declares a query-param GET callback, or null. */
export function getCallbackConfigFor(integrationKey: string): GetCallbackConfig | null {
  const def = getDefinition(integrationKey);
  const cb = def?.webhookConfig?.getCallback as GetCallbackConfig | undefined;
  return cb && typeof cb.keyParam === 'string' ? cb : null;
}

/**
 * GET /hooks/:triggerId treated as a durable EVENT for `getCallback` integrations: the provider
 * (Ifthenpay Multibanco/MB WAY) confirms a payment with a plain GET carrying query params plus a
 * shared anti-phishing key. Verify the key (timing-safe), 410 on disabled AFTER the key check
 * (same ordering as the POST path), dedup on the declared params, enqueue the query map as the
 * payload, and echo the exact success body the provider expects — it resends until it sees `OK`,
 * so a DUPLICATE also answers the success body.
 */
export async function handleGetCallbackIngress(
  triggerId: string,
  query: Record<string, string>,
  deps: Deps,
): Promise<IngressResult | null> {
  const t = (await triggers.get(triggerId)) as TriggerDoc | null;
  if (!t) return null; // caller falls through to the handshake path (uniform 404 there)
  const cb = getCallbackConfigFor(t.integrationKey);
  if (!cb) return null;
  const responseBody = cb.responseBody ?? 'OK';

  // Resolve the expected secret: a decrypted OWNER credential field, or the trigger's own secret.
  // ONE resolver shared with the POST path (2A-S3) so both ingresses fail closed identically.
  const secret = await resolveWebhookSecret(t, cb.secretSource);
  if (secret === null) {
    await audit(triggerId, 'rejected_other', deps);
    return { status: 500, body: { error: { code: 'INTERNAL', message: 'Segredo do callback indisponível.' } }, outcome: 'rejected_other' };
  }

  const presented = query[cb.keyParam];
  if (!presented || !safeEqual(presented, secret)) {
    await audit(triggerId, 'rejected_signature', deps);
    return { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'Chave inválida.' } }, outcome: 'rejected_signature' };
  }
  if (t.disabled) {
    await audit(triggerId, 'rejected_disabled', deps);
    return { status: 410, body: { error: { code: 'TRIGGER_DISABLED', message: 'Trigger desativado.' } }, outcome: 'rejected_disabled' };
  }

  // Dedup: the declared params joined, else a hash of the whole query (minus the key param).
  const { [cb.keyParam]: _key, ...payload } = query;
  const dedupKey = cb.dedupParams?.length
    ? cb.dedupParams.map((p) => query[p] ?? '').join('::')
    : createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const enq = await enqueue(triggerId, dedupKey, payload, new Date(deps.now()).toISOString());
  await audit(triggerId, enq.duplicate ? 'duplicate' : 'accepted', deps);
  if (!enq.duplicate) wakeDelivery(deps.now);
  // The provider resends until it sees the success body — duplicates answer it too.
  return { status: 200, body: responseBody, outcome: enq.duplicate ? 'duplicate' : 'accepted' };
}

export { hubChallenge };
