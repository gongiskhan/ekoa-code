VERDICT: approve

# S1 "Heartbeat-and-replay SSE liveness" — fresh-context adversarial review

Reviewed: commit `257a115` (5 files: `api/src/llm/gateway.ts`, `api/tests/llm/gateway-stream.test.ts`, `docs/api-contract.md`, `docs/decisions.md`, `docs/diagrams/06-llm-chokepoint-billing.excalidraw`), then the fix commit `eaa4fbd`.

**Verdict history:** `needs-work` on `257a115` (2 findings, both in committed artifacts, neither in `gateway.ts`) → **`approve` on `eaa4fbd`**, both findings independently re-verified as closed. See **## Re-review** at the bottom for what I re-checked.

**Scope of the original verdict.** The **implementation was correct from the start** — every behavioural bullet of the acceptance is met, and I independently confirmed the core design works against a *real* stock Anthropic SDK client (Evidence E6). Both findings were defects in the **committed artifacts** (`decisions.md`, diagram 06), which the acceptance names explicitly. Neither required a change to `gateway.ts`, and none was made.

---

## Evidence

All commands run by me from `/Users/ggomes/dev/ekoa-code` (no reported exit codes trusted).

### E1 — `npm run typecheck` — PASS
```
> @ekoa/shared@0.0.0 typecheck   (tsc -b --noEmit) — clean
> @ekoa/api@0.0.0 typecheck      (tsc --noEmit -p tsconfig.json && -p tsconfig.test.json) — clean
> @ekoa/web@0.0.0 typecheck      (tsc --noEmit) — clean
```

### E2 — gateway vitest suites — PASS (31/31)
```
$ cd api && npx vitest run tests/llm/gateway-stream.test.ts tests/llm/gateway.test.ts \
    tests/llm/gateway-diagnostics.test.ts tests/llm/gateway-payload-allowlist.test.ts \
    tests/llm/gateway-boot-auth.test.ts
 Test Files  5 passed (5)
      Tests  31 passed (31)
   Duration  7.08s
```

### E3 — `npm run gate:chokepoint` — PASS
```
chokepoint grep gate: clean (no @anthropic-ai/ or api.anthropic.com outside api/src/llm/)
EXIT=0
```
(My own SDK probes were deliberately written under `/tmp/s1-probe/`, importing the SDK by absolute path, so the review itself could not trip this gate.)

### E4 — diagram 06 JSON validity — PASS
```
$ python3 -c "import json; json.load(open('docs/diagrams/06-llm-chokepoint-billing.excalidraw'))"
diagram JSON OK, elements: 59
```

### E5 — `npm run lint` — PASS (0 errors, 217 pre-existing repo-wide warnings). Import boundaries / egress zones clean.

### E6 — **Stock-SDK probe against the exact wire shape the gateway emits** (`/tmp/s1-probe/probe.mjs`)
Real `@anthropic-ai/sdk` **0.81.0** (the version vendored in this repo) driven against a server emitting the verbatim `SSE_PING_FRAME` / `sseErrorFrameOf` byte sequences from `gateway.ts`:
```
PROBE A: stock SDK stream OK. events = ["message_start","content_block_start",
         "content_block_delta","content_block_stop","message_delta","message_stop"]
```
**The central design premise holds**: pings arriving *before* `message_start` do not disturb a stock client. Confirmed statically too — `node_modules/@anthropic-ai/sdk/core/streaming.js` dispatches `if (sse.event === 'ping') { continue; }` at the `Stream` layer, so pings never reach `MessageStream`'s ordering accumulator. The code comment "stock clients ignore it" is accurate.

### E7 — **In-stream error frame A/B on the same stock SDK** (`/tmp/s1-probe/retry.mjs`) — basis of Finding 1
```
non-stream HTTP 429      -> RateLimitError   status=429       RateLimitError=true  httpRequests=3 (maxRetries=2)
stream in-stream frame   -> APIError         status=undefined RateLimitError=false httpRequests=1 (maxRetries=2)
```

### E8 — load-bearing assumption verified: `stream` survives into the upstream payload
The whole slice rests on `result.body` actually *being* SSE text when `wantsStream` is true. Traced and confirmed:
- `gateway.ts:152` `wantsStream = req.body?.stream === true` and `client.ts:1087` `isStream = reqBody.stream === true` — **identical predicates on the same object**, so the SSE commitment and the upstream request mode can never diverge.
- `anonymizeRequestBody` (`anonymise/index.ts:174`) does `{...body}` and only rewrites `system`/`messages`/`tools` → `stream` passes through untouched.
- `stream` is in `GATEWAY_FORWARD_FIELDS` (`client.ts:1002`) → survives the allowlist into `payload` → provider streams → `await res.text()` buffers it.

