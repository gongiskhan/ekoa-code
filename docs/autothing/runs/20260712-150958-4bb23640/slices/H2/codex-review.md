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
session id: 019f5d17-9488-7ac0-a381-3ce59d2e0397
--------
user
Adversarial SECURITY review in /Users/ggomes/dev/ekoa-code of commit 8b6116a (git show 8b6116a): slice H2 of a security block - a GET /api/app-assistant/whoami admin-DETECTION endpoint + panel detect-then-ask. The served-app assistant plane is deliberately visitor-blind (POST /api/app-assistant is header-scoped X-Ekoa-App-Id, never reads the caller JWT, grounds+bills the OWNER). whoami adds a detection-only exception: X-Ekoa-App-Id + OPTIONAL Bearer platform-JWT -> {admin:boolean} true iff the verified caller is org-admin/super-admin of the app OWNER's org AND can(caller,'canEditApps'); fail-closed 200 {admin:false} on ANY token failure (never 4xx = oracle); shares resolveAssistantApp with POST so it is no new existence oracle; never grounds/bills/widens admission. Panel reads localStorage ekoa_token defensively, calls whoami once, admin:true only lights an inert badge. Hunt for REAL security defects with file:line + attack scenario: (1) any token-failure path that is NOT 200 {admin:false} (throw->distinguishing 500, 401/403 leak); does an expired/revoked/epoch-stale token ever yield admin:true; is the verify chain the SAME as requireAuth (verifyToken+jti+isRevoked+activation+tokenEpoch) or weaker; (2) does whoami leak more than POST (app-id/owner-org enumeration; admin true/false as an org-membership oracle for an arbitrary app); (3) did the resolveAssistantApp refactor change POST's visitor-blind org/billee resolution AT ALL; (4) capability correctness - user-role admin-of-nothing gets false, super-admin cross-org right, org-admin strictly the OWNER org (not caller's own), ownerOrgId server-resolved never caller-supplied; (5) panel - localStorage read crashing mount, token logged/persisted/sent elsewhere, admin:true triggering any privileged call (detect-then-ask violation), badge XSS; (6) test honesty - real verify chain not a pass-through mock, asserts 200-not-4xx, contract validates the real schema. Read slices/H2/{impl-notes.md,decision-memo.md} + slices/H1/exploration-auth-surface.md. Read-only cmds OK (grep/git/tsc), no networked tests. Concise: a bullet per finding classified High/Medium/Low with file:line, then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `8b6116a` as a security audit. I’m first loading the project context files plus the referenced slice docs, then I’ll inspect the exact diff and trace the auth/assistant code paths against the stated invariants.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,220p' slices/H2/impl-notes.md; printf '\\n---DECISION---\\n'; sed -n '1,220p' slices/H2/decision-memo.md; printf '\\n---H1---\\n'; sed -n '1,260p' slices/H1/exploration-auth-surface.md" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "sed -n '1,220p' PRD.md; printf '\\n---PLANING---\\n'; sed -n '1,220p' PLANING.md; printf '\\n---TASKS---\\n'; sed -n '1,220p' TASKS.md" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
sed: PRD.md: No such file or directory

---PLANING---
sed: PLANING.md: No such file or directory

---TASKS---
sed: TASKS.md: No such file or directory

 exited 1 in 0ms:
sed: slices/H2/impl-notes.md: No such file or directory

---DECISION---
sed: slices/H2/decision-memo.md: No such file or directory

---H1---
sed: slices/H1/exploration-auth-surface.md: No such file or directory

exec
/bin/zsh -lc "pwd && ls -la && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'slices/**' | sort && test -d .codegraph && echo CODEGRAPH_PRESENT || echo CODEGRAPH_ABSENT && git show --stat --oneline 8b6116a" in /Users/ggomes/dev/ekoa-code
 succeeded in 109ms:
8b6116a feat(operator-run/h2): SECURITY - whoami admin-detection endpoint (identity handoff). GET /api/app-assistant/whoami returns {admin} true iff a verified platform JWT is org-admin/super-admin of the OWNER org AND canEditApps; fail-closed 200 {admin:false} on any token failure (never 4xx - no oracle), shares resolveAssistantApp with POST so it is no new existence oracle, never grounds/bills/widens admission; POST path byte-for-byte visitor-blind. Panel reads localStorage token defensively + calls whoami once + renders only a discreet inert admin badge (detect-then-ask; edit UX is H3). Diagram 10 updated
 api/assets/panel-runtime/src/AssistantPanel.jsx    | 100 +++++++++-
 api/src/apps/app-assistant-route.ts                | 128 +++++++++++--
 api/tests/apps/app-assistant.test.ts               | 210 ++++++++++++++++++++-
 api/tests/apps/assistant-panel.test.ts             |  67 +++++++
 api/tests/contract/app-assistant.contract.test.ts  |  33 ++++
 api/tests/contract/schema-coverage.test.ts         |   4 +
 .../slices/H2/impl-notes.md                        | 109 +++++++++++
 .../slices/H2/worker-status.txt                    |   3 +
 docs/diagrams/10-privacy-boundaries.excalidraw     |   8 +-
 shared/src/app-assistant.ts                        |  20 ++
 10 files changed, 664 insertions(+), 18 deletions(-)

codex
The root doesn’t contain the context files at the paths named in the instructions, so I’m locating them in-repo and then tracing the touched server, client, and test code from the commit against the existing auth stack.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --files | rg '("'^|/)(PRD|PLANING|TASKS)'"\\.md"'$|slices/.*/(impl-notes|decision-memo|exploration-auth-surface)'"\\.md"'$|app-assistant-route'"\\.ts"'$|AssistantPanel'"\\.jsx"'$|app-assistant'"\\.test\\.ts"'$|assistant-panel'"\\.test\\.ts"'$|app-assistant'"\\.contract\\.test\\.ts"'$|schema-coverage'"\\.test\\.ts"'$|app-assistant'"\\.ts"'$'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/apps/app-assistant.ts
api/src/apps/app-assistant-route.ts
shared/src/app-assistant.ts
api/tests/apps/app-assistant.test.ts
api/tests/apps/assistant-panel.test.ts
api/tests/contract/schema-coverage.test.ts
api/tests/contract/app-assistant.contract.test.ts
api/assets/panel-runtime/src/AssistantPanel.jsx
docs/autothing/runs/20260712-150958-4bb23640/slices/F1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/C5/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/F2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/C3/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H2/decision-memo.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/B2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/G2/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/exploration-auth-surface.md
docs/autothing/runs/20260712-150958-4bb23640/slices/D3/impl-notes.md

exec
/bin/zsh -lc 'git show --unified=80 8b6116a -- api/src/apps/app-assistant-route.ts api/assets/panel-runtime/src/AssistantPanel.jsx shared/src/app-assistant.ts api/tests/apps/app-assistant.test.ts api/tests/apps/assistant-panel.test.ts api/tests/contract/app-assistant.contract.test.ts api/tests/contract/schema-coverage.test.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-pJ1hDGcd' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-XMKoX6q0' (errno=Operation not permitted)
commit 8b6116a547ad649131c6916b8faf190938e00e72
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 20:58:35 2026 +0100

    feat(operator-run/h2): SECURITY - whoami admin-detection endpoint (identity handoff). GET /api/app-assistant/whoami returns {admin} true iff a verified platform JWT is org-admin/super-admin of the OWNER org AND canEditApps; fail-closed 200 {admin:false} on any token failure (never 4xx - no oracle), shares resolveAssistantApp with POST so it is no new existence oracle, never grounds/bills/widens admission; POST path byte-for-byte visitor-blind. Panel reads localStorage token defensively + calls whoami once + renders only a discreet inert admin badge (detect-then-ask; edit UX is H3). Diagram 10 updated

diff --git a/api/assets/panel-runtime/src/AssistantPanel.jsx b/api/assets/panel-runtime/src/AssistantPanel.jsx
index e2919b0..7b64084 100644
--- a/api/assets/panel-runtime/src/AssistantPanel.jsx
+++ b/api/assets/panel-runtime/src/AssistantPanel.jsx
@@ -1,144 +1,168 @@
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
 import './AssistantPanel.css';
 
 const ENDPOINT = '/api/app-assistant';
+// H2 admin DETECTION (detect-then-ask). A cheap, non-LLM GET that answers ONLY "is the current
+// viewer an admin of this app's owner org?". It NEVER issues an assistant turn (the zero-token
+// invariant holds) and its result NEVER auto-enables anything - it only lights a discreet
+// indicator. The edit-mode switch + its opt-in UX are H3; this panel does not build them.
+const WHOAMI_ENDPOINT = '/api/app-assistant/whoami';
+// The platform session token key web/lib/api/token.ts uses. Read best-effort for detection only:
+// a served app on the SAME origin as the dashboard can read it; a CROSS-origin / sandboxed iframe
+// (the dev preview) throws on access, so detection simply falls back to "not admin".
+const TOKEN_STORAGE_KEY = 'ekoa_token';
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
 
+/** Best-effort read of the platform session token for admin DETECTION only (H2). Same-origin
+ *  served pages can read the dashboard's localStorage; a cross-origin or sandboxed iframe throws
+ *  a SecurityError on `localStorage` access - swallow it to null so detection just degrades to
+ *  "not admin" (no affordance) instead of crashing the panel. Reads nothing else and stores
+ *  nothing - the token is attached to the one whoami GET and never kept. */
+function readPlatformToken() {
+  try {
+    if (typeof window === 'undefined' || !window.localStorage) return null;
+    const t = window.localStorage.getItem(TOKEN_STORAGE_KEY);
+    return typeof t === 'string' && t ? t : null;
+  } catch {
+    return null;
+  }
+}
+
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
 function toRuntimeAction(a) {
   const values = (a && (a.input || a.params)) || {};
   if (a && a.action && typeof a.action === 'object') {
     return { ...a.action, params: values };
   }
   const id =
     a && typeof a.toolName === 'string'
       ? a.toolName.replace(/^app_action__/, '').replace(/_/g, '-')
       : undefined;
   return { id, toolName: a && a.toolName, params: values };
 }
 
 /** A short PT-PT status line for one action run. */
 function runLabel(status) {
   switch (status) {
     case 'running':
       return 'A executar...';
     case 'done':
       return 'Ação executada.';
     case 'cancelled':
       return 'Ação cancelada.';
     case 'unavailable':
       return 'Ação indisponível nesta pré-visualização.';
     default:
       return 'Não foi possível executar a ação.';
   }
 }
 
 function SendIcon() {
   return (
     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
       <path d="M22 2 11 13" />
       <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
     </svg>
   );
 }
 
 function CloseIcon() {
   return (
     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
       <path d="M18 6 6 18" />
       <path d="m6 6 12 12" />
     </svg>
   );
 }
 
 function ChatIcon() {
   return (
     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
       <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
     </svg>
   );
 }
 
 /** PT-PT status line for a non-stepping tour phase (playing/awaiting show the copy). */
 function tourStatusText(status) {
   switch (status) {
     case 'loading':
       return 'A carregar o tutorial...';
     case 'awaiting':
       return 'Aguardando a sua ação na aplicação...';
@@ -154,183 +178,231 @@ function tourStatusText(status) {
 /**
  * The tour block rendered in the panel while a same-document tour plays. The
  * on-page highlight/tooltip is drawn by the C3 runtime (window.__ekoaActions
  * spotlight); this block carries the step counter, the narration, and the
  * Seguinte / Sair controls. It exposes data-tour-status + data-tour-step-index for
  * the deterministic live gate. No emoji; brand-neutral via the panel CSS vars.
  */
 function TourView({ tour, onNext, onClose }) {
   const { status, stepIndex, total, copy, imageUrl, imageBlocked, injectedPrompt } = tour;
   const stepping = status === 'playing' || status === 'awaiting';
   const stepNo = total > 0 ? Math.min(stepIndex + 1, total) : 0;
   const statusLine = tourStatusText(status);
   return (
     <section
       className="ekoa-assistant-tour"
       data-tour-status={status}
       data-tour-step-index={stepIndex}
       aria-label="Tutorial guiado"
     >
       <div className="ekoa-assistant-tour-head">
         <span className="ekoa-assistant-tour-title">Tutorial guiado</span>
         {stepping && total > 0 ? (
           <span className="ekoa-assistant-tour-progress">{`Passo ${stepNo} de ${total}`}</span>
         ) : null}
       </div>
 
       {copy ? (
         <div className="ekoa-assistant-tour-copy">
           {copy.titlePt ? <div className="ekoa-assistant-tour-copy-title">{copy.titlePt}</div> : null}
           {copy.bodyPt ? <div className="ekoa-assistant-tour-copy-body">{copy.bodyPt}</div> : null}
         </div>
       ) : null}
 
       {injectedPrompt ? (
         <div className="ekoa-assistant-tour-note">
           Sugestão colocada na caixa de mensagem, para rever antes de enviar.
         </div>
       ) : null}
 
       {imageUrl ? <img className="ekoa-assistant-tour-image" src={imageUrl} alt="" /> : null}
 
       {imageBlocked ? (
         <div className="ekoa-assistant-tour-note">Imagem ignorada (caminho não permitido).</div>
       ) : null}
 
       {statusLine ? <div className="ekoa-assistant-tour-status">{statusLine}</div> : null}
 
       <div className="ekoa-assistant-tour-controls">
         {stepping ? (
           <button type="button" className="ekoa-assistant-tour-next" onClick={onNext}>
             Seguinte
           </button>
         ) : null}
         <button type="button" className="ekoa-assistant-tour-close" onClick={onClose}>
           {status === 'done' || status === 'error' ? 'Fechar' : 'Sair'}
         </button>
       </div>
     </section>
   );
 }
 
 export function AssistantPanel({ defaultOpen = false } = {}) {
   // Collapsed on mount UNLESS the launcher handed off an explicit open intent. Since
   // G2 the panel is lazy-loaded: the app-bundle launcher (scaffold mount.js) injects
   // this asset and passes `defaultOpen` true when the VISITOR clicked it (open now),
   // false when the asset was idle-preloaded (mount collapsed, show only the launcher).
   const [collapsed, setCollapsed] = useState(!defaultOpen);
   // `mode` is the mode CURRENTLY shown on the toggle - the server's inference (echoed
   // on each response) unless the visitor pins one. `pinnedMode` is non-null only when
   // the visitor explicitly picked a mode: only then do we send it, so by default the
   // server infers the mode from the phrasing (do/show/teach) and we reflect it back.
   const [mode, setMode] = useState('do');
   const [pinnedMode, setPinnedMode] = useState(null);
   const [messages, setMessages] = useState([]); // { id, role, content, citations?, runs? }
   const [draft, setDraft] = useState('');
   const [busy, setBusy] = useState(false);
   // E2 same-document tour playback state (null when no tour is active). The player
   // is 100% client-side and issues ZERO model calls: it fetches the pre-generated
   // tour from GET /api/demos/:appId and drives it in the page.
   const [tour, setTour] = useState(null);
+  // H2 detect-then-ask: whether the current viewer is an admin of this app's owner org.
+  // Default false (fail-closed). Set ONCE by the mount detection below. This flag NEVER
+  // auto-enables anything - it only lights the discreet indicator in the header (the actual
+  // edit-mode switch is H3). Every privileged action stays gated server-side by H1.
+  const [admin, setAdmin] = useState(false);
 
   const idRef = useRef(0);
   const messagesRef = useRef(messages);
   const actionResultsRef = useRef([]); // rolling buffer of recent action results for context
   const listRef = useRef(null);
   const textareaRef = useRef(null);
   const playerRef = useRef(null);
+  const whoamiDoneRef = useRef(false); // guards the once-only admin detection (H2)
 
   useEffect(() => {
     messagesRef.current = messages;
     // keep the newest turn in view
     const el = listRef.current;
     if (el) el.scrollTop = el.scrollHeight;
   }, [messages]);
 
   useEffect(() => {
     // Auto-open handoff (G2): the visitor clicked the launcher, so the panel mounts
     // already open - focus the composer once, matching an explicit open. Never runs
     // on an idle-preloaded (collapsed) mount, so it never steals focus from the app.
     if (defaultOpen && textareaRef.current) textareaRef.current.focus();
     // Mount-only: the handoff intent is fixed at mount time.
   }, [defaultOpen]);
 
+  // H2 admin DETECTION (detect-then-ask): ask the server ONCE, on mount, whether the current
+  // viewer is an admin of this app's owner org. Reads the platform token defensively (a
+  // cross-origin/sandboxed iframe throws) and attaches it as an OPTIONAL Bearer alongside the
+  // X-Ekoa-App-Id header the POST path already sends. This is a cheap non-LLM GET - it does NOT
+  // count as an assistant turn (zero-token invariant). The result only lights the discreet
+  // indicator; it NEVER auto-enables anything and issues no privileged call (edit mode is H3).
+  useEffect(() => {
+    const id = appId();
+    // No app id (standalone preview) or already detected once -> nothing to do. The ref keeps the
+    // detection to exactly ONE request per mounted panel (also idempotent under StrictMode).
+    if (!id || whoamiDoneRef.current) return;
+    whoamiDoneRef.current = true;
+
+    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
+    const token = readPlatformToken();
+    void (async () => {
+      try {
+        const res = await fetch(WHOAMI_ENDPOINT, {
+          method: 'GET',
+          ...(controller ? { signal: controller.signal } : {}),
+          headers: {
+            'X-Ekoa-App-Id': id,
+            // OPTIONAL: sent only when a same-origin token was readable. Absent -> the server
+            // fails closed to { admin: false }, so cross-origin dev simply shows no affordance.
+            ...(token ? { Authorization: `Bearer ${token}` } : {}),
+          },
+        });
+        if (!res.ok) return; // fail closed: stay non-admin on any non-200 (never an oracle anyway)
+        const data = await res.json();
+        setAdmin(!!(data && data.admin === true));
+      } catch {
+        // network error / aborted unmount / bad JSON -> stay non-admin. Detection is best-effort.
+      }
+    })();
+
+    return () => {
+      if (controller) controller.abort();
+    };
+    // Mount-only: detection is a one-shot for the panel's lifetime.
+    // eslint-disable-next-line react-hooks/exhaustive-deps
+  }, []);
+
   const nextId = () => {
     idRef.current += 1;
     return idRef.current;
   };
 
   const patchTurn = useCallback((turnId, patch) => {
     setMessages((prev) => prev.map((m) => (m.id === turnId ? { ...m, ...patch(m) } : m)));
   }, []);
 
   const recordResult = useCallback((result) => {
     const buf = actionResultsRef.current;
     buf.push(result);
     if (buf.length > MAX_ACTION_RESULTS) buf.splice(0, buf.length - MAX_ACTION_RESULTS);
   }, []);
 
   // ---- E2 tour playback (same-document, zero-token) ------------------------
   // Lazily build ONE client-side tour player. Its state drives the tour block in
   // the panel; when a step surfaces a suggested prompt (inject-prompt) it lands in
   // the composer - never auto-sent. No path here calls /api/app-assistant.
   const ensurePlayer = useCallback(() => {
     if (!playerRef.current) {
       playerRef.current = createTourPlayer({
         onState: (state) => {
           setTour(state);
           if (state && state.injectedPrompt) setDraft(state.injectedPrompt);
         },
       });
     }
     return playerRef.current;
   }, []);
 
   /** Start playing the app's guided tour in the page. Triggered by teach mode or a
    *  startTour action. Fetches GET /api/demos/:appId inside the player - no model
    *  turn is issued. `tourId` is forwarded for forward-compat (the route serves the
    *  app's overview tour today). */
   const startTourPlayback = useCallback(
     (tourId) => {
       const player = ensurePlayer();
       setCollapsed(false);
       void player.start(undefined, tourId);
     },
     [ensurePlayer],
   );
 
   const tourNext = useCallback(() => {
     if (playerRef.current) playerRef.current.next();
   }, []);
 
   const tourClose = useCallback(() => {
     if (playerRef.current) playerRef.current.cancel();
     setTour(null);
   }, []);
 
   /** Collapse the panel. A tour is bound to the visible panel, so collapsing it
    *  CANCELS any active tour (clears the on-page spotlight + aborts the run) rather
    *  than leaving a ring on screen with no reachable controls. */
   const collapsePanel = useCallback(() => {
     if (playerRef.current) playerRef.current.cancel();
     setTour(null);
     setCollapsed(true);
   }, []);
 
   /** Run the assistant's proposed actions in order through the C3 runtime. The
    *  runtime draws the driving badge / highlight / destructive confirm and pauses
    *  on real user input - the panel only reflects each run's state. */
   const runActions = useCallback(
     async (actions, turnId) => {
       const runtime = typeof window !== 'undefined' ? window.__ekoaActions : undefined;
       for (const a of actions) {
         const runId = nextId();
         patchTurn(turnId, (m) => ({ runs: [...(m.runs || []), { id: runId, status: 'running' }] }));
 
         const setStatus = (status, detail) =>
           patchTurn(turnId, (m) => ({
             runs: (m.runs || []).map((r) => (r.id === runId ? { ...r, status, detail } : r)),
           }));
 
         // A startTour action is played by the SAME-DOCUMENT tour player, not the
         // runtime executor: the runtime's cross-frame startTour only posts a
         // tour-request (a no-op in-page) and drops the tourId. The panel owns the
@@ -411,161 +483,187 @@ export function AssistantPanel({ defaultOpen = false } = {}) {
           setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: ERROR_REPLY, error: true }].slice(-MAX_MESSAGES));
           return;
         }
         const data = await res.json();
         if (data && typeof data.mode === 'string') setMode(data.mode);
         const turnId = nextId();
         setMessages((prev) => [
           ...prev,
           {
             id: turnId,
             role: 'assistant',
             content: (data && data.reply) || '',
             citations: data && Array.isArray(data.citations) ? data.citations : undefined,
             runs: [],
           },
         ].slice(-MAX_MESSAGES));
         if (data && Array.isArray(data.actions) && data.actions.length) {
           await runActions(data.actions, turnId);
         }
       } catch {
         setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: ERROR_REPLY, error: true }].slice(-MAX_MESSAGES));
       } finally {
         if (timer) clearTimeout(timer);
         setBusy(false);
       }
     },
     [draft, busy, pinnedMode, runActions],
   );
 
   const open = useCallback(() => {
     setCollapsed(false);
     // Focus only on an explicit open (user intent); never on mount, so the panel
     // never steals focus from the app while it loads.
     window.setTimeout(() => {
       if (textareaRef.current) textareaRef.current.focus();
     }, 0);
   }, []);
 
   // Open-intent handoff, late leg (G2): the boot launcher dispatches
   // 'ekoa:assistant-open' on every click. The defaultOpen flag covers a click BEFORE
   // this panel mounts; this listener covers a click AFTER it mounted collapsed (an
   // idle preload racing the visitor's click) - intent is never lost between the two.
   useEffect(() => {
     const onOpenIntent = () => open();
     window.addEventListener('ekoa:assistant-open', onOpenIntent);
     return () => window.removeEventListener('ekoa:assistant-open', onOpenIntent);
   }, [open]);
 
   const onExample = useCallback((example) => {
     setMode(example.mode);
     setDraft(example.prompt);
     if (textareaRef.current) textareaRef.current.focus();
   }, []);
 
   const onKeyDown = useCallback(
     (e) => {
       // Enter sends; Shift+Enter is a newline.
       if (e.key === 'Enter' && !e.shiftKey) {
         e.preventDefault();
         void send();
       }
     },
     [send],
   );
 
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
-        <span className="ekoa-assistant-title">Assistente</span>
+        <span className="ekoa-assistant-titlegroup" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2, 0.5rem)' }}>
+          <span className="ekoa-assistant-title">Assistente</span>
+          {/* H2 detect-then-ask: a DISCREET, non-intrusive indicator that an admin capability
+              exists. It does NOTHING - no click handler, no mode change, no privileged call. The
+              opt-in edit-mode switch is H3. Styled inline (brand-neutral via the panel CSS vars)
+              so it inherits the app's theme without a bespoke stylesheet rule. */}
+          {admin ? (
+            <span
+              className="ekoa-assistant-admin-badge"
+              data-admin="true"
+              title="Tem permissões de administrador nesta aplicação."
+              style={{
+                fontSize: 'var(--text-sm, 0.8125rem)',
+                fontWeight: 600,
+                color: 'var(--color-text-muted, #475569)',
+                border: '1px solid var(--color-border, #E2E8F0)',
+                borderRadius: 'var(--radius-sm, 0.375rem)',
+                padding: '0.05rem 0.4rem',
+                lineHeight: 1.4,
+                letterSpacing: '0.02em',
+                whiteSpace: 'nowrap',
+              }}
+            >
+              Administrador
+            </span>
+          ) : null}
+        </span>
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
         <TourView tour={tour} onNext={tourNext} onClose={tourClose} />
       ) : mode === 'teach' ? (
         <div className="ekoa-assistant-tour-launch">
           <button
             type="button"
diff --git a/api/src/apps/app-assistant-route.ts b/api/src/apps/app-assistant-route.ts
index 9ff53e7..1ad6a9d 100644
--- a/api/src/apps/app-assistant-route.ts
+++ b/api/src/apps/app-assistant-route.ts
@@ -1,167 +1,271 @@
 /**
  * Served-app assistant plane (operator-run D1) — `POST /api/app-assistant`.
  *
  * The header-scoped (no platform JWT) endpoint the served app's assistant panel calls. It reuses
  * the served-data admission plane: the `X-Ekoa-App-Id` header (charset-checked; the reserved `usr.`
  * shared-namespace prefix rejected) resolves to the artifact, whose OWNER's activation gates the
  * plane (fail-closed). Unlike the byte-compatible key-value app-data plane, the assistant REQUIRES
  * a resolved artifact-backed owner — it has to run under that owner's org and bill that owner — so
  * an unresolved / registry-only (dev-serve) id is a 404 here rather than an anonymous scope.
  *
  * Errors speak the CONV-2 envelope (a new endpoint, not the old app-data string envelope). This
  * module may not import routes/ (ch02 §2.7 lint zone), so it emits the envelope directly off the
  * shared ERROR_STATUS table — the same shape routes/helpers.sendError produces.
  *
  * The org the assistant grounds under and the user it bills come ONLY from the server-resolved
  * owner — never from the anonymous visitor's body. The billing allowance gate is billed to that
  * same owner (the served-app assistant is a named synchronous entry in billing/allowance.ts).
  */
 import { Router, type Request, type Response, type RequestHandler, type NextFunction } from 'express';
 import {
   AssistantChatRequest,
   AppActionManifest,
   ERROR_STATUS,
   type ErrorCode,
   type AssistantChatResponse,
+  type AppAssistantWhoamiResponse,
 } from '@ekoa/shared';
 import { collectionName } from '../data/collections-engine.js';
 import { getActivation } from '../data/activation.js';
 import { users, artifacts } from '../data/stores.js';
 import { allowanceMiddleware } from '../billing/index.js';
 import { runOneShot, decideForTask } from '../llm/index.js';
 import { buildGroundingBlock } from '../knowledge/index.js';
-import { resolveApp } from './registry.js';
+import { verifySseToken } from '../auth/middleware.js';
+import { can } from '../auth/capabilities.js';
+import type { JwtClaims } from '../auth/jwt.js';
+import { resolveApp, type ResolvedApp } from './registry.js';
 import { runAppAssistant, type AppAssistantDeps } from './app-assistant.js';
 
 const SHARED_SCOPE_PREFIX = 'usr.';
 
 /** CONV-2 error envelope off the shared status table (routes/ is off-limits to apps/, ch02 §2.7). */
 function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
   res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
 }
 
