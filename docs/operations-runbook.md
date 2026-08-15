# Operations runbook

How to run, test, deploy-check, and reason about the state of ekoa-code. Written for the solo
operator and any future agent session. Paths are relative to the repo root.

## Run

The operator path is the root dev script - full stack in dev mode plus automatic model-credential
provisioning (browser one-click "Authorize" on first run, silent token refresh afterwards):

```
npm run dev                # api (ts-node watch) + CORS proxy + next dev + credential provisioning
npm run dev -- --built     # serve api/dist instead of ts-node (build first)
npm run dev:auth           # re-authorize + re-provision into a RUNNING stack (token went bad)
```

`scripts/dev.mjs` wraps the committed driver below; `scripts/dev-credential.mjs` manages the token
(drop-file `~/.config/ekoa/claude-credentials.json`, chmod 600, dedicated OAuth session so it never
rotates under the operator's live `claude` login). Agents and harnesses use the driver directly:

```
node .claude/skills/run-ekoa-code/driver.mjs up            # boot api+proxy+web, stay alive, print a READY line
node .claude/skills/run-ekoa-code/driver.mjs smoke /chat   # boot, real-UI login, screenshot routes, tear down
```

Ports and login (all overridable by env, defaults shown): the real Express API runs on an
**internal** `:4211` (`EKOA_API_PORT`); a zero-dependency CORS reverse proxy occupies `:4111`
(read from the `backend.port` file - the port the web bundle and node drivers already resolve to)
and forwards to `:4211`; Next.js dev runs on `:3000` (`EKOA_WEB_PORT`). Login is `admin` /
`tmp12345` (`EKOA_ADMIN_USERNAME` / `EKOA_ADMIN_PASSWORD`). `EKOA_API_MODE` picks the api serving
mode: `built` (serves `api/dist/server.js`, so run `npm run build` first) or `dev` (ts-node
transpile-only watch, no build needed). `npm run dev` defaults to `dev`; the bare driver defaults
to `built`.

Why booting `next dev` and the api dev server by hand does not work - the driver exists to solve
exactly this:
- `web/next.config.ts` computes the dashboard CSP `connect-src` from `NEXT_PUBLIC_API_URL`. Left
  unset, the browser blocks the login fetch to the API as a CSP violation.
- The API ships **no CORS middleware on purpose** - in production web and API are same-origin
  behind the edge proxy. A cross-origin dev login therefore fails preflight with no
  `Access-Control-Allow-Origin`.
The driver fixes both: it points `NEXT_PUBLIC_API_URL` at the `:4111` proxy (satisfying the CSP and
aiming the browser at the proxy), and the proxy injects permissive CORS (reflecting Origin, allowing
`Authorization`) onto every API response. Auth is Bearer-token in localStorage, so a CORS shim is
sufficient - no cookie/credentials handling.

Dev state is **ephemeral**. `scripts/dev-api.mjs` (which both the driver and the e2e harness use)
boots an in-memory `mongodb-memory-server` per process and points `MONGODB_URI` at it, so the whole
database is created fresh on every boot and discarded on exit. Only disk state survives a restart:
`~/.ekoa/sandboxes` (owner build git snapshots, `SANDBOX_ROOT`) and `~/.ekoa/data/featured-builds`
(prebuilt featured-app bundles, `EKOA_FEATURED_BUILDS_DIR`), both under `~/.ekoa/data`
(`EKOA_DATA_DIR`).

## Test

`npm run ci:lane` is the single per-PR gate. In order it runs: `lint` (ESLint over the repo plus the
web lint - this is where the import-boundary and no-`@anthropic-ai` rules fire); `gate:chokepoint`
(`scripts/chokepoint-grep.sh` - over every first-party source root, fails the build if
`@anthropic-ai` or the provider host appears IN ANY CASE outside `api/src/llm/`, plus a broad
lowercase `anthropic` token as a split-string net, catching raw fetches the import rule cannot see;
a declared scan root that is not a directory also fails, since it would otherwise be reported clean); `gate:encryption-key` and
`gate:garrison` (the other grep guards); `typecheck` (all workspaces); `test` (all workspaces -
unit + contract suites under vitest); and finally `build` (shared, api, web) with
`NEXT_PUBLIC_API_URL` defaulted to `http://localhost:4111`.

`npm run e2e:server` (`scripts/e2e-with-server.mjs`) boots `dev-api.mjs --built` (so run
`npm run build` first), waits for the featured-app prebuild, then runs the suite-ledger e2e. It
carries **known, documented committed-baseline debt** (see `docs/testing.md` and
`docs/known-flakes.md`) - this is not a regression and not a flake:
- The **band1** dashboard specs (13) drive the Next dashboard on `:3000`, which this api-only
  harness never starts, so each `page.goto('/login')` gets `ERR_CONNECTION_REFUSED`. The old
  "127/127" runs relied on the operator's separately-running dev web.
- **4 band2 specs** (`artifacts-apps-section`, `artifact-backend-panel`, `update-from-bundle`,
  `vertical-profile`) POST to the retired `/api/v1/action` (FIXED-2, no such route), get an HTML 404,
  and throw `Unexpected token '<'` in `beforeAll`.
- The **4 `erp-*` drivers** target an out-of-catalog `@brasilsalomao.pt` tenant fork; they are
  deferred to the post-run CUTOVER milestone and report `skipped (awaiting CUTOVER)` - censused,
  never a silent pass.
The repair plan is `docs/e2e-harness-remediation-brief.md` (a full-stack self-contained
harness, migration of the retired-protocol specs, and ERP-fork reconstitution).

Security gates, run out of the lane: `gate:sast` (semgrep over `api/src` + `shared/src`),
`gate:secrets` (gitleaks), `gate:audit` (`npm audit --audit-level=high`).

## Deploy (dry-run only)

This repo builds and validates the deploy shape; it never performs a real deploy or cutover. A real
cutover is the founder-gated cutover procedure, outside this run - archived with the build-run spec
(see the archive note in `docs/governance.md`).

- `Dockerfile.api` - multi-stage `node:20-bookworm-slim`, builds shared+api, ships `api/dist` +
  `api/assets` + production deps only, runs as non-root `node` on `:4111`. Secrets are never baked
  in; they arrive at runtime from Secret Manager.
  - Since operator-run G2, the api build (`npm run build --workspace api`) ALSO produces
    `api/assets/panel-runtime.js` (the served-app assistant panel, a gitignored build artifact).
    Any deploy path must run that build step and ship the produced asset - the Dockerfile copies
    `api/assets` from the build stage for exactly this reason. If the asset is missing at api boot,
    the server logs `[panel-runtime] client unavailable` and every served app's assistant launcher
    is a dead affordance (the route serves a 200 comment fallback).
- `Dockerfile.web` - Next.js standalone output on `:3000`. `NEXT_PUBLIC_API_URL` is a **build arg**
  (the public API origin the browser calls, inlined at build - not a secret), passed via
  `docker build --build-arg`.
- `deploy/api.service.json`, `deploy/web.service.json` - the P-02 two-container topology descriptors
  (ports, health endpoints, Dockerfiles). Their `env_passthrough` is **names only**; values live in
  Secret Manager.
- `deploy/validate-topology.sh` - static check (no network): asserts the two-container shape, the
  ports/health endpoints, that no obsolete lanes are carried, and that no secret **values** appear
  under `deploy/`.
- `deploy/cutover.sh --dry-run` - prints the P-26 upstream-swap plan and makes no changes; it refuses
  to run without `--dry-run`.
- `.github/workflows/deploy.yml` - triggers on `rc-*` tags (and `workflow_dispatch`). It builds both
  images with `push: false`, then runs `validate-topology.sh` and `cutover.sh --dry-run`. No registry
  push, no deploy.

### Staging (live) - `deploy/staging/`

The one runnable environment: a single GCP VM (`ekoa-staging`, e2-standard-2, europe-west4-a) that
actually serves the ekoa-code stack for one user at `https://staging.ekoa.io`. It does NOT change the
dry-run cutover shape above (that remains the founder-gated production path); it is a parallel, disposable
box built from the same two images. See `deploy/staging/README.md` for the full runbook.

- **Topology.** `docker-compose.yml` runs four services on the VM: **Caddy** (auto-HTTPS +
  same-origin reverse proxy), **web** (`Dockerfile.web`), **api** (`Dockerfile.api`), and a self-hosted
  **Mongo** (standalone - the api uses no transactions). Caddy path-routes the api-owned prefixes to the
  api and everything else to web, so the browser calls the API on the same origin it was served from -
  the `web/lib/api/base-url.ts` "same-origin (Caddy proxy)" contract. The web image is built with
  `NEXT_PUBLIC_API_URL=https://staging.ekoa.io`.
- **Caddy `@api` allowlist is a maintained invariant.** The api serves a FIXED set of non-`/api`
  browser-facing prefixes beyond `/api/*`, `/health`, `/hooks`: the served-app pipeline `/apps/*` (the
  live preview iframe) + its injected `/__ekoa/*` runtime scripts, and the static mounts
  `/artifact-screenshots/*`, `/artifact-pdfs/*`, `/automation-screenshots/*`, `/brand-assets/*`, plus the
  share-link `/build/*`. All are enumerated in `api/src/server.ts` (buildApp) and MUST be mirrored in the
  Caddyfile `@api` matcher - anything missing falls through to Next and returns a Next HTML 404 (this once
  broke app previews + card thumbnails through the public origin; `docs/findings.md`
  `staging-caddy-api-path-allowlist-incomplete`). Adding a new non-`/api` api mount is a structural change:
  update the Caddyfile in the same unit of work.
- **Editing the Caddyfile requires a `restart`, not a `reload`.** The Caddyfile is a single-file bind
  mount (`./Caddyfile:/etc/caddy/Caddyfile:ro`), which pins to the file's inode at container start; an
  in-place edit that changes the inode leaves `caddy reload` serving the stale config. After any Caddyfile
  change run `docker compose -f deploy/staging/docker-compose.yml restart caddy` and confirm with
  `docker compose exec -T caddy grep '@api path' /etc/caddy/Caddyfile`.
- **Secrets.** Injected at runtime from `deploy/staging/.env` (gitignored, VM-only, mode 600); only
  `.env.example` is committed. Staging uses **freshly generated** `JWT_SECRET` / `ENCRYPTION_KEY` /
  `MONGO_PASSWORD` - never production's. The prod secrets are preserved separately in GCP Secret Manager.
- **Chromium.** `Dockerfile.api` now installs `playwright ... chromium --with-deps` in the runtime stage
  (with `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` so the non-root `node` user finds it). Without it the
  automation/streaming/screenshot planes fail at runtime even though `playwright` is a prod dependency.
- **Bring-up.** `deploy/staging/provision.sh` on the VM: installs Docker, adds swap, `compose up -d
  --build`, health-gates `api:/health` + `https://staging.ekoa.io/health`, and (if a key is exported)
  arms the model credential.
- **Model credential.** Provisioned ONCE via `POST /api/v1/credentials` (the setCredential seam) with a
  goncalo@ekoa.io Anthropic key - staging Mongo is persistent, so unlike dev it survives restarts and does
  not need re-arming each boot.

## Secrets and env

**Model credential posture (read this before wondering why chat/build errors on a fresh boot).** The
provider credential is a single AES-encrypted document in the `credentials` Mongo collection
(`_id: 'default'`), written **only** through the in-process `setCredential` seam in
`api/src/llm/credentials.ts`. No env var and no migration seeds it; the one runtime path is the
super-admin `POST /api/v1/credentials` route (which itself writes through that seam) - the route
`provision-credential.mjs` and `npm run dev` use. A
fresh boot is therefore honestly un-credentialed: `GET /health` reports `claudeAuth.configured=false`
and `claudeAuth.ok=false`, and every chat/build call errors with "No model credential configured"
until the credential is provisioned. Because dev Mongo is in-memory and ephemeral (below), the
credential is wiped on every restart and must be re-provisioned each boot - see "Model credential
re-provisioning" below. The original provisioning gap (`docs/findings.md`, F2) is fixed-verified; the
sanctioned dev path is `provision-credential.mjs`.

Env names the API reads, with dev defaults:

- `JWT_SECRET`, `ENCRYPTION_KEY` - mandatory, fail-closed at boot (`api/src/config.ts`). Dev harness
  sets `dev-only-jwt-secret` / `dev-only-encryption-key`.
- `MONGODB_URI` - mandatory, no default; the dev harness injects the in-memory server URI.
- `PORT` - API port, default `4111`.
- `EKOA_ADMIN_USERNAME` / `EKOA_ADMIN_PASSWORD` - seeded admin, dev default `admin` / `tmp12345`.
- `LLM_CHOKEPOINT_BASE_URL` - the egress chokepoint the SDK subprocess is pointed at, default
  `http://127.0.0.1:4111/api/v1/llm`.
- `LLM_PROVIDER_BASE_URL` - upstream provider origin; empty means the built-in default resolved
  inside `api/src/llm/` (the host literal is kept out of config to satisfy the chokepoint grep).
- `LLM_GATEWAY_API_KEY` - static key for the ekoa-local gateway; unset means JWT-only gateway auth.
- `LLM_GATEWAY_ENABLED` - gateway mount toggle, default on (set `false` to disable).
- `LLM_OAUTH_TOKEN_URL` - OAuth token endpoint used to renew a subscription credential. **Defaulted**
  since 2026-08-11 to the public subscription endpoint, so refresh works out of the box; set only to
  point at a different tenancy. (`LLM_OAUTH_REFRESH_URL` is the legacy name and is still read.)
  It previously had NO default and refresh "failed closed" - which in practice meant refresh was dead
  in every environment and every oauth credential was a time bomb: on expiry it took down all chat and
  build runs, and the failure text named this env var to the end user (`docs/findings.md`
  `run-error-text-leak`). Fail-closed is right for authorisation, not for a self-heal path.
- `LLM_OAUTH_CLIENT_ID` - OAuth client presented on refresh; defaulted to the public subscription
  client. Override alongside `LLM_OAUTH_TOKEN_URL`.
- `LLM_MODEL_FAST` / `LLM_MODEL_WORKHORSE` / `LLM_MODEL_EXPERT` - per-tier model id overrides.
- `GITHUB_PUSH_ENABLED` - auto-commit/push kill switch, default off (`true` to enable).
- `GITHUB_DEV_TOKEN` - dev PAT; refused in a production-like environment.
- `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` (or `_PATH`) / `GITHUB_APP_INSTALLATION_ID` /
  `GITHUB_ORG` (or `GITHUB_OWNER` + `GITHUB_OWNER_TYPE`) / `GITHUB_REPO_PREFIX` - GitHub App creds
  for per-app repos.
- `MEMORY_AUTO_EXTRACT_ENABLED` - platform kill switch for automatic memory extraction, default on.
- `EKOA_BILLING_HARD_LIMIT` - hard usage-cap enforcement flag, default on.
- `SANDBOX_ROOT` - owner build sandboxes, default `~/.ekoa/sandboxes`.
- `EKOA_FEATURED_BUILDS_DIR` - prebuilt featured bundles, default `~/.ekoa/data/featured-builds`.
- `EKOA_DATA_DIR` - runtime data root (app-data, artifact PDFs, snapshots), default `~/.ekoa/data`.
- `EKOA_IMPORT_LEGACY_RUNTIME` - opt-in (`1`) for the boot import of the FROZEN legacy disk runtime
  integration tier (`<EKOA_DATA_DIR>/integrations/runtime/`) into Mongo as `visibility:'global'`
  rows. Default UNSET = report-only: every boot logs `[legacy-runtime-import] REPORT-ONLY: ...`
  naming each package that would be imported, and persists nothing - those packages resolve for
  NOBODY until you either set this flag for one boot (they become global, cross-tenant, exactly
  their pre-A3 reach; a super-admin can then retire individual rows reversibly via
  `PATCH /api/v1/integrations/definitions/:id/visibility`) or delete the directory. Rationale and
  the tenancy consequences: `docs/decisions.md` 2026-08-03; Rule-10 review date 2026-08-15.
- `API_PUBLIC_URL` - public origin used to build absolute trigger/webhook URLs, default empty.
- OAuth provider creds for integrations: `MICROSOFT_*`, `MICROSOFT_SSO_*`, `GOOGLE_CLIENT_*`,
  `ADOBE_*` (see `deploy/api.service.json` `env_passthrough` for the deploy-time list).

### The served-app WORKSPACE planes (`/api/m365/*`, `/api/app-cloud-files/*`)

These act as the connected Microsoft/Google account **of the app's OWNER** (the token is resolved
per request from the admitted app scope - `api/src/integrations/workspace-credential.ts`), so three
things must all be true before a served app can reach Graph, and each fails in its own way:

