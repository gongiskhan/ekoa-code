# 04. Data model

This chapter fixes where every piece of data lives in the rebuilt Cortex, how tenancy is expressed, and how user-built apps read and write data. Its centerpiece is the collections engine (FIXED-5): a single, generic, deterministic data API over Firestore that serves all user apps from a per-app manifest, with no per-app server code generation. Around it, the chapter assigns every platform domain store from the current system a target collection, RESOLVED (P-05); names the deliberate exceptions that stay on the filesystem or SQLite; pins the Supabase control plane semantics, RESOLVED (P-08); sets retention policy, RESOLVED (P-09); and unifies secrets handling. The chapter also carries the data statements of the 2026-07-06 amendment: the server-side token revocation list (RESOLVED (P-03), section 4.3.1) and the storage posture of the anonymisation and local-bridge surfaces (section 4.3.4 - the anonymisation vault and the daemon ledger are deliberately never persisted; per-tenant deny-lists and bridge pairings are). Ground truth throughout is reference/data-inventory.md; conflicts C1 and C9 from that document surface as open questions Q-02 and Q-03, both resolved cutover-class (they stay verification actions answered at cutover, not run start - ch16 Q-02, Q-03), never resolved silently.

## 4.1 Storage map at a glance

| Data family | Backend in the rebuild | Decision | Section |
|---|---|---|---|
| User-app data (per-app collections) | Firestore via the collections engine | FIXED-5 | 4.2 |
| Platform domain stores (users, sessions, artifacts, billing, ...) | Firestore collections, same cluster and driver | RESOLVED (P-05) | 4.3 |
| Knowledge vault + lexical index | Filesystem markdown + SQLite FTS5 (unchanged) | Normative exception | 4.4.1 |
| Per-user sandboxes (app source, git, browser profiles) | Filesystem (workspace state, not database state) | Normative exception | 4.4.2 |
| Event queue (webhooks, listeners) | SQLite WAL (unchanged) | RESOLVED (P-06) | 4.4.3 |
| Blobs (uploaded files, screenshots, PDFs, asset caches) | Filesystem now, storage-relative references from day one | RESOLVED (P-07) | 4.4.4 |
| Control plane (Claude OAuth custody, license) | Supabase, 3 tables only | RESOLVED (P-08) | 4.5 |
| Secrets at rest | AES-256-GCM ciphertexts, one crypto module, mandatory key | FIXED-8 + RESOLVED (P-14) | 4.7 |

Firestore here means Firestore Enterprise edition with MongoDB compatibility, reached over the MongoDB wire protocol via the `mongodb` npm driver. That is what production app-data uses today: there is no Firebase/GCP SDK anywhere in the current backend, auth is a scoped connection-string database user, and index creation is an out-of-band admin script because the least-privilege runtime user cannot run admin commands (reference/data-inventory.md §1, §3.4). The rebuild keeps all of that. The production environment value that selects this backend lives in the external ekoa-deploy repo and could not be verified from this machine; that is conflict C1, carried as **Q-02** (section 4.9).

A design rule that shapes everything below: **the data layer relies only on single-document atomic operations** - insert with a deterministic `_id` (duplicate-key error as the uniqueness mechanism), compare-and-swap `replaceOne` on a revision field, and atomic `findOneAndDelete`. Multi-document transactions on the Mongo-compat surface are never load-bearing. This matches how the current code already achieves correctness (reference/data-inventory.md §3.2) and avoids betting on features whose GA status on that surface is unverified (see Q-03).

## 4.2 The collections engine (FIXED-5)

### 4.2.1 What it is

The engine generalizes today's app-data plane (reference/data-inventory.md §3). User-built apps persist records through a fixed set of generic HTTP endpoints; the engine resolves the app's scope, validates the payload against the app's manifest, and executes against Firestore. There is exactly one implementation serving every app. Apps never get their own server code, processes, or database credentials (FIXED-5).

The engine lives in `api/src/data/` (module map, chapter 02 section 2.6). It has three parts:

1. A narrow storage driver contract (list / get / create / update / delete / listCollections, plus optional readAsOf), carried from the current 6-method contract (reference/data-inventory.md §3.1).
2. A manifest layer: per-app declarations of collections, schemas, access rules, and scope (new; section 4.2.3).
3. The route layer: the generic endpoints (section 4.2.7), which are part of the served-app byte-compatibility contract (the 37-spec legal e2e suite and all 41 featured apps drive them through the injected `window.__ekoa` handle - reference/operations-inventory.md §24; reference/test-audit.md §2.4).

### 4.2.2 Physical layout

Carried unchanged from production (reference/data-inventory.md §3.2). **FIXED** as the engine's storage shape:

- One physical Mongo collection (`app_data`) holds every logical collection of every app. Logical collections are a field, not physical collections.
- Document shape:

```
{
  _id:        "<scopeKey>::<collection>::<itemId>",   // deterministic; idempotent uniqueness without a unique index
  appId:      string,                                  // scope key 1 (canonical app id, or "usr.<ownerUserId>" for shared scope)
  collection: string,                                  // scope key 2 (the app's logical collection name)
  item:       { id, createdAt, updatedAt, ...fields }, // the user record, nested so user fields never collide with scope keys
  _rev:       number                                   // optimistic-concurrency revision; internal, never surfaced
}
```

- `update` is read-merge-in-JS then CAS `replaceOne({_id, _rev})` with bounded retries - deliberately not a server-side merge operator, which would mangle dotted keys and `$`-prefixed string values (reference/data-inventory.md §3.2).
- `list` sorts by `item.createdAt` then `_id`. `get` re-checks scope fields even though `_id` encodes them (defense in depth).
- Indexes (`{appId, collection, 'item.createdAt'}` and `{appId}`) are created by the out-of-band admin script, never by the runtime user (reference/data-inventory.md §3.4).

### 4.2.3 Manifest format

Every app project carries a `manifest.json` at its root (written by the coding agent at build time, validated by the build pipeline, chapter 07). The rebuild extends it with a `collections` block. The schema is defined once in zod inside `api/src/data/` (it is app-facing, not client-facing, so it does not live in `shared/`).

Concrete example (a PT-PT legal-style app):

