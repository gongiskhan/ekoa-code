# 12. Web client migration

This chapter specifies how the existing Next.js frontend (`ekoa/`) moves into the new repository as `web/` (FIXED-1, FIXED-9): the migration approach (copy, then staged replacement), the design of the typed REST client and the event-stream client that replace the old transport layer, the complete replacement map for every wire-protocol touchpoint (FC-001..FC-069), and the disposition of every dead-code, legacy-assumption, and stale item (FC-100..FC-139, FC-200..FC-210, FC-300..FC-312). Ground truth is reference/frontend-cleanup-audit.md; endpoint names come from chapter 03. Every FC id in the audit receives exactly one fate here: 134 items in total (69 protocol touchpoints, 41 dead-code items, 11 legacy-backend-assumption items, 13 stale items). The UI is the functional contract, not the wire contract (FIXED-9): behavior is preserved except where a row below explicitly says otherwise. The 2026-07-06 amendment (founder resolutions and the anonymisation/local-file-access amendment, docs/ekoa-code-spec-amendment-brief.md) adds one net-new block on top of the audit: the local file access and privacy web surfaces of section 12.6 (FC-400..FC-412), which are built rather than migrated and are counted separately from the 134 audit items.

## 12.1 Migration approach: copy, then staged replacement

**FIXED (FIXED-9):** the existing frontend is migrated, not rebuilt. The migration is a source-level move into the new repo; at no point does one running app speak both protocols. During the whole program the old app keeps serving production from the old repo (chapter 10 owns coexistence and cutover); `web/` is developed and tested against the new API only.

| Stage | Work | Exit gate (checkable) |
|---|---|---|
| W1 Copy | Copy the `ekoa/` tree into `web/` unchanged except package name, workspace wiring (P-17, chapter 02), and lint config for the import boundary (web imports shared only - FIXED-1). No behavior edits. | `npm run build` exits 0 in `web/`; existing unit tests run (failures from missing backend are expected and recorded, not fixed here) |
| W2 New client layer | Build the replacement transport alongside the old one, untouched call sites: `web/lib/api/` (request core, token accessor, base-URL resolver, per-domain namespaces bound to `shared/`) and `web/lib/api/stream.ts` (event-stream client). Sections 12.2 and 12.3. | New modules compile; contract-bound types check against `shared/`; no call site moved yet |
| W3 Transport replacement | Move call sites domain by domain per the map in 12.4, in this order: (1) auth + token/identity (FC-037, FC-021, FC-022, FC-025, FC-066, FC-067), (2) sessions + chat runs + notifications stream (FC-049, FC-013, FC-014, FC-029, FC-031), (3) jobs + job stream + artifacts family (FC-045, FC-026, FC-046, FC-047, FC-048), (4) all remaining domains (FC-038..FC-044, FC-050..FC-059), (5) raw HTTP endpoints (FC-060..FC-065). Delete each old client function when its last consumer moves; delete `lib/cortex/connection.ts` and the legacy parts of `lib/api/client.ts` when empty. | Grep census in `web/`: zero occurrences of `/api/v1/action`, `/api/v1/request`, `sendAction`, `sendRequest(`, `wsAction`, `lib/cortex/connection` (acceptance criterion 1) |
| W4 Cleanup pass | Execute every delete/clean fate in 12.5: dead routes, dead files, dead store state, dead client functions, locale pruning, stale comments and names. | Grep census: every symbol named delete in 12.5 is absent from `web/` (acceptance criterion 3) |
| W5 Test migration | Port the four transport-mocking unit tests with mocks against the new client modules (FC-307); rewrite the seven protocol-coupled e2e specs against the typed REST routes (FC-312). | `web/` unit tests green; the rewritten e2e specs green against the new API (chapter 13 owns the full suite) |

Ordering rationale: after stage W3 step (2) the app is drivable end to end (login, chat, streams), so every later step is verified against a running product, not in the dark. Stages land as separate commits so each gate is auditable (chapter 14 owns the commit discipline).

The provider that boots the client (`components/providers/cortex-provider.tsx` today) is rewritten in W2/W3 as an `ApiProvider`: client factory with the dev host override, the cross-tab `storage` listener on the token key, and ownership of the notifications stream lifecycle (FC-025, section 12.3).

**Repo guidance (FIXED-12, FIXED-1):** the new repo `CLAUDE.md` (chapter 02 section 2.2) additionally records the web-side rules from this chapter: web imports from `shared/` only; exactly one module reads the token storage key; exactly one base-URL resolver; `EventSource` usage confined to the stream module; any change to client structure or stream flow updates the affected diagram in the same unit of work.

**Diagrams (FIXED-12):** there is no dedicated web-client diagram in the `spec/diagrams/` set; `web/` is rendered at module granularity across three existing diagrams - the `web/` module and its imports-from-`shared/`-only boundary in `spec/diagrams/02-module-map`, the typed REST request path in `spec/diagrams/03-request-crud`, and the client as SSE consumer of the job stream in `spec/diagrams/04-agent-job`. The internal client/stream architecture (request core, token accessor, resolver, the four streams, the provider wiring) is specified by the text of sections 12.2-12.3, and the W2 scaffold is built to match those sections. Under FIXED-12, any structural change to the transport layer updates whichever of those three diagrams renders the affected part, in the same unit of work - a structural change without its diagram update is incomplete - and if a future change makes the client's internal structure load-bearing enough to need its own diagram, that diagram is added to the set as part of that change (the same rule chapter 07 applies to the app pipeline).

## 12.2 The typed REST client

The old transport (a 551-line singleton coupling RPC transport, SSE, auth caching, and reconnect - FC-001) is replaced by two small typed modules: the REST client (this section) and the event-stream client (12.3).

### 12.2.1 Contract binding: generated from `shared/`

**FIXED (FIXED-1, FIXED-9):** the client is derived from the shared contract, not hand-maintained against prose. Each domain file in `shared/` exports, alongside its zod schemas and inferred types, an endpoint descriptor map: for every endpoint in the chapter 03 tables, an entry of `{ method, path, auth, request?, response, query?, timeoutMs?, language?, kind? }` where `request`/`response`/`query` are references to the zod schemas in the same file and everything else is a string or number literal. This is contract data, not code: it is the machine-readable form of the chapter 03 endpoint tables, contains no logic, no utilities, and no config, and both apps bind to it - `api/` routes mount validation from it, `web/` derives the client from it. It therefore stays within the `shared/` charter of chapter 02 section 2.2 (schemas and what they describe; one file per domain).

```ts
// shared/auth.ts (sketch)
export const LoginRequest = z.object({ username: z.string(), password: z.string(), rememberMe: z.boolean() });
export type LoginRequest = z.infer<typeof LoginRequest>;
export const authEndpoints = {
  login:   { method: 'POST', path: '/auth/login', auth: 'public', request: LoginRequest, response: LoginResponse },
  me:      { method: 'GET',  path: '/auth/me',    auth: 'user',   response: AuthUser },
  refresh: { method: 'POST', path: '/auth/refresh', auth: 'user', response: RefreshResponse },
  logout:  { method: 'POST', path: '/auth/logout',  auth: 'user',  response: LogoutResponse },  // RESOLVED (P-03)
  // ... every row of chapter 03 section 3.8.1
} as const satisfies EndpointMap;
```

`web/lib/api/index.ts` produces the client with a single generic factory - generation happens at the type level, with no codegen script to drift:

```ts
export const api = createClient({
  auth: authEndpoints, users: usersEndpoints, teams: teamsEndpoints, company: companyEndpoints,
  branding: brandingEndpoints, settings: settingsEndpoints, sessions: sessionsEndpoints,
  chat: chatEndpoints, jobs: jobsEndpoints, artifacts: artifactsEndpoints,
  companySpace: companySpaceEndpoints, integrations: integrationsEndpoints,
  integrationBuilder: integrationBuilderEndpoints, platformIntegrations: platformIntegrationsEndpoints,
  pipedream: pipedreamEndpoints, triggers: triggersEndpoints, automations: automationsEndpoints,
  memories: memoriesEndpoints, knowledge: knowledgeEndpoints, billing: billingEndpoints,
  uploads: uploadsEndpoints, notifications: notificationsEndpoints, demos: demosEndpoints,
});
// api.auth.login({...}): Promise<LoginResponse>  - fully typed from shared/
```

Namespaces mirror the chapter 03 domain map one to one. The client exposes the whole contract, including endpoints no page calls yet (e.g. `GET /memories/:id`): the contract is client-agnostic (FIXED-10) and unused methods cost nothing after tree-shaking. Descriptor kinds: `json` (default), `binary` (raw-body upload/download with metadata headers - uploads, knowledge uploads, artifact zip download), `stream` (SSE; consumed by 12.3, never by the request core).

### 12.2.2 Request core and error model

One function, `web/lib/api/core.ts` `request(descriptor, args, opts?)`, does everything the old `sendAction`/`wsAction` pair did (FC-012, FC-019), conventionally:

