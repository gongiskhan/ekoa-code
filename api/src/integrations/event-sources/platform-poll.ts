/**
 * Generic platform event source (2A-S1) — Layer 1, domain-agnostic.
 *
 * Polls a connected PLATFORM integration (Microsoft 365 / Google Workspace) for new items and
 * turns each into a durable event in the shared event queue. Ported from ekoa-dev
 * (cortex/src/services/event-sources/platform-poll.ts); the ONE structural change for ekoa-code is
 * that the injected store deps (`readCursor` / `writeCursor` / `enqueue`) are ASYNC (Firestore/Mongo
 * `Store<Doc>` calls) rather than synchronous SQLite — the cursor + dedup + advance CONTRACT is
 * unchanged.
 *
 * Why this exists: the user-defined listener path interpolates only STATIC decrypted credentials —
 * it has no OAuth refresh, so it cannot drive M365. `callPlatformIntegration` already performs the
 * global Microsoft/Google OAuth refresh+persist in core, so routing platform polls through it (via
 * the injected `call`) lets a hosted listener watch a mailbox without the listener (or any artifact)
 * ever touching a token.
 *
 * Domain boundary: this file knows how to PAGE a provider — which list action, which array field,
 * which id field dedupes, which timestamp drives the high-water cursor. It knows NOTHING about what
 * the items mean; that lives in the consuming artifact backend.
 *
 * Cursor model: high-water mark on the provider's item timestamp (`receivedDateTime` for M365 mail),
 * queried with `ge {cursor}` ascending. The `ge` is inclusive so the boundary item is re-fetched
 * each poll; the queue's UNIQUE(trigger, dedupKey) dedups it. The cursor advances ONLY after every
 * item in the batch was enqueued (a UNIQUE duplicate counts as success; a missing dedup key stalls
 * the cursor so the item is retried rather than silently dropped).
 *
 * BINDING (this module lives in integrations/event-sources/): provider-specific, may import
 * integrations/ siblings + data/, never apps/ or web/. The injected-dep contract (EnqueueInput /
 * EnqueueResult) is defined here so the source stays decoupled from events/ — the composition root
 * bridges these to the real event queue.
 */

export type PlatformProvider = 'microsoft-365' | 'google-workspace';

export function isPlatformProvider(key: string): key is PlatformProvider {
  return key === 'microsoft-365' || key === 'google-workspace';
}

/** Minimal trigger shape the poller needs (decoupled from events/ TriggerDoc). */
export interface PollTrigger {
  id: string;
  integrationKey: string;
}

/** Enqueue contract for a polled item — bridged to the real event queue by the composition root.
 *  Mirrors the durable queue's insert shape; `source` is always 'listener' here. */
export interface EnqueueInput {
  triggerId: string;
  dedupKey: string;
  rawBody: Buffer;
  headers: Record<string, string>;
  source: 'listener';
}

export type EnqueueResult = { kind: 'inserted' } | { kind: 'duplicate' };

/** Pagination within a single tick — provider-specific. */
export type PlatformPaging =
  | { mode: 'skip' }
  | { mode: 'pageToken'; nextPageTokenField: string; pageTokenArg: string };

/** A page request: numeric offset (skip) OR an opaque continuation token. */
export interface PageRequest { skip?: number; pageToken?: string }

