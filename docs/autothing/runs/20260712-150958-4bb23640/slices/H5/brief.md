# H5 delegation brief - SECURITY: assertions (capability matrix, grep gates, isolation, journeys)

Slice H5 (api, size 5, deps H1-H4 passed). Fifth slice of the atomic security block - the ASSERTION
layer that proves the whole block holds. Spec: BRIEF.md Phase 10. Run commits DIRECTLY TO MAIN; the
lead runs the live journeys. Mostly consolidation + gap-closing assertions over what H1-H4 built.

## DELIVERABLES

### 1. Capability matrix + gate-wiring assertion
- Extend api/tests/auth/capabilities.test.ts (or a new capability-matrix test) to the FULL role x
  capability grid (3 roles x 4 capabilities = 12 cells + null/unknown -> nothing), asserting the
  matrix exactly: super-admin/org-admin all four; user canUseChat+canCreateArtifacts only.
- Assert the WIRED gates match the matrix: a test that ties each gate to can() - e.g. an integration
  test (or reuse jobs-capability/artifacts-capability) proving a user is refused every app
  build/edit vector and allowed chat+artifact-create. Cross-reference, do not duplicate wholesale.

### 2. Grep gates (a committed test OR a gate script wired into the lint/CI lane)
- **No permissive stub survives:** grep api/src + shared/src for `PERMISSIVE-STUB` / `PERMISSIVE_STUB`
  -> MUST be zero (H1 removed it; assert it stays gone). A committed test that greps the tree and
  fails on any hit is the cleanest (mirror gate:chokepoint's style).
- **No orphan `builder` ROLE ref:** grep for the role value `builder` in api/src + shared/src + web
  (app/components/stores) and fail on any hit EXCEPT the sanctioned allowlist: the legacy-JWT
  normalization shim (api/src/auth/jwt.ts), the migration query (api/src/auth/users-service.ts
  migrateBuilderRole), doc COMMENTS describing the rename, the persisted org-setting KEY
  `allowBuilderAutomations` (data-compat wire name - the role value it grants was renamed), and the
  web SESSION-KIND `builder` in web/stores/orchestration.ts (a session kind, NOT a user role - out
  of scope). Encode the allowlist explicitly + commented so a NEW orphan role ref fails the gate.
  Put this + the PERMISSIVE-STUB grep in one committed gate (a test or a scripts/ gate + package.json
  hook; if a script, wire it like gate:chokepoint).

### 3. Cross-org knowledge isolation - extended to ASSISTANT RETRIEVAL
- Assert the served-app assistant (POST /api/app-assistant) grounds ONLY on the OWNER org's
  knowledge, NEVER another org's - even though admission is header-scoped and the visitor is
  anonymous. app-assistant.ts already grounds under input.owner.orgId (server-resolved, never
  caller-supplied). Write an integration/e2e proof: seed org A knowledge with a distinctive fact and
  org B knowledge with a different distinctive fact; drive the assistant for an app owned by org A
  and confirm it can cite org A's fact and CANNOT retrieve/cite org B's (and vice versa). This is the
  brief's "cross-org knowledge isolation probe extended to assistant retrieval". Can be a committed
  e2e driver (lead runs the live LLM part, budget 1-2 turns) OR an integration test over the grounding
  seam with a real FTS partition if that proves isolation deterministically without an LLM turn -
  prefer the deterministic integration form for the gate + a thin live driver for evidence.

### 4. Destructive-action authorization asserted SERVER-SIDE
- The C3 action runtime dispatches through the app's OWN state layer; a destructive action
  (submit/delete/send) that reaches the app BACKEND is authorized SERVER-SIDE by the app-sso identity
  (the client confirmation from Phase 4 is UX, NOT the boundary). Assert this where it lives: drive a
  destructive/mutating app-backend or app-data operation WITHOUT a valid app-sso session (or with a
  wrong-app one) and confirm the SERVER rejects it (app-sso / app-data-access authz), independent of
  any client confirmation. If a destructive action is purely client state with no server surface,
  DOCUMENT that (no server boundary exists because there is no server mutation) rather than inventing
  one. Study api/src/integrations/app-sso.ts + api/src/apps/app-data-access.ts for the existing authz
  and assert it; do NOT add new auth code (H1-H4 own the platform authz; H5 ASSERTS).

### 5. Live journeys (committed e2e drivers; the LEAD runs them, budget-capped)
- **Edit journey:** admin detected (whoami true) -> explicit opt-in -> edit request -> patch run ->
  preview/diff -> approve -> live -> rollback restores; AND a user-role session asserted UNABLE to
  reach any edit tool (whoami false + /jobs follow-up 403/404). Budget: 1 real patch-run build (+1
  rollback restore). Model on the existing e2e drivers (assistant-billing/fees-knowledge); transient-
  tolerant; the lead runs it.
- **Request-changes journey:** a user files from inside an app -> the org-admin sees it with context
  -> converting pre-fills/starts an edit-mode patch run. Mostly non-LLM (the file + queue read +
  convert are cheap); the convert's patch run is 1 build (can reuse the edit-journey build or be
  asserted at the API level without a full build - decide + document).
- Do NOT run these yourself; make them correct + committed. The lead runs them and folds H4's live
  cross-org proof in here too (a cross-org file -> 404 on the live stack).

## CONSTRAINTS
H5 ASSERTS; it adds NO new capability/permission/auth logic (if an assertion reveals a GAP, do NOT
silently fix it - flag it to the lead as a finding; the block may need another slice-fix). PT-PT, no
emoji, no em/en-dash. Nothing outside api/src/llm touches the provider. No commits, no stack ops, no
real builds (the journey drivers are authored, not run). Register the new e2e drivers in
api/tests/SUITE_LEDGER.json.

## VERIFY LOCALLY
cd api && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json; eslint touched;
npx vitest run tests/ (FULL lane); the new grep gate passes; repo-root npm run gate:chokepoint;
node --check any new .e2e.mjs.

## RESERVED PATHS (reserve at delegation)
api/tests/auth/**, api/tests/security/** (new), api/tests/e2e/*.e2e.mjs (new journey drivers),
scripts/** + package.json (only if the grep gate is a script), api/tests/SUITE_LEDGER.json,
docs/security.md, docs/diagrams/**, slices/H5/**. (H5 should touch mostly TESTS - if it needs to edit
api/src it is probably a GAP to flag, not fix.)
WRITE slices/H5/impl-notes.md + slices/H5/worker-status.txt (DONE-GREEN | vitest | GAP-FOUND:<desc> |
BLOCKED:<reason>).
