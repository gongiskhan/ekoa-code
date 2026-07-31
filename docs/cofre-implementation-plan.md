# Cofre v1 - sequenced implementation plan (Part D)

**Derived 2026-07-27 from the Part C discovery gate** (`cofre-discovery-gate.md`). Read that first - this plan's verdicts and effort estimates come from its corrected matrix.

## Corrections that override this plan as written

The completeness pass landed after the plan was drafted. Three of its findings change the plan and are **not** yet reflected in the workstream sections below:

1. **WS-D is not greenfield.** `web/lib/navigation.ts:66-81`, `web/app/(dashboard)/settings/privacy/page.tsx:47-53` and `web/e2e/privacy-grants-ledger.spec.ts` ship a grants list with revoke, an egress ledger view, a masking summary and an honest-unavailable state. D-1 through D-3 and D-6 should extend that area rather than create a parallel one. Effort drops from large to medium.

2. **WS-B has a working item-lifecycle precedent.** `api/src/auth/gateway-keys-service.ts` already implements mint-once/list/revoke/fail-closed-verify/throttled-last-used/per-item caps with registo events on the `security` category. B-1 and B-5 are "generalize this to a typed item model", not build-fresh. The eleven-event vocabulary joins an existing category set (`anonymisation`, `security`, `credential`, `auth`, `session`, ...), it does not create one.

3. **A D8 is missing from the gate entirely.** No audit examined the live OAuth credential-custody plane: `api/src/integrations/platform-oauth.ts` (refresh-token custody with singleflight rotation), `m365-proxy.ts` (a fixed token injector - the closest shipped analogue of the I9 primitive), `prefetch.ts` (OAuth content piped into the chat system prompt, a live I1/I3 surface), `app-sso-sessions.ts`, `pipedream.ts`. This is the largest unexamined credential surface in the repo and it holds refresh tokens today. **Run D8 before Phase 1 finishes**; it will change WS-B's item model and may change WS-J's I9 design.

Also note `api/tests/SUITE_LEDGER.json` has no security or privacy suite class, though `CLAUDE.md` and the `ekoa-testing` skill mandate named ones. Every `api/tests/security/*.test.ts` this plan adds needs that class to exist first, or the census stays blind to them. Fold it into R-7.

---

Derived from the corrected discovery matrix. Verdicts and evidence are carried forward from the matrix; where I re-verified a claim myself in this pass it is marked **[re-verified]**.

---

## 1. Status at a glance

### D1 - Vault / Cofre core

| Element | Verdict | Decision | Effort |
|---|---|---|---|
| (a) Vault storage layer (KMS envelope, per-tenant DEK, ciphertext at rest, RAM-only, zeroize) | diverges | close-gaps | large |
| (b) Grant model + scopes (this-run / TTL / until-locked), per-credential | absent | build-fresh | large |
| (c) Policy-lock seam (single seam, upgradeable to key-share) | absent | build-fresh | medium |
| (d) Typist primitive (origin binding, CDP fill, atomic fill+submit, recipes, fail-to-relay) | absent | build-fresh | large |
| (e) Redaction pipeline coverage (logs, traces, HAR, video, console, memory) | diverges | close-gaps | large |
| (f) Cofre UI area (left menu, item types, states, last-used, lock-now, lock-all) | absent | build-fresh | large |
| (g) Unlock/consent page with durations (+ no TTL UI for signature identities) | absent | build-fresh | medium |
| (h) Relay page + protocol-level operation typing (login vs signature) | absent | build-fresh | large |
| (i) Registo Cofre events (11 minimum) | diverges | close-gaps | medium |
| (j) Former Google Secret Manager attempt | absent | build-fresh (RETIRE) | small |
| EXTRA · Session-first storage (storageState as credential-equivalent) | absent | build-fresh | large |
| EXTRA · Bridge secret delivery + capability registry (protocol v2) | absent | build-fresh | large |

### D2 - Bridge control plane

| Element | Verdict | Decision | Effort |
|---|---|---|---|
| (a) Websocket message set vs target families | diverges | close-gaps | large |
| (b) Auth model (issuance, rotation, signing, replay) | diverges | close-gaps | medium |
| (c) Machine identity + registry (tenant binding, health) | diverges | close-gaps | medium |
| (d) Capability advertisement + per-tenant-per-machine grants | absent | build-fresh | large |
| (e) Audit trail of every invocation + approval flow | diverges | close-gaps | medium |
| (f) Secret handling on bridge paths (disk, logs, queue) | diverges | close-gaps | large |
| (g) Reconnect, health, offline detection | diverges | close-gaps | small |
| Automation capability RPC (`DaemonConnection.runStep`) - the second, older daemon path | diverges | close-gaps | large |
| Data plane - Tailscale egress, tailnet advertisement, cloud-browser proxying | absent | build-fresh | large |

### D3 - Sessions

| Element | Verdict | Decision | Effort |
|---|---|---|---|
| (a) Where a session blob is persisted / encrypted / under whose key | absent | build-fresh | large |
| Session-injection primitive (`extractSessionCookies` / `injectSessionState`) | diverges | close-gaps | medium |
| (d) Per-tenant AND per-site scoping; per-context cloning | diverges | build-fresh | medium |
| (e) Expiry detection, auto re-establishment, re-auth prompt | absent | build-fresh | medium |
| (f) Session metadata (machine, egress, UA/fingerprint, health) | absent | build-fresh | medium |
| Bridge path: session state, `session.push`, session-equivalent material on bridge disk | absent | build-fresh | large |

### D4 - Steps and credential touch points

| Element | Verdict | Decision | Effort |
|---|---|---|---|
| (a) Inventory of implemented step types | diverges | close-gaps | medium |
| (a) Execution locus per step type | diverges | close-gaps | medium |
| (b) Bash/shell step + model authorship of the command string | diverges | close-gaps | large |
| (b) Can a secret value be interpolated into a command string today? | diverges | close-gaps | large |
| (d) Existing environment-variable injection primitive | diverges | close-gaps | large |
| (c) Step outputs → LLM context | diverges | close-gaps | medium |
| (c) Step outputs → logs, SSE, persisted run records | diverges | close-gaps | large |
| (c) Step outputs / resolved actions → memory pipeline | diverges | close-gaps | medium |
| (e) Model-authored content authoring credential-touching code (I5) | diverges | close-gaps | large |
| (e) Origin binding on credential use (`authIntegrationKey`) | absent | build-fresh | medium |
| (d) Bridge control-plane wiring for secret-bearing non-browser steps | absent | build-fresh | large |
| Audit trail for step execution (registo events) | absent | build-fresh | medium |

### D5 - Egress, routing, tenancy

| Element | Verdict | Decision | Effort |
|---|---|---|---|
| (a) Mac Mini / Tailscale residential egress as used today | absent | build-fresh | large |
| (b) Bridge advertises tailnet address / egress endpoint at registration | absent | build-fresh | medium |
| (b) Router selecting machine/egress per run | diverges | close-gaps | large |
| (b) Egress capability recorded in the Cortex bridge registry | diverges | close-gaps | medium |
| (b) Per-run offline fallback policy (fail / queue / datacenter) | diverges | close-gaps | medium |
| (c) Browser traffic tunneled through the control websocket (ruled out) | diverges | close-gaps | medium |
| (d) Tenant-scoping enforcement points on data access | diverges | close-gaps | large |
| (e) Apify tenant isolation | absent | build-fresh | medium |

### D6 - Portal rails (UNVERIFIED audit; rail claims are hypotheses)

| Element | Verdict | Decision | Effort |
|---|---|---|---|
| Ordem dos Advogados email/webmail | absent | build-fresh | medium |
| Citius / eTribunal - Portal dos Mandatários | diverges | close-gaps | large |
| IRN registries (Predial / Civil / Certidão Permanente) | diverges | close-gaps | medium |
| CidNews | unresolved | needs-manual-check | small |
| Bridge card/attended plumbing for a card-gated portal start | absent | build-fresh | large |

### D7 - Model-bound payloads

| Element | Verdict | Decision | Effort |
|---|---|---|---|
| (a) What is sent to the model as page snapshot / DOM today | diverges | close-gaps | medium |
| (b) Is ANY redaction applied to that payload today | diverges | close-gaps | medium |
| (c) Cost of masking usernames | diverges | close-gaps | medium |
| (d) Screenshots and video - pixel path in scope | diverges | close-gaps | large |
| (e) GDPR/PII defensibility of "low-sensitivity" | diverges | close-gaps | medium |

### MISSED elements (no audit issued a verdict)

| Element | Verdict | Decision | Effort |
|---|---|---|---|
| `api/src/streaming/` + pause-for-user overlay as a security surface | unresolved | needs-manual-check | medium |
| I7 (signature authority outside the grant/TTL model) | unresolved | needs-manual-check | medium |
| Test coverage of the credential boundaries the plan leans on | unresolved | needs-manual-check | small |
| `docs/diagrams/02-module-map.excalidraw` - where the Cofre lands in the tier table | unresolved | needs-manual-check | small |
| `ekoa-bridge/src/containment/resolver.ts` - no sensitive-file denylist | unresolved | needs-manual-check | medium |
| `ekoa-bridge/src/session/egress.ts` - EgressAccounting byte cap | unresolved | needs-manual-check | small |
| What the Cortex chokepoint does with bridge-forwarded bodies | unresolved | needs-manual-check | small |
| `events/` inbound plane tenant filters | unresolved | needs-manual-check | small |
| Whether `DaemonBrowserSession` / `setDaemonConnectionResolver` are maintained or abandoned | unresolved | needs-manual-check | small |
| ekoa-bridge Tier-2 `browse()` returns 100 KB raw innerText | diverges | close-gaps | medium |

