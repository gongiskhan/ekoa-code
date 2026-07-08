# As-Built Architecture (rc-1)

One page to orient in five minutes. The spec under `spec/` stays normative - where this page
and the spec disagree, the spec wins (per `CLAUDE.md`). This describes what the code actually
does today, with pointers into the chapters that remain the source of truth.

## 1. Topology

Three parts in one repo (npm workspaces):

- `api/` - one Node + TypeScript Express service. Default port `:4111` (`api/src/config.ts:143`,
  `backend.port`). Persistence is Mongo via the `mongodb` driver (`api/src/data/mongo.ts`).
- `web/` - the Next.js dashboard on `:3000`.
- `shared/` - the API contract only: zod schemas + inferred types + endpoint descriptor maps
  (`shared/src/`). Imports nothing but zod.

In production, web and API are same-origin behind an edge proxy, so the API ships **no CORS
middleware on purpose**. Dev needs a shim: the run driver puts the real API on internal `:4211`,
a zero-dependency CORS reverse proxy on `:4111`, and `next dev` on `:3000`. See
`docs/operations-runbook.md` and `.claude/skills/run-ekoa-code/` (`driver.mjs up`).

## 2. api module map

Direction is strictly downward (ch02 §2.7): `routes/` -> `services`|`agents`|domain modules ->
`data/` stores. Nothing imports `routes/` or `server.ts`.

- **`server.ts`** is the composition root - the only file allowed to import everything. It builds
  the Express app, mounts every router (`/api/v1/*`), and wires the injected seams that keep lower
  tiers from importing upward (`agents/`, `automation/`, `apps/`, `events/`, content-audit).
- **`data/`** - Mongo stores (`stores.ts`), the collections engine (`collections-engine.ts`),
  crypto (`crypto.ts`), and the single audit write path `logActivity` (`data/activity.ts`).
- **SSE event plane** - `events/sse-manager.ts` fans out exactly four web-client streams
  (`chat`, `job`, `automation`, `notifications`; CONV-4, `shared/src/events.ts:138`).
- **Served-app plane** - user-built apps served at `/apps/:idOrSlug` (`apps/serving.ts`) with a
  key-value data API at `/api/app-data` (`apps/served-data.ts`), scoped by the `X-Ekoa-App-Id`
  header, **not JWT** (an optional owner-bypass token is the only auth these planes accept).
- **Billing** - `billing/tracker.ts` is THE single metering writer; nothing else writes
  `token_events` (§6.5.1). The LLM chokepoint hands it one completed call.
- **Memory** - `memory/extraction.ts` runs post-run, asynchronously, one FAST-tier call per run,
  every write `visibility: 'private'`.
- **Automation** - `automation/engine.ts` executes user automations; webhook ingress is
  `/hooks` (`routes/hooks.ts`), mounted first with a raw-body parser so the HMAC verifier sees
  unmodified bytes.
- **Bridge** (ch18) - `bridge/` runs a WS server the local daemon **dials into**; bridge model
  completions route back through the LLM chokepoint, never the provider SDK directly.
- **Knowledge vault** - `knowledge/vault.ts` is the only writer of the doc store, org-partitioned
  by path segment.

Diagram: `spec/diagrams/02-module-map.excalidraw`. Full "may import" lists: `spec/02-module-map.md`.

## 3. LLM egress chokepoint (`api/src/llm/`)

The single egress module - the ONLY code that may import `@anthropic-ai/*` or reach the provider
host (FIXED-3/8/13). Three concerns behind one public entry (`llm/index.ts`):

1. **Attribution + metering** - every call tagged `user_work | platform | classifier`
   (`attribution.ts`), handed to `billing/tracker.ts` (ch06).
2. **Anonymisation** - model-bound text is masked before transport and de-masked on return
   (`llm/anonymise/`, ch17).
3. **Provider routing** - deterministic tier selection (`router.ts`), credential custody
   (`credentials.ts`), and the ekoa-local gateway sub-app (`gateway.ts`, mounted `/api/v1/llm`).

Agent SDK subprocesses never receive a provider URL; they are pointed at the chokepoint via
`ANTHROPIC_BASE_URL` at spawn time (`credentials.ts:277`, default
`http://127.0.0.1:4111/api/v1/llm`).

Two as-built caveats (see `docs/release/FINDINGS.md`):

- **F2** - the default gateway topology is un-provisioned: no boot path provisions the gateway
  API key, so a turn through the local gateway 401s. Working runs currently set
  `LLM_CHOKEPOINT_BASE_URL=https://api.anthropic.com`, bypassing the gateway plane.
- **F10** - the per-org deny-list resolver is unwired (`setRulesetResolver` is never called in
  `server.ts`), so every org runs the empty default; NER is the inert default, so only
  checksum-valid PT structured IDs are masked.

## 4. Import boundaries and enforcement

Structural rules are lint- and CI-enforced (`.eslintrc.cjs`): `import/no-restricted-paths` zones
(`web/` -> `shared/` only; `api/` never `web/`; `shared/` neither) plus `no-restricted-imports`
banning `@anthropic-ai/*` everywhere in `api/src/**` with a single override for `api/src/llm/**`.
Belt-and-braces CI greps back this up: `gate:chokepoint`, `gate:garrison`, `gate:encryption-key`
(`scripts/*-grep.sh`, run by `npm run ci:lane`). Full text: `CLAUDE.md` ch02 §2.9 block.

## 5. Where truth lives

- **Normative spec** - `spec/` (chapters 01-18 + `SPEC.md`); the spec wins during the rc-1 build.
- **Diagrams** - first-class in `spec/diagrams/` (`*.excalidraw` + `*.png`); a structural change
  without its diagram update is incomplete (FIXED-12).
- **Decisions** - `RUN_LOG.md` (append-only, canonical) + `docs/decisions.md` (run bookkeeping).
- **As-built deltas** - `docs/release/FINDINGS.md` (the F1-F19 gap ledger + patch briefs).
- **Chapter status** - `docs/spec-status-annex.md` (forthcoming; not yet in the repo).
