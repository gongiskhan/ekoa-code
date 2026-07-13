# H2 impl-notes - identity/session handoff (whoami detection, detect-then-ask)

Slice H2 of the atomic security block. Built on H1 (commit 49dc5f6): the real `can()` capability
layer + the durable verify chain. DONE-GREEN.

## What was built

### 1. Shared contract (additive) - `shared/src/app-assistant.ts`
- `AppAssistantWhoamiResponse = z.object({ admin: z.boolean() }).strict()`. `.strict()` is
  load-bearing: the answer is a single boolean and NOTHING else - no identity/org/role/reason may
  ride the wire (fail-closed + oracle-free).
- Descriptor entry `appAssistantEndpoints.whoami` (`GET /api/app-assistant/whoami`, `header-scoped`,
  response-only). Additive - `assistantChat` is untouched.

### 2. Detection endpoint - `api/src/apps/app-assistant-route.ts`
- New `GET /app-assistant/whoami` on the existing router, a sibling of `POST /app-assistant`.
- Refactor: the app-id charset/collision check + `resolveApp` + artifact-backed-owner check were
  factored out of `admit()` into a shared `resolveAssistantApp(header)` (a discriminated
  `invalid-id | not-found | ok`). BOTH the POST admission and whoami now go through it, so they
  apply the EXACT same 400 (`VALIDATION_FAILED`, incl. the reserved `usr.` prefix) and 404
  (`NOT_FOUND`) - whoami is provably not a different existence oracle than POST already is.
- Identity: `detectOwnerOrgAdmin(authHeader, ownerOrgId)` extracts the OPTIONAL `Bearer` (same
  regex idiom as `requireAuth`) and verifies it through `verifySseToken` - the EXACT chain
  requireAuth/verifySseToken run (`verifyToken` + `jti` + `isRevoked` + activation-active +
  `tokenEpoch`). No hand-rolled weaker check, no second identity path, no per-app login.
- Decision: pure exported `isOwnerOrgAdmin(claims, ownerOrgId)` - gated by H1's
  `can(claims, 'canEditApps')` (so a `user` role stops at the capability gate), then super-admin
  spans any org and org-admin must match the owner org. Owner org is resolved server-side from the
  owner user record (`users.get`), never from anything the caller supplied.
- The ONLY non-200s are the two app-id header failures above. A missing/invalid/expired/revoked/
  epoch-stale/wrong-org/user token is ALWAYS `200 { admin: false }`. A whoami internal error (store
  blow-up) is a 500, never a 4xx (a 4xx would be an oracle).
- It NEVER grounds, bills, routes, or widens admission: it does not mount the allowance middleware
  and never touches the injected llm deps. `POST /app-assistant` is byte-for-byte unchanged - still
  header-scoped, still never reads the caller JWT for grounding/billing.

### 3. Panel detection - `api/assets/panel-runtime/src/AssistantPanel.jsx`
- `readPlatformToken()` reads `localStorage['ekoa_token']` (the key `web/lib/api/token.ts` uses)
  inside try/catch, swallowing the cross-origin/sandboxed-iframe `SecurityError` to `null`.
- A mount-only, once-guarded (`whoamiDoneRef`) effect calls `GET whoami` ONCE with `X-Ekoa-App-Id`
  and the token as an OPTIONAL `Bearer`, and stores `admin` (default false) in state. It is a cheap
  non-LLM GET - it never issues an assistant turn (zero-token invariant holds).
