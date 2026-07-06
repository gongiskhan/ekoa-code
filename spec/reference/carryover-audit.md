# Carryover Audit - Cortex Modules Portable to a Conventional Node+TS REST Service

**Purpose.** This document inventories the modules of `cortex/src` (the ekoa backend) that can carry over into a ground-up rebuild as a conventional Node.js + TypeScript REST service with minimal change, because they are already conventional code uncoupled from the content-driven machinery (skills/instructions/recipes dispatch, the Claude Agent SDK adapter, the governed-tool registry). Each candidate gets a coupling assessment and a verdict - **port-as-is** (drop-in module, trivial import fixes only), **adapt** (works today but a named seam must be swapped), or **rewrite** (logic entangled with machinery being discarded; NOT carryover). Candidates are ordered by confidence: port-as-is first, then adapt, then the rewrite list for completeness. The expected candidates from the rebuild brief (esbuild bundling + static serving, OAuth/credential management, Firestore access layer, anonymisation, GCE deploy scripts) are each explicitly dispositioned, alongside everything else found in the sweep.

**Method:** derived from source code at commit HEAD (3882aa6), `/Users/bazinga/dev/ekoa-dev/cortex/src`; docs (CLAUDE.md, `docs/`) treated as hints only; every claim cited as `file:line`; doc/code contradictions recorded in the Conflicts section, never silently resolved. LOC = physical lines (`wc -l`). Evidence from one finder sweep, independently spot-verified against the code (verified items noted; one finder miscount corrected - see S2 below). A subsequent verification/fixer pass (all claims re-checked against code) added dispositions for subsystems the first sweep left unverdicted - `bridge/`, `streaming/`, `services/github/` + `tools/vcs`, artifact backends (Layer 2), the Layer-1 event-dispatch family, the legal/CITIUS vertical, the Adobe e-signature stack, `services/pipedream.ts`, `services/app-sso.ts`, boot modules, a per-candidate sweep of every remaining service, and the agent-tool Tier C entries (see A4/A11 additions, B16-B26, the Services Sweep section, and Tier C) - and corrected one citation off-by-one (Conflict 9).

---

## 0. The four coupling seams that decide every verdict

Nearly every module's portability is decided by whether it touches one of four cross-cutting seams. Named once here, referenced throughout.

| Seam | What it is | Portability consequence |
|---|---|---|
| **S1 - `callSimpleLlm`** | The one-shot LLM helper routed through the Claude Agent SDK adapter (`cortex/src/adapters/external.ts:1615`, verified). Plain `{system, message, tier, imageAttachments, billing*}` options object -> string. Callers (grep of `callSimpleLlm` across src): memory/consolidation, memory/auto-extractor, automation/rehearsal, automation/planner, apps/compiler, handlers/execute-handler, apps/handler, services/orchestrator, services/slug-generator, services/in-build-answer, services/turn-classifier, services/vision, services/artifact-backend/runtime. | S1-coupled modules are **adapt**, not rewrite: `anthropic-client.ts` (140 LOC, plain `fetch` to the Messages API on the same managed OAuth token, `anthropic-client.ts:12`) is a near-drop-in replacement. |
| **S2 - `sseManager`** | The SSE fan-out singleton (`cortex/src/sse.ts:233`). Non-test importers (verified grep, **9**, not the 7 the finder counted): `server.ts`, `index.ts`, `adapters/external.ts`, `agent-face/index.ts`, `handlers/integration-builder-handler.ts`, `handlers/billing-handler.ts`, `services/orchestrator.ts`, `services/artifact-backend/runtime.ts`, `billing/tracker.ts`. | Most audited modules do NOT touch it. Where a portable module does (billing/tracker has exactly one emit), replace with an injected notifier callback. |
| **S3 - `ToolExecutionContext`** | A 4-field inert struct `{userId, userRole, userScopes, traceId}` (`cortex/src/tools/registry.ts:19-24`). | Tools that take it (crypto, jwt, platform-integration-call) are functionally free of the governed-tool registry - strip the param or keep the struct. Cosmetic coupling only. |
| **S4 - JsonStore singletons** | `cortex/src/persistence/store.ts` - mutex-serialized atomic-rename JSON files (`store.ts:1-40`). | Conventional code, but the rebuild will likely choose a real DB. Store-backed modules are "port-as-is if JsonStore is kept, adapt if not". One decision, made once, cascades to every S4 module. |

---

## Tier A - Port as-is (highest confidence)

### A1. Auth (JWT)

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `auth.ts` | 72 | `jsonwebtoken`, express `Request` type, `config` only (`auth.ts:1-3`) | `extractBearerToken` / `verifyToken` -> `UserContext {id, role, scopes, companyId, username?}` / `signToken`. Dependents are wide (llm-gateway, server, bridge/server, streaming, sessions, ~all handlers) but the module itself imports nothing content-driven. Becomes standard Express middleware in the rebuild. |
| `tools/jwt.ts` | 36 | S3 only (`tools/jwt.ts:5-7`) | Redundant governed-tool wrapper over the same `jsonwebtoken` + config. **Fold into auth.ts.** |

### A2. SSE client manager

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `sse.ts` | 233 | `uuid`, express `Response` type, `services/error-sanitizer` (`sse.ts:1-3`, verified) | Per-user client map, `sendToUser`/`broadcast`, 30s keepalive, 200-event per-trace ring buffer for Last-Event-ID replay, 5-min buffer sweep. Does NOT import protocol.ts or any dispatch machinery. It IS the event bus, but the implementation is conventional Express SSE - a rebuild keeping SSE for streaming lifts it verbatim (bring error-sanitizer with it, A7). |

### A3. esbuild bundling (core of the "esbuild + static serving" brief candidate)

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `app-builder.ts` | 745 | `esbuild`, node fs/path, `app-manifest` ONLY (`app-builder.ts:15-20`). Zero content-machinery imports. | 9 dependents (index, server, tools/build, execute-handler, artifacts-handler, artifact-bundle/fork, featured-artifact-builder, featured-update). The bundling pipeline itself is fully conventional. |
| `app-manifest.ts` | 275 | zod + fs only | Manifest schema + validation. |
| `app-scaffold.ts` | 179 | fs + `data/scaffold-templates/` | Scaffold copier. Bring the scaffold-templates data directory along. |
| `routes/app-files.ts` | 128 | conventional Express router | Already-extracted route module - the structural template the rebuild's routers should follow. |
| `routes/app-cloud-files.ts` | 146 | conventional Express router | Same. |
| `persistence/app-files.ts` | 102 | fs | Backing store for app-files route. |

