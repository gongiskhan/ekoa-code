/**
 * Speakable number normalization (BRIEF §5 TTS text pipeline, run 20260717-190134, slice C3).
 * New write per memos/c-voice-deviations.md (i): no speakable-numbers-pt exists anywhere in
 * the reference repo's history; only the jarvis-os toSpeakable() sanitizer idea (strip what
 * reads terribly aloud) is seeded, and the number work here is fresh.
 *
 * LOCATION (C5 decision, docs/decisions.md 2026-07-18): landed at C3 as web/lib/voice/
 * speakable.ts; RELOCATED here because the TTS text pipeline runs API-SIDE (the relay applies
 * sanitize -> normalize -> chunk to `say` text before the provider). FIXED-1 forbids api
 * importing web/ and web importing api/, shared/ is contract-only (zod schemas + descriptor
 * maps - a text transform is not contract), and a cross-boundary parity test would itself
 * violate the lint zones. The web playback client consumes AUDIO, not text, so the ONE copy
 * lives here; the C3 tests moved with it (api/tests/voice/speakable.test.ts), unchanged.
 *
 * normalizeNumbersPt / normalizeNumbersEn rewrite digit forms into words the TTS voices read
 * naturally: cardinals ("16" -> "dezasseis" in PT-PT, never pt-BR "dezesseis"), currency
 * ("€1.234,50" -> "mil duzentos e trinta e quatro euros e cinquenta cêntimos"), numeric dates,
 * percentages, clock times and decimals. Pure string -> string; no locale APIs, no Intl, no
 * dependencies. They sit AFTER the markdown sanitizer and BEFORE sentence chunking in the C5
 * pipeline (BRIEF §5), so input is already plain prose.
 *
 * Deliberate limits (v1): numbers at or above 10^12 and ordinal markers (1.º) are left as
 * digits; ungrouped integers of 7+ digits (phone numbers, NIFs, process ids) are read digit
 * by digit rather than as absurd cardinals. Signed and hyphen-ranged numbers (-16, 16-20) are
 * left as digits (no "menos"/range prose in v1); the rare minus-before-symbol form (-€16)
 * still speaks its magnitude. PT-PT long-scale naming: 10^9 is "mil milhões".
 */

/* ------------------------------- PT-PT cardinals ------------------------------- */

const PT_UNITS = [
  'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezasseis', 'dezassete', 'dezoito', 'dezanove',
];
const PT_TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const PT_HUNDREDS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos',
];

function ptUnit(n: number, feminine: boolean): string {
  if (feminine && n === 1) return 'uma';
  if (feminine && n === 2) return 'duas';
  return PT_UNITS[n]!; // n < 20, caller-guaranteed
}

/** 0..999 in PT-PT words; feminine agreement for 1/2 and the hundreds. */
function ptSubThousand(n: number, feminine: boolean): string {
  if (n < 20) return ptUnit(n, feminine);
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r === 0 ? PT_TENS[t]! : `${PT_TENS[t]} e ${ptUnit(r, feminine)}`;
  }
  if (n === 100) return 'cem';
  const h = Math.floor(n / 100);
  const r = n % 100;
  let hundred = PT_HUNDREDS[h]!; // 1..9 after the n === 100 branch
  if (feminine && h >= 2) hundred = hundred.replace(/os$/, 'as');
  return r === 0 ? hundred : `${hundred} e ${ptSubThousand(r, feminine)}`;
}

/** The PT "e" connector joins a scale group to a remainder only when the remainder is small
 *  (< 100) or a round hundred: "mil e quinhentos" but "mil duzentos e trinta e quatro". */
function ptScaleJoin(head: string, remainder: number, feminine: boolean, spellRemainder: (n: number) => string): string {
  if (remainder === 0) return head;
  const connector = remainder < 100 || remainder % 100 === 0 ? ' e ' : ' ';
  return `${head}${connector}${spellRemainder(remainder)}`;
}

/**
 * Integer to PT-PT words. Supports |n| < 10^12 ("mil milhões" long-scale naming); returns
 * null outside that range so callers can leave the digits untouched.
 */
