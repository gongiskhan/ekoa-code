#!/usr/bin/env bash
# Chokepoint grep gate (ch02 §2.9 rule 2, FIXED-13). Belt-and-braces beyond the ESLint
# import ban: fail the build if `api.anthropic.com` or `@anthropic-ai/` appears in any
# file outside api/src/llm/ (catches raw fetch calls the import rule cannot see).
#
# HISTORY OF ITS OWN BLIND SPOTS (each closed below, each pinned by a case in
# api/tests/security/grep-gates.test.ts that runs THIS script against a planted violation):
#   - it scanned `api/test` (a fixture dir holding only fake-daemon) while claiming to cover the
#     test harness; the real suite `api/tests` was unscanned (D2 re-review LOW-3).
#   - it scanned `web/src`, WHICH DOES NOT EXIST, while claiming a provider reference "cannot hide
#     in the frontend"; the whole frontend, scripts/ and the shipped clients/ CLI were unscanned.
#     Root cause, closed permanently: a non-existent root used to be silently clean. A declared
#     root that is not a directory now FAILS the gate (see ROOT EXISTENCE below).
#   - its allow-marker was filtered over the whole `path:line:content` output line, so a DIRECTORY
#     or FILE named `chokepoint-gate-allow` exempted an unbounded subtree. The marker is now
#     matched against the CONTENT ONLY (see EXEMPTIONS).
#   - it was case-SENSITIVE while its comment claimed case-insensitive, so `api.Anthropic.com`
#     (DNS is case-insensitive, so that URL resolves and works) and `@ANTHROPIC-ai/sdk` passed.
#     Pass 1 is case-insensitive now, and the path exemptions are case-SENSITIVE (they used to be
#     `-iv`, which put the case-insensitivity on the wrong side of the fence: `api/tests/LLM/`
#     inherited the exemption while `api.Anthropic.com` escaped the needle).
set -euo pipefail
cd "$(dirname "$0")/.."

# --- ROOTS ------------------------------------------------------------------------------
# Every FIRST-PARTY source root in the repo. api/src is the primary target (where the SDK lives),
# but a raw `fetch` needs no import, so the frontend, the shipped CLI workspace (clients/), the
# operator scripts and the served runtime bundles (api/assets) are all in scope.
# Deliberately NOT scanned: node_modules / dist / .next (build + third-party output, pruned below),
# and web/public (vendored Monaco + binary voice assets, not first-party source).
ROOTS=(
  api/src api/test api/tests api/scripts api/assets
  shared/src
  web/app web/components web/hooks web/lib web/locales web/stores web/types web/e2e web/__tests__ web/scripts
  scripts
  clients
)

# --- ROOT EXISTENCE ---------------------------------------------------------------------
# A root that is not there is a blind spot the gate reports as CLEAN — which is exactly how
# `web/src` hid the entire frontend. Fail loudly instead, so a rename can never silently blind it.
missing=''
for r in "${ROOTS[@]}"; do
  [ -d "$r" ] || missing="$missing $r"
done
if [ -n "$missing" ]; then
  echo "CHOKEPOINT GREP GATE FAILED — declared scan root(s) do not exist:$missing"
  echo "A root that is not a directory is scanned as empty, i.e. reported clean. Fix the path or"
  echo "remove the root from ROOTS in scripts/chokepoint-grep.sh — do not leave it dangling."
  exit 1
fi

GREP_FLAGS=(
  -rIEn
  --include='*.ts' --include='*.tsx' --include='*.jsx'
  --include='*.js' --include='*.mjs' --include='*.cjs'
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.next --exclude-dir=coverage
)

