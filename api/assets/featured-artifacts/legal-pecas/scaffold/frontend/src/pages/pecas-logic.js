/*
 * Lógica PURA da redação de peças processuais - sem `window`, sem `new Date()`
 * ao nível do módulo, sem efeitos colaterais.
 *
 * O esqueleto de uma peça é DETERMINÍSTICO: um cabeçalho composto dos dados do
 * processo (tribunal, comarca, número, partes) mais um corpo que ou vem do
 * corpo de um precedente (com as {{chaves}} resolvidas do processo/cliente, na
 * mesma convenção dos Contratos) ou é a estrutura-tipo vazia da peça escolhida.
 *
 * NÃO há IA nem geração de texto por modelo - só composição de blocos fixos.
 */

/* Aviso fixo, obrigatório em cada superfície de edição (o advogado revê sempre). */
export const DISCLAIMER = 'Rascunho para revisão do advogado - o advogado revê sempre.';

/* Tipos de peça suportados, pela ordem de apresentação. */
export const TIPOS = [
  { value: 'peticao_inicial', label: 'Petição inicial' },
  { value: 'contestacao', label: 'Contestação' },
  { value: 'requerimento', label: 'Requerimento' },
  { value: 'alegacoes', label: 'Alegações' },
];

const TIPO_LABEL = Object.fromEntries(TIPOS.map((t) => [t.value, t.label]));

export function tipoLabel(value) {
  return TIPO_LABEL[value] || value || 'Peça';
}

/* Estados de uma peça e a sua progressão linear rascunho -> revisao -> final. */
export const ESTADOS = ['rascunho', 'revisao', 'final'];
const ESTADO_LABEL = { rascunho: 'Rascunho', revisao: 'Em revisão', final: 'Final' };
const ESTADO_TONE = { rascunho: 'neutral', revisao: 'media', final: 'ok' };

export function estadoLabel(e) {
  return ESTADO_LABEL[e] || e || 'Rascunho';
}

export function estadoTone(e) {
  return ESTADO_TONE[e] || 'neutral';
}

/* Estado seguinte na progressão, ou null se já for o final. */
export function nextEstado(e) {
  const i = ESTADOS.indexOf(e);
  if (i < 0) return ESTADOS[1];
  return i >= ESTADOS.length - 1 ? null : ESTADOS[i + 1];
}

/* {{chaves}} presentes no corpo - únicas, por ordem de aparição. */
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
 * Substitui cada {{chave}} conhecida por `values` (mesmo com valor vazio);
 * chaves desconhecidas ficam textuais, para o advogado ver o que falta mapear.
 * Mesma convenção do gerador de Contratos.
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

/*
 * Valores da espinha para resolver as {{chaves}} do corpo de um precedente. As
 * chaves seguem a convenção dos Contratos (cliente_nome, processo_numero, ...),
 * mais a contraparte quando o processo a declara.
 */
export function resolveValues(processo, cliente) {
  const p = processo || {};
  const c = cliente || {};
  const cp = p.contraparte || {};
  return {
    cliente_nome: c.nome || '',
    cliente_nif: c.nif || '',
    cliente_morada: c.morada || '',
    processo_numero: p.numeroProcesso || '',
    processo_tribunal: p.tribunal || '',
    processo_comarca: p.comarca || '',
    contraparte_nome: cp.nome || '',
    contraparte_nif: cp.nif || '',
  };
}

