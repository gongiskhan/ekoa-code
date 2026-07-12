# Decision memo — Tour format: reuse vs new schema (Phase-2, track 2)

**Decision: REUSE the surviving Tutorial Bridge stack wholesale (demo-spec v1 + zod registry + PUBLIC /api/demos* routes + injected bridge + dashboard iframe player) and EXTEND it minimally; build exactly ONE net-new component (the same-document in-panel player). No new schema.**

Flagged for operator review in the landing packet. Evidence: `analysis/02-demos-tutorials.md` (all claims cited to file:line there).

## What is reused as-is

- Declarative spec: 6 step types (navigate/spotlight/await-action/annotate-result/inject-prompt/external-image-step), PT-PT copy, executability invariants in the validator (`demo-registry.ts:26-168`); 28 shipped tours prove the format.
- The injected bridge (`demo-bridge-client.js`): origin-pinned postMessage, `data-demo-target` discovery + MutationObserver, spotlight mask/tooltip drawing, await/result-ready handling — transport-agnostic crown jewels.
- Zero-token playback is already the design (inject-prompt never auto-sends).

## Bounded extensions (non-breaking; stays on version 1)

1. **Multiple tours per app** — optional `tourId` + `kind: "overview"|"journey"` fields; registry keyed `(appId, tourId)`; `/api/demos/:appId` returns a list. The 28 existing specs stay valid.
2. **Build-time generation** (E1) — the loader already ingests a directory; only the writer is new. Generated tours use registry IDs as `data-demo-target` values: **the action-registry ID namespace and the demo-target namespace become the same namespace**, which makes selector stability across rebuilds fall out for free.
3. Cheap win: expose the bridge's latent `placement` field on spotlight/annotate steps for deterministic tooltip placement in generated tours.

## The one net-new component

A same-document tour player for the assistant panel (E2): reuses the bridge's drawing/await primitives (~70% by line count) but replaces the iframe-postMessage transport with a same-window driver + a `startTour(tourId)` entry. The dashboard iframe player stays unchanged.

## Drift hazards to resolve during E1 (from analysis/02)

- Collapse the duplicated spec catalog (`api/assets/demos/` served vs `ekoa-data/demos/` read by e2e) to ONE source before generation lands, or the e2e validates stale content (F16/F28-class drift).
- `../ekoa-dev` archaeology: the port is byte-identical/1:1; nothing richer exists to salvage — all missing capability is genuinely new work.
