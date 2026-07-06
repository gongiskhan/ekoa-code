/**
 * Pesquisa jurídica DGSI/DRE — pesquisa lexical sobre a base de conhecimento, com
 * extração de citação e VERIFICAÇÃO das ligações (cited-or-silent).
 *
 * Princípio NUNCA-INVENTAR: um resultado só é devolvido se tiver uma ligação
 * (url) e essa ligação RESOLVER (2xx) quando `verify` está ligado. Uma fonte sem
 * URL resolvível é descartada — preferimos silêncio a uma citação que o utilizador
 * não consegue abrir.
 *
 * Carried from cortex/src/services/legal-research.ts (B21, adapt/"rides A6"): the
 * knowledge FTS backend is an INJECTED `searchImpl` seam (default returns [] —
 * knowledge/ lands in its own build phase, so the service degrades cleanly to
 * `ok:true, hits:[]` with a note); the default verification fetch rides the
 * SSRF-guarded `guardedFetch` (ch09 invariant 8).
 */
import { guardedFetch } from '../services/url-fetcher.js';

/** Fonte pedida → coleções do vault onde o crawler grava os documentos dessa fonte. */
const SOURCE_COLLECTIONS: Record<string, string[]> = {
  dgsi: ['jurisprudencia'],
  dre: ['legislacao'],
};

export type ResearchSource = string;

/** Minimal search hit shape the service consumes (a subset of the knowledge FTS hit). */
export interface ResearchSearchHit {
  title?: string;
  snippet?: string;
  sourceUrl?: string;
  score?: number;
  date?: string;
}

export interface ResearchVerification {
  checked: boolean;
  ok?: boolean;
  status?: number;
}

export interface LegalResearchHit {
  source: string;
  title: string;
  url: string;
  snippet: string;
  citation?: string;
  verification: ResearchVerification;
}

export interface LegalResearchResult {
  ok: boolean;
  hits: LegalResearchHit[];
  /** Explicação PT-PT quando não há resultados citáveis (índice vazio, ligações mortas, …). */
  note?: string;
}

/** Costura de pesquisa — por omissão devolve [] (backend de conhecimento por ligar). */
export type ResearchSearchImpl = (
  query: string,
  opts: { collections: string[]; limit: number },
) => ResearchSearchHit[] | Promise<ResearchSearchHit[]>;

/** Resposta mínima de que a verificação precisa. */
export interface ResearchFetchResponse {
  ok: boolean;
  status: number;
}
export type ResearchFetchImpl = (url: string, init: { method: string; signal?: AbortSignal }) => Promise<ResearchFetchResponse>;

export interface LegalResearchOptions {
  sources?: ResearchSource[];
  limit?: number;
  verify?: boolean;
  searchImpl?: ResearchSearchImpl;
  fetchImpl?: ResearchFetchImpl;
}

const DEFAULT_LIMIT = 8;
const VERIFY_TIMEOUT_MS = 8_000;
const VERIFY_CONCURRENCY = 4;

// --- Extração de citação -----------------------------------------------------
const ECLI_RE = /ECLI:PT:[A-Z0-9]+:\d{4}:[A-Z0-9.]+/i;
const LEGISLATION_RE = /(Decreto-Lei|Lei|Portaria|Despacho)\s+n\.?º\s*[\d-]+(?:\/\d{4})?(?:,\s*de\s+\d{1,2}\s+de\s+\w+)?/i;
/** Número de processo DGSI (ex.: 1234/09.0TVLSB-A.S1). */
const PROC_RE = /\b\d{1,6}\/\d{2}\.\d[A-Za-z0-9.-]+/;

/** Extrai a primeira citação reconhecível do texto (ECLI > legislação > processo). */
export function extractCitation(text: string): string | undefined {
  const t = text || '';
  return t.match(ECLI_RE)?.[0] ?? t.match(LEGISLATION_RE)?.[0] ?? t.match(PROC_RE)?.[0] ?? undefined;
}

/** Corre `fn` sobre `items` com no máximo `concurrency` em voo; preserva a ordem. */
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i] as T);
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

/** searchImpl por omissão: sem backend de conhecimento ligado, devolve []. */
const defaultSearchImpl: ResearchSearchImpl = () => [];

/** fetch por omissão para a verificação — SSRF-guarded (ch09 invariant 8). */
const defaultFetchImpl: ResearchFetchImpl = async (url, init) => {
  const res = await guardedFetch(url, { method: init.method, timeoutMs: VERIFY_TIMEOUT_MS });
  return { ok: res.ok, status: res.status };
};

