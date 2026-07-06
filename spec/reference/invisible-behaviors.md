# Invisible Behaviors - Cortex Backend

**Purpose.** This document inventories everything the Cortex backend does that the UI does not directly show - the machinery a ground-up rebuild would silently drop if it only reimplemented the visible API surface. It covers auth/token lifecycle, Claude OAuth credential management, integration credential storage, license checks, startup/shutdown, health checks, job and agent-run semantics, the esbuild/app-serving pipeline, bridge/ekoa-local commanding, activity/audit logging, memory extraction/consolidation, scheduled and fire-and-forget flows, and automation-engine background behaviors. For each behavior: trigger, mechanism, state touched, failure handling, and a one-line rebuild note (carry / redesign / drop candidate - factual, the rebuild spec decides). Doc/code contradictions are recorded, never silently resolved, in the Conflicts section at the end.

**Method.** Derived from source code at commit HEAD (3882aa6) under `cortex/src/` (paths relative to `cortex/src/` unless prefixed). CLAUDE.md and `docs/` were treated as hints only; where they contradict code, the contradiction is recorded in the Conflicts section. Every behavior cites `file:line`. Compiled from three independent code sweeps, cross-checked; load-bearing contradiction claims were re-verified directly against the working tree.

---

## 1. Auth and Token Lifecycle (platform JWTs)

### 1.1 JWT primitives (`auth.ts`)

| Behavior | Detail | Cite |
|---|---|---|
| UserContext shape | `{id, role, scopes, companyId, username?}`; `username` is a non-load-bearing fast-path claim - tokens in circulation may lack it; privileged checks re-resolve via userStore (`requireSuperAdmin` is purely `user.role === 'super-admin'`) | auth.ts:5-16; handlers/shared.ts:102-107 |
| Bearer extraction | `Authorization: Bearer <t>` only | auth.ts:19-23 |
| verifyToken | HS256 vs `config.jwtSecret`; **positively rejects bridge tokens** (any `connectionId` claim or `aud === 'ekoa-bridge'` throws); requires string `sub`; defaults `role='user'`, `companyId=''`; scope accepted as space-joined string or array | auth.ts:29-57 |
| signToken | default 24h; handlers actually mint via the governed `sign_jwt` tool, not this function | auth.ts:62-72 |
| JWT secret | `JWT_SECRET \|\| 'dev-jwt-secret-change-in-production'`; **module-load throw** if unset/default and `isProductionLike` (`NODE_ENV==='production' \|\| installationId !== 'standalone-dev'` - NODE_ENV alone not trusted, unset on deploy path) | config.ts:26, 173-175, 181-191 |
| Governed jwt tools | `sign_jwt` default expiry 1h; `verify_jwt` returns `{valid:false}` instead of throwing | tools/jwt.ts:9-36 |

**Rebuild:** carry the bridge/session token class separation and the production fail-closed secret guard; they are anti-replay and anti-misconfig defenses, not incidental.

### 1.2 Where JWTs are checked (transport, `server.ts`)

| Endpoint | Auth behavior | Cite |
|---|---|---|
| `POST /api/v1/action` | Bearer required except pre-auth-exempt `ekoa.auth`/`auth` intents `login`, `device-start`, `device-poll` (`device-approve` and `refresh` stay authenticated). Handler errors returned as HTTP **200** with `{type:'action_error'}` (frontend back-compat), sanitized via `sanitizeUserFacingError` | server.ts:1396-1456, 1405-1410, 1449-1455 |
| `POST /api/v1/request` | Bearer; responds `{trace_id, status:'accepted'}` immediately, runs handler async; throw becomes SSE `error` event | server.ts:1464-1506 |
| `GET /api/v1/events?token=` | JWT in **query param** (EventSource cannot set headers); sends `connected` with skills/apps/integrationSkills; `Last-Event-ID` triggers ring-buffer replay (200 events per trace); 30s keepalive comments; buffers swept every 5 min above 300s age | server.ts:1317-1346, 3580; sse.ts:19-21, 47-68, 223 |
| `POST /api/v1/upload` | Bearer; raw body limit 500mb | server.ts:529-539 |
| `POST /api/v1/bridge/token` | user JWT mints short-lived bridge token (section 9.1) | server.ts:1353-1366 |
| `POST /api/v1/bridge/debug-invoke` | fail-closed 404 unless `EKOA_BRIDGE_DEBUG_INVOKE==='true'` | server.ts:1373-1389 |
| App Data API (`/api/app-data/*`) + app-files | `X-Ekoa-App-Id` header scoping, **no JWT** - deliberate open data plane for served apps | server.ts:2474+, 1263-1266 |
| `ALL /api/integration/:key/*` proxy | JWT **optional**: validated if present (invalid gives 401), absent token proceeds (same-origin app iframes) | server.ts:1637-1642 |
| `ALL /api/m365/*` workspace Graph proxy | JWT **optional** (invalid -> 401, absent proceeds); injects the WORKSPACE Microsoft platform-integration access token (`getValidTokens('microsoft')`) into the caller-chosen Graph path - a third credential-injection plane besides the integration proxy and `/api/app-sso/m365`; raw bodies forwarded verbatim (`express.raw` 25mb mount). **No per-app allowlist/header gate is enforced in the route** despite the inline comment's "scoped by X-Ekoa-App-Id" phrasing | server.ts:1744-1770 (route), :126 (raw mount) |
| `POST /api/apps/:appId/compile` | **No auth** - recompiles a recipe app; 503 when no compile handler registered; handler errors -> 400 | server.ts:484-497 |
| `POST /api/v1/knowledge/upload` | JWT (bearer) + raw body transport shim - body claimed before `express.json` (50mb default, `EKOA_KNOWLEDGE_UPLOAD_MAX_SIZE`), `x-filename`/`x-collection` headers, path-scoped 413 handler with PT message; delegates to the knowledge-upload service | server.ts:137-156 (mount), :589-601 (route) |

**Rebuild:** carry; the "errors as HTTP 200 action_error" convention and the JWT-less app data plane are contract-level surprises a fresh REST build would normalize away and break the frontend/apps.

### 1.3 Login intents (`handlers/auth-handler.ts`)

Intents: `login`, `create-user`, `change-password`, `reset-password`, `get-me`, `device-start`, `device-approve`, `device-poll`, `refresh` (auth-handler.ts:31-41).

- **Single mint point** `mintSessionToken(user, ctx, expiresIn='24h')` calls governed `sign_jwt` with `{sub, role, scope: scopesForRole(role), companyId, username}` - "the single source of truth for session token claims" (auth-handler.ts:83-99).
- `scopesForRole`: admin/super-admin get `'admin auth:read auth:write agent:execute agent:read agent:write'`; everyone else `'auth:read agent:execute agent:read'` (auth-handler.ts:72-76).
- **login** (:101-137): pre-auth via synthetic `systemToolContext` (:59-66); bcrypt via `verify_password` tool; expiry **30d if `rememberMe` else 24h**; updates `lastLoginAt`; activity-logs; returns `passwordChangeRequired`.
- **create-user** (:139-183): super-admin only; role coerced to `admin|builder` (anything else becomes `builder`); new users get `passwordChangeRequired:true`, `allocationPercentage:100`.
- **change-password** (:185-222): own password only; verifies current; clears `passwordChangeRequired`.
- **reset-password** (:224-254): super-admin; re-flags `passwordChangeRequired:true` on the target.
- **get-me** (:256-292): **role-drift self-heal** - if stored role differs from the token role, mints and returns a fresh 24h JWT in the response so client permissions do not silently rot until next login (:273-291).
- **refresh** (:420-438): authenticated; mints a fresh **30d** token (backs the TUI Pi provider refresh).
- **No server-side revocation exists** for platform JWTs - stateless, expiry-only; no blacklist anywhere in src.

**Rebuild:** carry the role-drift self-heal and rememberMe/refresh TTLs; the missing revocation is a redesign candidate (30d bearer tokens with no kill switch).

### 1.4 Device login (RFC-8628-style)

- `device-start` (auth-handler.ts:301-327) pre-auth; tool `device_auth_start` mints a 32-byte base64url deviceCode + 8-char userCode from an ambiguity-free alphabet (`23456789ABCDEFGHJKMNPQRSTUVWXYZ`, rendered `XXXX-XXXX`); **TTL 10 min**, poll interval 5s (tools/device-auth.ts:21-28, 62-69, 80-113). `verificationUri = {config.appOrigin}/activate` (auth-handler.ts:315-317).
- **In-memory pending store** (Map keyed by deviceCode + userCode index) - single-instance assumption; expired entries swept per call; state lost on restart (device-auth.ts:43-55).
- `device-approve` (auth-handler.ts:334-366) is **authenticated** and binds the device to the approver's own user id only; `deny:true` supported (device-auth.ts:121-149).
- `device-poll` (auth-handler.ts:374-414): statuses `pending | slow_down | approved | denied | expired`; polls under 4s apart get `slow_down`; unknown/consumed codes report `expired` "so we never leak existence"; `approved` is **single-use** - consumed at poll so the token mints exactly once. Handler mints a **30d** token, updates `lastLoginAt`, activity-logs `device-login` (device-auth.ts:157-190).

**Rebuild:** carry the flow; redesign the in-memory store if multi-pod is a target.

### 1.5 Bridge tokens (`bridge/auth.ts`)

- `signBridgeToken({ownerUserId, connectionId})`: same `config.jwtSecret`, `aud='ekoa-bridge'`, `connectionId` claim, TTL `EKOA_BRIDGE_TOKEN_TTL_SECONDS` default **600s** (bridge/auth.ts:13-16, 36-46).
- `verifyBridgeToken` audience-checked; rejects when the `connectionId` claim differs from the URL path segment (`connection-mismatch`). Session verifier rejects bridge tokens and vice-versa - two token classes, one secret, never interchangeable (bridge/auth.ts:18-25, 55-85).
- Mint route validates connectionId against `^[A-Za-z0-9._-]{1,128}$` and returns `wsPath: /api/v1/bridge/connect/<id>` (server.ts:1353-1366).

### 1.6 Chat session persistence (`sessions.ts` - NOT `persistence/sessions.ts`)

- Chat is a **stateless one-shot SDK call per turn**; these files ARE the multi-turn memory, surviving restarts and redeploys (sessions.ts:1-10).
- Two files under `config.dataDir`: `session-contexts.json` (parsed `<ekoa-context>` per session) and `session-history.json` (:16-17). Writes: tmp-file + `renameSync` atomic; history debounced 500ms, unref'd; write errors silently swallowed (:46-53, 86-97, 120-124).
- **Caps at persist time**: last **40 messages/session**, **32k chars/message** (truncated with `' […truncated]'`), **200** most-recently-active sessions kept (:24-26, 102-118). The 32k cap exists because persisted history is the only carrier of pasted documents into later turns/builds (:20-23).
- `getSessionContext`/`setSessionContext` persist the chat agent's `<ekoa-context>` state (index.ts:573-585).
- Distinct from `persistence/sessions.ts` (the `ekoa.sessions` CRUD store) and `persistence/app-sessions.ts` (1.8).

**Rebuild:** carry the caps consciously - they are an invisible data-loss boundary; a rebuild that drops the 32k allowance amputates pasted source material.

### 1.7 Request-path caches touching auth state (`index.ts`)

- `guidedModeCache` - 30s TTL cache of `settings.chat.guidedMode` (index.ts:40-41, 686-695).
- `sessionTypeCache` - 30s TTL, **owner-checked**: keyed by session id but carries userId; a different caller re-resolves via `findOwnedSession` (String()-coerced id match) so a guessed/foreign session id can never flip a request into onboarding mode (index.ts:43-52, 700-715).

### 1.8 End-user SSO + password auth for served apps ("app sessions")

Separate identity plane from dashboard JWTs (persistence/app-sessions.ts:5-15).

- **Session record**: id is a high-entropy opaque token in an HttpOnly cookie; scoped to ONE canonical appId server-side (`session.appId === appId`, never cookie path); optional `graphTokensEnc` = AES-encrypted delegated Microsoft Graph tokens (same key as integration creds; never sent to the app - the `/api/app-sso/m365` proxy injects them); `authCollection`/`authIdentityField` bind password sessions to the server-established login collection so privilege checks cannot be steered by request params (app-sessions.ts:18-51, 43-50).
- TTLs: session **8h**, pending-auth **10 min** (app-sessions.ts:82-84). `findValidAppSession` deletes expired rows opportunistically; missing/expired/wrong-app all return null (callers 401 without disclosing which) (:91-104).
- `consumePendingAppAuth(state)` is **atomic single-use** via `takeById` (find+delete under one mutex) - two concurrent OAuth callbacks with the same `state` can never both succeed; replay protection is local (:106-120).
- Hourly sweep `sweepExpiredAppSso`, unref'd (server.ts:1295-1299; app-sessions.ts:123-128).
- **OIDC flow** (`/api/app-sso/microsoft/start` server.ts:941, `/callback` :999): slug-to-canonical-appId, charset-guarded appId (cookie-injection defense, :959-963), safe return-path check, `state`+`nonce`+PKCE persisted; callback handles tenant-admin-consent landings and AAD errors (:1006-1014); exchanges code with PKCE verifier + exact stored redirectUri, validates id_token nonce, mints 8h session, encrypts Graph tokens when granted, sets per-app HttpOnly cookie, 302 to returnUrl (:1040-1080).
- **Redirect-URI pinning warning**: prod-like + SSO configured + `MICROSOFT_SSO_REDIRECT_URI` unset triggers a loud warning (URI otherwise derived from spoofable `X-Forwarded-*`; Azure allowlist is the backstop) (server.ts:1301-1311).
- `/api/app-sso/me` returns identity + `canSendMail: Boolean(graphTokensEnc)` (:1092). `/api/app-sso/logout` deletes the session row + clears the cookie (:1130).
- **Password login** `/api/app-sso/login` (:1196-1235): identity matched case-insensitively over app-data rows; bcrypt `passwordHash` lives on the app's own row; **timing-safe enumeration defense** - always runs a bcrypt compare against a lazily-computed dummy hash when the user/hash is absent (:1155-1163, 1207-1212); mints the same per-app cookie session.
- **`/api/app-sso/set-password`** (:1239-1290): requires valid app session. Self = exact authenticated principal. Setting another user's password requires caller's row role in `['master','coordenador']` resolved against the **session's** auth collection (never the request's - prevents planted-row role forgery, :1264-1272); privileged callers confined to their own auth collection (:1276-1281).

**Rebuild:** carry wholesale - this whole plane is invisible in the dashboard UI and every detail (atomic state consumption, charset guards, timing-safe compares, session-bound auth collection) is a security property.

---

## 2. Claude OAuth Credential Lifecycle (`services/claude-auth.ts`)

### 2.1 Storage and source chain