- DETECT-THEN-ASK: `admin: true` NEVER auto-enables anything. The only surface is a DISCREET,
  inert "Administrador" badge in the header (no onClick, no mode change, no privileged call),
  gated on `admin` so a false result renders nothing. `admin` is SET once (detection) and READ only
  to render the badge. The edit-mode switch + opt-in UX are H3 - not built here. (The badge is
  styled inline via the panel's CSS vars so it needs no edit to the non-reserved AssistantPanel.css.)

## whoami fail-closed matrix (asserted in `tests/apps/app-assistant.test.ts`)

| caller                                   | result            |
|------------------------------------------|-------------------|
| org-admin of the OWNER org               | 200 { admin:true} |
| the artifact owner (org-admin, owner org)| 200 { admin:true} |
| super-admin (any org)                    | 200 { admin:true} |
| org-admin of ANOTHER org                 | 200 { admin:false}|
| plain user of the owner org              | 200 { admin:false}|
| NO token                                 | 200 { admin:false}|
| INVALID token                            | 200 { admin:false}|
| EXPIRED token (would-be admin)           | 200 { admin:false}|
| EPOCH-STALE token (would-be admin)       | 200 { admin:false}|
| malformed X-Ekoa-App-Id                  | 400 (same as POST)|
| reserved `usr.` prefix app-id            | 400               |
| unknown app id                           | 404 NOT_FOUND     |

Route matrix runs over the REAL router (wired with THROWING llm deps - so any accidental
ground/route/bill blows the request up; none does, every case is 200/400/404), the REAL verify
chain (real `login`-minted tokens, in-memory activation, `bumpTokenEpoch` for the stale case,
a directly-signed past-exp token for the expired case) and REAL owner resolution over
mongodb-memory-server. Plus a fast pure `isOwnerOrgAdmin` grid (no I/O).

## Visitor-blindness exception justification

The served-app assistant plane is visitor-blind: `POST /app-assistant` derives org + billee ONLY
from the server-resolved OWNER, never from the anonymous visitor's JWT. whoami is a DECLARED,
DOCUMENTED exception to that blindness, for DETECTION ONLY: it is the one place the plane reads the
caller's platform JWT, and it does so solely to answer "is this viewer an admin of the owner org?".
It never grounds, never bills, never widens admission, and issues no model call. Every privileged
action remains gated server-side by the H1 admission plane with this same JWT; `admin: true` is a
HINT the panel surfaces, not a grant. Exposure honesty (per the decision memo): any same-origin
page can already read `localStorage['ekoa_token']`, so the panel reading it in-page widens nothing;
the mitigations are the pre-existing epoch/revocation machinery + H1 server-side gating. Recorded
so H6's codex pass sees it stated.

## Reserved-path compliance

All changes are within the reserved set EXCEPT two necessary, flagged touches:
- `api/tests/contract/schema-coverage.test.ts`: adding the `whoami` descriptor grows
  `allEndpointsFlat()` by one, and this gate is DESIGNED to fail unless the endpoint is accounted
  for. Added `'appAssistant.whoami'` to COVERED (keeps `EXPECTED_PENDING_COUNT` at 49 -
  `assistantChat` stays PENDING exactly as before). Flagged to the lead before editing.
- FIXED-12 diagram flag (NOT edited - out of reserved set, shared file): the whoami detection
  exception affects `docs/diagrams/10-privacy-boundaries.excalidraw` node `d1-text` (which states
  the assistant plane derives org/billee "NEVER from the anonymous visitor"). A one-line note that
  `GET .../whoami` is a detection-only exception (reads the JWT, never grounds/bills/widens) should
  be added there. Flagged to the lead with the exact node + proposed text rather than hand-editing
  a shared .excalidraw.

No commits, no stack ops - working tree only.

## Verification (all green, locally)

- `cd api && npx tsc --noEmit -p tsconfig.json` -> 0
- `npx tsc --noEmit -p tsconfig.test.json` -> 0
- `npx tsc --noEmit -p shared/tsconfig.json` -> 0; `web` tsc -> 0 (additive shared change)
- eslint touched .ts files -> 0 errors, 0 warnings
- `npx vitest run tests/apps tests/contract` -> 56 files, 536 tests, all pass
- `node assets/panel-runtime/build.mjs` -> built (panel compiles)
- repo root `npm run gate:chokepoint` -> clean
