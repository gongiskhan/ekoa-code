# Operations Inventory — Frontend-to-Backend Operations

This document is the exhaustive inventory of every operation the ekoa frontend performs against the cortex backend, derived from frontend call sites (fetch/dispatch calls, SSE subscriptions, WebSocket clients) — NOT from backend docs or route lists. It is the REST resource map for the ground-up rebuild of cortex as a conventional Node.js + TypeScript REST service: every operation here must exist in the rebuilt API (or be consciously dropped via the Orphans section); anything missing here gets silently lost. For each operation: the UI trigger, inputs, outputs, side effects, and whether it genuinely needs streaming.

**Method:** Derived from source code at commit `3882aa6` (HEAD). Three sweeps enumerated every backend touchpoint in (1) the transport/state layer (`ekoa/lib/`, `ekoa/stores/`, `ekoa/hooks/`), (2) all route files under `ekoa/app/` (30 files), and (3) all of `ekoa/components/` plus residual support code, then merged and deduped. Backend existence was cross-checked against `cortex/src/handlers/index.ts:49-74` and `cortex/apps/`. Docs (`CLAUDE.md`, `docs/`) were treated as hints only; every doc/code contradiction found is recorded in the final section, never silently resolved. Where finder sweeps disagreed, the code was re-checked and the resolution is recorded (see Conflicts §C6). All citations are `file:line` relative to `/Users/bazinga/dev/ekoa-dev/ekoa/` unless prefixed `cortex/`.

---

## 0. Transport foundation

Everything below rides one of five transports. **Every `app/intent` operation in this document is a plain synchronous HTTP POST request-response — none of them stream.** Streaming exists only where explicitly assessed in §0.3, §21, §22.

### 0.1 Primitives (`lib/cortex/connection.ts`, singleton `CortexConnection`)

| Primitive | Wire operation | Details | Cite |
|---|---|---|---|
| `sendAction(app, intent, params, timeout=120_000)` | `POST {base}/api/v1/action` | Body `{app, intent, params, request_id: uuid}`; `Authorization: Bearer <JWT>` when token present. Response `{type:'action_result', success:true, data}` → returns `data`; `{type:'action_error', error}` → throws. AbortController timeout → throws `Action timeout: {app}/{intent}` | connection.ts:309-356 |
| `sendRequest(message, sessionId, {mode, metadata, traceId})` | `POST {base}/api/v1/request` | Fire-and-forget: body `{message, session_id, trace_id, mode:'auto'\|'force_local'\|'force_external'\|'force_orchestrated' (default 'auto'), metadata}`; `metadata.language` always injected from `localStorage['ekoa_language']` (default `'pt'`). Server replies `{trace_id, status:'accepted'}`; results arrive over SSE | connection.ts:362-394, :221-230 |
| `cancelRequest(traceId)` | `POST {base}/api/v1/request/cancel` | Body `{trace_id}` → `{cancelled: true}`. Server-side abort of the SDK query — unsubscribing SSE alone does NOT stop a run | connection.ts:402-421 |
| SSE subscribe | `GET {base}/api/v1/events?token=<JWT>` (`EventSource`) | Token in query string (EventSource cannot set headers). 31 named event types registered + `connected` (§21). No explicit `Last-Event-ID` handling client-side | connection.ts:127-191 |
| Reconnect | — | Exponential backoff `min(500×1.5^n, 15_000)` ms; `visibilitychange`/`online`/`focus` → immediate reconnect | connection.ts:200-210, :512-528 |
| `connect(base, token)` / `updateToken(token)` | — | Token → open SSE; no token → status `'connected'` for unauthenticated HTTP actions (login page). Token change → close + reopen SSE; null → disconnect | connection.ts:79-114 |
| Base URL resolution | — | Explicit host/port args win (dev); else `NEXT_PUBLIC_API_URL` verbatim (prod: cortex `api.ekoa.io` ≠ frontend `app.ekoa.io`); `''` = same-origin. Missing env throws loudly | connection.ts:455-507; client.ts:257-283 |
| `resolveApiUrl(path)` | — | Relative cortex path → absolute against API base (screenshot/static URLs) | connection.ts:545-548 |

### 0.2 `wsAction<T>` wrapper (`lib/api/client.ts:307-341`) — every action below goes through it

- Wraps `sendAction` into `ApiResponse<T> {success, data?, error?:{code:'API_ERROR', message}}`. The "ws" name is a WS-era vestige — it is pure HTTP (client.ts:303-307 comment).
- **Recipe-envelope unwrap**: a payload containing `recipe_id` → `{success, recipe_id, data, response_type}.data` is returned as `T` (client.ts:315-318). The rebuilt backend must preserve either the envelope or plain results consistently per intent.
- **Global auth rejection**: any error message containing `Unauthorized`/`Authentication failed` (but not `Not connected`/`timeout`) → `clearAuthToken()`, remove `localStorage['ekoa_auth']`, hard redirect to `/login` (client.ts:324-334).
- Timeout overrides: `ekoa.integration-builder/chat` 300 s (client.ts:676), `ekoa.integration-builder/test` 60 s (client.ts:718-723); default 120 s (connection.ts:36).

### 0.3 Streaming-necessity model (global)

| Class | Operations | Genuinely needs streaming? |
|---|---|---|
| Action protocol (`POST /api/v1/action`) | every `app/intent` in §1–§20 | **No.** Plain request-response. Map to REST endpoints 1:1 |
| AI chat turn (`POST /api/v1/request` + SSE) | chat mode, in-build classifier answers | **Yes** — progressive token stream (`stream` events), tool events, plan steps rendered live |
| Build jobs (`ekoa.execute/execute-job` + SSE) | builds | **Yes** — long-running (minutes); `tool_event`/`stream`/`plan_step`/`complete` drive live file tree, output panel, preview refresh |
| Automation runs (`ekoa.automations/run` + SSE) | runs, rehearsals | **Yes** — per-step live events, patches, pause/consent interrupts, stdout/stderr chunks |
| Brand research (`ekoa.branding/start-research` + SSE) | research job | **Partially** — UI only consumes `complete`/`error` for the trace plus a 3-min silence watchdog (settings/branding/page.tsx:551-591). Could be job-poll + terminal event; a progress stream is nice-to-have |
| Integration-builder chat (`action_stream` SSE) | builder text | **Yes (soft)** — incremental `builder_text` chunks improve a 300 s call; final result also returns in the action response, so degradable to request-response |
| Usage meter (`usage_updated`/`usage_progress` SSE) | billing gauge | **No** — server-push convenience; degradable to polling `get-usage`. `usage_progress` (provisional in-flight tokens) is cosmetic |
| Server-initiated chat routing (`build_intent`, `chat_answer`, `integration_build_intent`, `integration_ready`) | chat page | **Yes** — these are genuine server→client pushes tied to an in-flight run; no request is pending when they fire (e.g. `integration_ready` fires when the user saves an integration in the side panel, resuming a paused build) |
| Live browser view | pause-for-user canvas | **Yes, bidirectional** — WebSocket, JPEG frames down / mouse+keys up (§22). Cannot be SSE |
| Everything polled today (`crawl-status`, `session-status`, preview HEAD probe) | knowledge crawl, session capture, preview readiness | **No** — already client-side polling loops |

---

## 1. Auth (`ekoa.auth`)

| Operation | UI trigger | Inputs → Outputs | Side effects | Cites |
|---|---|---|---|---|
| `login` | `/login` form submit (button/Enter) | `{username, password, rememberMe (default true)}` → `{token, user: AuthUser, passwordChangeRequired, expiresIn}` | JWT stored in `localStorage['ekoa_token']`; SSE reopened with token. Pre-auth exempt server-side | login/page.tsx:144-154; stores/auth.ts:45-80; client.ts:363-378 |
| `change-password` | `/change-password` form submit (also forced-change flow) | `{currentPassword, newPassword}` (client renames from `oldPassword`) → `{message}` | clears `passwordChangeRequired` | change-password/page.tsx:203-229; stores/auth.ts:94-123; client.ts:380-388 |
| `get-me` | Dashboard layout mount (`checkAuth`) | `{}` → `AuthUser & {token?}` | **The only token-refresh path**: server may return a refreshed JWT when role/scopes drifted; store accepts it → `setAuthToken` + SSE reconnect (stores/auth.ts:139-150). Explicit `Unauthorized`/`expired` → full local logout; network errors keep auth state | (dashboard)/layout.tsx:63-67; stores/auth.ts:125-184; client.ts:390-392 |
| `create-user` | `/users` Add-user dialog (admin) | `{username, password (default `username.padEnd(6,'0')`), role:'admin'\|'builder'}` → `AuthUser` | created with `passwordChangeRequired:true` | users/page.tsx:514-530; stores/users.ts:58-79; client.ts:415-428 |
| `reset-password` | `/users` Reset-password dialog (admin) | `{userId, newPassword}` → `{message}` | — | users/page.tsx:563-570; stores/users.ts:103-120; client.ts:434-439 |
| `device-approve` | `/activate` Approve/Deny buttons (Ekoa Local TUI device login, `?code=` gated) | `{userCode, deny}` → `{ok}` | binds device to approving user | app/activate/page.tsx:60, :118, :125; client.ts:399-401 |
| (logout) | Header logout / change-password "log out instead" | **client-only** — clears token + localStorage, disconnects SSE. **No backend session-invalidation call exists; JWTs stay valid until expiry** | — | stores/auth.ts:82-92; header.tsx:102-105 |

Token carriage: `Authorization: Bearer` on `/api/v1/action`, `/api/v1/request`, `/api/v1/request/cancel`, `/api/v1/upload`, `/api/v1/knowledge/upload`, `/api/v1/artifacts/:id/download`; `?token=` query on SSE `/api/v1/events` and on `/apps/…` preview URLs for non-shareable artifacts (`appendAuthTokenToUrl`, client.ts:1102-1106 — cross-origin dev cannot share cookies). Post-login `?next=` to a cortex `/build/:slug` URL also appends `?token=` (login/page.tsx:63-74, origin-validated against `NEXT_PUBLIC_API_URL` at :48-61).