export function cardinalPt(n: number, opts?: { feminine?: boolean }): string | null {
  if (!Number.isSafeInteger(n)) return null;
  const feminine = opts?.feminine ?? false;
  if (n < 0) {
    const abs = cardinalPt(-n, opts);
    return abs === null ? null : `menos ${abs}`;
  }
  if (n >= 1e12) return null;
  if (n < 1000) return ptSubThousand(n, feminine);
  const spellBelowMillion = (v: number): string => {
    if (v < 1000) return ptSubThousand(v, feminine);
    const t = Math.floor(v / 1000);
    const r = v % 1000;
    const head = t === 1 ? 'mil' : `${ptSubThousand(t, feminine)} mil`;
    return ptScaleJoin(head, r, feminine, (x) => ptSubThousand(x, feminine));
  };
  if (n < 1e6) return spellBelowMillion(n);
  const spellBelowThousandMillion = (v: number): string => {
    if (v < 1e6) return spellBelowMillion(v);
    const m = Math.floor(v / 1e6);
    const r = v % 1e6;
    const head = m === 1 ? 'um milhão' : `${spellBelowMillion(m)} milhões`;
    return ptScaleJoin(head, r, feminine, spellBelowMillion);
  };
  if (n < 1e9) return spellBelowThousandMillion(n);
  const b = Math.floor(n / 1e9);
  const r = n % 1e9;
  const head = b === 1 ? 'mil milhões' : `${ptSubThousand(b, feminine)} mil milhões`;
  return ptScaleJoin(head, r, feminine, spellBelowThousandMillion);
}

/* -------------------------------- EN cardinals -------------------------------- */

const EN_UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enSubThousand(n: number): string {
  if (n < 20) return EN_UNITS[n]!;
  if (n < 100) {
    const t = Math.floor(n / 10);
    const r = n % 10;
    return r === 0 ? EN_TENS[t]! : `${EN_TENS[t]}-${EN_UNITS[r]}`;
  }
  const h = Math.floor(n / 100);
  const r = n % 100;
  const head = `${EN_UNITS[h]} hundred`;
  return r === 0 ? head : `${head} and ${enSubThousand(r)}`;
}

/**
 * Integer to EN words (with the spoken "and": "one hundred and twenty-three"). Supports
 * |n| < 10^12; null outside that range.
 */
export function cardinalEn(n: number): string | null {
  if (!Number.isSafeInteger(n)) return null;
  if (n < 0) {
    const abs = cardinalEn(-n);
    return abs === null ? null : `minus ${abs}`;
  }
  if (n >= 1e12) return null;
  if (n < 1000) return enSubThousand(n);
  const groups: Array<{ value: number; name: string }> = [
    { value: Math.floor(n / 1e9), name: 'billion' },
    { value: Math.floor(n / 1e6) % 1000, name: 'million' },
    { value: Math.floor(n / 1e3) % 1000, name: 'thousand' },
  ];
  const parts: string[] = [];
  for (const g of groups) {
    if (g.value > 0) parts.push(`${enSubThousand(g.value)} ${g.name}`);
  }
  const r = n % 1000;
  if (r > 0) {
    // British-style "and" before a small final group: "one thousand and five".
    if (r < 100) return `${parts.join(' ')} and ${enSubThousand(r)}`;
    parts.push(enSubThousand(r));
  }
  return parts.join(' ');
}

/* ------------------------------ shared digit helpers ------------------------------ */

function digitsSpoken(digits: string, units: string[]): string {
  return digits.split('').map((d) => units[Number(d)]!).join(' ');
}

/** Parse "1.234" / "1,234" style grouped or plain integer strings. */
function parseInt10(s: string, groupSep: string): number {
  return Number(s.split(groupSep).join(''));
}

/**
 * True when a matched numeric token is NOT embedded in a longer punctuated digit chain.
 * Protects version numbers ("1.2.3"), non-date slashed references ("99/99/2026", processo
 * ids) and out-of-range groupings (left as digits by design) from being shredded into word
 * fragments by the later integer/decimal passes.
 */
// '-' included so a hyphen-ranged pair (16-20) leaves BOTH sides as digits rather than
// half-converting to "dezasseis-20".
const CHAIN_PUNCT = new Set(['.', ',', '/', '-']);

const ORDINAL_MARK = /[ºª]/;

