/**
 * Recurrence math (schedules/recurrence.ts) — PURE, so this suite is exhaustive where it
 * matters: the Europe/Lisbon DST edges (2026-03-29 spring forward, 2026-10-25 fall back),
 * anchor-aligned strides, weekday sets, month-end clamping, and the cross-field validator.
 * These pins are the contract the preview endpoint and the supervisor both stand on.
 */
import { describe, it, expect } from 'vitest';
import {
  isValidTimeZone,
  nextOccurrence,
  nextRuleOccurrence,
  occurrencesOf,
  validateSpec,
  wallClockToUtc,
  wallPartsOf,
} from '../../src/schedules/recurrence.js';
import type { RecurrenceRule, ScheduleSpec } from '@ekoa/shared';

const LISBON = 'Europe/Lisbon';
const rule = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
  every: 'day',
  interval: 1,
  at: { hour: 9, minute: 0 },
  timezone: LISBON,
  ...over,
});

describe('wallClockToUtc', () => {
  it('ordinary winter day: Lisbon == UTC', () => {
    expect(wallClockToUtc(LISBON, 2026, 1, 15, 9, 0).toISOString()).toBe('2026-01-15T09:00:00.000Z');
  });

  it('ordinary summer day: Lisbon == UTC+1', () => {
    expect(wallClockToUtc(LISBON, 2026, 7, 15, 9, 0).toISOString()).toBe('2026-07-15T08:00:00.000Z');
  });

  it('SPRING FORWARD (2026-03-29, 01:00->02:00): a skipped 01:30 shifts forward by the gap', () => {
    const t = wallClockToUtc(LISBON, 2026, 3, 29, 1, 30);
    // 01:30 local does not exist; the fire lands at 02:30 local = 01:30Z.
    expect(t.toISOString()).toBe('2026-03-29T01:30:00.000Z');
    const w = wallPartsOf(LISBON, t);
    expect([w.hour, w.minute]).toEqual([2, 30]);
  });

  it('FALL BACK (2026-10-25, 02:00->01:00): a repeated 01:30 fires on its FIRST occurrence', () => {
    const t = wallClockToUtc(LISBON, 2026, 10, 25, 1, 30);
    // First 01:30 local is still UTC+1 → 00:30Z (the second would be 01:30Z).
    expect(t.toISOString()).toBe('2026-10-25T00:30:00.000Z');
  });

  it('unaffected by DST for a far-away zone', () => {
    expect(wallClockToUtc('Asia/Tokyo', 2026, 3, 29, 9, 0).toISOString()).toBe('2026-03-29T00:00:00.000Z');
  });
});

describe('minute/hour strides (anchor-aligned)', () => {
  const anchor = new Date('2026-08-17T10:07:00Z');

  it('every 15 minutes from the anchor', () => {
    const r = rule({ every: 'minute', interval: 15 });
    delete (r as { at?: unknown }).at;
    const n1 = nextRuleOccurrence(r, new Date('2026-08-17T10:07:00Z'), anchor)!;
    expect(n1.toISOString()).toBe('2026-08-17T10:22:00.000Z');
    const n2 = nextRuleOccurrence(r, n1, anchor)!;
    expect(n2.toISOString()).toBe('2026-08-17T10:37:00.000Z');
  });

  it('every 2 hours does not drift after a delayed fire', () => {
    const r = rule({ every: 'hour', interval: 2 });
    delete (r as { at?: unknown }).at;
    // A fire that ran 20 min late still advances to the anchor-aligned boundary.
    const late = new Date('2026-08-17T12:27:00Z');
    expect(nextRuleOccurrence(r, late, anchor)!.toISOString()).toBe('2026-08-17T14:07:00.000Z');
  });
});

describe('daily', () => {
  const anchor = new Date('2026-08-10T15:00:00Z');

  it('same-day later time fires today; passed time fires tomorrow', () => {
    const r = rule({ every: 'day', at: { hour: 18, minute: 30 } });
    expect(nextRuleOccurrence(r, new Date('2026-08-17T10:00:00Z'), anchor)!.toISOString()).toBe('2026-08-17T17:30:00.000Z'); // 18:30 Lisbon = 17:30Z (summer)
    const r2 = rule({ every: 'day', at: { hour: 6, minute: 0 } });
    expect(nextRuleOccurrence(r2, new Date('2026-08-17T10:00:00Z'), anchor)!.toISOString()).toBe('2026-08-18T05:00:00.000Z');
  });

  it('daily 09:00 across SPRING FORWARD stays 09:00 wall clock (08:00Z after)', () => {
    const springAnchor = new Date('2026-03-01T12:00:00Z');
    const r = rule({ every: 'day', at: { hour: 9, minute: 0 } });
    // 29th is transition day (01:00 → 02:00 local): 09:00 local is already UTC+1 → 08:00Z.
    const before = nextRuleOccurrence(r, new Date('2026-03-28T10:00:00Z'), springAnchor)!;
    expect(before.toISOString()).toBe('2026-03-29T08:00:00.000Z');
    const after = nextRuleOccurrence(r, before, springAnchor)!;
    expect(after.toISOString()).toBe('2026-03-30T08:00:00.000Z');
  });

  it('every 3 days honours the anchor stride', () => {
    const r = rule({ every: 'day', interval: 3, at: { hour: 9, minute: 0 } });
    // Anchor local date 2026-08-10 → occurrences 10, 13, 16, 19...
    expect(nextRuleOccurrence(r, new Date('2026-08-17T10:00:00Z'), anchor)!.toISOString()).toBe('2026-08-19T08:00:00.000Z');
  });
});