# --- EXEMPTIONS -------------------------------------------------------------------------
# Two, both deliberately narrow, because an exemption mechanism is only as good as its blast
# radius.
#
# 1. PATH: api/src/llm/ (the chokepoint module) and api/tests/llm/ — the module's OWN SUITE,
#    mirroring the module exemption one-for-one. It must name the SDK it mocks
#    (`vi.mock('@anthropic-ai/...')`) and the provider host it asserts about; a test that may not
#    name the thing it isolates cannot test the isolation. Exactly one module and its suite.
#    Matched CASE-SENSITIVELY and anchored at the start of the path: `api/tests/LLM/` is NOT this
#    suite and inherits nothing.
#
# 2. LINE MARKER: `chokepoint-gate-allow` in a comment ON THE OFFENDING LINE. Granularity is one
#    line, and the justification has to sit next to it, so an exemption is visible in review and
#    `grep -rn chokepoint-gate-allow` over CONTENT enumerates every one. Today's holders are,
#    without exception, either assertions that ENFORCE the rule — anti-leak checks that the token
#    is ABSENT (api/tests: agents/branding, agents/chat-thinking, content/loader, apps/panel-lazy;
#    web: lib/sanitize-error's leak denylist, e2e/chat-thinking, __tests__/sanitize-error,
#    __tests__/components/thinking-block) — or the journey harness's opt-in EKOA_LLM_DIRECT dev
#    posture, which DOES bypass the chokepoint and says so on the line (see boot-b.mjs and
#    docs/findings.md). A NEW marker in product code is a review failure, not a formality.
#
# The marker is matched against the MATCHED TEXT ONLY. The path is stripped first (awk, below),
# so it cannot be smuggled into a directory or file NAME to exempt a whole subtree — which also
# keeps `grep -rn chokepoint-gate-allow` over content a COMPLETE enumeration of every exemption.
filter_exempt() {
  awk '
    {
      # grep -n emits path:lineno:content. Split on the first two colons only; content may hold ":".
      p = index($0, ":");
      if (p == 0) { print; next }                       # unexpected shape -> fail closed, report it
      path = substr($0, 1, p - 1);
      rest = substr($0, p + 1);
      q = index(rest, ":");
      if (q == 0) { print; next }                       # ditto
      lineno = substr(rest, 1, q - 1);
      content = substr(rest, q + 1);
      if (lineno !~ /^[0-9]+$/) { print; next }         # ditto
      if (path ~ /^api\/src\/llm\//) next;              # exemption 1 (case-sensitive, anchored)
      if (path ~ /^api\/tests\/llm\//) next;            # exemption 1
      if (index(content, "chokepoint-gate-allow") > 0) next;  # exemption 2, CONTENT only
      print;
    }'
}

# --- PASS 1: the banned references, CASE-INSENSITIVE -------------------------------------
# The literal CLAUDE.md rule: `@anthropic-ai/` (the package scope) and the provider host. Matched
# case-insensitively because both are case-insensitive in the wild — DNS resolves api.ANTHROPIC.com,
# and a mixed-case import specifier still resolves on a case-insensitive filesystem. This pass runs
# over every root, and the tree is clean under it today apart from the three markered lines.
banned=$(grep "${GREP_FLAGS[@]}" -i -e '@anthropic-ai' -e 'anthropic\.com' "${ROOTS[@]}" 2>/dev/null | filter_exempt || true)

# --- PASS 2: the broad anti-evasion token, LOWERCASE -------------------------------------
# A bare lowercase `anthropic` anywhere in the roots. Catches split-string evasion that pass 1
# cannot see (`'@anthropic-ai' + '/sdk'`, `'api.' + 'anthropic.com'`) and any obfuscation that
# still leaves the lowercase substring in a source literal.
#
# WHY THIS PASS IS CASE-SENSITIVE (and pass 1 is not): the word legitimately appears ~40 times
# outside api/src/llm/ in two shapes that are not egress and cannot be removed —
#   - `Anthropic`, the capitalised proper noun, in doc comments and UI copy ("Anthropic-compatible
#     clients"), including files this gate has no business rewriting (shared/, server.ts, locales);
#   - `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`, the SCREAMING_SNAKE env
#     identifiers — `ANTHROPIC_BASE_URL` is the very mechanism CLAUDE.md MANDATES for pointing
#     subprocesses AT the chokepoint, so banning it would ban the fix.
# Making this pass case-insensitive would mean ~40 line markers, which would turn the marker into
# furniture and destroy the property that `grep -rn chokepoint-gate-allow` is a short, readable
# enumeration of real exemptions. Case-insensitivity belongs on pass 1, where the needle IS the
# banned string: every cased spelling of `@anthropic-ai` / `anthropic.com` fails, split or not.
# KNOWN RESIDUAL (accepted, recorded in docs/findings.md): a literal that is BOTH split AND
# mixed-case (`'api.' + 'Anthropic' + '.com'`) evades both passes. So does charcode obfuscation,
# which no grep gate can see; the ESLint import ban and code review are the other layers.
token=$(grep "${GREP_FLAGS[@]}" -e 'anthropic' "${ROOTS[@]}" 2>/dev/null | filter_exempt || true)

# Pass 1 hits are a subset of pass 2's when they are lowercase; report each line once.
extra="$token"
if [ -n "$banned" ] && [ -n "$token" ]; then
  extra=$(printf '%s\n' "$token" | grep -vxF -e "$banned" || true)
fi

if [ -n "$banned" ] || [ -n "$extra" ]; then
  echo "CHOKEPOINT GREP GATE FAILED — Anthropic reference outside api/src/llm/ (FIXED-13):"
  if [ -n "$banned" ]; then
    echo "  banned reference (@anthropic-ai / anthropic.com, any case):"
    printf '%s\n' "$banned"
  fi
  if [ -n "$extra" ]; then
    echo "  broad 'anthropic' token (split-string / obfuscation net):"
    printf '%s\n' "$extra"
  fi
  exit 1
fi
echo "chokepoint grep gate: clean (no @anthropic-ai/ or api.anthropic.com outside api/src/llm/)"
