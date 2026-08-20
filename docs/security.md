# Security

The binding security invariants, the anonymisation pipeline, the access-control model, and the
incident-response + secure-development posture. Every invariant names its enforcement home.

## The numbered invariants (ch09)

Eleven carried invariants; each has a mechanical enforcement home (lint, grep gate, boot gate, or a
named test suite).

1. **No Anthropic access outside `llm/`.** Every Anthropic byte flows through `api/src/llm/`; no
   model call exists in runtime platform paths. Enforced by ESLint `no-restricted-imports` +
   the `api.anthropic.com`/`@anthropic-ai/` grep gate + the attribution-tag test gate.
2. **Egress controls.** (a) Model-bound anonymisation before Anthropic (below); (b) client-bound
   error sanitisation - `services/sanitizeOutbound` runs at exactly two egress points (the SSE event
   serializer and the Express error middleware), replacing any provider-identifying or provider-auth
   text wholesale. No provider identity ("Anthropic"/"Claude"/auth markers) ever reaches a user, on
   SSE or REST. Test gate injects a provider-auth error and asserts neither leaks.
3. **Single audit write path.** All audit logging flows through one `logActivity(user, category,
   type, description, metadata?)` in `data/`; direct writes to the activity collection are grep-
   banned. Writes are best-effort (a persistence failure is swallowed, never fails the domain action)
   and carry `orgId` for the org-scoped Registo read surface.
4. **Centrally managed model credentials.** One AES-encrypted `credentials` singleton per environment
   (`_id: 'default'`), two auth modes as config (`oauth` / `api-key`), no per-user ad hoc keys, no
   `~/.claude` fallback. The SDK subprocess env builder deletes any inherited provider env
   (`SCRUBBED_PROVIDER_ENV`: `ANTHROPIC_API_KEY`/`ANTH_API_KEY`/`ANTHROPIC_BASE_URL`) and injects
   exactly one credential + the chokepoint base URL. Grep gate: no provider-credential env name
   appears outside the `api/src/llm/` custody code.
5. **Org + user scoping on every data access; single multi-org process.** Scope resolution in `data/`
   is the only query constructor and requires org + user context; an unscoped query is inexpressible
   and routes never import `data/`. Ownership mismatch returns uniform not-found (never leaks
   existence). Enforced by the cross-org adversarial suite and in-org sharing tests.
6. **Credential encryption at rest; key mandatory; single crypto module.** One AES-256-GCM
   implementation in `data/`; `ENCRYPTION_KEY` absent = refuse to boot in every environment; no
   default key constant anywhere (grep gate). Ciphertext is VERSIONED: a v2 record carries its own
   data key, wrapped per TENANT, so a row moved between tenants fails to decrypt. Legacy v1 rows
   (flat global key, never tenant-bound, so they decrypt under any tenant argument) still decrypt
   unchanged until the `ciphertext-v2` migration retires them - that migration is the point at
   which the v1 weakness actually goes away. The wrapping is a SEAM (`data/kms.ts`): the target is
   one Cloud KMS key per environment, and until that key is provisioned `LocalKeyWrapper` derives
   the wrapping key from `ENCRYPTION_KEY`. Stated plainly, because it is the whole difference
   between the two: under the local wrapper a database breach PLUS that one environment variable
   yields plaintext, which is exactly the property the KMS wrapper removes. Installed wrapper:
   `key-wrapper: local-v1` - machine-checked against `currentKeyWrapper().keyId` by
   `api/tests/security/key-custody-posture.test.ts`, so this line cannot drift from the code in
   either direction.
7. **Secret guard on code egress.** User-app code leaves through exactly three doors (version
   snapshot commit, GitHub mirror push, download zip); each runs the secret scanner. A hit blocks:
   `commit-blocked` audit row on snapshot, `422 SECRET_GUARD_BLOCKED` on download.
8. **SSRF guard on platform fetches of user-supplied URLs** (brand research, knowledge crawl/seed,
   uploaded links) via the guarded fetcher in `services/`. Scope boundary stated honestly: user-
   defined integration actions call arbitrary user endpoints by design and are not SSRF-gated.
