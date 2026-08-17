/**
 * Schedule recurrence humaniser - the ONE place a `ScheduleSpec` becomes a sentence a
 * person reads ("Todos os dias às 09:00"). Pure, no React, no store, no network, so the
 * list row, the detail header and the form preview all say exactly the same thing.
 *
 * Language names (weekdays, months, the "and" in a list, relative times) come from `Intl`
 * with the right locale rather than from hand-written tables: PT-PT is the primary copy
 * and its grammar (lower-case weekdays, "12 de set", "dentro de 2 h") is ICU's, not ours.
 * The two hand-written parts are the CADENCE sentence frames (below) and the plural rule
 * that turns ICU's "segunda-feira" into the "segundas" a cadence sentence needs.
 *
 * Occurrence MATH is never done here - the server owns it (`schedules.preview`); this
 * module only renders instants the server (or the contract) already decided.
 */
import type { RecurrenceRule, ScheduleSpec } from '@ekoa/shared';

export type ScheduleLang = 'pt' | 'en';

/** PT-PT is the product's primary copy; en-GB keeps day-month order and a 24h clock. */
const LOCALES: Record<ScheduleLang, string> = { pt: 'pt-PT', en: 'en-GB' };

export interface FormatOptions {
  /** IANA zone the instant is rendered in. Defaults to the viewer's own zone. */
  timeZone?: string;
}

// ---------------------------------------------------------------------------------------
// Small locale primitives
// ---------------------------------------------------------------------------------------

/** Wall-clock time of day, zero-padded 24h. Deliberately locale-independent. */
function timeOfDay(at?: { hour: number; minute: number }): string | null {
  if (!at) return null;
  return `${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}`;
}

/**
 * Plural weekday name for a cadence sentence: "segundas", "sábados", "Mondays".
 * ICU gives the singular ("segunda-feira" / "Monday"); PT drops the "-feira" tail first.
 * Every resulting stem ends in a vowel, so a bare "s" is the correct plural in both.
 */
function weekdayPlural(dayOfWeek: number, lang: ScheduleLang): string {
  // 2026-02-01 was a Sunday, so +dayOfWeek (0 = Sunday) lands on the right weekday.
  const day = new Date(Date.UTC(2026, 1, 1 + dayOfWeek));
  const name = new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long', timeZone: 'UTC' }).format(day);
  const stem = lang === 'pt' ? name.replace(/-feira$/, '') : name;
  return `${stem}s`;
}

/** "segundas e quartas" / "Mondays and Wednesdays". */
function joinList(parts: string[], lang: ScheduleLang): string {
  if (parts.length <= 1) return parts[0] ?? '';
  try {
    return new Intl.ListFormat(LOCALES[lang], { style: 'long', type: 'conjunction' }).format(parts);
  } catch {
    // Environments without Intl.ListFormat still get readable copy.
    const conjunction = lang === 'pt' ? 'e' : 'and';
    return `${parts.slice(0, -1).join(', ')} ${conjunction} ${parts[parts.length - 1]}`;
  }
}

/**
 * Weekdays in reading order. Both locales start the week on Monday, while the contract
 * numbers Sunday as 0 - so sort on a Monday-first key, never on the raw number.
 */
function weekdaysInReadingOrder(weekdays: number[]): number[] {
  return [...new Set(weekdays)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

/** "12 de set" / "12 Sept" - the short date grammar of each locale, without ICU's trailing dot. */
function shortDate(date: Date, lang: ScheduleLang, opts?: FormatOptions): string {
  const locale = LOCALES[lang];
  const day = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: opts?.timeZone }).format(date);
  const month = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: opts?.timeZone })
    .format(date)
    .replace(/\.$/, '');
  return lang === 'pt' ? `${day} de ${month}` : `${day} ${month}`;
}

function clockOf(date: Date, lang: ScheduleLang, opts?: FormatOptions): string {
  return new Intl.DateTimeFormat(LOCALES[lang], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: opts?.timeZone,
  }).format(date);
}

// ---------------------------------------------------------------------------------------
// Cadence sentences
// ---------------------------------------------------------------------------------------

const WORKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [0, 6];

function sameDays(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((d) => set.has(d));
}

function everyN(n: number, unitPt: string, unitEn: string, lang: ScheduleLang): string {
  return lang === 'pt' ? `De ${n} em ${n} ${unitPt}` : `Every ${n} ${unitEn}`;
}

