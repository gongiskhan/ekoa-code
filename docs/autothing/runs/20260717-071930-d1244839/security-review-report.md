# Security review - run 20260717-071930-d1244839 (Cortex Gateway Claude Code v1)

SECURITY: issues

Scope: `git diff 4a12588..HEAD -- api/src shared/src web` (20 files, +1280/-56). Reviewed against
the five named surfaces: credential custody, gateway authorization, anonymisation vault keying,
the egress chokepoint, and the accepted residuals. Post-change files read in full, not just the
diff. Out of scope per instruction: the pre-existing served-app-data-plane unauthenticated-writes
finding.

Evidence gathered: `npm run gate:chokepoint` (clean), secret-logging greps, ID-provenance tracing
(userId / orgId / conversation id), and a read of the trusted-path caller (`bridge/provider.ts`).

Two findings. The headline surfaces - credential custody, key authorization, and the vault
namespace disjointness that closed six prior HIGHs - are **clean**; I could not find a seventh.

## Findings

### 1. MEDIUM - Unauthenticated 50 MB body buffering on the gateway (pre-auth memory DoS, 50x regression this run)

**Files:** `api/src/server.ts:535-541`, `api/src/llm/gateway.ts:169`, `api/src/llm/gateway.ts:336-339`

**What changed.** `server.ts:535-541` exempts `/api/v1/llm*` from the global 1 MB JSON parser. The
gateway router's own `largeJson` (`gateway.ts:169`, limit `50mb`) is mounted as middleware *before*
the handler:

```
router.post('/messages', largeJson, handleMessages);        // gateway.ts:336
```

`authenticate()` runs inside `handleMessages` (`gateway.ts:172`) - i.e. **after** the body is fully
buffered and `JSON.parse`d.

