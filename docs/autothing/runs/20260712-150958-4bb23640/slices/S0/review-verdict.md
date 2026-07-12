VERDICT: approve

Fresh-context review of commit f9dee3c (CODE changes only: shared/src, api/src, api/tests) against the S0 acceptance criteria. All criteria met; no findings.

## Criteria checked

- api/src/auth/capabilities.ts:14-19 — `can()` returns `true` unconditionally. Both params underscore-prefixed and unused (`_actor`, `_capability`); no role mapping, no enforcement semantics. PERMISSIVE-STUB marker present in the doc comment (line 1) and inline (`return true; // PERMISSIVE-STUB` line 18). Documents that H1 replaces the body and H5 greps this file for the marker. PASS.
- No callers: `grep -rn "auth/capabilities" api/src --include="*.ts" | grep -v "src/auth/capabilities"` → NO CALLERS FOUND. PASS.
- shared/src/capabilities.ts:9-16 — contains ONLY a `z.enum` + inferred type; imports zod only. Enum names exactly `['canBuildApps','canEditApps','canCreateArtifacts','canUseChat']`. PASS.
- api/tests/auth/capabilities-stub.test.ts — documents permissiveness only: asserts `can()` returns true for every capability with actor `{role:'builder'}`, `null`, `undefined`; asserts the vocabulary names. Header notes H5 replaces it. PASS.
- Import boundaries: shared imports zod only; api/src/auth/capabilities.ts imports `@ekoa/shared` (type-only Capability) + `./jwt.js` (api-internal); never imports web. shared/src/index.ts re-exports capabilities.js. PASS.
- No emoji in code files; no secrets in the diff. PASS.

## EVIDENCE

1. `git show f9dee3c --stat && git show f9dee3c -- shared/src api/src api/tests`
   → Diff reviewed in full. New files: api/src/auth/capabilities.ts (+19), api/tests/auth/capabilities-stub.test.ts (+29), shared/src/capabilities.ts (+16); shared/src/index.ts +1 re-export line. Confirmed can() body is `return true`, params unused, PERMISSIVE-STUB markers present, enum names correct, imports as stated.
2. `grep -rn "auth/capabilities" api/src --include="*.ts" | grep -v "src/auth/capabilities"`
   → Output: NO CALLERS FOUND (grep matched nothing). Confirms no callers of the stub anywhere in api/src.
3. `npx vitest run tests/auth/capabilities-stub.test.ts --root api`
   → Test Files 1 passed (1); Tests 2 passed (2); Duration 1.31s. Test executes and passes.

All checks finished; none unfinished.
