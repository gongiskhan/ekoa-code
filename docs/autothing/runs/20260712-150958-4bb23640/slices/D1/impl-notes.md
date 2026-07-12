# Slice D1 — served-app assistant endpoint (POST /api/app-assistant)

Authored by the D1 worker (code) + lead (router mount + this note). The worker produced the four
code files + the evolved contract; the lead mounted the router in server.ts and ran the gates.

## Files
- shared/src/app-assistant.ts — EVOLVED additively: request gains optional `mode` ('do'|'show'|'teach')
  + `context` {route?, actionResults?}; response gains optional `citations`, `actions`, `mode`.
  `message`/`reply` unchanged (back-compat). appAssistantEndpoints descriptor updated in place.
- api/src/apps/app-assistant.ts — `runAppAssistant(input, deps)`: deterministic PT-PT mode inference
  (mostre/tutorial/visão -> show/teach; imperative verbs -> do; default do); grounding via
  buildGroundingBlock(kind:'chat') -> citations; assistant system prompt states the 3 capabilities +
  lists the manifest's app-actions as callable tools; calls runOneShot (assistant-chat attribution,
  billed to the OWNER + artifactId); parses a fenced ```ekoa-actions``` block out of the reply,
  validates each toolName against the manifest, drops unknown ones, strips it from the user reply.
- api/src/apps/app-assistant-route.ts — the header-scoped router: X-Ekoa-App-Id -> resolveApp ->
  owner activation gate (fail-closed) -> owner org lookup -> allowanceMiddleware(owner) ->
  runAppAssistant. CONV-2 envelope (emitted directly; apps/ may not import routes/). org + billee
  come ONLY from the resolved owner, never the visitor body.
- api/tests/apps/app-assistant.test.ts + api/tests/contract/app-assistant.contract.test.ts.

## Gates (lead-run)
- api typecheck (src + test) exit 0; eslint clean; gate:chokepoint clean (model egress only via llm/).
- 29 tests green: unit (mode inference, grounding->citations, ekoa-actions parse/validate/strip,
  unknown-tool drop, org-from-owner-not-caller) + contract (response w/ citations+actions+mode
  validates; error envelope) + schema-coverage + mount-coverage (the endpoint stays COVERED+MOUNTED).
- Router mounted at server.ts app.use('/api', appAssistantRouter()).

## For the lead / later slices
- DIAGRAM: the served-app plane (docs/diagrams/03-request-crud or 10-privacy-boundaries) should gain
  a POST /api/app-assistant node (owner-org grounding + chokepoint egress + allowance). Lead handles.
- D2 (panel) consumes this endpoint; D3 is the scripted 3-mode gate that exercises it live.
- The assistant PROPOSES actions in the response; the C3 runtime executes them client-side and C4's
  auditAssistantAction records each — D3 proves that full loop live.

## Worker confirmation (independent re-verification)

The four code files + the evolved contract are authored and self-verified. Re-ran from a clean state:
- `npm run build -w shared` ok; `api` `tsc --noEmit` (src + test) exit 0; eslint clean on all 5 touched
  `.ts` files; `gate:chokepoint` clean.
- 29 tests green across the four named suites; plus a regression spot-check (`shared` 36 tests,
  `assistant-tools` + `served-app` + `error-envelope` 31 tests) — the additive shared evolution broke
  nothing.
- Confirmed `server.ts` already carries the import + `app.use('/api', appAssistantRouter())` (lead-wired;
  the worker did NOT touch server.ts, honoring the 6-reserved-paths constraint). The no-arg call binds
  the route's `prodDeps` default (`runOneShot` / `buildGroundingBlock` / `decideForTask` floored WORKHORSE).

Two precise nuances the lead may want to action:
- **schema-coverage:** `appAssistant.assistantChat` is currently in the PENDING set (count 49); the
  gate passes green as-is. Now that it has a real contract test, the honest bookkeeping move is to add
  `'appAssistant.assistantChat'` to `COVERED` and set `EXPECTED_PENDING_COUNT` 49→48 in
  `api/tests/contract/schema-coverage.test.ts` (left untouched — outside the worker's reserved paths).
- **Admission strictness:** the assistant REQUIRES an artifact-backed owner (404 for a dev-serve /
  registry-only / unresolved id), unlike the lenient key-value app-data plane, because it must bind an
  org (to ground) and a billee (to meter). This is deliberate and matches analysis §3's owner-org chain.
