/**
 * Caixa Citius (área de MANDATÁRIOS) — THE JOIN POINT (slice CS6).
 *
 * This module is where the four Citius slices become one read-only sync, and it is deliberately
 * nothing but the joinery: CS5 establishes the session, CS4 walks the inbox, CS3 verifies the
 * completeness of the walk, and this file translates between their three vocabularies and lands
 * the metadata. It owns NO parse shape, NO request shape and NO completeness reasoning — every one
 * of those lives in the module that was reviewed for it. What it owns is the TRANSLATION, and the
 * translation is where this proof could quietly die: three of the four hazards below are pure
 * name-collisions across the seams.
 *
 * ================================ METADATA ONLY (OPERATOR-LOCKED) ================================
 * The sync reads notification METADATA ONLY and NEVER opens a document. Two INDEPENDENT proofs, in
 * `api/tests/security/citius-sync-metadata-only.test.ts`:
 *
 *   STRUCTURAL — this module defines no function that fetches, downloads or opens anything. It
 *   performs NO network I/O AT ALL: the only egress in the whole sync is `enumerateInbox`'s, which
 *   is itself proved to request nothing but its one configured inbox URL. Going further, this
 *   module never so much as NAMES the notification's document fields: the parsed row is stored by
 *   SPREADING the whole typed metadata record, so there is no `documentoRef` / `docId` /
 *   `Documento` identifier anywhere in the code to dereference. The guard suite pins that as source
 *   text, plus an exact export allowlist so a new exported function cannot appear unnoticed.
 *
 *   BEHAVIOURAL — three full syncs against the CS2 mock (whose rows carry document links), across
 *   a COMPLETE, an INCOMPLETE and a COMPLETE run, leave the mock's per-document hit counter at
 *   ZERO — with the counter driven to 1 and reset inside the same test, so the assertion cannot
 *   pass vacuously against a counter that never worked.
 *
 * ============================ THE FOUR HAZARDS THIS TRANSLATION AVOIDS ===========================
 * All four are silent. Each has a test whose only job is to keep it closed.
 *
 *   1. `pageTotal` IS TWO DIFFERENT QUANTITIES (CS4's finding, confirmed by its reviewer). CS1's
 *      `pageTotal` is a count of PAGES; CS3's `EnumerateResult.pageTotal` is documented as the
 *      source's TRUE COUNT OF ITEMS in the window and is compared against `items.length` — a match
 *      sets `countCheck.match`, which OVERRIDES `reachedEnd` and advances the watermark. Feeding
 *      the first into the second CERTIFIES A TRUNCATED SWEEP AS COMPLETE. CS4 therefore never
 *      emits a field named `pageTotal` (it exposes `advertisedPageCount`), and THIS MODULE OMITS
 *      CS3's `pageTotal` ENTIRELY. It is equally forbidden to synthesise one from `rows.length`:
 *      `pageTotal === items.length` is tautological and would certify anything, including a sweep
 *      that stopped at page 1 of 40. There is no true item total available from this portal, so the
 *      run relies on `reachedEnd` — which is exactly what CS3's contract clause
 *      #complete-or-ok:false prescribes for a connector that cannot compute one.
 *
 *   2. `pages` IS A NUMBER UPSTREAM AND AN ARRAY DOWNSTREAM. CS4's `pages` is a
 *      `CitiusPageOutcome[]` (one record per page attempted); `EnumerateResult.result.pages` is a
 *      NUMBER. `pagesWalked` is the number that belongs there — never `pages.length` conflated with
 *      a row count, and never the array.
 *
 *   3. `maxPages` EXISTS ON BOTH SIDES AND ONLY ONE OF THEM IS APPLIED. CS3 hands the enumerator an
 *      `EnumerateWindow.maxPages` and records it on the report as truncation evidence; CS4 defaults
 *      its OWN `maxPages` to 50. The window's bound is FORWARDED into `EnumerateInboxInput.maxPages`
 *      on every pass, or the report's truncation evidence would describe a bound that was never in
 *      force.
 *
 *   4. ONE ORG IS NOT ONE INBOX. The sync-state key is `(orgId, integrationKey, actionKey)`, but
 *      Caixa Citius credentials are PER MANDATÁRIO: two lawyers in one firm have two different
 *      inboxes. Sharing a watermark between them would let one user's proved-complete sweep advance
 *      the cursor past notifications the other user has never seen — a silent miss with no
 *      machinery failure anywhere. The action key therefore CARRIES THE ACTOR, and it is composed
 *      with `JSON.stringify` rather than a separator join, because a raw `::` join is not injective
 *      (`syncStateId`'s own docblock makes the same argument for the same reason).
 *
 * ================================= THE OUTCOME MAPPING (CS4 -> CS3) ==============================
 * Written out in CS4's docblock, traced through `runVerifiedSync` by its reviewer, and implemented
 * here verbatim:
 *
 *   complete      -> { ok:true,  result:{ items, pages: pagesWalked, reachedEnd:TRUE  } }
 *   incomplete    -> { ok:true,  result:{ items, pages: pagesWalked, reachedEnd:FALSE } }  rows LAND
 *   session-dead  -> { ok:false, error } AND `markSessionUnhealthy`, so the NEXT run re-establishes
 *   failed        -> { ok:false, error }
 *
 * `incomplete` is the subtle one and it is subtle in the right direction: the rows the walk DID
 * capture are handed over and land (at-least-once, idempotent), while `reachedEnd:false` with no
 * count check makes `runVerifiedSync` refuse to call the run complete, so the watermark STAYS and
 * the window is re-swept. A proved-partial walk never discards real data and never upgrades itself.
 *
 * A mid-run `session-dead` marks the Cofre item unhealthy but does NOT re-establish: re-logging in
 * mid-run is how an account gets locked out (CS5's caller contract), so the observation is recorded
 * and the NEXT run's `ensureSession` routes on it. `ensureSession` is called EXACTLY ONCE per sync,
 * structurally — there is one call site and no loop.
 *
 * KNOWN LIMITATION, recorded rather than hidden: `SyncSessionEvent`s can only ride on an `ok:true`
 * enumerate, so a run whose first pass returns `session-dead` produces a `failed` report with an
 * EMPTY `sessionEvents` array even though the item really was marked unhealthy. The fact is not
 * lost — it is surfaced on this module's own outcome as `sessionMarkedUnhealthy` — but the report
 * alone cannot show it, and widening CS3's `EnumerateResult` to carry events on a failure is a
 * change to the completeness core, which is not a thing to do as a side effect of wiring.
 *
 * ============================== SESSION OUTCOMES ARE NOT ALL FAILURES ============================
 * `ensureSession` returns four states and they are NOT interchangeable with a sync failure:
 *
 *   reused / reestablished -> the sync runs.
 *   needs-human            -> a PERSON is required (a card reader, a relayed code), or a login was
 *                             already spent this run. NOT a sync failure: nothing was enumerated,
 *                             so nothing is known about completeness and NOTHING is written — not
 *                             even a `failed` report, whose two-pass evidence would be fabricated
 *                             zeros. `attempted` is passed through verbatim; a caller must not
 *                             retry a `true` without human input (CS5's caller contract).
 *   needs-egress           -> the session is FINE and no human can help; there is no compatible way
 *                             out of the network. Its own outcome for the same reason CS5 made it
 *                             one.
 *
 * ==================================== FAIL CLOSED ON IDENTITY ===================================
 * An empty `orgId`, `userId`, integration key or action key is REFUSED (a thrown `CitiusSyncError`),
 * never defaulted. Every one of them is part of a key that scopes state: an empty component would
 * silently merge two tenants' (or two lawyers') watermarks, seen-sets and landed rows into one row.
 *
 * ================================== FIRST-REAL-ACCOUNT SPIKE ====================================
 * CS1 owns the PARSE unknowns and CS4 the TRANSPORT ones. This module adds exactly one:
 *
 *   A. THE DATE FORMAT of the `data` cell is unobserved. `citiusItemDate` recognises ISO
 *      (`2026-06-15[ 14:03]`) and the Portuguese `dd-mm-yyyy` / `dd/mm/yyyy` forms and normalises
 *      them to ISO; ANYTHING ELSE is passed through verbatim and treated as un-windowable, so an
 *      unrecognised date can never DROP a row (the window filter fails OPEN — a kept row costs one
 *      idempotent re-land, a dropped row is the silent miss this whole proof exists to prevent).
 *      Note the direct consequence: until the real format is known, the lower-bound window filter
 *      may be a no-op and every run re-walks the whole inbox. That is the safe direction, and it is
 *      what CS4's SPIKE #5 already assumes (there is no server-side window filter).
 */
