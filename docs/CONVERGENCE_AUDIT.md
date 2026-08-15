# Convergence Audit - Cortex Capability Contract (Phase 0)

Run 20260730-201019-672a8f14, audited 2026-07-30. Facts over memory: every claim below carries a file reference.
Citation convention (machine-checked by `api/tests/docs/convergence-audit-paths.test.ts`): backticked paths are
ekoa-code-relative and must exist; paths prefixed `garrison:` resolve against the sibling checkout `~/dev/garrison`.
Future deliverables of this run are written without backticks. Line numbers reflect 2026-07-30 state.

## 0. Repo identity correction (load-bearing)

The convergence plan names "agent-garrison". The checkout at `~/dev/agent-garrison` is a stale 2026-05 prototype
(12 commits, HEAD 2026-05-04) containing none of the plan's named targets: no basic-memory fitting, no
capture-session.py, no voice fitting, no FITTINGS_MIGRATION_PLAN.md, no CLAUDE.md, zero "cortex" hits. The live
consumer repo is `~/dev/garrison` (HEAD 2026-07-30), where every named target exists. This audit and the run treat
**garrison = `~/dev/garrison`**. A third clone, `~/dev/garrison-codex`, is a port-offset profile checkout, not a
separate codebase.

## 1. ekoa-code / Cortex

### 1.1 Automations API vs the run-lifecycle contract (plan §5.1)

Router: `api/src/routes/automations.ts` (mounted at /api/v1/automations from `api/src/server.ts`); engine under
`api/src/automation/` (`service.ts`, `engine.ts`, `persistence.ts`, `executor.ts`, `planner.ts`, `consent.ts`,
`catalog.ts`, `run-events.ts`, `seams.ts`). Note `api/src/data/collections-engine.ts` is an unrelated data plane.

Present today:
- Definitions CRUD: GET/POST /automations, GET/PATCH/DELETE /:id (`api/src/routes/automations.ts`).
- Async run create: POST /:id/runs → 202 {runId} (`shared/src/automations.ts` RunCreateResponse).
- Status: GET /runs, GET /runs/:id → RunRecord with a CLOSED 9-state enum `idle|running|completed|failed|cancelled|
  awaiting_integration|paused_for_user|awaiting_consent|awaiting_daemon` (`shared/src/automations.ts`).
- Cancel/resume/consent/step-feedback; catalog; approved-commands; SSE run events (GET /runs/:id/events, token-query
  auth; frames in `shared/src/events.ts`).
- Inbound trigger webhooks: /hooks/:triggerId, HMAC-authenticated (`api/src/routes/hooks.ts`), with dedupe on
  triggerId::dedupKey. Triggers domain: `shared/src/triggers.ts`, `api/src/routes/triggers.ts`.

Missing vs §5.1 (built by this run):
- **Idempotent create**: RunCreateRequest is `{inputs?}` only (`shared/src/automations.ts`); startRun always mints a
  fresh runId (`api/src/automation/service.ts`). No Idempotency-Key handling anywhere. → slice E4.
- **Log retrieval**: step stdout/stderr exists only as ephemeral SSE `step_output_chunk` frames (200-event ring,
  300 s idle sweep - `docs/api-contract.md`); persisted StepRecord keeps only status/tier/duration/one-line error/
  screenshotUrl. No GET /runs/:id/logs. → slice E4 (bounded persistence).
- **Completion webhook**: outbound delivery does not exist; completion is SSE-only (`shared/src/events.ts`).
  → DEFERRED this run (additive later); polling + logs suffice for the first consumer (decision in RUN_SPEC ledger).
- **Rate limits on capability routes**: none. Caps exist only at the LLM chokepoint (`api/src/billing/rate-caps.ts`)
  and on the legal plane (`api/src/legal/access-gate.ts`). → slice E1.
- Contract-gate accounting: `api/tests/contract/automations.test.ts` exists, but zero automations.* keys are COVERED
  in `api/tests/contract/schema-coverage.test.ts` - all counted PENDING. → tightened as slices flip descriptors.

### 1.2 OpenAPI

