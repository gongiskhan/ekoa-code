# F28: Per-build verification passes a scaffold placeholder as a working app

**Severity / class:** high / bug (the verification gate that should have caught F16)

**Symptom:** Build#2 ran with `verifyBuilds=ON`: the banner "A testar a aplicação..." showed,
`build-verify` billed 8155 tokens, and verification PASSED (no `verifyNote` on `complete`). But the
served bundle it drove was still the scaffold placeholder - the counter the user asked for went into the
orphaned `pessoa.html` again, and `dist/bundle.js` was rebuilt from the untouched scaffold App.jsx. The
gate that exists to catch F16 passed a scaffold and charged for the pass. Evidence:
`docs/release/evidence/J3-build/build2-verify-theater.md` (verdict "Verification gives FALSE assurance");
`build2.json` (verifyBanner present, `build-verify` billing row 8155 tokens, `complete.result` carries
no verify note).

**Root cause (verified by reading code):**
- The verifier is never told what the app should DO. `api/src/apps/verify-runner.ts` `buildPrompt`
  (lines 82-95) receives only `appUrl` + `depth`; `VerifyRunInput` (lines 26-32) has no request field;
  `build.ts:350` calls `verifyRunner({ artifactId, projectDir, appUrl, userId, depth })` without the
  request. The only assertion is "the app renders and responds without console errors or crashes" (line
  90) - which a scaffold placeholder satisfies. `parseVerdict` (lines 99-111) then reads the agent's
  "PASS" line -> `{ passed:true }`.
- A failed verify does not gate completion anyway. `build.ts:351` maps a fail to a NOTE only
  (`if (!verdict.passed && verdict.note) verifyNote = verdict.note`); `build.ts:355-358` still emits
  `sink.complete` + `patchJob status:'completed'` with the note appended. So even a correct FAIL would
  not fail the build.

**Fix scope:**
- Thread the acceptance signal into the runner: add the request/description (plus, on a follow-up, the
  change summary) to `VerifyRunInput` + `buildPrompt` (and the `build.ts:350` call site), and require the
  verifier to assert request-fulfilment - specifically scaffold/placeholder detection (the served DOM is
  NOT the Ekoa scaffold copy: "Powered by Ekoa" / "Your app is being created" / `scaffold-root`) plus
  presence of the expected interactive elements - FAILing otherwise.
- Gate completion on a genuine ran+failed verdict: in `build.ts` step 5/6 a `{ ran:true, passed:false }`
  verdict must surface to the user and gate completion (a distinct non-success terminal), NOT silently
  complete with a note. Keep the honest not-run (`{ ran:false }`, credential-skip, `verify-runner.ts:46`)
  as a note-only non-failure per §5.6.2.
- NON-goals: not a full E2E oracle - a scaffold-detection + acceptance-criteria check; F16 owns the
  build-side gate (this is the verification gate over the same journey).

**Regression test first:** `api/tests/agents/build.test.ts` (in-process seams): drive a build whose
served page is the scaffold placeholder and set `setVerifyRunner` to return `{ ran:true, passed:false }`
for it; assert the job does NOT reach a clean `completed` and the failure surfaces on the `complete`
event + job record. Add a `verify-runner` unit near `api/tests/apps/build-mechanics.test.ts` asserting
`buildPrompt` carries the request and that a scaffold DOM yields FAIL. Must fail before the fix.

**Acceptance:** with verify ON, a served scaffold placeholder FAILS verification and gates completion (no
clean `completed`); a real app that fulfils the request still PASSES; credential-skip stays a note-only
non-failure; `build.test.ts` green; re-run J3 build#2 shows a failed/flagged verify, not a billed green
pass.

**Notes:** verify-runner reaches the model SOLELY via `llm/` `runAgent` (`user_work` / `build-verify`) -
unchanged, chokepoint intact (FIXED-3/8/13). Ties to F16: same root journey - F16 is the build defect
(real work orphaned), F28 is the gate that must have caught it. Update the ch07 §7.2.6 verification-stage
diagram to show the request-fulfilment assertion + the fail-gates-completion edge (FIXED-12).
