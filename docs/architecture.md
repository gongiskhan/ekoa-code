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

Three platform parts plus the consumers, one repo, npm workspaces:

- `api/` - one Node + TypeScript Express service. Default port `:4111` (`api/src/config.ts`,
  `backend.port`). Persistence is Mongo via the `mongodb` driver (`api/src/data/mongo.ts`); the
  knowledge vault + FTS5 index and app sandboxes are on disk under `~/.ekoa`.
- `web/` - the Next.js dashboard (`:3000`). Transport is a typed REST client generated from `shared/`.
- `shared/` - the API contract ONLY: zod schemas + inferred types + endpoint descriptor maps
  (`shared/src/`). Imports nothing but zod. Both apps consume it; neither extends it.
- `clients/*` - shipped CONSUMERS of the platform, never a second implementation of it (Capability
  Contract rule 1). They may reach `shared/` and nothing else in this repo; the `clients/*` zones in
  `.eslintrc.cjs` enforce that. Neither is in the root `build` script (which is shared+api+web).
  - `clients/cortex-cli` (`@ekoa/cortex-cli`) - the `cortex` CLI over the public Capability API,
    driving one generated typed client (`docs/CAPABILITY_CONTRACT.md`).
  - `clients/bridge` (`@ekoa/bridge`) - the local bridge daemon an operator installs on their own
    machine. A SEPARATE PROCESS, not a module: `api/` never imports it, and it reaches Cortex the
    way any paired machine does, over the WS bridge (`api/src/bridge/`). It re-exports the
    delegation wire schemas from `@ekoa/shared` rather than carrying a copy, so daemon and Cortex
    parse the same objects and sign the same bytes by construction. Its `playwright` range is
    pinned equal to api's so npm hoists one copy. Ships as a `.tgz` with `@ekoa/shared` bundled in
    (`npm run pack:dist`) because a `*` workspace dep cannot resolve on a laptop; the daemon needs
    shared's runtime, not only its types. Its unit lane rides the workspace `test` fan-out; its
    integration canary against `api/dist` is a separate CI step behind an entrypoints guard.

In production web and API are same-origin behind an edge proxy, so the API ships **no CORS middleware
on purpose**. Dev needs a shim - see `docs/operations-runbook.md` (the run driver).

### Web shell structure (OS mode, run 1)

The dashboard has TWO shells over the SAME page components (strangler-fig; contract:
`docs/os-mode/surface-contract.md`, diagram: `docs/diagrams/13-os-mode-shell.excalidraw`):

- **Classic** (`web/app/(dashboard)/`, the default): sidebar + routed pages, plus the global
  chat dock (`web/components/chat/global-chat-dock.tsx`).
- **OS mode** (`web/app/(os)/os`, beta, `NEXT_PUBLIC_OS_MODE=1`): desktop + dock + workspaces +
  a custom window manager (`web/components/os/`, pure tiling math in `web/lib/os/tiling.ts`),
  with the same chat dock docked open.

