/**
 * Build jobs (ch05 §5.6.2). The §5.2 pipeline plus build specifics: follow-up detection and the
 * in-build classifier (under the abort rules of §5.3.2), the first-build reservation (§5.3.3) and
 * the one-follow-up-per-artifact 409 (§5.3.5), routing floored at the expert tier, the inactivity
 * + wall-clock timers (§5.3.6), session resume via sdkSessionId persisted-only-when-changed
 * (§5.4.5), the completion sequence (§5.6.2 steps 1-8) including the per-build verification stage
 * (step 5, ch07 §7.2.6), the provider-error reroute (§5.3.7), the dual-fire guard (§5.3.4), and
 * the P-10 persistence + in-process zombie net.
 */
import type { Actor } from '@ekoa/shared';
import { loadAgentsConfig } from '../config.js';
import { checkAllowance } from '../billing/index.js';
import { BILLING_PAGE_URL } from '../billing/constants.js';
import { runAgent, decideForTask, LlmAbortedError } from '../llm/index.js';
import { runPostRunExtraction } from '../memory/index.js';
import { userSettings } from '../data/stores.js';
import {
  registerRun,
  getRun,
  removeRun,
  finalizeOnce,
  hasLiveJobForArtifact,
  reserveFirstBuild,
  bindReservation,
  releaseReservation,
} from './registry.js';
import { JobStreamSink, emitIntegrationBuildIntent, emitChatAnswer } from './streaming.js';
import { MarkerProcessor, scanProviderError } from './markers.js';
import { StreamingIdentityRedactor } from './branding.js';
import { toolPolicyFor } from './tools.js';
import { knowledgeToolSpecs, loadContextToolSpec, delegateToolSpec } from './sdk-tools.js';
import { classifyInBuildIntent } from './guided-build.js';
import {
  persistJob,
  patchJob,
  getJob,
  jobView,
  nonTerminalJobForArtifact,
  resetArtifactToDraft,
  type JobRecord,
} from './jobs.js';
import { assembleAgentContext, getBuildMechanics, knowledgeGrounding, verifyRunner } from './seams.js';
import { logActivity } from '../data/activity.js';

/** Registo (F3): build lifecycle rows, metadata-only (ids/codes — NEVER the request description
 *  or any prompt text). The single audit write path (FIXED-8); best-effort so bookkeeping never
 *  fails a build. `type` is created | completed | failed | cancelled. */
function auditBuild(input: BuildCreateInput, type: string, metadata: Record<string, unknown>): void {
  void logActivity(
    { userId: input.actor.userId, username: input.username, orgId: input.actor.orgId },
    'build',
    type,
    input.deps,
    metadata,
  ).catch(() => undefined);
}

export interface BuildCreateInput {
  actor: Actor;
  username: string;
  sessionId: string;
  description: string;
  language: string;
  templateId?: string;
  integrationKeys?: string[];
  artifactId?: string;
  attachments?: unknown[];
  fieldValues?: Record<string, unknown>;
  configValues?: Record<string, unknown>;
  deps: { now: () => number; genId: () => string };
}

export type BuildCreateResult =
  | { status: 'created'; job: ReturnType<typeof jobView>; fire: () => void }
  | { status: 'answered'; reason: string }
  | { status: 'conflict' };

/**
 * Handle `POST /jobs` (build) up to the response (§5.6.2). First builds reserve synchronously and
 * respond `created`; follow-ups run the in-build classifier and may respond `answered` with no
 * job. A concurrent follow-up on the same artifact is `conflict` → the route returns 409
 * DUPLICATE_BUILD.
 */
export async function handleBuildCreate(input: BuildCreateInput): Promise<BuildCreateResult> {
  return input.artifactId ? handleFollowUp(input, input.artifactId) : handleFirstBuild(input);
}

// --- First build -------------------------------------------------------------------------

