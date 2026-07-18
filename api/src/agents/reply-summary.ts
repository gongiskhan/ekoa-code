/**
 * Post-run reply summary (Part B decision B.E, run 20260717-190134). After a chat run completes
 * and its assistant turn is persisted, ONE FAST-tier one-shot produces {title, summary} for the
 * sheet that turn produced, delivered as a `reply_summary` event on the per-user NOTIFICATIONS
 * channel (the chat_answer pattern - the client tears the run stream down the moment `complete`
 * arrives, so a post-run event on the run stream would land in a replay ring nobody reads).
 *
 * Turn shapes: a FRESH turn summarises the reply text; a REVISION turn (the message revised an
 * existing sheet) summarises the user's edit instruction plus a compact diff basis - never the
 * whole reply - so the summary describes the CHANGE. The revision shape has no live chat
 * producer until the continue-chip routing lands (B5); it is exercised by unit tests and ready.
 *
 * Best-effort by construction (the memory-extraction template, §5.8): any failure - model error,
 * timeout, unparseable output - emits NOTHING (the client keeps its first-line placeholder) and
 * surfaces only as a debug log. The run itself never observes the hook: callers fire it AFTER
 * the terminal event and void the promise. Never touches the main agent prompt.
 *
 * Attribution mirrors post-run memory extraction exactly (ch06 §6.4.1 pattern): `user_work`
 * `reply-summary`, billed to the run's user, FAST tier, sessionId/runId stamped.
 */
import { runOneShot, decideForTier } from '../llm/index.js';
import { emitReplySummary } from './streaming.js';

export type ReplySummaryTurn =
  | { kind: 'fresh'; replyText: string }
  | { kind: 'revision'; instruction: string; baseContent: string; revisedContent: string };

export interface ReplySummaryInput {
  /** The run's user: pays for the call AND owns the notifications channel the event rides. */
  userId: string;
  sessionId: string;
  runId: string;
  /** The sheet/revision the assistant turn produced - threaded from the persistence path,
   *  never re-derived from content. */
  sheetId: string;
  revisionId: string;
  turn: ReplySummaryTurn;
}

/** A stuck summarisation must not hold the fire-and-forget promise open for the whole run
 *  timeout; a FAST one-shot that has not answered in this window will not. */
const REPLY_SUMMARY_TIMEOUT_MS = 15_000;

const DIFF_MAX_LINES_PER_SIDE = 20;
const DIFF_MAX_LINE_CHARS = 160;

const FRESH_SYSTEM =
  'Summarise this assistant reply for a small transcript card. Return ONLY a JSON object ' +
  '{"title","summary"}: "title" names what the reply delivers in at most 8 words; "summary" is ' +
  'one sentence (at most 25 words) saying what it covers. Use the language of the reply. ' +
  'No markdown, no extra keys.';

const REVISION_SYSTEM =
  'A document revision was produced from an edit instruction. Describe the CHANGE, never the ' +
  'whole document. Return ONLY a JSON object {"title","summary"}: "title" labels the change in ' +
  'at most 8 words; "summary" is one sentence (at most 25 words) describing what changed. ' +
  'Use the language of the input. No markdown, no extra keys.';

/**
 * Compact, deterministic diff basis for a revision turn: strip the lines common to both ends,
 * emit what the base lost ("- ") and what the revision gained ("+ "), capped per side. This is
 * model INPUT, not a rendered diff - it only has to carry what changed, compactly.
 */
export function compactDiffBasis(base: string, revised: string): string {
  const a = base.split('\n');
  const b = revised.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const clip = (line: string): string => (line.length > DIFF_MAX_LINE_CHARS ? `${line.slice(0, DIFF_MAX_LINE_CHARS)}...` : line);
  const side = (lines: string[], prefix: string): string[] => {
    const kept = lines.slice(0, DIFF_MAX_LINES_PER_SIDE).map((l) => `${prefix} ${clip(l)}`);
    if (lines.length > DIFF_MAX_LINES_PER_SIDE) kept.push(`${prefix} (${lines.length - DIFF_MAX_LINES_PER_SIDE} more lines)`);
    return kept;
  };
  const removed = a.slice(start, endA).filter((l) => l.trim().length > 0);
  const added = b.slice(start, endB).filter((l) => l.trim().length > 0);
  return [...side(removed, '-'), ...side(added, '+')].join('\n');
}

function buildCall(turn: ReplySummaryTurn): { prompt: string; system: string } {
  // Defensive cap: a summary needs the head of the reply, not an unbounded transcript.
  if (turn.kind === 'fresh') return { prompt: turn.replyText.slice(0, 24000), system: FRESH_SYSTEM };
  const diff = compactDiffBasis(turn.baseContent, turn.revisedContent);
  return {
    prompt: `Edit instruction: ${turn.instruction}\n\nChanged lines:\n${diff}`,
    system: REVISION_SYSTEM,
  };
}

/** Lenient {title, summary} parse: the first {...} span as JSON, both fields non-empty after
 *  trim. Anything else is a degradation (no event), never a throw. */
function parseSummary(text: string): { title: string; summary: string } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { title?: unknown; summary?: unknown };
    const title = String(parsed.title ?? '').trim();
    const summary = String(parsed.summary ?? '').trim();
    if (!title || !summary) return null;
    return { title, summary };
  } catch {
    return null;
  }
}

/**
 * Run the summarisation and, on success, emit the `reply_summary` notification. Returns what
 * happened for tests; production callers `void` it after the terminal event. Fully isolated:
 * every failure path resolves `{ emitted: false }` - this function never rejects.
 */
export async function runReplySummary(input: ReplySummaryInput): Promise<{ emitted: boolean }> {
  try {
    const { prompt, system } = buildCall(input.turn);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REPLY_SUMMARY_TIMEOUT_MS);
    let text: string;
    try {
      const res = await runOneShot(
        { prompt, decision: decideForTier('FAST'), systemPrompt: system, signal: abort.signal },
        {
          kind: 'user_work',
          agentType: 'reply-summary',
          billeeUserId: input.userId,
          sessionId: input.sessionId,
          runId: input.runId,
        },
      );
      text = res.text;
    } finally {
      clearTimeout(timer);
    }
    const parsed = parseSummary(text);
    if (!parsed) {
      console.debug('[reply-summary] unparseable model output, no event (placeholder stands)', {
        runId: input.runId,
        sheetId: input.sheetId,
      });
      return { emitted: false };
    }
    emitReplySummary(input.userId, {
      sessionId: input.sessionId,
      sheetId: input.sheetId,
      revisionId: input.revisionId,
      title: parsed.title,
      summary: parsed.summary,
    });
    return { emitted: true };
  } catch (err) {
    // Model failure, timeout abort, or emit failure: best-effort, never surfaces (B.E).
    console.debug('[reply-summary] summarisation failed, no event (placeholder stands)', {
      runId: input.runId,
      sheetId: input.sheetId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { emitted: false };
  }
}

/** Fire the hook; awaited only in tests via the returned promise (the scheduleExtraction
 *  pattern). The extra catch is belt-and-braces - runReplySummary already never rejects. */
export function scheduleReplySummary(input: ReplySummaryInput): Promise<{ emitted: boolean }> {
  return runReplySummary(input).catch(() => ({ emitted: false }));
}
