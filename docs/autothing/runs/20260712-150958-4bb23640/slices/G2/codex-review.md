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
session id: 019f5c31-49b0-70e1-92ff-c4c87d7f6bb2
--------
user
You are an adversarial cross-model code reviewer in the git repo at /Users/ggomes/dev/ekoa-code. Review the G2 slice: commits 272f54d, 911f00b, fed1255 (run: git show <sha> for each; read any file you need). Context: the served-app operator assistant panel (React panel + tour player, previously baked into every generated app's esbuild IIFE bundle via the scaffold) moved to a platform-served lazy runtime asset: api/assets/panel-runtime/src/** compiled by api/assets/panel-runtime/build.mjs into a self-contained IIFE (own React, css injected) served at /__ekoa/panel-runtime.js (api/src/apps/serving.ts), lazily loaded by a React-free plain-DOM launcher in the scaffold (api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js) on first click or a 2s-floored idle preload; open-intent handoff via window.__ekoaAssistantAutoOpen (pre-mount) + CustomEvent 'ekoa:assistant-open' (post-mount); script onerror resets the once-only guard; Dockerfile.api ships assets from the build stage because panel-runtime.js is a gitignored build artifact. Gates: api/tests/apps/panel-lazy.test.ts (structural) + api/tests/e2e/panel-perf.e2e.mjs (live driver, already PASSED on the credentialed dev stack). Hunt for REAL defects with concrete failure scenarios + file:line evidence: lazy-lifecycle races (click/idle/error interleavings, double-mount, stale flag), the boot-launcher handoff (two launchers, lost clicks, focus/a11y), security (script src fixed? XSS in the DOM launcher? the window-flag/event being page-writable - does it matter? CSP of served apps vs the injected script; egress hygiene of the compiled asset), compat (apps built pre-G2 with the baked panel; the existing e2e drivers clicking the launcher), build/deploy honesty (the esbuild step failing the build chain; the Dockerfile change; STALE panel-runtime.js on a dev machine being served), and test honesty (byte budget tautology? does panel-perf genuinely prove no-fetch-before-interaction and once-only?). End with exactly one line: VERDICT: APPROVE or VERDICT: NEEDS-WORK, preceded by your findings each classified High/Medium/Low with file:line.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing the three G2 commits as a code review pass. I’m checking repo guidance files first, then I’ll inspect the commit diffs and the touched runtime/serving/test paths for concrete regressions.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "pwd && ls -la && test -d .codegraph && echo CODEGRAPH_PRESENT || echo CODEGRAPH_MISSING && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md'" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
/Users/ggomes/dev/ekoa-code
total 1256
drwxr-xr-x@  32 ggomes  staff    1024 Jul 13 16:54 .
drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
drwxr-xr-x@   6 ggomes  staff     192 Jul 13 11:15 .claude
drwxr-xr-x@   9 ggomes  staff     288 Jul 13 16:55 .codegraph
-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
drwxr-xr-x@  16 ggomes  staff     512 Jul 13 16:55 .git
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:59 .githooks
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:55 .github
-rw-r--r--@   1 ggomes  staff    1000 Jul 13 15:43 .gitignore
-rw-r--r--@   1 ggomes  staff     450 Jul  7 02:23 .npmrc
drwxr-xr-x@  56 ggomes  staff    1792 Jul 12 07:34 .playwright-cli
drwxr-xr-x@   6 ggomes  staff     192 Jul 11 22:20 .walkthrough
-rw-r--r--@   1 ggomes  staff    5797 Jul 11 22:20 CLAUDE.md
-rw-r--r--@   1 ggomes  staff    2351 Jul 13 16:54 Dockerfile.api
-rw-r--r--@   1 ggomes  staff    1658 Jul  8 10:24 Dockerfile.web
-rw-r--r--@   1 ggomes  staff   39912 Jul 13 15:25 RUN_LOG.md
drwxr-xr-x@  18 ggomes  staff     576 Jul 13 15:42 api
-rw-r--r--@   1 ggomes  staff       5 Jul  6 22:50 backend.port
drwxr-xr-x@   6 ggomes  staff     192 Jul  8 10:26 deploy
drwxr-xr-x@  17 ggomes  staff     544 Jul 13 16:54 docs
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
CODEGRAPH_PRESENT

exec
/bin/zsh -lc "git show --stat --oneline 272f54d && printf '\\n---COMMIT---\\n' && git show --stat --oneline 911f00b && printf '\\n---COMMIT---\\n' && git show --stat --oneline fed1255" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-WiSvKAcy' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-Pezot5ro' (errno=Operation not permitted)
272f54d feat(operator-run/g2): assistant panel becomes a platform-served lazy runtime asset (C3 pattern) - React-free scaffold launcher (5273B measured, 8192B budgeted), /__ekoa/panel-runtime.js served like the action runtime (self-contained IIFE, own React, css-injected, prod+minified), click-or-idle(2s-floored) load with once-only fetch + auto-open handoff; tour-player + tests move with the files; diagrams 03+07 updated; panel fixes now reach every app without rebuilds
 .gitignore                                         |   4 +
 .../scaffold/frontend/src/lib/assistant/mount.js   | 131 +++++---
 .../bases/app/skills/using-the-assistant-panel.md  |  16 +-
 api/assets/panel-runtime/build.mjs                 | 116 +++++++
 .../src}/AssistantPanel.css                        |   0
 .../src}/AssistantPanel.jsx                        |  25 +-
 api/assets/panel-runtime/src/index.jsx             |  81 +++++
 .../assistant => panel-runtime/src}/tour-player.js |   0
 api/package.json                                   |   2 +-
 api/src/apps/serving.ts                            |  24 ++
 api/tests/SUITE_LEDGER.json                        |   5 +
 api/tests/apps/assistant-panel.test.ts             |  67 ++--
 api/tests/apps/panel-lazy.test.ts                  | 118 +++++++
 api/tests/apps/tour-player.behavior.test.ts        |   8 +-
 api/tests/apps/tour-player.test.ts                 |   8 +-
 api/tests/e2e/panel-perf.e2e.mjs                   | 346 +++++++++++++++++++++
 .../slices/G2/impl-notes.md                        | 174 +++++++++++
 .../slices/G2/worker-status.txt                    |   1 +
 docs/diagrams/03-request-crud.excalidraw           |   8 +-
 docs/diagrams/07-content-composition.excalidraw    |   8 +-
 20 files changed, 1046 insertions(+), 96 deletions(-)

---COMMIT---
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-LLQsEvCw' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-qKfZWj5D' (errno=Operation not permitted)
911f00b fix(operator-run/g2): open-intent survives the idle-preload race - every launcher click also dispatches 'ekoa:assistant-open' (flag covers pre-mount, event covers post-mount; a click between idle inject and boot-launcher removal was silently lost); driver arms the request waiter BEFORE the click (first gate run failed on the arm-after race) and asserts the once-only invariant on the total fetch count
 .../app/scaffold/frontend/src/lib/assistant/mount.js      | 10 +++++++++-
 api/assets/panel-runtime/src/AssistantPanel.jsx           | 10 ++++++++++
 api/tests/apps/panel-lazy.test.ts                         |  5 +++++
 api/tests/e2e/panel-perf.e2e.mjs                          | 15 ++++++++++++---
 4 files changed, 36 insertions(+), 4 deletions(-)

---COMMIT---
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-JgzeWjrW' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-3xx8P0nF' (errno=Operation not permitted)
fed1255 fix(operator-run/g2): review Lows - script onerror resets the once-only guard (transport failure never bricks the launcher); Dockerfile.api ships api/assets FROM THE BUILD STAGE (panel-runtime.js is a gitignored artifact: absent in CI checkout, stale-able on dev - review-g2 Low-2 was concretely real in the deploy shape); louder unavailable warning + runbook note
 Dockerfile.api                                                 |  6 +++++-
 .../bases/app/scaffold/frontend/src/lib/assistant/mount.js     |  7 +++++++
 api/src/apps/serving.ts                                        | 10 +++++++++-
 api/tests/apps/panel-lazy.test.ts                              |  3 +++
 docs/operations-runbook.md                                     |  6 ++++++
 5 files changed, 30 insertions(+), 2 deletions(-)

codex
The repo is CodeGraph-indexed, so I’m using that path instead of raw grep for code understanding. Next I’m reading the project context files that exist and then the specific launcher/runtime/serving/test code behind these three commits.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc 'for f in PRD.md PLANING.md TASKS.md; do if [ -f "$f" ]; then echo "--- $f ---"; sed -n '"'1,220p' \""'$f"; fi; done' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
exec
/bin/zsh -lc "find .. -name PRD.md -o -name PLANING.md -o -name TASKS.md | sed -n '1,120p'" in /Users/ggomes/dev/ekoa-code
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
codex
I have the live source for the launcher and panel. Now I’m checking the exact current implementations of the runtime build/serving/tests and the commit hunks, because the review needs failure scenarios tied to the shipped code rather than just the intent in the commit messages.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' ." in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
exec
/bin/zsh -lc 'git show --unified=80 272f54d -- api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js api/assets/panel-runtime/src/AssistantPanel.jsx api/assets/panel-runtime/src/index.jsx api/assets/panel-runtime/build.mjs api/src/apps/serving.ts api/tests/apps/panel-lazy.test.ts api/tests/e2e/panel-perf.e2e.mjs Dockerfile.api' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-4jTuQ0dv' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-6R7jkInp' (errno=Operation not permitted)
commit 272f54de3158dc6a0d963938f4f9115ee5570b66
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 16:24:11 2026 +0100

    feat(operator-run/g2): assistant panel becomes a platform-served lazy runtime asset (C3 pattern) - React-free scaffold launcher (5273B measured, 8192B budgeted), /__ekoa/panel-runtime.js served like the action runtime (self-contained IIFE, own React, css-injected, prod+minified), click-or-idle(2s-floored) load with once-only fetch + auto-open handoff; tour-player + tests move with the files; diagrams 03+07 updated; panel fixes now reach every app without rebuilds

diff --git a/api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js b/api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js
index e7c142c..00f932b 100644
--- a/api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js
+++ b/api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js
@@ -1,55 +1,104 @@
 /*
- * Operator assistant panel mount - platform-shipped for the `app` base (operator-run D2).
+ * Operator assistant LAUNCHER + lazy loader - platform-shipped for the `app` base
+ * (operator-run D2; lazy-load rework operator-run G2).
  *
- * Mounts <AssistantPanel/> into the shell's reserved <div id="ekoa-assistant-root">.
- * Called once from index.jsx after the app renders. Guarded three ways:
+ * Since G2 the assistant panel is NOT baked into the app bundle. This is the only
+ * assistant code the app bundle carries: a tiny plain-DOM launcher (NO React) plus a
+ * lazy loader. It does two things and nothing else:
  *
- *   - It WAITS for the node. The mount point is rendered BY the app (inside App.jsx),
- *     and React 18's createRoot().render() commits the initial tree asynchronously,
- *     so the node is NOT in the DOM the instant index.jsx calls this. We poll a
- *     bounded number of animation frames until it appears (typically frame 1-2).
- *   - It only mounts once per document (the node carries a flag), so a repeat call
- *     (or a hot reload) never double-mounts.
- *   - It gives up quietly after the bounded retries when the node never appears
- *     (a standalone preview / a non-app shell) - a no-op, never a crash or a spin.
+ *   1. Render the launcher immediately - a fixed bottom-right "Assistente" button,
+ *      visually identical to the panel's own launcher (same CSS-var contract, so it
+ *      inherits the org brand from /api/design-tokens.css), with zero parse cost from
+ *      the panel/React on the app's first paint. No blocking work on the main thread.
+ *   2. Lazy-load the platform panel-runtime asset (/__ekoa/panel-runtime.js) on the
+ *      FIRST launcher interaction OR an idle preload, whichever comes first. The
+ *      loaded asset bundles its own React, self-mounts <AssistantPanel/> into the
+ *      shell's #ekoa-assistant-root, and takes over the launcher (see the asset's
+ *      index.jsx - it keeps the three mount guards: bounded wait-for-node, once-only,
+ *      quiet give-up). The C3 action runtime stays EAGERLY injected (injected-context),
+ *      so declared actions still work even if the panel is never opened.
  *
- * The panel is a SEPARATE React root from the app, rendered into a node the app
- * leaves permanently empty, so it never blocks or re-renders the product and
- * survives the app's own re-renders. The coding agent never calls this itself and
- * never renders into #ekoa-assistant-root.
+ * The handoff: a CLICK sets window.__ekoaAssistantAutoOpen so the panel opens on
+ * mount (explicit visitor intent); an idle preload does not, so the panel mounts
+ * collapsed (warmed, but never steals the screen). Loading/mounting the panel issues
+ * ZERO calls to /api/app-assistant - opening the assistant never costs a token.
+ *
+ * index.jsx calls mountAssistant() once after the app renders. The coding agent never
+ * calls this itself and never renders into #ekoa-assistant-root.
  */