**No OpenAPI/Swagger spec exists anywhere in the repo** (no spec files; no zod-to-openapi dependency in any
package.json). The actual contract mechanism is `shared/` zod schemas + endpoint descriptor maps:
`shared/src/descriptor.ts` (EndpointDescriptor {method, path, auth, request?, response?, query?, timeoutMs?, kind?};
AuthClass is a closed union), one map per domain (e.g. `shared/src/automations.ts`, `shared/src/knowledge.ts`),
aggregated as ALL_ENDPOINTS/allEndpointsFlat() in `shared/src/index.ts`. Conventions: `docs/api-contract.md`.
CI gates: `api/tests/contract/schema-coverage.test.ts` (COVERED allowlist + pinned EXPECTED_PENDING_COUNT - a new
shared/ endpoint that is not COVERED fails the gate) and `api/tests/contract/mount-coverage.test.ts`.
The descriptors carry everything OpenAPI needs → this run generates the spec mechanically from them (slice E6:
generator + committed docs/openapi/cortex.v1.json + drift test; zod is v3 per `shared/package.json`, so the
converter is zod-to-json-schema, an api devDependency - shared/ stays zod-only).

### 1.3 API keys

A shipped per-user key mechanism exists - **gateway keys** (`api/src/auth/gateway-keys-service.ts`):
- Minting: `ekoa_gk_` + 32 random bytes base64url; POST /api/v1/gateway-keys (`api/src/routes/gateway-keys.ts`,
  contract `shared/src/gateway-keys.ts`, store `api/src/data/stores.ts` gateway_keys, UI show-once panel under
  `web/app/(dashboard)/settings/api-keys/`).
- Storage: sha256(secret) IS the document _id; plaintext never stored; 4-char hint tail (documented entropy cost).
- Revocation: owner-only, durable, idempotent; unknown/foreign id → uniform 404 (no existence oracle).
- Verification: fail-closed `unknown|revoked|inactive|billing_locked`, activation + billing admission re-checked.
- Per-user scoping: yes - a key belongs to exactly one owner (ownerUserId); verification resolves the owner.
- **Permission granularity: none.** No scopes; ownership is the authorization (a key is currently a full LLM-egress
  credential for its owner). This run keeps that model for capability APIs (v1, recorded decision) - scopes are an
  additive later evolution (the unused per-key `caps` override field on GatewayKeyDoc shows the additive pattern).
- Rate limits: per-key sliding window exists ONLY at the LLM chokepoint (`api/src/billing/rate-caps.ts`,
  EKOA_RATECAP_CALLS_PER_KEY / SPEND_PER_KEY; per-key overrides field exists but no mint surface sets it).
  Capability routes get their own separate calls-only instance in slice E1.
- Auth today is bearer-token everywhere (no session cookies): platform JWT (`api/src/auth/middleware.ts`
  requireAuth), SSE ?token=, roles via requireRole, bridge tokens (`api/src/bridge/token.ts`), served-app capability
  tokens. Gateway-key verification is consumed via an injected seam only by the LLM gateway (llm/ may not import
  auth/); ordinary routers can import auth/ directly - slice E1 adds requireUserOrApiKey there.

### 1.4 Memory

`api/src/memory/` is a DIFFERENT system: structured organizational memory (extraction after runs, deterministic
term-overlap injection into prompts, Mongo `memories` store, OwnerVisibilityScoped private/org visibility -
`api/src/memory/resolver.ts`, `api/src/memory/extraction.ts`, routes `api/src/routes/memories.ts`). It is
prompt-injected only; no agent-callable memory tool exists (the tool vocabulary in `api/src/agents/tools.ts` spans
knowledge/attachment/docx families - none for memory).
**No basic-memory-style markdown-note store exists or was started** (repo-wide zero hits for basic-memory /
write_note / note-file storage). The memory capability of this run is net-new: module api/src/memvault (name chosen
because `memory`/`memories` are taken), per-user directories + per-tenant index + centralized path jail (slices
E2/E3).

### 1.5 Knowledge

