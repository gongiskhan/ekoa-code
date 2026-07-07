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
