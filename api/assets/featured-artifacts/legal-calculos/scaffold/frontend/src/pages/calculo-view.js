/*
 * Auxiliares de apresentação do legal-calculos - próprios do app (NÃO
 * sincronizados). Formatam/derivam a partir dos resultados dos motores
 * (juros.mjs / custas.mjs); nunca reimplementam a aritmética nem constantes de
 * taxa (essas vivem só nos motores + tabela).
 */

/* 'YYYY-MM-DD' local de hoje (o campo "até" por omissão). */
export function hojeISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/*
 * Lê um valor monetário em euros de um input PT-PT. Aceita "12500", "12500,00",
 * "12 500,00" e "12.500,00" (ponto de milhares + vírgula decimal) e "12500.50".
 * Lança se não for um número - o motor valida depois a precisão ao cêntimo e
 * recusa LOUD um valor sub-cêntimo.
 */
export function parseEuro(raw) {
  let s = String(raw == null ? '' : raw).trim().replace(/[\s€]/g, '');
  if (!s) throw new Error('valor vazio');
  if (s.includes('.') && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('valor inválido');
  return n;
}

/* Citações únicas dos troços de juros (Aviso + base legal), preservando a ordem. */
export function citasDeTrocos(trocos) {
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(trocos) ? trocos : []) {
    const cita = t.base ? `${t.aviso} - ${t.base}` : t.aviso;
    if (cita && !seen.has(cita)) { seen.add(cita); out.push(cita); }
  }
  return out;
}

/* Citações de um cálculo de custas (a citação do RCP + a base da UC). */
export function citasDeCustas(resultado) {
  const out = [];
  if (resultado && resultado.citacao) out.push(resultado.citacao);
  if (resultado && resultado.ucBase) out.push(`Valor da UC: ${resultado.ucBase}`);
  return out;
}

/*
 * Texto da memória de cálculo, pronto a imprimir ou a copiar para uma peça. É a
 * saída `showWork.passos` do motor com um cabeçalho - a mesma memória que o motor
 * produz, nunca uma reescrita.
 */
export function memoriaTexto(resultado, kind) {
  const linhas = ['MEMÓRIA DE CÁLCULO', kind === 'custas' ? 'Taxa de justiça' : 'Juros de mora', ''];
  const passos = (resultado && resultado.showWork && resultado.showWork.passos) || [];
  for (const p of passos) linhas.push(p);
  return linhas.join('\n');
}
