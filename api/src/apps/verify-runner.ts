/**
 * Per-build verification runner (ch07 §7.2.6, ch05 §5.6.2 step 5). Drives the just-served app
 * through playwright-cli in ONE chokepoint agent run and parses a final PASS/FAIL line into a
 * verdict. Wired at the composition root via `setVerifyRunner`; imported ONLY by server.ts.
 *
 * apps/ reaches the model SOLELY through the llm/ public entry — `runAgent` is the sanctioned
 * path (never the provider SDK directly; the FIXED-3/13 chokepoint owns that import). The run is
 * attributed `user_work` / `build-verify`, billed to the build's user (ch06 §6.4.1 row A2), so the
 * zero-platform-calls posture is untouched.
 *
 * Two honesty invariants:
 *  - Credential-skip: when no usable model credential is configured (`claudeAuthStatus().ok`
 *    false) the runner reports `{ ran: false, passed: true, note }` — an honest not-run, never a
 *    fake claim of having verified.
 *  - Never throw into the build pipeline (§5.6.2 step 5): every failure is wrapped into a
 *    VerifyRunResult with an honest `ran` flag.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent, decideForTask, claudeAuthStatus } from '../llm/index.js';

/** first build → full acceptance pass; follow-up → scoped tests + smoke pass. */
export interface VerifyRunInput {
  artifactId: string;
  projectDir: string;
  appUrl: string;
  userId: string;
  depth: 'full' | 'scoped';
}

export interface VerifyRunResult {
  ran: boolean;
  passed: boolean;
  note?: string;
}

/** Modest turn ceiling — medium-depth exercise, not an open-ended session (ch07 §7.2.6). */
const MAX_TURNS = 15;

export async function verifyRunner(input: VerifyRunInput): Promise<VerifyRunResult> {
  // Credential-skip (ch05 §5.6.2 step 5): `ok` is false when unconfigured OR a refresh alert is
  // latched — either way a real verification run cannot proceed, so report an honest not-run.
  if (!claudeAuthStatus().ok) {
    return { ran: false, passed: true, note: 'verification skipped: model credential unavailable' };
  }

  try {
    // A throwaway working dir for the verifier's own scratch (screenshots, temp scripts). The
    // app under test is driven over HTTP at appUrl — this cwd is not the app's project tree.
    const scratch = await mkdtemp(join(tmpdir(), 'ekoa-verify-'));
    const decision = decideForTask('test the built application end to end', undefined, 'WORKHORSE');

    const handle = runAgent(
      {
        prompt: buildPrompt(input),
        decision,
        allowedTools: ['Bash'],
        maxTurns: MAX_TURNS,
        cwd: scratch,
      },
      { kind: 'user_work', agentType: 'build-verify', billeeUserId: input.userId, artifactId: input.artifactId },
    );

    // Drain the stream so the chokepoint's single metering point fires, then read the final text.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ev of handle.events) {
      /* text is read from the resolved result below; draining is what lets metering complete */
    }
    const result = await handle.result;
    return parseVerdict(result.text);
  } catch (err) {
    // Never propagate into the build pipeline: a runner failure is an honest not-run.
    return { ran: false, passed: false, note: `verification did not run: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** The medium-depth playwright-cli instruction. Depth selects a full acceptance pass (first
 *  build) vs a scoped change + smoke pass (follow-up), per ch07 §7.2.6. */
function buildPrompt(input: VerifyRunInput): string {
  const scope =
    input.depth === 'full'
      ? 'Run a FULL acceptance pass: exercise the primary user flows end to end.'
      : 'Run a SCOPED pass: exercise the recently changed area, plus a short smoke test of the core flow.';
  return [
    `Exercise the web application served at ${input.appUrl} using playwright-cli at medium depth.`,
    scope,
    'Drive the real UI: navigate, click, fill forms, and assert the app renders and responds without console errors or crashes.',
    'When you are done, output your verdict as the FINAL line, in exactly this form:',
    '  PASS - <short note>   (all checks passed)',
    '  FAIL - <short note>   (a check could not be made to pass)',
  ].join('\n');
}

/** Parse the agent's final PASS/FAIL verdict line (scanning from the end). A run that produced
 *  no parseable verdict is an honest inconclusive not-pass — never silently treated as a pass. */
function parseVerdict(text: string): VerifyRunResult {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^(PASS|FAIL)\b[\s:.-]*(.*)$/i.exec(lines[i] as string);
    if (m) {
      const passed = (m[1] as string).toUpperCase() === 'PASS';
      const note = (m[2] ?? '').trim();
      if (passed) return { ran: true, passed: true };
      return { ran: true, passed: false, note: note || 'Algumas verificações não passaram.' };
    }
  }
  return { ran: true, passed: false, note: 'A verificação não produziu um veredito claro.' };
}
