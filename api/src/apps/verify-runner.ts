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
 * Operative bounds (operator incident 2026-07-11): the artifact-relative `appUrl` used to be
 * pasted into the prompt verbatim (`/apps/<id>/` — no origin), so the agent spent 13+ minutes
 * port-scanning the host for the app and died at the turn ceiling, mid-task, silently. Three
 * fixes live here:
 *  - the prompt receives an ABSOLUTE loopback URL (the API serves /apps/* itself);
 *  - the WALL-CLOCK deadline (`verifyWallClockMs`) is the real bound — the turn ceiling
 *    (`maxTurnsVerify`) is a generous runaway backstop that must never cut a verification short;
 *  - the agent is forbidden from searching the host when the URL does not answer (that is an
 *    immediate FAIL, not a scavenger hunt).
 *
 * Two honesty invariants:
 *  - Credential-skip: when no usable model credential is configured (`claudeAuthStatus().ok`
 *    false) the runner reports `{ ran: false, passed: false, note }` — an honest not-run is a
 *    distinct non-passing state (only a real ran+passed verification sets `passed: true`), never a
 *    fake claim of having verified. A not-run does not FAIL the build (build.ts completes with the
 *    note); it just refuses to report a pass it did not earn.
 *  - Never throw into the build pipeline (§5.6.2 step 5): every failure is wrapped into a
 *    VerifyRunResult with an honest `ran` flag. User-facing notes are PT and generic — raw
 *    SDK/provider error strings go to the server log, never the chat (white-label, ch12).
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent, decideForTask, claudeAuthStatus } from '../llm/index.js';
import { loadConfig, loadAgentsConfig } from '../config.js';
import { mintPreviewToken } from '../services/preview-token.js';

/** first build → full acceptance pass; follow-up → scoped tests + smoke pass. */
export interface VerifyRunInput {
  artifactId: string;
  projectDir: string;
  appUrl: string;
  userId: string;
  depth: 'full' | 'scoped';
  /** The user's build request (F28): the verifier asserts request-FULFILMENT, not mere rendering. */
  request: string;
  /** Live narration hook — raw model text; the caller owns marker/identity scrubbing. */
  onProgress?: (text: string) => void;
}

export interface VerifyRunResult {
  ran: boolean;
  passed: boolean;
  note?: string;
}

/** The API serves /apps/* itself, so the verify agent (same host) reaches the app on loopback.
 *  Artifact records store the browser-relative path (`/apps/<id>/`); an absolute URL passes
 *  through untouched. A draft, non-shareable artifact's DOCUMENT is owner-gated (§7.7), so the
 *  URL carries a purpose-scoped preview token - the capability to view THIS artifact for the
 *  verify window, never a user JWT (which would authenticate on every API route from inside an
 *  agent transcript). Exported for the unit test. */
export function resolveVerifyUrl(appUrl: string, artifactId?: string, ttlMs?: number): string {
  const base = /^https?:\/\//i.test(appUrl)
    ? appUrl
    : `http://127.0.0.1:${loadConfig().port}${appUrl.startsWith('/') ? appUrl : `/${appUrl}`}`;
  if (!artifactId) return base;
  const token = mintPreviewToken(artifactId, ttlMs ?? 600_000);
  return `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

export async function verifyRunner(input: VerifyRunInput): Promise<VerifyRunResult> {
  // Credential-skip (ch05 §5.6.2 step 5): `ok` is false when unconfigured OR a refresh alert is
  // latched — either way a real verification run cannot proceed, so report an honest not-run.
  if (!claudeAuthStatus().ok) {
    return { ran: false, passed: false, note: 'verificação não executada: credencial de modelo indisponível' };
  }

  const cfg = loadAgentsConfig();
  try {
    // A throwaway working dir for the verifier's own scratch (screenshots, temp scripts). The
    // app under test is driven over HTTP at the resolved URL — this cwd is not the app's tree.
    const scratch = await mkdtemp(join(tmpdir(), 'ekoa-verify-'));
    const decision = decideForTask('test the built application end to end', undefined, 'WORKHORSE');

    const handle = runAgent(
      {
        prompt: buildPrompt({ ...input, appUrl: resolveVerifyUrl(input.appUrl, input.artifactId, cfg.verifyWallClockMs + 120_000) }),
        decision,
        allowedTools: ['Bash'],
        maxTurns: cfg.maxTurnsVerify,
        cwd: scratch,
        homeDir: scratch, // pin HOME too so the chokepoint does not allocate a second, unused sandbox (F25 finding 4)
        // The REAL bound: a verification that outlives the deadline is cut off and reported as
        // an honest not-run — never a silent multi-minute void, never a fake verdict.
        signal: AbortSignal.timeout(cfg.verifyWallClockMs),
      },
      { kind: 'user_work', agentType: 'build-verify', billeeUserId: input.userId, artifactId: input.artifactId },
    );

    // Stream the run: narration chunks feed the live progress hook (the verify stage used to be
    // a silent void); draining is also what lets the chokepoint's single metering point fire.
    for await (const ev of handle.events) {
      if (ev.text) input.onProgress?.(ev.text);
    }
    const result = await handle.result;
    if (result.aborted) {
      return { ran: false, passed: false, note: 'a verificação excedeu o tempo limite e não foi concluída' };
    }
    return parseVerdict(result.text);
  } catch (err) {
    // Never propagate into the build pipeline: a runner failure is an honest not-run. The raw
    // error (SDK/provider strings, English, engine names) belongs in the server log — the
    // user-facing note stays generic PT (white-label; the operator saw "Agente EKOA Code
    // returned an error result: Reached maximum number of turns (15)" in the chat, 2026-07-11).
    const raw = err instanceof Error ? err.message : String(err);
    if (/timeout|abort/i.test(raw)) {
      return { ran: false, passed: false, note: 'a verificação excedeu o tempo limite e não foi concluída' };
    }
    console.warn(`[verify] ${input.artifactId}: runner failed:`, raw);
    return { ran: false, passed: false, note: 'a verificação não pôde ser concluída' };
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
    `Exercise the web application served at EXACTLY this URL using playwright-cli: ${input.appUrl}`,
    '',
    'That URL is a local server on this machine and is the ONLY place the app lives.',
    'If it does not respond or returns an error, output FAIL immediately with the reason —',
    'do NOT search for the app elsewhere, do NOT scan ports, do NOT inspect the host system.',
    '',
    'The application was built from this user request:',
    `<request>${input.request}</request>`,
    '',
    scope,
    'Scale effort to the app: a simple static page (a flyer, a landing page) needs only a quick',
    'pass — load it, check the console, confirm the requested content and any buttons work.',
    'Reserve deep multi-flow exercising for apps whose request implies real interaction.',
    'Drive the real UI: navigate, click, fill forms, and assert the app renders and responds without console errors or crashes.',
    '',
    'Narrate as you go, for a NON-TECHNICAL user watching live: immediately before EACH',
    'action, print one short line in European Portuguese, alone on its own line, prefixed',
    'with ">> " (e.g. \'>> A abrir a aplicação\', \'>> A clicar em "Adicionar"\',',
    '\'>> A preencher o formulário\', \'>> A confirmar que a lista atualiza\').',
    'These lines are shown to the user as live progress. Never put tool names, commands,',
    'URLs, file paths, or technical terms in them.',
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
    'Write the <short note> in European Portuguese - it is shown to a non-technical end user.',
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