Auth-adjacent localStorage keys: `ekoa_token`, `ekoa_auth` (zustand persist: user/token/isAuthenticated/passwordChangeRequired, stores/auth.ts:199-204, rehydrate re-injects token → SSE reconnect :190-205), `ekoa_orchestration` (v4), `ekoa_language`/`ekoa_locale`, `ekoa_vertical` (stores/settings.ts:138).

## 2. Users (`ekoa.users`)

| Operation | UI trigger | Inputs → Outputs | Side effects | Cites |
|---|---|---|---|---|
| `list` | `/users` mount + retry | `{}` → `AuthUser[]` | — | users/page.tsx:490-494; stores/users.ts:38-56; client.ts:411-412 |
| `delete` | `/users` delete confirm | `{userId}` → void | — | users/page.tsx:541-550; stores/users.ts:81-101; client.ts:430-432 |

(User creation and password reset live on `ekoa.auth`, §1.)

## 3. Teams (`ekoa.teams`)

| Operation | UI trigger | Inputs → Outputs | Cites |
|---|---|---|---|
| `list` | `/users` mount | `{}` → `TeamWithMemberCount[]` (`Team {id,name,description?,canPublicRelease,createdAt,updatedAt}` + `memberCount`) | users/page.tsx:490-494; stores/teams.ts:32-50; client.ts:445-446 |
| `create` | `/users` Add-team dialog | `{name, description?, canPublicRelease?}` → `Team` | users/page.tsx:532-539; stores/teams.ts:52-73; client.ts:449-451 |
| `update` | (store action exists; no page caller found this sweep) | `{id, name?, description?, canPublicRelease?}` → `Team` | stores/teams.ts:75-96; client.ts:453-455 |
| `delete` | `/users` delete-team confirm | `{id}` → void | users/page.tsx:552-561; stores/teams.ts:98-117; client.ts:457-459 |

## 4. Company & Branding (`ekoa.company`, `ekoa.branding`)

| Operation | UI trigger | Inputs → Outputs | Side effects / notes | Cites |
|---|---|---|---|---|
| `ekoa.company/get` | `/settings/branding` mount + SSE-reconnect refetch; company store consumers | `{}` → `CompanyConfig {id,name,displayName,branding{primaryColor,secondaryColor,logo,favicon,designSystem,visualVibe,…},settings,createdAt,updatedAt}` | Design System tab renders `branding.designSystem/visualVibe` read-only | settings/branding/page.tsx:534-541, :998-1009; stores/company.ts:35-53; client.ts:465-466 |
| `ekoa.company/update` | (client + store action exist; no page caller found) | `{displayName?, branding?, settings?}` → `CompanyConfig` | — | stores/company.ts:55-72; client.ts:469-474 |
| `ekoa.branding/save-branding` | `/settings/branding` Save button (Branding tab); logo upload rides in payload as dataURL | `{branding, displayName?}` → `CompanyConfig` | **Deliberately routed here** because the legacy `ekoa.company/update-branding` recipe is read-only (client.ts:481-483 comment) | settings/branding/page.tsx:628-649, :614-621; stores/company.ts:74-91; client.ts:477-484 |
| `ekoa.branding/start-research` | `/settings/branding` "Start research" (button/Enter) | `{websiteUrl}` → `{jobId, traceId, status, websiteUrl}` | Kicks async research job; progress consumed via SSE filtered by `researchTraceId` (`complete` → refetch company; `error` → fail; 3-min silence watchdog fails UI). **Streaming: partial** (§0.3) | settings/branding/page.tsx:671-689, :551-591; client.ts:497-499 |

Brand logo render: `GET {apiBase}/brand-assets/{filename}` (no auth) — header.tsx:21,126.

## 5. Settings (`ekoa.settings`)

| Operation | UI trigger | Inputs → Outputs | Side effects / notes | Cites |
|---|---|---|---|---|
| `get` | Dashboard layout mount (when not loaded); `/settings/platform` mount | `{}` → `{general{platformName,language,timezone,vertical?:'generic'\|'legal'}, chat{defaultMode,autoOpenSidePanel,showExampleCards,enableContextDividers,guidedMode,guidance?:'guide-me'\|'standard'\|'just-build-it'}, build{showFileTreeByDefault}, integration{autoTestAfterCreation,defaultConfigExpanded}}` | store mirrors `general.vertical` to `localStorage['ekoa_vertical']` for pre-auth `/login` skin | (dashboard)/layout.tsx:70-74; settings/platform/page.tsx:362-364; stores/settings.ts:112-150; client.ts:753-755 |
| `update` | `/settings/platform` controls: platform name (500 ms field debounce), timezone, language toggle (also syncs i18n store), guided-mode switch, example-cards switch, guidance dial, Reset-all (direct `wsAction` with defaults); header language toggle; Pipedream enable/disable toggle | deep-partial of same shape → updated settings | Store debounces saves 800 ms (settings.ts:97-98,167-171). Pipedream toggle sends `{integration:{pipedreamEnabled}}` — **a field absent from the client.ts type signature** (record: type drift) | settings/platform/page.tsx:144-153, :172-191, :216-288, :303-323; header.tsx:96-100; stores/pipedream.ts:83-98; client.ts:757-764 |

Note: no `vertical` selector exists in the UI — vertical is only settable server-side today (settings/platform whole-file read; see Conflicts C4.3). No `previewMode` field exists anywhere (Conflicts C4.2).

## 6. Chat sessions (`ekoa.sessions`)

All wrapped by `stores/orchestration.ts`; consumed by the chat page, `SessionsPanel`, `MobileSessionsDrawer`, `OnboardingCard`.

| Operation | UI trigger | Inputs → Outputs | Side effects / notes | Cites |
|---|---|---|---|---|
| `create` | New-session button; `?continue=`/`?featured=` flows; onboarding card ("Começar/Retomar" → `type:'onboarding'`, idempotent server-side, no phantom fallback) | `{name?, type?, artifactInstanceId?, projectPath?}` → `{id, name, createdAt, updatedAt, type?, messageCount?}` | On server failure the generic path creates a local-only phantom session (orchestration.ts:589-630); onboarding path does NOT (onboarding-card.tsx:57-62) | sessions-panel.tsx:53-88; chat page :358, :415; onboarding-card.tsx:53-55; stores/orchestration.ts:589-680; client.ts:1025-1029 |
| `list` | Chat page mount (`initializeBuilderSession`), sessions panel | `{}` → `[{id,name,createdAt,updatedAt,messageCount?,type?}]` | — | chat page :272-282; stores/orchestration.ts:753-781, :1348; client.ts:1042-1044 |
| `get` | (client fn only; `getSessionWithMessages` with `includeMessages:true` has **no caller** — orphan §C2) | `{sessionId}` → session | — | client.ts:1031-1033, :1046-1048 |
| `update` | Rename (panel/drawer); auto-rename after first user message; `touchSession` (empty patch — server stamps `updatedAt`) | `{sessionId, …patch}` → session | — | sessions-panel.tsx:88; mobile-sessions-drawer.tsx:88; stores/orchestration.ts:744-751, :829, :1586; client.ts:1035-1040, :1057-1072 |
| `add-message` | Every chat turn (user + assistant persisted); `?reinterview=` seeding; SSE `chat_answer`/`integration_build_intent` status lines | `{sessionId, role, content, metadata?}` → message | Fire-and-forget after local append — local state is source of truth mid-session | chat page :486, :982; stores/orchestration.ts:819-824; client.ts:1050-1055 |
| `get-messages` | Session activation / messages safety net / `?continue=` recovery | `{sessionId}` → `[{id, role, content, timestamp, metadata?}]` | — | chat page :287-290, :390; stores/orchestration.ts:833-866; client.ts:1074-1076 |
| `delete` | Delete in panel/drawer; empty-session cleanup at boot (fire-and-forget) | `{sessionId}` → void | — | sessions-panel.tsx:72; mobile-sessions-drawer.tsx:72; stores/orchestration.ts:717-742, :509, :1510; client.ts:1078-1080 |

## 7. AI chat & agent execution (`POST /api/v1/request`, `ekoa.execute`, `ekoa.orchestrator`)

