/**
 * DURABLE SYNC LESSONS (slice CS8) - the seam by which a completeness-verified sync run records what
 * it LEARNED about the source it just met, so the knowledge survives the run instead of scrolling
 * past in a log nobody reads.
 *
 * WHY THIS EXISTS. Every Citius slice shipped a SPIKE list: a written inventory of what has never
 * been observed against a real account (CS1 owns the parse unknowns, CS4 the transport ones, CS6 the
 * date format). Those lists are the shape of the risk BEFORE first access. This module is the other
 * half: first real access ANSWERS some of them, and the answer arrives inside one sync run, at a
 * portal nobody can re-query afterwards. A run that discovers "the pager is a control this connector
 * cannot drive" or "the session died on page 3, detected by a login page" has produced exactly the
 * evidence the SPIKE list asks for - and a `console.warn` is not where evidence goes.
 *
 * ================================== IT IS A SEAM, NOT A COUPLING =================================
 * The recorder is INJECTED, never reached for. Three reasons, in order of weight:
 *
 *   1. `events/verified-sync.ts` is the completeness core and it imports NOTHING from `data/` or any
 *      transport - that purity is what makes the no-silent-miss argument checkable by reading one
 *      file. A store handle reached for from inside it would end that, for telemetry.
 *   2. The sink is on the path of a run that has already advanced a watermark. It must be replaceable
 *      in a test with something that counts calls, and replaceable in production with something that
 *      does not exist yet, WITHOUT either one being able to change what the run decided. Injection is
 *      what makes "never load-bearing" a structural fact rather than a promise.
 *   3. It is the same shape the Citius rail already uses for `establishSession` /
 *      `markSessionUnhealthy` (`legal/citius-sync.ts`): tier-5 modules do not import their tier-5
 *      siblings at runtime; the composition happens at the wiring site.
 *
 * ==================================== KNOWLEDGE, NOT A LOG =======================================
 * A lesson is DEDUPED by `(stateKey, kind, signature)` and carries `firstSeenAt` / `lastSeenAt` /
 * `occurrences`. The same portal quirk met on 200 consecutive polls is ONE row with `occurrences:200`,
 * not 200 rows - so the store answers "what has this inbox ever done that we did not expect, and how
 * often" in one read. That is the difference between knowledge and a log, and it is the whole point
 * of the slice: a per-run append-only trail is what `sync_reports` already is.
 *
 * ================================ PER-ACTOR, LIKE EVERYTHING ELSE ================================
 * Rows are keyed by `syncStateId(key)`, and the Citius rail's `key.actionKey` CARRIES THE ACTOR
 * (`JSON.stringify([baseActionKey, userId])` - hazard 4 in `legal/citius-sync.ts`). One org is not
 * one inbox: two lawyers in one firm have two portals, two watermarks and therefore two bodies of
 * knowledge. A lesson learned from one mandatario's inbox is not evidence about another's, and a
 * shared row would also be a cross-user read of what a colleague's session did.
 *
 * `syncStateId` fails closed on a blank component, so an unscoped key cannot reach this store at all.
 *
 * ======================================== BOUNDED, TWICE ========================================
 * Part of a signature is derived from source-controlled text (a per-page `note`, an error string).
 * Unbounded distinct signatures would be unbounded rows, so: signatures and details are normalised
 * and TRUNCATED, a single run contributes at most `LESSONS_PER_RUN_CAP` distinct lessons, and a key
 * keeps at most `LESSONS_PER_KEY_CAP` rows (oldest-seen pruned first, the `REPORT_HISTORY_CAP`
 * precedent). No portal content beyond those bounded reason codes and notes ever reaches this store:
 * the producers read a walk's STATUS fields, never its rows, so a notification's metadata - and above
 * all its document reference - cannot arrive here by accident.
 *
 * ============================== NOT FED BACK INTO THE RUN (ON PURPOSE) ===========================
 * Nothing in the sync reads these rows to decide how to walk the portal. A lesson that changed the
 * next run's behaviour would be a load-bearing input written by an unattended observation of an
 * unobserved portal: one bad inference and every later run walks differently, with no review anywhere
 * in the loop. Lessons are read by PEOPLE (and by a future operator surface); acting on one is a
 * reviewed code or configuration change - which is exactly what the SPIKE lists describe.
 */
import { createHash } from 'node:crypto';
import type { SyncOutcome } from '@ekoa/shared';
import { Store, type Doc } from '../data/store.js';
import { syncStateId, type SyncStateKey } from './sync-state.js';

/**
 * What kind of knowledge a lesson is. Deliberately coarse - it is a filing drawer for a human, not a
 * taxonomy anything branches on.
 */
export type SyncLessonKind =
  /** The source rendered a shape the parser could not read. */
  | 'parse'
  /** How the source pages, or a paging control this connector cannot drive. */
  | 'pager'
  /** How the source's session behaves (died mid-walk, needed re-establishing, was retired). */
  | 'session'
  /** The network rail: a status, a refusal, a transport error. */
  | 'transport'
  /** Something the completeness machinery itself discovered (a late-visible item, a truncation). */
  | 'completeness';

