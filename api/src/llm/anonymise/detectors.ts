/**
 * llm/anonymise/detectors.ts - the three detection layers behind ONE interface (§17.4), so
 * callers never see which fired. Detection is layered, recall-biased, and has no human in the
 * loop.
 *
 *   (a) PT structured-ID recognizers - regex + checksum, near-certain. A candidate is a hit
 *       ONLY when it passes its class checksum; a checksum-invalid candidate is NOT tokenized
 *       here (it may still be caught by the deny-list).
 *   (b) Per-org deny-list - certain-catch regardless of NER. Matched literally. The list is
 *       secret material: an org-scoped-encrypted form is decrypted through the one crypto
 *       module and its access is audit-logged (§17.4 (b), v2 A6 D3).
 *   (c) PT-PT NER - recall-biased, behind the same interface, BEST-EFFORT. (a)+(b) MUST NOT
 *       depend on (c) being up: an NER outage degrades recall but never fails the request
 *       (§17.3, §17.4). A real in-process ONNX model is a later task; this ships a pluggable
 *       placeholder the interface can swap without a call-site change.
 */
import { decryptForScope } from '../../data/crypto.js';
import type { EntityClass, EntitySpan, OrgRuleset } from './types.js';
import { isValidNif, isValidNiss, isValidIbanPt, isValidCc } from './checksum.js';

// --- (c) NER: the pluggable interface + the default placeholder --------------------------

/** The PT-PT NER head, behind the interface of §17.4 (c). `available()` lets the pipeline
 *  record reduced coverage without failing when the head is down. */
export interface NerDetector {
  available(): boolean;
  detect(text: string): EntitySpan[];
}

/** The default placeholder: available, detects nothing. It is deliberately inert so the
 *  layer ships CORRECT first (§17.4 serving decision) - (a)+(b) carry the certainty, and a
 *  real recall-biased ONNX model swaps in here later with no call-site change. Tests inject a
 *  deterministic dictionary detector to exercise the (c) path. */
const inertNer: NerDetector = {
  available: () => true,
  detect: () => [],
};

let ner: NerDetector = inertNer;

/** Swap the NER head (the real ONNX model, or a test dictionary detector). */
export function setNerDetector(detector: NerDetector): void {
  ner = detector;
}
export function __resetNerForTests(): void {
  ner = inertNer;
}

/** A deterministic dictionary NER for tests + as a reference pluggable detector: flags each
 *  supplied name (case-insensitive, boundary-aware). Recall-biased by construction. */
export function dictionaryNer(names: string[], opts?: { available?: boolean; throwOnDetect?: boolean }): NerDetector {
  return {
    available: () => opts?.available ?? true,
    detect: (text) => {
      if (opts?.throwOnDetect) throw new Error('NER head unavailable');
      return literalSpans(text, names, 'PERSON');
    },
  };
}

// --- (a) structured-ID recognizers -------------------------------------------------------

interface Recognizer {
  cls: EntityClass;
  re: RegExp;
  /** the capture group index carrying the candidate (0 = whole match). */
  group: number;
  valid: (candidate: string) => boolean;
  /** normalize the raw match before checksum validation (e.g. strip IBAN grouping spaces); the
   *  span VALUE stays the raw match so replacement covers the separators. */
  normalize?: (candidate: string) => string;
}

const stripSpaces = (s: string): string => s.replace(/\s+/g, '');

const RECOGNIZERS: Recognizer[] = [
  // IBAN accepts the compact (PT+23 digits) AND the standard space-grouped form; the checksum
  // runs on the space-stripped value, the span covers the raw (spaced) text.
  { cls: 'IBAN', re: /\bPT\d{2}(?:\s?\d{4}){5}\s?\d\b/g, group: 0, valid: isValidIbanPt, normalize: stripSpaces },
  { cls: 'NISS', re: /\b\d{11}\b/g, group: 0, valid: isValidNiss },
  { cls: 'CC', re: /\b\d{9}[A-Z]{2}\d\b/g, group: 0, valid: isValidCc },
  { cls: 'NIF', re: /\b\d{9}\b/g, group: 0, valid: isValidNif },
  // context-cued, format-only classes (precision from the cue, not a checksum)
  { cls: 'UTENTE', re: /\butente\D{0,12}(\d{9})\b/gi, group: 1, valid: () => true },
  { cls: 'PROCESSO', re: /\bprocesso\D{0,12}(\d{1,6}\/\d{2}\.\d[A-Z]{2,5}[A-Z0-9]*)\b/gi, group: 1, valid: () => true },
  { cls: 'PROCESSO', re: /\b\d{1,6}\/\d{2}\.\d[A-Z]{3,5}\b/g, group: 0, valid: () => true },
];

