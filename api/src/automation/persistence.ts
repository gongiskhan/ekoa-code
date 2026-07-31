/**
 * automation/ persistence adapter (ch05 §5.6.7; re-pointing rules of the G8 brief). The ported
 * engine/catalog were written against the old Cortex file-backed `automationStore` /
 * `automationRunStore`; this module re-points those exact method shapes onto the already-registered
 * `data/` stores (`automations`, `automation_runs`) so the engine port stays faithful and the
 * whole persistence surface is one mockable module in tests.
 *
 * Run ids are GLOBALLY UNIQUE (ch03 retires the old composite `(automationId, runId)` key): the
 * run store keys on `runId` alone. Run records persist at EVERY status transition (§5.6.7) — the
 * engine already calls `update` at each one. Per-step PNG screenshots (§13.4) are best-effort;
 * a write failure never fails a run (the engine's `snap` swallows it).
 */
import { RUN_LOG_STEP_MAX_CHARS, RUN_LOG_TOTAL_MAX_CHARS } from '@ekoa/shared';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { automations, automationRuns } from '../data/stores.js';
import { loadAutomationConfig } from './config.js';
import type { Automation, RunRecord, StepLogTail, StepRecord } from './types.js';

// --- Automations -------------------------------------------------------------

export const automationStore = {
  async findById(id: string): Promise<Automation | null> {
    const doc = await automations.get(id);
    return doc ? (doc as unknown as Automation) : null;
  },
  async update(id: string, patch: Partial<Automation>): Promise<void> {
    await automations.update(id, (cur) => ({ ...cur, ...patch }));
  },
  /** Persist a full automation (used by the plan endpoint's save side, and tests). */
  async put(automation: Automation): Promise<void> {
    await automations.put({ _id: automation.id, ...automation } as never);
  },
};

// --- Automation runs (keyed by globally-unique run id) -----------------------

export const automationRunStore = {
  async create(record: RunRecord): Promise<void> {
    await automationRuns.insert({ _id: record.id, ...record } as never);
  },
  /** Patch a run by id. `automationId` is accepted for call-site fidelity but the key is `runId`
   *  alone (ch03 globally-unique run ids). */
  async update(_automationId: string, runId: string, patch: Partial<RunRecord>): Promise<void> {
    await automationRuns.update(runId, (cur) => ({ ...cur, ...patch }));
  },
  async findById(_automationId: string, runId: string): Promise<RunRecord | null> {
    const doc = await automationRuns.get(runId);
    return doc ? (doc as unknown as RunRecord) : null;
  },
  async listForAutomation(automationId: string, limit?: number): Promise<RunRecord[]> {
    const rows = (await automationRuns.find({ automationId }, { startedAt: -1 })) as unknown as RunRecord[];
    return typeof limit === 'number' ? rows.slice(0, limit) : rows;
  },
};

// --- Per-step screenshots (§13.4) --------------------------------------------

/**
 * Persist a per-step PNG under the automation data dir and return its path relative to that dir
 * (served via /automation-screenshots, ch12). Best-effort: returns undefined and never throws on
 * a filesystem error — the caller (`snap`) already treats undefined as "no screenshot".
 */
export function writeStepScreenshot(
  automationId: string,
  runId: string,
  index: number,
  png: Buffer,
): string | undefined {
  try {
    const rel = join('automation-runs', automationId, runId, `step-${index}.png`);
    const abs = join(loadAutomationConfig().dataDir, rel);
    mkdirSync(join(loadAutomationConfig().dataDir, 'automation-runs', automationId, runId), { recursive: true });
    writeFileSync(abs, png);
    return rel;
  } catch {
    return undefined;
  }
}

/**
 * Absolute root the `/automation-screenshots` static plane serves from — `<dataDir>/automation-runs`.
 * `writeStepScreenshot` returns paths RELATIVE to `dataDir` prefixed with `automation-runs/`, so the
 * static mount roots at this directory and the URL drops the prefix (see `screenshotUrlFromPath`).
 * The single source of truth for the serving layout, so the composition root's mount and the URL
 * builder never drift.
 */
export function automationRunsRoot(): string {
  return join(loadAutomationConfig().dataDir, 'automation-runs');
}

/**
 * Map a stored step screenshot path (relative to the data dir, e.g.
 * `automation-runs/<automationId>/<runId>/step-3.png`) to the public capability URL the UI renders
 * (`/automation-screenshots/<automationId>/<runId>/step-3.png`). The unguessable automationId/runId
 * path IS the capability (ch12) — mirrors the old cortex mapping. Returns undefined for a missing
 * path so callers can spread it conditionally.
 */
