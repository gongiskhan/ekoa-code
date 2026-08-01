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
- The source on the VM at the intended commit. It is NOT a git clone in practice (see Deploy
  below) - `~/ekoa-code` on the box has no `.git`, so anything documented as `git pull` will not
  work there.

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
# see "Deploy a new commit" below - `git pull` does NOT work: the VM tree has no .git
docker compose down                   # stop (volumes persist)
docker compose down -v                # stop + WIPE data (mongo + api-data + certs)
```

## Teardown

Staging is disposable. `docker compose down -v` wipes local state; deleting the VM, its static
IP, the firewall rules, and the DNS record removes it entirely. Nothing here touches production.

## Deploy a new commit

`~/ekoa-code` on the VM is an extracted tree, **not a clone** - it has no `.git`, so the older
`git pull && docker compose up -d --build` in this file could never work there. Ship a pushed
commit as an archive instead. This is deliberate and worth keeping: `git archive` uploads exactly
the committed tree, with no local scratch, no `node_modules`, and no repo credentials on a
public-facing box.

```bash
# on your machine, from a clean checkout of the pushed commit
git archive --format=tar <sha> | gzip > /tmp/ekoa-<sha>.tgz
gcloud compute scp /tmp/ekoa-<sha>.tgz ekoa-staging:~/ --zone europe-west4-a --tunnel-through-iap

# on the VM
TS=$(date -u +%Y%m%dT%H%M%SZ)
cp ~/ekoa-code/deploy/staging/.env ~/.env.staging.backup.$TS && chmod 600 ~/.env.staging.backup.$TS
sudo docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep ekoa-staging > ~/images.before.$TS.txt
mkdir ~/ekoa-code.new && tar xzf ~/ekoa-<sha>.tgz -C ~/ekoa-code.new
cp ~/.env.staging.backup.$TS ~/ekoa-code.new/deploy/staging/.env && chmod 600 ~/ekoa-code.new/deploy/staging/.env
mv ~/ekoa-code ~/ekoa-code.prev.$TS && mv ~/ekoa-code.new ~/ekoa-code
cd ~/ekoa-code/deploy/staging && sudo docker compose up -d --build
```

**`.env` is gitignored, so it is NOT in the archive** - copy it across before the swap or the stack
comes up with no secrets. Back it up outside the tree first; the swap moves the directory it lives in.

**A failed build leaves staging UP.** `docker compose up -d --build` builds before it recreates, so
a build error keeps the running containers serving the previous image. That is the safety property
that makes this worth doing in place; do not "helpfully" `down` first.

Verify the NEW code is live rather than trusting `/health` (which the OLD containers answer just as
happily):

```bash
sudo docker ps --format '{{.Names}}\t{{.Status}}'          # api + web recently recreated
curl -s -o /dev/null -w '%{http_code}\n' https://staging.ekoa.io/api/v1/memvault/notes  # 401 = mounted
```

A route that only exists in the new build answering **401** (auth required) rather than **404**
(unmounted) is the cheap proof. Roll back by swapping `~/ekoa-code.prev.$TS` back and rebuilding;
the previous image IDs are in `~/images.before.$TS.txt`.
