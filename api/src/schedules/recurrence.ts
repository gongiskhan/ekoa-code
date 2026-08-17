/**
 * Recurrence math for schedules — PURE functions, no store, no clock, no I/O. The server is the
 * single source of occurrence truth: the create-form preview, the supervisor's advance and the
 * contract tests all call the same `nextOccurrence`, so the UI can never promise a time the
 * supervisor will not fire.
 *
 * Self-rolled on `Intl.DateTimeFormat` — the repo's twice-recorded stance (knowledge
 * crawl/scheduler.ts, docs/dev-parity.md WS8c row: "no node-cron"), extended here to IANA-zone
 * wall-clock math because "every day at 09:00 in Europe/Lisbon" must stay 09:00 across DST.
 *
 * DST semantics (pinned by api/tests/schedules/recurrence.test.ts):
 *  - a SKIPPED local time (spring forward) shifts forward by the gap: 01:30 fires at 02:30;
 *  - a REPEATED local time (fall back) fires on its FIRST occurrence (the earlier instant).
 *
 * Cadence semantics:
 *  - minute/hour: fixed strides from an ANCHOR instant (the schedule's creation), so
 *    "every 2 hours" is anchor-aligned, not drift-from-last-fire.
 *  - day: every N tz-local calendar days from the anchor's local date, at `at`.
 *  - week: the `weekdays` set (0=Sunday..6=Saturday), at `at`, in weeks whose index from the
 *    anchor's week (Monday-started, tz-local) is divisible by N.
 *  - month: every N months from the anchor's local month, on `monthDay` clamped to the month's
 *    length (31 → 30 Apr, → 28/29 Feb), at `at`.
 */
import type { RecurrenceRule, ScheduleSpec } from '@ekoa/shared';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Bounded search horizon: no valid occurrence within ~3 years means none (a weekday set with
 *  interval 999 weeks can legitimately sit far out; beyond this we answer null, never spin). */
const MAX_SEARCH_DAYS = 1_100;

