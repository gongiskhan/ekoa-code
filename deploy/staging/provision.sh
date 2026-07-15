#!/usr/bin/env bash
# Idempotent staging bring-up, run ON THE VM from the repo's deploy/staging/ directory:
#
#     cd ~/ekoa-code/deploy/staging && ./provision.sh
#
# It installs Docker (if absent), adds swap (build memory headroom), then builds and starts the
# staging stack from deploy/staging/docker-compose.yml. It does NOT provision the model
# credential - that is a one-time manual step after the stack is healthy (see README.md).
set -euo pipefail
cd "$(dirname "$0")"

log() { printf '\n[provision] %s\n' "$*"; }
die() { printf '\n[provision] ERROR: %s\n' "$*" >&2; exit 1; }

# --- 0. Preconditions --------------------------------------------------------------------------
[ -f ./.env ] || die "deploy/staging/.env not found. Copy .env.example to .env and fill it in (mode 600)."
# Fail early if the placeholders were left in place.
if grep -qE 'FILL_ME' ./.env; then
  die ".env still contains FILL_ME placeholders - fill in real secrets first."
fi

# --- 1. Docker + compose plugin ----------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker Engine + compose plugin (needs sudo)"
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
  log "added $USER to the docker group - you may need to re-login for non-sudo docker. Using sudo for this run."
fi

# Resolve how to call docker (group membership may not be active in this shell yet).
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
fi
$DOCKER compose version >/dev/null 2>&1 || die "docker compose plugin not available"

# --- 2. Swap (guards on-box next build / tsc memory spikes on an 8 GB box) ----------------------
if [ "$(swapon --show | wc -l)" -eq 0 ] && [ ! -f /swapfile ]; then
  log "creating a 4G swapfile (build headroom)"
  sudo fallocate -l 4G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=4096
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# --- 3. Build + start --------------------------------------------------------------------------
log "building images (api includes a Chromium layer - first build is slow)"
$DOCKER compose build
log "starting the stack"
$DOCKER compose up -d

# --- 4. Health gate ----------------------------------------------------------------------------
envval() { grep -E "^$1=" ./.env | head -1 | cut -d= -f2-; }
PUBLIC_ORIGIN="$(envval PUBLIC_ORIGIN)"; PUBLIC_ORIGIN="${PUBLIC_ORIGIN:-https://staging.ekoa.io}"
API_LOOPBACK="http://127.0.0.1:4111"   # the loopback-only publish from docker-compose.yml

log "waiting for the api /health on ${API_LOOPBACK}"
ok=0
for i in $(seq 1 60); do
  if curl -fsS "${API_LOOPBACK}/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 3
done
[ "$ok" -eq 1 ] || { log "api /health did not come up - recent logs:"; $DOCKER compose logs --tail=80 api; die "api unhealthy"; }
log "api healthy."

log "waiting for Caddy to obtain the TLS cert + serve ${PUBLIC_ORIGIN}/health"
for i in $(seq 1 40); do
  code="$(curl -sS -o /dev/null -w '%{http_code}' "${PUBLIC_ORIGIN}/health" 2>/dev/null || true)"
  [ "$code" = "200" ] && { log "edge serving HTTPS - ${PUBLIC_ORIGIN}/health = 200"; break; }
  sleep 3
done

# --- 5. Model credential (one-time; optional auto-provision) ------------------------------------
# The provider credential is stored AES-encrypted in Mongo via POST /api/v1/credentials (super-admin
# only). Staging Mongo is persistent, so this is a ONE-TIME step. Auto-provision here only if a
# secret is present in THIS shell's environment (never written to a file, never an argv):
#     export ANTHROPIC_API_KEY=sk-ant-...     # or: export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat...
CRED_MODE=""; CRED_SECRET=""
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then CRED_MODE="oauth"; CRED_SECRET="$CLAUDE_CODE_OAUTH_TOKEN"; fi
if [ -z "$CRED_MODE" ] && [ -n "${ANTHROPIC_API_KEY:-}" ]; then CRED_MODE="api-key"; CRED_SECRET="$ANTHROPIC_API_KEY"; fi

if [ -n "$CRED_MODE" ]; then
  log "provisioning the model credential (mode=${CRED_MODE})"
  ADMIN_USER="$(envval EKOA_ADMIN_USERNAME)"; ADMIN_USER="${ADMIN_USER:-admin}"
  ADMIN_PASS="$(envval EKOA_ADMIN_PASSWORD)"
  TOKEN="$(curl -fsS -X POST "${API_LOOPBACK}/api/v1/auth/login" -H 'content-type: application/json' \
    --data "$(printf '{"username":%s,"password":%s}' "$(printf '%s' "$ADMIN_USER" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" "$(printf '%s' "$ADMIN_PASS" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin).get("token",""))')"
  [ -n "$TOKEN" ] || die "admin login failed - check EKOA_ADMIN_USERNAME/PASSWORD in .env"
  CODE="$(curl -sS -o /tmp/cred.out -w '%{http_code}' -X POST "${API_LOOPBACK}/api/v1/credentials" \
    -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
    --data "$(printf '{"mode":"%s","secret":%s}' "$CRED_MODE" "$(printf '%s' "$CRED_SECRET" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')")")"
  [ "$CODE" = "200" ] || [ "$CODE" = "201" ] || { cat /tmp/cred.out; rm -f /tmp/cred.out; die "credential rejected (HTTP $CODE)"; }
  rm -f /tmp/cred.out
  CONF="$(curl -fsS "${API_LOOPBACK}/health" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("claudeAuth",{}))' 2>/dev/null || true)"
  log "credential accepted; /health claudeAuth=${CONF}"
else
  cat <<NEXT

[provision] Stack is up but NO model credential was provisioned (no key in the environment).
Run this ONE-TIME step with a goncalo@ekoa.io Anthropic key:

  export ANTHROPIC_API_KEY=sk-ant-...          # or: export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat...
  ./provision.sh                               # re-run - it will auto-provision and is idempotent

Then confirm: curl -s ${PUBLIC_ORIGIN}/health | jq '.claudeAuth'   ->   { configured: true, ok: true }
NEXT
fi

log "done. Dashboard: ${PUBLIC_ORIGIN}  (login: admin / the EKOA_ADMIN_PASSWORD you set)"
