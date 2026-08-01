# FLOW_PLAN — Integrations, unified (run 20260801-171149-672a8f14)

Profile **build** · 21 slices · derives from `RUN_SPEC.md`. Kinds: `api` (batched run-level
adversarial-test), `ui`/`mixed` (per-slice design-audit + walkthrough). Waves = topological order;
within a wave, slices with disjoint files may parallelise (dynamic workflows). **Serialize every
edit to `shared/src/integrations.ts`, `shared/src/sync.ts`, `api/src/server.ts`,
`api/src/data/stores.ts`, and the schema-coverage COVERED list** — one owner per wave.

Slice ids: `B*`/`A*`/`C*`/`D*`/`E*` = core; `CS*` = Citius proof.

## Slice table

| id | pts | kind | title | depends on | acceptance (short) |
|---|---|---|---|---|---|
| B1 | 4 | api | End the credential v1/v2 crypto split | — | all 4 flat writers/readers → org-bound envelope; rotation never downgrades; zoho-config-unreadable regression test green |
| A1 | 6 | api | Tenant-scoped definition store | — | `integration_definitions` doc + own→org→global resolver + isolation suite (memvault class) |
| CS1 | 5 | api | Citius inbox parser + fixtures | — | `parseHiddenFields` + liberal inbox walker + speculative fixtures; honest `indisponível`, never false-empty |
| CS2 | 6 | api | Mock Citius WebForms server | — | login+inbox (GET & postback) + `/__scenario` + doc-hit counters + smoke test |
| CS3 | 6 | api | Sync-state + verified-sync + `shared/sync` | — | `runVerifiedSync` pure orchestrator; complete/incomplete/failed; watermark advances only on complete; unit tests |
| A2 | 7 | api | Async registry + seam threading | A1 | `resolveDefinition`/`listDefinitionsFor`; server.ts/executor/platform-call/events/poll seams async + org-scoped; tenant-filtered list |
| A3 | 6 | api | Builder→Mongo + legacy import + shadow | A2 | save path writes Mongo private-by-default; boot importer + hash comparator; review date journaled |
| B2 | 7 | api | Cofre join + WS-C shadow | A2 | item type + link fields, connect-time mint + `until_locked` grant, `unwrapForIntegration`, origin resolver re-point; auto-grant security test |
| C1 | 5 | api | backingType dispatch + provisioner fix | A2 | additive backingType; bash-cli as one-step automation; org-scoped ids + dup-insert check + two-org regression |
| C3 | 3 | mixed | Per-integration lessons-learned | A2 | `lessons` field + PATCH (+COVERED+regen) + load_context concat + dashboard textarea |
| E1 | 5 | api | Visibility + super-admin global toggle | A1, A2 | `private\|org\|global`; setVisibility (user) + setGlobal (super-admin) + descriptors + COVERED + visibility security suite |
| CS4 | 6 | api | Citius connector: enumerate + session replay | CS1, CS2 | cookie-jar enumerate via credentialedFetch; GET/postback probe; login-redirect health; throttle; tests vs mock |
| CS5 | 6 | api | Recipes + session establishment (typist wiring) | CS2 | citius recipe; `ensureSession` (checkout→reuse\|typist re-establish→capture); tests |
| C2 | 6 | mixed | Write gate (mutates → confirm) | C1 | `action-consent.ts` + executor enforcement + approve endpoint (+COVERED+regen) + `awaiting_consent` mapping + web consent-dialog extension |
| D2 | 7 | api | Integration agent merge | C1 | `integration-agent.ts` sharing extracted core; builder route rewired; behaviour parity |
| E2 | 5 | mixed | Publish scrub | E1 | `publish-scrub.ts` deterministic floor + one chokepoint pass → frozen snapshot; dry-run preview; scrub tests |
| CS6 | 7 | api | Citius sync assembly + routes + proofs | CS3, CS4, CS5 | `citius-sync.ts` + `routes/sync.ts` + stores/server wiring + completeness e2e-api (incl. INCOMPLETE sim) + metadata-only zero-hit security suite |
| D1 | 7 | api | Capability router (get/execute) | A2, C1, C2 | `integration-capability.ts` + list flip + execute descriptors + COVERED + OpenAPI/client regen + per-domain auth suite |
| CS7 | 5 | ui | Citius sync web panel + e2e | CS6 | `SyncOutcomePanel` (Completa/INCOMPLETA/Falhou) + band-4 e2e + walkthrough (INCOMPLETE frame) |
| CS8 | 3 | api | Lessons seam + graduation + diagrams | CS6 | `recordLesson` seam + `latestSyncReport` graduation read + diagrams 05/10 + decisions entry |
| D3 | 8 | mixed | achieve (execute-or-author) | D1, D2, E1, CS8 | achieve job flow + verify + provisional→trusted + copy-on-author fork + 2 descriptors + band-4 e2e |

## Waves (topological)

1. **B1 ∥ A1 ∥ CS1 ∥ CS2 ∥ CS3** — disjoint foundations (CS1/CS2 agree the fixture family first).
2. **A2** — serialize (owns server.ts seam signatures; compile-breaking on purpose).
3. **A3 ∥ B2 ∥ C1 ∥ C3 ∥ E1 ∥ CS4 ∥ CS5** — coordinate shared/ + stores.ts writes (one owner/wave).
4. **C2 ∥ D2 ∥ E2 ∥ CS6** — CS6 is the Citius join point.
5. **D1 ∥ CS7 ∥ CS8**.
6. **D3** — final integration slice (self-extension, end-to-end).

## Verification per slice

Committed re-runnable assertion is the gate (test file or committed playwright-cli driver).
Commands after any `shared/` descriptor change, in order: `npm run build --workspace shared` →
`npm run openapi:generate` → `npm run generate --workspace @ekoa/cortex-cli` → typecheck → lint →
`npm test --workspace api` → `npm test --workspace web` → `gate:openapi` → `gate:client-drift` →
`gate:chokepoint && gate:encryption-key && gate:garrison` → `gate:ledger`. New api tests need no
ledger row; new `web/e2e/*.spec.ts` register in `playwright.band4_gap_plan`. Structural slices
(A1, A2, B2, C1, D1, D3, CS6, CS8) update diagrams 02/05/12 (core) or 05/10 (Citius) in the same slice.

## Global success criteria

buildable-remaining 0; every enabled gate green; the three findings closed with tests; the Citius
completeness proof shows COMPLETE → INCOMPLETE (caught by reconciliation) → COMPLETE against the mock;
metadata-only proven by the zero-document-hit test; `ci:lane` exit 0.
