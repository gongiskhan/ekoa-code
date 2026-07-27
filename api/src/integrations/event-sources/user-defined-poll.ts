/**
 * Generic USER-DEFINED event source (2A-S4) — Layer 1, domain-agnostic.
 *
 * The non-platform half of the listener rail. Where `platform-poll.ts` knows how to page Microsoft
 * Graph / Gmail, this module knows nothing about any provider: it reads the paging contract out of
 * the integration PACKAGE's `listenerConfig` (`api/assets/integrations/<key>/config.json`) and runs
 * the poll through the user-defined integration action executor
 * (`integrations/action-executor.ts` — injected as `deps.call` so the composition root binds the
 * trigger's org/owner). Ported from ekoa-dev's `listener-supervisor.pollOnce` non-platform branch.
 *
 * Contract carried from the platform branch (2A-S1, reviewed) — this is the whole point of the
 * slice, so it is spelled out:
 *  - CURSOR ADVANCES ONLY AFTER THE ITEM IS DURABLY ENQUEUED. Every item in the batch is enqueued
 *    first; the cursor is written last and ONLY when every item made it (a UNIQUE duplicate counts
 *    as success — the row is already durable). An item with no extractable dedup key STALLS the
 *    cursor instead of being dropped, so the next tick re-fetches it.
 *  - DETERMINISTIC PER-ITEM DEDUP KEY. The key is the item's own stable id, read from the package's
 *    `dedupKeyField` dot-path and stringified — a pure function of the item, so a retry of the same
 *    poll produces the same key and the queue's UNIQUE(triggerId, dedupKey) dedupes it.
 *  - CANCEL-SAFE. `isCancelled()` is checked after the (awaited) poll call, before every enqueue
 *    and before the cursor write, so a listener stopped mid-tick performs no further work and can
 *    never write a cursor for a trigger that no longer exists.
 *  - NO BACKFILL, PINNED AT INITIALIZATION. The ESTABLISHING poll (no stored state) enqueues
 *    NOTHING and adopts the provider's `cursorField`: connecting a mailbox must not dump its
 *    history into the queue. DEVIATION FROM ekoa-dev, deliberate: the dev version enqueued the
 *    first batch (it had no no-backfill rule on this branch); the platform branch's rule is the one
 *    worth keeping. CRITICALLY, the boundary is the INITIALIZATION, not the first SUCCESSFUL poll —
 *    see `ListenerPhase`. If the establishing poll comes back with no cursor AND no items, the
 *    provider is observably empty, so there is no history to skip: the listener is ARMED
 *    (`initializedAt` persisted) and everything seen from the next tick on is DELIVERED. Pinning
 *    "first" on the first successful poll instead would lose real events: an empty first response
 *    would leave the listener "new", and the next attempt — by then holding a message that arrived
 *    in between — would treat that message as history and silently discard it.
 *
 * The `cursorField` is REQUIRED here. A package whose poll response carries ITEMS but no cursor
 * cannot express "since now" and can only re-fetch its whole history every tick; the establishing
 * tick throws a clear error (nothing delivered, nothing discarded) that the supervisor's backoff
 * absorbs and `bumpFailure` records as an audit row.
 *
 * WHAT THE EXECUTOR CAN RUN: HTTP-backed actions and `automationBinding` actions (the latter only
 * when the composition root injects the automation seam — it does; see server.ts). The shipped
 * `imap` package's poll action is NEITHER: it declares `transport: "imap"`, which the executor
 * refuses with the coded `unsupported_transport` failure, and this tick throws with that message —
 * an IMAP listener fails loudly and visibly, it never no-ops and never fabricates an empty mailbox.
 * The IMAP protocol transport itself is DEFERRED (see docs/decisions.md, 2A-S4).
 *
 * The other shipped listener source, `citius`, polls an automation-backed action, so its response
 * arrives inside the automation run envelope — unwrapped by `pollBody` below. Citius has its own
 * REMAINING blockers, neither of them this rail's: the captured browser session (2A-S6) and the
 * unresolvable `automationBinding.automationId` template placeholder — both named in
 * docs/findings.md and docs/decisions.md rather than left to fail mysteriously.
 *
 * BINDING (this file lives in integrations/event-sources/): may import integrations/ siblings +
 * data/, never apps/, events/ or web/. The injected-dep contract (EnqueueInput / EnqueueResult) is
 * reused from platform-poll.ts so both sources hand the composition root the same enqueue shape.
 */