function standalone(str: string, offset: number, length: number): boolean {
  const before = str[offset - 1];
  const before2 = str[offset - 2];
  if (before !== undefined && CHAIN_PUNCT.has(before) && before2 !== undefined && /\d/.test(before2)) return false;
  // A leading minus sign makes this a signed number; v1 leaves signed numbers as digits
  // rather than emit a mid-sentence "menos" that may not be intended.
  if (before === '-') return false;
  const after = str[offset + length];
  const after2 = str[offset + length + 1];
  if (after !== undefined && CHAIN_PUNCT.has(after) && after2 !== undefined && /\d/.test(after2)) return false;
  // Ordinal markers ("1.º", "2ª") are left as digits by design (file header): protect the
  // number when an ordinal mark follows directly or after a single dot.
  if (after !== undefined && ORDINAL_MARK.test(after)) return false;
  if (after === '.' && after2 !== undefined && ORDINAL_MARK.test(after2)) return false;
  return true;
}

const MONTHS_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const MONTHS_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function validDate(day: number, month: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/* --------------------------------- PT-PT pipeline --------------------------------- */

const PT_CURRENCY_UNITS: Record<string, { one: string; many: string }> = {
  '€': { one: 'euro', many: 'euros' },
  $: { one: 'dólar', many: 'dólares' },
};

function ptAmount(whole: number, centsRaw: string | undefined, symbol: string): string {
  const unit = PT_CURRENCY_UNITS[symbol]!; // symbol regex-constrained to €/$
  const cents = centsRaw === undefined ? 0 : Number(centsRaw.padEnd(2, '0'));
  const parts: string[] = [];
  if (whole > 0 || cents === 0) {
    const words = cardinalPt(whole);
    if (words === null) return `${whole} ${unit.many}`;
    // Round millions take "de": "um milhão de euros", "dois milhões de euros".
    const de = whole >= 1e6 && whole % 1e6 === 0 ? ' de' : '';
    parts.push(`${words}${de} ${whole === 1 ? unit.one : unit.many}`);
  }
  if (cents > 0) {
    parts.push(`${cardinalPt(cents)} ${cents === 1 ? 'cêntimo' : 'cêntimos'}`);
  }
  return parts.join(' e ');
}

function ptDecimal(wholeStr: string, fracStr: string, groupSep: string): string {
  const whole = cardinalPt(parseInt10(wholeStr, groupSep));
  if (whole === null) return `${wholeStr},${fracStr}`;
  const frac =
    fracStr.length <= 2 && !fracStr.startsWith('0')
      ? cardinalPt(Number(fracStr))
      : digitsSpoken(fracStr, PT_UNITS);
  return `${whole} vírgula ${frac}`;
}

function ptInteger(s: string, groupSep: string): string {
  const digits = s.split(groupSep).join('');
  // Ungrouped long runs are ids (NIF, phone, processo): digit-by-digit reads correctly.
  if (!s.includes(groupSep) && digits.length >= 7) return digitsSpoken(digits, PT_UNITS);
  const words = cardinalPt(Number(digits));
  return words === null ? s : words;
}

/**
 * Rewrite digit forms in PT-PT prose into speakable words: dates (16/07/2026, 2026-07-16),
 * currency (€1.234,50 / 1.234,50 €, also $), percentages, clock times (16h30, 16:30),
 * decimals (3,5) and integers. Idempotent on text without digits.
 */
export function normalizeNumbersPt(text: string): string {
  if (!/\d/.test(text)) return text;
  let out = text;

  // ISO date 2026-07-16.
  out = out.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m, y, mo, d) => {
    const month = Number(mo);
    const day = Number(d);
    if (!validDate(day, month)) return m;
    return `${cardinalPt(day)} de ${MONTHS_PT[month - 1]} de ${cardinalPt(Number(y))}`;
  });

  // PT date 16/07/2026 or 16-07-2026 (day first).
  out = out.replace(/\b(\d{1,2})([/-])(\d{1,2})\2(\d{4})\b/g, (m, d, _sep, mo, y) => {
    const month = Number(mo);
    const day = Number(d);
    if (!validDate(day, month)) return m;
    return `${cardinalPt(day)} de ${MONTHS_PT[month - 1]} de ${cardinalPt(Number(y))}`;
  });

  // Currency, symbol before or after: €1.234,50 / 1.234,50 € / $20. A leading minus leaves the
  // signed amount as digits (v1 does not speak signs; see standalone()).
  out = out.replace(
    /(?<!-)([€$])\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g,
    (_m, sym, whole, cents) => ptAmount(parseInt10(whole, '.'), cents, sym),
  );
  out = out.replace(
    /(?<!-)\b(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s?([€$])/g,
    (_m, whole, cents, sym) => ptAmount(parseInt10(whole, '.'), cents, sym),
  );

  // Percentages: 15% / 3,5%.
  out = out.replace(/(?<!-)\b(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?\s?%/g, (_m, whole, frac) => {
    const spoken = frac === undefined ? ptInteger(whole, '.') : ptDecimal(whole, frac, '.');
    return `${spoken} por cento`;
  });

  // Clock: 16h / 16h30 (feminine hours: "uma hora", "duas horas").
  out = out.replace(/\b(\d{1,2})h(\d{2})?\b/g, (m, h, min) => {
    const hour = Number(h);
    const minute = min === undefined ? 0 : Number(min);
    if (minute > 59) return m;
    const hours = `${cardinalPt(hour, { feminine: true })} ${hour === 1 ? 'hora' : 'horas'}`;
    return minute === 0 ? hours : `${hours} e ${cardinalPt(minute, { feminine: true })}`;
  });
  out = out.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!:)/g, (_m, h, min) => {
    const hour = Number(h);
    const minute = Number(min);
    const hours = `${cardinalPt(hour, { feminine: true })} ${hour === 1 ? 'hora' : 'horas'}`;
    return minute === 0 ? hours : `${hours} e ${cardinalPt(minute, { feminine: true })}`;
  });

  // Decimals: 1.234,56 then 3,5.
  out = out.replace(/\b(\d{1,3}(?:\.\d{3})+),(\d+)\b/g, (m, whole, frac, offset, str) =>
    standalone(str, offset, m.length) ? ptDecimal(whole, frac, '.') : m,
  );
  out = out.replace(/\b(\d+),(\d+)\b/g, (m, whole, frac, offset, str) =>
    standalone(str, offset, m.length) ? ptDecimal(whole, frac, '.') : m,
  );

  // Grouped integers 1.234, then remaining plain integers.
  out = out.replace(/\b\d{1,3}(?:\.\d{3})+\b/g, (m, offset, str) =>
    standalone(str, offset, m.length) ? ptInteger(m, '.') : m,
  );
  out = out.replace(/\b\d+\b/g, (m, offset, str) =>
    standalone(str, offset, m.length) ? ptInteger(m, '.') : m,
  );

  return out;
}