### E9 — `git status --short` — no stray slice files
```
 M RUN_LOG.md          (run journal; pre-existing at session start, not S1 code)
 M web/next-env.d.ts   (Next-generated dev artifact; pre-existing at session start)
?? docs/autothing/runs/20260717-071930-d1244839/   (this run's artifact dir)
```
Nothing uncommitted in `api/` or in the touched docs. Clean.

### E10 — interaction/edge review of the FULL post-change `gateway.ts` (not just the diff)
| Probe from the brief | Result |
|---|---|
| Does `/models` or `/classify` change? | No — untouched; `wantsStream`/`canWrite`/`stopPing` are local to `handleMessages`. |
| Does the `largeJson` error path interact with the SSE branch? | No. Body-parser 400/413 fire *before* `handleMessages`, so no SSE commitment can exist. Clean JSON envelope (`server.ts:530`). |
| Can a ping fire between `writeHead` and the first write? | No. `setInterval` is registered *after* the first `res.write`, single-threaded. |
| Any path where the interval leaks? | No. With `wantsStream` true, the only exits past `await proxyGatewayMessages` are the `if (wantsStream)` blocks in **both** the `try` and the `catch`, each calling `stopPing()` first; `res.on('close')` covers disconnect. Verified by inspection of all branches. |
| `res.on('close')` after normal `end()` / double `res.end()` | Safe — `stopPing` is idempotent; every write and the `end()` are behind `canWrite()` (`!writableEnded && !destroyed`). |
| Unmetered counter on error paths | Correct. `client.ts` only sets `unmetered = true` inside `if (2xx)` when usage is unparseable; a non-2xx never sets it, and a thrown error never reaches the counter. |
| Express 5 `writeHead`/`write` on an aborted socket | Safe. `OutgoingMessage._writeRaw` returns `false` when `conn.destroyed` (no `'error'` emit, no crash); the `canWrite()` guard is correct belt-and-braces. No `compression()` middleware in `server.ts` to buffer the pings. |
| Upstream 2xx with a JSON (non-SSE) body | Not reachable — see E8; `stream: true` always reaches the provider. |
| `stream` as the string `"true"` / non-object `req.body` / no body | Clean. `=== true` fails → non-stream path → the provider 400s → forwarded verbatim. No divergence, no hang (E8). |
| Rate cap before upstream spend? | Yes — `admitOrThrow` is the first statement of `proxyGatewayMessages`, before any transport call. Matches the spec's "refusal still happens before upstream spend and before metering". |
| Client disconnect aborts upstream? | No — `proxyGatewayMessages` passes no `signal` to `transport.messages`. Metering lands. Pinned by the committed abort test. |

### E11 — security-boundary rubric
- **Authorization on every touched path** — `authenticate()` then `checkAllowance()` both precede the commitment; pinned by the committed 401/402 tests.
- **No injection into SSE frames** — the error path parses and *re-serialises* (`JSON.stringify`) instead of embedding the raw body, guaranteeing a single-line `data:`; a non-`type:"error"` or unparseable body is replaced by a synthesised frame. Correct.
- **No secret/internal leak** — in-stream messages are the same generic strings as the existing non-stream 503/429/502; the re-emitted upstream JSON is the same disclosure the non-stream path already makes verbatim. `console.error` logs `err.message` only (pre-existing).
- **Tenant/org scoping** — `billeeOf` untouched.
- **`proxyGatewayMessages` signature / transport** — `client.ts` is not in the commit at all. Unchanged.

*Considered and dismissed (not findings):* the raw replay of a detokenized body is theoretically frame-injectable if a `deanonymize` cleartext value contained `\n\n`, but the raw write is **spec-mandated** ("do not re-parse and re-serialize events"), the vector is self-inflicted, the values are detector-derived (structured IDs / names / deny-list terms) and realistically newline-free, and the identical body already flows through the non-stream path. Ungrounded — dropped per the verdict rules. Likewise the absence of `Connection: keep-alive` / `X-Accel-Buffering: no` (HTTP/1.1 defaults to persistent; no grounded proxy-buffering repro).

---

## Findings