describe('weekly', () => {
  const anchor = new Date('2026-08-10T15:00:00Z'); // Monday

  it('weekday set picks the next matching day', () => {
    // Mon=1, Wed=3; after Tue 2026-08-18 → Wed 19th 09:00 local (08:00Z).
    const r = rule({ every: 'week', weekdays: [1, 3], at: { hour: 9, minute: 0 } });
    expect(nextRuleOccurrence(r, new Date('2026-08-18T12:00:00Z'), anchor)!.toISOString()).toBe('2026-08-19T08:00:00.000Z');
  });

  it('every 2 weeks skips the off week', () => {
    const r = rule({ every: 'week', interval: 2, weekdays: [1], at: { hour: 9, minute: 0 } });
    // Anchor week = week of Mon 2026-08-10 (index 0). Next Monday fires: 24th (index 2), not 17th...
    // after Mon 17th 10:00Z (already past 09:00 local): index-1 week is OFF, so the 24th (index 2).
    expect(nextRuleOccurrence(r, new Date('2026-08-17T10:00:00Z'), anchor)!.toISOString()).toBe('2026-08-24T08:00:00.000Z');
  });

  it('Sunday (0) is a valid set member', () => {
    const r = rule({ every: 'week', weekdays: [0], at: { hour: 8, minute: 0 } });
    expect(nextRuleOccurrence(r, new Date('2026-08-17T10:00:00Z'), anchor)!.toISOString()).toBe('2026-08-23T07:00:00.000Z');
  });
});

describe('monthly', () => {
  const anchor = new Date('2026-01-31T10:00:00Z');

  it('monthDay 31 clamps to short months', () => {
    const r = rule({ every: 'month', monthDay: 31, at: { hour: 9, minute: 0 } });
    // After 2026-02-01: February clamps to the 28th.
    expect(nextRuleOccurrence(r, new Date('2026-02-01T00:00:00Z'), anchor)!.toISOString()).toBe('2026-02-28T09:00:00.000Z');
  });

  it('every 3 months from the anchor month', () => {
    const r = rule({ every: 'month', interval: 3, monthDay: 15, at: { hour: 9, minute: 0 } });
    // Anchor month Jan → Apr, Jul, Oct... after 2026-05-01 → Jul 15 (summer: 08:00Z).
    expect(nextRuleOccurrence(r, new Date('2026-05-01T00:00:00Z'), anchor)!.toISOString()).toBe('2026-07-15T08:00:00.000Z');
  });
});

describe('once + occurrencesOf + validateSpec', () => {
  const now = new Date('2026-08-17T10:00:00Z');

  it('once: ahead answers the instant, passed answers null (exhausted)', () => {
    const ahead: ScheduleSpec = { kind: 'once', at: '2026-09-01T14:30:00.000Z' };
    expect(nextOccurrence(ahead, now, now)!.toISOString()).toBe('2026-09-01T14:30:00.000Z');
    expect(nextOccurrence(ahead, new Date('2026-09-02T00:00:00Z'), now)).toBeNull();
  });

  it('occurrencesOf answers the preview list in order', () => {
    const spec: ScheduleSpec = { kind: 'recurring', rule: rule({ every: 'day', at: { hour: 9, minute: 0 } }) };
    const three = occurrencesOf(spec, now, now, 3).map((d) => d.toISOString());
    expect(three).toEqual(['2026-08-18T08:00:00.000Z', '2026-08-19T08:00:00.000Z', '2026-08-20T08:00:00.000Z']);
  });

  it('validateSpec: the cross-field rules zod deliberately does not encode', () => {
    expect(validateSpec({ kind: 'once', at: '2026-01-01T00:00:00.000Z' }, now)).toBe('at_in_past');
    expect(validateSpec({ kind: 'recurring', rule: rule({ timezone: 'Not/AZone' }) }, now)).toBe('invalid_timezone');
    const noAt = rule({ every: 'day' });
    delete (noAt as { at?: unknown }).at;
    expect(validateSpec({ kind: 'recurring', rule: noAt }, now)).toBe('missing_at');
    expect(validateSpec({ kind: 'recurring', rule: rule({ every: 'week' }) }, now)).toBe('missing_weekdays');
    expect(validateSpec({ kind: 'recurring', rule: rule({ every: 'month' }) }, now)).toBe('missing_monthday');
    expect(validateSpec({ kind: 'recurring', rule: rule({ every: 'day', weekdays: [1] }) }, now)).toBe('weekdays_without_week');
    expect(validateSpec({ kind: 'recurring', rule: rule({ every: 'week', weekdays: [1, 3] }) }, now)).toBeNull();
  });

  it('isValidTimeZone', () => {
    expect(isValidTimeZone('Europe/Lisbon')).toBe(true);
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
});