/** One thing a run learned, as its producer states it. */
export interface SyncLessonInput {
  kind: SyncLessonKind;
  /**
   * The FACT's identity within `(key, kind)`. Two runs that learned the same thing MUST produce the
   * same signature, or the store degenerates into a log. Machine-stable: lowercase ASCII tokens,
   * never a timestamp, never a row reference.
   */
  signature: string;
  /** Human-readable, bounded, credential-free. What an operator reads. */
  detail: string;
  /** The page the observation was made on, when the producer knows it. */
  page?: number;
}

/** Run-level context stamped onto every lesson recorded by one call. */
export interface SyncLessonContext {
  observedAt: string;
  reportId?: string;
  outcome?: SyncOutcome;
}

/** The durable row. */
export interface SyncLessonDoc extends Doc {
  /** `syncStateId(key)` - the same identity `sync_state` and `sync_reports` are keyed by. */
  stateKey: string;
  orgId: string;
  integrationKey: string;
  /** Carries the ACTOR on the Citius rail (hazard 4). */
  actionKey: string;
  kind: SyncLessonKind;
  signature: string;
  detail: string;
  page?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  lastReportId?: string;
  lastOutcome?: SyncOutcome;
}

/** The read shape: a durable row without its storage plumbing. */
export interface SyncLesson {
  id: string;
  kind: SyncLessonKind;
  signature: string;
  detail: string;
  page?: number;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrences: number;
  lastReportId?: string;
  lastOutcome?: SyncOutcome;
}

/** What `record` answers with. `isNew` is TRUE only the first time a key ever saw this fact - the
 *  signal an operator surface would badge, and what a test asserts to prove dedup really deduped. */
export interface SyncLessonRecorded extends SyncLesson {
  isNew: boolean;
}

/**
 * THE SEAM. A function, not an object, for the same reason `land` and `enumerate` are: the wiring
 * site hands over a behaviour, and a test hands over an array push.
 */
export type SyncLessonRecorder = (
  lessons: readonly SyncLessonInput[],
  ctx: SyncLessonContext,
) => Promise<SyncLessonRecorded[]>;

/** Signature ceiling (source-controlled text feeds into some of them). */
export const LESSON_SIGNATURE_MAX = 160;
/** Detail ceiling. */
export const LESSON_DETAIL_MAX = 400;
/** Distinct lessons ONE run may contribute. A walk of 50 broken pages is not 50 lessons. */
export const LESSONS_PER_RUN_CAP = 25;
/** Rows kept per key; the oldest-SEEN are pruned first (the `REPORT_HISTORY_CAP` precedent). */
export const LESSONS_PER_KEY_CAP = 200;

/**
 * A module-local `Store`: exactly one writer and one reader, both in this file - the
 * `cofre/store.ts` / `legal/citius-sync.ts` pattern. Registering it in the global `data/stores.ts`
 * inventory would advertise a handle nothing else may touch.
 */
const syncLessons = new Store<SyncLessonDoc>('sync_lessons');

/**
 * Normalise source-derived text into a stable signature fragment: lowercased, control characters and
 * runs of whitespace collapsed, DIGIT RUNS replaced by `#`, truncated. The digit collapse is the
 * load-bearing part - `timeout after 30012ms` and `timeout after 29997ms` are the same lesson, and
 * without it every run would mint a new row for the same fact.
 */
export function normaliseLessonSignature(raw: string): string {
  return raw
    .toLowerCase()
    // eslint-disable-next-line no-control-regex -- control characters are precisely what is stripped
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LESSON_SIGNATURE_MAX);
}

/** Bound + flatten a human detail string. Newlines out (one row, one line, greppable). */
function boundedDetail(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex -- control characters are precisely what is stripped
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LESSON_DETAIL_MAX);
}

/**
 * Deterministic, INJECTIVE row id: the hashed `(orgId, integrationKey, actionKey)` tuple plus the
 * lesson's `(kind, signature)`, JSON-encoded before hashing for the reason `syncStateId`'s own
 * docblock gives - a separator join is not injective, and two different facts sharing one row is a
 * silent overwrite of knowledge.
 */
export function lessonId(key: SyncStateKey, kind: SyncLessonKind, signature: string): string {
  return createHash('sha256')
    .update(JSON.stringify([syncStateId(key), kind, signature]))
    .digest('hex');
}

function toLesson(doc: SyncLessonDoc): SyncLesson {
  return {
    id: doc._id,
    kind: doc.kind,
    signature: doc.signature,
    detail: doc.detail,
    ...(doc.page === undefined ? {} : { page: doc.page }),
    firstSeenAt: doc.firstSeenAt,
    lastSeenAt: doc.lastSeenAt,
    occurrences: doc.occurrences,
    ...(doc.lastReportId === undefined ? {} : { lastReportId: doc.lastReportId }),
    ...(doc.lastOutcome === undefined ? {} : { lastOutcome: doc.lastOutcome }),
  };
}

