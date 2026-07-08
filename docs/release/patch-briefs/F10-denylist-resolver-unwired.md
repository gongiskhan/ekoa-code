# F10: The per-org deny-list is dead in production wiring (resolver never set)

**Severity / class:** medium / bug

**Symptom:** The ch17 per-org deny-list is inert in production: every org runs the default EMPTY
deny-list, and there is no HTTP surface to manage deny-list parties. Additionally NER is the inert
default, so only checksum-VALID PT structured IDs are masked - free-text names and checksum-invalid IDs
go out in cleartext (the invalid-checksum pass-through is per §17.5 by design; the unwired resolver is
NOT). Evidence: scout-verified code trace; `Boot-B J6` shows what IS caught.

**Root cause:** `setRulesetResolver` is never called anywhere in the composition root - confirmed
repo-wide grep: the only reference is the definition in `api/src/llm/anonymise/index.ts:75`, nothing in
`api/src/server.ts`. So `resolveRuleset` (`anonymise/index.ts:81-83`) always returns the
`defaultRulesetResolver` (`:72`, `(orgId) => ({ orgId })`) - an empty ruleset with no deny-list. There
is also no CRUD router for deny-list parties. NER remaining the default detector is the separate,
documented posture (§17.5) and is not the bug here; the unwired resolver is.

**Fix scope:**
- Wire a real `RulesetResolver` at the composition root (`api/src/server.ts` bootState) that loads the
  per-org deny-list from org settings (org settings already live per-org on `orgs[orgId].settings`, see
  `api/src/services/platform-crud.ts` `patchOrgSettings`/`mergedSettings`). Call `setRulesetResolver`
  with that loader. This is the one injected seam (§17.7) - keep it at the composition root only.
- Add a minimal deny-list CRUD surface (org-admin) to manage parties, persisted in org settings.
- Document the NER posture honestly in ops docs (what is and is not masked).
NON-goals: do not change the anonymisation pipeline internals or the §17.5 invalid-checksum
pass-through; do not turn on a heavyweight NER detector as part of this fix (separate decision); the
resolver seam must stay injected (no `data/` import inside `api/src/llm/anonymise/`).

**Regression test first:** unit test `api/tests/anonymise/ruleset-resolver.test.ts`: with a resolver
that returns a deny-list containing a free-text party name, `anonymize` tokenizes that literal (and the
audit records `denyListAccessed` count) - failing today because the default resolver returns an empty
ruleset. Plus a contract test `api/tests/contract/denylist.test.ts` (in-process factory): the CRUD
endpoint is org-admin-scoped, persists to org settings, and its responses validate against the
`shared/` schema; cross-org reads 404. Both must fail before the fix.

**Acceptance:** with a party on an org's deny-list, that literal is masked before egress and appears as a
`denyListAccessed` metadata count in the anon audit (metadata-only, ch17 §17.4); the CRUD endpoint
manages parties per org with isolation; contract + schema-coverage green; ops doc states the NER posture.

**Notes:** this is the LLM egress + anonymisation surface - a significance-labeled area (adversarial +
Codex security review). The resolver must load config at the composition root; `anonymise/` stays free
of `data/` imports (the §17.7 edge boundary). Deny-list literals are secrets - audit COUNTS only, never
the literals. Update the ch17 anonymisation/ruleset diagram (FIXED-12). Ties into F3 (audit rows) and
F18 (anon round trip).