-import { createRoot } from 'react-dom/client';
-import { AssistantPanel } from './AssistantPanel';
-
-const MOUNT_ID = 'ekoa-assistant-root';
-const MAX_FRAMES = 60; // ~1s worth of frames; past this the mount point isn't coming
-
-function schedule(fn) {
-  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
-    window.requestAnimationFrame(fn);
-  } else {
-    setTimeout(fn, 16);
-  }
+
+const LAUNCHER_MARKER = 'data-ekoa-boot-launcher';
+const PANEL_RUNTIME_SRC = '/__ekoa/panel-runtime.js';
+// Floor the idle preload so a promptly-interacting visitor (and the perf gate) always
+// trigger the load via their CLICK, not an eager idle fetch; after the floor we defer
+// to real idle (requestIdleCallback), or a plain timeout where it is absent.
+const IDLE_PRELOAD_MS = 2000;
+
+// The launcher's chat glyph - the SAME inline SVG as the panel's ChatIcon. No emoji.
+const CHAT_ICON =
+  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
+  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto">' +
+  '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg>';
+
+// Inline launcher styles mirroring .ekoa-assistant-launcher (AssistantPanel.css) via
+// the same CSS-var contract with fallbacks - the panel CSS is not loaded yet, so the
+// launcher must carry its own look until the asset takes over.
+const LAUNCHER_STYLE =
+  'position:fixed;right:var(--space-4,1rem);bottom:var(--space-4,1rem);z-index:2147482000;' +
+  'display:inline-flex;align-items:center;gap:var(--space-2,0.5rem);' +
+  'padding:var(--space-3,0.75rem) var(--space-4,1rem);' +
+  'border:1px solid var(--color-primary,#0F766E);border-radius:var(--radius-lg,0.75rem);' +
+  'background:var(--color-primary,#0F766E);color:var(--color-bg,#FFFFFF);' +
+  "font-family:var(--font-sans,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif);" +
+  'font-size:var(--text-sm,0.875rem);font-weight:600;line-height:1;cursor:pointer;' +
+  'box-shadow:var(--shadow-md,0 8px 24px rgba(15,23,42,0.18));';
+
+let injected = false;
+
+/** Inject the platform panel-runtime asset exactly once. The asset self-mounts and
+ *  removes the launcher; a second call (idle after click, or vice versa) is a no-op. */
+function ensurePanelLoaded() {
+  if (injected || typeof document === 'undefined') return;
+  injected = true;
+  const s = document.createElement('script');
+  s.src = PANEL_RUNTIME_SRC;
+  s.async = true;
+  (document.head || document.documentElement).appendChild(s);
+}
+
+/** Preload the asset when the page goes idle (after a floor delay), so a returning
+ *  visitor's first click opens an already-warm panel. No auto-open: mount collapsed. */
+function scheduleIdlePreload() {
+  if (typeof window === 'undefined') return;
+  window.setTimeout(() => {
+    if (typeof window.requestIdleCallback === 'function') {
+      window.requestIdleCallback(() => ensurePanelLoaded(), { timeout: 2000 });
+    } else {
+      ensurePanelLoaded();
+    }
+  }, IDLE_PRELOAD_MS);
 }
 
 export function mountAssistant() {
   if (typeof document === 'undefined') return;
+  // Once-only: never render two launchers (a repeat call / hot reload).
+  if (document.querySelector('[' + LAUNCHER_MARKER + ']')) return;
 
-  let frames = 0;
-  const attempt = () => {
-    const node = document.getElementById(MOUNT_ID);
-    if (node) {
-      if (node.__ekoaAssistantMounted) return; // already mounted - never mount twice
-      node.__ekoaAssistantMounted = true;
-      createRoot(node).render(<AssistantPanel />);
-      return;
-    }
-    frames += 1;
-    if (frames >= MAX_FRAMES) return; // no mount point (standalone preview) - no-op
-    schedule(attempt);
-  };
+  const btn = document.createElement('button');
+  btn.type = 'button';
+  btn.className = 'ekoa-assistant-launcher';
+  btn.setAttribute(LAUNCHER_MARKER, '');
+  btn.setAttribute('aria-label', 'Abrir o assistente');
+  btn.style.cssText = LAUNCHER_STYLE;
+  btn.innerHTML = CHAT_ICON + '<span>Assistente</span>';
+  btn.addEventListener('click', () => {
+    // Explicit visitor intent: open the panel on mount (handoff via the window flag).
+    window.__ekoaAssistantAutoOpen = true;
+    ensurePanelLoaded();
+  });
 
-  attempt();
+  (document.body || document.documentElement).appendChild(btn);
+  scheduleIdlePreload();
 }
 
 export default mountAssistant;