**[re-verified this pass]** - `api/src/data/crypto.ts:5-6` ("KMS envelope encryption (P-14, deferred)") and `:19-25` (`sha256(ENCRYPTION_KEY)`, optional scope suffix); `api/src/automation/platform-primitives.ts:324-330` (`if (isAbsolute(path)) return path;`) with `file.read` at `:207-212` and `file.write` at `:214-220`; `api/src/llm/client.ts:967-968` (anonymise prompt + system) vs `:981` (`images: opts.images` verbatim); `shared/src/registo.ts:15-23` (`.passthrough()`); `api/src/auth/capabilities.ts:32-40` (`can()`); `web/lib/navigation.ts:49-90` (no Cofre entry); `api/src/services/url-fetcher.ts:71-87` (guardedFetch = SSRF only, every public host allowed).

One matrix "unresolved" is **partially closable now**: named regression tests DO exist for two of the four boundaries the plan leans on - `api/tests/automation/api-call-redaction.test.ts` (the api-call masker) and `api/tests/automation/ekoa-action-credentials.test.ts` (ekoa-action credential scrub), plus `api/tests/llm/anonymise-chokepoint.test.ts` and a four-file `api/tests/security/` directory (`app-docx-authz`, `assistant-cross-org-isolation`, `destructive-action-authz`, `grep-gates`). I found **no** test named for `template-vars` redaction or `redactSecretsDeep`; those two remain uncovered and must not be treated as load-bearing until PR R-7 lands.

---

## 2. Fix-now breaches

**These are remediation of code shipped today. They are NOT part of the v1 Cofre build, do not depend on the contract PR, and must not wait for the deep-security block at the end.** Each is a bug fix with a findings.md row and a deterministic regression test, sized to land in days, not weeks. They are listed in blast-radius order.

### R-1 - `ekoa_action` filesystem primitives have no sandbox (I5 + I1 + I2 + I4, critical, LIVE)

`resolveUserPath` at `api/src/automation/platform-primitives.ts:324-330` applies no containment: `if (isAbsolute(path)) return path;`. `file.read` (`:207-212`) reads any path into `ctx.captured`, which is persisted as `capturedValues` and returned by `extractActionRunOutput` (`api/src/automation/service.ts:650`) into the calling agent's tool result. `file.write` (`:214-220`) is equally unrestricted. This executor runs **cloud-side with no daemon dependency**, and `api/src/automation/rehearsal.ts:307-317` lets the mid-run fixer LLM choose `artifactSlug`/`capabilityName`.

**Fix:** a containment resolver modelled on `ekoa-bridge/src/containment/resolver.ts:22-45` - realpath-after-resolution must stay inside a per-owner root under `<dataDir>/action-workspace/<orgId>/<userId>/`; absolute paths outside it throw; symlink escape blocked by comparing the realpath, not the lexical path. Plus a denylist that refuses `.env`, `.ssh/**`, `.aws/**`, `.gnupg/**`, `id_*`, `*.pem`, `*.p12`, `*.pfx` even inside the root. Do NOT ship the denylist alone - containment is the control, the denylist is defence in depth.

**Cannot wait because:** it is a remote-triggerable arbitrary-file-read on the API host reachable from an LLM-authored manifest, and the read bytes exit to a third-party model. Nothing in the sequenced plan makes it safer earlier.

### R-2 - Credential exfiltration via model-authored URL (I6 + I5, critical, LIVE)

Two paths, the model-authored one weaker. `api/src/automation/executors/api-call.ts:65-96, 126-135` interpolates decrypted fields for a model-supplied `authIntegrationKey` into a model-supplied URL; the only gate is `guardedFetch` (`api/src/services/url-fetcher.ts:71-87`) **[re-verified]**, which blocks private/loopback/metadata and permits every public host. `api/src/integrations/action-executor.ts:292-295, 328-332` sends on a bare `globalThis.fetch` behind a `/^https?:\/\//i` shape check on a baseUrl written verbatim from the model's `config.json` (`api/src/routes/integration-builder.ts:210`).

**Fix (interim, before the full Cofre origin model):**
1. Add an `allowedOrigins: string[]` option to `guardedFetch` and make it **mandatory** for any call that carries injected credential material - an empty/absent list refuses.
2. Derive the interim allowlist from the integration definition's existing `httpConfig` base URL (`api/src/integrations/definitions.ts:380-386`), eTLD+1 matched.
3. Route `api/src/integrations/action-executor.ts` through `guardedFetch` - the bare `globalThis.fetch` must go regardless of the Cofre.
4. New error code `CREDENTIAL_ORIGIN_REFUSED` (422) in the shared error envelope.

This is the seam the permanent I6 binding installs on later (WS-C), so the work is not thrown away.

**Cannot wait because:** one fixer-authored patch exfiltrates a live tenant secret to any public host in a single hop.

### R-3 - Unauthenticated screenshot mount + no login-window suppression (I2 + I4, high, LIVE)

`api/src/automation/engine.ts:1689-1703` screenshots after every act; `api/src/automation/persistence.ts:63-78` writes plaintext PNG; `api/src/server.ts:912-920` serves the tree via `express.static` with no auth middleware and no tenant check; `api/src/automation/run-events.ts:31-41` pushes the URL onto SSE.

**Fix:** replace the static mount with an authenticated route (`GET /api/v1/automations/runs/:runId/steps/:stepId/screenshot`) that resolves the run, checks org + owner, then streams the file. Add a retention sweeper (default 7 days, configurable) and a delete-on-run-delete path. Rewrite `docs/decisions.md:20` (the recorded "unguessable path IS the capability" decision) with a superseding entry.

**Cannot wait because:** it is an unauthenticated read of authenticated-session page content, and it is also a live GDPR erasure gap over an unindexed PNG tree.

### R-4 - Verifier-extracted page values logged in cleartext and merged into `inputs` (I2 + I1, high, LIVE)

`api/src/automation/engine.ts:1616-1624`, with the literal `console.log(\`[automation] verifier extracted ${k}="${v}" …\`)` at `:1621`. The value then joins the shared mutable `inputs` map (`:1192`, `:1212`) and is template-substituted into downstream `api_call` URLs/headers/bodies whose **resolved** form is persisted.

**Fix:** three parts. (a) Drop the value from the log - log the key name and `value.length` only. (b) Register every extracted value in a run-scoped secret registry (see R-6) so the existing api-call masker covers it. (c) Refuse extraction into a key matching a secret-shaped name pattern (`otp`, `token`, `code`, `password`, `senha`, `sessao`, `cookie`) unless the step declares it explicitly.

### R-5 - Action cache writes page values into org memory, re-injected into chat (I3 + I1, high, LIVE)

`api/src/automation/cache.ts:140` persists the resolved `PlaywrightAction` through the public `createMemory`/`updateMemory` surface at tier `'active'`; `summariseAction` puts 40 chars of a `fill` value (`:257`), the **full** navigate URL (`:260`) and the **full** select value (`:264`) into the term-scored `content`. `api/src/memory/resolver.ts:90-92, 135-145` excludes only `tier==='archive'` from injection, and `api/src/agents/context.ts:156-159` injects into the general chat agent under `# Memória`.

**Fix:** introduce a `nonMemorable: true` flag on the memory row and make `isInjectable` require `!nonMemorable`. Mark every automation-cache row non-memorable. Independently, stop writing values into `content` at all - `summariseAction` should emit selector/role/shape only, and the navigate URL should be origin + pathname with the query string stripped. Backfill: a one-shot migration that rewrites existing cache-origin `content` fields.

**Cannot wait because:** magic-link and SSO-callback URLs are memorised verbatim today and replayed to the chat model on term overlap, and the typist (WS-F) inherits this exact path the moment it exists.

### R-6 - No shared run-scoped secret registry; masker leaks by construction (I2, high, LIVE)

`api/src/integrations/http-template.ts:71-78, 110-131` and `api/src/automation/executors/api-call.ts:238-263` are two divergent private copies. `maskValue` emits a leading token up to 12 chars **plus the last four characters** of every secret; `collectSecretValues` silently skips anything shorter than 4 chars; matching is literal substring over raw + URL-encoded forms only.

**Fix:** extract one `api/src/security/redaction.ts` module: a run-scoped `SecretRegistry` (register value → opaque handle) and `redact(stream|string|object)`. Mask output is a fixed `[REDACTED:<handle>]` with **no** plaintext fragment and **no** length floor. Matching covers raw, URL-encoded, base64, JSON-escaped and case-folded forms. Both existing copies become thin callers. Wire the registry into `api/src/automation/run-events.ts:30-43` so SSE `output` and `error.details` pass through it - its header comment currently claims "already redacted at the executor", true only for api_call.

This module is the spine WS-H extends; landing it now converts several later "close-gaps" items into wiring.

### R-7 - Missing regression tests on the boundaries the plan leans on

`scrubCredentials`, the `template-vars` `{{input.credentials…}}` refusal (`api/src/automation/template-vars.ts:44-55`), and `redactSecretsDeep` have no named test. Per the repo's own verdict rules an untested seam does not count as a control.

**Fix:** add `api/tests/security/credential-boundaries.test.ts` asserting each refusal, registered in `SUITE_LEDGER.json`. Do this **before** any workstream cites those boundaries as prevention.

### R-8 - Bridge plaintext credentials + JWT monoculture (I4 + I2, high, LIVE in any real deployment)

`ekoa-bridge/src/auth/credentials.ts:36-47, 86-91` writes access + refresh tokens and `signingSecret` to plaintext `config.json`; `api/src/bridge/signing.ts:24` keys the DelegatedTask HMAC with `loadConfig().jwtSecret`, so a working deployment puts the platform-wide session-signing key on every paired laptop.

