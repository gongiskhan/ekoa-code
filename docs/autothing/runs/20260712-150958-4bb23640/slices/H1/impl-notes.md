# H1 impl-notes — SECURITY: roles capability layer, builder->user migration, permission-gated builds

Status: DONE-GREEN. All lead design decisions implemented as written (no relitigation).

## What I built

### (a) Role rename `builder` -> `user`
- `shared/src/common.ts`: `Role = z.enum(['super-admin','org-admin','user'])` (the sanctioned value rename).
- `api/src/data/stores.ts`: `UserDoc.role` literal type `... | 'user'`.
- UI + locales: web users page toggle values/badges (`'org-admin' | 'user'`), locale KEY `roleBuilder` -> `roleUser` (PT `Utilizador`, EN `User`), plus `web/locales/types.ts` (the Translation shape), `web/stores/users.ts` + `web/stores/billing.ts` role type unions.
- The web `pages.builder.*` namespace (the app-BUILDING workspace: `title: 'Builder'`, `whatToBuild`, ...) is a FEATURE area, not the role label - left untouched (out of scope per decision 7 "NO other web behavior change").

### (b) Real `can()` capability matrix — `api/src/auth/capabilities.ts`
Replaced the PERMISSIVE-STUB body + header. Pure role->capability map (`Record<Role, Capability[]>`):
- `super-admin`, `org-admin`: all four (`canBuildApps`, `canEditApps`, `canCreateArtifacts`, `canUseChat`).
- `user`: `canUseChat` + `canCreateArtifacts` only.
- **null/undefined actor: NOTHING (fail closed)** — decided + documented (see "Null-actor semantics" below).
- Unknown/stale role also fails closed (defensive `?? false`, so a signature-valid token carrying a dead role value grants nothing). Vocabulary in `shared/src/capabilities.ts` unchanged (not touched).

