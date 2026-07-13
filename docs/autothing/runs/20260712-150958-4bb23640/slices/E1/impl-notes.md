# E1 — Build-time tour generation — impl notes

**Slice:** E1 (build-time tour generation: every app-base build emits declarative tours —
overview + per-journey — keyed to the action-registry's `data-demo-target` selectors).
**Branch:** operator-run. **Do NOT commit — the lead runs the gates.**

## What E1 delivers (and what it deliberately does not)

Per `FLOW_PLAN.md:62`, E1 is *generate + validate + **store with the artifact***. The panel
PLAYER and the rebuild selector-stability gate are **E2** (`FLOW_PLAN.md:63`, depends on E1).
So E1 captures declared tours deterministically at activation and persists them onto
`artifact.data.tours` — the exact plane C2 uses for `artifact.data.actionManifest`. No LLM
call is added (tours are declared by the build agent, which is already an LLM; capture is
deterministic).

## Design (mirrors the C2 `ui_actions` pipeline end-to-end)

C2 precedent: MANIFEST.md `ui_actions` → `readUiActions(projectDir)` (`api/src/apps/action-manifest.ts`)
→ `activateArtifact` persists `artifact.data.actionManifest` (`build-mechanics.ts:308`). E1
mirrors this shape rather than inventing a new plane.

1. **Schema extension — `api/src/services/demo-registry.ts`.** Added two OPTIONAL fields to
   `demoSpecSchema`: `tourId` (kebab, `TOUR_ID_RE`, exported) and `kind` (`overview|journey`).
   `strictObject` requires them to be declared on the schema to be accepted, so this is the
   correct additive move (A2 §5): the 28 shipped `legal-*.json` specs omit both and stay valid.
   Added `parseStoredTours(raw): DemoSpec[]` — pure, never-throws resolver over an artifact's
   `data.tours`, so the serving route (and E2's panel) revalidate stored tours through ONE
   validator (no drift with the writer).

2. **The writer — `api/src/apps/tour-writer.ts` (new).** `readTours(projectDir, { appId, knownTargets })`,
   modelled on `readUiActions`:
   - Two authoring channels (acceptance a): a `tours:` list in `MANIFEST.md` frontmatter
     (same frontmatter, `frontmatterOf` regex kept **byte-identical** to `action-manifest.ts`
     and `automation/manifest-parser.ts` per the codex C2 finding) **and** sibling
     `tours/*.json` files (identical shape to the shipped platform demos). Both channels merge;
     `tourId` is deduped across them.
   - Authored tours OMIT `appId` (the agent cannot know its artifact id); the writer STAMPS
     `appId = artifactId` and a default `version: 1`, then validates against the extended
     `demoSpecSchema`. The stored/served shape is therefore byte-identical to a hand-authored
     platform tour.
   - Fail-loud rules (acceptance e): missing/non-kebab `tourId`, missing/invalid `kind`,
     duplicate `tourId`, invalid YAML, or any schema failure → `{ status: 'invalid', error }`.
   - Target cross-validation (acceptance c): every step `target` (+ `simulate` targets) is
     checked against `knownTargets ∪ SHELL_LANDMARKS` (`app-shell/app-topbar/app-nav/app-content/
     assistant-root/home-empty`, from the base scaffold + `base-conventions.md`). Unknown →
     **warn, never fail** (the app may add its own `data-demo-target`s). `!= 1` overview → warn.

3. **Capture at activation — `api/src/apps/build-mechanics.ts` (`activateArtifact`).** Right beside
   the existing `ui_actions` capture: reads the declared `ui_actions` targets, passes them as
   `knownTargets` to `readTours`, and MERGES the result onto the data bag — `data.tours` on valid
   (warnings logged), `data.toursError` on invalid (fail-loud), both cleared when absent (a rebuild
   that removed the tours removes the surface). `build.ts` was **NOT touched** — activation already
   threads `projectDir` (`build.ts:506`), so no seam/prompt change was needed.

4. **Serving — `api/src/apps/serving.ts` (`GET /api/demos/:appId`).** Additive + backward-compatible:
   platform catalog first (`getDemoSpec`, the 28 tours, shape unchanged); on a miss, resolve the
   artifact (`getAppIdBySlug ?? raw id`, the same order `/apps/*` uses — both already imported) and
   return its **overview** tour (`kind:'overview' ?? first`) via `parseStoredTours`. The full
   overview+journey set stays on the artifact for the E2 panel. `serving.ts` was not in the reserved
   list, but acceptance (b) requires the route to serve generated tours; the edit is 15 lines,
   localised to that one handler, and it already imports `artifacts`/`getAppIdBySlug`/`Doc`.

5. **Authoring skill — `api/assets/bases/app/skills/authoring-tours.md` (new)** (acceptance d).
   Terse, mirrors `declaring-ui-actions.md`: where tours go (both channels), the shape of one tour,
   overview + per-journey convention, kebab `tourId` rules, `data-demo-target` = ui_actions
   namespace, PT-PT copy guidance (no emoji, no em-dash), "do not set appId".

6. **Docs kept truthful (no drift):** extended the served JSON-Schema mirror
   `api/assets/demos/_schema.json` with the optional `tourId`/`kind` (no test validates against it
   via ajv — it is a human mirror; kept honest anyway). Did **not** touch `ekoa-data/demos/_schema.json`
   (the duplicate A2 flags as a drift hazard — out of E1's lane).

## Diagram (non-negotiable)

Updated **`docs/diagrams/05-data-model.excalidraw`** — added the `artifact.data.tours` node
(id `e1-tours-text`, field-parity with the C2 `artifact.data.actionManifest` node it sits beside).
That is the affected diagram: E1's structural change is the new `artifact.data.tours` data shape.
`03-request-crud`'s demo node is about C3's injected runtime (unchanged by E1); not touched.

## Constraints honoured

Import boundaries (writer in `apps/` imports `services/demo-registry` + `@ekoa/shared`; registry
still imports only fs/zod — no `data/` reach-in, kept pure); no `@anthropic-ai` (chokepoint gate
clean); PT-PT user-facing copy; no emoji; no permission logic.

## Validation (exact commands + results)

| Command | Result |
|---|---|
| `npx vitest run tests/apps/tour-writer.test.ts --root api` | **19 passed** |
| `cd api && npx tsc --noEmit` | **exit 0** |
| `npx eslint api/src/apps/tour-writer.ts api/src/services/demo-registry.ts api/src/apps/build-mechanics.ts api/src/apps/serving.ts api/tests/apps/tour-writer.test.ts` | **exit 0** |
| `npm run gate:chokepoint --silent` | **clean, exit 0** |
| `npx vitest run tests/services/demo-registry.test.ts --root api` | **4 passed** |
| `cd api && npx vitest run tests/apps/action-runtime.test.ts tests/agents/build.test.ts tests/contract/served-app.test.ts tests/contract/schema-coverage.test.ts` | **50 passed** |
| `cd api && npx vitest run tests/apps/build-mechanics.test.ts` | 11 passed, **1 pre-existing failure** (see below) |

**Pre-existing failure (NOT E1):** `build-mechanics.test.ts > assertProgress … "does not flag a
valid plain-HTML app"`. Confirmed by re-running with my `build-mechanics.ts` edit `git stash`ed
out — it fails identically. Root cause is `assertProgress` signal 1b (base `mustEdit` untouched)
firing because `classifyArtifactType('A static page')` resolves to a base without model credentials
in this env; unrelated to E1 (E1 only adds an additive block to `activateArtifact`, a different
method). Flagged for the run owner; not fixed here (out of slice + could collide with other agents).

## Test coverage (`api/tests/apps/tour-writer.test.ts`, 19 tests)

Schema round-trip incl. the tourId/kind extension; **28-legacy backward-compat** (every real
`api/assets/demos/legal-*.json` still validates under the extended schema and carries neither new
field); `parseStoredTours` drops-invalid/keeps-valid/non-array; both authoring channels + appId
stamping; cross-channel `tourId` dedup; unknown-target **warn** (and no-warn on shell landmarks);
kebab/dup/kind/invalid-YAML fail-loud rules; and the **capture-at-activation path** (mongo-mem +
real `activateArtifact` → asserts `data.tours` stamped, `data.toursError` on invalid, neither key
when absent).

## Reserved-path deltas
- Touched (in reserved set): `api/src/services/demo-registry.ts`, `api/src/apps/tour-writer.ts` (new),
  `api/src/apps/build-mechanics.ts`, `api/assets/bases/app/skills/authoring-tours.md` (new),
  `api/tests/apps/tour-writer.test.ts` (new), `docs/diagrams/05-data-model.excalidraw`, this file.
- Touched (NOT in the reserved list, justified above): `api/src/apps/serving.ts` (acceptance b),
  `api/assets/demos/_schema.json` (doc mirror parity).
- `api/src/agents/build.ts`: **not touched** (activation already threads `projectDir`).
