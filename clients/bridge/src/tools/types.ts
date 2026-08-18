/**
 * tools/types.ts — the shared context, error, and emission primitive every Tier-1 file tool builds
 * on (ch18 §18.5 S1/S5; parity source `ekoa-code/api/test/fake-daemon/daemon.ts` `read`).
 *
 * The load-bearing invariant is the SINGLE emission path: every tool that lets bytes leave the
 * machine — read, and the derived-content tools list/glob/grep/stat — funnels through `emit`, which
 * does the one ordered dance the harness fixes:
 *     count raw bytes → egress cap check vs the task budget → sha256 → append ONE ledger row → return.
 * A tool NEVER writes an egress ledger row by hand and NEVER checks the cap itself; doing the
 * accounting anywhere but here is how a leak slips past S5. Writes are inbound, not emissions, so
 * they do NOT go through `emit` (they never count against egress) — see write.ts.
 *
 * Path resolution is likewise centralised: `resolveInGrant` is the ONLY door from a (grantRef,
 * relPath) pair to a real filesystem path, and it goes exclusively through the containment resolver
 * (eslint bans realpath in this module — the resolver stays the sole path authority, S1). Any
 * containment or cap failure is ledgered as a denial AND thrown as a `ToolError`; the engine maps a
 * thrown `ToolError` to the delegation result status ('egress cap reached'/S5 → `cap_reached`, an S1
 * containment refusal → `denied`).
 */
import { createHash } from 'node:crypto';
import {
  resolveWithinGrantDetailed,
  relativeToRealRoot,
  ContainmentError,
} from '../containment/index.js';
import type { GrantTable, Grant, EgressAccounting } from '../session/index.js';
import type {
  EgressLedger,
  ReadLedgerRow,
  DenialLedgerRow,
} from '../ledger/index.js';

/**
 * Everything a tool needs, with the fs boundary already resolved to owning modules: the per-session
 * grant table, the per-session egress accountant, the append-only ledger, the identity of the task
 * this call serves (session/taskId/correlationId — the ledger join keys), the task's egress budget,
 * and an optional injectable clock (tests pin it; production omits it → Date.now).
 */
export interface ToolContext {
  grantTable: GrantTable;
  egress: EgressAccounting;
  ledger: EgressLedger;
  session: string;
  taskId: string;
  correlationId: string;
  budgetBytes: number;
  now?: () => number;
}

/**
 * A tool-layer refusal. `principle` is deliberately narrowed to the two the tool layer can raise:
 * S1 (a containment / path / write-integrity refusal) and S5 (the egress cap). The S2 binding checks
 * happen in the verify layer BEFORE any tool runs; by the time a tool executes the grant already
 * belongs to the session, so a grant the tool cannot resolve is treated as an S1 containment failure.
 */
export class ToolError extends Error {
  constructor(
    public readonly reason: string,
    public readonly principle: 'S1' | 'S5',
  ) {
    super(reason);
    this.name = 'ToolError';
  }
}

/** ISO timestamp for a ledger row, honouring the injectable clock (harness parity: `new Date(now)`). */
export function nowIso(ctx: ToolContext): string {
  return new Date(ctx.now ? ctx.now() : Date.now()).toISOString();
}

/**
 * Ledger a denial and throw. The single rejection exit for the tool layer: every containment and cap
 * refusal lands here so no rejection path can skip its ledger row (§18.5.1 "never skip ledgering on
 * any rejection path"). Returns `never` so callers narrow correctly after it.
 */
export function denyAndThrow(
  ctx: ToolContext,
  reason: string,
  principle: 'S1' | 'S5',
  tool: string,
): never {
  const row: DenialLedgerRow = {
    kind: 'denial',
    ts: nowIso(ctx),
    session: ctx.session,
    taskId: ctx.taskId,
    reason,
    principle,
    tool,
  };
  // Ledger the denial, but a refusal must ALWAYS surface as a clean ToolError the engine can classify
  // — never a raw fs error escaping. If the ledger append itself fails (e.g. an infrastructure fault),
  // the denial is still raised; the ledger fault is not swallowed silently but re-thrown as a ToolError
  // carrying the original reason, so the daemon refuses cleanly instead of crashing.
  try {
    ctx.ledger.append(row);
  } catch {
    /* ledger write failed — still refuse cleanly below rather than leak a raw error */
  }
  throw new ToolError(reason, principle);
}