/**
 * Verifica se um URL resolve (2xx): tenta HEAD e, quando o servidor não o suporta
 * (403/405/501) ou falha, cai para GET.
 */
async function verifyUrl(url: string, fetchImpl: ResearchFetchImpl): Promise<{ ok: boolean; status?: number }> {
  const methods: string[] = ['HEAD', 'GET'];
  let lastStatus: number | undefined;
  for (let i = 0; i < methods.length; i++) {
    const method = methods[i] as string;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { method, signal: controller.signal });
      if (res && res.ok) return { ok: true, status: res.status };
      lastStatus = res?.status;
      if (method === 'HEAD' && (res?.status === 403 || res?.status === 405 || res?.status === 501)) continue;
      return { ok: false, status: lastStatus };
    } catch {
      // HEAD falhou (rede/timeout) → tenta GET; GET falhou → morto.
      if (method === 'HEAD') continue;
      return { ok: false, status: lastStatus };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, status: lastStatus };
}

/**
 * Pesquisa jurídica sobre DGSI/DRE. Devolve sempre `ok:true` (degrada limpo);
 * `hits` traz apenas fontes com URL e, quando `verify`, apenas as que resolvem.
 */
export async function legalResearch(query: string, opts: LegalResearchOptions = {}): Promise<LegalResearchResult> {
  const q = String(query || '').trim();
  if (!q) return { ok: true, hits: [], note: 'Consulta vazia.' };

  const sources = (opts.sources && opts.sources.length ? opts.sources : ['dgsi', 'dre']).filter((s) => SOURCE_COLLECTIONS[s]);
  if (sources.length === 0) {
    return { ok: true, hits: [], note: 'Nenhuma fonte reconhecida (use dgsi e/ou dre).' };
  }
  const limit = Math.max(1, opts.limit ?? DEFAULT_LIMIT);
  const verify = opts.verify !== false;
  const searchImpl = opts.searchImpl ?? defaultSearchImpl;
  const fetchImpl = opts.fetchImpl ?? defaultFetchImpl;

  // 1. PESQUISA — por fonte, etiquetando cada hit com a fonte de que veio.
  const tagged: Array<{ source: string; hit: ResearchSearchHit }> = [];
  for (const source of sources) {
    const collections = SOURCE_COLLECTIONS[source] as string[];
    let hits: ResearchSearchHit[] = [];
    try {
      hits = await searchImpl(q, { collections, limit });
    } catch {
      hits = [];
    }
    for (const hit of hits) tagged.push({ source, hit });
  }

  if (tagged.length === 0) {
    return {
      ok: true,
      hits: [],
      note: 'Sem resultados na base de conhecimento (índice vazio/não construído ou consulta sem correspondência).',
    };
  }

  // Ordena por score desc (recência como desempate) e corta ao limite.
  tagged.sort(
    (a, b) => (b.hit.score ?? 0) - (a.hit.score ?? 0) || Date.parse(b.hit.date || '') - Date.parse(a.hit.date || '') || 0,
  );
  const candidates = tagged.slice(0, limit);

  // 2. CITAÇÃO + montagem.
  const assembled: LegalResearchHit[] = candidates.map(({ source, hit }) => {
    const url = hit.sourceUrl ?? '';
    const citation = extractCitation(`${hit.title ?? ''}\n${hit.snippet ?? ''}`);
    const out: LegalResearchHit = {
      source,
      title: hit.title ?? '',
      url,
      snippet: hit.snippet ?? '',
      verification: { checked: false },
    };
    if (citation) out.citation = citation;
    return out;
  });

  // 3. VERIFICAÇÃO (opcional). Sem verify, mantém tudo (checked:false).
  if (!verify) {
    return { ok: true, hits: assembled };
  }

  const withUrl = assembled.filter((h) => h.url);
  const checked = await mapWithConcurrency(withUrl, VERIFY_CONCURRENCY, async (h) => {
    const v = await verifyUrl(h.url, fetchImpl);
    const verification: ResearchVerification = { checked: true, ok: v.ok };
    if (typeof v.status === 'number') verification.status = v.status;
    return { ...h, verification };
  });
  const resolved = checked.filter((h) => h.verification.ok);

  if (resolved.length === 0) {
    return {
      ok: true,
      hits: [],
      note: 'As fontes encontradas não resolveram (ligações inacessíveis); nada citável de momento.',
    };
  }
  return { ok: true, hits: resolved };
}
