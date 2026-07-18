# Staging deployment (`deploy/staging/`)

A single-VM, one-user staging environment for the ekoa-code platform. It runs the P-02
two-container topology (`api` + `web`) behind a **Caddy** edge that terminates HTTPS and proxies
both on **one origin** (`https://staging.ekoa.io`), plus a self-hosted **Mongo**. This is the
first *runnable* deployment of ekoa-code; the repo-root `deploy/` descriptors + `cutover.sh`
remain the dry-run cutover shape for the eventual founder-gated production switch.

```
Cloudflare DNS (staging.ekoa.io, DNS-only) -> VM :443/:80 -> caddy
   caddy  /api/*  /health  /hooks   -> api  :4111   (Dockerfile.api, + Chromium)
   caddy  everything else           -> web  :3000   (Dockerfile.web, Next standalone)
   api                              -> mongo :27017  (standalone; api uses no transactions)
   api  loopback 127.0.0.1:4111 (host)             -> one-time credential provision + debug
```

Same-origin is deliberate: the api ships **no CORS** and the dashboard CSP is `connect-src
'self'` (`web/lib/api/base-url.ts` documents the "same-origin (Caddy proxy)" contract). The web
image is built with `NEXT_PUBLIC_API_URL=https://staging.ekoa.io` so the browser calls the API on
the origin it was served from, and Caddy path-routes `/api` to the api container.

## Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | The four services (`caddy`, `web`, `api`, `mongo`) + named volumes. |
| `Caddyfile` | Auto-HTTPS + the same-origin path split. |
| `.env.example` | Every name the stack needs. Copy to `.env` on the VM and fill in. |
| `.env` | **Gitignored.** Real secrets, VM-only, mode 600. |
| `provision.sh` | Idempotent bring-up: Docker + swap + `compose up` + health gate + optional credential provision. |

## Prerequisites

- A GCP VM (`e2-standard-2`, Ubuntu 24.04) with SSH via Tailscale/IAP - see the plan/runbook.
- DNS: an `A` record `staging.ekoa.io` -> the VM's static IP, **DNS-only (grey cloud)** so Caddy's
  ACME challenge reaches the box directly. Ports 80 + 443 open to the internet (ACME needs them).
- The repo cloned on the VM (deploy key or `gh auth`), on the intended commit.

## Bring-up

```bash
cd ~/ekoa-code/deploy/staging
cp .env.example .env && chmod 600 .env
# fill .env: generate JWT_SECRET / ENCRYPTION_KEY / MONGO_PASSWORD with `openssl rand -hex 32`,
# set a real EKOA_ADMIN_PASSWORD. Do NOT reuse production secrets.

# Provide the model credential in THIS shell (goncalo@ekoa.io) so provision.sh arms it:
export ANTHROPIC_API_KEY=sk-ant-...          # or: export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat...

./provision.sh
```

`provision.sh` installs Docker if missing, adds a 4G swapfile (headroom for the on-box
`next build` / `tsc`), builds both images (the api build downloads Chromium - the first build is
slow), starts the stack, health-gates `api:/health` and `https://staging.ekoa.io/health`, then
arms the model credential if a key is in the environment.

## Model credential

Stored AES-encrypted in Mongo via `POST /api/v1/credentials` (super-admin only) - never an env
var, never baked into an image. Because staging Mongo is **persistent**, this is a **one-time**
step (unlike the dev harness, whose in-memory Mongo drops it every restart). `provision.sh`
auto-arms it from `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` in the environment; otherwise
provision it later with the same key exported and a re-run, or with Node if present:

```bash
EKOA_API_URL=http://127.0.0.1:4111 \
  EKOA_ADMIN_USERNAME=admin EKOA_ADMIN_PASSWORD='<from .env>' \
  ANTHROPIC_API_KEY=sk-ant-... node ../../.claude/skills/run-ekoa-code/provision-credential.mjs
```

Confirm: `curl -s https://staging.ekoa.io/health | jq '.claudeAuth'` -> `{ configured: true, ok: true }`.
`configured:true` only means a secret was stored - run a real chat turn to prove the provider
accepts it.

## Operate

```bash
docker compose ps                     # status
docker compose logs -f api            # api logs (chat/build/automation)
docker compose logs -f caddy          # edge / TLS issuance
docker compose pull && docker compose up -d   # (n/a - images build locally)
git pull && docker compose up -d --build      # deploy a new commit
docker compose down                   # stop (volumes persist)
docker compose down -v                # stop + WIPE data (mongo + api-data + certs)
```

## Teardown

Staging is disposable. `docker compose down -v` wipes local state; deleting the VM, its static
IP, the firewall rules, and the DNS record removes it entirely. Nothing here touches production.
