# F16: The build serves the untouched scaffold - the real app is orphaned, job reports completed

**Severity / class:** high / bug (the priority journey's headline defect)

**Symptom:** Both builds report `status:completed` but `GET /apps/<slug>/` serves the Ekoa scaffold
placeholder ("Let's build something that will change" / "Your app is being created..." / "Powered by
Ekoa"), not the requested app. The model wrote the real, correct app into a standalone `pessoa.html`
at project root - never the served entrypoint - and never touched `frontend/src/App.jsx` (the manifest
entrypoint that compiles to `dist/bundle.js`). Evidence:
`docs/release/evidence/J3-build/build1-analysis.json` (buildCommit "added ONLY pessoa.html ... did NOT
modify frontend/src/App.jsx or rebuild dist/"; bundleJsContent "0 occurrences of Pessoa; 9 scaffold");
`j3-render-v1.json` (buttonCount 0, pessoaContentPresent false); `build2-verify-theater.md` (on-disk
mtimes: App.jsx untouched at build#1 time, pessoa.html + dist rebuilt at build#2 from scaffold App.jsx).

**Root cause (verified by reading code):**
- (a) The build agent is never pinned to the manifest entrypoint. `api/src/agents/build.ts:293-312`
  calls `runAgent` with `prompt: input.description` and NO `systemPrompt`; `api/src/llm/client.ts:320`
  sets `settingSources: []`, so no host/project CLAUDE.md loads either. The agent gets the coding preset
  (Write/Edit/Bash, `agents/tools.ts:13`) + cwd=projectDir and the bare description - nothing names
  `frontend/src/App.jsx`, so it freely created `pessoa.html`.
- (b) No honest-completion assertion. The completion sequence (`build.ts:334-360`) runs finalizeBundle ->
  snapshot -> verify, then `sink.complete` + `patchJob status:'completed'` gated ONLY on `bundle.ok`
  (`build.ts:355`). Nothing checks that the entrypoint source was edited, that dist content changed, or
  that no orphan top-level HTML was written.
- (c) The compile step always compiles the manifest entrypoint regardless of where the agent wrote.
  `build-mechanics.ts:142-158` finalizeBundle -> `appBuilder.build` -> `builder.ts:445`
  (`entryPoint = manifest?.entryPoint ?? 'frontend/src/index.jsx'` -> App.jsx). `pessoa.html` is never an
  entrypoint. `bundleValid` (`build-mechanics.ts:66-73`) checks IIFE format / plain-HTML only, not
  content - so a scaffold App.jsx compiles to a valid bundle and passes.

**Fix scope:**
- Honest-completion gate in the completion sequence (`build.ts` after finalizeBundle/snapshot, or a
  `mech.assertProgress` seam in `build-mechanics.ts`): fail/flag a build whose manifest-entrypoint source
  subtree (`frontend/src/`) is unchanged vs the scaffold baseline commit (git diff against the "Initial
  scaffold" parent, `scaffold.ts:110`) AND/OR whose `dist/bundle.js` still fingerprints as the scaffold,
  especially when an orphan top-level `*.html` was written. A gate hit is a non-success terminal (surface
  it; never report `completed` as a clean pass over it).
- Steer the agent: add a build `customSystemPrompt` (via the seam / `runAgent`) naming the manifest
  entrypoint (`frontend/src/App.jsx`) and stating that standalone top-level HTML files are never served.
- NON-goals: do not try to make the model never err (make the SYSTEM catch it); do not change plain-HTML
  apps (§7.2.1) whose valid served index carries no bundle; F28 owns the verification gate.

**Regression test first:** `api/tests/agents/build.test.ts` (in-process, `setBuildMechanics` /
`setVerifyRunner` seams as the suite already uses): stub mechanics so the agent leaves the entrypoint
subtree untouched and writes an orphan top-level HTML (dist fingerprints as scaffold). Assert the job
does NOT reach a clean `completed` - it flags/fails the honest-completion gate and the terminal state
says so. Must fail before the fix.

**Acceptance:** a build that leaves the manifest entrypoint unedited / dist scaffold-identical no longer
reports a clean `completed`; a build that edits `frontend/src/App.jsx` and rebuilds a real bundle still
completes; `build.test.ts` + schema-coverage green; re-run J3 build#1/#2 shows a flagged/failed terminal,
not a green completion over a scaffold.

**Notes:** No LLM egress change - builds stay agent -> chokepoint (FIXED-3/8/13); the added systemPrompt
still flows through `runAgent`'s anonymise path (`client.ts:644`). Boundaries hold: `agents/` reaches
mechanics only via the `agents/seams.ts` injected seam. Update the ch05/ch07 build->serve completion
diagram to add the honest-completion gate + its failed branch (FIXED-12).
