VERDICT: approve

# B1 fresh-context review — base registry + loader + build-flow selection

Slice B1 = e879e06 (feat: base registry + loader + build-flow selection) + d1247b4 (fix: fail-loud on unsafe base paths).
Reviewer gathered all evidence independently (ran tests/eslint/greps, parsed the diagram, read both diffs in full, read the recorded J3 output). No implementer notes consulted.

## Acceptance criteria — all met

| Criterion | Verdict | Evidence |
|---|---|---|
| Loader reads `api/assets/bases/<id>`, manifest zod-validated | MET | `base-loader.ts` `basesDir()` = `join(__dirname,'..','..','assets','bases')`; `loadBase` parses `manifest.json` via `baseManifestSchema.safeParse` and cross-checks `manifest.id === dir`. Unit test loads real `document`/`app-auth-persistent` content. |
| Build flow selects a base via `templateId` with deterministic fallback | MET | `build-mechanics.ts` `baseFor()`: unknown id → `console.warn` + `null` (generic starters); known id → `loadBase`. `prepareFirstBuild` calls it. Deterministic (no randomness). |
| Scaffold consumes base scaffold via `templateScaffoldFiles` | MET | `prepareFirstBuild` calls `scaffoldApp({ ..., ...(base ? { templateScaffoldFiles: baseProjectFiles(base) } : {}) })`. `scaffold.ts:172` consumes it. Integration test asserts `documentData.js` (base-only file) lands in the project. |
| Generic starters remain the no-base fallback | MET | When `base` is `null`, no `templateScaffoldFiles` key is passed; `scaffold.ts:172` guard `if (templateScaffoldFiles && length>0)` is skipped → starter path unchanged. Test asserts `"Let's build something"` starter present with no `templateId`. |
| Base linkage persists as manifest `extends` | MET | `prepareFirstBuild` sets `m.extends = base.id; writeManifest(...)`. Integration test asserts `manifest.extends === 'document'`. |
| Base prompt sections reach the build system prompt on first AND follow-up builds | MET | First: `prep.basePromptSections` → `build.ts:` spread into `systemPrompt`. Follow-up: `resolveFollowUp` → `baseOfProject` reads `manifest.extends` and re-loads → `resolved.basePromptSections` → same spread. Test asserts both `prep.basePromptSections` and `followUp.basePromptSections` non-empty. Ordering (contentSections, base sections, grounding, BUILD_SYSTEM_PROMPT) is intentional and documented. |
| J3 green | MET (see note) | Recorded live-stack run: 14 PASS / 0 FAIL, `J3 exit=0`, build1 completed 86s. |
| Unit + contract tests committed | MET (contract N/A) | 7 committed tests in `api/tests/apps/base-loader.test.ts` (loader unit + real-scaffold integration). No new endpoint and no `shared/` schema surface introduced (diff touches no `shared/` or `routes/` file), so the "new endpoint → new contract test" rule does not apply; the contract portion is vacuously satisfied, not a gap. |

## Constraints — all satisfied

- **`agents/` must NOT import `apps/` (data flows through the BuildMechanics seam only).** VERIFIED. `api/src/agents/build.ts` has zero `apps/` imports (full import list: `@ekoa/shared`, `../config`, `../billing`, `../llm`, `../memory`, `../data`, `./streaming`, `./markers`, `./branding`, `./tools`, `./sdk-tools`, `./guided-build`, `./seams`, `../data/activity`). Base data crosses as plain `string[]` (`basePromptSections`) on the `FirstBuildPrep`/`FollowUpResolution` seam interfaces in `seams.ts`. `seams.ts` references `apps/` only in prose comments (lines 5, 250, 280), no `import` from `apps/`. eslint clean on `build.ts` and `seams.ts` (`import/no-restricted-paths` did not fire).
- **Default path byte-identical when no `templateId`.** VERIFIED by construction: with `base === null`, `prepareFirstBuild` passes `scaffoldApp` the identical arg set (spread adds nothing), returns no `basePromptSections` key, and `build.ts` `?? []` yields an empty spread into `systemPrompt` — no change to the assembled prompt or scaffold. J3 build1 (no `templateId`) completed live in 86s, corroborating the default path is unbroken.
- **Diagram `07-content-composition.excalidraw` updated.** VERIFIED. Parses as JSON (35 elements); contains the B1 elements `b1-base-rect`, `b1-base-text`, `b1-base-arrow`.
- **No emoji in code.** VERIFIED. Pictographic-emoji scan of all six changed code files = 0 hits. (The `→` glyphs flagged by a broad scan are typographic arrows in backend comments — a pre-existing convention: 7 already present in `build.ts` before B1 — not emoji; not a finding.)

