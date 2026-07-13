# H2 live whoami probe (2026-07-13, credentialed boot-b stack on the H2 dist)

Zero-LLM-cost curl probe of the fail-closed admin-detection matrix on the running stack,
against a featured app (`task-manager`, owned by the founder/super-admin org). The endpoint is
GET /api/app-assistant/whoami with X-Ekoa-App-Id + an optional Bearer platform-JWT.

## Results (fail-closed, no oracle)

| caller                                   | observed                          |
|------------------------------------------|-----------------------------------|
| NO token                                 | `200 {"admin":false}`             |
| INVALID token (`not.a.jwt`)              | `200 {"admin":false}` (NOT 401)   |
| plain `user` of ANOTHER org              | `200 {"admin":false}`             |
| super-admin (owns the app's org)         | `200 {"admin":true}`              |
| malformed X-Ekoa-App-Id (`usr.reserved`) | `400 VALIDATION_FAILED` (== POST) |

- Every TOKEN failure (absent / invalid / wrong-role / cross-org) returns the SAME
  `200 {admin:false}` - a 401/403 would be a token-validity or app-existence oracle; there is none.
- The ONLY non-200 is a malformed app-id, and it is byte-identical to what POST /api/app-assistant
  returns (both go through the shared `resolveAssistantApp`), so whoami is provably not a new
  existence oracle beyond what the POST plane already exposes.
- `admin:true` is returned ONLY to a verified org-admin/super-admin of the OWNER org holding
  canEditApps - proven live with the super-admin (true) vs a cross-org user (false).

## Detect-then-ask
The panel consumes `admin` only to render a discreet inert badge; no privileged call, no mode
change follows detection (the edit-mode switch is H3). The org-admin-of-owner-org true case and the
full role/org grid are additionally pinned in tests/apps/app-assistant.test.ts over the REAL verify
chain (mongodb-memory-server), and the contract both-branches in the contract suite.
