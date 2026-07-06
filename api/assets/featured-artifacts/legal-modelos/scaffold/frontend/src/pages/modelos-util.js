/*
 * Ajudantes PUROS das páginas de Modelos (biblioteca + os meus modelos).
 *
 * Sem `window`, sem `new Date()` ao nível do módulo, sem efeitos colaterais.
 */

/*
 * Catálogo de origens de uma variável - as cinco da espinha + manual. Tem de
 * coincidir com o catálogo do app de Contratos (modelo-util.js), pois é o mesmo
 * campo `variaveis` que o wizard de Contratos consome ao gerar o documento.
 */
export const ORIGENS = [
  { value: 'cliente.nome', label: 'Cliente · Nome' },
  { value: 'cliente.nif', label: 'Cliente · NIF' },
  { value: 'cliente.morada', label: 'Cliente · Morada' },
  { value: 'processo.numero', label: 'Processo · Número' },
  { value: 'processo.tribunal', label: 'Processo · Tribunal' },
  { value: 'manual', label: 'Manual (preenchida na geração)' },
];

/* Normalização para pesquisa: minúsculas e sem diacríticos. */
export function foldText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/*
 * Proveniência de uma linha de modelo na espinha partilhada. As linhas legadas
 * (semeadas pelo Núcleo) não têm `fonte`; apresentam-se como do escritório.
 */
const FONTE_META = {
  oficial: { label: 'Oficial', tone: 'ok' },
  escritorio: { label: 'Escritório', tone: 'neutral' },
  importado: { label: 'Importado', tone: 'info' },
};

export function fonteMeta(fonte) {
  const key = fonte && FONTE_META[fonte] ? fonte : 'escritorio';
  return FONTE_META[key];
}

/* Categoria efetiva de uma linha (campo aditivo `categoria`, ou a `area` legada). */
export function categoriaDe(modelo) {
  return (modelo && (modelo.categoria || modelo.area)) || '';
}

/* Versão efetiva para apresentação (linhas legadas sem `versao` mostram 1). */
export function versaoDe(modelo) {
  const v = modelo && Number(modelo.versao);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/*
 * Nome único dentro da colecção: se `nome` já existir (ignorando espaços e
 * maiúsculas), acrescenta um sufixo " (2)", " (3)", ... até não colidir. Mantém
 * a importação idempotente-ish sem diálogos que travariam demos/testes.
 */
export function nomeUnico(nome, existentes) {
  const base = String(nome || 'Modelo').trim() || 'Modelo';
  const usados = new Set((existentes || []).map((m) => foldText(m && m.nome)));
  if (!usados.has(foldText(base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidato = `${base} (${n})`;
    if (!usados.has(foldText(candidato))) return candidato;
  }
  return `${base} (${Date.now()})`;
}
