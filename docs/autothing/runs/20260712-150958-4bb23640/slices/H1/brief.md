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