1. **The org is connected.** An org-admin completes the managed OAuth connect for the provider
   (`POST /api/v1/integrations/platform/microsoft/connect` → callback). Needs
   `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` (`common` unless the
   deployment is single-tenant) and `OAUTH_REDIRECT_BASE_URL` - note the name: ekoa-dev called this
   `EKOA_OAUTH_REDIRECT_BASE_URL`, and a value carried over verbatim from that deployment will not
   be read. Not connected ⇒ `502` from the Graph proxy, `409` from cloud-files, `connected:false`
   from `/api/app-cloud-files/status`. The granted scopes (`api/src/integrations/platform-oauth.ts`
   `MICROSOFT_SCOPES`) include `Sites.ReadWrite.All`, which is what SharePoint folder/file creation
   through `PUT /api/m365/v1.0/sites/<id>/drive/root:/<path>:/content` needs.
2. **The app opts in.** `manifest.json` must declare `"m365Proxy": true` for `/api/m365/*`; without
   it the proxy answers `403 App has not enabled the Microsoft 365 workspace proxy`. It is a
   per-app decision on purpose, and it is NOT inferred on import - an app brought in from the old
   platform (whose proxy had no such flag) must have it added to its manifest.
3. **The owner is active.** `checkOwnerActivation` gates both planes: `403 ACCOUNT_DISABLED` /
   `402 BILLING_LOCKED`.