+/**
+ * Resolve the `X-Ekoa-App-Id` header to an artifact-backed owner — the SHARED front half of every
+ * app-assistant plane entry (POST admission AND the H2 whoami detection), so both apply the exact
+ * same charset/collision checks and expose the exact same existence surface (no plane is a
+ * different oracle than the other). A discriminated result the callers turn into the CONV-2
+ * envelope: `invalid-id` → 400 VALIDATION_FAILED, `not-found` → 404 NOT_FOUND, `ok` → the app.
+ */
+type AssistantAppResolution =
+  | { status: 'invalid-id' }
+  | { status: 'not-found' }
+  | { status: 'ok'; app: ResolvedApp };
+
+async function resolveAssistantApp(header: unknown): Promise<AssistantAppResolution> {
+  // Same header contract admit() has always applied: a string, a valid collection-name charset,
+  // and NOT the reserved `usr.` shared-namespace prefix.
+  if (
+    typeof header !== 'string' ||
+    !collectionName.safeParse(header).success ||
+    header.startsWith(SHARED_SCOPE_PREFIX)
+  ) {
+    return { status: 'invalid-id' };
+  }
+  const app = await resolveApp(header);
+  // The assistant plane needs a real artifact-backed owner (org to scope by, user to attribute).
+  // A dev-serve / registry-only or unresolved id has none — the same 404 admit() gives.
+  if (!app || !app.artifactBacked || !app.ownerUserId) return { status: 'not-found' };
+  return { status: 'ok', app };
+}
+
+/**
+ * Is this verified caller an admin of the app OWNER's org WITH the app-edit capability? PURE role
+ * decision (the token is already verified by the caller). Gated by H1's `can()` so the role→
+ * capability grid is the single source of truth — a `user` fails the capability gate, so only
+ * `org-admin`/`super-admin` reach the org check. A super-admin spans every org; an org-admin must
+ * belong to the owner's exact org. Fail-closed for any other shape. Exported for the unit matrix.
+ */
+export function isOwnerOrgAdmin(claims: Pick<JwtClaims, 'role' | 'orgId'>, ownerOrgId: string): boolean {
+  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
+  if (claims.role === 'super-admin') return true; // super-admin edits apps in any org
+  if (claims.role === 'org-admin') return claims.orgId === ownerOrgId; // org-admin scoped to owner org
+  return false; // unreachable given the capability gate, but fail-closed by construction
+}
+
+/**
+ * Detect whether the OPTIONAL platform Bearer on this request belongs to an admin of `ownerOrgId`.
+ * FAIL-CLOSED and oracle-free: any deviation — no token, a non-Bearer header, or a token that does
+ * not clear the standard verification chain — returns false, never throws, never distinguishes a
+ * bad token from a wrong-org one. The verification is the EXACT chain requireAuth/verifySseToken
+ * run (verifyToken + jti + isRevoked + activation-active + tokenEpoch); this endpoint does NOT
+ * hand-roll a weaker check and adds NO second identity path.
+ */
+function detectOwnerOrgAdmin(authHeader: string | undefined, ownerOrgId: string): boolean {
+  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
+  if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
+  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
+  if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
+  return isOwnerOrgAdmin(verified.claims, ownerOrgId);
+}
+
 /** What the admission middleware resolves and stashes for the handler + allowance gate. */
 interface AssistantAdmission {
   owner: { userId: string; orgId: string };
   artifactId: string;
   actionManifest: AppActionManifest | null;
 }
 interface AssistantRequest extends Request {
   ekoaAssistant?: AssistantAdmission;
 }
 
 /** The production deps: the assistant's only model egress is the llm/ chokepoint one-shot; grounding
  *  rides the knowledge/ builder; the tier is floored at WORKHORSE like chat (D1 owner-org grounding
  *  is passed in by the admission middleware, not here). */
 const prodDeps: AppAssistantDeps = {
   oneShot: runOneShot,
   ground: buildGroundingBlock,
   decide: (message) => decideForTask(message, undefined, 'WORKHORSE'),
 };
 
 export function appAssistantRouter(deps: AppAssistantDeps = prodDeps): Router {
   const r = Router();
 
   /**
    * Served-app admission (mirrors served-data's headerFor + admitOwner, then resolves the owner org
    * and the app's action manifest). On any refusal it writes the CONV-2 envelope and does NOT call
    * next. On success it stashes the resolved subject on the request for the allowance gate + handler.
    */
   const admit = async (req: AssistantRequest, res: Response, next: NextFunction): Promise<void> => {
-    const header = req.header('x-ekoa-app-id');
-    if (
-      typeof header !== 'string' ||
-      !collectionName.safeParse(header).success ||
-      header.startsWith(SHARED_SCOPE_PREFIX)
-    ) {
+    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
+    if (resolution.status === 'invalid-id') {
       sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
       return;
     }
-
-    const app = await resolveApp(header);
-    // The assistant needs a real owner subject (org to ground under, user to bill). A dev-serve /
-    // registry-only or unresolved id has none — 404 rather than an anonymous scope.
-    if (!app || !app.artifactBacked || !app.ownerUserId) {
+    if (resolution.status === 'not-found') {
       sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
       return;
     }
+    const app = resolution.app;
 
     // Owner-activation gate (Amendment 2 second admission plane; fail-closed CONV-2).
     const activation = getActivation(app.ownerUserId);
     if (!activation || activation.active === false) {
       sendError(res, 'ACCOUNT_DISABLED', 'A conta associada a esta aplicação está bloqueada. Contacte o suporte.');
       return;
     }
     if (activation.billingLocked) {
       sendError(res, 'BILLING_LOCKED', 'A conta associada a esta aplicação tem um problema de faturação.');
       return;
     }
 
     // Owner org — resolved server-side from the owner user record, NEVER from the visitor's body.
     const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
     const orgId = owner?.orgId ?? '';
 
     // The app's declared action manifest (persisted at activation on the artifact data bag).
     // Validate it against the shared contract; absent/invalid → no operate surface (null).
     const art = await artifacts.get(app.appId);
     const rawManifest = (art?.data as { actionManifest?: unknown } | undefined)?.actionManifest;
     const parsedManifest = rawManifest ? AppActionManifest.safeParse(rawManifest) : null;
     const actionManifest = parsedManifest?.success ? parsedManifest.data : null;
 
     req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
     next();
   };
 
   /** Async admission errors surface as a CONV-2 500 rather than Express's default HTML. */
   const admitGuarded: RequestHandler = (req, res, next) => {
     void admit(req, res, next).catch((err) => {
       console.error('[app-assistant] admission failed:', err instanceof Error ? err.message : err);
       sendError(res, 'INTERNAL', 'Erro interno.');
     });
   };
 
   // Allowance gate billed to the resolved OWNER (mounted AFTER admission populates the subject).
   const allowance = allowanceMiddleware((req) => (req as AssistantRequest).ekoaAssistant?.owner.userId);
 
   r.post('/app-assistant', admitGuarded, allowance, async (req: AssistantRequest, res) => {
     const admission = req.ekoaAssistant;
     if (!admission) {
       sendError(res, 'INTERNAL', 'Erro interno.'); // unreachable: admit ran first
       return;
     }
 
     const parsed = AssistantChatRequest.safeParse(req.body ?? {});
     if (!parsed.success) {
       sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
       return;
     }
     const body = parsed.data;
 
     try {
       const result = await runAppAssistant(
         {
           message: body.message,
           history: body.history,
           mode: body.mode,
           context: body.context,
           owner: admission.owner,
           artifactId: admission.artifactId,
           actionManifest: admission.actionManifest,
         },
         deps,
       );
       const response: AssistantChatResponse = {
         reply: result.reply,
         mode: result.mode,
         ...(result.citations.length > 0 ? { citations: result.citations } : {}),
         ...(result.actions.length > 0 ? { actions: result.actions } : {}),
       };
       res.json(response);
     } catch (err) {
       console.error('[app-assistant] run failed:', err instanceof Error ? err.message : err);
       sendError(res, 'INTERNAL', 'O assistente está indisponível de momento.');
     }
   });
 
+  /**
+   * GET /app-assistant/whoami — admin DETECTION for the panel (operator-run H2; detect-then-ask).
+   *
+   * A DECLARED, DOCUMENTED exception to this plane's visitor-blindness: it is the ONE place the
+   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "is the
+   * current viewer an admin of this app's owner org?". It NEVER grounds, NEVER bills, NEVER widens
+   * admission, and issues NO model call (the zero-token GET) — the POST grounding/billing path
+   * above stays byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged
+   * action remains gated server-side by the H1 admission plane with this same JWT; `admin: true`
+   * here is only a HINT the panel may surface (edit mode is H3).
+   *
+   * FAIL-CLOSED + oracle-free: the ONLY non-200 responses are the SAME ones POST already gives for
+   * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
+   * oracle). A missing/invalid/expired/revoked/epoch-stale/wrong-org/user token is ALWAYS a 200
+   * `{ admin: false }` — never a 401 (which would leak token validity) or a 403 (which would leak
+   * app existence).
+   */
+  const whoami = async (req: Request, res: Response): Promise<void> => {
+    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
+    if (resolution.status === 'invalid-id') {
+      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
+      return;
+    }
+    if (resolution.status === 'not-found') {
+      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
+      return;
+    }
+
+    // Owner org — resolved server-side from the owner user record (same source admit() uses),
+    // NEVER from anything the caller supplied.
+    const owner = (await users.get(resolution.app.ownerUserId)) as { orgId?: string } | null;
+    const ownerOrgId = owner?.orgId ?? '';
+
+    const response: AppAssistantWhoamiResponse = {
+      admin: detectOwnerOrgAdmin(req.header('authorization'), ownerOrgId),
+    };
+    res.json(response); // always 200 — the boolean IS the answer
+  };
+
+  /** A whoami failure (e.g. a store read blowing up) is a 500, never a 4xx: a 4xx here would be an
+   *  oracle. Fail-closed to an internal error, distinct from the detection's own false. */
+  r.get('/app-assistant/whoami', (req, res) => {
+    void whoami(req, res).catch((err) => {
+      console.error('[app-assistant] whoami failed:', err instanceof Error ? err.message : err);
+      sendError(res, 'INTERNAL', 'Erro interno.');
+    });
+  });
+
   return r;
 }
diff --git a/api/tests/apps/app-assistant.test.ts b/api/tests/apps/app-assistant.test.ts
index 4326462..1fa04fc 100644
--- a/api/tests/apps/app-assistant.test.ts
+++ b/api/tests/apps/app-assistant.test.ts
@@ -1,91 +1,104 @@
-import { describe, it, expect } from 'vitest';
+import { describe, it, expect, beforeAll, afterAll } from 'vitest';
+import type { Server } from 'node:http';
+import express from 'express';
+import jwt from 'jsonwebtoken';
 import type { AppAction, AppActionManifest } from '@ekoa/shared';
+import { AppAssistantWhoamiResponse } from '@ekoa/shared';
 import type { SearchHit } from '../../src/knowledge/index.js';
 import type { OneShotOptions, LlmAttribution, RouterDecision } from '../../src/llm/index.js';
 import { assistantToolsFromManifest } from '../../src/apps/assistant-tools.js';
 import {
   runAppAssistant,
   inferMode,
   extractActions,
   type AppAssistantDeps,
 } from '../../src/apps/app-assistant.js';
+import { appAssistantRouter, isOwnerOrgAdmin } from '../../src/apps/app-assistant-route.js';
+import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
+import { connectMongo, closeMongo } from '../../src/data/mongo.js';
+import { users, artifacts } from '../../src/data/stores.js';
+import { setActivation, bumpTokenEpoch, __resetActivationForTests } from '../../src/data/activation.js';
+import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
+import { login } from '../../src/auth/service.js';
+import { hashPassword } from '../../src/auth/password.js';
+import { loadConfig, __resetConfigForTests } from '../../src/config.js';
 
 /**
  * operator-run D1 — the served-app assistant pure logic, over an INJECTED one-shot (no real model),
  * an injected grounding builder, and an injected routing decision. Asserts: mode inference; grounding
  * hits become citations; the ```ekoa-actions``` block is parsed, validated against the manifest, and
  * stripped from the reply; unknown tool names are dropped; and the grounding org comes from the
  * resolved OWNER, never a caller-supplied value.
  */
 
 const manifest: AppActionManifest = {
   version: 1,
   actions: [
     { id: 'ir-clientes', kind: 'navigate', labelPt: 'Ver clientes', description: 'Abre a lista de clientes', route: '/clientes', params: [], destructive: false },
     {
       id: 'criar-cliente', kind: 'custom', labelPt: 'Criar cliente', description: 'Cria um novo cliente',
       params: [{ name: 'nome', type: 'string', required: true }], destructive: false,
     },
   ],
 };
 
 const DECISION: RouterDecision = { tier: 'WORKHORSE', model: 'claude-sonnet-5', effort: 'medium', weight: 0.1 };
 const OWNER = { userId: 'owner-1', orgId: 'org-owner' };
 
 /** The server-resolved manifest AppAction D1 attaches to each proposed action. */
 const actionById = (id: string): AppAction => manifest.actions.find((a) => a.id === id)!;
 /** toolName -> manifest AppAction, as runAppAssistant / extractActions consume it. */
 const toolMap = new Map(assistantToolsFromManifest(manifest).map((t) => [t.name, t.action] as const));
 
 interface Captured {
   opts?: OneShotOptions;
   attribution?: LlmAttribution;
   groundInput?: { orgId: string; query: string; kind: string };
 }
 
 /** Deps whose one-shot returns `oneShotText` verbatim and whose grounding returns `hits`. */
 function makeDeps(oneShotText: string, hits: SearchHit[] = [], captured: Captured = {}): AppAssistantDeps {
   return {
     oneShot: async (opts, attribution) => {
       captured.opts = opts;
       captured.attribution = attribution;
       return { text: oneShotText, usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } };
     },
     ground: (input) => {
       captured.groundInput = input;
       return { block: hits.length ? 'CONHECIMENTO (excertos):\n[1] col / titulo (doc d1)' : '', hits };
     },
     decide: () => DECISION,
   };
 }
 
 function hit(over: Partial<SearchHit> = {}): SearchHit {
   return { docId: 'd1', collection: 'faq', title: 'Como criar cliente', snippet: 'passo 1...', score: 1, scope: 'org', ...over };
 }
 
 describe('inferMode (D1 deterministic PT-PT classifier)', () => {
   it('teach cues -> teach', () => {
     expect(inferMode('Faz um tutorial da aplicação')).toBe('teach');
     expect(inferMode('Explica como funciona o registo')).toBe('teach');
     expect(inferMode('Ensina-me a usar isto passo a passo')).toBe('teach');
   });
   it('show cues -> show (accent-insensitive)', () => {
     expect(inferMode('Mostra-me o painel')).toBe('show');
     expect(inferMode('Dá-me uma visão geral')).toBe('show');
     expect(inferMode('Faz um resumo geral')).toBe('show');
   });
   it('teach wins over show ("mostra-me como criar")', () => {
     expect(inferMode('Mostra-me como criar um cliente')).toBe('teach');
   });
   it('imperative task verbs and anything else default to do', () => {
     expect(inferMode('Cria um cliente chamado Ana')).toBe('do');
     expect(inferMode('Adiciona uma nota ao processo')).toBe('do');
     expect(inferMode('Olá')).toBe('do');
   });
 });
 
 describe('extractActions (D1 fenced-block parser)', () => {
   it('parses an actions block, attaches the resolved AppAction, and strips it from the prose', () => {
     const reply = [
       'Vou criar o cliente para si.',
       '```ekoa-actions',
@@ -150,80 +163,275 @@ describe('runAppAssistant (D1)', () => {
       deps,
     );
     expect(res.mode).toBe('show');
   });
 
   it('honours a client-pinned mode over inference', async () => {
     const deps = makeDeps('ok');
     const res = await runAppAssistant(
       { message: 'Mostra-me a aplicação', mode: 'do', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
       deps,
     );
     expect(res.mode).toBe('do');
   });
 
   it('turns grounding hits into citations (collection/docId/title)', async () => {
     const hits = [hit(), hit({ docId: 'd2', collection: 'guias', title: 'Guia', scope: 'shared' })];
     const deps = makeDeps('Resposta com fonte.', hits);
     const res = await runAppAssistant(
       { message: 'Como crio um cliente?', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
       deps,
     );
     expect(res.citations).toEqual([
       { collection: 'faq', docId: 'd1', title: 'Como criar cliente' },
       { collection: 'guias', docId: 'd2', title: 'Guia' },
     ]);
   });
 
   it('parses + validates the actions block and strips it from the reply', async () => {
     const oneShotText = [
       'Vou tratar disso.',
       '```ekoa-actions',
       '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}},{"toolName":"app_action__desconhecida","input":{}}]',
       '```',
     ].join('\n');
     const deps = makeDeps(oneShotText);
     const res = await runAppAssistant(
       { message: 'Cria a cliente Ana', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
       deps,
     );
     expect(res.actions).toEqual([
       { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
     ]); // unknown dropped, resolved AppAction attached
     expect(res.reply).toBe('Vou tratar disso.');
     expect(res.reply).not.toContain('ekoa-actions');
   });
 
   it('an app with no manifest has no operate surface (all requested actions dropped)', async () => {
     const oneShotText = '```ekoa-actions\n[{"toolName":"app_action__criar_cliente","input":{}}]\n```texto';
     const deps = makeDeps(oneShotText);
     const res = await runAppAssistant(
       { message: 'Cria algo', owner: OWNER, artifactId: 'art-1', actionManifest: null },
       deps,
     );
     expect(res.actions).toEqual([]);
     expect(res.reply).toBe('texto');
   });
 
   it('grounds under the OWNER org and bills the OWNER — never a caller-supplied value', async () => {
     const captured: Captured = {};
     const deps = makeDeps('ok', [], captured);
     await runAppAssistant(
       {
         message: 'Olá',
         // A caller trying to steer the org via context must be ignored — the org comes from owner.
         context: { route: '/x', actionResults: [{ orgId: 'attacker-org' }] },
         owner: OWNER,
         artifactId: 'art-99',
         actionManifest: manifest,
       },
       deps,
     );
     expect(captured.groundInput).toEqual({ orgId: 'org-owner', query: 'Olá', kind: 'chat' });
     expect(captured.attribution).toEqual({
       kind: 'user_work',
       agentType: 'assistant-chat',
       billeeUserId: 'owner-1',
       artifactId: 'art-99',
     });
   });
 });
+
+/**
+ * operator-run H2 — the admin-detection DECISION (`isOwnerOrgAdmin`), the PURE role/org/capability
+ * core of `GET /api/app-assistant/whoami`. It reuses H1's `can('canEditApps')` as the capability
+ * gate, then scopes org-admins to the owner org and lets super-admins span every org. No token /
+ * verification here — that layer is exercised by the route matrix below.
+ */
+describe('isOwnerOrgAdmin (H2 detection decision)', () => {
+  it('an org-admin of the OWNER org is an admin (capability + org match)', () => {
+    expect(isOwnerOrgAdmin({ role: 'org-admin', orgId: 'org-owner' }, 'org-owner')).toBe(true);
+  });
+  it('an org-admin of ANOTHER org is NOT (org mismatch, fail-closed)', () => {
+    expect(isOwnerOrgAdmin({ role: 'org-admin', orgId: 'org-other' }, 'org-owner')).toBe(false);
+  });
+  it('a super-admin is an admin of ANY org (spans orgs)', () => {
+    expect(isOwnerOrgAdmin({ role: 'super-admin', orgId: 'org-other' }, 'org-owner')).toBe(true);
+    expect(isOwnerOrgAdmin({ role: 'super-admin', orgId: 'org-owner' }, 'org-owner')).toBe(true);
+  });
+  it('a plain user is never an admin (H1 capability gate denies canEditApps)', () => {
+    expect(isOwnerOrgAdmin({ role: 'user', orgId: 'org-owner' }, 'org-owner')).toBe(false);
+  });
+});
+
+/**
+ * operator-run H2 — the `GET /api/app-assistant/whoami` FAIL-CLOSED matrix over the REAL router,
+ * the REAL verification chain (verifyToken + jti + isRevoked + activation-active + tokenEpoch, via
+ * verifySseToken) and REAL owner resolution. The router is wired with THROWING llm deps: whoami
+ * must never ground/route/bill, so any accidental model touch would blow the request up (it does
+ * not — every case returns 200). Binding invariants asserted here:
+ *   - admin:true ONLY for an org-admin/super-admin of the OWNER org WITH canEditApps.
+ *   - EVERYTHING else -> 200 { admin:false }: no token, invalid, expired, epoch-stale, user role,
+ *     wrong-org admin. NEVER a 4xx on a bad/missing token (a 401/403 would be an oracle).
+ *   - the ONLY non-200 is a malformed X-Ekoa-App-Id (the SAME 400 POST gives) / unknown app (404).
+ */
+describe('GET /api/app-assistant/whoami (H2 fail-closed detection)', () => {
+  let mem: MongoMemoryServer;
+  let server: Server;
+  let port: number;
+  let seq = 0;
+  const loginDeps = { now: () => 1_700_000_000_000 + seq++, genId: () => `jti_${seq++}` };
+
+  // whoami must NEVER reach these — it neither grounds, routes, nor bills.
+  const throwingDeps: AppAssistantDeps = {
+    oneShot: async () => { throw new Error('whoami must not call the model (visitor-blindness exception is detection-only)'); },
+    ground: () => { throw new Error('whoami must not ground'); },
+    decide: () => { throw new Error('whoami must not route'); },
+  };
+
+  const APP_ID = 'app-h2'; // owned by owner-1 (org-owner)
+  const tokens: Record<string, string> = {};
+
+  async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
+    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
+    setActivation(id, { active: true, billingLocked: false });
+  }
+  const whoami = (headers: Record<string, string>) =>
+    fetch(`http://127.0.0.1:${port}/api/app-assistant/whoami`, { headers });
+  const postAssistant = (headers: Record<string, string>) =>
+    fetch(`http://127.0.0.1:${port}/api/app-assistant`, {
+      method: 'POST',
+      headers: { 'content-type': 'application/json', ...headers },
+      body: JSON.stringify({ message: 'olá' }),
+    });
+
+  beforeAll(async () => {
+    process.env.ENCRYPTION_KEY = 'k';
+    process.env.JWT_SECRET = 's';
+    __resetConfigForTests();
+    loadConfig();
+    __resetActivationForTests();
+    __resetRevocationsForTests();
+    mem = await createMem();
+    await connectMongo(mem.getUri(), 'ekoa_h2_whoami');
+
+    // The app + its owner (org-owner). Owner org is resolved server-side from this user record.
+    await mkUser('owner-1', 'org-owner', 'org-admin');
+    await artifacts.insert({ _id: APP_ID, name: 'H2', userId: 'owner-1', orgId: 'org-owner', visibility: 'private' } as never);
+
+    // Callers.
+    await mkUser('admin-owner', 'org-owner', 'org-admin'); // a DIFFERENT admin in the owner org
+    await mkUser('super-1', 'org-other', 'super-admin'); // super-admin in a DIFFERENT org
+    await mkUser('admin-other', 'org-other', 'org-admin'); // org-admin of the WRONG org
+    await mkUser('user-owner', 'org-owner', 'user'); // owner-org member without canEditApps
+    await mkUser('stale-admin', 'org-owner', 'org-admin'); // owner-org admin, token then epoch-staled
+
+    for (const u of ['owner-1', 'admin-owner', 'super-1', 'admin-other', 'user-owner', 'stale-admin']) {
+      tokens[u] = (await login(u, 'pw123456', false, loginDeps)).token;
+    }
+    // Epoch-stale: bump stale-admin's epoch far past its freshly-minted token's iat, so the SAME
+    // (otherwise-admin) token is now stale — proving the tokenEpoch leg of the chain rejects it.
+    bumpTokenEpoch('stale-admin', Math.floor(Date.now() / 1000) + 100_000);
+
+    const app = express();
+    app.use(express.json());
+    app.use('/api', appAssistantRouter(throwingDeps));
+    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
+    port = (server.address() as { port: number }).port;
+  }, 60_000);
+
+  afterAll(async () => {
+    server?.close();
+    await closeMongo();
+    await mem?.stop();
+    __resetActivationForTests();
+    __resetRevocationsForTests();
+  });
+
+  const bearer = (u: string) => ({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${tokens[u]}` });
+
+  it('an org-admin of the OWNER org -> 200 { admin:true }', async () => {
+    const res = await whoami(bearer('admin-owner'));
+    expect(res.status).toBe(200);
+    const body = await res.json();
+    expect(AppAssistantWhoamiResponse.safeParse(body).success).toBe(true);
+    expect(body).toEqual({ admin: true });
+  });
+
+  it('the artifact owner (org-admin of the owner org) -> 200 { admin:true }', async () => {
+    const res = await whoami(bearer('owner-1'));
+    expect(res.status).toBe(200);
+    expect(await res.json()).toEqual({ admin: true });
+  });
+
+  it('a super-admin (any org) -> 200 { admin:true }', async () => {
+    const res = await whoami(bearer('super-1'));
+    expect(res.status).toBe(200);
+    expect(await res.json()).toEqual({ admin: true });
+  });
+
+  it('an org-admin of ANOTHER org -> 200 { admin:false } (never 403 — no cross-org oracle)', async () => {
+    const res = await whoami(bearer('admin-other'));
+    expect(res.status).toBe(200);
+    expect(await res.json()).toEqual({ admin: false });
+  });
+
+  it('a plain user of the owner org -> 200 { admin:false } (H1 capability gate)', async () => {
+    const res = await whoami(bearer('user-owner'));
+    expect(res.status).toBe(200);
+    expect(await res.json()).toEqual({ admin: false });
+  });
+
+  it('NO token -> 200 { admin:false } (never a 401 — token absence is not an oracle)', async () => {
+    const res = await whoami({ 'x-ekoa-app-id': APP_ID });
+    expect(res.status).toBe(200);
+    expect(await res.json()).toEqual({ admin: false });
+  });
+
+  it('an INVALID token -> 200 { admin:false } (never a 401)', async () => {
+    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: 'Bearer not-a-jwt' });
+    expect(res.status).toBe(200);
+    expect(await res.json()).toEqual({ admin: false });
+  });
+
+  it('an EXPIRED token (would-be admin) -> 200 { admin:false }', async () => {
+    // A structurally-admin token (org-admin of the owner org) but already expired: the verify
+    // chain rejects it at verifyToken, so detection is false — expiry alone denies.
+    const expired = jwt.sign(
+      { sub: 'owner-1', role: 'org-admin', scope: 'user', orgId: 'org-owner', username: 'owner-1', jti: 'expired.1' },
+      's',
+      { expiresIn: -10 },
+    );
+    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${expired}` });
+    expect(res.status).toBe(200);
+    expect(await res.json()).toEqual({ admin: false });
+  });
+
+  it('an EPOCH-STALE token (would-be admin) -> 200 { admin:false }', async () => {
+    // stale-admin is an org-admin of the owner org; its token predates the epoch bump, so the
+    // tokenEpoch leg of the chain rejects it — a demoted/rotated session cannot detect as admin.
+    const res = await whoami(bearer('stale-admin'));
+    expect(res.status).toBe(200);
+    expect(await res.json()).toEqual({ admin: false });
+  });
+
+  it('a malformed X-Ekoa-App-Id -> 400 — the SAME status POST gives (charset check reused)', async () => {
+    const bad = { 'x-ekoa-app-id': 'bad app!', authorization: `Bearer ${tokens['admin-owner']}` };
+    const wRes = await whoami(bad);
+    const pRes = await postAssistant(bad);
+    expect(wRes.status).toBe(400);
+    expect(pRes.status).toBe(400); // POST rejects the same header identically
+    const wBody = (await wRes.json()) as { error: { code: string } };
+    expect(wBody.error.code).toBe('VALIDATION_FAILED');
+  });
+
+  it('the reserved usr. prefix on X-Ekoa-App-Id -> 400 (same as POST)', async () => {
+    const res = await whoami({ 'x-ekoa-app-id': 'usr.owner-1', authorization: `Bearer ${tokens['admin-owner']}` });
+    expect(res.status).toBe(400);
+  });
+
+  it('an unknown app id -> 404 { NOT_FOUND } (the SAME existence surface POST already exposes)', async () => {
+    const res = await whoami({ 'x-ekoa-app-id': 'no-such-app', authorization: `Bearer ${tokens['admin-owner']}` });
+    expect(res.status).toBe(404);
+    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
+  });
+});
diff --git a/api/tests/apps/assistant-panel.test.ts b/api/tests/apps/assistant-panel.test.ts
index 8388b07..f3827b9 100644
--- a/api/tests/apps/assistant-panel.test.ts
+++ b/api/tests/apps/assistant-panel.test.ts
@@ -36,122 +36,189 @@ const SKILL = readFileSync(
 
 describe('D2 assistant panel — files exist', () => {
   it('the panel + css + entry ship in the platform panel-runtime; the launcher ships in the app scaffold', () => {
     expect(existsSync(PANEL_PATH)).toBe(true);
     expect(PANEL.length).toBeGreaterThan(0);
     expect(CSS.length).toBeGreaterThan(0);
     expect(ENTRY.length).toBeGreaterThan(0);
     expect(MOUNT.length).toBeGreaterThan(0);
   });
 });
 
 describe('D2 panel source contract', () => {
   it('states the three capabilities with PT-PT example prompts on first open', () => {
     expect(PANEL).toContain('Dê-me uma visão geral da aplicação'); // Mostrar / show
     expect(PANEL).toContain('Mostre-me um tutorial'); // Ensinar / teach
     expect(PANEL).toContain('Adicione um novo registo'); // Operar / do (operate)
   });
 
   it('offers the three mode labels (Operar / Mostrar / Ensinar) mapped to do/show/teach', () => {
     expect(PANEL).toContain('Operar');
     expect(PANEL).toContain('Mostrar');
     expect(PANEL).toContain('Ensinar');
     expect(PANEL).toMatch(/id:\s*'do'/);
     expect(PANEL).toMatch(/id:\s*'show'/);
     expect(PANEL).toMatch(/id:\s*'teach'/);
   });
 
   it('POSTs to /api/app-assistant with the X-Ekoa-App-Id header read from window.__EKOA_APP_ID', () => {
     expect(PANEL).toContain('/api/app-assistant');
     expect(PANEL).toContain('X-Ekoa-App-Id');
     expect(PANEL).toContain('window.__EKOA_APP_ID');
     expect(PANEL).toMatch(/method:\s*'POST'/);
     // the request carries message + history + mode + context (route + recent action results)
     expect(PANEL).toContain('history');
     // bounded turn cost + a hung turn can never lock the composer (codex-d2 #2/#3)
     expect(PANEL).toMatch(/MAX_HISTORY_TURNS/);
     expect(PANEL).toMatch(/AbortController/);
     expect(PANEL).toMatch(/FETCH_TIMEOUT_MS/);
     expect(PANEL).toContain('context');
     expect(PANEL).toContain('actionResults');
   });
 
   it('dispatches each proposed action through window.__ekoaActions.execute (never on its own)', () => {
     expect(PANEL).toContain('window.__ekoaActions');
     expect(PANEL).toMatch(/\.execute\(/);
     expect(PANEL).toContain('data.actions'); // only ever the actions the assistant returned
     expect(PANEL).toContain('A executar...'); // the subtle in-flight state
     // the D1 enrichment drives the SERVER-resolved manifest action with the model's
     // input as VALUES - the exact transform, not a client-side reconstruction
     expect(PANEL).toContain('{ ...a.action, params: values }');
   });
 
   it('renders a "Fontes" citation list from response.citations', () => {
     expect(PANEL).toContain('Fontes');
     expect(PANEL).toContain('citations');
     expect(PANEL).toContain('collection');
     expect(PANEL).toContain('title');
   });
 
   it('renders a calm PT-PT message on an endpoint error / missing runtime (never a crash)', () => {
     expect(PANEL).toContain('O assistente está indisponível de momento.');
     // execute() is guarded when the runtime is absent (standalone preview)
     expect(PANEL).toMatch(/typeof runtime\.execute !== 'function'/);
   });
 
   it('does not autofocus on mount (never steals focus from the app)', () => {
     // No JSX autoFocus attribute anywhere; imperative .focus() exists but only behind
     // explicit user intent (open / example click), never at render.
     expect(PANEL).not.toMatch(/autoFocus/);
     expect(PANEL).toContain('user intent');
   });
 
   it('contains NO emoji (UI-code rule) — panel and css', () => {
     const inPanel = PANEL.match(/\p{Extended_Pictographic}/u);
     expect(inPanel, inPanel ? `panel emoji: ${JSON.stringify(inPanel[0])}` : '').toBeNull();
     const inCss = CSS.match(/\p{Extended_Pictographic}/u);
     expect(inCss, inCss ? `css emoji: ${JSON.stringify(inCss[0])}` : '').toBeNull();
   });
 });
 
+describe('H2 admin detection (detect-then-ask)', () => {
+  it('reads the platform token DEFENSIVELY from localStorage (try/catch, swallow to null)', () => {
+    // The panel reads the SAME key web/lib/api/token.ts uses; a cross-origin / sandboxed iframe
+    // throws a SecurityError on localStorage access, so the read is wrapped and degrades to null.
+    expect(PANEL).toContain('ekoa_token');
+    expect(PANEL).toContain('readPlatformToken');
+    expect(PANEL).toContain('getItem(TOKEN_STORAGE_KEY)');
+    // The defensive read has a try/catch that returns null (no crash on a cross-origin iframe).
+    const helper = PANEL.slice(PANEL.indexOf('function readPlatformToken'), PANEL.indexOf('function readPlatformToken') + 500);
+    expect(helper).toMatch(/try\s*\{/);
+    expect(helper).toMatch(/catch\s*\{[\s\S]*return null/);
+  });
+
+  it('calls GET /api/app-assistant/whoami exactly ONCE, on mount, with X-Ekoa-App-Id + an OPTIONAL Bearer', () => {
+    // The endpoint literal lives once (in the WHOAMI_ENDPOINT constant); the fetch uses the const.
+    expect(PANEL).toContain('/api/app-assistant/whoami');
+    expect((PANEL.match(/\/api\/app-assistant\/whoami/g) || []).length).toBe(1);
+    expect(PANEL).toContain('WHOAMI_ENDPOINT');
+    // A mount-only, once-guarded detection (no per-render loop; idempotent under StrictMode).
+    expect(PANEL).toContain('whoamiDoneRef');
+    expect(PANEL).toContain('whoamiDoneRef.current = true');
+    // It is a GET carrying the app id; the platform Bearer is attached only when readable.
+    const effect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
+    expect(effect).toContain('WHOAMI_ENDPOINT');
+    expect(effect).toMatch(/method:\s*'GET'/);
+    expect(effect).toContain("'X-Ekoa-App-Id': id");
+    expect(effect).toMatch(/token \? \{ Authorization: `Bearer \$\{token\}` \}/);
+    // The mount effect closes with an empty dependency array (runs once for the panel's lifetime).
+    expect(effect).toMatch(/\},\s*\[\]\);/);
+  });
+
+  it('a false detection renders NO admin affordance (the indicator is gated on admin)', () => {
+    // admin defaults false (fail-closed) and the discreet indicator is conditionally rendered:
+    // false -> null (nothing on screen), true -> the quiet "Administrador" badge.
+    expect(PANEL).toMatch(/const \[admin, setAdmin\] = useState\(false\)/);
+    expect(PANEL).toContain('Administrador');
+    expect(PANEL).toMatch(/\{admin \? \(/);
+    // The whole badge block is guarded by `admin ? (...) : null`, so nothing renders when false.
+    const header = PANEL.slice(PANEL.indexOf('ekoa-assistant-titlegroup'), PANEL.indexOf('ekoa-assistant-close'));
+    expect(header).toMatch(/admin \? \([\s\S]*\) : null/);
+  });
+
+  it('DETECT-THEN-ASK: admin:true never auto-enables anything (no edit mode, no privileged call)', () => {
+    // The indicator is inert: no click handler, no mode change, no fetch driven by `admin`.
+    const badge = PANEL.slice(PANEL.indexOf('ekoa-assistant-admin-badge'), PANEL.indexOf('Administrador') + 20);
+    expect(badge).not.toContain('onClick');
+    // `admin` is SET once (the detection) and READ only to render the badge — it drives no action.
+    expect((PANEL.match(/setAdmin\(/g) || []).length).toBe(1);
+    // H2 builds no edit-mode machinery / opt-in switch (that is H3): none of the tokens an actual
+    // edit-mode implementation would introduce exist yet. (Comments MAY mention "edit mode" as the
+    // deferred H3 work; these tokens name the affordance itself, so they won't collide with prose.)
+    expect(PANEL).not.toMatch(/setEditMode|editEnabled|isEditing|enterEditMode|edit-mode-toggle/);
+    // The invariant is stated in the source so review can pin it.
+    expect(PANEL).toContain('detect-then-ask');
+    expect(PANEL).toContain('H3');
+  });
+
+  it('detection is zero-token: whoami is a non-LLM GET, never an assistant turn', () => {
+    // The detection path must not post to the assistant endpoint or dispatch actions.
+    const effect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
+    expect(effect).not.toContain('runActions');
+    expect(effect).not.toMatch(/method:\s*'POST'/);
+    // The zero-token invariant is stated on the detection effect so review can pin it.
+    expect(PANEL).toContain('zero-token');
+  });
+});
+
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
diff --git a/api/tests/contract/app-assistant.contract.test.ts b/api/tests/contract/app-assistant.contract.test.ts
index 3baacf8..16a0ef9 100644
--- a/api/tests/contract/app-assistant.contract.test.ts
+++ b/api/tests/contract/app-assistant.contract.test.ts
@@ -1,109 +1,142 @@
 import { describe, it, expect } from 'vitest';
 import {
   AssistantChatRequest,
   AssistantChatResponse,
+  AppAssistantWhoamiResponse,
   appAssistantEndpoints,
   ErrorEnvelope,
   ALL_ENDPOINTS,
   ERROR_STATUS,
 } from '@ekoa/shared';
 
 /**
  * operator-run D1 — contract suite for the served-app assistant endpoint (`POST /api/app-assistant`).
  * The descriptor pre-existed; D1 EVOLVES its request/response additively (mode + context on the
  * request; citations + actions + mode on the response). This validates a representative
  * AssistantChatResponse against the shared schema, proves back-compat (the base `{ message }` /
  * `{ reply }` shapes still validate), and checks the CONV-2 error envelope the route emits — the
  * QA-layer-3 "new endpoint ⇒ contract test in the same slice" obligation.
  */
 
 describe('AssistantChatResponse contract (D1)', () => {
   it('validates a full response (reply + citations + actions + mode)', () => {
     const sample = {
       reply: 'Vou criar o cliente para si. Feito.',
       mode: 'do' as const,
       citations: [{ collection: 'faq', docId: 'd1', title: 'Como criar cliente' }],
       actions: [{ toolName: 'app_action__criar_cliente', input: { nome: 'Ana', ativo: true } }],
     };
     const r = AssistantChatResponse.safeParse(sample);
     expect(r.success).toBe(true);
   });
 
   it('back-compat: the base { reply } response still validates (all new fields optional)', () => {
     expect(AssistantChatResponse.safeParse({ reply: 'Olá' }).success).toBe(true);
   });
 
   it('rejects a bad mode and a missing reply', () => {
     expect(AssistantChatResponse.safeParse({ reply: 'x', mode: 'sideways' }).success).toBe(false);
     expect(AssistantChatResponse.safeParse({ mode: 'do' }).success).toBe(false);
   });
 
   it('an action input must be an object (record), never a scalar', () => {
     expect(AssistantChatResponse.safeParse({ reply: 'x', actions: [{ toolName: 't', input: {} }] }).success).toBe(true);
     expect(AssistantChatResponse.safeParse({ reply: 'x', actions: [{ toolName: 't', input: 'oops' }] }).success).toBe(false);
   });
 
   it('an action may carry the server-resolved manifest AppAction (D1 attaches it for C3)', () => {
     const withAction = {
       reply: 'Vou criar o cliente.',
       actions: [{
         toolName: 'app_action__criar_cliente',
         input: { nome: 'Ana' },
         action: { id: 'criar-cliente', kind: 'custom', labelPt: 'Criar cliente', description: 'Cria um cliente', params: [], destructive: false },
       }],
     };
     expect(AssistantChatResponse.safeParse(withAction).success).toBe(true);
     // A malformed embedded action (navigate without a route) is rejected by the AppAction contract.
     const badAction = {
       reply: 'x',
       actions: [{ toolName: 't', input: {}, action: { id: 'ir', kind: 'navigate', labelPt: 'Ir', description: 'x' } }],
     };
     expect(AssistantChatResponse.safeParse(badAction).success).toBe(false);
   });
 });
 
 describe('AssistantChatRequest contract (D1)', () => {
   it('back-compat: the base { message } request still validates', () => {
     expect(AssistantChatRequest.safeParse({ message: 'olá' }).success).toBe(true);
   });
 
   it('validates the evolved request (history + context + mode)', () => {
     const req = {
       message: 'Mostra-me a aplicação',
       history: [{ role: 'user' as const, content: 'olá' }, { role: 'assistant' as const, content: 'viva' }],
       context: { route: '/clientes', actionResults: [{ ok: true }] },
       mode: 'show' as const,
     };
     expect(AssistantChatRequest.safeParse(req).success).toBe(true);
   });
 
   it('rejects an invalid mode', () => {
     expect(AssistantChatRequest.safeParse({ message: 'x', mode: 'nope' }).success).toBe(false);
   });
 });
 
 describe('appAssistant endpoint descriptor (D1)', () => {
   it('the descriptor is intact and points at the evolved schemas', () => {
     const d = appAssistantEndpoints.assistantChat;
     expect(d.method).toBe('POST');
     expect(d.path).toBe('/api/app-assistant');
     expect(d.auth).toBe('header-scoped');
     // The descriptor's request/response ARE the evolved schemas.
     expect(d.request.safeParse({ message: 'x', mode: 'teach' }).success).toBe(true);
     expect(d.response.safeParse({ reply: 'x', citations: [{ collection: 'c', docId: 'd', title: 't' }] }).success).toBe(true);
   });
 
   it('stays accounted for in the shared descriptor census (schema-coverage input)', () => {
     expect(ALL_ENDPOINTS.appAssistant?.assistantChat).toBeTruthy();
   });
 });
 
+describe('AppAssistantWhoamiResponse contract (H2)', () => {
+  it('validates BOTH branches: { admin:true } and { admin:false }', () => {
+    expect(AppAssistantWhoamiResponse.safeParse({ admin: true }).success).toBe(true);
+    expect(AppAssistantWhoamiResponse.safeParse({ admin: false }).success).toBe(true);
+  });
+
+  it('is strict: admin must be a boolean and NOTHING else may ride the wire', () => {
+    // A non-boolean admin is rejected...
+    expect(AppAssistantWhoamiResponse.safeParse({ admin: 'true' }).success).toBe(false);
+    expect(AppAssistantWhoamiResponse.safeParse({}).success).toBe(false);
+    // ...and .strict() forbids leaking any identity/org/role/reason field alongside the boolean
+    // (the endpoint is fail-closed and oracle-free — the boolean is the entire answer).
+    expect(AppAssistantWhoamiResponse.safeParse({ admin: true, orgId: 'org-owner' }).success).toBe(false);
+    expect(AppAssistantWhoamiResponse.safeParse({ admin: false, reason: 'wrong-org' }).success).toBe(false);
+  });
+});
+
+describe('appAssistant whoami descriptor (H2)', () => {
+  it('is an additive GET detection endpoint pointing at the strict boolean schema', () => {
+    const d = appAssistantEndpoints.whoami;
+    expect(d.method).toBe('GET');
+    expect(d.path).toBe('/api/app-assistant/whoami');
+    expect(d.auth).toBe('header-scoped'); // app-id scoped; the platform Bearer is optional
+    expect('request' in d).toBe(false); // a GET carries no request body
+    expect(d.response?.safeParse({ admin: true }).success).toBe(true);
+  });
+
+  it('stays accounted for in the shared descriptor census (schema-coverage input)', () => {
+    expect(ALL_ENDPOINTS.appAssistant?.whoami).toBeTruthy();
+  });
+});
+
 describe('app-assistant error envelope (D1, CONV-2)', () => {
   it('the route error codes validate as CONV-2 envelopes with the right status', () => {
     for (const code of ['VALIDATION_FAILED', 'NOT_FOUND', 'ACCOUNT_DISABLED', 'BILLING_LOCKED', 'BILLING_BLOCKED', 'INTERNAL'] as const) {
       const body = { error: { code, message: 'msg' } };
       expect(ErrorEnvelope.safeParse(body).success, code).toBe(true);
       expect(typeof ERROR_STATUS[code]).toBe('number');
     }
   });
 });
diff --git a/api/tests/contract/schema-coverage.test.ts b/api/tests/contract/schema-coverage.test.ts
index 88272f3..d075972 100644
--- a/api/tests/contract/schema-coverage.test.ts
+++ b/api/tests/contract/schema-coverage.test.ts
@@ -9,117 +9,121 @@ import { ALL_ENDPOINTS, allEndpointsFlat } from '@ekoa/shared';
  * (the ch13 §13.11 item-5 deliberate-red mechanism). PENDING must SHRINK at every domain gate
  * and be EMPTY at G9.
  *
  * KNOWN LIMIT — this gate does NOT verify that a test exercises a COVERED endpoint. It asserts
  * only (a) every COVERED string names a real descriptor and (b) the PENDING count is the pinned
  * constant. COVERED is a hand-maintained CLAIM: adding a key with zero tests passes. ch13 §13.5
  * specifies a run-wide registry of actually-exercised schemas; that mechanism is not implemented.
  * This has already shipped real bugs twice — F22 (`memoryView` omitted required fields, /memory
  * rendered zero cards) and the sessions family (`sessionView` omitted createdAt/updatedAt and
  * emitted `title` for `name`; message bodies emitted `_id`/`timestamp` for `id`/`createdAt`) —
  * both while their keys sat in COVERED and no test ever requested the path. An audit on
  * 2026-07-10 found 27 of 154 COVERED keys unexercised (RUN_LOG). Do not read a green gate here
  * as evidence that an endpoint's body matches its schema.
  */
 
 // Endpoints with a committed contract/e2e test now (G2 auth + G3 CRUD domains).
 const COVERED = new Set<string>([
   'auth.login', 'auth.me',
   // batch1 F1 — auth lifecycle (auth.test.ts)
   'auth.refresh', 'auth.logout', 'auth.changePassword', 'auth.deviceStart', 'auth.devicePoll', 'auth.deviceApprove',
   'users.list', 'users.create', 'users.update', 'users.remove', 'users.resetPassword',
   'org.getOrg', 'org.updateOrg', 'org.saveBranding', 'org.createOrg', 'org.listOrgs', 'org.patchOrg',
   // batch1 F4 — brand research at the contract path (branding.test.ts)
   'org.researchBranding',
   // F10 deny-list CRUD (batch-final s1) — exercised by tests/contract/denylist.test.ts
   'org.listDenyList', 'org.addDenyListEntry', 'org.removeDenyListEntry',
   'settings.get', 'settings.update', 'settings.updateMe',
   'sessions.create', 'sessions.list', 'sessions.get', 'sessions.update', 'sessions.delete', 'sessions.getMessages', 'sessions.addMessage',
   'memories.list', 'memories.get', 'memories.create', 'memories.update', 'memories.delete',
   'registo.listRegisto',
   'billing.getUsage', 'billing.getHistory',
   // G7 — billing metering write + admin surfaces (billing.test.ts)
   'billing.getBreakdown', 'billing.purchaseCredits', 'billing.toggleOverage', 'billing.adminGlobalOverage',
   'billing.adminListUsage', 'billing.adminResetUsage', 'billing.adminSetLimit',
   // G4 — integrations + knowledge (partial: configs CRUD + sources CRUD + uploads list)
   'integrations.listConfigs', 'integrations.createConfig', 'integrations.updateConfig', 'integrations.deleteSkill',
   'knowledge.listSources', 'knowledge.createSource', 'knowledge.deleteSource', 'knowledge.listUploads',
   // G7B — knowledge vault + lexical index (knowledge.test.ts)
   'knowledge.listCollections', 'knowledge.listDocuments', 'knowledge.createDocument', 'knowledge.deleteDocument',
   'knowledge.createUpload', 'knowledge.deleteUpload', 'knowledge.reindex', 'knowledge.indexStatus',
   // G5 — triggers + webhook ingress + notifications SSE
   'triggers.list', 'triggers.create', 'triggers.delete', 'triggers.webhookIngressPost', 'triggers.webhookIngressGet',
   'notifications.events',
   // G6 (data-plane core) — artifacts CRUD + the byte-compatible served-app data plane
   'artifacts.list', 'artifacts.get', 'artifacts.patch', 'artifacts.remove',
   'servedApp.appDataList', 'servedApp.appDataGet', 'servedApp.appDataCreate', 'servedApp.appDataUpsert', 'servedApp.appDataDelete',
   'servedApp.appSharedList', 'servedApp.appSharedGet', 'servedApp.appSharedCreate', 'servedApp.appSharedUpsert', 'servedApp.appSharedDelete',
   // G6 (full) — artifact family, backups, backend runtime, company-space (artifact-family.test.ts)
   'artifacts.fork', 'artifacts.export', 'artifacts.import', 'artifacts.bundleUpdate', 'artifacts.setFeatured',
   'artifacts.featuredUpdateApply', 'artifacts.featuredUpdateIgnore', 'artifacts.versionsList', 'artifacts.versionsRestore',
   'artifacts.filesList', 'artifacts.readFile', 'artifacts.writeFile', 'artifacts.download', 'artifacts.pdf',
   'artifacts.backupStatus', 'artifacts.backupSnapshot', 'artifacts.backupExport', 'artifacts.backupPreview', 'artifacts.backupRestore',
   'artifacts.backendStatus', 'artifacts.backendLogs', 'artifacts.backendInvocations', 'artifacts.backendSetEnabled', 'artifacts.backendSampleRun',
   'companySpace.list', 'companySpace.get', 'companySpace.start', 'companySpace.stop',
   // G6 — served-app files/sso/cloud/m365 (app-files.test.ts, app-sso.test.ts)
   'servedApp.appFileUpload', 'servedApp.appFileGet', 'servedApp.appFileDelete',
   'servedApp.appSsoLogin', 'servedApp.appSsoSetPassword', 'servedApp.appSsoLogout', 'servedApp.appSsoMe',
   'servedApp.appSsoMicrosoftStart', 'servedApp.appSsoM365', 'servedApp.appCloudFilesStatus', 'servedApp.m365Proxy',
   // G6 — legal vertical services + e-sign (legal-plane.test.ts)
   'servedApp.legalCalculos', 'servedApp.legalTranscricao', 'servedApp.legalResearch', 'servedApp.trackingConsulta',
   'servedApp.citiusConsulta', 'servedApp.signatureSend', 'servedApp.adobeSignWebhookGet', 'servedApp.adobeSignWebhookPost',
   // G6 — serving plane + health + demos (served-app.test.ts)
   'servedApp.appHealth', 'servedApp.serveApp', 'servedApp.demoBridge',
   // G6 — integration definitions registry (integration-definitions.test.ts)
   'integrations.list', 'integrations.listActive', 'integrations.refresh',
   // G7B — agent execution: chat runs + build jobs (chat.test.ts, jobs.test.ts)
   'chat.createRun', 'chat.getRun', 'chat.runEvents', 'chat.cancelRun',
   'jobs.create', 'jobs.get', 'jobs.cancel', 'jobs.events',
   // batch1 F2 — model-credential provisioning (credentials.test.ts)
   'credentials.set',
   // batch1 F5 subset — the UI-called endpoints (memories.test.ts, f5-ui-endpoints.test.ts)
   'memories.bulkDelete', 'memories.submitSignal', 'memories.listTags', 'memories.stats',
   'knowledge.updateSource', 'knowledge.crawlSource', 'knowledge.crawlStatus', 'knowledge.refreshSchedule',
   'integrations.sessionStatus', 'integrations.connectSession', 'integrations.provisionAutomations',
   // PR4 — the AI integration builder (integration-builder.test.ts): chat/load/save/test.
   'integrationBuilder.chat', 'integrationBuilder.load', 'integrationBuilder.save', 'integrationBuilder.test',
   // Local-bridge consumer run s1 — hosted presence (bridge-status.test.ts)
   'ekoaLocal.bridgeStatus',
   // Local-bridge consumer run s5 — FC-408 masking summary (masking-summary.test.ts)
   'registo.maskingSummary',
+  // operator-run H2 — served-app assistant admin detection (app-assistant.contract.test.ts +
+  // the whoami route matrix in tests/apps/app-assistant.test.ts). Additive endpoint: covering it
+  // keeps EXPECTED_PENDING_COUNT unchanged (assistantChat stays PENDING as before).
+  'appAssistant.whoami',
 ]);
 
 // Not-yet-landed endpoints (committed allowlist; SHRINKS each gate, EMPTY at G9). Computed as
 // "every descriptor endpoint not in COVERED" here, but pinned by an expected-count assertion so
 // a NEW endpoint added to shared/ without being COVERED bumps the count and fails the gate.
 // G5->G6: 148->95; G6->G7: 95->88 (7 billing write/admin endpoints) as the full served-app plane, artifact family, legal vertical, and
 // integration-definitions surfaces landed with their contract tests (53 endpoints newly covered).
 // G7->G7B: 88->80 as the knowledge vault + lexical index surface landed (8 endpoints: collections,
 // documents list/ingest/delete, uploads create/delete, reindex, index-status). Knowledge crawl
 // endpoints (updateSource, crawlSource, crawlStatus, refreshSchedule) remain PENDING for the crawl gate.
 // G7B agent-execution: 80->72 as chat runs (4) + build jobs (4) landed with their contract tests.
 const EXPECTED_PENDING_COUNT = 49; // F1 -7 (72->65); F4 -1 (->64); F5 subset -11 (->53); PR4 integration-builder -4 (->49)
 
 describe('schema-coverage gate (ch13 §13.5 item 3)', () => {
   it('every descriptor endpoint is COVERED or PENDING (no unaccounted schema)', () => {
     const all = allEndpointsFlat().map((e) => `${e.domain}.${e.name}`);
     // Every COVERED name must be a real descriptor (no drift / stale coverage claim).
     for (const c of COVERED) {
       expect(all, `COVERED names a real descriptor: ${c}`).toContain(c);
     }
     const pending = all.filter((k) => !COVERED.has(k));
     // The deliberate-red bite: a new endpoint added to shared/ that is neither COVERED nor
     // expected in PENDING changes this count, failing the gate. (Verified by a temporary
     // shared/ addition during the build — logged in RUN_LOG per ch13 §13.11 item 5.)
     expect(pending.length, 'PENDING allowlist count (shrinks each gate, 0 at G9)').toBe(EXPECTED_PENDING_COUNT);
   });
 
   it('landed domains at G3 are present and covered', () => {
     for (const d of ['auth', 'users', 'org', 'settings', 'sessions', 'memories', 'registo', 'billing']) {
       expect(ALL_ENDPOINTS[d as keyof typeof ALL_ENDPOINTS]).toBeTruthy();
     }
     // A representative endpoint from each landed domain is covered.
     for (const c of ['users.list', 'memories.get', 'registo.listRegisto', 'org.getOrg']) {
       expect(COVERED.has(c)).toBe(true);
     }
   });
 });
diff --git a/shared/src/app-assistant.ts b/shared/src/app-assistant.ts
index 03d3bf6..86dddf1 100644
--- a/shared/src/app-assistant.ts
+++ b/shared/src/app-assistant.ts
@@ -6,89 +6,109 @@
  * three capabilities on top:
  *   - `mode` ('do' | 'show' | 'teach') — the assistant OPERATES the app (do), gives an overview
  *     (show), or teaches/tutorials (teach). The client may pin it; otherwise the server infers it
  *     from the message and echoes the inferred value back.
  *   - request `context` — the panel's current screen state (route + prior action results) so the
  *     assistant grounds its answer in what the visitor is looking at.
  *   - response `citations` — the knowledge excerpts the reply drew on (cite-your-source), one per
  *     grounding hit, addressed by (collection, docId) — the pair `knowledge_read` takes.
  *   - response `actions` — the app-actions the assistant wants the in-page runtime (C3) to
  *     execute. The server proposes; it never dispatches. Each names a manifest tool + its input.
  */
 import { z } from 'zod';
 import type { DomainDescriptorMap } from './descriptor.js';
 import { AppAction } from './action-manifest.js';
 
 export const AssistantChatMessage = z.object({
   role: z.enum(['user', 'assistant']),
   content: z.string(),
 });
 export type AssistantChatMessage = z.infer<typeof AssistantChatMessage>;
 
 /** The assistant's operating mode: operate the app / give an overview / teach. */
 export const AssistantChatMode = z.enum(['do', 'show', 'teach']);
 export type AssistantChatMode = z.infer<typeof AssistantChatMode>;
 
 /** The panel's current screen state, forwarded so the assistant grounds in what the visitor sees.
  *  `actionResults` are opaque outputs of previously-dispatched app-actions (client-shaped). */
 export const AssistantChatContext = z.object({
   route: z.string().optional(),
   actionResults: z.array(z.unknown()).optional(),
 });
 export type AssistantChatContext = z.infer<typeof AssistantChatContext>;
 
 export const AssistantChatRequest = z.object({
   message: z.string(),
   history: z.array(AssistantChatMessage).optional(),
   /** The panel's current screen state (D1). */
   context: AssistantChatContext.optional(),
   /** Pin the mode; when absent the server infers it and echoes it back on the response (D1). */
   mode: AssistantChatMode.optional(),
 });
 export type AssistantChatRequest = z.infer<typeof AssistantChatRequest>;
 
 /** One knowledge citation the reply drew on — addressed by (collection, docId), title for display. */
 export const AssistantCitation = z.object({
   collection: z.string(),
   docId: z.string(),
   title: z.string(),
 });
 export type AssistantCitation = z.infer<typeof AssistantCitation>;
 
 /** One app-action the assistant asks the in-page runtime (C3) to execute. `toolName` is a
  *  manifest tool name (`app_action__<id>`); `input` is the tool's validated arguments (VALUES).
  *
  *  `action` is the SERVER-RESOLVED manifest AppAction (kind/target/route/tourId/labelPt/destructive/
  *  params-definitions). D1 attaches it because the C3 same-document runtime's `perform()` needs a
  *  full AppAction (it fails `invalid-action` without `action.kind`) and the served page is NOT
  *  injected with the manifest — so the client cannot resolve `toolName → AppAction` on its own. The
  *  client dispatches `execute({ ...action, params: input })` (input overrides the definition-shaped
  *  params with VALUES at execute time). Keeping the executable shape server-authoritative (from the
  *  app's own activation-time manifest) means neither the model nor the anonymous visitor can forge a
  *  kind/target. Optional for back-compat; D1 always populates it for a validated toolName. */
 export const AssistantAction = z.object({
   toolName: z.string(),
   input: z.record(z.unknown()),
   action: AppAction.optional(),
 });
 export type AssistantAction = z.infer<typeof AssistantAction>;
 
 export const AssistantChatResponse = z.object({
   reply: z.string(),
   /** Knowledge excerpts the reply cited (D1; cite-your-source). Absent when nothing was grounded. */
   citations: z.array(AssistantCitation).optional(),
   /** App-actions the assistant wants the client runtime to execute (D1). Absent when none. */
   actions: z.array(AssistantAction).optional(),
   /** The mode the assistant operated in — the client's pin, or the server's inference (D1). */
   mode: AssistantChatMode.optional(),
 });
 export type AssistantChatResponse = z.infer<typeof AssistantChatResponse>;
 
+/** Admin-detection response for the served-app assistant (operator-run H2; detect-then-ask).
+ *
+ *  The panel asks `GET /api/app-assistant/whoami` (X-Ekoa-App-Id + an OPTIONAL platform Bearer)
+ *  whether the current viewer is an admin of the app OWNER's org WITH the `canEditApps` capability.
+ *  The answer is a single boolean and NOTHING else: `.strict()` so no identity, org, role, or
+ *  reason ever leaks onto the wire (the endpoint is fail-closed and oracle-free — see the route).
+ *  `admin: true` is a capability HINT only; every privileged action stays gated server-side by the
+ *  H1 admission plane, and the panel never auto-enables anything from it (edit mode is H3). */
+export const AppAssistantWhoamiResponse = z.object({ admin: z.boolean() }).strict();
+export type AppAssistantWhoamiResponse = z.infer<typeof AppAssistantWhoamiResponse>;
+
 export const appAssistantEndpoints = {
   assistantChat: {
     method: 'POST',
     path: '/api/app-assistant',
     auth: 'header-scoped',
     request: AssistantChatRequest,
     response: AssistantChatResponse,
   },
+  // H2 admin detection. Header-scoped like its sibling (X-Ekoa-App-Id resolves the app); the
+  // platform Bearer is OPTIONAL and read only to detect the viewer — never required, never an
+  // oracle (a missing/invalid token is always a 200 { admin: false }, never a 401/403).
+  whoami: {
+    method: 'GET',
+    path: '/api/app-assistant/whoami',
+    auth: 'header-scoped',
+    response: AppAssistantWhoamiResponse,
+  },
 } as const satisfies DomainDescriptorMap;

codex
I’ve got the diff. Next I’m tracing the live `whoami` handler and the token-verification path it actually calls, then I’ll cross-check whether the POST assistant path changed behavior when `resolveAssistantApp` was extracted.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/src/apps/app-assistant-route.ts | sed -n '1,320p'
nl -ba api/src/apps/app-assistant-route.ts | sed -n '321,520p'
nl -ba api/src/apps/app-assistant.ts | sed -n '1,260p'
nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '1,260p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	/**
     2	 * Served-app assistant plane (operator-run D1) — `POST /api/app-assistant`.
     3	 *
     4	 * The header-scoped (no platform JWT) endpoint the served app's assistant panel calls. It reuses
     5	 * the served-data admission plane: the `X-Ekoa-App-Id` header (charset-checked; the reserved `usr.`
     6	 * shared-namespace prefix rejected) resolves to the artifact, whose OWNER's activation gates the
     7	 * plane (fail-closed). Unlike the byte-compatible key-value app-data plane, the assistant REQUIRES
     8	 * a resolved artifact-backed owner — it has to run under that owner's org and bill that owner — so
     9	 * an unresolved / registry-only (dev-serve) id is a 404 here rather than an anonymous scope.
    10	 *
    11	 * Errors speak the CONV-2 envelope (a new endpoint, not the old app-data string envelope). This
    12	 * module may not import routes/ (ch02 §2.7 lint zone), so it emits the envelope directly off the
    13	 * shared ERROR_STATUS table — the same shape routes/helpers.sendError produces.
    14	 *
    15	 * The org the assistant grounds under and the user it bills come ONLY from the server-resolved
    16	 * owner — never from the anonymous visitor's body. The billing allowance gate is billed to that
    17	 * same owner (the served-app assistant is a named synchronous entry in billing/allowance.ts).
    18	 */
    19	import { Router, type Request, type Response, type RequestHandler, type NextFunction } from 'express';
    20	import {
    21	  AssistantChatRequest,
    22	  AppActionManifest,
    23	  ERROR_STATUS,
    24	  type ErrorCode,
    25	  type AssistantChatResponse,
    26	  type AppAssistantWhoamiResponse,
    27	} from '@ekoa/shared';
    28	import { collectionName } from '../data/collections-engine.js';
    29	import { getActivation } from '../data/activation.js';
    30	import { users, artifacts } from '../data/stores.js';
    31	import { allowanceMiddleware } from '../billing/index.js';
    32	import { runOneShot, decideForTask } from '../llm/index.js';
    33	import { buildGroundingBlock } from '../knowledge/index.js';
    34	import { verifySseToken } from '../auth/middleware.js';
    35	import { can } from '../auth/capabilities.js';
    36	import type { JwtClaims } from '../auth/jwt.js';
    37	import { resolveApp, type ResolvedApp } from './registry.js';
    38	import { runAppAssistant, type AppAssistantDeps } from './app-assistant.js';
    39	
    40	const SHARED_SCOPE_PREFIX = 'usr.';
    41	
    42	/** CONV-2 error envelope off the shared status table (routes/ is off-limits to apps/, ch02 §2.7). */
    43	function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
    44	  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
    45	}
    46	
    47	/**
    48	 * Resolve the `X-Ekoa-App-Id` header to an artifact-backed owner — the SHARED front half of every
    49	 * app-assistant plane entry (POST admission AND the H2 whoami detection), so both apply the exact
    50	 * same charset/collision checks and expose the exact same existence surface (no plane is a
    51	 * different oracle than the other). A discriminated result the callers turn into the CONV-2
    52	 * envelope: `invalid-id` → 400 VALIDATION_FAILED, `not-found` → 404 NOT_FOUND, `ok` → the app.
    53	 */
    54	type AssistantAppResolution =
    55	  | { status: 'invalid-id' }
    56	  | { status: 'not-found' }
    57	  | { status: 'ok'; app: ResolvedApp };
    58	
    59	async function resolveAssistantApp(header: unknown): Promise<AssistantAppResolution> {
    60	  // Same header contract admit() has always applied: a string, a valid collection-name charset,
    61	  // and NOT the reserved `usr.` shared-namespace prefix.
    62	  if (
    63	    typeof header !== 'string' ||
    64	    !collectionName.safeParse(header).success ||
    65	    header.startsWith(SHARED_SCOPE_PREFIX)
    66	  ) {
    67	    return { status: 'invalid-id' };
    68	  }
    69	  const app = await resolveApp(header);
    70	  // The assistant plane needs a real artifact-backed owner (org to scope by, user to attribute).
    71	  // A dev-serve / registry-only or unresolved id has none — the same 404 admit() gives.
    72	  if (!app || !app.artifactBacked || !app.ownerUserId) return { status: 'not-found' };
    73	  return { status: 'ok', app };
    74	}
    75	
    76	/**
    77	 * Is this verified caller an admin of the app OWNER's org WITH the app-edit capability? PURE role
    78	 * decision (the token is already verified by the caller). Gated by H1's `can()` so the role→
    79	 * capability grid is the single source of truth — a `user` fails the capability gate, so only
    80	 * `org-admin`/`super-admin` reach the org check. A super-admin spans every org; an org-admin must
    81	 * belong to the owner's exact org. Fail-closed for any other shape. Exported for the unit matrix.
    82	 */
    83	export function isOwnerOrgAdmin(claims: Pick<JwtClaims, 'role' | 'orgId'>, ownerOrgId: string): boolean {
    84	  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
    85	  if (claims.role === 'super-admin') return true; // super-admin edits apps in any org
    86	  if (claims.role === 'org-admin') return claims.orgId === ownerOrgId; // org-admin scoped to owner org
    87	  return false; // unreachable given the capability gate, but fail-closed by construction
    88	}
    89	
    90	/**
    91	 * Detect whether the OPTIONAL platform Bearer on this request belongs to an admin of `ownerOrgId`.
    92	 * FAIL-CLOSED and oracle-free: any deviation — no token, a non-Bearer header, or a token that does
    93	 * not clear the standard verification chain — returns false, never throws, never distinguishes a
    94	 * bad token from a wrong-org one. The verification is the EXACT chain requireAuth/verifySseToken
    95	 * run (verifyToken + jti + isRevoked + activation-active + tokenEpoch); this endpoint does NOT
    96	 * hand-roll a weaker check and adds NO second identity path.
    97	 */
    98	function detectOwnerOrgAdmin(authHeader: string | undefined, ownerOrgId: string): boolean {
    99	  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
   100	  if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
   101	  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
   102	  if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
   103	  return isOwnerOrgAdmin(verified.claims, ownerOrgId);
   104	}
   105	
   106	/** What the admission middleware resolves and stashes for the handler + allowance gate. */
   107	interface AssistantAdmission {
   108	  owner: { userId: string; orgId: string };
   109	  artifactId: string;
   110	  actionManifest: AppActionManifest | null;
   111	}
   112	interface AssistantRequest extends Request {
   113	  ekoaAssistant?: AssistantAdmission;
   114	}
   115	
   116	/** The production deps: the assistant's only model egress is the llm/ chokepoint one-shot; grounding
   117	 *  rides the knowledge/ builder; the tier is floored at WORKHORSE like chat (D1 owner-org grounding
   118	 *  is passed in by the admission middleware, not here). */
   119	const prodDeps: AppAssistantDeps = {
   120	  oneShot: runOneShot,
   121	  ground: buildGroundingBlock,
   122	  decide: (message) => decideForTask(message, undefined, 'WORKHORSE'),
   123	};
   124	
   125	export function appAssistantRouter(deps: AppAssistantDeps = prodDeps): Router {
   126	  const r = Router();
   127	
   128	  /**
   129	   * Served-app admission (mirrors served-data's headerFor + admitOwner, then resolves the owner org
   130	   * and the app's action manifest). On any refusal it writes the CONV-2 envelope and does NOT call
   131	   * next. On success it stashes the resolved subject on the request for the allowance gate + handler.
   132	   */
   133	  const admit = async (req: AssistantRequest, res: Response, next: NextFunction): Promise<void> => {
   134	    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
   135	    if (resolution.status === 'invalid-id') {
   136	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
   137	      return;
   138	    }
   139	    if (resolution.status === 'not-found') {
   140	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
   141	      return;
   142	    }
   143	    const app = resolution.app;
   144	
   145	    // Owner-activation gate (Amendment 2 second admission plane; fail-closed CONV-2).
   146	    const activation = getActivation(app.ownerUserId);
   147	    if (!activation || activation.active === false) {
   148	      sendError(res, 'ACCOUNT_DISABLED', 'A conta associada a esta aplicação está bloqueada. Contacte o suporte.');
   149	      return;
   150	    }
   151	    if (activation.billingLocked) {
   152	      sendError(res, 'BILLING_LOCKED', 'A conta associada a esta aplicação tem um problema de faturação.');
   153	      return;
   154	    }
   155	
   156	    // Owner org — resolved server-side from the owner user record, NEVER from the visitor's body.
   157	    const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
   158	    const orgId = owner?.orgId ?? '';
   159	
   160	    // The app's declared action manifest (persisted at activation on the artifact data bag).
   161	    // Validate it against the shared contract; absent/invalid → no operate surface (null).
   162	    const art = await artifacts.get(app.appId);
   163	    const rawManifest = (art?.data as { actionManifest?: unknown } | undefined)?.actionManifest;
   164	    const parsedManifest = rawManifest ? AppActionManifest.safeParse(rawManifest) : null;
   165	    const actionManifest = parsedManifest?.success ? parsedManifest.data : null;
   166	
   167	    req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
   168	    next();
   169	  };
   170	
   171	  /** Async admission errors surface as a CONV-2 500 rather than Express's default HTML. */
   172	  const admitGuarded: RequestHandler = (req, res, next) => {
   173	    void admit(req, res, next).catch((err) => {
   174	      console.error('[app-assistant] admission failed:', err instanceof Error ? err.message : err);
   175	      sendError(res, 'INTERNAL', 'Erro interno.');
   176	    });
   177	  };
   178	
   179	  // Allowance gate billed to the resolved OWNER (mounted AFTER admission populates the subject).
   180	  const allowance = allowanceMiddleware((req) => (req as AssistantRequest).ekoaAssistant?.owner.userId);
   181	
   182	  r.post('/app-assistant', admitGuarded, allowance, async (req: AssistantRequest, res) => {
   183	    const admission = req.ekoaAssistant;
   184	    if (!admission) {
   185	      sendError(res, 'INTERNAL', 'Erro interno.'); // unreachable: admit ran first
   186	      return;
   187	    }
   188	
   189	    const parsed = AssistantChatRequest.safeParse(req.body ?? {});
   190	    if (!parsed.success) {
   191	      sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
   192	      return;
   193	    }
   194	    const body = parsed.data;
   195	
   196	    try {
   197	      const result = await runAppAssistant(
   198	        {
   199	          message: body.message,
   200	          history: body.history,
   201	          mode: body.mode,
   202	          context: body.context,
   203	          owner: admission.owner,
   204	          artifactId: admission.artifactId,
   205	          actionManifest: admission.actionManifest,
   206	        },
   207	        deps,
   208	      );
   209	      const response: AssistantChatResponse = {
   210	        reply: result.reply,
   211	        mode: result.mode,
   212	        ...(result.citations.length > 0 ? { citations: result.citations } : {}),
   213	        ...(result.actions.length > 0 ? { actions: result.actions } : {}),
   214	      };
   215	      res.json(response);
   216	    } catch (err) {
   217	      console.error('[app-assistant] run failed:', err instanceof Error ? err.message : err);
   218	      sendError(res, 'INTERNAL', 'O assistente está indisponível de momento.');
   219	    }
   220	  });
   221	
   222	  /**
   223	   * GET /app-assistant/whoami — admin DETECTION for the panel (operator-run H2; detect-then-ask).
   224	   *
   225	   * A DECLARED, DOCUMENTED exception to this plane's visitor-blindness: it is the ONE place the
   226	   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "is the
   227	   * current viewer an admin of this app's owner org?". It NEVER grounds, NEVER bills, NEVER widens
   228	   * admission, and issues NO model call (the zero-token GET) — the POST grounding/billing path
   229	   * above stays byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged
   230	   * action remains gated server-side by the H1 admission plane with this same JWT; `admin: true`
   231	   * here is only a HINT the panel may surface (edit mode is H3).
   232	   *
   233	   * FAIL-CLOSED + oracle-free: the ONLY non-200 responses are the SAME ones POST already gives for
   234	   * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
   235	   * oracle). A missing/invalid/expired/revoked/epoch-stale/wrong-org/user token is ALWAYS a 200
   236	   * `{ admin: false }` — never a 401 (which would leak token validity) or a 403 (which would leak
   237	   * app existence).
   238	   */
   239	  const whoami = async (req: Request, res: Response): Promise<void> => {
   240	    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
   241	    if (resolution.status === 'invalid-id') {
   242	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
   243	      return;
   244	    }
   245	    if (resolution.status === 'not-found') {
   246	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
   247	      return;
   248	    }
   249	
   250	    // Owner org — resolved server-side from the owner user record (same source admit() uses),
   251	    // NEVER from anything the caller supplied.
   252	    const owner = (await users.get(resolution.app.ownerUserId)) as { orgId?: string } | null;
   253	    const ownerOrgId = owner?.orgId ?? '';
   254	
   255	    const response: AppAssistantWhoamiResponse = {
   256	      admin: detectOwnerOrgAdmin(req.header('authorization'), ownerOrgId),
   257	    };
   258	    res.json(response); // always 200 — the boolean IS the answer
   259	  };
   260	
   261	  /** A whoami failure (e.g. a store read blowing up) is a 500, never a 4xx: a 4xx here would be an
   262	   *  oracle. Fail-closed to an internal error, distinct from the detection's own false. */
   263	  r.get('/app-assistant/whoami', (req, res) => {
   264	    void whoami(req, res).catch((err) => {
   265	      console.error('[app-assistant] whoami failed:', err instanceof Error ? err.message : err);
   266	      sendError(res, 'INTERNAL', 'Erro interno.');
   267	    });
   268	  });
   269	
   270	  return r;
   271	}
     1	/**
     2	 * Served-app assistant — pure logic (operator-run D1).
     3	 *
     4	 * The brain behind `POST /api/app-assistant`: given a visitor's message, the resolved artifact
     5	 * OWNER, and the app's declared action manifest, it produces the assistant's reply, the knowledge
     6	 * citations it drew on, the app-actions it wants the in-page runtime (C3) to execute, and the mode
     7	 * it operated in. It is HTTP-free and model-transport-free: the chokepoint one-shot, the knowledge
     8	 * grounding builder, and the routing decision are all INJECTED (`AppAssistantDeps`), so it unit-
     9	 * tests with a canned model and no live egress. The route (app-assistant-route.ts) binds the real
    10	 * deps — `runOneShot` / `buildGroundingBlock` / `decideForTask` — behind the llm/ + knowledge/
    11	 * public entries, so the assistant's only model egress stays the llm/ chokepoint (FIXED-3).
    12	 *
    13	 * Load-bearing invariants:
    14	 *  - The org is ALWAYS the resolved owner's org (`input.owner.orgId`) — never anything the
    15	 *    anonymous visitor supplied. Grounding is org-partitioned by that org; the caller cannot steer
    16	 *    it (the served-app "orgId from the resolved subject, not from arguments" rule).
    17	 *  - Billing is `assistant-chat` (a UserWorkAgentType) billed to the artifact OWNER + artifactId —
    18	 *    never the anonymous visitor.
    19	 *  - The assistant PROPOSES actions; it never executes them. Requested actions are validated
    20	 *    against the manifest's tool names and unknown ones are dropped, so the endpoint can only ever
    21	 *    ask the client to run an action the app actually declared.
    22	 *  - No permission / auth-decision logic here (the security block gates capability later; admission
    23	 *    = owner activation, enforced at the route).
    24	 */
    25	import type {
    26	  AppAction,
    27	  AppActionManifest,
    28	  AssistantChatMessage,
    29	  AssistantChatMode,
    30	  AssistantCitation,
    31	  AssistantAction,
    32	} from '@ekoa/shared';
    33	import { assistantToolsFromManifest, type AssistantToolDef } from './assistant-tools.js';
    34	import type { OneShotOptions, OneShotResult, LlmAttribution, RouterDecision } from '../llm/index.js';
    35	import type { GroundingInput, GroundingResult } from '../knowledge/index.js';
    36	
    37	export interface AppAssistantOwner {
    38	  /** The artifact owner — who the assistant runs as and who is billed. */
    39	  userId: string;
    40	  /** The owner's org — the ONLY org the assistant ever grounds under (server-resolved). */
    41	  orgId: string;
    42	}
    43	
    44	export interface AppAssistantInput {
    45	  message: string;
    46	  history?: AssistantChatMessage[];
    47	  /** Client-pinned mode; when absent it is inferred from the message and echoed back. */
    48	  mode?: AssistantChatMode;
    49	  /** The panel's current screen state (route + prior action results). Never carries an org. */
    50	  context?: { route?: string; actionResults?: unknown[] };
    51	  owner: AppAssistantOwner;
    52	  artifactId: string;
    53	  /** The app's validated UI action manifest, or null for an app with no operate surface. */
    54	  actionManifest: AppActionManifest | null;
    55	}
    56	
    57	export interface AppAssistantDeps {
    58	  /** The chokepoint one-shot (llm/ `runOneShot` in prod) — the assistant's ONLY model egress. */
    59	  oneShot: (opts: OneShotOptions, attribution: LlmAttribution) => Promise<OneShotResult>;
    60	  /** The org-partitioned knowledge grounding builder (`buildGroundingBlock` in prod). Pure. */
    61	  ground: (input: GroundingInput) => GroundingResult;
    62	  /** The routing decision for a message (`decideForTask` floored at WORKHORSE in prod). */
    63	  decide: (message: string) => RouterDecision;
    64	}
    65	
    66	export interface AppAssistantResult {
    67	  reply: string;
    68	  mode: AssistantChatMode;
    69	  citations: AssistantCitation[];
    70	  actions: AssistantAction[];
    71	}
    72	
    73	/** Fold to a lowercase, accent-stripped form for keyword matching (matches grounding.ts's fold so
    74	 *  PT-PT accents never hide a keyword). */
    75	function fold(s: string): string {
    76	  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    77	}
    78	
    79	/** Teach-mode cues (folded, accent-insensitive): the visitor wants to be taught / walked through. */
    80	const TEACH_KEYWORDS = [
    81	  // 'como ' is the PT-PT how-to signal (covers "como funciona", "como criar", "como usar", …); a
    82	  // trailing space keeps it from matching inside unrelated words.
    83	  'tutorial', 'ensina', 'ensinar', 'explica', 'explicar', 'como ',
    84	  'passo a passo', 'aprender', 'guia de', 'ensino',
    85	];
    86	/** Show-mode cues (folded): the visitor wants an overview / to be shown around. */
    87	const SHOW_KEYWORDS = [
    88	  'mostre', 'mostra', 'mostrar', 'visao geral', 'vista geral', 'panorama', 'apresenta',
    89	  'apresentar', 'resumo geral', 'o que faz esta', 'o que e que esta',
    90	];
    91	
    92	/**
    93	 * Deterministic PT-PT mode classifier (no model call). Teach cues win over show cues (a "mostra-me
    94	 * como criar" is a walkthrough, not an overview); everything else — including bare imperative task
    95	 * verbs ("cria", "adiciona", "envia") — defaults to 'do', the operate mode.
    96	 */
    97	export function inferMode(message: string): AssistantChatMode {
    98	  const f = fold(message);
    99	  if (TEACH_KEYWORDS.some((k) => f.includes(k))) return 'teach';
   100	  if (SHOW_KEYWORDS.some((k) => f.includes(k))) return 'show';
   101	  return 'do';
   102	}
   103	
   104	const MODE_INSTRUCTION: Record<AssistantChatMode, string> = {
   105	  do: 'O utilizador quer executar uma tarefa. Quando fizer sentido, pede à aplicação para executar as ações necessárias (ver o protocolo de ações abaixo) e confirma em prosa o que foi feito.',
   106	  show: 'O utilizador quer uma visão geral. Descreve o que a aplicação faz e o que está visível no ecrã atual, sem executar ações destrutivas.',
   107	  teach: 'O utilizador quer aprender. Explica passo a passo, como um tutorial, sem executar ações em nome do utilizador a menos que ele peça explicitamente.',
   108	};
   109	
   110	/** One readable line per available action for the system prompt (name, description, destructive
   111	 *  marker, and its parameters with PT-PT labels). */
   112	function describeTool(tool: AssistantToolDef): string {
   113	  const params = tool.action.params
   114	    .map((p) => `${p.name}${p.required ? ' (obrigatório)' : ''}${p.labelPt ? ` — ${p.labelPt}` : ''}`)
   115	    .join(', ');
   116	  const parts = [`- ${tool.name}: ${tool.description}`];
   117	  if (tool.destructive) parts.push('[AÇÃO DESTRUTIVA — a aplicação pede confirmação antes de executar]');
   118	  if (params) parts.push(`Parâmetros: ${params}.`);
   119	  return parts.join(' ');
   120	}
   121	
   122	/** Build the assistant system prompt: the three capabilities, the active mode, PT-PT + cite-your-
   123	 *  source discipline, the callable app-actions, the structured-actions protocol, and the current
   124	 *  screen context. The grounding block (already formatted) rides at the end. */
   125	function buildSystemPrompt(
   126	  mode: AssistantChatMode,
   127	  tools: AssistantToolDef[],
   128	  groundingBlock: string,
   129	  context: AppAssistantInput['context'],
   130	): string {
   131	  const sections: string[] = [];
   132	
   133	  sections.push(
   134	    'És o assistente desta aplicação, ao serviço do utilizador que a está a usar. Tens três capacidades:\n' +
   135	      '1. OPERAR a aplicação pelo utilizador — executar tarefas através das ações disponíveis (modo "do").\n' +
   136	      '2. APRESENTAR — dar uma visão geral do que a aplicação faz e do ecrã atual (modo "show").\n' +
   137	      '3. ENSINAR — explicar passo a passo como usar a aplicação, como um tutorial (modo "teach").',
   138	  );
   139	
   140	  sections.push(`Estás no modo "${mode}". ${MODE_INSTRUCTION[mode]}`);
   141	
   142	  sections.push(
   143	    'Responde SEMPRE em português de Portugal (PT-PT), de forma clara e objetiva, em registo ' +
   144	      'formal (trata o utilizador por você; nunca uses tuteio como "queres" ou "podes").',
   145	  );
   146	
   147	  sections.push(
   148	    'CONHECIMENTO: usa apenas os excertos fornecidos no bloco CONHECIMENTO abaixo (quando existir) e ' +
   149	      'cita a fonte que usaste. Nunca inventes factos nem fontes. Se não houver conhecimento relevante, ' +
   150	      'responde apenas com o que sabes sobre a própria aplicação, sem citar.',
   151	  );
   152	
   153	  if (tools.length > 0) {
   154	    sections.push(
   155	      'AÇÕES DA APLICAÇÃO — podes pedir à aplicação para executar estas ações em nome do utilizador:\n' +
   156	        tools.map(describeTool).join('\n') +
   157	        '\n\nPara pedir a execução de uma ou mais ações, inclui na tua resposta UM bloco delimitado ' +
   158	        'exatamente assim:\n```ekoa-actions\n[{"toolName":"<nome-da-ação>","input":{ ... }}]\n```\n' +
   159	        'O bloco tem de ser um array JSON válido e usar APENAS os nomes de ações listados acima. A ' +
   160	        'aplicação é que executa as ações — tu nunca as executas diretamente. Escreve sempre também ' +
   161	        'uma resposta em prosa para o utilizador (o bloco é removido antes de lhe ser mostrado).',
   162	    );
   163	  } else {
   164	    sections.push(
   165	      'Esta aplicação não declara ações operáveis: podes apresentar e ensinar, mas não podes operar a ' +
   166	        'aplicação pelo utilizador.',
   167	    );
   168	  }
   169	
   170	  if (context?.route) {
   171	    sections.push(`O utilizador está atualmente na rota "${context.route}" da aplicação.`);
   172	  }
   173	  if (context?.actionResults && context.actionResults.length > 0) {
   174	    sections.push('Existem resultados de ações anteriores no contexto desta sessão.');
   175	  }
   176	
   177	  if (groundingBlock.trim()) sections.push(groundingBlock.trim());
   178	
   179	  return sections.join('\n\n');
   180	}
   181	
   182	/** Render the conversation history + current message into the single one-shot prompt string. */
   183	function renderPrompt(history: AssistantChatMessage[] | undefined, message: string): string {
   184	  if (!history || history.length === 0) return message;
   185	  const transcript = history
   186	    .map((t) => `<turn role="${t.role}">\n${t.content}\n</turn>`)
   187	    .join('\n');
   188	  return `<conversation>\n${transcript}\n</conversation>\n\n${message}`;
   189	}
   190	
   191	/** A fresh matcher each call (the /g flag is stateful — never share the literal across calls). */
   192	function actionsFence(): RegExp {
   193	  return /```ekoa-actions[^\n]*\n([\s\S]*?)```/g;
   194	}
   195	
   196	/**
   197	 * Pull every `ekoa-actions` fenced block out of the model reply: parse each as a JSON array of
   198	 * `{ toolName, input }`, keep only actions whose toolName is a REAL manifest tool (unknown names
   199	 * dropped — the endpoint can only ask the client to run a declared action), attach the SERVER's
   200	 * copy of that action's manifest AppAction (so the C3 runtime can execute without the manifest,
   201	 * which is not injected into the served page), and strip the blocks from the user-facing prose. A
   202	 * malformed block is skipped (still stripped) — never surfaced raw.
   203	 */
   204	export function extractActions(
   205	  reply: string,
   206	  toolsByName: ReadonlyMap<string, AppAction>,
   207	): { text: string; actions: AssistantAction[] } {
   208	  const actions: AssistantAction[] = [];
   209	  const scan = actionsFence();
   210	  let m: RegExpExecArray | null;
   211	  while ((m = scan.exec(reply)) !== null) {
   212	    let parsed: unknown;
   213	    try {
   214	      parsed = JSON.parse((m[1] ?? '').trim());
   215	    } catch {
   216	      continue; // malformed block — drop it (it is stripped from the prose below regardless)
   217	    }
   218	    if (!Array.isArray(parsed)) continue;
   219	    for (const item of parsed) {
   220	      if (!item || typeof item !== 'object') continue;
   221	      const toolName = (item as { toolName?: unknown }).toolName;
   222	      if (typeof toolName !== 'string') continue;
   223	      const action = toolsByName.get(toolName);
   224	      if (!action) continue; // unknown tool -> drop (the app never declared it)
   225	      const rawInput = (item as { input?: unknown }).input;
   226	      const input =
   227	        rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
   228	          ? (rawInput as Record<string, unknown>)
   229	          : {};
   230	      // The fenced path honours the SAME param contract the SDK tool schema enforces
   231	      // (`additionalProperties: false` in assistant-tools): keep ONLY the params the
   232	      // manifest declares for this action. Undeclared keys from the model are dropped,
   233	      // never forwarded to the runtime — for `custom` actions they would otherwise
   234	      // reach app code verbatim.
   235	      const declared = new Set(action.params.map((p) => p.name));
   236	      const filtered: Record<string, unknown> = {};
   237	      for (const [key, value] of Object.entries(input)) {
   238	        if (declared.has(key)) filtered[key] = value;
   239	      }
   240	      // Attach the server-authoritative manifest action; the client dispatches
   241	      // `execute({ ...action, params: input })` (values override the param definitions).
   242	      actions.push({ toolName, input: filtered, action });
   243	    }
   244	  }
   245	  const text = reply.replace(actionsFence(), '').trim();
   246	  return { text, actions };
   247	}
   248	
   249	/**
   250	 * Run the served-app assistant for one turn. Grounds under the OWNER's org, calls the model once
   251	 * through the injected chokepoint one-shot billed to the owner, and returns the prose reply (with
   252	 * any actions block stripped), the inferred/pinned mode, the knowledge citations, and the validated
   253	 * app-actions the client runtime should execute.
   254	 */
   255	export async function runAppAssistant(
   256	  input: AppAssistantInput,
   257	  deps: AppAssistantDeps,
   258	): Promise<AppAssistantResult> {
   259	  const mode: AssistantChatMode = input.mode ?? inferMode(input.message);
   260	  const tools = assistantToolsFromManifest(input.actionManifest);
     1	/*
     2	 * Operator Assistant Panel - platform-shipped for the `app` base (operator-run D2;
     3	 * lazy-loaded as a platform runtime asset since operator-run G2).
     4	 *
     5	 * The in-app assistant every generated app carries. It is compiled into the
     6	 * platform panel-runtime asset (api/assets/panel-runtime) and mounts INTO the
     7	 * shell's <div id="ekoa-assistant-root"> (see index.jsx, the asset entry) and
     8	 * speaks ONLY two things:
     9	 *
    10	 *   1. POST /api/app-assistant (D1) - the served-app assistant endpoint. It carries
    11	 *      the visitor's message, the running history, the pinned/echoed mode, the
    12	 *      current screen context, and the X-Ekoa-App-Id header. The reply, its
    13	 *      knowledge citations ("Fontes"), and the app-actions the assistant proposes
    14	 *      come back on the response.
    15	 *   2. window.__ekoaActions.execute(action) (C3 same-document runtime) - for EACH
    16	 *      action the assistant proposes. The runtime owns the VISIBLE driving badge,
    17	 *      the target highlight, the destructive confirmation card, and the
    18	 *      pause-on-real-user-input; the panel only calls execute() and shows a subtle
    19	 *      "a executar..." state until it resolves. The panel NEVER dispatches an
    20	 *      action the assistant did not return.
    21	 *
    22	 * Three capabilities / three modes: OPERAR (do) operates the app, MOSTRAR (show)
    23	 * gives an overview, ENSINAR (teach) walks through a tutorial. The server infers
    24	 * the mode from the phrasing; the toggle lets the visitor pin it, and the server's
    25	 * echoed response.mode is reflected back.
    26	 *
    27	 * The panel is PLATFORM code: brand-neutral via the CSS-var contract, PT-PT
    28	 * throughout (lawyer-facing), no emoji, and non-blocking - it never steals focus
    29	 * from the app and every failure renders a calm message instead of crashing.
    30	 */
    31	import { useCallback, useEffect, useRef, useState } from 'react';
    32	import { createTourPlayer } from './tour-player';
    33	import './AssistantPanel.css';
    34	
    35	const ENDPOINT = '/api/app-assistant';
    36	// H2 admin DETECTION (detect-then-ask). A cheap, non-LLM GET that answers ONLY "is the current
    37	// viewer an admin of this app's owner org?". It NEVER issues an assistant turn (the zero-token
    38	// invariant holds) and its result NEVER auto-enables anything - it only lights a discreet
    39	// indicator. The edit-mode switch + its opt-in UX are H3; this panel does not build them.
    40	const WHOAMI_ENDPOINT = '/api/app-assistant/whoami';
    41	// The platform session token key web/lib/api/token.ts uses. Read best-effort for detection only:
    42	// a served app on the SAME origin as the dashboard can read it; a CROSS-origin / sandboxed iframe
    43	// (the dev preview) throws on access, so detection simply falls back to "not admin".
    44	const TOKEN_STORAGE_KEY = 'ekoa_token';
    45	// Bounds (codex-d2): the transcript kept in memory, the history slice sent per turn,
    46	// and a hard timeout on the assistant fetch so a hung turn can never lock the composer.
    47	const MAX_MESSAGES = 200;
    48	const MAX_HISTORY_TURNS = 16;
    49	const FETCH_TIMEOUT_MS = 120000;
    50	
    51	/** The three modes, in toggle order, with their PT-PT labels. */
    52	const MODES = [
    53	  { id: 'do', label: 'Operar' },
    54	  { id: 'show', label: 'Mostrar' },
    55	  { id: 'teach', label: 'Ensinar' },
    56	];
    57	
    58	/** The first-open capability prompts (PT-PT), one per capability. Clicking one
    59	 *  pins its mode and drops the example into the composer. */
    60	const EXAMPLES = [
    61	  { mode: 'do', kind: 'Operar', prompt: 'Adicione um novo registo' },
    62	  { mode: 'show', kind: 'Mostrar', prompt: 'Dê-me uma visão geral da aplicação' },
    63	  { mode: 'teach', kind: 'Ensinar', prompt: 'Mostre-me um tutorial' },
    64	];
    65	
    66	const ERROR_REPLY = 'O assistente está indisponível de momento.';
    67	const MAX_ACTION_RESULTS = 8;
    68	
    69	/** The served-app id stamped by injectAppContext(); absent in a standalone preview. */
    70	function appId() {
    71	  return typeof window !== 'undefined' && window.__EKOA_APP_ID ? window.__EKOA_APP_ID : undefined;
    72	}
    73	
    74	/** Best-effort read of the platform session token for admin DETECTION only (H2). Same-origin
    75	 *  served pages can read the dashboard's localStorage; a cross-origin or sandboxed iframe throws
    76	 *  a SecurityError on `localStorage` access - swallow it to null so detection just degrades to
    77	 *  "not admin" (no affordance) instead of crashing the panel. Reads nothing else and stores
    78	 *  nothing - the token is attached to the one whoami GET and never kept. */
    79	function readPlatformToken() {
    80	  try {
    81	    if (typeof window === 'undefined' || !window.localStorage) return null;
    82	    const t = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    83	    return typeof t === 'string' && t ? t : null;
    84	  } catch {
    85	    return null;
    86	  }
    87	}
    88	
    89	/** The app's current route/page, best-effort: the shell may expose it on
    90	 *  window.__ekoaApp; otherwise fall back to the location. Undefined when unknown. */
    91	function currentRoute() {
    92	  if (typeof window === 'undefined') return undefined;
    93	  const app = window.__ekoaApp;
    94	  if (app && typeof app.route === 'string' && app.route) return app.route;
    95	  if (app && typeof app.currentRoute === 'string' && app.currentRoute) return app.currentRoute;
    96	  const loc = window.location;
    97	  const r = (loc && (loc.hash || loc.pathname)) || '';
    98	  return r ? String(r) : undefined;
    99	}
   100	
   101	/**
   102	 * Map a proposed action to the manifest form window.__ekoaActions.execute expects
   103	 * (kind/target/route/destructive/labelPt + a VALUES object on params). D1 sends
   104	 * `{ toolName, input }`; when the response is enriched with the resolved manifest
   105	 * `action` we drive it directly, otherwise we forward what we have (the runtime
   106	 * reports a clean failure for an action it cannot resolve - never a crash).
   107	 */
   108	function toRuntimeAction(a) {
   109	  const values = (a && (a.input || a.params)) || {};
   110	  if (a && a.action && typeof a.action === 'object') {
   111	    return { ...a.action, params: values };
   112	  }
   113	  const id =
   114	    a && typeof a.toolName === 'string'
   115	      ? a.toolName.replace(/^app_action__/, '').replace(/_/g, '-')
   116	      : undefined;
   117	  return { id, toolName: a && a.toolName, params: values };
   118	}
   119	
   120	/** A short PT-PT status line for one action run. */
   121	function runLabel(status) {
   122	  switch (status) {
   123	    case 'running':
   124	      return 'A executar...';
   125	    case 'done':
   126	      return 'Ação executada.';
   127	    case 'cancelled':
   128	      return 'Ação cancelada.';
   129	    case 'unavailable':
   130	      return 'Ação indisponível nesta pré-visualização.';
   131	    default:
   132	      return 'Não foi possível executar a ação.';
   133	  }
   134	}
   135	
   136	function SendIcon() {
   137	  return (
   138	    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
   139	      <path d="M22 2 11 13" />
   140	      <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
   141	    </svg>
   142	  );
   143	}
   144	
   145	function CloseIcon() {
   146	  return (
   147	    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
   148	      <path d="M18 6 6 18" />
   149	      <path d="m6 6 12 12" />
   150	    </svg>
   151	  );
   152	}
   153	
   154	function ChatIcon() {
   155	  return (
   156	    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
   157	      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />
   158	    </svg>
   159	  );
   160	}
   161	
   162	/** PT-PT status line for a non-stepping tour phase (playing/awaiting show the copy). */
   163	function tourStatusText(status) {
   164	  switch (status) {
   165	    case 'loading':
   166	      return 'A carregar o tutorial...';
   167	    case 'awaiting':
   168	      return 'Aguardando a sua ação na aplicação...';
   169	    case 'done':
   170	      return 'Tutorial concluído.';
   171	    case 'error':
   172	      return 'Não foi possível carregar o tutorial guiado.';
   173	    default:
   174	      return '';
   175	  }
   176	}
   177	
   178	/**
   179	 * The tour block rendered in the panel while a same-document tour plays. The
   180	 * on-page highlight/tooltip is drawn by the C3 runtime (window.__ekoaActions
   181	 * spotlight); this block carries the step counter, the narration, and the
   182	 * Seguinte / Sair controls. It exposes data-tour-status + data-tour-step-index for
   183	 * the deterministic live gate. No emoji; brand-neutral via the panel CSS vars.
   184	 */
   185	function TourView({ tour, onNext, onClose }) {
   186	  const { status, stepIndex, total, copy, imageUrl, imageBlocked, injectedPrompt } = tour;
   187	  const stepping = status === 'playing' || status === 'awaiting';
   188	  const stepNo = total > 0 ? Math.min(stepIndex + 1, total) : 0;
   189	  const statusLine = tourStatusText(status);
   190	  return (
   191	    <section
   192	      className="ekoa-assistant-tour"
   193	      data-tour-status={status}
   194	      data-tour-step-index={stepIndex}
   195	      aria-label="Tutorial guiado"
   196	    >
   197	      <div className="ekoa-assistant-tour-head">
   198	        <span className="ekoa-assistant-tour-title">Tutorial guiado</span>
   199	        {stepping && total > 0 ? (
   200	          <span className="ekoa-assistant-tour-progress">{`Passo ${stepNo} de ${total}`}</span>
   201	        ) : null}
   202	      </div>
   203	
   204	      {copy ? (
   205	        <div className="ekoa-assistant-tour-copy">
   206	          {copy.titlePt ? <div className="ekoa-assistant-tour-copy-title">{copy.titlePt}</div> : null}
   207	          {copy.bodyPt ? <div className="ekoa-assistant-tour-copy-body">{copy.bodyPt}</div> : null}
   208	        </div>
   209	      ) : null}
   210	
   211	      {injectedPrompt ? (
   212	        <div className="ekoa-assistant-tour-note">
   213	          Sugestão colocada na caixa de mensagem, para rever antes de enviar.
   214	        </div>
   215	      ) : null}
   216	
   217	      {imageUrl ? <img className="ekoa-assistant-tour-image" src={imageUrl} alt="" /> : null}
   218	
   219	      {imageBlocked ? (
   220	        <div className="ekoa-assistant-tour-note">Imagem ignorada (caminho não permitido).</div>
   221	      ) : null}
   222	
   223	      {statusLine ? <div className="ekoa-assistant-tour-status">{statusLine}</div> : null}
   224	
   225	      <div className="ekoa-assistant-tour-controls">
   226	        {stepping ? (
   227	          <button type="button" className="ekoa-assistant-tour-next" onClick={onNext}>
   228	            Seguinte
   229	          </button>
   230	        ) : null}
   231	        <button type="button" className="ekoa-assistant-tour-close" onClick={onClose}>
   232	          {status === 'done' || status === 'error' ? 'Fechar' : 'Sair'}
   233	        </button>
   234	      </div>
   235	    </section>
   236	  );
   237	}
   238	
   239	export function AssistantPanel({ defaultOpen = false } = {}) {
   240	  // Collapsed on mount UNLESS the launcher handed off an explicit open intent. Since
   241	  // G2 the panel is lazy-loaded: the app-bundle launcher (scaffold mount.js) injects
   242	  // this asset and passes `defaultOpen` true when the VISITOR clicked it (open now),
   243	  // false when the asset was idle-preloaded (mount collapsed, show only the launcher).
   244	  const [collapsed, setCollapsed] = useState(!defaultOpen);
   245	  // `mode` is the mode CURRENTLY shown on the toggle - the server's inference (echoed
   246	  // on each response) unless the visitor pins one. `pinnedMode` is non-null only when
   247	  // the visitor explicitly picked a mode: only then do we send it, so by default the
   248	  // server infers the mode from the phrasing (do/show/teach) and we reflect it back.
   249	  const [mode, setMode] = useState('do');
   250	  const [pinnedMode, setPinnedMode] = useState(null);
   251	  const [messages, setMessages] = useState([]); // { id, role, content, citations?, runs? }
   252	  const [draft, setDraft] = useState('');
   253	  const [busy, setBusy] = useState(false);
   254	  // E2 same-document tour playback state (null when no tour is active). The player
   255	  // is 100% client-side and issues ZERO model calls: it fetches the pre-generated
   256	  // tour from GET /api/demos/:appId and drives it in the page.
   257	  const [tour, setTour] = useState(null);
   258	  // H2 detect-then-ask: whether the current viewer is an admin of this app's owner org.
   259	  // Default false (fail-closed). Set ONCE by the mount detection below. This flag NEVER
   260	  // auto-enables anything - it only lights the discreet indicator in the header (the actual

exec
/bin/zsh -lc 'codegraph explore "app-assistant-route whoami resolveAssistantApp requireAuth verifyToken isRevoked tokenEpoch canEditApps"' in /Users/ggomes/dev/ekoa-code
 succeeded in 564ms:
## Exploration: app-assistant-route whoami resolveAssistantApp requireAuth verifyToken isRevoked tokenEpoch canEditApps

Found 210 symbols across 110 files.

### Blast radius — what depends on these (update/verify before editing)

- `isRevoked` (api/src/auth/revocation.ts:25) — 4 callers in `api/src/auth/middleware.ts`; tests: `api/tests/bridge/registry.test.ts`
- `resolveAssistantApp` (api/src/apps/app-assistant-route.ts:59) — 1 caller in `api/src/apps/app-assistant-route.ts`; ⚠️ no covering tests found
- `verifyToken` (api/src/auth/jwt.ts:51) — 1 caller in `api/src/server.ts`; ⚠️ no covering tests found
- `AssistantToolDef` (api/src/apps/assistant-tools.ts:21) — 5 callers in `api/src/apps/app-assistant.ts`, `api/src/apps/assistant-tools.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- requireAuth → isRevoked
- verifySseToken → isRevoked
- resolveAssistantApp → resolveApp
- appAssistantRouter → resolveAssistantApp
- resolveApp → getApp
- verifyToken → loadConfig
- assistantToolsFromManifest → map
- assistantToolsFromManifest → toolNameForAction
- assistantToolsFromManifest → inputSchemaFor
- runAppAssistant → assistantToolsFromManifest
- ... and 244 more

**references:**
- resolveAssistantApp → AssistantAppResolution
- verifyToken → JwtClaims
- AssistantRequest → AssistantAdmission
- AssistantAdmission → AppActionManifest
- UiActionsResult → AppActionManifest
- assistantToolsFromManifest → AppActionManifest
- manifest → AppActionManifest
- AppAssistantInput → AppActionManifest
- manifest → AppActionManifest
- AssistantToolDef → AppAction
- ... and 86 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/apps/app-assistant-route.ts — sendError(calls), resolveAssistantApp(calls), sendError(function), ErrorCode(references), calls(calls), AssistantAppResolution(type_alias), ResolvedApp(references), resolveAssistantApp(function), AssistantAppResolution(references), resolveApp(calls), +23 more

```typescript
40	const SHARED_SCOPE_PREFIX = 'usr.';
41	
42	/** CONV-2 error envelope off the shared status table (routes/ is off-limits to apps/, ch02 §2.7). */
43	function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
44	  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
45	}
46	
47	/**
48	 * Resolve the `X-Ekoa-App-Id` header to an artifact-backed owner — the SHARED front half of every
49	 * app-assistant plane entry (POST admission AND the H2 whoami detection), so both apply the exact
50	 * same charset/collision checks and expose the exact same existence surface (no plane is a
51	 * different oracle than the other). A discriminated result the callers turn into the CONV-2
52	 * envelope: `invalid-id` → 400 VALIDATION_FAILED, `not-found` → 404 NOT_FOUND, `ok` → the app.
53	 */
54	type AssistantAppResolution =
55	  | { status: 'invalid-id' }
56	  | { status: 'not-found' }
57	  | { status: 'ok'; app: ResolvedApp };
58	
59	async function resolveAssistantApp(header: unknown): Promise<AssistantAppResolution> {
60	  // Same header contract admit() has always applied: a string, a valid collection-name charset,
61	  // and NOT the reserved `usr.` shared-namespace prefix.
62	  if (
63	    typeof header !== 'string' ||
64	    !collectionName.safeParse(header).success ||
65	    header.startsWith(SHARED_SCOPE_PREFIX)
66	  ) {
67	    return { status: 'invalid-id' };
68	  }
69	  const app = await resolveApp(header);
70	  // The assistant plane needs a real artifact-backed owner (org to scope by, user to attribute).
71	  // A dev-serve / registry-only or unresolved id has none — the same 404 admit() gives.
72	  if (!app || !app.artifactBacked || !app.ownerUserId) return { status: 'not-found' };
73	  return { status: 'ok', app };
74	}
75	
76	/**
77	 * Is this verified caller an admin of the app OWNER's org WITH the app-edit capability? PURE role
78	 * decision (the token is already verified by the caller). Gated by H1's `can()` so the role→
79	 * capability grid is the single source of truth — a `user` fails the capability gate, so only
80	 * `org-admin`/`super-admin` reach the org check. A super-admin spans every org; an org-admin must
81	 * belong to the owner's exact org. Fail-closed for any other shape. Exported for the unit matrix.
82	 */
83	export function isOwnerOrgAdmin(claims: Pick<JwtClaims, 'role' | 'orgId'>, ownerOrgId: string): boolean {
84	  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
85	  if (claims.role === 'super-admin') return true; // super-admin edits apps in any org
86	  if (claims.role === 'org-admin') return claims.orgId === ownerOrgId; // org-admin scoped to owner org
87	  return false; // unreachable given the capability gate, but fail-closed by construction
88	}
89	
90	/**
91	 * Detect whether the OPTIONAL platform Bearer on this request belongs to an admin of `ownerOrgId`.
92	 * FAIL-CLOSED and oracle-free: any deviation — no token, a non-Bearer header, or a token that does
93	 * not clear the standard verification chain — returns false, never throws, never distinguishes a
94	 * bad token from a wrong-org one. The verification is the EXACT chain requireAuth/verifySseToken
95	 * run (verifyToken + jti + isRevoked + activation-active + tokenEpoch); this endpoint does NOT
96	 * hand-roll a weaker check and adds NO second identity path.
97	 */
98	function detectOwnerOrgAdmin(authHeader: string | undefined, ownerOrgId: string): boolean {
99	  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
100	  if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
101	  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
102	  if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
103	  return isOwnerOrgAdmin(verified.claims, ownerOrgId);
104	}
105	
106	/** What the admission middleware resolves and stashes for the handler + allowance gate. */
107	interface AssistantAdmission {
108	  owner: { userId: string; orgId: string };
109	  artifactId: string;
110	  actionManifest: AppActionManifest | null;
111	}
112	interface AssistantRequest extends Request {
113	  ekoaAssistant?: AssistantAdmission;
114	}
115	
116	/** The production deps: the assistant's only model egress is the llm/ chokepoint one-shot; grounding
117	 *  rides the knowledge/ builder; the tier is floored at WORKHORSE like chat (D1 owner-org grounding
118	 *  is passed in by the admission middleware, not here). */
119	const prodDeps: AppAssistantDeps = {
120	  oneShot: runOneShot,
121	  ground: buildGroundingBlock,
122	  decide: (message) => decideForTask(message, undefined, 'WORKHORSE'),
123	};
124	
125	export function appAssistantRouter(deps: AppAssistantDeps = prodDeps): Router {
126	  const r = Router();
127	
128	  /**
129	   * Served-app admission (mirrors served-data's headerFor + admitOwner, then resolves the owner org
130	   * and the app's action manifest). On any refusal it writes the CONV-2 envelope and does NOT call
131	   * next. On success it stashes the resolved subject on the request for the allowance gate + handler.
132	   */
133	  const admit = async (req: AssistantRequest, res: Response, next: NextFunction): Promise<void> => {
134	    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
135	    if (resolution.status === 'invalid-id') {
136	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
137	      return;
138	    }
139	    if (resolution.status === 'not-found') {
140	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
141	      return;
142	    }
143	    const app = resolution.app;
144	
145	    // Owner-activation gate (Amendment 2 second admission plane; fail-closed CONV-2).
146	    const activation = getActivation(app.ownerUserId);
147	    if (!activation || activation.active === false) {
148	      sendError(res, 'ACCOUNT_DISABLED', 'A conta associada a esta aplicação está bloqueada. Contacte o suporte.');
149	      return;
150	    }
151	    if (activation.billingLocked) {
152	      sendError(res, 'BILLING_LOCKED', 'A conta associada a esta aplicação tem um problema de faturação.');
153	      return;
154	    }
155	
156	    // Owner org — resolved server-side from the owner user record, NEVER from the visitor's body.
157	    const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
158	    const orgId = owner?.orgId ?? '';
159	
160	    // The app's declared action manifest (persisted at activation on the artifact data bag).
161	    // Validate it against the shared contract; absent/invalid → no operate surface (null).
162	    const art = await artifacts.get(app.appId);
163	    const rawManifest = (art?.data as { actionManifest?: unknown } | undefined)?.actionManifest;
164	    const parsedManifest = rawManifest ? AppActionManifest.safeParse(rawManifest) : null;
165	    const actionManifest = parsedManifest?.success ? parsedManifest.data : null;
166	
167	    req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
168	    next();
169	  };
170	
171	  /** Async admission errors surface as a CONV-2 500 rather than Express's default HTML. */
172	  const admitGuarded: RequestHandler = (req, res, next) => {
173	    void admit(req, res, next).catch((err) => {
174	      console.error('[app-assistant] admission failed:', err instanceof Error ? err.message : err);
175	      sendError(res, 'INTERNAL', 'Erro interno.');
176	    });
177	  };
178	
179	  // Allowance gate billed to the resolved OWNER (mounted AFTER admission populates the subject).
180	  const allowance = allowanceMiddleware((req) => (req as AssistantRequest).ekoaAssistant?.owner.userId);
181	
182	  r.post('/app-assistant', admitGuarded, allowance, async (req: AssistantRequest, res) => {
183	    const admission = req.ekoaAssistant;
184	    if (!admission) {
185	      sendError(res, 'INTERNAL', 'Erro interno.'); // unreachable: admit ran first
186	      return;
187	    }
188	
189	    const parsed = AssistantChatRequest.safeParse(req.body ?? {});
190	    if (!parsed.success) {
191	      sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
192	      return;
193	    }
194	    const body = parsed.data;
195	
196	    try {
197	      const result = await runAppAssistant(
198	        {
199	          message: body.message,
200	          history: body.history,
201	          mode: body.mode,
202	          context: body.context,
203	          owner: admission.owner,
204	          artifactId: admission.artifactId,
205	          actionManifest: admission.actionManifest,
206	        },
207	        deps,
208	      );
209	      const response: AssistantChatResponse = {
210	        reply: result.reply,
211	        mode: result.mode,
212	        ...(result.citations.length > 0 ? { citations: result.citations } : {}),
213	        ...(result.actions.length > 0 ? { actions: result.actions } : {}),
214	      };
215	      res.json(response);
216	    } catch (err) {
217	      console.error('[app-assistant] run failed:', err instanceof Error ? err.message : err);
218	      sendError(res, 'INTERNAL', 'O assistente está indisponível de momento.');
219	    }
220	  });
221	
222	  /**
223	   * GET /app-assistant/whoami — admin DETECTION for the panel (operator-run H2; detect-then-ask).
224	   *
225	   * A DECLARED, DOCUMENTED exception to this plane's visitor-blindness: it is the ONE place the
226	   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "is the
227	   * current viewer an admin of this app's owner org?". It NEVER grounds, NEVER bills, NEVER widens
228	   * admission, and issues NO model call (the zero-token GET) — the POST grounding/billing path
229	   * above stays byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged
230	   * action remains gated server-side by the H1 admission plane with this same JWT; `admin: true`
231	   * here is only a HINT the panel may surface (edit mode is H3).
232	   *
233	   * FAIL-CLOSED + oracle-free: the ONLY non-200 responses are the SAME ones POST already gives for
234	   * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
235	   * oracle). A missing/invalid/expired/revoked/epoch-stale/wrong-org/user token is ALWAYS a 200
236	   * `{ admin: false }` — never a 401 (which would leak token validity) or a 403 (which would leak
237	   * app existence).
238	   */
239	  const whoami = async (req: Request, res: Response): Promise<void> => {
240	    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
241	    if (resolution.status === 'invalid-id') {
242	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
243	      return;
244	    }
245	    if (resolution.status === 'not-found') {
246	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
247	      return;
248	    }
249	
250	    // Owner org — resolved server-side from the owner user record (same source admit() uses),
251	    // NEVER from anything the caller supplied.
252	    const owner = (await users.get(resolution.app.ownerUserId)) as { orgId?: string } | null;
253	    const ownerOrgId = owner?.orgId ?? '';
254	
255	    const response: AppAssistantWhoamiResponse = {
256	      admin: detectOwnerOrgAdmin(req.header('authorization'), ownerOrgId),
257	    };
258	    res.json(response); // always 200 — the boolean IS the answer
259	  };
260	
261	  /** A whoami failure (e.g. a store read blowing up) is a 500, never a 4xx: a 4xx here would be an
262	   *  oracle. Fail-closed to an internal error, distinct from the detection's own false. */
263	  r.get('/app-assistant/whoami', (req, res) => {
264	    void whoami(req, res).catch((err) => {
265	      console.error('[app-assistant] whoami failed:', err instanceof Error ? err.message : err);
266	      sendError(res, 'INTERNAL', 'Erro interno.');
267	    });
268	  });
269	
270	  return r;
271	}
272	
```

#### api/assets/featured-artifacts/legal-portal/scaffold/frontend/src/portal.js — whoami(function), calls(calls)

```javascript
112	 * Sessão de app (via a plataforma). Fina camada sobre window.__ekoa.
113	 * ------------------------------------------------------------------------- */
114	
115	export async function whoami() {
116	  const api = ekoa();
117	  if (!api || typeof api.whoami !== 'function') return null;
118	  try {
119	    return await api.whoami();
120	  } catch {
121	    return null;
122	  }
123	}
124	
125	export async function passwordSignIn(email, password) {
126	  const api = ekoa();
```

#### api/src/bridge/registry.ts — isRevoked(function), calls(calls)

```typescript
80	}
81	
82	/** Is the pairing durably revoked? A missing row counts as "not a live pairing" for the caller. */
83	export async function isRevoked(pairingId: string): Promise<boolean> {
84	  const row = await getPairingById(pairingId);
85	  return !row || row.revokedAt !== null;
86	}
87	
88	/**
89	 * All non-revoked pairing rows an owner holds, newest first (§18.3.4; FC-405). Owner-scoped by
```

#### api/src/auth/middleware.ts — requireAuth(function), verifySseToken(function), fail(function), AuthedRequest(interface), middleware.ts(file)

```typescript
1	/**
2	 * The auth middleware (ch03 §3.2, CONV-1) — the first of the three admission planes
3	 * (ch09 §9.7.1). Order: verify JWT → revocation check → activation check. A deactivated
4	 * account fails 403 ACCOUNT_DISABLED; a billing-locked account fails 402 BILLING_LOCKED;
5	 * these run on EVERY authenticated /api/v1 request (no route opts out).
6	 */
7	import type { Request, Response, NextFunction } from 'express';
8	import { ERROR_STATUS, type ErrorCode } from '@ekoa/shared';
9	import { verifyToken, type JwtClaims } from './jwt.js';
10	import { isRevoked } from './revocation.js';
11	import { getActivation } from '../data/activation.js';
12	
13	export interface AuthedRequest extends Request {
14	  user?: JwtClaims;
15	}
16	
17	function fail(res: Response, code: ErrorCode, message: string): void {
18	  res.status(ERROR_STATUS[code]).json({ error: { code, message } });
19	}
20	
21	/** Bearer-JWT middleware for /api/v1 (except the closed exemption list). */
22	export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
23	  const header = req.header('authorization') ?? '';
24	  const m = /^Bearer\s+(.+)$/i.exec(header);
25	  if (!m) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
26	  let claims: JwtClaims;
27	  try {
28	    claims = verifyToken(m[1] as string);
29	  } catch (e) {
30	    const expired = e instanceof Error && e.name === 'TokenExpiredError';
31	    return fail(res, expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
32	  }
33	  // A minted token ALWAYS carries a jti (jwt.ts). A token without one cannot be revoked,
34	  // so it is treated as invalid (a revocation bypass otherwise — ch09 §9.6, P-03).
35	  if (!claims.jti) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
36	  if (isRevoked(claims.jti)) {
37	    return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
38	  }
39	  // Activation admission (write-through map; immediate, no TTL wait). Fail CLOSED on a
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
76	export function requireRole(...roles: JwtClaims['role'][]) {
77	  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
78	    if (!req.user || !roles.includes(req.user.role)) {
79	      return fail(res, 'FORBIDDEN', 'Sem permissão.');
80	    }
81	    next();
82	  };
83	}
```

#### api/src/auth/jwt.ts — verifyToken(function), JwtClaims(interface), signToken(function)

```typescript
1	/**
2	 * JWT sign/verify (ch03 §3.2, CONV-1). Single mint point. Claim set is
3	 * `{ sub, role, scope, orgId, username }` (Amendment 2 — orgId replaces companyId).
4	 */
5	import { randomUUID } from 'node:crypto';
6	import jwt from 'jsonwebtoken';
7	import { loadConfig } from '../config.js';
8	import type { Role } from '@ekoa/shared';
9	
10	export interface JwtClaims {
11	  sub: string;
12	  role: Role;
13	  scope: string;
14	  orgId: string;
15	  username: string;
16	  /** ALWAYS present on a minted token — the revocation key (P-03). A token lacking a jti
17	   *  cannot be revoked and is treated as invalid by the middleware. */
18	  jti: string;
19	  exp?: number;
20	  iat?: number;
21	}
22	
23	/** Mint a token. A `jti` is ALWAYS set (generated if the caller omits it) so every token
24	 *  is revocable (P-03) — a token without a jti is a revocation bypass and is forbidden.
25	 *
26	 *  `iat` may be pinned by the caller (jsonwebtoken honours an explicit `iat` and derives `exp`
27	 *  from it). A fresh session minted right after a token-epoch bump MUST carry `iat >= epoch`,
28	 *  or the middleware's `iat < tokenEpoch` check rejects it: JWT `iat` has one-second
29	 *  granularity, so a re-login in the same second as a password change would otherwise 401
30	 *  (ch09 §9.6). Only the mint-after-credential-check sites pin it. */
31	export function signToken(
32	  claims: Omit<JwtClaims, 'exp' | 'jti'> & { jti?: string; iat?: number },
33	  rememberMe = false,
34	): { token: string; expiresIn: number; jti: string } {
35	  const expiresIn = rememberMe ? 30 * 24 * 3600 : 24 * 3600; // 30d / 24h (ch03 §3.2)
36	  const jti = claims.jti ?? randomUUID();
37	  const token = jwt.sign({ ...claims, jti }, loadConfig().jwtSecret, { expiresIn });
38	  return { token, expiresIn, jti };
39	}
40	
41	/** Verify a token. jsonwebtoken rejects alg:none and tampered signatures by default;
42	 *  we additionally require HS256 explicitly so an attacker cannot downgrade the alg.
43	 *
44	 *  Token-class separation (ch18 §18.3.6, ch09 §9.2): the platform verifier positively REJECTS
45	 *  bridge tokens. Platform JWTs and bridge tokens are two classes over ONE secret, never
46	 *  interchangeable — a bridge token carries `aud: ekoa-bridge` and a `pairingId`/`connectionId`
47	 *  claim, none of which a minted platform token ever has, so any token bearing them is a bridge
48	 *  token presented on the wrong plane and is refused. This is an anti-replay/anti-misconfiguration
49	 *  defence: a stolen bridge token cannot call the platform API. (The bridge verifier rejects
50	 *  platform tokens symmetrically — bridge/token.ts readBridgeToken.) */
51	export function verifyToken(token: string): JwtClaims {
52	  const decoded = jwt.verify(token, loadConfig().jwtSecret, { algorithms: ['HS256'] }) as JwtClaims & {
53	    aud?: unknown;
54	    pairingId?: unknown;
55	    connectionId?: unknown;
56	  };
57	  if (decoded.aud === 'ekoa-bridge' || decoded.pairingId !== undefined || decoded.connectionId !== undefined) {
58	    throw new Error('bridge token presented on the platform verifier (token-class separation, ch18 §18.3.6)');
59	  }
60	  // Legacy-window shim (H1 role rename `builder` → `user`). A JWT minted before the rename carries
61	  // role 'builder', which is no longer a valid Role. Normalise it HERE — the single verify
62	  // chokepoint every admission path (requireAuth, verifySseToken, and every ?token= consumer)
63	  // funnels through — so no downstream role/capability check ever sees the dead value. The boot
64	  // migration bumps each migrated user's token epoch, so such tokens are rejected at the admission
65	  // plane once the epoch lands and the user re-logs in; this shim only covers the window between
66	  // boot and that next login. Remove once the fleet has rotated its tokens.
67	  if ((decoded.role as string) === 'builder') decoded.role = 'user';
68	  return decoded as JwtClaims;
69	}
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The route confirms one material deviation from the stated contract already: uncaught `whoami` failures become `500 INTERNAL`, not `200 {admin:false}`. I’m checking whether that’s reachable from realistic token/store paths and whether the tests actually catch it.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '260,520p'
nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '520,760p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   260	  // auto-enables anything - it only lights the discreet indicator in the header (the actual
   261	  // edit-mode switch is H3). Every privileged action stays gated server-side by H1.
   262	  const [admin, setAdmin] = useState(false);
   263	
   264	  const idRef = useRef(0);
   265	  const messagesRef = useRef(messages);
   266	  const actionResultsRef = useRef([]); // rolling buffer of recent action results for context
   267	  const listRef = useRef(null);
   268	  const textareaRef = useRef(null);
   269	  const playerRef = useRef(null);
   270	  const whoamiDoneRef = useRef(false); // guards the once-only admin detection (H2)
   271	
   272	  useEffect(() => {
   273	    messagesRef.current = messages;
   274	    // keep the newest turn in view
   275	    const el = listRef.current;
   276	    if (el) el.scrollTop = el.scrollHeight;
   277	  }, [messages]);
   278	
   279	  useEffect(() => {
   280	    // Auto-open handoff (G2): the visitor clicked the launcher, so the panel mounts
   281	    // already open - focus the composer once, matching an explicit open. Never runs
   282	    // on an idle-preloaded (collapsed) mount, so it never steals focus from the app.
   283	    if (defaultOpen && textareaRef.current) textareaRef.current.focus();
   284	    // Mount-only: the handoff intent is fixed at mount time.
   285	  }, [defaultOpen]);
   286	
   287	  // H2 admin DETECTION (detect-then-ask): ask the server ONCE, on mount, whether the current
   288	  // viewer is an admin of this app's owner org. Reads the platform token defensively (a
   289	  // cross-origin/sandboxed iframe throws) and attaches it as an OPTIONAL Bearer alongside the
   290	  // X-Ekoa-App-Id header the POST path already sends. This is a cheap non-LLM GET - it does NOT
   291	  // count as an assistant turn (zero-token invariant). The result only lights the discreet
   292	  // indicator; it NEVER auto-enables anything and issues no privileged call (edit mode is H3).
   293	  useEffect(() => {
   294	    const id = appId();
   295	    // No app id (standalone preview) or already detected once -> nothing to do. Empty deps make
   296	    // this a mount-only effect; the ref keeps detection to exactly ONE request per mounted panel
   297	    // even if the effect is ever re-entered. The panel-runtime entry mounts WITHOUT StrictMode.
   298	    if (!id || whoamiDoneRef.current) return;
   299	    whoamiDoneRef.current = true;
   300	
   301	    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
   302	    const token = readPlatformToken();
   303	    void (async () => {
   304	      try {
   305	        const res = await fetch(WHOAMI_ENDPOINT, {
   306	          method: 'GET',
   307	          ...(controller ? { signal: controller.signal } : {}),
   308	          headers: {
   309	            'X-Ekoa-App-Id': id,
   310	            // OPTIONAL: sent only when a same-origin token was readable. Absent -> the server
   311	            // fails closed to { admin: false }, so cross-origin dev simply shows no affordance.
   312	            ...(token ? { Authorization: `Bearer ${token}` } : {}),
   313	          },
   314	        });
   315	        if (!res.ok) return; // fail closed: stay non-admin on any non-200 (never an oracle anyway)
   316	        const data = await res.json();
   317	        setAdmin(!!(data && data.admin === true));
   318	      } catch {
   319	        // network error / aborted unmount / bad JSON -> stay non-admin. Detection is best-effort.
   320	      }
   321	    })();
   322	
   323	    return () => {
   324	      if (controller) controller.abort();
   325	    };
   326	    // Mount-only: detection is a one-shot for the panel's lifetime.
   327	    // eslint-disable-next-line react-hooks/exhaustive-deps
   328	  }, []);
   329	
   330	  const nextId = () => {
   331	    idRef.current += 1;
   332	    return idRef.current;
   333	  };
   334	
   335	  const patchTurn = useCallback((turnId, patch) => {
   336	    setMessages((prev) => prev.map((m) => (m.id === turnId ? { ...m, ...patch(m) } : m)));
   337	  }, []);
   338	
   339	  const recordResult = useCallback((result) => {
   340	    const buf = actionResultsRef.current;
   341	    buf.push(result);
   342	    if (buf.length > MAX_ACTION_RESULTS) buf.splice(0, buf.length - MAX_ACTION_RESULTS);
   343	  }, []);
   344	
   345	  // ---- E2 tour playback (same-document, zero-token) ------------------------
   346	  // Lazily build ONE client-side tour player. Its state drives the tour block in
   347	  // the panel; when a step surfaces a suggested prompt (inject-prompt) it lands in
   348	  // the composer - never auto-sent. No path here calls /api/app-assistant.
   349	  const ensurePlayer = useCallback(() => {
   350	    if (!playerRef.current) {
   351	      playerRef.current = createTourPlayer({
   352	        onState: (state) => {
   353	          setTour(state);
   354	          if (state && state.injectedPrompt) setDraft(state.injectedPrompt);
   355	        },
   356	      });
   357	    }
   358	    return playerRef.current;
   359	  }, []);
   360	
   361	  /** Start playing the app's guided tour in the page. Triggered by teach mode or a
   362	   *  startTour action. Fetches GET /api/demos/:appId inside the player - no model
   363	   *  turn is issued. `tourId` is forwarded for forward-compat (the route serves the
   364	   *  app's overview tour today). */
   365	  const startTourPlayback = useCallback(
   366	    (tourId) => {
   367	      const player = ensurePlayer();
   368	      setCollapsed(false);
   369	      void player.start(undefined, tourId);
   370	    },
   371	    [ensurePlayer],
   372	  );
   373	
   374	  const tourNext = useCallback(() => {
   375	    if (playerRef.current) playerRef.current.next();
   376	  }, []);
   377	
   378	  const tourClose = useCallback(() => {
   379	    if (playerRef.current) playerRef.current.cancel();
   380	    setTour(null);
   381	  }, []);
   382	
   383	  /** Collapse the panel. A tour is bound to the visible panel, so collapsing it
   384	   *  CANCELS any active tour (clears the on-page spotlight + aborts the run) rather
   385	   *  than leaving a ring on screen with no reachable controls. */
   386	  const collapsePanel = useCallback(() => {
   387	    if (playerRef.current) playerRef.current.cancel();
   388	    setTour(null);
   389	    setCollapsed(true);
   390	  }, []);
   391	
   392	  /** Run the assistant's proposed actions in order through the C3 runtime. The
   393	   *  runtime draws the driving badge / highlight / destructive confirm and pauses
   394	   *  on real user input - the panel only reflects each run's state. */
   395	  const runActions = useCallback(
   396	    async (actions, turnId) => {
   397	      const runtime = typeof window !== 'undefined' ? window.__ekoaActions : undefined;
   398	      for (const a of actions) {
   399	        const runId = nextId();
   400	        patchTurn(turnId, (m) => ({ runs: [...(m.runs || []), { id: runId, status: 'running' }] }));
   401	
   402	        const setStatus = (status, detail) =>
   403	          patchTurn(turnId, (m) => ({
   404	            runs: (m.runs || []).map((r) => (r.id === runId ? { ...r, status, detail } : r)),
   405	          }));
   406	
   407	        // A startTour action is played by the SAME-DOCUMENT tour player, not the
   408	        // runtime executor: the runtime's cross-frame startTour only posts a
   409	        // tour-request (a no-op in-page) and drops the tourId. The panel owns the
   410	        // player, so it starts playback here. Client-side + zero-token.
   411	        const runtimeAction = toRuntimeAction(a);
   412	        if (runtimeAction && runtimeAction.kind === 'startTour') {
   413	          startTourPlayback(runtimeAction.tourId);
   414	          setStatus('done');
   415	          recordResult({ toolName: a && a.toolName, status: 'done' });
   416	          continue;
   417	        }
   418	
   419	        if (!runtime || typeof runtime.execute !== 'function') {
   420	          setStatus('unavailable');
   421	          recordResult({ toolName: a && a.toolName, status: 'unavailable' });
   422	          continue;
   423	        }
   424	        try {
   425	          const result = await runtime.execute(runtimeAction);
   426	          const status = (result && result.status) || 'done';
   427	          setStatus(status, result && result.detail);
   428	          recordResult({ toolName: a && a.toolName, status, detail: result && result.detail });
   429	        } catch (err) {
   430	          setStatus('failed', err && err.reason);
   431	          recordResult({ toolName: a && a.toolName, status: 'failed', detail: err && err.reason });
   432	        }
   433	      }
   434	    },
   435	    [patchTurn, recordResult, startTourPlayback],
   436	  );
   437	
   438	  const send = useCallback(
   439	    async (rawText) => {
   440	      const text = (rawText != null ? rawText : draft).trim();
   441	      if (!text || busy) return;
   442	
   443	      // History is the conversation BEFORE this message (role/content pairs only),
   444	      // capped to the most recent turns so request size, latency and model cost stay
   445	      // bounded on a long-lived panel.
   446	      const history = messagesRef.current
   447	        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error)
   448	        .slice(-MAX_HISTORY_TURNS)
   449	        .map((m) => ({ role: m.role, content: m.content }));
   450	
   451	      setDraft('');
   452	      setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: text }].slice(-MAX_MESSAGES));
   453	      setBusy(true);
   454	
   455	      const route = currentRoute();
   456	      const recent = actionResultsRef.current.slice();
   457	      const context = {};
   458	      if (route) context.route = route;
   459	      if (recent.length) context.actionResults = recent;
   460	
   461	      const id = appId();
   462	      // A hung network/model turn must never lock the composer: abort after the
   463	      // timeout and fall through to the calm PT-PT error turn.
   464	      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
   465	      const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
   466	      try {
   467	        const res = await fetch(ENDPOINT, {
   468	          method: 'POST',
   469	          ...(controller ? { signal: controller.signal } : {}),
   470	          headers: {
   471	            'Content-Type': 'application/json',
   472	            ...(id ? { 'X-Ekoa-App-Id': id } : {}),
   473	          },
   474	          body: JSON.stringify({
   475	            message: text,
   476	            history,
   477	            // Send the mode only when the visitor pinned it; otherwise let the server
   478	            // infer it from the phrasing and echo it back on response.mode.
   479	            ...(pinnedMode ? { mode: pinnedMode } : {}),
   480	            ...(Object.keys(context).length ? { context } : {}),
   481	          }),
   482	        });
   483	        if (!res.ok) {
   484	          setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: ERROR_REPLY, error: true }].slice(-MAX_MESSAGES));
   485	          return;
   486	        }
   487	        const data = await res.json();
   488	        if (data && typeof data.mode === 'string') setMode(data.mode);
   489	        const turnId = nextId();
   490	        setMessages((prev) => [
   491	          ...prev,
   492	          {
   493	            id: turnId,
   494	            role: 'assistant',
   495	            content: (data && data.reply) || '',
   496	            citations: data && Array.isArray(data.citations) ? data.citations : undefined,
   497	            runs: [],
   498	          },
   499	        ].slice(-MAX_MESSAGES));
   500	        if (data && Array.isArray(data.actions) && data.actions.length) {
   501	          await runActions(data.actions, turnId);
   502	        }
   503	      } catch {
   504	        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: ERROR_REPLY, error: true }].slice(-MAX_MESSAGES));
   505	      } finally {
   506	        if (timer) clearTimeout(timer);
   507	        setBusy(false);
   508	      }
   509	    },
   510	    [draft, busy, pinnedMode, runActions],
   511	  );
   512	
   513	  const open = useCallback(() => {
   514	    setCollapsed(false);
   515	    // Focus only on an explicit open (user intent); never on mount, so the panel
   516	    // never steals focus from the app while it loads.
   517	    window.setTimeout(() => {
   518	      if (textareaRef.current) textareaRef.current.focus();
   519	    }, 0);
   520	  }, []);
   520	  }, []);
   521	
   522	  // Open-intent handoff, late leg (G2): the boot launcher dispatches
   523	  // 'ekoa:assistant-open' on every click. The defaultOpen flag covers a click BEFORE
   524	  // this panel mounts; this listener covers a click AFTER it mounted collapsed (an
   525	  // idle preload racing the visitor's click) - intent is never lost between the two.
   526	  useEffect(() => {
   527	    const onOpenIntent = () => open();
   528	    window.addEventListener('ekoa:assistant-open', onOpenIntent);
   529	    return () => window.removeEventListener('ekoa:assistant-open', onOpenIntent);
   530	  }, [open]);
   531	
   532	  const onExample = useCallback((example) => {
   533	    setMode(example.mode);
   534	    setDraft(example.prompt);
   535	    if (textareaRef.current) textareaRef.current.focus();
   536	  }, []);
   537	
   538	  const onKeyDown = useCallback(
   539	    (e) => {
   540	      // Enter sends; Shift+Enter is a newline.
   541	      if (e.key === 'Enter' && !e.shiftKey) {
   542	        e.preventDefault();
   543	        void send();
   544	      }
   545	    },
   546	    [send],
   547	  );
   548	
   549	  if (collapsed) {
   550	    return (
   551	      <button type="button" className="ekoa-assistant-launcher" onClick={open} aria-label="Abrir o assistente">
   552	        <ChatIcon />
   553	        <span>Assistente</span>
   554	      </button>
   555	    );
   556	  }
   557	
   558	  // A tour is on-screen for every phase except idle/cancelled (both mean "no tour").
   559	  const tourActive = !!(tour && tour.status && tour.status !== 'idle' && tour.status !== 'cancelled');
   560	
   561	  return (
   562	    <aside className="ekoa-assistant" data-collapsed="false" role="complementary" aria-label="Assistente">
   563	      <header className="ekoa-assistant-header">
   564	        <span className="ekoa-assistant-titlegroup" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2, 0.5rem)' }}>
   565	          <span className="ekoa-assistant-title">Assistente</span>
   566	          {/* H2 detect-then-ask: a DISCREET, non-intrusive indicator that an admin capability
   567	              exists. It does NOTHING - no click handler, no mode change, no privileged call. The
   568	              opt-in edit-mode switch is H3. Styled inline (brand-neutral via the panel CSS vars)
   569	              so it inherits the app's theme without a bespoke stylesheet rule. */}
   570	          {admin ? (
   571	            <span
   572	              className="ekoa-assistant-admin-badge"
   573	              data-admin="true"
   574	              title="Tem permissões de administrador nesta aplicação."
   575	              style={{
   576	                fontSize: 'var(--text-sm, 0.8125rem)',
   577	                fontWeight: 600,
   578	                color: 'var(--color-text-muted, #475569)',
   579	                border: '1px solid var(--color-border, #E2E8F0)',
   580	                borderRadius: 'var(--radius-sm, 0.375rem)',
   581	                padding: '0.05rem 0.4rem',
   582	                lineHeight: 1.4,
   583	                letterSpacing: '0.02em',
   584	                whiteSpace: 'nowrap',
   585	              }}
   586	            >
   587	              Administrador
   588	            </span>
   589	          ) : null}
   590	        </span>
   591	        <button type="button" className="ekoa-assistant-close" onClick={collapsePanel} aria-label="Fechar o assistente">
   592	          <CloseIcon />
   593	        </button>
   594	      </header>
   595	
   596	      <div className="ekoa-assistant-modes" role="group" aria-label="Modo do assistente">
   597	        {MODES.map((m) => (
   598	          <button
   599	            key={m.id}
   600	            type="button"
   601	            className="ekoa-assistant-mode"
   602	            aria-pressed={mode === m.id}
   603	            onClick={() => {
   604	              // Pin the picked mode (click the pinned one again to unpin, back to inference).
   605	              setPinnedMode((prev) => (prev === m.id ? null : m.id));
   606	              setMode(m.id);
   607	            }}
   608	          >
   609	            {m.label}
   610	          </button>
   611	        ))}
   612	      </div>
   613	
   614	      <div className="ekoa-assistant-messages" ref={listRef}>
   615	        {messages.length === 0 ? (
   616	          <div className="ekoa-assistant-intro">
   617	            <p className="ekoa-assistant-intro-lead">
   618	              Olá. Posso ajudar de três formas: mostrar uma visão geral da aplicação, ensinar como
   619	              a usar passo a passo, ou operá-la por si. Experimente:
   620	            </p>
   621	            <div className="ekoa-assistant-examples">
   622	              {EXAMPLES.map((ex) => (
   623	                <button key={ex.prompt} type="button" className="ekoa-assistant-example" onClick={() => onExample(ex)}>
   624	                  <span className="ekoa-assistant-example-kind">{ex.kind}</span>
   625	                  {ex.prompt}
   626	                </button>
   627	              ))}
   628	            </div>
   629	          </div>
   630	        ) : (
   631	          messages.map((m) => (
   632	            <div key={m.id} className="ekoa-assistant-turn" data-role={m.role}>
   633	              {m.content ? <div className="ekoa-assistant-bubble">{m.content}</div> : null}
   634	
   635	              {m.citations && m.citations.length ? (
   636	                <div className="ekoa-assistant-citations">
   637	                  <div className="ekoa-assistant-citations-title">Fontes</div>
   638	                  <ul>
   639	                    {m.citations.map((c, i) => (
   640	                      <li key={`${c.collection}/${c.docId}/${i}`}>
   641	                        <span className="ekoa-assistant-citation-collection">{c.collection}</span>
   642	                        {' - '}
   643	                        <span className="ekoa-assistant-citation-title">{c.title}</span>
   644	                      </li>
   645	                    ))}
   646	                  </ul>
   647	                </div>
   648	              ) : null}
   649	
   650	              {m.runs && m.runs.length ? (
   651	                <div className="ekoa-assistant-runs">
   652	                  {m.runs.map((r) => (
   653	                    <div key={r.id} className="ekoa-assistant-run" data-status={r.status}>
   654	                      <span className="ekoa-assistant-run-dot" aria-hidden="true" />
   655	                      <span>{runLabel(r.status)}</span>
   656	                    </div>
   657	                  ))}
   658	                </div>
   659	              ) : null}
   660	            </div>
   661	          ))
   662	        )}
   663	      </div>
   664	
   665	      {tourActive ? (
   666	        <TourView tour={tour} onNext={tourNext} onClose={tourClose} />
   667	      ) : mode === 'teach' ? (
   668	        <div className="ekoa-assistant-tour-launch">
   669	          <button
   670	            type="button"
   671	            className="ekoa-assistant-tour-start"
   672	            onClick={() => startTourPlayback()}
   673	          >
   674	            Iniciar tutorial guiado
   675	          </button>
   676	        </div>
   677	      ) : null}
   678	
   679	      <div className="ekoa-assistant-composer">
   680	        <textarea
   681	          ref={textareaRef}
   682	          className="ekoa-assistant-textarea"
   683	          placeholder="Escreva a sua mensagem..."
   684	          value={draft}
   685	          disabled={busy}
   686	          onChange={(e) => setDraft(e.target.value)}
   687	          onKeyDown={onKeyDown}
   688	          rows={1}
   689	          aria-label="Mensagem para o assistente"
   690	        />
   691	        <button
   692	          type="button"
   693	          className="ekoa-assistant-send"
   694	          onClick={() => send()}
   695	          disabled={busy || !draft.trim()}
   696	          aria-label="Enviar mensagem"
   697	        >
   698	          <SendIcon />
   699	        </button>
   700	      </div>
   701	    </aside>
   702	  );
   703	}
   704	
   705	export default AssistantPanel;