/**
 * Dedupe one run's lessons by `(kind, signature)` - first statement wins its detail - and cap the
 * number a single run may contribute. Exported because it is the bound that stops a pathological
 * walk from writing a row per page, and a bound nobody can test is not a bound.
 */
export function dedupeLessons(lessons: readonly SyncLessonInput[]): SyncLessonInput[] {
  const seen = new Map<string, SyncLessonInput>();
  for (const l of lessons) {
    const signature = normaliseLessonSignature(l.signature);
    if (!signature) continue; // a lesson with nothing to say is not a lesson
    const k = JSON.stringify([l.kind, signature]);
    if (seen.has(k)) continue;
    seen.set(k, {
      kind: l.kind,
      signature,
      detail: boundedDetail(l.detail),
      ...(l.page === undefined ? {} : { page: l.page }),
    });
    if (seen.size >= LESSONS_PER_RUN_CAP) break;
  }
  return [...seen.values()];
}

/**
 * Build the Mongo-backed recorder for one key. This is the wiring seam:
 * `syncCitiusNotifications(input, { ..., recordLesson: makeSyncLessonRecorder(key) })`.
 */
export function makeSyncLessonRecorder(key: SyncStateKey): SyncLessonRecorder {
  const stateKey = syncStateId(key); // throws on a blank component: fail closed before any write
  return async (lessons, ctx) => {
    const out: SyncLessonRecorded[] = [];
    let inserted = false;
    for (const lesson of dedupeLessons(lessons)) {
      const _id = lessonId(key, lesson.kind, lesson.signature);
      const doc: SyncLessonDoc = {
        _id,
        stateKey,
        orgId: key.orgId,
        integrationKey: key.integrationKey,
        actionKey: key.actionKey,
        kind: lesson.kind,
        signature: lesson.signature,
        detail: lesson.detail,
        ...(lesson.page === undefined ? {} : { page: lesson.page }),
        firstSeenAt: ctx.observedAt,
        lastSeenAt: ctx.observedAt,
        occurrences: 1,
        ...(ctx.reportId === undefined ? {} : { lastReportId: ctx.reportId }),
        ...(ctx.outcome === undefined ? {} : { lastOutcome: ctx.outcome }),
      };
      if (await syncLessons.insert(doc)) {
        inserted = true;
        out.push({ ...toLesson(doc), isNew: true });
        continue;
      }
      // Already known: this is the SAME fact, so the row is bumped, never replaced. `firstSeenAt`
      // is immutable - "when did this inbox first do this" is the answer the SPIKE lists want.
      const bumped = await syncLessons.update(_id, (cur) => ({
        ...cur,
        detail: lesson.detail,
        ...(lesson.page === undefined ? {} : { page: lesson.page }),
        lastSeenAt: ctx.observedAt,
        occurrences: (typeof cur.occurrences === 'number' ? cur.occurrences : 0) + 1,
        ...(ctx.reportId === undefined ? {} : { lastReportId: ctx.reportId }),
        ...(ctx.outcome === undefined ? {} : { lastOutcome: ctx.outcome }),
      }));
      if (bumped) {
        out.push({ ...toLesson(bumped), isNew: false });
      } else {
        // The row vanished between the insert and the CAS (a prune, a manual delete). Re-create it
        // rather than dropping the observation on the floor.
        await syncLessons.put(doc);
        inserted = true;
        out.push({ ...toLesson(doc), isNew: true });
      }
    }
    if (inserted) await pruneLessons(stateKey);
    return out;
  };
}

/** Keep at most `LESSONS_PER_KEY_CAP` rows per key, dropping the ones least recently seen. Only run
 *  after a NEW row appears - a run that learned nothing new does not pay for a scan. */
async function pruneLessons(stateKey: string): Promise<void> {
  const rows = await syncLessons.find({ stateKey }, { lastSeenAt: -1, _id: 1 });
  if (rows.length <= LESSONS_PER_KEY_CAP) return;
  console.warn(
    `[sync-lessons] lesson cap reached for ${stateKey}: ${rows.length} rows exceed ` +
      `LESSONS_PER_KEY_CAP=${LESSONS_PER_KEY_CAP}; dropping ${rows.length - LESSONS_PER_KEY_CAP} least recently seen`,
  );
  for (const r of rows.slice(LESSONS_PER_KEY_CAP)) await syncLessons.delete(r._id);
}

/**
 * Everything one key has ever learned, most recently seen first. Scoped by `syncStateId(key)`, so a
 * caller cannot read another actor's (or another tenant's) rows without holding their key - and
 * `syncStateId` refuses a blank component, so a half-built key reads nothing rather than everything.
 */
export async function readSyncLessons(key: SyncStateKey, limit = LESSONS_PER_KEY_CAP): Promise<SyncLesson[]> {
  const rows = await syncLessons.find({ stateKey: syncStateId(key) }, { lastSeenAt: -1, _id: 1 });
  return rows.slice(0, Math.max(0, limit)).map(toLesson);
}