## Findings

None blocking. No correctness, boundary, or contract issues found. Notes below are observations, not findings:

1. `manifest.ts` doc comment for `extends` changed semantics from "if absent, loader applies default base `app-auth-persistent`" to "absent = no base (generic starters)". This matches the implementation (no default base is applied) and is internally consistent — correctly documented, not a defect.
2. J3 exercises the DEFAULT build path live (build1 used no `templateId`); it is the live regression gate proving B1 did not break the unchanged default flow. The base-SELECTED path (scaffold-from-base, `extends` persistence, prompt-section round-trip) is covered by the committed real-scaffold integration test (real scaffold + esbuild + in-memory Mongo, no model call), which is the appropriate layer for it. Together they cover the acceptance; "J3 green" is satisfied.

## EVIDENCE

- `git show e879e06 --stat` / `git show d1247b4 --stat` — 7 files (commit 1) + 2 files (commit 2); read both diffs in full.
- `npx vitest run tests/apps/base-loader.test.ts --root .` (in `api/`) → **7 passed / 7**, 1 file passed. (Commit 1 added 6, commit 2 added the fail-loud regression test = 7.)
- `npx eslint api/src/apps/base-loader.ts api/src/apps/build-mechanics.ts api/src/agents/build.ts` → exit 0, no output.
- `npx eslint api/src/agents/seams.ts` → exit 0 (extra check for the seam layer).
- `grep -n "from '../apps" api/src/agents/build.ts` → no match (exit 1). Full import inventory of `build.ts` confirms no `apps/` import; grep confirms the diff added none.
- `grep -n "apps/" api/src/agents/seams.ts` → only comment lines (5, 250, 280); no `import` from `apps/`.
- `grep -n "anthropic" api/src/apps/base-loader.ts api/src/apps/build-mechanics.ts` → no match (egress chokepoint respected).
- `git diff --name-only e879e06~1 d1247b4 | grep -E "shared/|routes/"` → NONE (no contract/endpoint surface changed).
- Diagram: `python3 json.load` on `docs/diagrams/07-content-composition.excalidraw` → valid JSON, 35 elements, 3 `b1-`-prefixed ids present.
- Emoji: pictographic-emoji regex over all 6 changed code files → 0 hits; `→` arrows confirmed pre-existing (7 in `build.ts` at `e879e06~1`).
- Byte-identical default: `scaffold.ts:172` guard `if (templateScaffoldFiles && templateScaffoldFiles.length > 0)`; `build-mechanics.ts` spreads nothing when `base` is null; `build.ts` `basePromptSections = prep.basePromptSections ?? []`.
- J3: read `/private/tmp/claude-501/-Users-ggomes-dev-ekoa-code/58cf19c3-b947-4cf9-9a69-f6b01a56b20f/tasks/bngvwmymj.output` → setup 6 PASS, build1 4 PASS (SSE complete 86s), served 4 PASS, `J3 exit=0`; total 14 PASS / 0 FAIL on a live credentialed stack (base=http://localhost:4111). Treated as recorded gate evidence per instructions.
