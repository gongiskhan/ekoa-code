# H1 — Identity / Roles / Session surface map (facts for the security block)

Scope: the entire authn/authz/session surface of ekoa-code, so the H1 security block
(roles + capability layer, identity handoff, edit gating) can be designed on facts.
Every claim is `file:line`. Conclusions only.

---

## 0. TL;DR for the security-block designer

- **Three roles exist and are real in the data model + JWT**: `super-admin | org-admin | builder`
  (`shared/src/common.ts:33`). `builder` IS surfaced in the web UI as PT `Construtor` /
  EN `Builder` (`web/locales/pt.ts:371`, `web/locales/en.ts:370`).
- **`can()` is a permissive stub with ZERO call sites.** Nothing in `api/` or `web/` calls it.
  Every real authz decision today is an inline `role` string comparison via `requireRole(...)`
  or hand-written owner/org checks. The capability layer is greenfield.
- **Auth-class enforcement is per-router and MANUAL.** The descriptor `auth` field
  (`public|user|org-admin|super-admin`) is a contract *declaration* (client + contract tests);
  server.ts does NOT auto-enforce it. Each router calls `requireAuth` / `requireRole` itself.
  A new central capability gate must be wired route-by-route (or via a new descriptor-driven
  middleware) — there is no single chokepoint to patch.
- **No platform identity ever reaches a served app.** Served apps are same-origin subpaths
  `/apps/<idOrSlug>/*`. The served-app assistant is header-scoped (`X-Ekoa-App-Id`), never reads
  the caller JWT (confirmed below). App-level end-user identity is a *separate* per-app SSO/cookie
  system, disjoint from the platform JWT.
- **KEY GAP for edit-gating: `POST /jobs` follow-up builds have NO artifact-ownership check.**
  Any authenticated user can drive a code-writing agent against ANY artifact by id
  (cross-user/cross-tenant IDOR). Details in §4/§5.
- **No formal migration framework.** Schema/data migrations are idempotent boot steps in
  `bootState()` (`api/src/server.ts:675`).
- **No persistent notification/inbox/queue** for org-admins. Only: append-only `activity_logs`
  (registo, metadata-only) + ephemeral per-user SSE notifications. A request-changes queue is
  greenfield (would need a new store).

---

## 1. ROLES TODAY

