/**
 * verify/verify-task.ts — the ordered S2 task-binding verification (ch18 §18.5.1).
 *
 * This is the daemon-side gate every delegated task passes before any file tool runs. It reproduces
 * the fake-daemon `verifyTask` sequence EXACTLY (parity source:
 * `ekoa-code/api/test/fake-daemon/daemon.ts` + `.../tests/fake-daemon/adversarial.test.ts`); the
 * denial reasons MUST match the harness regexes (CLAUDE.md / conventions "denial reasons"). The
 * order is load-bearing — cheapest/most-fundamental checks first, and the nonce is recorded mid-way
 * so a task that passes replay but fails the grant check still consumes its nonce (harness parity).
 *
 * S3 stays filesystem-free: verification is pure over in-memory session state (nonce cache + grant
 * table). Ledgering a denial is the engine's job — it passes a `DenialSink` that writes the row, so
 * the fs boundary stays in the owning module (single-resolver / fs-confinement rule).
 */
import { DelegatedTask, verifyDelegatedTaskSig } from '../wire/index.js';
import type { GrantTable } from '../session/grants.js';
import type { NonceCache } from '../session/nonces.js';

/** A rejection: a stable reason (harness-regex-matching), the breached principle, and the task id. */
export interface Denial {
  reason: string;
  principle: 'S1' | 'S2' | 'S5';
  taskId?: string;
}

/** Receives every denial verification produces (the engine wires this to the ledger). */
export type DenialSink = (denial: Denial) => void;

/** Everything verification needs, with no reach to the filesystem: identity + in-memory state. */
export interface VerifyContext {
  /** This daemon's pairing — a task addressed to another pairing is refused. */
  pairingId: string;
  /** This daemon's org — a cross-org-addressed task is refused. */
  org: string;
  /** The shared HMAC secret Cortex signed the binding with (§18.5.1 step 1). */
  signingSecret: string;
  /** Replay cache; checked BEFORE record. */
  nonces: NonceCache;
  /** Per-session grant table; a grant resolves only for the session that owns it. */
  grants: GrantTable;
  /** Injectable clock (tests pin it; production passes `Date.now`). */
  now: () => number;
}

/** Best-effort task id from an unparsed payload, for ledgering a malformed-task denial. */
function rawTaskId(task: unknown): string | undefined {
  if (typeof task === 'object' && task !== null && 'taskId' in task) {
    const id = (task as Record<string, unknown>).taskId;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

/**
 * Run the §18.5.1 ordered sequence. Returns null when the task is accepted, else the first Denial —
 * which is also handed to `sink` (if any) so it can be ledgered. Order:
 *   0. structural parse (boundary)  → 'malformed task'                 (S2)
 *   1. signature                    → 'bad signature'        /signature/
 *   2. this-pairing                 → 'wrong pairing'          /pairing/
 *   3. same-org                     → 'cross-org addressing' /cross-org/
 *   4. expiry in the future         → 'task expired'           /expired/
 *   5. nonce unseen, then RECORD    → 'replayed nonce'          /replay/
 *   6. every grantRef for-session   → 'unknown or foreign-session grant: <ref>'
 *                                                     /foreign-session|unknown/
 */
export function verifyDelegatedTask(
  task: unknown,
  ctx: VerifyContext,
  sink?: DenialSink,
): Denial | null {
  const deny = (reason: string, principle: Denial['principle'], taskId: string | undefined): Denial => {
    // exactOptionalPropertyTypes: omit `taskId` entirely when we could not recover one.
    const denial: Denial = taskId === undefined ? { reason, principle } : { reason, principle, taskId };
    sink?.(denial);
    return denial;
  };

  // 0. Structural boundary parse (§18.3.1: validate at the boundary; a malformed task never
  //    reaches the binding checks). Belt-and-braces even when the frame decoder already validated.
  const parsed = DelegatedTask.safeParse(task);
  if (!parsed.success) return deny('malformed task', 'S2', rawTaskId(task));
  const t = parsed.data;

  // 1. signature over the SHARED canonical binding — reject a forged/tampered task (constant-time).
  if (!verifyDelegatedTaskSig(t, ctx.signingSecret)) return deny('bad signature', 'S2', t.taskId);
  // 2. addressed to THIS pairing — reject a task minted for another pairing.
  if (t.pairingId !== ctx.pairingId) return deny('wrong pairing', 'S2', t.taskId);
  // 3. same org — a task whose org != this daemon's org is refused daemon-side too.
  if (t.org !== ctx.org) return deny('cross-org addressing', 'S2', t.taskId);
  // 4. expiry strictly in the future (harness: `Date.parse(expiry) <= now` → expired).
  if (Date.parse(t.expiry) <= ctx.now()) return deny('task expired', 'S2', t.taskId);
  // 5. nonce unseen; then record it. Recording BEFORE the grant loop matches the harness: a task
  //    that clears replay but fails the grant check still consumes its nonce.
  if (ctx.nonces.has(t.nonce)) return deny('replayed nonce', 'S2', t.taskId);
  ctx.nonces.record(t.nonce);
  // 6. every grantRef resolves to a grant held FOR THIS SESSION (unknown or foreign-session → deny).
  for (const ref of t.grantRefs) {
    if (!ctx.grants.grantFor(ref, t.session)) {
      return deny(`unknown or foreign-session grant: ${ref}`, 'S2', t.taskId);
    }
  }
  return null;
}
