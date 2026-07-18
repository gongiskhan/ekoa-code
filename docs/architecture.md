# Architecture

The one architecture doc for ekoa-code: what the product is, how the repo is laid out, the module
map and its binding rules, and the subsystems an agent touches. Present-tense as-built.

## What the product is

Ekoa (codename Cortex is the backend) is a multi-org platform where a firm - law firms today, other
verticals later - chats with an AI assistant, has web apps built for it by a coding agent, runs
those apps as served static artifacts, automates browser and integration work, and is billed for the
model tokens its work consumes. The product surface is Portuguese (PT-PT); the code and these docs
are English.

Every platform operation - routing, CRUD, lifecycle, orchestration - is deterministic TypeScript. No
model call ever sits in a platform path. The model works in exactly one place: agent runs (chat
turns, app builds, automation vision, served-app assistants), and every one of those calls passes
through a single egress module, `api/src/llm/`, which is simultaneously the billing attribution
point, the anonymisation pipeline, and the provider-routing config point.

The platform is multi-org: every user belongs to an `org` (PT label "Escritório"). Branding, the
knowledge base, integrations, and anonymisation deny-lists are org-scoped. A `visibility:
private | org` field governs whether a memory or artifact stays owner-only or is shared across the
org. Access is gated by two independent facts - an admin-controlled `active` flag and the billing
allowance (the activation model that replaces licensing).

## Repo layout

Three parts, one repo, npm workspaces:

- `api/` - one Node + TypeScript Express service. Default port `:4111` (`api/src/config.ts`,
  `backend.port`). Persistence is Mongo via the `mongodb` driver (`api/src/data/mongo.ts`); the
  knowledge vault + FTS5 index and app sandboxes are on disk under `~/.ekoa`.
- `web/` - the Next.js dashboard (`:3000`). Transport is a typed REST client generated from `shared/`.
- `shared/` - the API contract ONLY: zod schemas + inferred types + endpoint descriptor maps
  (`shared/src/`). Imports nothing but zod. Both apps consume it; neither extends it.

In production web and API are same-origin behind an edge proxy, so the API ships **no CORS middleware
on purpose**. Dev needs a shim - see `docs/operations-runbook.md` (the run driver).

## Module map (`api/src/`)

Direction is strictly downward (tier table below). "May import" lists in `spec/`-derived design are
exhaustive; the lint rules of `docs/governance.md` enforce the load-bearing edges.

