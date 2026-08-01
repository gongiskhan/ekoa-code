# Integrations unification - discovery-gate audit

Date: 2026-08-01. This is the factual base for the "Integrations, unified" brief (decisions locked
2026-07-31; supersedes the browser-integrations brief - see `decisions.md`). The brief's own scope
item 1 requires this audit, with verdicts, before anything is built. Method: seven parallel
read-only auditors over the live tree at `571cf55` (six code areas + one web-research pass on the
Caixa Citius auth rail); every claim below carries a `file:line` or URL and is spot-checkable.

Verdict scale: **present** = usable for the brief with wiring only; **partial** = exists but needs
real rework or extension; **absent** = does not exist.

## Verdicts

| Area | Verdict | One line |
|---|---|---|
| Automations v2 engine as the browser backing type | **partial** | Mature 9-step-type runtime with self-heal, already invocable as an integration action; welded to a persisted Automation doc, no mcp step, no action-level read/write policy |
| Integration agent + recipe/action format | **partial** | Actions[] with `mutates`/schemas/httpConfig already exist; builder agent is a human-driven dashboard chat; `transport` field is the designed backingType seed but the executor refuses non-http |
| Integration-execution capability boundary | **partial** | The whole capability machinery (user-or-key, generated OpenAPI + drift gates, 27 ops) is live and automations is fully published on it; integrations/cofre/builder are dashboard-only, no execute-action endpoint, no first-class Action entity |
| Cofre coverage across backing types | **partial** | Vault is strong (storageState is a first-class credential; unwrap() is the single fail-closed seam; typist CDP primitive built) but the live api-call path uses a parallel credential store and the typist has no engine call site |
| Sharing / visibility / tenancy of definitions | **partial** | Automations have real tenancy; integration DEFINITIONS have none - one global filesystem namespace, listed unfiltered to every tenant (the inverse of private-by-default) |
| Completeness / sync primitives | **partial** | Battle-tested cursor+dedup rails and a working Citius insolvency watcher exist; the completeness VERIFICATION layer (run-level goal check, cross-run reconciliation) is absent |
| Caixa Citius auth rail | **present** | Username+password today, legally sanctioned until 2027-01-01; the OA certificate is a downloadable .p12, not a smartcard. Establishment is a cloud typist, not a bridge ceremony |

Six partials and one present is a favourable gate: no area is absent, and the two mechanisms the
brief bets on (vision-planned browser steps with self-heal; goal -> author -> verify -> persist)
already run in production form. The partials are seams and scope, not missing engines.

## 1. Automations v2 engine (browser backing type)

What exists (`api/src/automation/`):

- One dispatch switch (`engine.ts:1275`) over 9 step types: `browser`, `verify`, `integration`,
  `sub_automation`, `navigate`, `wait`, `local_command`, `api_call`, `ekoa_action`
  (`types.ts:161`). Three of the brief's four backing types are therefore already step executors;
  only `mcp` is missing.
- The browser family is the only tier carrying vision: cache replay keyed on `PageFingerprint`,
  then vision resolve through the `api/src/llm` chokepoint (`engine.ts:1450`, `vision.ts:19`).
  Execution goes over the bridge to the local daemon's real Playwright (`browser-session.ts:116`)
  with an in-process fallback for dev (`local-browser-session.ts`).
- Self-heal exists and runs on normal runs, not just rehearsal: `rehearsal.ts:126` proposes one
  budget-capped local patch per failure (insert/replace/skip/pause/abort); only rehearsal persists
  refined steps. `shouldAttemptFix` (`engine.ts:2161`) already excludes credential-adjacent
  failures.
- The engine is ALREADY invocable as one action inside an integration: `runAutomationForAction`
  (`service.ts:941`) maps action args onto automation inputs and extracts the last step output as
  the action result, bound once at the composition root (`server.ts:393`) so `integrations/` never
  imports `automation/`. This is the exact seam the unified model formalises.
- Consent machinery: `awaiting_consent` pause/resume, `approveCommandShape` scoped
  org+user+pairing with 90-day TTL (`consent.ts:70`), run-scoped `runApprovedShapes` for "once".

