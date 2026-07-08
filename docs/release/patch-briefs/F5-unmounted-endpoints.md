# F5: 31 contract-declared endpoints are unmounted (declared-vs-mounted drift)

**Severity / class:** medium / bug

**Symptom:** 31 of 167 contract-declared endpoints return raw HTML 404, including four whole domains
never referenced in `server.ts` (`uploads`, `app-assistant`, `integration-builder`, `ekoa-local`
extras). Chat `attachments` cannot work without `uploads`. The `shared/` coverage gate exercises
schemas, not mounts, so this never failed CI. Evidence: `docs/release/evidence/J0-contract-sweep/
sweep.json` (167 total / 135 mounted / 32 notMounted; the `oauth/:provider/callback` row is a false
positive - it IS mounted at `server.ts:498`, the sweep misread its redirect, so 31 genuine).

**Root cause:** the four missing domains have no `app.use(...)` in `api/src/server.ts` (compare the mount
block `server.ts:470-506` against the shared descriptor maps); the partial gaps are handlers absent from
otherwise-mounted routers. Enumerated below.

**Triage table (proposal - director will adjust):**

| Domain | Endpoint | Proposal |
|---|---|---|
| app-assistant | POST /api/app-assistant | de-scope-candidate (whole domain absent; note non-v1 prefix) |
| auth | POST /auth/{password,refresh,device,device/poll,device/approve,logout} (6) | implement - see F1 |
| ekoa-local | POST /agent-face/run, POST /agent-face/cancel | de-scope-candidate |
| ekoa-local | GET /bridge/connect/:connectionId (ws), POST /bridge/debug-invoke | de-scope-candidate (ws/debug) |
| ekoa-local | GET /api/v1/events (sse) | implement-candidate (core event stream) |
| integration-builder | POST /chat, GET /package, PUT /package, POST /test (4) | de-scope-candidate (whole domain absent) |
| integrations | GET /:key/session, POST /:key/session, POST /:key/provision-automations (3) | implement |
| knowledge | PATCH /sources/:id, POST /sources/:id/crawl, GET /sources/:id/crawl, GET /refresh-schedule (4) | implement |
| memories | POST /memories/bulk-delete, POST /memories/signals (2) | implement |
| org | PUT /api/v1/branding, POST /api/v1/branding/research (2) | implement - see F4 |
| platform-integrations | GET /oauth/:provider/callback | none - FALSE POSITIVE (mounted server.ts:498) |
| sessions | POST /sessions/:id/seed-featured | implement (or de-scope) |
| triggers | GET /api/v1/automations/:id/triggers | implement |
| uploads | POST /api/v1/uploads (binary) | implement (chat attachments depend on it) |
| users | POST /api/v1/users/:id/password | implement - see F1 |

**Fix scope:** for each `implement` row, mount the handler in its router (or add the router + `app.use`
in `server.ts`); for each `de-scope-candidate`, remove the endpoint from the `shared/` descriptor map
with a spec annotation stating it is out of scope for rc-1. Land the decision per row. NON-goals: do not
implement `de-scope` rows; F1/F4 own their rows (do not duplicate) - this brief owns the meta-gap and
the coverage test.

**Regression test first (mount-coverage):** add `api/tests/contract/mount-coverage.test.ts` (in-process
factory): walk every path in the `shared/` endpoint descriptor maps, probe each against the built app,
and assert none returns an Express default HTML 404 (`Cannot <METHOD> ...`) - i.e. every declared path
is mounted or explicitly excluded via a small allow-list the test reads. This drift test must fail today
(31 rows) and gate CI thereafter. Pairs with F6 (once the JSON-envelope 404 lands, key "mounted" on
envelope-vs-html).

**Acceptance:** every `implement` row flips to `mounted` in a re-run sweep; every `de-scope` row is gone
from `shared/`; the mount-coverage test is green and would fail on any future declared-but-unmounted
path; contract + schema-coverage + protocol-parity gates green.

**Notes:** `shared/` is a significance-labeled area - adversarial review required. `uploads` and the
`ekoa-local` bridge/event paths must not introduce LLM egress outside `api/src/llm/`. If domains are
added or removed, update the ch02 module-map and ch03 endpoint diagrams (FIXED-12).