- Builds the URL from the base-URL resolver (12.2.5) plus the descriptor path template with path params substituted and query params serialized.
- Attaches `Authorization: Bearer <token>` from the token accessor (12.2.4) when a token exists; descriptors with `auth: 'public'` never trigger the 401 interceptor (login failures must not log the user out).
- Applies the per-descriptor timeout (`timeoutMs`, default 120 000 ms; integration-builder chat 300 000 ms, integration test 60 000 ms - carried per chapter 03 section 3.4) via `AbortController`, and accepts a caller `AbortSignal`.
- Parses the JSON body and, in development and test builds, validates it against the descriptor response schema (contract tests, chapter 13).
- On non-2xx, parses the shared error envelope (`shared/errors.ts`, chapter 03 section 3.3) and throws `ApiError`. Network failures and timeouts are normalized to `ApiError` with `status: 0` and client-side codes `NETWORK_ERROR` / `TIMEOUT` so consumers handle one error type. Special statuses surface typed: `422 SECRET_GUARD_BLOCKED` on code download keeps its distinct PT copy in the UI ("O download foi bloqueado porque foram detetados segredos no codigo."), `409` conflict codes drive the existing dialogs (chapter 03 sections 3.3, 3.8.9).

```ts
// web/lib/api/errors.ts (sketch)
export class ApiError extends Error {
  status: number;               // HTTP status; 0 for client-side failures
  code: string;                 // UPPER_SNAKE from the shared envelope, or NETWORK_ERROR / TIMEOUT / ABORTED
  message: string;              // user-safe, PT-aware (server-provided) - already sanitized at API egress (FIXED-8)
  details?: unknown;            // optional structured context (zod issues, safetyNetSnapshotId, ...)
}
```

The client performs **no automatic retries** (decided): retrying non-idempotent creates would duplicate jobs and runs, and every long-lived surface already has an explicit re-sync path (12.3). Callers that want retry behavior implement it visibly at the call site, as today.

**Return style (decided, FIXED-9 behavior-preserving):** methods return `Promise<Response>` and throw `ApiError`; the old `{success, data?, error?}` envelope object is retired with the old client (FC-019). A thin `tryCall(fn)` helper returning `{ ok: true, data } | { ok: false, error }` is provided so stores written in the non-throwing style migrate mechanically. There is no response unwrapping of any kind: chapter 03 section 3.1 guarantees one JSON shape per endpoint, so the legacy envelope unwrap (FC-020/FC-200) has nothing to unwrap and is deleted.

### 12.2.3 Interceptors

Exactly two, both in the request core:

1. **Auth failure (replaces FC-021's string matching):** on HTTP 401 from any non-`public` endpoint, clear the token via the accessor, clear the persisted auth state (`ekoa_auth`), and hard-redirect to `/login` unless the current path is already `/login`. Status-based, never message-string-based. There is no silent auto-refresh retry in v1; renewal is explicit: on app boot rehydrate, the auth store validates with `GET /auth/me` and renews with `POST /auth/refresh` (RESOLVED (P-03), chapter 03 section 3.8.1 - this replaces the old refresh-by-identity-call piggyback the store relied on). RESOLVED (P-03) also adds server-side token revocation: user-initiated sign-out calls `POST /auth/logout` to revoke the current token against the server-side revocation list before the accessor clears it locally and closes the streams (12.2.4). The 401 interceptor above never calls logout - a rejected token is already invalid, so it only clears local state; the explicit logout call is the sign-out path, not the failure path. The admin variant (`POST /auth/logout` revoking another user's tokens) backs the users page.
2. **Language (replaces FC-009/FC-069):** descriptors flagged `language: true` (chat run create, job create, integration-builder chat, automation plan - the requests that produce user-visible model output per chapter 03 section 3.4) get an explicit `language` body field from the single language source: the i18n store's persisted value. The transport never reads localStorage for this; the `ekoa_locale` mirror key is removed (FC-069).

### 12.2.4 Single token accessor

`web/lib/api/token.ts` is the only module in `web/` that touches the token storage key (`localStorage['ekoa_token']`): `getToken()`, `setToken(t)`, `clearToken()`, `subscribe(fn)`. `setToken` notifies subscribers (the stream manager re-authenticates open streams - FC-004); `clearToken` closes them. The cross-tab `storage` listener (login/logout sync across tabs, FC-025) lives here. The five independent raw readers recorded in FC-066 are all replaced. The auth store's rehydrate hook re-injects the persisted token through this accessor (FC-067), which transitively re-authenticates streams.

### 12.2.5 Single base-URL resolver

`web/lib/api/base-url.ts` exposes one `resolveBaseUrl()` with the exact semantics both divergent copies implement today (FC-016): explicit `NEXT_PUBLIC_API_URL` taken verbatim; empty string means same-origin; the dev convenience of taking only the port from the env value and the host from `window.location.hostname` (LAN/Tailscale dev access, FC-025) is kept as an explicit dev-mode branch; SSR without an env value throws. Build-time injection from the port file stays in `next.config.ts`. No other module constructs an API origin.

### 12.2.6 URL helpers

- `api.resolveUrl(path)` - relative API path to absolute URL (replaces FC-017 `resolveApiUrl`); the five consumer files (artifact screenshots, automation run viewer and pause overlay, chat card stripe, build side panel) are re-pointed mechanically.
- `api.appUrl(idOrSlug)` - `{base}/apps/{idOrSlug}/` (replaces FC-023 `getAppUrl`); consumers unchanged.
- `api.withPreviewToken(url)` - appends `?token=` for owner-checked non-shareable artifact previews only, and deliberately never for shareable ones (replaces FC-024). This helper implements **RESOLVED (Q-05)** (chapter 03 section 3.2; chapter 16): the default is carried - token-in-query for owner-checked non-shareable previews, with a server-side log-redaction middleware scrubbing the `?token=` value from logs. The helper still isolates the behavior so a later switch to same-origin cookies would touch one function.

### 12.2.7 Module inventory: what is created, what dies

Created in W2 (the complete new transport layer - nothing else in `web/` may perform HTTP to the API or open an event stream):

| New module | Contents |
|---|---|
| `web/lib/api/core.ts` | `request()` - URL building, auth header, timeouts, abort, response parsing, interceptors |
| `web/lib/api/errors.ts` | `ApiError`, `tryCall` |
| `web/lib/api/token.ts` | the single token accessor + cross-tab sync (12.2.4) |
| `web/lib/api/base-url.ts` | the single origin resolver (12.2.5) |
| `web/lib/api/stream.ts` | `EventStream`, the four stream factories, the stream manager (12.3) |
| `web/lib/api/index.ts` | `createClient` factory + the `api` object bound to the `shared/` descriptors (12.2.1) |
| `web/components/providers/api-provider.tsx` | client boot, notifications-stream lifecycle, dev host override (replaces the old provider, FC-025) |

Deleted by the end of W3 (each when its last consumer moves):

| Old module | Fate |
|---|---|
| `lib/cortex/connection.ts` (551 ln singleton) | deleted (FC-001) |
| `lib/api/client.ts` legacy transport + wrapper functions | deleted; live URL helpers re-homed to 12.2.6, live types re-homed to `shared/` |
| `components/providers/cortex-provider.tsx` | replaced by `api-provider.tsx` |

## 12.3 The event-stream client

`web/lib/api/stream.ts` replaces the SSE half of the old singleton. The global firehose with client-side trace filtering and a wildcard channel (FC-007, FC-010) is gone; the new client opens **scoped streams matching the four chapter 03 SSE endpoints exactly** (chapter 03 section 3.6, FIXED-2):

| Factory | Endpoint | Typed union (`shared/events.ts`) | Lifecycle |
|---|---|---|---|
| `openChatRunStream(runId)` | `GET /api/v1/chat/runs/:id/events` | `ChatRunEvent` | opened on run creation, closed by the client on `complete`/`error` |
| `openJobStream(jobId)` | `GET /api/v1/jobs/:id/events` | `JobEvent` | same; also carries brand-research jobs (chapter 03 section 3.8.4) |
| `openAutomationRunStream(runId)` | `GET /api/v1/automations/runs/:id/events` | `AutomationRunEvent` | opened per active run; after a reload the run id is recovered via `GET /automations/runs?automationId=` before subscribing |
| `openNotificationsStream()` | `GET /api/v1/notifications/events` | `NotificationEvent` | opened once per authenticated session by the `ApiProvider`, closed on logout |

```ts
// web/lib/api/stream.ts (sketch)
export interface EventStream<E extends { type: string }> {
  readonly status: 'disconnected' | 'connecting' | 'connected';
  onStatusChange(fn: (s: Status) => void): Unsubscribe;
  on<K extends E['type']>(type: K, handler: (e: Extract<E, { type: K }>) => void): Unsubscribe;
  close(): void;
}
export function openJobStream(jobId: string): EventStream<JobEvent>;        // JobEvent from shared/events.ts
// ... one factory per sanctioned endpoint; nothing else constructs an EventSource
```

Design points, each carrying a proven behavior from the audit:

- **Typed subscriptions (FC-011):** `stream.on('tool_event', handler)` returns an unsubscribe function; event payloads are the zod-inferred types from `shared/events.ts`. There is no untyped wildcard.
- **Auth (FC-006):** `?token=<JWT>` because `EventSource` cannot set headers (chapter 03 section 3.2, carried).
- **Reconnect (FC-005, FC-008):** backoff 500 ms x 1.5^n capped at 15 s, plus the resilience listeners (`visibilitychange`, `online`, `focus` trigger an immediate reconnect attempt) - carried onto a shared stream manager so long-lived tabs survive sleep and offline.
- **Resume and re-sync (FC-006, FC-026, FC-206):** native `EventSource` auto-reconnects send `Last-Event-ID`, and the server replays from its bounded ring buffer (chapter 03 section 3.6 - replay is now an explicit contract, resolving the accident recorded in FC-006). Manual reconnects (backoff re-opens) re-sync state via the corresponding `GET /:id` after the stream's `ready` event - the pattern `useJobStream` already proved with its reconnect re-fetch. The legacy connected-event payload is gone; `ready` is a signal, not a data carrier (FC-206).
- **Status observable (FC-002):** the notifications stream, as the one long-lived stream, exposes `status` (`disconnected | connecting | connected`) and `onStatusChange`; a `useConnectionStatus()` hook feeds the connectivity badge (today consumed by the branding page).
- **Watchdogs (FC-034):** transport keepalives (comment frames every 30 s, chapter 03 section 3.6) keep intermediaries from closing idle streams; application-level silence watchdogs (the branding 3-minute watchdog) remain client-side, re-armed by any typed event and by stream reconnect - carried behavior.
- **Token changes (FC-004):** the stream manager subscribes to the token accessor; a new token closes and re-opens every active stream, a cleared token closes them all.

Store integration: `useJobStream` keeps its shape and consumes `JobEvent` (FC-026); `useAutomationRun` becomes per-run (FC-028) and the automations store keeps `applyLiveEvent` with the event names renamed to the chapter 03 union (mechanical); the chat page consumes `ChatRunEvent` for the active run and the four notification events from the shared notifications stream (FC-029, FC-031); the header billing gauge consumes `usage_updated` and refetches `GET /billing/usage` (FC-033). The automation payload types move to `shared/events.ts` as the single source; `web/types/automation.ts` keeps only UI-local view types.

### 12.3.1 The live browser canvas (pause-for-user, RESOLVED Q-01)

**RESOLVED (Q-01, carve-out a).** When an automation run needs the user to act inside the live browser (a login wall, a CAPTCHA, a manual confirmation), the run emits `streaming_available` `{ token, wsUrl, viewport }` on its automation-run stream (chapter 03 sections 3.6.3 and 3.7) and the run status moves to `paused_for_user`. The client opens the **live browser canvas**: JPEG frames stream down, mouse and keyboard events go up, over a single WebSocket. This is the one scoped exception to FIXED-2 as amended 2026-07-06 - a live browser canvas media channel (frames down, input events up, short-TTL token, never JSON API payloads), not API transport. Details are carried verbatim from chapter 03 section 3.7: the URL and a short-TTL token arrive in the event (the token is minted per handoff, never the session JWT); the close-code contract is preserved - `1000` normal close when the user hands control back and the run resumes, `4000` takeover which never reconnects (carryover landmine 8). Earlier drafts left this UX conditional on Q-01; that conditionality is removed and the canvas ships.

**Confinement.** The canvas WebSocket lives in its own module (`web/lib/api/canvas.ts`) and its component; it is the only `WebSocket` construction in `web/` and the only non-SSE transport, mirroring the FIXED-2 carve-out being a single named exception. Acceptance criterion 6 (`EventSource` only in `web/lib/api/stream.ts`) is unaffected: the canvas uses `WebSocket`, not `EventSource`, and a companion grep gate (section 12.8, criterion 15) confines `new WebSocket(` to the canvas module. Under FIXED-12, any structural change to the canvas transport updates diagram 04 (the automation/job stream consumer view) in the same unit of work.

## 12.4 Replacement map: every protocol touchpoint (FC-001..FC-069)

Every row cites its chapter 03 replacement. Fate column: **migrate** (behavior and contract kept), **clean** (capability kept, defect fixed or contract consciously changed), **delete** (not ported). All decisions the audit deferred are made here or cited to their owning register entry.

Coverage summary (auditable against reference/frontend-cleanup-audit.md section 1):

| Audit block | Ids | Count | migrate | clean | delete |
|---|---|---|---|---|---|
| 12.4.1 Core transport | FC-001..FC-025 | 25 | 10 | 12 | 3 |
| 12.4.2 Stream consumers | FC-026..FC-036 | 11 | 5 | 2 | 4 |
| 12.4.3 Domain calls | FC-037..FC-059 | 23 | 19 | 4 | 0 |
| 12.4.4 Raw HTTP | FC-060..FC-065 | 6 | 5 | 1 | 0 |
| 12.4.5 Token and identity | FC-066..FC-069 | 4 | 1 | 3 | 0 |
| Total | | 69 | 40 | 22 | 7 |

### 12.4.1 Core transport (audit section 1.1)

| FC | Legacy surface | Fate | Replacement (chapter 03 ref) and notes |
|---|---|---|---|
| FC-001 | `CortexConnection` singleton | clean | Split into the REST client (12.2) and the stream client (12.3); the file is deleted in W3 |
| FC-002 | Connection-status observable | migrate | `status`/`onStatusChange` on the notifications stream; `useConnectionStatus()` (12.3) |
| FC-003 | Tokenless connect enabling login | migrate | `auth: 'public'` descriptors work with no token (3.2); streams open only when a token exists |
| FC-004 | Token update re-authing SSE | migrate | Token accessor subscription re-opens streams (12.2.4, 12.3) |
| FC-005 | `reconnectNow` + visibility/online/focus listeners | migrate | Carried on the stream manager (12.3) |
| FC-006 | SSE via `?token=`; accidental replay semantics | clean | `token-query` auth carried (3.2); replay now explicit: `Last-Event-ID` + server ring buffer + `GET /:id` re-sync (3.6) |
| FC-007 | 31-type registered event list | clean | Four typed unions in `shared/events.ts`, derived from actual consumers; dead types dropped (3.6.5, Appendix A of ch03) |
| FC-008 | Backoff 500 ms x 1.5^n cap 15 s | migrate | Identical parameters (12.3) |
| FC-009 | Language stamped from localStorage in transport | clean | Language interceptor from the single i18n source (12.2.3; 3.4) |
| FC-010 | Fan-out firehose + wildcard + client-side trace filtering | clean | Scoped per-run/per-user streams (12.3); no wildcard |
| FC-011 | `on()/onStream()` returning unsubscribe | migrate | Same shape, typed per stream (12.3) |
| FC-012 | `sendAction` - the single-endpoint command call | clean | Retired wholesale; per-domain typed namespaces (12.2.1) covering the 3.8 resource map |
| FC-013 | `sendRequest` fire-and-forget chat send | clean | `api.chat.createRun` -> `202 { runId }` (3.8.7); the server-minted `runId` is awaited before subscribing (client-minted trace ids retired, 3.4 - accepted shape change under FIXED-9); the routing-mode enum is dropped (FC-210) |
| FC-014 | `cancelRequest` server-side abort | migrate | `POST /chat/runs/:id/cancel` (3.8.7); closing the stream never cancels the run (3.5) |
| FC-015 | `sendFileUpload` wrapper | delete | Zero callers; real uploads are FC-060/FC-061 (ch03 Appendix A) |
| FC-016 | Base-URL resolution duplicated in two modules | clean | One resolver with identical semantics (12.2.5) |
| FC-017 | `resolveApiUrl` | migrate | `api.resolveUrl` (12.2.6); five consumer files re-pointed |
| FC-018 | `authUser` cache + legacy auth event branch | delete | Identity comes from the auth store; the event is dropped from the wire (3.6.5) |
| FC-019 | `wsAction` response envelope | clean | Throwing `ApiError` + `tryCall` helper (12.2.2); envelope object retired |
| FC-020 | Legacy response-envelope unwrap | delete | One shape per endpoint (3.1); nothing to unwrap (with FC-200) |
| FC-021 | String-matching auth-failure interceptor | clean | HTTP-401-status interceptor, same logout-redirect (12.2.3) |
| FC-022 | Token accessor trio | clean | Single token module; set re-auths streams, clear closes them (12.2.4) |
| FC-023 | `getAppUrl` | migrate | `api.appUrl` (12.2.6); serving contract per 3.9 |
| FC-024 | `?token=` on non-shareable previews | clean | `api.withPreviewToken` per **RESOLVED (Q-05)** (default: `?token=` carried + server-side log-redaction middleware, 3.2); never applied to shareable artifacts |
| FC-025 | Provider boot: dev host override, one-time init, cross-tab token sync | migrate | `ApiProvider` (12.1) + token accessor storage listener (12.2.4) + dev branch in the resolver (12.2.5) |

### 12.4.2 Stream consumers (audit section 1.2)