/** How to page one platform provider's event stream. Pure configuration. */
export interface PlatformListenerConfig {
  /** Action in the integration's config.json that lists items (e.g. `list_emails`). */
  pollAction: string;
  /** Dot-path, relative to `callPlatformIntegration`'s `result.data`, to the item array. */
  eventArrayField: string;
  /** Dot-path, relative to one item, to its stable id (the dedup key). */
  dedupKeyField: string;
  /**
   * Cursor model:
   *   'item-high-water' (M365): each item carries a timestamp (`cursorField`); the cursor advances
   *     to the MAX item timestamp; query `>= cursor` ascending.
   *   'poll-time' (Gmail): list items carry NO timestamp, so the cursor is the last poll's START
   *     time (epoch seconds); query `after:<cursor>`; the cursor advances to THIS poll's start time
   *     on full success. Dedup by id covers the inclusive 1-second boundary overlap.
   */
  cursorStrategy: 'item-high-water' | 'poll-time';
  /** Dot-path to the per-item timestamp (item-high-water only; '' for poll-time). */
  cursorField: string;
  /** Page size per request. */
  top: number;
  /** Pagination strategy within a tick. */
  paging: PlatformPaging;
  /**
   * User-subscribable events this source exposes (for the trigger picker). The `name` is stored as
   * the trigger's `eventName` (a label); the actual polling uses `pollAction`.
   */
  events: ReadonlyArray<{ name: string; labelPt: string }>;
  /** Build the list-action args that fetch "since {cursor}", oldest-first, at the given page. */
  buildQueryArgs(cursor: string, top: number, page?: PageRequest): Record<string, unknown>;
}

/**
 * Safety cap on how many items one tick will page through. Bounds the in-tick `$skip` loop so a
 * pathological mailbox cannot make a single tick run forever; if hit, the tick reports `stalled` so
 * the stall is observable, not silent.
 */
const MAX_ITEMS_PER_TICK = 500;

/**
 * Microsoft 365 mailbox source. Uses Graph `/me/messages` (the `list_emails` action) with OData
 * `$filter`/`$orderby`/`$top`. NOTE: those `$`-prefixed params only interpolate after the
 * http-template interpolation fix (it must match `{{$top}}`, not just `{{word}}`) — already present
 * in ekoa-code's http-template.ts, regression-guarded by odata-interpolation.test.ts.
 */
const M365_EMAIL: PlatformListenerConfig = {
  pollAction: 'list_emails',
  eventArrayField: 'value',
  dedupKeyField: 'id',
  cursorStrategy: 'item-high-water',
  cursorField: 'receivedDateTime',
  top: 100,
  paging: { mode: 'skip' },
  events: [{ name: 'email.received', labelPt: 'Quando chega um email novo' }],
  buildQueryArgs: (cursor, top, page) => ({
    $filter: `receivedDateTime ge ${cursor}`,
    $orderby: 'receivedDateTime asc',
    $top: String(top),
    ...(page?.skip ? { $skip: String(page.skip) } : {}),
  }),
};

/**
 * Gmail mailbox source. Gmail's messages.list returns IDs only (no per-item timestamp) and pages
 * with an opaque nextPageToken — so it uses the poll-time cursor (epoch seconds) with
 * `q=after:<cursor>` and pageToken paging, NOT the M365 per-item-high-water + $skip model.
 */
const GMAIL_EMAIL: PlatformListenerConfig = {
  pollAction: 'list_emails',
  eventArrayField: 'messages',
  dedupKeyField: 'id',
  cursorStrategy: 'poll-time',
  cursorField: '',
  top: 100,
  paging: { mode: 'pageToken', nextPageTokenField: 'nextPageToken', pageTokenArg: 'pageToken' },
  events: [{ name: 'email.received', labelPt: 'Quando chega um email novo' }],
  // cursor is epoch-SECONDS as a string; Gmail `after:` takes integer seconds (inclusive).
  buildQueryArgs: (cursor, top, page) => ({
    q: `after:${cursor}`,
    maxResults: String(top),
    ...(page?.pageToken ? { pageToken: page.pageToken } : {}),
  }),
};

/** Listener config for a platform provider, or null when the provider has no supported poll source. */
export function platformListenerConfig(key: string): PlatformListenerConfig | null {
  if (key === 'microsoft-365') return M365_EMAIL;
  if (key === 'google-workspace') return GMAIL_EMAIL;
  return null;
}

/** Result shape returned by `callPlatformIntegration` (the subset we read). */
export interface PlatformCallResult {
  success: boolean;
  status?: number;
  data?: unknown;
  error?: string;
}