/* ---------------------------------- EN pipeline ---------------------------------- */

const EN_ORDINAL_SPECIAL: Record<number, string> = {
  1: 'first', 2: 'second', 3: 'third', 5: 'fifth', 8: 'eighth', 9: 'ninth', 12: 'twelfth',
  20: 'twentieth', 30: 'thirtieth',
};

/** Day-of-month ordinal, 1..31. */
function ordinalEn(n: number): string {
  const special = EN_ORDINAL_SPECIAL[n];
  if (special) return special;
  if (n > 20) {
    const unit = n % 10;
    const tens = EN_TENS[Math.floor(n / 10)]!; // 21..31 -> index 2..3
    return unit === 0 ? `${tens.replace(/y$/, 'ie')}th` : `${tens}-${ordinalEn(unit)}`;
  }
  return `${EN_UNITS[n]}th`;
}

/** Spoken year: "nineteen ninety-nine", "twenty twenty-six", "two thousand", "two thousand and six". */
function yearEn(y: number): string {
  if (y < 1100 || (y >= 2000 && y < 2010)) return cardinalEn(y) as string;
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  if (lo === 0) return `${enSubThousand(hi)} hundred`;
  if (lo < 10) return `${enSubThousand(hi)} oh ${EN_UNITS[lo]!}`;
  return `${enSubThousand(hi)} ${enSubThousand(lo)}`;
}

const EN_CURRENCY_UNITS: Record<string, { one: string; many: string }> = {
  $: { one: 'dollar', many: 'dollars' },
  '€': { one: 'euro', many: 'euros' },
};

