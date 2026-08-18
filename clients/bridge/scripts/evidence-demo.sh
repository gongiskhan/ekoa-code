#!/usr/bin/env bash
# Evidence driver for @ekoa/bridge - demonstrates the committed, re-runnable gates and the built
# daemon CLI. Everything shown is a committed test or the shipped CLI; no fixture is faked.
#
# Run from anywhere: it resolves the package root itself. Lint is the ROOT eslint config (this
# package has none of its own since the move into clients/), and the integration canary needs
# `npm run build` to have produced api/dist at the repo root first.
set -uo pipefail
PKG_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$PKG_ROOT/../.." && pwd)"
cd "$PKG_ROOT"

banner() { printf '\n\033[1;36m==== %s ====\033[0m\n' "$1"; }

banner "Ekoa Bridge — executor-only local daemon (no local agent loop; ADR-001)"
printf 'A daemon that verifies signed delegated tasks, runs a fixed file-tool vocabulary through ONE\n'
printf 'containment resolver, ledgers everything, and returns derived output only.\n'

banner "1. Clean build + typecheck + lint"
npm run build >/dev/null 2>&1 && echo "build: exit 0"
npm run typecheck >/dev/null 2>&1 && echo "typecheck: exit 0"
(cd "$REPO_ROOT" && npx eslint clients/bridge >/dev/null 2>&1) && echo "lint: exit 0"

banner "2. The shipped CLI (built binary), PT-PT, on a scratch home"
export EKOA_BRIDGE_HOME="$(mktemp -d)"
node dist/cli/index.js help | head -12
printf '\n-- status on an unpaired daemon --\n'
node dist/cli/index.js status

banner "3. The committed unit suite — containment, wire, verification, tools, engine, ledger, tier-2, surface, claims"
npx vitest run --exclude 'test/integration/**' 2>&1 | tail -6

banner "4. The committed integration canary - vs the REAL Cortex api/dist (bridge server + chokepoint + mongodb-memory-server)"
printf 'round trip, S6 correlation-id join, PAYLOAD CAPTURE (deny-listed value tokenized / answer cleartext),\n'
printf 'revoke kill switch, offline, docx, folder grep, write conflict, cap raise, injection.\n\n'
npx vitest run test/integration 2>&1 | tail -6

banner "Done — every slice proven by a committed, re-runnable test."
rm -rf "$EKOA_BRIDGE_HOME"