/**
 * Dependencies injected into a single poll tick. The supervisor wires the real
 * `callPlatformIntegration` + event-queue/listener-state functions; tests inject stubs + the real
 * async stores so the enqueue / cursor-advance behaviour is exercised for real.
 */
export interface PlatformPollDeps {
  call(args: Record<string, unknown>): Promise<PlatformCallResult>;
  readCursor(triggerId: string): Promise<unknown> | unknown;
  writeCursor(triggerId: string, cursor: unknown): Promise<void> | void;
  enqueue(input: EnqueueInput): Promise<EnqueueResult> | EnqueueResult;
  /** Current ISO timestamp (injected so tests are deterministic). */
  now(): string;
  /** Bail before writing any state if the listener was cancelled mid-await. */
  isCancelled?(): boolean;
}

export interface PlatformPollResult {
  /** False when this tick only initialised the cursor (first poll, no backfill). */
  polled: boolean;
  /** Number of rows newly inserted (UNIQUE duplicates do not count). */
  enqueued: number;
  /** True when the high-water cursor moved forward. */
  cursorAdvanced: boolean;
  /** True on the first tick: cursor initialised to "now", history not backfilled. */
  initialized?: boolean;
  /** Pages fetched this tick (in-tick `$skip` paging). */
  pages?: number;
  /**
   * True when the per-tick item cap was hit before the page ran out — a sign of a pathological
   * burst (e.g. >cap messages sharing the cursor timestamp). The caller logs this so the stall is
   * observable rather than silent.
   */
  stalled?: boolean;
}

/**
 * Run one poll tick for a platform-backed listener trigger. See the module header for the cursor +
 * dedup contract.
 *
 * First poll (no stored cursor): set the high-water mark to NOW and return without enqueuing — we
 * deliberately do not backfill the whole mailbox.
 */
export async function pollPlatformSource(
  trigger: PollTrigger,
  deps: PlatformPollDeps,
): Promise<PlatformPollResult> {
  const cfg = platformListenerConfig(trigger.integrationKey);
  if (!cfg) {
    throw new Error(`integration "${trigger.integrationKey}" is not a supported platform poll source`);
  }
  return cfg.cursorStrategy === 'poll-time'
    ? pollPollTime(trigger, cfg, deps)
    : pollItemHighWater(trigger, cfg, deps);
}

/**
 * Item-high-water strategy (Microsoft 365): each item carries a timestamp; the cursor advances to
 * the MAX item timestamp; query `>= cursor` ascending with `$skip` paging. First poll sets the
 * high-water to NOW (no backfill).
 */
