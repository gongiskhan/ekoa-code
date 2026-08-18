/**
 * session/nonces.ts — the replay cache (ch18 §18.5.1 step 5, S2).
 *
 * Every delegated task carries a nonce; the daemon accepts a nonce at most once. The verification
 * order is CHECK-then-RECORD: `has(nonce)` is asked BEFORE `record(nonce)`, so re-presenting the same
 * signed task (a replay) is caught (harness parity — `seenNonces.has` then `.add` in daemon.ts).
 * In-memory Set for the process lifetime; durable replay state across restarts is a later slice.
 */
export class NonceCache {
  private readonly seen = new Set<string>();

  /** True if this nonce has already been recorded (a replay). Asked BEFORE record. */
  has(nonce: string): boolean {
    return this.seen.has(nonce);
  }

  /** Mark a nonce consumed. Called once, AFTER a successful `has` check returned false. */
  record(nonce: string): void {
    this.seen.add(nonce);
  }
}
