/*
 * Ajudantes PUROS partilhados pelas páginas de Contratos (galeria/editor/wizard).
 *
 * Sem `window`, sem `new Date()` ao nível do módulo, sem efeitos colaterais. As
 * variáveis de um modelo mapeiam para dados da espinha (cliente/processo) por
 * `origem`; as de origem `manual` são preenchidas na geração.
 */

/* Catálogo de origens de uma variável - as cinco da espinha + manual. */
export const ORIGENS = [
  { value: 'cliente.nome', label: 'Cliente · Nome' },
  { value: 'cliente.nif', label: 'Cliente · NIF' },
  { value: 'cliente.morada', label: 'Cliente · Morada' },
  { value: 'processo.numero', label: 'Processo · Número' },
  { value: 'processo.tribunal', label: 'Processo · Tribunal' },
  { value: 'manual', label: 'Manual (preenchida na geração)' },
];

const ORIGEM_LABEL = Object.fromEntries(ORIGENS.map((o) => [o.value, o.label]));
const SPINE_ORIGENS = new Set([
  'cliente.nome', 'cliente.nif', 'cliente.morada', 'processo.numero', 'processo.tribunal',
]);

export function origemLabel(value) {
  return ORIGEM_LABEL[value] || ORIGEM_LABEL['manual'];
}

/* Uma origem da espinha (prefill automático) vs. `manual` (preenchida à mão). */
export function isSpineOrigem(origem) {
  return SPINE_ORIGENS.has(origem);
}

/*
 * Valor com que uma variável de origem da espinha é pré-preenchida a partir do
 * cliente/processo escolhidos. `processo.numero` lê `numeroProcesso`. Devolve
 * sempre uma string (vazia se o campo não existir).
 */
export function resolveOrigem(origem, cliente, processo) {
  switch (origem) {
    case 'cliente.nome': return (cliente && cliente.nome) || '';
    case 'cliente.nif': return (cliente && cliente.nif) || '';
    case 'cliente.morada': return (cliente && cliente.morada) || '';
    case 'processo.numero': return (processo && processo.numeroProcesso) || '';
    case 'processo.tribunal': return (processo && processo.tribunal) || '';
    default: return '';
  }
}

/* {{chave}} presentes no corpo - únicas, por ordem de aparição. */
export function extractPlaceholders(corpo) {
  const out = [];
  const seen = new Set();
  const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let m;
  while ((m = re.exec(String(corpo || '')))) {
    const key = m[1];
    if (!seen.has(key)) { seen.add(key); out.push(key); }
  }
  return out;
}

/*
 * Substitui cada {{chave}} cujo `values` conheça a chave (mesmo com valor vazio,
 * para não deixar chavetas por preencher num opcional em branco); placeholders
 * desconhecidos ficam textuais, para o utilizador ver o que ainda não está
 * mapeado.
 */
export function substitute(corpo, values) {
  const map = values || {};
  return String(corpo || '').replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (whole, key) => {
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      const v = map[key];
      return v == null ? '' : String(v);
    }
    return whole;
  });
}

/* Nome de ficheiro seguro: minúsculas, sem acentos/espaços/caracteres especiais. */
export function slugFile(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'documento';
}

/* Data de hoje como 'AAAA-MM-DD' - calculada DENTRO do handler (nunca no topo do módulo). */
export function hojeISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
