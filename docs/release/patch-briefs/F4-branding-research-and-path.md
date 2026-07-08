# F4: Brand-research endpoint unimplemented + branding save path diverges from contract

**Severity / class:** medium / bug

**Symptom:** `POST /api/v1/branding/research` returns HTML 404 - the brand-research journey fails at
step one. Separately, the branding save path diverges from the contract: the code mounts
`PUT /api/v1/org/branding` but the contract declares `PUT /api/v1/branding`, so the contract path also
404s. Evidence: `docs/release/evidence/J0-degradation/j0-degradation.json` (J0e.research: `Cannot POST
/api/v1/branding/research`); `J5-isolation/j5-isolation.json` (brandContract).

**Root cause:**
- `api/src/routes/org.ts:28` mounts `r.put('/branding', ...)` on the org router, which server.ts mounts
  at `/api/v1/org` (`server.ts:473`) - so the live path is `PUT /api/v1/org/branding`, not the
  contract's `PUT /api/v1/branding` (`shared/` + sweep row `PUT /api/v1/branding [org] mounted:false`).
- There is no `research` handler anywhere in `api/src/routes/org.ts` - `POST /api/v1/branding/research`
  is simply unmounted. The jobs/agents infrastructure to back it already exists
  (`api/src/agents/brand-research.ts` runs a brand-research job and patches job status/error).

**Fix scope:** decide and do ONE of:
(A) Implement: mount `POST /api/v1/branding/research` (org-admin) that enqueues the existing
brand-research agent job, and add a `PUT /api/v1/branding` alias (or move the branding save to the
contract path), in `api/src/routes/org.ts` / a small `branding` router wired in `api/src/server.ts`.
(B) Amend the contract + spec to the as-built `/api/v1/org/branding` and drop `branding/research`.
Recommended: (A) - the feature is documented and the agent exists. NON-goals: no new LLM egress path
(brand research must run through the existing agent -> chokepoint); do not duplicate the branding save
logic - alias or relocate, not both.

**Regression test first:** contract test `api/tests/contract/branding.test.ts` (in-process factory):
`POST /api/v1/branding/research` as org-admin returns its `shared/` job/create schema via `safeParse`
(202/job envelope), non-admin gets envelope 403; `PUT /api/v1/branding` accepts a valid
`BrandingSaveRequest` and returns the org/branding `shared/` schema. Both must fail before the fix.

**Acceptance:** both sweep rows (`PUT /api/v1/branding`, `POST /api/v1/branding/research`) flip to
`mounted`; the research job reaches a terminal state with a surfaced error field (see F7) rather than an
HTML 404; contract suite + schema-coverage green.

**Notes:** brand research runs a model job - keep all egress inside `api/src/llm/` via the agent; no
Anthropic import in `routes/`. Update the ch07/branding flow diagram if a route is added or moved
(FIXED-12). Overlaps F5 (both org rows) - land the mount-coverage test there.
