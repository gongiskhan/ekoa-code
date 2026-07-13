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
session id: 019f5d6b-97a9-7ea0-b1f5-c572eb5e6902
--------
user
Adversarial SECURITY re-review in /Users/ggomes/dev/ekoa-code. You flagged 2 Mediums on H3 edit mode; fixes are in commit 1901055 (git show 1901055). Verify BOTH CLOSED + no new defect: (M1 SSE-early-close false no-change) runEditPatch now POLLS GET /api/v1/jobs/:id to a terminal status (completed/failed) before reading versions/previewing, instead of trusting the SSE close - trace edit-mode.js: does an early stream close now lead to a job-status poll (transient-tolerant, bounded) and the preview only shows on a CONFIRMED completed job, so a build finishing after a blip still surfaces its new head (never a false 'no change')? (M2 stale rollback wipes concurrent changes) rollback is now guardedRollback: before restore it re-reads GET /artifacts/:id/versions and requires current HEAD === the head THIS edit produced (expectedHeadSha) AND the pre-run target still exists, else refuses with a calm PT-PT message - trace it: can a concurrent HEAD move still be wiped? is the compare correct (expected head = the post-edit head, restore target = pre-run head)? NEW defects: does the poll loop terminate (deadline)? does guardedRollback fail-closed (refuse) on a versions-read error rather than blind-restoring? detect-then-ask + visitor-blindness still intact? Read slices/H3/impl-notes.md (Codex-fix round) + slices/H3/codex-review.md (prior). Read-only cmds OK. Concise: a bullet per finding (CLOSED/NOT-CLOSED + file:line) then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `1901055` against the two prior H3 findings. I’ll load the project context files first, check whether CodeGraph is available, then trace the edit-mode flow and rollback guard in the patched code.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "pwd && ls -la && printf '\\n---\\n' && for f in PRD.md PLANING.md TASKS.md .codegraph slices/H3/impl-notes.md slices/H3/codex-review.md; do if [ -e \""'$f" ]; then echo "FOUND $f"; else echo "MISSING $f"; fi; done' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/Users/ggomes/dev/ekoa-code
total 1272
drwxr-xr-x@  32 ggomes  staff    1024 Jul 13 16:54 .
drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
drwxr-xr-x@   6 ggomes  staff     192 Jul 13 11:15 .claude
drwxr-xr-x@   9 ggomes  staff     288 Jul 13 22:39 .codegraph
-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
drwxr-xr-x@  16 ggomes  staff     512 Jul 13 22:39 .git
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:59 .githooks
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:55 .github
-rw-r--r--@   1 ggomes  staff    1000 Jul 13 15:43 .gitignore
-rw-r--r--@   1 ggomes  staff     450 Jul  7 02:23 .npmrc
drwxr-xr-x@  56 ggomes  staff    1792 Jul 12 07:34 .playwright-cli
drwxr-xr-x@   6 ggomes  staff     192 Jul 11 22:20 .walkthrough
-rw-r--r--@   1 ggomes  staff    5797 Jul 11 22:20 CLAUDE.md
-rw-r--r--@   1 ggomes  staff    2351 Jul 13 16:54 Dockerfile.api
-rw-r--r--@   1 ggomes  staff    1658 Jul  8 10:24 Dockerfile.web
-rw-r--r--@   1 ggomes  staff   47608 Jul 13 21:47 RUN_LOG.md
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

---
MISSING PRD.md
MISSING PLANING.md
MISSING TASKS.md
FOUND .codegraph
MISSING slices/H3/impl-notes.md
MISSING slices/H3/codex-review.md

exec
/bin/zsh -lc 'git show --stat --oneline --decorate=short 1901055' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-LJht0DD7' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-P8BqCfGD' (errno=Operation not permitted)
1901055 (HEAD -> main) fix(operator-run/h3): codex Mediums 2/2 - (M1) an early SSE close no longer reads as 'no change': the flow now POLLS GET /jobs/:id to a terminal status (authoritative, transient-tolerant) before previewing, so a build completing after a stream blip still surfaces its new head; (M2) guardedRollback re-reads versions and restores to the pre-run head ONLY if HEAD is still exactly the head this edit produced (and the target still exists), else refuses with a calm PT-PT message - a concurrent change can never be wiped as collateral
 api/assets/panel-runtime/src/AssistantPanel.jsx    |  47 ++++--
 api/assets/panel-runtime/src/edit-mode.js          | 148 +++++++++++++++++--
 api/tests/apps/assistant-panel.test.ts             |  25 +++-
 api/tests/apps/edit-mode.test.ts                   | 163 +++++++++++++++++++--
 .../slices/H3/impl-notes.md                        |  49 +++++++
 .../slices/H3/worker-status.txt                    |   1 +
 6 files changed, 395 insertions(+), 38 deletions(-)

codex
CodeGraph is available. The root `PRD.md`/`PLANING.md`/`TASKS.md` files are absent, so I’m using the H3 slice notes named in the commit and tracing the patched symbols directly from `edit-mode.js` and its tests.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --files | rg '("'^|/)(PRD'"\\.md|PLANING\\.md|TASKS\\.md|impl-notes\\.md|codex-review\\.md|edit-mode\\.js|AssistantPanel\\.jsx|edit-mode\\.test\\.ts|assistant-panel\\.test\\.ts)"'$'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/tests/apps/edit-mode.test.ts
api/tests/apps/assistant-panel.test.ts
api/assets/panel-runtime/src/AssistantPanel.jsx
api/assets/panel-runtime/src/edit-mode.js
docs/autothing/runs/20260712-150958-4bb23640/slices/F1/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/F1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/C5/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E1/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/C3/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/B2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G1/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D3/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D3/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H3/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H3/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/F2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/F2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E2/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md

exec
/bin/zsh -lc 'git show --unified=80 1901055 -- api/assets/panel-runtime/src/edit-mode.js api/assets/panel-runtime/src/AssistantPanel.jsx api/tests/apps/edit-mode.test.ts api/tests/apps/assistant-panel.test.ts .claude/slices/H3/impl-notes.md .claude/slices/H3/codex-review.md' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-VoSj04aQ' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-tiawpMlw' (errno=Operation not permitted)
commit 19010556c2c00e276443775ae36abc8b54a8220c
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 22:39:00 2026 +0100

    fix(operator-run/h3): codex Mediums 2/2 - (M1) an early SSE close no longer reads as 'no change': the flow now POLLS GET /jobs/:id to a terminal status (authoritative, transient-tolerant) before previewing, so a build completing after a stream blip still surfaces its new head; (M2) guardedRollback re-reads versions and restores to the pre-run head ONLY if HEAD is still exactly the head this edit produced (and the target still exists), else refuses with a calm PT-PT message - a concurrent change can never be wiped as collateral

diff --git a/api/assets/panel-runtime/src/AssistantPanel.jsx b/api/assets/panel-runtime/src/AssistantPanel.jsx
index 259d765..579102f 100644
--- a/api/assets/panel-runtime/src/AssistantPanel.jsx
+++ b/api/assets/panel-runtime/src/AssistantPanel.jsx
@@ -1,118 +1,118 @@
 /*
  * Operator Assistant Panel - platform-shipped for the `app` base (operator-run D2;
  * lazy-loaded as a platform runtime asset since operator-run G2).
  *
  * The in-app assistant every generated app carries. It is compiled into the
  * platform panel-runtime asset (api/assets/panel-runtime) and mounts INTO the
  * shell's <div id="ekoa-assistant-root"> (see index.jsx, the asset entry) and
  * speaks ONLY two things:
  *
  *   1. POST /api/app-assistant (D1) - the served-app assistant endpoint. It carries
  *      the visitor's message, the running history, the pinned/echoed mode, the
  *      current screen context, and the X-Ekoa-App-Id header. The reply, its
  *      knowledge citations ("Fontes"), and the app-actions the assistant proposes
  *      come back on the response.
  *   2. window.__ekoaActions.execute(action) (C3 same-document runtime) - for EACH
  *      action the assistant proposes. The runtime owns the VISIBLE driving badge,
  *      the target highlight, the destructive confirmation card, and the
  *      pause-on-real-user-input; the panel only calls execute() and shows a subtle
  *      "a executar..." state until it resolves. The panel NEVER dispatches an
  *      action the assistant did not return.
  *
  * Three capabilities / three modes: OPERAR (do) operates the app, MOSTRAR (show)
  * gives an overview, ENSINAR (teach) walks through a tutorial. The server infers
  * the mode from the phrasing; the toggle lets the visitor pin it, and the server's
  * echoed response.mode is reflected back.
  *
  * The panel is PLATFORM code: brand-neutral via the CSS-var contract, PT-PT
  * throughout (lawyer-facing), no emoji, and non-blocking - it never steals focus
  * from the app and every failure renders a calm message instead of crashing.
  */
 import { useCallback, useEffect, useRef, useState } from 'react';
 import { createTourPlayer } from './tour-player';
 // H3 EDIT MODE (admins only): the network side of the admin patch-run flow, factored out
 // so it is unit-provable against a fake fetch. It targets the PLATFORM /api/v1/* API with
 // the admin's platform Bearer - a SEPARATE plane from the visitor-blind POST
 // /api/app-assistant. Every action it calls is H1-gated server-side; this panel only SHOWS
 // the affordance when detection said admin, and only after the admin OPTS IN (detect-then-ask).
-import { runEditPatch, rollbackToVersion, degradeMessage, progressLine, EDIT_COPY } from './edit-mode';
+import { runEditPatch, guardedRollback, degradeMessage, progressLine, EDIT_COPY } from './edit-mode';
 import './AssistantPanel.css';
 
 const ENDPOINT = '/api/app-assistant';
 // H2 admin DETECTION (detect-then-ask). A cheap, non-LLM GET that answers ONLY "is the current
 // viewer an admin of this app's owner org?". It NEVER issues an assistant turn (the zero-token
 // invariant holds) and its result NEVER auto-enables anything - it only lights a discreet
 // indicator. The edit-mode switch + its opt-in UX are H3; this panel does not build them.
 const WHOAMI_ENDPOINT = '/api/app-assistant/whoami';
 // The platform session token key web/lib/api/token.ts uses. Read best-effort for detection only:
 // a served app on the SAME origin as the dashboard can read it; a CROSS-origin / sandboxed iframe
 // (the dev preview) throws on access, so detection simply falls back to "not admin".
 const TOKEN_STORAGE_KEY = 'ekoa_token';
 // Bounds (codex-d2): the transcript kept in memory, the history slice sent per turn,
 // and a hard timeout on the assistant fetch so a hung turn can never lock the composer.
 const MAX_MESSAGES = 200;
 const MAX_HISTORY_TURNS = 16;
 const FETCH_TIMEOUT_MS = 120000;
 
 /** The three modes, in toggle order, with their PT-PT labels. */
 const MODES = [
   { id: 'do', label: 'Operar' },
   { id: 'show', label: 'Mostrar' },
   { id: 'teach', label: 'Ensinar' },
 ];
 
 /** The first-open capability prompts (PT-PT), one per capability. Clicking one
  *  pins its mode and drops the example into the composer. */
 const EXAMPLES = [
   { mode: 'do', kind: 'Operar', prompt: 'Adicione um novo registo' },
   { mode: 'show', kind: 'Mostrar', prompt: 'Dê-me uma visão geral da aplicação' },
   { mode: 'teach', kind: 'Ensinar', prompt: 'Mostre-me um tutorial' },
 ];
 
 const ERROR_REPLY = 'O assistente está indisponível de momento.';
 const MAX_ACTION_RESULTS = 8;
 
 /** The served-app id stamped by injectAppContext(); absent in a standalone preview. */
 function appId() {
   return typeof window !== 'undefined' && window.__EKOA_APP_ID ? window.__EKOA_APP_ID : undefined;
 }
 
 /** Best-effort read of the platform session token for admin DETECTION only (H2). Same-origin
  *  served pages can read the dashboard's localStorage; a cross-origin or sandboxed iframe throws
  *  a SecurityError on `localStorage` access - swallow it to null so detection just degrades to
  *  "not admin" (no affordance) instead of crashing the panel. Reads nothing else and stores
  *  nothing - the token is attached to the one whoami GET and never kept. */
 function readPlatformToken() {
   try {
     if (typeof window === 'undefined' || !window.localStorage) return null;
     const t = window.localStorage.getItem(TOKEN_STORAGE_KEY);
     return typeof t === 'string' && t ? t : null;
   } catch {
     return null;
   }
 }
 
 /** A short display sha for the edit-mode preview (7 chars, like git). Undefined -> a dash. */
 function shortSha(sha) {
   return typeof sha === 'string' && sha ? sha.slice(0, 7) : '-';
 }
 
 /** The app's current route/page, best-effort: the shell may expose it on
  *  window.__ekoaApp; otherwise fall back to the location. Undefined when unknown. */
 function currentRoute() {
   if (typeof window === 'undefined') return undefined;
   const app = window.__ekoaApp;
   if (app && typeof app.route === 'string' && app.route) return app.route;
   if (app && typeof app.currentRoute === 'string' && app.currentRoute) return app.currentRoute;
   const loc = window.location;
   const r = (loc && (loc.hash || loc.pathname)) || '';
   return r ? String(r) : undefined;
 }
 
 /**
  * Map a proposed action to the manifest form window.__ekoaActions.execute expects
  * (kind/target/route/destructive/labelPt + a VALUES object on params). D1 sends
  * `{ toolName, input }`; when the response is enriched with the resolved manifest
  * `action` we drive it directly, otherwise we forward what we have (the runtime
  * reports a clean failure for an action it cannot resolve - never a crash).
  */
@@ -570,201 +570,217 @@ export function AssistantPanel({ defaultOpen = false } = {}) {
         e.preventDefault();
         void send();
       }
     },
     [send],
   );
 
   // ---- H3 edit mode (admins only) -----------------------------------------
   // A thin front-end over the H1-gated follow-up-build machinery. The SERVER is the
   // authority (can(canEditApps) + loadWritable on every call); the panel only decides
   // whether to SHOW the affordance (admin) and drives the confirmed flow. Every mid-flow
   // 401/403/404 lands on a calm PT-PT message via degradeMessage - never a crash.
 
   /** Turn edit mode ON. An EXPLICIT admin action (switch or discovery CTA) - the only way
    *  edit mode is ever entered. Detection never calls this (detect-then-ask). */
   const openEditMode = useCallback(() => {
     setEditMode(true);
     setDiscoveryDismissed(true); // opting in dismisses the discovery banner
     setEditPhase('compose');
   }, []);
 
   /** Turn edit mode OFF and clear the whole edit flow (back to a clean compose state). */
   const closeEditMode = useCallback(() => {
     setEditMode(false);
     setEditPhase('compose');
     setEditDraft('');
     setEditPreview(null);
     setEditMessage('');
     setEditProgress('');
     setEditBusy(false);
   }, []);
 
   /** Dismiss the discovery banner without entering edit mode. */
   const dismissDiscovery = useCallback(() => setDiscoveryDismissed(true), []);
 
   /** compose -> confirm: the panel asks the admin to confirm the intent before any build. */
   const askEditConfirm = useCallback(() => {
     if (editDraft.trim()) setEditPhase('confirm');
   }, [editDraft]);
 
   /** confirm -> compose: step back without running anything. */
   const cancelEditConfirm = useCallback(() => setEditPhase('compose'), []);
 
   /** note -> compose: start a fresh edit after a terminal message. */
   const resetEdit = useCallback(() => {
     setEditPhase('compose');
     setEditDraft('');
     setEditPreview(null);
     setEditMessage('');
     setEditProgress('');
   }, []);
 
   /** confirm -> running -> preview | note: run the CONFIRMED patch over the existing build
    *  machinery. Reads the platform token best-effort (a cross-origin/sandboxed iframe has
    *  none); with no app id / no token it degrades calmly rather than firing a doomed call. */
   const confirmEdit = useCallback(async () => {
     const id = appId();
     const token = readPlatformToken();
     const description = editDraft.trim();
     if (!id || !token || !description) {
       // No token readable (cross-origin) reads as an expired session; otherwise a generic note.
       setEditMessage(degradeMessage(token ? 0 : 401));
       setEditPhase('note');
       return;
     }
     setEditBusy(true);
     setEditProgress('');
     setEditPhase('running');
     const result = await runEditPatch({
       fetchImpl: (url, opts) => fetch(url, opts),
       appId: id,
       token,
       description,
       onProgress: (ev) => {
         const line = progressLine(ev);
         if (line) setEditProgress(line);
       },
     });
     setEditBusy(false);
     if (result.outcome === 'ready') {
+      // The JOB was CONFIRMED completed (poll), so newHeadSha reflects the finished build - never a
+      // mid-build snapshot. preRunSha is the diff point; newHeadSha is the head THIS edit produced.
       setEditPreview({ preRunSha: result.preRunSha, newHeadSha: result.newHeadSha });
       setEditPhase('preview');
     } else if (result.outcome === 'answered') {
       // The in-build classifier resolved the request without a build (no revision was created).
       setEditMessage('Não foi criada nenhuma revisão para este pedido. Reformule a alteração pretendida.');
       setEditPhase('note');
+    } else if (result.outcome === 'pending') {
+      // The stream dropped and the build did not reach a terminal status within the deadline. NOT a
+      // failure and NOT a false "no change" (M1): tell the admin it is still running.
+      setEditMessage(EDIT_COPY.stillRunning);
+      setEditPhase('note');
     } else if (result.outcome === 'failed') {
       setEditMessage('A revisão não foi concluída. Tente reformular o pedido.');
       setEditPhase('note');
     } else {
       // degraded (401/403/404/network) -> a calm, specific PT-PT message.
       setEditMessage(degradeMessage(result.status));
       setEditPhase('note');
     }
   }, [editDraft]);
 
   /** APPROVE = keep the new head. The build already activated it, so there is nothing to
    *  call - just clear the preview and confirm. */
   const approveEdit = useCallback(() => {
     setEditMessage(EDIT_COPY.approved);
     setEditPreview(null);
     setEditPhase('note');
   }, []);
 
