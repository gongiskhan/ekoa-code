# H4 impl-notes - request-changes QUEUE (users file; org-admin converts) + refused-build feed

Slice H4 (mixed, size 5, dep H1). GREENFIELD: no existing queue. Built on the `Store<T>` +
notifications-SSE + registo org-admin-read primitives (H1 map §6). DONE-GREEN.

## What was built

A user files a change request from INSIDE a served app; the app OWNER's org-admins see it in a
dashboard queue and convert one into a patch run (an H1-gated follow-up build). Additive contract
only; no new capability/permission logic.

### 1. Shared contract - new `changeRequests` domain (additive)
- `shared/src/change-request.ts` (new): `ChangeRequestStatus` (`open|converted|dismissed`),
  `ChangeRequest` (`.strict()`), `ChangeRequestFileRequest`, `ChangeRequestConvertRequest`,
  `ChangeRequestQuery`, `ChangeRequestListResponse`, and `changeRequestsEndpoints` (file/list/
  convert/dismiss).
  - `appId`/`route`/`screenState`/`jobId` are OPTIONAL. `appId` is optional because the
    refused-build feed (a dashboard first-build refusal) has no served app yet; the panel filing
    always carries it. `orgId`/`requesterUserId`/`requesterName` are required and server-stamped.
- `shared/src/index.ts`: import + `export *` + `ALL_ENDPOINTS.changeRequests` (25 -> 26 domains).
- `shared/src/events.ts`: additive `change_request` `NotificationEvent` member (`{ type, appId? }`)
  - the live queue-refetch push. Additive union member; existing parses unaffected.
- `shared/src/contract.test.ts`: the "loads all N domain descriptor maps" count 25 -> 26.

### 2. File a request (any logged-in user)
- `POST /api/v1/change-requests` (auth `user`), registered BEFORE the org-admin gate so a plain
  `user` can file (filing needs NO capability; the queue READ is admin-gated). Scoped by the
  OPTIONAL `X-Ekoa-App-Id` header:
  - present -> `resolveApp` resolves the app + its OWNER; the request lands in the OWNER org queue
    (fail-closed: unknown / registry-only / ownerless id -> 404, like the app-assistant plane).
  - absent -> the dashboard refused-build filing: lands in the requester's OWN org (body `appId`
    kept only as an informational label; convert re-gates it).
- `requesterUserId`/`requesterName`/`orgId` come from the verified JWT / resolved owner - NEVER the
  caller body. Lands `status:'open'` + fires a `change_request` SSE to the OWNER org's org-admins.
- Panel side (`api/assets/panel-runtime/`): a `change-request.js` fetch-injectable controller
  (`fileChangeRequest` -> `filed | needs-login | failed`) + a NON-admin "Pedir alteração"
  affordance in `AssistantPanel.jsx` (gated by `admin === false`), OFF by default, opened only by
  an explicit click; submit captures `currentRoute()` + `captureScreenState()`. No token / a 401
  both land on the calm "Inicie sessão no Ekoa para pedir alterações." A SEPARATE plane from the
  visitor-blind `POST /api/app-assistant` (which is byte-for-byte untouched - it still never reads
  the caller JWT).

### 3. Org-admin queue (read + convert + dismiss)
- `GET /api/v1/change-requests` (auth `org-admin`): mirrors `registo.ts` EXACTLY -
  `requireRole('org-admin','super-admin')` for the ROLE gate; the org SCOPE is enforced in the
  service (org-admin OWN org only; super-admin across orgs, optional `?orgId=`). Optional `status`
  filter. Newest first.
- `POST /:id/convert` (`{ jobId }`) / `POST /:id/dismiss`: org-scoped via a shared `loadOwnOrg`
  guard - a missing row OR a cross-org row reads as the SAME 404 (no cross-org existence oracle).
- Web dashboard: `web/app/(dashboard)/pedidos/page.tsx` (mirrors `registo/page.tsx`), a new
  `adminOnly` nav item in `web/lib/navigation.ts` (`/pedidos`, raw PT label "Pedidos", like
  registo/orgs), `web/stores/change-requests.ts`, and the `changeRequests` domain wired into the
  typed client `web/lib/api/index.ts`. "Converter" POSTs `/api/v1/jobs {kind:'build', description,
  sessionId, artifactId?}` directly (H1-gated: the org-admin has canBuildApps+canEditApps and
  loadWritable on an org app) then POSTs `/:id/convert {jobId}`. The page subscribes to the
  notifications stream and refetches on `change_request` (live queue).

