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
