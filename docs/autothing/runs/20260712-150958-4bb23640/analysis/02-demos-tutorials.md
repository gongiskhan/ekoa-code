# A2 — Demos/Tutorials salvage analysis (Phase 1 track 2)

**Deliverable of slice A2.** Verified read-only analysis of what survives from the earlier
demo/tutorial work ("Ekoa Tutorial Bridge") and what Phase 6 ("Tours — zero-token teach path")
needs on top of it. Every claim cites absolute paths + line numbers. All paths verified against
the working tree on branch `operator-run`, 2026-07-12.

**Headline:** the surviving stack is a complete, production-grade, **declarative, zero-token guided-tour
engine** (spec format + validator + PUBLIC routes + injected in-app bridge + dashboard iframe player).
It was ported ~1:1 from the old codebase and nothing richer was dropped. It is a strong reuse base for
Phase 6. Two bounded extensions and exactly **one genuinely net-new component** are required —
see §5 and the Memo input. **RUN_SPEC assumption 2 (reuse + extend) is CONFIRMED.**

---

## 1. The demo-spec format

**Sources:** `api/assets/demos/_schema.json` (JSON Schema mirror, human/test-facing);
`api/src/services/demo-registry.ts:26-168` (the authoritative zod validator);
`web/lib/demo/types.ts:1-111` (frontend mirror). The 28 shipped tours are
`api/assets/demos/legal-*.json` (the brief says "~30"; the actual count is **28**).

### Top-level shape (`demo-registry.ts:123-168`)
A `strictObject` (`additionalProperties:false`) with **4 required** fields:
- `version` — `z.literal(1)` (`:125`). Hard constant today.
- `appId` — string, the served-app slug; the tour opens `/apps/<appId>/` in an iframe (`_schema.json:11-15`).
- `card` — gallery metadata (below).
- `steps` — non-empty array of steps.

A top-level `superRefine` (`demo-registry.ts:130-167`) enforces three cross-field invariants not
expressible in JSON Schema: (a) **unique step ids**; (b) every `select` simulate action must carry
`value` or `index`; (c) the **executability invariant** — an `await-action` whose `event:"click"`
MUST include a `click` on its own `target` in `simulate.actions`, else the awaited click never fires
and the tour hangs (`:157-166`).

### `card` (`demo-registry.ts:116-121`, `_schema.json:34-48`)
`{ titlePt, descriptionPt, durationSec (int>0), thumbnail? }`. `thumbnail` is optional and **unused by
all 28 specs** (none declare it). Cards drive the gallery/landing panel via `listDemoCards()`.

### `copy` (`demo-registry.ts:26-34`)
`{ titlePt, bodyPt }` — PT-PT formal copy, "no emoji, no em-dashes" (`_schema.json:28`). This is the
narration shown in the tooltip and the host control card.

### The six step types (discriminated union on `type`, `demo-registry.ts:107-114`)
| type | required fields | behaviour |
|---|---|---|
| `navigate` | `id, type, to` (+ `copy?`) | Reloads the iframe to app-relative `to` (e.g. `/`, `/calculadora`). A navigate **with** copy pauses for manual advance; a **bare** navigate flows straight through (`tour-machine.ts:203-210`). |
| `spotlight` | `id, type, target, copy` (+ `timeoutMs?`) | Draws the mask/hole + tooltip over `target`; manual advance ("Seguinte"). |
| `await-action` | `id, type, target, event, simulate` (+ `timeoutMs?`) | Waits for a **real** user action on `target`. `event ∈ {click, result-ready}`. `simulate.actions` is MANDATORY — the harness/e2e performs it so the automated test drives the same flow a live user would (`_schema.json:49-51`, `demo-registry.ts:70-79`). |
| `annotate-result` | `id, type, target, copy` (+ `timeoutMs?`) | Waits for the app to signal `result-ready`, then annotates the result element. |
| `inject-prompt` | `id, type, surface:"chat", prompt` (+ `sendInHarness?:false, copy?`) | Surfaces a **suggested** chat prompt in the composer. Invariant: **never auto-sends** (`sendInHarness:false`; `demo-registry.ts:94-97`) — the LLM may be unavailable; the player only asserts the text landed. |
| `external-image-step` | `id, type, image, copy` | Shows an external-portal screenshot (path under `/api/demos/assets/`, e.g. `citius-portal.svg`). |

