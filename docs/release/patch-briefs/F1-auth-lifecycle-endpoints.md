# F1: Auth lifecycle endpoints unimplemented (refresh / logout / password / device)

**Severity / class:** high / bug

**Symptom:** The auth router serves only `login` and `me`. `POST /auth/refresh`, `/auth/logout`,
`/auth/password`, `/auth/device`, `/auth/device/poll`, `/auth/device/approve`, and
`POST /users/:id/password` all return raw Express HTML 404 despite being declared in the shared
contract and spec ch03. Logout therefore has no server-side revocation (a "logged-out" token stays
valid to expiry; only admin deactivation revokes) and `passwordChangeRequired` can never be cleared.
Evidence: `docs/release/evidence/J1-auth/j1-auth.json` (b,c,h,i); `J0-contract-sweep/sweep.json`.

**Root cause:** `api/src/routes/auth.ts:10-34` defines only `POST /login` and `GET /me` - none of the
lifecycle handlers exist. The revocation machinery is already present and unused on this path:
`api/src/auth/revocation.ts` exports `revoke(jti,...)` (:36), `isRevoked` (:25), `loadRevocations`
(:15), but nothing calls `revoke` at logout. `users/:id/password` is absent from
`api/src/routes/users.ts`. The shared descriptors already exist
(`shared/src/auth.ts:112-144`: refresh/deviceStart/devicePoll/deviceApprove/logout/password), so the
schema-coverage gate passes on schemas while the mounts are missing (this is exactly F5).

**Fix scope:** `api/src/routes/auth.ts` (add refresh, logout, password, device, device/poll,
device/approve), `api/src/routes/users.ts` (add `POST /:id/password`, super-admin). Wire against
`auth/service.ts` + `auth/revocation.ts` + `auth/jwt.ts` (extract the jti from the caller's token and
`revoke` it on logout; clear `passwordChangeRequired` on password set). NON-goals: no new token
scheme; no device-flow web UI; do not touch login/me; no refresh-token rotation redesign beyond the
existing revocation set.

**Regression test first:** add to the contract suite `api/tests/contract/auth.test.ts` (supertest over
the in-process app factory + `mongodb-memory-server`, per ekoa-testing). BEFORE the fix it must fail:
(1) each endpoint returns its named `shared/src/auth.ts` response schema via `safeParse`; (2) after a
`200` logout the same token is rejected on the next `GET /me` (revocation); (3) after `POST
/auth/password` a re-login shows `passwordChangeRequired:false`; (4) every non-2xx body validates
against the shared error envelope via the one common helper.

**Acceptance:** all seven sweep rows flip to `mounted` (re-run `J0-contract-sweep`); logout revokes the
jti (subsequent authed call 401/ACCOUNT envelope); password change clears the flag; contract suite +
schema-coverage + protocol-parity gates green.

**Notes:** auth is a significance-labeled area - adversarial Codex review required to merge (ch13
§13.10 layer 4). No LLM egress and no import-boundary impact. If the device flow introduces new states,
update the ch03 auth-flow diagram in `spec/diagrams/` in the same unit of work (FIXED-12).
