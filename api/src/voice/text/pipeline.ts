/**
 * voice/text/pipeline.ts - the TTS text pipeline (BRIEF §5, run 20260717-190134, slice C5).
 * Applied by the relay to every `say` text BEFORE the provider synthesizes:
 *
 *   sanitizeForSpeech  strip markdown/code/tables/images - BELT-AND-BRACES: the agent already
 *                      avoids them when a voice session is active (the context note in
 *                      agents/context.ts); this is the safety net, per the product stance
 *                      "no tables/code/images/markdown in what gets spoken".
 *   normalizeNumbers   speakable.ts (C3): digit forms -> PT-PT / EN words. pt-BR reuses the
 *                      PT normalizer in v1 (documented limit: numbers read in PT-PT forms).
 *   chunkSentences     split into speakable sentence units so the relay synthesizes
 *                      per-sentence and playback can start as soon as the FIRST sentence's
 *                      audio is complete, not the whole reply's.
 *
 * Everything here is pure string work: no I/O, no config, no vendor anything. The seed for
 * the sanitizer is jarvis-os toSpeakable() (strip what reads terribly aloud - c-voice
 * deviations memo (i)); the table/heading/list handling is new.
 */
import type { VoiceLang } from '@ekoa/shared';
import { normalizeNumbersEn, normalizeNumbersPt } from './speakable.js';

/* ---------------------------------- sanitizer ---------------------------------- */

/** A markdown table separator row: |---|:---:| etc. (with or without outer pipes). */
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
/** Outer-pipe table row: leading AND trailing pipe (`| a | b |`) - unambiguously a table. */
const TABLE_OUTER_ROW = /^\s*\|.*\|\s*$/;
/** A line carrying at least one interior pipe (a table-row CANDIDATE). Whether it is really a
 *  table row is decided by CONTEXT (see dropTableBlocks): a lone prose sentence with one stray
 *  pipe survives; a run of 2+ such lines, or a line next to a separator row, is a table. */
const PIPE_CANDIDATE = /^\s*[^|\n]*\|[^|\n]*/;
/** A setext heading underline (=== / ---) or a horizontal rule (***, ---, ___). */
const RULE_LINE = /^\s*(={3,}|(-\s*){3,}|(\*\s*){3,}|(_\s*){3,})\s*$/;

/**
 * Strip everything that reads terribly aloud out of markdown-ish reply text, keeping the
 * prose. Dropped entirely: fenced code blocks (content included - code is a visual artifact,
 * the voice note tells the agent to NAME it instead), table rows, images, bare URLs,
 * horizontal rules. Unwrapped (markers removed, content kept): inline code, links, emphasis,
 * headings, blockquotes, list items. Whitespace collapses to clean prose; paragraph breaks
 * survive as double newlines (chunk boundaries downstream).
 */
/**
 * Context-aware table detection. Returns a line array where table-block lines are `null`
 * (to be dropped) and everything else is the original string. A pipe-bearing line is a table
 * row when it is: the outer-pipe form (`| a | b |`), OR part of a RUN of 2+ consecutive
 * pipe-bearing lines (a header + rows), OR immediately adjacent to a table separator row
 * (`|---|`). A LONE prose sentence with a single stray pipe is none of these and survives.
 */
function dropTableBlocks(lines: string[]): (string | null)[] {
  const isSep = (l: string | undefined): boolean => l !== undefined && TABLE_SEPARATOR.test(l);
  const hasPipe = (l: string): boolean => PIPE_CANDIDATE.test(l) || TABLE_OUTER_ROW.test(l);
  // A pipe line READS LIKE A TABLE ROW (not a prose sentence): it does not end in sentence
  // punctuation and every pipe-separated cell is short (<= 4 words). This keeps a paragraph
  // whose consecutive lines each happen to contain a pipe from being mistaken for a table.
  const looksTabular = (l: string): boolean => {
    const t = l.trim();
    if (!hasPipe(t)) return false;
    if (/[.!?:;]$/.test(t)) return false;
    const cells = t.replace(/^\||\|$/g, '').split('|');
    return cells.every((c) => c.trim().split(/\s+/).filter(Boolean).length <= 4);
  };
  const drop = new Array<boolean>(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    if (!hasPipe(lines[i]!)) { i++; continue; }
    // Extend a run over consecutive pipe-bearing lines, but count only tabular-looking ones.
    let j = i;
    let tabularInRun = 0;
    while (j < lines.length && hasPipe(lines[j]!)) {
      if (looksTabular(lines[j]!)) tabularInRun++;
      j++;
    }
    for (let k = i; k < j; k++) {
      const l = lines[k]!;
      if (
        TABLE_OUTER_ROW.test(l.trim()) || // unambiguous table row
        (looksTabular(l) && tabularInRun >= 2) || // header + at least one tabular row
        (hasPipe(l) && (isSep(lines[k - 1]) || isSep(lines[k + 1]))) // next to a separator row
      ) {
        drop[k] = true;
      }
    }
    i = j;
  }
  return lines.map((l, idx) => (drop[idx] ? null : l));
}