### `simulateAction` union (`demo-registry.ts:36-49`)
`click {kind,target}` · `fill {kind,target,value}` · `select {kind,target,value?|index?}` (select drives a
native `<select>` that `fill` cannot; pick by option `value` or 0-based `index`).

### Target naming — the load-bearing convention
A step `target` is a **plain kebab identifier** that matches `data-demo-target="<name>"` inside the app
iframe. The schema also documents a `host:` prefix to match `data-demo-target` on **dashboard (host)**
elements (`_schema.json:87`) — but note: none of the 28 specs use `host:`, and the ported host machine
resolves targets only inside the app frame (the bridge queries `document.querySelectorAll('[data-demo-target]')`
in the app document, `demo-bridge-client.js:66-83`). So `host:` is a documented-but-latent extension point,
not live behaviour.

**Worked example** (`api/assets/demos/legal-prazos.json`): navigate `/calculadora` → spotlight `prazos-form`
→ await-action `prazos-calcular` with a 5-action simulate (select processo, fill titulo/data/dias, click
calcular) → annotate-result `prazos-resultado` → inject-prompt (chat) → external-image-step `citius-portal.svg`.
This is the canonical shape all six step types exercised in one 6-step, 60-second tour.

---

## 2. The registry / validator and the routes

**Registry** (`api/src/services/demo-registry.ts`):
- `validateDemoSpec(raw)` → `{ valid, errors, spec? }`, **never throws** (`:190-198`).
- `loadDemoSpecs(force)` reads `<demosDir>/*.json`, **skips `_*.json`** (so `_schema.json` is not a spec),
  logs+excludes invalid specs rather than crashing startup, and **caches** after first read (`:231-257`).
- `demosDir()` resolution order (`:211-217`): env `EKOA_DEMOS_DIR` → in-repo `api/assets/demos` (the default,
  present in this tree) → `<dataDir>/demos`. `demoAssetsDir()` = `<demosDir>/assets` (`:220-222`).
- `getDemoSpec(appId)` returns the **first** spec whose `appId` matches (`:265-267`); `listDemoCards()`
  returns `{ appId, card }[]` (`:270-272`). **Both assume exactly one spec per appId** — see §5, Gap A.

**Routes** (`api/src/apps/serving.ts`), all **PUBLIC auth class** (`docs/api-contract.md:36` lists
`/api/demos*` under `public`; the code comment concurs: "ALL public (pre-login landing panel +
cross-origin served apps)", `serving.ts:414-416`):
- `GET /__ekoa/demo-bridge.js` (`:407-412`) — serves the injected bridge client; `Access-Control-Allow-Origin: *`,
  `Cache-Control max-age=300`. Source read once at boot from `api/assets/demo-bridge-client.js` (`:255-260`).
- `GET /api/demos` (`:427-430`) — `{ demos: listDemoCards() }`, `no-store`.
- `GET /api/demos/:appId` (`:431-439`) — full spec, or `404 { error: "Demonstração não encontrada" }`.
- `/api/demos/assets/*` static (`:418-426`) — external images; `fallthrough:false` (404 on miss),
  `dotfiles:"deny"` (path-traversal posture), mounted **before** `:appId` so an asset path is never
  mistaken for an appId.

---

## 3. The injected in-app bridge

**Client:** `api/assets/demo-bridge-client.js` (plain browser IIFE, no build step, 424 lines).
**Injection:** `api/src/apps/injected-context.ts:260` appends `<script src="/__ekoa/demo-bridge.js"></script>`
right before `</head>` of **every served HTML document** (alongside the `window.__ekoa` data helper, the
health probe, and `<base href="/apps/<id>/">`). It is a **no-op until a `demo.init` arrives**, so it never
affects normal (non-demo) app usage (`demo-bridge-client.js:6-7,29-31`).

