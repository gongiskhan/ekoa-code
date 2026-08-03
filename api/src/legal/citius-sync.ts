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
 * ============================ THE FIVE HAZARDS THIS TRANSLATION AVOIDS ===========================
 * All five are silent, and the fifth was LIVE until CS8. Each has a test whose only job is to keep
 * it closed.
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
 *   5. TWO COORDINATE SYSTEMS, ONE COMPARISON (found by CS6's fresh-context review; fixed in CS8, and
 *      it was a LIVE silent miss). CS3 treats the cursor as an OPAQUE string and never compares it to
 *      an item's date. CS6 introduced that comparison - a lower-bound window filter, `itemDate >=
 *      watermark` - and the two sides were not in the same coordinate system: the watermark is
 *      `clock() - untilSkewMs`, a WALL-CLOCK INSTANT, while a DATE-ONLY portal cell (`15-06-2026`,
 *      the shape the fixtures and the mock actually use) normalises to MIDNIGHT UTC. After one
 *      complete run at 09:00 the cursor sits mid-day; every later notification dated that same day
 *      arrives at 00:00Z, i.e. BELOW the cursor. It was filtered out of BOTH passes, so the passes
 *      agreed, both reached the end, no count check existed, the run was certified `complete` - and
 *      the watermark advanced AGAIN, past a notification that had never been landed and now never
 *      could be. No machinery failed anywhere. That is precisely the class this workstream exists to
 *      prevent, and it was reachable through the shipped route, whose request body cannot even set
 *      `until`.
 *
 *      THE FIX IS TO DELETE THE COMPARISON, not to bound it. `untilSkewMs` cannot repair it (for a
 *      date-only cell the ceiling would have to be held before midnight of the newest notification's
 *      day - a skew that grows without bound), and any repair keeps two coordinate systems in one
 *      expression while the date format is still UNOBSERVED (SPIKE A). So the window is now LOWER
 *      BOUND ONLY IN NAME: every row the walk captured is handed to `runVerifiedSync`, which dedups
 *      by REFERENCE against the seen-set - an exact comparison between two values of the same kind -
 *      and lands idempotently by deterministic id. `window.since` is still recorded on the report as
 *      evidence of what the run believed it was sweeping.
 *
 *      WHAT THAT COSTS, honestly: rows older than the seen-set's prune horizon (`watermark - 7 days`)
 *      are re-landed on every run. Each is one idempotent insert that returns "already present" and
 *      shows up as `duplicatesSuppressed`, never as data movement. It costs nothing on the network -
 *      the connector has no server-side window filter (CS4 SPIKE #5) and re-walks from page 1 anyway,
 *      so the filter never saved a single request. A date filter may return once the format, the
 *      portal's timezone and its ordering are OBSERVED, and it must then be expressed entirely in the
 *      item-date coordinate system (a cursor derived from item dates), never against a wall clock.
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
 * ================================= SERIALIZED PER KEY (#serialize) ===============================
 * CS3's contract clause #serialize says at most one verified sync per key runs at a time, and its
 * completeness reasoning assumes it. CS6 shipped the route that makes concurrency reachable (two
 * POSTs, or a poll overlapping a manual run) without implementing it. Every run now queues on
 * `withSyncLock(syncStateId(key))`, so two runs for one actor are strictly sequential and two actors
 * never queue behind each other. The lock is PROCESS-LOCAL and says so: see
 * `events/sync-serialize.ts` for what that does and does not buy.
 *
 * ================================== FIRST-REAL-ACCOUNT SPIKE ====================================
 * CS1 owns the PARSE unknowns and CS4 the TRANSPORT ones. This module adds exactly one:
 *
 *   A. THE DATE FORMAT of the `data` cell is unobserved, AND SO IS THE PORTAL'S TIMEZONE.
 *      `citiusItemDate` recognises ISO (`2026-06-15[ 14:03[:05][Z|+01:00]]`) and the Portuguese
 *      `dd-mm-yyyy` / `dd/mm/yyyy` forms, honours an EXPLICIT offset, and reads a cell with no
 *      offset as UTC. ANYTHING ELSE is passed through verbatim. Nothing FILTERS on this value any
 *      more (hazard 5), so an unrecognised - or mis-zoned - date can no longer drop a row; what it
 *      still affects is the `itemDate` persisted on the landed row and shown to a lawyer, and the
 *      seen-set's 7-day prune horizon, which absorbs an error of a day comfortably. FIRST REAL
 *      ACCESS MUST CAPTURE a `data` cell verbatim, including whether it carries a time at all and in
 *      which zone. Until then this value is a normalised reading, not an exact instant.
 *
 * ================================ WHAT A RUN LEARNED (slice CS8) ================================
 * The SPIKE lists above are the shape of the risk BEFORE first access. First access ANSWERS some of
 * them - inside one run, at a portal nobody can re-query afterwards - so the answers are recorded
 * through the `recordLesson` SEAM (`events/sync-lessons.ts`) rather than narrated to a log:
 *
 *   WHAT is recorded: the walk's own verdicts (a shape the parser refused, a pager idiom this
 *   connector cannot drive, a per-page status), the session's behaviour (died mid-walk and how it
 *   was detected, needed re-establishing, was retired), and the ONE thing only the verification can
 *   see - a reference the second pass revealed and the first did not, which is the #visibility-
 *   monotonic evidence that says `untilSkewMs` is too small. Each carries the SPIKE it answers.
 *
 *   WHAT IS NOT: any notification metadata. The producers read STATUS fields and never `rows`, so no
 *   row - and above all no reference to a document - can reach the lesson store at all. The
 *   late-visible lesson records a COUNT, never the references themselves.
 *
 *   WHEN: once per run, from `runVerifiedSync`'s own hook, on the completed AND the failed path -
 *   a failed run usually has the most to teach. NOT on `needs-human` / `needs-egress`: a run that
 *   never established a session learned nothing about the INBOX, and CS6's rule that such an attempt
 *   writes nothing stays a single testable statement rather than one with an exception.
 *
 *   AND IT IS NEVER READ BACK. A lesson does not change how the next run walks the portal; acting on
 *   one is a reviewed code or configuration change, which is exactly what a SPIKE entry describes.
 */
import { createHash } from 'node:crypto';
import type {
  Actor,
  SyncRunReport,
  SyncSessionEvent,
  SyncStateView,
} from '@ekoa/shared';
import { Store, type Doc } from '../data/store.js';
import {
  latestSyncReport,
  makeSyncStateStore,
  readSyncState,
  syncStateId,
  type SyncStateKey,
} from '../events/sync-state.js';
import { withSyncLock } from '../events/sync-serialize.js';
import {
  makeSyncLessonRecorder,
  type SyncLessonInput,
  type SyncLessonKind,
  type SyncLessonRecorder,
} from '../events/sync-lessons.js';
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
  type CitiusIncompleteReason,
  type CitiusPageOutcome,
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
  /**
   * THE LESSONS SEAM (CS8). Defaults to the durable per-actor recorder
   * (`events/sync-lessons.ts#makeSyncLessonRecorder`), injected so this module never reaches for a
   * store and so a test can watch what a run claims to have learned without a database.
   *
   * NEVER LOAD-BEARING: it is invoked from `runVerifiedSync`'s own once-per-run hook, AFTER the
   * report is persisted and the watermark has already made its decision, and a sink that throws is
   * swallowed there. Nothing in this module reads a lesson back.
   */
  recordLesson?: SyncLessonRecorder;
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

