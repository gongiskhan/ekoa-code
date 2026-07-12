VERDICT: approve

# B3 fresh-context review — commit 3f06499

Slice B3: "base-manifest per-build verification (closes F16/F28 class)".
Acceptance (FLOW_PLAN L52): *"verify-runner asserts base-manifest files were replaced/extended
by generation; a deliberately untouched-base build FAILS verification; test proves both directions."*

All three acceptance clauses are satisfied, backward-compat holds, the diagram is updated and
valid, and there is no emoji in the change. The one genuine judgment call — placement in
`assertProgress` rather than `verify-runner` — is not just acceptable, it is the architecturally
correct home and strictly better than the literal wording. Reasoning below.

## Placement judgment (the load-bearing call): SATISFIES intent

The one-line acceptance names `verify-runner`, but the slice's operative intent — read from its
title ("base-manifest **per-build verification**") and body ("a deliberately untouched-base build
**FAILS verification**; **test proves both directions**") — is a *deterministic per-build gate that
reliably fails untouched-base builds and is provable in both directions by a committed test*. The
implementer landed it as signal 1b in `assertProgress` (the deterministic honest-completion gate),
not in the LLM playwright `verify-runner`. That placement is correct, for five reasons grounded in
the code I read:

1. **Determinism / testability.** The acceptance demands a build that FAILS both-directions provably
   by a committed unit test. `assertProgress` is a pure deterministic function (git file-diff),
   directly unit-assertable with no model credential — which is exactly what the B3 test does.
   `verify-runner` is a non-deterministic LLM agent (`verify-runner.ts:72-110`, `runAgent` +
   `parseVerdict`); "proves both directions" cannot be asserted through it without stubbing the model.

2. **`verify-runner` does NOT fail on a missing credential.** `verify-runner.ts:75-77` returns
   `{ran:false}` when `claudeAuthStatus().ok` is false, and `build.ts:489` treats a not-run as a
   note, never a failure. A mustEdit check placed inside `verify-runner` would SILENTLY NOT RUN
   whenever credentials are absent/latched — i.e. fail to gate. `assertProgress` runs
   unconditionally (`build.ts:438`, step 5a) and a hit is a hard `BUILD_UNFULFILLED` terminal
   (`build.ts:439-448`).

3. **`verify-runner` is BLIND to this exact failure.** The whole reason B3 exists (its own comment +
   diagram text): a base shell "serves plausibly without user content", so the generic scaffold
   fingerprint never fires. `verify-runner`'s SCAFFOLD CHECK (`verify-runner.ts:152-155`) keys off
   those SAME generic markers ("Powered by Ekoa", "scaffold-root", ...), and its ACCEPTANCE CHECK is
   an LLM judgment that a plausible-looking shell can pass. Putting the check in the LLM prompt would
   inherit the very blindness B3 is created to fix; a deterministic file-diff is the only reliable catch.

4. **Ordering + billing.** `assertProgress` runs BEFORE `verify-runner` (step 5a before step 5)
   precisely "so a scaffold build is never billed a verification pass" (`build.ts:432-437`). An
   untouched-base build is thus caught before it ever reaches the paid LLM verifier — strictly better
   than gating inside it.

5. It IS the F16 honest-completion gate; the slice title says "closes F16/F28 class". Signal 1b is a
   natural per-base refinement of the existing signals 1/2/3 already living there.

Conclusion: "verify-runner" in the one-line acceptance is loose shorthand for "the per-build
verification stage". The operative requirement (deterministic FAIL of an untouched-base build, both
directions proven by a committed test) is met by `assertProgress` and could NOT be met as robustly
inside `verify-runner`.

## Acceptance clause-by-clause

- **"asserts base-manifest files were replaced/extended by generation"** — MET. `base-loader.ts:56`
  adds `mustEdit: z.array(z.string().min(1)).optional()`. `build-mechanics.ts:345-365` (signal 1b)
  resolves the project's base, reads `manifest.mustEdit`, and diffs each path against the scaffold
  ROOT commit (`git rev-list --max-parents=0 HEAD` → `git diff --name-only <root> --`). Any mustEdit
  path absent from the diff is "untouched" and forces `clean=false` (`build-mechanics.ts:389`).
- **"a deliberately untouched-base build FAILS verification"** — MET. Test `before.clean === false`
  and the reason contains `frontend/src/documentData.js`.
