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
session id: 019f5c77-0988-7c32-ae1b-1401776b3043
--------
user
You are an adversarial cross-model SECURITY reviewer in the git repo at /Users/ggomes/dev/ekoa-code. Review commit e2c165e (git show e2c165e; read any file you need): slice H1 of a security block - the real role->capability layer replacing a permissive can() stub (super-admin/org-admin: canBuildApps/canEditApps/canCreateArtifacts/canUseChat; user: canUseChat+canCreateArtifacts; null/unknown role: nothing), a builder->user role rename with an idempotent boot migration (role rewrite + tokenEpoch bump) plus a legacy-JWT normalization shim in verifyToken, and four route-level gates: POST /jobs first-build requires canBuildApps; POST /jobs follow-up requires canEditApps THEN a loadWritable ownership check (own always / org-shared in-org / other-user-private 403 / cross-org 404) - closing a live cross-tenant IDOR where any authenticated user could drive a code-writing agent against any artifact; POST /chat/runs requires canUseChat; POST /artifacts requires canCreateArtifacts. Refusals: shared FORBIDDEN envelope + details.capability, PT-PT. Context docs: docs/autothing/runs/20260712-150958-4bb23640/slices/H1/{exploration-auth-surface.md,brief.md,impl-notes.md}. HUNT for real security defects with file:line + concrete attack scenarios: ungated build/edit vectors the route-level gates miss (automation engine, integration flows, internal callers, the agents-layer functions the tests call directly - can ANY user-controlled path reach them without the route?); TOCTOU between the route ownership check and resolveFollowUp's later re-fetch; existence leaks in the 403/404 split; epoch-bump revocation actually invalidating outstanding builder JWTs (trace requireAuth's epoch compare + the boot-time activation load); the verifyToken normalization shim's blast radius; forged/unknown role values through zod; dead 'builder' comparisons left by the rename (silent behavior changes, e.g. the automation service); test honesty (matrix test tautologies, contract tests validating against the real shared schema). You may run read-only commands (grep, git, tsc) but NOT tests that need a network or real builds. End with findings classified High/Medium/Low with file:line, then exactly one line: VERDICT: APPROVE or VERDICT: NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `e2c165e` as a security pass. I’m first loading the repo context docs and the changed surface so I can trace every user-controlled path into the new capability and ownership checks.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "pwd && ls -la && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'AGENTS.md' -g '.codegraph' -g 'docs/autothing/runs/20260712-150958-4bb23640/slices/H1/**'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/Users/ggomes/dev/ekoa-code
total 1264
drwxr-xr-x@  32 ggomes  staff    1024 Jul 13 16:54 .
drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
drwxr-xr-x@   6 ggomes  staff     192 Jul 13 11:15 .claude
drwxr-xr-x@   9 ggomes  staff     288 Jul 13 18:12 .codegraph
-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
drwxr-xr-x@  16 ggomes  staff     512 Jul 13 18:11 .git
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
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/codex-review.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/brief.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/worker-status.txt
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/impl-notes.md
docs/autothing/runs/20260712-150958-4bb23640/slices/H1/exploration-auth-surface.md

exec
/bin/zsh -lc 'git show --stat --oneline --decorate=short e2c165e' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-sC280VE7' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-LUMsq5DK' (errno=Operation not permitted)
e2c165e (HEAD -> main) feat(operator-run/h1): SECURITY - real capability layer replaces the permissive stub; builder->user role migration (idempotent boot step + legacy-JWT shim at the verify chokepoint); four gates wired (canBuildApps on first builds, canEditApps+loadWritable on follow-ups CLOSING the cross-tenant follow-up-build IDOR, canUseChat, canCreateArtifacts); machine-readable PT-PT refusals (FORBIDDEN + details.capability); stub test replaced by the real matrix; security.md + diagrams 12/04 updated
 api/src/auth/capabilities.ts                       |  43 +++++--
 api/src/auth/jwt.ts                                |   8 ++
 api/src/auth/users-service.ts                      |  27 ++++-
 api/src/automation/engine.ts                       |   2 +-
 api/src/automation/service.ts                      |   6 +-
 api/src/data/stores.ts                             |   2 +-
 api/src/integrations/prefetch.ts                   |   2 +-
 api/src/routes/artifacts.ts                        |   7 ++
 api/src/routes/chat.ts                             |   9 +-
 api/src/routes/jobs.ts                             |  22 ++++
 api/src/server.ts                                  |   7 +-
 api/tests/agents/_setup.ts                         |   2 +-
 api/tests/agents/build.test.ts                     |   2 +-
 api/tests/agents/chat-identity.test.ts             |   2 +-
 api/tests/agents/chat-lifecycle.test.ts            |   2 +-
 api/tests/agents/chat-thinking.test.ts             |   2 +-
 api/tests/agents/registry.test.ts                  |   4 +-
 api/tests/apps/base-loader.test.ts                 |   2 +-
 api/tests/apps/build-mechanics.test.ts             |   2 +-
 api/tests/auth/activation-auth.test.ts             |   4 +-
 api/tests/auth/capabilities-stub.test.ts           |  29 -----
 api/tests/auth/capabilities.test.ts                |  53 +++++++++
 api/tests/auth/role-migration.test.ts              |  91 +++++++++++++++
 api/tests/automation/cache.test.ts                 |   6 +-
 api/tests/automation/service.test.ts               |   4 +-
 api/tests/bridge/token.test.ts                     |   2 +-
 api/tests/contract/artifact-family.test.ts         |   4 +-
 api/tests/contract/auth.test.ts                    |  34 +++---
 api/tests/contract/automations.test.ts             |   2 +-
 api/tests/contract/billing.test.ts                 |  26 ++---
 api/tests/contract/branding.test.ts                |   6 +-
 api/tests/contract/bridge-status.test.ts           |   2 +-
 api/tests/contract/build-failure.test.ts           |   2 +-
 api/tests/contract/chat.test.ts                    |   2 +-
 api/tests/contract/credentials.test.ts             |   4 +-
 api/tests/contract/cross-org.test.ts               |  26 ++---
 api/tests/contract/denylist.test.ts                |   2 +-
 api/tests/contract/error-envelope.test.ts          |   4 +-
 api/tests/contract/f5-ui-endpoints.test.ts         |   2 +-
 api/tests/contract/integration-builder.test.ts     |   2 +-
 api/tests/contract/integration-definitions.test.ts |   8 +-
 api/tests/contract/integrations-knowledge.test.ts  |  12 +-
 api/tests/contract/jobs-capability.test.ts         | 129 +++++++++++++++++++++
 api/tests/contract/jobs.test.ts                    |  22 +++-
 api/tests/contract/knowledge.test.ts               |  18 +--
 api/tests/contract/masking-summary.test.ts         |   2 +-
 api/tests/contract/memories.test.ts                |   2 +-
 api/tests/contract/registo.test.ts                 |   5 +-
 api/tests/contract/served-app.test.ts              |  10 +-
 api/tests/contract/sessions.test.ts                |   4 +-
 api/tests/contract/triggers-crossorg.test.ts       |   2 +-
 api/tests/data/crypto-jwt.test.ts                  |   6 +-
 api/tests/events/delivery.test.ts                  |   2 +-
 api/tests/events/get-callback.test.ts              |   2 +-
 api/tests/events/webhook.test.ts                   |   2 +-
 api/tests/integrations/action-executor.test.ts     |   2 +-
 api/tests/integrations/pipedream.test.ts           |   4 +-
 api/tests/integrations/platform.test.ts            |   2 +-
 api/tests/integrations/prefetch.test.ts            |   2 +-
 api/tests/integrations/routes.contract.test.ts     |  12 +-
 api/tests/knowledge/build-knowledge-ingest.test.ts |   2 +-
 api/tests/memory/injection-taxonomy.test.ts        |   2 +-
 api/tests/memory/recall-wiring.test.ts             |   2 +-
 .../slices/H1/impl-notes.md                        |  86 ++++++++++++++
 .../slices/H1/worker-status.txt                    |   1 +
 docs/diagrams/04-agent-job.excalidraw              |  32 +++++
 docs/diagrams/12-org-tenancy.excalidraw            |   8 +-
 docs/security.md                                   |  34 +++++-
 shared/src/common.ts                               |   5 +-
 shared/src/contract.test.ts                        |   2 +-
 web/__tests__/components/usage-page.test.tsx       |   2 +-
 web/__tests__/components/users-page.test.tsx       |   8 +-
 web/app/(dashboard)/users/page.tsx                 |  28 ++---
 web/locales/en.ts                                  |   2 +-
 web/locales/pt.ts                                  |   2 +-
 web/locales/types.ts                               |   2 +-
 web/next-env.d.ts                                  |   2 +-
 web/stores/billing.ts                              |   2 +-
 web/stores/users.ts                                |   6 +-
 79 files changed, 723 insertions(+), 213 deletions(-)

codex
The repo is codegraph-indexed, so I’m using that first for the auth and route graph rather than grepping blind. After that I’ll validate the migration, JWT normalization, and any direct internal callers that could bypass the route gates.
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,220p' docs/autothing/runs/20260712-150958-4bb23640/slices/H1/brief.md" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "sed -n '1,260p' docs/autothing/runs/20260712-150958-4bb23640/slices/H1/exploration-auth-surface.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
# H1 delegation brief - SECURITY: roles capability layer, builder->user migration, permission-gated builds

Slice H1 (mixed, size 6, deps: all A-G passed). FIRST slice of the atomic H1-H6 security block
(lands together-or-not-at-all). Run commits DIRECTLY TO MAIN; the lead runs gates and commits.
AUTHORITATIVE FACTS: slices/H1/exploration-auth-surface.md (the auth-surface map - read it first;
every file:line you need is there). Spec: BRIEF.md Phase 9a + the FLOW_PLAN H1 row.

## LEAD DESIGN DECISIONS (made; implement, do not relitigate)

1. **Role rename: builder -> user.** `Role = z.enum(['super-admin','org-admin','user'])`
   (shared/src/common.ts:33). The builder persona is dead (brief). PT-PT label `Utilizador`
   (locales roleBuilder -> roleUser). Store is Mongo (the brief's "Firestore" is stale - assumptions
   ledger).
2. **Legacy compatibility, two layers:** (a) idempotent boot-step migration in bootState()
   (server.ts ~675, matching the repo's no-migration-framework convention): every user row with
   role 'builder' -> 'user' + bump that user's tokenEpoch (forces re-mint; role changes already bump
   epoch - reuse that path); (b) verify-boundary normalization: requireAuth/verifySseToken map a
   legacy JWT role 'builder' -> 'user' before any check (covers the window between boot and re-login;
   keep it small and commented as legacy-window shim).
3. **Capability matrix (the real can()):** super-admin: ALL; org-admin: ALL
   (canBuildApps, canEditApps, canCreateArtifacts, canUseChat); user: canUseChat +
   canCreateArtifacts ONLY (brief: "user - chat, non-app artifacts, full artifacts area; cannot
   build or change apps"). Pure role->capability map, same signature shape
   (Pick<JwtClaims,'role'> | null | undefined) - resource/org checks stay SEPARATE (loadWritable
   etc.). Remove the PERMISSIVE-STUB marker + header. Vocabulary in shared/src/capabilities.ts is
   unchanged.
4. **Wire the four gates (per-route can(), NOT a descriptor-middleware refactor - that is a
   post-run LANDING candidate):**
   - POST /jobs first build (no artifactId): `can(actor,'canBuildApps')` else 403 FORBIDDEN with
     `details: { capability: 'canBuildApps' }` and PT-PT message ("Não tem permissão para criar
     aplicações; pode pedir ao administrador da organização." - the H4 queue will consume this
     refusal shape; the details.capability field is the machine hook).
   - POST /jobs follow-up (artifactId present): `can(actor,'canEditApps')` AND an
     ownership/writability check on the target artifact mirroring loadWritable semantics
     (api/src/apps/app-paths.ts:88-97): own always; org-shared within org ok; another user's
     private -> 403; missing/cross-org -> 404. **This closes the follow-up-build IDOR (map §5.1) -
     the slice's most important defect fix.** Gate at the route/handleBuildCreate boundary BEFORE
     any job is created or agent spawned.
   - POST /api/v1/chat/runs: `can(actor,'canUseChat')` (true for every role today - wire the gate
     so the matrix is enforced, not implied).
   - Artifact create (the POST /artifacts route): `can(actor,'canCreateArtifacts')`.
5. **Refusal contract:** shared error envelope FORBIDDEN + details.capability (additive - check
   the envelope schema in shared/ and extend contract tests). Every refusal path returns the
   envelope; no dead-end (the pre-drafted request-to-admin CONVERSION is H4, not H1 - H1 only
   guarantees the machine-readable refusal).
6. **Default role on create:** users-service createUser default role becomes 'user'.
7. **UI sweep:** web users page role toggle values + badges ('org-admin' | 'user'), locales
   (roleBuilder -> roleUser, PT 'Utilizador' / EN 'User'), any other 'builder'/'Construtor'
   occurrence in web/ (grep). NO other web behavior change in H1 (build-button hiding etc. can ride
   the 403 envelope; H3/H4 own the panel UX).
8. **Replace the pinned stub test** api/tests/auth/capabilities-stub.test.ts with the real matrix
   test (role x capability grid, all 12 cells + null/undefined actor -> false for everything except
   nothing: a null actor has NO capabilities now - decide-and-document in impl-notes; H5 will grep
   that no PERMISSIVE-STUB marker survives).
9. **Docs + diagram (same unit of work):** docs/security.md roles section (three roles, matrix
   table, the IDOR fix); diagram 10-privacy-boundaries.excalidraw if it names roles/authz (check;
   else the affected diagram per FIXED-12 - state in impl-notes which and why).

## TESTS (modules travel with tests)
- Unit: the capability matrix (replaces stub test); legacy-role normalization; migration boot step
  idempotence (mongo-mem: seed a builder row, boot twice, role=user once, epoch bumped once).
- Contract: refused build 403 body validates against the shared envelope + details.capability;
  jobs contract tests extended.
- Integration (mongo-mem, real routers): user role cannot POST /jobs (403), org-admin can;
  follow-up IDOR regression - user B vs user A's private artifact -> 403, cross-org -> 404,
  org-shared same-org + canEditApps -> proceeds (mock the executor; no real build).
- E2e driver (committed, budget-capped): NOT in H1 - H5 owns the journey suite; H1's live proof is
  the integration layer + one cheap live probe the lead will run (role-gated 403 via curl on the
  dev stack - no LLM cost).

## CONSTRAINTS
PT-PT copy, no emoji, no em/en-dash in authored copy. Additive contract changes only (no breaking
shared/ shape changes; Role enum value rename IS the sanctioned exception - sweep every consumer).
The chokepoint rules stand (nothing outside api/src/llm touches the provider). Do NOT touch: the
served-app plane admission (app-assistant-route stays header-scoped visitor-blind - H2's territory),
app-sso, edit-mode/panel UX (H3), queues (H4). No stack ops, no commits - working tree + impl-notes
+ worker-status.txt (DONE-GREEN | vitest summary | BLOCKED:<reason>), same file-channel as G2.

## VERIFY LOCALLY (unit level)
cd api && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json;
npx eslint on touched files; npx vitest run tests/ (FULL api lane - the role rename can break
suites anywhere; fix what the rename breaks, list each in impl-notes); repo-root
npm run gate:chokepoint; web: npx tsc --noEmit -p web/tsconfig.json if web files change + any web
test lane that exists for the users page.

## RESERVED PATHS (the lead holds these for the H block)
shared/src/common.ts, shared/src/capabilities.ts, shared/src/auth.ts, shared/src/jobs.ts,
shared/src/errors.ts (if the envelope needs the details hook), api/src/auth/**,
api/src/routes/{jobs,chat,artifacts,users}.ts, api/src/agents/build.ts, api/src/apps/app-paths.ts,
api/src/server.ts, api/tests/auth/**, api/tests/contract/**, api/tests/agents/build.test.ts,
web/app/(dashboard)/users/**, web/locales/*.ts, docs/security.md, docs/diagrams/**, slices/H1/**.

 succeeded in 0ms:
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

exec
/bin/zsh -lc "sed -n '1,260p' docs/autothing/runs/20260712-150958-4bb23640/slices/H1/impl-notes.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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

codex
I have the design brief and auth-surface map. Now I’m tracing actual call paths: the four gated routes, every direct caller of the build/chat/artifact internals, and the boot/auth path that is supposed to revoke legacy `builder` sessions.
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_callers started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_callers (failed)
user cancelled MCP tool call
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_callers started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_callers (failed)
user cancelled MCP tool call
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_callers started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_callers (failed)
user cancelled MCP tool call
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
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
codex
The route gates are in place. I’m now checking whether the same build/edit capability can be reached from adjacent planes that never pass through `POST /jobs`, especially automation, integration-builder, served-app helpers, and any direct `agents/` exports.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"builder|role === 'builder'|role: 'builder'|allowBuilderAutomations|canBuildApps|canEditApps|canCreateArtifacts|canUseChat\" api/src shared/src web -g '"'!node_modules'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
shared/src/capabilities.ts:11:  'canBuildApps',
shared/src/capabilities.ts:12:  'canEditApps',
shared/src/capabilities.ts:13:  'canCreateArtifacts',
shared/src/capabilities.ts:14:  'canUseChat',
shared/src/integration-builder.ts:1:/** Integration builder contract (ch03 §3.8.14). */
shared/src/integration-builder.ts:33:  builderSessionId: z.string().optional(),
shared/src/integration-builder.ts:41:  builderSessionId: z.string(),
shared/src/integration-builder.ts:53:  builderSessionId: z.string(),
shared/src/integration-builder.ts:61:  z.object({ builderSessionId: z.string() }),
shared/src/integration-builder.ts:78:  builderSessionId: z.string(),
shared/src/integration-builder.ts:97:    path: '/api/v1/integration-builder/chat',
shared/src/integration-builder.ts:106:    path: '/api/v1/integration-builder/package',
shared/src/integration-builder.ts:113:    path: '/api/v1/integration-builder/package',
shared/src/integration-builder.ts:120:    path: '/api/v1/integration-builder/test',
api/src/billing/allowance.ts:71: * builder chat route, served-app assistant chat, and gateway messages. A block returns the
shared/src/index.ts:17:import { integrationBuilderEndpoints } from './integration-builder.js';
shared/src/index.ts:47:export * from './integration-builder.js';
shared/src/common.ts:32:/** The three-role model (Amendment 2; H1 security block renamed the base role `builder` → `user`
shared/src/common.ts:33: *  — the builder persona is retired, `user` is the base non-admin role). */
web/e2e/integration-builder.spec.ts:5: * Integration-builder journey (ch03 §3.8.14, backend landed 2026-07-11): the chat handoff
web/e2e/integration-builder.spec.ts:6: * opens the builder panel, one builder turn yields a generated package, saving lands it in
web/e2e/integration-builder.spec.ts:10: * event that opens the panel (integration_build_intent) and the model-backed builder chat
web/e2e/integration-builder.spec.ts:25:  description: 'Integração de meteorologia usada pela prova e2e do builder.',
web/e2e/integration-builder.spec.ts:50:  builderSessionId: 'builder-sess-e2e',
web/e2e/integration-builder.spec.ts:87:test.describe('integration builder', () => {
web/e2e/integration-builder.spec.ts:88:  test('intent opens the panel; a builder turn generates a package; save lands it in the live registry', async ({ page }) => {
web/e2e/integration-builder.spec.ts:115:    // Stub 2 — the model-backed builder chat turn (+ its CORS preflight).
web/e2e/integration-builder.spec.ts:116:    await page.route('**/api/v1/integration-builder/chat', async (route) => {
web/e2e/integration-builder.spec.ts:131:    // The intent switches the side panel to the builder.
web/e2e/integration-builder.spec.ts:134:    // One builder turn: describe the integration; the (stubbed) reply carries the package.
web/e2e/integration-builder.spec.ts:142:      (r) => r.url().includes('/integration-builder/package') && r.request().method() === 'PUT',
api/src/knowledge/service.ts:10: * knowledge/ has NO import path to llm/ (CLAUDE.md, FIXED-3). The grounding builder lives beside
api/src/agents/seams.ts:3: * the content loader (ch08 `assembleAgentContext`) and the knowledge grounding-block builder
api/src/agents/seams.ts:26:  agentKind: 'coding' | 'chat' | 'automation' | 'integration-builder';
api/src/agents/seams.ts:39:export function assembleAgentContext(input: { agentKind: 'coding' | 'chat' | 'automation' | 'integration-builder'; userId: string }): Promise<AgentContext> {
api/src/agents/seams.ts:141:export type LoadContextContentFn = (input: { userId: string; agentKind: 'coding' | 'chat' | 'automation' | 'integration-builder'; name: string }) => Promise<string | null>;
api/src/agents/seams.ts:147:export function loadContextContent(input: { userId: string; agentKind: 'coding' | 'chat' | 'automation' | 'integration-builder'; name: string }): Promise<string | null> {
web/lib/api/core.ts:39:// The `language: true` descriptors (chat run create, job create, integration-builder chat,
web/components/builder/chat-panel.tsx:393:              {pages.builder.whatToBuild}
web/components/builder/chat-panel.tsx:396:              {pages.builder.chooseExample}
web/components/builder/chat-panel.tsx:434:                          ? pages.builder.buildingInProgress
web/components/builder/chat-panel.tsx:435:                          : pages.builder.thinkingInProgress)}
api/src/knowledge/index.ts:5: *  - agents/ uses the grounding builder + legal-context detector (slot-5, ch08 §8.4).
api/src/agents/markers.ts:11: *   - Integration-builder handoff: regex strip of the integration marker anywhere in the stream
api/src/agents/markers.ts:32:  /** An integration-builder handoff was detected; optional hint. */
web/components/builder/integration-build-panel.tsx:6: * Mounts inside the chat-driven builder's side panel when sidePanelState === 'integrate'.
web/components/builder/integration-build-panel.tsx:7: * Drives a minimal conversation with the integration agent (ekoa.integration-builder
web/components/builder/integration-build-panel.tsx:41:  const builderSessionIdRef = useRef<string | null>(activeBuild?.builderSessionId || null);
web/components/builder/integration-build-panel.tsx:61:          builderSessionId: builderSessionIdRef.current || undefined,
web/components/builder/integration-build-panel.tsx:64:          const { builderSessionId: bsid, generatedPackage, validationErrors: errs } = res.data;
web/components/builder/integration-build-panel.tsx:66:          builderSessionIdRef.current = bsid;
web/components/builder/integration-build-panel.tsx:67:          // Persist builder session id so the panel can resume on remount.
web/components/builder/integration-build-panel.tsx:70:            builderSessionId: bsid,
web/components/builder/integration-build-panel.tsx:126:    const bsid = builderSessionIdRef.current;
web/components/builder/integration-build-panel.tsx:131:        builderSessionId: bsid,
web/__tests__/components/no-mode-picker.test.tsx:90:    const sp = readFileSync(join(REPO_ROOT, 'components/builder/side-panel.tsx'), 'utf-8');
web/__tests__/components/no-mode-picker.test.tsx:92:      join(REPO_ROOT, 'components/builder/integration-build-panel.tsx'),
api/src/agents/brand-research.ts:10: * colours + dembrandt design-system + visual-vibe screenshots -> scrub any website-builder chrome
api/src/agents/brand-research.ts:177: * visual-vibe run in parallel (each non-fatal), then builder chrome is scrubbed. Returns the
api/src/agents/brand-research.ts:199:  const builder = detectSiteBuilder(site.finalUrl, site.generator);
api/src/agents/brand-research.ts:200:  if (builder) sink.planStep('running', `Construtor de sites detetado: ${builder.name} (chrome promocional será removido)`);
api/src/agents/brand-research.ts:204:    pipeline.fetchRenderedCandidates(site.finalUrl, { builder }).catch((): RenderedCandidates => ({ ok: false, candidates: [], paintedHexes: [], topFonts: [], chromeColors: [], chromeFonts: [] })),
api/src/agents/brand-research.ts:206:    pipeline.fetchVisualVibe(site.finalUrl, { builder }, attribution).catch((): VisualVibe | null => null),
api/src/agents/brand-research.ts:209:  const scrubbed = scrubBuilderChrome(site, rendered, designSystemRaw, builder);
api/src/agents/brand-research.ts:210:  const snapshotInput = { site: scrubbed.site, rendered, designSystem: scrubbed.designSystem, visualVibe, builder };
api/src/agents/brand-research.ts:316:        builder: detectSiteBuilder(site.finalUrl, site.generator),
web/e2e/artifact-backend-panel.spec.ts:9: * the import builds the dist-backend bundle (app-builder), so the artifact has a
web/__tests__/components/side-panel-preview-recovery.test.tsx:11:import SidePanel from '@/components/builder/side-panel';
api/src/services/design-tokens.ts:2: * Design Tokens CSS builder — the `GET /api/design-tokens.css` content (ch03
api/src/services/design-tokens.ts:15: * builder is testable and the module never imports apps/.
api/src/agents/integration-builder.ts:2: * Integration-builder agent (ch03 §3.8.14).
api/src/agents/integration-builder.ts:7: * (the structured package). The fenced blocks are parsed out (integration-builder-parser.ts) and the
api/src/agents/integration-builder.ts:8: * user sees only the prose; the package populates the builder's side panel.
api/src/agents/integration-builder.ts:10: * Sessions are PERSISTED (data/stores.ts integrationBuilderSessions) — the old cortex builder kept an
api/src/agents/integration-builder.ts:22:import { parseIntegrationOutput } from './integration-builder-parser.js';
api/src/agents/integration-builder.ts:24:/** A persisted builder session (ch03 §3.8.14). */
api/src/agents/integration-builder.ts:148:  builderSessionId: string;
api/src/agents/integration-builder.ts:158: * Run one builder chat turn: allowance gate -> load/create the persisted session -> assemble the
api/src/agents/integration-builder.ts:159: * (kind 'integration-builder') system prompt + reply-language directive -> ONE tool-less WORKHORSE
api/src/agents/integration-builder.ts:175:  // System prompt: the composed integration-builder content sections + a reply-language directive.
api/src/agents/integration-builder.ts:176:  const ctx = await assembleAgentContext({ agentKind: 'integration-builder', userId: actor.userId });
api/src/agents/integration-builder.ts:191:      { kind: 'user_work', agentType: 'integration-builder', billeeUserId: actor.userId, sessionId: session._id },
api/src/agents/integration-builder.ts:227:  return { ok: true, response: { builderSessionId: session._id, generatedPackage, validationErrors } };
api/src/agents/sdk-tools.ts:157:export function loadContextToolSpec(actor: ToolActor, agentKind: 'coding' | 'chat' | 'automation' | 'integration-builder' = 'coding'): SdkToolSpec {
api/src/agents/tools.ts:25:export type RunToolClass = 'chat' | 'build' | 'text-attachments' | 'pure-text' | 'brand-research' | 'integration-builder';
api/src/agents/tools.ts:55:    case 'integration-builder':
api/src/agents/tools.ts:56:      // Tool-less one-shot: the builder emits its two fenced blocks from a single WORKHORSE turn
web/components/builder/side-panel.tsx:404:  // builder instead of the Files/Output/Preview/Versions tabs.
web/__tests__/components/users-page.test.tsx:7: * (`api.users.update { active }`) and the builder<->org-admin role toggle
api/src/agents/integration-builder-parser.ts:2: * Integration-builder output parser (ch03 §3.8.14).
api/src/agents/integration-builder-parser.ts:9: * The builder agent emits its package as TWO fenced blocks: ```skill-md (the integration's
api/src/agents/integration-builder-parser.ts:40:  /** Human-readable validation problems surfaced to the builder UI; empty on a clean package. */
api/src/agents/integration-builder-parser.ts:121: * Validate a parsed package against the canonical shape + the builder rules. Reusable by the save
api/src/integrations/service.ts:96: *  owner-scoped config is writable only by its owner. A same-org builder can USE a shared
api/src/integrations/definitions.ts:104: *  builder (agents/) types + validates its generated package against the ONE canonical shape. */
api/src/integrations/definitions.ts:190: *  The reserved-key set the builder guards against (a user integration may not shadow a shipped
api/src/integrations/definitions.ts:209:/** Root of the RUNTIME tier: user-created integration packages the builder saves
api/src/integrations/definitions.ts:351:/** Regex for a well-formed integration key, enforced at write time (mirrors the builder parser). */
api/src/integrations/definitions.ts:356: * reserved `pipedream` connect row. The integration builder rejects a generated/edited package
api/src/integrations/definitions.ts:369: * owns this filesystem write (the builder route calls it). The key shape is re-validated here as a
api/src/integrations/definitions.ts:370: * belt-and-braces guard even though the builder already checked it. Returns the reload summary.
api/src/integrations/platform-call.ts:140:// Gmail RFC 2822 + base64url raw builder (send_email_simple)
api/src/services/branding/design-system.ts:30:import { isBuilderPromoAsset, normalizeFontKey, type SiteBuilder } from './site-builder.js';
api/src/services/branding/design-system.ts:299:// Site-builder chrome scrubbing
api/src/services/branding/design-system.ts:321: * Scrub a detected site-builder's chrome out of dembrandt's output. dembrandt runs
api/src/services/branding/design-system.ts:322: * in a separate subprocess WITH the builder's promo chrome, so its palette, CSS
api/src/services/branding/design-system.ts:323: * variables, button colors, typography, and picked logo can be the builder's - not
api/src/services/branding/design-system.ts:330:  opts: { chromeColors?: string[]; chromeFonts?: string[]; builder?: SiteBuilder | null },
api/src/services/branding/design-system.ts:334:  const builder = opts.builder ?? null;
api/src/services/branding/design-system.ts:336:  const chromeTokens = (builder?.chromeSelectors ?? [])
api/src/services/branding/design-system.ts:341:  // Cookie-consent vendor chrome is NOT the owner's brand either, and unlike builder
api/src/services/branding/design-system.ts:342:  // chrome it shows up on any site regardless of detected builder (observed live
api/src/services/branding/design-system.ts:357:    if (builder == null) return false;
api/src/services/branding/design-system.ts:375:  const logo = ds.logo && builder && ds.logo.url && isBuilderPromoAsset(ds.logo.url, builder, siteHost) ? null : ds.logo;
api/src/services/branding/index.ts:20:export { detectSiteBuilder, type SiteBuilder } from './site-builder.js';
api/src/services/branding/visual-vibe.ts:17:import { stripBuilderChrome, type SiteBuilder } from './site-builder.js';
api/src/services/branding/visual-vibe.ts:42:  /** When set, the builder's injected chrome is stripped before screenshots. */
api/src/services/branding/visual-vibe.ts:43:  builder?: SiteBuilder | null;
api/src/services/branding/visual-vibe.ts:69:  const { timeoutMs = 45_000, builder = null } = options;
api/src/services/branding/visual-vibe.ts:74:    shots = await captureStripScreenshots(url, deadline, builder);
api/src/services/branding/visual-vibe.ts:125:  builder: SiteBuilder | null = null,
api/src/services/branding/visual-vibe.ts:137:    // Remove the builder's promo chrome so the vision model judges the owner's
api/src/services/branding/visual-vibe.ts:138:    // site, not the builder's "create your website" banner - and any consent-vendor
api/src/services/branding/visual-vibe.ts:141:    if (builder) await stripBuilderChrome(page, builder);
api/src/integrations/platform-oauth.ts:5: *   1. Provider protocol — authorize-URL builders, authorization-code exchange, token refresh,
api/src/auth/users-service.ts:80: * H1 role rename `builder` → `user`: an idempotent boot-step migration (the repo has no migration
api/src/auth/users-service.ts:82: * row still carrying the retired `builder` role is rewritten to `user` and its token epoch bumped,
api/src/auth/users-service.ts:86: * once no row carries `builder`, the query matches nothing and nothing is bumped. Returns the count
api/src/auth/users-service.ts:87: * migrated (0 on a clean/already-migrated store). The `role: 'builder'` filter reads a legacy value
api/src/auth/users-service.ts:91:  const legacy = await users.find({ role: 'builder' });
api/src/services/branding/site-builder.ts:2: * Site-builder chrome detection + suppression for brand research (ch05 §5.6.4).
api/src/services/branding/site-builder.ts:4: * Free-tier website builders (Webnode, Wix, Squarespace, Weebly, WordPress.com,
api/src/services/branding/site-builder.ts:6: * "Create your website" stripe in the builder's brand color, a "Powered by X"
api/src/services/branding/site-builder.ts:7: * footer credit, a default favicon that is the builder's own logo. None of that
api/src/services/branding/site-builder.ts:10: * happily capture it, and on a minimalist owner site the builder's saturated
api/src/services/branding/site-builder.ts:15: *   1. Detects the builder from the final URL host + `<meta generator>`.
api/src/services/branding/site-builder.ts:16: *   2. Strips the builder's injected chrome from a live Playwright page BEFORE
api/src/services/branding/site-builder.ts:21: *   3. Flags assets served from the builder's own marketing/CDN hosts so a
api/src/services/branding/site-builder.ts:24: * The strip is color-agnostic and self-updating: it removes the DOM the builder
api/src/services/branding/site-builder.ts:25: * injected and reads whatever colors/fonts that DOM used, so a builder changing
api/src/services/branding/site-builder.ts:34:  /** Final-URL host patterns that mean the site is hosted ON this builder. */
api/src/services/branding/site-builder.ts:39:   * Host patterns for the builder's own MARKETING site (where its "create your
api/src/services/branding/site-builder.ts:42:   * favicon/logo served from the builder itself.
api/src/services/branding/site-builder.ts:46:   * builder sites live UNDER the builder's domain (e.g. the owner site is
api/src/services/branding/site-builder.ts:49:   * and same-host uploads from being mistaken for the builder's promo chrome.
api/src/services/branding/site-builder.ts:54:   * Precise CSS selectors for the builder's injected chrome. Optional - the
api/src/services/branding/site-builder.ts:56:   * builders without needing exact selectors, but naming the known containers
api/src/services/branding/site-builder.ts:63: * The builders we recognize. Ordered most-specific-host first. Adding a new
api/src/services/branding/site-builder.ts:64: * builder is a data change: give it host/generator/promo patterns and, if you
api/src/services/branding/site-builder.ts:120:    generatorPatterns: [/godaddy (website builder|websites)/i],
api/src/services/branding/site-builder.ts:151: * Detect the builder a site is hosted on, from its final URL host and the
api/src/services/branding/site-builder.ts:153: * agency-built) site - the strip is only applied when a builder is detected, so
api/src/services/branding/site-builder.ts:173: * True when an asset URL is the builder's own default asset (served from its
api/src/services/branding/site-builder.ts:178: * builders: the owner site lives under the builder's domain (e.g.
api/src/services/branding/site-builder.ts:180: * `promoHostPatterns`. We only treat an asset as the builder's default when its
api/src/services/branding/site-builder.ts:181: * host DIFFERS from the owner's host - the builder's marketing host is always a
api/src/services/branding/site-builder.ts:184:export function isBuilderPromoAsset(assetUrl: string, builder: SiteBuilder, siteHost?: string): boolean {
api/src/services/branding/site-builder.ts:192:  return builder.promoHostPatterns.some((re) => re.test(host));
api/src/services/branding/site-builder.ts:304: * Strip a detected builder's injected chrome from a live page and return the
api/src/services/branding/site-builder.ts:309:export async function stripBuilderChrome(page: Page, builder: SiteBuilder): Promise<StripResult> {
api/src/services/branding/site-builder.ts:312:      selectors: builder.chromeSelectors,
api/src/services/branding/site-builder.ts:313:      promoHostSources: builder.promoHostPatterns.map((re) => re.source),
api/src/services/branding/site-builder.ts:318:        `[site-builder] Stripped ${result.removed} ${builder.name} chrome node(s); ` +
api/src/services/branding/site-builder.ts:324:    console.warn(`[site-builder] chrome strip failed (${builder.name}): ${err instanceof Error ? err.message : err}`);
api/src/services/branding/site-context.ts:65:  /** `<meta name="generator">` - used to detect website builders (Webnode, Wix, ...). */
api/src/services/branding/rendered-candidates.ts:16:import { stripBuilderChrome, type SiteBuilder } from './site-builder.js';
api/src/services/branding/rendered-candidates.ts:77:  /** Non-neutral colors used by stripped builder chrome (for cross-source scrubbing). */
api/src/services/branding/rendered-candidates.ts:79:  /** Font families used by stripped builder chrome. */
api/src/services/branding/rendered-candidates.ts:97:  /** When set, the builder's injected chrome is stripped before sampling. */
api/src/services/branding/rendered-candidates.ts:98:  builder?: SiteBuilder | null;
api/src/services/branding/rendered-candidates.ts:102: * In-page walker as a PLAIN-JS STRING (see site-builder.ts for why a string, not
api/src/services/branding/rendered-candidates.ts:283:  const { timeoutMs = DEFAULT_TIMEOUT_MS, builder = null } = options;
api/src/services/branding/rendered-candidates.ts:310:    if (builder) chrome = await stripBuilderChrome(page, builder);
api/src/services/branding/rendered-candidates.ts:348:    // out of `paintedHexes` on purpose: the builder-scrub intersection must stay a
api/src/auth/capabilities.ts:11: *   user        → canUseChat + canCreateArtifacts ONLY (chat + non-app artifacts; a plain user
api/src/auth/capabilities.ts:12: *                 cannot build or change apps — canBuildApps/canEditApps are admin-only).
api/src/auth/capabilities.ts:25:  'super-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
api/src/auth/capabilities.ts:26:  'org-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
api/src/auth/capabilities.ts:27:  user: ['canCreateArtifacts', 'canUseChat'],
api/src/routes/automations.ts:5: * lives in the service; creation authority reads the org's flippable builder-authoring
api/src/routes/automations.ts:97:    const settings = (org?.settings ?? {}) as { allowBuilderAutomations?: boolean };
api/src/routes/automations.ts:159:    // Creation is org-admin-only by default; the flippable org setting enables builder authoring.
api/src/routes/automations.ts:161:    const settings = (org?.settings ?? {}) as { allowBuilderAutomations?: boolean };
api/src/services/branding/consent-chrome.ts:2: * Cookie-consent vendor chrome (ch05 §5.6.4). Unlike website-builder chrome it appears on ANY
api/src/services/branding/consent-chrome.ts:3: * site regardless of detected builder, and it POLLUTES every rendered signal: painted colours,
api/src/services/branding/consent-chrome.ts:28: * site-builder.ts stripBuilderChrome).
api/src/auth/jwt.ts:60:  // Legacy-window shim (H1 role rename `builder` → `user`). A JWT minted before the rename carries
api/src/auth/jwt.ts:61:  // role 'builder', which is no longer a valid Role. Normalise it HERE — the single verify
api/src/auth/jwt.ts:67:  if ((decoded.role as string) === 'builder') decoded.role = 'user';
api/src/services/branding/snapshot.ts:13:import { normalizeFontKey, type SiteBuilder } from './site-builder.js';
api/src/services/branding/snapshot.ts:73: * On a detected builder host, the linked theme CSS carries the builder's ENTIRE
api/src/services/branding/snapshot.ts:85:  builder: SiteBuilder | null,
api/src/services/branding/snapshot.ts:87:  // Site-builder chrome scrubbing (painted-colour intersection) is a builder-specific
api/src/services/branding/snapshot.ts:88:  // heuristic and only runs when a builder is detected. The DESIGN-SYSTEM filter, however,
api/src/services/branding/snapshot.ts:90:  // which appears on custom sites with no builder (observed live 2026-07-11: plmj.com's
api/src/services/branding/snapshot.ts:92:  // no-ops safely when there is no chrome and no builder.
api/src/services/branding/snapshot.ts:94:  if (builder && rendered.ok) {
api/src/services/branding/snapshot.ts:109:        builder,
api/src/services/branding/snapshot.ts:121:  builder: SiteBuilder | null;
api/src/services/branding/snapshot.ts:129:  const { site, rendered, designSystem, visualVibe, builder } = input;
api/src/services/branding/snapshot.ts:145:  // On a builder site the raw-CSS scan surfaces the builder's whole theme font
api/src/services/branding/snapshot.ts:150:    builder && rendered.topFonts.length > 0
api/src/content/manifest.ts:20:export const AGENT_KINDS = ['coding', 'chat', 'automation', 'integration-builder'] as const;
api/src/services/branding/brand-assets.ts:20:import { isBuilderPromoAsset, type SiteBuilder } from './site-builder.js';
api/src/services/branding/brand-assets.ts:248: * On a detected builder host, assets served from the builder's own marketing host
api/src/services/branding/brand-assets.ts:254:  builder?: SiteBuilder | null,
api/src/services/branding/brand-assets.ts:274:    if (builder && isBuilderPromoAsset(url, builder, siteHost)) return;
api/src/services/branding/brand-assets.ts:396:  builder?: SiteBuilder | null;
api/src/services/branding/brand-assets.ts:407:  const candidates = await extractLogoCandidates(input.websiteUrl, input.extraUrls ?? [], input.builder);
api/src/content/loader.ts:346:      // builder) writes a directory. Archive ingestion needs an extractor dependency and is
api/src/routes/artifacts.ts:82:    // H1 capability gate: creating an artifact requires canCreateArtifacts (held by user +
api/src/routes/artifacts.ts:85:    if (!can(actorOf(req), 'canCreateArtifacts')) {
api/src/routes/artifacts.ts:86:      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: 'canCreateArtifacts' });
api/src/apps/dev-serve.ts:15:import { appBuilder } from './builder.js';
api/src/routes/knowledge.ts:4: * in-process tools (the grounding builder), not REST. Persistence via the knowledge service.
api/src/apps/artifact-featured-update.ts:29:import { appBuilder } from './builder.js';
web/components/verification/verification-banner.tsx:9: * Informational only; not dismissible. Rendered inside the dark builder output
api/src/apps/app-assistant-route.ts:54: *  rides the knowledge/ builder; the tier is floored at WORKHORSE like chat (D1 owner-org grounding
api/src/apps/builder.ts:423:        console.log(`[app-builder] ${appId}: backend bundled -> dist-backend/backend.mjs (handlers: ${backend.handlers.join(', ')})`);
api/src/apps/builder.ts:434:      console.error(`[app-builder] ${appId}: backend build failed: ${message}`);
api/src/apps/builder.ts:511:      console.log(`[app-builder] ${appId}: built in ${durationMs.toFixed(0)}ms (${outputFiles.length} files)`);
api/src/apps/builder.ts:525:      console.error(`[app-builder] ${appId}: build failed: ${message}`);
api/src/apps/builder.ts:580:      console.log(`[app-builder] ${appId}: plain HTML copied in ${durationMs.toFixed(0)}ms (${outputFiles.length} files)`);
api/src/apps/builder.ts:591:      console.error(`[app-builder] ${appId}: plain HTML copy failed: ${message}`);
api/src/apps/builder.ts:610:      console.log(`[app-builder] ${appId}: plain HTML app - skipping esbuild watch`);
api/src/apps/builder.ts:631:      console.warn(`[app-builder] ${appId}: skipping watch - entry point not found: ${entryPoint}`);
api/src/apps/builder.ts:682:      console.error(`[app-builder] ${appId}: esbuild context creation failed:`, err instanceof Error ? err.message : err);
api/src/apps/builder.ts:692:      console.error(`[app-builder] ${appId}: esbuild watch failed:`, err instanceof Error ? err.message : err);
api/src/apps/builder.ts:700:      console.log(`[app-builder] ${appId}: watching for changes`);
api/src/apps/builder.ts:703:      console.warn(`[app-builder] ${appId}: initial build failed: ${msg}`);
api/src/apps/builder.ts:714:        console.error(`[app-builder] ${appId}: esbuild dispose failed:`, err instanceof Error ? err.message : err);
api/src/apps/builder.ts:717:      console.log(`[app-builder] ${appId}: stopped watching`);
api/src/apps/builder.ts:727:    console.log('[app-builder] disposed');
web/components/integrations/integration-dialog.tsx:480:      const builderSessionId = loadResult.sessionId;
web/components/integrations/integration-dialog.tsx:481:      if (!loadResult.success || !builderSessionId) {
web/components/integrations/integration-dialog.tsx:494:        builderSessionId,
api/src/apps/app-assistant.ts:8: * grounding builder, and the routing decision are all INJECTED (`AppAssistantDeps`), so it unit-
api/src/apps/app-assistant.ts:60:  /** The org-partitioned knowledge grounding builder (`buildGroundingBlock` in prod). Pure. */
api/src/routes/integration-builder.ts:2: * Integration-builder router (ch03 §3.8.14). The four-endpoint contract:
api/src/routes/integration-builder.ts:3: *   POST /api/v1/integration-builder/chat     — one builder chat turn (agents/integration-builder)
api/src/routes/integration-builder.ts:4: *   GET  /api/v1/integration-builder/package  — load the user's session for an integration key
api/src/routes/integration-builder.ts:5: *   PUT  /api/v1/integration-builder/package  — save the generated package to the runtime tier
api/src/routes/integration-builder.ts:6: *   POST /api/v1/integration-builder/test     — execute one action against the supplied credentials
api/src/routes/integration-builder.ts:30:} from '../agents/integration-builder.js';
api/src/routes/integration-builder.ts:31:import { validateConfig } from '../agents/integration-builder-parser.js';
api/src/routes/integration-builder.ts:67: * `union([{ builderSessionId }, { generatedPackage, testCredentials? }])`: the web sends BOTH a
api/src/routes/integration-builder.ts:73:  builderSessionId: z.string().optional(),
api/src/routes/integration-builder.ts:81: * builder's ephemeral test path: credentials come from the request, are NEVER logged or persisted,
api/src/routes/integration-builder.ts:154:      ...(body.builderSessionId ? { sessionId: body.builderSessionId } : {}),
api/src/routes/integration-builder.ts:182:      builderSessionId: session._id,
api/src/routes/integration-builder.ts:195:    const session = body.builderSessionId ? await getOwnedSession(actor.userId, body.builderSessionId) : null;
api/src/routes/integration-builder.ts:233:    const session = await getOwnedSession(actor.userId, body.builderSessionId);
api/src/server.ts:39:import { integrationBuilderRouter } from './routes/integration-builder.js';
api/src/server.ts:55:import { appBuilder } from './apps/builder.js';
api/src/server.ts:58:import { buildAndRegisterFeaturedArtifacts } from './apps/featured-builder.js';
api/src/server.ts:580:  // ch03 §3.8.14 — the AI integration builder (chat/load/save/test).
api/src/server.ts:581:  app.use('/api/v1/integration-builder', integrationBuilderRouter(deps));
api/src/server.ts:680:  // H1 idempotent migration: rewrite any retired `builder` role → `user` and bump its token epoch
api/src/server.ts:683:  if (migratedRoles > 0) console.log(`[role-migration] builder -> user: ${migratedRoles} user(s) migrated`);
api/src/server.ts:710:    .then((r) => console.log(`[featured-builder] built ${r.built}, skipped ${r.skipped}, failed ${r.failed}, registered ${r.registered}`))
api/src/server.ts:711:    .catch((err) => console.warn('[featured-builder] prebuild failed:', err instanceof Error ? err.message : err));
api/src/routes/chat.ts:38:    // H1 capability gate: chat requires canUseChat. Every role holds it today, so this never
api/src/routes/chat.ts:40:    // canUseChat is denied here, with the machine-readable FORBIDDEN + details.capability shape).
api/src/routes/chat.ts:41:    if (!can(actor, 'canUseChat')) {
api/src/routes/chat.ts:42:      return sendError(res, 'FORBIDDEN', 'Não tem permissão para usar o assistente; pode pedir ao administrador da organização.', { capability: 'canUseChat' });
api/src/apps/artifact-bundle.ts:17: * per-repo lock) and all rebuilds through the builder entry (§7.2) - no side doors.
api/src/apps/artifact-bundle.ts:34:import { appBuilder } from './builder.js';
api/src/routes/jobs.ts:45:      // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
api/src/routes/jobs.ts:49:      // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
api/src/routes/jobs.ts:51:      if (!can(actor, 'canEditApps')) {
api/src/routes/jobs.ts:52:        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
api/src/routes/jobs.ts:57:    } else if (!can(actor, 'canBuildApps')) {
api/src/routes/jobs.ts:59:      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
web/components/chat/mobile-side-panel-drawer.tsx:5:import SidePanel from "@/components/builder/side-panel";
api/src/data/stores.ts:80:/** Integration-builder chat sessions (ch03 §3.8.14). PERSISTED — the old cortex builder kept an
api/src/data/stores.ts:83:export const integrationBuilderSessions = new Store<Doc>('integration_builder_sessions');
api/src/apps/featured-seeder.ts:13: * auto-refresh behaviour (the prebuilder re-copies the scaffold); the seeder just
web/stores/integration-builder.ts:6: * Manages the AI-powered integration builder UI state:
web/stores/integration-builder.ts:106:      // FC-035: the integration-builder chat is request-response (POST
web/stores/integration-builder.ts:107:      // /integration-builder/chat, 300s via the descriptor); there is NO streamed
web/stores/integration-builder.ts:111:        api.integrationBuilder.chat({ message, builderSessionId: sessionId || undefined }),
web/stores/integration-builder.ts:115:        const { builderSessionId, generatedPackage, validationErrors } = res.data;
web/stores/integration-builder.ts:122:            sessionId: builderSessionId,
web/stores/integration-builder.ts:138:        const errorMsg = res.error.message || 'Failed to get response from builder';
web/stores/integration-builder.ts:173:          sessionId: res.data.builderSessionId,
web/stores/integration-builder.ts:200:          builderSessionId: sessionId || '',
web/stores/integration-builder.ts:221:          builderSessionId: sessionId,
api/src/apps/index.ts:6:export * from './builder.js';
web/stores/orchestration.ts:53:  /** Session kind persisted server-side (default 'builder'). 'onboarding'
web/stores/orchestration.ts:129: *   'build'      — builder side panel: Files / Output / Preview / Versions
web/stores/orchestration.ts:130: *   'integrate'  — integration builder panel (mutex with 'build')
web/stores/orchestration.ts:135: * Active integration-builder session pinned to a chat session. Set when the
web/stores/orchestration.ts:144:  /** Integration-builder session id (separate from chat sessionId) */
web/stores/orchestration.ts:145:  builderSessionId?: string;
web/stores/orchestration.ts:234:  // Pending delegation from chat page (triggers builder execution)
web/stores/orchestration.ts:1248:            // Artifact-linked sessions get the builder side panel on activation.
web/stores/i18n.ts:52: *   <h1>{pages.builder.whatToBuild}</h1>
api/src/apps/featured-builder.ts:2: * Featured-artifact prebuilder (ch07 §7.13, carried; runs post-listen,
api/src/apps/featured-builder.ts:26:import { appBuilder } from './builder.js';
api/src/apps/featured-builder.ts:161:          console.warn(`[featured-builder] ${manifest.id}: working-copy build failed - ${result.errors.join('; ')}`);
api/src/apps/featured-builder.ts:169:      `[featured-builder] ${manifest.id}: working-copy check failed, falling back to scaffold - ${err instanceof Error ? err.message : String(err)}`,
api/src/apps/featured-builder.ts:194:      console.warn(`[featured-builder] ${manifest.id}: build failed - ${result.errors.join('; ')}`);
api/src/apps/featured-builder.ts:196:      console.log(`[featured-builder] ${manifest.id}: built in ${result.durationMs.toFixed(0)}ms`);
api/src/apps/featured-builder.ts:215:        `[featured-builder] ${manifest.id}: projectDir patch failed - ${err instanceof Error ? err.message : String(err)}`,
api/src/apps/featured-builder.ts:245:      console.warn(`[featured-builder] ${id}: missing/invalid scaffold manifest, skipping`);
api/src/apps/featured-builder.ts:254:      console.warn(`[featured-builder] ${id}: skipping - unresolvable bare import(s): ${missing.join(', ')}`);
api/src/apps/featured-builder.ts:280:              `[featured-builder] ${manifest.id}: screenshot capture failed - ${err instanceof Error ? err.message : String(err)}`,
api/src/apps/featured-builder.ts:288:        `[featured-builder] ${manifest.id}: build/register failed - ${err instanceof Error ? err.message : String(err)}`,
web/stores/integrations.ts:246:          sessionId: res.data.builderSessionId,
api/src/apps/artifact-fork.ts:27:import { appBuilder } from './builder.js';
api/src/apps/build-mechanics.ts:22:import { appBuilder, validateBundle } from './builder.js';
api/src/apps/build-mechanics.ts:274:     *  featured-builder capture: never fails the run, EKOA_SCREENSHOTS_DISABLED=1 skips
api/src/apps/build-mechanics.ts:376:     *      builder never serves those; builder.ts entry resolution).
api/src/llm/router.ts:31: *  `isCodeGen` (dead integration-builder flag, conflict 9) and `previousFailures` (never
api/src/llm/attribution.ts:22:  | 'integration-builder'
api/src/apps/versions.ts:23:import { appBuilder } from './builder.js';
api/src/automation/service.ts:10: * Creation is org-admin-only by default with a flippable org setting for builder authoring
api/src/automation/service.ts:203: *  The persisted org-setting key `allowBuilderAutomations` keeps its wire name (data compatibility);
api/src/automation/service.ts:204: *  only the role value it grants was renamed `builder` → `user` (H1). */
api/src/automation/service.ts:205:export function canCreateAutomation(actor: Actor, orgSettings?: { allowBuilderAutomations?: boolean }): boolean {
api/src/automation/service.ts:207:  return actor.role === 'user' && orgSettings?.allowBuilderAutomations === true;
api/src/automation/service.ts:213:  orgSettings?: { allowBuilderAutomations?: boolean },
api/src/automation/service.ts:271:  orgSettings?: { allowBuilderAutomations?: boolean },
api/src/automation/service.ts:275:  // is subject to the same gate as POST /automations — a builder in an org without builder-authoring
web/types/integration.ts:4: * These are the rich shapes the integrations UI reads (cards, dialog, builder,
web/types/integration.ts:12: * `shared/src/integration-builder.ts`, and the api integrations mappers.
web/app/(dashboard)/chat/[[...sessionId]]/page.tsx:28:import SessionsPanel from "@/components/builder/sessions-panel";
web/app/(dashboard)/chat/[[...sessionId]]/page.tsx:29:import ChatPanel from "@/components/builder/chat-panel";
web/app/(dashboard)/chat/[[...sessionId]]/page.tsx:30:import SidePanel from "@/components/builder/side-panel";
web/app/(dashboard)/chat/[[...sessionId]]/page.tsx:536:  // DELEGATION HANDLER (from old builder page)
web/app/(dashboard)/chat/[[...sessionId]]/page.tsx:650:  // BUILD MODE HANDLERS (from old builder page)
web/app/(dashboard)/chat/[[...sessionId]]/page.tsx:823:  // the integration builder for this chat session.
web/app/(dashboard)/chat/[[...sessionId]]/page.tsx:851:  // Integration ready — the integration-builder backend emits this on save.
web/app/(dashboard)/chat/[[...sessionId]]/page.tsx:864:      // Flip the side panel back to the builder tabs (Files/Output/Preview)
api/src/automation/persistence.ts:85: * builder never drift.
web/locales/pt.ts:95:    builder: {
web/locales/types.ts:108:    builder: {
api/src/automation/seams.ts:240:// modules; the catalog builder reads them through these seams. All default
web/locales/en.ts:95:    builder: {

exec
/bin/zsh -lc "rg -n \"handleBuildCreate|executeBuildJob|createChatRun|executeChatRun|createArtifact\\(|updateArtifactFromBundle\\(|restoreAndRebuild\\(|writeArtifactFile\\(|getArtifactBackendRuntime\\(|runAutomation\\(|createAutomation\\(\" api/src api/tests shared/src web -g '"'!node_modules'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/automation/service.ts:210:export async function createAutomation(
api/src/automation/service.ts:391:    : runAutomation(automationId, ctx, { runId, ...(emit ? { emit } : {}), ...(opts.inputs ? { inputs: opts.inputs } : {}) });
api/src/automation/service.ts:602:    const result = await runAutomation(input.automationId, ctx, { runId, ...(emit ? { emit } : {}), ...(input.inputs ? { inputs: input.inputs } : {}) });
api/src/automation/service.ts:689:  const result = await runAutomation(input.binding.automationId, ctx, { runId, inputs, ...(emit ? { emit } : {}) });
api/src/automation/engine.ts:242:export async function runAutomation(
api/src/automation/engine.ts:1187:        const sub = await runAutomation(step.subAutomationId, {
api/tests/agents/chat-thinking.test.ts:4:import { createChatRun, executeChatRun } from '../../src/agents/chat.js';
api/tests/agents/chat-thinking.test.ts:30:  const { runId } = createChatRun(input);
api/tests/agents/chat-thinking.test.ts:31:  await executeChatRun(runId, input);
api/src/agents/build.ts:90:export async function handleBuildCreate(input: BuildCreateInput): Promise<BuildCreateResult> {
api/src/agents/build.ts:147:    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: true }),
api/src/agents/build.ts:217:    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: false, artifactId }),
api/src/agents/build.ts:237: *  this re-cap protects direct programmatic callers of handleBuildCreate. */
api/src/agents/build.ts:258:export async function executeBuildJob(jobId: string, input: BuildCreateInput, abort: AbortController, opts: ExecOpts): Promise<void> {
api/src/apps/backend-runtime/index.ts:34:  return getArtifactBackendRuntime().invoke(artifactId, entrypoint, input, opts);
api/src/agents/index.ts:9:export { createChatRun, executeChatRun, type StartChatRunInput } from './chat.js';
api/src/agents/index.ts:10:export { handleBuildCreate, executeBuildJob, type BuildCreateInput, type BuildCreateResult } from './build.js';
api/src/apps/backend-runtime/runtime.ts:113:export function getArtifactBackendRuntime(): ArtifactBackendRuntime {
api/src/routes/jobs.ts:13:import { handleBuildCreate, cancelRun } from '../agents/index.js';
api/src/routes/jobs.ts:61:    const result = await handleBuildCreate({
api/src/apps/artifact-bundle.ts:193:export async function updateArtifactFromBundle(
api/src/routes/chat.ts:12:import { createChatRun, executeChatRun, getRun, cancelRun } from '../agents/index.js';
api/src/routes/chat.ts:54:    const { runId } = createChatRun(input);
api/src/routes/chat.ts:56:    void executeChatRun(runId, input);
api/src/agents/chat.ts:46: * return the run id. The caller responds `202` immediately, then invokes `executeChatRun` fire-
api/src/agents/chat.ts:49:export function createChatRun(input: StartChatRunInput): { runId: string; entry: LiveRunEntry } {
api/src/agents/chat.ts:69:export async function executeChatRun(runId: string, input: StartChatRunInput): Promise<void> {
api/src/routes/automations.ts:162:    res.status(201).json(await createAutomation(actor, body, settings));
api/tests/agents/chat-lifecycle.test.ts:4:import { createChatRun, executeChatRun } from '../../src/agents/chat.js';
api/tests/agents/chat-lifecycle.test.ts:33:  const { runId } = createChatRun(input);
api/tests/agents/chat-lifecycle.test.ts:34:  await executeChatRun(runId, input);
api/tests/agents/chat-lifecycle.test.ts:166:    const { runId } = createChatRun(input);
api/tests/agents/chat-lifecycle.test.ts:167:    await executeChatRun(runId, input);
api/tests/agents/chat-lifecycle.test.ts:182:    const { runId, entry } = createChatRun(input);
api/tests/agents/chat-lifecycle.test.ts:185:    await executeChatRun(runId, input);
api/tests/agents/chat-lifecycle.test.ts:199:    const { runId, entry } = createChatRun(input);
api/tests/agents/chat-lifecycle.test.ts:202:    await executeChatRun(runId, input);
api/src/routes/artifacts.ts:88:    res.status(201).json(artifactView(await createArtifact(actorOf(req), body, deps)));
api/src/routes/artifacts.ts:126:    await getArtifactBackendRuntime().revoke(id);
api/src/routes/artifacts.ts:165:      const result = await updateArtifactFromBundle(
api/src/routes/artifacts.ts:204:    const result = await restoreAndRebuild(
api/src/routes/artifacts.ts:239:      const result = await writeArtifactFile(projectDirFor(art), body.path, body.content, req.user!.username, auditOf(req), { appId: art._id, appName: art.name });
api/src/routes/artifacts.ts:335:    const status = getArtifactBackendRuntime().getStatus(art._id);
api/src/routes/artifacts.ts:344:    res.json({ items: getArtifactBackendRuntime().getRecentLogs(art._id, limit).map(logView) });
api/src/routes/artifacts.ts:352:    res.json({ items: getArtifactBackendRuntime().getInvocations(art._id, limit).map(invocationView) });
api/src/routes/artifacts.ts:360:    getArtifactBackendRuntime().setEnabled(art._id, body.enabled);
api/src/routes/artifacts.ts:372:    const result = await getArtifactBackendRuntime().invoke(art._id, entrypoint, body.input, { dryRun: true, invokedBy: 'sample' });
api/src/apps/artifacts-service.ts:82:export async function createArtifact(actor: Actor, input: { name: string; visibility?: 'private' | 'org' }, deps: Deps): Promise<ArtifactDoc> {
api/src/apps/artifact-files.ts:62:export async function writeArtifactFile(
api/tests/agents/build.test.ts:3:import { handleBuildCreate, executeBuildJob, type BuildCreateInput } from '../../src/agents/build.js';
api/tests/agents/build.test.ts:50:  await executeBuildJob(jobId, input, abort, { firstBuild: true });
api/tests/agents/build.test.ts:64:    const res = await handleBuildCreate({ actor, username: 'u1', sessionId: 's1', description: 'change it', language: 'pt', artifactId: 'artBusy', deps: deps() });
api/tests/agents/build.test.ts:71:    const first = await handleBuildCreate({ actor, username: 'u1', sessionId: 'sessDup', description: 'build a crm', language: 'pt', deps: d });
api/tests/agents/build.test.ts:74:    const second = await handleBuildCreate({ actor, username: 'u1', sessionId: 'sessDup', description: 'build a crm', language: 'pt', deps: d });
api/tests/agents/build.test.ts:82:    const res = await handleBuildCreate({ actor, username: 'u1', sessionId: 's9', description: 'tweak', language: 'pt', artifactId: 'artA', deps: deps() });
api/tests/agents/build.test.ts:106:    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'x', language: 'pt', deps: deps() }, abort, { firstBuild: true });
api/tests/agents/build.test.ts:140:    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'change', language: 'pt', artifactId: 'artF', deps: deps() }, abort, { firstBuild: false, artifactId: 'artF' });
api/tests/agents/build.test.ts:152:    await executeBuildJob(jobId2, { actor, username: 'u1', sessionId: 's1', description: 'change', language: 'pt', artifactId: 'artF2', deps: deps() }, abort2, { firstBuild: false, artifactId: 'artF2' });
api/tests/agents/build.test.ts:330:    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'adiciona o cálculo de taxas e custas', language: 'pt', artifactId: 'artK', knowledgeDocs: [{ title: 'x', text: 'y' }], deps: deps() }, abort, { firstBuild: false, artifactId: 'artK' });
api/src/apps/versions.ts:142:export async function restoreAndRebuild(
api/tests/e2e/fees-knowledge.e2e.mjs:7: * executeBuildJob that narrates `plan_step{status:'knowledge-scope'}` for a domain-heavy app, ingests
api/tests/contract/registo.test.ts:42:// Builds fire async (POST /jobs returns 202 while executeBuildJob runs on the fake transport).
api/tests/contract/jobs.test.ts:124:    // No job is created when the capability gate refuses (the gate runs before handleBuildCreate).
api/tests/contract/jobs-capability.test.ts:3: * REAL jobs router over mongo-mem. The build EXECUTOR is mocked (`handleBuildCreate`) so no real
api/tests/contract/jobs-capability.test.ts:29:const { handleBuildCreateMock } = vi.hoisted(() => ({ handleBuildCreateMock: vi.fn() }));
api/tests/contract/jobs-capability.test.ts:32:  return { ...actual, handleBuildCreate: handleBuildCreateMock };
api/tests/contract/jobs-capability.test.ts:67:  handleBuildCreateMock.mockReset();
api/tests/contract/jobs-capability.test.ts:68:  handleBuildCreateMock.mockResolvedValue({ status: 'created', job: { id: 'jX', status: 'running', createdAt: 'x' }, fire: () => {} });
api/tests/contract/jobs-capability.test.ts:79:    expect(handleBuildCreateMock).not.toHaveBeenCalled();
api/tests/contract/jobs-capability.test.ts:85:    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
api/tests/contract/jobs-capability.test.ts:86:    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBeUndefined();
api/tests/contract/jobs-capability.test.ts:97:    expect(handleBuildCreateMock).not.toHaveBeenCalled();
api/tests/contract/jobs-capability.test.ts:106:    expect(handleBuildCreateMock).not.toHaveBeenCalled();
api/tests/contract/jobs-capability.test.ts:113:    expect(handleBuildCreateMock).not.toHaveBeenCalled();
api/tests/contract/jobs-capability.test.ts:119:    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
api/tests/contract/jobs-capability.test.ts:120:    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBe('artA-shared');
api/tests/contract/jobs-capability.test.ts:126:    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
api/tests/contract/jobs-capability.test.ts:127:    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBe('artAdminA-priv');
api/tests/automation/engine.test.ts:277:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:304:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:336:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:354:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:366:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:386:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:405:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:423:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:443:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:471:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:488:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:503:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:515:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:535:    const result = await runAutomation('auto-1', ctx(), {
api/tests/automation/engine.test.ts:563:    const result = await runAutomation('auto-1', ctx(), {
api/tests/automation/engine.test.ts:584:    const result = await runAutomation('auto-1', ctx(), {
api/tests/automation/engine.test.ts:610:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:620:    const result = await runAutomation('auto-1', ctx());
api/tests/automation/engine.test.ts:645:    await runAutomation('auto-1', ctx(), { emit });
api/tests/automation/engine.test.ts:653:    await expect(runAutomation('nope', ctx())).rejects.toThrow(/not found/);
api/tests/automation/engine.test.ts:659:    await expect(runAutomation('auto-1', ctx({ ownerUserId: 'user-1', triggeredBy: 'user' })))
api/tests/automation/service.test.ts:87:    await expect(svc.createAutomation(builder, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
api/tests/automation/service.test.ts:88:    const created = await svc.createAutomation(admin, { name: 'Relatório', description: 'diário' });
api/tests/automation/service.test.ts:95:    const a = await svc.createAutomation(admin, { name: 'Org thing' });
api/tests/automation/service.test.ts:149:    const a = await svc.createAutomation(admin, { name: 'Empty' }); // zero steps -> completes fast
api/tests/automation/service.test.ts:159:    const a = await svc.createAutomation(admin, { name: 'Empty2' });
api/tests/automation/service.test.ts:171:    const a = await svc.createAutomation(admin, { name: 'Admin owned' });
api/tests/automation/engine-daemon.test.ts:57:    const result = await runAutomation('auto-1', ctx);
api/tests/automation/engine-daemon.test.ts:77:    const result = await runAutomation('auto-1', ctx);

exec
/bin/zsh -lc 'git show --unified=80 e2c165e -- api/src/routes/jobs.ts api/src/auth/jwt.ts api/src/auth/users-service.ts api/src/server.ts api/src/auth/capabilities.ts api/src/routes/chat.ts api/src/routes/artifacts.ts shared/src/common.ts shared/src/contract.test.ts api/tests/auth/role-migration.test.ts api/tests/contract/jobs-capability.test.ts api/tests/contract/jobs.test.ts api/src/automation/service.ts api/src/automation/engine.ts api/src/integrations/prefetch.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-EThJdkLP' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-56qNvkrM' (errno=Operation not permitted)
commit e2c165ee7b0726beacea977c8ba0774d6c22f725
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 18:11:23 2026 +0100

    feat(operator-run/h1): SECURITY - real capability layer replaces the permissive stub; builder->user role migration (idempotent boot step + legacy-JWT shim at the verify chokepoint); four gates wired (canBuildApps on first builds, canEditApps+loadWritable on follow-ups CLOSING the cross-tenant follow-up-build IDOR, canUseChat, canCreateArtifacts); machine-readable PT-PT refusals (FORBIDDEN + details.capability); stub test replaced by the real matrix; security.md + diagrams 12/04 updated

diff --git a/api/src/auth/capabilities.ts b/api/src/auth/capabilities.ts
index e276a4c..62e0607 100644
--- a/api/src/auth/capabilities.ts
+++ b/api/src/auth/capabilities.ts
@@ -1,19 +1,40 @@
 /**
- * PERMISSIVE-STUB (operator-run S0, brief model-tier sequencing rule): the single
- * permission seam that pre-security-block code calls when it needs a permission
- * decision. Always returns true BY DESIGN until the security block (operator-run
- * H1) replaces the body with the real role→capability mapping.
+ * The platform capability layer (operator-run H1 security block). The single permission seam:
+ * every capability decision in the api goes through `can()`. A PURE role→capability map — it
+ * carries NO org/resource context by design (resource + tenancy checks stay separate:
+ * `loadWritable`/`loadReadable` in apps/app-paths.ts, the org scoping in the users/registo
+ * services). Wiring `can()` into a route does not replace an ownership check; the two compose.
  *
- * NOT authorization: no caller may treat a `true` from this function as a security
- * boundary while this stub stands. The H5 security assertions grep this file for
- * the PERMISSIVE-STUB marker and fail if it survives the security block.
+ * Matrix (brief §9a):
+ *   super-admin → all four capabilities.
+ *   org-admin   → all four capabilities.
+ *   user        → canUseChat + canCreateArtifacts ONLY (chat + non-app artifacts; a plain user
+ *                 cannot build or change apps — canBuildApps/canEditApps are admin-only).
+ *   null/undefined actor → NOTHING (fail closed: an absent actor has no capabilities, so a caller
+ *                 that forgets to resolve the actor is denied rather than silently allowed).
+ *
+ * This REPLACES the pre-security-block permissive stub (whose grep-marker the H5 security
+ * assertions fail on): every decision here is a real capability grant, never a blanket allow.
  */
-import type { Capability } from '@ekoa/shared';
+import type { Capability, Role } from '@ekoa/shared';
 import type { JwtClaims } from './jwt.js';
 
+/** The role→capability grid. `Record<Role, …>` so a new Role value is a compile error until it is
+ *  given an explicit capability set here (fail-closed by construction — no role defaults to more). */
+const CAPABILITIES: Record<Role, ReadonlyArray<Capability>> = {
+  'super-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
+  'org-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
+  user: ['canCreateArtifacts', 'canUseChat'],
+};
+
+/** Does `actor` hold `capability`? Pure role lookup. A null/undefined actor holds nothing, and an
+ *  unrecognised role (e.g. a stale value a signature-valid token might still carry) also holds
+ *  nothing — both fail closed. Resource/tenancy authorization is a SEPARATE, composed check. */
 export function can(
-  _actor: Pick<JwtClaims, 'role'> | null | undefined,
-  _capability: Capability,
+  actor: Pick<JwtClaims, 'role'> | null | undefined,
+  capability: Capability,
 ): boolean {
-  return true; // PERMISSIVE-STUB — real mapping lands in H1
+  if (!actor) return false;
+  const granted = CAPABILITIES[actor.role] as ReadonlyArray<Capability> | undefined;
+  return granted?.includes(capability) ?? false;
 }
diff --git a/api/src/auth/jwt.ts b/api/src/auth/jwt.ts
index 6972412..62340b1 100644
--- a/api/src/auth/jwt.ts
+++ b/api/src/auth/jwt.ts
@@ -1,61 +1,69 @@
 /**
  * JWT sign/verify (ch03 §3.2, CONV-1). Single mint point. Claim set is
  * `{ sub, role, scope, orgId, username }` (Amendment 2 — orgId replaces companyId).
  */
 import { randomUUID } from 'node:crypto';
 import jwt from 'jsonwebtoken';
 import { loadConfig } from '../config.js';
 import type { Role } from '@ekoa/shared';
 
 export interface JwtClaims {
   sub: string;
   role: Role;
   scope: string;
   orgId: string;
   username: string;
   /** ALWAYS present on a minted token — the revocation key (P-03). A token lacking a jti
    *  cannot be revoked and is treated as invalid by the middleware. */
   jti: string;
   exp?: number;
   iat?: number;
 }
 
 /** Mint a token. A `jti` is ALWAYS set (generated if the caller omits it) so every token
  *  is revocable (P-03) — a token without a jti is a revocation bypass and is forbidden.
  *
  *  `iat` may be pinned by the caller (jsonwebtoken honours an explicit `iat` and derives `exp`
  *  from it). A fresh session minted right after a token-epoch bump MUST carry `iat >= epoch`,
  *  or the middleware's `iat < tokenEpoch` check rejects it: JWT `iat` has one-second
  *  granularity, so a re-login in the same second as a password change would otherwise 401
  *  (ch09 §9.6). Only the mint-after-credential-check sites pin it. */
 export function signToken(
   claims: Omit<JwtClaims, 'exp' | 'jti'> & { jti?: string; iat?: number },
   rememberMe = false,
 ): { token: string; expiresIn: number; jti: string } {
   const expiresIn = rememberMe ? 30 * 24 * 3600 : 24 * 3600; // 30d / 24h (ch03 §3.2)
   const jti = claims.jti ?? randomUUID();
   const token = jwt.sign({ ...claims, jti }, loadConfig().jwtSecret, { expiresIn });
   return { token, expiresIn, jti };
 }
 
 /** Verify a token. jsonwebtoken rejects alg:none and tampered signatures by default;
  *  we additionally require HS256 explicitly so an attacker cannot downgrade the alg.
  *
  *  Token-class separation (ch18 §18.3.6, ch09 §9.2): the platform verifier positively REJECTS
  *  bridge tokens. Platform JWTs and bridge tokens are two classes over ONE secret, never
  *  interchangeable — a bridge token carries `aud: ekoa-bridge` and a `pairingId`/`connectionId`
  *  claim, none of which a minted platform token ever has, so any token bearing them is a bridge
  *  token presented on the wrong plane and is refused. This is an anti-replay/anti-misconfiguration
  *  defence: a stolen bridge token cannot call the platform API. (The bridge verifier rejects
  *  platform tokens symmetrically — bridge/token.ts readBridgeToken.) */
 export function verifyToken(token: string): JwtClaims {
   const decoded = jwt.verify(token, loadConfig().jwtSecret, { algorithms: ['HS256'] }) as JwtClaims & {
     aud?: unknown;
     pairingId?: unknown;
     connectionId?: unknown;
   };
   if (decoded.aud === 'ekoa-bridge' || decoded.pairingId !== undefined || decoded.connectionId !== undefined) {
     throw new Error('bridge token presented on the platform verifier (token-class separation, ch18 §18.3.6)');
   }
+  // Legacy-window shim (H1 role rename `builder` → `user`). A JWT minted before the rename carries
+  // role 'builder', which is no longer a valid Role. Normalise it HERE — the single verify
+  // chokepoint every admission path (requireAuth, verifySseToken, and every ?token= consumer)
+  // funnels through — so no downstream role/capability check ever sees the dead value. The boot
+  // migration bumps each migrated user's token epoch, so such tokens are rejected at the admission
+  // plane once the epoch lands and the user re-logs in; this shim only covers the window between
+  // boot and that next login. Remove once the fleet has rotated its tokens.
+  if ((decoded.role as string) === 'builder') decoded.role = 'user';
   return decoded as JwtClaims;
 }
diff --git a/api/src/auth/users-service.ts b/api/src/auth/users-service.ts
index ddc845e..ef9201d 100644
--- a/api/src/auth/users-service.ts
+++ b/api/src/auth/users-service.ts
@@ -1,75 +1,98 @@
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
-  input: { username: string; password: string; role: UserDoc['role']; orgId?: string },
+  input: { username: string; password: string; role?: UserDoc['role']; orgId?: string },
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
-    role: input.role,
+    // H1: `user` is the base non-admin role and the default when a caller omits one (the HTTP
+    // contract still requires `role` via CreateUserRequest; this default protects direct callers).
+    role: input.role ?? 'user',
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
     await users.update(target._id, (u) => ({ ...u, role: patch.role as UserDoc['role'] }));
     // A role change invalidates the user's outstanding tokens: bump the token epoch (real
     // JWT-iat clock, strictly after any token minted this second) so a demoted admin cannot
     // keep using a stale privileged JWT (ch09 §9.6). The user re-logs in with the new role.
     bumpTokenEpoch(target._id, Math.floor(Date.now() / 1000) + 1);
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
+
+/**
+ * H1 role rename `builder` → `user`: an idempotent boot-step migration (the repo has no migration
+ * framework — schema/data evolution rides idempotent steps in `bootState`, ch09 §9.7). Every user
+ * row still carrying the retired `builder` role is rewritten to `user` and its token epoch bumped,
+ * reusing the exact role-change revocation path (`patchUser`): a bumped epoch invalidates every
+ * outstanding legacy JWT (its `iat < epoch`), forcing a re-login that mints a `user` token. Runs
+ * AFTER `loadActivation` so the epoch bump lands in the freshly-loaded in-memory map. Idempotent:
+ * once no row carries `builder`, the query matches nothing and nothing is bumped. Returns the count
+ * migrated (0 on a clean/already-migrated store). The `role: 'builder'` filter reads a legacy value
+ * no longer in the Role type, so it is a string filter (the store's `find` takes `Record<string,
+ * unknown>`); the update writes the current `user` value. */
+export async function migrateBuilderRole(): Promise<number> {
+  const legacy = await users.find({ role: 'builder' });
+  const epochSec = Math.floor(Date.now() / 1000) + 1;
+  for (const u of legacy) {
+    await users.update(u._id, (doc) => ({ ...doc, role: 'user' }));
+    bumpTokenEpoch(u._id, epochSec);
+  }
+  return legacy.length;
+}
diff --git a/api/src/automation/engine.ts b/api/src/automation/engine.ts
index 3580d01..85057b8 100644
--- a/api/src/automation/engine.ts
+++ b/api/src/automation/engine.ts
@@ -145,161 +145,161 @@ export interface RunEventEmitter {
    */
   runOutputChunk?: (runId: string, info: RunOutputChunkPayload) => void;
 }
 
 export interface RunAwaitingConsentPayload {
   stepIndex: number;
   shape: string;
   argv: string[];
   description: string;
 }
 
 export interface RunAwaitingDaemonPayload {
   stepIndex: number;
   /** Which capability the halted step needed: 'browser' or 'bash'. */
   capability: 'browser' | 'bash';
   /** Human-readable explanation surfaced in the UI. */
   reason: string;
 }
 
 export interface RunOutputChunkPayload {
   stepIndex: number;
   chunk: string;
   stream: 'stdout' | 'stderr';
 }
 
 export interface RunStreamingAvailablePayload {
   wsUrl: string;
   token: string;
   viewport: { width: number; height: number };
 }
 
 export interface RunPauseForUserPayload {
   stepIndex: number;
   reasoning: string;
   userInstructions: string;
   failureMessage: string;
   screenshotUrl?: string;
 }
 
 export interface RunPatchEventPayload {
   stepIndex: number;
   phase: 'proposing' | 'applied' | 'aborted';
   failureKind?: FailureKind;
   failureMessage?: string;
   patchKind?: RehearsalPatch['kind'];
   reasoning?: string;
   newStepDescription?: string;
   attemptNumber?: number;
 }
 
 export interface RunAutomationOptions {
   inputs?: Record<string, unknown>;
   emit?: RunEventEmitter;
   /** Pre-minted run id. The service layer mints the id, registers cancel/resume signals against
    *  it, and passes it in so a `POST .../runs` can register-and-respond-early (202) before the run
    *  starts (§5.2 step 1-2). Absent → the engine mints one. */
   runId?: string;
 }
 
 export interface RunAutomationResult {
   runId: string;
   status: RunRecord['status'];
   durationMs: number;
   summary: string;
   lastStepIndex: number;
   error?: string;
 }
 
 export interface RehearseAutomationOptions extends RunAutomationOptions {
   /** The user's original goal — fed to the fixer for context. */
   goal?: string;
 }
 
 export interface RehearseAutomationResult extends RunAutomationResult {
   refinedSteps: Step[];
   rehearsal: RehearsalSummary;
 }
 
 /** Build the tenant-scoped actor for the memory-backed cache from a run context. */
 function actorFromCtx(ctx: RunContext): Actor {
-  return { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'builder' };
+  return { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'user' };
 }
 
 // ============================================================================
 // Public API
 // ============================================================================
 
 /** Drop the `credentials` key from a run's inputs before persistence/wire (credential boundary,
  *  §5.6.7). The in-memory `inputs` keeps it for the browser session; the stored copy never has it.
  *  Exported so EVERY persist site scrubs — the service's register-first insert AND this engine
  *  create both write the run row, so both must strip credentials (Codex round-2). */
 export function scrubCredentials(inputs: Record<string, unknown>): Record<string, unknown> {
   if (!('credentials' in inputs)) return inputs;
   const { credentials: _dropped, ...rest } = inputs;
   return rest;
 }
 
 export async function runAutomation(
   automationId: string,
   ctx: RunContext,
   options: RunAutomationOptions = {},
 ): Promise<RunAutomationResult> {
   return runOrRehearse(automationId, ctx, { ...options, kind: 'normal' });
 }
 
 /**
  * Same as runAutomation but the per-step loop is allowed to mutate
  * the automation's spec via the rehearsal fixer. After the loop
  * completes, the refined steps are persisted back to the store.
  *
  * Budget-capped: at most REHEARSAL_BUDGET.maxFixerCalls fixer LLM
  * calls and REHEARSAL_BUDGET.maxWallClockMs wall-clock time. Per-index
  * patch attempts are capped at REHEARSAL_BUDGET.maxPatchesPerIndex.
  */
 export async function rehearseAutomation(
   automationId: string,
   ctx: RunContext,
   options: RehearseAutomationOptions = {},
 ): Promise<RehearseAutomationResult> {
   const result = await runOrRehearse(automationId, ctx, { ...options, kind: 'rehearsal' });
   // runOrRehearse always returns RehearseAutomationResult fields when kind='rehearsal'.
   // Cast is safe here.
   return result as RehearseAutomationResult;
 }
 
 interface InternalRunOptions extends RehearseAutomationOptions {
   kind: 'normal' | 'rehearsal';
 }
 
 async function runOrRehearse(
   automationId: string,
   ctx: RunContext,
   options: InternalRunOptions,
 ): Promise<RunAutomationResult> {
   const automation = await automationStore.findById(automationId);
   if (!automation) {
     throw new Error(`automation not found: ${automationId}`);
   }
   if (automation.ownerUserId !== ctx.ownerUserId && ctx.triggeredBy === 'user') {
     throw new Error(`forbidden: not the owner of automation ${automationId}`);
   }
 
   // Cycle detection for sub-automation calls
   if (ctx.visitedAutomationIds.has(automationId)) {
     throw new Error(`sub-automation cycle detected: ${automationId} is already in the call chain`);
   }
   ctx.visitedAutomationIds.add(automationId);
 
   const runId = options.runId ?? randomUUID();
   const startedAt = new Date().toISOString();
   const inputs = options.inputs ?? {};
   const isRehearsal = options.kind === 'rehearsal';
 
   // CREDENTIAL BOUNDARY (ch05 §5.6.7; v2 invariant I2): `inputs.credentials` carries decrypted
   // secrets (an integration action's passCredentials fields, a captured Playwright storageState).
   // It is consumed IN-MEMORY only (the browser session below; template-vars redacts it from any
   // substitution). It must NEVER reach the persisted run record — `GET /automations/runs/:id`
   // returns `inputs` to the owner AND org admins, so a persisted credential is a cross-actor leak.
   const persistedInputs = scrubCredentials(inputs);
 
   const initialRecord: RunRecord = {
diff --git a/api/src/automation/service.ts b/api/src/automation/service.ts
index 8429f69..1160a46 100644
--- a/api/src/automation/service.ts
+++ b/api/src/automation/service.ts
@@ -122,164 +122,166 @@ function toWireStep(s: StepRecord): Record<string, unknown> {
 
 // ============================================================================
 // Authorization helpers
 // ============================================================================
 
 const isAdmin = (actor: Actor): boolean => actor.role === 'super-admin' || actor.role === 'org-admin';
 
 /** Read scope: an automation is visible across its org. */
 function canReadAutomation(doc: StoredAutomation, actor: Actor): boolean {
   return actor.role === 'super-admin' || doc.orgId === actor.orgId;
 }
 /** Write scope: the creator, or an org-admin in the same org, or a super-admin. */
 function canWriteAutomation(doc: StoredAutomation, actor: Actor): boolean {
   if (actor.role === 'super-admin') return true;
   if (doc.orgId !== actor.orgId) return false;
   return doc.ownerUserId === actor.userId || actor.role === 'org-admin';
 }
 /** Run visibility: the owner, an org-admin in the run's org, or a super-admin. */
 function canSeeRun(run: StoredRun, actor: Actor): boolean {
   if (actor.role === 'super-admin') return true;
   if (run.orgId !== actor.orgId) return false;
   return run.ownerUserId === actor.userId || actor.role === 'org-admin';
 }
 
 /** Cancel/resume/consent/step-feedback are OWNER-scoped (§5.6.7): only the run's own user (or a
  *  super-admin for platform ops) may mutate a run or touch the owner's consent/cache/memory. An
  *  org-admin has READ visibility (canSeeRun) but must NOT be able to inject a standing command
  *  approval into another member's account or drive their local execution. */
 function isRunOwner(run: StoredRun, actor: Actor): boolean {
   if (actor.role === 'super-admin') return true;
   return run.orgId === actor.orgId && run.ownerUserId === actor.userId;
 }
 
 async function loadAutomationForRead(actor: Actor, id: string): Promise<StoredAutomation> {
   const doc = (await automations.get(id)) as StoredAutomation | null;
   if (!doc || !canReadAutomation(doc, actor)) throw new AutomationServiceError('NOT_FOUND', 'automation not found');
   return doc;
 }
 
 // ============================================================================
 // In-memory run signal registry (§5.3.1 owner-scoped idempotent cancel/resume)
 // ============================================================================
 
 interface RunSignals { ownerUserId: string; orgId: string; cancelled: boolean; resumeFlag: boolean }
 const signals = new Map<string, RunSignals>();
 
 function makeCtx(runId: string, sig: RunSignals, extra: Partial<RunContext> = {}): RunContext {
   return {
     ownerUserId: sig.ownerUserId,
     orgId: sig.orgId,
     triggeredBy: 'user',
     visitedAutomationIds: new Set(),
     traceId: runId,
     cancellation: { isCancelled: () => sig.cancelled },
     resumeSignal: { shouldResume: () => sig.resumeFlag, clear: () => { sig.resumeFlag = false; } },
     ...extra,
   };
 }
 
 /** Test-only: clear the run signal registry. */
 export function __resetAutomationServiceForTests(): void {
   signals.clear();
 }
 
 // ============================================================================
 // Automations CRUD
 // ============================================================================
 
 export async function listAutomations(actor: Actor): Promise<WireAutomation[]> {
   const rows = (await automations.find(
     actor.role === 'super-admin' ? {} : { orgId: actor.orgId },
     { updatedAt: -1 },
   )) as unknown as StoredAutomation[];
   return rows.map(toWireAutomation);
 }
 
 export async function getAutomation(actor: Actor, id: string): Promise<WireAutomation> {
   return toWireAutomation(await loadAutomationForRead(actor, id));
 }
 
-/** Creation authority: org-admin/super-admin, or a builder when the org enables builder authoring. */
+/** Creation authority: org-admin/super-admin, or a plain user when the org enables member authoring.
+ *  The persisted org-setting key `allowBuilderAutomations` keeps its wire name (data compatibility);
+ *  only the role value it grants was renamed `builder` → `user` (H1). */
 export function canCreateAutomation(actor: Actor, orgSettings?: { allowBuilderAutomations?: boolean }): boolean {
   if (isAdmin(actor)) return true;
-  return actor.role === 'builder' && orgSettings?.allowBuilderAutomations === true;
+  return actor.role === 'user' && orgSettings?.allowBuilderAutomations === true;
 }
 
 export async function createAutomation(
   actor: Actor,
   input: { name: string; description?: string; plan?: { steps?: Array<{ stepId?: string; description?: string; tool?: string; argv?: string[] }> }; visibility?: 'private' | 'org' },
   orgSettings?: { allowBuilderAutomations?: boolean },
 ): Promise<WireAutomation> {
   if (!canCreateAutomation(actor, orgSettings)) {
     throw new AutomationServiceError('FORBIDDEN', 'not authorized to create automations');
   }
   const id = randomUUID();
   const now = new Date().toISOString();
   const doc: StoredAutomation = {
     id,
     name: input.name,
     description: input.description ?? '',
     steps: (input.plan?.steps ?? []).map(mapWireStepToEngine),
     ownerUserId: actor.userId,
     orgId: actor.orgId,
     ...(input.visibility ? { visibility: input.visibility } : {}),
     createdAt: now,
     updatedAt: now,
   };
   await automations.insert({ _id: id, ...doc } as never);
   return toWireAutomation(doc);
 }
 
 export async function patchAutomation(
   actor: Actor,
   id: string,
   patch: { name?: string; description?: string; plan?: { steps?: Array<{ stepId?: string; description?: string; tool?: string; argv?: string[] }> }; visibility?: 'private' | 'org' },
 ): Promise<WireAutomation> {
   const doc = (await automations.get(id)) as StoredAutomation | null;
   if (!doc || !canReadAutomation(doc, actor)) throw new AutomationServiceError('NOT_FOUND', 'automation not found');
   if (!canWriteAutomation(doc, actor)) throw new AutomationServiceError('FORBIDDEN', 'not authorized to modify this automation');
   const now = new Date().toISOString();
   const updated = (await automations.update(id, (cur) => ({
     ...cur,
     ...(patch.name !== undefined ? { name: patch.name } : {}),
     ...(patch.description !== undefined ? { description: patch.description } : {}),
     ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
     ...(patch.plan?.steps ? { steps: patch.plan.steps.map(mapWireStepToEngine) } : {}),
     updatedAt: now,
   }))) as unknown as StoredAutomation | null;
   if (!updated) throw new AutomationServiceError('NOT_FOUND', 'automation not found');
   return toWireAutomation(updated);
 }
 
 export async function deleteAutomation(actor: Actor, id: string): Promise<{ ok: true }> {
   const doc = (await automations.get(id)) as StoredAutomation | null;
   if (!doc || !canReadAutomation(doc, actor)) throw new AutomationServiceError('NOT_FOUND', 'automation not found');
   if (!canWriteAutomation(doc, actor)) throw new AutomationServiceError('FORBIDDEN', 'not authorized to delete this automation');
   await automations.delete(id);
   return { ok: true };
 }
 
 // ============================================================================
 // Plan-from-goal (Landmine 9: persists the automation AND starts a rehearsal run)
 // ============================================================================
 
 export async function planFromGoal(
   actor: Actor,
   input: { goal: string; name?: string; automationId?: string; language?: string },
   orgSettings?: { allowBuilderAutomations?: boolean },
 ): Promise<WirePlanResponse> {
   void input.language; // language is carried on the wire (ch03 §3.4); the planner output is language-agnostic
   // Creation authority (Amendment 2): plan-from-goal PERSISTS a new automation (landmine 9), so it
   // is subject to the same gate as POST /automations — a builder in an org without builder-authoring
   // cannot create one via /plan. Updating an existing automation is guarded by canWriteAutomation below.
   if (!input.automationId && !canCreateAutomation(actor, orgSettings)) {
     throw new AutomationServiceError('FORBIDDEN', 'not authorized to create automations');
   }
   const catalog = await buildAutomationCatalog(actor.userId, actor.role === 'super-admin');
   const result = await plannerPlanFromGoal({ goal: input.goal, userId: actor.userId, catalog, ...(input.name ? { automationName: input.name } : {}) });
 
   if (result.status === 'unavailable') {
     // Egress outage (dead credential, provider down, empty transport): the honest wire status is
     // "service unavailable, retry soon" — NEVER plan_failed's "rephrase your goal", which blames
     // the user for an infrastructure failure. Nothing persisted, no run started.
     console.warn(`[automation] plan-from-goal unavailable (egress outage): ${result.detail}`);
diff --git a/api/src/integrations/prefetch.ts b/api/src/integrations/prefetch.ts
index 28b02a0..95b0ec9 100644
--- a/api/src/integrations/prefetch.ts
+++ b/api/src/integrations/prefetch.ts
@@ -1,158 +1,158 @@
 /**
  * Live integration pre-fetch (ch05 §5.5.2 layer 3; carryover: reference/llm-usage-map.md §5,
  * must-preserve). On a CHAT turn, keyword hits on email / calendar / files pre-fetch live
  * Google Workspace / Microsoft 365 data into the system prompt, with a 60s cache that also
  * serves keyword-less follow-ups ("sim") from the still-warm cache.
  *
  * Ported from cortex/src/adapters/external.ts, re-pointed at the G8 platform API caller and
  * hardened for multi-tenancy: the old cache was keyed GLOBALLY (`provider:action`), which would
  * serve one org's inbox to another. Here the connection is org custody (Amendment 2) and the
  * cache is keyed per ORG (`orgId:provider:action`). The seam only passes `userId`, so the org is
  * resolved from the user record.
  *
  * This is the implementation behind the `IntegrationPrefetchFn` seam (agents/seams.ts); the
  * composition root wires it via `setIntegrationPrefetch`. Any failure returns '' — the pre-fetch
  * is advisory context and must never break a chat turn.
  */
 
 import { randomUUID } from 'node:crypto';
 import { users } from '../data/stores.js';
 import { callPlatformIntegration } from './platform-call.js';
 import { listPlatform, type PlatformProvider, type OAuthDeps } from './platform-oauth.js';
 
 const CACHE_TTL_MS = 60_000;
 
 /** Pre-fetched data cache — keyed `orgId:provider:action`, 60s TTL. */
 const cache = new Map<string, { data: string; expiresAt: number }>();
 
 /** Test hook: clear the pre-fetch cache between cases. */
 export function __resetPrefetchCacheForTests(): void {
   cache.clear();
 }
 
 interface Keywords {
   email: boolean;
   calendar: boolean;
   files: boolean;
 }
 
 /** PT-PT + EN keyword table (ported verbatim from cortex external.ts). */
 function detectKeywords(message: string): Keywords {
   const lower = message.toLowerCase();
   return {
     email: /\b(email|emails|inbox|correio|caixa|e-mail|mail|mensagem|mensagens)\b/.test(lower),
     calendar: /\b(calendar|calend[aá]rio|meeting|reuni[aã]o|evento|event|agenda|schedule)\b/.test(lower),
     files: /\b(drive|file|files|ficheiro|documento|document|folder|pasta)\b/.test(lower),
   };
 }
 
 export interface PrefetchDeps {
   /** OAuth/platform-call deps (clock + provider transport). Default: real clock + guarded fetch. */
   oauth?: OAuthDeps;
 }
 
 function defaultOAuthDeps(): OAuthDeps {
   return { now: () => Date.now(), genId: () => randomUUID() };
 }
 
 function cacheKey(orgId: string, provider: PlatformProvider, action: string): string {
   return `${orgId}:${provider}:${action}`;
 }
 function cachedFresh(orgId: string, provider: PlatformProvider, action: string, now: number): boolean {
   const e = cache.get(cacheKey(orgId, provider, action));
   return !!e && now < e.expiresAt;
 }
 
 /**
  * The seam implementation. Resolves the caller's org, checks which connected platforms exist,
  * and — for any keyword that fired OR whose cache is still warm — pre-fetches (or replays) the
  * live data block. Returns '' when nothing pre-fetches or on any failure.
  */
 export async function integrationPrefetch(input: { userId: string; message: string }, deps: PrefetchDeps = {}): Promise<string> {
   try {
     const oauthDeps = deps.oauth ?? defaultOAuthDeps();
     const user = (await users.get(input.userId)) as { orgId?: string } | null;
     if (!user?.orgId) return '';
     const orgId = user.orgId;
 
-    const connected = (await listPlatform({ userId: input.userId, orgId, role: 'builder' }))
+    const connected = (await listPlatform({ userId: input.userId, orgId, role: 'user' }))
       .filter((p) => p.connected)
       .map((p) => p.provider);
     if (connected.length === 0) return '';
 
     const now = oauthDeps.now();
     const kw = detectKeywords(input.message);
     // A keyword-less follow-up ("sim") still injects data while any relevant cache is warm.
     const eff: Keywords = {
       email: kw.email || connected.some((p) => cachedFresh(orgId, p, 'email', now)),
       calendar: kw.calendar || connected.some((p) => cachedFresh(orgId, p, 'calendar', now)),
       files: kw.files || connected.some((p) => cachedFresh(orgId, p, 'files', now)),
     };
     if (!eff.email && !eff.calendar && !eff.files) return '';
 
     const sections: string[] = [];
     for (const provider of connected) {
       const block = await prefetchProvider(orgId, provider, eff, oauthDeps);
       if (block) sections.push(block);
     }
     if (sections.length === 0) return '';
     return `## Live Integration Data\n\nThe following data was pre-fetched from your connected integrations:\n\n${sections.join('\n\n')}`;
   } catch {
     return ''; // advisory — never break a chat turn
   }
 }
 
 async function prefetchProvider(orgId: string, provider: PlatformProvider, kw: Keywords, oauthDeps: OAuthDeps): Promise<string> {
   const integrationKey = provider === 'google' ? 'google-workspace' : 'microsoft-365';
   const providerName = provider === 'google' ? 'Google Workspace' : 'Microsoft 365';
   const sections: string[] = [`### ${providerName} Data`];
   const now = oauthDeps.now();
 
   /** Fetch-or-replay one action, appending a labelled JSON block. Errors are non-fatal. */
   const fetchCached = async (action: string, actionName: string, args: Record<string, unknown>, label: string): Promise<void> => {
     const key = cacheKey(orgId, provider, action);
     const hit = cache.get(key);
     if (hit && now < hit.expiresAt) {
       sections.push(hit.data);
       return;
     }
     try {
       const result = await callPlatformIntegration({ orgId, integrationKey, actionName, args }, oauthDeps);
       const text = `**${label}**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
       cache.set(key, { data: text, expiresAt: now + CACHE_TTL_MS });
       sections.push(text);
     } catch {
       /* pre-fetch errors are non-fatal */
     }
   };
 
   if (kw.email) {
     const oneDayAgo = new Date(now - 86_400_000).toISOString();
     await fetchCached(
       'email',
       'list_emails',
       provider === 'google'
         ? { q: 'newer_than:1d', maxResults: 50 }
         : { $top: 50, $orderby: 'receivedDateTime desc', $filter: `receivedDateTime ge ${oneDayAgo}` },
       'Emails received in the last 24 hours (count = messages array length)',
     );
 
     if (provider === 'microsoft') {
       await fetchCached(
         'email:recent',
         'list_emails',
         { $top: 5, $orderby: 'receivedDateTime desc', $select: 'id,subject,from,receivedDateTime,isRead' },
         'Most recent 5 emails with metadata',
       );
     }
 
     if (provider === 'google') {
       // list_emails returns ids only; read_email(format:metadata) gives subject/from/date.
       const metaKey = cacheKey(orgId, provider, 'email:recent');
       const metaHit = cache.get(metaKey);
       if (metaHit && now < metaHit.expiresAt) {
         sections.push(metaHit.data);
       } else {
         try {
           const list = (await callPlatformIntegration({ orgId, integrationKey, actionName: 'list_emails', args: { maxResults: 5 } }, oauthDeps)) as {
             success: boolean;
diff --git a/api/src/routes/artifacts.ts b/api/src/routes/artifacts.ts
index bb9ec56..b9d29e6 100644
--- a/api/src/routes/artifacts.ts
+++ b/api/src/routes/artifacts.ts
@@ -1,160 +1,167 @@
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
+import { can } from '../auth/capabilities.js';
 import { loadConfig } from '../config.js';
 import {
   listArtifacts, createArtifact, getVisibleArtifact, patchArtifact, deleteArtifact,
   artifactView, stripReservedDataKeys, type ArtifactDoc,
 } from '../apps/artifacts-service.js';
 import { actorOf, notFound, sendError, parseBody } from './helpers.js';
 import type { SnapshotAudit } from '../services/commit-guard.js';
 import { SecretCommitError } from '../services/commit-guard.js';
 import type { AppDataDeps } from '../apps/app-data-access.js';
 import { loadReadable, loadWritable, projectDirFor, getArtifactById, setFeaturedFlag } from '../apps/app-paths.js';
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
 
   // ---- base CRUD (ch03 §3.8.9) ----
   r.get('/', async (req: AuthedRequest, res: Response) => {
     const { items, featured } = await listArtifacts(actorOf(req));
     res.json({ items: items.map(artifactView), featured: featured.map(artifactView) });
   });
 
   r.post('/', async (req: AuthedRequest, res: Response) => {
     const body = parseBody(res, CreateArtifact, req.body) as { name: string; visibility?: 'private' | 'org' } | undefined;
     if (!body) return;
+    // H1 capability gate: creating an artifact requires canCreateArtifacts (held by user +
+    // org-admin + super-admin — this is the base "artifacts area" capability, distinct from the
+    // app build/edit capabilities). Refusal is the FORBIDDEN envelope + details.capability.
+    if (!can(actorOf(req), 'canCreateArtifacts')) {
+      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar artefactos; pode pedir ao administrador da organização.', { capability: 'canCreateArtifacts' });
+    }
     res.status(201).json(artifactView(await createArtifact(actorOf(req), body, deps)));
   });
 
   // ---- import must precede GET/:id-style matches (distinct verb+path) ----
   r.post('/import', async (req: AuthedRequest, res: Response) => {
     const body = parseBody(res, ImportArtifactRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle } | undefined;
     if (!body) return;
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
     const body = parseBody(res, BundleUpdateRequest, req.body) as { bundle: import('@ekoa/shared').ArtifactBundle; force?: boolean } | undefined;
     if (!body) return;
     try {
       const result = await updateArtifactFromBundle(
         art, body.bundle,
         { force: body.force, authorName: req.user!.username, audit: auditOf(req), appDeps },
diff --git a/api/src/routes/chat.ts b/api/src/routes/chat.ts
index dc9c9df..9a387c2 100644
--- a/api/src/routes/chat.ts
+++ b/api/src/routes/chat.ts
@@ -1,65 +1,72 @@
 /**
  * Chat runs router (ch03 §3.8.7, §3.6.1). Thin: validate, call `agents/`, shape the response.
  * Creation registers the run synchronously and returns 202 with the server-minted id (§5.2 steps
  * 1-2); results arrive on the SSE stream. The events endpoint authenticates via ?token= (CONV-1)
  * and attaches to `events/`. Routes never touch `data/` (ch02 §2.7) — persistence is `agents/`.
  */
 import { Router, type Request, type Response } from 'express';
 import { ChatRunCreateRequest } from '@ekoa/shared';
 import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
+import { can } from '../auth/capabilities.js';
 import { sseManager } from '../events/sse-manager.js';
 import { createChatRun, executeChatRun, getRun, cancelRun } from '../agents/index.js';
 import { chatRunView } from '../agents/registry.js';
-import { actorOf, notFound, parseBody } from './helpers.js';
+import { actorOf, notFound, parseBody, sendError } from './helpers.js';
 
 export function chatRouter(deps: { now: () => number; genId: () => string }): Router {
   const r = Router();
 
   // SSE stream (?token= auth) — mounted before requireAuth (EventSource cannot set headers).
   r.get('/runs/:id/events', (req: Request, res: Response) => {
     const auth = verifySseToken(req.query.token as string | undefined);
     if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
     const id = req.params.id as string;
     const entry = getRun(id);
     if (entry && entry.ownerUserId !== auth.claims.sub) {
       return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Sem permissão.' } });
     }
     const lastEventId = req.header('last-event-id');
     sseManager.attach(res, auth.claims.sub, 'chat', id, lastEventId ? Number(lastEventId) : undefined);
   });
 
   r.use(requireAuth);
 
   r.post('/runs', (req: AuthedRequest, res: Response) => {
     const body = parseBody(res, ChatRunCreateRequest, req.body);
     if (!body) return;
     const actor = actorOf(req);
+    // H1 capability gate: chat requires canUseChat. Every role holds it today, so this never
+    // refuses now — wired so the matrix is enforced, not merely implied (a future role without
+    // canUseChat is denied here, with the machine-readable FORBIDDEN + details.capability shape).
+    if (!can(actor, 'canUseChat')) {
+      return sendError(res, 'FORBIDDEN', 'Não tem permissão para usar o assistente; pode pedir ao administrador da organização.', { capability: 'canUseChat' });
+    }
     const input = {
       actor,
       username: req.user!.username,
       sessionId: body.sessionId,
       message: body.message,
       language: body.language,
       ...(body.attachments ? { attachments: body.attachments } : {}),
       ...(body.references ? { references: body.references } : {}),
       deps,
     };
     const { runId } = createChatRun(input);
     res.status(202).json({ runId });
     void executeChatRun(runId, input);
   });
 
   r.get('/runs/:id', (req: AuthedRequest, res: Response) => {
     const entry = getRun(req.params.id as string);
     const actor = actorOf(req);
     // Ephemeral: a pre-crash / unknown run is a clean 404 (§5.2.1, acceptance criterion 2).
     if (!entry || (entry.ownerUserId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
     res.json(chatRunView(entry));
   });
 
   r.post('/runs/:id/cancel', (req: AuthedRequest, res: Response) => {
     res.json(cancelRun(req.params.id as string, actorOf(req)));
   });
 
   return r;
 }
diff --git a/api/src/routes/jobs.ts b/api/src/routes/jobs.ts
index a3a4947..be6f425 100644
--- a/api/src/routes/jobs.ts
+++ b/api/src/routes/jobs.ts
@@ -1,72 +1,94 @@
 /**
  * Build/brand-research jobs router (ch03 §3.8.8, §3.6.2). `POST /jobs` creates BUILD jobs; the
  * response is `created` (with the job) or `answered` (in-build classifier resolved it, no job) or
  * 409 DUPLICATE_BUILD (a concurrent follow-up on the same artifact). `GET /jobs/:id` serves the
  * persisted record (P-10); events stream over `events/` via ?token=. Routes never touch `data/`.
  */
 import { Router, type Request, type Response } from 'express';
 import { JobCreateRequest } from '@ekoa/shared';
 import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
+import { can } from '../auth/capabilities.js';
+import { loadWritable } from '../apps/app-paths.js';
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
+    // Capability + ownership gates BEFORE any job is created or agent spawned (H1). Refusals carry
+    // the FORBIDDEN envelope with `details.capability` (the machine-readable hook the H4
+    // request-to-admin flow consumes); object-ownership denials carry no capability field.
+    if (body.artifactId) {
+      // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
+      // target artifact. The writability check (own always; org-shared within org ok; another
+      // user's private → 403; missing/cross-org → 404) closes the follow-up-build IDOR (map §5.1),
+      // where any authenticated user could drive a code-writing agent against ANY artifact by id.
+      // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
+      // never leaks whether the target exists.
+      if (!can(actor, 'canEditApps')) {
+        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
+      }
+      const { verdict } = await loadWritable(actor, body.artifactId);
+      if (verdict === 'notfound') return notFound(res);
+      if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
+    } else if (!can(actor, 'canBuildApps')) {
+      // A first build CREATES an app.
+      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
+    }
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
index d8eede0..5629365 100644
--- a/api/src/server.ts
+++ b/api/src/server.ts
@@ -1,103 +1,104 @@
 /**
  * server.ts — the composition root (ch02 §2.6). Builds the Express app, mounts routers,
  * wires the injected seams (ch02 §2.8), and runs boot. The only file allowed to import
  * everything. This is the G0 skeleton: config boot gate + /health; domain routers mount
  * as their phases land.
  *
  * Carried boot behaviors (ch02 §2.6):
  *  - fail-closed config validation (ch09 §9.7): missing ENCRYPTION_KEY / JWT_SECRET refuses boot.
  *  - process-level exception posture: uncaughtException/unhandledRejection log and continue.
  */
 import { randomUUID } from 'node:crypto';
 import { readFile } from 'node:fs/promises';
 import { mkdirSync } from 'node:fs';
 import { pathToFileURL } from 'node:url';
 import express, { type Express, type NextFunction, type Request, type Response } from 'express';
 import { loadConfig, type Config } from './config.js';
 import { securityHeaders } from './security-headers.js';
 import { connectMongo } from './data/mongo.js';
 import { users } from './data/stores.js';
 import { CollectionsEngine, sharedScope } from './data/collections-engine.js';
 import { loadActivation } from './data/activation.js';
 import { loadRevocations } from './auth/revocation.js';
 import { seedAdmin } from './auth/service.js';
+import { migrateBuilderRole } from './auth/users-service.js';
 import { sendError } from './routes/helpers.js';
 import { authRouter } from './routes/auth.js';
 import { usersRouter } from './routes/users.js';
 import { orgRouter, orgsRouter } from './routes/org.js';
 import { brandingRouter } from './routes/branding.js';
 import { settingsRouter } from './routes/settings.js';
 import { sessionsRouter } from './routes/sessions.js';
 import { memoriesRouter } from './routes/memories.js';
 import { registoRouter } from './routes/registo.js';
 import { billingRouter } from './routes/billing.js';
 import { credentialsRouter } from './routes/credentials.js';
 import { llmHealth, registerGateway, loadCredential, setRulesetResolver } from './llm/index.js';
 import { setUsageNotifier } from './billing/index.js';
 import { integrationsRouter } from './routes/integrations.js';
 import { integrationBuilderRouter } from './routes/integration-builder.js';
 import { knowledgeRouter } from './routes/knowledge.js';
 import { triggersRouter } from './routes/triggers.js';
 import { hooksRouter } from './routes/hooks.js';
 import { notificationsRouter } from './routes/notifications.js';
 import { sseManager } from './events/sse-manager.js';
 import { startDelivery, stopDelivery } from './events/delivery.js';
 import { attachCanvasServer } from './streaming/index.js';
 import { attachBridgeServer, bufferLedgerRow, delegateToLocal, rowsForSession } from './bridge/index.js';
 import { maskedCountsForCorrelations } from './services/platform-crud.js';
 import { bridgeTokenRouter } from './routes/bridge.js';
 import { servedDataRouter } from './apps/served-data.js';
 import { appAssistantRouter } from './apps/app-assistant-route.js';
 import { devServeRouter } from './apps/dev-serve.js';
 import { servingRouter } from './apps/serving.js';
 import { appRegistry } from './apps/app-registry.js';
 import { appBuilder } from './apps/builder.js';
 import { loadSlugIndex } from './apps/slug-index.js';
 import { seedFeaturedArtifacts } from './apps/featured-seeder.js';
 import { buildAndRegisterFeaturedArtifacts } from './apps/featured-builder.js';
 import { resolveApp } from './apps/registry.js';
 import { appFilesRouter } from './apps/app-files.js';
 import { buildLinkRouter } from './apps/build-link.js';
 import { appSsoRouter } from './integrations/app-sso.js';
 import { m365ProxyRouter } from './integrations/m365-proxy.js';
 import { appCloudFilesRouter } from './integrations/app-cloud-files.js';
 import { adobeSignRouter } from './integrations/adobe-sign.js';
 import type { ResolveAppScope } from './integrations/app-scope.js';
 import { legalRouter } from './legal/router.js';
 import { designTokensHandler } from './services/design-tokens.js';
 import { getArtifactScreenshotDir } from './services/artifact-screenshot.js';
 import { appPdfRouter, getArtifactPdfDir } from './apps/pdf.js';
 import { getBrandAssetsDir } from './services/branding/index.js';
 import { companySpaceRouter } from './routes/company-space.js';
 import { verifyToken } from './auth/jwt.js';
 import { artifactsRouter } from './routes/artifacts.js';
 // G7B — agent execution (ch05 + ch08): chat/job routers, the injected agent seams, and the
 // boot obligations (content ingest, knowledge backfill, orphan sweep).
 import { chatRouter } from './routes/chat.js';
 import { jobsRouter } from './routes/jobs.js';
 import {
   setAssembleAgentContext,
   setKnowledgeGrounding,
   setIngestBuildKnowledge,
   setKnowledgeToolSearch,
   setKnowledgeToolRead,
   setLoadContextContent,
   setDelegateToLocal,
   setLocalActivitySources,
   setVerifyRunner,
   setBuildMechanics,
   setIntegrationPrefetch,
   setCatalog,
   sweepOrphans,
 } from './agents/index.js';
 import { assembleAgentContext, bootContentLoader, composeContext, configureContentLoader } from './content/index.js';
 import { backfillKnowledgeIndex, buildGroundingBlock, ingestDocument, searchKnowledgeIndex, readDocWithShared } from './knowledge/index.js';
 // G8 — automation engine + integrations execution layer + delivery targets + canvas.
 import { automationsRouter } from './routes/automations.js';
 import { platformIntegrationsRouter, oauthCallbackRouter } from './routes/platform-integrations.js';
 import { pipedreamRouter } from './routes/pipedream.js';
 import {
   setRunEventEmitterFactory,
   setIntegrationActionExecutor,
   setPlatformIntegrationCaller,
   setIntegrationCredentialLoader,
@@ -292,161 +293,161 @@ export function buildApp(config: Config, deps: RuntimeDeps = defaultDeps): Expre
   // file work to the user's paired daemon over the bridge. org + pairing resolve from the live
   // registry inside the bridge tool (never from tool arguments); the result is derived output
   // only, and offline is an honest `unreachable` (never an upload).
   setDelegateToLocal((actor, req) => delegateToLocal(actor, req));
   // FC-402 (run s5, D3) — the trust chip's two joins: buffered daemon ledger rows (bytes/files)
   // and the anon-audit mask counts by correlation id (§17.6). Both reads, no persistence.
   setLocalActivitySources({
     ledgerRows: (session, correlationIds) => rowsForSession(session, correlationIds),
     maskedCounts: (orgId, correlationIds) => maskedCountsForCorrelations(orgId, correlationIds),
   });
   // G8 — the §5.5.2 chat grounding seams land: live integration pre-fetch (layer 3) and the
   // cross-agent automation/integration catalog (layer 4).
   setIntegrationPrefetch(integrationPrefetch);
   setCatalog(async ({ userId, orgId }) => {
     void orgId; // catalog visibility is user-keyed; org scoping rides the underlying stores
     try {
       const catalog = await buildAutomationCatalog(userId, false);
       return formatCatalogForPrompt(catalog);
     } catch {
       return ''; // catalog failures are non-fatal (§5.5.2 layer 4)
     }
   });
 
   // G8 — automation engine seams (ch02 §2.8; automation/ may not import events/, apps/ or the
   // composition surfaces directly, so the root binds every collaborator).
   // 1. Run events → the automation SSE stream (§3.6.3): the emitter factory adapts the engine's
   //    callback seam onto the AutomationRunEvent wire union, replayable via Last-Event-ID.
   setRunEventEmitterFactory((runId) => makeRunSseEmitter(runId));
   // 2. Integration action execution (user-defined skills; §5.6.7 integration steps).
   setIntegrationActionExecutor(async (call) => {
     const owner = (await users.get(call.ownerUserId)) as { orgId?: string } | null;
     const r = await executeUserIntegrationAction(
       {
         orgId: owner?.orgId ?? '',
         ownerUserId: call.ownerUserId,
         integrationKey: call.integrationKey,
         actionName: call.actionName,
         args: call.args,
       },
       {
         // integração-por-automação (carried B25): an automationBinding action runs the bound
         // automation under the verified owner; integrations/ never imports automation/ (tiers).
         runAutomationBackedAction: async (b) => {
           const out = await runAutomationForAction({
             binding: b.binding as { automationId: string; argMap?: Record<string, string>; passCredentials?: boolean },
             args: b.args,
             credentialFields: b.credentialFields,
             orgId: b.orgId,
             ownerUserId: b.ownerUserId,
           });
           return { success: out.success, ...(out.code ? { code: out.code } : {}), ...(out.error ? { error: out.error } : {}), ...(out.data !== undefined ? { data: out.data } : {}) };
         },
       },
     );
     return { success: r.success, data: r.data, error: r.error, details: r.code };
   });
   // 3. Platform integrations (Google/Microsoft) behind automation + listener steps.
   setPlatformIntegrationCaller(async (call, pactor) => {
     const owner = (await users.get(pactor.userId)) as { orgId?: string } | null;
     const r = await callPlatformIntegration(
       { orgId: owner?.orgId ?? '', integrationKey: call.integrationKey, actionName: call.actionName, args: call.args },
       { now: deps.now, genId: deps.genId },
     );
     return { success: r.success, data: r.data, error: r.error };
   });
   // 4. Decrypted credential fields for api_call auth injection (encrypted at rest, ch09).
   setIntegrationCredentialLoader(async (integrationKey, ownerUserId) => {
     const owner = (await users.get(ownerUserId)) as { orgId?: string } | null;
     if (!owner?.orgId) return null;
     const cfg = await findConfigForOwner(owner.orgId, ownerUserId, integrationKey);
     if (!cfg?.credentialsCiphertext) return null;
     try {
       const values = JSON.parse(decrypt(cfg.credentialsCiphertext)) as Record<string, unknown>;
       return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
     } catch {
       return null;
     }
   });
   // 5. Automation-scoped memory snippets for vision prompts (correction memories, §11.6).
   setScopedMemoryResolver(async (q) => {
-    const all = await listVisibleMemories({ userId: q.ownerUserId, orgId: q.orgId, role: 'builder' });
+    const all = await listVisibleMemories({ userId: q.ownerUserId, orgId: q.orgId, role: 'user' });
     const tag = `automation:${q.automationId}`;
     return all
       .filter((m) => (m.tags ?? []).includes(tag) && typeof m.content === 'string')
       .slice(0, q.maxMemories)
       .map((m) => m.content as string);
   });
   // 6. App-data collections behind ekoa_action steps (the served-app shared plane, G6).
   const automationAppData = new CollectionsEngine(deps);
   const appScopeOf = async (artifactId: string) => {
     const art = await getArtifactById(artifactId);
     return sharedScope(artifactId, (art?.userId as string | undefined) ?? '');
   };
   setAppDataStore({
     list: async (a, c) => automationAppData.list(await appScopeOf(a), c),
     get: async (a, c, id) => automationAppData.get(await appScopeOf(a), c, id),
     create: async (a, c, data) => (await automationAppData.create(await appScopeOf(a), c, data)) as { id: string } & Record<string, unknown>,
     update: async (a, c, id, patch) => automationAppData.upsert(await appScopeOf(a), c, id, patch),
     delete: async (a, c, id) => automationAppData.delete(await appScopeOf(a), c, id),
   });
   // 7. Artifact resolution for ekoa_action target apps (slug or id → project dir, jailed), ORG-
   //    SCOPED to the run: a cross-org artifact is refused, so an ekoa_action step can never resolve
   //    and execute another org's capability against its app-data (Codex G8).
   setArtifactResolver(async (slugOrId, requesterOrgId) => {
     const resolved = await resolveApp(slugOrId);
     if (!resolved || !resolved.artifactBacked) return null;
     const art = await getArtifactById(resolved.appId);
     if (!art || art.orgId !== requesterOrgId) return null;
     return { artifactId: resolved.appId, projectDir: projectDirFor(art) };
   });
   // 8. Catalog sources: integration definitions feed skills; connected platform accounts and
   //    artifact (ekoa_action) capabilities keep honest empties this gate — the seam carries no
   //    org context for accounts and no MANIFEST-capability surface exists yet (G9 note).
   setCatalogSources({
     getVisibleSkills: () =>
       listDefinitions().map((d) => ({
         integrationKey: d.integrationKey,
         actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
       })),
     getSkill: (integrationKey) => {
       const d = getDefinition(integrationKey);
       return d
         ? {
             integrationKey: d.integrationKey,
             actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
           }
         : undefined;
     },
     getConnectedPlatformAccounts: async () => [],
     listEkoaActions: async () => [],
   });
   // 9. The in-process local browser for browser-step automations (services/ shared pool).
   setLocalBrowserContextProvider(async () => {
     const browser = await getSharedBrowser();
     return browser.newContext();
   });
   // (setDaemonConnectionResolver stays on its honest default — the bridge lands at G8A.)
 
   // G8 — trigger delivery targets (ch02 §2.8: injected callbacks, never upward imports).
   setDeliveryTargets({
     startAutomationRun: async (automationId, event) => {
       const outcome = await startRunForTrigger({
         automationId,
         // Server-trusted owner from the trigger record, NEVER the inbound payload (§5.6.7).
         ownerUserId: event.trigger.ownerUserId,
         orgId: event.trigger.orgId,
         triggeredBy: 'webhook',
         event: {
           triggerId: event.trigger._id,
           integrationKey: event.trigger.integrationKey,
           eventName: event.trigger.eventName,
           receivedAt: new Date(deps.now()).toISOString(),
           payload: event.payload,
           rawHeaders: {},
         },
       });
       if (outcome.outcome === 'completed') return { ok: true };
       return { ok: false, reason: `run ended ${outcome.outcome}`, ...(outcome.permanent ? { permanent: true } : {}) };
     },
     invokeArtifactBackend: async (artifactId, entrypoint, event) => {
       // Delivery-side cross-org guard (Codex G8, defense-in-depth alongside the trigger-creation
@@ -599,160 +600,164 @@ export function buildApp(config: Config, deps: RuntimeDeps = defaultDeps): Expre
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
   loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active })));
+  // H1 idempotent migration: rewrite any retired `builder` role → `user` and bump its token epoch
+  // (runs after loadActivation so the epoch lands in the in-memory map; no-op once migrated).
+  const migratedRoles = await migrateBuilderRole();
+  if (migratedRoles > 0) console.log(`[role-migration] builder -> user: ${migratedRoles} user(s) migrated`);
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
 // Use pathToFileURL so the comparison holds under paths with spaces/non-ASCII chars and
 // percent-encoding — a naive `file://${argv[1]}` would silently mismatch and never boot.
 if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
   boot();
diff --git a/api/tests/auth/role-migration.test.ts b/api/tests/auth/role-migration.test.ts
new file mode 100644
index 0000000..0661236
--- /dev/null
+++ b/api/tests/auth/role-migration.test.ts
@@ -0,0 +1,91 @@
+/**
+ * H1 legacy compatibility for the `builder` → `user` role rename — the two layers that carry a
+ * fleet across the rename without a flag day:
+ *   1. the idempotent boot-step migration (migrateBuilderRole): rewrites every legacy row and
+ *      bumps its token epoch, exactly once; and
+ *   2. the verify-boundary normalization shim (verifyToken): a JWT still carrying role 'builder'
+ *      is normalised to 'user' before any downstream role/capability check sees it.
+ */
+import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
+import jwt from 'jsonwebtoken';
+import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
+import { connectMongo, closeMongo } from '../../src/data/mongo.js';
+import { users } from '../../src/data/stores.js';
+import { getActivation, __resetActivationForTests } from '../../src/data/activation.js';
+import { hashPassword } from '../../src/auth/password.js';
+import { migrateBuilderRole } from '../../src/auth/users-service.js';
+import { verifyToken, signToken } from '../../src/auth/jwt.js';
+import { loadConfig, __resetConfigForTests } from '../../src/config.js';
+
+let mem: MongoMemoryServer;
+
+beforeAll(async () => {
+  process.env.ENCRYPTION_KEY = 'k';
+  process.env.JWT_SECRET = 'role-migration-secret';
+  __resetConfigForTests();
+  loadConfig();
+  mem = await createMem();
+  await connectMongo(mem.getUri(), 'ekoa_role_migration');
+}, 60_000);
+
+afterAll(async () => {
+  await closeMongo();
+  await mem.stop();
+});
+
+beforeEach(async () => {
+  __resetActivationForTests();
+  await users.deleteMany({});
+});
+
+describe('migrateBuilderRole — idempotent boot-step migration', () => {
+  it('rewrites a legacy builder row to user and bumps its token epoch, exactly once (idempotent)', async () => {
+    // Seed a LEGACY row: role 'builder' is no longer in the Role type, so the doc is cast to
+    // simulate a pre-rename record on disk.
+    await users.insert({ _id: 'legacy1', username: 'legacy1', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'orgA', active: true } as never);
+    // A non-builder row is left untouched.
+    await users.insert({ _id: 'admin1', username: 'admin1', passwordHash: await hashPassword('pw123456'), role: 'org-admin', orgId: 'orgA', active: true });
+
+    const firstCount = await migrateBuilderRole();
+    expect(firstCount).toBe(1); // exactly the one legacy row
+
+    const migrated = await users.get('legacy1');
+    expect(migrated?.role).toBe('user'); // role rewritten
+    const admin = await users.get('admin1');
+    expect(admin?.role).toBe('org-admin'); // untouched
+
+    const epochAfterFirst = getActivation('legacy1')?.tokenEpoch ?? 0;
+    expect(epochAfterFirst).toBeGreaterThan(0); // epoch bumped → outstanding legacy JWTs invalid
+
+    // Second run: nothing carries 'builder' now → no rows migrated, no further epoch bump.
+    const secondCount = await migrateBuilderRole();
+    expect(secondCount).toBe(0);
+    expect((await users.get('legacy1'))?.role).toBe('user'); // still user
+    expect(getActivation('legacy1')?.tokenEpoch ?? 0).toBe(epochAfterFirst); // epoch bumped ONCE
+  });
+
+  it('is a no-op on a clean store (returns 0)', async () => {
+    await users.insert({ _id: 'u-clean', username: 'u-clean', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true });
+    expect(await migrateBuilderRole()).toBe(0);
+  });
+});
+
+describe('verifyToken — legacy-window role normalization shim', () => {
+  it("normalises a legacy 'builder' JWT role to 'user' before any check", () => {
+    // A token minted before the rename literally carries role 'builder'. jwt.sign it raw (signToken
+    // only accepts the current Role type), then verify: the shim maps it to 'user'.
+    const legacy = jwt.sign(
+      { sub: 'u1', role: 'builder', scope: 'user', orgId: 'o1', username: 'ana', jti: 'j1' },
+      loadConfig().jwtSecret,
+      { expiresIn: 3600 },
+    );
+    expect(verifyToken(legacy).role).toBe('user');
+  });
+
+  it('leaves current roles untouched (user stays user, org-admin stays org-admin)', () => {
+    const userTok = signToken({ sub: 'u2', role: 'user', scope: 'user', orgId: 'o1', username: 'bob', jti: 'j2' }).token;
+    expect(verifyToken(userTok).role).toBe('user');
+    const adminTok = signToken({ sub: 'u3', role: 'org-admin', scope: 'user', orgId: 'o1', username: 'chefe', jti: 'j3' }).token;
+    expect(verifyToken(adminTok).role).toBe('org-admin');
+  });
+});
diff --git a/api/tests/contract/jobs-capability.test.ts b/api/tests/contract/jobs-capability.test.ts
new file mode 100644
index 0000000..6bd6d48
--- /dev/null
+++ b/api/tests/contract/jobs-capability.test.ts
@@ -0,0 +1,129 @@
+/**
+ * H1 build-authorization gate + the follow-up-build IDOR fix (map §5.1), exercised through the
+ * REAL jobs router over mongo-mem. The build EXECUTOR is mocked (`handleBuildCreate`) so no real
+ * build runs: the gate lives entirely in the route BEFORE the executor, so a refusal means the
+ * executor was never called, and a proceed means it was called with the expected args.
+ *
+ * Matrix under test:
+ *  - first build: a `user` (no canBuildApps) is refused 403; an org-admin proceeds.
+ *  - follow-up (artifactId): requires canEditApps AND writability. A `user` is refused on the
+ *    capability (before any ownership probe — no existence leak). An org-admin who is not the
+ *    owner of a PRIVATE target is refused 403 (the IDOR: previously any user could drive an agent
+ *    against ANY artifact by id). A cross-org target is 404. An org-shared same-org target — and
+ *    the actor's OWN app — proceed.
+ */
+import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
+import express from 'express';
+import type { Server } from 'node:http';
+import { ErrorEnvelope } from '@ekoa/shared';
+import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
+import { connectMongo, closeMongo } from '../../src/data/mongo.js';
+import { users, artifacts } from '../../src/data/stores.js';
+import { setActivation } from '../../src/data/activation.js';
+import { login } from '../../src/auth/service.js';
+import { hashPassword } from '../../src/auth/password.js';
+import { __resetConfigForTests, loadConfig } from '../../src/config.js';
+
+// Mock the build executor entry. The route's capability/ownership gate runs BEFORE this is called,
+// so its call-count is the ground truth for "was the request authorized".
+const { handleBuildCreateMock } = vi.hoisted(() => ({ handleBuildCreateMock: vi.fn() }));
+vi.mock('../../src/agents/index.js', async (importActual) => {
+  const actual = await importActual<typeof import('../../src/agents/index.js')>();
+  return { ...actual, handleBuildCreate: handleBuildCreateMock };
+});
+
+// Imported after the mock is declared (vi.mock is hoisted above imports by vitest).
+import { jobsRouter } from '../../src/routes/jobs.js';
+
+let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
+const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
+const api = (p: string, t: string, init: RequestInit = {}) =>
+  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
+
+async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'user', orgId: string) {
+  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
+  setActivation(id, { active: true, billingLocked: false });
+}
+const tokenFor = async (id: string) => (await login(id, 'pw123456', false, deps)).token;
+const build = (extra: Record<string, unknown> = {}) => JSON.stringify({ kind: 'build', description: 'change it', sessionId: 's1', language: 'pt', ...extra });
+
+beforeAll(async () => {
+  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
+  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_jobs_capability');
+  await mkUser('userA', 'user', 'orgA');       // plain member, owns the artifacts below
+  await mkUser('adminA', 'org-admin', 'orgA');  // same-org admin (has canEditApps)
+  await mkUser('adminB', 'org-admin', 'orgB');  // other-org admin
+  // userA's apps in orgA: one private, one org-shared. adminA owns a private app of its own.
+  await artifacts.insert({ _id: 'artA-priv', userId: 'userA', orgId: 'orgA', visibility: 'private', name: 'A priv' } as never);
+  await artifacts.insert({ _id: 'artA-shared', userId: 'userA', orgId: 'orgA', visibility: 'org', name: 'A shared' } as never);
+  await artifacts.insert({ _id: 'artAdminA-priv', userId: 'adminA', orgId: 'orgA', visibility: 'private', name: 'adminA priv' } as never);
+  const app = express(); app.use(express.json()); app.use('/api/v1/jobs', jobsRouter(deps));
+  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
+  port = (server.address() as { port: number }).port;
+}, 60_000);
+afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
+
+beforeEach(() => {
+  handleBuildCreateMock.mockReset();
+  handleBuildCreateMock.mockResolvedValue({ status: 'created', job: { id: 'jX', status: 'running', createdAt: 'x' }, fire: () => {} });
+});
+
+describe('POST /jobs — first-build capability gate (canBuildApps)', () => {
+  it('a user (no canBuildApps) is refused 403 FORBIDDEN + details.capability, executor never called', async () => {
+    const res = await api('/api/v1/jobs', await tokenFor('userA'), { method: 'POST', body: build() });
+    expect(res.status).toBe(403);
+    const body = (await res.json()) as { error: { code: string; details?: { capability?: string } } };
+    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
+    expect(body.error.code).toBe('FORBIDDEN');
+    expect(body.error.details?.capability).toBe('canBuildApps');
+    expect(handleBuildCreateMock).not.toHaveBeenCalled();
+  });
+
+  it('an org-admin proceeds → 202, executor called with no artifactId', async () => {
+    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build() });
+    expect(res.status).toBe(202);
+    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
+    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBeUndefined();
+  });
+});
+
+describe('POST /jobs — follow-up build gate (canEditApps + writability, IDOR fix)', () => {
+  it('a user (no canEditApps) is refused on the capability BEFORE any ownership probe → 403 canEditApps', async () => {
+    const res = await api('/api/v1/jobs', await tokenFor('userA'), { method: 'POST', body: build({ artifactId: 'artA-shared' }) });
+    expect(res.status).toBe(403);
+    const body = (await res.json()) as { error: { code: string; details?: { capability?: string } } };
+    expect(body.error.code).toBe('FORBIDDEN');
+    expect(body.error.details?.capability).toBe('canEditApps');
+    expect(handleBuildCreateMock).not.toHaveBeenCalled();
+  });
+
+  it("an org-admin targeting ANOTHER user's PRIVATE app in-org is refused 403 (the IDOR) — an ownership denial, no capability field, executor never called", async () => {
+    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build({ artifactId: 'artA-priv' }) });
+    expect(res.status).toBe(403);
+    const body = (await res.json()) as { error: { code: string; details?: { capability?: string } } };
+    expect(body.error.code).toBe('FORBIDDEN');
+    expect(body.error.details?.capability).toBeUndefined(); // ownership denial, not a capability refusal
+    expect(handleBuildCreateMock).not.toHaveBeenCalled();
+  });
+
+  it('a cross-org target is a uniform 404, executor never called', async () => {
+    const res = await api('/api/v1/jobs', await tokenFor('adminB'), { method: 'POST', body: build({ artifactId: 'artA-shared' }) });
+    expect(res.status).toBe(404);
+    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
+    expect(handleBuildCreateMock).not.toHaveBeenCalled();
+  });
+
+  it('an org-admin editing an ORG-SHARED same-org app proceeds → 202, executor called with the artifactId', async () => {
+    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build({ artifactId: 'artA-shared' }) });
+    expect(res.status).toBe(202);
+    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
+    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBe('artA-shared');
+  });
+
+  it('an org-admin editing its OWN private app proceeds → 202 (own always)', async () => {
+    const res = await api('/api/v1/jobs', await tokenFor('adminA'), { method: 'POST', body: build({ artifactId: 'artAdminA-priv' }) });
+    expect(res.status).toBe(202);
+    expect(handleBuildCreateMock).toHaveBeenCalledTimes(1);
+    expect(handleBuildCreateMock.mock.calls[0]![0].artifactId).toBe('artAdminA-priv');
+  });
+});
diff --git a/api/tests/contract/jobs.test.ts b/api/tests/contract/jobs.test.ts
index 7598512..f6daae4 100644
--- a/api/tests/contract/jobs.test.ts
+++ b/api/tests/contract/jobs.test.ts
@@ -1,109 +1,127 @@
 import { describe, it, expect, beforeAll, afterAll } from 'vitest';
 import express from 'express';
 import type { Server } from 'node:http';
 import { JobCreateRequest, JobCreateResponse, Job, JobCancelResponse, ErrorEnvelope } from '@ekoa/shared';
 import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
 import { connectMongo, closeMongo } from '../../src/data/mongo.js';
 import { users, userSettings } from '../../src/data/stores.js';
 import { setActivation } from '../../src/data/activation.js';
 import { login } from '../../src/auth/service.js';
 import { hashPassword } from '../../src/auth/password.js';
 import { __resetConfigForTests, loadConfig } from '../../src/config.js';
 import { setCredential } from '../../src/llm/credentials.js';
 import { __setTransportForTests } from '../../src/llm/client.js';
 import { jobsRouter } from '../../src/routes/jobs.js';
 import { makeFakeTransport } from '../agents/_fake-transport.js';
 
 /**
  * Contract test for the build jobs endpoints (ch03 §3.8.8): responses validate against `shared/`.
  * The router is mounted on a bare app (server.ts wiring is the lead's) with the fake transport.
  */
 let mem: MongoMemoryServer; let server: Server; let port: number; let seq = 0;
 const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
 const api = (p: string, t: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
 
 beforeAll(async () => {
   process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
   mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_contract_jobs');
   await setCredential({ mode: 'oauth', secret: 'tok' });
   __setTransportForTests(makeFakeTransport({ finalText: 'built' }));
-  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'o1', active: true });
+  // H1: u1 POSTs real builds below, which now require canBuildApps → seed it as an org-admin.
+  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'org-admin', orgId: 'o1', active: true });
   setActivation('u1', { active: true, billingLocked: false });
   await userSettings.put({ _id: 'u1', memory: { autoExtract: false }, build: { verifyBuilds: false } });
   const app = express();
   app.use(express.json());
   app.use('/api/v1/jobs', jobsRouter(deps));
   await new Promise<void>((r) => { server = app.listen(0, () => r()); });
   port = (server.address() as { port: number }).port;
 }, 60_000);
 afterAll(async () => { await drain(); server.close(); await closeMongo(); await mem.stop(); });
 
 const tokenFor = async () => (await login('u1', 'pw123456', false, deps)).token;
 const drain = () => new Promise((r) => setTimeout(r, 300)); // let the fire-and-forget build settle
 
 describe('build jobs contract (§3.8.8)', () => {
   it('POST /jobs (build) → 202 JobCreateResponse (created); GET → Job; cancel → JobCancelResponse', async () => {
     const t = await tokenFor();
     const created = await api('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: 'build a crm', sessionId: 'sX', language: 'pt' }) });
     expect(created.status).toBe(202);
     const body = await created.json();
     expect(JobCreateResponse.safeParse(body).success).toBe(true);
     const jobId = (body as { status: 'created'; job: { id: string } }).job.id;
 
     // Wait for the fire-and-forget build to reach a terminal state so its async writes finish
     // before teardown (the build runs LLM-free via the fake transport).
     for (let i = 0; i < 40; i++) {
       const g = await api(`/api/v1/jobs/${jobId}`, t);
       const j = await g.json();
       expect(Job.safeParse(j).success).toBe(true);
       if (['completed', 'failed', 'cancelled'].includes((j as { status: string }).status)) break;
       await new Promise((r) => setTimeout(r, 25));
     }
 
     const cancelled = await api(`/api/v1/jobs/${jobId}/cancel`, t, { method: 'POST' });
     expect(JobCancelResponse.safeParse(await cancelled.json()).success).toBe(true);
   });
 
   it('JobCreateRequest carries knowledgeDocs (additive, bounded) - codex F1 finding 1', () => {
     const doc = { title: 'Manual de subscrição', text: 'regras de subscrição' };
     const base = { kind: 'build', description: 'seguros', sessionId: 's1' };
     // The field must SURVIVE parsing (it was silently stripped before the fix).
     const parsed = JobCreateRequest.safeParse({ ...base, knowledgeDocs: [doc] });
     expect(parsed.success).toBe(true);
     expect(parsed.success && parsed.data.knowledgeDocs).toEqual([doc]);
     // Bounds enforced at the boundary: count and per-doc text size.
     expect(JobCreateRequest.safeParse({ ...base, knowledgeDocs: Array(21).fill(doc) }).success).toBe(false);
     expect(JobCreateRequest.safeParse({ ...base, knowledgeDocs: [{ title: 't', text: 'x'.repeat(262145) }] }).success).toBe(false);
     expect(JobCreateRequest.safeParse({ ...base, knowledgeDocs: [{ title: '', text: 'x' }] }).success).toBe(false);
     // Optional: absent field stays valid (older clients unaffected).
     expect(JobCreateRequest.safeParse(base).success).toBe(true);
   });
 
   it('POST /jobs with an invalid kind → 400 error envelope', async () => {
     const t = await tokenFor();
     const res = await api('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'brand-research', description: 'x', sessionId: 's' }) });
     expect(res.status).toBe(400);
     expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
   });
 
   it('GET events with no token → 401 error envelope', async () => {
     const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/x/events`);
     expect(res.status).toBe(401);
     expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
   });
 
   it("GET events for ANOTHER user's job → 403 (cross-user ownership, Codex checkpoint)", async () => {
     // u1 owns the job; u2 holds a valid SSE token but must NOT be able to stream u1's job events.
     const t1 = await tokenFor();
     const created = await api('/api/v1/jobs', t1, { method: 'POST', body: JSON.stringify({ kind: 'build', description: 'u1 private job', sessionId: 'sOwn', language: 'pt' }) });
     const jobId = ((await created.json()) as { job: { id: string } }).job.id;
-    await users.insert({ _id: 'u2', username: 'u2', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'o2', active: true });
+    await users.insert({ _id: 'u2', username: 'u2', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'o2', active: true });
     setActivation('u2', { active: true, billingLocked: false });
     await userSettings.put({ _id: 'u2', memory: { autoExtract: false }, build: { verifyBuilds: false } });
     const t2 = (await login('u2', 'pw123456', false, deps)).token;
     const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/${jobId}/events?token=${t2}`);
     expect(res.status).toBe(403);
     expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
     await drain();
   });
+
+  it('a user without canBuildApps is refused a first build → 403 FORBIDDEN envelope + details.capability (H1)', async () => {
+    // The refusal is the machine-readable FORBIDDEN shape the H4 request-to-admin flow consumes:
+    // a stable code + `details.capability`, validating against the shared error envelope.
+    await users.insert({ _id: 'plain1', username: 'plain1', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'o1', active: true });
+    setActivation('plain1', { active: true, billingLocked: false });
+    await userSettings.put({ _id: 'plain1', memory: { autoExtract: false }, build: { verifyBuilds: false } });
+    const t = (await login('plain1', 'pw123456', false, deps)).token;
+    const res = await api('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: 'build me an app', sessionId: 'sCap', language: 'pt' }) });
+    expect(res.status).toBe(403);
+    const body = (await res.json()) as { error: { code: string; message: string; details?: { capability?: string } } };
+    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
+    expect(body.error.code).toBe('FORBIDDEN');
+    expect(body.error.details?.capability).toBe('canBuildApps');
+    // No job is created when the capability gate refuses (the gate runs before handleBuildCreate).
+    expect(body.error.message).not.toContain('undefined');
+  });
 });
diff --git a/shared/src/common.ts b/shared/src/common.ts
index 2226634..f09f33d 100644
--- a/shared/src/common.ts
+++ b/shared/src/common.ts
@@ -1,50 +1,51 @@
 import { z } from 'zod';
 
 /** Shared primitives used across domains. ISO-8601 UTC timestamps (ch03 §3.4).
  *  Accepts both `Z` and explicit-offset forms; the server mints UTC. (A trailing
  *  `.or(z.string())` would make the datetime check dead, so it is deliberately absent.) */
 export const IsoTimestamp = z.string().datetime({ offset: true });
 export const Id = z.string().min(1);
 
 /** Uniform list-with-total envelope for paginated reads (ch03 §3.4). */
 export const listResponse = <T extends z.ZodTypeAny>(item: T) =>
   z.object({ items: z.array(item), total: z.number().int().nonnegative() });
 
 /** Simple items wrapper (non-paginated collections). */
 export const itemsResponse = <T extends z.ZodTypeAny>(item: T) =>
   z.object({ items: z.array(item) });
 
 export const OkResponse = z.object({ ok: z.literal(true) });
 export type OkResponse = z.infer<typeof OkResponse>;
 
 /** Pagination query shared by list endpoints. */
 export const PaginationQuery = z.object({
   limit: z.coerce.number().int().positive().max(500).optional(),
   offset: z.coerce.number().int().nonnegative().optional(),
 });
 
 /** Language field for endpoints producing user-visible model output (ch03 §3.4). */
 export const Language = z.enum(['pt', 'en']).default('pt');
 
 /** Org sharing visibility (Amendment 2): default private. */
 export const Visibility = z.enum(['private', 'org']);
 
-/** The three-role model (Amendment 2). */
-export const Role = z.enum(['super-admin', 'org-admin', 'builder']);
+/** The three-role model (Amendment 2; H1 security block renamed the base role `builder` → `user`
+ *  — the builder persona is retired, `user` is the base non-admin role). */
+export const Role = z.enum(['super-admin', 'org-admin', 'user']);
 export type Role = z.infer<typeof Role>;
 
 /** The per-request actor context derived from the verified JWT. A plain type (no wire
  *  schema) placed here so every api tier — data/, auth/, routes/, services/ — can name it
  *  without crossing an import boundary. */
 export interface Actor {
   userId: string;
   orgId: string;
   role: Role;
 }
 
 /** Reference to a staged upload by opaque id (ch03 §3.4). */
 export const UploadRef = z.object({
   uploadId: z.string(),
   displayName: z.string().optional(),
 });
 export type UploadRef = z.infer<typeof UploadRef>;
diff --git a/shared/src/contract.test.ts b/shared/src/contract.test.ts
index a8a1165..67f8a24 100644
--- a/shared/src/contract.test.ts
+++ b/shared/src/contract.test.ts
@@ -96,114 +96,114 @@ describe('shared contract', () => {
   it('language default applies when omitted (ch03 §3.4)', async () => {
     const { ChatRunCreateRequest } = await import('./chat.js');
     const parsed = ChatRunCreateRequest.parse({ sessionId: 's', message: 'olá' });
     expect(parsed.language).toBe('pt');
   });
 
   it('NotificationEvent can represent the ready stream-open ack (ch03 §3.6)', async () => {
     const { NotificationEvent } = await import('./events.js');
     expect(NotificationEvent.safeParse({ type: 'ready' }).success).toBe(true);
     expect(NotificationEvent.safeParse({ type: 'usage_updated' }).success).toBe(true);
   });
 
   it('AutomationRunEvent step: parses both a thin legacy event and an enriched one (§3.6.3)', async () => {
     const { AutomationRunEvent } = await import('./events.js');
     // A pre-enrichment client emitted only the thin core — it must still validate (old clients stay valid).
     expect(
       AutomationRunEvent.safeParse({ type: 'step', runId: 'r', stepIndex: 0, status: 'running' }).success,
     ).toBe(true);
     // The enriched event carries every OPTIONAL field the run UI reads.
     expect(
       AutomationRunEvent.safeParse({
         type: 'step',
         runId: 'r',
         stepIndex: 2,
         status: 'failed',
         stepId: 's2',
         tier: 'vision',
         error: 'a página não corresponde ao resultado esperado',
         screenshotUrl: '/automation-screenshots/auto/run/step-2.png',
         output: { kind: 'local_command', stdout: '', stderr: '', exitCode: 1 },
         durationMs: 900,
       }).success,
     ).toBe(true);
   });
 
   it('RunRecord carries optional per-step outcomes with a served screenshotUrl (§3.6.3)', async () => {
     const { RunRecord } = await import('./automations.js');
     const parsed = RunRecord.safeParse({
       id: 'run-1',
       automationId: 'auto-1',
       status: 'completed',
       steps: [
         { stepId: 's1', index: 0, status: 'completed', tier: 'cache', durationMs: 12, screenshotUrl: '/automation-screenshots/auto-1/run-1/step-0.png' },
         { stepId: 's2', index: 1, status: 'failed', tier: 'vision', durationMs: 30, error: { message: 'falhou', recoverable: true } },
       ],
     });
     expect(parsed.success).toBe(true);
     // A legacy stepless record still validates (steps optional).
     expect(RunRecord.safeParse({ id: 'r', automationId: 'a', status: 'running' }).success).toBe(true);
   });
 
   it('no auth cell carries a bare "admin" class (ch03 acceptance 11)', () => {
     for (const e of allEndpointsFlat()) {
       expect(['public', 'user', 'org-admin', 'super-admin', 'token-query', 'hmac', 'header-scoped', 'optional-jwt', 'app-id-gated', 'bridge']).toContain(e.auth);
     }
   });
 });
 
 /**
  * G12 security phase - contract-level egress/injection guards (the shared/ Codex scope).
  * Each test pins a fix so the class is machine-caught forever (the determinism ratchet).
  */
 describe('shared contract - security ratchet (G12)', () => {
   it('the error envelope details is bounded to plain JSON - non-JSON internal objects cannot validate', () => {
     // Accidental internal objects (a Date, a Buffer, a bigint) in details are exactly the
     // careless-`sendError` leak shapes; the JsonValue bound rejects them at the contract boundary
     // (ch09 §9.3 invariant 2 is the runtime control; this makes the contract test a guard too).
     const buf = { error: { code: 'INTERNAL', message: 'x', details: { blob: Buffer.from('secret') } } };
     expect(ErrorEnvelope.safeParse(buf).success).toBe(false);
     const date = { error: { code: 'INTERNAL', message: 'x', details: { at: new Date() } } };
     expect(ErrorEnvelope.safeParse(date).success).toBe(false);
     const big = { error: { code: 'INTERNAL', message: 'x', details: { n: 10n } } };
     expect(ErrorEnvelope.safeParse(big).success).toBe(false);
     // legitimate structured details (validation issues, a billingUrl) still pass
     const okDetails = { error: { code: 'VALIDATION_FAILED', message: 'x', details: { issues: [{ code: 'invalid_type', path: ['a'], message: 'req' }], billingUrl: 'https://x' } } };
     expect(ErrorEnvelope.safeParse(okDetails).success).toBe(true);
   });
 
   it('AuthUser is strict - a passwordHash-bearing object cannot validate as an AuthUser (no secret leak)', async () => {
     const { AuthUser } = await import('./auth.js');
-    const base = { id: 'u1', username: 'a', role: 'builder', orgId: 'o1', active: true };
+    const base = { id: 'u1', username: 'a', role: 'user', orgId: 'o1', active: true };
     expect(AuthUser.safeParse(base).success).toBe(true);
     expect(AuthUser.safeParse({ ...base, passwordHash: '$2b$...' }).success).toBe(false);
     expect(AuthUser.safeParse({ ...base, resetToken: 'deadbeef' }).success).toBe(false);
   });
 
   it('session-capture responses carry status metadata only, never the captured storageState', async () => {
     const { SessionCaptureStatus, ConnectSessionResponse } = await import('./integrations.js');
     expect(SessionCaptureStatus.safeParse({ status: 'ok', session: { status: 'captured', capturedAt: '2026-07-08T00:00:00Z' } }).success).toBe(true);
     // a raw Playwright storageState (cookies) is not a legal session snapshot
     expect(
       SessionCaptureStatus.safeParse({ status: 'ok', session: { cookies: [{ name: 'sid', value: 'secret' }] } }).success,
     ).toBe(false);
     expect(ConnectSessionResponse.safeParse({ started: true, session: { status: 'waiting_login' } }).success).toBe(true);
     expect(ConnectSessionResponse.safeParse({ started: true, session: { storageState: { cookies: [] } } }).success).toBe(false);
   });
 
   it('DelegatedTask signing bytes are injective - a non-finite egress budget cannot be signed (§18.1)', async () => {
     const { DelegatedTask, canonicalTaskBinding } = await import('./ekoa-local.js');
     const base = {
       taskId: 't', org: 'o', user: 'u', session: 's', pairingId: 'p', grantRefs: ['g'],
       task: 'read', budget: { egressBytes: 1000, modelSpend: { userId: 'u' } }, expiry: '2026-07-08T00:00:00Z', nonce: 'n', sig: 'x',
     };
     expect(DelegatedTask.safeParse(base).success).toBe(true);
     // an Infinity egress cap is rejected at the schema boundary (would canonicalise to `null`)
     expect(DelegatedTask.safeParse({ ...base, budget: { egressBytes: Infinity, modelSpend: { userId: 'u' } } }).success).toBe(false);
     // and the canonicaliser refuses a non-finite number defensively
     expect(() => canonicalTaskBinding({ ...base, budget: { egressBytes: Infinity, modelSpend: { userId: 'u' } } } as never)).toThrow(/non-finite/);
     // two distinct finite budgets produce distinct signing bytes (injective)
     const a = canonicalTaskBinding({ ...base, budget: { egressBytes: 1000, modelSpend: { userId: 'u' } } });
     const b = canonicalTaskBinding({ ...base, budget: { egressBytes: 2000, modelSpend: { userId: 'u' } } });
     expect(a).not.toBe(b);
   });
 });

codex
The next question is whether “cannot build or change apps” is actually enforced outside `POST /jobs`. I’m checking the artifact mutation surface, because that router still exposes multiple code-writing and rebuild paths behind ownership-only checks.
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
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
codex
I’ve hit the revocation path now. There’s a separate question from the route gates: whether the role-migration epoch bump survives a restart or only updates in memory. I’m checking the user schema plus every write/load of `tokenEpoch`.
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"tokenEpoch|bumpTokenEpoch|setActivation\\(|loadActivation\\(|iat < act.tokenEpoch|mintIat|users\\.update\\(.*tokenEpoch|tokenEpoch:\" api/src api/tests shared/src -g '"'!node_modules'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/tests/fake-daemon/integration.test.ts:69:  setActivation(ownerUserId, { active: true, billingLocked: false });
api/tests/fake-daemon/correlation-join.test.ts:109:    setActivation('u1', { active: true, billingLocked: false });
api/tests/bridge/connect-auth.test.ts:88:    setActivation('owner-1', { active: true, billingLocked: false });
api/tests/bridge/connect-auth.test.ts:105:    setActivation('owner-1', { active: true, billingLocked: false });
api/tests/bridge/connect-auth.test.ts:116:    setActivation('owner-Y', { active: true, billingLocked: false });
api/tests/bridge/connect-auth.test.ts:125:    setActivation('owner-1', { active: false, billingLocked: false });
api/tests/bridge/connect-auth.test.ts:134:    setActivation('owner-1', { active: true, billingLocked: true });
api/tests/auth/role-migration.test.ts:57:    const epochAfterFirst = getActivation('legacy1')?.tokenEpoch ?? 0;
api/tests/auth/role-migration.test.ts:64:    expect(getActivation('legacy1')?.tokenEpoch ?? 0).toBe(epochAfterFirst); // epoch bumped ONCE
api/tests/auth/activation-auth.test.ts:47:  setActivation(id, { active, billingLocked: false });
api/tests/auth/activation-auth.test.ts:78:    setActivation('u3', { active: true, billingLocked: true });
api/tests/auth/activation-auth.test.ts:107:    setActivation('u7', { active: true, billingLocked: false });
api/tests/auth/activation-auth.test.ts:167:    loadActivation([{ userId: 'u5', active: true }]);
api/tests/bridge/revoke.test.ts:58:  setActivation(ownerUserId, { active: true, billingLocked: false });
api/src/auth/service.ts:7:import { setActivation, getActivation, bumpTokenEpoch } from '../data/activation.js';
api/src/auth/service.ts:46: * with `iat < tokenEpoch`; because JWT `iat` has ONE-SECOND granularity, a login in the same
api/src/auth/service.ts:51:export function mintIat(userId: string): number {
api/src/auth/service.ts:53:  return Math.max(nowSec, getActivation(userId)?.tokenEpoch ?? 0);
api/src/auth/service.ts:72:  setActivation(userId, { active: true, billingLocked: false });
api/src/auth/service.ts:87:  setActivation(u._id, { active: u.active, billingLocked: cached?.billingLocked ?? false });
api/src/auth/service.ts:90:    { sub: u._id, role: u.role, scope: 'user', orgId: u.orgId, username: u.username, jti: `${u._id}.${deps.genId()}`, iat: mintIat(u._id) },
api/src/auth/service.ts:121:  bumpTokenEpoch(targetUserId, Math.floor(Date.now() / 1000) + 1);
api/src/auth/service.ts:141:  bumpTokenEpoch(userId, Math.floor(Date.now() / 1000) + 1);
api/src/auth/service.ts:155:  bumpTokenEpoch(userId, Math.floor(Date.now() / 1000) + 1);
api/src/auth/service.ts:180:  setActivation(userId, { active, billingLocked: cur?.billingLocked ?? false, tokenEpoch: active ? cur?.tokenEpoch ?? 0 : epochSec });
api/src/auth/service.ts:187:    if (cur) setActivation(userId, cur);
api/src/auth/device.ts:20:import { authUserView, mintIat, type AuthUserView, type Deps } from './service.js';
api/src/auth/device.ts:103:    { sub: u._id, role: u.role, scope: 'user', orgId: u.orgId, username: u.username, jti: `${u._id}.${deps.genId()}`, iat: mintIat(u._id) },
api/src/auth/users-service.ts:8:import { setActivation, bumpTokenEpoch, clearActivation } from '../data/activation.js';
api/src/auth/users-service.ts:41:  setActivation(id, { active: true, billingLocked: false });
api/src/auth/users-service.ts:60:    bumpTokenEpoch(target._id, Math.floor(Date.now() / 1000) + 1);
api/src/auth/users-service.ts:95:    bumpTokenEpoch(u._id, epochSec);
api/src/auth/jwt.ts:28: *  or the middleware's `iat < tokenEpoch` check rejects it: JWT `iat` has one-second
api/src/auth/middleware.ts:49:  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) {
api/src/auth/middleware.ts:71:  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
api/tests/integrations/routes.contract.test.ts:56:  setActivation(id, { active: true, billingLocked: false });
api/src/server.ts:679:  loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active })));
api/src/data/activation.ts:15:  tokenEpoch: number;
api/src/data/activation.ts:21:export function loadActivation(entries: Array<{ userId: string; active: boolean; billingLocked?: boolean; tokenEpoch?: number }>): void {
api/src/data/activation.ts:23:  for (const e of entries) map.set(e.userId, { active: e.active, billingLocked: e.billingLocked ?? false, tokenEpoch: e.tokenEpoch ?? 0 });
api/src/data/activation.ts:35:export function bumpTokenEpoch(userId: string, epochSec: number): void {
api/src/data/activation.ts:36:  const cur = map.get(userId) ?? { active: true, billingLocked: false, tokenEpoch: 0 };
api/src/data/activation.ts:37:  map.set(userId, { ...cur, tokenEpoch: epochSec });
api/src/data/activation.ts:41: *  `tokenEpoch` is preserved from the existing entry unless explicitly provided. */
api/src/data/activation.ts:42:export function setActivation(userId: string, state: { active: boolean; billingLocked: boolean; tokenEpoch?: number }): void {
api/src/data/activation.ts:44:  map.set(userId, { active: state.active, billingLocked: state.billingLocked, tokenEpoch: state.tokenEpoch ?? prev?.tokenEpoch ?? 0 });
api/tests/contract/chat.test.ts:32:  setActivation('u1', { active: true, billingLocked: false });
api/tests/contract/automations.test.ts:65:  setActivation('admin1', { active: true, billingLocked: false });
api/tests/contract/automations.test.ts:66:  setActivation('b1', { active: true, billingLocked: false });
api/tests/contract/bridge-status.test.ts:36:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/masking-summary.test.ts:27:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/knowledge.test.ts:32:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/branding.test.ts:76:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/integration-builder.test.ts:92:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/jobs-capability.test.ts:45:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/sessions.test.ts:50:  setActivation('u1', { active: true, billingLocked: false });
api/tests/contract/sessions.test.ts:51:  setActivation('u2', { active: true, billingLocked: false });
api/tests/contract/artifact-family.test.ts:58:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/build-failure.test.ts:51:  setActivation('owner1', { active: true, billingLocked: false });
api/tests/contract/build-failure.test.ts:59:  setActivation('owner1', { active: true, billingLocked: false });
api/tests/contract/f5-ui-endpoints.test.ts:46:  setActivation('u1', { active: true, billingLocked: false });
api/tests/contract/app-sso.test.ts:93:  setActivation('owner1', { active: true, billingLocked: false });
api/tests/contract/app-sso.test.ts:94:  setActivation('ownerDead', { active: false, billingLocked: false });
api/tests/contract/app-sso.test.ts:167:    setActivation('owner1', { active: false, billingLocked: false });
api/tests/contract/cross-org.test.ts:29:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/cross-org.test.ts:183:    setActivation('u-h', { active: false, billingLocked: false }); // write-through deactivate
api/tests/contract/integration-definitions.test.ts:47:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/auth.test.ts:39:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/credentials.test.ts:27:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/jobs.test.ts:32:  setActivation('u1', { active: true, billingLocked: false });
api/tests/contract/jobs.test.ts:102:    setActivation('u2', { active: true, billingLocked: false });
api/tests/contract/jobs.test.ts:115:    setActivation('plain1', { active: true, billingLocked: false });
api/tests/contract/registo.test.ts:63:    setActivation(id, { active: true, billingLocked: false });
api/tests/contract/memories.test.ts:44:  setActivation('u1', { active: true, billingLocked: false });
api/tests/contract/triggers-crossorg.test.ts:36:  setActivation('ua', { active: true, billingLocked: false });
api/tests/contract/served-app.test.ts:35:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/served-app.test.ts:105:    setActivation('owner1', { active: true, billingLocked: false });
api/tests/contract/served-app.test.ts:183:    setActivation('owner2', { active: true, billingLocked: false });
api/tests/contract/served-app.test.ts:213:    setActivation('owner1', { active: false, billingLocked: false });
api/tests/contract/served-app.test.ts:218:    setActivation('owner1', { active: true, billingLocked: true });
api/tests/contract/served-app.test.ts:309:    setActivation('owner1', { active: true, billingLocked: false });
api/tests/contract/app-files.test.ts:58:  setActivation('owner1', { active: true, billingLocked: false });
api/tests/contract/app-files.test.ts:139:    setActivation('owner1', { active: false, billingLocked: false });
api/tests/contract/app-files.test.ts:144:    setActivation('owner1', { active: true, billingLocked: true });
api/tests/contract/integrations-knowledge.test.ts:23:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/error-envelope.test.ts:71:    setActivation('u2', { active: true, billingLocked: false });
api/tests/contract/error-envelope.test.ts:82:    setActivation('u1', { active: true, billingLocked: false });
api/tests/contract/mount-coverage.test.ts:135:    setActivation('mc-u', { active: true, billingLocked: false });
api/tests/contract/billing.test.ts:37:  setActivation(id, { active: true, billingLocked: false });
api/tests/contract/denylist.test.ts:44:    setActivation(id, { active: true, billingLocked: false });
api/tests/contract/legal-plane.test.ts:40:  'owner-active': { active: true, billingLocked: false, tokenEpoch: 0 },
api/tests/contract/legal-plane.test.ts:41:  'owner-disabled': { active: false, billingLocked: false, tokenEpoch: 0 },
api/tests/contract/legal-plane.test.ts:42:  'owner-locked': { active: true, billingLocked: true, tokenEpoch: 0 },

exec
/bin/zsh -lc 'git show e2c165e''^:api/src/server.ts | sed -n '"'676,684p'
git show e2c165e:api/src/server.ts | sed -n '676,684p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-HlQsJJui' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-n4lESGMp' (errno=Operation not permitted)
  await connectMongo(); // fail-fast on a bad connection string
  const allUsers = await users.find({});
  loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active })));
  await loadRevocations(Math.floor(deps.now() / 1000));
  await loadCredential(); // G7: load the central model credential (§6.2; no-op when unconfigured)

  // G7B — agent-execution boot obligations (ch08 §8.3.1, ch04 §4.4.1, ch05 §5.2.1). All three are
  // resilient on a fresh/empty data directory: content ingest ensures its dirs, the knowledge
  // backfill ensures the index dir and no-ops on an already-populated index, and the orphan sweep
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-vwnuvhrw' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-cbQowFOM' (errno=Operation not permitted)
export async function bootState(deps: RuntimeDeps = defaultDeps): Promise<void> {
  await connectMongo(); // fail-fast on a bad connection string
  const allUsers = await users.find({});
  loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active })));
  // H1 idempotent migration: rewrite any retired `builder` role → `user` and bump its token epoch
  // (runs after loadActivation so the epoch lands in the in-memory map; no-op once migrated).
  const migratedRoles = await migrateBuilderRole();
  if (migratedRoles > 0) console.log(`[role-migration] builder -> user: ${migratedRoles} user(s) migrated`);
  await loadRevocations(Math.floor(deps.now() / 1000));

