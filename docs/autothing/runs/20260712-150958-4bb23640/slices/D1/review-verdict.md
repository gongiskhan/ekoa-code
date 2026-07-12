VERDICT: approve

# D1 fresh-context review — POST /api/app-assistant (served-app assistant endpoint)

Reviewed: `f363557` (feat) + `097cf0c` (diagram 10). Branch `operator-run`.
Reviewer had no implementer context; all evidence gathered independently (below).

## Summary

The served-app assistant endpoint is implemented correctly and satisfies the D1
acceptance. The KEY correctness property — the org the assistant grounds under and
the user it bills come ONLY from the server-resolved artifact owner, never from the
anonymous visitor's request — holds **by construction** and is defense-in-depth
enforced. Egress is exclusively through the llm/ chokepoint one-shot. The owner
activation gate is fail-closed. The assistant proposes actions and never executes
them; unknown tool names are dropped and the fenced block is stripped from the
reply. The shared contract evolved additively. No blocking findings.

## Acceptance-criteria verification

- **Implemented per shared descriptor through llm/ public entry** — YES. Route mounted
  at `POST /api/app-assistant` (server.ts:591), header-scoped; `appAssistantEndpoints.assistantChat`
  descriptor intact (contract test asserts method/path/auth + evolved schemas). Model egress is
  only `runOneShot` from `../llm/index.js` (app-assistant.ts:267); no `@anthropic-ai` import.
- **Attribution assistant-chat billed to artifact owner** — YES. `attribution = { kind:'user_work',
  agentType:'assistant-chat', billeeUserId: input.owner.userId, artifactId }` (app-assistant.ts:260-265).
  `assistant-chat` is a registered `UserWorkAgentType` (llm/attribution.ts:21). Plus the
  `allowanceMiddleware` is billed to `owner.userId` (route:124).
- **Org-scoped knowledge grounding with citations** — YES. `deps.ground({ orgId: input.owner.orgId,
  query, kind:'chat' })` (app-assistant.ts:247); hits → citations (collection/docId/title).
- **Mode inference (do/show/teach)** — YES. Deterministic PT-PT classifier `inferMode`
  (teach-wins-over-show; bare imperatives default to `do`); client pin honored; inferred value echoed.
- **Response can carry actions + citations + tour refs** — YES. `citations` + `actions` on the
  response; tour refs are carried through `actions` as `startTour` manifest actions
  (action-manifest.ts:40 `startTour` kind → `app_action__<id>` tool → proposed in the actions array).
- **Contract tests incl. error envelope** — YES. `app-assistant.contract.test.ts` validates full +
  base responses, rejects bad mode/missing reply, asserts action.input must be a record, proves
  additive back-compat both directions, and validates the CONV-2 error envelope for all route codes.
- **Mount-coverage updated** — the endpoint is at `/api/app-assistant` (served-app plane, outside
  `/api/v1`), so it is auto-excluded from the mount-coverage probe (same treatment as served-data).
  Suite stays green; no manual list edit needed. Mounting is verified directly in the server.ts diff.

## Critical properties

1. **OWNER-ORG isolation (the key property) — CORRECT.** The only caller-controllable selector is the
   `X-Ekoa-App-Id` header (charset-checked, reserved `usr.` prefix rejected), which resolves
   server-side: `resolveApp(header)` → `app.ownerUserId` (from `art.userId`, registry.ts:32) →
   `users.get(ownerUserId).orgId` (route:101). Grounding org = `input.owner.orgId`; billee =
   `input.owner.userId`. The request body is parsed to `AssistantChatRequest`, which declares **no**
   org/owner/billee field (grep confirms none), and zod strips unknown keys, so a body-supplied
   `orgId`/`owner` can neither be expressed in the contract nor reach the logic. `runAppAssistant`
   reads org/billee ONLY from `input.owner`. There is no code path where a caller-supplied field
   steers org or billee. (Note: an attacker supplying another app's id gets that app's owner's
   assistant — this is the intended public served-app model, identical to the served-data plane, not
   a leak; grounding is correctly scoped to the resolved owner's org.)
2. **Egress only through api/src/llm/** — CONFIRMED. `gate:chokepoint` clean. Only egress call is the
   injected `oneShot` bound to `runOneShot`; no raw provider call, no `@anthropic-ai` import.
3. **Owner activation gate fail-closed** — CONFIRMED. Non-artifact-backed / missing ownerUserId → 404;
   `!activation || active===false` → ACCOUNT_DISABLED; `billingLocked` → BILLING_LOCKED (route:84-98);
   plus base-exhaustion → 402 BILLING_BLOCKED in the allowance gate. All refusals before the handler.
4. **ekoa-actions: propose-not-execute** — CONFIRMED. `extractActions` keeps only actions whose
   `toolName` is in the app manifest's `validToolNames` (unknown dropped), coerces non-object input to
   `{}`, strips every fenced block (incl. malformed) from the user-facing prose. Server never
   dispatches. An app with `actionManifest:null` has zero valid tools → all actions dropped.
5. **Contract additive/back-compat** — CONFIRMED. Base `{message}` / `{reply}` still validate; all new
   fields optional; shared file imports only zod (+ a descriptor type). schema-coverage + tsc green.

## Findings (all NON-BLOCKING)

- **[low] No executing HTTP test of the route admission.** The pure logic (`runAppAssistant`) and the
  schemas are unit/contract tested, but no test drives the real `/api/app-assistant` route through
  `admit` to prove at runtime that a disabled/billing-locked owner is refused and that resolveApp→owner
  is the sole org source. The property holds by construction and a later independent-test gate drives
  the running endpoint, so this is test-depth, not a defect. Recommend a route-level integration test
  mirroring served-data's admission tests in a follow-up.
- **[low] Empty-orgId fallback.** `orgId = owner?.orgId ?? ''` (route:102). If a resolved owner lacked
  `orgId`, grounding would run under `''`, which `search` maps to `orgId IN ('', SHARED_ORG_ID)` — only
  rows literally stored under `''` (none exist; every user has an orgId) plus the public shared corpus.
  NOT a cross-tenant leak. Consider failing closed rather than silently grounding under `''`.
- **[info] context.actionResults content is not fed to the model** — only a boolean "results exist"
  flag is added to the prompt (app-assistant.ts:171-173). Shallow screen-state grounding; arguably a
  deliberate privacy choice (no opaque client blobs echoed into the prompt). Not a defect.

## EVIDENCE

- `npx vitest run tests/apps/app-assistant.test.ts tests/contract/app-assistant.contract.test.ts tests/contract/schema-coverage.test.ts tests/contract/mount-coverage.test.ts --root api`
  → **4 files, 29 tests passed**.
- `npm run gate:chokepoint` → **clean** (no `@anthropic-ai/` or `api.anthropic.com` outside api/src/llm/).
- `npx eslint api/src/apps/app-assistant.ts api/src/apps/app-assistant-route.ts shared/src/app-assistant.ts`
  → **exit 0** (no import-boundary / no-restricted-imports violations).
- `npx tsc -p shared/tsconfig.json --noEmit` → **0**; `npx tsc -p api/tsconfig.json --noEmit` → **0**.
- Grep: `AssistantChatRequest` declares no org/owner/billee field; route body reads are only
  message/history/mode/context; owner/org sourced solely from `resolveApp` + `users.get` in `admit`.
- Diagram invariant: `097cf0c` added the owner-org/billing boundary to
  `docs/diagrams/10-privacy-boundaries.excalidraw` (structural change carries its diagram update).
