/**
 * Adaptive endpointing grace window (BRIEF §5, run 20260717-190134, slice C3). After an
 * utterance-end signal the machine waits a grace window before auto-sending; the window adapts
 * to how finished the speech sounds. A finished-sounding sentence sends fast (minMs); a
 * mid-thought pause waits long (maxMs); unknown uses the midpoint. Pure functions, no timers -
 * the reducer computes the window and returns it as a scheduleGraceWindow effect descriptor;
 * the host runs the actual timer and dispatches sendNow when it fires (the on-screen
 * "send now" tap dispatches the same event, so the user never waits on a timer).
 *
 * eot is an end-of-turn confidence in [0, 1]: 1 = confidently finished, 0 = confidently
 * mid-thought, null/undefined/NaN = unknown. v1 sources: Deepgram utterance_end plus the
 * interim punctuation heuristic below (eotFromInterim). Upgrade seam (BRIEF §5): Deepgram
 * Flux end-of-turn probability slots straight into the same argument.
 */

export interface GraceWindowBounds {
  minMs: number;
  maxMs: number;
}

/** BRIEF §5 decided parameters: finished -> 1.5 s, mid-thought -> up to 6 s. */
export const DEFAULT_GRACE_BOUNDS: GraceWindowBounds = { minMs: 1500, maxMs: 6000 };

/**
 * Map end-of-turn confidence to a grace window in ms. Linear: eot=1 -> minMs, eot=0 -> maxMs,
 * unknown (null/undefined/NaN) -> midpoint. eot is clamped into [0, 1]; degenerate bounds are
 * repaired (negative minMs floored at 0, maxMs floored at minMs) so the result is always a
 * usable timer value.
 */
export function graceWindowMs(
  eot: number | null | undefined,
  bounds: GraceWindowBounds = DEFAULT_GRACE_BOUNDS,
): number {
  // Non-finite bounds (NaN/Infinity) fall back to the decided defaults, so a garbage config
  // can never propagate NaN into a timer value.
  const rawMin = Number.isFinite(bounds.minMs) ? bounds.minMs : DEFAULT_GRACE_BOUNDS.minMs;
  const rawMax = Number.isFinite(bounds.maxMs) ? bounds.maxMs : DEFAULT_GRACE_BOUNDS.maxMs;
  const minMs = Math.max(0, rawMin);
  const maxMs = Math.max(minMs, rawMax);
  if (eot === null || eot === undefined || Number.isNaN(eot)) {
    return Math.round((minMs + maxMs) / 2);
  }
  const confidence = Math.min(1, Math.max(0, eot));
  return Math.round(maxMs - confidence * (maxMs - minMs));
}

/** Trailing decoration that may follow the real last character (quotes, brackets). */
const TRAILING_DECOR = /["'")\]»”’»]+$/;

/**
 * Words that, when last, signal an unfinished clause (PT + EN connectives/prepositions).
 * Deliberately short: false "unknown" is safe (midpoint), a false "finished" is not.
 */
const DANGLING_WORDS = new Set([
  // PT
  'e', 'ou', 'mas', 'que', 'porque', 'portanto', 'se', 'como', 'quando',
  'para', 'com', 'sem', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas',
  'em', 'ao', 'aos', 'um', 'uma', 'o', 'a', 'os', 'as', 'depois', 'antes',
  // EN
  'and', 'or', 'but', 'because', 'so', 'that', 'if', 'when', 'then',
  'to', 'of', 'in', 'with', 'for', 'the', 'an', 'at', 'by', 'after', 'before',
]);

/**
 * v1 interim punctuation heuristic (BRIEF §5 "utterance_end + interim punctuation heuristic"):
 * derive an eot confidence from the latest interim transcript. Terminal punctuation -> 1
 * (finished-sounding); ellipsis, clause punctuation (comma/semicolon/colon) or a dangling
 * connective -> 0 (mid-thought); anything else -> null (unknown -> midpoint).
 */
export function eotFromInterim(interim: string): number | null {
  const text = interim.trim().replace(TRAILING_DECOR, '');
  if (text.length === 0) return null;
  if (/(…|\.{2,})$/.test(text)) return 0;
  if (/[.!?]$/.test(text)) return 1;
  if (/[,;:]$/.test(text)) return 0;
  const words = text.split(/\s+/);
  const last = words[words.length - 1].toLowerCase();
  if (DANGLING_WORDS.has(last)) return 0;
  return null;
}
