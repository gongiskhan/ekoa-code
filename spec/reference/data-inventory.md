# Data Inventory — The Real Persistence Picture

This document is the authoritative inventory of every place Cortex reads or writes data: the Firestore-backed (MongoDB wire protocol) app-data plane, the Supabase control plane, the JsonStore/SQLite/filesystem domain stores, blob/asset locations, per-user sandboxes, and repo-versioned content read at runtime. For each item it records the shape, key fields, how tenancy is expressed, its writers/readers, and the migration implication for the rebuild (Firestore-first with a collections engine for user-app data). Docs in this repo (CLAUDE.md, docs/) are materially stale on persistence; every claim here is derived from source and cited `file:line`, and every doc/code contradiction is recorded in the Conflicts section at the end rather than resolved silently.

**Method:** derived from code at commit `3882aa6` (HEAD), repo `/Users/bazinga/dev/ekoa-dev`. Docs treated as hints only. Evidence gathered by two finder sweeps (Firestore/Supabase/backend-selection; persistence layer + filesystem), then spot re-verified against source before writing. Paths below are relative to `cortex/src/` unless noted. `dataDir` = `EKOA_DATA_DIR || ~/.ekoa/data` (`config.ts:27`); `SANDBOX_ROOT` = `SANDBOX_ROOT || ~/.ekoa/sandboxes` (`persistence/settings.ts:6`).

---

## 1. Executive summary — what is actually true

- **There is no Firestore/Firebase/GCP SDK anywhere in cortex.** `cortex/package.json` has no `firebase`, `firebase-admin`, or `@google-cloud/*` dependency, and `GOOGLE_APPLICATION_CREDENTIALS` appears nowhere in `cortex/` (verified by grep at HEAD). Firestore is reached exclusively over the **MongoDB wire protocol** — Firestore *Enterprise edition with MongoDB compatibility* — via the `mongodb` npm driver (`cortex/package.json` dep `"mongodb": "^6.21.0"`; `persistence/app-data-mongo.ts:2`, header comment `app-data-mongo.ts:6-9`).
- **The Firestore/Mongo path covers exactly one data family: per-artifact "app-data"** (records persisted by user-built served apps). Everything else — users, sessions, artifacts, memories, billing, integrations, teams, automations, triggers, knowledge registries — is JsonStore JSON files, two local SQLite databases, or per-file directories, none of it switchable (§5, §6).
- **The backend switch is a single lazy env read** `EKOA_APP_DATA_BACKEND = 'fs' (default) | 'mongo'` inside the persistence layer (`persistence/app-data.ts:70`), not in `config.ts`. `config.ts` has no storage-mode knob; its only persistence-relevant value is `dataDir` (`config.ts:27`). `cortex/src/data/` contains only scaffold templates, no storage config.
- **Dev runs `fs`** (`cortex/.env` sets no `EKOA_APP_DATA_BACKEND`). **Production is claimed to run `mongo` = Firestore** by code comments (`index.ts:128-129`, `app-data-mongo.ts:7-9`) and by `docs/firestore-integration/PROVISIONING.md` + `cortex/scripts/firestore-provision.sh:80-86` (project `spatial-tempo-488909-s5`, region `europe-west1`, db `ekoa-app-data`, `EKOA_APP_DATA_PITR=1`). The actual prod env lives in the external `ekoa-deploy` repo, which is not present on this machine — **the prod value could not be confirmed from source; open verification item** (Conflicts C1).
- **Supabase is control plane only**: exactly 3 tables touched (`standalone_credentials`, `companies`, `installations`) via a raw-fetch PostgREST client (`services/supabase-client.ts` — no `@supabase/supabase-js`). Claude OAuth token custody + license validation. Several tables in `supabase/migrations/` are dead schema (§4.3, Conflicts C7).
- **Blob/asset reality:** binary app files, screenshots, PDFs, brand-asset caches, knowledge raw uploads, and automation step screenshots all live on the local filesystem — even when the app-data backend is mongo (`persistence/app-data.ts:30-38`). The only GCS touchpoint is a script-only nightly DR export via `gcloud storage cp` (§3.6).

---

## 2. Backend selection — the one switch

| Env var | Meaning | Citation |
|---|---|---|
| `EKOA_APP_DATA_BACKEND` | `'fs'` (default) or `'mongo'` — selects the app-data driver only | `persistence/app-data.ts:70` |
| `EKOA_APP_DATA_MONGO_URI` | required when `mongo`; missing → throw at first use | `app-data.ts:72-75` |
| `EKOA_APP_DATA_MONGO_DB` | Mongo database name, default `ekoa` | `app-data-mongo.ts:44` |
| `EKOA_APP_DATA_MONGO_COLLECTION` | physical collection name, default `app_data` | `app-data-mongo.ts:45` |
| `EKOA_APP_DATA_MONGO_CREATE_INDEXES=1` | opt-in index creation (see §3.4) | `app-data-mongo.ts:68` |
| `EKOA_APP_DATA_PITR=1` | advertise PITR restore points to users | `services/app-data-backups.ts:59` |
| `EKOA_DATA_DIR` | fs driver root; also snapshots + app-files even under mongo | `app-data-fs.ts:35`, `app-data.ts:36` |

Backend is a lazily-built singleton (`getAppDataBackend`, `app-data.ts:84-87`) with boot-time fail-fast init for mongo — "a bad connection string should stop startup rather than surface as per-request 500s; fs init is a no-op" (`index.ts:128-136`; `initAppDataBackend`, `app-data.ts:90-93`). Test seam: `setAppDataBackendForTesting` (`app-data.ts:96-98`). The served-app HTTP contract is identical under both drivers, enforced by a parity suite that runs one test body against both (fs temp dir + `mongodb-memory-server`): `cortex/tests/persistence/app-data-backend-parity.test.ts:10-17`.

Auth to Firestore is a Mongo connection-string user/password (a scoped DB user with `roles/datastore.user`), **not** `GOOGLE_APPLICATION_CREDENTIALS`/ADC. GCS uploads (script-only) use the operator's `gcloud` CLI auth.

**Full backend matrix (nothing else is switchable):**

| Family | Backend | Switchable? |
|---|---|---|
| App-data (per-artifact records) | fs (`{dataDir}/app-data/{appId}/{collection}.json`) OR Firestore-Mongo | **YES — the only switch** |
| App-files (binary uploads) | filesystem always, even under mongo (`app-data.ts:30-38`) | No |
| Domain stores (users, sessions, artifacts, …) | JsonStore JSON files under `~/.ekoa/data` | No |
| Event queue (webhooks/listeners) | SQLite WAL `~/.ekoa/data/triggers.db` (`persistence/event-queue.ts:26-29`) | No (path env only) |
| Knowledge FTS index | SQLite FTS5 `{dataDir}/knowledge/index.db` (`services/knowledge-fts.ts:45-47`) | No (ripgrep fallback) |
| Chat turn context/history | Plain JSON `{dataDir}/session-contexts.json` + `session-history.json` (`src/sessions.ts:16-27`) | No |
| Control plane (OAuth tokens, license) | Supabase PostgREST | No (mandatory at boot) |
| DR export | GCS bucket, script-only | n/a |

---

## 3. Firestore (MongoDB compatibility) — the app-data plane

### 3.1 Contract and facade

- `StorageBackend` — frozen 6-method contract: `list / get / create / update / delete / listCollections` plus optional `init/close/readAsOf` and a `kind` tag (`persistence/app-data-backend.ts:22-42`).
- `AppDataItem` = `{ id, createdAt, updatedAt, ...user fields }` (`app-data-backend.ts:15-20`); envelope built by `buildNewItem` (`app-data-backend.ts:54-61` — honours a caller-provided `id`).
- `isValidCollection` — `^[a-zA-Z0-9._-]+$`, max 100 chars; guards collection names AND appIds, doubling as fs path-traversal protection and the REST-layer `X-Ekoa-App-Id` header guard (`app-data-backend.ts:44-51`).
- Facade `appDataStore` / `getAppDataBackend()` (`persistence/app-data.ts:121-140`, re-exported `persistence/index.ts:62`). `getAppDataDir(appId)` always returns the FS path even under mongo — app-files and per-artifact git colocate there (`app-data.ts:27-38`).
- `seedAppData` routes import/fork seed writes through the ACTIVE backend so mongo is never silently missed (`app-data.ts:100-119`) — this fixed the pre-existing bypass documented as Caveat A in `docs/firestore-integration/FINDINGS.md` (Conflicts C8).

### 3.2 Physical data model (mongo driver)

**One physical collection holds everything** (default `app_data` in db `ekoa`; both env-overridable, `app-data-mongo.ts:44-45`). Logical app collections are a *field*, not physical collections. Document shape (`AppDataDoc`, `app-data-mongo.ts:24-33`):

```
{
  _id:        "<appId>::<collection>::<itemId>",   // deterministic; idempotent uniqueness w/o unique index
  appId:      string,                              // scope key 1
  collection: string,                              // scope key 2 (the app's logical collection name)
  item:       AppDataItem,                         // user record, nested so user fields never collide with scope keys
  _rev:       number                               // optimistic-concurrency revision; internal, never surfaced
}
```

Method semantics (`app-data-mongo.ts`): `list` sorted by `item.createdAt` then `_id` (:95); `get` with defense-in-depth scope re-check even though `_id` encodes scope (:104); `create` inserts `_rev: 0` (:111-117); `update` = read-merge-in-JS + CAS `replaceOne({_id, _rev})`, up to 6 retries, cross-instance safe (:121-143 — deliberately NOT `$mergeObjects`, which would mangle dotted keys and `$`-prefixed string values); `delete` by `_id` (:145-149); `listCollections` = `distinct('collection', {appId})` (:151-155).

