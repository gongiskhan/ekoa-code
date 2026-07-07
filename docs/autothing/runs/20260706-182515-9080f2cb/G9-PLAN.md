# G9 — Web client migration plan (ch12, size 10)

Durable roadmap for phase-9. Written at the gate-8a boundary so the next iteration executes
with a precise plan rather than cold. FIXED-9: migrate the existing frontend, do NOT rebuild.

## Source & target
- **Source:** `/Users/ggomes/dev/ekoa-dev/ekoa/` — a Next.js app, ~245 tsx/ts files (app/, components/,
  hooks/, lib/, stores/, locales/, public/). READ-ONLY reference (governance: sanctioned wholesale
  for the ch12 migration).
- **Target:** `web/` — currently only `src/client.ts` + `e2e/` (the Playwright specs, already green
  against api/) + `__tests__/`. The platform frontend is NOT yet migrated.

## Stages (ch12 §12.1, each a separate auditable commit)
- **W1 Copy.** Copy the `ekoa/` tree into `web/` unchanged except: package name (`@ekoa/web`),
  workspace wiring (P-17, ch02), lint config for the import boundary (web imports shared ONLY,
  FIXED-1). NO behavior edits. Exit: `npm run build` exits 0 in `web/`; existing unit tests run
  (backend-missing failures expected + recorded, not fixed here). Keep the existing `web/e2e/` specs.
- **W2 New client layer.** Build the replacement transport ALONGSIDE the old one (call sites
  untouched): `web/lib/api/` (request core §12.2.2, single token accessor §12.2.4, single base-URL
  resolver §12.2.5, URL helpers §12.2.6, per-domain namespaces bound to `shared/` descriptors
  §12.2.1) + `web/lib/api/stream.ts` (EventSource, the 4 streams §12.3) + `web/lib/api/canvas.ts`
  (the sole `new WebSocket(`, §12.3.1, 1000/4000). Rewrite the cortex-provider as `ApiProvider`.
  Exit: new modules compile; types check vs `shared/`; no call site moved.
- **W3 Transport replacement.** Move call sites domain-by-domain per §12.4 (FC-001..FC-069), ORDER:
  (1) auth+token/identity; (2) sessions+chat+notifications stream (app drivable e2e after this);
  (3) jobs+job stream+artifacts; (4) remaining domains; (5) raw HTTP. Delete each old client fn when
  its last consumer moves; delete `lib/cortex/connection.ts` + legacy `lib/api/client.ts` when empty.
  Exit: grep census in `web/` = zero `/api/v1/action` `/api/v1/request` `sendAction` `sendRequest(`
  `wsAction` `lib/cortex/connection` (crit 1).
- **W4 Cleanup.** Execute every delete/clean fate §12.5 (FC-100..FC-312): dead routes/files/store
  state/client fns, locale pruning (FC-138), stale comments/names, TEAMS removed end-to-end (FC-039,
  Amendment 2, crit 17). Exit: grep census — every §12.5 delete-symbol absent (crit 3).
- **W5 Test migration + net-new surfaces.** Port the 4 transport-mock unit tests (FC-307) vs the new
  client; rewrite the 7 protocol-coupled e2e specs (FC-312) vs typed REST; the no-mode-picker guard
  (FC-306). Build the NET-NEW surfaces (outside the 134-item audit): §12.6 privacy/bridge (attach
  Upload/Reference FC-400/401, trust chip FC-402/403, "Privacidade e ponte local" FC-404..410,
  first-grant dialog FC-411, legal onboarding FC-412) with CLAIMS COPY ship-gated + ceiling-bound
  (§12.6, §17.9); §12.9 Amendment-2 surfaces (users org column+role toggle FC-500, super-admin org
  mgmt FC-501, Registo admin FC-502, visibility toggles FC-503, auto-extract affordance FC-504,
  build-verify banner+ask-once+toggle FC-505/506/507, ACCOUNT_DISABLED/BILLING_LOCKED copy FC-508,
  org-name header fallback FC-509). All strings PT-PT.

## Gate G9 (§12.8 + FLOW_PLAN phase-9): the ENTIRE ledger due
- 55/57 Playwright green (band1_zero_change 13 + band2_fixture_swap 5 + band3_served_app 37 + band4
  automation-deterministic 1 — the band4 spec becomes DUE-GREEN here now the UI exists), 17 frontend
  unit green, 14 drivers green/SKIP-gated, protocol-parity contract gate green, shared/ allowlist EMPTY.
- All 17 §12.8 acceptance criteria (legacy-transport census 0, one token accessor, one base-URL, streams
  confined, client==contract, typed events only, locales pruned, boundary lint active, canvas WS confined,
  privacy surfaces present, claims ship-gated, org/activation/Registo/sharing/verify surfaces present,
  teams removed).