import { createHash } from 'node:crypto';
import {
  SyncRunReport,
  type Actor,
  type SyncSessionEvent,
  type SyncStateView,
} from '@ekoa/shared';
import { Store, type Doc } from '../data/store.js';
import { syncReports } from '../data/stores.js';
import {
  makeSyncStateStore,
  readSyncState,
  syncStateId,
  type SyncStateKey,
} from '../events/sync-state.js';
import {
  runVerifiedSync,
  type EnumeratedItem,
  type EnumerateResult,
  type EnumerateWindow,
  type SyncStateStore,
} from '../events/verified-sync.js';
import {
  CITIUS_MANDATARIOS_BASE_URL,
  enumerateInbox,
  type CitiusInboxEnumeration,
  type EnumerateInboxDeps,
  type EnumerateInboxInput,
} from './citius-mandatarios-http.js';
import type { CitiusNotificacaoMeta } from './citius-mandatarios.js';
// TYPE-ONLY, and deliberately so. `automation/` is this module's tier-5 SIBLING; the session seams
// are INJECTED (`establishSession`, `markSessionUnhealthy` have no defaults here) so there is no
// runtime edge from legal/ into automation/ at all — the composition happens one tier up, in
// routes/sync.ts. Importing the TYPES keeps CS5's result union the single authority: if CS5 ever
// grows a fifth member, its `ensureSession` stops being assignable to this seam and the wiring site
// fails to compile, which is exactly the canary a hand-copied union would not give.
import type { EnsureSessionInput, EnsureSessionResult } from '../automation/session-establishment.js';