- **"test proves both directions"** — MET. The committed test
  (`base-loader.test.ts:132-155`) runs `assertProgress` on an untouched `document` base (fails,
  names the file), then fills + commits `documentData.js` and re-runs (`after.clean === true`, reason
  no longer mentions "modelo interno por preencher").

## Correctness notes (verified, non-blocking)

- The ROOT-commit assumption is sound: `scaffold.ts:99-113` makes the base scaffold the initial
  commit (`commit --no-verify -m 'Initial scaffold'`), so `--max-parents=0 HEAD` is the scaffold
  baseline. The passing test confirms it end-to-end through the real `prepareFirstBuild` path.
- `git diff --name-only <root> --` compares root to the WORKING TREE, so it catches both committed and
  uncommitted edits to tracked mustEdit files — robust either way (test commits, matching prod's
  snapshot path).
- Signal 1b fails OPEN on git/manifest errors (try/catch → no gate). Consistent with the defensive
  posture of neighboring signals (2/3 also swallow read errors); signals 1/2 still gate scaffold
  builds. Acceptable design choice.

## Findings

- N1 (nit, non-blocking) — `api/assets/bases/app-auth-persistent/manifest.json:6`. mustEdit
  `frontend/src/App.jsx` is authored but NOT directly exercised by a test (the both-directions test
  covers only `document`). The acceptance ("test proves both directions") is satisfied by the
  `document` base, so this is not a gap against B3. The path is nonetheless sound: `app-auth-persistent`
  ships no `scaffold/` dir, so a project extending it gets `frontend/src/App.jsx` from the generic
  starter (`scaffold.ts:55`) — the mustEdit target exists in a built project. Consider a direct
  assertion once `app-auth-persistent` is selectable; not required for B3.
- N2 (informational) — `api/assets/bases/app/manifest.json` already carries mustEdit locally, which
  looks like it contradicts the commit message ("the app base gets its entry when B2 lands"). It does
  NOT: `git ls-files api/assets/bases/app/manifest.json` is empty (the file is untracked B2 WIP) and
  the B3 diff touches 0 files under `bases/app/`. The commit message is accurate; nothing for B3.
- N3 (governance, non-blocking) — `api/tests/apps/base-loader.test.ts` is not explicitly named in the
  `docs/testing.md` suite ledger. This file was created by B1 (already gate-passed) and B3 only adds
  one `it(...)` case to it — no new suite. Flag for testing governance if the ledger tracks per-file;
  not a B3 blocker.

## EVIDENCE

1. **Diff read in full.** Code files (`base-loader.ts`, `build-mechanics.ts`, both manifests, the
   test) read via `git show`. The 1886-line diagram diff is Excalidraw re-serialization, not content
   change (see item 5).

2. **Test suite (own run):** `npx vitest run tests/apps/base-loader.test.ts --root api`
   → `Test Files 1 passed (1) / Tests 8 passed (8)`, incl. the both-directions gate test
   `assertProgress FAILS a deliberately untouched base build and PASSES once mustEdit files are filled`.

3. **Backward-compat (own run):** loaded every base via `loadBase`:
   `landing`, `presentation`, `app-integration-heavy` → `mustEdit=null` (field absent → optional →
   valid, unchanged behavior); `document` → `["frontend/src/documentData.js"]`. `mustEdit` is
   `.optional()`, and signal 1b guards `mustEdit.length > 0`, so a base without it is a no-op on the
   gate. Bases WITHOUT mustEdit load and gate exactly as before.

4. **Diagram (own run):** `docs/diagrams/09-qa-pipeline.excalidraw` parses as valid Excalidraw JSON
   (`type: excalidraw`, 27 elements). Contains 2 `b3-` elements (`b3-gate-rect`, `b3-gate-text`) with
   PT/EN text describing the base-signal gate. Before/after element-id diff vs HEAD~1: +2 (`b3-gate-rect`,
   `b3-gate-text`), −0 — no prior diagram content lost.

5. **Emoji:** scanned all ADDED (`^+`) lines of the code diff for emoji + arrow ranges — none. The two
   `→` in `build-mechanics.ts:64,182` are PRE-EXISTING comment lines outside the B3 hunks (verified),
   and are code comments, not UI.

6. **PT-PT consistency:** the new reason `ficheiro(s) do modelo interno por preencher: <files>`
   (`build-mechanics.ts:382`) matches the register and pluralization style of its neighbors
   (`frontend/src está inalterado desde o modelo inicial`, `a aplicação compilada continua o modelo
   Ekoa`, `ficheiro(s) HTML solto(s) na raiz nunca servidos`). European Portuguese, consistent.