- Tokens live in Supabase table `standalone_credentials` keyed by `installation_id` (`access_token`, `refresh_token`, `expires_at`), accessed via raw fetch REST with service-role key and a **10s timeout on every call** (services/supabase-client.ts:29-53, 60-110).
- Source chain: (1) `CLAUDE_CODE_OAUTH_TOKEN` env (CI/break-glass), (2) in-memory cache, (3) Supabase. No local files. Nothing available throws `'No Claude OAuth token available. Run: cd cortex && npm run auth'` (claude-auth.ts:1-16, 145-148).
- `tokenSource` state machine `'supabase' | 'env' | 'env-fallback' | 'none'`; `'env-fallback'` only after the Supabase path demonstrably failed while an env token exists; an out-of-repo laptop-side watchdog script alerts on anything other than `'supabase'` (:44-60).

### 2.2 `getClaudeToken()` (:104-148)

- Serves cache while >5 min from expiry (`TOKEN_EXPIRY_BUFFER_MS=300_000`); at 10 min or less (`EAGER_REFRESH_BUFFER_MS=600_000`) with supabase source, fires a non-blocking **eager background refresh** (single-flight guard) (:25-26, 267-276).
- In `env-fallback` it **skips the Supabase round-trip** (would add a 10s timeout per chat message during a Supabase outage); the watchdog retries every 20 min to escape (:117-124).
- Break-glass env token served with a one-time warning (:130-143).

### 2.3 Refresh mechanics