/** The default logical integration this sync belongs to. */
export const CITIUS_INTEGRATION_KEY = 'caixa-citius';
/** The default action within it. The ACTOR is appended to this by `syncStateKeyFor` — see hazard 4. */
export const CITIUS_SYNC_ACTION_KEY = 'sync_notificacoes';

/**
 * Landed notification METADATA, one row per `(orgId, integrationKey, actionKey, ref)`.
 *
 * A module-local `Store`, the `cofre/store.ts` / `integrations/app-sso-sessions.ts` pattern: the
 * collection has exactly one writer and one reader, both in this file, so registering it in the
 * global `data/stores.ts` inventory would advertise a handle nothing else may touch.
 */
const citiusNotifications = new Store<Doc>('citius_notifications');

/** A caller error terminal for the sync: the request itself cannot be scoped safely. */
export class CitiusSyncError extends Error {
  readonly code = 'CITIUS_SYNC_REFUSED';
  constructor(message: string) {
    super(`sincronização Citius: ${message}`);
    this.name = 'CitiusSyncError';
  }
}

/** Everything needed to NAME one actor's Citius sync — the read surface needs nothing more. */
export interface CitiusSyncScope {
  actor: Actor;
  /** Logical integration key; defaults to `caixa-citius`. */
  integrationKey?: string;
  /** Logical action key; defaults to `sync_notificacoes`. Always scoped by the actor — hazard 4. */
  actionKey?: string;
}

export interface CitiusSyncInput extends CitiusSyncScope {
  /** The run this sync belongs to (threaded into session establishment). */
  runId: string;
  /** Portal origin. Defaults to the real Caixa Citius base URL. */
  baseUrl?: string;
  /** Inbox path on that origin (CS4 SPIKE #2). */
  inboxPath?: string;
  /** The GET pager's page parameter (CS4 SPIKE #2). */
  pageParam?: string;
  /** Rows a FULL page of the grid holds — arms CS4's truncation floor (SPIKE #2). */
  pageSize?: number;
  /** Per-pass page bound. Forwarded to BOTH the verification window and the connector (hazard 3). */
  maxPages?: number;
  /** Delay between page requests, ms (CS4 clamps it). */
  throttleMs?: number;
  /** Per-request timeout, ms (CS4 clamps it). */
  requestTimeoutMs?: number;
  /** Hold the window ceiling this far behind the clock to absorb source publish lag (CS3
   *  #visibility-monotonic). */
  untilSkewMs?: number;
  /** Explicit window ceiling; overrides the clock and the skew. Tests set it. */
  until?: string;
  /** Deterministic report id (tests set it). */
  reportId?: string;
  /** `cofre:<itemId>` for the password the typist would replay if the session must be re-established. */
  credentialRef?: string;
  /** Non-secret username filled alongside it. */
  username?: string;
  /** Pairing ids that can currently provide residential egress for this org. */
  residentialAvailable?: readonly string[];
  datacenterAvailable?: boolean;
}

