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

/* ---------- Sobreposições de participantes ---------- */

/* Estados de reserva que ocupam a agenda (espelha ESTADOS_OCUPAM do motor). */
const ESTADOS_QUE_OCUPAM = ['hold', 'pendente_pagamento', 'confirmada'];

/*
 * Detecta sobreposições de horário POR PARTICIPANTE nos dias dados, sobre as
 * marcações COM hora: reservas activas (participantes = participantesNecessarios
 * do tipo de sessão) e eventos com inicio+fim+pessoaIds (os derivados de
 * reservas são ignorados quando a própria reserva já conta, para não se
 * sobreporem a si mesmos). Eventos só-de-dia não têm hora - ficam de fora,
 * honestamente. Puro e determinista; comparação lexicográfica dos instantes
 * de relógio de parede 'YYYY-MM-DDTHH:mm:ss'.
 *
 * Devolve [{ pessoaId, a, b }] com a/b = { rotulo, inicio, fim }, ordenado.
 */
export function sobreposicoesDeParticipantes({ eventos = [], reservas = [], sessaoTipos = [], dias = [] }) {
  const diasSet = new Set(dias);
  const porTipo = new Map((sessaoTipos || []).map((t) => [t.id, t]));
  const itensPorPessoa = new Map();
  const marcar = (pessoaId, item) => {
    if (!pessoaId) return;
    if (!itensPorPessoa.has(pessoaId)) itensPorPessoa.set(pessoaId, []);
    itensPorPessoa.get(pessoaId).push(item);
  };

  const reservasContadas = new Set();
  for (const r of reservas || []) {
    if (!r || !ESTADOS_QUE_OCUPAM.includes(r.estado)) continue;
    if (!diasSet.has(dataDe(r.inicio))) continue;
    const tipo = porTipo.get(r.sessaoTipoId);
    const participantes = (tipo && Array.isArray(tipo.participantesNecessarios))
      ? tipo.participantesNecessarios.filter(Boolean) : [];
    if (participantes.length === 0) continue;
    reservasContadas.add(r.id);
    const rotulo = `${(tipo && tipo.nome) || 'Sessão'} - ${r.nome || 'Cliente'}`;
    for (const p of participantes) marcar(p, { rotulo, inicio: String(r.inicio), fim: String(r.fim) });
  }

  for (const e of eventos || []) {
    if (!e || !e.inicio || !e.fim || !Array.isArray(e.pessoaIds) || e.pessoaIds.length === 0) continue;
    if (!diasSet.has(dataDe(e.inicio))) continue;
    if (e.reservaId && reservasContadas.has(e.reservaId)) continue;
    for (const p of e.pessoaIds.filter(Boolean)) {
      marcar(p, { rotulo: e.titulo || 'Evento', inicio: String(e.inicio), fim: String(e.fim) });
    }
  }

  const conflitos = [];
  for (const [pessoaId, itens] of itensPorPessoa) {
    itens.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fim.localeCompare(b.fim));
    for (let i = 0; i < itens.length; i += 1) {
      for (let j = i + 1; j < itens.length; j += 1) {
        const a = itens[i];
        const b = itens[j];
        if (b.inicio >= a.fim) break; // ordenado: mais nada colide com `a`
        conflitos.push({ pessoaId, a, b });
      }
    }
  }
  conflitos.sort((x, y) => x.a.inicio.localeCompare(y.a.inicio) || String(x.pessoaId).localeCompare(String(y.pessoaId)));
  return conflitos;
}