An app whose owner has no organisation resolves NOBODY (fail-closed, no provider traffic) - so a
served app registered outside an artifact, which has an empty owner, can never reach the plane.

### Zoho Sign (the OAuth popup connect)

`ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_DC` (plus `ZOHO_OAUTH_REDIRECT_BASE_URL`, which
overrides `OAUTH_REDIRECT_BASE_URL` for Zoho only - Zoho accepts `http://localhost` redirects, so
local dev needs no tunnel). Without the client pair the connect route answers `503` naming exactly
those two variables, and the dashboard surfaces that message verbatim rather than a generic
failure - the whole point, since upstream spent weeks with a button that could only ever refuse.
Measured 2026-08-06: the dev-madrid `ekoa-dev/cortex/.env` declares both keys with EMPTY values, so
a copy of that file connects Microsoft but not Zoho.

## Model credential re-provisioning

The provider credential is the AES-encrypted `credentials/default` document in Mongo. Dev Mongo is
`mongodb-memory-server`, created fresh and discarded on every boot, so the credential does not survive
a restart - re-provision it after every stack (re)start. `npm run dev` does this automatically
(`scripts/dev-credential.mjs`: refresh the stored token, or browser-authorize a new dedicated OAuth
pair into `~/.config/ekoa/claude-credentials.json`); `npm run dev:auth` repairs a running stack. For a
stack booted through `driver.mjs` directly, provision by hand:

```
export CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token)   # or an ANTHROPIC_API_KEY for api-key mode
node .claude/skills/run-ekoa-code/provision-credential.mjs
# or, no browser and no shell secret handling: node scripts/dev-credential.mjs --no-browser --provision
```

**Prefer the `dev-credential.mjs` form for oauth.** It carries the `refreshToken` + `expiresAt` from
the drop-file into the POST body; the bare `CLAUDE_CODE_OAUTH_TOKEN` form provisions an access token
with no renewal material. Until 2026-08-11 BOTH forms dropped them, so every provisioned oauth
credential was unrefreshable and died at expiry, taking all chat and build runs with it
(`docs/findings.md` `run-error-text-leak`). The API now warns at load and at provision time -
`[llm][claudeAuth] WARNING: oauth credential stored WITHOUT a refresh token` - so grep the boot log
for that line if runs start failing after a period of working.

This posts to the super-admin `POST /api/v1/credentials` route, which writes through the in-process
`setCredential` seam - no env var or boot-time path seeds it (invariant 4). Confirm with `GET /health`:
`claudeAuth.ok=true`,
`claudeAuth.configured=true`, `meteringAnomalies=0`, `gatewayUnmeteredCalls=0`. Only then is a live
model turn trustworthy. Do not use the operator's live Claude Code login token for long-lived stacks -
it rotates on `/login` and invalidates the seeded snapshot (`docs/known-flakes.md`); provision a
dedicated account token.

## Knowledge importer

