# H1 codex-fix brief - close the four findings (loop-back to implement)

Codex security review of e2c165e returned NEEDS-WORK with 2 High + 1 Medium + 1 Low, ALL real.
Full text: slices/H1/codex-review.md. Fix all four in the working tree (no commits; the lead runs
the wall + live re-probe + re-review). These are SECURITY fixes - correctness over cleverness.

## HIGH-1: durable tokenEpoch + billingLocked (revocation survives restart)
FINDING: `loadActivation` (api/src/server.ts:679) loads ONLY `{active}` - `tokenEpoch` and
`billingLocked` default to 0/false at every boot. So EVERY revocation is lost on restart: the
migration's legacy-builder invalidation, a demoted admin's old org-admin JWT, a password-reset
token, a logoutOther. And billingLocked resets to false (this also closes the carried LANDING
item "bootState loads the activation cache without billingLocked").

FIX (persist both on the user row; load both at boot):
1. api/src/data/stores.ts: add to UserDoc `tokenEpoch?: number` and `billingLocked?: boolean`.
2. Everywhere the epoch is bumped in the in-memory map, ALSO persist it to the user row in the
   SAME operation: patchUser role change (users-service.ts ~57-60), migrateBuilderRole
   (users-service.ts ~92-95), password change/reset + logoutOther + deactivate (auth/service.ts -
   grep bumpTokenEpoch/setActivation). Use a single helper if it reduces duplication (e.g.
   `bumpTokenEpochDurable(userId, epochSec)` that does `users.update` + `bumpTokenEpoch`). Keep the
   in-memory bump (fast path) AND the row write (durability).