import { getDefinition, type IntegrationListenerConfig } from '../definitions.js';
import type { EnqueueInput, EnqueueResult } from './platform-poll.js';

/** Minimal trigger shape the generic poller needs (decoupled from events/ TriggerDoc). */
export interface UserDefinedPollTrigger {
  id: string;
  integrationKey: string;
  /** Trigger-level override of `listenerConfig.pollAction` (TriggerDoc.pollConfig.actionName). */
  pollActionName?: string;
}

/** The subset of `ExecuteIntegrationActionResult` this source reads (kept structural so the
 *  module does not depend on the executor's full type surface). */
export interface UserIntegrationCallResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
  code?: string;
}

export interface UserDefinedPollDeps {
  /** The user-defined integration action executor, bound to the trigger's org + owner. */
  call(input: { integrationKey: string; actionName: string; args: Record<string, unknown> }): Promise<UserIntegrationCallResult>;
  readCursor(triggerId: string): Promise<unknown> | unknown;
  writeCursor(triggerId: string, cursor: unknown): Promise<void> | void;
  enqueue(input: EnqueueInput): Promise<EnqueueResult> | EnqueueResult;
  /** Current ISO timestamp (injected so tests are deterministic). Unused by the cursor model —
   *  the cursor is the PROVIDER's, not a clock — kept for parity with PlatformPollDeps. */
  now(): string;
  /** Bail before doing (or persisting) any more work if the listener was cancelled mid-await. */
  isCancelled?(): boolean;
}

export interface UserDefinedPollResult {
  /** False when this tick only initialised the cursor (first poll, no backfill). */
  polled: boolean;
  /** Rows newly inserted (UNIQUE duplicates do not count). */
  enqueued: number;
  /** True when the cursor moved forward. */
  cursorAdvanced: boolean;
  /** True on the first tick: cursor initialised from the provider, history not backfilled. */
  initialized?: boolean;
  /** True when the cursor could NOT advance after a real poll (a missing per-item dedup key, or a
   *  response with items but no `cursorField`). The caller logs it so the stall is observable
   *  rather than silent — same posture as platform-poll's per-tick cap. */
  stalled?: boolean;
  /** Human-readable reason for `stalled` (for the caller's warning line). */
  stallReason?: string;
}

/**
 * Run one poll tick for a user-defined (non-platform) listener trigger. See the module header for
 * the cursor + dedup + cancel contract. Throws on any failure (unknown package, missing/invalid
 * listenerConfig, a failed poll action including the deferred-transport refusal) so the supervisor's
 * per-listener backoff + `bumpFailure` audit absorb it — never a silent no-op.
 */
