/**
 * The schedule humaniser (`web/lib/schedules/recurrence-text.ts`) is the only place a
 * ScheduleSpec becomes a sentence, so the list row, the detail header and the form preview
 * are all only as correct as this. What is asserted here:
 *
 *  - every cadence in the contract (minute/hour/day/week/month), at interval 1 and > 1;
 *  - both languages, PT-PT first (it is the primary copy);
 *  - the weekday edge sets - all seven, the working week, the weekend, and a set that
 *    proves reading order is Monday-first even though the contract numbers Sunday as 0;
 *  - unit SELECTION in `relativeNext` (minutes vs hours vs days), which is our logic. The
 *    wording of a relative time is ICU's, so it is compared against ICU rather than frozen
 *    into a string this suite would only be re-asserting from memory.
 */
import { describe, it, expect } from 'vitest';
import type { ScheduleSpec } from '@ekoa/shared';
import {
  formatOccurrence,
  formatStamp,
  recurrenceText,
  relativeNext,
  weekdayChips,
} from '@/lib/schedules/recurrence-text';

const UTC = { timeZone: 'UTC' } as const;

/** A recurring spec with the boilerplate (timezone, interval 1) filled in. */
const recurring = (rule: Record<string, unknown>): ScheduleSpec =>
  ({ kind: 'recurring', rule: { timezone: 'Europe/Lisbon', interval: 1, ...rule } }) as ScheduleSpec;

const at = (hour: number, minute: number) => ({ hour, minute });