exec
/bin/zsh -lc "nl -ba api/tests/apps/app-assistant.test.ts | sed -n '1,360p'
nl -ba api/tests/apps/app-assistant.test.ts | sed -n '361,760p'
nl -ba api/tests/apps/assistant-panel.test.ts | sed -n '1,260p'
nl -ba api/tests/contract/app-assistant.contract.test.ts | sed -n '1,220p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	import { describe, it, expect, beforeAll, afterAll } from 'vitest';
     2	import type { Server } from 'node:http';
     3	import express from 'express';
     4	import jwt from 'jsonwebtoken';
     5	import type { AppAction, AppActionManifest } from '@ekoa/shared';
     6	import { AppAssistantWhoamiResponse } from '@ekoa/shared';
     7	import type { SearchHit } from '../../src/knowledge/index.js';
     8	import type { OneShotOptions, LlmAttribution, RouterDecision } from '../../src/llm/index.js';
     9	import { assistantToolsFromManifest } from '../../src/apps/assistant-tools.js';
    10	import {
    11	  runAppAssistant,
    12	  inferMode,
    13	  extractActions,
    14	  type AppAssistantDeps,
    15	} from '../../src/apps/app-assistant.js';
    16	import { appAssistantRouter, isOwnerOrgAdmin } from '../../src/apps/app-assistant-route.js';
    17	import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
    18	import { connectMongo, closeMongo } from '../../src/data/mongo.js';
    19	import { users, artifacts } from '../../src/data/stores.js';
    20	import { setActivation, bumpTokenEpoch, __resetActivationForTests } from '../../src/data/activation.js';
    21	import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
    22	import { login } from '../../src/auth/service.js';
    23	import { hashPassword } from '../../src/auth/password.js';
    24	import { loadConfig, __resetConfigForTests } from '../../src/config.js';
    25	
    26	/**
    27	 * operator-run D1 — the served-app assistant pure logic, over an INJECTED one-shot (no real model),
    28	 * an injected grounding builder, and an injected routing decision. Asserts: mode inference; grounding
    29	 * hits become citations; the ```ekoa-actions``` block is parsed, validated against the manifest, and
    30	 * stripped from the reply; unknown tool names are dropped; and the grounding org comes from the
    31	 * resolved OWNER, never a caller-supplied value.
    32	 */
    33	
    34	const manifest: AppActionManifest = {
    35	  version: 1,
    36	  actions: [
    37	    { id: 'ir-clientes', kind: 'navigate', labelPt: 'Ver clientes', description: 'Abre a lista de clientes', route: '/clientes', params: [], destructive: false },
    38	    {
    39	      id: 'criar-cliente', kind: 'custom', labelPt: 'Criar cliente', description: 'Cria um novo cliente',
    40	      params: [{ name: 'nome', type: 'string', required: true }], destructive: false,
    41	    },
    42	  ],
    43	};
    44	
    45	const DECISION: RouterDecision = { tier: 'WORKHORSE', model: 'claude-sonnet-5', effort: 'medium', weight: 0.1 };
    46	const OWNER = { userId: 'owner-1', orgId: 'org-owner' };
    47	
    48	/** The server-resolved manifest AppAction D1 attaches to each proposed action. */
    49	const actionById = (id: string): AppAction => manifest.actions.find((a) => a.id === id)!;
    50	/** toolName -> manifest AppAction, as runAppAssistant / extractActions consume it. */
    51	const toolMap = new Map(assistantToolsFromManifest(manifest).map((t) => [t.name, t.action] as const));
    52	
    53	interface Captured {
    54	  opts?: OneShotOptions;
    55	  attribution?: LlmAttribution;
    56	  groundInput?: { orgId: string; query: string; kind: string };
    57	}
    58	
    59	/** Deps whose one-shot returns `oneShotText` verbatim and whose grounding returns `hits`. */
    60	function makeDeps(oneShotText: string, hits: SearchHit[] = [], captured: Captured = {}): AppAssistantDeps {
    61	  return {
    62	    oneShot: async (opts, attribution) => {
    63	      captured.opts = opts;
    64	      captured.attribution = attribution;
    65	      return { text: oneShotText, usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } };
    66	    },
    67	    ground: (input) => {
    68	      captured.groundInput = input;
    69	      return { block: hits.length ? 'CONHECIMENTO (excertos):\n[1] col / titulo (doc d1)' : '', hits };
    70	    },
    71	    decide: () => DECISION,
    72	  };
    73	}
    74	
    75	function hit(over: Partial<SearchHit> = {}): SearchHit {
    76	  return { docId: 'd1', collection: 'faq', title: 'Como criar cliente', snippet: 'passo 1...', score: 1, scope: 'org', ...over };
    77	}
    78	
    79	describe('inferMode (D1 deterministic PT-PT classifier)', () => {
    80	  it('teach cues -> teach', () => {
    81	    expect(inferMode('Faz um tutorial da aplicação')).toBe('teach');
    82	    expect(inferMode('Explica como funciona o registo')).toBe('teach');
    83	    expect(inferMode('Ensina-me a usar isto passo a passo')).toBe('teach');
    84	  });
    85	  it('show cues -> show (accent-insensitive)', () => {
    86	    expect(inferMode('Mostra-me o painel')).toBe('show');
    87	    expect(inferMode('Dá-me uma visão geral')).toBe('show');
    88	    expect(inferMode('Faz um resumo geral')).toBe('show');
    89	  });
    90	  it('teach wins over show ("mostra-me como criar")', () => {
    91	    expect(inferMode('Mostra-me como criar um cliente')).toBe('teach');
    92	  });
    93	  it('imperative task verbs and anything else default to do', () => {
    94	    expect(inferMode('Cria um cliente chamado Ana')).toBe('do');
    95	    expect(inferMode('Adiciona uma nota ao processo')).toBe('do');
    96	    expect(inferMode('Olá')).toBe('do');
    97	  });
    98	});
    99	
   100	describe('extractActions (D1 fenced-block parser)', () => {
   101	  it('parses an actions block, attaches the resolved AppAction, and strips it from the prose', () => {
   102	    const reply = [
   103	      'Vou criar o cliente para si.',
   104	      '```ekoa-actions',
   105	      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}}]',
   106	      '```',
   107	      'Feito.',
   108	    ].join('\n');
   109	    const { text, actions } = extractActions(reply, toolMap);
   110	    expect(actions).toEqual([
   111	      { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
   112	    ]);
   113	    expect(text).toContain('Vou criar o cliente');
   114	    expect(text).toContain('Feito.');
   115	    expect(text).not.toContain('ekoa-actions');
   116	    expect(text).not.toContain('app_action__');
   117	  });
   118	
   119	  it('drops unknown tool names but keeps + resolves known ones', () => {
   120	    const reply = [
   121	      '```ekoa-actions',
   122	      '[{"toolName":"app_action__inexistente","input":{}},{"toolName":"app_action__ir_clientes","input":{}}]',
   123	      '```',
   124	    ].join('\n');
   125	    const { actions } = extractActions(reply, toolMap);
   126	    expect(actions).toEqual([{ toolName: 'app_action__ir_clientes', input: {}, action: actionById('ir-clientes') }]);
   127	  });
   128	
   129	  it('drops UNDECLARED param keys from the model input (fenced path honours the tool schema)', () => {
   130	    // codex-d2 #1: `custom` action params reach app code verbatim, so the fenced path
   131	    // must enforce the same additionalProperties:false contract the SDK tool schema does.
   132	    const reply = [
   133	      '```ekoa-actions',
   134	      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana","__proto__x":"pwn","cmd":"rm -rf"}}]',
   135	      '```',
   136	    ].join('\n');
   137	    const { actions } = extractActions(reply, toolMap);
   138	    expect(actions).toHaveLength(1);
   139	    expect(actions[0]!.input).toEqual({ nome: 'Ana' }); // declared param kept, undeclared dropped
   140	  });
   141	
   142	  it('a malformed block yields no actions and is still stripped', () => {
   143	    const reply = 'Olá\n```ekoa-actions\nnão é json\n```\ntchau';
   144	    const { text, actions } = extractActions(reply, toolMap);
   145	    expect(actions).toEqual([]);
   146	    expect(text).not.toContain('ekoa-actions');
   147	    expect(text).toContain('Olá');
   148	    expect(text).toContain('tchau');
   149	  });
   150	
   151	  it('non-object input defaults to {}', () => {
   152	    const reply = '```ekoa-actions\n[{"toolName":"app_action__ir_clientes","input":"oops"}]\n```';
   153	    const { actions } = extractActions(reply, toolMap);
   154	    expect(actions).toEqual([{ toolName: 'app_action__ir_clientes', input: {}, action: actionById('ir-clientes') }]);
   155	  });
   156	});
   157	
   158	describe('runAppAssistant (D1)', () => {
   159	  it('infers the mode when not pinned and echoes it back', async () => {
   160	    const deps = makeDeps('Aqui está uma visão geral.');
   161	    const res = await runAppAssistant(
   162	      { message: 'Mostra-me a aplicação', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
   163	      deps,
   164	    );
   165	    expect(res.mode).toBe('show');
   166	  });
   167	
   168	  it('honours a client-pinned mode over inference', async () => {
   169	    const deps = makeDeps('ok');
   170	    const res = await runAppAssistant(
   171	      { message: 'Mostra-me a aplicação', mode: 'do', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
   172	      deps,
   173	    );
   174	    expect(res.mode).toBe('do');
   175	  });
   176	
   177	  it('turns grounding hits into citations (collection/docId/title)', async () => {
   178	    const hits = [hit(), hit({ docId: 'd2', collection: 'guias', title: 'Guia', scope: 'shared' })];
   179	    const deps = makeDeps('Resposta com fonte.', hits);
   180	    const res = await runAppAssistant(
   181	      { message: 'Como crio um cliente?', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
   182	      deps,
   183	    );
   184	    expect(res.citations).toEqual([
   185	      { collection: 'faq', docId: 'd1', title: 'Como criar cliente' },
   186	      { collection: 'guias', docId: 'd2', title: 'Guia' },
   187	    ]);
   188	  });
   189	
   190	  it('parses + validates the actions block and strips it from the reply', async () => {
   191	    const oneShotText = [
   192	      'Vou tratar disso.',
   193	      '```ekoa-actions',
   194	      '[{"toolName":"app_action__criar_cliente","input":{"nome":"Ana"}},{"toolName":"app_action__desconhecida","input":{}}]',
   195	      '```',
   196	    ].join('\n');
   197	    const deps = makeDeps(oneShotText);
   198	    const res = await runAppAssistant(
   199	      { message: 'Cria a cliente Ana', owner: OWNER, artifactId: 'art-1', actionManifest: manifest },
   200	      deps,
   201	    );
   202	    expect(res.actions).toEqual([
   203	      { toolName: 'app_action__criar_cliente', input: { nome: 'Ana' }, action: actionById('criar-cliente') },
   204	    ]); // unknown dropped, resolved AppAction attached
   205	    expect(res.reply).toBe('Vou tratar disso.');
   206	    expect(res.reply).not.toContain('ekoa-actions');
   207	  });
   208	
   209	  it('an app with no manifest has no operate surface (all requested actions dropped)', async () => {
   210	    const oneShotText = '```ekoa-actions\n[{"toolName":"app_action__criar_cliente","input":{}}]\n```texto';
   211	    const deps = makeDeps(oneShotText);
   212	    const res = await runAppAssistant(
   213	      { message: 'Cria algo', owner: OWNER, artifactId: 'art-1', actionManifest: null },
   214	      deps,
   215	    );
   216	    expect(res.actions).toEqual([]);
   217	    expect(res.reply).toBe('texto');
   218	  });
   219	
   220	  it('grounds under the OWNER org and bills the OWNER — never a caller-supplied value', async () => {
   221	    const captured: Captured = {};
   222	    const deps = makeDeps('ok', [], captured);
   223	    await runAppAssistant(
   224	      {
   225	        message: 'Olá',
   226	        // A caller trying to steer the org via context must be ignored — the org comes from owner.
   227	        context: { route: '/x', actionResults: [{ orgId: 'attacker-org' }] },
   228	        owner: OWNER,
   229	        artifactId: 'art-99',
   230	        actionManifest: manifest,
   231	      },
   232	      deps,
   233	    );
   234	    expect(captured.groundInput).toEqual({ orgId: 'org-owner', query: 'Olá', kind: 'chat' });
   235	    expect(captured.attribution).toEqual({
   236	      kind: 'user_work',
   237	      agentType: 'assistant-chat',
   238	      billeeUserId: 'owner-1',
   239	      artifactId: 'art-99',
   240	    });
   241	  });
   242	});
   243	
   244	/**
   245	 * operator-run H2 — the admin-detection DECISION (`isOwnerOrgAdmin`), the PURE role/org/capability
   246	 * core of `GET /api/app-assistant/whoami`. It reuses H1's `can('canEditApps')` as the capability
   247	 * gate, then scopes org-admins to the owner org and lets super-admins span every org. No token /
   248	 * verification here — that layer is exercised by the route matrix below.
   249	 */
   250	describe('isOwnerOrgAdmin (H2 detection decision)', () => {
   251	  it('an org-admin of the OWNER org is an admin (capability + org match)', () => {
   252	    expect(isOwnerOrgAdmin({ role: 'org-admin', orgId: 'org-owner' }, 'org-owner')).toBe(true);
   253	  });
   254	  it('an org-admin of ANOTHER org is NOT (org mismatch, fail-closed)', () => {
   255	    expect(isOwnerOrgAdmin({ role: 'org-admin', orgId: 'org-other' }, 'org-owner')).toBe(false);
   256	  });
   257	  it('a super-admin is an admin of ANY org (spans orgs)', () => {
   258	    expect(isOwnerOrgAdmin({ role: 'super-admin', orgId: 'org-other' }, 'org-owner')).toBe(true);
   259	    expect(isOwnerOrgAdmin({ role: 'super-admin', orgId: 'org-owner' }, 'org-owner')).toBe(true);
   260	  });
   261	  it('a plain user is never an admin (H1 capability gate denies canEditApps)', () => {
   262	    expect(isOwnerOrgAdmin({ role: 'user', orgId: 'org-owner' }, 'org-owner')).toBe(false);
   263	  });
   264	});
   265	
   266	/**
   267	 * operator-run H2 — the `GET /api/app-assistant/whoami` FAIL-CLOSED matrix over the REAL router,
   268	 * the REAL verification chain (verifyToken + jti + isRevoked + activation-active + tokenEpoch, via
   269	 * verifySseToken) and REAL owner resolution. The router is wired with THROWING llm deps: whoami
   270	 * must never ground/route/bill, so any accidental model touch would blow the request up (it does
   271	 * not — every case returns 200). Binding invariants asserted here:
   272	 *   - admin:true ONLY for an org-admin/super-admin of the OWNER org WITH canEditApps.
   273	 *   - EVERYTHING else -> 200 { admin:false }: no token, invalid, expired, epoch-stale, user role,
   274	 *     wrong-org admin. NEVER a 4xx on a bad/missing token (a 401/403 would be an oracle).
   275	 *   - the ONLY non-200 is a malformed X-Ekoa-App-Id (the SAME 400 POST gives) / unknown app (404).
   276	 */
   277	describe('GET /api/app-assistant/whoami (H2 fail-closed detection)', () => {
   278	  let mem: MongoMemoryServer;
   279	  let server: Server;
   280	  let port: number;
   281	  let seq = 0;
   282	  const loginDeps = { now: () => 1_700_000_000_000 + seq++, genId: () => `jti_${seq++}` };
   283	
   284	  // whoami must NEVER reach these — it neither grounds, routes, nor bills.
   285	  const throwingDeps: AppAssistantDeps = {
   286	    oneShot: async () => { throw new Error('whoami must not call the model (visitor-blindness exception is detection-only)'); },
   287	    ground: () => { throw new Error('whoami must not ground'); },
   288	    decide: () => { throw new Error('whoami must not route'); },
   289	  };
   290	
   291	  const APP_ID = 'app-h2'; // owned by owner-1 (org-owner)
   292	  const tokens: Record<string, string> = {};
   293	
   294	  async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
   295	    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
   296	    setActivation(id, { active: true, billingLocked: false });
   297	  }
   298	  const whoami = (headers: Record<string, string>) =>
   299	    fetch(`http://127.0.0.1:${port}/api/app-assistant/whoami`, { headers });
   300	  const postAssistant = (headers: Record<string, string>) =>
   301	    fetch(`http://127.0.0.1:${port}/api/app-assistant`, {
   302	      method: 'POST',
   303	      headers: { 'content-type': 'application/json', ...headers },
   304	      body: JSON.stringify({ message: 'olá' }),
   305	    });
   306	
   307	  beforeAll(async () => {
   308	    process.env.ENCRYPTION_KEY = 'k';
   309	    process.env.JWT_SECRET = 's';
   310	    __resetConfigForTests();
   311	    loadConfig();
   312	    __resetActivationForTests();
   313	    __resetRevocationsForTests();
   314	    mem = await createMem();
   315	    await connectMongo(mem.getUri(), 'ekoa_h2_whoami');
   316	
   317	    // The app + its owner (org-owner). Owner org is resolved server-side from this user record.
   318	    await mkUser('owner-1', 'org-owner', 'org-admin');
   319	    await artifacts.insert({ _id: APP_ID, name: 'H2', userId: 'owner-1', orgId: 'org-owner', visibility: 'private' } as never);
   320	
   321	    // Callers.
   322	    await mkUser('admin-owner', 'org-owner', 'org-admin'); // a DIFFERENT admin in the owner org
   323	    await mkUser('super-1', 'org-other', 'super-admin'); // super-admin in a DIFFERENT org
   324	    await mkUser('admin-other', 'org-other', 'org-admin'); // org-admin of the WRONG org
   325	    await mkUser('user-owner', 'org-owner', 'user'); // owner-org member without canEditApps
   326	    await mkUser('stale-admin', 'org-owner', 'org-admin'); // owner-org admin, token then epoch-staled
   327	
   328	    for (const u of ['owner-1', 'admin-owner', 'super-1', 'admin-other', 'user-owner', 'stale-admin']) {
   329	      tokens[u] = (await login(u, 'pw123456', false, loginDeps)).token;
   330	    }
   331	    // Epoch-stale: bump stale-admin's epoch far past its freshly-minted token's iat, so the SAME
   332	    // (otherwise-admin) token is now stale — proving the tokenEpoch leg of the chain rejects it.
   333	    bumpTokenEpoch('stale-admin', Math.floor(Date.now() / 1000) + 100_000);
   334	
   335	    const app = express();
   336	    app.use(express.json());
   337	    app.use('/api', appAssistantRouter(throwingDeps));
   338	    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
   339	    port = (server.address() as { port: number }).port;
   340	  }, 60_000);
   341	
   342	  afterAll(async () => {
   343	    server?.close();
   344	    await closeMongo();
   345	    await mem?.stop();
   346	    __resetActivationForTests();
   347	    __resetRevocationsForTests();
   348	  });
   349	
   350	  const bearer = (u: string) => ({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${tokens[u]}` });
   351	
   352	  it('an org-admin of the OWNER org -> 200 { admin:true }', async () => {
   353	    const res = await whoami(bearer('admin-owner'));
   354	    expect(res.status).toBe(200);
   355	    const body = await res.json();
   356	    expect(AppAssistantWhoamiResponse.safeParse(body).success).toBe(true);
   357	    expect(body).toEqual({ admin: true });
   358	  });
   359	
   360	  it('the artifact owner (org-admin of the owner org) -> 200 { admin:true }', async () => {
   361	    const res = await whoami(bearer('owner-1'));
   362	    expect(res.status).toBe(200);
   363	    expect(await res.json()).toEqual({ admin: true });
   364	  });
   365	
   366	  it('a super-admin (any org) -> 200 { admin:true }', async () => {
   367	    const res = await whoami(bearer('super-1'));
   368	    expect(res.status).toBe(200);
   369	    expect(await res.json()).toEqual({ admin: true });
   370	  });
   371	
   372	  it('an org-admin of ANOTHER org -> 200 { admin:false } (never 403 — no cross-org oracle)', async () => {
   373	    const res = await whoami(bearer('admin-other'));
   374	    expect(res.status).toBe(200);
   375	    expect(await res.json()).toEqual({ admin: false });
   376	  });
   377	
   378	  it('a plain user of the owner org -> 200 { admin:false } (H1 capability gate)', async () => {
   379	    const res = await whoami(bearer('user-owner'));
   380	    expect(res.status).toBe(200);
   381	    expect(await res.json()).toEqual({ admin: false });
   382	  });
   383	
   384	  it('NO token -> 200 { admin:false } (never a 401 — token absence is not an oracle)', async () => {
   385	    const res = await whoami({ 'x-ekoa-app-id': APP_ID });
   386	    expect(res.status).toBe(200);
   387	    expect(await res.json()).toEqual({ admin: false });
   388	  });
   389	
   390	  it('an INVALID token -> 200 { admin:false } (never a 401)', async () => {
   391	    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: 'Bearer not-a-jwt' });
   392	    expect(res.status).toBe(200);
   393	    expect(await res.json()).toEqual({ admin: false });
   394	  });
   395	
   396	  it('an EXPIRED token (would-be admin) -> 200 { admin:false }', async () => {
   397	    // A structurally-admin token (org-admin of the owner org) but already expired: the verify
   398	    // chain rejects it at verifyToken, so detection is false — expiry alone denies.
   399	    const expired = jwt.sign(
   400	      { sub: 'owner-1', role: 'org-admin', scope: 'user', orgId: 'org-owner', username: 'owner-1', jti: 'expired.1' },
   401	      's',
   402	      { expiresIn: -10 },
   403	    );
   404	    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${expired}` });
   405	    expect(res.status).toBe(200);
   406	    expect(await res.json()).toEqual({ admin: false });
   407	  });
   408	
   409	  it('an EPOCH-STALE token (would-be admin) -> 200 { admin:false }', async () => {
   410	    // stale-admin is an org-admin of the owner org; its token predates the epoch bump, so the
   411	    // tokenEpoch leg of the chain rejects it — a demoted/rotated session cannot detect as admin.
   412	    const res = await whoami(bearer('stale-admin'));
   413	    expect(res.status).toBe(200);
   414	    expect(await res.json()).toEqual({ admin: false });
   415	  });
   416	
   417	  it('a malformed X-Ekoa-App-Id -> 400 — the SAME status POST gives (charset check reused)', async () => {
   418	    const bad = { 'x-ekoa-app-id': 'bad app!', authorization: `Bearer ${tokens['admin-owner']}` };
   419	    const wRes = await whoami(bad);
   420	    const pRes = await postAssistant(bad);
   421	    expect(wRes.status).toBe(400);
   422	    expect(pRes.status).toBe(400); // POST rejects the same header identically
   423	    const wBody = (await wRes.json()) as { error: { code: string } };
   424	    expect(wBody.error.code).toBe('VALIDATION_FAILED');
   425	  });
   426	
   427	  it('the reserved usr. prefix on X-Ekoa-App-Id -> 400 (same as POST)', async () => {
   428	    const res = await whoami({ 'x-ekoa-app-id': 'usr.owner-1', authorization: `Bearer ${tokens['admin-owner']}` });
   429	    expect(res.status).toBe(400);
   430	  });
   431	
   432	  it('an unknown app id -> 404 { NOT_FOUND } (the SAME existence surface POST already exposes)', async () => {
   433	    const res = await whoami({ 'x-ekoa-app-id': 'no-such-app', authorization: `Bearer ${tokens['admin-owner']}` });
   434	    expect(res.status).toBe(404);
   435	    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
   436	  });
   437	});
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
   164	    // H2 builds no edit-mode machinery / opt-in switch (that is H3): none of the tokens an actual
   165	    // edit-mode implementation would introduce exist yet. (Comments MAY mention "edit mode" as the
   166	    // deferred H3 work; these tokens name the affordance itself, so they won't collide with prose.)
   167	    expect(PANEL).not.toMatch(/setEditMode|editEnabled|isEditing|enterEditMode|edit-mode-toggle/);
   168	    // The invariant is stated in the source so review can pin it.
   169	    expect(PANEL).toContain('detect-then-ask');
   170	    expect(PANEL).toContain('H3');
   171	  });
   172	
   173	  it('detection is zero-token: whoami is a non-LLM GET, never an assistant turn', () => {
   174	    // The detection path must not post to the assistant endpoint or dispatch actions.
   175	    const effect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
   176	    expect(effect).not.toContain('runActions');
   177	    expect(effect).not.toMatch(/method:\s*'POST'/);
   178	    // The zero-token invariant is stated on the detection effect so review can pin it.
   179	    expect(PANEL).toContain('zero-token');
   180	  });
   181	});
   182	
   183	describe('D2/G2 lazy-load wiring', () => {
   184	  it('the app bundle carries only a plain-DOM launcher (no React) that lazy-loads the platform panel-runtime', () => {
   185	    // Since G2 the panel is NOT baked into the app bundle: mount.js renders a launcher
   186	    // with plain DOM and injects the platform asset on interaction/idle. No React here.
   187	    expect(MOUNT).not.toMatch(/from\s+['"]react/);
   188	    expect(MOUNT).not.toContain('createRoot');
   189	    expect(MOUNT).toContain('ekoa-assistant-launcher'); // the launcher it renders
   190	    expect(MOUNT).toContain('/__ekoa/panel-runtime.js'); // the asset it lazy-loads
   191	    expect(MOUNT).toContain('__ekoaAssistantAutoOpen'); // open-intent handoff to the asset
   192	  });
   193	
   194	  it('the panel-runtime entry self-mounts into #ekoa-assistant-root, once, waiting for the node', () => {
   195	    // The three mount guards moved from the old in-bundle mount.js to the ASSET entry:
   196	    // #ekoa-assistant-root is rendered BY App and createRoot().render() commits async,
   197	    // so the node is absent the instant the asset runs. The entry polls (bounded) then
   198	    // gives up quietly (standalone preview), and mounts exactly once per document.
   199	    expect(ENTRY).toContain('ekoa-assistant-root');
   200	    expect(ENTRY).toContain('getElementById');
   201	    expect(ENTRY).toContain('__ekoaAssistantMounted'); // once-guard flag
   202	    expect(ENTRY).toMatch(/createRoot\(node\)\.render/);
   203	    expect(ENTRY).toContain('requestAnimationFrame');
   204	    expect(ENTRY).toContain('MAX_FRAMES');
   205	    expect(ENTRY).toMatch(/frames\s*>=\s*MAX_FRAMES/); // bounded give-up (no infinite spin)
   206	  });
   207	
   208	  it('index.jsx mounts the panel after rendering App (without changing the App render)', () => {
   209	    expect(INDEX).toContain('mountAssistant');
   210	    expect(INDEX).toContain("from './lib/assistant/mount'");
   211	    expect(INDEX).toContain('root.render(<App />)'); // the App render is untouched
   212	    // the mount call comes after the App render
   213	    expect(INDEX.indexOf('mountAssistant()')).toBeGreaterThan(INDEX.indexOf('root.render(<App />)'));
   214	  });
   215	});
   216	
   217	describe('D2 base skill', () => {
   218	  it('teaches that the panel is platform-shipped, not to be rebuilt, and to declare ui_actions', () => {
   219	    expect(SKILL).toContain('platform');
   220	    expect(SKILL).toContain('ui_actions');
   221	    expect(SKILL).toContain('declaring-ui-actions.md'); // cross-reference
   222	    expect(SKILL.match(/\p{Extended_Pictographic}/u)).toBeNull();
   223	  });
   224	});
     1	import { describe, it, expect } from 'vitest';
     2	import {
     3	  AssistantChatRequest,
     4	  AssistantChatResponse,
     5	  AppAssistantWhoamiResponse,
     6	  appAssistantEndpoints,
     7	  ErrorEnvelope,
     8	  ALL_ENDPOINTS,
     9	  ERROR_STATUS,
    10	} from '@ekoa/shared';
    11	
    12	/**
    13	 * operator-run D1 — contract suite for the served-app assistant endpoint (`POST /api/app-assistant`).
    14	 * The descriptor pre-existed; D1 EVOLVES its request/response additively (mode + context on the
    15	 * request; citations + actions + mode on the response). This validates a representative
    16	 * AssistantChatResponse against the shared schema, proves back-compat (the base `{ message }` /
    17	 * `{ reply }` shapes still validate), and checks the CONV-2 error envelope the route emits — the
    18	 * QA-layer-3 "new endpoint ⇒ contract test in the same slice" obligation.
    19	 */
    20	
    21	describe('AssistantChatResponse contract (D1)', () => {
    22	  it('validates a full response (reply + citations + actions + mode)', () => {
    23	    const sample = {
    24	      reply: 'Vou criar o cliente para si. Feito.',
    25	      mode: 'do' as const,
    26	      citations: [{ collection: 'faq', docId: 'd1', title: 'Como criar cliente' }],
    27	      actions: [{ toolName: 'app_action__criar_cliente', input: { nome: 'Ana', ativo: true } }],
    28	    };
    29	    const r = AssistantChatResponse.safeParse(sample);
    30	    expect(r.success).toBe(true);
    31	  });
    32	
    33	  it('back-compat: the base { reply } response still validates (all new fields optional)', () => {
    34	    expect(AssistantChatResponse.safeParse({ reply: 'Olá' }).success).toBe(true);
    35	  });
    36	
    37	  it('rejects a bad mode and a missing reply', () => {
    38	    expect(AssistantChatResponse.safeParse({ reply: 'x', mode: 'sideways' }).success).toBe(false);
    39	    expect(AssistantChatResponse.safeParse({ mode: 'do' }).success).toBe(false);
    40	  });
    41	
    42	  it('an action input must be an object (record), never a scalar', () => {
    43	    expect(AssistantChatResponse.safeParse({ reply: 'x', actions: [{ toolName: 't', input: {} }] }).success).toBe(true);
    44	    expect(AssistantChatResponse.safeParse({ reply: 'x', actions: [{ toolName: 't', input: 'oops' }] }).success).toBe(false);
    45	  });
    46	
    47	  it('an action may carry the server-resolved manifest AppAction (D1 attaches it for C3)', () => {
    48	    const withAction = {
    49	      reply: 'Vou criar o cliente.',
    50	      actions: [{
    51	        toolName: 'app_action__criar_cliente',
    52	        input: { nome: 'Ana' },
    53	        action: { id: 'criar-cliente', kind: 'custom', labelPt: 'Criar cliente', description: 'Cria um cliente', params: [], destructive: false },
    54	      }],
    55	    };
    56	    expect(AssistantChatResponse.safeParse(withAction).success).toBe(true);
    57	    // A malformed embedded action (navigate without a route) is rejected by the AppAction contract.
    58	    const badAction = {
    59	      reply: 'x',
    60	      actions: [{ toolName: 't', input: {}, action: { id: 'ir', kind: 'navigate', labelPt: 'Ir', description: 'x' } }],
    61	    };
    62	    expect(AssistantChatResponse.safeParse(badAction).success).toBe(false);
    63	  });
    64	});
    65	
    66	describe('AssistantChatRequest contract (D1)', () => {
    67	  it('back-compat: the base { message } request still validates', () => {
    68	    expect(AssistantChatRequest.safeParse({ message: 'olá' }).success).toBe(true);
    69	  });
    70	
    71	  it('validates the evolved request (history + context + mode)', () => {
    72	    const req = {
    73	      message: 'Mostra-me a aplicação',
    74	      history: [{ role: 'user' as const, content: 'olá' }, { role: 'assistant' as const, content: 'viva' }],
    75	      context: { route: '/clientes', actionResults: [{ ok: true }] },
    76	      mode: 'show' as const,
    77	    };
    78	    expect(AssistantChatRequest.safeParse(req).success).toBe(true);
    79	  });
    80	
    81	  it('rejects an invalid mode', () => {
    82	    expect(AssistantChatRequest.safeParse({ message: 'x', mode: 'nope' }).success).toBe(false);
    83	  });
    84	});
    85	
    86	describe('appAssistant endpoint descriptor (D1)', () => {
    87	  it('the descriptor is intact and points at the evolved schemas', () => {
    88	    const d = appAssistantEndpoints.assistantChat;
    89	    expect(d.method).toBe('POST');
    90	    expect(d.path).toBe('/api/app-assistant');
    91	    expect(d.auth).toBe('header-scoped');
    92	    // The descriptor's request/response ARE the evolved schemas.
    93	    expect(d.request.safeParse({ message: 'x', mode: 'teach' }).success).toBe(true);
    94	    expect(d.response.safeParse({ reply: 'x', citations: [{ collection: 'c', docId: 'd', title: 't' }] }).success).toBe(true);
    95	  });
    96	
    97	  it('stays accounted for in the shared descriptor census (schema-coverage input)', () => {
    98	    expect(ALL_ENDPOINTS.appAssistant?.assistantChat).toBeTruthy();
    99	  });
   100	});
   101	
   102	describe('AppAssistantWhoamiResponse contract (H2)', () => {
   103	  it('validates BOTH branches: { admin:true } and { admin:false }', () => {
   104	    expect(AppAssistantWhoamiResponse.safeParse({ admin: true }).success).toBe(true);
   105	    expect(AppAssistantWhoamiResponse.safeParse({ admin: false }).success).toBe(true);
   106	  });
   107	
   108	  it('is strict: admin must be a boolean and NOTHING else may ride the wire', () => {
   109	    // A non-boolean admin is rejected...
   110	    expect(AppAssistantWhoamiResponse.safeParse({ admin: 'true' }).success).toBe(false);
   111	    expect(AppAssistantWhoamiResponse.safeParse({}).success).toBe(false);
   112	    // ...and .strict() forbids leaking any identity/org/role/reason field alongside the boolean
   113	    // (the endpoint is fail-closed and oracle-free — the boolean is the entire answer).
   114	    expect(AppAssistantWhoamiResponse.safeParse({ admin: true, orgId: 'org-owner' }).success).toBe(false);
   115	    expect(AppAssistantWhoamiResponse.safeParse({ admin: false, reason: 'wrong-org' }).success).toBe(false);
   116	  });
   117	});
   118	
   119	describe('appAssistant whoami descriptor (H2)', () => {
   120	  it('is an additive GET detection endpoint pointing at the strict boolean schema', () => {
   121	    const d = appAssistantEndpoints.whoami;
   122	    expect(d.method).toBe('GET');
   123	    expect(d.path).toBe('/api/app-assistant/whoami');
   124	    expect(d.auth).toBe('header-scoped'); // app-id scoped; the platform Bearer is optional
   125	    expect('request' in d).toBe(false); // a GET carries no request body
   126	    expect(d.response?.safeParse({ admin: true }).success).toBe(true);
   127	  });
   128	
   129	  it('stays accounted for in the shared descriptor census (schema-coverage input)', () => {
   130	    expect(ALL_ENDPOINTS.appAssistant?.whoami).toBeTruthy();
   131	  });
   132	});
   133	
   134	describe('app-assistant error envelope (D1, CONV-2)', () => {
   135	  it('the route error codes validate as CONV-2 envelopes with the right status', () => {
   136	    for (const code of ['VALIDATION_FAILED', 'NOT_FOUND', 'ACCOUNT_DISABLED', 'BILLING_LOCKED', 'BILLING_BLOCKED', 'INTERNAL'] as const) {
   137	      const body = { error: { code, message: 'msg' } };
   138	      expect(ErrorEnvelope.safeParse(body).success, code).toBe(true);
   139	      expect(typeof ERROR_STATUS[code]).toBe('number');
   140	    }
   141	  });
   142	});

exec
/bin/zsh -lc "sed -n '1,220p' docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md
printf '\\n---DECISION---\\n'
sed -n '1,220p' docs/autothing/runs/20260712-150958-4bb23640/slices/H2/decision-memo.md
printf '\\n---H1---\\n'
sed -n '1,260p' docs/autothing/runs/20260712-150958-4bb23640/slices/H1/exploration-auth-surface.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
# H2 impl-notes - identity/session handoff (whoami detection, detect-then-ask)

Slice H2 of the atomic security block. Built on H1 (commit 49dc5f6): the real `can()` capability
layer + the durable verify chain. DONE-GREEN.

## What was built

### 1. Shared contract (additive) - `shared/src/app-assistant.ts`
- `AppAssistantWhoamiResponse = z.object({ admin: z.boolean() }).strict()`. `.strict()` is
  load-bearing: the answer is a single boolean and NOTHING else - no identity/org/role/reason may
  ride the wire (fail-closed + oracle-free).
- Descriptor entry `appAssistantEndpoints.whoami` (`GET /api/app-assistant/whoami`, `header-scoped`,
  response-only). Additive - `assistantChat` is untouched.

### 2. Detection endpoint - `api/src/apps/app-assistant-route.ts`
- New `GET /app-assistant/whoami` on the existing router, a sibling of `POST /app-assistant`.
- Refactor: the app-id charset/collision check + `resolveApp` + artifact-backed-owner check were
  factored out of `admit()` into a shared `resolveAssistantApp(header)` (a discriminated
  `invalid-id | not-found | ok`). BOTH the POST admission and whoami now go through it, so they
  apply the EXACT same 400 (`VALIDATION_FAILED`, incl. the reserved `usr.` prefix) and 404
  (`NOT_FOUND`) - whoami is provably not a different existence oracle than POST already is.
- Identity: `detectOwnerOrgAdmin(authHeader, ownerOrgId)` extracts the OPTIONAL `Bearer` (same
  regex idiom as `requireAuth`) and verifies it through `verifySseToken` - the EXACT chain
  requireAuth/verifySseToken run (`verifyToken` + `jti` + `isRevoked` + activation-active +
  `tokenEpoch`). No hand-rolled weaker check, no second identity path, no per-app login.
- Decision: pure exported `isOwnerOrgAdmin(claims, ownerOrgId)` - gated by H1's
  `can(claims, 'canEditApps')` (so a `user` role stops at the capability gate), then super-admin
  spans any org and org-admin must match the owner org. Owner org is resolved server-side from the
  owner user record (`users.get`), never from anything the caller supplied.
- The ONLY non-200s are the two app-id header failures above. A missing/invalid/expired/revoked/
  epoch-stale/wrong-org/user token is ALWAYS `200 { admin: false }`. A whoami internal error (store
  blow-up) is a 500, never a 4xx (a 4xx would be an oracle).
- It NEVER grounds, bills, routes, or widens admission: it does not mount the allowance middleware
  and never touches the injected llm deps. `POST /app-assistant` is byte-for-byte unchanged - still
  header-scoped, still never reads the caller JWT for grounding/billing.

### 3. Panel detection - `api/assets/panel-runtime/src/AssistantPanel.jsx`
- `readPlatformToken()` reads `localStorage['ekoa_token']` (the key `web/lib/api/token.ts` uses)
  inside try/catch, swallowing the cross-origin/sandboxed-iframe `SecurityError` to `null`.
- A mount-only, once-guarded (`whoamiDoneRef`) effect calls `GET whoami` ONCE with `X-Ekoa-App-Id`
  and the token as an OPTIONAL `Bearer`, and stores `admin` (default false) in state. It is a cheap
  non-LLM GET - it never issues an assistant turn (zero-token invariant holds).
- DETECT-THEN-ASK: `admin: true` NEVER auto-enables anything. The only surface is a DISCREET,
  inert "Administrador" badge in the header (no onClick, no mode change, no privileged call),
  gated on `admin` so a false result renders nothing. `admin` is SET once (detection) and READ only
  to render the badge. The edit-mode switch + opt-in UX are H3 - not built here. (The badge is
  styled inline via the panel's CSS vars so it needs no edit to the non-reserved AssistantPanel.css.)

## whoami fail-closed matrix (asserted in `tests/apps/app-assistant.test.ts`)

| caller                                   | result            |
|------------------------------------------|-------------------|
| org-admin of the OWNER org               | 200 { admin:true} |
| the artifact owner (org-admin, owner org)| 200 { admin:true} |
| super-admin (any org)                    | 200 { admin:true} |
| org-admin of ANOTHER org                 | 200 { admin:false}|
| plain user of the owner org              | 200 { admin:false}|
| NO token                                 | 200 { admin:false}|
| INVALID token                            | 200 { admin:false}|
| EXPIRED token (would-be admin)           | 200 { admin:false}|
| EPOCH-STALE token (would-be admin)       | 200 { admin:false}|
| malformed X-Ekoa-App-Id                  | 400 (same as POST)|
| reserved `usr.` prefix app-id            | 400               |
| unknown app id                           | 404 NOT_FOUND     |

Route matrix runs over the REAL router (wired with THROWING llm deps - so any accidental
ground/route/bill blows the request up; none does, every case is 200/400/404), the REAL verify
chain (real `login`-minted tokens, in-memory activation, `bumpTokenEpoch` for the stale case,
a directly-signed past-exp token for the expired case) and REAL owner resolution over
mongodb-memory-server. Plus a fast pure `isOwnerOrgAdmin` grid (no I/O).

## Visitor-blindness exception justification

The served-app assistant plane is visitor-blind: `POST /app-assistant` derives org + billee ONLY
from the server-resolved OWNER, never from the anonymous visitor's JWT. whoami is a DECLARED,
DOCUMENTED exception to that blindness, for DETECTION ONLY: it is the one place the plane reads the
caller's platform JWT, and it does so solely to answer "is this viewer an admin of the owner org?".
It never grounds, never bills, never widens admission, and issues no model call. Every privileged
action remains gated server-side by the H1 admission plane with this same JWT; `admin: true` is a
HINT the panel surfaces, not a grant. Exposure honesty (per the decision memo): any same-origin
page can already read `localStorage['ekoa_token']`, so the panel reading it in-page widens nothing;
the mitigations are the pre-existing epoch/revocation machinery + H1 server-side gating. Recorded
so H6's codex pass sees it stated.

## Reserved-path compliance

All changes are within the reserved set EXCEPT two necessary, flagged touches:
- `api/tests/contract/schema-coverage.test.ts`: adding the `whoami` descriptor grows
  `allEndpointsFlat()` by one, and this gate is DESIGNED to fail unless the endpoint is accounted
  for. Added `'appAssistant.whoami'` to COVERED (keeps `EXPECTED_PENDING_COUNT` at 49 -
  `assistantChat` stays PENDING exactly as before). Flagged to the lead before editing.
- FIXED-12 diagram flag (NOT edited - out of reserved set, shared file): the whoami detection
  exception affects `docs/diagrams/10-privacy-boundaries.excalidraw` node `d1-text` (which states
  the assistant plane derives org/billee "NEVER from the anonymous visitor"). A one-line note that
  `GET .../whoami` is a detection-only exception (reads the JWT, never grounds/bills/widens) should
  be added there. Flagged to the lead with the exact node + proposed text rather than hand-editing
  a shared .excalidraw.

No commits, no stack ops - working tree only.

## Verification (all green, locally)

- `cd api && npx tsc --noEmit -p tsconfig.json` -> 0
- `npx tsc --noEmit -p tsconfig.test.json` -> 0
- `npx tsc --noEmit -p shared/tsconfig.json` -> 0; `web` tsc -> 0 (additive shared change)
- eslint touched .ts files -> 0 errors, 0 warnings
- `npx vitest run tests/apps tests/contract` -> 56 files, 536 tests, all pass
- `node assets/panel-runtime/build.mjs` -> built (panel compiles)
- repo root `npm run gate:chokepoint` -> clean

---DECISION---
# H2 decision memo - identity/session handoff into served apps (decide-and-document)

Per BRIEF Phase 9b: explore -> decide per topology -> document; detect-then-ask stands regardless.
Exploration facts: slices/H1/exploration-auth-surface.md §3 (no re-exploration needed).

## Topology (fact base)

- **Deployment**: dashboard (web), API, and served apps share ONE origin; apps are subpaths
  `/apps/<idOrSlug>/`. The platform JWT lives in `localStorage['ekoa_token']` - same-origin pages
  (INCLUDING served apps) can read the SAME localStorage.
- **Dev**: the preview iframe loads apps from the api proxy origin (:4111) while the dashboard is
  :3000 - CROSS-origin; the token is NOT visible to the app page there.
- Served-app END-USER identity (app-sso cookies) is a separate, per-app system - untouched by H2.
- The platform admission plane (H1) already enforces capability + ownership server-side on every
  edit vector (`POST /jobs` follow-up requires the caller JWT + canEditApps + writability).

## Options weighed

1. **Same-origin localStorage read by the PANEL (platform asset) + server-side detection** - the
   panel attaches the platform JWT (when present) to ONE dedicated detection endpoint; everything
   privileged is enforced server-side by the H1 gates.
2. postMessage probe to the opener/parent dashboard - only works when opened from Ekoa; adds a
   cross-window protocol; still needs server-side enforcement anyway.
3. Signed short-lived token appended on open-from-Ekoa - a second token class to mint, scope,
   expire and audit; duplicates what the JWT+server gates already give; helps only the dev
   cross-origin case, which graceful degradation covers.
4. Shared httpOnly cookie - changes the platform session model (localStorage-only today) for one
   feature; cookie would ride EVERY same-origin request including app asset fetches; oversized.

## DECISION: option 1 + fail-closed degradation

- **Detection**: the panel calls `GET /api/app-assistant/whoami` with `X-Ekoa-App-Id` +
  `Authorization: Bearer <token from localStorage, if readable>`. The endpoint - a deliberate,
  documented EXCEPTION to the assistant plane's visitor-blindness, for DETECTION ONLY (it never
  grounds, never bills, never widens admission) - verifies the JWT through the standard
  requireAuth-equivalent checks and answers `{ admin: boolean }`: true iff the verified caller is
  `org-admin`/`super-admin` of the artifact OWNER's org AND `can('canEditApps')`. Anything else
  (no token, cross-origin dev, invalid/expired, wrong org, user role) -> `{ admin: false }` -
  fail-closed, indistinguishable, no probing signal (no 403s that leak whether the app exists).
- **Detect-then-ask (binding)**: `admin: true` NEVER auto-enables anything. The panel renders a
  discreet affordance; edit powers require an explicit per-session opt-in (H3 owns that UX and the
  mode switch). On a shared machine, an abandoned admin session degrades to a visible affordance
  only - every actual edit action re-hits the H1 server gates with the same JWT.
- **Cross-origin dev preview**: token unreadable -> detection false -> no affordance. Acceptable:
  the dev preview is not the admin editing surface; opening the app directly on the api origin
  (or in deployment) detects normally. No magic-link in v1 (YAGNI; the queue path H4 covers
  "I cannot edit here" flows).
- **Exposure honesty**: any same-origin page - including generated app code - can ALREADY read
  `localStorage['ekoa_token']`. H2 does not widen that exposure (the panel reading it in-page adds
  nothing an app script could not do); the mitigations are the pre-existing epoch/revocation
  machinery + H1 server-side gating on every privileged action + this being ledgered for the
  platform-hardening backlog (a move to httpOnly platform sessions is a post-run decision,
  orthogonal to H). Recorded so H6's codex pass sees it stated, not hidden.
- **Reuse Cortex identity; no per-app login for admins** (brief binding) - satisfied: the ONLY
  identity involved is the platform JWT, verified by the platform verifier.

## H2 implementation scope (after H1 lands)

1. `GET /api/app-assistant/whoami` on the app-assistant router: X-Ekoa-App-Id charset checks
   reused; Bearer optional; standard token verification incl. revocation/epoch/activation; owner
   resolution reused from admit(); response `{ admin: boolean }` (shared zod contract + contract
   test; never 4xx on missing/invalid token - always 200 `{ admin: false }` unless the app id
   itself is invalid).
2. Panel: on mount (lazy asset), read the token (try/catch - cross-origin/sandbox safe), call
   whoami once, expose `admin` on panel state. NO UX beyond a state flag + a minimal discreet
   indicator; H3 consumes it.
3. Tests: unit (endpoint matrix: no token / invalid / expired-epoch / wrong-org admin / same-org
   user / same-org org-admin / super-admin), contract (200 shape both ways), panel state test.
   Live probe (lead): curl whoami with and without a real admin token on the dev stack.

---H1---
# H1 — Identity / Roles / Session surface map (facts for the security block)

Scope: the entire authn/authz/session surface of ekoa-code, so the H1 security block
(roles + capability layer, identity handoff, edit gating) can be designed on facts.
Every claim is `file:line`. Conclusions only.

---

## 0. TL;DR for the security-block designer

- **Three roles exist and are real in the data model + JWT**: `super-admin | org-admin | builder`
  (`shared/src/common.ts:33`). `builder` IS surfaced in the web UI as PT `Construtor` /
  EN `Builder` (`web/locales/pt.ts:371`, `web/locales/en.ts:370`).
- **`can()` is a permissive stub with ZERO call sites.** Nothing in `api/` or `web/` calls it.
  Every real authz decision today is an inline `role` string comparison via `requireRole(...)`
  or hand-written owner/org checks. The capability layer is greenfield.
- **Auth-class enforcement is per-router and MANUAL.** The descriptor `auth` field
  (`public|user|org-admin|super-admin`) is a contract *declaration* (client + contract tests);
  server.ts does NOT auto-enforce it. Each router calls `requireAuth` / `requireRole` itself.
  A new central capability gate must be wired route-by-route (or via a new descriptor-driven
  middleware) — there is no single chokepoint to patch.
- **No platform identity ever reaches a served app.** Served apps are same-origin subpaths
  `/apps/<idOrSlug>/*`. The served-app assistant is header-scoped (`X-Ekoa-App-Id`), never reads
  the caller JWT (confirmed below). App-level end-user identity is a *separate* per-app SSO/cookie
  system, disjoint from the platform JWT.
- **KEY GAP for edit-gating: `POST /jobs` follow-up builds have NO artifact-ownership check.**
  Any authenticated user can drive a code-writing agent against ANY artifact by id
  (cross-user/cross-tenant IDOR). Details in §4/§5.
- **No formal migration framework.** Schema/data migrations are idempotent boot steps in
  `bootState()` (`api/src/server.ts:675`).
- **No persistent notification/inbox/queue** for org-admins. Only: append-only `activity_logs`
  (registo, metadata-only) + ephemeral per-user SSE notifications. A request-changes queue is
  greenfield (would need a new store).

---

## 1. ROLES TODAY

### 1.1 Role values
- Enum: `Role = z.enum(['super-admin', 'org-admin', 'builder'])` — `shared/src/common.ts:33` ("the
  three-role model (Amendment 2)").
- On the user record: `UserDoc.role: 'super-admin' | 'org-admin' | 'builder'`
  — `api/src/data/stores.ts:13`.
- On the wire: `AuthUser.role: Role` — `shared/src/auth.ts:12-22` (`.strict()` response shape;
  passwordHash never leaves).
- In the JWT: `JwtClaims.role: Role` — `api/src/auth/jwt.ts:11-21`.
- The per-request actor: `interface Actor { userId; orgId; role }` — `shared/src/common.ts:39-43`.

### 1.2 Is there a `builder` role? YES, but no capability semantics
- Data model + JWT + zod: yes (above).
- Web UI: yes. `web/app/(dashboard)/users/page.tsx` role toggle offers exactly
  `"org-admin" | "builder"` (`:88`, `:95-97`, `:151`, `:207-217`); super-admin is shown
  read-only, never a toggle target (`:77-78`).
- PT-PT string: `roleBuilder: 'Construtor'` (`web/locales/pt.ts:371`), EN `'Builder'`
  (`web/locales/en.ts:370`), `roleAdmin` for org-admin. Badge render:
  `users/page.tsx:70-73`.
- **`builder` carries NO enforced privilege difference today.** It is the default/base role;
  the only thing that distinguishes roles operationally is `requireRole` (super-admin/org-admin
  gates) — a `builder` is simply "not an admin". No code branches on `role === 'builder'`.

### 1.3 What admin checks look like today (role string comparisons)
All authorization is inline role comparison — there is no policy engine. Two mechanisms:

- **`requireRole(...roles)` middleware** — `api/src/auth/middleware.ts:76-83`:
  `if (!req.user || !roles.includes(req.user.role)) fail(FORBIDDEN)`. Call sites:
  - `api/src/routes/users.ts` — list `requireRole('super-admin','org-admin')` (`:17`),
    create/delete/reset `requireRole('super-admin')` (`:21,:40,:48`), patch
    `requireRole('super-admin','org-admin')` (`:29`).
  - `api/src/routes/registo.ts:22` — `requireRole('org-admin','super-admin')`.
  - `api/src/routes/artifacts.ts:136` — `PUT :id/featured` `requireRole('super-admin')`.
  - (org router, orgs router, billing/usage similar — same pattern.)
- **Hand-written role/org checks inside services/handlers** where a static class can't express it:
  - `logoutOther` (`api/src/auth/service.ts:111-123`): `if (caller.role !== 'super-admin' &&
    caller.role !== 'org-admin') return 'forbidden'; ... if (org-admin && target.orgId !==
    caller.orgId) return 'not-found'`.
  - `patchUser` cross-org guard in the route: `if (a.role === 'org-admin' && target.orgId !==
    a.orgId) notFound; if (a.role === 'org-admin' && body.role === 'super-admin') FORBIDDEN`
    (`api/src/routes/users.ts:35-36`).
  - `listUsers`: super-admin sees all, else scoped to `orgId` (`api/src/auth/users-service.ts:15`).
  - Job/chat read: `job.userId !== actor.userId && actor.role !== 'super-admin'` → 404
    (`api/src/routes/jobs.ts:63`, `api/src/routes/chat.ts:56`).

### 1.4 org-admin vs super-admin, and the org model
- **super-admin = platform-wide**; **org-admin = confined to its own `orgId`**. This is the
  entire tenancy story. (`api/src/auth/users-service.ts:1-5` header; enforced as in §1.3.)
- **Org membership is a reverse index, not a list.** `UserDoc.orgId` is a single string
  (`stores.ts:16`) — a user belongs to exactly one org. `OrgDoc` has NO owner/members/adminUserId
  field (`stores.ts:19-28`; `shared/src/org.ts` OrgCreate/Update carry only name/displayName/
  branding/settings). "Members of org X" = `users.find({ orgId: X })`
  (`users-service.ts:15`). There is **no org-ownership concept** distinct from "an org-admin whose
  `orgId` is this org". No super-admin-per-org.
- First-boot seeding: `seedAdmin` creates ONE `Founder` org + a `super-admin`
  (`api/src/auth/service.ts:57-73`), gated by env `EKOA_ADMIN_USERNAME/PASSWORD`
  (`server.ts:690-692`).
- User creation (`createUser`, `users-service.ts:19-41`): super-admin only; a new user without an
  explicit `orgId` gets a **fresh org auto-created named after the username** (`:24-26`) — i.e. a
  super-admin can mint org-isolated tenants; an org-admin creates users but the route path only
  lets super-admin POST (`users.ts:21`). New users are `passwordChangeRequired: true`.

---

## 2. THE `can()` STUB

### 2.1 Capability vocabulary — `shared/src/capabilities.ts`
```
Capability = z.enum(['canBuildApps','canEditApps','canCreateArtifacts','canUseChat'])
```
(`shared/src/capabilities.ts:10-16`). NAMES ONLY — "no role mapping, no enforcement, no
authorization semantics" (file header `:1-7`). Exported via `shared/src/index.ts:58`.

### 2.2 The stub — `api/src/auth/capabilities.ts`
```ts
export function can(_actor: Pick<JwtClaims,'role'> | null | undefined,
                    _capability: Capability): boolean {
  return true; // PERMISSIVE-STUB — real mapping lands in H1
}
```
(`api/src/auth/capabilities.ts:14-19`). Marked `PERMISSIVE-STUB`; header says the H5 security
assertions **grep this file for the `PERMISSIVE-STUB` marker and fail if it survives the security
block** (`:9-10`). Signature takes `Pick<JwtClaims,'role'>` — i.e. it is meant to be a pure
role→capability map (no org/resource context in the current shape).

### 2.3 Call sites of `can(...)`
**NONE.** Exhaustive grep of `api/` and `web/` for `can(` (excluding cancel/scan/cannot/canvas):
the only match is the definition itself (`api/src/auth/capabilities.ts:14`). The capability seam
is defined + unit-tested but **wired to nothing**. Wiring `can()` into the real gate points is
part of the H1 work, not a retrofit over existing callers.

### 2.4 Pinned test — `api/tests/auth/capabilities-stub.test.ts`
- Asserts `can()` returns `true` for **every** capability and **any** actor
  (`{role:'builder'}`, `null`, `undefined`) — `:13-19`.
- Asserts the vocabulary is exactly `['canBuildApps','canEditApps','canCreateArtifacts',
  'canUseChat']` in that order — `:22-28`.
- Header (`:1-7`): this test is DELIBERATELY permissive; the H5 capability-matrix suite is meant
  to **REPLACE** it, and "if this test still exists after the security block lands, that is a
  defect." → The security block must delete/replace this test and flip the stub.

---

## 3. SESSION / IDENTITY

### 3.1 Login → JWT
- Route: `POST /api/v1/auth/login` (`auth:'public'`) — `shared/src/auth.ts:91-98`;
  handler `api/src/routes/auth.ts:17-30` → `login()` `api/src/auth/service.ts:75-97`.
- Password verify (`verifyPassword`), deactivated accounts blocked (403 ACCOUNT_DISABLED),
  billing-lock does NOT block login (refused per-request instead).
- **JWT claims**: `{ sub, role, scope:'user', orgId, username, jti, iat }`
  (`service.ts:89-91`; interface `api/src/auth/jwt.ts:10-21`). Single mint point `signToken`
  (`jwt.ts:31-39`). `jti` ALWAYS present (revocation key, P-03). `iat` pinned to
  `max(now, tokenEpoch)` at login (`mintIat`, `service.ts:51-54`).
- **Expiry**: 24h default, **30d with `rememberMe`** (`jwt.ts:35`). `LoginResponse` returns
  `{ token, user, passwordChangeRequired, expiresIn }` (`shared/src/auth.ts:32-38`).
- Other auth endpoints (`shared/src/auth.ts:91-149`): `me` (user), `refresh` (user, re-signs same
  claims + fresh jti, old token lives to its own expiry — `auth.ts:39-46`), `logout`
  (user; `{userId}` admin variant enforced in service, super-admin anywhere / org-admin own-org),
  `password` (user, self change), device flow `device`/`device/poll` (public) + `device/approve`
  (user).

### 3.2 `verifyToken` + the admission plane — `api/src/auth/middleware.ts`
- `verifyToken(token)` — `api/src/auth/jwt.ts:51-61`. HS256 pinned (no alg downgrade). **Rejects
  bridge tokens** (`aud:ekoa-bridge` / `pairingId` / `connectionId`) — token-class separation.
- `requireAuth` middleware (`middleware.ts:22-55`): Bearer parse → `verifyToken` → require `jti`
  → `isRevoked(jti)` → activation lookup (`getActivation(sub)`, fail-CLOSED on miss as
  UNAUTHENTICATED) → `active` (403 ACCOUNT_DISABLED) → **token-epoch check** (`iat < tokenEpoch`
  ⇒ 401; how role-change/deactivation revoke all outstanding tokens) → billing lock (402).
- `requireRole(...roles)` — `middleware.ts:76-83` (see §1.3).
- Activation cache = in-memory write-through map `api/src/data/activation.ts` (`active`,
  `billingLocked`, `tokenEpoch`). Boot-loaded from users store (`server.ts:677-678`, but note it
  loads only `{active}` — `tokenEpoch` defaults to 0 at boot). Sound under single-process
  (FIXED-8). Role change bumps `tokenEpoch` (`users-service.ts:53-59`), as does deactivation /
  password change / admin reset / admin logout (`service.ts`).

### 3.3 How the WEB app stores/attaches the token
- **Token**: `localStorage['ekoa_token']`, sole accessor `web/lib/api/token.ts` (`TOKEN_KEY`
  `:13`; `getToken/setToken/clearToken` `:24-39`). Cross-tab sync via `storage` event
  (`:51-55`).
- **Attach**: `web/lib/api/core.ts:203-206` — `if (token && descriptor.auth !== 'public')
  headers['Authorization'] = 'Bearer ' + token`. A 401 on a non-public route triggers
  `handleUnauthorized()` which clears `localStorage['ekoa_auth']` (the separate auth-state store,
  `AUTH_STATE_KEY` `core.ts:22,:142`).
- **No httpOnly cookie for the platform session.** The platform JWT lives in localStorage only.
  (The only cookies in the system are the per-app SSO cookies, §3.5.)

### 3.4 SERVED APPS — origin, and does any identity reach them?
- **Origin/path**: served apps are same-origin subpaths of the API process. Mounted
  `app.use('/', servingRouter({ verifyToken }))` (`server.ts:664`); URL shape `/apps/<idOrSlug>/`
  (e.g. `appUrl = '/apps/${artifactId}/'`, `build-mechanics.ts:212`; PDF render hits
  `${origin}/apps/${id}/`, `artifacts.ts:276`). So the dashboard (web), the API, and served apps
  are all the **same origin** in a deployment (the web dev-proxy fronts them locally).
- **The served-app assistant is header-scoped and NEVER reads the caller JWT** — CONFIRMED.
  `POST /api/app-assistant`, `api/src/apps/app-assistant-route.ts`. Admission (`admit`, `:70-113`)
  reads ONLY `X-Ekoa-App-Id` (`:71`), charset-checked via `collectionName` and rejecting the
  reserved `usr.` shared-namespace prefix (`:72-79`). It resolves the artifact → **owner**, gates
  on the **owner's** activation/billing (`:89-98`), grounds under the **owner's org resolved
  server-side from the owner user record, never the visitor body** (`:100-102`, and header
  comment `:15-17`), and **bills the owner** (`allowanceMiddleware(... owner.userId)`, `:124`).
  There is no `Authorization` header read, no `req.user`, no visitor identity anywhere in this
  file. Mounted `app.use('/api', appAssistantRouter())` (`server.ts:611`).

### 3.5 Cookies (httpOnly? domain?) — per-app SSO only
- The ONLY cookies are per served-app end-user sessions: `api/src/integrations/app-sso.ts`.
  Cookie name `ekoa_app_sso_<appId>` (`:237,:247-250`), **`HttpOnly`, `Path=/api/app-sso`**,
  `SameSite=Lax` (dev) or `Secure; SameSite=None; Partitioned` CHIPS (prod cross-site iframe)
  (`buildSessionCookie` `:272-275`). Isolation is by **name + a server-side appId check**, never
  by path (`:245-246`). No `Domain=` attribute set.
- This is **served-app end-user identity** (the app's own users, stored in the app's app-data
  collection), completely disjoint from the platform builder identity. Two sign-in modes:
  Microsoft SSO (`validateIdToken`, RS256 + per-tenant JWKS + nonce, `:179-231`) and
  username/password against an app-data collection (`/login`, bcrypt, `:376-408`). The app JS
  never sees the token — "identity comes only [from] the per-app cookie" (`:9`). Stores:
  `appSessions` (`app_sessions`), `appSsoPending` (`app_sso_pending`) — `stores.ts:94-95`.
  Router mounted `app.use('/api/app-sso', appSsoRouter(...))` (`server.ts:521`).

### 3.6 `?token=` SSE / query patterns
- `EventSource` cannot set headers (CONV-1), so the four SSE streams authenticate via `?token=`
  through `verifySseToken(token)` — `middleware.ts:59-73` (same verify + revocation + activation +
  epoch checks as `requireAuth`, returns `{ok,claims}` or `{ok:false,status,code}`).
- The four SSE endpoints + their per-stream ownership guards:
  - `GET /api/v1/jobs/:id/events` — `jobs.ts:18-31`; ownership: `job.userId !== claims.sub` ⇒ 403
    (`:26`).
  - `GET /api/v1/chat/runs/:id/events` — `chat.ts:19-29`; `entry.ownerUserId !== claims.sub` ⇒
    403 (`:24`).
  - `GET /api/v1/notifications/events` — `notifications.ts:13-18`; keyed by `claims.sub` (own
    channel only).
  - (Bridge/automation streams follow the same `?token=` pattern.)
- Other `verifyToken` query consumers injected at mount: `build` link router (`server.ts:661`),
  `m365` proxy (`:514`), serving router (`:664`).

---

## 4. BUILD-REQUEST GATE POINTS

### 4.1 Where `POST /jobs` authorizes today
- `api/src/routes/jobs.ts`: `r.use(requireAuth)` (`:33`) then `r.post('/')` (`:35-58`). The ONLY
  gate is `requireAuth` — **any authenticated user, any role (including `builder`), may create a
  build job.** No `requireRole`, no `can('canBuildApps')`, no per-request capability check.
- The route derives `actor = actorOf(req)` and calls `handleBuildCreate({ actor, username,
  sessionId, description, ..., artifactId?, ... })` (`:39-53`).
- Billing is the only downstream refusal: `checkAllowance(actor.userId)` inside the executor
  (`build.ts:301-312`, BILLING_BLOCKED). That is a quota gate, not a permission gate.
- → **This is the primary insertion point for `can('canBuildApps')`** (first build) and
  `can('canEditApps')` (follow-up). Today there is nothing here.

### 4.2 Where the CHAT plane could refuse a build (in-chat build intent)
- Build intent is detected by fast classifiers in `api/src/agents/guided-build.ts`:
  `detectBuildIntent` (`:52-65`), `detectIntegrationNeeds` (`:68-81`), `selectBaseTemplate`
  (`:84-96`), and the in-build `classifyInBuildIntent` (`:34-49`, outcomes
  `modification|integration-build|question`).
- The chat run itself (`POST /api/v1/chat/runs`, `chat.ts:33-50`) is gated by `requireAuth` only.
  When chat decides to build, it emits a delegation marker parsed by `api/src/agents/markers.ts`
  (`MarkerFindings.build` `:30-31`) and the client then issues `POST /jobs`. So **the chat plane
  has no build-refusal today** — a capability refusal would live either (a) at `POST /jobs` (§4.1,
  the real chokepoint), or (b) as a pre-emptive suppression of the build-intent path in chat
  (marker handling / guided-build), but the authoritative gate is `POST /jobs`.

### 4.3 Artifacts/apps ownership model
- `ArtifactDoc` (`api/src/apps/artifacts-service.ts:12-23`): `userId` (owner), `orgId` (tenant),
  `visibility: 'private' | 'org'`, `featured?`, `shareable?`, `data?` bag. Wire schema
  `shared/src/artifacts.ts:13-31` (`userId`, `orgId`, `visibility` required; `.passthrough()`).
- **Ownership = `userId` + `orgId` + visibility.** Enforced by owner-visibility scoping, two

web search: 
web search: 
codex
I’m narrowing the remaining review to two things: whether the tests miss the reachable failure modes, and whether the refactor altered POST owner/org resolution in any subtle way.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/tests/apps/app-assistant.test.ts | sed -n '350,560p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   350	  const bearer = (u: string) => ({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${tokens[u]}` });
   351	
   352	  it('an org-admin of the OWNER org -> 200 { admin:true }', async () => {
   353	    const res = await whoami(bearer('admin-owner'));
   354	    expect(res.status).toBe(200);
   355	    const body = await res.json();
   356	    expect(AppAssistantWhoamiResponse.safeParse(body).success).toBe(true);
   357	    expect(body).toEqual({ admin: true });
   358	  });
   359	
   360	  it('the artifact owner (org-admin of the owner org) -> 200 { admin:true }', async () => {
   361	    const res = await whoami(bearer('owner-1'));
   362	    expect(res.status).toBe(200);
   363	    expect(await res.json()).toEqual({ admin: true });
   364	  });
   365	
   366	  it('a super-admin (any org) -> 200 { admin:true }', async () => {
   367	    const res = await whoami(bearer('super-1'));
   368	    expect(res.status).toBe(200);
   369	    expect(await res.json()).toEqual({ admin: true });
   370	  });
   371	
   372	  it('an org-admin of ANOTHER org -> 200 { admin:false } (never 403 — no cross-org oracle)', async () => {
   373	    const res = await whoami(bearer('admin-other'));
   374	    expect(res.status).toBe(200);
   375	    expect(await res.json()).toEqual({ admin: false });
   376	  });
   377	
   378	  it('a plain user of the owner org -> 200 { admin:false } (H1 capability gate)', async () => {
   379	    const res = await whoami(bearer('user-owner'));
   380	    expect(res.status).toBe(200);
   381	    expect(await res.json()).toEqual({ admin: false });
   382	  });
   383	
   384	  it('NO token -> 200 { admin:false } (never a 401 — token absence is not an oracle)', async () => {
   385	    const res = await whoami({ 'x-ekoa-app-id': APP_ID });
   386	    expect(res.status).toBe(200);
   387	    expect(await res.json()).toEqual({ admin: false });
   388	  });
   389	
   390	  it('an INVALID token -> 200 { admin:false } (never a 401)', async () => {
   391	    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: 'Bearer not-a-jwt' });
   392	    expect(res.status).toBe(200);
   393	    expect(await res.json()).toEqual({ admin: false });
   394	  });
   395	
   396	  it('an EXPIRED token (would-be admin) -> 200 { admin:false }', async () => {
   397	    // A structurally-admin token (org-admin of the owner org) but already expired: the verify
   398	    // chain rejects it at verifyToken, so detection is false — expiry alone denies.
   399	    const expired = jwt.sign(
   400	      { sub: 'owner-1', role: 'org-admin', scope: 'user', orgId: 'org-owner', username: 'owner-1', jti: 'expired.1' },
   401	      's',
   402	      { expiresIn: -10 },
   403	    );
   404	    const res = await whoami({ 'x-ekoa-app-id': APP_ID, authorization: `Bearer ${expired}` });
   405	    expect(res.status).toBe(200);
   406	    expect(await res.json()).toEqual({ admin: false });
   407	  });
   408	
   409	  it('an EPOCH-STALE token (would-be admin) -> 200 { admin:false }', async () => {
   410	    // stale-admin is an org-admin of the owner org; its token predates the epoch bump, so the
   411	    // tokenEpoch leg of the chain rejects it — a demoted/rotated session cannot detect as admin.
   412	    const res = await whoami(bearer('stale-admin'));
   413	    expect(res.status).toBe(200);
   414	    expect(await res.json()).toEqual({ admin: false });
   415	  });
   416	
   417	  it('a malformed X-Ekoa-App-Id -> 400 — the SAME status POST gives (charset check reused)', async () => {
   418	    const bad = { 'x-ekoa-app-id': 'bad app!', authorization: `Bearer ${tokens['admin-owner']}` };
   419	    const wRes = await whoami(bad);
   420	    const pRes = await postAssistant(bad);
   421	    expect(wRes.status).toBe(400);
   422	    expect(pRes.status).toBe(400); // POST rejects the same header identically
   423	    const wBody = (await wRes.json()) as { error: { code: string } };
   424	    expect(wBody.error.code).toBe('VALIDATION_FAILED');
   425	  });
   426	
   427	  it('the reserved usr. prefix on X-Ekoa-App-Id -> 400 (same as POST)', async () => {
   428	    const res = await whoami({ 'x-ekoa-app-id': 'usr.owner-1', authorization: `Bearer ${tokens['admin-owner']}` });
   429	    expect(res.status).toBe(400);
   430	  });
   431	
   432	  it('an unknown app id -> 404 { NOT_FOUND } (the SAME existence surface POST already exposes)', async () => {
   433	    const res = await whoami({ 'x-ekoa-app-id': 'no-such-app', authorization: `Bearer ${tokens['admin-owner']}` });
   434	    expect(res.status).toBe(404);
   435	    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
   436	  });
   437	});