### 1.1 Role values
- Enum: `Role = z.enum(['super-admin', 'org-admin', 'builder'])` — `shared/src/common.ts:33` ("the
  three-role model (Amendment 2)").
- On the user record: `UserDoc.role: 'super-admin' | 'org-admin' | 'builder'`
  — `api/src/data/stores.ts:13`.
- On the wire: `AuthUser.role: Role` — `shared/src/auth.ts:12-22` (`.strict()` response shape;
  passwordHash never leaves).
- In the JWT: `JwtClaims.role: Role` — `api/src/auth/jwt.ts:11-21`.
- The per-request actor: `interface Actor { userId; orgId; role }` — `shared/src/common.ts:39-43`.

### 1.2 Is there a `builder` role? YES, but no capability semantics
- Data model + JWT + zod: yes (above).
- Web UI: yes. `web/app/(dashboard)/users/page.tsx` role toggle offers exactly
  `"org-admin" | "builder"` (`:88`, `:95-97`, `:151`, `:207-217`); super-admin is shown
  read-only, never a toggle target (`:77-78`).
- PT-PT string: `roleBuilder: 'Construtor'` (`web/locales/pt.ts:371`), EN `'Builder'`
  (`web/locales/en.ts:370`), `roleAdmin` for org-admin. Badge render:
  `users/page.tsx:70-73`.
- **`builder` carries NO enforced privilege difference today.** It is the default/base role;
  the only thing that distinguishes roles operationally is `requireRole` (super-admin/org-admin
  gates) — a `builder` is simply "not an admin". No code branches on `role === 'builder'`.

### 1.3 What admin checks look like today (role string comparisons)
All authorization is inline role comparison — there is no policy engine. Two mechanisms:

- **`requireRole(...roles)` middleware** — `api/src/auth/middleware.ts:76-83`:
  `if (!req.user || !roles.includes(req.user.role)) fail(FORBIDDEN)`. Call sites:
  - `api/src/routes/users.ts` — list `requireRole('super-admin','org-admin')` (`:17`),
    create/delete/reset `requireRole('super-admin')` (`:21,:40,:48`), patch
    `requireRole('super-admin','org-admin')` (`:29`).
  - `api/src/routes/registo.ts:22` — `requireRole('org-admin','super-admin')`.
  - `api/src/routes/artifacts.ts:136` — `PUT :id/featured` `requireRole('super-admin')`.
  - (org router, orgs router, billing/usage similar — same pattern.)
- **Hand-written role/org checks inside services/handlers** where a static class can't express it:
  - `logoutOther` (`api/src/auth/service.ts:111-123`): `if (caller.role !== 'super-admin' &&
    caller.role !== 'org-admin') return 'forbidden'; ... if (org-admin && target.orgId !==
    caller.orgId) return 'not-found'`.
  - `patchUser` cross-org guard in the route: `if (a.role === 'org-admin' && target.orgId !==
    a.orgId) notFound; if (a.role === 'org-admin' && body.role === 'super-admin') FORBIDDEN`
    (`api/src/routes/users.ts:35-36`).
  - `listUsers`: super-admin sees all, else scoped to `orgId` (`api/src/auth/users-service.ts:15`).
  - Job/chat read: `job.userId !== actor.userId && actor.role !== 'super-admin'` → 404
    (`api/src/routes/jobs.ts:63`, `api/src/routes/chat.ts:56`).

### 1.4 org-admin vs super-admin, and the org model
- **super-admin = platform-wide**; **org-admin = confined to its own `orgId`**. This is the
  entire tenancy story. (`api/src/auth/users-service.ts:1-5` header; enforced as in §1.3.)
- **Org membership is a reverse index, not a list.** `UserDoc.orgId` is a single string
  (`stores.ts:16`) — a user belongs to exactly one org. `OrgDoc` has NO owner/members/adminUserId
  field (`stores.ts:19-28`; `shared/src/org.ts` OrgCreate/Update carry only name/displayName/
  branding/settings). "Members of org X" = `users.find({ orgId: X })`
  (`users-service.ts:15`). There is **no org-ownership concept** distinct from "an org-admin whose
  `orgId` is this org". No super-admin-per-org.
- First-boot seeding: `seedAdmin` creates ONE `Founder` org + a `super-admin`
  (`api/src/auth/service.ts:57-73`), gated by env `EKOA_ADMIN_USERNAME/PASSWORD`
  (`server.ts:690-692`).
- User creation (`createUser`, `users-service.ts:19-41`): super-admin only; a new user without an
  explicit `orgId` gets a **fresh org auto-created named after the username** (`:24-26`) — i.e. a
  super-admin can mint org-isolated tenants; an org-admin creates users but the route path only
  lets super-admin POST (`users.ts:21`). New users are `passwordChangeRequired: true`.

---

## 2. THE `can()` STUB

### 2.1 Capability vocabulary — `shared/src/capabilities.ts`
```
Capability = z.enum(['canBuildApps','canEditApps','canCreateArtifacts','canUseChat'])
```
(`shared/src/capabilities.ts:10-16`). NAMES ONLY — "no role mapping, no enforcement, no
authorization semantics" (file header `:1-7`). Exported via `shared/src/index.ts:58`.

### 2.2 The stub — `api/src/auth/capabilities.ts`
```ts
export function can(_actor: Pick<JwtClaims,'role'> | null | undefined,
                    _capability: Capability): boolean {
  return true; // PERMISSIVE-STUB — real mapping lands in H1
}
```
(`api/src/auth/capabilities.ts:14-19`). Marked `PERMISSIVE-STUB`; header says the H5 security
assertions **grep this file for the `PERMISSIVE-STUB` marker and fail if it survives the security
block** (`:9-10`). Signature takes `Pick<JwtClaims,'role'>` — i.e. it is meant to be a pure
role→capability map (no org/resource context in the current shape).

### 2.3 Call sites of `can(...)`
**NONE.** Exhaustive grep of `api/` and `web/` for `can(` (excluding cancel/scan/cannot/canvas):
the only match is the definition itself (`api/src/auth/capabilities.ts:14`). The capability seam
is defined + unit-tested but **wired to nothing**. Wiring `can()` into the real gate points is
part of the H1 work, not a retrofit over existing callers.

### 2.4 Pinned test — `api/tests/auth/capabilities-stub.test.ts`
- Asserts `can()` returns `true` for **every** capability and **any** actor
  (`{role:'builder'}`, `null`, `undefined`) — `:13-19`.
- Asserts the vocabulary is exactly `['canBuildApps','canEditApps','canCreateArtifacts',
  'canUseChat']` in that order — `:22-28`.
- Header (`:1-7`): this test is DELIBERATELY permissive; the H5 capability-matrix suite is meant
  to **REPLACE** it, and "if this test still exists after the security block lands, that is a
  defect." → The security block must delete/replace this test and flip the stub.

---

## 3. SESSION / IDENTITY

### 3.1 Login → JWT
- Route: `POST /api/v1/auth/login` (`auth:'public'`) — `shared/src/auth.ts:91-98`;
  handler `api/src/routes/auth.ts:17-30` → `login()` `api/src/auth/service.ts:75-97`.
- Password verify (`verifyPassword`), deactivated accounts blocked (403 ACCOUNT_DISABLED),
  billing-lock does NOT block login (refused per-request instead).
- **JWT claims**: `{ sub, role, scope:'user', orgId, username, jti, iat }`
  (`service.ts:89-91`; interface `api/src/auth/jwt.ts:10-21`). Single mint point `signToken`
  (`jwt.ts:31-39`). `jti` ALWAYS present (revocation key, P-03). `iat` pinned to
  `max(now, tokenEpoch)` at login (`mintIat`, `service.ts:51-54`).
- **Expiry**: 24h default, **30d with `rememberMe`** (`jwt.ts:35`). `LoginResponse` returns
  `{ token, user, passwordChangeRequired, expiresIn }` (`shared/src/auth.ts:32-38`).
- Other auth endpoints (`shared/src/auth.ts:91-149`): `me` (user), `refresh` (user, re-signs same
  claims + fresh jti, old token lives to its own expiry — `auth.ts:39-46`), `logout`
  (user; `{userId}` admin variant enforced in service, super-admin anywhere / org-admin own-org),
  `password` (user, self change), device flow `device`/`device/poll` (public) + `device/approve`
  (user).

### 3.2 `verifyToken` + the admission plane — `api/src/auth/middleware.ts`
- `verifyToken(token)` — `api/src/auth/jwt.ts:51-61`. HS256 pinned (no alg downgrade). **Rejects
  bridge tokens** (`aud:ekoa-bridge` / `pairingId` / `connectionId`) — token-class separation.
- `requireAuth` middleware (`middleware.ts:22-55`): Bearer parse → `verifyToken` → require `jti`
  → `isRevoked(jti)` → activation lookup (`getActivation(sub)`, fail-CLOSED on miss as
  UNAUTHENTICATED) → `active` (403 ACCOUNT_DISABLED) → **token-epoch check** (`iat < tokenEpoch`
  ⇒ 401; how role-change/deactivation revoke all outstanding tokens) → billing lock (402).
- `requireRole(...roles)` — `middleware.ts:76-83` (see §1.3).
- Activation cache = in-memory write-through map `api/src/data/activation.ts` (`active`,
  `billingLocked`, `tokenEpoch`). Boot-loaded from users store (`server.ts:677-678`, but note it
  loads only `{active}` — `tokenEpoch` defaults to 0 at boot). Sound under single-process
  (FIXED-8). Role change bumps `tokenEpoch` (`users-service.ts:53-59`), as does deactivation /
  password change / admin reset / admin logout (`service.ts`).

### 3.3 How the WEB app stores/attaches the token
- **Token**: `localStorage['ekoa_token']`, sole accessor `web/lib/api/token.ts` (`TOKEN_KEY`
  `:13`; `getToken/setToken/clearToken` `:24-39`). Cross-tab sync via `storage` event
  (`:51-55`).
- **Attach**: `web/lib/api/core.ts:203-206` — `if (token && descriptor.auth !== 'public')
  headers['Authorization'] = 'Bearer ' + token`. A 401 on a non-public route triggers
  `handleUnauthorized()` which clears `localStorage['ekoa_auth']` (the separate auth-state store,
  `AUTH_STATE_KEY` `core.ts:22,:142`).
- **No httpOnly cookie for the platform session.** The platform JWT lives in localStorage only.
  (The only cookies in the system are the per-app SSO cookies, §3.5.)

### 3.4 SERVED APPS — origin, and does any identity reach them?
- **Origin/path**: served apps are same-origin subpaths of the API process. Mounted
  `app.use('/', servingRouter({ verifyToken }))` (`server.ts:664`); URL shape `/apps/<idOrSlug>/`
  (e.g. `appUrl = '/apps/${artifactId}/'`, `build-mechanics.ts:212`; PDF render hits
  `${origin}/apps/${id}/`, `artifacts.ts:276`). So the dashboard (web), the API, and served apps
  are all the **same origin** in a deployment (the web dev-proxy fronts them locally).
- **The served-app assistant is header-scoped and NEVER reads the caller JWT** — CONFIRMED.
  `POST /api/app-assistant`, `api/src/apps/app-assistant-route.ts`. Admission (`admit`, `:70-113`)
  reads ONLY `X-Ekoa-App-Id` (`:71`), charset-checked via `collectionName` and rejecting the
  reserved `usr.` shared-namespace prefix (`:72-79`). It resolves the artifact → **owner**, gates
  on the **owner's** activation/billing (`:89-98`), grounds under the **owner's org resolved
  server-side from the owner user record, never the visitor body** (`:100-102`, and header
  comment `:15-17`), and **bills the owner** (`allowanceMiddleware(... owner.userId)`, `:124`).
  There is no `Authorization` header read, no `req.user`, no visitor identity anywhere in this
  file. Mounted `app.use('/api', appAssistantRouter())` (`server.ts:611`).

### 3.5 Cookies (httpOnly? domain?) — per-app SSO only
- The ONLY cookies are per served-app end-user sessions: `api/src/integrations/app-sso.ts`.
  Cookie name `ekoa_app_sso_<appId>` (`:237,:247-250`), **`HttpOnly`, `Path=/api/app-sso`**,
  `SameSite=Lax` (dev) or `Secure; SameSite=None; Partitioned` CHIPS (prod cross-site iframe)
  (`buildSessionCookie` `:272-275`). Isolation is by **name + a server-side appId check**, never
  by path (`:245-246`). No `Domain=` attribute set.
- This is **served-app end-user identity** (the app's own users, stored in the app's app-data
  collection), completely disjoint from the platform builder identity. Two sign-in modes:
  Microsoft SSO (`validateIdToken`, RS256 + per-tenant JWKS + nonce, `:179-231`) and
  username/password against an app-data collection (`/login`, bcrypt, `:376-408`). The app JS
  never sees the token — "identity comes only [from] the per-app cookie" (`:9`). Stores:
  `appSessions` (`app_sessions`), `appSsoPending` (`app_sso_pending`) — `stores.ts:94-95`.
  Router mounted `app.use('/api/app-sso', appSsoRouter(...))` (`server.ts:521`).

### 3.6 `?token=` SSE / query patterns
- `EventSource` cannot set headers (CONV-1), so the four SSE streams authenticate via `?token=`
  through `verifySseToken(token)` — `middleware.ts:59-73` (same verify + revocation + activation +
  epoch checks as `requireAuth`, returns `{ok,claims}` or `{ok:false,status,code}`).
- The four SSE endpoints + their per-stream ownership guards:
  - `GET /api/v1/jobs/:id/events` — `jobs.ts:18-31`; ownership: `job.userId !== claims.sub` ⇒ 403
    (`:26`).
  - `GET /api/v1/chat/runs/:id/events` — `chat.ts:19-29`; `entry.ownerUserId !== claims.sub` ⇒
    403 (`:24`).
  - `GET /api/v1/notifications/events` — `notifications.ts:13-18`; keyed by `claims.sub` (own
    channel only).
  - (Bridge/automation streams follow the same `?token=` pattern.)
- Other `verifyToken` query consumers injected at mount: `build` link router (`server.ts:661`),
  `m365` proxy (`:514`), serving router (`:664`).

---

## 4. BUILD-REQUEST GATE POINTS

### 4.1 Where `POST /jobs` authorizes today
- `api/src/routes/jobs.ts`: `r.use(requireAuth)` (`:33`) then `r.post('/')` (`:35-58`). The ONLY
  gate is `requireAuth` — **any authenticated user, any role (including `builder`), may create a
  build job.** No `requireRole`, no `can('canBuildApps')`, no per-request capability check.
- The route derives `actor = actorOf(req)` and calls `handleBuildCreate({ actor, username,
  sessionId, description, ..., artifactId?, ... })` (`:39-53`).
- Billing is the only downstream refusal: `checkAllowance(actor.userId)` inside the executor
  (`build.ts:301-312`, BILLING_BLOCKED). That is a quota gate, not a permission gate.
- → **This is the primary insertion point for `can('canBuildApps')`** (first build) and
  `can('canEditApps')` (follow-up). Today there is nothing here.

### 4.2 Where the CHAT plane could refuse a build (in-chat build intent)
- Build intent is detected by fast classifiers in `api/src/agents/guided-build.ts`:
  `detectBuildIntent` (`:52-65`), `detectIntegrationNeeds` (`:68-81`), `selectBaseTemplate`
  (`:84-96`), and the in-build `classifyInBuildIntent` (`:34-49`, outcomes
  `modification|integration-build|question`).
- The chat run itself (`POST /api/v1/chat/runs`, `chat.ts:33-50`) is gated by `requireAuth` only.
  When chat decides to build, it emits a delegation marker parsed by `api/src/agents/markers.ts`
  (`MarkerFindings.build` `:30-31`) and the client then issues `POST /jobs`. So **the chat plane
  has no build-refusal today** — a capability refusal would live either (a) at `POST /jobs` (§4.1,
  the real chokepoint), or (b) as a pre-emptive suppression of the build-intent path in chat
  (marker handling / guided-build), but the authoritative gate is `POST /jobs`.

### 4.3 Artifacts/apps ownership model
- `ArtifactDoc` (`api/src/apps/artifacts-service.ts:12-23`): `userId` (owner), `orgId` (tenant),
  `visibility: 'private' | 'org'`, `featured?`, `shareable?`, `data?` bag. Wire schema
  `shared/src/artifacts.ts:13-31` (`userId`, `orgId`, `visibility` required; `.passthrough()`).
- **Ownership = `userId` + `orgId` + visibility.** Enforced by owner-visibility scoping, two
  helper families:
  - `loadReadable` (`app-paths.ts:74-81`): own (any visibility) OR org-shared within same org;
    else uniform null (404).
  - `loadWritable` (`app-paths.ts:88-97`): own always OR org-shared by any org member ⇒ ok;
    another user's PRIVATE row ⇒ `forbidden`; missing/cross-org ⇒ `notfound`.
  - `OwnerVisibilityScoped` (`data/scoped.ts`) backs `getVisibleArtifact` / `patchArtifact` /
    `deleteArtifact` (`artifacts-service.ts:92-123`).
- The artifacts router applies these on every route via `readable()`/`writable()`
  (`artifacts.ts:59-70`). This is the **correct, existing edit-gating pattern** the security block
  should mirror.

---

## 5. PATCH / EDIT MACHINERY

### 5.1 Scoped follow-up build path (edit an existing app) — and its GAP
- `POST /jobs` with `artifactId` in the body ⇒ `handleBuildCreate` routes to `handleFollowUp`
  (`api/src/agents/build.ts:90-92`, `:153-219`).
- One-follow-up-per-artifact concurrency guard: `hasLiveJobForArtifact || nonTerminalJobForArtifact`
  ⇒ `conflict` ⇒ route returns **409 DUPLICATE_BUILD** (`build.ts:156-157`, `jobs.ts:54`).
- Resolution: `mech.resolveFollowUp(artifactId)` (`api/src/apps/build-mechanics.ts:206-221`):
  `const art = await artifacts.get(artifactId)` — **fetched by id with NO actor/org/owner
  scoping** — then resolves `projectDir = projectDirFor(art)` (owner sandbox
  `sandboxRoot()/user-<art.userId>/<id>` or a jail-resolved recorded dir) and resumes the app's
  SDK session (`data.sdkSessionId`).
- **GAP (cross-user/cross-tenant IDOR, edit-gating): neither `handleFollowUp` nor
  `resolveFollowUp` checks that the actor may write the artifact.** There is NO `loadWritable` /
  org / owner check on the follow-up build path. An authenticated user B can
  `POST /jobs {artifactId: <user A's app>, description: "..."}` and drive a code-writing agent in
  user A's sandbox, resuming A's transcript, mutating A's app. The job record stores
  `userId: actor.userId` (the requester, `build.ts:206`), so B even owns the resulting job/stream.
  `data.projectDir` is jail-resolved per the sandbox root (`app-paths.ts:34-43`) which prevents
  path-escape, but does NOT prevent targeting another owner's artifact.
  → **The security block MUST add a `loadWritable`(actor, artifactId) / `can('canEditApps')` gate
  before a follow-up build proceeds** (at `jobs.ts` route or in `handleFollowUp`).
- The healthy comparison: the write-file / bundle-update / restore routes DO gate via `writable()`
  (`artifacts.ts:152,193,226,...`). Only the follow-up *build* path skips it.

### 5.2 Preview / diff / rollback primitives (versions)
- Git is the system of record per app repo. `api/src/apps/versions.ts`:
  - `listVersions(projectDir)` — commit list mapped to `ArtifactVersion` (`:56-66`).
  - `restoreVersion(params)` — **FORWARD restore** (working tree rewritten to a target sha and
    committed as a NEW `[restored]` head; HEAD never moves backward, audit trail preserved),
    serialized on a per-repo lock (`:80-135`).
  - `restoreAndRebuild` — restore + rebuild + gated GitHub mirror push (`:142-157`).
- Routes (all `auth:'user'`, all gated by `writable()` for mutating ones):
  `GET :id/versions` (`artifacts.ts:185-191`, readable),
  `POST :id/versions/:sha/restore` (`:193-203`, writable),
  `GET/PUT :id/file` (read/write source, `:213-238`),
  `POST :id/bundle-update` (in-place bundle apply with safety-net snapshot + pre-update version,
  `:152-168`; response carries `safetyNetSnapshotId` + `preUpdateVersionId`,
  `shared/src/artifacts.ts:81-86`),
  app-data `backups` snapshot/preview/restore (`:285-321`).
- So preview(files)/diff(versions)/rollback(restore) primitives all EXIST and are correctly
  owner/org gated — the follow-up *build* path (§5.1) is the sole ungated edit vector.

### 5.3 Git hygiene per app
- Each app is its own git repo under the owner sandbox
  (`sandboxRoot()/user-<userId>/<appId>`, `app-paths.ts:23-25`). Commits run with hooks disabled
  (`core.hooksPath=/dev/null`, `versions.ts:31`) and a per-repo lock (`withRepoLock`,
  `services/repo-lock.ts`). Snapshots on every save (commit-guard) and at build completion
  (`build.ts:478`). GitHub mirror push is a gated fire-and-forget backup
  (`backupAppRepoSafe`, `versions.ts:155`).

---

## 6. REQUEST / QUEUE / INBOX PRIMITIVES

There is **no existing approval/request-changes queue or persistent inbox.** What exists:

- **Activity log (registo)** — append-only audit. Store `activityLogs` (`activity_logs`)
  `ActivityLogDoc { userId, username, orgId, category, type, timestamp, metadata? }`
  (`stores.ts:51-59,:84`). Single write path `logActivity` (`data/activity.ts`), metadata-only
  (never bodies/prompts). Read surface `GET /api/v1/registo` — **org-admin reads own org,
  super-admin across orgs** (`routes/registo.ts:22-35`) + a per-user `masking-summary`
  (`:17-20`). This is the closest thing to an org-admin activity feed; it is READ-ONLY history,
  not a queue.
- **Notifications SSE** — ephemeral per-user push channel (`GET /api/v1/notifications/events`).
  Event union `NotificationEvent`: `build_intent`, `integration_build_intent`, `chat_answer`,
  `branding_updated` (`agents/streaming.ts:130-154`). No persistence, no assignment, no
  org-admin fan-in. Not an inbox.
- **`event_queue` store** (`stores.ts:101`) — internal trigger/automation delivery queue
  (`startDelivery`, `server.ts:725`), NOT a user-facing request queue.
- → A request-changes / approval queue for org-admins would be **greenfield**: a new store
  (mirroring the `activityLogs`/`Store<T>` pattern) + a new domain contract in `shared/` + a new
  router, with the notifications SSE channel as the live-push transport and `activity_logs` as the
  audit shadow.

---

## 7. MIGRATIONS

- **No formal migration framework / no `migrations/` directory / no version table.** Explicitly:
  content/knowledge modules state "no schema migrations" (`content/loader.ts:6`,
  `content/manifest.ts:8`, `knowledge/index-store.ts:3`).
- Schema/data migrations are **idempotent boot steps** run in `bootState()`
  (`api/src/server.ts:675-700`): `loadActivation` + `loadRevocations`, `seedAdmin` (idempotent —
  no-op if a super-admin exists, `service.ts:58-59`), `bootContentLoader`,
  `backfillKnowledgeIndex` (no-ops on a populated index), `sweepOrphans`, `seedFeaturedArtifacts`
  (seed/refresh/orphan-remove). The comment literally calls the sequential tail "migrations"
  (`server.ts:674,:694`).
- One-off / operational scripts live in `scripts/` (`dev-api.mjs`, `suite-ledger-run.mjs`,
  grep-gates, e2e harnesses) — none are data migrations.
- Data-format evolution is handled **byte-compatibly at read time** rather than by migration:
  e.g. `data/crypto.ts:4` carries the legacy wire format so migrated rows decrypt without
  re-encryption.
- → A role/capability schema change (e.g. adding a `capabilities` field to `UserDoc`, or a
  role→capability seed) should follow this convention: an **idempotent boot step in `bootState()`**
  (defaulting existing rows), not a versioned migration file. Because `loadActivation` currently
  loads only `{active}` and defaults `tokenEpoch:0` (`server.ts:678`), any capability the
  middleware must read on every request should either ride the JWT claims (re-mint on role change,
  which already bumps the epoch) or be added to the activation write-through map.

---

## Design implications (handoff)

1. **Central vs per-route enforcement.** There is no auto-enforcement of the descriptor `auth`
   class; gates are per-router. Decide: (a) a new descriptor-driven middleware that reads
   `descriptor.auth` + a capability map and enforces centrally, or (b) continue the per-route
   `requireRole`/`can()` pattern. Option (a) is the higher-leverage fix and would also close the
   §5.1 follow-up-build gap if `POST /jobs` is brought under it.
2. **Flip + wire `can()`.** Replace the permissive body (`api/src/auth/capabilities.ts:14-19`),
   delete/replace the pinned stub test (`api/tests/auth/capabilities-stub.test.ts` — H5 grep gate
   will fail otherwise), and add the real call sites: at minimum `POST /jobs` (canBuildApps /
   canEditApps), chat (`canUseChat`), artifact create (`canCreateArtifacts`). The stub signature
   only carries `role`; if capabilities must be resource/org-scoped, widen it to take the `Actor`
   (+ optional resource) — a breaking-but-contained change since there are zero existing callers.
3. **Close the follow-up-build IDOR (§5.1)** — the single ungated edit vector; reuse
   `loadWritable`.
4. **Identity handoff to served apps stays out of scope of the platform JWT** — served apps have
   their own per-app cookie identity; do NOT bridge the platform JWT into `/apps/*`.
5. **Request-changes queue is greenfield** — build on the `Store<T>` + activity-log + notifications
   SSE patterns; there is nothing to retrofit.
6. **Role/capability persistence via an idempotent boot step**, matching the repo's no-migration
   convention.