| FC | Legacy surface | Fate | Replacement (chapter 03 ref) and notes |
|---|---|---|---|
| FC-026 | `useJobStream` (trace-gated build stream + reconnect re-fetch) | migrate | `openJobStream(jobId)` consuming `JobEvent`: `routing`, `text_chunk`, `tool_event`, `context_event`, `plan_step`, `preview_reload`, `complete`, `error` (3.6.2); re-sync via `GET /jobs/:id` after `ready` on reconnect; `preview_reload` now actually reaches the client (the old registration bug is fixed by construction) |
| FC-027 | Unreachable subagent branch in `useJobStream` | delete (final) | Event dropped from the v1 contract (3.6.5; RESOLVED (P-11), chapter 05). **RESOLVED (Q-04): delete on both sides** - the producer and the dead client handler both go; the delete is no longer conditional on a register-or-delete choice |
| FC-028 | `useAutomationRun` global subscription of 11 automation events | migrate | `openAutomationRunStream(runId)` consuming `AutomationRunEvent` (3.6.3); per-run scope; store `applyLiveEvent` kept with renamed events; run id recovered via `GET /automations/runs?automationId=` after reload |
| FC-029 | Chat-page delegation/notification subscriptions | migrate | Notifications stream: `build_intent`, `chat_answer`, `integration_build_intent`, `integration_ready` (3.6.4); backend-marker parsing is server-side, the client sees only typed events (FC-205) |
| FC-030 | Unreachable phase-event subscription | delete (final) | Dropped from the contract; phase info folds into job status events (3.6.5; RESOLVED (P-11)). **RESOLVED (Q-04): delete on both sides** - no longer conditional |
| FC-031 | Chat-run stream consumption (three chunk field names, delegate on complete) | migrate | `ChatRunEvent` (3.6.1): `text_chunk.text` is the one normalized chunk field; `complete.delegate` typed; cancel per FC-014 |
| FC-032 | Unreachable subagent branch on the chat page | delete (final) | Same as FC-027 (**RESOLVED (Q-04)**, delete on both sides); transitively kills FC-136 |
| FC-033 | Header billing gauge (`usage_updated` + provisional ticker) | clean | `usage_updated` on the notifications stream -> refetch `GET /billing/usage` (3.6.4; RESOLVED (P-13)); the cosmetic `usage_progress` ticker is dropped (RESOLVED (P-04)/(P-13)) - accepted visible change, now final: the gauge updates on completion, not mid-run |
| FC-034 | Branding research stream + status badge + 3-minute watchdog | migrate | `POST /branding/research` -> `{ jobId }` (3.8.4) + `openJobStream`; badge via `useConnectionStatus()`; watchdog carried (12.3) |
| FC-035 | Integration-builder streamed prose with correlation broken by design | clean | Request-response `POST /integration-builder/chat` (300 s route timeout, 3.8.14); the prose stream is dropped per **RESOLVED (P-04)** (3.6.4) - accepted visible change, now final: the builder panel shows a busy/progress state instead of streaming text. Rejected alternative: a run-correlated event streaming the prose (addable later without rework) |
| FC-036 | Registered-but-unconsumed event types | delete | Dropped from the wire (3.6.5; ch03 Appendix A) |

### 12.4.3 Domain calls (audit section 1.3)

| FC | Legacy domain surface | Fate | Replacement (chapter 03 ref) and notes |
|---|---|---|---|
| FC-037 | Auth calls (login, change-password, identity, device approve, admin create/reset) | migrate | 3.8.1 + 3.8.2 (`POST /auth/login`, `POST /auth/password`, `GET /auth/me`, `POST /auth/device/approve`, `POST /users`, `POST /users/:id/password`); sign-out gains a real server call - `POST /auth/logout` revokes the current token (RESOLVED (P-03), 3.8.1) before the accessor clears it; decided per the audit's sub-note: `login()` no longer sets the token as a side effect - the auth store calls `api.auth.login` then `setToken`, and the logout action calls `api.auth.logout` then `clearToken` |
| FC-038 | Users list/delete | migrate | `GET /users`, `DELETE /users/:id` (3.8.2) |
| FC-039 | Teams CRUD | migrate | `/teams` (3.8.3) |
| FC-040 | Company get/update (legacy read-only write path bypassed) | clean | `GET /company`, `PATCH /company` (3.8.4); the workaround comment and bypass disappear - writes are first-class |
| FC-041 | Branding save + research start | migrate | `PUT /branding`, `POST /branding/research` (3.8.4) |
| FC-042 | Integrations live subset (definitions, active catalog, configs, sessions, provisioning) | migrate | 3.8.13; the trigger picker reads `GET /integrations/active`; session-capture status stays client-polled every ~2 s (ch03 keeps it request-response); vocabulary decision under FC-207 |
| FC-043 | Integration-builder chat/load/save/test with long timeouts | migrate | 3.8.14; timeouts become descriptor-level settings (300 s / 60 s, 3.4); save success arrives as `integration_ready` on the notifications stream |
| FC-044 | Settings get/update + two debounce-bypassing writers | clean | `GET /settings`, `PATCH /settings` (3.8.5); decided: all settings writes go through the settings store's single debounced writer - the platform page's inline call and the pipedream store's cross-domain write are re-pointed to the store action (same wire effect, one write path; FIXED-9 behavior-preserving) |
| FC-045 | Job execution (execute/get/cancel + request payload) | migrate | `POST /jobs` (discriminated `created`/`answered` response), `GET /jobs/:id`, `POST /jobs/:id/cancel` (3.8.8); attachments ride as `uploadId` references, never absolute server paths (3.4); boot re-sync sweep uses `GET /jobs/:id` |
| FC-046 | Artifacts family (largest live surface: CRUD, featured, bundle ops, versions, files, fork) | migrate | `/artifacts` resource family (3.8.9); inline call sites (slug/rename/shareable patches, webhooks section, chat stripes, file editor, versions panel) re-pointed to `api.artifacts.*`; naming drift resolved (FC-302) |
| FC-047 | App-data backups (status/download/preview/snapshot/restore) | migrate | `/artifacts/:id/backups` (3.8.10); keyed by artifact id, server resolves the data scope |
| FC-048 | Artifact backend panel (status/logs/invocations/enable/sample) | migrate | `/artifacts/:id/backend` (3.8.11) |
| FC-049 | Sessions live subset (create incl. onboarding type, list, messages, rename, touch, delete) | migrate | `/sessions` + `/sessions/:id/messages` (3.8.6); touch = empty `PATCH` stamping `updatedAt` (carried) |
| FC-050 | Memory CRUD + thumbs signal + tags/stats | migrate | `/memories` (3.8.19); signals keyed by `runId` (3.8.19); scope per **P-12** (CRUD + resolver injection in v1); semantics assumption recorded at FC-209 |
| FC-051 | Automations surface (CRUD, plan-from-goal, runs, consent, feedback, catalog, approved commands) | migrate | 3.8.18; plan response names both side effects (`automation`, `runId`) so the store's rehearsal handling becomes explicit; run cancel/resume keyed by run id; approved-commands list/revoke carried (their page is FC-101/**Q-07**) |
| FC-052 | Knowledge vault surface (collections, documents, sources, crawl, uploads, schedule) | migrate | 3.8.20; crawl status stays client-polled |
| FC-053 | Billing user + admin surface | migrate | 3.8.21; backs the billing settings page and the hidden `/usage` admin page (FC-102) |
| FC-054 | Pipedream surface + cross-domain enable toggle | migrate | 3.8.16; the enable toggle remains a settings field written via the settings store (FC-044 decision) |
| FC-055 | Triggers (list/create/delete, per-automation list, manual-setup response, client-rebuilt hook URL) | migrate | 3.8.17; `GET /triggers` returns `publicUrl` so the client URL reconstruction is deleted (landmine 3); create keeps the `{ trigger, publicUrl, secret?, registrationError? }` shape as a typed union; inline call sites in the trigger picker and backend-trigger card re-pointed to `api.triggers.*` |
| FC-056 | Platform integrations (connect/disconnect/status/list from two call sites) | migrate | 3.8.15; both `list` call sites use `api.platformIntegrations.list()`; OAuth popup flow unchanged (callback page posts to opener) |
| FC-057 | Company-space inline calls with inconsistent params | clean | 3.8.12 with the one normalized `artifactId` param (resolves audit conflict C-7); running-state poll stays client-side |
| FC-058 | Featured-content seeding fired from the chat page | clean | `POST /sessions/:id/seed-featured` (3.8.6) - chapter 03 decided it stays a client-triggered, session-scoped call for the customize flow; the cross-cutting assumption is retired with FC-208 |
| FC-059 | Featured fork flow (popup-blocker-safe pre-opened tab) | migrate | `POST /artifacts/:id/fork` (3.8.9); popup-safe navigation stays client-side; the dead wrapper it bypassed is deleted (FC-133) |

### 12.4.4 Raw HTTP endpoints (audit section 1.4)