/**
 * What one sync attempt did. `ran` is the only member that carries a `SyncRunReport`, because it is
 * the only member in which the verification machinery actually ran.
 */
export type CitiusSyncOutcome =
  | {
      status: 'ran';
      /** How the session was obtained. */
      session: 'reused' | 'reestablished';
      sessionItemId: string;
      /** TRUE when the portal killed the session mid-walk and the Cofre item was marked unhealthy
       *  so the NEXT run re-establishes. See the KNOWN LIMITATION in the module header. */
      sessionMarkedUnhealthy: boolean;
      report: SyncRunReport;
    }
  | { status: 'needs-human'; route: 'attended' | 'relay'; reason: string; attempted: boolean }
  | { status: 'needs-egress'; required: { kind: 'residential'; pairingId: string } };

export interface CitiusSyncDeps {
  /** CS5's `ensureSession`. REQUIRED (no default): keeping it injected is what stops this tier-5
   *  module from importing its tier-5 sibling at runtime. */
  establishSession: (input: EnsureSessionInput) => Promise<EnsureSessionResult>;
  /** CS5's `markSessionUnhealthy`. Same reasoning. Never called for anything but a portal-proved
   *  dead session — an ambiguous refusal must not retire a session that was fine. */
  markSessionUnhealthy: (actor: Actor, itemId: string) => Promise<boolean>;
  /** CS4's connector. Defaults to the real one. */
  enumerate?: (input: EnumerateInboxInput, deps?: EnumerateInboxDeps) => Promise<CitiusInboxEnumeration>;
  /** Transport/sleep seams handed to the connector (tests point them at the mock). */
  enumerateDeps?: EnumerateInboxDeps;
  /** CS3's durable state handle. Defaults to the Mongo-backed store for the computed key. */
  store?: SyncStateStore;
  /** The land seam. Defaults to the deterministic-id insert below. */
  land?: (item: EnumeratedItem) => Promise<{ landed: boolean }>;
  clock?: () => Date;
  /** CS3's optional telemetry sink; never load-bearing (CS8 wires the real one). */
  recordLesson?: (report: SyncRunReport) => void | Promise<void>;
}

/**
 * The state key for one actor's Citius sync.
 *
 * The action key embeds the ACTOR because one org is not one inbox (hazard 4), and it embeds it
 * with `JSON.stringify` because a separator join is not injective: with `::`, a base action key
 * ending in `:` and a user id starting with `:` would land on the same row as a different pair.
 * `syncStateId` then hashes the whole tuple, so the encoding only has to be unambiguous — and this
 * one is.
 */
export function syncStateKeyFor(input: CitiusSyncScope): SyncStateKey {
  const orgId = (input.actor?.orgId ?? '').trim();
  const userId = (input.actor?.userId ?? '').trim();
  const integrationKey = (input.integrationKey ?? CITIUS_INTEGRATION_KEY).trim();
  const baseActionKey = (input.actionKey ?? CITIUS_SYNC_ACTION_KEY).trim();
  // FAIL CLOSED. Every one of these scopes durable state; an empty component merges tenants.
  if (!orgId) throw new CitiusSyncError('orgId em falta');
  if (!userId) throw new CitiusSyncError('userId em falta');
  if (!integrationKey) throw new CitiusSyncError('chave de integração em falta');
  if (!baseActionKey) throw new CitiusSyncError('chave de ação em falta');
  return { orgId, integrationKey, actionKey: JSON.stringify([baseActionKey, userId]) };
}