diff --git a/api/assets/panel-runtime/build.mjs b/api/assets/panel-runtime/build.mjs
new file mode 100644
index 0000000..201053d
--- /dev/null
+++ b/api/assets/panel-runtime/build.mjs
@@ -0,0 +1,116 @@
+/*
+ * Panel-runtime compile step (operator-run G2).
+ *
+ * Compiles the operator assistant panel (AssistantPanel.jsx + tour-player.js +
+ * AssistantPanel.css, entry src/index.jsx) into ONE self-contained browser IIFE at
+ * api/assets/panel-runtime.js, served by serving.ts at /__ekoa/panel-runtime.js next
+ * to the C3 action runtime. Mirrors the app builder's sharedBuildOptions conventions
+ * (api/src/apps/builder.ts): format 'iife', platform 'browser', target es2020, jsx
+ * automatic, React resolved from the WORKSPACE node_modules via nodePaths (no CDN, no
+ * per-sandbox install). Two deliberate deviations, appropriate for a served PLATFORM
+ * asset (not a per-app dev bundle): a PRODUCTION React build (NODE_ENV production, no
+ * dev warnings in a lawyer's face) and minify on (the asset caches once across every
+ * served app), which both keep the byte cost down.
+ *
+ * CSS is bundled INTO the single JS via the cssInject plugin (a `.css` import becomes
+ * a style-injecting IIFE), so the one asset is fully self-contained - no sibling
+ * bundle.css, no extra request.
+ *
+ * The output api/assets/panel-runtime.js is BUILT (npm run build --workspace api) and
+ * is NOT committed (.gitignore). serving.ts reads it once at boot and serves a clear
+ * "unavailable" comment body if it is missing.
+ *
+ * Importable: `buildPanelRuntime({ write })` returns the compiled code (used by the
+ * offline compile test, tests/apps/panel-lazy.test.ts). Run directly to write the
+ * asset: `node assets/panel-runtime/build.mjs`.
+ */
+import * as esbuild from 'esbuild';
+import { readFile, writeFile } from 'node:fs/promises';
+import { dirname, join } from 'node:path';
+import { fileURLToPath } from 'node:url';
+
+const __dirname = dirname(fileURLToPath(import.meta.url));
+
+// Resolve React from the workspace node_modules exactly as the app builder does: npm
+// workspaces hoist to the repo root, but some deps co-locate under api/, so both are
+// searched in order (api/node_modules first, then the repo root's).
+const API_DIR = join(__dirname, '..', '..'); // api/
+const REPO_ROOT = join(__dirname, '..', '..', '..'); // repo root
+const WORKSPACE_NODE_MODULES = [join(API_DIR, 'node_modules'), join(REPO_ROOT, 'node_modules')];
+
+const ENTRY = join(__dirname, 'src', 'index.jsx');
+const OUTPUT = join(API_DIR, 'assets', 'panel-runtime.js');
+
+/**
+ * esbuild plugin: bundle each `.css` import as a style-injecting JS module, so the
+ * compiled asset carries its own styles and injects them once on load - no sibling
+ * bundle.css. Guarded against double injection (the asset self-guards its mount too).
+ */
+function cssInjectPlugin() {
+  return {
+    name: 'ekoa-panel-css-inject',
+    setup(build) {
+      build.onLoad({ filter: /\.css$/ }, async (args) => {
+        const css = await readFile(args.path, 'utf8');
+        const contents = `(function(){
+  if (typeof document === 'undefined') return;
+  if (document.querySelector('style[data-ekoa-panel]')) return;
+  var s = document.createElement('style');
+  s.setAttribute('data-ekoa-panel', '');
+  s.textContent = ${JSON.stringify(css)};
+  (document.head || document.documentElement).appendChild(s);
+})();`;
+        return { contents, loader: 'js' };
+      });
+    },
+  };
+}
+
+/**
+ * Compile the panel runtime. Returns { code, warnings, errors }. When `write` is a
+ * path (default: api/assets/panel-runtime.js) the code is also written there; pass
+ * `write: false` to compile in memory only (the offline test does this).
+ */
+export async function buildPanelRuntime({ write = OUTPUT } = {}) {
+  const result = await esbuild.build({
+    entryPoints: [ENTRY],
+    bundle: true,
+    format: 'iife',
+    platform: 'browser',
+    target: ['es2020'],
+    // JSX automatic transform - no `import React` in every file (matches the builder).
+    jsx: 'automatic',
+    // Resolve React from the workspace node_modules (not a per-app install / CDN).
+    nodePaths: WORKSPACE_NODE_MODULES,
+    plugins: [cssInjectPlugin()],
+    loader: { '.js': 'jsx', '.jsx': 'jsx' },
+    // Served platform asset: a production React build, minified, cached once.
+    define: { 'process.env.NODE_ENV': '"production"' },
+    minify: true,
+    sourcemap: false,
+    legalComments: 'none',
+    metafile: false,
+    logLevel: 'silent',
+    write: false,
+  });
+
+  const code = result.outputFiles[0].text;
+  if (write) await writeFile(write, code, 'utf8');
+  return { code, warnings: result.warnings, errors: result.errors };
+}
+
+// CLI: `node assets/panel-runtime/build.mjs` - write the served asset.
+if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
+  buildPanelRuntime()
+    .then(({ code, errors }) => {
+      if (errors && errors.length) {
+        console.error('[panel-runtime] build failed:', errors);
+        process.exit(1);
+      }
+      console.log(`[panel-runtime] built assets/panel-runtime.js (${code.length} bytes)`);
+    })
+    .catch((err) => {
+      console.error('[panel-runtime] build error:', err && err.stack ? err.stack : err);
+      process.exit(1);
+    });
+}
diff --git a/api/assets/panel-runtime/src/AssistantPanel.jsx b/api/assets/panel-runtime/src/AssistantPanel.jsx
new file mode 100644
index 0000000..d676618
--- /dev/null
+++ b/api/assets/panel-runtime/src/AssistantPanel.jsx
@@ -0,0 +1,596 @@
+/*
+ * Operator Assistant Panel - platform-shipped for the `app` base (operator-run D2;
+ * lazy-loaded as a platform runtime asset since operator-run G2).
+ *
+ * The in-app assistant every generated app carries. It is compiled into the
+ * platform panel-runtime asset (api/assets/panel-runtime) and mounts INTO the
+ * shell's <div id="ekoa-assistant-root"> (see index.jsx, the asset entry) and
+ * speaks ONLY two things:
+ *
+ *   1. POST /api/app-assistant (D1) - the served-app assistant endpoint. It carries
+ *      the visitor's message, the running history, the pinned/echoed mode, the
+ *      current screen context, and the X-Ekoa-App-Id header. The reply, its
+ *      knowledge citations ("Fontes"), and the app-actions the assistant proposes
+ *      come back on the response.
+ *   2. window.__ekoaActions.execute(action) (C3 same-document runtime) - for EACH
+ *      action the assistant proposes. The runtime owns the VISIBLE driving badge,
+ *      the target highlight, the destructive confirmation card, and the
+ *      pause-on-real-user-input; the panel only calls execute() and shows a subtle
+ *      "a executar..." state until it resolves. The panel NEVER dispatches an
+ *      action the assistant did not return.
+ *
+ * Three capabilities / three modes: OPERAR (do) operates the app, MOSTRAR (show)
+ * gives an overview, ENSINAR (teach) walks through a tutorial. The server infers
+ * the mode from the phrasing; the toggle lets the visitor pin it, and the server's
+ * echoed response.mode is reflected back.
+ *
+ * The panel is PLATFORM code: brand-neutral via the CSS-var contract, PT-PT
+ * throughout (lawyer-facing), no emoji, and non-blocking - it never steals focus
+ * from the app and every failure renders a calm message instead of crashing.
+ */
+import { useCallback, useEffect, useRef, useState } from 'react';
+import { createTourPlayer } from './tour-player';
+import './AssistantPanel.css';
+
+const ENDPOINT = '/api/app-assistant';
+// Bounds (codex-d2): the transcript kept in memory, the history slice sent per turn,
+// and a hard timeout on the assistant fetch so a hung turn can never lock the composer.
+const MAX_MESSAGES = 200;
+const MAX_HISTORY_TURNS = 16;
+const FETCH_TIMEOUT_MS = 120000;
+
+/** The three modes, in toggle order, with their PT-PT labels. */
+const MODES = [
+  { id: 'do', label: 'Operar' },
+  { id: 'show', label: 'Mostrar' },
+  { id: 'teach', label: 'Ensinar' },
+];
+
+/** The first-open capability prompts (PT-PT), one per capability. Clicking one
+ *  pins its mode and drops the example into the composer. */
+const EXAMPLES = [
+  { mode: 'do', kind: 'Operar', prompt: 'Adicione um novo registo' },
+  { mode: 'show', kind: 'Mostrar', prompt: 'Dê-me uma visão geral da aplicação' },
+  { mode: 'teach', kind: 'Ensinar', prompt: 'Mostre-me um tutorial' },
+];
+
+const ERROR_REPLY = 'O assistente está indisponível de momento.';
+const MAX_ACTION_RESULTS = 8;
+
+/** The served-app id stamped by injectAppContext(); absent in a standalone preview. */
+function appId() {
+  return typeof window !== 'undefined' && window.__EKOA_APP_ID ? window.__EKOA_APP_ID : undefined;
+}
+
+/** The app's current route/page, best-effort: the shell may expose it on
+ *  window.__ekoaApp; otherwise fall back to the location. Undefined when unknown. */
+function currentRoute() {
+  if (typeof window === 'undefined') return undefined;
+  const app = window.__ekoaApp;
+  if (app && typeof app.route === 'string' && app.route) return app.route;
+  if (app && typeof app.currentRoute === 'string' && app.currentRoute) return app.currentRoute;
+  const loc = window.location;
+  const r = (loc && (loc.hash || loc.pathname)) || '';
+  return r ? String(r) : undefined;
+}
+
+/**
+ * Map a proposed action to the manifest form window.__ekoaActions.execute expects
+ * (kind/target/route/destructive/labelPt + a VALUES object on params). D1 sends
+ * `{ toolName, input }`; when the response is enriched with the resolved manifest
+ * `action` we drive it directly, otherwise we forward what we have (the runtime
+ * reports a clean failure for an action it cannot resolve - never a crash).
+ */
+function toRuntimeAction(a) {
+  const values = (a && (a.input || a.params)) || {};
+  if (a && a.action && typeof a.action === 'object') {
+    return { ...a.action, params: values };
+  }
+  const id =
+    a && typeof a.toolName === 'string'
+      ? a.toolName.replace(/^app_action__/, '').replace(/_/g, '-')
+      : undefined;
+  return { id, toolName: a && a.toolName, params: values };
+}
+
+/** A short PT-PT status line for one action run. */
+function runLabel(status) {
+  switch (status) {
+    case 'running':
+      return 'A executar...';
+    case 'done':
+      return 'Ação executada.';
+    case 'cancelled':
+      return 'Ação cancelada.';
+    case 'unavailable':
+      return 'Ação indisponível nesta pré-visualização.';
+    default:
+      return 'Não foi possível executar a ação.';
+  }
+}
+
+function SendIcon() {
+  return (
+    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
+      <path d="M22 2 11 13" />
+      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
+    </svg>
+  );
+}
+
+function CloseIcon() {
+  return (
+    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
+      <path d="M18 6 6 18" />
+      <path d="m6 6 12 12" />
+    </svg>
+  );
+}
+
+function ChatIcon() {
+  return (
+    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
+      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
+    </svg>
+  );
+}
+
+/** PT-PT status line for a non-stepping tour phase (playing/awaiting show the copy). */
+function tourStatusText(status) {
+  switch (status) {
+    case 'loading':
+      return 'A carregar o tutorial...';
+    case 'awaiting':
+      return 'Aguardando a sua ação na aplicação...';
+    case 'done':
+      return 'Tutorial concluído.';
+    case 'error':
+      return 'Não foi possível carregar o tutorial guiado.';
+    default:
+      return '';
+  }
+}
+
+/**
+ * The tour block rendered in the panel while a same-document tour plays. The
+ * on-page highlight/tooltip is drawn by the C3 runtime (window.__ekoaActions
+ * spotlight); this block carries the step counter, the narration, and the
+ * Seguinte / Sair controls. It exposes data-tour-status + data-tour-step-index for
+ * the deterministic live gate. No emoji; brand-neutral via the panel CSS vars.
+ */
+function TourView({ tour, onNext, onClose }) {
+  const { status, stepIndex, total, copy, imageUrl, imageBlocked, injectedPrompt } = tour;
+  const stepping = status === 'playing' || status === 'awaiting';
+  const stepNo = total > 0 ? Math.min(stepIndex + 1, total) : 0;
+  const statusLine = tourStatusText(status);
+  return (
+    <section
+      className="ekoa-assistant-tour"
+      data-tour-status={status}
+      data-tour-step-index={stepIndex}
+      aria-label="Tutorial guiado"
+    >
+      <div className="ekoa-assistant-tour-head">
+        <span className="ekoa-assistant-tour-title">Tutorial guiado</span>
+        {stepping && total > 0 ? (
+          <span className="ekoa-assistant-tour-progress">{`Passo ${stepNo} de ${total}`}</span>
+        ) : null}
+      </div>
+
+      {copy ? (
+        <div className="ekoa-assistant-tour-copy">
+          {copy.titlePt ? <div className="ekoa-assistant-tour-copy-title">{copy.titlePt}</div> : null}
+          {copy.bodyPt ? <div className="ekoa-assistant-tour-copy-body">{copy.bodyPt}</div> : null}
+        </div>
+      ) : null}
+
+      {injectedPrompt ? (
+        <div className="ekoa-assistant-tour-note">
+          Sugestão colocada na caixa de mensagem, para rever antes de enviar.
+        </div>
+      ) : null}
+
+      {imageUrl ? <img className="ekoa-assistant-tour-image" src={imageUrl} alt="" /> : null}
+
+      {imageBlocked ? (
+        <div className="ekoa-assistant-tour-note">Imagem ignorada (caminho não permitido).</div>
+      ) : null}
+
+      {statusLine ? <div className="ekoa-assistant-tour-status">{statusLine}</div> : null}
+
+      <div className="ekoa-assistant-tour-controls">
+        {stepping ? (
+          <button type="button" className="ekoa-assistant-tour-next" onClick={onNext}>
+            Seguinte
+          </button>
+        ) : null}
+        <button type="button" className="ekoa-assistant-tour-close" onClick={onClose}>
+          {status === 'done' || status === 'error' ? 'Fechar' : 'Sair'}
+        </button>
+      </div>
+    </section>
+  );
+}
+
+export function AssistantPanel({ defaultOpen = false } = {}) {
+  // Collapsed on mount UNLESS the launcher handed off an explicit open intent. Since
+  // G2 the panel is lazy-loaded: the app-bundle launcher (scaffold mount.js) injects
+  // this asset and passes `defaultOpen` true when the VISITOR clicked it (open now),
+  // false when the asset was idle-preloaded (mount collapsed, show only the launcher).
+  const [collapsed, setCollapsed] = useState(!defaultOpen);
+  // `mode` is the mode CURRENTLY shown on the toggle - the server's inference (echoed
+  // on each response) unless the visitor pins one. `pinnedMode` is non-null only when
+  // the visitor explicitly picked a mode: only then do we send it, so by default the
+  // server infers the mode from the phrasing (do/show/teach) and we reflect it back.
+  const [mode, setMode] = useState('do');
+  const [pinnedMode, setPinnedMode] = useState(null);
+  const [messages, setMessages] = useState([]); // { id, role, content, citations?, runs? }
+  const [draft, setDraft] = useState('');
+  const [busy, setBusy] = useState(false);
+  // E2 same-document tour playback state (null when no tour is active). The player
+  // is 100% client-side and issues ZERO model calls: it fetches the pre-generated
+  // tour from GET /api/demos/:appId and drives it in the page.
+  const [tour, setTour] = useState(null);
+
+  const idRef = useRef(0);
+  const messagesRef = useRef(messages);
+  const actionResultsRef = useRef([]); // rolling buffer of recent action results for context
+  const listRef = useRef(null);
+  const textareaRef = useRef(null);
+  const playerRef = useRef(null);
+
+  useEffect(() => {
+    messagesRef.current = messages;
+    // keep the newest turn in view
+    const el = listRef.current;
+    if (el) el.scrollTop = el.scrollHeight;
+  }, [messages]);
+
+  useEffect(() => {
+    // Auto-open handoff (G2): the visitor clicked the launcher, so the panel mounts
+    // already open - focus the composer once, matching an explicit open. Never runs
+    // on an idle-preloaded (collapsed) mount, so it never steals focus from the app.
+    if (defaultOpen && textareaRef.current) textareaRef.current.focus();
+    // Mount-only: the handoff intent is fixed at mount time.
+  }, [defaultOpen]);
+
+  const nextId = () => {
+    idRef.current += 1;
+    return idRef.current;
+  };
+
+  const patchTurn = useCallback((turnId, patch) => {
+    setMessages((prev) => prev.map((m) => (m.id === turnId ? { ...m, ...patch(m) } : m)));
+  }, []);
+
+  const recordResult = useCallback((result) => {
+    const buf = actionResultsRef.current;
+    buf.push(result);
+    if (buf.length > MAX_ACTION_RESULTS) buf.splice(0, buf.length - MAX_ACTION_RESULTS);
+  }, []);
+
+  // ---- E2 tour playback (same-document, zero-token) ------------------------
+  // Lazily build ONE client-side tour player. Its state drives the tour block in
+  // the panel; when a step surfaces a suggested prompt (inject-prompt) it lands in
+  // the composer - never auto-sent. No path here calls /api/app-assistant.
+  const ensurePlayer = useCallback(() => {
+    if (!playerRef.current) {
+      playerRef.current = createTourPlayer({
+        onState: (state) => {
+          setTour(state);
+          if (state && state.injectedPrompt) setDraft(state.injectedPrompt);
+        },
+      });
+    }
+    return playerRef.current;
+  }, []);
+
+  /** Start playing the app's guided tour in the page. Triggered by teach mode or a
+   *  startTour action. Fetches GET /api/demos/:appId inside the player - no model
+   *  turn is issued. `tourId` is forwarded for forward-compat (the route serves the
+   *  app's overview tour today). */
+  const startTourPlayback = useCallback(
+    (tourId) => {
+      const player = ensurePlayer();
+      setCollapsed(false);
+      void player.start(undefined, tourId);
+    },
+    [ensurePlayer],
+  );
+
+  const tourNext = useCallback(() => {
+    if (playerRef.current) playerRef.current.next();
+  }, []);
+
+  const tourClose = useCallback(() => {
+    if (playerRef.current) playerRef.current.cancel();
+    setTour(null);
+  }, []);
+
+  /** Collapse the panel. A tour is bound to the visible panel, so collapsing it
+   *  CANCELS any active tour (clears the on-page spotlight + aborts the run) rather
+   *  than leaving a ring on screen with no reachable controls. */
+  const collapsePanel = useCallback(() => {
+    if (playerRef.current) playerRef.current.cancel();
+    setTour(null);
+    setCollapsed(true);
+  }, []);
+
+  /** Run the assistant's proposed actions in order through the C3 runtime. The
+   *  runtime draws the driving badge / highlight / destructive confirm and pauses
+   *  on real user input - the panel only reflects each run's state. */
+  const runActions = useCallback(
+    async (actions, turnId) => {
+      const runtime = typeof window !== 'undefined' ? window.__ekoaActions : undefined;
+      for (const a of actions) {
+        const runId = nextId();
+        patchTurn(turnId, (m) => ({ runs: [...(m.runs || []), { id: runId, status: 'running' }] }));
+
+        const setStatus = (status, detail) =>
+          patchTurn(turnId, (m) => ({
+            runs: (m.runs || []).map((r) => (r.id === runId ? { ...r, status, detail } : r)),
+          }));
+
+        // A startTour action is played by the SAME-DOCUMENT tour player, not the
+        // runtime executor: the runtime's cross-frame startTour only posts a
+        // tour-request (a no-op in-page) and drops the tourId. The panel owns the
+        // player, so it starts playback here. Client-side + zero-token.
+        const runtimeAction = toRuntimeAction(a);
+        if (runtimeAction && runtimeAction.kind === 'startTour') {
+          startTourPlayback(runtimeAction.tourId);
+          setStatus('done');
+          recordResult({ toolName: a && a.toolName, status: 'done' });
+          continue;
+        }
+
+        if (!runtime || typeof runtime.execute !== 'function') {
+          setStatus('unavailable');
+          recordResult({ toolName: a && a.toolName, status: 'unavailable' });
+          continue;
+        }
+        try {
+          const result = await runtime.execute(runtimeAction);
+          const status = (result && result.status) || 'done';
+          setStatus(status, result && result.detail);
+          recordResult({ toolName: a && a.toolName, status, detail: result && result.detail });
+        } catch (err) {
+          setStatus('failed', err && err.reason);
+          recordResult({ toolName: a && a.toolName, status: 'failed', detail: err && err.reason });
+        }
+      }
+    },
+    [patchTurn, recordResult, startTourPlayback],
+  );
+
+  const send = useCallback(
+    async (rawText) => {
+      const text = (rawText != null ? rawText : draft).trim();
+      if (!text || busy) return;
+
+      // History is the conversation BEFORE this message (role/content pairs only),
+      // capped to the most recent turns so request size, latency and model cost stay
+      // bounded on a long-lived panel.
+      const history = messagesRef.current
+        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error)
+        .slice(-MAX_HISTORY_TURNS)
+        .map((m) => ({ role: m.role, content: m.content }));
+
+      setDraft('');
+      setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: text }].slice(-MAX_MESSAGES));
+      setBusy(true);
+
+      const route = currentRoute();
+      const recent = actionResultsRef.current.slice();
+      const context = {};
+      if (route) context.route = route;
+      if (recent.length) context.actionResults = recent;
+
+      const id = appId();
+      // A hung network/model turn must never lock the composer: abort after the
+      // timeout and fall through to the calm PT-PT error turn.
+      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
+      const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
+      try {
+        const res = await fetch(ENDPOINT, {
+          method: 'POST',
+          ...(controller ? { signal: controller.signal } : {}),
+          headers: {
+            'Content-Type': 'application/json',
+            ...(id ? { 'X-Ekoa-App-Id': id } : {}),
+          },
+          body: JSON.stringify({
+            message: text,
+            history,
+            // Send the mode only when the visitor pinned it; otherwise let the server
+            // infer it from the phrasing and echo it back on response.mode.
+            ...(pinnedMode ? { mode: pinnedMode } : {}),
+            ...(Object.keys(context).length ? { context } : {}),
+          }),
+        });
+        if (!res.ok) {
+          setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: ERROR_REPLY, error: true }].slice(-MAX_MESSAGES));
+          return;
+        }
+        const data = await res.json();
+        if (data && typeof data.mode === 'string') setMode(data.mode);
+        const turnId = nextId();
+        setMessages((prev) => [
+          ...prev,
+          {
+            id: turnId,
+            role: 'assistant',
+            content: (data && data.reply) || '',
+            citations: data && Array.isArray(data.citations) ? data.citations : undefined,
+            runs: [],
+          },
+        ].slice(-MAX_MESSAGES));
+        if (data && Array.isArray(data.actions) && data.actions.length) {
+          await runActions(data.actions, turnId);
+        }
+      } catch {
+        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: ERROR_REPLY, error: true }].slice(-MAX_MESSAGES));
+      } finally {
+        if (timer) clearTimeout(timer);
+        setBusy(false);
+      }
+    },
+    [draft, busy, pinnedMode, runActions],
+  );
+
+  const open = useCallback(() => {
+    setCollapsed(false);
+    // Focus only on an explicit open (user intent); never on mount, so the panel
+    // never steals focus from the app while it loads.
+    window.setTimeout(() => {
+      if (textareaRef.current) textareaRef.current.focus();
+    }, 0);
+  }, []);
+
+  const onExample = useCallback((example) => {
+    setMode(example.mode);
+    setDraft(example.prompt);
+    if (textareaRef.current) textareaRef.current.focus();
+  }, []);
+
+  const onKeyDown = useCallback(
+    (e) => {
+      // Enter sends; Shift+Enter is a newline.
+      if (e.key === 'Enter' && !e.shiftKey) {
+        e.preventDefault();
+        void send();
+      }
+    },
+    [send],
+  );
+
+  if (collapsed) {
+    return (
+      <button type="button" className="ekoa-assistant-launcher" onClick={open} aria-label="Abrir o assistente">
+        <ChatIcon />
+        <span>Assistente</span>
+      </button>
+    );
+  }
+
+  // A tour is on-screen for every phase except idle/cancelled (both mean "no tour").
+  const tourActive = !!(tour && tour.status && tour.status !== 'idle' && tour.status !== 'cancelled');
+
+  return (
+    <aside className="ekoa-assistant" data-collapsed="false" role="complementary" aria-label="Assistente">
+      <header className="ekoa-assistant-header">
+        <span className="ekoa-assistant-title">Assistente</span>
+        <button type="button" className="ekoa-assistant-close" onClick={collapsePanel} aria-label="Fechar o assistente">
+          <CloseIcon />
+        </button>
+      </header>
+
+      <div className="ekoa-assistant-modes" role="group" aria-label="Modo do assistente">
+        {MODES.map((m) => (
+          <button
+            key={m.id}
+            type="button"
+            className="ekoa-assistant-mode"
+            aria-pressed={mode === m.id}
+            onClick={() => {
+              // Pin the picked mode (click the pinned one again to unpin, back to inference).
+              setPinnedMode((prev) => (prev === m.id ? null : m.id));
+              setMode(m.id);
+            }}
+          >
+            {m.label}
+          </button>
+        ))}
+      </div>
+
+      <div className="ekoa-assistant-messages" ref={listRef}>
+        {messages.length === 0 ? (
+          <div className="ekoa-assistant-intro">
+            <p className="ekoa-assistant-intro-lead">
+              Olá. Posso ajudar de três formas: mostrar uma visão geral da aplicação, ensinar como
+              a usar passo a passo, ou operá-la por si. Experimente:
+            </p>
+            <div className="ekoa-assistant-examples">
+              {EXAMPLES.map((ex) => (
+                <button key={ex.prompt} type="button" className="ekoa-assistant-example" onClick={() => onExample(ex)}>
+                  <span className="ekoa-assistant-example-kind">{ex.kind}</span>
+                  {ex.prompt}
+                </button>
+              ))}
+            </div>
+          </div>
+        ) : (
+          messages.map((m) => (
+            <div key={m.id} className="ekoa-assistant-turn" data-role={m.role}>
+              {m.content ? <div className="ekoa-assistant-bubble">{m.content}</div> : null}
+
+              {m.citations && m.citations.length ? (
+                <div className="ekoa-assistant-citations">
+                  <div className="ekoa-assistant-citations-title">Fontes</div>
+                  <ul>
+                    {m.citations.map((c, i) => (
+                      <li key={`${c.collection}/${c.docId}/${i}`}>
+                        <span className="ekoa-assistant-citation-collection">{c.collection}</span>
+                        {' - '}
+                        <span className="ekoa-assistant-citation-title">{c.title}</span>
+                      </li>
+                    ))}
+                  </ul>
+                </div>
+              ) : null}
+
+              {m.runs && m.runs.length ? (
+                <div className="ekoa-assistant-runs">
+                  {m.runs.map((r) => (
+                    <div key={r.id} className="ekoa-assistant-run" data-status={r.status}>
+                      <span className="ekoa-assistant-run-dot" aria-hidden="true" />
+                      <span>{runLabel(r.status)}</span>
+                    </div>
+                  ))}
+                </div>
+              ) : null}
+            </div>
+          ))
+        )}
+      </div>
+
+      {tourActive ? (
+        <TourView tour={tour} onNext={tourNext} onClose={tourClose} />
+      ) : mode === 'teach' ? (
+        <div className="ekoa-assistant-tour-launch">
+          <button
+            type="button"
+            className="ekoa-assistant-tour-start"
+            onClick={() => startTourPlayback()}
+          >
+            Iniciar tutorial guiado
+          </button>
+        </div>
+      ) : null}
+
+      <div className="ekoa-assistant-composer">
+        <textarea
+          ref={textareaRef}
+          className="ekoa-assistant-textarea"
+          placeholder="Escreva a sua mensagem..."
+          value={draft}
+          disabled={busy}
+          onChange={(e) => setDraft(e.target.value)}
+          onKeyDown={onKeyDown}
+          rows={1}
+          aria-label="Mensagem para o assistente"
+        />
+        <button
+          type="button"
+          className="ekoa-assistant-send"
+          onClick={() => send()}
+          disabled={busy || !draft.trim()}
+          aria-label="Enviar mensagem"
+        >
+          <SendIcon />
+        </button>
+      </div>
+    </aside>
+  );
+}
+
+export default AssistantPanel;
diff --git a/api/assets/panel-runtime/src/index.jsx b/api/assets/panel-runtime/src/index.jsx
new file mode 100644
index 0000000..8801caf
--- /dev/null
+++ b/api/assets/panel-runtime/src/index.jsx
@@ -0,0 +1,81 @@
+/*
+ * Operator assistant panel runtime ENTRY - the self-mounting entry of the platform
+ * panel-runtime asset (operator-run G2). Compiled platform-side into ONE
+ * self-contained IIFE (React INCLUDED, styles injected) and served at
+ * /__ekoa/panel-runtime.js next to the C3 action runtime.
+ *
+ * Since G2 the panel LAZY-loads: the app bundle carries only a tiny plain-DOM
+ * launcher (the scaffold's mount.js). On the first launcher interaction (or an idle
+ * preload) that launcher injects THIS asset; the asset self-mounts <AssistantPanel/>
+ * into the shell's reserved <div id="ekoa-assistant-root">, exactly as the old
+ * in-bundle mount.js did, and takes over the launcher. The three mount guards are
+ * UNCHANGED from that mount.js:
+ *
+ *   - It WAITS for the node. The mount point is rendered BY the app (inside App.jsx),
+ *     and React's createRoot().render() commits asynchronously, so the node is NOT in
+ *     the DOM the instant this asset runs. We poll a bounded number of animation
+ *     frames until it appears (typically frame 1-2).
+ *   - It only mounts once per document (the node carries a flag), so a repeat load
+ *     (or an old app that still bakes the panel) never double-mounts.
+ *   - It gives up quietly after the bounded retries when the node never appears
+ *     (a standalone preview / a non-app shell) - a no-op, never a crash or a spin.
+ *
+ * The panel is a SEPARATE React root from the app - its OWN React is bundled here, so
+ * there is ZERO interop with the app's React. The launcher hands off its "open"
+ * intent via window.__ekoaAssistantAutoOpen (true when the visitor clicked, absent
+ * when idle-preloaded); on mount this asset removes the launcher and takes over.
+ */
+import { createRoot } from 'react-dom/client';
+import { AssistantPanel } from './AssistantPanel';
+
+const MOUNT_ID = 'ekoa-assistant-root';
+const MAX_FRAMES = 60; // ~1s worth of frames; past this the mount point isn't coming
+
+function schedule(fn) {
+  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
+    window.requestAnimationFrame(fn);
+  } else {
+    setTimeout(fn, 16);
+  }
+}
+
+/** Remove the plain-DOM boot launcher the app bundle rendered: once the React panel
+ *  is mounted it owns the launcher (its own collapsed state), so the boot launcher
+ *  hands off and disappears - never two launchers on screen. */
+function removeBootLauncher() {
+  if (typeof document === 'undefined') return;
+  const nodes = document.querySelectorAll('[data-ekoa-boot-launcher]');
+  for (let i = 0; i < nodes.length; i += 1) {
+    const n = nodes[i];
+    if (n && n.parentNode) n.parentNode.removeChild(n);
+  }
+}
+
+function mountPanel() {
+  if (typeof document === 'undefined') return;
+
+  let frames = 0;
+  const attempt = () => {
+    const node = document.getElementById(MOUNT_ID);
+    if (node) {
+      if (node.__ekoaAssistantMounted) {
+        removeBootLauncher(); // already mounted (e.g. an old app baking the panel) - still hand off
+        return;
+      }
+      node.__ekoaAssistantMounted = true;
+      // Open intent handed off by the launcher: open now if the visitor clicked,
+      // stay collapsed if this was an idle preload.
+      const autoOpen = typeof window !== 'undefined' && !!window.__ekoaAssistantAutoOpen;
+      createRoot(node).render(<AssistantPanel defaultOpen={autoOpen} />);
+      removeBootLauncher();
+      return;
+    }
+    frames += 1;
+    if (frames >= MAX_FRAMES) return; // no mount point (standalone preview) - no-op
+    schedule(attempt);
+  };
+
+  attempt();
+}
+
+mountPanel();
diff --git a/api/src/apps/serving.ts b/api/src/apps/serving.ts
index d703666..ceb9367 100644
--- a/api/src/apps/serving.ts
+++ b/api/src/apps/serving.ts
@@ -194,320 +194,344 @@ async function tryRegisterAppFromInstance(appId: string, deps: ServingDeps): Pro
         } catch (err) {
           console.warn(`[apps] post-hydrate build(${resolvedId}) failed:`, err instanceof Error ? err.message : err);
         }
       }
     }
 
     if (!existsSync(join(projectDir, 'dist', 'index.html'))) return false;
 
     await appRegistry.register(resolvedId, projectDir, artifact.userId as string, artifact.name as string);
     return true;
   } catch (err) {
     console.warn(`[apps] tryRegisterAppFromInstance(${appId}) failed:`, err instanceof Error ? err.message : err);
     return false;
   }
 }
 
 /** Cache discipline (carried verbatim): HTML no-cache; hashed js/css immutable 1y;
  *  non-hashed js/css no-cache (hot reload); everything else 1 hour. */
 function setCacheHeaders(res: ServerResponse, filePath: string): void {
   const ext = extname(filePath).toLowerCase();
   if (ext === '.html' || ext === '.htm') {
     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
     return;
   }
   const hasHash = /\.[a-f0-9]{6,}\./.test(filePath);
   if ((ext === '.js' || ext === '.css') && hasHash) {
     res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
     return;
   }
   if (ext === '.js' || ext === '.css') {
     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
     return;
   }
   res.setHeader('Cache-Control', 'public, max-age=3600');
 }
 
 const staticHandlerCache = new Map<string, ReturnType<typeof expressStatic>>();
 
 function getStaticHandler(distDir: string): ReturnType<typeof expressStatic> {
   let handler = staticHandlerCache.get(distDir);
   if (!handler) {
     handler = expressStatic(distDir, {
       index: ['index.html'],
       setHeaders: (res, filePath) => setCacheHeaders(res, filePath),
     });
     staticHandlerCache.set(distDir, handler);
   }
   return handler;
 }
 
 // In-memory dedupe for the unauthenticated app-health probe (carried: per-restart
 // only; the next divergent report writes through). Keyed by resolved appId.
 const APP_HEALTH_DEDUPE_MS = 60_000;
 const appHealthLastSeen = new Map<string, { status: 'healthy' | 'broken'; at: number }>();
 
 export function __resetAppHealthDedupeForTests(): void {
   appHealthLastSeen.clear();
 }
 
 /** The demo-bridge client (guided-tour postMessage machine), served at
  *  /__ekoa/demo-bridge.js. Ported verbatim as a data asset. */
 const DEMO_BRIDGE_PATH = join(__dirname, '..', '..', 'assets', 'demo-bridge-client.js');
 let demoBridgeSource = '/* ekoa demo bridge unavailable */';
 try {
   demoBridgeSource = readFileSync(DEMO_BRIDGE_PATH, 'utf-8');
 } catch (err) {
   console.error('[demo-bridge] client unavailable:', err instanceof Error ? err.message : String(err));
 }
 
 /** The in-page action runtime (executes a generated app's declared ui_actions;
  *  operator-run C3), served at /__ekoa/action-runtime.js. Same read-once-at-boot
  *  posture and unavailable-fallback as the demo bridge. */
 const ACTION_RUNTIME_PATH = join(__dirname, '..', '..', 'assets', 'action-runtime-client.js');
 let actionRuntimeSource = '/* ekoa action runtime unavailable */';
 try {
   actionRuntimeSource = readFileSync(ACTION_RUNTIME_PATH, 'utf-8');
 } catch (err) {
   console.error('[action-runtime] client unavailable:', err instanceof Error ? err.message : String(err));
 }
 