What is missing for the brief:

- `mcp-call`: no MCP client exists anywhere in `api/` (every "mcp" hit is the in-process Agent SDK
  tool server inside the llm chokepoint, `llm/sdk-tools.ts:17`). New executor, new credential
  story, and it must respect the egress policy.
- The weld: `runOrRehearse` requires a persisted Automation document (`engine.ts:378`); there is
  no `runSteps(steps, ctx)` entry. Either keep materialising per-action automation rows (the
  provisioner pattern) or refactor the entry to accept an in-memory spec.
- Read-auto-run vs write-confirm at ACTION granularity: today's confirmation primitives are
  per-bash-command-shape consent, `pause_for_user`, and an inert bridge write-approval store
  (`bridge/write-approval.ts` - fail-closed, nothing calls `approveWrite()`). The `mutates` flag
  on integration actions gates nothing at execution time.
- Network-capture discovery: does not exist in any form; vision-over-screenshots is the only
  discovery mechanism. (The brief lists it for browser actions - treat as new, deferrable.)
- Daemon action-set parity: dblclick/select/check/uncheck/wait_for/scroll are rejected by the
  daemon's zod today (`browser-session.ts:232`).

Reuse nearly as-is: the three executors (`executors/{api-call,local-command,ekoa-action}.ts`), the
whole browser stack (session/executor/vision/cache/fingerprint/typist/masking), the self-heal
loop, `runAutomationForAction` + `ActionRunBinding`, `provisionIntegrationAutomations` (the
template-to-tenant materialisation pattern, `integration-automations.ts:105`), consent machinery,
the persistence layer, `StepDeclaration` (fail-closed, `credentialRefs` as `cofre:` references
only) and `egress-policy.ts`.

## 2. Integration agent + recipe/action format

What exists (`api/src/integrations/`, `api/src/agents/`):

- Integrations are already action-shaped: `IntegrationAction` = actionName, description,
  `mutates`, argsSchema, returnSchema, plus exactly one backing - templated `httpConfig`
  ({{var}} interpolation, `http-template.ts:27`) or `automationBinding` pointing at a materialised
  automation (`definitions.ts:61`). The additive `transport` field (`definitions.ts:69`) is the
  designed backingType extension point, but `action-executor.ts:119` refuses anything non-http.
- Package format: on-disk `config.json` per integration, two tiers - shipped baseline under
  `api/assets/integrations/<key>/` and user-created runtime under
  `<dataDir>/integrations/runtime/<key>/` (`definitions.ts:219`), runtime shadowing baseline
  globally.
- The authoring agent exists: `agents/integration-builder.ts` - a tool-less one-shot chat through
  the chokepoint emitting SKILL.md + config-json, parsed and validated
  (`integration-builder-parser.ts:125`) then saved via `writeRuntimePackage`
  (`definitions.ts:380`). Human-driven dashboard flow; the parser currently REQUIRES httpConfig on
  every authored action.
- Lessons/notes exist only as prose: per-package SKILL.md served to agents on demand via
  `load_context` as `integration-<key>` (`definitions.ts:345`) - the natural home for the brief's
  lessons-learned area, but nothing feeds execution outcomes back into it.

Corrections to the brief established here:

- **Google Workspace is not a CLI integration.** All 24 actions are `httpConfig` against Google
  REST APIs, executed server-side via platform OAuth (`platform-call.ts`). No CLI-backed
  integration exists today; the only bash execution is the automation engine's `local_command`
  step on the user's paired machine over the bridge. "bash-cli as an action backing" is a
  promotion of that step type, not a port of existing integrations.
- The `proxyContract` field in shipped configs (`/api/agent/integrations/execute`) is dead legacy:
  no route serves it and the builder parser strips it.

Missing: explicit backingType discriminator honoured by the executor; mcp-call; bash-cli as an
action backing; author-on-miss self-extension (the builder has no no-action-fits trigger and no
guardrails); per-tenant package copies; structured lessons; per-action Cofre scope declaration.