| FC | Legacy surface | Fate | Replacement (chapter 03 ref) and notes |
|---|---|---|---|
| FC-060 | Binary attachment staging (`X-Filename`/`X-Folder`) | migrate | `POST /uploads` (3.8.22) via the `binary` descriptor kind; response returns `uploadId` + display metadata - the absolute-server-path leak is retired (3.4); token via the accessor (FC-066) |
| FC-061 | Knowledge binary upload | migrate | `POST /knowledge/uploads` (3.8.20), `binary` kind, 50 MB default limit carried |
| FC-062 | Artifact code zip download with 422 secret-guard copy | clean | `GET /artifacts/:id/download` (3.8.9); typed `422 SECRET_GUARD_BLOCKED`; manual localStorage read replaced by the accessor |
| FC-063 | Demo tour specs + assets (three public routes) | migrate | `/api/demos`, `/api/demos/:appId`, `/api/demos/assets/:image` verbatim (3.8.23) |
| FC-064 | App-serving URLs (iframe, HEAD readiness probe, share link) | migrate | 3.9 static serving verbatim; preview `?token=` per **RESOLVED (Q-05)** (FC-024); HEAD-probe polling stays client-side |
| FC-065 | Public asset routes (brand assets, screenshots) | migrate | 3.8.23 via `api.resolveUrl`; CORS + cache headers carried |

### 12.4.5 Token and identity handling (audit section 1.5)

| FC | Legacy surface | Fate | Replacement and notes |
|---|---|---|---|
| FC-066 | Five independent raw readers of the token key | clean | All through the single accessor (12.2.4); acceptance criterion 4 makes this a grep gate |
| FC-067 | Persisted auth state + rehydrate re-injection | migrate | Carried; rehydrate pushes the token through the accessor, which re-auths streams; boot validation/renewal per 12.2.3 (RESOLVED (P-03)) |
| FC-068 | Token-in-query surfaces (SSE + previews) | clean | SSE `?token=` kept (EventSource limitation, 3.2); previews per **RESOLVED (Q-05)** - `?token=` carried (default) with server-side log-redaction middleware |
| FC-069 | Language key triplication | clean | One persisted language source feeding the interceptor (12.2.3); the mirror key is deleted |

## 12.5 Cleanup scope: every remaining FC id

Decisions the audit marked "decision required" are resolved inline: most are decided here as behavior-preserving cleanup under FIXED-9; the two formerly-open ones (FC-101, FC-120) were carried under **Open question Q-07**, now **RESOLVED (Q-07, founder, 2026-07-06)**: FC-101's `/settings/bridge` page is linked into settings navigation and absorbed into the new "Privacidade e ponte local" surface (section 12.6), and FC-120's write-only demo-cards state is deleted (final).

Decision register for this chapter (each decided item, for founder scan; none is PROPOSED because each is either behavior-preserving cleanup within the FIXED-9 mandate or already decided by chapter 03):

| Decision | Where | Basis |
|---|---|---|
| Client methods throw `ApiError`; the old success/data envelope object is retired; `tryCall` eases store migration | 12.2.2 | FIXED-9 (wire and client shapes may change; behavior preserved) |
| No automatic request retries in the client | 12.2.2 | duplicate-create risk; explicit re-sync paths exist |
| Endpoint descriptor maps live in `shared/` as contract data alongside the schemas | 12.2.1 | FIXED-1/FIXED-9 (client generated from the shared contract); refines ch02 2.2 without adding utilities or config |
| Login no longer sets the token as a side effect; the auth store owns the sequence | 12.4.3 FC-037 | audit sub-note; single-responsibility cleanup |
| All settings writes flow through the settings store's single debounced writer | 12.4.3 FC-044 | audit sub-note; same wire effect |
| Delete all nine redirect stubs; carry exactly one config-level redirect (`/settings` -> `/settings/platform`) | 12.5.1 FC-100 | zero inbound links (audit-verified); FIXED-9 |
| Delete the whole `executionOptions` vestige block including its constant-default reads | 12.5.1 FC-117 | reads can only observe init defaults; wire effect unchanged |
| Delete `lib/conversation-types.ts` entirely (no survivor type remains referenced) | 12.5.1 FC-107..FC-109 | FC-110 removes the last candidate reader |
| Keep the no-mode-picker guard test, simplified in the same pass as the locale deletion | 12.5.3 FC-306 | audit recommendation made concrete |
| Accepted visible changes are exactly three: awaited run id on chat send (FC-013), usage gauge updates on completion only (FC-033), builder busy state instead of streamed prose (FC-035) | 12.4 | FIXED-9 escape hatch, named explicitly |
| RESOLVED (Q-07, founder, 2026-07-06): `/settings/bridge` linked into settings navigation and absorbed into the "Privacidade e ponte local" surface; write-only demo-cards state deleted (final) | 12.5.1 FC-101/FC-120; 12.6 | amendment brief (docs/ekoa-code-spec-amendment-brief.md) |

### 12.5.1 Dead code and UI (FC-100..FC-139)

| FC | Item | Fate | Decision / notes |
|---|---|---|---|
| FC-100 | 9 redirect-only stub routes | delete (decided) | Zero internal links target them. Decided: delete all nine page stubs; re-express exactly one as a `next.config` redirect - `/settings` -> `/settings/platform` (a natural URL users type). The other eight get no redirect: they are orphans with no inbound links, and the audit confirms no config-level redirects exist today, so nothing observable changes (FIXED-9) |
| FC-101 | `/settings/bridge` orphan page (working approved-commands UI, no navigation entry) | clean (**RESOLVED (Q-07)**) | The API keeps its endpoints (`GET /automations/approved-commands`, `POST .../revoke`, 3.8.18). **RESOLVED (Q-07): the page is linked into the settings navigation and extended into the new settings surface "Privacidade e ponte local" (section 12.6, FC-404/FC-409)** - `/settings/bridge` is absorbed there, its approved-commands list unified with bridge status, active grants, and the ledger viewer. The former "carry unlinked as status quo" default is retired. Rejected alternative: drop the page and manage approvals only through the run-viewer consent flow (feature loss) |
| FC-102 | `/usage` hidden super-admin page | migrate | Intentional hidden route; kept, and the convention (hidden admin routes documented in the page header) is recorded in the repo `CLAUDE.md` |
| FC-103 | `interview-renderer.tsx` (wizard Q&A renderer, 266 ln) | delete | Zero importers (audit-verified); sole reader of the dead interview subsystem (FC-112) |
| FC-104 | `ui/tooltip.tsx` design-system primitive | delete | Zero importers |
| FC-105 | `lib/template-inference.ts` local keyword pre-selection | delete | Zero importers; its backend pair is also dead (FC-131) |
| FC-106 | `types/template.ts` (config/build/output types) | delete | Only importer is the dead FC-105 |
| FC-107 | Client-side mode classifier + verb/noun scoring engine | delete | Zero production callers; the server classifies (FIXED-3) and the client consumes typed `build_intent` events (FC-029, FC-205) |
| FC-108 | Classifier/interview/chat-input types in `lib/conversation-types.ts` | delete | Consumed only by dead code; the file is deleted entirely - the only candidate survivor (`ConversationMode`) loses its last reader when FC-110 deletes the store state (decided) |
| FC-109 | `__tests__/conversation-types.test.ts` | delete | Its entire subject is FC-107/FC-108 |
| FC-110 | `conversationMode` store state + setter | delete | Zero readers/writers outside the store |
| FC-111 | `pendingModeSwitch` state + setter + type | delete | Zero consumers |
| FC-112 | Interview subsystem in the orchestration store (state + five actions) | delete | An interview can never start (`startInterview` uncalled); only other reader is the zero-importer FC-103 |
| FC-113 | `perSessionContext` persisted routing/interview context | delete | Never read outside the store; only writers are the never-called FC-110/FC-112 paths; persisted dead state stops being written |
| FC-114 | `showWizard` + setter (constant-false reads on the chat page) | delete | Setter never called; the wizard UI is gone; the constant-false reads are removed with it |
| FC-115 | `pendingFirstMessage` + setter | delete | Zero consumers |
| FC-116 | Suggested template/integrations state + setters | delete | Zero consumers |
| FC-117 | `executionOptions` vestiges (setters never called; two fields read but only ever holding init defaults) | delete (decided) | Decided: remove the whole block. The chat page's two reads can only ever observe init defaults, so job creation stops sending always-default `templateId`/`integrationKeys` values - the wire effect is unchanged in practice (constants in, constants out) and the fields stay optional in `JobCreateRequest` (3.8.8) for the live flows that do set them |
| FC-118 | `dequeueMessage` | delete | Only test callers; `enqueueMessage`/`drainQueue`/`clearQueue` are alive and stay |
| FC-118b | `removeQueuedMessage` | migrate | NOT dead (live X-button on queued-message chips in the chat panel); kept with the queue actions |
| FC-119 | Legacy persistence migrations stripping removed per-session mode fields | delete | A fresh store in `web/` needs no migration from the removed system |
| FC-120 | Write-only demo-cards store state for a never-built gallery panel | delete (**RESOLVED (Q-07)**) | **RESOLVED (Q-07): the write-only state is deleted, final** (nothing reads it; behavior-preserving and reversible). Building the gallery panel later remains a separate follow-up that would reintroduce the state with a reader; it is not part of this migration. The demo tour overlay itself is live and migrates (FC-063) |
| FC-121 | Registry-refresh store action + client fn chain | delete | Zero UI callers; the API keeps `POST /integrations/refresh` as an admin operation (3.8.13) with no v1 UI |
| FC-122 | Vestigial settings-schema fields with no UI control and no reader | delete | Removed from the client types and the reset-defaults literals; the live contrast fields (`chat.guidedMode`, `chat.showExampleCards`, `chat.guidance`, `build.showFileTreeByDefault`) stay; `PlatformSettings` in `shared/` simply never declares the dead fields |
| FC-123 | Claude-OAuth client-function trio | delete | Zero callers AND no backend domain (ch03 Appendix A) |
| FC-124 | Agent-config client-function pair | delete | Zero callers AND no backend domain |
| FC-125 | Tunnel client-function five | delete | Zero callers AND no backend domain; the `/tunnel` stub dies in FC-100 |
| FC-126 | Projects client-function four | delete | Zero callers; both ends vestigial (ch03 Appendix A drops the operations) |
| FC-127 | Legacy chat-send wrapper | delete | Zero callers; chat is the runs resource (FC-013) |
| FC-128 | Activity-log client function | delete | Zero callers; activity read surfaces are deferred (ch03 Appendix A; FIXED-8 keeps the single write path server-side) |
| FC-129 | Legacy company-knowledge client-function five | delete | Zero callers; superseded by the live knowledge surface (FC-052) |
| FC-130 | Integration access grant/revoke pair | delete | Zero callers (ch03 Appendix A) |
| FC-131 | Integration-inference client fn + result type | delete | Zero callers; pairs with FC-105 |
| FC-132 | Session wrapper trio (`getSessionWithMessages`/`getSession`/`updateSession`) | delete | Zero callers; the live session surface is FC-049; the with-messages variant is superseded by two reads (ch03 Appendix A) |
| FC-133 | `forkArtifact`/`exportArtifact` wrappers | delete | Zero callers; live fork is FC-059, live export/download is FC-062 |
| FC-134 | Company-space wrapper trio with mismatched params | delete | Zero callers; the live inline path (FC-057) is authoritative and the REST design normalizes the param (audit conflict C-7) |
| FC-135 | `getFileLanguage()` helper | delete | Zero callers; the live siblings in `lib/file-utils.ts` stay |
| FC-136 | Subagent friendly-message helper | delete | Callers are only the unreachable branches FC-027/FC-032; the live parts of the friendly-message module stay (FC-204) |
| FC-137 | `'subagent'` output-entry type + fields in the orchestration store | delete | Transitively dead with FC-027/FC-032/FC-136 |
| FC-138 | Stale locale sections with zero consumers (old grouped nav, synthetic progress, tool-activity, tunnel/app-management/agent-config/chat pages, mode-selector copy, subagent keys, wizard copy) | delete | Deleted across all three locale files (`types.ts`, `en.ts`, `pt.ts`) in one commit; the locale coherence e2e spec does not pin them (audit-verified) |
| FC-139 | i18n store re-exports of the dead sections | delete | Only the cited re-export lines are removed (they interleave with live ones); deleted together with FC-138 |