### 4. Refused-build feed (thin wire)
- Server: the file endpoint's own-org path (no `X-Ekoa-App-Id`) IS the durable wire - a refusal
  (`FORBIDDEN` + `details.capability`, already emitted by jobs/chat/artifacts routes) can file a
  pre-drafted request to the requester's OWN org queue, so a refusal is never a dead end.
- Client: `web/stores/change-requests.ts` exposes `fileFromRefusal({ text, appId?, route? })`.
- DELIBERATELY NOT wired into the shared chat execution hook (`web/hooks/useAgentExecution.ts`) /
  chat message renderer: those are OUTSIDE H4's reserved set and concurrently owned; the brief
  scopes this piece as a "THIN wire (client OR a small server helper)" with NO required test. The
  durable mechanism (own-org endpoint + store action) is in place and integration-tested; dropping
  the offer button into the chat error path is a one-call hook the chat owner adds without touching
  H4's contract. Adding capability logic was explicitly forbidden and none was added.

## Cross-org isolation guarantee (the security crux) + how it is tested

A `ChangeRequest.orgId` is ALWAYS stamped server-side (the app OWNER's org for a served-app
filing - resolved from the owner user record; the requester's OWN org for a refused-build filing -
from the JWT) and is NEVER read from the caller body. Every read/convert/dismiss is org-scoped in
`services/change-requests.ts` exactly as `readRegisto` scopes: org-admin -> OWN org only;
super-admin -> across orgs. Cross-org convert/dismiss collapse to a uniform 404 (no existence
oracle). Tested (`api/tests/routes/change-requests.test.ts`, real router + mongo-mem):
- topology: `reqU` (plain user, orgA) files about `appX` which is OWNED by `admB` in orgB -> the
  request lands in orgB (the OWNER org, NOT reqU's orgA);
- `admB` (orgB) sees it; `admA` (orgA) sees NONE of it (`total===0`, no reqU row, all rows orgB);
- a plain `user` GET the queue -> 403 FORBIDDEN (shared envelope);
- `admA` converting orgB's request -> uniform 404; `admB` converting -> `converted` + `jobId`;
- the refused-build own-org filing lands in reqU's orgA and surfaces to admA, not admB.

## Flows

- File (panel): non-admin clicks "Pedir alteração" -> compose -> submit -> `change-request.js`
  POSTs `/api/v1/change-requests` with `X-Ekoa-App-Id` + Bearer + `{text, route, screenState}` ->
  200 -> "Pedido enviado"; 401/no token -> "Inicie sessão".
- Convert (dashboard): org-admin clicks "Converter" -> POST `/jobs {artifactId?, description}`
  (H1-gated follow-up/first build) -> POST `/:id/convert {jobId}` -> row flips to `converted` +
  `jobId`.
- Refused-build feed: an H1 `FORBIDDEN`+`capability` refusal -> `fileFromRefusal` POSTs the file
  endpoint with NO app header -> lands in the requester OWN org queue.

## Contract / coverage gate updates
- `api/tests/contract/schema-coverage.test.ts`: added the 4 `changeRequests.*` keys to COVERED so
  `EXPECTED_PENDING_COUNT` stays 49 (a new endpoint => a new contract test, same slice).
- `api/tests/contract/mount-coverage.test.ts`: unchanged - all 4 endpoints mount under `/api/v1`
  behind `requireAuth`, so the unauthenticated probe sees 401 (mounted), never the terminal 404.
- New contract test `api/tests/contract/change-requests.test.ts` (shapes + live-response schema
  validation); new integration test `api/tests/routes/change-requests.test.ts` (a NEW `tests/routes/`
  dir); new panel test `api/tests/apps/change-request.test.ts` (controller fake-fetch + source pins).

## Reserved-path compliance
In-set: `shared/src/change-request.ts` (+ `index.ts`, `events.ts`, `contract.test.ts`),
`api/src/data/stores.ts`, `api/src/routes/change-requests.ts` (+ `server.ts` mount),
`api/src/services/change-requests.ts`, `api/src/agents/streaming.ts` (emit helper),
`api/assets/panel-runtime/src/{change-request.js, AssistantPanel.jsx, AssistantPanel.css}`,
`web/app/(dashboard)/pedidos/page.tsx`, `web/stores/change-requests.ts`, `web/lib/navigation.ts`,
`web/lib/api/index.ts`, `web/__tests__/navigation.test.ts`, `api/tests/**`,
`docs/diagrams/03-request-crud.excalidraw`.

Out-of-declared-set (justified):
- `web/lib/navigation.ts` (the nav item; the actual `NAV_ITEMS` source, not `sidebar.tsx`) and
  `web/lib/api/index.ts` (typed-client domain map) - both required to surface the queue and were
  named in the lead's expanded web set.
- `api/src/agents/streaming.ts` - the emit helpers for the notifications channel live here (route
  imports it; a route may import `agents/`, precedent `jobs.ts`). No `data/` access from the route.
- `web/__tests__/navigation.test.ts` - pinned the new admin nav item (the web-test analog; the
  sibling registo page has no dedicated web page/store test, so no page-render test was added).
- Locale copy: followed the registo precedent (inline PT-PT strings + a raw nav `label`), NOT the
  locale files - registo/orgs (the named closest precedents) keep Amendment-2 admin surfaces out of
  `web/locales/*`. Documented so a reviewer sees the deliberate parity choice.

Import boundaries respected: the route imports `apps/registry` (resolveApp) + `agents/streaming`
(emit) + the service; the service imports only `data/stores` (+ shared). No route touches `data/`.
Chokepoint clean (nothing outside `api/src/llm` touches the provider).

## Diagram (FIXED-12)
`docs/diagrams/03-request-crud.excalidraw` - one free-standing note (`h4_change_requests`, indigo
`#4338CA`, monospace, x=70 y=1430, below all existing elements, no overlap) documenting the
file -> owner-org queue -> convert flow, the registo-mirrored org scoping + CROSS-ORG ISOLATION, and
the refused-build own-org path. +1 element, valid JSON.

## Verification (all green)
- `cd api && npx tsc --noEmit -p tsconfig.json` -> 0; `-p tsconfig.test.json` -> 0
- `npx eslint <touched api+shared .ts>` -> 0 errors (panel `.js/.jsx/.css` are config-ignored;
  esbuild `build.mjs` is their gate)
- `npx vitest run tests/` (FULL api lane) -> 177 files, 1601 passed, 1 skipped, 0 failed
- `node assets/panel-runtime/build.mjs` -> built (248463 bytes)
- repo-root `npm run gate:chokepoint` -> clean
- `cd shared && npx vitest run` -> 2 files, 36 passed
- `cd web && npx tsc --noEmit` -> 0; `npx eslint <touched>` -> 0; `npm test` -> 30 files, 168 passed

## Codex-fix round (HIGH - cross-org queue INJECTION)

Codex review of H4 found a real HIGH: `POST /api/v1/change-requests` with an `X-Ekoa-App-Id`
resolved ANY app by id/slug and stamped the request into that RESOLVED APP OWNER's org with NO
check that the requester could access the app - so an org-A user who knew/guessed an org-B app
id/slug could inject a request into org-B's `/pedidos` queue and fire a live notification to org-B's
admins (a cross-org write / isolation break). The original test baked this in as expected.

FIX (`api/src/routes/change-requests.ts`): the served-app filing path now gates on
`loadReadable(actorOf(req), app.appId)` (apps/app-paths.ts) BEFORE resolving/stamping. `loadReadable`
returns the artifact only when it is the requester's OWN app or an org-shared app WITHIN THE
REQUESTER's OWN org (it rejects any cross-org row, another user's private row, or an unknown id).
A `null` verdict -> a UNIFORM 404 (indistinguishable from an unknown app, so it is NOT a cross-org
existence oracle). Because a readable app is ALWAYS in the requester's own org, the owner-org stamp
(kept unchanged, resolved from the owner user record) is now reachable ONLY for apps the requester
can see - so a request can never land in, or notify, another org. The refused-build path (no
`X-Ekoa-App-Id`) is unchanged: it already stamps the requester's OWN org and needs no app gate.

TESTS (`api/tests/routes/change-requests.test.ts`, retopologised): all filers are `reqU` (plain
user, orgA); seeded apps `appA` (orgA org-shared, owned by admA), `appOwn` (orgA private, owned by
reqU), `appApriv` (orgA private, owned by admA), `appB` (orgB org-shared, owned by admB).
- FLIPPED: the old "files about an org-B app -> lands in org-B" now asserts 404 + NO row created
  anywhere + org-B's admin queue empty (no injection, no notification).
- ADDED: files about `appA` (org-shared, own org) -> 200 stamped to orgA; files about `appOwn`
  (own) -> 200; files about `appApriv` (another user's private, same org) -> 404.
- Read-isolation + convert/dismiss cross-org tests kept, retargeted to the orgA request (admA acts;
  admB cross-org -> 404). Refused-build own-org test kept (files with no header -> orgA).

VERIFY (all green): api tsc src 0 / test 0; eslint touched 0; `vitest run tests/routes tests/contract
tests/apps` -> 60 files, 593 passed; `npm run gate:chokepoint` clean; `node
assets/panel-runtime/build.mjs` OK. (H4 subset: 3 files, 23 passed - up from 20, +3 access-gate
cases.)
