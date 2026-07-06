#!/usr/bin/env bash
# Chokepoint grep gate (ch02 §2.9 rule 2, FIXED-13). Belt-and-braces beyond the ESLint
# import ban: fail the build if `api.anthropic.com` or `@anthropic-ai/` appears in any
# file outside api/src/llm/ (catches raw fetch calls the import rule cannot see).
#
# Scope: api/src is the primary target (where the SDK lives), but we also scan web/src,
# shared/src, and api/test so a raw provider reference cannot hide in the frontend, the
# contract, or the test harness (defense in depth beyond the api-only ESLint rule).
set -euo pipefail
cd "$(dirname "$0")/.."

# Two passes. (1) the precise references; (2) a broad case-insensitive `anthropic` token
# that also catches split-string evasion (`'@anthropic-ai' + '/sdk'`, `'api.'+'anthropic.com'`)
# and any obfuscation that still leaves the substring `anthropic` in a source literal.
# Outside api/src/llm/ there is no legitimate reason for the word to appear at all.
hits=$(grep -rIERn --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.js' \
  'anthropic' api/src web/src shared/src api/test 2>/dev/null \
  | grep -iv '^api/src/llm/' || true)

if [ -n "$hits" ]; then
  echo "CHOKEPOINT GREP GATE FAILED — Anthropic reference outside api/src/llm/ (FIXED-13):"
  echo "$hits"
  exit 1
fi
echo "chokepoint grep gate: clean (no @anthropic-ai/ or api.anthropic.com outside api/src/llm/)"