function structuredSpans(text: string): EntitySpan[] {
  const spans: EntitySpan[] = [];
  for (const r of RECOGNIZERS) {
    const re = new RegExp(r.re.source, r.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const candidate = m[r.group];
      if (candidate === undefined) continue;
      if (!r.valid(r.normalize ? r.normalize(candidate) : candidate)) continue;
      const start = m.index + m[0].indexOf(candidate);
      spans.push({ start, end: start + candidate.length, value: candidate, cls: r.cls });
    }
  }
  return spans;
}

// --- (b) deny-list -----------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** All boundary-aware, case-insensitive occurrences of each literal, tagged with `cls`. */
function literalSpans(text: string, literals: string[], cls: EntityClass): EntitySpan[] {
  const spans: EntitySpan[] = [];
  for (const lit of literals) {
    if (!lit) continue;
    const re = new RegExp(`(?<![\\p{L}\\d])${escapeRe(lit)}(?![\\p{L}\\d])`, 'giu');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, value: m[0], cls });
      if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-width loops
    }
  }
  return spans;
}

/**
 * Resolve the effective deny-list for a ruleset. An org-scoped-encrypted deny-list is
 * decrypted through the one crypto module and its access is audit-logged (§17.4 (b)). The
 * decrypted list is used for detection only and is never sent to Anthropic.
 */
export function resolveDenyList(ruleset: OrgRuleset, onAccess?: (count: number) => void): string[] {
  if (ruleset.denyListCiphertext) {
    // Org-scoped decryption (§17.4 b): the ciphertext is bound to ruleset.orgId, so another org's
    // ciphertext cannot be decrypted here (GCM auth fails) - defense in depth beyond row scoping.
    const parsed = JSON.parse(decryptForScope(ruleset.denyListCiphertext, ruleset.orgId)) as unknown;
    const list = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    onAccess?.(list.length); // access-logged: the deny-list is secret material (D3)
    return list;
  }
  return ruleset.denyList ?? [];
}

// --- The one detection interface (§17.4) -------------------------------------------------

export interface DetectionResult {
  spans: EntitySpan[];
  /** false when the NER head (c) is down - recall is reduced but the request proceeds. */
  nerAvailable: boolean;
  /** false when a MANDATORY detector ((a) or (b)) could not run - the pipeline fails closed. */
  mandatoryOk: boolean;
}

/** Overlap resolution, recall-biased (§17.4 c "when unsure, redact"): overlapping spans are
 *  MERGED into their union and the whole union is tokenized, so a partially-overlapping span's
 *  non-overlapping remainder is never dropped (a leak). The union's class is the longest
 *  contributing span's, with a certain-catch class ((a)/(b), rank 1) winning a tie over the
 *  recall-biased (c) NER (rank 0). Adjacent-but-not-overlapping spans (s.start === last.end) do
 *  NOT merge. `text` supplies the union's exact substring value. */
function resolveOverlaps(spans: EntitySpan[], text: string): EntitySpan[] {
  if (spans.length === 0) return [];
  const rank = (c: EntityClass): number => (c === 'PERSON' ? 0 : 1);
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: EntitySpan[] = [];
  let bestLen = 0;
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end) {
      // Overlap -> extend the union and re-pick the class from the longest / most-certain span.
      const sLen = s.end - s.start;
      if (s.end > last.end) last.end = s.end;
      last.value = text.slice(last.start, last.end);
      if (sLen > bestLen || (sLen === bestLen && rank(s.cls) > rank(last.cls))) {
        last.cls = s.cls;
        bestLen = sLen;
      }
    } else {
      merged.push({ ...s });
      bestLen = s.end - s.start;
    }
  }
  return merged;
}

/**
 * Run all three layers on a piece of text. (a) and (b) are mandatory pure-code detectors that
 * always run; their failure sets `mandatoryOk=false` so the pipeline refuses rather than
 * forwarding un-tokenized (§17.3, fail-closed). (c) is wrapped so an outage never fails the
 * request - it only lowers `nerAvailable`.
 */
export function detect(text: string, ruleset: OrgRuleset, onDenyAccess?: (count: number) => void): DetectionResult {
  const spans: EntitySpan[] = [];
  let mandatoryOk = true;
  try {
    if (ruleset.structuredIdEnabled !== false) spans.push(...structuredSpans(text));
    const denyList = resolveDenyList(ruleset, onDenyAccess);
    spans.push(...literalSpans(text, denyList, 'PARTY'));
  } catch {
    mandatoryOk = false;
  }

  let nerAvailable = false;
  if (ruleset.nerEnabled !== false) {
    try {
      if (ner.available()) {
        spans.push(...ner.detect(text));
        nerAvailable = true;
      }
    } catch {
      nerAvailable = false; // best-effort: an NER outage degrades recall, never fails (§17.4)
    }
  }

  return { spans: resolveOverlaps(spans, text), nerAvailable, mandatoryOk };
}