const TZ = String.raw`(?:\s*(Z|z|[+-]\d{2}:?\d{2}))?`;
const ISO_DATE_RE = new RegExp(String.raw`^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?${TZ})?`);
const PT_DATE_RE = new RegExp(
  String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?${TZ})?`,
);

/**
 * Normalise a portal date cell to an ISO instant, or return it VERBATIM when the shape is not one
 * of the two recognised ones (SPIKE A). Verbatim is the safe answer: `pruneSeen` deliberately keeps
 * un-parseable dates.
 *
 * AN EXPLICIT OFFSET IS HONOURED (CS8, from CS6's review). A cell rendered as `2026-08-03T14:03+01:00`
 * used to come back as `14:03Z` - an hour of pure invention, in a field that is persisted on the
 * landed row and shown to a lawyer, and that `pruneSeen` measures against the watermark. A cell with
 * NO offset is still read as UTC, which is a documented ASSUMPTION and not a fact: the portal's
 * rendering timezone is unobserved (SPIKE A), and nothing downstream may treat this value as exact
 * to the hour until it is.
 */
export function citiusItemDate(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const iso = ISO_DATE_RE.exec(s);
  if (iso) return utcIso(Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[4], iso[5], iso[6], iso[7]) ?? s;
  const pt = PT_DATE_RE.exec(s);
  if (pt) return utcIso(Number(pt[3]), Number(pt[2]), Number(pt[1]), pt[4], pt[5], pt[6], pt[7]) ?? s;
  return s;
}

/** Minutes to SUBTRACT from a wall-clock reading to reach UTC. `undefined` (no offset stated) and
 *  `Z` both mean zero - see the assumption in `citiusItemDate`. */
function offsetMinutes(raw: string | undefined): number {
  if (!raw || raw === 'Z' || raw === 'z') return 0;
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(raw);
  if (!m) return 0;
  const magnitude = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -magnitude : magnitude;
}

/** Build an ISO instant, or `undefined` when the components are not a real calendar date. */
function utcIso(
  y: number,
  mo: number,
  d: number,
  hh?: string,
  mm?: string,
  ss?: string,
  tz?: string,
): string | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const ms = Date.UTC(y, mo - 1, d, Number(hh ?? 0), Number(mm ?? 0), Number(ss ?? 0));
  const dt = new Date(ms);
  // Reject a rolled-over date (31-02 becoming 03-03) rather than inventing a day. Checked BEFORE the
  // offset is applied, so a legitimate shift across midnight is not mistaken for an invalid date.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return undefined;
  return new Date(ms - offsetMinutes(tz) * 60_000).toISOString();
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
  opts: { sessionEvents?: readonly SyncSessionEvent[] } = {},
): EnumerateResult {
  if (walk.status === 'session-dead') {
    return {
      ok: false,
      error: `sessão terminada no portal (${walk.detectedBy}) na página ${walk.atPage}`,
    };
  }
  if (walk.status === 'failed') return { ok: false, error: walk.error };

  // EVERY row the walk captured is handed over. HAZARD 5 (below) is why there is no date filter here.
  const items: EnumeratedItem[] = walk.rows.map((row) => ({
    ref: row.ref,
    itemDate: citiusItemDate(row.data),
    payload: row,
  }));
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

// ============================== WHAT A RUN LEARNED (CS8) ========================================
// Every Citius slice shipped a SPIKE list of things nobody has observed against a real account. A
// run is where some of those get answered, at a portal that cannot be re-queried afterwards, so the
// answers are recorded through the lessons seam instead of being narrated to a log.
//
// THE PRODUCERS READ STATUS, NEVER ROWS. Everything below is derived from a walk's outcome fields
// (its status, its incomplete reason, its per-page outcome/note/status) and from the run report's
// own verification block. No notification metadata is read here and none can therefore reach the
// lesson store - which is what keeps the metadata-only argument true of the new collection too.

/** How each of CS4's proved-partial reasons files as knowledge, and what it tells the reader to do.
 *  The SPIKE numbers are CS4's, so a lesson points at the checklist entry it answers. */
const INCOMPLETE_LESSONS: Record<CitiusIncompleteReason, { kind: SyncLessonKind; detail: string }> = {
  'page-unparseable': {
    kind: 'parse',
    detail:
      'O parser recusou uma página do inbox (forma desconhecida). Capturar o HTML em bruto: as regras conservadoras de CS1 só se relaxam com evidência (SPIKE #11).',
  },
  'max-pages': {
    kind: 'completeness',
    detail:
      'A varredura atingiu o limite de páginas com mais páginas por ler. Não há filtro de janela do lado do servidor (SPIKE #5): subir maxPages ou plumbar um filtro de data.',
  },
  'page-count-disagreement': {
    kind: 'pager',
    detail:
      'O paginador anunciou mais páginas do que a varredura alcançou. Confirmar o idioma do paginador antes de confiar num complete (SPIKE #3).',
  },
  'pager-unrecognised': {
    kind: 'pager',
    detail:
      'Dentro da região do paginador existe um controlo que significa "mais páginas" e que este conector não sabe accionar. É o sinal de truncatura de maior confiança (SPIKE #3).',
  },
  'pager-ambiguous': {
    kind: 'pager',
    detail:
      'Um sinal do tipo "mais páginas" apareceu FORA da região do paginador. É o propenso a falso alarme: se se repetir, capturar o markup em vez de alargar uma guarda (SPIKE #3).',
  },
  'page-full-no-pager': {
    kind: 'pager',
    detail:
      'A última página veio CHEIA, a página mostrou markup de paginação e esse markup não explicava todas as páginas lidas. É o FLOOR a disparar (SPIKE #14).',
  },
  'pager-unavailable': {
    kind: 'pager',
    detail:
      'Uma página de postback não expôs alvo ou estado legível, por isso a página seguinte é inalcançável. Confirmar a estabilidade do alvo e do __EVENTVALIDATION entre páginas (SPIKE #4).',
  },
  'repeat-page': {
    kind: 'pager',
    detail:
      'Uma página voltou a servir linhas já vistas nesta varredura: o paginador está a saturar ou a ciclar. Confirmar como o portal trata um número de página fora do intervalo (SPIKE #3).',
  },
};

/** How each non-ok per-page outcome files. Closed set, so the signature stays machine-stable. */
const PAGE_OUTCOME_LESSONS: Record<Exclude<CitiusPageOutcome['outcome'], 'ok'>, SyncLessonKind> = {
  unparseable: 'parse',
  login: 'session',
  'http-error': 'transport',
  'transport-error': 'transport',
  refused: 'transport',
};

/** What ONE walk taught, from its status fields alone. */
function lessonsFromWalk(walk: CitiusInboxEnumeration): SyncLessonInput[] {
  const out: SyncLessonInput[] = [];
  if (walk.status === 'incomplete') {
    const filed = INCOMPLETE_LESSONS[walk.reason];
    out.push({
      kind: filed.kind,
      signature: `walk-incomplete:${walk.reason}`,
      detail: filed.detail,
      page: walk.pagesWalked,
    });
  } else if (walk.status === 'session-dead') {
    out.push({
      kind: 'session',
      signature: `session-dead:${walk.detectedBy}`,
      detail:
        'O portal terminou a sessão a meio da varredura. Quanto dura uma sessão de mandatário e o que a mata (sessão concorrente?) é a SPIKE #9; a assinatura diz COMO foi detectada (SPIKE #1).',
      page: walk.atPage,
    });
  } else if (walk.status === 'failed') {
    out.push({
      kind: 'transport',
      signature: `walk-failed:${walk.error}`,
      detail: walk.error,
      page: walk.atPage,
    });
  }
  for (const p of walk.pages) {
    if (p.outcome === 'ok') continue;
    out.push({
      kind: PAGE_OUTCOME_LESSONS[p.outcome],
      signature: `page-${p.outcome}${p.status === undefined ? '' : `:${p.status}`}`,
      detail: p.note ?? `Página ${p.page}: ${p.outcome}.`,
      page: p.page,
    });
  }
  return out;
}

/** What the RUN taught - things no single walk can see, because they are the verification's own
 *  discoveries and the session's own lifecycle. */
function lessonsFromRun(
  report: SyncRunReport,
  session: 'reused' | 'reestablished',
  sessionMarkedUnhealthy: boolean,
): SyncLessonInput[] {
  const out: SyncLessonInput[] = [];
  const lateRefs = report.verification.pass2.refsOnlyInPass2.length;
  if (lateRefs > 0) {
    // The reconciliation earning its keep, and the single most actionable thing this rail can learn:
    // the source made an item visible AFTER the pass that should have seen it. Deliberately a COUNT
    // and never the refs themselves - a notification reference is client data, and it would also
    // mint a new lesson row on every run.
    out.push({
      kind: 'completeness',
      signature: 'reconciliation:late-visible-items',
      detail:
        `A segunda passagem revelou ${lateRefs} referência(s) que a primeira não viu na MESMA janela: ` +
        'a fonte publica depois do seu próprio timestamp. Subir untilSkewMs acima do atraso máximo de publicação (contrato #visibility-monotonic).',
    });
  }
  if (session === 'reestablished') {
    out.push({
      kind: 'session',
      signature: 'session-reestablished',
      detail:
        'A sessão guardada já não servia e foi restabelecida por login. As ocorrências deste registo medem com que frequência o portal exige novo login.',
    });
  }
  if (sessionMarkedUnhealthy) {
    out.push({
      kind: 'session',
      signature: 'session-retired-mid-run',
      detail:
        'A sessão morreu a meio da varredura e o item do Cofre foi marcado como não saudável, para a PRÓXIMA execução voltar a estabelecer (nunca a meio - CS5).',
    });
  }
  return out;
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
  // The key is computed (and REFUSED, if unscopeable) OUTSIDE the lock: an unscopeable request must
  // throw immediately rather than queue behind someone else's sync.
  const key = syncStateKeyFor(input);
  return withSyncLock(syncStateId(key), () => runOneCitiusSync(key, input, deps));
}

/** One sync attempt, already serialized on its key (#serialize). */
async function runOneCitiusSync(
  key: SyncStateKey,
  input: CitiusSyncInput,
  deps: CitiusSyncDeps,
): Promise<CitiusSyncOutcome> {
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
  // What the walks taught, gathered as they happen and handed over ONCE, from the run-completion
  // hook, so a lesson is only ever recorded for a run that produced a report.
  const walkLessons: SyncLessonInput[] = [];

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

    walkLessons.push(...lessonsFromWalk(walk));

    if (walk.status === 'session-dead' && !sessionMarkedUnhealthy) {
      // Record the observation; do NOT re-establish. CS5's caller contract: a mid-run re-login is
      // how an account is locked. The NEXT run's `ensureSession` sees `unhealthy` and routes.
      sessionMarkedUnhealthy = true;
      await deps.markSessionUnhealthy(input.actor, sessionItemId);
    }

    // The session lifecycle is reported ONCE, on the first pass that can carry it (CS3 only accepts
    // events on an `ok:true` result — see the KNOWN LIMITATION in the module header).
    const events = firstPassDone ? [] : [sessionEvent as 'reused' | 'reestablished'];
    const mapped = toEnumerateResult(walk, { sessionEvents: events });
    if (mapped.ok) firstPassDone = true;
    return mapped;
  };

  const nowIso = clock().toISOString();
  const recordLesson = deps.recordLesson ?? makeSyncLessonRecorder(key);
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
    // The once-per-run hook, on BOTH the completed and the failed path. A failed run is the one that
    // most often has something to teach (a status, a refusal, a dead session), so it must not be the
    // one that records nothing.
    recordLesson: async (finished: SyncRunReport) => {
      await recordLesson([...walkLessons, ...lessonsFromRun(finished, sessionEvent, sessionMarkedUnhealthy)], {
        observedAt: clock().toISOString(),
        reportId: finished.id,
        outcome: finished.outcome,
      });
    },
  });

  return { status: 'ran', session: sessionEvent, sessionItemId, sessionMarkedUnhealthy, report };
}

/**
 * Read the durable state for one actor's Citius sync, plus its latest report.
 *
 * The "latest report" half GRADUATED in CS8 into `events/sync-state.ts#latestSyncReport`, where the
 * collection lives: which row is latest (greatest `startedAt`, deterministically tie-broken), what
 * `none` means, and what happens to a row an older schema wrote (`safeParse`, then DROPPED rather
 * than backfilled from the row before it) are properties of the report history, not of this rail.
 * Both were already CS6's answers; what changed is that a second sync producer now inherits them
 * instead of re-deciding them, and that they are stated once, next to the data.
 */
export async function readCitiusSyncState(input: CitiusSyncScope): Promise<SyncStateView> {
  const key = syncStateKeyFor(input);
  const doc = await readSyncState(key);
  const landed = (await citiusNotifications.find({
    orgId: key.orgId,
    integrationKey: key.integrationKey,
    actionKey: key.actionKey,
  })).length;
  const parsed = await latestSyncReport(key);
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
