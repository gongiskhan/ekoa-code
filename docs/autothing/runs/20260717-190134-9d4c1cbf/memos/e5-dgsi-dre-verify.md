# E5 — DGSI/DRE verify (run 20260717-190134-9d4c1cbf)

**Verdict: VERIFIED, no new build.** BRIEF §8 item 5 ("verify existing paths still hold
post-hardening; no new build unless broken") + `08-portal-audit.md` "Part E pins" #5
("E5 verify-only needs no new code path - ride `verifyUrl`") both hold as written.
`api/src/legal/research.ts` is unchanged by every A-E slice landed in this run.

## What was checked
- `git log --oneline -- api/src/legal/research.ts` since the mega-run branched: **no commits**.
  The module is byte-identical to what A4's audit inspected.
- `npx vitest run api/tests/legal/research.test.ts` (14 tests, the ported
  `cortex/tests/services/legal-research.test.ts` suite): **14/14 green** — extraction
  (ECLI / Decreto-Lei / Lei / DGSI process number, ECLI-over-legislation precedence,
  no-match → `undefined`), pipeline (source tagging + collection routing, `verify:false`
  keeps every hit unverified, `verify:true` drops dead links and keeps live ones, HEAD→GET
  fallback on 403/405/501, hits with no URL are dropped under `verify:true`, empty index →
  `ok:true, hits:[]` with a PT-PT note, all-dead-links → `ok:true, hits:[]` with a distinct
  PT-PT note, unknown source → note, empty query → `hits:[]`).
- The `contract/legal-plane.test.ts` `/api/legal-research` block (gate/allowlist/charset/rate
  reuse) is green, unaffected by any A-E change (no diff touches `research.ts`, `router.ts`'s
  `/api/legal-research` handler, or the `RESEARCH_ALLOWED_APPS` set). NOTE (E5 review correction):
  the sibling `api/tests/e2e/legal-research.e2e.mjs` driver SKIPS when cortex is not reachable
  (it did here) - it is NOT counted as a pass; the unit + contract coverage above is the evidence.

## Cited-or-silent discipline - confirmed intact, no invention path opened
`legalResearch` (research.ts:149-226) still enforces the same three gates it had before this
run, unchanged:
1. A hit only survives assembly if `searchImpl` (the injected knowledge-FTS seam) actually
   returned it - no code path fabricates a hit from the query text.
2. `extractCitation` (research.ts:89-92) only recognises the citation ALREADY PRESENT in the
   hit's title/snippet (ECLI / Decreto-Lei-Lei-Portaria-Despacho / DGSI process-number regexes
   against text the search backend returned) - it never invents or completes a citation that
   is not literally in the source text.
3. When `verify` is on (the default), a hit's URL must resolve 2xx (`verifyUrl`,
   research.ts:121-143, riding the SSRF-guarded `guardedFetch`) or it is DROPPED
   (`resolved = checked.filter((h) => h.verification.ok)`, line 216) - "preferimos silêncio a
   uma citação que o utilizador não consegue abrir" (module doc comment, line 6-8). No A-E
   slice added a bypass of this filter, a new `verify:false` default, or a second assembly
   path that skips it - `grep -rn "legalResearch\|verifyUrl\|extractCitation" api/src` outside
   `research.ts`/`router.ts` returns nothing that calls it with `verify` overridden.

## Post-hardening surface check
None of E1-E4's new modules (`portal.ts`, `portal-connectors.ts`, `insolvencia-watch.ts`) import
from or are imported by `research.ts` - `grep -n "research" api/src/legal/portal*.ts
api/src/legal/insolvencia-watch.ts` is empty. The DGSI/DRE route (`GET /api/legal-research`,
`router.ts:201-233` per the A4 audit) is untouched; `RESEARCH_ALLOWED_APPS` and its rate limiter
are declared independently of `PORTAL_ALLOWED_APPS` (router.ts:44-46), so Part E's new portal
routes share no allowlist, limiter, or gate state with the research route.

**Conclusion:** existing DGSI/DRE paths still hold post-hardening exactly as A4 found them; no
fix was needed; the cited-or-silent / never-invented discipline is unchanged and unbypassable
by anything Part E added.