function enAmount(whole: number, centsRaw: string | undefined, symbol: string): string {
  const unit = EN_CURRENCY_UNITS[symbol]!; // symbol regex-constrained to €/$
  const cents = centsRaw === undefined ? 0 : Number(centsRaw.padEnd(2, '0'));
  const parts: string[] = [];
  if (whole > 0 || cents === 0) {
    const words = cardinalEn(whole);
    if (words === null) return `${whole} ${unit.many}`;
    parts.push(`${words} ${whole === 1 ? unit.one : unit.many}`);
  }
  if (cents > 0) parts.push(`${cardinalEn(cents)} ${cents === 1 ? 'cent' : 'cents'}`);
  return parts.join(' and ');
}

function enDecimal(wholeStr: string, fracStr: string): string {
  const whole = cardinalEn(parseInt10(wholeStr, ','));
  if (whole === null) return `${wholeStr}.${fracStr}`;
  // EN convention reads decimals digit by digit: 3.14 -> "three point one four".
  return `${whole} point ${digitsSpoken(fracStr, EN_UNITS)}`;
}

function enInteger(s: string): string {
  const digits = s.split(',').join('');
  if (!s.includes(',') && digits.length >= 7) return digitsSpoken(digits, EN_UNITS);
  const words = cardinalEn(Number(digits));
  return words === null ? s : words;
}

/**
 * EN counterpart of normalizeNumbersPt: dates (2026-07-16, 07/16/2026 month first), currency
 * ($1,234.50 / €20), percentages, clock times (16:30), decimals (3.5) and integers.
 */
export function normalizeNumbersEn(text: string): string {
  if (!/\d/.test(text)) return text;
  let out = text;

  // ISO date 2026-07-16.
  out = out.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m, y, mo, d) => {
    const month = Number(mo);
    const day = Number(d);
    if (!validDate(day, month)) return m;
    return `${MONTHS_EN[month - 1]} ${ordinalEn(day)}, ${yearEn(Number(y))}`;
  });

  // US date 07/16/2026 (month first).
  out = out.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, mo, d, y) => {
    const month = Number(mo);
    const day = Number(d);
    if (!validDate(day, month)) return m;
    return `${MONTHS_EN[month - 1]} ${ordinalEn(day)}, ${yearEn(Number(y))}`;
  });

  // Currency: $1,234.50 / €20 (symbol before; trailing-symbol form also accepted).
  out = out.replace(
    /([€$])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g,
    (_m, sym, whole, cents) => enAmount(parseInt10(whole, ','), cents, sym),
  );
  out = out.replace(
    /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?([€$])/g,
    (_m, whole, cents, sym) => enAmount(parseInt10(whole, ','), cents, sym),
  );

  // Percentages: 15% / 3.5%.
  out = out.replace(/\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s?%/g, (_m, whole, frac) => {
    const spoken = frac === undefined ? enInteger(whole) : enDecimal(whole, frac);
    return `${spoken} percent`;
  });

  // Clock: 16:30 -> "sixteen thirty", 16:05 -> "sixteen oh five", 16:00 -> "sixteen o'clock".
  out = out.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b(?!:)/g, (_m, h, min) => {
    const hour = Number(h);
    const minute = Number(min);
    if (minute === 0) return `${cardinalEn(hour)} o'clock`;
    if (minute < 10) return `${cardinalEn(hour)} oh ${EN_UNITS[minute]!}`;
    return `${cardinalEn(hour)} ${enSubThousand(minute)}`;
  });

  // Decimals: 1,234.56 then 3.5.
  out = out.replace(/\b(\d{1,3}(?:,\d{3})+)\.(\d+)\b/g, (m, whole, frac, offset, str) =>
    standalone(str, offset, m.length) ? enDecimal(whole, frac) : m,
  );
  out = out.replace(/\b(\d+)\.(\d+)\b/g, (m, whole, frac, offset, str) =>
    standalone(str, offset, m.length) ? enDecimal(whole, frac) : m,
  );

  // Grouped integers 1,234, then remaining plain integers.
  out = out.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m, offset, str) =>
    standalone(str, offset, m.length) ? enInteger(m) : m,
  );
  out = out.replace(/\b\d+\b/g, (m, offset, str) =>
    standalone(str, offset, m.length) ? enInteger(m) : m,
  );

  return out;
}
