# H4 fresh-context adversarial SECURITY review — request-changes queue + refused-build feed

Commit `791c7e3`. Reviewer: fresh-context, no prior stake. Focus: CROSS-ORG ISOLATION.
Evidence gathered independently (ran the suites myself; did not trust reported exit codes).

## Verdict summary
The cross-org isolation crux is implemented correctly, mirrors the established `registo.ts`
precedent exactly, and is honestly tested against a real two-org topology. Every gate I ran
passes. Findings are all Low and non-blocking.

## What I verified (and why it holds)

### 1. Read isolation — org-admin cannot read another org's queue — SOUND
`readChangeRequests` (`api/src/services/change-requests.ts:88-91`) forces the filter to
`{ orgId: actor.orgId }` for anyone who is not `super-admin`; the `query.orgId` param is honoured
ONLY on the `super-admin` branch. A `?orgId=orgB` from an org-admin is silently ignored. This is
byte-for-byte the `readRegisto` rule (`services/platform-crud.ts`): `super-admin ? (q.orgId ? {orgId}
: {}) : {orgId: actor.orgId}`. The role gate (`requireRole('org-admin','super-admin')`) sits on the
route (`routes/change-requests.ts:60`), scope in the service — the documented split.
Tested: `admA`(orgA) reading a queue holding only an orgB request gets `total===0`, no `reqU` row
(`tests/routes/change-requests.test.ts:82-97`).

### 2. IDOR on convert/dismiss — SOUND, no existence oracle
Both `convertChangeRequest` and `dismissChangeRequest` gate on the shared `loadOwnOrg` helper
(`services/change-requests.ts:101-106`): a missing row AND a cross-org row both return `null` →
uniform `not-found` → 404. No 403/404 distinction that could confirm an id exists in another org.
Tested: `admA` converting orgB's request → 404; `admB` (owner org) → 200 `converted`
(`tests/routes/change-requests.test.ts:120-137`).

### 3. orgId is server-stamped, never from the body — SOUND
`fileChangeRequest` (`services/change-requests.ts:52-61`) sets `orgId` from the resolved app
OWNER's user record (served-app filing) or the requester's JWT org (refused-build filing). The body
carries `text/route/screenState/appId` only; `appId` is an informational label, never used for org
routing. The route resolves the app OWNER via `resolveApp` + `req.user`, never the caller body
(`routes/change-requests.ts:38-51`). Tested: a plain user in orgA filing about `appX` (owned by
orgB) lands in orgB with `requesterUserId` from the JWT (`tests/routes/...:59-70`).

### 4. File auth — anonymous cannot file — SOUND
`POST /` is behind `requireAuth` (`routes/change-requests.ts:35`); `requesterUserId = req.user!.sub`
from the verified token. Anonymous → 401 (covered by `mount-coverage.test.ts`, which asserts every
mounted endpoint answers 401 unauthenticated). Panel controller degrades a missing/expired token to
the calm `needs-login` outcome before any doomed call (`change-request.js:49,72`). The
visitor-blind `POST /api/app-assistant` plane is a SEPARATE endpoint and is untouched.

### 5. Convert → patch run is H1-gated at the right place — SOUND
The convert ENDPOINT does not start a build — it is a pure status flip + jobId link
(`services/change-requests.ts:110-118`). The build is driven by the web client POSTing
`/api/v1/jobs` FIRST (H1-gated: `canBuildApps`/`canEditApps` + `loadWritable`), then linking the
returned jobId (`web/stores/change-requests.ts:78-113`). `artifactId` passed to `/jobs` is the
request's own `appId` (server-stamped at file time for served-app filings), and `/jobs` re-gates
`loadWritable` regardless, so an admin can only build apps they can already edit. No escalation via
convert. (The `/jobs` gate itself is H1's verified territory.)

### 6. Contract / envelope — SOUND
Non-2xx returns the shared envelope (tested: 404 `ErrorEnvelope`, 403 `ErrorEnvelope`). The contract
test validates live file/list/convert responses against the real shared `ChangeRequest`/
`ChangeRequestListResponse` schemas. Descriptor map added (`ALL_ENDPOINTS` 25→26, contract.test
count updated), `schema-coverage` extended with all 4 `changeRequests.*` keys so
`EXPECTED_PENDING_COUNT` is unchanged. `.strict()` on the wire schema; the view spreads optionals
only when present.

### 7. Web surface — adminOnly AND server-gated — SOUND
`/pedidos` nav is `adminOnly` (org-admin + super-admin, not superAdminOnly), page wrapped in
`AdminGate allowOrgAdmin`. The real protection is server-side: the GET is `requireRole`-gated, so
hiding the nav is defence-in-depth, not the boundary. UI copy is PT-PT; no emoji; no em/en-dash in
user-facing strings (the em-dashes present are only in code comments, matching the repo's existing
comment style).

### 8. Test honesty — NOT a tautology — SOUND
`tests/routes/change-requests.test.ts` seeds two real orgs (`reqU`/`admA` in orgA, `admB` in orgB)
and an org app owned by admB. It asserts the NEGATIVE: a filing about admB's app surfaces to admB
and admA sees `total===0`; a plain user gets 403 on the queue read; cross-org convert is a 404; the
refused-build path lands in the requester's OWN org and surfaces to admA not admB. Genuine
cross-org topology, genuine negative assertions.

## Independent evidence I ran
- `vitest run tests/routes/change-requests.test.ts tests/contract/change-requests.test.ts
  tests/apps/change-request.test.ts tests/contract/schema-coverage.test.ts` → 4 files, 22 passed.
- `vitest run tests/contract/schema-coverage.test.ts tests/contract/mount-coverage.test.ts` →
  2 files, 5 passed.
- `tsc --noEmit -p tsconfig.json` → exit 0. `eslint` on the 4 touched API files → exit 0.
- Confirmed `readChangeRequests` scoping is identical to `readRegisto`; `resolveApp` fail-closes
  (null for unknown, `artifactBacked:false` for registry-only, `''` owner caught by the route's
  `!app.ownerUserId` → 404).

## Findings (all Low, non-blocking)
- **L1 — orphan on a deleted owner.** `orgId = owner?.orgId ?? ''` (`services/change-requests.ts:56`):
  if a served app's owner user record is gone, the request is stored with `orgId:''`. This is
  FAIL-SAFE (no real org-admin matches `''`, and the notify fan-out is empty), not a cross-org leak,
  but it silently drops the request. A 404 (owner unresolvable) would be cleaner. Not a blocker.
- **L2 — no rate limit on filing.** A logged-in user could spam a reachable app's owner-org queue
  (each filing fires an SSE to that org's admins). However, NO HTTP rate-limiting middleware exists
  anywhere in the platform — this is a pre-existing, platform-wide characteristic, not something H4
  introduced. Filing requires auth, so it is attributable and revocable. Not H4's to solve.
- **L3 — convert/dismiss accept non-open rows.** The API will re-convert an already-converted or
  dismissed request (the UI hides the buttons for non-open). Own-org only; pure idempotency
  looseness, no security impact.
- **L4 — test could be marginally stronger.** No dedicated assertion that an org-admin passing an
  explicit `?orgId=orgB` is ignored (the code forces `{orgId: actor.orgId}` regardless, and the
  isolation test proves admA sees nothing of orgB). The code path is airtight; the extra assertion
  would only harden the test.

None of these rise to Medium. The isolation boundary — the entire point of the slice — is correct,
precedent-faithful, and honestly proven.

VERDICT: APPROVE