exec
/bin/zsh -lc "nl -ba api/src/auth/revocation.ts | sed -n '1,220p'
nl -ba api/src/apps/registry.ts | sed -n '1,240p'
nl -ba api/src/auth/capabilities.ts | sed -n '1,200p'
rg -n \"role === 'builder'|role: 'builder'|canEditApps|requireAuth\\(|verifySseToken\\(\" api/src web -g '"'!node_modules'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
     1	/**
     2	 * Server-side token revocation set (P-03, ch03 §3.2, ch09 §9.6). An in-memory map (jti →
     3	 * expiry) backed by the persisted `revoked_tokens` collection: loaded at boot, checked by
     4	 * the auth middleware on every request (O(1)), self-pruning on token expiry (both in the
     5	 * in-memory map on access/sweep AND the persisted rows via the retention sweep). Correct
     6	 * under FIXED-8 (single process). A deactivation pushes the user's tokens here in the same
     7	 * operation.
     8	 */
     9	import { revokedTokens } from '../data/stores.js';
    10	
    11	/** jti → epoch-seconds expiry. Pruning on expiry bounds memory (no unbounded growth). */
    12	const set = new Map<string, number>();
    13	
    14	/** Boot-load unexpired revoked tokens into the in-memory map. */
    15	export async function loadRevocations(nowSec: number): Promise<void> {
    16	  set.clear();
    17	  const rows = await revokedTokens.find({});
    18	  for (const r of rows) {
    19	    const exp = r.expiresAt as number;
    20	    if (exp > nowSec) set.set(r._id, exp);
    21	  }
    22	}
    23	
    24	/** Is this jti revoked (and not yet expired)? Expired entries are pruned lazily on access. */
    25	export function isRevoked(jti: string, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
    26	  const exp = set.get(jti);
    27	  if (exp === undefined) return false;
    28	  if (exp <= nowSec) {
    29	    set.delete(jti); // lazy prune — an expired token is already rejected by JWT exp anyway
    30	    return false;
    31	  }
    32	  return true;
    33	}
    34	
    35	/** Revoke a token: add to the map AND persist (survives restart via the collection). */
    36	export async function revoke(jti: string, userId: string, expiresAtSec: number, nowMs: number): Promise<void> {
    37	  set.set(jti, expiresAtSec);
    38	  await revokedTokens.insert({ _id: jti, userId, revokedAt: new Date(nowMs).toISOString(), expiresAt: expiresAtSec });
    39	}
    40	
    41	/** Sweep expired entries from the in-memory map and delete expired persisted rows (P-09). */
    42	export async function pruneExpired(nowSec: number): Promise<number> {
    43	  let n = 0;
    44	  for (const [jti, exp] of set) {
    45	    if (exp <= nowSec) {
    46	      set.delete(jti);
    47	      n++;
    48	    }
    49	  }
    50	  await revokedTokens.deleteMany({ expiresAt: { $lte: nowSec } });
    51	  return n;
    52	}
    53	
    54	export function __revocationSize(): number {
    55	  return set.size;
    56	}
    57	
    58	export function __resetRevocationsForTests(): void {
    59	  set.clear();
    60	}
     1	/**
     2	 * App registry (ch07, ch04 §4.2.6). Resolves a served-app scope from the `X-Ekoa-App-Id`
     3	 * header (slug OR canonical id; slug resolved server-side to the canonical id). Holds the
     4	 * per-app compiled collection rules (from the manifest). In-memory (FIXED-8) + backed by the
     5	 * `artifacts`/`slugs` stores. A client-supplied id starting with `usr.` is rejected upstream.
     6	 */
     7	import { artifacts, slugs } from '../data/stores.js';
     8	import type { CollectionsBlock } from '../data/collections-engine.js';
     9	import { appRegistry } from './app-registry.js';
    10	
    11	export interface ResolvedApp {
    12	  appId: string; // canonical artifact id (or the registry id for registry-only apps)
    13	  ownerUserId: string;
    14	  sharedData: boolean;
    15	  /** True when a persisted artifact record backs the app. False for REGISTRY-ONLY
    16	   *  apps (the dev-serve surface, hard-off in production): they have no artifact
    17	   *  owner, so the Amendment 2 owner-activation admission has no subject and the
    18	   *  callers skip it - carried old-plane behavior for that dev-only surface. */
    19	  artifactBacked: boolean;
    20	  collections?: CollectionsBlock;
    21	}
    22	
    23	/** Resolve a slug-or-id header to a canonical app. Returns null if unknown. */
    24	export async function resolveApp(idOrSlug: string): Promise<ResolvedApp | null> {
    25	  // Try slug first (the slugs reservation collection maps slug → artifactId).
    26	  const slugRow = await slugs.get(idOrSlug);
    27	  const artifactId = slugRow ? (slugRow.artifactId as string) : idOrSlug;
    28	  const art = await artifacts.get(artifactId);
    29	  if (art) {
    30	    return {
    31	      appId: art._id,
    32	      ownerUserId: (art.userId as string) ?? '',
    33	      sharedData: Boolean(art.sharedData),
    34	      artifactBacked: true,
    35	      collections: art.collections as CollectionsBlock | undefined,
    36	    };
    37	  }
    38	  // Registry-only fallback (dev-serve, ch07 §7.4 trigger 6): a running app with no
    39	  // artifact record. The old plane keyed data on the raw header with no artifact
    40	  // requirement; this keeps that surface working without weakening the artifact-
    41	  // backed admission (the flag tells callers which world they are in).
    42	  const reg = appRegistry.getApp(idOrSlug);
    43	  if (!reg) return null;
    44	  return {
    45	    appId: reg.id,
    46	    ownerUserId: reg.userId,
    47	    sharedData: (reg.manifest as { sharedData?: boolean } | null)?.sharedData === true,
    48	    artifactBacked: false,
    49	  };
    50	}
     1	/**
     2	 * The platform capability layer (operator-run H1 security block). The single permission seam:
     3	 * every capability decision in the api goes through `can()`. A PURE role→capability map — it
     4	 * carries NO org/resource context by design (resource + tenancy checks stay separate:
     5	 * `loadWritable`/`loadReadable` in apps/app-paths.ts, the org scoping in the users/registo
     6	 * services). Wiring `can()` into a route does not replace an ownership check; the two compose.
     7	 *
     8	 * Matrix (brief §9a):
     9	 *   super-admin → all four capabilities.
    10	 *   org-admin   → all four capabilities.
    11	 *   user        → canUseChat + canCreateArtifacts ONLY (chat + non-app artifacts; a plain user
    12	 *                 cannot build or change apps — canBuildApps/canEditApps are admin-only).
    13	 *   null/undefined actor → NOTHING (fail closed: an absent actor has no capabilities, so a caller
    14	 *                 that forgets to resolve the actor is denied rather than silently allowed).
    15	 *
    16	 * This REPLACES the pre-security-block permissive stub (whose grep-marker the H5 security
    17	 * assertions fail on): every decision here is a real capability grant, never a blanket allow.
    18	 */
    19	import type { Capability, Role } from '@ekoa/shared';
    20	import type { JwtClaims } from './jwt.js';
    21	
    22	/** The role→capability grid. `Record<Role, …>` so a new Role value is a compile error until it is
    23	 *  given an explicit capability set here (fail-closed by construction — no role defaults to more). */
    24	const CAPABILITIES: Record<Role, ReadonlyArray<Capability>> = {
    25	  'super-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
    26	  'org-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
    27	  user: ['canCreateArtifacts', 'canUseChat'],
    28	};
    29	
    30	/** Does `actor` hold `capability`? Pure role lookup. A null/undefined actor holds nothing, and an
    31	 *  unrecognised role (e.g. a stale value a signature-valid token might still carry) also holds
    32	 *  nothing — both fail closed. Resource/tenancy authorization is a SEPARATE, composed check. */
    33	export function can(
    34	  actor: Pick<JwtClaims, 'role'> | null | undefined,
    35	  capability: Capability,
    36	): boolean {
    37	  if (!actor) return false;
    38	  const granted = CAPABILITIES[actor.role] as ReadonlyArray<Capability> | undefined;
    39	  return granted?.includes(capability) ?? false;
    40	}