async function handleFirstBuild(input: BuildCreateInput): Promise<BuildCreateResult> {
  // Reserve synchronously BEFORE any async work (§5.3.3). A live reservation binds the second
  // POST to the running job and returns it (the build_intent broadcast reaches every open tab).
  const reservation = reserveFirstBuild(input.sessionId, input.deps.now());
  if (!reservation.ok) {
    // Bound to the existing job — return it as `created` pointing at the running job.
    const existingId = reservation.jobId;
    return {
      status: 'created',
      job: { id: existingId, status: 'running', createdAt: new Date(input.deps.now()).toISOString() },
      fire: () => {},
    };
  }

  const jobId = input.deps.genId();
  bindReservation(input.sessionId, jobId);
  const abort = new AbortController();
  registerRun({
    id: jobId,
    ownerUserId: input.actor.userId,
    orgId: input.actor.orgId,
    kind: 'build',
    abort,
    startedAt: input.deps.now(),
    sessionId: input.sessionId,
  });

  const record: JobRecord = {
    _id: jobId,
    kind: 'build',
    status: 'created',
    userId: input.actor.userId,
    sessionId: input.sessionId,
    request: {
      description: input.description,
      language: input.language,
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.integrationKeys ? { integrationKeys: input.integrationKeys } : {}),
      ...(input.fieldValues ? { fieldValues: input.fieldValues } : {}),
      ...(input.configValues ? { configValues: input.configValues } : {}),
    },
    createdAt: new Date(input.deps.now()).toISOString(),
  };
  // Persist BEFORE responding so `GET /jobs/:id` finds the record as soon as the 202 returns
  // ("respond early once the record exists", §5.2 step 2).
  await persistJob(record);
  auditBuild(input, 'created', { jobId }); // Registo (F3)

  return {
    status: 'created',
    job: jobView(record),
    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: true }),
  };
}

// --- Follow-up ---------------------------------------------------------------------------

async function handleFollowUp(input: BuildCreateInput, artifactId: string): Promise<BuildCreateResult> {
  // One follow-up build per artifact (§5.3.5): reject a concurrent build targeting the same
  // artifact — two would resume the same SDK transcript and corrupt it.
  if (hasLiveJobForArtifact(artifactId) || (await nonTerminalJobForArtifact(artifactId))) {
    return { status: 'conflict' };
  }

  const jobId = input.deps.genId();
  const abort = new AbortController();
  registerRun({
    id: jobId,
    ownerUserId: input.actor.userId,
    orgId: input.actor.orgId,
    kind: 'build',
    abort,
    startedAt: input.deps.now(),
    artifactId,
    sessionId: input.sessionId,
  });

  // In-build message classifier BEFORE any build work, under the abort rules of §5.3.2.
  let intent: Awaited<ReturnType<typeof classifyInBuildIntent>>;
  try {
    intent = await classifyInBuildIntent(input.description, input.actor.userId, abort.signal);
  } catch (err) {
    removeRun(jobId);
    if (err instanceof LlmAbortedError) {
      // Abort NEVER falls through to a build (§5.3.2): zero jobs created, zero side effects.
      return { status: 'answered', reason: 'Execução cancelada.' };
    }
    // Non-abort classifier failure is non-fatal and defaults to proceeding (§5.6.2) — handled by
    // classifyInBuildIntent's own fallback, so reaching here is an unexpected error: answer safely.
    return { status: 'answered', reason: 'Não foi possível processar o pedido.' };
  }

  if (intent === 'integration-build') {
    emitIntegrationBuildIntent(input.actor.userId, { sessionId: input.sessionId });
    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'Vou ligar essa integração primeiro.' });
    removeRun(jobId);
    return { status: 'answered', reason: 'integration-build' };
  }
  if (intent === 'question') {
    // In-build answer flow (cheap tier), delivered as chat_answer; no job (§5.6.2).
    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'A aplicação está a ser construída; posso ajudar com isso.' });
    removeRun(jobId);
    return { status: 'answered', reason: 'question' };
  }

  // modification → proceed with the build. projectDir resolved server-side from the artifact.
  const record: JobRecord = {
    _id: jobId,
    kind: 'build',
    status: 'created',
    userId: input.actor.userId,
    sessionId: input.sessionId,
    artifactId,
    request: { description: input.description, language: input.language },
    createdAt: new Date(input.deps.now()).toISOString(),
  };
  await persistJob(record);
  auditBuild(input, 'created', { jobId, artifactId }); // Registo (F3)
  return {
    status: 'created',
    job: jobView(record),
    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: false, artifactId }),
  };
}