async function pollItemHighWater(
  trigger: PollTrigger,
  cfg: PlatformListenerConfig,
  deps: PlatformPollDeps,
): Promise<PlatformPollResult> {
  const stored = await deps.readCursor(trigger.id);
  if (stored == null) {
    await deps.writeCursor(trigger.id, deps.now());
    return { polled: false, enqueued: 0, cursorAdvanced: true, initialized: true };
  }
  // The persisted cursor is either a plain ISO timestamp string OR, while a larger-than-one-tick
  // same-timestamp burst is being drained, a continuation `{ ts, skip, maxSeen }` so the NEXT tick
  // RESUMES paging from where the cap stopped (rather than restarting at skip=0 and starving
  // messages beyond it).
  const { ts: startTs, skip: startSkip, maxSeen } = parseCursor(stored);

  let allEnqueued = true;
  // Seed the high-water from the continuation's carried max, NOT startTs: a burst newer than the
  // query base must still advance the cursor once it's drained.
  let maxCursorMs = Date.parse(maxSeen);
  let maxCursorStr = maxSeen;
  let enqueued = 0;
  let skip = startSkip;
  let pages = 0;
  let stalled = false;

  for (;;) {
    const result = await deps.call({
      integrationKey: trigger.integrationKey,
      actionName: cfg.pollAction,
      args: cfg.buildQueryArgs(startTs, cfg.top, { skip }),
    });
    if (deps.isCancelled?.()) return { polled: true, enqueued, cursorAdvanced: false, pages };
    if (!result.success) throw pollError(result);
    const items = asArray(readPath(result.data, cfg.eventArrayField));
    pages += 1;

    for (const item of items) {
      const { hadId, inserted } = await enqueueItem(deps, trigger, cfg, item);
      if (!hadId) { allEnqueued = false; continue; }
      if (inserted) enqueued += 1;
      const ts = readPath(item, cfg.cursorField);
      if (typeof ts === 'string') {
        const ms = Date.parse(ts);
        if (!Number.isNaN(ms) && ms > maxCursorMs) { maxCursorMs = ms; maxCursorStr = ts; }
      }
    }

    if (items.length < cfg.top) break;
    skip += cfg.top;
    if (pages * cfg.top >= MAX_ITEMS_PER_TICK) { stalled = true; break; }
  }

  if (deps.isCancelled?.()) return { polled: true, enqueued, cursorAdvanced: false, pages };

  let cursorAdvanced = false;
  if (allEnqueued) {
    if (stalled) {
      await deps.writeCursor(trigger.id, { ts: startTs, skip, maxSeen: maxCursorStr });
    } else if (maxCursorStr !== startTs) {
      await deps.writeCursor(trigger.id, maxCursorStr);
      cursorAdvanced = true;
    } else if (startSkip > 0) {
      await deps.writeCursor(trigger.id, startTs);
    }
  }
  return { polled: true, enqueued, cursorAdvanced, pages, stalled };
}

/**
 * Poll-time strategy (Gmail): list items carry no timestamp, so the cursor is the last poll's START
 * time (epoch seconds). Query `after:<cursor>`, dedup by id, page via nextPageToken, and on full
 * success advance the cursor to THIS poll's start time (captured BEFORE the queries, so messages
 * arriving mid-tick are caught by the next tick's window; the inclusive boundary + dedup handle
 * overlap).
 */
async function pollPollTime(
  trigger: PollTrigger,
  cfg: PlatformListenerConfig,
  deps: PlatformPollDeps,
): Promise<PlatformPollResult> {
  const pollStartSec = String(Math.floor(Date.parse(deps.now()) / 1000));
  const stored = await deps.readCursor(trigger.id);
  if (stored == null) {
    // Start watching from now (epoch seconds); no historical backfill.
    await deps.writeCursor(trigger.id, pollStartSec);
    return { polled: false, enqueued: 0, cursorAdvanced: true, initialized: true };
  }
  const { epochSec: baseCursor, pageToken: startPageToken, boundSec: carriedBound } = parsePollTimeCursor(stored);
  // The advance target is the bound captured WHEN the (possibly-multi-tick) drain STARTED — not
  // this resuming tick's fresh pollStartSec. The pageToken stream is the `after:baseCursor` result
  // as of that earlier tick, so it does NOT contain messages that arrived after `carriedBound`;
  // advancing to the newer pollStartSec would skip them. A fresh (non-continuation) tick uses this
  // tick's pollStartSec.
  const advanceTo = carriedBound ?? pollStartSec;

  let allEnqueued = true;
  let enqueued = 0;
  let pages = 0;
  let stalled = false;
  let pageToken = startPageToken;

  for (;;) {
    const result = await deps.call({
      integrationKey: trigger.integrationKey,
      actionName: cfg.pollAction,
      args: cfg.buildQueryArgs(baseCursor, cfg.top, pageToken ? { pageToken } : undefined),
    });
    if (deps.isCancelled?.()) return { polled: true, enqueued, cursorAdvanced: false, pages };
    if (!result.success) throw pollError(result);
    const items = asArray(readPath(result.data, cfg.eventArrayField));
    pages += 1;

    for (const item of items) {
      const { hadId, inserted } = await enqueueItem(deps, trigger, cfg, item);
      if (!hadId) { allEnqueued = false; continue; }
      if (inserted) enqueued += 1;
    }

    const next = cfg.paging.mode === 'pageToken' ? readPath(result.data, cfg.paging.nextPageTokenField) : undefined;
    pageToken = typeof next === 'string' && next.length > 0 ? next : undefined;
    if (!pageToken || items.length === 0) break;            // last page
    if (pages * cfg.top >= MAX_ITEMS_PER_TICK) { stalled = true; break; } // cap, more pages remain
  }

  if (deps.isCancelled?.()) return { polled: true, enqueued, cursorAdvanced: false, pages };

  let cursorAdvanced = false;
  if (allEnqueued) {
    if (stalled && pageToken) {
      // Resume mid-pagination next tick at the SAME base, carrying the SAME bound so the eventual
      // advance never jumps past messages not in this stream.
      await deps.writeCursor(trigger.id, { epochSec: baseCursor, pageToken, boundSec: advanceTo });
    } else {
      // Fully drained → advance to the bound captured when this drain started.
      await deps.writeCursor(trigger.id, advanceTo);
      cursorAdvanced = advanceTo !== baseCursor;
    }
  }
  return { polled: true, enqueued, cursorAdvanced, pages, stalled };
}