The `_shared` legal corpus (the public partition every org's searches also consult) is written ONLY by
the offline importer CLI - the online service refuses a shared-org actor. Import a staged corpus:

```
npm run tool:knowledge-import -- --source <staged-corpus-dir>              # dry-run (default)
npm run tool:knowledge-import -- --source <staged-corpus-dir> --execute    # write
npm run tool:knowledge-import -- --source <dir> --collection legislacao --collection jurisprudencia
```

Dry-run is the default; `--execute` is required to write. The target vault + FTS5 index live under
`EKOA_DATA_DIR` (or `~/.ekoa/data`); the tool REFUSES (exit 2) if `--source` resolves inside that data
dir - the live corpus must never be its own import source. A per-run journal is written to
`RUN_LOG.knowledge-import.txt` in the CWD (override with `--journal`); `--prune` removes vault docs
absent from the source (re-sync pattern), `--force` re-imports unchanged docs. **Restart the api after
an import** so the index-store picks up the new partition. The real production corpus import is
operator-blocked on ssh/rsync of the staged corpus (`docs/findings.md`, `prod-corpus-import`).

## Backup

State that matters:
- **Mongo collections** (`api/src/data/stores.ts`): `credentials` (the encrypted model credential),
  `billing_accounts` + `token_events` (usage/metering), `memories`, `artifacts` + `slugs` (published
  app metadata), `users` / `orgs` / `sessions` / `messages`, `integration_configs`, `automations`.
- **Disk under `~/.ekoa`**: `sandboxes` (owner build git snapshots), `data/featured-builds` (prebuilt
  bundles), `data/app-data` + `data/app-data-snapshots` + `data/artifact-pdfs`.

Honest current answer: **there is no platform-level backup tooling in this repo** - no
mongodump/restore script, no scheduled dump, no disk-snapshot job. The only backup feature is
per-app-data snapshots (`api/src/apps/backups.ts`, the user-facing "Dados e cópias de segurança"
panel), which snapshots a single app's data plane to `~/.ekoa/data/app-data-snapshots` - not the
Mongo instance or the disk as a whole. A production operator must provide Mongo + `~/.ekoa` disk
backups out-of-band.

## Salomao ERP cutover (ekoa-dev -> ekoa-code)

Moving the paying customer salomao's legal ERP - artifact `legal-case-manager-3`, served at
`https://api.ekoa.io/apps/legal-case-manager-3` by the OLD platform (`../ekoa-dev`, "cortex") -
onto this stack. Ordered; each step names its tool and its check. Env entries are KEY NAMES only -
values live in the old deployment's secret store and are never written down here. The migrate
tooling lives in `api/scripts/migrate/` (`convert-dev-bundle.mjs`, `convert-dev-state.mjs`,
`migrate-app-files.mjs`, `cli.ts` - each script's header comment is its authoritative CLI doc).

What you need before starting: a super-admin JWT on the old platform; shell access to the prod
box's data dir (`~/.ekoa/data` on that box); the old deployment's `ENCRYPTION_KEY` value (passed
to the converter as `EKOA_OLD_ENCRYPTION_KEY`); the target stack up with its own `JWT_SECRET` /
`ENCRYPTION_KEY` / `MONGODB_URI`; and the target env carrying `MICROSOFT_CLIENT_ID` /
`MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` / `MICROSOFT_SSO_CLIENT_ID` /
`ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` plus the two RENAMED keys called out in step 5.

### 0. Data-hygiene pre-flight (with the customer, before the export)

The 2026-08-15 vision pass (`docs/findings.md` `salomao-vision-pass-2026-08-15`) verified the
prod data carries items that should not cross as-is - all pre-existing upstream, none
introduced by the migration tooling. Walk them with the customer and clean ON PROD before the
export, so the cutover snapshot is the blessed one (a silent cleanup during conversion is not
an option - it is their data):

- Test/probe accounts holding the Master role in `utilizadores` (Probe, Teste Ekoa,
  Bazinga Da Costa, CRM Master) - remove or downgrade.
- The SharePoint integration URL in Definicoes points at the throwaway
  `bazingadas.sharepoint.com` test tenant; set the customer's real site BEFORE the M365
  credential is armed on the new stack, or client-folder provisioning writes into the wrong
  tenant.
- Duplicated client codes (`BSM-2026-0001` x3 plus five exact duplicate pairs) and the junk
  `atividades` row 'dfdffddggdhd' - merge/delete with the customer's sign-off.
- Platform-e2e residue rows (E2E-* prefixes) in several collections - delete.

### 1. Pre-cutover export on prod (api.ekoa.io / ekoa-dev)

Export everything the same day you cut over - a stale envelope resurrects deleted rows. The old
platform speaks the action protocol: `POST /api/v1/action` with
`{ app, intent, params, request_id }`, Bearer JWT; the result arrives under `.data`.

1. **Resolve the canonical app id.** `legal-case-manager-3` is the SLUG; app-data, files and the
   Zoho reverse index are keyed on the canonical id. Read it off the artifact list in the old
   dashboard or the instance store; every later step uses `<prodAppId>`.
2. **Artifact export envelope** - super-admin `export-instance` intent
   (ekoa-dev `cortex/src/services/artifact-bundle.ts` `exportInstance`):

   ```
   curl -sS https://api.ekoa.io/api/v1/action \
     -H "Authorization: Bearer $OLD_JWT" -H 'Content-Type: application/json' \
     -d '{"app":"ekoa.templates","intent":"export-instance","params":{"id":"<prodAppId>"},"request_id":"exp-1"}' \
     | jq '.data' > envelope.json
   ```

   The envelope carries `seedData` only for FEATURED artifacts and this one is not featured, so
   the envelope has NO data in it - the separate dump below is mandatory, not belt-and-braces.
3. **App-data dump** - `AppDataBackups.exportAll` via the backups handler
   (shape `{ appId, exportedAt, collections, counts, totalItems }`):

   ```
   curl -sS https://api.ekoa.io/api/v1/action \
     -H "Authorization: Bearer $OLD_JWT" -H 'Content-Type: application/json' \
     -d '{"app":"ekoa.app-data-backups","intent":"download","params":{"appId":"<prodAppId>"},"request_id":"exp-2"}' \
     | jq '.data' > appdata.json
   ```

   Record `jq '.counts' appdata.json` - it is the post-import reconciliation target.
4. **Files tree copy.** rsync `<oldDataDir>/app-data/<prodAppId>/` (the `files/` blob dir AND the
   sibling `__files.json` metadata collection - the migrator needs both) to the operator machine.
5. **Disk state pulls** from `<oldDataDir>`: `integration-configs.json` (encrypted per-user
   integration credentials - the M365 workspace connection and Zoho Sign), `zoho-agreements.json`
   (Zoho requestId -> app/proposta reverse index), `triggers.json` (the email listener rows, kept
   as the reference for step 3.3).
6. **In-flight counts to verify after cutover.**
   - Zoho: count the rows in `zoho-agreements.json`, and separately the IN-FLIGHT subset - rows
     whose `propostas` record (in `appdata.json`) has not reached stage `Assinada`. Write both
     numbers down.
   - Adobe: MUST be zero pending. Adobe was replaced by Zoho in ERP V13 and ekoa-code's Adobe
     backend is a fail-closed facade - an in-flight Adobe agreement will NEVER complete
     server-side on the new stack, and `convert-dev-state.mjs` refuses Adobe state by design.
     If any Adobe agreement is still pending, drain or re-send it via Zoho before cutover.

### 2. Convert (operator machine - read-only on inputs, no DB, no network)

1. **Manifest opt-in first.** The old platform's Graph proxy had no per-app flag; ekoa-code's
   `/api/m365/*` plane refuses any app whose manifest does not declare `"m365Proxy": true` (see
   the WORKSPACE planes section above), and the flag is deliberately NOT inferred on import. Edit
   `envelope.json` and add `"m365Proxy": true` to its top-level `manifest` object; the converter
   carries it through into the reconstructed `manifest.json`
   (`api/tests/migration/convert-dev-bundle.test.ts` pins exactly this pattern).
2. **Bundle + app-data:**

   ```
   node api/scripts/migrate/convert-dev-bundle.mjs envelope.json \
     --data appdata.json --slug legal-case-manager-3 --out bundle.json
   ```

   The converter reconstructs `manifest.json` from the envelope's manifest (that is where
   `backend.handlers: ["onEmail"]`, `extends` and the `m365Proxy` flag live), normalizes the dump
   under `bundle.data`, and fills `bundle.id` from the envelope's `sourceArtifactId` - confirm
   `jq -r '.id' bundle.json` equals `<prodAppId>`, because step 3.1 imports with `preserveId`.
   It refuses non-UTF-8 scaffold entries loudly; a refusal names the binary asset, which then
   travels via the files migration instead, never silently corrupted.
3. **Credential transcryption + Zoho index** (the two stacks cannot exchange ciphertext even
   under the same key value - wire formats differ):

   ```
   EKOA_OLD_ENCRYPTION_KEY=<old stack's ENCRYPTION_KEY value> ENCRYPTION_KEY=<target's> \
     node api/scripts/migrate/convert-dev-state.mjs <old-data-dir-copy> \
     --user <ownerUserId> --out state-out/
   ```

   `--user` derives the target orgId via the import-tool convention (`org-<userId>`); pass
   `--org <orgId>` instead when the owner's org on the target differs. Output:
   import-tool-ready `integration_configs.json` + `zoho_agreements.json` in `state-out/`,
   re-encrypted under the target key, `enabled:true`, `needsReauth` cleared. `--rewrite-app-id`
   stays unused - the canonical-id-preserving import keeps prod appIds valid. Neither key is
   ever printed; keep both out of shell history.
4. **File blobs + metadata sidecars.** The blob layout is identical across stacks but the
   metadata plane is not (old: `__files.json` collection; new: per-blob `<uuid>.json` sidecars -
   a raw blob copy without sidecars serves 404):

   ```
   node api/scripts/migrate/migrate-app-files.mjs \
     --src <copy-of old app-data/<prodAppId>> --app-id <prodAppId> --dry-run
   node api/scripts/migrate/migrate-app-files.mjs \
     --src <copy-of old app-data/<prodAppId>> --app-id <prodAppId>
   ```

   Target defaults to `EKOA_DATA_DIR` (or `~/.ekoa/data`) - pass `--data-dir` to override. The
   plan is computed in full before the first write (all-or-nothing); re-running is a no-op. Run
   the `--dry-run` first and read its report.

### 3. Import + arm (target stack)

1. **Import the bundle, preserving the canonical id.** Import AS THE OWNER ACCOUNT the salomao
   workspace will run under (the importer becomes the owner; the email plane and the consent gate
   both act as the OWNER) - the account needs `canBuildApps`:

   ```
   jq -n --slurpfile b bundle.json '{bundle: $b[0], preserveId: true}' \
     | curl -sS "$API/api/v1/artifacts/import" \
         -H "Authorization: Bearer $OWNER_JWT" -H 'Content-Type: application/json' -d @-
   ```

   Read the response's `importReport`: `id.preserved` true with `id.applied` = `<prodAppId>`
   (embedded `/api/app-files/<prodAppId>/...` URLs and the Zoho reverse index stay valid without
   rewrites); `slug.applied` = `legal-case-manager-3` with `fellBack` false; `appData.collections`
   per-collection `imported` matching the step-1.3 counts with `skipped` 0 (any skip carries its
   reason - chase every non-zero). An id collision is refused with a 409-class error, never
   silently remapped.
2. **Load the credential rows.** Point the import-tool at S4's output (missing family files read
   as empty, so the two-file source dir is fine); execute needs `MONGODB_URI` + `ENCRYPTION_KEY`,
   and `--content-data-dir` is required on every execute (the blob/prose family plans always
   exist, even when empty) - point it at the target data root:

   ```
   node --loader ts-node/esm api/scripts/migrate/cli.ts \
     --source state-out/ --execute --content-data-dir ~/.ekoa/data
   ```

   The run decrypt-samples every credential ciphertext under the target key - `0 failure(s)` or
   stop. (A direct Mongo upsert of the two `_id`-keyed files is the fallback; the import-tool
   path is preferred for its journal + checksum verification.) Then confirm the workspace reads
   as connected WITHOUT any re-auth: the dashboard's Integrações panel shows Microsoft and Zoho
   connected (the served app's `/api/app-cloud-files/status` reporting `connected:true` proves
   the same thing from inside the app plane).