### (c) Two legacy-compat layers
- **Boot migration** `migrateBuilderRole()` (`api/src/auth/users-service.ts`), wired into `bootState()` (`api/src/server.ts`) right AFTER `loadActivation` (so the epoch bump lands in the freshly-loaded in-memory activation map). Idempotent: rewrites every `role:'builder'` row to `'user'` and bumps its token epoch (reusing the role-change revocation path), returns the count (0 once migrated). No migration framework used (matches the repo's idempotent-boot-step convention).
- **Verify-boundary shim** in `verifyToken()` (`api/src/auth/jwt.ts`): a JWT still carrying `role:'builder'` is normalised to `'user'` before it is returned. **Placement note (minor deviation from the brief's literal wording):** the brief said "requireAuth/verifySseToken map...". Both of those call `verifyToken` as their first step, and so do every `?token=` consumer (build-link, m365, serving routers). Putting the shim in the single verify chokepoint covers all of them with one line and guarantees "before any check" for the two named admission paths too. Documented inline as the legacy-window shim.

### (d) Four capability gates wired (per-route `can()`, NOT a descriptor-middleware refactor)
- `api/src/routes/jobs.ts` `POST /`:
  - first build (no `artifactId`): `can(actor,'canBuildApps')` else 403.
  - follow-up (`artifactId`): `can(actor,'canEditApps')` FIRST (capability refusal never leaks target existence), THEN `loadWritable(actor, artifactId)` (own always; org-shared in-org ok; other-user private -> 403; missing/cross-org -> 404). **This closes the follow-up-build IDOR (map §5.1)** — gated BEFORE any job is created or agent spawned.
- `api/src/routes/chat.ts` `POST /runs`: `can(actor,'canUseChat')`.
- `api/src/routes/artifacts.ts` `POST /`: `can(actor,'canCreateArtifacts')`.

**Why route-level, not inside `handleBuildCreate`:** `handleBuildCreate` has exactly one caller (`jobs.ts:39` — verified by grep), and `routes/` already imports `apps/app-paths` (`loadWritable`) + `auth/` (artifacts.ts precedent), so the route is the correct tier. `agents/build.ts` reaches `apps/` only through injected seams; importing `loadWritable` there would break the seam convention. Route-level gating also keeps the agents-layer tests (which call `handleBuildCreate`/`executeBuildJob` directly) and automation-internal build paths unaffected by the gate. `api/src/agents/build.ts` and `api/src/apps/app-paths.ts` were therefore NOT modified.

### (e) Refusal contract
Shared FORBIDDEN envelope + `details.capability` (+ PT-PT message, no emoji, no em/en-dash) on every capability refusal. Object-ownership denials (the IDOR 403 and the 404) carry NO `details.capability` — they are resource denials, not capability refusals. `shared/src/errors.ts` NOT touched: `ErrorEnvelope.details` is already `z.record(JsonValue)`, and `{ capability: '<name>' }` is plain JSON, so the addition is purely additive and validates.

### (f) Default role on create
`createUser` (`api/src/auth/users-service.ts`) role param is now optional and defaults to `'user'`. The HTTP contract (`CreateUserRequest.role`) is left REQUIRED (unchanged - additive-only); the service default protects direct programmatic callers. Interpreted decision 6 literally ("users-service createUser default role becomes 'user'").

### (g) Tests
- `api/tests/auth/capabilities.test.ts` (NEW, replaces the deleted `capabilities-stub.test.ts`): all 12 role×capability cells + null/undefined -> nothing + vocabulary pin.
- `api/tests/auth/role-migration.test.ts` (NEW): migration idempotence on mongo-mem (builder row -> user once, epoch bumped once, second run = 0, no re-bump) + verifyToken legacy-role normalization (builder->user; user/org-admin untouched).
- `api/tests/contract/jobs.test.ts` (EXTENDED): a `user` first-build -> 403 FORBIDDEN envelope + `details.capability='canBuildApps'`.
- `api/tests/contract/jobs-capability.test.ts` (NEW, integration, mongo-mem, real jobsRouter, `handleBuildCreate` mocked = "mock the executor"): first-build user 403 / org-admin 202; follow-up IDOR — user 403 (canEditApps, before ownership), org-admin vs other-user private in-org 403 (ownership, no capability field), cross-org 404, org-shared same-org 202, own-private 202. Refusals assert the executor was never called.

### (h) Docs + diagram
- `docs/security.md`: updated the access-control section — role rename, a capability matrix table, the four gates, the refusal contract, and a dedicated "Follow-up-build ownership (IDOR fix, H1)" paragraph.
- Diagrams (FIXED-12): I checked `10-privacy-boundaries` first — it names only `org-admin`, not the role model or the build gate, so it is NOT the affected diagram. The two affected diagrams:
  - `docs/diagrams/12-org-tenancy.excalidraw` (the ROLE/tenancy model): renamed `builder`->`user` in the users store + roles legend, and rewrote the per-role capability lines to encode the new matrix (`org-admin` gains "app build/edit"; `user` = "chat + own/org-shared artifacts; NOT app build/edit (H1)").
  - `docs/diagrams/04-agent-job.excalidraw` (the build/job flow): added an "H1 build authz gate" note at the `POST /jobs` entry describing the canBuildApps / canEditApps+loadWritable gates and the IDOR closure. (Its existing `builder`/`capability`/`follow-up` strings are unrelated — builder-CHROME scrub, pv1 CAPABILITY token, knowledge-scoping follow-up — so no rename there.)
  Both files re-validated as parseable JSON; diffs are minimal (12: 8 lines; 04: +1 element).

## Null-actor semantics (decided + documented)
A `null`/`undefined` actor holds NO capability — `can()` returns `false` for everything (fail closed). Rationale: an absent actor means the caller failed to resolve identity; granting anything would be a fail-open bug. In practice every wired gate runs after `requireAuth`, so `actor` is always present at the call sites; the null branch is the defensive contract the matrix test pins.

## Every suite the rename broke + the fix
The enum rename makes `'builder'` unassignable to `Role`/`UserDoc['role']`, breaking the TEST typecheck everywhere a test seeded it, AND the new `canBuildApps` gate 403s any `builder`(->`user`) actor that built through the route. Fixes:
1. **`api/tests/contract/jobs.test.ts`** — `u1` POSTs real builds expecting 202; a `user` now 403s. Fix: `u1` seeded as `org-admin` (can build); `u2` (SSE-only cross-user) -> `user`.
2. **`api/tests/contract/registo.test.ts`** — `bldA` (builder) POSTs builds to produce `build.created` audit rows; a `user` 403s before any job/audit exists. Fix: `bldA` seeded as `org-admin` (commented: building now needs canBuildApps).
3. **`api/tests/agents/build.test.ts`** — actor `role:'builder'` -> `'user'`. NO behavior change: these call `handleBuildCreate`/`executeBuildJob` DIRECTLY, bypassing the route gate.
4. **~50 other `api/tests/**` files** — pure literal `'builder'`->`'user'` sweep (role seeds/actors/union annotations). No behavior change: they either don't hit the gated build route, or use chat/artifact-create (both retained by `user`), or call agents/services directly. Excluded from the sweep: `artifact-type.contract.test.ts:13` (`'builder'` there is a BAD artifact-TYPE value, not a role) and the deleted stub test.
5. **`shared/src/contract.test.ts`** — asserts an AuthUser with `role:'builder'` validates; -> `'user'`.
6. **web** — `web/__tests__/components/users-page.test.tsx` + `usage-page.test.tsx` seeds -> `user`; page/store/locale type unions renamed. Web unit lane green (167 tests), users-page/usage-page green.

## Reserved-path compliance (git status)
All changes are within the brief's reserved paths EXCEPT the following, each REQUIRED by the sanctioned enum-value rename sweep ("sweep EVERY consumer") and listed explicitly:
- `api/src/data/stores.ts` — `UserDoc.role` literal type carries `'builder'`.
- `api/src/integrations/prefetch.ts`, `api/src/automation/engine.ts` — synthetic internal actors constructed with `role:'builder'` (visibility/scoping queries).
- `api/src/automation/service.ts` — the one real behaviour branch `actor.role === 'builder'` (`canCreateAutomation`); the persisted org-setting key `allowBuilderAutomations` keeps its wire name (data compat), only the role value changed.
- `shared/src/contract.test.ts` — AuthUser validation test.
- `web/locales/types.ts`, `web/stores/users.ts`, `web/stores/billing.ts` — role type unions the web typecheck requires.
- Test files outside `api/tests/{auth,contract}/**` + `api/tests/agents/build.test.ts` (e.g. `api/tests/agents/_setup.ts`, `agents/chat-*.test.ts`, `agents/registry.test.ts`, `apps/*`, `automation/*`, `auth/activation-auth.test.ts`, `bridge/token.test.ts`, `data/crypto-jwt.test.ts`, `events/*`, `integrations/*`, `knowledge/*`, `memory/*`) — all had `role:'builder'` literals that break the test typecheck under the rename.
- `web/next-env.d.ts` — shows as Modified but was ALREADY modified at session start (pre-existing, not my change).

NOT touched (deliberately): `shared/src/capabilities.ts` (vocabulary unchanged), `shared/src/{auth,jobs,errors}.ts` (no contract shape change - additive `details.capability` rides the existing envelope), `api/src/routes/users.ts` (default handled in the service), `api/src/agents/build.ts` + `api/src/apps/app-paths.ts` (route-level gating; loadWritable reused as-is). Served-app plane (`app-assistant-route`, `app-sso`) untouched.

## Verify commands + results (all green)
- `cd api && npx tsc --noEmit -p tsconfig.json` -> clean.
- `cd api && npx tsc --noEmit -p tsconfig.test.json` -> clean.
- `npx eslint` on all touched src + new tests -> 0 problems. `npx eslint api/tests` -> 0 errors (7 pre-existing unused-var WARNINGS in untouched `llm/`+`fake-daemon/` files).
- `cd api && npx vitest run tests/` -> **172 files, 1506 passed, 1 skipped** (full api lane; the rename broke nothing not listed above).
- `npm run gate:chokepoint` -> clean.
- `cd web && npx tsc --noEmit` -> clean; `npx vitest run` -> **30 files, 167 passed**; web lint touched files -> 0 errors (1 pre-existing react-hooks WARNING in `SetLimitDialog`, untouched by H1).
- `shared` rebuilt (`npm run build --workspace shared`) so `@ekoa/shared` d.ts reflects the enum (api resolves shared via `dist`).

## Known pre-existing (out of H1 scope)
- `web/app/(dashboard)/users/page.tsx:328` react-hooks/set-state-in-effect WARNING in `SetLimitDialog` (reset-on-open pattern) — predates H1, untouched; fixing it is a UI refactor outside the security block. Noted, not addressed.

## Codex-fix round

Loop-back on the Codex review of e2c165e (2 High + 1 Medium + 1 Low, all real). Built ON TOP of
e2c165e in the working tree (no commits). All four closed; full api vitest lane green
(**173 files, 1522 passed, 1 skipped** — was 172/1506/1 at e2c165e: +1 file, +16 tests). tsc
src+test clean, eslint 0 on every touched file, `gate:chokepoint` clean. No web file touched, so
no web typecheck run. 14 files changed, all inside the H-block reservation.

### HIGH-1 — durable `tokenEpoch` + `billingLocked` (revocation survives restart)
Root cause: `loadActivation` reloaded only `{active}`, so `tokenEpoch`/`billingLocked` defaulted to
`0`/`false` at every boot — every revocation and the billing lock silently un-did on restart.
- `api/src/data/stores.ts` `UserDoc` (:19-28) — added `tokenEpoch?: number` and `billingLocked?: boolean` (durable columns).
- `api/src/server.ts` `bootState` (:679) — `loadActivation` now maps `{ userId, active, billingLocked, tokenEpoch }` from every row (the loader already accepted both optionals).
- `api/src/auth/service.ts`:
  - New `bumpTokenEpochDurable(userId, epochSec)` — bumps the in-memory map AND writes `tokenEpoch` to the row in one op. Used by `logoutOther` (the one standalone bump). Exported (the durable-revocation test seeds through it).
  - `login` — syncs the map from the AUTHORITATIVE row, preferring the durable `u.billingLocked`/`u.tokenEpoch` (falls back to cache, then default), so a lock/revocation is restored even on a cold cache; the reloaded epoch feeds `mintIat`.
  - `changePassword`, `resetPassword`, `setUserActive` — fold `tokenEpoch` (and, for `setUserActive`, `billingLocked`) into their EXISTING `users.update` write (the "same operation" the brief calls for), keeping the in-memory bump as the fast path.
- `api/src/auth/users-service.ts` — `patchUser` (role change) and `migrateBuilderRole` fold `tokenEpoch` into their existing role `users.update`.
- Note: no code path sets `billingLocked = true` today (grep-confirmed — it is read-only in every plane), so the billing-lock work is the persistence plumbing + boot reload that makes a future/persisted lock survive restart (closes the carried LANDING "bootState loads activation without billingLocked" item). `createUser`/`seedAdmin` insert without the columns (absent = default), consistent with the loader's defaulting.
- **Proof** — `api/tests/auth/role-migration.test.ts`: the migration test now also asserts the ROW carries the bumped epoch (durability, not just the map); new `describe('durable revocation survives restart (H1 boot path)')` seeds a durable epoch, `simulateRestart()` (clears the map + re-runs `loadActivation` from the store exactly as `bootState` does), and asserts the epoch survived (an old-iat token still rejected, a fresh one admitted); same for a persisted `billingLocked=true`; plus a legacy-row-without-columns clean-default case.

### HIGH-2 — gate the OTHER app build/edit vectors (app-type-aware)
A `user` OWNS the artifacts they create, so `writable()` passed and they could change app code
without touching `POST /jobs`.
- `api/src/apps/app-paths.ts` — new `isAppArtifact(art)` (:67-): a BUILT app is signalled primarily by a recorded `data.projectDir` (only pipeline-built artifacts have one; a bare `POST /artifacts` record does not), secondarily by `data.artifactType === 'app'`. Non-app artifacts match neither and stay user-manageable.
- `api/src/routes/artifacts.ts` — a local `denyAppEdit(req,res,art)` helper (FORBIDDEN + `details.capability:'canEditApps'` when `isAppArtifact` and no `canEditApps`) wired AFTER `writable()`/`readable()` (ownership still applies first) on: `bundle-update`, `PUT /file`, `versions/:sha/restore`, `backend/enabled`, `backend/sample-run`, `backups` (snapshot), `backups/restore`. `POST /import` → `canBuildApps` (a bundle is always an app export). `POST /:id/fork` → app-type-aware: `canBuildApps` for an app, `canCreateArtifacts` for a non-app (users keep it). Read routes + `DELETE` left as-is (per brief; not over-gated for H5).
- **Scope decision:** gated EXACTLY the brief's vector list. `featured-update/apply|ignore` are NOT in that list and are left ungated (documented here rather than silently widening scope — revisit if H5 wants them).
- **Proof** — new `api/tests/contract/artifacts-capability.test.ts` (mongo-mem, real `artifactsRouter`; only the two heavy services a 2xx path reaches — `importArtifact`/`updateArtifactFromBundle`/`forkArtifact` — are factory-mocked so no real build): a `user` owning an APP gets 403 `canEditApps` on all seven in-place vectors and 403 `canBuildApps` on import/fork-of-app (service never called); an org-admin proceeds (service reached); a `user` forking a NON-app artifact they own is NOT refused (201, `canCreateArtifacts` preserved). No census/ledger bump needed — the suite-ledger runner censuses only Playwright specs / node drivers / web unit files, explicitly NOT `api/tests/contract/**` (scripts/suite-ledger-run.mjs:185-190).

### MEDIUM — follow-up TOCTOU (re-validate writability at execution)
`resolveFollowUp` re-fetched the artifact by id with no ownership check, so an owner could flip
`org→private` between the create-time gate and execution and the queued job still edited it.
- **Seam decision (boundary preserved):** `agents/build.ts` reaches `apps/` only through the injected mechanics seam (ch02 §2.7, confirmed by ekoa-architecture) — it must not import `loadWritable`. Added `revalidateWritable(actor, artifactId): Promise<'ok'|'notfound'|'forbidden'>` to the `BuildMechanics` seam (`api/src/agents/seams.ts`, interface + noop default returns `'ok'`), implemented in `api/src/apps/build-mechanics.ts` (delegates to `loadWritable`). The verdict union is inlined in the seam (no `apps/` type import into `agents/`).
- `api/src/agents/build.ts` — the follow-up execute branch calls `mech.revalidateWritable(input.actor, artifactId)` IMMEDIATELY before `resolveFollowUp`; a non-`ok` verdict is a distinct terminal `failed { EDIT_FORBIDDEN, "Já não tem permissão para alterar esta aplicação." }` (job error `code` is a free `z.string()` in shared/jobs — additive, validates). resolveFollowUp is never reached, so the agent is not resumed.
- **Proof** — `api/tests/agents/build.test.ts`: new test with `revalidateWritable → 'forbidden'` and a `resolveFollowUp` spy — asserts the job ends `failed`/`EDIT_FORBIDDEN` and the spy count is 0. `fakeMechanics` gained `revalidateWritable → 'ok'` so the existing follow-up-execute tests still proceed.

### LOW — existence oracle in the follow-up 403/404 split
- `api/src/routes/jobs.ts` — in the follow-up gate, collapsed `loadWritable` `'forbidden'` into the SAME 404 as missing/cross-org (`if (verdict !== 'ok') return notFound(res)`). This is LOCAL to the build gate; the artifact routes keep their 403/404 distinction (they may legitimately differ). **This overrides the H1 brief's 403/404 split for the follow-up path** — security over the brief's convenience.
- **Proof** — `api/tests/contract/jobs-capability.test.ts`: the org-admin-vs-other-user-private case now expects **404** (was 403), asserting the ErrorEnvelope and that the executor was never called; header comment updated.