A **surface** = container-agnostic page component + co-located manifest, listed in the thin
registry `web/lib/os/registry.ts`. Width-responsive styling inside surfaces uses `@bp-*`
container variants; each shell root declares `@container` (classic = viewport-wide, so classic
rendering is unchanged) and each window body declares a nearer one. The chat CONTROLLER lives
in `web/components/chat/chat-runtime.tsx`, mounted once per shell; the `/chat` route keeps all
URL coupling. OS layout state persists client-side in `web/stores/os.ts` (`ekoa_os`).

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
| `services/` | Cross-domain logic: error sanitiser, secret-commit guard, safe-path jail, browser pool, SSRF-guarded fetcher, GitHub pipeline. Also the pure-buffer Word track-changes engine (`docx-redline.ts` + `docx-comments.ts`, track 2C) wrapping `@adeu/core` pinned exactly at 1.28.0 - native `w:ins`/`w:del` + `word/comments.xml` + `commentsExtended` resolution; see `docs/word-track-changes.md`. Never imports `llm/`. |
| `memory/` | Org memory: resolver, formatter, post-run extraction (one FAST call per run, always `visibility: private`). No model call of its own. |
| `knowledge/` | Org-partitioned markdown vault + FTS5 index, ingest, cited-or-silent grounding builder. |
| `memvault/` | Per-USER markdown notes ("cortex memory"), the first `user-or-key` capability. Three files, three concerns: `jail.ts` is the single path-resolution point (realpath containment; a symlink escape fails closed), `store.ts` does file CRUD through it, `service.ts` runs write/read/list/delete with one audit row per call. `fts.ts` adds the per-user search index. Imports `data/` + `config.ts` only - never `llm/`. |
| `uploads/` | Composer attachment staging (WS4a, 2026-08-08): `POST /api/v1/uploads` (raw body + `X-Filename`/`X-Folder`, `shared/src/uploads.ts`) writes a blob to a per-USER directory (`paths.ts`); `service.ts` reads it back either by `uploadId` (`resolveUpload`) or, for `agents/chat.ts`'s text-attachments run class, copies a run's referenced blobs into a FRESH temp directory (`stageRunAttachments`) so the Agent SDK subprocess's `cwd` exposes exactly the files attached to that turn - never the user's whole upload history. No list/delete surface; a staged file's retention past the run is an accepted v1 gap. |
| `schedules/` | The timer rail (2026-08-17): ONE `Schedule` entity (one-time + recurring, IANA wall-clock recurrence self-rolled on Intl) firing a target union - `manual` (a pending human task), `automation` (via the injected `startRunForTrigger` seam, `triggeredBy:'schedule'`), `integration_action` (via the injected executor seam; `awaiting_consent` records a `blocked` run). Claim-first supervisor: one 30s tick, deterministic run-id insert per (schedule, occurrence) is the at-most-once guard, pointer advances BEFORE execution, no backfill past a 5-min grace, 20-strike auto-pause. Whole family `user-or-key`. Imports `data/`, `integrations/` (validation reads) + `shared/` only - reaches `automation/` ONLY through server.ts seams (lint zone). |
| `security/` | THE value-keyed redaction module (`redaction.ts`, Cofre R-6 / H-1 / H-4) plus the shared origin-binding and path-containment primitives. It replaced two divergent private maskers; every model-bound, log-bound, SSE and persisted stream a run touches goes through it. Imports `services/` only. |
| `cofre/` | Credential custody: items, grants, sessions, checkout, process injection, and its own audit trail. A top-level module rather than a sub-tree of `data/` or of either consumer (`decisions.md` 2026-07-27) - the raw item/grant stores are NOT exported and a lint rule bans importing them, so every credential read goes through `unwrap()`. |
| `integrations/` | OAuth flows, encrypted credentials, action runner, Pipedream, e-signature, and `.docx` ingest for the redline pipeline (`docx-fetch.ts`: direct URL through the per-hop SSRF-guarded fetcher, OneDrive/SharePoint + Google Drive over the injected workspace-credential seam, 25 MB triple-enforced). The served-app WORKSPACE planes (`m365-proxy.ts`, `app-cloud-files.ts`) resolve their provider token through `workspace-credential.ts`: the workspace of a served app is the ORG OF ITS OWNER, taken from the app scope the router already admitted (platform-OAuth rows are org-scoped, so there is no ambient connection to reach for), failing closed - and with no provider traffic at all - for an empty, unknown or org-less owner. Credential WRITES merge into the stored bundle rather than replacing it (`service.ts` `mergeCredentialValues`, `CLEAR_CREDENTIAL`), and the dashboard's save is an upsert, so a partial re-save can neither destroy a secret it did not resend nor fork a duplicate config row. The served-app EMAIL plane (`app-email.ts`, `/api/app-email/*`) lets a served page discover its owner's email-capable integrations and send or draft through one, without ever seeing a token: discovery is by the action's declared `capabilities` (`email-send` / `email-draft` / `email-draft-send`), never by action name, and the caller's named action is re-resolved and refused unless IT carries the declaration. A send is a WRITE, so it runs through `callPlatformIntegration` with the app OWNER as `actingUserId` and the consent gate binds - an unapproved send is `awaiting_consent` with zero provider traffic, surfaced to the app rather than swallowed. Zoho Sign connects by OAuth popup (`zoho-oauth.ts`): the grant lands in the ordinary `zoho-sign` integration config - the bundle the service and the action executor already read, not a platform row - and the callback DELETES any pasted `client_id`/`client_secret`/`grant_code`, because a stored pair shadows the platform client and a platform-minted refresh token refreshed against it answers `invalid_code`. |
| `bridge/` | Daemon-facing WS server the ekoa-local daemon dials into; delegation dispatch; the provider endpoint routes back through `llm/`. |
| `streaming/` | Live browser-canvas media relay (the one FIXED-2 WebSocket carve-out). |
| `voice/` | Voice relay (Part C), `streaming/`'s sibling WS carve-out: WS `/api/voice/stream` (16 kHz PCM up, interim/final transcripts + `utterance_end` down) + `/api/voice/tts-stream` (audio frames down, `{clear}` barge-in). Session-JWT `?token=` auth (CONV-1), org+user attribution on every provider call record, 10-min inactivity timeout, per-stage latency JSON logging. Vendor-neutral `SttProvider`/`TtsProvider` registry, config-selected per language; v1 ships stub providers only (live vendors land at C6). Metering (C2): at session close each connection records `voice_stt_ms` (ungated - capture open = billed, bytes at the known rate) / `voice_tts_chars` through `billing/tracker.ts` (the single metering writer; voice never writes a ledger), attributed to the verified token's org+user; voice turns audit through the one `logActivity` path (`voice.turn`/`voice.tts`, `source:'voice'`, refs only). NOT model egress - never imports `llm/`. |
| `events/` | SSE manager (four streams), durable event queue, webhook ingress, trigger delivery. |
| `agents/` | Agent SDK execution of user work: job lifecycle, context assembly, typed streaming, marker parsing. |
| `apps/` | User-app pipeline: esbuild, registry, static serving + context injection, slugs, artifact backends, backups. Includes the artifact-linked Word document lifecycle (`document-source.ts`: two well-known blobs + meta sidecar per app, one path builder carrying app-files' ingress rule, per-app write lock, 25 MB ingest choke) and its served-app REST window (`app-docx.ts`, the same header-scoped plane as app-files) - `docs/word-track-changes.md`. Served-app DOCUMENT EXTRACTION (`app-vision.ts` + `app-vision-route.ts`, `POST /api/app-vision/extract`) turns an invoice photo or a text-layer PDF into structured fields through the llm/ chokepoint, billed to the app owner; a SCANNED pdf is refused as `no_text_layer` with an instruction rather than read as an empty document (`services/pdf-text.ts`, no OCR). The header-scoped planes in this module admit through ONE shared front half (`served-app-admission.ts`: header charset, artifact-backed resolution, owner-activation gate, owner org) - a gate each caller re-implements is a gate that drifts. |
| `automation/` | Vision-first automation engine, action runner, planner + rehearsal, catalog. |
| `legal/` | Legal vertical: calculators, research, CITIUS/eTribunal, tracking. Portal connectors (Part E, mega-run E1): `portal.ts` attaches a `PortalDocument`/`PortalEvent` (`shared/`, the first legal contract that is not `z.unknown()`) onto a dossiê (`processos` row) as a `documentos`/`eventos` satellite row on the owner spine, org-checked against the dossiê owner's real org; `GET /api/legal/portal` (header-scoped, same tier as citius/calculos) is the read surface. E2-E5 connectors and the signed-in follow-up connectors write through the same seam. `portal-connectors.ts` (mega-run E2/E3) is the first of them: retrieval-by-access-code for certidão comercial/predial/civil, a real HTTP client behind `config.ts`'s `PortalConnectorsConfig` base URLs, `guardedFetch`-SSRF-guarded by default with an injected `fetchImpl` test seam (citius.ts discipline; `decodeHtml`/`cellText` shared out to `portal-html.ts`). `POST /api/legal/portal/certidao` (same tier + allowlist as `GET /api/legal/portal`) fetches, parses into the structured record, saves the bytes through `apps/app-files.ts`'s `saveAppFileBlob` (an injected seam, not a direct cross-tier import), and attaches BOTH a `documentos` row (`attachPortalDocument`) and a `document.retrieved` `eventos` row (`attachPortalEvent`) - never a partial write on failure. `insolvencia-watch.ts` (mega-run E4) is the Citius insolvência-publications watcher: a dossiê's watched subjects (NIFs/names) live as ordinary data in the `citius_watches` owner-spine satellite; `pollInsolvencyWatches` fetches each subject via `citius.ts`'s reused `parsePublicacoes`/`decodeHtml`, dedups against the watch row's own `seenRefs` set (not `events/queue.ts` - that store is scoped to real webhook triggers), and attaches a `watch.hit` `PortalEvent` per genuinely new publication. No scheduler runs it yet (the 2026-08-17 `schedules/` timer rail could carry this as an integration-action target, but wiring it is a deliberate follow-up, not implied; the codebase's one declared poll listener belongs to the out-of-scope signed-in eTribunal integration) - `POST /api/legal/portal/insolvency/poll` (same tier) runs one poll cycle for a dossiê on demand, and an operator/cron is expected to invoke `pollInsolvencyWatches` directly for the scheduled path. |
| `routes/` | One thin Express router per domain: validate against `shared/`, call one module, shape the response. Never imports `data/`. |

Tier table (imports point strictly down; the graph is acyclic by construction):

| Tier | Modules |
|---|---|
| 7 root | `server.ts` (everything) |
| 6 | `routes/` (domain modules, `auth/`, `events/`, `billing/`, `shared/`) |
| 5 | `agents/`, `automation/`, `apps/`, `legal/` |
| 4 | `events/`, `schedules/` (the two rails that must START tier-5 work: both reach `automation/` only through seams wired in `server.ts`) |
| 3 | `integrations/`, `memory/`, `knowledge/`, `memvault/`, `uploads/`, `bridge/`, `streaming/`, `voice/` |
| 2c | `cofre/` (imports `data/` + `security/`; consumed by `bridge/`, `automation/`, `routes/`) |
| 2b | `security/` (imports `services/`; consumed by `cofre/`, `bridge/`, `integrations/`, `automation/`) |
| 2 | `llm/`, `services/` |
| 1 | `auth/`, `billing/`, `content/` |
| 0 | `data/`, `config.ts`, `shared/` |

Two deliberate absences keep it clean: nothing imports `routes/` or `server.ts`; nothing below
tier 5 imports `agents/`, `automation/`, or `apps/` - lower tiers reach them only through injected
callbacks.

`security/` and `cofre/` land BETWEEN the existing tiers 2 and 3 (`security/` imports `services/`,
and `bridge/` at tier 3 imports `cofre/`), so they are numbered `2b`/`2c` rather than renumbering
the table - the direction stays strictly downward and every other document's tier references stay
valid.

## Import boundaries (FIXED-1) and module-direction lint

Lint- and CI-enforced (`.eslintrc.cjs`). Full verbatim rule text is in `docs/governance.md`:

- **Repo boundaries.** `web/**` may not import `api/**`; `api/**` may not import `web/**`;
  `shared/**` imports neither. ESLint `import/no-restricted-paths`, CI-fatal.
- **Module direction.** ESLint zones encode the tier table: nothing imports `routes/` or
  `server.ts`; `routes/` does not import `data/`; only `server.ts` imports across the injected seams;
  nothing outside `api/src/llm/` imports `llm/` internals other than its public entry.
- **Consumer boundary.** `clients/*/src|bin|scripts` may not import `api/**` or `web/**`, and
  nothing in the platform may depend on `clients/`. The dependency runs one way: provider to
  contract to consumer.
- **Bridge containment (S1).** Inside `clients/bridge`, `src/containment/resolver.ts` is the ONLY
  path resolver, and filesystem access is confined to the modules that own it
  (`tools/`, `ledger/`, `auth/`, `session/`, `cli/`, `surface/`). Enforced by Rule 4 of
  `.eslintrc.cjs` (`no-restricted-imports` + `no-restricted-syntax`, closing every bypass form:
  aliased imports, `.native`, dynamic `import()`, `require()`, `process.getBuiltinModule`) and
  PROVEN against that config by `clients/bridge/test/lint/containment-rule.test.ts`.

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

Every retry, cap and ceiling the engine honours is a named field in `automation/budgets.ts` - the one
knob module (`REHEARSAL_BUDGET`, `STEP_RETRY_BUDGET`, `NORMAL_RUN_BUDGET`, `DISCOVERY_BUDGET`); a
limit written inline is a limit nobody can find or change deliberately. Both run modes are
wall-clock capped, with human-pause time subtracted, and a failed cap exits through the ordinary
`runError` -> terminal `failed` path. `automation/origin-posture.ts` answers "permissive or
adversarial" once, for the egress, routing and re-auth decisions that must agree: default
adversarial/closed, resolved at use from an optional per-action declaration on `IntegrationAction`
(never stored resolved), with cloud egress structurally impossible on an adversarial origin and
posture overriding `StepDeclaration`'s `cloud` default.

`automation/locality.ts` is what consumes it: a PURE decision (no store, no seam, no env) answering
`bridge | in-process | blocked` for the four step types that can reach a browser (`navigate`,
`wait`, `browser`, `verify`), from the posture, the step's declaration, whether a daemon is
connected, and the org's fleet. The bridge is the default - a browser step's home is the owner's
machine - and the hosted Chromium is a fallback a PERMISSIVE origin may take, and an adversarial one
may not, in every environment. `config.localBrowserEnabled` (default `!isProd`, unchanged) is now
only an operator kill switch: it can CLOSE the fallback in any environment and it can never OPEN it
for an adversarial origin, so posture is the gate and the environment is at most a second lock.
`blocked` is a HALT, never a datacenter fallback and never a substitute machine, and it declares WHICH
ACT can clear it: the verdict carries a REQUIRED
`clearedBy: 'start-a-machine' | 'pair-a-machine' | 'edit-the-automation'`, and each act's neutrality
is DECLARED in the `CLEARING_ACTS` table beside the reason it is true (`refusalIsNeutral` is a table
read, not an equality test, so anything unconsidered is terminal by default).
`start-a-machine` is the environment (a shut laptop, the wrong machine dialled in) and halts in
`awaiting_daemon`, the ONE neutral act: the laptop gets opened tomorrow morning whether or not
anybody knew a schedule was waiting for it, and the same steps then succeed unchanged.
`pair-a-machine` is an account whose fleet listing is KNOWN AND EMPTY - there is nothing to start, so
waiting can never clear it - and halts TERMINALLY, driving the ceiling and auto-pausing loudly
instead of re-firing against a state that cannot change.
`edit-the-automation` is a cause that is a property of the STEP LIST rather than of the world (the
mid-run route switch, the posture drift onto another host): the next fire resolves the same
declarations, reaches the same index and halts identically, so replay is provably useless and only
the author changing what the automation declares clears it - terminal for that reason. Required
rather than optional, so a new
refusal cannot inherit "neutral, retry forever" by saying nothing; and it names the ACT rather than
the actor, because its one consumer has to pick a halt with it (`engine.ts` `refusalRecordFor` asks
for a ceremony only when the step declares a credential - a credential ask for a step that wants none
is a wrong specific instruction). The route out comes from
`automation/egress-policy.ts` (`resolveEgress` against org-scoped candidates - filtered on the ROW's
`org`, never on pairing-id membership alone, because a tenancy boundary must not rest on an id being
unique across tenants; `proxyOptionFor` rendered at the single launch seam in `server.ts`, because a
proxy is a `newContext` launch option and cannot be applied afterwards), with the fleet reaching
`automation/` through `setEgressCandidateResolver` - bound to `bridge/registry.ts`
`egressCandidatesForOrg`. THAT SEAM ANSWERS `EgressCandidate[] | null`, and the distinction is load
bearing: `null` is "this process has no listing" (the UNBOUND default, which refuses without claiming
anything about the org), `[]` is "the registry says this org has no machines" (which refuses
terminally). Collapsing them let an org whose only laptop had been revoked retry a neutral halt for
ever - see docs/findings.md `an-org-whose-only-machine-is-revoked-retried-forever`.
THE MACHINE'S ADVERTISED ADDRESS IS NOT AN AUTHORISATION EITHER. `hello.egressEndpoint` is a free
`z.string().max(255)` on the wire and it ends up as `browser.newContext({ proxy })`, so it is
validated on the way in and on the way out (`bridge/egress-endpoint.ts`: scheme allowlist
{http,https,socks5}, no embedded credentials, no path; loopback / link-local / RFC1918 /
multicast refused, with the TAILNET ranges 100.64.0.0/10 and fd7a:115c:a1e0::/48 allowed BY NAME
because a naive private-range rule would throw away every legitimate value; canonical output,
because the check below is an equality test). Validation is only the shape half: the
AUTHORISATION half is that an `egress.residential` grant NAMES the endpoint it authorises
(`CapabilityGrantDoc.egressEndpoint`, required by `grantCapability`), and `egressCandidatesForOrg`
withholds both the capability and the address when the grant's endpoint is not the one the machine
currently advertises. A compromised daemon re-pointing itself on a reconnect therefore fails
CLOSED rather than moving a tenant's hosted browser to an attacker's proxy - and the advertisement
REPLACES, so a `hello` with no endpoint clears the stored one instead of keeping a route the
machine no longer offers. An ADVERSARIAL session prefers the pairing its ceremony happened on
(`sessionMetadata.establishedBy.pairingId`, reported by `ensureSession` and turned into a preference
by `credential-gate.ts`): that machine or wait, never a colleague's. THE PREFERENCE IS SCOPED TO THE
ORIGIN IT BELONGS TO, never to the run - a session is bound to one portal, so the gate emits it as
`{ origin, pairingId }` and the run loop files it in `preferredPairingByOrigin`, a map keyed by the
site each session is about. It was one run-level variable set by whichever gated step last reported
a pairing and forwarded into every later browser step, so a run touching two portals judged portal
B's steps against portal A's ceremony machine: with that machine retired, the halt named PORTAL B
and asked for a ceremony the owner could perform correctly, for ever, with the next fire producing
the identical halt - while `needs_credentials` (deliberately not neutral) drove the ceiling to the
auto-pause. A portable credential resolves
to `kind: 'any'` and prefers nothing. A preference whose machine the org's fleet listing no longer
contains has been RETIRED, and that refusal is made ONCE, in `credentialGateRecord` - see below. It
halts TERMINALLY and names the act that fixes it (establish the session again from a machine you
still have) instead of waiting forever, uncounted, on hardware nobody owns; it still does not fall
through to a substitute. The ceremony request it raises carries no `preferredPairingId`, because
that field means "repeat the ceremony on the machine the portal already knows" and that machine is
precisely the one that is gone. A posture inherited from a
preceding step licenses ONE origin: a hosted session observed to have drifted onto another host
carries no further steps.

A scheduled run that ends in one of the THREE "waiting for the owner" statuses (`awaiting_daemon`,
`awaiting_consent`, `needs_credentials` - `BLOCKED_RUN_STATUSES` in `automation/service.ts`) reports
`outcome: 'blocked'` from `startRunForTrigger`, CARRYING WHICH as
`code`, and `schedules/supervisor.ts` maps that to a `blocked` fire outcome. Only an ENVIRONMENT
block is neutral against the 20-strike `FAILURE_CEILING` (`NEUTRAL_BLOCKED_CODES` =
`awaiting_daemon`): opening a laptop fixes it with nobody touching the schedule, so twenty nights of
it must not auto-pause a working schedule, and it therefore neither increments the counter nor
resets it. A block on a human act (`needs_credentials`, `awaiting_consent`) keeps driving the
ceiling, because nothing changes between fires until a person acts and an uncapped retry is itself
the hazard - a rejected password resubmitted nightly against a portal with an unknown lock-out
policy. Every block, of either kind, notifies the owner through the required `notifyBlocked` seam
(`schedule_blocked` on the per-user notifications channel, carrying a code and no prose), and
`web/components/schedules/run-status-badge.tsx` derives its words from that code rather than from
the bare status.
NEUTRAL IS NOT FREE, AND THE EXEMPTION BRINGS ITS OWN BOUND. Removing a block from the ceiling
removes the only cap on REPEATING it, so a neutral fire earns a COOLDOWN
(`neutralBackoffMs`: doubling from one minute to a 15-minute cap, recorded as
`neutralBackoffUntil` with `consecutiveNeutralBlocks`) during which `claimAndFire` advances the
pointer WITHOUT claiming - no schedule-run row, no automation run, no notification - and the
schedule stays enabled and self-heals on the far side. Without it a per-minute schedule pointed at
a bridge-only automation with no daemon wrote ~2880 durable rows and 1440 notifications a day,
for ever, in two stores that have no retention - ~96 blocked fires a day at the cap instead of
1440. The notification carries the same bound: the first
block of a streak tells the owner at once, a continuing one at most daily
(`lastNeutralNotifiedAt`), because a push at the fire rate is the unbounded thing one channel over.
The cap is deliberately below any hand-authored cadence, so an hourly or nightly schedule never
notices it; a NON-neutral block is not cooled at all, because slowing it would delay the auto-pause
that is how its owner finds out. An owner re-enabling the schedule clears the streak and the
cooldown along with the ceiling.

WHERE THE DECISION SITS IN THE RUN LOOP. Locality is resolved BEFORE the credential gate, and the
order is a security property rather than a preference: the gate calls `ensureSession`, whose typist
path opens a browser and submits a password into it, so nothing may open a browser ahead of the
decision that says where the step belongs. A step locality refused never reaches the gate at all.
When the gate does run it receives a HOSTED-BROWSER PERMIT (`CredentialGateInput.hostedBrowser`)
that the gate forwards to `ensureSession` only if the origin's posture also allows the hosted path;
`EnsureSessionInput.hostedTypist` is absent-means-no, so an unattended login into the hosted
Chromium is impossible for an adversarial origin. The permit is offered ONLY when
`config.localBrowserEnabled` says this process has a hosted browser at all - which is what keeps a
password from being typed into one in production - and WHICH permit it is comes from
`locality.hostedTypistPermitFor`, whose single rule is that THE LOGIN LEAVES BY THE SAME DOOR AS THE
WORK. An `in-process` verdict types through the route its own work will take. A `bridge` verdict
types through the CONNECTED machine's line when that machine has one (`bridgeEgressFor` resolves the
route out against `daemonPairingId`, never against `resolveEgress`'s independent `usable[0]` pick,
which named some other household's proxy while the work ran on the owner's); through the ordinary
hosted browser when the step required nothing of its route at all, the origin being permissive by
construction; and through NOTHING - the permit is withheld and the run halts asking for a person -
when a residential line was required and the connected machine cannot lend one. Withholding is the
closed answer and the available one: a halt for a person is a state the product already surfaces,
and typing a password out of a door the session is not then used from is not.
`config.localBrowserEnabled` keeps its `!isProd`
default: posture is the gate, and this slice narrows without widening anything on the way past.

WHAT THE GATE IS TOLD ABOUT THE FLEET, and why withholding it was not a neutral omission. A session
established at an attended ceremony is stamped `boundEgress: { kind: 'residential', pairingId }`
beside its `establishedBy` (`bridge/attended.ts` is the only writer of `establishedBy: machine` in
this repo; the hosted typist writes `cloud` + `datacenter`). `cofre/session-checkout.ts` therefore
releases such a session only when that machine appears in `residentialAvailable`, and the run loop is
the only thing that can say so. It does: `engine.ts` derives the list from the org fleet it already
loaded, through `residentialEgressPairings` (`automation/egress-policy.ts`) - the SAME predicate
`resolveEgress` uses to pick a machine to proxy through. One predicate is deliberate: "this machine
may carry the work" and "this machine's session may be released" are two answers about one machine,
and two copies would let them drift apart in the direction where a session is unwrapped for a route
that does not exist. The list is an AUTHORISATION and org-scoped by construction, so it carries Rule
5 coverage of its own (`api/tests/security/locality-isolation.test.ts`). Passing nothing, which is
what the loop did until 2026-08-19, is the statement "no machine of yours can carry residential
egress" - it refused every attended session there is, and made the whole ceremony-preference path
below unreachable in production.

A MACHINE THAT IS GONE IS NOT A MACHINE THAT IS ASLEEP, and the run loop answers that question in ONE
place: `credentialGateRecord`, about the machine CHECKOUT named, through `machineRetired`
(`egress-policy.ts`) and `SESSION_MACHINE_RETIRED_REASON` beside it. That is the only arrival there
is - a ceremony session is bound to its machine's residential line, so a revoked machine makes the
session unreleasable and the ceremony preference is never learned, which means `resolveLocality`
cannot reach the question at all. It carried a second copy of the refusal for two rounds; nothing in
production could reach it and it has been removed. The halt is a terminal `needs_credentials` asking
for a ceremony, never the neutral `awaiting_daemon`, which is exempt from the failure ceiling and
would re-fire forever against hardware nobody owns.

AND AN ACCOUNT WITH NO MACHINE AT ALL IS A THIRD THING. `machineRetired` distinguishes `null` (no
listing: not-knowing, which may never escalate a wait into a terminal halt) from `[]` (the registry
answered and the org has no pairings: every machine it once had is gone). `resolveLocality` applies
the same distinction to its own refusals - with no daemon connected and a known-empty listing, a
"start your machine" halt becomes the terminal `pair-a-machine` one, because there is no machine to
start. Reading `[]` as ignorance is what let a solo tenant who revoked their only laptop re-fire a
neutral halt nightly, for ever, uncounted.

THE LAST MILE. `locality.ts` decides a route and the engine carries it, but the only place it
becomes actually-proxied traffic is the local-browser context provider, which renders the resolution
into `newContext({ proxy })` (a launch option; it cannot be applied to a context that exists). That
body lives in `automation/seams.ts` as `localBrowserContextProviderUsing(openBrowser)` and takes the
browser as an ARGUMENT, with `server.ts` binding `getSharedBrowser` into it. It used to be an inline
closure in the composition root reaching straight for `getSharedBrowser`, which made it the one
security-critical step nothing could bind and nothing exercised - gutting it to a bare
`newContext()`, every residential run silently leaving from the datacenter, left the repository
green. `tests/automation/local-browser-context.test.ts` drives the real function with a recording
browser.

A run that needs a credential the Cofre does not hold halts in `needs_credentials`, a first-class
`RunStatus` modelled on `awaiting_daemon` (halt and re-dispatch) rather than on `paused_for_user` (an
in-process poll): the human is expected to leave the page for `/cofre`, so the halt has to survive a
reload and a restart. `automation/credential-gate.ts` is the general home of `ensureSession` in the
run loop - it fires only for a step whose `StepDeclaration.credentialRefs` is non-empty, derives the
origin from the step's own URL or the action's resolved `httpConfig.baseUrl`, and contains no branch
on any integration key. Resume is driven from two independent places, neither load-bearing alone: a
process-local waiter registry (`automation/credential-waiters.ts`) woken through the `cofre/notify.ts`
seam that `server.ts` binds - `cofre/` never imports `automation/` - and the client's own resume call
after it unlocks a credential. An origin whose login is OTP / MFA / CAPTCHA gated halts with
`mode: 'ceremony'` and is established by the human in a headed window; there is no typed-OTP path and
`cofre/relay.ts` deliberately ships the login prompt's producer with no completion half.

### The discovery spine: learn an action once, replay it without a model

A `browser-steps` action used to re-derive its whole flow, vision-first, on every run - so its cost
and latency were proportional to how often it ran. It is now learned ONCE and replayed thereafter.

THERE IS ONE DRIVING LOOP, AND IT IS THE ORDINARY RUN. The learning pass is the automation the action
was going to run anyway, with the machine's network recorder armed underneath it
(`RunAutomationOptions.observeNetwork`, armed lazily before the first step whose type drives a page,
because arming takes the machine's lease). An earlier cut of this slice added a second, goal-driven
exploration loop; it had no production caller - `runAutomationForAction` always holds an automation
binding - and the authored steps plus `rehearsal.ts` already adapt when a site's UI moves. The
decision and its reasoning are in `docs/decisions.md` (2026-08-19).

Underneath the run, the machine records what the page's own JavaScript asks the server for
(`clients/bridge/src/browser/capture.ts`, armed by a `captureOp` LIFECYCLE frame that is deliberately
not a member of the page-action vocabulary a model can emit). `automation/network-capture.ts` is the
hosted redaction boundary and the learner: it distils the site's own calls into templated
`InjectedCall`s and a handful of lessons, with NO model involved - which is why the second run costs
nothing. Header NAMES are the learning and are kept; header VALUES exist only in RAM on the machine,
per lease and per origin, and are forwarded into the replayed call there. The recorder's lifetime is
the lease's: `ProfileManager.onLeaseEnd` fires on all three ways a lease ends (the explicit frame,
the idle backstop, daemon shutdown), and the recorder registers its own disposal when it is armed.

`automation/executors/injected-call.ts` replays, cheapest-reliable first: an in-page `fetch` (which
inherits the origin, the cookie jar, SameSite and the TLS session), then a plain server-side request
for PERMISSIVE origins only, then the recipe's scripted DOM steps. Vision is not a rung - it is the
caller's fall-through. Posture is resolved PER CALL, against the origin that call targets, and the
whole ladder is resolved before the first call is sent: a recipe spans hosts, so one verdict for the
list would let a permissive first hop authorise egress to a third-party host nobody classified. Two
things an ARGUMENT may not decide are refused there too - a hole the run did not supply (rendering it
empty widens `?ref={{input.ref}}` into `?ref=`, which most APIs read as "everything") and a resolved
URL whose origin differs from the template's literal one.

`replay-action.ts` mounts the replay inside `runAutomationForAction`, reading the recipe through
`recipe-store` (org-scoped; the definition projection strips recipes so they cannot reach the wire).
Every outcome except `ok` and `write-gate` falls through to the run, so the worst case is the run as
it was before; `write-gate` refuses, because anything non-idempotent - a POST, or a scripted DOM step
that changes the page - needs a human, and routing around it would make the gate decorative. The
gate's key is `writeAssent`, produced by `integrations/action-consent.ts` and carried across the
automation seam by `automationBackedActionHandler`; it is true only when a human approved a MUTATING
action, never merely because a read was not gated.

`automation/self-heal.ts` classifies drift (an `expectShape` mismatch, a non-2xx, a call that cannot
be made) as `recipe_drift`. The next instrumented run re-learns the flow, and the new recipe is
superseded through `recipe-store.supersedeRecipe` - tenant-scoped, version bumped, lineage stamped -
and never through `publishSnapshot`, whose gate is super-admin and whose effect is `global`
visibility. A read-only heal lands silently; one that re-authors a recipe containing a write is held
for the same human assent.

## Integrations

`integrations/` connects external systems: OAuth flows (Google, Microsoft, Adobe), AES-encrypted
credentials decrypted only at execution, the generic platform API caller with in-band token refresh,
Pipedream, and e-signature. Baseline assets ship per integration (`api/assets/integrations/<key>/`);
the integration-builder agent authors user-defined integrations at runtime.

## Billing

Four tiers (`config.ts`, env-overridable models/efforts/weights): FAST (`claude-haiku-4-5-20251001`,
effort low, weight 0.02), WORKHORSE (`claude-sonnet-5`, effort medium, weight 0.1), EXPERT
(`claude-opus-5`, effort high, weight 0.4), GENIUS (`claude-fable-5`, effort max, weight 0.8 - the
frontier tier, 2026-08-07). GENIUS is floor/hint-only: keyword routing never escalates past EXPERT;
first builds floor at GENIUS (`agents/build.ts`), follow-ups at EXPERT, and a `critical` complexity
hint resolves GENIUS. `billing/`
owns the metering formula; `llm/client.ts` is the single metering point and `billing/tracker.ts` the
single `token_events` writer. Metered tokens =
`round(w * (input + output + cacheCreate) + w * 0.25 * cacheRead)`; `tierWeight` is snapshotted at
write time so historical events re-total identically. `GET /billing/breakdown` groups by the
`agentType` tag. Gateway wire-tier billing (amended 2026-07-11): the gateway matches the requested
model against the configured tier models - a match (exact or family: fable/mythos → GENIUS, opus →
EXPERT, sonnet → WORKHORSE, haiku → FAST) runs AND meters at that tier (GENIUS ~40x FAST cost); any
other model keeps the FAST clamp. This deliberately un-clamps the strong tiers so the strict-JSON
planner and thinking-heavy builds do not starve on FAST.

Build runs additionally mount the design-skill plugin (frontend-design [Apache 2.0] +
design-taste-frontend [MIT], vendored under `api/content/plugins/ekoa-design/`) as an Agent SDK
local plugin (`AgentsConfig.designPluginDir`, `EKOA_DESIGN_PLUGIN_DIR` override, empty disables).
The spawn keeps `settingSources: []` (FIXED-6); the plugin is the one sanctioned skill-loading
path, and the build system prompt pins the skills' craft to the compiled React entrypoint.

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