**Fix now (small, unblocks the whole bridge workstream):** split the key. Mint a **per-pairing** signing secret at pairing time, stored server-side on `PairingRow`, delivered once over the pairing flow, and use it in `signing.ts`. This kills the monoculture and simultaneously resolves the open question "how does `signingSecret` reach a production bridge" - which today has no answer, and nothing writes it. OS-keychain storage on the bridge is WS-J work; the key split is not.

### R-9 - `revokePairing` has no production caller (bridge kill switch unreachable)

`api/src/bridge/registry.ts:203`, re-exported at `api/src/bridge/index.ts:35`, called only from `api/tests/*`. `ekoa-bridge/src/cli/commands/unpair.ts:4-6` is local-only.

**Fix:** mount `DELETE /api/v1/bridge/pairings/:pairingId` (owner or org-admin), call `revokePairing`, close the live socket, and emit a registo row. Add the button to the existing `/settings/privacy` surface. Small, and every later bridge capability grant assumes a working revoke.

---

## 3. Workstreams

Deliberate structure: **WS-A/B** are contract, **WS-C..E** are product surfaces against stubbed seams, **WS-F..K** are the contiguous deep-security block the brief mandates at the end. WS-0 (§2) runs outside all of it.

Every PR below carries the repo's standing obligations: a contract test in the same PR for any new endpoint, an error-envelope assertion for every new non-2xx, a `SUITE_LEDGER.json` band registration for any new e2e spec (the census goes red otherwise), and a `docs/diagrams/` update in the same unit of work where marked.

---

### WS-A - The contract: `shared/` extension + derived OpenAPI

**What exists.** `shared/src/` is a zod contract with one `DomainDescriptorMap` per domain, aggregated at `shared/src/index.ts:80` (`ALL_ENDPOINTS`) and flattened at `:112` (`allEndpointsFlat()`). `EndpointDescriptor` (`shared/src/descriptor.ts:23-34`) carries `{method, path, auth, request, response, query, timeoutMs, language, kind}`, and `AuthClass` already includes a `'bridge'` tier. `docs/api-contract.md` documents the schema-coverage gate: every descriptor is COVERED or PENDING on a hand-maintained allowlist.

**What is missing.** No OpenAPI artifact anywhere in either tree (verified: zero hits for `openapi|swagger` across ts/md/json outside node_modules). No Cofre vocabulary. `shared/src/automations.ts:22-31` `PlanStep` is `{stepId?, index?, description?, tool?, argv?}` with `.passthrough()` - the zod boundary validates nothing about step content, so any capability/target/credential-reference field must land there.

**Reconciling the brief's OpenAPI requirement with `shared/`.** Do **not** hand-write a parallel spec - that creates two sources of truth and the repo already has a drift gate for one. The OpenAPI document is a **derived build artifact**: a generator walks `allEndpointsFlat()`, runs `zod-to-json-schema` over each `request`/`response`/`query`, maps `AuthClass` onto `securitySchemes`, and emits `shared/dist/openapi.json`. The Apify actor and any host UI build against the emitted JSON; ekoa-code itself keeps building against zod. A CI gate regenerates and diffs against the committed artifact, failing on drift - the same shape as the existing schema-coverage gate.

**v1 scope.** Cofre item + grant + relay + capability + credential-reference vocabulary in `shared/`; the step-declaration fields; the OpenAPI generator and its gate. No implementation behind any of it.

**PRs.**

- **A-1 `contract(shared): Cofre vocabulary - item types, states, credential reference format`.** New `shared/src/cofre.ts`: `CofreItemType` enum (`password | api_key | oauth_token | totp_seed | session | software_certificate | certificate_identity`), `CofreItemState` (`locked | unlocked | unlocked_until_locked | in_use`), `CredentialRef` (an opaque `cofre:<itemId>` string format with a zod regex - never a value), `BoundOrigin` (registered origin list + eTLD+1), `CofreItem` view schema with `lastUsedAt`, `unlockedUntil`, `heldByRunId`. Exported from `shared/src/index.ts`. *Test:* `shared/src/contract.test.ts` additions asserting `CredentialRef` rejects anything value-shaped and `CofreItem` never carries a value field. *Diagram:* `05-data-model.excalidraw` - add the Cofre entities.
- **A-2 `contract(shared): grant model + scope vocabulary + unlock durations`.** `Grant = {credentialId, scope, issuedByUserId, issuedAt, expiresAt?}`; `GrantScope = this_run | ttl | until_locked`; the six named TTL durations plus `until_locked` as a closed enum so the UI and the API cannot drift. Signature identities carry a `noTtl: true` marker the schema enforces (a grant on a `certificate_identity` with `scope !== 'this_run'` fails validation - I7 encoded in the contract, not in prose). *Test:* contract test asserting the signature carve-out rejects a TTL grant.
- **A-3 `contract(shared): relay operation typing (login | signature)`.** `RelayPrompt` as a **discriminated union** on `operation`, not a flag: `{operation:'login', automationName, siteOrigin, reason}` and `{operation:'signature', documentName, documentPreviewUrl?, documentHash}` - the signature variant makes document identity structurally required, so a login-typed relay cannot type-check into a signature completion (I8 at the protocol level). Relay completion endpoint accepts a one-time code plus the operation type and refuses on mismatch. *Test:* contract test proving a login-typed prompt cannot satisfy the signature completion schema.
- **A-4 `contract(shared): capability names + bridge protocol v2 frame families`.** Extend `shared/src/ekoa-local.ts:218-232` from the frozen nine-member union to a v2 union adding `register`/`hello`, `tool.invoke`/`tool.result`, `secret.deliver`, `attended.request`, `session.push`, each versioned. Capability vocabulary as a closed enum: `local.filesystem`, `local.bash`, `attended.card_login`, `egress.residential`. Keep `provider_request`/`provider_response` - it is the mechanism keeping the egress chokepoint intact for bridge traffic and has no replacement. *Test:* a frame-union exhaustiveness test on both sides; the ekoa-bridge counterpart lands in the same PR pair (see `docs/bridge-counterpart-changes.md`). *Diagram:* `11-delegation-security.excalidraw`.
- **A-5 `contract(shared): step declarations - capability, target, attended flag, credential refs`.** Replace `PlanStep`'s `.passthrough()` with a discriminated union over the nine confirmed step types (`api/src/automation/types.ts:159-168`) and add `requiredCapabilities`, `target` (`pinned:<pairingId>` | `any:<capability>` | `cloud`), `attended: boolean`, `credentialRefs: CredentialRef[]`, `offlinePolicy` (`fail | queue | datacenter`) with **`fail` as the schema default**. *Test:* contract test that a step carrying a raw secret-shaped string in `credentialRefs` fails validation. *Diagram:* `04-agent-job.excalidraw`.
- **A-6 `contract(shared): Cofre registo event vocabulary + RegistoEntry tightening`.** The eleven events as a closed `actionType` enum extension. Tighten `RegistoEntry` (`shared/src/registo.ts:15-23`) - the `.passthrough()` means a Cofre event carrying a *value* validates today **[re-verified]**. Replace with an explicit metadata schema for the Cofre category that permits ids, counts, origins and timestamps only. *Test:* contract test rejecting a Cofre registo row with a string field longer than N or matching a value-shaped pattern.
- **A-7 `build(shared): OpenAPI generator + CI drift gate`.** `scripts/gen-openapi.mjs` walking `allEndpointsFlat()`; commit `shared/openapi.json`; `npm run gate:openapi` regenerates and diffs. Document the derivation rule in `docs/api-contract.md` so nobody hand-edits it. *Test:* the gate itself, plus a unit test that every `AuthClass` maps to a declared `securityScheme` (a new class must fail loudly).
- **A-8 `docs(decisions): supersede the Secret Manager posture; record KMS-per-environment`.** `docs/security.md:283` currently commits to "Secret Manager in prod", and `deploy/validate-topology.sh:34,44` is a CI gate enforcing that posture. The Cofre decision contradicts a written doc; this PR appends the superseding decision and adjusts the gate. Cheap, but it is a governance blocker on WS-K.

---

### WS-B - Cofre domain module + policy-lock seam (stubbed crypto)

**What exists.** One AES-256-GCM module keyed by `sha256(ENCRYPTION_KEY)` **[re-verified: `api/src/data/crypto.ts:19-25`, header calls KMS "P-14, deferred" at `:5-6`]**. `key(scope?)` is the single function every decrypt routes through - the correct install site for both the envelope and the lock. Access control is a pure ACL (`api/src/integrations/service.ts:63-70`). The nearest structural precedent for the grant ceremony is `api/src/automation/consent.ts:23-46` - a persisted, per-owner, default-deny allowlist with a real human approval flow and a revoke, surfaced through `routes/automations.ts`.

**What is missing.** Item model, grant model, lock seam, per-tenant DEK, zeroization (grep for `.fill(0)|zeroize|memzero` is empty across both trees).

**v1 scope.** A new top-level `api/src/cofre/` module owning the item store, the grant store, and **one** function `unwrap(itemId, actor, runContext)` that every credential read in the codebase must go through. In this workstream `unwrap` calls the *existing* `decrypt()` - the KMS envelope swaps in behind it in WS-K without touching a single call site. This is the "stubbed seam" pattern the brief asks for, and it is the same shape as `can()` (`api/src/auth/capabilities.ts:32-40`): a pure, fail-closed decision function with tenancy checked separately and composed.