/** The report's `syncKey`: CS3's documented display join. Identity is `syncStateId(key)`, never
 *  this string — it is recorded for a human reading the audit trail. */
function syncKeyOf(key: SyncStateKey): string {
  return `${key.orgId}::${key.integrationKey}::${key.actionKey}`;
}

/** The bare host of an origin written either as a host or as a full URL. */
function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return (raw.trim().split('/')[0] ?? '').split(':')[0] ?? '';
  }
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const PT_DATE_RE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/**
 * Normalise a portal date cell to an ISO instant, or return it VERBATIM when the shape is not one
 * of the two recognised ones (SPIKE A). Verbatim is the safe answer: `pruneSeen` deliberately keeps
 * un-parseable dates, and the window filter below deliberately keeps rows it cannot place.
 */
export function citiusItemDate(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const iso = ISO_DATE_RE.exec(s);
  if (iso) return utcIso(Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[4], iso[5], iso[6]) ?? s;
  const pt = PT_DATE_RE.exec(s);
  if (pt) return utcIso(Number(pt[3]), Number(pt[2]), Number(pt[1]), pt[4], pt[5], pt[6]) ?? s;
  return s;
}

/** Build an ISO instant, or `undefined` when the components are not a real calendar date. */
function utcIso(
  y: number,
  mo: number,
  d: number,
  hh?: string,
  mm?: string,
  ss?: string,
): string | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const ms = Date.UTC(y, mo - 1, d, Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0));
  const dt = new Date(ms);
  // Reject a rolled-over date (31-02 becoming 03-03) rather than inventing a day.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString();
}

/**
 * The window filter, LOWER BOUND ONLY and FAIL-OPEN.
 *
 * `since` is the stored watermark and is INCLUSIVE (CS3 re-sees the boundary item every run and
 * dedups it against the seen-set). A row whose date this module cannot place — or a watermark that
 * is not a date — is KEPT: dropping a row invents a silent miss, while keeping one costs a single
 * idempotent re-land. There is deliberately no UPPER bound: the connector has no server-side window
 * filter (CS4 SPIKE #5), so a row newer than the ceiling is landed now and simply re-seen next run;
 * filtering it out would buy nothing and add a second place a row can vanish.
 */
function withinWindow(itemDate: string, since: string | null): boolean {
  if (!since) return true;
  const from = Date.parse(since);
  const at = Date.parse(itemDate);
  if (Number.isNaN(from) || Number.isNaN(at)) return true;
  return at >= from;
}

/** The typed metadata record, or `undefined` when the payload is not one. */
function metaOf(payload: unknown): CitiusNotificacaoMeta | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Partial<CitiusNotificacaoMeta>;
  if (typeof p.ref !== 'string' || typeof p.processo !== 'string') return undefined;
  return payload as CitiusNotificacaoMeta;
}

/** Deterministic, injective row id: the same tuple `syncStateId` hashes, plus the row's ref. */
export function notificationRowId(key: SyncStateKey, ref: string): string {
  return createHash('sha256')
    .update(JSON.stringify([key.orgId, key.integrationKey, key.actionKey, ref]))
    .digest('hex');
}

/**
 * The default `land`: an idempotent deterministic-id insert, honouring CS3's contract clause
 * #land-throws-or-duplicate — `Store.insert` returns `false` ONLY for a duplicate key and RETHROWS
 * every other driver error, so a transient failure propagates and the run ends `failed` with
 * nothing moved, rather than marking an unlanded ref as seen.
 *
 * The parsed row is stored by SPREADING the whole typed record. That is not brevity: it is why this
 * module contains no identifier for the notification's document at all, which is half of the
 * metadata-only proof.
 */
async function landNotification(
  key: SyncStateKey,
  item: EnumeratedItem,
  nowIso: string,
): Promise<{ landed: boolean }> {
  const meta = metaOf(item.payload);
  // A payload that is not a notification record is a BUG in this file's own mapping, not a portal
  // problem. Throw: the run ends `failed` and nothing moves (a silent skip would drop a real row).
  if (!meta) throw new CitiusSyncError('registo de notificação inesperado no seam de gravação');
  const landed = await citiusNotifications.insert({
    _id: notificationRowId(key, item.ref),
    orgId: key.orgId,
    integrationKey: key.integrationKey,
    actionKey: key.actionKey,
    ref: item.ref,
    itemDate: item.itemDate,
    landedAt: nowIso,
    notificacao: { ...meta },
  } as Doc);
  return { landed };
}