+/** The operator assistant panel runtime (AssistantPanel + tour player, React included;
+ *  operator-run G2), served at /__ekoa/panel-runtime.js. Same read-once-at-boot posture
+ *  and unavailable-fallback as the action runtime. UNLIKE the action runtime it is NOT
+ *  eagerly injected: the app bundle carries only a tiny launcher that lazy-loads this
+ *  asset on first interaction/idle. The asset is BUILT (npm run build --workspace api ->
+ *  assets/panel-runtime.js, gitignored); a missing build serves the clear comment body. */
+const PANEL_RUNTIME_PATH = join(__dirname, '..', '..', 'assets', 'panel-runtime.js');
+let panelRuntimeSource = '/* ekoa panel runtime unavailable */';
+try {
+  panelRuntimeSource = readFileSync(PANEL_RUNTIME_PATH, 'utf-8');
+} catch (err) {
+  console.error('[panel-runtime] client unavailable:', err instanceof Error ? err.message : String(err));
+}
+
 export function servingRouter(deps: ServingDeps): Router {
   const r = Router();
 
   // All /apps/* responses carry CORS * (carried; §7.5).
   r.use('/apps', (_req, res, next) => {
     res.header('Access-Control-Allow-Origin', '*');
     next();
   });
 
   r.use('/apps/:appId', async (req: Request, res: Response) => {
     const appId = req.params.appId as string;
 
     // 301 trailing-slash redirect (carried): without it the browser resolves the
     // app's relative asset URLs against /apps/ and every asset 404s.
     const urlPath = req.originalUrl.split('?')[0] as string;
     if (req.path === '/' && !urlPath.endsWith('/')) {
       res.redirect(301, `${urlPath}/${req.originalUrl.slice(urlPath.length)}`);
       return;
     }
 
     // Canonical id: slug lookup first, raw id fallback (data stability; §7.5 step 2).
     const canonicalAppId = getAppIdBySlug(appId) || appId;
 
     // Shareability gate (§7.7): DOCUMENT requests only - browsers do not propagate
     // ?token= on sub-resource fetches, so gating assets would blank the iframe; the
     // HTML gate is the security boundary. Hardening over the old plane (which skipped
     // this for any registry hit): a revoked-then-registered artifact reached by its
     // canonical id must still 410. lookupShareable returns `ok` for featured artifacts
     // (revoke does not apply) and `not-found` for dev-serve/unregistered apps (no
     // artifact record - they fall through and serve), so only a genuinely revoked
     // artifact is gated. See RUN_LOG (G6 review, Codex finding 1).
     if (!ASSET_EXT_RE.test(req.path)) {
       const lookup = await lookupShareable(appId);
       if (lookup.kind === 'revoked') {
         // Owners may view their own non-shareable artifacts. Requester-token
         // resolution order carried: Authorization header, ekoa_token cookie,
         // ?token= query (Q-05 resolved).
         const cookieHeader = (req.headers.cookie || '') as string;
         const cookieToken = /(?:^|;\s*)ekoa_token=([^;]+)/.exec(cookieHeader)?.[1];
         const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/, '') || undefined;
         const queryToken = (req.query.token as string | undefined) || undefined;
         const token = headerToken || cookieToken || queryToken;
 
         let isOwner = false;
         if (token) {
           // Purpose-scoped preview token first (the per-build verifier's capability: view THIS
           // artifact only, short TTL - never a user JWT in an agent transcript).
           const previewArtifactId = verifyPreviewToken(token);
           if (previewArtifactId && previewArtifactId === canonicalAppId) {
             isOwner = true;
           } else {
             try {
               const claims = deps.verifyToken(token);
               const resolvedAppId = getAppIdBySlug(appId) || appId;
               const artifact = await artifacts.get(resolvedAppId);
               if (artifact && artifact.userId === claims.sub) isOwner = true;
             } catch {
               /* invalid token -> not the owner */
             }
           }
         }
 
         if (!isOwner) {
           res
             .status(410)
             .setHeader('Content-Type', 'text/html')
             .send(
               '<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:3rem;">' +
                 '<h2>Link já não disponível</h2>' +
                 '<p>O autor revogou a partilha deste artefacto.</p>' +
                 '</body></html>',
             );
           return;
         }
         // Owner: fall through to static serving below.
       }
     }
 
     // Honest failed-build state (F7): before serving anything, if this artifact's build genuinely
     // FAILED (never activated, no build ever completed, latest build failed) show a failed-state
     // page rather than a scaffold shell (a registered failed dist) or a "Building…" spinner
     // forever. A prior completed build (stale-good) or an in-flight build is NOT gated here. A
     // store error must NEVER break serving — fall through to the normal path on any failure.
     try {
       const failArtifact = (await artifacts.get(canonicalAppId)) as (Doc & { status?: string }) | null;
       if (failArtifact && failArtifact.status !== 'active' && (await servedBuildDisposition(canonicalAppId)) === 'failed') {
         sendAppBuildFailedResponse(req, res);
         return;
       }
     } catch {
       /* disposition check unavailable (store hiccup) — never block serving; fall through */
     }
 
     let distDir = resolveAppDistDir(appId);
 
     // Lazy heal (§7.5 step 5): one-shot; falls through to the placeholder on failure.
     if (!distDir) {
       const healed = await tryRegisterAppFromInstance(appId, deps);
       if (healed) distDir = resolveAppDistDir(appId);
     }
 
     if (!distDir) {
       sendAppBuildingResponse(req, res);
       return;
     }
 
     // HTML requests (any non-asset path - this is also the deep-route entry):
     // inject the context and serve with no-cache. A dist without index.html is
     // the mid-build window -> the placeholder, never a dead-end 404.
     if (!ASSET_EXT_RE.test(req.path)) {
       const indexPath = join(distDir, 'index.html');
       try {
         const html = readFileSync(indexPath, 'utf-8');
         res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
         res.setHeader('Content-Type', 'text/html');
         res.send(injectAppContext(html, canonicalAppId));
         return;
       } catch {
         sendAppBuildingResponse(req, res);
         return;
       }
     }
 
     const staticHandler = getStaticHandler(distDir);
     staticHandler(req, res, () => {
       // Static miss. Asset extension -> JSON 404 (HTML-as-JS causes parse errors);
       // navigation -> SPA fallback to the injected index.html.
       if (ASSET_EXT_RE.test(req.path)) {
         res.status(404).json({ error: `Asset not found: ${req.path}` });
         return;
       }
       const indexPath = join(distDir as string, 'index.html');
       try {
         const html = readFileSync(indexPath, 'utf-8');
         res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
         res.setHeader('Content-Type', 'text/html');
         res.send(injectAppContext(html, canonicalAppId));
       } catch {
         res.status(404).json({ error: 'App has no index.html' });
       }
     });
   });
 
   // Demo bridge client (§7.6; ch03 §3.8.23) - headers carried.
   r.get('/__ekoa/demo-bridge.js', (_req, res) => {
     res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
     res.setHeader('Access-Control-Allow-Origin', '*');
     res.setHeader('Cache-Control', 'public, max-age=300');
     res.send(demoBridgeSource);
   });
 
   // In-page action runtime (operator-run C3) - same byte-serving posture as the
   // demo bridge (JS content-type, CORS *, 5-min cache).
   r.get('/__ekoa/action-runtime.js', (_req, res) => {
     res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
     res.setHeader('Access-Control-Allow-Origin', '*');
     res.setHeader('Cache-Control', 'public, max-age=300');
     res.send(actionRuntimeSource);
   });
 
