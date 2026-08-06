/*
 * Utilitários monetários (EUR) - puros, sem React nem I/O. Convenções da suite
 * jurídica: valores em euros com 2 casas, aritmética interna em cêntimos
 * (inteiros) para não acumular erro de vírgula flutuante.
 */

/** Arredonda ao cêntimo - um valor monetário é dinheiro, não uma fração. */
export function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Soma de valores em cêntimos; devolve euros com 2 casas. */
export function somaEuros(valores) {
  let cents = 0;
  for (const v of Array.isArray(valores) ? valores : []) {
    const n = Number(v);
    if (Number.isFinite(n)) cents += Math.round(n * 100);
  }
  return cents / 100;
}

/** Euros -> cêntimos (inteiro). */
export function eurosParaCentavos(v) {
  return Math.round(Number(v) * 100);
}

/** Cêntimos -> euros (2 casas). */
export function centavosParaEuros(c) {
  return Math.round(c) / 100;
}

/**
 * Interpreta um montante em formato português OU internacional:
 *  "1 234,56" / "1.234,56" / "1234.56" / "-12,30" / "442,80 €" -> number.
 * Devolve null quando não é interpretável como montante.
 */
export function parseMontante(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? round2(raw) : null;
  if (typeof raw !== 'string') return null;
  let s = raw.trim().replace(/[€\s ]/g, '');
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Ambos presentes: o ÚLTIMO separador é o decimal.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // Só vírgula: decimal quando tem 1-2 casas à direita; senão milhares.
    const frac = s.length - lastComma - 1;
    s = frac >= 1 && frac <= 2 && s.indexOf(',') === lastComma
      ? s.replace(',', '.')
      : s.replace(/,/g, '');
  } else if (lastDot >= 0) {
    const frac = s.length - lastDot - 1;
    // "1.234" (3 casas) é milhares pt; "1234.56" é decimal.
    if (!(frac >= 1 && frac <= 2 && s.indexOf('.') === lastDot)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return round2(negative ? -n : n);
}

/** Formata euros em PT-PT ("1 234,56 €") ou EN ("€1,234.56"). */
export function formatEur(value, lang = 'pt') {
  if (value == null || Number.isNaN(Number(value))) return '—';
  try {
    return Number(value).toLocaleString(lang === 'en' ? 'en-IE' : 'pt-PT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return `${Number(value).toFixed(2)} €`;
  }
}
