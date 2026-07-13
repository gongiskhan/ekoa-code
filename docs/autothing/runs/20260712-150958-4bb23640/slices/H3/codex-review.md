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
session id: 019f5d5a-2f77-7830-9fa3-fe7008f3db33
--------
user
Adversarial SECURITY review in /Users/ggomes/dev/ekoa-code of commit 28a6e12 (git show 28a6e12): slice H3 of a security block - served-app EDIT MODE (admins only), a thin front-end over the existing follow-up-build patch run + versions/restore rollback machinery. It shows an OPT-IN edit switch ONLY when H2 detection admin===true (detect-then-ask: detection NEVER auto-enables edit); an admin edit request becomes a follow-up build via POST /api/v1/jobs {artifactId} with the admin platform Bearer (H1 re-gates server-side: can(canEditApps)+loadWritable, uniform 404), streamed; then preview (new head vs pre-run head) -> APPROVE or one-click ROLLBACK via POST /api/v1/artifacts/:id/versions/:sha/restore. No new capability logic/endpoints; the visitor-blind POST /api/app-assistant plane is untouched. Controller: api/assets/panel-runtime/src/edit-mode.js (fetch-injectable); wiring in AssistantPanel.jsx. Hunt for REAL defects with file:line + scenario: (1) detect-then-ask - can edit mode be entered WITHOUT an explicit opt-in click? any setEditMode(true) wired to the detection effect / auto-trigger / discovery banner? switch OFF by default? (2) client-gate-only risk - is every privileged action independently server-gated (startEditJob->/api/v1/jobs H1-gated; rollback->versions/restore writable-gated), so a non-admin force-enabling the UI in devtools drives NOTHING the server accepts? (3) the drive - admin Bearer read defensively (cross-origin throws), sent ONLY same-origin, never logged/leaked; SSE parseSseBuffer cannot crash/hang on a split/garbled frame; pre-run head capture vs build TOCTOU on the rollback target; (4) rollback targets the PRE-run head not the new head; approve/rollback wrong-sha risk; (5) graceful degradation on 401/403/404 (calm msg, no crash); PT-PT no emoji/dash; (6) test honesty - detect-then-ask effect-slice not a tautology, drive asserts artifactId+Bearer, visitor-blindness asserted. Read slices/H3/impl-notes.md. Read-only cmds OK. Concise: a bullet per finding classified High/Medium/Low with file:line, then exactly one final line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `28a6e12` as an adversarial security pass. I’m checking the project context files first, then the H3 notes and the exact code paths touched by the served-app edit mode flow.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
exec
/bin/zsh -lc 'if [ -d .codegraph ]; then echo CODEGRAPH_PRESENT; else echo NO_CODEGRAPH; fi' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
CODEGRAPH_PRESENT

hook: PreToolUse Completed
exec
/bin/zsh -lc "pwd && ls -la && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'AGENTS.md' -g 'impl-notes.md' ." in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/Users/ggomes/dev/ekoa-code
total 1272
drwxr-xr-x@  32 ggomes  staff    1024 Jul 13 16:54 .
drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
drwxr-xr-x@   6 ggomes  staff     192 Jul 13 11:15 .claude
drwxr-xr-x@   9 ggomes  staff     288 Jul 13 22:20 .codegraph
-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
drwxr-xr-x@  16 ggomes  staff     512 Jul 13 22:19 .git
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
./docs/autothing/runs/20260712-150958-4bb23640/slices/F1/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/C5/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/E1/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/D1/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/B2/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/C3/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/H2/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/D3/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/D2/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/E2/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/H1/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/F2/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/H3/impl-notes.md
./docs/autothing/runs/20260712-150958-4bb23640/slices/G2/impl-notes.md

exec
/bin/zsh -lc 'git show --stat --oneline 28a6e12' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-hwV5Ee2C' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-rGD3UeXl' (errno=Operation not permitted)
28a6e12 feat(operator-run/h3): SECURITY - served-app edit mode (admins only). Opt-in edit switch shown ONLY when H2 admin===true (detect-then-ask binding: detection never auto-enables); an edit request becomes a SCOPED FOLLOW-UP BUILD (patch run) over the platform /api/v1/jobs API with the admin JWT (H1-gated server-side), streamed, then preview (new head vs pre-run head) -> APPROVE or one-click ROLLBACK via versions/restore; admin-discovery discreet dismissible banner. Thin front-end, NO new capability/endpoint; visitor-blind POST /api/app-assistant untouched. edit-mode.js fetch-injectable controller + panel phase machine; diagram 04 updated
 api/assets/panel-runtime/src/AssistantPanel.css    |  283 +
 api/assets/panel-runtime/src/AssistantPanel.jsx    |  306 +-
 api/assets/panel-runtime/src/edit-mode.js          |  315 ++
 api/tests/apps/assistant-panel.test.ts             |   82 +-
 api/tests/apps/edit-mode.test.ts                   |  276 +
 .../slices/H2/codex-review.md                      | 5446 ++++++++++++++++++++
 .../slices/H3/impl-notes.md                        |  130 +
 .../slices/H3/worker-status.txt                    |    1 +
 docs/diagrams/04-agent-job.excalidraw              |   32 +
 9 files changed, 6863 insertions(+), 8 deletions(-)

codex
The repo is CodeGraph-indexed, so I’m using that path first for the H3 surface and its tests. After that I’ll confirm the exact commit diff and the implementation notes against the server gates and rollback flow.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,220p' docs/autothing/runs/20260712-150958-4bb23640/slices/H3/impl-notes.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
# H3 impl-notes - served-app EDIT MODE (admins only): patch-run preview / approve / rollback

Slice H3 of the atomic security block. Built on H1 (the real `can()` + `loadWritable` follow-up-build
gate) and H2 (`GET /api/app-assistant/whoami` detection + the panel's `admin` state). DONE-GREEN.

## What was built - a thin FRONT-END over existing, H1-gated machinery (not a second brain)

An admin's edit request becomes a SCOPED FOLLOW-UP BUILD (a "patch run") over the app's own git repo -
the exact path the dashboard uses. H3 adds the panel UI + the network controller; it adds NO new
capability/permission logic and NO new build/edit endpoint. The server is the authority.

### 1. New controller module - `api/assets/panel-runtime/src/edit-mode.js` (new, reserved)
A plain-JS, `fetch`-injectable controller (no React), so the network flow is unit-provable against a
fake fetch. Every call targets the PLATFORM `/api/v1/*` API with the admin's platform Bearer - a
SEPARATE plane from the visitor-blind `POST /api/app-assistant` (which still never reads the caller JWT).
- `startEditJob` -> `POST /api/v1/jobs { kind:'build', description, sessionId, language:'pt', artifactId }`
  with `Authorization: Bearer <admin JWT>`. This is a follow-up build; H1 re-gates it server-side
  (`can(canEditApps)` AND `loadWritable`, uniform 404). `sessionId` is a fresh client correlation id
  (`newEditSessionId`) - a follow-up reserves nothing, it only tags the job.
- `readVersions` -> `GET /api/v1/artifacts/:id/versions` (newest-first; `items[0].sha` = HEAD).
- `rollbackToVersion` -> `POST /api/v1/artifacts/:id/versions/:sha/restore` (forward-restore; one click).
- `streamJobEvents` -> reads `GET /api/v1/jobs/:id/events?token=` with fetch + a ReadableStream reader
  and `parseSseBuffer` (frame-by-frame SSE parsing; a frame split across chunk boundaries is buffered,
  a garbled frame skipped - never a throw). Resolves on the terminal `complete`/`error` JobEvent.
- `runEditPatch` orchestrates: capture the pre-run head BEFORE the build (the rollback target / diff
  point) -> start the follow-up build -> stream `plan_step` narration to `onProgress` -> read the new
  head for the preview. Returns a discriminated outcome: `ready | answered | failed | degraded`.
- `degradeMessage(status)` maps 401/403/404/other to distinct calm PT-PT lines. `progressLine(ev)`
  narrates `plan_step`. `EDIT_COPY` holds the shared PT-PT strings (the confirm wording etc.).

### 2. Panel wiring - `api/assets/panel-runtime/src/AssistantPanel.jsx` + `.css` (reserved)
- **Opt-in switch** (`.ekoa-assistant-adminbar` / `.ekoa-assistant-editswitch`): a VISIBLE, accessible
  (`role="switch" aria-checked`) toggle, rendered ONLY when `admin === true`, OFF by default
  (`editMode` starts `false`). A distinct control from the visitor OPERAR/MOSTRAR/ENSINAR toggle.
- **Edit affordance** (`.ekoa-assistant-edit`, `data-edit-phase`): a dedicated, visually distinct
  section (left accent bar + tinted surface + "Modo de edição (administrador)" header) shown only when
  `admin && editMode`. Its phase machine: `compose` (type the request) -> `confirm` (the PT-PT intent
  confirmation "Vou preparar esta alteração como uma revisão. Confirma?") -> `running` (live
  `plan_step` narration) -> `preview` (shows new head + pre-run head, APPROVE vs REVERTER) -> `note`
  (a terminal calm message). APPROVE keeps the new head (the build already activated it - no call);
  REVERTER is one click to `rollbackToVersion(preRunSha)`.
- **Admin discovery** (`.ekoa-assistant-discovery`): a discreet, dismissible banner shown ONCE to a
  detected admin who has not opted in and not dismissed it (`admin && !editMode && !discoveryDismissed`),
  with a concrete PT-PT suggestion ("Pode pedir alterações a esta aplicação - por exemplo, adicionar um
  campo ou um botão."). Its CTA is the SAME explicit opt-in click; it never auto-enables edit.

## Detect-then-ask enforcement (BINDING)

Detection NEVER enables edit. `editMode` starts `false` and the only `setEditMode(true)` in the panel
is inside `openEditMode`, wired exclusively to explicit click handlers (the switch + the discovery CTA).
The H2 whoami DETECTION effect touches only `setAdmin` - it references neither `setEditMode` nor
`openEditMode` (pinned by a test that slices the effect). Being an admin SHOWS the switch; it does not
enter edit mode. `admin` is still set exactly once and read only to gate the affordance.

## Graceful degradation

Every mid-flow platform call is fail-soft: `runEditPatch`/`rollbackToVersion` return `{ ok:false, status }`
/ `{ outcome:'degraded', status }` on any 401/403/404/network error (token expired, lost writability,
app gone), and the panel renders `degradeMessage(status)` in the calm `note` phase - never a crash. A
missing app id / unreadable token (cross-origin, sandboxed iframe) degrades the same way rather than
firing a doomed call. An in-build classifier `answered` (no job created) and a build `error` event each
land on their own calm note.

## Visitor-blindness preserved (separate planes)

Edit mode uses ONLY the platform `/api/v1/*` API with the admin JWT. The served-app `POST
/api/app-assistant` plane is byte-for-byte untouched and stays visitor-blind - a test slices `confirmEdit`
and asserts it references neither `ENDPOINT` nor `/api/app-assistant`. Edits are never routed through the
visitor assistant endpoint.

## Contracts / server

NONE added. H3 reuses the existing jobs + versions/restore endpoints (all already in `shared/`), so
`shared/src/app-assistant.ts` was NOT touched and no new contract test was needed. No new
build/edit/capability logic (H1 owns gating). No queue (that is H4).

## Diagram updated (FIXED-12)

`docs/diagrams/04-agent-job.excalidraw` - added one free-standing note (`h3_edit_mode`, emerald
`#047857`, monospace, x=72 y=332) directly below the existing H1 build-authz-gate note. WHY 04 and not
03: an H3 edit request IS a follow-up build, which lives on the agent-job lifecycle diagram (04 already
documents `POST /api/v1/jobs`, the follow-up path, and the H1 `canEditApps`/`loadWritable` gate). The
note states the H3 admin plane: detect (H2 whoami) -> opt-in switch (never auto) -> confirm -> POST
/jobs {artifactId} + admin JWT = the SAME follow-up build (H1 re-gates) -> stream SSE -> preview via
versions -> APPROVE keeps head | ROLLBACK = restore (pre-run head); and that it is a SEPARATE plane from
the visitor-blind POST /api/app-assistant. Round-trip verified: the diagram diff is +32 lines (exactly
the one element), 0 deletions, no overlap with existing elements, valid JSON.

## Reserved-path compliance

All changes are within the H3 reserved set:
- `api/assets/panel-runtime/src/AssistantPanel.jsx`, `AssistantPanel.css`, `edit-mode.js` (new module)
- `api/tests/apps/assistant-panel.test.ts` (extended), `api/tests/apps/edit-mode.test.ts` (new)
- `docs/diagrams/04-agent-job.excalidraw`
- `slices/H3/**`
`shared/src/app-assistant.ts` was NOT touched (no thin read needed). No commits, no stack ops, no real
builds. Note: the root ESLint config ignores `api/assets/**` and `**/*.js`, so the panel JSX + the new
`.js` module are linted by esbuild's `build.mjs` compile (their real gate), not eslint; only the `.ts`
test files are eslint-checked.

## Tests

- **Behavioural** (`api/tests/apps/edit-mode.test.ts`, 16 tests): the controller is imported at runtime
  by file URL (it is a compiled-by-esbuild asset, outside the tsc program) and driven with a fake fetch:
  POST /jobs body carries `kind:'build'` + `artifactId` + `description` + `Bearer`; the pre-run head is
  read BEFORE the POST (order asserted); `plan_step` narration surfaces; a 403/404 on /jobs and a 403 on
  the versions read each degrade (no /jobs issued in the latter); an error event -> failed; answered ->
  answered; rollback POSTs the restore endpoint with the Bearer; a 404 on restore degrades; SSE frames
  parse (comments/non-data ignored, partial + split frames reassembled); no emoji in the source.
- **Source-contract** (`api/tests/apps/assistant-panel.test.ts`, +6 tests, +1 H2 fix): the switch is
  admin-gated and starts OFF; the affordance is revealed only by `admin && editMode`; detect-then-ask is
  binding (one `setEditMode(true)`, in `openEditMode`, wired to clicks; the detection effect touches
  neither); the discovery banner is once/dismissible and never auto-enables; the flow uses the /api/v1/*
  plane (imports from `./edit-mode`, `runEditPatch`/`rollbackToVersion`) and `confirmEdit` never
  references the visitor endpoint; graceful degradation via `degradeMessage` + the `note` phase. The one
  H2 test that pinned "no `setEditMode` yet" (deferred-to-H3) was updated to assert, instead, that the
  DETECTION effect never enables edit mode (its intent survives H3).

The heavy end-to-end (a REAL patch run editing a real app + rollback) is the LEAD's live probe - NOT run
here; no e2e driver added. The flow is correct + unit-proven.

## Verification (all green, locally)

- `cd api && npx tsc --noEmit -p tsconfig.json` -> 0
- `npx tsc --noEmit -p tsconfig.test.json` -> 0
- `npx eslint api/tests/apps/edit-mode.test.ts api/tests/apps/assistant-panel.test.ts` -> 0 errors
  (panel `.jsx`/`.js` assets are config-ignored - esbuild compile is their gate)
- `npx vitest run tests/apps tests/contract` -> 57 files, 559 tests, all pass
- `node assets/panel-runtime/build.mjs` -> built (panel compiles, 240389 bytes)
- repo root `npm run gate:chokepoint` -> clean (nothing outside api/src/llm touches the provider)

exec
/bin/zsh -lc 'codegraph explore "served-app edit mode H3 AssistantPanel edit-mode startEditJob rollback restore admin detection setEditMode"' in /Users/ggomes/dev/ekoa-code
 succeeded in 459ms:
## Flow (call path among the symbols you queried)

1. AssistantPanel (api/assets/panel-runtime/src/AssistantPanel.jsx:250)
   ↓ calls
2. runEditPatch (api/assets/panel-runtime/src/edit-mode.js:268)
   ↓ calls
3. startEditJob (api/assets/panel-runtime/src/edit-mode.js:118)

> Full source for these symbols is below — the call flow among them, followed by their bodies.
## Exploration: served-app edit mode H3 AssistantPanel edit-mode startEditJob rollback restore admin detection setEditMode

Found 141 symbols across 65 files.

### Blast radius — what depends on these (update/verify before editing)

- `AppAssistantDeps` (api/src/apps/app-assistant.ts:57) — 6 callers in `api/src/apps/app-assistant-route.ts`, `api/src/apps/app-assistant.ts`; tests: `api/tests/apps/app-assistant.test.ts`
- `GoalEditorProps` (web/components/automations/goal-editor.tsx:6) — 1 caller in `web/components/automations/goal-editor.tsx`; ⚠️ no covering tests found
- `InlineEditProps` (web/components/automations/inline-edit.tsx:6) — 1 caller in `web/components/automations/inline-edit.tsx`; ⚠️ no covering tests found
- `FileEditorDialogProps` (web/components/builder/file-editor-dialog.tsx:28) — 1 caller in `web/components/builder/file-editor-dialog.tsx`; ⚠️ no covering tests found

### Relationships

**references:**
- AppAssistantDeps → OneShotOptions
- AppAssistantDeps → LlmAttribution
- GoalEditor → GoalEditorProps
- InlineEdit → InlineEditProps
- FileEditorDialog → FileEditorDialogProps
- FileEditorDialog → loadSavedSize
- useIsMobile → onChange
- AppAssistantDeps → GroundingInput
- OneShotOptions → RouterDecision
- AppAssistantDeps → RouterDecision
- ... and 33 more

**calls:**
- GoalEditor → onChange
- FileEditorDialog → useTranslation
- FileEditorDialog → getSandboxDisplayPath
- useTranslation → t
- runAgent → requireAttribution
- runOneShot → requireAttribution
- completeFast → requireAttribution
- FileEditorDialog → getMonacoLanguage
- ApiCallForm → removeHeader
- ApiCallForm → setHeader
- ... and 120 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/assets/panel-runtime/src/edit-mode.js — startEditJob(function), calls(calls), rollbackToVersion(function)

```javascript
115	 *                                             degrades on `status`; the SERVER is the gate
116	 * Never throws - a network failure is { ok:false, status:0 }.
117	 */
118	export async function startEditJob({ fetchImpl, appId, token, description, sessionId }) {
119	  let res;
120	  try {
121	    res = await fetchImpl(JOBS_ENDPOINT, {
122	      method: 'POST',
123	      headers: {
124	        'Content-Type': 'application/json',
125	        Authorization: `Bearer ${token}`,
126	      },
127	      body: JSON.stringify({
128	        kind: 'build',
129	        description,
130	        sessionId: sessionId || newEditSessionId(appId),
131	        language: 'pt',
132	        artifactId: appId,
133	      }),
134	    });
135	  } catch {
136	    return { ok: false, status: 0 };
137	  }
138	  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
139	  let data = null;
140	  try {
141	    data = await res.json();
142	  } catch {
143	    data = null;
144	  }
145	  if (data && data.status === 'answered') {
146	    return { ok: true, status: 'answered', reason: typeof data.reason === 'string' ? data.reason : '' };
147	  }
148	  const jobId = data && data.job && typeof data.job.id === 'string' ? data.job.id : undefined;
149	  if (!jobId) return { ok: false, status: res.status };
150	  return { ok: true, status: 'created', jobId };
151	}
152	
153	/**
154	 * Read the artifact's version list. Returns { ok:true, items, head } where `head` is the

... (gap) ...

181	 * Forward-restore the artifact to `sha` (one-click rollback to the pre-run head). Returns
182	 * { ok:true, newHeadSha } or { ok:false, status } on a refusal. Never throws.
183	 */
184	export async function rollbackToVersion({ fetchImpl, appId, token, sha }) {
185	  let res;
186	  try {
187	    res = await fetchImpl(restoreEndpoint(appId, sha), {
188	      method: 'POST',
189	      headers: { Authorization: `Bearer ${token}` },
190	    });
191	  } catch {
192	    return { ok: false, status: 0 };
193	  }
194	  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
195	  let data = null;
196	  try {
197	    data = await res.json();
198	  } catch {
199	    data = null;
200	  }
201	  const newHeadSha = data && typeof data.newHeadSha === 'string' ? data.newHeadSha : undefined;
202	  return { ok: true, newHeadSha };
203	}
204	
205	/**
206	 * Consume the job SSE stream with fetch, forwarding each JobEvent to `onEvent`, and
```

#### api/assets/panel-runtime/src/AssistantPanel.jsx — calls(calls), AssistantPanel(function)

```jsx
247	  );
248	}
249	
250	export function AssistantPanel({ defaultOpen = false } = {}) {
251	  // Collapsed on mount UNLESS the launcher handed off an explicit open intent. Since
252	  // G2 the panel is lazy-loaded: the app-bundle launcher (scaffold mount.js) injects
253	  // this asset and passes `defaultOpen` true when the VISITOR clicked it (open now),
254	  // false when the asset was idle-preloaded (mount collapsed, show only the launcher).
255	  const [collapsed, setCollapsed] = useState(!defaultOpen);
256	  // `mode` is the mode CURRENTLY shown on the toggle - the server's inference (echoed
257	  // on each response) unless the visitor pins one. `pinnedMode` is non-null only when
258	  // the visitor explicitly picked a mode: only then do we send it, so by default the
259	  // server infers the mode from the phrasing (do/show/teach) and we reflect it back.
260	  const [mode, setMode] = useState('do');
261	  const [pinnedMode, setPinnedMode] = useState(null);
262	  const [messages, setMessages] = useState([]); // { id, role, content, citations?, runs? }
263	  const [draft, setDraft] = useState('');
264	  const [busy, setBusy] = useState(false);
265	  // E2 same-document tour playback state (null when no tour is active). The player
266	  // is 100% client-side and issues ZERO model calls: it fetches the pre-generated
267	  // tour from GET /api/demos/:appId and drives it in the page.
268	  const [tour, setTour] = useState(null);
269	  // H2 detect-then-ask: whether the current viewer is an admin of this app's owner org.
270	  // Default false (fail-closed). Set ONCE by the mount detection below. This flag NEVER
271	  // auto-enables anything - it only decides whether the H3 edit-mode SWITCH is shown (and
272	  // lights the discreet header indicator). Every privileged action stays gated server-side by H1.
273	  const [admin, setAdmin] = useState(false);
274	
275	  // H3 EDIT MODE (admins only) - detect-then-ask is BINDING. `editMode` is the OPT-IN switch:
276	  // it starts OFF and is flipped ONLY by an explicit admin click (the switch, or the discovery
277	  // banner's CTA). Detection (setAdmin above) NEVER touches it - being an admin shows the switch,
278	  // it does not enter edit mode. The rest is the edit flow's UI state, inert until editMode is on.
279	  const [editMode, setEditMode] = useState(false);
280	  // The edit flow phase: compose (typing) -> confirm (confirm intent) -> running (patch run) ->
281	  // preview (approve/rollback) | note (a terminal calm message: answered/approved/reverted/degraded).
282	  const [editPhase, setEditPhase] = useState('compose');
283	  const [editDraft, setEditDraft] = useState(''); // the admin's edit request text
284	  const [editProgress, setEditProgress] = useState(''); // latest plan_step narration line (PT-PT)
285	  const [editPreview, setEditPreview] = useState(null); // { preRunSha, newHeadSha } after a run
286	  const [editMessage, setEditMessage] = useState(''); // calm PT-PT copy for the 'note' phase
287	  const [editBusy, setEditBusy] = useState(false); // guards double-submit during a run / rollback
288	  // Admin discovery (proactive teaching, shown ONCE, dismissible). Suppressed after the admin
289	  // dismisses it OR opts into edit mode. It never auto-enables edit - its CTA is an explicit click.
290	  const [discoveryDismissed, setDiscoveryDismissed] = useState(false);
291	
292	  const idRef = useRef(0);
293	  const messagesRef = useRef(messages);
294	  const actionResultsRef = useRef([]); // rolling buffer of recent action results for context
295	  const listRef = useRef(null);
296	  const textareaRef = useRef(null);
297	  const playerRef = useRef(null);
298	  const whoamiDoneRef = useRef(false); // guards the once-only admin detection (H2)
299	
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
421	   *  runtime draws the driving badge / highlight / destructive confirm and pauses
422	   *  on real user input - the panel only reflects each run's state. */
423	  const runActions = useCallback(
424	    async (actions, turnId) => {
425	      const runtime = typeof window !== 'undefined' ? window.__ekoaActions : undefined;
426	      for (const a of actions) {
427	        const runId = nextId();
428	        patchTurn(turnId, (m) => ({ runs: [...(m.runs || []), { id: runId, status: 'running' }] }));
429	
430	        const setStatus = (status, detail) =>
431	          patchTurn(turnId, (m) => ({
432	            runs: (m.runs || []).map((r) => (r.id === runId ? { ...r, status, detail } : r)),
433	          }));
434	
435	        // A startTour action is played by the SAME-DOCUMENT tour player, not the
436	        // runtime executor: the runtime's cross-frame startTour only posts a
437	        // tour-request (a no-op in-page) and drops the tourId. The panel owns the
438	        // player, so it starts playback here. Client-side + zero-token.
439	        const runtimeAction = toRuntimeAction(a);
440	        if (runtimeAction && runtimeAction.kind === 'startTour') {
441	          startTourPlayback(runtimeAction.tourId);
442	          setStatus('done');
443	          recordResult({ toolName: a && a.toolName, status: 'done' });
444	          continue;
445	        }
446	
447	        if (!runtime || typeof runtime.execute !== 'function') {
448	          setStatus('unavailable');
449	          recordResult({ toolName: a && a.toolName, status: 'unavailable' });
450	          continue;
451	        }
452	        try {
453	          const result = await runtime.execute(runtimeAction);
454	          const status = (result && result.status) || 'done';
455	          setStatus(status, result && result.detail);
456	          recordResult({ toolName: a && a.toolName, status, detail: result && result.detail });
457	        } catch (err) {
458	          setStatus('failed', err && err.reason);
459	          recordResult({ toolName: a && a.toolName, status: 'failed', detail: err && err.reason });
460	        }
461	      }
462	    },
463	    [patchTurn, recordResult, startTourPlayback],
464	  );
465	
466	  const send = useCallback(
467	    async (rawText) => {
468	      const text = (rawText != null ? rawText : draft).trim();
469	      if (!text || busy) return;
470	
471	      // History is the conversation BEFORE this message (role/content pairs only),
472	      // capped to the most recent turns so request size, latency and model cost stay
473	      // bounded on a long-lived panel.
474	      const history = messagesRef.current
475	        .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error)
476	        .slice(-MAX_HISTORY_TURNS)
477	        .map((m) => ({ role: m.role, content: m.content }));
478	
479	      setDraft('');
480	      setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: text }].slice(-MAX_MESSAGES));
481	      setBusy(true);
482	
483	      const route = currentRoute();
484	      const recent = actionResultsRef.current.slice();
485	      const context = {};
486	      if (route) context.route = route;
487	      if (recent.length) context.actionResults = recent;
488	
489	      const id = appId();
490	      // A hung network/model turn must never lock the composer: abort after the
491	      // timeout and fall through to the calm PT-PT error turn.
492	      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
493	      const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
494	      try {
495	        const res = await fetch(ENDPOINT, {
496	          method: 'POST',
497	          ...(controller ? { signal: controller.signal } : {}),
498	          headers: {
499	            'Content-Type': 'application/json',
500	            ...(id ? { 'X-Ekoa-App-Id': id } : {}),
501	          },
502	          body: JSON.stringify({
503	            message: text,
504	            history,
505	            // Send the mode only when the visitor pinned it; otherwise let the server
506	            // infer it from the phrasing and echo it back on response.mode.
507	            ...(pinnedMode ? { mode: pinnedMode } : {}),
508	            ...(Object.keys(context).length ? { context } : {}),
509	          }),
510	        });
511	        if (!res.ok) {
512	          setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: ERROR_REPLY, error: true }].slice(-MAX_MESSAGES));
513	          return;
514	        }
515	        const data = await res.json();
516	        if (data && typeof data.mode === 'string') setMode(data.mode);
517	        const turnId = nextId();
518	        setMessages((prev) => [
519	          ...prev,
520	          {
521	            id: turnId,
522	            role: 'assistant',
523	            content: (data && data.reply) || '',
524	            citations: data && Array.isArray(data.citations) ? data.citations : undefined,
525	            runs: [],
526	          },
527	        ].slice(-MAX_MESSAGES));
528	        if (data && Array.isArray(data.actions) && data.actions.length) {
529	          await runActions(data.actions, turnId);
530	        }
531	      } catch {
532	        setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: ERROR_REPLY, error: true }].slice(-MAX_MESSAGES));
533	      } finally {
534	        if (timer) clearTimeout(timer);
535	        setBusy(false);
536	      }
537	    },
538	    [draft, busy, pinnedMode, runActions],
539	  );
540	
541	  const open = useCallback(() => {
542	    setCollapsed(false);
543	    // Focus only on an explicit open (user intent); never on mount, so the panel
544	    // never steals focus from the app while it loads.
545	    window.setTimeout(() => {
546	      if (textareaRef.current) textareaRef.current.focus();
547	    }, 0);
548	  }, []);
549	
550	  // Open-intent handoff, late leg (G2): the boot launcher dispatches
551	  // 'ekoa:assistant-open' on every click. The defaultOpen flag covers a click BEFORE
552	  // this panel mounts; this listener covers a click AFTER it mounted collapsed (an
553	  // idle preload racing the visitor's click) - intent is never lost between the two.
554	  useEffect(() => {
555	    const onOpenIntent = () => open();
556	    window.addEventListener('ekoa:assistant-open', onOpenIntent);
557	    return () => window.removeEventListener('ekoa:assistant-open', onOpenIntent);
558	  }, [open]);
559	
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
650	      setEditPreview({ preRunSha: result.preRunSha, newHeadSha: result.newHeadSha });
651	      setEditPhase('preview');
652	    } else if (result.outcome === 'answered') {
653	      // The in-build classifier resolved the request without a build (no revision was created).
654	      setEditMessage('Não foi criada nenhuma revisão para este pedido. Reformule a alteração pretendida.');
655	      setEditPhase('note');

... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I have the H3 notes and the main flow. Now I’m drilling into the concrete controller, panel wiring, and the tests to see whether the guarantees in the notes are actually enforced or whether there’s a real bypass or rollback bug.
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
codex
The client-side invariants mostly look deliberate. I’m checking the server endpoints now to confirm the front-end isn’t relying on a UI-only gate, and I’m reading the preview/rollback rendering to look for a wrong-SHA or stale-state mistake.
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'git show 28a6e12 -- api/assets/panel-runtime/src/AssistantPanel.jsx api/assets/panel-runtime/src/edit-mode.js api/tests/apps/edit-mode.test.ts api/tests/apps/assistant-panel.test.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-o8xZpRXl' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-vBf5wnzI' (errno=Operation not permitted)
commit 28a6e12b73b1d1c76f880e8b8097825802e03b7d
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 22:19:34 2026 +0100

    feat(operator-run/h3): SECURITY - served-app edit mode (admins only). Opt-in edit switch shown ONLY when H2 admin===true (detect-then-ask binding: detection never auto-enables); an edit request becomes a SCOPED FOLLOW-UP BUILD (patch run) over the platform /api/v1/jobs API with the admin JWT (H1-gated server-side), streamed, then preview (new head vs pre-run head) -> APPROVE or one-click ROLLBACK via versions/restore; admin-discovery discreet dismissible banner. Thin front-end, NO new capability/endpoint; visitor-blind POST /api/app-assistant untouched. edit-mode.js fetch-injectable controller + panel phase machine; diagram 04 updated

diff --git a/api/assets/panel-runtime/src/AssistantPanel.jsx b/api/assets/panel-runtime/src/AssistantPanel.jsx
index 7b64084..259d765 100644
--- a/api/assets/panel-runtime/src/AssistantPanel.jsx
+++ b/api/assets/panel-runtime/src/AssistantPanel.jsx
@@ -30,6 +30,12 @@
  */
 import { useCallback, useEffect, useRef, useState } from 'react';
 import { createTourPlayer } from './tour-player';
+// H3 EDIT MODE (admins only): the network side of the admin patch-run flow, factored out
+// so it is unit-provable against a fake fetch. It targets the PLATFORM /api/v1/* API with
+// the admin's platform Bearer - a SEPARATE plane from the visitor-blind POST
+// /api/app-assistant. Every action it calls is H1-gated server-side; this panel only SHOWS
+// the affordance when detection said admin, and only after the admin OPTS IN (detect-then-ask).
+import { runEditPatch, rollbackToVersion, degradeMessage, progressLine, EDIT_COPY } from './edit-mode';
 import './AssistantPanel.css';
 
 const ENDPOINT = '/api/app-assistant';
@@ -86,6 +92,11 @@ function readPlatformToken() {
   }
 }
 