```json
{
  "id": "art_9f2c81",
  "name": "Gestor de Clientes",
  "version": "1.0.0",
  "type": "jsx-app",
  "entryPoint": "frontend/src/index.jsx",
  "outputDir": "dist/",
  "sharedData": true,
  "collections": {
    "declaredOnly": false,
    "definitions": {
      "clientes": {
        "scope": "shared",
        "fields": {
          "nome":   { "type": "string", "required": true, "maxLength": 200 },
          "nif":    { "type": "string", "pattern": "^[0-9]{9}$" },
          "email":  { "type": "string", "maxLength": 320 },
          "estado": { "type": "string", "enum": ["ativo", "arquivado"] }
        },
        "additionalFields": true,
        "access": { "read": "app", "write": "app" }
      },
      "notas_privadas": {
        "scope": "app",
        "access": { "read": "session", "write": "session" }
      }
    }
  }
}
```

The zod schema (normative; the implementation run copies this shape):

```ts
export const collectionName = z.string()
  .regex(/^[a-zA-Z0-9._-]{1,100}$/)                     // carried charset guard
  .refine((n) => !n.startsWith('__') && !n.startsWith('usr.'), 'reserved prefix');

export const fieldRule = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  required: z.boolean().default(false),
  maxLength: z.number().int().positive().optional(),     // strings only
  pattern: z.string().optional(),                        // strings only; anchored regex
  enum: z.array(z.string()).optional(),
});

export const accessLevel = z.enum(['app', 'session', 'server']);

export const collectionRule = z.object({
  scope: z.enum(['app', 'shared']).default('app'),
  fields: z.record(collectionName, fieldRule).optional(), // absent => schemaless (envelope only)
  additionalFields: z.boolean().default(true),
  access: z.object({
    read: accessLevel.default('app'),
    write: accessLevel.default('app'),
  }).default({ read: 'app', write: 'app' }),
  maxItemBytes: z.number().int().positive().max(900_000).default(262_144),
});

export const collectionsBlock = z.object({
  declaredOnly: z.boolean().default(false),
  definitions: z.record(collectionName, collectionRule),
});
```

Rules:

- The `collections` block is **optional**. An app with no block (all 41 existing featured apps) behaves exactly like today: any charset-valid collection name, schemaless items, `app`-level access. This compatibility default is load-bearing: the legal e2e suite must pass against the new engine without touching the apps (reference/test-audit.md §2.4; chapter 10 cutover criteria).
- `scope: "shared"` requires the app-level `sharedData: true` opt-in (carried flag); a shared-scope declaration without it is a manifest validation error at build time.
- `declaredOnly: true` restricts the app to its declared collection names; requests for any other name return 404 with the uniform not-found body. Default is `false` (legacy behavior).
- Manifest validation happens at build/registration time and fails the build with actionable errors. The data plane never parses manifests per request; it consults the in-memory app registry (carried, chokidar-watched - reference/data-inventory.md §9), which holds the compiled rules.

### 4.2.4 Validation

Request-time validation, in order, for every write on the data plane:

1. **Charset guard** (carried): collection name and app id must match `^[a-zA-Z0-9._-]{1,100}$`; failure returns 400 `INVALID_COLLECTION`. This same guard doubles as the header guard on `X-Ekoa-App-Id` (reference/data-inventory.md §3.1).
2. **Reserved-prefix guard** (RESOLVED (P-23) - see below): names starting with `__` (platform-managed, e.g. `__files`) or `usr.` are rejected on the public data plane with 403 `RESERVED_COLLECTION`.
3. **Size ceiling** (RESOLVED (P-23) - see below): serialized item must not exceed the collection's `maxItemBytes` (default 256 KiB); failure returns 413 `ITEM_TOO_LARGE`.
4. **Schema validation** (declared collections only): the item - after envelope merge, i.e. the record as it would be persisted - is validated against `fields`. Unknown fields are allowed when `additionalFields: true`. Failure returns 422 with `{ error: { code: "VALIDATION_FAILED", details: { fields: [...] } } }` per the chapter 03 error envelope. Undeclared collections skip this step entirely.
5. **Envelope** (carried): the engine builds `{ id, createdAt, updatedAt, ...fields }`; a caller-provided `id` is honored (reference/data-inventory.md §3.1). `id`, `createdAt`, `updatedAt` are engine-owned; client attempts to overwrite `createdAt` on update are ignored.

**RESOLVED (P-23) - collections-engine hardening guards.** Both guards are kept. Rules 2 and 3 are the only two deviations from the otherwise byte-compatible data-plane contract; every other rule in this list is carried behavior. (a) The reserved-prefix rejection closes public-plane access to platform-managed collections (`__files` metadata); no known served app writes `__`-collections directly today - they use the `/api/app-files` routes (reference/operations-inventory.md §24). (b) The size ceiling protects against backend document-size-limit crashes. The compatibility gate (the 37-spec legal e2e suite plus all featured apps, section 4.2.1) catches any real breakage before cutover (chapter 10 criteria), and the two guards leave the rest of the engine untouched.

Rejected alternative: strict byte-compatibility - no new rejection classes, oversized writes surfacing as raw driver errors and reserved collections reachable from the public plane exactly as today, with rules 2-3 and their error codes deleted. Not taken; the two guards close a real crash-and-access-scope gap at negligible cost.

Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### 4.2.5 Access rules

Three access levels per collection, per direction (read/write):

| Level | Meaning | Today's equivalent |
|---|---|---|
| `app` (default) | Any request carrying the app's scope (the `X-Ekoa-App-Id` header set by the injected handle, slug resolved server-side to the canonical id) | The entire current contract - all collections behave this way today |
| `session` | Additionally requires a valid end-user SSO session cookie whose `appId` equals the target app (the `app_sessions` store, section 4.3) | New capability; no current collection uses it |
| `server` | Not reachable from the public data plane at all; only platform services and artifact backend code (via the capability handle, chapter 07) may touch it | `__files` metadata effectively behaves this way |

The data plane carries **no platform JWT** (carried; reference/data-inventory.md §3.3). Platform-user identity never reaches it; end-user identity exists only through the SSO session cookie. Chapter 09 owns the security analysis of this plane; chapter 03 owns the endpoint census.

### 4.2.6 Tenant scoping