### 12.5.2 Assumptions about the old backend's design (FC-200..FC-210)

| FC | Item | Fate | Decision / notes |
|---|---|---|---|
| FC-200 | Legacy response-envelope unwrap in the client | delete | One shape per endpoint (3.1); goes with FC-020; the company store reads plain JSON |
| FC-201 | Consumption of the legacy agent-context activity events in build output and chat | clean (decided) | Chapter 03 renames the event `context_event` (`{ name, action: 'loaded' | 'used' }`, 3.6.1/3.6.2) and keeps it in both streams; the UI keeps rendering it as generic agent-activity lines - same visuals, typed contract |
| FC-202 | `plan_step` consumption (plan-progress rendering) | clean (decided) | Kept: `JobEvent` carries `plan_step`, which also absorbs the retired phase events' information (3.6.2; RESOLVED (P-11)) |
| FC-203 | `routing` consumption (tier-decision badge) | clean (decided) | Kept: `JobEvent.routing` `{ tier, reason }` (3.6.2); the badge renders the new payload |
| FC-204 | Tool-name to friendly-copy mapping for Agent SDK tool events | migrate | The rebuilt backend still runs the Agent SDK (FIXED-3), so tool names persist; mapping kept, subagent part pruned (FC-136) |
| FC-205 | Delegation pipeline assuming server-parsed prose markers | clean | Delegation is a first-class typed event: markers are parsed server-side in the run pipeline, the client consumes `build_intent`/`integration_build_intent` notifications and `complete.delegate` (3.6.1, 3.6.4; chapter 05 section 5.7.2). The client-side UI contract (migrate the conversation into build mode) is unchanged |
| FC-206 | Legacy connected event carrying a backend content inventory the client never read | clean | Replaced by the payload-free `ready` event + `GET /:id` re-sync (12.3); no content inventory crosses the wire |
| FC-207 | UI models integrations as markdown-package-backed registry entries with webhook/listener metadata | clean (decided) | The REST resource is a plain integrations catalog (3.8.13: definitions, active catalog with event metadata, configs). The store and component identifiers are renamed to catalog vocabulary (`listDefinitions`, `IntegrationDefinition`); the webhook/listener event metadata survives as ordinary catalog fields because the trigger picker needs it. User-visible copy already says "integrations" and does not change |
| FC-208 | UI-triggered content seeding on first chat load | clean | Re-pointed to the session-scoped `POST /sessions/:id/seed-featured` (3.8.6; FC-058); no cross-cutting seeding assumption remains in the client |
| FC-209 | Thumbs feedback assuming server-side trace-to-memory linkage | migrate | `POST /memories/signals` keyed by `runId` (3.8.19); the linkage is a server obligation recorded in chapter 05 (P-12 scope) |
| FC-210 | Chat send routing-mode union (force flags never sent) | delete | Only the default was ever sent; routing is server-side via the tier classifier (FIXED-3; ch03 Appendix A) |

### 12.5.3 Visibly stale items (FC-300..FC-312)

| FC | Item | Fate | Decision / notes |
|---|---|---|---|
| FC-300 | WS-era function name on the HTTP wrapper | clean | The wrapper itself is replaced (FC-019); no name survives to rename |
| FC-301 | WS-era comment on the dead upload wrapper | delete | Goes with FC-015 |
| FC-302 | Templates-vs-artifacts naming drift (domain id vs handler vs client fn names) | clean | Resolved by the `/artifacts` resource (3.8.9) and the `api.artifacts` namespace; no `template`-named client function survives for artifact operations |
| FC-303 | Comments describing phase-event side-panel sync that cannot fire | clean | Removed together with the FC-030 deletion; the RESOLVED (P-11) outcome (phase info in `plan_step`) is what the side panel actually consumes |
| FC-304 | Mode-selector reset literal in platform settings | delete | Goes with FC-122 |
| FC-305 | Store header comment recording a superseded backend module | clean | The contradiction is now recorded in the spec (this row and reference/frontend-cleanup-audit.md); the comment is dropped with the migration |
| FC-306 | Guard test banning a mode-picker UI | migrate (decided) | Kept, and simplified in the same pass that deletes the dead locale keys (FC-138) - the test's acknowledgment branch for those keys is removed |
| FC-307 | Four unit tests mocking the old transport | clean | Ported in W5 with mocks against the new client modules (`web/lib/api/`); same behavioral assertions |
| FC-308 | Phantom frontend artifacts claimed by old docs but absent from code (preview-mode system, grouped sidebar, unified settings page, mock fallback, nonexistent stores/components) | delete | Nothing is ported and nothing is re-implemented; code wins over docs (audit conflicts C-3/C-4/C-5). The new repo `CLAUDE.md` is written fresh from this spec, never copied from the old one |
| FC-309 | Stale documented redirect list for routes that do not exist | delete | The only redirect carried is `/settings` -> `/settings/platform` (FC-100 decision); the doc list is not reproduced |
| FC-310 | Broken-correlation apology comment in the integration-builder store | delete | Goes with FC-035 (the correlation problem no longer exists) |
| FC-311 | Backend module with zero frontend surface (deployments) | delete | Nothing to migrate client-side; recorded so no chapter assumes a web consumer exists |
| FC-312 | Seven e2e specs coupled to the old wire (direct posts to the command endpoint, route intercepts) | clean | Rewritten in W5 against the typed routes: direct setup posts become calls to the corresponding `/api/v1/...` resources (e.g. artifact creation via `/artifacts`, settings via `PATCH /settings`); `page.route()` intercepts target the specific REST paths they fake instead of the single command endpoint. Chapter 13 owns the wider suite strategy |

## 12.6 Local file access and privacy surfaces (chapter 18)

