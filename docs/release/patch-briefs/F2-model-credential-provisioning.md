# F2: Model credential has no provisioning surface + default gateway topology cannot auth

**Severity / class:** high / bug

**Symptom:** A fresh boot is honestly un-credentialed: there is no HTTP route, no boot env path, and no
migration that seeds the `credentials/default` singleton, so chat and build are dead (they surface
`ADAPTER_ERROR "No model credential configured ... (ch06 §6.2)"`). Worse, even WITH a credential the
default chokepoint topology cannot complete a turn: the SDK subprocess is pointed at the local gateway,
whose `LLM_GATEWAY_API_KEY` auth is never provisioned on any boot path, giving `401 Invalid or missing
API key / JWT`. Working runs today require `LLM_CHOKEPOINT_BASE_URL=https://api.anthropic.com`, which
bypasses the gateway plane. Evidence: `docs/release/evidence/J0-degradation/j0-degradation.json`
(J0b/J0c terminal = ADAPTER_ERROR, `claudeAuth.configured=false`); `J0-gateway-topology/preflight.md`.

**Root cause:**
- Credential custody exists but has only a test/admin seam, not an HTTP surface: `setCredential`
  (`api/src/llm/credentials.ts:140-153`) and `loadCredential` (:123, called at boot `server.ts:550`).
  No router mounts a credential write; no boot code calls `setCredential`.
- Default chokepoint base URL is the local gateway: `api/src/config.ts:162`
  (`llmChokepointBaseUrl = process.env.LLM_CHOKEPOINT_BASE_URL ?? 'http://127.0.0.1:4111/api/v1/llm'`),
  injected to subprocesses as `ANTHROPIC_BASE_URL` (`credentials.ts:277`). The gateway requires a
  principal (`api/src/llm/gateway.ts:51` reads `loadConfig().llm.gatewayApiKey`;
  `config.ts:90` = `process.env.LLM_GATEWAY_API_KEY || undefined`) and rejects with `401` when absent
  (`gateway.ts:90,127,149`). Nothing provisions that key on boot, so the subprocess cannot authenticate
  to the very chokepoint it is pointed at.

**Fix scope:** (a) a super-admin, write-only, audit-logged credential endpoint (ch06-consistent) in a
new/existing router that calls `setCredential`; (b) boot-time gateway-key provisioning so the default
topology self-authenticates (e.g. derive/inject a gateway principal at `server.ts` bootState, or make
the subprocess present a first-party JWT the gateway already accepts). Document the sanctioned dev
posture. NON-goals: no credential pools / rotation redesign (Amendment 2 already deleted those); do not
move any Anthropic import or base-URL literal out of `api/src/llm/`; do not weaken the gateway auth.

**Regression test first:** contract test `api/tests/contract/credentials.test.ts` (supertest, in-process
factory): the credential endpoint is super-admin-only (non-admin -> envelope 403), write-only (no read
echoes the secret), and audit-logged; response validates against its `shared/` schema. Plus a
gateway-auth unit test (`api/tests/`): with the default base URL and boot provisioning applied, a
gateway request from the subprocess principal is admitted (not 401). Both must fail before the fix.

**Acceptance (a - credential endpoint):** `POST` the credential returns 2xx, `claudeAuth.configured`
flips true on `GET /health`, the secret is never returned, and a `credential.set` audit row is written;
contract suite green.

**Acceptance (b - gateway boot provisioning):** with `LLM_CHOKEPOINT_BASE_URL` UNSET (default local
gateway) and a credential configured, one chat turn completes end-to-end (no `401 Invalid or missing
API key / JWT`); the anthropic.com bypass is no longer required; `gatewayUnmeteredCalls` stays 0.

**Notes:** ride the F13 one-line header fix here - `credentials.ts:3` still says "Firestore singleton"
but the store is Mongo (Amendment 2). Chokepoint + FIXED-13 invariants are load-bearing: the endpoint
and boot path must not introduce any Anthropic client or base URL outside `api/src/llm/`. If the boot
topology changes, update the ch06 egress/gateway diagram (FIXED-12).
