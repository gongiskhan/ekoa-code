# LANDING — batch-1 "testable app" run · 20260708-203034-41fe4774

**Off:** rc-1 · **Branch:** main (no feature branches; commit-straight-to-main, operator-directed)
**Profile:** feature (operator-forced; 7 slices would size as build) · **Sessions:** origin
`41fe4774` (paused, machine issues) → resumed `5d5ac4d5` on a new Linux/GCP host.
**Status:** 7/7 slices tagged. Both final-phase security gates in: S7's fresh-context review APPROVE,
and the whole-batch cross-cutting security sweep CLEAN. Terminal verdict: completed-with-blockers
(codex-unavailable + live-turn evidence deferred; both external, both remediable).

## Gates summary

| # | Slice | Tag | Review | codexSlice | Live evidence |
|---|-------|-----|--------|-----------|---------------|
| 1 | F2 credential endpoint + gateway self-auth | `batch1-f2` | approve | degraded (codex-unavailable) | F2-E2E PASS (live boot-b) |
| 2 | F16+F28 honest build + verify gates | `batch1-f16-f28` | approve (0 findings) | skipped (profile) | J3 deferred → S7 boot |
| 3 | F20 streamed-text integrity | `batch1-f20` | approve (1 med, fixed) | skipped (profile) | committed tests |
| 4 | F1 auth lifecycle | `batch1-f1` | approve (3 findings, all fixed) | **degraded** | committed tests |
| 5 | F22 memory-view contract | `batch1-f22` | approve (mutation-verified) | skipped (profile) | committed tests |
| 6 | Scoped F4+F5 mounts + F6 404 | `batch1-routes` | approve (6 findings, all fixed) | **degraded** | committed tests |
| 7 | F25 host-context-bleed disposition | `batch1-f25` | approve (5 findings, all closed) | **degraded** | mechanism proven+tested; live deferred |

Deterministic wall (whole batch, verified by EXIT CODE): `npm test` EXIT=0 — shared 32, api
1036/1-skip, web 115. typecheck 0; lint 0 errors (212 pre-existing warnings); all 6 grep/security
gates exit 0. schema-coverage PENDING 72 → 53 across the batch.

## The load-bearing finds (each caught by a fresh-context review or surfaced mid-fix)

- **F1 (auth):** mounting `/auth/refresh` turned a bounded exposure into an unbounded one — a deleted
  user's token could be re-signed forever (stale activation entry). Fixed: deletion clears activation.
  Plus the device-poll double-mint race (findOneAndDelete) and password-change token survival (epoch
  bump + iat pinning so a same-second re-login is not born invalid). All 3 review findings, fixed in-slice.
- **S6 (routes):** a failing LLM run left an unhandled promise rejection (`runAgent.result` orphaned) —
  masked in prod, EXIT=1 in tests. This was ALSO the CI-lane blocker. Fixed in the chokepoint.
- **F25 (isolation):** the fix closed the *path* half of the leak; a proactive check found the *memory*
  half (the operator auto-memory the brief named) still open — inherited `XDG_*_HOME` redirects config
  reads outside a sandboxed HOME, and `CLAUDE_CODE_SESSION_ID`/`CLAUDE_*` are operator identity. Both
  scrubbed. Disposition: `docs/release/F25-host-context-bleed-disposition.md`.
- **F22 (memory):** every memory response violated the shared schema (rendering zero cards); the test
  fixtures omitted `orgId` too, so nothing caught it. Fixtures now assert against the real schema.

## DECISIONS / DEVIATIONS (full text in RUN_LOG.md)

- **DECISION 2026-07-09** — boot-b decoupled from the local Claude Code account. Seeding the operator's
  own OAuth token and firing live turns from the gateway repeatedly invalidated their Claude Code
  session. boot-b now requires a DEDICATED account file; legacy path behind an explicit opt-in.
- **DECISION 2026-07-09** — S5 re-review closed 3 blockers; corrected the record (reviewer retracted a
  finding-1 false positive); consolidated the archived-memory finding into the taxonomy fix.
- **DEVIATION** — S3 chat.ts marker-pass fix beyond the brief's client.ts-only scope (verified necessary
  by the reviewer). S5/S6 memory findings fixed in-slice though some were pre-existing.
- **SELF-CORRECTION** — an earlier summary cited a suite as green off vitest's summary line when the
  process EXIT was 1 (2 unhandled rejections). Fixed the underlying bug; all results now confirmed by `$?`.

## OPEN findings (logged, deferred with review agreement — NOT silently dropped)

1. **schema-coverage COVERED is a hand-maintained allowlist** that cannot detect a FALSE entry — exactly
   how F22 shipped green. Structural gate-work; batch-2.
2. **web/shared `SourceInput` divergence** — the dashboard's knowledge updateSource sends fields the
   shared schema drops; the S6 endpoint is contract-honest but full end-to-end save needs a web↔shared
   reconciliation larger than the F5 subset. Batch-2.
3. **Chat SSE/UI discovery findings** (from the F2 adversarial tester): temp-session persistence 404, a
   run that hangs in "running" on upstream auth failure, racy `initializeBuilderSession`, a
   late-subscriber SSE gap. Not in any batch-1 slice's scope; owed a test or written dismissal (QA L2).
4. **resolveMemoryInjection taxonomy** and archived-memory injection — CLOSED this batch (folded into one
   fix), listed here for the audit trail.
5. **web/tsconfig.json excludes `__tests__`** — web test files are never typechecked, so a wrong
   mock-cast (the exact drift the F22 ratchet fixed) would escape `npm run typecheck`. Deferred to batch-2
   rather than destabilize the web build at run-tail. (S5 reviewer residual, non-blocking.)
6. **Gateway `apikey` principal skips checkAllowance** (batch-security sweep, by-design, plausible-but-
   unconfirmed) — the F2 boot-provisioned gateway key is in every SDK subprocess env; its principal is
   platform-billed and uncapped, so a tenant who exfiltrates it from a build run could make FAST calls
   billed to the platform, bypassing their own allowance. Inherent to subprocess-must-present-a-credential;
   the default topology deliberately exposes only a FAST-clamped key (not the real secret). Fix if desired:
   the `apikey` principal honors a quota. Operator decision owed; not held for the batch.

## NEEDS HUMAN EYES (blockers with external causes, each with its remediation)

- **Provision the dedicated Cortex account** so live-turn evidence can run:
  `claude setup-token` (on the other account) → `~/.config/ekoa/claude-credentials.json` (chmod 600),
  or `{ "apiKey": "sk-ant-api03-..." }`. Unblocks: the S2 J3 build probe and the S7 live reproduce.
- **Codex cross-model review never ran** — `codex` is "Not logged in" on this host. Every security-boundary
  slice's `codexSliceReview` and the run-level codex checkpoint are recorded **degraded, never faked**.
  The F1/S6/S7 briefs name an adversarial Codex pass; the fresh-context Anthropic reviews covered each
  slice, but the cross-model check is owed. Remediation: `codex login` with an API key + budget cap.
- **/config safeguard switch** — interactive-only (not a settings-file key); the operator must flip it
  back to `true` manually if it was toggled for the run.

## Terminal verdict (rationale)

The honest terminal state is **completed-with-blockers**: buildable-remaining reaches 0 (every slice
built + tested + fresh-context-reviewed), but two blockers survive with named external causes — the
cross-model Codex gate could not run (codex-unavailable) and live-turn evidence for two slices is
deferred (credential un-provisioned). Neither is a code failure; both are recorded, not hidden.