export function screenshotUrlFromPath(relPath: string | undefined): string | undefined {
  if (!relPath) return undefined;
  return `/automation-screenshots/${relPath.replace(/^automation-runs\//, '')}`;
}

// --- Run logs (slice E4) ------------------------------------------------------
//
// Step stdout/stderr used to exist ONLY as ephemeral SSE `step_output_chunk` frames: a client that
// connected late — or a gateway-key caller with no stream at all — could never see it again. The
// engine now accumulates a BOUNDED tail per step through the accumulator below and persists it on
// the step record; `runLogsFromSteps` is the read side behind GET /automations/runs/:id/logs.
//
// BOUNDED EVERYWHERE, TWICE. Writing is capped (a runaway command cannot grow the run document),
// and reading is capped AGAIN over whatever is on disk — because the other log source, the
// already-persisted `StepRecord.output`, is NOT written by this module and carries up to 5 MB of
// stdout per local_command step. Serving it verbatim would be an unbounded response built from
// attacker-influenced data.
//
// The caps are measured in CHARACTERS (JS string length): the contract publishes the same two
// numbers, and step output on this path is overwhelmingly ASCII, so characters ≈ bytes.

/** Per-step cap, both on write (the accumulator) and on read (the endpoint). */
export const STEP_LOG_MAX_CHARS = RUN_LOG_STEP_MAX_CHARS;
/** Whole-run cap: the sum of every step's RETAINED log, on write and on read. */
export const RUN_LOG_MAX_CHARS = RUN_LOG_TOTAL_MAX_CHARS;

/** Keep the LAST `max` characters. A cut that lands inside a surrogate pair drops the orphaned
 *  low half rather than persisting a lone surrogate. */
function keepTail(text: string, max: number): string {
  if (max <= 0) return '';
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const first = cut.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? cut.slice(1) : cut;
}

export interface StepLogAccumulator {
  /** Append a streamed chunk for one step. Never throws; silently drops beyond the caps. */
  append(stepIndex: number, chunk: string): void;
  /** The tail to persist on that step's record, or undefined when it streamed nothing. */
  tailFor(stepIndex: number): StepLogTail | undefined;
}

/**
 * A per-RUN accumulator of streamed step output.
 *
 * Per step it is a ROLLING tail: the newest `STEP_LOG_MAX_CHARS` characters survive, so a
 * ten-minute command's ending — the part that says what happened — is what is kept, and older
 * output is evicted rather than the tail being frozen at the first 16 KB.
 *
 * Across the run it is a budget on RETAINED characters (the sum of the live buffers), so a run
 * with many chatty steps cannot exceed `RUN_LOG_MAX_CHARS` no matter how the output is spread.
 * When a step's share of that budget is exhausted its buffer stops growing and it is flagged
 * `truncated`; rolling within an existing buffer never needs new budget.
 */
export function createStepLogAccumulator(): StepLogAccumulator {
  const buffers = new Map<number, { text: string; truncated: boolean }>();
  let retained = 0;
  return {
    append(stepIndex: number, chunk: string): void {
      if (typeof chunk !== 'string' || chunk.length === 0) return;
      const cur = buffers.get(stepIndex) ?? { text: '', truncated: false };
      let truncated = cur.truncated;
      // Cap the INCOMING chunk first so a single pathological write never materialises a huge
      // intermediate string just to slice it back down.
      let incoming = chunk;
      if (incoming.length > STEP_LOG_MAX_CHARS) {
        incoming = keepTail(incoming, STEP_LOG_MAX_CHARS);
        truncated = true;
      }
      let text = cur.text + incoming;
      if (text.length > STEP_LOG_MAX_CHARS) {
        text = keepTail(text, STEP_LOG_MAX_CHARS);
        truncated = true;
      }
      const others = retained - cur.text.length;
      const allowed = Math.max(0, RUN_LOG_MAX_CHARS - others);
      if (text.length > allowed) {
        text = keepTail(text, allowed);
        truncated = true;
      }
      retained = others + text.length;
      buffers.set(stepIndex, { text, truncated });
    },
    tailFor(stepIndex: number): StepLogTail | undefined {
      const buf = buffers.get(stepIndex);
      if (!buf || (buf.text.length === 0 && !buf.truncated)) return undefined;
      return { text: buf.text, truncated: buf.truncated };
    },
  };
}

/** One step's entry in the logs response (shape-compatible with shared `RunLogStep`). */
export interface RunLogStepEntry {
  stepIndex: number;
  log: string;
  truncated: boolean;
}

