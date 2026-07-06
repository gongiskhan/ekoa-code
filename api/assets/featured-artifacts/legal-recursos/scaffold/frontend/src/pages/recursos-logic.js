/*
 * Vocabulário partilhado do módulo de Recursos Humanos: rótulos e tons (badges)
 * de papel, tipo de ausência e estado, mais utilitários de datas do mapa de
 * férias. Mantém as páginas magras e as etiquetas consistentes. PT-PT, sem
 * emoji. NÃO contém lógica de negócio de férias - essa vive no motor
 * (engine/ferias.mjs), determinístico e testado.
 */

/* ---------- Papel (função na equipa) ---------- */

export const PAPEL_META = {
  advogado: { label: 'Advogado/a', tone: 'info' },
  estagiario: { label: 'Advogado/a estagiário/a', tone: 'media' },
  administrativo: { label: 'Administrativo/a', tone: 'neutral' },
};

export function papelLabel(papel) {
  return (PAPEL_META[papel] || {}).label || papel || '—';
}

export function papelTone(papel) {
  return (PAPEL_META[papel] || {}).tone || 'neutral';
}

/* As pessoas com inscrição na CPAS (advogados e advogados estagiários). */
export function descontaCpas(pessoa) {
  if (!pessoa) return false;
  if (typeof pessoa.cpas === 'boolean') return pessoa.cpas;
  return pessoa.papel === 'advogado' || pessoa.papel === 'estagiario';
}

/* ---------- Tipo de ausência ---------- */

export const AUSENCIA_TIPOS = [
  { value: 'ferias', label: 'Férias' },
  { value: 'baixa', label: 'Baixa' },
  { value: 'formacao', label: 'Formação' },
  { value: 'outro', label: 'Outro' },
];

const TIPO_META = {
  ferias: { label: 'Férias', tone: 'info' },
  baixa: { label: 'Baixa', tone: 'alta' },
  formacao: { label: 'Formação', tone: 'media' },
  outro: { label: 'Outro', tone: 'neutral' },
};

export function tipoLabel(tipo) {
  return (TIPO_META[tipo] || {}).label || tipo || '—';
}

export function tipoTone(tipo) {
  return (TIPO_META[tipo] || {}).tone || 'neutral';
}

/*
 * A `baixa` é dado de saúde: aplicamos MINIMIZAÇÃO - o formulário nunca pede nem
 * persiste notas clínicas. Este predicado é a fonte única dessa regra, partilhada
 * pelo formulário (esconde o campo) e pelo gravador (nunca inclui a chave).
 */
export function notasSuprimidas(tipo) {
  return tipo === 'baixa';
}

/* ---------- Estado da ausência ---------- */

const ESTADO_META = {
  pedida: { label: 'Pedida', tone: 'media' },
  aprovada: { label: 'Aprovada', tone: 'ok' },
};

export function estadoLabel(estado) {
  return (ESTADO_META[estado] || {}).label || estado || '—';
}

export function estadoTone(estado) {
  return (ESTADO_META[estado] || {}).tone || 'neutral';
}

/* ---------- Datas do mapa de férias ---------- */

/* Número de dias de um mês civil (mes: 0-11). */
export function diasNoMes(ano, mes) {
  return new Date(ano, mes + 1, 0).getDate();
}

/* Nome do mês em PT-PT, ex.: "Julho de 2026". */
export function nomeMes(ano, mes) {
  try {
    const d = new Date(ano, mes, 1);
    const s = d.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return `${mes + 1}/${ano}`;
  }
}

/*
 * Interseção de uma ausência (dataInicio/dataFim 'YYYY-MM-DD') com o mês
 * seleccionado. Devolve null se não intersecta, ou { startDay, endDay } em dias
 * 1-based do mês (aparados às fronteiras do mês), para desenhar a barra.
 */
export function intersecaoNoMes(ausencia, ano, mes) {
  if (!ausencia || !ausencia.dataInicio || !ausencia.dataFim) return null;
  const inicioMes = new Date(ano, mes, 1);
  const fimMes = new Date(ano, mes, diasNoMes(ano, mes));
  const ini = parseDia(ausencia.dataInicio);
  const fim = parseDia(ausencia.dataFim);
  if (!ini || !fim) return null;
  if (fim < inicioMes || ini > fimMes) return null;
  const startDay = ini < inicioMes ? 1 : ini.getDate();
  const endDay = fim > fimMes ? diasNoMes(ano, mes) : fim.getDate();
  if (endDay < startDay) return null;
  return { startDay, endDay };
}

/* 'YYYY-MM-DD' -> Date local (meia-noite) ou null. */
function parseDia(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