export function sanitizeForSpeech(text: string): string {
  let out = text.replace(/\r\n?/g, '\n');

  // Fenced code blocks first (``` or ~~~, any info string, up to 3 leading spaces - common
  // inside list items). An unclosed fence swallows the rest: better silence than reading half
  // a diff aloud.
  out = out.replace(/(^|\n)[ ]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(\n[ ]{0,3}\2`*~*[^\n]*)(?=\n|$)/g, '$1');
  out = out.replace(/(^|\n)[ ]{0,3}(`{3,}|~{3,})[^\n]*(\n[\s\S]*)?$/g, '$1');

  // Unwrap inline code BEFORE the line-oriented pass: a snippet like `grep x | sort` carries a
  // pipe that would otherwise look like a table row and delete the whole prose line.
  out = out.replace(/`([^`\n]+)`/g, '$1');

  // Line-oriented pass: drop table blocks (context-aware), separator rows, setext underlines
  // and rules; unwrap headings, blockquotes and list markers.
  const lines = dropTableBlocks(out.split('\n')).map((line) => {
    if (line === null) return ''; // dropped as part of a table block
    if (TABLE_SEPARATOR.test(line) || RULE_LINE.test(line)) return '';
    let l = line;
    l = l.replace(/^\s{0,3}#{1,6}\s+/, ''); // ATX heading marker
    l = l.replace(/^\s*(?:>\s?)+/, ''); // blockquote markers (nested)
    l = l.replace(/^(\s*)[-*+]\s+/, '$1'); // bullet list marker
    l = l.replace(/^(\s*)\d{1,3}[.)]\s+/, '$1'); // ordered list marker
    return l;
  });
  out = lines.join('\n');

  // Images dropped entirely (visual artifact - the agent names it, never reads it); links
  // keep their text; autolinks and bare URLs are dropped (nobody wants a URL read aloud).
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  out = out.replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1');
  out = out.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  out = out.replace(/<https?:\/\/[^>\s]+>/g, '');
  out = out.replace(/\bhttps?:\/\/[^\s)]+/g, '');
  out = out.replace(/\bwww\.[^\s)]+/g, '');

  // Inline markers unwrapped, longest first so ** does not leave a stray * (inline code was
  // already unwrapped before the line pass above).
  out = out.replace(/(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g, '$2');
  out = out.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2');
  out = out.replace(/\*(?=\S)([^*\n]*\S)\*/g, '$1');
  // Underscore emphasis only when clearly markdown (not snake_case): markers at word edges.
  out = out.replace(/(^|\s)_(?=\S)([^_\n]*\S)_(?=\s|[.,;:!?]|$)/g, '$1$2');
  out = out.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1');

  // Stray HTML tags (the agent should not emit them; belt-and-braces).
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, '');

  // Whitespace: spaces collapse, 3+ newlines collapse to one paragraph break, edges trimmed.
  out = out
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n');
  out = out.replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
  return out;
}

/* ------------------------------- sentence chunking ------------------------------- */

/**
 * Dot-ended tokens that do NOT end a sentence (PT + EN abbreviations, lowercase; matched
 * case-insensitively). Deliberately conservative: a missed abbreviation merely delays the
 * chunk boundary to the next sentence end - it never corrupts text.
 */
const ABBREVIATIONS = new Set([
  // PT
  'sr', 'sra', 'srs', 'sras', 'dr', 'dra', 'drs', 'eng', 'engª', 'prof', 'profª', 'exmo', 'exma',
  'art', 'arts', 'al', 'n', 'nº', 'num', 'núm', 'pág', 'págs', 'p', 'pp', 'ex', 'etc', 'séc',
  'av', 'r', 'tel', 'telef', 'cfr', 'cf', 'proc', 'ac', 'vol', 'ed', 'obs',
  // EN
  'mr', 'mrs', 'ms', 'st', 'no', 'vs', 'e.g', 'i.e', 'approx', 'dept', 'inc', 'ltd', 'fig',
]);

/** Sentence terminator + optional closing decoration, followed by whitespace or end. */
const SENTENCE_END = /([.!?…]+)(["'”’)\]»]*)(\s+|$)/g;

/** Chunks longer than this get a secondary split at clause punctuation (TTS providers and
 *  early playback both prefer bounded units; 300 chars ≈ 20 s of speech). */
const MAX_CHUNK_CHARS = 300;

function endsWithAbbreviation(head: string): boolean {
  // The token immediately before the terminator, e.g. "Sr" in "o Sr." or "J" in "J. Silva".
  const m = /([\p{L}\p{N}.º ª]*?)([\p{L}\p{N}ºª]+)$/u.exec(head);
  if (!m) return false;
  const token = m[2]!; // group 2 is non-optional in a successful match
  if (/^\p{L}$/u.test(token)) return true; // single-letter initial: "J. Silva"
  if (ABBREVIATIONS.has(token.toLowerCase())) return true;
  // "e.g." / "i.e." arrive as "e.g" heads (previous dot inside the token).
  const dotted = /(\p{L}\.\p{L})$/u.exec(head);
  if (dotted && ABBREVIATIONS.has(dotted[1]!.toLowerCase())) return true;
  return false;
}

/** Split one paragraph into sentences (abbreviation-aware; dots inside numbers never split
 *  because SENTENCE_END requires whitespace-or-end after the terminator). */
function splitParagraph(paragraph: string): string[] {
  const sentences: string[] = [];
  let start = 0;
  SENTENCE_END.lastIndex = 0;
  for (let m = SENTENCE_END.exec(paragraph); m; m = SENTENCE_END.exec(paragraph)) {
    const end = m.index + m[1]!.length + m[2]!.length; // groups 1+2 are non-optional
    const head = paragraph.slice(start, m.index);
    // Only a plain '.' can be an abbreviation dot; '!', '?', '…' and multi-dot always end.
    if (m[1] === '.' && endsWithAbbreviation(head)) continue;
    const sentence = paragraph.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const tail = paragraph.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
}

/** Secondary split for an over-long sentence: prefer the clause boundary (,;:) nearest below
 *  the cap, fall back to the last whitespace, hard-cut as a last resort. */
function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK_CHARS) return [sentence];
  const window = sentence.slice(0, MAX_CHUNK_CHARS);
  let cut = Math.max(window.lastIndexOf(','), window.lastIndexOf(';'), window.lastIndexOf(':'));
  if (cut < MAX_CHUNK_CHARS / 4) cut = window.lastIndexOf(' ');
  if (cut <= 0) cut = MAX_CHUNK_CHARS;
  const head = sentence.slice(0, cut + 1).trim();
  const rest = sentence.slice(cut + 1).trim();
  return [head, ...(rest ? splitLong(rest) : [])];
}

/**
 * Split sanitized, normalized prose into speakable sentence units. Paragraph breaks are always
 * boundaries; within a paragraph, sentence-final punctuation splits unless it closes a known
 * abbreviation or an initial; dotted numbers ("1.2.3", "1.º") never split mid-token (the
 * terminator must be followed by whitespace). Over-long sentences split at clause boundaries.
 */
export function chunkSentences(text: string): string[] {
  const chunks: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const flat = paragraph.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!flat) continue;
    for (const sentence of splitParagraph(flat)) chunks.push(...splitLong(sentence));
  }
  return chunks;
}

/* -------------------------------- composed pipeline -------------------------------- */

/**
 * The full C5 pipeline: sanitize -> normalize numbers for the language -> sentence-chunk.
 * Returns the ordered speakable units the relay hands to the provider one at a time; an
 * empty array means there is nothing speakable (e.g. the reply was ONLY a code block) and
 * the relay completes the turn without synthesizing.
 */
export function speakableChunks(text: string, lang: VoiceLang): string[] {
  const sanitized = sanitizeForSpeech(text);
  if (!sanitized) return [];
  // pt-BR shares the PT normalizer in v1 (PT-PT cardinal forms; documented limit above).
  const normalized = lang === 'en' ? normalizeNumbersEn(sanitized) : normalizeNumbersPt(sanitized);
  return chunkSentences(normalized);
}
