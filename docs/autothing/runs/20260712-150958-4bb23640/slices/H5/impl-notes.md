# H5 impl-notes - SECURITY: the ASSERTION layer (capability matrix, grep gates, isolation, journeys)

Status: DONE-GREEN. H5 asserts what H1-H4 built; it adds NO new capability/permission/auth logic (no
`api/src` production file touched). All five deliverables built + green in the FULL api vitest lane
(**180 files, 1627 passed, 1 skipped** - was 177/1601/1 at H4: +3 test files, +26 tests). Two
non-blocking OBSERVATIONS surfaced for the lead (below) - neither is a hole in H1-H4's platform authz.

## Deliverable 1 - Capability matrix + gate-wiring assertion

`api/tests/auth/capabilities.test.ts` (EXTENDED, reserved path):
- The full 3x4 grid + null/undefined -> nothing already existed (H1). ADDED: an **unknown/stale role
  -> nothing (fail closed)** cell - a signature-valid actor carrying a dead role value (`builder`
  bypassing the shim, `root`, `''`) is refused every capability (pins the `?? false` defensive branch).
- ADDED a `describe('capability gate wiring (H5)...')` block: a WIRING INVENTORY that ties every
  capability to the route `can(actor, '...')` call site enforcing it (data-driven `it.each`), reading
  the route source so a matrix that stays green while a route silently loses its gate FAILS. Covers:
  jobs.ts (canBuildApps first-build / canEditApps follow-up), chat.ts (canUseChat), artifacts.ts
  (canCreateArtifacts create / canEditApps denyAppEdit / canBuildApps import+fork - incl. the
  `forkCap` ternary indirection), app-assistant-route.ts (canEditApps whoami/isAppEditor). Plus a pin
  that the two admin-only capabilities (a user is denied canBuildApps+canEditApps) each have an
  enforcing gate. CROSS-REFERENCES (does NOT duplicate) `jobs-capability.test.ts` +
  `artifacts-capability.test.ts`, which drive the behavior end-to-end.

## Deliverable 2 - Grep gates (committed test, self-proving non-tautology)

`api/tests/security/grep-gates.test.ts` (NEW, reserved path). Chosen a committed vitest gate over a
scripts/ hook: it runs in the FULL vitest lane the operator runs, is self-contained, and can prove
its own non-tautology in-suite. Two tree scans:
- **No permissive stub:** `PERMISSIVE-STUB`/`PERMISSIVE_STUB` marker appears nowhere in api/src +
  shared/src (H1 removed it; asserted it stays gone).
- **No orphan `builder` role ref:** a quoted `'builder'`/`"builder"` ROLE literal in api/src +
  shared/src + web/{app,components,stores} must be in the commented allowlist: `api/src/auth/jwt.ts`
  (legacy-JWT shim), `api/src/auth/users-service.ts` (migrateBuilderRole query + comments),
  `web/stores/orchestration.ts` (SESSION-KIND `builder`, NOT a user role). The org-setting KEY
  `allowBuilderAutomations` is naturally excluded (the quoted-literal matcher never matches an
  unquoted identifier substring - asserted by the matcher self-test). A NEW orphan literal in any
  other file FAILS.
- **Non-tautology proven two ways:** (a) an in-suite self-test drives the pure matcher + allowlist
  logic against PLANTED violations (a real `'builder'` literal / stub marker IS detected; feature
  identifiers `integrationBuilder`/`builderSessionId`/`allowBuilderAutomations`/`"Builder"` label are
  NOT; a non-allowlisted file IS flagged) - durable, not a one-off; (b) VERIFIED by planting
  `export const x = 'builder'; // PERMISSIVE-STUB` in a temp `api/src/__h5_grep_probe__.ts`: BOTH
  gates failed, probe removed, gates green again.

## Deliverable 3 - Cross-org knowledge isolation extended to ASSISTANT RETRIEVAL

