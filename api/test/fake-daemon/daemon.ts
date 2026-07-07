/**
 * The fake-daemon core (ch18 §18.7): the daemon-side half of S1 and S2, run against a fixture
 * directory. It verifies task bindings, keeps a replay cache, resolves grants per session, runs
 * the fixed file-tool vocabulary through the containment resolver, emits ledger rows, and produces
 * every denial case of §18.7.2. It is a WS client in ws-client.ts; this file is the pure engine so
 * the denial logic is unit-testable without a socket. The harness is authoritative on the wire (§18.1).
 *
 * Self-contained (no api/src imports): the shippable daemon contract (§18.7.1).
 */
import { createHmac, createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
// The canonical signing bytes come from the FROZEN shared contract — the daemon verifies with the
// SAME bytes Cortex signed (§18.1 wire lockstep). Only the wire contract is imported, never api/src.
import { canonicalTaskBinding } from '@ekoa/shared';
import { resolveWithinGrant, ContainmentError } from './containment.js';

/** The 8-field S2 binding + transport fields (mirrors shared/ekoa-local DelegatedTask). */
export interface DelegatedTask {
  taskId: string;
  org: string;
  user: string;
  session: string;
  pairingId: string;
  grantRefs: string[];
  task: string;
  budget: { egressBytes: number; modelSpend: { userId: string } };
  expiry: string;
  nonce: string;
  sig: string;
}

export interface EgressLedgerRow {
  ts: string;
  session: string;
  correlationId: string;
  path: string;
  byteRange: string;
  bytesOut: number;
  sha256: string;
  tool: string;
}

export type Denial = { reason: string; principle: 'S1' | 'S2' | 'S5' };

/** A grant the daemon holds: an opaque ref → a real root dir, bound to the session that owns it. */
export interface Grant {
  grantRef: string;
  root: string;
  session: string;
}

export interface FakeDaemonOptions {
  pairingId: string;
  org: string;
  /** The shared HMAC secret Cortex signs task bindings with (the daemon verifies §18.5.1 step 1). */
  signingSecret: string;
  grants: Grant[];
  /** Per-session egress cap in bytes (S5). Default from the task budget. */
  now?: () => number;
}

/** Sign a task the way Cortex does: HMAC-SHA256 over the SHARED canonical binding (§18.1). The
 *  daemon and Cortex share the HMAC secret (established at pairing; in tests the secret is passed). */
export function signTask(t: Omit<DelegatedTask, 'sig'>, secret: string): string {
  return createHmac('sha256', secret).update(canonicalTaskBinding(t)).digest('hex');
}

/**
 * The fake daemon. `verifyTask` runs the §18.5.1 ordered sequence; a failure returns a Denial and
 * (for the caller) is ledgered as a denial. `executeReads` runs file reads within grants, emitting
 * one ledger row per read and rejecting any out-of-grant read (S1). Injection is contained by the
 * absence of an upload primitive (S5) — this class exposes NO exfiltration verb.
 */
export class FakeDaemon {
  private readonly seenNonces = new Set<string>();
  private egressUsed = 0;
  readonly ledger: EgressLedgerRow[] = [];
  readonly denials: Array<Denial & { taskId?: string }> = [];

  constructor(private readonly opts: FakeDaemonOptions) {}

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private grantFor(grantRef: string, session: string): Grant | undefined {
    // A grant is resolved ONLY for the session that owns it (§18.5.1 step 5, S2).
    return this.opts.grants.find((g) => g.grantRef === grantRef && g.session === session);
  }

  /** §18.5.1: verify sig → this-pairing → expiry → nonce → grants-for-session. Returns null on OK. */
  verifyTask(task: DelegatedTask): Denial | null {
    // 1. signature over the SHARED canonical binding (reject a forged task) — same bytes as Cortex.
    const expectSig = signTask(task, this.opts.signingSecret);
    if (task.sig !== expectSig) return this.deny(task, { reason: 'bad signature', principle: 'S2' });
    // 2. addressed to THIS pairing (reject a task forged for another pairing).
    if (task.pairingId !== this.opts.pairingId) return this.deny(task, { reason: 'wrong pairing', principle: 'S2' });
    // (cross-org: a task whose org != this daemon's org is refused daemon-side too.)
    if (task.org !== this.opts.org) return this.deny(task, { reason: 'cross-org addressing', principle: 'S2' });
    // 3. expiry in the future.
    if (Date.parse(task.expiry) <= this.now()) return this.deny(task, { reason: 'task expired', principle: 'S2' });
    // 4. nonce unseen; then record it.
    if (this.seenNonces.has(task.nonce)) return this.deny(task, { reason: 'replayed nonce', principle: 'S2' });
    this.seenNonces.add(task.nonce);
    // 5. every grantRef resolves to a grant held FOR THIS SESSION.
    for (const ref of task.grantRefs) {
      if (!this.grantFor(ref, task.session)) return this.deny(task, { reason: `unknown or foreign-session grant: ${ref}`, principle: 'S2' });
    }
    return null;
  }

  private deny(task: DelegatedTask | undefined, d: Denial): Denial {
    this.denials.push({ ...d, ...(task ? { taskId: task.taskId } : {}) });
    return d;
  }

  /**
   * Read a path within one of the task's grants (§18.5 S1 containment). Emits a ledger row (S6)
   * and returns the excerpt. An out-of-grant / traversal / symlink-escape read is DENIED+ledgered
   * and throws. `correlationId` is the chokepoint's per-provider-request id (S6 join key).
   */
  read(task: DelegatedTask, grantRef: string, relPath: string, correlationId: string, tool = 'read'): string {
    const grant = this.grantFor(grantRef, task.session);
    if (!grant) {
      this.deny(task, { reason: `read against unknown grant: ${grantRef}`, principle: 'S2' });
      throw new ContainmentError('unknown grant');
    }
    let real: string;
    try {
      real = resolveWithinGrant(grant.root, relPath);
    } catch (err) {
      this.deny(task, { reason: err instanceof ContainmentError ? err.reason : 'containment error', principle: 'S1' });
      throw err;
    }
    const bytes = readFileSync(real);
    // S5: the per-session egress cap bounds how much can ever leave.
    if (this.egressUsed + bytes.length > task.budget.egressBytes) {
      this.deny(task, { reason: 'egress cap reached', principle: 'S5' });
      throw new ContainmentError('egress cap reached');
    }
    this.egressUsed += bytes.length;
    const excerpt = bytes.toString('utf8');
    this.ledger.push({
      ts: new Date(this.now()).toISOString(),
      session: task.session,
      correlationId,
      path: relative(grant.root, real) || real,
      byteRange: `0-${bytes.length}`,
      bytesOut: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      tool,
    });
    return excerpt;
  }

  /** stat a path within a grant (fixed file-tool vocabulary; no exfiltration). */
  stat(task: DelegatedTask, grantRef: string, relPath: string): { size: number } {
    const grant = this.grantFor(grantRef, task.session);
    if (!grant) throw new ContainmentError('unknown grant');
    const real = resolveWithinGrant(grant.root, relPath);
    return { size: statSync(real).size };
  }

  egressBytesUsed(): number {
    return this.egressUsed;
  }
}