/**
 * Adapt ONE CS4 walk onto ONE CS3 enumeration pass. Every hazard in the module header lands here.
 *
 * `onSessionDead` is called (once per walk) when the portal proved the session dead, so the caller
 * can retire the Cofre item. It is a callback rather than an inline write because retiring a
 * credential is a side effect and this function is otherwise pure translation.
 */
export function toEnumerateResult(
  walk: CitiusInboxEnumeration,
  since: string | null,
  opts: { sessionEvents?: readonly SyncSessionEvent[] } = {},
): EnumerateResult {
  if (walk.status === 'session-dead') {
    return {
      ok: false,
      error: `sessão terminada no portal (${walk.detectedBy}) na página ${walk.atPage}`,
    };
  }
  if (walk.status === 'failed') return { ok: false, error: walk.error };

  const items: EnumeratedItem[] = [];
  for (const row of walk.rows) {
    const itemDate = citiusItemDate(row.data);
    if (!withinWindow(itemDate, since)) continue;
    items.push({ ref: row.ref, itemDate, payload: row });
  }
  return {
    ok: true,
    result: {
      items,
      // HAZARD 2: the NUMBER of pages walked, never CS4's per-page outcome ARRAY and never a row count.
      pages: walk.pagesWalked,
      // THE MAPPING: `complete` is the only walk that reached the end of the window.
      reachedEnd: walk.status === 'complete',
      ...(opts.sessionEvents?.length ? { sessionEvents: [...opts.sessionEvents] } : {}),
      // HAZARD 1: `pageTotal` is DELIBERATELY ABSENT and must never be added here. CS4's
      // `advertisedPageCount` is a PAGE count, and `rows.length` is tautological; either one would
      // certify a truncated sweep as complete and advance the watermark past unseen notifications.
    },
  };
}

/**
 * Run ONE completeness-verified Caixa Citius notification sync for one actor.
 *
 * Never throws for a portal or transport problem (those become a `failed` report); throws only
 * `CitiusSyncError` for an unscopeable request, and propagates CS5's typed establishment errors
 * (`CofreLockedError`, `CredentialOriginError`, …) because the caller must distinguish them.
 */
