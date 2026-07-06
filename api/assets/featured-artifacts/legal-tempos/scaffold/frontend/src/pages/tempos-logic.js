/*
 * Lógica determinística do módulo de Tempos (pura, sem React nem I/O).
 *
 * Separa o cálculo dos registos de tempo (duração, valor estimado, payload de
 * transferência para honorários, agrupamento semanal) da camada de UI e de
 * acesso à espinha. Facilita o teste e mantém as páginas finas.
 *
 * ESPINHA: os registos vivem na colecção partilhada `registos_tempo` com os
 * campos { processoId, clienteId, pessoaId, descricao, inicio, fim, minutos,
 * faturavel, tarifaHora?, estado, lancamentoId? }. A transferência ESCREVE em
 * `lancamentos` (honorários) e marca o registo como 'transferido'.
 */

/* Arredonda ao cêntimo/duas casas ANTES de qualquer aritmética - dinheiro e
 * horas faturáveis não são fracções cegas. */
export function round2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/* Data de hoje como 'AAAA-MM-DD' local - calculada dentro do handler, nunca no
 * topo do módulo. */
export function hojeISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/*
 * Minutos decorridos entre dois instantes ISO, ARREDONDADOS PARA CIMA ao minuto
 * (incremento mínimo de faturação: um temporizador parado ao fim de segundos
 * conta 1 minuto, nunca 0). Devolve 0 se as datas forem inválidas ou fim<=inicio
 * de forma degenerada.
 */
export function minutosEntre(inicioISO, fimISO) {
  const a = Date.parse(inicioISO);
  const b = Date.parse(fimISO);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const ms = b - a;
  if (ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / 60000));
}

/* Segundos decorridos desde `inicioISO` até `agora` (ms), nunca negativo. Serve
 * o mostrador ao vivo do temporizador em curso. */
export function segundosDecorridos(inicioISO, agoraMs) {
  const a = Date.parse(inicioISO);
  if (!Number.isFinite(a)) return 0;
  return Math.max(0, Math.floor((agoraMs - a) / 1000));
}

/* "01:23:45" a partir de segundos - mostrador do temporizador. */
export function formatCronometro(totalSegundos) {
  const s = Math.max(0, Math.floor(Number(totalSegundos) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/* Duração legível a partir de minutos: "1h 30m", "45m", "—". */
export function formatDuracao(minutos) {
  const total = Math.round(Number(minutos) || 0);
  if (!Number.isFinite(total) || total <= 0) return '—';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/* Horas faturáveis (minutos/60) arredondadas a 2 casas - a unidade dos
 * honorários à hora. */
export function horasDe(minutos) {
  return round2((Number(minutos) || 0) / 60);
}

/*
 * Valor estimado de um registo: minutos/60 × tarifaHora, apenas quando é
 * faturável e tem tarifa. Devolve number (euros) ou null (sem estimativa).
 */
export function valorEstimado(registo) {
  if (!registo || !registo.faturavel) return null;
  const tarifa = Number(registo.tarifaHora);
  if (!Number.isFinite(tarifa) || tarifa <= 0) return null;
  return round2(horasDe(registo.minutos) * tarifa);
}

/* Um registo já pode ser transferido para honorários? Parado, faturável e ainda
 * sem lançamento associado. */
export function podeTransferir(registo) {
  return !!(
    registo &&
    registo.estado === 'parado' &&
    registo.faturavel &&
    !registo.lancamentoId
  );
}

/*
 * Constrói o payload do lançamento de honorários a partir de um registo de
 * tempo. Determinístico: horas = minutos/60 (2 casas), valor = horas × tarifa
 * (2 casas). O chamador cria a linha em `lancamentos` e devolve o id para o
 * gravar no registo (estado 'transferido').
 */
export function buildLancamentoPayload(registo, dataISO) {
  const horas = horasDe(registo.minutos);
  const tarifaHora = Number.isFinite(Number(registo.tarifaHora)) ? round2(registo.tarifaHora) : null;
  const valor = tarifaHora != null ? round2(horas * tarifaHora) : 0;
  return {
    processoId: registo.processoId || null,
    clienteId: registo.clienteId || null,
    tipo: 'honorario',
    modo: 'hora',
    descricao: registo.descricao || 'Tempo registado',
    horas,
    tarifaHora,
    valor,
    data: dataISO,
    faturado: false,
  };
}

/* Rótulos e tons dos estados do registo - fonte única para não divergir entre
 * ecrãs. */
export const ESTADO_LABEL = {
  em_curso: 'Em curso',
  parado: 'Parado',
  transferido: 'Transferido',
};
export const ESTADO_TONE = {
  em_curso: 'info',
  parado: 'media',
  transferido: 'ok',
};

/* Data de referência de um registo, como 'AAAA-MM-DD' local: usa o dia do
 * `inicio` (ou de `data` / `createdAt` em falta). Serve a grelha semanal. */
export function registoDia(registo) {
  const raw = (registo && (registo.inicio || registo.data || registo.createdAt)) || '';
  const s = String(raw);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/* Segunda-feira (00:00 local) da semana que contém `base`. */
export function inicioSemana(base = new Date()) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay(); // 0=Dom ... 6=Sáb
  const diff = dow === 0 ? -6 : 1 - dow; // recua até segunda
  d.setDate(d.getDate() + diff);
  return d;
}

function diaISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DIA_LABEL = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

/*
 * Agrupa os registos pelos 7 dias da semana que contém `base` (Seg-Dom).
 * Devolve { dias: [{ iso, label, minutosFaturavel, minutosNao, minutos,
 * registos }], total, totalFaturavel, totalNao, inicioISO, fimISO }.
 * Ignora registos fora da janela. Não conta minutos de registos sem duração.
 */
export function agruparSemana(registos, base = new Date()) {
  const seg = inicioSemana(base);
  const dias = [];
  const byIso = new Map();
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(seg);
    d.setDate(seg.getDate() + i);
    const iso = diaISO(d);
    const entry = { iso, label: DIA_LABEL[i], minutosFaturavel: 0, minutosNao: 0, minutos: 0, registos: [] };
    dias.push(entry);
    byIso.set(iso, entry);
  }

  for (const r of Array.isArray(registos) ? registos : []) {
    const dia = registoDia(r);
    const entry = byIso.get(dia);
    if (!entry) continue;
    const min = Math.max(0, Math.round(Number(r.minutos) || 0));
    entry.minutos += min;
    if (r.faturavel) entry.minutosFaturavel += min;
    else entry.minutosNao += min;
    entry.registos.push(r);
  }

  const total = dias.reduce((acc, d) => acc + d.minutos, 0);
  const totalFaturavel = dias.reduce((acc, d) => acc + d.minutosFaturavel, 0);
  const totalNao = dias.reduce((acc, d) => acc + d.minutosNao, 0);
  const fim = new Date(seg);
  fim.setDate(seg.getDate() + 6);
  return { dias, total, totalFaturavel, totalNao, inicioISO: diaISO(seg), fimISO: diaISO(fim) };
}