function pollError(result: PlatformCallResult): Error {
  return new Error(`platform poll failed${result.status ? ` (${result.status})` : ''}: ${result.error ?? 'unknown'}`);
}

/** Enqueue one polled item; returns whether it had an id and whether it was newly inserted. */
async function enqueueItem(
  deps: PlatformPollDeps,
  trigger: PollTrigger,
  cfg: PlatformListenerConfig,
  item: unknown,
): Promise<{ hadId: boolean; inserted: boolean }> {
  const dedupKey = stringifyDedup(readPath(item, cfg.dedupKeyField));
  if (!dedupKey) return { hadId: false, inserted: false }; // no id ⇒ caller stalls the cursor
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
  return { hadId: true, inserted: r.kind === 'inserted' };
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * Parse an item-high-water cursor: a plain ISO string, or a `{ts, skip, maxSeen}` continuation
 * (mid-burst). `ts` is the query base (`ge ts`); `skip` is the resume offset; `maxSeen` is the
 * highest item timestamp observed so far.
 */
function parseCursor(stored: unknown): { ts: string; skip: number; maxSeen: string } {
  if (stored && typeof stored === 'object') {
    const o = stored as { ts?: unknown; skip?: unknown; maxSeen?: unknown };
    if (typeof o.ts === 'string') {
      const skip = typeof o.skip === 'number' && o.skip > 0 ? o.skip : 0;
      const maxSeen = typeof o.maxSeen === 'string' ? o.maxSeen : o.ts;
      return { ts: o.ts, skip, maxSeen };
    }
  }
  const ts = String(stored);
  return { ts, skip: 0, maxSeen: ts };
}

/**
 * Parse a poll-time cursor: a plain epoch-seconds string, or a `{epochSec, pageToken, boundSec}`
 * continuation (mid-pagination). `epochSec` is the query base (`after:epochSec`); `pageToken`
 * resumes Gmail pagination; `boundSec` is the advance target captured when the drain started.
 */
function parsePollTimeCursor(stored: unknown): { epochSec: string; pageToken?: string; boundSec?: string } {
  if (stored && typeof stored === 'object') {
    const o = stored as { epochSec?: unknown; pageToken?: unknown; boundSec?: unknown };
    if (typeof o.epochSec === 'string') {
      return {
        epochSec: o.epochSec,
        pageToken: typeof o.pageToken === 'string' ? o.pageToken : undefined,
        boundSec: typeof o.boundSec === 'string' ? o.boundSec : undefined,
      };
    }
  }
  return { epochSec: String(stored) };
}

// ---------------------------------------------------------------------------
// Local path/dedup helpers (kept here to avoid coupling to the supervisor).
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
  return typeof v === 'string' ? v : String(v);
}
