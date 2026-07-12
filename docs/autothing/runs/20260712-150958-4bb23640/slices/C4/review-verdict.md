VERDICT: approve

# Fresh-context review — slice C4 (commit 88e027d)

Reviewer: review-c4 (no implementer context). Repo /Users/ggomes/dev/ekoa-code, branch operator-run.

## Acceptance judged
FLOW_PLAN C4: "assistant-side: manifest -> typed tool definitions; every executed action logs an audit row via the single logActivity path; no permission logic (can() stub only)."
Scoping note honored: D1 (the assistant endpoint) mounts these; C4 delivers the MAPPER + the audit helper D1 will call. Both deliverables are present and correct in this commit.

## Result
The commit adds exactly two files (`api/src/apps/assistant-tools.ts`, `api/tests/apps/assistant-tools.test.ts`, +211 lines, no other changes). It satisfies every C4 constraint with my own evidence below. No blocking findings.

## Constraint-by-constraint

1. Manifest -> typed tool definitions — PASS.
   `assistantToolsFromManifest` (api/src/apps/assistant-tools.ts:59) maps each `AppAction` to one provider-neutral `AssistantToolDef`: namespaced name (`toolNameForAction`, :46, kebab id -> `app_action__<snake>`), `description` from the action, `destructive` flag carried through for D1/client, and the full `action` forwarded verbatim for the in-page runtime (C3). `inputSchemaFor` (:49) derives a JSON-schema object from typed params — type via `JSON_TYPE` map (option->string), `enum` from `p.options` for option params, `description` from `labelPt`, `required` list from `p.required`, `additionalProperties: false`. Faithful to shared/src/action-manifest.ts (param types, option closed set, destructive). Absent/empty manifest -> `[]` (:59-60).

2. Audit via the single logActivity path — PASS. `auditAssistantAction` (:79) writes ONE row through `logActivity` imported from `../data/activity.js` (assistant-tools.ts:17). It does NOT call `activityLogs.insert` directly — grep confirms the only direct insert in api/src is inside data/activity.ts itself (the single grep-banned audit path per its header). Category `app-assistant`, type `action.<outcome>`. Best-effort (`.catch(() => undefined)`) so bookkeeping never fails the assistant turn.

3. Metadata discipline (F3) — PASS. Audit metadata is ids + typed shape only: artifactId, actionId, kind, destructive, confirmed, optional runId. No prompt/free text. Test asserts exact key set and exact metadata object against the real store.

4. No permission logic (can() stub only) — PASS. There is zero permission/authorization code in the file (the only "permission" token is a comment stating none exists; assistant-tools.ts:10). No `can()` here — correct: authorization is the later security block and D1 owns mounting. Absence of permission code is stricter than, and satisfies, "no permission logic". The `destructive` flag is carried as data (client UX), not enforced here.

5. No llm/ import, no DOM, no model — PASS. Imports are only `@ekoa/shared` (types) and `../data/activity.js`. No `@anthropic-ai`/`api.anthropic.com` (egress chokepoint clean), no `document.`/`window.`, no model call. Pure mapper + audit helper.

6. No emoji; PT-PT only in fixtures — PASS. Unicode-range emoji scan of both files: none. PT-PT strings (`Ver clientes`, `Definir escalão`, action descriptions) appear only in the test manifest fixture, not in any lawyer-facing UI (this is api/ mapper code).

## EVIDENCE

- `git show 88e027d --stat`: two new files only, +211 lines.
- `npx vitest run tests/apps/assistant-tools.test.ts --root api`: Test Files 1 passed (1); Tests 5 passed (5). Duration ~6.6s. The 5th is the real-store round-trip: describe `auditAssistantAction` connects mongo-mem via `connectMongo`, calls the helper, then `waitForRows` polls `activityLogs.find({category:'app-assistant'})` and asserts exactly one row with the ids-only metadata; a second test asserts the confirm-pending/cancelled/failed outcome variants land as distinct types and never throw.
- Single audit path: `grep -rn "activityLogs.insert" api/src | grep -v data/activity.ts` -> no matches (only data/activity.ts inserts). assistant-tools.ts imports `logActivity`, not `activityLogs`.
- `grep -niE "llm|document\.|window\.|can\(|permission|authorize|authz"` on the source -> only the line-10 comment; no code.
- `npx eslint api/src/apps/assistant-tools.ts api/tests/apps/assistant-tools.test.ts` -> ESLINT EXIT: 0 (import boundaries + egress ban lint clean; apps/ -> data/ audit-entry import is permitted).
- Emoji scan (`grep -nP '[\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}]'`) on both files -> no emoji.
- No egress refs (`grep -niE "anthropic|api.anthropic"`) -> none.