**FS driver equivalent** (`persistence/app-data-fs.ts`): `{dataRoot}/app-data/{appId}/{collection}.json`, whole-array atomic rewrite (`.tmp` + rename), per-`(appId,collection)` chained-promise lock (:20-58), `.tmp` crash recovery (:60-73).

### 3.3 Tenancy / scoping

- Scoping is **`(appId, collection)` — single-company model, no per-user partition by design** (`app-data-backend.ts:10-12`).
- **Single binding point for appId**: every mongo query is built through `scope()`/`docId()` — "No method issues an unscoped query — this is the explicit replacement for the structural isolation the filesystem path gave us for free" (`app-data-mongo.ts:18-21, 48-54`).
- **Per-owner shared namespace**: reserved scope-key prefix `usr.` — scope `usr.<ownerUserId>` shared across all artifacts of one Ekoa user that opt in via manifest `sharedData: true` (`app-data.ts:41-65`: `SHARED_SCOPE_PREFIX`, `sharedScopeKey`, `isReservedScope`). Client-supplied `X-Ekoa-App-Id` starting with `usr.` is rejected; the shared namespace is reachable only via `/api/app-shared` routes whose scope is resolved server-side (`services/shared-data-scope.ts:33-51` — owner from appRegistry, refuses unknown owner, 403 for non-opted-in apps; foreign-Origin block at :54+).
- REST-layer scoping: `X-Ekoa-App-Id` header (slug→canonical-id resolved in `server.ts` around :1180), **no JWT on the app-data plane**.

### 3.4 Firestore-specific operational constraints (encoded in code)

- **Index creation is opt-in** (`EKOA_APP_DATA_MONGO_CREATE_INDEXES=1`) because a least-privilege Firestore Mongo-compat user (`roles/datastore.user`) cannot create indexes, and **Firestore drops the connection when an admin command is denied — poisoning the pool** (`app-data-mongo.ts:60-75`). Indexes (`{appId, collection, 'item.createdAt'}` and `{appId}`) are created out-of-band with an admin identity via `cortex/scripts/firestore-create-indexes.mjs:23-26`.
- **Fail-fast boot**: mongo backend connects at startup (`index.ts:128-136`).
- Provisioning script `cortex/scripts/firestore-provision.sh` (dry-run by default): Firestore Enterprise with `--enable-mongodb-compatible-data-access --enable-pitr`, versioned GCS bucket, budget alert; defaults project `spatial-tempo-488909-s5`, region `europe-west1`, db `ekoa-app-data` (:24-27, 53-60).

### 3.5 PITR (point-in-time recovery)

- `MongoStorageBackend.readAsOf(appId, atUnixSeconds)`: mongo **snapshot session** (`startSession({snapshot: true})` + `setSnapshotTimestamp(new Timestamp({t, i: 0}))`) — explicitly NOT `readConcern:'snapshot'`/`atClusterTime`. Requires Firestore with PITR enabled; vanilla MongoDB (incl. `mongodb-memory-server`) throws `PITR_DRIVER_UNSUPPORTED` — "the correct, honest behaviour" (`app-data-mongo.ts:157-183`; test `cortex/tests/persistence/app-data-pitr-readasof.test.ts`).
- Advertised only when the backend exposes `readAsOf` AND `EKOA_APP_DATA_PITR === '1'` (`isTimeTravelCapable`, `services/app-data-backups.ts:49-60`). PITR restore points are whole-minute marks (`app-data-backups.ts:139-142`, rounding at :186).
- `docs/firestore-integration/FINDINGS.md` Caveat D: PITR + snapshot reads on the Mongo-compat surface were **Preview, not GA** at research time (2026-06-08), Node-driver `setSnapshotTimestamp` support unverified. **Rebuild must re-verify** (Conflicts C9).

### 3.6 GCS (Google Cloud Storage)

- **No GCS SDK, no serving-path GCS reads.** The only touchpoint is `cortex/scripts/app-data-nightly-export.mjs` — cron-intended DR export of every app's data (works against either backend) to `gs://<bucket>/<env>/<appId>/<YYYY-MM-DD>.json`, uploaded by shelling out to `gcloud storage cp` (:74-76); default bucket `spatial-tempo-488909-s5-ekoa-app-data-exports` (:26); dry-run by default. Bucket provisioned versioned by `firestore-provision.sh:62-66` ("GDPR-clean per-object delete + history"). Also `cortex/scripts/export-app-data.mjs` for one-shot local export.
- **`'gcs'` restore-point source is a stub**: `RestorePointSource` includes `'gcs'` (`app-data-backups.ts:31`) and the handler accepts it (`handlers/app-data-backups-handler.ts:33`), but `previewAsOf` throws `Unsupported restore-point source` for anything not `local`/`pitr` (`app-data-backups.ts:194`) and nothing ever creates a `gcs` point (Conflicts C10).

### 3.7 Consumers of app-data (complete)

All access funnels through the facade. Consumers:

| Consumer | Access | Citation |
|---|---|---|
| `server.ts` `/api/app-data/:collection[/:id]` GET/POST/PUT/DELETE | Per-app CRUD for served apps (header-scoped, no JWT); PUT upserts | `server.ts:2479-2539` |
| `server.ts` `/api/app-shared/:collection[/:id]` | Same CRUD against owner scope `usr.<id>` | `server.ts:2588-2647` |
| `server.ts` app-SSO password login / set-password | Reads app-defined auth collections (`list`), writes `passwordHash` (`update`) | `server.ts:1186, 1285` |
| `server.ts` `/api/legal/calculos` | Reads `tabelas_taxas` overlay from owner shared scope | `server.ts:2283` |
| `server.ts` `/api/legal/transcricao` | get/update `transcricoes` rows | `server.ts:2344-2376` |
| `persistence/app-files.ts` | Binary-file metadata in reserved collection `__files` | `app-files.ts:21, 49, 72-94` |
| `automation/platform-primitives.ts` | Recipe vocabulary `store.list/get/create/update/delete/query` scoped to `ctx.artifactId` (`query` = `list().filter` at primitives layer). NB: the same module also exposes UNCONFINED `file.read`/`file.write` fs primitives — not app-data; see §7.5 | `platform-primitives.ts:97-132` |
| `services/artifact-backend/runtime.ts` | Capability-scoped `ekoa.appData` handle for artifact-backend workers | `runtime.ts:698-702` |
| `services/adobe-webhook.ts` | get/update `propostas` (e-sign state writeback) | `adobe-webhook.ts:77-93` |
| `services/legal-calculos.ts` | Injectable store dep; deduped `notificacoes` creation in owner scope | `legal-calculos.ts:255, 257-263` |
| `services/artifact-bundle.ts` / `artifact-fork.ts` | Seed writes via `seedAppData` (backend-routed) | `artifact-bundle.ts:263, 465-473`; `artifact-fork.ts:109` |
| `services/app-data-backups.ts` | export/clear/import/snapshot/restore over the active backend | `app-data-backups.ts:66-116` |
| `persistence/app-data-migration.ts` + `services/app-data-migration.ts` | Boot-time slug→id and legacy per-user-fold migrations (fs-level) | `index.ts:122, 166` |

Platform-owned logical collection names written by cortex itself (not user apps): `__files`, `propostas`, `tabelas_taxas`, `transcricoes`, `notificacoes`, plus arbitrary app-defined auth collections (app-SSO).

**Migration implication:** this family is the natural fit for the rebuild's collections engine — the `(appId, collection, item)` model, the `usr.<owner>` shared scope, the `X-Ekoa-App-Id` scoping contract, reserved `__files` metadata collection, and the CAS/`_rev` concurrency semantics should carry over. The parity-test discipline (one suite, both drivers) is worth preserving if any second backend remains. Decide explicitly whether blobs stay on filesystem or move to GCS/Cloud Storage — today blobs are filesystem-only even under mongo.

---

## 4. Supabase — the control plane (complete catalog)

### 4.1 Client

`services/supabase-client.ts` — raw `fetch` against `{SUPABASE_URL}/rest/v1` PostgREST, **no `@supabase/supabase-js`** (`supabase-client.ts:4`; confirmed absent from `package.json`). Service-role key sent as both `apikey` and `Authorization: Bearer` (:46-52). Hard 10s timeout per request (:29, 42-45). Active only when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set (`isSupabaseConfigured`, :13-15) — but startup makes them **fatal-mandatory** (`startup.ts:121-128`, `startup.ts:10`).

### 4.2 Tables actually touched — exactly three

| Table | Operations (verbatim shapes) | Purpose | Consumers |
|---|---|---|---|
| `standalone_credentials` | GET `?installation_id=eq.<id>&select=access_token,refresh_token,expires_at` (`supabase-client.ts:67-69`); PATCH same filter with `{access_token, refresh_token, expires_at}` (:94-104); DELETE same filter (:120-124, dead code) | Claude OAuth token custody per installation (one row per `installation_id`, UNIQUE — migration 003) | `services/claude-auth.ts`: env→cache→Supabase token chain (:104-148); persist-first-then-commit on refresh (:373-385); jittered 45-60%-of-TTL refresh (:461-471); 20-min watchdog, 4 recovery modes incl. peer-rotation adoption (:509-590); refresh mutex (:66-69, 308-317); on 401/invalid_grant the row is deliberately KEPT (:340-356); keeps `process.env.CLAUDE_CODE_OAUTH_TOKEN` in sync for the SDK subprocess (:291, 396); break-glass env fallback flagged `env-fallback` (:117-143) |
| `companies` | GET `?license_key=eq.<key>&select=id,name,license_key,status,subscription_tier,max_installations,max_users_per_installation` (:152-154) | License lookup: must exist and be `active`; tier→feature map | `tools/license.ts` `licenseValidate` (:37-44, 86-95); called by `startup.ts` (fatal at boot) |
| `installations` | GET `?installation_id=eq.<id>&select=id,company_id,installation_id,status,last_seen_at` (:184-186); PATCH `{last_seen_at}` fire-and-forget heartbeat (:203-208) | Installation must exist, belong to the license's company, be `active`; heartbeat per validation | `tools/license.ts:47-61` |

