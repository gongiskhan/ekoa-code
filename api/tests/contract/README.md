# Contract tests — rule-set rewrite mapping (ch13 §13.3, acceptance C13-04)

The 23 direct-handler rule-set files of the old backend (test-audit §5.2) are rewritten as
REST contract tests against the ch03 endpoint groups, running the real router stack in-process
over `mongodb-memory-server`. This table maps each old rule-set file to its rewrite target and
the contract-test file that covers it. Rows fill in as each domain's routes land (per the
suite ledger's target gates); a domain's row is "landed" once its contract test exists.

| Old rule-set file (test-audit §5.2) | Rules pinned | Rewrite target (ch03) | Contract test | Landed gate |
|---|---|---|---|---|
| `auth-device` | device-login lifecycle, single-use approval, pacing | `/api/v1/auth/device*` (§3.8.1) | `tests/auth/activation-auth.test.ts` (auth contract) | G2 (device flow: G-follow) |
| `settings-defaults` | settings singleton defaults | `GET/PATCH /settings` (§3.8.5) | `tests/contract/cross-org.test.ts` + settings router | G3 |
| `phase2/user-isolation-settings` | per-user settings isolation | settings + `user_settings` (§3.8.5) | `tests/contract/cross-org.test.ts` | G3 |
| `phase2/user-isolation-integrations` | per-user isolation; owner-undefined nuance | `/integrations/configs*` (§3.8.13) | (G4) | G4 |
| `memory-handler` | memory CRUD, signals, stats, tags | `/api/v1/memories*` (§3.8.19) | `tests/contract/cross-org.test.ts` (CRUD + visibility) | G3 |
| `memory-consolidation` | grouping/merge/cleanup (deterministic) | memory service + `/memories*` | (memory service, G3/G7B) | G3 |
| `sessions-onboarding-singleton` | one persistent onboarding session per user | `POST /sessions` idempotency (§3.8.6) | sessions router + `tests/contract/cross-org.test.ts` | G3 |
| `phase2/admin-usage-page` | admin billing surfaces + authz | `/billing/admin/*` (§3.8.21) | (billing admin, G7) | G7 |
| `app-data-backups-handler` | status/snapshot/restore/preview/download | `/artifacts/:id/backups*` (§3.8.10) | (G6) | G6 |
| `update-from-bundle-*` | update-in-place vs force, 409 on mismatch | `POST /artifacts/:id/bundle-update` (§3.8.9) | (G6) | G6 |
| `featured/featured-update` | update-by-consent flow | `/artifacts/:id/featured-update/*` | (G6) | G6 |
| `featured/list-instances` | list shape contract | `GET /artifacts` (§3.8.9) | (G6) | G6 |
| `featured/seeder` | seeder idempotency + orphan sweep | boot-path service test | (G6) | G6 |
| `featured/set-featured-authz` | super-admin-only authorization | `PUT /artifacts/:id/featured` | (G6) | G6 |
| `automation/handler` | automation CRUD + run rules | `/automations*` (§3.8.18) | (G8) | G8 |
| `artifact-backend/handler` | backend lifecycle | `/artifacts/:id/backend*` (§3.8.11) | (G6) | G6 |
| `artifact-backend/delete-teardown` | delete teardown + capability revoke | `DELETE /artifacts/:id` cascade | (G6) | G6 |
| `knowledge/knowledge-handler` | vault ops, admin reindex | `/knowledge*` (§3.8.20) | (G4) | G4 |
| `knowledge/knowledge-sources` | crawl-source CRUD | `/knowledge/sources*` | (G4) | G4 |
| `event-sourcing/trigger-target` | target discriminator | `POST /triggers` union (§3.8.17) | (G5) | G5 |
| `event-sourcing/ifthenpay-callback` | callback path rules | `/hooks/:triggerId` delivery | (G5) | G5 |
| `phase2/specialist-removal` | tier-routing removal | `llm/router.ts` unit tests | (G7) | G7 |
| `integrations-session-*` | session-capture status/connect | `/integrations/:key/session` (§3.8.13) | (G4) | G4 |

Cross-cutting security suites (first-class per-PR members, ch13 §13.5): the **cross-org
adversarial suite** and **in-org sharing tests** live in `tests/contract/cross-org.test.ts`
(landed G3, re-run at every later domain gate); the **schema-coverage gate** is
`tests/contract/schema-coverage.test.ts`.