3. **Create the email listener trigger.** Platform providers are ALWAYS inferred as polled
   listeners at create time (`kind: 'listener'` + `pollConfig` stamped server-side; the poll
   action comes from the platform config - `list_emails` - never the caller; cadence defaults
   to 60s, override with `pollIntervalMs`):

   ```
   curl -sS "$API/api/v1/triggers" \
     -H "Authorization: Bearer $OWNER_JWT" -H 'Content-Type: application/json' \
     -d '{"integrationKey":"microsoft-365","eventName":"email.received","target":{"kind":"artifact-backend","artifactId":"<prodAppId>","entrypoint":"onEmail"}}'
   ```

   Verify `GET /api/v1/triggers` shows the row with `kind: "listener"` and
   `pollConfig.actionName: "list_emails"`. The supervisor reconciles every 30s - no restart
   needed. ARM THIS BEFORE ANNOUNCING THE SWITCH (see the email-loss window, step 5).
4. **Pre-bank the owner consent approvals.** Deliberate divergence from upstream (dev-parity row
   `1d4eaf64`): the old platform dispatched sends with a synthesised admin actor and no write
   gate; here every app-plane send goes through `callPlatformIntegration` with the OWNER as
   `actingUserId`, so the C2 consent gate binds and an unapproved send is refused with
   `awaiting_consent` and zero provider traffic. Without this step the ERP's first
   post-migration email send stops dead. As the OWNER (the approval routes are `auth: 'user'` -
   deliberately not key-reachable), either approve the send actions in the dashboard's
   Integrações panel, or via API: read
   `GET /api/v1/integrations/microsoft-365/action-approvals`, then for each send action the ERP
   exercises (`send_email` at minimum; `create_draft` + `send_draft` if the draft flow is used)
   POST the approval echoing the `shape` from the read:

   ```
   curl -sS "$API/api/v1/integrations/microsoft-365/actions/send_email/approval" \
     -H "Authorization: Bearer $OWNER_JWT" -H 'Content-Type: application/json' \
     -d '{"decision":"always","shape":"<shape from the action-approvals read>"}'
   ```

   `decision` MUST be `always` - a `once` approval is claimed by the first send and the gate
   closes again. Diary note: `always` approvals expire after 90 days
   (`ACTION_APPROVAL_TTL_DAYS`); calendar the re-approval or sends start refusing again.

