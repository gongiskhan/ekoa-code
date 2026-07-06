/**
 * Trigger + webhook-ingress service (ch03 §3.8.17, ch09 invariant 9). Owns the triggers +
 * event-queue + webhook-audit stores. The ingress pipeline order is fixed (invariant 9):
 * signature → disabled-check (after signature) → dedup enqueue → audit — with the disabled
 * endpoint returning 410 on a VALID signature and 401 on an invalid one.
 */
import { triggers, webhookAudit } from '../data/stores.js';
import { decrypt, encrypt } from '../data/crypto.js';
import { enqueue } from './queue.js';
import { verifyHmac, hubChallenge, type WebhookAlgorithm } from './webhook-verifiers.js';
import type { Actor } from '@ekoa/shared';
import type { Doc } from '../data/store.js';

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
    publicUrl: `${publicUrlBase}/hooks/${t._id}`, // secret stays redacted (landmine 3)
  };
}

export async function listTriggers(actor: Actor): Promise<TriggerDoc[]> {
  return triggers.find({ orgId: actor.orgId }) as Promise<TriggerDoc[]>;
}

export async function createTrigger(actor: Actor, input: {
  targetKind: 'automation' | 'artifact-backend'; integrationKey: string; eventName: string;
  automationId?: string; artifactId?: string; entrypoint?: string; secret?: string; algorithm?: WebhookAlgorithm;
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
  };
  await triggers.insert(doc as never);
  return { trigger: doc, secret }; // secret returned exactly once (landmine 2)
}

export async function deleteTrigger(actor: Actor, id: string): Promise<boolean> {
  const t = (await triggers.get(id)) as TriggerDoc | null;
  if (!t || t.orgId !== actor.orgId) return false;
  return triggers.delete(id);
}

async function audit(triggerId: string, outcome: IngressOutcome, deps: Deps): Promise<void> {
  await webhookAudit.insert({ _id: deps.genId(), triggerId, outcome, at: new Date(deps.now()).toISOString() });
}

export interface IngressResult {
  status: number;
  body: unknown;
  outcome: IngressOutcome;
}

/** The webhook ingress pipeline (invariant 9). `rawBody` is the UNMODIFIED request bytes. */
export async function handleIngress(triggerId: string, rawBody: Buffer, signature: string | undefined, deps: Deps): Promise<IngressResult> {
  const t = (await triggers.get(triggerId)) as TriggerDoc | null;
  if (!t) {
    await audit(triggerId, 'rejected_unknown_trigger', deps);
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Trigger não encontrado.' } }, outcome: 'rejected_unknown_trigger' };
  }
  // 1. Signature FIRST (invariant 9 step 2 ordering).
  const secret = t.secretCiphertext ? decrypt(t.secretCiphertext) : '';
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
  // 3. Dedup enqueue (UNIQUE(trigger_id, dedup_key)).
  const dedupKey = signature.slice(0, 64); // provider signature is a stable per-delivery key
  const enq = await enqueue(triggerId, dedupKey, rawBody.toString('utf8'), new Date(deps.now()).toISOString());
  if (enq.duplicate) {
    await audit(triggerId, 'duplicate', deps);
    return { status: 200, body: { duplicate: true }, outcome: 'duplicate' };
  }
  await audit(triggerId, 'accepted', deps);
  return { status: 200, body: { accepted: true }, outcome: 'accepted' };
}

export { hubChallenge };
