Reading additional input from stdin...
OpenAI Codex v0.142.5
--------
workdir: /Users/ggomes/dev/ekoa-code
model: gpt-5.4
provider: openai
approval: never
sandbox: read-only
reasoning effort: medium
reasoning summaries: none
session id: 019f5cf0-b171-7bb2-a504-e5301a322565
--------
user
Adversarial security re-review in /Users/ggomes/dev/ekoa-code. You earlier flagged 4 issues on H1; the fixes are in commit 49dc5f6 (run: git show 49dc5f6). For EACH, state CLOSED or NOT-CLOSED with file:line, and flag any NEW defect the fix introduced: (1) durable revocation - UserDoc.tokenEpoch+billingLocked persisted and loaded in server.ts loadActivation; every epoch bump (users-service patchUser+migrateBuilderRole, auth/service password-change/reset/deactivate/logoutOther) paired with a users.update in the same op; a restart now rejects a pre-bump token. (2) app-edit vectors - isAppArtifact in apps/app-paths.ts gates import/fork->canBuildApps and bundle-update/file/versions-restore/backend/backups->canEditApps in routes/artifacts.ts, non-app artifacts still user-manageable. (3) TOCTOU - revalidateWritable seam re-checks loadWritable at follow-up execution in agents/build.ts (via seams.ts + build-mechanics.ts). (4) oracle - follow-up gate collapses forbidden->404 in routes/jobs.ts, artifact routes own split untouched. Be concise: a short bullet per finding then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `49dc5f6` against the four H1 findings. I’m checking repo guidance first, then the patch and the touched code paths to verify whether each fix is actually durable or introduced regressions.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "pwd && ls -la && test -d .codegraph && echo CODEGRAPH_YES || echo CODEGRAPH_NO && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'AGENTS.md'" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
/Users/ggomes/dev/ekoa-code
total 1264
drwxr-xr-x@  32 ggomes  staff    1024 Jul 13 16:54 .
drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
drwxr-xr-x@   6 ggomes  staff     192 Jul 13 11:15 .claude
drwxr-xr-x@   9 ggomes  staff     288 Jul 13 20:25 .codegraph
-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
drwxr-xr-x@  16 ggomes  staff     512 Jul 13 19:35 .git
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:59 .githooks
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:55 .github
-rw-r--r--@   1 ggomes  staff    1000 Jul 13 15:43 .gitignore
-rw-r--r--@   1 ggomes  staff     450 Jul  7 02:23 .npmrc
drwxr-xr-x@  56 ggomes  staff    1792 Jul 12 07:34 .playwright-cli
drwxr-xr-x@   6 ggomes  staff     192 Jul 11 22:20 .walkthrough
-rw-r--r--@   1 ggomes  staff    5797 Jul 11 22:20 CLAUDE.md
-rw-r--r--@   1 ggomes  staff    2351 Jul 13 16:54 Dockerfile.api
-rw-r--r--@   1 ggomes  staff    1658 Jul  8 10:24 Dockerfile.web
-rw-r--r--@   1 ggomes  staff   43442 Jul 13 17:13 RUN_LOG.md
drwxr-xr-x@  18 ggomes  staff     576 Jul 13 15:42 api
-rw-r--r--@   1 ggomes  staff       5 Jul  6 22:50 backend.port
drwxr-xr-x@   6 ggomes  staff     192 Jul  8 10:26 deploy
drwxr-xr-x@  17 ggomes  staff     544 Jul 13 17:57 docs
drwxr-xr-x@   3 ggomes  staff      96 Jul  8 09:40 ekoa-data
drwxr-xr-x@ 715 ggomes  staff   22880 Jul 11 15:53 node_modules
-rw-r--r--@   1 ggomes  staff  545459 Jul 11 22:20 package-lock.json
-rw-r--r--@   1 ggomes  staff    1751 Jul  8 04:36 package.json
-rw-r--r--@   1 ggomes  staff    1070 Jul  7 01:01 playwright.config.ts
drwxr-xr-x@  11 ggomes  staff     352 Jul 11 22:20 scripts
drwxr-xr-x@   8 ggomes  staff     256 Jul  6 19:06 shared
drwxr-xr-x@   3 ggomes  staff      96 Jul 12 06:09 test-results
-rw-r--r--@   1 ggomes  staff     429 Jul  6 18:55 tsconfig.base.json
drwxr-xr-x@  24 ggomes  staff     768 Jul 13 02:47 web
CODEGRAPH_YES

exec
/bin/zsh -lc 'git show --stat --oneline --decorate 49dc5f6' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-wuA31YwO' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-S4PBkjqd' (errno=Operation not permitted)
49dc5f6 fix(operator-run/h1): codex security findings 4/4 - (High) durable tokenEpoch+billingLocked persisted on UserDoc and loaded at boot so revocation/lock survive restart (also closes the carried LANDING billingLocked-at-boot finding); (High) isAppArtifact-gated the app build/edit vectors beyond /jobs (import/fork->canBuildApps, bundle-update/file/restore/backend/backups->canEditApps), users keep non-app artifacts; (Med) revalidateWritable seam re-checks ownership at follow-up execution (TOCTOU); (Low) follow-up forbidden collapses to 404 (existence-oracle) local to the gate
 api/src/agents/build.ts                            |  16 +++
 api/src/agents/seams.ts                            |  14 ++
 api/src/apps/app-paths.ts                          |  15 +++
 api/src/apps/build-mechanics.ts                    |  13 +-
 api/src/auth/service.ts                            |  57 ++++++--
 api/src/auth/users-service.ts                      |  13 +-
 api/src/data/stores.ts                             |  10 ++
 api/src/routes/artifacts.ts                        |  39 +++++-
 api/src/routes/jobs.ts                             |   8 +-
 api/src/server.ts                                  |   6 +-
 api/tests/agents/build.test.ts                     |  24 ++++
 api/tests/auth/role-migration.test.ts              |  55 +++++++-
 api/tests/contract/artifacts-capability.test.ts    | 147 +++++++++++++++++++++
 api/tests/contract/jobs-capability.test.ts         |  20 +--
 .../slices/H1/impl-notes.md                        |  40 ++++++
 .../slices/H1/worker-status.txt                    |   1 +
 16 files changed, 448 insertions(+), 30 deletions(-)

codex
The repo is CodeGraph-indexed, so I’m using that plus the patch itself rather than grepping blindly. Next step is to verify each fix at the exact enforcement/load sites and look for any broken pairing or widened access introduced by the patch.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'git show --unified=80 49dc5f6 -- api/src/server.ts api/src/data/stores.ts api/src/auth/service.ts api/src/auth/users-service.ts api/src/apps/app-paths.ts api/src/routes/artifacts.ts api/src/agents/seams.ts api/src/agents/build.ts api/src/apps/build-mechanics.ts api/src/routes/jobs.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-7nO0vK4Z' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-kVp4cglt' (errno=Operation not permitted)
commit 49dc5f6556f80642d691f9c79de2477ff14345ef
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 19:31:33 2026 +0100

    fix(operator-run/h1): codex security findings 4/4 - (High) durable tokenEpoch+billingLocked persisted on UserDoc and loaded at boot so revocation/lock survive restart (also closes the carried LANDING billingLocked-at-boot finding); (High) isAppArtifact-gated the app build/edit vectors beyond /jobs (import/fork->canBuildApps, bundle-update/file/restore/backend/backups->canEditApps), users keep non-app artifacts; (Med) revalidateWritable seam re-checks ownership at follow-up execution (TOCTOU); (Low) follow-up forbidden collapses to 404 (existence-oracle) local to the gate

diff --git a/api/src/agents/build.ts b/api/src/agents/build.ts
index 42ef382..ca1fb00 100644
--- a/api/src/agents/build.ts
+++ b/api/src/agents/build.ts
@@ -246,160 +246,176 @@ const BUILD_SYSTEM_PROMPT = [
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
+      // TOCTOU close (H1 MEDIUM): the create-time writability gate on POST /jobs can be stale by the
+      // time this queued follow-up runs — the owner may have flipped the artifact org→private, or
+      // deleted it, between check and execution. Re-validate writability at USE time (through the
+      // mechanics seam — agents/ reaches apps/ only via the seam, ch02 §2.7) and FAIL the job rather
+      // than resume a code-writing agent against an artifact the actor may no longer write.
+      const writeVerdict = await mech.revalidateWritable(input.actor, artifactId);
+      if (writeVerdict !== 'ok') {
+        clearTimers();
+        if (finalizeOnce(jobId)) {
+          const message = 'Já não tem permissão para alterar esta aplicação.';
+          sink.error('EDIT_FORBIDDEN', message);
+          await patchJob(jobId, { status: 'failed', error: { code: 'EDIT_FORBIDDEN', message }, endedAt: new Date(input.deps.now()).toISOString() });
+        }
+        terminalReached = true;
+        return;
+      }
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
 
     // F1 knowledge-during-build (§5.5.2 knowledge area). The first-build scoping phase runs a
     // DETERMINISTIC domain-heavy detector (no model call, no egress) over the request. A
     // domain-heavy app NARRATES a knowledge request on the build stream (upload reference
     // documents to the org knowledge area) and, when the request carried scoping-provided
     // documents, ingests them into the org knowledge area for THIS run - org-scoped by the run's
     // actor, refused for the reserved _shared partition, and immediately searchable to the
     // knowledge tools mounted below. The ingest IS awaited before the run starts - deliberately,
     // so the docs are searchable to this same run - but it is bounded (doc count/size capped at
     // the contract, count re-capped here) and non-fatal per doc: one bad document neither fails
     // the build nor blocks the remaining documents.
     if (opts.firstBuild) {
       try {
         const scope = detectDomainHeavy(input.description);
         if (scope.domainHeavy) {
           sink.planStep('knowledge-scope', knowledgeScopingNarration(scope.domains));
           const docs = (input.knowledgeDocs ?? []).slice(0, MAX_KNOWLEDGE_DOCS);
           let indexed = 0;
           for (const doc of docs) {
             try {
               const { id } = await ingestBuildKnowledge(
                 input.actor,
                 { collection: doc.collection || 'uploads', title: doc.title, text: doc.text, sourceType: 'build-scoping' },
                 input.deps,
               );
               if (id) indexed++;
             } catch (err) {
               console.warn(`[build] knowledge doc "${doc.title}" not ingested (non-fatal):`, err instanceof Error ? err.message : err);
             }
           }
           // Honest confirmation: partial ingests name the shortfall; an all-failed ingest is
           // narrated too (review-f1 Low: it used to be silent), never pretending success.
           if (indexed > 0) sink.planStep('knowledge-indexed', knowledgeIndexedNarration(indexed, docs.length));
           else if (docs.length > 0) sink.planStep('knowledge-indexed', knowledgeNotIndexedNarration(docs.length));
         }
       } catch (err) {
         console.warn('[build] knowledge scoping failed (non-fatal):', err instanceof Error ? err.message : err);
       }
     }
 
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
diff --git a/api/src/agents/seams.ts b/api/src/agents/seams.ts
index 90808a9..fc98f02 100644
--- a/api/src/agents/seams.ts
+++ b/api/src/agents/seams.ts
@@ -245,146 +245,160 @@ export function getLocalActivitySources(): LocalActivitySources {
   return localActivitySources;
 }
 
 // --- Per-build verification runner (ch05 §5.6.2 step 5, ch07 §7.2.6) ----------------------
 
 export interface VerifyRunInput {
   artifactId: string;
   projectDir: string;
   appUrl: string;
   userId: string;
   /** first build → full acceptance pass; follow-up → scoped tests + smoke pass. */
   depth: 'full' | 'scoped';
   /** The user's build request (F28): the verifier asserts request-FULFILMENT — the served DOM is
    *  not the Ekoa scaffold placeholder and the requested interactive elements exist — not merely
    *  that "something renders". */
   request: string;
   /** Live working-commentary hook: the runner forwards the verify agent's narration chunks so
    *  the build pipeline can stream them to the user (the verify stage used to be a silent
    *  multi-minute void). Raw model text — the CALLER owns marker-filtering + identity redaction. */
   onProgress?: (text: string) => void;
 }
 
 export interface VerifyRunResult {
   ran: boolean;
   /** Only a real ran+passed verification sets this true; a not-run is a distinct non-passing
    *  state (honest not-run, never a fake pass — ch07 §7.2.6). */
   passed: boolean;
   /** The honest user-visible note appended to `complete` when the stage did not cleanly pass —
    *  a failure it could not fix, or an honest not-run (e.g. credential-skip). Never fails the build. */
   note?: string;
 }
 
 /** The playwright-cli medium-depth verification agent (ch07 owns the mechanics). Its model
  *  calls are attributed `user_work` `build-verify` inside the runner (ch06 6.4.1 row A2). */
 export type VerifyRunnerFn = (input: VerifyRunInput) => Promise<VerifyRunResult>;
 const defaultVerifyRunner: VerifyRunnerFn = async () => ({ ran: false, passed: false });
 let verifyRunnerFn: VerifyRunnerFn = defaultVerifyRunner;
 export function setVerifyRunner(fn: VerifyRunnerFn): void {
   verifyRunnerFn = fn;
 }
 export function verifyRunner(input: VerifyRunInput): Promise<VerifyRunResult> {
   return verifyRunnerFn(input);
 }
 
 // --- Build mechanics (ch07 §7.2; the apps/ build pipeline, wired at the root) -------------
 
 export interface FirstBuildPrep {
   artifactId: string;
   projectDir: string;
   slug: string;
   appUrl: string;
   /** Prompt sections of the selected internal base (operator-run B1) — the base's
    *  instructions/skills/layouts markdown, injected into the build system prompt.
    *  Absent when the build scaffolds from the generic starters. */
   basePromptSections?: string[];
 }
 
 export interface FollowUpResolution {
   projectDir: string;
   /** The SDK session id to resume with (§5.4.5). */
   resumeSessionId?: string;
   /** The artifact's existing slug + served URL. Follow-up completion re-activates the artifact
    *  with these — pre-fix, build.ts carried '' through and blanked the slug on every follow-up. */
   slug: string;
   appUrl: string;
   /** Prompt sections of the artifact's base (manifest `extends`, operator-run B1), so
    *  follow-up builds keep the base conventions in the system prompt. Absent when the
    *  artifact extends no base (or the base fails to load — non-fatal, logged). */
   basePromptSections?: string[];
 }
 
 /**
  * The heavy ch07 build mechanics `agents/` invokes but does not own: scaffold + first-build
  * artifact creation, final-bundle, version snapshot, screenshot, artifact activation, and the
  * sdkSessionId persistence. `apps/` implements these at the composition root; the defaults are
  * honest no-ops so the lifecycle + guards are testable without the real esbuild pipeline.
  */
 export interface BuildMechanics {
   prepareFirstBuild(input: { userId: string; sessionId: string; description: string; language: string; templateId?: string }): Promise<FirstBuildPrep>;
   resolveFollowUp(artifactId: string): Promise<FollowUpResolution | null>;
+  /**
+   * Re-validate at EXECUTION time that `actor` may still WRITE `artifactId` (H1 MEDIUM, TOCTOU
+   * close). The create-time gate on `POST /jobs` (loadWritable in routes/) can go stale before a
+   * queued follow-up actually resolves: the owner may flip the artifact org→private, or it may be
+   * deleted, between the check and execution. build.ts calls this immediately before resuming the
+   * follow-up and FAILS the job on a non-`ok` verdict rather than editing an artifact the actor may
+   * no longer write. Kept on the mechanics seam because the ownership rule lives in apps/
+   * (loadWritable) and agents/ reaches apps/ only through this seam (tier direction, ch02 §2.7).
+   * Verdict mirrors loadWritable: 'ok' | 'notfound' | 'forbidden'.
+   */
+  revalidateWritable(actor: Actor, artifactId: string): Promise<'ok' | 'notfound' | 'forbidden'>;
   /** Final bundle (stop watcher, clean, build w/ 2 attempts, validate). Returns an error note on failure. */
   finalizeBundle(input: { artifactId: string; projectDir: string }): Promise<{ ok: boolean; error?: string }>;
   /** Version snapshot through the app repo lock (broken builds snapshotted with a failure tag). */
   snapshot(input: { artifactId: string; projectDir: string; broken: boolean }): Promise<void>;
   /** Fire-and-forget screenshot. */
   screenshot(artifactId: string): void;
   /** Persist sdkSessionId onto the artifact — ONLY when it changed (§5.4.5). */
   persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void>;
   /** Activate the artifact with a MERGE onto its existing data bag (§5.6.2 step 7). */
   activateArtifact(input: { artifactId: string; slug: string; appUrl: string; projectDir?: string }): Promise<void>;
   /** (Re)start the incremental watcher with a rebuild callback — the live-preview heartbeat:
    *  every successful watcher rebuild fires `onRebuild`, which build.ts maps to a
    *  `preview_reload` job event so the client's iframe follows the agent's writes. */
   watchRebuilds(input: { artifactId: string; projectDir: string; onRebuild: () => void }): Promise<void>;
   /**
    * Honest-completion gate (F16, ch05 §5.6.2 step 5a): deterministic evidence the agent's work
    * reached the SERVED surface. NOT clean when the manifest-entrypoint subtree (`frontend/src/`)
    * is unchanged vs the scaffold baseline commit, or the built output still fingerprints as the
    * Ekoa scaffold — especially when an orphan top-level `*.html` was written instead. A gate hit
    * is a distinct non-success terminal in build.ts, never a clean `completed`.
    */
   assertProgress(input: { artifactId: string; projectDir: string }): Promise<{ clean: boolean; reasons: string[] }>;
 }
 
 const noopBuildMechanics: BuildMechanics = {
   async prepareFirstBuild(input) {
     return { artifactId: `art_${input.sessionId}`, projectDir: '', slug: 'app', appUrl: '' };
   },
   async resolveFollowUp() {
     return null;
   },
+  async revalidateWritable() {
+    return 'ok';
+  },
   async finalizeBundle() {
     return { ok: true };
   },
   async snapshot() {},
   screenshot() {},
   async persistSdkSessionId() {},
   async activateArtifact() {},
   async watchRebuilds() {},
   async assertProgress() {
     return { clean: true, reasons: [] };
   },
 };
 let buildMechanics: BuildMechanics = noopBuildMechanics;
 export function setBuildMechanics(fn: BuildMechanics): void {
   buildMechanics = fn;
 }
 export function getBuildMechanics(): BuildMechanics {
   return buildMechanics;
 }
 
 /** Reset every seam to its default (tests). */
 export function __resetAgentSeamsForTests(): void {
   assembleAgentContextFn = defaultAssembleAgentContext;
   knowledgeGroundingFn = defaultKnowledgeGrounding;
   ingestBuildKnowledgeFn = defaultIngestBuildKnowledge;
   knowledgeToolSearchFn = defaultKnowledgeToolSearch;
   knowledgeToolReadFn = defaultKnowledgeToolRead;
   loadContextContentFn = defaultLoadContextContent;
   integrationPrefetchFn = defaultIntegrationPrefetch;
   catalogFn = defaultCatalog;
   delegateToLocalFn = defaultDelegateToLocal;
   localActivitySources = defaultLocalActivitySources;
   verifyRunnerFn = defaultVerifyRunner;
   buildMechanics = noopBuildMechanics;
 }
diff --git a/api/src/apps/app-paths.ts b/api/src/apps/app-paths.ts
index bc8b904..1813c64 100644
--- a/api/src/apps/app-paths.ts
+++ b/api/src/apps/app-paths.ts
@@ -1,126 +1,141 @@
 /**
  * Shared project-directory resolution + artifact ownership helpers for the
  * artifact FAMILY (ch07 §7.9-7.13). Ported from the old `resolveSourceProjectDir`
  * / `projectDirFor` logic (services/artifact-fork.ts, services/artifact-bundle.ts),
  * adapted to the ekoa-code `artifacts` store (ArtifactDoc) and the injected-seam
  * boundaries.
  *
  * A registered app lives at `<sandboxRoot>/user-<userId>/<appId>` unless the row
  * records its own `data.projectDir` (the common case for chat-session builds).
  * A seeded featured artifact serves from `<featuredArtifactDir(id)>/scaffold`.
  */
 import { existsSync } from 'node:fs';
 import { join } from 'node:path';
 import { artifacts } from '../data/stores.js';
 import type { ArtifactDoc } from './artifacts-service.js';
 import type { Actor } from '../data/scoped.js';
 import { resolveWithinJail, sandboxRoot, UnsafePathError } from '../services/safe-path.js';
 import { featuredArtifactDir } from './featured-seeder.js';
 
 const SEEDED_FROM = 'assets/featured-artifacts';
 
 /** The deterministic sandbox layout the registry boot-scan expects — always inside the jail. */
 function defaultProjectDir(art: ArtifactDoc): string {
   return join(sandboxRoot(), `user-${art.userId}`, art._id);
 }
 
 /**
  * The jail-resolved `data.projectDir` a row records, or undefined when absent or escaping.
  * `data` is a client-influenced bag, so NO consumer may read `data.projectDir` raw: resolve it
  * through the owner sandbox jail (ch09 invariant 10, FIXED-8) and drop it if it escapes — never
  * hand back the attacker path. This closes the follow-up build sandbox-escape vector where a
  * PATCHed `data.projectDir` would otherwise become an agent run's cwd/HOME or a build source.
  */
 export function recordedProjectDir(data: Record<string, unknown>): string | undefined {
   const recorded = data.projectDir;
   if (typeof recorded !== 'string' || recorded.length === 0) return undefined;
   try {
     return resolveWithinJail(sandboxRoot(), recorded);
   } catch (err) {
     if (!(err instanceof UnsafePathError)) throw err;
     return undefined;
   }
 }
 
 /** The on-disk working copy for an artifact's source tree (see file header). */
 export function projectDirFor(art: ArtifactDoc): string {
   const data = (art.data ?? {}) as Record<string, unknown>;
   // Seeded featured artifacts serve from the versioned scaffold dir (server-derived, already safe).
   if (art.featured === true && data.seededFrom === SEEDED_FROM) {
     return join(featuredArtifactDir(art._id), 'scaffold');
   }
   // A recorded projectDir wins (session-keyed builds record it explicitly), jail-resolved.
   return recordedProjectDir(data) ?? defaultProjectDir(art);
 }
 
 /** The fresh working-copy dir a NEW artifact (fork/import) owns. */
 export function newProjectDir(ownerUserId: string, appId: string): string {
   return join(sandboxRoot(), `user-${ownerUserId}`, appId);
 }
 
 /** Absolute path to an artifact's built backend bundle, or null when absent. */
 export function backendBundlePath(art: ArtifactDoc): string | null {
   const bundle = join(projectDirFor(art), 'dist-backend', 'backend.mjs');
   return existsSync(bundle) ? bundle : null;
 }
 
+/**
+ * Is this artifact a BUILT app — a code sandbox the app build/edit capabilities govern (H1 HIGH-2)?
+ * The primary, reliable signal is a recorded `data.projectDir`: ONLY an artifact produced by the
+ * build pipeline (`prepareFirstBuild`) carries one — a bare `POST /artifacts` record does not, and
+ * that projectDir is what feeds every code-editing route (`projectDirFor`). The secondary signal is
+ * a stored `data.artifactType === 'app'` (a pre-build row that named its type before a sandbox
+ * existed). An artifact matching NEITHER is a non-app artifact a plain `user` may still manage
+ * (canCreateArtifacts) — the gates below only tighten APP build/edit, never generic artifact CRUD.
+ */
+export function isAppArtifact(art: ArtifactDoc): boolean {
+  const data = (art.data ?? {}) as Record<string, unknown>;
+  if (typeof data.projectDir === 'string' && data.projectDir.length > 0) return true;
+  return data.artifactType === 'app';
+}
+
 export type OwnershipVerdict = 'ok' | 'notfound' | 'forbidden';
 
 /**
  * Load an artifact the actor may READ: own (any visibility) or org-shared. A
  * private row of another user (and any cross-org row) is a uniform not-found
  * (ownership-mismatch parity, ch04). Mirrors OwnerVisibilityScoped.getVisible.
  */
 export async function loadReadable(actor: Actor, id: string): Promise<ArtifactDoc | null> {
   const art = (await artifacts.get(id)) as ArtifactDoc | null;
   if (!art) return null;
   if (art.orgId !== actor.orgId) return null;
   if (art.userId === actor.userId) return art;
   if (art.visibility === 'org') return art;
   return null;
 }
 
 /**
  * Load an artifact the actor may WRITE: own always, org-shared by any org member.
  * A private row of another user → forbidden; a missing/cross-org row → notfound.
  * Mirrors OwnerVisibilityScoped.writeGuard.
  */
 export async function loadWritable(
   actor: Actor,
   id: string,
 ): Promise<{ verdict: OwnershipVerdict; art?: ArtifactDoc }> {
   const art = (await artifacts.get(id)) as ArtifactDoc | null;
   if (!art || art.orgId !== actor.orgId) return { verdict: 'notfound' };
   if (art.userId === actor.userId) return { verdict: 'ok', art };
   if (art.visibility === 'org') return { verdict: 'ok', art };
   return { verdict: 'forbidden', art };
 }
 
 /** Merge a patch into an artifact's `data` bag and persist. */
 export async function patchArtifactData(
   id: string,
   patch: Record<string, unknown>,
 ): Promise<ArtifactDoc | null> {
   return (await artifacts.update(id, (a) => {
     const data = { ...((a.data as Record<string, unknown>) ?? {}), ...patch };
     return { ...a, data };
   })) as ArtifactDoc | null;
 }
 
 /** Cross-org fetch by id (super-admin platform paths only; the route enforces the role). */
 export async function getArtifactById(id: string): Promise<ArtifactDoc | null> {
   return (await artifacts.get(id)) as ArtifactDoc | null;
 }
 
 /** Platform-wide featured toggle + rank (ch07 §7.13; super-admin only, route-enforced). */
 export async function setFeaturedFlag(
   id: string,
   featured: boolean,
   featuredRank?: number,
 ): Promise<ArtifactDoc | null> {
   return (await artifacts.update(id, (a) => ({
     ...a,
     featured,
     ...(featuredRank !== undefined ? { featuredRank } : {}),
   }))) as ArtifactDoc | null;
 }
diff --git a/api/src/apps/build-mechanics.ts b/api/src/apps/build-mechanics.ts
index 51cf596..bc07c23 100644
--- a/api/src/apps/build-mechanics.ts
+++ b/api/src/apps/build-mechanics.ts
@@ -1,109 +1,109 @@
 /**
  * Real build mechanics over the ch07 (G6) app pipeline — the heavy work `agents/` invokes but
  * does not own (ch05 §5.6.2, ch07 §7.2/§7.3/§7.4). Wired at the composition root via
  * `setBuildMechanics`; imported ONLY by server.ts.
  *
  * The shape mirrors the `BuildMechanics` seam in `agents/seams.ts` structurally — this module
  * does NOT import `agents/` (tier direction, ch02 §2.7): the composition root binds the object
  * to the seam, and server.ts's `setBuildMechanics` call is where the shapes are type-checked
  * (the same structural-binding pattern content/ uses for `assembleAgentContext`). apps/ MAY
  * import data/ (store access) — done the way artifacts-service.ts does it.
  */
 import { rm, readFile, readdir } from 'node:fs/promises';
 import { existsSync } from 'node:fs';
 import { join } from 'node:path';
 import { execFile } from 'node:child_process';
 import { promisify } from 'node:util';
 import { artifacts, slugs, users } from '../data/stores.js';
 import { generateSlug, type ArtifactDoc } from './artifacts-service.js';
-import { newProjectDir, projectDirFor, patchArtifactData } from './app-paths.js';
+import { newProjectDir, projectDirFor, patchArtifactData, loadWritable } from './app-paths.js';
 import { indexSlug } from './slug-index.js';
 import { scaffoldApp } from './scaffold.js';
 import { appBuilder, validateBundle } from './builder.js';
 import { appRegistry } from './app-registry.js';
 import { readManifest, writeManifest } from './manifest.js';
 import { loadBase, baseProjectFiles, isBaseId, type LoadedBase } from './base-loader.js';
 import { readUiActions } from './action-manifest.js';
 import { readTours } from './tour-writer.js';
 import { classifyArtifactType, baseForType, typeForBase } from './artifact-type.js';
-import type { ArtifactType } from '@ekoa/shared';
+import type { ArtifactType, Actor } from '@ekoa/shared';
 import { commitSnapshot, SecretCommitError } from '../services/commit-guard.js';
 import { captureArtifactScreenshot } from '../services/artifact-screenshot.js';
 
 export interface BuildMechanicsDeps {
   now: () => number;
   genId: () => string;
 }
 
 const execFileAsync = promisify(execFile);
 
 /** Content fingerprints of the Ekoa scaffold placeholder (assets/scaffold-templates/App.jsx).
  *  A built output still carrying any of these is serving the scaffold, not the user's app. */
 const SCAFFOLD_MARKERS = ['scaffold-root', "Let's build something that will change", 'Powered by Ekoa'] as const;
 
 /**
  * Build the real BuildMechanics over the G6 pipeline. A factory because the mechanics need the
  * runtime `deps` (id + clock) the composition root owns — the same deps every domain router gets.
  */
 export function createBuildMechanics(deps: BuildMechanicsDeps) {
   /** Resolve a user's org (private artifacts still carry orgId for tenancy). Best-effort: an
    *  unresolved user yields '' rather than failing the build. The seam does not thread orgId
    *  (it passes only userId), so the composition root resolves it here — a documented adapter. */
   async function orgIdFor(userId: string): Promise<string> {
     try {
       return (await users.get(userId))?.orgId ?? '';
     } catch {
       return '';
     }
   }
 
   /** First-line-derived app name for the artifact + deterministic slug seed. */
   function deriveAppName(description: string): string {
     const firstLine = (description.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
     return firstLine || 'App';
   }
 
   /**
    * Resolve the internal base + artifact type a first build scaffolds from.
    * B1: an EXPLICIT `templateId` naming a base wins (a known-but-broken base fails
    * LOUD; an unknown id warns and falls through to classification — featured ids
    * also travel this field historically). C1: with no explicit selection, the
    * scoping classifier decides the artifact type (deterministic signals first,
    * FAST chokepoint one-shot on ambiguity, `app` on any failure) and the type's
    * base scaffolds the build. Only a base that fails to LOAD after classification
    * degrades to the generic starters (warned, never silent).
    */
   async function baseFor(
     templateId: string | undefined,
     description: string,
     userId: string,
   ): Promise<{ base: LoadedBase | null; artifactType: ArtifactType }> {
     if (templateId && isBaseId(templateId)) {
       const base = await loadBase(templateId); // explicit selection: broken base fails loud
       return { base, artifactType: typeForBase(base.id) };
     }
     if (templateId) {
       console.warn(`[build-mechanics] templateId "${templateId}" names no internal base; classifying instead`);
     }
     const artifactType = await classifyArtifactType(description, userId);
     try {
       return { base: await loadBase(baseForType(artifactType)), artifactType };
     } catch (err) {
       console.warn(`[build-mechanics] base "${baseForType(artifactType)}" failed to load; generic starters:`, err instanceof Error ? err.message : err);
       return { base: null, artifactType };
     }
   }
 
   /** Load the base an existing artifact extends (manifest `extends`) for follow-up
    *  prompt injection. Non-fatal: a missing/invalid manifest or base yields null. */
   async function baseOfProject(projectDir: string): Promise<LoadedBase | null> {
     try {
       const m = await readManifest(projectDir);
       if (!m?.extends || !isBaseId(m.extends)) return null;
       return await loadBase(m.extends);
     } catch (err) {
       console.warn('[build-mechanics] base of project failed to load (non-fatal):', err instanceof Error ? err.message : err);
       return null;
     }
   }
 
@@ -143,160 +143,169 @@ export function createBuildMechanics(deps: BuildMechanicsDeps) {
       description: string;
       language: string;
       templateId?: string;
     }): Promise<{ artifactId: string; projectDir: string; slug: string; appUrl: string; basePromptSections?: string[] }> {
       const { base, artifactType } = await baseFor(input.templateId, input.description, input.userId);
       const artifactId = deps.genId();
       const name = deriveAppName(input.description);
       const slug = await generateSlug(name, deps);
       // Point the reservation at the new artifact and keep the in-memory serving index current
       // (the same two-step artifacts-service.createArtifact performs, ch07 §7.8).
       await slugs.put({ _id: slug, artifactId });
       indexSlug(slug, artifactId);
 
       const projectDir = newProjectDir(input.userId, artifactId);
       const appUrl = `/apps/${artifactId}/`;
       const orgId = await orgIdFor(input.userId);
 
       const doc: ArtifactDoc = {
         _id: artifactId,
         name,
         slug,
         userId: input.userId,
         orgId,
         visibility: 'private',
         status: 'draft',
         // artifactType (C1): the scoping classifier's verdict — the operator surface
         // exists only for 'app' artifacts (downstream slices read this, never re-classify).
         data: { projectDir, appUrl, sessionId: input.sessionId, artifactType },
       };
       await artifacts.insert(doc as never);
 
       await scaffoldApp({
         appId: artifactId,
         name,
         projectDir,
         description: input.description,
         ...(base ? { templateScaffoldFiles: baseProjectFiles(base) } : {}),
       });
       // Persist the base linkage (manifest `extends`) so follow-up builds and the
       // per-build base-manifest verification know which base this artifact is on.
       if (base) {
         const m = await readManifest(projectDir);
         if (m) {
           m.extends = base.id;
           await writeManifest(projectDir, m);
         }
       }
       // Trigger 1: initial build + watch, before the agent starts. A failure here is non-fatal.
       try {
         await appBuilder.build(artifactId, projectDir);
         await appBuilder.watch(artifactId, projectDir);
       } catch (err) {
         console.warn(`[build-mechanics] ${artifactId}: initial build/watch failed (non-fatal):`, err instanceof Error ? err.message : err);
       }
       await appRegistry.register(artifactId, projectDir, input.userId, name);
 
       return { artifactId, projectDir, slug, appUrl, ...(base ? { basePromptSections: base.promptSections } : {}) };
     },
 
     /** Follow-up resolution (ch05 §5.3.5, §5.4.5): the artifact record → its project dir, the
      *  SDK session id to resume with, and its existing slug + served URL (follow-up completion
      *  re-activates with these — carrying '' through blanked the slug on every follow-up).
      *  Null when the artifact is gone. */
     async resolveFollowUp(artifactId: string): Promise<{ projectDir: string; resumeSessionId?: string; slug: string; appUrl: string; basePromptSections?: string[] } | null> {
       const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
       if (!art) return null;
       const projectDir = projectDirFor(art);
       const data = (art.data as Record<string, unknown> | undefined) ?? {};
       const resumeSessionId = typeof data.sdkSessionId === 'string' ? data.sdkSessionId : undefined;
       const appUrl = typeof data.appUrl === 'string' && data.appUrl ? data.appUrl : `/apps/${artifactId}/`;
       const base = await baseOfProject(projectDir);
       return {
         projectDir,
         ...(resumeSessionId ? { resumeSessionId } : {}),
         slug: art.slug ?? '',
         appUrl,
         ...(base ? { basePromptSections: base.promptSections } : {}),
       };
     },
 
+    /** TOCTOU re-check (H1 MEDIUM): the actor's writability on the target artifact, re-evaluated at
+     *  EXECUTION time. The create-time gate on POST /jobs can go stale before a queued follow-up
+     *  resolves (the owner flips org→private, or deletes the artifact); build.ts calls this right
+     *  before resuming and fails the job on a non-`ok` verdict. Reuses the same loadWritable rule
+     *  the artifact write routes use, so the follow-up build cannot outrun a revoked write. */
+    async revalidateWritable(actor: Actor, artifactId: string): Promise<'ok' | 'notfound' | 'forbidden'> {
+      return (await loadWritable(actor, artifactId)).verdict;
+    },
+
     /**
      * Final bundle (ch05 §5.6.2 step 2, ch07 §7.4 trigger 3): stop the watcher FIRST (concurrent
      * esbuild ops on the shared service crash it), wipe output, then build up to 2 attempts, each
      * validated by the IIFE bundle-format check. Returns an honest error note on failure.
      */
     async finalizeBundle(input: { artifactId: string; projectDir: string }): Promise<{ ok: boolean; error?: string }> {
       await appBuilder.unwatch(input.artifactId);
       const distDir = await distDirOf(input.projectDir);
       let lastError: string | undefined;
       for (let attempt = 1; attempt <= 2; attempt++) {
         await rm(distDir, { recursive: true, force: true });
         const result = await appBuilder.build(input.artifactId, input.projectDir);
         if (!result.success) {
           lastError = result.errors.join('; ') || 'A compilação final falhou.';
           continue;
         }
         const valid = await bundleValid(distDir);
         if (valid.ok) return { ok: true };
         lastError = valid.error ?? 'O pacote final não passou a validação de formato.';
       }
       return { ok: false, error: lastError ?? 'A compilação final falhou.' };
     },
 
     /**
      * Version snapshot (ch05 §5.6.2 step 3, ch07 §7.9) through the shared per-repo lock. A broken
      * final build is committed tagged `[build-failed]` (users may revert FROM a broken version).
      * The secret-commit guard BLOCKS loudly (throws, with an audit row) — that must reach the
      * pipeline; any other git hiccup is best-effort and never fails an otherwise-good build.
      */
     async snapshot(input: { artifactId: string; projectDir: string; broken: boolean }): Promise<void> {
       const art = (await artifacts.get(input.artifactId)) as ArtifactDoc | null;
       const userId = art?.userId ?? '';
       const username = (userId ? (await users.get(userId))?.username : undefined) || userId || 'ekoa-agent';
       try {
         await commitSnapshot({
           projectDir: input.projectDir,
           message: input.broken ? 'Build failed' : 'Build',
           authorName: username,
           authorEmail: `${userId || 'agent'}@ekoa.local`,
           buildFailed: input.broken,
           ...(userId && art
             ? { audit: { actor: { userId, username, orgId: art.orgId }, deps } }
             : {}),
         });
       } catch (err) {
         if (err instanceof SecretCommitError) throw err; // loud block, ch07 §7.9
         console.warn(`[build-mechanics] ${input.artifactId}: version snapshot failed (non-fatal):`, err instanceof Error ? err.message : err);
       }
     },
 
     /** Fire-and-forget screenshot (ch05 §5.6.2 step 8; ch07 §7.11). Same discipline as the
      *  featured-builder capture: never fails the run, EKOA_SCREENSHOTS_DISABLED=1 skips
      *  entirely (headless CI / tests). */
     screenshot(artifactId: string): void {
       if (process.env.EKOA_SCREENSHOTS_DISABLED === '1') return;
       void captureArtifactScreenshot(artifactId).catch((err) => {
         console.warn(
           `[build-mechanics] ${artifactId}: screenshot capture failed (non-fatal):`,
           err instanceof Error ? err.message : err,
         );
       });
     },
 
     /** Persist the SDK session id onto the artifact data bag ONLY when it changed (ch05 §5.4.5). */
     async persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void> {
       const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
       const current = (art?.data as Record<string, unknown> | undefined)?.sdkSessionId;
       if (current === sdkSessionId) return;
       await patchArtifactData(artifactId, { sdkSessionId });
     },
 
     /** (Re)start the incremental watcher with a rebuild callback (ch07 §7.4 trigger 2) — the
      *  live-preview heartbeat: appBuilder.watch is idempotent (disposes any prior context), so
      *  this cleanly replaces the callback-less watcher prepareFirstBuild started, and gives
      *  FOLLOW-UP builds (which historically ran with no watcher at all) a live preview too.
      *  Non-fatal like the initial watch — the final bundle still happens at completion. */
     async watchRebuilds(input: { artifactId: string; projectDir: string; onRebuild: () => void }): Promise<void> {
       try {
         await appBuilder.watch(input.artifactId, input.projectDir, input.onRebuild);
       } catch (err) {
diff --git a/api/src/auth/service.ts b/api/src/auth/service.ts
index 61d7650..1e94e11 100644
--- a/api/src/auth/service.ts
+++ b/api/src/auth/service.ts
@@ -1,193 +1,228 @@
 /**
  * Auth domain services (ch03 §3.8.1/§3.8.2, ch09 §9.7.1). Login, refresh, admin seeding,
  * and the deactivation write-through (the single operation that sets active=false, updates
  * the activation map, and revokes the user's tokens — ch09 §9.7.1).
  */
 import { users, orgs, type UserDoc } from '../data/stores.js';
 import { setActivation, getActivation, bumpTokenEpoch } from '../data/activation.js';
 import { hashPassword, verifyPassword } from './password.js';
 import { signToken, type JwtClaims } from './jwt.js';
 import { revoke } from './revocation.js';
 import { logActivity } from '../data/activity.js';
 
 export interface Deps {
   now: () => number;
   genId: () => string;
 }
 
 export interface AuthUserView {
   id: string;
   username: string;
   role: UserDoc['role'];
   orgId: string;
   active: boolean;
   passwordChangeRequired?: boolean;
 }
 
 function view(u: UserDoc): AuthUserView {
   return {
     id: u._id,
     username: u.username,
     role: u.role,
     orgId: u.orgId,
     active: u.active,
     passwordChangeRequired: u.passwordChangeRequired,
   };
 }
 
 export class AuthError extends Error {
   constructor(public code: string, public status: number, message: string) {
     super(message);
   }
 }
 
 /**
  * The `iat` a freshly-minted session must carry (ch09 §9.6). Epoch bumps invalidate every token
  * with `iat < tokenEpoch`; because JWT `iat` has ONE-SECOND granularity, a login in the same
  * second as a bump (password change, admin reset, admin logout) would be born invalid. Pinning a
  * fresh mint to `max(now, epoch)` keeps every PRE-bump token dead while letting the user in
  * immediately. Only sites that mint after a credential/approval check may use it.
  */
 export function mintIat(userId: string): number {
   const nowSec = Math.floor(Date.now() / 1000);
   return Math.max(nowSec, getActivation(userId)?.tokenEpoch ?? 0);
 }
 
+/**
+ * Bump the token epoch in BOTH planes as one operation (H1 durability): the in-memory activation
+ * map (the fast admission path every request consults — bumped first, so the effect is immediate)
+ * AND the user row (so the epoch survives a restart). Without the row write the epoch reloads as 0
+ * at boot and EVERY revocation — role change, password change/reset, admin logout, deactivation,
+ * the builder→user migration — silently un-revokes its outstanding tokens after the process
+ * restarts. Callers that already touch the row in their own `users.update` fold `tokenEpoch` into
+ * that write instead of calling this; this helper is for the standalone bumps (e.g. admin logout).
+ */
+export async function bumpTokenEpochDurable(userId: string, epochSec: number): Promise<void> {
+  bumpTokenEpoch(userId, epochSec);
+  await users.update(userId, (u) => ({ ...u, tokenEpoch: epochSec }));
+}
+
 /** First-boot super-admin seeding: creates the founder's org + super-admin account if absent. */
 export async function seedAdmin(username: string, password: string, deps: Deps): Promise<void> {
   const existing = await users.find({ role: 'super-admin' });
   if (existing.length > 0) return;
   const orgId = deps.genId();
   await orgs.insert({ _id: orgId, name: 'Founder', displayName: 'Founder', createdAt: new Date(deps.now()).toISOString() });
   const userId = deps.genId();
   await users.insert({
     _id: userId,
     username,
     passwordHash: await hashPassword(password),
     role: 'super-admin',
     orgId,
     active: true,
     passwordChangeRequired: true,
   });
   setActivation(userId, { active: true, billingLocked: false });
 }
 
 export async function login(username: string, password: string, rememberMe: boolean, deps: Deps): Promise<{ token: string; user: AuthUserView; passwordChangeRequired: boolean; expiresIn: number }> {
   const matches = await users.find({ username });
   const u = matches[0];
   if (!u || !(await verifyPassword(password, u.passwordHash))) {
     throw new AuthError('UNAUTHENTICATED', 401, 'Credenciais inválidas.');
   }
   // Deactivated accounts cannot mint a token (ACCOUNT_DISABLED). Check the AUTHORITATIVE
   // store field (login holds the row — no cache-miss window) and sync the write-through
   // map so the middleware is consistent. A billing lock does NOT block login — the account
   // authenticates and is refused per-request at the admission plane (middleware) with
   // BILLING_LOCKED (ch09 §9.7.1); that lock is preserved in the map from its cached value.
   const cached = getActivation(u._id);
-  setActivation(u._id, { active: u.active, billingLocked: cached?.billingLocked ?? false });
+  // Sync the write-through map from the AUTHORITATIVE row (login holds it — no cache-miss window).
+  // Prefer the durable column values (H1: persisted `billingLocked`/`tokenEpoch`) so a lock and a
+  // revocation survive a restart even on a cold cache; fall back to the cached map value, then the
+  // default. The epoch carried here also feeds mintIat below (a pre-bump token stays dead).
+  setActivation(u._id, {
+    active: u.active,
+    billingLocked: u.billingLocked ?? cached?.billingLocked ?? false,
+    tokenEpoch: u.tokenEpoch ?? cached?.tokenEpoch ?? 0,
+  });
   if (!u.active) throw new AuthError('ACCOUNT_DISABLED', 403, 'A sua conta está bloqueada. Contacte o suporte.');
   const { token, expiresIn } = signToken(
     { sub: u._id, role: u.role, scope: 'user', orgId: u.orgId, username: u.username, jti: `${u._id}.${deps.genId()}`, iat: mintIat(u._id) },
     rememberMe,
   );
   // Registo (F3): a login is an org-visible activity — metadata-only, never the password. The
   // single audit write path (FIXED-8); best-effort so a bookkeeping write never fails a login.
   await logActivity({ userId: u._id, username: u.username, orgId: u.orgId }, 'auth', 'login', deps, { rememberMe }).catch(() => undefined);
   return { token, user: view(u), passwordChangeRequired: !!u.passwordChangeRequired, expiresIn };
 }
 
 /**
  * Logout (F1, ch03 §3.8.1). Self: revoke the caller's jti (the middleware checks isRevoked on
  * every request, so the token dies immediately). Admin variant: super-admin anywhere, org-admin
  * scoped to its own org — the target's outstanding jtis are unknown (no per-user jti index), so
  * the target's token EPOCH is bumped, invalidating every outstanding token at once (same
  * mechanism as deactivation, ch09 §9.6). Cross-org for an org-admin reads as 'not-found' — no
  * user enumeration across orgs.
  */
 export async function logoutSelf(claims: JwtClaims, deps: Deps): Promise<void> {
   await revoke(claims.jti, claims.sub, claims.exp ?? Math.floor(deps.now() / 1000) + 24 * 3600, deps.now());
 }
 
 export async function logoutOther(
   caller: Pick<JwtClaims, 'role' | 'orgId'>,
   targetUserId: string,
 ): Promise<'ok' | 'forbidden' | 'not-found'> {
   if (caller.role !== 'super-admin' && caller.role !== 'org-admin') return 'forbidden';
   const target = await users.get(targetUserId);
   if (!target) return 'not-found';
   if (caller.role === 'org-admin' && target.orgId !== caller.orgId) return 'not-found';
   // Epoch shares the JWT iat clock (real seconds), strictly after any token minted this second
-  // (the setUserActive rule): every outstanding token for the target dies at once.
-  bumpTokenEpoch(targetUserId, Math.floor(Date.now() / 1000) + 1);
+  // (the setUserActive rule): every outstanding token for the target dies at once. DURABLE (H1) —
+  // an admin logout that reset to 0 on the next boot would re-admit the very tokens it revoked.
+  await bumpTokenEpochDurable(targetUserId, Math.floor(Date.now() / 1000) + 1);
   return 'ok';
 }
 
 /**
  * Self password change (F1, ch03 §3.8.1): verify the CURRENT password, hash + store the new
  * one, and clear `passwordChangeRequired` (the forced-change flow's exit). Wrong current
  * password is an AuthError 401 — never a silent overwrite.
  */
 export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
   const u = await users.get(userId);
   if (!u) throw new AuthError('UNAUTHENTICATED', 401, 'Sessão expirada. Inicie sessão novamente.');
   if (!(await verifyPassword(currentPassword, u.passwordHash))) {
     throw new AuthError('UNAUTHENTICATED', 401, 'A palavra-passe atual está incorreta.');
   }
   const passwordHash = await hashPassword(newPassword);
-  await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: false }));
+  const epochSec = Math.floor(Date.now() / 1000) + 1;
   // Changing a password invalidates EVERY token minted under the old one — including the caller's
   // (they re-login). A password change is the standard response to a suspected compromise; leaving
   // a stolen token admissible would defeat it. Epoch bump, not a new token scheme (F1 non-goal).
-  bumpTokenEpoch(userId, Math.floor(Date.now() / 1000) + 1);
+  // The epoch is persisted in the SAME store write as the new hash (H1 durability) and mirrored to
+  // the in-memory map, so a restart cannot re-admit a token minted under the old password.
+  await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: false, tokenEpoch: epochSec }));
+  bumpTokenEpoch(userId, epochSec);
 }
 
 /**
  * Admin password reset (F1, shared users.resetPassword): super-admin sets a new password and
  * FORCES a change on next login (`passwordChangeRequired: true`). Returns false when the user
  * does not exist (the router 404s).
  */
 export async function resetPassword(userId: string, newPassword: string): Promise<boolean> {
   const passwordHash = await hashPassword(newPassword);
-  const updated = await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: true }));
-  if (!updated) return false;
+  const epochSec = Math.floor(Date.now() / 1000) + 1;
   // An admin reset is the offboarding / compromised-account lever: the target's outstanding
