# F7: A failed build serves a broken 200 scaffold shell + job record hides the error

**Severity / class:** medium / judgment (product-quality defect)

**Symptom:** A FAILED build still registers and serves the owner a `200` scaffold shell that references
`bundle.css`/`bundle.js` which never built - a broken blank page with no failure state (anonymous users
correctly get 410). The `GET /jobs/:id` record reports `status:failed` but carries no `error` field to
explain the failure. Evidence: `docs/release/evidence/J0-degradation/j0-degradation.json`
(J0c.jobrecord: `status=failed ... error=none`; J0c.servedpage: `GET /apps/<id>/ -> 200 served
content`; J0c.artifact: `status:draft`).

**Root cause:**
- The error IS persisted but the job VIEW drops it: `api/src/agents/build.ts:228` writes
  `patchJob(jobId, { status:'failed', error:{ code, message:'A construção falhou.' }, ... })`, and
  `JobRecord.error` exists (`api/src/agents/jobs.ts:37`), but `jobView` (`api/src/agents/jobs.ts:58-72`)
  returns only `id/status/artifactId/slug/createdAt` - it never spreads `error`. So `GET /jobs/:id`
  shows `status:failed` with no cause.
- The served page is a broken shell: on build failure the artifact is left `status:'draft'`
  (`jobs.ts:121,129`) with a scaffold `dist/index.html` on disk, so `apps/serving.ts` resolves a dist
  dir and serves the injected index (`serving.ts:285-313`, `200`) while the referenced
  `bundle.js`/`bundle.css` assets 404 (`serving.ts:319-320`) - a blank page, not an honest failure.

**Fix scope:**
- Surface the error: add `error` to `jobView` output (`api/src/agents/jobs.ts`) and to the `Job` shared
  schema (`shared/src/jobs.ts` - it is `.passthrough()` today, so passthrough works but the field should
  be declared for the contract test).
- Serve an honest state: for an artifact whose latest build failed / has no successful dist, serve a
  "A construção falhou" state page (uncacheable, like the existing `sendAppBuildingResponse`) instead of
  the scaffold shell - gate on build outcome in `apps/serving.ts` (or mark the artifact so serving can
  distinguish "never built successfully" from "mid-build"). NON-goals: do not change the 410
  revoked-share behavior; do not leak internal/provider error text to the page (that is F8); keep the
  anonymous path unchanged.

**Regression test first:** contract test `api/tests/contract/build-failure.test.ts` (in-process
factory): drive a build to a failed terminal state (stub the agent to fail), then (1) `GET /jobs/:id`
returns an `error:{code,message}` that validates against the `shared/` Job schema; (2) `GET /apps/<id>/`
returns the honest failure state (not a scaffold referencing an unbuilt bundle) - assert the response
does not serve a `bundle.js`-referencing shell as `200`. Must fail before the fix.

**Acceptance:** `GET /jobs/:id` on a failed build includes the error code+message; the served page shows
an explicit failure state instead of a broken blank shell; contract + schema-coverage green; re-run J0
degradation shows `jobrecord.error` populated and `servedpage` reflecting failure.

**Notes:** F8 (not in this batch) owns making the error text user-grade PT + machine code; keep that
detail out of this brief's page copy. No LLM egress change - build runs stay inside the agent ->
chokepoint. Update the ch07 build/serve state diagram to include the failed state (FIXED-12).
