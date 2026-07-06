/*
 * Vocabulário e utilitários de datas do módulo de Agenda: rótulos e tons
 * (badges) de estado de reserva e de tipo de evento, e helpers de semana/hora
 * PT-PT. Mantém as páginas magras e as etiquetas consistentes. NÃO contém a
 * lógica de slots nem de confirmação — essa vive no motor determinístico
 * (engine/agenda.mjs), testado.
 */

export const DOW_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/* ---------- Estado da reserva ---------- */

const RESERVA_META = {
  hold: { label: 'Em espera', tone: 'neutral' },
  pendente_pagamento: { label: 'Aguarda pagamento', tone: 'media' },
  confirmada: { label: 'Confirmada', tone: 'ok' },
  cancelada: { label: 'Cancelada', tone: 'alta' },
  expirada: { label: 'Expirada', tone: 'neutral' },
};

export function reservaEstadoLabel(e) { return (RESERVA_META[e] || {}).label || e || '—'; }
export function reservaEstadoTone(e) { return (RESERVA_META[e] || {}).tone || 'neutral'; }

/* Estados que ainda "ocupam" um horário (para destacar na lista). */
export function reservaActiva(e) { return e === 'hold' || e === 'pendente_pagamento' || e === 'confirmada'; }

/* ---------- Tipo de evento ---------- */

const EVENTO_META = {
  audiencia: { label: 'Audiência', tone: 'alta' },
  juntada: { label: 'Juntada', tone: 'info' },
  despacho: { label: 'Despacho', tone: 'media' },
  reserva: { label: 'Reserva', tone: 'ok' },
  outro: { label: 'Outro', tone: 'neutral' },
};

export function eventoTipoLabel(t) { return (EVENTO_META[t] || {}).label || t || 'Evento'; }
export function eventoTipoTone(t) { return (EVENTO_META[t] || {}).tone || 'neutral'; }

/* ---------- Datas / horas ---------- */

function pad2(n) { return String(n).padStart(2, '0'); }

/* Date -> 'YYYY-MM-DD' no calendário LOCAL. */
export function ymdLocal(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

/*
 * Instante local em relógio de parede 'YYYY-MM-DDTHH:mm:ss' — o referencial em
 * que o motor compara `agora`. As páginas passam SEMPRE isto ao motor para que
 * os slots e o corte de "já passou" fiquem coerentes com o relógio local.
 */
export function agoraLocal() {
  const d = new Date();
  return `${ymdLocal(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/* A semana (7 'YYYY-MM-DD', Segunda→Domingo) que contém `base` (Date). */
export function semanaDe(base) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const dow = d.getDay(); // 0=Dom..6=Sáb
  const deltaSegunda = dow === 0 ? -6 : 1 - dow;
  const seg = new Date(d);
  seg.setDate(d.getDate() + deltaSegunda);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(seg);
    x.setDate(seg.getDate() + i);
    return ymdLocal(x);
  });
}

/* 'YYYY-MM-DDTHH:mm:ss' -> 'HH:MM'. */
export function horaDe(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(String(iso || ''));
  return m ? `${m[1]}:${m[2]}` : '';
}

/* Componente de data 'YYYY-MM-DD' de um instante ISO ou de uma data só-de-dia. */
export function dataDe(iso) { return String(iso || '').slice(0, 10); }

/* Rótulo curto de coluna: 'Seg 6'. */
export function rotuloDia(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${DOW_CURTO[d.getDay()]} ${Number(m[3])}`;
}

/* 'YYYY-MM-DD' é hoje (calendário local)? */
export function ehHoje(ymd) { return ymd === ymdLocal(new Date()); }