Row types: `SupabaseRow` (`supabase-client.ts:21-27` — `claude_email?` is in the type and DDL but **never selected by the server**; only `scripts/claude-auth.mjs:143` reads it), `CompanyRow` (:135-143), `InstallationRow` (:169-175).

Notes:
- **Dead export**: `deleteStoredCredentials` (`supabase-client.ts:116-129`) has zero callers in `src/` — the 401 path intentionally stopped deleting rows (Conflicts C11).
- `standalone_credentials` is on the error-sanitizer leak-scrub list (`services/error-sanitizer.ts:60`).
- Startup gating: no Supabase → server refuses to start (`startup.ts:121-128`); `initTokenRefresh` throws without Supabase but a missing credentials row at boot is non-fatal (watchdog retries every 20m, `claude-auth.ts:205-225`). Config keys: `config.ts:94-101` (`installationId` default `standalone-dev`; `EKOA_LICENSE_KEY`). `isProductionLike` derives from a non-`standalone-dev` installation id (`config.ts:173-175`) — the Supabase installation identity doubles as the prod-mode signal.

### 4.3 Schema defined vs schema used

`supabase/migrations/` (repo root) defines ~12 tables; cortex touches 3. Zero cortex/script references exist for: `encrypted_configs`, `usage_records`, `admin_users`, `audit_logs` (001_license_system.sql:66-131), and the entire 002_max_account_pool.sql family (`max_accounts`, `pool_alert_config`, `max_account_usage_log`, `token_allowances`, `user_token_allocations`, `token_usage_records`, `token_usage_summaries`, `overage_billing_records`). All dead schema from an abandoned control-plane billing/pool design — cortex billing is local JsonStore (`persistence/billing.ts`, `billing/tracker.ts`). Migration 004 bridges the UUID `installations` table to the text `installation_id` cortex uses (004_installation_id_bridge.sql). Migration 001's comment shows `MAES-XXXX-…` license format vs the live `EKOA-…` convention — cosmetic drift. (Conflicts C7.)

### 4.4 Non-serving-path Supabase writers (repo-root `scripts/`)

- `scripts/claude-auth.mjs` (`npm run auth`) — interactive PKCE OAuth; POST upsert `/standalone_credentials?on_conflict=installation_id` (:275-289); reads `expires_at,claude_email` (:143).
- `scripts/seed-supabase-dev.mjs` — upserts `companies` (`on_conflict=license_key`, :122), creates/patches `installations` (:150-176), copies a `standalone_credentials` row between installation ids (:200-236).
- `scripts/dev-supabase-mock.mjs` — local PostgREST stand-in; its header documents the exact six request shapes cortex issues (:7-16); backing file `~/.ekoa/dev-supabase/store.json` chmod 600.
- `scripts/auth-watchdog.mjs` — polls cortex `/health`, no direct Supabase access.

**Migration implication:** the rebuild must decide whether Supabase remains the control plane (OAuth custody + license) or those 3 tables move to Firestore. Whatever the choice, the refresh-token rotation semantics in `claude-auth.ts` (persist-first, single-writer mutex, keep-row-on-401 for peer rotation) are load-bearing and must be reproduced. The ~9 dead Supabase tables must NOT be carried over.

---

## 5. JsonStore + per-file domain stores (`cortex/src/persistence/`)

### 5.0 JsonStore base

`JsonStore<T extends {id: string}>` — one JSON array file per store (`persistence/store.ts:39-45`). Atomic writes (`<file>.tmp` + `renameSync`, :183-193); crash recovery promotes an orphaned `.tmp` on read (:48-57). All mutations serialized by an in-process promise mutex (:9-31); reads lock-free (:47-67, 156-159). API: `readAll, findById, create, update(id, patch, validate?)` (validate runs on the merged record inside the lock, :81-102), `delete`, `takeById` (atomic find+remove — single-use nonce semantics, :115-135), `deleteWhere` (:137-154), `replaceAll` (:161-174). Barrel: `persistence/index.ts`; `getStore(domain)` maps only `users | memory | artifact-instances | integrations | activity` for the recipe interpreter (`index.ts:83-106`).

**Concurrency model = in-process mutex only ⇒ single cortex per data dir is a platform assumption** (also stated at `knowledge-sources.ts:452-455`). Migration implication: every one of these stores loses safety under multi-instance deployment — moving them to Firestore removes that constraint but must replace `takeById` (atomic consume) and `update`-with-validate semantics with transactional equivalents.

**Path inconsistency (verified at HEAD):** many stores hardcode `join(homedir(), '.ekoa', 'data')` and thereby **ignore `EKOA_DATA_DIR`**: users.ts:41, memory.ts:64, artifacts.ts:144, integrations.ts:42, activity.ts:16, teams.ts:14, settings.ts:67, billing.ts:13, automations.ts:16, automation-runs.ts:31, jobs.ts:26, projects.ts:23, triggers.ts:82, event-queue.ts:28 (env-overridable via `EKOA_TRIGGERS_DB_PATH` only). Others honor config/env: sessions.ts:43-47, company.ts:29, app-sessions.ts, adobe-agreements.ts:34 (all `config.dataDir`), and the knowledge/app-data family resolves `EKOA_DATA_DIR` per call (knowledge-uploads.ts:41, knowledge-ledger.ts:58, knowledge-sources.ts:441, app-data.ts:36, app-data-fs.ts:35, app-data-migration.ts:25). Works today only because prod does not set `EKOA_DATA_DIR`. **Rebuild must unify** (Conflicts C4).

### 5.1 Store-by-store catalog

Each row: file, shape/key fields, tenancy, writers/readers, migration implication (MI).

#### users — `~/.ekoa/data/users.json`
- `persistence/users.ts:41-43`. `StoredUser` (:25-39): `id, username, passwordHash (bcrypt), role: 'super-admin'|'admin'|'builder', companyId, teamId?, isActive, passwordChangeRequired, allocationPercentage, preferences?, createdAt, updatedAt, lastLoginAt?`. `preferences.approvedLocalCommandShapes: ApprovedLocalCommand[]` — normalized argv `shape`, `approvedAt`, `lastUsedAt?`, `note?` (:10-23): persistent per-user "Approve always" consent for automation `local_command` shapes.
- Tenancy: the user table itself; single company (`companyId` carried but implicit).
- Writers: `bootstrap.ts:1-41` (seeds `admin/tmp12345` when empty), `handlers/auth-handler.ts` (login stamps `lastLoginAt`, change-password, create-user, reset-password), `handlers/users-handler.ts`, `automation/executors/local-command.ts` (consent shapes). Readers: `auth.ts`, execute/automations/artifacts/teams/billing/settings handlers, `services/orchestrator.ts`, `services/featured-artifacts-seeder.ts`, `billing/tracker.ts`.
- MI: straight Firestore collection; consent shapes are security-relevant state — keep the exact shape-normalization contract.

#### sessions + messages — `<dataDir>/sessions.json`, `<dataDir>/messages.json`
- `persistence/sessions.ts:42-48` (uses `config.dataDir` — volume-mounted deliberately; prior in-image location `cortex/apps/ekoa.sessions/data/`, :9-12; one-shot copy migration gated by `<dataDir>/.legacy-data-migration-v1.flag`, `startup.ts:78-90`).
- `StoredSession` (:19-30): `id, userId, name?, title?, type?, status?, messageCount?, createdAt?, updatedAt?, [k: string]: unknown` (forward-compat bag). `StoredMessage` (:32-40): `id, sessionId, role, content, timestamp?, metadata?, [k]: unknown`.
- Tenancy: `session.userId`; `findOwnedSession` returns null on any mismatch so callers surface uniform "not found" (:56-65).
- Writers/readers: `handlers/sessions-handler.ts`, `services/orchestrator.ts`. **Distinct from** `src/sessions.ts` (§6.2) and `persistence/app-sessions.ts` (below) — three unrelated "sessions" stores (Conflicts C6).
- MI: two Firestore collections (`sessions`, `messages` with `sessionId` FK); messages grow unbounded — pick a retention policy.

#### company — `<dataDir>/recipes/ekoa.company/company.json` (singleton, NOT a JsonStore)
- `persistence/company.ts:29`. Deliberately inside the recipe app's dataPath so `ekoa.company` recipes read the same file — writing anywhere else leaves the Brand page showing defaults forever (:22-28; aligned with `apps/loader.ts:69`). One-shot legacy migration from `<dataDir>/company.json` (:33, 48-58).
- `StoredCompany` (:5-20): `id, name, displayName, branding: Record<string,unknown>` (logo, logoIcon, primaryColor, secondaryColor, accentColor, fontFamily, companyName, instructions, designSystem, visualVibe…), `settings, createdAt, updatedAt`. Custom store `get/update/init/upsert` + atomic write (:60-117).
- Writers: `handlers/branding-handler.ts`, `services/branding-save.ts`, AND `services/brand-color-filter.ts` `migrateCompanyBrandingFile` — a startup grayscale-color migration run at **every boot** (no sentinel flag) from `index.ts:296-298` (import `index.ts:24`) against `COMPANY_FILE_PATH`; it rewrites the file atomically (tmp+rename, `brand-color-filter.ts:160-166`) whenever primary/secondary branding color is grayscale, guarded only by that condition check (`brand-color-filter.ts:148-154`). Readers: `adapters/external.ts` (brand context into prompts), `handlers/execute-handler.ts`, `services/design-tokens-css.ts`, the `ekoa.company` recipe app via interpreter (`apps/interpreter.ts:312-330`).
- MI: singleton doc; the recipe-dataPath coupling disappears if recipes are rebuilt — remove the path-coupling hazard.