(The static-serving route block inside server.ts is **adapt** - see B4.)

### A4. OAuth + credential management (brief candidate)

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `services/platform-oauth.ts` | 484 | ONLY `jose` + `config` (`platform-oauth.ts:12-13`, verified) | Google/Microsoft/Adobe auth-URL builders, code exchange, `refreshGoogleToken`/`refreshMicrosoftToken`. Cleanest OAuth module in the codebase. |
| `services/app-sso.ts` | 369 | ONLY node:crypto + `jose` + `config` (`app-sso.ts:19-21`, verified) | End-user SSO for served artifacts (`window.__ekoa.signIn`; pinned doc `docs/integrations-in-artifacts.md`) - Microsoft OIDC authorization-code + PKCE, deliberately separate from platform-oauth (different Azure registration `microsoftSso`, id_token path, never touches the workspace's stored token; dynamic per-tenant issuer validation pinned on audience+nonce+signature, `app-sso.ts:1-17`, verified header). Same near-zero coupling class as platform-oauth. Added by the verification pass - was previously undispositioned. |
| `services/claude-auth.ts` | 594 | config + supabase-client only (`claude-auth.ts:18-23`, verified) | Managed Claude OAuth: Supabase-backed get/refresh, watchdog tick, `onTokenRefreshed`/`onAuthPermanentFailure` callback hooks (`claude-auth.ts:78-104,196-247`). Failure broadcast is done by the callback consumer, not here - the seam is already right. |
| `tools/crypto.ts` | 112 | bcryptjs + node AES-256-GCM; S3 only (`crypto.ts:7`) | **Security flag for the rebuild:** hardcoded dev fallback key `'default-dev-encryption-key-32ch!'` when `ENCRYPTION_KEY` unset (`crypto.ts:15`, verified). Make the key mandatory in the rebuild. Strip S3. |
| `persistence/integrations.ts` | 44 | S4 | `StoredIntegrationConfig` with `credentials?: string // encrypted`, `needsReauth`, `ownerUserId` ownership model (`integrations.ts:5-30`). Schema ports as-is; storage backend follows the S4 decision. |
| `services/integration-storage.ts` | 586 | node fs/path ONLY (`integration-storage.ts:17-21`, zero relative imports) | Skill-file storage (SKILL.md + config.json per key; versioned `ekoa-data/integrations/` + runtime `~/.ekoa/data/integration-skills/`, runtime overrides versioned). Content-*shaped* (markdown skills) but mechanically a plain file store. Ports as-is mechanically; whether "skill markdown" survives the rebuild is a product decision, not a coupling problem. |

(OAuth *callback routes* inlined in server.ts and the generic platform API caller are **adapt** - see B4/B5.)

### A5. Firestore / Supabase access layers (brief candidate)

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `services/supabase-client.ts` | 212 | config only | Raw-`fetch` REST client for `standalone_credentials`/`companies`/`installations`, no `@supabase/supabase-js` dependency, 10s timeouts (`supabase-client.ts:1-50`). |
| `persistence/app-data-backend.ts` | 61 | none | The `StorageBackend` contract. Keep verbatim - it is already a ports-and-adapters seam. |
| `persistence/app-data-fs.ts` | 129 | fs + contract | Filesystem default backend. |
| `persistence/app-data-mongo.ts` | 184 | `mongodb` driver + contract only (`app-data-mongo.ts:1-4`) | **Firestore via the MongoDB-compatibility driver - the production backend.** Backend selected fail-fast at boot (`index.ts:128-137`, verified: "fs default; mongo = Firestore with MongoDB compatibility in prod"). |
| `persistence/app-data.ts` | 140 | facade over the above | Async facade with backend selection (`initAppDataBackend`/`getAppDataBackend`). |
| `persistence/app-data-migration.ts` + `services/app-data-migration.ts` + `services/app-data-backups.ts` | - | fs/backend contract | App-data migration + backup/restore siblings, found during verification (not in the finder sweep - include, do not drop). Conventional; follow the family. |

**Recorded contradiction (see Conflicts):** CLAUDE.md claims "All data stored as JSON files at `~/.ekoa/data/` via the JsonStore layer" - false for app-data in production. Domain stores DO remain JsonStore.

### A6. Knowledge subsystem (best carryover candidate in the codebase)

Self-contained lexical-search stack. Consumed BY the agent machinery (`tools/knowledge-search.ts`, `adapters/knowledge-mcp.ts`, `handlers/knowledge-handler.ts`, `services/knowledge-prompt.ts`) but importing none of it.

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `services/knowledge-fts.ts` | 486 | better-sqlite3 + sibling knowledge-* modules + persistence/knowledge only (`knowledge-fts.ts:27-38`) | FTS5 index over the markdown vault; registers write/delete hooks via `setKnowledgeIndexHooks` (`knowledge-fts.ts:37,430-435`); `ready`-flag gating. |
| `services/knowledge-ripgrep.ts` | 255 | `@vscode/ripgrep` (`knowledge-ripgrep.ts:30-40`) | Fallback scan. **Stale header** - claims it is "the SOLE search backend (no inverted index)" (`knowledge-ripgrep.ts:2-3`, verified); FTS5 is preferred (see Conflicts). |
| `services/knowledge-search.ts` | 88 | the two backends (`knowledge-search.ts:22-23`, verified) | Facade preferring FTS when `ftsReady`. |
| `services/knowledge-ranking.ts` | 55 | pure | bm25 x collection-authority multiplier. |
| `services/knowledge-snippet.ts` | 39 | pure | |
| `services/knowledge-tokenize.ts` | 38 | pure | |
| `services/knowledge-accents.ts` | 81 | pure | Accent folding. |
| `services/knowledge-frontmatter.ts` | 217 | pure | |
| `services/knowledge-paths.ts` | 31 | config | |
| `persistence/knowledge.ts` | 180 | fs | Markdown vault with per-doc locks + the hook indirection (`knowledge.ts:64-79`) - clean observer pattern, no reverse dependency on FTS. |

**Ops constraints to carry into the rebuild spec:** index at `~/.ekoa/data/knowledge/index.db` (~6GB + WAL for the ~254k-doc corpus); ~9-min backfill re-runs on every boot if the volume does not persist; single-writer per data dir.

(The ingest side - crawl/upload/scheduler - is **adapt**, see B8.)

### A7. Anonymisation / sanitisation (brief candidate) - and: there is NO Presidio

Grep for `presidio` across `cortex/src`: **zero hits** (verified). No external anonymisation service exists - do not spec one into the rebuild. What exists is three small pure modules:

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `memory/anonymizer.ts` | 53 | zero imports (verified) | Regex PII strip (URLs/paths/emails/IPs/ports/tokens/UUIDs -> placeholders) (`anonymizer.ts:7-22`). |
| `services/error-sanitizer.ts` | 104 | zero imports (verified) | Provider-leak scrub - hard requirement that users never see "Claude/Anthropic" or provider-auth text; substring markers -> wholesale replacement with a brand-safe message; applied at the SSE egress chokepoint (`error-sanitizer.ts:1-45`, consumed at `sse.ts:3`). **Must carry over - it encodes a production incident.** A client-side twin exists at `ekoa/lib/sanitize-error.ts`; keep both layers. |
| `services/commit-guard.ts` | 217 | pure | Secret-commit blocker for the git-as-record pipeline. |

### A8. Automation primitives

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `automation/executor.ts` | 308 | Playwright types + `automation/types` ONLY (`executor.ts:11-12`, verified) | Pure deterministic Playwright action runner. |
| `automation/fingerprint.ts` | 146 | node crypto + Playwright Page + types (`fingerprint.ts:18-20`, verified) | Page-fingerprint hashing. Pure. |
| `automation/types.ts` | - | pure | |
| `automation/template-vars.ts`, `automation/command-shape.ts`, `automation/self-url.ts`, `automation/platform-primitives.ts` | - | pure/config-only | |
| `services/browser-pool.ts` | 54 | zero imports (verified) | Lazy shared headless Chromium, concurrent-launch guard, process-exit cleanup (`browser-pool.ts:14-40`). Its header records it was "extracted from `template-screenshot.ts`" (`browser-pool.ts:10-12`, verified) - historical confirmation the template services were folded away (see Conflicts). |

### A9. Memory subsystem (pure parts)

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `memory/resolver.ts` | 269 | `memoryStore` + formatter only (`resolver.ts:11-12`) | Pure term-overlap scoring. Dependents: automation engine/cache, execute-handler, automations-handler, signals. Store swap follows S4. |
| `memory/formatter.ts` | 84 | pure | Prompt-section rendering incl. guardrail `RULE:` entries. |
| `memory/signals.ts` | 80 | store + resolver | |
| `memory/migration.ts` | 89 | store + fs | |
| `memory/seed.ts` | 142 | store + fs | |
| `memory/integration-affinity.ts` | 109 | store | |
| `persistence/memory.ts` | 66 | S4 | Follows the S4 decision. |

The *injection point* (resolveMemories woven into every prompt) lives in `adapters/external.ts` - that composition is rebuild-specific, but the subsystem it calls is portable.

### A10. Screenshots / artifacts capture

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `services/artifact-screenshot.ts` | 162 | config-only imports (`artifact-screenshot.ts:15-17`) | Headless Playwright capture of built artifacts to `~/.ekoa/data/artifact-screenshots/{instanceId}.png`, lazy browser. This is the living replacement for the CLAUDE.md-documented template-screenshot service (see Conflicts). |

### A11. Miscellaneous conventional modules (found in sweep - include, do not drop)

| Module | LOC | Coupling | Notes |
|---|---|---|---|
| `persistence/event-queue.ts` | 426 | better-sqlite3 + node only (`event-queue.ts:1-25`, verified) | Durable SQLite WAL queue for webhook/listener events at `~/.ekoa/data/triggers.db`; `UNIQUE(trigger_id, dedup_key)` is the entire idempotency mechanism; crash recovery of stuck `dispatching` rows; `webhook_audit` table. |
| `services/webhook-verifiers.ts` | 236 | node crypto + one type import (`webhook-verifiers.ts:16-17`, verified) | Pure HMAC signature algorithms. |
| `services/url-safety.ts` | 59 | zero imports (verified) | SSRF guard. |
| `llm-router.ts` | 432 | **zero imports** (verified: `grep -c "^import"` = 0) | Pure keyword/heuristic 4-tier classifier + model config table. Hardcodes Anthropic model IDs - a config concern, not a coupling one. |
| `anthropic-client.ts` | 140 | config + claude-auth | Plain-fetch Messages API on managed OAuth (`anthropic-client.ts:12`); currently used by turn-classifier and visual-vibe. **The designated S1 replacement** - porting it unlocks every "adapt (S1)" verdict below. |
| `legal/simuladores.ts` | 244 | zero imports (verified) | Pure dependency-free labour-law calculators with `legalRef` citations. |
| `services/tabelas-taxas.ts` | 158 | **zero imports** (verified: `grep -c "^import"` = 0) | Pure court-fees/rates tables + calculators - the exact same dependency-free class as `legal/simuladores.ts`. Consumed by the legal vertical (B21). Clear port-as-is; was previously undispositioned. |
| `config.ts` | 191 | dotenv + node os/path only (`config.ts:1-3`, verified) | The env-derived config singleton - the single most-imported conventional module in the codebase (a dependency of nearly every Tier A row). Ports as-is; the rebuild re-keys whichever env names it keeps. |
| `bootstrap.ts` | 41 | uuid + bcryptjs + `userStore` (`bootstrap.ts:1-3`, verified) | First-boot admin-user seeding. S4 store; trivial. |
| `tools/license.ts` | 95 | config + supabase-client; S3 (`license.ts:6-14`, verified) | Supabase-backed license validation against `companies`/`installations`. Conventional; strip S3. |
| `tools/device-auth.ts` | 196 | node:crypto; S3 only (`device-auth.ts:17-18`, verified) | Device-login code-flow primitives. Strip S3. |
| `tools/files.ts` | 52 | node fs/promises; S3 only (`files.ts:5-6`, verified) | Governed read/write/stat wrapper - trivial; fold into whatever fs helper the rebuild keeps. |
| `tools/build.ts` | 85 | `app-builder` + node path/os (`build.ts:11-13`, verified) | Thin wrapper over A3's `appBuilder` - folds into the A3 pipeline; the governed-tool shell is dropped with the registry (Tier C). |
| `sessions.ts` | 199 | fs (JSON files) | Chat history/context. S4-style decision. |
| `persistence/*` domain stores generally | - | S4 | Conventional JsonStore singletons; all follow the one S4 decision. |

---

## Tier B - Adapt (named seam swap; keep the logic, re-point the seam)

| # | Module | LOC | Seam(s) to swap | Verdict rationale |
|---|---|---|---|---|
| B1 | `protocol.ts` | 586 | trim WS-era vestiges | Pure zod, single import (`protocol.ts:10`). The `ServerEvent` union (`protocol.ts:475-511`) is the de-facto SSE wire contract the frontend consumes (`ekoa/lib/cortex/connection.ts:152-170`) - carry it over as the API contract. **Must trim:** `ClientMessageSchema`'s `auth` (`protocol.ts:15`) / `file_upload` (`protocol.ts:24`) variants (verified) are WebSocket-era vestiges - auth is HTTP JWT, uploads are `POST /api/v1/upload`. Recorded in Conflicts; do not port blindly. |
| B2 | `app-registry.ts` | 477 | drop skills/recipes map loading | chokidar + fs + app-manifest (`app-registry.ts:13-17`). Mild content coupling: also loads per-app `skills/` markdown and `recipes/` JSON into maps (`RegisteredApp.skills/recipes`, `app-registry.ts:40-41`, getters `:154-162`) for the recipe engine. The registry/watch/dist-serving core is independent of that - keep registry + chokidar + dist metadata; delete or stub the skills/recipes maps if the recipe layer is dropped. |
| B3 | `services/slug-generator.ts` | 191 | S1, S4 | Haiku slug generation via `callSimpleLlm` (`slug-generator.ts:12`) with a deterministic fallback; `artifactInstanceStore`. The in-memory slug index (`loadSlugIndex`/`getAppIdBySlug`/`indexSlug`, `slug-generator.ts:24-53`) is pure. Swap S1 for `anthropic-client` or ship deterministic-only. |
| B4 | server.ts route blocks | ~500 of 3606 | extract to Express routers | Conventional logic inlined in the monolith: (a) static app serving `/apps/:appId/*` (`server.ts:3417`) - trailing-slash redirect, slug->canonical-id via `getAppIdBySlug` (`:3436`), shareability gate via `lookupShareable` on document requests only (`:3447`), then static serving; `injectAppContext()` (`server.ts:2932`) stamps `window.__EKOA_APP_ID` + the `window.__ekoa` fetch wrapper (`X-Ekoa-App-Id` header scoping; "tokens are deliberately absent" per the comment above `:2932`) + demo-bridge into served HTML; also `/build/:slug` (`:3233`), download zip (`:3303`), screenshot/pdf statics (`:227-267`). (b) App-data HTTP surface `/api/app-data/*` (`server.ts:2474-2534`), `/api/app-shared/*` (`:2583-2642`) - `X-Ekoa-App-Id` scoping, no JWT. (c) OAuth callbacks (`server.ts:687-838`) - Google/Microsoft/Adobe callbacks call `encryptCredential` directly with a synthesized system context (`server.ts:719,774,838`) then persist to integrationStore. The extraction pattern already exists: `routes/app-files.ts` / `routes/app-cloud-files.ts` (A3). |
| B5 | `tools/platform-integration-call.ts` | 542 | S3, S4, crypto dedupe | Generic Google/Microsoft API caller with in-band OAuth refresh + hourly `refreshExpiringPlatformTokens` sweep. Deps: S3, `integrationStore`, `platform-oauth` (`platform-integration-call.ts:15-18`). Note: re-implements AES-GCM decrypt inline (`:14`) instead of reusing `tools/crypto` - consolidate in the rebuild. |
| B6 | `billing/` (constants 117, tracker 280, middleware 134, hook 34) + `persistence/billing.ts` (79) | 644 | S4 + one S2 emit | Conventional accounting logic. `constants.ts` imports only `LlmTier` (`constants.ts:5`). `tracker.ts` touches S2 exactly once: `sseManager.sendToUser(..., {type:'usage_updated'})` (`tracker.ts:12,208`, verified) - replace with an injected notifier. `middleware.ts` (pre-turn allowance gate, `middleware.ts:9-11`) is a natural Express middleware. **Stale header:** tracker still claims char-based estimation (`tracker.ts:4-6`, verified) but real SDK token counts are recorded (reset rationale `startup.ts:25-35`, verified) - see Conflicts. |
| B7 | `automation/engine.ts` | 2056 | bridge, integration-executor, memory-store call sites | Heavy deps: bridge `getBridgeConnection` (`engine.ts:27`), local/daemon browser sessions (`:28-33`), vision (`:34-39`), integration-action-executor (`:40`), platform-integration-call (`:41`), memory resolver (`:43`), automation/run stores (`:44-48`), cache (`:49-54`), rehearsal (`:55-60`). Crucially, events are emitted via an injected `RunEventEmitter` callback (`options.emit`, `engine.ts:196,291,401-458`, verified) - NOT via sseManager directly; the seam is already right. The three-tier loop, pause/consent/rehearsal semantics, and emitter seam carry over; the daemon-bridge and integration-executor call sites must be re-pointed. Not a rewrite: no recipe/skill/dispatch imports anywhere in it. The bridge subsystem itself is dispositioned at B16, the browser-session modules at B24, integration-action-executor at B25. |
| B8 | `automation/cache.ts` | 334 | memory-store | Action/assertion cache stored AS memories tagged `automation:<id>` via `memoryStore` + `memory/resolver.listMemoriesByEntity` (`cache.ts:18-19`). Either keep the memory store or give the cache its own table; the keying logic (fingerprintKey) ports unchanged. |
| B9 | `automation/planner.ts`, `automation/rehearsal.ts` | - | S1 | Grep confirms `callSimpleLlm` usage. Swap for anthropic-client. |
| B10 | `services/vision.ts` | 610 | S1 only (`vision.ts:18-24`) | Screenshot -> action resolve/verify prompts. Swap S1 for direct Anthropic vision calls. |
| B11 | `memory/auto-extractor.ts` (333), `memory/consolidation.ts` (336) | 669 | S1 (`auto-extractor.ts:12-16`, `consolidation.ts:15-19`) | Haiku extraction/merge flows; logic conventional. |
| B12 | `llm-gateway.ts` | 530 | billing + auth seams | Already a conventional Express sub-app (express + claude-auth + auth + router + billing tracker, `llm-gateway.ts:23-37`). |
| B13 | Knowledge ingest side: `knowledge-crawl.ts` (850), `knowledge-ingest.ts` (162), plus upload/scheduler/domino/api-ingest/tls/boilerplate siblings | ~1500+ | browser-pool, config, fs | Conventional services keyed off config + fs; crawl uses browser-pool (A8). Larger surface, hence adapt rather than as-is. |
| B14 | `persistence/store.ts` (194) + all S4 domain stores | - | the one DB decision | The JsonStore base itself is conventional (mutex + atomic-rename, `store.ts:1-40`). The rebuild must decide DB-vs-files ONCE; every S4 module then follows mechanically. |
| B15 | `services/artifact-pdf.ts`, `services/featured-artifact-builder.ts` | - | follow deps | Conventional; depend on app-builder/app-registry/browser-pool - adapt alongside B2. |
| B16 | `bridge/` subsystem: `server.ts` (223), `connection.ts` (327), `protocol.ts` (153), `registry.ts` (78), `auth.ts` (89) | 870 | the daemon wire protocol (`bridge/protocol.ts` zod schemas) is the compatibility contract; token secret from config | WS control-channel server for the ekoa-local daemon - the daemon DIALS OUT to Cortex through NAT, so Cortex is the WS server (`bridge/server.ts:1-17`, verified header); `noServer:true` + `httpServer.on('upgrade')` scoped to `/api/v1/bridge/connect/<connectionId>`, token auth via `bridge/auth.ts` (jsonwebtoken + config only, `bridge/auth.ts:10-11`) - `Authorization: Bearer` header, with `?token=` accepted only as a transition fallback (leaks into proxy logs, per header comment). `connection.ts` imports node:crypto only; `protocol.ts` is pure zod; `registry.ts` is a connection map. Conventional `ws` code throughout - port the transport, keep the daemon protocol stable. Consumed by B7 (`getBridgeConnection`, `engine.ts:27`), B24, and A1's dependents list. |
| B17 | `streaming/` subsystem: `index.ts` (187), `session.ts` (375), `cdp.ts` (110), `protocol.ts` (92), `auth.ts` (60), `registry.ts` (33) | 857 | HTTP-upgrade wiring in server.ts | Remote-browser display: Playwright CDP screencast relayed over WS. `index.ts` imports node:http, `ws`, playwright `Page` types + local siblings ONLY (`streaming/index.ts:1-11`, verified); `auth.ts` is jsonwebtoken + config (`streaming/auth.ts:1-2`); `protocol.ts` pure zod; `cdp.ts` playwright types only. Conventional WS + CDP code; port alongside B16 (bridge/server is explicitly modeled on `attachWebSocketServer` here). |
| B18 | GitHub git-as-record pipeline: `services/github/provider.ts` (176), `repos.ts` (204), `backup.ts` (104), `fork.ts` (85), `git-remote.ts` (83) + `tools/vcs.ts` (349) | 1001 | S3 on vcs.ts (strip); provider selected by env | `provider.ts` imports ONLY node:fs + jsonwebtoken (`provider.ts:22-23`, verified) - GitHub App RS256 JWT + PAT dev path behind a two-method interface (`provider.ts:1-10`); **port-as-is**. `repos.ts`/`fork.ts` are REST-over-fetch on the provider; `git-remote.ts`/`backup.ts` use isomorphic-git + `repo-lock` (`backup.ts:18-23`, `git-remote.ts:13-15`). `tools/vcs.ts` is the governed-tool wrapper over isomorphic-git + `commit-guard` (A7) + `repo-lock` (`vcs.ts:12-19`, verified) - keep the functions, drop the registry shell (Tier C). The first sweep dispositioned only the guard (A7, "for the git-as-record pipeline"); the pipeline itself carries over. |
| B19 | Artifact backends (Layer 2): `services/artifact-backend/runtime.ts` (753), `handle-rpc.ts` (272), `worker-bootstrap.ts` (154), `services/artifact-backend-manifest.ts` (38) | 1217 | S1 (runtime is a `callSimpleLlm` caller - the `ekoa.llm` capability) + S2 (runtime imports sseManager for notify) | The **pinned** Layer-2 feature (`docs/artifact-backends.md`) - artifact-owned server-side code behind the credential-free `ekoa` handle; silently dropping it loses the whole capability. Beyond S1/S2 the coupling is node built-ins: `runtime.ts` imports node worker_threads/fs/os/path/url + its two siblings (`runtime.ts:18-24`, verified); `handle-rpc.ts` = jsonwebtoken + config + the app-data facade/contract (verified imports); `worker-bootstrap.ts` is core-owned CommonJS shipped as an eval-string so it runs identically under tsx/dist/vitest - explicitly "NOT artifact code" (`worker-bootstrap.ts:1-8`, verified); `artifact-backend-manifest.ts` = fs + app-manifest + artifacts store. Swap the two seams; the worker_threads isolation, per-artifact serialization, and RPC protocol carry over. Previously appeared only as an S1 caller / S2 importer in the seams table - no verdict row. |
| B20 | Event-sourcing Layer-1 dispatch: `services/trigger-dispatcher.ts` (294), `services/listener-supervisor.ts` (289), `services/event-sources/platform-poll.ts` (443), `email-hydrate.ts` (246), `whatsapp-hydrate.ts` (185), `services/webhook-self-test.ts` (131), `persistence/triggers.ts` (141) | 1729 | call sites into the automation engine (`runAutomation`) + artifact-backend runtime (`trigger-dispatcher.ts:39-40`, verified) + `callPlatformIntegration` (B5); S4 for triggers store | The watch->dedup->dispatch pipeline around A11's `event-queue.ts` - the first sweep covered only the queue + `webhook-verifiers`. `platform-poll.ts` imports ONLY event-queue + trigger types (`platform-poll.ts:32-33`, verified); hydrators import triggers store + platform-poll types; `webhook-self-test.ts` = node:crypto + config + triggers store + tools/crypto + integration-storage; `persistence/triggers.ts` = node + JsonStore (S4). Conventional dispatch logic; re-point the engine/runtime targets per the trigger `target` discriminator. |
| B21 | Legal/CITIUS vertical: `services/legal-calculos.ts` (276), `legal-research.ts` (252), `citius-connect.ts` (297), `citius-consulta.ts` (199), `citius-etribunal.ts` (648), `citius-automation-templates.ts` (102) | 1774 | app-data store (S4), A6 knowledge backends, integration-storage/action-executor call sites | Previously only `legal/simuladores.ts` (A11) had a verdict; `tabelas-taxas.ts` moves to A11 (pure). `legal-calculos.ts` imports only node fs/path/url + `persistence/app-data` (`legal-calculos.ts:24-27`, verified) - adapt (S4/app-data). `legal-research.ts` = knowledge-fts + ripgrep types only (`legal-research.ts:32-33`) - rides A6. `citius-consulta.ts` imports cheerio ONLY (verified) - **port-as-is** (pure CITIUS HTML parsing). `citius-etribunal.ts` (cheerio + citius-consulta + integration-action-executor + integration-storage, verified) and `citius-connect.ts` (integration-storage only) - adapt with B25. `citius-automation-templates.ts` (automation types + integration-automations) - adapt; named in Conflict 2 yet previously undispositioned. |
| B22 | Adobe/e-signature stack: `services/adobe-sign.ts` (596), `adobe-webhook.ts` (114), `signature-provider.ts` (149), `cmd-signature.ts` (44), `persistence/adobe-agreements.ts` (35) | 938 | integrationStore (S4), tools/crypto, platform-oauth `refreshAdobeToken` (A4), browser-pool (A8), artifact-pdf (B15) | The agreement/e-sign services built on A4's Adobe OAuth pieces (A4 covered only auth-URL/refresh inside platform-oauth). `adobe-sign.ts` imports integrationStore + tools/crypto + platform-oauth + browser-pool + artifact-pdf (`adobe-sign.ts:32-37`, verified) - adapt. `adobe-webhook.ts` has **zero imports** (verified) - pure inbound-webhook business logic with injected deps, replay-safe/idempotent per its header (`adobe-webhook.ts:1-25`) - port-as-is. `signature-provider.ts` = facade over adobe-sign + cmd-signature (verified imports); `cmd-signature.ts` = type-only imports (CMD provider stub); `persistence/adobe-agreements.ts` = S4 store. |
| B23 | `services/pipedream.ts` | 491 | S3, S4 (integrations + settings stores), billing hooks (`pipedream.ts:29-35`, verified) | The Pipedream Connect layer (extended external connections beyond native integrations; `ekoa.pipedream` domain per CLAUDE.md). Conventional REST-over-fetch + encrypted credential storage + billing metering. Previously absent from the audit entirely. |
| B24 | Automation family completion (absent from A8/B7): `automation/catalog.ts` (394), `manifest-parser.ts` (175), `browser-session.ts` (293), `local-browser-session.ts` (203), `executors/api-call.ts` (216), `executors/ekoa-action.ts` (239), `executors/local-command.ts` (274) | 1794 | bridge (B16), integration-action-executor (B25), engine `RunContext`, S4 stores, app-registry (B2) | `manifest-parser.ts` = node crypto/fs + js-yaml + platform-primitives (`manifest-parser.ts:30-33`, verified) - **port-as-is**. `catalog.ts` (cross-agent catalog builder) = automation/run/artifact stores + integration-storage + platform-integration-call + app-registry + manifest-parser (`catalog.ts:15-24`, verified) - adapt. `browser-session.ts` = the `BrowserSession` interface + the bridge-backed daemon implementation (imports bridge connection/protocol, `browser-session.ts:32-35`, verified) - adapt with B16. `local-browser-session.ts` = playwright + executor/fingerprint (A8) + automation-browser (sweep table) - port once automation-browser lands. `executors/api-call.ts` (engine RunContext + `loadDecryptedCredentialFields` from integration-action-executor, `api-call.ts:20-22`), `executors/ekoa-action.ts` (slug-generator + app-registry, `ekoa-action.ts:23-24`), `executors/local-command.ts` (bridge `getBridgeConnection` + users store, `local-command.ts:26-27`, all verified) - adapt. B7 named the session modules only as engine call sites; these are their own verdicts. |
| B25 | Integration-execution services: `services/integration-action-executor.ts` (675), `integration-session-capture.ts` (178), `integration-agent.ts` (454), `integration-automation.ts` (191), `integration-automations.ts` (809), `integration-inference.ts` (49) | 2356 | integrationStore/automation stores (S4), tools/crypto, automation-browser | `integration-action-executor.ts` - the user-defined integration action runner; previously named in B7 only as a dep to re-point, no own verdict - adapt. `integration-session-capture.ts` imports playwright ONLY (verified) - port-as-is; prod remote-capture explicitly deferred (GCE comment at `:115`). `integration-agent.ts` = uuid + integration-storage types only (verified) - the builder-agent session/prompt logic; the SDK call lives in its handler - adapt. `integration-automation.ts` (stores + types) and `integration-automations.ts` (stores + crypto + automation-browser, `integration-automations.ts:43-67`, verified) - adapt. `integration-inference.ts` (integrationStore only) - port-as-is. |
| B26 | Boot modules: `startup.ts` (149) | 149 | boot-sequence composition | fs + supabase-client + tools/license + billing store + config (`startup.ts:1-6`, verified). License fail-fast gate, data-dir preparation, and the one-time billing-units reset (already cited by B6/Conflict 5, previously without a disposition) are real behaviors to re-compose in the rebuild's own boot. `config.ts`/`bootstrap.ts` are A11 port-as-is; `index.ts` (the composition root) is Tier C. |

---

## Services sweep - remaining `services/` modules (per-candidate verdicts)

Added by the verification pass: every `services/` module not already covered above, with verified import lists (grep of `from '...'` sources per file) and a per-candidate verdict. None of these import the recipe/skill/dispatch machinery; verdicts are decided by which Tier A/B family they lean on.

| Module | LOC | Imports (verified) | Verdict |
|---|---|---|---|
| `services/app-archive.ts` | 153 | node + `archiver` + commit-guard (A7) | **port-as-is** |
| `services/app-health-scanner.ts` | 139 | config + browser-pool (A8) + artifacts store + app-registry (B2) | adapt (follows B2) |
| `services/artifact-bundle.ts` | 536 | node + uuid + artifacts/app-data stores + tools/vcs (B18) + app-data-backups (A5) + base-loader + featured-artifacts-seeder + slug-generator (B3) | adapt |
| `services/artifact-files.ts` | 190 | node + tools/vcs + commit-guard + github/backup (B18) | adapt (follows B18) |
| `services/artifact-fork.ts` | 223 | stores + app-builder (A3) + app-registry (B2) + github provider/fork (B18) + slug-generator | adapt |
| `services/automation-browser.ts` | 281 | node + playwright ONLY | **port-as-is** (persistent automation browser context; feeds B24's local-browser-session) |
| `services/base-loader.ts` | 280 | node fs/promises + fs + path ONLY | **port-as-is** |
| `services/brand-asset-proxy.ts` | 427 | node + site-builder | adapt |
| `services/brand-color-filter.ts` | 177 | node:fs ONLY | **port-as-is** |
| `services/branding-save.ts` | 162 | node:fs ONLY | **port-as-is** |
| `services/cloud-files.ts` | 296 | persistence + platform-integration-call (B5) | adapt (follows B5) |
| `services/ctt-tracking.ts` | 326 | node + integrations store + integration-action-executor (B25) | adapt |
| `services/demo-registry.ts` | 238 | node + zod + ekoa-data-path | **port-as-is** |
| `services/design-system.ts` | 739 | node child_process/module + site-builder | adapt |
| `services/design-tokens-css.ts` | 150 | node:crypto + base-loader + company store (S4) | port-as-is (S4) |
| `services/ekoa-data-path.ts` | 20 | node path/url ONLY | **port-as-is** |
| `services/featured-artifacts-seeder.ts` | 197 | node + uuid + artifacts store + slug-generator (B3) | adapt (S4) |
| `services/featured-update.ts` | 297 | stores + tools/vcs + app-builder + app-registry + artifact-bundle + app-data-backups | adapt (named in A3's dependents list; verdict now recorded) |
| `services/knowledge-browse.ts` | 105 | knowledge-paths + vault + frontmatter (all A6) | **port-as-is** (rides A6) |
| `services/knowledge-crawl-runner.ts` | 140 | knowledge-crawl + api-ingest + domino-ingest + sources store | adapt (follows B13) |
| `services/knowledge-extract.ts` | 172 | node + `officeparser` + `cheerio` ONLY | **port-as-is** |
| `services/knowledge-nfc-migration.ts` | 123 | vault + accents + ingest (A6/B13) | port-as-is (rides A6) |
| `services/knowledge-seed.ts` | 102 | node + knowledge-sources store | port-as-is (S4) |
| `services/knowledge-prompt.ts` | 82 | knowledge-search (A6) ONLY | **port-as-is** - the cited-or-silent chat grounding block; the injection *point* is in adapters/external.ts (Tier C) but the content builder ports |
| `services/local-executor.ts` | 113 | node child_process/os ONLY | **port-as-is** |
| `services/onboarding-prompt.ts` | 223 | skills/loader (Tier C) + settings/artifacts/automations/integrations stores + ekoa-data-path | adapt (re-point or inline the skills/loader read) |
| `services/rendered-candidates.ts` | 353 | browser-pool (A8) + site-builder | adapt |
| `services/repo-lock.ts` | 35 | **zero imports** (verified) | **port-as-is** (the per-repo mutex B18 depends on) |
| `services/share-lookup.ts` | 39 | app-registry (B2) + slug-generator (B3) + artifacts store | adapt (used inside B4's static-serving shareability gate) |
| `services/shared-data-scope.ts` | 67 | app-registry + app-data facade/contract (A5) | adapt |
| `services/site-builder.ts` | 357 | playwright ONLY | **port-as-is** |
| `services/site-context.ts` | 628 | config ONLY | **port-as-is** |
| `services/starting-points-prompt.ts` | 88 | artifacts store + base-loader | adapt (S4) |
| `services/stt-provider.ts` | 221 | billing constants + tracker ONLY (`stt-provider.ts:26-27`, verified) | adapt (billing seam, B6) |
| `services/url-fetcher.ts` | 83 | url-safety (A11) ONLY | **port-as-is** |
| `services/visual-vibe.ts` | 280 | anthropic-client + browser-pool + site-builder (verified) | adapt - already on `anthropic-client`, no S1 swap needed |
| `services/turn-classifier.ts` | 209 | anthropic-client + llm-router + billing tracker (`turn-classifier.ts:22-24`, verified) | adapt (billing seam) - already on `anthropic-client` |
| `services/in-build-answer.ts` | 167 | `callSimpleLlm` + llm-router + orchestrator type (`in-build-answer.ts:14-16`, verified) | adapt (S1) |

---

## Tier C - Rewrite (entangled with discarded machinery - NOT carryover)

Listed so the rebuild does not accidentally try to port them:

| Module | Why not carryover |
|---|---|
| `adapters/external.ts` | The Claude Agent SDK adapter - the content-driven machinery itself (prompt composition, skills/plugins wiring, `callSimpleLlm` host). Its *callers* port via S1 swap; the adapter does not. |
| `agents/plugin-loader.ts` | Skill/plugin discovery for the SDK. |
| `apps/loader.ts`, `apps/handler.ts`, `apps/interpreter.ts`, `apps/compiler.ts` | The recipe engine (content-driven CRUD interpretation/compilation). |
| `handlers/*` dispatch + `handlers/index.ts` | The intent-dispatch composition root (`domainMap`). The rebuild's REST routers replace this shape entirely; individual business logic inside handlers must be re-homed per the rebuild's routing design, not ported as dispatchers. |
| `services/orchestrator.ts` | Orchestration entry point over the agent machinery (S1 + S2 coupled). |
| `tools/registry.ts` *as a registry* | The governed-tool registration/audit machinery. Individual tool *functions* port per Tier A/B verdicts above (crypto, jwt, platform-integration-call, license, device-auth, files, build, vcs). |
| `index.ts` (899 LOC) | The boot composition root - wires config/handlers/SSE/registries/schedulers into the Express server. The rebuild writes its own composition root; the behaviors worth keeping are already dispositioned separately (app-data backend selection `index.ts:128-137` in A5; startup gates in B26). |
| `skills/loader.ts` (158) | Skill-markdown discovery feeding SDK prompt composition (config + fs only, mechanically trivial - but exists solely to serve the content-driven prompt machinery). Its one non-agent consumer, `onboarding-prompt.ts`, re-points or inlines the read (sweep table). |
| `agents/index.ts` (2) | Re-export of `plugin-loader` (already listed). |
| `adapters/knowledge-mcp.ts` (106) | In-process `ekoa-knowledge` MCP server exposing A6 to SDK agents (imports the SDK + MCP types, verified). Named in A6's intro as a consumer; the A6 stack it wraps ports, the MCP wrapper does not. |
| `agent-face/index.ts` (380), `agent-face/daemon-tools.ts` (287), `agent-face/validate-oauth-tools.ts` (184) | SDK agent surface: imports adapters/external + `@anthropic-ai/claude-agent-sdk` + bridge protocol/server (verified). The bridge transport it drives is B16; the agent face itself is machinery. |
| `traces/index.ts` (136) | Agent-dispatch trace buffer. Imports only `protocol.ts` (verified), so mechanically portable if the rebuild keeps traces - listed here because it exists to observe the dispatch loop being replaced. |
| `tools/knowledge-search.ts` (49), `tools/knowledge-read.ts` (36) | Governed/SDK tool wrappers over A6 (named in A6's intro). The knowledge stack ports; these wrappers follow whatever tool surface the rebuild's agents get. |
| `tools/call-automation.ts` (93), `tools/call-ekoa-action.ts` (95), `tools/call-integration-action.ts` (69), `tools/list-automations.ts` (45), `tools/list-ekoa-actions.ts` (39), `tools/list-integration-actions.ts` (37) | The cross-agent SDK tool surface (CLAUDE.md's four-tool catalog + ekoa-action pair). Thin wrappers - the underlying engine/executor/catalog port per B7/B24/B25; the SDK tool definitions are rebuilt against the new agent runtime. |

---

## Disposition of the brief's expected candidates

| Brief candidate | Where covered | Verdict |
|---|---|---|
| esbuild bundling + static serving | A3 (app-builder/app-manifest/app-scaffold/routes) + B4 (server.ts static block) | bundling **port-as-is**; static-serving routes **adapt** (extract to router) |
| OAuth / credential management | A4 (platform-oauth, claude-auth, crypto, integration schema/storage) + B4c/B5 | mostly **port-as-is**; callbacks + generic API caller **adapt** |
| Firestore access layer | A5 (app-data family incl. `app-data-mongo.ts` = Firestore via Mongo-compat driver) + `supabase-client.ts` | **port-as-is** (contract already ports-and-adapters) |
| Anonymisation integration | A7 | **port-as-is**; note there is NO Presidio or external anonymisation service anywhere in src (verified zero grep hits) - do not spec one in |
| GCE deploy scripts | Nothing to port from `cortex/src`. Only in-source reference is a comment "GCE deploys set on the live container" (`services/integration-session-capture.ts:115`). All deploy/infra lives in the external `ekoa-deploy` repo (`gongiskhan/ekoa-deploy`, per CLAUDE.md Guardrail 7); no `deploy/` directory exists in this repo. | **external, out of scope** - flag as external dependency of the rebuild's ops story, including `npx playwright install chromium` at image build and knowledge-index volume persistence (A6 ops constraints) |

---

## Conflicts - doc/code contradictions recorded this sweep

1. **No Presidio.** The audit brief's framing of "anonymisation integration" suggests an external service; grep for `presidio` across `cortex/src` returns zero hits (verified). Anonymisation is three small pure in-process modules (A7). Do not spec an external anonymiser into the rebuild.
2. **CLAUDE.md documents dead files.** `services/template-preview-builder.ts` and `services/template-screenshot.ts` do not exist (verified directory listing; the only template/screenshot/preview matches in `services/` are `artifact-screenshot.ts` and `citius-automation-templates.ts`). `browser-pool.ts:10-12` confirms the fold-away ("Extracted from template-screenshot.ts"). Living equivalent: `services/artifact-screenshot.ts` (A10).
3. **CLAUDE.md "JsonStore only" vs Firestore in prod.** CLAUDE.md's Persistence section says all data is JSON files via JsonStore; `persistence/app-data-mongo.ts` is a Firestore (MongoDB-compat) backend selected fail-fast at boot (`index.ts:128-137`, verified). Domain stores DO remain JsonStore; app-data does not in production.
4. **`knowledge-ripgrep.ts` stale header.** Header claims ripgrep is "the SOLE search backend (no inverted index)" (`knowledge-ripgrep.ts:2-3`, verified); in fact `knowledge-search.ts:22-23` prefers the FTS5 index when `ftsReady` (verified). CLAUDE.md's knowledge section describes the current (FTS5-first) state correctly.
5. **`billing/tracker.ts` stale header.** Header says "Uses character-based estimation until the Claude Agent SDK exposes token counts" (`tracker.ts:4-6`, verified); real SDK token counts are recorded now - the one-time billing-units reset in `startup.ts:25-35` (verified) exists precisely because real counts replaced stale estimates.
6. **`protocol.ts` WebSocket-era vestiges.** `ClientMessageSchema` still carries `auth` (`protocol.ts:15`) and `file_upload` (`protocol.ts:24`) variants (verified); actual auth is HTTP JWT (`auth.ts`) and uploads are `POST /api/v1/upload`. Trim before porting the schema as the API contract.
7. **Finder-evidence correction (recorded for audit honesty).** The finder counted 7 non-test `sseManager` importers; verified grep finds 9 (adds `index.ts` and `services/artifact-backend/runtime.ts`). Does not change any verdict - the point stands that most audited modules do not touch S2.
8. **Finder-evidence omission.** The app-data family also includes `persistence/app-data-migration.ts`, `services/app-data-migration.ts`, and `services/app-data-backups.ts` (verified listing), absent from the finder sweep; added to A5.
9. **Citation correction (recorded for audit honesty).** B4 originally cited the slug->canonical-id resolution at `server.ts:3437`; the actual call `const canonicalAppId = getAppIdBySlug(appId) || appId;` is at `server.ts:3436` (line 3437 is blank; verified via `grep -n getAppIdBySlug` + direct read). Off-by-one only - every other server.ts citation in B4 (`:3417`, `:3447`, `:2932`, `:3233`, `:3303`, `687-838`, `:719/:774/:838`, `2474-2534`, `2583-2642`, `227-267`) re-verified exact. Corrected in place.
10. **First-sweep coverage gaps (recorded, now fixed).** The initial sweep left whole subsystems without verdicts while citing them obliquely: `bridge/` (named only as an A1 dependent and a B7 call site), `streaming/` (its auth.ts listed as an A1 dependent), `services/github/` (only its commit-guard dispositioned in A7), `services/artifact-backend/` (runtime named only in the S1/S2 seam lists), the Layer-1 dispatch family (only event-queue + webhook-verifiers covered), the legal/CITIUS vertical (only simuladores), the Adobe e-sign stack (only the platform-oauth auth pieces), `app-sso.ts`, `pipedream.ts`, boot modules, ~38 further services, and the agent-tool wrappers. All now dispositioned (A4/A11 additions, B16-B26, Services Sweep, Tier C additions).