- ch14 gate template: single-command ci:lane exit 0 at the checkpoint, e2e:server green, dual review,
  ledger+ratchet, diagrams (02/03/04 render web at module granularity — update if transport structure
  changes, FIXED-12), checkpoint commit + tag gate-9.

## Sequencing note
W3 step (2) makes the app drivable end-to-end (login/chat/streams), so W3.3+ verify against a running
product. Land W1..W5 as separate commits. This is a LARGE phase — expect multiple iterations; each
stage's exit gate is the natural checkpoint. The cross-model Codex security pass (deferred from G8A on
credit exhaustion) rides the run's final security phase.

## Progress
- **W1 DONE** (commit abf8d58): ekoa/ frontend copied into web/ (157 files: app/components/hooks/lib/stores/types/locales/public + configs), workspace-reconciled (@ekoa/web, Next.js tsconfig + @/ alias, frontend deps + @ekoa/shared). Exit gate GREEN: `next build` exits 0. Old transport rides along unchanged for W3. KNOWN: sharp (unused optional Next dep) hangs its libvips fetch in this env → installed --omit=optional + pinned 3 darwin-arm64 natives; durably fix (pin @img binary / npm override) before the W5 ci:lane.
- **W2 NEXT**: build web/lib/api/ (request core, single token accessor, single base-URL resolver, per-domain namespaces from shared/ descriptors) + stream.ts + canvas.ts, ALONGSIDE the old client (no call sites moved). Rewrite cortex-provider → ApiProvider. Exit: new modules compile + typecheck vs shared/.

- **W2 DONE** (commit 25bc208): web/lib/api/ typed REST+stream+canvas client + ApiProvider, alongside the old client, no call sites moved. Exit gate GREEN (typecheck 0). Load-bearing finding below.
- **W3 FOUNDATION (do FIRST, before moving call sites):** the shared descriptor maps are annotated `: DomainDescriptorMap` (widens to Record<string,EndpointDescriptor>), erasing per-op request/response types. Per §12.2.1 (`as const satisfies`) + criterion 7, tighten them so the client infers per op:
  1. In each of the 24 shared/src/*.ts domain files, change `export const xEndpoints: DomainDescriptorMap = {...}` → `export const xEndpoints = {...} as const satisfies DomainDescriptorMap`. Verified low blast radius: api/ does NOT import the maps (only shared/contract.test via allEndpointsFlat + the web client consume them); readonly-const is assignable to the EndpointDescriptor read sites. Nothing mutates a descriptor.
  2. Verify: shared typecheck + `npm run test:contract` (contract.test allEndpointsFlat) + api build all green.
  3. Rewrite web/lib/api/index.ts `createClient` factory types to infer per-op `z.infer<map[op]['request']>` / `z.infer<map[op]['response']>` from the now-precise maps (the worker built it for the widened case with a response generic stopgap). Verify web typecheck.
  4. THEN move call sites domain-by-domain per §12.4 order (auth+token → sessions+chat+notifications → jobs+artifacts → remaining → raw HTTP), deleting each old client fn as its last consumer moves; delete lib/cortex/connection.ts + legacy lib/api/client.ts when empty. Exit: legacy-transport grep census = 0 (criterion 1).

- **W3 FOUNDATION DONE** (commit 1a943db): 24 shared maps → as-const-satisfies; client factory infers per op (args from request schema, return from response schema); no cast/generic at call sites (criterion 7). Verified: shared/api/web typecheck 0, contract 12/12, positive+negative type probes.
- **W3 CALL-SITE MOVES (next, the large chunk):** 25 web files still reference the legacy transport (`sendAction`/`sendRequest(`/`wsAction`/`lib/cortex/connection`/raw `/api/v1/action|request`). Move them to `api.<domain>.<op>(...)` domain-by-domain in the §12.4 ORDER: (1) auth+token/identity (FC-037/021/022/025/066/067), (2) sessions+chat+notifications stream (FC-049/013/014/029/031 — app drivable e2e after this), (3) jobs+job stream+artifacts (FC-045/026/046/047/048), (4) remaining domains (FC-038..044/050..059), (5) raw HTTP (FC-060..065). Delete each old client fn when its last consumer moves; delete lib/cortex/connection.ts + legacy lib/api/client.ts when empty. Wire the ApiProvider into app/layout (replacing cortex-provider) as part of step (2). Per-domain: move → `npm run typecheck` 0 → next domain. EXIT: grep census = 0 (criterion 1). Consider a worker per §12.4 step (they are sequential-dependent; verify typecheck between steps).