These web surfaces are net-new, added by the 2026-07-06 amendment; they are not among the 134 audit items and carry their own id block (FC-400..FC-412). **What exists today: nothing** - the current frontend has no local-file reference affordance, no per-turn trust chip, and no privacy/bridge settings surface beyond the orphan `/settings/bridge` page (FC-101). **What is built: the surfaces below.** Chapter 18 owns the daemon/bridge wire contract, the `delegate_to_local` mechanism, and the security model S1-S6; chapter 17 owns the anonymisation mechanism, the audit log the mask counts read from, and the claims-discipline gate (section 17.9); this section owns the FC-level web detail and cites them. The scope split is absolute: everything specified here is `web/` code in the new repository (`ekoa-code`); the ekoa-local daemon that serves the picker, the grants, and the ledger is out of scope, built later by its own brief (chapter 18 section 18.1).

**PT-PT strings and the claims ceiling (binding).** Every user-facing string here is PT-PT in the owner's conventions: formal register, no em-dash characters, "por omissão", "ecrã". Every claims-bearing string's ceiling is **chapter 17.9's verbatim A1 claimable/forbidden lists** - no surface may state a claim tighter than those permit, and no phrase on the forbidden list (for example "os seus dados nunca saem da sua máquina", any "mascarado antes de sair da sua máquina" wording, "a Ekoa nunca vê os seus dados") may ever appear. Copy must never imply masking happened before Boundary 1: excerpts cross the user-machine -> Cortex hop in cleartext (diagram 10; chapter 17 section 17.1). Purely-UX micro-copy that carries no legal claim (the Upload-vs-Reference distinction) is exempt from the claims ceiling but still PT-PT.

**Ship-gate (mirror of the v2 A7.4 publish gate; see chapter 17 section 17.9).** The strings below are DRAFTED in the implementation run but ENABLED for users only after the mechanism each describes has passed its tests (chapter 14 anonymisation phase and delegation/bridge phase gates; chapter 17 section 17.9). A string that says "cada leitura fica registada" ships only once the ledger passes its scenario; a chip mask-count claim ships only once the audit-join passes. Never claims ahead of enforcement.

### 12.6.1 Attach affordance: Upload vs Reference (FC-400, FC-401)

The composer's attach affordance offers **two actions** where today it offers one:
- **Enviar (Upload)** - the existing upload pipeline (FC-060, `POST /uploads`), unchanged. Uploaded files are stored at rest, hosted.
- **Referenciar ficheiro/pasta local (Reference)** - opens the daemon's native OS picker (real paths; a browser input cannot supply them); the chosen path becomes a session grant (chapter 18 section 18.2) and a visible reference token in the composer. Reference never copies and never uploads.

Micro-copy distinguishing the two, verbatim from the Ekoa Local v2 brief (docs/, A7.2), the source's em-dash replaced with " - " per owner convention: **"Enviar guarda uma cópia nos nossos servidores. Referenciar mantém o ficheiro apenas no seu computador - recomendado para documentos sensíveis."** This is a UX distinction, not a legal claim, so it needs no citation.

| FC | Surface | Fate | Detail |
|---|---|---|---|
| FC-400 | Attach menu with two actions (Upload, Reference) | build | New two-item affordance; Upload re-uses the FC-060 pipeline; Reference is new. Micro-copy above |
| FC-401 | Reference action states | build | Three states, driven by the bridge presence heartbeat (chapter 18 section 18.3): (1) **no bridge installed** - the action renders disabled with a short explanation and an install CTA linking to the daemon download/pairing flow; install-CTA primary copy (verbatim, v2 A7.2): "Os documentos dos seus clientes ficam no seu computador; o agente lê apenas o que precisa e cada leitura fica registada." with a "saiba mais" link into the settings privacy panel (FC-404). (2) **installed but offline** - "ponte offline" state with a retry hint; nothing is silently degraded to upload (chapter 18 section 18.2). (3) **connected** - the native picker opens; the chosen path becomes a session grant and a composer reference token |

### 12.6.2 Per-turn trust chip (FC-402, FC-403)

On any hosted chat turn that touched local files (a turn whose `delegate_to_local` call read excerpts - chapter 18 section 18.2), the client renders a **trust chip** summarising, for that turn: the file(s) and range read plus **bytes-out** (from the local egress ledger), and **masked-entity counts by class** (from the hosted anonymisation audit log, chapter 17 section 17.6). The two sides join on the per-request correlation id (chapter 18 section 18.6; chapter 17 section 17.6). Bytes-out ledger data is surfaced as transient display metadata and is **not** persisted in hosted conversation records by default (chapter 18 section 18.2); mask counts come from the hosted audit metadata.

Chip copy is mechanism-only and two-boundary honest. Example, verbatim from the v2 brief A4 (middle dot allowed, no em-dash): **"Leu contrato.docx (secção 3.1) · 3,1 KB saíram desta máquina de forma transitória · 14 nomes e 3 NIFs mascarados antes do fornecedor de IA"**. "antes do fornecedor de IA" names Boundary 2; the copy must never imply masking happened before Boundary 1 - "saíram desta máquina de forma transitória" states honestly that the excerpt did leave the machine in cleartext.

| FC | Surface | Fate | Detail |
|---|---|---|---|
| FC-402 | Per-turn trust chip | build | Rendered on turns that touched local files; numbers from the ledger (bytes-out) and audit log (mask counts by class), joined by correlation id. Chip claims copy DRAFTED, SHIP-GATED on the ledger + audit-join test evidence (chapter 14; chapter 17 section 17.9). Cut-line note (v2 Part B): the chip may temporarily show bytes-only while the audit-join lands, but the join must land before any client-facing demo of the privacy story |
| FC-403 | Chip "i" custody/claims panel | build | A small "i" affordance on the chip opens a short panel carrying the custody claims (chapter 17 section 17.9, A6/D4 ceiling) and a link into the settings privacy panel (FC-404) and, once published, the public custody-map page. Claims copy ship-gated as above |

### 12.6.3 Settings surface "Privacidade e ponte local" (FC-404..FC-410, RESOLVED Q-07)

**RESOLVED (Q-07):** `/settings/bridge` is linked into the settings navigation (one entry) and extended into a settings surface titled **"Privacidade e ponte local"** - the fullest in-app real estate for the privacy story. It absorbs the old orphan page's approved-commands UI (FC-101) and adds the rest.

| FC | Surface | Fate | Detail |
|---|---|---|---|
| FC-404 | Settings route "Privacidade e ponte local" (absorbs `/settings/bridge`) | build/clean | New settings surface, linked in navigation (RESOLVED (Q-07); FC-101). Hosts the sections below. The `/settings/bridge` route is retained and re-homed into this surface; its endpoints are unchanged (3.8.18) |
| FC-405 | Bridge status and pairing | build | Bridge presence/heartbeat status and the pairing flow (chapter 18 section 18.3); the revoke-pairing kill switch is surfaced here |
| FC-406 | Active grants with revoke | build | Lists the session's active grants (chapter 18 section 18.2); revoke takes effect on the next tool call (not retroactive to reads already made) |
| FC-407 | Local ledger viewer (served live by the daemon) | build | The egress ledger is rendered from data served **live by the daemon**, not from hosted storage - hosted persistence of ledger rows is off by default (chapter 18 section 18.2; paths themselves can be sensitive, e.g. client names in folder names). An export (print/CSV) is a named fast-follow, not this run |
| FC-408 | Masking activity summary | build | Summary of masking activity from the hosted audit log (chapter 17 section 17.6): entity classes and counts, never bodies, never the vault |
| FC-409 | Approved-commands list (unified) | clean | The approved-commands list/revoke from the old `/settings/bridge` (FC-101) is unified into this surface; endpoints unchanged (`GET /automations/approved-commands`, `POST .../revoke`, 3.8.18) |
| FC-410 | Grounded expandable sections | build | Expandable sections, each grounding a claim already licensed in chapter 17 section 17.9's A1/A6 lists (never a new claim drafted at the UI layer): "Como isto se relaciona com o seu dever de segredo profissional" (EOA art. 92.º) -> the custody/D4 claim; "O que acontece se recebermos um pedido de uma autoridade" (Reg. (UE) 2023/1543) -> the jurisdiction claim; "Onde ficam os seus dados" (RGPD) -> the minimização-produzível claim. A visible "isto não é aconselhamento jurídico" line is shown where the citations get dense. Citations live in the "saiba mais" expansions, never in the primary one-line copy. All claims copy DRAFTED, SHIP-GATED on the mechanism evidence (chapter 17 section 17.9) |