#### memory — `~/.ekoa/data/memories.json`
- `persistence/memory.ts:64-66`. `StoredMemory` (:28-62): `id, title, content, type: pattern|preference|fact|workflow|lesson|context, tags[], scope: company|individual|operational|marketing|technical|branding, tier: core|active|archive, source, origin: manual|agent-block|auto-extraction|signal-aggregation|consolidation, score, usageCount, lastUsedAt, verified, visibility: shared|private, userId?, signals?: MemorySignal[]` (`{type: positive|negative, traceId, timestamp}`, :5-9), `attachments?, createdAt, updatedAt`.
- `MemoryAttachments` (:11-26): `payload?` — structured entity-tagged data the resolver does not term-score (**automation action-cache entries + page fingerprints live here** — consumer `automation/cache.ts`); `blobRefs?: [{kind: screenshot|log, path (relative to ~/.ekoa/data/), capturedAt}]`.
- Tenancy: `visibility` + optional `userId`; automation scoping via `automation:<id>` tags + resolver entityId filter.
- Writers: `memory/{auto-extractor,consolidation,signals,seed,migration,integration-affinity}.ts`, `automation/cache.ts`, `handlers/memory-handler.ts`, `handlers/branding-handler.ts` (deletes `company-identity`/`branding`-tagged rows before re-save), `handlers/automations-handler.ts`. Reader: `memory/resolver.ts` (prompt injection). Seed: `ekoa-data/memories/seed.json` (`memory/seed.ts:47-53`), idempotent.
- MI: Firestore collection; note the dual role (human memories + automation action cache in `attachments.payload`) — consider splitting in the rebuild; `blobRefs` paths are relative to the data dir and must be remapped if blobs move.

#### artifact-instances — `~/.ekoa/data/artifact-instances.json`
- `persistence/artifacts.ts:144-148`. `StoredArtifactInstance` (:58-98): `id, typeId` (base id, e.g. `app-auth-persistent`), `name, userId, status: draft|active|archived, slug?, sdkSessionId?` (SDK resume id), `featured?, featuredRank?, shareable?, health? {status: healthy|broken, lastError?, lastReason?: uncaught-error|unhandled-rejection|empty-dom|missing-build, lastCheckedAt}` (written by `POST /api/app-health`; cleared on rebuild), `data: Record<string,unknown>, createdAt, updatedAt`.
- Featured working-copy state lives inside `data` (`FeaturedInstanceData` lens, :115-120): `seededVersion, customized, updateAvailable, ignoredVersion`; plus `seededFrom: 'ekoa-data/featured-artifacts'` marker (`featured-artifacts-seeder.ts:164`). One-shot startup migration `migrateShareableToTopLevel` (:126-142; `index.ts:141`).
- Tenancy: `userId` owner; `featured` records surface regardless of owner.
- Writers: artifacts/execute handlers, featured-artifacts-seeder, artifact-fork, featured-update, slug-generator (backfill), app-builder, app-health-scanner. Readers (23 files) incl. `server.ts` (serving + shareability), company-space/orchestrator/integrations/artifact-backend/triggers handlers, `automation/catalog.ts`, share-lookup/starting-points-prompt/onboarding-prompt/artifact-bundle/artifact-backend-runtime/featured-artifact-builder services.
- MI: central catalog record of the whole product — Firestore collection with slug uniqueness enforced transactionally (today slug uniqueness is an in-memory index rebuilt at boot, `services/slug-generator.ts`, `index.ts:99`).

#### integration-configs — `~/.ekoa/data/integration-configs.json`
- `persistence/integrations.ts:42-44` (**note filename: NOT `integrations.json`** — Conflicts C3). `StoredIntegrationConfig` (:5-40): `id, name, type, config, credentials?` (**AES-256-GCM ciphertext string**), `enabled, createdAt, updatedAt, platformProvider?: google|microsoft, oauthState?, needsReauth?` (set on refresh invalid_grant), `ownerUserId?` (**undefined = global/super-admin-authored; else owner-only**), `sessionState?` (**encrypted captured browser session, always owner-scoped, never returned to frontend**), `sessionCapturedAt?`.
- Writers: integrations/platform-integrations handlers (OAuth connect/refresh), integration-session-capture (via handler), `services/pipedream.ts:241-273` (pipedream config row). Readers: `server.ts` (`/api/integration/:key/*` credential-injecting proxy), `tools/platform-integration-call.ts` (hourly refresh sweep), `adapters/external.ts`, integration-action-executor/adobe-sign/cloud-files/ctt-tracking/integration-automations/orchestrator/onboarding-prompt/integration-inference services, integration-builder handler.
- Two-part model: skill **definitions** are files (§7.3, §8), configs+credentials are this store.
- MI: ciphertext-at-rest must survive; the encryption key today is an env var with an insecure dev default (`tools/crypto.ts:15`) — rebuild should move to a real KMS. Tenancy nuance (undefined ownerUserId = global) must be preserved exactly.

#### activity — `~/.ekoa/data/activity-logs.json`
- `persistence/activity.ts:16-18`. `StoredActivityLog` (:5-14): `id, userId, username, category, type, description, metadata?, timestamp`. Writer: `handlers/shared.ts` audit helper. Reader: `handlers/activity-handler.ts`. Append-only, no pruning.
- MI: append-only log — Firestore or a logging product; add retention.