| Module | Responsibility |
|---|---|
| `server.ts` | Composition root: builds the app, mounts routers, wires injected seams, runs boot. The only file that may import everything. |
| `config.ts` | Env-derived typed config singleton; nothing else touches `process.env`. |
| `data/` | All persistence: Mongo stores, collections engine, the one crypto module (AES-256-GCM), and the single audit write path `logActivity`. |
| `llm/` | THE egress module - one module, three concerns (see below). |
| `auth/` | JWT mint/verify middleware, login, refresh, device login, admin seeding, the revocation set + activation cache. |
| `billing/` | Token accounting: tracker (the single metering writer), ledger, allowance middleware, credits, overage. Also the non-token usage ledger (`usage_events`, mega-run C2): per-org-per-session counters (`voice_stt_ms`, `voice_tts_chars`) recorded by the SAME tracker, never token-converted; Part D's assistant-turn metering adds counter keys on the same schema. |
| `content/` | Agent-context loader: composes per-run context from package directories. A loader, not a framework. |
| `services/` | Cross-domain logic: error sanitiser, secret-commit guard, safe-path jail, browser pool, SSRF-guarded fetcher, GitHub pipeline. Never imports `llm/`. |
| `memory/` | Org memory: resolver, formatter, post-run extraction (one FAST call per run, always `visibility: private`). No model call of its own. |
| `knowledge/` | Org-partitioned markdown vault + FTS5 index, ingest, cited-or-silent grounding builder. |
| `integrations/` | OAuth flows, encrypted credentials, action runner, Pipedream, e-signature. |
| `bridge/` | Daemon-facing WS server the ekoa-local daemon dials into; delegation dispatch; the provider endpoint routes back through `llm/`. |
| `streaming/` | Live browser-canvas media relay (the one FIXED-2 WebSocket carve-out). |
| `voice/` | Voice relay (Part C), `streaming/`'s sibling WS carve-out: WS `/api/voice/stream` (16 kHz PCM up, interim/final transcripts + `utterance_end` down) + `/api/voice/tts-stream` (audio frames down, `{clear}` barge-in). Session-JWT `?token=` auth (CONV-1), org+user attribution on every provider call record, 10-min inactivity timeout, per-stage latency JSON logging. Vendor-neutral `SttProvider`/`TtsProvider` registry, config-selected per language; v1 ships stub providers only (live vendors land at C6). Metering (C2): at session close each connection records `voice_stt_ms` (ungated - capture open = billed, bytes at the known rate) / `voice_tts_chars` through `billing/tracker.ts` (the single metering writer; voice never writes a ledger), attributed to the verified token's org+user; voice turns audit through the one `logActivity` path (`voice.turn`/`voice.tts`, `source:'voice'`, refs only). NOT model egress - never imports `llm/`. |
| `events/` | SSE manager (four streams), durable event queue, webhook ingress, trigger delivery. |
| `agents/` | Agent SDK execution of user work: job lifecycle, context assembly, typed streaming, marker parsing. |
| `apps/` | User-app pipeline: esbuild, registry, static serving + context injection, slugs, artifact backends, backups. |
| `automation/` | Vision-first automation engine, action runner, planner + rehearsal, catalog. |
| `legal/` | Legal vertical: calculators, research, CITIUS/eTribunal, tracking. Portal connectors (Part E, mega-run E1): `portal.ts` attaches a `PortalDocument`/`PortalEvent` (`shared/`, the first legal contract that is not `z.unknown()`) onto a dossiê (`processos` row) as a `documentos`/`eventos` satellite row on the owner spine, org-checked against the dossiê owner's real org; `GET /api/legal/portal` (header-scoped, same tier as citius/calculos) is the read surface. E2-E5 connectors and the signed-in follow-up connectors write through the same seam. |
| `routes/` | One thin Express router per domain: validate against `shared/`, call one module, shape the response. Never imports `data/`. |

Tier table (imports point strictly down; the graph is acyclic by construction):

| Tier | Modules |
|---|---|
| 7 root | `server.ts` (everything) |
| 6 | `routes/` (domain modules, `auth/`, `events/`, `billing/`, `shared/`) |
| 5 | `agents/`, `automation/`, `apps/`, `legal/` |
| 4 | `events/` |
| 3 | `integrations/`, `memory/`, `knowledge/`, `bridge/`, `streaming/`, `voice/` |
| 2 | `llm/`, `services/` |
| 1 | `auth/`, `billing/`, `content/` |
| 0 | `data/`, `config.ts`, `shared/` |

Two deliberate absences keep it clean: nothing imports `routes/` or `server.ts`; nothing below
tier 5 imports `agents/`, `automation/`, or `apps/` - lower tiers reach them only through injected
callbacks.

## Import boundaries (FIXED-1) and module-direction lint

Lint- and CI-enforced (`.eslintrc.cjs`). Full verbatim rule text is in `docs/governance.md`:

- **Repo boundaries.** `web/**` may not import `api/**`; `api/**` may not import `web/**`;
  `shared/**` imports neither. ESLint `import/no-restricted-paths`, CI-fatal.
- **Module direction.** ESLint zones encode the tier table: nothing imports `routes/` or
  `server.ts`; `routes/` does not import `data/`; only `server.ts` imports across the injected seams;
  nothing outside `api/src/llm/` imports `llm/` internals other than its public entry.

## LLM egress chokepoint (`api/src/llm/`) - FIXED-3, FIXED-8, FIXED-13