The specific claim strings these sections render are the licensed A6 texts, carried verbatim here as their ceiling (chapter 17 section 17.9 holds the authoritative A1/A6 lists; a surface may render tighter, never looser):
- Custody / segredo (EOA): "Os ficheiros do escritório nunca saem da esfera física do advogado; a premissa de facto em que assentam as proteções dos arts. 75.º e 76.º do EOA e 177.º, n.º 5, e 180.º do CPP mantém-se para o arquivo." and "Cada leitura fica registada num livro de custódia guardado no próprio escritório: o advogado sabe sempre o que saiu da máquina, quando e em que dimensão."
- Jurisdiction (Reg. (UE) 2023/1543 / RGPD art. 48.º): "A Ekoa é uma sociedade portuguesa, subcontratante ao abrigo do RGPD com DPA; qualquer pedido de acesso é tratado ao abrigo do direito da UE, com sinalização do segredo profissional na revisão do pedido e notificação ao escritório salvo proibição legal; pedidos de países terceiros sem base em acordo internacional colidem com o art. 48.º do RGPD."
- Minimização produzível (RGPD): "Não podemos entregar o que não guardamos: não existem ficheiros de clientes em repouso nos nossos servidores e o mapa de reidentificação é efémero, deixando de existir no fim da sessão."
- Limites (asserted alongside the claims, never omitted): "a camada de raciocínio é SaaS na taxonomia CCBE; excertos transitam de forma transitória; a deteção tem cobertura elevada, não perfeita; os subprocessadores de matriz norte-americana implicam risco residual de processo de país terceiro, razão de ser da minimização e do futuro escalão edge para a matéria mais sensível."

### 12.6.4 First-time grant dialog and onboarding card (FC-411, FC-412)

| FC | Surface | Fate | Detail |
|---|---|---|---|
| FC-411 | First-time grant dialog | build | Shown at the point of consent when a Reference grant is first created. One line (verbatim, v2 A7.2): "Esta autorização permite ao agente ler [pasta/ficheiro] durante esta sessão. Pode revogar a qualquer momento em Definições → Privacidade e ponte local." ([pasta/ficheiro] is filled with the chosen target) |
| FC-412 | One-time onboarding card (legal tenants) | build | For Ekoa Legal tenants, a single dismissible card on first use introduces the two-boundary model (diagram 10) in plain language; not a tour, one card; reachable again from the settings privacy surface (FC-404). Card copy is ceiling-bound to chapter 17 section 17.9's A1 lists and ship-gated |

Not touched here (carried from v2 A7.2/A8): the automations/executor consent surfaces (`local_command` approvals) belong to a different track and are out of scope for this section; the same claims ladder should extend there eventually (noted, not built). Website surfaces are a separate brief.

## 12.7 Explicitly out of scope

- **No visual redesign (FIXED-9).** Layout, styling, component structure, and copy are unchanged except where a row above names a visible consequence (FC-033 gauge timing, FC-035 builder busy state), a deletion removes a dead surface, or section 12.6 adds a net-new amendment surface (the local file access and privacy web surfaces are new components, not a redesign of existing ones). PT-PT copy is carried as-is.
- **No route restructuring beyond the deletions in FC-100 and the Q-07 navigation link.** Live routes keep their paths; no pages move, merge, or split. The one navigation change (FC-101) is now decided, not a candidate: RESOLVED (Q-07) links `/settings/bridge` and absorbs it into the "Privacidade e ponte local" surface (12.6).
- **No state-management rework.** Zustand stores keep their shapes and persistence keys except where a row above deletes dead state or re-points a transport call. No store is rewritten for its own sake.
- **No new features beyond the amendment surfaces.** The migration itself adds no features; the one exception is the net-new local file access and privacy web surfaces of section 12.6, added by the 2026-07-06 amendment and in scope here. The gallery panel (rebuilding FC-120's reader) and streaming builder prose (P-04 rejected alternative) remain genuine follow-ups, not migration work; the Q-07 navigation link is done (12.6), not a follow-up.
- **No framework or tooling migration.** The app stays Next.js App Router; upgrades are not part of this program.
- **ekoa-local UI surfaces.** The TUI and daemon are out of scope (FIXED-1); the P-18 compatibility channel (chapter 03 section 3.10) never appears in `web/`.

## 12.8 Acceptance criteria (checkable without a human)

1. **Legacy transport census is zero.** Grep over `web/` finds no occurrence of `/api/v1/action`, `/api/v1/request`, `sendAction`, `sendRequest(`, `wsAction`, or `lib/cortex/connection`.
2. **Every protocol touchpoint is replaced.** For each row FC-001..FC-069 in 12.4, the named replacement exists in `web/` and the legacy surface named in the row is absent (auditable by walking the tables).
3. **Every cleanup fate is executed.** For each row in 12.5: delete rows' symbols/files are absent from `web/` (grep list derivable from the tables); migrate rows' items are present and passing their tests; clean rows' decided outcome is implemented; the RESOLVED (Q-07) rows match their resolved outcome (FC-101 linked and absorbed into the 12.6 privacy surface; FC-120 write-only state deleted).
4. **One token accessor.** Exactly one module in `web/` contains the token storage key string; grep count of `ekoa_token` in `web/` equals the accessor module's own occurrences.
5. **One base-URL resolver and one language source.** Exactly one module resolves the API origin; the mirror language key (`ekoa_locale`) does not appear in `web/`.
6. **Streams are scoped and confined.** `EventSource` construction appears only in `web/lib/api/stream.ts`, and only the four chapter 03 stream paths are ever opened (grep for `/events`).
7. **Client equals contract.** The client namespaces are derived from the `shared/` endpoint descriptors with no hand-written path strings outside them; a contract test walks the descriptor census against the API route census and fails on drift (chapter 13).
8. **Typed events only.** Every stream subscription in `web/` handles a member of the four `shared/events.ts` unions; no handler references a dropped event name (grep list from chapter 03 section 3.6.5).
9. **Tests migrated.** The four ported unit tests (FC-307) and the seven rewritten e2e specs (FC-312) pass against the new stack; the no-mode-picker guard test (FC-306) is present and passing in its simplified form.
10. **Locales pruned coherently.** The dead sections (FC-138) are absent from all three locale files and the i18n store; the locale coherence e2e spec passes.
11. **Behavior preserved.** The surviving e2e flows (login, chat, build, artifacts, automations, integrations, knowledge, billing) pass without assertion changes except where 12.4/12.5 rows name an accepted change (FC-013 awaited run id, FC-033, FC-035) - the list of permitted assertion edits is exactly those rows.
12. **Boundary rule enforced.** The ESLint boundary configuration (chapter 02 section 2.9) is active in `web/` and CI fails on a `web/` import from `api/`.
13. **Local file access surfaces present (12.6).** The attach affordance offers Upload and Reference (FC-400) with the three Reference states (FC-401); the trust chip (FC-402) and its "i" custody panel (FC-403) render on turns that touched local files; the "Privacidade e ponte local" settings surface (FC-404) is linked in navigation and contains bridge status/pairing, active grants with revoke, the daemon-served ledger viewer, the masking summary, the unified approved-commands list, and the grounded sections (FC-405..FC-410); the first-time grant dialog (FC-411) and the legal-tenant onboarding card (FC-412) exist. FC-400..FC-412 are net-new (built, not migrated) and outside the 134-item audit count.
14. **Claims copy ship-gated and ceiling-bound (12.6).** Every claims-bearing string in 12.6 is present in the built surfaces but disabled until the mechanism it describes passes its chapter 14 / chapter 17 section 17.9 gate; no enabled string exceeds chapter 17 section 17.9's A1 claimable ceiling and no forbidden-list phrase appears in enabled copy (grep the forbidden strings -> zero in shipped copy). The Upload-vs-Reference micro-copy (FC-400) is exempt as a UX distinction.
15. **Canvas WebSocket confined (12.3.1).** `new WebSocket(` appears only in the canvas module (`web/lib/api/canvas.ts`); it is the sole non-SSE transport in `web/`; `EventSource` remains confined to `web/lib/api/stream.ts` (criterion 6 unaffected). The pause-for-user canvas is present (RESOLVED (Q-01)), opened from the `streaming_available` automation event, honouring the 1000/4000 close-code contract.

Cross-references: chapter 02 (repo layout, `web/` placement, lint enforcement), chapter 03 (every endpoint and event cited above; section 3.7 canvas carve-out), chapter 05 (run pipeline emitting the typed delegation events), chapter 10 (coexistence and cutover), chapter 13 (contract tests, e2e strategy), chapter 14 (build gates that control the 12.6 claims ship-gate), chapter 15 (P-03, P-04, P-11, P-12, P-13 register), chapter 16 (Q-01, Q-04, Q-05, Q-07), chapter 17 (anonymisation mechanism, audit log, and the section 17.9 claims-discipline ceiling for 12.6 copy), chapter 18 (local bridge, delegation `delegate_to_local`, and the security model S1-S6).

**Amendment record.** Amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md): RESOLVED (Q-01) pause-for-user live browser canvas (12.3.1); RESOLVED (Q-04) delete-on-both-sides finalised (FC-027/FC-030/FC-032); RESOLVED (Q-05) preview `?token=` default recorded (FC-024/FC-064/FC-068); RESOLVED (Q-07) `/settings/bridge` linked and absorbed into the "Privacidade e ponte local" surface, write-only demo-cards state deleted (FC-101/FC-120); RESOLVED (P-03) client logout call; RESOLVED (P-04)/(P-11)/(P-13) cross-references finalised; new section 12.6 local file access and privacy web surfaces (FC-400..FC-412).

*End of chapter 12.*