-  // tokens must die with the old password, not linger to their JWT expiry.
-  bumpTokenEpoch(userId, Math.floor(Date.now() / 1000) + 1);
+  // tokens must die with the old password, not linger to their JWT expiry — and the revocation
+  // must survive a restart (H1), so the epoch is persisted in this SAME store write and mirrored
+  // to the in-memory map below.
+  const updated = await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: true, tokenEpoch: epochSec }));
+  if (!updated) return false;
+  bumpTokenEpoch(userId, epochSec);
   return true;
 }
 
 /**
  * Deactivate a user (ch09 §9.7.1): one operation that (1) sets active=false in the store,
  * (2) updates the write-through activation map synchronously, (3) revokes the user's tokens.
  * `jtisToRevoke` are the user's outstanding token ids known to the caller/session registry.
  */
 export async function setUserActive(
   userId: string,
   active: boolean,
   jtisToRevoke: Array<{ jti: string; expiresAtSec: number }>,
   deps: Deps,
 ): Promise<AuthUserView | null> {
   const cur = getActivation(userId);
   // MAP FIRST, synchronously (ch09 §9.7.1: the toggle updates the map synchronously so the
   // effect is immediate) — this closes the TOCTOU window where a concurrent login between
   // the store write and the cache update could mint a token off the stale cache. On
   // deactivation the token epoch is bumped so EVERY outstanding token is invalidated at once
   // (no per-user jti index needed); any explicitly-known jtis are additionally revoked.
   // The token epoch shares the JWT `iat` clock (real seconds), strictly after any token
   // minted this second, so every outstanding token is invalidated. deps.now drives stored
   // record timestamps; the epoch must track real time to align with jsonwebtoken's iat.
   const epochSec = Math.floor(Date.now() / 1000) + 1;
-  setActivation(userId, { active, billingLocked: cur?.billingLocked ?? false, tokenEpoch: active ? cur?.tokenEpoch ?? 0 : epochSec });
+  // A deactivation bumps the epoch (invalidating every outstanding token); a re-activation keeps
+  // the prior epoch. Both the epoch and the billing lock are persisted to the row in the SAME
+  // operation as `active` (H1 durability), so a deactivation's revocation is not un-done on restart
+  // and a billing lock is not reset to false at boot.
+  const newEpoch = active ? cur?.tokenEpoch ?? 0 : epochSec;
+  const billingLocked = cur?.billingLocked ?? false;
+  setActivation(userId, { active, billingLocked, tokenEpoch: newEpoch });
   if (!active) {
     for (const t of jtisToRevoke) await revoke(t.jti, userId, t.expiresAtSec, deps.now());
   }
-  const updated = await users.update(userId, (u) => ({ ...u, active }));
+  const updated = await users.update(userId, (u) => ({ ...u, active, tokenEpoch: newEpoch, billingLocked }));
   if (!updated) {
     // The user vanished — restore the prior cache entry if we had one to avoid a phantom state.
     if (cur) setActivation(userId, cur);
     return null;
   }
   return view(updated);
 }
 
 export { view as authUserView };
diff --git a/api/src/auth/users-service.ts b/api/src/auth/users-service.ts
index ef9201d..0db0fa5 100644
--- a/api/src/auth/users-service.ts
+++ b/api/src/auth/users-service.ts
@@ -1,98 +1,105 @@
 /**
  * Users-management service (ch03 §3.8.2). Owns the `users`/`orgs` store access for the
  * users router — routes/ never touches data/ directly (ch02 §2.7). super-admin is
  * platform-wide; org-admin is confined to its own org.
  */
 import type { Actor } from '@ekoa/shared';
 import { users, orgs, type UserDoc } from '../data/stores.js';
 import { setActivation, bumpTokenEpoch, clearActivation } from '../data/activation.js';
 import { hashPassword } from './password.js';
 import { setUserActive, authUserView, type AuthUserView, type Deps } from './service.js';
 
 export type { AuthUserView };
 
 export async function listUsers(actor: Actor): Promise<AuthUserView[]> {
   const rows = actor.role === 'super-admin' ? await users.find({}) : await users.find({ orgId: actor.orgId });
   return rows.map(authUserView);
 }
 
 export async function createUser(
   input: { username: string; password: string; role?: UserDoc['role']; orgId?: string },
   deps: Deps,
 ): Promise<{ ok: true; user: AuthUserView } | { ok: false; reason: 'taken' }> {
   let orgId = input.orgId;
   if (!orgId) {
     orgId = deps.genId();
     await orgs.insert({ _id: orgId, name: input.username, createdAt: new Date(deps.now()).toISOString() });
   }
   const id = deps.genId();
   const inserted = await users.insert({
     _id: id,
     username: input.username,
     passwordHash: await hashPassword(input.password),
     // H1: `user` is the base non-admin role and the default when a caller omits one (the HTTP
     // contract still requires `role` via CreateUserRequest; this default protects direct callers).
     role: input.role ?? 'user',
     orgId,
     active: true,
     passwordChangeRequired: true,
   });
   if (!inserted) return { ok: false, reason: 'taken' };
   setActivation(id, { active: true, billingLocked: false });
   return { ok: true, user: authUserView((await users.get(id)) as UserDoc) };
 }
 
 export async function getUser(id: string): Promise<UserDoc | null> {
   return users.get(id);
 }
 
 export async function patchUser(
   actor: Actor,
   target: UserDoc,
   patch: { role?: UserDoc['role']; active?: boolean },
   deps: Deps,
 ): Promise<AuthUserView> {
   if (patch.role && patch.role !== target.role) {
-    await users.update(target._id, (u) => ({ ...u, role: patch.role as UserDoc['role'] }));
     // A role change invalidates the user's outstanding tokens: bump the token epoch (real
     // JWT-iat clock, strictly after any token minted this second) so a demoted admin cannot
     // keep using a stale privileged JWT (ch09 §9.6). The user re-logs in with the new role.
-    bumpTokenEpoch(target._id, Math.floor(Date.now() / 1000) + 1);
+    // The epoch is persisted in the SAME store write as the role and mirrored to the in-memory
+    // map (H1 durability) — without the row write a restart would re-admit the demoted admin's
+    // old org-admin JWT.
+    const epochSec = Math.floor(Date.now() / 1000) + 1;
+    await users.update(target._id, (u) => ({ ...u, role: patch.role as UserDoc['role'], tokenEpoch: epochSec }));
+    bumpTokenEpoch(target._id, epochSec);
   }
   if (patch.active !== undefined) await setUserActive(target._id, patch.active, [], deps);
   return authUserView((await users.get(target._id)) as UserDoc);
 }
 
 /**
  * Delete a user AND drop their activation entry in the same operation (ch09 §9.7.1 write-through).
  * Without the clear, `getActivation` keeps returning the stale `{active:true}` row, so a deleted
  * account's outstanding tokens stay admissible to their JWT expiry — and with `/auth/refresh`
  * mounted (F1) an attacker holding one could re-sign it indefinitely: an unbounded session for a
  * deleted account. Clearing the entry makes every admission plane fail closed immediately.
  */
 export async function deleteUser(id: string): Promise<boolean> {
   const ok = await users.delete(id);
   if (ok) clearActivation(id);
   return ok;
 }
 
 /**
  * H1 role rename `builder` → `user`: an idempotent boot-step migration (the repo has no migration
  * framework — schema/data evolution rides idempotent steps in `bootState`, ch09 §9.7). Every user
  * row still carrying the retired `builder` role is rewritten to `user` and its token epoch bumped,
  * reusing the exact role-change revocation path (`patchUser`): a bumped epoch invalidates every
  * outstanding legacy JWT (its `iat < epoch`), forcing a re-login that mints a `user` token. Runs
  * AFTER `loadActivation` so the epoch bump lands in the freshly-loaded in-memory map. Idempotent:
  * once no row carries `builder`, the query matches nothing and nothing is bumped. Returns the count
  * migrated (0 on a clean/already-migrated store). The `role: 'builder'` filter reads a legacy value
  * no longer in the Role type, so it is a string filter (the store's `find` takes `Record<string,
  * unknown>`); the update writes the current `user` value. */
 export async function migrateBuilderRole(): Promise<number> {
   const legacy = await users.find({ role: 'builder' });
   const epochSec = Math.floor(Date.now() / 1000) + 1;
   for (const u of legacy) {
-    await users.update(u._id, (doc) => ({ ...doc, role: 'user' }));
+    // Persist the rewritten role AND the bumped epoch in one store write (H1 durability): the
+    // legacy-JWT invalidation must survive restart, or a re-boot after the migration would re-admit
+    // outstanding `builder` tokens (their iat < epoch is only enforced while the epoch is loaded).
+    await users.update(u._id, (doc) => ({ ...doc, role: 'user', tokenEpoch: epochSec }));
     bumpTokenEpoch(u._id, epochSec);
   }
   return legacy.length;
 }
diff --git a/api/src/data/stores.ts b/api/src/data/stores.ts
index e4d72f2..1f4ce54 100644
--- a/api/src/data/stores.ts
+++ b/api/src/data/stores.ts
@@ -1,96 +1,106 @@
 /**
  * Platform domain stores (ch04 §4.3.1). Every store is a `Store<T>` over one physical
  * Mongo collection. Names and tenancy carried from the §4.3.1 map. The `teams` store is
  * DROPPED (Amendment 2); the dual app-data backend selector is not carried (§4.2.8) —
  * Firestore Mongo-compat is the only backend.
  */
 import { Store, type Doc } from './store.js';
 
 // --- Core identity / tenancy ---
 export interface UserDoc extends Doc {
   username: string;
   passwordHash: string;
   role: 'super-admin' | 'org-admin' | 'user';
   orgId: string;
   active: boolean;
   passwordChangeRequired?: boolean;
+  /** Durable revocation clock (unix seconds): a token whose `iat` is earlier than this is invalid.
+   *  Bumped on EVERY revocation (role change, password change/reset, admin logout, deactivation, the
+   *  builder→user migration) and written to the row in the SAME operation as the in-memory
+   *  `bumpTokenEpoch`. Persisted here because `loadActivation` reloads the activation map from these
+   *  rows at boot — without the column every revocation silently un-does on the next restart (H1). */
+  tokenEpoch?: number;
+  /** Durable account-level billing lock. Persisted (and boot-reloaded via `loadActivation`) so a
+   *  lock is not reset to `false` on every process restart — the in-memory activation map alone
+   *  defaulted it to `false` at boot (H1; the carried LANDING billing-lock item). */
+  billingLocked?: boolean;
   preferences?: Record<string, unknown>;
 }
 export interface OrgDoc extends Doc {
   name: string;
   displayName?: string;
   branding?: Record<string, unknown>;
   settings?: Record<string, unknown>;
   createdAt: string;
   /** Stamped by updateOrg on every patch — the web's re-sync fingerprint (a branding page left
    *  open must pick up a research merge without a reload; live 2026-07-12). */
   updatedAt?: string;
 }
 export interface CredentialsDoc extends Doc {
   // singleton _id: 'default'
   credentialCiphertext?: string;
   mode: 'oauth' | 'api-key';
   refreshMeta?: Record<string, unknown>;
 }
 export interface RevokedTokenDoc extends Doc {
   userId: string;
   revokedAt: string;
   expiresAt: number; // epoch seconds
 }
 export interface SessionDoc extends Doc {
   userId: string;
   /** Store-side name (ch04 §4.3.1 carries `title`); the wire field is `name` (ch03 §3.8.6). */
   title?: string;
   type?: string;
   artifactId?: string;
   status?: string;
   messageCount?: number;
   createdAt: string;
   updatedAt: string;
 }
 export interface ActivityLogDoc extends Doc {
   userId: string;
   username: string;
   orgId: string;
   category: string;
   type: string;
   timestamp: string;
   metadata?: Record<string, unknown>;
 }
 export interface SettingsDoc extends Doc {
   [k: string]: unknown;
 }
 export interface UserSettingsDoc extends Doc {
   build?: { verifyBuilds?: boolean };
   memory?: { autoExtract?: boolean };
   [k: string]: unknown;
 }
 
 export const users = new Store<UserDoc>('users');
 export const orgs = new Store<OrgDoc>('orgs');
 export const credentials = new Store<CredentialsDoc>('credentials');
 export const revokedTokens = new Store<RevokedTokenDoc>('revoked_tokens');
 export const sessions = new Store<SessionDoc>('sessions');
 export const messages = new Store<Doc>('messages');
 export const sessionContexts = new Store<Doc>('session_contexts');
 export const memories = new Store<Doc>('memories');
 export const artifacts = new Store<Doc>('artifacts');
 export const slugs = new Store<Doc>('slugs');
 export const integrationConfigs = new Store<Doc>('integration_configs');
 /** Integration-builder chat sessions (ch03 §3.8.14). PERSISTED — the old cortex builder kept an
  *  in-memory Map that died on restart; load-by-key durability requires a store. Holds the running
  *  transcript + the last generated package/skill so a session can be reloaded and edited. */
 export const integrationBuilderSessions = new Store<Doc>('integration_builder_sessions');
 export const activityLogs = new Store<ActivityLogDoc>('activity_logs');
 export const jobs = new Store<Doc>('jobs');
 export const settings = new Store<SettingsDoc>('settings');
 export const userSettings = new Store<UserSettingsDoc>('user_settings');
 export const tokenEvents = new Store<Doc>('token_events');
 export const billingAccounts = new Store<Doc>('billing_accounts');
 export const automations = new Store<Doc>('automations');
 export const automationRuns = new Store<Doc>('automation_runs');
 export const approvedCommands = new Store<Doc>('approved_commands');
 export const triggers = new Store<Doc>('triggers');
 export const appSessions = new Store<Doc>('app_sessions');
 export const appSsoPending = new Store<Doc>('app_sso_pending');
 export const adobeAgreements = new Store<Doc>('adobe_agreements');
diff --git a/api/src/routes/artifacts.ts b/api/src/routes/artifacts.ts
index b9d29e6..e218b8d 100644
--- a/api/src/routes/artifacts.ts
+++ b/api/src/routes/artifacts.ts
@@ -1,384 +1,421 @@
 /**
  * Artifacts router (ch03 §3.8.9-3.8.11). CRUD via the apps artifacts-service, plus
  * the artifact FAMILY: fork / export / import / bundle-update / featured-update /
  * featured toggle / files / versions / backups / backend / download / pdf. Single
  * list shape `{ items, featured }` (landmine 7). Thin: validate, call one apps/
  * module, shape the response (CONV-2 error envelope throughout).
  */
 import { Router, type Response } from 'express';
 import {
   ArtifactPatch,
   ImportArtifactRequest,
   BundleUpdateRequest,
   SetFeaturedRequest,
   ReadFileQuery,
   WriteFileRequest,
   BackupPointRef,
   BackendSetEnabledRequest,
   BackendSampleRunRequest,
   PaginationQuery,
 } from '@ekoa/shared';
 import { z } from 'zod';
 import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
 import { can } from '../auth/capabilities.js';
 import { loadConfig } from '../config.js';
 import {
   listArtifacts, createArtifact, getVisibleArtifact, patchArtifact, deleteArtifact,
   artifactView, stripReservedDataKeys, type ArtifactDoc,
 } from '../apps/artifacts-service.js';
 import { actorOf, notFound, sendError, parseBody } from './helpers.js';
 import type { SnapshotAudit } from '../services/commit-guard.js';
 import { SecretCommitError } from '../services/commit-guard.js';
 import type { AppDataDeps } from '../apps/app-data-access.js';
-import { loadReadable, loadWritable, projectDirFor, getArtifactById, setFeaturedFlag } from '../apps/app-paths.js';
+import { loadReadable, loadWritable, projectDirFor, getArtifactById, setFeaturedFlag, isAppArtifact } from '../apps/app-paths.js';
 import { forkArtifact } from '../apps/artifact-fork.js';
 import { exportArtifact, importArtifact, updateArtifactFromBundle, ManifestIdMismatchError } from '../apps/artifact-bundle.js';
 import { applyFeaturedUpdate, ignoreFeaturedUpdate } from '../apps/artifact-featured-update.js';
 import { listVersions, restoreAndRebuild } from '../apps/versions.js';
 import { listArtifactFiles, readArtifactFile, writeArtifactFile, FilePathError } from '../apps/artifact-files.js';
 import { AppDataBackups } from '../apps/backups.js';
 import {
   getArtifactBackendRuntime, readDeclaredBackend, type BackendLogEntry, type InvocationRecord,
 } from '../apps/backend-runtime/index.js';
 import { renderArtifactPdf, isSafePdfBasename } from '../apps/pdf.js';
 import { collectAppFiles, streamFiles, safeZipName } from '../services/app-archive.js';
 
 const CreateArtifact = z.object({ name: z.string(), visibility: z.enum(['private', 'org']).optional() });
 const ForkBody = z.object({ name: z.string().optional() });
 
 export function artifactsRouter(deps: { now: () => number; genId: () => string }): Router {
   const r = Router();
   r.use(requireAuth);
 
   const auditOf = (req: AuthedRequest): SnapshotAudit => ({
     actor: { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId },
     deps: { now: deps.now, genId: deps.genId },
   });
   const appDeps: AppDataDeps = { now: deps.now, genId: deps.genId };
 
   /** Load an artifact the actor may read; write 404 + return null otherwise. */
   async function readable(req: AuthedRequest, res: Response): Promise<ArtifactDoc | null> {
     const art = await loadReadable(actorOf(req), req.params.id as string);
     if (!art) { notFound(res); return null; }
     return art;
   }
   /** Load an artifact the actor may write; write 404/403 + return null otherwise. */
   async function writable(req: AuthedRequest, res: Response): Promise<ArtifactDoc | null> {
     const { verdict, art } = await loadWritable(actorOf(req), req.params.id as string);
     if (verdict === 'notfound') { notFound(res); return null; }
     if (verdict === 'forbidden') { sendError(res, 'FORBIDDEN', 'Sem permissão.'); return null; }
     return art!;
   }
 
+  /**
+   * H1 HIGH-2 app-edit capability gate. `writable()`/ownership passes for an artifact the actor
+   * OWNS — but a plain `user` OWNS the apps they created, so ownership alone lets them change app
+   * CODE (bundle-update, file write, version restore, backend toggle/sample-run, app-data
+   * snapshot/restore). An in-place edit of a BUILT app additionally requires `canEditApps`
+   * (admin-only). NON-app artifacts stay user-manageable (the check is app-type-aware). Returns
+   * true (and writes the FORBIDDEN + details.capability refusal) when the edit is denied.
+   */
+  function denyAppEdit(req: AuthedRequest, res: Response, art: ArtifactDoc): boolean {
+    if (isAppArtifact(art) && !can(actorOf(req), 'canEditApps')) {
+      sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
+      return true;
+    }
+    return false;
+  }
+
   // ---- base CRUD (ch03 §3.8.9) ----
   r.get('/', async (req: AuthedRequest, res: Response) => {
     const { items, featured } = await listArtifacts(actorOf(req));
     res.json({ items: items.map(artifactView), featured: featured.map(artifactView) });
   });
 
   r.post('/', async (req: AuthedRequest, res: Response) => {
     const body = parseBody(res, CreateArtifact, req.body) as { name: string; visibility?: 'private' | 'org' } | undefined;
     if (!body) return;
     // H1 capability gate: creating an artifact requires canCreateArtifacts (held by user +
     // org-admin + super-admin — this is the base "artifacts area" capability, distinct from the
     // app build/edit capabilities). Refusal is the FORBIDDEN envelope + details.capability.
     if (!can(actorOf(req), 'canCreateArtifacts')) {
       return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: 'canCreateArtifacts' });
     }
     res.status(201).json(artifactView(await createArtifact(actorOf(req), body, deps)));
   });
 
   // ---- import must precede GET/:id-style matches (distinct verb+path) ----
   r.post('/import', async (req: AuthedRequest, res: Response) => {
     const body = parseBody(res, ImportArtifactRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle } | undefined;
     if (!body) return;
+    // H1 HIGH-2: a bundle is always an app export; importing it CREATES and BUILDS a new app →
+    // canBuildApps (a plain user cannot import an app the same way they cannot first-build one).
+    if (!can(actorOf(req), 'canBuildApps')) {
+      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
+    }
     const created = await importArtifact(body.bundle, actorOf(req), deps);
     res.status(201).json(artifactView(created));
   });
 
   r.get('/:id', async (req: AuthedRequest, res: Response) => {
     const a = await getVisibleArtifact(actorOf(req), req.params.id as string);
     if (!a) return notFound(res);
     res.json(artifactView(a));
   });
 
   r.patch('/:id', async (req: AuthedRequest, res: Response) => {
     const body = parseBody(res, ArtifactPatch, req.body) as Record<string, unknown> | undefined;
     if (!body) return;
     // Strip server-owned reserved keys (e.g. `projectDir`) from any client `data` at the boundary
     // before they reach the store — a client must never influence the build sandbox path (ch09).
     if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
       body.data = stripReservedDataKeys(body.data as Record<string, unknown>);
     }
     const result = await patchArtifact(actorOf(req), req.params.id as string, body);
     if (result.verdict === 'notfound') return notFound(res);
     if (result.verdict === 'forbidden') {
       if (typeof body.slug === 'string') return sendError(res, 'SLUG_TAKEN', 'Slug já em uso.');
       return sendError(res, 'FORBIDDEN', 'Sem permissão.');
     }
     res.json(artifactView(result.artifact!));
   });
 
   r.delete('/:id', async (req: AuthedRequest, res: Response) => {
     const id = req.params.id as string;
     // Revoke the backend BEFORE removing the row so no queued/in-flight invoke can
     // run against a deleted artifact (C05-20 post-DELETE refusal, B19).
     await getArtifactBackendRuntime().revoke(id);
     const verdict = await deleteArtifact(actorOf(req), id);
     if (verdict === 'notfound') return notFound(res);
     if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
     res.json({ ok: true });
   });
 
   // ---- fork / featured toggle ----
   r.post('/:id/fork', async (req: AuthedRequest, res: Response) => {
     const src = await readable(req, res);
     if (!src) return;
+    // H1 HIGH-2: forking an APP builds a new one → canBuildApps; forking a NON-app artifact is a
+    // plain create → canCreateArtifacts (kept for users). App-type-aware so users still fork the
+    // artifacts they may create, but cannot mint apps.
+    const forkCap = isAppArtifact(src) ? 'canBuildApps' as const : 'canCreateArtifacts' as const;
+    if (!can(actorOf(req), forkCap)) {
+      return sendError(res, 'FORBIDDEN', forkCap === 'canBuildApps'
+        ? 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.'
+        : 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: forkCap });
+    }
     const body = parseBody(res, ForkBody, req.body ?? {}) as { name?: string } | undefined;
     if (!body) return;
     const { artifact } = await forkArtifact(src._id, actorOf(req), deps, body.name);
     res.status(201).json({ id: artifact._id, slug: artifact.slug });
   });
 
   r.put('/:id/featured', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
     const body = parseBody(res, SetFeaturedRequest, req.body) as { featured: boolean; featuredRank?: number } | undefined;
     if (!body) return;
     const existing = await getArtifactById(req.params.id as string);
     if (!existing) return notFound(res);
     const updated = await setFeaturedFlag(req.params.id as string, body.featured, body.featuredRank);
     res.json(artifactView(updated!));
   });
 
   // ---- bundle export / import / update-in-place ----
   r.get('/:id/export', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     res.json(await exportArtifact(art));
   });
 
   r.post('/:id/bundle-update', async (req: AuthedRequest, res: Response) => {
     const art = await writable(req, res);
     if (!art) return;
+    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: in-place app edit → canEditApps
     const body = parseBody(res, BundleUpdateRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle; force?: boolean } | undefined;
     if (!body) return;
     try {
       const result = await updateArtifactFromBundle(
         art, body.bundle,
         { force: body.force, authorName: req.user!.username, audit: auditOf(req), appDeps },
         deps,
       );
       res.json({ artifact: artifactView(result.artifact), safetyNetSnapshotId: result.safetyNetSnapshotId, preUpdateVersionId: result.preUpdateVersionId });
     } catch (err) {
       if (err instanceof ManifestIdMismatchError) return sendError(res, 'MANIFEST_ID_MISMATCH', 'O pacote não corresponde a esta app. Confirme para atualizar mesmo assim.');
       throw err;
     }
   });
 
   r.post('/:id/featured-update/apply', async (req: AuthedRequest, res: Response) => {
     const art = await writable(req, res);
     if (!art) return;
     await applyFeaturedUpdate(art._id, { authorName: req.user!.username, audit: auditOf(req), appDeps });
     res.json({ ok: true });
   });
 
   r.post('/:id/featured-update/ignore', async (req: AuthedRequest, res: Response) => {
     const art = await writable(req, res);
     if (!art) return;
     await ignoreFeaturedUpdate(art._id);
     res.json({ ok: true });
   });
 
   // ---- versions ----
   r.get('/:id/versions', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     const q = PaginationQuery.safeParse(req.query);
     const limit = q.success && q.data.limit ? q.data.limit : 100;
     res.json({ items: await listVersions(projectDirFor(art), limit) });
   });
 
   r.post('/:id/versions/:sha/restore', async (req: AuthedRequest, res: Response) => {
     const art = await writable(req, res);
     if (!art) return;
+    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: restoring app code → canEditApps
     const authorName = req.user!.username;
     const result = await restoreAndRebuild(
       art._id,
       { projectDir: projectDirFor(art), sha: req.params.sha as string, authorName, authorEmail: `${authorName}@ekoa.local` },
       art.name,
     );
     res.json({ newHeadSha: result.newHeadSha });
   });
 
   // ---- files (project-relative, confined server-side; P-15) ----
   r.get('/:id/files', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     const projectDir = projectDirFor(art);
     res.json({ files: await listArtifactFiles(projectDir), projectDir });
   });
 
   r.get('/:id/file', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     const q = ReadFileQuery.safeParse(req.query);
     if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
     try {
       res.json({ content: await readArtifactFile(projectDirFor(art), q.data.path) });
     } catch (err) {
       if (err instanceof FilePathError) return notFound(res);
       throw err;
     }
   });
 
   r.put('/:id/file', async (req: AuthedRequest, res: Response) => {
     const art = await writable(req, res);
     if (!art) return;
+    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: writing app source → canEditApps
     const body = parseBody(res, WriteFileRequest, req.body) as { path: string; content: string } | undefined;
     if (!body) return;
     try {
       const result = await writeArtifactFile(projectDirFor(art), body.path, body.content, req.user!.username, auditOf(req), { appId: art._id, appName: art.name });
       res.json({ path: result.path, size: result.size, committed: result.committed, ...(result.warning ? { warning: result.warning } : {}) });
     } catch (err) {
       if (err instanceof FilePathError) return sendError(res, 'VALIDATION_FAILED', 'Caminho inválido.');
       throw err;
     }
   });
 
   // ---- download (zip; 422 on a planted credential) ----
   r.get('/:id/download', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     const projectDir = projectDirFor(art);
     let files;
     try {
       files = await collectAppFiles(projectDir); // secret-scan BEFORE any bytes go out
     } catch (err) {
       if (err instanceof SecretCommitError) {
         return sendError(res, 'SECRET_GUARD_BLOCKED', 'Descarregamento bloqueado: a app contém uma credencial que tem de ser removida.');
       }
       throw err;
     }
     res.setHeader('Content-Type', 'application/zip');
     res.setHeader('Content-Disposition', `attachment; filename="${safeZipName(art.slug || art.name || 'app')}.zip"`);
     res.setHeader('Cache-Control', 'no-store');
     try {
       await streamFiles(files, res);
     } catch {
       if (!res.headersSent) res.status(500).end();
       else res.destroy();
     }
   });
 
   // ---- pdf (id charset-guarded; it becomes the output basename) ----
   r.get('/:id/pdf', async (req: AuthedRequest, res: Response) => {
     const id = req.params.id as string;
     if (!isSafePdfBasename(id)) return sendError(res, 'VALIDATION_FAILED', 'Identificador inválido.');
     const art = await readable(req, res);
     if (!art) return;
     // Render against the api's OWN loopback origin, NEVER the client-controlled Host header (Codex
     // checkpoint): a spoofed Host would point the server-side render browser at an attacker origin
     // (SSRF + attacker-controlled PDF content). The served-app plane is on this same process.
     const origin = process.env.RENDER_ORIGIN ?? `http://127.0.0.1:${loadConfig().port}`;
     try {
       const result = await renderArtifactPdf({ url: `${origin}/apps/${id}/` }, id);
       res.redirect(302, result.url);
     } catch (err) {
       // Chromium unavailable / render failure - degrade explicitly (ch07 §7.12).
       sendError(res, 'UPSTREAM_UNAVAILABLE', `Não foi possível gerar o PDF: ${err instanceof Error ? err.message : String(err)}`);
     }
   });
 
   // ---- app-data backups (ch03 §3.8.10) ----
   r.get('/:id/backups', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     res.json(new AppDataBackups(appDeps).status(art._id));
   });
 
   r.post('/:id/backups', async (req: AuthedRequest, res: Response) => {
     const art = await writable(req, res);
     if (!art) return;
+    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
     res.json(await new AppDataBackups(appDeps).saveSnapshot(art._id, 'manual'));
   });
 
   r.get('/:id/backups/export', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     res.json(await new AppDataBackups(appDeps).exportAll(art._id));
   });
 
   r.post('/:id/backups/preview', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     const body = parseBody(res, BackupPointRef, req.body) as { pointId: string; source: string; at: string } | undefined;
     if (!body) return;
     try {
       res.json(await new AppDataBackups(appDeps).previewAsOf(art._id, body));
     } catch (err) {
       return sendError(res, 'NOT_FOUND', err instanceof Error ? err.message : 'Ponto de restauro não encontrado.');
     }
   });
 
   r.post('/:id/backups/restore', async (req: AuthedRequest, res: Response) => {
     const art = await writable(req, res);
     if (!art) return;
+    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
     const body = parseBody(res, BackupPointRef, req.body) as { pointId: string; source: string; at: string } | undefined;
     if (!body) return;
     res.json(await new AppDataBackups(appDeps).restoreTo(art._id, body));
   });
 
   // ---- artifact backend (ch03 §3.8.11) ----
   r.get('/:id/backend', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     const declared = await readDeclaredBackend(art);
     const status = getArtifactBackendRuntime().getStatus(art._id);
     res.json({ hasBackend: !!declared, status: status.state, declared: declared ?? null, runtime: status });
   });
 
   r.get('/:id/backend/logs', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     const q = PaginationQuery.safeParse(req.query);
     const limit = q.success && q.data.limit ? q.data.limit : 100;
     res.json({ items: getArtifactBackendRuntime().getRecentLogs(art._id, limit).map(logView) });
   });
 
   r.get('/:id/backend/invocations', async (req: AuthedRequest, res: Response) => {
     const art = await readable(req, res);
     if (!art) return;
     const q = PaginationQuery.safeParse(req.query);
     const limit = q.success && q.data.limit ? q.data.limit : 20;
     res.json({ items: getArtifactBackendRuntime().getInvocations(art._id, limit).map(invocationView) });
   });
 
   r.put('/:id/backend/enabled', async (req: AuthedRequest, res: Response) => {
     const art = await writable(req, res);
     if (!art) return;
+    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: a backend exists only on an app → canEditApps
     const body = parseBody(res, BackendSetEnabledRequest, req.body) as { enabled: boolean } | undefined;
     if (!body) return;
     getArtifactBackendRuntime().setEnabled(art._id, body.enabled);
     res.json({ enabled: body.enabled });
   });
 
   r.post('/:id/backend/sample-run', async (req: AuthedRequest, res: Response) => {
     const art = await writable(req, res);
     if (!art) return;
+    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: invoking an app's backend → canEditApps
     const body = parseBody(res, BackendSampleRunRequest, req.body) as { entrypoint: string; input: unknown } | undefined;
     if (!body) return;
     const declared = await readDeclaredBackend(art);
     const entrypoint = (body.entrypoint || declared?.handlers?.[0] || '').trim();
     if (!entrypoint) return sendError(res, 'VALIDATION_FAILED', 'É necessário um entrypoint (nenhum handler declarado).');
     const result = await getArtifactBackendRuntime().invoke(art._id, entrypoint, body.input, { dryRun: true, invokedBy: 'sample' });
     res.json({ result, ...(result.dryRunEffects ? { dryRunEffects: result.dryRunEffects } : {}) });
   });
 
   return r;
 }
 
 function logView(l: BackendLogEntry) {
   return { at: l.at, level: l.level, message: l.msg, ...(l.meta ? { meta: l.meta } : {}) };
 }
 function invocationView(i: InvocationRecord) {
   return { id: i.invokeId, entrypoint: i.entrypoint, at: i.startedAt, status: i.ok ? 'ok' : 'error', durationMs: i.durationMs };
 }
