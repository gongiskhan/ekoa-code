/*
 * Utilitários de datas - puros, calendário LOCAL (Europe/Lisbon safe). Datas
 * só-de-dia circulam como 'YYYY-MM-DD'; nunca se constrói `new Date('YYYY-MM-DD')`
 * diretamente (seria meia-noite UTC e, a oeste de UTC, o dia anterior).
 */

/** Devolve um Date local válido ou null. Aceita 'YYYY-MM-DD' ou ISO completo. */
export function parseDia(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) {
      return null; // 2026-02-30 e afins
    }
    return d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 'YYYY-MM-DD' local de um Date (ou de hoje). */
export function diaISO(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Hoje como 'YYYY-MM-DD' local. */
export function hojeISO() {
  return diaISO(new Date());
}

/** Adiciona `dias` a 'YYYY-MM-DD'; devolve 'YYYY-MM-DD' ou null. */
export function addDias(dataStr, dias) {
  const d = parseDia(dataStr);
  if (!d) return null;
  d.setDate(d.getDate() + Number(dias || 0));
  return diaISO(d);
}

/**
 * Dias inteiros de ATRASO de `dataVencimento` face a `hoje` (positivo = vencido
 * há N dias; <= 0 = ainda por vencer). NaN quando a data é inválida.
 */
export function diasAtraso(dataVencimento, hoje = new Date()) {
  const venc = parseDia(dataVencimento);
  const ref = parseDia(hoje);
  if (!venc || !ref) return NaN;
  return Math.round((ref.getTime() - venc.getTime()) / 86400000);
}

/**
 * Interpreta datas de extratos/faturas em formatos comuns PT:
 * 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD/MM/YY', 'YYYY-MM-DD'.
 * Devolve 'YYYY-MM-DD' ou null.
 */
export function parseDataFlex(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return parseDia(s) ? s : null;
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y >= 70 ? 1900 : 2000;
    const iso = `${y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
    return parseDia(iso) ? iso : null;
  }
  return null;
}

/**
 * Escalões de envelhecimento da dívida (brief: 0-30, 31-60, 61-90, 90+ dias de
 * atraso). Um item por vencer (atraso <= 0) cai no primeiro escalão.
 */
export const AGING_BUCKETS = [
  { id: '0-30', min: -Infinity, max: 30 },
  { id: '31-60', min: 31, max: 60 },
  { id: '61-90', min: 61, max: 90 },
  { id: '90+', min: 91, max: Infinity },
];

/** Id do escalão de um número de dias de atraso, ou null se inválido. */
export function agingBucket(dias) {
  if (!Number.isFinite(dias)) return null;
  for (const b of AGING_BUCKETS) {
    if (dias >= b.min && dias <= b.max) return b.id;
  }
  return null;
}
