# Flow Plan - Cortex Capability Contract convergence (run 20260730-201019-672a8f14)

Derived from RUN_SPEC.md (same dir). Two repos: ekoa-code (E*, A0) and ~/dev/garrison (G*). All slices are kind `api` (CLI/fitting/API work → asciinema evidence, batched run-level independent-test pass, no design audit). Profile: **build** (14 slices). Commit prefix `[capability-contract]`.

## Slices

| # | Slice ID | Title | Repo | Kind | Size | Parallel group | Status |
|---|----------|-------|------|------|------|----------------|--------|
| 1 | A0 | Convergence audit + voice investigation (docs/CONVERGENCE_AUDIT.md + cited-paths checker test) | ekoa-code | api | 4 | P0 | passed |
| 2 | E1 | `user-or-key` admission middleware + per-key capability rate caps | ekoa-code | api | 6 | P0 | passed |
| 3 | G2 | Capture spool + CLI flush, backend-agnostic (hook never blocks) | garrison | api | 5 | P0 | passed |
| 4 | E2 | memvault: contract + jail + store + router + isolation suite + diagrams | ekoa-code | api | 8 | after E1 | passed |
| 5 | E3 | memvault: per-tenant FTS search + export | ekoa-code | api | 6 | after E2 | passed |
| 6 | E4 | Automations lifecycle: idempotent create + logs endpoint + X-Client + user-or-key flip | ekoa-code | api | 7 | after E3 | passed |
| 7 | E5 | Knowledge REST search/read (org-scoped from actor) | ekoa-code | api | 4 | after E4 | passed |
| 8 | E6 | OpenAPI spec generator + committed cortex.v1.json + drift gate | ekoa-code | api | 5 | after E5 | passed |
| 9 | E7 | cortex CLI + generated client workspace (clients/cortex-cli) + lint zone + diagrams | ekoa-code | api | 8 | after E6 | pending |
| 10 | G1 | cortex-client fitting: pinned-clone CLI install + verify (dogfood-dev only) | garrison | api | 6 | after E7 | pending |
| 11 | G3 | basic-memory backend switch | garrison | api | 5 | after G1+G2+E3 | passed |
| 12 | G5 | cortex-automations view fitting (connector kind, skill-first) | garrison | api | 5 | after G1 | passed |
| 13 | G4 | One-time import + shadow dual-write + daily comparator | garrison | api | 6 | after G3 | passed |
| 14 | G6 | Docs + hard rules both repos (CAPABILITY_CONTRACT.md x2, CLAUDE/AGENTS sections, stale-doc reconciliation) | both | api | 4 | after A0 | passed |

