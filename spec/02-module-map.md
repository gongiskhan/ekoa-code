# 02. Module map

This chapter fixes the repository layout, the module inventory of the new API service, and the import rules between all of them. The aim is a boring, conventional Node.js + TypeScript service (FIXED-1): every module has one obvious responsibility, dependencies point in one direction only, and nothing clever lives between a route and the code that does the work. A reader who knows Express and TypeScript should be able to predict where any given piece of logic lives before opening the repo. The visual companion is diagram `spec/diagrams/02-module-map` (see FIXED-12); any change to this module structure must update that diagram in the same unit of work.

## 2.1 Design stance: boring by design

- One process, one service (FIXED-1, FIXED-8). No core/runtime split, no plugin architecture, no framework-of-our-own.
- Routes are thin: validate the request against the shared contract, call a service or domain module, shape the response. Nothing else (see 2.6, `routes/`).
- Business logic lives in plainly named domain modules, written as TypeScript at design time (FIXED-4). No runtime interpretation of markdown by a model, anywhere.
- The dependency graph is acyclic and shallow (section 2.7). Where the old code had circular pressure (event delivery calling into engines that stream events back out), the new design breaks the cycle with callbacks injected at the composition root (section 2.8), a seam the old code already proved out (reference/carryover-audit.md B6, B7).
- Exactly one module talks to Anthropic and owns anonymisation on egress (FIXED-3, FIXED-13). Lint-enforced (section 2.9).

## 2.2 Repository layout (FIXED-1)

The new repository is **`ekoa-code`** (RESOLVED (P-16)), created as a sibling folder of `ekoa-dev`; it is greenfield. Wherever this spec elsewhere says "the new repository" in a name-clarifying context, the name is `ekoa-code`. Resolved: repository name is `ekoa-code`, sibling of `ekoa-dev`, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md). Top level:

| Path | Contents | Owned by chapter |
|---|---|---|
| `api/` | The REST service. All backend code under `api/src/` per section 2.6. The test tree under `api/test/` additionally holds the fake-daemon harness (`api/test/fake-daemon/`), a build deliverable that is the executable definition of the daemon wire contract (chapter 18 section 18.7). Own `package.json`. | this chapter |
| `web/` | The migrated Next.js frontend (FIXED-9). Own `package.json`. | ch12 |
| `shared/` | The API contract ONLY: zod schemas, the TypeScript types inferred from them, and the endpoint descriptor maps (one `{ method, path, auth, request?, response, query?, timeoutMs?, language?, kind? }` entry per endpoint - the machine-readable form of the ch03 endpoint tables, from which `api/` mounts validation and `web/` derives its client; ch12 12.2.1), one file per domain. Runtime validation, static types, and endpoint bindings share the one source. Descriptor maps are contract data, not code; beyond them nothing else lives here - no utilities, no components, no config. | ch03 (shapes), ch12 (descriptors), this chapter (placement) |
| `spec/` | This specification and the Excalidraw diagrams (`spec/diagrams/`). Diagrams are first-class (FIXED-12): any change that alters structure, flow, or data shape updates the affected diagram in the same unit of work; a structural change without its diagram update is incomplete. | all |
| `CLAUDE.md` | Agent guidance for the new repo. Must state, from day one: the import-boundary rules below, the no-Anthropic-outside-`api/src/llm/` rule, and the FIXED-12 diagram invariant. | this chapter |

**Import boundaries (FIXED-1):**

| From | May import | Must never import |
|---|---|---|
| `web/` | `shared/` | `api/` |
| `api/` | `shared/` | `web/` |
| `shared/` | (nothing outside itself; zod only) | `api/`, `web/` |

Enforced with ESLint `import/no-restricted-paths` zones plus the statement in `CLAUDE.md` (FIXED-1). Details in section 2.9.

Old Cortex and the current frontend repo are reference material only (FIXED-1). The ekoa-local daemon remains its own project, built later against its own brief (`docs/ekoa-local-integration-brief.md`) and out of scope for `ekoa-code`. What IS in scope this run is the API side of the local-file-access contract - delegation, the daemon-facing WS server and pairing registry, and the anonymisation-routed provider endpoint (chapter 18) - specified against the fake-daemon harness (`api/test/fake-daemon/`, section 18.7). The `bridge/` module below is the API-side endpoint of that contract.

## 2.3 Workspace tooling - RESOLVED (P-17)

Tooling is **plain npm workspaces** at the repo root, with `api/`, `web/`, and `shared/` as the three workspaces, each owning its own `package.json`. No turbo, no nx, no lerna, no build orchestrator (FIXED-1 forbids monorepo tooling; npm workspaces is a stock npm feature, not a monorepo framework - it exists here only so `api` and `web` can depend on `shared` by package name with TypeScript project references).

Rejected alternative: no workspaces at all, with `api/` and `web/` consuming `shared/` via a `file:../shared` dependency or relative-path TypeScript project references - works, but makes editor tooling and CI installs fiddlier for no gain.

Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 2.4 HTTP framework - RESOLVED (P-01)

