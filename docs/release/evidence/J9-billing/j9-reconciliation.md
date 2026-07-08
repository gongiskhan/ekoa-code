# J9 billing arithmetic reconciliation (director-verified, live ledger)

Boot B, credentialed, EKOA_LLM_DIRECT=1. Pulled from `/api/v1/billing/breakdown` (super-admin,
platform-wide by agentType) and `/api/v1/billing/admin/usage` (per billee), cross-checked against the
model-triggering actions logged in `actions-log-chat.json` + `actions-log-build.json`. Health throughout:
`meteringAnomalies=0`, `gatewayUnmeteredCalls=0`, `claudeAuth.ok=true`.

## By agentType (metered tokens)
| agentType | tokens | legit tag? |
|-----------|--------|-----------|
| build | 19403 | yes (user_work) |
| build-verify | 8155 | yes (user_work) |
| chat | 7009 | yes (user_work) |
| automation-plan | 2107 | yes (user_work) |
| memory-extract | 711 | yes (user_work) |
| classify-in-build-intent | 2 | yes (classifier) |
| **TOTAL** | **37387** | no `platform` anomaly tag present |

## By billee (per-user tokensUsed)
| userId (role) | tokensUsed | composition |
|---------------|-----------|-------------|
| 32c2e8cf (bc-u1, build) | 27560 | = build 19403 + build-verify 8155 + classify 2 (EXACT) |
| 68271b09 (a chat journey) | 3575 | chat + memory-extract |
| d98d2aa5 (a chat journey) | 2262 | chat + memory-extract |
| 7be00426 (bc-adm, automation) | 2107 | = automation-plan 2107 (EXACT) |
| 1f6956b7 (a chat journey) | 1352 | chat + memory-extract |
| 350aa2bb (a chat journey) | 531 | chat + memory-extract |
| **TOTAL** | **37387** | |

## Checks
- **Sums reconcile EXACTLY:** Sigma(per-user) 37387 == Sigma(per-agentType) 37387. Every metered token is
  attributed to a billee.
- **No orphan / empty-billee row:** no `userId=''` row in admin/usage; no `platform`-attributed tokens
  in the breakdown (that class would bump meteringAnomalies, which reads 0).
- **The four chat-journey billees** (my topology pre-flight + gc-u1/J2 + m-u1/J4 + az-u1/J6) sum to
  1352+3575+2262+531 = 7720 = chat 7009 + memory-extract 711 (EXACT). Every chat turn carries its
  post-run memory-extract, billed to the same user (by design).
- **Build attribution is precise:** bc-u1 carries build + build-verify + the in-build classifier and
  nothing else; build-verify (F28) is billed even though it verified a scaffold.
- **J8b automation confirmed to have run:** the `automation-plan` row (2107, billed to bc-adm) proves
  the automation model path executed and metered, even though worker-b-build did not report the
  webhook-run terminal state.

## Verdict
J9 PASS. The billing ledger is arithmetically sound: complete attribution, exact per-user and
per-agentType reconciliation, no orphan/empty-billee rows, zero metering anomalies. Dev pricing yields
amountUsd=0 (creditTokensPerUsd scale), which is expected, not a defect.