export async function pollUserDefinedSource(
  trigger: UserDefinedPollTrigger,
  deps: UserDefinedPollDeps,
): Promise<UserDefinedPollResult> {
  const cfg = resolveListenerConfig(trigger.integrationKey);
  const actionName = trigger.pollActionName || cfg.pollAction;

  const state = parseStoredCursor(await deps.readCursor(trigger.id), trigger.integrationKey);

  const result = await deps.call({
    integrationKey: trigger.integrationKey,
    actionName,
    // `since` only exists once a provider cursor has been established. The establishing poll (and
    // any retry of it while the listener is ARMED) asks for the provider's current window.
    args: state.phase === 'active' ? { since: state.cursor } : {},
  });
  // The trigger may have been deleted/disabled while the poll was in flight: bail before writing
  // any state (or enqueuing anything) for a listener that no longer exists.
  if (deps.isCancelled?.()) return { polled: true, enqueued: 0, cursorAdvanced: false };
  if (!result.success) {
    throw new Error(
      `poll action "${actionName}" on ${trigger.integrationKey} failed${result.code ? ` (${result.code})` : ''}: ${result.error ?? 'unknown'}`,
    );
  }

  const body = pollBody(result.data);
  const nextCursor = scalarCursor(readPath(body, cfg.cursorField));
  const items = asArray(readPath(body, cfg.eventArrayField));

  if (state.phase === 'new') {
    // ESTABLISHING POLL — the no-backfill boundary. Three outcomes, and NONE of them may lose an
    // event that arrives later (the bug this shape exists to prevent):
    //  1. a cursor came back  -> adopt it, enqueue nothing. The items seen here are the provider's
    //     PRE-EXISTING history; connecting a mailbox must not dump it into the queue.
    //  2. no cursor AND no items -> the provider is empty right now, so there is no history to
    //     skip and nothing has been discarded. ARM the listener (persist `initializedAt`) and from
    //     the next tick on deliver everything, because everything seen after an observably-empty
    //     provider is genuinely new. THIS is what pins the boundary at initialization rather than
    //     at the first SUCCESSFUL cursor: a failed/cursorless first attempt can no longer swallow
    //     the messages that arrive before the next one.
    //  3. no cursor BUT items -> the package's cursorField does not match the provider's response,
    //     so the listener can never track progress. Throw. Nothing is delivered and nothing is
    //     discarded (the items stay at the provider), so nothing is lost — the operator sees a
    //     failing listener naming the exact field.
    if (nextCursor != null) {
      await deps.writeCursor(trigger.id, nextCursor);
      return { polled: false, enqueued: 0, cursorAdvanced: true, initialized: true };
    }
    if (items.length > 0) {
      throw new Error(
        `first poll of "${trigger.integrationKey}" returned ${items.length} item(s) but no "${cfg.cursorField}" — the listener cannot track a cursor, so it refuses to start rather than re-deliver the whole history every tick`,
      );
    }
    await deps.writeCursor(trigger.id, { initializedAt: deps.now(), cursor: null });
    return {
      polled: false,
      enqueued: 0,
      cursorAdvanced: false,
      initialized: true,
      stalled: true,
      stallReason: `the provider returned no "${cfg.cursorField}" yet; the listener is armed and will deliver everything it sees from now on`,
    };
  }

  // ARMED (initialized, no provider cursor yet) or ACTIVE: every item is delivered. In the ARMED
  // phase that is CORRECT rather than a backfill — the establishing poll observed the provider
  // EMPTY, so anything visible now arrived afterwards.
  const cursor = state.phase === 'active' ? state.cursor : null;
  let allEnqueued = true;
  let enqueued = 0;
  for (const item of items) {
    if (deps.isCancelled?.()) return { polled: true, enqueued, cursorAdvanced: false };
    const dedupKey = stringifyDedup(readPath(item, cfg.dedupKeyField));
    if (!dedupKey) {
      // No extractable id ⇒ the queue could not dedupe it and the cursor must NOT advance past it.
      // Stall (the next tick re-fetches) rather than drop it silently.
      allEnqueued = false;
      continue;
    }
    const r = await deps.enqueue({
      triggerId: trigger.id,
      dedupKey,
      rawBody: Buffer.from(JSON.stringify(item), 'utf8'),
      headers: {
        'content-type': 'application/json',
        'x-ekoa-source': 'listener',
        'x-ekoa-provider': trigger.integrationKey,
      },
      source: 'listener',
    });
    if (r.kind === 'inserted') enqueued += 1;
  }

  if (deps.isCancelled?.()) return { polled: true, enqueued, cursorAdvanced: false };

  // CURSOR LAST: every item above is already durable, so advancing here can only ever re-deliver
  // (deduped), never skip.
  if (!allEnqueued) {
    return { polled: true, enqueued, cursorAdvanced: false, stalled: true, stallReason: 'an item had no extractable dedup key' };
  }
  if (nextCursor == null) {
    return {
      polled: true,
      enqueued,
      cursorAdvanced: false,
      stalled: true,
      stallReason: `the poll response carried no "${cfg.cursorField}" cursor`,
    };
  }
  if (nextCursor === cursor) return { polled: true, enqueued, cursorAdvanced: false };
  await deps.writeCursor(trigger.id, nextCursor);
  return { polled: true, enqueued, cursorAdvanced: true };
}

/** Read + validate the integration package's listenerConfig. Throws with a specific message for
 *  each failure mode so the audit row says WHY the listener cannot poll. */
