# G13 — Diagram census + consolidated deviation annex

Terminal-gate reconciliation (spec ch14 §14.4 G13): the as-built system mapped to the visual
documentation, and the run's deviations enumerated. Generated 2026-07-08.

## 1. Diagram census (FIXED-12)

Every chapter-02 module and every web-client SSE stream maps to ≥1 current diagram. The
`.excalidraw` file is the source of truth; the `.png` is its render.

### Module → diagram

All 17 `api/src/` modules are rendered in **02-module-map** (verified: agents, apps, auth,
automation, billing, bridge, content, data, events, integrations, knowledge, legal, llm, memory,
routes, services, streaming). Additional per-concern diagrams:

| Module(s) | Primary diagram(s) |
|---|---|
| routes, auth, data, shared (request path) | 02-module-map, 03-request-crud |
| agents, jobs (agent execution + run streams) | 04-agent-job |
| data (stores, collections engine) | 05-data-model |
| llm, billing (chokepoint + metering) | 06-llm-chokepoint-billing |
| apps, content (app pipeline + composition) | 07-content-composition |
| (deploy topology, coexistence, cutover) | 08-coexistence-cutover |
| (QA/gate pipeline) | 09-qa-pipeline |
| llm/anonymise (privacy boundaries) | 10-privacy-boundaries |
| bridge (delegation S1-S6) | 11-delegation-security |
| auth, data (org tenancy) | 12-org-tenancy |
| (system context) | 01-system-context |

### SSE stream → diagram

The four sanctioned web-client SSE streams are rendered in **04-agent-job** (job/run lifecycle +
event streams): `/api/v1/chat/runs/:id/events`, `/api/v1/jobs/:id/events`,
`/api/v1/automations/runs/:id/events`, `/api/v1/notifications/events`. (Confirmed at G8: the
job-lifecycle diagram covers the automation-run SSE streams; no new SSE diagram required.)

### Mod-date reconciliation (mod date ≥ last structural change)

No G10-G13 change altered the **structure, flow, or data shape** of the diagrammed system, so no
diagram's mod date is stale against a structural change:

- **G12 security-headers middleware** (`api/src/security-headers.ts`, wired at the composition
  root): a **cross-cutting response-header decorator** (sets CSP/HSTS/nosniff/frame-ancestors on
  every response). It does not alter the request-path structure, the flow (request → auth →
  route → response is unchanged), or any data shape. Per FIXED-12's exact trigger ("alters
  structure, flow, or data shape"), **no diagram edit is owed** — it is within the existing
  03-request-crud middleware-chain abstraction.
- **G12 shared/ contract tightening** (AuthUser strict, error-envelope JsonValue bound,
  session-capture metadata, DelegatedTask finite budget): **constraints** on existing shapes, not
  new shapes/flows. No diagram change.
- **G10 migration tooling** (`api/scripts/`): offline operator CLIs, outside the deployed service
  bundle. Not part of the diagrammed runtime system.
- **G13 deploy artifacts** (Dockerfiles, deploy lane): **realize** the two-container P-02 topology
  + P-26 upstream-swap cutover that **08-coexistence-cutover already renders** (api, web, reverse
  proxy, cutover). No new diagram.

## 2. Consolidated deviation annex

Enumerates exactly the `### DEVIATION` entries in `RUN_LOG.md` (count: **12**, matching the
RUN_LOG). Each is the deliberate, logged departure from plan; full rationale lives at the cited
RUN_LOG timestamp.

1. **2026-07-06T20:45Z — Phase 3** — `routes/` persistence goes through services (ch02 §2.7 enforced).
2. **2026-07-06T21:30Z — Phase 5** — event queue on the Mongo store instead of SQLite WAL.
3. **2026-07-06T21:34Z — Phase 6 (found at resume; scope Phase 4)** — G4 recorded pass weaker than §14.4; unadapted drivers rode skip-green.
4. **2026-07-06T23:37Z — Phase 6** — citius-integration driver: stale authType assertion corrected to the ported-verbatim definition.
5. **2026-07-07T01:16Z — Phase 6** — the 37-spec byte-compat suite: three harness-level adaptations (no assertion touched).
6. **2026-07-07T01:30Z — Phase 6** — the four `erp-*` drivers target a tenant fork not in the ported catalog; retargeted G6→G9.
7. **2026-07-07T04:36Z — Phase 7A (found at resume)** — gate-7a stamped with two red CI-lane components; repaired forward.
8. **2026-07-07T09:48Z — Phase 7B (found at resume)** — fresh-context adversarial-review verdicts recovered; four real findings become G7B post-gate fixes.
9. **2026-07-07T10:45Z — Phase 7B (closure)** — the four G7B post-gate fixes landed (commit 81789c4).
10. **2026-07-07T18:06Z — Phase 8** — the A8 command-shape carryover weakened the local-command consent gate; fixed forward (per-script shapes).
11. **2026-07-08T08:40Z — Phase 12** — fresh e2e:server surfaces pre-existing non-reproducible e2e state (demos dir + 4 erp-fork drivers); fixed forward (demos provisioned, erp→CUTOVER).
12. **2026-07-08T09:00Z — Phase 12** — the committed e2e:server baseline has pre-existing, non-reproducible debt (band1 needs the web dashboard; band2 specs use the retired /api/v1/action; erp fork); documented, not redone (per the operator's "no redo completed gates").

Count check: 12 annex rows == 12 `### DEVIATION` entries in RUN_LOG.md. ✓
