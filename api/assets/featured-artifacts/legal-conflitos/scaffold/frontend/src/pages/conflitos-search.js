/*
 * Motor de pesquisa de conflitos — DETERMINÍSTICO e do lado do cliente.
 *
 * Corre sobre a espinha PARTILHADA já semeada pelo Núcleo (nunca escreve nem
 * semeia): clientes (nome, nif) e processos (contraparte.nome, contraparte.nif,
 * descrição, número do processo). É apoio à decisão nos termos do art. 99.º do
 * EOA — devolve correspondências, nunca um veredicto. A decisão é do advogado.
 *
 * Regras de correspondência:
 *   - `termo` (nome): subcadeia sobre os campos de texto, com o MESMO folding do
 *     Layout (minúsculas + sem diacríticos). "padaria" e "PADARIA" coincidem com
 *     "Padaria Central, Lda.".
 *   - `nif`: correspondência EXACTA por dígitos (um NIF parcial não conta).
 */

/* Normalização para pesquisa: minúsculas e sem diacríticos (idioma do Layout). */
export function foldText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/* Apenas dígitos — base da comparação exacta de NIF. */
export function digitsOnly(s) {
  return String(s || '').replace(/\D/g, '');
}

/*
 * Folding com mapa de índices: para cada carácter FOLDED regista o índice do
 * carácter ORIGINAL que o gerou. Como o folding pode encolher ('á' -> 'a') ou
 * remover marcas combinatórias, este mapa permite recortar o excerto DESTACADO
 * na cadeia original a partir de uma correspondência encontrada no folded.
 */
function foldWithMap(value) {
  const str = String(value || '');
  let folded = '';
  const map = [];
  for (let i = 0; i < str.length; i += 1) {
    const f = str[i].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    for (let k = 0; k < f.length; k += 1) {
      folded += f[k];
      map.push(i);
    }
  }
  return { folded, map, original: str };
}

const CONTEXT = 28;

/*
 * Excerto de uma subcadeia encontrada por `termo` folded, com janela de contexto
 * e reticências. Devolve { before, match, after } na cadeia ORIGINAL ou null.
 */
function substringExcerpt(value, foldedTerm) {
  if (!foldedTerm) return null;
  const { folded, map, original } = foldWithMap(value);
  const idx = folded.indexOf(foldedTerm);
  if (idx < 0) return null;
  const startOrig = map[idx];
  const endOrig = map[idx + foldedTerm.length - 1];
  const from = Math.max(0, startOrig - CONTEXT);
  const to = Math.min(original.length, endOrig + 1 + CONTEXT);
  return {
    before: (from > 0 ? '…' : '') + original.slice(from, startOrig),
    match: original.slice(startOrig, endOrig + 1),
    after: original.slice(endOrig + 1, to) + (to < original.length ? '…' : ''),
  };
}

/* Excerto de correspondência TOTAL (NIF exacto): o valor inteiro destacado. */
function fullExcerpt(value) {
  return { before: '', match: String(value || ''), after: '' };
}

/*
 * Tokens de pesquisa de um termo folded: palavras com 2+ caracteres. Uma pesquisa
 * multi-palavra ("padaria central") gera ['padaria', 'central'].
 */
function termoTokens(foldedTermo) {
  return foldedTermo.split(/\s+/).filter((t) => t.length >= 2);
}

/*
 * Correspondência determinística por SUBCONJUNTO de tokens, independente da ordem:
 * verdadeiro quando TODOS os tokens do termo aparecem (como subcadeia) no valor.
 * Isto ALARGA (nunca reduz) a cobertura da subcadeia contígua: "padaria central"
 * acerta "Central Padaria, Lda." apesar de não ser uma subcadeia. Só se usa
 * quando há 2+ tokens - com um único token é, por definição, a subcadeia simples,
 * já coberta. Devolve o excerto ancorado no PRIMEIRO token, ou null.
 */
function tokenSubsetExcerpt(value, tokens) {
  if (tokens.length < 2) return null;
  const { folded } = foldWithMap(value);
  if (!tokens.every((t) => folded.includes(t))) return null;
  // Excerto ancorado no token que aparece mais cedo, para um destaque estável.
  let primeiro = tokens[0];
  let melhorIdx = folded.indexOf(primeiro);
  for (const t of tokens) {
    const at = folded.indexOf(t);
    if (at >= 0 && (melhorIdx < 0 || at < melhorIdx)) { melhorIdx = at; primeiro = t; }
  }
  return substringExcerpt(value, primeiro);
}

