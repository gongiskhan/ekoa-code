/**
 * Formatting helpers for PT-PT locale.
 */

const EUR = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatEUR(value) {
  const n = Number(value || 0);
  if (Number.isNaN(n)) return EUR.format(0);
  return EUR.format(n);
}

const LONG_DATE = new Intl.DateTimeFormat('pt-PT', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const SHORT_DATE = new Intl.DateTimeFormat('pt-PT', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const MONTH_YEAR = new Intl.DateTimeFormat('pt-PT', {
  month: 'long',
  year: 'numeric',
});

export function formatLongDate(iso) {
  const d = toDate(iso);
  if (!d) return '—';
  return LONG_DATE.format(d);
}

export function formatShortDate(iso) {
  const d = toDate(iso);
  if (!d) return '—';
  return SHORT_DATE.format(d);
}

export function formatMonthYear(year, month0) {
  return MONTH_YEAR.format(new Date(year, month0, 1));
}

export function formatDuration(minutes) {
  const m = Number(minutes || 0);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? h + 'h ' + rest + ' min' : h + 'h';
}

function toDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toYMD(d) {
  if (!(d instanceof Date)) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function parseYMD(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
