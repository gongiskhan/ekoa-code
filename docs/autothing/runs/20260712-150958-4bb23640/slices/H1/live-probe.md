# H1 live gate probe (2026-07-13, credentialed boot-b stack on the H1 dist)

Zero-LLM-cost curl probe proving the capability gates are WIRED and enforcing on the running
stack (the deny paths need no model call; the allow-build path is proven by the integration
suite, not burned here). Provisioned a fresh `role:'user'` account via the super-admin users
route, then drove the gates.

## Results (all as designed)

1. **user first-build -> 403 canBuildApps.** `POST /jobs {kind:build, description, no artifactId}`:
   ```
   HTTP 403
   {"error":{"code":"FORBIDDEN","message":"Não tem permissão para criar aplicações; pode pedir ao administrador da organização.","details":{"capability":"canBuildApps"}}}
   ```
   The shared FORBIDDEN envelope + the machine hook `details.capability` (the H4 queue's consumption
   point) + PT-PT copy, no emoji/dash. The job was never created (gate is before creation).

2. **user follow-up (edit) -> 403 canEditApps, capability BEFORE ownership (no existence leak).**
   `POST /jobs {..., artifactId:"task-manager"}` (a featured app the user does not own):
   ```
   HTTP 403
   {"error":{"code":"FORBIDDEN","message":"Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.","details":{"capability":"canEditApps"}}}
   ```
   The user lacks canEditApps, so the refusal is a capability denial that never reveals whether the
   target exists - the capability check runs before loadWritable exactly as designed. (The
   ownership 403/404 split is exercised by the integration suite jobs-capability.test.ts with an
   org-admin actor who HAS canEditApps but does not own the artifact.)

3. **user chat -> 202 (canUseChat retained).** `POST /chat/runs`: HTTP 202 - a user keeps chat +
   artifact creation; only app build/edit is gated. Proves the matrix is selective, not a blanket
   deny.

## Migration
The boot-b stack uses a FRESH ephemeral mem-mongo seeded with a super-admin only (no legacy
`builder` rows), so `migrateBuilderRole()` correctly logged nothing to migrate - its idempotence
and epoch-bump semantics are proven deterministically in role-migration.test.ts (mongo-mem: a
seeded builder row -> user once, epoch bumped once, second boot = 0).

## Not burned
The org-admin allow-build path (202 + real build) is proven by the contract + integration suites
without spending an LLM build; the live probe deliberately exercises only the zero-cost deny/allow
gate decisions.