3. Everywhere billingLocked is set (the billing tracker's setActivation calls), persist
   `billingLocked` to the user row too.
4. api/src/server.ts:679 loadActivation: map `{ userId: u._id, active: u.active,
   billingLocked: u.billingLocked, tokenEpoch: u.tokenEpoch }` (the loader already accepts both
   optional fields - activation.ts:21).
5. TEST (this is the finding's crux - the current role-migration test only checks the live map):
   extend api/tests/auth/role-migration.test.ts (or a new durable-revocation test) to prove the
   BOOT PATH: seed a user row with a bumped tokenEpoch, call loadActivation with the row, assert
   getActivation returns the persisted epoch (not 0); and an end-to-end-ish: bump epoch (durable),
   simulate restart (clear the map + re-run loadActivation from the store), assert the epoch
   survived so an old-iat token is still rejected. Same for billingLocked.

## HIGH-2: gate the OTHER app build/edit vectors (app-type-aware)
FINDING: H1 gated POST /jobs but left these user-reachable app build/edit vectors ungated - a
`user` OWNS artifacts they create (POST /artifacts), so writable() passes and they change app
code without touching /jobs: POST /artifacts/import, POST /:id/fork, POST /:id/bundle-update,
PUT /:id/file, POST /:id/versions/:sha/restore, PUT /:id/backend/enabled,
POST /:id/backend/sample-run (+ for completeness the mutating app-data ops POST /:id/backups and
POST /:id/backups/restore).

FIX (app-type-aware - a user MAY still manage NON-app artifacts; only APPS are gated):
1. Add an `isAppArtifact(art)` helper (api/src/apps/app-paths.ts or artifact-type.ts): an artifact
   is an app if `art.data?.projectDir` is set (a built app sandbox) OR `art.data?.artifactType` is
   in the app family (check typeForBase / the ArtifactType 'app' values). projectDir presence is
   the primary signal (only built apps have it). Export it.
2. Gate each vector AFTER its existing loadWritable/loadReadable (so ownership still applies),
   app-type-aware:
   - POST /import: a bundle is always an app export -> `can(actor,'canBuildApps')` (creates+builds
     a new app). 403 + details.capability if not.
   - POST /:id/fork: if `isAppArtifact(src)` -> `can(actor,'canBuildApps')` (forking an app builds
     a new one); else it is a non-app artifact fork -> leave to canCreateArtifacts (users keep it).
   - POST /:id/bundle-update, PUT /:id/file, POST /:id/versions/:sha/restore: if `isAppArtifact(art)`
     -> `can(actor,'canEditApps')`.
   - PUT /:id/backend/enabled, POST /:id/backend/sample-run: backends exist only on apps ->
     `can(actor,'canEditApps')` (app-type-aware, but effectively always app).
   - POST /:id/backups, POST /:id/backups/restore: mutating an app's data state -> if
     `isAppArtifact(art)` -> `can(actor,'canEditApps')`.
   Read routes (GET files/file/versions/export/download/pdf/backups/backend logs) stay as-is
   (readable ownership only) - reading is not "changing an app". DELETE /:id stays as-is (deletion
   is neither build nor change; note for H5, do not over-gate here).
3. Refusals: the same FORBIDDEN envelope + details.capability + PT-PT copy as the jobs gate.
4. TESTS: extend the capability integration suite (api/tests/contract/ - a new
   artifacts-capability.test.ts modelled on jobs-capability.test.ts, mongo-mem, real
   artifactsRouter, mock the heavy service calls importArtifact/forkArtifact/updateArtifactFromBundle/
   writeArtifactFile/restoreAndRebuild/backend so no real build): a `user` who OWNS an app artifact
   gets 403 canEditApps on bundle-update/file/restore/backend and 403 canBuildApps on import/fork;
   an org-admin gets through (service mocked); a `user` editing a NON-app artifact they own is NOT
   403 (canCreateArtifacts path preserved).

## MEDIUM: follow-up TOCTOU (re-validate writability at execution)
FINDING: jobs route checks loadWritable once; executeBuildJob later calls resolveFollowUp
(build-mechanics.ts:206) which re-fetches via raw artifacts.get and never re-validates - the owner
can flip visibility org->private between check and execution, and the queued job still edits it.
FIX: re-validate at USE time. In the follow-up execution path (api/src/agents/build.ts follow-up
execute, which has input.actor), re-run `loadWritable(actor, artifactId)` immediately before
resolveFollowUp resumes, and FAIL the job (terminal, a clear PT-PT error) if verdict !== 'ok'.
Keep the seam convention: if build.ts cannot import app-paths (seam boundary), thread the check
through the injected mechanics (resolveFollowUp takes the actor and re-validates) OR add a
`revalidateWritable` seam. Prefer the smallest change that puts a fresh ownership check at
execution time. TEST: unit/integration proving a follow-up whose artifact became unwritable
between create and execute fails the job instead of editing it.

## LOW: existence oracle in the follow-up 403/404 split
FINDING: the follow-up gate returns 403 for "same-org private artifact owned by someone else" vs
404 for "missing/cross-org" - an oracle for private-app existence to any canEditApps holder.
FIX (LOCAL to the follow-up build gate, do NOT change loadWritable globally - the artifact routes
may legitimately distinguish): in the jobs follow-up path, collapse verdict 'forbidden' -> 404
(same body as notfound) so an edit-authorization failure never reveals existence. Update the
jobs-capability.test.ts expectation (the org-admin-vs-other-user-private case becomes 404). This
overrides the H1 brief's 403/404 split for the follow-up path - security over the brief's
convenience; document the override in impl-notes.

## VERIFY (unit level, no stack ops, no commits)
cd api && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json; eslint touched
files; npx vitest run tests/ (FULL api lane); repo-root npm run gate:chokepoint; if web touched,
web typecheck. Update slices/H1/impl-notes.md with a "codex-fix round" section (each finding ->
what changed + the test that proves it) and worker-status.txt (append "| codex-fix DONE-GREEN").
Reserved paths unchanged (all these files are already in the H-block reservation); if a fix needs a
file outside them, flag it.