### postMessage protocol (envelope `{ __ekoaDemo: 1, type, ... }`, documented `:9-16`)
- **Host → app:** `demo.init {hostOrigin}` · `demo.spotlight {id,target,copy,placement?}` ·
  `demo.await {id,target,event}` · `demo.annotate {id,target,copy}` · `demo.clear {id}` · `demo.end {id}`.
- **App → host:** `demo.ready {targets}` · `demo.targets-changed {targets}` · `demo.ack {id}` ·
  `demo.action {id,target,event}` · `demo.result-ready {target,summary?}` · `demo.error {id,reason}`.

### Origin pinning (`demo-bridge-client.js:17-22, 345-373`)
`hostOrigin` is pinned from the **first** `demo.init` whose origin matches `document.referrer`'s origin
(if the referrer is absent, the first init is accepted and pinned). Afterwards any message from a different
origin is rejected, and every reply is posted with an **explicit** `targetOrigin`. This keeps a served app
from being driven by a hostile frame.

### Target discovery (`:66-83, 285-302, 304-330`)
Automatic: `currentTargets()` scans `[data-demo-target]` in the live DOM; a `MutationObserver`
(childList/subtree/attributeFilter=`data-demo-target`) re-emits `demo.targets-changed` on change (debounced
300 ms). `window.__ekoaDemo.registerDemoTargets(map)` is an escape hatch for dynamic targets (rarely needed).
`window.__ekoaDemo.emitResultReady(target, summary)` lets an app signal a result is on screen.

**How apps declare targets** — a hand-authored contract in each app scaffold:
- JSX carries literal `data-demo-target="kebab-name"` attributes
  (e.g. `api/assets/featured-artifacts/legal-calculos/scaffold/frontend/src/pages/JurosPage.jsx:150,161,214,230`).
- The React sugar `src/demo.js` (per app scaffold, canonical copy synced by `scripts/sync-legal-shared.mjs`)
  exposes `isDemoActive()`, `emitResultReady(target, summary)`, `registerDemoTargets(map)`, and the hook
  `useDemoResult(target, ready, summary)` which emits `result-ready` when `ready` flips true
  (`legal-calculos/scaffold/frontend/src/demo.js:29-64`). Without the bridge it all degrades to no-ops.

### Spotlight mask drawing (`drawOverlay`, `:119-184`)
A fixed, full-viewport `root` (`position:fixed;inset:0;z-index:2147483000;pointer-events:none`) holds a
"hole" div whose `box-shadow: 0 0 0 9999px rgba(15,23,42,0.5)` paints everything **except** the target
(`:128-139`), plus a teal outline + motion-safe `ekoaDemoPulse` keyframe (`:132-139,416-423`), plus an
optional tooltip card rendering `copy.titlePt`/`copy.bodyPt` (`:141-160`). `reposition()` follows the target
on scroll/resize (`:166-182`). `whenTargetAvailable()` polls up to `timeoutMs` before drawing or emitting
`demo.error` (`:187-199`). Await handling: clicks use a **delegated capture-phase document listener** that
survives SPA nav + React re-renders (`:246-267`); `result-ready` resolves from a cache or a visibility
fallback (target present with non-zero box) so a spec whose app never emits still advances (`:215-244`).

---

## 4. The dashboard player

Four pieces, all in `web/`:
- **`lib/demo/tour-machine.ts`** (`createTourController`, framework-free, unit-testable). Drives ONE spec
  over postMessage to the iframe's bridge. State: `idle → running/awaiting → done/cancelled/error`, with
  `stepIndex`, `awaitingManual`, `resultReady` (`:52-79`). Per-type execution in `runStep` (`:176-262`).
  Iframe control: navigation is a **full reload** of the iframe src via the host's `navigateApp`, then a
  re-handshake — `waitForNextLoad()` + `ensureConnected()` re-init the **fresh** bridge after every navigate
  (`:131-159,191-213`); `notifyIframeLoad()` (from the iframe `onLoad`) resolves load waiters and re-inits a
  bridge that appeared mid-step (`:376-386`); on `demo.ready` a pending `await`/`annotate` is **re-armed**
  against the new document (`:289-307`). Refresh-resume via `sessionStorage["ekoa-demo-tour"]` = `{appId,stepIndex}`
  (`:83-109`). Every inbound message is **origin-validated** against `appOrigin` (`:284`).
