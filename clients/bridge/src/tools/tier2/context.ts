/**
 * tools/tier2/context.ts — the Tier-2 (automation) execution context + enablement + error type.
 *
 * ADR-002: Tier-2 (bash, Playwright) is EXFILTRATION-CAPABLE by nature — a shell can curl, a browser
 * can POST — so the containment resolver cannot contain it and S5 does not hold inside the tier. It is
 * therefore structurally separated from the file tier: a DIFFERENT context (this one, NOT the file
 * tools' ToolContext), a DIFFERENT registry (tier2Registry, never merged with the Tier-1 vocabulary),
 * and an explicit PER-SESSION ENABLEMENT that is OFF BY DEFAULT. A Tier-2 tool refuses (ledgered)
 * unless its session was explicitly enabled by a user action. This tier is BUILD-ONLY this run: it is
 * excluded from the custody map, the trust chip, and every claim (the publish gate blocks it entirely).
 */
import type { EgressLedger } from '../../ledger/index.js';

/** Per-session automation enablement — OFF by default, non-persistent, opt-in per session. */
export class AutomationEnablement {
  private readonly enabled = new Set<string>();

  /** Enable the automation tier for one session (an explicit user action, with plain PT-PT copy). */
  enable(session: string): void {
    this.enabled.add(session);
  }

  disable(session: string): void {
    this.enabled.delete(session);
  }

  isEnabled(session: string): boolean {
    return this.enabled.has(session);
  }
}

export interface Tier2Context {
  ledger: EgressLedger;
  enablement: AutomationEnablement;
  session: string;
  taskId?: string;
  now?: () => number;
}

/** A Tier-2 refusal. `reason` is a stable code (`disabled` | `timeout` | `error`). */
export class Tier2Error extends Error {
  constructor(
    message: string,
    public readonly reason: 'disabled' | 'timeout' | 'error',
  ) {
    super(message);
    this.name = 'Tier2Error';
  }
}

/** Ledger one automation invocation (§ADR-002: EVERY invocation ledgered with its full detail). */
export function ledgerAutomation(
  ctx: Tier2Context,
  tool: 'bash' | 'browser',
  detail: string,
  outcome: 'ran' | 'denied' | 'timeout' | 'error',
  exitCode?: number,
  reason?: string,
): void {
  ctx.ledger.append({
    kind: 'automation',
    ts: new Date(ctx.now ? ctx.now() : Date.now()).toISOString(),
    session: ctx.session,
    ...(ctx.taskId !== undefined ? { taskId: ctx.taskId } : {}),
    tool,
    detail,
    outcome,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(reason !== undefined ? { reason } : {}),
  });
}