Lexical, not vector: SQLite FTS5/BM25 over a markdown vault (`api/src/knowledge/index-store.ts`,
`api/src/knowledge/vault.ts`, `api/src/knowledge/service.ts`); derived/regenerable; better-sqlite3 imported only
here. Exposed REST (`api/src/routes/knowledge.ts`, contract `shared/src/knowledge.ts`, all behind requireAuth):
collections, documents list/ingest/delete, sources CRUD, uploads, reindex (admin), index-status; crawl endpoints are
honest stubs. **Search/read are deliberately NOT exposed over REST** - they reach agents as in-process tools
(`api/src/agents/sdk-tools.ts`) through seams where orgId comes from the run's actor, never from arguments
(`api/src/agents/seams.ts`). Scoping is **org-level** on every FTS row + a read-only `_shared` public partition
(`api/src/knowledge/paths.ts`; assertNotSharedActor in `api/src/knowledge/service.ts`).
An ingestion surface EXISTS (POST documents, POST uploads with SSRF-validated source URLs) → per plan §7 this run
exposes search/read over REST user-scoped (slice E5) and designs no new ingestion.

### 1.6 The Anthropic-compatible /v1/messages endpoint

`api/src/llm/gateway.ts`, mounted at /api/v1/llm: POST /messages + /v1/messages (+count_tokens, /models,
/classify). Auth resolves one of: static platform key (x-api-key), **user gateway key** (accepted on both x-api-key
and Authorization: Bearer - stock Claude Code compatible), platform JWT; billing-locked is a distinct 402 principal.
Auth gate runs BEFORE the body parser (pre-auth memory-DoS closed). Metering/billing/audit inside the chokepoint;
per-key rate window; unmetered-call counter on /health. **Rule-4 alignment: confirmed for user keys** - every
userkey call resolves to its owner as billee. (The static platform key is an admin/platform credential, not a
capability-API path; capability routes in this run accept ONLY user-scoped principals.)
**Fallback toggle: correctly a CLIENT-side story.** Server-side there is deliberately no bypass (egress chokepoint
invariant: `docs/architecture.md`; grep gate `scripts/chokepoint-grep.sh`; SDK spawns scrubbed + pointed at the
chokepoint in `api/src/llm/credentials.ts`). The consumer-side toggle already exists in garrison: provider selection
is policy data - `garrison:fittings/seed/claude-code-runtime/apm.yml` provider config swaps ANTHROPIC_BASE_URL
(+ vault key) per spawn (`garrison:fittings/seed/agent-sdk-runtime/lib/providers.mjs`); pointing at Cortex means
registering a provider with base_url = <cortex>/api/v1/llm and an ekoa_gk_ key; **fallback = re-selecting the
anthropic-plan provider (no base URL)**. Documented in the docs slice; nothing to build (rule 8 holds: the gateway
authenticates, meters, routes, logs - no prompt interpretation, no context injection, no side effects).

## 2. garrison (consumer)

### 2.1 basic-memory fitting

`garrison:fittings/seed/basic-memory/apm.yml` - faculty memory, component_shape skill, provides
memory-store/basic-memory; config keys: vault_dir (~/ObsidianVault), memory_dir (Memory), project_name (main),
capture_enabled (true), register_codex_gemini (manifest default true; overridden false in every dogfood/default
composition that ships an apm.yml - the former dogfood-orch exception no longer exists: that composition carries
no apm.yml as of 2026-08-13). Setup installs upstream
basicmachines-co basic-memory via uv and registers its stdio MCP server with Claude/Codex/Gemini
(`garrison:fittings/seed/basic-memory/scripts/setup.sh`).
**Ops surface in daily use** (the CLI-parity scope, from `garrison:fittings/seed/basic-memory/.apm/skills/garrison-memory/SKILL.md`):
search_notes/search, read_note, build_context, recent_activity, write_note (+ `basic-memory tool` CLI equivalents).
No list-family tool is documented. → cortex CLI v1 parity target: write/read/search/list/export (build_context and
recent_activity are upstream-graph features, out of contract v1; recorded in RUN_SPEC).
**Capture hook** `garrison:fittings/seed/basic-memory/scripts/capture-session.py`: SessionEnd + PreCompact hook
(wired idempotently into ~/.claude/settings.json; script copied to a stable $CLAUDE_HOME location); tails the
transcript JSONL (last 40 lines → user/assistant text, 400-char truncation, last 12), one-regex redaction of
sk-*/ghp_*/xoxb-*, writes session-*.md with YAML frontmatter into the vault; guarded excepts + always exit 0.
No LLM call. Consolidation ("dream") lives in the Improver fitting, not here.