/**
 * Reconcile the two views a streamed step leaves behind. They are NOT copies of each other:
 *
 *  - `tail` is what the daemon's progress channel emitted — "a single undiscriminated chunk"
 *    surfaced as stdout (executors/local-command.ts), bounded to 16 KB by the accumulator;
 *  - `stdout` is the AUTHORITATIVE capture from the final observation, up to 5 MB.
 *
 * Preferring the tail whenever it was non-empty silently threw the authoritative capture away and
 * still reported `truncated: false` — a 200 KB stdout answered as a one-line log claiming nothing
 * was dropped (E4 review finding 1). So: keep the LONGER of the two, and if the other one carried
 * text the kept side does not already contain, say so with `truncated`. The containment check is
 * what keeps the flag honest in BOTH directions — the ordinary case where the daemon streamed
 * exactly what stdout ends up holding must not cry wolf either.
 *
 * `dropped` is bounded by the step cap in both branches (a dropped tail is ≤ 16 KB by
 * construction; a dropped stdout is shorter than the tail), so the containment scan is cheap.
 */
function reconcileStdout(tail: string, stdout: string): { text: string; lost: boolean } {
  if (!tail) return { text: stdout, lost: false };
  if (!stdout) return { text: tail, lost: false };
  const keepStdout = stdout.length >= tail.length;
  const text = keepStdout ? stdout : tail;
  const dropped = keepStdout ? tail : stdout;
  return { text, lost: !text.includes(dropped) };
}

/**
 * What a single step contributes to the logs, from the two sources a step record can carry:
 *
 *  - `logTail` — the bounded tail of what the step STREAMED (the daemon's progress channel, which
 *    is stdout-only), written by the engine.
 *  - `output` — the step's captured StepOutput, written by the step executors: a local_command's
 *    authoritative stdout/stderr split, an api_call's response body, an ekoa_action's trace.
 *
 * For a local_command the two stdout views are reconciled (above) and the final `stderr` — which
 * the progress channel never carries — is appended. Other kinds do not stream today, so their tail
 * (if a future step type grows one) simply precedes the captured output.
 */
function stepLogSource(step: StepRecord): { text: string; truncated: boolean } | undefined {
  const parts: string[] = [];
  let truncated = false;
  const tail = step.logTail;
  const tailText = tail && typeof tail.text === 'string' ? tail.text : '';
  if (tail) truncated = truncated || tail.truncated === true;
  const out = step.output;
  if (out?.kind === 'local_command') {
    const merged = reconcileStdout(tailText, typeof out.stdout === 'string' ? out.stdout : '');
    if (merged.text) parts.push(merged.text);
    if (merged.lost) truncated = true;
    if (out.stderr) parts.push(out.stderr);
    truncated = truncated || out.truncated === true;
  } else {
    if (tailText.length > 0) parts.push(tailText);
    if (out?.kind === 'api_call') {
      if (out.responseBody) parts.push(out.responseBody);
      truncated = truncated || out.truncated === true;
    } else if (out?.kind === 'ekoa_action') {
      for (const entry of out.trace ?? []) {
        parts.push(`${entry.op}: ${entry.summary}${entry.error ? ` — ${entry.error}` : ''}`);
      }
      if (out.result) parts.push(out.result);
    }
  }
  if (parts.length === 0) return truncated ? { text: '', truncated: true } : undefined;
  return { text: parts.join('\n'), truncated };
}

/**
 * Project a run's persisted step records onto the logs wire shape, re-applying BOTH caps. Steps
 * with nothing to show are omitted; a step whose output exists but no longer fits the run budget
 * is kept with an empty `log` and `truncated: true` — silence and "we dropped it" must not look
 * the same to a caller.
 */
export function runLogsFromSteps(steps: readonly StepRecord[]): RunLogStepEntry[] {
  const ordered = [...(steps ?? [])].sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));
  const out: RunLogStepEntry[] = [];
  let budget = RUN_LOG_MAX_CHARS;
  for (const step of ordered) {
    if (!step || typeof step.index !== 'number') continue;
    const source = stepLogSource(step);
    if (!source) continue;
    let text = source.text;
    let truncated = source.truncated;
    if (text.length > STEP_LOG_MAX_CHARS) {
      text = keepTail(text, STEP_LOG_MAX_CHARS);
      truncated = true;
    }
    if (text.length > budget) {
      text = keepTail(text, budget);
      truncated = true;
    }
    budget -= text.length;
    if (text.length === 0 && !truncated) continue;
    out.push({ stepIndex: step.index, log: text, truncated });
  }
  return out;
}