| Operation | UI trigger | Inputs → Outputs | Side effects | Streaming | Cites |
|---|---|---|---|---|---|
| `POST /api/v1/request` | Chat-mode send (`handleChatSend`); onboarding sends | `{message, session_id, trace_id, mode, metadata{language,…}}` → `{trace_id, status:'accepted'}` | Response streams over SSE per-trace (`stream`, `tool_event`, `skill_event`, `complete` — with optional `delegate` payload that triggers a build, `error`) | **Yes — genuine** | chat page :963-1149, :1006, :1017-1109; connection.ts:362-394 |
| `POST /api/v1/request/cancel` | Stop button (chat trace and in-build classifier trace — cancelled separately) | `{trace_id}` → `{cancelled}` | Server-side SDK abort | No | chat page :1381-1424 (:1392, :1401); connection.ts:402-421 |
| `ekoa.execute/execute-job` | First build message, build follow-up (bound artifact), chat-agent delegation, prompt-card build prompts, retry | `{agent, config:{description, templateId?, integrationKeys?, traceId (client-minted uuid), …artifactFieldValues, configValues?, attachments:[{attachmentId,displayName,path,type:'file'\|'folder',size?}] (url-type filtered client-side), artifactInstanceId? + projectDir? (follow-up reuse), project, sessionId, language}}` → `JobInfo {jobId, traceId, status, agent, project, streamUrl, createdAt, projectPath, artifactInstanceId?, templateFiles?}` **or** `{skipped:true, reason}` (in-build classifier decided it's a question; answer arrives as `chat_answer` SSE) | Starts a build; progress via SSE (per-trace) | **Yes — genuine** | chat page :648-704, :708-738, :534-561; hooks/useAgentExecution.ts:122-307 (skip :215-222); client.ts:770-780 |
| `ekoa.execute/get-job` | Mount re-sync of a running job; boot job-status sweep | `{jobId}` → `JobInfo` | — | No | useAgentExecution.ts:394; stores/orchestration.ts:1452; client.ts:782-784 |
| `ekoa.execute/cancel-job` | Stop button during a build | `{jobId}` → void | aborts build | No | useAgentExecution.ts:313-358; chat page :1384; client.ts:786-788 |
| `ekoa.orchestrator/seed-featured` | `?featured=<id>` chat entry (customize a featured artifact) | `{sessionId, featuredArtifactId}` → ok | Seeds session context from the featured artifact | No | chat page :404-431 (:421-424) |

SSE `build_intent` (origin-filtered by trace_id) routes chat-classified build requests into `execute-job`; `chat_answer` appends classifier answers (suppressed for cancelled traces); queue-while-building drains queued messages when `isExecuting` flips false (chat page :750-797, :807-831, :1273-1286).

## 8. Artifacts / templates (`ekoa.templates` — handler file is `artifacts-handler.ts`)

| Operation | UI trigger | Inputs → Outputs | Side effects / notes | Cites |
|---|---|---|---|---|
| `list-instances` | `/artifacts` mount; chat boot rehydration; `ChatStripes` empty state; `WebhooksSection` artifact picker | `{}` → `{instances[], featured[]}` (legacy flat-array shape also tolerated — chat-stripes.tsx:91-100, WebhooksSection.tsx:100-103) | fields consumed: `{id, slug?, status?, shareable?, updatedAt?, createdAt?, featuredRank?, data:{sessionId?, projectDir?, appUrl?}}` | artifacts/page.tsx:1609-1646; chat-stripes.tsx:88; stores/orchestration.ts:1350, :1668; client.ts:805-807 |
| `get-instance` | `?continue=<artifactId>` chat recovery | `{id}` → instance | — | chat page :337; client.ts:801-803 |
| `update-instance` | Inline rename; inline slug edit; share toggle (optimistic); `?continue=` re-link (`data:{sessionId,…}`) | `{id, name? \| slug? \| shareable? \| data?}` → instance | slug validated + persisted | artifacts/page.tsx:890-922, :776-804, :1960-1983; chat page :360-367 |
| `delete-instance` | `/artifacts` delete confirm | `{id}` → void | — | artifacts/page.tsx:1935-1958; client.ts:809-811 |
| `fork-instance` | Featured "Usar" cards (chat stripes + artifacts page) | `{sourceId, name?}` → `{id, slug?}` | Popup-blocker-safe: pre-opened tab pointed at `getAppUrl(fork.slug\|\|id)`, opener severed | lib/featured-fork.ts:35-56; chat-stripes.tsx:141-149; client.ts:822-824 |
| `set-featured` | admin featured toggling (client fn; artifacts page) | `{artifactInstanceId, featured, featuredRank?}` | — | client.ts:814-820 |
| `export-instance` | artifact export | `{id}` → bundle | — | client.ts:826-828 |
| `import-instance` | `/artifacts` Import-bundle file input (zip/JSON parsed client-side via `lib/artifact-bundle.ts` — fflate, no network) | `{bundle}` → instance | — | artifacts/page.tsx:1777-1830 (:1814); client.ts:830-832 |
| `update-from-bundle` | Import matched-existing "update in place"; per-artifact "Atualizar a partir de ficheiro" (non-force first; `ManifestIdMismatch` → force-confirm dialog → `force:true`) | `{id, bundle, force=false}` → updated instance + `{safetyNetSnapshotId, preUpdateVersionId}` | server snapshots before update | artifacts/page.tsx:1832-1854, :1877-1924; client.ts:839-845 |
| `update-featured-from-source` | Featured-update badge dialog "Atualizar" | `{id}` → ok | Consented featured sync; server safety-nets app-data + pre-update version first; no-op success for non-customized | artifacts/page.tsx:1714-1731; client.ts:853-855 |
| `ignore-featured-update` | Dialog "Manter a minha versão" | `{id}` → ok | dismisses update badge | artifacts/page.tsx:1734-1751; client.ts:858-860 |
| `versions-list` | Versions panel mount/refresh (artifacts detail, builder side-panel Versions tab, preview overlay) | `{artifactId, limit?}` → `{versions:[{sha,message,authorName,authorEmail,timestamp,buildFailed,isRestore}]}` | — | components/artifacts/versions-panel.tsx:52; client.ts:872-877 |
| `versions-restore` | Restore button (inline confirm) | `{artifactId, sha}` → `{newHeadSha}` | git restore; callers reload preview iframe (`onAfterRestore`) | versions-panel.tsx:75; client.ts:888-893 |
| `list-files` | Files-panel rehydration on session activation | `{artifactId}` → `{files:[{path,fullPath,action:'created'}], projectDir\|null}` (+ observed `instance{updatedAt?,status?}`) | — | stores/orchestration.ts:1605-1611; client.ts:883-885 |
| `read-file` | File click in side-panel tree → Monaco dialog open | `{filePath}` (sandbox-absolute) → file content string | raw `sendAction`, not `wsAction` | components/builder/file-editor-dialog.tsx:159; client.ts:1379-1396 |
| `write-file` | Monaco Save (button / Cmd-S) | `{filePath, content}` → `{path, size}` | server-side this is the commit-on-save path; callers refresh preview | file-editor-dialog.tsx:183; client.ts:1402-1407 |

Related raw HTTP: `GET {base}/api/v1/artifacts/{id}/download` with Bearer — "Download code (.zip)"; **422 = secret-guard block** surfaced specially (artifacts/page.tsx:1051-1084, :1057-1063). Featured screenshots: `GET {apiBase}/artifact-screenshots/…` via `resolveApiUrl` (artifacts/page.tsx:2298; horizontal-card-stripe.tsx:156).

## 9. Company space / serving (`ekoa.company-space`)

| Operation | UI trigger | Inputs → Outputs | Cites |
|---|---|---|---|
| `list` | (client fn; artifacts page consumers) | `{}` → entries | client.ts:1252-1254 |
| `start` | `/artifacts` "Start serving" | `{artifactId}` → `{status, url?, deploymentId?}` | artifacts/page.tsx:1985-2002; client.ts:1256-1260 |
| `stop` | `/artifacts` "Stop serving" | `{artifactId}` → void | artifacts/page.tsx:2004-2021; client.ts:1262-1266 |
| `get` | LogViewer mount (view logs) | `{id}` → deployment/log info | artifacts/page.tsx:292, :2522-2526 |

## 10. App-data backups (`ekoa.app-data-backups`) — "Dados e cópias de segurança" panel

| Operation | UI trigger | Inputs → Outputs | Side effects | Cites |
|---|---|---|---|---|
| `status` | Panel mount + manual refresh | `{appId}` → `BackupStatus {appId, lastBackupAt, automatic, pitrAvailable, restorePoints:[{id,at,kind,source:'local'\|'pitr'\|'gcs',label}]}` | — | data-backups-panel.tsx:47,58; client.ts:923-925 |
| `snapshot` | "Criar cópia agora" | `{appId}` → `BackupRestorePoint` | creates snapshot | data-backups-panel.tsx:69; client.ts:935-937 |
| `download` | "Descarregar os meus dados (JSON)" | `{appId}` → `AppDataDump {appId, exportedAt, collections: Record<string, object[]>, counts, totalItems}` | client-side Blob download | data-backups-panel.tsx:77; client.ts:927-929 |
| `preview` | "Pré-visualizar" per restore point | `{appId, pointId, source, at}` → `AppDataDump` | preview-before-restore modal | data-backups-panel.tsx:92; client.ts:931-933 |
| `restore` | "Restaurar" (after confirm) | `{appId, pointId, source, at}` → `{restored, cleared, safetyNetId}` | server takes automatic safety-net snapshot first | data-backups-panel.tsx:107; client.ts:1014-1019 |

## 11. Artifact backends (`ekoa.artifact-backend`) — Layer-2 backend panel

| Operation | UI trigger | Inputs → Outputs | Side effects | Cites |
|---|---|---|---|---|
| `status` | Panel mount per appId | `{id}` → `{hasBackend, status:{artifactId, state:'idle'\|'running'\|'crashed'\|'stopped'\|'disabled', live, enabled, pending, lastInvocationAt?, lastError?}, declared:{entryPoint, handlers[]}\|null}` | — | artifact-backend-panel.tsx:79; client.ts:994-996 |
| `logs` | Mount (if hasBackend) + refresh | `{id, limit:50}` → `{logs:[{level,msg,meta?,at}]}` | — | artifact-backend-panel.tsx:85; client.ts:998-1000 |
| `invocations` | Mount (if hasBackend) + refresh | `{id, limit:20}` → `{invocations:[{invokeId,entrypoint,startedAt,durationMs,ok,error?,dryRun,invokedBy,logs,dryRunEffects?}]}` | — | artifact-backend-panel.tsx:85; client.ts:1002-1004 |
| `set-enabled` | "Ativar/Desativar" | `{id, enabled}` → `{enabled}` | toggles backend; panel reloads | artifact-backend-panel.tsx:103; client.ts:1006-1008 |
| `run-sample` | "Executar simulação" (true dry-run) | `{id, entrypoint: declared.handlers[0], input:{sample:true, subject:'Exemplo'}}` → `{result:{ok, result?, error?, logs, dryRunEffects?[{capability}]}}` | dry-run result card per effect (appData.create/update/delete, notify.inApp/email) | artifact-backend-panel.tsx:113; client.ts:1010-1012 |

## 12. Integrations (`ekoa.integrations`)

| Operation | UI trigger | Inputs → Outputs | Side effects / notes | Cites |
|---|---|---|---|---|
| `list-skills` | `/integrations` mount (`fetchAll`); post-save refresh | `{}` → `IntegrationSkill[]` — raw `StoredIntegrationSkill` + `scope:'global'\|'user:<id>'`, `ownerUserId`, `webhookConfig{events[{name,labelPt}]}` | — | integrations/page.tsx:607-610; stores/integrations.ts:126-144; client.ts:505-506 |
| `list-configs` | mount (`fetchAll`) | `{}` → `[{id,integrationKey,enabled,configuredBy,configuredAt,lastTestedAt?,lastTestResult?}]` | — | stores/integrations.ts:146-164; client.ts:513-515 |
| `list-active` | mount (`fetchAll`); TriggerPicker mount | `{}` → `[{integrationKey,displayName,description,provider,category,actions}]` (+ `webhookEvents[]`/`listenerEvents[]` used by TriggerPicker) | — | trigger-picker.tsx:77; stores/integrations.ts:166-184; client.ts:509-511 |
| `create-config` | InlineCredentialForm save (new) | `{integrationKey, configValues: Record<string, string\|number\|boolean>}` → `{id,integrationKey,enabled,configuredAt}` | credentials encrypted server-side | integrations/page.tsx:696-711; stores/integrations.ts:216-238; client.ts:517-527 |
| `update-config` | Credential re-save; enable/disable toggle | `{integrationKey, enabled}` (or config values) → `{integrationKey, enabled}` | — | integrations/page.tsx:689-694; stores/integrations.ts:240-263; client.ts:529-534 |
| `delete-skill` | Delete on card / in IntegrationDialog (confirm) | `{integrationKey}` → void | — | integrations/page.tsx:713-726; integration-dialog.tsx:766; stores/integrations.ts:265-285; client.ts:551-555 |
| `refresh-registry` | (store action; page Refresh re-runs fetchAll) | `{}` → `{skillCount, skills: string[]}` | reload skills from disk | stores/integrations.ts:287-305; client.ts:557-562 |
| `session-status` | Card expand (lazy); SessionConnectPanel mount; 2 s poll while `waiting_login` (max ~7 min, module-scope timers) | `{integrationKey}` → `{integrationKey, sessionConnect{supported,available,loginUrl?,message}, session{status:'none'\|'waiting_login'\|'captured'\|'failed', capturedAt, message?}, actions[]}` | prod gating surfaces via `sessionConnect.available===false` + "connect from your local Ekoa first" message | SessionConnectPanel.tsx:51-55, :118-127; integrations/page.tsx:154-157; stores/integrations.ts:399-419, :527-574; client.ts:605-609 |
| `connect-session` | "Iniciar sessão"/"Renovar" (browser-session capture, e.g. CITIUS) | `{integrationKey}` → `{started, session{status:'waiting_login'\|'failed', message}}` | server opens real login browser; client starts status polling | SessionConnectPanel.tsx:59; stores/integrations.ts:421-458; client.ts:611-615 |
| `provision-automations` | "Provision automations" button | `{integrationKey}` → `{provisioned:true, created:[], updated:[], actions}` | creates/updates automations bound to integration actions | integrations/page.tsx:162-166; stores/integrations.ts:460-487; client.ts:617-621 |
| `grant-access` / `revoke-access` | **no caller — orphan (§C2)** | `{integrationKey,userId,allowedActions?}` / `{integrationKey,userId}` | — | client.ts:536-549 |

Import .json package: client-side parse → opens create dialog pre-filled (integrations/page.tsx:750-770). Export-all: loops `ekoa.integration-builder/load` per skill (page.tsx:772-794).

## 13. Integration builder (`ekoa.integration-builder`)

| Operation | UI trigger | Inputs → Outputs | Side effects | Streaming | Cites |
|---|---|---|---|---|---|
| `chat` (300 s timeout) | Integration side-panel auto-seed + each user message (`/chat` integrate mode); IntegrationDialog AI flow | `{message, sessionId?, language?}` → `{sessionId, generatedPackage: IntegrationBuilderOutput\|null, validationErrors[]}` | While in flight, incremental text arrives via SSE `action_stream` `{streamType:'builder_text', content}` | **Soft yes** (§0.3) | integration-build-panel.tsx:58; stores/integration-builder.ts:101-213 (:138-155); client.ts:667-677 |
| `load` | IntegrationDialog edit-mode open; export-all; test-bench pre-load | `{integrationKey}` → `{sessionId, generatedPackage, messages: BuilderChatMessage[], validationErrors}` | — | No | integration-dialog.tsx:680, :479; stores/integration-builder.ts:233-260; stores/integrations.ts:307-317; client.ts:679-689 |
| `save` | Side-panel Save (session variant); IntegrationDialog Save (direct `{generatedPackage}` variant, config includes `proxyContract {executeEndpoint:'/api/v1/integration/execute', requiredInputs:['integrationKey']}`) | `{sessionId, generatedPackage?, testCredentials?}` → `{integrationKey, displayName, saved, configured?}` | **Server emits `integration_ready` SSE**, which the chat page consumes to resume a paused build | push-after | integration-build-panel.tsx:128-132; integration-dialog.tsx:746, :740-743; stores/integration-builder.ts:262-295; client.ts:691-703, :727-735 |
| `test` (60 s timeout) | Testing tab "Run test" (args JSON-parsed per field) | `{sessionId, actionKey, testCredentials?, testInput?}` → `{actionKey, success, statusCode?, response?, error?}` | — | No | integration-dialog.tsx:492, :486-490; stores/integration-builder.ts:297-337; client.ts:705-724 |

`IntegrationBuilderOutput = {skillMd, config{version, skillType, integrationKey, displayName, description, authType, provider, category, configSchema: IntegrationConfigField[], actions: IntegrationAction[], credentialGuide?, proxyContract?}}` (client.ts:627-649).

## 14. Platform integrations (`ekoa.platform-integrations`) — Google Workspace / Microsoft 365 OAuth

Store calls `conn.sendAction` directly, bypassing `wsAction` (stores/integrations.ts:336-395).

| Operation | UI trigger | Inputs → Outputs | Side effects | Cites |
|---|---|---|---|---|
| `connect` | PlatformIntegrationCard "Connect" | `{provider:'google'\|'microsoft'}` → `{authUrl, state}` | Opens OAuth popup (500×700); **cortex callback page posts `window.postMessage {type:'oauth-callback', provider, success}`** back; popup-closed watchdog every 500 ms | PlatformIntegrationCard.tsx:105, :114-131, :141-153; stores/integrations.ts:336-344 |
| `status` | Post-callback refresh; `/integrations` mount (per provider) | `{provider}` → `{connected, email?, expiresAt?}` | store silently swallows failures | PlatformIntegrationCard.tsx:124; integrations/page.tsx:607-610; stores/integrations.ts:357-374 |
| `disconnect` | "Disconnect" (confirm) | `{provider}` → (ignored) | — | PlatformIntegrationCard.tsx:171; stores/integrations.ts:346-355 |
| `list` | BackendTriggerCard mount (mailbox provider dropdown); store `fetchAllPlatformStatuses` | `{}` → `{integrations:[{provider, connected, email?}]}` | maps provider→integrationKey `microsoft-365`/`google-workspace` | backend-trigger-card.tsx:46-48; stores/integrations.ts:376-395 |

OAuth completes at cortex `GET /api/v1/oauth/{google,microsoft}/callback` (server-rendered page that posts the message — implied by the popup contract).

## 15. Pipedream (`ekoa.pipedream`)

| Operation | UI trigger | Inputs → Outputs | Cites |
|---|---|---|---|
| `status` | PipedreamSection mount | `{}` → `{configured, enabled, accountCount}` | PipedreamSection.tsx:152-154; stores/pipedream.ts:66-74 |
| `list-accounts` | when configured+enabled | `{}` → `{accounts:[{id,app,name,healthy}]}` | PipedreamSection.tsx:160-162; stores/pipedream.ts:76-81 |
| `configure` | Save config form | `{clientId, clientSecret, projectId, environment:'development'\|'production'}` → `{id, configured}` | PipedreamSection.tsx:191; stores/pipedream.ts:100-115 |
| `remove-config` | Remove config (confirm) | `{}` → `{deleted}` | PipedreamSection.tsx:209; stores/pipedream.ts:117-128 |
| `connect-token` | "Connect app" | `{}` → `{token, connectLinkUrl, expiresAt}` → `window.open(connectLinkUrl)` (Pipedream Connect hosted flow) | PipedreamSection.tsx:219-221; stores/pipedream.ts:130-136 |
| `disconnect-account` | Disconnect account (confirm) | `{accountId}` → `{deleted}` | PipedreamSection.tsx:235; stores/pipedream.ts:138-145 |
| (enable toggle) | rides `ekoa.settings/update` `{integration:{pipedreamEnabled}}` — see §5 | | PipedreamSection.tsx:172-175; stores/pipedream.ts:83-98 |

## 16. Triggers / webhooks (`ekoa.triggers`)

Two distinct target shapes hit the same `create` intent — the **`target` discriminator must be preserved** (automation-target vs artifact-backend-target).

| Operation | UI trigger | Inputs → Outputs | Side effects / notes | Cites |
|---|---|---|---|---|
| `list` | WebhooksSection mount; BackendTriggerCard mount (client-filtered to `target.kind==='artifact-backend' && artifactId===this`) | `{}` → redacted `[{id,integrationKey,eventName,kind:'webhook'\|'listener',target?{kind?,artifactId?,entrypoint?},artifactId?,automationId?,registrationState?,disabled?,createdAt?,updatedAt?}]` | **Secret redacted, no public URL returned** — store filters to `kind==='webhook'` and drops the internal `self-test-hooks` boot probe | WebhooksSection.tsx:89-91; backend-trigger-card.tsx:49; stores/webhooks.ts:74-88 (:78-80) |
| `create` (automation target) | TriggerPicker "Criar" on `/automations/[id]` | `{automationId, integrationKey, eventName, artifactId?}` → `{trigger{id, kind, registrationState:'auto'\|'manual'\|'pending'\|'failed'}, publicUrl, secret?, registrationError?}` | `secret` returned once → manual-setup block (callback URL + masked secret, reveal/copy); registrationError → warning | trigger-picker.tsx:102, :288-334 |
| `create` (artifact-backend target) | BackendTriggerCard "Ligar caixa de correio" (hard-codes `eventName:'email.received'`); WebhooksSection create dialog | `{integrationKey, eventName, target:{kind:'artifact-backend', artifactId, entrypoint}}` → `{trigger, publicUrl?}` | wires mailbox/webhook to an artifact-backend handler | backend-trigger-card.tsx:90-94; WebhooksSection.tsx:233; stores/webhooks.ts:90-109 |
| `delete` | "Desligar"/"Remover"/table delete (confirm) | `{id}` → `{deleted}` | — | backend-trigger-card.tsx:102; trigger-picker.tsx:132; WebhooksSection.tsx:126; stores/webhooks.ts:111-121 |
| `list-for-automation` | `/automations/[id]` mount (trigger row) | `{automationId}` → trigger rows | — | automations/[id]/page.tsx:71-77 (:74) |

**Webhook callback URL is client-reconstructed** as `{getApiBaseUrl()}/hooks/{triggerId}` because `list` redacts publicUrl (stores/webhooks.ts:58-66; WebhooksSection.tsx:173) — the rebuilt backend must either return `publicUrl` from `list` or keep webhook ingress at `POST /hooks/:triggerId` on the API origin.

## 17. Automations (`ekoa.automations`)

| Operation | UI trigger | Inputs → Outputs | Side effects | Streaming | Cites |
|---|---|---|---|---|---|
| `list` | `/automations` mount | `{}` → `{automations: Automation[]}` | — | No | automations/page.tsx:27-29; stores/automations.ts:163-171; client.ts:1437-1439 |
| `get` | Editor mount; refetch after rehearsal leaves `running`; refetch after mid-rehearsal patch | `{id}` → `{automation}` | — | No | automations/[id]/page.tsx:91-93, :104-112, :120-136; client.ts:1441-1443 |
| `create` | (client/store fn; editor flows use plan-from-goal) | `{name, description?, steps?, inputSchema?{fields[]}, id?}` → `{automation}` | — | No | stores/automations.ts:184-193; client.ts:1445-1453 |
| `update` | Editor Save (name/description/steps) | `{id, name?\|description?\|steps?\|inputSchema?}` → `{automation}` | — | No | automations/[id]/page.tsx:172-176; client.ts:1455-1460 |
| `delete` | List + editor delete (confirm) | `{id}` → `{deleted}` | — | No | automations/page.tsx:100-103; automations/[id]/page.tsx:226-231; client.ts:1462-1464 |
| `plan-from-goal` | `/automations/new` "Draft steps"; editor "Regenerate from goal" (with `automationId` = in-place) | `{goal, name?, automationId?}` → `{plan:{status:'ok', name, description, inputSchema?, steps, reasoning} \| {status:'awaiting_integration', service, reason}, automation?, traceId?, rehearsing?}` | **Backend persists the automation AND kicks a rehearsal run**; store pre-arms `activeRun{status:'running', kind:'rehearsal'}`; `awaiting` → connect-integration card | rehearsal streams | automations/new/page.tsx:45-60 (:49); automations/[id]/page.tsx:178-188 (:183); stores/automations.ts:222-249; client.ts:1466-1481 |
| `run` | RunViewer "Executar/Repetir" (after optional input form merging `inputSchema.fields` defaults) | `{id, inputs (default {}), traceId?}` → `{traceId, accepted}` | run executes async; live steps over SSE | **Yes — genuine** | run-viewer.tsx:77; stores/automations.ts:251-265; client.ts:1483-1493 |
| `cancel-run` | Stop buttons (run viewer, pause banner, global overlay, activity bar) | `{traceId}` → `{cancelled}` | status→cancelled | No | run-viewer.tsx:174,283; pause-for-user-overlay.tsx:146-148; stores/automations.ts:267-275; client.ts:1499-1501 |
| `resume-run` | "Continuar" (pause banner, global overlay, activity bar) | `{traceId}` → `{resumed}` | optimistic pauseRequest clear; engine emits `automation_run_resumed` | No | run-viewer.tsx:282; pause-for-user-overlay.tsx:157,53; stores/automations.ts:277-290; client.ts:1495-1497 |
| `list-runs` | RunHistory mount / automationId change | `{automationId?, limit:50}` → `{runs: RunRecord[]}` | — | No | run-history.tsx:28-30; stores/automations.ts:495-503; client.ts:1503-1511 |
| `get-run` | run history detail | `{automationId, runId}` → `{run}` | — | No | stores/automations.ts:505-509; client.ts:1513-1518 |
| `submit-step-feedback` | Thumbs up/down/correction per step in run viewer | `{automationId, runId, stepId, kind:'thumbs_up'\|'thumbs_down'\|'correction', note?}` → `{ok, evicted?{actionsRemoved,assertionsRemoved}}` | may evict cached actions/assertions | No | run-viewer.tsx:399-405, :425, :433; stores/automations.ts:511-518; client.ts:1520-1528 |
| `list-catalog` | Step-form pickers mount (integration-action / sub-automation dropdowns) | `{}` → `{automations: CatalogEntry[], integrationActions: CatalogEntry[]}` | — | No | integration-action-picker.tsx:23-27; sub-automation-picker.tsx:24-28; stores/automations.ts:520-528; client.ts:1530-1534 |
| `resolve-consent` | ConsentDialog decision (once/always/stop) for local-command approval | `{traceId, decision:'once'\|'always'\|'stop', shape}` → `{resumed?, stopped?, decision?}` | 'always' persists the command shape | No | run-viewer.tsx:260-264; consent-dialog.tsx:10,18; client.ts:1536-1542 |
| `list-approved-commands` | `/settings/bridge` mount + refresh | `{}` → `{approved:[{shape,approvedAt,lastUsedAt?,note?}]}` | — | No | settings/bridge/page.tsx:30-32 (:16); client.ts:1551-1553 |
| `revoke-approved-command` | `/settings/bridge` revoke | `{shape}` → `{revoked, remaining}` | — | No | settings/bridge/page.tsx:34-42 (:37); client.ts:1555-1557 |

Run screenshots: `GET {apiBase}/automation-screenshots/…` (static; run-viewer.tsx:369,376,543,550; pause-for-user-overlay.tsx:62-64). Live-run SSE events are consumed via the layout-mounted `useAutomationRun` hook (§21); the run status machine is `idle→running→completed/failed/cancelled/awaiting_integration/paused_for_user/awaiting_consent/awaiting_daemon` with traceId hydration from the first event after reload (stores/automations.ts:292-477, :297-305).

## 18. Memory (`ekoa.memory`)

| Operation | UI trigger | Inputs → Outputs | Cites |
|---|---|---|---|
| `list` | `/memory` mount + retry + filters/tags/pagination; guardrails tab | `{type?, scope?, visibility?, tags? (comma-joined), search?, page?, limit?, sortBy?, sortOrder?}` → `{memories[], total, totalPages, page}` | memory/page.tsx:659-663, :720-727; stores/memory.ts:118-157; client.ts:1317-1319 |
| `get` | **no caller — orphan (§C2)** | `{id}` → memory | client.ts:1321-1323 |
| `create` | Add-memory dialog; guardrail create (`{type:'preference', tier:'core', tags:['guardrail']}`) | `{type, title, content, tags?, visibility?, scope?}` → memory | memory/page.tsx:675-680; guardrails.tsx:35-41; stores/memory.ts:193-214; client.ts:1325-1334 |
| `update` | Edit dialog; verify toggle (`{verified}`); tier change (`{tier:'core'\|'active'\|'archive'}`); core-tier promote/demote | `{id, title?, content?, type?, tags?, visibility?, scope?, verified?, tier?}` → memory | memory/page.tsx:682-688, :712-718; core-tier.tsx:58,63; stores/memory.ts:219-239, :308-326; client.ts:1336-1350 |
| `delete` | Delete one (confirm); guardrail delete | `{id}` → void | memory/page.tsx:690-699; stores/memory.ts:244-271; client.ts:1352-1354 |
| `bulk-delete` | Bulk delete (confirm) | `{ids: string[]}` → ok | memory/page.tsx:701-710; stores/memory.ts:276-303; client.ts:1356-1358 |
| `submit-signal` | Thumbs up/down on an assistant chat message | `{traceId, signal:'positive'\|'negative'}` → `{affectedMemories, adjustedScores}` (silent fail; button locks) | chat-panel.tsx:843; client.ts:1360-1365 |
| `list-tags` | `/memory` mount | `{}` → `{tags:[{tag,count}]}` (store tolerates bare array too, memory.ts:183) | stores/memory.ts:179-188; client.ts:1367-1369 |
| `stats` | `/memory` mount | `{}` → stats object | stores/memory.ts:162-174; client.ts:1371-1373 |

Note: `memory-settings.tsx` renders auto-extract/consolidation switches that are **wired to nothing** — display-only mock (Conflicts C4.5).

## 19. Knowledge (`ekoa.knowledge`)

No human search box by design — the `/knowledge` UI browses/manages only (knowledge/page.tsx:3-12 header comment). Intent names verified against `stores/knowledge.ts` (see Conflicts C6.1).

| Operation | UI trigger | Inputs → Outputs | Cites |
|---|---|---|---|
| `list-collections` | `/knowledge` mount; refetch after ingest/delete/unindex | `{}` → `{collections: string[]}` | knowledge/page.tsx:79-82; stores/knowledge.ts:231 |
| `list` | mount, collection filter chips, pagination Anterior/Próximo | `{offset, limit:20, collection?}` → `{docs: KnowledgeDocSummary[], total}` (filesystem browse, NOT search) | knowledge/page.tsx:79-82, :165-181, :263, :275; stores/knowledge.ts:244-277 (:255) |
| `ingest` | Documents tab paste-text form | `{collection, title, text, sourceUrl?, sourceType?, language?}` → ok | documents-tab.tsx:77; stores/knowledge.ts:282-301 (:285) |
| `delete` | Delete doc button | `{collection, id}` → `{deleted}` | knowledge/page.tsx:84-91; stores/knowledge.ts:306-327 (:309) |
| `list-sources` | Sources tab mount; refetch after crawl finishes | `{}` → `{sources: KnowledgeSource[]}` (`{id,label,url,collection,levels,maxPages,scope,enabled,render?,userAgent?,seeds?,seedTemplate?{url,from,to,step?},seedId?,lastCrawledAt?,lastRefreshAt?,lastResult?,createdAt,updatedAt}`) | sources-tab.tsx:107-108; stores/knowledge.ts:342-357 |
| `add-source` | Add-source form | `SourceInput {label?,url,collection,levels?,maxPages?,scope?,enabled?,render?,userAgent?,seeds?,seedTemplate?\|null}` → source | sources-tab.tsx:212-213; stores/knowledge.ts:359-375 |
| `update-source` | Edit form; enabled toggle | `{id, …SourceInput}` (`seedTemplate:null` clears) → source | sources-tab.tsx:212-213, :236; stores/knowledge.ts:377-393 |
| `delete-source` | Delete source | `{id}` → `{deleted}` | sources-tab.tsx:227; stores/knowledge.ts:395-411 |
| `crawl-source` | "Atualizar agora" | `{id}` → `{started, alreadyRunning}` | sources-tab.tsx:158; stores/knowledge.ts:413-432 (:418) |
| `crawl-status` | Poll while crawling (client-side loop; on finish → refetch sources) | `{id}` → `{running, progress: CrawlProgress\|null, stats: CrawlStats\|null}` | sources-tab.tsx:92,120; stores/knowledge.ts:434-452 (:438) |
| `refresh-schedule` | Sources tab mount (read-only schedule display) | `{}` → `{schedule:{enabled,hour,nextRunAt}}` | sources-tab.tsx:107-108; stores/knowledge.ts:454-463 |
| `list-uploads` | Documents tab mount | `{}` → `{uploads: UploadDoc[]}` (`{id,filename,mimeType,collection,bytes,docIds,chunkCount,charCount,status:'indexed'\|'stored',extractKind,uploadedAt,uploadedBy}`) | documents-tab.tsx:65; stores/knowledge.ts:468-483 (:471) |
| `unindex-document` | Remove uploaded document | `{id}` → `{removed, docsRemoved}` (also refetches collections + docs) | documents-tab.tsx:128; stores/knowledge.ts:524-546 (:529) |
| `POST /api/v1/knowledge/upload` (raw HTTP) | Documents tab file upload | raw `File` body; headers Bearer, `Content-Type`, `x-filename` (URI-encoded), `x-collection` → 2xx (then refetch uploads/collections/docs); non-2xx JSON `{error}` | documents-tab.tsx:106; stores/knowledge.ts:485-522 (:490) |

Backend handler's full intent map (`cortex/src/handlers/knowledge-handler.ts:81-106`) additionally exposes `read`, `search`, `crawl-cancel`, `refresh-all`, `reindex`, `index-status` — **no frontend caller** (§C3). `search`/`read` are consumed by agents via the `ekoa-knowledge` MCP tools, not the UI.

## 20. Billing (`ekoa.billing`)

| Operation | UI trigger | Inputs → Outputs | Cites |
|---|---|---|---|
| `get-usage` | Header mount; SSE `usage_updated` refetch | `{}` → `BillingUsage {tokensUsed, tokensBase, tokensRemaining, effectiveTotal, usagePercentage, creditBalanceUsd, creditTokens, overageEnabled, globalOverageEnabled, currentPeriodStart, periodResetDate, gaugeColor:'green'\|'amber'\|'red', showWarning, isAdmin}` — also resets `inflightDelta` | header.tsx:66,73; stores/billing.ts:111-119 |
| `get-history` | (store action; billing history UI) | `{page, limit:10}` → `{entries:[{date,tokens,costUsd}], total, page, limit, totalPages}` | stores/billing.ts:121-129 |
| `get-breakdown` | `/usage` mount (super-admin) | `{}` → `{breakdown:[{agentType,tokens,percentage}]}` | usage/page.tsx:67-72; stores/billing.ts:131-139 (:133) |
| `purchase-credits` | (store action; billing settings surface) | `{amountUsd}` → `{success, newBalance}` | stores/billing.ts:141-149 |
| `toggle-overage` | (store action) | `{enabled}` → `{overageEnabled}` | stores/billing.ts:151-159 |
| `admin-global-overage` | (store action, admin) | `{enabled}` → `{globalOverageEnabled}` | stores/billing.ts:161-169 |
| `admin-list-usage` | `/users` mount (admin); `/usage` mount (super-admin) | `{}` → `{rows:[{userId,username,role,isActive,tokensUsed,tokensBase,tokensRemaining,tokenLimit\|null,isCustomLimit,percentage,currentPeriodStart,lastLoginAt}]}` | users/page.tsx:490-494; usage/page.tsx:67-72; stores/billing.ts:175-183 (:177) |
| `admin-reset-usage` | `/users` reset-usage confirm; `/usage` per-user reset | `{userId}` → `{userId, tokensUsed}` | users/page.tsx:572-579; usage/page.tsx:82-96; stores/billing.ts:185-192 (:186) |
| `admin-set-limit` | `/users` set-token-limit dialog (submit / reset-to-default `null`) | `{userId, tokenLimit\|null}` → `{userId, tokenLimit}` | users/page.tsx:581-586, :340-451; stores/billing.ts:194-205 (:197) |

Streaming meter: `usage_progress` SSE carries `{provisionalDelta}` (cumulative per-call; `Math.max` keeps monotonic) → provisional gauge ticking; reset by `usage_updated`/`fetchUsage` (header.tsx:76-79; stores/billing.ts:207-216). **Not genuinely streaming** — degradable to polling.

## 21. SSE event inventory (`GET /api/v1/events?token=<JWT>`)

Registered named listeners (connection.ts:151-170 + `connected` at :140): `routing, stream, tool_event, skill_event, plan_step, complete, error, action_stream, action_complete, action_error, auth_result, file_data, action_result, automation_run_step, automation_run_complete, automation_run_error, automation_run_paused, automation_run_patch, automation_run_pause_for_user, automation_run_resumed, automation_run_streaming_available, automation_run_awaiting_consent, automation_run_awaiting_daemon, automation_step_output_chunk, preview_reload, build_intent, integration_build_intent, integration_ready, usage_updated, usage_progress, chat_answer`.

`onStream` fan-out subset (connection.ts:251-262): routing, stream, tool_event, skill_event, plan_step, complete, error, action_stream, action_complete, action_error, all 10 `automation_run_*` + `automation_step_output_chunk`, chat_answer, integration_build_intent, integration_ready. **NOT in fan-out** (typed `conn.on()` only): preview_reload, build_intent, usage_updated, usage_progress, auth_result, file_data, action_result, connected. Special handling: `auth_result` caches `{id, role, scopes}` (connection.ts:242-248); wildcard `'*'` supported (:278-283).

| Event | Payload (as consumed) | Consumer | Purpose | Genuine push? |
|---|---|---|---|---|
| `connected` | skills/apps list | connection status; useJobStream.ts:634 | connection ack | yes |
| `routing` | `{decision{path,confidence,reason}}` | useJobStream.ts:246-261 | routing badge in output | part of run stream |
| `stream` | `{content}` chunk | useJobStream.ts:263-285; chat page onStream | progressive assistant text (rAF-batched) | **yes** |
| `tool_event` | `{event:'tool_called'\|'tool_started'\|'tool_finished'\|'tool_failed', tool, args, result, is_error, duration_ms}` | useJobStream.ts:288-373 | output entries; file-tree extraction from Write/Edit/Delete inputs (:149-175); activity messages | **yes** |
| `skill_event` | `{skill, action:'invoked'\|'used'}` | useJobStream.ts:421-450 | output/activity | part of run stream |
| `plan_step` | `{status, detail?, description?}` | useJobStream.ts:452-485 | phase transitions/status messages | part of run stream |
| `complete` | `{duration_ms, result, artifactInstanceId?, slug?}` (+ `delegate` on chat traces) | useJobStream.ts:505-561; chat page :1060-1075; branding page :551-591 | job done; preview refresh to slug URL; delegation | terminal event |
| `error` | `{error}` (client-scrubbed via lib/sanitize-error.ts) | useJobStream.ts:563-588 | job failed | terminal event |
| `action_stream` | `{streamType:'builder_text', content}` | stores/integration-builder.ts:138-155 | incremental builder chat text | soft |
| `automation_run_step` | `{trace_id, runId, stepIndex, …}` | hooks/useAutomationRun.ts:19-35 → stores/automations.ts:292-477 | live step timeline | **yes** |
| `automation_run_complete` / `_error` / `_paused` / `_patch` / `_pause_for_user` / `_resumed` / `_streaming_available` / `_awaiting_consent` / `_awaiting_daemon` | `{summary}` / `{error}` / `{service}` / patch / `{stepIndex, reasoning, userInstructions, failureMessage?, screenshotUrl?}` / — / `{token, wsUrl, viewport}` / `{stepIndex, shape, argv, description}` / `{stepIndex, capability:'browser'\|'bash', reason}` | same hook/store | run status machine + interactive interrupts (consent dialog, pause overlay, live canvas handoff) | **yes** |
| `automation_step_output_chunk` | `{stepIndex, stream:'stdout'\|'stderr', chunk}` | same | live command output | **yes** |
| `usage_updated` | (none used) | header.tsx:73 | refetch `get-usage` | no (poll-able) |
| `usage_progress` | `{provisionalDelta}` | header.tsx:76-79 | provisional gauge | no (cosmetic) |
| `build_intent` | trace-filtered build routing | chat page :750-797 | chat→build handoff | **yes** |
| `chat_answer` | classifier answer | chat page :807-831 | in-build Q&A | **yes** |
| `integration_build_intent` | — | chat page :839-859 | flip side panel to integration builder | **yes** |
| `integration_ready` | — | chat page :896-919 | resume paused build after integration save | **yes** |
| `preview_reload` | — | **unreachable** (§C5.2) | hot-reload preview bump | dead |
| `auth_result`, `file_data`, `action_result`, `action_complete`, `action_error` | — | **no consumer** (§C5.4) except auth_result internal caching | — | dead-ish |

## 22. WebSocket — live browser view (pause-for-user canvas)

The only WebSocket in the product. URL + short-TTL token + viewport arrive in the `automation_run_streaming_available` SSE payload.

| Aspect | Detail | Cite |
|---|---|---|
| Connect | `new WebSocket(session.wsUrl + '?token=' + session.token)` — cortex streaming server (`cortex/src/streaming/`) | pause-for-user-canvas.tsx:75-81 |
| Client→server frames | `{type:'ping', t}` every 25 s; `{type:'frame_ack', seq}`; `{type:'mouse', x, y, button:'left'\|'middle'\|'right', action:'down'\|'up'\|'move'\|'wheel', deltaX?, deltaY?, modifiers}` (touch mapped to mouse); `{type:'key', code, key, action:'down'\|'up', modifiers}` | :97, :220, :300-323, :349, :328 |
| Server→client frames | `{type:'frame', seq, jpegBase64}`, `{type:'viewport', width, height}`, `{type:'error', code, message}`, `{type:'pong', t}` | :23-46 |
| Reconnect | backoff 750 ms×2ⁿ, max 5 → `failed`. Close codes 1000 (normal) and **4000 = cortex takeover** (newer connection evicts older) do NOT reconnect — protocol contract encoded client-side, must be preserved | :123-151, :136 |
| Rendering | ImageBitmap + rAF paint, late frames dropped | — |

**Genuinely needs bidirectional streaming** — interactive remote browser control.

## 23. Raw HTTP endpoints (outside the action protocol)

| Method + path | Auth | Body/headers → Result | UI trigger | Cites |
|---|---|---|---|---|
| `POST /api/v1/upload` | Bearer | raw `ArrayBuffer`; `Content-Type: application/octet-stream`, `X-Filename`, optional `X-Folder` → `{path, displayName, size, folderRoot?}` (absolute server-side staging path) | chat composer attach file/folder/screen-capture (`pickFiles`/`pickFolder`/`captureScreen`; folders staged recursively preserving structure; URL attachments never upload) | lib/file-picker.ts:17-40, :97-118, :125-175, :191-232, :182-189; chat-panel.tsx:332-341; chat page :609-627 |
| `POST /api/v1/knowledge/upload` | Bearer | raw `File`; `x-filename`, `x-collection` → 2xx | knowledge Documents tab upload | stores/knowledge.ts:485-522 |
| `POST /api/v1/request` / `POST /api/v1/request/cancel` | Bearer | §0.1 | chat send / stop | connection.ts:362-421 |
| `GET /api/v1/events?token=` | token query | SSE stream | connection lifecycle | connection.ts:127-191 |
| `GET /api/v1/artifacts/{id}/download` | Bearer | → .zip; **422 = secret-guard block** | artifacts detail "Download code" | artifacts/page.tsx:1051-1084 |
| `GET /api/demos` / `GET /api/demos/{appId}` / `GET /api/demos/assets/{image}` | **none** | → `{demos: DemoCard[]}` / `DemoSpec` / image | DemoTourProvider mount / `?demo=<appId>` / overlay image steps | DemoTourProvider.tsx:51, :84; DemoOverlay.tsx:49 |
| `GET /brand-assets/{filename}` | none | image | header logo | header.tsx:21,126 |
| `GET /automation-screenshots/…` | static | PNG | run viewer / pause overlay | run-viewer.tsx:369-376; pause-for-user-overlay.tsx:62-64 |
| `GET /artifact-screenshots/…` | static | PNG | artifact/featured card thumbnails | artifacts/page.tsx:2298; horizontal-card-stripe.tsx:156 |
| `GET /apps/{idOrSlug}/` (navigation/iframe) | optional `?token=` for non-shareable | static served app | Run/Open, preview iframe, fork navigation, demo tours; preview readiness = `HEAD` poll loop; iframe auto-retry | client.ts:1090-1106; side-panel.tsx:131-149, :285, :240-261, :312-351; artifact-preview-overlay.tsx:61-64 |
| `GET /build/:slug` (cortex-rendered) | `?token=` appended | share/continue link | login `?next=` resume; "Copy build link" | login/page.tsx:63-74; artifacts/page.tsx:1763-1775 |
| `POST /hooks/{triggerId}` | webhook secret | external webhook ingress (URL only constructed client-side, never fetched) | callback URL shown to user | stores/webhooks.ts:58-66 |
| `GET /__ekoa/demo-bridge.js` | none | injected demo bridge inside served apps | demo tours (postMessage machine) | lib/demo/*; DemoTourProvider.tsx:92-106 |

## 24. Served-app surface (window.__ekoa) — legal vertical & featured apps

**There are NO legal-specific Next.js routes** (verified: no `legal*` dir under `ekoa/app/`). The legal vertical is (a) a pure presentation profile (`lib/verticals/legal.ts:3-7` — copy/ordering only: chat chips, login tagline, `startingPointsFirst: slug.startsWith('legal-')` at legal.ts:38; resolution order settings store → `ekoa_vertical` localStorage → `NEXT_PUBLIC_EKOA_VERTICAL` → generic) and (b) 29 `legal-*` served apps from `ekoa-data/featured-artifacts/` (29 legal + 12 non-legal = 41 featured dirs total; count verified by `ls ekoa-data/featured-artifacts`), reached via `/artifacts` Starting Points or chat stripes fork. Their backend endpoints (cortex-origin, called from inside the served apps via the platform-injected handle — canonical client-side surface: `injectAppContext`, `cortex/src/server.ts:2932` with the `window.__ekoa` handle members through :3141) are part of the rebuild surface:

| Endpoint | Used by | Purpose |
|---|---|---|
| `/api/app-shared/:collection[/:id]` (CRUD via `window.__ekoa.shared.{list,get,create,update,delete}`) | all 29 legal apps (shared layer `frontend/src/shared.js`, canonical copy in `legal-nucleo`, synced by `scripts/sync-legal-shared.mjs`) | owner-scoped shared "spine": processos, prazos, eventos, clientes + phase-2 collections (envelopes, assinaturas, calculos, tabelas_taxas, transcricoes, excertos, injuncoes, rcbe_entidades, rcbe_obrigacoes, beneficiarios_efetivos, …) — `legal-nucleo/scaffold/frontend/src/shared.js:38-42` |
| `/api/app-data/:collection[/:id]` (via `window.__ekoa.fetch`) | all served apps | per-user app data |
| `POST /api/legal/calculos` | all legal apps (`calculos-cliente.js` synced into each) | deterministic legal calculators |
| `POST /api/signature/send` | legal-assinatura | signature provider (Adobe active) |
| `GET /api/tracking/consulta` | legal-correio | CTT parcel tracking |
| `GET /api/legal-research` | legal-pesquisa | DGSI/DRE lexical search |
| `POST /api/app-sso/login` (cortex/src/server.ts:1196), `POST /api/app-sso/set-password` (:1239) | legal-portal | end-user password login inside served apps (per-app session cookie, `Path=/api/app-sso`) |
| `GET /api/app-sso/microsoft/start` (cortex/src/server.ts:941) + `GET /api/app-sso/microsoft/callback` (:999) | backs `__ekoa.signIn` (server.ts:3025); caller: legal-dossie `DocumentosTab.jsx:533` | end-user Microsoft SSO redirect flow inside served apps |
| `GET /api/app-sso/me` (cortex/src/server.ts:1092) | backs `__ekoa.whoami` (server.ts:3033); callers: legal-portal `portal.js:115-119` + `cliente/ClientePage.jsx:494` | current end-user identity from the per-app session cookie |
| `POST /api/app-sso/logout` (cortex/src/server.ts:1130) | backs `__ekoa.signOut` (server.ts:3039); callers: legal-portal `portal.js:133-137` + `cliente/ClientePage.jsx:76,81` | end app-user session |
| `ALL /api/app-sso/m365/*` (raw-body claim cortex/src/server.ts:132; route :1824) | backs `__ekoa.graphFetch` (server.ts:3048); caller: legal-dossie `DocumentosTab.jsx:394,429` | raw end-user Microsoft Graph proxy (acts AS the signed-in visitor; silent token refresh) |
| `POST /api/app-files` (cortex/src/routes/app-files.ts:46), `GET /api/app-files/:appId/:id` (:87), `DELETE /api/app-files/:appId/:id` (:110) | backs `__ekoa.uploadFile`/`__ekoa.deleteFile` (server.ts:3004-3023); callers incl. legal-kyc `FichaDetailPage.jsx`, legal-assinatura `NovoEnvelopePage.jsx`, legal-transcricao `TranscricoesPage.jsx:81-82`, legal-forms `PreencherPage.jsx`, legal-pecas `EditorPage.jsx`, legal-correio `ExpedientePage.jsx`, legal-contratos `GerarWizardPage.jsx`, legal-portal `cliente/ClientePage.jsx`, legal-dossie `DocumentosTab.jsx` | per-app file upload/serve/delete (raw bytes in body, metadata via headers; `~/.ekoa/data/app-data/{appId}/files/`) |
| `POST /api/app-pdf` (cortex/src/server.ts:290) | backs `__ekoa.exportPdf` (server.ts:3079); live caller: document base scaffold `ekoa-data/bases/document/scaffold/frontend/src/App.jsx:189` (grep found NO `legal-*` featured caller; API documented for coding agent in `ekoa-data/plugins/skills/coding-agent/SKILL.md:387-392`) | server-rendered PDF export of app content |
| `GET /api/app-cloud-files/status` (cortex/src/routes/app-cloud-files.ts:54), `POST /api/app-cloud-files/:provider/upload` (:66), `GET /api/app-cloud-files/:provider/list` (:102), `GET /api/app-cloud-files/:provider/download` (:120) (raw-body claim server.ts:121; registered server.ts:2448) | backs `__ekoa.cloudFiles.{status,upload,list,download}` (server.ts:3104-3139); live caller: document base scaffold `App.jsx:176-201` (no `legal-*` featured caller found; coding-agent guidance `SKILL.md:426-432`) | workspace Google Drive / OneDrive storage via the connected platform integration (credential never reaches the page) |
| `POST /api/legal/transcricao` | legal-transcricao | STT transcription |
| artifact-backend `onEmail` entrypoint (no HTTP from the app) | legal-citius (+ backends in legal-agenda, legal-cobrancas, legal-financas, legal-nucleo) | event-sourced email ingestion via `email.received` triggers; writes via capability-scoped `ekoa.appData.shared.*`, `ekoa.notify.{inApp,email}`, `ekoa.llm` |

Full slug list (29): legal-agenda, legal-agenda-reservas, legal-apoio, legal-assinatura, legal-calculos, legal-citius, legal-cobrancas, legal-conflitos, legal-contratos, legal-correio, legal-dossie, legal-financas, legal-forms, legal-honorarios, legal-injuncoes, legal-insolvencias, legal-jurimetria, legal-kanban, legal-kyc, legal-modelos, legal-nucleo, legal-pecas, legal-pesquisa, legal-portal, legal-prazos, legal-rcbe, legal-recursos, legal-tempos, legal-transcricao. Non-legal featured apps (agency-portfolio, ai-assistant, booking-system, ecommerce-catalog, erp-imobiliario, help-desk, invoice-manager, marketing-landing, pitch-deck, quarterly-report, sales-crm, task-manager) use the same serving/app-data machinery. Note: cortex's `GET /api/citius/consulta` route has **no frontend or legal-artifact caller** (grep-verified) — it serves other consumers (automations/integrations).

## 25. Rebuild contract landmines (cross-cutting, verified this run)

1. **Recipe-envelope unwrap** (§0.2) — rebuilt API must pick one response shape per intent and keep the client contract.
2. **`target` discriminator on triggers** — automation-target vs artifact-backend-target both hit `create` (§16).
3. **Webhook `publicUrl` redaction** — client reconstructs `{apiOrigin}/hooks/{id}`; rebuild must return publicUrl or preserve origin equality (§16).
4. **JWT-in-URL** for non-shareable served-app previews and SSE (`?token=`); shareable artifacts deliberately omit it to avoid token leak (§8, §23).
5. **`get-me` as the only token-refresh path** (§1).
6. **`integration_ready` server push** resumes paused builds — a cross-surface coupling between integration-builder save and the chat build loop (§13).
7. **Dual response shapes tolerated** for `list-instances` (object vs legacy flat array) — API returns object today (§8).
8. **WS close-code 4000 = takeover** contract (§22).
9. **`plan-from-goal` is not pure planning** — it persists the automation and kicks a rehearsal run (§17).
10. **Logout has no server-side operation** — token invalidation impossible today (§1).
11. **`metadata.language` injected on every `/api/v1/request`** from localStorage (§0.1).
12. **Login intents pre-auth exempt**; `POST /api/v1/action` otherwise requires Bearer (§0.1, §1).

---

## Orphans and conflicts

### C1. Frontend client functions targeting apps with NO backend handler (would fail "unknown app"; verified against `cortex/src/handlers/index.ts:49-74` + `cortex/apps/` (which contains only `ekoa.company`, `ekoa.deployments`, `ekoa.projects`); repo-wide grep for `claude-oauth|agent-config|tunnel` in cortex/src returns only a comment at `cortex/src/__tests__/governance-compliance.test.ts:104` — no handler or recipe app exists for any of the three). None have UI callers either — pure dead client code:
- `ekoa.claude-oauth`: `start`, `status`, `disconnect` — client.ts:347-357
- `ekoa.agent-config`: `get`, `update` — client.ts:1128-1141
- `ekoa.tunnel`: `get-config`, `configure`, `start`, `stop`, `status` — client.ts:1213-1236 (`/tunnel` route is a redirect)
- `ekoa.knowledge` legacy "company knowledge" intents removed from the live handler: `get`, `update`, `list-files`, `upload-file`, `delete-file` — client.ts:1161-1207; plus `CortexConnection.sendFileUpload` → `upload-file` (connection.ts:427-439, WS-era vestige, no caller)

### C2. Client API functions with a live backend but no frontend caller (WS-era / removed-page leftovers; grep-verified):
- `ekoa.activity/list` (`getActivityLogs`, client.ts:1242-1246) — handler exists
- `ekoa.chat/send` (`sendChatMessage`, client.ts:1295-1299) — handler exists but is an acknowledged stub; real chat is `POST /api/v1/request`
- `ekoa.projects/list|get|create|delete` (client.ts:1272-1289) — backed only by recipe app `cortex/apps/ekoa.projects`
- `ekoa.integrations/grant-access|revoke-access` (client.ts:536-549)
- `ekoa.execute/infer-integrations` (client.ts:790-795)
- `ekoa.sessions/get` with `includeMessages:true` (`getSessionWithMessages`, client.ts:1046-1048)
- `ekoa.memory/get` (client.ts:1321-1323)
- store-level: `ekoa.company/update` and `ekoa.teams/update` actions exist with no page caller found

### C3. Backend-only intents nothing in the frontend calls (from the knowledge handler map, `cortex/src/handlers/knowledge-handler.ts:81-106`): `read`, `search`, `crawl-cancel`, `refresh-all`, `reindex`, `index-status` (search/read serve the agents' MCP tools, reindex is admin heal). Also `GET /api/citius/consulta` has no frontend or legal-artifact caller (§24). A full backend-side intent census is out of scope for this frontend-derived document — see the backend routes inventory.

### C4. Doc/code contradictions (docs are hints; code is truth):
1. **CLAUDE.md route map is stale**: no `/templates`, `/tasks`, `/workflows`, `/scheduling`, `/skills`, `/apps`, `/observability`, `/settings/channels`, `/settings/gateway`, `/settings/billing` pages exist in `ekoa/app/`; live routes CLAUDE.md omits: `/knowledge`, `/usage`, `/settings/bridge`, `/activate`, redirect stubs `/configure/settings`, `/build/integrations`.
2. **No `previewMode` setting exists** (stores/settings.ts:18-46) despite CLAUDE.md's "Preview Mode" section; no `PreviewGate` usage found.
3. **No `useCompany` hook with mock fallback exists** (stores/company.ts has none) despite CLAUDE.md's "API Mock Fallback" guardrail.
4. **No vertical selector in the UI** — `general.vertical` is a settings field but only settable server-side (settings/platform whole file).
5. **`memory/memory-settings.tsx` is a non-functional mock** — auto-extract/consolidation switches wired to nothing.
6. **`/settings/bridge` pairing section is static copy** ("arrives in a follow-up release", bridge/page.tsx:109-116); only approved-command list/revoke are live.
7. CLAUDE.md describes JsonStore persistence throughout; this document derives nothing from persistence claims (frontend has no visibility) — the rebuild must take persistence truth from the backend inventory, not CLAUDE.md.

### C5. Dead SSE/stream plumbing (rebuild must decide intentionally — dead code vs missing-registration bug):
1. **`phase_changed`**: chat page subscribes `conn.on('phase_changed', …)` (chat page :873) but the event is NOT in the registered eventTypes (connection.ts:151-170, re-verified this run) — handler can never fire, despite orchestration.ts:139-148 comments describing it as the side-panel driver.
2. **`preview_reload`**: registered (connection.ts:163) and handled in useJobStream (:487-503), but useJobStream subscribes only via `conn.onStream` and `preview_reload` is not in the fan-out set (connection.ts:251-262); no `conn.on('preview_reload')` exists — the hot-reload preview bump is unreachable.
3. **`subagent_event`**: handled in useJobStream's switch (:375-419) but never registered as an EventSource listener; the chat page's `onStream` callback also handles it (chat page :1038-1044) — reachable only through fan-out of parsed events, which never receives it since it's unregistered.
4. **Registered-but-unconsumed**: `file_data`, `action_result` have no consumer; `action_complete`/`action_error` are fanned out but every handler ignores them; `auth_result` only feeds internal connection caching.
5. Chat page selects `guidedMode`/`updateSettings` (:208-209) but never uses them.
6. `stores/demos.ts` gallery cards are fetched on every dashboard mount but unused ("future landing panel").

### C6. Finder discrepancies resolved by code re-check this run:
1. Knowledge intent names: one sweep reported `list-docs`/`start-crawl`/`unindex-upload` (store method names); code uses intents `list` (stores/knowledge.ts:255), `crawl-source` (:418), `crawl-status` (:438), `unindex-document` (:529). Document uses the verified intent names.
2. Billing limit intent: reported as generic "set-limit"; code is `admin-set-limit` (stores/billing.ts:197). Verified.
3. `phase_changed` absence from connection.ts eventTypes re-verified directly (connection.ts:151-170).

*(No other conflicts found.)*