**Module placement (resolves an open question).** `api/src/automation/` may not import `api/src/integrations/`, and the eslint zone list in `.eslintrc.cjs` enumerates every module by name **[re-verified]**. So `cofre/` must be a **new top-level module** added to that zone array, importing `data/` and `auth/`, imported by `integrations/`, `automation/` (via an injected seam, mirroring `setIntegrationCredentialLoader` at `api/src/automation/seams.ts:137-153`), `bridge/` and `routes/`. It must **not** live under `data/` - a policy decision does not belong in the storage tier.

**PRs.**

- **B-1 `feat(cofre): item store + repository behind the scoped chokepoint`.** `api/src/cofre/store.ts` using `OrgScoped`/`OwnerVisibilityScoped` from `api/src/data/scoped.ts:15-42` - the Cofre must be the **third** module to use the scoped repository, and unlike the ~52 hand-written filter sites it must be reachable *only* through it. Add an eslint rule forbidding any import of the raw `cofre_items` store handle outside `api/src/cofre/`, and forbidding re-derivation of the scoping predicate (`api/src/apps/app-paths.ts:84-112` is the precedent for that drift). Ciphertext column keeps the existing `base64(iv).base64(tag).base64(ct)` wire format so WS-K can version it. *Test:* `api/tests/security/cofre-cross-org.test.ts` in the named security suite class. *Diagram:* `12-org-tenancy.excalidraw`, `05-data-model.excalidraw`.
- **B-2 `feat(cofre): grant store + policy-lock seam (unwrap)`.** `unwrap()` refuses when no active grant covers `(itemId, actor)`; scopes per A-2; a `this_run` grant is consumed by run id. The seam is one function so the passkey-PRF key-share can later become an additional precondition without touching callers. **No usage-count locking.** *Test:* `api/tests/security/cofre-policy-lock.test.ts` - default deny, expired TTL denies, `this_run` grant does not survive the run, signature identity refuses a TTL grant.
- **B-3 `feat(cofre): item CRUD + lock-now + lock-all routes`.** `GET/POST/PUT/DELETE /api/v1/cofre/items`, `POST /api/v1/cofre/items/:id/lock`, `POST /api/v1/cofre/lock-all`, `POST /api/v1/cofre/items/:id/grants`. Every route writes a registo row through `logActivity` (`api/src/data/activity.ts:21-42`) via the generic `audit()` passthrough (`api/src/services/platform-crud.ts:17-20`) - **[re-verified]** this needs no new plumbing. *Test:* contract tests for all six; error-envelope assertions on 403/404/422.
- **B-4 `feat(cofre): migrate integration credentials onto the item model`.** The opaque `credentialsCiphertext` blob per integration-config row (`api/src/integrations/service.ts:80,113`) becomes N typed items with bound origins derived from `httpConfig` (`api/src/integrations/definitions.ts:380-386`). `decryptCredentialFields` (`api/src/integrations/action-executor.ts:271-282`) is rewritten to call `unwrap()` - this is where the unconditional decrypt dies. *Test:* a migration replay test under `api/tests/migration/`; plus a test that a credential read with no grant now fails. *Diagram:* `10-privacy-boundaries.excalidraw`.
- **B-5 `feat(cofre): registo Cofre events wired to the eleven-event vocabulary`.** All eleven from A-6, emitted from the real call sites. Note the automation engine writes **zero** activity rows today (grep for `recordActivity|registo|logActivity` over `api/src/automation/**` is empty) - this PR is where automation joins the audit plane. *Test:* an event-vocabulary test asserting each of the eleven fires on its trigger and carries no value.

---

### WS-C - Origin binding (I6) as a first-class control

**What exists.** `guardedFetch` (`api/src/services/url-fetcher.ts:71-87`) **[re-verified]** - SSRF only. R-2 adds an `allowedOrigins` parameter as remediation. `injectSessionState` (`api/src/automation/local-browser-session.ts:133-145`) calls `addCookies` with whatever domains the payload carries.

**What is missing.** Origin binding as a property *of the credential item*, enforced at three points: HTTP request, browser fill, cookie injection.

**v1 scope.** `boundOrigins` on every Cofre item; `unwrap()` takes a `usageContext: {kind:'http'|'browser'|'process', origin?}` and **refuses** when the origin does not eTLD+1-match. The refusal is the primitive's behaviour, not a caller's responsibility.

**PRs.**

- **C-1 `feat(cofre): origin binding enforced inside unwrap()`.** `unwrap` requires a `usageContext`; a mismatched or absent origin for an `http`/`browser` item throws `CREDENTIAL_ORIGIN_REFUSED`. *Test:* `api/tests/security/cofre-origin-binding.test.ts`.
- **C-2 `fix(automation): api_call credential use goes through the origin-bound unwrap`.** Replaces R-2's interim allowlist with the item's own `boundOrigins`. *Test:* fixer-authored-URL exfiltration scenario asserted refused.
- **C-3 `fix(automation): session cookie injection is origin-checked`.** `injectSessionState` refuses cookies whose domain is outside the session item's bound origins. *Test:* injection with an off-origin cookie refuses and emits a registo row.

---

### WS-D - Cofre product surfaces against the stubbed seam

**What exists.** No Cofre nav entry (`web/lib/navigation.ts:49-90` **[re-verified]**); zero `cofre|desbloquear|bloquear` hits repo-wide outside unrelated strings. A shipped attended-takeover surface **does** exist: `web/components/automations/pause-for-user-overlay.tsx:12-21` mounts a full-screen modal at the dashboard layout on any paused run, rendering a live interactive remote-browser canvas (`pause-for-user-canvas.tsx:1-18`) fed by the `streaming_available` event (`shared/src/events.ts:156-161`) and served by `api/src/streaming/`. The relay is a **typing + ceremony layer over this**, not greenfield.

**What is missing.** Everything user-visible.

**v1 scope.** Cofre list + item detail, the three states with a live countdown, "Em utilização" live indicator, per-item and global lock, the unlock page with the seven durations (and no TTL UI for signature identities), the relay page with its two protocol types, Registo Cofre views, bridge registry views. All against WS-B's seam - which is real, just not KMS-backed yet.

**PRs.**

- **D-1 `feat(web/cofre): left-menu item + item list with type taxonomy`.** New `NAV_ITEMS` entry. Item type icons as SVG (no emoji, per the standing rule). *Test:* `web/e2e/cofre-list.spec.ts` with real-UI login, zero console errors, registered in `SUITE_LEDGER.json` band1. *Diagram:* `13-os-mode-shell.excalidraw` if it carries the nav census; otherwise none.
- **D-2 `feat(web/cofre): item states - Bloqueada / Desbloqueada (countdown) / Desbloqueada até bloquear (amber) / Em utilização`.** The countdown ticks client-side off `unlockedUntil`; "Em utilização" is driven live by `heldByRunId`. Last-used timestamp per item. *Test:* `web/__tests__/components/cofre-state.test.tsx` for the state machine + an e2e for the amber distinction.
- **D-3 `feat(web/cofre): lock-now per item + Bloquear tudo`.** *Test:* e2e asserting a lock during a live hold surfaces the run's failure honestly rather than silently.
- **D-4 `feat(web/cofre): unlock page with the seven durations`.** Adopt `automation/consent.ts`'s store/route/UI pattern rather than inventing a third approval surface. Signature identities render **no TTL control at all** - enforced by A-2's schema, so the UI cannot regress it alone. *Test:* e2e per duration; a test asserting the signature-identity page has no duration control in the DOM.
- **D-5 `feat(web/relay): one relay surface, two protocol types`.** Login variant explains automation + site + why and accepts a one-time code (used once, never stored). Signature variant **cannot render** without document name + preview-or-hash - make the component's props the A-3 discriminated union so this is a type error, not a runtime check. Mounts alongside the existing pause-for-user overlay. *Test:* `web/e2e/relay-login.spec.ts` and `relay-signature.spec.ts`; plus a contract test that a login-typed relay POSTing a signature completion gets 422.
- **D-6 `feat(web/registo): Cofre event views`.** Filters by the eleven event types, per-item history. No alerting subsystem (explicitly out of v1 scope). *Test:* e2e + contract test on the filtered query.
- **D-7 `feat(web/settings): bridge registry view - machines, capabilities, grants, health, revoke`.** Consumes WS-J's registry. Includes the R-9 revoke button. Ships initially against a stubbed capability list. *Test:* e2e; console-error assertion.
- **D-8 `feat(web/automations): per-host automation UI against the contract`.** Step target/capability/attended declarations surfaced read-only in the run view. *Test:* e2e.

---

### WS-E - Router + step declarations against stubs

**What exists.** A rudimentary router that is **wired in production**: `setDelegateToLocal` at `api/src/server.ts:329`, reachable as an agent tool (`api/src/agents/sdk-tools.ts:133`), minting a task pinned to a resolved pairing with org, pairingId, `grantRefs` (references, never values), a finite signed `egressBytes` budget, an expiry and a nonce, all under HMAC (`api/src/bridge/signing.ts:1-30`). Three of the target's four declaration fields already exist in that shape. Do **not** discard it.

**What is missing.** Capability declaration and matching; caller-chosen target; attended flag; egress attribute; and org is **adopted** from the resolved connection rather than checked (`api/src/bridge/delegation.ts:114` calls `getConn(actor.userId)` with no `expectedOrg`, though `getConnectionByOwner` accepts one).

**PRs.**