The service is built on **Express 5, with zod validation middleware at every route boundary** (schemas from `shared/`).

Rationale (normative):
- Most conventional choice; maximally in-distribution for an unsupervised implementation run.
- The carryover modules are already Express-shaped: the SSE client manager takes an Express `Response` (reference/carryover-audit.md A2), the LLM gateway is already a conventional Express sub-app (reference/carryover-audit.md B12), and the extracted router files that the audit names as the structural template for all new routers are Express routers (reference/carryover-audit.md A3, `routes/app-files.ts`). Choosing anything else would convert dozens of port-as-is verdicts into adapts.

Rejected alternative: Fastify (schema-first validation, faster) - rejected because of the carryover conversion cost above, and because the archived original backend was Fastify, so re-adopting it invites confusion with reference material that is explicitly not to be ported (FIXED-1).

Resolved: ACCEPT (recommendation final), founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 2.5 Web client build and deploy relative to the API - RESOLVED (P-02)

How `web/` is built and shipped relative to `api/`: **separate containers behind one reverse proxy.** `web/` is a static-exportable Next.js app built into its own container image; `api/` is its own container; both sit behind the same reverse proxy, exactly mirroring the current ekoa-app/cortex split in the production deploy repo. Rationale (normative): it is the topology production already runs, so cutover (ch10) changes nothing at the proxy layer; it keeps deploys and rollbacks independent per app; and it structurally reinforces FIXED-10 (the API never learns it has a specific frontend).

Rejected alternative: the API serves the built web bundle - `web/` builds to static files copied into the `api/` image and served by Express (one container, simpler ops for small installs), rejected for its coupled release cadence, the API redeploy needed to ship a CSS fix, and the standing temptation to special-case the bundled client in the API (eroding FIXED-10).

The API surface and the `shared/` contract are identical either way; the deploy topology is an ops detail. The implementation run scaffolds separate containers behind one reverse proxy. Resolved: defaulted to recommendation per amendment Part 1, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md).

## 2.6 `api/src/` module inventory

The module names below are canonical for the whole spec; every other chapter uses them identically. One-line index first, then the detail entries. For each module: its responsibility, what it ports from old Cortex (cited to reference/carryover-audit.md tiers/rows), and which other modules it may import. "May import" lists are exhaustive; anything not listed is forbidden. Every module may additionally import `shared/` and node built-ins.

| Module | One-line responsibility |
|---|---|
| `server.ts` | Composition root: builds the app, mounts routers, wires injected seams, runs boot. |
| `config.ts` | Env-derived typed configuration singleton. |
| `auth/` | JWT middleware, login, refresh, device login, admin seeding. |
| `routes/` | One thin Express router per domain: validate, call, respond. |
| `services/` | Cross-domain conventional business logic (sanitizer, browser pool, GitHub pipeline, ...). |
| `data/` | All persistence: Firestore client, domain stores, collections engine, Supabase client, crypto. |
| `llm/` | THE egress module - one module, three concerns (FIXED-13): Anthropic chokepoint client + attribution/metering, the anonymisation pipeline, provider routing config. |
| `agents/` | Agent SDK execution of user work: job lifecycle, context assembly, typed streaming. |
| `apps/` | User-app pipeline: esbuild, registry, static serving + context injection, slugs, artifact backends. |
| `events/` | Push infrastructure: SSE manager, durable event queue, trigger delivery, webhook ingress. |
| `automation/` | Vision-first automation engine, action runner files, fingerprint, cache, catalog. |
| `bridge/` | Daemon-facing WS server for the ekoa-local daemon: pairing registry, delegation dispatch, the provider-endpoint carve-out (chapter 18). |
| `streaming/` | Live browser canvas media relay - the FIXED-2 media-channel carve-out (Q-01 resolved). |
| `billing/` | Token accounting: tracker, ledger, allowance middleware, credits, overage. |
| `memory/` | Organizational memory: resolver, formatter, signals, tiers, guardrail rules. |
| `knowledge/` | Legal/firm knowledge base: vault, FTS5 index, ingest, grounding block builder. |
| `integrations/` | External connections: OAuth flows, encrypted credentials, action running, Pipedream, e-signature. |
| `legal/` | Legal vertical: calculators, research, CITIUS/eTribunal, tracking. |
| `content/` | Agent-context loader: composition directories + content-addressed cache. |

### `config.ts`

Responsibility: the env-derived configuration singleton - ports, paths, keys, feature toggles. Loaded once at boot; every other module reads typed config values from it instead of touching `process.env`.
Ports: the old config module as-is, re-keyed to whichever env names the new service keeps (reference/carryover-audit.md A11, `config.ts` row).
May import: nothing.

### `data/`

