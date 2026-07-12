VERDICT: approve

Fresh-context review of commit f9dee3c (branch operator-run, HEAD) against S0 acceptance in
docs/autothing/runs/20260712-150958-4bb23640/FLOW_PLAN.md. All checks complete; none unfinished.

## Findings

No blocking findings. One non-blocking observation:

- NON-BLOCKING (does NOT gate S0): em dash `—` (U+2014) appears in comments at
  api/src/auth/capabilities.ts:18, shared/src/capabilities.ts:3, and
  api/tests/auth/capabilities-stub.test.ts:3. Contravenes the user's standing "never use the
  em dash, use a plain dash" convention. It is NOT among the enumerated S0 constraints, is in
  comments only (not lawyer-facing, not UI), and does not affect correctness. Clean up in a
  later slice.
  Constraint: user global CLAUDE.md style rule (not an S0 acceptance constraint).
  Evidence: unicodedata scan reported U+2014 EM DASH at those three lines.

## Acceptance verification (each point confirmed with my own evidence)

- Branch operator-run cut from main: `git merge-base --is-ancestor main f9dee3c` succeeded —
  f9dee3c descends from main.
- api/src/auth/capabilities.ts permissive can() stub: `can()` returns `true` unconditionally,
  both params `_`-prefixed/unused, no role mapping or enforcement. Marked PERMISSIVE-STUB in
  the block comment, inline, and in the shared file. Comment forbids treating `true` as a
  security boundary and notes H5 greps for the marker. This is a plain permissive seam, not
  security design (constraint satisfied).
- shared/ capability union, names only, imports only zod (FIXED-1): shared/src/capabilities.ts
  imports `{ z } from 'zod'` only; exports a zod enum + inferred type; re-exported from
  shared/src/index.ts. No non-zod dependency.
- Capability names exactly canBuildApps / canEditApps / canCreateArtifacts / canUseChat:
  confirmed in shared/src/capabilities.ts and asserted by the stub test.
- No callers yet: grep across api/web/shared (*.ts/*.tsx) for importers of auth/capabilities
  and for the four names found only the 3 S0 files (plus derived shared/dist build artifact).
  Zero real callers.
- api may import shared: capabilities.ts imports `type Capability from '@ekoa/shared'` and
  `type JwtClaims from './jwt.js'` (both allowed directions).
- Type soundness: Role = z.enum(['super-admin','org-admin','builder']) (shared/src/common.ts);
  JwtClaims.role: Role (api/src/auth/jwt.ts); can() takes Pick<JwtClaims,'role'>, so the test's
  { role: 'builder' } is valid.
- Run docs dirs: analysis/ and memos/ exist, each with .gitkeep.
- No emoji in code: only non-ASCII in the changed files are `→` (U+2192, arrow) and `—`
  (U+2014, em dash) in comments; neither is an emoji.
- ci:lane green: scoped stub test green (2/2) and eslint clean (exit 0) on the changed surface.

## EVIDENCE (commands I ran and their outcomes)

- `git show --stat f9dee3c` -> 11 files, 425 insertions; only S0 files (capabilities.ts,
  shared/src/capabilities.ts, shared/src/index.ts, stub test, run docs). No structural code.
- `git merge-base --is-ancestor main f9dee3c` -> exit 0: f9dee3c descends from main.
- `git show f9dee3c --stat | grep next-env` -> no match: next-env.d.ts not in this commit.
- Read api/src/auth/capabilities.ts, shared/src/capabilities.ts, shared/src/index.ts,
  api/tests/auth/capabilities-stub.test.ts -> contents as summarized above.
- (cd api) `npx vitest run tests/auth/capabilities-stub.test.ts` -> Test Files 1 passed (1),
  Tests 2 passed (2).
- `npx eslint api/src/auth/capabilities.ts shared/src/capabilities.ts
  api/tests/auth/capabilities-stub.test.ts` -> ESLINT_EXIT=0 (clean; import-boundary FIXED-1
  and egress-chokepoint rules pass).
- python3 unicodedata scan of the 3 changed files -> non-ASCII only: U+2192 RIGHTWARDS ARROW
  and U+2014 EM DASH, all in comments. No emoji-range codepoints.
- grep (api/web/shared, *.ts/*.tsx) for `auth/capabilities` importers and for the four
  capability names -> only the 3 S0 source files + derived shared/dist artifact. No real callers.
- grep for Role definition -> shared/src/common.ts:33 Role = z.enum(['super-admin','org-admin','builder']).
- `ls docs/autothing/runs/20260712-150958-4bb23640/{analysis,memos}` -> both dirs present with .gitkeep.
