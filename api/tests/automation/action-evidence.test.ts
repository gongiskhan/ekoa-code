/**
 * `automation/action-evidence.ts` - the AUTOMATION half of integration action evidence (slice S1).
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
 *
 * The module shipped with no suite at all: 123 lines, no test file, no ledger row, and three
 * surviving mutants measured on the verification pass. The one that matters is `excerptOf`'s.
 *
 * Its docblock names an EXCLUSION as a safety decision - "NOTE WHAT IS NOT READ:
 * `StepRecord.error.details` (an arbitrary debug payload with no redaction contract) and `logTail`"
 * - and nothing asserted it. Making `excerptOf` return `JSON.stringify(step.error.details)` left the
 * whole lane green. That field is exactly the one no redaction leg governs: the executor's own
 * redaction covers the request summary and the response body, and the store's last gate only fires
 * when the caller supplied a live SecretRegistry (an automation-backed run supplies the credential
 * values it resolved, which is not the same set as everything a debug payload can carry). A stated
 * safety decision with no test is one the next edit undoes silently, so the exclusions are asserted
 * here BY CONSEQUENCE - a step carrying a distinctive marker ONLY in `error.details` / `logTail`
 * must produce a row that does not contain it.
 *
 * ── WHAT IS REAL ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything except the run lookup. `collectRunEvidence` takes `findRun` as an injected seam (its
 * default is `automationRunStore.findByRunId`), so these cases hand it real `RunRecord` shapes and
 * exercise the real `screenshotUrlFromPath`, the real caps and the real per-kind excerpt rules. The
 * bound production path is proved separately, at the composition root
 * (`composition-root-action-seam.test.ts`), which is where a binding can be proved at all.
 */
import { describe, it, expect } from 'vitest';
import { collectRunEvidence } from '../../src/automation/action-evidence.js';
import type { RunRecord, StepRecord } from '../../src/automation/types.js';

const AUTOMATION = 'aut-1';
const RUN = 'run-1';

/** Mirrors the module's own constants, restated here so a change to either is visible as a failure
 *  rather than absorbed by a shared import. */
const MAX_EXCERPT_CHARS = 8_000;
const MAX_STEPS = 50;

/** A real `StepRecord`: `status` is a `StepStatus` and `tier` a `StepTier`, both taken from the
 *  union the engine actually writes rather than invented for the fixture. */
function step(index: number, over: Partial<StepRecord> = {}): StepRecord {
  return {
    stepId: `s${index}`,
    index,
    status: 'completed',
    tier: 'cache',
    durationMs: 1,
    ...over,
  };
}

function run(steps: StepRecord[], over: Partial<RunRecord> = {}): RunRecord {
  return {
    id: RUN,
    automationId: AUTOMATION,
    startedAt: '2026-08-20T00:00:00.000Z',
    status: 'completed',
    inputs: {},
    triggeredBy: 'user',
    steps,
    ...over,
  } as RunRecord;
}

const collect = (record: RunRecord | null, runId = RUN) =>
  collectRunEvidence(runId, { findRun: async () => record });

describe('collectRunEvidence answers null for everything it cannot resolve', () => {
  it('an EMPTY run id, without asking the store', async () => {
    let asked = false;
    const out = await collectRunEvidence('', { findRun: async () => { asked = true; return run([]); } });
    expect(out).toBeNull();
    // The guard is before the lookup, so an empty id cannot become a query.
    expect(asked).toBe(false);
  });

  it('a REPLAY - the ordinary case, since `replay-…` has no automationRuns document behind it', async () => {
    expect(await collect(null, 'replay-abc')).toBeNull();
  });

  it('a run that was already swept', async () => {
    expect(await collect(null)).toBeNull();
  });

  it('a run whose `steps` is not an array (a malformed or partially-written record)', async () => {
    expect(await collect(run(undefined as unknown as StepRecord[]))).toBeNull();
  });

  it('a run with ZERO steps still answers evidence - "it ran and did nothing" is a fact', async () => {
    // Distinct from the cases above on purpose: an empty trace is a resolvable run, and answering
    // null for it would leave the previous sample standing after a genuinely different outcome.
    expect(await collect(run([]))).toEqual({ status: 'completed', steps: [] });
  });
});