- **E-1 `fix(bridge): check org at delegation dispatch instead of adopting it`.** Add `orgId` to `DelegationActor`; pass `expectedOrg` to `getConn`. Small, high-value, and a prerequisite for any capability grant being meaningful. *Test:* `api/tests/security/bridge-cross-org.test.ts`.
- **E-2 `feat(automation): step declarations - capability, target, attended, credential refs, offline policy`.** Implements A-5 in `api/src/automation/types.ts`. Offline policy defaults to `fail`. *Test:* engine tests per policy; a test that an undeclared step refuses rather than falling back.
- **E-3 `feat(automation): per-run egress policy replaces the global localBrowserEnabled flag`.** `api/src/automation/config.ts:38-41` defaults to `!isProd`, so production halts honestly in `awaiting_daemon` - the defect is that the flag is global and undeclarable, not that production silently leaks. The halt (`api/src/automation/engine.ts:542-563`) is the right hook. New policy **defaults to refuse**. *Test:* a run declaring `datacenter` proceeds; a run declaring nothing refuses.
- **E-4 `feat(bridge): capability matching in the router`.** `delegateToLocal` selects on `(capability, target, org)` instead of "newest live socket for this owner". *Test:* selection tests incl. no-matching-capability → declared offline policy.

---

### WS-F - Typist primitive (the trusted login capability)

**What exists.** `api/src/streaming/cdp.ts:76, 96-103` already implements `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` against a Playwright `CDPSession` wired to a live page with a run-state gate. That **is** the out-of-band input mechanism. The engine currently **blocks** credentials from reaching any browser fill (`api/src/automation/template-vars.ts:44-55` redacts `{{input.credentials…}}`, and `inputs` is never passed to the vision resolver), so there is no credential-to-browser path at all today - greenfield with no live traffic to migrate.

**What is missing.** Origin binding at fill time, fill-and-submit atomicity, no-read-back, per-site recipes, fail-to-relay.

**Blocked by:** the `api/src/streaming/` security audit (see §6) - the typist and the relay both sit on that surface and neither should be designed before it is understood.

**PRs.**

- **F-1 `audit(streaming): security pass over the CDP screencast + input plane`.** Not a code PR - a written finding set in `docs/findings.md` covering: does a frame carrying a visible password reach the client and any log; is the input channel authenticated per-frame; is there a suppression hook. **Blocks F-2 and D-5.**
- **F-2 `feat(automation): login(credential_ref) as the sole browser credential capability`.** One executor step type. Sequence: verify current page origin against the item's `boundOrigins` → fetch the value via `unwrap({kind:'browser', origin})` → dispatch via CDP out-of-band input → submit → wait for navigation → return only when no password field remains in the DOM. Fill+submit is one unit so read-back is impossible by construction. Value never enters a script, tool call or agent-visible stream. *Test:* `api/tests/security/typist-no-readback.test.ts` - asserts the value appears in no tool result, no SSE frame, no persisted record, no screenshot taken during the window (see H-3). *Diagram:* `10-privacy-boundaries.excalidraw`, `04-agent-job.excalidraw`.
- **F-3 `feat(automation): one generic multi-step login pattern + per-site recipe registry`.** Recipes are fixed data under `api/assets/`, never model-authored. *Test:* recipe-schema test refusing any recipe field that could carry executable content.
- **F-4 `feat(automation): unknown pattern fails to relay or attended mode`.** Explicitly **never** to LLM improvisation. The classifier at `api/src/automation/vision.ts:301-317` currently collapses `captcha|mfa|payment|identity|login` into one paused state - WS-F must split `login` from `signature`-adjacent states so I8 holds downstream. *Test:* an unknown-pattern run pauses to relay and the fixer LLM is never invoked on it.
- **F-5 `fix(automation): the typist's actions are non-memorable`.** Depends on R-5's flag. *Test:* a typist login writes zero memory rows.

---

### WS-G - Session-first storage

**What exists.** Consumption only: `extractSessionCookies` (a correct lenient parser for both storageState shapes, `api/src/automation/local-browser-session.ts:57-74`) and `injectSessionState` (`:133-147`), with careful failure logging (counts only, message-free). Capture is explicitly unbuilt - `api/src/routes/integrations.ts:99-123` answers `available:false`/`started:false`, and both persistence paths `delete merged.storageState`. Meanwhile `api/assets/integrations/citius/config.json:7` ships `authType: 'browser_session'` and a `credentialGuide` at `:16` promising the user that Ekoa captures and stores the session encrypted - a shipped integration advertising a capability that does not exist.

**v1 scope.** Session blobs as Cofre items of type `session`, subject to I1-I4 exactly as passwords. Per-tenant, per-site, encrypted, with metadata: establishing machine, bound egress, UA/fingerprint profile, health/expiry.

**PRs.**

- **G-1 `feat(cofre): session item type with per-site scoping and metadata`.** *Test:* contract + store tests; cross-org isolation test.
- **G-2 `feat(automation): session capture writes a Cofre session item`.** Replaces the `available:false` stub and makes the CITIUS asset's promise true. *Test:* capture → item exists → item carries origin, machine, egress, expiry.
- **G-3 `fix(automation): per-run BrowserContext lifecycle + per-owner isolation`.** `dispose()` closes only the page (`local-browser-session.ts:149-154`), so every run's context and cookie jar survive for the process lifetime; the composition root's provider **ignores** `ownerUserId` and returns a fresh anonymous context from a process-wide browser (`api/src/server.ts:461-464`), contradicting the module's own docblock. Close the context; honour the owner; clone session state per context for parallel runs. *Test:* a leak test asserting zero live contexts after run completion. **This also corrects a documentation-vs-composition-root divergence that has already misled multiple audits - the docblock must be fixed in the same PR.**
- **G-4 `feat(automation): session expiry detection + auto re-establishment + re-auth prompt`.** Health tracked on the item; expiry triggers either auto re-establishment (typist, WS-F) or the relay prompt (WS-D). *Test:* forced-expiry test.
- **G-5 `feat(automation): egress-matched session checkout`.** At checkout the router selects egress matching the session's binding (WS-I). *Test:* a session bound to residential egress refuses checkout when only datacenter egress is available, per the run's declared offline policy.
- **G-6 `fix(repo): stop persisting a live storageState in the working tree`.** `.walkthrough/auth.json` (`.gitignore:48`, `.walkthrough/notes.md:19,46`) and `playwright.config.ts:21-24` (`trace:'on-first-retry'` over a logged-in estate). Encrypt or ephemeralise the walkthrough state; scrub or disable traces for authenticated specs. Low severity, but it is a session blob on disk in the repo and the plan cannot claim I2 while it exists.

---

### WS-H - The redaction pipeline

**What exists after R-6.** One shared `SecretRegistry` + `redact()`. What exists today beyond that: `api/src/llm/client.ts:967-968` anonymises prompt and system **[re-verified]**; `:981` forwards `images: opts.images` verbatim **[re-verified]**, pinned by `api/tests/llm/client.test.ts:235-256`. No video/HAR/tracing exists anywhere in `api/src` - a control advantage, since there is nothing to retrofit.

**v1 scope.** The executor knows live values and filters every byte stream flowing toward the model or any log, at Cortex ingress for bridge output. Capture suppressed during the login window. Pixel plane covered.

**PRs.**