+  // Operator assistant panel runtime (operator-run G2) - lazy-loaded by the app
+  // bundle's launcher (not eagerly injected). Same byte-serving posture as the action
+  // runtime (JS content-type, CORS *, 5-min cache).
+  r.get('/__ekoa/panel-runtime.js', (_req, res) => {
+    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
+    res.setHeader('Access-Control-Allow-Origin', '*');
+    res.setHeader('Cache-Control', 'public, max-age=300');
+    res.send(panelRuntimeSource);
+  });
+
   // Public demo registry (ch03 §3.8.23, carried): versioned demo specs + assets.
   // ALL public (pre-login landing panel + cross-origin served apps). Assets mount
   // BEFORE /:appId so an asset path is never mistaken for an appId; fallthrough
   // off -> 404 on miss, dotfiles denied (path-traversal posture carried).
   r.use('/api/demos/assets', (_req, res, next) => {
     res.header('Access-Control-Allow-Origin', '*');
     res.header('Cache-Control', 'public, max-age=3600');
     next();
   });
   r.use(
     '/api/demos/assets',
     expressStatic(demoAssetsDir(), { maxAge: '1h', fallthrough: false, index: false, dotfiles: 'deny' }),
   );
   r.get('/api/demos', (_req, res) => {
     res.setHeader('Cache-Control', 'no-store');
     res.json({ demos: listDemoCards() });
   });
   r.get('/api/demos/:appId', async (req, res) => {
     res.setHeader('Cache-Control', 'no-store');
     const appIdParam = String(req.params.appId || '');
     // Platform catalog first (the 28 shipped legal-*.json tours) — shape unchanged.
     const spec = getDemoSpec(appIdParam);
     if (spec) {
       res.json(spec);
       return;
     }
     // operator-run E1: per-app tours generated at build time are stored WITH the
     // artifact (artifact.data.tours). Resolve the artifact (slug or raw id, the
     // same order /apps/* uses) and return its OVERVIEW tour as the single-spec
     // body — backward-compatible shape. The full overview+journey set stays on
     // the artifact for the in-app panel player (E2). Revalidated through the
     // registry's parser so the served shape is one source of truth.
     try {
       const artifactId = getAppIdBySlug(appIdParam) ?? appIdParam;
       const art = (await artifacts.get(artifactId)) as Doc | null;
       // Defence in depth: `tours`/`toursError` are server-owned reserved keys (set only at
       // activation from the app's OWN project, stripped from client patches), so a stored tour's
       // `appId` is the activation-stamped artifact id. We still filter by the RESOLVED id here so
       // a tour can only ever be served under the artifact it belongs to — provenance, not just shape.
       const tours = parseStoredTours((art?.data as { tours?: unknown } | undefined)?.tours)
         .filter((t) => t.appId === artifactId);
       const overview = tours.find((t) => t.kind === 'overview') ?? tours[0];
       if (overview) {
         res.json(overview);
         return;
       }
     } catch (err) {
       console.warn('[serving] generated-tour resolution failed (non-fatal):', err instanceof Error ? err.message : err);
     }
     res.status(404).json({ error: 'Demonstração não encontrada' });
   });
 
   // In-page health probe sink (§7.11, carried): no auth (probes have no token);
   // identity from X-Ekoa-App-Id (id or slug); unknown ids dropped silently;
   // featured artifacts skipped; 60 s same-status dedupe; verdict persisted.
   r.post('/api/app-health', async (req, res) => {
     res.setHeader('Access-Control-Allow-Origin', '*');
     try {
       const headerId = (req.headers['x-ekoa-app-id'] as string | undefined) || '';
       if (!headerId) {
         res.status(204).end();
         return;
       }
       const resolvedId = getAppIdBySlug(headerId) || headerId;
       const artifact = await artifacts.get(resolvedId);
       if (!artifact || artifact.featured === true) {
         res.status(204).end();
         return;
       }
 
       const body = req.body as {
         status?: 'healthy' | 'broken';
         reason?: 'uncaught-error' | 'unhandled-rejection' | 'empty-dom' | null;
         errorMessage?: string | null;
         capturedAt?: string;
       };
       const status = body?.status;
       if (status !== 'healthy' && status !== 'broken') {
         res.status(204).end();
         return;
diff --git a/api/tests/apps/panel-lazy.test.ts b/api/tests/apps/panel-lazy.test.ts
new file mode 100644
index 0000000..4ed2d4d
--- /dev/null
+++ b/api/tests/apps/panel-lazy.test.ts
@@ -0,0 +1,118 @@
+import { describe, it, expect } from 'vitest';
+import { readFileSync, existsSync } from 'node:fs';
+import { fileURLToPath } from 'node:url';
+// The panel-runtime compile step is an untyped build helper (.mjs, outside the api src
+// project) - drive it directly rather than typing the module.
+// @ts-expect-error no declaration file for the panel-runtime build helper
+import { buildPanelRuntime } from '../../assets/panel-runtime/build.mjs';
+
+/**
+ * operator-run G2 - the assistant panel is now a PLATFORM-SERVED runtime asset, lazily
+ * loaded by a tiny plain-DOM launcher in the app bundle (the C3 pattern), instead of
+ * being baked into every generated app's bundle with its own React copy.
+ *
+ * This suite pins the STRUCTURAL invariants of that move (the behaviour is proven live
+ * by tests/e2e/panel-perf.e2e.mjs):
+ *   (a) the panel source LEFT the scaffold: the app-bundle assistant dir carries ONLY
+ *       the launcher (mount.js) - AssistantPanel.jsx / tour-player.js / the CSS moved to
+ *       api/assets/panel-runtime/src, so a fresh app bundle no longer parses the panel or
+ *       a second React on first paint;
+ *   (b) the launcher (mount.js) is React-FREE and stays tiny (a measured byte budget), so
+ *       the only assistant cost in the app bundle is a small plain-DOM launcher;
+ *   (c) the panel-runtime esbuild step compiles clean OFFLINE into one self-contained
+ *       IIFE (same in-process real-esbuild posture as tests/apps/builder.test.ts);
+ *   (d) the compiled asset self-mounts (#ekoa-assistant-root) and carries NO provider
+ *       reference (egress hygiene - it bundles React + the panel, nothing else).
+ */
+
+const SCAFFOLD_ASSIST = new URL(
+  '../../assets/bases/app/scaffold/frontend/src/lib/assistant/',
+  import.meta.url,
+);
+const PANEL_SRC = new URL('../../assets/panel-runtime/src/', import.meta.url);
+
+const scaffoldFile = (rel: string) => fileURLToPath(new URL(rel, SCAFFOLD_ASSIST));
+const panelSrcFile = (rel: string) => fileURLToPath(new URL(rel, PANEL_SRC));
+
+// Measured baseline of the React-free launcher (2026-07-13): 5273 bytes. The budget is
+// set at 8192 bytes (~1.55x the baseline) - defensible headroom for edits while guarding
+// against the launcher ever regrowing into a heavy in-bundle module (the whole point of
+// G2 is that the app bundle stops carrying the panel + a second React).
+const MOUNT_BYTE_BUDGET = 8192;
+
+describe('G2 panel move - source left the app scaffold', () => {
+  it('the app-bundle assistant dir carries ONLY the launcher (mount.js)', () => {
+    expect(existsSync(scaffoldFile('mount.js'))).toBe(true);
+    // The heavy panel/player/CSS are gone from the app bundle - they moved platform-side.
+    expect(existsSync(scaffoldFile('AssistantPanel.jsx'))).toBe(false);
+    expect(existsSync(scaffoldFile('AssistantPanel.css'))).toBe(false);
+    expect(existsSync(scaffoldFile('tour-player.js'))).toBe(false);
+  });
+
+  it('the panel source now lives in the platform panel-runtime dir', () => {
+    expect(existsSync(panelSrcFile('index.jsx'))).toBe(true); // the self-mounting entry
+    expect(existsSync(panelSrcFile('AssistantPanel.jsx'))).toBe(true);
+    expect(existsSync(panelSrcFile('AssistantPanel.css'))).toBe(true);
+    expect(existsSync(panelSrcFile('tour-player.js'))).toBe(true);
+  });
+});
+
+describe('G2 launcher - React-free + under the byte budget', () => {
+  const MOUNT = readFileSync(scaffoldFile('mount.js'), 'utf-8');
+
+  it('imports no React and never mounts a React root (plain DOM only)', () => {
+    expect(MOUNT).not.toMatch(/from\s+['"]react/);
+    expect(MOUNT).not.toMatch(/require\(\s*['"]react/);
+    expect(MOUNT).not.toContain('createRoot');
+    expect(MOUNT).not.toContain('react-dom');
+  });
+
+  it('renders the launcher immediately and lazy-loads the platform panel-runtime', () => {
+    // Plain-DOM launcher, brand-consistent (same class + CSS-var contract), PT-PT + aria.
+    expect(MOUNT).toContain('ekoa-assistant-launcher');
+    expect(MOUNT).toContain('Assistente');
+    expect(MOUNT).toContain('Abrir o assistente');
+    // Lazy loader: it injects the platform asset on interaction/idle (not eagerly).
+    expect(MOUNT).toContain('/__ekoa/panel-runtime.js');
+    expect(MOUNT).toMatch(/requestIdleCallback/);
+    // Handoff intent flag consumed by the asset's index.jsx.
+    expect(MOUNT).toContain('__ekoaAssistantAutoOpen');
+    // No emoji (UI-code rule).
+    const m = MOUNT.match(/\p{Extended_Pictographic}/u);
+    expect(m, m ? `mount emoji: ${JSON.stringify(m[0])}` : '').toBeNull();
+  });
+
+  it('stays under the measured byte budget', () => {
+    const bytes = Buffer.byteLength(MOUNT, 'utf-8');
+    expect(bytes, `mount.js is ${bytes} bytes, budget ${MOUNT_BYTE_BUDGET}`).toBeLessThanOrEqual(
+      MOUNT_BYTE_BUDGET,
+    );
+  });
+});
+
+describe('G2 panel-runtime asset - compiles clean + self-mounts + egress-clean', () => {
+  it('compiles offline into one self-contained IIFE with no build errors', async () => {
+    const { code, errors } = await buildPanelRuntime({ write: false });
+    expect(errors, JSON.stringify(errors)).toEqual([]);
+    expect(code.length).toBeGreaterThan(1000);
+    // IIFE (browser format) - not an ESM module the served plane could not run.
+    expect(code).toMatch(/\(\(\)\s*=>\s*\{/);
+    expect(code).not.toMatch(/^\s*export\s/m);
+  }, 60_000);
+
+  it('self-mounts into #ekoa-assistant-root and injects its own styles', async () => {
+    const { code } = await buildPanelRuntime({ write: false });
+    expect(code).toContain('ekoa-assistant-root'); // the self-mount marker survives minify
+    expect(code).toContain('data-ekoa-panel'); // the css-inject style tag
+  }, 60_000);
+
+  it('carries NO provider reference (egress hygiene)', async () => {
+    const { code } = await buildPanelRuntime({ write: false });
+    // A single case-insensitive `anthropic` absence check covers BOTH banned forms
+    // (`@anthropic-ai` and `api.anthropic.com` each contain the token). The needle is
+    // split so this test file stays clean of the literal token the chokepoint grep
+    // gate scans for.
+    const ANTHROPIC = 'anthrop' + 'ic';
+    expect(new RegExp(ANTHROPIC, 'i').test(code)).toBe(false);
+  }, 60_000);
+});
diff --git a/api/tests/e2e/panel-perf.e2e.mjs b/api/tests/e2e/panel-perf.e2e.mjs
new file mode 100644
index 0000000..0a23e8c
--- /dev/null
+++ b/api/tests/e2e/panel-perf.e2e.mjs
@@ -0,0 +1,346 @@
+#!/usr/bin/env node
+/**
+ * PANEL LAZY-LOAD PERF live gate - committed, re-runnable end-to-end driver (operator-run G2).
+ *
+ * Since G2 the operator assistant panel is a PLATFORM-SERVED runtime asset
+ * (/__ekoa/panel-runtime.js, React + panel + tour player in one IIFE), lazily loaded by a
+ * tiny plain-DOM launcher the app bundle carries (the scaffold's mount.js). It is NOT baked
+ * into every generated app's bundle anymore, and the C3 action runtime stays EAGERLY
+ * injected (actions work with the panel never opened). This driver proves the lazy-load
+ * behaviour live in a REAL served app-base app driven by a real Chromium on the credentialed
+ * boot-b stack:
+ *
+ *   A. LAUNCHER IMMEDIATE, PANEL NOT FETCHED. On app load the launcher ("Assistente") is
+ *      visible immediately AND the panel-runtime route has NOT been requested yet (request
+ *      absence asserted from page start) - the panel parses zero React on first paint.
+ *   B. LOAD-ON-INTERACTION. Clicking the launcher triggers EXACTLY ONE GET
+ *      /__ekoa/panel-runtime.js and the panel opens (first-open intro visible). By the end
+ *      the count is still exactly one - the idle preload never double-fetches.
+ *   C. TOUR STILL PLAYS after the lazy mount. The lazy-mounted panel plays a pre-generated
+ *      tour SAME-DOCUMENT (E2 regression guard): teach launcher -> GET /api/demos/:appId ->
+ *      navigate + spotlight (C3 ring on the real element) + await-action (real click) +
+ *      inject-prompt (lands in the composer, unsent) -> "Tutorial concluído.".
+ *   D. ZERO TOKENS. No POST /api/app-assistant fires at ANY point (loading/mounting the
+ *      panel and playing a tour are both zero-token) - asserted by a request counter.
+ *   E. ZERO non-benign page JS console errors throughout (the SAME documented allowlist as
+ *      the D2/E2 drivers: favicon 404 + anonymous whoami 401 + dev-proxy app-health 5xx).
+ *
+ * DETERMINISM. A committed gate cannot depend on what a generation produced nor on the model
+ * authoring a tour, so the served tour is the SAME schema-valid overview fixture the E2 gate
+ * uses, fulfilled at the browser boundary (page.route) - a schema-validated stub, the only
+ * stub QA permits. The app under it is REAL (built through the jobs pipeline), so its shell
+ * landmarks (app-nav / app-content) are genuinely emitted; one app-specific registry-ID
+ * target (e2-tour-alvo) is planted in the page (same technique as the E2/C5/D3 gates). Every
+ * assertion is STRUCTURAL - request presence/absence + count, tour status, spotlight geometry,
+ * composer value - never on model prose.
+ *
+ * TRANSIENT TOLERANCE. The boot-b dev CORS proxy can answer a pre-response upstream socket
+ * error with a text/plain 502 while a busy api is deep in a heavy build phase
+ * (docs/findings.md F-2026-07-12-preview-502). The build-status poll is therefore blip-tolerant
+ * (safeJson never throws on a non-JSON body; transients are retried, bounded). The one call
+ * NEVER retried is the build-creation POST - a fresh build has no dedup key, so a retry would
+ * spawn a second build; a blip there fails loud.
+ *
+ * Black-box over the running dev cortex (backend.port, the boot-b proxy) + a real Chromium.
+ * Builds ONE fresh app-base app (verify OFF - nondeterministic + orthogonal, same as
+ * C5/D2/D3/E2/F2/G1). The panel-runtime asset must be BUILT + SERVED (npm run build --workspace
+ * api produces assets/panel-runtime.js; restart the stack) before this runs. Run:
+ * node tests/e2e/panel-perf.e2e.mjs
+ */
+import { readFileSync } from 'node:fs';
+import { join, dirname } from 'node:path';
+import { fileURLToPath } from 'node:url';
+import { chromium } from 'playwright';
+
+const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
+const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
+const BASE = `http://localhost:${PORT}`;
+const ADMIN = { username: 'admin', password: 'tmp12345' };
+const EVID = join(REPO_ROOT, 'docs', 'autothing', 'runs', '20260712-150958-4bb23640', 'slices', 'G2');
+
+// 20min: a real build on a fresh boot-b stack was observed completing at ~12min (2026-07-13,
+// fees-knowledge gate), so the old 10min deadline was miscalibrated for cold-stack builds.
+const BUILD_TIMEOUT_MS = 20 * 60_000;
+// Consecutive transient (proxy-error / non-JSON) build-poll responses tolerated before failing loud.
+const MAX_POLL_TRANSIENTS = 30;
+// The panel-runtime asset the app bundle's launcher lazily loads.
+const PANEL_RUNTIME_PATH = '/__ekoa/panel-runtime.js';
+// The app-specific (non-landmark) registry-ID target the tour spotlights - planted in the page
+// like the E2/C5/D3 gates so the surface is deterministic.
+const PLANTED_TARGET = 'e2-tour-alvo';
+
+// The schema-valid overview tour the panel fetches - the SAME fixture the unit test validates
+// against demoSpecSchema (tests/apps/tour-player.test.ts), so this "stub" is a schema-validated
+// stub. Targets are data-demo-target NAMES: shell-chrome landmarks (app-nav/app-content,
+// rebuild-stable) plus the planted app target.
+const TOUR_FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'e2-overview-tour.json'), 'utf-8'));
+const INJECT_PROMPT = TOUR_FIXTURE.steps.find((s) => s.type === 'inject-prompt').prompt;
+
+/** The fixture tour with `appId` stamped to the built artifact (as a real serve would). */
+function buildTour(appId) {
+  return { ...TOUR_FIXTURE, appId };
+}
+
+const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
+function fail(msg) { console.error(`E2E FAIL: ${msg}`); process.exit(1); }
+function ok(msg) { console.log(`PASS ${msg}`); }
+function assert(cond, msg) { if (!cond) fail(msg); }
+
+/**
+ * Fetch + parse JSON WITHOUT throwing. Returns { ok, status, json, text }. A non-2xx status or a
+ * body that is not valid JSON (e.g. the dev-proxy's text/plain "proxy error" 502) comes back as
+ * ok:false with the raw text, so callers can treat it as a transient rather than crashing the gate
+ * (findings F-2026-07-12-preview-502).
+ */
+async function safeJson(url, init) {
+  try {
+    const r = await fetch(url, init);
+    const text = await r.text();
+    let json = null;
+    try { json = JSON.parse(text); } catch { /* non-JSON: proxy error text, HTML, empty */ }
+    return { ok: r.ok && json !== null, status: r.status, json, text };
+  } catch (e) {
+    return { ok: false, status: 0, json: null, text: String(e && e.message ? e.message : e) };
+  }
+}
+
+async function login() {
+  for (let i = 0; i < 10; i++) {
+    const res = await safeJson(`${BASE}/api/v1/auth/login`, {
+      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN),
+    });
+    if (res.ok && res.json.token) return res.json.token;
+    await sleep(500);
+  }
+  fail('login failed after retries');
+}
+
+/** Build ONE fresh app-base app through the real jobs pipeline (verify OFF - nondeterministic +
+ *  orthogonal, same pattern as C5/D2/D3/E2). The build-creation POST is NEVER retried (no dedup
+ *  key); the status poll tolerates bounded dev-proxy transients. */
+async function buildSampleApp(token) {
+  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
+  await fetch(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
+  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'g2-panel-perf' }) })).json();
+  const created = await (await fetch(`${BASE}/api/v1/jobs`, {
+    method: 'POST', headers: H,
+    body: JSON.stringify({ kind: 'build', sessionId: s.id, language: 'pt', templateId: 'app', description: 'Um registo simples de clientes do escritório com nome e telefone' }),
+  })).json();
+  if (!created.job || !created.job.id) fail(`build not created: ${JSON.stringify(created)}`);
+  const jobId = created.job.id;
+  const deadline = Date.now() + BUILD_TIMEOUT_MS;
+  let transients = 0;
+  for (;;) {
+    if (Date.now() > deadline) fail(`build ${jobId} did not finish in 20min`);
+    await sleep(6000);
+    const res = await safeJson(`${BASE}/api/v1/jobs/${jobId}`, { headers: H });
+    if (!res.ok || !res.json) {
+      if (++transients > MAX_POLL_TRANSIENTS) fail(`build poll: too many transients (last: ${res.status} ${String(res.text).slice(0, 120)})`);
+      continue;
+    }
+    transients = 0;
+    const job = res.json;
+    if (job.status === 'completed') return job.artifactId;
+    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
+  }
+}
+
+/**
+ * Benign console-error allowlist - COPIED VERBATIM from the D2/E2 drivers
+ * (assistant-panel.e2e.mjs / tour-playback.e2e.mjs). None is G2 code; each fires on EVERY served
+ * app. Every OTHER console error fails the gate (strict).
+ */
+function benign(entry) {
+  const url = String(entry.url || '');
+  const text = String(entry.text || '');
+  // 1. favicon: the browser auto-requests /favicon.ico and served apps ship none → 404. Not app code.
+  if (/favicon/i.test(`${url} ${text}`)) return true;
+  // 2. Anonymous SSO whoami probe (injected-context.ts): window.__ekoa.whoami() GETs
+  //    /api/app-sso/me and treats 401 as the normal "no visitor session" state (returns null). The
+  //    401 is the EXPECTED anonymous state; the browser merely logs the failed resource. Pre-existing.
+  if (url.endsWith('/api/app-sso/me') && /\b401\b/.test(text)) return true;
+  // 3. Injected health beacon (injected-context.ts): POSTs /api/app-health (keepalive) on load;
+  //    through the boot-b dev CORS proxy this returns 5xx (a proxy artifact — same-origin prod does
+  //    not proxy the beacon). Pre-existing dev-harness noise on every served app, not G2 code.
+  if (url.endsWith('/api/app-health') && /\b5\d\d\b/.test(text)) return true;
+  return false;
+}
+
+/** Plant the app-specific tour target as a direct child of <body> (React never reclaims it -
+ *  same technique as the E2/C5/D3 gates). */
+async function plant(page) {
+  await page.evaluate((target) => {
+    if (!document.querySelector('[data-demo-target="' + target + '"]')) {
+      const el = document.createElement('div');
+      el.setAttribute('data-demo-target', target);
+      el.style.cssText = 'position:fixed;top:8px;left:8px;width:200px;height:36px;z-index:1;background:#fff;border:1px solid #ccc;';
+      document.body.appendChild(el);
+    }
+  }, PLANTED_TARGET);
+}
+
+/** Geometry check: the tour spotlight ring is drawn AROUND the real element that carries
+ *  `data-demo-target=<name>` (proves the highlight matches a real element). */
+async function spotlightSurrounds(page, name) {
+  return page.evaluate((n) => {
+    const overlay = document.querySelector('[data-ekoa-actions-ui="spotlight"]');
+    if (!overlay) return { ok: false, reason: 'no-spotlight-overlay' };
+    const ring = overlay.firstElementChild;
+    const target = document.querySelector('[data-demo-target="' + n + '"]');
+    if (!ring) return { ok: false, reason: 'no-ring' };
+    if (!target) return { ok: false, reason: 'no-target' };
+    const rr = ring.getBoundingClientRect();
+    const tr = target.getBoundingClientRect();
+    // buildRingOverlay draws the ring at the target rect inflated by 4px each side.
+    const near = Math.abs(rr.left - (tr.left - 4)) < 8 && Math.abs(rr.top - (tr.top - 4)) < 8 && Math.abs(rr.width - (tr.width + 8)) < 12 && Math.abs(rr.height - (tr.height + 8)) < 12;
+    return { ok: near, ring: { l: rr.left, t: rr.top, w: rr.width, h: rr.height }, target: { l: tr.left, t: tr.top, w: tr.width, h: tr.height } };
+  }, name);
+}
+
+async function advance(page) {
+  await page.locator('.ekoa-assistant-tour-next').click();
+}
+
+async function main() {
+  const token = await login();
+  ok('admin login');
+
+  const artifactId = await buildSampleApp(token);
+  ok(`fresh app-base app built (${artifactId}) - the app bundle carries only the lazy launcher`);
+
+  const browser = await chromium.launch();
+  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
+  const page = await context.newPage();
+
+  // --- Instrumentation: collect from page start. ---
+  const consoleErrors = [];
+  page.on('console', (msg) => {
+    if (msg.type() === 'error') { const loc = msg.location(); consoleErrors.push({ text: msg.text(), url: loc && loc.url }); }
+  });
+  page.on('pageerror', (err) => consoleErrors.push({ text: `pageerror: ${err && err.message}`, url: '' }));
+
+  // Panel-runtime fetches (the lazy asset) + assistant model POSTs (must stay 0), counted for the
+  // whole session so the gate can prove request ABSENCE before interaction and EXACTLY ONE fetch.
+  let panelRuntimeReqs = 0;
+  let assistantPosts = 0;
+  page.on('request', (req) => {
+    if (req.url().includes(PANEL_RUNTIME_PATH)) panelRuntimeReqs += 1;
+    if (req.method() === 'POST' && req.url().includes('/api/app-assistant')) assistantPosts += 1;
+  });
+
+  // Deterministic served tour: fulfil the panel's GET /api/demos/:appId at the browser boundary
+  // with the schema-valid overview fixture (a schema-validated stub). Count the fulfils so the gate
+  // PROVES the lazy-mounted panel actually fetched the route.
+  let demosFetches = 0;
+  await page.route('**/api/demos/**', (route) => {
+    demosFetches += 1;
+    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildTour(artifactId)) });
+  });
+
+  const appUrl = `${BASE}/apps/${artifactId}/`;
+  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
+
+  // ============================================================================
+  // A. LAUNCHER IMMEDIATE, PANEL NOT FETCHED YET.
+  // ============================================================================
+  const launcher = page.locator('.ekoa-assistant-launcher');
+  await launcher.waitFor({ state: 'visible', timeout: 30_000 });
+  const launcherText = (await launcher.innerText()).trim();
+  assert(/Assistente/i.test(launcherText), `launcher text is "${launcherText}", expected to contain "Assistente"`);
+  // The panel-runtime must NOT have been requested before any interaction (true lazy). The launcher
+  // renders synchronously from the tiny app-bundle mount.js; the idle preload is floored well beyond
+  // this point, so this holds deterministically.
+  assert(panelRuntimeReqs === 0, `panel-runtime was fetched (${panelRuntimeReqs}) BEFORE any interaction - not lazy`);
+  assert(assistantPosts === 0, `an assistant POST fired before interaction (${assistantPosts})`);
+  await page.screenshot({ path: join(EVID, 'live-01-launcher-no-fetch.png') });
+  ok('A: launcher visible immediately with NO panel-runtime fetch yet (zero React parsed on first paint)');
+
+  // ============================================================================
+  // B. LOAD-ON-INTERACTION: click -> exactly one panel-runtime fetch -> panel opens.
+  // ============================================================================
+  await launcher.click();
+  await page.waitForRequest((req) => req.url().includes(PANEL_RUNTIME_PATH), { timeout: 15_000 });
+  const intro = page.locator('.ekoa-assistant-intro-lead');
+  await intro.waitFor({ state: 'visible', timeout: 15_000 });
+  assert(panelRuntimeReqs === 1, `expected exactly one panel-runtime fetch on click, got ${panelRuntimeReqs}`);
+  const introText = (await intro.innerText()).toLowerCase();
+  assert(introText.includes('três formas'), `first-open lead missing "três formas": "${introText}"`);
+  await page.screenshot({ path: join(EVID, 'live-02-panel-open.png') });
+  ok('B: clicking the launcher triggered exactly ONE panel-runtime fetch and the panel opened');
+
+  // ============================================================================
+  // C. TOUR STILL PLAYS after the lazy mount (E2 regression guard).
+  // ============================================================================
+  await plant(page);
+  await page.waitForFunction(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined', { timeout: 15_000 });
+  // Pin Ensinar (teach) - a pure client action, no model call - to surface the tour launcher.
+  await page.locator('.ekoa-assistant-mode', { hasText: 'Ensinar' }).click();
+  const startBtn = page.locator('.ekoa-assistant-tour-start');
+  await startBtn.waitFor({ state: 'visible', timeout: 10_000 });
+  await startBtn.click();
+  const tour = page.locator('.ekoa-assistant-tour');
+  await tour.waitFor({ state: 'visible', timeout: 10_000 });
+  assert(demosFetches >= 1, `lazy-mounted panel never fetched GET /api/demos/:appId (fulfil count ${demosFetches})`);
+
+  // Step 1 (navigate, "Bem-vindo").
+  await tour.locator('.ekoa-assistant-tour-progress', { hasText: 'Passo 1 de 6' }).waitFor({ state: 'visible', timeout: 10_000 });
+  assert((await tour.locator('.ekoa-assistant-tour-copy-title').innerText()).includes('Bem-vindo'), 'step 1 copy missing "Bem-vindo"');
+  await advance(page);
+
+  // Step 2 (spotlight app-nav) - the C3 ring is drawn AROUND the real app-nav.
+  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
+  await page.locator('.ekoa-assistant-tour[data-tour-step-index="1"]').waitFor({ timeout: 10_000 });
+  let geo = await spotlightSurrounds(page, 'app-nav');
+  assert(geo.ok, `spotlight did not surround real app-nav: ${JSON.stringify(geo)}`);
+  await page.screenshot({ path: join(EVID, 'live-03-tour-spotlight.png') });
+  await advance(page);
+
+  // Step 3 (spotlight the planted app target).
+  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
+  geo = await spotlightSurrounds(page, PLANTED_TARGET);
+  assert(geo.ok, `spotlight did not surround ${PLANTED_TARGET}: ${JSON.stringify(geo)}`);
+  await advance(page);
+
+  // Step 4 (await-action app-nav click) - advances only when the user really clicks.
+  await page.locator('.ekoa-assistant-tour[data-tour-status="awaiting"]').waitFor({ timeout: 10_000 });
+  await page.locator('[data-demo-target="app-nav"] button').first().click();
+  await page.locator('.ekoa-assistant-tour[data-tour-step-index="4"]').waitFor({ timeout: 10_000 });
+
+  // Step 5 (spotlight app-content).
+  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
+  geo = await spotlightSurrounds(page, 'app-content');
+  assert(geo.ok, `spotlight did not surround app-content: ${JSON.stringify(geo)}`);
+  await advance(page);
+
+  // Step 6 (inject-prompt) - the suggested prompt lands in the composer, unsent.
+  await page.locator('.ekoa-assistant-tour-note').waitFor({ timeout: 10_000 });
+  const draftVal = await page.locator('.ekoa-assistant-textarea').inputValue();
+  assert(draftVal.trim() === INJECT_PROMPT, `inject-prompt did not land in the composer: "${draftVal}"`);
+  await advance(page);
+
+  // Done.
+  await page.locator('.ekoa-assistant-tour[data-tour-status="done"]').waitFor({ timeout: 10_000 });
+  await page.screenshot({ path: join(EVID, 'live-04-tour-done.png') });
+  ok('C: the lazy-mounted panel played the tour to "concluído" (navigate + spotlight + await-action + inject-prompt)');
+
+  // ============================================================================
+  // D. ZERO TOKENS throughout + still exactly one panel-runtime fetch (idle never double-loaded).
+  // ============================================================================
+  // Give the idle preload's floored timer time to have fired (a no-op once the click already loaded).
+  await sleep(2500);
+  assert(assistantPosts === 0, `an assistant model POST fired (${assistantPosts}) - loading the panel + playing a tour must be zero-token`);
+  assert(panelRuntimeReqs === 1, `panel-runtime fetched ${panelRuntimeReqs} times - the idle preload must not double-load after a click`);
+  ok('D: zero POST /api/app-assistant throughout; exactly one panel-runtime fetch (no idle double-load)');
+
+  // ============================================================================
+  // E. ZERO non-benign page JS console errors throughout.
+  // ============================================================================
+  const errors = consoleErrors.filter((e) => !benign(e));
+  if (errors.length) fail(`page console errors: ${JSON.stringify(errors, null, 2)}`);
+  ok('E: zero non-benign page JS console errors throughout');
+
+  await browser.close();
+  console.log('G2 LIVE GATE: PASS');
+}
+
+main().catch((e) => fail(e && e.stack ? e.stack : String(e)));

 succeeded in 34084ms:
../pnmui-mon/TASKS.md

hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_search started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_search (failed)
user cancelled MCP tool call
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba Dockerfile.api | sed -n '1,220p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	# syntax=docker/dockerfile:1
     2	# api/ container (ch14 Phase 13, Amendment 2 Part 7.20; P-02 two-container topology).
     3	# One conventional Node service: the Express 5 API on :4111. Secrets are NEVER baked in -
     4	# they arrive at runtime from Secret Manager (FIXED-14, C3); this image carries only code.
     5	# Multi-stage: build the shared + api workspaces with dev deps, then ship a lean runtime
     6	# image with production node_modules + the compiled dist/ only.
     7	
     8	# ---- build stage -----------------------------------------------------------
     9	FROM node:20-bookworm-slim AS build
    10	WORKDIR /app
    11	# Workspace manifests first for layer-cached installs.
    12	COPY package.json package-lock.json ./
    13	COPY shared/package.json shared/
    14	COPY api/package.json api/
    15	COPY web/package.json web/
    16	# Full install (workspaces) so tsc + the shared build resolve; --ignore-scripts avoids
    17	# building web's native optionals we don't need for the api image.
    18	RUN npm ci --ignore-scripts
    19	# Sources needed to compile shared + api (web is not built in this image).
    20	COPY tsconfig.base.json ./
    21	COPY shared/ shared/
    22	COPY api/ api/
    23	RUN npm run build --workspace shared && npm run build --workspace api
    24	
    25	# ---- runtime stage ---------------------------------------------------------
    26	FROM node:20-bookworm-slim AS runtime
    27	ENV NODE_ENV=production
    28	WORKDIR /app
    29	# Production-only dependencies (no dev/test toolchain in the shipped image).
    30	COPY package.json package-lock.json ./
    31	COPY shared/package.json shared/
    32	COPY api/package.json api/
    33	COPY web/package.json web/
    34	RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
    35	# Compiled output: shared/dist (api imports @ekoa/shared) + api/dist + api runtime assets.
    36	# Assets come FROM THE BUILD STAGE, not the host context: since G2 the api build also
    37	# produces api/assets/panel-runtime.js (gitignored build artifact - absent from a CI
    38	# checkout, possibly STALE on a dev machine). The build stage is the only place the
    39	# full, fresh asset set is guaranteed to exist (review-g2 Low-2, made concrete here).
    40	COPY --from=build /app/shared/dist shared/dist
    41	COPY --from=build /app/api/dist api/dist
    42	COPY --from=build /app/api/assets api/assets
    43	# Drop privileges: run as the built-in non-root `node` user.
    44	USER node
    45	EXPOSE 4111
    46	# PORT/ENCRYPTION_KEY/JWT_SECRET/MONGODB_URI/ANTHROPIC_* injected at runtime (Secret Manager).
    47	CMD ["node", "api/dist/server.js"]

hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "node -e \"const p=require('./api/package.json'); console.log(JSON.stringify(p.scripts,null,2))\"" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
{
  "build": "tsc -b && node assets/panel-runtime/build.mjs",
  "typecheck": "tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json",
  "test": "vitest run --passWithNoTests",
  "test:contract": "vitest run tests/contract",
  "dev": "node --watch --loader ts-node/esm src/server.ts",
  "start": "node dist/server.js",
  "tool:migrate": "node --loader ts-node/esm scripts/migrate/cli.ts",
  "tool:knowledge-import": "node --loader ts-node/esm scripts/migrate/knowledge/cli.ts",
  "tool:billing-replay": "node --loader ts-node/esm scripts/billing-replay/cli.ts",
  "tool:parity-workload": "node --loader ts-node/esm scripts/parity-workload/cli.ts"
}

codex
Medium `api/src/apps/serving.ts:281-293`, `api/src/apps/serving.ts:459-463`, `api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js:66-79`  
If `api/assets/panel-runtime.js` is missing at server boot, the route still returns `200 /* ekoa panel runtime unavailable */`. A `<script>` load of that body succeeds, so `s.onerror` never runs and `injected` stays `true`. The panel never mounts, the boot launcher stays visible, and every later click is a no-op until reload. The Dockerfile fix closes the container path, but this still breaks local/dev or any non-Docker boot that skips `npm run build --workspace api`.

Medium `api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js:75-78`, `api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js:107-112`, `api/assets/panel-runtime/src/index.jsx:68-69`  
A failed first click leaves `window.__ekoaAssistantAutoOpen = true` behind. `onerror` only resets `injected`; it never clears the open-intent flag. Concrete race: visitor clicks before the 2s idle timer, the script fetch fails transiently, then the scheduled idle preload succeeds later. `index.jsx` reads the stale flag and mounts the panel open even though there was no fresh click. That is exactly the stale-flag/lifecycle bug class this slice was supposed to harden.

Low `api/tests/apps/panel-lazy.test.ts:102-125`  
The structural test only compiles the runtime in memory from source. It does not exercise the actually served `panel-runtime.js` file or the missing-artifact fallback path above, so the most operationally important failure mode in this slice can still pass the unit gate.

VERDICT: NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
71,807
Medium `api/src/apps/serving.ts:281-293`, `api/src/apps/serving.ts:459-463`, `api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js:66-79`  
If `api/assets/panel-runtime.js` is missing at server boot, the route still returns `200 /* ekoa panel runtime unavailable */`. A `<script>` load of that body succeeds, so `s.onerror` never runs and `injected` stays `true`. The panel never mounts, the boot launcher stays visible, and every later click is a no-op until reload. The Dockerfile fix closes the container path, but this still breaks local/dev or any non-Docker boot that skips `npm run build --workspace api`.

Medium `api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js:75-78`, `api/assets/bases/app/scaffold/frontend/src/lib/assistant/mount.js:107-112`, `api/assets/panel-runtime/src/index.jsx:68-69`  
A failed first click leaves `window.__ekoaAssistantAutoOpen = true` behind. `onerror` only resets `injected`; it never clears the open-intent flag. Concrete race: visitor clicks before the 2s idle timer, the script fetch fails transiently, then the scheduled idle preload succeeds later. `index.jsx` reads the stale flag and mounts the panel open even though there was no fresh click. That is exactly the stale-flag/lifecycle bug class this slice was supposed to harden.

Low `api/tests/apps/panel-lazy.test.ts:102-125`  
The structural test only compiles the runtime in memory from source. It does not exercise the actually served `panel-runtime.js` file or the missing-artifact fallback path above, so the most operationally important failure mode in this slice can still pass the unit gate.

VERDICT: NEEDS-WORK