The single egress module: the ONLY code that may import `@anthropic-ai/*` or reach the provider host.
Three concerns behind one public entry (`llm/index.ts`):

1. **Attribution + metering.** Every call is tagged `user_work | classifier | platform`
   (`attribution.ts`) and handed to `billing/tracker.ts`. Attribution with a billee is a
   compile-time-required parameter, so an unbilled `user_work` call is inexpressible.
2. **Anonymisation.** Model-bound text is tokenized before transport and de-tokenized on return
   (`llm/anonymise/`; see `docs/security.md`).
3. **Provider routing.** Deterministic tier selection (`router.ts`), credential custody
   (`credentials.ts`), and the ekoa-local gateway sub-app (`gateway.ts`, mounted `/api/v1/llm`).

Enforcement is structural, not conventional: because `llm/` is the sole importer/instantiator of the
Anthropic client, all three concerns sit on the one egress route with no bypass. ESLint bans
`@anthropic-ai/*` everywhere in `api/src/**` with a single override for `api/src/llm/**`; a
belt-and-braces grep gate (`scripts/chokepoint-grep.sh`, run by `ci:lane`) fails the build if
`api.anthropic.com` or `@anthropic-ai/` appears outside `api/src/llm/` - catching raw fetches the
import rule cannot see. Agent SDK subprocesses never receive a provider URL; they are pointed at the
chokepoint via `ANTHROPIC_BASE_URL` at spawn time (`credentials.ts`, default
`http://127.0.0.1:4111/api/v1/llm`) - a build-checked invariant: no spawn may carry a provider base
URL other than the chokepoint's.

## Injected seams

Four places where a lower-tier module must cause work in a higher tier. Each is a typed callback
wired at the composition root (`server.ts`), never an upward import; seams have honest defaults:
usage-updated notifier (`billing/` -> `events/`), automation run-event emitter (run caller ->
`automation/`), trigger delivery targets (`events/` -> `automation/` run start, `apps/` backend
invoke), artifact-backend notify (`apps/` -> `events/`).

## Agent execution surface

`agents/` runs user work through the Agent SDK. Agent kinds: **coding** (app builds), **chat** (chat
turns), **automation** (planner/rehearsal/vision), and the **integration-builder** agent. Served-app
**assistant** chat runs synchronously on the served-app plane, billed to the artifact owner.

- **Content loader** (`api/content/`, loaded by `api/src/content/`): the baseline package directories
  are `coding-agent`, `chat-agent`, `automation-agent`, `integration-builder-agent`, and
  `legal-spine`. `content/` composes per-run context from these; it defines no routes and no runtime
  logic. Per-integration knowledge packs ship under `api/assets/integrations/<key>/SKILL.md` and are
  attached via a `loadContextContent` fallback when the integration is configured.
- **Context assembly** (`agents/context.ts`): the content-loader output plus five grounding layers
  composed in order - memory injection, knowledge grounding (builds ground only on the legal-context
  detector; chat always grounds), live integration pre-fetch (chat only), catalog, and the delimited
  full-history transcript (never truncated). Joined into one system prompt + prompt for the chokepoint.
- **Marker vocabulary** (`agents/markers.ts`), server-parsed only - no marker, partial or whole, ever
  reaches a `text_chunk`: `[[EKOA_BUILD]]` (start-of-stream build handoff -> `build_intent`),
  `[[EKOA_INTEGRATION_BUILD]]` optionally followed by `(hint)` (integration-builder handoff, prose
  still streams), and `<ekoa-context>...</ekoa-context>` (extracted and persisted server-side, last
  valid one wins, re-injected on the next turn). Split-marker safety holds back a tail on every push.

## Knowledge subsystem

`knowledge/` owns an org-partitioned markdown vault + FTS5 lexical index (ripgrep fallback) on disk,
plus the cited-or-silent grounding block builder consumed by `agents/`. Each org's documents live at
`vault/<orgId>/<collection>/...`. One reserved partition, **`_shared`** (`SHARED_ORG_ID`), is a
public legal corpus that every org's searches also consult; it is written ONLY by the offline
importer CLI (`npm run tool:knowledge-import`), and the online service refuses a shared-org actor so
no firm can ever be routed to `_shared`. A search consults the caller's own partition AND `_shared`.

