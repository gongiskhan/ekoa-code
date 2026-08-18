/**
 * session/egress.ts — per-session raw-byte egress accounting (ch18 §18.5 S5).
 *
 * S5 bounds how much can ever leave a session: the daemon accumulates the RAW byte count of every
 * read (counted BEFORE decode) against the current task's `budget.egressBytes`. Accumulation is PER
 * SESSION and persists ACROSS tasks in that session; the breach check compares accumulated+new
 * against the CURRENT task's budget (harness semantics — daemon.ts lines 137-142:
 * `egressUsed + bytes.length > task.budget.egressBytes`, a STRICT `>` so hitting the budget exactly
 * is allowed). The harness keeps one global counter because it models a single session; the bridge
 * serves many sessions, so the counter is keyed by session here — behaviour per session is identical.
 *
 * State only: this module never reads bytes or ledgers. The tool layer counts bytes and calls
 * `wouldExceed` before emitting, `add` after.
 */
export class EgressAccounting {
  private readonly usedBySession = new Map<string, number>();

  /** Raw bytes already accounted for this session (0 if the session has read nothing yet). */
  used(session: string): number {
    return this.usedBySession.get(session) ?? 0;
  }

  /**
   * Would accounting `bytes` more for `session` breach `budgetBytes`? Strict `>` (harness parity):
   * accumulated+new EQUAL to the budget is allowed; one byte over is not.
   */
  wouldExceed(session: string, bytes: number, budgetBytes: number): boolean {
    return this.used(session) + bytes > budgetBytes;
  }

  /** Add `bytes` to this session's running total (call AFTER a passing `wouldExceed`). */
  add(session: string, bytes: number): void {
    this.usedBySession.set(session, this.used(session) + bytes);
  }
}