diff --git a/api/src/routes/jobs.ts b/api/src/routes/jobs.ts
index be6f425..922b9e8 100644
--- a/api/src/routes/jobs.ts
+++ b/api/src/routes/jobs.ts
@@ -1,94 +1,98 @@
 /**
  * Build/brand-research jobs router (ch03 §3.8.8, §3.6.2). `POST /jobs` creates BUILD jobs; the
  * response is `created` (with the job) or `answered` (in-build classifier resolved it, no job) or
  * 409 DUPLICATE_BUILD (a concurrent follow-up on the same artifact). `GET /jobs/:id` serves the
  * persisted record (P-10); events stream over `events/` via ?token=. Routes never touch `data/`.
  */
 import { Router, type Request, type Response } from 'express';
 import { JobCreateRequest } from '@ekoa/shared';
 import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
 import { can } from '../auth/capabilities.js';
 import { loadWritable } from '../apps/app-paths.js';
 import { sseManager } from '../events/sse-manager.js';
 import { handleBuildCreate, cancelRun } from '../agents/index.js';
 import { getJob, jobView } from '../agents/jobs.js';
 import { actorOf, notFound, parseBody, sendError } from './helpers.js';
 
 export function jobsRouter(deps: { now: () => number; genId: () => string }): Router {
   const r = Router();
 
   r.get('/:id/events', async (req: Request, res: Response) => {
     const auth = verifySseToken(req.query.token as string | undefined);
     if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
     const id = req.params.id as string;
     // Ownership check BEFORE attach (Codex checkpoint): a valid SSE token must NOT subscribe to
     // another user's job stream (cross-user event/output leak). Mirrors the guarded GET /:id + the
     // chat SSE route. A missing job attaches (nothing streams); only a foreign OWNED job is refused.
     const job = await getJob(id);
     if (job && job.userId !== auth.claims.sub) {
       return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Sem permissão.' } });
     }
     const lastEventId = req.header('last-event-id');
     sseManager.attach(res, auth.claims.sub, 'job', id, lastEventId ? Number(lastEventId) : undefined);
   });
 
   r.use(requireAuth);
 
   r.post('/', async (req: AuthedRequest, res: Response) => {
     const body = parseBody(res, JobCreateRequest, req.body);
     if (!body) return;
     const actor = actorOf(req);
     // Capability + ownership gates BEFORE any job is created or agent spawned (H1). Refusals carry
     // the FORBIDDEN envelope with `details.capability` (the machine-readable hook the H4
     // request-to-admin flow consumes); object-ownership denials carry no capability field.
     if (body.artifactId) {
       // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
       // target artifact. The writability check (own always; org-shared within org ok; another
       // user's private → 403; missing/cross-org → 404) closes the follow-up-build IDOR (map §5.1),
       // where any authenticated user could drive a code-writing agent against ANY artifact by id.
       // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
       // never leaks whether the target exists.
       if (!can(actor, 'canEditApps')) {
         return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
       }
+      // LOW oracle fix: collapse 'forbidden' (another user's PRIVATE artifact in the same org) into
+      // the SAME 404 as missing/cross-org, LOCAL to the follow-up build gate. A distinct 403 here
+      // is an existence oracle — it lets any canEditApps holder probe whether a private app exists
+      // by id. Security over the H1 brief's 403/404 split (that split stays on the artifact routes,
+      // which may legitimately distinguish); here writability failing for ANY reason reads as 404.
       const { verdict } = await loadWritable(actor, body.artifactId);
-      if (verdict === 'notfound') return notFound(res);
-      if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
+      if (verdict !== 'ok') return notFound(res);
     } else if (!can(actor, 'canBuildApps')) {
       // A first build CREATES an app.
       return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
     }
     const result = await handleBuildCreate({
       actor,
       username: req.user!.username,
       sessionId: body.sessionId,
       description: body.description,
       language: body.language,
       ...(body.templateId ? { templateId: body.templateId } : {}),
       ...(body.integrationKeys ? { integrationKeys: body.integrationKeys } : {}),
       ...(body.artifactId ? { artifactId: body.artifactId } : {}),
       ...(body.attachments ? { attachments: body.attachments } : {}),
       ...(body.fieldValues ? { fieldValues: body.fieldValues } : {}),
       ...(body.configValues ? { configValues: body.configValues } : {}),
       ...(body.knowledgeDocs ? { knowledgeDocs: body.knowledgeDocs } : {}),
       deps,
     });
     if (result.status === 'conflict') return sendError(res, 'DUPLICATE_BUILD', 'Já existe uma construção em curso para esta aplicação.');
     if (result.status === 'answered') return res.status(200).json({ status: 'answered', reason: result.reason });
     res.status(202).json({ status: 'created', job: result.job });
     result.fire();
   });
 
   r.get('/:id', async (req: AuthedRequest, res: Response) => {
     const job = await getJob(req.params.id as string);
     const actor = actorOf(req);
     if (!job || (job.userId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
     res.json(jobView(job));
   });
 
   r.post('/:id/cancel', (req: AuthedRequest, res: Response) => {
     res.json(cancelRun(req.params.id as string, actorOf(req)));
   });
 
   return r;
 }
diff --git a/api/src/server.ts b/api/src/server.ts
index 5629365..456afa1 100644
--- a/api/src/server.ts
+++ b/api/src/server.ts
@@ -599,161 +599,165 @@ export function buildApp(config: Config, deps: RuntimeDeps = defaultDeps): Expre
   // F6: terminal JSON-404 for the platform API. Every non-2xx body must validate against the
   // shared error envelope (QA block); an unmounted /api/v1/* path previously fell through to
   // Express's default HTML 404, so clients that parse JSON got HTML. SCOPED TO /api/v1 on
   // purpose: the served-app data plane (/api/app-data, /api/app-shared), /api/design-tokens.css,
   // /api/m365 and the /apps/* SPA fallbacks own their own not-found behavior. It sits AFTER every
   // /api/v1 router, so a mounted route still answers (a 401 stays a 401, never a 404).
   app.use('/api/v1', (_req: Request, res: Response) => {
     sendError(res, 'NOT_FOUND', 'Não encontrado.');
   });
 
   app.use('/api', servedDataRouter(deps));
   // Served-app assistant (operator-run D1): POST /api/app-assistant, header-scoped, runs under the
   // resolved artifact owner's org + billing through the llm/ chokepoint.
   app.use('/api', appAssistantRouter());
   // Legal vertical services + e-signature (full paths carried inside the routers).
   // The owner-spine seams read/write the app owner's SHARED collections (usr.<owner>)
   // through the collections engine - the same spine the app itself drives via
   // window.__ekoa.shared. legal/ may import data/, but the SCOPE derivation lives at
   // the composition root so the resolver stays the one injected seam.
   const legalEngine = new CollectionsEngine(deps);
   const spineScope = (a: { appId: string; ownerUserId: string }) => sharedScope(a.appId, a.ownerUserId);
   app.use('/', legalRouter({
     resolveApp: resolveAppScope,
     transcricao: {
       getRow: (a, coll, id) => legalEngine.get(spineScope(a), coll, id),
       updateRow: async (a, coll, id, patch) => { await legalEngine.upsert(spineScope(a), coll, id, patch); },
     },
     calculos: {
       getOverlay: (a) => legalEngine.list(spineScope(a), 'tabelas_taxas_overlay').catch(() => []),
       alarmeStore: {
         list: (scope, coll) => legalEngine.list({ scopeKey: scope, appId: scope }, coll),
         create: (scope, coll, data) => legalEngine.create({ scopeKey: scope, appId: scope }, coll, data),
       },
     },
   }));
   app.use('/', adobeSignRouter({ resolveApp: resolveAppScope }));
   app.get('/api/design-tokens.css', designTokensHandler());
   // Served-app document export (ch07 §7.12): window.__ekoa.exportPdf POSTs the serialized DOM
   // here; the rendered PDF is served from /artifact-pdfs below. Was never mounted in the port -
   // every in-app "Descarregar PDF" 404'd (caught live by the per-build verifier, 2026-07-11).
   app.use('/', appPdfRouter());
   mkdirSync(getArtifactPdfDir(), { recursive: true });
   app.use('/artifact-pdfs', express.static(getArtifactPdfDir(), { fallthrough: false }));
   // Artifact thumbnails (ch07 §7.11): PNGs captured post-build, served publicly. The dir is
   // pre-created so a fresh data dir serves clean 404s instead of an ENOENT from static().
   mkdirSync(getArtifactScreenshotDir(), { recursive: true });
   app.use('/artifact-screenshots', express.static(getArtifactScreenshotDir(), { fallthrough: false }));
   // Per-step automation screenshots (ch12): PNGs written per run at <dataDir>/automation-runs/
   // <automationId>/<runId>/step-N.png, served publicly as capability URLs (the unguessable
   // automationId/runId path IS the capability — the run UI renders them via <img>, which cannot
   // carry an Authorization header; decisions.md). Same fallthrough/caching posture as the
   // artifact-thumbnail mount above (express.static's ETag + Last-Modified revalidation keeps a
   // step whose screenshot was overwritten by a same-index retry fresh). Dir pre-created so a fresh
   // data dir serves clean 404s instead of an ENOENT from static().
   mkdirSync(automationRunsRoot(), { recursive: true });
   app.use('/automation-screenshots', express.static(automationRunsRoot(), { fallthrough: false }));
   // Brand-research logos (ch05 §5.6.4): the pipeline downloads + validates the owner's logo and
   // stores it under <dataDir>/brand-assets; served publicly read-only like the artifact
   // thumbnails above (the dashboard renders `/brand-assets/<file>` via <img>). Dir pre-created so
   // a fresh data dir serves clean 404s instead of an ENOENT from static().
   mkdirSync(getBrandAssetsDir(), { recursive: true });
   app.use('/brand-assets', express.static(getBrandAssetsDir(), { fallthrough: false }));
   // Build-share links (ch07 §7.7): fork-per-click.
   app.use('/build', buildLinkRouter({ ...deps, verifyToken }));
   // Serving pipeline (ch07 §7.5-7.7): /apps/:idOrSlug/* + demo-bridge + demos + app-health.
   // The owner-bypass token verifier is injected here (apps/ never imports auth/, ch02 §2.7).
   app.use('/', servingRouter({ verifyToken }));
   // Dev-serve (ch07 §7.4 trigger 6) - hard-off in production-like environments.
   app.use('/', devServeRouter(config.nodeEnv !== 'production'));
 
   return app;
 }
 
 /** Boot the persistence + admission state (ch09 §9.7): connect fail-fast, load the
  *  activation map + revocation set, seed the founder super-admin. Then the apps/
  *  boot obligations (ch07 §7.16): registry scan + slug-index load (parallel block),
  *  featured-artifact seeding + orphan sweep (sequential migrations). */
 export async function bootState(deps: RuntimeDeps = defaultDeps): Promise<void> {
   await connectMongo(); // fail-fast on a bad connection string
   const allUsers = await users.find({});
-  loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active })));
+  // Reload the FULL admission state per user, not just `active` (H1): the durable `tokenEpoch` and
+  // `billingLocked` columns must survive restart, or every revocation and every billing lock resets
+  // at boot (a demoted admin's old JWT re-admits, a locked account re-opens). loadActivation defaults
+  // the two optionals when a legacy row predates the columns.
+  loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active, billingLocked: u.billingLocked, tokenEpoch: u.tokenEpoch })));
   // H1 idempotent migration: rewrite any retired `builder` role → `user` and bump its token epoch
   // (runs after loadActivation so the epoch lands in the in-memory map; no-op once migrated).
   const migratedRoles = await migrateBuilderRole();
   if (migratedRoles > 0) console.log(`[role-migration] builder -> user: ${migratedRoles} user(s) migrated`);
   await loadRevocations(Math.floor(deps.now() / 1000));
   await loadCredential(); // G7: load the central model credential (§6.2; no-op when unconfigured)
 
   // G7B — agent-execution boot obligations (ch08 §8.3.1, ch04 §4.4.1, ch05 §5.2.1). All three are
   // resilient on a fresh/empty data directory: content ingest ensures its dirs, the knowledge
   // backfill ensures the index dir and no-ops on an already-populated index, and the orphan sweep
   // finds nothing to sweep. Ordered after connectMongo (the sweep + backfill read collections).
   await bootContentLoader();
   await backfillKnowledgeIndex();
   await sweepOrphans(deps.now);
 
   const seedUser = process.env.EKOA_ADMIN_USERNAME;
   const seedPass = process.env.EKOA_ADMIN_PASSWORD;
   if (seedUser && seedPass) await seedAdmin(seedUser, seedPass, deps);
 
   // ch07 §7.16 - parallel boot block, then sequential migrations.
   await Promise.all([appRegistry.start(appRegistry.sandboxRoot), loadSlugIndex()]);
   const seeded = await seedFeaturedArtifacts();
   console.log(
     `[featured-seeder] seeded ${seeded.seeded}, refreshed ${seeded.refreshed}, orphans removed ${seeded.orphansRemoved}`,
   );
 }
 
 /** Post-listen, fire-and-forget obligations (ch07 §7.16): featured prebuild. */
 export function bootPostListen(): void {
   void buildAndRegisterFeaturedArtifacts()
     .then((r) => console.log(`[featured-builder] built ${r.built}, skipped ${r.skipped}, failed ${r.failed}, registered ${r.registered}`))
     .catch((err) => console.warn('[featured-builder] prebuild failed:', err instanceof Error ? err.message : err));
 }
 
 /** Boot: validate config (fail-closed), install process guards, start listening. */
 export function boot(): void {
   // Process-level exception posture (carried): log and continue; never crash on a stray throw.
   process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
   process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
 
   const config = loadConfig(); // throws on missing ENCRYPTION_KEY / JWT_SECRET (fail-closed)
   const app = buildApp(config);
   bootState()
     .then(() => {
       const httpServer = app.listen(config.port, () => {
         console.log(`[ekoa-api] listening on :${config.port} (${config.nodeEnv})`);
         bootPostListen();
         // Boot ordering constraint (ch02 §2.6 server.ts row): the trigger delivery pipeline
         // starts only AFTER the HTTP server is listening, so re-entrant deliveries (a run
         // calling back into this server) find a live listener.
         void startDelivery();
       });
       // The live browser canvas media channel (FIXED-2 carve-out, RESOLVED Q-01): a WS
       // upgrade surface on the same HTTP server, short-TTL token auth, 1000/4000 close codes.
       attachCanvasServer(httpServer);
       // The daemon-to-Cortex bridge (ch18 §18.3, outside FIXED-2's frontend rule): the WS server
       // the ekoa-local daemon dials into. Org resolution reads the users store; a ledger row is
       // display metadata only (§18.6, never persisted hosted by default).
       attachBridgeServer(httpServer, {
         resolveUserOrg: async (userId) => ((await users.get(userId)) as { orgId?: string } | null)?.orgId,
         // FC-402 (run s5, D3): ledger rows land in the bounded in-memory per-session buffer
         // the chat pipeline joins per turn — transient display metadata, never persisted.
         onLedgerRow: bufferLedgerRow,
       });
     })
     .catch((err) => {
       console.error('[ekoa-api] boot failed:', err);
       process.exit(1);
     });
 
   // Shutdown obligations (ch07 §7.16): dispose esbuild watch contexts + registry watchers;
   // the delivery pipeline drains in-flight dispatches (the rest recovers next boot, §12.3).
   const shutdown = () => {
     void Promise.allSettled([stopDelivery(), appBuilder.dispose(), appRegistry.stop()]).then(() => process.exit(0));
   };
   process.on('SIGINT', shutdown);
   process.on('SIGTERM', shutdown);
 }
 
 // Boot only when run directly (not when imported by the contract suite's app factory).

exec
/bin/zsh -lc 'codegraph explore "loadActivation tokenEpoch billingLocked patchUser migrateBuilderRole logoutOther password change reset deactivate isAppArtifact canBuildApps canEditApps revalidateWritable loadWritable follow-up forbidden 404 routes/jobs.ts routes/artifacts.ts"' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "find .. -name PRD.md -o -name PLANING.md -o -name TASKS.md | sed 's#"'^#/#'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 1010ms:
## Exploration: loadActivation tokenEpoch billingLocked patchUser migrateBuilderRole logoutOther password change reset deactivate isAppArtifact canBuildApps canEditApps revalidateWritable loadWritable follow-up forbidden 404 routes/jobs.ts routes/artifacts.ts

Found 208 symbols across 99 files.

### Blast radius — what depends on these (update/verify before editing)

- `loadWritable` (api/src/apps/app-paths.ts:103) — 6 callers in `api/src/routes/artifacts.ts`, `api/src/apps/build-mechanics.ts`, `api/src/routes/jobs.ts`; ⚠️ no covering tests found
- `writable` (api/src/routes/artifacts.ts:66) — 1 caller in `api/src/routes/artifacts.ts`; ⚠️ no covering tests found
- `build` (api/src/apps/builder.ts:359) — 3 callers in `api/src/apps/builder.ts`, `api/src/apps/build-mechanics.ts`; ⚠️ no covering tests found
- `ArtifactDoc` (api/src/apps/artifacts-service.ts:12) — 24 callers in `api/src/apps/app-paths.ts`, `api/src/routes/artifacts.ts`, `api/src/apps/build-mechanics.ts`, `api/src/apps/artifacts-service.ts`; tests: `api/tests/apps/tour-writer.test.ts`, `api/tests/apps/build-mechanics.test.ts`, `api/tests/contract/artifact-family.test.ts`

### Relationships

**calls:**
- writable → loadWritable
- createBuildMechanics → loadWritable
- build → buildFrontend
- build → buildBackend
- createBuildMechanics → build
- migrateBuilderRole → find
- logoutOther → bumpTokenEpochDurable
- logoutOther → now
- bootState → loadActivation
- simulateRestart → loadActivation
- ... and 290 more

**references:**
- artifactView → ArtifactDoc
- listArtifacts → ArtifactDoc
- createArtifact → ArtifactDoc
- buildLinkRouter → Router
- integrationBuilderRouter → Router
- integrationsRouter → Router
- artifactsRouter → Router
- jobsRouter → Router
- artifactsRouter → artifactView
- artifactsRouter → invocationView
- ... and 37 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/auth/users-service.ts — migrateBuilderRole(function), patchUser(function)

```typescript
1	/**
2	 * Users-management service (ch03 §3.8.2). Owns the `users`/`orgs` store access for the
3	 * users router — routes/ never touches data/ directly (ch02 §2.7). super-admin is
4	 * platform-wide; org-admin is confined to its own org.
5	 */
6	import type { Actor } from '@ekoa/shared';
7	import { users, orgs, type UserDoc } from '../data/stores.js';
8	import { setActivation, bumpTokenEpoch, clearActivation } from '../data/activation.js';
9	import { hashPassword } from './password.js';
10	import { setUserActive, authUserView, type AuthUserView, type Deps } from './service.js';
11	
12	export type { AuthUserView };
13	
14	export async function listUsers(actor: Actor): Promise<AuthUserView[]> {
15	  const rows = actor.role === 'super-admin' ? await users.find({}) : await users.find({ orgId: actor.orgId });
16	  return rows.map(authUserView);
17	}
18	
19	export async function createUser(
20	  input: { username: string; password: string; role?: UserDoc['role']; orgId?: string },
21	  deps: Deps,
22	): Promise<{ ok: true; user: AuthUserView } | { ok: false; reason: 'taken' }> {
23	  let orgId = input.orgId;
24	  if (!orgId) {
25	    orgId = deps.genId();
26	    await orgs.insert({ _id: orgId, name: input.username, createdAt: new Date(deps.now()).toISOString() });
27	  }
28	  const id = deps.genId();
29	  const inserted = await users.insert({
30	    _id: id,
31	    username: input.username,
32	    passwordHash: await hashPassword(input.password),
33	    // H1: `user` is the base non-admin role and the default when a caller omits one (the HTTP
34	    // contract still requires `role` via CreateUserRequest; this default protects direct callers).
35	    role: input.role ?? 'user',
36	    orgId,
37	    active: true,
38	    passwordChangeRequired: true,
39	  });
40	  if (!inserted) return { ok: false, reason: 'taken' };
41	  setActivation(id, { active: true, billingLocked: false });
42	  return { ok: true, user: authUserView((await users.get(id)) as UserDoc) };
43	}
44	
45	export async function getUser(id: string): Promise<UserDoc | null> {
46	  return users.get(id);
47	}
48	
49	export async function patchUser(
50	  actor: Actor,
51	  target: UserDoc,
52	  patch: { role?: UserDoc['role']; active?: boolean },
53	  deps: Deps,
54	): Promise<AuthUserView> {
55	  if (patch.role && patch.role !== target.role) {
56	    // A role change invalidates the user's outstanding tokens: bump the token epoch (real
57	    // JWT-iat clock, strictly after any token minted this second) so a demoted admin cannot
58	    // keep using a stale privileged JWT (ch09 §9.6). The user re-logs in with the new role.
59	    // The epoch is persisted in the SAME store write as the role and mirrored to the in-memory
60	    // map (H1 durability) — without the row write a restart would re-admit the demoted admin's
61	    // old org-admin JWT.
62	    const epochSec = Math.floor(Date.now() / 1000) + 1;
63	    await users.update(target._id, (u) => ({ ...u, role: patch.role as UserDoc['role'], tokenEpoch: epochSec }));
64	    bumpTokenEpoch(target._id, epochSec);
65	  }
66	  if (patch.active !== undefined) await setUserActive(target._id, patch.active, [], deps);
67	  return authUserView((await users.get(target._id)) as UserDoc);
68	}
69	
70	/**
71	 * Delete a user AND drop their activation entry in the same operation (ch09 §9.7.1 write-through).
72	 * Without the clear, `getActivation` keeps returning the stale `{active:true}` row, so a deleted
73	 * account's outstanding tokens stay admissible to their JWT expiry — and with `/auth/refresh`
74	 * mounted (F1) an attacker holding one could re-sign it indefinitely: an unbounded session for a
75	 * deleted account. Clearing the entry makes every admission plane fail closed immediately.
76	 */
77	export async function deleteUser(id: string): Promise<boolean> {
78	  const ok = await users.delete(id);
79	  if (ok) clearActivation(id);
80	  return ok;
81	}
82	
83	/**
84	 * H1 role rename `builder` → `user`: an idempotent boot-step migration (the repo has no migration
85	 * framework — schema/data evolution rides idempotent steps in `bootState`, ch09 §9.7). Every user
86	 * row still carrying the retired `builder` role is rewritten to `user` and its token epoch bumped,
87	 * reusing the exact role-change revocation path (`patchUser`): a bumped epoch invalidates every
88	 * outstanding legacy JWT (its `iat < epoch`), forcing a re-login that mints a `user` token. Runs
89	 * AFTER `loadActivation` so the epoch bump lands in the freshly-loaded in-memory map. Idempotent:
90	 * once no row carries `builder`, the query matches nothing and nothing is bumped. Returns the count
91	 * migrated (0 on a clean/already-migrated store). The `role: 'builder'` filter reads a legacy value
92	 * no longer in the Role type, so it is a string filter (the store's `find` takes `Record<string,
93	 * unknown>`); the update writes the current `user` value. */
94	export async function migrateBuilderRole(): Promise<number> {
95	  const legacy = await users.find({ role: 'builder' });
96	  const epochSec = Math.floor(Date.now() / 1000) + 1;
97	  for (const u of legacy) {
98	    // Persist the rewritten role AND the bumped epoch in one store write (H1 durability): the
99	    // legacy-JWT invalidation must survive restart, or a re-boot after the migration would re-admit
100	    // outstanding `builder` tokens (their iat < epoch is only enforced while the epoch is loaded).
101	    await users.update(u._id, (doc) => ({ ...doc, role: 'user', tokenEpoch: epochSec }));
102	    bumpTokenEpoch(u._id, epochSec);
103	  }
104	  return legacy.length;
105	}
```

#### api/src/apps/app-paths.ts — loadWritable(function), OwnershipVerdict(type_alias), newProjectDir(function), projectDirFor(function), patchArtifactData(function), isAppArtifact(function), getArtifactById(function), setFeaturedFlag(function), defaultProjectDir(function), backendBundlePath(function), +2 more

```typescript
1	/**
2	 * Shared project-directory resolution + artifact ownership helpers for the
3	 * artifact FAMILY (ch07 §7.9-7.13). Ported from the old `resolveSourceProjectDir`
4	 * / `projectDirFor` logic (services/artifact-fork.ts, services/artifact-bundle.ts),
5	 * adapted to the ekoa-code `artifacts` store (ArtifactDoc) and the injected-seam
6	 * boundaries.
7	 *
8	 * A registered app lives at `<sandboxRoot>/user-<userId>/<appId>` unless the row
9	 * records its own `data.projectDir` (the common case for chat-session builds).
10	 * A seeded featured artifact serves from `<featuredArtifactDir(id)>/scaffold`.
11	 */
12	import { existsSync } from 'node:fs';
13	import { join } from 'node:path';
14	import { artifacts } from '../data/stores.js';
15	import type { ArtifactDoc } from './artifacts-service.js';
16	import type { Actor } from '../data/scoped.js';
17	import { resolveWithinJail, sandboxRoot, UnsafePathError } from '../services/safe-path.js';
18	import { featuredArtifactDir } from './featured-seeder.js';
19	
20	const SEEDED_FROM = 'assets/featured-artifacts';
21	
22	/** The deterministic sandbox layout the registry boot-scan expects — always inside the jail. */
23	function defaultProjectDir(art: ArtifactDoc): string {
24	  return join(sandboxRoot(), `user-${art.userId}`, art._id);
25	}
26	
27	/**
28	 * The jail-resolved `data.projectDir` a row records, or undefined when absent or escaping.
29	 * `data` is a client-influenced bag, so NO consumer may read `data.projectDir` raw: resolve it
30	 * through the owner sandbox jail (ch09 invariant 10, FIXED-8) and drop it if it escapes — never
31	 * hand back the attacker path. This closes the follow-up build sandbox-escape vector where a
32	 * PATCHed `data.projectDir` would otherwise become an agent run's cwd/HOME or a build source.
33	 */
34	export function recordedProjectDir(data: Record<string, unknown>): string | undefined {
35	  const recorded = data.projectDir;
36	  if (typeof recorded !== 'string' || recorded.length === 0) return undefined;
37	  try {
38	    return resolveWithinJail(sandboxRoot(), recorded);
39	  } catch (err) {
40	    if (!(err instanceof UnsafePathError)) throw err;
41	    return undefined;
42	  }
43	}
44	
45	/** The on-disk working copy for an artifact's source tree (see file header). */
46	export function projectDirFor(art: ArtifactDoc): string {
47	  const data = (art.data ?? {}) as Record<string, unknown>;
48	  // Seeded featured artifacts serve from the versioned scaffold dir (server-derived, already safe).
49	  if (art.featured === true && data.seededFrom === SEEDED_FROM) {
50	    return join(featuredArtifactDir(art._id), 'scaffold');
51	  }
52	  // A recorded projectDir wins (session-keyed builds record it explicitly), jail-resolved.
53	  return recordedProjectDir(data) ?? defaultProjectDir(art);
54	}
55	
56	/** The fresh working-copy dir a NEW artifact (fork/import) owns. */
57	export function newProjectDir(ownerUserId: string, appId: string): string {
58	  return join(sandboxRoot(), `user-${ownerUserId}`, appId);
59	}
60	
61	/** Absolute path to an artifact's built backend bundle, or null when absent. */
62	export function backendBundlePath(art: ArtifactDoc): string | null {
63	  const bundle = join(projectDirFor(art), 'dist-backend', 'backend.mjs');
64	  return existsSync(bundle) ? bundle : null;
65	}
66	
67	/**
68	 * Is this artifact a BUILT app — a code sandbox the app build/edit capabilities govern (H1 HIGH-2)?
69	 * The primary, reliable signal is a recorded `data.projectDir`: ONLY an artifact produced by the
70	 * build pipeline (`prepareFirstBuild`) carries one — a bare `POST /artifacts` record does not, and
71	 * that projectDir is what feeds every code-editing route (`projectDirFor`). The secondary signal is
72	 * a stored `data.artifactType === 'app'` (a pre-build row that named its type before a sandbox
73	 * existed). An artifact matching NEITHER is a non-app artifact a plain `user` may still manage
74	 * (canCreateArtifacts) — the gates below only tighten APP build/edit, never generic artifact CRUD.
75	 */
76	export function isAppArtifact(art: ArtifactDoc): boolean {
77	  const data = (art.data ?? {}) as Record<string, unknown>;
78	  if (typeof data.projectDir === 'string' && data.projectDir.length > 0) return true;
79	  return data.artifactType === 'app';
80	}
81	
82	export type OwnershipVerdict = 'ok' | 'notfound' | 'forbidden';
83	
84	/**
85	 * Load an artifact the actor may READ: own (any visibility) or org-shared. A
86	 * private row of another user (and any cross-org row) is a uniform not-found
87	 * (ownership-mismatch parity, ch04). Mirrors OwnerVisibilityScoped.getVisible.
88	 */
89	export async function loadReadable(actor: Actor, id: string): Promise<ArtifactDoc | null> {
90	  const art = (await artifacts.get(id)) as ArtifactDoc | null;
91	  if (!art) return null;
92	  if (art.orgId !== actor.orgId) return null;
93	  if (art.userId === actor.userId) return art;
94	  if (art.visibility === 'org') return art;
95	  return null;
96	}
97	
98	/**
99	 * Load an artifact the actor may WRITE: own always, org-shared by any org member.
100	 * A private row of another user → forbidden; a missing/cross-org row → notfound.
101	 * Mirrors OwnerVisibilityScoped.writeGuard.
102	 */
103	export async function loadWritable(
104	  actor: Actor,
105	  id: string,
106	): Promise<{ verdict: OwnershipVerdict; art?: ArtifactDoc }> {
107	  const art = (await artifacts.get(id)) as ArtifactDoc | null;
108	  if (!art || art.orgId !== actor.orgId) return { verdict: 'notfound' };
109	  if (art.userId === actor.userId) return { verdict: 'ok', art };
110	  if (art.visibility === 'org') return { verdict: 'ok', art };
111	  return { verdict: 'forbidden', art };
112	}
113	
114	/** Merge a patch into an artifact's `data` bag and persist. */
115	export async function patchArtifactData(
116	  id: string,
117	  patch: Record<string, unknown>,
118	): Promise<ArtifactDoc | null> {
119	  return (await artifacts.update(id, (a) => {
120	    const data = { ...((a.data as Record<string, unknown>) ?? {}), ...patch };
121	    return { ...a, data };
122	  })) as ArtifactDoc | null;
123	}
124	
125	/** Cross-org fetch by id (super-admin platform paths only; the route enforces the role). */
126	export async function getArtifactById(id: string): Promise<ArtifactDoc | null> {
127	  return (await artifacts.get(id)) as ArtifactDoc | null;
128	}
129	
130	/** Platform-wide featured toggle + rank (ch07 §7.13; super-admin only, route-enforced). */
131	export async function setFeaturedFlag(
132	  id: string,
133	  featured: boolean,
134	  featuredRank?: number,
135	): Promise<ArtifactDoc | null> {
136	  return (await artifacts.update(id, (a) => ({
137	    ...a,
138	    featured,
139	    ...(featuredRank !== undefined ? { featuredRank } : {}),
140	  }))) as ArtifactDoc | null;
141	}
```

#### api/src/billing/rate-caps.ts — reset(method)