// --- Execution ---------------------------------------------------------------------------

interface ExecOpts {
  firstBuild: boolean;
  artifactId?: string;
}

/**
 * F16 steering: the build agent's system prompt names the served entrypoint and forbids the
 * orphan-HTML failure mode (the app compiled and served is ALWAYS the manifest entrypoint —
 * `frontend/src/index.jsx` importing `App.jsx`; a standalone top-level HTML file is never
 * served). The honest-completion gate below is the SYSTEM's catch for when the model errs
 * anyway — this prompt just makes the miss rare.
 */
const BUILD_SYSTEM_PROMPT = [
  'You are building a web app inside an Ekoa app workspace.',
  'The served application is compiled from the manifest entrypoint: frontend/src/index.jsx, which renders frontend/src/App.jsx.',
  'Make ALL user-visible changes by editing frontend/src/App.jsx (and files it imports under frontend/src/).',
  'NEVER write a standalone top-level *.html file as the deliverable - top-level HTML files are not served; only the compiled entrypoint bundle is.',
  'Do not edit dist/ by hand - it is build output, regenerated from frontend/src/.',
  // White-label (ch12; operator report 2026-07-11: the final summary named `window.__ekoa.exportPdf`).
  'Your FINAL message is read by a non-technical end user. Write it in the language of their request.',
  'In that final message NEVER mention internal platform APIs (window.__ekoa or any of its members), file paths, bundlers, manifests, libraries, or any implementation machinery.',
  'Describe what the app DOES in product terms ("um botão que descarrega o documento em PDF"), never HOW it is wired.',
].join('\n');

/**
 * Run the build job through the chokepoint and drive the completion sequence (§5.6.2). Terminal
 * state is owned by the finalize path (dual-fire guarded). The in-process zombie net lives in the
 * `finally`: a run left non-terminal is flipped to `failed { PIPELINE_STUCK }` and the artifact
 * reset to draft (§5.2.1).
 */