- **Single company** (FIXED-8): no company dimension anywhere in the engine.
- **Per-app scope** `(appId, collection)` with a **single query-binding point**: every driver query is built through one scope-resolution function; no method can issue an unscoped query (carried - reference/data-inventory.md §3.3). This is the explicit replacement for the structural isolation filesystem paths used to give for free.
- **Shared owner scope** (carried): the reserved scope key `usr.<ownerUserId>` is shared across all artifacts of one platform user that opt in via `sharedData: true`. It is resolved **server-side only**: the owner comes from the app registry, never from the client; a client-supplied `X-Ekoa-App-Id` starting with `usr.` is rejected; a foreign-Origin request against the shared routes is blocked; a non-opted-in app gets 403 (reference/data-inventory.md §3.3). The 29 legal apps' shared spine (processos, prazos, eventos, clientes, ...) runs on this scope (reference/operations-inventory.md §24).
- **No per-platform-user partition inside app data** (carried, by design): apps that need per-visitor separation implement it themselves or use `session` access rules.

### 4.2.7 Generic endpoints

The paths below are **byte-compatible with today** - they are baked into the injected `window.__ekoa` handle inside every already-built app bundle, so they keep their current shapes and stay outside the `/api/v1` platform prefix (reference/operations-inventory.md §24; chapter 03 section 3.9). They serve every app; there are no per-app routes.

| Method + path | Semantics |
|---|---|
| `GET /api/app-data/:collection` | List (full array, sorted `createdAt` then id; no pagination - carried contract) |
| `GET /api/app-data/:collection/:id` | Get one; uniform 404 on miss or scope mismatch |
| `POST /api/app-data/:collection` | Create; envelope applied; caller id honored |
| `PUT /api/app-data/:collection/:id` | **Upsert** (carried): update if present, create with the given id if absent |
| `DELETE /api/app-data/:collection/:id` | Delete; idempotent 404-tolerant per current contract |
| `GET/POST/PUT/DELETE /api/app-shared/:collection[/:id]` | Same five operations against the owner's `usr.<id>` scope (server-resolved) |
| `POST /api/app-files`, `GET /api/app-files/:appId/:id`, `DELETE /api/app-files/:appId/:id` | Blob upload/serve/delete; bytes on the filesystem (P-07), metadata rows in the reserved `__files` collection through the engine (carried - reference/data-inventory.md §5.1 app-files) |

Scoping header: `X-Ekoa-App-Id` (slug or canonical id; slug resolved server-side). Errors use the chapter 03 envelope. The SSO routes (`/api/app-sso/*`) and domain-specific served-app routes (`/api/legal/*` etc.) are enumerated in chapter 03; where they persist data they do it through this engine (e.g. the legal transcription rows, e-sign write-backs - reference/data-inventory.md §3.7).

Concrete exchange (normative shapes, using the section 4.2.3 example app):

```
POST /api/app-data/clientes
X-Ekoa-App-Id: gestor-de-clientes
Content-Type: application/json

{ "nome": "Maria Santos", "nif": "123456789", "estado": "ativo" }

201 Created
{ "id": "a1b2c3", "createdAt": "2026-07-05T10:12:00.000Z",
  "updatedAt": "2026-07-05T10:12:00.000Z",
  "nome": "Maria Santos", "nif": "123456789", "estado": "ativo" }
```

```
PUT /api/app-data/clientes/a1b2c3          (upsert: creates with this id if absent)
X-Ekoa-App-Id: gestor-de-clientes

{ "nome": "Maria Santos", "estado": "arquivado" }

200 OK   (merged record, updatedAt advanced, createdAt untouched)
```

```
POST /api/app-data/clientes
{ "nif": "12AB" }                          (fails: nome required, nif pattern)

422 Unprocessable Entity
{ "error": { "code": "VALIDATION_FAILED",
             "message": "Dados inválidos para a coleção clientes.",
             "details": { "fields": [
               { "field": "nome", "rule": "required" },
               { "field": "nif",  "rule": "pattern" } ] } } }
```

Note the response body is the bare item, not a wrapper object - one response shape per endpoint, carried as a rebuild landmine from the current contract (reference/operations-inventory.md §25.1). `_rev` never appears on the wire.

App-data backup/restore operations (status, download, preview, snapshot, restore) carry over as platform API endpoints under `/api/v1/artifacts/:id/...` (chapter 03), executing through the engine. PITR-based restore points are advertised only when the driver supports snapshot reads and the env flag is set (carried - reference/data-inventory.md §3.5); the never-implemented `gcs` restore-point source (conflict C10) is **dropped from v1**, not carried as a stub.

### 4.2.8 Carried semantics checklist

The following eight behaviors are the engine's non-negotiable contract, each carried from production and each requiring at least one automated test (chapter 13):

1. **Scoping**: `(appId, collection)` with the single query-binding point; no unscoped query possible (reference/data-inventory.md §3.3).
2. **Shared scope**: `usr.<ownerUserId>` resolved server-side; `usr.`-prefixed client scope rejected; opt-in via manifest; foreign-Origin blocked (§3.3).
3. **Charset guard**: `^[a-zA-Z0-9._-]{1,100}$` on collection names and app ids, doubling as the header guard (§3.1).
4. **`_rev` CAS**: optimistic-concurrency revision, read-merge-replace with bounded retries, `_rev` never surfaced to clients (§3.2).
5. **Envelope**: `{id, createdAt, updatedAt, ...fields}` built server-side; caller-provided id honored (§3.1).
6. **PUT-upsert**: PUT creates when absent (§3.7, `server.ts` app-data routes).
7. **Seed routing**: every seed write (artifact import, fork, featured seeding) goes through the engine's active driver, never around it - the class of bug fixed by `seedAppData` must not regress (§3.1, conflict C8).
8. **Parity tests**: one test suite, executed against every driver/target the engine supports (§3.7 migration note). In the rebuild the engine has one driver (Mongo wire protocol) and two targets: in-memory MongoDB (`mongodb-memory-server`) for tests and local dev, Firestore Enterprise in production. The suite runs against in-memory Mongo in CI on every build, and once against the real Firestore database as a pre-cutover smoke gate (chapter 10). The current filesystem driver is not carried (P-05 makes Mongo-compat the dev store anyway); the narrow driver contract is kept so a second driver remains cheap if ever needed.

### 4.2.9 What the engine does not do

