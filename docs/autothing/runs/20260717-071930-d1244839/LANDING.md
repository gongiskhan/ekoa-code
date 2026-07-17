# LANDING - Cortex Gateway, Claude Code v1 (run 20260717-071930-d1244839)

**Verdict: passed** (build profile, 7 slices, all gated green; 2 final-phase security passes ended issues-fixed). Landed directly on `main` (operator's main-only rule), commits `257a115..HEAD`, ~30 commits, tags `autothing/20260717-s1..s7` + `-secfix`.

## What shipped
A stock Claude Code client pointed at Cortex via `ANTHROPIC_BASE_URL` + a per-user gateway key now works end-to-end, metered on the key owner. Proven LIVE with a real `claude` CLI (S6).

| # | Slice | What landed |
|---|-------|-------------|
| S1 | Heartbeat-and-replay | `stream:true` gets an immediate SSE 200 + `event: ping` frames while the buffered upstream runs, then the verbatim detokenized body; post-commitment failures are in-stream `error` events; non-stream byte-identical. |
| S2 | Model family mapping | `opus*/sonnet*/haiku*` (token-boundary, case/dated/`[1m]`-tolerant) -> EXPERT/WORKHORSE/FAST; thinking travels on any match; `/models` lists all three tiers. |
| S3 | count_tokens | `POST /v1/messages/count_tokens` (+alias) forwarded, anonymised, never billed/capped/allowance-gated; plus the live 50 MB gateway body limit (the S1-review dead-code fix). |
| S4a | Per-user gateway keys (api) | `ekoa_gk_`+32B, sha256-at-rest (store id), mint/list/revoke self-service, owner-billed `gateway-client`, per-key rate-cap window, fail-closed admission, Registo rows. |
| S4b | Keys settings UI | `/settings/api-keys`: show-once mint + client-config snippet, list, revoke; platform Table/Badge/useConfirm; PT/EN; Playwright spec. |
| S7 | Stable gateway-session vault | Fixes deny-list token instability across Claude Code's tool loop: vault keyed `gwkey:<keyId>` (stock client) / `csid:<org>:<conv>` (trusted bridge only) / `csid:<org>:usr:<billee>:<id>` (direct client, isolated) / `eph`. |
| S6 | Live proof + inventory | Committed health-gated driver proving mint + empty-ruleset byte-identical round trip + heartbeat + count_tokens + owner attribution against a real CLI; ancillary-surface inventory. |

S5 (model-field honesty) shipped as pass-through per the brief's own criterion (credential-mode owner check unresolved).

## Gates (all green / issues-fixed)
- typecheck 0 · lint 0 · chokepoint/encryption/garrison grep gates clean · api lane 190 files/1720 tests · web 172 · build 0 · securityWall clean (changed source).
- deliberate-red: proven (chokepoint + gitleaks seen red). mutation: ran-scoped on rate-caps.ts (67.5% covered; survivors are env-var-name strings + log text).
- Per-slice: every slice got a fresh-context review **approve** + a cross-model Codex pass **approve**; S4b also got a fresh independent Playwright test pass + a 3-round design audit -> clean. Every slice has verified evidence (asciinema/video, sha256 in evidence-index).
- Final phase: built-in-style security review -> **issues-fixed** (found + fixed the pre-auth 50 MB DoS; reclassed the anon-fidelity finding); cross-model Codex checkpoint (3 scopes) -> **issues-fixed** (found + fixed the `/classify` pre-auth instance the review's fix missed, and the count_tokens keyId inconsistency; contract/egress clean). The two decorrelated passes each caught what the other missed.

## The dual review earned its keep (every real finding shipped with a regression pin)
- S2: Codex - substring family match let `opusculum-1` bypass the clamp -> token-boundary.
- S3: Codex - overbroad parser exemption + arbitrary-4xx error shaping.
- S4a: BOTH reviewers - `/classify` metered owner spend without admission -> allowance + per-key gate.
- S4b: fresh review - bare clipboard on the one-irreversible show-once secret (silent fail on http/Tailscale) -> guarded helper; design audit's measured geometry drove the platform-primitive adoption.
- **S7: SIX distinct HIGHs** (fresh: bridge vault split, same-org cross-user re-identification; codex: crafted-session vault hijack, count_tokens sibling, cross-user split) - all closed + independently re-verified. The most-scrutinised change of the run.
- S6: fresh review - a false-green ledger trap (DUE artifact booking green on a bare skip) + a five-times-repeated owner-attribution overclaim `/breakdown` cannot prove -> OPERATOR-RUN ledger + read the owner's own admin/usage row.

## NEEDS HUMAN EYES (top follow-up)
1. **`gateway-anon-tooluse-fidelity` (OPEN, HIGH, confidentiality)** - `docs/findings.md`. With a NON-empty deny-list, a stock Claude Code session cannot reliably navigate a filesystem whose paths contain a deny-listed literal: the tokenized name in `tool_use` args does not reliably detokenize across the agentic loop. The EXACT literal never leaks (tokenized before egress), but the security review found a MANGLED near-miss (`ZarkovH90305`->`ZarkovH9305`) can egress to the provider in cleartext (the literal deny-list does not match the corrupted variant) - partial disclosure to the party the deny-list withholds from; re-egress inferred, **a targeted repro is owed**. Deny-list orgs only; empty-ruleset is a proven byte-identical no-op. The deeper fix (reliable tool_use-arg detokenization + overlapping-span resolution) is a **dedicated follow-up run**, not bolted onto this run's proof driver. This is the run's own honest finding, not green-washed.
2. **S5 credential-mode decision** (brief §5): oauth vs api-key posture for third-party-client traffic + provider ToS review - gates the `ekoa-*` model-field substitution. Unresolved; shipped pass-through.
3. **count_tokens uncapped** (`docs/security.md`, accepted residual) - revisit with a dedicated cap bucket if abuse is observed.
4. The PR policy for `shared/`/auth/billing/LLM changes calls for adversarial cross-model review + merge-on-approval; this run landed directly on `main` per the operator's standing main-only instruction. The cross-model checkpoint ran and approved; a human PR review was not gated.

## DECISIONS / DEVIATIONS (full trail in RUN_LOG.md)
- S5 pass-through; rate caps stay inside proxyGatewayMessages (in-stream 429); count_tokens uncapped/unbilled; key sha256-as-id + self-service; new agentType `gateway-client`; S7 discovered from the S6 finding (new slice, no voluntary deferral); Codex on ChatGPT auth (no API key; interactive-pool risk accepted, calls serial); mutation scoped (full-repo impractical); one api-lane fetch-flake logged to known-flakes (passed in isolation).

## Assumptions ledger
13 entries in `RUN_SPEC.md`, all held (A1 S5 pass-through, A3 in-stream 429, A4 count_tokens uncapped, A5 key shape, A7 attribution, A9 heartbeat mechanics, ...). No `--ask-questions`; all decided autonomously and recorded.