export async function executeBuildJob(jobId: string, input: BuildCreateInput, abort: AbortController, opts: ExecOpts): Promise<void> {
  const entry = getRun(jobId);
  const sink = new JobStreamSink(jobId);
  const start = input.deps.now();
  const cfg = loadAgentsConfig();
  const mech = getBuildMechanics();

  let artifactId = opts.artifactId ?? '';
  let projectDir = '';
  let slug = '';
  let appUrl = '';
  let resumeSessionId: string | undefined;
  let terminalReached = false;

  const finishError = async (code: string): Promise<void> => {
    if (finalizeOnce(jobId)) {
      sink.error(code, 'A construção falhou.');
      await patchJob(jobId, { status: 'failed', error: { code, message: 'A construção falhou.' }, endedAt: new Date(input.deps.now()).toISOString() });
      if (artifactId) await resetArtifactToDraft(artifactId); // artifact stays draft on error (§5.6.2)
    }
    terminalReached = true;
  };

  // Inactivity + wall-clock timers (§5.3.6). Inactivity resets on every stream/tool/plan
  // callback; wall clock is absolute. On a timeout: if abort is already set (cancel owns terminal
  // state) stay quiet; otherwise route through the finalized-guarded error path.
  let inactivityTimer: NodeJS.Timeout;
  const resetInactivity = (): void => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(onTimeout, cfg.buildInactivityTimeoutMs);
  };
  const wallClock = setTimeout(onTimeout, cfg.buildWallClockMs);
  function onTimeout(): void {
    if (abort.signal.aborted) return; // cancel owns the terminal state
    if (entry) entry.timedOut = true;
    abort.abort();
  }
  resetInactivity();

  try {
    await patchJob(jobId, { status: 'running', startedAt: new Date(input.deps.now()).toISOString() });

    // Billing gate (§5.2 step 3).
    const allow = await checkAllowance(input.actor.userId);
    if (abort.signal.aborted) { await settleAborted(); return; }
    if (!allow.ok) {
      clearTimers();
      if (finalizeOnce(jobId)) {
        const url = allow.billingUrl ?? BILLING_PAGE_URL;
        sink.error('BILLING_BLOCKED', `${allow.message ?? 'Faturação bloqueada.'} ${url}`);
        await patchJob(jobId, { status: 'failed', error: { code: 'BILLING_BLOCKED', message: allow.message ?? 'Faturação bloqueada.' }, endedAt: new Date(input.deps.now()).toISOString() });
      }
      terminalReached = true;
      return;
    }

    // First-build vs follow-up resolution.
    let basePromptSections: string[] = [];
    if (opts.firstBuild) {
      const prep = await mech.prepareFirstBuild({ userId: input.actor.userId, sessionId: input.sessionId, description: input.description, language: input.language, ...(input.templateId ? { templateId: input.templateId } : {}) });
      artifactId = prep.artifactId;
      projectDir = prep.projectDir;
      slug = prep.slug;
      appUrl = prep.appUrl;
      basePromptSections = prep.basePromptSections ?? [];
      if (entry) entry.artifactId = artifactId;
      await patchJob(jobId, { artifactId });
    } else {
      const resolved = await mech.resolveFollowUp(artifactId);
      if (!resolved) { clearTimers(); await finishError('ADAPTER_ERROR'); return; }
      projectDir = resolved.projectDir;
      resumeSessionId = resolved.resumeSessionId;
      slug = resolved.slug;
      appUrl = resolved.appUrl;
      basePromptSections = resolved.basePromptSections ?? [];
    }
    if (abort.signal.aborted) { await settleAborted(); return; }

    // Live build surface: the scaffold (or the existing app, on a follow-up) is served ALREADY —
    // tell the client where, so the preview iframe + real file tree show from second zero, and
    // wire the watcher so every incremental rebuild reloads the preview as the agent writes.
    if (artifactId && appUrl) {
      sink.artifact({ artifactId, appUrl, ...(slug ? { slug } : {}) });
      if (projectDir) await mech.watchRebuilds({ artifactId, projectDir, onRebuild: () => sink.previewReload() });
    }

    // Routing floored at the expert tier (§5.2 step 5); emit the routing event.
    const decision = decideForTask(input.description, undefined, 'EXPERT');
    sink.routing(decision.tier, opts.firstBuild ? 'first build' : 'follow-up build');
    await patchJob(jobId, { routing: { tier: decision.tier, reason: opts.firstBuild ? 'first build' : 'follow-up build' } });

    const policy = toolPolicyFor('build');
    const liveMarkers = new MarkerProcessor();
    let capturedSessionId: string | undefined;

    // The coding kind's content sections lead the build system prompt (before this run's F16
    // entrypoint steering) — pre-fix, builds sent ONLY the 6-line inline prompt and the whole
    // coding-agent content package was dead weight. The grounding block self-gates (legal-context
    // builds only, §5.5.2 layer 2); both layers are non-fatal.
    let contentSections: string[] = [];
    let groundingBlock = '';
    try {
      contentSections = (await assembleAgentContext({ agentKind: 'coding', userId: input.actor.userId })).promptSections;
      groundingBlock = await knowledgeGrounding({ userId: input.actor.userId, orgId: input.actor.orgId, query: input.description, agentKind: 'coding' });
    } catch (err) {
      console.warn('[build] content/grounding assembly failed (non-fatal):', err instanceof Error ? err.message : err);
    }

    const handle = runAgent(
      {
        prompt: input.description,
        // F16: pin the agent to the served entrypoint. Nothing else names it (settingSources is
        // empty, §5.4.2), so without this the agent may write a standalone HTML file that is
        // never served while the scaffold keeps being compiled. Flows through runAgent's
        // anonymise path like every prompt (client.ts systemPrompt handling).
        // Base conventions (operator-run B1) sit between the universal coding sections and
        // the grounding block: universal judgment first, then the selected base's structural
        // invariants, then dynamic knowledge, then the F16 entrypoint steer.
        systemPrompt: [...contentSections, ...basePromptSections, groundingBlock, BUILD_SYSTEM_PROMPT].filter(Boolean).join('\n\n'),
        decision,
        allowedTools: policy.allowedTools,
        maxTurns: policy.maxTurns,
        // Builds mount the knowledge tools + the context-loading tool + the §5.4.8 local-bridge
        // delegation tool as in-process MCP (§5.4.4; ch18 §18.2).
        sdkTools: [...knowledgeToolSpecs(input.actor), loadContextToolSpec(input.actor, 'coding'), delegateToolSpec(input.actor, input.sessionId)],
        cwd: projectDir || undefined,
        homeDir: projectDir || undefined, // build runs set HOME = projectDir (§5.4.1)
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
        signal: abort.signal,
        callbacks: {
          onToolEvent: (e) => { resetInactivity(); sink.toolEvent(e); },
          onSessionId: (sid) => { capturedSessionId = sid; },
          onPlanNotification: () => resetInactivity(),
        },
      },
      { kind: 'user_work', agentType: 'build', billeeUserId: input.actor.userId, sessionId: input.sessionId, runId: jobId, artifactId },
    );

    // Two channels, mirroring chat.ts (§5.6.1): the ANSWER stream (`text`) and the working
    // commentary (`thinking` — intermediate-turn narration + thinking blocks, where the engine
    // happily self-identifies). Pre-fix, build funneled BOTH into text_chunk, so the user's
    // transcript filled with mid-word fragments of internal narration rendered as regular
    // messages (operator report 2026-07-11). Each channel gets its own marker filter; the
    // thinking channel is additionally engine-identity-redacted (branding.ts).
    const thinkingMarkers = new MarkerProcessor();
    const thinkingRedactor = new StreamingIdentityRedactor();
    const emitThinking = (piece: string): void => {
      if (piece) sink.thinking(piece);
    };
    let streamedAny = false; // ANSWER chunks only: thinking must not mask a provider-error-as-result
    for await (const ev of handle.events) {
      resetInactivity();
      if (ev.type === 'thinking') {
        emitThinking(thinkingRedactor.push(thinkingMarkers.push(ev.text)));
        continue;
      }
      streamedAny = true;
      const clean = liveMarkers.push(ev.text);
      if (clean) sink.text(clean);
    }
    const thinkingTail = thinkingMarkers.end();
    emitThinking(thinkingRedactor.push(thinkingTail.text) + thinkingRedactor.end());
    const tail = liveMarkers.end();
    if (tail.text) sink.text(tail.text);
    const result = await handle.result;
    clearTimers();

    if (result.aborted) { await settleAborted(); return; }

    // §5.6.2 completion sequence, step 1: provider-error-as-result reroute (§5.3.7). Scanned only
    // on the nothing-streamed fallback shape — same reasoning as chat.ts (F20 made result.text the
    // full accumulation; legitimate build narration can mention error terms).
    if (!streamedAny && scanProviderError(result.text)) { await finishError('ADAPTER_ERROR'); return; }

    // Session resume (§5.4.5): persist sdkSessionId ONLY when it differs from what we resumed with.
    if (capturedSessionId && capturedSessionId !== resumeSessionId) {
      await mech.persistSdkSessionId(artifactId, capturedSessionId);
    }

    // Step 2: final bundle. Step 3: version snapshot (broken builds snapshotted with a failure tag).
    const bundle = await mech.finalizeBundle({ artifactId, projectDir });
    await mech.snapshot({ artifactId, projectDir, broken: !bundle.ok });

    // Step 4: slug — preserved on follow-ups, generated on first builds (already resolved in prep).

    // Step 5a (F16): honest-completion gate. Deterministic evidence the work reached the SERVED
    // surface — an untouched entrypoint subtree / scaffold-fingerprinted dist means the user's
    // app was never built (the classic miss: the real app written to an orphan top-level HTML
    // that is never served). A gate hit is a DISTINCT non-success terminal: it surfaces to the
    // user and the job fails — never a clean `completed` over a scaffold. Runs before the model
    // verification (step 5) so a scaffold build is never billed a verification pass.
    const progress = await mech.assertProgress({ artifactId, projectDir });
    if (!progress.clean) {
      if (finalizeOnce(jobId)) {
        const detail = progress.reasons.join('; ');
        const message = `A construção não chegou à aplicação servida (a página continua o modelo inicial). ${detail}`.trim();
        sink.error('BUILD_UNFULFILLED', message);
        await patchJob(jobId, { status: 'failed', error: { code: 'BUILD_UNFULFILLED', message }, endedAt: new Date(input.deps.now()).toISOString() });
      }
      terminalReached = true;
      return;
    }

    // Step 5: per-build verification (default ON per user's build.verifyBuilds). Full acceptance
    // pass on a first build; scoped tests + smoke on a follow-up. The runner receives the user's
    // REQUEST and asserts request-fulfilment (F28), not mere rendering. Verdict semantics:
    //   - ran+passed  → clean, no note.
    //   - ran+FAILED  → GATES completion (F28): a distinct non-success terminal that surfaces to
    //     the user — never a silent `completed` with a note (that was verification theater: the
    //     gate that exists to catch a served scaffold passed it and billed for the pass).
    //   - not-run (e.g. credential-skip) → honest note-only, never a failure (§5.6.2 step 5).
    let verifyNote: string | undefined;
    const verifyEnabled = (await userSettings.get(input.actor.userId))?.build?.verifyBuilds ?? true;
    if (verifyEnabled) {
      sink.planStep('verifying', 'A testar a aplicação...');
      // The verify stage streams its narration through the thinking channel — it used to be a
      // silent multi-minute void (operator report 2026-07-11). Its own filter chain: raw runner
      // text → marker filter → engine-identity redaction. Verify is bounded by its own wall
      // clock inside the runner (verifyWallClockMs), not the build timers (cleared above).
      const verifyMarkers = new MarkerProcessor();
      const verifyRedactor = new StreamingIdentityRedactor();
      const verdict = await verifyRunner({
        artifactId,
        projectDir,
        appUrl,
        userId: input.actor.userId,
        depth: opts.firstBuild ? 'full' : 'scoped',
        request: input.description,
        onProgress: (text) => {
          const clean = verifyRedactor.push(verifyMarkers.push(text));
          if (clean) sink.thinking(clean);
        },
      });
      if (verdict.ran && !verdict.passed) {
        if (finalizeOnce(jobId)) {
          const message = `A verificação da aplicação falhou. ${verdict.note ?? ''}`.trim();
          sink.error('VERIFY_FAILED', message);
          await patchJob(jobId, { status: 'failed', error: { code: 'VERIFY_FAILED', message }, endedAt: new Date(input.deps.now()).toISOString() });
        }
        terminalReached = true;
        return;
      }
      if (!verdict.ran && verdict.note) verifyNote = verdict.note;
    }

    // Step 6: complete event. Notes (bundle error / honest verify not-run) are APPENDED to the
    // agent's user-facing summary, never a replacement for it — pre-fix, any note clobbered the
    // whole summary, so the user's "done" message was just "verification did not run: ..."
    // (operator report 2026-07-11).
    const notes = [bundle.ok ? '' : (bundle.error ?? 'A compilação final falhou.'), verifyNote ?? ''].filter(Boolean).join(' ');
    const completionText = [result.text, notes].filter(Boolean).join('\n\n') || notes;
    if (finalizeOnce(jobId)) {
      sink.complete({ result: completionText, artifactId, slug, appUrl }, input.deps.now() - start);
      await patchJob(jobId, { status: 'completed', result: { text: completionText, slug, appUrl }, endedAt: new Date(input.deps.now()).toISOString() });
    }
    terminalReached = true;

    // Step 7: artifact → active with a MERGE onto its data bag (§5.6.2 step 7).
    // projectDir lets activation capture the app's declared UI action manifest (C2).
    await mech.activateArtifact({ artifactId, slug, appUrl, ...(projectDir ? { projectDir } : {}) });
    // Step 8: fire-and-forget screenshot + post-run memory extraction OFF the terminal event.
    mech.screenshot(artifactId);
    void runPostRunExtraction({ userId: input.actor.userId, username: input.username, orgId: input.actor.orgId, sessionId: input.sessionId, runId: jobId, transcript: `${input.description}\n\n${result.text}`, deps: input.deps }).catch(() => undefined);
  } catch (err) {
    clearTimers();
    await finishError('ADAPTER_ERROR');
    void err;
  } finally {
    clearTimers();
    // In-process zombie net (§5.2.1): a run somehow still non-terminal after the pipeline exits is
    // flipped to failed { PIPELINE_STUCK } and its artifact reset to draft.
    if (!terminalReached && finalizeOnce(jobId)) {
      sink.error('PIPELINE_STUCK', 'A construção terminou num estado inconsistente.');
      await patchJob(jobId, { status: 'failed', error: { code: 'PIPELINE_STUCK', message: 'Pipeline stuck.' }, endedAt: new Date(input.deps.now()).toISOString() });
      if (artifactId) await resetArtifactToDraft(artifactId);
    }
    if (input.sessionId) releaseReservation(input.sessionId, jobId); // guarded by job id (§5.3.3)
    removeRun(jobId);
    // Registo (F3): ONE terminal row per build, from the record's final status (guaranteed-once
    // here — every terminal transition has already patched the store). Metadata is ids/codes only.
    // Best-effort: a store read that fails (e.g. the DB went away as the process exits) must NOT
    // become an unhandled rejection on this fire-and-forget pipeline — swallow it like the audit
    // write itself (a missed bookkeeping row never fails a build).
    try {
      const finalJob = await getJob(jobId);
      const st = finalJob?.status;
      if (st === 'completed') auditBuild(input, 'completed', { jobId, ...(artifactId ? { artifactId } : {}) });
      else if (st === 'failed') auditBuild(input, 'failed', { jobId, code: finalJob?.error?.code ?? 'UNKNOWN' });
      else if (st === 'cancelled') auditBuild(input, 'cancelled', { jobId });
    } catch {
      /* terminal-audit read failed (shutdown/db hiccup) — best-effort, never fails the build */
    }
  }

  function clearTimers(): void {
    clearTimeout(inactivityTimer);
    clearTimeout(wallClock);
  }

  // Cancelled/plain-abort terminal: set the cancelled status (cancel set it BEFORE the abort, so
  // the terminal transition here is the cancelled one; a plain abort stays quiet).
  async function bail(): Promise<void> {
    clearTimers();
    if (entry?.cancelled && finalizeOnce(jobId)) {
      await patchJob(jobId, { status: 'cancelled', endedAt: new Date(input.deps.now()).toISOString() });
    }
    terminalReached = true;
  }

  // Abort resolution (§5.3.6): a timeout surfaces a terminal ERROR wherever the abort lands —
  // including the early checkpoints before the stream — while a user Stop stays silent (cancel
  // owns the terminal state). Found by the G7B fresh-context review: bail() alone is
  // timeout-blind, so a timeout during checkAllowance/prepare was misreported as a cancel.
  async function settleAborted(): Promise<void> {
    clearTimers();
    if (entry?.timedOut && !entry.cancelled) await finishError('TIMEOUT');
    else await bail();
  }
}

export { getJob };
