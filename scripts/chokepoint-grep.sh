#!/usr/bin/env bash
# Chokepoint grep gate (ch02 §2.9 rule 2, FIXED-13). Belt-and-braces beyond the ESLint
# import ban: fail the build if `api.anthropic.com` or `@anthropic-ai/` appears in any
# file outside api/src/llm/ (catches raw fetch calls the import rule cannot see).
#
# Scope: api/src is the primary target (where the SDK lives), plus web/src, shared/src and
# the TEST ESTATE (api/tests + the api/test fixture dir) so a raw provider reference cannot
# hide in the frontend, the contract, or the test harness (defense in depth beyond the
# api-only ESLint rule).
#
# D2 re-review LOW-3: this scanned `api/test` — a fixture directory holding only fake-daemon —
# while its own comment claimed it covered "the test harness". The real suite (`api/tests`,
# ~9 references across 7 files) was never scanned at all. Both paths are scanned now, and the
# pre-existing references were triaged rather than grandfathered wholesale (see EXEMPTIONS).
set -euo pipefail
cd "$(dirname "$0")/.."

# --- EXEMPTIONS -------------------------------------------------------------------------
# Two, both deliberately narrow, because an exemption mechanism is only as good as its blast
# radius.
#
# 1. PATH: api/tests/llm/ — the chokepoint MODULE'S OWN SUITE, mirroring the api/src/llm/
#    exemption one-for-one. It must name the SDK it mocks (`vi.mock('@anthropic-ai/...')`) and
#    the provider host it asserts about; a test that may not name the thing it isolates cannot
#    test the isolation. Exactly one module and its suite, nothing else.
#
# 2. LINE MARKER: `chokepoint-gate-allow` in a comment ON THE OFFENDING LINE. Granularity is one
#    line, and the justification has to sit next to it, so an exemption is visible in review and
#    `grep -rn chokepoint-gate-allow` enumerates every one. Today's holders are, without
#    exception, references that ENFORCE the rule rather than break it: anti-leak assertions that
#    the token is ABSENT (agents/branding, agents/chat-thinking, content/loader, apps/panel-lazy)
#    and the journey harness's opt-in `EKOA_LLM_DIRECT` posture, which sets the CHOKEPOINT's own
#    base URL (LLM_CHOKEPOINT_BASE_URL — the sanctioned external-chokepoint topology that
#    llm/credentials.ts implements), never a bypass around it. A NEW marker in product code is a
#    review failure, not a formality.
#
# Two passes. (1) the precise references; (2) a broad case-insensitive `anthropic` token
# that also catches split-string evasion (`'@anthropic-ai' + '/sdk'`, `'api.'+'anthropic.com'`)
# and any obfuscation that still leaves the substring `anthropic` in a source literal.
# Outside api/src/llm/ there is no legitimate reason for the word to appear at all.
hits=$(grep -rIERn --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.js' \
  'anthropic' api/src web/src shared/src api/test api/tests 2>/dev/null \
  | grep -iv '^api/src/llm/' \
  | grep -iv '^api/tests/llm/' \
  | grep -v 'chokepoint-gate-allow' || true)

if [ -n "$hits" ]; then
  echo "CHOKEPOINT GREP GATE FAILED — Anthropic reference outside api/src/llm/ (FIXED-13):"
  echo "$hits"
  exit 1
fi
echo "chokepoint grep gate: clean (no @anthropic-ai/ or api.anthropic.com outside api/src/llm/)"