- **`components/demos/DemoTourProvider.tsx`** — mounted globally in the dashboard layout
  (`web/app/(dashboard)/layout.tsx:155`), renders **nothing** until the `?demo=<appId>` search param is set
  (`:30,64-107`). It fetches the spec from `/api/demos/:appId`, opens a **full-screen cross-origin iframe** of
  the served app (`api.appUrl(demoAppId)`), constructs the controller, and calls `controller.start(true)`
  (resume). `navigateApp` swaps `iframeSrc` (`:80-93`).
- **`components/demos/DemoOverlay.tsx`** — the floating host control card over the iframe. `pointer-events-none`
  so the user (and e2e) can click the highlighted element beneath it; only the controls opt back in
  (`:69-74`). Shows step counter, `copy` title/body, the suggested chat prompt with a copy button
  (`inject-prompt`), the external image, and the **Seguinte / Sair da demonstração** controls. Carries
  `data-demo-status` + `data-demo-step-index` for the deterministic e2e harness (`:66-68`).
- **`stores/demos.ts`** — a small Zustand store (`spec`, `tour`, `injectedPrompt`) the provider writes and the
  overlay reads.

**Launch mechanism — important for Phase 6:** the tour is activated **purely by the `?demo=<appId>` query
param** on any dashboard route. There is **no in-product gallery card, button, or link anywhere in `web/`
that constructs `?demo=`** (verified: the only reference outside the demo components is the layout comment,
`layout.tsx:155`). The e2e opens it directly with `page.goto('/artifacts?demo=<appId>')`
(`web/e2e/demos.spec.ts:196`). So the surviving "launcher" is a URL contract, not UI.

---

## 5. GAP ANALYSIS for Phase 6

Phase 6 (BRIEF.md:86-91) needs: (i) tours **generated at build time** per app — overview + one per main
journey; (ii) selectors are **registry-IDs stable across rebuilds**, not DOM paths; (iii) playback must
**ALSO work from inside the app's assistant panel**, not only the dashboard overlay; (iv) **zero tokens**.
Mapping each to the surviving stack:

**(iv) Zero tokens — ALREADY SATISFIED.** Playback is 100% client-side; the LLM is never called by the
player, and `inject-prompt` explicitly never auto-sends (`demo-registry.ts:94-97`). No change needed.

**(ii) Registry-ID selectors, rebuild-stable — MOSTLY THERE, needs unification.** Targets are resolved by
`[data-demo-target="<name>"]` **attribute selector**, never by DOM path (`demo-bridge-client.js:77-83`) — so
selector stability is already a solved problem *provided the same names survive a rebuild*. Today those names
are an **implicit hand-authored contract** between each spec and each app's JSX. Phase 4's action registry
(BRIEF.md:72 — `highlight(selector)`, `setField(id)`, `startTour(tourId)`, …) and Phase 6 must make the
**action-registry IDs and the `data-demo-target` names the same namespace**, emitted together at build time.
If registry IDs *are* the `data-demo-target` values, requirement (ii) falls out for free with no bridge change.

**(i) Build-time generation, overview + per-journey — TWO gaps.**
- *No generator exists.* All 28 specs are hand-authored static JSON. The registry loads from a **directory**
  (`loadDemoSpecs`, `demosDir()`), so a build step could simply **write** generated `<appId>*.json` into the
  served demos dir (or a per-app dir) and the loader picks it up — the ingestion side needs no change. The
  generator itself is net-new and belongs to the Phase 3 app base / Phase 4 registry work.
- *Registry is one-tour-per-app.* `getDemoSpec(appId)` returns the **first** match and `listDemoCards()` emits
  one card per `appId` (`demo-registry.ts:265-272`); `GET /api/demos/:appId` returns a **single** spec
  (`serving.ts:431-439`). "Overview **and** one per journey" means **multiple tours per app**, which the
  current key cannot express. **This is the single biggest schema+registry extension** (see extensibility below).