function resolveListenerConfig(integrationKey: string): IntegrationListenerConfig {
  const def = getDefinition(integrationKey);
  if (!def) throw new Error(`integration "${integrationKey}" has no installed package — the listener cannot poll`);
  const cfg = def.listenerConfig;
  if (!cfg) throw new Error(`integration "${integrationKey}" has no listenerConfig — it is not a pollable listener source`);
  const missing = (['pollAction', 'cursorField', 'eventArrayField', 'dedupKeyField'] as const).filter((k) => !cfg[k]);
  if (missing.length > 0) {
    throw new Error(`listenerConfig for "${integrationKey}" is incomplete (missing: ${missing.join(', ')})`);
  }
  return cfg;
}

/**
 * The three listener phases, derived from the persisted cursor:
 *  - `new`     — nothing persisted yet: the next poll is the ESTABLISHING one (no backfill).
 *  - `armed`   — an establishing poll observed the provider EMPTY but got no cursor. The listener
 *                is initialised (`initializedAt` pins the no-backfill boundary at that moment) and
 *                every item seen from now on is genuinely new, so it is DELIVERED.
 *  - `active`  — a provider cursor is established; polls are incremental (`since`).
 * A plain scalar persists the `active` phase (identical to the platform branch's cursor, and to
 * whatever a pre-2A-S4 row held); the marker object persists `armed`.
 */
type ListenerPhase =
  | { phase: 'new' }
  | { phase: 'armed'; initializedAt: string }
  | { phase: 'active'; cursor: string };

function parseStoredCursor(stored: unknown, integrationKey: string): ListenerPhase {
  if (stored == null) return { phase: 'new' };
  if (typeof stored === 'object') {
    const o = stored as { initializedAt?: unknown; cursor?: unknown };
    const active = scalarCursor(o.cursor);
    if (active != null) return { phase: 'active', cursor: active };
    if (typeof o.initializedAt === 'string') return { phase: 'armed', initializedAt: o.initializedAt };
    // An unrecognised object cannot be handed back as `since`, and treating it as "never polled"
    // would re-run the establishing poll and silently discard a window. Refuse loudly.
    throw new Error(
      `listener cursor for "${integrationKey}" is an unrecognised object — the user-defined poll cannot resume from it`,
    );
  }
  const cursor = scalarCursor(stored);
  if (cursor == null) {
    throw new Error(
      `listener cursor for "${integrationKey}" is not a usable scalar (${typeof stored}) — the user-defined poll cannot resume from it`,
    );
  }
  return { phase: 'active', cursor };
}

/**
 * The action's RETURN VALUE, which the package's `listenerConfig` field paths are written against.
 *
 * An HTTP-backed action returns the parsed response body directly. An `automationBinding` action
 * (citius' `consultar_notificacoes` is one) runs through the automation engine, whose result
 * contract wraps the action's own output in a run envelope `{ runId, status, summary, output }`
 * (automation/service.ts runAutomationForAction). Without this unwrap the package's paths would
 * resolve against the envelope, `eventArrayField` would read `undefined`, and the tick would look
 * like a quiet provider forever — the silent-empty failure mode this module exists to avoid. The
 * shape test is deliberately narrow (a run envelope has BOTH a string runId and a string status)
 * so a provider body that merely happens to have an `output` key is never unwrapped.
 */
function pollBody(data: unknown): unknown {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const o = data as { runId?: unknown; status?: unknown; output?: unknown };
    if (typeof o.runId === 'string' && typeof o.status === 'string' && 'output' in o) return o.output;
  }
  return data;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** A cursor must be a scalar the provider accepts back as `since`. Objects/arrays are rejected. */
function scalarCursor(v: unknown): string | null {
  if (typeof v === 'string') return v.length > 0 ? v : null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return String(v);
  return null;
}

// ---------------------------------------------------------------------------
// Local path/dedup helpers — deliberately duplicated from platform-poll.ts (both files keep their
// own copies so neither source depends on the other's internals).
// ---------------------------------------------------------------------------

function readPath(root: unknown, path: string): unknown {
  if (!path) return root;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function stringifyDedup(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') return null; // an object id would stringify to "[object Object]"
  const s = String(v);
  return s.length > 0 ? s : null;
}