codex
The epoch path has a real smell: I’ve confirmed `tokenEpoch` is only ever kept in the in-memory activation map, while boot reload still hydrates just `{ active }`. I’m tracing the follow-up execution path now to see whether the earlier ownership gate can be invalidated before the later artifact re-fetch/build step.
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"resolveFollowUp|prepareFollowUp|artifactId|loadWritable|getVisibleArtifact|getArtifactById|projectDirFor\\(|prepareFirstBuild|prepareFollowUp|follow-up\" api/src/apps api/src/agents -g '"'!node_modules'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/agents/registry.ts:32:  /** Build jobs: the artifact this run targets (follow-up 409 query, §5.3.5). */
api/src/agents/registry.ts:33:  artifactId?: string;
api/src/agents/registry.ts:52:  artifactId?: string;
api/src/agents/registry.ts:65:    artifactId: input.artifactId,
api/src/agents/registry.ts:123:/** True when a run targeting `artifactId` is still live (the follow-up 409 query, §5.3.5). */
api/src/agents/registry.ts:124:export function hasLiveJobForArtifact(artifactId: string): boolean {
api/src/agents/registry.ts:126:    if (e.kind === 'build' && e.artifactId === artifactId && !e.finalized) return true;
api/src/agents/build.ts:2: * Build jobs (ch05 §5.6.2). The §5.2 pipeline plus build specifics: follow-up detection and the
api/src/agents/build.ts:4: * the one-follow-up-per-artifact 409 (§5.3.5), routing floored at the expert tier, the inactivity
api/src/agents/build.ts:67:  artifactId?: string;
api/src/agents/build.ts:86: * respond `created`; follow-ups run the in-build classifier and may respond `answered` with no
api/src/agents/build.ts:87: * job. A concurrent follow-up on the same artifact is `conflict` → the route returns 409
api/src/agents/build.ts:91:  return input.artifactId ? handleFollowUp(input, input.artifactId) : handleFirstBuild(input);
api/src/agents/build.ts:153:async function handleFollowUp(input: BuildCreateInput, artifactId: string): Promise<BuildCreateResult> {
api/src/agents/build.ts:154:  // One follow-up build per artifact (§5.3.5): reject a concurrent build targeting the same
api/src/agents/build.ts:156:  if (hasLiveJobForArtifact(artifactId) || (await nonTerminalJobForArtifact(artifactId))) {
api/src/agents/build.ts:169:    artifactId,
api/src/agents/build.ts:208:    artifactId,
api/src/agents/build.ts:213:  auditBuild(input, 'created', { jobId, artifactId }); // Registo (F3)
api/src/agents/build.ts:217:    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: false, artifactId }),
api/src/agents/build.ts:225:  artifactId?: string;
api/src/agents/build.ts:265:  let artifactId = opts.artifactId ?? '';
api/src/agents/build.ts:276:      if (artifactId) await resetArtifactToDraft(artifactId); // artifact stays draft on error (§5.6.2)
api/src/agents/build.ts:314:    // First-build vs follow-up resolution.
api/src/agents/build.ts:317:      const prep = await mech.prepareFirstBuild({ userId: input.actor.userId, sessionId: input.sessionId, description: input.description, language: input.language, ...(input.templateId ? { templateId: input.templateId } : {}) });
api/src/agents/build.ts:318:      artifactId = prep.artifactId;
api/src/agents/build.ts:323:      if (entry) entry.artifactId = artifactId;
api/src/agents/build.ts:324:      await patchJob(jobId, { artifactId });
api/src/agents/build.ts:326:      const resolved = await mech.resolveFollowUp(artifactId);
api/src/agents/build.ts:336:    // Live build surface: the scaffold (or the existing app, on a follow-up) is served ALREADY —
api/src/agents/build.ts:339:    if (artifactId && appUrl) {
api/src/agents/build.ts:340:      sink.artifact({ artifactId, appUrl, ...(slug ? { slug } : {}) });
api/src/agents/build.ts:341:      if (projectDir) await mech.watchRebuilds({ artifactId, projectDir, onRebuild: () => sink.previewReload() });
api/src/agents/build.ts:346:    sink.routing(decision.tier, opts.firstBuild ? 'first build' : 'follow-up build');
api/src/agents/build.ts:347:    await patchJob(jobId, { routing: { tier: decision.tier, reason: opts.firstBuild ? 'first build' : 'follow-up build' } });
api/src/agents/build.ts:432:      { kind: 'user_work', agentType: 'build', billeeUserId: input.actor.userId, sessionId: input.sessionId, runId: jobId, artifactId },
api/src/agents/build.ts:473:      await mech.persistSdkSessionId(artifactId, capturedSessionId);
api/src/agents/build.ts:477:    const bundle = await mech.finalizeBundle({ artifactId, projectDir });
api/src/agents/build.ts:478:    await mech.snapshot({ artifactId, projectDir, broken: !bundle.ok });
api/src/agents/build.ts:480:    // Step 4: slug — preserved on follow-ups, generated on first builds (already resolved in prep).
api/src/agents/build.ts:488:    const progress = await mech.assertProgress({ artifactId, projectDir });
api/src/agents/build.ts:501:    // pass on a first build; scoped tests + smoke on a follow-up. The runner receives the user's
api/src/agents/build.ts:519:        artifactId,
api/src/agents/build.ts:549:      sink.complete({ result: completionText, artifactId, slug, appUrl }, input.deps.now() - start);
api/src/agents/build.ts:556:    await mech.activateArtifact({ artifactId, slug, appUrl, ...(projectDir ? { projectDir } : {}) });
api/src/agents/build.ts:558:    mech.screenshot(artifactId);
api/src/agents/build.ts:571:      if (artifactId) await resetArtifactToDraft(artifactId);
api/src/agents/build.ts:583:      if (st === 'completed') auditBuild(input, 'completed', { jobId, ...(artifactId ? { artifactId } : {}) });
api/src/apps/artifact-fork.ts:74:  await slugs.put({ _id: slug, artifactId: newId });
api/src/apps/artifact-fork.ts:78:  const sourceDir = projectDirFor(source);
api/src/apps/app-paths.ts:31: * hand back the attacker path. This closes the follow-up build sandbox-escape vector where a
api/src/apps/app-paths.ts:46:export function projectDirFor(art: ArtifactDoc): string {
api/src/apps/app-paths.ts:63:  const bundle = join(projectDirFor(art), 'dist-backend', 'backend.mjs');
api/src/apps/app-paths.ts:88:export async function loadWritable(
api/src/apps/app-paths.ts:111:export async function getArtifactById(id: string): Promise<ArtifactDoc | null> {
api/src/apps/serving.ts:73:interface ServedJobRow extends Doc { status?: string; artifactId?: string; createdAt?: string; error?: { code: string; message: string } }
api/src/apps/serving.ts:82:async function servedBuildDisposition(artifactId: string): Promise<'failed' | 'ok' | 'building'> {
api/src/apps/serving.ts:83:  const rows = (await jobs.find({ artifactId })) as ServedJobRow[];
api/src/apps/serving.ts:516:      const artifactId = getAppIdBySlug(appIdParam) ?? appIdParam;
api/src/apps/serving.ts:517:      const art = (await artifacts.get(artifactId)) as Doc | null;
api/src/apps/serving.ts:523:        .filter((t) => t.appId === artifactId);
api/src/apps/health-scanner.ts:31:  isRegistered?: (artifactId: string) => boolean;
api/src/apps/assistant-tools.ts:83:    artifactId: string;
api/src/apps/assistant-tools.ts:94:    artifactId: input.artifactId,
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
api/src/apps/slug-index.ts:19:export function indexSlug(slug: string, artifactId: string): void {
api/src/apps/slug-index.ts:20:  if (artifactId) index.set(slug, artifactId);
api/src/apps/slug-index.ts:32:    const artifactId = (row as { artifactId?: string }).artifactId;
api/src/apps/slug-index.ts:33:    if (artifactId) index.set(row._id, artifactId);
api/src/apps/versions.ts:143:  artifactId: string,
api/src/apps/versions.ts:149:    await appBuilder.unwatch(artifactId);
api/src/apps/versions.ts:150:    await appBuilder.build(artifactId, params.projectDir);
api/src/apps/versions.ts:152:    console.warn(`[versions] post-restore build failed for ${artifactId}:`, err instanceof Error ? err.message : err);
api/src/apps/versions.ts:155:  backupAppRepoSafe(params.projectDir, { appId: artifactId, appName });
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
api/src/apps/verify-runner.ts:38:/** first build → full acceptance pass; follow-up → scoped tests + smoke pass. */
api/src/apps/verify-runner.ts:40:  artifactId: string;
api/src/apps/verify-runner.ts:63:export function resolveVerifyUrl(appUrl: string, artifactId?: string, ttlMs?: number): string {
api/src/apps/verify-runner.ts:67:  if (!artifactId) return base;
api/src/apps/verify-runner.ts:68:  const token = mintPreviewToken(artifactId, ttlMs ?? 600_000);
api/src/apps/verify-runner.ts:88:        prompt: buildPrompt({ ...input, appUrl: resolveVerifyUrl(input.appUrl, input.artifactId, cfg.verifyWallClockMs + 120_000) }),
api/src/apps/verify-runner.ts:98:      { kind: 'user_work', agentType: 'build-verify', billeeUserId: input.userId, artifactId: input.artifactId },
api/src/apps/verify-runner.ts:120:    console.warn(`[verify] ${input.artifactId}: runner failed:`, raw);
api/src/apps/verify-runner.ts:126: *  build) vs a scoped change + smoke pass (follow-up), per ch07 §7.2.6. F28: the verifier is
api/src/apps/app-assistant.ts:17: *  - Billing is `assistant-chat` (a UserWorkAgentType) billed to the artifact OWNER + artifactId —
api/src/apps/app-assistant.ts:52:  artifactId: string;
api/src/apps/app-assistant.ts:278:  // assistant-chat is a UserWorkAgentType — billed to the ARTIFACT OWNER + artifactId, never the
api/src/apps/app-assistant.ts:284:    artifactId: input.artifactId,
api/src/apps/manifest.ts:63:   * (`base-loader.ts` BASE_IDS). Written by prepareFirstBuild when a base is selected;
api/src/apps/manifest.ts:64:   * read on follow-up builds to re-inject the base's prompt sections. Absent = the
api/src/apps/build-mechanics.ts:97:  /** Load the base an existing artifact extends (manifest `extends`) for follow-up
api/src/apps/build-mechanics.ts:140:    async prepareFirstBuild(input: {
api/src/apps/build-mechanics.ts:146:    }): Promise<{ artifactId: string; projectDir: string; slug: string; appUrl: string; basePromptSections?: string[] }> {
api/src/apps/build-mechanics.ts:148:      const artifactId = deps.genId();
api/src/apps/build-mechanics.ts:153:      await slugs.put({ _id: slug, artifactId });
api/src/apps/build-mechanics.ts:154:      indexSlug(slug, artifactId);
api/src/apps/build-mechanics.ts:156:      const projectDir = newProjectDir(input.userId, artifactId);
api/src/apps/build-mechanics.ts:157:      const appUrl = `/apps/${artifactId}/`;
api/src/apps/build-mechanics.ts:161:        _id: artifactId,
api/src/apps/build-mechanics.ts:175:        appId: artifactId,
api/src/apps/build-mechanics.ts:181:      // Persist the base linkage (manifest `extends`) so follow-up builds and the
api/src/apps/build-mechanics.ts:192:        await appBuilder.build(artifactId, projectDir);
api/src/apps/build-mechanics.ts:193:        await appBuilder.watch(artifactId, projectDir);
api/src/apps/build-mechanics.ts:195:        console.warn(`[build-mechanics] ${artifactId}: initial build/watch failed (non-fatal):`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:197:      await appRegistry.register(artifactId, projectDir, input.userId, name);
api/src/apps/build-mechanics.ts:199:      return { artifactId, projectDir, slug, appUrl, ...(base ? { basePromptSections: base.promptSections } : {}) };
api/src/apps/build-mechanics.ts:203:     *  SDK session id to resume with, and its existing slug + served URL (follow-up completion
api/src/apps/build-mechanics.ts:204:     *  re-activates with these — carrying '' through blanked the slug on every follow-up).
api/src/apps/build-mechanics.ts:206:    async resolveFollowUp(artifactId: string): Promise<{ projectDir: string; resumeSessionId?: string; slug: string; appUrl: string; basePromptSections?: string[] } | null> {
api/src/apps/build-mechanics.ts:207:      const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
api/src/apps/build-mechanics.ts:209:      const projectDir = projectDirFor(art);
api/src/apps/build-mechanics.ts:212:      const appUrl = typeof data.appUrl === 'string' && data.appUrl ? data.appUrl : `/apps/${artifactId}/`;
api/src/apps/build-mechanics.ts:228:    async finalizeBundle(input: { artifactId: string; projectDir: string }): Promise<{ ok: boolean; error?: string }> {
api/src/apps/build-mechanics.ts:229:      await appBuilder.unwatch(input.artifactId);
api/src/apps/build-mechanics.ts:234:        const result = await appBuilder.build(input.artifactId, input.projectDir);
api/src/apps/build-mechanics.ts:252:    async snapshot(input: { artifactId: string; projectDir: string; broken: boolean }): Promise<void> {
api/src/apps/build-mechanics.ts:253:      const art = (await artifacts.get(input.artifactId)) as ArtifactDoc | null;
api/src/apps/build-mechanics.ts:269:        console.warn(`[build-mechanics] ${input.artifactId}: version snapshot failed (non-fatal):`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:276:    screenshot(artifactId: string): void {
api/src/apps/build-mechanics.ts:278:      void captureArtifactScreenshot(artifactId).catch((err) => {
api/src/apps/build-mechanics.ts:280:          `[build-mechanics] ${artifactId}: screenshot capture failed (non-fatal):`,
api/src/apps/build-mechanics.ts:287:    async persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void> {
api/src/apps/build-mechanics.ts:288:      const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
api/src/apps/build-mechanics.ts:291:      await patchArtifactData(artifactId, { sdkSessionId });
api/src/apps/build-mechanics.ts:296:     *  this cleanly replaces the callback-less watcher prepareFirstBuild started, and gives
api/src/apps/build-mechanics.ts:299:    async watchRebuilds(input: { artifactId: string; projectDir: string; onRebuild: () => void }): Promise<void> {
api/src/apps/build-mechanics.ts:301:        await appBuilder.watch(input.artifactId, input.projectDir, input.onRebuild);
api/src/apps/build-mechanics.ts:303:        console.warn(`[build-mechanics] ${input.artifactId}: watch-for-preview failed (non-fatal):`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:309:    async activateArtifact(input: { artifactId: string; slug: string; appUrl: string; projectDir?: string }): Promise<void> {
api/src/apps/build-mechanics.ts:324:            console.warn(`[build-mechanics] ${input.artifactId}: ui_actions invalid — ${res.error}`);
api/src/apps/build-mechanics.ts:328:          console.warn(`[build-mechanics] ${input.artifactId}: ui_actions read failed (non-fatal):`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:343:          const res = await readTours(input.projectDir, { appId: input.artifactId, knownTargets: actionTargets });
api/src/apps/build-mechanics.ts:346:            for (const w of res.warnings) console.warn(`[build-mechanics] ${input.artifactId}: tour warning — ${w}`);
api/src/apps/build-mechanics.ts:348:            console.warn(`[build-mechanics] ${input.artifactId}: tours invalid — ${res.error}`);
api/src/apps/build-mechanics.ts:352:          console.warn(`[build-mechanics] ${input.artifactId}: tours read failed (non-fatal):`, err instanceof Error ? err.message : err);
api/src/apps/build-mechanics.ts:356:      await artifacts.update(input.artifactId, (a) => {
api/src/apps/build-mechanics.ts:381:    async assertProgress(input: { artifactId: string; projectDir: string }): Promise<{ clean: boolean; reasons: string[] }> {
api/src/apps/app-assistant-route.ts:46:  artifactId: string;
api/src/apps/app-assistant-route.ts:111:    req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
api/src/apps/app-assistant-route.ts:148:          artifactId: admission.artifactId,
api/src/apps/artifacts-service.ts:30: * `projectDirFor()` and thus the follow-up build sandbox cwd/HOME (a path-injection →
api/src/apps/artifacts-service.ts:69:  if (await slugs.insert({ _id: base, artifactId: '' })) return base;
api/src/apps/artifacts-service.ts:71:    if (await slugs.insert({ _id: `${base}-${n}`, artifactId: '' })) return `${base}-${n}`;
api/src/apps/artifacts-service.ts:85:  await slugs.put({ _id: slug, artifactId: id }); // point the reservation at the new artifact
api/src/apps/artifacts-service.ts:92:export async function getVisibleArtifact(actor: Actor, id: string): Promise<ArtifactDoc | null> {
api/src/apps/artifacts-service.ts:101:    const ok = await slugs.insert({ _id: patch.slug, artifactId: id });
api/src/apps/registry.ts:25:  // Try slug first (the slugs reservation collection maps slug → artifactId).
api/src/apps/registry.ts:27:  const artifactId = slugRow ? (slugRow.artifactId as string) : idOrSlug;
api/src/apps/registry.ts:28:  const art = await artifacts.get(artifactId);
api/src/apps/artifact-bundle.ts:89:  const projectDir = projectDirFor(art);
api/src/apps/artifact-bundle.ts:139:  await slugs.put({ _id: slug, artifactId: newId });
api/src/apps/artifact-bundle.ts:205:  const projectDir = projectDirFor(art);
api/src/agents/guided-build.ts:29: * In-build message classifier for follow-ups (§5.6.2). Runs before any build work under the
api/src/agents/guided-build.ts:38:      'Classify this follow-up message about an app being built. Answer with ONE word: "modification" (change the app), "integration" (connect an external service), or "question" (a question or meta comment).',
api/src/apps/backend-runtime/index.ts:29:  artifactId: string,
api/src/apps/backend-runtime/index.ts:34:  return getArtifactBackendRuntime().invoke(artifactId, entrypoint, input, opts);
api/src/apps/backend-runtime/index.ts:40:    const manifest = await readManifest(projectDirFor(art));
api/src/apps/featured-seeder.ts:149:      await slugs.put({ _id: slug, artifactId: manifest.id });
api/src/apps/featured-seeder.ts:175:    await slugs.put({ _id: manifest.id, artifactId: manifest.id });
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
api/src/apps/backend-runtime/runtime.ts:536:        const m = await readManifest(projectDirFor(art as never));
api/src/apps/backend-runtime/runtime.ts:541:    resolveBundlePath: async (artifactId) => {
api/src/apps/backend-runtime/runtime.ts:544:      const art = await artifacts.get(artifactId);
api/src/apps/backend-runtime/handle-rpc.ts:17: *   1. appId is FIXED by the token (`claims.artifactId`) - a worker can pass any
api/src/apps/backend-runtime/handle-rpc.ts:33:  artifactId: string;
api/src/apps/backend-runtime/handle-rpc.ts:78:  isLive(artifactId: string): boolean;
api/src/apps/backend-runtime/handle-rpc.ts:96:    if (typeof p.artifactId !== 'string' || typeof p.ownerUserId !== 'string') return null;
api/src/apps/backend-runtime/handle-rpc.ts:98:      artifactId: p.artifactId,
api/src/apps/backend-runtime/handle-rpc.ts:128:  if (!ctx.isLive(claims.artifactId)) throw new Error('artifact backend capability has been revoked');
api/src/apps/backend-runtime/handle-rpc.ts:129:  const appId = claims.artifactId; // FIXED by core.
api/src/apps/backend-runtime/handle-rpc.ts:181:        type: 'artifact_notification', artifactId: appId, notificationId: row.id, title: detail.title, body: detail.body,
api/src/agents/streaming.ts:117:  artifact(payload: { artifactId: string; appUrl: string; slug?: string }): void {
api/src/agents/streaming.ts:120:  complete(payload: { result?: unknown; artifactId?: string; slug?: string; appUrl?: string }, durationMs: number): void {
api/src/agents/streaming.ts:131:export function emitBuildIntent(userId: string, ev: { sessionId: string; sourceRunId: string; request: { description: string; artifactId?: string } }): void {
api/src/agents/seams.ts:251:  artifactId: string;
api/src/agents/seams.ts:255:  /** first build → full acceptance pass; follow-up → scoped tests + smoke pass. */
api/src/agents/seams.ts:292:  artifactId: string;
api/src/agents/seams.ts:307:   *  with these — pre-fix, build.ts carried '' through and blanked the slug on every follow-up. */
api/src/agents/seams.ts:311:   *  follow-up builds keep the base conventions in the system prompt. Absent when the
api/src/agents/seams.ts:323:  prepareFirstBuild(input: { userId: string; sessionId: string; description: string; language: string; templateId?: string }): Promise<FirstBuildPrep>;
api/src/agents/seams.ts:324:  resolveFollowUp(artifactId: string): Promise<FollowUpResolution | null>;
api/src/agents/seams.ts:326:  finalizeBundle(input: { artifactId: string; projectDir: string }): Promise<{ ok: boolean; error?: string }>;
api/src/agents/seams.ts:328:  snapshot(input: { artifactId: string; projectDir: string; broken: boolean }): Promise<void>;
api/src/agents/seams.ts:330:  screenshot(artifactId: string): void;
api/src/agents/seams.ts:332:  persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void>;
api/src/agents/seams.ts:334:  activateArtifact(input: { artifactId: string; slug: string; appUrl: string; projectDir?: string }): Promise<void>;
api/src/agents/seams.ts:338:  watchRebuilds(input: { artifactId: string; projectDir: string; onRebuild: () => void }): Promise<void>;
api/src/agents/seams.ts:346:  assertProgress(input: { artifactId: string; projectDir: string }): Promise<{ clean: boolean; reasons: string[] }>;
api/src/agents/seams.ts:350:  async prepareFirstBuild(input) {
api/src/agents/seams.ts:351:    return { artifactId: `art_${input.sessionId}`, projectDir: '', slug: 'app', appUrl: '' };
api/src/agents/seams.ts:353:  async resolveFollowUp() {

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
The follow-up path does re-fetch the artifact later, and right now that second fetch is raw `artifacts.get()`. I’m checking whether any concurrent write can alter `orgId`/`userId`/visibility between the route check and execution, because that would turn the earlier `loadWritable` gate into a TOCTOU.
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"ArtifactPatch|visibility|userId|orgId|owner|transfer\" shared/src api/src/routes api/src/apps -g '"'!node_modules'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/src/apps/artifact-fork.ts:77:  const projectDir = newProjectDir(newOwner.userId, newId);
api/src/apps/artifact-fork.ts:93:    userId: newOwner.userId,
api/src/apps/artifact-fork.ts:94:    orgId: newOwner.orgId,
api/src/apps/artifact-fork.ts:95:    visibility: 'private',
api/src/apps/artifact-fork.ts:110:      await appRegistry.register(newId, projectDir, newOwner.userId, baseName);
api/src/apps/served-data.ts:19: * Origin header is refused so the global CORS `*` cannot exfiltrate an owner's
api/src/apps/served-data.ts:21: * and server-side owner resolution (never a client-supplied account id).
api/src/apps/served-data.ts:25: * A deactivated owner's apps refuse with the CONV-2 envelope - 403 ACCOUNT_DISABLED
api/src/apps/served-data.ts:26: * or 402 BILLING_LOCKED - and an owner with no activation record fails CLOSED
api/src/apps/served-data.ts:85:  /** Amendment 2 second admission plane: when an ARTIFACT backs the app, its owner's
api/src/apps/served-data.ts:86:   *  activation gates service (fail-closed CONV-2). Apps with no artifact owner (dev-
api/src/apps/served-data.ts:91:    const activation = getActivation(app.ownerUserId);
api/src/apps/served-data.ts:107:    // carried), but a resolved artifact still gates on its owner's activation.
api/src/apps/served-data.ts:118:    // Shared namespace REQUIRES a resolved owner - guards carried verbatim.
api/src/apps/served-data.ts:131:    if (!app.ownerUserId || !collectionName.safeParse(app.ownerUserId).success) {
api/src/apps/served-data.ts:132:      res.status(403).json({ error: 'shared data unavailable: owner unresolved' });
api/src/apps/served-data.ts:135:    return sharedScope(app.appId, app.ownerUserId);
api/src/apps/serving.ts:6: * only (revoked -> 410 PT page, owner bypass via Authorization header / ekoa_token
api/src/apps/serving.ts:23: * Auth is NOT imported here (module tiers, ch02 §2.7): the owner-bypass token
api/src/apps/serving.ts:169:    // `data` is a client-writable bag (ArtifactPatch permits `data`), so a raw
api/src/apps/serving.ts:205:    await appRegistry.register(resolvedId, projectDir, artifact.userId as string, artifact.name as string);
api/src/apps/serving.ts:343:              if (artifact && artifact.userId === claims.sub) isOwner = true;
api/src/apps/serving.ts:345:              /* invalid token -> not the owner */
api/src/apps/app-registry.ts:3: * and the metadata static serving needs: distDir, projectDir, userId, name, manifest.
api/src/apps/app-registry.ts:28:  userId: string;
api/src/apps/app-registry.ts:47:  async register(appId: string, projectDir: string, userId?: string, name?: string): Promise<void> {
api/src/apps/app-registry.ts:59:    const resolvedUserId = userId || extractUserIdFromPath(projectDir);
api/src/apps/app-registry.ts:67:      userId: resolvedUserId,
api/src/apps/app-registry.ts:122:      const userId = userDir.replace('user-', '');
api/src/apps/app-registry.ts:133:          if (manifest) await this.register(manifest.id, projectPath, userId, manifest.name);
api/src/apps/app-registry.ts:214:/** Extract the owner id from a sandbox path like .../sandboxes/user-abc123/project. */
api/src/apps/manifest.ts:83:   * Opt in to the per-owner SHARED app-data namespace. When `true`, the served
api/src/apps/registry.ts:13:  ownerUserId: string;
api/src/apps/registry.ts:17:   *  owner, so the Amendment 2 owner-activation admission has no subject and the
api/src/apps/registry.ts:32:      ownerUserId: (art.userId as string) ?? '',
api/src/apps/registry.ts:46:    ownerUserId: reg.userId,
api/src/routes/auth.ts:34:    res.json({ id: u.sub, username: u.username, role: u.role, orgId: u.orgId, active: true });
api/src/routes/auth.ts:42:      { sub: u.sub, role: u.role, scope: u.scope, orgId: u.orgId, username: u.username, jti: `${u.sub}.${deps.genId()}` },
api/src/routes/auth.ts:48:  // F1: logout. Self: revoke the CALLER's jti. Admin variant { userId }: super-admin anywhere,
api/src/routes/auth.ts:55:    const targetId = body.userId && body.userId !== caller.sub ? body.userId : undefined;
api/src/apps/artifacts-service.ts:2: * Artifacts service (ch03 §3.8.9). Owner+visibility scoped (private|org). Slug uniqueness via
api/src/apps/artifacts-service.ts:4: * of owner. Deterministic slug generation (no model call — FIXED-3, ch07 §7.8).
api/src/apps/artifacts-service.ts:15:  userId: string;
api/src/apps/artifacts-service.ts:16:  orgId: string;
api/src/apps/artifacts-service.ts:17:  visibility: 'private' | 'org';
api/src/apps/artifacts-service.ts:59:  return { id: a._id, name: a.name, slug: a.slug, userId: a.userId, orgId: a.orgId, visibility: a.visibility, featured: !!a.featured, shareable: !!a.shareable, status: a.status, screenshotUrl: getArtifactScreenshotUrl(a._id) };
api/src/apps/artifacts-service.ts:82:export async function createArtifact(actor: Actor, input: { name: string; visibility?: 'private' | 'org' }, deps: Deps): Promise<ArtifactDoc> {
api/src/apps/artifacts-service.ts:87:  const doc: ArtifactDoc = { _id: id, name: input.name, slug, userId: actor.userId, orgId: actor.orgId, visibility: input.visibility ?? 'private', status: 'draft' };
api/src/apps/build-link.ts:26:  verifyToken: (token: string) => { sub: string; orgId: string; role: Actor['role'] };
api/src/apps/build-link.ts:68:    let claims: { sub: string; orgId: string; role: Actor['role'] } | null = null;
api/src/apps/build-link.ts:79:      const actor: Actor = { userId: claims.sub, orgId: claims.orgId, role: claims.role };
shared/src/auth.ts:17:    orgId: z.string(),
shared/src/auth.ts:87:  userId: z.string().optional(),
shared/src/auth.ts:140:    // `user` first). The `{ userId }` admin variant requires elevation — super-admin
api/src/apps/app-paths.ts:2: * Shared project-directory resolution + artifact ownership helpers for the
api/src/apps/app-paths.ts:8: * A registered app lives at `<sandboxRoot>/user-<userId>/<appId>` unless the row
api/src/apps/app-paths.ts:24:  return join(sandboxRoot(), `user-${art.userId}`, art._id);
api/src/apps/app-paths.ts:30: * through the owner sandbox jail (ch09 invariant 10, FIXED-8) and drop it if it escapes — never
api/src/apps/app-paths.ts:57:export function newProjectDir(ownerUserId: string, appId: string): string {
api/src/apps/app-paths.ts:58:  return join(sandboxRoot(), `user-${ownerUserId}`, appId);
api/src/apps/app-paths.ts:70: * Load an artifact the actor may READ: own (any visibility) or org-shared. A
api/src/apps/app-paths.ts:72: * (ownership-mismatch parity, ch04). Mirrors OwnerVisibilityScoped.getVisible.
api/src/apps/app-paths.ts:77:  if (art.orgId !== actor.orgId) return null;
api/src/apps/app-paths.ts:78:  if (art.userId === actor.userId) return art;
api/src/apps/app-paths.ts:79:  if (art.visibility === 'org') return art;
api/src/apps/app-paths.ts:93:  if (!art || art.orgId !== actor.orgId) return { verdict: 'notfound' };
api/src/apps/app-paths.ts:94:  if (art.userId === actor.userId) return { verdict: 'ok', art };
api/src/apps/app-paths.ts:95:  if (art.visibility === 'org') return { verdict: 'ok', art };
api/src/routes/sessions.ts:3: * User-scoped: ownership mismatch → uniform not-found.
api/src/routes/sessions.ts:16:  const audActor = (req: AuthedRequest) => ({ userId: actorOf(req).userId, username: req.user!.username, orgId: actorOf(req).orgId });
api/src/routes/sessions.ts:19:    res.json({ items: (await listSessions(actorOf(req).userId)).map(sessionView) });
api/src/routes/sessions.ts:25:    res.status(201).json(sessionView(await createSession(actorOf(req).userId, body, deps, audActor(req))));
api/src/routes/sessions.ts:29:    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
api/src/routes/sessions.ts:37:    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
api/src/routes/sessions.ts:44:    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
api/src/routes/sessions.ts:51:    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
api/src/routes/sessions.ts:59:    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
api/src/apps/backend-runtime/handle-rpc.ts:19: *   2. Billing/owner is FIXED to `claims.ownerUserId` - the worker cannot choose
api/src/apps/backend-runtime/handle-rpc.ts:34:  ownerUserId: string;
api/src/apps/backend-runtime/handle-rpc.ts:46:  ownerUserId: string;
api/src/apps/backend-runtime/handle-rpc.ts:61:  /** MODEL seam (G7). Default stub throws; owner/billing fixed core-side. */
api/src/apps/backend-runtime/handle-rpc.ts:64:  sendToUser(userId: string, event: { type: string; [k: string]: unknown }): void;
api/src/apps/backend-runtime/handle-rpc.ts:66:  sendEmail(ownerUserId: string, args: { to: string[]; subject: string; body: string; bodyContentType?: string }): Promise<{ success: boolean; error?: string }>;
api/src/apps/backend-runtime/handle-rpc.ts:68:  runIntegration?(opts: { key: string; action: string; args: Record<string, unknown>; userId: string }): Promise<unknown>;
api/src/apps/backend-runtime/handle-rpc.ts:96:    if (typeof p.artifactId !== 'string' || typeof p.ownerUserId !== 'string') return null;
api/src/apps/backend-runtime/handle-rpc.ts:99:      ownerUserId: p.ownerUserId,
api/src/apps/backend-runtime/handle-rpc.ts:110:/** The owner-shared scope key `usr.<owner>` (matches the served plane's sharedScope). */
api/src/apps/backend-runtime/handle-rpc.ts:115:  return `usr.${claims.ownerUserId}`;
api/src/apps/backend-runtime/handle-rpc.ts:160:    // MODEL seam - always runs (owner pays; worker cannot choose billee/tier).
api/src/apps/backend-runtime/handle-rpc.ts:166:        ownerUserId: claims.ownerUserId,
api/src/apps/backend-runtime/handle-rpc.ts:172:    // NOTIFY seam (scoped to owner; suppressed in dry-run).
api/src/apps/backend-runtime/handle-rpc.ts:180:      deps.sendToUser(claims.ownerUserId, {
api/src/apps/backend-runtime/handle-rpc.ts:189:      const r = await deps.sendEmail(claims.ownerUserId, {
api/src/apps/backend-runtime/handle-rpc.ts:204:      return deps.runIntegration({ key, action, args: callArgs, userId: claims.ownerUserId });
api/src/routes/bridge.ts:31:  // FC-401/FC-405 presence (ch18 §18.3.3): owner-scoped, derived from the pairing registry
api/src/routes/bridge.ts:35:    const owner = req.user!.sub;
api/src/routes/bridge.ts:36:    const liveConn = getConnectionByOwner(owner);
api/src/routes/bridge.ts:46:    const rows = await getPairingsByOwner(owner);
api/src/routes/registo.ts:26:    const q = req.query as { userId?: string; type?: string; orgId?: string; limit?: string; offset?: string };
api/src/routes/registo.ts:28:      userId: q.userId,
api/src/routes/registo.ts:30:      orgId: q.orgId,
api/src/apps/artifact-bundle.ts:133:  owner: Actor,
api/src/apps/artifact-bundle.ts:142:  const projectDir = newProjectDir(owner.userId, newId);
api/src/apps/artifact-bundle.ts:152:    userId: owner.userId,
api/src/apps/artifact-bundle.ts:153:    orgId: owner.orgId,
api/src/apps/artifact-bundle.ts:154:    visibility: 'private',
api/src/apps/artifact-bundle.ts:167:    await appRegistry.register(newId, projectDir, owner.userId, name);
api/src/apps/artifact-bundle.ts:257:      await appRegistry.register(art._id, projectDir, art.userId, updated.name);
shared/src/registo.ts:18:  userId: Id.optional(),
shared/src/registo.ts:24:  orgId: Id.optional(),
api/src/routes/triggers.ts:35:    // execution on delivery (the engine/runtime trusts the trigger owner). Both target kinds are
api/src/routes/users.ts:22:    const body = parseBody(res, CreateUserRequest, req.body) as { username: string; password: string; role: Role; orgId?: string } | undefined;
api/src/routes/users.ts:35:    if (a.role === 'org-admin' && target.orgId !== a.orgId) return notFound(res); // cross-org → uniform 404
api/src/apps/backend-runtime/runtime.ts:122:  resolveOwner(artifactId: string): Promise<{ ownerUserId: string; sharedData?: boolean } | null>;
api/src/apps/backend-runtime/runtime.ts:207:    const owner = await this.deps.resolveOwner(artifactId);
api/src/apps/backend-runtime/runtime.ts:209:    if (!owner) return { ok: false, error: `artifact no longer exists: ${artifactId}`, logs: [] };
api/src/apps/backend-runtime/runtime.ts:213:    const ownerUserId = owner.ownerUserId;
api/src/apps/backend-runtime/runtime.ts:233:      { artifactId, ownerUserId, sharedData: Boolean(owner.sharedData), scopes: ['appData', 'llm', 'notify'], entrypoint, dryRun },
api/src/apps/backend-runtime/runtime.ts:539:      return { ownerUserId: (art.userId as string) ?? '', sharedData };
api/src/routes/credentials.ts:24:        { userId: actor.userId, username: req.user!.username, orgId: actor.orgId },
api/src/routes/billing.ts:35:    res.json(await usageFor(actorOf(req).userId, deps.now()));
api/src/routes/billing.ts:41:    res.json(await historyFor(actorOf(req).userId, { limit, offset }));
api/src/routes/billing.ts:50:    res.json(await addCredits(actorOf(req).userId, body.amountUsd, deps.now()));
api/src/routes/billing.ts:56:    res.json(await setOverage(actorOf(req).userId, body.enabled, deps.now()));
api/src/routes/billing.ts:74:  r.post('/admin/usage/:userId/reset', superAdmin, async (req: AuthedRequest, res: Response) => {
api/src/routes/billing.ts:75:    res.json(await adminResetUsage(req.params.userId as string, deps.now()));
api/src/routes/billing.ts:78:  r.put('/admin/limits/:userId', superAdmin, async (req: AuthedRequest, res: Response) => {
api/src/routes/billing.ts:81:    res.json(await adminSetLimit(req.params.userId as string, body.tokenLimit, deps.now()));
api/src/apps/dev-serve.ts:81:      .filter((a) => a.userId === DEV_SERVE_OWNER)
api/src/routes/jobs.ts:28:    if (job && job.userId !== auth.claims.sub) {
api/src/routes/jobs.ts:41:    // Capability + ownership gates BEFORE any job is created or agent spawned (H1). Refusals carry
api/src/routes/jobs.ts:43:    // request-to-admin flow consumes); object-ownership denials carry no capability field.
api/src/routes/jobs.ts:85:    if (!job || (job.userId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
api/src/routes/org.ts:14:  return { userId: a.userId, username: req.user!.username, orgId: a.orgId };
api/src/routes/org.ts:22:    const o = await getOrg(actorOf(req).orgId);
api/src/routes/org.ts:30:    const updated = await updateOrg(actorOf(req).orgId, body as Record<string, unknown>);
api/src/routes/org.ts:42:    res.json({ items: await listDenyList(actorOf(req).orgId) });
api/src/routes/org.ts:48:    const entry = await addDenyListEntry(actorOf(req).orgId, body.value, body.entityClass ?? 'PARTY', activityActorOf(req), deps);
api/src/routes/org.ts:53:    const removed = await removeDenyListEntry(actorOf(req).orgId, req.params.id as string, activityActorOf(req), deps);
api/src/routes/org.ts:69:  const orgId = actorOf(req).orgId;
api/src/routes/org.ts:70:  const org = await getOrg(orgId);
api/src/routes/org.ts:73:  const updated = await updateOrg(orgId, { branding: merged, ...(body.displayName ? { displayName: body.displayName } : {}) });
api/src/routes/org.ts:85:    res.status(201).json(orgView(await createOrg(body, deps, { userId: actorOf(req).userId, username: req.user!.username, orgId: actorOf(req).orgId })));
shared/src/artifacts.ts:18:    userId: Id,
shared/src/artifacts.ts:19:    orgId: Id,
shared/src/artifacts.ts:20:    visibility: Visibility,
shared/src/artifacts.ts:39:export const ArtifactPatch = z.object({
shared/src/artifacts.ts:44:  visibility: Visibility.optional(),
shared/src/artifacts.ts:46:export type ArtifactPatch = z.infer<typeof ArtifactPatch>;
shared/src/artifacts.ts:247:    request: ArtifactPatch,
shared/src/automations.ts:53:    ownerId: Id.optional(),
shared/src/automations.ts:54:    orgId: Id.optional(),
shared/src/automations.ts:55:    visibility: Visibility.optional(),
shared/src/automations.ts:67:    visibility: Visibility.optional(),
shared/src/automations.ts:78:    visibility: Visibility.optional(),
shared/src/automations.ts:136:    ownerId: Id.optional(),
shared/src/automations.ts:137:    orgId: Id.optional(),
shared/src/billing.ts:29:    userId: Id,
shared/src/billing.ts:87:  userId: Id,
shared/src/billing.ts:96:  userId: Id,
shared/src/billing.ts:150:    path: '/api/v1/billing/admin/usage/:userId/reset',
shared/src/billing.ts:156:    path: '/api/v1/billing/admin/limits/:userId',
api/src/routes/chat.ts:25:    if (entry && entry.ownerUserId !== auth.claims.sub) {
api/src/routes/chat.ts:63:    if (!entry || (entry.ownerUserId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
api/src/routes/integration-builder.ts:169:    let session = await findSessionForKey(actor.userId, integrationKey);
api/src/routes/integration-builder.ts:195:    const session = body.builderSessionId ? await getOwnedSession(actor.userId, body.builderSessionId) : null;
api/src/routes/integration-builder.ts:216:      const existing = await findConfigForOwner(actor.orgId, actor.userId, key);
api/src/routes/integration-builder.ts:233:    const session = await getOwnedSession(actor.userId, body.builderSessionId);
shared/src/memories.ts:19:    userId: Id.optional(),
shared/src/memories.ts:20:    orgId: Id,
shared/src/memories.ts:21:    visibility: Visibility,
shared/src/memories.ts:39:  visibility: Visibility.optional(),
shared/src/memories.ts:52:  visibility: Visibility.optional(),
shared/src/memories.ts:70:  visibility: Visibility.optional(),
api/src/routes/automations.ts:73:  // Visibility = the run's owner or an org admin (the service's canSeeRun via getRunRecord).
api/src/routes/automations.ts:77:    const actor: Actor = { userId: auth.claims.sub, orgId: auth.claims.orgId, role: auth.claims.role };
api/src/routes/automations.ts:96:    const org = await getOrg(actor.orgId);
api/src/routes/automations.ts:160:    const org = await getOrg(actor.orgId);
shared/src/common.ts:29:/** Org sharing visibility (Amendment 2): default private. */
shared/src/common.ts:41:  userId: string;
shared/src/common.ts:42:  orgId: string;
shared/src/users.ts:11:  orgId: z.string().optional(),
api/src/routes/settings.ts:16:    res.json(await mergedSettings(a.userId, a.orgId));
api/src/routes/settings.ts:23:    await patchOrgSettings(a.orgId, body as Record<string, unknown>);
api/src/routes/settings.ts:24:    res.json(await mergedSettings(a.userId, a.orgId));
api/src/routes/settings.ts:31:    await patchUserSettings(a.userId, body as Record<string, unknown>);
api/src/routes/settings.ts:32:    res.json(await mergedSettings(a.userId, a.orgId));
api/src/routes/platform-integrations.ts:68:    const result = await connectPlatform({ userId: u.sub, orgId: u.orgId, username: u.username }, req.params.provider as string, oauthDeps);
api/src/routes/platform-integrations.ts:80:    await disconnectPlatform({ userId: u.sub, orgId: u.orgId, username: u.username }, provider, oauthDeps);
shared/src/ekoa-local.ts:148:export const AllowanceRef = z.object({ userId: z.string() }).passthrough();
api/src/apps/share-lookup.ts:7: *   { kind: 'revoked' }    - resolves to a real artifact whose owner flipped
shared/src/contract.test.ts:176:    const base = { id: 'u1', username: 'a', role: 'user', orgId: 'o1', active: true };
shared/src/contract.test.ts:197:      task: 'read', budget: { egressBytes: 1000, modelSpend: { userId: 'u' } }, expiry: '2026-07-08T00:00:00Z', nonce: 'n', sig: 'x',
shared/src/contract.test.ts:201:    expect(DelegatedTask.safeParse({ ...base, budget: { egressBytes: Infinity, modelSpend: { userId: 'u' } } }).success).toBe(false);
shared/src/contract.test.ts:203:    expect(() => canonicalTaskBinding({ ...base, budget: { egressBytes: Infinity, modelSpend: { userId: 'u' } } } as never)).toThrow(/non-finite/);
shared/src/contract.test.ts:205:    const a = canonicalTaskBinding({ ...base, budget: { egressBytes: 1000, modelSpend: { userId: 'u' } } });
shared/src/contract.test.ts:206:    const b = canonicalTaskBinding({ ...base, budget: { egressBytes: 2000, modelSpend: { userId: 'u' } } });
shared/src/served-app.ts:29:  // Owner-shared data (/api/app-shared/:collection[/:id]), header + server-side owner-scope resolution.
api/src/apps/app-data-access.ts:11: *   - shared scope:    scopeKey === `usr.<ownerUserId>`       (window.__ekoa.shared)
api/src/apps/app-data-access.ts:34:/** Build the engine scope for a raw scope key (per-app id OR `usr.<owner>`). */
api/src/apps/artifact-featured-update.ts:48:  return recordedProjectDir(data) ?? newProjectDir(art.userId, art._id);
api/src/apps/artifact-featured-update.ts:155:    await appRegistry.register(artifactId, workingDir, art.userId, art.name);
api/src/apps/featured-builder.ts:200:  // userId='system' marks these registrations as platform-owned.
api/src/apps/versions.ts:46:/** Confine the repo path to the owner sandbox and assert it is a directory. */
api/src/apps/verify-runner.ts:43:  userId: string;
api/src/apps/verify-runner.ts:59: *  through untouched. A draft, non-shareable artifact's DOCUMENT is owner-gated (§7.7), so the
api/src/apps/verify-runner.ts:98:      { kind: 'user_work', agentType: 'build-verify', billeeUserId: input.userId, artifactId: input.artifactId },
api/src/routes/memories.ts:33:      byVisibility: tally((m) => m.visibility),
api/src/apps/build-mechanics.ts:49:  /** Resolve a user's org (private artifacts still carry orgId for tenancy). Best-effort: an
api/src/apps/build-mechanics.ts:50:   *  unresolved user yields '' rather than failing the build. The seam does not thread orgId
api/src/apps/build-mechanics.ts:51:   *  (it passes only userId), so the composition root resolves it here — a documented adapter. */
api/src/apps/build-mechanics.ts:52:  async function orgIdFor(userId: string): Promise<string> {
api/src/apps/build-mechanics.ts:54:      return (await users.get(userId))?.orgId ?? '';
api/src/apps/build-mechanics.ts:79:    userId: string,
api/src/apps/build-mechanics.ts:88:    const artifactType = await classifyArtifactType(description, userId);
api/src/apps/build-mechanics.ts:141:      userId: string;
api/src/apps/build-mechanics.ts:147:      const { base, artifactType } = await baseFor(input.templateId, input.description, input.userId);
api/src/apps/build-mechanics.ts:156:      const projectDir = newProjectDir(input.userId, artifactId);
api/src/apps/build-mechanics.ts:158:      const orgId = await orgIdFor(input.userId);
api/src/apps/build-mechanics.ts:164:        userId: input.userId,
api/src/apps/build-mechanics.ts:165:        orgId,
api/src/apps/build-mechanics.ts:166:        visibility: 'private',
api/src/apps/build-mechanics.ts:197:      await appRegistry.register(artifactId, projectDir, input.userId, name);
api/src/apps/build-mechanics.ts:254:      const userId = art?.userId ?? '';
api/src/apps/build-mechanics.ts:255:      const username = (userId ? (await users.get(userId))?.username : undefined) || userId || 'ekoa-agent';
api/src/apps/build-mechanics.ts:261:          authorEmail: `${userId || 'agent'}@ekoa.local`,
api/src/apps/build-mechanics.ts:263:          ...(userId && art
api/src/apps/build-mechanics.ts:264:            ? { audit: { actor: { userId, username, orgId: art.orgId }, deps } }
api/src/apps/app-assistant.ts:14: *  - The org is ALWAYS the resolved owner's org (`input.owner.orgId`) — never anything the
api/src/apps/app-assistant.ts:16: *    it (the served-app "orgId from the resolved subject, not from arguments" rule).
api/src/apps/app-assistant.ts:23: *    = owner activation, enforced at the route).
api/src/apps/app-assistant.ts:38:  /** The artifact owner — who the assistant runs as and who is billed. */
api/src/apps/app-assistant.ts:39:  userId: string;
api/src/apps/app-assistant.ts:40:  /** The owner's org — the ONLY org the assistant ever grounds under (server-resolved). */
api/src/apps/app-assistant.ts:41:  orgId: string;
api/src/apps/app-assistant.ts:51:  owner: AppAssistantOwner;
api/src/apps/app-assistant.ts:251: * through the injected chokepoint one-shot billed to the owner, and returns the prose reply (with
api/src/apps/app-assistant.ts:265:  // Grounding ALWAYS under the resolved owner's org (never a caller-supplied org); kind:'chat'
api/src/apps/app-assistant.ts:267:  const grounding = deps.ground({ orgId: input.owner.orgId, query: input.message, kind: 'chat' });
api/src/apps/app-assistant.ts:283:    billeeUserId: input.owner.userId,
api/src/apps/app-assistant-route.ts:8: * a resolved artifact-backed owner — it has to run under that owner's org and bill that owner — so
api/src/apps/app-assistant-route.ts:16: * owner — never from the anonymous visitor's body. The billing allowance gate is billed to that
api/src/apps/app-assistant-route.ts:17: * same owner (the served-app assistant is a named synchronous entry in billing/allowance.ts).
api/src/apps/app-assistant-route.ts:45:  owner: { userId: string; orgId: string };
api/src/apps/app-assistant-route.ts:54: *  rides the knowledge/ builder; the tier is floored at WORKHORSE like chat (D1 owner-org grounding
api/src/apps/app-assistant-route.ts:66:   * Served-app admission (mirrors served-data's headerFor + admitOwner, then resolves the owner org
api/src/apps/app-assistant-route.ts:82:    // The assistant needs a real owner subject (org to ground under, user to bill). A dev-serve /
api/src/apps/app-assistant-route.ts:84:    if (!app || !app.artifactBacked || !app.ownerUserId) {
api/src/apps/app-assistant-route.ts:90:    const activation = getActivation(app.ownerUserId);
api/src/apps/app-assistant-route.ts:100:    // Owner org — resolved server-side from the owner user record, NEVER from the visitor's body.
api/src/apps/app-assistant-route.ts:101:    const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
api/src/apps/app-assistant-route.ts:102:    const orgId = owner?.orgId ?? '';
api/src/apps/app-assistant-route.ts:111:    req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
api/src/apps/app-assistant-route.ts:124:  const allowance = allowanceMiddleware((req) => (req as AssistantRequest).ekoaAssistant?.owner.userId);
api/src/apps/app-assistant-route.ts:147:          owner: admission.owner,
api/src/routes/helpers.ts:13:  return { userId: u.sub, orgId: u.orgId, role: u.role };
api/src/apps/featured-seeder.ts:53:async function getSuperAdmin(): Promise<{ id: string; orgId: string } | null> {
api/src/apps/featured-seeder.ts:56:  return sa ? { id: sa._id, orgId: (sa.orgId as string) ?? 'system' } : null;
api/src/apps/featured-seeder.ts:158:      userId: superAdmin?.id ?? 'system',
api/src/apps/featured-seeder.ts:159:      orgId: superAdmin?.orgId ?? 'system',
api/src/apps/featured-seeder.ts:160:      visibility: 'org',
api/src/routes/artifacts.ts:10:  ArtifactPatch,
api/src/routes/artifacts.ts:46:const CreateArtifact = z.object({ name: z.string(), visibility: z.enum(['private', 'org']).optional() });
api/src/routes/artifacts.ts:54:    actor: { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId },
api/src/routes/artifacts.ts:80:    const body = parseBody(res, CreateArtifact, req.body) as { name: string; visibility?: 'private' | 'org' } | undefined;
api/src/routes/artifacts.ts:106:    const body = parseBody(res, ArtifactPatch, req.body) as Record<string, unknown> | undefined;
api/src/apps/app-files.ts:105: *  namespace); gate a resolved artifact owner's activation. Writes the error response
api/src/apps/app-files.ts:108: *  featured apps alike work; a resolved artifact still gates on its owner's activation. */
api/src/apps/app-files.ts:115:  // Second admission plane (Amendment 2): the ARTIFACT owner's activation gates
api/src/apps/app-files.ts:116:  // service, fail-closed CONV-2. Apps with no artifact owner (dev-serve or a raw
api/src/apps/app-files.ts:119:    const activation = getActivation(app.ownerUserId);
api/src/routes/company-space.ts:50:      await appRegistry.register(art!._id, projectDirFor(art!), art!.userId, art!.name);

exec
/bin/zsh -lc "rg -n \"loadWritable\\(|writable\\(|readable\\(|/bundle-update|/versions/:sha/restore|/featured-update/apply|/file|/backend/enabled|/backend/sample-run|/fork|/import\" api/tests/contract api/tests -g '"'!node_modules'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/tests/SUITE_LEDGER.json:367:    "group": "share/fork link contracts",
api/tests/contract/README.md:20:| `update-from-bundle-*` | update-in-place vs force, 409 on mismatch | `POST /artifacts/:id/bundle-update` (§3.8.9) | (G6) | G6 |
api/tests/contract/artifact-family.test.ts:145:    const res = await jwtApi('/api/v1/artifacts/src1/fork', t, { method: 'POST', body: JSON.stringify({ name: 'My Fork' }) });
api/tests/contract/artifact-family.test.ts:172:    const imp = await jwtApi('/api/v1/artifacts/import', t, { method: 'POST', body: JSON.stringify({ bundle }) });
api/tests/contract/artifact-family.test.ts:183:    const mismatch = await jwtApi('/api/v1/artifacts/upd1/bundle-update', t, {
api/tests/contract/artifact-family.test.ts:191:    const forced = await jwtApi('/api/v1/artifacts/upd1/bundle-update', t, {
api/tests/contract/artifact-family.test.ts:205:  it('PUT /file commits the save; versions lists it; restore reverts the tree', async () => {
api/tests/contract/artifact-family.test.ts:210:    const w1 = await jwtApi('/api/v1/artifacts/files1/file', t, { method: 'PUT', body: JSON.stringify({ path: 'notes.txt', content: 'first' }) });
api/tests/contract/artifact-family.test.ts:217:    await jwtApi('/api/v1/artifacts/files1/file', t, { method: 'PUT', body: JSON.stringify({ path: 'notes.txt', content: 'second' }) });
api/tests/contract/artifact-family.test.ts:219:    const vres = await jwtApi('/api/v1/artifacts/files1/versions', t);
api/tests/contract/artifact-family.test.ts:228:    const rres = await jwtApi(`/api/v1/artifacts/files1/versions/${targetSha}/restore`, t, { method: 'POST' });
api/tests/contract/artifact-family.test.ts:233:    const fread = await jwtApi('/api/v1/artifacts/files1/file?path=notes.txt', t);
api/tests/contract/artifact-family.test.ts:237:    const files = await jwtApi('/api/v1/artifacts/files1/files', t);
api/tests/contract/artifact-family.test.ts:330:    const apply = await jwtApi('/api/v1/artifacts/feat1/featured-update/apply', t, { method: 'POST' });
api/tests/contract/artifact-family.test.ts:368:    const apply = await jwtApi('/api/v1/artifacts/feat2/featured-update/apply', t, { method: 'POST' });
api/tests/contract/artifact-family.test.ts:436:    const en = await jwtApi('/api/v1/artifacts/be1/backend/enabled', t, { method: 'PUT', body: JSON.stringify({ enabled: false }) });
api/tests/contract/artifact-family.test.ts:440:    const sample = await jwtApi('/api/v1/artifacts/be1/backend/sample-run', t, { method: 'POST', body: JSON.stringify({ entrypoint: 'onEvent', input: {} }) });
api/tests/contract/README.md:20:| `update-from-bundle-*` | update-in-place vs force, 409 on mismatch | `POST /artifacts/:id/bundle-update` (§3.8.9) | (G6) | G6 |
api/tests/contract/artifact-family.test.ts:145:    const res = await jwtApi('/api/v1/artifacts/src1/fork', t, { method: 'POST', body: JSON.stringify({ name: 'My Fork' }) });
api/tests/contract/artifact-family.test.ts:172:    const imp = await jwtApi('/api/v1/artifacts/import', t, { method: 'POST', body: JSON.stringify({ bundle }) });
api/tests/contract/artifact-family.test.ts:183:    const mismatch = await jwtApi('/api/v1/artifacts/upd1/bundle-update', t, {
api/tests/contract/artifact-family.test.ts:191:    const forced = await jwtApi('/api/v1/artifacts/upd1/bundle-update', t, {
api/tests/contract/artifact-family.test.ts:205:  it('PUT /file commits the save; versions lists it; restore reverts the tree', async () => {
api/tests/contract/artifact-family.test.ts:210:    const w1 = await jwtApi('/api/v1/artifacts/files1/file', t, { method: 'PUT', body: JSON.stringify({ path: 'notes.txt', content: 'first' }) });
api/tests/contract/artifact-family.test.ts:217:    await jwtApi('/api/v1/artifacts/files1/file', t, { method: 'PUT', body: JSON.stringify({ path: 'notes.txt', content: 'second' }) });
api/tests/contract/artifact-family.test.ts:219:    const vres = await jwtApi('/api/v1/artifacts/files1/versions', t);
api/tests/contract/artifact-family.test.ts:228:    const rres = await jwtApi(`/api/v1/artifacts/files1/versions/${targetSha}/restore`, t, { method: 'POST' });
api/tests/contract/artifact-family.test.ts:233:    const fread = await jwtApi('/api/v1/artifacts/files1/file?path=notes.txt', t);
api/tests/contract/artifact-family.test.ts:237:    const files = await jwtApi('/api/v1/artifacts/files1/files', t);
api/tests/contract/artifact-family.test.ts:330:    const apply = await jwtApi('/api/v1/artifacts/feat1/featured-update/apply', t, { method: 'POST' });
api/tests/contract/artifact-family.test.ts:368:    const apply = await jwtApi('/api/v1/artifacts/feat2/featured-update/apply', t, { method: 'POST' });
api/tests/contract/artifact-family.test.ts:436:    const en = await jwtApi('/api/v1/artifacts/be1/backend/enabled', t, { method: 'PUT', body: JSON.stringify({ enabled: false }) });
api/tests/contract/artifact-family.test.ts:440:    const sample = await jwtApi('/api/v1/artifacts/be1/backend/sample-run', t, { method: 'POST', body: JSON.stringify({ entrypoint: 'onEvent', input: {} }) });
api/tests/migration/import-tool.test.ts:9:import { loadSource, buildPlan, runImport, NON_IMPORTS } from '../../scripts/migrate/import-tool.js';
api/tests/knowledge/importer.test.ts:8:} from '../../scripts/migrate/knowledge/importer.js';
api/tests/knowledge/importer.test.ts:69:  it('flags an id/filename mismatch as an anomaly but keeps the filename as docId', () => {
api/tests/journeys/j3-build.mjs:200:    const files = await api('GET', `/api/v1/artifacts/${st.artifactId}/files`, { token: u1 });

hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
codex
I’ve got at least one hard revocation defect and one likely bypass on the artifact mutation surface. I’m reading the new tests now to see whether they would have caught either issue or whether they only assert the happy-path the implementation chose.
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
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
codex
**High**
- [api/src/server.ts](/Users/ggomes/dev/ekoa-code/api/src/server.ts:679), [api/src/data/stores.ts](/Users/ggomes/dev/ekoa-code/api/src/data/stores.ts:10), [api/src/auth/users-service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/users-service.ts:90), [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:121), [api/src/auth/jwt.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/jwt.ts:67): the H1 “epoch bump revokes legacy builder JWTs” story is not durable. `tokenEpoch` is never persisted on `UserDoc`, every bump only mutates the in-memory activation map, and boot reload still hydrates only `{ active }`. Concrete attack: a user holding a pre-migration `role:"builder"` JWT keeps it until expiry by waiting for any process restart; after restart `verifyToken()` normalizes the stale role to `user`, `act.tokenEpoch` is back to `0`, and the supposedly-revoked token is accepted again. The same restart regression also resurrects tokens after admin demotion, password reset, or `logoutOther`. The new [role-migration test](/Users/ggomes/dev/ekoa-code/api/tests/auth/role-migration.test.ts:42) only checks the live map, so it does not catch the real boot-path failure.
- [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:92), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:134), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:159), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:233), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:355), [api/src/apps/artifact-bundle.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/artifact-bundle.ts:131), [api/src/apps/artifact-fork.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/artifact-fork.ts:62), [api/src/apps/versions.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/versions.ts:142): H1 closes `/jobs`, but it leaves multiple user-controlled build/edit vectors completely outside the new capability layer. A plain `user` can still `POST /api/v1/artifacts/import` to create and immediately build/register an app, `POST /:id/fork` to clone and rebuild one, `POST /:id/bundle-update` / `PUT /:id/file` / `POST /:id/versions/:sha/restore` to rewrite code, and `PUT /:id/backend/enabled` / `POST /:id/backend/sample-run` to control executable backend behavior. Since [POST /artifacts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:79) still grants ordinary users ownership of artifacts, the intended “user cannot build or change apps” policy is trivially bypassed without ever touching `POST /jobs`.

**Medium**
- [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:54), [api/src/apps/build-mechanics.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/build-mechanics.ts:206), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:105), [shared/src/artifacts.ts](/Users/ggomes/dev/ekoa-code/shared/src/artifacts.ts:39): the follow-up authorization is still TOCTOU-prone. The route checks `loadWritable()` once, then `executeBuildJob()` later calls `resolveFollowUp()` which re-fetches the artifact with a raw `artifacts.get()` and never re-validates writability. Concrete attack: an org-admin starts a follow-up build against a same-org `visibility:"org"` artifact; before execution reaches `resolveFollowUp()`, the owner flips it to `visibility:"private"` via `PATCH /artifacts/:id`; the queued job still edits the now-private artifact because the second fetch trusts the stale earlier decision.

**Low**
- [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:54), [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:93): the 403/404 split leaks existence of same-org private artifacts to any actor who already has `canEditApps`. Concrete attack: an org-admin can probe `POST /api/v1/jobs` with candidate `artifactId`s; `403` means “a private artifact in my org exists but is owned by someone else”, while `404` means “missing or cross-org”. Those private artifacts are otherwise hidden from `listArtifacts`, so this becomes an oracle for private-app existence.

VERDICT: NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
195,479
**High**
- [api/src/server.ts](/Users/ggomes/dev/ekoa-code/api/src/server.ts:679), [api/src/data/stores.ts](/Users/ggomes/dev/ekoa-code/api/src/data/stores.ts:10), [api/src/auth/users-service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/users-service.ts:90), [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:121), [api/src/auth/jwt.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/jwt.ts:67): the H1 “epoch bump revokes legacy builder JWTs” story is not durable. `tokenEpoch` is never persisted on `UserDoc`, every bump only mutates the in-memory activation map, and boot reload still hydrates only `{ active }`. Concrete attack: a user holding a pre-migration `role:"builder"` JWT keeps it until expiry by waiting for any process restart; after restart `verifyToken()` normalizes the stale role to `user`, `act.tokenEpoch` is back to `0`, and the supposedly-revoked token is accepted again. The same restart regression also resurrects tokens after admin demotion, password reset, or `logoutOther`. The new [role-migration test](/Users/ggomes/dev/ekoa-code/api/tests/auth/role-migration.test.ts:42) only checks the live map, so it does not catch the real boot-path failure.
- [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:92), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:134), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:159), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:233), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:355), [api/src/apps/artifact-bundle.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/artifact-bundle.ts:131), [api/src/apps/artifact-fork.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/artifact-fork.ts:62), [api/src/apps/versions.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/versions.ts:142): H1 closes `/jobs`, but it leaves multiple user-controlled build/edit vectors completely outside the new capability layer. A plain `user` can still `POST /api/v1/artifacts/import` to create and immediately build/register an app, `POST /:id/fork` to clone and rebuild one, `POST /:id/bundle-update` / `PUT /:id/file` / `POST /:id/versions/:sha/restore` to rewrite code, and `PUT /:id/backend/enabled` / `POST /:id/backend/sample-run` to control executable backend behavior. Since [POST /artifacts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:79) still grants ordinary users ownership of artifacts, the intended “user cannot build or change apps” policy is trivially bypassed without ever touching `POST /jobs`.

**Medium**
- [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:54), [api/src/apps/build-mechanics.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/build-mechanics.ts:206), [api/src/routes/artifacts.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/artifacts.ts:105), [shared/src/artifacts.ts](/Users/ggomes/dev/ekoa-code/shared/src/artifacts.ts:39): the follow-up authorization is still TOCTOU-prone. The route checks `loadWritable()` once, then `executeBuildJob()` later calls `resolveFollowUp()` which re-fetches the artifact with a raw `artifacts.get()` and never re-validates writability. Concrete attack: an org-admin starts a follow-up build against a same-org `visibility:"org"` artifact; before execution reaches `resolveFollowUp()`, the owner flips it to `visibility:"private"` via `PATCH /artifacts/:id`; the queued job still edits the now-private artifact because the second fetch trusts the stale earlier decision.

**Low**
- [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:54), [api/src/apps/app-paths.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-paths.ts:93): the 403/404 split leaks existence of same-org private artifacts to any actor who already has `canEditApps`. Concrete attack: an org-admin can probe `POST /api/v1/jobs` with candidate `artifactId`s; `403` means “a private artifact in my org exists but is owned by someone else”, while `404` means “missing or cross-org”. Those private artifacts are otherwise hidden from `listArtifacts`, so this becomes an oracle for private-app existence.

VERDICT: NEEDS-WORK
