# H3 delegation brief - SECURITY: edit mode (admins only) - patch-run preview/approve/rollback

Slice H3 (mixed, size 7, deps H1+H2 passed). Third slice of the atomic security block. Run commits
DIRECTLY TO MAIN; the lead runs gates. Spec: BRIEF.md Phase 9c. This is NOT a second brain: an edit
request becomes a SCOPED PATCH RUN over the EXISTING build machinery (all H1-gated), with the panel
as a thin front-end. Reuse, do not rebuild.

## THE MACHINERY THAT ALREADY EXISTS (reuse it)
- Patch run = a FOLLOW-UP BUILD: POST /api/v1/jobs { artifactId, description } - H1-gated
  (canEditApps + loadWritable, TOCTOU-revalidated). Streams via GET /api/v1/jobs/:id/events (SSE,
  ?token=). Completes -> the artifact is rebuilt + reactivated.
- Preview/diff + rollback: GET /api/v1/artifacts/:id/versions (ArtifactVersion list),
  POST /api/v1/artifacts/:id/versions/:sha/restore (forward-restore, one-click rollback). The
  bundle-update path already returns preUpdateVersionId + safetyNetSnapshotId. All writable()-gated.
- The served app is SAME-ORIGIN as the platform API, so the panel can call /api/v1/* directly with
  the admin's platform JWT (the token H2 already reads for detection).

## WHAT H3 BUILDS
### 1. Panel edit mode (api/assets/panel-runtime/src/AssistantPanel.jsx + a new edit module)
- An explicit, VISIBLE edit-mode switch shown ONLY when H2 detection returned admin:true, and it is
  OPT-IN (detect-then-ask, binding): the switch is OFF by default; the admin must actively enable it.
  Entering edit mode NEVER happens automatically from detection.
- When edit mode is ON, a distinct edit affordance (a fourth "mode" or a dedicated panel section -
  keep it visually distinct from the visitor OPERAR/MOSTRAR/ENSINAR modes so an admin always knows
  they are in edit mode). PT-PT, no emoji, no em/en-dash.
- The edit FLOW (front-end to the existing patch run):
  1. Admin types an edit request ("adicione um botao de exportacao na tabela de honorarios").
  2. The panel confirms intent (a clear PT-PT confirmation step - "Vou preparar esta alteracao como
     uma revisao. Confirma?"), then POSTs /api/v1/jobs { artifactId, description } with the admin
     Bearer to start the patch run. It streams the job SSE and shows live progress (reuse the
     plan_step narration shape).
  3. On completion, PREVIEW: fetch GET /api/v1/artifacts/:id/versions and present the new head +
     the diff-point (the pre-run version). Present APPROVE (keep) vs ROLLBACK.
  4. ROLLBACK = POST /api/v1/artifacts/:id/versions/:sha/restore to the pre-run version (one click).
     APPROVE = leave the new head in place (the build already activated it).
- All of this uses the admin's platform JWT; EVERY server action is already H1-gated, so a
  non-admin (no token / user / cross-org) literally cannot drive it (the jobs 403/404 + the panel
  only shows the switch when admin:true). The panel must degrade gracefully if a mid-flow call
  returns 401/403/404 (token expired / lost writability) - a calm PT-PT message, never a crash.

### 2. Admin discovery (proactive teaching)
- For a detected admin (admin:true), the panel proactively surfaces - ONCE, discreetly - that the
  app is changeable in edit mode, with 1-2 concrete PT-PT suggestions derived from the app (generic
  is fine: "Pode pedir alteracoes a esta aplicacao - por exemplo, adicionar um campo ou um botao").
  This is the conversion moment; keep it tasteful, dismissible, non-blocking. It NEVER auto-enables
  edit mode (detect-then-ask).

### 3. Contracts / server (only if needed)
- Prefer NO new endpoints - reuse jobs + versions/restore. If a thin read helper is genuinely
  needed (e.g. a combined "edit session state" read), add it additively to shared/ with a contract
  test. Do NOT add new build/edit capability logic (H1 owns gating; H3 is a front-end).

## TESTS
- Panel unit (api/tests/apps/assistant-panel.test.ts or a new edit-mode test): the edit switch is
  ABSENT when admin:false; PRESENT but OFF (opt-in) when admin:true; enabling it reveals the edit
  affordance; the confirm-then-patch-run flow calls POST /jobs with the artifactId + Bearer;
  rollback calls the restore endpoint; a 401/403 mid-flow renders a calm message. Detect-then-ask
  pinned (detection alone never enables edit).
- If any shared contract is added: contract test both shapes.
- The heavy end-to-end (a REAL patch run editing a real app + rollback) is the LEAD's live probe -
  do NOT run it; make the flow correct + unit-proven. If you add an e2e driver, budget-cap it and
  leave it for the lead to run (1 build max).

## CONSTRAINTS
Detect-then-ask is BINDING (no auto edit-enable). No new capability/permission logic (H1 owns it;
H3 is a gated front-end). No queue (that is H4). PT-PT, no emoji, no em/en-dash. The served-app
POST /api/app-assistant plane stays visitor-blind (edit mode uses the PLATFORM /api/v1/* API with
the admin JWT, a SEPARATE plane - never route edits through the visitor-blind assistant endpoint).
Nothing outside api/src/llm touches the provider. No commits, no stack ops, no real builds.
Diagram: update the affected diagram (likely 03-request-crud or a new edit-flow note) in the same
unit; state which + why in impl-notes.

## VERIFY LOCALLY
cd api && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json; eslint touched;
npx vitest run tests/apps tests/contract (+ full lane if shared changed); node
assets/panel-runtime/build.mjs; repo-root npm run gate:chokepoint.

## RESERVED PATHS (held for you)
api/assets/panel-runtime/src/** (AssistantPanel.jsx + a new edit-mode module + AssistantPanel.css),
shared/src/app-assistant.ts (only if a thin additive read is needed), api/tests/apps/assistant-panel.test.ts,
api/tests/apps/edit-mode*.test.ts (new), docs/diagrams/**, slices/H3/**.
WRITE slices/H3/impl-notes.md + slices/H3/worker-status.txt (DONE-GREEN | vitest | BLOCKED:<reason>).