**(iii) In-app assistant-panel playback — the one genuinely NET-NEW component.** The entire host player
(`tour-machine.ts` + `DemoTourProvider.tsx` + `DemoOverlay.tsx`) is built around a **cross-origin iframe**
driven from the dashboard via postMessage. Inside the app itself (the Phase-5 assistant panel, same document,
no iframe) there is **no postMessage host↔frame boundary** — the bridge's host/app split simply doesn't apply.
What is reusable there: the **entire in-app half of the bridge** — `drawOverlay` (mask/hole/tooltip),
`whenTargetAvailable`, the `await` click/`result-ready` handling, target discovery — all already run *inside*
the app. What is NOT reusable: the transport. A same-document player must drive the bridge **directly** (invoke
its overlay/await logic in-window, or post to `window` itself and pin `hostOrigin === self.origin`) rather than
across an iframe. Concretely, Phase 6 needs a small **same-window tour controller** that reuses the drawing/await
primitives but replaces the iframe-postMessage transport; the existing cross-origin host player stays for the
dashboard-overlay path. Estimate: the reusable primitives are ~70% of the bridge by line count; the net-new
work is the transport shim + panel mount + a `startTour(tourId)` entry from the assistant.

**Schema extensibility (version field) — YES, extensible without breaking the 28 tours.** `version` is
`z.literal(1)` (`demo-registry.ts:125`) and the objects are `strictObject`/`additionalProperties:false`, so you
**cannot** silently add fields to a v1 spec. But the schema can grow two safe ways: (a) add **optional** fields
to the v1 object (e.g. `tourId?`, `kind?: "overview"|"journey"`) — existing specs omit them and stay valid; or
(b) introduce `version: 2` as a superset. The discriminated step union is additive (a new step type is a new
union member; the 28 specs are unaffected). **Recommended path:** stay on version 1, add an optional `tourId`
(+ optional `kind`) to the spec, allow multiple spec files per `appId`, and change the registry key from `appId`
to `(appId, tourId)` with `/api/demos/:appId` returning a **list**. The 28 hand-authored tours become the app's
default/journey tours; generated overviews are added alongside. No breakage.

**Two incidental findings (drift hazards, worth flagging to the operator):**
- **Duplicated spec catalog.** Specs exist in BOTH `api/assets/demos/` (what the registry serves, +`assets/`
  subdir) and `ekoa-data/demos/` (what the e2e reads, `web/e2e/demos.spec.ts:20`). `ekoa-data` is a real
  directory, **not a symlink**, and the two are currently **byte-identical** (`diff -rq` clean apart from the
  `assets/` subdir). Any build-time generator MUST write to the **served** location, and the e2e MUST read the
  same one, or the test will validate stale content while the app serves fresh (F16/F28-class drift). Consider
  collapsing to one source before Phase 6 adds generation.
- **Latent `placement`.** The bridge honours a `placement` field on `demo.spotlight`/`demo.annotate`
  (`demo-bridge-client.js:107-108,119`), but neither the spec schema nor the host ever sends it — spotlight
  placement is auto-flip only (`tour-machine.ts:217`). A cheap win for generated tours that want deterministic
  tooltip placement: expose `placement?` on the `spotlight`/`annotate-result` steps and pass it through.

---

## 6. `../ekoa-dev` archaeology — was anything richer dropped?

Checked the old codebase at `/Users/ggomes/dev/ekoa-dev` (READ-ONLY; no secrets copied). Grepped for
`demo`, `tour`, `tutorial`, `spotlight`. **The port is essentially 1:1 and nothing richer was left behind:**
- `cortex/src/services/demo-bridge-client.js` is **byte-identical** to `api/assets/demo-bridge-client.js`
  (`diff -q` reports identical).
