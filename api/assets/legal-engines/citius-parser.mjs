/**
 * Parser CONSERVADOR de notificações Citius (Portugal) — determinístico, zero
 * retrieval. Extrai (numeroProcesso, ato, dataExplicita) do texto de uma
 * notificação. Princípio absoluto: NA DÚVIDA, devolve "não reconhecido" (campos
 * a null) para revisão humana — NUNCA inventa um processo, um ato ou uma data.
 * Um prazo errado é um processo perdido.
 *
 * Em particular: só aceita a data do ACTO quando ela vem EXPLICITAMENTE rotulada
 * ("Data do acto: …") — nunca usa a data de envio/recepção do email como data do
 * acto. E limpa HTML de forma defensiva (blocos display:none, tags) para não ser
 * enganado por conteúdo escondido.
 */

/** Número de processo CPC: NNNN/NN.NTNLLL (ex.: 1234/26.0T8LSB, 5678/26.1T8PRT). */
const RE_PROCESSO = /\b(\d{1,6}\/\d{2}\.\d[A-Z]\d?[A-Z]{2,4})\b/g;

/**
 * Data do acto, APENAS quando rotulada ("Data do acto / da notificação: …").
 * Aceita DD-MM-YYYY, DD/MM/YYYY ou YYYY-MM-DD. Sem rótulo -> sem data. (A data de
 * ENVIO/expedição não tem este rótulo, pelo que nunca é apanhada.)
 */
const RE_DATA_EXPLICITA =
  /\bdata\s+d[oae]\s+(?:acto|ato|notifica[çc][ãa]o)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{2}[-/]\d{2}[-/]\d{4})/gi;

/**
 * Negação/encerramento perto da palavra do ato — desliga o match (ex.: "sem
 * contestação", "findo o prazo de contestação", "não houve citação"). Na dúvida
 * vai para REVISÃO (um prazo perdido por excesso de prudência revê-se; um prazo
 * ERRADO perde o processo).
 */
const RE_NEGACAO = /\b(sem|n[ãa]o|findo|finda|decorrid[oa]s?|terminad[oa]s?|expirad[oa]s?|ultrapassad[oa]s?|prescri[a-zç]+|caducad[oa]s?)\b/i;

/**
 * Atos conhecidos -> a regra de prazo BEM ESTABELECIDA (CPC). `dias=null` marca
 * um ato sem prazo automático (ex.: audiência) — vai para revisão, não calcula.
 * Acts fora desta tabela => "ato não reconhecido" => revisão (nunca adivinha dias).
 */
export const ATOS = [
  { re: /\b(contesta[çc][ãa]o|para\s+contestar)\b/i, ato: 'Contestação', dias: 30, contagem: 'uteis' },
  { re: /\bcita[çc][ãa]o\b/i, ato: 'Citação', dias: 30, contagem: 'uteis' },
  { re: /\b(recurso|apela[çc][ãa]o)\b/i, ato: 'Recurso', dias: 30, contagem: 'uteis' },
  { re: /\boposi[çc][ãa]o\b/i, ato: 'Oposição', dias: 20, contagem: 'uteis' },
  { re: /\baudi[êe]ncia\b/i, ato: 'Audiência', dias: null, contagem: null },
];

/** Limpa HTML de forma defensiva: remove blocos display:none, style/script, tags, entidades. */
export function stripHtml(input) {
  let t = String(input == null ? '' : input);
  // blocos escondidos (display:none com OU sem aspas, visibility:hidden, ou o
  // atributo hidden) — possível injeção a esconder/forjar texto. A defesa
  // principal é ainda assim o guarda de "vários processos distintos" no parse.
  t = t.replace(
    /<([a-z0-9]+)\b[^>]*(?:style\s*=\s*["']?[^>"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)|\shidden(?:\s|=|>))[^>]*>[\s\S]*?<\/\1>/gi,
    ' ',
  );
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** Normaliza uma data extraída para 'YYYY-MM-DD' (ou null se impossível). */
function normalizeData(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(s);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Todos os grupos 1 de uma regex GLOBAL, distintos e por ordem. */
function allMatches(globalRe, text) {
  globalRe.lastIndex = 0;
  const out = [];
  let m;
  while ((m = globalRe.exec(text)) !== null) {
    out.push(m[1]);
    if (m.index === globalRe.lastIndex) globalRe.lastIndex += 1;
  }
  return out;
}

/**
 * @returns {{ numeroProcesso: string|null, ato: string|null, regra: object|null,
 *   dataExplicita: string|null, dataConflito: boolean, ok: boolean,
 *   motivo: string|null, texto: string, textoCompleto: string }}
 *   `ok` é true só quando há UM processo E um ato reconhecido (não negado). Tudo
 *   o que for ambíguo (vários processos, várias datas em conflito, ato negado)
 *   anula o campo e empurra para revisão. `motivo` explica porque NÃO está ok.
 */
export function parseCitiusNotification(raw) {
  const texto = stripHtml(raw);

  // PROCESSO: todos os números DISTINTOS. >1 => ambíguo => revisão (nunca escolhe
  // um; defende contra um número forjado escondido junto do verdadeiro).
  const procs = [...new Set(allMatches(RE_PROCESSO, texto))];
  let numeroProcesso = null;
  let motivo = null;
  if (procs.length === 0) motivo = 'processo não identificado';
  else if (procs.length > 1) motivo = 'vários números de processo na notificação';
  else numeroProcesso = procs[0];

  // ATO: primeiro ato reconhecido que NÃO esteja negado na janela imediatamente
  // anterior (ex.: "sem contestação", "findo o prazo de contestação").
  let ato = null;
  let regra = null;
  for (const a of ATOS) {
    const re = new RegExp(a.re.source, a.re.flags.includes('g') ? a.re.flags : `${a.re.flags}g`);
    let m;
    while ((m = re.exec(texto)) !== null) {
      const janela = texto.slice(Math.max(0, m.index - 30), m.index);
      if (RE_NEGACAO.test(janela)) continue; // negado -> ignora esta ocorrência
      ato = a.ato;
      regra = a;
      break;
    }
    if (ato) break;
  }
  if (numeroProcesso && !ato && !motivo) motivo = 'ato não reconhecido';

  // DATA do acto: todas as datas rotuladas DISTINTAS. Exactamente uma => usa-a;
  // mais do que uma distinta => CONFLITO => sem data => revisão (nunca adivinha).
  const datas = [...new Set(allMatches(RE_DATA_EXPLICITA, texto).map(normalizeData).filter(Boolean))];
  let dataExplicita = null;
  let dataConflito = false;
  if (datas.length === 1) dataExplicita = datas[0];
  else if (datas.length > 1) dataConflito = true;

  return {
    numeroProcesso,
    ato,
    regra,
    dataExplicita,
    dataConflito,
    ok: Boolean(numeroProcesso && ato),
    motivo,
    texto: texto.slice(0, 500),
    textoCompleto: texto,
  };
}