Responsibility: all persistence. The Firestore client (Mongo-compatibility wire protocol via the `mongodb` driver), the platform domain stores (per P-05, ch04), the collections engine that executes every user-app data operation from per-app manifests (FIXED-5), the Supabase REST client for credential custody and license (P-08, ch04), and the single crypto module for encryption at rest (AES-256-GCM, key mandatory - unified in this rebuild from the two old implementations; ch09 owns the invariant). The activity store lives here with exactly one exported write function, `logActivity` - the single audit write path (FIXED-8; ch09 invariant 3). It is homed in `data/` deliberately: `data/` sits at the bottom of the import graph, so every writing module (`auth/`, `memory/`, `agents/`, `apps/`, `integrations/`, `knowledge/`, `billing/`, `services/`) can reach it within its existing import list; direct writes to the activity collection outside `logActivity` are grep-banned (ch09 9.3).
Ports: the app-data family including the Firestore backend and the storage contract that is already a clean seam (reference/carryover-audit.md A5); the Supabase client (A5); the crypto functions with the dev-fallback key removed (A4, `tools/crypto.ts` row and its security flag); the store schemas that follow the one storage decision (B14, P-05).
May import: `config.ts`.

### `auth/`

Responsibility: JWT sign/verify, the Express auth middleware, login, token refresh (P-03, ch03), device login, and first-boot admin seeding (invoked from `server.ts`). Produces the per-request user context consumed by every route.
Ports: the JWT module as-is with the redundant wrapper folded in (reference/carryover-audit.md A1); device-login primitives (A11, `tools/device-auth.ts` row); first-boot admin seeding (A11, `bootstrap.ts` row).
May import: `data/`, `config.ts`.

### `billing/`

Responsibility: token accounting - tier weights and constants, the usage tracker, the per-user ledger, the pre-request allowance gate as Express middleware, credits and overage. The single metering point is invoked from `llm/` (FIXED-3; ch06 owns the mechanics). Usage-updated pushes go through a notifier callback injected at the composition root, never a direct import of `events/` (section 2.8).
Ports: constants, tracker, middleware, and ledger store, with the tracker's one SSE emit replaced by the injected notifier (reference/carryover-audit.md B6).
May import: `data/`, `config.ts`.

### `content/`