/**
 * Run a filesystem operation on a resolver-approved path, converting a raw fs error into a LEDGERED
 * ToolError (§18.5.1 "never skip ledgering on any rejection path"). The S1-hardened resolver
 * deliberately admits a not-yet-existing leaf (write-back support), so a read/stat/list of a missing
 * or wrong-kind path passes containment and then the fs call throws ENOENT/EISDIR/ENOTDIR — an error
 * the engine's ToolError contract cannot classify and that would otherwise crash the serving daemon
 * un-ledgered. This funnels every such error through denyAndThrow (S1), so the rejection is typed and
 * audited.
 */
export function fsGuard<T>(ctx: ToolContext, tool: string, op: () => T): T {
  try {
    return op();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const reason =
      code === 'ENOENT'
        ? 'file not found'
        : code === 'EISDIR'
          ? 'expected a file but found a directory'
          : code === 'ENOTDIR'
            ? 'expected a directory but found a file'
            : code === 'EACCES' || code === 'EPERM'
              ? 'permission denied'
              : `filesystem error${code ? `: ${code}` : ''}`;
    denyAndThrow(ctx, reason, 'S1', tool); // ledgers + throws a ToolError; never returns
  }
}

/** What a resolved (grantRef, relPath) yields: the grant, the safe real path, and the ledger-form
 *  path (relative to the REAL root, so a symlinked root never produces spurious `../` in rows). */
export interface Resolved {
  grant: Grant;
  real: string;
  ledgerPath: string;
}

/**
 * THE door from a (grantRef, relPath) pair to a real path — every tool calls this and nothing else to
 * reach the filesystem. Resolves the grant for THIS session, then the path through the containment
 * resolver. An unknown grant or a path that escapes the grant is denied (S1) + ledgered + thrown.
 */
export function resolveInGrant(
  ctx: ToolContext,
  grantRef: string,
  relPath: string,
  tool: string,
): Resolved {
  const grant = ctx.grantTable.grantFor(grantRef, ctx.session);
  if (!grant) denyAndThrow(ctx, `unknown grant: ${grantRef}`, 'S1', tool);
  let real: string;
  let realRoot: string;
  try {
    ({ real, realRoot } = resolveWithinGrantDetailed(grant.root, relPath));
  } catch (err) {
    denyAndThrow(
      ctx,
      err instanceof ContainmentError ? err.reason : 'containment error',
      'S1',
      tool,
    );
  }
  // Pass the real root the resolver already computed, so the ledger path is formed without a second
  // realpath syscall per tool call (the review's redundant-realpath finding).
  return { grant, real, ledgerPath: relativeToRealRoot(grant.root, real, realRoot) };
}

/** The outcome of an emission: the raw bytes that left and their sha256 (also on the ledger row). */
export interface Emission {
  bytesOut: number;
  sha256: string;
}

/**
 * THE emission primitive (§18.5 S5/S6). Given the raw bytes a tool is about to emit, in order:
 *   1. count the RAW bytes (`emit` is always handed the bytes BEFORE any utf8 decode);
 *   2. cap check against the task budget over accumulated per-session usage (strict `>`, harness
 *      parity) — a breach is denied 'egress cap reached' (S5) + ledgered + thrown BEFORE any bytes
 *      are accounted or any row is written;
 *   3. accumulate the bytes for the session;
 *   4. sha256 the emitted bytes;
 *   5. append exactly ONE read/egress ledger row (kind 'read' is the wire egress-row discriminant;
 *      `tool` names which tool — read/list/glob/grep/stat — produced it).
 */
export function emit(
  ctx: ToolContext,
  tool: string,
  ledgerPath: string,
  byteRange: string,
  bytes: Buffer,
): Emission {
  const bytesOut = bytes.length;
  if (ctx.egress.wouldExceed(ctx.session, bytesOut, ctx.budgetBytes)) {
    denyAndThrow(ctx, 'egress cap reached', 'S5', tool);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const row: ReadLedgerRow = {
    kind: 'read',
    ts: nowIso(ctx),
    session: ctx.session,
    taskId: ctx.taskId,
    correlationId: ctx.correlationId,
    path: ledgerPath,
    byteRange,
    bytesOut,
    sha256,
    tool,
  };
  // Append the ledger row BEFORE accounting the bytes, so a failed ledger write cannot consume the
  // egress budget with no row to show for it (the review's "budget consumed with no row" finding).
  ctx.ledger.append(row);
  ctx.egress.add(ctx.session, bytesOut);
  return { bytesOut, sha256 };
}
