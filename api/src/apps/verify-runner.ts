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
 *    false) the runner reports `{ ran: false, passed: false, note }` — an honest not-run is a
 *    distinct non-passing state (only a real ran+passed verification sets `passed: true`), never a
 *    fake claim of having verified. A not-run does not FAIL the build (build.ts completes with the
 *    note); it just refuses to report a pass it did not earn.
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
  /** The user's build request (F28): the verifier asserts request-FULFILMENT, not mere rendering. */
  request: string;
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
    return { ran: false, passed: false, note: 'verification skipped: model credential unavailable' };
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
        homeDir: scratch, // pin HOME too so the chokepoint does not allocate a second, unused sandbox (F25 finding 4)
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
 *  build) vs a scoped change + smoke pass (follow-up), per ch07 §7.2.6. F28: the verifier is
 *  told WHAT the app should do (the user's request) and must assert request-FULFILMENT — a
 *  scaffold placeholder rendering cleanly is a FAIL, not a pass. Exported for the unit test
 *  (a pure function; the deterministic contract lives in the prompt text). */
export function buildPrompt(input: VerifyRunInput): string {
  const scope =
    input.depth === 'full'
      ? 'Run a FULL acceptance pass: exercise the primary user flows end to end.'
      : 'Run a SCOPED pass: exercise the recently changed area, plus a short smoke test of the core flow.';
  return [
    `Exercise the web application served at ${input.appUrl} using playwright-cli at medium depth.`,
    '',
    'The application was built from this user request:',
    `<request>${input.request}</request>`,
    '',
    scope,
    'Drive the real UI: navigate, click, fill forms, and assert the app renders and responds without console errors or crashes.',
    '',
    'You must verify REQUEST-FULFILMENT, not merely that a page renders:',
    '1. SCAFFOLD CHECK (mandatory, first): if the served page is the Ekoa scaffold placeholder — it',
    '   contains any of: "Powered by Ekoa", "Your app is being created", "Let\'s build something',
    '   that will change", or an element with class "scaffold-root" — the build did NOT produce the',
    '   requested app. Output FAIL immediately.',
    '2. ACCEPTANCE CHECK: the interactive elements the request implies must exist and work (e.g. a',
    '   requested counter has a working button; a requested form submits). Missing expected',
    '   functionality is a FAIL even if the page renders without errors.',
    '',
    'When you are done, output your verdict as the FINAL line, in exactly this form:',
    '  PASS - <short note>   (the app fulfils the request and all checks passed)',
    '  FAIL - <short note>   (scaffold placeholder, missing requested functionality, or a failed check)',
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
