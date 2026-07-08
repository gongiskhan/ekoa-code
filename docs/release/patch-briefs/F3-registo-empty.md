# F3: Registo works and is org-scoped (main claim REFUTED) - narrow gap: CRUD mutations are not audit-logged

**Severity / class:** minor / harness-gap + narrow bug (confirm-then-fix)

**Boot-B REFUTES the original "audit surface is dead" claim.** The credentialed boot shows 29 registo rows
including `memory_auto_extracted` (J4) and `anonymisation.egress-mask` (J6), hash-chained, each carrying
`orgId`. Evidence: `docs/release/evidence/J4-memory/j4-memory.json` (`registo` total=29, `orgId` present,
`hasMemoryAutoExtracted:true`); `J6-anonymisation/j6-anonymisation.json` (32 egress rows). The Boot-A
"0 rows" reflected the UNCREDENTIALED boot (no model calls -> no egress/extract/execute rows) plus the
org-admin read scope. This brief is now a NARROW verification of two questions, not an audit-dead fix.

**Q1 - is org/user/knowledge/session CRUD audit-logged at all? (code trace says NO):** a repo-wide grep of
`logActivity(` call sites shows only these writers - `server.ts` :405 `execute` (system, `orgId:''`);
`llm/anonymise/audit.ts` :51 `anonymisation.egress-mask`; `memory/extraction.ts` :132
`memory_auto_extracted`; `integrations/platform-oauth.ts` `platform-integrations.connect|disconnect`;
`services/commit-guard.ts` build-commit audit; and `services/platform-crud.ts` :85 `registo.read`.
The CRUD mutations do NOT call it: `createOrg`/`createSession`/`updateSession`/`deleteSession`
(`platform-crud.ts` :17-65) and the user + knowledge create/update/delete paths have no `logActivity`.
So an org-admin who only created orgs/users/knowledge/sessions (Boot-A) has nothing to read except their own
`registo.read` rows - which explains the 0.

**Q2 - does an org-admin read return its own org's rows? (code trace says YES):** `readRegisto`
(`platform-crud.ts` :79-87) reads `activityLogs.find({ orgId: actor.orgId })` for a non-super-admin and
`registoEntry` returns `orgId: a.orgId` (:77). Org scoping is correct and rows carry `orgId` (Boot-B
confirms). Note two carried behaviors: the page is sliced (:84) BEFORE the read logs its own `registo.read`
row (:85), so a FIRST-ever read shows 0 self-rows and the second read shows the first; and `execute` rows
logged with `orgId:''` (server.ts :405) are invisible to org-admins by design (super-admin only).

**RE-VERIFY (confirm-then-fix):** on a credentialed org, as org-admin: create org/user/knowledge/session,
then `GET /api/v1/registo` twice. Assert the CRUD actions appear (they will NOT today) and that read #1's
`registo.read` row appears on read #2 (ordering). If CRUD rows are absent, apply the fix.

**Fix scope:** add `logActivity` at the org/user/knowledge/session CRUD mutation sites, through the SINGLE
existing chokepoint (`data/activity.ts` `logActivity`), stamping the acting user's real `orgId` (never `''`)
so the org-admin read surfaces them. Files: `api/src/services/platform-crud.ts` (org/session), the users +
knowledge service/route write paths. NON-goals: do NOT add a second audit write path (FIXED-8: `logActivity`
stays the only writer); do NOT widen read scoping (no cross-org leakage); do not change the read-then-log
ordering (metadata-only, self-log-on-read is intended).

**Regression test first:** contract test `api/tests/contract/registo.test.ts` (in-process factory): perform a
real mutating action for org A (e.g. create session) via its endpoint, then `GET /api/v1/registo` as org A
org-admin and assert the action's `actionType` appears; assert an org B admin does NOT see it (Registo
metadata-only, org-scoped security class per ekoa-testing). Must fail before the fix.

**Acceptance:** an org/user/knowledge/session CRUD action deterministically appears in `/registo` for its
org with the correct `actionType`; cross-org isolation holds; contract + schema-coverage green.

**Notes:** Registo is a metadata-only class in the security suites - keep payloads metadata-only. The prior
side-claim that "RegistoEntry exposes no orgId" is FALSE in rc-1 (`registoEntry` returns `orgId`,
`shared/src/registo.ts` is `.passthrough()`) - do not spend effort there. If the audit action set changes,
update the ch03/ch12 audit diagram (FIXED-12). Ties to F27 (registo `type` filter granularity).
