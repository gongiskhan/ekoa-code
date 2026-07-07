/**
 * The slot-5 grounding block (ch08 §8.4, ch05 §5.5.2 item 2): the "cited-or-silent" knowledge
 * block that `agents/` injects into an agent's system prompt. It is a DYNAMIC, code-built block
 * (never content) consuming ONLY the caller's org partition of the lexical index.
 *
 * Two rules the spec fixes here:
 *  - Cited-or-silent: return top-k relevant snippets, each carrying a citation
 *    (collection / title / docId), or the empty string when nothing is relevant — never
 *    hallucinated filler.
 *  - Build gating: chat runs always get grounding; BUILD runs get it only when the deterministic,
 *    keyword-based legal-context detector matches the request (no model call).
 *
 * This module imports the lexical index only. It has NO path to llm/ (CLAUDE.md, FIXED-3).
 */
import { search, type SearchHit } from './index-store.js';

/** PT/EN legal-context keywords. Deterministic, lowercased, accent-insensitive substring match. */
const LEGAL_KEYWORDS = [
  // PT
  'processo', 'prazo', 'tribunal', 'acordao', 'citacao', 'peticao', 'contrato', 'clausula',
  'recurso', 'sentenca', 'jurisprudencia', 'advogado', 'juridic', 'juiz', 'partes', 'audiencia',
  'penhora', 'execucao', 'citius', 'dgsi', 'codigo civil', 'codigo penal', 'legisla', 'decreto',
  'portaria', 'escritura', 'notario', 'litigio', 'peticao inicial', 'contestacao', 'diligencia',
  // EN
  'lawsuit', 'legal', 'court', 'lawyer', 'attorney', 'contract', 'clause', 'litigation',
  'plaintiff', 'defendant', 'statute', 'jurisdiction', 'deadline', 'hearing', 'judgment',
];

/** Fold to a lowercase, accent-stripped form for keyword matching (independent of FTS folding). */
function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Deterministic legal-context detector (ch05 §5.5.2, ch08 §8.4 build row). No model call. */
export function isLegalContext(query: string): boolean {
  const f = fold(query);
  return LEGAL_KEYWORDS.some((k) => f.includes(k));
}

export interface GroundingInput {
  orgId: string;
  query: string;
  kind: 'chat' | 'build';
  /** top-k snippets (default 5). */
  limit?: number;
}

export interface GroundingResult {
  block: string;
  hits: SearchHit[];
}

/** Format the cited block. Each hit renders a numbered citation line + its snippet. */
function formatBlock(hits: SearchHit[]): string {
  const lines = ['CONHECIMENTO (excertos com fonte citada; use apenas o que for relevante):'];
  hits.forEach((h, i) => {
    lines.push(`[${i + 1}] ${h.collection} / ${h.title} (doc ${h.docId})`);
    if (h.snippet.trim()) lines.push(h.snippet.trim());
  });
  return lines.join('\n');
}

/** Build the grounding block. Returns '' (silent) when the run is a non-legal build, or when
 *  nothing in the org partition is relevant. */
export function buildGroundingBlock(input: GroundingInput): GroundingResult {
  if (input.kind === 'build' && !isLegalContext(input.query)) return { block: '', hits: [] };
  const hits = search(input.orgId, input.query, input.limit ?? 5);
  if (hits.length === 0) return { block: '', hits: [] };
  return { block: formatBlock(hits), hits };
}