describe('a step becomes a POINTER, never a copy', () => {
  it('carries the screenshot as a plane URL and the step index, and no bytes', async () => {
    const out = await collect(run([
      step(0, { screenshotPath: `automation-runs/${AUTOMATION}/${RUN}/step-0.png` }),
    ]));
    expect(out!.steps).toEqual([
      { stepIndex: 0, status: 'completed', screenshotUrl: `/automation-screenshots/${AUTOMATION}/${RUN}/step-0.png` },
    ]);
  });

  it('omits the URL entirely for a step that took no screenshot', async () => {
    const out = await collect(run([step(0)]));
    expect(out!.steps[0]).not.toHaveProperty('screenshotUrl');
  });

  it('carries the step STATUS under `status`, which is what it is', async () => {
    // The first cut wrote this value into a field called `title`. `StepRecord` has no title, so
    // every step of every automation-backed sample would have rendered as its status ("completed")
    // on the detail page - a label that says nothing, on a field name that promises something else.
    const out = await collect(run([step(0, { status: 'failed' }), step(1, { status: 'skipped' })]));
    expect(out!.steps.map((s) => s.status)).toEqual(['failed', 'skipped']);
    expect(out!.steps[0]).not.toHaveProperty('title');
  });

  it('carries the resolved action KIND as `stepType`, and omits it when unresolved', async () => {
    const out = await collect(run([
      step(0, { resolvedAction: { kind: 'local_command' } as StepRecord['resolvedAction'] }),
      step(1),
    ]));
    expect(out!.steps[0]!.stepType).toBe('local_command');
    expect(out!.steps[1]).not.toHaveProperty('stepType');
  });

  it('carries the RUN status through', async () => {
    expect((await collect(run([], { status: 'failed' })))!.status).toBe('failed');
  });
});

describe('the excerpt is read per output kind', () => {
  it('local_command joins stdout and stderr - the whole point of a bash-cli action\'s evidence', async () => {
    const out = await collect(run([step(0, {
      output: { kind: 'local_command', stdout: 'listed 3 cases', stderr: 'warning: slow', exitCode: 0, durationMs: 1, truncated: false, timedOut: false },
    })]));
    expect(out!.steps[0]!.excerpt).toBe('listed 3 cases\nwarning: slow');
  });

  it('local_command with only one stream carries only that stream, with no stray separator', async () => {
    const out = await collect(run([step(0, {
      output: { kind: 'local_command', stdout: 'only stdout', stderr: '', exitCode: 0, durationMs: 1, truncated: false, timedOut: false },
    })]));
    expect(out!.steps[0]!.excerpt).toBe('only stdout');
  });

  it('local_command with NOTHING on either stream carries no excerpt at all', async () => {
    const out = await collect(run([step(0, {
      output: { kind: 'local_command', stdout: '', stderr: '', exitCode: 0, durationMs: 1, truncated: false, timedOut: false },
    })]));
    // An empty string would render as an empty panel that looks like a bug; absence is the answer.
    expect(out!.steps[0]).not.toHaveProperty('excerpt');
  });

  it('api_call carries the response body; ekoa_action carries the rendered result', async () => {
    const out = await collect(run([
      step(0, { output: { kind: 'api_call', status: 200, responseHeaders: {}, responseBody: '{"items":[1]}', responseBodyIsJson: true, truncated: false, durationMs: 1 } }),
      step(1, { output: { kind: 'ekoa_action', trace: [], result: 'criou o processo 9', capturedValues: {}, durationMs: 1 } }),
    ]));
    expect(out!.steps[0]!.excerpt).toBe('{"items":[1]}');
    expect(out!.steps[1]!.excerpt).toBe('criou o processo 9');
  });

  it('an EMPTY api_call body / ekoa_action result carries no excerpt', async () => {
    const out = await collect(run([
      step(0, { output: { kind: 'api_call', status: 204, responseHeaders: {}, responseBody: '', responseBodyIsJson: false, truncated: false, durationMs: 1 } }),
      step(1, { output: { kind: 'ekoa_action', trace: [], result: '', capturedValues: {}, durationMs: 1 } }),
    ]));
    expect(out!.steps[0]).not.toHaveProperty('excerpt');
    expect(out!.steps[1]).not.toHaveProperty('excerpt');
  });

  it('a step with NO output at all is still a pointer - it ran, and it has its screenshot', async () => {
    const out = await collect(run([step(3, { screenshotPath: `automation-runs/${AUTOMATION}/${RUN}/step-3.png` })]));
    expect(out!.steps[0]).toMatchObject({ stepIndex: 3, screenshotUrl: `/automation-screenshots/${AUTOMATION}/${RUN}/step-3.png` });
    expect(out!.steps[0]).not.toHaveProperty('excerpt');
  });
});

/**
 * THE EXCLUSIONS - the module's stated safety decision, asserted rather than believed.
 *
 * `error.details` is "an arbitrary debug payload with no redaction contract" and `logTail` is a
 * bounded tail of whatever the step streamed. Neither is governed by the executor's redaction (which
 * covers the request summary and the response body) and neither is reliably caught by the store's
 * last gate (which only fires against the values the run RESOLVED - a debug payload can carry things
 * that were never a resolved credential value).
 *
 * Each case plants a distinctive marker in ONE excluded field and asserts by CONSEQUENCE: the marker
 * must not appear anywhere in the collected evidence. A mutant that reads either field reddens here.
 */
