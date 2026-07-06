# 03. API design

This chapter is the complete REST resource map for the rebuilt Cortex API. It defines the protocol foundations (base path, auth, errors, conventions), the async job pattern, the four SSE endpoints with their typed event unions, the WebSocket carve-outs, one endpoint table per domain, the served-app data plane (preserved byte-compatibly), and the ekoa-local surfaces. Every operation in reference/operations-inventory.md (sections 0-24, raw HTTP, SSE inventory, served-app surface) maps to an endpoint here or appears in Appendix A (Dropped operations) with a reason. The current frontend is the functional contract; endpoint shapes are deliberately redesigned (FIXED-9). The API is designed as if a second client could consume it later (FIXED-10).

## 3.1 Protocol foundations

- **Resource-oriented REST** at base path `/api/v1` (FIXED-2). Request-response by default; JSON bodies; SSE only where a genuine stream exists (section 3.6); no WebSockets between frontend and API (carve-outs in 3.7).
- **No generic command endpoint.** The old `POST /api/v1/action` (app/name/params envelope), `POST /api/v1/request`, `POST /api/v1/request/cancel`, and the single global `GET /api/v1/events` stream are all retired and replaced by the typed resources below (reference/operations-inventory.md section 0.1; FIXED-2). Every operation that rode them is mapped in section 3.8.
- **One response shape per endpoint.** The old protocol sometimes wrapped results in a legacy envelope that the client had to unwrap (reference/operations-inventory.md section 0.2, landmine 1). The new API returns exactly one JSON shape per endpoint, defined by a zod schema in `shared/` (FIXED-1). No envelope, no dual shapes (landmine 7: the artifact list returns one object shape, never a bare array).
- **Validation at the route boundary.** Every request body, path param set, and query string is validated by the shared zod schema before the route logic runs; failures return `400 VALIDATION_FAILED` with the zod issue list in `error.details`. Responses are validated in development/test builds against the same schemas (contract tests, chapter 13).
- **Schema naming convention.** One file per domain in `shared/` (e.g. `shared/auth.ts`, `shared/artifacts.ts`, `shared/events.ts` for the SSE unions, `shared/errors.ts` for the error envelope). Each schema is exported as a zod object; the TypeScript type is inferred from it. Endpoint tables below name the schemas without the file prefix (e.g. `LoginRequest` lives in `shared/auth.ts`).
- **Client generation.** The web client is a thin typed REST client generated from `shared/` (FIXED-9). Nothing in the API references frontend concepts (FIXED-10).
- **Errors use real HTTP status codes.** The old convention of returning handler errors as HTTP 200 with an error payload (reference/invisible-behaviors.md section 1.2) is retired. This is a breaking wire change permitted because the web client migrates in the same program (FIXED-9).
- **Structural changes update diagrams.** Any change to this API surface updates the request/CRUD flow diagram `spec/diagrams/03-request-crud` in the same unit of work (FIXED-12).

## 3.2 Authentication and authorization

**FIXED (FIXED-8; CONV-1):** `Authorization: Bearer <JWT>` on every `/api/v1` endpoint except the exemptions below. JWTs are minted by the auth domain only (single mint point carried, reference/invisible-behaviors.md section 1.3). Managed OAuth credentials for the model live server-side only; no raw API keys anywhere in this surface.

| Auth class | Applies to | Mechanism |
|---|---|---|
| `public` | `POST /auth/login`, `POST /auth/device`, `POST /auth/device/poll`, `GET /health`, `/api/demos*`, static assets (3.8.23) | none |
| `user` | default for all `/api/v1` resources | Bearer JWT; user-scoped data access enforced in the data layer (uniform not-found on ownership mismatch, chapter 04) |
| `super-admin` / `org-admin` | marked per endpoint | Bearer JWT + role claim. Three roles total: `super-admin` (platform-wide), `org-admin` (org administration), and `builder` (the default `user`-class member). JWT claim set is `{sub, role, scope, orgId, username}` (orgId replaces companyId); roles and scope strings carried from reference/invisible-behaviors.md section 1.3, remapped to the three-role model per Amendment 2 |
| `token-query` | the four SSE endpoints (3.6) | `?token=<JWT>` because EventSource cannot set headers (carried behavior; CONV-1) |
| `HMAC` | `POST/GET /hooks/:triggerId` | provider signature verification; disabled-check after signature (410 signed / 401 unsigned, reference/invisible-behaviors.md section 12.2) |
| `header-scoped` | served-app data plane (3.9) | `X-Ekoa-App-Id` header and/or per-app SSO cookie; deliberately no platform JWT (reference/data-inventory.md section 3.3) |
| `optional-JWT` | the `/api/integration/:key/*` credential-injection proxy in 3.9 | JWT validated if present (invalid gives 401), absent proceeds for same-origin served apps (reference/invisible-behaviors.md section 1.2) |
| `app-id-gated` | the `/api/m365/*` workspace Graph proxy in 3.9 | **RESOLVED (Q-10):** requires and verifies `X-Ekoa-App-Id` (slug-resolved, charset-checked, app exists and is served) plus a per-app manifest opt-in flag; optional JWT still validated if present; gate owned by chapter 09 section 9.4 |

Every authenticated `/api/v1` request additionally passes an activation check: immediately after JWT verification and the revocation-list check (3.2), the auth middleware consults the cached activation state (an in-memory map with write-through invalidation, kept current by the toggle write; chapter 09). A deactivated account fails `403 ACCOUNT_DISABLED` and a billing-locked account `402 BILLING_LOCKED` (3.3), on every authenticated surface. This middleware is the first of three admission planes that consult the same activation state: the second is the served-app plane gate (3.9), keyed on the artifact owner's activation; the third is the bridge pairing plane (chapter 18), keyed on the pairing owner's activation. (Amendment 2, Part 3: founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md).)

Token lifecycle rules:

- Login returns a JWT with expiry 30 days when `rememberMe`, else 24 hours (carried, reference/invisible-behaviors.md section 1.3).
- Device login (RFC-8628-style) is carried: start (public), poll (public, single-use approval, `slow_down` pacing), approve (authenticated, binds to approver) (reference/invisible-behaviors.md section 1.4).
- **RESOLVED (P-03): explicit `POST /auth/refresh` and a server-side revocation list.** `GET /auth/me` returns identity only, never a token; `POST /auth/refresh` (authenticated) mints a fresh token and also performs the role-drift self-heal (the old side-effect refresh that piggybacked a fresh token on the "who am I" call is retired, reference/operations-inventory.md section 1, landmine 5). Logout is a server-side operation: `POST /auth/logout` (3.8.1) revokes the presented token, and its admin body variant `{ userId }` revokes all of that user's tokens. Revocation is enforced by a server-side revocation list - an in-memory set backed by the small persisted `revoked_tokens` collection (chapter 04 section 4.3.1), loaded at boot and checked by the auth middleware on every request (O(1) membership test; correct under the single-process model FIXED-8; survives restart via the collection, which self-prunes on token expiry). A request presenting a revoked token fails `401` with the standard error envelope (3.3). Rejected alternative: stateless JWTs with no revocation list, where logout is a client-side token discard - dropped because it leaves no server-side way to invalidate a compromised or explicitly logged-out token. Resolved: ALTERNATIVE (server-side revocation list backed by a persisted `revoked_tokens` collection; explicit `POST /auth/refresh` kept), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).
- **RESOLVED (Q-05):** `?token=` is appended to `/apps/...` preview URLs for non-shareable artifacts (cross-origin dev iframes cannot share cookies) and deliberately omitted for shareable ones (reference/operations-inventory.md landmine 4; reference/frontend-cleanup-audit.md FC-068). The token-in-URL leak risk (tokens reaching logs/history) is contained by log-redaction middleware on the server (chapter 09), not by dropping the parameter. Resolved: defaulted to recommendation per amendment Part 1 (carry `?token=` for non-shareable previews plus log redaction), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).
- Cross-origin note: production serves web and API from different origins (`app.` vs `api.`), so the API sends CORS headers for the web origin, and cookies are not relied on for `/api/v1` (reference/operations-inventory.md section 0.1).

## 3.3 Error model

**FIXED (CONV-2).** Every non-2xx response carries:

```json
{ "error": { "code": "UPPER_SNAKE", "message": "user-safe, PT-aware", "details": { } } }
```

- `code` is a stable machine-readable string; `message` is safe to show to the user and localized PT-PT where the surface is PT (e.g. `"Tente novamente dentro de um minuto."` on 429); `details` is optional structured context (e.g. zod issues, `safetyNetSnapshotId`).
- Every error message passes the egress anonymisation/sanitisation chokepoint before leaving the process (FIXED-8; chapter 09).

Status conventions and carried special cases:

| Status | Code examples | Carried behavior |
|---|---|---|
| 400 | `VALIDATION_FAILED` | zod issues in `details.issues` |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED` | PT copy example: `"Sessão expirada. Inicie sessão novamente."` |
| 402 | `BILLING_BLOCKED`, `BILLING_LOCKED` | `BILLING_BLOCKED`: pre-run billing gate refusal on synchronous request-response entries (chapter 06 section 6.6.3); asynchronous run-creating entries have already returned `202` and surface the block as a terminal `error` event with the same code (chapter 05 section 5.2); PT copy: `"Limite de utilização atingido. Fale com o administrador ou aguarde o início do próximo período."`. `BILLING_LOCKED` (Amendment 2): account-level billing lock raised at admission by the activation planes (3.2, 3.9, chapter 18), distinct from period-allowance exhaustion; PT copy: `"A sua conta tem um problema de faturação. Contacte o suporte."` |
| 403 | `FORBIDDEN`, `ACCOUNT_DISABLED` | role/scope failures; served-app allowlist rejections keep their PT messages (reference/invisible-behaviors.md section 8.10); `ACCOUNT_DISABLED` (Amendment 2) raised at admission when the account - or, on the served-app plane, the artifact owner - has `active=false` (3.2, 3.9, chapter 18); PT copy: `"A sua conta está bloqueada. Contacte o suporte."` |
| 404 | `NOT_FOUND` | also returned on cross-user ownership mismatch (uniform not-found, chapter 04) |
| 409 | `DAEMON_NOT_CONNECTED`, `DUPLICATE_BUILD`, `SLUG_TAKEN`, `MANIFEST_ID_MISMATCH` | daemon-not-connected on agent-face runs is load-bearing (reference/invisible-behaviors.md section 7.5); bundle-update mismatch drives the client force-confirm dialog (reference/operations-inventory.md section 8) |
| 410 | `TRIGGER_DISABLED` | disabled trigger with valid signature (reference/invisible-behaviors.md section 12.2) |
| 413 | `PAYLOAD_TOO_LARGE` | upload limits carried (500 MB staging, 50 MB knowledge default) with PT message |
| 422 | `SECRET_GUARD_BLOCKED` | code download blocked because secrets were detected; the client surfaces distinct copy (reference/operations-inventory.md section 8) |
| 429 | `RATE_LIMITED` | served-app service endpoints keep sliding-window limits and the PT message; a blocked hit does not extend its own cooldown (reference/invisible-behaviors.md section 8.10) |
| 500 | `INTERNAL` | sanitized; never leaks stack traces or paths |
| 502/503 | `UPSTREAM_FAILED`, `UPSTREAM_UNAVAILABLE` | proxy and scrape targets (Graph proxy 502; Citius portal 503 with clean PT copy) |

## 3.4 Conventions

- **IDs are server-minted and opaque.** The old client-minted `trace_id` is replaced by server-minted `runId`/`jobId` returned from the creating POST (FIXED-9 shape change). Duplicate-submit protection for first builds keeps the TTL reservation mechanic (chapter 05).
- **Pagination:** list endpoints that paginate take `?limit=` and `?offset=` and return `{ items, total }`. (The old mixed `page/limit` and `offset/limit` styles are normalized; the generated client hides this from pages.)
- **Timestamps** are ISO-8601 UTC strings.
- **Long-running HTTP calls** get explicit route-level timeouts where today's client hardcodes them: integration-builder chat 300 s, integration test 60 s (reference/frontend-cleanup-audit.md FC-043); default 120 s elsewhere.
- **Binary uploads** are raw-body POSTs with metadata headers (not multipart), carrying today's contracts: `POST /api/v1/uploads` with `X-Filename`/`X-Folder` (limit 500 MB) and `POST /api/v1/knowledge/uploads` with `X-Filename`/`X-Collection` (limit 50 MB default) (reference/operations-inventory.md section 23; reference/invisible-behaviors.md section 1.2). Upload responses return an opaque `uploadId` plus display metadata; the old absolute-server-path leak is retired, and job/chat requests reference attachments by `uploadId` (FIXED-9).
- **Language:** requests that produce user-visible model output carry an explicit `language` field (default `pt`), set by a client-side request interceptor from the single language source (replaces the localStorage injection described in reference/operations-inventory.md landmine 11). On the web-client surface these are exactly four: chat run create (3.8.7), build job create (3.8.8), integration-builder chat (3.8.14), and automation plan (3.8.18) - the same four chapter 12 section 12.2.3 flags for the interceptor. The served-app assistant endpoint (3.9.1) is outside this convention: a served app has no platform language source, so the reply language follows the artifact's configuration and the end-user's message.

## 3.5 Async job pattern

**FIXED (CONV-3):** every long-running operation follows one pattern:

1. `POST /api/v1/<resource>` creates the job/run and returns `202` with `{ id, status, ... }`.
2. `GET /api/v1/<resource>/:id` returns current state (used for post-reconnect re-sync).
3. `GET /api/v1/<resource>/:id/events` streams typed progress events (SSE).
4. `POST /api/v1/<resource>/:id/cancel` aborts server-side. **Closing the SSE stream must never stop the run; cancel is always this explicit call** (reference/operations-inventory.md section 0.1). Cancel is owner-scoped and idempotent (chapter 05).

Three resources use the full pattern: chat runs, build jobs, automation runs. Brand research creates a job (`kind: 'brand-research'`) and reuses the jobs resource for state and events rather than owning a fifth stream (reference/operations-inventory.md section 4 assesses its stream need as partial).

## 3.6 SSE endpoints and typed event unions

**FIXED (FIXED-2; CONV-4): exactly four SSE endpoints.** Everything else is request-response or client-side polling (which today already covers crawl status, session-capture status, and preview readiness probes - reference/operations-inventory.md section 0.3). All four authenticate via `?token=` (3.2). Event unions live in `shared/events.ts` and are derived from the actual consumers (reference/frontend-cleanup-audit.md section 1.2); dead events are dropped (Appendix A).

SSE mechanics (all four endpoints):

- Frames are `event: <type>` + `data: <json>` + monotonic `id:`; clients resume with `Last-Event-ID` and the server replays from a bounded per-stream ring buffer (carried: 200 events, swept after 300 s idle - reference/invisible-behaviors.md section 1.2).
- Keepalive comment every 30 s (carried) - connection-liveness only: comment frames keep proxies and other intermediaries from closing idle streams, and EventSource never surfaces them to application code. Application-level silence watchdogs (e.g. the 3-minute brand-research watchdog) are re-armed by typed events and by stream reconnect, never by keepalives (reference/frontend-cleanup-audit.md FC-034; chapter 12 section 12.3).
- Each stream opens with a `ready` event; after reconnect the client re-syncs state via the corresponding `GET /:id` (the old `connected`-event re-sync pattern, reference/frontend-cleanup-audit.md FC-026).

### 3.6.1 `GET /api/v1/chat/runs/:id/events` - chat turn stream

Union `ChatRunEvent` (from consumers in reference/frontend-cleanup-audit.md FC-031):

| Event | Payload sketch | Notes |
|---|---|---|
| `ready` | `{ runId }` | subscribe ack |
| `text_chunk` | `{ text }` | progressive assistant text; the three legacy chunk field names (`text`/`content`/`delta`) are normalized to one (FC-031) |
| `tool_event` | `{ phase: 'started'\|'finished'\|'failed', tool, args?, result?, isError?, durationMs? }` | drives live activity display |
| `context_event` | `{ name, action: 'loaded'\|'used' }` | agent context content loaded/used (replaces the legacy event of the same purpose) |
| `complete` | `{ result?, durationMs, delegate?: { kind: 'build'\|'integration', request } }` | terminal; `delegate` mirrors the notification-channel handoff for the originating run |
| `error` | `{ code, message }` | terminal, sanitized |

Delegation is a first-class typed event: the model's in-band handoff markers are parsed server-side in the run pipeline, which emits `build_intent` / `integration_build_intent` on the notifications channel (3.6.4) and stamps `complete.delegate` on the run stream (chapter 05 section 5.7.2; reference/frontend-cleanup-audit.md FC-205). No prose markers ever cross the API.

### 3.6.2 `GET /api/v1/jobs/:id/events` - build/brand-research job stream

Union `JobEvent` (from reference/frontend-cleanup-audit.md FC-026):

| Event | Payload sketch | Notes |
|---|---|---|
| `ready` | `{ jobId }` | |
| `routing` | `{ tier, reason }` | model-tier decision badge |
| `text_chunk` | `{ text }` | agent output stream |
| `tool_event` | same as chat | file-tree extraction on the client keys off tool names/args (FC-026) |
| `context_event` | same as chat | |
| `plan_step` | `{ status, description?, detail? }` | phase/status lines; also absorbs the information the retired phase events carried (RESOLVED (P-11), owned by chapter 05) |
| `preview_reload` | `{ }` | preview iframe bump. Today this event is dead on the wire due to a client registration bug (reference/operations-inventory.md C5.2); the new contract includes it and the migrated client consumes it (FC-026 keeps it in the typed stream) |
| `complete` | `{ durationMs, result?, artifactId?, slug?, appUrl? }` | terminal; drives preview refresh to the slug URL |
| `error` | `{ code, message }` | terminal, sanitized |

### 3.6.3 `GET /api/v1/automations/runs/:id/events` - automation run stream

Union `AutomationRunEvent` (from reference/frontend-cleanup-audit.md FC-028; payload details reference/operations-inventory.md section 21):

| Event | Payload sketch |
|---|---|
| `ready` | `{ runId }` |
| `step` | `{ runId, stepIndex, status, ... }` |
| `step_output_chunk` | `{ stepIndex, stream: 'stdout'\|'stderr', chunk }` |
| `patch` | step-plan patch applied mid-run |
| `paused` | `{ service }` (awaiting integration connection) |
| `pause_for_user` | `{ stepIndex, reasoning, userInstructions, failureMessage?, screenshotUrl? }` |
| `resumed` | `{ }` |
| `streaming_available` | `{ token, wsUrl, viewport }` (live browser view handoff to the scoped canvas media channel, 3.7) |
| `awaiting_consent` | `{ stepIndex, shape, argv, description }` |
| `awaiting_daemon` | `{ stepIndex, capability: 'browser'\|'bash', reason }` |
| `complete` | `{ summary }` (terminal) |
| `error` | `{ code, message }` (terminal) |

The run status machine (`idle -> running -> completed/failed/cancelled/awaiting_integration/paused_for_user/awaiting_consent/awaiting_daemon`) is carried (reference/operations-inventory.md section 17). After a reload the client recovers the active run id by querying `GET /automations/runs?automationId=` (3.8.18) and then opens this per-run stream (chapter 12 section 12.3); the old pattern of hydrating the run id from the first event was an artifact of the retired global stream and is retired with it - a per-run endpoint requires the run id before subscribing.

### 3.6.4 `GET /api/v1/notifications/events` - per-user push channel

One lightweight per-user channel for genuine cross-surface server pushes: events that fire when no request is pending (reference/operations-inventory.md section 0.3). Union `NotificationEvent`:

| Event | Payload sketch | Purpose |
|---|---|---|
| `build_intent` | `{ sessionId, sourceRunId, request: { description, artifactId?, ... } }` | chat classified the turn as a build; client starts a job (reference/operations-inventory.md section 7) |
| `chat_answer` | `{ sessionId, sourceRunId, text }` | in-build classifier answered a question out-of-band; server suppresses these for cancelled runs (today the client filters - fixed in the rebuild) |
| `integration_build_intent` | `{ sessionId, hint? }` | flip the side panel to the integration builder |
| `integration_ready` | `{ integrationKey }` | resumes a paused build after an integration is saved (landmine 6 - this cross-surface coupling is deliberate and documented here) |
| `usage_updated` | `{ }` | client refetches `GET /billing/usage` |

**RESOLVED (P-04): notifications channel scope.** The channel carries exactly the five events above. The cosmetic in-flight token ticker (`usage_progress`) is dropped, and the integration-builder incremental prose stream (`builder_text`) is dropped in favor of the request-response result (its correlation is broken by design today - reference/frontend-cleanup-audit.md FC-035 - and reference/operations-inventory.md section 0.3 rates it degradable). Rejected alternative: a run-correlated `integration_builder_text` event keyed by `builderSessionId` - deferrable and additive, so not built in v1 (the builder works without streaming). Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

**RESOLVED (P-13): usage push vs poll.** `usage_updated` stays on this channel (cheap, already consumed by the header gauge). Rejected alternative: drop it and poll `GET /billing/usage` on an interval. Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### 3.6.5 Dropped stream surface

Dropped from the wire entirely, with reasons in Appendix A: `file_data`, `action_result`, `action_complete`, `action_error`, `auth_result`, `usage_progress`, `action_stream`, plus the never-reachable `phase_changed` and `subagent_event` pair (RESOLVED (P-11), chapter 05; the register-or-delete question is settled - RESOLVED (Q-04) deletes both the producers and the dead client handlers).

## 3.7 WebSocket carve-outs

**FIXED (FIXED-2): no WebSockets in the frontend-to-API protocol.** Two WS surfaces exist outside that protocol:

1. **Bridge WS (Cortex as server, ekoa-local daemon dials out):** HTTP Upgrade on `/api/v1/bridge/connect/:connectionId`, Bearer-token auth preferred with `?token=` accepted only as a transition fallback slated for removal (the "bridge upgrade path"); token minted via `POST /api/v1/bridge/token` (3.10). Ported as-is per reference/carryover-audit.md B16; the daemon wire protocol (zod schemas) is the compatibility contract. Out of redesign scope (FIXED-1: the pattern where Cortex commands local tools through ekoa-local is unchanged).
2. **Live browser view canvas (pause-for-user):** genuinely bidirectional (JPEG frames down, mouse/keyboard up); URL + short-TTL token + viewport arrive in the `streaming_available` automation event (reference/operations-inventory.md section 22; 3.6.3). **RESOLVED (Q-01):** this is the one scoped exception to FIXED-2, whose amended text reads "No WebSockets between frontend and Cortex as API transport; one scoped exception exists for the live browser canvas media channel (frames down, input events up, short-TTL token, never JSON API payloads)." The canvas is a screen-share, not API traffic: frames stream down, input events go up, the short-TTL token authenticates the socket, and no JSON API payload ever crosses it. Ported per reference/carryover-audit.md B17, preserving the close-code contract: 1000 is a normal close, 4000 is a takeover after which the client never reconnects (landmine 8). Rejected alternative: drop the interactive live canvas and keep only screenshot-based pause UI. Resolved: ALTERNATIVE (carve-out a - the live browser canvas is a scoped media-channel exception to FIXED-2), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 3.8 Domain resource map

Every table row cites the operation it replaces in reference/operations-inventory.md (column "Replaces"). Values in the "Replaces" column are verbatim old-system operation names quoted from that inventory (always backticked); they are citations of the old surface, not vocabulary used by this spec. Auth is `user` unless stated. Schemas live in `shared/<domain>.ts`.

### 3.8.1 Auth - `/api/v1/auth` (replaces ops-inventory section 1)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| POST `/auth/login` | `LoginRequest {username, password, rememberMe}` -> `LoginResponse {token, user, passwordChangeRequired, expiresIn}` | public | `login`; expiry 30 d / 24 h per `rememberMe` |
| POST `/auth/password` | `ChangePasswordRequest {currentPassword, newPassword}` -> `{ ok }` | user | `change-password`; clears `passwordChangeRequired` |
| GET `/auth/me` | -> `AuthUser` | user | `get-me`; **no token piggyback** (RESOLVED (P-03)) |
| POST `/auth/refresh` | -> `{ token, expiresIn }` | user | **RESOLVED (P-03)**; absorbs role-drift self-heal; also backs the ekoa-local TUI refresh (reference/invisible-behaviors.md section 1.3) |
| POST `/auth/device` | -> `DeviceStartResponse {deviceCode, userCode, verificationUri, interval, expiresIn}` | public | `device-start` |
| POST `/auth/device/poll` | `{ deviceCode }` -> `DevicePollResponse` (status union incl. `slow_down`) | public | `device-poll`; approval single-use |
| POST `/auth/device/approve` | `{ userCode, deny? }` -> `{ ok }` | user | `device-approve`; binds to approver only; backs the `/activate` page |
| POST `/auth/logout` | `LogoutRequest { userId? }` -> `{ ok }` | user / super-admin / org-admin | **RESOLVED (P-03)**; revokes the presented token by adding it to the `revoked_tokens` collection; the `{ userId }` body variant (super-admin anywhere, org-admin scoped to its own org - mirroring `PATCH /users/:id`, 3.8.2) revokes every token of the named user; a subsequently presented revoked token fails `401` (3.2, 3.3) |

Logout is a server-side operation under RESOLVED (P-03): `POST /auth/logout` revokes the token via the persisted `revoked_tokens` collection (chapter 04 section 4.3.1), which the auth middleware checks on every request (3.2). The admin body variant `{ userId }` revokes every token for the named user (for example on forced sign-out or role removal).

### 3.8.2 Users - `/api/v1/users` (sections 1, 2)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| GET `/users` | -> `{ items: AuthUser[] }` | super-admin / org-admin | `ekoa.users/list`; super-admin lists all orgs, org-admin its own org only |
| POST `/users` | `CreateUserRequest {username, password, role, orgId?}` -> `AuthUser` | super-admin | `ekoa.auth/create-user`; created with `passwordChangeRequired: true`; `orgId` is part of the create contract - supplied, it places the user in that org; omitted, it auto-creates a new org with this user as its org-admin (Part 4) |
| PATCH `/users/:id` | `UserPatch { role?, active? }` -> `AuthUser` | super-admin / org-admin | activation and role change; super-admin anywhere, org-admin scoped to its own org (role toggle between `builder` and `org-admin`, and deactivate only). Setting `active: false` also pushes every token of the user into the P-03 revocation set in the same write and updates the write-through activation map (3.2; chapter 09) |
| DELETE `/users/:id` | -> `{ ok }` | super-admin | `ekoa.users/delete` |
| POST `/users/:id/password` | `{ newPassword }` -> `{ ok }` | super-admin | `ekoa.auth/reset-password`; re-flags `passwordChangeRequired` |

### 3.8.3 Teams - removed by Amendment 2 (section 3)

Teams are deleted end to end by Amendment 2: the `/api/v1/teams` endpoints, the web pages, the stores, and the tests are all removed (chapter 12 FC-039; glossary chapter 11: "teams -> deleted; departments, if ever demanded, return as additive groups inside an org"). The four dropped endpoints (`GET /teams`, `POST /teams`, `PATCH /teams/:id`, `DELETE /teams/:id`) are recorded in Appendix A. The section number is retained as a tombstone so later section numbers do not move (founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).

### 3.8.4 Org and branding - `/api/v1/org`, `/api/v1/orgs`, `/api/v1/branding` (section 4)

The schema/API name is `org` (permanent); the PT-PT display label stays "Escritório" (vertical copy). The old `/api/v1/company` resource is replaced by `/api/v1/org` - the caller's own org record incl. branding - and the web client is re-pointed in chapter 12 (FC-040). `orgId` scopes every row: `GET /org` and `PATCH /org` act on the caller's org (founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| GET `/org` | -> `OrgConfig` | user | `ekoa.company/get`; the caller's org record incl. branding |
| PATCH `/org` | `OrgUpdateRequest` -> `OrgConfig` | org-admin | `ekoa.company/update` (kept; the read-only legacy path the client worked around disappears with the rebuild - reference/frontend-cleanup-audit.md FC-040) |
| PUT `/branding` | `BrandingSaveRequest {branding, displayName?}` -> `OrgConfig` | org-admin | `save-branding`; org-scoped; logo rides as data URL in payload |
| POST `/branding/research` | `{ websiteUrl }` -> `202 { jobId }` | org-admin | `start-research`; org-scoped - research overwrites only the caller's org record; progress via `GET /jobs/:id` + `/jobs/:id/events` (3.5); the client keeps its 3-minute silence watchdog, re-armed by typed events and stream reconnect (3.6; reference/frontend-cleanup-audit.md FC-034) |

Org management (super-admin, across orgs):

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| POST `/orgs` | `OrgCreateRequest { name, displayName? }` -> `OrgConfig` | super-admin | create an org (Part 4); new; also created implicitly by a `POST /users` with an omitted `orgId` (3.8.2) |
| GET `/orgs` | -> `{ items: OrgConfig[] }` | super-admin | list all orgs; new |
| PATCH `/orgs/:id` | `OrgPatch { name?, displayName?, settings? }` -> `OrgConfig` | super-admin | rename / settings; new |

### 3.8.5 Settings - `/api/v1/settings` (section 5)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| GET `/settings` | -> `PlatformSettings` | user | `get`; merged view - org settings plus the caller's per-user toggles (ch04 `user_settings`) |
| PATCH `/settings` | deep-partial `PlatformSettingsPatch` -> `PlatformSettings` | org-admin | `update` (org settings); `integration.pipedreamEnabled` becomes a declared schema field (fixes the type drift recorded in ops-inventory section 5) |
| PATCH `/settings/me` | `UserSettingsPatch` -> `PlatformSettings` | user | new (Amendment 2); carries only per-user fields; writes the caller's `user_settings` record (ch04) and returns the merged view |

Two per-user toggles ride the per-user settings store (chapter 04 `user_settings`), not org settings: `build.verifyBuilds` (default on; set once by the first-ever-build ask-once dialog, chapter 12 and Part 6) and `memory.autoExtract` (default on; P-12 re-resolved, 3.8.19). Both surface in the merged `GET /settings` view and are written only via `PATCH /settings/me`; `PATCH /settings` never touches them (founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).

### 3.8.6 Sessions - `/api/v1/sessions` (section 6)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| POST `/sessions` | `SessionCreateRequest {name?, type?, artifactId?}` -> `Session` | user | `create`; onboarding type stays idempotent server-side |
| GET `/sessions` | -> `{ items: SessionSummary[] }` | user | `list` |
| GET `/sessions/:id` | -> `Session` | user | `get` (kept as conventional read; the `includeMessages` variant is dropped - Appendix A) |
| PATCH `/sessions/:id` | `SessionPatch` -> `Session` | user | `update` (rename); an empty patch stamps `updatedAt` (the touch behavior, carried) |
| DELETE `/sessions/:id` | -> `{ ok }` | user | `delete` |
| GET `/sessions/:id/messages` | -> `{ items: SessionMessage[] }` | user | `get-messages` |
| POST `/sessions/:id/messages` | `MessageCreateRequest {role, content, metadata?}` -> `SessionMessage` | user | `add-message` |
| POST `/sessions/:id/seed-featured` | `{ artifactId }` -> `{ ok }` | user | `ekoa.orchestrator/seed-featured` (section 7): seeds session context from a featured artifact for the customize flow |

### 3.8.7 Chat runs - `/api/v1/chat/runs` (sections 0.1, 7)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| POST `/chat/runs` | `ChatRunCreateRequest {sessionId, message, language?, attachments?: UploadRef[]}` -> `202 { runId }` | user | `POST /api/v1/request`; the `mode` routing enum is dropped - routing is server-side via the tier classifier (FIXED-3; Appendix A) |
| GET `/chat/runs/:id` | -> `ChatRun {status, ...}` | user | post-reconnect re-sync (3.5) |
| GET `/chat/runs/:id/events` | SSE `ChatRunEvent` | token-query | section 3.6.1 |
| POST `/chat/runs/:id/cancel` | -> `{ cancelled }` | user | `POST /api/v1/request/cancel`; server-side abort; chat and in-build classifier runs cancel independently (each is its own run) |

### 3.8.8 Build jobs - `/api/v1/jobs` (section 7)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| POST `/jobs` | `JobCreateRequest {kind: 'build', description, sessionId, language, templateId?, integrationKeys?, artifactId? (follow-up), attachments?: UploadRef[], fieldValues?, configValues?}` -> `202 JobCreateResponse` | user | `ekoa.execute/execute-job`. Response is a discriminated union: `{ status: 'created', job: Job }` or `{ status: 'answered', reason }` when the in-build classifier decides the message is a question (the answer arrives as `chat_answer` on the notifications channel - carried behavior, section 7) |
| GET `/jobs/:id` | -> `Job {id, status, artifactId?, slug?, createdAt, ...}` | user | `get-job`; also boot re-sync sweep. `streamUrl` field dropped (the client derives `/jobs/:id/events`) |
| POST `/jobs/:id/cancel` | -> `{ cancelled }` | user | `cancel-job`; abort must never fall through to a heuristic build (chapter 05) |
| GET `/jobs/:id/events` | SSE `JobEvent` | token-query | section 3.6.2; also carries brand-research jobs (3.8.4) |

### 3.8.9 Artifacts - `/api/v1/artifacts` (sections 8, 23)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| GET `/artifacts` | -> `ArtifactListResponse { items: Artifact[], featured: Artifact[] }` | user | `list-instances`; single shape (landmine 7) |
| GET `/artifacts/:id` | -> `Artifact` | user | `get-instance` |
| PATCH `/artifacts/:id` | `ArtifactPatch {name?, slug?, shareable?, data?, visibility?: 'private' \| 'org'}` -> `Artifact` | user | `update-instance`; slug validated, `409 SLUG_TAKEN` on collision; `visibility` promotes/demotes org sharing (see below) |
| DELETE `/artifacts/:id` | -> `{ ok }` | user | `delete-instance` |
| POST `/artifacts/:id/fork` | `{ name? }` -> `{ id, slug }` | user | `fork-instance`; the popup-safe navigation stays client-side |
| PUT `/artifacts/:id/featured` | `{ featured, featuredRank? }` -> `Artifact` | super-admin | `set-featured`; featured-gallery curation is platform-wide (Amendment 2 role remap) |
| GET `/artifacts/:id/export` | -> `ArtifactBundle` | user | `export-instance` |
| POST `/artifacts/import` | `{ bundle }` -> `Artifact` | user | `import-instance` |
| POST `/artifacts/:id/bundle-update` | `{ bundle, force? }` -> `{ artifact, safetyNetSnapshotId, preUpdateVersionId }` | user | `update-from-bundle`; `409 MANIFEST_ID_MISMATCH` without `force` |
| POST `/artifacts/:id/featured-update/apply` | -> `{ ok }` | user | `update-featured-from-source`; server safety-nets app data + version first |
| POST `/artifacts/:id/featured-update/ignore` | -> `{ ok }` | user | `ignore-featured-update` |
| GET `/artifacts/:id/versions?limit=` | -> `{ items: ArtifactVersion[] }` | user | `versions-list` |
| POST `/artifacts/:id/versions/:sha/restore` | -> `{ newHeadSha }` | user | `versions-restore` |
| GET `/artifacts/:id/files` | -> `{ files: ArtifactFile[], projectDir: string \| null }` | user | `list-files` |
| GET `/artifacts/:id/file?path=` | -> `{ content }` | user | `read-file`; path is project-relative, confined server-side (chapter 09, P-15) - the old sandbox-absolute path input is retired |
| PUT `/artifacts/:id/file` | `{ path, content }` -> `{ path, size }` | user | `write-file`; commit-on-save path preserved |
| GET `/artifacts/:id/download` | -> zip stream; `422 SECRET_GUARD_BLOCKED` | user | raw `GET /api/v1/artifacts/:id/download` (section 23) |
| GET `/artifacts/:id/pdf` | -> `302` redirect to the rendered PDF under `/artifact-pdfs/` (3.8.23) | user | raw `GET /api/v1/artifacts/:instanceId/pdf` (reference/invisible-behaviors.md section 8.8); id charset-guarded because it becomes the output basename; rendering pipeline owned by chapter 07 section 7.12. The old route was registered without auth and has no client caller; the rebuild puts it under the default `/api/v1` JWT gate (3.2) - the app-facing export path stays `POST /api/app-pdf` (3.9), so served apps are unaffected |

**Sharing semantics (`visibility`, Amendment 2).** `visibility: 'private' | 'org'` (default `private`) governs org sharing. An org-shared artifact is visible AND editable by every member of the owner's org - safe because git version snapshots + restore (the versions rows above) and the Registo (3.8.24) cover every mutation, so any edit is attributable and reversible. A private artifact is owner-only and invisible to org admins too: a read by anyone else returns a uniform `404 NOT_FOUND` (ownership-mismatch parity, chapter 04) and a write attempt returns `403 FORBIDDEN`. Promotion to `org` and demotion back to `private` are manual `PATCH /artifacts/:id { visibility }` calls by the owner (founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).

### 3.8.10 App-data backups - `/api/v1/artifacts/:id/backups` (section 10)

Keyed by artifact id; the server resolves the app-data scope (the old surface keyed by `appId`).

| Method + path | Request -> Response | Auth | Replaces |
|---|---|---|---|
| GET `/artifacts/:id/backups` | -> `BackupStatus` | user | `status` |
| POST `/artifacts/:id/backups` | -> `BackupRestorePoint` | user | `snapshot` |
| GET `/artifacts/:id/backups/export` | -> `AppDataDump` | user | `download` |
| POST `/artifacts/:id/backups/preview` | `{ pointId, source, at }` -> `AppDataDump` | user | `preview` |
| POST `/artifacts/:id/backups/restore` | `{ pointId, source, at }` -> `{ restored, cleared, safetyNetId }` | user | `restore`; automatic safety-net snapshot first |

### 3.8.11 Artifact backends - `/api/v1/artifacts/:id/backend` (section 11)

| Method + path | Request -> Response | Auth | Replaces |
|---|---|---|---|
| GET `/artifacts/:id/backend` | -> `BackendStatus {hasBackend, status, declared}` | user | `status` |
| GET `/artifacts/:id/backend/logs?limit=` | -> `{ items: BackendLogEntry[] }` | user | `logs` |
| GET `/artifacts/:id/backend/invocations?limit=` | -> `{ items: BackendInvocation[] }` | user | `invocations` |
| PUT `/artifacts/:id/backend/enabled` | `{ enabled }` -> `{ enabled }` | user | `set-enabled` |
| POST `/artifacts/:id/backend/sample-run` | `{ entrypoint, input }` -> `{ result }` (true dry-run with `dryRunEffects`) | user | `run-sample` |

### 3.8.12 Company space - `/api/v1/company-space` (section 9)

One normalized param name (`artifactId`), fixing the inconsistency recorded in reference/frontend-cleanup-audit.md FC-057.

| Method + path | Request -> Response | Auth | Replaces |
|---|---|---|---|
| GET `/company-space` | -> `{ items: CompanySpaceEntry[] }` | user | `list` |
| GET `/company-space/:artifactId` | -> `CompanySpaceEntry` (running state + logs info) | user | `get` |
| POST `/company-space/:artifactId/start` | -> `{ status, url?, deploymentId? }` | user | `start` |
| POST `/company-space/:artifactId/stop` | -> `{ ok }` | user | `stop` |

### 3.8.13 Integrations - `/api/v1/integrations` (section 12)

"Integration definition" = the versioned/user-created connector package; "config" = the encrypted credential/config record.

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| GET `/integrations` | -> `{ items: IntegrationDefinition[] }` | user | `list-skills` |
| GET `/integrations/active` | -> `{ items: ActiveIntegration[] }` (actions + webhook/listener event catalogs) | user | `list-active`; feeds the trigger picker |
| GET `/integrations/configs` | -> `{ items: IntegrationConfigSummary[] }` | user | `list-configs`; credentials never returned |
| POST `/integrations/configs` | `{ integrationKey, configValues }` -> `IntegrationConfigSummary` | user | `create-config`; encrypted at rest (chapter 09) |
| PATCH `/integrations/configs/:integrationKey` | `{ enabled?, configValues? }` -> `IntegrationConfigSummary` | user | `update-config` |
| DELETE `/integrations/:key` | -> `{ ok }` | user | `delete-skill` |
| POST `/integrations/refresh` | -> `{ count, keys: string[] }` | org-admin | `refresh-registry` (reload definitions from disk) |
| GET `/integrations/:key/session` | -> `SessionCaptureStatus` | user | `session-status`; client polls every 2 s while `waiting_login` (stays polling per ops-inventory section 0.3) |
| POST `/integrations/:key/session` | -> `{ started, session }` | user | `connect-session` (browser-session capture; prod gating message carried) |
| POST `/integrations/:key/provision-automations` | -> `{ provisioned, created, updated, actions }` | user | `provision-automations` |

**Org scoping (Amendment 2).** Integration configs and captured workspace credentials - including the Q-10 M365 workspace token (3.9) - are org-scoped: the old "`ownerUserId` undefined means global/admin-authored" nuance becomes org-scoped and org-admin-authored, held on the owner's org (Part 4). Registry refresh stays an org-admin operation (founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).

### 3.8.14 Integration builder - `/api/v1/integration-builder` (section 13)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| POST `/integration-builder/chat` | `{ message, builderSessionId?, language? }` -> `{ builderSessionId, generatedPackage, validationErrors }` | user | `chat`; route timeout 300 s; incremental prose stream dropped per RESOLVED (P-04) (3.6.4) |
| GET `/integration-builder/package?integrationKey=` | -> `{ builderSessionId, generatedPackage, messages, validationErrors }` | user | `load` |
| PUT `/integration-builder/package` | `{ builderSessionId }` or `{ generatedPackage, testCredentials? }` -> `{ integrationKey, displayName, saved, configured? }` | user | `save`; on success the server emits `integration_ready` on the notifications channel (landmine 6) |
| POST `/integration-builder/test` | `{ builderSessionId, actionKey, testCredentials?, testInput? }` -> `{ actionKey, success, statusCode?, response?, error? }` | user | `test`; route timeout 60 s |

### 3.8.15 Platform integrations - `/api/v1/platform-integrations` (section 14)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| GET `/platform-integrations` | -> `{ items: [{provider, connected, email?}] }` | user | `list` |
| GET `/platform-integrations/:provider` | -> `{ connected, email?, expiresAt? }` | user | `status` |
| POST `/platform-integrations/:provider/connect` | -> `{ authUrl, state }` | org-admin | `connect`; opens the OAuth popup; the workspace connection is org-scoped (Amendment 2) |
| DELETE `/platform-integrations/:provider` | -> `{ ok }` | org-admin | `disconnect` |
| GET `/api/v1/oauth/:provider/callback` | server-rendered page that `window.postMessage`s `{type: 'oauth-callback', provider, success}` to the opener | public (state-validated) | OAuth completion; **paths kept verbatim** - they are registered redirect URIs in the Google/Azure/Adobe consoles (section 14) |

### 3.8.16 Pipedream - `/api/v1/pipedream` (section 15)

| Method + path | Request -> Response | Auth | Replaces |
|---|---|---|---|
| GET `/pipedream` | -> `{ configured, enabled, accountCount }` | user | `status` |
| GET `/pipedream/accounts` | -> `{ items: PipedreamAccount[] }` | user | `list-accounts` |
| PUT `/pipedream/config` | `{ clientId, clientSecret, projectId, environment }` -> `{ id, configured }` | org-admin | `configure`; org-scoped integration credential (Amendment 2) |
| DELETE `/pipedream/config` | -> `{ ok }` | org-admin | `remove-config` |
| POST `/pipedream/connect-token` | -> `{ token, connectLinkUrl, expiresAt }` | user | `connect-token` |
| DELETE `/pipedream/accounts/:accountId` | -> `{ ok }` | user | `disconnect-account` |

The enable/disable toggle rides `PATCH /settings` (`integration.pipedreamEnabled`), as today.

### 3.8.17 Triggers - `/api/v1/triggers` + webhook ingress (section 16)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| GET `/triggers` | -> `{ items: Trigger[] }` **including `publicUrl`** (secret stays redacted) | user | `list`; fixes landmine 3 - the client never reconstructs the hook URL again |
| POST `/triggers` | `TriggerCreateRequest` - a zod **discriminated union on `target.kind`**: automation target `{automationId, integrationKey, eventName, artifactId?}` vs artifact-backend target `{integrationKey, eventName, target: {kind: 'artifact-backend', artifactId, entrypoint}}` -> `{ trigger, publicUrl, secret?, registrationError? }` | user | `create` (both shapes); `secret` returned exactly once for manual setup (landmine 2 preserved as a typed union) |
| DELETE `/triggers/:id` | -> `{ ok }` | user | `delete` |
| GET `/automations/:id/triggers` | -> `{ items: Trigger[] }` | user | `list-for-automation` |
| POST/GET `/hooks/:triggerId` | provider payload -> 200 (`{duplicate: true}` on dedup collision); GET handles hub-challenge handshakes and GET-as-event callbacks | HMAC | external webhook ingress, **path kept verbatim on the API origin** (URLs are registered with providers); 410/401 disabled semantics carried (reference/invisible-behaviors.md section 12.2) |

### 3.8.18 Automations - `/api/v1/automations` (section 17)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| GET `/automations` | -> `{ items: Automation[] }` | user | `list` |
| GET `/automations/:id` | -> `Automation` | user | `get` |
| POST `/automations` | `AutomationCreateRequest` -> `Automation` | org-admin* | `create`; *org-admin-only is a flippable org-setting default - when the org enables builder authoring, `builder` may create too (Part 4) |
| PATCH `/automations/:id` | `AutomationPatch` -> `Automation` | user | `update` |
| DELETE `/automations/:id` | -> `{ ok }` | user | `delete` |
| POST `/automations/plan` | `{ goal, name?, automationId?, language? }` -> `PlanResponse { plan, automation?, runId?, rehearsing? }` | user | `plan-from-goal`. Carries `language?` per 3.4 - the plan text is user-visible model output (chapter 12 section 12.2.3 flags this request for the language interceptor). **Landmine 9 made explicit:** this call persists the automation AND starts a rehearsal run; the response names both side effects (`automation`, `runId`), and the run streams at `/automations/runs/:id/events`. `awaiting_integration` plan status carried |
| POST `/automations/:id/runs` | `{ inputs? }` -> `202 { runId }` | user | `run` |
| GET `/automations/runs?automationId=&limit=` | -> `{ items: RunRecord[] }` | user | `list-runs` |
| GET `/automations/runs/:id` | -> `RunRecord` | user | `get-run` (run ids are globally unique; the old composite key is retired) |
| POST `/automations/runs/:id/cancel` | -> `{ cancelled }` | user | `cancel-run` (keyed by run id, not client trace) |
| POST `/automations/runs/:id/resume` | -> `{ resumed }` | user | `resume-run` |
| POST `/automations/runs/:id/consent` | `{ decision: 'once'\|'always'\|'stop', shape }` -> `ConsentResult` | user | `resolve-consent`; `always` persists the command shape |
| POST `/automations/runs/:id/steps/:stepId/feedback` | `{ kind, note? }` -> `{ ok, evicted? }` | user | `submit-step-feedback` |
| GET `/automations/runs/:id/events` | SSE `AutomationRunEvent` | token-query | section 3.6.3 |
| GET `/automations/catalog` | -> `{ automations: CatalogEntry[], integrationActions: CatalogEntry[] }` | user | `list-catalog` |
| GET `/automations/approved-commands` | -> `{ items: ApprovedCommand[] }` | user | `list-approved-commands` |
| POST `/automations/approved-commands/revoke` | `{ shape }` -> `{ revoked, remaining }` | user | `revoke-approved-command` (shapes are free strings, so revoke-by-body rather than a path param) |

**Org scoping (Amendment 2).** Automations, their triggers, and their runs are org-scoped and owned by their creator; a run is visible to its owner and to the org's admins (the Registo read surface, 3.8.24). Automation creation is org-admin-only by default, a flippable org setting (Part 4; founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).

The `/settings/bridge` page is linked into the settings navigation and extended into a "Privacidade e ponte local" surface (bridge status/pairing, active grants with revoke, live local ledger viewer, masking summary, and the absorbed approved-commands list); chapter 12 owns that UI (RESOLVED (Q-07)). The approved-commands endpoints above stay on this resource - the settings page consumes `GET /automations/approved-commands` and `POST /automations/approved-commands/revoke` rather than owning a parallel surface, and the bridge status/pairing rows it renders read the ekoa-local surfaces of 3.10 and chapter 18.

### 3.8.19 Memories - `/api/v1/memories` (section 18)

Scope note: the v1 memory surface is CRUD + resolver injection, with a `visibility: 'private' | 'org'` field (default `private`): the resolver injects the caller's own memories plus the org-shared ones; promotion/demotion is a manual owner toggle via `PATCH /memories/:id` (below). **RESOLVED (P-12), re-resolved 2026-07-06:** automatic memory extraction ships ON - asynchronous post-run (never adds turn latency), FAST tier (Haiku-class), batched one call per run, attributed `user_work` with agentType `memory-extract` billed to the run's user, hosted agent runs only, and it always writes `visibility: 'private'` (sharedness is never inferred). The per-user toggle `memory.autoExtract` defaults ON (3.8.5). Every automatic write is visible: a Registo entry (3.8.24) plus a UI affordance (chapter 12). Chapter 05 owns the extraction mechanics (founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| GET `/memories?type&scope&visibility&tags&search&limit&offset&sortBy&sortOrder` | -> `{ items: Memory[], total }` | user | `list` |
| GET `/memories/:id` | -> `Memory` | user | `get` (uncalled client fn today; kept as conventional resource read per FIXED-10) |
| POST `/memories` | `MemoryCreateRequest` -> `Memory` | user | `create` (incl. guardrail creation: `{type: 'preference', tier: 'core', tags: ['guardrail']}`) |
| PATCH `/memories/:id` | `MemoryPatch` (incl. `verified?`, `tier?`, `visibility?: 'private' \| 'org'`) -> `Memory` | user | `update`; `visibility` promotes/demotes org sharing (scope note above) |
| DELETE `/memories/:id` | -> `{ ok }` | user | `delete` |
| POST `/memories/bulk-delete` | `{ ids }` -> `{ ok }` | user | `bulk-delete` |
| POST `/memories/signals` | `{ runId, signal: 'positive'\|'negative' }` -> `{ affectedMemories, adjustedScores }` | user | `submit-signal` (keyed by run id) |
| GET `/memories/tags` | -> `{ items: [{tag, count}] }` | user | `list-tags` |
| GET `/memories/stats` | -> `MemoryStats` | user | `stats` |

### 3.8.20 Knowledge - `/api/v1/knowledge` (section 19)

No human search endpoint by design; agents consume search/read via in-process tools, not REST (chapter 05/08; reference/operations-inventory.md C3).

**Org partitioning (Amendment 2).** The knowledge base is org-partitioned - vault and lexical index alike - so a firm's documents never pool across orgs (Part 4); the CRUD rows below act within the caller's org, and the admin heal operations are org-admin (founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| GET `/knowledge/collections` | -> `{ items: string[] }` | user | `list-collections` |
| GET `/knowledge/documents?offset&limit&collection` | -> `{ items: KnowledgeDocSummary[], total }` | user | `list` (filesystem browse, not search) |
| POST `/knowledge/documents` | `{ collection, title, text, sourceUrl?, sourceType?, language? }` -> `{ id }` | user | `ingest` |
| DELETE `/knowledge/collections/:collection/documents/:id` | -> `{ ok }` | user | `delete` |
| GET `/knowledge/sources` | -> `{ items: KnowledgeSource[] }` | user | `list-sources` |
| POST `/knowledge/sources` | `SourceInput` -> `KnowledgeSource` | user | `add-source` |
| PATCH `/knowledge/sources/:id` | `SourceInput` partial (`seedTemplate: null` clears) -> `KnowledgeSource` | user | `update-source` |
| DELETE `/knowledge/sources/:id` | -> `{ ok }` | user | `delete-source` |
| POST `/knowledge/sources/:id/crawl` | -> `{ started, alreadyRunning }` | user | `crawl-source` |
| GET `/knowledge/sources/:id/crawl` | -> `{ running, progress, stats }` | user | `crawl-status` (client-side polling stays) |
| GET `/knowledge/refresh-schedule` | -> `{ schedule }` | user | `refresh-schedule` |
| GET `/knowledge/uploads` | -> `{ items: UploadDoc[] }` | user | `list-uploads` |
| POST `/knowledge/uploads` | raw file body + `X-Filename`, `X-Collection` -> `{ uploadId, ... }` | user | raw `POST /api/v1/knowledge/upload`; 50 MB default limit, path-scoped 413 with PT message |
| DELETE `/knowledge/uploads/:id` | -> `{ removed, docsRemoved }` | user | `unindex-document` |
| POST `/knowledge/reindex` | -> `202 { started }` | org-admin | backend-only heal operation kept as an org-admin endpoint (C3) |
| GET `/knowledge/index-status` | -> `IndexStatus` | org-admin | backend-only, kept for ops (C3) |

### 3.8.21 Billing - `/api/v1/billing` (section 20)

| Method + path | Request -> Response | Auth | Replaces |
|---|---|---|---|
| GET `/billing/usage` | -> `BillingUsage` | user | `get-usage` |
| GET `/billing/history?limit&offset` | -> `{ items: BillingHistoryEntry[], total }` | user | `get-history` |
| GET `/billing/breakdown` | -> `{ items: [{agentType, tokens, percentage}] }` | super-admin | `get-breakdown` |
| POST `/billing/credits` | `{ amountUsd }` -> `{ success, newBalance }` | user | `purchase-credits` |
| PUT `/billing/overage` | `{ enabled }` -> `{ overageEnabled }` | user | `toggle-overage` |
| PUT `/billing/admin/overage` | `{ enabled }` -> `{ globalOverageEnabled }` | super-admin | `admin-global-overage`; platform billing administration (Amendment 2 role remap) |
| GET `/billing/admin/usage` | -> `{ items: AdminUsageRow[] }` | super-admin | `admin-list-usage` |
| POST `/billing/admin/usage/:userId/reset` | -> `{ userId, tokensUsed }` | super-admin | `admin-reset-usage` |
| PUT `/billing/admin/limits/:userId` | `{ tokenLimit: number \| null }` -> `{ userId, tokenLimit }` | super-admin | `admin-set-limit` |

### 3.8.22 Uploads - `/api/v1/uploads` (section 23)

| Method + path | Request -> Response | Auth | Replaces / notes |
|---|---|---|---|
| POST `/uploads` | raw bytes + `X-Filename`, optional `X-Folder` -> `UploadResult { uploadId, displayName, size, folderRoot? }` | user | raw `POST /api/v1/upload`; 500 MB limit; folders staged recursively preserving structure; the response no longer exposes absolute server paths (3.4) |

### 3.8.23 Public and infrastructure surfaces (sections 23, 24; reference/invisible-behaviors.md section 6)

| Method + path | Auth | Notes |
|---|---|---|
| GET `/health` | public | field shape carried verbatim (`claudeAuth`, `clockSkewSec`, `bridgeConnections`, pending events) - external watchdogs depend on it (reference/invisible-behaviors.md section 6) |
| GET `/api/demos`, `/api/demos/:appId`, `/api/demos/assets/:image` | public | demo tour specs and assets, paths kept verbatim (served-app coupling, 3.9) |
| GET `/brand-assets/:filename` | public | header logo and research-cached brand images |
| GET `/artifact-screenshots/*`, `/automation-screenshots/*`, `/template-screenshots/*` | public | static images with CORS + cache headers (reference/frontend-cleanup-audit.md FC-065) |
| GET `/artifact-pdfs/*` | public | rendered artifact PDF exports, served statically with CORS + 1 h cache (reference/invisible-behaviors.md section 8.8); written by the render pipeline (chapter 07 section 7.12); retention decided with P-09 (chapter 04) |
| GET `/api/design-tokens.css` | public | brand tokens stylesheet; every served app links it before its bundle - a product contract with its own test gate (reference/test-audit.md section 5.3). The org is resolved server-side from the app's slug: the org's brand tokens are served when brand research exists, the platform default design system otherwise (never the vendor's brand); the URL and byte-contract are unchanged, so the 37 legal e2e specs do not move (Amendment 2, Part 4) |

### 3.8.24 Registo - `/api/v1/registo` (org activity read surface, Amendment 2)

The Registo is the org-scoped activity read surface un-deferred by Amendment 2: a minimal read over the single audit write path (chapter 09 invariant 3), returning metadata rows only - who did what, when, and usage per user - and never chat or message bodies (content-level oversight is an explicit future decision, not a default).

| Method + path | Request -> Response | Auth | Notes |
|---|---|---|---|
| GET `/registo?userId&type&from&to&limit&offset` | -> `{ items: RegistoEntry[], total }` | org-admin / super-admin | org-admin reads its own org; super-admin may pass `?orgId=` to read across orgs (omitted = all). `RegistoEntry` carries actor, action type, timestamp, target ids, and usage counts - metadata only, never message content |

This un-defers only the minimal read surface over the existing audit write path; the single write path is unchanged (FIXED-8, chapter 09 invariant 3). Registo reads are themselves access-logged (founder, 2026-07-06 (amendment 2, consolidated ledger, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md)).

## 3.9 Served-app data plane (byte-compatible, paths outside `/api/v1`)

**FIXED (FIXED-5 for the data engine; FIXED-9 for scope):** every route in the table below is preserved **byte-compatibly** - same paths, same headers, same cookie names and paths, same response shapes, and the same `window.__ekoa` / `__EKOA_APP_ID` context injection into served HTML. The 37-spec legal Playwright suite and all featured apps drive these surfaces directly with no frontend and no JWT; if any shape changes, that entire suite and every built app breaks (reference/test-audit.md section 2.4). Chapter 04 owns the collections engine behind `/api/app-data`; chapter 07 owns serving/injection. This chapter fixes the wire surface. One deliberate deviation from byte-compatibility: the `/api/m365/*` workspace Graph proxy now requires an `X-Ekoa-App-Id` header and a per-app manifest opt-in flag (RESOLVED (Q-10)); the sweep of which existing served apps must add the header before the gate flips on is a cutover checklist item (chapter 10). One further admission check is layered on without changing any wire shape: this plane (the second of the three admission planes, 3.2) consults the artifact owner's activation state, so a deactivated owner's apps refuse service with the CONV-2 error envelope (`403 ACCOUNT_DISABLED` or `402 BILLING_LOCKED`, 3.3); byte-compatibility of the routes themselves is otherwise untouched (Amendment 2, Part 3).

| Surface | Routes | Gate | Reference |
|---|---|---|---|
| Per-app data CRUD | GET/POST/PUT/DELETE `/api/app-data/:collection[/:id]` (PUT upserts) | `X-Ekoa-App-Id` header (slug-resolved, charset-checked); no JWT | data-inventory section 3.7; operations-inventory section 24 |
| Owner-shared data | same CRUD on `/api/app-shared/:collection[/:id]` | header + server-side owner-scope resolution; `usr.` prefixed ids rejected from clients | data-inventory section 3.3 |
| App files | POST `/api/app-files`; GET/DELETE `/api/app-files/:appId/:id` | header-scoped; raw bytes + metadata headers | operations-inventory section 24 |
| PDF export | POST `/api/app-pdf` | header-scoped | operations-inventory section 24 |
| Cloud files | GET `/api/app-cloud-files/status`; POST `/api/app-cloud-files/:provider/upload`; GET `.../:provider/list`; GET `.../:provider/download` | header-scoped; workspace credential injected server-side, never reaches the page | invisible-behaviors section 8.9 |
| End-user SSO | POST `/api/app-sso/login`, `/api/app-sso/set-password`, `/api/app-sso/logout`; GET `/api/app-sso/me`; GET `/api/app-sso/microsoft/start`, `/api/app-sso/microsoft/callback`; ALL `/api/app-sso/m365/*` | per-app HttpOnly cookie (`Path=/api/app-sso`), 8 h TTL; every security property carried (atomic state consumption, timing-safe compares, session-bound auth collection) | invisible-behaviors section 1.8 |
| Workspace Graph proxy | ALL `/api/m365/*` | **RESOLVED (Q-10):** requires and verifies `X-Ekoa-App-Id` (slug-resolved, charset-checked, app exists and is served) plus a per-app manifest opt-in flag before injecting the workspace Microsoft token; optional JWT still validated if present; raw bodies verbatim; gate owned by chapter 09 section 9.4, served-app sweep is a cutover item (chapter 10) | invisible-behaviors section 1.2 |
| Integration proxy | ALL `/api/integration/:key/*` | optional-JWT; the `executeEndpoint` constant baked into saved integration packages must keep resolving | invisible-behaviors section 1.2; operations-inventory section 13 |
| Legal-suite services | POST `/api/legal/calculos`; POST `/api/legal/transcricao`; GET `/api/legal-research`; GET `/api/tracking/consulta`; GET `/api/citius/consulta`; POST `/api/signature/send` | per-endpoint app allowlist (403 PT) + sliding-window rate limits (429 PT); `/api/citius/consulta` has no frontend caller but serves automations/integrations - kept | invisible-behaviors section 8.10; operations-inventory section 24 |
| Adobe Sign webhook | GET/POST `/api/adobe-sign/webhook` | deliberately public; authenticity re-verified in the service by owner-scoped refetch | invisible-behaviors section 12.2 |
| App health probe | POST `/api/app-health` | `X-Ekoa-App-Id`; injected into every served HTML; featured artifacts skipped | invisible-behaviors section 6 |
| Static serving | GET `/apps/:idOrSlug/` (+ `?token=` for non-shareable - RESOLVED (Q-05), 3.2); GET `/build/:slug`; GET `/__ekoa/demo-bridge.js` | shareability gate on document requests; slug-to-canonical-id resolution | operations-inventory sections 23, 24; carryover-audit B4 |

### 3.9.1 Served-app assistant endpoint (the one redesigned route on this plane)

End-user chat with a built assistant app previously rode the retired generic command endpoint (the old execute-domain assistant operation, reference/invisible-behaviors.md section 7.2, entry at :1359-1537), so byte-compatibility cannot apply; it is re-homed on this plane, where its only callers (served apps) live:

| Surface | Route | Gate | Reference |
|---|---|---|---|
| Assistant chat | POST `/api/app-assistant` - `AssistantChatRequest { message, history? }` -> `AssistantChatResponse { reply }` (schemas in `shared/app-assistant.ts`) | `X-Ekoa-App-Id` header (slug-resolved, charset-checked); no JWT | invisible-behaviors section 7.2; llm-usage-map section 4 row 3 |

- **Synchronous:** the reply returns in the HTTP response, no stream (carried). Execution is owned by chapter 05 section 5.6.3: the server builds the system prompt from the artifact's personality, configuration, and knowledge, with a deterministic greeting/knowledge tier heuristic in front of the model call.
- **Billing:** attribution `user_work` (`assistant-chat`), billed to the **artifact owner** with `artifactId` stamped (chapter 06 sections 6.4.1 row 3 and 6.6.3). The pre-run billing gate checks the artifact owner's allowance and refuses with `402 BILLING_BLOCKED` (3.3).
- The retirement of the old transport (3.1) makes this the only path for assistant replies; assistant artifacts reach it like every other route on this plane, via the `X-Ekoa-App-Id` header.

## 3.10 ekoa-local surfaces (ported, wire-stable)

These serve the ekoa-local daemon and TUI, not the web frontend. FIXED-1 keeps ekoa-local out of scope, so these surfaces are ported wire-stable (reference/carryover-audit.md B12, B16, B17).

| Surface | Routes | Auth | Notes |
|---|---|---|---|
| LLM gateway | POST `/api/v1/llm/messages` and POST `/api/v1/llm/v1/messages` (same handler - the second path lets an SDK pointed at the gateway resolve `/v1/messages`); GET `/api/v1/llm/models`; POST `/api/v1/llm/classify` | `X-API-Key` (gateway key) or JWT | Ported per B12; metering moves inside the LLM chokepoint (chapter 06, FIXED-3); the classify endpoint keeps its hard time budget and deterministic fallback (reference/invisible-behaviors.md section 2.8) |
| Agent face | POST `/api/v1/agent-face/run` -> `{ traceId }` (`409 DAEMON_NOT_CONNECTED` when no bridge connection); POST `/api/v1/agent-face/cancel` (owner-scoped, idempotent) | user | Ported per reference/invisible-behaviors.md section 7.5; run event delivery is the RESOLVED (P-18) compatibility channel below |
| Bridge | POST `/api/v1/bridge/token` (mints short-lived bridge token from user JWT); WS upgrade `/api/v1/bridge/connect/:connectionId`; POST `/api/v1/bridge/debug-invoke` (fail-closed 404 unless explicitly flag-enabled) | user / bridge token | Ported per B16; Bearer-header auth preferred, `?token=` only as transition fallback scheduled for removal (the bridge upgrade path); daemon protocol schemas are the compatibility contract |

**RESOLVED (P-18): agent-face event delivery channel.** Agent-face results surface as SSE events on a compatibility stream at `GET /api/v1/events?token=` that serves **only** agent-face/TUI traffic (run events for the caller's agent-face runs plus the connection ack); the web client never uses it, and ekoa-local is left untouched (its client code is out of scope, FIXED-1). This is the single surviving use of the old global `/api/v1/events` path, scoped to TUI traffic and documented here rather than in the web protocol (3.6); it does not count against the four-SSE-endpoint rule (CONV-4), which governs web clients. Rejected alternative: migrate ekoa-local to per-run streams (`GET /api/v1/agent-face/runs/:id/events`, mirroring 3.6.1) and delete the legacy endpoint - cleaner, but it requires coordinated ekoa-local changes that FIXED-1 declares out of scope. Resolved: ACCEPT (recommendation final - TUI-only compatibility SSE channel `GET /api/v1/events`), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

**Daemon-side surfaces owned by chapter 18.** Two daemon-facing surfaces are named on this plane but specified in chapter 18. The **bridge channel** (the single outbound WebSocket the ekoa-local daemon dials to Cortex - carve-out 1 in 3.7 and the `/api/v1/bridge/*` row above) is daemon-to-Cortex transport, explicitly outside this chapter's frontend-to-API protocol rules; its pairing-token auth, presence heartbeat, org-scoped pairing registry, and revoke kill switch are specified in chapter 18 section 18.3. The **Anthropic-compatible provider endpoint** that carries bridge traffic routes through the LLM chokepoint with session-identity propagation and pairing-bound auth; it is specified in chapter 18 section 18.4. Both sit OUTSIDE the four SSE streams and the REST resource surface of this chapter (CONV-4 unchanged): they are neither web-client REST resources nor one of the four typed SSE endpoints, and no frontend protocol rule here governs them.

## 3.11 Landmine register (reference/operations-inventory.md section 25, addressed)

| # | Landmine | Where addressed |
|---|---|---|
| 1 | Legacy envelope unwrap | 3.1: one zod-validated shape per endpoint, no envelope |
| 2 | Trigger `target` discriminator | 3.8.17: `TriggerCreateRequest` is a zod discriminated union |
| 3 | Webhook `publicUrl` redaction forcing client URL reconstruction | 3.8.17: `GET /triggers` returns `publicUrl`; `/hooks/:triggerId` stays on the API origin |
| 4 | JWT-in-URL (`?token=`) surfaces | 3.2: kept for SSE (EventSource limit); app previews carry `?token=` for non-shareable artifacts with log redaction (RESOLVED (Q-05)) |
| 5 | `get-me` as the only token refresh path | 3.8.1: RESOLVED (P-03) - explicit `POST /auth/refresh`; `GET /auth/me` returns identity only |
| 6 | `integration_ready` push resumes paused builds | 3.6.4 + 3.8.14: documented cross-surface coupling, typed event on the notifications channel |
| 7 | Dual list shapes tolerated for the artifact list | 3.8.9: single `ArtifactListResponse` object shape |
| 8 | WS close-code 4000 = takeover | 3.7: carried in the live-view canvas protocol (RESOLVED (Q-01) media-channel carve-out) |
| 9 | Plan-from-goal is not pure planning | 3.8.18: response names both side effects (`automation`, `runId`) |
| 10 | Logout has no server-side operation | 3.2, 3.8.1: RESOLVED (P-03) - `POST /auth/logout` + server-side revocation list backed by the persisted `revoked_tokens` collection |
| 11 | `metadata.language` injected from localStorage on every chat send | 3.4: explicit `language` field set by one client interceptor |
| 12 | Login pre-auth exemption | 3.2 auth-class table: exactly `POST /auth/login`, `POST /auth/device`, `POST /auth/device/poll` are public |

## 3.12 Acceptance criteria (checkable without a human)

1. Every operation in reference/operations-inventory.md sections 0-24 appears in exactly one place: an endpoint row in 3.8-3.10, a served-app row in 3.9, an SSE event in 3.6, or a row in Appendix A. (Auditable by walking the inventory tables against this chapter.)
2. Every endpoint in this chapter has a named request and response schema, and those schemas exist in `shared/` in the implementation; contract tests validate each endpoint against its schema (chapter 13).
3. No endpoint exists in the implementation that is not in this chapter (route census equals this map).
4. The four SSE endpoints in 3.6 are the only `text/event-stream` responses under `/api/v1` for web clients (the RESOLVED (P-18) compatibility channel is TUI-only and documented in 3.10).
5. All 12 landmines in 3.11 are verifiably addressed as described (each has a concrete test: e.g. `GET /triggers` response contains `publicUrl`; artifact list returns an object with `items` and `featured`).
6. The served-app plane passes the ported 37-spec legal suite unchanged at the helper level (reference/test-audit.md section 2.4).
7. Every non-2xx response body validates against the shared error envelope schema.
8. No occurrence of the retired transport endpoints (`/api/v1/action`, `/api/v1/request`, `/api/v1/request/cancel`) in the implementation, except the RESOLVED (P-18) TUI compatibility channel at `/api/v1/events`.
9. No `teams` route exists in the implementation (route census; the four `/teams` operations appear only in Appendix A), and the Amendment 2 routes `GET`/`PATCH /org`, `POST`/`GET /orgs`, `PATCH /orgs/:id`, `GET /registo`, and `PATCH /settings/me` (3.8.4, 3.8.24, 3.8.5) are present.
10. The two Amendment 2 error codes `ACCOUNT_DISABLED` (403) and `BILLING_LOCKED` (402) appear both in the 3.3 status table and in `shared/errors.ts`.
11. `visibility` (`'private' | 'org'`) is present in the shared memory and artifact schemas (`Memory`/`MemoryPatch`, `Artifact`/`ArtifactPatch`), and no auth cell in 3.8 carries a bare `admin` class (every one resolves to `user`, `org-admin`, or `super-admin`).

## Appendix A. Dropped operations

Expected drops are the orphans and dead client surface recorded in reference/operations-inventory.md (sections C1, C2, C3, C5). One line each.

**Dead client code with no backend (C1) - dropped, nothing to map:**

| Operation | Reason |
|---|---|
| `ekoa.claude-oauth/start\|status\|disconnect` | dead client functions; no backend handler, no UI caller |
| `ekoa.agent-config/get\|update` | dead client functions; no backend handler, no UI caller |
| `ekoa.tunnel/*` (5 functions) | dead client functions; the `/tunnel` route is a redirect stub |
| `ekoa.knowledge` legacy company-knowledge calls (`get`, `update`, `list-files`, `upload-file`, `delete-file`) + the WS-era `sendFileUpload` | superseded by the live knowledge vault surface (3.8.20) |

**Live backend, no frontend caller (C2) - dropped or superseded:**

| Operation | Fate |
|---|---|
| `ekoa.activity/list` | dropped from v1 API; the audit stays a single write path (FIXED-8, chapter 09), and the old per-user activity list is superseded by the org-scoped, metadata-only Registo read surface (3.8.24, Amendment 2) - content-level oversight remains a future decision |
| `ekoa.chat/send` | dropped; acknowledged stub - real chat is the chat-runs resource (3.8.7) |
| `ekoa.projects/*` | dropped; vestigial (reference/data-inventory.md section 5.1 marks the store vestigial) |
| `ekoa.integrations/grant-access\|revoke-access` | dropped; no caller, no UI |
| `ekoa.execute/infer-integrations` | dropped; no caller |
| `ekoa.sessions/get` with `includeMessages: true` | superseded by `GET /sessions/:id` + `GET /sessions/:id/messages` |
| `ekoa.memory/get` client function | superseded by `GET /memories/:id` (kept as conventional read) |

**Backend-only knowledge operations (C3):**

| Operation | Fate |
|---|---|
| `search`, `read` | not REST; consumed by agents via in-process tools (chapters 05, 08) |
| `reindex`, `index-status` | kept as admin endpoints (3.8.20) |
| `crawl-cancel`, `refresh-all` | dropped; no caller, nightly refresh is scheduler-owned (reference/invisible-behaviors.md section 12.6) |

**Dead or retired wire surface (C5 and protocol replacement):**

| Item | Reason |
|---|---|
| `POST /api/v1/action`, `POST /api/v1/request`, `POST /api/v1/request/cancel`, global `GET /api/v1/events` | replaced by typed REST resources and the four scoped SSE endpoints (3.1); `/api/v1/events` survives only as the RESOLVED (P-18) TUI compatibility channel (3.10) |
| Chat send `mode` enum (`force_local` / `force_external` / `force_orchestrated`) | routing is server-side via the tier classifier (FIXED-3); the client sends content, not routing directives |
| SSE `file_data`, `action_result` | registered but zero consumers (C5.4) |
| SSE `action_complete`, `action_error` | fanned out but every handler ignores them (C5.4) |
| SSE `auth_result` | fed only internal connection caching; the REST client has no equivalent need |
| SSE `action_stream` (`builder_text`) | dropped per RESOLVED (P-04); correlation broken by design today (reference/frontend-cleanup-audit.md FC-035) |
| SSE `usage_progress` | cosmetic provisional gauge ticking; degradable to `usage_updated` + refetch (RESOLVED (P-13)) |
| SSE `phase_changed`, `subagent_event` | dead on the wire today (never registered client-side, C5.1/C5.3); dropped from the v1 contract with phase info folded into job status events (RESOLVED (P-11), chapter 05; RESOLVED (Q-04) deletes both the producers and the dead client handlers) |
| `POST /api/apps/:appId/compile` | machinery of the retired runtime-interpreted layer; nothing to recompile in the rebuild (FIXED-4) |
| `GET /api/v1/upload/test` | dev-only write probe; replaced by boot-time upload-dir validation |

**Deleted by Amendment 2 (docs/ekoa-code-spec-amendment-2-consolidated-ledger.md):**

| Operation | Reason |
|---|---|
| `list` (`GET /teams`) | teams deleted end to end by Amendment 2; departments, if ever demanded, return as additive groups inside an org (glossary chapter 11) |
| `create` (`POST /teams`) | teams deleted end to end by Amendment 2; departments, if ever demanded, return as additive groups inside an org (glossary chapter 11) |
| `update` (`PATCH /teams/:id`) | teams deleted end to end by Amendment 2; departments, if ever demanded, return as additive groups inside an org (glossary chapter 11) |
| `delete` (`DELETE /teams/:id`) | teams deleted end to end by Amendment 2; departments, if ever demanded, return as additive groups inside an org (glossary chapter 11) |

**Amendment record.** Amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md).

Amended again 2026-07-06 per the consolidated-ledger amendment (Amendment 2, docs/ekoa-code-spec-amendment-2-consolidated-ledger.md): the auth-class table adopts the three-role model (`super-admin`, `org-admin`, `builder`) with the JWT claim set `{sub, role, scope, orgId, username}`, and the auth middleware consults a cached activation state (write-through in-memory map) as the first of three admission planes (3.2); the error table gains `ACCOUNT_DISABLED` (403) and `BILLING_LOCKED` (402) (3.3); Users (3.8.2) gain a create-time `orgId`, a scoped `PATCH /users/:id { role?, active? }` (deactivation revokes tokens and updates the activation map), and super-admin/org-admin scoping; Teams (3.8.3) are removed to a tombstone with the four endpoints dropped to Appendix A; Company/branding (3.8.4) becomes Org/branding - `/company` -> `/org` plus the super-admin `/orgs` management surface; Settings (3.8.5) gain the per-user `PATCH /settings/me` and the two per-user toggles; artifact (3.8.9) and memory (3.8.19) patches gain `visibility: 'private' | 'org'` with sharing semantics, and P-12 is re-resolved to auto-extract ON; integrations (3.8.13), automations (3.8.18), and knowledge (3.8.20) are org-scoped; a new Registo read surface is added (3.8.24); `design-tokens.css` (3.8.23) resolves the org server-side from the app's slug; the served-app plane (3.9) consults the owner's activation, and the bridge pairing registry (3.10) is org-scoped; and every remaining bare `admin` auth class is remapped to `org-admin` (org-scoped resources: platform-integrations, pipedream, knowledge heal ops, integrations refresh) or `super-admin` (platform-wide: featured-gallery curation, billing administration).

*End of chapter 03.*
