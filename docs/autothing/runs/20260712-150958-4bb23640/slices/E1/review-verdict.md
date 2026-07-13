# E1 — Fresh-context review verdict

**Reviewer:** fresh-context (no implementer context). **Scope:** commits `8724dea`
(build-time tour generation) + `24bffeb` (red-baseline fix). **Branch:** operator-run.
All findings below are backed by evidence I gathered myself (commands re-run, not trusted).

## Verdict summary

Every E1 acceptance criterion (run-plan a–e) is met, the diagram invariant is honoured,
and all gates I re-ran are green. The design faithfully mirrors the C2 `ui_actions`
pipeline and introduces no new trust-boundary, contract, or egress risk. I found **no
blocking issues**. Three low-severity, non-blocking observations are recorded for the
run owner.

## Evidence I re-ran (my own, not reported values)

| Check | Command | Result |
|---|---|---|
| Test suite | `npx vitest run tests/apps/tour-writer.test.ts tests/services/demo-registry.test.ts tests/apps/build-mechanics.test.ts tests/apps/artifact-type.test.ts tests/contract/served-app.test.ts` | **5 files, 60 tests passed** |
| Typecheck | `cd api && npx tsc --noEmit` | **exit 0** |
| Lint | `npx eslint` on the 7 changed TS files | **exit 0** |
| Chokepoint | `npm run gate:chokepoint --silent` | **clean** (no `@anthropic-ai/` / `api.anthropic.com` outside `api/src/llm/`) |
| Diagram | `python3 json.load(05-data-model.excalidraw)` | **parses; 33 elements; `e1-tours-text` present** with accurate `artifact.data.tours` text |
| Emoji/em-dash | perl unicode grep over skill + writer | **clean** |

Note: the build-mechanics "plain-HTML app" spec that impl-notes flagged as a
pre-existing red baseline is **green** in my run — `24bffeb` fixed it.

## Acceptance verification (run-plan E1 a–e)

- **(a) two authoring channels** — `tour-writer.ts:85-127`: `tours:` list in
  `MANIFEST.md` frontmatter (`toursFromManifest`) **and** sibling `tours/*.json`
  (`toursFromFiles`); merged at `:139`, `tourId`-deduped at `:162-166`. Tested
  (`tour-writer.test.ts:152-183`). PASS.
- **(b) captured at activation, extended-schema-validated, 28-legacy-safe, persisted,
  fail-loud, served additively** — schema extension is two OPTIONAL fields on the
  `strictObject` (`demo-registry.ts:133-140`); capture at `build-mechanics.ts:331-361`
  onto `artifact.data.tours`/`toursError` (both cleared each activation, `:355-359`);
  `GET /api/demos/:appId` platform-catalog-first then artifact-overview fallback
  (`serving.ts:451-479`). 28-legacy compat proven against the **real** assets dir
  (`tour-writer.test.ts:109-123`, iterates `readdir('../../assets/demos')`, not a
  fixture). PASS.
- **(c) selector cross-validation, unknown = WARN** — `tour-writer.ts:186-199` checks
  each step/simulate target against `SHELL_LANDMARKS ∪ knownTargets`; unknown pushes a
  warning, never an error; `!= 1` overview also warns. Tested (`:188-210`). PASS.
- **(d) terse authoring skill in the app base** — `api/assets/bases/app/skills/authoring-tours.md`,
  mirrors `declaring-ui-actions`, PT-PT, no emoji/em-dash. PASS.
- **(e) tests** — schema round-trip + tourId/kind reject, 28-legacy compat, both
  channels + stamping, cross-channel dedup, unknown-target WARN + no-warn-on-landmark,
  kebab/dup/kind/invalid-YAML fail-loud, and the capture-at-activation path
  (mongo-mem + real `activateArtifact`). All present and green. PASS.

No LLM in the writer (chokepoint clean, no `@anthropic-ai` import). No permission logic.

## Specific-risk findings (all resolved)

1. **C2 frontmatter-regex fidelity — PASS.** All three parsers carry the identical fence
   regex `/^---\s*\n([\s\S]+?)\n---\s*(\n|$)/`: `tour-writer.ts:68`,
   `action-manifest.ts:35`, `automation/manifest-parser.ts:165` (grep-verified
   byte-identical). The prior codex C2 finding remains satisfied.