9. **Webhook HMAC + dedup + audit.** Raw-body HMAC (verifier sees unmodified bytes - boot self-test),
   disabled-check AFTER signature (410 signed / 401 unsigned), dedup on `UNIQUE(trigger_id,
   dedup_key)` returning `{duplicate:true}`, and a `webhook_audit` row per outcome. The expected
   secret is the trigger's own generated secret UNLESS the integration declares
   `webhookConfig.secretSource:{credentialField}` - some providers sign with one of THEIR
   credentials (Meta signs every WhatsApp webhook with the app secret), so the owner's decrypted
   credential field is then the ONLY secret that verifies. One resolver serves both the POST and the
   GET-callback ingress and FAILS CLOSED: an unresolvable secret is a 500 with nothing enqueued -
   never a fallback to the trigger secret or an empty key - and the secret never reaches a log,
   an audit row or a response body.
10. **Sandbox path confinement.** Every user-derived filesystem path resolves through the symlink-
    hardened `resolveWithinJail`/safe-path helper in `services/`, jailing it to the owner sandbox;
    traversal/absolute/symlink fixtures all fail with uniform not-found. Covers artifact files AND the
    automation `file.read`/`file.write` operations (P-15).
11. **Production guard on default secrets.** JWT secret fails closed on default/unset in a
    production-like environment; `ENCRYPTION_KEY` is stricter - mandatory everywhere.

Fail-closed boot gates (`config.ts` boot): config secrets (fatal), App-SSO redirect URI (fatal),
storage backend (fatal), Claude credential init (non-fatal - agent calls fail until healed), webhook
raw-body self-test (non-fatal), port collision EADDRINUSE (fatal).

## Tool-less anti-injection agents (§5.6.4)

Agents whose only input is untrusted external/brand content run **tool-less** by design so a prompt-
injection attempt has no tool to reach: `brand-research` and the served-app assistant produce
proposals only. All model output and user content is untrusted input - nothing model-generated is
interpolated into queries, shell commands, or privileged calls without validation; generated apps are
static client bundles under a strict CSP with no server-side eval ever.

## Anonymisation pipeline (ch17)

The pipeline is a submodule of the chokepoint (`llm/anonymise/`), invoked by `llm/client.ts` after
the payload is assembled and before any Anthropic request, and again on every response and streamed
delta. Because the chokepoint is the only transport, a caller cannot skip it.

**SCOPE — text, not pixels (corrected 2026-07-27, Cofre H-2).** This pipeline covers model-bound
TEXT. It does not tokenize images: `runOneShot` anonymises `prompt` and `systemPrompt` and forwards
`images` verbatim, because finding sensitive regions in a finished PNG is OCR-and-hope. The pixel
plane is protected UPSTREAM instead, at the only layer that can do it correctly — the browser
session masks credential-bearing regions by LOCATOR at capture time, so those pixels are never
rendered into the buffer, and suppresses the capture entirely during a credential window
(`automation/screenshot-masking.ts`). Stating the pipeline as covering "all model-bound text"
without this paragraph was true and false-by-omission at the same time: a reader took it as
covering everything model-bound. RESIDUAL, stated plainly: a screenshot still carries whatever
non-credential content is on the page (a processo number, a client name) as pixels, untokenized.

Per request: **collect** all model-bound text; **detect** sensitive spans on the delta only (never
the tokenized prefix - preserves prompt caching); **tokenize** each span into a deterministic,
format-preserving fake recorded in the session vault; **forward** tagged with a per-request
correlation id; **de-tokenize** the response, including `tool_use` argument blocks, streaming with
straddle buffering.

Detection layers, all behind one interface: (a) PT structured-ID recognizers (regex + checksum:
NIF/NIPC/NISS/utente/CC/IBAN-PT/CITIUS) - near-certain; (b) the **per-org deny-list** (the firm's
client/matter/party names, matched literally) - itself secret material, so it is AES-encrypted with
an org-scoped key, access-logged, and never sent to Anthropic; (c) a recall-biased PT-PT NER head
(in-process ONNX). Fail-closed: if (a) or (b) is unavailable the request is refused, not forwarded
un-tokenized; (c) is best-effort and degrades without failing the request. Structured-ID fakes are
minted with a **deliberately invalid checksum** so a fake can never collide with a real identifier.

