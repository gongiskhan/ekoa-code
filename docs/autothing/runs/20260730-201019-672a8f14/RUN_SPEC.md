# RUN_SPEC - Cortex Capability Contract convergence (run 20260730-201019-672a8f14)

## What / why
Capabilities (automations, memory, knowledge) are implemented once in Cortex (ekoa-code) and exposed as public, versioned, OpenAPI-documented APIs authenticated by user-scoped API keys (the existing `ekoa_gk_` gateway keys). Garrison (the LIVE repo at `~/dev/garrison`) consumes them as an ordinary client: a generated typed client inside a `cortex` CLI, fittings as views, local/null backends as OSS defaults. Tenancy lives inside Cortex (memory: per-user dirs + centralized path jail + isolation suite). Voice is investigation-only. This supersedes the entity-gate multi-tenant plan (confirmed never landed anywhere - nothing to remove).

## Hard rules (from the operator's plan §2 - violation = stop-and-report)
1 one-implementation-in-Cortex · 2 Garrison consumes only the public contract · 3 no Garrison special-casing · 4 every call identifies a user · 5 tenancy inside Cortex · 6 OSS Garrison works without Ekoa · 7 additive contract evolution + CI drift gates · 8 the provider stays boring · 9 no bridge code in garrison (verified already true) · 10 state migrations end (shadow → compare → cutover-or-remove, dated review).

## Acceptance (global)
- Every capability endpoint carries auth class `user-or-key`; no unauthenticated capability endpoint; key resolves to actor {userId, orgId, live role}; fail-closed on revoked/inactive/unknown/billing-locked; per-key rate caps on capability routes (separate instance from LLM chokepoint counters).
- Committed `docs/openapi/cortex.v1.json` == generated output (drift test in the per-PR lane); generated client types == spec (drift check); CLI built from the generated client only.
- memvault: per-user physical isolation (own dir + own FTS index file), single jail point, isolation suite (traversal/symlink/cross-tenant/wrong-key/concurrent) green in CI, audit line per call, export endpoint, files stock-basic-memory rebuildable.
- Automations: idempotent create (client key → same runId), GET logs (bounded persistence), X-Client tracing; existing behavior unchanged without the new fields.
- Knowledge: REST search/read exposed, org-scoped from actor, two-org crossover test; no new ingestion.
- Garrison: local defaults byte-identical (basic-memory default `local`, existing automations fitting untouched, compositions/default* untouched); cortex backends opt-in via config + sealed-vault key; capture hook spools locally and never blocks session end; import + shadow dual-write + daily comparator machinery in fitting scripts only; NO `src/**` edits.
- Docs: canonical `docs/CAPABILITY_CONTRACT.md` in ekoa-code + garrison mirror; hard-rule sections in both repos' agent guidance (≤30 lines each); stale docs reconciled; diagrams updated with every structural slice.
- Both repos' suites green; ekoa `ci:lane` + chokepoint/garrison greps + gitleaks clean; schema-coverage EXPECTED_PENDING_COUNT stays pinned (new endpoints COVERED in-slice).

## Non-goals (out of scope - do not build)
Ekoa customer UI for capabilities; MCP servers for capabilities; voice implementation; entity gateway / tenancy flags / depot / multi-tenant fittings in garrison; proxy-side prompt interpretation or context injection; new knowledge ingestion pipelines; outbound completion webhooks (deferred, additive); API-key permission scopes (deferred, additive); garrison UI page for cortex-automations (skill-first v1).

## ASSUMPTIONS LEDGER (decisions made on the operator's behalf)
1. **"agent-garrison" = `~/dev/garrison`. CONFIRMED BY THE OPERATOR 2026-07-31 - no longer an open assumption.** The brief names agent-garrison, but `~/dev/agent-garrison` is a stale 2026-05 prototype containing none of the named targets (no basic-memory fitting, no capture-session.py, no CLAUDE.md); every named target exists in `~/dev/garrison` (live, HEAD today). Alternative (literal path) rejected. FLAGGED for operator review in LANDING.
2. **Entity-gate supersession = audit record only.** The plan file and its code exist nowhere (home-wide search); no stub is written because there is no document to stub. Alternative (create a stub anyway) rejected as a pointer to nothing; the audit + decisions entry record the supersession.
3. **Voice "partly converted to Ekoa" = the EKOA side** (corrected by A0's fresh review): a tier-3 voice relay exists as-built in api/src/voice (stub providers, C6 blocked on vendor creds); the garrison deepgram-voice fitting itself was never converted (zero ekoa/cortex refs). Investigation documents both sides + open questions; no code.
4. **No API-key scopes in v1.** Ownership is authorization (same model as the shipped LLM gateway keys). Compensating controls: fail-closed verify, revocation, billing admission, per-key caps, audit lines. Alternative (run/configure/read scopes now) rejected - additive later via a `scopes` field.
5. **Completion webhook deferred.** Polling + SSE + the new logs endpoint cover v1 (plan says "optionally webhook"). Additive later.
6. **Memory module = `api/src/memvault/` at `/api/v1/memvault`** (names `memory`/`memories` are taken by a different existing system). CLI brands it `cortex memory`.
7. **CLI source lives in ekoa-code (`clients/cortex-cli` workspace)**, generated types from the committed spec; garrison installs via the coord-agentmail pinned-clone idiom. Alternative (CLI in garrison) rejected: away from the contract drift gates, implementation-adjacent duplication.
8. **Automations view = new minimal `cortex-automations` connector fitting (skill-first; UI page deferred).** Alternative (backend switch on garrison's local automations fitting) rejected: different engine semantics; would break the OSS default.
9. **Composition install target = `compositions/dogfood-dev` only**; `default*` never touched (working agreement).
10. **Garrison `src/**` untouched this run** - foreign sessions hold kanban/http-gateway/runner + uncommitted src/lib changes; existing capability kinds (connector, memory-store) suffice.
11. **Shadow-mode machinery built and armable; the 14-day review is post-run operational.** First dual-write timestamp + review date recorded in the comparator report header + docs/decisions.md when armed.
12. **OpenAPI generator = `zod-to-json-schema` (zod 3)** walking `allEndpointsFlat()`, filtered to `auth: 'user-or-key'`; spec committed at `docs/openapi/cortex.v1.json`. asteasolutions/zod-to-openapi rejected (requires per-schema annotations in shared/, violating "shared imports zod only" spirit).
13. **CONVERGENCE_AUDIT.md lives at `docs/CONVERGENCE_AUDIT.md` in ekoa-code** ("workspace root" mapped to the primary repo's canonical docs home), with a committed cited-paths-exist checker test.
14. **Held-file exclusions**: ekoa-code - api/src/llm/anonymise/**, api/src/bridge/write-approval.ts, scripts/gitleaks.toml, docs/known-flakes.md, api/tests/apps/document-source.test.ts, api/tests/integrations/platform-poll.test.ts (another session, pushing to origin/main), plus foreign working-tree scratch (drills/**, web settings/nav pages, RUN_LOG prior entries). Garrison - kanban-loop/**, drill/**, http-gateway/**, openai-agents-runtime/**, src/**.

## Commit stacks (prefix `[capability-contract]`, each commit ends with a CHECKPOINT summary)
platform: E1, E6, E7, G1 · memory: E2, E3, G2, G3, G4 · automations: E4, G5 · knowledge: E5 · docs: A0, G6.