No per-app server code generation, no per-app processes, no per-app databases (FIXED-5). No LLM calls anywhere in the data path (FIXED-3). No runtime manifest interpretation by a model - manifests are authored at design time by the coding agent and executed by deterministic code (FIXED-4).

## 4.3 Platform domain data on Firestore - RESOLVED (P-05)

**RESOLVED (P-05):** every platform domain store moves from JsonStore JSON files (and per-file directories) to Firestore collections on the same cluster, same driver, same database as app-data.

Rationale: this kills the single worst write-amplification hotspot (the token-events ledger is an unbounded append-only log inside a whole-file-rewrite JsonStore - reference/data-inventory.md §5.1 billing); unifies the backup story; removes the whole-file atomic-rename concurrency model; and gives `takeById`-class operations real atomic primitives.

Rejected alternative: keep JsonStore. Single-process is FIXED-8 anyway, so the in-process mutex would remain sound; the cost is carrying the write-amplification hotspot, the split path conventions (conflict C4), and a second persistence idiom forever.

Resolved: ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

Dev and tests run vanilla MongoDB (`mongodb-memory-server` in tests; a local `mongod` container in dev), production runs Firestore Enterprise. One database; the engine keeps its single `app_data` physical collection; each platform domain gets its own physical collection, listed below. All indexes ship via the out-of-band admin script (carried constraint, reference/data-inventory.md §3.4).

### 4.3.1 Collection-by-collection map

Every store from reference/data-inventory.md §5 and §6.3 appears here with a target or an explicit drop. Key fields are the current shapes carried as-is unless noted; chapter 03 owns any API-visible reshaping.

| Today (file) | Target collection | Doc id / key fields | Tenancy | Transactional / special requirements |
|---|---|---|---|---|
| `users.json` | `users` | `_id` = user id; username, bcrypt passwordHash, role, isActive, preferences | The user table itself | Preserve `preferences.approvedLocalCommandShapes` exactly, including the argv shape-normalization contract (security-relevant consent state - §5.1 users) |
| `sessions.json` | `sessions` | `_id` = session id; userId, title, status, messageCount | `userId`; ownership miss returns uniform not-found (carried `findOwnedSession` semantics in the data helpers) | - |
| (new; RESOLVED (P-03) server-side revocation list) | `revoked_tokens` | `_id` = token jti or token hash; userId, revokedAt, expiresAt | global (platform-auth infrastructure) | Boot-loaded into an in-memory revocation set checked in the auth middleware (chapters 03 and 09 own the behavior); rows self-prune at token `expiresAt` via the P-09 retention sweep (section 4.6). Small by construction - only unexpired, explicitly-revoked tokens live here |
| `messages.json` | `messages` | `_id` = message id; sessionId, role, content, timestamp | via parent session | Index `{sessionId, timestamp}` |
| `session-contexts.json` + `session-history.json` (top-level src, §6.3) | `session_contexts` | `_id` = session id; turn context + capped history | via parent session | Caps carried: 40 msgs/session, 32k chars/msg, 200-session LRU (becomes a retention rule, P-09). Folding these into the sessions domain resolves the three-unrelated-"sessions" naming landmine (conflict C6) |
| `.../company.json` (singleton, inside a legacy content-layer data path - §5.1 company) | `company` | singleton doc `_id` = `default`; name, branding record | global | The legacy path coupling disappears with the removed layer; the every-boot grayscale rewrite migration is not carried (its effect is baked in at import) |
| `memories.json` | `memories` | `_id` = memory id; title, content, type, tags, tier, origin, score, visibility, userId?, attachments | `visibility` + optional `userId`; automation scoping via `automation:<id>` tags | Dual role carried knowingly: human memories AND the automation action cache ride `attachments.payload` (§5.1 memory). `attachments.blobRefs` paths become storage-relative references (P-07). Memory feature scope is P-12 (chapter 05) |
| `artifact-instances.json` | `artifacts` | `_id` = artifact id; typeId, name, userId, status, slug, featured, health, data | `userId` owner; `featured` surfaces regardless of owner | Slug uniqueness via the `slugs` reservation collection (below). Featured working-copy lens inside `data` carried (§5.1 artifact-instances) |
| (in-memory slug index today, §9) | `slugs` | `_id` = slug; artifactId | global | Reservation-doc pattern: insert with `_id` = slug reserves it (duplicate-key error = taken); rename = insert new, update artifact, delete old; boot sweep removes orphaned reservations. Replaces the boot-rebuilt in-memory index |
| `integration-configs.json` | `integration_configs` | `_id` = config id; name, type, config, credentials (ciphertext), platformProvider, needsReauth, ownerUserId?, sessionState (ciphertext) | `ownerUserId` **undefined means global/admin-authored; else owner-only** - this nuance is preserved exactly (§5.1 integration-configs) | Ciphertexts carried byte-compatible (section 4.7); `sessionState` never returned to any client |
| `activity-logs.json` | `activity_logs` | `_id` = log id; userId, username, category, type, timestamp | per-user rows, admin-readable | Single write path (FIXED-8, Registo-ready); the username-stores-id bug is fixed as part of the port (chapter 09). Index `{timestamp}` |
| `jobs/<id>.json` (per-file) | `jobs` | `_id` = job id; agent, userId, status, config, result, error | `userId` | Becomes the persistent job registry of P-10 (chapter 05): boot sweep marks orphaned `running` docs `failed{code:ORPHANED}` |
| `teams.json` | `teams` | `_id` = team id; name, canPublicRelease | global | - |
| `settings.json` (singleton) | `settings` | singleton doc `_id` = `default` | global | The phantom `previewMode` field does not exist and is not carried (conflict C5) |
| `sandboxes/user-<id>/settings.json` (hidden per-user overrides) | `user_settings` | `_id` = user id | per-user | Surfaced as first-class data, out of the sandbox tree (§5.1 settings migration note) |
| `token-events.json` | `token_events` | `_id` = event id; userId, sessionId, agentType, metered + raw token counts, tierWeight, model, timestamp | `userId` | Append-only ledger; one doc per event ends the whole-file-rewrite hotspot. LLM events are written only by the chokepoint metering path (FIXED-3, chapter 06 section 6.5.1); the two non-LLM metered surfaces (STT minutes, Pipedream metered calls) append through `billing/`'s public recording API into the same ledger (chapter 06 section 6.5.6) - no other writer exists. Index `{userId, timestamp}` |
| `billing.json` | `billing_accounts` | `_id` = user id; monthlyBaseTokensUsed, creditBalanceUsd, overageEnabled, currentPeriodStart | per-user | Increments via CAS update (bounded retry) - billing gate reads must never double-apply |
| `automations.json` | `automations` | `_id` = automation id; name, steps[], trigger, ownerUserId | `ownerUserId` | Step type union is the product contract, carried verbatim (§5.1 automations) |
| `automation-runs/<aid>/<rid>/run.json` | `automation_runs` | `_id` = run id; automationId, status, steps[], triggeredBy, pause/consent requests | via parent automation's owner | Step screenshots stay filesystem blobs (P-07), referenced by storage-relative path. Grows-forever is an explicit product decision carried into P-09 (conflict C12). Index `{automationId, startedAt}` |
| `triggers.json` | `triggers` | `_id` = trigger id (opaque UUID, doubles as the public hook URL segment); ownerUserId, target discriminator, kind, integrationKey, secretCiphertext, disabled | `ownerUserId` server-trusted, never derived from a request (carried - §5.1 triggers) | The store's lifecycle change bus stays an in-process event emitter at the service layer - sound because single-process is FIXED-8; no Firestore listeners needed |
| `app-sessions.json` | `app_sessions` | `_id` = session token; appId (canonical, never slug), email, expiresAt, graphTokensEnc (ciphertext) | per-app isolation enforced by `session.appId === target appId`, not cookie path (carried) | TTLs carried (8h); opportunistic expiry sweep + timer carried (no reliance on TTL indexes) |
| `app-sso-pending.json` | `app_sso_pending` | `_id` = state; nonce, pkceVerifier, returnUrl, expiresAt | per-app | **Single-use consume** (anti-replay): atomic `findOneAndDelete` replaces JsonStore `takeById` (§5.1 app-sessions; §10.2). 10-min TTL carried |
| `adobe-agreements.json` | `adobe_agreements` | `_id` = Adobe agreementId; appId, propostaId, ownerUserId, clientEmail | `ownerUserId` scopes credential lookup | Webhook never trusts it for signature state - always re-fetches owner-scoped (carried - §5.1 adobe-agreements) |
| `knowledge/sources.json` | `knowledge_sources` | `_id` = source id; url, kind, crawl config, seedId | global (admin-managed) | Seed idempotency via `seedId` lookup carried; the check-then-act seed lock becomes insert-with-deterministic-id |
| `knowledge/uploads.json` | `knowledge_uploads` | `_id` = upload id; filename, collection, docIds[], status | global | `storedPath` is an absolute path today - becomes a storage-relative reference (carried requirement - §5.2 uploads) |
| `projects/user-<id>/<id>.json` | **DROPPED** | - | - | Vestigial: zero consumers outside its own persistence module (§5.1 projects). Recorded as a data orphan; not migrated |
| Legacy content-layer data files (`<dataDir>` per-app JSON, §7.1 row 1) | **DROPPED** (except company, migrated above) | - | - | The layer that wrote them does not exist in the rebuild (FIXED-4) |

