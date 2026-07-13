# H1 fresh-context adversarial security review — commit e2c165e

Reviewer: fresh-context adversarial security reviewer (no prior stake). Scope: the H1 slice of the
atomic H1-H6 security block — the real `can()` capability layer replacing the permissive stub, the
`builder`->`user` role migration (boot step + verify-boundary shim), and the four capability gates
including the cross-tenant follow-up-build IDOR fix.

## Independent evidence I gathered (did not trust reported exit codes)

- `cd api && npx tsc --noEmit -p tsconfig.json` -> exit 0.
- `cd api && npx tsc --noEmit -p tsconfig.test.json` -> exit 0.
- `npm run gate:chokepoint` -> clean (no `@anthropic-ai/` or `api.anthropic.com` outside `api/src/llm/`).
- `npx eslint` on all touched source (capabilities/jwt/users-service/jobs/chat/artifacts/server/automation-service) -> 0 problems (import-boundary rule permits the new `routes/jobs.ts` -> `apps/app-paths.ts` `loadWritable` import).
- `npx vitest run tests/auth/ tests/contract/{jobs-capability,jobs,cross-org,error-envelope}.test.ts` -> 7 files, 49 tests passed.

## What I verified SOUND (rebuttals)

**1. Gate completeness (the build/agent path).** `handleBuildCreate` has exactly one production
caller — `api/src/routes/jobs.ts:61` — and the gate runs BEFORE it (`jobs.ts:41-60`).
`executeBuildJob` is only ever fired from inside `handleFirstBuild`/`handleFollowUp` via the
`fire()` thunk; no other production caller. The automation engine, integration prefetch, and
integration builder do NOT reach `handleBuildCreate` (grep-confirmed). In-chat build intent emits a
marker the CLIENT turns into `POST /jobs` (exploration §4.2), so it re-enters the same gate. The
route-level placement is airtight for the agent build path.

**2. The IDOR fix.** In `jobs.ts` the capability check `can(actor,'canEditApps')` (`:51`) runs
STRICTLY BEFORE the ownership probe `loadWritable` (`:55`) — a user without the capability gets a
uniform 403 that never touches the store, so there is no existence oracle. `loadWritable`
(`apps/app-paths.ts:88-97`) runs BEFORE any job is created/agent spawned. The 403/404 split does not
leak cross-org existence: cross-org and missing both return `notfound` -> 404 (uniform); only a
same-org another-user PRIVATE row returns 403, which is the sanctioned within-org model already used
by write-file/bundle-update/restore. No exploitable TOCTOU on the later `resolveFollowUp` re-fetch:
the `artifactId` is fixed; the fields that determine the target sandbox (`userId`/`orgId`) are
immutable via any route (there is no ownership-transfer endpoint); a delete-during-window fails safe
(`resolveFollowUp` returns null -> `finishError('ADAPTER_ERROR')`); the one-follow-up-per-artifact
guard blocks racing follow-ups; and `resolveFollowUp` resolves the SAME artifact's server-derived
owner sandbox, so the check and the use target the same resource.

**3. Migration + epoch + shim.** Traced the exact compare in `requireAuth` (`middleware.ts:49`):
`claims.iat < act.tokenEpoch` -> 401. `migrateBuilderRole` (`users-service.ts:90-96`) bumps the
in-memory epoch to `floor(now/1000)+1`, so an outstanding legacy `builder` JWT (iat in the past) is
rejected in-process. No re-login lockout: `mintIat` (`service.ts:50-53`) reads the SAME in-memory
map the migration bumped, and `login`'s pre-mint `setActivation` preserves the bumped epoch (its
`tokenEpoch ?? prev?.tokenEpoch` fallback), so a freshly-migrated user mints `iat = max(now, epoch)
>= epoch` and passes. Idempotent (2nd run finds nothing -> 0, no re-bump; unit test pins this).
Across a process restart the epoch resets to 0 and the migration no-ops, but the `verifyToken` shim
(`jwt.ts:67`) normalises any still-outstanding `builder` JWT to `user` (the LEAST-privileged role):
this is downgrade-only, never escalation. No consumer persists the normalised role back to the
store, and HS256 signature verification runs BEFORE the shim so a `builder`/forged role cannot be
minted without the signing secret. The `?? false` in `can()` plus `requireRole`'s `includes` both
fail closed on any unrecognised role.

**4. The matrix / fail-closed.** `CAPABILITIES` is `Record<Role, ...>` (a new Role value is a
compile error) and `can()` returns `granted?.includes(cap) ?? false`, so null/undefined and any
stale/unknown role grant NOTHING. The permissive stub test is DELETED; no `PERMISSIVE-STUB` marker
survives anywhere in `api/`; no other test pins permissive behaviour (the `jobs.test.ts` and
`registo.test.ts` edits promote build-posting seeds to `org-admin` — correct adaptations, not
permissive pinning).