function recurrenceSentence(rule: RecurrenceRule, lang: ScheduleLang): string {
  const n = rule.interval ?? 1;
  const single = n === 1;
  const time = timeOfDay(rule.at);
  // PT reads "..., às 09:00" after a clause and "... às 09:00" after a bare noun phrase;
  // EN uses " at 09:00" in both positions.
  const at = time ? (lang === 'pt' ? ` às ${time}` : ` at ${time}`) : '';
  const atClause = time ? (lang === 'pt' ? `, às ${time}` : ` at ${time}`) : '';

  switch (rule.every) {
    case 'minute':
      if (single) return lang === 'pt' ? 'Todos os minutos' : 'Every minute';
      return everyN(n, 'minutos', 'minutes', lang);

    case 'hour':
      if (single) return lang === 'pt' ? 'Todas as horas' : 'Every hour';
      return everyN(n, 'horas', 'hours', lang);

    case 'day':
      if (single) return lang === 'pt' ? `Todos os dias${at}` : `Every day${at}`;
      return `${everyN(n, 'dias', 'days', lang)}${atClause}`;

    case 'week': {
      const days = rule.weekdays?.length ? weekdaysInReadingOrder(rule.weekdays) : [];
      if (days.length === 0) {
        if (single) return lang === 'pt' ? `Todas as semanas${at}` : `Every week${at}`;
        return `${everyN(n, 'semanas', 'weeks', lang)}${atClause}`;
      }
      if (single) {
        // Named day-sets read far better than an enumeration of all seven / all five.
        if (days.length === 7) return lang === 'pt' ? `Todos os dias${at}` : `Every day${at}`;
        if (sameDays(days, WORKDAYS)) {
          return lang === 'pt' ? `Nos dias úteis${atClause}` : `On weekdays${at}`;
        }
        if (sameDays(days, WEEKEND)) {
          return lang === 'pt' ? `Aos fins de semana${atClause}` : `On weekends${at}`;
        }
      }
      const list = joinList(days.map((d) => weekdayPlural(d, lang)), lang);
      const tail = time ? `, ${time}` : '';
      if (single) return lang === 'pt' ? `Às ${list}${tail}` : `On ${list}${tail}`;
      return lang === 'pt'
        ? `De ${n} em ${n} semanas, às ${list}${tail}`
        : `Every ${n} weeks on ${list}${tail}`;
    }

    case 'month': {
      const day = rule.monthDay;
      if (day === undefined) {
        if (single) return lang === 'pt' ? `Todos os meses${at}` : `Every month${at}`;
        return `${everyN(n, 'meses', 'months', lang)}${atClause}`;
      }
      if (single) {
        return lang === 'pt'
          ? `Todos os meses no dia ${day}${atClause}`
          : `Every month on day ${day}${at}`;
      }
      return lang === 'pt'
        ? `De ${n} em ${n} meses, no dia ${day}${atClause}`
        : `Every ${n} months on day ${day}${at}`;
    }

    default:
      return lang === 'pt' ? 'Recorrente' : 'Recurring';
  }
}

// ---------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------

/**
 * The one-line human rendering of a schedule's timing.
 *
 * pt: "Uma vez, 12 de set, 14:30" / "Todos os dias às 09:00" / "De 2 em 2 horas"
 * en: "Once, 12 Sept, 14:30" / "Every day at 09:00" / "Every 2 hours"
 */
export function recurrenceText(spec: ScheduleSpec, lang: ScheduleLang, opts?: FormatOptions): string {
  if (!spec) return '';
  if (spec.kind === 'once') {
    const date = new Date(spec.at);
    if (Number.isNaN(date.getTime())) return lang === 'pt' ? 'Uma vez' : 'Once';
    const when = `${shortDate(date, lang, opts)}, ${clockOf(date, lang, opts)}`;
    return lang === 'pt' ? `Uma vez, ${when}` : `Once, ${when}`;
  }
  return recurrenceSentence(spec.rule, lang);
}

/**
 * How far away the next fire is, in words: "dentro de 2 h", "amanhã", "há 3 min",
 * "agora" / "in 2 hr", "tomorrow", "now". Empty string when there is no next fire
 * (a disabled schedule, or a `once` that already ran) - the caller decides what to
 * show instead, because "never again" and "paused" are different sentences.
 */
export function relativeNext(
  nextRunAt: string | null | undefined,
  lang: ScheduleLang,
  opts?: { now?: Date },
): string {
  if (!nextRunAt) return '';
  const target = new Date(nextRunAt);
  if (Number.isNaN(target.getTime())) return '';
  const now = opts?.now ?? new Date();
  const deltaSeconds = Math.round((target.getTime() - now.getTime()) / 1000);

  if (Math.abs(deltaSeconds) < 60) return lang === 'pt' ? 'agora' : 'now';

  const rtf = new Intl.RelativeTimeFormat(LOCALES[lang], { numeric: 'auto', style: 'short' });
  const abs = Math.abs(deltaSeconds);
  const sign = deltaSeconds < 0 ? -1 : 1;
  if (abs < 3600) return rtf.format(sign * Math.round(abs / 60), 'minute');
  if (abs < 86_400) return rtf.format(sign * Math.round(abs / 3600), 'hour');
  if (abs < 2_592_000) return rtf.format(sign * Math.round(abs / 86_400), 'day');
  return rtf.format(sign * Math.round(abs / 2_592_000), 'month');
}

/**
 * One occurrence rendered in full for the form's preview list and the run history:
 * weekday + date + time, in the locale's own grammar.
 */
export function formatOccurrence(iso: string, lang: ScheduleLang, opts?: FormatOptions): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALES[lang], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: opts?.timeZone,
  }).format(date);
}

/**
 * The weekday toggles of the recurrence form, in reading order (Monday first) with the
 * locale's own short names. Derived from `Intl` for the same reason the sentences are:
 * "seg" / "Mon" is a calendar fact, not product copy someone should translate by hand.
 */
export function weekdayChips(lang: ScheduleLang): Array<{ value: number; label: string }> {
  return weekdaysInReadingOrder([0, 1, 2, 3, 4, 5, 6]).map((value) => {
    const day = new Date(Date.UTC(2026, 1, 1 + value));
    const label = new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'short', timeZone: 'UTC' })
      .format(day)
      .replace(/\.$/, '');
    return { value, label };
  });
}

/** Date + time without the weekday - for planned/fired stamps in dense rows. */
export function formatStamp(iso: string | null | undefined, lang: ScheduleLang, opts?: FormatOptions): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${shortDate(date, lang, opts)}, ${clockOf(date, lang, opts)}`;
}