### 2.2 Voice fitting

**In this repo the fitting was never converted: it is pure Deepgram** (the "partly converted" state lives on
the EKOA side - see §4). The fitting is
`garrison:fittings/seed/deepgram-voice/` - a complete own-port Deepgram proxy (STT/TTS/WS streams, barge-in,
latency logging), secret_scope [DEEPGRAM_API_KEY]. Zero ekoa/cortex references (verified grep, both clones); the
only swappable base is DEEPGRAM_WS_BASE for mocked tests. The consumer side is already provider-agnostic:
web-channel discovers by status file and pure-passthrough proxies (`garrison:fittings/seed/web-channel-default/scripts/server.mjs`).
See §4 for the investigation deliverable.

### 2.3 Superseded entity-gate plan

**Confirmed absent everywhere.** No entity-gate-mt-memory-plan.md under ~/dev/garrison, ~/dev/ekoa-code,
~/dev/ekoa-dev, ~/dev/ekoa-mono, or ~ at large; no landed code (exhaustive grep for multi-tenant/tenancy/depot/
entity-gateway machinery returns only prose NEGATIONS - e.g. `garrison:docs/GOVERNANCE.md` "no multi-tenant
isolation to design for", `garrison:docs/SPEC.md` out-of-scope list). No tenancy flags in any manifest, no depot
composition, no operative-per-tenant. **Nothing to remove; no stub needed** - this document + the decisions entry
are the supersession record.

### 2.4 Automations remnants

Garrison's `garrison:fittings/seed/automations/` is a substantial LOCAL engine - a PORT of ekoa's engine (file
headers say "ported from ekoa's rehearsal.ts/fingerprint.ts/cache.ts/command-shape.ts"; ekoa's `integration` step
renamed `connector`, `ekoa_action` dropped; 8 step types; YAML store in ~/.garrison/automations; own server on 7090).
**It is a port, not a shared module** - no npm/workspace package is shared between the repos (rule 10: nothing to
delete; the one reverse-flow assertion, `garrison:fittings/seed/automations/lib/assertions.mjs` "ships to Ekoa per
F6", is a duplicated-vocabulary risk to watch, not a shared module). **No composer fitting exists** (the composer
server was retired into Muster's policy panel - `garrison:src/lib/orchestrator-policy.ts`). **No Cortex-bridge code exists
in garrison** (zero hits for delegate_to_local or the Cortex bridge endpoints - rule 9 verified; the bridge lives
Cortex-side under `api/src/bridge/`; garrison's outpost Mac-relay has an unrelated bridge-token concept of its own,
`garrison:tests/outpost-host-broker.test.ts`). → the Garrison view over Cortex automations is a NEW minimal connector fitting (slice G5),
not a backend switch on the local engine (different lifecycle semantics; OSS default must keep working).

### 2.5 Stale docs (reconciled in slice G6)

- `garrison:docs/GARRISON_EXPLAINED.md` - already blanket-marked stale; its §11 vault description (scrypt
  passphrase) is factually wrong vs the live keychain/HKDF vault (`garrison:src/lib/vault.ts`); G6 adds a pointed
  correction note (key storage matters to this convergence).
- `garrison:FITTINGS_MIGRATION_PLAN.md` - done-not-stale; cosmetic header contradiction ("pending confirmation"
  above a table saying all slices shipped); G6 fixes the header line only.
- `garrison:CLAUDE.md` "talks only to localhost" positioning line + `garrison:docs/GOVERNANCE.md` Honesty Test:
  not edited into contradiction - G6 phrases everything provider-agnostically ("fittings may consume any provider
  implementing the contract; Cortex is the reference provider; local defaults always work without it") and states
  the external-provider reality (Deepgram/Anthropic egress already exists via vault-scoped fittings).

### 2.6 Secrets/config delivery (how a fitting gets base URL + key)

Base URL: config_schema key → env `<FITTING_ID>_<KEY>` (`garrison:src/lib/runner.ts` setupConfigEnv). API key:
`consumes: vault` + `secret_scope: [CORTEX_API_KEY]` → fail-closed scoped injection
(`garrison:src/lib/own-port-lifecycle.ts`; no secret_scope ⇒ zero secrets, audited denial). Template:
`garrison:fittings/seed/deepgram-voice/apm.yml`. CLI install idioms: uv tool install (basic-memory) or pinned clone
into ~/.garrison/external with license-isolation guard (`garrison:fittings/seed/coord-agentmail/scripts/setup.sh`) -
slice G1 uses the latter. Keys never committed, never in OSS defaults (vault-only), never travel in composition
exports (names only).

## 3. Adjustments to the plan (recorded)

1. Repo identity (§0) - run targets ~/dev/garrison. Operator should confirm post-run; flagged in LANDING.
2. Entity-gate supersession = record-only (§2.3); no stub, nothing to remove.
3. §5.4 "delete shared-module remnants" = no-op (port, not shared module); stale-doc work is §2.5's list.
4. §5.3 "reuse composer work" = build minimal new view fitting (none exists to reuse).
5. Completion webhook deferred (additive); no key scopes v1; CLI parity = the five daily ops minus upstream-graph
   features (§2.1). All in the RUN_SPEC assumptions ledger.

## 4. Voice investigation (plan §7b - no implementation)

Garrison side: §2.2 - a complete, pure-Deepgram own-port proxy; the web-channel consumer is provider-agnostic
passthrough; zero cortex references.
Ekoa side (CORRECTED after fresh-context review): a tier-3 voice relay EXISTS as-built under `api/src/voice/`
(`api/src/voice/index.ts`, `api/src/voice/providers.ts`, `api/src/voice/session.ts`,
`api/src/voice/stub-providers.ts`): WS /api/voice/stream (STT, 16 kHz PCM, utterance-end endpointing) and
/api/voice/tts-stream with {clear} barge-in, token-query JWT auth, per-turn latency logging, and metering counters
voice_stt_ms / voice_tts_chars through `api/src/billing/tracker.ts`; wired via attachVoiceServer in
`api/src/server.ts`. Its providers are STUBS: the live STT/TTS bake-off (run 20260717 slice C6) is blocked on
vendor credentials (Deepgram + Google TTS + optional ElevenLabs). So the plan's "partly converted to Ekoa" is
accurate for the EKOA side (a hosted relay exists, unarmed), while the garrison fitting itself was never converted.
Contract sketch, against the as-built surfaces: batch transcribe/synthesize ops fit the HTTP capability contract
(binary kind); the defining real-time WS surfaces exist, but the descriptor mechanism types frame protocols only
nominally (kind 'ws' in `shared/src/descriptor.ts` without frame schemas), so a voice capability contract needs a
frame-schema companion (AsyncAPI-shaped) beside the OpenAPI document.
Open questions (recorded, not answered):
1. Auth alignment: the as-built relay authenticates by token-query JWT, not user-scoped API keys - rule 4 requires
   a key-carrying path before voice joins the public capability contract (reuse user-or-key on the WS upgrade?).
2. Vendor credentials remain the blocker for live providers (C6). Garrison's fitting already holds
   DEEPGRAM_API_KEY in the sealed vault - does the convergence pick Deepgram first, and is that key shareable?
3. Contract home: one HTTP capability spec plus a separate streaming/frame contract, or hold voice out of the
   contract until the streaming shape is settled?
4. Latency: garrison's fitting is same-host by design; is a hosted Cortex hop acceptable for daily voice, or does
   voice stay local with Cortex as key broker + meter (the meters already exist: voice_stt_ms / voice_tts_chars)?

## 5. Hard-rule feasibility check (plan §2 - none contradicted)

1 ✓ (capabilities land in api/src, one implementation) · 2 ✓ (generated client + CLI, slices E6/E7/G1) ·
3 ✓ (X-Client is trace-only; no garrison branches; `scripts/garrison-grep.sh` already fails CI on garrison coupling
in api/shared) · 4 ✓ (gateway keys exist; user-or-key class, slice E1) · 5 ✓ (memvault per-tenant isolation,
slices E2/E3) · 6 ✓ (local defaults; cortex opt-in config) · 7 ✓ (descriptor maps + coverage gates exist; OpenAPI
drift gate added) · 8 ✓ (§1.6 verified) · 9 ✓ (§2.4 verified - already true) · 10 ✓ (shadow machinery + dated
review, slice G4; nothing legacy to remove).