**5. Contract honesty.** The new/extended contract tests import and validate against the REAL shared
`ErrorEnvelope` from `@ekoa/shared` (not a hand-rolled shape) — `jobs-capability.test.ts:18,76,112`,
`jobs.test.ts`. Capability refusals carry `details.capability`; the ownership 403 carries no
capability field (asserted). `ErrorEnvelope.details` is `z.record(JsonValue)` and `{capability:'...'}`
is plain JSON, so the addition rides the existing envelope. The five user-facing PT-PT refusal
strings are clean: proper PT-PT ("Nao tem permissao...", "administrador da organizacao"), no emoji,
no em/en-dash.

**6. Rename sweep — no dead branches.** The one real behaviour branch `canCreateAutomation`
(`automation/service.ts:207`) was updated `=== 'builder'` -> `=== 'user'` (not left as a
never-matching dead branch); the persisted org-setting key `allowBuilderAutomations` keeps its wire
name for data compat. Synthetic internal actors (`engine.ts` actorFromCtx, `prefetch.ts`
listPlatform, `server.ts` scoped-memory resolver) moved `'builder'` -> `'user'` — same non-admin
visibility, no behaviour change. Web toggle values/badges + locales (`roleBuilder`->`roleUser`, PT
`Utilizador`) are coherent; remaining web `builder`/`Construtor` strings are the app-BUILDING FEATURE
workspace, not the role label (correctly left untouched).

## Findings

### MEDIUM — M1: `canEditApps` is not wired to the direct app-mutation routes; the new security.md wording overstates enforcement

`canEditApps` gates ONLY the agent follow-up-build path (`POST /jobs` with `artifactId`). The direct
app-source/state mutation routes remain ownership-gated (`writable()`) but capability-UNgated:
`PUT /artifacts/:id/file` (direct source edit), `POST /:id/bundle-update`,
`POST /:id/versions/:sha/restore`, `POST /:id/backups/restore`, `PUT /:id/backend/enabled`,
`POST /:id/backend/sample-run`; and `POST /:id/fork` + `POST /import` create app artifacts without a
`canCreateArtifacts`/`canBuildApps` check. Consequence: a `user` (no canEditApps/canBuildApps) can
still rewrite the source of their own apps AND any org-shared app via `PUT /:id/file`, restore/roll
versions, apply bundle updates, and fork/import to obtain owned app artifacts. The security.md
paragraph this commit ADDS ("a `user` ... never app build/edit"; table `canEditApps` user = no)
advertises a boundary that is porous through these sibling routes — an org-admin who demotes a member
to `user` to revoke app-editing would find the member can still mutate app source directly.

Scope/impact: this is NOT a tenant or IDOR break — every one of those routes enforces
ownership+org (`writable`/`readable`), so there is no cross-user private mutation and no cross-org
reach, and the follow-up-build IDOR H1 was chartered to close IS closed. It is a within-org
capability-model completeness gap plus a doc-accuracy issue. The brief explicitly scoped H1 to the
four gates and reserved edit-mode/panel for H3, so this is plausibly intended sequencing — but the
H-block "lands together-or-not-at-all," so it must be reconciled before the block completes.
RECOMMEND: either tighten the security.md wording now to scope the claim to the build path, or have a
later H-slice extend `canEditApps`/`canCreateArtifacts` to the source-mutation + fork/import routes.

### LOW — L1: epoch-based revocation does not survive a process restart (pre-existing; benign for H1, inherited by the new layer)

`tokenEpoch` is in-memory only — `loadActivation` (`server.ts:679`) loads only `{active}` and the
migration's `bumpTokenEpoch` is not persisted — so every epoch resets to 0 on restart. Benign for
the builder migration (post-restart the shim downgrades a stray `builder` JWT to `user`, no
escalation). But the same property means an admin->user DEMOTION's epoch revocation also does not
survive a restart: a demoted admin's pre-demotion `org-admin` JWT would be re-admitted after a
restart within its 24h/30d validity and pass `requireRole('org-admin')`. Pre-existing (exploration
§3.2), not introduced by H1 and outside its scope, but the new capability layer inherits it — worth a
tracked note for the H-block.

### LOW — L2 (nit): em-dashes in new code comments

Several new code comments use "—", contra the user's global "never use em dash" preference. Not
user-facing (the PT-PT refusal copy is compliant) and matches the pervasive existing comment style;
trivial.

## Conclusion

The security-critical objectives are implemented correctly and independently verified: the
follow-up-build cross-tenant IDOR is closed with the capability check ordered before the ownership
probe and no exploitable TOCTOU; the `can()` matrix is real and fail-closed; the `builder`->`user`
migration has correct epoch/shim/no-lockout semantics with no escalation path; and refusals are
contract-honest against the shared envelope. M1 is a real but ownership-bounded (no tenant break)
scope/doc-accuracy gap within a multi-slice block that must be reconciled before the H-block
completes — it does not undermine H1's delivered security controls.

VERDICT: APPROVE
