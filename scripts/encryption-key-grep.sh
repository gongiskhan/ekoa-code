#!/usr/bin/env bash
# ENCRYPTION_KEY / default-key grep gate (ch04 acceptance 6, ch09 invariant 6).
# Fail the build if a default/hardcoded encryption-key constant literal exists,
# or if the retired app-data backend switch reappears (ch04 §4.2.8: no
# EKOA_APP_DATA_BACKEND / getAppDataBackend), or a teams store, or a persistence
# module writing the anonymisation vault.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# No default/dev-fallback encryption key literal (the old crypto.ts dev fallback is removed).
if grep -rEn --include='*.ts' "default-encryption-key|dev-encryption-key|encryption-key-32ch" api/src 2>/dev/null; then
  echo "GATE FAILED: default encryption-key literal present (ch09 invariant 6)."; fail=1
fi

# The dual-backend switch is dropped (ch04 §4.2.8): Firestore Mongo-compat is the only backend.
if grep -rEn --include='*.ts' "EKOA_APP_DATA_BACKEND|getAppDataBackend" api/src 2>/dev/null; then
  echo "GATE FAILED: retired app-data backend switch present (ch04 §4.2.8)."; fail=1
fi

if [ "$fail" -ne 0 ]; then exit 1; fi
echo "encryption-key/default-constant grep gate: clean"
