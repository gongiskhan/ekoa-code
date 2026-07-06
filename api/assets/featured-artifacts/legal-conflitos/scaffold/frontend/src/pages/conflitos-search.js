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

  const hits = [];
  const push = (h) => hits.push({ key: `${h.tipo}:${h.refId}:${h.campoKey}`, ...h });

  for (const c of Array.isArray(clientes) ? clientes : []) {
    if (hasTermo) {
      const ex = substringExcerpt(c.nome, foldedTermo);
      if (ex) push({ tipo: 'cliente', refId: c.id, nome: c.nome, campo: 'Nome', campoKey: 'nome', excerto: ex });
    }
    if (hasNif && digitsOnly(c.nif) === nifDigits) {
      push({ tipo: 'cliente', refId: c.id, nome: c.nome, campo: 'NIF', campoKey: 'nif', excerto: fullExcerpt(c.nif) });
    }
  }

  for (const p of Array.isArray(processos) ? processos : []) {
    const cp = p.contraparte || {};
    if (hasTermo) {
      const exCp = substringExcerpt(cp.nome, foldedTermo);
      if (exCp) push({ tipo: 'contraparte', refId: p.id, nome: cp.nome, processoNumero: p.numeroProcesso, campo: 'Contraparte', campoKey: 'contraparte.nome', excerto: exCp });

      const exDesc = substringExcerpt(p.descricao, foldedTermo);
      if (exDesc) push({ tipo: 'processo', refId: p.id, nome: p.numeroProcesso, processoNumero: p.numeroProcesso, campo: 'Descrição', campoKey: 'descricao', excerto: exDesc });

      const exNum = substringExcerpt(p.numeroProcesso, foldedTermo);
      if (exNum) push({ tipo: 'processo', refId: p.id, nome: p.numeroProcesso, processoNumero: p.numeroProcesso, campo: 'Nº do processo', campoKey: 'numeroProcesso', excerto: exNum });
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
