/*
 * Formatação de citações jurídicas segundo as normas portuguesas de referência -
 * módulo puro, app-local (não sincronizado; vive só na Pesquisa). Sem estado, sem
 * I/O; testável isoladamente.
 *
 * PRINCÍPIO NUNCA-INVENTAR (herdado de pesquisa-logic.js): a citação formatada é
 * SEMPRE acompanhada do URL da fonte. Não fabricamos um acórdão nem um diploma:
 * partimos exclusivamente do que a linha guardada já contém (fonte, título, url,
 * excerto) e apenas o REESCREVEMOS na forma de referência habitual. Quando não há
 * elementos suficientes para a forma canónica, degradamos honestamente para
 * "título + URL" em vez de inventar um número de processo ou uma data.
 *
 * Normas seguidas (uso corrente no foro português):
 *  - Jurisprudência (DGSI): "Ac. <Tribunal> de DD-MM-AAAA, proc. <n.º>"
 *    ex.: Ac. TRL de 12-03-2024, proc. 123/20.0T8LSB
 *  - Legislação (DRE): o diploma tal como identificado (ex.: "Lei n.º 62/2013,
 *    de 26 de agosto"), acrescido de "in Diário da República".
 */

/* Siglas dos tribunais superiores reconhecidas em títulos/URLs da DGSI. A ordem
 * importa: as mais específicas (Relação de uma cidade) antes das genéricas. */
const TRIBUNAL_SIGLAS = [
  { re: /\bSupremo Tribunal de Justiça\b/i, sigla: 'STJ' },
  { re: /\bSupremo Tribunal Administrativo\b/i, sigla: 'STA' },
  { re: /\bTribunal Constitucional\b/i, sigla: 'TC' },
  { re: /\bTribunal da Rela[çc][ãa]o de Lisboa\b/i, sigla: 'TRL' },
  { re: /\bTribunal da Rela[çc][ãa]o do Porto\b/i, sigla: 'TRP' },
  { re: /\bTribunal da Rela[çc][ãa]o de Coimbra\b/i, sigla: 'TRC' },
  { re: /\bTribunal da Rela[çc][ãa]o de [ÉE]vora\b/i, sigla: 'TRE' },
  { re: /\bTribunal da Rela[çc][ãa]o de Guimar[ãa]es\b/i, sigla: 'TRG' },
];

/* Sigla directa (já em maiúsculas) que possa aparecer no título/URL. */
const SIGLA_DIRECTA = /\b(STJ|STA|TC|TRL|TRP|TRC|TRE|TRG|TCAS|TCAN)\b/;

/* Número de processo no formato do foro (ex.: 123/20.0T8LSB, 1234/09.0TVLSB-A.S1). */
const PROC_RE = /\b\d{1,6}\/\d{2}\.\d[A-Za-z0-9.-]+/;

/* Data no texto: aceita AAAA-MM-DD, DD/MM/AAAA e DD-MM-AAAA. Devolve DD-MM-AAAA. */
const DATA_ISO = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const DATA_PT = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/;

function pad2(n) {
  return String(n).padStart(2, '0');
}

/* Extrai a sigla do tribunal do texto (nome por extenso -> sigla, ou sigla já
 * presente). Devolve null quando não há tribunal reconhecível. */
export function extrairTribunal(texto) {
  const t = String(texto || '');
  for (const { re, sigla } of TRIBUNAL_SIGLAS) {
    if (re.test(t)) return sigla;
  }
  const m = t.match(SIGLA_DIRECTA);
  return m ? m[1] : null;
}

/* Extrai o número de processo (forma do foro) do texto. Null quando ausente. */
export function extrairProcesso(texto) {
  const m = String(texto || '').match(PROC_RE);
  return m ? m[0] : null;
}

/* Extrai uma data e normaliza-a para DD-MM-AAAA. Null quando ausente. */
export function extrairData(texto) {
  const t = String(texto || '');
  const iso = t.match(DATA_ISO);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  const pt = t.match(DATA_PT);
  if (pt) return `${pad2(pt[1])}-${pad2(pt[2])}-${pt[3]}`;
  return null;
}

/* True quando a fonte é jurisprudência (DGSI). */
function ehJurisprudencia(fonte) {
  return String(fonte || '').toUpperCase() === 'DGSI';
}

/*
 * Constrói a referência de uma citação segundo a norma portuguesa, a partir SÓ
 * dos elementos disponíveis na citação guardada { fonte, titulo, url, excerto }.
 *
 * Devolve { referencia, url, forma } onde `forma` é:
 *  - 'acordao'   quando conseguiu tribunal + processo (forma canónica DGSI);
 *  - 'diploma'   quando é legislação (DRE) identificada;
 *  - 'titulo'    degradação honesta (só título) - sem inventar elementos.
 * O URL viaja SEMPRE (nunca-inventar: a referência é verificável).
 */
export function formatarCitacao(citacao) {
  const c = citacao || {};
  const url = c.url ? String(c.url) : '';
  const contexto = `${c.titulo || ''}\n${c.excerto || ''}\n${url}`;

  if (ehJurisprudencia(c.fonte)) {
    const tribunal = extrairTribunal(contexto);
    const processo = extrairProcesso(contexto);
    const data = extrairData(contexto);
    if (tribunal && processo) {
      const partes = [`Ac. ${tribunal}`];
      if (data) partes.push(`de ${data}`);
      const cabeca = partes.join(' ');
      return { referencia: `${cabeca}, proc. ${processo}`, url, forma: 'acordao' };
    }
  }

  // Legislação (DRE) ou jurisprudência sem elementos canónicos: usa o título tal
  // como está - é o identificador que o DRE/DGSI já nos deu, nunca inventado.
  const titulo = String(c.titulo || '').trim();
  if (titulo) {
    const forma = ehJurisprudencia(c.fonte) ? 'titulo' : 'diploma';
    const sufixo = forma === 'diploma' ? ', in Diário da República' : '';
    return { referencia: `${titulo}${sufixo}`, url, forma };
  }

  // Sem título nem elementos: só resta o URL (degradação máxima honesta).
  return { referencia: url || '(sem referência)', url, forma: 'titulo' };
}

/*
 * Texto completo, pronto a colar, de uma citação: a referência normalizada
 * seguida do URL entre parênteses. É o que o botão "Copiar citação" coloca na
 * área de transferência.
 */
export function citacaoParaClipboard(citacao) {
  const { referencia, url } = formatarCitacao(citacao);
  return url ? `${referencia} (${url})` : referencia;
}

/*
 * Copia texto para a área de transferência, degradando honestamente quando a API
 * do navegador não está disponível (contextos sem clipboard). Devolve true/false.
 */
export async function copiarTexto(texto) {
  const t = String(texto || '');
  if (!t) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {
    /* cai para o método legado */
  }
  try {
    if (typeof document !== 'undefined') {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.setAttribute('readonly', '');
      ta.style.position = 'absolute';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      document.body.removeChild(ta);
      return !!ok;
    }
  } catch {
    /* sem clipboard */
  }
  return false;
}
