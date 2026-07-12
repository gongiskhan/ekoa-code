VERDICT: approve

# Fresh-context review — slice C2 (commits b8ba9a9 + 72e229f)

Reviewer: fresh context, no implementer notes. Scope: the action-registry contract
(shared AppActionManifest schema + ui_actions emission capture at activation).

## Acceptance judgement

FLOW_PLAN C2 acceptance: "shared/ action-manifest schema
(navigate/setField/toggle/select/highlight/startTour + app-specific, destructive flag,
param types); builder emits it at build time; stored with the artifact; contract test
validates emitted manifests."

Met, on every clause:

- **Schema shape** — `shared/src/action-manifest.ts` defines `AppAction.kind` over exactly
  `navigate | setField | toggle | select | highlight | startTour | custom` (custom = the
  app-specific escape hatch), a `destructive: boolean` flag, and a typed `params` array
  (`string | number | boolean | option`). All present.
- **"builder emits it at build time"** — landed as: the coding agent DECLARES `ui_actions`
  in the app's MANIFEST.md, and the pipeline CAPTURES + validates + persists at activation.
  I judge this satisfies the acceptance intent (emission = the declared manifest reaching
  the artifact record, validated). The emission genuinely occurs in the LIVE flow, not only
  in tests: `api/src/agents/build.ts:255/308/317` populate `projectDir` from the real
  build, and pass it to `activateArtifact` at `build.ts:506`, which reads/validates/persists
  via `readUiActions`. The base-instruction that TEACHES the agent to author `ui_actions` is
  a later slice (per the task note) — out of C2 scope, correctly.
- **"stored with the artifact"** — `build-mechanics.ts` activateArtifact persists valid →
  `artifact.data.actionManifest`; invalid → `artifact.data.actionManifestError` (fail-loud,
  build still lands); absent → both keys cleared. Round-trip proven by the base-loader test.
- **"contract test validates emitted manifests"** — `action-manifest.contract.test.ts`
  validates the schema surface directly (no endpoint/response-envelope exists — the manifest
  travels inside MANIFEST.md + the artifact record, so the schema IS the correct contract
  target), and the base-loader round-trip validates an emitted-then-captured manifest E2E.

## Findings

No blocking findings.

Nits (non-blocking, not required to land):

- `shared/src/action-manifest.ts:61` (and 13 other added comment lines) use the em-dash
  "—". The user's global rule prefers plain "-". However em-dashes in comments are a
  codebase-wide convention (`api/src/apps/base-loader.ts` has 8, `manifest.ts` has 2, most
  files in `api/src/apps/`), so C2 reads like the surrounding code. Not C2-specific; the
  rule targets prose the assistant writes, not existing comment style. Flagging only.
- The reader test (`action-manifest.test.ts`) does not directly exercise `startTour requires
  tourId`, `option requires options`, or `max 200`. This is fully covered by the contract
  test (`startTour`, `option-without-options`, duplicate ids) and I independently verified
  all invariants against `shared/dist` (see EVIDENCE). Cross-file coverage is adequate.

## Constraint checks (all pass)

- `shared/src/action-manifest.ts` imports ONLY `zod` (line 16); nothing else. ✓
- No authorisation semantics in the schema — the only "authorisation"/"permission" tokens
  are explicit disclaimers ("server-side authorisation is asserted in the security block,
  never here"; "not an authorisation boundary"). `destructive` is documented as a
  client-confirmation UX affordance only. ✓
- Invariants are REAL and enforced (verified by running the schema against `shared/dist`):
  kebab-case id regex; navigate→route; startTour→tourId; setField/toggle/select/highlight→
  target; option param→non-empty options; duplicate-id rejection; `actions.max(200)`;
  `version` literal 1. All 16 assertions PASS. ✓
- Frontmatter fence regexes are BYTE-IDENTICAL (the codex finding fixed in 72e229f):
  `api/src/apps/action-manifest.ts:35` and `api/src/automation/manifest-parser.ts:165` both
  read `/^---\s*\n([\s\S]+?)\n---\s*(\n|$)/`. The drift the module header promises cannot
  happen is now structurally prevented; a regression test pins the trailing-whitespace
  tolerance. ✓
- Seam change is additive-optional: `activateArtifact` gains `projectDir?: string`
  (`seams.ts`). The one production caller (build.ts:506) and both non-projectDir test/mocks
  (`build.test.ts:30`, `build-mechanics.test.ts:94`) remain valid. Backward-compatible. ✓
- Diagram `docs/diagrams/05-data-model.excalidraw` parses as valid JSON (type "excalidraw",
  32 elements) and contains the 2 c2- elements (`c2-am-rect`, `c2-am-text`). Its text uses
  plain ASCII "->" arrows. No emoji anywhere in the two commits (pictographic-range scan =
  no matches; the earlier arrow/section-sign hits `→`/`§` are in code comments, not UI, and
  are not emoji). ✓
- PT-PT strings ("Novo cliente", "Guardar cliente", etc.) appear only in test fixtures and
  `labelPt` schema field descriptions — placeholders, not lawyer-facing rendered UI. No
  PT-PT-UI rule surface is introduced by this slice. ✓

---

## EVIDENCE

1. Diffs read in full (`git show b8ba9a9`, `git show 72e229f`).

2. `npx vitest run tests/apps/action-manifest.test.ts tests/contract/action-manifest.contract.test.ts tests/apps/base-loader.test.ts` (root api):
   `Test Files 3 passed (3) / Tests 18 passed (18)`. base-loader includes the activation
   persistence round-trip (valid→persisted, invalid→error persisted + manifest undefined,
   absent→both keys cleared).

3. `npx vitest run tests/contract/schema-coverage.test.ts` (root api):
   `Test Files 1 passed (1) / Tests 2 passed (2)` — the shared/ addition did not break the
   coverage gate.

4. Frontmatter regex comparison:
   - `api/src/apps/action-manifest.ts:35`: `/^---\s*\n([\s\S]+?)\n---\s*(\n|$)/`
   - `api/src/automation/manifest-parser.ts:165`: `/^---\s*\n([\s\S]+?)\n---\s*(\n|$)/`
   Identical.

5. `npx eslint` over all 8 changed files: exit 0 (clean).

6. Diagram: parsed via `JSON.parse` → type "excalidraw", 32 elements, 2 c2- ids
   (`c2-am-rect`, `c2-am-text`); c2 text uses "->" not em-dash/emoji. Emoji scan over both
   commits across pictographic Unicode ranges: no matches.

7. Invariant harness against `shared/dist/action-manifest.js` (16 assertions, ALL PASS):
   bad-kebab rejected / good-kebab accepted; navigate-no-route rejected / with-route ok;
   startTour-no-tourId rejected / with-tourId ok; setField/toggle/select/highlight-no-target
   each rejected; option-param-no-options rejected / with-options ok; duplicate-id rejected;
   200 actions ok / 201 rejected; version literal (2 rejected).

8. Live-flow capture confirmed: `projectDir` is defined at `build.ts:255`, assigned from
   `prep.projectDir` (308) / `resolved.projectDir` (317), and forwarded to `activateArtifact`
   at `build.ts:506` — so the declared manifest reaches `artifact.data.actionManifest` in a
   real build, not only under test.
