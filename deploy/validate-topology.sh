#!/usr/bin/env bash
# Validate the deploy topology descriptors (ch14 §14.4 G13). Asserts the P-02 two-container
# shape is well-formed AND that no SECRET VALUES are present (FIXED-14 C3). Fails loudly on any
# violation. No deploy, no network - a pure static check.
#
# CUSTODY SCOPE (A-8, docs/decisions.md 2026-07-28). This gate governs exactly one of the two
# custody planes: SERVICE secrets, which live in GCP Secret Manager and reach the container by
# NAME. It says nothing about TENANT credential material - Cofre items are ciphertext in the
# database under a per-tenant DEK and never appear in a deploy descriptor at all, so there is
# nothing here to gate. Reading this gate as the repo's whole secret posture is what made the
# Cofre's "Secret Manager ruled out" decision look like a contradiction; it is not one.
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "[validate-topology] FAIL: $*" >&2; exit 1; }
ok()   { echo "[validate-topology] ok: $*"; }

command -v jq >/dev/null 2>&1 || fail "jq is required"

# 1. Both services present with the expected ports + health endpoints + Dockerfiles.
api_port=$(jq -r '.port' deploy/api.service.json)
web_port=$(jq -r '.port' deploy/web.service.json)
[ "$api_port" = "4111" ] || fail "api port expected 4111, got $api_port"
[ "$web_port" = "3000" ] || fail "web port expected 3000, got $web_port"
[ "$(jq -r '.health_endpoint' deploy/api.service.json)" = "/health" ] || fail "api health endpoint"
[ "$(jq -r '.health_endpoint' deploy/web.service.json)" = "/" ] || fail "web health endpoint"
[ -f "$(jq -r '.dockerfile' deploy/api.service.json)" ] || fail "api Dockerfile missing"
[ -f "$(jq -r '.dockerfile' deploy/web.service.json)" ] || fail "web Dockerfile missing"
ok "two-container topology: api :$api_port (/health) + web :$web_port (/) behind the reverse proxy (P-02)"

# 2. env_passthrough carries NAMES ONLY - never NAME=value (a leaked secret value).
for f in deploy/api.service.json deploy/web.service.json; do
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    case "$name" in
      *=*) fail "$f env entry '$name' looks like a NAME=value (secret value must not be committed)" ;;
      *[a-z]*[A-Z]*|*' '*) : ;; # names are UPPER_SNAKE; a value with lowercase/space is suspicious but we only hard-fail on '='
    esac
  done < <(jq -r '.env_passthrough[]?' "$f")
done
ok "env_passthrough is NAMES ONLY (no secret values); values come from Secret Manager (FIXED-14 C3)"

# 2b. The boot-mandatory service secrets are actually PASSED THROUGH. `config.ts` refuses to boot
# without JWT_SECRET or ENCRYPTION_KEY, and ENCRYPTION_KEY is additionally the root of the Cofre's
# key-wrapping seam (data/kms.ts) while LocalKeyWrapper is installed - dropping either name from
# the descriptor deploys a container that cannot start, which is a static mistake worth catching
# statically rather than at rollout.
for required in JWT_SECRET ENCRYPTION_KEY; do
  jq -e --arg n "$required" '.env_passthrough | index($n)' deploy/api.service.json >/dev/null \
    || fail "deploy/api.service.json env_passthrough is missing '$required' (config.ts refuses to boot without it)"
done
ok "boot-mandatory service secrets (JWT_SECRET, ENCRYPTION_KEY) are passed through by name"

# 3. The obsolete ekoa-deploy lanes (site, stt, tts) are NOT carried (ch10 §10.6.1/§10.8).
for obsolete in site stt tts; do
  [ -f "deploy/$obsolete.service.json" ] && fail "obsolete lane '$obsolete' must not be carried"
done
ok "obsolete lanes (site/stt/tts) absent"

# 4. No stray secret-shaped literals anywhere under deploy/ (defence in depth).
if grep -RInE '(SECRET|PASSWORD|PRIVATE_KEY|API_KEY)\s*[:=]\s*["'\''0-9A-Za-z/+._-]{12,}' deploy/ 2>/dev/null | grep -v '\.sh:'; then
  fail "a secret-shaped literal was found under deploy/ - move it to Secret Manager (service secrets) or the Cofre (tenant credentials)"
fi
ok "no secret-shaped literals under deploy/"

echo "[validate-topology] OK - P-02 topology well-formed, no secret values"