/* Cabeçalho comum a todas as peças - endereçamento e identificação das partes. */
function composeHeader({ processo, cliente }) {
  const p = processo || {};
  const c = cliente || {};
  const lines = ['EXMO. SENHOR DOUTOR JUIZ DE DIREITO'];
  if (p.tribunal) lines.push(p.tribunal);
  if (p.comarca) lines.push(`Comarca de ${p.comarca}`);
  if (p.numeroProcesso) lines.push(`Processo n.º ${p.numeroProcesso}`);
  lines.push('');

  // Parte principal (o cliente patrocinado).
  let autor = c.nome || '(cliente por identificar)';
  if (c.nif) autor += `, contribuinte fiscal n.º ${c.nif}`;
  if (c.morada) autor += `, com morada em ${c.morada}`;
  lines.push(`${autor},`);

  // Contraparte, quando o processo a declara.
  const cp = p.contraparte;
  if (cp && cp.nome) {
    let contra = `tendo como contraparte ${cp.nome}`;
    if (cp.nif) contra += `, contribuinte fiscal n.º ${cp.nif}`;
    lines.push(`${contra},`);
  }
  lines.push('vem, nos autos à margem identificados, expor e requerer o seguinte:');
  lines.push('');
  return lines.join('\n');
}

/* Estruturas-tipo vazias por tipo de peça (usadas quando não há precedente). */
const ESTRUTURA = {
  peticao_inicial: [
    'I. DOS FACTOS',
    '1. ',
    '',
    'II. DO DIREITO',
    '',
    'III. DO PEDIDO',
    'Nestes termos, e nos melhores de direito, requer-se a V. Exa. que a presente acção seja julgada procedente por provada.',
  ],
  contestacao: [
    'I. POR IMPUGNAÇÃO',
    '1. Impugnam-se os factos alegados na petição inicial.',
    '',
    'II. POR EXCEPÇÃO',
    '',
    'III. DO PEDIDO',
    'Nestes termos, deve a presente acção ser julgada improcedente, com as legais consequências.',
  ],
  requerimento: [
    'Vem, nos autos à margem identificados, requerer a V. Exa. o seguinte:',
    '1. ',
    '',
    'Termos em que se requer o deferimento do ora requerido.',
  ],
  alegacoes: [
    'I. OBJECTO DO RECURSO',
    '',
    'II. DA FUNDAMENTAÇÃO',
    '',
    'III. DAS CONCLUSÕES',
    '1. ',
  ],
};

function composeBody({ tipo, processo, cliente, precedente }) {
  if (precedente && String(precedente.corpo || '').trim()) {
    return substitute(precedente.corpo, resolveValues(processo, cliente));
  }
  const estrutura = ESTRUTURA[tipo] || ESTRUTURA.requerimento;
  return estrutura.join('\n');
}

/*
 * Compõe o esqueleto DETERMINÍSTICO de uma peça: cabeçalho do processo + corpo
 * (do precedente, com {{chaves}} resolvidas, ou a estrutura-tipo vazia).
 */
export function composeSkeleton({ tipo, processo, cliente, precedente }) {
  const header = composeHeader({ processo, cliente });
  const body = composeBody({ tipo, processo, cliente, precedente });
  return `${header}${body}\n`;
}

/* Título por omissão de uma peça nova. */
export function defaultTitulo(tipo, processo) {
  const num = (processo && processo.numeroProcesso) || '';
  const base = tipoLabel(tipo);
  return num ? `${base} - processo ${num}` : base;
}

/*
 * Bloco de fundamentação a acrescentar ao corpo a partir de uma citação de uma
 * pesquisa guardada. Uma linha, com título, fonte e URL (verificável).
 */
export function citacaoBlock(citacao) {
  const c = citacao || {};
  const partes = [c.titulo, c.fonte, c.url].map((v) => String(v || '').trim()).filter(Boolean);
  return `- Fundamentação: ${partes.join(', ')}`;
}

/* Acrescenta o bloco de citação ao fim do corpo, com uma linha em branco antes. */
export function appendCitacao(corpo, citacao) {
  const bloco = citacaoBlock(citacao);
  const base = String(corpo || '');
  const sep = base.length === 0 ? '' : base.endsWith('\n') ? '\n' : '\n\n';
  return `${base}${sep}${bloco}\n`;
}

/* Nome de ficheiro seguro: minúsculas, sem acentos/espaços/caracteres especiais. */
export function slugFile(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'peca';
}

/* Data de hoje como 'AAAA-MM-DD' - calculada DENTRO do handler (nunca no topo). */
export function hojeISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