- **H-1 `feat(security): value-keyed filter on every model-bound and log-bound stream`.** Extends R-6 to `local_command` stdout/stderr (`api/src/automation/executors/local-command.ts:154-157, 234`), `ekoa_action` results, assertion-failure messages (`api/src/automation/executor.ts:287-299` - the live in-process DOM-text path that reaches the fixer prompt at `api/src/automation/rehearsal.ts:142-159`, SSE, and the persisted record), and `extractActionRunOutput` (`api/src/automation/service.ts:637-653`). *Test:* a table-driven test registering a secret then asserting it appears in none of: fixer prompt, SSE frame, persisted step record, process log.
- **H-2 `feat(llm): the anonymisation chokepoint covers the pixel plane`.** The image half currently bypasses `anonymize()` by construction and a **test pins the bypass**. Playwright 1.61.1 supports `screenshot({mask: Locator[], maskColor})` and `LocalBrowserSession.capture` is the single chokepoint. Mask password/OTP/credential-bearing locators browser-side (the mask list must be computed browser-side from locators, so it becomes part of the daemon's browser-capability contract too, not a Cortex-side transform). Update `api/tests/llm/client.test.ts:235-256` - it currently asserts the wrong contract. Update `docs/security.md:77`, which scopes the pipeline to "all model-bound text" and is therefore false-by-omission. *Test:* a rendered-credential screenshot reaches the model masked. *Diagram:* `06-llm-chokepoint-billing.excalidraw`, `10-privacy-boundaries.excalidraw`.
- **H-3 `feat(automation): login-window capture suppression`.** `capture()` runs unconditionally after every act including the credential fill (`api/src/automation/engine.ts:1689-1703`). Suppress screenshotting, console capture and run-event payloads for the duration of a typist window. *Test:* zero PNGs written during a typist step.
- **H-4 `feat(bridge): redaction at Cortex ingress`.** Bridge frames are parsed and dispatched raw (`api/src/bridge/server.ts:209-260`). Cortex knows the live values for a delegated run, so the filter belongs here - the bridge itself must never log payloads. *Test:* a delivered secret echoed by a bash step is redacted at ingress before persistence or SSE.
- **H-5 `fix(bridge): stop fsyncing full command lines and navigation targets to bridge disk`.** `ekoa-bridge/src/ledger/ledger.ts:72-89` records `detail` as "the full bash command line, or the browser navigation target - recorded in full", appended and fsynced on both the allowed and denied paths. Replace with a hash + a redacted shape; keep the ledger's excellent durability properties (append-only JSONL, open→write→fsync→close plus a directory fsync, corrupt-line recovery). *Test:* bridge-side ledger test asserting no raw value in `detail`; a companion assertion in the Cortex fake-daemon suite.
- **H-6 `fix(automation): planner stops echoing offending token prefixes`.** `api/src/automation/planner.ts:236-256` echoes the first 50 chars of an offending token into the log, the retry prompt **and** the client payload. *Test:* the anti-leak structural check emits a category, never content.
- **H-7 `fix(bridge): sensitive-file denylist in the containment resolver`.** `ekoa-bridge/src/containment/resolver.ts:22-45` enforces only that the realpath stays inside a granted root, so a granted directory containing `.env` / `.ssh` / credentials ships its bytes to the LLM via `compose()` (`ekoa-bridge/src/engine/engine.ts:184-205`, comment: "The excerpts cross Boundary 1 here"). Same denylist as R-1. *Test:* granting a dir containing `.env` and requesting it returns a refusal, ledgered.
- **H-8 `fix(bridge): constrain Tier-2 browse output`.** `ekoa-bridge/src/tools/tier2/browser.ts:27, 47-56` returns up to 100 KB of raw `document.body.innerText`. Unreachable from the wire today (ADR-002-gated, zero callers), but it is the shape any future "a11y text instead of pixels" plan must constrain rather than treat as greenfield. Either retire it explicitly or bound + filter it. **Requires the keep-or-retire decision in §6.**

---

### WS-I - Egress selection and the data plane

**What exists.** Nothing. `api/src` has exactly one `chromium.launch` - `chromium.launch({headless:true})` at `api/src/services/browser-pool.ts:32`, no proxy, no args, no env. Zero hits for `tailscale|tailnet|residential|exit.?node` across both repos. All automation traffic leaves from the datacenter IP of the API container.

**v1 scope.** Bridge advertises a tailnet address in the `hello` frame; the registry stores it as a capability; the cloud browser proxies through the machine selected per run; egress **never** tunnels through the control websocket.

**PRs.**

- **I-1 `feat(bridge): hello frame advertises machine identity, capabilities, egress endpoint, version, health`.** Depends on A-4. *Test:* frame contract test both sides. *Diagram:* `11-delegation-security.excalidraw`.
- **I-2 `feat(bridge): registry stores capability list + egress endpoint; org-scoped listing`.** `PairingRow` and `LiveConnection` gain `capabilities[]` and `egress`. Add an org-scoped listing so an org-admin can enumerate and audit the org's paired machines - today the only listing is `getPairingsByOwner` behind an owner-scoped route, and there is no cap on pairings. *Test:* registry tests; cross-org listing refusal.
- **I-3 `feat(bridge): per-tenant-per-machine capability grants, allowlist, default deny`.** Lift the shape of `ekoa-bridge/src/auth/grants-store.ts:15-23` - `{grantRef, root, session, createdAt, label?}`, defined by its own header as a session-scoped per-resource pre-authorisation, i.e. a working instance of two of the three target scopes. Also **fix grant issuance**: today `ekoa-bridge/src/surface/browser-grants.ts:41-70` accepts `POST /grants` from any local process with an arbitrary path and a caller-supplied session id, authenticated by nothing but loopback binding. *Test:* default-deny test; an unauthenticated local POST is refused.
- **I-4 `feat(automation): cloud browser proxies through the selected machine over Tailscale`.** The proxy option lands on the single `chromium.launch`. **Never** through the control socket. *Test:* an integration test asserting the launch carries the selected proxy and that no browser payload appears on the control socket. *Diagram:* `01-system-context.excalidraw`, `11-delegation-security.excalidraw`.
- **I-5 `feat(automation): per-run offline fallback (fail | queue | datacenter)`.** Implements E-2's declaration at the `awaiting_daemon` hook. *Test:* one per policy.
- **I-6 `feat(cofre): Apify tenant isolation - own budget, own queue, no personal-machine route`.** Zero Apify code exists in either tree, so this is a boundary declared before the tenant is created: an Apify-class org may hold **no** capability grants on any personal machine, ever, enforced in I-3's grant issuance. Reuse the billing allowance/rate-cap plane and the signed `DelegatedTask` budget (`{egressBytes, modelSpend}`) for the budget. *Test:* `api/tests/security/apify-isolation.test.ts` asserting grant issuance to an Apify-class org against a personal machine is refused.

---

### WS-J - Bridge transit, secret.deliver, and the I9 primitive

**What exists.** `api/src/bridge/signing.ts:1-30` - HMAC-SHA256 over a canonical, nonce- and expiry-bound task envelope with a constant-time verifier. That is the direct structural precedent for a one-time `secret.deliver` payload; build on it. `api/src/bridge/provider.ts:10-17` + `token.ts:1-16` is an existing credential→pairing→org resolution chain where org derives from the registry and is never a request body. `api/src/automation/seams.ts:22-63` defines a **complete** streamed-tool-invoke consumer contract (`DaemonConnection.runStep({capability, input, stepId, runId})` → `ResultEnvelope` with observation/screenshot/streamed chunks), fully written, exercised by tests, and never wired (`setDaemonConnectionResolver` called only from `api/tests/*`). Adopt this interface for `tool.invoke` rather than inventing a third.

**What is missing.** Every v2 family; the I9 primitive; RAM-only-then-zeroize discipline; replay protection.

**The I9 shape.** The only environment channel today is the **exact inverse** of the primitive: `LocalCommandSpec.envWhitelist` (`api/src/automation/types.ts:188-193`) is a name list the parser accepts from the planner, and `buildEnv` (`api/src/automation/executors/local-command.ts:253-261`) resolves each name against the **Cortex API server's own** `process.env` - which holds provider keys, `ENCRYPTION_KEY`, `JWT_SECRET` and DB creds - then ships the values to a user machine. It has no receiver (`ekoa-bridge/src/tools/tier2/bash.ts:17-19` hard-scrubs the child to seven names). Because `local_command` is unreachable end-to-end today, **the I9 primitive is greenfield with no live traffic to migrate** - but `envWhitelist` must be deleted, not extended.

**PRs.**

- **J-1 `feat(bridge): protocol v2 frames - register/hello, tool.invoke, tool.result`.** Adopt the `runStep` interface shape. Wire `setDaemonConnectionResolver` in `api/src/server.ts` so `local_command` and browser steps become reachable - **after** WS-F/H, never before. *Test:* the `api/tests/bridge/fake-daemon/` S1-S6 scenarios extended. *Diagram:* `11-delegation-security.excalidraw`.
- **J-2 `feat(bridge): replay protection + revocation on the connect path`.** Add `jti` to `mintBridgeToken` (`api/src/bridge/token.ts:44-52`), a nonce store, client binding, and a `tokenEpoch` check so "terminate all sessions" drops a live socket the way `api/src/auth/middleware.ts:33-49` does for platform tokens. Today `attachLiveConnection` (`api/src/bridge/registry.ts:105-113`) retires the incumbent on redial, so a captured 600 s token **evicts the real daemon and receives that pairing's delegate frames**. Remove the still-accepted `?token=` connect-URL form. Depends on R-8/R-9. *Test:* `api/tests/security/bridge-replay.test.ts`.
- **J-3 `feat(bridge): secret.deliver - one-time payload, RAM only, zeroized after use`.** Signed and nonce-bound per J-1's envelope. Never written to bridge disk, never ledgered as a value, zeroized on the bridge after the process exits. *Test:* bridge-side test asserting the value is absent from `config.json`, the ledger, and any log after use; plus a memory-hygiene assertion.
- **J-4 `feat(automation): the I9 environment-injection primitive`.** A fixed Cortex primitive: a step declares `credentialRefs` and an env **name mapping**; Cortex resolves refs via `unwrap({kind:'process'})`, delivers via `secret.deliver`, and the bridge injects into the child process environment at execution time. **Delete `envWhitelist`** and its planner parser acceptance (`api/src/automation/planner.ts:403`) in the same PR. Command strings, scripts and any model-authored step content may carry only the reference name. *Test:* `api/tests/security/i9-env-injection.test.ts` - a bash step consuming a ref succeeds, the value appears in no command string, no ledger row, no stdout after H-4's ingress filter, and no persisted record.
- **J-5 `feat(bridge): attended.request + session.push`.** `attended.request` asks a named bridge to open a browser on a declared origin and hold it (the card-gated portal start); `session.push` returns the storageState as a Cofre session item, encrypted in transit, never on bridge disk. The card never leaves the machine; **Cortex needs zero PKCS#11 code and zero `.pfx` handling** - this is one rail, not a general card stack. *Test:* fake-daemon attended scenario; assert no certificate material transits.
- **J-6 `feat(bridge): full invocation audit trail persisted Cortex-side`.** Today Cortex persists nothing - only `kind==='read'` rows leave the machine, landing in a 15-minute TTL Map (`api/src/bridge/activity-buffer.ts:1-15`, overridden into production at `api/src/server.ts:1015-1020`). Cofre bridge events must be durable registo rows in the same shape as cloud events. Include grant issuance/revocation, which is currently unaudited on **both** sides (the `LedgerRow` union has no grant kind). *Test:* every invocation family produces a registo row.
- **J-7 `fix(bridge): the write-approval flag stops being model-asserted`.** `api/src/agents/sdk-tools.ts:111-112` literally instructs the model to set `confirmed`, and `ekoa-bridge/src/tools/write.ts:105-110` requires it while its header claims "the user assents Cortex-side" - nothing Cortex-side checks it. Replace with a Cortex-issued signed approval token. Separately, tighten `api/src/automation/command-shape.ts:52-68`, where `normalizeArg` generalises every path-shaped argument to `<FILE>`/`<DIR>`, so approving `cat ~/notes.txt` permanently approves `cat ~/.ssh/id_rsa` with no machine binding, tenant scoping or TTL. *Test:* a forged `confirmed` is refused; an approved shape does not cover a different path.
- **J-8 `fix(bridge): store credentials in the OS keychain, not plaintext config.json`.** Completes R-8. *Test:* config.json contains no token material after pairing.

---

### WS-K - KMS envelope (the last swap)

**What exists.** `key()` (`api/src/data/crypto.ts:19-25`) is the one function every decrypt routes through, and the header names KMS envelope as the deferred plan **[re-verified]**. `encryptForScope` is key *separation*, not a per-tenant DEK, with exactly one caller; integration credentials use the **unscoped** key so ciphertext is not even org-bound.

**v1 scope.** Envelope encryption: per-tenant DEK wrapped by **one** Cloud KMS key per environment, KMS default rotation, no custom rotation machinery. Secret Manager ruled out as primary backend (requires A-8). Decrypt in RAM only; zeroize after the use window.

**PRs.**

- **K-1 `feat(data/crypto): versioned ciphertext envelope`.** Prefix the existing wire format with a version tag so v1 (`sha256(ENCRYPTION_KEY)`) and v2 (wrapped DEK) coexist. Byte-compat for migrated rows is why this must be first. *Test:* round-trip both versions.
- **K-2 `feat(cofre): per-tenant DEK wrapped by the environment KMS key`.** DEK generated per tenant, wrapped, ciphertext stored; unwrap happens inside `unwrap()` only. *Test:* a v2 item cannot be decrypted under another tenant's DEK.
- **K-3 `feat(cofre): RAM-only use window + zeroization`.** Buffers zeroed after use across `api/src/cofre/`, `api/src/integrations/`, `api/src/automation/executors/`, and the bridge's delivered payloads. Also **de-memoize** `api/src/llm/credentials.ts:200-215`, which caches the decrypted platform credential process-wide (`cached = cred`) - "RAM only during the use window" fails by design there, not by omission. *Test:* `api/tests/security/zeroization.test.ts` asserting the buffer is zeroed post-use and that the platform credential is not memoized.
- **K-4 `chore(data): migrate existing ciphertext to v2`.** Backfill job + a `gate:crypto-version` CI check that no v1 row remains after the cutover window.

---

## 4. Sequenced order

**Phase 0 - Remediation (immediate, outside the v1 build).**
1. **R-1**, **R-2**, **R-3**, **R-4**, **R-5** - all parallel, all independent (different files, different owners).
2. **R-6** blocks **R-4(b)** (the run-scoped registry is what makes extracted values maskable) and blocks **H-1** entirely.
3. **R-7** blocks any workstream PR that cites `scrubCredentials` or the template-vars refusal as an existing control - in practice it blocks **F-2**.
4. **R-8** blocks **J-2** and **J-3** (you cannot build one-time secret delivery on a key that sits in cleartext on the target machine). **R-9** blocks **I-3** (a capability grant with no revoke is not a grant).

**Phase 1 - Contract.**
5. **A-8** first (it is a governance blocker on WS-K and costs an afternoon).
6. **A-1 → A-2 → A-3** in order (grants reference items; relay references grants). **A-4**, **A-5**, **A-6** parallel to that chain. **A-7** last in the phase - it derives from all of them.
7. **A-1..A-6 block every WS-B..WS-K PR**, because the shared vocabulary is what the stubs are typed against. This is the brief's ordering and it is right.

**Phase 2 - Domain + surfaces against stubs.**
8. **B-1 → B-2 → B-3** in order. **B-4** depends on B-2. **B-5** depends on B-3 + A-6.
9. **C-1** depends on B-2. **C-2** depends on C-1 and supersedes R-2. **C-3** depends on C-1.
10. **F-1** (the streaming audit) runs here, in parallel, because it **blocks D-5 and F-2** and it is discovery work that needs no code.
11. **D-1..D-4, D-6, D-7, D-8** parallel once B-3 lands. **D-5 blocked by F-1 and A-3.**
12. **E-1** can land any time after Phase 0 (it is nearly a bug fix). **E-2 → E-3 → E-4** in order, after A-5.

**Phase 3 - Deep security block (contiguous, per the brief).**
13. **H-1** (needs R-6) and **H-6** first - they are the widest-reach filters and everything after them inherits coverage.
14. **F-2 → F-3 → F-4 → F-5** in order. **F-2 blocked by F-1, C-1, H-3.**
15. **H-2**, **H-3** parallel with WS-F. **H-3 blocks F-2** (do not build a typist that screenshots the password field).
16. **G-1 → G-2 → G-3 → G-4** in order. **G-3 can start immediately** - it is a leak fix, not new capability. **G-4 blocked by F-2** (auto re-establishment *is* the typist) **and D-5** (the re-auth prompt is the relay). **G-5 blocked by I-2.**
17. **I-1 → I-2 → I-3 → I-4** in order. **I-5** depends on E-3. **I-6** depends on I-3.
18. **J-1** blocked by A-4 and by the keep-or-retire decision on `DaemonBrowserSession` (§6). **J-2** blocked by R-8/R-9. **J-3** blocked by J-1+J-2. **J-4** blocked by J-3 + H-4. **J-5** blocked by J-1 + G-1. **J-6** blocked by J-1. **J-7**, **J-8** parallel.
19. **H-4** blocked by J-1 (there is no v2 ingress to filter until the frames exist). **H-5**, **H-7**, **H-8** parallel, bridge-side.
20. **K-1 → K-2 → K-3 → K-4** last. Nothing else depends on them **by construction** - that is the entire point of putting the lock and the envelope behind `unwrap()`/`key()`.

**Explicitly parallel tracks:** (a) web surfaces D-1..D-8 after B-3; (b) bridge J-* + I-* after A-4; (c) redaction H-* after R-6; (d) crypto K-* at the very end with a single integration point.

---

## 5. Proof gate wiring

**Portal choice.** Run the terminal gate against **Ordem dos Advogados webmail** (`webmail.oa.pt`), *conditional on re-probing D6's claim* that it is a Roundcube form login with no client-certificate request. Rationale: it is the only surveyed rail where a typist login is even possible, so it exercises unlock → typist → session → egress → expiry → lock in one journey without needing the card stack. Citius/eTribunal is the **second** gate, and only after the mTLS/session-transplant probe (§6) answers whether the bridge is a login helper or a full execution target. Do **not** budget the terminal gate against Citius until that probe returns.

| Terminal-gate assertion | Layer | Concrete test |
|---|---|---|
| Unlock (duration chosen, grant issued) | e2e (Playwright, real-UI login) | `web/e2e/cofre-proof-unlock.spec.ts` - unlock with "10 minutos", assert state `Desbloqueada` + countdown; registered in `SUITE_LEDGER.json` band1 |
| Typist login on the live portal | node e2e driver | `api/tests/e2e/cofre-typist.e2e.mjs` - drives a real run against OA webmail; asserts navigation completed and no password field remains |
| Value never reached the model | api security suite | `api/tests/security/typist-no-readback.test.ts` - payload-capture harness (the existing anonymisation harness pattern) asserting the value is absent from every captured model request incl. images |
| Session captured with metadata | contract + api | `api/tests/integrations/cofre-session.contract.test.ts` - item carries origin, establishing machine, bound egress, UA profile, expiry |
| Second run reuses the session through matching egress | node e2e driver | `api/tests/e2e/cofre-session-reuse.e2e.mjs` - run 2 performs no login; asserts the launch carried the machine-matched proxy |
| Forced expiry → auto re-establishment | api integration | `api/tests/automation/session-expiry.test.ts` - invalidate the item, assert typist re-runs or the relay prompt fires |
| Lock-now kills a live hold | e2e | `web/e2e/cofre-proof-lock.spec.ts` - lock during `Em utilização`; assert the run fails honestly and a `lock-now` registo row exists |
| Bash step consumes a vault reference through I9 | api security suite | `api/tests/security/i9-env-injection.test.ts` + a fake-daemon scenario; asserts the value is in the child env and in no command string |
| I9 output redaction | api security suite | same test - the child echoes the secret; assert it is redacted at Cortex ingress before persistence and SSE |
| One-time secret delivery is RAM-only on the bridge | bridge-side + fake-daemon | `ekoa-bridge` test asserting absence from `config.json`, ledger and logs post-use; Cortex-side fake-daemon asserting single-use nonce rejection on replay |
| Inspection pass over logs, traces, HAR, snapshots, memory | discovery + written finding | a scripted grep-and-eyeball sweep over the run's process log, `automation_runs` doc, SSE transcript, screenshot tree, `memories` collection and the bridge ledger, closed by a `docs/findings.md` entry per the five-layer rule (never silently) |

Two structural notes: there is **no** video/HAR/tracing in `api/src`, so the "traces and HAR" half of the inspection pass is an assertion that they remain absent, not a scrub - record that explicitly so a later addition re-opens the gate. And the pass must include the `memories` collection specifically, because R-5's fix is the only thing standing between the typist and organizational memory.

---

## 6. Unresolved - each with the action that closes it

| Item | Action that closes it | Who/what answers |
|---|---|---|
| `api/src/streaming/` + pause-for-user overlay as a security surface | **PR F-1**: a written security pass. A human types a password into a page whose CDP frames stream as JPEG over a socket, with no login-window suppression. No audit examined it. | Engineering, before D-5 and F-2 |
| I7 - signature authority has no representation | A **scoping decision**: is `certificate_identity` (pointer type) in v1, and how does it relate to the Zoho/Adobe Sign OAuth credentials currently in the same `credentialsCiphertext` bundle (`api/src/integrations/action-executor.ts:271-282`)? A-2 encodes the no-TTL rule either way; the pointer type's existence is the open part. | Product owner |
| Test coverage of the boundaries the plan leans on | **Partly closed this pass**: `api-call-redaction.test.ts` and `ekoa-action-credentials.test.ts` exist; `template-vars` redaction and `redactSecretsDeep` have **no** named test. **PR R-7** closes the rest. | Engineering |
| Cofre's place in the module tier table + diagram | **Resolved in this plan**: a new top-level `api/src/cofre/` added to the `.eslintrc.cjs` zone array **[re-verified: the zone `target` list enumerates every module by name]**. Still needs the `02-module-map.excalidraw` update, which is FIXED-12-mandatory in PR B-1. | Engineering, in B-1 |
| `ekoa-bridge/src/containment/resolver.ts` - no sensitive-file denylist | **PR H-7**. Same denylist as R-1; share the list across repos via the release artifact, not by copy-paste. | Engineering |
| `ekoa-bridge/src/session/egress.ts` EgressAccounting | Read it and decide whether the per-session byte cap becomes the anchor for the Cofre `this_run` scope. 30 minutes of reading; do it before I-6 (Apify budget). | Engineering |
| Does the Cortex chokepoint **persist** bridge-forwarded bodies? | Read `proxyGatewayMessages` and the anon-audit write path. Determines whether bridge file excerpts are an at-rest exposure (I2/I4) or transit-only - which changes H-7's severity and whether a purge is needed. | Engineering, before H-4 |
| `events/` inbound plane tenant filters | Sample `api/src/events/service.ts:68,101,144`. It is a **live** plane reaching integration credentials via `findConfigForOwner`, it has uncommitted changes in the working tree today, and it is the plane most likely to hold Cofre items first. | Engineering, before B-4 |
| Keep or retire `DaemonBrowserSession` / `setDaemonConnectionResolver`? | **Decision required - blocks J-1.** It is fully written, exercised by `consent.test.ts` / `service.test.ts` / `engine.test.ts` (so it is maintained, not abandoned), unwired in production, and its committed design sends browser screenshots + DOM over the control socket, which the target data-plane rule forbids. Keeping it means scoping the rule to raw egress only; retiring it means the cloud browser proxies through the machine (I-4) and the bridge needs no browser capability at all. | Architect |
| Firestore native SDK or the Mongo-compat driver? | `api/src/data/mongo.ts:2-7` says production points the `mongodb` driver at Firestore Enterprise. The envelope is agnostic; any Firestore-native rule/IAM assumption in the Cofre design is not. Confirm before K-2. | Ops |
| Secret Manager posture contradiction | **PR A-8** - `docs/security.md:283` commits to Secret Manager in prod and `deploy/validate-topology.sh:34,44` gates on it. Append the superseding decision and adjust the gate. | Governance |
| How does `signingSecret` reach a production bridge? | **Answered by R-8**: it should not - mint a per-pairing secret. `ekoa-bridge/docs/decisions.md:26-29` already flags the per-pairing mint as an ekoa-code change never made. Also confirm whether chat-driven file delegation has ever run outside the harness. | Engineering |
| Does `provider_request`/`provider_response` survive into v2? | **Recommend: yes, keep it.** It is not one of the six target families but it is the mechanism keeping the egress chokepoint intact for bridge traffic; dropping it needs a replacement story nobody has. Record as a decision in A-4. | Architect |
| Where is the Mac Mini residential proxy actually configured? | Provably not in either repo. If it runs in production it is an out-of-band infrastructure setting with **no application-side hook** - meaning WS-I's "generalization" has nothing to generalize from and is greenfield. | Ops - answer before budgeting I-4 |
| `EKOA_AUTOMATION_LOCAL_BROWSER=true` in any deployed environment? | If yes, the never-closed-BrowserContext (G-3) and unauthenticated-screenshot (R-3) findings apply in **production**, not just dev - which raises both to immediate. | Ops - answer this week |
| Retention/TTL/pruning for `<dataDir>/automation-runs/**/step-N.png` | Every reference in `api/src` is a write or a path builder; no unlink or sweeper found; stale pre-rebuild PNGs are still served. **PR R-3** must include the sweeper and a retention policy - it is a GDPR erasure obligation over an unindexed tree. | Engineering + legal |
| Does the LLM provider contract (ZDR / no-training / processor terms) cover the Agent SDK subprocess route used by `runOneShot`? | The GDPR defensibility of sending unmasked court-portal screenshots depends on it, and no DPA/ZDR posture is referenced in `docs/security.md`. | Legal - blocks the H-2 risk acceptance |
| What is CidNews? | Zero hits in either tree. Get the URL and a login-screen screenshot from the pilot lawyer, then run the mechanical battery. **Do not budget v1 work until the URL is known.** | Pilot lawyer |
| Can the OA professional certificate satisfy a TLS client-cert challenge as exportable key material, or is it card/mID-app-bound? And does an eTribunal session survive as a transplantable cookie-only storageState? | **Two probes that decide the shape of `session.push` (J-5) and whether the bridge is a login helper or a full execution target.** D6 could not answer either. Highest-leverage unknown in the whole plan. | Engineering, with a real card, before J-5 |
| All D6 rail conclusions | **D6 is the only audit with `verification: null`.** Its code-side claims verify (the base URLs at `api/src/config.ts:230-232`, the invented URL shape at `api/src/legal/portal-connectors.ts:124-128`, the non-functional IMAP transport, the CITIUS `credentialGuide`). Its **probe-derived** claims - mTLS-only mandatário access, non-resolving IRN hostnames, the OA Roundcube form login, the civilonline captcha - must be re-probed live before anything is budgeted against them. | Engineering, one afternoon of live probing |

---

## 7. Risks and sequencing traps

**1. The brief's "deep security plumbing last" fights five live breaches.** R-1 (unsandboxed cloud-side file read reachable from an LLM-authored manifest), R-2 (one-hop credential exfiltration to any public host), R-3 (unauthenticated screenshot mount), R-4 and R-5 are running in production-shaped code today. Deferring them to Phase 3 means shipping the Cofre UI on top of an API host that already leaks. **Recommendation: run Phase 0 as a separate remediation track starting immediately, tracked in `docs/findings.md`, with no dependency on the contract PR.** The brief's ordering is correct for *building* the Cofre; it is not a reason to leave shipped defects standing.

**2. "Product surfaces against stubbed seams" is only honest if the seam is real.** The `can()` precedent works because `can()` is a genuine fail-closed decision function that just happens to be simple. If the Cofre lock stub returns "always unlocked", every surface built against it encodes the wrong assumptions and D-2's "Em utilização" state has nothing to bind to. **Recommendation: B-2 ships a real default-deny policy lock in Phase 2, backed by the existing `crypto.ts`. Only the *envelope* is stubbed (deferred to K-2), not the *lock*.** That is the distinction the brief's "single seam" wording is actually asking for.

**3. The relay and the typist both land on an unaudited surface.** `api/src/streaming/` is simultaneously the closest precedent for the typist, the mount point for the relay, and an unexamined I1/I2 channel. Designing either before F-1 risks building the ceremony on top of the leak. **F-1 is cheap and must be sequenced before D-5 and F-2.**

**4. The portal choice is load-bearing and rests on an unverified audit.** If the OA re-probe finds a client-certificate request rather than a Roundcube form, there is **no** surveyed portal where a typist login is possible, and the terminal proof gate has no v1 target. That would force J-5 (attended card login) into the critical path and roughly double the bridge workstream. **Run the OA and Citius probes in week 1, before Phase 1 finishes.**

**5. `envWhitelist` must be deleted, not extended.** It is tempting to treat the existing env channel as "the I9 primitive, needing hardening". It is the inverse: it reads the *Cortex server's* `process.env` (holding `ENCRYPTION_KEY`, `JWT_SECRET`, provider keys) by a model-supplied name list. Because `local_command` is unreachable end-to-end, deletion costs nothing today and is impossible later. **J-4 deletes it in the same PR that adds the primitive.**

**6. Wiring `setDaemonConnectionResolver` is a security event, not a plumbing event.** The moment it is wired, `local_command` becomes reachable end-to-end and every latent I5/I9 defect goes live. **J-1 must not land before H-1, H-4, J-4 and J-7.** This is the single most dangerous ordering mistake available in this plan.

**7. The OpenAPI requirement invites a second source of truth.** A hand-written spec would immediately drift from `shared/` and the repo has no mechanism to catch it. **Derive it (A-7) and gate the derivation.** Also note the derived artifact is what the Apify actor consumes - so I-6's isolation boundary and A-7's generator have a shared consumer, and the generator must not leak internal-only endpoints into the public document.

**8. The scoped-repository claim is weaker than the docs say.** `FIXED-14` claims "a repository layer that cannot express an unscoped query"; it is instantiated in exactly two modules, `OrgScoped` is used by none, and `api/src/apps/app-paths.ts:84-112` re-implements the predicate by hand a third time. The Cofre must be the module that makes the claim true - **lint-enforced on the raw store handle, and the rule must also forbid re-deriving the predicate.** Otherwise Cofre items join the ~52 hand-written filter sites and the tenancy story is convention, not structure.

**9. Reading module docblocks instead of the composition root has already produced wrong audit conclusions twice** (`local-browser-session.ts`'s "persistent per-owner stealth context" vs `api/src/server.ts:461-464` ignoring `ownerUserId`; `write.ts`'s "the user assents Cortex-side" vs nothing checking it). **Standing rule for this plan: every claim about runtime behaviour is verified at the composition root, and G-3 and J-7 fix the misleading docblocks in the same PR as the behaviour.**

**10. Effort concentration.** Fourteen of ~63 elements are "large". The genuinely large-and-unavoidable ones are the typist (F), session-first (G), bridge v2 (J) and egress (I). The KMS envelope (K) is *graded* large but is small **if and only if** `unwrap()`/`key()` remain the sole chokepoints - which is exactly why B-2 must land before anything else touches a decrypt call site. If any workstream bypasses `unwrap()`, K becomes a repo-wide refactor.