Before this run the global 1 MB parser pre-empted `largeJson`, so pre-auth buffering was capped at
1 MB. The diff comment at `server.ts:529-534` states this outright ("the router-level limit is dead
code"). Making it live was necessary for the feature, but it raised the **unauthenticated**
buffering ceiling from 1 MB to 50 MB.

**Exploit path.**
- *Who:* anyone on the network. No credential, no account, no key.
- *What they send:* `POST /api/v1/llm/v1/messages` (or `/messages`, `/classify`,
  `/messages/count_tokens` - all four mount `largeJson`) with `Content-Length: 49MB` of JSON.
  Declaring <= the limit means `raw-body` does not short-circuit; the full body is read.
- *What they get:* a 401 - but only after the process has buffered ~49 MB and materialised it as a
  JS object graph (pathological input, e.g. a large array of small objects, expands several-fold in
  heap). A handful of concurrent requests exhausts the Node heap. The single Express process serves
  the API, the gateway and the dashboard, so this is a **total platform outage triggered by an
  unauthenticated client**.

The auth decision needs only headers (`x-api-key` / `authorization`, `gateway.ts:82-92`), so nothing
forces the parse to come first.

**Fix:** run a header-only auth pre-check ahead of `largeJson` on the four body routes, or apply a
small limit until the principal resolves and the large limit only after. Feature behaviour for
authenticated Claude Code clients is unaffected either way.

**Note:** this is not covered by the accepted residuals in `docs/security.md` (which cover
count_tokens, in-stream errors, and tool_use fidelity), and no reverse-proxy body cap is documented
as compensating (`docs/operations-runbook.md:27` describes only a CORS reverse proxy).

### 2. MEDIUM - `gateway-anon-tooluse-fidelity` is not purely a usability break: it can egress a near-miss of a secret deny-list literal to the provider

**Files:** `docs/findings.md:11-23`, `api/src/llm/anonymise/detectors.ts:9`,
`api/src/llm/anonymise/index.ts:170-172`

This answers the question posed in the brief ("a fidelity gap - is it a SECURITY issue, or only a
usability break?"). Answer: **primarily usability, but not only.**

**The exact literal is safe.** Egress tokenization deep-walks `system` + `messages` including
`tool_result` and `tool_use` string leaves (`anonymise/index.ts:170-172`), detects on the whole text
every turn (no delta shortcut), and is fail-closed. A deny-listed literal sitting in an `ls` output
fed back as a `tool_result` **is** tokenized before egress. No full-literal leak.

**The mangled variant is not.** `docs/findings.md:16-17` records, live-observed, that the literal
"comes back mangled across calls (observed: `ZarkovH90305` -> `ZarkovH9305`, a dropped digit)" - the
client receives a corrupted rendering of the real value. The deny-list is **matched literally**
(`detectors.ts:9`: "Matched literally"). So:

- *Who:* the Anthropic provider - precisely the party the deny-list exists to withhold the literal
  from. (Not another tenant; this is not a cross-user leak.)
- *What happens:* the CLI holds `ZarkovH9305`, acts on it, and its failure output (`cd: no such file
  or directory: ZarkovH9305`) returns as a `tool_result` on the next turn. `anonymizeRequestBody`
  runs the deny-list detector, which does **not** match the corrupted variant, so `ZarkovH9305`
  crosses the wire **in cleartext**.
- *What they get:* a one-character-off rendering of a literal that §17.4(b) treats as secret
  material - encrypted at rest, decrypted through the one crypto module, access-count audited.
  Partial, not full, disclosure - but of the very thing the control protects.

**Scope:** deny-list orgs only. The empty-ruleset case is a proven byte-identical no-op, so this
does not affect orgs without a configured deny-list.

**Confidence:** the two premises are confirmed - the mangling from the live S6 proof recorded in
`findings.md`, and the literal-only matching read from `detectors.ts`. The re-egress step is
inferred from the code path and was **not** reproduced live in this pass. Worth a targeted repro
before sizing the fix.

**Recommendation:** the finding is currently classed as a fidelity/usability gap. Re-class it to
carry a confidentiality note so it is not deprioritised as cosmetic; the existing "deeper
anonymisation-plane change" fix direction is unchanged.

## Verified clean

### Credential custody - CLEAN
- **No secret logging.** `gateway-keys-service.ts` contains no `console.*` at all. `gateway.ts` logs
  only `err.message` or static strings (`:273`, `:327`, `:493`) - no credential is interpolated.
- **Never persisted.** `GatewayKeyDoc` (`stores.ts`) has no secret field; `_id` is the sha256.
- **Never returned.** `GatewayKeySummary` (`shared/src/gateway-keys.ts`) has no `key` field, so
  list/verify structurally cannot echo it. Only `GatewayKeyMintResponse` carries `key`, once.
- **Mint audit is safe:** `logActivity(..., { keyId: id, label })` (`gateway-keys-service.ts:67`) -
  keyId is the public hash id, not the secret.
- **No timing oracle.** `gatewayKeys.get(hashOf(secret))` (`:112`) is an O(1) store get on the hash,
  not a byte-compare of secrets. Confirmed as designed.
- **secretHint** (last 4 chars, `:62`) is owner-only (`listGatewayKeys` filters by `ownerUserId`),
  documented, and costs ~20-24 of 256 bits. A deliberate recognition affordance, not a leak.
- **Web custody:** `web/stores/gateway-keys.ts` is a plain zustand store with **no `persist`
  middleware** - the minted secret lives in memory until dismissed, never localStorage. The page
  renders it through JSX (auto-escaped), with no `console.*` and no `dangerouslySetInnerHTML`.

### Authorization - CLEAN
- **No principal can bill another user.** `billeeOf` (`gateway.ts:115-117`) returns the verified JWT
  `sub` or the **store doc's** `ownerUserId` (`gateway-keys-service.ts:127`) - never a request field.
- **Owner stamped server-side.** `GatewayKeyMintRequest` is `{label}` only; zod strips unknown keys;
  the owner comes from `req.user!.sub` (`routes/gateway-keys.ts:16-18, 28`). A body-supplied
  `ownerUserId` is inert.
- **No existence oracle in revoke.** Both "unknown id" and "foreign owner" return `false`
  (`gateway-keys-service.ts:99`) -> uniform 404 (`routes/gateway-keys.ts:38`).
- **Fails closed.** unknown/revoked/inactive -> 401; `billing_locked` -> a distinct principal -> 402
  (`gateway-keys-service.ts:111-117`, `gateway.ts:99`, `:177-180`).
- **No empty-key bypass.** The static compare is guarded by `configuredKey &&` (`gateway.ts:84`).
  (The non-constant-time `===` is pre-existing - `git show 4a12588` line 53 - and not remotely
  exploitable through network jitter.)
- **No crafted credential hits the wrong branch.** The `ekoa_gk_` prefix routes *before* the JWT
  branch on both channels (`gateway.ts:92-100`). A bogus `ekoa_gk_` string masks a valid JWT -
  fail-closed (401), self-inflicted only.
- **No unhandled rejection.** Express is `^5.0.1`, which forwards async handler rejections to error
  middleware; the router's handler (`gateway.ts:433-449`) shapes only body-parser errors and
  `next(err)`s everything else. No TOCTOU beyond the documented "revocation effective next call".

### Anonymisation vault keying - CLEAN (the three namespaces are genuinely disjoint)

The disjointness rests on ID shape, which I traced rather than assumed:
- `userId` = `deps.genId()` = `randomUUID()` (`users-service.ts:28`, `server.ts:184`) - colon-free.
- `orgId` = `genId()` (`users-service.ts:25`); the only body-supplied path is
  `routes/users.ts:21`, gated `requireRole('super-admin')` - colon-free in practice.
- conversation id = `deps.genId()` (`services/platform-crud.ts:112`) - a bare colon-free UUID,
  **never client-chosen**.

Therefore:
- **A key principal can never reach a `csid:` vault.** `if (args.keyId)` returns first
  (`client.ts:1146`), always `gwkey:`-prefixed. A client `session_id` is subscoped *under* the key.
- **No key can reach another key's vault.** `keyId` is a 64-char colon-free sha256, so
  `gwkey:<A>:<sid>` cannot equal `gwkey:<B>` or `gwkey:<B>:<sid2>` unless `A === B`.
- **No client `session_id` can open another user's conversation vault.** The untrusted key is
  `csid:<org>:usr:<billee>:<sid>` (`client.ts:1148`). Reaching the trusted `csid:<org>:<conv>` needs
  `conv === "usr:<uuid>:<sid>"` - **structurally impossible**, `conv` is a bare UUID. Reaching
  another user's untrusted vault needs two distinct UUIDs to be equal. The `:`-in-session_id
  namespace-break attack fails because the attacker controls only the trailing segment; every
  delimiter-bearing prefix component is a server-minted colon-free UUID.
- **`trustedSession` is unforgeable from HTTP.** `gateway.ts:222-229` passes `undefined` as
  `correlationIdIn` **literally**. The only trusted caller is `bridge/provider.ts:168`, a WebSocket
  frame path that validates credential -> live pairing (`:133`) -> socket binding (`:142`) ->
  activation (`:147-153`) -> session org === pairing org (`:158-161`), and **overwrites**
  `meta.session_id` server-side (`:97-103`, `:167`). A stock client cannot reach it.
- **count_tokens is consistent with messages,** not a weaker sibling: `trustedSession: false`, no
  keyId (`client.ts:1361`). A crafted `session_id` there also cannot open a `gwkey:` or trusted vault.
- **The bridge's same-org cross-user vault sharing is deliberate and coherent** (`client.ts:157-164`).
  It is safe because the ruleset is per-**ORG** (`client.ts:1188`): the vault only ever holds
  literals already present in the caller's own org ruleset, so a same-org peer learns nothing new.
  Org is the anonymisation trust boundary and `provider.ts:158-161` enforces it. Not a finding.

### Egress chokepoint (FIXED-3) - CLEAN
`npm run gate:chokepoint` -> `chokepoint grep gate: clean (no @anthropic-ai/ or api.anthropic.com
outside api/src/llm/)`. The run added no provider reference outside `api/src/llm/`.

### Residuals - bounded, not escalations
- **count_tokens uncapped/unbilled:** requires a **valid** credential (`gateway.ts:309-313`);
  billing-locked -> 402. Bounded by upstream provider limits on the central credential; the
  vault-allocation angle is already documented (`docs/security.md:231-238`). Availability-only,
  no content risk, honestly recorded. Confirmed bounded.
- **In-stream error delivery:** auth (401) and allowance (402) both resolve **before**
  `res.writeHead(200)` (`gateway.ts:172-193` vs `:209-219`), so no auth/billing failure is ever
  masked behind a 200. Frames carry generic messages - no bodies, no secrets (`:280-284`), and
  `sseErrorFrame` re-serialises through `JSON.stringify` (`:149-159`), so an upstream body cannot
  inject SSE framing. Correct.
- **Rate caps:** `keyWindows` is a separate Map keyed by `keyId` (`rate-caps.ts:77`, `:122-130`);
  the per-key window **composes with** rather than replaces the user+org windows. No cross-tenant
  interference.

## Observations (not findings)

- **`/classify` skips the allowance gate for JWT principals** (`gateway.ts:395` checks only
  `principal.kind === 'userkey'`). Pre-existing - `git show 4a12588` shows the old `/classify` had
  **no** allowance gate for anyone, so this run strictly improved it. Bounded to `maxTokens: 8` and
  still covered by the user/org rate caps inside `completeFast`. Worth closing opportunistically.
- **`lastUsedWrites`** (`gateway-keys-service.ts:25`) grows unbounded, but only for keys that
  successfully verify, so it is bounded by the real key count. Not a DoS.
- **`metadata.user_id` is client-controlled** and forwarded to the provider (`client.ts:1261`). It
  does **not** affect ekoa billing (that uses the principal-derived billee), so this is
  provider-side label pollution only. Non-security.