### 4. External re-pointing

- **Zoho Sign webhook = manual console state.** The advance-on-sign webhook only fires if the
  salomao workspace's Zoho account has a webhook configured - account-level state in the Zoho
  console, not in any repo or env (ekoa-dev `cortex/src/services/zoho-sign.ts`, the
  `handleZohoWebhook` NOTE). ekoa-code mounts the SAME paths (`/api/zoho-sign/webhook`,
  `/api/zoho-sign/return`), so if the serving origin stays `api.ekoa.io` nothing changes. If the
  origin moves: update the console webhook URL AND keep the old origin 302-ing
  `/api/zoho-sign/return` to the new one until every in-flight agreement drains -
  `redirect_pages` are FROZEN into each request at send time (`sign_success` / `sign_completed` /
  `sign_later` all point at the send-time origin's `/api/zoho-sign/return?to=...`), so an
  agreement sent before the move bounces signers through the OLD origin forever.
- **Adobe.** Nothing to re-point: replaced by Zoho in ERP V13, refused by the state converter,
  fail-closed facade here. Re-confirm the step-1.6 zero-pending check at the moment of cutover.

### 5. Caveats - state these plainly in the cutover notice

- **Email-loss window.** The listener cursor initialises to NOW on the first poll - no backfill
  (first-poll semantics in `events/listener-state.ts`). Mail arriving between the old platform's
  last poll and the new trigger's first tick is processed by NEITHER stack. Arm the trigger
  (step 3.3) and verify a first tick BEFORE announcing the switch; the residual window is then at
  most one poll interval (default 60s) plus the DNS/origin switch gap. Say the window exists.
- **M365 scope drift - expected, not a blocker.** ekoa-code requests `User.Read` (needed for
  Graph `/me`, the connected-check probe); the prod consent never included it. A carried refresh
  token can therefore 403 on `/me` (`Authorization_RequestDenied`) - the integration READS as
  broken - while mail, files and SharePoint all work. Fix is one interactive re-consent (re-run
  the managed Microsoft connect) at any convenient moment.
- **Env renames.** Old `EKOA_OAUTH_REDIRECT_BASE_URL` -> new `OAUTH_REDIRECT_BASE_URL`; old
  `ZOHO_OAUTH_DC` -> new `ZOHO_DC`. A prod `.env` carried verbatim silently loses both (the old
  names are never read here). `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` keep their names - and the
  carried Zoho credential bundles deliberately omit the client pair, so the target env's pair
  backs their refreshes.
- **ERP end-user sessions do not carry.** App SSO tokens expire in 8h and are not migrated;
  users simply SSO again against the same `MICROSOFT_SSO_CLIENT_ID` app. Expectation-setting
  only, no action.
- **Shared-scope app-data (`usr.<ownerUserId>`).** Only relevant if the manifest declares
  `sharedData: true` - check with
  `jq -r '.files[] | select(.path=="manifest.json").content' bundle.json | jq '.sharedData'`.
  The ERP historically does NOT opt in (expect `null`/absent). If it ever reads `true`, the
  shared dataset is a SEPARATE appId in the app-data plane: export it as its own dump
  (step 1.3 with `"appId": "usr.<ownerUserId>"`) and import it as its own step - the artifact
  import only carries the per-app dataset.

### 6. Post-cutover verification checklist

Run through in order; every line must pass before retiring the old origin.

1. **App serves.** `GET <origin>/apps/legal-case-manager-3` returns the ERP shell (slug
   preserved), and the same app resolves by canonical id.
2. **File blobs load.** Pick a file id referenced from an imported record (a `documentos`-style
   collection row): `GET <origin>/api/app-files/<prodAppId>/<fileId>` serves the bytes with the
   right `Content-Length` - proving blobs, sidecars AND the preserved-id URL keying.
3. **Listener polls.** Boot log shows `[listener-supervisor] started N listener(s)`; the
   `listener_state` row for the trigger (`_id` = triggerId) shows `lastPollAt` advancing and
   `consecutiveFailures: 0`, with no `cursor did not advance` warnings. Send a test mail to the
   watched mailbox from an operator-owned account and watch the ERP's `onEmail` flow process it.
4. **Signature round-trip.** Send a test proposta for signature to an operator-owned signer
   (never a real client), sign it, and confirm the stage advances to `Assinada` via the webhook
   WITHOUT the portal being open - that proves the console webhook points at the serving origin.
5. **In-flight count matches.** The imported `zoho_agreements` rows equal the step-1.6 total, and
   the in-flight subset still resolves against the imported `propostas`.
6. **Approvals banked.** `GET /api/v1/integrations/microsoft-365/action-approvals` shows
   `decision: "always"` with a future `expiresAt` for every send action, and the first real
   email send completes with no `awaiting_consent` refusal.

### 7. Standing operator security note - the old origin is exploitable until patched

`docs/findings.md` `zoho-callback-page-script-injection`: the OLD platform has a live reflected
XSS on `https://api.ekoa.io/api/v1/oauth/zoho/callback?error=...` - an unauthenticated route that
embeds the Zoho-reflected error string via `JSON.stringify` inside an inline `<script>`, which
does not escape `</script>`. The same page builder serves the Adobe callback, so both providers
are affected. ekoa-code refused to inherit it (`jsonForScript()` escapes; pinned by
`api/tests/integrations/zoho-oauth.test.ts`). Every day the migration window keeps api.ekoa.io
serving the old stack keeps this exposed: either apply the four-line escape upstream
(`cortex/src/server.ts` `buildOAuthResultPage`) at the START of the window, or keep the window
short and retire the old origin fast. Do not let the cutover linger.

## Known flakes

- **colima/mongodb-memory-server hang** (`docs/known-flakes.md`, 2026-07-08): the api
  vitest suite hangs on a `mongodb-memory-server` test (worker at 0% CPU, `mongod` up but blocked)
  when `ci:lane` runs concurrently with a colima docker VM under heavy load. Not a code regression -
  the same suite passes when run alone. Workaround: do not run `ci:lane` concurrently with docker
  image builds or colima; stop colima before the final lane.
- **legal served-app e2e specs** flake under heavy machine load at the tail of the 127-spec suite
  (different spec/assertion each run; the web e2e suite is unchanged since gate-7b). Environmental,
  not a regression. If it recurs on a quiescent machine, raise the tight per-assertion timeouts on
  the tail legal specs or shard the legal journey.