- `ekoa/lib/demo/tour-machine.ts` is **byte-identical** to `web/lib/demo/tour-machine.ts` (identical).
- `ekoa/components/demos/DemoOverlay.tsx` is **byte-identical** to `web/components/demos/DemoOverlay.tsx`
  (identical); `DemoTourProvider.tsx`, `stores/demos.ts`, `lib/demo/types.ts`, `e2e/demos.spec.ts` all present
  and correspond.
- `cortex/src/services/demo-registry.ts` is **functionally identical** — same six step types, same
  `version: z.literal(1)`, same superRefine invariants. The only substantive differences are mechanical: the
  `select` "value-or-index" check moved from a per-member `.refine` into the top-level `superRefine` (zod-3
  constraint on discriminated-union members), and directory resolution changed from the old repo-relative
  `resolveEkoaDataPath('demos')` to `EKOA_DEMOS_DIR` / in-repo `api/assets/demos` (`demo-registry.ts:207-217`).

The old repo had **no separate or richer tutorial system** — no multi-tour-per-app, no in-app (same-document)
player, no additional step types, no tour-authoring UI. The old dashboard (`ekoa/`) launched tours the same
way (query param, no gallery). **Conclusion: there is nothing to salvage from `ekoa-dev` beyond what is already
ported.** Every Phase-6 capability that is missing is genuinely net-new work, not a re-port.

---

## Memo input — reuse-vs-new verdict (evidence for the Phase-2 decision memo)

**RUN_SPEC assumption 2 ("reuse + extend the surviving tour format"): CONFIRMED by evidence.** The surviving
Tutorial Bridge is a complete, hardened, zero-token declarative tour engine; ~80% of it is directly reusable
for Phase 6. Recommendation breakdown:

**REUSE as-is (the durable core):**
- The **declarative demo-spec format** (6 step types, PT-PT copy, card metadata) — `demo-registry.ts:26-168`,
  `_schema.json`. Directly serves Phase 6's "route + selector + text per step".
- The **zod registry + validator** and the **PUBLIC `/api/demos*` routes** — never-throws validation,
  directory loader, invalid-spec tolerance (`demo-registry.ts:190-257`; `serving.ts:407-439`;
  `api-contract.md:36`).
- The **injected bridge client** — postMessage protocol, origin pinning, `data-demo-target` discovery + mutation
  observer, and the **spotlight mask/tooltip drawing** (`demo-bridge-client.js`). The overlay-drawing and
  await-handling primitives are the crown jewels and are transport-agnostic.
- The **`data-demo-target` selector convention** — already attribute-based (rebuild-stable), already the natural
  join point with Phase 4's action-registry IDs.
- **Client-side, zero-token playback** — already the design; `inject-prompt` never auto-sends.

**EXTEND (bounded, non-breaking):**
1. **Multiple tours per app.** Add optional `tourId` (+ `kind: "overview"|"journey"`) to the spec, key the
   registry by `(appId, tourId)`, and return a list from `/api/demos/:appId`. Stays on `version: 1`; the 28
   existing specs remain valid (become the app's default/journey tour). This is the main schema/registry change.
2. **Build-time generation.** Phase 3 app base + Phase 4 registry emit tour JSON at build time whose
   `data-demo-target`/registry-ID namespace is shared with the action registry — the loader already ingests a
   directory, so only the *writer* is new. Collapse the `api/assets/demos` vs `ekoa-data/demos` duplication first.

**NET-NEW (the one real new build):**
- An **in-app / assistant-panel tour player** for same-document playback (Phase 6 requirement iii + Phase 5
  panel). It **reuses the bridge's `drawOverlay`/await primitives** but replaces the cross-origin
  iframe↔postMessage transport with a same-window driver and a `startTour(tourId)` entry point. The existing
  dashboard iframe player (`tour-machine.ts`/`DemoTourProvider.tsx`/`DemoOverlay.tsx`) is retained unchanged for
  the dashboard-overlay path.

**Net:** reuse the format + validator + routes + bridge wholesale; extend the schema minimally (optional
`tourId`) and add a build-time generator; write exactly one new component (the same-document player). The
schema is provably extensible without breaking the 28 shipped tours. No evidence contradicts assumption 2.