## Acceptance per slice
- **A0**: `docs/CONVERGENCE_AUDIT.md` committed answering every plan-§3 question with file:line refs (incl. corrections: agent-garrison stale → garrison live; entity-gate absent everywhere; voice not converted; bridge-free garrison verified; §10 provider-swap fallback = `anthropic-plan` provider re-selection via `ANTHROPIC_BASE_URL` policy data). Committed checker test asserts every cited ekoa-code path exists (garrison paths checked only when the sibling dir exists). Suite green.
- **E1**: `ekoa_gk_` Bearer on a capability router resolves to owner actor with LIVE role (one user-store read); revoked/unknown/inactive → 401, billing-locked → 402, all shared-envelope; JWT path unchanged; per-key 429 window (env `EKOA_RATECAP_CAPABILITY_CALLS_PER_KEY`, separate instance from LLM counters); `'user-or-key'` added to AuthClass; no descriptor flipped yet (coverage counts unchanged); ci:lane green.
- **G2**: SessionEnd/PreCompact hook writes ONLY to an append-only spool and exits 0 <1s with network dead; flush drains via `cortex memory write` with retry/backoff + stable idempotency key (permalink) per capture; failed items stay spooled; 50MB cap evicts oldest-first with a loud log line; scheduler drain job registered via setup.sh (improver-nightly idiom); local vault behavior unchanged.
- **E2**: write/read/list/delete round-trip under a user key, every body `safeParse`d; single jail point (no other path resolution on the root - asserted by test); traversal/symlink/cross-user/wrong-key probes → uniform 404/400, concurrent two-tenant test no bleed; on-disk files stock-basic-memory rebuildable (frontmatter: title/type/permalink/tags/created/modified); audit line per call {ts,userId,keyId?,xClient?,op,verdict,ms}; COVERED updated, EXPECTED_PENDING_COUNT still pinned; diagrams 02/05/12 updated.
- **E3**: search hits come only from caller's own `<userId>/.index/notes.db` (two-user structural test); delete index → rebuild from markdown; export streams tar of markdown only (no .index/), verified by extraction; isolation suite extended.
- **E4**: same idempotencyKey twice → one run, second response returns the SAME runId (insert-dup race covered); no key → unchanged 202; `GET /runs/:id/logs` returns per-step tails (≤16KB/step, ≤128KB/run, truncated flags); automations domain flipped `user-or-key`; run create under key audits keyId + X-Client; counts pinned.
- **E5**: `POST /knowledge/search` + `GET /knowledge/documents/:collection/:docId` under user key, org-scoped from actor (two-org crossover test); `_shared` readable never writable; existing JWT web flows unaffected; counts pinned.
- **E6**: committed `docs/openapi/cortex.v1.json` contains exactly the `user-or-key` surface with bearer security + shared error envelope component; drift test regenerates in-process and deep-equals; api-contract.md documents the mechanism + versioning rule (additive silent, breaking = version bump).
- **E7**: `clients/cortex-cli` workspace: committed generated types (openapi-typescript) + one generic fetch wrapper + subcommands memory/knowledge/automations, `--json` everywhere, config ONLY from `CORTEX_BASE_URL`/`CORTEX_API_KEY` env (never embedded); e2e test against in-process server with a real minted key; client-drift check wired; eslint zone forbids clients→api/web (proved red once); diagrams 01/02 updated; asciinema evidence.
- **G1**: setup.sh pinned-clone (+path-isolation guard) → build → symlink `cortex`; verify ok in budget (degraded-ok without key); `provides {kind: connector, name: cortex}`, `secret_scope: [CORTEX_API_KEY]`, `config_schema: base_url, git_ref`; dogfood-dev only; OSS defaults untouched.
- **G3**: default `local` byte-identical (verify green with no cortex fitting); `backend: cortex` skips upstream MCP registration + installs cortex-flavored SKILL.md; provider-agnostic phrasing (Honesty Test).
- **G5**: SKILL documents list/show/run/status/logs/watch with --json examples; verify ok/degraded-ok; existing automations fitting untouched + its verify green; no new capability kinds.
- **G4**: import re-runnable, zero dupes (permalink idempotency), verifies counts + sampled search parity vs local index; `shadow_write: true` → capture lands both sides; comparator emits dated diff report + registers daily scheduler job; cutover = documented config flip; review date (first dual-write + 14d) written into decisions + report header.
- **G6**: canonical `docs/CAPABILITY_CONTRACT.md` (ekoa-code: pattern + rules 1,3,4,5,7,8,10 provider-form + how-to-add-a-capability) + garrison mirror (rules 2,3,4,5,6,9 consumer-form, provider-agnostic phrasing); ≤30-line hard-rule sections in ekoa-code CLAUDE.md + garrison CLAUDE.md AND AGENTS.md; GARRISON_EXPLAINED vault-section correction note + FITTINGS_MIGRATION_PLAN header fix; ANTHROPIC_BASE_URL fallback documented in garrison docs; no doc names garrison as a special consumer.

## Parallelism
- P0 (A0 ∥ E1 ∥ G2): disjoint files, G2 in the other repo. Then E2→E3→E4→E5→E6→E7 SEQUENTIAL (all touch shared/ + the two coverage tests). G1 after E7; then G3→G4 with G5 parallel to them (different fittings); G6 last.
- Shared runtime serializes: one dev stack, one recorder, all `codex exec` calls serial run-wide.
- Cross-session: ekoa-code + garrison intents declared; garrison src/** and the held ekoa files are out of bounds for every slice.

## Global acceptance
See RUN_SPEC.md. Tracked in `evidence-index.json → globalGate` in this runDir.