/* Texto plano de um excerto (para persistir em conflitos_check.resultado). */
export function excerptText(excerto) {
  if (!excerto) return '';
  return `${excerto.before || ''}${excerto.match || ''}${excerto.after || ''}`;
}

/*
 * Pesquisa os clientes e processos e devolve uma lista PLANA de correspondências.
 * Cada hit: { key, tipo, refId, nome, processoNumero?, campo, campoKey, excerto }.
 *   tipo: 'cliente' | 'contraparte' | 'processo'
 *   refId: id do cliente (cliente) ou do processo (contraparte/processo)
 */
export function searchConflitos({ termo, nif, clientes, processos }) {
  const foldedTermo = foldText(String(termo || '').trim());
  const nifDigits = digitsOnly(nif);
  const hasTermo = foldedTermo.length > 0;
  const hasNif = nifDigits.length > 0;
  const tokens = termoTokens(foldedTermo);

  const hits = [];
  const vistos = new Set();
  const push = (h) => {
    const key = `${h.tipo}:${h.refId}:${h.campoKey}`;
    if (vistos.has(key)) return; // deduplica campo já acertado (subcadeia > tokens)
    vistos.add(key);
    hits.push({ key, ...h });
  };
  /*
   * Correspondência de um campo por `termo`: primeiro subcadeia contígua; se não
   * acertar e o termo tiver 2+ tokens, tenta o subconjunto de tokens (alarga a
   * cobertura sem a reduzir). Marca `parcial: true` quando só acertou por tokens.
   */
  const matchTermo = (valor) => {
    const ex = substringExcerpt(valor, foldedTermo);
    if (ex) return { excerto: ex, parcial: false };
    const exTok = tokenSubsetExcerpt(valor, tokens);
    if (exTok) return { excerto: exTok, parcial: true };
    return null;
  };

  for (const c of Array.isArray(clientes) ? clientes : []) {
    if (hasTermo) {
      const m = matchTermo(c.nome);
      if (m) push({ tipo: 'cliente', refId: c.id, nome: c.nome, campo: 'Nome', campoKey: 'nome', excerto: m.excerto, parcial: m.parcial });
    }
    if (hasNif && digitsOnly(c.nif) === nifDigits) {
      push({ tipo: 'cliente', refId: c.id, nome: c.nome, campo: 'NIF', campoKey: 'nif', excerto: fullExcerpt(c.nif) });
    }
  }

  for (const p of Array.isArray(processos) ? processos : []) {
    const cp = p.contraparte || {};
    if (hasTermo) {
      const mCp = matchTermo(cp.nome);
      if (mCp) push({ tipo: 'contraparte', refId: p.id, nome: cp.nome, processoNumero: p.numeroProcesso, campo: 'Contraparte', campoKey: 'contraparte.nome', excerto: mCp.excerto, parcial: mCp.parcial });

      const mDesc = matchTermo(p.descricao);
      if (mDesc) push({ tipo: 'processo', refId: p.id, nome: p.numeroProcesso, processoNumero: p.numeroProcesso, campo: 'Descrição', campoKey: 'descricao', excerto: mDesc.excerto, parcial: mDesc.parcial });

      const mNum = matchTermo(p.numeroProcesso);
      if (mNum) push({ tipo: 'processo', refId: p.id, nome: p.numeroProcesso, processoNumero: p.numeroProcesso, campo: 'Nº do processo', campoKey: 'numeroProcesso', excerto: mNum.excerto, parcial: mNum.parcial });
    }
    if (hasNif && digitsOnly(cp.nif) === nifDigits) {
      push({ tipo: 'contraparte', refId: p.id, nome: cp.nome, processoNumero: p.numeroProcesso, campo: 'NIF da contraparte', campoKey: 'contraparte.nif', excerto: fullExcerpt(cp.nif) });
    }
  }

  return hits;
}

/* Metadados de apresentação por tipo de correspondência. */
export const TIPO_META = {
  cliente: { label: 'Cliente', tone: 'info' },
  contraparte: { label: 'Contraparte', tone: 'alta' },
  processo: { label: 'Processo', tone: 'neutral' },
};

/* Metadados da decisão registada (art. 99.º EOA). */
export const DECISAO_META = {
  sem_conflito: { label: 'Sem conflito', tone: 'ok' },
  conflito_potencial: { label: 'Conflito potencial', tone: 'media' },
  conflito: { label: 'Conflito', tone: 'alta' },
};