describe('recurrenceText - once', () => {
  const ONCE_AT = '2026-09-12T14:30:00.000Z';
  const spec: ScheduleSpec = { kind: 'once', at: ONCE_AT };
  // The month ABBREVIATION is ICU's ("set." in pt-PT, "Sept" in en-GB, and both have moved
  // between ICU releases); what this suite owns is the surrounding grammar and the dot strip.
  const monthOf = (locale: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
      .format(new Date(ONCE_AT))
      .replace(/\.$/, '');

  it('renders the PT-PT short date grammar ("12 de set")', () => {
    expect(recurrenceText(spec, 'pt', UTC)).toBe(`Uma vez, 12 de ${monthOf('pt-PT')}, 14:30`);
  });

  it('renders the EN short date grammar (day before month, 24h clock)', () => {
    expect(recurrenceText(spec, 'en', UTC)).toBe(`Once, 12 ${monthOf('en-GB')}, 14:30`);
  });

  it('degrades to the bare word rather than "Invalid Date" on a broken instant', () => {
    const broken = { kind: 'once', at: 'not-a-date' } as unknown as ScheduleSpec;
    expect(recurrenceText(broken, 'pt')).toBe('Uma vez');
    expect(recurrenceText(broken, 'en')).toBe('Once');
  });
});

describe('recurrenceText - sub-daily cadences', () => {
  it('every minute / every hour at interval 1', () => {
    expect(recurrenceText(recurring({ every: 'minute' }), 'pt')).toBe('Todos os minutos');
    expect(recurrenceText(recurring({ every: 'minute' }), 'en')).toBe('Every minute');
    expect(recurrenceText(recurring({ every: 'hour' }), 'pt')).toBe('Todas as horas');
    expect(recurrenceText(recurring({ every: 'hour' }), 'en')).toBe('Every hour');
  });

  it('every N hours / minutes', () => {
    expect(recurrenceText(recurring({ every: 'hour', interval: 2 }), 'pt')).toBe('De 2 em 2 horas');
    expect(recurrenceText(recurring({ every: 'hour', interval: 2 }), 'en')).toBe('Every 2 hours');
    expect(recurrenceText(recurring({ every: 'minute', interval: 15 }), 'pt')).toBe('De 15 em 15 minutos');
    expect(recurrenceText(recurring({ every: 'minute', interval: 15 }), 'en')).toBe('Every 15 minutes');
  });

  it('ignores a time of day on a sub-daily cadence (it has no meaning there)', () => {
    expect(recurrenceText(recurring({ every: 'hour', interval: 2, at: at(9, 0) }), 'pt')).toBe('De 2 em 2 horas');
  });
});

describe('recurrenceText - daily', () => {
  it('every day at a wall-clock time', () => {
    const spec = recurring({ every: 'day', at: at(9, 0) });
    expect(recurrenceText(spec, 'pt')).toBe('Todos os dias às 09:00');
    expect(recurrenceText(spec, 'en')).toBe('Every day at 09:00');
  });

  it('every N days', () => {
    const spec = recurring({ every: 'day', interval: 3, at: at(7, 5) });
    expect(recurrenceText(spec, 'pt')).toBe('De 3 em 3 dias, às 07:05');
    expect(recurrenceText(spec, 'en')).toBe('Every 3 days at 07:05');
  });

  it('survives a missing time of day', () => {
    expect(recurrenceText(recurring({ every: 'day' }), 'pt')).toBe('Todos os dias');
    expect(recurrenceText(recurring({ every: 'day' }), 'en')).toBe('Every day');
  });
});

describe('recurrenceText - weekly', () => {
  it('names the chosen weekdays in the plural', () => {
    const spec = recurring({ every: 'week', weekdays: [1, 3], at: at(9, 0) });
    expect(recurrenceText(spec, 'pt')).toBe('Às segundas e quartas, 09:00');
    expect(recurrenceText(spec, 'en')).toBe('On Mondays and Wednesdays, 09:00');
  });

  it('reads Monday-first even though the contract numbers Sunday as 0', () => {
    // [Sunday, Monday] must read "segundas e domingos", not "domingos e segundas".
    const spec = recurring({ every: 'week', weekdays: [0, 1], at: at(9, 0) });
    expect(recurrenceText(spec, 'pt')).toBe('Às segundas e domingos, 09:00');
    expect(recurrenceText(spec, 'en')).toBe('On Mondays and Sundays, 09:00');
  });

  it('collapses all seven days into the daily sentence', () => {
    const spec = recurring({ every: 'week', weekdays: [0, 1, 2, 3, 4, 5, 6], at: at(8, 30) });
    expect(recurrenceText(spec, 'pt')).toBe('Todos os dias às 08:30');
    expect(recurrenceText(spec, 'en')).toBe('Every day at 08:30');
  });

  it('names the working week and the weekend instead of enumerating them', () => {
    const workdays = recurring({ every: 'week', weekdays: [1, 2, 3, 4, 5], at: at(9, 0) });
    expect(recurrenceText(workdays, 'pt')).toBe('Nos dias úteis, às 09:00');
    expect(recurrenceText(workdays, 'en')).toBe('On weekdays at 09:00');

    const weekend = recurring({ every: 'week', weekdays: [6, 0], at: at(11, 0) });
    expect(recurrenceText(weekend, 'pt')).toBe('Aos fins de semana, às 11:00');
    expect(recurrenceText(weekend, 'en')).toBe('On weekends at 11:00');
  });

  it('does NOT collapse named day-sets when the interval is not 1', () => {
    const spec = recurring({ every: 'week', interval: 2, weekdays: [1, 2, 3, 4, 5], at: at(9, 0) });
    expect(recurrenceText(spec, 'pt')).toBe(
      'De 2 em 2 semanas, às segundas, terças, quartas, quintas e sextas, 09:00',
    );
    expect(recurrenceText(spec, 'en')).toBe(
      'Every 2 weeks on Mondays, Tuesdays, Wednesdays, Thursdays and Fridays, 09:00',
    );
  });

  it('handles a single day and a duplicate-laden set', () => {
    expect(recurrenceText(recurring({ every: 'week', weekdays: [5], at: at(18, 0) }), 'pt')).toBe(
      'Às sextas, 18:00',
    );
    // Duplicates collapse rather than repeating the day name.
    expect(recurrenceText(recurring({ every: 'week', weekdays: [2, 2, 4], at: at(6, 0) }), 'en')).toBe(
      'On Tuesdays and Thursdays, 06:00',
    );
  });

  it('falls back to a plain weekly sentence with no weekdays chosen', () => {
    expect(recurrenceText(recurring({ every: 'week', at: at(9, 0) }), 'pt')).toBe('Todas as semanas às 09:00');
    expect(recurrenceText(recurring({ every: 'week', interval: 2, at: at(9, 0) }), 'en')).toBe(
      'Every 2 weeks at 09:00',
    );
  });
});

describe('recurrenceText - monthly', () => {
  it('every month on a day of the month', () => {
    const spec = recurring({ every: 'month', monthDay: 1, at: at(8, 0) });
    expect(recurrenceText(spec, 'pt')).toBe('Todos os meses no dia 1, às 08:00');
    expect(recurrenceText(spec, 'en')).toBe('Every month on day 1 at 08:00');
  });

  it('every N months', () => {
    const spec = recurring({ every: 'month', interval: 3, monthDay: 15, at: at(12, 0) });
    expect(recurrenceText(spec, 'pt')).toBe('De 3 em 3 meses, no dia 15, às 12:00');
    expect(recurrenceText(spec, 'en')).toBe('Every 3 months on day 15 at 12:00');
  });

  it('falls back to a plain monthly sentence with no day of month', () => {
    expect(recurrenceText(recurring({ every: 'month', at: at(8, 0) }), 'pt')).toBe('Todos os meses às 08:00');
    expect(recurrenceText(recurring({ every: 'month', at: at(8, 0) }), 'en')).toBe('Every month at 08:00');
  });
});

describe('relativeNext', () => {
  const now = new Date('2026-08-17T10:00:00.000Z');
  const rtf = (lang: 'pt' | 'en') =>
    new Intl.RelativeTimeFormat(lang === 'pt' ? 'pt-PT' : 'en-GB', { numeric: 'auto', style: 'short' });

  it('says "agora" / "now" inside the minute either side', () => {
    expect(relativeNext('2026-08-17T10:00:20.000Z', 'pt', { now })).toBe('agora');
    expect(relativeNext('2026-08-17T09:59:45.000Z', 'en', { now })).toBe('now');
  });

  it('picks minutes under an hour', () => {
    expect(relativeNext('2026-08-17T10:20:00.000Z', 'pt', { now })).toBe(rtf('pt').format(20, 'minute'));
    expect(relativeNext('2026-08-17T10:20:00.000Z', 'en', { now })).toBe(rtf('en').format(20, 'minute'));
  });

  it('picks hours under a day', () => {
    expect(relativeNext('2026-08-17T12:00:00.000Z', 'pt', { now })).toBe(rtf('pt').format(2, 'hour'));
    expect(relativeNext('2026-08-17T12:00:00.000Z', 'en', { now })).toBe(rtf('en').format(2, 'hour'));
  });

  it('picks days under a month, and months beyond it', () => {
    expect(relativeNext('2026-08-22T10:00:00.000Z', 'pt', { now })).toBe(rtf('pt').format(5, 'day'));
    expect(relativeNext('2026-11-17T10:00:00.000Z', 'en', { now })).toBe(rtf('en').format(3, 'month'));
  });

  it('reads a past instant as past, not future', () => {
    expect(relativeNext('2026-08-17T08:00:00.000Z', 'pt', { now })).toBe(rtf('pt').format(-2, 'hour'));
  });

  it('is empty when there is no next run at all', () => {
    expect(relativeNext(null, 'pt', { now })).toBe('');
    expect(relativeNext(undefined, 'en', { now })).toBe('');
    expect(relativeNext('not-a-date', 'pt', { now })).toBe('');
  });
});

describe('weekdayChips', () => {
  it('offers all seven days, Monday first, in the locale short form', () => {
    const pt = weekdayChips('pt');
    expect(pt).toHaveLength(7);
    expect(pt.map((c) => c.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(pt.every((c) => c.label.length > 0 && !c.label.endsWith('.'))).toBe(true);
    expect(weekdayChips('en').map((c) => c.value)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });
});

describe('instant formatters', () => {
  it('formatOccurrence renders weekday + date + time in the given zone', () => {
    const text = formatOccurrence('2026-09-12T14:30:00.000Z', 'pt', UTC);
    expect(text).toContain('14:30');
    expect(text).toContain('12');
  });

  it('formatStamp renders date + time and passes through the unformattable', () => {
    expect(formatStamp('2026-09-12T14:30:00.000Z', 'en', UTC)).toContain('14:30');
    expect(formatStamp(null, 'pt')).toBe('');
    expect(formatStamp('nonsense', 'pt')).toBe('nonsense');
  });
});