+/** A short display sha for the edit-mode preview (7 chars, like git). Undefined -> a dash. */
+function shortSha(sha) {
+  return typeof sha === 'string' && sha ? sha.slice(0, 7) : '-';
+}
+
 /** The app's current route/page, best-effort: the shell may expose it on
  *  window.__ekoaApp; otherwise fall back to the location. Undefined when unknown. */
 function currentRoute() {
@@ -257,10 +268,27 @@ export function AssistantPanel({ defaultOpen = false } = {}) {
   const [tour, setTour] = useState(null);
   // H2 detect-then-ask: whether the current viewer is an admin of this app's owner org.
   // Default false (fail-closed). Set ONCE by the mount detection below. This flag NEVER
-  // auto-enables anything - it only lights the discreet indicator in the header (the actual
-  // edit-mode switch is H3). Every privileged action stays gated server-side by H1.
+  // auto-enables anything - it only decides whether the H3 edit-mode SWITCH is shown (and
+  // lights the discreet header indicator). Every privileged action stays gated server-side by H1.
   const [admin, setAdmin] = useState(false);
 
+  // H3 EDIT MODE (admins only) - detect-then-ask is BINDING. `editMode` is the OPT-IN switch:
+  // it starts OFF and is flipped ONLY by an explicit admin click (the switch, or the discovery
+  // banner's CTA). Detection (setAdmin above) NEVER touches it - being an admin shows the switch,
+  // it does not enter edit mode. The rest is the edit flow's UI state, inert until editMode is on.
+  const [editMode, setEditMode] = useState(false);
+  // The edit flow phase: compose (typing) -> confirm (confirm intent) -> running (patch run) ->
+  // preview (approve/rollback) | note (a terminal calm message: answered/approved/reverted/degraded).
+  const [editPhase, setEditPhase] = useState('compose');
+  const [editDraft, setEditDraft] = useState(''); // the admin's edit request text
+  const [editProgress, setEditProgress] = useState(''); // latest plan_step narration line (PT-PT)
+  const [editPreview, setEditPreview] = useState(null); // { preRunSha, newHeadSha } after a run
+  const [editMessage, setEditMessage] = useState(''); // calm PT-PT copy for the 'note' phase
+  const [editBusy, setEditBusy] = useState(false); // guards double-submit during a run / rollback
+  // Admin discovery (proactive teaching, shown ONCE, dismissible). Suppressed after the admin
+  // dismisses it OR opts into edit mode. It never auto-enables edit - its CTA is an explicit click.
+  const [discoveryDismissed, setDiscoveryDismissed] = useState(false);
+
   const idRef = useRef(0);
   const messagesRef = useRef(messages);
   const actionResultsRef = useRef([]); // rolling buffer of recent action results for context
@@ -292,8 +320,9 @@ export function AssistantPanel({ defaultOpen = false } = {}) {
   // indicator; it NEVER auto-enables anything and issues no privileged call (edit mode is H3).
   useEffect(() => {
     const id = appId();
-    // No app id (standalone preview) or already detected once -> nothing to do. The ref keeps the
-    // detection to exactly ONE request per mounted panel (also idempotent under StrictMode).
+    // No app id (standalone preview) or already detected once -> nothing to do. Empty deps make
+    // this a mount-only effect; the ref keeps detection to exactly ONE request per mounted panel
+    // even if the effect is ever re-entered. The panel-runtime entry mounts WITHOUT StrictMode.
     if (!id || whoamiDoneRef.current) return;
     whoamiDoneRef.current = true;
 
@@ -545,6 +574,126 @@ export function AssistantPanel({ defaultOpen = false } = {}) {
     [send],
   );
 
+  // ---- H3 edit mode (admins only) -----------------------------------------
+  // A thin front-end over the H1-gated follow-up-build machinery. The SERVER is the
+  // authority (can(canEditApps) + loadWritable on every call); the panel only decides
+  // whether to SHOW the affordance (admin) and drives the confirmed flow. Every mid-flow
+  // 401/403/404 lands on a calm PT-PT message via degradeMessage - never a crash.
+
+  /** Turn edit mode ON. An EXPLICIT admin action (switch or discovery CTA) - the only way
+   *  edit mode is ever entered. Detection never calls this (detect-then-ask). */
+  const openEditMode = useCallback(() => {
+    setEditMode(true);
+    setDiscoveryDismissed(true); // opting in dismisses the discovery banner
+    setEditPhase('compose');
+  }, []);
+
+  /** Turn edit mode OFF and clear the whole edit flow (back to a clean compose state). */
+  const closeEditMode = useCallback(() => {
+    setEditMode(false);
+    setEditPhase('compose');
+    setEditDraft('');
+    setEditPreview(null);
+    setEditMessage('');
+    setEditProgress('');
+    setEditBusy(false);
+  }, []);
+
+  /** Dismiss the discovery banner without entering edit mode. */
+  const dismissDiscovery = useCallback(() => setDiscoveryDismissed(true), []);
+
+  /** compose -> confirm: the panel asks the admin to confirm the intent before any build. */
+  const askEditConfirm = useCallback(() => {
+    if (editDraft.trim()) setEditPhase('confirm');
+  }, [editDraft]);
+
+  /** confirm -> compose: step back without running anything. */
+  const cancelEditConfirm = useCallback(() => setEditPhase('compose'), []);
+
+  /** note -> compose: start a fresh edit after a terminal message. */
+  const resetEdit = useCallback(() => {
+    setEditPhase('compose');
+    setEditDraft('');
+    setEditPreview(null);
+    setEditMessage('');
+    setEditProgress('');
+  }, []);
+
+  /** confirm -> running -> preview | note: run the CONFIRMED patch over the existing build
+   *  machinery. Reads the platform token best-effort (a cross-origin/sandboxed iframe has
+   *  none); with no app id / no token it degrades calmly rather than firing a doomed call. */
+  const confirmEdit = useCallback(async () => {
+    const id = appId();
+    const token = readPlatformToken();
+    const description = editDraft.trim();
+    if (!id || !token || !description) {
+      // No token readable (cross-origin) reads as an expired session; otherwise a generic note.
+      setEditMessage(degradeMessage(token ? 0 : 401));
+      setEditPhase('note');
+      return;
+    }
+    setEditBusy(true);
+    setEditProgress('');
+    setEditPhase('running');
+    const result = await runEditPatch({
+      fetchImpl: (url, opts) => fetch(url, opts),
+      appId: id,
+      token,
+      description,
+      onProgress: (ev) => {
+        const line = progressLine(ev);
+        if (line) setEditProgress(line);
+      },
+    });
+    setEditBusy(false);
+    if (result.outcome === 'ready') {
+      setEditPreview({ preRunSha: result.preRunSha, newHeadSha: result.newHeadSha });
+      setEditPhase('preview');
+    } else if (result.outcome === 'answered') {
+      // The in-build classifier resolved the request without a build (no revision was created).
+      setEditMessage('Não foi criada nenhuma revisão para este pedido. Reformule a alteração pretendida.');
+      setEditPhase('note');
+    } else if (result.outcome === 'failed') {
+      setEditMessage('A revisão não foi concluída. Tente reformular o pedido.');
+      setEditPhase('note');
+    } else {
+      // degraded (401/403/404/network) -> a calm, specific PT-PT message.
+      setEditMessage(degradeMessage(result.status));
+      setEditPhase('note');
+    }
+  }, [editDraft]);
+
+  /** APPROVE = keep the new head. The build already activated it, so there is nothing to
+   *  call - just clear the preview and confirm. */
+  const approveEdit = useCallback(() => {
+    setEditMessage(EDIT_COPY.approved);
+    setEditPreview(null);
+    setEditPhase('note');
+  }, []);
+
+  /** ROLLBACK (one click) = forward-restore to the pre-run head. H1-gated server-side. */
+  const rollbackEdit = useCallback(async () => {
+    const id = appId();
+    const token = readPlatformToken();
+    const sha = editPreview && editPreview.preRunSha;
+    if (!id || !token || !sha) {
+      setEditMessage(degradeMessage(token ? 0 : 401));
+      setEditPhase('note');
+      return;
+    }
+    setEditBusy(true);
+    const result = await rollbackToVersion({ fetchImpl: (url, opts) => fetch(url, opts), appId: id, token, sha });
+    setEditBusy(false);
+    if (result.ok) {
+      setEditMessage(EDIT_COPY.rolledBack);
+      setEditPreview(null);
+      setEditPhase('note');
+    } else {
+      setEditMessage(degradeMessage(result.status));
+      setEditPhase('note');
+    }
+  }, [editPreview]);
+
   if (collapsed) {
     return (
       <button type="button" className="ekoa-assistant-launcher" onClick={open} aria-label="Abrir o assistente">
@@ -610,6 +759,155 @@ export function AssistantPanel({ defaultOpen = false } = {}) {
         ))}
       </div>
 
+      {/* H3 admin bar - the OPT-IN edit-mode switch. Shown ONLY when detection said admin
+          (detect-then-ask); OFF by default; flipped only by this explicit click. It is a
+          distinct control from the visitor mode toggle above, so an admin always knows they
+          are entering a different plane (editing the app, not chatting as a visitor). */}
+      {admin ? (
+        <div className="ekoa-assistant-adminbar">
+          <span className="ekoa-assistant-adminbar-label">Modo de edição</span>
+          <button
+            type="button"
+            role="switch"
+            aria-checked={editMode}
+            className="ekoa-assistant-editswitch"
+            data-on={editMode ? 'true' : 'false'}
+            onClick={editMode ? closeEditMode : openEditMode}
+          >
+            <span className="ekoa-assistant-editswitch-track" aria-hidden="true">
+              <span className="ekoa-assistant-editswitch-thumb" />
+            </span>
+            <span className="ekoa-assistant-editswitch-state">{editMode ? 'Ativado' : 'Desativado'}</span>
+          </button>
+        </div>
+      ) : null}
+
+      {/* H3 admin discovery (proactive teaching): surfaced ONCE, discreetly, dismissibly, to a
+          detected admin who has not yet opted in. It suggests the app is changeable and offers
+          an explicit CTA - it NEVER auto-enables edit mode (detect-then-ask). */}
+      {admin && !editMode && !discoveryDismissed ? (
+        <div className="ekoa-assistant-discovery" role="note">
+          <p className="ekoa-assistant-discovery-text">
+            Pode pedir alterações a esta aplicação - por exemplo, adicionar um campo ou um botão.
+            Ative o modo de edição para preparar uma revisão.
+          </p>
+          <div className="ekoa-assistant-discovery-actions">
+            <button type="button" className="ekoa-assistant-discovery-cta" onClick={openEditMode}>
+              Ativar modo de edição
+            </button>
+            <button type="button" className="ekoa-assistant-discovery-dismiss" onClick={dismissDiscovery}>
+              Agora não
+            </button>
+          </div>
+        </div>
+      ) : null}
+
+      {/* H3 edit affordance - a dedicated, visually distinct section (only when editMode is on).
+          The whole patch flow lives here: compose -> confirm -> running -> preview -> note. */}
+      {admin && editMode ? (
+        <section className="ekoa-assistant-edit" data-edit-phase={editPhase} aria-label="Modo de edição (administrador)">
+          <div className="ekoa-assistant-edit-head">
+            <span className="ekoa-assistant-edit-title">Modo de edição</span>
+            <span className="ekoa-assistant-edit-hint">Alterações à aplicação (administrador)</span>
+          </div>
+
+          {editPhase === 'compose' ? (
+            <div className="ekoa-assistant-edit-compose">
+              <textarea
+                className="ekoa-assistant-edit-textarea"
+                placeholder="Descreva a alteração. Por exemplo: adicione um botão de exportação na tabela de honorários."
+                value={editDraft}
+                onChange={(e) => setEditDraft(e.target.value)}
+                rows={2}
+                aria-label="Pedido de alteração"
+              />
+              <button
+                type="button"
+                className="ekoa-assistant-edit-primary"
+                onClick={askEditConfirm}
+                disabled={!editDraft.trim()}
+              >
+                Preparar alteração
+              </button>
+            </div>
+          ) : null}
+
+          {editPhase === 'confirm' ? (
+            <div className="ekoa-assistant-edit-confirm">
+              <p className="ekoa-assistant-edit-confirm-text">{EDIT_COPY.confirm}</p>
+              <div className="ekoa-assistant-edit-actions">
+                <button type="button" className="ekoa-assistant-edit-primary" onClick={confirmEdit}>
+                  Confirmar
+                </button>
+                <button type="button" className="ekoa-assistant-edit-secondary" onClick={cancelEditConfirm}>
+                  Cancelar
+                </button>
+              </div>
+            </div>
+          ) : null}
+
+          {editPhase === 'running' ? (
+            <div className="ekoa-assistant-edit-running" role="status">
+              <span className="ekoa-assistant-edit-spinner" aria-hidden="true" />
+              <span className="ekoa-assistant-edit-progress">{editProgress || EDIT_COPY.preparing}</span>
+            </div>
+          ) : null}
+
+          {editPhase === 'preview' && editPreview ? (
+            <div className="ekoa-assistant-edit-preview">
+              {editPreview.newHeadSha && editPreview.newHeadSha !== editPreview.preRunSha ? (
+                <>
+                  <p className="ekoa-assistant-edit-preview-text">{EDIT_COPY.applied}</p>
+                  <dl className="ekoa-assistant-edit-diff">
+                    <div>
+                      <dt>Versão anterior</dt>
+                      <dd>{shortSha(editPreview.preRunSha)}</dd>
+                    </div>
+                    <div>
+                      <dt>Nova versão</dt>
+                      <dd>{shortSha(editPreview.newHeadSha)}</dd>
+                    </div>
+                  </dl>
+                  <div className="ekoa-assistant-edit-actions">
+                    <button type="button" className="ekoa-assistant-edit-primary" onClick={approveEdit}>
+                      Aprovar
+                    </button>
+                    <button
+                      type="button"
+                      className="ekoa-assistant-edit-secondary"
+                      onClick={rollbackEdit}
+                      disabled={editBusy}
+                    >
+                      Reverter
+                    </button>
+                  </div>
+                </>
+              ) : (
+                <>
+                  <p className="ekoa-assistant-edit-preview-text">{EDIT_COPY.noChange}</p>
+                  <div className="ekoa-assistant-edit-actions">
+                    <button type="button" className="ekoa-assistant-edit-secondary" onClick={resetEdit}>
+                      Nova alteração
+                    </button>
+                  </div>
+                </>
+              )}
+            </div>
+          ) : null}
+
+          {editPhase === 'note' ? (
+            <div className="ekoa-assistant-edit-note" role="status">
+              <p className="ekoa-assistant-edit-note-text">{editMessage}</p>
+              <div className="ekoa-assistant-edit-actions">
+                <button type="button" className="ekoa-assistant-edit-secondary" onClick={resetEdit}>
+                  Nova alteração
+                </button>
+              </div>
+            </div>
+          ) : null}
+        </section>
+      ) : null}
+
       <div className="ekoa-assistant-messages" ref={listRef}>
         {messages.length === 0 ? (
           <div className="ekoa-assistant-intro">
diff --git a/api/assets/panel-runtime/src/edit-mode.js b/api/assets/panel-runtime/src/edit-mode.js
new file mode 100644
index 0000000..d034598
--- /dev/null
+++ b/api/assets/panel-runtime/src/edit-mode.js
@@ -0,0 +1,315 @@
+/*
+ * Operator Assistant Panel - EDIT MODE controller (operator-run H3; admins only).
+ *
+ * A thin FRONT-END over the platform's EXISTING build machinery (all H1-gated). It is
+ * NOT a second brain: an admin's edit request becomes a SCOPED FOLLOW-UP BUILD (a
+ * "patch run") over the app's own git repo, exactly the path the dashboard uses.
+ *
+ * This module owns the NETWORK side of that flow, factored out of AssistantPanel.jsx so
+ * it can be unit-proven against a fake fetch (tests/apps/edit-mode.test.ts). Every call
+ * targets the PLATFORM /api/v1/* API with the admin's platform Bearer - a SEPARATE plane
+ * from the served-app POST /api/app-assistant, which stays visitor-blind (it never reads
+ * the caller JWT). Nothing here grounds, bills, or issues an assistant turn.
+ *
+ * The plane's gates are the server's, not ours:
+ *   - POST /api/v1/jobs { kind:'build', artifactId, description } → a follow-up build,
+ *     gated server-side by can(canEditApps) AND loadWritable(actor, artifactId) (H1).
+ *     A non-admin (no token / plain user / cross-org) is refused there with a uniform
+ *     404, so this front-end can offer the switch freely: the SERVER is the authority.
+ *   - GET  /api/v1/artifacts/:id/versions → the commit list (newest first). We read it
+ *     BEFORE the run (the pre-run head = the rollback target / diff point) and AFTER
+ *     (the new head) for the preview.
+ *   - POST /api/v1/artifacts/:id/versions/:sha/restore → forward-restore to the pre-run
+ *     head (one-click rollback). writable()-gated + canEditApps (H1).
+ *   - GET  /api/v1/jobs/:id/events?token=... → the job SSE (progress narration). The
+ *     job's own owner-scoped stream (?token= = the same admin token that created it).
+ *
+ * Graceful degradation is a first-class outcome: any mid-flow 401/403/404 (token
+ * expired, lost writability, app gone) resolves to a calm PT-PT message, never a throw
+ * and never a crash. PT-PT throughout, no emoji, no em/en-dash.
+ */
+
+/** The build-jobs collection endpoint (a follow-up build is a POST here with artifactId). */
+export const JOBS_ENDPOINT = '/api/v1/jobs';
+
+/** GET the artifact's version list (commits, newest first). */
+export function versionsEndpoint(appId) {
+  return `/api/v1/artifacts/${encodeURIComponent(appId)}/versions`;
+}
+
+/** POST to forward-restore the artifact to `sha` (one-click rollback). */
+export function restoreEndpoint(appId, sha) {
+  return `/api/v1/artifacts/${encodeURIComponent(appId)}/versions/${encodeURIComponent(sha)}/restore`;
+}
+
+/** The job SSE stream. EventSource cannot set headers (CONV-1), so the job stream
+ *  authenticates via ?token= (verifySseToken, the same chain requireAuth runs); we read
+ *  it with fetch (the panel's one transport) rather than EventSource so it stays
+ *  abortable and unit-testable. */
+export function jobEventsUrl(jobId, token) {
+  return `/api/v1/jobs/${encodeURIComponent(jobId)}/events?token=${encodeURIComponent(token)}`;
+}
+
+/** PT-PT copy for the edit flow. Kept here so the panel and the tests share one source
+ *  of truth for the confirmation wording, the progress fallback and the empty-diff note. */
+export const EDIT_COPY = {
+  confirm: 'Vou preparar esta alteração como uma revisão. Confirma?',
+  preparing: 'A preparar a alteração...',
+  applied: 'Alteração aplicada. Reveja antes de aprovar.',
+  noChange: 'A revisão terminou sem alterações ao código.',
+  approved: 'Alteração mantida.',
+  rolledBack: 'Alteração revertida.',
+};
+
+/** Map a mid-flow platform failure onto a calm PT-PT message (graceful degradation).
+ *  401 = the admin's session expired; 403 = writability was lost (no longer an editor);
+ *  404 = the app is gone / not writable; anything else = a generic, non-alarming line. */
+export function degradeMessage(status) {
+  if (status === 401) return 'A sua sessão expirou. Inicie sessão novamente para continuar a editar.';
+  if (status === 403) return 'Já não tem permissão para editar esta aplicação.';
+  if (status === 404) return 'Esta aplicação já não está disponível para edição.';
+  return 'Não foi possível concluir a alteração. Tente novamente mais tarde.';
+}
+
+/** A client-side correlation id for the follow-up build. A follow-up does NOT reserve a
+ *  session (only a first build does); sessionId merely tags the job record + run, so a
+ *  fresh per-edit id is correct and collision-safe. */
+export function newEditSessionId(appId) {
+  const rand = Math.random().toString(36).slice(2, 10);
+  return `edit-${appId || 'app'}-${Date.now()}-${rand}`;
+}
+
+/**
+ * Parse accumulated SSE text into the complete events plus the unparsed remainder. An SSE
+ * event is terminated by a blank line; the job stream carries its JobEvent JSON on
+ * `data:` lines (other fields - `id:`, `event:`, `:` comments - are ignored). The caller
+ * accumulates `rest` and feeds it back with the next chunk, so a frame split across chunk
+ * boundaries is never dropped. A garbled/partial frame is skipped, never thrown.
+ */
+export function parseSseBuffer(buffer) {
+  const events = [];
+  const normalised = String(buffer || '').replace(/\r\n/g, '\n');
+  const chunks = normalised.split('\n\n');
+  const rest = chunks.pop() || ''; // trailing, possibly incomplete frame stays buffered
+  for (const chunk of chunks) {
+    const dataLines = chunk.split('\n').filter((l) => l.startsWith('data:'));
+    if (!dataLines.length) continue;
+    const payload = dataLines.map((l) => l.slice(5).trimStart()).join('\n');
+    if (!payload) continue;
+    try {
+      events.push(JSON.parse(payload));
+    } catch {
+      /* a partial or garbled frame - skip it, never crash the stream */
+    }
+  }
+  return { events, rest };
+}
+
+/**
+ * Start the follow-up build (the patch run) for `appId`. POSTs the H1-gated jobs endpoint
+ * with the admin Bearer. Returns a discriminated result:
+ *   - { ok:true, status:'created', jobId }  - the build was accepted (202)
+ *   - { ok:true, status:'answered', reason} - the in-build classifier resolved it with no
+ *                                             job (e.g. it read the request as a question)
+ *   - { ok:false, status }                  - a refusal (401/403/404/409/...) → the panel
+ *                                             degrades on `status`; the SERVER is the gate
+ * Never throws - a network failure is { ok:false, status:0 }.
+ */
+export async function startEditJob({ fetchImpl, appId, token, description, sessionId }) {
+  let res;
+  try {
+    res = await fetchImpl(JOBS_ENDPOINT, {
+      method: 'POST',
+      headers: {
+        'Content-Type': 'application/json',
+        Authorization: `Bearer ${token}`,
+      },
+      body: JSON.stringify({
+        kind: 'build',
+        description,
+        sessionId: sessionId || newEditSessionId(appId),
+        language: 'pt',
+        artifactId: appId,
+      }),
+    });
+  } catch {
+    return { ok: false, status: 0 };
+  }
+  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
+  let data = null;
+  try {
+    data = await res.json();
+  } catch {
+    data = null;
+  }
+  if (data && data.status === 'answered') {
+    return { ok: true, status: 'answered', reason: typeof data.reason === 'string' ? data.reason : '' };
+  }
+  const jobId = data && data.job && typeof data.job.id === 'string' ? data.job.id : undefined;
+  if (!jobId) return { ok: false, status: res.status };
+  return { ok: true, status: 'created', jobId };
+}
+
+/**
+ * Read the artifact's version list. Returns { ok:true, items, head } where `head` is the
+ * newest commit sha (items[0].sha) or undefined for a fresh repo, or { ok:false, status }
+ * on a refusal. Never throws.
+ */
+export async function readVersions({ fetchImpl, appId, token }) {
+  let res;
+  try {
+    res = await fetchImpl(versionsEndpoint(appId), {
+      method: 'GET',
+      headers: { Authorization: `Bearer ${token}` },
+    });
+  } catch {
+    return { ok: false, status: 0 };
+  }
+  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
+  let data = null;
+  try {
+    data = await res.json();
+  } catch {
+    data = null;
+  }
+  const items = data && Array.isArray(data.items) ? data.items : [];
+  const head = items.length && items[0] && typeof items[0].sha === 'string' ? items[0].sha : undefined;
+  return { ok: true, items, head };
+}
+
+/**
+ * Forward-restore the artifact to `sha` (one-click rollback to the pre-run head). Returns
+ * { ok:true, newHeadSha } or { ok:false, status } on a refusal. Never throws.
+ */
+export async function rollbackToVersion({ fetchImpl, appId, token, sha }) {
+  let res;
+  try {
+    res = await fetchImpl(restoreEndpoint(appId, sha), {
+      method: 'POST',
+      headers: { Authorization: `Bearer ${token}` },
+    });
+  } catch {
+    return { ok: false, status: 0 };
+  }
+  if (!res || !res.ok) return { ok: false, status: res ? res.status : 0 };
+  let data = null;
+  try {
+    data = await res.json();
+  } catch {
+    data = null;
+  }
+  const newHeadSha = data && typeof data.newHeadSha === 'string' ? data.newHeadSha : undefined;
+  return { ok: true, newHeadSha };
+}
+
+/**
+ * Consume the job SSE stream with fetch, forwarding each JobEvent to `onEvent`, and
+ * resolve once a terminal event lands (or the stream ends). Outcomes:
+ *   - { outcome:'complete', event } - the build finished
+ *   - { outcome:'error', event }    - the build failed (JobEvent error)
+ *   - { outcome:'http-error', status } - the stream endpoint refused (e.g. token expired)
+ *   - { outcome:'closed' }          - the stream ended / a network blip with no terminal
+ *                                     event (the caller re-reads versions to see the head)
+ * Never throws.
+ */
+export async function streamJobEvents({ fetchImpl, jobId, token, onEvent, signal }) {
+  let res;
+  try {
+    res = await fetchImpl(jobEventsUrl(jobId, token), {
+      method: 'GET',
+      ...(signal ? { signal } : {}),
+    });
+  } catch {
+    return { outcome: 'closed' };
+  }
+  if (!res || !res.ok) return { outcome: 'http-error', status: res ? res.status : 0 };
+  const body = res.body;
+  if (!body || typeof body.getReader !== 'function') return { outcome: 'closed' };
+
+  const reader = body.getReader();
+  const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
+  let buffer = '';
+  try {
+    for (;;) {
+      const { value, done } = await reader.read();
+      if (done) break;
+      buffer += decoder ? decoder.decode(value, { stream: true }) : String(value || '');
+      const parsed = parseSseBuffer(buffer);
+      buffer = parsed.rest;
+      for (const ev of parsed.events) {
+        if (onEvent) onEvent(ev);
+        if (ev && ev.type === 'complete') {
+          try { await reader.cancel(); } catch { /* already closing */ }
+          return { outcome: 'complete', event: ev };
+        }
+        if (ev && ev.type === 'error') {
+          try { await reader.cancel(); } catch { /* already closing */ }
+          return { outcome: 'error', event: ev };
+        }
+      }
+    }
+  } catch {
+    /* aborted (unmount / timeout) or read error → treated as a soft close */
+  }
+  return { outcome: 'closed' };
+}
+
+/**
+ * Run the whole confirmed patch, front-to-back, as a sequence of the H1-gated platform
+ * calls. Returns a discriminated result the panel maps straight onto its UI; every
+ * network refusal is a graceful outcome, never a throw:
+ *   - { outcome:'ready', preRunSha, newHeadSha } - build done; show APPROVE vs ROLLBACK
+ *   - { outcome:'answered', reason }             - no job (in-build classifier answered)
+ *   - { outcome:'failed', event }                - the build reported an error event
+ *   - { outcome:'degraded', status }             - a mid-flow 401/403/404/... → calm msg
+ *
+ * `onProgress(jobEvent)` receives each streamed JobEvent (the panel narrates plan_step).
+ */
+export async function runEditPatch({ fetchImpl, appId, token, description, onProgress, signal }) {
+  // 1. Capture the pre-run head BEFORE the build - the rollback target and diff point.
+  const before = await readVersions({ fetchImpl, appId, token });
+  if (!before.ok) return { outcome: 'degraded', status: before.status };
+  const preRunSha = before.head;
+
+  // 2. Start the follow-up build (the H1-gated patch run).
+  const started = await startEditJob({
+    fetchImpl,
+    appId,
+    token,
+    description,
+    sessionId: newEditSessionId(appId),
+  });
+  if (!started.ok) return { outcome: 'degraded', status: started.status };
+  if (started.status === 'answered') return { outcome: 'answered', reason: started.reason };
+
+  // 3. Stream the job SSE - live plan_step narration to onProgress.
+  const stream = await streamJobEvents({
+    fetchImpl,
+    jobId: started.jobId,
+    token,
+    signal,
+    onEvent: (ev) => {
+      if (onProgress) onProgress(ev);
+    },
+  });
+  if (stream.outcome === 'http-error') return { outcome: 'degraded', status: stream.status };
+  if (stream.outcome === 'error') return { outcome: 'failed', event: stream.event };
+
+  // 4. Read the new head for the preview (the versions read is the source of truth for the
+  //    head; a soft close still lands here, and an unchanged head reads as "no change").
+  const after = await readVersions({ fetchImpl, appId, token });
+  if (!after.ok) return { outcome: 'degraded', status: after.status };
+  return { outcome: 'ready', preRunSha, newHeadSha: after.head, jobId: started.jobId };
+}
+
+/** A one-line PT-PT narration for a streamed JobEvent (plan_step primarily). Returns null
+ *  for events with nothing worth showing, so the panel keeps the last meaningful line. */
+export function progressLine(ev) {
+  if (!ev || typeof ev !== 'object') return null;
+  if (ev.type === 'plan_step') {
+    const text = ev.description || ev.detail || ev.status;
+    return typeof text === 'string' && text ? text : null;
+  }
+  if (ev.type === 'routing') return 'A preparar a alteração...';
+  return null;
+}
diff --git a/api/tests/apps/assistant-panel.test.ts b/api/tests/apps/assistant-panel.test.ts
index f3827b9..8cc97e4 100644
--- a/api/tests/apps/assistant-panel.test.ts
+++ b/api/tests/apps/assistant-panel.test.ts
@@ -161,10 +161,12 @@ describe('H2 admin detection (detect-then-ask)', () => {
     expect(badge).not.toContain('onClick');
     // `admin` is SET once (the detection) and READ only to render the badge — it drives no action.
     expect((PANEL.match(/setAdmin\(/g) || []).length).toBe(1);
-    // H2 builds no edit-mode machinery / opt-in switch (that is H3): none of the tokens an actual
-    // edit-mode implementation would introduce exist yet. (Comments MAY mention "edit mode" as the
-    // deferred H3 work; these tokens name the affordance itself, so they won't collide with prose.)
-    expect(PANEL).not.toMatch(/setEditMode|editEnabled|isEditing|enterEditMode|edit-mode-toggle/);
+    // H3 now introduces the edit-mode switch (setEditMode), but detect-then-ask still binds: the
+    // DETECTION effect never enables edit mode — it only sets `admin`. (The full H3 opt-in invariants
+    // are pinned in the "H3 edit mode" block below.)
+    const whoamiEffect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
+    expect(whoamiEffect).toContain('setAdmin');
+    expect(whoamiEffect).not.toContain('setEditMode');
     // The invariant is stated in the source so review can pin it.
     expect(PANEL).toContain('detect-then-ask');
     expect(PANEL).toContain('H3');
@@ -180,6 +182,78 @@ describe('H2 admin detection (detect-then-ask)', () => {
   });
 });
 
+describe('H3 edit mode (admins only) — opt-in switch + detect-then-ask wiring', () => {
+  it('the edit-mode switch is ABSENT unless admin, and starts OFF (opt-in, fail-closed)', () => {
+    // editMode starts false: entering edit mode is never the default — it is an explicit opt-in.
+    expect(PANEL).toMatch(/const \[editMode, setEditMode\] = useState\(false\)/);
+    // The admin bar (which holds the switch) is rendered only when detection said admin.
+    expect(PANEL).toContain('ekoa-assistant-adminbar');
+    expect(PANEL).toMatch(/\{admin \? \(/); // admin-gated block
+    // The switch is a real accessible toggle reflecting editMode.
+    expect(PANEL).toContain('ekoa-assistant-editswitch');
+    expect(PANEL).toMatch(/role="switch"/);
+    expect(PANEL).toMatch(/aria-checked=\{editMode\}/);
+  });
+
+  it('enabling the switch reveals the edit affordance (gated on admin && editMode)', () => {
+    // The edit section renders only for an admin who has opted in — not from detection alone.
+    expect(PANEL).toMatch(/admin && editMode \? \(/);
+    expect(PANEL).toContain('ekoa-assistant-edit'); // the distinct edit section
+    expect(PANEL).toContain('data-edit-phase'); // its phase machine (compose→confirm→running→preview→note)
+    // Kept visually distinct from the visitor OPERAR/MOSTRAR/ENSINAR modes so an admin always knows.
+    expect(PANEL).toContain('Modo de edição');
+  });
+
+  it('DETECT-THEN-ASK is binding: edit mode is entered ONLY by an explicit click, never by detection', () => {
+    // setEditMode(true) is reachable through exactly one path: openEditMode (the explicit opt-in).
+    expect(PANEL).toContain('const openEditMode');
+    expect(PANEL).toMatch(/openEditMode[\s\S]{0,120}setEditMode\(true\)/);
+    // The only setEditMode(true) in the file is inside that explicit handler — detection cannot flip it.
+    expect((PANEL.match(/setEditMode\(true\)/g) || []).length).toBe(1);
+    // openEditMode is wired to click handlers (the switch + the discovery CTA), never to an effect.
+    expect((PANEL.match(/onClick=\{[^}]*openEditMode/g) || []).length).toBeGreaterThanOrEqual(1);
+    // The whoami DETECTION effect touches neither the switch nor the discovery state.
+    const whoamiEffect = PANEL.slice(PANEL.indexOf('const id = appId();'), PANEL.indexOf('const nextId = ()'));
+    expect(whoamiEffect).not.toContain('setEditMode');
+    expect(whoamiEffect).not.toContain('openEditMode');
+  });
+
+  it('admin discovery is surfaced once, dismissibly, and NEVER auto-enables edit', () => {
+    // Shown only to a detected admin who has not opted in and not dismissed it.
+    expect(PANEL).toContain('ekoa-assistant-discovery');
+    expect(PANEL).toMatch(/admin && !editMode && !discoveryDismissed \? \(/);
+    // A concrete PT-PT suggestion (the conversion moment), plus a dismiss — non-blocking.
+    expect(PANEL).toContain('Pode pedir alterações a esta aplicação');
+    expect(PANEL).toContain('dismissDiscovery');
+    // The banner's CTA is the same explicit opt-in (a click), so it never auto-enables edit.
+    expect(PANEL).toMatch(/discovery-cta[\s\S]{0,80}onClick=\{openEditMode\}/);
+  });
+
+  it('the edit flow uses the PLATFORM /api/v1/* plane (via edit-mode), NOT the visitor assistant endpoint', () => {
+    // The edit machinery is the separate module (a follow-up build + versions/restore), imported here.
+    expect(PANEL).toContain("from './edit-mode'");
+    expect(PANEL).toContain('runEditPatch'); // POST /api/v1/jobs (the H1-gated follow-up build)
+    expect(PANEL).toContain('rollbackToVersion'); // POST /api/v1/artifacts/:id/versions/:sha/restore
+    // The confirm step gates the patch run behind an explicit confirmation (PT-PT).
+    expect(PANEL).toContain('EDIT_COPY.confirm');
+    expect(PANEL).toMatch(/const confirmEdit[\s\S]{0,600}runEditPatch/);
+    // The served-app POST /api/app-assistant plane stays visitor-blind: the edit handlers never
+    // route through ENDPOINT. runEditPatch/rollbackToVersion drive the /api/v1/* plane instead.
+    const confirmEdit = PANEL.slice(PANEL.indexOf('const confirmEdit'), PANEL.indexOf('const approveEdit'));
+    expect(confirmEdit).not.toContain('ENDPOINT');
+    expect(confirmEdit).not.toContain('/api/app-assistant');
+  });
+
+  it('degrades gracefully on a mid-flow 401/403/404 (a calm PT-PT message, never a crash)', () => {
+    // The panel maps a degraded outcome onto degradeMessage and a terminal 'note' phase.
+    expect(PANEL).toContain('degradeMessage');
+    expect(PANEL).toMatch(/outcome === 'ready'/);
+    expect(PANEL).toMatch(/setEditPhase\('note'\)/);
+    // Rollback is one click and also degrades on a refusal rather than throwing.
+    expect(PANEL).toMatch(/const rollbackEdit[\s\S]{0,600}rollbackToVersion/);
+  });
+});
+
 describe('D2/G2 lazy-load wiring', () => {
   it('the app bundle carries only a plain-DOM launcher (no React) that lazy-loads the platform panel-runtime', () => {
     // Since G2 the panel is NOT baked into the app bundle: mount.js renders a launcher
diff --git a/api/tests/apps/edit-mode.test.ts b/api/tests/apps/edit-mode.test.ts
new file mode 100644
index 0000000..120a878
--- /dev/null
+++ b/api/tests/apps/edit-mode.test.ts
@@ -0,0 +1,276 @@
+import { describe, it, expect, beforeAll } from 'vitest';
+import { readFileSync } from 'node:fs';
+import { fileURLToPath } from 'node:url';
+
+/**
+ * H3 edit mode (admins only) - BEHAVIOURAL unit tests of the panel's edit-flow controller
+ * (api/assets/panel-runtime/src/edit-mode.js). That controller is a browser ASSET compiled by
+ * esbuild (outside the tsc program), so it is imported at RUNTIME via its file URL and driven with
+ * a FAKE fetch - proving the real network flow, not just its source text:
+ *   - the confirmed patch run POSTs /api/v1/jobs { kind:'build', artifactId, description } with the
+ *     admin platform Bearer (a follow-up build over the H1-gated machinery - reused, not rebuilt);
+ *   - the pre-run head is captured BEFORE the run (the rollback target / diff point);
+ *   - rollback POSTs /api/v1/artifacts/:id/versions/:sha/restore (one click, the pre-run head);
+ *   - a mid-flow 401/403/404 resolves to a calm PT-PT message (graceful degradation, never a throw);
+ *   - the job SSE is parsed frame-by-frame (even split across chunk boundaries) into progress.
+ * The heavy end-to-end (a REAL patch run editing a real app + rollback) is the lead's live probe;
+ * here the flow is unit-proven. Every call targets the PLATFORM /api/v1/* plane with the admin
+ * Bearer - a SEPARATE plane from the visitor-blind POST /api/app-assistant.
+ */
+
+// The controller is plain JS (a compiled-by-esbuild browser asset), so tsc cannot resolve it as a
+// typed module; import it at runtime by URL and describe only the shape these tests exercise.
+type FetchInit = { method?: string; headers?: Record<string, string>; body?: string; signal?: unknown };
+type FetchImpl = (url: string, init?: FetchInit) => Promise<unknown>;
+interface JobEvent { type: string; [k: string]: unknown }
+interface EditModeApi {
+  JOBS_ENDPOINT: string;
+  versionsEndpoint(appId: string): string;
+  restoreEndpoint(appId: string, sha: string): string;
+  jobEventsUrl(jobId: string, token: string): string;
+  degradeMessage(status: number): string;
+  parseSseBuffer(buffer: string): { events: JobEvent[]; rest: string };
+  newEditSessionId(appId: string): string;
+  EDIT_COPY: Record<string, string>;
+  progressLine(ev: unknown): string | null;
+  startEditJob(a: { fetchImpl: FetchImpl; appId: string; token: string; description: string; sessionId?: string }): Promise<{ ok: boolean; status?: number | string; jobId?: string; reason?: string }>;
+  readVersions(a: { fetchImpl: FetchImpl; appId: string; token: string }): Promise<{ ok: boolean; status?: number; items?: unknown[]; head?: string }>;
+  rollbackToVersion(a: { fetchImpl: FetchImpl; appId: string; token: string; sha: string }): Promise<{ ok: boolean; status?: number; newHeadSha?: string }>;
+  streamJobEvents(a: { fetchImpl: FetchImpl; jobId: string; token: string; onEvent?: (ev: JobEvent) => void; signal?: unknown }): Promise<{ outcome: string; status?: number; event?: JobEvent }>;
+  runEditPatch(a: { fetchImpl: FetchImpl; appId: string; token: string; description: string; onProgress?: (ev: JobEvent) => void; signal?: unknown }): Promise<{ outcome: string; status?: number; preRunSha?: string; newHeadSha?: string; reason?: string; event?: JobEvent }>;
+}
+
+const MODULE_URL = new URL('../../assets/panel-runtime/src/edit-mode.js', import.meta.url);
+const MODULE_SRC = readFileSync(fileURLToPath(MODULE_URL), 'utf-8');
+
+let em: EditModeApi;
+beforeAll(async () => {
+  em = (await import(/* @vite-ignore */ MODULE_URL.href)) as unknown as EditModeApi;
+});
+
+// --- fake-fetch harness ----------------------------------------------------------------------
+interface Recorded { url: string; method: string; headers: Record<string, string>; body?: string }
+const enc = new TextEncoder();
+
+/** A minimal streaming body (getReader) that yields the given SSE frames as UTF-8 chunks. */
+function sseBody(frames: string[]) {
+  let i = 0;
+  return {
+    getReader() {
+      return {
+        read: async () => (i < frames.length ? { value: enc.encode(frames[i++]), done: false } : { value: undefined, done: true }),
+        cancel: async () => {},
+      };
+    },
+  };
+}
+function jsonRes(status: number, data: unknown) {
+  return { ok: status >= 200 && status < 300, status, json: async () => data };
+}
+
+/**
+ * A scenario fetch: records every call and answers per-endpoint. `versionsHeads` supplies the head
+ * sha for successive /versions reads (runEditPatch reads twice: pre-run then post-run).
+ */
+function scenario(opts: {
+  versionsHeads?: string[];
+  versionsStatus?: number;
+  jobs?: { status: number; data?: unknown };
+  restore?: { status: number; data?: unknown };
+  sseFrames?: string[];
+  sseStatus?: number;
+}) {
+  const calls: Recorded[] = [];
+  let versionsIdx = 0;
+  const fetchImpl: FetchImpl = async (url, init = {}) => {
+    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
+    if (url === em.JOBS_ENDPOINT) {
+      const j = opts.jobs || { status: 202, data: { status: 'created', job: { id: 'job-1', status: 'running' } } };
+      return jsonRes(j.status, j.data ?? {});
+    }
+    if (url.includes('/versions/') && url.endsWith('/restore')) {
+      const r = opts.restore || { status: 200, data: { newHeadSha: 'restored-head' } };
+      return jsonRes(r.status, r.data ?? {});
+    }
+    if (url.endsWith('/versions')) {
+      if (opts.versionsStatus) return jsonRes(opts.versionsStatus, {});
+      const heads = opts.versionsHeads || ['head-a', 'head-b'];
+      const head = heads[Math.min(versionsIdx, heads.length - 1)];
+      versionsIdx += 1;
+      return jsonRes(200, { items: [{ sha: head }, { sha: 'older-1' }] });
+    }
+    if (url.includes('/jobs/') && url.includes('/events')) {
+      if (opts.sseStatus) return jsonRes(opts.sseStatus, {});
+      return { ok: true, status: 200, body: sseBody(opts.sseFrames || ['data: {"type":"complete","durationMs":10}\n\n']) };
+    }
+    return jsonRes(404, {});
+  };
+  return { fetchImpl, calls };
+}
+
+describe('H3 edit-mode controller - endpoints + copy (the admin /api/v1/* plane)', () => {
+  it('builds the platform version + restore + job-event paths (encoded)', () => {
+    expect(em.JOBS_ENDPOINT).toBe('/api/v1/jobs');
+    expect(em.versionsEndpoint('app 1')).toBe('/api/v1/artifacts/app%201/versions');
+    expect(em.restoreEndpoint('app1', 'sha/x')).toBe('/api/v1/artifacts/app1/versions/sha%2Fx/restore');
+    expect(em.jobEventsUrl('job1', 't ok')).toBe('/api/v1/jobs/job1/events?token=t%20ok');
+  });
+
+  it('degradeMessage maps 401/403/404 to distinct calm PT-PT lines (no emoji, no em/en-dash)', () => {
+    const m401 = em.degradeMessage(401);
+    const m403 = em.degradeMessage(403);
+    const m404 = em.degradeMessage(404);
+    const mOther = em.degradeMessage(500);
+    for (const m of [m401, m403, m404, mOther]) {
+      expect(typeof m).toBe('string');
+      expect(m.length).toBeGreaterThan(0);
+      expect(m).not.toMatch(/[–—]/); // no en/em dash
+      expect(m.match(/\p{Extended_Pictographic}/u)).toBeNull(); // no emoji
+    }
+    // 401 (expired session) and 403 (lost writability) read differently.
+    expect(m401).not.toBe(m403);
+    expect(m401).toMatch(/sess/i);
+  });
+
+  it('EDIT_COPY.confirm is the PT-PT confirmation step', () => {
+    expect(em.EDIT_COPY.confirm).toContain('revisão');
+    expect(em.EDIT_COPY.confirm).toContain('Confirma');
+  });
+
+  it('the controller source carries no emoji (UI-code rule)', () => {
+    expect(MODULE_SRC.match(/\p{Extended_Pictographic}/u)).toBeNull();
+  });
+});
+
+describe('H3 startEditJob - the follow-up build (POST /jobs, H1-gated)', () => {
+  it('POSTs /api/v1/jobs { kind:build, artifactId, description } with the admin Bearer', async () => {
+    const { fetchImpl, calls } = scenario({});
+    const r = await em.startEditJob({ fetchImpl, appId: 'app-42', token: 'TKN', description: 'adicione um botão' });
+    expect(r).toEqual({ ok: true, status: 'created', jobId: 'job-1' });
+    const post = calls.find((c) => c.url === '/api/v1/jobs');
+    expect(post).toBeTruthy();
+    expect(post!.method).toBe('POST');
+    expect(post!.headers.Authorization).toBe('Bearer TKN'); // the platform admin JWT
+    const body = JSON.parse(post!.body || '{}');
+    expect(body.kind).toBe('build'); // a build job (a follow-up edits an existing app)
+    expect(body.artifactId).toBe('app-42'); // targets THIS app (server re-gates writability)
+    expect(body.description).toBe('adicione um botão');
+    expect(body.language).toBe('pt');
+    expect(typeof body.sessionId).toBe('string'); // a correlation tag (follow-ups reserve nothing)
+    expect(body.sessionId.length).toBeGreaterThan(0);
+  });
+
+  it('honours the SERVER gate: a 403/404 refusal returns ok:false + the status (front-end degrades)', async () => {
+    const forbidden = scenario({ jobs: { status: 403, data: { error: { code: 'FORBIDDEN' } } } });
+    expect(await em.startEditJob({ fetchImpl: forbidden.fetchImpl, appId: 'a', token: 'T', description: 'x' })).toEqual({ ok: false, status: 403 });
+    const missing = scenario({ jobs: { status: 404, data: {} } });
+    expect(await em.startEditJob({ fetchImpl: missing.fetchImpl, appId: 'a', token: 'T', description: 'x' })).toEqual({ ok: false, status: 404 });
+  });
+
+  it('surfaces an in-build classifier answer (no job created) as status:answered', async () => {
+    const { fetchImpl } = scenario({ jobs: { status: 200, data: { status: 'answered', reason: 'question' } } });
+    const r = await em.startEditJob({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
+    expect(r).toEqual({ ok: true, status: 'answered', reason: 'question' });
+  });
+});
+
+describe('H3 runEditPatch - the confirmed patch flow', () => {
+  it('captures the pre-run head BEFORE the build, streams progress, and returns the new head for preview', async () => {
+    const { fetchImpl, calls } = scenario({
+      versionsHeads: ['before-sha', 'after-sha'],
+      sseFrames: [
+        'data: {"type":"ready","jobId":"job-1"}\n\n',
+        'data: {"type":"plan_step","status":"running","description":"A editar a tabela de honorários"}\n\n',
+        'data: {"type":"complete","durationMs":1200}\n\n',
+      ],
+    });
+    const progress: string[] = [];
+    const r = await em.runEditPatch({
+      fetchImpl,
+      appId: 'app-42',
+      token: 'TKN',
+      description: 'adicione um botão de exportação',
+      onProgress: (ev) => {
+        const line = em.progressLine(ev);
+        if (line) progress.push(line);
+      },
+    });
+    expect(r.outcome).toBe('ready');
+    expect(r.preRunSha).toBe('before-sha'); // the rollback target / diff point
+    expect(r.newHeadSha).toBe('after-sha');
+    expect(progress).toContain('A editar a tabela de honorários'); // plan_step narration surfaced
+
+    // ORDER matters: the pre-run version read must happen BEFORE the POST /jobs, so the rollback
+    // target is the head as it was before the patch.
+    const firstVersions = calls.findIndex((c) => c.url.endsWith('/versions'));
+    const jobsPost = calls.findIndex((c) => c.url === '/api/v1/jobs');
+    expect(firstVersions).toBeGreaterThanOrEqual(0);
+    expect(jobsPost).toBeGreaterThan(firstVersions);
+  });
+
+  it('a mid-flow 401 (expired session) on POST /jobs degrades calmly, never throws', async () => {
+    const { fetchImpl } = scenario({ jobs: { status: 401, data: {} } });
+    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
+    expect(r).toEqual({ outcome: 'degraded', status: 401 });
+    // the panel maps this straight to a calm PT-PT line
+    expect(em.degradeMessage(r.status!)).toMatch(/sess/i);
+  });
+
+  it('a 403 on the pre-run versions read (lost writability) degrades calmly', async () => {
+    const { fetchImpl, calls } = scenario({ versionsStatus: 403 });
+    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
+    expect(r).toEqual({ outcome: 'degraded', status: 403 });
+    // it never reached the build: no POST /jobs was issued.
+    expect(calls.some((c) => c.url === '/api/v1/jobs')).toBe(false);
+  });
+
+  it('a build error event resolves to outcome:failed', async () => {
+    const { fetchImpl } = scenario({
+      versionsHeads: ['before', 'before'],
+      sseFrames: ['data: {"type":"error","code":"BUILD_FAILED","message":"boom"}\n\n'],
+    });
+    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
+    expect(r.outcome).toBe('failed');
+  });
+
+  it('an answered follow-up (no job) resolves to outcome:answered', async () => {
+    const { fetchImpl } = scenario({ jobs: { status: 200, data: { status: 'answered', reason: 'question' } } });
+    const r = await em.runEditPatch({ fetchImpl, appId: 'a', token: 'T', description: 'x' });
+    expect(r.outcome).toBe('answered');
+  });
+});
+
+describe('H3 rollbackToVersion - one-click restore to the pre-run head', () => {
+  it('POSTs /api/v1/artifacts/:id/versions/:sha/restore with the admin Bearer', async () => {
+    const { fetchImpl, calls } = scenario({});
+    const r = await em.rollbackToVersion({ fetchImpl, appId: 'app-42', token: 'TKN', sha: 'before-sha' });
+    expect(r).toEqual({ ok: true, newHeadSha: 'restored-head' });
+    const post = calls.find((c) => c.url.endsWith('/restore'));
+    expect(post).toBeTruthy();
+    expect(post!.url).toBe('/api/v1/artifacts/app-42/versions/before-sha/restore');
+    expect(post!.method).toBe('POST');
+    expect(post!.headers.Authorization).toBe('Bearer TKN');
+  });
+
+  it('a 404 on restore degrades calmly (ok:false + status)', async () => {
+    const { fetchImpl } = scenario({ restore: { status: 404, data: {} } });
+    const r = await em.rollbackToVersion({ fetchImpl, appId: 'a', token: 'T', sha: 's' });
+    expect(r).toEqual({ ok: false, status: 404 });
+  });
+});
+
+describe('H3 parseSseBuffer - job SSE frame parsing', () => {
+  it('parses complete frames, ignores non-data lines, and buffers a partial trailing frame', () => {
+    const buf = ': keep-alive\n\nid: 1\ndata: {"type":"ready","jobId":"j"}\n\ndata: {"type":"plan_step","status":"go"}\n\ndata: {"type":"comp';
+    const { events, rest } = em.parseSseBuffer(buf);
+    expect(events.map((e) => e.type)).toEqual(['ready', 'plan_step']);
+    expect(rest).toContain('"type":"comp'); // the incomplete frame stays buffered
+  });
+
+  it('reassembles a frame split across two chunk reads', () => {
+    const a = em.parseSseBuffer('data: {"type":"plan_');
+    expect(a.events).toEqual([]);
+    const b = em.parseSseBuffer(a.rest + 'step","status":"x"}\n\n');
+    expect(b.events).toEqual([{ type: 'plan_step', status: 'x' }]);
+  });
+});

hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_search started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_search (failed)
user cancelled MCP tool call
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_search started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_search (failed)
user cancelled MCP tool call
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_search started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_search (failed)
user cancelled MCP tool call
codex
I hit a tooling hiccup on the indexed route lookup, so I’m querying the server handlers directly one by one. I only need the auth gates and restore semantics to finish the pass.
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_search started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_search (failed)
user cancelled MCP tool call
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"artifactsRouter|versions/:sha/restore|/versions|loadWritable|canEditApps|JOBS_ENDPOINT|/api/v1/jobs|whoami\" api/src -g '"'!**/*.map'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/server.ts:74:import { artifactsRouter } from './routes/artifacts.js';
api/src/server.ts:571:  // internal paths determine the surface: /api/v1/chat/runs, /api/v1/jobs.
api/src/server.ts:573:  app.use('/api/v1/jobs', jobsRouter(deps));
api/src/server.ts:596:  app.use('/api/v1/artifacts', artifactsRouter(deps));
api/src/agents/seams.ts:327:   * close). The create-time gate on `POST /jobs` (loadWritable in routes/) can go stale before a
api/src/agents/seams.ts:332:   * (loadWritable) and agents/ reaches apps/ only through this seam (tier direction, ch02 §2.7).
api/src/agents/seams.ts:333:   * Verdict mirrors loadWritable: 'ok' | 'notfound' | 'forbidden'.
api/src/apps/app-assistant-route.ts:38:import { loadWritable } from './app-paths.js';
api/src/apps/app-assistant-route.ts:50: * app-assistant plane entry (POST admission AND the H2 whoami detection), so both apply the exact
api/src/apps/app-assistant-route.ts:79: * EXACTLY (routes/jobs.ts): `can(canEditApps)` AND the artifact is writable by this actor
api/src/apps/app-assistant-route.ts:80: * (loadWritable: own always; org-shared within the org ok; another user's private → not-ok;
api/src/apps/app-assistant-route.ts:85: *   - Low (org-admin membership oracle): admin:true only for apps loadWritable already grants, i.e.
api/src/apps/app-assistant-route.ts:91: * NOTE: like the H1 gate, loadWritable is org-scoped, so a super-admin is NOT granted cross-org app
api/src/apps/app-assistant-route.ts:93: * is ever wanted, that is a deliberate policy change to loadWritable/the H1 gate AND this detection
api/src/apps/app-assistant-route.ts:97:  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
api/src/apps/app-assistant-route.ts:107: * (can(canEditApps) + loadWritable). This endpoint does NOT hand-roll a weaker check and adds NO
api/src/apps/app-assistant-route.ts:116:  const { verdict } = await loadWritable(actor, appId); // the SAME writability rule the H1 edit gate uses
api/src/apps/app-assistant-route.ts:237:   * GET /app-assistant/whoami — admin DETECTION for the panel (operator-run H2; detect-then-ask).
api/src/apps/app-assistant-route.ts:242:   * (can(canEditApps) + loadWritable). It NEVER grounds, NEVER bills, NEVER widens admission, and
api/src/apps/app-assistant-route.ts:250:   * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
api/src/apps/app-assistant-route.ts:255:  const whoami = async (req: Request, res: Response): Promise<void> => {
api/src/apps/app-assistant-route.ts:267:    // (can(canEditApps) + loadWritable on the resolved artifact id). Ownership/org is resolved
api/src/apps/app-assistant-route.ts:268:    // server-side inside loadWritable from the artifact record, NEVER from anything the caller
api/src/apps/app-assistant-route.ts:276:  /** A whoami failure (e.g. a store read blowing up) is a 500, never a 4xx: a 4xx here would be an
api/src/apps/app-assistant-route.ts:278:  r.get('/app-assistant/whoami', (req, res) => {
api/src/apps/app-assistant-route.ts:279:    void whoami(req, res).catch((err) => {
api/src/apps/app-assistant-route.ts:280:      console.error('[app-assistant] whoami failed:', err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:19:import { newProjectDir, projectDirFor, patchArtifactData, loadWritable } from './app-paths.js';
api/src/apps/build-mechanics.ts:226:     *  before resuming and fails the job on a non-`ok` verdict. Reuses the same loadWritable rule
api/src/apps/build-mechanics.ts:229:      return (await loadWritable(actor, artifactId)).verdict;
api/src/apps/artifact-bundle.ts:37:import { restoreVersion } from './versions.js';
api/src/apps/artifact-featured-update.ts:26:import { restoreVersion } from './versions.js';
api/src/apps/injected-context.ts:109:    whoami:function(){
api/src/integrations/app-sso.ts:4: * app-declared username/password sign-in, with whoami()/signOut() working identically:
api/src/apps/app-paths.ts:103:export async function loadWritable(
api/src/services/safe-path.ts:6: * artifact file routes, the git/versions pipeline, the archive/download path) and
api/src/auth/capabilities.ts:5: * `loadWritable`/`loadReadable` in apps/app-paths.ts, the org scoping in the users/registo
api/src/auth/capabilities.ts:12: *                 cannot build or change apps — canBuildApps/canEditApps are admin-only).
api/src/auth/capabilities.ts:25:  'super-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
api/src/auth/capabilities.ts:26:  'org-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
api/src/routes/jobs.ts:11:import { loadWritable } from '../apps/app-paths.js';
api/src/routes/jobs.ts:45:      // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
api/src/routes/jobs.ts:49:      // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
api/src/routes/jobs.ts:51:      if (!can(actor, 'canEditApps')) {
api/src/routes/jobs.ts:52:        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
api/src/routes/jobs.ts:56:      // is an existence oracle — it lets any canEditApps holder probe whether a private app exists
api/src/routes/jobs.ts:59:      const { verdict } = await loadWritable(actor, body.artifactId);
api/src/routes/company-space.ts:13:import { loadReadable, loadWritable, projectDirFor } from '../apps/app-paths.js';
api/src/routes/company-space.ts:46:    const { verdict, art } = await loadWritable(actorOf(req), req.params.artifactId as string);
api/src/routes/company-space.ts:58:    const { verdict, art } = await loadWritable(actorOf(req), req.params.artifactId as string);
api/src/routes/artifacts.ts:33:import { loadReadable, loadWritable, projectDirFor, getArtifactById, setFeaturedFlag, isAppArtifact } from '../apps/app-paths.js';
api/src/routes/artifacts.ts:37:import { listVersions, restoreAndRebuild } from '../apps/versions.js';
api/src/routes/artifacts.ts:49:export function artifactsRouter(deps: { now: () => number; genId: () => string }): Router {
api/src/routes/artifacts.ts:67:    const { verdict, art } = await loadWritable(actorOf(req), req.params.id as string);
api/src/routes/artifacts.ts:77:   * snapshot/restore). An in-place edit of a BUILT app additionally requires `canEditApps`
api/src/routes/artifacts.ts:82:    if (isAppArtifact(art) && !can(actorOf(req), 'canEditApps')) {
api/src/routes/artifacts.ts:83:      sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
api/src/routes/artifacts.ts:192:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: in-place app edit → canEditApps
api/src/routes/artifacts.ts:223:  r.get('/:id/versions', async (req: AuthedRequest, res: Response) => {
api/src/routes/artifacts.ts:231:  r.post('/:id/versions/:sha/restore', async (req: AuthedRequest, res: Response) => {
api/src/routes/artifacts.ts:234:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: restoring app code → canEditApps
api/src/routes/artifacts.ts:268:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: writing app source → canEditApps
api/src/routes/artifacts.ts:334:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
api/src/routes/artifacts.ts:359:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
api/src/routes/artifacts.ts:393:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: a backend exists only on an app → canEditApps
api/src/routes/artifacts.ts:403:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: invoking an app's backend → canEditApps

exec
/bin/zsh -lc "rg -n \"restore\\(|versions.*restore|loadWritable\\(|canEditApps|artifactId|kind: 'build'|kind === 'build'|/jobs/:id/events|verifySseToken\" api/src shared/src -g '"'!**/*.map'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/billing/tracker.ts:48:  artifactId?: string;
api/src/billing/tracker.ts:195:    ...(e.artifactId ? { artifactId: e.artifactId } : {}),
api/src/services/preview-token.ts:10: * Shape: `pv1.<artifactId>.<expMs>.<hmac-sha256-hex(artifactId + '.' + expMs)>`, keyed off
api/src/services/preview-token.ts:18:function sig(artifactId: string, expMs: number): string {
api/src/services/preview-token.ts:20:    .update(`${artifactId}.${expMs}`)
api/src/services/preview-token.ts:25:export function mintPreviewToken(artifactId: string, ttlMs: number): string {
api/src/services/preview-token.ts:27:  return `${PREFIX}.${artifactId}.${exp}.${sig(artifactId, exp)}`;
api/src/services/preview-token.ts:30:/** Verify a preview token; returns the artifactId it grants or null (bad shape/sig/expired). */
api/src/services/preview-token.ts:34:  const [, artifactId, expStr, mac] = parts as [string, string, string, string];
api/src/services/preview-token.ts:36:  if (!artifactId || !Number.isFinite(exp) || Date.now() > exp) return null;
api/src/services/preview-token.ts:37:  const expected = sig(artifactId, exp);
api/src/services/preview-token.ts:41:  return timingSafeEqual(a, b) ? artifactId : null;
api/src/services/design-tokens.ts:143:  const artifactId = slugRow ? (slugRow.artifactId as string) : id;
api/src/services/design-tokens.ts:144:  const art = await artifacts.get(artifactId);
api/src/services/platform-crud.ts:82:  ...(s.artifactId != null ? { artifactId: s.artifactId } : {}),
api/src/services/platform-crud.ts:108:  input: { name?: string; type?: string; artifactId?: string },
api/src/services/platform-crud.ts:119:    ...(input.artifactId !== undefined ? { artifactId: input.artifactId } : {}),
api/src/routes/sessions.ts:23:    const body = parseBody(res, SessionCreateRequest, req.body) as { name?: string; type?: string; artifactId?: string } | undefined;
api/src/routes/triggers.ts:15:  z.object({ automationId: z.string(), integrationKey: z.string(), eventName: z.string(), artifactId: z.string().optional() }),
api/src/routes/triggers.ts:16:  z.object({ integrationKey: z.string(), eventName: z.string(), target: z.object({ kind: z.literal('artifact-backend'), artifactId: z.string(), entrypoint: z.string() }) }),
api/src/routes/triggers.ts:45:      const artifactId = (body.target as { artifactId: string }).artifactId;
api/src/routes/triggers.ts:46:      if (!(await loadReadable(actor, artifactId))) return sendError(res, 'NOT_FOUND', 'Artefacto não encontrado.');
api/src/routes/triggers.ts:49:      ? { targetKind: 'artifact-backend' as const, integrationKey: body.integrationKey as string, eventName: body.eventName as string, artifactId: (body.target as { artifactId: string }).artifactId, entrypoint: (body.target as { entrypoint: string }).entrypoint }
api/src/routes/triggers.ts:50:      : { targetKind: 'automation' as const, integrationKey: body.integrationKey as string, eventName: body.eventName as string, automationId: body.automationId as string, artifactId: body.artifactId as string | undefined };
api/src/routes/jobs.ts:9:import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
api/src/routes/jobs.ts:21:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/jobs.ts:44:    if (body.artifactId) {
api/src/routes/jobs.ts:45:      // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
api/src/routes/jobs.ts:49:      // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
api/src/routes/jobs.ts:51:      if (!can(actor, 'canEditApps')) {
api/src/routes/jobs.ts:52:        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
api/src/routes/jobs.ts:56:      // is an existence oracle — it lets any canEditApps holder probe whether a private app exists
api/src/routes/jobs.ts:59:      const { verdict } = await loadWritable(actor, body.artifactId);
api/src/routes/jobs.ts:73:      ...(body.artifactId ? { artifactId: body.artifactId } : {}),
shared/src/jobs.ts:11:    artifactId: z.string().optional(),
shared/src/jobs.ts:39:  artifactId: z.string().optional(),
shared/src/jobs.ts:91:    path: '/api/v1/jobs/:id/events',
api/src/routes/chat.ts:9:import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
api/src/routes/chat.ts:21:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/automations.ts:19:import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
api/src/routes/automations.ts:75:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/notifications.ts:7:import { verifySseToken } from '../auth/middleware.js';
api/src/routes/notifications.ts:14:    const auth = verifySseToken(req.query.token as string | undefined);
shared/src/sessions.ts:23:    artifactId: Id.optional(),
shared/src/sessions.ts:36:    artifactId: Id.optional(),
shared/src/sessions.ts:46:  artifactId: Id.optional(),
shared/src/sessions.ts:68:export const SeedFeaturedRequest = z.object({ artifactId: Id });
shared/src/capabilities.ts:12:  'canEditApps',
api/src/routes/artifacts.ts:67:    const { verdict, art } = await loadWritable(actorOf(req), req.params.id as string);
api/src/routes/artifacts.ts:77:   * snapshot/restore). An in-place edit of a BUILT app additionally requires `canEditApps`
api/src/routes/artifacts.ts:82:    if (isAppArtifact(art) && !can(actorOf(req), 'canEditApps')) {
api/src/routes/artifacts.ts:83:      sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
api/src/routes/artifacts.ts:192:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: in-place app edit → canEditApps
api/src/routes/artifacts.ts:231:  r.post('/:id/versions/:sha/restore', async (req: AuthedRequest, res: Response) => {
api/src/routes/artifacts.ts:234:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: restoring app code → canEditApps
api/src/routes/artifacts.ts:268:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: writing app source → canEditApps
api/src/routes/artifacts.ts:334:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
api/src/routes/artifacts.ts:359:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: mutating an app's data state → canEditApps
api/src/routes/artifacts.ts:393:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: a backend exists only on an app → canEditApps
api/src/routes/artifacts.ts:403:    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: invoking an app's backend → canEditApps
api/src/routes/company-space.ts:8: * (`artifactId`), fixing FC-057.
api/src/routes/company-space.ts:22:    artifactId: art._id,
api/src/routes/company-space.ts:39:  r.get('/:artifactId', async (req: AuthedRequest, res: Response) => {
api/src/routes/company-space.ts:40:    const art = await loadReadable(actorOf(req), req.params.artifactId as string);
api/src/routes/company-space.ts:45:  r.post('/:artifactId/start', async (req: AuthedRequest, res: Response) => {
api/src/routes/company-space.ts:46:    const { verdict, art } = await loadWritable(actorOf(req), req.params.artifactId as string);
api/src/routes/company-space.ts:57:  r.post('/:artifactId/stop', async (req: AuthedRequest, res: Response) => {
api/src/routes/company-space.ts:58:    const { verdict, art } = await loadWritable(actorOf(req), req.params.artifactId as string);
api/src/server.ts:382:  const appScopeOf = async (artifactId: string) => {
api/src/server.ts:383:    const art = await getArtifactById(artifactId);
api/src/server.ts:384:    return sharedScope(artifactId, (art?.userId as string | undefined) ?? '');
api/src/server.ts:401:    return { artifactId: resolved.appId, projectDir: projectDirFor(art) };
api/src/server.ts:452:    invokeArtifactBackend: async (artifactId, entrypoint, event) => {
api/src/server.ts:457:      const art = await getArtifactById(artifactId);
api/src/server.ts:462:        const result = await invokeArtifactBackend(artifactId, entrypoint, {
api/src/knowledge/grounding.ts:66:  if (input.kind === 'build' && !isLegalContext(input.query)) return { block: '', hits: [] };
api/src/auth/jwt.ts:62:  // chokepoint every admission path (requireAuth, verifySseToken, and every ?token= consumer)
api/src/auth/capabilities.ts:12: *                 cannot build or change apps — canBuildApps/canEditApps are admin-only).
api/src/auth/capabilities.ts:25:  'super-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
api/src/auth/capabilities.ts:26:  'org-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
api/src/apps/backend-runtime/index.ts:29:  artifactId: string,
api/src/apps/backend-runtime/index.ts:34:  return getArtifactBackendRuntime().invoke(artifactId, entrypoint, input, opts);
api/src/agents/build.ts:67:  artifactId?: string;
api/src/agents/build.ts:91:  return input.artifactId ? handleFollowUp(input, input.artifactId) : handleFirstBuild(input);
api/src/agents/build.ts:117:    kind: 'build',
api/src/agents/build.ts:125:    kind: 'build',
api/src/agents/build.ts:153:async function handleFollowUp(input: BuildCreateInput, artifactId: string): Promise<BuildCreateResult> {
api/src/agents/build.ts:156:  if (hasLiveJobForArtifact(artifactId) || (await nonTerminalJobForArtifact(artifactId))) {
api/src/agents/build.ts:166:    kind: 'build',
api/src/agents/build.ts:169:    artifactId,
api/src/agents/build.ts:204:    kind: 'build',
api/src/agents/build.ts:208:    artifactId,
api/src/agents/build.ts:213:  auditBuild(input, 'created', { jobId, artifactId }); // Registo (F3)
api/src/agents/build.ts:217:    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: false, artifactId }),
api/src/agents/build.ts:225:  artifactId?: string;
api/src/agents/build.ts:265:  let artifactId = opts.artifactId ?? '';
api/src/agents/build.ts:276:      if (artifactId) await resetArtifactToDraft(artifactId); // artifact stays draft on error (§5.6.2)
api/src/agents/build.ts:318:      artifactId = prep.artifactId;
api/src/agents/build.ts:323:      if (entry) entry.artifactId = artifactId;
api/src/agents/build.ts:324:      await patchJob(jobId, { artifactId });
api/src/agents/build.ts:331:      const writeVerdict = await mech.revalidateWritable(input.actor, artifactId);
api/src/agents/build.ts:342:      const resolved = await mech.resolveFollowUp(artifactId);
api/src/agents/build.ts:355:    if (artifactId && appUrl) {
api/src/agents/build.ts:356:      sink.artifact({ artifactId, appUrl, ...(slug ? { slug } : {}) });
api/src/agents/build.ts:357:      if (projectDir) await mech.watchRebuilds({ artifactId, projectDir, onRebuild: () => sink.previewReload() });
api/src/agents/build.ts:448:      { kind: 'user_work', agentType: 'build', billeeUserId: input.actor.userId, sessionId: input.sessionId, runId: jobId, artifactId },
api/src/agents/build.ts:489:      await mech.persistSdkSessionId(artifactId, capturedSessionId);
api/src/agents/build.ts:493:    const bundle = await mech.finalizeBundle({ artifactId, projectDir });
api/src/agents/build.ts:494:    await mech.snapshot({ artifactId, projectDir, broken: !bundle.ok });
api/src/agents/build.ts:504:    const progress = await mech.assertProgress({ artifactId, projectDir });
api/src/agents/build.ts:535:        artifactId,
api/src/agents/build.ts:565:      sink.complete({ result: completionText, artifactId, slug, appUrl }, input.deps.now() - start);
api/src/agents/build.ts:572:    await mech.activateArtifact({ artifactId, slug, appUrl, ...(projectDir ? { projectDir } : {}) });
api/src/agents/build.ts:574:    mech.screenshot(artifactId);
api/src/agents/build.ts:587:      if (artifactId) await resetArtifactToDraft(artifactId);
api/src/agents/build.ts:599:      if (st === 'completed') auditBuild(input, 'completed', { jobId, ...(artifactId ? { artifactId } : {}) });
api/src/auth/middleware.ts:59:export function verifySseToken(token: string | undefined): { ok: true; claims: JwtClaims } | { ok: false; status: number; code: ErrorCode } {
shared/src/artifacts.ts:311:    path: '/api/v1/artifacts/:id/versions/:sha/restore',
api/src/agents/jobs.ts:25:  artifactId?: string;
api/src/agents/jobs.ts:89:  artifactId?: string;
api/src/agents/jobs.ts:100:    ...(j.artifactId ? { artifactId: j.artifactId } : {}),
api/src/agents/jobs.ts:117:export async function nonTerminalJobForArtifact(artifactId: string): Promise<JobRecord | null> {
api/src/agents/jobs.ts:118:  const rows = (await jobs.find({ artifactId })) as JobRecord[];
api/src/agents/jobs.ts:144:    if (j.artifactId) resetArtifacts.add(j.artifactId);
api/src/agents/jobs.ts:148:    const r = raw as Doc & { status?: string; artifactId?: string };
api/src/agents/jobs.ts:157:    if (r.artifactId) resetArtifacts.add(r.artifactId);
api/src/agents/jobs.ts:161:  for (const artifactId of resetArtifacts) {
api/src/agents/jobs.ts:162:    const updated = await artifacts.update(artifactId, (cur) => ({ ...cur, status: 'draft' }));
api/src/agents/jobs.ts:170:export async function resetArtifactToDraft(artifactId: string): Promise<void> {
api/src/agents/jobs.ts:171:  await artifacts.update(artifactId, (cur) => ({ ...cur, status: 'draft' }));
api/src/apps/backend-runtime/handle-rpc.ts:17: *   1. appId is FIXED by the token (`claims.artifactId`) - a worker can pass any
api/src/apps/backend-runtime/handle-rpc.ts:33:  artifactId: string;
api/src/apps/backend-runtime/handle-rpc.ts:78:  isLive(artifactId: string): boolean;
api/src/apps/backend-runtime/handle-rpc.ts:96:    if (typeof p.artifactId !== 'string' || typeof p.ownerUserId !== 'string') return null;
api/src/apps/backend-runtime/handle-rpc.ts:98:      artifactId: p.artifactId,
api/src/apps/backend-runtime/handle-rpc.ts:128:  if (!ctx.isLive(claims.artifactId)) throw new Error('artifact backend capability has been revoked');
api/src/apps/backend-runtime/handle-rpc.ts:129:  const appId = claims.artifactId; // FIXED by core.
api/src/apps/backend-runtime/handle-rpc.ts:181:        type: 'artifact_notification', artifactId: appId, notificationId: row.id, title: detail.title, body: detail.body,
api/src/agents/chat.ts:97:  const finishComplete = (result: unknown, delegate?: { kind: 'build' | 'integration'; request: Record<string, unknown> }): void => {
api/src/agents/chat.ts:252:      finishComplete('', { kind: 'build', request: { description: findings.build.description } });
api/src/apps/backend-runtime/runtime.ts:71:  artifactId: string;
api/src/apps/backend-runtime/runtime.ts:81:  invoke(artifactId: string, entrypoint: string, input: unknown, opts?: InvokeOptions): Promise<InvokeResult>;
api/src/apps/backend-runtime/runtime.ts:82:  shutdown(artifactId: string): Promise<void>;
api/src/apps/backend-runtime/runtime.ts:83:  revoke(artifactId: string): Promise<{ fullyDrained: boolean }>;
api/src/apps/backend-runtime/runtime.ts:85:  getStatus(artifactId: string): BackendRuntimeStatus;
api/src/apps/backend-runtime/runtime.ts:86:  getInvocations(artifactId: string, limit?: number): InvocationRecord[];
api/src/apps/backend-runtime/runtime.ts:87:  getRecentLogs(artifactId: string, limit?: number): BackendLogEntry[];
api/src/apps/backend-runtime/runtime.ts:88:  setEnabled(artifactId: string, enabled: boolean): void;
api/src/apps/backend-runtime/runtime.ts:89:  isEnabled(artifactId: string): boolean;
api/src/apps/backend-runtime/runtime.ts:103:  getStatus(artifactId: string): BackendRuntimeStatus {
api/src/apps/backend-runtime/runtime.ts:104:    return { artifactId, state: 'stopped', live: false, enabled: true, pending: 0 };
api/src/apps/backend-runtime/runtime.ts:122:  resolveOwner(artifactId: string): Promise<{ ownerUserId: string; sharedData?: boolean } | null>;
api/src/apps/backend-runtime/runtime.ts:123:  resolveBundlePath(artifactId: string): Promise<string | null>;
api/src/apps/backend-runtime/runtime.ts:194:  async invoke(artifactId: string, entrypoint: string, input: unknown, opts: InvokeOptions = {}): Promise<InvokeResult> {
api/src/apps/backend-runtime/runtime.ts:195:    const prev = this.lanes.get(artifactId) ?? Promise.resolve();
api/src/apps/backend-runtime/runtime.ts:197:      () => this.runOne(artifactId, entrypoint, input, opts),
api/src/apps/backend-runtime/runtime.ts:198:      () => this.runOne(artifactId, entrypoint, input, opts),
api/src/apps/backend-runtime/runtime.ts:200:    this.lanes.set(artifactId, run.then(() => undefined, () => undefined));
api/src/apps/backend-runtime/runtime.ts:204:  private async runOne(artifactId: string, entrypoint: string, input: unknown, opts: InvokeOptions): Promise<InvokeResult> {
api/src/apps/backend-runtime/runtime.ts:205:    if (this.revoked.has(artifactId)) return revokedResult();
api/src/apps/backend-runtime/runtime.ts:206:    if (this.disabled.has(artifactId)) return { ok: false, error: 'artifact backend is disabled', logs: [] };
api/src/apps/backend-runtime/runtime.ts:207:    const owner = await this.deps.resolveOwner(artifactId);
api/src/apps/backend-runtime/runtime.ts:208:    if (this.revoked.has(artifactId)) return revokedResult();
api/src/apps/backend-runtime/runtime.ts:209:    if (!owner) return { ok: false, error: `artifact no longer exists: ${artifactId}`, logs: [] };
api/src/apps/backend-runtime/runtime.ts:210:    const bundlePath = await this.deps.resolveBundlePath(artifactId);
api/src/apps/backend-runtime/runtime.ts:211:    if (this.revoked.has(artifactId)) return revokedResult();
api/src/apps/backend-runtime/runtime.ts:215:    const entry = this.ensureEntry(artifactId);
api/src/apps/backend-runtime/runtime.ts:220:      void this.shutdown(artifactId);
api/src/apps/backend-runtime/runtime.ts:223:    if (this.revoked.has(artifactId)) {
api/src/apps/backend-runtime/runtime.ts:224:      void this.shutdown(artifactId);
api/src/apps/backend-runtime/runtime.ts:233:      { artifactId, ownerUserId, sharedData: Boolean(owner.sharedData), scopes: ['appData', 'llm', 'notify'], entrypoint, dryRun },
api/src/apps/backend-runtime/runtime.ts:243:      const timer = setTimeout(() => this.settleByTimeout(artifactId, entry, invokeId, timeoutMs), timeoutMs);
api/src/apps/backend-runtime/runtime.ts:253:    this.recordInvocation(artifactId, {
api/src/apps/backend-runtime/runtime.ts:258:    const live = this.workers.get(artifactId);
api/src/apps/backend-runtime/runtime.ts:259:    if (live && !live.crashed) this.scheduleIdle(artifactId, live);
api/src/apps/backend-runtime/runtime.ts:263:  private ensureEntry(artifactId: string): WorkerEntry {
api/src/apps/backend-runtime/runtime.ts:264:    const existing = this.workers.get(artifactId);
api/src/apps/backend-runtime/runtime.ts:266:    if (existing) this.workers.delete(artifactId);
api/src/apps/backend-runtime/runtime.ts:267:    const entry = this.spawn(artifactId);
api/src/apps/backend-runtime/runtime.ts:268:    this.workers.set(artifactId, entry);
api/src/apps/backend-runtime/runtime.ts:269:    this.liveArtifacts.add(artifactId);
api/src/apps/backend-runtime/runtime.ts:270:    this.crashedArtifacts.delete(artifactId); // a fresh worker clears the prior crash state
api/src/apps/backend-runtime/runtime.ts:274:  private spawn(artifactId: string): WorkerEntry {
api/src/apps/backend-runtime/runtime.ts:277:      workerData: { artifactId },
api/src/apps/backend-runtime/runtime.ts:285:    worker.on('message', (m) => this.onMessage(artifactId, entry, m));
api/src/apps/backend-runtime/runtime.ts:286:    worker.on('error', (err) => this.onWorkerDown(artifactId, entry, `worker error: ${errMsg(err)}`));
api/src/apps/backend-runtime/runtime.ts:288:      if (!entry.crashed && code !== 0) this.onWorkerDown(artifactId, entry, `worker exited unexpectedly (code ${code})`);
api/src/apps/backend-runtime/runtime.ts:304:  private onMessage(artifactId: string, entry: WorkerEntry, m: unknown): void {
api/src/apps/backend-runtime/runtime.ts:317:        void this.onRpc(artifactId, entry, msg as unknown as RpcMessage);
api/src/apps/backend-runtime/runtime.ts:325:  private async onRpc(artifactId: string, entry: WorkerEntry, m: RpcMessage): Promise<void> {
api/src/apps/backend-runtime/runtime.ts:332:    if (claims.artifactId !== artifactId) return reply(false, undefined, 'capability token artifact mismatch');
api/src/apps/backend-runtime/runtime.ts:351:    if (isMutatingCapability(m.method)) this.trackRpc(artifactId, exec);
api/src/apps/backend-runtime/runtime.ts:355:  private trackRpc(artifactId: string, p: Promise<void>): void {
api/src/apps/backend-runtime/runtime.ts:356:    let set = this.activeRpcs.get(artifactId);
api/src/apps/backend-runtime/runtime.ts:357:    if (!set) { set = new Set(); this.activeRpcs.set(artifactId, set); }
api/src/apps/backend-runtime/runtime.ts:361:      if (set!.size === 0 && this.activeRpcs.get(artifactId) === set) this.activeRpcs.delete(artifactId);
api/src/apps/backend-runtime/runtime.ts:365:  private async drainActiveRpcs(artifactId: string, timeoutMs = DRAIN_BACKSTOP_MS): Promise<boolean> {
api/src/apps/backend-runtime/runtime.ts:366:    const set = this.activeRpcs.get(artifactId);
api/src/apps/backend-runtime/runtime.ts:385:  private settleByTimeout(artifactId: string, entry: WorkerEntry, invokeId: string, timeoutMs: number): void {
api/src/apps/backend-runtime/runtime.ts:392:    void this.shutdown(artifactId);
api/src/apps/backend-runtime/runtime.ts:395:  private onWorkerDown(artifactId: string, entry: WorkerEntry, reason: string): void {
api/src/apps/backend-runtime/runtime.ts:398:    this.crashedArtifacts.add(artifactId); // unexpected death -> the 'crashed' state
api/src/apps/backend-runtime/runtime.ts:399:    this.liveArtifacts.delete(artifactId);
api/src/apps/backend-runtime/runtime.ts:400:    if (this.workers.get(artifactId) === entry) this.workers.delete(artifactId);
api/src/apps/backend-runtime/runtime.ts:409:  private scheduleIdle(artifactId: string, entry: WorkerEntry): void {
api/src/apps/backend-runtime/runtime.ts:411:    entry.idleTimer = setTimeout(() => { void this.shutdown(artifactId); }, this.idleTimeoutMs);
api/src/apps/backend-runtime/runtime.ts:415:  private recordInvocation(artifactId: string, rec: InvocationRecord): void {
api/src/apps/backend-runtime/runtime.ts:416:    const list = this.invocations.get(artifactId) ?? [];
api/src/apps/backend-runtime/runtime.ts:419:    this.invocations.set(artifactId, list);
api/src/apps/backend-runtime/runtime.ts:422:  async shutdown(artifactId: string): Promise<void> {
api/src/apps/backend-runtime/runtime.ts:423:    this.liveArtifacts.delete(artifactId);
api/src/apps/backend-runtime/runtime.ts:424:    const entry = this.workers.get(artifactId);
api/src/apps/backend-runtime/runtime.ts:426:    this.workers.delete(artifactId);
api/src/apps/backend-runtime/runtime.ts:428:    this.crashedArtifacts.delete(artifactId); // a clean shutdown is 'stopped', not 'crashed'
api/src/apps/backend-runtime/runtime.ts:437:  async revoke(artifactId: string): Promise<{ fullyDrained: boolean }> {
api/src/apps/backend-runtime/runtime.ts:439:    this.revoked.add(artifactId);
api/src/apps/backend-runtime/runtime.ts:441:    this.liveArtifacts.delete(artifactId);
api/src/apps/backend-runtime/runtime.ts:443:    const fullyDrained = await this.drainActiveRpcs(artifactId);
api/src/apps/backend-runtime/runtime.ts:445:      console.warn(`[artifact-backend] revoke(${artifactId}): a mutating capability call did not settle within ${DRAIN_BACKSTOP_MS}ms; a late commit could land in (now-orphaned) app-data`);
api/src/apps/backend-runtime/runtime.ts:448:    await this.shutdown(artifactId);
api/src/apps/backend-runtime/runtime.ts:456:  setEnabled(artifactId: string, enabled: boolean): void {
api/src/apps/backend-runtime/runtime.ts:458:      this.disabled.delete(artifactId);
api/src/apps/backend-runtime/runtime.ts:460:      this.disabled.add(artifactId);
api/src/apps/backend-runtime/runtime.ts:461:      void this.shutdown(artifactId);
api/src/apps/backend-runtime/runtime.ts:465:  isEnabled(artifactId: string): boolean {
api/src/apps/backend-runtime/runtime.ts:466:    return !this.disabled.has(artifactId);
api/src/apps/backend-runtime/runtime.ts:469:  getStatus(artifactId: string): BackendRuntimeStatus {
api/src/apps/backend-runtime/runtime.ts:470:    const entry = this.workers.get(artifactId);
api/src/apps/backend-runtime/runtime.ts:471:    const history = this.invocations.get(artifactId) ?? [];
api/src/apps/backend-runtime/runtime.ts:473:    const enabled = !this.disabled.has(artifactId);
api/src/apps/backend-runtime/runtime.ts:477:    else if (this.crashedArtifacts.has(artifactId)) state = 'crashed';
api/src/apps/backend-runtime/runtime.ts:480:      artifactId, state, live: !!entry && !entry.crashed, enabled,
api/src/apps/backend-runtime/runtime.ts:486:  getInvocations(artifactId: string, limit = 20): InvocationRecord[] {
api/src/apps/backend-runtime/runtime.ts:487:    return (this.invocations.get(artifactId) ?? []).slice(0, limit);
api/src/apps/backend-runtime/runtime.ts:490:  getRecentLogs(artifactId: string, limit = 100): BackendLogEntry[] {
api/src/apps/backend-runtime/runtime.ts:492:    for (const inv of this.invocations.get(artifactId) ?? []) {
api/src/apps/backend-runtime/runtime.ts:527:    resolveOwner: async (artifactId) => {
api/src/apps/backend-runtime/runtime.ts:529:      const art = await artifacts.get(artifactId);
api/src/apps/backend-runtime/runtime.ts:541:    resolveBundlePath: async (artifactId) => {
api/src/apps/backend-runtime/runtime.ts:544:      const art = await artifacts.get(artifactId);
api/src/agents/registry.ts:33:  artifactId?: string;
api/src/agents/registry.ts:52:  artifactId?: string;
api/src/agents/registry.ts:65:    artifactId: input.artifactId,
api/src/agents/registry.ts:123:/** True when a run targeting `artifactId` is still live (the follow-up 409 query, §5.3.5). */
api/src/agents/registry.ts:124:export function hasLiveJobForArtifact(artifactId: string): boolean {
api/src/agents/registry.ts:126:    if (e.kind === 'build' && e.artifactId === artifactId && !e.finalized) return true;
api/src/agents/registry.ts:149:  if (actor.role === 'org-admin' && entry.kind === 'build' && entry.orgId && entry.orgId === actor.orgId) return true;
api/src/agents/seams.ts:251:  artifactId: string;
api/src/agents/seams.ts:292:  artifactId: string;
api/src/agents/seams.ts:324:  resolveFollowUp(artifactId: string): Promise<FollowUpResolution | null>;
api/src/agents/seams.ts:326:   * Re-validate at EXECUTION time that `actor` may still WRITE `artifactId` (H1 MEDIUM, TOCTOU
api/src/agents/seams.ts:335:  revalidateWritable(actor: Actor, artifactId: string): Promise<'ok' | 'notfound' | 'forbidden'>;
api/src/agents/seams.ts:337:  finalizeBundle(input: { artifactId: string; projectDir: string }): Promise<{ ok: boolean; error?: string }>;
api/src/agents/seams.ts:339:  snapshot(input: { artifactId: string; projectDir: string; broken: boolean }): Promise<void>;
api/src/agents/seams.ts:341:  screenshot(artifactId: string): void;
api/src/agents/seams.ts:343:  persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void>;
api/src/agents/seams.ts:345:  activateArtifact(input: { artifactId: string; slug: string; appUrl: string; projectDir?: string }): Promise<void>;
api/src/agents/seams.ts:349:  watchRebuilds(input: { artifactId: string; projectDir: string; onRebuild: () => void }): Promise<void>;
api/src/agents/seams.ts:357:  assertProgress(input: { artifactId: string; projectDir: string }): Promise<{ clean: boolean; reasons: string[] }>;
api/src/agents/seams.ts:362:    return { artifactId: `art_${input.sessionId}`, projectDir: '', slug: 'app', appUrl: '' };
shared/src/triggers.ts:12:    artifactId: Id.optional(),
shared/src/triggers.ts:33:  artifactId: Id.optional(),
shared/src/triggers.ts:41:    artifactId: Id,
shared/src/events.ts:56:/** 2. GET /api/v1/jobs/:id/events — build + brand-research (ch03 §3.6.2). */
shared/src/events.ts:88:    artifactId: z.string(),
shared/src/events.ts:96:    artifactId: z.string().optional(),
shared/src/events.ts:185:    request: z.object({ description: z.string(), artifactId: z.string().optional() }).passthrough(),
api/src/apps/artifact-bundle.ts:139:  await slugs.put({ _id: slug, artifactId: newId });
api/src/agents/streaming.ts:78:  complete(result: unknown, durationMs: number, delegate?: { kind: 'build' | 'integration'; request: Record<string, unknown> }): void {
api/src/agents/streaming.ts:117:  artifact(payload: { artifactId: string; appUrl: string; slug?: string }): void {
api/src/agents/streaming.ts:120:  complete(payload: { result?: unknown; artifactId?: string; slug?: string; appUrl?: string }, durationMs: number): void {
api/src/agents/streaming.ts:131:export function emitBuildIntent(userId: string, ev: { sessionId: string; sourceRunId: string; request: { description: string; artifactId?: string } }): void {
api/src/apps/app-assistant.ts:17: *  - Billing is `assistant-chat` (a UserWorkAgentType) billed to the artifact OWNER + artifactId —
api/src/apps/app-assistant.ts:52:  artifactId: string;
api/src/apps/app-assistant.ts:278:  // assistant-chat is a UserWorkAgentType — billed to the ARTIFACT OWNER + artifactId, never the
api/src/apps/app-assistant.ts:284:    artifactId: input.artifactId,
api/src/apps/serving.ts:73:interface ServedJobRow extends Doc { status?: string; artifactId?: string; createdAt?: string; error?: { code: string; message: string } }
api/src/apps/serving.ts:82:async function servedBuildDisposition(artifactId: string): Promise<'failed' | 'ok' | 'building'> {
api/src/apps/serving.ts:83:  const rows = (await jobs.find({ artifactId })) as ServedJobRow[];
api/src/apps/serving.ts:516:      const artifactId = getAppIdBySlug(appIdParam) ?? appIdParam;
api/src/apps/serving.ts:517:      const art = (await artifacts.get(artifactId)) as Doc | null;
api/src/apps/serving.ts:523:        .filter((t) => t.appId === artifactId);
api/src/apps/artifact-featured-update.ts:91:  artifactId: string,
api/src/apps/artifact-featured-update.ts:94:  const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
api/src/apps/artifact-featured-update.ts:95:  if (!art) throw new Error(`ArtifactNotFound: ${artifactId}`);
api/src/apps/artifact-featured-update.ts:109:  if (!existsSync(scaffoldDir)) throw new Error(`FeaturedScaffoldMissing: no scaffold on disk for ${artifactId}`);
api/src/apps/artifact-featured-update.ts:116:  const snapshot = await backups.saveSnapshot(artifactId, 'safety-net');
api/src/apps/artifact-featured-update.ts:138:    try { await appBuilder.unwatch(artifactId); } catch { /* not watched */ }
api/src/apps/artifact-featured-update.ts:139:    const result = await appBuilder.build(artifactId, workingDir);
api/src/apps/artifact-featured-update.ts:145:      await appBuilder.build(artifactId, workingDir);
api/src/apps/artifact-featured-update.ts:153:  await patchArtifactData(artifactId, { projectDir: workingDir, customized: true, seededVersion: manifestVersion, updateAvailable: null });
api/src/apps/artifact-featured-update.ts:155:    await appRegistry.register(artifactId, workingDir, art.userId, art.name);
api/src/apps/artifact-featured-update.ts:157:    console.warn(`[featured-update] post-update register failed for ${artifactId}:`, err instanceof Error ? err.message : err);
api/src/apps/artifact-featured-update.ts:167:export async function ignoreFeaturedUpdate(artifactId: string): Promise<ArtifactDoc> {
api/src/apps/artifact-featured-update.ts:168:  const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
api/src/apps/artifact-featured-update.ts:169:  if (!art) throw new Error(`ArtifactNotFound: ${artifactId}`);
api/src/apps/artifact-featured-update.ts:178:  return (await patchArtifactData(artifactId, patch)) as ArtifactDoc;
api/src/apps/featured-seeder.ts:149:      await slugs.put({ _id: slug, artifactId: manifest.id });
api/src/apps/featured-seeder.ts:175:    await slugs.put({ _id: manifest.id, artifactId: manifest.id });
api/src/legal/transcricao.ts:200:  artifactId?: string;
api/src/legal/transcricao.ts:209:  params: { userId: string; sessionId: string; engine: string; durationSec: number; artifactId?: string },
api/src/legal/transcricao.ts:221:      artifactId: params.artifactId,
api/src/apps/slug-index.ts:19:export function indexSlug(slug: string, artifactId: string): void {
api/src/apps/slug-index.ts:20:  if (artifactId) index.set(slug, artifactId);
api/src/apps/slug-index.ts:32:    const artifactId = (row as { artifactId?: string }).artifactId;
api/src/apps/slug-index.ts:33:    if (artifactId) index.set(row._id, artifactId);
shared/src/app-assistant.ts:89: *  whether the current viewer is an admin of the app OWNER's org WITH the `canEditApps` capability.
api/src/apps/app-assistant-route.ts:34:import { verifySseToken } from '../auth/middleware.js';
api/src/apps/app-assistant-route.ts:79: * EXACTLY (routes/jobs.ts): `can(canEditApps)` AND the artifact is writable by this actor
api/src/apps/app-assistant-route.ts:97:  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
api/src/apps/app-assistant-route.ts:105: * not-writable one. The verification is the EXACT chain requireAuth/verifySseToken run (verifyToken
api/src/apps/app-assistant-route.ts:107: * (can(canEditApps) + loadWritable). This endpoint does NOT hand-roll a weaker check and adds NO
api/src/apps/app-assistant-route.ts:113:  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
api/src/apps/app-assistant-route.ts:116:  const { verdict } = await loadWritable(actor, appId); // the SAME writability rule the H1 edit gate uses
api/src/apps/app-assistant-route.ts:123:  artifactId: string;
api/src/apps/app-assistant-route.ts:181:    req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
api/src/apps/app-assistant-route.ts:218:          artifactId: admission.artifactId,
api/src/apps/app-assistant-route.ts:242:   * (can(canEditApps) + loadWritable). It NEVER grounds, NEVER bills, NEVER widens admission, and
api/src/apps/app-assistant-route.ts:267:    // (can(canEditApps) + loadWritable on the resolved artifact id). Ownership/org is resolved
api/src/apps/build-mechanics.ts:146:    }): Promise<{ artifactId: string; projectDir: string; slug: string; appUrl: string; basePromptSections?: string[] }> {
api/src/apps/build-mechanics.ts:148:      const artifactId = deps.genId();
api/src/apps/build-mechanics.ts:153:      await slugs.put({ _id: slug, artifactId });
api/src/apps/build-mechanics.ts:154:      indexSlug(slug, artifactId);
api/src/apps/build-mechanics.ts:156:      const projectDir = newProjectDir(input.userId, artifactId);
api/src/apps/build-mechanics.ts:157:      const appUrl = `/apps/${artifactId}/`;
api/src/apps/build-mechanics.ts:161:        _id: artifactId,
api/src/apps/build-mechanics.ts:175:        appId: artifactId,
api/src/apps/build-mechanics.ts:192:        await appBuilder.build(artifactId, projectDir);
api/src/apps/build-mechanics.ts:193:        await appBuilder.watch(artifactId, projectDir);
api/src/apps/build-mechanics.ts:195:        console.warn(`[build-mechanics] ${artifactId}: initial build/watch failed (non-fatal):`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:197:      await appRegistry.register(artifactId, projectDir, input.userId, name);
api/src/apps/build-mechanics.ts:199:      return { artifactId, projectDir, slug, appUrl, ...(base ? { basePromptSections: base.promptSections } : {}) };
api/src/apps/build-mechanics.ts:206:    async resolveFollowUp(artifactId: string): Promise<{ projectDir: string; resumeSessionId?: string; slug: string; appUrl: string; basePromptSections?: string[] } | null> {
api/src/apps/build-mechanics.ts:207:      const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
api/src/apps/build-mechanics.ts:212:      const appUrl = typeof data.appUrl === 'string' && data.appUrl ? data.appUrl : `/apps/${artifactId}/`;
api/src/apps/build-mechanics.ts:228:    async revalidateWritable(actor: Actor, artifactId: string): Promise<'ok' | 'notfound' | 'forbidden'> {
api/src/apps/build-mechanics.ts:229:      return (await loadWritable(actor, artifactId)).verdict;
api/src/apps/build-mechanics.ts:237:    async finalizeBundle(input: { artifactId: string; projectDir: string }): Promise<{ ok: boolean; error?: string }> {
api/src/apps/build-mechanics.ts:238:      await appBuilder.unwatch(input.artifactId);
api/src/apps/build-mechanics.ts:243:        const result = await appBuilder.build(input.artifactId, input.projectDir);
api/src/apps/build-mechanics.ts:261:    async snapshot(input: { artifactId: string; projectDir: string; broken: boolean }): Promise<void> {
api/src/apps/build-mechanics.ts:262:      const art = (await artifacts.get(input.artifactId)) as ArtifactDoc | null;
api/src/apps/build-mechanics.ts:278:        console.warn(`[build-mechanics] ${input.artifactId}: version snapshot failed (non-fatal):`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:285:    screenshot(artifactId: string): void {
api/src/apps/build-mechanics.ts:287:      void captureArtifactScreenshot(artifactId).catch((err) => {
api/src/apps/build-mechanics.ts:289:          `[build-mechanics] ${artifactId}: screenshot capture failed (non-fatal):`,
api/src/apps/build-mechanics.ts:296:    async persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void> {
api/src/apps/build-mechanics.ts:297:      const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
api/src/apps/build-mechanics.ts:300:      await patchArtifactData(artifactId, { sdkSessionId });
api/src/apps/build-mechanics.ts:308:    async watchRebuilds(input: { artifactId: string; projectDir: string; onRebuild: () => void }): Promise<void> {
api/src/apps/build-mechanics.ts:310:        await appBuilder.watch(input.artifactId, input.projectDir, input.onRebuild);
api/src/apps/build-mechanics.ts:312:        console.warn(`[build-mechanics] ${input.artifactId}: watch-for-preview failed (non-fatal):`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:318:    async activateArtifact(input: { artifactId: string; slug: string; appUrl: string; projectDir?: string }): Promise<void> {
api/src/apps/build-mechanics.ts:333:            console.warn(`[build-mechanics] ${input.artifactId}: ui_actions invalid — ${res.error}`);
api/src/apps/build-mechanics.ts:337:          console.warn(`[build-mechanics] ${input.artifactId}: ui_actions read failed (non-fatal):`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:352:          const res = await readTours(input.projectDir, { appId: input.artifactId, knownTargets: actionTargets });
api/src/apps/build-mechanics.ts:355:            for (const w of res.warnings) console.warn(`[build-mechanics] ${input.artifactId}: tour warning — ${w}`);
api/src/apps/build-mechanics.ts:357:            console.warn(`[build-mechanics] ${input.artifactId}: tours invalid — ${res.error}`);
api/src/apps/build-mechanics.ts:361:          console.warn(`[build-mechanics] ${input.artifactId}: tours read failed (non-fatal):`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:365:      await artifacts.update(input.artifactId, (a) => {
api/src/apps/build-mechanics.ts:390:    async assertProgress(input: { artifactId: string; projectDir: string }): Promise<{ clean: boolean; reasons: string[] }> {
api/src/llm/attribution.ts:48: *     artifact owner and stamp `artifactId`.
api/src/llm/attribution.ts:59:      artifactId?: string;
api/src/apps/registry.ts:25:  // Try slug first (the slugs reservation collection maps slug → artifactId).
api/src/apps/registry.ts:27:  const artifactId = slugRow ? (slugRow.artifactId as string) : idOrSlug;
api/src/apps/registry.ts:28:  const art = await artifacts.get(artifactId);
shared/src/contract.test.ts:40:        '/api/v1/jobs/:id/events',
shared/src/contract.test.ts:76:    expect(JobCreateRequest.safeParse({ kind: 'build', description: 'x', sessionId: 's' }).success).toBe(true);
shared/src/contract.test.ts:91:        target: { kind: 'artifact-backend', artifactId: 'x', entrypoint: 'main' },
api/src/llm/client.ts:585:    if (attribution.artifactId) base.artifactId = attribution.artifactId;
api/src/apps/artifact-fork.ts:74:  await slugs.put({ _id: slug, artifactId: newId });
api/src/apps/versions.ts:143:  artifactId: string,
api/src/apps/versions.ts:149:    await appBuilder.unwatch(artifactId);
api/src/apps/versions.ts:150:    await appBuilder.build(artifactId, params.projectDir);
api/src/apps/versions.ts:152:    console.warn(`[versions] post-restore build failed for ${artifactId}:`, err instanceof Error ? err.message : err);
api/src/apps/versions.ts:155:  backupAppRepoSafe(params.projectDir, { appId: artifactId, appName });
api/src/legal/router.ts:182:          { userId: app.ownerUserId, sessionId: transcricaoId, engine: result.engine, durationSec: result.durationSec, artifactId: app.appId },
api/src/apps/health-scanner.ts:31:  isRegistered?: (artifactId: string) => boolean;
api/src/events/delivery.ts:46:  invokeArtifactBackend(artifactId: string, entrypoint: string, event: DeliveryEvent): Promise<DeliveryOutcome>;
api/src/events/delivery.ts:91:      if (!trigger.artifactId || !trigger.entrypoint) {
api/src/events/delivery.ts:95:      outcome = await targets.invokeArtifactBackend(trigger.artifactId, trigger.entrypoint, event);
api/src/apps/verify-runner.ts:40:  artifactId: string;
api/src/apps/verify-runner.ts:63:export function resolveVerifyUrl(appUrl: string, artifactId?: string, ttlMs?: number): string {
api/src/apps/verify-runner.ts:67:  if (!artifactId) return base;
api/src/apps/verify-runner.ts:68:  const token = mintPreviewToken(artifactId, ttlMs ?? 600_000);
api/src/apps/verify-runner.ts:88:        prompt: buildPrompt({ ...input, appUrl: resolveVerifyUrl(input.appUrl, input.artifactId, cfg.verifyWallClockMs + 120_000) }),
api/src/apps/verify-runner.ts:98:      { kind: 'user_work', agentType: 'build-verify', billeeUserId: input.userId, artifactId: input.artifactId },
api/src/apps/verify-runner.ts:120:    console.warn(`[verify] ${input.artifactId}: runner failed:`, raw);
api/src/apps/assistant-tools.ts:83:    artifactId: string;
api/src/apps/assistant-tools.ts:94:    artifactId: input.artifactId,
api/src/data/stores.ts:55:  artifactId?: string;
api/src/apps/app-paths.ts:103:export async function loadWritable(
api/src/apps/artifacts-service.ts:69:  if (await slugs.insert({ _id: base, artifactId: '' })) return base;
api/src/apps/artifacts-service.ts:71:    if (await slugs.insert({ _id: `${base}-${n}`, artifactId: '' })) return `${base}-${n}`;
api/src/apps/artifacts-service.ts:85:  await slugs.put({ _id: slug, artifactId: id }); // point the reservation at the new artifact
api/src/apps/artifacts-service.ts:101:    const ok = await slugs.insert({ _id: patch.slug, artifactId: id });
api/src/automation/types.ts:110:  artifactId: string;
api/src/automation/platform-primitives.ts:68:  artifactId: string;
api/src/automation/platform-primitives.ts:97:        const items = await getAppDataStore().list(ctx.artifactId, p.collection);
api/src/automation/platform-primitives.ts:104:        const item = await getAppDataStore().get(ctx.artifactId, p.collection, id);
api/src/automation/platform-primitives.ts:111:        const item = await getAppDataStore().create(ctx.artifactId, p.collection, data);
api/src/automation/platform-primitives.ts:119:        const item = await getAppDataStore().update(ctx.artifactId, p.collection, id, patch);
api/src/automation/platform-primitives.ts:126:        const ok = await getAppDataStore().delete(ctx.artifactId, p.collection, id);
api/src/automation/platform-primitives.ts:132:        const all = await getAppDataStore().list(ctx.artifactId, p.collection);
api/src/automation/seams.ts:187:  list(artifactId: string, collection: string): Promise<Array<Record<string, unknown>>>;
api/src/automation/seams.ts:188:  get(artifactId: string, collection: string, id: string): Promise<Record<string, unknown> | null>;
api/src/automation/seams.ts:189:  create(artifactId: string, collection: string, data: Record<string, unknown>): Promise<{ id: string } & Record<string, unknown>>;
api/src/automation/seams.ts:190:  update(artifactId: string, collection: string, id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>>;
api/src/automation/seams.ts:191:  delete(artifactId: string, collection: string, id: string): Promise<boolean>;
api/src/automation/seams.ts:218:  artifactId: string;
api/src/events/service.ts:24:  artifactId?: string;
api/src/events/service.ts:41:    artifactId: t.artifactId,
api/src/events/service.ts:53:  automationId?: string; artifactId?: string; entrypoint?: string; secret?: string; algorithm?: WebhookAlgorithm;
api/src/events/service.ts:65:    artifactId: input.artifactId,
api/src/automation/executors/ekoa-action.ts:86:  const { artifactId, projectDir } = resolution;
api/src/automation/executors/ekoa-action.ts:138:    artifactId,
api/src/automation/executors/ekoa-action.ts:161:      resolvedAction: makeResolved(artifactId, capability.name, capability.recipe, manifest.revision),
api/src/automation/executors/ekoa-action.ts:179:    resolvedAction: makeResolved(artifactId, capability.name, capability.recipe, manifest.revision),
api/src/automation/executors/ekoa-action.ts:184:  artifactId: string,
api/src/automation/executors/ekoa-action.ts:189:  return { kind: 'ekoa_action', artifactId, capabilityName, recipeSnapshot, manifestRev: revision };
api/src/automation/executors/ekoa-action.ts:214:  artifactId: string;
api/src/automation/executors/ekoa-action.ts:235:    artifactId: resolution.artifactId,
shared/src/company-space.ts:8:    artifactId: Id,
shared/src/company-space.ts:46:    path: '/api/v1/company-space/:artifactId',
shared/src/company-space.ts:52:    path: '/api/v1/company-space/:artifactId/start',
shared/src/company-space.ts:58:    path: '/api/v1/company-space/:artifactId/stop',

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,120p' api/src/routes/jobs.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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
      // LOW oracle fix: collapse 'forbidden' (another user's PRIVATE artifact in the same org) into
      // the SAME 404 as missing/cross-org, LOCAL to the follow-up build gate. A distinct 403 here
      // is an existence oracle — it lets any canEditApps holder probe whether a private app exists
      // by id. Security over the H1 brief's 403/404 split (that split stays on the artifact routes,
      // which may legitimately distinguish); here writability failing for ANY reason reads as 404.
      const { verdict } = await loadWritable(actor, body.artifactId);
      if (verdict !== 'ok') return notFound(res);
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

exec
/bin/zsh -lc "sed -n '60,120p' api/src/routes/artifacts.ts && sed -n '223,245p' api/src/routes/artifacts.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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

  /**
   * H1 HIGH-2 app-edit capability gate. `writable()`/ownership passes for an artifact the actor
   * OWNS — but a plain `user` OWNS the apps they created, so ownership alone lets them change app
   * CODE (bundle-update, file write, version restore, backend toggle/sample-run, app-data
   * snapshot/restore). An in-place edit of a BUILT app additionally requires `canEditApps`
   * (admin-only). NON-app artifacts stay user-manageable (the check is app-type-aware). Returns
   * true (and writes the FORBIDDEN + details.capability refusal) when the edit is denied.
   */
  function denyAppEdit(req: AuthedRequest, res: Response, art: ArtifactDoc): boolean {
    if (isAppArtifact(art) && !can(actorOf(req), 'canEditApps')) {
      sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
      return true;
    }
    return false;
  }

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
    // H1 HIGH-2: a bundle is always an app export; importing it CREATES and BUILDS a new app →
    // canBuildApps (a plain user cannot import an app the same way they cannot first-build one).
    if (!can(actorOf(req), 'canBuildApps')) {
      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
    }
    const created = await importArtifact(body.bundle, actorOf(req), deps);
    res.status(201).json(artifactView(created));
  });

  r.get('/:id', async (req: AuthedRequest, res: Response) => {
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
    if (denyAppEdit(req, res, art)) return; // H1 HIGH-2: restoring app code → canEditApps
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

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '70,130p' api/src/apps/app-assistant-route.ts && sed -n '237,285p' api/src/apps/app-assistant-route.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
  const app = await resolveApp(header);
  // The assistant plane needs a real artifact-backed owner (org to scope by, user to attribute).
  // A dev-serve / registry-only or unresolved id has none — the same 404 admit() gives.
  if (!app || !app.artifactBacked || !app.ownerUserId) return { status: 'not-found' };
  return { status: 'ok', app };
}

/**
 * Can this verified caller EDIT this specific app? Detection MIRRORS the H1 follow-up-build gate
 * EXACTLY (routes/jobs.ts): `can(canEditApps)` AND the artifact is writable by this actor
 * (loadWritable: own always; org-shared within the org ok; another user's private → not-ok;
 * missing/cross-org → not-ok). Making detection identical to the actual edit authority is what
 * closes BOTH codex-h2 findings and a false-offer bug at once:
 *   - Medium (fail-closed on a missing owner org): an orphaned/cross-org/unresolvable artifact is
 *     never writable, so admin is false even for a super-admin — no false positive.
 *   - Low (org-admin membership oracle): admin:true only for apps loadWritable already grants, i.e.
 *     the caller's OWN + org-shared apps — exactly what they already enumerate via GET /artifacts
 *     (listVisible). It reveals nothing new; a same-org OTHER user's PRIVATE app reads not-writable
 *     → admin:false, so it is not an existence oracle for private in-org apps.
 *   - No false offer: admin:true ⟺ H3's edit mode / the follow-up build will actually succeed for
 *     this caller on this app. The panel never promises an edit the gate would then refuse.
 * NOTE: like the H1 gate, loadWritable is org-scoped, so a super-admin is NOT granted cross-org app
 * edit here (a super-admin only edits apps in their own org). If platform-wide cross-org app editing
 * is ever wanted, that is a deliberate policy change to loadWritable/the H1 gate AND this detection
 * together — not a silent divergence. Exported for the unit matrix.
 */
export function isAppEditor(claims: Pick<JwtClaims, 'role' | 'orgId'>, writableVerdict: 'ok' | 'forbidden' | 'notfound'): boolean {
  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
  return writableVerdict === 'ok'; // ...and the actor must actually be able to write THIS artifact
}

/**
 * Detect whether the OPTIONAL platform Bearer on this request can EDIT app `appId`. FAIL-CLOSED and
 * oracle-free: any deviation — no token, a non-Bearer header, or a token that does not clear the
 * standard verification chain — returns false, never throws, never distinguishes a bad token from a
 * not-writable one. The verification is the EXACT chain requireAuth/verifySseToken run (verifyToken
 * + jti + isRevoked + activation-active + tokenEpoch); the edit decision is the EXACT H1 gate
 * (can(canEditApps) + loadWritable). This endpoint does NOT hand-roll a weaker check and adds NO
 * second identity path.
 */
async function detectAppEditor(authHeader: string | undefined, appId: string): Promise<boolean> {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
  if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
  if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
  const actor = { userId: verified.claims.sub, orgId: verified.claims.orgId, role: verified.claims.role };
  const { verdict } = await loadWritable(actor, appId); // the SAME writability rule the H1 edit gate uses
  return isAppEditor(verified.claims, verdict);
}

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
   * GET /app-assistant/whoami — admin DETECTION for the panel (operator-run H2; detect-then-ask).
   *
   * A DECLARED, DOCUMENTED exception to this plane's visitor-blindness: it is the ONE place the
   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "can the
   * current viewer EDIT this app?" — the SAME decision the H1 follow-up-build gate makes
   * (can(canEditApps) + loadWritable). It NEVER grounds, NEVER bills, NEVER widens admission, and
   * issues NO model call (the zero-token GET) — the POST grounding/billing path above stays
   * byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged action
   * remains gated server-side by the H1 admission plane with this same JWT; `admin: true` here is
   * only a HINT the panel may surface (edit mode is H3), and it exactly matches what that edit will
   * actually be allowed to do — never a false offer.
   *
   * FAIL-CLOSED + oracle-free: the ONLY non-200 responses are the SAME ones POST already gives for
   * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
   * oracle). A missing/invalid/expired/revoked/epoch-stale/wrong-org/user token is ALWAYS a 200
   * `{ admin: false }` — never a 401 (which would leak token validity) or a 403 (which would leak
   * app existence).
   */
  const whoami = async (req: Request, res: Response): Promise<void> => {
    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
    if (resolution.status === 'invalid-id') {
      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
      return;
    }
    if (resolution.status === 'not-found') {
      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
      return;
    }

    // "admin" == can this caller edit THIS app, decided by the SAME rule the H1 edit gate uses
    // (can(canEditApps) + loadWritable on the resolved artifact id). Ownership/org is resolved
    // server-side inside loadWritable from the artifact record, NEVER from anything the caller
    // supplied. Fail-closed + no oracle: see detectAppEditor / isAppEditor above.
    const response: AppAssistantWhoamiResponse = {
      admin: await detectAppEditor(req.header('authorization'), resolution.app.appId),
    };
    res.json(response); // always 200 — the boolean IS the answer
  };

  /** A whoami failure (e.g. a store read blowing up) is a 500, never a 4xx: a 4xx here would be an
   *  oracle. Fail-closed to an internal error, distinct from the detection's own false. */
  r.get('/app-assistant/whoami', (req, res) => {
    void whoami(req, res).catch((err) => {
      console.error('[app-assistant] whoami failed:', err instanceof Error ? err.message : err);
      sendError(res, 'INTERNAL', 'Erro interno.');
    });
  });

  return r;

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,230p' api/src/apps/versions.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/**
 * Artifact versions (ch03 §3.8.9, ch07 §7.9). Git is the system of record; this
 * lists commits and restores the working tree to a prior commit. Ported from the
 * old handlers/artifacts-handler.ts (versionsList / versionsRestore) + tools/vcs.ts
 * (vcsRestore), adapted to system `git` (execFile) to match the ekoa-code
 * commit-guard mechanism.
 *
 * The LIST reuses `readVersions` from the ported commit-guard (services/commit-guard.ts).
 * RESTORE is a FORWARD restore: the working tree is rewritten to match the target
 * commit and committed as a NEW head tagged `[restored]` (users may roll back a
 * restore) - HEAD never moves backwards, so the audit trail is preserved. All git
 * writes run under the shared per-repo lock (§7.9) shared with commit-on-save.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync } from 'node:fs';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { readVersions } from '../services/commit-guard.js';
import { withRepoLock } from '../services/repo-lock.js';
import { resolveWithinJail, sandboxRoot } from '../services/safe-path.js';
import { backupAppRepoSafe } from '../services/github/backup.js';
import { appBuilder } from './builder.js';
import type { ArtifactVersion } from '@ekoa/shared';

const execFileP = promisify(execFile);
const RESTORE_PREFIX = '[restored]';
const FAILED_PREFIX = '[build-failed]';

function gitArgs(dir: string, args: string[]): string[] {
  return ['-C', dir, '-c', 'core.hooksPath=/dev/null', ...args];
}

async function runGit(dir: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileP('git', gitArgs(dir, args), {
    env: env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

function isRepo(projectDir: string): boolean {
  return existsSync(join(projectDir, '.git'));
}

/** Confine the repo path to the owner sandbox and assert it is a directory. */
function validateProjectDir(projectDir: string): string {
  const resolved = resolveWithinJail(sandboxRoot(), projectDir);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`projectDir does not exist or is not a directory: ${resolved}`);
  }
  return resolved;
}

/** List commits (newest first) mapped to the shared ArtifactVersion shape. */
export async function listVersions(projectDir: string, limit = 100): Promise<ArtifactVersion[]> {
  const entries = await readVersions(projectDir, limit);
  return entries.map((e) => ({
    sha: e.sha,
    message: e.message,
    author: e.authorName,
    createdAt: new Date(e.timestamp).toISOString(),
    buildFailed: e.buildFailed,
    isRestore: e.isRestore,
  }));
}

export interface RestoreParams {
  projectDir: string;
  sha: string;
  authorName: string;
  authorEmail: string;
}

/**
 * Forward-restore the working tree to `sha` and commit a new `[restored]` head.
 * Serialized on the shared per-repo lock. Returns the new head sha (or the current
 * head when the tree already matched the target).
 */
export async function restoreVersion(params: RestoreParams): Promise<{ newHeadSha: string }> {
  const projectDir = validateProjectDir(params.projectDir);
  const { sha, authorName, authorEmail } = params;
  if (!sha) throw new Error('restoreVersion: sha is required');

  return withRepoLock(projectDir, async () => {
    if (!isRepo(projectDir)) throw new Error('restoreVersion: no version history for this artifact');

    // Echo the target commit's message in the restore commit.
    let targetSubject = '';
    try {
      targetSubject = (await runGit(projectDir, ['log', '-1', '--format=%s', sha])).trim();
    } catch {
      throw new Error(`restoreVersion: unknown version ${sha}`);
    }
    const targetMessage = targetSubject
      .replace(new RegExp(`^\\${FAILED_PREFIX}\\s*`), '')
      .replace(new RegExp(`^\\${RESTORE_PREFIX}\\s*`), '');

    // Files present at the target commit vs currently tracked on disk.
    const nul = String.fromCharCode(0);
    const atTarget = new Set(
      (await runGit(projectDir, ['ls-tree', '-r', '-z', '--name-only', sha])).split(nul).filter(Boolean),
    );
    const tracked = (await runGit(projectDir, ['ls-files', '-z'])).split(nul).filter(Boolean);
    // Remove tracked files that don't exist at the target commit.
    for (const rel of tracked) {
      if (!atTarget.has(rel)) {
        try { await fs.promises.rm(join(projectDir, rel), { force: true }); } catch { /* ignore */ }
      }
    }
    // Restore every target file back into the working tree (and index).
    if (atTarget.size > 0) await runGit(projectDir, ['checkout', sha, '--', '.']);
    await runGit(projectDir, ['add', '-A']);

    // Nothing to commit → tree already matched the target; return current head.
    if ((await runGit(projectDir, ['status', '--porcelain'])).trim() === '') {
      return { newHeadSha: (await runGit(projectDir, ['rev-parse', 'HEAD'])).trim() };
    }

    const shortSha = sha.slice(0, 7);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_COMMITTER_NAME: 'ekoa-agent',
      GIT_COMMITTER_EMAIL: 'agent@ekoa.local',
    };
    await runGit(
      projectDir,
      ['commit', '-m', `${RESTORE_PREFIX} Restored to ${shortSha}: ${targetMessage}`, '--no-verify', '--no-gpg-sign'],
      env,
    );
    return { newHeadSha: (await runGit(projectDir, ['rev-parse', 'HEAD'])).trim() };
  });
}

/**
 * Restore + rebuild + gated GitHub mirror push. The store update (clearing any
 * cached session, bumping updatedAt) is left to the caller so this stays free of
 * artifact-store coupling; the route owns the metadata write.
 */
export async function restoreAndRebuild(
  artifactId: string,
  params: RestoreParams,
  appName?: string,
): Promise<{ newHeadSha: string }> {
  const result = await restoreVersion(params);
  try {
    await appBuilder.unwatch(artifactId);
    await appBuilder.build(artifactId, params.projectDir);
  } catch (err) {
    console.warn(`[versions] post-restore build failed for ${artifactId}:`, err instanceof Error ? err.message : err);
  }
  // Fire-and-forget GitHub mirror push (gated by the push-enabled toggle; §7.9).
  backupAppRepoSafe(params.projectDir, { appId: artifactId, appName });
  return result;
}

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '300,360p' api/src/agents/build.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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
      // TOCTOU close (H1 MEDIUM): the create-time writability gate on POST /jobs can be stale by the
      // time this queued follow-up runs — the owner may have flipped the artifact org→private, or
      // deleted it, between check and execution. Re-validate writability at USE time (through the
      // mechanics seam — agents/ reaches apps/ only via the seam, ch02 §2.7) and FAIL the job rather
      // than resume a code-writing agent against an artifact the actor may no longer write.
      const writeVerdict = await mech.revalidateWritable(input.actor, artifactId);
      if (writeVerdict !== 'ok') {
        clearTimers();
        if (finalizeOnce(jobId)) {
          const message = 'Já não tem permissão para alterar esta aplicação.';
          sink.error('EDIT_FORBIDDEN', message);
          await patchJob(jobId, { status: 'failed', error: { code: 'EDIT_FORBIDDEN', message }, endedAt: new Date(input.deps.now()).toISOString() });
        }
        terminalReached = true;
        return;
      }
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

codex
I’ve confirmed the POST `/jobs` and POST `versions/:sha/restore` paths are server-gated, so a devtools-only UI bypass does not create capability. The remaining question is whether the rollback flow is safe once the preview goes stale, and whether the SSE token ever escapes into logs or a broader origin surface.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"jobEventsUrl\\(|events\\?token=|verifySseToken\\(|console\\.(log|warn|error).*(token|url|req\\.url|originalUrl)|morgan|pino|request logger|access log\" api/src api/assets shared/src" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/integrations/app-sso.ts:551:          console.warn('[app-sso] could not persist graph token:', e instanceof Error ? e.message : e);
api/src/integrations/app-sso.ts:614:    console.warn('[app-sso-m365] graph token refresh failed:', err instanceof Error ? err.message : err);
api/src/auth/middleware.ts:59:export function verifySseToken(token: string | undefined): { ok: true; claims: JwtClaims } | { ok: false; status: number; code: ErrorCode } {
api/src/services/branding/design-system.ts:254:      console.warn(`[design-system] timeout (${timeoutMs}ms) for ${url}`);
api/src/services/branding/design-system.ts:278:        console.warn(`[design-system] exit ${code} in ${elapsed}ms for ${url}. stderr tail: ${tail}`);
api/src/services/branding/design-system.ts:286:        console.warn(`[design-system] failed to parse JSON from dembrandt (${raw.length} bytes) for ${url}`);
api/src/services/branding/visual-vibe.ts:80:    console.warn(`[visual-vibe] no screenshots captured for ${url}`);
api/src/apps/app-assistant-route.ts:113:  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
api/src/services/branding/rendered-candidates.ts:363:        console.warn(`[rendered-candidates] pixel sampling failed for ${url}: ${errMsg(err)}`);
api/src/services/branding/rendered-candidates.ts:379:    console.warn(`[rendered-candidates] Sampling failed for ${url}: ${errMsg(err)}`);
api/src/apps/builder.ts:237:          console.log(`[cdn-resolver] fetching: ${url}`);
api/src/apps/builder.ts:247:          console.warn(`[cdn-resolver] fetch failed for ${url}: ${msg}`);
api/src/routes/jobs.ts:21:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/chat.ts:21:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/automations.ts:75:    const auth = verifySseToken(req.query.token as string | undefined);
api/src/routes/notifications.ts:14:    const auth = verifySseToken(req.query.token as string | undefined);
api/assets/panel-runtime/src/edit-mode.js:24: *   - GET  /api/v1/jobs/:id/events?token=... → the job SSE (progress narration). The
api/assets/panel-runtime/src/edit-mode.js:49:export function jobEventsUrl(jobId, token) {
api/assets/panel-runtime/src/edit-mode.js:50:  return `/api/v1/jobs/${encodeURIComponent(jobId)}/events?token=${encodeURIComponent(token)}`;
api/assets/panel-runtime/src/edit-mode.js:218:    res = await fetchImpl(jobEventsUrl(jobId, token), {

exec
/bin/zsh -lc "nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '620,700p' && nl -ba api/assets/panel-runtime/src/AssistantPanel.jsx | sed -n '856,884p' && nl -ba api/assets/panel-runtime/src/edit-mode.js | sed -n '268,303p'" in /Users/ggomes/dev/ekoa-code
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
   650	      setEditPreview({ preRunSha: result.preRunSha, newHeadSha: result.newHeadSha });
   651	      setEditPhase('preview');
   652	    } else if (result.outcome === 'answered') {
   653	      // The in-build classifier resolved the request without a build (no revision was created).
   654	      setEditMessage('Não foi criada nenhuma revisão para este pedido. Reformule a alteração pretendida.');
   655	      setEditPhase('note');
   656	    } else if (result.outcome === 'failed') {
   657	      setEditMessage('A revisão não foi concluída. Tente reformular o pedido.');
   658	      setEditPhase('note');
   659	    } else {
   660	      // degraded (401/403/404/network) -> a calm, specific PT-PT message.
   661	      setEditMessage(degradeMessage(result.status));
   662	      setEditPhase('note');
   663	    }
   664	  }, [editDraft]);
   665	
   666	  /** APPROVE = keep the new head. The build already activated it, so there is nothing to
   667	   *  call - just clear the preview and confirm. */
   668	  const approveEdit = useCallback(() => {
   669	    setEditMessage(EDIT_COPY.approved);
   670	    setEditPreview(null);
   671	    setEditPhase('note');
   672	  }, []);
   673	
   674	  /** ROLLBACK (one click) = forward-restore to the pre-run head. H1-gated server-side. */
   675	  const rollbackEdit = useCallback(async () => {
   676	    const id = appId();
   677	    const token = readPlatformToken();
   678	    const sha = editPreview && editPreview.preRunSha;
   679	    if (!id || !token || !sha) {
   680	      setEditMessage(degradeMessage(token ? 0 : 401));
   681	      setEditPhase('note');
   682	      return;
   683	    }
   684	    setEditBusy(true);
   685	    const result = await rollbackToVersion({ fetchImpl: (url, opts) => fetch(url, opts), appId: id, token, sha });
   686	    setEditBusy(false);
   687	    if (result.ok) {
   688	      setEditMessage(EDIT_COPY.rolledBack);
   689	      setEditPreview(null);
   690	      setEditPhase('note');
   691	    } else {
   692	      setEditMessage(degradeMessage(result.status));
   693	      setEditPhase('note');
   694	    }
   695	  }, [editPreview]);
   696	
   697	  if (collapsed) {
   698	    return (
   699	      <button type="button" className="ekoa-assistant-launcher" onClick={open} aria-label="Abrir o assistente">
   700	        <ChatIcon />
   856	          {editPhase === 'preview' && editPreview ? (
   857	            <div className="ekoa-assistant-edit-preview">
   858	              {editPreview.newHeadSha && editPreview.newHeadSha !== editPreview.preRunSha ? (
   859	                <>
   860	                  <p className="ekoa-assistant-edit-preview-text">{EDIT_COPY.applied}</p>
   861	                  <dl className="ekoa-assistant-edit-diff">
   862	                    <div>
   863	                      <dt>Versão anterior</dt>
   864	                      <dd>{shortSha(editPreview.preRunSha)}</dd>
   865	                    </div>
   866	                    <div>
   867	                      <dt>Nova versão</dt>
   868	                      <dd>{shortSha(editPreview.newHeadSha)}</dd>
   869	                    </div>
   870	                  </dl>
   871	                  <div className="ekoa-assistant-edit-actions">
   872	                    <button type="button" className="ekoa-assistant-edit-primary" onClick={approveEdit}>
   873	                      Aprovar
   874	                    </button>
   875	                    <button
   876	                      type="button"
   877	                      className="ekoa-assistant-edit-secondary"
   878	                      onClick={rollbackEdit}
   879	                      disabled={editBusy}
   880	                    >
   881	                      Reverter
   882	                    </button>
   883	                  </div>
   884	                </>
   268	export async function runEditPatch({ fetchImpl, appId, token, description, onProgress, signal }) {
   269	  // 1. Capture the pre-run head BEFORE the build - the rollback target and diff point.
   270	  const before = await readVersions({ fetchImpl, appId, token });
   271	  if (!before.ok) return { outcome: 'degraded', status: before.status };
   272	  const preRunSha = before.head;
   273	
   274	  // 2. Start the follow-up build (the H1-gated patch run).
   275	  const started = await startEditJob({
   276	    fetchImpl,
   277	    appId,
   278	    token,
   279	    description,
   280	    sessionId: newEditSessionId(appId),
   281	  });
   282	  if (!started.ok) return { outcome: 'degraded', status: started.status };
   283	  if (started.status === 'answered') return { outcome: 'answered', reason: started.reason };
   284	
   285	  // 3. Stream the job SSE - live plan_step narration to onProgress.
   286	  const stream = await streamJobEvents({
   287	    fetchImpl,
   288	    jobId: started.jobId,
   289	    token,
   290	    signal,
   291	    onEvent: (ev) => {
   292	      if (onProgress) onProgress(ev);
   293	    },
   294	  });
   295	  if (stream.outcome === 'http-error') return { outcome: 'degraded', status: stream.status };
   296	  if (stream.outcome === 'error') return { outcome: 'failed', event: stream.event };
   297	
   298	  // 4. Read the new head for the preview (the versions read is the source of truth for the
   299	  //    head; a soft close still lands here, and an unchanged head reads as "no change").
   300	  const after = await readVersions({ fetchImpl, appId, token });
   301	  if (!after.ok) return { outcome: 'degraded', status: after.status };
   302	  return { outcome: 'ready', preRunSha, newHeadSha: after.head, jobId: started.jobId };
   303	}

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"(morgan|pino|request|req\\.originalUrl|req\\.url|console\\.(log|warn|error).*(req|request|url))\" api/src/server.ts api/src" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/server.ts:222:  // partitioning is structural, not a request argument); ingestDocument refuses the reserved
api/src/server.ts:240:  // Anonymisation ruleset resolver (ch17 §17.7; F10): every egress request resolves the org's
api/src/server.ts:396:  setArtifactResolver(async (slugOrId, requesterOrgId) => {
api/src/server.ts:400:    if (!art || art.orgId !== requesterOrgId) return null;
api/src/server.ts:222:  // partitioning is structural, not a request argument); ingestDocument refuses the reserved
api/src/server.ts:240:  // Anonymisation ruleset resolver (ch17 §17.7; F10): every egress request resolves the org's
api/src/server.ts:396:  setArtifactResolver(async (slugOrId, requesterOrgId) => {
api/src/server.ts:400:    if (!art || art.orgId !== requesterOrgId) return null;
api/src/billing/allowance.ts:11: * terminal stream error) and an Express `allowanceMiddleware` (for synchronous request/response
api/src/billing/allowance.ts:70: * Express allowance gate for SYNCHRONOUS request/response entries (§6.6.3): the integration-
api/src/knowledge/service.ts:58: * user-facing permission: any request actor presenting the shared org id is refused before it can
api/src/automation/local-browser-session.ts:111:        // the very first request already carries the captured session.
api/src/automation/rehearsal.ts:381:      pattern: /(re-?capt?cha|cap?tcha|i'?m not a robot|não sou um robô|i am not a robot|hcaptcha|cloudflare.*(challenge|verify)|are you a robot|bot[- ]?check|bot[- ]?detection|\bgoogle.*\/sorry\/|\/sorry\/[^"\s]|unusual (traffic|activity)|automated (traffic|requests|queries)|verify (you are |that you are |you'?re )?(a )?human|prove (you'?re|you are) (a )?human|are you (a )?human|press (and hold|& hold).*\bhuman\b|akamai.*(challenge|verify))/i,
api/src/automation/engine.ts:1779: * Common pause-and-wait flow: persist the pause request, emit the SSE
api/src/knowledge/paths.ts:10: * Every path segment that comes from a request (collection) — and, defensively, the orgId and
api/src/knowledge/paths.ts:37: * so no firm can ever be routed to `_shared`. Written ONLY by the offline importer CLI; a request
api/src/bridge/server.ts:13: * frame is validated with BridgeFrame and dropped if unparseable/invalid (§18.3.1); `provider_request`
api/src/bridge/server.ts:53:  /** The provider-request handler (§18.4). Default: the real chokepoint-backed handler. */
api/src/bridge/server.ts:123:      url = new URL(req.url ?? '', 'http://localhost');
api/src/bridge/server.ts:227:      case 'provider_request': {
api/src/bridge/server.ts:236:          console.warn(`[bridge][provider] request rejected: reason=${outcome.reason ?? 'unknown'} pairing=${pairingId}`);
api/src/automation/seams.ts:223:// database, so it returns a Promise. Default resolves null. `requesterOrgId` is the RUN's org —
api/src/automation/seams.ts:226:export type ArtifactResolver = (slugOrId: string, requesterOrgId: string) => Promise<ArtifactResolution | null>;
api/src/automation/seams.ts:233:export function resolveArtifactProjectDir(slugOrId: string, requesterOrgId: string): Promise<ArtifactResolution | null> {
api/src/automation/seams.ts:234:  return artifactResolver(slugOrId, requesterOrgId);
api/src/automation/types.ts:87: * An api_call's resolved form. The request shape is cached; responses
api/src/automation/types.ts:420:   * `details` is structured failure context (request + redacted
api/src/automation/service.ts:4: * row) and never re-implements scoping. Every function takes the request `Actor`; every response is
api/src/automation/executors/api-call.ts:4: * Performs an HTTP request via native fetch and captures the response.
api/src/automation/executors/api-call.ts:65:  // Resolve integration credentials if requested
api/src/automation/executors/api-call.ts:108:  // interpolated into the URL query string, the request body, or a non-auth-shaped header would
api/src/automation/executors/api-call.ts:110:  // VALUE from the persisted copy (the real request above already used the un-redacted values).
api/src/automation/executors/api-call.ts:138:    // A network/timeout error message can include the failed request URL, which may carry a secret
api/src/automation/executors/api-call.ts:142:      error: { message: redactSecretValues(`request failed: ${message}`, secretValues), recoverable: !(err instanceof SsrfError) },
api/src/automation/executors/api-call.ts:198:        details: { request: { method: spec.method, url: redactSecretValues(resolvedUrl, secretValues) }, response: { status: response.status, body: safeBody.slice(0, 2000) } },
api/src/bridge/provider.ts:4: * `provider_request` frames and Cortex serves the completion. This face exists ONLY for bridge
api/src/bridge/provider.ts:10: * The cross-org guard (§18.4.4) is checked server-side, per request, BEFORE any model call, as a
api/src/bridge/provider.ts:12: * non-revoked pairing; the pairing resolves to exactly one org (from the registry, never a request
api/src/bridge/provider.ts:13: * body); the conversation id the request carries must belong to that org. Because org is derived
api/src/bridge/provider.ts:14: * from the pairing and not the request, a credential for org A can never address org B's vault —
api/src/bridge/provider.ts:15: * there is no request field that would let it name one. Activation admission joins the chain: a
api/src/bridge/provider.ts:25:type ProviderRequestFrame = Extract<BridgeFrame, { type: 'provider_request' }>;
api/src/bridge/provider.ts:50:  /** false when the request was rejected before any model call (auth/cross-org/activation). */
api/src/bridge/provider.ts:65: *  to its org — the request never asserts its own org. A credential that does not verify, or
api/src/bridge/provider.ts:89:/** Build an Anthropic-style error response frame, correlated so the daemon's pending request
api/src/bridge/provider.ts:95:/** Set the propagated conversation id on the request metadata so the chokepoint keys the
api/src/bridge/provider.ts:116: * Build the provider-request handler. The composition root wires the default deps (real chokepoint
api/src/bridge/provider.ts:156:      // BEFORE any model call (§18.4.4). org is derived from the pairing, never the request body,
api/src/bridge/provider.ts:165:      // The daemon's per-request correlationId is recorded on the hosted anon-audit (§18.5 S6), so
api/src/services/url-fetcher.ts:3: * fetches of user-supplied URLs — it calls the SSRF guard before every request. A route or
api/src/services/url-fetcher.ts:4: * service that fetches a request-derived URL without this fetcher is a review-rejectable
api/src/automation/executors/ekoa-action.ts:218:export function resolveArtifactProjectDir(slugOrId: string, requesterOrgId: string): Promise<ResolveArtifactResult | null> {
api/src/automation/executors/ekoa-action.ts:219:  return resolveArtifactSeam(slugOrId, requesterOrgId);
api/src/llm/gateway.ts:85:  // Base64 screenshots in request bodies can exceed the default limit; use a generous one.
api/src/llm/gateway.ts:136:      gatewayError(res, 502, 'Provider request failed', 'api_error');
api/src/knowledge/grounding.ts:11: *    keyword-based legal-context detector matches the request (no model call).
api/src/bridge/registry.ts:13: * `org`, resolved at connect from the owner, never from a request body), and resolution returns a
api/src/bridge/registry.ts:90: * construction: the filter is the requester's own user id, so no cross-user (a fortiori no
api/src/automation/command-shape.ts:92:    curl: 'make an HTTP request',
api/src/bridge/delegation.ts:7: * a request body, §18.4.4), sends the `delegate` frame down the bridge, and awaits the
api/src/bridge/delegation.ts:124:  // request body (§18.4.4); a fresh nonce and a future expiry bind replay + staleness (S2).
api/src/apps/served-data.ts:42:/** True when a request's Origin is cross-origin to its Host (carried check: served
api/src/llm/credentials.ts:59:export type ProviderErrorClass = 'auth' | 'billing' | 'invalid_request' | 'rate_limit' | 'transient';
api/src/llm/credentials.ts:98:  if (status === 400 || status === 404 || status === 413 || status === 422) return 'invalid_request';
api/src/automation/executor.ts:61: * originally requested.
api/src/automation/executor.ts:251:      // request an explicit "take a screenshot" step in their automation.
api/src/automation/executor.ts:256:      // requested state, redundant planner step, etc.). Don't touch the
api/src/integrations/app-cloud-files.ts:260:    res.status(502).json({ error: 'cloud provider request failed' });
api/src/integrations/app-cloud-files.ts:284:      res.status(400).json({ error: 'Raw body required — request body was consumed by another parser' });
api/src/apps/builder.ts:237:          console.log(`[cdn-resolver] fetching: ${url}`);
api/src/apps/builder.ts:247:          console.warn(`[cdn-resolver] fetch failed for ${url}: ${msg}`);
api/src/apps/serving.ts:3: * monolith, logic unchanged; FIXED-9). The request pipeline for GET /apps/:idOrSlug/*
api/src/apps/serving.ts:5: * resolution (slug first, raw id fallback) -> shareability gate on document requests
api/src/apps/serving.ts:302:    const urlPath = req.originalUrl.split('?')[0] as string;
api/src/apps/serving.ts:304:      res.redirect(301, `${urlPath}/${req.originalUrl.slice(urlPath.length)}`);
api/src/apps/serving.ts:311:    // Shareability gate (§7.7): DOCUMENT requests only - browsers do not propagate
api/src/apps/serving.ts:394:    // HTML requests (any non-asset path - this is also the deep-route entry):
api/src/auth/service.ts:58: * map (the fast admission path every request consults — bumped first, so the effect is immediate)
api/src/auth/service.ts:98:  // authenticates and is refused per-request at the admission plane (middleware) with
api/src/auth/service.ts:123: * every request, so the token dies immediately). Admin variant: super-admin anywhere, org-admin
api/src/apps/pdf.ts:176:      if (isAllowedSubresource(route.request().url())) void route.continue();
api/src/apps/verify-runner.ts:45:  /** The user's build request (F28): the verifier asserts request-FULFILMENT, not mere rendering. */
api/src/apps/verify-runner.ts:46:  request: string;
api/src/apps/verify-runner.ts:127: *  told WHAT the app should do (the user's request) and must assert request-FULFILMENT — a
api/src/apps/verify-runner.ts:142:    'The application was built from this user request:',
api/src/apps/verify-runner.ts:143:    `<request>${input.request}</request>`,
api/src/apps/verify-runner.ts:147:    'pass — load it, check the console, confirm the requested content and any buttons work.',
api/src/apps/verify-runner.ts:148:    'Reserve deep multi-flow exercising for apps whose request implies real interaction.',
api/src/apps/verify-runner.ts:155:    '   requested app. Output FAIL immediately.',
api/src/apps/verify-runner.ts:156:    '2. ACCEPTANCE CHECK: the interactive elements the request implies must exist and work (e.g. a',
api/src/apps/verify-runner.ts:157:    '   requested counter has a working button; a requested form submits). Missing expected',
api/src/apps/verify-runner.ts:161:    '  PASS - <short note>   (the app fulfils the request and all checks passed)',
api/src/apps/verify-runner.ts:162:    '  FAIL - <short note>   (scaffold placeholder, missing requested functionality, or a failed check)',
api/src/integrations/app-sso-sessions.ts:12: * two concurrent /callback requests carrying the same state can never both observe the
api/src/integrations/app-sso-sessions.ts:41:   *  server-established values, never to request-supplied ones. Absent for SSO. */
api/src/integrations/app-sso-sessions.ts:49: * returns, in O(1). Holds the nonce + PKCE verifier the authorize request committed to.
api/src/apps/app-files.ts:151:      res.status(400).json({ error: 'Raw body required — request body was consumed by another parser (middleware misconfiguration)' });
api/src/apps/app-files.ts:196:      res.status(403).json({ error: 'X-Ekoa-App-Id does not match the requested app' });
api/src/apps/slug-index.ts:4: * assignment. Serving resolves slugs through this index on every request; the
api/src/llm/anonymise/audit.ts:7: * classes detected, their counts, the per-request correlation id, and a HASH of the payload.
api/src/llm/anonymise/audit.ts:12: * The write is asynchronous (off the request latency path) and the records form a hash chain,
api/src/services/design-tokens.ts:7: * requesting app's slug (the `?app=` query or the `/apps/<slug>/` Referer) — an app
api/src/services/design-tokens.ts:156: * Build the design-tokens stylesheet for the requesting app's org. When the app is
api/src/services/design-tokens.ts:178:/** Extract the app slug/id from the request: `?app=` first, then a `/apps/<slug>/` Referer. */
api/src/apps/artifact-type.ts:3: * what KIND of artifact a build request produces, and therefore which internal
api/src/apps/artifact-type.ts:6: * free; only genuinely ambiguous requests spend a FAST one-shot through the
api/src/apps/artifact-type.ts:8: * billed to the requesting user — the pre-provisioned ClassifierAgentType).
api/src/apps/share-lookup.ts:13: * entries with shareable=false still serve). Per-request re-check, never cached.
api/src/routes/integration-builder.ts:66: * The save request as it arrives on the wire. The shared `IntegrationBuilderSaveRequest` is a
api/src/routes/integration-builder.ts:80: * Execute ONE action's httpConfig with request-supplied test credentials + input. This is the
api/src/routes/integration-builder.ts:81: * builder's ephemeral test path: credentials come from the request, are NEVER logged or persisted,
api/src/apps/app-assistant-route.ts:102: * Detect whether the OPTIONAL platform Bearer on this request can EDIT app `appId`. FAIL-CLOSED and
api/src/apps/app-assistant-route.ts:145:   * next. On success it stashes the resolved subject on the request for the allowance gate + handler.
api/src/routes/helpers.ts:3: * shaping (CONV-2), and zod request validation. Routers do exactly three things: validate,
api/src/auth/revocation.ts:4: * the auth middleware on every request (O(1)), self-pruning on token expiry (both in the
api/src/llm/anonymise/types.ts:46:   *  request closed (§17.3). */
api/src/llm/anonymise/types.ts:72: * `ruleset` carries the deny-list + toggles; `correlationId` is minted per provider request
api/src/llm/anonymise/types.ts:73: * at the chokepoint (§17.6) and reused across the parts of one request; `channel` scopes the
api/src/integrations/m365-proxy.ts:75:      console.error(`[m365-proxy] ${req.method} ${graphPath} failed:`, msg);
api/src/routes/jobs.ts:43:    // request-to-admin flow consumes); object-ownership denials carry no capability field.
api/src/llm/anonymise/detectors.ts:13: *       depend on (c) being up: an NER outage degrades recall but never fails the request
api/src/llm/anonymise/detectors.ts:147:  /** false when the NER head (c) is down - recall is reduced but the request proceeds. */
api/src/llm/anonymise/detectors.ts:188: * request - it only lowers `nerAvailable`.
api/src/services/browser-pool.ts:8: * guard keeps two simultaneous requests from spawning two browsers, and a
api/src/services/deny-list.ts:41:// Per-org resolver cache: chat/build egress resolves the ruleset on EVERY request (client.ts),
api/src/services/deny-list.ts:121:  // (count, never values), complementing the per-request denyListAccessed count on anon audit
api/src/llm/attribution.ts:49: *   - `classifier` bills the requesting user at FAST weight.
api/src/auth/middleware.ts:5: * these run on EVERY authenticated /api/v1 request (no route opts out).
api/src/llm/client.ts:87: * BEFORE the call is admitted, so a blocked request is never forwarded, metered, or recorded —
api/src/llm/client.ts:159: *  audit actor. One correlation id is minted per provider request and shared by every part. */
api/src/llm/client.ts:196:  /** The Messages API request body (already carrying the FAST model). */
api/src/llm/client.ts:934:  // Anonymise the model-bound request body BEFORE the transport (§17.3); the response body is
api/src/llm/client.ts:985: * request to the provider on the central credential (CLAMPED to the FAST wire model), streams
api/src/llm/client.ts:992: * Top-level Messages API request fields the gateway forwards upstream (F2 live-turn fix).
api/src/llm/client.ts:993: * The Anthropic OAuth beta endpoint (/v1/messages?beta=true) validates request bodies STRICTLY
api/src/llm/client.ts:1007:/** The tier whose CONFIGURED model matches the requested wire model, or null for any other
api/src/llm/client.ts:1010:function matchConfiguredTier(requestedModel: string): Tier | null {
api/src/llm/client.ts:1011:  if (!requestedModel) return null;
api/src/llm/client.ts:1015:    if (strip(tiers[t].model) === strip(requestedModel)) return t;
api/src/llm/client.ts:1070:   *  provider endpoint passes the daemon's per-request id, the hosted audit and the daemon's egress
api/src/llm/client.ts:1076:  // Tier resolution (rc-1 amendment to §6.5.4, decision logged 2026-07-11): a requested model
api/src/llm/client.ts:1082:  const requestedModel = typeof reqBody.model === 'string' ? reqBody.model : '';
api/src/llm/client.ts:1083:  const matchedTier = matchConfiguredTier(requestedModel);
api/src/llm/client.ts:1091:  // Anonymise the bridge/subprocess request BEFORE the transport (§17.3, §17.2: subprocess
api/src/integrations/adobe-sign.ts:340:  const message = e?.message || 'Adobe Acrobat Sign request failed.';
api/src/integrations/action-executor.ts:7: * request/response dump surfaced on failure is credential-redacted.
api/src/integrations/action-executor.ts:69:  request: { method: string; url: string; headers: Record<string, string>; body?: string };
api/src/integrations/action-executor.ts:182:    return { success: false, code: 'invalid_base_url', error: 'Integration request base URL is missing or invalid — reconnect the integration and check its host/region field.' };
api/src/integrations/action-executor.ts:204:  const requestUrl = url.toString();
api/src/integrations/action-executor.ts:209:  const requestSummary = redactSecretsDeep({
api/src/integrations/action-executor.ts:211:    url: redactUrl(requestUrl, secretValues),
api/src/integrations/action-executor.ts:220:    const response = await fetchImpl(requestUrl, { method: httpConfig.method, headers, body, signal: controller.signal });
api/src/integrations/action-executor.ts:239:        request: requestSummary,
api/src/integrations/action-executor.ts:264:    return { success: false, code: 'transport_error', error: transport, details: { request: requestSummary, transportError: transport } };
api/src/integrations/http-template.ts:4: * body templates, and credential-shaped redaction for the request/response dumps the
api/src/integrations/http-template.ts:64:// Redaction — mask credential-shaped values before a request/response dump is
api/src/integrations/http-template.ts:103: * Redact a resolved request URL before it is persisted/surfaced on failure. A credential
api/src/services/branding/design-system.ts:254:      console.warn(`[design-system] timeout (${timeoutMs}ms) for ${url}`);
api/src/services/branding/design-system.ts:278:        console.warn(`[design-system] exit ${code} in ${elapsed}ms for ${url}. stderr tail: ${tail}`);
api/src/services/branding/design-system.ts:286:        console.warn(`[design-system] failed to parse JSON from dembrandt (${raw.length} bytes) for ${url}`);
api/src/integrations/app-sso.ts:283:function requestOrigin(req: Request): string {
api/src/integrations/app-sso.ts:290:  return ssoRedirectUriEnv() || `${requestOrigin(req)}${APP_SSO_CALLBACK_PATH}`;
api/src/integrations/app-sso.ts:383:    if (!body) { res.status(400).json({ success: false, error: 'invalid_request' }); return; }
api/src/integrations/app-sso.ts:418:    if (!body) { res.status(400).json({ success: false, error: 'invalid_request' }); return; }
api/src/integrations/app-sso.ts:430:        // (server-established) — NEVER the request's collection.
api/src/integrations/app-sso.ts:581:      console.error(`[app-sso-m365] ${req.method} ${graphPath} failed:`, err instanceof Error ? err.message : err);
api/src/integrations/app-sso.ts:619:/** Forward a request verbatim to Microsoft Graph with the given bearer, mirroring the
api/src/services/branding/rendered-candidates.ts:363:        console.warn(`[rendered-candidates] pixel sampling failed for ${url}: ${errMsg(err)}`);
api/src/services/branding/rendered-candidates.ts:379:    console.warn(`[rendered-candidates] Sampling failed for ${url}: ${errMsg(err)}`);
api/src/services/branding/visual-vibe.ts:9: * `brand-research`, billed to the requesting user.
api/src/services/branding/visual-vibe.ts:80:    console.warn(`[visual-vibe] no screenshots captured for ${url}`);
api/src/services/branding/visual-vibe.ts:159:        // provider's 32MB request cap once base64-encoded (observed live 2026-07-11,
api/src/streaming/index.ts:106:    if (!req.url || !req.url.startsWith(CANVAS_WS_PATH_PREFIX)) {
api/src/streaming/index.ts:115:    const traceId = extractTraceId(req.url);
api/src/streaming/index.ts:139:  const traceId = extractTraceId(req.url);
api/src/streaming/index.ts:141:    rejectSocket(socket, 400, 'bad-request');
api/src/streaming/index.ts:154:  const token = parseToken(req.url);
api/src/content/loader.ts:7: * calls, no per-request work beyond a directory-path lookup (ch08 §8.3).
api/src/events/service.ts:91:/** The webhook ingress pipeline (invariant 9). `rawBody` is the UNMODIFIED request bytes. */
api/src/legal/access-gate.ts:39: * its own cooldown). `>=` comparison => `perAppMax` requests succeed per window.
api/src/legal/access-gate.ts:91: * Gate a legal-suite request from `X-Ekoa-App-Id`. Writes the refusal response and
api/src/agents/build.ts:46:/** Registo (F3): build lifecycle rows, metadata-only (ids/codes — NEVER the request description
api/src/agents/build.ts:129:    request: {
api/src/agents/build.ts:209:    request: { description: input.description, language: input.language },
api/src/agents/build.ts:247:  'Your FINAL message is read by a non-technical end user. Write it in the language of their request.',
api/src/agents/build.ts:366:    // DETERMINISTIC domain-heavy detector (no model call, no egress) over the request. A
api/src/agents/build.ts:367:    // domain-heavy app NARRATES a knowledge request on the build stream (upload reference
api/src/agents/build.ts:368:    // documents to the org knowledge area) and, when the request carried scoping-provided
api/src/agents/build.ts:518:    // REQUEST and asserts request-fulfilment (F28), not mere rendering. Verdict semantics:
api/src/agents/build.ts:540:        request: input.description,
api/src/agents/jobs.ts:26:  request: {
api/src/legal/citius.ts:50:/** Milliseconds before the default (live) fetch aborts a hung portal request. */
api/src/agents/markers.ts:30:  /** A build delegation was detected at start-of-stream; carries the request description. */
api/src/agents/markers.ts:54:      // Once a build delegation is detected, the remaining stream is the request payload and
api/src/agents/markers.ts:207:  /too[\s_-]*many[\s_-]*requests/i,
api/src/agents/domain-scoping.ts:3: * scoping phase runs over the build request to decide whether the app looks domain-heavy - i.e.
api/src/agents/domain-scoping.ts:6: * a knowledge request in the job stream (upload reference documents to the org knowledge area) and,
api/src/agents/domain-scoping.ts:7: * when the request carried scoping-provided documents, ingests them into the org knowledge area for
api/src/agents/domain-scoping.ts:12: * NARRATES a knowledge request across several domains. Keeping them decoupled avoids agents/
api/src/agents/domain-scoping.ts:139: * Detect whether a build request looks domain-heavy. Deterministic (no model call): it folds the
api/src/agents/domain-scoping.ts:161: * The operator-facing knowledge request narrated in the build stream when the app looks
api/src/agents/context.ts:27:  /** The user's message / build request — drives memory overlap + knowledge grounding + prefetch. */
api/src/agents/streaming.ts:78:  complete(result: unknown, durationMs: number, delegate?: { kind: 'build' | 'integration'; request: Record<string, unknown> }): void {
api/src/agents/streaming.ts:131:export function emitBuildIntent(userId: string, ev: { sessionId: string; sourceRunId: string; request: { description: string; artifactId?: string } }): void {
api/src/agents/seams.ts:79: * the run's actor (org-scoped BY CONSTRUCTION - never a tool/request argument), and the real
api/src/agents/seams.ts:257:  /** The user's build request (F28): the verifier asserts request-FULFILMENT — the served DOM is
api/src/agents/seams.ts:258:   *  not the Ekoa scaffold placeholder and the requested interactive elements exist — not merely
api/src/agents/seams.ts:260:  request: string;
api/src/agents/chat.ts:97:  const finishComplete = (result: unknown, delegate?: { kind: 'build' | 'integration'; request: Record<string, unknown> }): void => {
api/src/agents/chat.ts:224:    // Scanned ONLY on the nothing-streamed fallback shape (a provider failure aborts the request,
api/src/agents/chat.ts:251:      emitBuildIntent(input.actor.userId, { sessionId: input.sessionId, sourceRunId: runId, request: { description: findings.build.description } });
api/src/agents/chat.ts:252:      finishComplete('', { kind: 'build', request: { description: findings.build.description } });
api/src/agents/chat.ts:258:      finishComplete('', { kind: 'integration', request: { ...(findings.integration.hint ? { hint: findings.integration.hint } : {}) } });
api/src/agents/brand-research.ts:151:  /** The user turn (job.request.description + routing input): "URL do sítio web a investigar: ...". */
api/src/agents/brand-research.ts:169:    request: { description: input.prompt, language: input.language },

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '145,180p' api/src/agents/build.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/assets/panel-runtime/src/edit-mode.js | sed -n '205,255p' && nl -ba api/src/routes/artifacts.ts | sed -n '223,240p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   205	/**
   206	 * Consume the job SSE stream with fetch, forwarding each JobEvent to `onEvent`, and
   207	 * resolve once a terminal event lands (or the stream ends). Outcomes:
   208	 *   - { outcome:'complete', event } - the build finished
   209	 *   - { outcome:'error', event }    - the build failed (JobEvent error)
   210	 *   - { outcome:'http-error', status } - the stream endpoint refused (e.g. token expired)
   211	 *   - { outcome:'closed' }          - the stream ended / a network blip with no terminal
   212	 *                                     event (the caller re-reads versions to see the head)
   213	 * Never throws.
   214	 */
   215	export async function streamJobEvents({ fetchImpl, jobId, token, onEvent, signal }) {
   216	  let res;
   217	  try {
   218	    res = await fetchImpl(jobEventsUrl(jobId, token), {
   219	      method: 'GET',
   220	      ...(signal ? { signal } : {}),
   221	    });
   222	  } catch {
   223	    return { outcome: 'closed' };
   224	  }
   225	  if (!res || !res.ok) return { outcome: 'http-error', status: res ? res.status : 0 };
   226	  const body = res.body;
   227	  if (!body || typeof body.getReader !== 'function') return { outcome: 'closed' };
   228	
   229	  const reader = body.getReader();
   230	  const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
   231	  let buffer = '';
   232	  try {
   233	    for (;;) {
   234	      const { value, done } = await reader.read();
   235	      if (done) break;
   236	      buffer += decoder ? decoder.decode(value, { stream: true }) : String(value || '');
   237	      const parsed = parseSseBuffer(buffer);
   238	      buffer = parsed.rest;
   239	      for (const ev of parsed.events) {
   240	        if (onEvent) onEvent(ev);
   241	        if (ev && ev.type === 'complete') {
   242	          try { await reader.cancel(); } catch { /* already closing */ }
   243	          return { outcome: 'complete', event: ev };
   244	        }
   245	        if (ev && ev.type === 'error') {
   246	          try { await reader.cancel(); } catch { /* already closing */ }
   247	          return { outcome: 'error', event: ev };
   248	        }
   249	      }
   250	    }
   251	  } catch {
   252	    /* aborted (unmount / timeout) or read error → treated as a soft close */
   253	  }
   254	  return { outcome: 'closed' };
   255	}
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

codex
- Medium - [api/assets/panel-runtime/src/edit-mode.js](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/edit-mode.js:211), [api/assets/panel-runtime/src/edit-mode.js](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/edit-mode.js:298), [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:856): if the SSE stream closes early on a proxy/network blip before a terminal event, `runEditPatch()` treats that as a soft close, does one immediate versions read, and the UI falls into the `noChange` branch when the head has not advanced yet. A follow-up build can still complete moments later and activate a new head after the panel has told the admin that no code changed, leaving a real edit deployed with no approve/revert affordance shown.

- Medium - [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:675), [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:856), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:231): rollback is keyed only to the stale `preRunSha` captured at preview time, and the restore endpoint is called with no compare-against-current-head guard. If another admin, dashboard action, or later restore changes HEAD after the preview appears, clicking `Reverter` will still forward-restore to the old pre-run head and can wipe out that newer unrelated change as collateral.

VERDICT: NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
137,471
- Medium - [api/assets/panel-runtime/src/edit-mode.js](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/edit-mode.js:211), [api/assets/panel-runtime/src/edit-mode.js](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/edit-mode.js:298), [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:856): if the SSE stream closes early on a proxy/network blip before a terminal event, `runEditPatch()` treats that as a soft close, does one immediate versions read, and the UI falls into the `noChange` branch when the head has not advanced yet. A follow-up build can still complete moments later and activate a new head after the panel has told the admin that no code changed, leaving a real edit deployed with no approve/revert affordance shown.

- Medium - [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:675), [api/assets/panel-runtime/src/AssistantPanel.jsx](/Users/ggomes/dev/ekoa-code/api/assets/panel-runtime/src/AssistantPanel.jsx:856), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:231): rollback is keyed only to the stale `preRunSha` captured at preview time, and the restore endpoint is called with no compare-against-current-head guard. If another admin, dashboard action, or later restore changes HEAD after the preview appears, clicking `Reverter` will still forward-restore to the old pre-run head and can wipe out that newer unrelated change as collateral.

VERDICT: NEEDS-WORK
