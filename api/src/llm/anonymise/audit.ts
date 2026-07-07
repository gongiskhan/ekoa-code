/**
 * llm/anonymise/audit.ts - the metadata-ONLY, hash-CHAINED anonymisation audit (§17.6,
 * v2 A6 D2), folded into the Registo single write path (ch09 invariant 3: `data/` logActivity
 * is the ONLY audit write path).
 *
 * Each tokenization event writes ONE record carrying detection metadata only: the entity
 * classes detected, their counts, the per-request correlation id, and a HASH of the payload.
 * It records NO payload bodies and NEVER the vault. A tokenized payload still contains every
 * UNDETECTED span in cleartext, so accumulating bodies at rest would quietly recreate the
 * at-rest copy the architecture removes - metadata is the audit, the payload is not.
 *
 * The write is asynchronous (off the request latency path) and the records form a hash chain,
 * so any excision or reordering is detectable (the security-addendum E.1 cheap hash-chaining).
 */
import { createHash } from 'node:crypto';
import { logActivity } from '../../data/activity.js';
import type { AnonAuditActor, EntityClass } from './types.js';

/** The metadata-only fields written for one anonymisation event. NO bodies, NEVER the vault. */
export interface AnonAuditRecord {
  correlationId: string;
  /** class -> count of distinct detected values of that class. */
  classes: Partial<Record<EntityClass, number>>;
  /** total distinct entities tokenized in this event. */
  entityCount: number;
  /** SHA-256 of the ORIGINAL cleartext model-bound text (a hash, never the body). */
  payloadHash: string;
  /** false when NER coverage was reduced for this event (§17.3 fail-open on (c)). */
  nerAvailable: boolean;
  /** true when this event is a fail-closed refusal (a mandatory detector was down, §17.3). */
  refused?: boolean;
}

/** The audit sink seam. The default folds into logActivity; tests inject a capture sink to
 *  assert the metadata-only + hash-chain invariants. */
export interface AuditSink {
  write(actor: AnonAuditActor, metadata: Record<string, unknown>): Promise<void> | void;
}

const GENESIS = '0'.repeat(64);
let chainHead = GENESIS;
let chainSeq = 0;

/** The default sink: one row through the single Registo write path, category `anonymisation`. */
const logActivitySink: AuditSink = {
  async write(actor, metadata) {
    await logActivity(
      { userId: actor.userId ?? '', username: actor.username ?? actor.userId ?? '', orgId: actor.orgId ?? '' },
      'anonymisation',
      'egress-mask',
      { now: () => Date.now() },
      metadata,
    );
  },
};

let sink: AuditSink = logActivitySink;

export function setAuditSink(s: AuditSink): void {
  sink = s;
}
export function __resetAuditForTests(): void {
  sink = logActivitySink;
  chainHead = GENESIS;
  chainSeq = 0;
}

/** SHA-256 hex of a string (payload hash + chain links). */
export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Record one anonymisation event. Extends the tamper-evident hash chain and writes the
 * metadata-only row asynchronously (fire-and-forget: an audit hiccup never fails the model
 * call, mirroring the chokepoint's fire-and-forget posture). Returns the chain hash so a test
 * can assert linkage.
 */
export function recordAnonAudit(actor: AnonAuditActor, rec: AnonAuditRecord): string {
  const prevChainHash = chainHead;
  const seq = chainSeq++;
  const ts = Date.now();
  const chainHash = sha256(`${prevChainHash}|${seq}|${rec.correlationId}|${rec.payloadHash}|${JSON.stringify(rec.classes)}|${ts}`);
  chainHead = chainHash;

  const metadata: Record<string, unknown> = {
    correlationId: rec.correlationId,
    classes: rec.classes,
    entityCount: rec.entityCount,
    payloadHash: rec.payloadHash,
    nerAvailable: rec.nerAvailable,
    chainSeq: seq,
    prevChainHash,
    chainHash,
    ...(rec.refused ? { refused: true } : {}),
  };

  void Promise.resolve(sink.write(actor, metadata)).catch((err) => {
    console.error('[llm][anonymise] audit write failed:', err instanceof Error ? err.message : err);
  });
  return chainHash;
}