-  /** ROLLBACK (one click) = forward-restore to the pre-run head. H1-gated server-side. */
+  /** ROLLBACK (one click) = forward-restore to the pre-run head. H1-gated server-side, and GUARDED
+   *  against a stale target (M2): guardedRollback re-reads the versions and REFUSES if HEAD is no
+   *  longer the head THIS edit produced (a concurrent change moved it) rather than blind-restoring
+   *  to preRunSha and wiping that unrelated change. A refusal shows a calm "refresh" message. */
   const rollbackEdit = useCallback(async () => {
     const id = appId();
     const token = readPlatformToken();
-    const sha = editPreview && editPreview.preRunSha;
-    if (!id || !token || !sha) {
+    const preRunSha = editPreview && editPreview.preRunSha;
+    const expectedHeadSha = editPreview && editPreview.newHeadSha;
+    if (!id || !token || !preRunSha || !expectedHeadSha) {
       setEditMessage(degradeMessage(token ? 0 : 401));
       setEditPhase('note');
       return;
     }
     setEditBusy(true);
-    const result = await rollbackToVersion({ fetchImpl: (url, opts) => fetch(url, opts), appId: id, token, sha });
+    const result = await guardedRollback({ fetchImpl: (url, opts) => fetch(url, opts), appId: id, token, preRunSha, expectedHeadSha });
     setEditBusy(false);
     if (result.ok) {
       setEditMessage(EDIT_COPY.rolledBack);
       setEditPreview(null);
       setEditPhase('note');
+    } else if (result.reason === 'head-advanced' || result.reason === 'target-missing') {
+      // HEAD moved (or the target is gone) between preview and click - refuse, never blind-restore.
+      setEditMessage(EDIT_COPY.headAdvanced);
+      setEditPreview(null);
+      setEditPhase('note');
     } else {
       setEditMessage(degradeMessage(result.status));
       setEditPhase('note');
     }
   }, [editPreview]);
 
   if (collapsed) {
     return (
       <button type="button" className="ekoa-assistant-launcher" onClick={open} aria-label="Abrir o assistente">
         <ChatIcon />
         <span>Assistente</span>
       </button>
     );
   }
 
   // A tour is on-screen for every phase except idle/cancelled (both mean "no tour").
   const tourActive = !!(tour && tour.status && tour.status !== 'idle' && tour.status !== 'cancelled');
 
   return (
     <aside className="ekoa-assistant" data-collapsed="false" role="complementary" aria-label="Assistente">
       <header className="ekoa-assistant-header">
         <span className="ekoa-assistant-titlegroup" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2, 0.5rem)' }}>
           <span className="ekoa-assistant-title">Assistente</span>
           {/* H2 detect-then-ask: a DISCREET, non-intrusive indicator that an admin capability
               exists. It does NOTHING - no click handler, no mode change, no privileged call. The
               opt-in edit-mode switch is H3. Styled inline (brand-neutral via the panel CSS vars)
               so it inherits the app's theme without a bespoke stylesheet rule. */}
           {admin ? (
             <span
               className="ekoa-assistant-admin-badge"
               data-admin="true"
               title="Tem permissões de administrador nesta aplicação."
               style={{
                 fontSize: 'var(--text-sm, 0.8125rem)',
                 fontWeight: 600,
                 color: 'var(--color-text-muted, #475569)',
                 border: '1px solid var(--color-border, #E2E8F0)',
                 borderRadius: 'var(--radius-sm, 0.375rem)',
                 padding: '0.05rem 0.4rem',
                 lineHeight: 1.4,
                 letterSpacing: '0.02em',
                 whiteSpace: 'nowrap',
               }}
             >
               Administrador
             </span>
           ) : null}
         </span>
         <button type="button" className="ekoa-assistant-close" onClick={collapsePanel} aria-label="Fechar o assistente">
           <CloseIcon />
         </button>
       </header>
 
       <div className="ekoa-assistant-modes" role="group" aria-label="Modo do assistente">
         {MODES.map((m) => (
           <button
             key={m.id}
             type="button"
             className="ekoa-assistant-mode"
             aria-pressed={mode === m.id}
             onClick={() => {
               // Pin the picked mode (click the pinned one again to unpin, back to inference).
               setPinnedMode((prev) => (prev === m.id ? null : m.id));
               setMode(m.id);
             }}
           >
             {m.label}
           </button>
         ))}
       </div>
 
       {/* H3 admin bar - the OPT-IN edit-mode switch. Shown ONLY when detection said admin
           (detect-then-ask); OFF by default; flipped only by this explicit click. It is a
           distinct control from the visitor mode toggle above, so an admin always knows they
           are entering a different plane (editing the app, not chatting as a visitor). */}
       {admin ? (
         <div className="ekoa-assistant-adminbar">
           <span className="ekoa-assistant-adminbar-label">Modo de edição</span>
           <button
             type="button"
@@ -795,168 +811,173 @@ export function AssistantPanel({ defaultOpen = false } = {}) {
             <button type="button" className="ekoa-assistant-discovery-cta" onClick={openEditMode}>
               Ativar modo de edição
             </button>
             <button type="button" className="ekoa-assistant-discovery-dismiss" onClick={dismissDiscovery}>
               Agora não
             </button>
           </div>
         </div>
       ) : null}
 
       {/* H3 edit affordance - a dedicated, visually distinct section (only when editMode is on).
           The whole patch flow lives here: compose -> confirm -> running -> preview -> note. */}
       {admin && editMode ? (
         <section className="ekoa-assistant-edit" data-edit-phase={editPhase} aria-label="Modo de edição (administrador)">
           <div className="ekoa-assistant-edit-head">
             <span className="ekoa-assistant-edit-title">Modo de edição</span>
             <span className="ekoa-assistant-edit-hint">Alterações à aplicação (administrador)</span>
           </div>
 
           {editPhase === 'compose' ? (
             <div className="ekoa-assistant-edit-compose">
               <textarea
                 className="ekoa-assistant-edit-textarea"
                 placeholder="Descreva a alteração. Por exemplo: adicione um botão de exportação na tabela de honorários."
                 value={editDraft}
                 onChange={(e) => setEditDraft(e.target.value)}
                 rows={2}
                 aria-label="Pedido de alteração"
               />
               <button
                 type="button"
                 className="ekoa-assistant-edit-primary"
                 onClick={askEditConfirm}
                 disabled={!editDraft.trim()}
               >
                 Preparar alteração
               </button>
             </div>
           ) : null}
 
           {editPhase === 'confirm' ? (
             <div className="ekoa-assistant-edit-confirm">
               <p className="ekoa-assistant-edit-confirm-text">{EDIT_COPY.confirm}</p>
               <div className="ekoa-assistant-edit-actions">
                 <button type="button" className="ekoa-assistant-edit-primary" onClick={confirmEdit}>
                   Confirmar
                 </button>
                 <button type="button" className="ekoa-assistant-edit-secondary" onClick={cancelEditConfirm}>
                   Cancelar
                 </button>
               </div>
             </div>
           ) : null}
 
           {editPhase === 'running' ? (
             <div className="ekoa-assistant-edit-running" role="status">
               <span className="ekoa-assistant-edit-spinner" aria-hidden="true" />
               <span className="ekoa-assistant-edit-progress">{editProgress || EDIT_COPY.preparing}</span>
             </div>
           ) : null}
 
           {editPhase === 'preview' && editPreview ? (
             <div className="ekoa-assistant-edit-preview">
               {editPreview.newHeadSha && editPreview.newHeadSha !== editPreview.preRunSha ? (
                 <>
                   <p className="ekoa-assistant-edit-preview-text">{EDIT_COPY.applied}</p>
                   <dl className="ekoa-assistant-edit-diff">
                     <div>
                       <dt>Versão anterior</dt>
                       <dd>{shortSha(editPreview.preRunSha)}</dd>
                     </div>
                     <div>
                       <dt>Nova versão</dt>
                       <dd>{shortSha(editPreview.newHeadSha)}</dd>
                     </div>
                   </dl>
                   <div className="ekoa-assistant-edit-actions">
                     <button type="button" className="ekoa-assistant-edit-primary" onClick={approveEdit}>
                       Aprovar
                     </button>
-                    <button
-                      type="button"
-                      className="ekoa-assistant-edit-secondary"
-                      onClick={rollbackEdit}
-                      disabled={editBusy}
-                    >
-                      Reverter
-                    </button>
+                    {/* Reverter only when there is a pre-run head to restore to (a follow-up build on
+                        an existing app always has one; guarded defensively). The click re-checks HEAD
+                        (M2) before restoring, so a concurrent change refuses rather than gets wiped. */}
+                    {editPreview.preRunSha ? (
+                      <button
+                        type="button"
+                        className="ekoa-assistant-edit-secondary"
+                        onClick={rollbackEdit}
+                        disabled={editBusy}
+                      >
+                        Reverter
+                      </button>
+                    ) : null}
                   </div>
                 </>
               ) : (
                 <>
                   <p className="ekoa-assistant-edit-preview-text">{EDIT_COPY.noChange}</p>
                   <div className="ekoa-assistant-edit-actions">
                     <button type="button" className="ekoa-assistant-edit-secondary" onClick={resetEdit}>
                       Nova alteração
                     </button>
                   </div>
                 </>
               )}
             </div>
           ) : null}
 
           {editPhase === 'note' ? (
             <div className="ekoa-assistant-edit-note" role="status">
               <p className="ekoa-assistant-edit-note-text">{editMessage}</p>
               <div className="ekoa-assistant-edit-actions">
                 <button type="button" className="ekoa-assistant-edit-secondary" onClick={resetEdit}>
                   Nova alteração
                 </button>
               </div>
             </div>
           ) : null}
         </section>
       ) : null}
 
       <div className="ekoa-assistant-messages" ref={listRef}>
         {messages.length === 0 ? (
           <div className="ekoa-assistant-intro">
             <p className="ekoa-assistant-intro-lead">
               Olá. Posso ajudar de três formas: mostrar uma visão geral da aplicação, ensinar como
               a usar passo a passo, ou operá-la por si. Experimente:
             </p>
             <div className="ekoa-assistant-examples">
               {EXAMPLES.map((ex) => (
                 <button key={ex.prompt} type="button" className="ekoa-assistant-example" onClick={() => onExample(ex)}>
                   <span className="ekoa-assistant-example-kind">{ex.kind}</span>
                   {ex.prompt}
                 </button>
               ))}
             </div>
           </div>
         ) : (
           messages.map((m) => (
             <div key={m.id} className="ekoa-assistant-turn" data-role={m.role}>
               {m.content ? <div className="ekoa-assistant-bubble">{m.content}</div> : null}
 
               {m.citations && m.citations.length ? (
                 <div className="ekoa-assistant-citations">
                   <div className="ekoa-assistant-citations-title">Fontes</div>
                   <ul>
                     {m.citations.map((c, i) => (
                       <li key={`${c.collection}/${c.docId}/${i}`}>
                         <span className="ekoa-assistant-citation-collection">{c.collection}</span>
                         {' - '}
                         <span className="ekoa-assistant-citation-title">{c.title}</span>
                       </li>
                     ))}
                   </ul>
                 </div>
               ) : null}
 
               {m.runs && m.runs.length ? (
                 <div className="ekoa-assistant-runs">
                   {m.runs.map((r) => (
                     <div key={r.id} className="ekoa-assistant-run" data-status={r.status}>
                       <span className="ekoa-assistant-run-dot" aria-hidden="true" />
                       <span>{runLabel(r.status)}</span>
                     </div>
                   ))}
                 </div>
               ) : null}
             </div>
           ))
         )}
       </div>
 
       {tourActive ? (
diff --git a/api/assets/panel-runtime/src/edit-mode.js b/api/assets/panel-runtime/src/edit-mode.js
index d034598..625080b 100644
--- a/api/assets/panel-runtime/src/edit-mode.js
+++ b/api/assets/panel-runtime/src/edit-mode.js
@@ -1,315 +1,439 @@
 /*
  * Operator Assistant Panel - EDIT MODE controller (operator-run H3; admins only).
  *
  * A thin FRONT-END over the platform's EXISTING build machinery (all H1-gated). It is
  * NOT a second brain: an admin's edit request becomes a SCOPED FOLLOW-UP BUILD (a
  * "patch run") over the app's own git repo, exactly the path the dashboard uses.
  *
  * This module owns the NETWORK side of that flow, factored out of AssistantPanel.jsx so
  * it can be unit-proven against a fake fetch (tests/apps/edit-mode.test.ts). Every call
  * targets the PLATFORM /api/v1/* API with the admin's platform Bearer - a SEPARATE plane
  * from the served-app POST /api/app-assistant, which stays visitor-blind (it never reads
  * the caller JWT). Nothing here grounds, bills, or issues an assistant turn.
  *
  * The plane's gates are the server's, not ours:
  *   - POST /api/v1/jobs { kind:'build', artifactId, description } → a follow-up build,
  *     gated server-side by can(canEditApps) AND loadWritable(actor, artifactId) (H1).
  *     A non-admin (no token / plain user / cross-org) is refused there with a uniform
  *     404, so this front-end can offer the switch freely: the SERVER is the authority.
  *   - GET  /api/v1/artifacts/:id/versions → the commit list (newest first). We read it
  *     BEFORE the run (the pre-run head = the rollback target / diff point) and AFTER
  *     (the new head) for the preview.
  *   - POST /api/v1/artifacts/:id/versions/:sha/restore → forward-restore to the pre-run
  *     head (one-click rollback). writable()-gated + canEditApps (H1).
  *   - GET  /api/v1/jobs/:id/events?token=... → the job SSE (progress narration). The
  *     job's own owner-scoped stream (?token= = the same admin token that created it).
  *
  * Graceful degradation is a first-class outcome: any mid-flow 401/403/404 (token
  * expired, lost writability, app gone) resolves to a calm PT-PT message, never a throw
  * and never a crash. PT-PT throughout, no emoji, no em/en-dash.
  */
 
 /** The build-jobs collection endpoint (a follow-up build is a POST here with artifactId). */
 export const JOBS_ENDPOINT = '/api/v1/jobs';
 
 /** GET the artifact's version list (commits, newest first). */
 export function versionsEndpoint(appId) {
   return `/api/v1/artifacts/${encodeURIComponent(appId)}/versions`;
 }
 
 /** POST to forward-restore the artifact to `sha` (one-click rollback). */
 export function restoreEndpoint(appId, sha) {
   return `/api/v1/artifacts/${encodeURIComponent(appId)}/versions/${encodeURIComponent(sha)}/restore`;
 }
 
 /** The job SSE stream. EventSource cannot set headers (CONV-1), so the job stream
  *  authenticates via ?token= (verifySseToken, the same chain requireAuth runs); we read
  *  it with fetch (the panel's one transport) rather than EventSource so it stays
  *  abortable and unit-testable. */
 export function jobEventsUrl(jobId, token) {
   return `/api/v1/jobs/${encodeURIComponent(jobId)}/events?token=${encodeURIComponent(token)}`;
 }
 
+/** GET the persisted job record (its terminal status is the AUTHORITATIVE "did the build finish?"
+ *  signal - not the SSE, which a proxy/network blip can close early). auth:'user' (admin Bearer). */
+export function jobEndpoint(jobId) {
+  return `/api/v1/jobs/${encodeURIComponent(jobId)}`;
+}
+
+/** Job record terminal statuses (mirrors api/src/agents/jobs.ts isTerminal / patchJob writes):
+ *  'completed' is success; 'failed' and 'cancelled' are failure; 'created'/'running' are in-flight. */
+const TERMINAL_SUCCESS = 'completed';
+const TERMINAL_FAILURE = new Set(['failed', 'cancelled']);
+
 /** PT-PT copy for the edit flow. Kept here so the panel and the tests share one source
  *  of truth for the confirmation wording, the progress fallback and the empty-diff note. */
 export const EDIT_COPY = {
   confirm: 'Vou preparar esta alteração como uma revisão. Confirma?',
   preparing: 'A preparar a alteração...',
   applied: 'Alteração aplicada. Reveja antes de aprovar.',
   noChange: 'A revisão terminou sem alterações ao código.',
   approved: 'Alteração mantida.',
   rolledBack: 'Alteração revertida.',
+  // The build did not reach a terminal state within the poll deadline (a dropped stream + a slow
+  // build). NOT a failure and NOT a false "no change": tell the admin it is still running.
+  stillRunning: 'A revisão ainda está em curso. Verifique novamente dentro de momentos.',
+  // The head moved between the preview and the Reverter click (another admin / a dashboard action /
+  // a later restore). Refuse the rollback rather than wipe that unrelated change; ask for a refresh.
+  headAdvanced: 'A aplicação foi alterada entretanto; atualize a pré-visualização.',
 };
 
 /** Map a mid-flow platform failure onto a calm PT-PT message (graceful degradation).
  *  401 = the admin's session expired; 403 = writability was lost (no longer an editor);
  *  404 = the app is gone / not writable; anything else = a generic, non-alarming line. */
 export function degradeMessage(status) {
   if (status === 401) return 'A sua sessão expirou. Inicie sessão novamente para continuar a editar.';
   if (status === 403) return 'Já não tem permissão para editar esta aplicação.';
   if (status === 404) return 'Esta aplicação já não está disponível para edição.';
   return 'Não foi possível concluir a alteração. Tente novamente mais tarde.';
 }
 
 /** A client-side correlation id for the follow-up build. A follow-up does NOT reserve a
  *  session (only a first build does); sessionId merely tags the job record + run, so a
  *  fresh per-edit id is correct and collision-safe. */
 export function newEditSessionId(appId) {
   const rand = Math.random().toString(36).slice(2, 10);
   return `edit-${appId || 'app'}-${Date.now()}-${rand}`;
 }
 
 /**
  * Parse accumulated SSE text into the complete events plus the unparsed remainder. An SSE
  * event is terminated by a blank line; the job stream carries its JobEvent JSON on
  * `data:` lines (other fields - `id:`, `event:`, `:` comments - are ignored). The caller
  * accumulates `rest` and feeds it back with the next chunk, so a frame split across chunk
  * boundaries is never dropped. A garbled/partial frame is skipped, never thrown.
  */
 export function parseSseBuffer(buffer) {
   const events = [];
   const normalised = String(buffer || '').replace(/\r\n/g, '\n');
   const chunks = normalised.split('\n\n');
   const rest = chunks.pop() || ''; // trailing, possibly incomplete frame stays buffered
   for (const chunk of chunks) {
     const dataLines = chunk.split('\n').filter((l) => l.startsWith('data:'));
     if (!dataLines.length) continue;
     const payload = dataLines.map((l) => l.slice(5).trimStart()).join('\n');
     if (!payload) continue;
     try {
       events.push(JSON.parse(payload));
     } catch {
       /* a partial or garbled frame - skip it, never crash the stream */
     }
   }
   return { events, rest };
 }
 
 /**
  * Start the follow-up build (the patch run) for `appId`. POSTs the H1-gated jobs endpoint
  * with the admin Bearer. Returns a discriminated result:
  *   - { ok:true, status:'created', jobId }  - the build was accepted (202)
  *   - { ok:true, status:'answered', reason} - the in-build classifier resolved it with no
  *                                             job (e.g. it read the request as a question)
  *   - { ok:false, status }                  - a refusal (401/403/404/409/...) → the panel
  *                                             degrades on `status`; the SERVER is the gate
  * Never throws - a network failure is { ok:false, status:0 }.
  */
 export async function startEditJob({ fetchImpl, appId, token, description, sessionId }) {
   let res;
   try {
     res = await fetchImpl(JOBS_ENDPOINT, {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         Authorization: `Bearer ${token}`,
       },
       body: JSON.stringify({
         kind: 'build',
         description,
         sessionId: sessionId || newEditSessionId(appId),
         language: 'pt',
         artifactId: appId,
       }),
     });
   } catch {
     return { ok: false, status: 0 };
   }
   if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
   let data = null;
   try {
     data = await res.json();
   } catch {
     data = null;
   }
   if (data && data.status === 'answered') {
     return { ok: true, status: 'answered', reason: typeof data.reason === 'string' ? data.reason : '' };
   }
   const jobId = data && data.job && typeof data.job.id === 'string' ? data.job.id : undefined;
   if (!jobId) return { ok: false, status: res.status };
   return { ok: true, status: 'created', jobId };
 }
 
 /**
  * Read the artifact's version list. Returns { ok:true, items, head } where `head` is the
  * newest commit sha (items[0].sha) or undefined for a fresh repo, or { ok:false, status }
  * on a refusal. Never throws.
  */
 export async function readVersions({ fetchImpl, appId, token }) {
   let res;
   try {
     res = await fetchImpl(versionsEndpoint(appId), {
       method: 'GET',
       headers: { Authorization: `Bearer ${token}` },
     });
   } catch {
     return { ok: false, status: 0 };
   }
   if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
   let data = null;
   try {
     data = await res.json();
   } catch {
     data = null;
   }
   const items = data && Array.isArray(data.items) ? data.items : [];
   const head = items.length && items[0] && typeof items[0].sha === 'string' ? items[0].sha : undefined;
   return { ok: true, items, head };
 }
 
 /**
  * Forward-restore the artifact to `sha` (one-click rollback to the pre-run head). Returns
  * { ok:true, newHeadSha } or { ok:false, status } on a refusal. Never throws.
  */
 export async function rollbackToVersion({ fetchImpl, appId, token, sha }) {
   let res;
   try {
     res = await fetchImpl(restoreEndpoint(appId, sha), {
       method: 'POST',
       headers: { Authorization: `Bearer ${token}` },
     });
   } catch {
     return { ok: false, status: 0 };
   }
   if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
   let data = null;
   try {
     data = await res.json();
   } catch {
     data = null;
   }
   const newHeadSha = data && typeof data.newHeadSha === 'string' ? data.newHeadSha : undefined;
   return { ok: true, newHeadSha };
 }
 
+/**
+ * One-click rollback, GUARDED against a stale target (M2). Reverter forward-restores to the pre-run
+ * head; a blind restore would silently WIPE any change that moved HEAD between the preview and the
+ * click (another admin, a dashboard action, a later restore). So before restoring: RE-READ the
+ * versions and require HEAD to still be EXACTLY the head THIS edit produced (`expectedHeadSha`), and
+ * require the pre-run target to still exist in history. If HEAD advanced or the target is gone, the
+ * rollback is REFUSED (no restore call) so the panel can show a calm "refresh the preview" message.
+ * Returns:
+ *   - { ok:true, newHeadSha }             - restore fired to the pre-run head
+ *   - { ok:false, reason:'head-advanced' }- HEAD is no longer this edit's head (someone else changed it)
+ *   - { ok:false, reason:'target-missing'}- the pre-run target sha is no longer in the history
+ *   - { ok:false, status }                - a mid-flow refusal reading versions / restoring
+ */
+export async function guardedRollback({ fetchImpl, appId, token, preRunSha, expectedHeadSha }) {
+  const cur = await readVersions({ fetchImpl, appId, token });
+  if (!cur.ok) return { ok: false, status: cur.status };
+  // HEAD must still be the exact head this edit produced - else a concurrent change moved it.
+  if (cur.head !== expectedHeadSha) return { ok: false, reason: 'head-advanced' };
+  // The pre-run target must still exist (hardening: never restore to a sha the history dropped).
+  const hasTarget = Array.isArray(cur.items) && cur.items.some((v) => v && v.sha === preRunSha);
+  if (!hasTarget) return { ok: false, reason: 'target-missing' };
+  return rollbackToVersion({ fetchImpl, appId, token, sha: preRunSha });
+}
+
 /**
  * Consume the job SSE stream with fetch, forwarding each JobEvent to `onEvent`, and
  * resolve once a terminal event lands (or the stream ends). Outcomes:
  *   - { outcome:'complete', event } - the build finished
  *   - { outcome:'error', event }    - the build failed (JobEvent error)
  *   - { outcome:'http-error', status } - the stream endpoint refused (e.g. token expired)
  *   - { outcome:'closed' }          - the stream ended / a network blip with no terminal
  *                                     event (the caller re-reads versions to see the head)
  * Never throws.
  */
 export async function streamJobEvents({ fetchImpl, jobId, token, onEvent, signal }) {
   let res;
   try {
     res = await fetchImpl(jobEventsUrl(jobId, token), {
       method: 'GET',
       ...(signal ? { signal } : {}),
     });
   } catch {
     return { outcome: 'closed' };
   }
   if (!res || !res.ok) return { outcome: 'http-error', status: res ? res.status : 0 };
   const body = res.body;
   if (!body || typeof body.getReader !== 'function') return { outcome: 'closed' };
 
   const reader = body.getReader();
   const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
   let buffer = '';
   try {
     for (;;) {
       const { value, done } = await reader.read();
       if (done) break;
       buffer += decoder ? decoder.decode(value, { stream: true }) : String(value || '');
       const parsed = parseSseBuffer(buffer);
       buffer = parsed.rest;
       for (const ev of parsed.events) {
         if (onEvent) onEvent(ev);
         if (ev && ev.type === 'complete') {
           try { await reader.cancel(); } catch { /* already closing */ }
           return { outcome: 'complete', event: ev };
         }
         if (ev && ev.type === 'error') {
           try { await reader.cancel(); } catch { /* already closing */ }
           return { outcome: 'error', event: ev };
         }
       }
     }
   } catch {
     /* aborted (unmount / timeout) or read error → treated as a soft close */
   }
   return { outcome: 'closed' };
 }
 
+/** Fetch + parse JSON WITHOUT throwing (mirrors the e2e safeJson idiom): a non-2xx status or a body
+ *  that is not valid JSON (e.g. the dev-proxy's text/plain "proxy error" 502) comes back as
+ *  { ok:false, status, json:null } rather than an exception, so the poll below can class blips. */
+async function safeJson(fetchImpl, url, init) {
+  try {
+    const r = await fetchImpl(url, init);
+    if (!r) return { ok: false, status: 0, json: null };
+    let json = null;
+    try { json = await r.json(); } catch { json = null; }
+    return { ok: !!r.ok && json !== null, status: r.status, json };
+  } catch {
+    return { ok: false, status: 0, json: null };
+  }
+}
+
+/**
+ * Poll GET /api/v1/jobs/:id until the JOB RECORD reaches a terminal status - the AUTHORITATIVE
+ * "did the build finish?" signal (the SSE is only live progress and can drop on a proxy/network
+ * blip while the build keeps running and then activates a new head). Transient-tolerant, exactly
+ * like the fees-knowledge e2e build poll: a deterministic 4xx (auth/route/store - will not
+ * self-heal) degrades on its status; a 5xx / non-JSON / network blip is tolerated up to a bounded
+ * count; the deadline yields `pending` (still running, not a false "done"). Outcomes:
+ *   - { outcome:'terminal', status:'completed', job } | { outcome:'terminal', status:'failed', job }
+ *   - { outcome:'degraded', status } - a real 4xx, or too many transients
+ *   - { outcome:'pending' }          - the deadline passed with no terminal status
+ * `now`/`sleep` are injectable so the flow is testable without real timers.
+ */
+export async function pollJobUntilTerminal({
+  fetchImpl,
+  jobId,
+  token,
+  pollMs = 3000,
+  deadlineMs = 20 * 60 * 1000,
+  maxTransients = 30,
+  now = () => Date.now(),
+  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
+  signal,
+}) {
+  const init = { method: 'GET', headers: { Authorization: `Bearer ${token}` }, ...(signal ? { signal } : {}) };
+  const deadline = now() + deadlineMs;
+  let transients = 0;
+  for (;;) {
+    if (now() > deadline) return { outcome: 'pending' };
+    const res = await safeJson(fetchImpl, jobEndpoint(jobId), init);
+    if (!res.ok) {
+      // A deterministic 4xx (auth/route/store) will not self-heal; retrying only masks it -> degrade.
+      if (res.status >= 400 && res.status < 500) return { outcome: 'degraded', status: res.status };
+      // 5xx / non-JSON / network (proxy-502 blips) are transient -> tolerate a bounded number.
+      transients += 1;
+      if (transients > maxTransients) return { outcome: 'degraded', status: res.status || 0 };
+      await sleep(pollMs);
+      continue;
+    }
+    transients = 0;
+    const status = res.json && typeof res.json.status === 'string' ? res.json.status : undefined;
+    if (status === TERMINAL_SUCCESS) return { outcome: 'terminal', status: 'completed', job: res.json };
+    if (status && TERMINAL_FAILURE.has(status)) return { outcome: 'terminal', status: 'failed', job: res.json };
+    await sleep(pollMs);
+  }
+}
+
 /**
- * Run the whole confirmed patch, front-to-back, as a sequence of the H1-gated platform
- * calls. Returns a discriminated result the panel maps straight onto its UI; every
- * network refusal is a graceful outcome, never a throw:
- *   - { outcome:'ready', preRunSha, newHeadSha } - build done; show APPROVE vs ROLLBACK
+ * Run the whole confirmed patch, front-to-back, as a sequence of the H1-gated platform calls.
+ * Returns a discriminated result the panel maps straight onto its UI; every network refusal is a
+ * graceful outcome, never a throw:
+ *   - { outcome:'ready', preRunSha, newHeadSha } - build CONFIRMED completed; show APPROVE vs ROLLBACK
  *   - { outcome:'answered', reason }             - no job (in-build classifier answered)
- *   - { outcome:'failed', event }                - the build reported an error event
+ *   - { outcome:'failed', job }                  - the JOB reached a terminal failure status
+ *   - { outcome:'pending' }                      - the poll deadline passed (still running)
  *   - { outcome:'degraded', status }             - a mid-flow 401/403/404/... → calm msg
  *
  * `onProgress(jobEvent)` receives each streamed JobEvent (the panel narrates plan_step).
+ *
+ * The SSE is streamed ONLY for live progress; it is NOT treated as terminal (M1): a blip that
+ * closes the stream before `complete` would otherwise read as "no change" while the build finishes
+ * moments later and deploys a real edit. So after the stream ends (or drops), the JOB RECORD is
+ * polled to a terminal status, and only a CONFIRMED 'completed' reads the new head for the preview.
  */
-export async function runEditPatch({ fetchImpl, appId, token, description, onProgress, signal }) {
+export async function runEditPatch({
+  fetchImpl,
+  appId,
+  token,
+  description,
+  onProgress,
+  signal,
+  pollMs,
+  deadlineMs,
+  maxTransients,
+  now,
+  sleep,
+}) {
   // 1. Capture the pre-run head BEFORE the build - the rollback target and diff point.
   const before = await readVersions({ fetchImpl, appId, token });
   if (!before.ok) return { outcome: 'degraded', status: before.status };
   const preRunSha = before.head;
 
   // 2. Start the follow-up build (the H1-gated patch run).
   const started = await startEditJob({
     fetchImpl,
     appId,
     token,
     description,
     sessionId: newEditSessionId(appId),
   });
   if (!started.ok) return { outcome: 'degraded', status: started.status };
   if (started.status === 'answered') return { outcome: 'answered', reason: started.reason };
 
-  // 3. Stream the job SSE - live plan_step narration to onProgress.
-  const stream = await streamJobEvents({
+  // 3. Stream the job SSE for LIVE progress only (best-effort). A dropped stream is NOT terminal.
+  await streamJobEvents({
     fetchImpl,
     jobId: started.jobId,
     token,
     signal,
     onEvent: (ev) => {
       if (onProgress) onProgress(ev);
     },
   });
-  if (stream.outcome === 'http-error') return { outcome: 'degraded', status: stream.status };
-  if (stream.outcome === 'error') return { outcome: 'failed', event: stream.event };
 
-  // 4. Read the new head for the preview (the versions read is the source of truth for the
-  //    head; a soft close still lands here, and an unchanged head reads as "no change").
+  // 4. AUTHORITATIVELY confirm the build finished by polling the job record (transient-tolerant).
+  const poll = await pollJobUntilTerminal({ fetchImpl, jobId: started.jobId, token, pollMs, deadlineMs, maxTransients, now, sleep, signal });
+  if (poll.outcome === 'degraded') return { outcome: 'degraded', status: poll.status };
+  if (poll.outcome === 'pending') return { outcome: 'pending' };
+  if (poll.status === 'failed') return { outcome: 'failed', job: poll.job };
+
+  // 5. Job CONFIRMED completed -> the versions read now reflects the FINISHED build (never a
+  //    mid-build snapshot). An unchanged head here is a true "no change".
   const after = await readVersions({ fetchImpl, appId, token });
   if (!after.ok) return { outcome: 'degraded', status: after.status };
   return { outcome: 'ready', preRunSha, newHeadSha: after.head, jobId: started.jobId };
 }
 
 /** A one-line PT-PT narration for a streamed JobEvent (plan_step primarily). Returns null
  *  for events with nothing worth showing, so the panel keeps the last meaningful line. */
 export function progressLine(ev) {
   if (!ev || typeof ev !== 'object') return null;
   if (ev.type === 'plan_step') {
     const text = ev.description || ev.detail || ev.status;
     return typeof text === 'string' && text ? text : null;
   }
   if (ev.type === 'routing') return 'A preparar a alteração...';
   return null;
 }
diff --git a/api/tests/apps/assistant-panel.test.ts b/api/tests/apps/assistant-panel.test.ts
index 8cc97e4..0a024e8 100644
--- a/api/tests/apps/assistant-panel.test.ts
+++ b/api/tests/apps/assistant-panel.test.ts
@@ -156,143 +156,160 @@ describe('H2 admin detection (detect-then-ask)', () => {
   });
 
   it('DETECT-THEN-ASK: admin:true never auto-enables anything (no edit mode, no privileged call)', () => {
     // The indicator is inert: no click handler, no mode change, no fetch driven by `admin`.
     const badge = PANEL.slice(PANEL.indexOf('ekoa-assistant-admin-badge'), PANEL.indexOf('Administrador') + 20);
     expect(badge).not.toContain('onClick');
     // `admin` is SET once (the detection) and READ only to render the badge — it drives no action.
     expect((PANEL.match(/setAdmin\(/g) || []).length).toBe(1);
     // H3 now introduces the edit-mode switch (setEditMode), but detect-then-ask still binds: the
     // DETECTION effect never enables edit mode — it only sets `admin`. (The full H3 opt-in invariants
     // are pinned in the "H3 edit mode" block below.)
     const whoamiEffect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
     expect(whoamiEffect).toContain('setAdmin');
     expect(whoamiEffect).not.toContain('setEditMode');
     // The invariant is stated in the source so review can pin it.
     expect(PANEL).toContain('detect-then-ask');
     expect(PANEL).toContain('H3');
   });
 
   it('detection is zero-token: whoami is a non-LLM GET, never an assistant turn', () => {
     // The detection path must not post to the assistant endpoint or dispatch actions.
     const effect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
     expect(effect).not.toContain('runActions');
     expect(effect).not.toMatch(/method:\s*'POST'/);
     // The zero-token invariant is stated on the detection effect so review can pin it.
     expect(PANEL).toContain('zero-token');
   });
 });
 
 describe('H3 edit mode (admins only) — opt-in switch + detect-then-ask wiring', () => {
   it('the edit-mode switch is ABSENT unless admin, and starts OFF (opt-in, fail-closed)', () => {
     // editMode starts false: entering edit mode is never the default — it is an explicit opt-in.
     expect(PANEL).toMatch(/const \[editMode, setEditMode\] = useState\(false\)/);
     // The admin bar (which holds the switch) is rendered only when detection said admin.
     expect(PANEL).toContain('ekoa-assistant-adminbar');
     expect(PANEL).toMatch(/\{admin \? \(/); // admin-gated block
     // The switch is a real accessible toggle reflecting editMode.
     expect(PANEL).toContain('ekoa-assistant-editswitch');
     expect(PANEL).toMatch(/role="switch"/);
     expect(PANEL).toMatch(/aria-checked=\{editMode\}/);
   });
 
   it('enabling the switch reveals the edit affordance (gated on admin && editMode)', () => {
     // The edit section renders only for an admin who has opted in — not from detection alone.
     expect(PANEL).toMatch(/admin && editMode \? \(/);
     expect(PANEL).toContain('ekoa-assistant-edit'); // the distinct edit section
     expect(PANEL).toContain('data-edit-phase'); // its phase machine (compose→confirm→running→preview→note)
     // Kept visually distinct from the visitor OPERAR/MOSTRAR/ENSINAR modes so an admin always knows.
     expect(PANEL).toContain('Modo de edição');
   });
 
   it('DETECT-THEN-ASK is binding: edit mode is entered ONLY by an explicit click, never by detection', () => {
     // setEditMode(true) is reachable through exactly one path: openEditMode (the explicit opt-in).
     expect(PANEL).toContain('const openEditMode');
     expect(PANEL).toMatch(/openEditMode[\s\S]{0,120}setEditMode\(true\)/);
     // The only setEditMode(true) in the file is inside that explicit handler — detection cannot flip it.
     expect((PANEL.match(/setEditMode\(true\)/g) || []).length).toBe(1);
     // openEditMode is wired to click handlers (the switch + the discovery CTA), never to an effect.
     expect((PANEL.match(/onClick=\{[^}]*openEditMode/g) || []).length).toBeGreaterThanOrEqual(1);
     // The whoami DETECTION effect touches neither the switch nor the discovery state.
     const whoamiEffect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
     expect(whoamiEffect).not.toContain('setEditMode');
     expect(whoamiEffect).not.toContain('openEditMode');
   });
 
   it('admin discovery is surfaced once, dismissibly, and NEVER auto-enables edit', () => {
     // Shown only to a detected admin who has not opted in and not dismissed it.
     expect(PANEL).toContain('ekoa-assistant-discovery');
     expect(PANEL).toMatch(/admin && !editMode && !discoveryDismissed \? \(/);
     // A concrete PT-PT suggestion (the conversion moment), plus a dismiss — non-blocking.
     expect(PANEL).toContain('Pode pedir alterações a esta aplicação');
     expect(PANEL).toContain('dismissDiscovery');
     // The banner's CTA is the same explicit opt-in (a click), so it never auto-enables edit.
     expect(PANEL).toMatch(/discovery-cta[\s\S]{0,80}onClick=\{openEditMode\}/);
   });
 
   it('the edit flow uses the PLATFORM /api/v1/* plane (via edit-mode), NOT the visitor assistant endpoint', () => {
     // The edit machinery is the separate module (a follow-up build + versions/restore), imported here.
     expect(PANEL).toContain("from './edit-mode'");
     expect(PANEL).toContain('runEditPatch'); // POST /api/v1/jobs (the H1-gated follow-up build)
-    expect(PANEL).toContain('rollbackToVersion'); // POST /api/v1/artifacts/:id/versions/:sha/restore
+    expect(PANEL).toContain('guardedRollback'); // guarded POST /api/v1/artifacts/:id/versions/:sha/restore
     // The confirm step gates the patch run behind an explicit confirmation (PT-PT).
     expect(PANEL).toContain('EDIT_COPY.confirm');
-    expect(PANEL).toMatch(/const confirmEdit[\s\S]{0,600}runEditPatch/);
+    expect(PANEL).toMatch(/const confirmEdit[\s\S]{0,700}runEditPatch/);
     // The served-app POST /api/app-assistant plane stays visitor-blind: the edit handlers never
-    // route through ENDPOINT. runEditPatch/rollbackToVersion drive the /api/v1/* plane instead.
+    // route through ENDPOINT. runEditPatch/guardedRollback drive the /api/v1/* plane instead.
     const confirmEdit = PANEL.slice(PANEL.indexOf('const confirmEdit'), PANEL.indexOf('const approveEdit'));
     expect(confirmEdit).not.toContain('ENDPOINT');
     expect(confirmEdit).not.toContain('/api/app-assistant');
   });
 
   it('degrades gracefully on a mid-flow 401/403/404 (a calm PT-PT message, never a crash)', () => {
     // The panel maps a degraded outcome onto degradeMessage and a terminal 'note' phase.
     expect(PANEL).toContain('degradeMessage');
     expect(PANEL).toMatch(/outcome === 'ready'/);
     expect(PANEL).toMatch(/setEditPhase\('note'\)/);
     // Rollback is one click and also degrades on a refusal rather than throwing.
-    expect(PANEL).toMatch(/const rollbackEdit[\s\S]{0,600}rollbackToVersion/);
+    expect(PANEL).toMatch(/const rollbackEdit[\s\S]{0,700}guardedRollback/);
+  });
+
+  it('M1: an early SSE close is not "done" - the preview waits on the confirmed job (pending stays calm)', () => {
+    // The panel surfaces the M1 outcomes: a still-running build after a dropped stream shows the calm
+    // "still running" note (never a false "no change"); a real preview only comes from outcome:ready.
+    expect(PANEL).toMatch(/outcome === 'pending'/);
+    expect(PANEL).toContain('EDIT_COPY.stillRunning');
+  });
+
+  it('M2: Reverter re-checks HEAD before restoring and refuses a stale rollback with a calm message', () => {
+    // The rollback passes BOTH the pre-run target AND the head this edit produced, so guardedRollback
+    // can refuse if HEAD advanced (a concurrent change) rather than blind-restoring and wiping it.
+    expect(PANEL).toMatch(/guardedRollback\(\{[\s\S]{0,200}expectedHeadSha/);
+    expect(PANEL).toMatch(/reason === 'head-advanced'/);
+    expect(PANEL).toContain('EDIT_COPY.headAdvanced');
+    // Reverter is only offered when there is a pre-run head to restore to.
+    expect(PANEL).toMatch(/editPreview\.preRunSha \? \(/);
   });
 });
 
 describe('D2/G2 lazy-load wiring', () => {
   it('the app bundle carries only a plain-DOM launcher (no React) that lazy-loads the platform panel-runtime', () => {
     // Since G2 the panel is NOT baked into the app bundle: mount.js renders a launcher
     // with plain DOM and injects the platform asset on interaction/idle. No React here.
     expect(MOUNT).not.toMatch(/from\s+['"]react/);
     expect(MOUNT).not.toContain('createRoot');
     expect(MOUNT).toContain('ekoa-assistant-launcher'); // the launcher it renders
     expect(MOUNT).toContain('/__ekoa/panel-runtime.js'); // the asset it lazy-loads
     expect(MOUNT).toContain('__ekoaAssistantAutoOpen'); // open-intent handoff to the asset
   });
 
   it('the panel-runtime entry self-mounts into #ekoa-assistant-root, once, waiting for the node', () => {
     // The three mount guards moved from the old in-bundle mount.js to the ASSET entry:
     // #ekoa-assistant-root is rendered BY App and createRoot().render() commits async,
     // so the node is absent the instant the asset runs. The entry polls (bounded) then
     // gives up quietly (standalone preview), and mounts exactly once per document.
     expect(ENTRY).toContain('ekoa-assistant-root');
     expect(ENTRY).toContain('getElementById');
     expect(ENTRY).toContain('__ekoaAssistantMounted'); // once-guard flag
     expect(ENTRY).toMatch(/createRoot\(node\)\.render/);
     expect(ENTRY).toContain('requestAnimationFrame');
     expect(ENTRY).toContain('MAX_FRAMES');
     expect(ENTRY).toMatch(/frames\s*>=\s*MAX_FRAMES/); // bounded give-up (no infinite spin)
   });
 
   it('index.jsx mounts the panel after rendering App (without changing the App render)', () => {
     expect(INDEX).toContain('mountAssistant');
     expect(INDEX).toContain("from './lib/assistant/mount'");
     expect(INDEX).toContain('root.render(<App />)'); // the App render is untouched
     // the mount call comes after the App render
     expect(INDEX.indexOf('mountAssistant()')).toBeGreaterThan(INDEX.indexOf('root.render(<App />)'));
   });
 });
 
 describe('D2 base skill', () => {
   it('teaches that the panel is platform-shipped, not to be rebuilt, and to declare ui_actions', () => {
     expect(SKILL).toContain('platform');
     expect(SKILL).toContain('ui_actions');
     expect(SKILL).toContain('declaring-ui-actions.md'); // cross-reference
     expect(SKILL.match(/\p{Extended_Pictographic}/u)).toBeNull();
   });
 });
diff --git a/api/tests/apps/edit-mode.test.ts b/api/tests/apps/edit-mode.test.ts
index 120a878..1fc9cd9 100644
--- a/api/tests/apps/edit-mode.test.ts
+++ b/api/tests/apps/edit-mode.test.ts
@@ -1,276 +1,421 @@
 import { describe, it, expect, beforeAll } from 'vitest';
 import { readFileSync } from 'node:fs';
 import { fileURLToPath } from 'node:url';
 
 /**
  * H3 edit mode (admins only) - BEHAVIOURAL unit tests of the panel's edit-flow controller
  * (api/assets/panel-runtime/src/edit-mode.js). That controller is a browser ASSET compiled by
  * esbuild (outside the tsc program), so it is imported at RUNTIME via its file URL and driven with
  * a FAKE fetch - proving the real network flow, not just its source text:
  *   - the confirmed patch run POSTs /api/v1/jobs { kind:'build', artifactId, description } with the
  *     admin platform Bearer (a follow-up build over the H1-gated machinery - reused, not rebuilt);
  *   - the pre-run head is captured BEFORE the run (the rollback target / diff point);
  *   - rollback POSTs /api/v1/artifacts/:id/versions/:sha/restore (one click, the pre-run head);
  *   - a mid-flow 401/403/404 resolves to a calm PT-PT message (graceful degradation, never a throw);
  *   - the job SSE is parsed frame-by-frame (even split across chunk boundaries) into progress.
  * The heavy end-to-end (a REAL patch run editing a real app + rollback) is the lead's live probe;
  * here the flow is unit-proven. Every call targets the PLATFORM /api/v1/* plane with the admin
  * Bearer - a SEPARATE plane from the visitor-blind POST /api/app-assistant.
  */
 
 // The controller is plain JS (a compiled-by-esbuild browser asset), so tsc cannot resolve it as a
 // typed module; import it at runtime by URL and describe only the shape these tests exercise.
 type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown };
 type FetchImpl = (url: string, init?: FetchInit) => Promise<unknown>;
 interface JobEvent { type: string; [k: string]: unknown }
+type Sleep = (ms: number) => Promise<void>;
 interface EditModeApi {
   JOBS_ENDPOINT: string;
   versionsEndpoint(appId: string): string;
   restoreEndpoint(appId: string, sha: string): string;
   jobEventsUrl(jobId: string, token: string): string;
+  jobEndpoint(jobId: string): string;
   degradeMessage(status: number): string;
   parseSseBuffer(buffer: string): { events: JobEvent[]; rest: string };
   newEditSessionId(appId: string): string;
   EDIT_COPY: Record<string, string>;
   progressLine(ev: unknown): string | null;
   startEditJob(a: { fetchImpl: FetchImpl; appId: string; token: string; description: string; sessionId?: string }): Promise<{ ok: boolean; status?: number | string; jobId?: string; reason?: string }>;
   readVersions(a: { fetchImpl: FetchImpl; appId: string; token: string }): Promise<{ ok: boolean; status?: number; items?: unknown[]; head?: string }>;
   rollbackToVersion(a: { fetchImpl: FetchImpl; appId: string; token: string; sha: string }): Promise<{ ok: boolean; status?: number; newHeadSha?: string }>;
+  guardedRollback(a: { fetchImpl: FetchImpl; appId: string; token: string; preRunSha?: string; expectedHeadSha?: string }): Promise<{ ok: boolean; status?: number; newHeadSha?: string; reason?: string }>;
   streamJobEvents(a: { fetchImpl: FetchImpl; jobId: string; token: string; onEvent?: (ev: JobEvent) => void; signal?: unknown }): Promise<{ outcome: string; status?: number; event?: JobEvent }>;
-  runEditPatch(a: { fetchImpl: FetchImpl; appId: string; token: string; description: string; onProgress?: (ev: JobEvent) => void; signal?: unknown }): Promise<{ outcome: string; status?: number; preRunSha?: string; newHeadSha?: string; reason?: string; event?: JobEvent }>;
+  pollJobUntilTerminal(a: { fetchImpl: FetchImpl; jobId: string; token: string; pollMs?: number; deadlineMs?: number; maxTransients?: number; now?: () => number; sleep?: Sleep; signal?: unknown }): Promise<{ outcome: string; status?: number | string; job?: unknown }>;
+  runEditPatch(a: { fetchImpl: FetchImpl; appId: string; token: string; description: string; onProgress?: (ev: JobEvent) => void; signal?: unknown; pollMs?: number; deadlineMs?: number; now?: () => number; sleep?: Sleep }): Promise<{ outcome: string; status?: number; preRunSha?: string; newHeadSha?: string; reason?: string; job?: unknown }>;
 }
 
+/** A no-op sleep so the poll loop never waits on a real timer in tests. */
+const noSleep: Sleep = async () => {};
+
 const MODULE_URL = new URL('../../assets/panel-runtime/src/edit-mode.js', import.meta.url);
 const MODULE_SRC = readFileSync(fileURLToPath(MODULE_URL), 'utf-8');
 
 let em: EditModeApi;
 beforeAll(async () => {
   em = (await import(/* @vite-ignore */ MODULE_URL.href)) as unknown as EditModeApi;
 });
 
 // --- fake-fetch harness ----------------------------------------------------------------------
 interface Recorded { url: string; method: string; headers: Record<string, string>; body?: string }
 const enc = new TextEncoder();
 
 /** A minimal streaming body (getReader) that yields the given SSE frames as UTF-8 chunks. */
 function sseBody(frames: string[]) {
   let i = 0;
   return {
     getReader() {
       return {
         read: async () => (i < frames.length ? { value: enc.encode(frames[i++]), done: false } : { value: undefined, done: true }),
         cancel: async () => {},
       };
     },
   };
 }
 function jsonRes(status: number, data: unknown) {
   return { ok: status >= 200 && status < 300, status, json: async () => data };
 }
 
 /**
  * A scenario fetch: records every call and answers per-endpoint. `versionsHeads` supplies the head
  * sha for successive /versions reads (runEditPatch reads twice: pre-run then post-run).
  */
 function scenario(opts: {
   versionsHeads?: string[];
+  versionsItems?: Array<Array<{ sha: string }>>;
   versionsStatus?: number;
   jobs?: { status: number; data?: unknown };
+  jobStatus?: string[]; // successive GET /jobs/:id statuses (M1 poll); default 'completed'
   restore?: { status: number; data?: unknown };
   sseFrames?: string[];
   sseStatus?: number;
 }) {
   const calls: Recorded[] = [];
   let versionsIdx = 0;
+  let jobPollIdx = 0;
   const fetchImpl: FetchImpl = async (url, init = {}) => {
     calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
     if (url === em.JOBS_ENDPOINT) {
       const j = opts.jobs || { status: 202, data: { status: 'created', job: { id: 'job-1', status: 'running' } } };
       return jsonRes(j.status, j.data ?? {});
     }
+    if (url.includes('/jobs/') && url.includes('/events')) {
+      if (opts.sseStatus) return jsonRes(opts.sseStatus, {});
+      return { ok: true, status: 200, body: sseBody(opts.sseFrames || ['data: {"type":"complete","durationMs":10}\n\n']) };
+    }
+    if (url.startsWith('/api/v1/jobs/')) {
+      // GET /jobs/:id status poll (M1): the AUTHORITATIVE terminal signal. Successive statuses.
+      const seq = opts.jobStatus || ['completed'];
+      const s = seq[Math.min(jobPollIdx, seq.length - 1)];
+      jobPollIdx += 1;
+      return jsonRes(200, {
+        id: 'job-1',
+        status: s,
+        ...(s === 'completed' ? { artifactId: 'app' } : {}),
+        ...(s === 'failed' ? { error: { code: 'BUILD_FAILED', message: 'boom' } } : {}),
+      });
+    }
     if (url.includes('/versions/') && url.endsWith('/restore')) {
       const r = opts.restore || { status: 200, data: { newHeadSha: 'restored-head' } };
       return jsonRes(r.status, r.data ?? {});
     }
     if (url.endsWith('/versions')) {
       if (opts.versionsStatus) return jsonRes(opts.versionsStatus, {});
+      if (opts.versionsItems) {
+        const items = opts.versionsItems[Math.min(versionsIdx, opts.versionsItems.length - 1)];
+        versionsIdx += 1;
+        return jsonRes(200, { items });
+      }
       const heads = opts.versionsHeads || ['head-a', 'head-b'];
       const head = heads[Math.min(versionsIdx, heads.length - 1)];
       versionsIdx += 1;
       return jsonRes(200, { items: [{ sha: head }, { sha: 'older-1' }] });
     }
-    if (url.includes('/jobs/') && url.includes('/events')) {
-      if (opts.sseStatus) return jsonRes(opts.sseStatus, {});
-      return { ok: true, status: 200, body: sseBody(opts.sseFrames || ['data: {"type":"complete","durationMs":10}\n\n']) };
-    }
     return jsonRes(404, {});
   };
   return { fetchImpl, calls };
 }
 
+const jobPolls = (calls: Recorded[]) => calls.filter((c) => c.url.startsWith('/api/v1/jobs/') && !c.url.includes('/events'));
+const versionReads = (calls: Recorded[]) => calls.filter((c) => c.url.endsWith('/versions'));
+
 describe('H3 edit-mode controller - endpoints + copy (the admin /api/v1/* plane)', () => {
   it('builds the platform version + restore + job-event paths (encoded)', () => {
     expect(em.JOBS_ENDPOINT).toBe('/api/v1/jobs');
     expect(em.versionsEndpoint('app 1')).toBe('/api/v1/artifacts/app%201/versions');
     expect(em.restoreEndpoint('app1', 'sha/x')).toBe('/api/v1/artifacts/app1/versions/sha%2Fx/restore');
     expect(em.jobEventsUrl('job1', 't ok')).toBe('/api/v1/jobs/job1/events?token=t%20ok');
+    expect(em.jobEndpoint('job 1')).toBe('/api/v1/jobs/job%201'); // the M1 status-poll target
   });
 
   it('degradeMessage maps 401/403/404 to distinct calm PT-PT lines (no emoji, no em/en-dash)', () => {
     const m401 = em.degradeMessage(401);
     const m403 = em.degradeMessage(403);
     const m404 = em.degradeMessage(404);
     const mOther = em.degradeMessage(500);
     for (const m of [m401, m403, m404, mOther]) {
       expect(typeof m).toBe('string');
       expect(m.length).toBeGreaterThan(0);
       expect(m).not.toMatch(/[–—]/); // no en/em dash
       expect(m.match(/\p{Extended_Pictographic}/u)).toBeNull(); // no emoji
     }
     // 401 (expired session) and 403 (lost writability) read differently.
     expect(m401).not.toBe(m403);
     expect(m401).toMatch(/sess/i);
   });
 
   it('EDIT_COPY.confirm is the PT-PT confirmation step', () => {
     expect(em.EDIT_COPY.confirm).toContain('revisão');
     expect(em.EDIT_COPY.confirm).toContain('Confirma');
   });
 
   it('the controller source carries no emoji (UI-code rule)', () => {
     expect(MODULE_SRC.match(/\p{Extended_Pictographic}/u)).toBeNull();
   });
 });
 
 describe('H3 startEditJob - the follow-up build (POST /jobs, H1-gated)', () => {
   it('POSTs /api/v1/jobs { kind:build, artifactId, description } with the admin Bearer', async () => {
     const { fetchImpl, calls } = scenario({});
     const r = await em.startEditJob({ fetchImpl, appId: 'app-42', token: 'TKN', description: 'adicione um botão' });
     expect(r).toEqual({ ok: true, status: 'created', jobId: 'job-1' });
     const post = calls.find((c) => c.url === '/api/v1/jobs');
     expect(post).toBeTruthy();
     expect(post!.method).toBe('POST');
     expect(post!.headers.Authorization).toBe('Bearer TKN'); // the platform admin JWT
     const body = JSON.parse(post!.body || '{}');
     expect(body.kind).toBe('build'); // a build job (a follow-up edits an existing app)
     expect(body.artifactId).toBe('app-42'); // targets THIS app (server re-gates writability)
     expect(body.description).toBe('adicione um botão');
     expect(body.language).toBe('pt');
     expect(typeof body.sessionId).toBe('string'); // a correlation tag (follow-ups reserve nothing)
     expect(body.sessionId.length).toBeGreaterThan(0);
   });
 
   it('honours the SERVER gate: a 403/404 refusal returns ok:false + the status (front-end degrades)', async () => {
     const forbidden = scenario({ jobs: { status: 403, data: { error: { code: 'FORBIDDEN' } } } });
     expect(await em.startEditJob({ fetchImpl: forbidden.fetchImpl, appId: 'a', token: 'T', description: 'x' })).toEqual({ ok: false, status: 403 });
     const missing = scenario({ jobs: { status: 404, data: {} } });
     expect(await em.startEditJob({ fetchImpl: missing.fetchImpl, appId: 'a', token: 'T', description: 'x' })).toEqual({ ok: false, status: 404 });
   });
 
   it('surfaces an in-build classifier answer (no job created) as status:answered', async () => {
     const { fetchImpl } = scenario({ jobs: { status: 200, data: { status: 'answered', reason: 'question' } } });
     const r = await em.startEditJob({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
     expect(r).toEqual({ ok: true, status: 'answered', reason: 'question' });
   });
 });
 
 describe('H3 runEditPatch - the confirmed patch flow', () => {
   it('captures the pre-run head BEFORE the build, streams progress, and returns the new head for preview', async () => {
     const { fetchImpl, calls } = scenario({
       versionsHeads: ['before-sha', 'after-sha'],
       sseFrames: [
         'data: {"type":"ready","jobId":"job-1"}\n\n',
         'data: {"type":"plan_step","status":"running","description":"A editar a tabela de honorários"}\n\n',
         'data: {"type":"complete","durationMs":1200}\n\n',
       ],
     });
     const progress: string[] = [];
     const r = await em.runEditPatch({
       fetchImpl,
       appId: 'app-42',
       token: 'TKN',
       description: 'adicione um botão de exportação',
+      sleep: noSleep,
       onProgress: (ev) => {
         const line = em.progressLine(ev);
         if (line) progress.push(line);
       },
     });
     expect(r.outcome).toBe('ready');
     expect(r.preRunSha).toBe('before-sha'); // the rollback target / diff point
     expect(r.newHeadSha).toBe('after-sha');
     expect(progress).toContain('A editar a tabela de honorários'); // plan_step narration surfaced
+    // The JOB record was polled to a terminal status before the preview (M1): the new head reflects
+    // the CONFIRMED completed build, not a mid-build snapshot.
+    expect(jobPolls(calls).length).toBeGreaterThanOrEqual(1);
 
     // ORDER matters: the pre-run version read must happen BEFORE the POST /jobs, so the rollback
     // target is the head as it was before the patch.
     const firstVersions = calls.findIndex((c) => c.url.endsWith('/versions'));
     const jobsPost = calls.findIndex((c) => c.url === '/api/v1/jobs');
     expect(firstVersions).toBeGreaterThanOrEqual(0);
     expect(jobsPost).toBeGreaterThan(firstVersions);
   });
 
   it('a mid-flow 401 (expired session) on POST /jobs degrades calmly, never throws', async () => {
     const { fetchImpl } = scenario({ jobs: { status: 401, data: {} } });
     const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
     expect(r).toEqual({ outcome: 'degraded', status: 401 });
     // the panel maps this straight to a calm PT-PT line
     expect(em.degradeMessage(r.status!)).toMatch(/sess/i);
   });
 
   it('a 403 on the pre-run versions read (lost writability) degrades calmly', async () => {
     const { fetchImpl, calls } = scenario({ versionsStatus: 403 });
     const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
     expect(r).toEqual({ outcome: 'degraded', status: 403 });
     // it never reached the build: no POST /jobs was issued.
     expect(calls.some((c) => c.url === '/api/v1/jobs')).toBe(false);
   });
 
-  it('a build error event resolves to outcome:failed', async () => {
+  it('a job that reaches terminal FAILED status resolves to outcome:failed', async () => {
+    // M1: failure is AUTHORITATIVE from the job record, not the SSE. Even with an error frame on the
+    // stream, the terminal decision is the polled job status.
     const { fetchImpl } = scenario({
-      versionsHeads: ['before', 'before'],
+      jobStatus: ['failed'],
       sseFrames: ['data: {"type":"error","code":"BUILD_FAILED","message":"boom"}\n\n'],
     });
-    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
+    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x', sleep: noSleep });
     expect(r.outcome).toBe('failed');
   });
 
   it('an answered follow-up (no job) resolves to outcome:answered', async () => {
     const { fetchImpl } = scenario({ jobs: { status: 200, data: { status: 'answered', reason: 'question' } } });
-    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
+    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x', sleep: noSleep });
     expect(r.outcome).toBe('answered');
   });
+
+  // ---- M1: an SSE early-close must NOT read as "done"; the job status is the arbiter ------------
+  it('M1: an SSE that closes WITHOUT a terminal event polls the job to completion (no false no-change)', async () => {
+    // The stream carries progress but NO complete/error frame (a proxy/network blip). The build then
+    // finishes (poll running -> completed) and activates a NEW head. runEditPatch must poll the job
+    // record and only preview the CONFIRMED completed build - never treat the early close as done and
+    // report the unchanged pre-run head as "no change".
+    const { fetchImpl, calls } = scenario({
+      sseFrames: ['data: {"type":"plan_step","status":"go","description":"a editar a tabela"}\n\n'], // no terminal
+      jobStatus: ['running', 'completed'],
+      versionsHeads: ['before', 'after'],
+    });
+    const progress: string[] = [];
+    const r = await em.runEditPatch({
+      fetchImpl,
+      appId: 'app-42',
+      token: 'TKN',
+      description: 'x',
+      sleep: noSleep,
+      onProgress: (ev) => {
+        const line = em.progressLine(ev);
+        if (line) progress.push(line);
+      },
+    });
+    expect(r.outcome).toBe('ready');
+    expect(r.newHeadSha).toBe('after'); // reflects the build that completed AFTER the blip
+    expect(r.preRunSha).toBe('before');
+    expect(jobPolls(calls).length).toBe(2); // polled running, then completed
+    expect(progress).toContain('a editar a tabela'); // progress still surfaced off the (dropped) stream
+    // the post-run head read happened AFTER the job was confirmed completed
+    const lastVersions = calls.map((c) => c.url).lastIndexOf('/api/v1/artifacts/app-42/versions');
+    const lastJobPoll = calls.reduce((acc, c, i) => (c.url.startsWith('/api/v1/jobs/') && !c.url.includes('/events') ? i : acc), -1);
+    expect(lastVersions).toBeGreaterThan(lastJobPoll);
+  });
+
+  it('M1: a build still running at the poll deadline returns pending (never a false ready/no-change)', async () => {
+    const { fetchImpl, calls } = scenario({ jobStatus: ['running'], versionsHeads: ['before', 'before'] });
+    let t = 1000;
+    const now = () => t;
+    const sleep: Sleep = async () => {
+      t += 1000; // each poll interval advances the clock so the bounded deadline is reached
+    };
+    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x', now, sleep, deadlineMs: 50 });
+    expect(r.outcome).toBe('pending');
+    // it did NOT read a post-run head (no false preview): only the pre-run versions read happened.
+    expect(versionReads(calls).length).toBe(1);
+  });
+});
+
+describe('H3 pollJobUntilTerminal - transient-tolerant job-status poll (M1)', () => {
+  it('tolerates a transient 502 / non-JSON blip, then returns the completed terminal status', async () => {
+    let n = 0;
+    const fetchImpl: FetchImpl = async () => {
+      n += 1;
+      if (n === 1) return { ok: false, status: 502, json: async () => { throw new Error('proxy error (text/plain)'); } };
+      return jsonRes(200, { id: 'job-1', status: 'completed', artifactId: 'app' });
+    };
+    const r = await em.pollJobUntilTerminal({ fetchImpl, jobId: 'job-1', token: 'T', sleep: noSleep });
+    expect(r.outcome).toBe('terminal');
+    expect(r.status).toBe('completed');
+  });
+
+  it('degrades on a deterministic 401 (no endless retry masking an auth failure)', async () => {
+    const fetchImpl: FetchImpl = async () => jsonRes(401, { error: { code: 'UNAUTHENTICATED' } });
+    const r = await em.pollJobUntilTerminal({ fetchImpl, jobId: 'job-1', token: 'T', sleep: noSleep });
+    expect(r).toMatchObject({ outcome: 'degraded', status: 401 });
+  });
+
+  it('treats a cancelled job as a terminal failure', async () => {
+    const fetchImpl: FetchImpl = async () => jsonRes(200, { id: 'job-1', status: 'cancelled' });
+    const r = await em.pollJobUntilTerminal({ fetchImpl, jobId: 'job-1', token: 'T', sleep: noSleep });
+    expect(r).toMatchObject({ outcome: 'terminal', status: 'failed' });
+  });
 });
 
 describe('H3 rollbackToVersion - one-click restore to the pre-run head', () => {
   it('POSTs /api/v1/artifacts/:id/versions/:sha/restore with the admin Bearer', async () => {
     const { fetchImpl, calls } = scenario({});
     const r = await em.rollbackToVersion({ fetchImpl, appId: 'app-42', token: 'TKN', sha: 'before-sha' });
     expect(r).toEqual({ ok: true, newHeadSha: 'restored-head' });
     const post = calls.find((c) => c.url.endsWith('/restore'));
     expect(post).toBeTruthy();
     expect(post!.url).toBe('/api/v1/artifacts/app-42/versions/before-sha/restore');
     expect(post!.method).toBe('POST');
     expect(post!.headers.Authorization).toBe('Bearer TKN');
   });
 
   it('a 404 on restore degrades calmly (ok:false + status)', async () => {
     const { fetchImpl } = scenario({ restore: { status: 404, data: {} } });
     const r = await em.rollbackToVersion({ fetchImpl, appId: 'a', token: 'T', sha: 's' });
     expect(r).toEqual({ ok: false, status: 404 });
   });
 });
 
+describe('H3 guardedRollback - refuse a stale rollback (M2)', () => {
+  it('restores to the pre-run head ONLY when HEAD is still the head THIS edit produced', async () => {
+    // Current HEAD (items[0].sha) is still 'after' (the edit head), and the pre-run target 'before'
+    // is still in history -> the guarded rollback fires restore to 'before'.
+    const { fetchImpl, calls } = scenario({ versionsItems: [[{ sha: 'after' }, { sha: 'before' }, { sha: 'older' }]] });
+    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
+    expect(r).toEqual({ ok: true, newHeadSha: 'restored-head' });
+    const restore = calls.find((c) => c.url.endsWith('/restore'));
+    expect(restore!.url).toBe('/api/v1/artifacts/app-42/versions/before/restore');
+    expect(restore!.headers.Authorization).toBe('Bearer TKN');
+  });
+
+  it('REFUSES (no restore fired) when HEAD advanced - a concurrent change would be wiped', async () => {
+    // Someone else moved HEAD to 'someone-else' between preview and the Reverter click. Restoring to
+    // 'before' would silently wipe that change, so the guard refuses.
+    const { fetchImpl, calls } = scenario({ versionsItems: [[{ sha: 'someone-else' }, { sha: 'after' }, { sha: 'before' }]] });
+    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
+    expect(r).toEqual({ ok: false, reason: 'head-advanced' });
+    expect(calls.some((c) => c.url.endsWith('/restore'))).toBe(false); // NO blind restore
+  });
+
+  it('REFUSES (no restore fired) when the pre-run target sha is gone from history', async () => {
+    const { fetchImpl, calls } = scenario({ versionsItems: [[{ sha: 'after' }, { sha: 'older' }]] });
+    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
+    expect(r).toEqual({ ok: false, reason: 'target-missing' });
+    expect(calls.some((c) => c.url.endsWith('/restore'))).toBe(false);
+  });
+
+  it('degrades (ok:false + status) when the versions re-read itself is refused', async () => {
+    const { fetchImpl } = scenario({ versionsStatus: 403 });
+    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
+    expect(r).toEqual({ ok: false, status: 403 });
+  });
+});
+
 describe('H3 parseSseBuffer - job SSE frame parsing', () => {
   it('parses complete frames, ignores non-data lines, and buffers a partial trailing frame', () => {
     const buf = ': keep-alive\n\nid: 1\ndata: {"type":"ready","jobId":"j"}\n\ndata: {"type":"plan_step","status":"go"}\n\ndata: {"type":"comp';
     const { events, rest } = em.parseSseBuffer(buf);
     expect(events.map((e) => e.type)).toEqual(['ready', 'plan_step']);
     expect(rest).toContain('"type":"comp'); // the incomplete frame stays buffered
   });
 
   it('reassembles a frame split across two chunk reads', () => {
     const a = em.parseSseBuffer('data: {"type":"plan_');
     expect(a.events).toEqual([]);
     const b = em.parseSseBuffer(a.rest + 'step","status":"x"}\n\n');
     expect(b.events).toEqual([{ type: 'plan_step', status: 'x' }]);
   });
 });

exec
/bin/zsh -lc 'codegraph explore "runEditPatch guardedRollback poll job status preview versions rollback edit mode"' in /Users/ggomes/dev/ekoa-code
 succeeded in 416ms:
## Exploration: runEditPatch guardedRollback poll job status preview versions rollback edit mode

Found 202 symbols across 74 files.

### Blast radius — what depends on these (update/verify before editing)

- `JobStatus` (api/src/agents/jobs.ts:14) — 1 caller in `api/src/agents/jobs.ts`; ⚠️ no covering tests found
- `guardedRollback` (api/assets/panel-runtime/src/edit-mode.js:235) — 2 callers in `api/assets/panel-runtime/src/AssistantPanel.jsx`; ⚠️ no covering tests found
- `guardMode` (api/src/services/commit-guard.ts:174) — 2 callers in `api/src/services/commit-guard.ts`; ⚠️ no covering tests found
- `runEditPatch` (api/assets/panel-runtime/src/edit-mode.js:376) — 2 callers in `api/assets/panel-runtime/src/AssistantPanel.jsx`; ⚠️ no covering tests found
- `GoalEditorProps` (web/components/automations/goal-editor.tsx:6) — 1 caller in `web/components/automations/goal-editor.tsx`; ⚠️ no covering tests found

### Relationships

**references:**
- JobRecord → JobStatus
- JobRecord → JobKind
- persistJob → JobRecord
- patchJob → JobRecord
- getJob → JobRecord
- jobView → JobRecord
- nonTerminalJobForArtifact → JobRecord
- handleFirstBuild → JobRecord
- handleFollowUp → JobRecord
- guardMode → SecretGuardMode
- ... and 20 more

**calls:**
- guardedRollback → readVersions
- guardedRollback → rollbackToVersion
- AssistantPanel → guardedRollback
- readVersions → versionsEndpoint
- runEditPatch → readVersions
- assertNoStagedSecrets → guardMode
- commitSnapshot → guardMode
- assertNoStagedSecrets → scanStagedFiles
- commitSnapshot → validateProjectDir
- commitSnapshot → withRepoLock
- ... and 226 more

**instantiates:**
- assertNoStagedSecrets → SecretCommitError

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/assets/panel-runtime/src/edit-mode.js — sleep(calls), readVersions(calls), versionsEndpoint(function), restoreEndpoint(function), jobEventsUrl(function), jobEndpoint(function), pollJobUntilTerminal(function), safeJson(calls), jobEndpoint(calls), runEditPatch(function), +5 more

```javascript
33	export const JOBS_ENDPOINT = '/api/v1/jobs';
34	
35	/** GET the artifact's version list (commits, newest first). */
36	export function versionsEndpoint(appId) {
37	  return `/api/v1/artifacts/${encodeURIComponent(appId)}/versions`;
38	}
39	
40	/** POST to forward-restore the artifact to `sha` (one-click rollback). */
41	export function restoreEndpoint(appId, sha) {
42	  return `/api/v1/artifacts/${encodeURIComponent(appId)}/versions/${encodeURIComponent(sha)}/restore`;
43	}
44	
45	/** The job SSE stream. EventSource cannot set headers (CONV-1), so the job stream
46	 *  authenticates via ?token= (verifySseToken, the same chain requireAuth runs); we read
47	 *  it with fetch (the panel's one transport) rather than EventSource so it stays
48	 *  abortable and unit-testable. */
49	export function jobEventsUrl(jobId, token) {
50	  return `/api/v1/jobs/${encodeURIComponent(jobId)}/events?token=${encodeURIComponent(token)}`;
51	}
52	
53	/** GET the persisted job record (its terminal status is the AUTHORITATIVE "did the build finish?"
54	 *  signal - not the SSE, which a proxy/network blip can close early). auth:'user' (admin Bearer). */
55	export function jobEndpoint(jobId) {
56	  return `/api/v1/jobs/${encodeURIComponent(jobId)}`;
57	}
58	
59	/** Job record terminal statuses (mirrors api/src/agents/jobs.ts isTerminal / patchJob writes):
60	 *  'completed' is success; 'failed' and 'cancelled' are failure; 'created'/'running' are in-flight. */

... (gap) ...

322	 *   - { outcome:'pending' }          - the deadline passed with no terminal status
323	 * `now`/`sleep` are injectable so the flow is testable without real timers.
324	 */
325	export async function pollJobUntilTerminal({
326	  fetchImpl,
327	  jobId,
328	  token,
329	  pollMs = 3000,
330	  deadlineMs = 20 * 60 * 1000,
331	  maxTransients = 30,
332	  now = () => Date.now(),
333	  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
334	  signal,
335	}) {
336	  const init = { method: 'GET', headers: { Authorization: `Bearer ${token}` }, ...(signal ? { signal } : {}) };
337	  const deadline = now() + deadlineMs;
338	  let transients = 0;
339	  for (;;) {
340	    if (now() > deadline) return { outcome: 'pending' };
341	    const res = await safeJson(fetchImpl, jobEndpoint(jobId), init);
342	    if (!res.ok) {
343	      // A deterministic 4xx (auth/route/store) will not self-heal; retrying only masks it -> degrade.
344	      if (res.status >= 400 && res.status < 500) return { outcome: 'degraded', status: res.status };
345	      // 5xx / non-JSON / network (proxy-502 blips) are transient -> tolerate a bounded number.
346	      transients += 1;
347	      if (transients > maxTransients) return { outcome: 'degraded', status: res.status || 0 };
348	      await sleep(pollMs);
349	      continue;
350	    }
351	    transients = 0;
352	    const status = res.json && typeof res.json.status === 'string' ? res.json.status : undefined;
353	    if (status === TERMINAL_SUCCESS) return { outcome: 'terminal', status: 'completed', job: res.json };
354	    if (status && TERMINAL_FAILURE.has(status)) return { outcome: 'terminal', status: 'failed', job: res.json };
355	    await sleep(pollMs);
356	  }
357	}
358	
359	/**
360	 * Run the whole confirmed patch, front-to-back, as a sequence of the H1-gated platform calls.

... (gap) ...

373	 * moments later and deploys a real edit. So after the stream ends (or drops), the JOB RECORD is
374	 * polled to a terminal status, and only a CONFIRMED 'completed' reads the new head for the preview.
375	 */
376	export async function runEditPatch({
377	  fetchImpl,
378	  appId,
379	  token,
380	  description,
381	  onProgress,
382	  signal,
383	  pollMs,
384	  deadlineMs,
385	  maxTransients,
386	  now,
387	  sleep,
388	}) {
389	  // 1. Capture the pre-run head BEFORE the build - the rollback target and diff point.
390	  const before = await readVersions({ fetchImpl, appId, token });
391	  if (!before.ok) return { outcome: 'degraded', status: before.status };
392	  const preRunSha = before.head;
393	
394	  // 2. Start the follow-up build (the H1-gated patch run).
395	  const started = await startEditJob({
396	    fetchImpl,
397	    appId,
398	    token,
399	    description,
400	    sessionId: newEditSessionId(appId),
401	  });
402	  if (!started.ok) return { outcome: 'degraded', status: started.status };
403	  if (started.status === 'answered') return { outcome: 'answered', reason: started.reason };
404	
405	  // 3. Stream the job SSE for LIVE progress only (best-effort). A dropped stream is NOT terminal.
406	  await streamJobEvents({
407	    fetchImpl,
408	    jobId: started.jobId,
409	    token,
410	    signal,
411	    onEvent: (ev) => {
412	      if (onProgress) onProgress(ev);
413	    },
414	  });
415	
416	  // 4. AUTHORITATIVELY confirm the build finished by polling the job record (transient-tolerant).
417	  const poll = await pollJobUntilTerminal({ fetchImpl, jobId: started.jobId, token, pollMs, deadlineMs, maxTransients, now, sleep, signal });
418	  if (poll.outcome === 'degraded') return { outcome: 'degraded', status: poll.status };
419	  if (poll.outcome === 'pending') return { outcome: 'pending' };
420	  if (poll.status === 'failed') return { outcome: 'failed', job: poll.job };
421	
422	  // 5. Job CONFIRMED completed -> the versions read now reflects the FINISHED build (never a
423	  //    mid-build snapshot). An unchanged head here is a true "no change".
424	  const after = await readVersions({ fetchImpl, appId, token });
425	  if (!after.ok) return { outcome: 'degraded', status: after.status };
426	  return { outcome: 'ready', preRunSha, newHeadSha: after.head, jobId: started.jobId };
427	}
428	
429	/** A one-line PT-PT narration for a streamed JobEvent (plan_step primarily). Returns null
430	 *  for events with nothing worth showing, so the panel keeps the last meaningful line. */
431	export function progressLine(ev) {
432	  if (!ev || typeof ev !== 'object') return null;
433	  if (ev.type === 'plan_step') {
434	    const text = ev.description || ev.detail || ev.status;
435	    return typeof text === 'string' && text ? text : null;
436	  }
437	  if (ev.type === 'routing') return 'A preparar a alteração...';
438	  return null;
439	}
440	
```

#### api/src/apps/backups.ts — status(method)

```typescript
1	/**
2	 * App-data backups (ch03 §3.8.10, ch07 §7.10 safety-nets) - the Cortex side of
3	 * the user-facing "Dados e cópias de segurança" panel. Ported from the old
4	 * services/app-data-backups.ts, re-homed on the ekoa-code app-data plane
5	 * (AppDataAccess over CollectionsEngine) instead of the old fs/mongo backend.
6	 *
7	 * Layered recovery: local snapshots (safety-net + manual) are the restore points
8	 * we own; every restore is itself undoable (a safety-net snapshot is taken BEFORE
9	 * touching live data). Snapshots live under
10	 * `{dataDir}/app-data-snapshots/{appId}/<iso>__<kind>.json` - runtime data, never
11	 * versioned, never co-located with the artifact source.
12	 *
13	 * DEVIATION (logged for G7): the old service also offered Firestore PITR
14	 * (point-in-time) restore points, feature-detected via `EKOA_APP_DATA_PITR`. The
15	 * ekoa-code data plane is the mongodb driver over Firestore-compat and the PITR
16	 * snapshot-session path is not carried in this slice; `previewAsOf` on a non-local
17	 * source degrades explicitly with `PITR_UNAVAILABLE`.
18	 */
19	import { homedir } from 'node:os';
20	import { join } from 'node:path';
21	import {
22	  readFileSync,
23	  writeFileSync,
24	  mkdirSync,
25	  existsSync,
26	  readdirSync,
27	  statSync,
28	} from 'node:fs';
29	import { AppDataAccess, type AppDataDeps, type AppDataDump } from './app-data-access.js';
30	
31	export type RestorePointSource = 'local' | 'pitr' | 'gcs';
32	
33	export interface RestorePoint {
34	  /** opaque handle: the snapshot filename for a local point. */
35	  pointId: string;
36	  at: string;
37	  kind: string;
38	  source: RestorePointSource;
39	  label: string;
40	  size?: number;
41	}
42	
43	export interface BackupStatus {
44	  enabled: boolean;
45	  lastSnapshotAt: string | null;
46	  restorePointCount: number;
47	  restorePoints: RestorePoint[];
48	  automatic: boolean;
49	}
50	
51	function dataRoot(): string {
52	  return process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
53	}
54	
55	export class AppDataBackups {
56	  private access: AppDataAccess;
57	  private snapshotRoot: string;
58	  private deps: AppDataDeps;
59	
60	  constructor(deps: AppDataDeps, opts?: { access?: AppDataAccess; snapshotDir?: string }) {
61	    this.deps = deps;
62	    this.access = opts?.access ?? new AppDataAccess(deps);
63	    this.snapshotRoot = opts?.snapshotDir ?? join(dataRoot(), 'app-data-snapshots');
64	  }
65	
66	  private appDir(appId: string): string {
67	    return join(this.snapshotRoot, appId);
68	  }
69	
70	  /** Read every collection for an app into one dump (download + snapshot source). */
71	  exportAll(appId: string): Promise<AppDataDump> {
72	    return this.access.exportAll(appId);
73	  }
74	
75	  /** Snapshot current state to a local restore point. */
76	  async saveSnapshot(appId: string, kind: 'safety-net' | 'manual' | 'nightly' | 'auto' = 'manual'): Promise<RestorePoint> {
77	    const dump = await this.access.exportAll(appId);
78	    const dir = this.appDir(appId);
79	    mkdirSync(dir, { recursive: true });
80	    const pointId = `${dump.at.replace(/[:.]/g, '-')}__${kind}.json`;
81	    const body = JSON.stringify(dump, null, 2);
82	    writeFileSync(join(dir, pointId), body, 'utf-8');
83	    return { pointId, at: dump.at, kind, source: 'local', label: relativePtLabel(dump.at), size: Buffer.byteLength(body) };
84	  }
85	
86	  /** All local restore points, newest first. */
87	  listRestorePoints(appId: string, now = new Date(this.deps.now())): RestorePoint[] {
88	    const dir = this.appDir(appId);
89	    const points: RestorePoint[] = [];
90	    if (existsSync(dir)) {
91	      for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
92	        const at = parseSnapshotIso(f) ?? new Date(statSync(join(dir, f)).mtimeMs).toISOString();
93	        const kind = f.includes('__') ? (f.split('__')[1] as string).replace(/\.json$/, '') : 'auto';
94	        points.push({ pointId: f, at, kind, source: 'local', label: relativePtLabel(at, now) });
95	      }
96	    }
97	    return points.sort((a, b) => (a.at < b.at ? 1 : -1));
98	  }
99	
100	  status(appId: string, now = new Date(this.deps.now())): BackupStatus {
101	    const restorePoints = this.listRestorePoints(appId, now);
102	    return {
103	      enabled: true,
104	      lastSnapshotAt: restorePoints.length ? (restorePoints[0] as RestorePoint).at : null,
105	      restorePointCount: restorePoints.length,
106	      restorePoints,
107	      automatic: false,
108	    };
109	  }
110	
111	  /** Read a local snapshot file. */
112	  readLocalSnapshot(appId: string, pointId: string): AppDataDump {
113	    const fp = join(this.appDir(appId), pointId);
114	    if (!existsSync(fp)) throw new Error(`Restore point not found: ${pointId}`);
115	    return JSON.parse(readFileSync(fp, 'utf-8')) as AppDataDump;
116	  }
117	
118	  /** Render an app's data as of a restore point, read-only (no effect on live state). */
119	  async previewAsOf(appId: string, point: { pointId: string; source: string; at: string }): Promise<AppDataDump> {
120	    if (point.source === 'local') return this.readLocalSnapshot(appId, point.pointId);
121	    // PITR not carried in this slice (see file header) - degrade explicitly.
122	    throw new Error('PITR_UNAVAILABLE: point-in-time restore is not available on this backend');
123	  }
124	
125	  /**
126	   * Restore the app to a point, with a safety net: snapshot current state first
127	   * (so the restore is itself undoable), then clear and re-import the point. On a
128	   * mid-flight failure the pre-restore state is rolled back. Never a one-way door.
129	   */
130	  async restoreTo(
131	    appId: string,
132	    point: { pointId: string; source: string; at: string },
133	  ): Promise<{ restored: number; cleared: number; safetyNetId: string }> {
134	    const safety = await this.saveSnapshot(appId, 'safety-net');
135	    const dump = await this.previewAsOf(appId, point);
136	    try {
137	      const cleared = await this.access.clearAll(appId);
138	      const restored = await this.access.importDump(appId, dump);
139	      return { restored, cleared, safetyNetId: safety.pointId };
140	    } catch (err) {
141	      // clear+import is not transactional; roll back to the captured pre-restore state.
142	      try {
143	        await this.access.clearAll(appId);
144	        await this.access.importDump(appId, this.readLocalSnapshot(appId, safety.pointId));
145	      } catch {
146	        /* rollback failed too - the safety-net file is retained for manual recovery */
147	      }
148	      const msg = err instanceof Error ? err.message : String(err);
149	      throw new Error(`Restore failed and was rolled back (safety net ${safety.pointId}): ${msg}`);
150	    }
151	  }
152	}
153	
154	// -- PT-PT relative labels (the comfort half of the UI) ----------------------
155	
156	export function relativePtLabel(atIso: string, now: Date = new Date()): string {
157	  const at = new Date(atIso);
158	  const hh = String(at.getHours()).padStart(2, '0');
159	  const mm = String(at.getMinutes()).padStart(2, '0');
160	  const time = `${hh}:${mm}`;
161	  const dayMs = 24 * 60 * 60 * 1000;
162	  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
163	  const days = Math.round((startOf(now) - startOf(at)) / dayMs);
164	  if (days <= 0) return `hoje, ${time}`;
165	  if (days === 1) return `ontem, ${time}`;
166	  if (days < 7) return `há ${days} dias`;
167	  if (days < 14) return 'semana passada';
168	  if (days < 31) return `há ${Math.floor(days / 7)} semanas`;
169	  return at.toLocaleDateString('pt-PT');
170	}
171	
172	function parseSnapshotIso(filename: string): string | null {
173	  // "2026-06-08T22-13-05-123Z__manual.json" -> ISO
174	  const stem = filename.split('__')[0] as string;
175	  const m = stem.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
176	  if (!m) return null;
177	  const [, y, mo, d, h, mi, s, ms] = m;
178	  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
179	}
```

#### web/components/automations/inline-edit.tsx — InlineEditProps(interface), InlineEdit(function)

```tsx
1	"use client";
2	
3	import { useEffect, useRef, useState } from 'react';
4	import { useTranslation } from '@/stores/i18n';
5	
6	interface InlineEditProps {
7	  value: string;
8	  onSave: (next: string) => void;
9	  placeholder?: string;
10	  multiline?: boolean;
11	  className?: string;
12	  /** Aria label for screen readers. */
13	  label?: string;
14	}
15	
16	/**
17	 * Click-to-edit text. No markdown, no syntax highlighting — automation
18	 * step descriptions are plain English. Single-line by default; opt-in
19	 * multiline switches to a textarea.
20	 */
21	export default function InlineEdit({
22	  value,
23	  onSave,
24	  placeholder,
25	  multiline = false,
26	  className = '',
27	  label,
28	}: InlineEditProps) {
29	  const [editing, setEditing] = useState(false);
30	  const [draft, setDraft] = useState(value);
31	  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
32	  const { automations } = useTranslation();
33	  const t = automations.steps;
34	
35	  useEffect(() => {
36	    if (!editing) setDraft(value);
37	  }, [value, editing]);
38	
39	  useEffect(() => {
40	    if (editing && inputRef.current) {
41	      inputRef.current.focus();
42	      inputRef.current.setSelectionRange(draft.length, draft.length);
43	    }
44	    // eslint-disable-next-line react-hooks/exhaustive-deps
45	  }, [editing]);
46	
47	  const commit = () => {
48	    setEditing(false);
49	    if (draft !== value) onSave(draft);
50	  };
51	
52	  const cancel = () => {
53	    setEditing(false);
54	    setDraft(value);
55	  };
56	
57	  const onKey = (e: React.KeyboardEvent) => {
58	    if (e.key === 'Escape') {
59	      e.preventDefault();
60	      cancel();
61	    } else if (e.key === 'Enter' && (!multiline || (e.metaKey || e.ctrlKey))) {
62	      e.preventDefault();
63	      commit();
64	    }
65	  };
66	
67	  if (editing) {
68	    if (multiline) {
69	      return (
70	        <textarea
71	          ref={(el) => { inputRef.current = el; }}
72	          value={draft}
73	          onChange={(e) => setDraft(e.target.value)}
74	          onBlur={commit}
75	          onKeyDown={onKey}
76	          placeholder={placeholder}
77	          aria-label={label}
78	          className={`w-full min-h-[80px] resize-vertical bg-white border border-teal-300 rounded px-2 py-1.5 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-teal-500 ${className}`}
79	        />
80	      );
81	    }
82	    return (
83	      <input
84	        ref={(el) => { inputRef.current = el; }}
85	        type="text"
86	        value={draft}
87	        onChange={(e) => setDraft(e.target.value)}
88	        onBlur={commit}
89	        onKeyDown={onKey}
90	        placeholder={placeholder}
91	        aria-label={label}
92	        className={`w-full bg-white border border-teal-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500 ${className}`}
93	      />
94	    );
95	  }
96	
97	  return (
98	    <button
99	      type="button"
100	      onClick={() => setEditing(true)}
101	      aria-label={label ?? t.editAria}
102	      className={`w-full text-left rounded px-2 py-1 text-sm hover:bg-neutral-100 cursor-text whitespace-pre-wrap ${value ? 'text-neutral-900' : 'text-neutral-400 italic'} ${className}`}
103	    >
104	      {value || placeholder || t.clickToEdit}
105	    </button>
106	  );
107	}
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I have the patched flow and tests. I’m now pinning exact line references from the current source and the H3 notes, then checking whether the new control flow introduces any fail-open paths the tests might miss.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba docs/autothing/runs/20260712-150958-4bb23640/slices/H3/impl-notes.md | sed -n '1,220p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	# H3 impl-notes - served-app EDIT MODE (admins only): patch-run preview / approve / rollback
     2	
     3	Slice H3 of the atomic security block. Built on H1 (the real `can()` + `loadWritable` follow-up-build
     4	gate) and H2 (`GET /api/app-assistant/whoami` detection + the panel's `admin` state). DONE-GREEN.
     5	
     6	## What was built - a thin FRONT-END over existing, H1-gated machinery (not a second brain)
     7	
     8	An admin's edit request becomes a SCOPED FOLLOW-UP BUILD (a "patch run") over the app's own git repo -
     9	the exact path the dashboard uses. H3 adds the panel UI + the network controller; it adds NO new
    10	capability/permission logic and NO new build/edit endpoint. The server is the authority.
    11	
    12	### 1. New controller module - `api/assets/panel-runtime/src/edit-mode.js` (new, reserved)
    13	A plain-JS, `fetch`-injectable controller (no React), so the network flow is unit-provable against a
    14	fake fetch. Every call targets the PLATFORM `/api/v1/*` API with the admin's platform Bearer - a
    15	SEPARATE plane from the visitor-blind `POST /api/app-assistant` (which still never reads the caller JWT).
    16	- `startEditJob` -> `POST /api/v1/jobs { kind:'build', description, sessionId, language:'pt', artifactId }`
    17	  with `Authorization: Bearer <admin JWT>`. This is a follow-up build; H1 re-gates it server-side
    18	  (`can(canEditApps)` AND `loadWritable`, uniform 404). `sessionId` is a fresh client correlation id
    19	  (`newEditSessionId`) - a follow-up reserves nothing, it only tags the job.
    20	- `readVersions` -> `GET /api/v1/artifacts/:id/versions` (newest-first; `items[0].sha` = HEAD).
    21	- `rollbackToVersion` -> `POST /api/v1/artifacts/:id/versions/:sha/restore` (forward-restore; one click).
    22	- `streamJobEvents` -> reads `GET /api/v1/jobs/:id/events?token=` with fetch + a ReadableStream reader
    23	  and `parseSseBuffer` (frame-by-frame SSE parsing; a frame split across chunk boundaries is buffered,
    24	  a garbled frame skipped - never a throw). Resolves on the terminal `complete`/`error` JobEvent.
    25	- `runEditPatch` orchestrates: capture the pre-run head BEFORE the build (the rollback target / diff
    26	  point) -> start the follow-up build -> stream `plan_step` narration to `onProgress` -> read the new
    27	  head for the preview. Returns a discriminated outcome: `ready | answered | failed | degraded`.
    28	- `degradeMessage(status)` maps 401/403/404/other to distinct calm PT-PT lines. `progressLine(ev)`
    29	  narrates `plan_step`. `EDIT_COPY` holds the shared PT-PT strings (the confirm wording etc.).
    30	
    31	### 2. Panel wiring - `api/assets/panel-runtime/src/AssistantPanel.jsx` + `.css` (reserved)
    32	- **Opt-in switch** (`.ekoa-assistant-adminbar` / `.ekoa-assistant-editswitch`): a VISIBLE, accessible
    33	  (`role="switch" aria-checked`) toggle, rendered ONLY when `admin === true`, OFF by default
    34	  (`editMode` starts `false`). A distinct control from the visitor OPERAR/MOSTRAR/ENSINAR toggle.
    35	- **Edit affordance** (`.ekoa-assistant-edit`, `data-edit-phase`): a dedicated, visually distinct
    36	  section (left accent bar + tinted surface + "Modo de edição (administrador)" header) shown only when
    37	  `admin && editMode`. Its phase machine: `compose` (type the request) -> `confirm` (the PT-PT intent
    38	  confirmation "Vou preparar esta alteração como uma revisão. Confirma?") -> `running` (live
    39	  `plan_step` narration) -> `preview` (shows new head + pre-run head, APPROVE vs REVERTER) -> `note`
    40	  (a terminal calm message). APPROVE keeps the new head (the build already activated it - no call);
    41	  REVERTER is one click to `rollbackToVersion(preRunSha)`.
    42	- **Admin discovery** (`.ekoa-assistant-discovery`): a discreet, dismissible banner shown ONCE to a
    43	  detected admin who has not opted in and not dismissed it (`admin && !editMode && !discoveryDismissed`),
    44	  with a concrete PT-PT suggestion ("Pode pedir alterações a esta aplicação - por exemplo, adicionar um
    45	  campo ou um botão."). Its CTA is the SAME explicit opt-in click; it never auto-enables edit.
    46	
    47	## Detect-then-ask enforcement (BINDING)
    48	
    49	Detection NEVER enables edit. `editMode` starts `false` and the only `setEditMode(true)` in the panel
    50	is inside `openEditMode`, wired exclusively to explicit click handlers (the switch + the discovery CTA).
    51	The H2 whoami DETECTION effect touches only `setAdmin` - it references neither `setEditMode` nor
    52	`openEditMode` (pinned by a test that slices the effect). Being an admin SHOWS the switch; it does not
    53	enter edit mode. `admin` is still set exactly once and read only to gate the affordance.
    54	
    55	## Graceful degradation
    56	
    57	Every mid-flow platform call is fail-soft: `runEditPatch`/`rollbackToVersion` return `{ ok:false, status }`
    58	/ `{ outcome:'degraded', status }` on any 401/403/404/network error (token expired, lost writability,
    59	app gone), and the panel renders `degradeMessage(status)` in the calm `note` phase - never a crash. A
    60	missing app id / unreadable token (cross-origin, sandboxed iframe) degrades the same way rather than
    61	firing a doomed call. An in-build classifier `answered` (no job created) and a build `error` event each
    62	land on their own calm note.
    63	
    64	## Visitor-blindness preserved (separate planes)
    65	
    66	Edit mode uses ONLY the platform `/api/v1/*` API with the admin JWT. The served-app `POST
    67	/api/app-assistant` plane is byte-for-byte untouched and stays visitor-blind - a test slices `confirmEdit`
    68	and asserts it references neither `ENDPOINT` nor `/api/app-assistant`. Edits are never routed through the
    69	visitor assistant endpoint.
    70	
    71	## Contracts / server
    72	
    73	NONE added. H3 reuses the existing jobs + versions/restore endpoints (all already in `shared/`), so
    74	`shared/src/app-assistant.ts` was NOT touched and no new contract test was needed. No new
    75	build/edit/capability logic (H1 owns gating). No queue (that is H4).
    76	
    77	## Diagram updated (FIXED-12)
    78	
    79	`docs/diagrams/04-agent-job.excalidraw` - added one free-standing note (`h3_edit_mode`, emerald
    80	`#047857`, monospace, x=72 y=332) directly below the existing H1 build-authz-gate note. WHY 04 and not
    81	03: an H3 edit request IS a follow-up build, which lives on the agent-job lifecycle diagram (04 already
    82	documents `POST /api/v1/jobs`, the follow-up path, and the H1 `canEditApps`/`loadWritable` gate). The
    83	note states the H3 admin plane: detect (H2 whoami) -> opt-in switch (never auto) -> confirm -> POST
    84	/jobs {artifactId} + admin JWT = the SAME follow-up build (H1 re-gates) -> stream SSE -> preview via
    85	versions -> APPROVE keeps head | ROLLBACK = restore (pre-run head); and that it is a SEPARATE plane from
    86	the visitor-blind POST /api/app-assistant. Round-trip verified: the diagram diff is +32 lines (exactly
    87	the one element), 0 deletions, no overlap with existing elements, valid JSON.
    88	
    89	## Reserved-path compliance
    90	
    91	All changes are within the H3 reserved set:
    92	- `api/assets/panel-runtime/src/AssistantPanel.jsx`, `AssistantPanel.css`, `edit-mode.js` (new module)
    93	- `api/tests/apps/assistant-panel.test.ts` (extended), `api/tests/apps/edit-mode.test.ts` (new)
    94	- `docs/diagrams/04-agent-job.excalidraw`
    95	- `slices/H3/**`
    96	`shared/src/app-assistant.ts` was NOT touched (no thin read needed). No commits, no stack ops, no real
    97	builds. Note: the root ESLint config ignores `api/assets/**` and `**/*.js`, so the panel JSX + the new
    98	`.js` module are linted by esbuild's `build.mjs` compile (their real gate), not eslint; only the `.ts`
    99	test files are eslint-checked.
   100	
   101	## Tests
   102	
   103	- **Behavioural** (`api/tests/apps/edit-mode.test.ts`, 16 tests): the controller is imported at runtime
   104	  by file URL (it is a compiled-by-esbuild asset, outside the tsc program) and driven with a fake fetch:
   105	  POST /jobs body carries `kind:'build'` + `artifactId` + `description` + `Bearer`; the pre-run head is
   106	  read BEFORE the POST (order asserted); `plan_step` narration surfaces; a 403/404 on /jobs and a 403 on
   107	  the versions read each degrade (no /jobs issued in the latter); an error event -> failed; answered ->
   108	  answered; rollback POSTs the restore endpoint with the Bearer; a 404 on restore degrades; SSE frames
   109	  parse (comments/non-data ignored, partial + split frames reassembled); no emoji in the source.
   110	- **Source-contract** (`api/tests/apps/assistant-panel.test.ts`, +6 tests, +1 H2 fix): the switch is
   111	  admin-gated and starts OFF; the affordance is revealed only by `admin && editMode`; detect-then-ask is
   112	  binding (one `setEditMode(true)`, in `openEditMode`, wired to clicks; the detection effect touches
   113	  neither); the discovery banner is once/dismissible and never auto-enables; the flow uses the /api/v1/*
   114	  plane (imports from `./edit-mode`, `runEditPatch`/`rollbackToVersion`) and `confirmEdit` never
   115	  references the visitor endpoint; graceful degradation via `degradeMessage` + the `note` phase. The one
   116	  H2 test that pinned "no `setEditMode` yet" (deferred-to-H3) was updated to assert, instead, that the
   117	  DETECTION effect never enables edit mode (its intent survives H3).
   118	
   119	The heavy end-to-end (a REAL patch run editing a real app + rollback) is the LEAD's live probe - NOT run
   120	here; no e2e driver added. The flow is correct + unit-proven.
   121	
   122	## Verification (all green, locally)
   123	
   124	- `cd api && npx tsc --noEmit -p tsconfig.json` -> 0
   125	- `npx tsc --noEmit -p tsconfig.test.json` -> 0
   126	- `npx eslint api/tests/apps/edit-mode.test.ts api/tests/apps/assistant-panel.test.ts` -> 0 errors
   127	  (panel `.jsx`/`.js` assets are config-ignored - esbuild compile is their gate)
   128	- `npx vitest run tests/apps tests/contract` -> 57 files, 559 tests, all pass
   129	- `node assets/panel-runtime/build.mjs` -> built (panel compiles, 240389 bytes)
   130	- repo root `npm run gate:chokepoint` -> clean (nothing outside api/src/llm touches the provider)
   131	
   132	## Codex-fix round (2026-07-13) - 2 Mediums closed (commit 28a6e12 review)
   133	
   134	Codex review of H3 returned NEEDS-WORK with 2 real Mediums; a fresh review APPROVED. Both fixed in
   135	the working tree (edit-mode.js + AssistantPanel.jsx + tests) - no commit; the lead runs the gate.
   136	
   137	- **M1 (SSE early-close false "no change"): CLOSED.** Before, `runEditPatch` treated the SSE stream
   138	  outcome as terminal: a proxy/network blip that closed the stream BEFORE the `complete` event read
   139	  as done, one versions read showed the head unchanged, and the panel said "no change" - while the
   140	  follow-up build could complete moments later and activate a real new head (a deployed edit the
   141	  admin was told did not happen). FIX: the SSE is now streamed for LIVE PROGRESS ONLY and is NOT
   142	  terminal. After the stream ends (or drops), the new `pollJobUntilTerminal` polls
   143	  `GET /api/v1/jobs/:id` until the JOB RECORD reaches a terminal status - transient-tolerant exactly
   144	  like the fees-knowledge e2e build poll (`safeJson` never throws; a deterministic 4xx degrades on
   145	  its status; a 5xx / non-JSON / network blip is tolerated up to a bounded count; the deadline yields
   146	  `pending`). Only a CONFIRMED `completed` reads the new head for the preview (never a mid-build
   147	  snapshot); `failed`/`cancelled` -> the calm failure note; the deadline -> a new `pending` outcome
   148	  the panel shows as "A revisão ainda está em curso..." (never a false ready/no-change). Terminal
   149	  statuses mirror `api/src/agents/jobs.ts` (`completed` success; `failed`/`cancelled` failure).
   150	  TESTS: an SSE that closes with NO terminal frame polls running->completed and previews the head the
   151	  build produced AFTER the blip (post-run versions read strictly after the job poll); a never-terminal
   152	  job at the deadline returns `pending` and does NOT read a post-run head; `pollJobUntilTerminal`
   153	  tolerates a 502/non-JSON blip then completes, degrades on a deterministic 401, and treats
   154	  `cancelled` as terminal failure.
   155	
   156	- **M2 (stale rollback sha wipes concurrent changes): CLOSED.** Before, Reverter forward-restored to
   157	  `preRunSha` with no guard that HEAD was still the head THIS edit produced; if another admin / a
   158	  dashboard action / a later restore moved HEAD between preview and the click, restoring to
   159	  `preRunSha` silently wiped that newer unrelated change. FIX: the preview now captures the new head
   160	  this edit produced (`editPreview.newHeadSha`, the confirmed-completed head), and the Reverter click
   161	  goes through the new `guardedRollback`, which RE-READS `GET /versions` and requires
   162	  `items[0].sha === expectedHeadSha` (the edit's head) AND that `preRunSha` still exists in history
   163	  before restoring. If HEAD advanced (or the target is gone) it REFUSES with no restore call, and the
   164	  panel shows the calm PT-PT "A aplicação foi alterada entretanto; atualize a pré-visualização." The
   165	  Reverter button is also only rendered when a `preRunSha` exists (never restore to undefined).
   166	  TESTS: a rollback where HEAD still == the edit's new head fires restore to `preRunSha`; a rollback
   167	  where HEAD advanced is REFUSED (`reason:'head-advanced'`, no restore call); a missing pre-run
   168	  target is REFUSED (`reason:'target-missing'`); a refused versions re-read degrades. Panel pins:
   169	  `guardedRollback({... expectedHeadSha ...})`, the `head-advanced` branch + `EDIT_COPY.headAdvanced`,
   170	  and the `preRunSha`-guarded Reverter.
   171	
   172	The detect-then-ask + visitor-blindness pins are intact (the visitor-endpoint slice check on
   173	`confirmEdit` still passes; the switch/discovery opt-in tests unchanged). No new endpoints; `shared/`
   174	still untouched (M1 reuses `GET /jobs/:id`, M2 reuses `GET /versions` + restore).
   175	
   176	VERIFY (all green): `tsc -p tsconfig.json` 0; `tsc -p tsconfig.test.json` 0; eslint touched .ts 0
   177	errors; `vitest run tests/apps` -> 20 files, 253 tests pass (edit-mode.test.ts now 25, +9 for M1/M2;
   178	assistant-panel.test.ts H3 block +2 M1/M2 pins); `node assets/panel-runtime/build.mjs` compiles
   179	(242378 bytes); `npm run gate:chokepoint` clean.

exec
/bin/zsh -lc "nl -ba docs/autothing/runs/20260712-150958-4bb23640/slices/H3/codex-review.md | sed -n '1,220p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	Reading additional input from stdin...
     2	OpenAI Codex v0.142.5
     3	--------
     4	workdir: /Users/ggomes/dev/ekoa-code
     5	model: gpt-5.4
     6	provider: openai
     7	approval: never
     8	sandbox: read-only
     9	reasoning effort: medium
    10	reasoning summaries: none
    11	session id: 019f5d5a-2f77-7830-9fa3-fe7008f3db33
    12	--------
    13	user
    14	Adversarial SECURITY review in /Users/ggomes/dev/ekoa-code of commit 28a6e12 (git show 28a6e12): slice H3 of a security block - served-app EDIT MODE (admins only), a thin front-end over the existing follow-up-build patch run + versions/restore rollback machinery. It shows an OPT-IN edit switch ONLY when H2 detection admin===true (detect-then-ask: detection NEVER auto-enables edit); an admin edit request becomes a follow-up build via POST /api/v1/jobs {artifactId} with the admin platform Bearer (H1 re-gates server-side: can(canEditApps)+loadWritable, uniform 404), streamed; then preview (new head vs pre-run head) -> APPROVE or one-click ROLLBACK via POST /api/v1/artifacts/:id/versions/:sha/restore. No new capability logic/endpoints; the visitor-blind POST /api/app-assistant plane is untouched. Controller: api/assets/panel-runtime/src/edit-mode.js (fetch-injectable); wiring in AssistantPanel.jsx. Hunt for REAL defects with file:line + scenario: (1) detect-then-ask - can edit mode be entered WITHOUT an explicit opt-in click? any setEditMode(true) wired to the detection effect / auto-trigger / discovery banner? switch OFF by default? (2) client-gate-only risk - is every privileged action independently server-gated (startEditJob->/api/v1/jobs H1-gated; rollback->versions/restore writable-gated), so a non-admin force-enabling the UI in devtools drives NOTHING the server accepts? (3) the drive - admin Bearer read defensively (cross-origin throws), sent ONLY same-origin, never logged/leaked; SSE parseSseBuffer cannot crash/hang on a split/garbled frame; pre-run head capture vs build TOCTOU on the rollback target; (4) rollback targets the PRE-run head not the new head; approve/rollback wrong-sha risk; (5) graceful degradation on 401/403/404 (calm msg, no crash); PT-PT no emoji/dash; (6) test honesty - detect-then-ask effect-slice not a tautology, drive asserts artifactId+Bearer, visitor-blindness asserted. Read slices/H3/impl-notes.md. Read-only cmds OK. Concise: a bullet per finding classified High/Medium/Low with file:line, then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
    15	hook: SessionStart
    16	hook: SessionStart Completed
    17	hook: UserPromptSubmit
    18	hook: UserPromptSubmit Completed
    19	codex
    20	Reviewing commit `28a6e12` as an adversarial security pass. I’m checking the project context files first, then the H3 notes and the exact code paths touched by the served-app edit mode flow.
    21	hook: PreToolUse
    22	hook: PreToolUse
    23	hook: PreToolUse Completed
    24	hook: PreToolUse Completed
    25	hook: PreToolUse
    26	exec
    27	/bin/zsh -lc 'if [ -d .codegraph ]; then echo CODEGRAPH_PRESENT; else echo NO_CODEGRAPH; fi' in /Users/ggomes/dev/ekoa-code
    28	 succeeded in 0ms:
    29	CODEGRAPH_PRESENT
    30	
    31	hook: PreToolUse Completed
    32	exec
    33	/bin/zsh -lc "pwd && ls -la && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'AGENTS.md' -g 'impl-notes.md' ." in /Users/ggomes/dev/ekoa-code
    34	 succeeded in 0ms:
    35	/Users/ggomes/dev/ekoa-code
    36	total 1272
    37	drwxr-xr-x@  32 ggomes  staff    1024 Jul 13 16:54 .
    38	drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
    39	drwxr-xr-x@   6 ggomes  staff     192 Jul 13 11:15 .claude
    40	drwxr-xr-x@   9 ggomes  staff     288 Jul 13 22:20 .codegraph
    41	-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
    42	drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
    43	-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
    44	drwxr-xr-x@  16 ggomes  staff     512 Jul 13 22:19 .git
    45	drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:59 .githooks
    46	drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:55 .github
    47	-rw-r--r--@   1 ggomes  staff    1000 Jul 13 15:43 .gitignore
    48	-rw-r--r--@   1 ggomes  staff     450 Jul  7 02:23 .npmrc
    49	drwxr-xr-x@  56 ggomes  staff    1792 Jul 12 07:34 .playwright-cli
    50	drwxr-xr-x@   6 ggomes  staff     192 Jul 11 22:20 .walkthrough
    51	-rw-r--r--@   1 ggomes  staff    5797 Jul 11 22:20 CLAUDE.md
    52	-rw-r--r--@   1 ggomes  staff    2351 Jul 13 16:54 Dockerfile.api
    53	-rw-r--r--@   1 ggomes  staff    1658 Jul  8 10:24 Dockerfile.web
    54	-rw-r--r--@   1 ggomes  staff   47608 Jul 13 21:47 RUN_LOG.md
    55	drwxr-xr-x@  18 ggomes  staff     576 Jul 13 15:42 api
    56	-rw-r--r--@   1 ggomes  staff       5 Jul  6 22:50 backend.port
    57	drwxr-xr-x@   6 ggomes  staff     192 Jul  8 10:26 deploy
    58	drwxr-xr-x@  17 ggomes  staff     544 Jul 13 17:57 docs
    59	drwxr-xr-x@   3 ggomes  staff      96 Jul  8 09:40 ekoa-data
    60	drwxr-xr-x@ 715 ggomes  staff   22880 Jul 11 15:53 node_modules
    61	-rw-r--r--@   1 ggomes  staff  545459 Jul 11 22:20 package-lock.json
    62	-rw-r--r--@   1 ggomes  staff    1751 Jul  8 04:36 package.json
    63	-rw-r--r--@   1 ggomes  staff    1070 Jul  7 01:01 playwright.config.ts
    64	drwxr-xr-x@  11 ggomes  staff     352 Jul 11 22:20 scripts
    65	drwxr-xr-x@   8 ggomes  staff     256 Jul  6 19:06 shared
    66	drwxr-xr-x@   3 ggomes  staff      96 Jul 12 06:09 test-results
    67	-rw-r--r--@   1 ggomes  staff     429 Jul  6 18:55 tsconfig.base.json
    68	drwxr-xr-x@  24 ggomes  staff     768 Jul 13 02:47 web
    69	./docs/autothing/runs/20260712-150958-4bb23640/slices/F1/impl-notes.md
    70	./docs/autothing/runs/20260712-150958-4bb23640/slices/C5/impl-notes.md
    71	./docs/autothing/runs/20260712-150958-4bb23640/slices/E1/impl-notes.md
    72	./docs/autothing/runs/20260712-150958-4bb23640/slices/D1/impl-notes.md
    73	./docs/autothing/runs/20260712-150958-4bb23640/slices/B2/impl-notes.md
    74	./docs/autothing/runs/20260712-150958-4bb23640/slices/C3/impl-notes.md
    75	./docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
    76	./docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md
    77	./docs/autothing/runs/20260712-150958-4bb23640/slices/D3/impl-notes.md
    78	./docs/autothing/runs/20260712-150958-4bb23640/slices/D2/impl-notes.md
    79	./docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md
    80	./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/impl-notes.md
    81	./docs/autothing/runs/20260712-150958-4bb23640/slices/F2/impl-notes.md
    82	./docs/autothing/runs/20260712-150958-4bb23640/slices/H3/impl-notes.md
    83	./docs/autothing/runs/20260712-150958-4bb23640/slices/G2/impl-notes.md
    84	
    85	exec
    86	/bin/zsh -lc 'git show --stat --oneline 28a6e12' in /Users/ggomes/dev/ekoa-code
    87	 succeeded in 0ms:
    88	git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
    89	git: error: couldn't create cache file '/tmp/xcrun_db-hwV5Ee2C' (errno=Operation not permitted)
    90	git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
    91	git: error: couldn't create cache file '/tmp/xcrun_db-rGD3UeXl' (errno=Operation not permitted)
    92	28a6e12 feat(operator-run/h3): SECURITY - served-app edit mode (admins only). Opt-in edit switch shown ONLY when H2 admin===true (detect-then-ask binding: detection never auto-enables); an edit request becomes a SCOPED FOLLOW-UP BUILD (patch run) over the platform /api/v1/jobs API with the admin JWT (H1-gated server-side), streamed, then preview (new head vs pre-run head) -> APPROVE or one-click ROLLBACK via versions/restore; admin-discovery discreet dismissible banner. Thin front-end, NO new capability/endpoint; visitor-blind POST /api/app-assistant untouched. edit-mode.js fetch-injectable controller + panel phase machine; diagram 04 updated
    93	 api/assets/panel-runtime/src/AssistantPanel.css    |  283 +
    94	 api/assets/panel-runtime/src/AssistantPanel.jsx    |  306 +-
    95	 api/assets/panel-runtime/src/edit-mode.js          |  315 ++
    96	 api/tests/apps/assistant-panel.test.ts             |   82 +-
    97	 api/tests/apps/edit-mode.test.ts                   |  276 +
    98	 .../slices/H2/codex-review.md                      | 5446 ++++++++++++++++++++
    99	 .../slices/H3/impl-notes.md                        |  130 +
   100	 .../slices/H3/worker-status.txt                    |    1 +
   101	 docs/diagrams/04-agent-job.excalidraw              |   32 +
   102	 9 files changed, 6863 insertions(+), 8 deletions(-)
   103	
   104	codex
   105	The repo is CodeGraph-indexed, so I’m using that path first for the H3 surface and its tests. After that I’ll confirm the exact commit diff and the implementation notes against the server gates and rollback flow.
   106	hook: PreToolUse
   107	hook: PreToolUse
   108	hook: PreToolUse Completed
   109	hook: PreToolUse Completed
   110	exec
   111	/bin/zsh -lc "sed -n '1,220p' docs/autothing/runs/20260712-150958-4bb23640/slices/H3/impl-notes.md" in /Users/ggomes/dev/ekoa-code
   112	 succeeded in 0ms:
   113	# H3 impl-notes - served-app EDIT MODE (admins only): patch-run preview / approve / rollback
   114	
   115	Slice H3 of the atomic security block. Built on H1 (the real `can()` + `loadWritable` follow-up-build
   116	gate) and H2 (`GET /api/app-assistant/whoami` detection + the panel's `admin` state). DONE-GREEN.
   117	
   118	## What was built - a thin FRONT-END over existing, H1-gated machinery (not a second brain)
   119	
   120	An admin's edit request becomes a SCOPED FOLLOW-UP BUILD (a "patch run") over the app's own git repo -
   121	the exact path the dashboard uses. H3 adds the panel UI + the network controller; it adds NO new
   122	capability/permission logic and NO new build/edit endpoint. The server is the authority.
   123	
   124	### 1. New controller module - `api/assets/panel-runtime/src/edit-mode.js` (new, reserved)
   125	A plain-JS, `fetch`-injectable controller (no React), so the network flow is unit-provable against a
   126	fake fetch. Every call targets the PLATFORM `/api/v1/*` API with the admin's platform Bearer - a
   127	SEPARATE plane from the visitor-blind `POST /api/app-assistant` (which still never reads the caller JWT).
   128	- `startEditJob` -> `POST /api/v1/jobs { kind:'build', description, sessionId, language:'pt', artifactId }`
   129	  with `Authorization: Bearer <admin JWT>`. This is a follow-up build; H1 re-gates it server-side
   130	  (`can(canEditApps)` AND `loadWritable`, uniform 404). `sessionId` is a fresh client correlation id
   131	  (`newEditSessionId`) - a follow-up reserves nothing, it only tags the job.
   132	- `readVersions` -> `GET /api/v1/artifacts/:id/versions` (newest-first; `items[0].sha` = HEAD).
   133	- `rollbackToVersion` -> `POST /api/v1/artifacts/:id/versions/:sha/restore` (forward-restore; one click).
   134	- `streamJobEvents` -> reads `GET /api/v1/jobs/:id/events?token=` with fetch + a ReadableStream reader
   135	  and `parseSseBuffer` (frame-by-frame SSE parsing; a frame split across chunk boundaries is buffered,
   136	  a garbled frame skipped - never a throw). Resolves on the terminal `complete`/`error` JobEvent.
   137	- `runEditPatch` orchestrates: capture the pre-run head BEFORE the build (the rollback target / diff
   138	  point) -> start the follow-up build -> stream `plan_step` narration to `onProgress` -> read the new
   139	  head for the preview. Returns a discriminated outcome: `ready | answered | failed | degraded`.
   140	- `degradeMessage(status)` maps 401/403/404/other to distinct calm PT-PT lines. `progressLine(ev)`
   141	  narrates `plan_step`. `EDIT_COPY` holds the shared PT-PT strings (the confirm wording etc.).
   142	
   143	### 2. Panel wiring - `api/assets/panel-runtime/src/AssistantPanel.jsx` + `.css` (reserved)
   144	- **Opt-in switch** (`.ekoa-assistant-adminbar` / `.ekoa-assistant-editswitch`): a VISIBLE, accessible
   145	  (`role="switch" aria-checked`) toggle, rendered ONLY when `admin === true`, OFF by default
   146	  (`editMode` starts `false`). A distinct control from the visitor OPERAR/MOSTRAR/ENSINAR toggle.
   147	- **Edit affordance** (`.ekoa-assistant-edit`, `data-edit-phase`): a dedicated, visually distinct
   148	  section (left accent bar + tinted surface + "Modo de edição (administrador)" header) shown only when
   149	  `admin && editMode`. Its phase machine: `compose` (type the request) -> `confirm` (the PT-PT intent
   150	  confirmation "Vou preparar esta alteração como uma revisão. Confirma?") -> `running` (live
   151	  `plan_step` narration) -> `preview` (shows new head + pre-run head, APPROVE vs REVERTER) -> `note`
   152	  (a terminal calm message). APPROVE keeps the new head (the build already activated it - no call);
   153	  REVERTER is one click to `rollbackToVersion(preRunSha)`.
   154	- **Admin discovery** (`.ekoa-assistant-discovery`): a discreet, dismissible banner shown ONCE to a
   155	  detected admin who has not opted in and not dismissed it (`admin && !editMode && !discoveryDismissed`),
   156	  with a concrete PT-PT suggestion ("Pode pedir alterações a esta aplicação - por exemplo, adicionar um
   157	  campo ou um botão."). Its CTA is the SAME explicit opt-in click; it never auto-enables edit.
   158	
   159	## Detect-then-ask enforcement (BINDING)
   160	
   161	Detection NEVER enables edit. `editMode` starts `false` and the only `setEditMode(true)` in the panel
   162	is inside `openEditMode`, wired exclusively to explicit click handlers (the switch + the discovery CTA).
   163	The H2 whoami DETECTION effect touches only `setAdmin` - it references neither `setEditMode` nor
   164	`openEditMode` (pinned by a test that slices the effect). Being an admin SHOWS the switch; it does not
   165	enter edit mode. `admin` is still set exactly once and read only to gate the affordance.
   166	
   167	## Graceful degradation
   168	
   169	Every mid-flow platform call is fail-soft: `runEditPatch`/`rollbackToVersion` return `{ ok:false, status }`
   170	/ `{ outcome:'degraded', status }` on any 401/403/404/network error (token expired, lost writability,
   171	app gone), and the panel renders `degradeMessage(status)` in the calm `note` phase - never a crash. A
   172	missing app id / unreadable token (cross-origin, sandboxed iframe) degrades the same way rather than
   173	firing a doomed call. An in-build classifier `answered` (no job created) and a build `error` event each
   174	land on their own calm note.
   175	
   176	## Visitor-blindness preserved (separate planes)
   177	
   178	Edit mode uses ONLY the platform `/api/v1/*` API with the admin JWT. The served-app `POST
   179	/api/app-assistant` plane is byte-for-byte untouched and stays visitor-blind - a test slices `confirmEdit`
   180	and asserts it references neither `ENDPOINT` nor `/api/app-assistant`. Edits are never routed through the
   181	visitor assistant endpoint.
   182	
   183	## Contracts / server
   184	
   185	NONE added. H3 reuses the existing jobs + versions/restore endpoints (all already in `shared/`), so
   186	`shared/src/app-assistant.ts` was NOT touched and no new contract test was needed. No new
   187	build/edit/capability logic (H1 owns gating). No queue (that is H4).
   188	
   189	## Diagram updated (FIXED-12)
   190	
   191	`docs/diagrams/04-agent-job.excalidraw` - added one free-standing note (`h3_edit_mode`, emerald
   192	`#047857`, monospace, x=72 y=332) directly below the existing H1 build-authz-gate note. WHY 04 and not
   193	03: an H3 edit request IS a follow-up build, which lives on the agent-job lifecycle diagram (04 already
   194	documents `POST /api/v1/jobs`, the follow-up path, and the H1 `canEditApps`/`loadWritable` gate). The
   195	note states the H3 admin plane: detect (H2 whoami) -> opt-in switch (never auto) -> confirm -> POST
   196	/jobs {artifactId} + admin JWT = the SAME follow-up build (H1 re-gates) -> stream SSE -> preview via
   197	versions -> APPROVE keeps head | ROLLBACK = restore (pre-run head); and that it is a SEPARATE plane from
   198	the visitor-blind POST /api/app-assistant. Round-trip verified: the diagram diff is +32 lines (exactly
   199	the one element), 0 deletions, no overlap with existing elements, valid JSON.
   200	
   201	## Reserved-path compliance
   202	
   203	All changes are within the H3 reserved set:
   204	- `api/assets/panel-runtime/src/AssistantPanel.jsx`, `AssistantPanel.css`, `edit-mode.js` (new module)
   205	- `api/tests/apps/assistant-panel.test.ts` (extended), `api/tests/apps/edit-mode.test.ts` (new)
   206	- `docs/diagrams/04-agent-job.excalidraw`
   207	- `slices/H3/**`
   208	`shared/src/app-assistant.ts` was NOT touched (no thin read needed). No commits, no stack ops, no real
   209	builds. Note: the root ESLint config ignores `api/assets/**` and `**/*.js`, so the panel JSX + the new
   210	`.js` module are linted by esbuild's `build.mjs` compile (their real gate), not eslint; only the `.ts`
   211	test files are eslint-checked.
   212	
   213	## Tests
   214	
   215	- **Behavioural** (`api/tests/apps/edit-mode.test.ts`, 16 tests): the controller is imported at runtime
   216	  by file URL (it is a compiled-by-esbuild asset, outside the tsc program) and driven with a fake fetch:
   217	  POST /jobs body carries `kind:'build'` + `artifactId` + `description` + `Bearer`; the pre-run head is
   218	  read BEFORE the POST (order asserted); `plan_step` narration surfaces; a 403/404 on /jobs and a 403 on
   219	  the versions read each degrade (no /jobs issued in the latter); an error event -> failed; answered ->
   220	  answered; rollback POSTs the restore endpoint with the Bearer; a 404 on restore degrades; SSE frames

exec
/bin/zsh -lc 'codegraph node api/assets/panel-runtime/src/edit-mode.js' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '620,760p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   620	  }, []);
   621	
   622	  /** confirm -> running -> preview | note: run the CONFIRMED patch over the existing build
   623	   *  machinery. Reads the platform token best-effort (a cross-origin/sandboxed iframe has
   624	   *  none); with no app id / no token it degrades calmly rather than firing a doomed call. */
   625	  const confirmEdit = useCallback(async () => {
   626	    const id = appId();
   627	    const token = readPlatformToken();
   628	    const description = editDraft.trim();
   629	    if (!id || !token || !description) {
   630	      // No token readable (cross-origin) reads as an expired session; otherwise a generic note.
   631	      setEditMessage(degradeMessage(token ? 0 : 401));
   632	      setEditPhase('note');
   633	      return;
   634	    }
   635	    setEditBusy(true);
   636	    setEditProgress('');
   637	    setEditPhase('running');
   638	    const result = await runEditPatch({
   639	      fetchImpl: (url, opts) => fetch(url, opts),
   640	      appId: id,
   641	      token,
   642	      description,
   643	      onProgress: (ev) => {
   644	        const line = progressLine(ev);
   645	        if (line) setEditProgress(line);
   646	      },
   647	    });
   648	    setEditBusy(false);
   649	    if (result.outcome === 'ready') {
   650	      // The JOB was CONFIRMED completed (poll), so newHeadSha reflects the finished build - never a
   651	      // mid-build snapshot. preRunSha is the diff point; newHeadSha is the head THIS edit produced.
   652	      setEditPreview({ preRunSha: result.preRunSha, newHeadSha: result.newHeadSha });
   653	      setEditPhase('preview');
   654	    } else if (result.outcome === 'answered') {
   655	      // The in-build classifier resolved the request without a build (no revision was created).
   656	      setEditMessage('Não foi criada nenhuma revisão para este pedido. Reformule a alteração pretendida.');
   657	      setEditPhase('note');
   658	    } else if (result.outcome === 'pending') {
   659	      // The stream dropped and the build did not reach a terminal status within the deadline. NOT a
   660	      // failure and NOT a false "no change" (M1): tell the admin it is still running.
   661	      setEditMessage(EDIT_COPY.stillRunning);
   662	      setEditPhase('note');
   663	    } else if (result.outcome === 'failed') {
   664	      setEditMessage('A revisão não foi concluída. Tente reformular o pedido.');
   665	      setEditPhase('note');
   666	    } else {
   667	      // degraded (401/403/404/network) -> a calm, specific PT-PT message.
   668	      setEditMessage(degradeMessage(result.status));
   669	      setEditPhase('note');
   670	    }
   671	  }, [editDraft]);
   672	
   673	  /** APPROVE = keep the new head. The build already activated it, so there is nothing to
   674	   *  call - just clear the preview and confirm. */
   675	  const approveEdit = useCallback(() => {
   676	    setEditMessage(EDIT_COPY.approved);
   677	    setEditPreview(null);
   678	    setEditPhase('note');
   679	  }, []);
   680	
   681	  /** ROLLBACK (one click) = forward-restore to the pre-run head. H1-gated server-side, and GUARDED
   682	   *  against a stale target (M2): guardedRollback re-reads the versions and REFUSES if HEAD is no
   683	   *  longer the head THIS edit produced (a concurrent change moved it) rather than blind-restoring
   684	   *  to preRunSha and wiping that unrelated change. A refusal shows a calm "refresh" message. */
   685	  const rollbackEdit = useCallback(async () => {
   686	    const id = appId();
   687	    const token = readPlatformToken();
   688	    const preRunSha = editPreview && editPreview.preRunSha;
   689	    const expectedHeadSha = editPreview && editPreview.newHeadSha;
   690	    if (!id || !token || !preRunSha || !expectedHeadSha) {
   691	      setEditMessage(degradeMessage(token ? 0 : 401));
   692	      setEditPhase('note');
   693	      return;
   694	    }
   695	    setEditBusy(true);
   696	    const result = await guardedRollback({ fetchImpl: (url, opts) => fetch(url, opts), appId: id, token, preRunSha, expectedHeadSha });
   697	    setEditBusy(false);
   698	    if (result.ok) {
   699	      setEditMessage(EDIT_COPY.rolledBack);
   700	      setEditPreview(null);
   701	      setEditPhase('note');
   702	    } else if (result.reason === 'head-advanced' || result.reason === 'target-missing') {
   703	      // HEAD moved (or the target is gone) between preview and click - refuse, never blind-restore.
   704	      setEditMessage(EDIT_COPY.headAdvanced);
   705	      setEditPreview(null);
   706	      setEditPhase('note');
   707	    } else {
   708	      setEditMessage(degradeMessage(result.status));
   709	      setEditPhase('note');
   710	    }
   711	  }, [editPreview]);
   712	
   713	  if (collapsed) {
   714	    return (
   715	      <button type="button" className="ekoa-assistant-launcher" onClick={open} aria-label="Abrir o assistente">
   716	        <ChatIcon />
   717	        <span>Assistente</span>
   718	      </button>
   719	    );
   720	  }
   721	
   722	  // A tour is on-screen for every phase except idle/cancelled (both mean "no tour").
   723	  const tourActive = !!(tour && tour.status && tour.status !== 'idle' && tour.status !== 'cancelled');
   724	
   725	  return (
   726	    <aside className="ekoa-assistant" data-collapsed="false" role="complementary" aria-label="Assistente">
   727	      <header className="ekoa-assistant-header">
   728	        <span className="ekoa-assistant-titlegroup" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2, 0.5rem)' }}>
   729	          <span className="ekoa-assistant-title">Assistente</span>
   730	          {/* H2 detect-then-ask: a DISCREET, non-intrusive indicator that an admin capability
   731	              exists. It does NOTHING - no click handler, no mode change, no privileged call. The
   732	              opt-in edit-mode switch is H3. Styled inline (brand-neutral via the panel CSS vars)
   733	              so it inherits the app's theme without a bespoke stylesheet rule. */}
   734	          {admin ? (
   735	            <span
   736	              className="ekoa-assistant-admin-badge"
   737	              data-admin="true"
   738	              title="Tem permissões de administrador nesta aplicação."
   739	              style={{
   740	                fontSize: 'var(--text-sm, 0.8125rem)',
   741	                fontWeight: 600,
   742	                color: 'var(--color-text-muted, #475569)',
   743	                border: '1px solid var(--color-border, #E2E8F0)',
   744	                borderRadius: 'var(--radius-sm, 0.375rem)',
   745	                padding: '0.05rem 0.4rem',
   746	                lineHeight: 1.4,
   747	                letterSpacing: '0.02em',
   748	                whiteSpace: 'nowrap',
   749	              }}
   750	            >
   751	              Administrador
   752	            </span>
   753	          ) : null}
   754	        </span>
   755	        <button type="button" className="ekoa-assistant-close" onClick={collapsePanel} aria-label="Fechar o assistente">
   756	          <CloseIcon />
   757	        </button>
   758	      </header>
   759	
   760	      <div className="ekoa-assistant-modes" role="group" aria-label="Modo do assistente">

 succeeded in 279ms:
**api/assets/panel-runtime/src/edit-mode.js** — 440 lines, 20 symbols · used by 1 file: api/assets/panel-runtime/src/AssistantPanel.jsx

1	/*
2	 * Operator Assistant Panel - EDIT MODE controller (operator-run H3; admins only).
3	 *
4	 * A thin FRONT-END over the platform's EXISTING build machinery (all H1-gated). It is
5	 * NOT a second brain: an admin's edit request becomes a SCOPED FOLLOW-UP BUILD (a
6	 * "patch run") over the app's own git repo, exactly the path the dashboard uses.
7	 *
8	 * This module owns the NETWORK side of that flow, factored out of AssistantPanel.jsx so
9	 * it can be unit-proven against a fake fetch (tests/apps/edit-mode.test.ts). Every call
10	 * targets the PLATFORM /api/v1/* API with the admin's platform Bearer - a SEPARATE plane
11	 * from the served-app POST /api/app-assistant, which stays visitor-blind (it never reads
12	 * the caller JWT). Nothing here grounds, bills, or issues an assistant turn.
13	 *
14	 * The plane's gates are the server's, not ours:
15	 *   - POST /api/v1/jobs { kind:'build', artifactId, description } → a follow-up build,
16	 *     gated server-side by can(canEditApps) AND loadWritable(actor, artifactId) (H1).
17	 *     A non-admin (no token / plain user / cross-org) is refused there with a uniform
18	 *     404, so this front-end can offer the switch freely: the SERVER is the authority.
19	 *   - GET  /api/v1/artifacts/:id/versions → the commit list (newest first). We read it
20	 *     BEFORE the run (the pre-run head = the rollback target / diff point) and AFTER
21	 *     (the new head) for the preview.
22	 *   - POST /api/v1/artifacts/:id/versions/:sha/restore → forward-restore to the pre-run
23	 *     head (one-click rollback). writable()-gated + canEditApps (H1).
24	 *   - GET  /api/v1/jobs/:id/events?token=... → the job SSE (progress narration). The
25	 *     job's own owner-scoped stream (?token= = the same admin token that created it).
26	 *
27	 * Graceful degradation is a first-class outcome: any mid-flow 401/403/404 (token
28	 * expired, lost writability, app gone) resolves to a calm PT-PT message, never a throw
29	 * and never a crash. PT-PT throughout, no emoji, no em/en-dash.
30	 */
31	
32	/** The build-jobs collection endpoint (a follow-up build is a POST here with artifactId). */
33	export const JOBS_ENDPOINT = '/api/v1/jobs';
34	
35	/** GET the artifact's version list (commits, newest first). */
36	export function versionsEndpoint(appId) {
37	  return `/api/v1/artifacts/${encodeURIComponent(appId)}/versions`;
38	}
39	
40	/** POST to forward-restore the artifact to `sha` (one-click rollback). */
41	export function restoreEndpoint(appId, sha) {
42	  return `/api/v1/artifacts/${encodeURIComponent(appId)}/versions/${encodeURIComponent(sha)}/restore`;
43	}
44	
45	/** The job SSE stream. EventSource cannot set headers (CONV-1), so the job stream
46	 *  authenticates via ?token= (verifySseToken, the same chain requireAuth runs); we read
47	 *  it with fetch (the panel's one transport) rather than EventSource so it stays
48	 *  abortable and unit-testable. */
49	export function jobEventsUrl(jobId, token) {
50	  return `/api/v1/jobs/${encodeURIComponent(jobId)}/events?token=${encodeURIComponent(token)}`;
51	}
52	
53	/** GET the persisted job record (its terminal status is the AUTHORITATIVE "did the build finish?"
54	 *  signal - not the SSE, which a proxy/network blip can close early). auth:'user' (admin Bearer). */
55	export function jobEndpoint(jobId) {
56	  return `/api/v1/jobs/${encodeURIComponent(jobId)}`;
57	}
58	
59	/** Job record terminal statuses (mirrors api/src/agents/jobs.ts isTerminal / patchJob writes):
60	 *  'completed' is success; 'failed' and 'cancelled' are failure; 'created'/'running' are in-flight. */
61	const TERMINAL_SUCCESS = 'completed';
62	const TERMINAL_FAILURE = new Set(['failed', 'cancelled']);
63	
64	/** PT-PT copy for the edit flow. Kept here so the panel and the tests share one source
65	 *  of truth for the confirmation wording, the progress fallback and the empty-diff note. */
66	export const EDIT_COPY = {
67	  confirm: 'Vou preparar esta alteração como uma revisão. Confirma?',
68	  preparing: 'A preparar a alteração...',
69	  applied: 'Alteração aplicada. Reveja antes de aprovar.',
70	  noChange: 'A revisão terminou sem alterações ao código.',
71	  approved: 'Alteração mantida.',
72	  rolledBack: 'Alteração revertida.',
73	  // The build did not reach a terminal state within the poll deadline (a dropped stream + a slow
74	  // build). NOT a failure and NOT a false "no change": tell the admin it is still running.
75	  stillRunning: 'A revisão ainda está em curso. Verifique novamente dentro de momentos.',
76	  // The head moved between the preview and the Reverter click (another admin / a dashboard action /
77	  // a later restore). Refuse the rollback rather than wipe that unrelated change; ask for a refresh.
78	  headAdvanced: 'A aplicação foi alterada entretanto; atualize a pré-visualização.',
79	};
80	
81	/** Map a mid-flow platform failure onto a calm PT-PT message (graceful degradation).
82	 *  401 = the admin's session expired; 403 = writability was lost (no longer an editor);
83	 *  404 = the app is gone / not writable; anything else = a generic, non-alarming line. */
84	export function degradeMessage(status) {
85	  if (status === 401) return 'A sua sessão expirou. Inicie sessão novamente para continuar a editar.';
86	  if (status === 403) return 'Já não tem permissão para editar esta aplicação.';
87	  if (status === 404) return 'Esta aplicação já não está disponível para edição.';
88	  return 'Não foi possível concluir a alteração. Tente novamente mais tarde.';
89	}
90	
91	/** A client-side correlation id for the follow-up build. A follow-up does NOT reserve a
92	 *  session (only a first build does); sessionId merely tags the job record + run, so a
93	 *  fresh per-edit id is correct and collision-safe. */
94	export function newEditSessionId(appId) {
95	  const rand = Math.random().toString(36).slice(2, 10);
96	  return `edit-${appId || 'app'}-${Date.now()}-${rand}`;
97	}
98	
99	/**
100	 * Parse accumulated SSE text into the complete events plus the unparsed remainder. An SSE
101	 * event is terminated by a blank line; the job stream carries its JobEvent JSON on
102	 * `data:` lines (other fields - `id:`, `event:`, `:` comments - are ignored). The caller
103	 * accumulates `rest` and feeds it back with the next chunk, so a frame split across chunk
104	 * boundaries is never dropped. A garbled/partial frame is skipped, never thrown.
105	 */
106	export function parseSseBuffer(buffer) {
107	  const events = [];
108	  const normalised = String(buffer || '').replace(/\r\n/g, '\n');
109	  const chunks = normalised.split('\n\n');
110	  const rest = chunks.pop() || ''; // trailing, possibly incomplete frame stays buffered
111	  for (const chunk of chunks) {
112	    const dataLines = chunk.split('\n').filter((l) => l.startsWith('data:'));
113	    if (!dataLines.length) continue;
114	    const payload = dataLines.map((l) => l.slice(5).trimStart()).join('\n');
115	    if (!payload) continue;
116	    try {
117	      events.push(JSON.parse(payload));
118	    } catch {
119	      /* a partial or garbled frame - skip it, never crash the stream */
120	    }
121	  }
122	  return { events, rest };
123	}
124	
125	/**
126	 * Start the follow-up build (the patch run) for `appId`. POSTs the H1-gated jobs endpoint
127	 * with the admin Bearer. Returns a discriminated result:
128	 *   - { ok:true, status:'created', jobId }  - the build was accepted (202)
129	 *   - { ok:true, status:'answered', reason} - the in-build classifier resolved it with no
130	 *                                             job (e.g. it read the request as a question)
131	 *   - { ok:false, status }                  - a refusal (401/403/404/409/...) → the panel
132	 *                                             degrades on `status`; the SERVER is the gate
133	 * Never throws - a network failure is { ok:false, status:0 }.
134	 */
135	export async function startEditJob({ fetchImpl, appId, token, description, sessionId }) {
136	  let res;
137	  try {
138	    res = await fetchImpl(JOBS_ENDPOINT, {
139	      method: 'POST',
140	      headers: {
141	        'Content-Type': 'application/json',
142	        Authorization: `Bearer ${token}`,
143	      },
144	      body: JSON.stringify({
145	        kind: 'build',
146	        description,
147	        sessionId: sessionId || newEditSessionId(appId),
148	        language: 'pt',
149	        artifactId: appId,
150	      }),
151	    });
152	  } catch {
153	    return { ok: false, status: 0 };
154	  }
155	  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
156	  let data = null;
157	  try {
158	    data = await res.json();
159	  } catch {
160	    data = null;
161	  }
162	  if (data && data.status === 'answered') {
163	    return { ok: true, status: 'answered', reason: typeof data.reason === 'string' ? data.reason : '' };
164	  }
165	  const jobId = data && data.job && typeof data.job.id === 'string' ? data.job.id : undefined;
166	  if (!jobId) return { ok: false, status: res.status };
167	  return { ok: true, status: 'created', jobId };
168	}
169	
170	/**
171	 * Read the artifact's version list. Returns { ok:true, items, head } where `head` is the
172	 * newest commit sha (items[0].sha) or undefined for a fresh repo, or { ok:false, status }
173	 * on a refusal. Never throws.
174	 */
175	export async function readVersions({ fetchImpl, appId, token }) {
176	  let res;
177	  try {
178	    res = await fetchImpl(versionsEndpoint(appId), {
179	      method: 'GET',
180	      headers: { Authorization: `Bearer ${token}` },
181	    });
182	  } catch {
183	    return { ok: false, status: 0 };
184	  }
185	  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
186	  let data = null;
187	  try {
188	    data = await res.json();
189	  } catch {
190	    data = null;
191	  }
192	  const items = data && Array.isArray(data.items) ? data.items : [];
193	  const head = items.length && items[0] && typeof items[0].sha === 'string' ? items[0].sha : undefined;
194	  return { ok: true, items, head };
195	}
196	
197	/**
198	 * Forward-restore the artifact to `sha` (one-click rollback to the pre-run head). Returns
199	 * { ok:true, newHeadSha } or { ok:false, status } on a refusal. Never throws.
200	 */
201	export async function rollbackToVersion({ fetchImpl, appId, token, sha }) {
202	  let res;
203	  try {
204	    res = await fetchImpl(restoreEndpoint(appId, sha), {
205	      method: 'POST',
206	      headers: { Authorization: `Bearer ${token}` },
207	    });
208	  } catch {
209	    return { ok: false, status: 0 };
210	  }
211	  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
212	  let data = null;
213	  try {
214	    data = await res.json();
215	  } catch {
216	    data = null;
217	  }
218	  const newHeadSha = data && typeof data.newHeadSha === 'string' ? data.newHeadSha : undefined;
219	  return { ok: true, newHeadSha };
220	}
221	
222	/**
223	 * One-click rollback, GUARDED against a stale target (M2). Reverter forward-restores to the pre-run
224	 * head; a blind restore would silently WIPE any change that moved HEAD between the preview and the
225	 * click (another admin, a dashboard action, a later restore). So before restoring: RE-READ the
226	 * versions and require HEAD to still be EXACTLY the head THIS edit produced (`expectedHeadSha`), and
227	 * require the pre-run target to still exist in history. If HEAD advanced or the target is gone, the
228	 * rollback is REFUSED (no restore call) so the panel can show a calm "refresh the preview" message.
229	 * Returns:
230	 *   - { ok:true, newHeadSha }             - restore fired to the pre-run head
231	 *   - { ok:false, reason:'head-advanced' }- HEAD is no longer this edit's head (someone else changed it)
232	 *   - { ok:false, reason:'target-missing'}- the pre-run target sha is no longer in the history
233	 *   - { ok:false, status }                - a mid-flow refusal reading versions / restoring
234	 */
235	export async function guardedRollback({ fetchImpl, appId, token, preRunSha, expectedHeadSha }) {
236	  const cur = await readVersions({ fetchImpl, appId, token });
237	  if (!cur.ok) return { ok: false, status: cur.status };
238	  // HEAD must still be the exact head this edit produced - else a concurrent change moved it.
239	  if (cur.head !== expectedHeadSha) return { ok: false, reason: 'head-advanced' };
240	  // The pre-run target must still exist (hardening: never restore to a sha the history dropped).
241	  const hasTarget = Array.isArray(cur.items) && cur.items.some((v) => v && v.sha === preRunSha);
242	  if (!hasTarget) return { ok: false, reason: 'target-missing' };
243	  return rollbackToVersion({ fetchImpl, appId, token, sha: preRunSha });
244	}
245	
246	/**
247	 * Consume the job SSE stream with fetch, forwarding each JobEvent to `onEvent`, and
248	 * resolve once a terminal event lands (or the stream ends). Outcomes:
249	 *   - { outcome:'complete', event } - the build finished
250	 *   - { outcome:'error', event }    - the build failed (JobEvent error)
251	 *   - { outcome:'http-error', status } - the stream endpoint refused (e.g. token expired)
252	 *   - { outcome:'closed' }          - the stream ended / a network blip with no terminal
253	 *                                     event (the caller re-reads versions to see the head)
254	 * Never throws.
255	 */
256	export async function streamJobEvents({ fetchImpl, jobId, token, onEvent, signal }) {
257	  let res;
258	  try {
259	    res = await fetchImpl(jobEventsUrl(jobId, token), {
260	      method: 'GET',
261	      ...(signal ? { signal } : {}),
262	    });
263	  } catch {
264	    return { outcome: 'closed' };
265	  }
266	  if (!res || !res.ok) return { outcome: 'http-error', status: res ? res.status : 0 };
267	  const body = res.body;
268	  if (!body || typeof body.getReader !== 'function') return { outcome: 'closed' };
269	
270	  const reader = body.getReader();
271	  const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
272	  let buffer = '';
273	  try {
274	    for (;;) {
275	      const { value, done } = await reader.read();
276	      if (done) break;
277	      buffer += decoder ? decoder.decode(value, { stream: true }) : String(value || '');
278	      const parsed = parseSseBuffer(buffer);
279	      buffer = parsed.rest;
280	      for (const ev of parsed.events) {
281	        if (onEvent) onEvent(ev);
282	        if (ev && ev.type === 'complete') {
283	          try { await reader.cancel(); } catch { /* already closing */ }
284	          return { outcome: 'complete', event: ev };
285	        }
286	        if (ev && ev.type === 'error') {
287	          try { await reader.cancel(); } catch { /* already closing */ }
288	          return { outcome: 'error', event: ev };
289	        }
290	      }
291	    }
292	  } catch {
293	    /* aborted (unmount / timeout) or read error → treated as a soft close */
294	  }
295	  return { outcome: 'closed' };
296	}
297	
298	/** Fetch + parse JSON WITHOUT throwing (mirrors the e2e safeJson idiom): a non-2xx status or a body
299	 *  that is not valid JSON (e.g. the dev-proxy's text/plain "proxy error" 502) comes back as
300	 *  { ok:false, status, json:null } rather than an exception, so the poll below can class blips. */
301	async function safeJson(fetchImpl, url, init) {
302	  try {
303	    const r = await fetchImpl(url, init);
304	    if (!r) return { ok: false, status: 0, json: null };
305	    let json = null;
306	    try { json = await r.json(); } catch { json = null; }
307	    return { ok: !!r.ok && json !== null, status: r.status, json };
308	  } catch {
309	    return { ok: false, status: 0, json: null };
310	  }
311	}
312	
313	/**
314	 * Poll GET /api/v1/jobs/:id until the JOB RECORD reaches a terminal status - the AUTHORITATIVE
315	 * "did the build finish?" signal (the SSE is only live progress and can drop on a proxy/network
316	 * blip while the build keeps running and then activates a new head). Transient-tolerant, exactly
317	 * like the fees-knowledge e2e build poll: a deterministic 4xx (auth/route/store - will not
318	 * self-heal) degrades on its status; a 5xx / non-JSON / network blip is tolerated up to a bounded
319	 * count; the deadline yields `pending` (still running, not a false "done"). Outcomes:
320	 *   - { outcome:'terminal', status:'completed', job } | { outcome:'terminal', status:'failed', job }
321	 *   - { outcome:'degraded', status } - a real 4xx, or too many transients
322	 *   - { outcome:'pending' }          - the deadline passed with no terminal status
323	 * `now`/`sleep` are injectable so the flow is testable without real timers.
324	 */
325	export async function pollJobUntilTerminal({
326	  fetchImpl,
327	  jobId,
328	  token,
329	  pollMs = 3000,
330	  deadlineMs = 20 * 60 * 1000,
331	  maxTransients = 30,
332	  now = () => Date.now(),
333	  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
334	  signal,
335	}) {
336	  const init = { method: 'GET', headers: { Authorization: `Bearer ${token}` }, ...(signal ? { signal } : {}) };
337	  const deadline = now() + deadlineMs;
338	  let transients = 0;
339	  for (;;) {
340	    if (now() > deadline) return { outcome: 'pending' };
341	    const res = await safeJson(fetchImpl, jobEndpoint(jobId), init);
342	    if (!res.ok) {
343	      // A deterministic 4xx (auth/route/store) will not self-heal; retrying only masks it -> degrade.
344	      if (res.status >= 400 && res.status < 500) return { outcome: 'degraded', status: res.status };
345	      // 5xx / non-JSON / network (proxy-502 blips) are transient -> tolerate a bounded number.
346	      transients += 1;
347	      if (transients > maxTransients) return { outcome: 'degraded', status: res.status || 0 };
348	      await sleep(pollMs);
349	      continue;
350	    }
351	    transients = 0;
352	    const status = res.json && typeof res.json.status === 'string' ? res.json.status : undefined;
353	    if (status === TERMINAL_SUCCESS) return { outcome: 'terminal', status: 'completed', job: res.json };
354	    if (status && TERMINAL_FAILURE.has(status)) return { outcome: 'terminal', status: 'failed', job: res.json };
355	    await sleep(pollMs);
356	  }
357	}
358	
359	/**
360	 * Run the whole confirmed patch, front-to-back, as a sequence of the H1-gated platform calls.
361	 * Returns a discriminated result the panel maps straight onto its UI; every network refusal is a
362	 * graceful outcome, never a throw:
363	 *   - { outcome:'ready', preRunSha, newHeadSha } - build CONFIRMED completed; show APPROVE vs ROLLBACK
364	 *   - { outcome:'answered', reason }             - no job (in-build classifier answered)
365	 *   - { outcome:'failed', job }                  - the JOB reached a terminal failure status
366	 *   - { outcome:'pending' }                      - the poll deadline passed (still running)
367	 *   - { outcome:'degraded', status }             - a mid-flow 401/403/404/... → calm msg
368	 *
369	 * `onProgress(jobEvent)` receives each streamed JobEvent (the panel narrates plan_step).
370	 *
371	 * The SSE is streamed ONLY for live progress; it is NOT treated as terminal (M1): a blip that
372	 * closes the stream before `complete` would otherwise read as "no change" while the build finishes
373	 * moments later and deploys a real edit. So after the stream ends (or drops), the JOB RECORD is
374	 * polled to a terminal status, and only a CONFIRMED 'completed' reads the new head for the preview.
375	 */
376	export async function runEditPatch({
377	  fetchImpl,
378	  appId,
379	  token,
380	  description,
381	  onProgress,
382	  signal,
383	  pollMs,
384	  deadlineMs,
385	  maxTransients,
386	  now,
387	  sleep,
388	}) {
389	  // 1. Capture the pre-run head BEFORE the build - the rollback target and diff point.
390	  const before = await readVersions({ fetchImpl, appId, token });
391	  if (!before.ok) return { outcome: 'degraded', status: before.status };
392	  const preRunSha = before.head;
393	
394	  // 2. Start the follow-up build (the H1-gated patch run).
395	  const started = await startEditJob({
396	    fetchImpl,
397	    appId,
398	    token,
399	    description,
400	    sessionId: newEditSessionId(appId),
401	  });
402	  if (!started.ok) return { outcome: 'degraded', status: started.status };
403	  if (started.status === 'answered') return { outcome: 'answered', reason: started.reason };
404	
405	  // 3. Stream the job SSE for LIVE progress only (best-effort). A dropped stream is NOT terminal.
406	  await streamJobEvents({
407	    fetchImpl,
408	    jobId: started.jobId,
409	    token,
410	    signal,
411	    onEvent: (ev) => {
412	      if (onProgress) onProgress(ev);
413	    },
414	  });
415	
416	  // 4. AUTHORITATIVELY confirm the build finished by polling the job record (transient-tolerant).
417	  const poll = await pollJobUntilTerminal({ fetchImpl, jobId: started.jobId, token, pollMs, deadlineMs, maxTransients, now, sleep, signal });
418	  if (poll.outcome === 'degraded') return { outcome: 'degraded', status: poll.status };
419	  if (poll.outcome === 'pending') return { outcome: 'pending' };
420	  if (poll.status === 'failed') return { outcome: 'failed', job: poll.job };
421	
422	  // 5. Job CONFIRMED completed -> the versions read now reflects the FINISHED build (never a
423	  //    mid-build snapshot). An unchanged head here is a true "no change".
424	  const after = await readVersions({ fetchImpl, appId, token });
425	  if (!after.ok) return { outcome: 'degraded', status: after.status };
426	  return { outcome: 'ready', preRunSha, newHeadSha: after.head, jobId: started.jobId };
427	}
428	
429	/** A one-line PT-PT narration for a streamed JobEvent (plan_step primarily). Returns null
430	 *  for events with nothing worth showing, so the panel keeps the last meaningful line. */
431	export function progressLine(ev) {
432	  if (!ev || typeof ev !== 'object') return null;
433	  if (ev.type === 'plan_step') {
434	    const text = ev.description || ev.detail || ev.status;
435	    return typeof text === 'string' && text ? text : null;
436	  }
437	  if (ev.type === 'routing') return 'A preparar a alteração...';
438	  return null;
439	}
440	

codex
I’ve confirmed the code paths for the two fixes. One last pass is on the opt-in/detection invariants and the panel-side rollback wiring, so the closeout can state whether those prior guarantees stayed intact after the patch.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '120,240p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   120	  const values = (a && (a.input || a.params)) || {};
   121	  if (a && a.action && typeof a.action === 'object') {
   122	    return { ...a.action, params: values };
   123	  }
   124	  const id =
   125	    a && typeof a.toolName === 'string'
   126	      ? a.toolName.replace(/^app_action__/, '').replace(/_/g, '-')
   127	      : undefined;
   128	  return { id, toolName: a && a.toolName, params: values };
   129	}
   130	
   131	/** A short PT-PT status line for one action run. */
   132	function runLabel(status) {
   133	  switch (status) {
   134	    case 'running':
   135	      return 'A executar...';
   136	    case 'done':
   137	      return 'Ação executada.';
   138	    case 'cancelled':
   139	      return 'Ação cancelada.';
   140	    case 'unavailable':
   141	      return 'Ação indisponível nesta pré-visualização.';
   142	    default:
   143	      return 'Não foi possível executar a ação.';
   144	  }
   145	}
   146	
   147	function SendIcon() {
   148	  return (
   149	    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
   150	      <path d="M22 2 11 13" />
   151	      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
   152	    </svg>
   153	  );
   154	}
   155	
   156	function CloseIcon() {
   157	  return (
   158	    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
   159	      <path d="M18 6 6 18" />
   160	      <path d="m6 6 12 12" />
   161	    </svg>
   162	  );
   163	}
   164	
   165	function ChatIcon() {
   166	  return (
   167	    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
   168	      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
   169	    </svg>
   170	  );
   171	}
   172	
   173	/** PT-PT status line for a non-stepping tour phase (playing/awaiting show the copy). */
   174	function tourStatusText(status) {
   175	  switch (status) {
   176	    case 'loading':
   177	      return 'A carregar o tutorial...';
   178	    case 'awaiting':
   179	      return 'Aguardando a sua ação na aplicação...';
   180	    case 'done':
   181	      return 'Tutorial concluído.';
   182	    case 'error':
   183	      return 'Não foi possível carregar o tutorial guiado.';
   184	    default:
   185	      return '';
   186	  }
   187	}
   188	
   189	/**
   190	 * The tour block rendered in the panel while a same-document tour plays. The
   191	 * on-page highlight/tooltip is drawn by the C3 runtime (window.__ekoaActions
   192	 * spotlight); this block carries the step counter, the narration, and the
   193	 * Seguinte / Sair controls. It exposes data-tour-status + data-tour-step-index for
   194	 * the deterministic live gate. No emoji; brand-neutral via the panel CSS vars.
   195	 */
   196	function TourView({ tour, onNext, onClose }) {
   197	  const { status, stepIndex, total, copy, imageUrl, imageBlocked, injectedPrompt } = tour;
   198	  const stepping = status === 'playing' || status === 'awaiting';
   199	  const stepNo = total > 0 ? Math.min(stepIndex + 1, total) : 0;
   200	  const statusLine = tourStatusText(status);
   201	  return (
   202	    <section
   203	      className="ekoa-assistant-tour"
   204	      data-tour-status={status}
   205	      data-tour-step-index={stepIndex}
   206	      aria-label="Tutorial guiado"
   207	    >
   208	      <div className="ekoa-assistant-tour-head">
   209	        <span className="ekoa-assistant-tour-title">Tutorial guiado</span>
   210	        {stepping && total > 0 ? (
   211	          <span className="ekoa-assistant-tour-progress">{`Passo ${stepNo} de ${total}`}</span>
   212	        ) : null}
   213	      </div>
   214	
   215	      {copy ? (
   216	        <div className="ekoa-assistant-tour-copy">
   217	          {copy.titlePt ? <div className="ekoa-assistant-tour-copy-title">{copy.titlePt}</div> : null}
   218	          {copy.bodyPt ? <div className="ekoa-assistant-tour-copy-body">{copy.bodyPt}</div> : null}
   219	        </div>
   220	      ) : null}
   221	
   222	      {injectedPrompt ? (
   223	        <div className="ekoa-assistant-tour-note">
   224	          Sugestão colocada na caixa de mensagem, para rever antes de enviar.
   225	        </div>
   226	      ) : null}
   227	
   228	      {imageUrl ? <img className="ekoa-assistant-tour-image" src={imageUrl} alt="" /> : null}
   229	
   230	      {imageBlocked ? (
   231	        <div className="ekoa-assistant-tour-note">Imagem ignorada (caminho não permitido).</div>
   232	      ) : null}
   233	
   234	      {statusLine ? <div className="ekoa-assistant-tour-status">{statusLine}</div> : null}
   235	
   236	      <div className="ekoa-assistant-tour-controls">
   237	        {stepping ? (
   238	          <button type="button" className="ekoa-assistant-tour-next" onClick={onNext}>
   239	            Seguinte
   240	          </button>

exec
/bin/zsh -lc "nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '560,620p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   560	  const onExample = useCallback((example) => {
   561	    setMode(example.mode);
   562	    setDraft(example.prompt);
   563	    if (textareaRef.current) textareaRef.current.focus();
   564	  }, []);
   565	
   566	  const onKeyDown = useCallback(
   567	    (e) => {
   568	      // Enter sends; Shift+Enter is a newline.
   569	      if (e.key === 'Enter' && !e.shiftKey) {
   570	        e.preventDefault();
   571	        void send();
   572	      }
   573	    },
   574	    [send],
   575	  );
   576	
   577	  // ---- H3 edit mode (admins only) -----------------------------------------
   578	  // A thin front-end over the H1-gated follow-up-build machinery. The SERVER is the
   579	  // authority (can(canEditApps) + loadWritable on every call); the panel only decides
   580	  // whether to SHOW the affordance (admin) and drives the confirmed flow. Every mid-flow
   581	  // 401/403/404 lands on a calm PT-PT message via degradeMessage - never a crash.
   582	
   583	  /** Turn edit mode ON. An EXPLICIT admin action (switch or discovery CTA) - the only way
   584	   *  edit mode is ever entered. Detection never calls this (detect-then-ask). */
   585	  const openEditMode = useCallback(() => {
   586	    setEditMode(true);
   587	    setDiscoveryDismissed(true); // opting in dismisses the discovery banner
   588	    setEditPhase('compose');
   589	  }, []);
   590	
   591	  /** Turn edit mode OFF and clear the whole edit flow (back to a clean compose state). */
   592	  const closeEditMode = useCallback(() => {
   593	    setEditMode(false);
   594	    setEditPhase('compose');
   595	    setEditDraft('');
   596	    setEditPreview(null);
   597	    setEditMessage('');
   598	    setEditProgress('');
   599	    setEditBusy(false);
   600	  }, []);
   601	
   602	  /** Dismiss the discovery banner without entering edit mode. */
   603	  const dismissDiscovery = useCallback(() => setDiscoveryDismissed(true), []);
   604	
   605	  /** compose -> confirm: the panel asks the admin to confirm the intent before any build. */
   606	  const askEditConfirm = useCallback(() => {
   607	    if (editDraft.trim()) setEditPhase('confirm');
   608	  }, [editDraft]);
   609	
   610	  /** confirm -> compose: step back without running anything. */
   611	  const cancelEditConfirm = useCallback(() => setEditPhase('compose'), []);
   612	
   613	  /** note -> compose: start a fresh edit after a terminal message. */
   614	  const resetEdit = useCallback(() => {
   615	    setEditPhase('compose');
   616	    setEditDraft('');
   617	    setEditPreview(null);
   618	    setEditMessage('');
   619	    setEditProgress('');
   620	  }, []);

exec
/bin/zsh -lc "nl -ba api/tests/apps/assistant-panel.test.ts | sed -n '360,520p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/tests/apps/edit-mode.test.ts | sed -n '1,360p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	import { describe, it, expect, beforeAll } from 'vitest';
     2	import { readFileSync } from 'node:fs';
     3	import { fileURLToPath } from 'node:url';
     4	
     5	/**
     6	 * H3 edit mode (admins only) - BEHAVIOURAL unit tests of the panel's edit-flow controller
     7	 * (api/assets/panel-runtime/src/edit-mode.js). That controller is a browser ASSET compiled by
     8	 * esbuild (outside the tsc program), so it is imported at RUNTIME via its file URL and driven with
     9	 * a FAKE fetch - proving the real network flow, not just its source text:
    10	 *   - the confirmed patch run POSTs /api/v1/jobs { kind:'build', artifactId, description } with the
    11	 *     admin platform Bearer (a follow-up build over the H1-gated machinery - reused, not rebuilt);
    12	 *   - the pre-run head is captured BEFORE the run (the rollback target / diff point);
    13	 *   - rollback POSTs /api/v1/artifacts/:id/versions/:sha/restore (one click, the pre-run head);
    14	 *   - a mid-flow 401/403/404 resolves to a calm PT-PT message (graceful degradation, never a throw);
    15	 *   - the job SSE is parsed frame-by-frame (even split across chunk boundaries) into progress.
    16	 * The heavy end-to-end (a REAL patch run editing a real app + rollback) is the lead's live probe;
    17	 * here the flow is unit-proven. Every call targets the PLATFORM /api/v1/* plane with the admin
    18	 * Bearer - a SEPARATE plane from the visitor-blind POST /api/app-assistant.
    19	 */
    20	
    21	// The controller is plain JS (a compiled-by-esbuild browser asset), so tsc cannot resolve it as a
    22	// typed module; import it at runtime by URL and describe only the shape these tests exercise.
    23	type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown };
    24	type FetchImpl = (url: string, init?: FetchInit) => Promise<unknown>;
    25	interface JobEvent { type: string; [k: string]: unknown }
    26	type Sleep = (ms: number) => Promise<void>;
    27	interface EditModeApi {
    28	  JOBS_ENDPOINT: string;
    29	  versionsEndpoint(appId: string): string;
    30	  restoreEndpoint(appId: string, sha: string): string;
    31	  jobEventsUrl(jobId: string, token: string): string;
    32	  jobEndpoint(jobId: string): string;
    33	  degradeMessage(status: number): string;
    34	  parseSseBuffer(buffer: string): { events: JobEvent[]; rest: string };
    35	  newEditSessionId(appId: string): string;
    36	  EDIT_COPY: Record<string, string>;
    37	  progressLine(ev: unknown): string | null;
    38	  startEditJob(a: { fetchImpl: FetchImpl; appId: string; token: string; description: string; sessionId?: string }): Promise<{ ok: boolean; status?: number | string; jobId?: string; reason?: string }>;
    39	  readVersions(a: { fetchImpl: FetchImpl; appId: string; token: string }): Promise<{ ok: boolean; status?: number; items?: unknown[]; head?: string }>;
    40	  rollbackToVersion(a: { fetchImpl: FetchImpl; appId: string; token: string; sha: string }): Promise<{ ok: boolean; status?: number; newHeadSha?: string }>;
    41	  guardedRollback(a: { fetchImpl: FetchImpl; appId: string; token: string; preRunSha?: string; expectedHeadSha?: string }): Promise<{ ok: boolean; status?: number; newHeadSha?: string; reason?: string }>;
    42	  streamJobEvents(a: { fetchImpl: FetchImpl; jobId: string; token: string; onEvent?: (ev: JobEvent) => void; signal?: unknown }): Promise<{ outcome: string; status?: number; event?: JobEvent }>;
    43	  pollJobUntilTerminal(a: { fetchImpl: FetchImpl; jobId: string; token: string; pollMs?: number; deadlineMs?: number; maxTransients?: number; now?: () => number; sleep?: Sleep; signal?: unknown }): Promise<{ outcome: string; status?: number | string; job?: unknown }>;
    44	  runEditPatch(a: { fetchImpl: FetchImpl; appId: string; token: string; description: string; onProgress?: (ev: JobEvent) => void; signal?: unknown; pollMs?: number; deadlineMs?: number; now?: () => number; sleep?: Sleep }): Promise<{ outcome: string; status?: number; preRunSha?: string; newHeadSha?: string; reason?: string; job?: unknown }>;
    45	}
    46	
    47	/** A no-op sleep so the poll loop never waits on a real timer in tests. */
    48	const noSleep: Sleep = async () => {};
    49	
    50	const MODULE_URL = new URL('../../assets/panel-runtime/src/edit-mode.js', import.meta.url);
    51	const MODULE_SRC = readFileSync(fileURLToPath(MODULE_URL), 'utf-8');
    52	
    53	let em: EditModeApi;
    54	beforeAll(async () => {
    55	  em = (await import(/* @vite-ignore */ MODULE_URL.href)) as unknown as EditModeApi;
    56	});
    57	
    58	// --- fake-fetch harness ----------------------------------------------------------------------
    59	interface Recorded { url: string; method: string; headers: Record<string, string>; body?: string }
    60	const enc = new TextEncoder();
    61	
    62	/** A minimal streaming body (getReader) that yields the given SSE frames as UTF-8 chunks. */
    63	function sseBody(frames: string[]) {
    64	  let i = 0;
    65	  return {
    66	    getReader() {
    67	      return {
    68	        read: async () => (i < frames.length ? { value: enc.encode(frames[i++]), done: false } : { value: undefined, done: true }),
    69	        cancel: async () => {},
    70	      };
    71	    },
    72	  };
    73	}
    74	function jsonRes(status: number, data: unknown) {
    75	  return { ok: status >= 200 && status < 300, status, json: async () => data };
    76	}
    77	
    78	/**
    79	 * A scenario fetch: records every call and answers per-endpoint. `versionsHeads` supplies the head
    80	 * sha for successive /versions reads (runEditPatch reads twice: pre-run then post-run).
    81	 */
    82	function scenario(opts: {
    83	  versionsHeads?: string[];
    84	  versionsItems?: Array<Array<{ sha: string }>>;
    85	  versionsStatus?: number;
    86	  jobs?: { status: number; data?: unknown };
    87	  jobStatus?: string[]; // successive GET /jobs/:id statuses (M1 poll); default 'completed'
    88	  restore?: { status: number; data?: unknown };
    89	  sseFrames?: string[];
    90	  sseStatus?: number;
    91	}) {
    92	  const calls: Recorded[] = [];
    93	  let versionsIdx = 0;
    94	  let jobPollIdx = 0;
    95	  const fetchImpl: FetchImpl = async (url, init = {}) => {
    96	    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    97	    if (url === em.JOBS_ENDPOINT) {
    98	      const j = opts.jobs || { status: 202, data: { status: 'created', job: { id: 'job-1', status: 'running' } } };
    99	      return jsonRes(j.status, j.data ?? {});
   100	    }
   101	    if (url.includes('/jobs/') && url.includes('/events')) {
   102	      if (opts.sseStatus) return jsonRes(opts.sseStatus, {});
   103	      return { ok: true, status: 200, body: sseBody(opts.sseFrames || ['data: {"type":"complete","durationMs":10}\n\n']) };
   104	    }
   105	    if (url.startsWith('/api/v1/jobs/')) {
   106	      // GET /jobs/:id status poll (M1): the AUTHORITATIVE terminal signal. Successive statuses.
   107	      const seq = opts.jobStatus || ['completed'];
   108	      const s = seq[Math.min(jobPollIdx, seq.length - 1)];
   109	      jobPollIdx += 1;
   110	      return jsonRes(200, {
   111	        id: 'job-1',
   112	        status: s,
   113	        ...(s === 'completed' ? { artifactId: 'app' } : {}),
   114	        ...(s === 'failed' ? { error: { code: 'BUILD_FAILED', message: 'boom' } } : {}),
   115	      });
   116	    }
   117	    if (url.includes('/versions/') && url.endsWith('/restore')) {
   118	      const r = opts.restore || { status: 200, data: { newHeadSha: 'restored-head' } };
   119	      return jsonRes(r.status, r.data ?? {});
   120	    }
   121	    if (url.endsWith('/versions')) {
   122	      if (opts.versionsStatus) return jsonRes(opts.versionsStatus, {});
   123	      if (opts.versionsItems) {
   124	        const items = opts.versionsItems[Math.min(versionsIdx, opts.versionsItems.length - 1)];
   125	        versionsIdx += 1;
   126	        return jsonRes(200, { items });
   127	      }
   128	      const heads = opts.versionsHeads || ['head-a', 'head-b'];
   129	      const head = heads[Math.min(versionsIdx, heads.length - 1)];
   130	      versionsIdx += 1;
   131	      return jsonRes(200, { items: [{ sha: head }, { sha: 'older-1' }] });
   132	    }
   133	    return jsonRes(404, {});
   134	  };
   135	  return { fetchImpl, calls };
   136	}
   137	
   138	const jobPolls = (calls: Recorded[]) => calls.filter((c) => c.url.startsWith('/api/v1/jobs/') && !c.url.includes('/events'));
   139	const versionReads = (calls: Recorded[]) => calls.filter((c) => c.url.endsWith('/versions'));
   140	
   141	describe('H3 edit-mode controller - endpoints + copy (the admin /api/v1/* plane)', () => {
   142	  it('builds the platform version + restore + job-event paths (encoded)', () => {
   143	    expect(em.JOBS_ENDPOINT).toBe('/api/v1/jobs');
   144	    expect(em.versionsEndpoint('app 1')).toBe('/api/v1/artifacts/app%201/versions');
   145	    expect(em.restoreEndpoint('app1', 'sha/x')).toBe('/api/v1/artifacts/app1/versions/sha%2Fx/restore');
   146	    expect(em.jobEventsUrl('job1', 't ok')).toBe('/api/v1/jobs/job1/events?token=t%20ok');
   147	    expect(em.jobEndpoint('job 1')).toBe('/api/v1/jobs/job%201'); // the M1 status-poll target
   148	  });
   149	
   150	  it('degradeMessage maps 401/403/404 to distinct calm PT-PT lines (no emoji, no em/en-dash)', () => {
   151	    const m401 = em.degradeMessage(401);
   152	    const m403 = em.degradeMessage(403);
   153	    const m404 = em.degradeMessage(404);
   154	    const mOther = em.degradeMessage(500);
   155	    for (const m of [m401, m403, m404, mOther]) {
   156	      expect(typeof m).toBe('string');
   157	      expect(m.length).toBeGreaterThan(0);
   158	      expect(m).not.toMatch(/[–—]/); // no en/em dash
   159	      expect(m.match(/\p{Extended_Pictographic}/u)).toBeNull(); // no emoji
   160	    }
   161	    // 401 (expired session) and 403 (lost writability) read differently.
   162	    expect(m401).not.toBe(m403);
   163	    expect(m401).toMatch(/sess/i);
   164	  });
   165	
   166	  it('EDIT_COPY.confirm is the PT-PT confirmation step', () => {
   167	    expect(em.EDIT_COPY.confirm).toContain('revisão');
   168	    expect(em.EDIT_COPY.confirm).toContain('Confirma');
   169	  });
   170	
   171	  it('the controller source carries no emoji (UI-code rule)', () => {
   172	    expect(MODULE_SRC.match(/\p{Extended_Pictographic}/u)).toBeNull();
   173	  });
   174	});
   175	
   176	describe('H3 startEditJob - the follow-up build (POST /jobs, H1-gated)', () => {
   177	  it('POSTs /api/v1/jobs { kind:build, artifactId, description } with the admin Bearer', async () => {
   178	    const { fetchImpl, calls } = scenario({});
   179	    const r = await em.startEditJob({ fetchImpl, appId: 'app-42', token: 'TKN', description: 'adicione um botão' });
   180	    expect(r).toEqual({ ok: true, status: 'created', jobId: 'job-1' });
   181	    const post = calls.find((c) => c.url === '/api/v1/jobs');
   182	    expect(post).toBeTruthy();
   183	    expect(post!.method).toBe('POST');
   184	    expect(post!.headers.Authorization).toBe('Bearer TKN'); // the platform admin JWT
   185	    const body = JSON.parse(post!.body || '{}');
   186	    expect(body.kind).toBe('build'); // a build job (a follow-up edits an existing app)
   187	    expect(body.artifactId).toBe('app-42'); // targets THIS app (server re-gates writability)
   188	    expect(body.description).toBe('adicione um botão');
   189	    expect(body.language).toBe('pt');
   190	    expect(typeof body.sessionId).toBe('string'); // a correlation tag (follow-ups reserve nothing)
   191	    expect(body.sessionId.length).toBeGreaterThan(0);
   192	  });
   193	
   194	  it('honours the SERVER gate: a 403/404 refusal returns ok:false + the status (front-end degrades)', async () => {
   195	    const forbidden = scenario({ jobs: { status: 403, data: { error: { code: 'FORBIDDEN' } } } });
   196	    expect(await em.startEditJob({ fetchImpl: forbidden.fetchImpl, appId: 'a', token: 'T', description: 'x' })).toEqual({ ok: false, status: 403 });
   197	    const missing = scenario({ jobs: { status: 404, data: {} } });
   198	    expect(await em.startEditJob({ fetchImpl: missing.fetchImpl, appId: 'a', token: 'T', description: 'x' })).toEqual({ ok: false, status: 404 });
   199	  });
   200	
   201	  it('surfaces an in-build classifier answer (no job created) as status:answered', async () => {
   202	    const { fetchImpl } = scenario({ jobs: { status: 200, data: { status: 'answered', reason: 'question' } } });
   203	    const r = await em.startEditJob({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
   204	    expect(r).toEqual({ ok: true, status: 'answered', reason: 'question' });
   205	  });
   206	});
   207	
   208	describe('H3 runEditPatch - the confirmed patch flow', () => {
   209	  it('captures the pre-run head BEFORE the build, streams progress, and returns the new head for preview', async () => {
   210	    const { fetchImpl, calls } = scenario({
   211	      versionsHeads: ['before-sha', 'after-sha'],
   212	      sseFrames: [
   213	        'data: {"type":"ready","jobId":"job-1"}\n\n',
   214	        'data: {"type":"plan_step","status":"running","description":"A editar a tabela de honorários"}\n\n',
   215	        'data: {"type":"complete","durationMs":1200}\n\n',
   216	      ],
   217	    });
   218	    const progress: string[] = [];
   219	    const r = await em.runEditPatch({
   220	      fetchImpl,
   221	      appId: 'app-42',
   222	      token: 'TKN',
   223	      description: 'adicione um botão de exportação',
   224	      sleep: noSleep,
   225	      onProgress: (ev) => {
   226	        const line = em.progressLine(ev);
   227	        if (line) progress.push(line);
   228	      },
   229	    });
   230	    expect(r.outcome).toBe('ready');
   231	    expect(r.preRunSha).toBe('before-sha'); // the rollback target / diff point
   232	    expect(r.newHeadSha).toBe('after-sha');
   233	    expect(progress).toContain('A editar a tabela de honorários'); // plan_step narration surfaced
   234	    // The JOB record was polled to a terminal status before the preview (M1): the new head reflects
   235	    // the CONFIRMED completed build, not a mid-build snapshot.
   236	    expect(jobPolls(calls).length).toBeGreaterThanOrEqual(1);
   237	
   238	    // ORDER matters: the pre-run version read must happen BEFORE the POST /jobs, so the rollback
   239	    // target is the head as it was before the patch.
   240	    const firstVersions = calls.findIndex((c) => c.url.endsWith('/versions'));
   241	    const jobsPost = calls.findIndex((c) => c.url === '/api/v1/jobs');
   242	    expect(firstVersions).toBeGreaterThanOrEqual(0);
   243	    expect(jobsPost).toBeGreaterThan(firstVersions);
   244	  });
   245	
   246	  it('a mid-flow 401 (expired session) on POST /jobs degrades calmly, never throws', async () => {
   247	    const { fetchImpl } = scenario({ jobs: { status: 401, data: {} } });
   248	    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
   249	    expect(r).toEqual({ outcome: 'degraded', status: 401 });
   250	    // the panel maps this straight to a calm PT-PT line
   251	    expect(em.degradeMessage(r.status!)).toMatch(/sess/i);
   252	  });
   253	
   254	  it('a 403 on the pre-run versions read (lost writability) degrades calmly', async () => {
   255	    const { fetchImpl, calls } = scenario({ versionsStatus: 403 });
   256	    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
   257	    expect(r).toEqual({ outcome: 'degraded', status: 403 });
   258	    // it never reached the build: no POST /jobs was issued.
   259	    expect(calls.some((c) => c.url === '/api/v1/jobs')).toBe(false);
   260	  });
   261	
   262	  it('a job that reaches terminal FAILED status resolves to outcome:failed', async () => {
   263	    // M1: failure is AUTHORITATIVE from the job record, not the SSE. Even with an error frame on the
   264	    // stream, the terminal decision is the polled job status.
   265	    const { fetchImpl } = scenario({
   266	      jobStatus: ['failed'],
   267	      sseFrames: ['data: {"type":"error","code":"BUILD_FAILED","message":"boom"}\n\n'],
   268	    });
   269	    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x', sleep: noSleep });
   270	    expect(r.outcome).toBe('failed');
   271	  });
   272	
   273	  it('an answered follow-up (no job) resolves to outcome:answered', async () => {
   274	    const { fetchImpl } = scenario({ jobs: { status: 200, data: { status: 'answered', reason: 'question' } } });
   275	    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x', sleep: noSleep });
   276	    expect(r.outcome).toBe('answered');
   277	  });
   278	
   279	  // ---- M1: an SSE early-close must NOT read as "done"; the job status is the arbiter ------------
   280	  it('M1: an SSE that closes WITHOUT a terminal event polls the job to completion (no false no-change)', async () => {
   281	    // The stream carries progress but NO complete/error frame (a proxy/network blip). The build then
   282	    // finishes (poll running -> completed) and activates a NEW head. runEditPatch must poll the job
   283	    // record and only preview the CONFIRMED completed build - never treat the early close as done and
   284	    // report the unchanged pre-run head as "no change".
   285	    const { fetchImpl, calls } = scenario({
   286	      sseFrames: ['data: {"type":"plan_step","status":"go","description":"a editar a tabela"}\n\n'], // no terminal
   287	      jobStatus: ['running', 'completed'],
   288	      versionsHeads: ['before', 'after'],
   289	    });
   290	    const progress: string[] = [];
   291	    const r = await em.runEditPatch({
   292	      fetchImpl,
   293	      appId: 'app-42',
   294	      token: 'TKN',
   295	      description: 'x',
   296	      sleep: noSleep,
   297	      onProgress: (ev) => {
   298	        const line = em.progressLine(ev);
   299	        if (line) progress.push(line);
   300	      },
   301	    });
   302	    expect(r.outcome).toBe('ready');
   303	    expect(r.newHeadSha).toBe('after'); // reflects the build that completed AFTER the blip
   304	    expect(r.preRunSha).toBe('before');
   305	    expect(jobPolls(calls).length).toBe(2); // polled running, then completed
   306	    expect(progress).toContain('a editar a tabela'); // progress still surfaced off the (dropped) stream
   307	    // the post-run head read happened AFTER the job was confirmed completed
   308	    const lastVersions = calls.map((c) => c.url).lastIndexOf('/api/v1/artifacts/app-42/versions');
   309	    const lastJobPoll = calls.reduce((acc, c, i) => (c.url.startsWith('/api/v1/jobs/') && !c.url.includes('/events') ? i : acc), -1);
   310	    expect(lastVersions).toBeGreaterThan(lastJobPoll);
   311	  });
   312	
   313	  it('M1: a build still running at the poll deadline returns pending (never a false ready/no-change)', async () => {
   314	    const { fetchImpl, calls } = scenario({ jobStatus: ['running'], versionsHeads: ['before', 'before'] });
   315	    let t = 1000;
   316	    const now = () => t;
   317	    const sleep: Sleep = async () => {
   318	      t += 1000; // each poll interval advances the clock so the bounded deadline is reached
   319	    };
   320	    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x', now, sleep, deadlineMs: 50 });
   321	    expect(r.outcome).toBe('pending');
   322	    // it did NOT read a post-run head (no false preview): only the pre-run versions read happened.
   323	    expect(versionReads(calls).length).toBe(1);
   324	  });
   325	});
   326	
   327	describe('H3 pollJobUntilTerminal - transient-tolerant job-status poll (M1)', () => {
   328	  it('tolerates a transient 502 / non-JSON blip, then returns the completed terminal status', async () => {
   329	    let n = 0;
   330	    const fetchImpl: FetchImpl = async () => {
   331	      n += 1;
   332	      if (n === 1) return { ok: false, status: 502, json: async () => { throw new Error('proxy error (text/plain)'); } };
   333	      return jsonRes(200, { id: 'job-1', status: 'completed', artifactId: 'app' });
   334	    };
   335	    const r = await em.pollJobUntilTerminal({ fetchImpl, jobId: 'job-1', token: 'T', sleep: noSleep });
   336	    expect(r.outcome).toBe('terminal');
   337	    expect(r.status).toBe('completed');
   338	  });
   339	
   340	  it('degrades on a deterministic 401 (no endless retry masking an auth failure)', async () => {
   341	    const fetchImpl: FetchImpl = async () => jsonRes(401, { error: { code: 'UNAUTHENTICATED' } });
   342	    const r = await em.pollJobUntilTerminal({ fetchImpl, jobId: 'job-1', token: 'T', sleep: noSleep });
   343	    expect(r).toMatchObject({ outcome: 'degraded', status: 401 });
   344	  });
   345	
   346	  it('treats a cancelled job as a terminal failure', async () => {
   347	    const fetchImpl: FetchImpl = async () => jsonRes(200, { id: 'job-1', status: 'cancelled' });
   348	    const r = await em.pollJobUntilTerminal({ fetchImpl, jobId: 'job-1', token: 'T', sleep: noSleep });
   349	    expect(r).toMatchObject({ outcome: 'terminal', status: 'failed' });
   350	  });
   351	});
   352	
   353	describe('H3 rollbackToVersion - one-click restore to the pre-run head', () => {
   354	  it('POSTs /api/v1/artifacts/:id/versions/:sha/restore with the admin Bearer', async () => {
   355	    const { fetchImpl, calls } = scenario({});
   356	    const r = await em.rollbackToVersion({ fetchImpl, appId: 'app-42', token: 'TKN', sha: 'before-sha' });
   357	    expect(r).toEqual({ ok: true, newHeadSha: 'restored-head' });
   358	    const post = calls.find((c) => c.url.endsWith('/restore'));
   359	    expect(post).toBeTruthy();
   360	    expect(post!.url).toBe('/api/v1/artifacts/app-42/versions/before-sha/restore');

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/tests/apps/edit-mode.test.ts | sed -n '360,460p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   360	    expect(post!.url).toBe('/api/v1/artifacts/app-42/versions/before-sha/restore');
   361	    expect(post!.method).toBe('POST');
   362	    expect(post!.headers.Authorization).toBe('Bearer TKN');
   363	  });
   364	
   365	  it('a 404 on restore degrades calmly (ok:false + status)', async () => {
   366	    const { fetchImpl } = scenario({ restore: { status: 404, data: {} } });
   367	    const r = await em.rollbackToVersion({ fetchImpl, appId: 'a', token: 'T', sha: 's' });
   368	    expect(r).toEqual({ ok: false, status: 404 });
   369	  });
   370	});
   371	
   372	describe('H3 guardedRollback - refuse a stale rollback (M2)', () => {
   373	  it('restores to the pre-run head ONLY when HEAD is still the head THIS edit produced', async () => {
   374	    // Current HEAD (items[0].sha) is still 'after' (the edit head), and the pre-run target 'before'
   375	    // is still in history -> the guarded rollback fires restore to 'before'.
   376	    const { fetchImpl, calls } = scenario({ versionsItems: [[{ sha: 'after' }, { sha: 'before' }, { sha: 'older' }]] });
   377	    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
   378	    expect(r).toEqual({ ok: true, newHeadSha: 'restored-head' });
   379	    const restore = calls.find((c) => c.url.endsWith('/restore'));
   380	    expect(restore!.url).toBe('/api/v1/artifacts/app-42/versions/before/restore');
   381	    expect(restore!.headers.Authorization).toBe('Bearer TKN');
   382	  });
   383	
   384	  it('REFUSES (no restore fired) when HEAD advanced - a concurrent change would be wiped', async () => {
   385	    // Someone else moved HEAD to 'someone-else' between preview and the Reverter click. Restoring to
   386	    // 'before' would silently wipe that change, so the guard refuses.
   387	    const { fetchImpl, calls } = scenario({ versionsItems: [[{ sha: 'someone-else' }, { sha: 'after' }, { sha: 'before' }]] });
   388	    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
   389	    expect(r).toEqual({ ok: false, reason: 'head-advanced' });
   390	    expect(calls.some((c) => c.url.endsWith('/restore'))).toBe(false); // NO blind restore
   391	  });
   392	
   393	  it('REFUSES (no restore fired) when the pre-run target sha is gone from history', async () => {
   394	    const { fetchImpl, calls } = scenario({ versionsItems: [[{ sha: 'after' }, { sha: 'older' }]] });
   395	    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
   396	    expect(r).toEqual({ ok: false, reason: 'target-missing' });
   397	    expect(calls.some((c) => c.url.endsWith('/restore'))).toBe(false);
   398	  });
   399	
   400	  it('degrades (ok:false + status) when the versions re-read itself is refused', async () => {
   401	    const { fetchImpl } = scenario({ versionsStatus: 403 });
   402	    const r = await em.guardedRollback({ fetchImpl, appId: 'app-42', token: 'TKN', preRunSha: 'before', expectedHeadSha: 'after' });
   403	    expect(r).toEqual({ ok: false, status: 403 });
   404	  });
   405	});
   406	
   407	describe('H3 parseSseBuffer - job SSE frame parsing', () => {
   408	  it('parses complete frames, ignores non-data lines, and buffers a partial trailing frame', () => {
   409	    const buf = ': keep-alive\n\nid: 1\ndata: {"type":"ready","jobId":"j"}\n\ndata: {"type":"plan_step","status":"go"}\n\ndata: {"type":"comp';
   410	    const { events, rest } = em.parseSseBuffer(buf);
   411	    expect(events.map((e) => e.type)).toEqual(['ready', 'plan_step']);
   412	    expect(rest).toContain('"type":"comp'); // the incomplete frame stays buffered
   413	  });
   414	
   415	  it('reassembles a frame split across two chunk reads', () => {
   416	    const a = em.parseSseBuffer('data: {"type":"plan_');
   417	    expect(a.events).toEqual([]);
   418	    const b = em.parseSseBuffer(a.rest + 'step","status":"x"}\n\n');
   419	    expect(b.events).toEqual([{ type: 'plan_step', status: 'x' }]);
   420	  });
   421	});

exec
/bin/zsh -lc 'rg -n "setEditMode|detect|openEditMode|visitor|guardedRollback|runEditPatch|/api/app-assistant|headAdvanced|Reverter|stillRunning" api/tests/apps/assistant-panel.test.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
12: * first-open copy, the three mode labels, the /api/app-assistant fetch with the
63:  it('POSTs to /api/app-assistant with the X-Ekoa-App-Id header read from window.__EKOA_APP_ID', () => {
64:    expect(PANEL).toContain('/api/app-assistant');
116:describe('H2 admin detection (detect-then-ask)', () => {
129:  it('calls GET /api/app-assistant/whoami exactly ONCE, on mount, with X-Ekoa-App-Id + an OPTIONAL Bearer', () => {
131:    expect(PANEL).toContain('/api/app-assistant/whoami');
134:    // A mount-only, once-guarded detection (no per-render loop; idempotent under StrictMode).
147:  it('a false detection renders NO admin affordance (the indicator is gated on admin)', () => {
162:    // `admin` is SET once (the detection) and READ only to render the badge — it drives no action.
164:    // H3 now introduces the edit-mode switch (setEditMode), but detect-then-ask still binds: the
169:    expect(whoamiEffect).not.toContain('setEditMode');
171:    expect(PANEL).toContain('detect-then-ask');
175:  it('detection is zero-token: whoami is a non-LLM GET, never an assistant turn', () => {
176:    // The detection path must not post to the assistant endpoint or dispatch actions.
180:    // The zero-token invariant is stated on the detection effect so review can pin it.
185:describe('H3 edit mode (admins only) — opt-in switch + detect-then-ask wiring', () => {
188:    expect(PANEL).toMatch(/const \[editMode, setEditMode\] = useState\(false\)/);
189:    // The admin bar (which holds the switch) is rendered only when detection said admin.
199:    // The edit section renders only for an admin who has opted in — not from detection alone.
203:    // Kept visually distinct from the visitor OPERAR/MOSTRAR/ENSINAR modes so an admin always knows.
207:  it('DETECT-THEN-ASK is binding: edit mode is entered ONLY by an explicit click, never by detection', () => {
208:    // setEditMode(true) is reachable through exactly one path: openEditMode (the explicit opt-in).
209:    expect(PANEL).toContain('const openEditMode');
210:    expect(PANEL).toMatch(/openEditMode[\s\S]{0,120}setEditMode\(true\)/);
211:    // The only setEditMode(true) in the file is inside that explicit handler — detection cannot flip it.
212:    expect((PANEL.match(/setEditMode\(true\)/g) || []).length).toBe(1);
213:    // openEditMode is wired to click handlers (the switch + the discovery CTA), never to an effect.
214:    expect((PANEL.match(/onClick=\{[^}]*openEditMode/g) || []).length).toBeGreaterThanOrEqual(1);
217:    expect(whoamiEffect).not.toContain('setEditMode');
218:    expect(whoamiEffect).not.toContain('openEditMode');
222:    // Shown only to a detected admin who has not opted in and not dismissed it.
229:    expect(PANEL).toMatch(/discovery-cta[\s\S]{0,80}onClick=\{openEditMode\}/);
232:  it('the edit flow uses the PLATFORM /api/v1/* plane (via edit-mode), NOT the visitor assistant endpoint', () => {
235:    expect(PANEL).toContain('runEditPatch'); // POST /api/v1/jobs (the H1-gated follow-up build)
236:    expect(PANEL).toContain('guardedRollback'); // guarded POST /api/v1/artifacts/:id/versions/:sha/restore
239:    expect(PANEL).toMatch(/const confirmEdit[\s\S]{0,700}runEditPatch/);
240:    // The served-app POST /api/app-assistant plane stays visitor-blind: the edit handlers never
241:    // route through ENDPOINT. runEditPatch/guardedRollback drive the /api/v1/* plane instead.
244:    expect(confirmEdit).not.toContain('/api/app-assistant');
253:    expect(PANEL).toMatch(/const rollbackEdit[\s\S]{0,700}guardedRollback/);
260:    expect(PANEL).toContain('EDIT_COPY.stillRunning');
263:  it('M2: Reverter re-checks HEAD before restoring and refuses a stale rollback with a calm message', () => {
264:    // The rollback passes BOTH the pre-run target AND the head this edit produced, so guardedRollback
266:    expect(PANEL).toMatch(/guardedRollback\(\{[\s\S]{0,200}expectedHeadSha/);
268:    expect(PANEL).toContain('EDIT_COPY.headAdvanced');
269:    // Reverter is only offered when there is a pre-run head to restore to.

exec
/bin/zsh -lc "wc -l api/tests/apps/assistant-panel.test.ts && nl -ba api/tests/apps/assistant-panel.test.ts | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     315 api/tests/apps/assistant-panel.test.ts
     1	import { describe, it, expect } from 'vitest';
     2	import { readFileSync, existsSync } from 'node:fs';
     3	import { fileURLToPath } from 'node:url';
     4	
     5	/**
     6	 * operator-run D2 — the operator assistant PANEL that mounts into every app-base app
     7	 * (lazy-loaded as a platform runtime asset since operator-run G2).
     8	 *
     9	 * The panel is a React/JSX browser asset compiled platform-side into the panel-runtime
    10	 * (api/assets/panel-runtime, served at /__ekoa/panel-runtime.js) - not in the vitest
    11	 * module stack - so this suite asserts its SOURCE contract: the three-capability PT-PT
    12	 * first-open copy, the three mode labels, the /api/app-assistant fetch with the
    13	 * X-Ekoa-App-Id header, the window.__ekoaActions.execute dispatch for the assistant's
    14	 * proposed actions, the "Fontes" citations rendering, no emoji, and the lazy-load
    15	 * wiring: the app bundle's plain-DOM launcher (mount.js) loads the asset, whose entry
    16	 * (index.jsx) self-mounts into #ekoa-assistant-root, node-guarded and once-only. The
    17	 * full behavioural loop lands in D3's live gate; the lazy-load perf invariants live in
    18	 * tests/e2e/panel-perf.e2e.mjs + tests/apps/panel-lazy.test.ts.
    19	 */
    20	
    21	const SCAFFOLD = new URL('../../assets/bases/app/scaffold/frontend/src/', import.meta.url);
    22	const PANEL_SRC = new URL('../../assets/panel-runtime/src/', import.meta.url);
    23	const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, SCAFFOLD)), 'utf-8');
    24	const readPanel = (rel: string) => readFileSync(fileURLToPath(new URL(rel, PANEL_SRC)), 'utf-8');
    25	
    26	const PANEL_PATH = fileURLToPath(new URL('AssistantPanel.jsx', PANEL_SRC));
    27	const PANEL = readFileSync(PANEL_PATH, 'utf-8');
    28	const CSS = readPanel('AssistantPanel.css');
    29	const ENTRY = readPanel('index.jsx'); // the panel-runtime self-mounting entry
    30	const MOUNT = read('lib/assistant/mount.js'); // the app-bundle plain-DOM launcher
    31	const INDEX = read('index.jsx');
    32	const SKILL = readFileSync(
    33	  fileURLToPath(new URL('../../assets/bases/app/skills/using-the-assistant-panel.md', import.meta.url)),
    34	  'utf-8',
    35	);
    36	
    37	describe('D2 assistant panel — files exist', () => {
    38	  it('the panel + css + entry ship in the platform panel-runtime; the launcher ships in the app scaffold', () => {
    39	    expect(existsSync(PANEL_PATH)).toBe(true);
    40	    expect(PANEL.length).toBeGreaterThan(0);
    41	    expect(CSS.length).toBeGreaterThan(0);
    42	    expect(ENTRY.length).toBeGreaterThan(0);
    43	    expect(MOUNT.length).toBeGreaterThan(0);
    44	  });
    45	});
    46	
    47	describe('D2 panel source contract', () => {
    48	  it('states the three capabilities with PT-PT example prompts on first open', () => {
    49	    expect(PANEL).toContain('Dê-me uma visão geral da aplicação'); // Mostrar / show
    50	    expect(PANEL).toContain('Mostre-me um tutorial'); // Ensinar / teach
    51	    expect(PANEL).toContain('Adicione um novo registo'); // Operar / do (operate)
    52	  });
    53	
    54	  it('offers the three mode labels (Operar / Mostrar / Ensinar) mapped to do/show/teach', () => {
    55	    expect(PANEL).toContain('Operar');
    56	    expect(PANEL).toContain('Mostrar');
    57	    expect(PANEL).toContain('Ensinar');
    58	    expect(PANEL).toMatch(/id:\s*'do'/);
    59	    expect(PANEL).toMatch(/id:\s*'show'/);
    60	    expect(PANEL).toMatch(/id:\s*'teach'/);
    61	  });
    62	
    63	  it('POSTs to /api/app-assistant with the X-Ekoa-App-Id header read from window.__EKOA_APP_ID', () => {
    64	    expect(PANEL).toContain('/api/app-assistant');
    65	    expect(PANEL).toContain('X-Ekoa-App-Id');
    66	    expect(PANEL).toContain('window.__EKOA_APP_ID');
    67	    expect(PANEL).toMatch(/method:\s*'POST'/);
    68	    // the request carries message + history + mode + context (route + recent action results)
    69	    expect(PANEL).toContain('history');
    70	    // bounded turn cost + a hung turn can never lock the composer (codex-d2 #2/#3)
    71	    expect(PANEL).toMatch(/MAX_HISTORY_TURNS/);
    72	    expect(PANEL).toMatch(/AbortController/);
    73	    expect(PANEL).toMatch(/FETCH_TIMEOUT_MS/);
    74	    expect(PANEL).toContain('context');
    75	    expect(PANEL).toContain('actionResults');
    76	  });
    77	
    78	  it('dispatches each proposed action through window.__ekoaActions.execute (never on its own)', () => {
    79	    expect(PANEL).toContain('window.__ekoaActions');
    80	    expect(PANEL).toMatch(/\.execute\(/);
    81	    expect(PANEL).toContain('data.actions'); // only ever the actions the assistant returned
    82	    expect(PANEL).toContain('A executar...'); // the subtle in-flight state
    83	    // the D1 enrichment drives the SERVER-resolved manifest action with the model's
    84	    // input as VALUES - the exact transform, not a client-side reconstruction
    85	    expect(PANEL).toContain('{ ...a.action, params: values }');
    86	  });
    87	
    88	  it('renders a "Fontes" citation list from response.citations', () => {
    89	    expect(PANEL).toContain('Fontes');
    90	    expect(PANEL).toContain('citations');
    91	    expect(PANEL).toContain('collection');
    92	    expect(PANEL).toContain('title');
    93	  });
    94	
    95	  it('renders a calm PT-PT message on an endpoint error / missing runtime (never a crash)', () => {
    96	    expect(PANEL).toContain('O assistente está indisponível de momento.');
    97	    // execute() is guarded when the runtime is absent (standalone preview)
    98	    expect(PANEL).toMatch(/typeof runtime\.execute !== 'function'/);
    99	  });
   100	
   101	  it('does not autofocus on mount (never steals focus from the app)', () => {
   102	    // No JSX autoFocus attribute anywhere; imperative .focus() exists but only behind
   103	    // explicit user intent (open / example click), never at render.
   104	    expect(PANEL).not.toMatch(/autoFocus/);
   105	    expect(PANEL).toContain('user intent');
   106	  });
   107	
   108	  it('contains NO emoji (UI-code rule) — panel and css', () => {
   109	    const inPanel = PANEL.match(/\p{Extended_Pictographic}/u);
   110	    expect(inPanel, inPanel ? `panel emoji: ${JSON.stringify(inPanel[0])}` : '').toBeNull();
   111	    const inCss = CSS.match(/\p{Extended_Pictographic}/u);
   112	    expect(inCss, inCss ? `css emoji: ${JSON.stringify(inCss[0])}` : '').toBeNull();
   113	  });
   114	});
   115	
   116	describe('H2 admin detection (detect-then-ask)', () => {
   117	  it('reads the platform token DEFENSIVELY from localStorage (try/catch, swallow to null)', () => {
   118	    // The panel reads the SAME key web/lib/api/token.ts uses; a cross-origin / sandboxed iframe
   119	    // throws a SecurityError on localStorage access, so the read is wrapped and degrades to null.
   120	    expect(PANEL).toContain('ekoa_token');
   121	    expect(PANEL).toContain('readPlatformToken');
   122	    expect(PANEL).toContain('getItem(TOKEN_STORAGE_KEY)');
   123	    // The defensive read has a try/catch that returns null (no crash on a cross-origin iframe).
   124	    const helper = PANEL.slice(PANEL.indexOf('function readPlatformToken'), PANEL.indexOf('function readPlatformToken') + 500);
   125	    expect(helper).toMatch(/try\s*\{/);
   126	    expect(helper).toMatch(/catch\s*\{[\s\S]*return null/);
   127	  });
   128	
   129	  it('calls GET /api/app-assistant/whoami exactly ONCE, on mount, with X-Ekoa-App-Id + an OPTIONAL Bearer', () => {
   130	    // The endpoint literal lives once (in the WHOAMI_ENDPOINT constant); the fetch uses the const.
   131	    expect(PANEL).toContain('/api/app-assistant/whoami');
   132	    expect((PANEL.match(/\/api\/app-assistant\/whoami/g) || []).length).toBe(1);
   133	    expect(PANEL).toContain('WHOAMI_ENDPOINT');
   134	    // A mount-only, once-guarded detection (no per-render loop; idempotent under StrictMode).
   135	    expect(PANEL).toContain('whoamiDoneRef');
   136	    expect(PANEL).toContain('whoamiDoneRef.current = true');
   137	    // It is a GET carrying the app id; the platform Bearer is attached only when readable.
   138	    const effect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
   139	    expect(effect).toContain('WHOAMI_ENDPOINT');
   140	    expect(effect).toMatch(/method:\s*'GET'/);
   141	    expect(effect).toContain("'X-Ekoa-App-Id': id");
   142	    expect(effect).toMatch(/token \? \{ Authorization: `Bearer \$\{token\}` \}/);
   143	    // The mount effect closes with an empty dependency array (runs once for the panel's lifetime).
   144	    expect(effect).toMatch(/\},\s*\[\]\);/);
   145	  });
   146	
   147	  it('a false detection renders NO admin affordance (the indicator is gated on admin)', () => {
   148	    // admin defaults false (fail-closed) and the discreet indicator is conditionally rendered:
   149	    // false -> null (nothing on screen), true -> the quiet "Administrador" badge.
   150	    expect(PANEL).toMatch(/const \[admin, setAdmin\] = useState\(false\)/);
   151	    expect(PANEL).toContain('Administrador');
   152	    expect(PANEL).toMatch(/\{admin \? \(/);
   153	    // The whole badge block is guarded by `admin ? (...) : null`, so nothing renders when false.
   154	    const header = PANEL.slice(PANEL.indexOf('ekoa-assistant-titlegroup'), PANEL.indexOf('ekoa-assistant-close'));
   155	    expect(header).toMatch(/admin \? \([\s\S]*\) : null/);
   156	  });
   157	
   158	  it('DETECT-THEN-ASK: admin:true never auto-enables anything (no edit mode, no privileged call)', () => {
   159	    // The indicator is inert: no click handler, no mode change, no fetch driven by `admin`.
   160	    const badge = PANEL.slice(PANEL.indexOf('ekoa-assistant-admin-badge'), PANEL.indexOf('Administrador') + 20);
   161	    expect(badge).not.toContain('onClick');
   162	    // `admin` is SET once (the detection) and READ only to render the badge — it drives no action.
   163	    expect((PANEL.match(/setAdmin\(/g) || []).length).toBe(1);
   164	    // H3 now introduces the edit-mode switch (setEditMode), but detect-then-ask still binds: the
   165	    // DETECTION effect never enables edit mode — it only sets `admin`. (The full H3 opt-in invariants
   166	    // are pinned in the "H3 edit mode" block below.)
   167	    const whoamiEffect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
   168	    expect(whoamiEffect).toContain('setAdmin');
   169	    expect(whoamiEffect).not.toContain('setEditMode');
   170	    // The invariant is stated in the source so review can pin it.
   171	    expect(PANEL).toContain('detect-then-ask');
   172	    expect(PANEL).toContain('H3');
   173	  });
   174	
   175	  it('detection is zero-token: whoami is a non-LLM GET, never an assistant turn', () => {
   176	    // The detection path must not post to the assistant endpoint or dispatch actions.
   177	    const effect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
   178	    expect(effect).not.toContain('runActions');
   179	    expect(effect).not.toMatch(/method:\s*'POST'/);
   180	    // The zero-token invariant is stated on the detection effect so review can pin it.
   181	    expect(PANEL).toContain('zero-token');
   182	  });
   183	});
   184	
   185	describe('H3 edit mode (admins only) — opt-in switch + detect-then-ask wiring', () => {
   186	  it('the edit-mode switch is ABSENT unless admin, and starts OFF (opt-in, fail-closed)', () => {
   187	    // editMode starts false: entering edit mode is never the default — it is an explicit opt-in.
   188	    expect(PANEL).toMatch(/const \[editMode, setEditMode\] = useState\(false\)/);
   189	    // The admin bar (which holds the switch) is rendered only when detection said admin.
   190	    expect(PANEL).toContain('ekoa-assistant-adminbar');
   191	    expect(PANEL).toMatch(/\{admin \? \(/); // admin-gated block
   192	    // The switch is a real accessible toggle reflecting editMode.
   193	    expect(PANEL).toContain('ekoa-assistant-editswitch');
   194	    expect(PANEL).toMatch(/role="switch"/);
   195	    expect(PANEL).toMatch(/aria-checked=\{editMode\}/);
   196	  });
   197	
   198	  it('enabling the switch reveals the edit affordance (gated on admin && editMode)', () => {
   199	    // The edit section renders only for an admin who has opted in — not from detection alone.
   200	    expect(PANEL).toMatch(/admin && editMode \? \(/);
   201	    expect(PANEL).toContain('ekoa-assistant-edit'); // the distinct edit section
   202	    expect(PANEL).toContain('data-edit-phase'); // its phase machine (compose→confirm→running→preview→note)
   203	    // Kept visually distinct from the visitor OPERAR/MOSTRAR/ENSINAR modes so an admin always knows.
   204	    expect(PANEL).toContain('Modo de edição');
   205	  });
   206	
   207	  it('DETECT-THEN-ASK is binding: edit mode is entered ONLY by an explicit click, never by detection', () => {
   208	    // setEditMode(true) is reachable through exactly one path: openEditMode (the explicit opt-in).
   209	    expect(PANEL).toContain('const openEditMode');
   210	    expect(PANEL).toMatch(/openEditMode[\s\S]{0,120}setEditMode\(true\)/);
   211	    // The only setEditMode(true) in the file is inside that explicit handler — detection cannot flip it.
   212	    expect((PANEL.match(/setEditMode\(true\)/g) || []).length).toBe(1);
   213	    // openEditMode is wired to click handlers (the switch + the discovery CTA), never to an effect.
   214	    expect((PANEL.match(/onClick=\{[^}]*openEditMode/g) || []).length).toBeGreaterThanOrEqual(1);
   215	    // The whoami DETECTION effect touches neither the switch nor the discovery state.
   216	    const whoamiEffect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
   217	    expect(whoamiEffect).not.toContain('setEditMode');
   218	    expect(whoamiEffect).not.toContain('openEditMode');
   219	  });
   220	
   221	  it('admin discovery is surfaced once, dismissibly, and NEVER auto-enables edit', () => {
   222	    // Shown only to a detected admin who has not opted in and not dismissed it.
   223	    expect(PANEL).toContain('ekoa-assistant-discovery');
   224	    expect(PANEL).toMatch(/admin && !editMode && !discoveryDismissed \? \(/);
   225	    // A concrete PT-PT suggestion (the conversion moment), plus a dismiss — non-blocking.
   226	    expect(PANEL).toContain('Pode pedir alterações a esta aplicação');
   227	    expect(PANEL).toContain('dismissDiscovery');
   228	    // The banner's CTA is the same explicit opt-in (a click), so it never auto-enables edit.
   229	    expect(PANEL).toMatch(/discovery-cta[\s\S]{0,80}onClick=\{openEditMode\}/);
   230	  });
   231	
   232	  it('the edit flow uses the PLATFORM /api/v1/* plane (via edit-mode), NOT the visitor assistant endpoint', () => {
   233	    // The edit machinery is the separate module (a follow-up build + versions/restore), imported here.
   234	    expect(PANEL).toContain("from './edit-mode'");
   235	    expect(PANEL).toContain('runEditPatch'); // POST /api/v1/jobs (the H1-gated follow-up build)
   236	    expect(PANEL).toContain('guardedRollback'); // guarded POST /api/v1/artifacts/:id/versions/:sha/restore
   237	    // The confirm step gates the patch run behind an explicit confirmation (PT-PT).
   238	    expect(PANEL).toContain('EDIT_COPY.confirm');
   239	    expect(PANEL).toMatch(/const confirmEdit[\s\S]{0,700}runEditPatch/);
   240	    // The served-app POST /api/app-assistant plane stays visitor-blind: the edit handlers never
   241	    // route through ENDPOINT. runEditPatch/guardedRollback drive the /api/v1/* plane instead.
   242	    const confirmEdit = PANEL.slice(PANEL.indexOf('const confirmEdit'), PANEL.indexOf('const approveEdit'));
   243	    expect(confirmEdit).not.toContain('ENDPOINT');
   244	    expect(confirmEdit).not.toContain('/api/app-assistant');
   245	  });
   246	
   247	  it('degrades gracefully on a mid-flow 401/403/404 (a calm PT-PT message, never a crash)', () => {
   248	    // The panel maps a degraded outcome onto degradeMessage and a terminal 'note' phase.
   249	    expect(PANEL).toContain('degradeMessage');
   250	    expect(PANEL).toMatch(/outcome === 'ready'/);
   251	    expect(PANEL).toMatch(/setEditPhase\('note'\)/);
   252	    // Rollback is one click and also degrades on a refusal rather than throwing.
   253	    expect(PANEL).toMatch(/const rollbackEdit[\s\S]{0,700}guardedRollback/);
   254	  });
   255	
   256	  it('M1: an early SSE close is not "done" - the preview waits on the confirmed job (pending stays calm)', () => {
   257	    // The panel surfaces the M1 outcomes: a still-running build after a dropped stream shows the calm
   258	    // "still running" note (never a false "no change"); a real preview only comes from outcome:ready.
   259	    expect(PANEL).toMatch(/outcome === 'pending'/);
   260	    expect(PANEL).toContain('EDIT_COPY.stillRunning');

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/tests/apps/assistant-panel.test.ts | sed -n '260,320p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   260	    expect(PANEL).toContain('EDIT_COPY.stillRunning');
   261	  });
   262	
   263	  it('M2: Reverter re-checks HEAD before restoring and refuses a stale rollback with a calm message', () => {
   264	    // The rollback passes BOTH the pre-run target AND the head this edit produced, so guardedRollback
   265	    // can refuse if HEAD advanced (a concurrent change) rather than blind-restoring and wiping it.
   266	    expect(PANEL).toMatch(/guardedRollback\(\{[\s\S]{0,200}expectedHeadSha/);
   267	    expect(PANEL).toMatch(/reason === 'head-advanced'/);
   268	    expect(PANEL).toContain('EDIT_COPY.headAdvanced');
   269	    // Reverter is only offered when there is a pre-run head to restore to.
   270	    expect(PANEL).toMatch(/editPreview\.preRunSha \? \(/);
   271	  });
   272	});
   273	
   274	describe('D2/G2 lazy-load wiring', () => {
   275	  it('the app bundle carries only a plain-DOM launcher (no React) that lazy-loads the platform panel-runtime', () => {
   276	    // Since G2 the panel is NOT baked into the app bundle: mount.js renders a launcher
   277	    // with plain DOM and injects the platform asset on interaction/idle. No React here.
   278	    expect(MOUNT).not.toMatch(/from\s+['"]react/);
   279	    expect(MOUNT).not.toContain('createRoot');
   280	    expect(MOUNT).toContain('ekoa-assistant-launcher'); // the launcher it renders
   281	    expect(MOUNT).toContain('/__ekoa/panel-runtime.js'); // the asset it lazy-loads
   282	    expect(MOUNT).toContain('__ekoaAssistantAutoOpen'); // open-intent handoff to the asset
   283	  });
   284	
   285	  it('the panel-runtime entry self-mounts into #ekoa-assistant-root, once, waiting for the node', () => {
   286	    // The three mount guards moved from the old in-bundle mount.js to the ASSET entry:
   287	    // #ekoa-assistant-root is rendered BY App and createRoot().render() commits async,
   288	    // so the node is absent the instant the asset runs. The entry polls (bounded) then
   289	    // gives up quietly (standalone preview), and mounts exactly once per document.
   290	    expect(ENTRY).toContain('ekoa-assistant-root');
   291	    expect(ENTRY).toContain('getElementById');
   292	    expect(ENTRY).toContain('__ekoaAssistantMounted'); // once-guard flag
   293	    expect(ENTRY).toMatch(/createRoot\(node\)\.render/);
   294	    expect(ENTRY).toContain('requestAnimationFrame');
   295	    expect(ENTRY).toContain('MAX_FRAMES');
   296	    expect(ENTRY).toMatch(/frames\s*>=\s*MAX_FRAMES/); // bounded give-up (no infinite spin)
   297	  });
   298	
   299	  it('index.jsx mounts the panel after rendering App (without changing the App render)', () => {
   300	    expect(INDEX).toContain('mountAssistant');
   301	    expect(INDEX).toContain("from './lib/assistant/mount'");
   302	    expect(INDEX).toContain('root.render(<App />)'); // the App render is untouched
   303	    // the mount call comes after the App render
   304	    expect(INDEX.indexOf('mountAssistant()')).toBeGreaterThan(INDEX.indexOf('root.render(<App />)'));
   305	  });
   306	});
   307	
   308	describe('D2 base skill', () => {
   309	  it('teaches that the panel is platform-shipped, not to be rebuilt, and to declare ui_actions', () => {
   310	    expect(SKILL).toContain('platform');
   311	    expect(SKILL).toContain('ui_actions');
   312	    expect(SKILL).toContain('declaring-ui-actions.md'); // cross-reference
   313	    expect(SKILL.match(/\p{Extended_Pictographic}/u)).toBeNull();
   314	  });
   315	});

hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"whoami|setAdmin|setEditMode\\(true\\)|const \\[editMode|admin && "'!editMode|admin && editMode|fetch'"\\(WHOAMI_ENDPOINT|ENDPOINT = '/api/app-assistant'|const confirmEdit|const rollbackEdit\" api/assets/panel-runtime/src/AssistantPanel.jsx" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
41:const ENDPOINT = '/api/app-assistant';
46:const WHOAMI_ENDPOINT = '/api/app-assistant/whoami';
84: *  nothing - the token is attached to the one whoami GET and never kept. */
273:  const [admin, setAdmin] = useState(false);
277:  // banner's CTA). Detection (setAdmin above) NEVER touches it - being an admin shows the switch,
279:  const [editMode, setEditMode] = useState(false);
298:  const whoamiDoneRef = useRef(false); // guards the once-only admin detection (H2)
326:    if (!id || whoamiDoneRef.current) return;
327:    whoamiDoneRef.current = true;
333:        const res = await fetch(WHOAMI_ENDPOINT, {
345:        setAdmin(!!(data && data.admin === true));
586:    setEditMode(true);
625:  const confirmEdit = useCallback(async () => {
685:  const rollbackEdit = useCallback(async () => {
804:      {admin && !editMode && !discoveryDismissed ? (
823:      {admin && editMode ? (

exec
/bin/zsh -lc "nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '300,420p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   300	  useEffect(() => {
   301	    messagesRef.current = messages;
   302	    // keep the newest turn in view
   303	    const el = listRef.current;
   304	    if (el) el.scrollTop = el.scrollHeight;
   305	  }, [messages]);
   306	
   307	  useEffect(() => {
   308	    // Auto-open handoff (G2): the visitor clicked the launcher, so the panel mounts
   309	    // already open - focus the composer once, matching an explicit open. Never runs
   310	    // on an idle-preloaded (collapsed) mount, so it never steals focus from the app.
   311	    if (defaultOpen && textareaRef.current) textareaRef.current.focus();
   312	    // Mount-only: the handoff intent is fixed at mount time.
   313	  }, [defaultOpen]);
   314	
   315	  // H2 admin DETECTION (detect-then-ask): ask the server ONCE, on mount, whether the current
   316	  // viewer is an admin of this app's owner org. Reads the platform token defensively (a
   317	  // cross-origin/sandboxed iframe throws) and attaches it as an OPTIONAL Bearer alongside the
   318	  // X-Ekoa-App-Id header the POST path already sends. This is a cheap non-LLM GET - it does NOT
   319	  // count as an assistant turn (zero-token invariant). The result only lights the discreet
   320	  // indicator; it NEVER auto-enables anything and issues no privileged call (edit mode is H3).
   321	  useEffect(() => {
   322	    const id = appId();
   323	    // No app id (standalone preview) or already detected once -> nothing to do. Empty deps make
   324	    // this a mount-only effect; the ref keeps detection to exactly ONE request per mounted panel
   325	    // even if the effect is ever re-entered. The panel-runtime entry mounts WITHOUT StrictMode.
   326	    if (!id || whoamiDoneRef.current) return;
   327	    whoamiDoneRef.current = true;
   328	
   329	    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
   330	    const token = readPlatformToken();
   331	    void (async () => {
   332	      try {
   333	        const res = await fetch(WHOAMI_ENDPOINT, {
   334	          method: 'GET',
   335	          ...(controller ? { signal: controller.signal } : {}),
   336	          headers: {
   337	            'X-Ekoa-App-Id': id,
   338	            // OPTIONAL: sent only when a same-origin token was readable. Absent -> the server
   339	            // fails closed to { admin: false }, so cross-origin dev simply shows no affordance.
   340	            ...(token ? { Authorization: `Bearer ${token}` } : {}),
   341	          },
   342	        });
   343	        if (!res.ok) return; // fail closed: stay non-admin on any non-200 (never an oracle anyway)
   344	        const data = await res.json();
   345	        setAdmin(!!(data && data.admin === true));
   346	      } catch {
   347	        // network error / aborted unmount / bad JSON -> stay non-admin. Detection is best-effort.
   348	      }
   349	    })();
   350	
   351	    return () => {
   352	      if (controller) controller.abort();
   353	    };
   354	    // Mount-only: detection is a one-shot for the panel's lifetime.
   355	    // eslint-disable-next-line react-hooks/exhaustive-deps
   356	  }, []);
   357	
   358	  const nextId = () => {
   359	    idRef.current += 1;
   360	    return idRef.current;
   361	  };
   362	
   363	  const patchTurn = useCallback((turnId, patch) => {
   364	    setMessages((prev) => prev.map((m) => (m.id === turnId ? { ...m, ...patch(m) } : m)));
   365	  }, []);
   366	
   367	  const recordResult = useCallback((result) => {
   368	    const buf = actionResultsRef.current;
   369	    buf.push(result);
   370	    if (buf.length > MAX_ACTION_RESULTS) buf.splice(0, buf.length - MAX_ACTION_RESULTS);
   371	  }, []);
   372	
   373	  // ---- E2 tour playback (same-document, zero-token) ------------------------
   374	  // Lazily build ONE client-side tour player. Its state drives the tour block in
   375	  // the panel; when a step surfaces a suggested prompt (inject-prompt) it lands in
   376	  // the composer - never auto-sent. No path here calls /api/app-assistant.
   377	  const ensurePlayer = useCallback(() => {
   378	    if (!playerRef.current) {
   379	      playerRef.current = createTourPlayer({
   380	        onState: (state) => {
   381	          setTour(state);
   382	          if (state && state.injectedPrompt) setDraft(state.injectedPrompt);
   383	        },
   384	      });
   385	    }
   386	    return playerRef.current;
   387	  }, []);
   388	
   389	  /** Start playing the app's guided tour in the page. Triggered by teach mode or a
   390	   *  startTour action. Fetches GET /api/demos/:appId inside the player - no model
   391	   *  turn is issued. `tourId` is forwarded for forward-compat (the route serves the
   392	   *  app's overview tour today). */
   393	  const startTourPlayback = useCallback(
   394	    (tourId) => {
   395	      const player = ensurePlayer();
   396	      setCollapsed(false);
   397	      void player.start(undefined, tourId);
   398	    },
   399	    [ensurePlayer],
   400	  );
   401	
   402	  const tourNext = useCallback(() => {
   403	    if (playerRef.current) playerRef.current.next();
   404	  }, []);
   405	
   406	  const tourClose = useCallback(() => {
   407	    if (playerRef.current) playerRef.current.cancel();
   408	    setTour(null);
   409	  }, []);
   410	
   411	  /** Collapse the panel. A tour is bound to the visible panel, so collapsing it
   412	   *  CANCELS any active tour (clears the on-page spotlight + aborts the run) rather
   413	   *  than leaving a ring on screen with no reachable controls. */
   414	  const collapsePanel = useCallback(() => {
   415	    if (playerRef.current) playerRef.current.cancel();
   416	    setTour(null);
   417	    setCollapsed(true);
   418	  }, []);
   419	
   420	  /** Run the assistant's proposed actions in order through the C3 runtime. The

codex
- CLOSED (M1) `runEditPatch` no longer trusts SSE close as terminal: after `streamJobEvents()` it always polls `GET /api/v1/jobs/:id` until `completed`/failure/timeout, and only on confirmed `completed` does it re-read versions and expose preview state; a dropped stream now yields either the later new head or `pending`, never a false “no change”. [api/assets/panel-runtime/src/edit-mode.js:325-357](api/assets/panel-runtime/src/edit-mode.js:325), [api/assets/panel-runtime/src/edit-mode.js:376-426](api/assets/panel-runtime/src/edit-mode.js:376), [api/assets/panel-runtime/src/AssistantPanel.jsx:625-669](api/assets/panel-runtime/src/AssistantPanel.jsx:625), [api/tests/apps/edit-mode.test.ts:279-349](api/tests/apps/edit-mode.test.ts:279)

- CLOSED (M2) rollback is now correctly compare-and-restore: it re-reads versions, requires current `HEAD === expectedHeadSha` (the post-edit head) and separately requires `preRunSha` (the restore target) to still exist before issuing restore; if HEAD advanced or target disappeared, it refuses and never sends the restore call, so a concurrent HEAD move is not wiped. [api/assets/panel-runtime/src/edit-mode.js:235-244](api/assets/panel-runtime/src/edit-mode.js:235), [api/assets/panel-runtime/src/AssistantPanel.jsx:685-710](api/assets/panel-runtime/src/AssistantPanel.jsx:685), [api/tests/apps/edit-mode.test.ts:372-404](api/tests/apps/edit-mode.test.ts:372)

- CLOSED (new-defect check) the new poll loop is bounded and the rollback guard fails closed: polling has both a wall-clock deadline and bounded transient retries, returns `pending`/`degraded` instead of looping forever, and `guardedRollback` returns `{ ok:false, status }` on versions re-read failure before any restore attempt. [api/assets/panel-runtime/src/edit-mode.js:329-348](api/assets/panel-runtime/src/edit-mode.js:329), [api/assets/panel-runtime/src/edit-mode.js:417-426](api/assets/panel-runtime/src/edit-mode.js:417), [api/assets/panel-runtime/src/edit-mode.js:236-243](api/assets/panel-runtime/src/edit-mode.js:236)

- CLOSED (invariants intact) detect-then-ask and visitor-blindness remain preserved: the whoami effect only sets `admin`, the only `setEditMode(true)` is the explicit `openEditMode` click path, and the edit handlers use `runEditPatch`/`guardedRollback` on the `/api/v1/*` plane rather than the visitor `POST /api/app-assistant` endpoint. [api/assets/panel-runtime/src/AssistantPanel.jsx:41](api/assets/panel-runtime/src/AssistantPanel.jsx:41), [api/assets/panel-runtime/src/AssistantPanel.jsx:315-356](api/assets/panel-runtime/src/AssistantPanel.jsx:315), [api/assets/panel-runtime/src/AssistantPanel.jsx:583-589](api/assets/panel-runtime/src/AssistantPanel.jsx:583), [api/assets/panel-runtime/src/AssistantPanel.jsx:625-710](api/assets/panel-runtime/src/AssistantPanel.jsx:625), [api/assets/panel-runtime/src/AssistantPanel.jsx:804-823](api/assets/panel-runtime/src/AssistantPanel.jsx:804)

VERDICT: APPROVE
hook: Stop
hook: Stop Completed
tokens used
79,483
- CLOSED (M1) `runEditPatch` no longer trusts SSE close as terminal: after `streamJobEvents()` it always polls `GET /api/v1/jobs/:id` until `completed`/failure/timeout, and only on confirmed `completed` does it re-read versions and expose preview state; a dropped stream now yields either the later new head or `pending`, never a false “no change”. [api/assets/panel-runtime/src/edit-mode.js:325-357](api/assets/panel-runtime/src/edit-mode.js:325), [api/assets/panel-runtime/src/edit-mode.js:376-426](api/assets/panel-runtime/src/edit-mode.js:376), [api/assets/panel-runtime/src/AssistantPanel.jsx:625-669](api/assets/panel-runtime/src/AssistantPanel.jsx:625), [api/tests/apps/edit-mode.test.ts:279-349](api/tests/apps/edit-mode.test.ts:279)

- CLOSED (M2) rollback is now correctly compare-and-restore: it re-reads versions, requires current `HEAD === expectedHeadSha` (the post-edit head) and separately requires `preRunSha` (the restore target) to still exist before issuing restore; if HEAD advanced or target disappeared, it refuses and never sends the restore call, so a concurrent HEAD move is not wiped. [api/assets/panel-runtime/src/edit-mode.js:235-244](api/assets/panel-runtime/src/edit-mode.js:235), [api/assets/panel-runtime/src/AssistantPanel.jsx:685-710](api/assets/panel-runtime/src/AssistantPanel.jsx:685), [api/tests/apps/edit-mode.test.ts:372-404](api/tests/apps/edit-mode.test.ts:372)

- CLOSED (new-defect check) the new poll loop is bounded and the rollback guard fails closed: polling has both a wall-clock deadline and bounded transient retries, returns `pending`/`degraded` instead of looping forever, and `guardedRollback` returns `{ ok:false, status }` on versions re-read failure before any restore attempt. [api/assets/panel-runtime/src/edit-mode.js:329-348](api/assets/panel-runtime/src/edit-mode.js:329), [api/assets/panel-runtime/src/edit-mode.js:417-426](api/assets/panel-runtime/src/edit-mode.js:417), [api/assets/panel-runtime/src/edit-mode.js:236-243](api/assets/panel-runtime/src/edit-mode.js:236)

- CLOSED (invariants intact) detect-then-ask and visitor-blindness remain preserved: the whoami effect only sets `admin`, the only `setEditMode(true)` is the explicit `openEditMode` click path, and the edit handlers use `runEditPatch`/`guardedRollback` on the `/api/v1/*` plane rather than the visitor `POST /api/app-assistant` endpoint. [api/assets/panel-runtime/src/AssistantPanel.jsx:41](api/assets/panel-runtime/src/AssistantPanel.jsx:41), [api/assets/panel-runtime/src/AssistantPanel.jsx:315-356](api/assets/panel-runtime/src/AssistantPanel.jsx:315), [api/assets/panel-runtime/src/AssistantPanel.jsx:583-589](api/assets/panel-runtime/src/AssistantPanel.jsx:583), [api/assets/panel-runtime/src/AssistantPanel.jsx:625-710](api/assets/panel-runtime/src/AssistantPanel.jsx:625), [api/assets/panel-runtime/src/AssistantPanel.jsx:804-823](api/assets/panel-runtime/src/AssistantPanel.jsx:804)

VERDICT: APPROVE