## Apps pipeline

`apps/` builds a user app by writing JSX into a per-user sandbox (`~/.ekoa/sandboxes/user-<id>`),
bundling with esbuild, and serving it statically at `/apps/:idOrSlug/` with `window.__ekoa` /
`window.__EKOA_APP_ID` injected into the served HTML (byte-compatible with the legacy Cortex plane -
the legal e2e suite drives it directly). Thumbnails render to `~/.ekoa/data` and serve at
`/artifact-screenshots/*.png` (`Artifact.screenshotUrl`). Versions are git snapshots in the sandbox;
a per-build verification stage (default on, `build.verifyBuilds`) drives the built app with
playwright-cli and fails completion if the served app does not fulfil the request. Featured apps
prebuild into `~/.ekoa/data/featured-builds`.

## Automations

`automation/` runs a vision-first engine: cache replay first, then vision pinned to the EXPERT tier
at maximum effort (no tier escalation). The planner turns a natural-language goal into a validated
step list via the chokepoint (EXPERT); the engine executes deterministic Playwright actions; the
action/assertion cache keyed `(automationId, stepId, pageFingerprint)` makes full-cache-hit runs
consume zero tokens. Webhook ingress is `/hooks/:triggerId` (mounted first, raw-body parser so the
HMAC verifier sees unmodified bytes).

## Integrations

`integrations/` connects external systems: OAuth flows (Google, Microsoft, Adobe), AES-encrypted
credentials decrypted only at execution, the generic platform API caller with in-band token refresh,
Pipedream, and e-signature. Baseline assets ship per integration (`api/assets/integrations/<key>/`);
the integration-builder agent authors user-defined integrations at runtime.

## Billing

Three tiers (`config.ts`, env-overridable): FAST (`claude-haiku-4-5-20251001`, weight 0.02),
WORKHORSE (`claude-sonnet-4-6`, weight 0.1), EXPERT (`claude-opus-4-8[1m]`, weight 0.4). `billing/`
owns the metering formula; `llm/client.ts` is the single metering point and `billing/tracker.ts` the
single `token_events` writer. Metered tokens =
`round(w * (input + output + cacheCreate) + w * 0.25 * cacheRead)`; `tierWeight` is snapshotted at
write time so historical events re-total identically. `GET /billing/breakdown` groups by the
`agentType` tag. Gateway wire-tier billing (amended 2026-07-11): the gateway matches the requested
model against the three configured tier models - a match runs AND meters at that tier (EXPERT ~20x
FAST cost); any other model keeps the FAST clamp. This deliberately un-clamps EXPERT so the
strict-JSON planner and thinking-heavy builds do not starve on FAST.

Non-token usage (mega-run C2, BRIEF §5 "Shared surface"): quantities that are not tokens ride the
SAME single writer (`recordUsageCounters` in `billing/tracker.ts`) into the sibling append-only
`usage_events` ledger - one doc per (source, org, session), `_id` = `<source>:<orgId>:<sessionId>`, org+user
attributed, `counters` an open map keyed by canonical counter names. Today: `voice_stt_ms` and
`voice_tts_chars` as SEPARATE counters with NO token conversion (they never move the token meter,
credit, or `token_events`). Part D's assistant-turn metering extends this by adding a counter key
under its own `source` - one coherent schema, no new ledger concept, no migration. Activity rows
carry the same counter names verbatim in `usageCounts` (A5 vocabulary memo rule 3).

## Diagrams

The system is documented visually under `docs/diagrams/` (12 Excalidraw sources, `01`..`12`). They
are first-class (FIXED-12): any change that alters structure, flow, or data shape must update the
affected diagram in the same unit of work, and review must reject a structural change without it.
