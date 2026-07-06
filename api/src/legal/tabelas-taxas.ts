/**
 * Crawler de TABELAS DE TAXAS — extensão dirigida do crawling DRE/DGSI para os
 * Avisos semestrais da DGTF (taxa supletiva de juros comerciais) e para a UC
 * anual. Escreve uma linha de OVERLAY na colecção `tabelas_taxas` da espinha, que
 * `calculos.ts::mergeTabela` sobrepõe à tabela canónica (o overlay ganha por
 * semestre/ano).
 *
 * HONESTIDADE: o crawl VIVO precisa de rede/acesso ao DRE — fica para
 * pós-checkpoint. O que fica committed e testado é o PARSER puro (`parseAvisoEtf`)
 * e o orquestrador com `fetch` injectável (`refreshTabelasTaxas`) exercido por uma
 * FIXTURE HTML determinística. Sem fetch real, nada é inventado.
 *
 * Carried port-as-is from cortex/src/services/tabelas-taxas.ts (A11): zero
 * imports, pure — no default network path (the fetch is injected or a fixture).
 */

/** Índice de pesquisa do DRE dos Avisos da DGTF (ponto de entrada do crawl vivo). */
export const DRE_AVISOS_ETF_URL = 'https://diariodarepublica.pt/dr/pesquisa?q=taxa%20supletiva%20juros%20mora%20DGTF';

export interface AvisoEtfRow {
  tipo: 'juros_comerciais';
  /** Ex.: '2024-S1'. */
  semestre: string;
  /** Percentagem anual (ex.: 12.5). */
  taxa: number;
  /** Ex.: 'Aviso n.º 1274/2024, DGTF'. */
  aviso: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  /** Proveniência da linha (para o registo). */
  fonte: string;
}

export interface CrawlDeps {
  /** Costura de `fetch` (testes injectam). */
  fetchImpl?: (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
  /** HTML directo (testes com fixture) — curto-circuita o fetch. */
  html?: string;
  /** URL a consultar (por omissão o índice DRE dos Avisos DGTF). */
  url?: string;
  /** Callback para persistir a linha na espinha (best-effort; opcional). */
  writeOverlay?: (row: AvisoEtfRow) => Promise<void>;
}

export type CrawlResult = { ok: true; row: AvisoEtfRow; fonte: string } | { ok: false; error: string };

/** Fold de acentos + minúsculas, para casar texto tolerante a "1.º"/"primeiro". */
function fold(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Remove marcação HTML, deixando texto corrido (o parser trabalha sobre texto). */
function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&aacute;|&agrave;|&atilde;/gi, 'a')
    .replace(/\s+/g, ' ')
    .trim();
}

/** '2.º'/'segundo' -> 'S2'; qualquer outra coisa -> 'S1'. */
function semestreLabel(raw: string): 'S1' | 'S2' {
  const t = fold(raw);
  return /2\.?º|2\b|segundo/.test(t) ? 'S2' : 'S1';
}

function vigencia(ano: number, sem: 'S1' | 'S2'): { inicio: string; fim: string } {
  return sem === 'S1'
    ? { inicio: `${ano}-01-01`, fim: `${ano}-06-30` }
    : { inicio: `${ano}-07-01`, fim: `${ano}-12-31` };
}

/**
 * Extrai a taxa supletiva de juros comerciais de um Aviso ETF (DGTF) a partir do
 * HTML do DRE. Determinístico e sem rede. Devolve `null` quando o documento não
 * contém, sem ambiguidade, o Aviso + a taxa + o semestre — NUNCA adivinha.
 */
export function parseAvisoEtf(html: string): AvisoEtfRow | null {
  const text = stripHtml(html);
  const folded = fold(text);

  // 1) Número do aviso: "Aviso n.º 1274/2024".
  const avisoMatch = text.match(/Aviso\s+n\.?º\s*([0-9]+\/[0-9]{4})/i);
  if (!avisoMatch) return null;
  const avisoNum = avisoMatch[1];

  // 2) Semestre + ano: "1.º semestre de 2024" / "primeiro semestre de 2024".
  const semMatch = folded.match(/(1\.?º|2\.?º|primeiro|segundo)\s+semestre\s+de\s+([0-9]{4})/);
  if (!semMatch) return null;
  const sem = semestreLabel(semMatch[1] ?? '');
  const ano = Number(semMatch[2]);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return null;

  // 3) Taxa: a percentagem da taxa supletiva. GUARDA: o documento tem de falar de
  //    juros supletivos/moratórios, senão não é um Aviso ETF e recusamos.
  const falaDeJuros = /juros/.test(folded) && /(supletiv|morator)/.test(folded);
  if (!falaDeJuros) return null;
  const taxaMatch = folded.match(/\bde\s+([0-9]+(?:[.,][0-9]+)?)\s*%/) || folded.match(/([0-9]+(?:[.,][0-9]+)?)\s*%/);
  if (!taxaMatch) return null;
  const taxa = Number((taxaMatch[1] ?? '').replace(',', '.'));
  if (!Number.isFinite(taxa) || taxa <= 0 || taxa > 100) return null;

  const { inicio, fim } = vigencia(ano, sem);
  return {
    tipo: 'juros_comerciais',
    semestre: `${ano}-${sem}`,
    taxa,
    aviso: `Aviso n.º ${avisoNum}, DGTF`,
    vigenciaInicio: inicio,
    vigenciaFim: fim,
    fonte: 'DRE - Aviso DGTF',
  };
}

/**
 * Orquestra a atualização de UMA linha de juros comerciais: obtém o HTML (fixture
 * injectada OU fetch vivo) e faz o parse. Se `writeOverlay` for fornecido,
 * persiste a linha (best-effort). Não lança.
 */
export async function refreshTabelasTaxas(deps: CrawlDeps = {}): Promise<CrawlResult> {
  let html = deps.html;
  const url = deps.url || DRE_AVISOS_ETF_URL;

  if (html == null) {
    if (!deps.fetchImpl) {
      return {
        ok: false,
        error: 'Crawl vivo indisponível: sem fetch configurado (fica para pós-checkpoint). Forneça uma fixture HTML para testar o parser.',
      };
    }
    try {
      const res = await deps.fetchImpl(url);
      if (!res || !res.ok) return { ok: false, error: `DRE indisponível (HTTP ${res ? res.status : 'sem resposta'}).` };
      html = await res.text();
    } catch {
      return { ok: false, error: 'Falha ao contactar o DRE.' };
    }
  }

  const row = parseAvisoEtf(html);
  if (!row) return { ok: false, error: 'Não foi possível extrair o Aviso/taxa/semestre do documento do DRE.' };

  if (deps.writeOverlay) {
    try {
      await deps.writeOverlay(row);
    } catch {
      /* best-effort — a persistência não pode falhar o parse */
    }
  }
  return { ok: true, row, fonte: row.fonte };
}
