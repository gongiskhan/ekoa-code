# F9: Trigger disable (410 TRIGGER_DISABLED) is unreachable over the API

**Severity / class:** minor / bug

**Symptom:** The disabled-trigger delivery path (`410 TRIGGER_DISABLED`) cannot be reached through the
API: the triggers router exposes only `GET`, `POST`, and `DELETE` - there is no disable/patch surface,
so a trigger can never be set inactive. The 410 branch exists only in unit tests. Evidence:
`docs/release/evidence/J8-webhooks/j8-webhooks.json` (J8f).

**Root cause:** `api/src/routes/triggers.ts:24-59` mounts `GET /`, `POST /`, and `DELETE /:id` only -
there is no `PATCH /:id` (or `active` toggle). The events service that backs it exposes
`listTriggers` / `createTrigger` / `deleteTrigger` / `triggerView`
(`api/src/routes/triggers.ts:8` import from `api/src/events/service.js`) but no update-active seam is
wired into the router. The webhook admission path can honor an inactive trigger (the `410
TRIGGER_DISABLED` branch), but nothing can flip a trigger to inactive.

**Fix scope:** decide and do ONE of:
(A) Add `PATCH /api/v1/triggers/:id` accepting `{ active: boolean }` in `api/src/routes/triggers.ts`,
backed by an `updateTrigger`/`setTriggerActive` seam in `api/src/events/service.ts`; the webhook
admission path already 410s on inactive.
(B) Document the lifecycle as delete-only and remove the dead `410 TRIGGER_DISABLED` path + its
unit test.
Recommended: (A) - disable-without-delete is the useful lifecycle and the 410 path already exists.
NON-goals: no change to the HMAC/dedup admission logic; do not expose the secret on update; keep
`GET`/`POST`/`DELETE` unchanged.

**Regression test first:** contract test in `api/tests/contract/triggers.test.ts` (in-process factory):
create a trigger, `PATCH /:id {active:false}`, assert the response validates against the trigger
`shared/` schema and shows inactive; then deliver a webhook to `/hooks/:triggerId` and assert `410
TRIGGER_DISABLED` (envelope). Ownership scoping holds (another org's PATCH -> uniform 404). Must fail
before the fix. (If choosing (B), instead assert `PATCH` is absent and delete the dead branch + test.)

**Acceptance:** a trigger can be disabled via the API and a subsequent delivery returns `410
TRIGGER_DISABLED`; the sweep gains a `PATCH /api/v1/triggers/:id mounted` row; contract +
schema-coverage green; the 410 path is exercised by a contract test (not only a unit test).

**Notes:** webhook admission is on the automation surface (a significance-labeled area if it touches the
collections/automation engine) - adversarial review may apply. No LLM egress impact. If a trigger state
is added, update the ch03/ch08 trigger-lifecycle diagram (FIXED-12).
