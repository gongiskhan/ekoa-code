/**
 * engine/task-program.ts — the STRUCTURED task an executor-only daemon runs (ADR-001, docs/decisions
 * "TaskProgram"). `DelegatedTask.task` is a free string on the wire; a daemon with no local brain
 * cannot interpret natural language, so Cortex encodes the work as a JSON `TaskProgram`: an ordered
 * list of fixed-vocabulary tool steps, plus an OPTIONAL single provider-compose step (the one bounded
 * round trip to Cortex-as-provider that turns read excerpts into a derived answer — NOT a loop).
 *
 * A `task` string that does not parse to this shape is refused by the engine as a denial (principle
 * S3: not the fixed file-tool vocabulary), never guessed at.
 */
import { z } from 'zod';

/** A byte range for a read step. */
const RangeSchema = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });

/**
 * One step = one Tier-1 tool invocation. Discriminated on `tool`. `cite` (read/stat) marks a step's
 * location for the result's citations. `as` names a read's excerpt so the compose step can reference
 * it; excerpts NEVER leave in the result (derived-output-only) — only in the provider request.
 */
export const ToolStep = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('read'), grantRef: z.string(), relPath: z.string(), range: RangeSchema.optional(), as: z.string().optional(), cite: z.boolean().optional() }),
  z.object({ tool: z.literal('list'), grantRef: z.string(), relPath: z.string().optional() }),
  z.object({ tool: z.literal('glob'), grantRef: z.string(), pattern: z.string() }),
  z.object({ tool: z.literal('grep'), grantRef: z.string(), pattern: z.string(), maxMatches: z.number().int().positive().optional(), maxLineLength: z.number().int().positive().optional() }),
  z.object({ tool: z.literal('stat'), grantRef: z.string(), relPath: z.string(), cite: z.boolean().optional() }),
  z.object({ tool: z.literal('extract_text'), grantRef: z.string(), relPath: z.string(), as: z.string().optional(), cite: z.boolean().optional() }),
  z.object({
    tool: z.literal('write'),
    grantRef: z.string(),
    relPath: z.string(),
    content: z.string().optional(),
    patch: z.object({ find: z.string(), replace: z.string(), occurrence: z.number().int().positive().optional() }).optional(),
    expectedSha256: z.string().nullable(),
    confirmed: z.boolean().optional(),
  }),
]);
export type ToolStep = z.infer<typeof ToolStep>;

/**
 * The compose step: a SINGLE provider round trip. `instructions` is the natural-language ask; the
 * engine builds an Anthropic-messages body carrying the read excerpts collected by `as`-named steps
 * (cleartext across Boundary 1) and returns the de-tokenized completion as the answer. Exactly one
 * compose per program — this is a bounded executor step, not an agent loop (ADR-001/ADR-003).
 */
export const ComposeStep = z.object({
  provider: z.literal(true),
  instructions: z.string().optional(),
  /** Which `as`-named read excerpts to include in the provider request (default: all collected). */
  include: z.array(z.string()).optional(),
});
export type ComposeStep = z.infer<typeof ComposeStep>;

export const TaskProgram = z.object({
  v: z.literal(1),
  steps: z.array(ToolStep),
  compose: ComposeStep.optional(),
  /** A pre-derived answer when no provider compose is used (e.g. a pure grep/list result summary that
   *  Cortex composed at mint time). Mutually optional with `compose`; if both are absent the answer
   *  is empty and the result carries citations + telemetry only. */
  answer: z.string().optional(),
  /** Which read/stat steps' locations become citations, in addition to per-step `cite`. */
  citeAll: z.boolean().optional(),
});
export type TaskProgram = z.infer<typeof TaskProgram>;

/** Parse a raw `task` string into a TaskProgram, or return null when it is not a valid program. */
export function parseTaskProgram(raw: string): TaskProgram | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = TaskProgram.safeParse(json);
  return parsed.success ? parsed.data : null;
}