// ---------------------------------------------------------------------------
// Zone math on Intl
// ---------------------------------------------------------------------------

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtfFor(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

/** True iff the runtime's tz database knows the zone. The service turns false into a 400. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    dtfFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  hour: number;
  minute: number;
  second: number;
}

/** The zone-local wall clock an instant renders as. */
export function wallPartsOf(timeZone: string, instant: Date): WallParts {
  const parts = dtfFor(timeZone).formatToParts(instant);
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    return p ? Number(p.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** UTC offset (ms, positive east of Greenwich) the zone applies at `instant`. */
function zoneOffsetMs(timeZone: string, instant: Date): number {
  const w = wallPartsOf(timeZone, instant);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // Truncate the instant to whole seconds — formatToParts carries no milliseconds.
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

/**
 * The instant at which the zone's wall clock reads `y-mo-d hh:mi:00`.
 * Two candidate offsets (sampled a day either side of the naive guess) cover every DST edge:
 *  - both render the wall time (fall back, ambiguous) → the EARLIER instant (first occurrence);
 *  - one renders it (the ordinary 363 days) → that one;
 *  - neither renders it (spring forward, skipped) → the pre-gap offset, which lands the fire
 *    shifted forward by exactly the gap (01:30 → 02:30).
 */
export function wallClockToUtc(
  timeZone: string,
  y: number,
  mo: number,
  d: number,
  hh: number,
  mi: number,
): Date {
  const naive = Date.UTC(y, mo - 1, d, hh, mi, 0);
  const offsets = [
    zoneOffsetMs(timeZone, new Date(naive - DAY_MS)),
    zoneOffsetMs(timeZone, new Date(naive + DAY_MS)),
  ];
  const unique = [...new Set(offsets)];
  const matches: number[] = [];
  for (const off of unique) {
    const candidate = naive - off;
    const w = wallPartsOf(timeZone, new Date(candidate));
    if (w.year === y && w.month === mo && w.day === d && w.hour === hh && w.minute === mi) {
      matches.push(candidate);
    }
  }
  if (matches.length > 0) return new Date(Math.min(...matches));
  // Skipped local time (spring forward): no offset renders the wall time. The LATER candidate
  // (naive minus the smaller, pre-gap offset) renders as the wall time PLUS the gap — the
  // documented shift-forward (01:30 → 02:30); the earlier candidate would fire BEFORE the
  // requested wall time, which a schedule must never do.
  const candidates = unique.map((off) => naive - off);
  return new Date(Math.max(...candidates));
}

// ---------------------------------------------------------------------------
// Cadence stepping
// ---------------------------------------------------------------------------

/** Days-since-epoch of a zone-local calendar date (a pure lattice for stride math). */
function localDayNumber(w: WallParts): number {
  return Math.floor(Date.UTC(w.year, w.month - 1, w.day) / DAY_MS);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The date `dayNumber` (days since epoch) renders as, as UTC calendar fields. */
function dateOfDayNumber(dayNumber: number): { year: number; month: number; day: number } {
  const d = new Date(dayNumber * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function nextStride(anchorMs: number, stepMs: number, afterMs: number): number {
  if (afterMs < anchorMs) return anchorMs;
  const k = Math.floor((afterMs - anchorMs) / stepMs) + 1;
  return anchorMs + k * stepMs;
}

/**
 * The first occurrence of `rule` STRICTLY AFTER `after`, anchored at `anchor` (the schedule's
 * creation instant — strides and week/month indices count from it). Null when the rule can
 * produce nothing within the search horizon.
 */
export function nextRuleOccurrence(rule: RecurrenceRule, after: Date, anchor: Date): Date | null {
  const tz = rule.timezone;
  const interval = rule.interval;

  if (rule.every === 'minute' || rule.every === 'hour') {
    const step = interval * (rule.every === 'minute' ? MINUTE_MS : HOUR_MS);
    // Anchor truncated to the whole minute, so fires land on clean wall minutes.
    const anchorMs = Math.floor(anchor.getTime() / MINUTE_MS) * MINUTE_MS;
    return new Date(nextStride(anchorMs, step, after.getTime()));
  }

  const at = rule.at ?? { hour: 9, minute: 0 }; // service enforces presence; belt-and-braces default
  const anchorDay = localDayNumber(wallPartsOf(tz, anchor));

  if (rule.every === 'day') {
    // Candidate local dates: anchorDay + k*interval. Start the scan just before `after`'s local
    // date to cover the same-day-later-time case.
    const afterDay = localDayNumber(wallPartsOf(tz, after));
    let k = Math.max(0, Math.floor((afterDay - anchorDay - 1) / interval));
    for (let i = 0; i <= Math.ceil(MAX_SEARCH_DAYS / interval) + 1; i++, k++) {
      const dayNo = anchorDay + k * interval;
      const { year, month, day } = dateOfDayNumber(dayNo);
      const t = wallClockToUtc(tz, year, month, day, at.hour, at.minute);
      if (t.getTime() > after.getTime()) return t;
    }
    return null;
  }

  if (rule.every === 'week') {
    const weekdays = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [1];
    const wanted = new Set(weekdays);
    // Monday-started week index from the anchor's week, on the tz-local day lattice.
    const anchorWeekStart = anchorDay - ((((anchorDay + 3) % 7) + 7) % 7); // day 0 (1970-01-01) was a Thursday → +3 aligns Monday
    const afterDay = localDayNumber(wallPartsOf(tz, after));
    for (let dayNo = Math.max(anchorWeekStart, afterDay - 1); dayNo <= afterDay + MAX_SEARCH_DAYS; dayNo++) {
      const weekIndex = Math.floor((dayNo - anchorWeekStart) / 7);
      if (weekIndex < 0 || weekIndex % interval !== 0) continue;
      // JS weekday of the local date: day 0 was a Thursday (4).
      const weekday = (((dayNo + 4) % 7) + 7) % 7;
      if (!wanted.has(weekday)) continue;
      const { year, month, day } = dateOfDayNumber(dayNo);
      const t = wallClockToUtc(tz, year, month, day, at.hour, at.minute);
      if (t.getTime() > after.getTime()) return t;
    }
    return null;
  }

  // every === 'month'
  const monthDay = rule.monthDay ?? 1;
  const anchorW = wallPartsOf(tz, anchor);
  const anchorMonthIndex = anchorW.year * 12 + (anchorW.month - 1);
  const afterW = wallPartsOf(tz, after);
  const afterMonthIndex = afterW.year * 12 + (afterW.month - 1);
  let k = Math.max(0, Math.floor((afterMonthIndex - anchorMonthIndex - 1) / interval));
  for (let i = 0; i <= Math.ceil(48 / interval) + 1; i++, k++) {
    const monthIndex = anchorMonthIndex + k * interval;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const day = Math.min(monthDay, daysInMonth(year, month));
    const t = wallClockToUtc(tz, year, month, day, at.hour, at.minute);
    if (t.getTime() > after.getTime()) return t;
  }
  return null;
}

/** The first fire of `spec` strictly after `after`. `once` answers its instant while still
 *  ahead, null once passed (exhausted). */
export function nextOccurrence(spec: ScheduleSpec, after: Date, anchor: Date): Date | null {
  if (spec.kind === 'once') {
    const at = new Date(spec.at);
    return at.getTime() > after.getTime() ? at : null;
  }
  return nextRuleOccurrence(spec.rule, after, anchor);
}

/** The next `count` occurrences (the preview endpoint's body). */
export function occurrencesOf(spec: ScheduleSpec, after: Date, anchor: Date, count: number): Date[] {
  const out: Date[] = [];
  let cursor = after;
  for (let i = 0; i < count; i++) {
    const next = nextOccurrence(spec, cursor, anchor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}

/**
 * Cross-field validation zod deliberately does not encode (the schema must survive JSON-Schema
 * conversion for OpenAPI). Returns a machine code, null when valid.
 */
export function validateSpec(spec: ScheduleSpec, now: Date): string | null {
  if (spec.kind === 'once') {
    if (Number.isNaN(new Date(spec.at).getTime())) return 'invalid_at';
    if (new Date(spec.at).getTime() <= now.getTime()) return 'at_in_past';
    return null;
  }
  const r = spec.rule;
  if (!isValidTimeZone(r.timezone)) return 'invalid_timezone';
  const needsAt = r.every === 'day' || r.every === 'week' || r.every === 'month';
  if (needsAt && !r.at) return 'missing_at';
  if (r.weekdays && r.every !== 'week') return 'weekdays_without_week';
  if (r.every === 'week' && (!r.weekdays || r.weekdays.length === 0)) return 'missing_weekdays';
  if (r.monthDay !== undefined && r.every !== 'month') return 'monthday_without_month';
  if (r.every === 'month' && r.monthDay === undefined) return 'missing_monthday';
  if ((r.every === 'minute' || r.every === 'hour') && r.at) return 'at_without_daily';
  return null;
}