Explicitly **in-memory** state stays in-memory - traces ring buffer, SSE replay buffers, device-login pending codes, app registry, daemon-bridge connection registry (reference/data-inventory.md §9). The rebuild must not invent persistence for these; single-process is FIXED-8, and P-10 (chapter 05) covers the one exception (job registry) via the `jobs` collection above.

### 4.3.2 Index inventory (out-of-band admin script)

All indexes are created by the admin-identity script, never by the runtime user (carried constraint - reference/data-inventory.md §3.4). Initial set; additions require updating this list and the script in the same unit of work (FIXED-12 discipline applies to this table as a data-shape artifact):

| Collection | Index | Serves |
|---|---|---|
| `app_data` | `{appId, collection, 'item.createdAt'}` and `{appId}` | Engine list/get paths (carried) |
| `messages` | `{sessionId, timestamp}` | Session transcript reads |
| `token_events` | `{userId, timestamp}` | Billing period queries, retention sweep |
| `activity_logs` | `{timestamp}`, `{userId, timestamp}` | Audit reads, retention sweep |
| `automation_runs` | `{automationId, startedAt}` | Run history (replaces mtime-desc directory listing) |
| `jobs` | `{status}`, `{userId, createdAt}` | P-10 orphan sweep, per-user job lists |
| `artifacts` | `{userId}`, `{featured}` | Gallery and starting-points queries |
| `memories` | `{tier}`, `{tags}` | Resolver candidate narrowing (scoring stays in code) |
| `app_sessions` | `{expiresAt}` | Expiry sweep |
| `triggers` | `{ownerUserId}`, `{kind}` | Owner lists, listener supervision |
| `revoked_tokens` | `{expiresAt}` | Boot-load scan + retention self-prune (RESOLVED (P-03); section 4.3.4) |
| `anonymisation_deny_lists` | `{tenantId}` | Deny-list load per tenant (chapter 17.4; section 4.3.4) |
| `bridge_pairings` | `{tenantId}`, `{userId}` | Pairing lookup and revoke (chapter 18.3; section 4.3.4) |

No unique indexes anywhere: uniqueness is always the deterministic-`_id` insert pattern (section 4.1), which works under the least-privilege runtime user and needs no admin round-trip when new uniqueness constraints appear.

### 4.3.3 JsonStore semantics mapping

The JsonStore primitives that callers depend on map to Mongo-compat primitives as follows (normative under P-05):

