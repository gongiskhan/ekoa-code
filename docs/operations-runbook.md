# Operations runbook

How to run, test, deploy-check, and reason about the state of ekoa-code. Written for the solo
operator and any future agent session. Paths are relative to the repo root.

## Run

Bring the full stack up with the committed driver, not by hand:

```
node .claude/skills/run-ekoa-code/driver.mjs up            # boot api+proxy+web, stay alive, print a READY line
node .claude/skills/run-ekoa-code/driver.mjs smoke /chat   # boot, real-UI login, screenshot routes, tear down
```

Ports and login (all overridable by env, defaults shown): the real Express API runs on an
**internal** `:4211` (`EKOA_API_PORT`); a zero-dependency CORS reverse proxy occupies `:4111`
(read from the `backend.port` file - the port the web bundle and node drivers already resolve to)
and forwards to `:4211`; Next.js dev runs on `:3000` (`EKOA_WEB_PORT`). Login is `admin` /
`tmp12345` (`EKOA_ADMIN_USERNAME` / `EKOA_ADMIN_PASSWORD`). `EKOA_API_MODE` is `built` by default
(serves `api/dist/server.js`, so run `npm run build` first) or `dev` (ts-node, no build needed).

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
(`scripts/chokepoint-grep.sh` - fails the build if `anthropic` appears in any source outside
`api/src/llm/`, catching raw fetches the import rule cannot see); `gate:encryption-key` and
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

## Secrets and env

**Model credential posture (read this before wondering why chat/build errors on a fresh boot).** The
provider credential is a single AES-encrypted document in the `credentials` Mongo collection
(`_id: 'default'`), set **only** through the in-process `setCredential` seam in
`api/src/llm/credentials.ts`. There is no env var, no HTTP route, and no migration that seeds it. A
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
- `LLM_OAUTH_REFRESH_URL` - OAuth token-refresh endpoint; unset means oauth refresh fails closed
  (latches the `claudeAuth` alert), the correct posture until configured.
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
- `API_PUBLIC_URL` - public origin used to build absolute trigger/webhook URLs, default empty.
- OAuth provider creds for integrations: `MICROSOFT_*`, `MICROSOFT_SSO_*`, `GOOGLE_CLIENT_*`,
  `ADOBE_*` (see `deploy/api.service.json` `env_passthrough` for the deploy-time list).

## Model credential re-provisioning

The provider credential is the AES-encrypted `credentials/default` document in Mongo. Dev Mongo is
`mongodb-memory-server`, created fresh and discarded on every boot, so the credential does not survive
a restart - re-provision it after every `driver.mjs up` (and after any `api/` rebuild + restart):

```
export CLAUDE_CODE_OAUTH_TOKEN=$(claude setup-token)   # or an ANTHROPIC_API_KEY for api-key mode
node .claude/skills/run-ekoa-code/provision-credential.mjs
```

This writes the credential through the in-process `setCredential` seam - there is no HTTP route or env
var that seeds it (invariant 4). Confirm with `GET /health`: `claudeAuth.ok=true`,
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