```typescript
1	/**
2	 * Chokepoint rate limits + spend caps (ch06 §6.6.4, FIXED-14; security addendum B.5). Distinct
3	 * from the allowance gate (§6.6.3, a period budget): this is a security control against unbounded
4	 * consumption — per-ORG and per-USER sliding-window call-rate limits and metered-token spend caps,
5	 * with an alert on anomalous burn. It is nearly free here because attribution (§6.3) already
6	 * carries billee + org on every call, so the counters group over data the chokepoint already has.
7	 *
8	 * The window, caps, and burn-alert threshold are config-overridable (env, or per-instance for
9	 * tests) and the clock is injectable. Counters are in-memory sliding windows keyed by billee and
10	 * by org; the chokepoint calls `check()` before admitting a call and `recordSpend()` after it
11	 * completes (with the provider-reported metered total).
12	 */
13	
14	export interface RateCapConfig {
15	  windowMs: number;
16	  maxCallsPerUser: number;
17	  maxCallsPerOrg: number;
18	  maxSpendPerUser: number; // metered tokens per window
19	  maxSpendPerOrg: number; // metered tokens per window
20	  /** Fraction of a cap whose crossing raises a burn alert (0..1). */
21	  burnAlertFraction: number;
22	}
23	
24	export interface RateCapVerdict {
25	  ok: boolean;
26	  reason?: string;
27	  scope?: 'user' | 'org';
28	  kind?: 'rate' | 'spend';
29	}
30	
31	export interface RateCapKey {
32	  billeeUserId: string;
33	  orgId: string;
34	  now?: number;
35	}
36	
37	type BurnAlert = (info: { scope: 'user' | 'org'; kind: 'rate' | 'spend'; key: string; value: number; cap: number }) => void;
38	
39	function num(envName: string, fallback: number): number {
40	  const raw = process.env[envName];
41	  if (raw === undefined || raw === '') return fallback;
42	  const parsed = Number(raw);
43	  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
44	}
45	
46	export function defaultRateCapConfig(): RateCapConfig {
47	  return {
48	    windowMs: num('EKOA_RATECAP_WINDOW_MS', 60_000),
49	    maxCallsPerUser: num('EKOA_RATECAP_CALLS_PER_USER', 60),
50	    maxCallsPerOrg: num('EKOA_RATECAP_CALLS_PER_ORG', 300),
51	    maxSpendPerUser: num('EKOA_RATECAP_SPEND_PER_USER', 5_000_000),
52	    maxSpendPerOrg: num('EKOA_RATECAP_SPEND_PER_ORG', 20_000_000),
53	    burnAlertFraction: num('EKOA_RATECAP_BURN_FRACTION', 0.8),
54	  };
55	}
56	
57	interface WindowEntry {
58	  ts: number;
59	  metered: number;
60	}
61	
62	/** A sliding-window rate + spend limiter. In-memory; the window self-prunes on each touch. */
63	export class RateLimiter {
64	  private readonly cfg: RateCapConfig;
65	  private readonly onBurn: BurnAlert;
66	  private readonly userWindows = new Map<string, WindowEntry[]>();
67	  private readonly orgWindows = new Map<string, WindowEntry[]>();
68	  private readonly alerted = new Set<string>();
69	
70	  constructor(cfg?: Partial<RateCapConfig>, onBurn?: BurnAlert) {
71	    this.cfg = { ...defaultRateCapConfig(), ...cfg };
72	    this.onBurn =
73	      onBurn ??
74	      ((info) =>
75	        console.warn(
76	          `[billing] anomalous burn: ${info.scope}/${info.kind} ${info.key} at ${info.value}/${info.cap}`,
77	        ));
78	  }
79	
80	  private prune(list: WindowEntry[], now: number): WindowEntry[] {
81	    const cutoff = now - this.cfg.windowMs;
82	    return list.filter((e) => e.ts > cutoff);
83	  }
84	
85	  private countAndSpend(list: WindowEntry[]): { count: number; spend: number } {
86	    let spend = 0;
87	    for (const e of list) spend += e.metered;
88	    return { count: list.length, spend };
89	  }
90	
91	  /**
92	   * Pre-admission check (§6.6.4). Returns ok:false with the tripped scope+kind when adding one
93	   * more call would exceed a rate cap, or when the window's metered spend already sits at/above a
94	   * spend cap. Rate is checked against the count BEFORE this call (>= cap ⇒ this call is the
95	   * over-the-line one); spend is checked against accumulated metered tokens.
96	   */
97	  check(key: RateCapKey): RateCapVerdict {
98	    const now = key.now ?? Date.now();
99	    const users = this.prune(this.userWindows.get(key.billeeUserId) ?? [], now);
100	    const orgs = this.prune(this.orgWindows.get(key.orgId) ?? [], now);
101	    this.userWindows.set(key.billeeUserId, users);
102	    this.orgWindows.set(key.orgId, orgs);
103	
104	    const u = this.countAndSpend(users);
105	    const o = this.countAndSpend(orgs);
106	
107	    if (u.count >= this.cfg.maxCallsPerUser) return { ok: false, scope: 'user', kind: 'rate', reason: 'per-user call rate exceeded' };
108	    if (o.count >= this.cfg.maxCallsPerOrg) return { ok: false, scope: 'org', kind: 'rate', reason: 'per-org call rate exceeded' };
109	    if (u.spend >= this.cfg.maxSpendPerUser) return { ok: false, scope: 'user', kind: 'spend', reason: 'per-user spend cap exceeded' };
110	    if (o.spend >= this.cfg.maxSpendPerOrg) return { ok: false, scope: 'org', kind: 'spend', reason: 'per-org spend cap exceeded' };
111	    return { ok: true };
112	  }
113	
114	  /**
115	   * Record a completed call's metered spend into both windows (§6.6.4). Call after the chokepoint
116	   * meters the provider-reported usage. Raises a burn alert once per window-key when usage crosses
117	   * `burnAlertFraction` of a cap.
118	   */
119	  recordSpend(key: RateCapKey & { metered: number }): void {
120	    const now = key.now ?? Date.now();
121	    const users = this.prune(this.userWindows.get(key.billeeUserId) ?? [], now);
122	    const orgs = this.prune(this.orgWindows.get(key.orgId) ?? [], now);
123	    users.push({ ts: now, metered: key.metered });
124	    orgs.push({ ts: now, metered: key.metered });
125	    this.userWindows.set(key.billeeUserId, users);
126	    this.orgWindows.set(key.orgId, orgs);
127	
128	    const u = this.countAndSpend(users);
129	    const o = this.countAndSpend(orgs);
130	    this.maybeAlert('user', 'rate', key.billeeUserId, u.count, this.cfg.maxCallsPerUser);
131	    this.maybeAlert('org', 'rate', key.orgId, o.count, this.cfg.maxCallsPerOrg);
132	    this.maybeAlert('user', 'spend', key.billeeUserId, u.spend, this.cfg.maxSpendPerUser);
133	    this.maybeAlert('org', 'spend', key.orgId, o.spend, this.cfg.maxSpendPerOrg);
134	  }
135	
136	  private maybeAlert(scope: 'user' | 'org', kind: 'rate' | 'spend', key: string, value: number, cap: number): void {
137	    if (cap <= 0) return;
138	    const alertKey = `${scope}:${kind}:${key}`;
139	    if (value >= cap * this.cfg.burnAlertFraction) {
140	      if (!this.alerted.has(alertKey)) {
141	        this.alerted.add(alertKey);
142	        this.onBurn({ scope, kind, key, value, cap });
143	      }
144	    } else {
145	      this.alerted.delete(alertKey);
146	    }
147	  }
148	
149	  reset(): void {
150	    this.userWindows.clear();
151	    this.orgWindows.clear();
152	    this.alerted.clear();
153	  }
154	}
155	
156	// The default process-wide limiter the chokepoint uses.
157	let defaultLimiter = new RateLimiter();
158	export function checkRateCaps(key: RateCapKey): RateCapVerdict {
159	  return defaultLimiter.check(key);
160	}
161	export function recordSpend(key: RateCapKey & { metered: number }): void {
162	  defaultLimiter.recordSpend(key);
163	}
164	export function __resetRateCapsForTests(): void {
165	  defaultLimiter = new RateLimiter();
166	}
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I have the patch context. I’m pulling exact current line numbers now so the verdict can cite the live enforcement points rather than the diff hunk offsets.
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/src/server.ts | sed -n '748,790p'
nl -ba api/src/auth/users-service.ts | sed -n '49,110p'
nl -ba api/src/auth/service.ts | sed -n '1,260p'
nl -ba api/src/data/stores.ts | sed -n '1,220p'
nl -ba api/src/apps/app-paths.ts | sed -n '67,125p'
nl -ba api/src/routes/artifacts.ts | sed -n '1,260p'
nl -ba api/src/routes/jobs.ts | sed -n '35,75p'
nl -ba api/src/agents/build.ts | sed -n '295,345p'
nl -ba api/src/agents/seams.ts | sed -n '300,360p'
nl -ba api/src/apps/build-mechanics.ts | sed -n '1,220p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   748	    })
   749	    .catch((err) => {
   750	      console.error('[ekoa-api] boot failed:', err);
   751	      process.exit(1);
   752	    });
   753	
   754	  // Shutdown obligations (ch07 §7.16): dispose esbuild watch contexts + registry watchers;
   755	  // the delivery pipeline drains in-flight dispatches (the rest recovers next boot, §12.3).
   756	  const shutdown = () => {
   757	    void Promise.allSettled([stopDelivery(), appBuilder.dispose(), appRegistry.stop()]).then(() => process.exit(0));
   758	  };
   759	  process.on('SIGINT', shutdown);
   760	  process.on('SIGTERM', shutdown);
   761	}
   762	
   763	// Boot only when run directly (not when imported by the contract suite's app factory).
   764	// Use pathToFileURL so the comparison holds under paths with spaces/non-ASCII chars and
   765	// percent-encoding — a naive `file://${argv[1]}` would silently mismatch and never boot.
   766	if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
   767	  boot();
   768	}
    49	export async function patchUser(
    50	  actor: Actor,
    51	  target: UserDoc,
    52	  patch: { role?: UserDoc['role']; active?: boolean },
    53	  deps: Deps,
    54	): Promise<AuthUserView> {
    55	  if (patch.role && patch.role !== target.role) {
    56	    // A role change invalidates the user's outstanding tokens: bump the token epoch (real
    57	    // JWT-iat clock, strictly after any token minted this second) so a demoted admin cannot
    58	    // keep using a stale privileged JWT (ch09 §9.6). The user re-logs in with the new role.
    59	    // The epoch is persisted in the SAME store write as the role and mirrored to the in-memory
    60	    // map (H1 durability) — without the row write a restart would re-admit the demoted admin's
    61	    // old org-admin JWT.
    62	    const epochSec = Math.floor(Date.now() / 1000) + 1;
    63	    await users.update(target._id, (u) => ({ ...u, role: patch.role as UserDoc['role'], tokenEpoch: epochSec }));
    64	    bumpTokenEpoch(target._id, epochSec);
    65	  }
    66	  if (patch.active !== undefined) await setUserActive(target._id, patch.active, [], deps);
    67	  return authUserView((await users.get(target._id)) as UserDoc);
    68	}
    69	
    70	/**
    71	 * Delete a user AND drop their activation entry in the same operation (ch09 §9.7.1 write-through).
    72	 * Without the clear, `getActivation` keeps returning the stale `{active:true}` row, so a deleted
    73	 * account's outstanding tokens stay admissible to their JWT expiry — and with `/auth/refresh`
    74	 * mounted (F1) an attacker holding one could re-sign it indefinitely: an unbounded session for a
    75	 * deleted account. Clearing the entry makes every admission plane fail closed immediately.
    76	 */
    77	export async function deleteUser(id: string): Promise<boolean> {
    78	  const ok = await users.delete(id);
    79	  if (ok) clearActivation(id);
    80	  return ok;
    81	}
    82	
    83	/**
    84	 * H1 role rename `builder` → `user`: an idempotent boot-step migration (the repo has no migration
    85	 * framework — schema/data evolution rides idempotent steps in `bootState`, ch09 §9.7). Every user
    86	 * row still carrying the retired `builder` role is rewritten to `user` and its token epoch bumped,
    87	 * reusing the exact role-change revocation path (`patchUser`): a bumped epoch invalidates every
    88	 * outstanding legacy JWT (its `iat < epoch`), forcing a re-login that mints a `user` token. Runs
    89	 * AFTER `loadActivation` so the epoch bump lands in the freshly-loaded in-memory map. Idempotent:
    90	 * once no row carries `builder`, the query matches nothing and nothing is bumped. Returns the count
    91	 * migrated (0 on a clean/already-migrated store). The `role: 'builder'` filter reads a legacy value
    92	 * no longer in the Role type, so it is a string filter (the store's `find` takes `Record<string,
    93	 * unknown>`); the update writes the current `user` value. */
    94	export async function migrateBuilderRole(): Promise<number> {
    95	  const legacy = await users.find({ role: 'builder' });
    96	  const epochSec = Math.floor(Date.now() / 1000) + 1;
    97	  for (const u of legacy) {
    98	    // Persist the rewritten role AND the bumped epoch in one store write (H1 durability): the
    99	    // legacy-JWT invalidation must survive restart, or a re-boot after the migration would re-admit
   100	    // outstanding `builder` tokens (their iat < epoch is only enforced while the epoch is loaded).
   101	    await users.update(u._id, (doc) => ({ ...doc, role: 'user', tokenEpoch: epochSec }));
   102	    bumpTokenEpoch(u._id, epochSec);
   103	  }
   104	  return legacy.length;
   105	}
     1	/**
     2	 * Auth domain services (ch03 §3.8.1/§3.8.2, ch09 §9.7.1). Login, refresh, admin seeding,
     3	 * and the deactivation write-through (the single operation that sets active=false, updates
     4	 * the activation map, and revokes the user's tokens — ch09 §9.7.1).
     5	 */
     6	import { users, orgs, type UserDoc } from '../data/stores.js';
     7	import { setActivation, getActivation, bumpTokenEpoch } from '../data/activation.js';
     8	import { hashPassword, verifyPassword } from './password.js';
     9	import { signToken, type JwtClaims } from './jwt.js';
    10	import { revoke } from './revocation.js';
    11	import { logActivity } from '../data/activity.js';
    12	
    13	export interface Deps {
    14	  now: () => number;
    15	  genId: () => string;
    16	}
    17	
    18	export interface AuthUserView {
    19	  id: string;
    20	  username: string;
    21	  role: UserDoc['role'];
    22	  orgId: string;
    23	  active: boolean;
    24	  passwordChangeRequired?: boolean;
    25	}
    26	
    27	function view(u: UserDoc): AuthUserView {
    28	  return {
    29	    id: u._id,
    30	    username: u.username,
    31	    role: u.role,
    32	    orgId: u.orgId,
    33	    active: u.active,
    34	    passwordChangeRequired: u.passwordChangeRequired,
    35	  };
    36	}
    37	
    38	export class AuthError extends Error {
    39	  constructor(public code: string, public status: number, message: string) {
    40	    super(message);
    41	  }
    42	}
    43	
    44	/**
    45	 * The `iat` a freshly-minted session must carry (ch09 §9.6). Epoch bumps invalidate every token
    46	 * with `iat < tokenEpoch`; because JWT `iat` has ONE-SECOND granularity, a login in the same
    47	 * second as a bump (password change, admin reset, admin logout) would be born invalid. Pinning a
    48	 * fresh mint to `max(now, epoch)` keeps every PRE-bump token dead while letting the user in
    49	 * immediately. Only sites that mint after a credential/approval check may use it.
    50	 */
    51	export function mintIat(userId: string): number {
    52	  const nowSec = Math.floor(Date.now() / 1000);
    53	  return Math.max(nowSec, getActivation(userId)?.tokenEpoch ?? 0);
    54	}
    55	
    56	/**
    57	 * Bump the token epoch in BOTH planes as one operation (H1 durability): the in-memory activation
    58	 * map (the fast admission path every request consults — bumped first, so the effect is immediate)
    59	 * AND the user row (so the epoch survives a restart). Without the row write the epoch reloads as 0
    60	 * at boot and EVERY revocation — role change, password change/reset, admin logout, deactivation,
    61	 * the builder→user migration — silently un-revokes its outstanding tokens after the process
    62	 * restarts. Callers that already touch the row in their own `users.update` fold `tokenEpoch` into
    63	 * that write instead of calling this; this helper is for the standalone bumps (e.g. admin logout).
    64	 */
    65	export async function bumpTokenEpochDurable(userId: string, epochSec: number): Promise<void> {
    66	  bumpTokenEpoch(userId, epochSec);
    67	  await users.update(userId, (u) => ({ ...u, tokenEpoch: epochSec }));
    68	}
    69	
    70	/** First-boot super-admin seeding: creates the founder's org + super-admin account if absent. */
    71	export async function seedAdmin(username: string, password: string, deps: Deps): Promise<void> {
    72	  const existing = await users.find({ role: 'super-admin' });
    73	  if (existing.length > 0) return;
    74	  const orgId = deps.genId();
    75	  await orgs.insert({ _id: orgId, name: 'Founder', displayName: 'Founder', createdAt: new Date(deps.now()).toISOString() });
    76	  const userId = deps.genId();
    77	  await users.insert({
    78	    _id: userId,
    79	    username,
    80	    passwordHash: await hashPassword(password),
    81	    role: 'super-admin',
    82	    orgId,
    83	    active: true,
    84	    passwordChangeRequired: true,
    85	  });
    86	  setActivation(userId, { active: true, billingLocked: false });
    87	}
    88	
    89	export async function login(username: string, password: string, rememberMe: boolean, deps: Deps): Promise<{ token: string; user: AuthUserView; passwordChangeRequired: boolean; expiresIn: number }> {
    90	  const matches = await users.find({ username });
    91	  const u = matches[0];
    92	  if (!u || !(await verifyPassword(password, u.passwordHash))) {
    93	    throw new AuthError('UNAUTHENTICATED', 401, 'Credenciais inválidas.');
    94	  }
    95	  // Deactivated accounts cannot mint a token (ACCOUNT_DISABLED). Check the AUTHORITATIVE
    96	  // store field (login holds the row — no cache-miss window) and sync the write-through
    97	  // map so the middleware is consistent. A billing lock does NOT block login — the account
    98	  // authenticates and is refused per-request at the admission plane (middleware) with
    99	  // BILLING_LOCKED (ch09 §9.7.1); that lock is preserved in the map from its cached value.
   100	  const cached = getActivation(u._id);
   101	  // Sync the write-through map from the AUTHORITATIVE row (login holds it — no cache-miss window).
   102	  // Prefer the durable column values (H1: persisted `billingLocked`/`tokenEpoch`) so a lock and a
   103	  // revocation survive a restart even on a cold cache; fall back to the cached map value, then the
   104	  // default. The epoch carried here also feeds mintIat below (a pre-bump token stays dead).
   105	  setActivation(u._id, {
   106	    active: u.active,
   107	    billingLocked: u.billingLocked ?? cached?.billingLocked ?? false,
   108	    tokenEpoch: u.tokenEpoch ?? cached?.tokenEpoch ?? 0,
   109	  });
   110	  if (!u.active) throw new AuthError('ACCOUNT_DISABLED', 403, 'A sua conta está bloqueada. Contacte o suporte.');
   111	  const { token, expiresIn } = signToken(
   112	    { sub: u._id, role: u.role, scope: 'user', orgId: u.orgId, username: u.username, jti: `${u._id}.${deps.genId()}`, iat: mintIat(u._id) },
   113	    rememberMe,
   114	  );
   115	  // Registo (F3): a login is an org-visible activity — metadata-only, never the password. The
   116	  // single audit write path (FIXED-8); best-effort so a bookkeeping write never fails a login.
   117	  await logActivity({ userId: u._id, username: u.username, orgId: u.orgId }, 'auth', 'login', deps, { rememberMe }).catch(() => undefined);
   118	  return { token, user: view(u), passwordChangeRequired: !!u.passwordChangeRequired, expiresIn };
   119	}
   120	
   121	/**
   122	 * Logout (F1, ch03 §3.8.1). Self: revoke the caller's jti (the middleware checks isRevoked on
   123	 * every request, so the token dies immediately). Admin variant: super-admin anywhere, org-admin
   124	 * scoped to its own org — the target's outstanding jtis are unknown (no per-user jti index), so
   125	 * the target's token EPOCH is bumped, invalidating every outstanding token at once (same
   126	 * mechanism as deactivation, ch09 §9.6). Cross-org for an org-admin reads as 'not-found' — no
   127	 * user enumeration across orgs.
   128	 */
   129	export async function logoutSelf(claims: JwtClaims, deps: Deps): Promise<void> {
   130	  await revoke(claims.jti, claims.sub, claims.exp ?? Math.floor(deps.now() / 1000) + 24 * 3600, deps.now());
   131	}
   132	
   133	export async function logoutOther(
   134	  caller: Pick<JwtClaims, 'role' | 'orgId'>,
   135	  targetUserId: string,
   136	): Promise<'ok' | 'forbidden' | 'not-found'> {
   137	  if (caller.role !== 'super-admin' && caller.role !== 'org-admin') return 'forbidden';
   138	  const target = await users.get(targetUserId);
   139	  if (!target) return 'not-found';
   140	  if (caller.role === 'org-admin' && target.orgId !== caller.orgId) return 'not-found';
   141	  // Epoch shares the JWT iat clock (real seconds), strictly after any token minted this second
   142	  // (the setUserActive rule): every outstanding token for the target dies at once. DURABLE (H1) —
   143	  // an admin logout that reset to 0 on the next boot would re-admit the very tokens it revoked.
   144	  await bumpTokenEpochDurable(targetUserId, Math.floor(Date.now() / 1000) + 1);
   145	  return 'ok';
   146	}
   147	
   148	/**
   149	 * Self password change (F1, ch03 §3.8.1): verify the CURRENT password, hash + store the new
   150	 * one, and clear `passwordChangeRequired` (the forced-change flow's exit). Wrong current
   151	 * password is an AuthError 401 — never a silent overwrite.
   152	 */
   153	export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
   154	  const u = await users.get(userId);
   155	  if (!u) throw new AuthError('UNAUTHENTICATED', 401, 'Sessão expirada. Inicie sessão novamente.');
   156	  if (!(await verifyPassword(currentPassword, u.passwordHash))) {
   157	    throw new AuthError('UNAUTHENTICATED', 401, 'A palavra-passe atual está incorreta.');
   158	  }
   159	  const passwordHash = await hashPassword(newPassword);
   160	  const epochSec = Math.floor(Date.now() / 1000) + 1;
   161	  // Changing a password invalidates EVERY token minted under the old one — including the caller's
   162	  // (they re-login). A password change is the standard response to a suspected compromise; leaving
   163	  // a stolen token admissible would defeat it. Epoch bump, not a new token scheme (F1 non-goal).
   164	  // The epoch is persisted in the SAME store write as the new hash (H1 durability) and mirrored to
   165	  // the in-memory map, so a restart cannot re-admit a token minted under the old password.
   166	  await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: false, tokenEpoch: epochSec }));
   167	  bumpTokenEpoch(userId, epochSec);
   168	}
   169	
   170	/**
   171	 * Admin password reset (F1, shared users.resetPassword): super-admin sets a new password and
   172	 * FORCES a change on next login (`passwordChangeRequired: true`). Returns false when the user
   173	 * does not exist (the router 404s).
   174	 */
   175	export async function resetPassword(userId: string, newPassword: string): Promise<boolean> {
   176	  const passwordHash = await hashPassword(newPassword);
   177	  const epochSec = Math.floor(Date.now() / 1000) + 1;
   178	  // An admin reset is the offboarding / compromised-account lever: the target's outstanding
   179	  // tokens must die with the old password, not linger to their JWT expiry — and the revocation
   180	  // must survive a restart (H1), so the epoch is persisted in this SAME store write and mirrored
   181	  // to the in-memory map below.
   182	  const updated = await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: true, tokenEpoch: epochSec }));
   183	  if (!updated) return false;
   184	  bumpTokenEpoch(userId, epochSec);
   185	  return true;
   186	}
   187	
   188	/**
   189	 * Deactivate a user (ch09 §9.7.1): one operation that (1) sets active=false in the store,
   190	 * (2) updates the write-through activation map synchronously, (3) revokes the user's tokens.
   191	 * `jtisToRevoke` are the user's outstanding token ids known to the caller/session registry.
   192	 */
   193	export async function setUserActive(
   194	  userId: string,
   195	  active: boolean,
   196	  jtisToRevoke: Array<{ jti: string; expiresAtSec: number }>,
   197	  deps: Deps,
   198	): Promise<AuthUserView | null> {
   199	  const cur = getActivation(userId);
   200	  // MAP FIRST, synchronously (ch09 §9.7.1: the toggle updates the map synchronously so the
   201	  // effect is immediate) — this closes the TOCTOU window where a concurrent login between
   202	  // the store write and the cache update could mint a token off the stale cache. On
   203	  // deactivation the token epoch is bumped so EVERY outstanding token is invalidated at once
   204	  // (no per-user jti index needed); any explicitly-known jtis are additionally revoked.
   205	  // The token epoch shares the JWT `iat` clock (real seconds), strictly after any token
   206	  // minted this second, so every outstanding token is invalidated. deps.now drives stored
   207	  // record timestamps; the epoch must track real time to align with jsonwebtoken's iat.
   208	  const epochSec = Math.floor(Date.now() / 1000) + 1;
   209	  // A deactivation bumps the epoch (invalidating every outstanding token); a re-activation keeps
   210	  // the prior epoch. Both the epoch and the billing lock are persisted to the row in the SAME
   211	  // operation as `active` (H1 durability), so a deactivation's revocation is not un-done on restart
   212	  // and a billing lock is not reset to false at boot.
   213	  const newEpoch = active ? cur?.tokenEpoch ?? 0 : epochSec;
   214	  const billingLocked = cur?.billingLocked ?? false;
   215	  setActivation(userId, { active, billingLocked, tokenEpoch: newEpoch });
   216	  if (!active) {
   217	    for (const t of jtisToRevoke) await revoke(t.jti, userId, t.expiresAtSec, deps.now());
   218	  }
   219	  const updated = await users.update(userId, (u) => ({ ...u, active, tokenEpoch: newEpoch, billingLocked }));
   220	  if (!updated) {
   221	    // The user vanished — restore the prior cache entry if we had one to avoid a phantom state.
   222	    if (cur) setActivation(userId, cur);
   223	    return null;
   224	  }
   225	  return view(updated);
   226	}
   227	
   228	export { view as authUserView };
     1	/**
     2	 * Platform domain stores (ch04 §4.3.1). Every store is a `Store<T>` over one physical
     3	 * Mongo collection. Names and tenancy carried from the §4.3.1 map. The `teams` store is
     4	 * DROPPED (Amendment 2); the dual app-data backend selector is not carried (§4.2.8) —
     5	 * Firestore Mongo-compat is the only backend.
     6	 */
     7	import { Store, type Doc } from './store.js';
     8	
     9	// --- Core identity / tenancy ---
    10	export interface UserDoc extends Doc {
    11	  username: string;
    12	  passwordHash: string;
    13	  role: 'super-admin' | 'org-admin' | 'user';
    14	  orgId: string;
    15	  active: boolean;
    16	  passwordChangeRequired?: boolean;
    17	  /** Durable revocation clock (unix seconds): a token whose `iat` is earlier than this is invalid.
    18	   *  Bumped on EVERY revocation (role change, password change/reset, admin logout, deactivation, the
    19	   *  builder→user migration) and written to the row in the SAME operation as the in-memory
    20	   *  `bumpTokenEpoch`. Persisted here because `loadActivation` reloads the activation map from these
    21	   *  rows at boot — without the column every revocation silently un-does on the next restart (H1). */
    22	  tokenEpoch?: number;
    23	  /** Durable account-level billing lock. Persisted (and boot-reloaded via `loadActivation`) so a
    24	   *  lock is not reset to `false` on every process restart — the in-memory activation map alone
    25	   *  defaulted it to `false` at boot (H1; the carried LANDING billing-lock item). */
    26	  billingLocked?: boolean;
    27	  preferences?: Record<string, unknown>;
    28	}
    29	export interface OrgDoc extends Doc {
    30	  name: string;
    31	  displayName?: string;
    32	  branding?: Record<string, unknown>;
    33	  settings?: Record<string, unknown>;
    34	  createdAt: string;
    35	  /** Stamped by updateOrg on every patch — the web's re-sync fingerprint (a branding page left
    36	   *  open must pick up a research merge without a reload; live 2026-07-12). */
    37	  updatedAt?: string;
    38	}
    39	export interface CredentialsDoc extends Doc {
    40	  // singleton _id: 'default'
    41	  credentialCiphertext?: string;
    42	  mode: 'oauth' | 'api-key';
    43	  refreshMeta?: Record<string, unknown>;
    44	}
    45	export interface RevokedTokenDoc extends Doc {
    46	  userId: string;
    47	  revokedAt: string;
    48	  expiresAt: number; // epoch seconds
    49	}
    50	export interface SessionDoc extends Doc {
    51	  userId: string;
    52	  /** Store-side name (ch04 §4.3.1 carries `title`); the wire field is `name` (ch03 §3.8.6). */
    53	  title?: string;
    54	  type?: string;
    55	  artifactId?: string;
    56	  status?: string;
    57	  messageCount?: number;
    58	  createdAt: string;
    59	  updatedAt: string;
    60	}
    61	export interface ActivityLogDoc extends Doc {
    62	  userId: string;
    63	  username: string;
    64	  orgId: string;
    65	  category: string;
    66	  type: string;
    67	  timestamp: string;
    68	  metadata?: Record<string, unknown>;
    69	}
    70	export interface SettingsDoc extends Doc {
    71	  [k: string]: unknown;
    72	}
    73	export interface UserSettingsDoc extends Doc {
    74	  build?: { verifyBuilds?: boolean };
    75	  memory?: { autoExtract?: boolean };
    76	  [k: string]: unknown;
    77	}
    78	
    79	export const users = new Store<UserDoc>('users');
    80	export const orgs = new Store<OrgDoc>('orgs');
    81	export const credentials = new Store<CredentialsDoc>('credentials');
    82	export const revokedTokens = new Store<RevokedTokenDoc>('revoked_tokens');
    83	export const sessions = new Store<SessionDoc>('sessions');
    84	export const messages = new Store<Doc>('messages');
    85	export const sessionContexts = new Store<Doc>('session_contexts');
    86	export const memories = new Store<Doc>('memories');
    87	export const artifacts = new Store<Doc>('artifacts');
    88	export const slugs = new Store<Doc>('slugs');
    89	export const integrationConfigs = new Store<Doc>('integration_configs');
    90	/** Integration-builder chat sessions (ch03 §3.8.14). PERSISTED — the old cortex builder kept an
    91	 *  in-memory Map that died on restart; load-by-key durability requires a store. Holds the running
    92	 *  transcript + the last generated package/skill so a session can be reloaded and edited. */
    93	export const integrationBuilderSessions = new Store<Doc>('integration_builder_sessions');
    94	export const activityLogs = new Store<ActivityLogDoc>('activity_logs');
    95	export const jobs = new Store<Doc>('jobs');
    96	export const settings = new Store<SettingsDoc>('settings');
    97	export const userSettings = new Store<UserSettingsDoc>('user_settings');
    98	export const tokenEvents = new Store<Doc>('token_events');
    99	export const billingAccounts = new Store<Doc>('billing_accounts');
   100	export const automations = new Store<Doc>('automations');
   101	export const automationRuns = new Store<Doc>('automation_runs');
   102	export const approvedCommands = new Store<Doc>('approved_commands');
   103	export const triggers = new Store<Doc>('triggers');
   104	export const appSessions = new Store<Doc>('app_sessions');
   105	export const appSsoPending = new Store<Doc>('app_sso_pending');
   106	export const adobeAgreements = new Store<Doc>('adobe_agreements');
   107	export const knowledgeSources = new Store<Doc>('knowledge_sources');
   108	export const knowledgeUploads = new Store<Doc>('knowledge_uploads');
   109	export const anonymisationDenyLists = new Store<Doc>('anonymisation_deny_lists');
   110	export const bridgePairings = new Store<Doc>('bridge_pairings');
   111	export const eventQueue = new Store<Doc>('event_queue');
   112	export const webhookAudit = new Store<Doc>('webhook_audit');
    67	/**
    68	 * Is this artifact a BUILT app — a code sandbox the app build/edit capabilities govern (H1 HIGH-2)?
    69	 * The primary, reliable signal is a recorded `data.projectDir`: ONLY an artifact produced by the
    70	 * build pipeline (`prepareFirstBuild`) carries one — a bare `POST /artifacts` record does not, and
    71	 * that projectDir is what feeds every code-editing route (`projectDirFor`). The secondary signal is
    72	 * a stored `data.artifactType === 'app'` (a pre-build row that named its type before a sandbox
    73	 * existed). An artifact matching NEITHER is a non-app artifact a plain `user` may still manage
    74	 * (canCreateArtifacts) — the gates below only tighten APP build/edit, never generic artifact CRUD.
    75	 */
    76	export function isAppArtifact(art: ArtifactDoc): boolean {
    77	  const data = (art.data ?? {}) as Record<string, unknown>;
    78	  if (typeof data.projectDir === 'string' && data.projectDir.length > 0) return true;
    79	  return data.artifactType === 'app';
    80	}
    81	
    82	export type OwnershipVerdict = 'ok' | 'notfound' | 'forbidden';
    83	
    84	/**
    85	 * Load an artifact the actor may READ: own (any visibility) or org-shared. A
    86	 * private row of another user (and any cross-org row) is a uniform not-found
    87	 * (ownership-mismatch parity, ch04). Mirrors OwnerVisibilityScoped.getVisible.
    88	 */
    89	export async function loadReadable(actor: Actor, id: string): Promise<ArtifactDoc | null> {
    90	  const art = (await artifacts.get(id)) as ArtifactDoc | null;
    91	  if (!art) return null;
    92	  if (art.orgId !== actor.orgId) return null;
    93	  if (art.userId === actor.userId) return art;
    94	  if (art.visibility === 'org') return art;
    95	  return null;
    96	}
    97	
    98	/**
    99	 * Load an artifact the actor may WRITE: own always, org-shared by any org member.
   100	 * A private row of another user → forbidden; a missing/cross-org row → notfound.
   101	 * Mirrors OwnerVisibilityScoped.writeGuard.
   102	 */
   103	export async function loadWritable(
   104	  actor: Actor,
   105	  id: string,
   106	): Promise<{ verdict: OwnershipVerdict; art?: ArtifactDoc }> {
   107	  const art = (await artifacts.get(id)) as ArtifactDoc | null;
   108	  if (!art || art.orgId !== actor.orgId) return { verdict: 'notfound' };
   109	  if (art.userId === actor.userId) return { verdict: 'ok', art };
   110	  if (art.visibility === 'org') return { verdict: 'ok', art };
   111	  return { verdict: 'forbidden', art };
   112	}
   113	
   114	/** Merge a patch into an artifact's `data` bag and persist. */
   115	export async function patchArtifactData(
   116	  id: string,
   117	  patch: Record<string, unknown>,
   118	): Promise<ArtifactDoc | null> {
   119	  return (await artifacts.update(id, (a) => {
   120	    const data = { ...((a.data as Record<string, unknown>) ?? {}), ...patch };
   121	    return { ...a, data };
   122	  })) as ArtifactDoc | null;
   123	}
   124	
   125	/** Cross-org fetch by id (super-admin platform paths only; the route enforces the role). */
     1	/**
     2	 * Artifacts router (ch03 §3.8.9-3.8.11). CRUD via the apps artifacts-service, plus
     3	 * the artifact FAMILY: fork / export / import / bundle-update / featured-update /
     4	 * featured toggle / files / versions / backups / backend / download / pdf. Single
     5	 * list shape `{ items, featured }` (landmine 7). Thin: validate, call one apps/
     6	 * module, shape the response (CONV-2 error envelope throughout).
     7	 */
     8	import { Router, type Response } from 'express';
     9	import {
    10	  ArtifactPatch,
    11	  ImportArtifactRequest,
    12	  BundleUpdateRequest,
    13	  SetFeaturedRequest,
    14	  ReadFileQuery,
    15	  WriteFileRequest,
    16	  BackupPointRef,
    17	  BackendSetEnabledRequest,
    18	  BackendSampleRunRequest,
    19	  PaginationQuery,
    20	} from '@ekoa/shared';
    21	import { z } from 'zod';
    22	import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
    23	import { can } from '../auth/capabilities.js';
    24	import { loadConfig } from '../config.js';
    25	import {
    26	  listArtifacts, createArtifact, getVisibleArtifact, patchArtifact, deleteArtifact,
    27	  artifactView, stripReservedDataKeys, type ArtifactDoc,
    28	} from '../apps/artifacts-service.js';
    29	import { actorOf, notFound, sendError, parseBody } from './helpers.js';
    30	import type { SnapshotAudit } from '../services/commit-guard.js';
    31	import { SecretCommitError } from '../services/commit-guard.js';
    32	import type { AppDataDeps } from '../apps/app-data-access.js';
    33	import { loadReadable, loadWritable, projectDirFor, getArtifactById, setFeaturedFlag, isAppArtifact } from '../apps/app-paths.js';
    34	import { forkArtifact } from '../apps/artifact-fork.js';
    35	import { exportArtifact, importArtifact, updateArtifactFromBundle, ManifestIdMismatchError } from '../apps/artifact-bundle.js';
    36	import { applyFeaturedUpdate, ignoreFeaturedUpdate } from '../apps/artifact-featured-update.js';
    37	import { listVersions, restoreAndRebuild } from '../apps/versions.js';
    38	import { listArtifactFiles, readArtifactFile, writeArtifactFile, FilePathError } from '../apps/artifact-files.js';
    39	import { AppDataBackups } from '../apps/backups.js';
    40	import {
    41	  getArtifactBackendRuntime, readDeclaredBackend, type BackendLogEntry, type InvocationRecord,
    42	} from '../apps/backend-runtime/index.js';
    43	import { renderArtifactPdf, isSafePdfBasename } from '../apps/pdf.js';
    44	import { collectAppFiles, streamFiles, safeZipName } from '../services/app-archive.js';
    45	
    46	const CreateArtifact = z.object({ name: z.string(), visibility: z.enum(['private', 'org']).optional() });
    47	const ForkBody = z.object({ name: z.string().optional() });
    48	
    49	export function artifactsRouter(deps: { now: () => number; genId: () => string }): Router {
    50	  const r = Router();
    51	  r.use(requireAuth);
    52	
    53	  const auditOf = (req: AuthedRequest): SnapshotAudit => ({
    54	    actor: { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId },
    55	    deps: { now: deps.now, genId: deps.genId },
    56	  });
    57	  const appDeps: AppDataDeps = { now: deps.now, genId: deps.genId };
    58	
    59	  /** Load an artifact the actor may read; write 404 + return null otherwise. */
    60	  async function readable(req: AuthedRequest, res: Response): Promise<ArtifactDoc | null> {
    61	    const art = await loadReadable(actorOf(req), req.params.id as string);
    62	    if (!art) { notFound(res); return null; }
    63	    return art;
    64	  }
    65	  /** Load an artifact the actor may write; write 404/403 + return null otherwise. */
    66	  async function writable(req: AuthedRequest, res: Response): Promise<ArtifactDoc | null> {
    67	    const { verdict, art } = await loadWritable(actorOf(req), req.params.id as string);
    68	    if (verdict === 'notfound') { notFound(res); return null; }
    69	    if (verdict === 'forbidden') { sendError(res, 'FORBIDDEN', 'Sem permissão.'); return null; }
    70	    return art!;
    71	  }
    72	
    73	  /**
    74	   * H1 HIGH-2 app-edit capability gate. `writable()`/ownership passes for an artifact the actor
    75	   * OWNS — but a plain `user` OWNS the apps they created, so ownership alone lets them change app
    76	   * CODE (bundle-update, file write, version restore, backend toggle/sample-run, app-data
    77	   * snapshot/restore). An in-place edit of a BUILT app additionally requires `canEditApps`
    78	   * (admin-only). NON-app artifacts stay user-manageable (the check is app-type-aware). Returns
    79	   * true (and writes the FORBIDDEN + details.capability refusal) when the edit is denied.
    80	   */
    81	  function denyAppEdit(req: AuthedRequest, res: Response, art: ArtifactDoc): boolean {
    82	    if (isAppArtifact(art) && !can(actorOf(req), 'canEditApps')) {
    83	      sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
    84	      return true;
    85	    }
    86	    return false;
    87	  }
    88	
    89	  // ---- base CRUD (ch03 §3.8.9) ----
    90	  r.get('/', async (req: AuthedRequest, res: Response) => {
    91	    const { items, featured } = await listArtifacts(actorOf(req));
    92	    res.json({ items: items.map(artifactView), featured: featured.map(artifactView) });
    93	  });
    94	
    95	  r.post('/', async (req: AuthedRequest, res: Response) => {
    96	    const body = parseBody(res, CreateArtifact, req.body) as { name: string; visibility?: 'private' | 'org' } | undefined;
    97	    if (!body) return;
    98	    // H1 capability gate: creating an artifact requires canCreateArtifacts (held by user +
    99	    // org-admin + super-admin — this is the base "artifacts area" capability, distinct from the
   100	    // app build/edit capabilities). Refusal is the FORBIDDEN envelope + details.capability.
   101	    if (!can(actorOf(req), 'canCreateArtifacts')) {
   102	      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: 'canCreateArtifacts' });
   103	    }
   104	    res.status(201).json(artifactView(await createArtifact(actorOf(req), body, deps)));
   105	  });
   106	
   107	  // ---- import must precede GET/:id-style matches (distinct verb+path) ----
   108	  r.post('/import', async (req: AuthedRequest, res: Response) => {
   109	    const body = parseBody(res, ImportArtifactRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle } | undefined;
   110	    if (!body) return;
   111	    // H1 HIGH-2: a bundle is always an app export; importing it CREATES and BUILDS a new app →
   112	    // canBuildApps (a plain user cannot import an app the same way they cannot first-build one).
   113	    if (!can(actorOf(req), 'canBuildApps')) {
   114	      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
   115	    }
   116	    const created = await importArtifact(body.bundle, actorOf(req), deps);
   117	    res.status(201).json(artifactView(created));
   118	  });
   119	
   120	  r.get('/:id', async (req: AuthedRequest, res: Response) => {
   121	    const a = await getVisibleArtifact(actorOf(req), req.params.id as string);
   122	    if (!a) return notFound(res);
   123	    res.json(artifactView(a));
   124	  });
   125	
   126	  r.patch('/:id', async (req: AuthedRequest, res: Response) => {
   127	    const body = parseBody(res, ArtifactPatch, req.body) as Record<string, unknown> | undefined;
   128	    if (!body) return;
   129	    // Strip server-owned reserved keys (e.g. `projectDir`) from any client `data` at the boundary
   130	    // before they reach the store — a client must never influence the build sandbox path (ch09).
   131	    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
   132	      body.data = stripReservedDataKeys(body.data as Record<string, unknown>);
   133	    }
   134	    const result = await patchArtifact(actorOf(req), req.params.id as string, body);
   135	    if (result.verdict === 'notfound') return notFound(res);
   136	    if (result.verdict === 'forbidden') {
   137	      if (typeof body.slug === 'string') return sendError(res, 'SLUG_TAKEN', 'Slug já em uso.');
   138	      return sendError(res, 'FORBIDDEN', 'Sem permissão.');
   139	    }
   140	    res.json(artifactView(result.artifact!));
   141	  });
   142	
   143	  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
   144	    const id = req.params.id as string;
   145	    // Revoke the backend BEFORE removing the row so no queued/in-flight invoke can
   146	    // run against a deleted artifact (C05-20 post-DELETE refusal, B19).
   147	    await getArtifactBackendRuntime().revoke(id);
   148	    const verdict = await deleteArtifact(actorOf(req), id);
   149	    if (verdict === 'notfound') return notFound(res);
   150	    if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
   151	    res.json({ ok: true });
   152	  });
   153	
   154	  // ---- fork / featured toggle ----
   155	  r.post('/:id/fork', async (req: AuthedRequest, res: Response) => {
   156	    const src = await readable(req, res);
   157	    if (!src) return;
   158	    // H1 HIGH-2: forking an APP builds a new one → canBuildApps; forking a NON-app artifact is a
   159	    // plain create → canCreateArtifacts (kept for users). App-type-aware so users still fork the
   160	    // artifacts they may create, but cannot mint apps.
   161	    const forkCap = isAppArtifact(src) ? 'canBuildApps' as const : 'canCreateArtifacts' as const;
   162	    if (!can(actorOf(req), forkCap)) {
   163	      return sendError(res, 'FORBIDDEN', forkCap === 'canBuildApps'
   164	        ? 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.'
   165	        : 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: forkCap });
   166	    }
   167	    const body = parseBody(res, ForkBody, req.body ?? {}) as { name?: string } | undefined;
   168	    if (!body) return;
   169	    const { artifact } = await forkArtifact(src._id, actorOf(req), deps, body.name);
   170	    res.status(201).json({ id: artifact._id, slug: artifact.slug });
   171	  });
   172	
   173	  r.put('/:id/featured', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
   174	    const body = parseBody(res, SetFeaturedRequest, req.body) as { featured: boolean; featuredRank?: number } | undefined;
   175	    if (!body) return;
   176	    const existing = await getArtifactById(req.params.id as string);
   177	    if (!existing) return notFound(res);
   178	    const updated = await setFeaturedFlag(req.params.id as string, body.featured, body.featuredRank);
   179	    res.json(artifactView(updated!));
   180	  });
   181	
   182	  // ---- bundle export / import / update-in-place ----
   183	  r.get('/:id/export', async (req: AuthedRequest, res: Response) => {
   184	    const art = await readable(req, res);
   185	    if (!art) return;
   186	    res.json(await exportArtifact(art));
   187	  });
   188	
   189	  r.post('/:id/bundle-update', async (req: AuthedRequest, res: Response) => {
   190	    const art = await writable(req, res);
   191	    if (!art) return;
   192	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: in-place app edit → canEditApps
   193	    const body = parseBody(res, BundleUpdateRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle; force?: boolean } | undefined;
   194	    if (!body) return;
   195	    try {
   196	      const result = await updateArtifactFromBundle(
   197	        art, body.bundle,
   198	        { force: body.force, authorName: req.user!.username, audit: auditOf(req), appDeps },
   199	        deps,
   200	      );
   201	      res.json({ artifact: artifactView(result.artifact), safetyNetSnapshotId: result.safetyNetSnapshotId, preUpdateVersionId: result.preUpdateVersionId });
   202	    } catch (err) {
   203	      if (err instanceof ManifestIdMismatchError) return sendError(res, 'MANIFEST_ID_MISMATCH', 'O pacote não corresponde a esta app. Confirme para atualizar mesmo assim.');
   204	      throw err;
   205	    }
   206	  });
   207	
   208	  r.post('/:id/featured-update/apply', async (req: AuthedRequest, res: Response) => {
   209	    const art = await writable(req, res);
   210	    if (!art) return;
   211	    await applyFeaturedUpdate(art._id, { authorName: req.user!.username, audit: auditOf(req), appDeps });
   212	    res.json({ ok: true });
   213	  });
   214	
   215	  r.post('/:id/featured-update/ignore', async (req: AuthedRequest, res: Response) => {
   216	    const art = await writable(req, res);
   217	    if (!art) return;
   218	    await ignoreFeaturedUpdate(art._id);
   219	    res.json({ ok: true });
   220	  });
   221	
   222	  // ---- versions ----
   223	  r.get('/:id/versions', async (req: AuthedRequest, res: Response) => {
   224	    const art = await readable(req, res);
   225	    if (!art) return;
   226	    const q = PaginationQuery.safeParse(req.query);
   227	    const limit = q.success && q.data.limit ? q.data.limit : 100;
   228	    res.json({ items: await listVersions(projectDirFor(art), limit) });
   229	  });
   230	
   231	  r.post('/:id/versions/:sha/restore', async (req: AuthedRequest, res: Response) => {
   232	    const art = await writable(req, res);
   233	    if (!art) return;
   234	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: restoring app code → canEditApps
   235	    const authorName = req.user!.username;
   236	    const result = await restoreAndRebuild(
   237	      art._id,
   238	      { projectDir: projectDirFor(art), sha: req.params.sha as string, authorName, authorEmail: `${authorName}@ekoa.local` },
   239	      art.name,
   240	    );
   241	    res.json({ newHeadSha: result.newHeadSha });
   242	  });
   243	
   244	  // ---- files (project-relative, confined server-side; P-15) ----
   245	  r.get('/:id/files', async (req: AuthedRequest, res: Response) => {
   246	    const art = await readable(req, res);
   247	    if (!art) return;
   248	    const projectDir = projectDirFor(art);
   249	    res.json({ files: await listArtifactFiles(projectDir), projectDir });
   250	  });
   251	
   252	  r.get('/:id/file', async (req: AuthedRequest, res: Response) => {
   253	    const art = await readable(req, res);
   254	    if (!art) return;
   255	    const q = ReadFileQuery.safeParse(req.query);
   256	    if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
   257	    try {
   258	      res.json({ content: await readArtifactFile(projectDirFor(art), q.data.path) });
   259	    } catch (err) {
   260	      if (err instanceof FilePathError) return notFound(res);
    35	  r.use(requireAuth);
    36	
    37	  r.post('/', async (req: AuthedRequest, res: Response) => {
    38	    const body = parseBody(res, JobCreateRequest, req.body);
    39	    if (!body) return;
    40	    const actor = actorOf(req);
    41	    // Capability + ownership gates BEFORE any job is created or agent spawned (H1). Refusals carry
    42	    // the FORBIDDEN envelope with `details.capability` (the machine-readable hook the H4
    43	    // request-to-admin flow consumes); object-ownership denials carry no capability field.
    44	    if (body.artifactId) {
    45	      // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
    46	      // target artifact. The writability check (own always; org-shared within org ok; another
    47	      // user's private → 403; missing/cross-org → 404) closes the follow-up-build IDOR (map §5.1),
    48	      // where any authenticated user could drive a code-writing agent against ANY artifact by id.
    49	      // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
    50	      // never leaks whether the target exists.
    51	      if (!can(actor, 'canEditApps')) {
    52	        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
    53	      }
    54	      // LOW oracle fix: collapse 'forbidden' (another user's PRIVATE artifact in the same org) into
    55	      // the SAME 404 as missing/cross-org, LOCAL to the follow-up build gate. A distinct 403 here
    56	      // is an existence oracle — it lets any canEditApps holder probe whether a private app exists
    57	      // by id. Security over the H1 brief's 403/404 split (that split stays on the artifact routes,
    58	      // which may legitimately distinguish); here writability failing for ANY reason reads as 404.
    59	      const { verdict } = await loadWritable(actor, body.artifactId);
    60	      if (verdict !== 'ok') return notFound(res);
    61	    } else if (!can(actor, 'canBuildApps')) {
    62	      // A first build CREATES an app.
    63	      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
    64	    }
    65	    const result = await handleBuildCreate({
    66	      actor,
    67	      username: req.user!.username,
    68	      sessionId: body.sessionId,
    69	      description: body.description,
    70	      language: body.language,
    71	      ...(body.templateId ? { templateId: body.templateId } : {}),
    72	      ...(body.integrationKeys ? { integrationKeys: body.integrationKeys } : {}),
    73	      ...(body.artifactId ? { artifactId: body.artifactId } : {}),
    74	      ...(body.attachments ? { attachments: body.attachments } : {}),
    75	      ...(body.fieldValues ? { fieldValues: body.fieldValues } : {}),
   295	  resetInactivity();
   296	
   297	  try {
   298	    await patchJob(jobId, { status: 'running', startedAt: new Date(input.deps.now()).toISOString() });
   299	
   300	    // Billing gate (§5.2 step 3).
   301	    const allow = await checkAllowance(input.actor.userId);
   302	    if (abort.signal.aborted) { await settleAborted(); return; }
   303	    if (!allow.ok) {
   304	      clearTimers();
   305	      if (finalizeOnce(jobId)) {
   306	        const url = allow.billingUrl ?? BILLING_PAGE_URL;
   307	        sink.error('BILLING_BLOCKED', `${allow.message ?? 'Faturação bloqueada.'} ${url}`);
   308	        await patchJob(jobId, { status: 'failed', error: { code: 'BILLING_BLOCKED', message: allow.message ?? 'Faturação bloqueada.' }, endedAt: new Date(input.deps.now()).toISOString() });
   309	      }
   310	      terminalReached = true;
   311	      return;
   312	    }
   313	
   314	    // First-build vs follow-up resolution.
   315	    let basePromptSections: string[] = [];
   316	    if (opts.firstBuild) {
   317	      const prep = await mech.prepareFirstBuild({ userId: input.actor.userId, sessionId: input.sessionId, description: input.description, language: input.language, ...(input.templateId ? { templateId: input.templateId } : {}) });
   318	      artifactId = prep.artifactId;
   319	      projectDir = prep.projectDir;
   320	      slug = prep.slug;
   321	      appUrl = prep.appUrl;
   322	      basePromptSections = prep.basePromptSections ?? [];
   323	      if (entry) entry.artifactId = artifactId;
   324	      await patchJob(jobId, { artifactId });
   325	    } else {
   326	      // TOCTOU close (H1 MEDIUM): the create-time writability gate on POST /jobs can be stale by the
   327	      // time this queued follow-up runs — the owner may have flipped the artifact org→private, or
   328	      // deleted it, between check and execution. Re-validate writability at USE time (through the
   329	      // mechanics seam — agents/ reaches apps/ only via the seam, ch02 §2.7) and FAIL the job rather
   330	      // than resume a code-writing agent against an artifact the actor may no longer write.
   331	      const writeVerdict = await mech.revalidateWritable(input.actor, artifactId);
   332	      if (writeVerdict !== 'ok') {
   333	        clearTimers();
   334	        if (finalizeOnce(jobId)) {
   335	          const message = 'Já não tem permissão para alterar esta aplicação.';
   336	          sink.error('EDIT_FORBIDDEN', message);
   337	          await patchJob(jobId, { status: 'failed', error: { code: 'EDIT_FORBIDDEN', message }, endedAt: new Date(input.deps.now()).toISOString() });
   338	        }
   339	        terminalReached = true;
   340	        return;
   341	      }
   342	      const resolved = await mech.resolveFollowUp(artifactId);
   343	      if (!resolved) { clearTimers(); await finishError('ADAPTER_ERROR'); return; }
   344	      projectDir = resolved.projectDir;
   345	      resumeSessionId = resolved.resumeSessionId;
   300	}
   301	
   302	export interface FollowUpResolution {
   303	  projectDir: string;
   304	  /** The SDK session id to resume with (§5.4.5). */
   305	  resumeSessionId?: string;
   306	  /** The artifact's existing slug + served URL. Follow-up completion re-activates the artifact
   307	   *  with these — pre-fix, build.ts carried '' through and blanked the slug on every follow-up. */
   308	  slug: string;
   309	  appUrl: string;
   310	  /** Prompt sections of the artifact's base (manifest `extends`, operator-run B1), so
   311	   *  follow-up builds keep the base conventions in the system prompt. Absent when the
   312	   *  artifact extends no base (or the base fails to load — non-fatal, logged). */
   313	  basePromptSections?: string[];
   314	}
   315	
   316	/**
   317	 * The heavy ch07 build mechanics `agents/` invokes but does not own: scaffold + first-build
   318	 * artifact creation, final-bundle, version snapshot, screenshot, artifact activation, and the
   319	 * sdkSessionId persistence. `apps/` implements these at the composition root; the defaults are
   320	 * honest no-ops so the lifecycle + guards are testable without the real esbuild pipeline.
   321	 */
   322	export interface BuildMechanics {
   323	  prepareFirstBuild(input: { userId: string; sessionId: string; description: string; language: string; templateId?: string }): Promise<FirstBuildPrep>;
   324	  resolveFollowUp(artifactId: string): Promise<FollowUpResolution | null>;
   325	  /**
   326	   * Re-validate at EXECUTION time that `actor` may still WRITE `artifactId` (H1 MEDIUM, TOCTOU
   327	   * close). The create-time gate on `POST /jobs` (loadWritable in routes/) can go stale before a
   328	   * queued follow-up actually resolves: the owner may flip the artifact org→private, or it may be
   329	   * deleted, between the check and execution. build.ts calls this immediately before resuming the
   330	   * follow-up and FAILS the job on a non-`ok` verdict rather than editing an artifact the actor may
   331	   * no longer write. Kept on the mechanics seam because the ownership rule lives in apps/
   332	   * (loadWritable) and agents/ reaches apps/ only through this seam (tier direction, ch02 §2.7).
   333	   * Verdict mirrors loadWritable: 'ok' | 'notfound' | 'forbidden'.
   334	   */
   335	  revalidateWritable(actor: Actor, artifactId: string): Promise<'ok' | 'notfound' | 'forbidden'>;
   336	  /** Final bundle (stop watcher, clean, build w/ 2 attempts, validate). Returns an error note on failure. */
   337	  finalizeBundle(input: { artifactId: string; projectDir: string }): Promise<{ ok: boolean; error?: string }>;
   338	  /** Version snapshot through the app repo lock (broken builds snapshotted with a failure tag). */
   339	  snapshot(input: { artifactId: string; projectDir: string; broken: boolean }): Promise<void>;
   340	  /** Fire-and-forget screenshot. */
   341	  screenshot(artifactId: string): void;
   342	  /** Persist sdkSessionId onto the artifact — ONLY when it changed (§5.4.5). */
   343	  persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void>;
   344	  /** Activate the artifact with a MERGE onto its existing data bag (§5.6.2 step 7). */
   345	  activateArtifact(input: { artifactId: string; slug: string; appUrl: string; projectDir?: string }): Promise<void>;
   346	  /** (Re)start the incremental watcher with a rebuild callback — the live-preview heartbeat:
   347	   *  every successful watcher rebuild fires `onRebuild`, which build.ts maps to a
   348	   *  `preview_reload` job event so the client's iframe follows the agent's writes. */
   349	  watchRebuilds(input: { artifactId: string; projectDir: string; onRebuild: () => void }): Promise<void>;
   350	  /**
   351	   * Honest-completion gate (F16, ch05 §5.6.2 step 5a): deterministic evidence the agent's work
   352	   * reached the SERVED surface. NOT clean when the manifest-entrypoint subtree (`frontend/src/`)
   353	   * is unchanged vs the scaffold baseline commit, or the built output still fingerprints as the
   354	   * Ekoa scaffold — especially when an orphan top-level `*.html` was written instead. A gate hit
   355	   * is a distinct non-success terminal in build.ts, never a clean `completed`.
   356	   */
   357	  assertProgress(input: { artifactId: string; projectDir: string }): Promise<{ clean: boolean; reasons: string[] }>;
   358	}
   359	
   360	const noopBuildMechanics: BuildMechanics = {
     1	/**
     2	 * Real build mechanics over the ch07 (G6) app pipeline — the heavy work `agents/` invokes but
     3	 * does not own (ch05 §5.6.2, ch07 §7.2/§7.3/§7.4). Wired at the composition root via
     4	 * `setBuildMechanics`; imported ONLY by server.ts.
     5	 *
     6	 * The shape mirrors the `BuildMechanics` seam in `agents/seams.ts` structurally — this module
     7	 * does NOT import `agents/` (tier direction, ch02 §2.7): the composition root binds the object
     8	 * to the seam, and server.ts's `setBuildMechanics` call is where the shapes are type-checked
     9	 * (the same structural-binding pattern content/ uses for `assembleAgentContext`). apps/ MAY
    10	 * import data/ (store access) — done the way artifacts-service.ts does it.
    11	 */
    12	import { rm, readFile, readdir } from 'node:fs/promises';
    13	import { existsSync } from 'node:fs';
    14	import { join } from 'node:path';
    15	import { execFile } from 'node:child_process';
    16	import { promisify } from 'node:util';
    17	import { artifacts, slugs, users } from '../data/stores.js';
    18	import { generateSlug, type ArtifactDoc } from './artifacts-service.js';
    19	import { newProjectDir, projectDirFor, patchArtifactData, loadWritable } from './app-paths.js';
    20	import { indexSlug } from './slug-index.js';
    21	import { scaffoldApp } from './scaffold.js';
    22	import { appBuilder, validateBundle } from './builder.js';
    23	import { appRegistry } from './app-registry.js';
    24	import { readManifest, writeManifest } from './manifest.js';
    25	import { loadBase, baseProjectFiles, isBaseId, type LoadedBase } from './base-loader.js';
    26	import { readUiActions } from './action-manifest.js';
    27	import { readTours } from './tour-writer.js';
    28	import { classifyArtifactType, baseForType, typeForBase } from './artifact-type.js';
    29	import type { ArtifactType, Actor } from '@ekoa/shared';
    30	import { commitSnapshot, SecretCommitError } from '../services/commit-guard.js';
    31	import { captureArtifactScreenshot } from '../services/artifact-screenshot.js';
    32	
    33	export interface BuildMechanicsDeps {
    34	  now: () => number;
    35	  genId: () => string;
    36	}
    37	
    38	const execFileAsync = promisify(execFile);
    39	
    40	/** Content fingerprints of the Ekoa scaffold placeholder (assets/scaffold-templates/App.jsx).
    41	 *  A built output still carrying any of these is serving the scaffold, not the user's app. */
    42	const SCAFFOLD_MARKERS = ['scaffold-root', "Let's build something that will change", 'Powered by Ekoa'] as const;
    43	
    44	/**
    45	 * Build the real BuildMechanics over the G6 pipeline. A factory because the mechanics need the
    46	 * runtime `deps` (id + clock) the composition root owns — the same deps every domain router gets.
    47	 */
    48	export function createBuildMechanics(deps: BuildMechanicsDeps) {
    49	  /** Resolve a user's org (private artifacts still carry orgId for tenancy). Best-effort: an
    50	   *  unresolved user yields '' rather than failing the build. The seam does not thread orgId
    51	   *  (it passes only userId), so the composition root resolves it here — a documented adapter. */
    52	  async function orgIdFor(userId: string): Promise<string> {
    53	    try {
    54	      return (await users.get(userId))?.orgId ?? '';
    55	    } catch {
    56	      return '';
    57	    }
    58	  }
    59	
    60	  /** First-line-derived app name for the artifact + deterministic slug seed. */
    61	  function deriveAppName(description: string): string {
    62	    const firstLine = (description.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
    63	    return firstLine || 'App';
    64	  }
    65	
    66	  /**
    67	   * Resolve the internal base + artifact type a first build scaffolds from.
    68	   * B1: an EXPLICIT `templateId` naming a base wins (a known-but-broken base fails
    69	   * LOUD; an unknown id warns and falls through to classification — featured ids
    70	   * also travel this field historically). C1: with no explicit selection, the
    71	   * scoping classifier decides the artifact type (deterministic signals first,
    72	   * FAST chokepoint one-shot on ambiguity, `app` on any failure) and the type's
    73	   * base scaffolds the build. Only a base that fails to LOAD after classification
    74	   * degrades to the generic starters (warned, never silent).
    75	   */
    76	  async function baseFor(
    77	    templateId: string | undefined,
    78	    description: string,
    79	    userId: string,
    80	  ): Promise<{ base: LoadedBase | null; artifactType: ArtifactType }> {
    81	    if (templateId && isBaseId(templateId)) {
    82	      const base = await loadBase(templateId); // explicit selection: broken base fails loud
    83	      return { base, artifactType: typeForBase(base.id) };
    84	    }
    85	    if (templateId) {
    86	      console.warn(`[build-mechanics] templateId "${templateId}" names no internal base; classifying instead`);
    87	    }
    88	    const artifactType = await classifyArtifactType(description, userId);
    89	    try {
    90	      return { base: await loadBase(baseForType(artifactType)), artifactType };
    91	    } catch (err) {
    92	      console.warn(`[build-mechanics] base "${baseForType(artifactType)}" failed to load; generic starters:`, err instanceof Error ? err.message : err);
    93	      return { base: null, artifactType };
    94	    }
    95	  }
    96	
    97	  /** Load the base an existing artifact extends (manifest `extends`) for follow-up
    98	   *  prompt injection. Non-fatal: a missing/invalid manifest or base yields null. */
    99	  async function baseOfProject(projectDir: string): Promise<LoadedBase | null> {
   100	    try {
   101	      const m = await readManifest(projectDir);
   102	      if (!m?.extends || !isBaseId(m.extends)) return null;
   103	      return await loadBase(m.extends);
   104	    } catch (err) {
   105	      console.warn('[build-mechanics] base of project failed to load (non-fatal):', err instanceof Error ? err.message : err);
   106	      return null;
   107	    }
   108	  }
   109	
   110	  /** Resolve the artifact's build output dir (manifest.outputDir, default `dist/`). */
   111	  async function distDirOf(projectDir: string): Promise<string> {
   112	    let outputDir = 'dist';
   113	    try {
   114	      const m = await readManifest(projectDir);
   115	      if (m?.outputDir) outputDir = m.outputDir;
   116	    } catch {
   117	      /* invalid/absent manifest — the default dist/ is correct */
   118	    }
   119	    return join(projectDir, outputDir);
   120	  }
   121	
   122	  /** IIFE bundle-format check (ch07 §7.2.3), with the plain-HTML exception: a plain-HTML app
   123	   *  (§7.2.1) emits no `bundle.js`, so a served `index.html` with no bundle is a valid build. */
   124	  async function bundleValid(distDir: string): Promise<{ ok: boolean; error?: string }> {
   125	    const v = await validateBundle(distDir);
   126	    if (v.valid) return { ok: true };
   127	    if (existsSync(join(distDir, 'index.html')) && !existsSync(join(distDir, 'bundle.js'))) {
   128	      return { ok: true };
   129	    }
   130	    return { ok: false, error: v.error };
   131	  }
   132	
   133	  return {
   134	    /**
   135	     * First build (ch05 §5.6.2 first-build branch, ch07 §7.3/§7.4 trigger 1): create the draft
   136	     * artifact with its session + project-dir linkage in the data bag, scaffold the app tree, run
   137	     * the immediate initial build + watch (non-fatal — the agent will fix the code), and register
   138	     * it so the preview is live before the agent runs.
   139	     */
   140	    async prepareFirstBuild(input: {
   141	      userId: string;
   142	      sessionId: string;
   143	      description: string;
   144	      language: string;
   145	      templateId?: string;
   146	    }): Promise<{ artifactId: string; projectDir: string; slug: string; appUrl: string; basePromptSections?: string[] }> {
   147	      const { base, artifactType } = await baseFor(input.templateId, input.description, input.userId);
   148	      const artifactId = deps.genId();
   149	      const name = deriveAppName(input.description);
   150	      const slug = await generateSlug(name, deps);
   151	      // Point the reservation at the new artifact and keep the in-memory serving index current
   152	      // (the same two-step artifacts-service.createArtifact performs, ch07 §7.8).
   153	      await slugs.put({ _id: slug, artifactId });
   154	      indexSlug(slug, artifactId);
   155	
   156	      const projectDir = newProjectDir(input.userId, artifactId);
   157	      const appUrl = `/apps/${artifactId}/`;
   158	      const orgId = await orgIdFor(input.userId);
   159	
   160	      const doc: ArtifactDoc = {
   161	        _id: artifactId,
   162	        name,
   163	        slug,
   164	        userId: input.userId,
   165	        orgId,
   166	        visibility: 'private',
   167	        status: 'draft',
   168	        // artifactType (C1): the scoping classifier's verdict — the operator surface
   169	        // exists only for 'app' artifacts (downstream slices read this, never re-classify).
   170	        data: { projectDir, appUrl, sessionId: input.sessionId, artifactType },
   171	      };
   172	      await artifacts.insert(doc as never);
   173	
   174	      await scaffoldApp({
   175	        appId: artifactId,
   176	        name,
   177	        projectDir,
   178	        description: input.description,
   179	        ...(base ? { templateScaffoldFiles: baseProjectFiles(base) } : {}),
   180	      });
   181	      // Persist the base linkage (manifest `extends`) so follow-up builds and the
   182	      // per-build base-manifest verification know which base this artifact is on.
   183	      if (base) {
   184	        const m = await readManifest(projectDir);
   185	        if (m) {
   186	          m.extends = base.id;
   187	          await writeManifest(projectDir, m);
   188	        }
   189	      }
   190	      // Trigger 1: initial build + watch, before the agent starts. A failure here is non-fatal.
   191	      try {
   192	        await appBuilder.build(artifactId, projectDir);
   193	        await appBuilder.watch(artifactId, projectDir);
   194	      } catch (err) {
   195	        console.warn(`[build-mechanics] ${artifactId}: initial build/watch failed (non-fatal):`, err instanceof Error ? err.message : err);
   196	      }
   197	      await appRegistry.register(artifactId, projectDir, input.userId, name);
   198	
   199	      return { artifactId, projectDir, slug, appUrl, ...(base ? { basePromptSections: base.promptSections } : {}) };
   200	    },
   201	
   202	    /** Follow-up resolution (ch05 §5.3.5, §5.4.5): the artifact record → its project dir, the
   203	     *  SDK session id to resume with, and its existing slug + served URL (follow-up completion
   204	     *  re-activates with these — carrying '' through blanked the slug on every follow-up).
   205	     *  Null when the artifact is gone. */
   206	    async resolveFollowUp(artifactId: string): Promise<{ projectDir: string; resumeSessionId?: string; slug: string; appUrl: string; basePromptSections?: string[] } | null> {
   207	      const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
   208	      if (!art) return null;
   209	      const projectDir = projectDirFor(art);
   210	      const data = (art.data as Record<string, unknown> | undefined) ?? {};
   211	      const resumeSessionId = typeof data.sdkSessionId === 'string' ? data.sdkSessionId : undefined;
   212	      const appUrl = typeof data.appUrl === 'string' && data.appUrl ? data.appUrl : `/apps/${artifactId}/`;
   213	      const base = await baseOfProject(projectDir);
   214	      return {
   215	        projectDir,
   216	        ...(resumeSessionId ? { resumeSessionId } : {}),
   217	        slug: art.slug ?? '',
   218	        appUrl,
   219	        ...(base ? { basePromptSections: base.promptSections } : {}),
   220	      };

hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "git show 49dc5f6:api/src/routes/artifacts.ts | nl -ba | sed -n '1,430p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-rRWpXeKG' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-ER5bKy5H' (errno=Operation not permitted)
     1	/**
     2	 * Artifacts router (ch03 §3.8.9-3.8.11). CRUD via the apps artifacts-service, plus
     3	 * the artifact FAMILY: fork / export / import / bundle-update / featured-update /
     4	 * featured toggle / files / versions / backups / backend / download / pdf. Single
     5	 * list shape `{ items, featured }` (landmine 7). Thin: validate, call one apps/
     6	 * module, shape the response (CONV-2 error envelope throughout).
     7	 */
     8	import { Router, type Response } from 'express';
     9	import {
    10	  ArtifactPatch,
    11	  ImportArtifactRequest,
    12	  BundleUpdateRequest,
    13	  SetFeaturedRequest,
    14	  ReadFileQuery,
    15	  WriteFileRequest,
    16	  BackupPointRef,
    17	  BackendSetEnabledRequest,
    18	  BackendSampleRunRequest,
    19	  PaginationQuery,
    20	} from '@ekoa/shared';
    21	import { z } from 'zod';
    22	import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
    23	import { can } from '../auth/capabilities.js';
    24	import { loadConfig } from '../config.js';
    25	import {
    26	  listArtifacts, createArtifact, getVisibleArtifact, patchArtifact, deleteArtifact,
    27	  artifactView, stripReservedDataKeys, type ArtifactDoc,
    28	} from '../apps/artifacts-service.js';
    29	import { actorOf, notFound, sendError, parseBody } from './helpers.js';
    30	import type { SnapshotAudit } from '../services/commit-guard.js';
    31	import { SecretCommitError } from '../services/commit-guard.js';
    32	import type { AppDataDeps } from '../apps/app-data-access.js';
    33	import { loadReadable, loadWritable, projectDirFor, getArtifactById, setFeaturedFlag, isAppArtifact } from '../apps/app-paths.js';
    34	import { forkArtifact } from '../apps/artifact-fork.js';
    35	import { exportArtifact, importArtifact, updateArtifactFromBundle, ManifestIdMismatchError } from '../apps/artifact-bundle.js';
    36	import { applyFeaturedUpdate, ignoreFeaturedUpdate } from '../apps/artifact-featured-update.js';
    37	import { listVersions, restoreAndRebuild } from '../apps/versions.js';
    38	import { listArtifactFiles, readArtifactFile, writeArtifactFile, FilePathError } from '../apps/artifact-files.js';
    39	import { AppDataBackups } from '../apps/backups.js';
    40	import {
    41	  getArtifactBackendRuntime, readDeclaredBackend, type BackendLogEntry, type InvocationRecord,
    42	} from '../apps/backend-runtime/index.js';
    43	import { renderArtifactPdf, isSafePdfBasename } from '../apps/pdf.js';
    44	import { collectAppFiles, streamFiles, safeZipName } from '../services/app-archive.js';
    45	
    46	const CreateArtifact = z.object({ name: z.string(), visibility: z.enum(['private', 'org']).optional() });
    47	const ForkBody = z.object({ name: z.string().optional() });
    48	
    49	export function artifactsRouter(deps: { now: () => number; genId: () => string }): Router {
    50	  const r = Router();
    51	  r.use(requireAuth);
    52	
    53	  const auditOf = (req: AuthedRequest): SnapshotAudit => ({
    54	    actor: { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId },
    55	    deps: { now: deps.now, genId: deps.genId },
    56	  });
    57	  const appDeps: AppDataDeps = { now: deps.now, genId: deps.genId };
    58	
    59	  /** Load an artifact the actor may read; write 404 + return null otherwise. */
    60	  async function readable(req: AuthedRequest, res: Response): Promise<ArtifactDoc | null> {
    61	    const art = await loadReadable(actorOf(req), req.params.id as string);
    62	    if (!art) { notFound(res); return null; }
    63	    return art;
    64	  }
    65	  /** Load an artifact the actor may write; write 404/403 + return null otherwise. */
    66	  async function writable(req: AuthedRequest, res: Response): Promise<ArtifactDoc | null> {
    67	    const { verdict, art } = await loadWritable(actorOf(req), req.params.id as string);
    68	    if (verdict === 'notfound') { notFound(res); return null; }
    69	    if (verdict === 'forbidden') { sendError(res, 'FORBIDDEN', 'Sem permissão.'); return null; }
    70	    return art!;
    71	  }
    72	
    73	  /**
    74	   * H1 HIGH-2 app-edit capability gate. `writable()`/ownership passes for an artifact the actor
    75	   * OWNS — but a plain `user` OWNS the apps they created, so ownership alone lets them change app
    76	   * CODE (bundle-update, file write, version restore, backend toggle/sample-run, app-data
    77	   * snapshot/restore). An in-place edit of a BUILT app additionally requires `canEditApps`
    78	   * (admin-only). NON-app artifacts stay user-manageable (the check is app-type-aware). Returns
    79	   * true (and writes the FORBIDDEN + details.capability refusal) when the edit is denied.
    80	   */
    81	  function denyAppEdit(req: AuthedRequest, res: Response, art: ArtifactDoc): boolean {
    82	    if (isAppArtifact(art) && !can(actorOf(req), 'canEditApps')) {
    83	      sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
    84	      return true;
    85	    }
    86	    return false;
    87	  }
    88	
    89	  // ---- base CRUD (ch03 §3.8.9) ----
    90	  r.get('/', async (req: AuthedRequest, res: Response) => {
    91	    const { items, featured } = await listArtifacts(actorOf(req));
    92	    res.json({ items: items.map(artifactView), featured: featured.map(artifactView) });
    93	  });
    94	
    95	  r.post('/', async (req: AuthedRequest, res: Response) => {
    96	    const body = parseBody(res, CreateArtifact, req.body) as { name: string; visibility?: 'private' | 'org' } | undefined;
    97	    if (!body) return;
    98	    // H1 capability gate: creating an artifact requires canCreateArtifacts (held by user +
    99	    // org-admin + super-admin — this is the base "artifacts area" capability, distinct from the
   100	    // app build/edit capabilities). Refusal is the FORBIDDEN envelope + details.capability.
   101	    if (!can(actorOf(req), 'canCreateArtifacts')) {
   102	      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: 'canCreateArtifacts' });
   103	    }
   104	    res.status(201).json(artifactView(await createArtifact(actorOf(req), body, deps)));
   105	  });
   106	
   107	  // ---- import must precede GET/:id-style matches (distinct verb+path) ----
   108	  r.post('/import', async (req: AuthedRequest, res: Response) => {
   109	    const body = parseBody(res, ImportArtifactRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle } | undefined;
   110	    if (!body) return;
   111	    // H1 HIGH-2: a bundle is always an app export; importing it CREATES and BUILDS a new app →
   112	    // canBuildApps (a plain user cannot import an app the same way they cannot first-build one).
   113	    if (!can(actorOf(req), 'canBuildApps')) {
   114	      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
   115	    }
   116	    const created = await importArtifact(body.bundle, actorOf(req), deps);
   117	    res.status(201).json(artifactView(created));
   118	  });
   119	
   120	  r.get('/:id', async (req: AuthedRequest, res: Response) => {
   121	    const a = await getVisibleArtifact(actorOf(req), req.params.id as string);
   122	    if (!a) return notFound(res);
   123	    res.json(artifactView(a));
   124	  });
   125	
   126	  r.patch('/:id', async (req: AuthedRequest, res: Response) => {
   127	    const body = parseBody(res, ArtifactPatch, req.body) as Record<string, unknown> | undefined;
   128	    if (!body) return;
   129	    // Strip server-owned reserved keys (e.g. `projectDir`) from any client `data` at the boundary
   130	    // before they reach the store — a client must never influence the build sandbox path (ch09).
   131	    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
   132	      body.data = stripReservedDataKeys(body.data as Record<string, unknown>);
   133	    }
   134	    const result = await patchArtifact(actorOf(req), req.params.id as string, body);
   135	    if (result.verdict === 'notfound') return notFound(res);
   136	    if (result.verdict === 'forbidden') {
   137	      if (typeof body.slug === 'string') return sendError(res, 'SLUG_TAKEN', 'Slug já em uso.');
   138	      return sendError(res, 'FORBIDDEN', 'Sem permissão.');
   139	    }
   140	    res.json(artifactView(result.artifact!));
   141	  });
   142	
   143	  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
   144	    const id = req.params.id as string;
   145	    // Revoke the backend BEFORE removing the row so no queued/in-flight invoke can
   146	    // run against a deleted artifact (C05-20 post-DELETE refusal, B19).
   147	    await getArtifactBackendRuntime().revoke(id);
   148	    const verdict = await deleteArtifact(actorOf(req), id);
   149	    if (verdict === 'notfound') return notFound(res);
   150	    if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
   151	    res.json({ ok: true });
   152	  });
   153	
   154	  // ---- fork / featured toggle ----
   155	  r.post('/:id/fork', async (req: AuthedRequest, res: Response) => {
   156	    const src = await readable(req, res);
   157	    if (!src) return;
   158	    // H1 HIGH-2: forking an APP builds a new one → canBuildApps; forking a NON-app artifact is a
   159	    // plain create → canCreateArtifacts (kept for users). App-type-aware so users still fork the
   160	    // artifacts they may create, but cannot mint apps.
   161	    const forkCap = isAppArtifact(src) ? 'canBuildApps' as const : 'canCreateArtifacts' as const;
   162	    if (!can(actorOf(req), forkCap)) {
   163	      return sendError(res, 'FORBIDDEN', forkCap === 'canBuildApps'
   164	        ? 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.'
   165	        : 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: forkCap });
   166	    }
   167	    const body = parseBody(res, ForkBody, req.body ?? {}) as { name?: string } | undefined;
   168	    if (!body) return;
   169	    const { artifact } = await forkArtifact(src._id, actorOf(req), deps, body.name);
   170	    res.status(201).json({ id: artifact._id, slug: artifact.slug });
   171	  });
   172	
   173	  r.put('/:id/featured', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
   174	    const body = parseBody(res, SetFeaturedRequest, req.body) as { featured: boolean; featuredRank?: number } | undefined;
   175	    if (!body) return;
   176	    const existing = await getArtifactById(req.params.id as string);
   177	    if (!existing) return notFound(res);
   178	    const updated = await setFeaturedFlag(req.params.id as string, body.featured, body.featuredRank);
   179	    res.json(artifactView(updated!));
   180	  });
   181	
   182	  // ---- bundle export / import / update-in-place ----
   183	  r.get('/:id/export', async (req: AuthedRequest, res: Response) => {
   184	    const art = await readable(req, res);
   185	    if (!art) return;
   186	    res.json(await exportArtifact(art));
   187	  });
   188	
   189	  r.post('/:id/bundle-update', async (req: AuthedRequest, res: Response) => {
   190	    const art = await writable(req, res);
   191	    if (!art) return;
   192	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: in-place app edit → canEditApps
   193	    const body = parseBody(res, BundleUpdateRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle; force?: boolean } | undefined;
   194	    if (!body) return;
   195	    try {
   196	      const result = await updateArtifactFromBundle(
   197	        art, body.bundle,
   198	        { force: body.force, authorName: req.user!.username, audit: auditOf(req), appDeps },
   199	        deps,
   200	      );
   201	      res.json({ artifact: artifactView(result.artifact), safetyNetSnapshotId: result.safetyNetSnapshotId, preUpdateVersionId: result.preUpdateVersionId });
   202	    } catch (err) {
   203	      if (err instanceof ManifestIdMismatchError) return sendError(res, 'MANIFEST_ID_MISMATCH', 'O pacote não corresponde a esta app. Confirme para atualizar mesmo assim.');
   204	      throw err;
   205	    }
   206	  });
   207	
   208	  r.post('/:id/featured-update/apply', async (req: AuthedRequest, res: Response) => {
   209	    const art = await writable(req, res);
   210	    if (!art) return;
   211	    await applyFeaturedUpdate(art._id, { authorName: req.user!.username, audit: auditOf(req), appDeps });
   212	    res.json({ ok: true });
   213	  });
   214	
   215	  r.post('/:id/featured-update/ignore', async (req: AuthedRequest, res: Response) => {
   216	    const art = await writable(req, res);
   217	    if (!art) return;
   218	    await ignoreFeaturedUpdate(art._id);
   219	    res.json({ ok: true });
   220	  });
   221	
   222	  // ---- versions ----
   223	  r.get('/:id/versions', async (req: AuthedRequest, res: Response) => {
   224	    const art = await readable(req, res);
   225	    if (!art) return;
   226	    const q = PaginationQuery.safeParse(req.query);
   227	    const limit = q.success && q.data.limit ? q.data.limit : 100;
   228	    res.json({ items: await listVersions(projectDirFor(art), limit) });
   229	  });
   230	
   231	  r.post('/:id/versions/:sha/restore', async (req: AuthedRequest, res: Response) => {
   232	    const art = await writable(req, res);
   233	    if (!art) return;
   234	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: restoring app code → canEditApps
   235	    const authorName = req.user!.username;
   236	    const result = await restoreAndRebuild(
   237	      art._id,
   238	      { projectDir: projectDirFor(art), sha: req.params.sha as string, authorName, authorEmail: `${authorName}@ekoa.local` },
   239	      art.name,
   240	    );
   241	    res.json({ newHeadSha: result.newHeadSha });
   242	  });
   243	
   244	  // ---- files (project-relative, confined server-side; P-15) ----
   245	  r.get('/:id/files', async (req: AuthedRequest, res: Response) => {
   246	    const art = await readable(req, res);
   247	    if (!art) return;
   248	    const projectDir = projectDirFor(art);
   249	    res.json({ files: await listArtifactFiles(projectDir), projectDir });
   250	  });
   251	
   252	  r.get('/:id/file', async (req: AuthedRequest, res: Response) => {
   253	    const art = await readable(req, res);
   254	    if (!art) return;
   255	    const q = ReadFileQuery.safeParse(req.query);
   256	    if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
   257	    try {
   258	      res.json({ content: await readArtifactFile(projectDirFor(art), q.data.path) });
   259	    } catch (err) {
   260	      if (err instanceof FilePathError) return notFound(res);
   261	      throw err;
   262	    }
   263	  });
   264	
   265	  r.put('/:id/file', async (req: AuthedRequest, res: Response) => {
   266	    const art = await writable(req, res);
   267	    if (!art) return;
   268	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: writing app source → canEditApps
   269	    const body = parseBody(res, WriteFileRequest, req.body) as { path: string; content: string } | undefined;
   270	    if (!body) return;
   271	    try {
   272	      const result = await writeArtifactFile(projectDirFor(art), body.path, body.content, req.user!.username, auditOf(req), { appId: art._id, appName: art.name });
   273	      res.json({ path: result.path, size: result.size, committed: result.committed, ...(result.warning ? { warning: result.warning } : {}) });
   274	    } catch (err) {
   275	      if (err instanceof FilePathError) return sendError(res, 'VALIDATION_FAILED', 'Caminho inválido.');
   276	      throw err;
   277	    }
   278	  });
   279	
   280	  // ---- download (zip; 422 on a planted credential) ----
   281	  r.get('/:id/download', async (req: AuthedRequest, res: Response) => {
   282	    const art = await readable(req, res);
   283	    if (!art) return;
   284	    const projectDir = projectDirFor(art);
   285	    let files;
   286	    try {
   287	      files = await collectAppFiles(projectDir); // secret-scan BEFORE any bytes go out
   288	    } catch (err) {
   289	      if (err instanceof SecretCommitError) {
   290	        return sendError(res, 'SECRET_GUARD_BLOCKED', 'Descarregamento bloqueado: a app contém uma credencial que tem de ser removida.');
   291	      }
   292	      throw err;
   293	    }
   294	    res.setHeader('Content-Type', 'application/zip');
   295	    res.setHeader('Content-Disposition', `attachment; filename="${safeZipName(art.slug || art.name || 'app')}.zip"`);
   296	    res.setHeader('Cache-Control', 'no-store');
   297	    try {
   298	      await streamFiles(files, res);
   299	    } catch {
   300	      if (!res.headersSent) res.status(500).end();
   301	      else res.destroy();
   302	    }
   303	  });
   304	
   305	  // ---- pdf (id charset-guarded; it becomes the output basename) ----
   306	  r.get('/:id/pdf', async (req: AuthedRequest, res: Response) => {
   307	    const id = req.params.id as string;
   308	    if (!isSafePdfBasename(id)) return sendError(res, 'VALIDATION_FAILED', 'Identificador inválido.');
   309	    const art = await readable(req, res);
   310	    if (!art) return;
   311	    // Render against the api's OWN loopback origin, NEVER the client-controlled Host header (Codex
   312	    // checkpoint): a spoofed Host would point the server-side render browser at an attacker origin
   313	    // (SSRF + attacker-controlled PDF content). The served-app plane is on this same process.
   314	    const origin = process.env.RENDER_ORIGIN ?? `http://127.0.0.1:${loadConfig().port}`;
   315	    try {
   316	      const result = await renderArtifactPdf({ url: `${origin}/apps/${id}/` }, id);
   317	      res.redirect(302, result.url);
   318	    } catch (err) {
   319	      // Chromium unavailable / render failure - degrade explicitly (ch07 §7.12).
   320	      sendError(res, 'UPSTREAM_UNAVAILABLE', `Não foi possível gerar o PDF: ${err instanceof Error ? err.message : String(err)}`);
   321	    }
   322	  });
   323	
   324	  // ---- app-data backups (ch03 §3.8.10) ----
   325	  r.get('/:id/backups', async (req: AuthedRequest, res: Response) => {
   326	    const art = await readable(req, res);
   327	    if (!art) return;
   328	    res.json(new AppDataBackups(appDeps).status(art._id));
   329	  });
   330	
   331	  r.post('/:id/backups', async (req: AuthedRequest, res: Response) => {
   332	    const art = await writable(req, res);
   333	    if (!art) return;
   334	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
   335	    res.json(await new AppDataBackups(appDeps).saveSnapshot(art._id, 'manual'));
   336	  });
   337	
   338	  r.get('/:id/backups/export', async (req: AuthedRequest, res: Response) => {
   339	    const art = await readable(req, res);
   340	    if (!art) return;
   341	    res.json(await new AppDataBackups(appDeps).exportAll(art._id));
   342	  });
   343	
   344	  r.post('/:id/backups/preview', async (req: AuthedRequest, res: Response) => {
   345	    const art = await readable(req, res);
   346	    if (!art) return;
   347	    const body = parseBody(res, BackupPointRef, req.body) as { pointId: string; source: string; at: string } | undefined;
   348	    if (!body) return;
   349	    try {
   350	      res.json(await new AppDataBackups(appDeps).previewAsOf(art._id, body));
   351	    } catch (err) {
   352	      return sendError(res, 'NOT_FOUND', err instanceof Error ? err.message : 'Ponto de restauro não encontrado.');
   353	    }
   354	  });
   355	
   356	  r.post('/:id/backups/restore', async (req: AuthedRequest, res: Response) => {
   357	    const art = await writable(req, res);
   358	    if (!art) return;
   359	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
   360	    const body = parseBody(res, BackupPointRef, req.body) as { pointId: string; source: string; at: string } | undefined;
   361	    if (!body) return;
   362	    res.json(await new AppDataBackups(appDeps).restoreTo(art._id, body));
   363	  });
   364	
   365	  // ---- artifact backend (ch03 §3.8.11) ----
   366	  r.get('/:id/backend', async (req: AuthedRequest, res: Response) => {
   367	    const art = await readable(req, res);
   368	    if (!art) return;
   369	    const declared = await readDeclaredBackend(art);
   370	    const status = getArtifactBackendRuntime().getStatus(art._id);
   371	    res.json({ hasBackend: !!declared, status: status.state, declared: declared ?? null, runtime: status });
   372	  });
   373	
   374	  r.get('/:id/backend/logs', async (req: AuthedRequest, res: Response) => {
   375	    const art = await readable(req, res);
   376	    if (!art) return;
   377	    const q = PaginationQuery.safeParse(req.query);
   378	    const limit = q.success && q.data.limit ? q.data.limit : 100;
   379	    res.json({ items: getArtifactBackendRuntime().getRecentLogs(art._id, limit).map(logView) });
   380	  });
   381	
   382	  r.get('/:id/backend/invocations', async (req: AuthedRequest, res: Response) => {
   383	    const art = await readable(req, res);
   384	    if (!art) return;
   385	    const q = PaginationQuery.safeParse(req.query);
   386	    const limit = q.success && q.data.limit ? q.data.limit : 20;
   387	    res.json({ items: getArtifactBackendRuntime().getInvocations(art._id, limit).map(invocationView) });
   388	  });
   389	
   390	  r.put('/:id/backend/enabled', async (req: AuthedRequest, res: Response) => {
   391	    const art = await writable(req, res);
   392	    if (!art) return;
   393	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: a backend exists only on an app → canEditApps
   394	    const body = parseBody(res, BackendSetEnabledRequest, req.body) as { enabled: boolean } | undefined;
   395	    if (!body) return;
   396	    getArtifactBackendRuntime().setEnabled(art._id, body.enabled);
   397	    res.json({ enabled: body.enabled });
   398	  });
   399	
   400	  r.post('/:id/backend/sample-run', async (req: AuthedRequest, res: Response) => {
   401	    const art = await writable(req, res);
   402	    if (!art) return;
   403	    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: invoking an app's backend → canEditApps
   404	    const body = parseBody(res, BackendSampleRunRequest, req.body) as { entrypoint: string; input: unknown } | undefined;
   405	    if (!body) return;
   406	    const declared = await readDeclaredBackend(art);
   407	    const entrypoint = (body.entrypoint || declared?.handlers?.[0] || '').trim();
   408	    if (!entrypoint) return sendError(res, 'VALIDATION_FAILED', 'É necessário um entrypoint (nenhum handler declarado).');
   409	    const result = await getArtifactBackendRuntime().invoke(art._id, entrypoint, body.input, { dryRun: true, invokedBy: 'sample' });
   410	    res.json({ result, ...(result.dryRunEffects ? { dryRunEffects: result.dryRunEffects } : {}) });
   411	  });
   412	
   413	  return r;
   414	}
   415	
   416	function logView(l: BackendLogEntry) {
   417	  return { at: l.at, level: l.level, message: l.msg, ...(l.meta ? { meta: l.meta } : {}) };
   418	}
   419	function invocationView(i: InvocationRecord) {
   420	  return { id: i.invokeId, entrypoint: i.entrypoint, at: i.startedAt, status: i.ok ? 'ok' : 'error', durationMs: i.durationMs };
   421	}

exec
/bin/zsh -lc "nl -ba api/src/apps/build-mechanics.ts | sed -n '220,270p'
nl -ba api/src/routes/artifacts.ts | sed -n '1,170p'
nl -ba api/src/routes/artifacts.ts | sed -n '170,320p'
nl -ba api/src/routes/artifacts.ts | sed -n '320,430p'
nl -ba api/src/server.ts | sed -n '680,730p'
find /Users/ggomes/dev/ekoa-code -name PRD.md -o -name PLANING.md -o -name TASKS.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 1270ms:
 succeeded in 26655ms:
/../pnmui-mon/TASKS.md

codex
The revocation fix mostly looks structurally right. I’m checking one remaining edge now: whether every code path that mutates `billingLocked` or revocation state actually writes the durable `UserDoc` fields, not just the in-memory map.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"billingLocked|setActivation\\(|bumpTokenEpochDurable|tokenEpoch\" api/src" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/auth/service.ts:46: * with `iat < tokenEpoch`; because JWT `iat` has ONE-SECOND granularity, a login in the same
api/src/auth/service.ts:53:  return Math.max(nowSec, getActivation(userId)?.tokenEpoch ?? 0);
api/src/auth/service.ts:62: * restarts. Callers that already touch the row in their own `users.update` fold `tokenEpoch` into
api/src/auth/service.ts:65:export async function bumpTokenEpochDurable(userId: string, epochSec: number): Promise<void> {
api/src/auth/service.ts:67:  await users.update(userId, (u) => ({ ...u, tokenEpoch: epochSec }));
api/src/auth/service.ts:86:  setActivation(userId, { active: true, billingLocked: false });
api/src/auth/service.ts:102:  // Prefer the durable column values (H1: persisted `billingLocked`/`tokenEpoch`) so a lock and a
api/src/auth/service.ts:105:  setActivation(u._id, {
api/src/auth/service.ts:107:    billingLocked: u.billingLocked ?? cached?.billingLocked ?? false,
api/src/auth/service.ts:108:    tokenEpoch: u.tokenEpoch ?? cached?.tokenEpoch ?? 0,
api/src/auth/service.ts:144:  await bumpTokenEpochDurable(targetUserId, Math.floor(Date.now() / 1000) + 1);
api/src/auth/service.ts:166:  await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: false, tokenEpoch: epochSec }));
api/src/auth/service.ts:182:  const updated = await users.update(userId, (doc) => ({ ...doc, passwordHash, passwordChangeRequired: true, tokenEpoch: epochSec }));
api/src/auth/service.ts:213:  const newEpoch = active ? cur?.tokenEpoch ?? 0 : epochSec;
api/src/auth/service.ts:214:  const billingLocked = cur?.billingLocked ?? false;
api/src/auth/service.ts:215:  setActivation(userId, { active, billingLocked, tokenEpoch: newEpoch });
api/src/auth/service.ts:219:  const updated = await users.update(userId, (u) => ({ ...u, active, tokenEpoch: newEpoch, billingLocked }));
api/src/auth/service.ts:222:    if (cur) setActivation(userId, cur);
api/src/bridge/server.ts:50:  getActivation?: (userId: string) => { active: boolean; billingLocked: boolean } | undefined;
api/src/bridge/server.ts:154:      if (act.billingLocked) return refuse(socket, 402, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.');
api/src/data/activation.ts:11:  billingLocked: boolean;
api/src/data/activation.ts:15:  tokenEpoch: number;
api/src/data/activation.ts:21:export function loadActivation(entries: Array<{ userId: string; active: boolean; billingLocked?: boolean; tokenEpoch?: number }>): void {
api/src/data/activation.ts:23:  for (const e of entries) map.set(e.userId, { active: e.active, billingLocked: e.billingLocked ?? false, tokenEpoch: e.tokenEpoch ?? 0 });
api/src/data/activation.ts:36:  const cur = map.get(userId) ?? { active: true, billingLocked: false, tokenEpoch: 0 };
api/src/data/activation.ts:37:  map.set(userId, { ...cur, tokenEpoch: epochSec });
api/src/data/activation.ts:41: *  `tokenEpoch` is preserved from the existing entry unless explicitly provided. */
api/src/data/activation.ts:42:export function setActivation(userId: string, state: { active: boolean; billingLocked: boolean; tokenEpoch?: number }): void {
api/src/data/activation.ts:44:  map.set(userId, { active: state.active, billingLocked: state.billingLocked, tokenEpoch: state.tokenEpoch ?? prev?.tokenEpoch ?? 0 });
api/src/auth/users-service.ts:41:  setActivation(id, { active: true, billingLocked: false });
api/src/auth/users-service.ts:63:    await users.update(target._id, (u) => ({ ...u, role: patch.role as UserDoc['role'], tokenEpoch: epochSec }));
api/src/auth/users-service.ts:101:    await users.update(u._id, (doc) => ({ ...doc, role: 'user', tokenEpoch: epochSec }));
api/src/bridge/provider.ts:44:  getActivation?: (userId: string) => { active: boolean; billingLocked: boolean } | undefined;
api/src/bridge/provider.ts:151:      if (act.billingLocked) {
api/src/data/stores.ts:22:  tokenEpoch?: number;
api/src/data/stores.ts:26:  billingLocked?: boolean;
api/src/bridge/delegation.ts:48:  getActivation?: (userId: string) => { active: boolean; billingLocked: boolean } | undefined;
api/src/bridge/delegation.ts:121:  if (!act || !act.active || act.billingLocked) return terminalResult('denied');
api/src/auth/jwt.ts:28: *  or the middleware's `iat < tokenEpoch` check rejects it: JWT `iat` has one-second
api/src/auth/middleware.ts:49:  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) {
api/src/auth/middleware.ts:52:  if (act.billingLocked) return fail(res, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.');
api/src/auth/middleware.ts:71:  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
api/src/legal/access-gate.ts:131:    if (activation.billingLocked) {
api/src/server.ts:679:  // Reload the FULL admission state per user, not just `active` (H1): the durable `tokenEpoch` and
api/src/server.ts:680:  // `billingLocked` columns must survive restart, or every revocation and every billing lock resets
api/src/server.ts:683:  loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active, billingLocked: u.billingLocked, tokenEpoch: u.tokenEpoch })));
api/src/integrations/app-scope.ts:53:  if (activation.billingLocked) {
api/src/apps/app-assistant-route.ts:95:    if (activation.billingLocked) {
api/src/apps/app-files.ts:124:    if (activation.billingLocked) {
api/src/apps/served-data.ts:96:    if (activation.billingLocked) {

exec
/bin/zsh -lc 'codegraph explore "billingLocked setActivation update users.update lock billing allowBilling user billing routes"' in /Users/ggomes/dev/ekoa-code
 succeeded in 532ms:
## Exploration: billingLocked setActivation update users.update lock billing allowBilling user billing routes

Found 198 symbols across 80 files.

### Blast radius — what depends on these (update/verify before editing)

- `setActivation` (api/src/data/activation.ts:42) — 52 callers in `api/src/auth/service.ts`, `api/src/auth/users-service.ts`; tests: `api/tests/contract/mount-coverage.test.ts`, `api/tests/auth/activation-auth.test.ts`, `api/tests/contract/artifact-family.test.ts`, `api/tests/contract/auth.test.ts` +25
- `update` (api/assets/featured-artifacts/erp-imobiliario/scaffold/frontend/src/App.jsx:9652) — 18 callers in `api/assets/featured-artifacts/erp-imobiliario/scaffold/frontend/src/App.jsx`; ⚠️ no covering tests found

### Relationships

**calls:**
- makeUser → setActivation
- mkUser → setActivation
- mkUser → setActivation
- mkUser → setActivation
- mkUser → setActivation
- mkUser → setActivation
- mkUser → setActivation
- mkUser → setActivation
- mkUser → setActivation
- mkUser → setActivation
- ... and 246 more

**references:**
- ReplayResult → PerUserParity
- replay → PerUserParity
- ReplayResult → ExpectedAggregates
- ReplayResult → PerEventMismatch
- printHuman → ReplayResult
- drive → MarkerProcessor
- App → onKey
- App → onKeyDown
- replay → PerEventMismatch
- replay → ReplayResult
- ... and 6 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/auth/service.ts — calls(calls), setActivation(calls), Deps(references), now(calls), find(calls), insert(calls), references(references), instantiates(instantiates), bumpTokenEpochDurable(function), seedAdmin(function), +3 more

```typescript
62	 * restarts. Callers that already touch the row in their own `users.update` fold `tokenEpoch` into
63	 * that write instead of calling this; this helper is for the standalone bumps (e.g. admin logout).
64	 */
65	export async function bumpTokenEpochDurable(userId: string, epochSec: number): Promise<void> {
66	  bumpTokenEpoch(userId, epochSec);
67	  await users.update(userId, (u) => ({ ...u, tokenEpoch: epochSec }));
68	}
69	
70	/** First-boot super-admin seeding: creates the founder's org + super-admin account if absent. */
71	export async function seedAdmin(username: string, password: string, deps: Deps): Promise<void> {
72	  const existing = await users.find({ role: 'super-admin' });
73	  if (existing.length > 0) return;
74	  const orgId = deps.genId();
75	  await orgs.insert({ _id: orgId, name: 'Founder', displayName: 'Founder', createdAt: new Date(deps.now()).toISOString() });
76	  const userId = deps.genId();
77	  await users.insert({
78	    _id: userId,
79	    username,
80	    passwordHash: await hashPassword(password),
81	    role: 'super-admin',
82	    orgId,
83	    active: true,
84	    passwordChangeRequired: true,
85	  });
86	  setActivation(userId, { active: true, billingLocked: false });
87	}
88	
89	export async function login(username: string, password: string, rememberMe: boolean, deps: Deps): Promise<{ token: string; user: AuthUserView; passwordChangeRequired: boolean; expiresIn: number }> {
90	  const matches = await users.find({ username });
91	  const u = matches[0];
92	  if (!u || !(await verifyPassword(password, u.passwordHash))) {
93	    throw new AuthError('UNAUTHENTICATED', 401, 'Credenciais inválidas.');
94	  }
95	  // Deactivated accounts cannot mint a token (ACCOUNT_DISABLED). Check the AUTHORITATIVE
96	  // store field (login holds the row — no cache-miss window) and sync the write-through
97	  // map so the middleware is consistent. A billing lock does NOT block login — the account
98	  // authenticates and is refused per-request at the admission plane (middleware) with
99	  // BILLING_LOCKED (ch09 §9.7.1); that lock is preserved in the map from its cached value.
100	  const cached = getActivation(u._id);
101	  // Sync the write-through map from the AUTHORITATIVE row (login holds it — no cache-miss window).
102	  // Prefer the durable column values (H1: persisted `billingLocked`/`tokenEpoch`) so a lock and a
103	  // revocation survive a restart even on a cold cache; fall back to the cached map value, then the
104	  // default. The epoch carried here also feeds mintIat below (a pre-bump token stays dead).
105	  setActivation(u._id, {
106	    active: u.active,
107	    billingLocked: u.billingLocked ?? cached?.billingLocked ?? false,
108	    tokenEpoch: u.tokenEpoch ?? cached?.tokenEpoch ?? 0,
109	  });
110	  if (!u.active) throw new AuthError('ACCOUNT_DISABLED', 403, 'A sua conta está bloqueada. Contacte o suporte.');
111	  const { token, expiresIn } = signToken(
112	    { sub: u._id, role: u.role, scope: 'user', orgId: u.orgId, username: u.username, jti: `${u._id}.${deps.genId()}`, iat: mintIat(u._id) },
113	    rememberMe,
114	  );
115	  // Registo (F3): a login is an org-visible activity — metadata-only, never the password. The
116	  // single audit write path (FIXED-8); best-effort so a bookkeeping write never fails a login.
117	  await logActivity({ userId: u._id, username: u.username, orgId: u.orgId }, 'auth', 'login', deps, { rememberMe }).catch(() => undefined);
118	  return { token, user: view(u), passwordChangeRequired: !!u.passwordChangeRequired, expiresIn };
119	}
120	
121	/**
122	 * Logout (F1, ch03 §3.8.1). Self: revoke the caller's jti (the middleware checks isRevoked on

... (gap) ...

190	 * (2) updates the write-through activation map synchronously, (3) revokes the user's tokens.
191	 * `jtisToRevoke` are the user's outstanding token ids known to the caller/session registry.
192	 */
193	export async function setUserActive(
194	  userId: string,
195	  active: boolean,
196	  jtisToRevoke: Array<{ jti: string; expiresAtSec: number }>,
197	  deps: Deps,
198	): Promise<AuthUserView | null> {
199	  const cur = getActivation(userId);
200	  // MAP FIRST, synchronously (ch09 §9.7.1: the toggle updates the map synchronously so the
201	  // effect is immediate) — this closes the TOCTOU window where a concurrent login between
202	  // the store write and the cache update could mint a token off the stale cache. On
203	  // deactivation the token epoch is bumped so EVERY outstanding token is invalidated at once
204	  // (no per-user jti index needed); any explicitly-known jtis are additionally revoked.
205	  // The token epoch shares the JWT `iat` clock (real seconds), strictly after any token
206	  // minted this second, so every outstanding token is invalidated. deps.now drives stored
207	  // record timestamps; the epoch must track real time to align with jsonwebtoken's iat.
208	  const epochSec = Math.floor(Date.now() / 1000) + 1;
209	  // A deactivation bumps the epoch (invalidating every outstanding token); a re-activation keeps
210	  // the prior epoch. Both the epoch and the billing lock are persisted to the row in the SAME
211	  // operation as `active` (H1 durability), so a deactivation's revocation is not un-done on restart
212	  // and a billing lock is not reset to false at boot.
213	  const newEpoch = active ? cur?.tokenEpoch ?? 0 : epochSec;
214	  const billingLocked = cur?.billingLocked ?? false;
215	  setActivation(userId, { active, billingLocked, tokenEpoch: newEpoch });
216	  if (!active) {
217	    for (const t of jtisToRevoke) await revoke(t.jti, userId, t.expiresAtSec, deps.now());
218	  }
219	  const updated = await users.update(userId, (u) => ({ ...u, active, tokenEpoch: newEpoch, billingLocked }));
220	  if (!updated) {
221	    // The user vanished — restore the prior cache entry if we had one to avoid a phantom state.
222	    if (cur) setActivation(userId, cur);
223	    return null;
224	  }
225	  return view(updated);
226	}
227	
228	export { view as authUserView };
229	
```

#### api/src/data/activation.ts — setActivation(function), map(constant)

```typescript
1	/**
2	 * The activation cache (ch09 §9.7.1, Amendment 2). An in-memory map with write-through
3	 * invalidation: a `PATCH /users/:id { active }` write updates this map synchronously in
4	 * the same operation, so deactivation is effective immediately with NO TTL wait. Sound
5	 * under FIXED-8 (single process): the in-memory map is authoritative for the running process.
6	 * The three admission planes (auth middleware, served-app plane, bridge plane) all consult
7	 * this one map. Two gated facts: `active` and an account-level billing lock.
8	 */
9	export interface ActivationState {
10	  active: boolean;
11	  billingLocked: boolean;
12	  /** Tokens issued before this epoch (unix seconds) are invalid. Bumped on deactivation and
13	   *  on role change, so those changes revoke ALL of the user's outstanding tokens at once —
14	   *  a demoted admin cannot keep a stale privileged JWT (ch09 §9.6, no per-user jti index). */
15	  tokenEpoch: number;
16	}
17	
18	const map = new Map<string, ActivationState>();
19	
20	/** Boot-load the map from the users store (called at boot; TTL refresh is a safety net only). */
21	export function loadActivation(entries: Array<{ userId: string; active: boolean; billingLocked?: boolean; tokenEpoch?: number }>): void {
22	  map.clear();
23	  for (const e of entries) map.set(e.userId, { active: e.active, billingLocked: e.billingLocked ?? false, tokenEpoch: e.tokenEpoch ?? 0 });
24	}
25	
26	/** Drop a user from the map entirely (account DELETION). `getActivation` then returns undefined
27	 *  and every admission plane fails CLOSED (an unknown subject is never active), so a deleted
28	 *  user's outstanding tokens die at once instead of surviving to their JWT expiry — and, with
29	 *  /auth/refresh mounted (F1), instead of being re-signable indefinitely. */
30	export function clearActivation(userId: string): void {
31	  map.delete(userId);
32	}
33	
34	/** Bump the user's token epoch to `epochSec`, invalidating every token issued earlier. */
35	export function bumpTokenEpoch(userId: string, epochSec: number): void {
36	  const cur = map.get(userId) ?? { active: true, billingLocked: false, tokenEpoch: 0 };
37	  map.set(userId, { ...cur, tokenEpoch: epochSec });
38	}
39	
40	/** Write-through: called in the SAME operation as the store write for `active`/billing lock.
41	 *  `tokenEpoch` is preserved from the existing entry unless explicitly provided. */
42	export function setActivation(userId: string, state: { active: boolean; billingLocked: boolean; tokenEpoch?: number }): void {
43	  const prev = map.get(userId);
44	  map.set(userId, { active: state.active, billingLocked: state.billingLocked, tokenEpoch: state.tokenEpoch ?? prev?.tokenEpoch ?? 0 });
45	}
46	
47	/**
48	 * Consult the cache. Returns `undefined` for an unknown user — the map is boot-loaded with
49	 * EVERY user and every creation is write-through, so a miss means the subject is not a
50	 * current user (a stale or forged token). Callers fail CLOSED on a miss (never fail-open:
51	 * an unknown subject must not be treated as active, or a deactivation lost from the cache
52	 * would reopen access — ch09 §9.7.1, the map is authoritative for the running process).
53	 */
54	export function getActivation(userId: string): ActivationState | undefined {
55	  return map.get(userId);
56	}
57	
58	export function __resetActivationForTests(): void {
59	  map.clear();
60	}
```

#### web/stores/automations.ts — map(calls), set(calls), normalizeWireAutomation(function), references(references), update(function), tryCall(calls), patch(calls), normalizeWireAutomation(calls)

```typescript
154	 * `a.steps.length` crashed the /automations page on ANY non-empty list (latent until
155	 * integration-managed automations started materializing rows).
156	 */
157	function normalizeWireAutomation(raw: unknown): Automation {
158	  const w = raw as Automation & {
159	    plan?: { steps?: Array<{ stepId?: string; description?: string; tool?: string }> };
160	    ownerId?: string;
161	  };
162	  const steps = Array.isArray(w.steps)
163	    ? w.steps
164	    : (w.plan?.steps ?? []).map((s, i) => ({
165	        id: s.stepId ?? `step-${i + 1}`,
166	        description: s.description ?? '',
167	        type: (s.tool ?? 'browser') as Automation['steps'][number]['type'],
168	      }));
169	  return {
170	    ...w,
171	    steps,
172	    // The wire omits an empty description (the editor's goal field trims it — a required
173	    // string here) and names the owner `ownerId`.
174	    description: w.description ?? '',
175	    ownerUserId: w.ownerUserId ?? w.ownerId ?? '',
176	  };
177	}
178	
179	// ============================================================================
180	// Store

... (gap) ...

228	    return null;
229	  },
230	
231	  async update(id, patch) {
232	    const res = await tryCall(() => api.automations.patch({ id, ...patch }));
233	    if (res.ok) {
234	      const updated = normalizeWireAutomation(res.data as unknown);
235	      set((s) => ({
236	        automations: s.automations.map((a) => (a.id === id ? updated : a)),
237	        current: s.current?.id === id ? updated : s.current,
238	      }));
239	      return updated;
240	    }
241	    set({ error: res.error.message || 'failed to update' });
242	    return null;
243	  },
244	
245	  async remove(id) {
246	    const res = await tryCall(() => api.automations.remove({ id }));
```

#### api/src/data/stores.ts — UserSettingsDoc(interface)

```typescript
1	/**
2	 * Platform domain stores (ch04 §4.3.1). Every store is a `Store<T>` over one physical
3	 * Mongo collection. Names and tenancy carried from the §4.3.1 map. The `teams` store is
4	 * DROPPED (Amendment 2); the dual app-data backend selector is not carried (§4.2.8) —
5	 * Firestore Mongo-compat is the only backend.
6	 */
7	import { Store, type Doc } from './store.js';
8	
9	// --- Core identity / tenancy ---
10	export interface UserDoc extends Doc {
11	  username: string;
12	  passwordHash: string;
13	  role: 'super-admin' | 'org-admin' | 'user';
14	  orgId: string;
15	  active: boolean;
16	  passwordChangeRequired?: boolean;
17	  /** Durable revocation clock (unix seconds): a token whose `iat` is earlier than this is invalid.
18	   *  Bumped on EVERY revocation (role change, password change/reset, admin logout, deactivation, the
19	   *  builder→user migration) and written to the row in the SAME operation as the in-memory
20	   *  `bumpTokenEpoch`. Persisted here because `loadActivation` reloads the activation map from these
21	   *  rows at boot — without the column every revocation silently un-does on the next restart (H1). */
22	  tokenEpoch?: number;
23	  /** Durable account-level billing lock. Persisted (and boot-reloaded via `loadActivation`) so a
24	   *  lock is not reset to `false` on every process restart — the in-memory activation map alone
25	   *  defaulted it to `false` at boot (H1; the carried LANDING billing-lock item). */
26	  billingLocked?: boolean;
27	  preferences?: Record<string, unknown>;
28	}
29	export interface OrgDoc extends Doc {
30	  name: string;
31	  displayName?: string;
32	  branding?: Record<string, unknown>;
33	  settings?: Record<string, unknown>;
34	  createdAt: string;
35	  /** Stamped by updateOrg on every patch — the web's re-sync fingerprint (a branding page left
36	   *  open must pick up a research merge without a reload; live 2026-07-12). */
37	  updatedAt?: string;
38	}
39	export interface CredentialsDoc extends Doc {
40	  // singleton _id: 'default'
41	  credentialCiphertext?: string;
42	  mode: 'oauth' | 'api-key';
43	  refreshMeta?: Record<string, unknown>;
44	}
45	export interface RevokedTokenDoc extends Doc {
46	  userId: string;
47	  revokedAt: string;
48	  expiresAt: number; // epoch seconds
49	}
50	export interface SessionDoc extends Doc {
51	  userId: string;
52	  /** Store-side name (ch04 §4.3.1 carries `title`); the wire field is `name` (ch03 §3.8.6). */
53	  title?: string;
54	  type?: string;
55	  artifactId?: string;
56	  status?: string;
57	  messageCount?: number;
58	  createdAt: string;
59	  updatedAt: string;
60	}
61	export interface ActivityLogDoc extends Doc {
62	  userId: string;
63	  username: string;
64	  orgId: string;
65	  category: string;
66	  type: string;
67	  timestamp: string;
68	  metadata?: Record<string, unknown>;
69	}
70	export interface SettingsDoc extends Doc {
71	  [k: string]: unknown;
72	}
73	export interface UserSettingsDoc extends Doc {
74	  build?: { verifyBuilds?: boolean };
75	  memory?: { autoExtract?: boolean };
76	  [k: string]: unknown;
77	}
78	
79	export const users = new Store<UserDoc>('users');
80	export const orgs = new Store<OrgDoc>('orgs');
81	export const credentials = new Store<CredentialsDoc>('credentials');
82	export const revokedTokens = new Store<RevokedTokenDoc>('revoked_tokens');
83	export const sessions = new Store<SessionDoc>('sessions');
84	export const messages = new Store<Doc>('messages');
85	export const sessionContexts = new Store<Doc>('session_contexts');
86	export const memories = new Store<Doc>('memories');
87	export const artifacts = new Store<Doc>('artifacts');
88	export const slugs = new Store<Doc>('slugs');
89	export const integrationConfigs = new Store<Doc>('integration_configs');
90	/** Integration-builder chat sessions (ch03 §3.8.14). PERSISTED — the old cortex builder kept an
91	 *  in-memory Map that died on restart; load-by-key durability requires a store. Holds the running
92	 *  transcript + the last generated package/skill so a session can be reloaded and edited. */
93	export const integrationBuilderSessions = new Store<Doc>('integration_builder_sessions');
94	export const activityLogs = new Store<ActivityLogDoc>('activity_logs');
95	export const jobs = new Store<Doc>('jobs');
96	export const settings = new Store<SettingsDoc>('settings');
97	export const userSettings = new Store<UserSettingsDoc>('user_settings');
98	export const tokenEvents = new Store<Doc>('token_events');
99	export const billingAccounts = new Store<Doc>('billing_accounts');
100	export const automations = new Store<Doc>('automations');
101	export const automationRuns = new Store<Doc>('automation_runs');
102	export const approvedCommands = new Store<Doc>('approved_commands');
103	export const triggers = new Store<Doc>('triggers');
104	export const appSessions = new Store<Doc>('app_sessions');
105	export const appSsoPending = new Store<Doc>('app_sso_pending');
106	export const adobeAgreements = new Store<Doc>('adobe_agreements');
107	export const knowledgeSources = new Store<Doc>('knowledge_sources');
108	export const knowledgeUploads = new Store<Doc>('knowledge_uploads');
109	export const anonymisationDenyLists = new Store<Doc>('anonymisation_deny_lists');
110	export const bridgePairings = new Store<Doc>('bridge_pairings');
111	export const eventQueue = new Store<Doc>('event_queue');
112	export const webhookAudit = new Store<Doc>('webhook_audit');
```

#### web/stores/user-settings.ts — UserSettingsState(interface)

```typescript
1	'use client';
2	
3	/**
4	 * User Settings Store (Amendment 2, FC-504/FC-506/FC-507)
5	 *
6	 * The two per-user toggles that ride `user_settings` (not org settings):
7	 *   - `build.verifyBuilds`  — verify each build (default ON, FC-507)
8	 *   - `memory.autoExtract`  — automatic memory extraction (default ON, FC-504)
9	 *
10	 * Read from the merged view `GET /api/v1/settings` (which carries the caller's
11	 * per-user toggles alongside org settings) and written through the per-user
12	 * patch `PATCH /api/v1/settings/me` (ch03 §3.8.5). Kept separate from the org
13	 * settings store (`web/stores/settings.ts`, `PATCH /settings`, org-admin) so the
14	 * two write paths never cross.
15	 */
16	
17	import { create } from 'zustand';
18	import { api, tryCall } from '@/lib/api';
19	
20	interface UserSettingsState {
21	  verifyBuilds: boolean;
22	  autoExtract: boolean;
23	  isLoaded: boolean;
24	  isSaving: boolean;
25	
26	  fetchUserSettings: () => Promise<void>;
27	  setVerifyBuilds: (value: boolean) => Promise<void>;
28	  setAutoExtract: (value: boolean) => Promise<void>;
29	}
30	
31	export const useUserSettingsStore = create<UserSettingsState>()((set, get) => ({
32	  // Both default ON (P-12 re-resolved / Part 6), matched until the server view loads.
33	  verifyBuilds: true,
34	  autoExtract: true,
35	  isLoaded: false,
36	  isSaving: false,
37	
38	  fetchUserSettings: async () => {
39	    const res = await tryCall(() => api.settings.get());
40	    if (res.ok) {
41	      const data = res.data as { build?: { verifyBuilds?: boolean }; memory?: { autoExtract?: boolean } };
42	      set({
43	        verifyBuilds: data.build?.verifyBuilds ?? true,
44	        autoExtract: data.memory?.autoExtract ?? true,
45	        isLoaded: true,
46	      });
47	    } else {
48	      set({ isLoaded: true });
49	    }
50	  },
51	
52	  setVerifyBuilds: async (value) => {
53	    const previous = get().verifyBuilds;
54	    set({ verifyBuilds: value, isSaving: true });
55	    const res = await tryCall(() => api.settings.updateMe({ build: { verifyBuilds: value } }));
56	    if (!res.ok) set({ verifyBuilds: previous });
57	    set({ isSaving: false });
58	  },
59	
60	  setAutoExtract: async (value) => {
61	    const previous = get().autoExtract;
62	    set({ autoExtract: value, isSaving: true });
63	    const res = await tryCall(() => api.settings.updateMe({ memory: { autoExtract: value } }));
64	    if (!res.ok) set({ autoExtract: previous });
65	    set({ isSaving: false });
66	  },
67	}));
```

#### shared/src/settings.ts — UserSettingsPatch(type_alias)

```typescript
1	/** Settings domain contract (ch03 §3.8.5): merged org + per-user settings view. */
2	import { z } from 'zod';
3	import type { DomainDescriptorMap } from './descriptor.js';
4	
5	/** Per-user integration toggles surfaced in the merged view. */
6	export const IntegrationSettings = z
7	  .object({ pipedreamEnabled: z.boolean() })
8	  .passthrough();
9	export type IntegrationSettings = z.infer<typeof IntegrationSettings>;
10	
11	/** Per-user build toggle (rides `user_settings`, not org settings; ch03 §3.8.5). */
12	export const BuildSettings = z.object({ verifyBuilds: z.boolean() }).passthrough();
13	export type BuildSettings = z.infer<typeof BuildSettings>;
14	
15	/** Per-user memory toggle (rides `user_settings`, not org settings; ch03 §3.8.19). */
16	export const MemorySettings = z.object({ autoExtract: z.boolean() }).passthrough();
17	export type MemorySettings = z.infer<typeof MemorySettings>;
18	
19	/** Merged view: org settings plus the caller's per-user toggles (ch03 §3.8.5). */
20	export const PlatformSettings = z
21	  .object({
22	    integration: IntegrationSettings,
23	    build: BuildSettings,
24	    memory: MemorySettings,
25	  })
26	  .passthrough();
27	export type PlatformSettings = z.infer<typeof PlatformSettings>;
28	
29	/** Deep-partial patch of org settings; never touches the per-user toggles (ch03 §3.8.5). */
30	export const PlatformSettingsPatch = z
31	  .object({
32	    integration: z.object({ pipedreamEnabled: z.boolean().optional() }).passthrough().optional(),
33	  })
34	  .passthrough();
35	export type PlatformSettingsPatch = z.infer<typeof PlatformSettingsPatch>;
36	
37	/** Per-user settings patch: only the two `user_settings` toggles (ch03 §3.8.5, Amendment 2). */
38	export const UserSettingsPatch = z
39	  .object({
40	    build: z.object({ verifyBuilds: z.boolean().optional() }).optional(),
41	    memory: z.object({ autoExtract: z.boolean().optional() }).optional(),
42	  })
43	  .passthrough();
44	export type UserSettingsPatch = z.infer<typeof UserSettingsPatch>;
45	
46	export const settingsEndpoints = {
47	  get: {
48	    method: 'GET',
49	    path: '/api/v1/settings',
50	    auth: 'user',
51	    response: PlatformSettings,
52	  },
53	  update: {
54	    method: 'PATCH',
55	    path: '/api/v1/settings',
56	    auth: 'org-admin',
57	    request: PlatformSettingsPatch,
58	    response: PlatformSettings,
59	  },
60	  updateMe: {
61	    method: 'PATCH',
62	    path: '/api/v1/settings/me',
63	    auth: 'user',
64	    request: UserSettingsPatch,
65	    response: PlatformSettings,
66	  },
67	} as const satisfies DomainDescriptorMap;
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/src/routes/jobs.ts | sed -n '35,70p'
nl -ba api/src/apps/app-paths.ts | sed -n '67,112p'
nl -ba api/src/auth/middleware.ts | sed -n '40,75p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
    35	  r.use(requireAuth);
    36	
    37	  r.post('/', async (req: AuthedRequest, res: Response) => {
    38	    const body = parseBody(res, JobCreateRequest, req.body);
    39	    if (!body) return;
    40	    const actor = actorOf(req);
    41	    // Capability + ownership gates BEFORE any job is created or agent spawned (H1). Refusals carry
    42	    // the FORBIDDEN envelope with `details.capability` (the machine-readable hook the H4
    43	    // request-to-admin flow consumes); object-ownership denials carry no capability field.
    44	    if (body.artifactId) {
    45	      // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
    46	      // target artifact. The writability check (own always; org-shared within org ok; another
    47	      // user's private → 403; missing/cross-org → 404) closes the follow-up-build IDOR (map §5.1),
    48	      // where any authenticated user could drive a code-writing agent against ANY artifact by id.
    49	      // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
    50	      // never leaks whether the target exists.
    51	      if (!can(actor, 'canEditApps')) {
    52	        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
    53	      }
    54	      // LOW oracle fix: collapse 'forbidden' (another user's PRIVATE artifact in the same org) into
    55	      // the SAME 404 as missing/cross-org, LOCAL to the follow-up build gate. A distinct 403 here
    56	      // is an existence oracle — it lets any canEditApps holder probe whether a private app exists
    57	      // by id. Security over the H1 brief's 403/404 split (that split stays on the artifact routes,
    58	      // which may legitimately distinguish); here writability failing for ANY reason reads as 404.
    59	      const { verdict } = await loadWritable(actor, body.artifactId);
    60	      if (verdict !== 'ok') return notFound(res);
    61	    } else if (!can(actor, 'canBuildApps')) {
    62	      // A first build CREATES an app.
    63	      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
    64	    }
    65	    const result = await handleBuildCreate({
    66	      actor,
    67	      username: req.user!.username,
    68	      sessionId: body.sessionId,
    69	      description: body.description,
    70	      language: body.language,
    67	/**
    68	 * Is this artifact a BUILT app — a code sandbox the app build/edit capabilities govern (H1 HIGH-2)?
    69	 * The primary, reliable signal is a recorded `data.projectDir`: ONLY an artifact produced by the
    70	 * build pipeline (`prepareFirstBuild`) carries one — a bare `POST /artifacts` record does not, and
    71	 * that projectDir is what feeds every code-editing route (`projectDirFor`). The secondary signal is
    72	 * a stored `data.artifactType === 'app'` (a pre-build row that named its type before a sandbox
    73	 * existed). An artifact matching NEITHER is a non-app artifact a plain `user` may still manage
    74	 * (canCreateArtifacts) — the gates below only tighten APP build/edit, never generic artifact CRUD.
    75	 */
    76	export function isAppArtifact(art: ArtifactDoc): boolean {
    77	  const data = (art.data ?? {}) as Record<string, unknown>;
    78	  if (typeof data.projectDir === 'string' && data.projectDir.length > 0) return true;
    79	  return data.artifactType === 'app';
    80	}
    81	
    82	export type OwnershipVerdict = 'ok' | 'notfound' | 'forbidden';
    83	
    84	/**
    85	 * Load an artifact the actor may READ: own (any visibility) or org-shared. A
    86	 * private row of another user (and any cross-org row) is a uniform not-found
    87	 * (ownership-mismatch parity, ch04). Mirrors OwnerVisibilityScoped.getVisible.
    88	 */
    89	export async function loadReadable(actor: Actor, id: string): Promise<ArtifactDoc | null> {
    90	  const art = (await artifacts.get(id)) as ArtifactDoc | null;
    91	  if (!art) return null;
    92	  if (art.orgId !== actor.orgId) return null;
    93	  if (art.userId === actor.userId) return art;
    94	  if (art.visibility === 'org') return art;
    95	  return null;
    96	}
    97	
    98	/**
    99	 * Load an artifact the actor may WRITE: own always, org-shared by any org member.
   100	 * A private row of another user → forbidden; a missing/cross-org row → notfound.
   101	 * Mirrors OwnerVisibilityScoped.writeGuard.
   102	 */
   103	export async function loadWritable(
   104	  actor: Actor,
   105	  id: string,
   106	): Promise<{ verdict: OwnershipVerdict; art?: ArtifactDoc }> {
   107	  const art = (await artifacts.get(id)) as ArtifactDoc | null;
   108	  if (!art || art.orgId !== actor.orgId) return { verdict: 'notfound' };
   109	  if (art.userId === actor.userId) return { verdict: 'ok', art };
   110	  if (art.visibility === 'org') return { verdict: 'ok', art };
   111	  return { verdict: 'forbidden', art };
   112	}
    40	  // cache miss, but as UNAUTHENTICATED: an unknown subject is a stale/forged token
    41	  // (deleted user, reset store), not a deactivated account. §3.3 reserves ACCOUNT_DISABLED
    42	  // for active=false; a 401 lets clients end the dead session instead of showing the
    43	  // blocked-account state for a user that no longer exists.
    44	  const act = getActivation(claims.sub);
    45	  if (!act) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
    46	  if (!act.active) return fail(res, 'ACCOUNT_DISABLED', 'A sua conta está bloqueada. Contacte o suporte.');
    47	  // Token-epoch check: a token issued before the user's current epoch is invalid (its role/
    48	  // active state is stale — e.g. an admin demoted after this token was minted). ch09 §9.6.
    49	  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) {
    50	    return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
    51	  }
    52	  if (act.billingLocked) return fail(res, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.');
    53	  req.user = claims;
    54	  next();
    55	}
    56	
    57	/** Token-query auth for the four SSE endpoints (CONV-1: EventSource cannot set headers).
    58	 *  Verifies the ?token=, revocation, and activation. Returns the claims or an error code. */
    59	export function verifySseToken(token: string | undefined): { ok: true; claims: JwtClaims } | { ok: false; status: number; code: ErrorCode } {
    60	  if (!token) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
    61	  let claims: JwtClaims;
    62	  try {
    63	    claims = verifyToken(token);
    64	  } catch {
    65	    return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
    66	  }
    67	  if (!claims.jti || isRevoked(claims.jti)) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
    68	  const act = getActivation(claims.sub);
    69	  if (!act) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
    70	  if (!act.active) return { ok: false, status: 403, code: 'ACCOUNT_DISABLED' };
    71	  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
    72	  return { ok: true, claims };
    73	}
    74	
    75	/** Role gate — use after requireAuth for org-admin / super-admin endpoints. */

codex
One area could still hide a regression: whether `/artifacts/import` was narrowed too far. I’m checking if `ArtifactBundle` is genuinely app-only, or whether this fix accidentally blocks importing non-app artifacts that users should still manage.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"ArtifactBundle|importArtifact\\(|exportArtifact\\(|updateArtifactFromBundle\\(|artifactType\" shared api/src | sed -n '1,220p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
shared/src/artifacts.ts:60:export const ArtifactBundle = z
shared/src/artifacts.ts:70:export type ArtifactBundle = z.infer<typeof ArtifactBundle>;
shared/src/artifacts.ts:72:export const ImportArtifactRequest = z.object({ bundle: ArtifactBundle });
shared/src/artifacts.ts:76:  bundle: ArtifactBundle,
shared/src/artifacts.ts:274:    response: ArtifactBundle,
api/src/routes/artifacts.ts:109:    const body = parseBody(res, ImportArtifactRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle } | undefined;
api/src/routes/artifacts.ts:116:    const created = await importArtifact(body.bundle, actorOf(req), deps);
api/src/routes/artifacts.ts:186:    res.json(await exportArtifact(art));
api/src/routes/artifacts.ts:193:    const body = parseBody(res, BundleUpdateRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle; force?: boolean } | undefined;
api/src/routes/artifacts.ts:196:      const result = await updateArtifactFromBundle(
api/src/apps/app-paths.ts:72: * a stored `data.artifactType === 'app'` (a pre-build row that named its type before a sandbox
api/src/apps/app-paths.ts:79:  return data.artifactType === 'app';
api/src/apps/build-mechanics.ts:80:  ): Promise<{ base: LoadedBase | null; artifactType: ArtifactType }> {
api/src/apps/build-mechanics.ts:83:      return { base, artifactType: typeForBase(base.id) };
api/src/apps/build-mechanics.ts:88:    const artifactType = await classifyArtifactType(description, userId);
api/src/apps/build-mechanics.ts:90:      return { base: await loadBase(baseForType(artifactType)), artifactType };
api/src/apps/build-mechanics.ts:92:      console.warn(`[build-mechanics] base "${baseForType(artifactType)}" failed to load; generic starters:`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:93:      return { base: null, artifactType };
api/src/apps/build-mechanics.ts:147:      const { base, artifactType } = await baseFor(input.templateId, input.description, input.userId);
api/src/apps/build-mechanics.ts:168:        // artifactType (C1): the scoping classifier's verdict — the operator surface
api/src/apps/build-mechanics.ts:170:        data: { projectDir, appUrl, sessionId: input.sessionId, artifactType },
api/src/apps/artifact-bundle.ts:4: * SHARED `ArtifactBundle` contract (shared/src/artifacts.ts):
api/src/apps/artifact-bundle.ts:29:import type { ArtifactBundle } from '@ekoa/shared';
api/src/apps/artifact-bundle.ts:88:export async function exportArtifact(art: ArtifactDoc): Promise<ArtifactBundle> {
api/src/apps/artifact-bundle.ts:110:async function writeBundleFiles(projectDir: string, bundle: ArtifactBundle): Promise<Set<string>> {
api/src/apps/artifact-bundle.ts:131:export async function importArtifact(
api/src/apps/artifact-bundle.ts:132:  bundle: ArtifactBundle,
api/src/apps/artifact-bundle.ts:193:export async function updateArtifactFromBundle(
api/src/apps/artifact-bundle.ts:195:  bundle: ArtifactBundle,
api/src/apps/artifacts-service.ts:44:  'actionManifest', 'artifactType', 'tours', 'toursError',

exec
/bin/zsh -lc 'codegraph explore "ArtifactBundle exportArtifact importArtifact updateArtifactFromBundle artifact bundle app-only non-app"' in /Users/ggomes/dev/ekoa-code
 succeeded in 374ms:
## Exploration: ArtifactBundle exportArtifact importArtifact updateArtifactFromBundle artifact bundle app-only non-app

Found 161 symbols across 74 files.

### Blast radius — what depends on these (update/verify before editing)

- `importArtifact` (api/src/apps/artifact-bundle.ts:131) — 2 callers in `api/src/routes/artifacts.ts`; ⚠️ no covering tests found
- `exportArtifact` (api/src/apps/artifact-bundle.ts:88) — 2 callers in `api/src/routes/artifacts.ts`; ⚠️ no covering tests found
- `ArtifactBundle` (web/lib/artifact-bundle.ts:25) — 4 callers in `web/lib/artifact-bundle.ts`; tests: `web/lib/artifact-bundle.test.ts`, `web/__tests__/lib/artifact-bundle.test.ts`, `api/tests/contract/artifact-family.test.ts`
- `UpdateFromBundleResult` (api/src/apps/artifact-bundle.ts:178) — 1 caller in `api/src/apps/artifact-bundle.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- importArtifact → put
- exportArtifact → collectFiles
- artifactsRouter → exportArtifact
- bundleFromZip → push
- updateArtifactFromBundle → withAppLock
- updateArtifactFromBundle → saveSnapshot
- updateArtifactFromBundle → writeBundleFiles
- updateArtifactFromBundle → ensureManifest
- updateArtifactFromBundle → collectFiles
- resolveMemoryInjection → map
- ... and 221 more

**references:**
- ArtifactBundle → BundleScaffoldFile
- bundleFromZip → ArtifactBundle
- updateArtifactFromBundle → UpdateFromBundleResult
- drive → MarkerProcessor
- billingRouter → Router
- pipedreamRouter → Router
- brandingRouter → Router
- integrationBuilderRouter → Router
- orgRouter → Router
- artifactsRouter → Router
- ... and 12 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/artifact-bundle.ts — get(calls), walk(calls), collectFiles(calls), indexSlug(calls), writeBundleFiles(calls), ensureManifest(calls), register(calls), ManifestIdMismatchError(class), withAppLock(function), delete(calls), +19 more

```typescript
42	const MAX_FILE_BYTES = 1_500_000;
43	const NUL = String.fromCharCode(0);
44	
45	export class ManifestIdMismatchError extends Error {
46	  constructor(incoming: string | undefined) {
47	    super(`bundle manifest.id "${incoming ?? '(none)'}" is not a revision of this app`);
48	    this.name = 'ManifestIdMismatchError';
49	  }
50	}
51	
52	/** Per-artifact serialization lane for bundle updates (independent of the git lock). */
53	const appLocks = new Map<string, Promise<unknown>>();
54	function withAppLock<T>(appId: string, fn: () => Promise<T>): Promise<T> {
55	  const prev = appLocks.get(appId) ?? Promise.resolve();
56	  const run = prev.then(fn, fn);
57	  const tail = run.then(() => undefined, () => undefined);
58	  appLocks.set(appId, tail);
59	  void tail.then(() => { if (appLocks.get(appId) === tail) appLocks.delete(appId); });
60	  return run;
61	}
62	
63	/** Collect scaffold text files (relative path + utf-8 content), excluding runtime dirs. */
64	async function collectFiles(root: string): Promise<Array<{ path: string; content: string }>> {
65	  if (!existsSync(root)) return [];
66	  const out: Array<{ path: string; content: string }> = [];
67	  async function walk(dir: string, prefix: string): Promise<void> {
68	    const entries = await readdir(dir, { withFileTypes: true });
69	    for (const e of entries) {
70	      const rel = prefix ? `${prefix}/${e.name}` : e.name;
71	      if (!prefix && EXCLUDE_TOP.has(e.name)) continue;
72	      if (e.isDirectory()) {
73	        await walk(join(dir, e.name), rel);
74	      } else if (e.isFile()) {
75	        const full = join(dir, e.name);
76	        const s = await stat(full);
77	        if (s.size > MAX_FILE_BYTES) continue;
78	        const content = await readFile(full, 'utf-8');
79	        if (content.indexOf(NUL) !== -1) continue; // binary - not representable as plaintext
80	        out.push({ path: rel, content });
81	      }
82	    }
83	  }
84	  await walk(root, '');
85	  return out;
86	}
87	
88	export async function exportArtifact(art: ArtifactDoc): Promise<ArtifactBundle> {
89	  const projectDir = projectDirFor(art);
90	  const files = await collectFiles(projectDir);
91	  const manifest = await readManifest(projectDir).catch(() => null);
92	  return {
93	    manifestId: art._id,
94	    name: art.name,
95	    ...(art.slug ? { slug: art.slug } : {}),
96	    files,
97	    version: manifest?.version ?? '1.0.0',
98	  };
99	}
100	
101	/** Reject traversal/absolute paths; return the confined absolute dest or null. */
102	function safeDest(projectDir: string, relPath: string): string | null {
103	  const parts = relPath.split(/[/\\]/).filter(Boolean);
104	  if (parts.length === 0 || parts.some((s) => s === '..' || s.startsWith('/'))) return null;
105	  const dest = resolve(projectDir, ...parts);
106	  if (dest !== projectDir && !dest.startsWith(projectDir + sep)) return null;
107	  return dest;
108	}
109	
110	async function writeBundleFiles(projectDir: string, bundle: ArtifactBundle): Promise<Set<string>> {
111	  const written = new Set<string>();
112	  for (const f of bundle.files ?? []) {
113	    const dest = safeDest(projectDir, f.path);
114	    if (!dest) continue;
115	    await mkdir(dirname(dest), { recursive: true });
116	    await writeFile(dest, f.content, 'utf-8');
117	    written.add(f.path.split(/[/\\]/).filter(Boolean).join('/'));
118	  }
119	  return written;
120	}
121	
122	/** Ensure a valid manifest.json at the project root, stamped with id + name. */
123	async function ensureManifest(projectDir: string, id: string, name: string): Promise<void> {
124	  const existing = await readManifest(projectDir).catch(() => null);
125	  const manifest = existing ?? createDefaultManifest(id, name);
126	  manifest.id = id;
127	  manifest.name = name;
128	  await writeManifest(projectDir, manifest);
129	}
130	
131	export async function importArtifact(
132	  bundle: ArtifactBundle,
133	  owner: Actor,
134	  deps: Deps,
135	): Promise<ArtifactDoc> {
136	  const newId = deps.genId();
137	  const name = bundle.name ?? bundle.manifestId ?? 'App';
138	  const slug = await generateSlug(name, deps);
139	  await slugs.put({ _id: slug, artifactId: newId });
140	  indexSlug(slug, newId);
141	
142	  const projectDir = newProjectDir(owner.userId, newId);
143	  await mkdir(projectDir, { recursive: true });
144	  await writeBundleFiles(projectDir, bundle);
145	  await ensureManifest(projectDir, newId, name);
146	
147	  const now = new Date(deps.now()).toISOString();
148	  const doc: ArtifactDoc = {
149	    _id: newId,
150	    name,
151	    slug,
152	    userId: owner.userId,
153	    orgId: owner.orgId,
154	    visibility: 'private',
155	    featured: false,
156	    shareable: true,
157	    status: 'draft',
158	    data: { appUrl: `/apps/${newId}/`, projectDir, importedFrom: bundle.manifestId },
159	    createdAt: now,
160	    updatedAt: now,
161	  } as ArtifactDoc;
162	  await artifacts.insert(doc as never);
163	
164	  // Build + register so the imported app is immediately viewable.
165	  try {
166	    const result = await appBuilder.build(newId, projectDir);
167	    await appRegistry.register(newId, projectDir, owner.userId, name);
168	    if (result.success) {
169	      await artifacts.update(newId, (a) => ({ ...a, status: 'active', updatedAt: new Date(deps.now()).toISOString() }));
170	      doc.status = 'active';
171	    }
172	  } catch (err) {
173	    console.warn(`[import-artifact] post-import build failed for ${newId}:`, err instanceof Error ? err.message : err);
174	  }
175	  return doc;
176	}
177	
178	export interface UpdateFromBundleResult {
179	  artifact: ArtifactDoc;
180	  safetyNetSnapshotId: string;
181	  preUpdateVersionId: string;
182	}
183	
184	/**
185	 * Replace an artifact's source from a bundle IN PLACE (id/slug/URL/app-data
186	 * preserved). Safety-nets first (both must succeed before the tree is touched):
187	 *   1. app-data safety-net snapshot;
188	 *   2. pre-update version commit of the current scaffold.
189	 * Then the new files replace the old (files absent from the bundle are deleted;
190	 * runtime dirs never touched) and the app rebuilds. A failed build auto-restores
191	 * the pre-update version.
192	 */
193	export async function updateArtifactFromBundle(
194	  art: ArtifactDoc,
195	  bundle: ArtifactBundle,
196	  opts: { force?: boolean; authorName?: string; audit: SnapshotAudit; appDeps: AppDataDeps },
197	  deps: Deps,
198	): Promise<UpdateFromBundleResult> {
199	  const data = (art.data ?? {}) as Record<string, unknown>;
200	  const knownIds = new Set([art._id, data.importedFrom].filter((v): v is string => typeof v === 'string'));
201	  if (!opts.force && (!bundle.manifestId || !knownIds.has(bundle.manifestId))) {
202	    throw new ManifestIdMismatchError(bundle.manifestId);
203	  }
204	
205	  const projectDir = projectDirFor(art);
206	  const authorName = opts.authorName || 'ekoa';
207	  const authorEmail = `${authorName}@ekoa.local`;
208	
209	  return withAppLock(art._id, async () => {
210	    // ---- Safety net first; both must succeed before any file mutates. ----
211	    const backups = new AppDataBackups(opts.appDeps);
212	    const snapshot = await backups.saveSnapshot(art._id, 'safety-net');
213	
214	    const pre = await commitSnapshot({ projectDir, message: 'pre-update snapshot', authorName, authorEmail, audit: opts.audit });
215	    const preUpdateVersionId = pre.sha;
216	    if (!preUpdateVersionId) {
217	      throw new Error('PreUpdateSnapshotFailed: no current scaffold to snapshot; import as a new artifact instead');
218	    }
219	
220	    try {
221	      // Write new files; delete scaffold files the bundle no longer carries.
222	      const keep = await writeBundleFiles(projectDir, bundle);
223	      keep.add('manifest.json');
224	      await ensureManifest(projectDir, art._id, bundle.name ?? art.name);
225	      for (const f of await collectFiles(projectDir)) {
226	        if (keep.has(f.path) || f.path === '.gitignore') continue;
227	        await rm(join(projectDir, ...f.path.split('/')), { force: true });
228	      }
229	
230	      try { await appBuilder.unwatch(art._id); } catch { /* not watched */ }
231	      const result = await appBuilder.build(art._id, projectDir);
232	      if (!result.success) throw new Error(`BuildFailed: the updated bundle did not compile (${result.errors.join('; ')})`);
233	    } catch (err) {
234	      let note = 'the previous version was restored';
235	      try {
236	        await restoreVersion({ projectDir, sha: preUpdateVersionId, authorName, authorEmail });
237	        await appBuilder.build(art._id, projectDir);
238	      } catch (restoreErr) {
239	        note = `restoring the previous version also failed: ${restoreErr instanceof Error ? restoreErr.message : restoreErr}`;
240	      }
241	      throw new Error(`${err instanceof Error ? err.message : String(err)}; ${note}`);
242	    }
243	
244	    // The update itself becomes a revision the user can roll back from.
245	    await commitSnapshot({ projectDir, message: 'update from bundle', authorName, authorEmail, audit: opts.audit });
246	
247	    const now = new Date(deps.now()).toISOString();
248	    const updated = (await artifacts.update(art._id, (a) => ({
249	      ...a,
250	      name: bundle.name ?? a.name,
251	      status: a.status === 'archived' ? a.status : 'active',
252	      updatedAt: now,
253	      data: { ...((a.data as Record<string, unknown>) ?? {}), lastBundleUpdateAt: now },
254	    }))) as ArtifactDoc;
255	    if (updated.slug) indexSlug(updated.slug, art._id);
256	    try {
257	      await appRegistry.register(art._id, projectDir, art.userId, updated.name);
258	    } catch (err) {
259	      console.warn(`[update-artifact] post-update register failed for ${art._id}:`, err instanceof Error ? err.message : err);
260	    }
261	
262	    return { artifact: updated, safetyNetSnapshotId: snapshot.pointId, preUpdateVersionId };
263	  });
264	}
265	
```

#### api/src/agents/streaming.ts — artifact(method)

```typescript
1	/**
2	 * The streaming pipeline (ch05 §5.7.1): the one internal sink `agents/` writes to, which maps
3	 * run activity to the typed `shared/events.ts` union members and hands them to `events/` for
4	 * SSE delivery. Every payload emitted here is a valid member of its per-stream union (the ch13
5	 * streaming-contract gate). `subagent_event`, `phase_changed`, and `usage_progress` are NEVER
6	 * emitted (§5.7.3, P-11): plan/subtask notifications are consumed internally (they reset the
7	 * inactivity timer) and usage deltas feed billing capture only.
8	 *
9	 * Terminal events (`complete`/`error`) go through the dual-fire guard at the call site
10	 * (registry.finalizeOnce, §5.3.4), never here.
11	 */
12	import { sseManager } from '../events/sse-manager.js';
13	import { loadAgentsConfig } from '../config.js';
14	import type { ChatRunEvent, JobEvent, NotificationEvent } from '@ekoa/shared';
15	
16	/** Truncate a tool arg/result value's string form to the configured cap (§5.7.1). */
17	function truncate(value: unknown): unknown {
18	  if (value === undefined) return undefined;
19	  const cap = loadAgentsConfig().toolResultTruncateChars;
20	  const s = typeof value === 'string' ? value : JSON.stringify(value);
21	  if (s === undefined) return value;
22	  return s.length > cap ? s.slice(0, cap) : s;
23	}
24	
25	/** A tool_event payload (shared by chat + job streams). */
26	export interface ToolEventInput {
27	  phase: 'started' | 'finished' | 'failed';
28	  tool: string;
29	  args?: Record<string, unknown>;
30	  result?: unknown;
31	  isError?: boolean;
32	  durationMs?: number;
33	}
34	
35	function toolEventPayload(e: ToolEventInput): Record<string, unknown> {
36	  return {
37	    type: 'tool_event',
38	    phase: e.phase,
39	    tool: e.tool,
40	    ...(e.args !== undefined ? { args: e.args } : {}),
41	    ...(e.result !== undefined ? { result: truncate(e.result) } : {}),
42	    ...(e.isError !== undefined ? { isError: e.isError } : {}),
43	    ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
44	  };
45	}
46	
47	/** Chat-run stream sink (§3.6.1 `ChatRunEvent`). */
48	export class ChatStreamSink {
49	  constructor(private runId: string) {}
50	  private emit(ev: ChatRunEvent): void {
51	    sseManager.emit('chat', this.runId, ev.type, ev);
52	  }
53	  text(text: string): void {
54	    if (text) this.emit({ type: 'text_chunk', text });
55	  }
56	  /** Working-commentary channel (§3.6.1 `thinking_chunk`). Callers pass text already
57	   *  marker-filtered AND engine-identity-redacted (branding.ts) — never raw model output. */
58	  thinking(text: string): void {
59	    if (text) this.emit({ type: 'thinking_chunk', text });
60	  }
61	  toolEvent(e: ToolEventInput): void {
62	    this.emit(toolEventPayload(e) as ChatRunEvent);
63	  }
64	  contextEvent(name: string, action: 'loaded' | 'used'): void {
65	    this.emit({ type: 'context_event', name, action });
66	  }
67	  /** FC-402 per-turn local-file activity (run s5): transient display metadata for the trust
68	   *  chip — files+bytes from the daemon ledger buffer, mask counts from the anon-audit join. */
69	  localActivity(a: {
70	    files: Array<{ path: string; range?: string }>;
71	    bytesOut?: number;
72	    maskedCounts?: Record<string, number>;
73	    correlationId?: string;
74	  }): void {
75	    if (a.files.length === 0) return;
76	    this.emit({ type: 'local_activity', ...a });
77	  }
78	  complete(result: unknown, durationMs: number, delegate?: { kind: 'build' | 'integration'; request: Record<string, unknown> }): void {
79	    this.emit({ type: 'complete', result, durationMs, ...(delegate ? { delegate } : {}) });
80	  }
81	  error(code: string, message: string): void {
82	    this.emit({ type: 'error', code, message });
83	  }
84	}
85	
86	/** Job stream sink (§3.6.2 `JobEvent`). */
87	export class JobStreamSink {
88	  constructor(private jobId: string) {}
89	  private emit(ev: JobEvent): void {
90	    sseManager.emit('job', this.jobId, ev.type, ev);
91	  }
92	  routing(tier: string, reason: string): void {
93	    this.emit({ type: 'routing', tier, reason });
94	  }
95	  text(text: string): void {
96	    if (text) this.emit({ type: 'text_chunk', text });
97	  }
98	  /** Working-commentary channel (mirrors ChatStreamSink.thinking). Callers pass text already
99	   *  marker-filtered AND engine-identity-redacted (branding.ts) — never raw model output. */
100	  thinking(text: string): void {
101	    if (text) this.emit({ type: 'thinking_chunk', text });
102	  }
103	  toolEvent(e: ToolEventInput): void {
104	    this.emit(toolEventPayload(e) as JobEvent);
105	  }
106	  contextEvent(name: string, action: 'loaded' | 'used'): void {
107	    this.emit({ type: 'context_event', name, action });
108	  }
109	  planStep(status: string, description?: string, detail?: string): void {
110	    this.emit({ type: 'plan_step', status, ...(description ? { description } : {}), ...(detail ? { detail } : {}) });
111	  }
112	  previewReload(): void {
113	    this.emit({ type: 'preview_reload' });
114	  }
115	  /** The build's artifact is scaffolded + served — fired BEFORE the agent runs so the client
116	   *  shows the live preview and the real file tree from second zero. */
117	  artifact(payload: { artifactId: string; appUrl: string; slug?: string }): void {
118	    this.emit({ type: 'artifact', ...payload });
119	  }
120	  complete(payload: { result?: unknown; artifactId?: string; slug?: string; appUrl?: string }, durationMs: number): void {
121	    this.emit({ type: 'complete', durationMs, ...payload });
122	  }
123	  error(code: string, message: string): void {
124	    this.emit({ type: 'error', code, message });
125	  }
126	}
127	
128	// --- Notifications channel (§3.6.4 `NotificationEvent`) -----------------------------------
129	
130	/** Fire a `build_intent` on the target user's notifications channel (§5.7.2). */
131	export function emitBuildIntent(userId: string, ev: { sessionId: string; sourceRunId: string; request: { description: string; artifactId?: string } }): void {
132	  const payload: NotificationEvent = { type: 'build_intent', ...ev };
133	  sseManager.emit('notifications', userId, 'build_intent', payload);
134	}
135	
136	/** Fire an `integration_build_intent` on the target user's notifications channel (§5.7.2). */
137	export function emitIntegrationBuildIntent(userId: string, ev: { sessionId: string; hint?: string }): void {
138	  const payload: NotificationEvent = { type: 'integration_build_intent', ...ev };
139	  sseManager.emit('notifications', userId, 'integration_build_intent', payload);
140	}
141	
142	/** Deliver a `chat_answer` on the notifications channel (§5.6.2 in-build answer flow). */
143	export function emitChatAnswer(userId: string, ev: { sessionId: string; sourceRunId: string; text: string }): void {
144	  const payload: NotificationEvent = { type: 'chat_answer', ...ev };
145	  sseManager.emit('notifications', userId, 'chat_answer', payload);
146	}
147	
148	/** Org branding changed (brand research applied): tell the user's clients to refetch the
149	 *  company config so the header logo + theme update live (no page reload). Per-user channel -
150	 *  other org members pick the change up on their next company fetch. */
151	export function emitBrandingUpdated(userId: string): void {
152	  const payload: NotificationEvent = { type: 'branding_updated' };
153	  sseManager.emit('notifications', userId, 'branding_updated', payload);
154	}
```

#### shared/src/artifacts.ts — ForkArtifactRequest(type_alias), ForkArtifactResponse(type_alias), ImportArtifactRequest(type_alias)

```typescript
46	export type ArtifactPatch = z.infer<typeof ArtifactPatch>;
47	
48	export const ForkArtifactRequest = z.object({ name: z.string().optional() });
49	export type ForkArtifactRequest = z.infer<typeof ForkArtifactRequest>;
50	
51	export const ForkArtifactResponse = z.object({ id: Id, slug: z.string() });
52	export type ForkArtifactResponse = z.infer<typeof ForkArtifactResponse>;
53	
54	export const SetFeaturedRequest = z.object({
55	  featured: z.boolean(),

... (gap) ...

70	export type ArtifactBundle = z.infer<typeof ArtifactBundle>;
71	
72	export const ImportArtifactRequest = z.object({ bundle: ArtifactBundle });
73	export type ImportArtifactRequest = z.infer<typeof ImportArtifactRequest>;
74	
75	export const BundleUpdateRequest = z.object({
76	  bundle: ArtifactBundle,
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba shared/src/artifacts.ts | sed -n '56,72p'
nl -ba api/src/apps/artifacts-service.ts | sed -n '1,90p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
    56	  featuredRank: z.number().int().optional(),
    57	});
    58	export type SetFeaturedRequest = z.infer<typeof SetFeaturedRequest>;
    59	
    60	export const ArtifactBundle = z
    61	  .object({
    62	    manifestId: z.string(),
    63	    name: z.string().optional(),
    64	    slug: z.string().optional(),
    65	    files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
    66	    data: z.record(z.unknown()).optional(),
    67	    version: z.string().optional(),
    68	  })
    69	  .passthrough();
    70	export type ArtifactBundle = z.infer<typeof ArtifactBundle>;
    71	
    72	export const ImportArtifactRequest = z.object({ bundle: ArtifactBundle });
     1	/**
     2	 * Artifacts service (ch03 §3.8.9). Owner+visibility scoped (private|org). Slug uniqueness via
     3	 * the `slugs` reservation collection (deterministic-_id insert). Featured surfaces regardless
     4	 * of owner. Deterministic slug generation (no model call — FIXED-3, ch07 §7.8).
     5	 */
     6	import { artifacts, slugs } from '../data/stores.js';
     7	import { OwnerVisibilityScoped, type Actor } from '../data/scoped.js';
     8	import type { Doc } from '../data/store.js';
     9	import { indexSlug } from './slug-index.js';
    10	import { getArtifactScreenshotUrl } from '../services/artifact-screenshot.js';
    11	
    12	export interface ArtifactDoc extends Doc {
    13	  name: string;
    14	  slug?: string;
    15	  userId: string;
    16	  orgId: string;
    17	  visibility: 'private' | 'org';
    18	  featured?: boolean;
    19	  shareable?: boolean;
    20	  status?: string;
    21	  data?: Record<string, unknown>;
    22	  sharedData?: boolean;
    23	}
    24	
    25	export interface Deps { now: () => number; genId: () => string }
    26	
    27	/**
    28	 * Keys inside an artifact's `data` bag that ONLY server build/fork/bundle/featured machinery may
    29	 * write. A client PATCH must never set these: `data.projectDir` in particular feeds
    30	 * `projectDirFor()` and thus the follow-up build sandbox cwd/HOME (a path-injection →
    31	 * sandbox-escape vector, ch09). The route strips them at the boundary and `patchArtifact` strips
    32	 * them again before merging onto the existing bag (defense in depth), so a client can neither
    33	 * overwrite nor wipe them.
    34	 */
    35	export const RESERVED_ARTIFACT_DATA_KEYS: readonly string[] = [
    36	  'projectDir', 'appUrl', 'sessionId', 'sdkSessionId',
    37	  'seededFrom', 'seededVersion', 'updateAvailable',
    38	  'importedFrom', 'forkedFrom', 'lastBundleUpdateAt', 'customized',
    39	  // Server-owned build outputs, set ONLY at activation from the app's own project
    40	  // (never client-writable via the artifact patch route): the C2 action registry
    41	  // and its classification, and the E1 tour capture. `tours` is served publicly at
    42	  // GET /api/demos/:appId, so a client-writable `tours` would be a stored-content
    43	  // injection into that surface — reserve it (and its sibling error/manifest keys).
    44	  'actionManifest', 'artifactType', 'tours', 'toursError',
    45	];
    46	
    47	/** Drop every server-owned reserved key from a client-supplied `data` bag (see the constant). */
    48	export function stripReservedDataKeys(data: Record<string, unknown>): Record<string, unknown> {
    49	  const out: Record<string, unknown> = {};
    50	  for (const [k, v] of Object.entries(data)) {
    51	    if (!RESERVED_ARTIFACT_DATA_KEYS.includes(k)) out[k] = v;
    52	  }
    53	  return out;
    54	}
    55	
    56	const scoped = new OwnerVisibilityScoped<ArtifactDoc>(artifacts as never);
    57	
    58	export function artifactView(a: ArtifactDoc) {
    59	  return { id: a._id, name: a.name, slug: a.slug, userId: a.userId, orgId: a.orgId, visibility: a.visibility, featured: !!a.featured, shareable: !!a.shareable, status: a.status, screenshotUrl: getArtifactScreenshotUrl(a._id) };
    60	}
    61	
    62	const STOPWORDS = new Set(['a', 'o', 'de', 'da', 'do', 'the', 'and', 'e']);
    63	
    64	/** Deterministic slug (ch07 §7.8): 2-4 lowercase hyphenated words, strip stop-words,
    65	 *  numeric suffix on collision. No model call. */
    66	export async function generateSlug(name: string, deps: Deps): Promise<string> {
    67	  const words = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter((w) => w && !STOPWORDS.has(w)).slice(0, 4);
    68	  const base = words.join('-') || 'app';
    69	  if (await slugs.insert({ _id: base, artifactId: '' })) return base;
    70	  for (let n = 2; n <= 99; n++) {
    71	    if (await slugs.insert({ _id: `${base}-${n}`, artifactId: '' })) return `${base}-${n}`;
    72	  }
    73	  return `${base}-${deps.now().toString(36)}`;
    74	}
    75	
    76	export async function listArtifacts(actor: Actor): Promise<{ items: ArtifactDoc[]; featured: ArtifactDoc[] }> {
    77	  const visible = await scoped.listVisible(actor);
    78	  const featured = ((await artifacts.find({ featured: true })) as ArtifactDoc[]);
    79	  return { items: visible, featured };
    80	}
    81	
    82	export async function createArtifact(actor: Actor, input: { name: string; visibility?: 'private' | 'org' }, deps: Deps): Promise<ArtifactDoc> {
    83	  const id = deps.genId();
    84	  const slug = await generateSlug(input.name, deps);
    85	  await slugs.put({ _id: slug, artifactId: id }); // point the reservation at the new artifact
    86	  indexSlug(slug, id); // keep the in-memory serving index current (ch07 §7.8)
    87	  const doc: ArtifactDoc = { _id: id, name: input.name, slug, userId: actor.userId, orgId: actor.orgId, visibility: input.visibility ?? 'private', status: 'draft' };
    88	  await artifacts.insert(doc as never);
    89	  return doc;
    90	}

exec
/bin/zsh -lc 'git show 49dc5f6''^:api/src/routes/artifacts.ts | nl -ba | sed -n '"'107,170p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-ElB4pD2p' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-EnFMJAgi' (errno=Operation not permitted)
   107	    if (!body) return;
   108	    // Strip server-owned reserved keys (e.g. `projectDir`) from any client `data` at the boundary
   109	    // before they reach the store — a client must never influence the build sandbox path (ch09).
   110	    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
   111	      body.data = stripReservedDataKeys(body.data as Record<string, unknown>);
   112	    }
   113	    const result = await patchArtifact(actorOf(req), req.params.id as string, body);
   114	    if (result.verdict === 'notfound') return notFound(res);
   115	    if (result.verdict === 'forbidden') {
   116	      if (typeof body.slug === 'string') return sendError(res, 'SLUG_TAKEN', 'Slug já em uso.');
   117	      return sendError(res, 'FORBIDDEN', 'Sem permissão.');
   118	    }
   119	    res.json(artifactView(result.artifact!));
   120	  });
   121	
   122	  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
   123	    const id = req.params.id as string;
   124	    // Revoke the backend BEFORE removing the row so no queued/in-flight invoke can
   125	    // run against a deleted artifact (C05-20 post-DELETE refusal, B19).
   126	    await getArtifactBackendRuntime().revoke(id);
   127	    const verdict = await deleteArtifact(actorOf(req), id);
   128	    if (verdict === 'notfound') return notFound(res);
   129	    if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
   130	    res.json({ ok: true });
   131	  });
   132	
   133	  // ---- fork / featured toggle ----
   134	  r.post('/:id/fork', async (req: AuthedRequest, res: Response) => {
   135	    const src = await readable(req, res);
   136	    if (!src) return;
   137	    const body = parseBody(res, ForkBody, req.body ?? {}) as { name?: string } | undefined;
   138	    if (!body) return;
   139	    const { artifact } = await forkArtifact(src._id, actorOf(req), deps, body.name);
   140	    res.status(201).json({ id: artifact._id, slug: artifact.slug });
   141	  });
   142	
   143	  r.put('/:id/featured', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
   144	    const body = parseBody(res, SetFeaturedRequest, req.body) as { featured: boolean; featuredRank?: number } | undefined;
   145	    if (!body) return;
   146	    const existing = await getArtifactById(req.params.id as string);
   147	    if (!existing) return notFound(res);
   148	    const updated = await setFeaturedFlag(req.params.id as string, body.featured, body.featuredRank);
   149	    res.json(artifactView(updated!));
   150	  });
   151	
   152	  // ---- bundle export / import / update-in-place ----
   153	  r.get('/:id/export', async (req: AuthedRequest, res: Response) => {
   154	    const art = await readable(req, res);
   155	    if (!art) return;
   156	    res.json(await exportArtifact(art));
   157	  });
   158	
   159	  r.post('/:id/bundle-update', async (req: AuthedRequest, res: Response) => {
   160	    const art = await writable(req, res);
   161	    if (!art) return;
   162	    const body = parseBody(res, BundleUpdateRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle; force?: boolean } | undefined;
   163	    if (!body) return;
   164	    try {
   165	      const result = await updateArtifactFromBundle(
   166	        art, body.bundle,
   167	        { force: body.force, authorName: req.user!.username, audit: auditOf(req), appDeps },
   168	        deps,
   169	      );
   170	      res.json({ artifact: artifactView(result.artifact), safetyNetSnapshotId: result.safetyNetSnapshotId, preUpdateVersionId: result.preUpdateVersionId });

hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"export async function forkArtifact|function forkArtifact|projectDirFor\\(|newProjectDir\\(\" api/src/apps/artifact-fork.ts api/src/apps" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/apps/artifact-fork.ts:62:export async function forkArtifact(
api/src/apps/artifact-fork.ts:77:  const projectDir = newProjectDir(newOwner.userId, newId);
api/src/apps/artifact-fork.ts:78:  const sourceDir = projectDirFor(source);
api/src/apps/backend-runtime/index.ts:40:    const manifest = await readManifest(projectDirFor(art));
api/src/apps/backend-runtime/runtime.ts:536:        const m = await readManifest(projectDirFor(art as never));
api/src/apps/artifact-bundle.ts:89:  const projectDir = projectDirFor(art);
api/src/apps/artifact-bundle.ts:142:  const projectDir = newProjectDir(owner.userId, newId);
api/src/apps/artifact-bundle.ts:205:  const projectDir = projectDirFor(art);
api/src/apps/artifact-fork.ts:62:export async function forkArtifact(
api/src/apps/artifact-fork.ts:77:  const projectDir = newProjectDir(newOwner.userId, newId);
api/src/apps/artifact-fork.ts:78:  const sourceDir = projectDirFor(source);
api/src/apps/artifacts-service.ts:30: * `projectDirFor()` and thus the follow-up build sandbox cwd/HOME (a path-injection →
api/src/apps/app-paths.ts:46:export function projectDirFor(art: ArtifactDoc): string {
api/src/apps/app-paths.ts:57:export function newProjectDir(ownerUserId: string, appId: string): string {
api/src/apps/app-paths.ts:63:  const bundle = join(projectDirFor(art), 'dist-backend', 'backend.mjs');
api/src/apps/build-mechanics.ts:156:      const projectDir = newProjectDir(input.userId, artifactId);
api/src/apps/build-mechanics.ts:209:      const projectDir = projectDirFor(art);
api/src/apps/artifact-featured-update.ts:48:  return recordedProjectDir(data) ?? newProjectDir(art.userId, art._id);

exec
/bin/zsh -lc 'codegraph explore "forkArtifact non-app projectDir files artifact-fork"' in /Users/ggomes/dev/ekoa-code
 succeeded in 309ms:
## Exploration: forkArtifact non-app projectDir files artifact-fork

Found 110 symbols across 34 files.

### Blast radius — what depends on these (update/verify before editing)

- `forkArtifact` (api/src/apps/artifact-fork.ts:62) — 4 callers in `api/src/apps/build-link.ts`, `api/src/routes/artifacts.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- forkArtifact → put
- App → getCurrentUser
- getCurrentUser → whoami
- whoami → getRuntime
- App → list
- startNewConversation → create
- emptyTx → todayMonthKey
- App → todayMonthKey
- handleImportFile → todayMonthKey
- App → emptyTx
- ... and 95 more

**references:**
- getCurrentUser → CurrentUser
- whoami → WhoAmI
- cached → CurrentUser
- App → onKey
- App → onKeyDown
- forkArtifact → ForkResult
- CurrentUser → WhoAmI

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/artifact-fork.ts — forkArtifact(function), cloneProjectDir(function), ForkResult(interface)

```typescript
1	/**
2	 * Artifact fork (ch03 §3.8.9, ch07 §7.10). Copies a source artifact's working
3	 * copy into a fresh artifact owned by the caller, generates a deterministic slug,
4	 * rebuilds, and registers. Every fork is independent - no upstream link, no
5	 * dedup. Ported from the old services/artifact-fork.ts, adapted to the ekoa-code
6	 * stores (ArtifactDoc) + deterministic slug pipeline (artifacts-service +
7	 * slug-index) + build/registry entries.
8	 *
9	 * The source tree is only READ (cp copies FROM it), so a fork never mutates the
10	 * source working copy - the C07 criterion-11 invariant (source byte-identical
11	 * before/after). Runtime/build dirs never travel into the fork.
12	 *
13	 * DEVIATION (logged): the old service had a GitHub generate-from-template fast
14	 * path (provider abstraction, B18). This slice ports the on-disk clone as the
15	 * authoritative path (deterministic, works without a GitHub remote) and fires the
16	 * gated GitHub mirror push for the new fork after cloning; the template-fork
17	 * optimization is deferred.
18	 */
19	import { existsSync } from 'node:fs';
20	import { cp, mkdir } from 'node:fs/promises';
21	import { dirname } from 'node:path';
22	import { artifacts, slugs } from '../data/stores.js';
23	import type { Actor } from '../data/scoped.js';
24	import { generateSlug, type ArtifactDoc, type Deps } from './artifacts-service.js';
25	import { indexSlug } from './slug-index.js';
26	import { projectDirFor, newProjectDir } from './app-paths.js';
27	import { appBuilder } from './builder.js';
28	import { appRegistry } from './app-registry.js';
29	import { backupAppRepoSafe } from '../services/github/backup.js';
30	
31	/** Top-level entries that never travel into a fork (ephemeral runtime/build state). */
32	const EXCLUDE_TOP = new Set(['dist', 'dist-backend', 'node_modules', '.git', 'app-data', '.sdk-session', '.versions']);
33	
34	/** Clone the source tree into the fork's project dir, excluding runtime state. */
35	async function cloneProjectDir(sourceDir: string, destDir: string): Promise<boolean> {
36	  if (!existsSync(sourceDir)) return false;
37	  await mkdir(dirname(destDir), { recursive: true });
38	  await cp(sourceDir, destDir, {
39	    recursive: true,
40	    filter: (path) => {
41	      const rel = path.slice(sourceDir.length).replace(/^[/\\]+/, '');
42	      if (!rel) return true; // root
43	      const top = rel.split(/[/\\]/)[0] as string;
44	      return !EXCLUDE_TOP.has(top);
45	    },
46	  });
47	  return true;
48	}
49	
50	export interface ForkResult {
51	  artifact: ArtifactDoc;
52	  cloned: boolean;
53	  built: boolean;
54	}
55	
56	/**
57	 * Fork `sourceId` into a new artifact owned by `newOwner`. The caller is
58	 * responsible for authorization (own/org-shared for the API route; shareable/
59	 * featured for `/build/:slug`); this resolves the source by id directly so the
60	 * fork-per-click share flow can copy another user's shareable artifact.
61	 */
62	export async function forkArtifact(
63	  sourceId: string,
64	  newOwner: Actor,
65	  deps: Deps,
66	  newName?: string,
67	): Promise<ForkResult> {
68	  const source = (await artifacts.get(sourceId)) as ArtifactDoc | null;
69	  if (!source) throw new Error(`Artifact not found: ${sourceId}`);
70	
71	  const newId = deps.genId();
72	  const baseName = newName?.trim() || `${source.name} (cópia)`;
73	  const slug = await generateSlug(baseName, deps);
74	  await slugs.put({ _id: slug, artifactId: newId });
75	  indexSlug(slug, newId);
76	
77	  const projectDir = newProjectDir(newOwner.userId, newId);
78	  const sourceDir = projectDirFor(source);
79	
80	  // Clone the working copy (source is read-only here - byte-identical invariant).
81	  let cloned = false;
82	  try {
83	    cloned = await cloneProjectDir(sourceDir, projectDir);
84	  } catch (err) {
85	    console.warn('[fork] clone failed:', err instanceof Error ? err.message : err);
86	  }
87	
88	  const now = new Date(deps.now()).toISOString();
89	  const doc: ArtifactDoc = {
90	    _id: newId,
91	    name: baseName,
92	    slug,
93	    userId: newOwner.userId,
94	    orgId: newOwner.orgId,
95	    visibility: 'private',
96	    featured: false,
97	    shareable: true,
98	    status: 'draft',
99	    data: { appUrl: `/apps/${newId}/`, projectDir, forkedFrom: sourceId },
100	    createdAt: now,
101	    updatedAt: now,
102	  } as ArtifactDoc;
103	  await artifacts.insert(doc as never);
104	
105	  // Register + build so the fork is immediately servable. Build failure is
106	  // non-fatal (the record exists either way; the error HTML serves).
107	  let built = false;
108	  if (cloned) {
109	    try {
110	      await appRegistry.register(newId, projectDir, newOwner.userId, baseName);
111	      const result = await appBuilder.build(newId, projectDir);
112	      built = result.success;
113	      if (built) {
114	        await artifacts.update(newId, (a) => ({ ...a, status: 'active', updatedAt: new Date(deps.now()).toISOString() }));
115	        doc.status = 'active';
116	      }
117	    } catch (err) {
118	      console.warn('[fork] register/build failed:', err instanceof Error ? err.message : err);
119	    }
120	    // Gated GitHub mirror push for the new fork (§7.9; no-op when push disabled).
121	    backupAppRepoSafe(projectDir, { appId: newId, appName: baseName });
122	  }
123	
124	  return { artifact: doc, cloned, built };
125	}
```

#### shared/src/artifacts.ts — ImportArtifactRequest(type_alias), ArtifactFilesResponse(type_alias)

```typescript
70	export type ArtifactBundle = z.infer<typeof ArtifactBundle>;
71	
72	export const ImportArtifactRequest = z.object({ bundle: ArtifactBundle });
73	export type ImportArtifactRequest = z.infer<typeof ImportArtifactRequest>;
74	
75	export const BundleUpdateRequest = z.object({
76	  bundle: ArtifactBundle,

... (gap) ...

114	  files: z.array(ArtifactFile),
115	  projectDir: z.string().nullable(),
116	});
117	export type ArtifactFilesResponse = z.infer<typeof ArtifactFilesResponse>;
118	
119	export const ReadFileQuery = z.object({ path: z.string() });
120	export type ReadFileQuery = z.infer<typeof ReadFileQuery>;
```

#### api/assets/featured-artifacts/erp-imobiliario/scaffold/frontend/src/App.jsx — calls(calls), create(calls), update(calls), isRealizado(calls), todayISO(calls), emptyTx(calls), emptyCliente(calls), list(calls), emptyBanco(calls), todayMonthKey(calls), +47 more

```jsx
954	  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
955	}
956	
957	function emptyTx() {
958	  const today = todayISO();
959	  return {
960	    data: today,
961	    competencia: todayMonthKey(),
962	    forma: "Despesa",
963	    formaPagamento: "Banco",
964	    actPlan: "Plan",
965	    dtEmissao: today,
966	    dtVencimento: today,
967	    fatura: "N/A",
968	    fornecedor: "",
969	    status: "A pagar",
970	    cliente: "",
971	    descricao: "",
972	    originadorComissao: "",
973	    comentarios: "",
974	    contabGrupo: "Despesa",
975	    classifContabGrupo: "03.Despesa",
976	    contabSubGrupo: "",
977	    pl: "Principal",
978	    produto: "",
979	    pontualRecorrente: "Pontual",
980	    fixoVariavel: "Variável",
981	    iva: "Não",
982	    valorBruto: 0,
983	    valorRetencao: 0,
984	    valorLiquido: 0,
985	    valorSaldo: 0,
986	    valorSaldoSemIva: 0,
987	    valorSaldoSemLegadoIva: 0,
988	    ivaTrProjetado: 0,
989	  };
990	}
991	
992	export default function App() {
993	  const [active, setActive] = useState("painel");
994	  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
995	  const [txInitialSearch, setTxInitialSearch] = useState("");
996	  const [txs, setTxs] = useState([]);
997	  const [cfg, setCfg] = useState({ saldoBanco: 0, saldoBancoData: todayISO(), metaMensal: 0 });
998	  const [refMonth, setRefMonth] = useState(todayMonthKey());
999	  const [loading, setLoading] = useState(true);
1000	  const [error, setError] = useState(null);
1001	  const [editing, setEditing] = useState(null);
1002	  const [draft, setDraft] = useState(emptyTx());
1003	  const [draftFile, setDraftFile] = useState(null);
1004	  const [saving, setSaving] = useState(false);
1005	  const [toastDismissed, setToastDismissed] = useState(false);
1006	  const [editingBalance, setEditingBalance] = useState(false);
1007	  const [balanceDraft, setBalanceDraft] = useState({ saldoBanco: 0, saldoBancoData: todayISO() });
1008	  const [importPreview, setImportPreview] = useState(null);
1009	  const [importing, setImporting] = useState(false);
1010	  const [importError, setImportError] = useState(null);
1011	  const [clientes, setClientes] = useState([]);
1012	  const [editingCliente, setEditingCliente] = useState(null);
1013	  const [draftCliente, setDraftCliente] = useState(emptyCliente());
1014	  const [savingCliente, setSavingCliente] = useState(false);
1015	  const [clientesImportPreview, setClientesImportPreview] = useState(null);
1016	  const [bancos, setBancos] = useState([]);
1017	  const [txToDelete, setTxToDelete] = useState(null);
1018	  const [deletingTx, setDeletingTx] = useState(false);
1019	
1020	  const fornecedoresOptions = useMemo(() => {
1021	    const set = new Set();
1022	    for (const t of txs) {
1023	      const f = String(t.fornecedor || "").trim();
1024	      if (f && !/^n\/?a$/i.test(f)) set.add(f);
1025	    }
1026	    return [...set].sort((a, b) => a.localeCompare(b, "pt"));
1027	  }, [txs]);
1028	
1029	  const clientesOptions = useMemo(() => {
1030	    const set = new Set();
1031	    for (const t of txs) {
1032	      const c = String(t.cliente || "").trim();
1033	      if (c && !/^n\/?a$/i.test(c)) set.add(c);
1034	    }
1035	    for (const c of clientes) {
1036	      const nm = String(c.nome || "").trim();
1037	      if (nm) set.add(nm);
1038	    }
1039	    return [...set].sort((a, b) => a.localeCompare(b, "pt"));
1040	  }, [txs, clientes]);
1041	  const [editingBanco, setEditingBanco] = useState(null);
1042	  const [draftBanco, setDraftBanco] = useState(emptyBanco());
1043	  const [savingBanco, setSavingBanco] = useState(false);
1044	  const [cgdConnect, setCgdConnect] = useState(null);
1045	
1046	  const [apartamentos, setApartamentos] = useState([]);
1047	
1048	  useEffect(() => {
1049	    let mounted = true;
1050	    Promise.all([
1051	      window.__ekoa.list(COL_TX),
1052	      window.__ekoa.get(COL_CFG, CFG_ID),
1053	      window.__ekoa.list(COL_CLIENTES),
1054	      window.__ekoa.list(COL_BANCOS),
1055	      window.__ekoa.list(COL_APARTAMENTOS),
1056	    ])
1057	      .then(async ([txList, cfgDoc, clienteList, bancoList, apartList]) => {
1058	        if (!mounted) return;
1059	        let allTxs = Array.isArray(txList) ? txList : [];
1060	        const ancoraLegacy = allTxs.filter((t) => t.origem === "saldo-ancora");
1061	        if (ancoraLegacy.length) {
1062	          for (const a of ancoraLegacy) {
1063	            try { await window.__ekoa.delete(COL_TX, a.id); } catch (_) {}
1064	          }
1065	          allTxs = allTxs.filter((t) => t.origem !== "saldo-ancora");
1066	        }
1067	        setTxs(allTxs);
1068	        if (cfgDoc) setCfg({ ...cfg, ...cfgDoc });
1069	        setClientes(Array.isArray(clienteList) ? clienteList : []);
1070	        setBancos(Array.isArray(bancoList) ? bancoList : []);
1071	        setApartamentos(Array.isArray(apartList) ? apartList : []);
1072	      })
1073	      .catch((err) => mounted && setError(err.message))
1074	      .finally(() => mounted && setLoading(false));
1075	    return () => { mounted = false; };
1076	    // eslint-disable-next-line react-hooks/exhaustive-deps
1077	  }, []);
1078	
1079	  useEffect(() => {
1080	    if (!clientes.length || !txs.length) return;
1081	    const today = new Date();
1082	    const candidates = findAutoInactivosCandidates(clientes, txs, today);
1083	    if (!candidates.length) return;
1084	    let cancelled = false;
1085	    (async () => {
1086	      const todayIso = todayISO();
1087	      for (const cand of candidates) {
1088	        if (cancelled) return;
1089	        try {
1090	          const patch = {
1091	            status: "inativo",
1092	            autoInactivatedAt: todayIso,
1093	            autoInactivatedLastReceita: cand.lastReceita,
1094	          };
1095	          const updated = await window.__ekoa.update(COL_CLIENTES, cand.id, patch);
1096	          if (cancelled) return;
1097	          setClientes((prev) => prev.map((c) => (c.id === cand.id ? { ...c, ...updated } : c)));
1098	        } catch (_) { /* skip silently */ }
1099	      }
1100	    })();
1101	    return () => { cancelled = true; };
1102	  }, [clientes, txs]);
1103	
1104	  useEffect(() => {
1105	    function onKey(e) {
1106	      if (e.key !== "Escape") return;
1107	      if (txToDelete) { setTxToDelete(null); return; }
1108	      if (editing) { closeTxModal(); return; }
1109	      if (editingCliente) { closeClienteModal(); return; }
1110	      if (editingBalance) { setEditingBalance(false); return; }
1111	      if (importPreview) { setImportPreview(null); setImportError(null); return; }
1112	      if (clientesImportPreview) { setClientesImportPreview(null); return; }
1113	    }
1114	    document.addEventListener("keydown", onKey);
1115	    return () => document.removeEventListener("keydown", onKey);
1116	  }, [txToDelete, editing, editingCliente, editingBalance, importPreview, clientesImportPreview]);
1117	
1118	  useEffect(() => {
1119	    function onKeyDown(e) {
1120	      if (e.code !== "NumpadDecimal") return;
1121	      const el = e.target;
1122	      if (!el || el.tagName !== "INPUT") return;
1123	      const type = (el.getAttribute("type") || "").toLowerCase();
1124	      if (type !== "number" && type !== "text") return;
1125	      const lang = (document.documentElement.lang || navigator.language || "pt").toLowerCase();
1126	      const usesComma = lang.startsWith("pt") || lang.startsWith("es") || lang.startsWith("fr") || lang.startsWith("de");
1127	      if (!usesComma) return;
1128	      if (type === "number") return;
1129	      e.preventDefault();
1130	      const start = el.selectionStart ?? el.value.length;
1131	      const end = el.selectionEnd ?? el.value.length;
1132	      const newValue = el.value.slice(0, start) + "," + el.value.slice(end);
1133	      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
1134	      if (setter) setter.call(el, newValue);
1135	      else el.value = newValue;
1136	      el.dispatchEvent(new Event("input", { bubbles: true }));
1137	      el.setSelectionRange(start + 1, start + 1);
1138	    }
1139	    document.addEventListener("keydown", onKeyDown);
1140	    return () => document.removeEventListener("keydown", onKeyDown);
1141	  }, []);
1142	
1143	  const monthsAvailable = useMemo(() => monthList(), []);
1144	
1145	  const txsRealizadas = useMemo(
1146	    () => txs.filter((t) => t.origem === "saldo-ancora" || isRealizado(t)),
1147	    [txs]
1148	  );
1149	
1150	  const txsMonth = useMemo(
1151	    () => txs.filter((t) => t.competencia === refMonth),
1152	    [txs, refMonth]
1153	  );
1154	
1155	  const summary = useMemo(() => {
1156	    let faturamentoRealizado = 0;
1157	    let despesasRealizadas = 0;
1158	    let faturamentoPrevisto = 0;
1159	    let pendentesPassados = 0;
1160	    const todayK = todayISO();
1161	    for (const t of txs) {
1162	      const v = Number(t.valorBruto) || 0;
1163	      if (t.competencia === refMonth) {
1164	        if (t.forma === "Receita") {
1165	          faturamentoPrevisto += v;
1166	          if (isRealizado(t)) faturamentoRealizado += v;
1167	        } else if (t.forma === "Despesa" && isRealizado(t)) {
1168	          despesasRealizadas += v;
1169	        }
1170	      }
1171	      if (isPendente(t) && t.dtVencimento && t.dtVencimento < todayK) {
1172	        pendentesPassados += 1;
1173	      }
1174	    }
1175	    const resultado = faturamentoRealizado - despesasRealizadas;
1176	    const rentabilidade = faturamentoRealizado > 0 ? (resultado / faturamentoRealizado) * 100 : null;
1177	    return {
1178	      faturamentoRealizado,
1179	      despesasRealizadas,
1180	      faturamentoPrevisto,
1181	      resultado,
1182	      rentabilidade,
1183	      pendentesPassados,
1184	    };
1185	  }, [txs, refMonth]);
1186	
1187	  const reconciliacao = useMemo(() => {
1188	    const apos = txsMonth
1189	      .filter((t) => t.status !== "Cancelado")
1190	      .reduce((acc, t) => {
1191	        const v = Number(t.valorBruto) || 0;
1192	        if (t.forma === "Receita" && isRealizado(t)) return acc + v;
1193	        if (t.forma === "Despesa" && isRealizado(t)) return acc - v;
1194	        return acc;
1195	      }, 0);
1196	    const manuais = txsMonth.filter((t) => isRealizado(t)).length;
1197	    const saldoApp = (Number(cfg.saldoBanco) || 0) + apos;
1198	    return { apos, manuais, saldoApp };
1199	  }, [txsMonth, cfg.saldoBanco]);
1200	
1201	  const evolucao = useMemo(() => {
1202	    const yearNow = new Date().getFullYear();
1203	    const monthNow = new Date().getMonth();
1204	    const out = [];
1205	    let saldo = Number(cfg.saldoBanco) || 0;
1206	    const start = saldo;
1207	    for (let m = 0; m < 12; m++) {
1208	      const key = `${yearNow}-${String(m + 1).padStart(2, "0")}`;
1209	      const monthDelta = txs
1210	        .filter((t) => t.competencia === key && isRealizado(t))
1211	        .reduce((acc, t) => {
1212	          const v = Number(t.valorBruto) || 0;
1213	          if (t.forma === "Receita") return acc + v;
1214	          if (t.forma === "Despesa") return acc - v;
1215	          return acc;
1216	        }, 0);
1217	      saldo = (m === 0 ? start : saldo) + monthDelta;
1218	      out.push({ month: m, label: MONTHS_LETTER[m], saldo, isFuture: m > monthNow, isToday: m === monthNow });
1219	    }
1220	    return out;
1221	  }, [txs, cfg.saldoBanco]);
1222	
1223	  const previousMonthKey = useMemo(() => {
1224	    const [yy, mm] = refMonth.split("-").map(Number);
1225	    const prev = new Date(yy, mm - 2, 1);
1226	    return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
1227	  }, [refMonth]);
1228	
1229	  const previousMonthRevenue = useMemo(() => {
1230	    return txs
1231	      .filter((t) => t.competencia === previousMonthKey && t.forma === "Receita" && isRealizado(t))
1232	      .reduce((acc, t) => acc + (Number(t.valorBruto) || 0), 0);
1233	  }, [txs, previousMonthKey]);
1234	
1235	  const grupoDespesas = useMemo(() => {
1236	    const map = new Map();
1237	    for (const t of txsMonth) {
1238	      if (t.forma !== "Despesa" || !isRealizado(t)) continue;
1239	      const k = t.contabGrupo || "Sem grupo";
1240	      map.set(k, (map.get(k) || 0) + (Number(t.valorBruto) || 0));
1241	    }
1242	    return Array.from(map.entries())
1243	      .map(([grupo, total]) => ({ grupo, total }))
1244	      .sort((a, b) => b.total - a.total);
1245	  }, [txsMonth]);
1246	
1247	  const contasHoje = useMemo(() => {
1248	    const today = todayISO();
1249	    return txs.filter(
1250	      (t) => t.forma === "Despesa" && isPendente(t) && t.dtVencimento === today
1251	    );
1252	  }, [txs]);
1253	
1254	  function openNewTx() {
1255	    setDraft({ ...emptyTx(), competencia: refMonth });
1256	    setDraftFile(null);
1257	    setEditing("new");
1258	  }
1259	  function openEditTx(tx) {
1260	    setDraft({ ...emptyTx(), ...tx });
1261	    setDraftFile(null);
1262	    setEditing(tx.id);
1263	  }
1264	  function closeTxModal() {
1265	    setEditing(null);
1266	    setDraft(emptyTx());
1267	    setDraftFile(null);
1268	  }
1269	
1270	  async function deletePreAncoraTxs() {
1271	    const cutoff = SALDO_ANCORA.data;
1272	    const candidates = txs.filter((t) => (t.data || "") < cutoff);
1273	    if (!candidates.length) {
1274	      alert(`Nenhuma transação anterior a ${fmtDate(cutoff)} encontrada.`);
1275	      return;
1276	    }
1277	    const ok = confirm(
1278	      `Excluir ${candidates.length} transação(ões) anteriores a ${fmtDate(cutoff)}?\n\n` +
1279	      `Esta ação não pode ser desfeita. A âncora ${fmtDate(SALDO_ANCORA.data)} = ${fmtEur(SALDO_ANCORA.valor)} permanece como saldo inicial.`
1280	    );
1281	    if (!ok) return;
1282	    const confirmText = prompt(`Para confirmar a exclusão de ${candidates.length} transação(ões), digite EXCLUIR:`);
1283	    if (confirmText !== "EXCLUIR") {
1284	      alert("Operação cancelada.");
1285	      return;
1286	    }
1287	    setSaving(true);
1288	    let removed = 0, failed = 0;
1289	    try {
1290	      for (const t of candidates) {
1291	        try {
1292	          await window.__ekoa.delete(COL_TX, t.id);
1293	          removed++;
1294	        } catch (_) { failed++; }
1295	      }
1296	      setTxs((prev) => prev.filter((t) => (t.data || "") >= cutoff));
1297	      alert(`${removed} transação(ões) excluída(s)${failed ? ` · ${failed} falhou(aram)` : ""}.`);
1298	    } finally {
1299	      setSaving(false);
1300	    }
1301	  }
1302	
1303	  async function applyRulesToAll() {
1304	    if (!confirm("Aplicar regras de Fixo/Variável e PL=Legado a todas as transações existentes?")) return;
1305	    setSaving(true);
1306	    let updated = 0;
1307	    try {
1308	      for (const t of txs) {
1309	        const next = applyAllRules({ ...t });
1310	        const changedFV = (next.fixoVariavel || "") !== (t.fixoVariavel || "");
1311	        const changedPL = (next.pl || "") !== (t.pl || "");
1312	        if (!changedFV && !changedPL) continue;
1313	        const patch = {};
1314	        if (changedFV) patch.fixoVariavel = next.fixoVariavel;
1315	        if (changedPL) { patch.pl = next.pl; patch.legadoCanal = next.legadoCanal; }
1316	        try {
1317	          const res = await window.__ekoa.update(COL_TX, t.id, patch);
1318	          setTxs((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...res } : x)));
1319	          updated++;
1320	        } catch (_) {}
1321	      }
1322	      alert(`Regras aplicadas. ${updated} transação(ões) atualizada(s).`);
1323	    } finally {
1324	      setSaving(false);
1325	    }
1326	  }
1327	
1328	  async function saveTx() {
1329	    setSaving(true);
1330	    try {
1331	      const payload = applyAllRules({ ...draft });
1332	      ["valorBruto", "valorLiquido"].forEach((k) => { payload[k] = Number(payload[k]) || 0; });
1333	      if (!payload.valorLiquido) payload.valorLiquido = payload.valorBruto;
1334	      let txRecord;
1335	      if (editing === "new") {
1336	        txRecord = await window.__ekoa.create(COL_TX, payload);
1337	        setTxs((prev) => [txRecord, ...prev]);
1338	      } else {
1339	        const updated = await window.__ekoa.update(COL_TX, editing, payload);
1340	        txRecord = { ...draft, ...updated, id: editing };
1341	        setTxs((prev) => prev.map((t) => (t.id === editing ? { ...t, ...updated } : t)));
1342	      }
1343	      if (draftFile) {
1344	        await attachInvoice(txRecord, draftFile);
1345	      }
1346	      closeTxModal();
1347	    } catch (err) {
1348	      setError(err.message || "Falha ao salvar transação");
1349	    } finally {
1350	      setSaving(false);
1351	    }
1352	  }
1353	
1354	  function deleteTx(id) {
1355	    if (!id) {
1356	      console.warn("deleteTx chamado sem id");
1357	      return;
1358	    }
1359	    const tx = txs.find((t) => t.id === id);
1360	    if (!tx) {
1361	      console.warn("deleteTx: tx não encontrada com id", id);
1362	      setTxs((prev) => prev.filter((t) => t.id !== id));
1363	      return;
1364	    }
1365	    setTxToDelete(tx);
1366	  }
1367	
1368	  async function confirmDeleteTx() {
1369	    if (!txToDelete) return;
1370	    const id = txToDelete.id;
1371	    setDeletingTx(true);
1372	    try {
1373	      try {
1374	        await window.__ekoa.delete(COL_TX, id);
1375	      } catch (err) {

... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
- `(1) durable revocation` `CLOSED` — boot now reloads `tokenEpoch`/`billingLocked` from the user rows in [api/src/server.ts](/Users/ggomes/dev/ekoa-code/api/src/server.ts:683), and each revocation path persists the epoch in the same operation: role change/migration in [api/src/auth/users-service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/users-service.ts:63) and [api/src/auth/users-service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/users-service.ts:101), password change/reset/logout-other/deactivate in [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:65), [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:166), [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:182), [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:219). NEW: none found.
- `(2) app-edit vectors` `CLOSED` — app classification is centralized in [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:76); import and fork now require build capability in [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:108) and [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:155); in-place app mutations are gated by `denyAppEdit` in [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:81) and applied at [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:189), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:231), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:265), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:331), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:356), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:390), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:400). NEW: none found.
- `(3) TOCTOU` `CLOSED` — follow-up jobs now re-check writability immediately before resuming the build in [api/src/agents/build.ts](/Users/ggomes/dev/ekoa-code/api/src/agents/build.ts:331), through the seam added in [api/src/agents/seams.ts](/Users/ggomes/dev/ekoa-code/api/src/agents/seams.ts:335) and implemented by reusing `loadWritable` in [api/src/apps/build-mechanics.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/build-mechanics.ts:228). NEW: none found.
- `(4) oracle` `CLOSED` — the follow-up build gate now collapses every non-`ok` writability verdict to `404` in [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:54), while the artifact-family routes keep their separate 403/404 behavior in [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:66). NEW: none found.

VERDICT: APPROVE
hook: Stop
hook: Stop Completed
tokens used
93,249
- `(1) durable revocation` `CLOSED` — boot now reloads `tokenEpoch`/`billingLocked` from the user rows in [api/src/server.ts](/Users/ggomes/dev/ekoa-code/api/src/server.ts:683), and each revocation path persists the epoch in the same operation: role change/migration in [api/src/auth/users-service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/users-service.ts:63) and [api/src/auth/users-service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/users-service.ts:101), password change/reset/logout-other/deactivate in [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:65), [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:166), [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:182), [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:219). NEW: none found.
- `(2) app-edit vectors` `CLOSED` — app classification is centralized in [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:76); import and fork now require build capability in [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:108) and [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:155); in-place app mutations are gated by `denyAppEdit` in [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:81) and applied at [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:189), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:231), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:265), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:331), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:356), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:390), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:400). NEW: none found.
- `(3) TOCTOU` `CLOSED` — follow-up jobs now re-check writability immediately before resuming the build in [api/src/agents/build.ts](/Users/ggomes/dev/ekoa-code/api/src/agents/build.ts:331), through the seam added in [api/src/agents/seams.ts](/Users/ggomes/dev/ekoa-code/api/src/agents/seams.ts:335) and implemented by reusing `loadWritable` in [api/src/apps/build-mechanics.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/build-mechanics.ts:228). NEW: none found.
- `(4) oracle` `CLOSED` — the follow-up build gate now collapses every non-`ok` writability verdict to `404` in [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:54), while the artifact-family routes keep their separate 403/404 behavior in [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:66). NEW: none found.

VERDICT: APPROVE