Responsibility: the agent-context loader (FIXED-6): assembles per-user composition directories from agent-context content (behavior and knowledge files for the coding, chat, and automation agents) plus a shared content-addressed cache for distribution. It is a loader, not a framework - it reads files and produces context inputs for `agents/`; it defines no routes, no schemas, no runtime logic (FIXED-6, FIXED-7; ch08 owns the loader's contract and the Garrison boundary).
Ports: nothing verbatim - the old agent-content discovery machinery is explicitly not carried (reference/carryover-audit.md Tier C, the two loader rows serving the old prompt composition); the file-store mechanics of integration definition storage are the closest surviving relative (A4, `services/integration-storage.ts` row).
May import: `config.ts`.

### `llm/`

Responsibility: THE egress module - one module, three concerns (FIXED-13, quoted once): "One egress module, three concerns. The LLM chokepoint (`api/src/llm/`) is simultaneously: attribution + metering (chapter 06), the anonymisation pipeline (chapter 17), and provider routing config (provider base URL, region, zero-retention posture as configuration, never hardcoded). Nothing else may import or instantiate the Anthropic client - lint/dependency-enforced; subprocess paths (Agent SDK spawns) are pointed at the chokepoint via base URL/env so their traffic funnels through it."

- **Concern one - Anthropic chokepoint and attribution (FIXED-3; ch06 owns the mechanics).** Every Anthropic byte in the service flows through this module: `llm/client.ts` wraps (a) the Claude Agent SDK invocation used for user work, (b) the direct Messages REST call used for cheap classification, and (c) the metered pass-through for the ekoa-local gateway (the bridge provider endpoint, chapter 18 section 18.4); `llm/attribution.ts` tags every call at the call site as `user_work | platform | classifier`, recorded and metered from day one; `llm/router.ts` is the tier classifier. Managed Claude OAuth custody (Supabase-backed get/refresh/rotation) lives here because it exists solely to authenticate Anthropic calls (FIXED-8: managed OAuth only, no raw API keys, no `~/.claude` fallback).
- **Concern two - the anonymisation pipeline (FIXED-8 as amended, FIXED-13; chapter 17 owns the full contract).** The amended FIXED-8 reads "anonymisation layer built in this run as part of the egress module (chapter 17)": every model-bound payload is tokenized on egress and de-tokenized on return through this one module, so anonymisation is a property of the single chokepoint, never a bypassable side path. The mechanism (detection, per-session in-memory vault, de-tokenization including tool_use argument blocks, hash-chained metadata-only audit) is core; the PT-PT ruleset and per-tenant deny-lists load as tenant configuration, mechanism core and ruleset composition (the Garrison line, FIXED-7). The pipeline is greenfield - the old `memory/anonymizer.ts` is dead code and is NOT its ancestor (chapter 11).
- **Concern three - provider routing config.** Provider base URL, region, and zero-retention posture are first-class configuration read from `config.ts`, never hardcoded, so EU-region processing and a zero-retention provider posture are adopted without a code change (chapter 17 section 17.2; the Ekoa Local v2 brief, docs/, A6-D6).

Ports: the plain-fetch Messages client that the audit designates as the replacement for the old one-shot helper seam (reference/carryover-audit.md A11, `anthropic-client.ts` row, and the S1 seam definition); the managed OAuth service with its callback hooks (A4, `services/claude-auth.ts` row); the pure zero-import tier classifier (A11, `llm-router.ts` row); the gateway sub-app (B12). The anonymisation pipeline ports nothing - it is built this run (chapter 17).
May import: `billing/`, `data/`, `config.ts` (the last two carry the audit write path and the encrypted-at-rest deny-list; the per-session vault is in-memory and never persisted). No other module may import the Anthropic SDK or client libraries (section 2.9) - the structural enforcement of all three concerns.

### `services/`

Responsibility: cross-domain conventional business logic that does not belong to a single domain module - the long tail of small, verified-portable services: response error sanitisation and the secret-commit guard - output-scrubbing hygiene, distinct from and not to be confused with the FIXED-13 anonymisation pipeline that is now a built layer inside `llm/` (ch17); these scrub errors and prevent secret commits, they are not the model-egress anonymiser (ch09), the symlink-hardened safe-path helper that jails user-derived filesystem paths to the owner sandbox (ch09 invariant 10 and P-15 - homed here rather than in `apps/` so that both `apps/` and `automation/` can import it), the shared headless browser pool, artifact screenshots, the SSRF guard and URL fetcher, the GitHub git-as-record pipeline with its per-repo mutex, site building and analysis, archive/export, demo registry, base loading, branding asset pipelines.
Ports: the largest carryover block in the audit - error-sanitizer and commit-guard (reference/carryover-audit.md A7), browser-pool (A8), artifact-screenshot (A10), url-safety (A11), the GitHub pipeline (B18), and the Services sweep rows verdicted port-as-is or adapt (Services sweep table: `app-archive`, `automation-browser`, `base-loader`, `brand-color-filter`, `branding-save`, `demo-registry`, `design-system`, `site-builder`, `site-context`, `repo-lock`, `url-fetcher`, and peers).
May import: `data/`, `billing/`, `config.ts`. Never `llm/` - the remaining platform-attributed model calls are eliminated or made deterministic per the call-site fates (reference/llm-usage-map.md §7), so no service needs a model.

### `integrations/`

Responsibility: everything about connecting external systems: integration configuration with encrypted credentials, integration definition storage, the platform OAuth flows (Google, Microsoft, Adobe) and callback processing, the generic platform API caller with in-band token refresh, the user-defined integration action runner, browser session capture, the Pipedream layer, the Adobe e-signature stack, and cloud-file access that rides the platform API caller. Credentials are decrypted only at execution time via `data/`'s crypto module (FIXED-8). On integration creation, configuration update, and re-enable, this module also writes or refreshes the idempotent integration-affinity preference memory through `memory/`'s writer - the deterministic, no-model-call mechanism by which agents learn to prefer a connected integration (ch05 5.8; reference/invisible-behaviors.md §11.6).
Ports: platform OAuth and app SSO, the cleanest OAuth modules in the old codebase (reference/carryover-audit.md A4); the integration config schema and definition storage (A4); the generic platform API caller with the crypto duplication consolidated (B5); the integration-execution services (B25); the Pipedream layer (B23); the Adobe/e-signature stack (B22); OAuth callback routes extracted out of the old monolith (B4c); the affinity writer it calls ports as-is inside `memory/` (reference/carryover-audit.md A9, `memory/integration-affinity.ts` row).
Carried token-refresh semantics for platform connections (reference/invisible-behaviors.md section 3.3, rebuild note - these prevent user-visible false reconnect states and port as stated): (a) refreshes are singleflighted per config id, so a background sweep and a lazy refresh join the same in-flight refresh instead of racing; (b) on `invalid_grant` the refresh re-reads the stored row before flagging - if the credentials changed since read, another leg won, so it returns the current tokens and does not set `needsReauth` (a stale failure must never dead-flag a just-repaired connection); (c) lazy refresh within 60 s of expiry; (d) a boot-time plus hourly proactive sweep (10-minute expiry skew, per-config failure isolation, `needsReauth` rows skipped) keeps refresh tokens exercised so they do not age out unused.
May import: `services/`, `memory/` (the affinity writer only - a listed same-tier edge, see 2.7), `billing/`, `data/`, `config.ts`.

### `memory/`

Responsibility: organizational memory - term-overlap resolver, prompt-section formatter, signals, migration and seeding, tiers and guardrail rules. Consumed by `agents/` (prompt injection) and `automation/` (the action cache is stored as memories). Scope in v1 per P-12 (ch05): CRUD plus resolver injection stay; automatic extraction is off by default and consolidation is deterministic code, so this module makes no model calls.
Ports: the pure resolver/formatter/signals family (reference/carryover-audit.md A9); the memory store following the storage decision (A9, `persistence/memory.ts` row); the extraction/consolidation flows only as reference for the deterministic rewrite (B11, per the call-site fates in reference/llm-usage-map.md §7).
May import: `data/`, `config.ts`.

### `knowledge/`

Responsibility: the legal/firm knowledge base - markdown vault, FTS5 lexical index with ripgrep fallback, ranking, snippets, accent folding, browse, ingest (crawl, upload, extraction, scheduling), and the cited-or-silent grounding block builder consumed by `agents/`. Owns its filesystem vault and SQLite index directly (the explicit exception to the platform storage decision - ch04), including the operational constraints: index volume must persist across restarts, single writer per data directory.
Ports: the whole self-contained search stack, the audit's best carryover candidate (reference/carryover-audit.md A6, including its ops-constraints note); the ingest side (B13); browse/extract/seed and the grounding block builder (Services sweep, `knowledge-browse`/`knowledge-extract`/`knowledge-seed`/`knowledge-prompt` rows).
May import: `services/` (browser pool for crawling), `data/` (sources store), `config.ts`.

### `bridge/`

Responsibility: the daemon-facing side of local file access (chapter 18, in scope this run). The ekoa-local daemon dials out over one outbound WebSocket (it is behind NAT, so the API is the WS server); the channel is TLS, pairing-token authenticated at connect, presence-heartbeated, outbound-only, rate-limited, and revocable server-side. This module holds the tenant-scoped pairing registry with its revoke-pairing kill switch (chapter 18 section 18.3), and dispatches delegated tasks from the hosted agent's `delegate_to_local` tool down the channel, returning derived output only - summaries, citations, patch proposals, ledger refs; raw local content never enters hosted context or persistence (chapter 18 section 18.2). The Anthropic-compatible provider endpoint for bridge completion traffic is the `llm/` gateway sub-app, which routes that traffic through the chokepoint per FIXED-13 with session-identity propagation and pairing-bound auth (chapter 18 section 18.4); a stolen provider credential must not be able to address another tenant's session or vault. This is daemon-to-API transport, explicitly OUTSIDE FIXED-2's frontend no-WebSockets rule - FIXED-2 governs frontend-to-Cortex API transport only, and ch03 states the carve-out. The daemon wire protocol is the compatibility contract, executable as the fake-daemon harness (`api/test/fake-daemon/`, chapter 18 section 18.7), and must remain stable. Everything in `ekoa-code` is in scope; the ekoa-local daemon itself is out of scope, built later against its own brief (chapter 18 section 18.1).
Ports: the carried WS subsystem - connection registry, token auth, zod wire protocol (reference/carryover-audit.md B16) - re-specified and extended per chapter 18 (persisted pairing registry, delegation dispatch, provider-endpoint contract).
May import: `auth/`, `data/`, `config.ts`.

### `streaming/`

Responsibility: the live browser canvas media relay - Playwright CDP screencast frames down and input events up over a WebSocket, for the live browser view shown when an automation pauses for the user. This is the one scoped exception to FIXED-2's no-WebSockets rule, RESOLVED (Q-01) as a media-channel carve-out; the amended FIXED-2 reads "No WebSockets between frontend and Cortex as API transport; one scoped exception exists for the live browser canvas media channel (frames down, input events up, short-TTL token, never JSON API payloads)." The module is built unconditionally (no longer contingent): ch03 section 3.7 canvas endpoint with its 1000/4000 close-code contract, the `streaming_available` automation event, and the ch12 pause-for-user UX all ship. Resolved: Carve-out (a) - scoped media-channel exception, founder, 2026-07-06 (amendment brief, docs/ekoa-code-spec-amendment-brief.md; ch16 Q-01).
Ports: the whole subsystem, conventional WS + CDP code (reference/carryover-audit.md B17).
May import: `auth/`, `config.ts`.

### `events/`

Responsibility: the push infrastructure. The SSE client manager (per-user connections, keepalive, Last-Event-ID replay buffer) serving the four sanctioned SSE endpoints (FIXED-2; ch03 §canon), the durable SQLite event queue with dedup-key idempotency, the trigger delivery pipeline (webhook ingress verification, listener supervisor, platform polling with high-water cursors), and hydrators. Trigger delivery targets - starting an automation run, invoking an artifact backend - are callbacks injected at the composition root, never upward imports (section 2.8). The delivery pipeline and the listener supervisor expose explicit `start()`/`stop()` entry points and are started by `server.ts` only after the HTTP server is listening (boot ordering constraint - see the `server.ts` entry; reference/invisible-behaviors.md section 5.1).
Ports: the SSE manager as-is together with the error sanitizer it applies at egress (reference/carryover-audit.md A2, A7); the SQLite event queue and the pure HMAC verifiers (A11, `persistence/event-queue.ts` and `services/webhook-verifiers.ts` rows); the delivery pipeline with its targets re-pointed (B20).
May import: `integrations/` (platform polling calls the platform API caller), `services/` (error sanitizer), `data/`, `config.ts`.

### `agents/`

Responsibility: Agent SDK execution of user work - job lifecycle (create, validate, billing-gate, run, stream, complete; plus the P-10 persistent job registry and orphan sweep, ch05), context assembly from `content/` composition directories plus memory injection and knowledge grounding, turn classification for chat, and the typed streaming event pipeline including server-side conversion of in-band model markers into typed events (ch05). All model access goes through `llm/` - this module never imports the SDK directly (FIXED-3; section 2.9).
Ports: little verbatim - the old SDK adapter is machinery and is not carried (reference/carryover-audit.md Tier C, `adapters/external.ts` row). What carries: the grounding block builder it consumes from `knowledge/` (Services sweep, `knowledge-prompt` row - the injection point is recomposed here), the in-build answer flow (Services sweep, `in-build-answer` row), and the turn classifier already on the direct client (Services sweep, `turn-classifier` row), all re-pointed at `llm/`.
May import: `llm/`, `content/`, `memory/`, `knowledge/`, `events/`, `billing/`, `data/`, `config.ts`.

### `apps/`

Responsibility: the user-app pipeline (ch07): esbuild bundling, manifest validation, scaffolding, the app registry with dist metadata and file watching, static serving with byte-compatible served-app context injection (`window.__ekoa`, `window.__EKOA_APP_ID` - the 37-spec legal e2e suite hangs on it, reference/test-audit.md §2.4), deterministic slug generation and the slug index, artifact bundle/fork/files/versions, artifact PDF, featured-artifact prebuild and update, app health scanning, and the artifact-backend worker runtime (Layer 2) whose model capability is billed to the artifact owner through `llm/` and whose notify capability is an injected callback (section 2.8).
Ports: the bundling pipeline, manifest, scaffold, and the extracted router templates as-is (reference/carryover-audit.md A3); the registry minus its dead per-app content maps (B2); the static-serving and context-injection blocks extracted from the old monolith (B4); the slug module, deterministic-only per the call-site fate (B3; reference/llm-usage-map.md §7); the artifact-backend runtime with its two seams swapped (B19); bundle/fork/files/pdf/featured/health (B15 and Services sweep rows).
May import: `llm/`, `services/`, `data/`, `config.ts`.

### `automation/`

Responsibility: the vision-first automation engine (resolve loop: cache replay, then vision pinned to the expert tier at maximum effort - there is no tier escalation; reference/invisible-behaviors.md section 13.2, correcting the stale escalation-ladder doc), the deterministic Playwright action runner, page fingerprinting, the memory-backed action/assertion cache, planning and rehearsal, the vision resolve/verify service, the cross-agent catalog, browser sessions (local and daemon-backed via `bridge/`), and the per-step integration/API/local-command runners. Run events are emitted through an emitter callback injected by the caller (a route or the trigger delivery pipeline) - the engine never imports `events/` (section 2.8; the seam the old engine already had, reference/carryover-audit.md B7).
Ports: the pure primitives as-is - action runner, fingerprint, types, template vars (reference/carryover-audit.md A8); the engine with its emitter seam kept and its daemon/integration call sites re-pointed (B7); the cache keyed exactly as today (B8); planner and rehearsal re-pointed at `llm/` (B9); vision re-pointed at `llm/` (B10); catalog, manifest parser, browser sessions, and step runners (B24).
May import: `llm/`, `memory/`, `integrations/`, `bridge/`, `services/`, `data/`, `config.ts`.

### `legal/`

Responsibility: the legal vertical - pure labour-law and court-fee calculators with statute citations, legal research over the knowledge base, CITIUS/eTribunal consultation and parsing, tracking consultation, and the automation templates for the legal flows. Served to apps through the served-app data plane routes (ch03/ch04).
Ports: the dependency-free calculators as-is (reference/carryover-audit.md A11, `legal/simuladores.ts` and `services/tabelas-taxas.ts` rows); the vertical's service family - calculators over app-data, research riding the knowledge stack, CITIUS HTML parsing as-is, eTribunal and connect flows re-pointed at `integrations/` (B21).
May import: `knowledge/`, `integrations/`, `services/`, `data/`, `config.ts`.

### `routes/`

Responsibility: one Express router file per domain from the ch03 resource map (`/auth`, `/users`, `/teams`, `/company`, `/branding`, `/settings`, `/sessions`, `/chat`, `/jobs`, `/artifacts`, `/company-space`, `/integrations`, `/integration-builder`, `/platform-integrations`, `/pipedream`, `/triggers`, `/automations`, `/memories`, `/knowledge`, `/billing`, `/uploads`, `/notifications`, `/demos`, `/health`, plus the served-app data plane and static surfaces). The platform-integrations router additionally owns `GET /api/v1/oauth/:provider/callback` - the path is kept verbatim because it is a registered redirect URI in the Google/Azure/Adobe consoles (ch03 3.8.15). The agent-face routes (`POST /api/v1/agent-face/run`, `POST /api/v1/agent-face/cancel` - ch03 3.10) are a thin router here calling `agents/`; the other two ekoa-local surfaces mount their own sub-apps at the composition root instead of living in `routes/`: the LLM gateway from `llm/` (reference/carryover-audit.md B12) and the bridge token/upgrade routes from `bridge/` (B16). Each route does exactly three things: validate input against the `shared/` schema, call one service or domain module, shape the response per the shared contract - including the SSE endpoints, which attach the client to `events/` and return. No filesystem access, no business logic, no model calls in a route, ever.
Ports: the two already-extracted router files as the structural template (reference/carryover-audit.md A3, `routes/app-files.ts` and `routes/app-cloud-files.ts` rows). The old per-domain code paths are explicitly NOT ported as a shape - their business logic is re-homed into the domain modules above, per the audit's Tier C verdict on the old composition (reference/carryover-audit.md Tier C).
May import: `auth/`, every domain module in this section, `events/`, `billing/` (allowance middleware), `shared/`. Never `data/` directly - persistence access always goes through a domain module or service.

### `server.ts`

Responsibility: the composition root. Builds the Express app, mounts middleware (auth, billing gate, request logging into the single audit write path - FIXED-8), mounts every router, wires the injected seams of section 2.8, runs boot: config validation, license fail-fast gate, data-dir preparation, storage backend selection, first-boot admin seeding, index backfills, scheduled sweeps. The only file allowed to import everything.
Two boot behaviors are carried explicitly because they encode races that were fixed (reference/invisible-behaviors.md section 5.1, rebuild note):
- **Boot ordering constraint (carried).** The trigger delivery pipeline and the listener supervisor in `events/` are started only AFTER the HTTP server is listening - deliberately, so re-entrant deliveries (an automation run started by a trigger can call back into the server it runs in) find a live listener (reference/invisible-behaviors.md section 5.1 step 12). `server.ts` owns this ordering; `events/` exposes explicit `start()` entry points and never self-starts on import.
- **Process-level exception posture (carried).** Global `uncaughtException`/`unhandledRejection` handlers log and continue - the process never crashes on a stray exception; the only fatal paths are the boot validation gate itself and EADDRINUSE at listen (reference/invisible-behaviors.md sections 5.1 item 1 and 5.3). This is a deliberate carried decision, not an omission: without it Node's default crash-on-uncaught would silently change production resilience.
Ports: no code - the old boot composition root is machinery and is rewritten (reference/carryover-audit.md Tier C, `index.ts` row). The boot behaviors worth keeping are re-composed from their audited homes: startup gates and the one-time billing reset rationale (B26), app-data backend selection fail-fast (A5), admin seeding (A11).
May import: everything in `api/src/`.

### `web/` and `shared/` (for completeness)

`web/` is the migrated frontend (FIXED-9): the existing Next.js app moved in, its transport layer replaced by a thin typed REST client generated from `shared/`, dead code removed per the cleanup audit, no visual redesign. ch12 owns the migration map (reference/frontend-cleanup-audit.md). `shared/` holds only zod schemas, inferred types, and the endpoint descriptor maps (ch12 12.2.1), one file per domain, versioned with the repo; both apps consume it, neither extends it with non-contract code (FIXED-1, FIXED-10).

## 2.7 Dependency-direction summary

Imports point strictly downward in this table (a module may import anything in a lower tier that its "may import" list in 2.6 names, and nothing above it or beside it unless listed). The graph is acyclic by construction; diagram `02-module-map` renders it.

| Tier | Modules | May reach down to |
|---|---|---|
| 7 (root) | `server.ts` | everything |
| 6 | `routes/` | all domain modules, `auth/`, `events/`, `billing/`, `shared/` |
| 5 | `agents/`, `automation/`, `apps/`, `legal/` | tiers 4 and below per their 2.6 lists |
| 4 | `events/` | `integrations/`, `services/`, `data/`, `config.ts` |
| 3 | `integrations/`, `memory/`, `knowledge/`, `bridge/`, `streaming/` | `services/`, `llm/` (none do today), `auth/` (bridge, streaming), `memory/` (integrations only - the affinity writer, ch05 5.8; a listed beside-tier edge, acyclic because `memory/` never imports `integrations/`), `billing/`, `data/`, `config.ts` |
| 2 | `llm/`, `services/` | `billing/`, `data/`, `config.ts` |
| 1 | `auth/`, `billing/`, `content/` | `data/`, `config.ts` |
| 0 | `data/`, `config.ts`, `shared/` | `config.ts` (data only); nothing (config, shared) |

Two deliberate absences keep the graph clean:

- Nothing imports `routes/` or `server.ts`. Routers and the root are leaves-in-reverse.
- Nothing below tier 5 imports `agents/`, `automation/`, or `apps/`. Where lower tiers must reach them (trigger delivery, notifications), they call injected callbacks (2.8).

## 2.8 Injected seams (wired in `server.ts`)

Four places where a lower-tier module must cause work in a higher-tier module. Each is a typed callback injected at the composition root - never an upward import. All four seams already exist in the old code and are cited as such:

| Seam | Producer (low) | Consumer (high) | Precedent |
|---|---|---|---|
| Usage-updated notifier | `billing/` tracker | `events/` SSE push | reference/carryover-audit.md B6 (replace the one direct emit with an injected notifier) |
| Automation run event emitter | run caller passes emitter into `automation/` engine | `events/` SSE stream | reference/carryover-audit.md B7 (the engine already takes an injected emitter) |
| Trigger delivery targets | `events/` delivery pipeline | `automation/` run start, `apps/` artifact-backend invoke | reference/carryover-audit.md B20 (re-point the targets per the trigger `target` discriminator) |
| Artifact-backend notify | `apps/` worker runtime | `events/` SSE push | reference/carryover-audit.md B19 (one of the two named seams to swap) |

## 2.9 Lint and CI enforcement

Stated here so it lands in the scaffold and the new repo `CLAUDE.md` on day one:

1. **Repo boundaries (FIXED-1).** ESLint `import/no-restricted-paths` with three zones: `web/**` may not import from `api/**`; `api/**` may not import from `web/**`; `shared/**` may not import from either. CI fails on violation.
2. **Egress chokepoint - one module, three concerns (FIXED-3, FIXED-8, FIXED-13).** ESLint `no-restricted-imports` banning `@anthropic-ai/*` (including `@anthropic-ai/claude-agent-sdk`) everywhere in `api/src/**`, with a single override lifting the ban for `api/src/llm/**`. Belt-and-braces CI step: a grep gate failing the build if `api.anthropic.com` or `@anthropic-ai/` appears in any file outside `api/src/llm/` (catches raw `fetch` calls that the import rule cannot see). This is the structural enforcement of FIXED-13: because `llm/` is the sole importer/instantiator of the Anthropic client, attribution + metering (ch06), the anonymisation pipeline (ch17), and provider routing config all sit on the one egress route with no bypass. Subprocess paths (Agent SDK spawns) are invisible to import lint, so they are pointed at the chokepoint via base URL/env at spawn time - a build-checked invariant (ch06; ch17 section 17.2): no spawn may carry a provider base URL other than the chokepoint's.
3. **Module direction (section 2.7).** ESLint `import/no-restricted-paths` zones encoding the tier table - at minimum: nothing imports `routes/` or `server.ts`; `routes/` does not import `data/`; only `server.ts` imports across the injected seams; nothing outside `api/src/llm/` imports `llm/` internals other than its public entry.
4. **Diagram invariant (FIXED-12).** Not lintable; stated as a standing rule in the new repo `CLAUDE.md`: a structural change without its diagram update is incomplete, and review must reject it.

## 2.10 Acceptance criteria for this chapter

- Every module in section 2.6's one-line index has a detail entry with responsibility, carryover citations, and an exhaustive import list, and no detail entry lacks an index row. (Checkable: 19 entries - `server.ts`, `config.ts`, and 17 directories.)
- The tier table in 2.7 is a valid topological order of the union of all "may import" lists (checkable mechanically).
- P-01, P-02, and P-17 are RESOLVED (sections 2.4, 2.5, 2.3): each states its normative decision, its rationale, a one-line rejected-alternative note, and a resolution attribution. P-16 is RESOLVED in 2.2 (repository name `ekoa-code`).
- The three lint rules in 2.9 are specific enough to be written as ESLint config without further decisions; rule 2 covers the FIXED-13 one-module-three-concerns enforcement including the subprocess base-URL invariant.

Cross-references: diagram `spec/diagrams/02-module-map`; ch03 (endpoint inventory behind `routes/`), ch04 (`data/` internals), ch05 (`agents/`), ch06 (`llm/` and `billing/`), ch07 (`apps/`), ch08 (`content/` and the Garrison boundary), ch09 (enforcement homes for every invariant), ch12 (`web/`), ch16 (Q-01, resolved as the `streaming/` media-channel carve-out), ch17 (the anonymisation pipeline inside `llm/`), ch18 (`bridge/`, delegation, and the provider endpoint).

Amendment record: amended 2026-07-06 per founder resolutions and the anonymisation/local-file-access amendment (docs/ekoa-code-spec-amendment-brief.md) - P-01/P-02/P-16/P-17 resolved, `llm/` re-cast as the one-module-three-concerns egress module (FIXED-13), `bridge/` and `streaming/` moved from reserved/contingent to in-scope-and-built (chapters 18 and Q-01).