export async function syncCitiusNotifications(
  input: CitiusSyncInput,
  deps: CitiusSyncDeps,
): Promise<CitiusSyncOutcome> {
  const key = syncStateKeyFor(input);
  const clock = deps.clock ?? ((): Date => new Date());
  const enumerate = deps.enumerate ?? enumerateInbox;
  const baseUrl = input.baseUrl ?? CITIUS_MANDATARIOS_BASE_URL;
  const origin = hostOf(baseUrl);
  if (!origin) throw new CitiusSyncError('URL do portal sem host');

  // ---- 1. THE SESSION. Exactly one call, structurally: no loop, no re-establishment mid-run. ----
  const session = await deps.establishSession({
    actor: input.actor,
    integrationKey: key.integrationKey,
    origin,
    runId: input.runId,
    ...(input.credentialRef === undefined ? {} : { credentialRef: input.credentialRef }),
    ...(input.username === undefined ? {} : { username: input.username }),
    ...(input.residentialAvailable === undefined ? {} : { residentialAvailable: input.residentialAvailable }),
    ...(input.datacenterAvailable === undefined ? {} : { datacenterAvailable: input.datacenterAvailable }),
  });

  if (session.status === 'needs-human') {
    // NOT a failed sync: nothing was enumerated, so nothing is known about completeness and nothing
    // is written. `attempted` rides through verbatim — a `true` means a password was SPENT.
    return {
      status: 'needs-human',
      route: session.route,
      reason: session.reason,
      attempted: session.attempted,
    };
  }
  if (session.status === 'needs-egress') {
    return { status: 'needs-egress', required: session.required };
  }

  const sessionItemId = session.itemId;
  const sessionEvent = session.status === 'reused' ? 'reused' : 'reestablished';

  // ---- 2. THE WALK, adapted onto the verification passes -----------------------------------------
  let sessionMarkedUnhealthy = false;
  let firstPassDone = false;

  const runEnumerate = async (window: EnumerateWindow): Promise<EnumerateResult> => {
    const walk = await enumerate(
      {
        sessionState: session.storageState,
        baseUrl,
        ...(input.inboxPath === undefined ? {} : { inboxPath: input.inboxPath }),
        ...(input.pageParam === undefined ? {} : { pageParam: input.pageParam }),
        ...(input.pageSize === undefined ? {} : { pageSize: input.pageSize }),
        ...(input.throttleMs === undefined ? {} : { throttleMs: input.throttleMs }),
        ...(input.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: input.requestTimeoutMs }),
        // HAZARD 3: the WINDOW's bound, not the connector's own default, or the report's truncation
        // evidence would name a bound that was never applied.
        maxPages: window.maxPages,
      },
      deps.enumerateDeps ?? {},
    );

    if (walk.status === 'session-dead' && !sessionMarkedUnhealthy) {
      // Record the observation; do NOT re-establish. CS5's caller contract: a mid-run re-login is
      // how an account is locked. The NEXT run's `ensureSession` sees `unhealthy` and routes.
      sessionMarkedUnhealthy = true;
      await deps.markSessionUnhealthy(input.actor, sessionItemId);
    }

    // The session lifecycle is reported ONCE, on the first pass that can carry it (CS3 only accepts
    // events on an `ok:true` result — see the KNOWN LIMITATION in the module header).
    const events = firstPassDone ? [] : [sessionEvent as 'reused' | 'reestablished'];
    const mapped = toEnumerateResult(walk, window.sinceIso, { sessionEvents: events });
    if (mapped.ok) firstPassDone = true;
    return mapped;
  };

  const nowIso = clock().toISOString();
  const report = await runVerifiedSync({
    syncKey: syncKeyOf(key),
    orgId: key.orgId,
    ...(input.until === undefined ? {} : { until: input.until }),
    ...(input.untilSkewMs === undefined ? {} : { untilSkewMs: input.untilSkewMs }),
    ...(input.maxPages === undefined ? {} : { maxPages: input.maxPages }),
    ...(input.reportId === undefined ? {} : { reportId: input.reportId }),
    enumerate: runEnumerate,
    land: deps.land ?? ((item) => landNotification(key, item, nowIso)),
    store: deps.store ?? makeSyncStateStore(key),
    clock,
    ...(deps.recordLesson === undefined ? {} : { recordLesson: deps.recordLesson }),
  });

  return { status: 'ran', session: sessionEvent, sessionItemId, sessionMarkedUnhealthy, report };
}

/**
 * Read the durable state for one actor's Citius sync, plus its latest report.
 *
 * The report is `safeParse`d before it is returned: a history row written by an older shape is
 * dropped rather than served as if it validated. That is the same honesty rule the rest of the
 * Citius chain runs on — an answer this module cannot vouch for is not given.
 */
export async function readCitiusSyncState(input: CitiusSyncScope): Promise<SyncStateView> {
  const key = syncStateKeyFor(input);
  const doc = await readSyncState(key);
  const rows = await syncReports.find({ stateKey: syncStateId(key) }, { startedAt: -1 });
  const landed = (await citiusNotifications.find({
    orgId: key.orgId,
    integrationKey: key.integrationKey,
    actionKey: key.actionKey,
  })).length;
  // `safeParse` before it is served: a history row written by an older shape is DROPPED rather than
  // handed out as if it validated. Same honesty rule the rest of the Citius chain runs on.
  const head = rows.length ? SyncRunReport.safeParse(rows[0]) : undefined;
  const parsed = head?.success ? head.data : undefined;
  return {
    watermark: doc.watermark,
    ...(doc.lastRunAt === undefined ? {} : { lastRunAt: doc.lastRunAt }),
    ...(doc.lastOutcome === undefined ? {} : { lastOutcome: doc.lastOutcome }),
    consecutiveIncomplete: doc.consecutiveIncomplete,
    consecutiveFailures: doc.consecutiveFailures,
    seenRefs: doc.seenRefs.length,
    landed,
    ...(parsed === undefined ? {} : { latest: parsed }),
  };
}