| JsonStore primitive | Replacement |
|---|---|
| `update(id, patch, validate)` - validate runs on the merged record inside the lock | CAS loop: read, merge, validate merged record, `replaceOne({_id, _rev})`, bounded retries (mirror of the engine's own CAS - §3.2) |
| `takeById` - atomic find+remove, single-use nonce semantics | `findOneAndDelete` (single-document atomic) |
| `deleteWhere` | `deleteMany` with the same predicate, always scope-bound |
| `replaceAll` (bulk swap) | Only the knowledge crawl ledger uses this at scale, and it stays on the filesystem (section 4.4.1) |
| Whole-file atomic rename + `.tmp` crash recovery | Not needed; document writes are atomic |

### 4.3.4 Amendment data surfaces: anonymisation and the local bridge

The 2026-07-06 anonymisation and local-file-access amendment (chapters 17 and 18) adds a small, precise data footprint. This section owns the storage statement for each surface; chapters 17 and 18 own the behavior.

**Persisted** (Firestore collections on the same cluster):

| Surface | Target collection | Doc id / key fields | Tenancy | Special requirements |
|---|---|---|---|---|
| Per-tenant anonymisation deny-lists | `anonymisation_deny_lists` | `_id` = entry id; tenantId, value (ciphertext), entityClass, addedBy, addedAt | tenant-scoped (one tenant today under FIXED-8; the scoping is structural for the hosted multi-tenant future) | Secret-material: entries are encrypted at rest with a tenant-scoped key through the one crypto module (section 4.7), never returned in cleartext to any client, and every read is access-logged to the Registo write path. Chapter 17.4 owns detection semantics |
| Bridge pairing registry | `bridge_pairings` | `_id` = pairing id; tenantId, userId, createdAt, revoked (boolean) | tenant-scoped, `userId`-owned | Small collection; the `revoked` flag is the server-side kill switch - a revoked row can never re-authorize a daemon connection. Chapter 18.3 owns pairing semantics |

Both carry the narrowing indexes listed in section 4.3.2.

**Deliberately NOT stored** (in the spirit of the in-memory list at the end of section 4.3.1):

- **The anonymisation vault is not a store.** Token-to-cleartext mappings live per session, in memory, under a TTL; they are never persisted, never written to any collection, and never captured in a backup (chapter 17.5; the Ekoa Local v2 brief decision A6-D1). The vault is keyed by the propagated session identity, so there is exactly one vault per conversation across both the hosted and the delegated faces; a process restart drops every vault, which is the intended durability (there is nothing to recover).
- **Daemon ledger rows are not persisted hosted by default.** The local file-access ledger is served live by the daemon and read through the bridge; the hosted side keeps no copy of ledger rows by default (chapter 18; the Ekoa Local v2 brief A2.4). What the hosted side retains is audit metadata only, below.

**Audit rides the existing Registo write path.** Anonymisation audit events are written through the same single audit/Registo write path as every other audited action (FIXED-8; the `activity_logs` collection of section 4.3.1), carrying metadata only - entity classes, per-class counts, the correlation id, and a payload hash - never request or response bodies, and never the vault contents (chapter 17.6). No parallel audit store is introduced.

## 4.4 Deliberate exceptions: filesystem and SQLite

All filesystem paths in the rebuild derive from **one** configured data directory. The current split - 14 stores hardcoding the home path and ignoring the env override while others honor it (conflict C4) - is not carried; it works today only because production never sets the override. The brand-asset cache also moves inside the data directory, ending the sibling-of-data-dir volume trap (reference/data-inventory.md §7.2). One-shot migration sentinel files are not carried; their effects are baked into the migrated data (section 4.8).

### 4.4.1 Knowledge vault + lexical index (normative exception)

- The markdown vault (~8 GB, ~254k docs, one file per doc with frontmatter) stays a filesystem corpus: the lexical search design (SQLite FTS5 preferred, ripgrep fallback over the same files) depends on it, and Firestore is a poor fit for 254k markdown bodies (reference/data-inventory.md §5.2).
- The FTS5 index (~6 GB SQLite) is **derived data**: regenerable, never migrated, must persist across restarts to avoid the ~9-minute backfill (§6.2). The rebuild ports the behavior (accent-folded BM25 + collection-authority ranking, write/delete hooks, startup backfill, admin reindex), not the file.
- The crawl ledger (per-source JSON files, bulk-replaced each run, up to tens of thousands of rows) stays filesystem, colocated with the vault - its churn profile is wrong for per-document writes (§5.2 ledger).
- Raw uploaded knowledge files are blobs (P-07); their registry rows move to Firestore (`knowledge_uploads`, section 4.3.1).

### 4.4.2 Sandboxes, git, browser profiles (normative exception)

Per-user sandbox trees - artifact source, per-artifact git history, chat upload staging, persistent Chromium automation profiles - are **workspace state, not database state** (reference/data-inventory.md §7.3). They stay on the filesystem under the data volume, tenancy expressed by the `user-<id>` directory name and enforced by the path-confinement helpers (chapter 09). Durability beyond the volume comes from the GitHub mirror (chapter 07). The unconfined arbitrary-path file primitives flagged in reference/data-inventory.md §7.5 are a security decision owned by chapter 09 (P-15); this chapter only records that they are NOT part of the collections engine or any data-layer contract.

### 4.4.3 Event queue - RESOLVED (P-06)

**RESOLVED (P-06):** the webhook/listener event queue stays a local SQLite WAL database.

Rationale: its semantics are a precise fit for SQLite and already proven - `UNIQUE(trigger_id, dedup_key)` as the entire idempotency mechanism, atomic claim via `UPDATE...RETURNING`, retry ladder 30s/2m/10m/1h/6h with jitter then dead-letter, boot recovery of stuck rows (reference/data-inventory.md §6.1). Single-process is FIXED-8, so a local queue is sound. Raw webhook bodies are stored as BLOBs and can exceed document-size limits on a document store, which makes a naive Firestore port actively worse (§6.1 migration note).

Rejected alternative: Cloud Tasks or Pub/Sub plus a Firestore state collection - buys managed durability, costs a redesign of claim/retry/dedup semantics and adds a cloud dependency to local dev. The queue is encapsulated behind the `events/` module (chapter 02); swapping it later does not touch the API surface, so nothing is foreclosed.

Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

### 4.4.4 Blobs - RESOLVED (P-07)

**RESOLVED (P-07):** blob bytes stay on the filesystem in v1; every blob reference in any store becomes a **storage-relative key** resolved by a single blob-path module, so a later move to GCS is a driver swap, not a data migration.

- Covered blob families (all filesystem-pinned today regardless of backend - reference/data-inventory.md §10.3): app-file bytes (metadata in `__files` via the engine), automation step screenshots, artifact screenshots and PDFs, brand-asset cache, knowledge raw uploads, app-data snapshot dumps, and the regenerable featured-build output (build cache, not data).
- Absolute or data-dir-relative path fields (`blobRefs`, `storedPath`, `screenshotPath`) are rewritten to storage-relative keys at import time (section 4.8).

Rejected alternative: move blobs to GCS now - buys off-volume durability immediately, costs signed-URL serving work and a cloud dependency in dev while nothing currently demands it. The existing nightly GCS DR export script pattern (§3.6) covers disaster recovery in the interim.

Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 4.5 Supabase control plane - RESOLVED (P-08)

**RESOLVED (P-08):** Supabase remains the control plane, reduced to exactly the three live tables; the ~9 dead tables from the abandoned control-plane billing/pool design are not carried (reference/data-inventory.md §4.3, conflict C7).

Rationale: it works, it is isolated (raw PostgREST fetch client, 10s timeout, no SDK dependency - §4.1), and the OAuth custody semantics are subtle and load-bearing; moving them during a rebuild adds risk for no product gain.

Rejected alternative: fold the three tables into Firestore - one less external system, but the rotation semantics must be re-proven and the license plane loses its independence from the product data plane.

Resolved: ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

The three tables and their contract (carried verbatim from reference/data-inventory.md §4.2):

| Table | Role |
|---|---|
| `standalone_credentials` | Claude OAuth token custody, one row per installation |
| `companies` | License lookup: must exist and be `active`; tier-to-feature map |
| `installations` | Installation must exist, belong to the license's company, be `active`; `last_seen_at` heartbeat patched fire-and-forget |

**Load-bearing OAuth rotation semantics** - the rebuild reproduces every one of these exactly (reference/data-inventory.md §4.2, §4.4 migration note):

1. **Persist-first-then-commit** on refresh: the rotated token pair is written to Supabase before the process starts using it.
2. **Single-writer refresh mutex**: one refresh in flight per process; concurrent callers await the same promise.
3. **Jittered proactive refresh** at 45-60% of token TTL.
4. **20-minute watchdog** with the four recovery modes, including adopting a peer installation's rotated token.
5. **Keep-row-on-401/invalid_grant**: a refresh rejection never deletes the stored row - a peer may have rotated it; the dead `deleteStoredCredentials` code path (conflict C11) is not carried.
6. **Env fallback is break-glass only** and flagged as such in health/status surfaces.
7. The process keeps `CLAUDE_CODE_OAUTH_TOKEN` in the SDK subprocess environment in sync after every rotation (FIXED-8: managed OAuth only, no raw API keys, no fallback to `~/.claude` auth).
8. Boot gating carried: missing Supabase configuration is fatal at startup; a missing credentials row is non-fatal (the watchdog retries).

## 4.6 Retention policy - RESOLVED (P-09)

Today several stores grow forever (reference/data-inventory.md §10.9, conflict C12). The rebuild encodes the following defaults as named config constants, enforced by a daily in-process sweep (single process, FIXED-8). The values below are the accepted policy; because they are constants, the founder can override any value before launch without code changes.

| Store | Today | v1 policy (recommendation) | Notes |
|---|---|---|---|
| `token_events` | Grows forever | Keep raw events 13 months; write monthly per-user rollup docs (kept forever) at period close | Billing ground truth; 13 months covers a full year of dispute window |
| `activity_logs` | Grows forever | Keep 12 months | Single write path preserved; the sweep is a reader-side concern |
| `automation_runs` | Grows forever **by explicit user direction** (C12) | Keep run documents forever (carried decision); prune step screenshots older than 180 days; provide an admin manual-prune endpoint | Do not silently reverse the founder's call; only the blob weight is trimmed |
| `messages` | Grows forever | No automatic retention (product data) | Revisit only with founder consent |
| `jobs` | Per-file, no retention | Delete completed/failed/cancelled jobs after 90 days | Registry stays lean for the P-10 orphan sweep |
| `revoked_tokens` | New (RESOLVED (P-03)) | Delete rows past their own `expiresAt` in the daily sweep | Bounded by construction - a revoked token past expiry is already rejected on expiry grounds, so the row is dead weight (sections 4.3.1, 4.3.4) |
| `webhook_audit` (SQLite) | Grows forever | Keep 90 days | Local table, cheap sweep |
| `session_contexts` | Capped in code | Carry the caps (200-session LRU, 40 msgs, 32k chars) as the retention rule | Behavior-preserving |
| App-data snapshots | User-managed + nightly | Keep all manual; keep last 10 safety-net per app; keep nightly 30 days | Snapshot kinds carried from reference/data-inventory.md §7.1 |

Rejected alternative: no retention anywhere (status quo). Not taken because the token ledger and screenshots have measurable unbounded cost; the values are constants and the sweep is additive, so any row can be retuned before launch.

Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 4.7 Secrets and crypto (FIXED-8 baseline) - RESOLVED (P-14)

- **One crypto module.** Today there are two parallel AES-256-GCM implementations - a shared module and an inline duplicate with the same format and key derivation - both falling back to the same insecure default key constant, which has no production guard (reference/invisible-behaviors.md §3.1, Conflicts #4 and #5; chapter 09 invariant 6). The rebuild has exactly one module (placement in the module map is chapter 02's; the requirement here is singularity), used by every store field that holds ciphertext.
- **Ciphertext compatibility.** Algorithm (AES-256-GCM) and ciphertext wire format are carried byte-compatible so migrated rows decrypt without a re-encryption pass, provided the key is preserved (reference/data-inventory.md §10.10). Encrypted-at-rest fields: integration credentials, trigger HMAC secrets, captured browser `sessionState`, delegated Graph tokens in `app_sessions`.
- **`ENCRYPTION_KEY` is mandatory** in every environment: the process refuses to boot without it, and no default key constant exists anywhere in the codebase. The dev bootstrap script generates a key into the local env file. This extends the existing JWT production guard to the encryption key (FIXED-8; chapter 09 invariant list).
- **Decryption at the edge of use only** (carried invariant): credentials are decrypted just-in-time at execution and are never exposed to any LLM context or client response (FIXED-8).

**RESOLVED (P-14):** defer KMS integration. v1 keeps the single env-provided key (now mandatory, no default); the crypto module isolates key resolution behind one function so envelope encryption can be added without touching call sites.

Rejected alternative: GCP KMS envelope encryption from day one - stronger custody, but adds a cloud dependency to boot and to local dev while the threat model (single-tenant process, encrypted volume) does not demand it yet.

Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 4.8 Migration implications (summary; chapter 10 owns the procedure)

1. **App-data: no migration.** Production app-data is already on Firestore via the same driver and document shape the engine keeps - subject to Q-02 verification of the actual prod env value before cutover. Dev filesystem app-data is imported through the engine by a one-shot script.
2. **Domain stores**: one-shot import scripts read each JsonStore/per-file store and write the target collections from section 4.3.1, using existing ids as deterministic `_id`s (idempotent re-runs). Run during the cutover freeze (chapter 10).
3. **Legacy one-shot migrations and sentinel files are not carried**; the importers operate on post-migration data, so their effects are baked in.
4. **Ciphertexts move verbatim** with the preserved key (section 4.7); no re-encryption pass.
5. **Blob trees are copied** onto the new data volume; path-bearing fields (`blobRefs`, `storedPath`, `screenshotPath`) are rewritten to storage-relative keys during import (P-07).
6. **Knowledge volume is reattached**, not migrated; the FTS index rides along if present, else the backfill rebuilds it (~9 min, acceptable).
7. **Sandboxes are copied** with git histories intact.
8. **Supabase is untouched at cutover**; the nine dead tables are dropped in a separate control-plane cleanup after the new stack is stable (P-08).
9. **Slug reservations are seeded** from the imported artifacts; duplicate slugs (possible only via historical bugs) are resolved deterministically by suffixing, and every such resolution is logged to the build journal (chapter 14 RUN_LOG discipline).
10. **Event queue starts fresh**: the old queue is drained before the freeze (chapter 10 cutover criteria); `triggers.db` is not copied.
11. **Parity/smoke gates**: the engine test suite green against in-memory Mongo in CI, and once against the production Firestore database pre-cutover; the legal e2e suite green against the new data plane (chapter 10 criteria).

## 4.9 Conflicts and open questions recorded by this chapter

- **C1 / Q-02 - production backend value unverified.** Code, provisioning scripts, and integration docs all say production app-data runs on Firestore (Mongo-compat, project `spatial-tempo-488909-s5`, db `ekoa-app-data`), but the literal production env value lives in the external ekoa-deploy repo and was not verifiable from this machine (reference/data-inventory.md §1, Conflicts C1). This spec assumes Firestore-in-prod; **Q-02: verify the production value in ekoa-deploy before cutover.** If production turns out to run the filesystem driver, item 1 of section 4.8 becomes a real data migration and chapter 10's plan must be amended before the freeze. Resolved cutover-class: confirmed as a cutover-checklist ops action, answered at cutover, not at run start (ch16 Q-02, mapped to chapter 10 cutover criterion 6); the verification obligation and the Firestore-in-prod assumption are unchanged.
- **Q-03 - PITR maturity.** Point-in-time snapshot reads on the Mongo-compat surface were Preview, not GA, at research time, and Node-driver support for the snapshot-timestamp mechanism was unverified; current code degrades honestly when unsupported (reference/data-inventory.md §3.5, Conflicts C9). **Q-03: re-verify PITR GA status and driver support before advertising PITR restore points in the rebuilt product.** Until verified, the backups UI must not promise time-travel restore beyond local snapshots. Relatedly, this chapter's single-document-atomicity design rule (section 4.1) exists so that no correctness property depends on multi-document transaction support on that surface. Resolved cutover-class: confirmed as a cutover-checklist external-verification action (ch16 Q-03, mapped to chapter 10 criterion 9); posture unchanged - the backups UI stays silent on time-travel restore until PITR is verified.
- **C4** (data-dir path split), **C6** (three "sessions" stores), **C10** (`gcs` restore stub), **C11** (dead credential-delete path), **C12** (grows-forever stores) are resolved by explicit decisions in sections 4.4, 4.3.1, 4.2.7, 4.5, and 4.6 respectively - none silently.

## 4.10 Acceptance criteria (checkable without a human)

1. Every store enumerated in reference/data-inventory.md §5, §6, and §7 appears in this chapter with a target collection, a normative exception, or an explicit DROP - verified by cross-reading the tables above (audit script may grep store names).
2. The manifest zod schema in section 4.2.3 compiles and successfully parses the example manifest in the same section; a manifest with `scope: "shared"` and no `sharedData: true` fails validation.
3. Each of the eight carried semantics in section 4.2.8 has at least one automated test in the engine suite (chapter 13 test inventory names them).
4. The engine suite passes against `mongodb-memory-server` in CI; the same suite passes once against the production Firestore database before cutover (chapter 10 gate).
5. An app with no `collections` block exhibits exactly today's data-plane behavior; the ported legal e2e suite passes without modifying any app bundle.
6. The API process refuses to boot when `ENCRYPTION_KEY` or the Supabase configuration is absent; no default key constant exists in the repository (grep gate).
7. All Anthropic traffic remains outside this chapter's scope by construction: no data-layer module imports the LLM module or any Anthropic SDK (lint gate, FIXED-3).
8. Retention constants from section 4.6 exist as named config values and the daily sweep is covered by a unit test per policy row.
9. The `revoked_tokens`, `anonymisation_deny_lists`, and `bridge_pairings` collections each appear in section 4.3.1 or 4.3.4 with a documented shape and tenancy and a matching index in section 4.3.2; the `revoked_tokens` daily sweep (deleting rows past `expiresAt`) is covered by a unit test.
10. No persistence module writes the anonymisation vault to any store, and no backup manifest includes it (grep gate over the persistence layer, section 4.3.4); anonymisation audit rows validate against a metadata-only schema (entity classes, counts, correlation id, payload hash) with no request/response body fields.
11. `anonymisation_deny_lists` values are persisted only as ciphertext produced by the single crypto module (section 4.7); a read path that returns cleartext deny-list values to a client fails the test.

---

**Amendment record.** Amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md): P-05, P-06, P-07, P-08, P-09, P-14, and P-23 resolved and folded normative; the P-03 server-side revocation list added as the `revoked_tokens` collection (section 4.3.1); Q-02 and Q-03 recorded as cutover-class resolutions (section 4.9); and the anonymisation and local-bridge data surfaces stated in section 4.3.4 (the vault and daemon ledger deliberately not stored; per-tenant deny-lists and bridge pairings persisted).