#### jobs — per-file `~/.ekoa/data/jobs/<jobId>.json`
- `persistence/jobs.ts:26-30` (NOT a JsonStore; one file per job, atomic write :36-41). `StoredJob` (:13-24): `id, agent, userId, status: queued|running|completed|failed|cancelled, config, result?, error? {code, message}, createdAt, startedAt?, completedAt?`. `list()` reads every file (:44-51). No retention.
- Writers/readers: `handlers/execute-handler.ts` (build jobs), `handlers/branding-handler.ts` (research jobs).
- MI: Firestore collection with TTL/retention. (CLAUDE.md's `jobs.json` single-file claim is wrong — Conflicts C2.)

#### teams — `~/.ekoa/data/teams.json`
- `persistence/teams.ts:14-16`. `StoredTeam` (:5-12): `id, name, description?, canPublicRelease, createdAt, updatedAt`. Writer/reader: `handlers/teams-handler.ts`. MI: trivial collection.

#### settings — `~/.ekoa/data/settings.json` (singleton id `'default'`) + per-user overrides
- `persistence/settings.ts:67-69`. `StoredSettings` (:8-65): `general {platformName, language, timezone, vertical?: 'generic'|'legal'|string}` (vertical is the only vertical-aware backend value, cosmetic, :15-23); `chat {defaultMode, autoOpenSidePanel, showExampleCards, enableContextDividers, guidedMode, guidance?: guide-me|standard|just-build-it}`; `build {showFileTreeByDefault}`; `integration {autoTestAfterCreation, defaultConfigExpanded, pipedreamEnabled?}` (undefined/true = ON, :49-56); `billing? {globalOverageEnabled?}`; `updatedAt, updatedBy?`. **No `previewMode` field exists** (verified by grep — Conflicts C5).
- **Per-user settings**: `userSettingsStore(userId)` → `~/.ekoa/sandboxes/user-<id>/settings.json`, cached JsonStore per user (:76-87).
- Writers: settings handler, billing handler (global overage). Readers: `index.ts` (guidedMode cache, 30s TTL, `index.ts:41`), `billing/middleware.ts`, onboarding-prompt/orchestrator/pipedream services.
- MI: singleton doc + per-user subcollection; per-user settings currently hide inside the sandbox tree — surface them as first-class data.

#### billing — `~/.ekoa/data/token-events.json` + `~/.ekoa/data/billing.json`
- `persistence/billing.ts:73-79`. `StoredTokenEvent` (:17-51): `id, sessionId, userId, agentType, inputTokens/outputTokens/unifiedTokens` (**metered**: post-tier-weight, post-cache-discount), `rawInputTokens?, rawOutputTokens?, rawCacheCreationTokens?, rawCacheReadTokens?, totalCostUsd?` (SDK ground truth, never shown), `tierWeight?, timestamp, artifactId?, traceId?, model?`.
- `StoredUserBilling` (:55-69): `id` (== userId), `userId, monthlyBaseTokensUsed, tokenLimit?, creditBalanceUsd, overageEnabled, currentPeriodStart, creditsPurchasedTotalUsd, updatedAt`.
- Writers: `billing/tracker.ts` (`recordTokenUsage`), `handlers/billing-handler.ts` (credits/overage/limits), `startup.ts:32-48` `runBillingUnitsReset` (one-shot wipe of legacy char-estimated meters, sentinel `<dataDir>/.billing-units-reset-v1.flag`). Readers: `billing/middleware.ts` (pre-turn gate), billing handler.
- MI: token-events is an unbounded append-only ledger inside a whole-file JsonStore — the single worst write-amplification hotspot; move to an append-optimized Firestore collection (or export pipeline) first. Note the DEAD Supabase billing schema duplicates this (Conflicts C7) — pick one.

#### automations — `~/.ekoa/data/automations.json`
- `persistence/automations.ts:14-18`; `StoredAutomation = Automation` verbatim (:6-13). `Automation` (`automation/types.ts:306-330`): `id, name, description, steps: Step[], inputSchema? {fields: [{name, description, required, defaultValue?}]}, ownerUserId, trigger?: {kind: manual} | {kind: webhook, triggerId, integrationKey, eventName} | {kind: listener, triggerId, integrationKey, pollAction, pollIntervalMs}, source? {integrationKey, templateKey}, createdAt, updatedAt`.
- `Step` (`types.ts:238-268`): `id, description, type, expectedOutcome?` + per-type fields: `url` (navigate), `durationMs` (wait), `integrationKey/integrationAction/argsTemplate` (integration), `subAutomationId` (sub_automation), `commandTemplate` (local_command), `apiRequest` (api_call), `ekoaAction` (ekoa_action), `cachedAssertion?` (planner-authored deterministic verify).
- Tenancy: `ownerUserId`. Writers: automations handler, `services/integration-automation(s).ts` (template provisioner), `services/citius-connect.ts`. Readers: `automation/engine.ts`, `automation/catalog.ts`, `tools/call-automation.ts`, triggers handler, trigger-dispatcher, onboarding-prompt.
- MI: clean collection; step type union is the product contract.

#### automation-runs — per-file `~/.ekoa/data/automation-runs/<automationId>/<runId>/run.json` + `step-<i>.png`
- `persistence/automation-runs.ts:4-15, 31`. Per-file because runs accumulate forever — **no retention pruning by explicit user direction** (:8-10). Store API `create/update/findById/listForAutomation (mtime-desc)/listAll` (:57-120). `writeStepScreenshot` returns a path **relative to `~/.ekoa/data/`** (:131-145); `resolveScreenshotAbsolute` for the static route (:151-153). Screenshots served at `/automation-screenshots/` (express.static over RUNS_ROOT, `server.ts:218-235`).
- `RunRecord` (`automation/types.ts:448-476`): `id, automationId, startedAt, endedAt?, status: running|completed|failed|cancelled|awaiting_integration|paused_for_user|awaiting_consent|awaiting_daemon` (:438-446), `inputs, steps: StepRecord[], triggeredBy: user|agent|webhook|listener, parentRunId?, awaitingIntegration? {service, reason}, kind?: normal|rehearsal, rehearsalSummary?, pauseRequest? {stepIndex, reasoning, userInstructions, screenshotPath?}` (:496-501), `consentRequest? {stepIndex, shape, argv, description}` (:483-494).
- `StepRecord` (`types.ts:397-436`): `stepId, index, status, tier, resolvedAction?, assertionResolved?, visionReasoning?, output?, error? {message, recoverable, details?}, humanAction?, screenshotPath?, fingerprint?, durationMs, feedback?, rehearsalPatches?`.
- Writers: `automation/engine.ts`, automations handler. Readers: automations handler (history), `automation/catalog.ts`, integration-automation service.
- MI: run docs → Firestore; screenshots are blobs → object storage. Grows-forever is a deliberate product decision — re-confirm or add retention explicitly (Conflicts C12).

#### projects — per-file `~/.ekoa/data/projects/user-<userId>/<projectId>.json` — VESTIGIAL
- `persistence/projects.ts:23-31`; custom `listForUser/getForUser/createForUser/updateForUser/deleteForUser` (:44-85). `StoredProject` (:13-21): `id, userId, name, description, folder, createdAt, updatedAt`.
- **Consumers: none outside persistence/** (grep: only projects.ts + index.ts). The `ekoa.projects` recipe app writes its own recipe data instead. Carry into the rebuild as a drop-candidate decision point.

#### triggers — `~/.ekoa/data/triggers.json`
- `persistence/triggers.ts:82-141`. `StoredTrigger` (:40-80): `id` (opaque UUID; public URL `${EKOA_PUBLIC_HOOKS_BASE_URL}/hooks/<id>`), `ownerUserId` (**server-trusted, flows into RunContext, never derived from request**, :43-47), `automationId?`, `target?: {kind:'automation'} | {kind:'artifact-backend', artifactId, entrypoint}` (absent ⇒ automation, back-compat resolver :36-38), `artifactId?, kind: webhook|listener, integrationKey, eventName, secretCiphertext` (**AES-256-GCM-encrypted HMAC secret**, decrypted just-in-time), `registrationState: auto|manual|pending|failed, registrationMeta?, pollConfig? {actionName, intervalMs}, disabled?` (410 on inbound), `createdAt, updatedAt`.
- `TriggerStore extends JsonStore` adds an EventEmitter lifecycle bus (`created/updated/deleted`, :84-108) the listener-supervisor subscribes to; helpers `listForUser/listForAutomation/listForArtifact/listListeners` (:110-138).
- Writers: triggers/integrations handlers. Readers: `handlers/webhooks-handler.ts` (ingress), trigger-dispatcher/listener-supervisor/webhook-self-test services.
- MI: collection + the change-notification bus needs a Firestore-native equivalent (snapshots/listeners) since the EventEmitter is in-process only.

#### app-sessions (end-user SSO) — `<dataDir>/app-sessions.json` + `<dataDir>/app-sso-pending.json`
- `persistence/app-sessions.ts:74-80`. `AppSession` (:18-51): `id` (high-entropy token = HttpOnly cookie value), `appId` (canonical, never slug — isolation enforced by `session.appId === __EKOA_APP_ID`, not cookie path), `email, name?, oid?, tid?, createdAt, expiresAt, graphTokensEnc?` (encrypted `{access_token, refresh_token}` for delegated Graph; the app never sees it, injected by `/api/app-sso/m365` proxy), `graphTokenExpiresAt?, authCollection?/authIdentityField?` (password sessions: server-established binding for set-password privilege checks, :43-50).
- `PendingAppAuth` (:59-72): `id === state`, `appId, nonce, pkceVerifier, returnUrl, redirectUri, createdAt, expiresAt`. TTLs: sessions 8h, pending 10min (:83-84). `findValidAppSession` (opportunistic expiry sweep, :91-104), `consumePendingAppAuth` — atomic `takeById` single-use anti-replay (:106-120), timer sweep (:123-128).
- Writers/readers: `server.ts` app-sso routes (:941-1239 region) + `services/app-sso.ts`.
- MI: security-critical — the single-use consume (anti-replay) needs a Firestore transaction; encrypted Graph tokens must remain sealed from apps.

#### adobe-agreements — `<dataDir>/adobe-agreements.json`
- `persistence/adobe-agreements.ts:33-35`. `AdobeAgreementRef` (:19-31): `id` (Adobe agreementId), `appId` (canonical), `propostaId, ownerUserId` (scopes credential lookup for verification re-fetch), `clientEmail, createdAt`. Reverse index agreement→ERP proposal; the webhook never trusts it for signature STATE — always re-fetches owner-scoped (:14-18).
- Writer: `services/adobe-sign.ts` (at send). Reader: `services/adobe-webhook.ts` (`/api/adobe-sign/webhook`). MI: small lookup collection.

#### app-files — blobs `~/.ekoa/data/app-data/<appId>/files/<uuid>` + metadata collection `__files`
- `persistence/app-files.ts:6-21`. Blob filename is always the server UUID, never the user name (:14-16); metadata rows in reserved app-data collection `__files` (`AppFileMeta {id, name, size, type, createdAt}`, :23-29); unicode-preserving `sanitizeFilename` (PT names survive, :37-46). `save/get/delete` (:66-102; delete tolerates orphaned blob). **Blob bytes are ALWAYS filesystem, even under the mongo backend** (`app-data.ts:30-38`).
- Writers/readers: `routes/app-files.ts` (`POST/GET/DELETE /api/app-files/...`, X-Ekoa-App-Id scoped, no JWT).
- MI: the clearest blob→object-storage migration candidate; the metadata already rides the switchable app-data backend, only the bytes are pinned to disk.

### 5.2 Knowledge family (markdown vault + registries)

#### knowledge vault — markdown files `<dataDir>/knowledge/collections/<collection>/<id>.md`
- `persistence/knowledge.ts:4-24`; paths single-sourced in `services/knowledge-paths.ts:17-31` (sanitized segments). One file per doc: frontmatter (`services/knowledge-frontmatter.ts`) + markdown body. Explicit-write-only, provenance-carrying, cited-or-silent; no scoring/tiering in the store (:11-15). Per-file chained-promise mutex (:71-90); `.tmp` atomic write + crash recovery (:92-113). **Index sync hooks**: FTS registers `onWrite/onDelete` via `setKnowledgeIndexHooks` (dependency inversion); vault calls them after each committed write/delete, best-effort (:50-69, 152-179).
- Writers: knowledge-ingest/crawl/upload/nfc-migration services, knowledge handler. Readers: `tools/knowledge-read.ts`, `adapters/knowledge-mcp.ts`, knowledge-ripgrep/knowledge-browse services.
- Sentinel: `<dataDir>/knowledge/.nfc-migrated` — one-shot NFC unicode normalization (`services/knowledge-nfc-migration.ts:22-23, 40`).
- Scale: ~8GB / ~254k docs (CLAUDE.md ops note, consistent with code design).
- MI: the corpus is filesystem-native by design (ripgrep fallback depends on it). Firestore is a poor fit for 254k markdown bodies — the rebuild should treat the vault + FTS index as a separate storage domain (disk or object storage + search index), not force it into the collections engine.

#### knowledge crawl ledger — per-source `<dataDir>/knowledge/ledger/<sourceId>.json`
- `persistence/knowledge-ledger.ts:12-15, 61-65`. `LedgerPage` (:33-55): `id = sha1(url)`, `sourceId, url, depth, collection, etag?, lastModified?, contentHash?` (sha256 of extracted text), `docId?, title?, status: pending|ok|error|gone` (**`pending` rows ARE the persisted crawl frontier — resumable crawls**, :24-30), `firstSeenAt, lastFetchedAt, lastChangedAt?, error?`. Bulk `replaceAll` per run (:91-97); `clear` on source delete (:119-123); `stats` for UI (:125-139).
- Writers/readers: knowledge-crawl/domino-ingest/api-ingest services, knowledge handler.
- MI: high-churn bulk-replace pattern; if moved to Firestore, batch writes are mandatory (per-run ledgers can be tens of thousands of rows).

#### knowledge sources — `<dataDir>/knowledge/sources.json`
- `persistence/knowledge-sources.ts:444-446` (store cached per path :463-471). `KnowledgeSource` (:99-147): `id, label, url, kind?: crawl|api|domino, api?: ApiSourceConfig` (endpoint, itemsPath, idField, titleFields, textFields, urlField, downloadField, pagination odata|wp-page|none, headers, perPage — :52-77), `domino?: DominoSourceConfig` (baseUrl, view, count, databases[] — dgsi.pt harvest, :79-97), `seeds?` (≤5000, SSRF-validated), `seedTemplate? {url with {n}, from, to, step}` (≤100k expansions, :31-44), `collection, levels (≤4), maxPages (≤200000, per-RUN budget), scope: same-domain|any, enabled, render, userAgent?, caCerts?, seedId?` (idempotent startup-seed marker), `lastCrawledAt?, lastRefreshAt?, lastResult?: KnowledgeCrawlSummary` (:149-174), `createdAt, updatedAt`.
- API `list/get/create/remove/createIfAbsentBySeedId` (:704-780); in-process seed lock closes the check-then-act gap (:452-462); PT-message validation (:478+, :587+).
- Writers/readers: knowledge handler, knowledge-seed (from `ekoa-data/knowledge/sources.seed.json`)/crawl/crawl-runner/scheduler/domino-ingest/api-ingest services.
- MI: small config collection — clean Firestore fit.

#### knowledge uploads — `<dataDir>/knowledge/uploads.json` + raw files `<dataDir>/knowledge/files/<uploadId>/<safeName>`
- `persistence/knowledge-uploads.ts:5-11, 44-51`. `UploadDoc` (:20-38): `id, filename, mimeType, collection, bytes, storedPath` (absolute!), `docIds[]` (vault chunk ids), `chunkCount, charCount, status: indexed|stored, extractKind (text/office/image/unknown), uploadedAt, uploadedBy`. Unindexing = delete chunk docs + raw file + row (:9-12).
- Writer/reader: `services/knowledge-upload.ts` (behind `POST /api/v1/knowledge/upload`, `server.ts:589`).
- MI: `storedPath` is an absolute filesystem path baked into the record — must become a storage-relative reference in the rebuild.

---

## 6. SQLite stores

### 6.1 Event queue — `~/.ekoa/data/triggers.db` (better-sqlite3, WAL)
- `persistence/event-queue.ts:26-29` (`EKOA_TRIGGERS_DB_PATH` override); `journal_mode=WAL, synchronous=NORMAL, foreign_keys=ON` (:113-116). Sidecars `triggers.db-wal`, `triggers.db-shm`.
- Tables (:118-161):
  - `events`: `id, trigger_id, dedup_key, raw_body BLOB, headers_json, source (webhook|listener), status (pending|dispatching|dispatched|failed|dead), attempts, next_attempt_at, last_error, received_at, dispatched_at, run_id`; **`UNIQUE(trigger_id, dedup_key)` is the entire idempotency mechanism** (:10-11, 133); partial index on ready-pending rows.
  - `listener_state`: `trigger_id PK, cursor_json, last_poll_at, consecutive_failures, last_error` — per-listener poll cursor (:143-149).
  - `webhook_audit`: `id, trigger_id, result (accepted|duplicate|rejected_signature|rejected_unknown_trigger|rejected_disabled|rejected_other), received_at, detail` (:151-160, 34-40).
- Semantics: `enqueueEvent` returns `duplicate` on UNIQUE collision (:270-293); `claimNextEvent` atomic pending→dispatching via UPDATE…RETURNING (:322-324); retry schedule 30s/2m/10m/1h/6h ±30% jitter, then `dead` (:330-361); boot recovery re-pends rows stuck `dispatching` >10min (:367-371); `eventQueueBus` emits `event_enqueued` for wake-on-insert (:73-77); rolling webhook clock-skew median for `/health` (:80-98). Idempotent `ALTER TABLE … ADD COLUMN dispatched_at` migration (:162-170).
- Consumers: `index.ts` (open/close/recover), `server.ts` + webhooks handler (enqueue + audit), triggers handler (delete per trigger), trigger-dispatcher/listener-supervisor/platform-poll services.
- MI: a real durable queue. Firestore can express the dedup (doc id = `trigger_id::dedup_key`) and claim (transaction), but the atomic UPDATE…RETURNING claim and partial-index polling need careful redesign — or replace with Cloud Tasks/PubSub + a state collection. The `raw_body BLOB` rows can exceed Firestore's 1MB doc limit — check payload bounds.

### 6.2 Knowledge FTS index — `<dataDir>/knowledge/index.db` (+wal/shm)
- `services/knowledge-fts.ts:45-47, 84-124`. Tables: `knowledge_meta` (k/v: schemaVersion, ready, docCount, builtAt), `knowledge_docs` (dockey, collection, doc_id, title, source_url, source_type, date, language, tags, outdated), virtual `knowledge_fts(title, body, tokenize='unicode61 remove_diacritics 2')`. Schema v2; version bump drops+rebuilds (:90-99). WAL, busy_timeout 5000 (:70-78).
- Maintained via vault write/delete hooks + startup backfill + admin `reindex` intent. Search facade prefers FTS when `ready=1`, falls back to ripgrep (`services/knowledge-ripgrep.ts`).
- Ops: ≈6GB for 254k docs; must persist across restarts or the ~9-min backfill re-runs (CLAUDE.md ops note). Regenerable — derived data, not source of truth.
- MI: derived index — rebuild replaces it with whatever search backend the new knowledge domain gets; do not migrate the data, migrate the *behavior* (lexical accent-folded BM25 + authority multiplier, `services/knowledge-ranking.ts`).

### 6.3 Chat turn context/history — `<dataDir>/session-contexts.json` + `<dataDir>/session-history.json`
- Top-level `src/sessions.ts:16-27` (NOT `persistence/sessions.ts`). Chat-turn memory across restarts (chat is stateless per turn): contexts keyed by sessionId; history capped 40 msgs/session, 32k chars/msg, 200 sessions. Writers: `setSessionContext`, `addUserMessage/addAssistantMessage`; reader: `index.ts` request pipeline.
- MI: fold into the sessions domain in the rebuild — three unrelated "sessions" stores is a naming landmine (Conflicts C6).

---

## 7. Other filesystem persistence (outside `persistence/`)

### 7.1 Under `~/.ekoa/data/`

| Path | Shape / purpose | Writer(s) | Reader(s)/serving | Lifecycle | MI |
|---|---|---|---|---|---|
| `<dataDir>/recipes/<appId>/*.json` | Recipe-app data files — every recipe app's `dataPath` is volume-mounted here (`apps/loader.ts:66-73`); file names from recipe ops, path-traversal-guarded (`apps/interpreter.ts:312-330`). Includes `recipes/ekoa.company/company.json` (§5.1) | recipe interpreter | same + companyStore | per app | If recipes survive the rebuild, their data goes to the collections engine |
| `<dataDir>/artifact-screenshots/<instanceId>.png` | Artifact card thumbnails, 1280×800 Playwright (`services/artifact-screenshot.ts:36, 96-161`) | artifact-screenshot | static `/artifact-screenshots` (`server.ts:238-247`) | overwritten per capture | regenerable blob → object storage |
| `<dataDir>/artifact-pdfs/<name>.pdf` | PDF exports of document-kind artifacts (`services/artifact-pdf.ts:62, 109-121`) | artifact-pdf | static `/artifact-pdfs` + `GET /api/v1/artifacts/:id/pdf` (`server.ts:254-267`) | regenerable | blob → object storage |
| `<dataDir>/featured-builds/<manifestId>/` | Pre-built dist for featured artifacts (esbuild output) (`services/featured-artifact-builder.ts:32-34, 184`) | featured-artifact-builder (boot prebuild, `index.ts:859`) | serving fallback (`server.ts:2828`) | rebuilt when scaffold changes (`isFresh`, :303) | build cache — regenerable |
| `<dataDir>/app-data-snapshots/<appId>/<iso>__<kind>.json` | App-data restore points (`AppDataDump {appId, exportedAt, collections, counts, totalItems}`); kinds safety-net/manual/nightly/auto (`services/app-data-backups.ts:18-46, 70-73`) | AppDataBackups (via `ekoa.app-data-backups` intents: status/download/preview/snapshot/restore, `handlers/app-data-backups-handler.ts:71`) | same | user-managed + nightly | backup artifacts — object storage in rebuild |
| `<dataDir>/integration-skills/<key>/…` | RUNTIME (non-versioned) integration content overriding the versioned counterpart — incl. `automations/<templateKey>.json` templates (`services/integration-storage.ts:43-58`; `integration-automations.ts:9-11, 131-134`) | integration tooling / user | integration-automations, integration-storage | runtime overlay | content-versioning problem, not a DB problem |
| `<dataDir>/uploads/` | Base upload dir + `.write-test` health probe ONLY — actual chat uploads go to per-user sandbox (`server.ts:503-527`, note :526) | server.ts | `/api/v1/upload/test` | mostly empty | drop or keep as probe |
| `<dataDir>/.billing-units-reset-v1.flag` | Sentinel: one-shot wipe of char-estimated billing meters (`startup.ts:32-48`) | startup | startup | permanent | migration-history record |
| `<dataDir>/.legacy-data-migration-v1.flag` | Sentinel: one-shot in-image→volume sessions copy (`startup.ts:78-90`) | startup | startup | permanent | ditto |
| `<dataDir>/knowledge/.nfc-migrated` | Sentinel: NFC normalization sweep (`knowledge-nfc-migration.ts:22-23`) | nfc-migration | same | permanent | ditto |
| `<dataDir>/app-data/.migrated-v1` | Sentinel: per-user→global app-data fold (`services/app-data-migration.ts:44, 133-185`) | app-data-migration | same | permanent | ditto |

Not every startup migration is sentinel-gated: `migrateCompanyBrandingFile` (`services/brand-color-filter.ts:160-166`, invoked every boot from `index.ts:296-298`) rewrites `company.json` with **no flag file** — idempotence comes only from its grayscale condition check (`brand-color-filter.ts:148-154`). See the company entry in §5.1.

### 7.2 `~/.ekoa/brand-assets/` — SIBLING of the data dir, not inside it
- `BRAND_ASSETS_DIR = join(dataDir, '..', 'brand-assets')` ⇒ `~/.ekoa/brand-assets/` (`services/brand-asset-proxy.ts:13-18`). Files named `md5(url)[0:12].<ext>` (:33-56). Writer: brand-asset-proxy (downloads external brand images during research to dodge CORS/hotlinking). Readers: `GET /brand-assets/:filename` (`server.ts:162-186`, no auth) and `/api/design-tokens.css` `--logo-url` vars (`services/design-tokens-css.ts:95-98`).
- MI: cache blobs → object storage; the sibling-of-dataDir location is a deploy-volume trap (easy to lose on remount) — normalize.
- Doc conflict: CLAUDE.md lists `brand-assets` under `ekoa-data/` but no code reads `ekoa-data/brand-assets/` (Conflicts C13).

### 7.3 `~/.ekoa/sandboxes/user-<userId>/` — per-user sandbox
Root: `SANDBOX_ROOT` (`index.ts:79`). Tenancy = directory name `user-<id>`, enforced by path confinement (`services/artifact-files.ts:34-66` symlink-hardened `resolveSafePath`; `tools/vcs.ts:31-40`).

| Entry | Purpose | Writer/reader |
|---|---|---|
| `<appId>/` (project dir `{root}/user-{id}/{appId}`) | Artifact source tree: JSX/HTML sources, `manifest.json` (`app-manifest.ts:9, 95`), `dist/` (esbuild output served at `/apps/:appId`), `dist-backend/backend.mjs` (artifact-backend bundle, `artifact-backend/runtime.ts:694`), `.git` (isomorphic-git per-artifact history; gitignores dist/node_modules/app-data, `tools/vcs.ts:23-27`), `.versions`, `.sdk-session`, `.claude`, `session-env` (agent-internal; excluded from file tree/archive/bundle — `services/artifact-files.ts:104-118` (`FILE_TREE_EXCLUDE`), `app-archive.ts:25-28`, `artifact-bundle.ts:70`) | `execute-handler.ts:378-380` (creation), coding agent via SDK, appBuilder, `tools/vcs.ts`, `services/artifact-files.ts` (read/write-file intents), `github/backup.ts` (push mirror) |
| `uploads/` | Chat attachment staging: `<uuid8>-<safeName>` or folder-relative trees (`server.ts:544-583`) | `POST /api/v1/upload`; read by build pipeline |
| `settings.json` | Per-user settings overrides (`persistence/settings.ts:76-87`) | settings handler, orchestrator |
| `integration-skills/<key>/` | Per-user (non-super-admin) integration skills: `SKILL.md`, `config.json`, `history.json` (+ optional `automations/`) (`integration-storage.ts:38-41, 446-450, 506-511`) | integration-storage |
| `automation-profile/` | Persistent Chromium user profile per owner (cookies survive runs; interactive-login capture shares it) (`services/automation-browser.ts:130-135`) | automation-browser |
| `app-data/` (legacy) | Pre-fold per-user app-data; merged into global by `services/app-data-migration.ts:133-185` | migration only |

MI: source trees + git history + browser profiles are inherently filesystem/VM-local. In the rebuild these are workspace state, not database state — decide the durability story (git remote mirror already exists via `github/backup.ts`).

### 7.4 `~/.ekoa/apps/` — user-authored recipe apps
- Second discovery root for recipe apps besides bundled `cortex/apps/` (`apps/loader.ts:44-45`); each = `instructions.md` (+ optional `recipes.json`); data at `<dataDir>/recipes/<folderId>` (loader.ts:69-73).
- **NOT read-only — the recipe compiler writes back into the app dir.** `compileApp` writes the compiled `recipes.json` into the recipe app's OWN directory: `join(app.dir, 'recipes.json')` + `writeFileSync` (`apps/compiler.ts:118-119`). Triggered (a) at startup auto-compile for any app with `instructions.md` but no `recipes.json` (fire-and-forget loop, `index.ts:311-327`) and (b) by the no-auth REST compile endpoint via `setCompileHandler` → `recompileApp` (`index.ts:330-333`; `apps/loader.ts:188-195`). For user apps the target is `~/.ekoa/apps/<id>/recipes.json`; for the 3 bundled apps it is `cortex/apps/<appId>/recipes.json` — the repo working tree in dev and the container's writable image layer in prod, i.e. the same lost-on-redeploy durability-hole class as the `ekoa-data/integrations/` prod saves flagged in §8. Rebuild: compiled recipes are derived data and must land in a durable, non-image location (or be recompiled deterministically at boot).

### 7.5 Unconfined `file.read`/`file.write` recipe primitives (ekoa_action) — SECURITY-RELEVANT
- The automation recipe vocabulary (`ekoa_action` manifests) includes `file.read` and `file.write` ops that read and write **arbitrary filesystem paths**: `file.read` = `readFileSync` of the resolved path; `file.write` = `mkdirSync(recursive)` + `writeFileSync` (`automation/platform-primitives.ts:207-221`).
- Paths resolve through `resolveUserPath` (`platform-primitives.ts:320-326`), which only expands `~`/`~/…` to the process home dir and otherwise **returns absolute paths unchanged** — the in-code comment reads "reject absolute paths outside the user's sandbox? For now: trust user-issued paths via Ekoa actions, since manifests are authored by the coding agent under our control". The `userId` parameter exists but is ignored (`_userId`); relative paths resolve against the **operator's home dir**, not the user's sandbox.
- §3.7 covers this module only for its `store.*` app-data vocabulary (`platform-primitives.ts:97-132`); this fs vocabulary is a separate, unconfined data-plane surface.
- MI: the rebuild must make an **explicit confinement decision** — jail these ops to the owner's sandbox (mirroring `services/artifact-files.ts` `resolveSafePath`), or drop them. Do not port the trust-all-paths behavior silently.

---

## 8. Repo-versioned content read at runtime (`ekoa-data/`, `.ekoa/`, `cortex/apps/`)

| Path (repo root) | Read by | Notes |
|---|---|---|
| `ekoa-data/plugins/skills/` | `skills/loader.ts` via `config.skills.path` (`SKILLS_PATH` \|\| `../ekoa-data/plugins/skills`, `config.ts:86-88`); `agents/plugin-loader.ts` | agent skills (SKILL.md per dir) |
| `ekoa-data/plugins/instructions/` | `apps/compiler.ts:20` | instruction→recipe compilation |
| `ekoa-data/integrations/<key>/` | `services/integration-storage.ts:26-33` (**the versioned dir IS the global-skill runtime location**; `EKOA_DATA_REPO_DIR` override); `adapters/external.ts:563`; `tools/platform-integration-call.ts:27` | `SKILL.md`, `config.json`, `history.json`, `automations/*.json`. **Prod saves land in the container's writable layer and survive only until next deploy — git is the propagation mechanism** (`integration-storage.ts:5-11`). Rebuild must fix this durability hole |
| `ekoa-data/featured-artifacts/<id>/` | `services/featured-artifacts-seeder.ts:39-44`; execute-handler (scaffold copy on first build); featured-artifact-builder; featured-update | curated Starting Points |
| `ekoa-data/bases/<baseId>/` | `services/base-loader.ts:75` (closed enum: app-auth-persistent, landing, presentation, app-integration-heavy, document — :18-33) | design tokens/skills/layout per build |
| `ekoa-data/memories/seed.json` | `memory/seed.ts:47-53` | idempotent memory seeding |
| `ekoa-data/knowledge/sources.seed.json` | `services/knowledge-seed.ts:47-49` | default crawl sources (seedId-idempotent) |
| `ekoa-data/demos/*.json` + `demos/assets/` | `services/demo-registry.ts:185-193` | tutorial-bridge demo specs; served at `/api/demos*` |
| `ekoa-data/onboarding/catalogs/<vertical>.md` | `services/onboarding-prompt.ts:111-112` | vertical catalog, generic fallback |
| `ekoa-data/legal-engines/` (`juros.mjs`, `custas.mjs`, `tabelas-taxas.json`) | `services/legal-calculos.ts:75-95` (dynamic import) | canonical legal calc engines |
| `.ekoa/plugins/<name>/plugin.json` + `system-prompt.md` (+ `profiles/`), `.ekoa/skills/` | `agents/plugin-loader.ts:76-90` (project root found by walking up to a dir containing `.ekoa/`) | SDK plugin composition (plugins: agent, claude-code, cortex) |
| `cortex/apps/{ekoa.company, ekoa.deployments, ekoa.projects}` | `apps/loader.ts:44` | only 3 bundled recipe apps. **Also WRITTEN at runtime:** the compiler writes compiled `recipes.json` back into each bundled app dir (`apps/compiler.ts:118-119`, via startup auto-compile `index.ts:311-327` and the REST compile endpoint `index.ts:330-333`) — repo tree / container writable layer, same durability-hole class as `ekoa-data/integrations/` above; see §7.4 |
| `cortex/src/data/scaffold-templates/` | `app-scaffold.ts` | new-app starter files (App.jsx, index.jsx, index.css, index.html) |
| `ekoa-data/apps/`, `ekoa-data/settings/{company,settings,templates}.json`, `ekoa-data/brand-assets/`, `ekoa-data/legal-shared/`, `ekoa-data/legal-spine/`, `ekoa-data/knowledge/content.md` | **no cortex/src reader found** (grep sweep) | Conflicts C13/C14 — CLAUDE.md claims `ekoa-data/settings/` provides default settings JSON; nothing reads it. legal-shared/legal-spine are agent-consumed content, not code-read |

---

## 9. Explicitly in-memory only (a rebuild must not invent persistence for these)

| Item | Detail | Citation |
|---|---|---|
| Traces | 200-record ring buffer, no file I/O | `traces/index.ts` |
| SSE replay buffers | 200 events/trace | `sse.ts` |
| Device-login pending codes | in-memory Maps, "single-instance Cortex" comment | `tools/device-auth.ts:12, 43-45` |
| Slug index | rebuilt from artifact-instances at boot | `services/slug-generator.ts`; `index.ts:99` |
| Artifact-backend invocation history/logs | per-artifact in-memory Map — lost on restart | `services/artifact-backend/runtime.ts:244, 535-538` |
| App registry | chokidar-watched in-memory map; no registry file | `app-registry.ts:308` |
| Local-daemon bridge connections | daemon connection registry — `byConnectionId` / `byOwner` Maps of live socket wrappers, plus each connection's `pending` RPC-correlation Map. Process-local: a daemon is "connected" only to THIS instance. The automation RunStatus `awaiting_daemon` (`automation/types.ts:446`, see §5.1 automation-runs) is decided against this registry, so daemon availability is single-instance state | `bridge/registry.ts:11-13`; `bridge/connection.ts:79` |
| Encryption key | `ENCRYPTION_KEY` env, insecure dev default `'default-dev-encryption-key-32ch!'`; no keyfile on disk | `tools/crypto.ts:15` |
| Claude OAuth tokens | Supabase only, never on local disk | `services/claude-auth.ts` |

The single-instance assumption (device-auth, JsonStore mutex, SSE, in-memory slug index, daemon-bridge registry) is pervasive — a horizontally-scaled rebuild must externalize all of these or explicitly re-commit to single-instance.

---

## 10. Migration implications — consolidated

1. **App-data → collections engine**: near-direct port. Preserve: `(appId, collection)` scoping with a single query-binding point, `usr.<owner>` shared scope with server-side resolution, `isValidCollection` charset contract, `_rev` CAS update semantics, `buildNewItem` envelope, PUT-upsert behavior, seed-through-backend (`seedAppData`), and the parity-test discipline. Re-verify PITR GA status if keeping the Mongo-compat surface (§3.5).
2. **Domain JsonStores → Firestore collections**: mechanical for most (users, teams, settings, automations, triggers, integration-configs, artifact-instances, memories, sessions/messages, adobe-agreements, app-sessions, knowledge-sources). Special care: `takeById` single-use consume (app-SSO anti-replay) → transaction; trigger EventEmitter bus → Firestore listeners; slug uniqueness → transactional constraint; token-events ledger → append-optimized design (worst whole-file-rewrite hotspot today).
3. **Blobs → object storage**: app-files bytes, automation-run screenshots, artifact screenshots/PDFs, brand-asset cache, knowledge raw uploads, featured-build dists (regenerable). All are filesystem-pinned today regardless of backend. `blobRefs`/`storedPath`/`screenshotPath` fields store data-dir-relative or absolute paths — all must become storage references.
4. **Event queue**: SQLite semantics (UNIQUE dedup, atomic claim, retry ladder, boot recovery) need either a Firestore-transactional redesign or a managed queue; watch the 1MB doc limit vs `raw_body BLOB`.
5. **Knowledge vault + FTS**: keep out of the collections engine; it is a filesystem corpus + derived lexical index with its own scale profile (~8GB corpus, ~6GB index).
6. **Sandboxes/git/browser profiles**: workspace state, not DB state; durability via git mirror already exists.
7. **Control plane**: decide Supabase-stays vs move; reproduce the OAuth rotation semantics exactly; drop the 9 dead tables.
8. **Unify the data-dir path convention** (hardcoded vs env-honoring split) and the three "sessions" namings.
9. **Retention decisions to make explicit**: automation runs (grows forever by design), token events, activity logs, messages, jobs.
10. **Secrets**: AES-256-GCM ciphertexts (integration credentials, trigger HMAC secrets, captured browser sessions, Graph tokens) survive only if the key management story is preserved or a re-encryption migration runs; move off the env-var key with insecure default.
11. **Confine or drop the recipe `file.read`/`file.write` primitives** (§7.5): today they trust arbitrary absolute paths (`platform-primitives.ts:320-326`) — an explicit sandbox-confinement decision, not a silent port. Likewise decide where compiled `recipes.json` write-back lands (§7.4) — today it targets the app's own dir, including the container image layer for bundled apps.

---

## Conflicts

Doc/code and code/code contradictions found. None resolved silently.

| # | Conflict | Evidence | Status |
|---|---|---|---|
| C1 | **The brief's headline contradiction — docs claim JsonStore at `~/.ekoa/data`, production allegedly Firestore on GCP.** Code truth: BOTH are real, split by data family. Domain stores are genuinely JsonStore/SQLite/filesystem with no Firestore path at all; ONLY app-data is switchable to Firestore via `EKOA_APP_DATA_BACKEND=mongo` (MongoDB-compat wire protocol, no GCP SDK). CLAUDE.md's "All data stored as JSON files via the JsonStore layer" is wrong for app-data (and for the two SQLite DBs); a blanket "production uses Firestore" is wrong for everything except app-data. The literal prod env value lives in the external `ekoa-deploy` repo, absent from this machine — unconfirmed from source. | `persistence/app-data.ts:70`; `app-data-mongo.ts:6-9`; `index.ts:128-136`; `cortex/scripts/firestore-provision.sh:80-86`; CLAUDE.md persistence section; `cortex/docs/GOVERNANCE.md:140` (the accurate doc: "plus per-app app-data (fs or Firestore-mongo)") | Recorded; prod env value = open verification item against `ekoa-deploy` |
| C2 | CLAUDE.md persistence list is stale: `jobs.json` is actually per-file `jobs/<id>.json` (`jobs.ts:26`); `projects.json` is per-user per-file AND consumer-less (`projects.ts:23`, §5.1); `templates.json`, `governance.json`, `deployments.json`, `template-skills/`, `template-previews/`, `template-screenshots/`, `~/.ekoa/.claude/skills/manifest.json` have **zero code references** in cortex/src (grep at HEAD; only stale comments mention a non-existent `template-storage.ts` at `settings.ts:5`, `integration-storage.ts:6,35`, `automation-browser.ts:16`) | grep sweep, verified | Recorded |
| C3 | Integrations file is `integration-configs.json`, not CLAUDE.md's `integrations.json` | `integrations.ts:42` (verified) | Recorded |
| C4 | Data-dir env split: 14 stores hardcode `~/.ekoa/data` (ignore `EKOA_DATA_DIR`); sessions/company/app-sessions/adobe-agreements use `config.dataDir`; knowledge/app-data resolve env per call. Works only because prod doesn't set `EKOA_DATA_DIR` | verified grep, §5.0 | Recorded; rebuild must unify |
| C5 | CLAUDE.md claims a `settings.general.previewMode` toggle with backend default in settings-handler; **no `previewMode` exists anywhere in `persistence/settings.ts` or `handlers/settings-handler.ts`** (grep at HEAD returns nothing) | verified grep | Recorded |
| C6 | Three unrelated "sessions" stores (dashboard chat `persistence/sessions.ts`, SDK-turn context `src/sessions.ts`, end-user SSO `persistence/app-sessions.ts`) and two "app-data-migration" modules (`persistence/` = slug→id; `services/` = per-user fold) — naming collisions | §5.1, §6.3 | Recorded |
| C7 | Supabase migrations define ~12 tables; cortex touches exactly 3. The 002 token/billing family duplicates cortex's local `persistence/billing.ts` — dead control-plane schema. Also `MAES-…` vs `EKOA-…` license-key format drift in migration comments | §4.3 | Recorded; rebuild must not carry dead tables |
| C8 | `docs/firestore-integration/FINDINGS.md` Caveat A ("seed writes bypass the backend chokepoint") describes the PRE-fix state; current code routes seeds through `seedAppData` (`app-data.ts:100-119`) — doc is stale, code is fixed | §3.1 | Recorded |
| C9 | FINDINGS.md Caveat D: PITR + snapshot reads on Firestore's Mongo-compat surface were Preview-not-GA (as of 2026-06-08) and Node-driver `setSnapshotTimestamp` support unverified; code degrades honestly (`PITR_DRIVER_UNSUPPORTED`) but production reality needs re-verification | §3.5 | Open verification item |
| C10 | `'gcs'` restore-point source is enum-only: accepted by handler validation (`app-data-backups-handler.ts:33`) but `previewAsOf` throws for it and nothing creates gcs points (`app-data-backups.ts:31, 194`) | §3.6 | Recorded — stub, don't spec it as working |
| C11 | Dead code: `deleteStoredCredentials` (`supabase-client.ts:116-129`) has zero callers — the 401 path intentionally keeps rows (`claude-auth.ts:340-356`). Also `claude_email` in `SupabaseRow` type/DDL is never selected by the server (script-only) | §4.2 | Recorded |
| C12 | Automation runs and token events grow forever by design (`automation-runs.ts:8-10`; billing append-only) — retention is an explicit rebuild decision, not an oversight to "fix" silently | §5.1 | Recorded |
| C13 | CLAUDE.md lists `brand-assets/` under versioned `ekoa-data/`; the runtime cache is actually `~/.ekoa/brand-assets/` (`brand-asset-proxy.ts:13-18`) and no code reads `ekoa-data/brand-assets/` | §7.2, §8 | Recorded |
| C14 | CLAUDE.md claims `ekoa-data/settings/` provides "Default settings, company, templates JSON" — no cortex/src reader exists for `ekoa-data/settings/`, `ekoa-data/apps/`, `ekoa-data/legal-shared/`, `ekoa-data/legal-spine/`, `ekoa-data/knowledge/content.md` | §8 grep sweep | Recorded |
| C15 | `services/knowledge-ripgrep.ts` header still claims ripgrep is the sole search backend — contradicted by `services/knowledge-fts.ts` (FTS5 preferred when ready) | §6.2 | Recorded (stale comment) |
| C16 | `docs/deployment-architecture.md` contains zero mention of Firestore or `EKOA_APP_DATA_BACKEND`; the prod backend switch is documented only in `docs/firestore-integration/` and code headers | §2 | Recorded — do not source persistence facts from deployment-architecture.md |