api/src/routes/notifications.ts:14:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/artifacts.ts:77:   * snapshot/restore). An in-place edit of a BUILT app additionally requires `canEditApps`
api/src/routes/artifacts.ts:82:    if (isAppArtifact(art) && !can(actorOf(req), 'canEditApps')) {
api/src/routes/artifacts.ts:83:      sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
api/src/routes/artifacts.ts:192:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: in-place app edit → canEditApps
api/src/routes/artifacts.ts:234:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: restoring app code → canEditApps
api/src/routes/artifacts.ts:268:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: writing app source → canEditApps
api/src/routes/artifacts.ts:334:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
api/src/routes/artifacts.ts:359:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
api/src/routes/artifacts.ts:393:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: a backend exists only on an app → canEditApps
api/src/routes/artifacts.ts:403:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: invoking an app's backend → canEditApps
api/src/routes/jobs.ts:21:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/jobs.ts:45:      // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
api/src/routes/jobs.ts:49:      // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
api/src/routes/jobs.ts:51:      if (!can(actor, 'canEditApps')) {
api/src/routes/jobs.ts:52:        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
api/src/routes/jobs.ts:56:      // is an existence oracle — it lets any canEditApps holder probe whether a private app exists
api/src/routes/chat.ts:21:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/automations.ts:75:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/auth/users-service.ts:91: * migrated (0 on a clean/already-migrated store). The `role: 'builder'` filter reads a legacy value
api/src/auth/users-service.ts:95:  const legacy = await users.find({ role: 'builder' });
api/src/auth/capabilities.ts:12: *                 cannot build or change apps — canBuildApps/canEditApps are admin-only).
api/src/auth/capabilities.ts:25:  'super-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
api/src/auth/capabilities.ts:26:  'org-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
api/src/auth/middleware.ts:22:export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
api/src/auth/middleware.ts:59:export function verifySseToken(token: string | undefined): { ok: true; claims: JwtClaims } | { ok: false; status: number; code: ErrorCode } {
api/src/apps/app-assistant-route.ts:84:  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
api/src/apps/app-assistant-route.ts:101:  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws

exec
/bin/zsh -lc 'git show 8b6116a''^:api/src/apps/app-assistant-route.ts | nl -ba | sed -n '"'1,240p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-mQ0d1pAQ' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-kf5iitUy' (errno=Operation not permitted)
     1	/**
     2	 * Served-app assistant plane (operator-run D1) — `POST /api/app-assistant`.
     3	 *
     4	 * The header-scoped (no platform JWT) endpoint the served app's assistant panel calls. It reuses
     5	 * the served-data admission plane: the `X-Ekoa-App-Id` header (charset-checked; the reserved `usr.`
     6	 * shared-namespace prefix rejected) resolves to the artifact, whose OWNER's activation gates the
     7	 * plane (fail-closed). Unlike the byte-compatible key-value app-data plane, the assistant REQUIRES
     8	 * a resolved artifact-backed owner — it has to run under that owner's org and bill that owner — so
     9	 * an unresolved / registry-only (dev-serve) id is a 404 here rather than an anonymous scope.
    10	 *
    11	 * Errors speak the CONV-2 envelope (a new endpoint, not the old app-data string envelope). This
    12	 * module may not import routes/ (ch02 §2.7 lint zone), so it emits the envelope directly off the
    13	 * shared ERROR_STATUS table — the same shape routes/helpers.sendError produces.
    14	 *
    15	 * The org the assistant grounds under and the user it bills come ONLY from the server-resolved
    16	 * owner — never from the anonymous visitor's body. The billing allowance gate is billed to that
    17	 * same owner (the served-app assistant is a named synchronous entry in billing/allowance.ts).
    18	 */
    19	import { Router, type Request, type Response, type RequestHandler, type NextFunction } from 'express';
    20	import {
    21	  AssistantChatRequest,
    22	  AppActionManifest,
    23	  ERROR_STATUS,
    24	  type ErrorCode,
    25	  type AssistantChatResponse,
    26	} from '@ekoa/shared';
    27	import { collectionName } from '../data/collections-engine.js';
    28	import { getActivation } from '../data/activation.js';
    29	import { users, artifacts } from '../data/stores.js';
    30	import { allowanceMiddleware } from '../billing/index.js';
    31	import { runOneShot, decideForTask } from '../llm/index.js';
    32	import { buildGroundingBlock } from '../knowledge/index.js';
    33	import { resolveApp } from './registry.js';
    34	import { runAppAssistant, type AppAssistantDeps } from './app-assistant.js';
    35	
    36	const SHARED_SCOPE_PREFIX = 'usr.';
    37	
    38	/** CONV-2 error envelope off the shared status table (routes/ is off-limits to apps/, ch02 §2.7). */
    39	function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
    40	  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
    41	}
    42	
    43	/** What the admission middleware resolves and stashes for the handler + allowance gate. */
    44	interface AssistantAdmission {
    45	  owner: { userId: string; orgId: string };
    46	  artifactId: string;
    47	  actionManifest: AppActionManifest | null;
    48	}
    49	interface AssistantRequest extends Request {
    50	  ekoaAssistant?: AssistantAdmission;
    51	}
    52	
    53	/** The production deps: the assistant's only model egress is the llm/ chokepoint one-shot; grounding
    54	 *  rides the knowledge/ builder; the tier is floored at WORKHORSE like chat (D1 owner-org grounding
    55	 *  is passed in by the admission middleware, not here). */
    56	const prodDeps: AppAssistantDeps = {
    57	  oneShot: runOneShot,
    58	  ground: buildGroundingBlock,
    59	  decide: (message) => decideForTask(message, undefined, 'WORKHORSE'),
    60	};
    61	
    62	export function appAssistantRouter(deps: AppAssistantDeps = prodDeps): Router {
    63	  const r = Router();
    64	
    65	  /**
    66	   * Served-app admission (mirrors served-data's headerFor + admitOwner, then resolves the owner org
    67	   * and the app's action manifest). On any refusal it writes the CONV-2 envelope and does NOT call
    68	   * next. On success it stashes the resolved subject on the request for the allowance gate + handler.
    69	   */
    70	  const admit = async (req: AssistantRequest, res: Response, next: NextFunction): Promise<void> => {
    71	    const header = req.header('x-ekoa-app-id');
    72	    if (
    73	      typeof header !== 'string' ||
    74	      !collectionName.safeParse(header).success ||
    75	      header.startsWith(SHARED_SCOPE_PREFIX)
    76	    ) {
    77	      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
    78	      return;
    79	    }
    80	
    81	    const app = await resolveApp(header);
    82	    // The assistant needs a real owner subject (org to ground under, user to bill). A dev-serve /
    83	    // registry-only or unresolved id has none — 404 rather than an anonymous scope.
    84	    if (!app || !app.artifactBacked || !app.ownerUserId) {
    85	      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
    86	      return;
    87	    }
    88	
    89	    // Owner-activation gate (Amendment 2 second admission plane; fail-closed CONV-2).
    90	    const activation = getActivation(app.ownerUserId);
    91	    if (!activation || activation.active === false) {
    92	      sendError(res, 'ACCOUNT_DISABLED', 'A conta associada a esta aplicação está bloqueada. Contacte o suporte.');
    93	      return;
    94	    }
    95	    if (activation.billingLocked) {
    96	      sendError(res, 'BILLING_LOCKED', 'A conta associada a esta aplicação tem um problema de faturação.');
    97	      return;
    98	    }
    99	
   100	    // Owner org — resolved server-side from the owner user record, NEVER from the visitor's body.
   101	    const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
   102	    const orgId = owner?.orgId ?? '';
   103	
   104	    // The app's declared action manifest (persisted at activation on the artifact data bag).
   105	    // Validate it against the shared contract; absent/invalid → no operate surface (null).
   106	    const art = await artifacts.get(app.appId);
   107	    const rawManifest = (art?.data as { actionManifest?: unknown } | undefined)?.actionManifest;
   108	    const parsedManifest = rawManifest ? AppActionManifest.safeParse(rawManifest) : null;
   109	    const actionManifest = parsedManifest?.success ? parsedManifest.data : null;
   110	
   111	    req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
   112	    next();
   113	  };
   114	
   115	  /** Async admission errors surface as a CONV-2 500 rather than Express's default HTML. */
   116	  const admitGuarded: RequestHandler = (req, res, next) => {
   117	    void admit(req, res, next).catch((err) => {
   118	      console.error('[app-assistant] admission failed:', err instanceof Error ? err.message : err);
   119	      sendError(res, 'INTERNAL', 'Erro interno.');
   120	    });
   121	  };
   122	
   123	  // Allowance gate billed to the resolved OWNER (mounted AFTER admission populates the subject).
   124	  const allowance = allowanceMiddleware((req) => (req as AssistantRequest).ekoaAssistant?.owner.userId);
   125	
   126	  r.post('/app-assistant', admitGuarded, allowance, async (req: AssistantRequest, res) => {
   127	    const admission = req.ekoaAssistant;
   128	    if (!admission) {
   129	      sendError(res, 'INTERNAL', 'Erro interno.'); // unreachable: admit ran first
   130	      return;
   131	    }
   132	
   133	    const parsed = AssistantChatRequest.safeParse(req.body ?? {});
   134	    if (!parsed.success) {
   135	      sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
   136	      return;
   137	    }
   138	    const body = parsed.data;
   139	
   140	    try {
   141	      const result = await runAppAssistant(
   142	        {
   143	          message: body.message,
   144	          history: body.history,
   145	          mode: body.mode,
   146	          context: body.context,
   147	          owner: admission.owner,
   148	          artifactId: admission.artifactId,
   149	          actionManifest: admission.actionManifest,
   150	        },
   151	        deps,
   152	      );
   153	      const response: AssistantChatResponse = {
   154	        reply: result.reply,
   155	        mode: result.mode,
   156	        ...(result.citations.length > 0 ? { citations: result.citations } : {}),
   157	        ...(result.actions.length > 0 ? { actions: result.actions } : {}),
   158	      };
   159	      res.json(response);
   160	    } catch (err) {
   161	      console.error('[app-assistant] run failed:', err instanceof Error ? err.message : err);
   162	      sendError(res, 'INTERNAL', 'O assistente está indisponível de momento.');
   163	    }
   164	  });
   165	
   166	  return r;
   167	}

codex
- `Medium` [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:252) and [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:83): `whoami` does not fail closed when the app owner record is missing or lacks `orgId`. It resolves `ownerOrgId` to `''`, then `isOwnerOrgAdmin()` still returns `true` for any `super-admin`. Attack scenario: an orphaned/corrupt artifact record lets a super-admin get `200 {admin:true}` for an app with no resolvable owner org, violating the stated “owner-org server-resolved or false” contract and creating a false-positive privileged signal that H3 is likely to trust later.

- `Low` [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:255) and [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:83): `whoami` is a new owner-org membership oracle for valid `org-admin` callers. Because `admin:true` means “this app is owned by my org” and `admin:false` means “it is not” for any known existing app id/slug, an org admin can probe arbitrary apps and learn cross-tenant ownership relations that `POST /api/app-assistant` never revealed. Attack scenario: an org admin enumerates known app ids/slugs and maps which ones belong to their org without any separate app-access proof.

VERDICT: NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
82,901
- `Medium` [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:252) and [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:83): `whoami` does not fail closed when the app owner record is missing or lacks `orgId`. It resolves `ownerOrgId` to `''`, then `isOwnerOrgAdmin()` still returns `true` for any `super-admin`. Attack scenario: an orphaned/corrupt artifact record lets a super-admin get `200 {admin:true}` for an app with no resolvable owner org, violating the stated “owner-org server-resolved or false” contract and creating a false-positive privileged signal that H3 is likely to trust later.

- `Low` [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:255) and [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:83): `whoami` is a new owner-org membership oracle for valid `org-admin` callers. Because `admin:true` means “this app is owned by my org” and `admin:false` means “it is not” for any known existing app id/slug, an org admin can probe arbitrary apps and learn cross-tenant ownership relations that `POST /api/app-assistant` never revealed. Attack scenario: an org admin enumerates known app ids/slugs and maps which ones belong to their org without any separate app-access proof.

VERDICT: NEEDS-WORK