2. **Serving fallback safety — PASS.** The fallback revalidates stored tours through
   `parseStoredTours` (`serving.ts:467`, `demo-registry.ts:295-304` — drops invalid,
   never throws). Slug→id resolution `getAppIdBySlug(appIdParam) ?? appIdParam`
   (`serving.ts:467`) is behaviorally identical to the `/apps/*` route's
   `getAppIdBySlug(x) || x` because `getAppIdBySlug` returns `string | undefined`
   (empty → undefined, `slug-index.ts:14-16`), so no cross-app leak or empty-string
   divergence. Success shape is always a `DemoSpec` (unchanged); the 404 body is
   unchanged. `/api/demos` is not in the `shared/` descriptor map (legacy public route),
   so no contract test can be broken — the route stays contract-compatible.
3. **Resource limits + traversal — PASS (traversal), advisory (limits).** `readdir` of
   the fixed `tours/` subdir returns basenames only, filtered to `.json`/non-`_` and
   `join`ed to that dir — no `..` traversal reachable. See Observation A on caps.
4. **Activation fail-loud symmetry — PASS.** `toursError` handling
   (`build-mechanics.ts:341-350`) is symmetric with the C2 `actionManifestError` block
   directly above it — valid→`tours`, invalid→`toursError` (logged), absent→neither;
   both keys deleted before the merge. Not a silent drop.
5. **`24bffeb` signal widening — PASS.** I ran 14 adversarial phrasings through the exact
   post-`24bffeb` `SIGNALS` array with the real earliest-match logic. Results are
   correct: `"A static page"`→landing (deterministic, no model call); leading app/doc/
   report words win when earlier (`"app com uma static page…"`→app,
   `"contrato numa static page"`→document, `"relatório numa static page"`→report); and
   the plural `"aplicação que gera páginas estáticas"` correctly does **not** false-match
   the `página estática` sub-phrase (→app). All C1 pins preserved
   (`"Landing page…"`→landing, `"app para gerar contratos"`→app). Earliest-match ordering
   intact; the widening reuses the existing, C1-pinned tiebreak rather than adding a new
   ambiguity class.
6. **28-legacy test honesty — PASS.** The test iterates the real
   `api/assets/demos/*.json` via `readdir` and asserts `>= 28` files each still validate
   and carry neither new field — not a fixture (`tour-writer.test.ts:109-123`).
7. **E2 handoff — PASS.** `build-mechanics.ts:343` stores `res.tours` (the FULL
   overview+journey set); `serving.ts:471-475` serves overview-only
   (`kind:'overview' ?? tours[0]`). The activation test asserts both `visao-geral` and
   `criar-cliente` land on the artifact (`tour-writer.test.ts:270`). The full set is
   available for E2's panel; the route stays single-spec.

## Non-blocking observations (for the run owner, not gating)

- **A. No file-count/size cap on `tours/*.json` reads** (`tour-writer.ts:108-127`).
  Input is agent-authored inside the build sandbox and this matches the existing
  uncapped `loadDemoSpecs` directory read, so it is consistent with current posture —
  but a runaway generation is unbounded. Cheap hardening (cap count + per-file size)
  would be worth a follow-up. Not an E1 acceptance gap.
- **B. `/api/demos/:appId` 404 body `{ error: string }` is not the shared error
  envelope.** This is PRE-EXISTING (the legacy public route already returned this
  string shape; `8724dea` preserves it byte-for-byte). Flagging only because the QA
  policy asks every non-2xx body to validate against the envelope; the route predates
  and sits outside the `shared/` descriptor map. Not introduced by E1.
- **C. `TOUR_ID_RE` admits purely numeric ids** (e.g. `"123"`). Harmless; noted for
  completeness.

## Diagram invariant

`docs/diagrams/05-data-model.excalidraw` gained node `e1-tours-text` describing the new
`artifact.data.tours` shape (`DemoSpec[]`, optional `tourId`+`kind`). The file parses as
JSON and the node text is accurate. The structural change travels with its diagram.

VERDICT: approve

## Post-review reconciliation (commit 64c2cea)

This fresh review's Finding 3 (resource limits — rated *advisory*) and the codex slice review's
findings (1 high: client-writable tours served publicly; 2/3 med: unbounded/symlink reads + missing
serving tests) were ALL addressed in 64c2cea after this verdict:
- `tours`/`toursError`/`actionManifest`/`artifactType` are now server-owned reserved keys (stripped
  from client patches); the serving fallback filters by `t.appId === resolvedId` (provenance).
- `tours/*.json` reads bounded (≤50 files, 256 KiB/file) + symlink-escape rejected via lstat/realpath.
- New `serving-tours.test.ts` (14 cases) pins the strip + fallback safety; 3 new writer bound tests.
64 tests green after the fix. The approve verdict stands and is strengthened.