describe('what is NOT read', () => {
  const MARKER = 'DEBUG-PAYLOAD-MARKER-40e7';

  it('never reads `error.details`, even on a step that carries nothing else', async () => {
    const out = await collect(run([step(0, {
      status: 'failed',
      error: { message: 'the portal refused', recoverable: false, details: { requestBody: MARKER, cookies: [MARKER] } },
    })]));
    expect(JSON.stringify(out)).not.toContain(MARKER);
    expect(out!.steps[0]).not.toHaveProperty('excerpt');
  });

  it('never reads `error.details` on a step that DOES have a readable output either', async () => {
    // The control for the case above: the excerpt that IS read still arrives, so "the marker is
    // absent" cannot be satisfied by a collector that simply stopped reading anything.
    const out = await collect(run([step(0, {
      status: 'failed',
      output: { kind: 'local_command', stdout: 'partial output', stderr: '', exitCode: 1, durationMs: 1, truncated: false, timedOut: false },
      error: { message: 'boom', recoverable: false, details: { raw: MARKER } },
    })]));
    expect(out!.steps[0]!.excerpt).toBe('partial output');
    expect(JSON.stringify(out)).not.toContain(MARKER);
  });

  it('never reads `logTail`', async () => {
    const out = await collect(run([step(0, {
      logTail: { text: MARKER, truncated: false } as StepRecord['logTail'],
    })]));
    expect(JSON.stringify(out)).not.toContain(MARKER);
  });

  it('never reads `visionReasoning` - model prose about the page is not the action\'s evidence', async () => {
    const out = await collect(run([step(0, { visionReasoning: MARKER })]));
    expect(JSON.stringify(out)).not.toContain(MARKER);
  });
});

describe('the bounds are the module\'s own, applied before the seam is crossed', () => {
  it('cuts the trace at MAX_STEPS, keeping the FIRST steps', async () => {
    const steps = Array.from({ length: MAX_STEPS + 17 }, (_, i) => step(i));
    const out = await collect(run(steps));
    expect(out!.steps).toHaveLength(MAX_STEPS);
    // First, not last: a trace is read top-down, and the opening steps are what show how the action
    // starts. Asserted by index so a `slice(-MAX_STEPS)` mutant dies.
    expect(out!.steps[0]!.stepIndex).toBe(0);
    expect(out!.steps[MAX_STEPS - 1]!.stepIndex).toBe(MAX_STEPS - 1);
  });

  /**
   * …AND THE CUT IS RECORDED, which for six rounds it was not.
   *
   * After the slice, `steps.length` is exactly `MAX_STEPS` whether the run had 51 steps or 200, so
   * NOTHING downstream can re-derive that a cut happened: the store's own
   * `evidence.steps.length > MAX_EVIDENCE_STEPS` test compares equal numbers on every row this
   * writer produces. This function is the last place that can still see `run.steps.length`, so the
   * flag is set here or it does not exist at all.
   *
   * The consequence is not cosmetic. The row is durable for 90 days and is what a human reads before
   * granting `trusted`, which makes the action auto-runnable by `achieve`; a 50-step prefix of a
   * 200-step run was byte-indistinguishable from a complete 50-step run.
   */
  it('RECORDS that the trace was cut, which no later stage can re-derive', async () => {
    const out = await collect(run(Array.from({ length: 200 }, (_, i) => step(i))));
    expect(out!.steps).toHaveLength(MAX_STEPS);
    expect(out!.truncated).toBe(true);
  });

  it('one step over the cap is ALREADY a cut - the flag is not reserved for big runs', async () => {
    const out = await collect(run(Array.from({ length: MAX_STEPS + 1 }, (_, i) => step(i))));
    expect(out!.steps).toHaveLength(MAX_STEPS);
    expect(out!.truncated).toBe(true);
  });

  it('a run at exactly MAX_STEPS is not cut, and carries no cut flag', async () => {
    const out = await collect(run(Array.from({ length: MAX_STEPS }, (_, i) => step(i))));
    expect(out!.steps).toHaveLength(MAX_STEPS);
    // THE BOUNDARY, PINNED BOTH WAYS. With the case above, a `>=` mutant dies here (an honest whole
    // trace reported as a prefix) and a `false`/dropped mutant dies there (a prefix reported as
    // whole). Only the second is a lie about the data, but a flag true of every automation row tells
    // a reader nothing at all, so both directions are held.
    expect(out!).not.toHaveProperty('truncated');
  });

  it('cuts an over-long excerpt and RECORDS that it did', async () => {
    // The reason the cap is applied here as well as in the store: a 5MB `local_command` stdout must
    // not be carried across the seam in memory just to be trimmed on the other side.
    const out = await collect(run([step(0, {
      output: { kind: 'local_command', stdout: 'z'.repeat(MAX_EXCERPT_CHARS + 4_000), stderr: '', exitCode: 0, durationMs: 1, truncated: false, timedOut: false },
    })]));
    expect(out!.steps[0]!.excerpt).toHaveLength(MAX_EXCERPT_CHARS);
    expect(out!.steps[0]!.truncated).toBe(true);
  });

  it('an excerpt that FITS carries no truncation flag (the flag means something)', async () => {
    const out = await collect(run([step(0, {
      output: { kind: 'local_command', stdout: 'short', stderr: '', exitCode: 0, durationMs: 1, truncated: false, timedOut: false },
    })]));
    expect(out!.steps[0]!.excerpt).toBe('short');
    expect(out!.steps[0]).not.toHaveProperty('truncated');
  });
});
