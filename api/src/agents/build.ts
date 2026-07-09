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
import { toolPolicyFor } from './tools.js';
import { knowledgeToolSpecs, loadContextToolSpec } from './sdk-tools.js';
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
import { getBuildMechanics, verifyRunner } from './seams.js';

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
    if (opts.firstBuild) {
      const prep = await mech.prepareFirstBuild({ userId: input.actor.userId, sessionId: input.sessionId, description: input.description, language: input.language, ...(input.templateId ? { templateId: input.templateId } : {}) });
      artifactId = prep.artifactId;
      projectDir = prep.projectDir;
      slug = prep.slug;
      appUrl = prep.appUrl;
      if (entry) entry.artifactId = artifactId;
      await patchJob(jobId, { artifactId });
    } else {
      const resolved = await mech.resolveFollowUp(artifactId);
      if (!resolved) { clearTimers(); await finishError('ADAPTER_ERROR'); return; }
      projectDir = resolved.projectDir;
      resumeSessionId = resolved.resumeSessionId;
    }
    if (abort.signal.aborted) { await settleAborted(); return; }

    // Routing floored at the expert tier (§5.2 step 5); emit the routing event.
    const decision = decideForTask(input.description, undefined, 'EXPERT');
    sink.routing(decision.tier, opts.firstBuild ? 'first build' : 'follow-up build');
    await patchJob(jobId, { routing: { tier: decision.tier, reason: opts.firstBuild ? 'first build' : 'follow-up build' } });

    const policy = toolPolicyFor('build');
    const liveMarkers = new MarkerProcessor();
    let capturedSessionId: string | undefined;

    const handle = runAgent(
      {
        prompt: input.description,
        // F16: pin the agent to the served entrypoint. Nothing else names it (settingSources is
        // empty, §5.4.2), so without this the agent may write a standalone HTML file that is
        // never served while the scaffold keeps being compiled. Flows through runAgent's
        // anonymise path like every prompt (client.ts systemPrompt handling).
        systemPrompt: BUILD_SYSTEM_PROMPT,
        decision,
        allowedTools: policy.allowedTools,
        maxTurns: policy.maxTurns,
        // Builds mount the knowledge tools + the context-loading tool as in-process MCP (§5.4.4).
        sdkTools: [...knowledgeToolSpecs(input.actor), loadContextToolSpec(input.actor, 'coding')],
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

    for await (const ev of handle.events) {
      resetInactivity();
      const clean = liveMarkers.push(ev.text);
      if (clean) sink.text(clean);
    }
    const tail = liveMarkers.end();
    if (tail.text) sink.text(tail.text);
    const result = await handle.result;
    clearTimers();

    if (result.aborted) { await settleAborted(); return; }

    // §5.6.2 completion sequence, step 1: provider-error-as-result reroute (§5.3.7).
    if (scanProviderError(result.text)) { await finishError('ADAPTER_ERROR'); return; }

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
    // pass on a first build; scoped tests + smoke on a follow-up. A stage that did not cleanly
    // pass — a real ran+failed it could not fix, OR an honest not-run (e.g. credential-skip) —
    // surfaces its note on the complete event (billed user_work build-verify inside the runner).
    // Only a real ran+passed adds no note. A not-run is NOT a build failure: the build still
    // completes, just with the honest visible note.
    let verifyNote: string | undefined;
    const verifyEnabled = (await userSettings.get(input.actor.userId))?.build?.verifyBuilds ?? true;
    if (verifyEnabled) {
      sink.planStep('verifying', 'A testar a aplicação...');
      const verdict = await verifyRunner({ artifactId, projectDir, appUrl, userId: input.actor.userId, depth: opts.firstBuild ? 'full' : 'scoped' });
      if (!verdict.passed && verdict.note) verifyNote = verdict.note;
    }

    // Step 6: complete event (bundle error + any unresolved verification failure appended).
    const notes = [bundle.ok ? '' : (bundle.error ?? 'A compilação final falhou.'), verifyNote ?? ''].filter(Boolean).join(' ');
    if (finalizeOnce(jobId)) {
      sink.complete({ result: notes || result.text, artifactId, slug, appUrl }, input.deps.now() - start);
      await patchJob(jobId, { status: 'completed', result: { text: notes || result.text, slug, appUrl }, endedAt: new Date(input.deps.now()).toISOString() });
    }
    terminalReached = true;

    // Step 7: artifact → active with a MERGE onto its data bag (§5.6.2 step 7).
    await mech.activateArtifact({ artifactId, slug, appUrl });
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