- Wire: `POST https://platform.claude.com/v1/oauth/token`, `grant_type=refresh_token`, hardcoded `client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e'`, **15s fetch timeout** (:27, 319-330).
- **Global refresh mutex** - scheduled/eager/force paths funnel through one promise so the one-time-use refresh_token rotation is never raced; extra `scheduledRefreshInFlight` guard on timer paths (:66-69, 308-317, 426-448).
- **Persist-FIRST ordering**: new bundle written to Supabase before committing to memory; failed write returns null ("a subsequent restart would read the stale row and 400 forever") (:370-385).
- On success: cache + `process.env.CLAUDE_CODE_OAUTH_TOKEN` sync (the SDK's `query()` reads it directly), counters reset, `onTokenRefreshed` callbacks fired (:387-402).
- **401/403/invalid_grant NEVER deletes the Supabase row** - in multi-consumer deployments (prod + local dev sharing one installation_id) a 401 usually means a peer already rotated; clears in-memory cache only, keeps env break-glass, fires `notifyPermanentFailure`, records `lastRefreshError` (:340-359). Locked in by `tests/claude-auth-race.test.ts:86,120`.
- Timeout/network errors set `lastRefreshError` and return null (:403-414).

### 2.4 Scheduling and backoff

- Normal schedule: **jittered refresh at 45-60% of token TTL**, timers unref'd (:33-35, 451-471).
- `performScheduledRefresh` re-reads the refresh token **from Supabase, not memory** (a peer may have rotated it) (:421-448).
- Failure backoff: exponential 30s -> 60s -> 120s capped at 5 min; after **3 consecutive failures** switches to a steady 5-min long-retry cadence forever (self-recovers without restart), firing the permanent-failure notice exactly once (:28-32, 480-499).

### 2.5 Watchdog

- Armed FIRST in `initTokenRefresh`, before any early-return (the no-row-at-boot state it exists to recover from previously prevented it from starting). Interval **20 min**; refresh threshold **90 min**; **deliberately NOT unref'd** - the process must stay awake for it (:36-38, 212-219, 507).
- Four modes (:516-590; locked by `tests/claude-auth-watchdog-recovery.test.ts`): (1) cache empty -> full reload from Supabase (heals the historical "auth stays dead for hours" symptom); (2) **peer-rotation adoption** - Supabase row holds a different still-valid token -> adopt without a wire refresh (two sides force-refreshing would ping-pong rotations), sync env, fire `onTokenRefreshed` to invalidate the warm SDK subprocess; bounds the stale window to 20 min; (3) near expiry (<90 min) -> scheduled refresh; (4) fresh -> no-op. Expired row tokens are NOT adopted.
- `initTokenRefresh()` (:196-240): requires Supabase configured (throws otherwise); no row -> error log + return (watchdog retries); else caches and **always refreshes at startup**. `forceTokenRefresh()` clears cache, reloads, **throws on failure** (used by the SDK auth-retry path) (:247-261).

### 2.6 Failure broadcast and observability

- `onAuthPermanentFailure` registered at boot: logs + `sseManager.broadcast(createEvent('auth_error', …))` - every connected client sees a re-auth prompt (index.ts:98-101).
- `getClaudeAuthStatus()` returns `{ok, hasToken, source, expiresAt, installationId, lastRefreshAt, lastRefreshError}`; `ok` requires expiry >5 min out; exposed on `GET /health` as `claudeAuth` - the contract for the external laptop-side watchdog; keep the field shape stable (claude-auth.ts:56-59, 151, 157-190; server.ts:469; tests/claude-auth-status.test.ts).

### 2.7 How the SDK subprocess receives credentials (`adapters/external.ts`)

- `buildSdkEnv()` clones env; **deletes `CLAUDECODE`** (prevents nested-session detection); awaits `getClaudeToken()` into `CLAUDE_CODE_OAUTH_TOKEN` (no fallback - must succeed); deletes `ANTHROPIC_BASE_URL` and **`ANTHROPIC_API_KEY`/`ANTH_API_KEY`** (managed OAuth only, API keys blocked); sets `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS='1'` (external.ts:135-158).
- **Warm subprocess**: SDK `startup()` pre-warm handle (~20x faster first query), single-use, **invalidated whenever the OAuth token refreshes** via `onTokenRefreshed` (external.ts:60-100, 78-85).
- **Auth-error retry**: `executeExternal` on `isAuthError` does `forceTokenRefresh()` **once**, invalidates the warm handle, retries; transient provider markers retry with backoff **[5s, 15s]**; exhaustion -> real `onError`, never a fake completion; user abort -> silent `''` (external.ts:1514-1524, 1532, 1542-1597).
- **Marker scanners** (also used by index.ts to keep provider errors out of persisted chat turns, index.ts:642-646): `containsAuthErrorMarker` (:1436-1453, includes org-level access-loss strings the SDK returns AS result text) and `containsTransientProviderErrorMarker` (:1478-1504, 429/529/overloaded/rate_limit plus the consumer-plan "hit your limit" message; documented production incidents 2026-07-03/04 including the `youvehityourlimitresets730amutc` slug corruption).
- Non-SDK direct calls (`anthropic-client.ts`) use the same managed token with one forced-refresh retry; the LLM gateway (`llm-gateway.ts`) injects OAuth token + `anthropic-beta` headers, auth via `X-API-Key` (`LLM_GATEWAY_API_KEY`) or JWT.
- **Zombie-process protection**: `startServer()` kills the process on `EADDRINUSE` - a portless zombie's refresh loop would keep rotating the shared OAuth token out from under the port owner, causing 401-per-call (server.ts:3589-3596; incident: docs/cli-task-testing-2026-06-12.md finding 1).

### 2.8 LLM gateway surface (`llm-gateway.ts`)

The gateway is a full route surface, not just a token-injection clause:

- **Routes**: `POST /api/v1/llm/messages` AND `POST /api/v1/llm/v1/messages` (same handler - the second path exists so an Anthropic SDK pointed at the gateway's base_url resolves `/v1/messages`); `GET /api/v1/llm/models`; `POST /api/v1/llm/classify`. JSON body limit 50mb (llm-gateway.ts:449-484).
- **Auth**: `authenticateGateway` accepts `x-api-key` (or `Authorization` non-Bearer) checked against `LLM_GATEWAY_API_KEY`, OR a platform JWT (llm-gateway.ts:8, 61-90).
- **Metering from response bodies**: `parseUsageFromResponse(body, isStream)` parses usage out of both SSE-streamed responses (message_start + message_delta events) and non-streaming JSON; returns null on unparseable bodies -> billing is skipped for that call (llm-gateway.ts:148-...; recording site :240, listed in 12.7).
- **Per-typed-TUI-turn classify flow** (`POST /api/v1/llm/classify` -> `services/turn-classifier.ts`): default mode is a REAL **billed Haiku call** per typed TUI turn (`agentType:'classify-tui-turn'`, FAST tier weights, billed manually via `computeMeteredTokens`/`recordTokenUsage` because the direct `callAnthropic` transport does not auto-bill) under a **hard 3.5s budget**; input caps **8000 chars prompt / 4000 chars context**, output capped at 300 tokens; transport is `callAnthropic` (direct OAuth fetch), deliberately NOT the Agent SDK (subprocess path measured 3.2-8.3s live, over budget). **ANY failure** (HTTP error, budget abort, garbage/enum-invalid output) automatically falls back to the no-LLM keyword scorer - the endpoint never 500s the TUI input hook; `EKOA_TUI_CLASSIFY_MODE=keyword` restores the pure keyword path; `escalate = tier >= EKOA_TUI_ESCALATE_MIN_TIER` (default WORKHORSE) (turn-classifier.ts:1-37, 100-131; llm-gateway.ts:472-520). This is an invisible recurring LLM cost flow of the same class as memory extraction (11.2).

**Rebuild:** carry the whole subsystem's invariants (single-flight rotation, persist-first, never-delete-on-401, peer adoption, non-unref'd watchdog, warm-handle invalidation) - each encodes a fixed production incident. The gateway's classify fallback chain and the usage-parse-or-skip-billing rule are contract, not incident debris.

---

## 3. Integration Credential Storage

### 3.1 Encryption primitives

- Governed tools `encrypt_credential`/`decrypt_credential`: **AES-256-GCM**, 16-byte IV, 16-byte auth tag, ciphertext `iv:authTag:encrypted` all base64. Key = `args.key || ENCRYPTION_KEY || 'default-dev-encryption-key-32ch!'`, truncated/zero-padded to exactly 32 bytes (tools/crypto.ts:14-23, 50-112). **No key-rotation mechanism** - a changed key silently orphans old ciphertexts; callers skip on decrypt failure (e.g. tools/platform-integration-call.ts:395-399 "bad ciphertext / key rotation - skip").
- Password hashing: bcryptjs, tool `hash_password` uses **12 rounds** (tools/crypto.ts:9, 25-35); bootstrap admin uses **10** (bootstrap.ts:9).
- `generateWebhookSecret()` = 32 random bytes hex (crypto.ts:82-84); trigger HMAC secrets stored AES-encrypted (persistence/triggers.ts:64; encrypt handlers/triggers-handler.ts:297; decrypt at verify time webhooks-handler.ts:420, triggers-handler.ts:507).
- **Duplicate inline implementation**: `encryptString`/`decryptString` in tools/platform-integration-call.ts:35-66 - same algorithm/key derivation, bypasses the tool registry. Used by platform tokens, app-SSO Graph tokens (server.ts:1063-1070), browser-session state. Two codepaths, one format.

**Rebuild:** carry the format; redesign to one implementation and add a production guard for the default key (see Conflicts #5).

### 3.2 User integration credentials (`ekoa.integrations`)

- Store: `~/.ekoa/data/integration-configs.json`; `StoredIntegrationConfig.credentials?: string // encrypted`; extra fields `platformProvider`, `oauthState` (in-flight OAuth CSRF state), `needsReauth` (dead refresh_token flag, cleared on successful refresh), `ownerUserId` (undefined = global, super-admin-only authoring), `sessionState` (captured browser session, AES ciphertext, kept SEPARATE from `credentials` so config saves never clobber it; always owner-scoped, **never returned to the frontend**) (persistence/integrations.ts:5-44).
- Encrypt on write: create-config / update-config / builder save call `encrypt_credential` (handlers/integrations-handler.ts:338, 352, 426; handlers/integration-builder-handler.ts:300).
- Decrypt at execution only; the `execute` intent decrypts and returns creds to the agent layer after a **CRITICAL ownership gate** - `requireOwnershipOrSuperAdmin` failure masked as "not found" (hide existence) (integrations-handler.ts:691-728). Other decrypt sites: integration proxy (server.ts:1666, system context), integration-action-executor (services/integration-action-executor.ts:54, 232, 262), adobe-sign (services/adobe-sign.ts:157 decrypt -> refresh -> :214 re-encrypt).
- Note: the execute intent DOES return decrypted credentials over the action channel to the authorized owner - the "LLM never sees creds" invariant holds everywhere except this deliberate handler return.

### 3.3 Platform integrations (Google/Microsoft/Adobe workspace OAuth)

- Callback routes store the whole token bundle (incl. post-exchange user email) AES-encrypted into integrationStore, clear `oauthState`, set `needsReauth:false`; state mismatch renders an error page (google server.ts:687-735, microsoft :742, adobe :803).
- **Lazy refresh**: `getValidTokens(provider)` refreshes within **60s** of expiry (tools/platform-integration-call.ts:292-313).
- **Singleflight per config id** (`inflightRefresh` map) - background timer + lazy refresh can race; joining prevents a stale `invalid_grant` from dead-flagging a connection the other leg just repaired (:315-345).
- `doRefreshAndPersist`: success re-encrypts + clears needsReauth; on `invalid_grant` it **re-reads the row first** (if credentials changed since read, another refresh won - return current tokens, do not flag); otherwise sets `needsReauth:true` and throws a user-actionable "reconnect it in Integrations" error (:347-385).
- **Hourly proactive sweep** `refreshExpiringPlatformTokens(skew=10min)`: boot + `setInterval(60min).unref()`; exercises refresh_tokens so they do not age out unused (Google "Testing" mode); per-config failures isolated; skips needsReauth rows and undecryptable ciphertexts (:386-417; index.ts:839-853).
- `getConnectedPlatformAccounts()` decrypts only to read the account email for prompt injection; failures silently skipped (:193-224).

**Rebuild:** carry the singleflight + re-read-before-flag semantics; they prevent user-visible false "reconnect" states.

---

## 4. License Checks

- `validateStartup()` runs **before anything else** in `main()` and both checks are **FATAL** (throw -> `main().catch` -> `process.exit(1)`) (startup.ts:8-16; index.ts:69, 896-899). The inline comment at index.ts:68 saying "warns but does not block" is stale (Conflicts #1).
- `checkSupabase`: fail-closed on missing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (startup.ts:121-129).
- `checkLicense` -> `licenseValidate` (startup.ts:131-148; tools/license.ts:23-76), all Supabase-backed, "no stubs, no fallbacks":
  1. `EKOA_LICENSE_KEY` must be set.
  2. `companies` row by license key must exist AND `status === 'active'`.
  3. `installations` row by `EKOA_INSTALLATION_ID` must exist, belong to that company, and be `active`.
  4. Fire-and-forget heartbeat PATCHes `installations.last_seen_at` (license.ts:60-61; supabase-client.ts:200-212).
  5. Tier feature map: base `[coding, chat, memory]`; professional/enterprise add `[branding, integrations]`; enterprise adds `[teams, governance, deployments]` (license.ts:86-95). **No runtime enforcement of these flags exists anywhere in src** - computed and logged, never gated.
- Supabase network errors inside the lookups return null -> license reports invalid -> boot fails. A Supabase outage at boot = no boot; **after boot there is no periodic license re-check** (startup-only).
- `licenseUsage` is a placeholder `{used: 0, limit: 1000}` (license.ts:78-84).

**Rebuild:** carry the fail-closed boot check; the unenforced tier flags and the placeholder usage are decision points (enforce, or drop the computation).

---

## 5. Startup Sequence and Shutdown

### 5.1 Ordered boot (`index.ts` `main()`)

1. Global `uncaughtException`/`unhandledRejection` handlers log-and-continue ("log everything, crash nothing") (index.ts:55-61).
2. `validateStartup()` - fatal (see section 4) (:69).
3. `registerAllTools()` (:72-74). (Comment at :71 lists "process, preview, ports, oauth" tools - stale; those files do not exist. Conflicts #2.)
4. **Parallel block** (`Promise.all`): `bootstrapAdminUser()`; `migrateMemorySchema()`; `appRegistry.start(sandboxRoot)` (`SANDBOX_ROOT` or `~/.ekoa/sandboxes`); `loadSlugIndex()`; Claude auth init (failure **non-fatal** - "External adapter calls will fail until auth is configured") (:81-111).
5. **Migrations/backfills in order** (each try/caught, non-fatal unless noted):
   - Slug-keyed app-data -> canonical artifact-id dirs (idempotent) (:117-126).
   - `initAppDataBackend()` - fs (no-op) or mongo/Firestore; **mongo is FAIL-FAST: a bad connection string stops startup** (:128-136).
   - `migrateShareableToTopLevel()` - idempotent every boot (:138-147).
   - `seedFeaturedArtifacts()` from `ekoa-data/featured-artifacts/` + orphan sweep (:149-160).
   - `migrateAppData()` - one-shot fold of legacy per-user app-data into `~/.ekoa/data/app-data/`, sentinel-gated (:162-175).
   - `runBillingUnitsReset()` - one-shot zeroing of meters corrupted by pre-2026-05-01 char estimation (sentinel `.billing-units-reset-v1.flag`; token-event history kept; resets `currentPeriodStart`) (startup.ts:18-56; index.ts:177-180).
   - `runLegacyDataMigration()` - one-shot copy of in-image sessions/messages JSON to the data volume; sentinel `.legacy-data-migration-v1.flag`; per-file skip if dest exists; **company.json deliberately NOT migrated** (dev identity wrong for prod) (startup.ts:58-119; index.ts:182-186).
   - `seedMemories()` idempotent by `seed:<id>` tag (:188-191); `seedKnowledgeSources()` idempotent by seedId (:193-199).
   - Knowledge NFC migration - fire-and-forget one-shot (sentinel) normalizing NFD->NFC so byte-level search matches accents (:201-215).
   - `initKnowledgeFts()` - vault sync hooks + background backfill if index empty; FTS preferred, ripgrep fallback (:217-224).
6. **Handler wiring**: `setDomainActionHandler` wraps `dispatchDomainAction`; if handled but the handler never calls the sender, a **300s timeout resolves undefined** (accommodates AI-powered handlers) (:226-263). Then `loadSkills` (:268-272), `loadApps` (:274-276).
7. Legacy `company.json` path migration (must run AFTER `loadApps()` - the loader creates the recipe data dir; earlier would race the mkdir) (:278-288); grayscale-branding auto-correction on the persisted company file (:290-309).
8. Auto-compile recipe apps that have instructions.md but no recipes.json - fire-and-forget loop (:311-327); `setCompileHandler` (:329-333); `setAppActionHandler` (:335-349).
9. `setRequestHandler` - the entire chat pipeline (:351-762; detailed in section 7.1).
10. Event system: `openEventQueue()` (SQLite WAL), trigger dispatcher + listener supervisor instantiated (:764-772); `WorkerThreadRuntime` registered as artifact-backend runtime (:774-779; invoke semantics in 7.7 - before this registration the Null runtime returns clean failures so racing dispatches retry instead of crashing).
11. `startServer()` (:803) - SSE manager start, buffer cleanup every 5 min, EADDRINUSE suicide, listen (server.ts:3576-3606).
12. **Post-listen fire-and-forget**:
    - Webhook raw-body **self-test**: POSTs a signed payload to a synthetic disabled trigger and asserts the verifier sees unmodified bytes (catches accidental `express.json()` reordering above `/hooks`); 10 retries x 200ms while the server comes up; disable via `EKOA_DISABLE_HOOKS_SELFTEST=1` (:808-826; services/webhook-self-test.ts:95-125).
    - `triggerDispatcher.start()` + `listenerSupervisor.start()` - deliberately AFTER listen so re-entrant automations can reach the server (:764-766, 828-830).
    - `startKnowledgeScheduler()` - nightly incremental re-crawl (:832-837).
    - Platform-token refresh sweep: immediate + hourly unref'd interval (:839-853).
    - `buildAndRegisterFeaturedArtifacts()` - esbuild pre-build of featured artifacts so `/apps/{id}/` and screenshots work (:855-870).
    - `scanUncheckedArtifacts()` app-health scan - headless-load each unchecked artifact so the injected in-page probe populates verdicts; skip via `EKOA_DISABLE_HEALTH_SCAN=1` (:872-893).

**Rebuild:** carry the ordering constraints explicitly (auth init parallel, migrations sequential, dispatcher after listen, company.json after loadApps); they encode races that were fixed.

### 5.2 Bootstrap admin (`bootstrap.ts`)

- Empty users.json -> create `admin` / `tmp12345` (bcrypt 10 rounds), role **`super-admin`**, `companyId:'default'`, `passwordChangeRequired:true`, `allocationPercentage:100` (bootstrap.ts:5-26).
- One-time migration: an existing `admin` with legacy role `'admin'` is promoted to `'super-admin'` (:28-37).

### 5.3 Shutdown / signals

- `SIGINT`/`SIGTERM` -> `shutdown()` then `process.exit(0)` (index.ts:800-801). Order (each step try/caught): trigger dispatcher stop -> listener supervisor stop -> artifact-backend runtime dispose -> `closeEventQueue()` -> `closeKnowledgeFts()` -> `appBuilder.dispose()` -> `appRegistry.stop()` (:781-799).
- **No HTTP server close / SSE drain** - in-flight requests and SSE clients are dropped by process exit (Conflicts #8).
- Uncaught exceptions/rejections never crash the process, except `main()`'s own rejection (fatal) and the EADDRINUSE handler (`process.exit(1)`, server.ts:3589-3596).

---

## 6. Health Checks

| Surface | Behavior | Cite |
|---|---|---|
| `GET /health` (no auth) | `{status:'ok', uptime, skills_loaded, apps_loaded, connections (SSE only - kept for existing watchdog scripts), bridgeConnections, claudeAuth, clockSkewSec, triggers:{pendingEvents}}`. `clockSkewSec` = median absolute now-vs-Date-header skew over recent webhooks - replay-tolerance windows (Stripe 300s) start rejecting if it drifts; runbook alerts at >60s. Event-queue reads try/caught (queue may be uninitialized in tests) | server.ts:447-473, 448-459 |
| `GET /api/v1/upload/test` (no auth) | write-probe of the upload dir; `{ok, uploadDir, exists, writable}` | server.ts:509-527 |
| `POST /api/apps/:appId/compile` (no auth) | recipe-app recompile trigger - not a health check but part of the unauthenticated surface: delegates to the registered compile handler, 503 while unregistered (boot window), handler errors -> 400 | server.ts:484-497 |
| `POST /api/app-health` (no auth) | receives in-page probe reports (`healthy\|broken` + reason/error <=500 chars) injected into every served HTML; identity via `X-Ekoa-App-Id`, slug-resolved; unknown ids dropped silently; **featured artifacts skipped** (one viewer's flaky load cannot flip the global badge); 60s in-memory same-status dedupe (per-restart); persists `health` on the artifact instance | server.ts:3351-3409, 3190-3193 |
| Boot health scan | headless-loads every unchecked non-featured artifact; concurrency 4, 8s nav timeout, 4s probe settle; the scanner never writes, the probe does | index.ts:872-893; app-health-scanner.ts:1-60 |
| License heartbeat | `installations.last_seen_at` PATCH - startup-only liveness signal to the Supabase control plane | tools/license.ts:60-61 |

**Rebuild:** carry `/health` field shape (external watchdog depends on `claudeAuth.source`); clockSkewSec is an ops feature that would silently vanish.

---

## 7. Job / Agent-Run Semantics

### 7.1 Chat runs (`POST /api/v1/request` -> `setRequestHandler`, index.ts:352-762)

- Entry verifies JWT, requires `message` + `session_id`, defaults `mode:'auto'`, generates `trace_id` if absent, and responds `{trace_id, status:'accepted'}` **before** processing; results arrive over SSE only; handler throw becomes an `error` SSE event (server.ts:1464-1506).
- Pipeline order:
  1. `createTrace` + user message persisted to session history immediately (index.ts:354-359).
  2. **Timeout + cancel share one AbortController**; timeout `REQUEST_TIMEOUT_MS` default **300 000 ms** (config.ts:90-93); `timedOut` flag distinguishes timeout (surfaces error) from user Stop (silent). `registerChatRun` happens **before the billing await** so a fast Stop lands (index.ts:362-375).
  3. **Billing gate** `checkBillingAllowance(user.id)`: on block, cleanup + `error` SSE with `[billing_blocked:<url>]` marker, `trace.fail`, return (:377-392). Early-abort check after the billing await (:396-405).
  4. Routing: `classifyForSdk(message, hasAttachments?{isCodeGen:true}:{}, WORKHORSE)` - chat floored at WORKHORSE; a `routing` SSE `{path:'external', confidence:1.0, reason:'ai-pipeline'}` always emitted (:410-426).
  5. **Stream-marker machinery** (invisible to clients): `<ekoa-build-redirect/>` buffered/stripped at stream start; `<ekoa-integration-build-redirect key label/>` regex-stripped (the SSE event fires at complete-time); `<ekoa-context>…</ekoa-context>` suppressed via a tail hold-back of `len(tag)-1` chars so a split-across-chunks open tag is caught (:428-537).
  6. Callbacks -> SSE: `stream`, `tool_event` (`tool_called/tool_finished/tool_failed`, result text truncated to 200 chars), `skill_event`, `subagent_event` (:471-675, 552-557; `subagent_event` has no frontend listener - Conflicts #13).
  7. **onComplete** (:569-657): parses `<ekoa-context>` blocks (last valid persisted); `build_intent` SSE (`template_id` only when `sessionType==='onboarding'` and `decidedStartingPoint` is a string); `integration_build_intent` SSE; `complete` SSE with cleaned result + duration; token counts recorded on the trace (**billing happens centrally in the adapter**, not here); assistant message persisted **unless** the text matches an auth/transient-provider marker (a raw "API Error:" is never re-injected into future prompts); **fire-and-forget** memory extraction (:649-656).
  8. Context assembly: guidedMode via 30s cache; session type owner-checked via 30s cache; prior transcript `getSessionHistory(...).slice(0,-1)` as `conversationHistory` (:686-724).
  9. Final pre-execution abort check, then `executeUnified(..., {agentType:'chat', pluginName:'agent', abortController})`; the adapter swallows aborts (returns `''`); `if (timedOut) throw` after return surfaces timeout (:727-751). `finally`: clear timeout + `unregisterChatRun` (:758-761).
- **Cancellation**: `POST /api/v1/request/cancel {trace_id}` -> `cancelChatRun(traceId, userId)` on the `activeChatRuns` map - owner-scoped, idempotent; without this, closing the SSE only stops reading while the SDK keeps generating and billing (server.ts:404-432, 1610-1630). The registry is reused by execute-handler's in-build classifier window so Stop works before any job exists (execute-handler.ts:203-210).

### 7.2 Build jobs (`ekoa.execute` - `handlers/execute-handler.ts`)

Intents: `execute-job`, `get-job`, `cancel-job`, `infer-integrations` (legacy, suggestions-only, :1308-1337), `assistant-chat` (:57-63).

**Job persistence** (persistence/jobs.ts): one JSON file per job at `~/.ekoa/data/jobs/<jobId>.json`, atomic tmp+rename (:36-41). `status in {queued, running, completed, failed, cancelled}` (:17). **No queue, no scheduler** - jobs run immediately in-process; `queued` exists only for the instant between create and the running update (execute-handler.ts:556-560, 671-674). A cortex restart orphans on-disk `running` jobs forever - the PIPELINE_STUCK net only runs within the same process lifetime (Conflicts #14).

**executeJob** (:99-681):
- Requires scope `agent:execute` (:105). Prefers the **client-supplied traceId** so the client can cancel/correlate (:117).
- Follow-up detection: `artifactInstanceId && (projectDir || target-is-featured)`; a featured target with no projectDir is still a follow-up (:126-136).
- **Duplicate first-build backstop**: `activeFirstBuilds` Map keyed by sessionId, reserved *synchronously* before any async work; a second execute-job for the same session within a **45-min TTL** binds to the running job and returns its jobId (root cause: `build_intent` SSE broadcasts to every tab; TTL 45 min because the pipeline wall-clock ceiling is 40 min). Reservation released in `runAIPipeline().finally`, jobId-guarded (:81-97, 142-161, 662-669).
- **Follow-up branch**: rejects if another `running` job targets the same artifact (two concurrent builds would resume the same SDK transcript file and corrupt it) (:176-181); `projectDir` from the artifact record wins over the client value (SDK resume keys off realpath-encoded cwd) (:184-195); `resumeSessionId = storedArtifact.sdkSessionId`.
- **In-build intent classifier (R2)** runs before any build work, registered in the chat-run cancel registry (:203-210). Categories: `modification` (continue); `integration-build-request` (emit `integration_build_intent` + PT/EN ack via `chat_answer`, skip build) (:239-274); `question-about-build`/`question-about-ekoa`/`meta`(scrap/back)/`ambiguous` answered via `chat_answer` SSE + `addAssistantMessage`, return `{skipped:true, reason, confidence}` (:276-333). **Abort semantics**: an aborted `callSimpleLlm` returns `''` without throwing, which would yield a heuristic 'modification' fallback and start a build after Stop - the code bails explicitly on `signal.aborted` before any branch (:229-235, 312-315). `meta:scrap` resets orchestrator state to `gathering` (:278-288). Classifier failure is non-fatal - defaults to rebuild (:335-337).
- Featured + confirmed modification -> `materializeFeaturedWorkingCopy` (idempotent; projectDir becomes the user's persistent working copy); failure aborts with a PT error (:350-359). Starts an esbuild **watch**; each rebuild broadcasts `preview_reload {artifactInstanceId, appUrl}` (:361-375).
- **First-build branch**: `projectDir = <sandboxRoot>/user-<id>/<project>`, fresh artifactInstanceId (:377-380); Starting Point scaffold loaded from `featured-artifacts/<id>/scaffold` (**files >2 MB skipped**) (:384-412); when the session has no base, `selectBaseTemplate` picks one and persists it (:413-446); `scaffoldApp` returns `filesCreated` sent back synchronously to seed the Files tab (:449-456, 562-576); resolved design tokens written to `frontend/src/tokens.json` (base.tokens -> company.branding -> featured tokens; non-fatal) (:458-497); **initial esbuild build + watch immediately** so the preview is live before the agent runs (failure non-fatal, "will retry during AI pipeline") (:499-517); artifact instance created `status:'draft'`, `shareable:true`, `typeId = resolvedBase.id`, `data:{sessionId, projectDir, jobId, startingPointId?}` (:522-549).
- Job written `queued`, sync sendResult returned (payload says `running` even though the store says queued), then flipped to `running` (:552-576, 671-674).
- **Prompt assembly**: template configValues as a `## Template Configuration` bullet list (:585-598); follow-ups get an "IMPORTANT: Follow-up Build" preamble (:605-607); chat transcript travels via `conversationHistory` (the old inline version clipped at 500 chars and lost pasted material) (:600-637); tail-window dedup (last 3 messages) + persisted provider-error turns filtered (:620-631).
- `runAIPipeline` launched **fire-and-forget** (terminal state owned by onComplete/onError) (:654-669). Activity log `execute/execute-job` (:676-680).

**runAIPipeline** (:714-1237):
- Billing gate via `gateBillingOrAbort`: blocked -> `error` SSE `[billing_blocked:/settings/billing]`, job `failed {code:'BILLing_BLOCKED'}` (sic: `BILLING_BLOCKED`), artifact -> `draft` (:731-754).
- **`finalized` dual-fire guard**: exactly one of complete/error per traceId - after a wall-clock race rejection the SDK subprocess may still call onComplete (:759-764, 886-898, 1105-1107).
- Prompt augmentation: `## Starting Point` block when templateId (CSS-vars contract reminder) else `DEFAULT_SCAFFOLD_CONTEXT`; base skills/conventions from orchestrator state (:694-703, 770-827).
- Routing: `classifyForSdk(message, {isCodeGen:true}, EXPERT)` - **builds floor at EXPERT/Opus** (:829-840).
- Stream/tool events **reset the inactivity timer** (:849-884).
- **onComplete** (:886-1104): (1) a provider error returned AS result text is rerouted to onError (this exact wrap produced a fake "completed" build in the 2026-07-03 production rate-limit incident) (:889-897); (2) **final build**: stop the watcher first (concurrent esbuild ops share the daemon; interleaved responses crash the process), wipe `dist/`, build with **2 attempts** each validated by `validateBundle` (IIFE-format check - catches the agent producing ESM) (:901-951); (3) **auto version snapshot** `vcsCommit` (tagged `[build-failed]` when broken - users may revert FROM a broken version); `SecretCommitError` blocks the snapshot loudly with a `commit-blocked` activity row; then fire-and-forget GitHub backup `backupAppRepoSafe` gated by `GITHUB_PUSH_ENABLED` (:954-991); (4) **slug** preserved on follow-ups (regenerating would rename the app per change request), else Haiku-generated + indexed (:993-1030); (5) `complete` SSE with result (build error appended as a user-visible note), projectDir, `appUrl:/apps/{slug||id}/`, artifactInstanceId, slug; job -> `completed` (:1032-1054); (6) artifact -> `active` with a **merge** onto the existing `data` bag (a wholesale replace used to drop `customized`/`seededVersion`/`startingPointId`/`forkedFrom`) (:1060-1083); (7) fire-and-forget screenshot; assistant message persisted; fire-and-forget memory extraction (:1085-1103).
- **onError**: `error` SSE, job `failed {code:'ADAPTER_ERROR'}`, artifact stays `draft` (:1105-1127).
- **Timeouts**: inactivity **5 min** (reset on every stream/tool callback - active builds never time out) and wall-clock **40 min** ceiling; both `Promise.race`d against the run (:1130-1149, 1195-1196).
- **Cancellation**: `jobAbortControllers` keyed by jobId (:706-712, 1153-1154, 1211); on race rejection, `signal.aborted` -> quiet (cancel-job already set `cancelled`), else routed through the guarded onError (:1197-1209).
- `onSessionId` persists the SDK session id (`sdkSessionId`) onto the artifact only when it differs from the resumed one (:1175-1191).
- **Zombie safety net** in `finally`: job still `running` after the pipeline exits -> `failed {code:'PIPELINE_STUCK'}`, artifact -> `draft` (:1214-1235). Same-process-lifetime only.

**cancel-job** (:1265-1306): owner-or-admin; only `running|queued`; sets `cancelled` **then** aborts (ordering so the abort path sees cancelled and stays quiet) (:1289-1301).

**assistant-chat** (:1359-1537): synchronous (result in the action response, not SSE); builds its own system prompt (personality + instructions + knowledge via memory-resolver tag-bias or inline files + up to 3 fetched web URLs); runs `executeExternal` with `systemPromptOverride` and no-op stream callbacks (:1490-1506); fire-and-forget memory co-op extraction when `memoryCoopEnabled` (default false) (:1522-1536).

### 7.3 SDK adapter run loop (`adapters/external.ts`)

- Env/warm-subprocess/auth-retry: see section 2.7. Build mode additionally sets `HOME = projectDir` to confine `~` expansion to the sandbox (:860-862).
- **Grounding**: memory resolution unless `skipMemory`; knowledge section - chat always, build only when `isLegalBuildContext(message)` (:864-901); chat mode pre-fetches live Google/Microsoft integration data on email/calendar/files keyword hits with a 60s cache that also fires on keyword-less follow-ups ("sim") (:167-302, 936-985); automation/integration-action catalog appended for any user call (:991-1006).
- **Mode options** (:682-743): build = `claude_code` preset, `bypassPermissions`, allowedTools `Bash/Read/Write/Edit/Glob/Grep/Agent/Skill` + knowledge MCP tools, `cwd=projectDir`, `additionalDirectories` for attachments. Text+attachments = `Read/Glob/Grep` only. Pure text = `tools: []`. Chat gets **only** the knowledge MCP tools whitelisted, never Bash/Write/Edit (:1016-1034).
- **Query options** (:1050-1081): model/effort from RouterDecision; `plugins:[local pluginPath]`; `settingSources: []` (nothing inherited from `~/.claude`); `persistSession` only when requested or resuming; `maxTurns` 100 build / 30 text (config.ts:75-76); `includePartialMessages: true`; optional abortController + taskBudget. Mandatory language block appended last for non-English (:1125-1152). Image attachments switch the prompt to `AsyncIterable<SDKUserMessage>` with base64 image blocks (vision path used by automation) (:637-658, 1154-1161).
- **Event loop** (:1229-1322): text deltas -> onStream; `message_delta.usage.output_tokens` -> debounced (1000 ms) provisional `usage_progress` SSE (purely visual); `result` captures usage (success and error subtypes), success text wins over accumulated stream; `tool_use` blocks -> onToolCall; `system.task_started/task_notification` -> onSubagentEvent. Loop **breaks immediately after the result event** - the SDK iterator can hang after subprocess exit (:1318-1321). `onSessionId` fires exactly once on the first event with a session_id (:1202-1213).
- `scanEventForAuthMarkers` tracks 401 signals mid-stream so a subsequent subprocess crash (`SyntaxError: Unexpected token 'F'` from parsing a plain-text 401 body) is synthesized into an auth error (:903-912, 1215-1227, 1324-1330, 1399-1413).
- **Billing single chokepoint**: with `userId+agentType`, the adapter itself records tier-weighted metered usage fire-and-forget; callers must NOT also record or they double-bill (:770-776, 1351-1384).
- `callSimpleLlm` = one-shot wrapper (skipMemory, systemPromptOverride, tier default FAST, optional images/language/abort) (:1615-1673); `executeUnified` is a pure alias of `executeExternal` (:1679-1685).

### 7.4 Orchestrator state machine (`services/orchestrator.ts`)

Phases `idle | gathering | resolving-integrations | building | built | failed`, persisted on the session record under `orchestratorState` (:25-31, 70, 82-97). Allowed-transition table (:125-132); `evaluateGate`: no base -> gathering; base + pending integration -> resolving-integrations; else building (:146-159). Every phase change broadcasts a `phase_changed` SSE (:99-117) - **the frontend never registers this event** (Conflicts #12). Three Haiku-FAST skills drive transitions (detectBuildIntent / detectIntegrationNeeds / selectBaseTemplate, :7-10). Handler intents: `get-state, seed-featured, gather, confirm-integration, defer-integration, transition, scrap` (orchestrator-handler.ts:180-188).

### 7.5 Agent-face runs (local-daemon-backed agent)

- `POST /api/v1/agent-face/run`: JWT; **409 "local daemon not connected"** when no bridge connection for the user; returns `{traceId}` immediately; failures surface as `error` SSE (server.ts:1523-1570).
- `runAgentFace` (agent-face/index.ts:142-380): registers `activeRuns[traceId]` synchronously before the first await (fast cancel cannot miss it) (:147-150); floors routing at WORKHORSE with `complexityHint:'high'` (:155); reuses `buildSdkEnv` and raises `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` to **180 000 ms** (daemon tool calls routinely exceed 60s; bridge invoke timeout is 120s) (:162-175).
- Tool architecture: keeps the `claude_code` system-prompt preset but swaps execution to daemon-RPC MCP tools (`bash`/`fs`/`browser`); `permissionMode:'default'` (bypass would skip `canUseTool`); `disallowedTools` = 16 host built-ins; `canUseTool` default-denies everything not `mcp__ekoa-local__*` and echoes input back verbatim on allow (`updatedInput` REPLACES input) (:216-257; agent-face/daemon-tools.ts:87-93, 237-247). `settingSources: []`, no cortex plugin (:249).
- **Billing self-recorded** here (this path runs `query()` directly, not through executeExternal) (:44-51, 325-353). **Cancelled runs are normally unbilled** - abort ends the query before the usage-carrying result event; accepted trade-off (:355-364).
- Cancel: `POST /api/v1/agent-face/cancel {traceId}` - owner-scoped, idempotent (server.ts:1580-1600; agent-face/index.ts:66-71).

### 7.6 Concurrency-limit summary (no global queue exists)

| Guard | Scope | Mechanism | Cite |
|---|---|---|---|
| One first-build per chat session | 45-min TTL reservation | synchronous `activeFirstBuilds` Map | execute-handler.ts:90-97, 142-161 |
| One follow-up build per artifact | jobStore query for `running` on same artifactInstanceId | reject | execute-handler.ts:176-181 |
| One cancelable run per traceId | `activeChatRuns` / `activeRuns` maps | owner-scoped cancel | server.ts:412; agent-face/index.ts:59 |
| One esbuild watch context per appId | `watch()` disposes prior context | replace | app-builder.ts:548-551 |
| Git writes per app repo | per-projectDir promise chain | `withRepoLock` serializes agent-stop auto-commit, user file-save commit, version restore, AND GitHub push - extracted from vcs.ts so the commit and push paths share ONE lock (two separate mutexes would not be mutually exclusive) | services/repo-lock.ts:1-35; tools/vcs.ts:19, 45; services/github/backup.ts:23, 50 |
| Artifact-backend invokes per artifact | per-artifact promise lane | serialized (see 7.7); different artifacts concurrent | services/artifact-backend/runtime.ts:236, 254-266 |
| Chat runs otherwise unlimited | none | each POST /request spawns an SDK subprocess | - |

**Rebuild:** the absence of a real queue/worker pool + crash-orphaned `running` jobs is the single biggest redesign candidate in this section; everything else (dual-fire guards, abort semantics, dedupe backstops) should carry.

### 7.7 Artifact-backend invokes (`services/artifact-backend/runtime.ts` - WorkerThreadRuntime)

Artifact-backend invocations are a job class of their own (states, dispatch, concurrency, timeouts, failure handling) - boot registration (5.1 step 10) and dispatcher targeting (12.3) are only the entry points. All line cites are runtime.ts unless noted.

- **Substrate-swappable contract**: `ArtifactBackendRuntime {invoke, shutdown, revoke, dispose}` + status/invocations/logs/enable inspection surface; v1 is worker_threads (JS-fault isolation, NOT hardware isolation - a native crash/OOM can affect the host); `NullArtifactBackendRuntime` is the default before startup wiring - its `invoke` returns a clean `{ok:false}` so a dispatch racing startup degrades to a dispatcher retry instead of a crash (:100-158, 218-225).
- **Per-artifact SERIALIZED promise lane**: one worker per artifact; invocations to a single artifact queue on a per-artifact promise chain; different artifacts run concurrently. ALL validation (disabled/owner/bundle) happens at lane-turn time in `runOne`, NOT at enqueue - an artifact deleted while an invoke waited in the lane must be refused, not re-spawn a worker for a gone app (:236, 254-266).
- **Timeouts**: per-invoke wall-clock default `DEFAULT_INVOKE_TIMEOUT_MS = 60_000` (capability-token TTL derives from it: `ceil(timeoutMs/1000) + 30s`, :124, 317-322); a timed-out invoke resolves `{ok:false}` AND **recycles the worker** ("a hung handler must not block the artifact's lane", :503-513); worker startup raced against `DEFAULT_STARTUP_TIMEOUT_MS = 15_000` - `entry.ready` also REJECTS if the worker dies before `ready`, so a startup death fails fast instead of hanging the lane + dispatcher slot (:198, 297-306, 387-396); idle workers recycled after `DEFAULT_IDLE_TIMEOUT_MS = 5*60_000` (unref'd timer re-armed after every invoke, :125, 528-532).
- **Permanent revoke tombstone (delete path)**: `revoke(artifactId)` synchronously adds to a `revoked` set BEFORE any await, so a queued lane turn is refused even though the store row may not be physically deleted yet; `runOne` checks the tombstone FIRST and re-checks it after each await (resolveOwner / resolveBundlePath / awaitReady) to close the queued-invoke-after-delete race (:239-240, 274-289, 307-313, 555-576). Revoke then drops liveness (new capability RPCs rejected by the `isLive` gate), **drains in-flight MUTATING capability RPCs** (`appData.create/update/delete`, shared variants, `notify.inApp/email` - reads and `llm` calls are deliberately not drained) against a `DRAIN_BACKSTOP_MS = 60_000` backstop, returning `fullyDrained:false` if a commit blew past it so the caller can surface a possible late write into now-orphaned app-data (:199-216, 448-470, 477-491).
- **Capability token mint/verify per invoke**: each dispatch mints a scoped token (`{artifactId, ownerUserId, sharedData, scopes:['appData','llm','notify'], entrypoint, dryRun}`, TTL = invoke timeout + 30s); worker RPCs are verified (`verifyCapabilityToken`) AND artifact-matched, AND checked against the pending-invocation map - a handler that retained `ekoa` and called it after returning (dangling promise / background timer) gets `capability is no longer valid (invocation already settled)` (:315-322, 419-441; handle-rpc.ts:44-48).
- **True dry-run**: `opts.dryRun` suppresses every PERSISTENT side effect and captures it as a `DryRunEffect {capability, detail}` returned on the result; reads (`appData.list/get`) and `ekoa.llm.*` still run (and llm still bills the owner) so the real decision is visible (:41-48, 60-72).
- **Warm-worker staleness fix**: the bundle import URL is cache-busted by the bundle's mtime so a warm worker re-imports a REBUILT backend (Node's ESM loader caches by URL) (:323-329).
- **Failure handling**: handler-level failure never throws - always `{ok:false, error, logs}`; worker error/unexpected exit fails all pending invokes and clears the entry (:100-103, 340-343, 515-526). **No retries at this layer** - retry semantics live in the trigger dispatcher (12.3).
- **Bounded in-memory observability**: per-artifact invocation ring `MAX_INVOCATION_HISTORY = 50`, logs capped `MAX_LOGS_PER_INVOKE = 200` per invoke; worker `resourceLimits.maxOldGenerationSizeMb = 256`; in-memory `disabled` set = non-durable pause (durable pause = disable the trigger) (:196-197, 237-238, 365-370, 534-539, 585-592).

**Rebuild:** carry the lane serialization, execution-time revalidation, revoke tombstone + mutating-commit drain, and invocation-scoped capability checks wholesale - each closes a specific race (queued-invoke-after-delete, post-settle capability use, hung-handler lane blockage, stale warm bundle).

---

## 8. esbuild Pipeline, App Bundling, Static Serving, Preview Lifecycle

### 8.1 AppBuilder (`app-builder.ts`)

- `build(appId, sandboxPath)` = frontend build + optional backend build when `manifest.backend` declares one; backend errors merged so a non-compiling backend fails the whole build loudly (:303-318).
- **Frontend** (:387-482): tolerates invalid manifest (defaults `entryPoint: frontend/src/index.jsx`, `outputDir: dist/`); **plain-HTML fast path** - a root-level `index.html` (never created by the scaffold) means static output: web-extension files copied to dist/, no esbuild (:406-409, 495-542); JSX path runs esbuild then generates `dist/index.html` from the scaffold template with a conditional `bundle.css` link (:433-455). Missing entry point or build failure writes an **error HTML page with a 5s auto-reload** so the preview never 404s (:418-431, 466-481, 679-701).
- **Shared esbuild options** (:232-273): IIFE, browser, es2020, `jsx:'automatic'`, entryNames `bundle`, React resolved from **cortex's** node_modules via `nodePaths` (sandboxes never run npm install); loaders for js/jsx/tsx/ts/css/images/fonts; `minify:false`, `sourcemap:true`, `metafile:true`, `define NODE_ENV="development"`.
- **CDN resolver plugin** (:136-223): intercepts `https://` imports; CSS `@import url()` stays external; known packages resolved locally first; otherwise fetched from esm.sh at build time (15s timeout, in-memory cache) and **bundled** (never `external` - IIFE + external emits `require()` which breaks browsers); nested esm.sh relative imports resolved back to esm.sh; fetch failures compile to `/* Fetch error */ export default {}` stubs.
- **Backend bundle** (:325-381): esbuild node/esm/node20 -> `dist-backend/backend.mjs`; the artifact-backend worker imports that bundle; the `ekoa` capability handle is never imported at build time.
- **Watch** (:548-653): disposes any prior context first; plain-HTML apps skip watching; `context()` with an `html-generator` plugin whose `onEnd` regenerates index.html, **clears the artifact's stale health verdict**, and fires the caller's `onRebuild` (which broadcasts `preview_reload` SSE) (:594-627). `unwatch` disposes (:656-667); `dispose()` (all) runs on SIGINT/SIGTERM (index.ts:797).
- **Health-clearing side effect**: after any successful build/rebuild, `clearArtifactHealth` deletes the artifact's `health` field so the next in-page probe re-evaluates (:283-296, 408, 457, 617).
- `validateBundle(distDir)`: reads the first 20 bytes of `dist/bundle.js` and requires the `(() => {` IIFE prefix (:713-739); used by the final-build retry loop (execute-handler.ts:924-937).

### 8.2 Scaffold (`app-scaffold.ts`)

`scaffoldApp` creates `frontend/src`, `skills/`, `recipes/`, `instructions/` (:36-41, 109-111); writes `manifest.json` if absent (:113-123); writes either `templateScaffoldFiles` (path-safety: rejects absolute paths and `..`; **always overwrites**) or three generic starters from `data/scaffold-templates/` (skip-if-exists) (:125-147); best-effort `vcsInit` + `Initial scaffold` commit so the first agent iteration has a parent commit (:149-163). Idempotent.

### 8.3 AppRegistry (`app-registry.ts`)

In-memory map of registered apps with distDir/projectDir/userId/manifest + hot-reloaded content maps (:23-43). `register` is idempotent (unregisters first) and starts a **chokidar watcher** over `skills/`, `recipes/`, `instructions/`, `manifest.json`, and distDir with a **100ms per-file debounce** (:74-126, 297-333). Dist changes fire `onDistChange` listeners (:186-192, 355-365). `start(sandboxRoot)` scans `user-*/` project dirs at boot and registers **only projects with a valid manifest.json** (:196-235). Unregister keeps static files on disk (:128-146).

### 8.4 What triggers a bundle (complete list)

| Trigger | Where | Notes |
|---|---|---|
| First-build kickoff (pre-agent) | execute-handler.ts:501-517 | initial build + watch; failure non-fatal |
| Agent edits during a build | esbuild watch context | rebuild -> html regen -> `preview_reload` SSE (execute-handler.ts:363-369, 504-510) |
| Final build after agent completes | execute-handler.ts:905-951 | watcher stopped first; dist wiped; 2 attempts + IIFE validation |
| Featured-artifact boot prebuild | services/featured-artifact-builder.ts:270-338 | post-listen, fire-and-forget (index.ts:859-869) |
| Lazy heal of /apps request | server.ts:2817-2858 | GitHub hydrate + rebuild when working copy missing |
| Dev-serve register | server.ts:2686-2714 | build + register + watch; **prod-disabled** via `isProductionLike` (:2677) |
| Governed `build_app` tool | tools/build.ts:65-85 | validates projectDir inside sandbox root (:43-49) |

**Featured prebuilder specifics** (featured-artifact-builder.ts): freshness = `dist/index.html` mtime >= newest source mtime (:141-150); **bare-import pre-check** - an unresolvable bare import crashes esbuild's *service* from a socket callback (uncatchable, kills cortex), so such scaffolds are skipped cleanly (:64-116, 289-302); customized featured artifacts build from the user's **working copy**, never force-copying the scaffold over user edits (:158-182); scaffolds mirrored to `~/.ekoa/data/featured-builds/<id>` (dist kept out of the versioned tree) (:184-199); **registration happens even on build failure** (the error HTML serves instead of the "Building…" placeholder) (:201-215); scaffolds with backends get `data.projectDir` patched onto the seeded instance (fresh-read-then-write to shrink the shallow-merge clobber window - documented accepted race) (:228-248); screenshots fire-and-forget, self-healing only when the prior PNG is missing (:310-328).

### 8.5 Static serving + slug resolution (`server.ts`)

- `/apps/*` gets `Access-Control-Allow-Origin: *` (:3411-3414).
- `/apps/:appId` middleware (:3417-3544), in order:
  1. **301 trailing-slash redirect** for bare `/apps/<id>` (:3420-3428).
  2. **Canonical id resolution**: `getAppIdBySlug(appId) || appId` - app-data always keyed by canonical artifact id, so slug edits never orphan data (:3430-3436).
  3. **Shareability gate on document requests only** (never assets - browsers do not propagate `?token=` on sub-resource fetches; gating assets would blank the iframe): revoked share -> 410 PT page unless requester is the owner (token from Authorization header > `ekoa_token` cookie > `?token=`) (:3438-3481).
  4. `resolveAppDistDir` - registry, slug fallback, dist existence (:2747-2764).
  5. **Lazy heal** `tryRegisterAppFromInstance`: persisted artifact with a projectDir under sandboxRoot/featured-builds; missing directory attempts **GitHub lazy hydration** (`hydrateAppRepoIfMissing`) + rebuild; registers only when `dist/index.html` exists (:2806-2858, 3486-3492).
  6. No dist -> `sendAppBuildingResponse`: **uncacheable** 503 plain text for asset extensions, uncacheable auto-refreshing (3s) "Building…" HTML for navigations - a cached 200 HTML under an asset URL would later execute as JS and permanently brick the app (:2766-2804, 3494-3498).
  7. HTML: `index.html` + `injectAppContext` with no-cache headers; a dist without index.html (mid-build window) gets the building placeholder (:3500-3518).
  8. Assets: cached `express.static` per distDir (:2893-2908); cache headers: HTML no-cache; hashed js/css 1-year immutable; non-hashed bundle.js/bundle.css no-cache (hot-reload); everything else 1h (:2860-2891). Static miss: asset -> JSON 404 (never HTML-as-JS); navigation -> SPA fallback to injected index.html (:3521-3543).
- **`injectAppContext`** (:2932-3222) stamps into every served HTML: `window.__EKOA_APP_ID` (canonical), the full `window.__ekoa` helper (fetch/list/get/create/update/delete, `shared.*` owner-scoped collections, uploadFile/deleteFile, SSO signIn/whoami/signOut/graphFetch/passwordSignIn/setUserPassword, exportPdf, cloudFiles.*), the **in-page health probe** (captures first uncaught error/rejection/empty DOM, reports once to `/api/app-health` after ~3s settle / 10s max, keepalive fetch) (:3142-3207), a `<script src="/__ekoa/demo-bridge.js">`, and a `<base href="/apps/<id>/">` so deep SPA routes reload their own bundle (:3209-3221).
- **Slug system** (services/slug-generator.ts): in-memory slug->id map loaded from persisted artifacts at boot (:24-34; index.ts:92); `generateSlug` = Haiku FAST with a strict system prompt, output cleaned + brand/platform stop-words stripped, deterministic `fallbackSlug` on invalid/failed output, collision resolved by `-2..-99` suffix then a base36 timestamp (:96-191). Billed as agentType `slug-gen`.
- **`/build/:slug` share links** (server.ts:3233-3295): per-request `lookupShareable`; not-found -> 404, revoked -> 410; unauthenticated visitors redirected to `/login?next=` on the frontend origin (resolved from `EKOA_STREAMING_ALLOWED_ORIGINS` in dev); authenticated visitors get a **fresh fork per click** (`forkArtifact`) and a redirect to `/chat?continue=<newId>`.

### 8.6 Screenshots and app health

- `services/artifact-screenshot.ts`: lazy Playwright import, one shared headless Chromium with concurrent-launch guard and exit/SIGINT/SIGTERM cleanup (:47-89); captures `http://localhost:<port>/apps/<id>/` at 1280x800, networkidle + 800ms settle, 30s timeout, **every call overwrites** (no debounce) (:36-41, 109-144); saved to `~/.ekoa/data/artifact-screenshots/<id>.png`, served at `/artifact-screenshots/` (server.ts:243). Called fire-and-forget after every completed build (execute-handler.ts:1085-1088) and from the featured prebuilder.
- App health probe/scan: see section 6.

### 8.7 Preview lifecycle summary

scaffold -> initial build -> register -> watch (rebuild -> `preview_reload` SSE) -> agent edits -> final build (watcher stopped, dist wiped, validated) -> artifact `active` + slug + screenshot -> served at `/apps/{slug|id}/` with injected context. Watchers are per-appId, replaced on re-watch, all disposed on shutdown (index.ts:797-798). Follow-ups re-arm the watcher and re-register before the classifier/pipeline (execute-handler.ts:361-375).

### 8.8 Artifact PDF export (`services/artifact-pdf.ts`)

The `exportPdf` name in the injectAppContext helper list (8.5) is backed by a whole pipeline:

- **Routes**: `GET /api/v1/artifacts/:instanceId/pdf` renders a built artifact instance to PDF and 302-redirects to the served file (instanceId charset-guarded against path traversal - it becomes the output basename) (server.ts:267-283); `POST /api/app-pdf` is the app-facing export - a served app POSTs its serialized DOM via `window.__ekoa.exportPdf` with `X-Ekoa-App-Id` header scoping (server.ts:284-290+, helper wiring :3088).
- **Rendering**: shared headless-Chromium pool (13.1) with an injected `PDF_PRINT_RESET_CSS` - a vetted print reset that fixes screen-first/LLM-authored pagination bugs (whole `break-inside:avoid` card grids jumping pages, atomic cards/table-rows split mid-element) WITHOUT touching the source HTML; deliberately does NOT impose `@page` margins (would break full-bleed covers); hardened - page JS disabled, private-network subresources blocked (artifact-pdf.ts:1-21; server.ts:285-289).
- **Persistence + serving**: PDFs written under `<dataDir>/artifact-pdfs` (artifact-pdf.ts:62, 114, 153) and served statically at `/artifact-pdfs` with CORS `*` + 1h cache (server.ts:254-262). **Another retention-less growth store** (Conflicts #22).

### 8.9 Workspace-credential planes for served apps (cloud files + M365 Graph proxy)

Both act as the WORKSPACE's platform OAuth connection so the served app never sees a token; refresh/singleflight/needsReauth all stay in core via `getValidTokens` (3.3).

- **Cloud files** (`services/cloud-files.ts`, routes registered by `registerAppCloudFileRoutes` at `/api/app-cloud-files` - raw body mount 30mb `EKOA_APP_CLOUD_FILES_MAX_SIZE`, server.ts:121, 2448): backs `window.__ekoa.cloudFiles` (status/upload/list/download, injectAppContext wiring server.ts:3107-3130). **Provider quirks absorbed invisibly** so generated apps never carry them: Google Drive multipart upload (<5 MB) vs resumable session (larger); Graph simple PUT (<4 MB) vs `createUploadSession`; Google-native Docs/Sheets/Slides cannot be fetched `alt=media` - exported to their Office equivalents on download (cloud-files.ts:1-17).
- **Workspace M365 Graph proxy** `ALL /api/m365/*` (also in the 1.2 table): forwards the caller-chosen Graph path verbatim to `https://graph.microsoft.com/<path>` injecting a freshly-refreshed workspace Microsoft Bearer; JWT optional (invalid -> 401, absent proceeds - same-origin served apps call it token-free); any method + raw bodies (SharePoint folder POST / file-content PUT; `express.raw` 25mb claimed before `express.json` so PUT bytes stay exact); upstream failures -> 502 (server.ts:123-126, 1734-1786). Distinct from the per-user `/api/app-sso/m365` proxy (1.8), which acts AS the signed-in visitor.

### 8.10 Public legal-suite service endpoints (served-app data plane)

A family of credential-free service endpoints for the legal-suite apps, all gated by `requireLegalSuiteApp` - `X-Ekoa-App-Id` header, slug-resolved, charset-checked, **per-endpoint app allowlist -> 403 PT message** (a rotated/forged header id still cannot reach the service unless it names an allowlisted app; the header is acknowledged in-code as forgeable, hardening to a signed app token is a stated follow-up) - plus `makeAppRateLimiter(perApp, global)` sliding-window limits returning **429 "Tente novamente dentro de um minuto"**; a blocked caller's hit is not recorded (cannot extend its own cooldown) (server.ts:2038-2078 rationale + citius limiter, :2130 generic limiter, :2153-2166 gate - unlike `requireAdobeAppContext` it does NOT require the app to be registered; the citius route additionally checks `appRegistry.getApp`, :2088).

| Endpoint | Allowlist | Rate limit | Behavior | Cite (server.ts) |
|---|---|---|---|---|
| `GET /api/citius/consulta?processo=` | legal-citius/nucleo/prazos/dossie | 6/min per app, 20/min global | public Citius publications scrape; accepted-fragile (ASP.NET WebForms portal), clean PT 503 when the portal flow is unavailable | :2061-2127 |
| `GET /api/tracking/consulta?tracking=` | legal-correio/apoio/dossie/nucleo | 6/min, 20/min global | CTT object tracking via `services/ctt-tracking` | :2168-2195 |
| `GET /api/legal-research?q=&sources=&verify=` | legal-pesquisa/pecas | 4/min, 10/min global | DGSI/DRE research; `verify` defaults true | :2196-2224 |
| `POST /api/signature/send` | registered-app Adobe context (`requireAdobeAppContext`, :1891) | - | pluggable e-signature provider (default adobe-sign; CMD provider pluggable behind it); `not_connected`->409, `not_available`->501, else 502 | :2225-2253 |
| `POST /api/legal/calculos` | legal-calculos service app | allowlist + rate limit | cited legal calculations; rate table = canonical (legal-engines) merged with the caller's crawler-fed spine overlay (`tabelas_taxas`); missing-update alarm rides every response | :2255-2318 |
| `POST /api/legal/transcricao` | legal-transcricao | 6/min per app, 12/min global | STT transcription jobs: writes progress/segments onto the owner spine's `transcricoes` app-data row (`por_transcrever -> a_transcrever -> transcrito\|erro`), then meters `stt:<engine>` (see 12.7) | :2320-2360+ |

**STT invisible billing/consent semantics** (`services/stt-provider.ts`): ONE interface, three engines - `whisperx` (self-hosted WhisperX + pyannote on GCP GPU) is the **default posture** (segredo profissional argues for self-hosted; unavailable until GPU capacity is provisioned); `elevenlabs` (cloud Scribe) requires an API key AND an **explicit per-matter cloud-consent flag** (`consentCloud` - voice recordings are third-party personal data under RGPD, so cloud processing is opt-in per transcription, never default); `mock` is the only pre-checkpoint engine (deterministic PT-PT two-speaker fixture). Every transcription meters **`stt:<engine>` per started audio minute at `STT_TOKENS_PER_MINUTE`** into the internal-currency framework, best-effort (a billing failure never loses the finished transcription) (stt-provider.ts:1-25, 200-221; server.ts:2360 area).

**Rebuild:** carry the cache-header discipline, IIFE validation, building-placeholder-never-cacheable rule, and injectAppContext contract - each encodes a "permanently bricked app" class of bug. The 8.8-8.10 planes are entirely invisible from the dashboard UI - a rebuild that only reimplements `/apps` serving amputates PDF export, cloud files, the workspace Graph proxy, and the whole legal-suite service layer.

---

## 9. Bridge / ekoa-local Commanding

### 9.1 Credential + connection lifecycle

1. **Mint**: `POST /api/v1/bridge/token` (JWT) - body `connectionId` (default `'default'`, `[A-Za-z0-9._-]{1,128}`) -> short-TTL bridge JWT + `wsPath` (server.ts:1348-1366). TTL **600s**, audience `ekoa-bridge`, claims `{sub: ownerUserId, connectionId}` (bridge/auth.ts:13-46).
2. **Dial-in**: the daemon dials OUT (NAT-friendly); Cortex is the WS server. Upgrade on `/api/v1/bridge/connect/:connectionId` (bridge/server.ts:31; attached server.ts:340). Auth precedence: Bearer header preferred; `?token=` accepted only as a transition fallback (URL tokens leak into proxy logs) (bridge/server.ts:147-151). `verifyBridgeToken` enforces connectionId == URL segment (bridge/auth.ts:73-75). Origin checks **opt-in** (`EKOA_BRIDGE_ALLOWED_ORIGINS`) because native daemons send no Origin (bridge/server.ts:33-40). Optional `resolveOwner` must agree with the token's `sub` or the socket is rejected `ownership-mismatch` (:160-166).
3. **Registry** (bridge/registry.ts): keyed by connectionId with a secondary ownerUserId index; redial with the same connectionId retires the stale socket (`replaced`) (:15-29); `getConnectionByOwner` returns the most-recently-registered live connection (:46-58). Unregistered on close (bridge/server.ts:102-104).

### 9.2 BridgeConnection correlator (`bridge/connection.ts`)

One socket, one pending-map, two faces:
- **Agent face**: `invokeCapability` -> `agent_tool_call{callId}`, resolves on `agent_tool_result`; timeout **120 000 ms** (`EKOA_BRIDGE_INVOKE_TIMEOUT_MS`); AbortSignal sends a `cancel` frame AND rejects locally (:38-41, 106-143, 132-139).
- **Executor face**: `runStep({capability, input, stepId, runId})` -> `exec_step`; `step_start`/`step_progress` forwarded and **each progress re-arms the timeout** (progress proves liveness); resolves on `step_result`; timeout **600 000 ms** (`EKOA_BRIDGE_STEP_TIMEOUT_MS`) (:42-45, 151-179, 232-246).
- **Timeout behavior**: a `cancel` frame is sent before rejecting so a timed-out destructive bash/browser step does not keep running orphaned on the user's machine (:288-302). Timers unref'd.
- **Close** rejects everything in flight with `bridge connection closed: <reason>` (:258-268). Unparseable/invalid frames **dropped** (zod-validated at the boundary) (:209-226; bridge/protocol.ts:146-149).
- Wire protocol (bridge/protocol.ts) is an explicit **mirror of ekoa-local/src/protocol/control-channel.ts - keep in lockstep**. Every capability returns a `ResultEnvelope {ok, observation{kind,text,screenshotB64,data}, error{message,retryable}, meta{durationMs,truncated,bytesElided}}` - act-and-observe, never bare success/failure (:26-62).

### 9.3 Consumers

- **Agent face** (7.5): `buildEkoaLocalMcpServer` registers three tools whose zod schemas mirror the daemon's (daemon re-validates; drift costs only a clean validation error) (agent-face/daemon-tools.ts:13-19). `invoke()` guards no-connection **in the handler** (daemon can drop mid-run) and never throws - errors become `isError` CallToolResults (:205-227). Browser tool injects `owner = authenticated userId` server-side - the model can never target another user's browser profile (:249-254). Envelope rendering folds bash exitCode/stderr/timeout into text; screenshots become image blocks (:150-182).
- **Automation `local_command` steps** (automation/executors/local-command.ts): argv template-interpolated; **consent gate** - unapproved command *shapes* fail with `awaiting_consent:<shape>` recoverable error carrying `{kind, shape, argv, description, stepIndex}` (engine surfaces as a pause) (:87-112); approval `lastUsedAt` bumped fire-and-forget (:114-115); no daemon -> `awaiting_daemon` non-recoverable (:120-131); dispatch via `runStep('bash')` with env limited to an explicit whitelist copied from cortex env (:139-160, 255-263); `step_progress` chunks surfaced as stdout (:134-158); output capped **5 MB**/stream, timeout `min(spec.timeoutMs ?? 5 min, 30 min)` (:30-32, 88, 183-196); failure taxonomy: `!ok` without exit code = daemon failure; `timedOut` recoverable; nonzero exit recoverable with first 3 stderr lines (:210-242).
- **Automation browser steps** (automation/browser-session.ts): `DaemonBrowserSession` replaces a local Playwright Page - every act/assert/observe is `runStep('browser')`; the daemon returns a composite `page` observation (screenshot + text + url + domShapeSketch + heading) from which the **fingerprint is computed hosted-side** (`fingerprintFromParts`), preserving the `(automationId, stepId, fingerprint)` cache key (:1-59, 114-120). `local-browser-session.ts` is the in-process fallback when no daemon connects.
- `/health` reports `bridgeConnections` separately from SSE `connections` (server.ts:465-468).

### 9.4 Live browser-view streaming (`streaming/` - sibling WS surface, not the bridge)

WS upgrade on `/api/v1/automation-stream/<traceId>?token=` (streaming/index.ts:13, 73-101); token = 600s JWT `{sub, traceId}` over `config.jwtSecret` (streaming/auth.ts:4-20); upgrade also requires the traceId to map to an **active run owned by the token subject** (streaming/index.ts:134-139) and, when `EKOA_STREAMING_ALLOWED_ORIGINS` is set, an allowed Origin (:117-124). `openSession` wraps the run's Playwright Page in a `StreamSession`; availability announced via the `automation_run_streaming_available` SSE event. Mechanics (streaming/session.ts): CDP screencast FPS 15 / JPEG 70 / max backlog 3 (env-tunable, :21-23); **500ms screenshot-poll fallback** because headless screencast only fires on repaints (a static solved-CAPTCHA page would otherwise stay black, :24-28, 118-133); every CDP frame ACKed even when dropped (:215-227); screencast restarted on cross-origin `frameNavigated` (:73-79); immediate screenshot on socket attach so the canvas is never black (:112-115); a replacing socket closes the prior with code 4000 (:85-88). **Input (mouse/key) dispatched only while the run state probe returns `'paused_for_user'`** - otherwise dropped as `state-not-paused` (:275-291). Registry replaces prior sessions per traceId (streaming/registry.ts:5-11).

**Rebuild:** carry the envelope contract, timeout-cancel frames, and the paused-only input gate; these are the safety model of remote commanding.

---

## 10. Activity / Audit Logging

### 10.1 Storage and write mechanism

- Store: `activityStore = new JsonStore<StoredActivityLog>` over `~/.ekoa/data/activity-logs.json`; record `{id, userId, username, category, type, description, metadata?, timestamp}` (persistence/activity.ts:5-18).
- Single write helper `logActivity(user, category, type, description, metadata?)` (handlers/shared.ts:41-68):
  1. **Best-effort/swallow**: persistence failure caught + warned - audit failure must NEVER fail the domain action (:48-67).
  2. **`username` field actually stores the user id** - `username: user.id // handlers don't have username, use id` (:55). Every handler-written row lies in this column (verified).
- No direct `activityStore.create` calls exist outside `logActivity` (grep-verified).
- Read path: `ekoa.activity/list` - filter by userId/category/type/date, newest-first, paginate (default page=1, limit=50) (handlers/activity-handler.ts:38-86). **No frontend consumer exists** - write-only surface today.
- **No retention/pruning** - `activity-logs.json` grows unboundedly.

### 10.2 Complete write-site inventory (grep-complete)

| Category | Types | Trigger | Cite |
|---|---|---|---|
| auth | login; create-user; change-password; reset-password; device-approve/device-deny; device-login; delete-user; set-templates | auth flows; user admin | auth-handler.ts:130, 176, 219, 251, 359-364, 406; users-handler.ts:148, 244 |
| execute | execute-job; commit-blocked (SecretCommitError - snapshot skipped over detected credential, includes `findings`); cancel-job | build lifecycle | execute-handler.ts:676, 981, 1303 |
| integrations | delete-skill; create/update/delete-config; adobe-oauth-connect; connect-session (incl. CITIUS listener registration); provision-automations; execute; save-skill | integration CRUD + execution | integrations-handler.ts:250, 342, 370, 431, 466, 522, 588, 613, 664, 715; integration-builder-handler.ts:334, 548 |
| memory | create/update/delete/bulk-delete; submit-signal; consolidate (with merged/deleted/kept counts) | memory CRUD + signals | memory-handler.ts:219, 257, 279, 304, 333, 361 |
| teams | create/update/delete | team CRUD | teams-handler.ts:94, 127, 159 |
| branding | start-research; save-branding | brand flows | branding-handler.ts:125, 746 |
| settings | update (global vs sandbox variants) | settings update | settings-handler.ts:154, 193 |
| billing | credits-purchased; overage-toggled; global-overage-toggled; admin-reset-usage; admin-set-limit | billing ops | billing-handler.ts:160, 189, 219, 295, 352 |
| app-data | backup-snapshot; backup-restore (PT-PT descriptions) | manual backup/restore | app-data-backups-handler.ts:58, 67 |
| knowledge | ingest; delete; add/update/delete-source; refresh-all; unindex-document; reindex | vault + source ops | knowledge-handler.ts:261, 318, 370, 405, 439, 471, 528, 574, 605 |
| platform-integrations | connect; callback; disconnect | Google/Microsoft/Adobe OAuth lifecycle | platform-integrations-handler.ts:150, 222, 255 |
| artifacts | create/update/delete-instance; write-file; restore-version; set-featured; fork-instance; import-instance; update-from-bundle; update-featured-from-source; ignore-featured-update | artifact lifecycle | artifacts-handler.ts:188, 312, 377, 424, 598, 648, 674, 728, 786, 836, 875 |
| pipedream | disconnect-account; run-action; configure; remove-config | Pipedream ops | pipedream-handler.ts:106, 135, 165, 177 |

### 10.3 Second audit surface: `webhook_audit` (SQLite)

Distinct from activity-logs.json: **every inbound webhook attempt on the `/hooks/:triggerId` paths** writes a row into the `webhook_audit` table of `~/.ekoa/data/triggers.db` (persistence/event-queue.ts:151-160, 299-311). Results: `accepted | duplicate | rejected_signature | rejected_unknown_trigger | rejected_disabled | rejected_other` (:34-40). Written at every outcome of the POST ingress, the GET meta-hub challenge, and the GET-callback event path (Ifthenpay) (webhooks-handler.ts:77-195, 216-286, 306-380). No pruning; indexed by `received_at`.

**Exception - the Adobe Sign ingress bypasses `webhook_audit` entirely**: `GET/POST /api/adobe-sign/webhook` (12.2) is a dedicated route outside the `/hooks` pipeline; `services/adobe-webhook.ts` contains no `writeAudit`/`webhook_audit` reference (verified) - Adobe notifications leave no audit row on any outcome.

**Rebuild:** carry both surfaces; decide the username-vs-id column (fix or drop), add retention.

---

## 11. Memory Extraction and Consolidation Flows

### 11.1 Config gates (config.ts:106-122)

- `memory.retrieval`: enabled unless `MEMORY_RETRIEVAL_ENABLED=false`; maxMemories 20, maxCore 5, minRelevanceScore 0.1.
- `memory.consolidation.enabled` default true.
- `memory.autoExtract`: enabled default true; minMessages 2; maxInputTokens 8000; confidenceThreshold 0.55.

### 11.2 Auto-extraction (post-turn, fire-and-forget)

Engine: `extractMemoriesFromConversation` (memory/auto-extractor.ts:189-333). Never throws; errors warn + best-effort.

Pipeline: gate on enabled + `conversation.length >= 2` (:197-203) -> format/truncate to ~8k tokens (keep first-2 + last-2 messages over budget, :146-177) -> **one Haiku FAST call** (`agentType:'memory-extract'`, **billed to the user whose conversation is analyzed**, :213-220) -> JSON-parse candidates (markdown fences tolerated, :227-237) -> structural + category validation, confidence >= 0.55 (:249-271) -> **privacy scrub** of content AND tags via 12 regex patterns (tokens, AWS keys, bearer, passwords, connection strings, emails, credit cards, SSNs, IPs, env secrets, base64 >= 40 chars) replaced with `[label]` (:39-81, 273-283) -> stored `tier:'active'`, `scope:'company'`, `origin:'auto-extraction'`, `visibility:'shared'`, `score = round(confidence*100)`, `source = auto:<agentType>, job:<8>, session:<8>` (:286-315).

Trigger points (all fire-and-forget, `.catch(console.warn)`):
1. **Chat**: after every turn's onComplete, unless the result is a detected provider error; full session history; `agentType:'chat'` (index.ts:649-656).
2. **Build**: after every successful build completion; `agentType:'build'`; includes jobId (execute-handler.ts:1096-1103).
3. **Assistant-chat** ("memory co-op"): per-call `memoryCoopEnabled` flag, default **false**; `agentType:'assistant'` (execute-handler.ts:1356, 1383, 1525-1536).

Cost: one FAST/Haiku call per qualifying turn, billed via central adapter auto-billing.

### 11.3 Resolver -> prompt injection

- `resolveMemories` (memory/resolver.ts:149-244): loads ALL memories; filters visibility (shared or owned); optional `entityId` (automation scope tag `automation:<id>`, bypasses the relevance floor) and `scopeTags` AND-filter (:164-182); tiers - core always up to 5, active scored, **archive excluded** (:184-196); active score = tagOverlap x0.35 + termOverlap x0.25 + 30-day-linear recency x0.15 + storedScore x0.15 + verified 0.05 + log(usage) x0.05 (:124-132); floor 0.1, cap 20.
- **Invisible side effect**: every resolved memory gets a fire-and-forget `usageCount+1` / `lastUsedAt` update, errors swallowed - resolution itself mutates the store (:229-241).
- **Trace map ring buffer** (in-memory, 200 traces) links traceId -> injected memory ids for the signal system (:60-79).
- Injection points: every SDK agent call unless `skipMemory` (external.ts:864-871, merged with knowledge grounding :900-901); build wizard resolves separately (execute-handler.ts:1398); automation engine `loadScopedMemorySnippets` - entity-scoped, max 8 bullets, injected into vision context (automation/engine.ts:1609-1633).
- Formatter (memory/formatter.ts:48-84): section `## Organizational Memory`; **Guardrails rendered first** as `- **RULE:** …` with non-negotiable language - guardrail = core tier + type `preference` + tag `guardrail` (:28-30, 51, 61-67); content truncated at 500 chars (:13).

### 11.4 Signals

`processSignal(traceId, 'positive'|'negative')` (memory/signals.ts:29-71): looks up trace-injected memory ids from the ring buffer; appends signal (keeps last **50** per memory); adjusts score **+2 positive / -3 negative** (asymmetric by design), clamped 0-100 (:45-55). Entry: `ekoa.memory/submit-signal` + activity log (memory-handler.ts:331-333). If the trace aged out of the 200-entry buffer, the signal silently affects 0 memories.

### 11.5 Consolidation (manual only - NOT scheduled)

`consolidateMemories` (memory/consolidation.ts:272-336): gate on config -> load up to **1000** memories (:282) -> greedy grouping by >= 2 shared case-folded tags (:57-89) -> **one FAST/Haiku call per group** (billed to `group[0].userId`, `agentType:'memory-consolidate'`, :300-313) -> keep/merge/delete actions; merge creates a new memory (`origin:'consolidation'`, tier active, `verified:false`, empty signals) and deletes sources (:207-248). Per-group errors collected, never thrown. Trigger: **only** the `ekoa.memory/consolidate` admin intent (memory-handler.ts:345-365) - no cron/auto consolidation exists (Conflicts #19).

### 11.6 Deterministic memory writers (non-LLM)

- **Integration affinity**: on integration create/update-config, writes/refreshes an idempotent `preference` memory keyed by tag `integration-affinity:<key>` ("Prefer X for tasks Y… Trigger keywords…"), `score:85`, `verified:true`, shared, active tier; re-enable refreshes timestamps instead of duplicating; errors swallowed (memory/integration-affinity.ts:39-109; integrations-handler.ts:343, 371, 433).
- **Automation user-correction**: `submit-step-feedback` with `kind:'correction'` + note writes a `lesson` memory tagged `automation:<id>`, `step:<id>`, `user-correction`, `score:80`, `verified:true`, `visibility:'private'` (automations-handler.ts:668-691). thumbs_down/correction also **evicts** fingerprint-matched cache entries (:661-666).
- **Boot-time**: `migrateMemorySchema()` (index.ts:86; memory/migration.ts); `seedMemories()` idempotent by `seed:<seedId>` tag (index.ts:189; memory/seed.ts:1-60).

### 11.7 Vestigial

`memory/anonymizer.ts` (`anonymizeContent`/`anonymizeMemory`, :32-53) has **no production call site** - referenced only in comments (auto-extractor.ts:36; services/commit-guard.ts:15-16, which explicitly declines to use it because it false-positives on hashes/UUIDs/base64). Dead-but-referenced (Conflicts #15).

**Rebuild:** carry the extraction/injection/signal loop and the privacy scrub patterns; the resolver's write-on-read side effect must be a conscious decision; drop candidate: anonymizer.ts.

---

## 12. Scheduled / Cron-like / Fire-and-Forget Flows

### 12.1 Boot one-shots and migrations

Covered in section 5.1 (parallel block, sequential migrations, post-listen tail). Failure handling: everything except `initAppDataBackend` (mongo fail-fast) and `validateStartup` is warn-and-continue.

### 12.2 Webhook ingress pipeline (`POST/GET /hooks/:triggerId`)

handlers/webhooks-handler.ts:66-197: load trigger (404/wrong-kind) -> resolve skill webhookConfig (500 if absent) -> resolve secret (trigger's own AES-encrypted secret via governed decrypt, or a provider credential field via `secretSource`, :107-134) -> HMAC verify (services/webhook-verifiers.ts) -> **disabled check AFTER signature** (410 signed / 401 unsigned - deliberate ordering so the boot self-test can probe the wire path, :91-96, 151-155) -> clock-skew sampling from the `Date` header into a 50-sample rolling median exposed as `/health.clockSkewSec` (:157-167; event-queue.ts:85-98) -> dedup key (skill-declared path or sha256 of raw body, :169-171) -> durable enqueue; UNIQUE(trigger_id, dedup_key) collision returns 200 `duplicate:true` (:173-196). GET path: Meta hub-challenge handshake (timing-safe token compare, :216-288) and Ifthenpay-style GET-as-event callbacks (query params become the payload; provider-expected `OK` body echoed even on duplicate, :306-380).

**Second webhook ingress - Adobe Sign (`/api/adobe-sign/webhook`, outside the `/hooks` pipeline)**: `GET` is Adobe's one-time intent verification at registration - echoes `X-AdobeSign-ClientId` back as header + `{xAdobeSignClientId}` body (echoed even when it mismatches the configured client id, with a warning, so console-registered webhooks still verify); `POST` responds **200 + client-id echo IMMEDIATELY** (Adobe times out fast and retries), then processes asynchronously via dynamic import of `services/adobe-webhook.js` with `.catch` log only. **No HMAC verification and no `webhook_audit` row on any outcome** (10.3). The route is deliberately credential-free/public; real authenticity + idempotency live in the service: agreementId resolved against an owner-scoped ERP index, agreement RE-FETCHED with the owner's Adobe Bearer, unknown/unsigned agreements no-op (server.ts:1996-2036: rationale comment + `echoAdobeClientId` :2008-2022, GET :2024-2026, POST :2030-2036).

### 12.3 Trigger dispatcher (event-queue drain, `services/trigger-dispatcher.ts`)

- Trigger: wakes on the `event_enqueued` EventEmitter bus AND a **5s safety-net setInterval (unref'd)** (:47-48, 188-193). Concurrency: max **4** in-flight (:47).
- Claim: atomic `UPDATE … RETURNING` pending -> dispatching (event-queue.ts:188-199, 322-324).
- Dispatch targets (:91-163): artifact-backend (WhatsApp envelope fan-out with per-message invoke; email hydration via `callPlatformIntegration` so the artifact never touches Graph/OAuth) or automation run (`runAutomation` under the **trigger owner's** identity with a synthetic admin ToolExecutionContext, :285-287).
- Outcomes: dispatched -> `markDispatched`; non-`completed` run status -> retry; missing automation/automationId -> dead.
- **Retry schedule: 30s / 2m / 10m / 1h / 6h +-30% jitter, then `dead` after 5 attempts** (event-queue.ts:330-361).
- Boot recovery: rows stuck `dispatching` > 10 min flip back to pending (event-queue.ts:367-371; trigger-dispatcher.ts:184). Shutdown waits up to 30s for in-flight runs; the rest recovers next boot (:196-212).

### 12.4 Listener supervisor (poll-based event sourcing, `services/listener-supervisor.ts`)

- One independent unref'd setTimeout loop per `kind:'listener'` trigger (:141-151). Cadence `trigger.pollConfig.intervalMs`, default **60s** (:159). Reacts live to triggerStore created/updated/deleted (start/restart/stop + cursor delete) (:74-108); stale in-flight ticks awaited so a late cursor write cannot clobber a fresh listener (:128-139).
- Per tick: platform providers (M365/Google) go through `pollPlatformSource` + `callPlatformIntegration` (OAuth refresh in core) (:180-198); others call the skill's `pollAction` via `executeUserIntegrationAction` with `{since: cursor}` (:201-215); items extracted via skill `listenerConfig` field paths; one event per item with per-item dedupKey; a missing dedup key skips the item AND **stalls the cursor** (silent drop treated as data loss, :226-255). Cursor advances only when every item enqueued (UNIQUE dup counts as success).
- Failure: `bumpListenerFailure` persisted to SQLite `listener_state` + exponential restart backoff **1s -> 2s -> 4s -> … -> 5m** (:55, 161-172). Acknowledged deviation: JS-level isolation only, not worker_threads (:22-35).

### 12.5 Knowledge FTS: hooks, backfill, reindex

- `initKnowledgeFts()` registers `indexDoc`/`removeDoc` hooks into the vault store (dependency-inverted; fired from persistence/knowledge.ts:158, 174) - every ingest/crawl/upload/delete synchronously mirrors into the SQLite FTS5 index (services/knowledge-fts.ts:430-438).
- Startup backfill: `ready` flag != 1 -> background full rebuild via `setTimeout(0)` (:440-458); streams the directory, batches of **500**, transactions yielding to the event loop; `ready=0` during, `ready=1` only at the end - a partial index is never served (ripgrep fallback serves meanwhile); interrupted backfill self-heals next boot (:209-223, 336-403). Schema version bump drops + rebuilds (:40-42, 83-99). CLAUDE.md notes ~9 min for ~254k docs.
- Manual reindex: `ekoa.knowledge/reindex` (admin), fire-and-forget `rebuildAll` with a running-guard; UI polls `index-status`; activity-logged (knowledge-handler.ts:591-613).

### 12.6 Knowledge nightly refresh + crawl runner

- Scheduler: self-rolled one-shot setTimeout chain (no cron dep) targeting **03:00 local** (`EKOA_KNOWLEDGE_REFRESH_HOUR`; kill-switch `EKOA_KNOWLEDGE_REFRESH_DISABLED=1`); timer unref'd; generation counter prevents zombie re-arm after stop (services/knowledge-scheduler.ts:21-27, 98-141). Each run: `refreshAllEnabled` - incremental re-crawl of every enabled source, **staggered 5s apart**, already-running sources counted as skipped (:53-89). Manual `refresh-all` intent calls the same function (knowledge-handler.ts:528).
- Crawl runner (services/knowledge-crawl-runner.ts:49-118): `startCrawl` reserves the per-source slot synchronously (double-run guard), runs web/api/domino crawl in background with AbortController, tracks live progress in memory, persists `lastCrawledAt/lastRefreshAt/lastResult` on completion, caches final progress 60s then falls back to the persisted record. `cancelCrawlAndWait` used before source deletion so late writes cannot repopulate (:134-140).

### 12.7 Billing: recording, ticks, gates, resets

- **Central auto-billing**: every SDK call with userId+agentType records usage in the adapter post-run - raw SDK counts tier-weighted and cache-read-discounted via `computeMeteredTokens`, then `recordTokenUsage` fire-and-forget (external.ts:1351-1384). Weights: Haiku 0.02, Sonnet 0.1, Opus 0.4 (env-overridable), cache-read sub-factor 0.25, default Sonnet bucket (billing/constants.ts:34-63).
- `recordTokenUsage` (billing/tracker.ts:148-210): token-event row (`token-events.json`), billing record update (credits deducted when over base + overage enabled), SSE `usage_updated`; never fails the turn (:207-209). **Header comment claiming char-based estimation is stale** (tracker.ts:4-6, verified) - real SDK counts flow through; `estimateTokens` is a legacy helper (:58-61).
- Other recording sites: llm-gateway.ts:240; agent-face/index.ts:338; services/turn-classifier.ts:117; services/stt-provider.ts:212; services/pipedream.ts:392. Platform-overhead calls with no user bill to the cached super-admin id (tracker.ts:29-39).
- **STT metering** (`stt-provider.ts:200-221`, behind `POST /api/legal/transcricao`, 8.10): `stt:<engine>` billed **per started audio minute** (`Math.ceil(durationSec/60)`, min 1) at `STT_TOKENS_PER_MINUTE` into the same internal currency, best-effort (billing failure never loses the finished transcription). Cloud STT (ElevenLabs) is additionally gated by an **explicit per-matter `consentCloud` flag** (RGPD opt-in per transcription); self-hosted WhisperX is the default posture (stt-provider.ts:1-25).
- **TUI turn-classify billing** (`turn-classifier.ts:100-131`): one billed Haiku call per typed TUI turn in default mode, `agentType:'classify-tui-turn'`, metered manually with FAST tier weights (the direct `callAnthropic` transport does not auto-bill); details in 2.8.
- **In-flight ticks**: cumulative output_tokens from streaming message_delta emits a debounced (1s) `usage_progress` SSE with a provisional tier-weighted delta - purely visual; final `usage_updated` is truth (external.ts:1173-1200, 1241-1249).
- **Pre-turn gate**: `gateBillingOrAbort` -> `checkBillingAllowance` before chat turns and build jobs (billing/hook.ts:24-34); `PRE_ALPHA_HARD_LIMIT = true` blocks unconditionally at base exhaustion, ignoring overage/credits (billing/middleware.ts:60-73; constants.ts:65-71); global overage kill-switch read from settings (middleware.ts:26-35).
- **Period reset is lazy**: `ensureBillingRecord` zeroes the meter when >= 30 days (`PERIOD_DAYS`) since period start - checked on every record/allowance call, no timer (tracker.ts:85-96; constants.ts:84).

### 12.8 Misc timers and debounces

| What | Cadence | Cite |
|---|---|---|
| SSE keepalive comment frames | 30s | sse.ts:19-21, 29-32 |
| SSE replay-buffer sweep (per-trace ring 200 events, max age 5 min) | setInterval 5 min | server.ts:3580; sse.ts:19, 223 |
| Chat session history persist | debounced 500ms unref'd; caps 200 sessions / 40 msgs / 32k chars | sessions.ts:86-119 |
| App-registry chokidar hot-reload | 100ms per-file debounce | app-registry.ts:306-333 |
| Live-preview watch -> `preview_reload` SSE | per rebuild | execute-handler.ts:362-369, 500-511 |
| Domain-action handler safety timeout | 300s resolve-undefined | index.ts:255-259 |
| Traces ring buffer | in-memory last 200 TraceRecords | traces/index.ts:15-17 |
| Streaming screenshot-poll fallback | 500ms (`EKOA_STREAMING_POLL_INTERVAL_MS`), skipped while CDP screencast delivers | streaming/session.ts:28, 118-133 |
| Bridge RPC per-request timeout timers | per-frame setTimeout | bridge/connection.ts:55, 289 |
| Adapter transient-error retry backoff | [5s, 15s] | external.ts:1532, 1583 |
| Claude-auth watchdog | 20 min, NOT unref'd | claude-auth.ts:36-38, 507 |
| Claude-auth scheduled refresh | jittered 45-60% of TTL | claude-auth.ts:33-35, 461-471 |
| Platform-token sweep | boot + hourly unref'd | index.ts:839-853 |
| App-SSO expired-session sweep | hourly unref'd | server.ts:1295-1299 |
| Trigger dispatcher safety poll | 5s unref'd | trigger-dispatcher.ts:47-48, 188-193 |
| Listener loops | per-trigger, default 60s | listener-supervisor.ts:141-159 |
| Knowledge nightly refresh | 03:00 local, setTimeout chain | knowledge-scheduler.ts:98-141 |
| Guided-mode + session-type caches | 30s TTL lazy | index.ts:40-52, 686-715 |
| Automation pause/resume poll | 250ms busy-wait while paused | automation/engine.ts:1866-1873 |
| Artifact-backend worker idle recycle | 5 min after last invoke (`DEFAULT_IDLE_TIMEOUT_MS`), unref'd, re-armed per invoke | services/artifact-backend/runtime.ts:125, 528-532 |
| Artifact-backend per-invoke timeout | 60s default (`DEFAULT_INVOKE_TIMEOUT_MS`), unref'd; timeout recycles the worker | services/artifact-backend/runtime.ts:124, 333-335, 503-513 |

### 12.9 Fire-and-forget inventory (consolidated)

| What | Where | Failure handling |
|---|---|---|
| Post-turn memory extraction (chat/build/assistant) | index.ts:650-656; execute-handler.ts:1096-1103, 1522-1536 | `.catch` warn only |
| Adapter auto-billing `recordTokenUsage` | external.ts:1368-1383; agent-face/index.ts:338-352 | `.catch` error log; never fails the call |
| Artifact screenshot after build | execute-handler.ts:1085-1088; featured-artifact-builder.ts:316-328 | warn only |
| GitHub backup after commit | execute-handler.ts:971-973 | gated (`GITHUB_PUSH_ENABLED`) + safe wrapper |
| `runAIPipeline` launch | execute-handler.ts:659-669 | terminal state owned by callbacks |
| Featured prebuild + app-health scan at boot | index.ts:859-893 | warn only; post-listen |
| Startup recipe auto-compilation | index.ts:312-327 | per-app error log |
| Knowledge NFC migration | index.ts:201-215 | warn only |
| Webhook raw-body self-test | index.ts:810-826 | loud error log on failure |
| Hourly platform-token refresh sweep | index.ts:844-853 | per-config isolated |
| License heartbeat (`last_seen_at`) | tools/license.ts:60-61 | fire-and-forget |
| Memory resolver usage-count bump | memory/resolver.ts:229-241 | swallowed |
| local_command approval `lastUsedAt` bump | automation/executors/local-command.ts:114-115 | swallowed |
| SSE `usage_progress` ticks | external.ts:1181-1200 | swallowed; real billing is truth |
| Slug generation post-build | execute-handler.ts:993-1030 | deterministic fallback; app served by id on failure |
| Manual FTS reindex | knowledge-handler.ts:591-613 | running-guard; UI polls status |

---

## 13. Automation Engine Background Behaviors

### 13.1 Browser lifecycles

- **Shared headless pool** (services/browser-pool.ts:14-54): single lazy headless Chromium, concurrent-launch guard, cleanup on process exit/SIGINT/SIGTERM. Consumers: artifact screenshots, brand research, adobe-sign, app-health scan.
- **Per-owner persistent automation context** (services/automation-browser.ts:1-46): separate from the pool by design - persistent profile at `~/.ekoa/sandboxes/user-<ownerId>/automation-profile/`, cached per ownerId for the **process lifetime** (cookies/logins persist across runs; pages open/close per run); stealth init script patching `navigator.webdriver`/`window.chrome`/plugins/languages on every page (:50-80); process-exit cleanup. State: on-disk Chromium profile per user.

### 13.2 Vision cost profile (per step)

Cache hit -> deterministic replay, no LLM. Cache miss -> **vision pinned to EXPERT/Opus at `sdkEffort:'max'` on first try - there is NO Sonnet-to-Opus escalation** (automation/engine.ts:4-11 "There is no Sonnet->Opus escalation because vision is already pinned to the strongest model on first try"; services/vision.ts:12, 269 resolve, :410 verify - verified). `classifyHumanAction` uses FAST/Haiku (vision.ts:350). Contradicts CLAUDE.md's three-tier description (Conflicts #17).

### 13.3 Cache writes into the memory system

automation/cache.ts - action/assertion cache entries ARE `StoredMemory` rows (no parallel store): tags `automation:<id>` + `step:<id>` + `action-cache|assertion-cache`; structured data in `attachments.payload` (fingerprint, PlaywrightAction/Assertion, successCount, confidence) so the resolver never term-scores it (:1-53). Writes: after each successful vision resolution/verification the engine upserts (existing -> successCount++, payload refresh; else create `score:60`, tier active, `origin:'auto-extraction'`, visibility private-to-owner unless shared) (cache.ts:94-168, 181-252; engine.ts:1320-1326, 1398, 1511-1517, 1573). Lookup keyed by `(automationId, stepId, kind, fingerprintKey)` (:55-77). Eviction: step-feedback thumbs_down/correction deletes fingerprint-matched entries (cache.ts:263-282; automations-handler.ts:661-666). Consequence: automation runs silently grow `memories.json`, and these rows are visible in the memory CRUD surface.

### 13.4 Run persistence and other side effects

- Per-run record + per-step PNG screenshots at `~/.ekoa/data/automation-runs/<automationId>/<runId>/` (engine.ts:45-48); **no retention pruning exists** (verified: persistence/automation-runs.ts has no prune/retention sweep) - screenshots accumulate indefinitely.
- Entity-scoped memory injection per run, max 8 snippets (engine.ts:1609-1633).
- Paused-for-user steps poll cancel/resume signals every 250ms (engine.ts:1866-1873).
- Dispatcher-triggered runs execute under the trigger owner with a synthetic admin tool context (trigger-dispatcher.ts:285-287) - no interactive user in the loop.

**Rebuild:** carry the memory-backed cache design (or replace with a dedicated store - but then re-plumb feedback eviction); add run/screenshot retention.

---

## Conflicts (doc/code contradictions and vestigial findings)

Code is truth. Each entry records the contradiction; none were resolved.

1. **index.ts:68 comment "Startup validation (warns but does not block)"** contradicts startup.ts:8-16 ("FATAL - server won't start") and the throw-to-exit(1) paths (index.ts:896-899). Validation IS fatal. (Verified.)
2. **index.ts:71 tool-list comment** ("crypto, jwt, process, preview, ports, files, oauth, license") - `process/preview/ports/oauth` tool files do not exist in src/tools/.
3. **Frontend `ekoa.claude-oauth` intents (`start`/`status`/`disconnect`, ekoa/lib/api/client.ts:347-357) have NO backend handler** - `claude-oauth` appears nowhere in cortex/src or the domainMap (handlers/index.ts). Dead client surface. (Verified.)
4. **Two parallel AES-256-GCM implementations**: governed tool (tools/crypto.ts) vs inline `encryptString/decryptString` (tools/platform-integration-call.ts:35-66). Same format/key, different codepaths.
5. **Default secrets asymmetry**: the default JWT secret has a production fail-closed guard (config.ts:181-191); the default `ENCRYPTION_KEY` (`'default-dev-encryption-key-32ch!'`) has **no** production guard, and no key-rotation mechanism exists.
6. **No JWT revocation/blacklist**; refresh/device tokens are 30d bearer tokens with no server-side kill switch.
7. **License tier feature flags are computed but never enforced** at runtime (tools/license.ts:86-95; no gating call site in src). CLAUDE.md's "license validated on startup" is accurate; the feature map is decorative.
8. **Shutdown does not close the HTTP server or drain SSE** (index.ts:781-799) - in-flight requests dropped by process exit.
9. **Single-instance in-memory state**: device-login pending store (tools/device-auth.ts:43-45), app-health dedupe map (server.ts:3351-3354), `activeFirstBuilds`/`activeChatRuns`/`jobAbortControllers`, slug index, SSE replay buffers, memory-resolver trace ring - multi-pod deployment breaks all of them.
10. **Chat history persistence caps** (40 msgs / 32k chars / 200 sessions, sessions.ts:24-26) silently truncate on disk - an invisible data-loss boundary.
11. **CLAUDE.md "Template Preview & Browser" and "Template Screenshots" sections describe removed machinery**: `services/template-preview-builder.ts` and `services/template-screenshot.ts` do not exist (verified - services/ contains only `artifact-screenshot.ts` for screenshots). Living analogues: featured-artifact prebuilder + artifact-screenshot service. CLAUDE.md's claim of startup template-preview builds/screenshot capture does not match the boot path (index.ts has featured-artifact prebuild + app-health scan instead).
12. **`phase_changed` SSE is emitted** (services/orchestrator.ts:99-117) **but the frontend never registers that event name** - producer alive, consumer dead.
13. **`subagent_event`** is emitted by chat and build pipelines (index.ts:665-674; execute-handler.ts:878-884) but not registered in the frontend's SSE listener list - dead on the client.
14. **Job "queue" terminology is misleading**: StoredJob's `queued` state implies scheduling that does not exist - jobs execute immediately in-process; no worker pool, no retry-on-crash, no persistence-driven resumption. A cortex restart leaves on-disk `running` jobs orphaned forever (the PIPELINE_STUCK net at execute-handler.ts:1214-1235 only runs within the same process lifetime).
15. **`memory/anonymizer.ts` is dead code** - no production call site; services/commit-guard.ts:15-16 explicitly declines to reuse it (false-positives on hashes/UUIDs/base64).
16. **No `run-summary` or `site-quirk` memory writers exist** despite CLAUDE.md's automation-memory description; only `action-cache`, `assertion-cache`, and `user-correction` tags are written in code.
17. **Automation vision has no Sonnet-to-Opus escalation** - pinned to Opus/EXPERT at max effort on first try (engine.ts:4-11; vision.ts:269, 410 - verified) vs CLAUDE.md's "three-tier cache -> Sonnet -> Opus" description.
18. **billing/tracker.ts header claims char-based estimation** (tracker.ts:4-6 - verified: "Uses character-based estimation until the Claude Agent SDK exposes token counts") - stale; real SDK counts + tier weights are recorded (external.ts:1351-1384), and startup.ts's billing-units reset exists precisely because the char-estimation era corrupted meters.
19. **Memory consolidation is manual-only** (admin intent, memory-handler.ts:345-365) - never scheduled, despite the "fire-and-forget from caller" framing in consolidation.ts:10.
20. **Activity log `username` field stores the user id** (handlers/shared.ts:55 - verified: `username: user.id // handlers don't have username, use id`). Every handler-written audit row misreports this column.
21. **`ekoa.activity/list` has no frontend consumer** - the audit log is write-only today; the API exists but is an orphaned surface.
22. **Unbounded growth**: `activity-logs.json`, `token-events.json` (queried linearly per billing view, tracker.ts:219, 260), the `webhook_audit` SQLite table, `automation-runs/` screenshots, and `<dataDir>/artifact-pdfs/` exports (services/artifact-pdf.ts:62; every export writes a file, no sweep) all lack retention sweeps.
23. **execute-handler.ts self-documents governance debt**: inline fs writes in the build pipeline that belong in a service per cortex/docs/GOVERNANCE.md (execute-handler.ts:8-9).
24. **CLAUDE.md's persistence inventory drift**: CLAUDE.md lists `~/.ekoa/data/jobs.json` (single file) and `template-previews/`/`template-screenshots/` dirs; code uses per-job files at `~/.ekoa/data/jobs/<jobId>.json` (persistence/jobs.ts:36-41) and the template-* dirs have no writers (see #11). App-data may also live in mongo/Firestore, not only fs (index.ts:128-136), where CLAUDE.md describes JsonStore-only.
25. **`services/local-executor.ts` is dead code** - `DirectLocalExecutor` (in-process argv spawn with timeout/kill handling, exported via `getLocalExecutor`, local-executor.ts:34, 104) has **no import or call site anywhere in src** (grep-verified); its only reference is a comment at automation/executors/local-command.ts:7 explaining that the daemon round-trip replaced it. Same class of vestigial finding as #15 - the rebuild should not carry it.
