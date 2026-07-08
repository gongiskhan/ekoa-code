# F22: `memoryView` omits `orgId` and emits `tags: undefined` - every `GET /memories` body violates the shared `Memory` schema

**Severity / class:** high / bug

**Symptom:** `GET /api/v1/memories` items fail the shared `Memory` zod schema: `orgId` (required) is absent
and `tags` (required) is `undefined` for tag-less memories. The web `/memory` page rejects every item and
renders 0 cards despite 4 memories existing via API; the contract suite never caught it (Memory response
shape not exercised = coverage gap). Evidence: `docs/release/evidence/J4-memory/j4-ui-rootcause.json`
(finding_1), `memory-page.png`.

**Root cause (verified by reading code):** `api/src/memory/resolver.ts` :27-29
`memoryView(m)` returns `{ id, title, content, type, tags, tier, visibility, userId }` - it never includes
`orgId`, and `tags` is passed straight through as `m.tags`, which is `undefined` for extracted/manual
memories (extraction sets no `tags`, `extraction.ts` :117-128; `createMemory` leaves it optional,
resolver.ts :121). The shared contract `shared/src/memories.ts` :6-21 requires `orgId: Id` (:14) and
`tags: z.array(z.string())` (:11) - both non-optional. `api/src/routes/memories.ts` :20 emits
`{ items: rows.map(memoryView), total }` and :26/:33/:43 emit `memoryView(...)` for get/create/update - so
ALL four memory responses are malformed, not just list. The bodies are never `safeParse`d on the way out,
which is why CI stayed green (§13 schema-coverage exercises schemas but nothing asserted the Memory
response body).

**Fix scope:** `api/src/memory/resolver.ts` `memoryView` only: include `orgId: m.orgId` and default
`tags: m.tags ?? []`. `MemoryDoc` already carries `orgId` (:13) and `tags?` (:19), so no store or write
change is needed and all four routes are fixed by the one view function. NON-goals: do not change the
`Memory` schema to make the bad shape legal; do not add a second view path; do not touch memory visibility
scoping.

**Regression test first:** contract test `api/tests/contract/memories.test.ts` (in-process app factory over
`mongodb-memory-server`, per §13.9): seed one memory WITH tags and one WITHOUT, `GET /api/v1/memories` and
`GET /api/v1/memories/:id`, and `safeParse` each item and the get body against the shared `Memory` schema
via the common helper; assert `orgId` present and `tags` is an array (`[]` when none). Also exercise the
list envelope against `MemoryListResponse`. Must FAIL today (missing `orgId`, `tags: undefined`). This
closes the named coverage gap - add Memory to the response shapes the contract suite exercises.

**Acceptance:** every `GET /memories` and `GET /memories/:id` item validates against `Memory`; the web
`/memory` overview renders one card per memory; contract + schema-coverage gates green; re-run J4 UI shows
non-zero cards.

**Notes:** metadata-only surface - no payload/PII change. No import-boundary or chokepoint impact; the fix
lives in `memory/` behind the module seam (`routes/` keeps calling `memoryView`, never `data/`). Data shape
on the wire is unchanged in intent (it now MATCHES the contract) so no diagram edit is required; if a
memory ERD exists in `spec/diagrams/`, confirm `orgId`/`tags` are shown. Ties to F23 (the `/memory`
console 404s are a separate F5/F1 gap).