The vault (value->token map) is per-session, **in-memory, TTL, never persisted, cleared on session
end** - a re-identification key that does not exist cannot be produced. It is keyed by the hosted
conversation id so tokens stay consistent across delegated local turns. On the LLM gateway path a
stock Anthropic client (Claude Code) sends no conversation id, so the vault key is derived (S7,
2026-07-17): an explicit `session_id` wins; else a gateway-KEY principal keys the vault by its key
id (`gwkey_<keyId>`) so one client session shares one vault across its agentic tool loop and
deny-list literals tokenize consistently turn-to-turn (a fresh per-request vault broke Claude
Code's tool loop - findings `gateway-vault-per-request-instability`); a truly session-less,
key-less call keeps a per-request ephemeral vault cleared on exit. The stable per-key vault
persists only to its 30-min TTL, maps the OWNER's own literals to stable fakes for that key alone,
and the fakes never leave the chokepoint. Audit is **metadata only**
(entity classes, counts, correlation id, payload hash - never bodies, never the vault), async, hash-
chained and tamper-evident, folded into the single Registo write path. The payload-capture harness
asserts every planted synthetic value appears tokenized (never cleartext) in every captured outbound
request while the user-visible response is cleartext. The Garrison line (FIXED-7): the mechanism is
Ekoa core; the PT-PT ruleset and per-org deny-lists are loaded configuration, never core.

## Access control model

Deny by default: every `/api/v1` route passes auth middleware; pre-auth exemptions are exactly the
`public` class, enforced by a route-census contract test. Authorization is deterministic code, never
the model. Object-level ownership/org checks on every resource fetch, uniform 403/404. Three roles
(`super-admin`/`org-admin`/`user`); privileged routes re-resolve the user from the store. Private
items (memories, artifacts) are invisible to org admins - their existence appears in Registo
metadata, never their content; sharing is explicit via `visibility`.

**Capability layer (H1).** Authorization is a capability check composed with the ownership/org
check, never a bare role string. The single seam `can(actor, capability)`
(`api/src/auth/capabilities.ts`) is a pure role->capability map: `super-admin` and `org-admin` hold
all four capabilities; a `user` holds `canUseChat` + `canCreateArtifacts` only (chat + non-app
artifacts, never app build/edit); a null/undefined actor holds nothing (fail closed). It carries no
org/resource context by design - tenancy + object ownership stay in the separate `loadReadable`/
`loadWritable` and org-scoping checks, which the gates COMPOSE with `can()`.

| capability | super-admin | org-admin | user |
| --- | --- | --- | --- |
| canBuildApps | yes | yes | no |
| canEditApps | yes | yes | no |
| canCreateArtifacts | yes | yes | yes |
| canUseChat | yes | yes | yes |

Four gates enforce it: `POST /jobs` first build requires `canBuildApps`; `POST /jobs` follow-up
requires `canEditApps` AND a `loadWritable` ownership check on the target artifact; `POST
/chat/runs` requires `canUseChat`; `POST /artifacts` requires `canCreateArtifacts`. A refusal is the
shared FORBIDDEN envelope carrying `details.capability` (the machine-readable hook a request-to-admin
flow consumes). The base role `builder` was renamed `user` (the persona is retired): an idempotent
boot-step migration rewrites every legacy row and bumps its token epoch (invalidating outstanding
`builder` JWTs), and a verify-boundary shim in `verifyToken` normalises any legacy `builder` JWT to
`user` for the window between boot and re-login.

**Follow-up-build ownership (IDOR fix, H1).** A follow-up build (`POST /jobs` with `artifactId`)
resumes a code-writing agent inside the target app's owner sandbox. It is gated by `canEditApps` +
`loadWritable(actor, artifactId)` (own always; org-shared within the org ok; another user's private
-> 403; missing/cross-org -> 404) BEFORE any job is created or agent spawned - closing the prior gap
where any authenticated user could drive an agent against ANY artifact by id. Credential planes are mutually
non-interchangeable: platform session JWT (24 h / 30 d rememberMe), bridge token (600 s,
`aud: ekoa-bridge`), app-SSO session (8 h HttpOnly cookie), gateway key (static, constant-compare).
Deactivation is write-through (immediate) and bumps the token epoch, invalidating outstanding JWTs.

**Served-app admission planes.** The per-app `/api/app-data` plane is unauthenticated app-global
storage scoped only by `X-Ekoa-App-Id` (carried verbatim for byte-compatibility). Anything private
is meant to live on a server-authenticated plane: the shared namespace (`/api/app-shared`, resolved
owner + same-origin guard + `sharedData` opt-in) or behind the platform JWT / app-SSO session.
**This open posture is a KNOWN HIGH GAP, not a safe boundary** - any caller who knows an app id can
write/delete that app's `/api/app-data`, and the collection write-mode that was supposed to restrict
this is unenforced. It is pre-existing and requires an operator decision - see the KNOWN GAP under
the assertion layer below and `docs/findings.md` `served-app-data-unauthenticated-writes`.
The same header-only posture covers `/api/app-files` and, since 2C-S4, `/api/app-docx/*`: the plane
now also exposes the owner's SOURCE WORD DOCUMENT, so any holder of an app id can read its full text
(`/projection`), download its bytes (`/current`, `/clean`) and PERSIST tracked changes and comments
(`/edits`) - which `document-source.applyReview` attributes to the ARTIFACT OWNER's username, so an
anonymous edit is recorded in a legal `.docx` as authored by the lawyer. Because `deleteArtifact`
drops only the artifact row, a deleted app's id resolves to null, `artifactBacked` is false and the
owner-activation gate is SKIPPED - the orphaned document stays readable to anyone with the id. Same
root cause, same operator decision; pinned as a tripwire in
`api/tests/security/app-docx-authz.test.ts`.

**Security-block assertion layer (H5).** The access-control invariants above are held by committed,
re-runnable gates so they cannot silently regress:
- *Capability matrix + gate wiring* (`api/tests/auth/capabilities.test.ts`): the full role x
  capability grid (grants AND denials; a null/undefined/unknown-role actor holds nothing, fail
  closed), plus a wiring inventory that ties every capability to the route `can(actor, '...')` call
  site that enforces it - so a matrix that stays green while a route loses its gate fails the suite.
  Behavior is driven end-to-end by `jobs-capability`/`artifacts-capability`.
- *Grep gates* (`api/tests/security/grep-gates.test.ts`): a committed tree scan (mirroring
  `gate:chokepoint`'s style, self-proving via an in-suite non-tautology test) that fails if the
  retired `PERMISSIVE-STUB`/`PERMISSIVE_STUB` marker reappears in `api/src`/`shared/src`, or if a
  quoted `builder` ROLE literal appears anywhere in `api/src`/`shared/src`/`web{app,components,stores}`
  outside a small commented allowlist (the legacy-JWT shim, the migration query, and the web
  SESSION-KIND `builder` - a session kind, not a role).
- *Cross-org assistant-retrieval isolation* (`api/tests/security/assistant-cross-org-isolation.test.ts`):
  over the real FTS grounding seam, the served-app assistant (`runAppAssistant`, which grounds under
  the server-resolved `owner.orgId`) retrieves + cites ONLY the owner org's knowledge and can never
  reach another org's - the org-B token never even enters an org-A app's prompt. Live evidence is
  folded into the operator journey drivers + `fees-knowledge.e2e.mjs`.
- *Destructive-action authorization, server-side* (`api/tests/security/destructive-action-authz.test.ts`):
  the PRIVILEGED served-app end-user ops that carry an identity ARE authorized SERVER-SIDE by the
  per-app SSO identity, not by any client confirmation (the Phase 4 confirm dialog is UX). The
  canonical case - `POST /api/app-sso/set-password` (writes a bcrypt hash onto the app's data) - is
  rejected 401 WITHOUT a valid app-sso session and with a WRONG-APP session (`session.appId`
  isolation via `findValidAppSession`), and proceeds only for the correct same-app session; the
  visitor-acting `/api/app-sso/m365/*` proxy is gated the same way.

  **KNOWN GAP (HIGH, pre-existing, requires an operator decision) - unauthenticated served-app data
  mutations.** The GENERAL `/api/app-data/:collection` plane that a C3 submit/delete/write lands on
  authenticates NOTHING about the CALLER: `served-data.ts` `scopeFor()` requires only a well-formed
  `X-Ekoa-App-Id` + the resolved app OWNER's activation (`admitOwner`), then scopes to that app's
  data partition. So ANY caller who knows an app id/slug can `POST`/`PUT`/`DELETE` that app's data
  across tenants - the "authorization dimension" Phase 10 requires for a destructive action is NOT
  met for the primary served-app mutation surface. Two compounding facts: (1) the collection-rule
  `access: { write: 'session' | 'server' }` level is DECLARED in the manifest schema but NOT enforced
  by `served-data.ts` (the write mode is decorative); (2) the app-sso session cookie is
  `Path=/api/app-sso`, so it is not even transmitted to `/api/app-data`, i.e. there is no session to
  check at that path today. This is PRE-EXISTING (the C3/D-era served-app data plane; the operator-run
  did not introduce it) and sits on a DIFFERENT axis from the platform role/capability layer H1-H4
  close (which IS complete and correct). The proper fix - enforce the declared write mode and make an
  app-sso session verifiable at the data path (cookie-path widening or a session token) - is an
  architecture change to the served-app data plane spanning the ~200-app estate, and is an operator
  decision, not a bolt-on to this assertion slice. H5 ASSERTS the current state honestly
  (`destructive-action-authz.test.ts` pins the unauthenticated write as a KNOWN-GAP TRIPWIRE so a
  future fix flips the test) and flags it as the top landing item; it does NOT claim the plane is safe
  and does NOT silently redesign it. Tracked: `docs/findings.md`
  `served-app-data-unauthenticated-writes`.

**Frame headers (current state).** The api plane sets `X-Frame-Options: DENY` / `frame-ancestors
'none'`. The served-app plane sets `frame-ancestors 'self'` + `SAMEORIGIN`, except `/apps/*`, which
answers `frame-ancestors 'self' <dashboard origins>` (the embed allowlist: `EKOA_DASHBOARD_ORIGINS`
csv -> `EKOA_APP_ORIGIN` -> dev localhost:3000; invalid entries dropped) with no `X-Frame-Options`,
so the cross-origin dashboard can iframe a served artifact (landed commit 55d9294; recorded in
`docs/findings.md` `apps-embed-frame-headers` - this paragraph previously said PENDING, stale).
The dashboard's preview iframes carry NO `sandbox` attribute (decision 2026-07-14): with both
`allow-scripts` and `allow-same-origin` a sandbox is escapable by design (Chrome warns on every
document load), while dropping `allow-same-origin` breaks the injected `__ekoa` runtime
(same-origin data fetches, the CHIPS SSO cookie, storage) across the byte-compat app estate.
Isolation between arbitrary served-app code and the authenticated dashboard is therefore the
ORIGIN SPLIT plus this allowlist - deployments must keep served apps on the api origin
(`api.<domain>`, `:4111` in dev), never on the dashboard origin.

**Per-user gateway API keys (S4a, 2026-07-17).** Stock Anthropic clients (Claude Code) authenticate
to the LLM gateway with self-service, long-lived, revocable keys: secret `ekoa_gk_` + 32 random
bytes base64url; at rest the sha256 (the store id - O(1) verify) plus a 4-char display TAIL of
the secret (the industry-standard recognition hint, a deliberate 24-of-256-bit trade -
decisions.md 2026-07-17; the full plaintext is shown exactly once at mint and never stored or
logged). Verification is an injected seam
(`auth/gateway-keys-service.ts` -> `GatewayDeps.verifyGatewayKey`; `llm/` never imports `auth/`)
and fails CLOSED through the activation cache: unknown/revoked keys and inactive/deleted owners
are 401, a billing-locked owner is a distinct 402, revocation is durable and effective on the
next call. The billee is always the key OWNER (`agentType: 'gateway-client'` in the billing
ledger - its own breakdown line), the allowance gate applies, and a third per-KEY rate-cap
window (`EKOA_RATECAP_CALLS_PER_KEY`/`EKOA_RATECAP_SPEND_PER_KEY`, per-key doc overrides)
composes with the user/org windows - the abuse answer for a metered Anthropic-compatible
endpoint (token-farming target). Ownership is the authorization: keys are minted/listed/revoked
only by their owner (`/api/v1/gateway-keys`, uniform 404 cross-user), `lastUsedAt` is a throttled
anomaly surface, and every metered key turn lands a metadata-only `gateway_turn` row in the
owner's Registo (who/when/tier/model/metered - never content).

**Automation run logs widen what a run reader sees (accepted residual, slice E4, 2026-07-31).**
`GET /api/v1/automations/runs/:id/logs` serves per-step captured output that the run-detail
serializer deliberately withholds (`toWireStep` drops `output` wholesale): a `local_command`'s
stdout/stderr verbatim and unredacted, an `api_call`'s response body (secret-redacted upstream at
`automation/executors/api-call.ts`), and an `ekoa_action`'s primitive trace. Its visibility
predicate is `canSeeRun` — the run's OWNER **or an org-admin of the run's org** — so an org-admin can
read the command output of any member's run. Accepted on PARITY grounds, not on "it is harmless":
the same org-admin can already watch the identical bytes arrive live on the run's SSE stream
(`step_output_chunk`, gated by the same `canSeeRun`), so the endpoint changes the retention window,
not the audience. What it does NOT change: cross-ORG reads and non-admin cross-owner reads answer
the same uniform 404 as the run itself, and the response is bounded twice (16 KB/step, 128 KB/run,
on write and again on read) so a 5 MB capture can never be exfiltrated in one call. Revisit if
org-admin visibility of member runs is ever narrowed — the logs endpoint must narrow with it, and
the SSE stream must narrow at the same time or the parity argument stops holding.

**LLM gateway count_tokens is uncapped (accepted residual, 2026-07-17).** The gateway's
`count_tokens` forward is auth-gated but exempt from the rate caps, the allowance gate, and
metering: it is free upstream, produces no billable usage, and stock Claude Code polls it
continuously - counting it against the shared per-user window would starve real turns. Residual:
an authenticated caller can hammer it, bounded only by upstream provider limits on the central
credential - and, with client-chosen metadata.session_id values, can allocate short-lived
server-side vault entries without a call cap (tiny, TTL-swept at 30 min; the capped messages
path shares the same session_id behavior). Revisit with a dedicated cap bucket if abuse is observed; the anonymisation posture
applies to it in full, so no content risk is added.

**`achieve`'s compose rung reads only the caller's own owner-shared `app_data` (S5, 2026-08-20).**
The rung is a NEW READ PATH into a tenant-scoped store: a model names a collection, and the platform
turns that name into rows. Rule 5 therefore decides tenancy at the composition-root binding, and the
unit is the OWNER, because that is the only unit `app_data` has for shared rows - `docId` and every
read in `CollectionsEngine` bind on `scope.scopeKey` (`usr.<ownerUserId>`), and `Scope.appId` is
never part of any query. The binding is `ownerSharedScope(actor.userId)`: the acting user's own
namespace, derived from the verified actor, never from the request and never from anything a model
said. Nothing a caller sends and nothing a model returns reaches the scope key.

A NAME THAT DOES NOT RESOLVE THERE IS NOT A REFUSAL AND NOT AN ORACLE. The composition simply does
not apply: the caller gets the answer their own action produced, with a `compose` ladder step saying
so (the ladder invariant in `architecture.md` - a rung may only ever add an answer). The step's
wording is a fact about the CALLER'S OWN namespace and nothing else, so the whole response for a name
another tenant holds is byte-identical to the response for a name nobody holds anywhere, and the
isolation suite asserts that by comparing the two bodies rather than by reading them. Until
2026-08-20 this path answered `compose_unknown_collection` - a refusal decided after the caller's own
read had already succeeded, which discarded a result the product was holding (D-S5-3).

Two failure modes were found and closed in verification (`docs/decisions.md` D-S5-1), both from
reasoning per-ARTIFACT over data scoped per-OWNER: a peer's ORG-VISIBLE artifact resolved to
`usr.<peer>` and opened that peer's entire owner-shared namespace - apps the caller cannot see,
collections the visible artifact never names - and a second app owned by the caller made one
namespace read twice count as two sources. **Artifact visibility is not entitlement to its owner's
rows.** Consequence, accepted deliberately with a review date of 2026-11-20: composing against a
COLLEAGUE'S app data is refused even where the app is shared org-wide, because the store has no
per-app dimension with which to grant the narrow version.

A FAILED READ TELLS THE CALLER NOTHING ABOUT THIS PLATFORM'S INSIDES (added round five). The
collections seam is a live Mongo query, so it can REJECT rather than answer; the rung converts that
into a fixed ladder sentence ("the data this goal would have been narrowed by could not be read")
and logs the error's own message server-side. A driver's message carries a namespace, a replica-set
host and a query shape, and the ladder is a caller-facing field on a public capability endpoint -
so the message is an operator's fact, never a caller's. Pinned by asserting that the injected
failure text appears nowhere in the response body, at both the module and the wire level.

Isolation suite: `api/tests/security/achieve-compose-isolation.test.ts`, of the
`memvault-isolation.test.ts` class, driven through the real app and the real binding. Proven a gate
by DELETING the tenancy filter at the single query-binding point (`appId: scope.scopeKey`), which
reds it in both directions - rows via `list`, collection names via `listCollections`. The claim that
makes the OWNER the right unit - `Scope.appId` is never part of any query - is asserted from the
engine's source as well, so adding an `appId`-bound filter reds rather than silently re-introducing
a per-app dimension the rest of the design assumes away.

## Incident response

Solo-operator posture: the founder is incident commander. Detection sources, in order: **Registo**
(append-only, single write path - agent actions, privileged data access, auth/admin ops), the
anonymisation audit (hash-chained, metadata-only), the chokepoint meter (anomalous-burn / spend-cap
trips), and boot-gate failures. Severity: S1 confirmed cross-org exposure / key compromise / PII
egress past the anonymisation boundary; S2 single-org/user exposure or auth bypass without confirmed
exploitation; S3 vulnerability without exposure. Containment (first hour): scope from Registo; cut
access narrowly (deactivate account -> bump token epoch -> revoke bridge pairings -> rotate the
secret in Secret Manager -> last resort stop the service); preserve the append-only evidence before
any remediation. A COFRE key compromise is a different lever and rotating a service secret is not
it: ciphertext already at rest does not care that a new secret exists. Containment there is the
per-owner `POST /api/v1/cofre/lock-all` (every grant revoked, so `unwrap()` refuses on the default-
deny ground), then rotate the environment wrapping key and re-wrap the per-tenant DEKs. GDPR: personal-data breach to the supervisory authority within 72 h of awareness
unless no risk; record the decision either way. Post-incident: write it up in `docs/decisions.md`,
and every accepted root cause ships a deterministic guard in the same fix.

## Secure development

All change lands through the gated process (spec-first history preserved in git; see
`docs/governance.md`). Structural enforcement is the lint + CI wall above. Input/output: boundary
validation via the shared zod contract on every request (the contract is simultaneously input schema
and injection defence); non-2xx bodies validate against the error envelope; no secrets/keys/org data
in system prompts. CI security gates run on every lane: gitleaks (secrets), Semgrep (SAST),
`npm audit` severity, the boundary/chokepoint grep gates, plus the named security suites - cross-org
adversarial, in-org sharing, rate-limit/spend-cap, anonymisation payload-capture, and the bridge
S1-S6 scenarios. The determinism ratchet: every accepted review or incident finding ships a
deterministic guard (test, lint rule, Semgrep pattern, grep gate) in the same fix, so reviews trend
toward judgment-only and regressions are machine-caught. Secrets live in a managed store only, on
two DISTINCT custody planes - one earlier sentence covered both and that is what read as a
contradiction when the Cofre ruled Secret Manager out (`docs/decisions.md` 2026-07-28, A-8).
SERVICE secrets - `JWT_SECRET`, `ENCRYPTION_KEY`, `MONGODB_URI`, provider keys: what the service
needs to boot - live in GCP Secret Manager in prod (a bootstrap-generated key in dev), injected by
NAME at deploy time and gated by `deploy/validate-topology.sh`; rotation is documented per secret.
TENANT credential material - what users put in the Cofre - is NOT a Secret Manager tenant: one
managed secret per user credential is the wrong unit, and it carries none of the per-item grants,
locks and origin binding that make a Cofre item different from a stored string. It is ciphertext in
the database under a per-tenant DEK wrapped by one Cloud KMS key per environment (invariant 6),
reachable only through `cofre.unwrap()`.