`api/tests/security/assistant-cross-org-isolation.test.ts` (NEW, reserved path). DETERMINISTIC
integration over the REAL grounding seam (no LLM): seed org A + org B partitions in a real FTS index
with distinctive per-org tokens (bodies share no query content word, so the only FTS-matchable token
is the org's own), wire the REAL `buildGroundingBlock` as `runAppAssistant`'s `deps.ground`, and
assert:
- an org-A app's assistant retrieves + cites org A's fact and NEVER org B's (org B's token never
  even enters the systemPrompt the model would see);
- an org-B app asking for org A's fact retrieves NOTHING (isolation, not just non-citation);
- symmetric for B; and the OWNER org - never a visitor-planted `context.orgId` - decides the
  partition (a steered attacker-org partition is never consulted).
This is the committed GATE. Live evidence is folded into the journey drivers + the existing
`fees-knowledge.e2e.mjs` (owner-org CITED), so no separate live driver was added for #3 (decision).

## Deliverable 4 - Destructive-action authorization asserted SERVER-SIDE

`api/tests/security/destructive-action-authz.test.ts` (NEW, reserved path). Asserts the app-sso
IDENTITY plane (`api/src/integrations/app-sso.ts`) gates a mutating served-app op server-side,
independent of any client confirmation:
- `POST /api/app-sso/set-password` (writes a bcrypt hash onto the app's data row) -> **401 WITHOUT a
  valid app-sso session**; **401 with a WRONG-APP session** (an app2 cookie presented to app1 -
  `findValidAppSession(token, app1)` is null by `session.appId` isolation); **200 only for the
  correct same-app session** (the app-sso identity, and only it, authorizes the mutation - there is
  no confirmation param). Each path also asserts the app1 row was/was-not actually mutated.
- the visitor-acting `/api/app-sso/m365/*` proxy is gated the same way (401 without / with a wrong-app
  session).

### Destructive-action-authz FINDING (documented boundary, not a hole)
The brief's premise ("a destructive app-data op is authorized by the app-sso identity") is TRUE for
the PRIVILEGED end-user ops (set-password, the Graph proxy) - asserted above. It is NOT how the
GENERAL served-app data plane works, and that is a DELIBERATE, PRE-EXISTING, DOCUMENTED design:
- `api/src/apps/served-data.ts` (`/api/app-data/*`, where a C3 submit/delete lands) is app-id-SCOPED
  and byte-compatible with the legacy key-value plane ("No platform JWT anywhere on this plane"). Its
  per-app server boundary is `X-Ekoa-App-Id` scope + the owner-activation admission gate
  (deactivated/billing-locked owner refused), NOT an app-sso session. `docs/security.md` already
  records this ("must never hold confidential or per-user-private data ... a documented decision, not
  an oversight"); the shared plane (`/api/app-shared`) adds owner-resolution + same-origin + the
  `sharedData` opt-in. So the client confirmation is UX, and the SERVER boundary that DOES exist is
  the app-id scope + owner-activation (general plane) and the app-sso session (privileged ops).
- Recorded in `docs/security.md` under a new "Security-block assertion layer (H5)" subsection.

## Deliverable 5 - Live journey drivers (AUTHORED, not run - the lead runs them)

Two committed, budget-capped, transient-tolerant drivers modelled on `fees-knowledge.e2e.mjs` /
`assistant-billing.e2e.mjs` (safeJson never throws; bounded transient tolerance; single-shot build
create; 20min build deadline). node --check clean. Registered in `api/tests/SUITE_LEDGER.json`
(`node_drivers.drivers`, targetGate `operator-run H5`).
- `api/tests/e2e/edit-journey.e2e.mjs`: admin whoami true -> explicit (client-only) opt-in -> H1-gated
  follow-up PATCH RUN -> preview/diff (versions) -> approve (keep head) -> ROLLBACK restores (H3
  forward-restore to the pre-run head); AND a freshly-created role:'user' session gets whoami false +
  POST /jobs follow-up refused 403 (canEditApps). Budget: up to 2 builds (setup + patch-run; 1 with
  `EDIT_APP_ID`) + 1 rollback restore.
- `api/tests/e2e/request-changes-journey.e2e.mjs`: an in-org user files from inside an org-shared app
  (route+screen context) -> lands in the OWNER org queue -> the org-admin sees it WITH context ->
  convert STARTS an H1-gated patch run + links the jobId (asserted at the API level: the build is
  started then cancelled, not awaited). FOLDS IN H4's live cross-org proof: a different-org user
  filing about the same app -> 404, no injection into the queue. Budget: 1 setup build + 1 follow-up
  build started-then-cancelled (1 with `REQCHG_APP_ID`).

## OBSERVATIONS for the lead (non-blocking; NOT fixed - outside H5's remit)

1. **`assistant-billing.e2e.mjs:138` uses `role: 'builder'`** in its `POST /api/v1/users` body. H1's
   rename made `builder` an invalid `Role` enum value, so `CreateUserRequest` validation now 400s that
   create - the driver will FAIL at user-create when the operator runs it. One-char fix
   (`'builder'` -> `'user'`), but the file is an EXISTING operator driver OUTSIDE H5's reserved set
   (and possibly concurrently owned), so it is FLAGGED, not touched. The H5 journey drivers correctly
   use `role: 'user'`.
2. **Collection-rule `access: { read, write: 'session' | 'server' }` is declared-but-unenforced.** The
   manifest schema (`api/src/data/collections-engine.ts`) lets an app author DECLARE a write-access
   level of `session`/`server`, but `served-data.ts` never consults it (every write is app-id-scoped
   regardless). If any app relied on `access.write: 'session'` for security it would not hold. This is
   PRE-EXISTING (C3/D1 data plane), OUTSIDE the H-block's platform-authz scope, and consistent with
   the byte-compat posture already documented - flagged for the C3/data-plane owner, not fixed (H5
   asserts, it adds no auth code).
3. Minor: `shared/src/capabilities.ts` header comment is stale (still says the file "exposes a
   PERMISSIVE stub ... until then"; H1 landed the real matrix). It does NOT contain the hyphenated
   `PERMISSIVE-STUB` grep marker, so the D2 gate is unaffected. `shared/src` is outside H5's reserved
   set - not touched.

None of these is a GAP in what H1-H4 built (no missing platform gate, no isolation hole, no missing
server authz on the platform planes) - so H5 is DONE-GREEN, not GAP-FOUND. The lead decides on (1)/(2).

## Diagram invariant (FIXED-12)
H5 changes NO structure, flow, or data shape - it adds committed assertions + docs over the existing
security block (whose diagrams H1/H3/H4 already updated: 12-org-tenancy, 04-agent-job, 03-request-crud,
10-privacy-boundaries). No diagram update is required for an assertion-only slice (checked, decided).

## Reserved-path compliance
All changes are within the H5 reserved set:
- `api/tests/auth/capabilities.test.ts` (extended)
- `api/tests/security/grep-gates.test.ts`, `assistant-cross-org-isolation.test.ts`,
  `destructive-action-authz.test.ts` (new dir `api/tests/security/`)
- `api/tests/e2e/edit-journey.e2e.mjs`, `request-changes-journey.e2e.mjs` (new)
- `api/tests/SUITE_LEDGER.json` (2 driver rows)
- `docs/security.md` (H5 assertion-layer subsection + the destructive-action-authz finding)
- `docs/autothing/runs/.../slices/H5/**` (this file + worker-status.txt)
NO `api/src`/`shared/src`/`web` production file touched. No commits, no stack ops, no real builds
(the journey drivers are authored, not run). Nothing outside `api/src/llm` touches the provider.

## Verification (all green, locally)
- `cd api && npx tsc --noEmit -p tsconfig.json` -> 0; `-p tsconfig.test.json` -> 0
- `npx eslint` on the four touched `.ts` test files -> 0 errors (the `.mjs` drivers are config-ignored;
  `node --check` is their gate - both pass)
- `cd api && npx vitest run tests/` (FULL lane) -> **180 files, 1627 passed, 1 skipped, 0 failed**
- grep gate proven to FAIL on a planted `'builder'` + `PERMISSIVE-STUB` probe, then green after removal
  (non-tautology - and also self-proved in-suite)
- repo-root `npm run gate:chokepoint` -> clean
- `node --check` on both new `.e2e.mjs` drivers -> OK; `SUITE_LEDGER.json` re-validated as JSON