### 1. [Medium] — **CLOSED in `eaa4fbd`** (re-verified, see ## Re-review) — `decisions.md` records a demonstrably false claim as the load-bearing justification for the in-stream-cap-trip trade-off

**Violated criterion:** acceptance "decisions.md gains dated bullets"; repo governance treats `docs/decisions.md` as **append-only** first-class truth (root `CLAUDE.md`, `ekoa-governance`) — a wrong entry is expensive precisely because it cannot be quietly rewritten later.

**The claim** (`docs/decisions.md`, 2026-07-17 bullet):
> "…the trip still refuses BEFORE any upstream spend or metering, **and a stock client treats the in-stream rate_limit_error exactly like an HTTP 429 (retry with backoff)**."

**Failing evidence** (E7 — real `@anthropic-ai/sdk` 0.81.0, the version vendored in this repo, against the gateway's exact frames):
```
non-stream HTTP 429      -> RateLimitError   status=429       RateLimitError=true  httpRequests=3 (maxRetries=2)
stream in-stream frame   -> APIError         status=undefined RateLimitError=false httpRequests=1 (maxRetries=2)
```
The two are **not** treated "exactly" alike — they differ on every observable axis:
1. **No retry with backoff.** The 429 is auto-retried (3 requests at `maxRetries: 2`); the in-stream frame is **not retried at all** (1 request). The SDK's retry lives in the request layer and the streamed response already returned `200` — the error is thrown during *iteration*, past the retry decision. `streaming.js` throws `new APIError(undefined, body, undefined, response.headers, type)` with **`status === undefined`**.
2. **Not a `RateLimitError`.** Client code doing `catch (e) { if (e instanceof RateLimitError) … }` — or switching on `e.status === 429` — will not match.
3. No `retry-after` header is conveyed.

**Why it matters (this is not a style nit):** the claim is exactly what makes the accepted trade-off look free. It is not free — a cap trip on the **streamed** path (the path stock Claude Code actually uses) surfaces to the user as a hard, non-retryable error, whereas the identical trip on the non-stream path is transparently retried by the SDK. That is a real, user-visible asymmetry which the decision journal currently asserts does not exist, and a future engineer will reasonably rely on it.

**Note on the code:** the *behaviour* is spec-mandated ("a cap trip after the SSE commitment is delivered as an in-stream `rate_limit_error` event") and the implementation matches it exactly. **Do not change `gateway.ts`.** The fix is to correct the bullet — state the real client-side consequence and record it as the accepted cost.

**Honest limit of my evidence:** I tested the canonical stock client (`@anthropic-ai/sdk`); I cannot introspect the `claude` CLI's own retry wrapper. But the SDK-level facts bound any client built on it: `status` is `undefined`, so no status-based (429) retry logic can match.

**Suggested wording:** *"…a stock client surfaces the in-stream `rate_limit_error` as a terminal `APIError` (status `undefined`) rather than a retryable 429 — verified against @anthropic-ai/sdk 0.81.0: no automatic backoff, not a `RateLimitError`. Accepted: post-commitment the 200 is already on the wire, so no status is expressible; the streamed cap trip is therefore user-visible and non-retryable where the non-stream 429 is auto-retried."*

### 2. [Low] — **CLOSED in `eaa4fbd`** (re-verified, see ## Re-review) — Diagram 06's new `s1-heartbeat-note` carries the WRONG `rawText` — a verbatim copy-paste of the 2026-07-11 element

**Violated criterion:** acceptance "diagram 06 gains an s1 note (valid JSON)"; FIXED-12 ("diagrams are first-class… a structural change without its diagram update is incomplete, and review must reject it").

**Failing evidence:**
```
$ node -e "…compare rawText vs originalText across all text elements…"
text elements: 32
*** MISMATCH id= s1-heartbeat-note
  originalText[0:70] = "S1 heartbeat-and-replay 2026-07-17: stream:true commits the SSE 200 af"
  rawText[0:70]      = "AS-BUILT amendment 2026-07-11 (SS6.5.4 wire tier): the gateway matches"
elements with rawText: 2
rawText !== originalText count: 1
```
The new element's `rawText` is the **sibling 2026-07-11 element's text**, not its own. It is the only element of 32 whose `rawText` contradicts its `originalText`; the one other element carrying `rawText` has `rawText === originalText`, establishing the convention this one breaks.

**Impact (stated honestly):** Excalidraw renders `text`, so the canvas looks correct — geometry is clean, I verified **0 overlaps** (box `x:60→794.4, y:960→1047.5`, sitting below the annotation ending at `y=936`). This is a data-integrity defect, not a rendering break: the committed JSON is self-contradictory and silently duplicates stale 2026-07-11 content, so any reader/tooling keying on `rawText` sees the wrong note.

**Fix:** set `rawText` equal to the element's own `originalText`.

---

## Acceptance criteria — verified PASS (no action needed)

| Criterion | Status |
|---|---|
| SSE 200 committed immediately **after** auth (bad credential → clean HTTP 401) | PASS — committed test + code order |
| …and after the allowance gate (billing block → clean HTTP 402) | PASS — committed test |
| First ping written at commitment | PASS |
| `event: ping` / `data: {"type": "ping"}` frames every 15 s | PASS — frame byte-exact |
| Interval injectable via `GatewayDeps.pingIntervalMs`, default 15000 | PASS — `GATEWAY_PING_INTERVAL_MS = 15_000`; `server.ts:579` omits it → default |
| On resolve: interval cleared | PASS |
| Upstream 2xx → verbatim detokenized SSE body raw-written, then `end` | PASS — pinned by `raw.endsWith(SSE_UPSTREAM_BODY)` |
| Upstream non-2xx → its JSON error body re-emitted as ONE `event: error` frame | PASS |
| Unparseable body → synthesised `api_error`, raw body never leaked | PASS |
| Post-commitment `CredentialError` → in-stream `api_error` | PASS |
| `LlmRateCapError` → in-stream `rate_limit_error` | PASS (behaviour; see Finding 1 re: the *documented rationale*) |
| Other → `api_error` | PASS (incl. `AnonymisationRefusedError`, `LlmAbortedError`) |
| Every write guarded against `writableEnded`/`destroyed` | PASS |
| Client disconnect clears timer, does NOT abort upstream (metering lands) | PASS — no `signal` threaded; committed test |
| Non-stream path byte-identical | PASS — additive `if (wantsStream)` branches only; regression-pinned |
| `proxyGatewayMessages` signature + transport unchanged | PASS — `client.ts` not in the commit |
| `api-contract.md` LLM-gateway section + provider-headers caveat | PASS — caveat present and accurate |
| `decisions.md` dated bullets | PRESENT — but see Finding 1 |
| Diagram 06 s1 note, valid JSON | JSON valid — but see Finding 2 |

## Out-of-scope observation (does NOT affect the verdict — pre-existing, not S1's)

**The gateway's 50 MB body limit is dead code in the mounted app.** `server.ts:525` mounts a global `express.json({ limit: '1mb' })` *before* `registerGateway` (`:579`). The first parser wins (`express.json` skips when `req._body` is set), so the router's `largeJson` 50 MB limit never applies, defeating its own comment ("Base64 screenshots… use a generous one"). Verified empirically on this repo's Express 5.2.1:
```
2MB body -> HTTP 413 {"type":"entity.too.large"}
```
Harmless *for S1* (it fires before `handleMessages`, so a clean 413 envelope, never a corrupted SSE stream). But it likely matters for the run's overall goal — stock Claude Code routinely sends >1 MB bodies (long transcripts, images), and today those get a 413 before reaching the gateway at all. Worth a look in a later slice or as its own fix; flagging it, not counting it against S1.

---

## Re-review — fix commit `eaa4fbd` → VERDICT: approve

Scope: **only** the two findings' closure, re-verified with my own commands. `gateway.ts` is untouched by the fix (4 files: the new `api/tests/docs/diagram-integrity.test.ts`, `docs/decisions.md`, `docs/diagrams/04-agent-job.excalidraw`, `docs/diagrams/06-llm-chokepoint-billing.excalidraw`), so the E1–E11 evidence for the implementation stands unchanged.

### Finding 1 — CLOSED
Re-read the corrected 2026-07-17 bullet in `docs/decisions.md`. The false claim ("*a stock client treats the in-stream rate_limit_error exactly like an HTTP 429 (retry with backoff)*") is **gone**, replaced by an accurate record of the asymmetry as the accepted cost:

> "**Accepted cost** (verified against @anthropic-ai/sdk 0.81.0, the vendored stock client, during the S1 fresh review): the in-stream frame surfaces as a **terminal APIError with status undefined - NOT a RateLimitError, NOT auto-retried with backoff** the way the non-stream HTTP 429 is (**3 requests at maxRetries 2 vs 1**) - so a cap trip on the streamed path is user-visible and non-retryable. Post-commitment no status is expressible (the 200 is already on the wire), so this asymmetry is **inherent to heartbeat-and-replay**, not fixable in the frame shape."

Every claim matches my E7 probe numbers exactly, the evidence is attributed and reproducible, and the "inherent, not fixable in the frame shape" framing is correct — post-commitment there is genuinely no status to express. The trade-off is now recorded honestly instead of being waved away. Nothing overstated.

### Finding 2 — CLOSED
1. **The defect itself is fixed.** `s1-heartbeat-note.rawText` now carries its own S1 text.
2. **Repo-wide re-run of my original check — 0 mismatches** (was 1). Widened from diagram 06 to all 12 diagrams:
```
text elements: 307 | carrying rawText: 22 | rawText !== originalText: 0
```
3. **The new guard passes:** `$ cd api && npx vitest run tests/docs/diagram-integrity.test.ts` → `Test Files 1 passed (1) | Tests 13 passed (13)`.
4. **The guard is PROVEN RED, not just green** (I re-planted the exact original defect — `s1-heartbeat-note.rawText := sibling.text` — rather than trusting a passing test):
```
FAIL tests/docs/diagram-integrity.test.ts > 06-llm-chokepoint-billing.excalidraw: ...
AssertionError: rawText !== originalText in 06-llm-chokepoint-billing.excalidraw: s1-heartbeat-note:
  expected [ 's1-heartbeat-note' ] to deeply equal []
Tests  1 failed | 12 passed (13)
```
It fails, names the exact element, and the file was then restored byte-exact (`git status --short docs/diagrams/` → empty). The ratchet genuinely holds this defect class.
5. **Regression check on the scope expansion (the 4 pre-existing `04-agent-job` fixes).** The risk in "aligning metadata to text" is silently altering what the canvas *renders*. I diffed the parsed `text` field of every text element across `eaa4fbd~1 → eaa4fbd`:
```
04-agent-job.excalidraw              | text elements: 34 | RENDERED text changed: NONE
06-llm-chokepoint-billing.excalidraw | text elements: 32 | RENDERED text changed: NONE
```
Only stale `originalText`/`rawText` metadata moved (incl. two literal `"x"` placeholders on `f25_t`/`f25_b`). The canvas is untouched — the fix direction was correct.
6. **Full re-run, nothing collateral:** `npm run typecheck` clean (the new test compiles under `tsconfig.test.json`); the 5 S1 gateway suites + the new guard → `Test Files 6 passed (6) | Tests 44 passed (44)`.

### Non-blocking correction to the record (not a finding)
The commit message — and the re-review brief — state the guard "pins **rawText/originalText == text** for every diagram text element". It does not. The test asserts only `rawText === originalText`, and only for the 22 of 307 elements that *carry* a `rawText`; the `=== text` axis is never checked, so `verify_title` (stale `originalText`, no `rawText`) was fixed by hand, not caught by the guard.

**This is a description error, not a code defect — the narrower invariant is the *right* engineering call and I would reject the broader one.** In Excalidraw `text` is the *wrapped* form and `originalText` the *unwrapped* source; they legitimately differ for any container-bound label with wrapping, so a test pinning `originalText === text` universally would false-fail the suite the first time someone adds one. The chosen invariant is exactly Finding 2's invariant, which is what closure requires. For the record, I also probed the unguarded axis and it is currently clean anyway:
```
--- COVERAGE PROBE: originalText !== text (what the guard does NOT check) --- count: 0
```
Worth correcting the sentence if it is ever carried into a doc of record; it does not affect the verdict.

### Re-review commands
```
git --no-pager show eaa4fbd [--stat] [-- <path>]        # fix diff, all 4 files read
node -e "…rawText vs originalText across docs/diagrams/*…"   # 307 elements, 0 mismatches
node -e "…parsed `text` diff eaa4fbd~1 → eaa4fbd…"           # rendered text: NONE changed
cd api && npx vitest run tests/docs/diagram-integrity.test.ts        # 13 passed
  …re-plant defect → 1 failed | 12 passed → restore → git status clean   # guard proven red
cd api && npx vitest run tests/llm/gateway-{stream,,-diagnostics,…}.test.ts tests/docs/… # 44 passed (6)
npm run typecheck                                                    # clean
git status --short                                                   # no stray files in api/ or touched docs
```