## 3. Capability boundary in Cortex

What exists - the boundary itself is built and gate-enforced:

- AuthClass `user-or-key` (`shared/src/descriptor.ts:11`) + `requireUserOrApiKey`, a GENERATED
  OpenAPI spec (`docs/openapi/cortex.v1.json`, exactly the 27 user-or-key operations) pinned by a
  byte-diff drift test (`api/tests/contract/openapi-drift.test.ts`), a generated typed client +
  `cortex` CLI with its own drift gate, schema-coverage (pinned PENDING count 49) and
  mount-coverage. A new user-or-key descriptor is published to the spec definitionally; the
  landing recipe is `docs/CAPABILITY_CONTRACT.md:108`.
- Automations is ALREADY a public capability domain: 17 user-or-key endpoints including
  `POST /api/v1/automations/plan` - which already persists the authored automation and starts a
  rehearsal run (`shared/src/automations.ts:340`, "Landmine 9"). The brief's
  goal -> author -> verify -> persist loop exists under a gateway key today, just not
  integration-scoped and without an execute-or-author gate in front.
- memvault (6 ops) and knowledge reads (4 ops) share the surface.

Missing: integrations, integration-builder, and cofre are all dashboard-only (`auth 'user'`;
`routes/integrations.ts:36` mounts plain `requireAuth`); no "execute a named action" endpoint; no
first-class Action entity (actions live as `ProvisionBinding` template metadata); no
integration-scoped Cofre grant; rule 4's cross-domain mount check remains per-domain (a new
capability router must pin `requireUserOrApiKey` in its own suite).

Landing cost per new route is mechanical and known: descriptor + COVERED entry (or conscious
PENDING bump) + mounted router + regenerated OpenAPI/client + per-domain auth suite + a
memvault-class isolation suite if the Action store holds state.

## 4. Cofre coverage across backing types

What exists (`api/src/cofre/`, `api/src/bridge/`):

- Closed item-type enum where a captured Playwright storageState IS a credential (type `session`,
  `shared/src/cofre.ts:30`); `CREDENTIAL_REF_PATTERN` enforces references-not-values at the
  contract layer; per-credential grants (this_run / ttl / until_locked, default-deny); per-item
  `boundOrigins` where empty means unusable, not unrestricted.
- `unwrap()` (`cofre/service.ts:94`) is THE single reference-to-value seam, fail-closed on
  tenancy -> grant -> origin -> decrypt, and is exactly where "an authored action cannot reach a
  new secret" installs. `assertOriginAllowed`/`credentialedFetch`
  (`security/origin-binding.ts:44`) is the "cannot reach a new domain" hook.
- The full browser credential stack is built and security-tested: `captureSessionToCofre`,
  `checkoutSession` (health-then-egress reestablish routing), `typistLogin` (origin check before
  unwrap, CDP out-of-band fill, screencast suppression). Bash gets `resolveEnvInjection` (I9) and
  one-time pairing-bound `deliverSecrets` (H-4/R-8).

Missing - and this reorders the build:

- **The live api-call path does not use the Cofre.** Integration credentials sit in a parallel
  store (`IntegrationConfigDoc.credentialsCiphertext`, `integrations/service.ts:18`) with no
  grants, no lock, no per-item origins; the origin check is an interim resolver derived from
  package baseUrls (`server.ts:444`, commented "Cofre per-item boundOrigins replaces this in
  WS-C"). The WS-C migration is a PREREQUISITE for "authored actions stay inside the integration's
  granted Cofre scope" - the scope join cannot exist while credentials live outside the vault.
- No machine-checkable integration -> Cofre-item link (`CofreItemDoc` has no integration field;
  a session's integration is its human label).
- `typistLogin` and `checkoutSession` have NO engine call sites (stated in
  `api/tests/security/typist-non-memorable.test.ts:14`) - built, tested, unwired.
- Expiry -> notify -> reauth is vocabulary, not behaviour: `cofre_session_expired` has zero emit
  sites; no relay UI exists in `web/`.
- MCP credentials: no item type, no transport, nothing.
- Write confirmation has its enforcement half (fail-closed `write-approval.ts` store) and no
  approval half (no UI).

## 5. Sharing, visibility, tenancy

What exists:

- Automations: real tenancy - orgId + ownerUserId + visibility `private`|`org`, enforced in
  queries and re-checked per row (`automation/service.ts:162,242`), private rows invisible even to
  super-admin, regression-netted (`api/tests/security/automation-visibility.test.ts`).
  `OwnerVisibilityScoped` (`data/scoped.ts:47`) is the house pattern.
- The super-admin global-visibility toggle exists ONCE, for artifacts: the `featured` flag
  (`routes/artifacts.ts:173`, `requireRole('super-admin')`), resolvable cross-org.
- Copy-on-use precedents: `forkArtifact` (clone into acting tenant with `forkedFrom` lineage,
  `apps/artifact-fork.ts:62`) and `provisionIntegrationAutomations` (template -> org-owned
  automation with `source` backlink).

Missing - the sharpest inversion the audit found:

- **Integration definitions have no ownership model at all.** No orgId/userId on
  `IntegrationDefinition`; one global runtime dir any authenticated user's builder writes to
  (`routes/integration-builder.ts:210` behind `requireAuth` only); `GET /api/v1/integrations`
  returns everything to every tenant (`routes/integrations.ts:41`). User-created integrations are
  globally visible TODAY - the inverse of the brief's private-by-default, and the definition-leak
  risk the brief's publish-scrub addresses is live without any toggle. Logged as an OPEN finding.
- No `global` visibility tier anywhere (enum is `private`|`org`); no copy-on-author semantics; and
  the one template-copy mechanism is not multi-org safe: `managedAutomationId =
  <integrationKey>-<templateKey>` has no org component, and the duplicate-_id insert is swallowed
  (`store.ts:28` returns false, unchecked), so a second org provisioning the same template
  silently gets nothing (`integration-automations.ts:54`). Logged as an OPEN finding.

## 6. Completeness / sync primitives

What exists:

- Two full incremental-sync implementations sharing one contract - "the cursor advances only after
  every item is durably enqueued; a missing dedup key stalls the cursor rather than dropping the
  item": `platform-poll.ts` (item-high-water + poll-time strategies, continuation cursors,
  observable stall) and `user-defined-poll.ts` (provider cursors). Durable per-trigger cursor
  store (`events/listener-state.ts`), real scheduler (`events/listener-supervisor.ts`), and the
  event queue's deterministic `triggerId::dedupKey` ids as a durable captured set with
  retry/dead-letter delivery.
- Directly on point: a working Citius insolvency watcher (`legal/insolvencia-watch.ts`) with
  content-hash dedup refs for id-less portal rows, a per-watch seen-set with
  emit-first-then-persist ordering (at-least-once, never loses), and a lastSeen watermark - built
  against the same ASP.NET WebForms stack, parser primitives in `legal/portal-html.ts` transfer
  as-is.
- Run history is durable per status transition with per-step outputs, so a second pass CAN read
  the previous run's captured set.

Missing - the verification layer, which is the brief's actual bar:

- No post-run / goal-level verification hook exists; `verify` steps check page state, never set
  completeness. A run-level verification concept must be added to the engine (or to the capability
  layer above it).
- No cross-run reconciliation anywhere; the seen-set cap (500) is unproven for a notification
  inbox; the cursor store keys on triggerId only, so an Action-shaped sync needs a trigger binding
  or a per-action sync-state row.
- Browser-scraped set-completeness ("did we enumerate the full inbox since the watermark, across
  pagination") is entirely new design. Recommended shape from the rails that exist: watermark +
  content-hash dedup into a durable captured set, plus a second-pass reconciliation query over an
  overlapping window asserting zero new refs - the platform-poll inclusive-boundary re-fetch
  discipline applied to a scraped grid.

## 7. Caixa Citius auth rail (web research, 2026-08-01)

The one **present** verdict, and it flips a repo assumption:

- The live mandatarios portal (`citius.tribunaisnet.mj.pt/habilus/myhabilus/login.aspx`, fetched
  today, app updated 2026-04-29) logs in with **username + password** - plain ASP.NET forms auth
  (`#txtUserName` / `#txtUserPass`), session cookie HttpOnly with no Expires. This is legally
  sanctioned: Portaria n.º 350-A/2025/1 art. 39.º n.º 3 admits password access until
  **2027-01-01**, when art. 4.º n.º 7 (accredited-CA certificate or SCAP via CC/CMD) becomes
  mandatory.
- **The OA credential is a downloadable `.p12` file, not a smartcard** (OA's own manual: fetched
  from the Área Reservada, unlocked by SMS password, imported into the OS keychain). The smartcard
  rail belongs to MAGISTRADOS (Portal Citius FAQ). The premise in
  `api/src/bridge/attended.ts:5` ("Citius/OA authenticate with a smartcard... a cloud browser
  cannot touch one") is factually wrong for the advogado read path; logged as an OPEN finding. The
  attended ceremony remains right for the CC/CMD SCAP rail and for eTribunal.
- **Consequence for the brief: login establishment is a CLOUD TYPIST**, and the typist needs only
  a three-selector login recipe on the existing registry. Reading is legally decoupled from
  submitting (filings need a qualified signature applied in-system at submission, art. 5.º).
- Deadline mechanics for the read-only sync: the 3rd-day presumption (CPC art. 248.º n.º 1) runs
  from the system's send date; opening/marking read does not move it (Portal Citius art. 301). But
  art. 38.º n.º 2 logs every access with date/hour/author/process, and penal jurisprudence has
  used a recorded EARLIER actual read to rebut the presumption AGAINST the notified party (CPP
  art. 113.º n.º 2). **A read sync is deadline-neutral but not trace-free - whether the sync opens
  documents or fetches metadata only is a product decision for a lawyer, not an engineering
  default.** Notifications stay available 2 years (art. 22.º n.º 1).
- Unmeasured (first technical spike once a real account is available): authenticated session
  lifetime and whether a storageState established once replays from a datacentre IP (a WAF cookie
  is present); concurrent-session policy (does a sync log the lawyer out?); inbox pagination.
- Horizon risks: the 2027-01-01 password cliff (the `.p12` mTLS rail or SCAP ceremony takes over -
  the `.p12` being a portable file makes unattended server-side auth technically possible, pending
  an OA professional-conduct check on key custody); and the eTribunal migration ("concluded by end
  2025" per IGFEJ - already slipped; Citius Web is alive and maintained today, but plan for the
  connector to be replaceable). No official API for mandatarios exists; eTribunal's announced
  interoperability has no published spec.

## What the verdicts do to the build order

1. **Prerequisite slices surfaced by the audit** (before the unified model can hold its
   guardrails): the WS-C migration of integration credentials into the Cofre; an ownership model
   for integration definitions (Mongo via `OwnerVisibilityScoped`, private-by-default, closing the
   cross-tenant visibility finding); org-scoped provisioner ids.
2. **The unified Action entity** is a formalisation of seams that exist (`IntegrationAction` +
   `runAutomationForAction` + the executor taxonomy), not a rewrite. The engine-entry weld
   (persisted Automation doc) is the one real refactor decision.
3. **The capability endpoint** (execute-or-author) lands on machinery that is ready; the
   self-extension brain is `planner.ts` + the builder's validate/persist path with a new
   author-on-miss trigger and the section-6 guardrails (whose halves - `mutates`, write-approval
   store, consent flow, `unwrap()`/origin binding - all exist and need joining, not inventing).
4. **mcp-call** is the only net-new executor, and network-capture discovery the only net-new
   discovery mechanism; both are deferrable behind the Citius proof, which needs neither.
5. **The Citius proof** needs: typist wiring into the engine (the primitive exists unwired), a
   login recipe, an inbox connector sibling to `legal/citius.ts` (reusing the WebForms parser
   primitives and the insolvency watcher's dedup discipline), a sync-state row, and the new
   run-level completeness verification - plus the metadata-vs-open product decision above.
