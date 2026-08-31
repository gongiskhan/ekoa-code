# Cofre & Engine Ground-Truth Verification

**Date:** 2026-08-18 · **Scope:** `ekoa-code` (live Cortex) + `ekoa-bridge` (the daemon repo) ·
**Method:** seven parallel read-only auditors, verdicts cross-checked at the cited lines by the
main session. Read-only; no code changed, no migration run.
**Measured against:** the Uber-Eats read-only acceptance flow (this document's north star), and the
approved policy decisions on locality, retry, re-auth, and custody.
**Prior art:** `docs/cofre-discovery-gate.md` (2026-07-27) ran a similar gate on an *earlier* code
state (pre-B1/B2 Cofre, pre-schedules) and was never measured against this acceptance flow. Where its
verdicts have since changed, this document supersedes them and says so.

---

## Headline

**The custody plane is real. The execution plane is not.**

The Cofre — two-plane reference/value separation, the typist, session capture, per-item grants,
one-time transit — is built to the standard the brief describes and pinned by dedicated security
suites. Almost nothing in it blocks the acceptance flow.

Everything that blocks the acceptance flow is on the **execution** side, and it concentrates in one
architectural fact: **there is no interactive browser executor on the user's own device.** The bridge
daemon runs file tools, a build-only headless `browse` (title+text, no click/fill), and a *headed
manual-login ceremony* — nothing that drives a real step-by-step browser session. So every real
browser run falls back to a **hosted, headless Playwright Chromium in a fresh datacenter context**,
which an Uber-Eats-class anti-bot wall fingerprints and rejects on sight. On top of that missing
surface, three capabilities the acceptance flow needs do not exist anywhere: a **needs-credentials
pause with auto-resume**, a **network-capture layer**, and **CDP call-injection replay**.

The honest one-line verdict: **the Cofre is ready to hold the Uber Eats credential; the engine cannot
yet use it against an adversarial target, and the single human stop is not wired.**

---

## Verdict summary

Legend: **C** conforms · **P** partial · **D** diverges · **A** absent. ● load-bearing for acceptance.

### A. Cofre

| # | Item | V | |
|---|---|---|---|
| 1 | Two-plane model (refs to model, values to Cortex; no value in context/logs/traces/memory; nothing plaintext at rest) | **C** | ● |
| 2 | Envelope encryption: per-tenant DEK, KMS-wrapped, decrypt only in RAM | **P** | |
| 3 | The typist: fixed audited CDP login primitive; model picks refs+timing, never writes injection code | **C** | |
| 3c/d | Typist recipe coverage + **OTP/MFA** entry | **P/A** | ● |
| 4 | Session-first: storageState capture, session items credential-equivalent, expiry hints | **C/P** | ● |
| 5 | Grants: per-credential, three scopes (`this_run`/`ttl`/`until_locked`), policy-lock v1 | **C** | ● |
| 6 | Portal UX: item states, establishment flow, unlock page, event log | **P** | ● |
| 7 | Transit: one-time payloads over authed WS, RAM-only on bridge, zeroized, output redaction | **C**(Cortex) / **A**(bridge) | ● |
| 8 | **The needs-credentials pause** (pause → portal → establish → auto-resume) | **A** | ● |

### B–E. Bridge, engine, locality, adversarial

| Area | Item | V | |
|---|---|---|---|
| B | Bridge interactive browser executor (click/fill/navigate on the user's device) | **A** | ● |
| B | Per-step screenshots from bridge runs → screenshot plane | **A** | ● |
| C | Vision-first *discovery* as a phase | **P** | ● |
| C | Network capture layer (endpoints/headers/tokens/JSON shapes) | **A** | ● |
| C | CDP call-injection replay inside the real session | **A** | ● |
| C | Recipe format + 9 step types | **C** | |
| C | Rehearsal loop + goal-verify | **P** | ● |
| C | Self-heal on drift → re-discover → superseded action | **P→A** | ● |
| retry | Bounded fixer budget with a hard stop | **C/P** | ● |
| D | Browser-steps default to bridge | **P** | ● |
| D | Cloud egress opt-in per integration, permissive origins only | **A** | ● |
| D | Bridge-offline schedule = blocked run + notify | **D** | ● |
| D | Never datacenter fallback for adversarial targets | **D** | ● |
| E | Fingerprint / session realness / anti-bot for Uber-Eats class | **A/D** | ● |

---

## What is genuinely built (do not rebuild)

- **Two-plane custody is structural, not conventional.** The wire contract has no `value` field and a
  regex-branded reference type (`shared/src/cofre.ts:60-108`); the item projection
  (`api/src/cofre/items.ts:139-177`) never reads `valueCiphertext`; `unwrap()`
  (`api/src/cofre/service.ts:94-147`) is the single reference→value seam with four fail-closed grounds
  before any decrypt; and the Cofre is provably off the gateway-key surface
  (`api/tests/security/cofre-not-key-reachable.test.ts`, passing).
- **No value reaches the model.** The typist fills+submits as one unit inside `withCaptureSuppressed`
  so control never returns with a filled password field (`api/src/automation/typist.ts:156-245`);
  process injection passes values via environment only, never the command string
  (`api/src/cofre/process-injection.ts`); `redactStepRecord` scrubs every step record before SSE /
  persistence / the fixer prompt (`engine.ts:129-157`); `SecretRegistry` masks raw+encoded forms and
  serialises to counts only (`security/redaction.ts:119-178`).
- **The typist is exactly the audited primitive claimed** — a fixed 6-step CDP sequence, recipes are
  reviewed selectors-only data (`api/assets/login-recipes/recipes.json`), the model can pick *which*
  reference and *when*, never *how* (`typist-non-memorable.test.ts`, `typist-recipes-and-routing.test.ts`).
- **Session capture already works** — a Playwright `storageState` is minted through the same envelope
  as a credential, origin-bound, locked by default (`api/src/cofre/sessions.ts`,
  `captureSessionWithGrant`). The Cofre storage/checkout/reuse machinery needs **no change** for Uber Eats.
- **Grants are strictly per-item** with the exact three-scope enum and an honestly-documented v1 policy
  lock (`shared/src/cofre.ts:130`, `service.ts:17-19`, `cofre-policy-lock.test.ts`).
- **Transit is one-time and authenticated Cortex-side** — nonce minted per invocation, redeemed before
  unwrap, pairing-bound, TTL-swept (`bridge/secret-delivery.ts:69-135`), over an authed WS with
  single-use jti and HMAC-signed tasks; a real value-keyed ingress-redaction filter is armed before the
  value hits the wire (`bridge/ingress-redaction.ts:74-108`).
- **No zero-knowledge claim anywhere** — the platform is stated as custodian-of-trust
  (`service.ts:17-19`); conforms to the required posture.

The two caveats on the built plane, both cosmetic-for-acceptance but real for the threat model:
- **Envelope encryption is real in structure, local in root.** `envelopeEncrypt`/`envelopeDecrypt`
  implement a versioned per-tenant-DEK envelope over a `KeyWrapper` seam (`data/crypto.ts`,
  `data/kms.ts`), but the default `LocalKeyWrapper` derives the wrapping key from `ENCRYPTION_KEY`, not
  a Cloud KMS — so a DB breach plus that env var yields plaintext. The code says this out loud
  (`kms.ts:12-18`) and forbids `security.md` from claiming the KMS property. Turning on real KMS is
  configuration, not a refactor.
- **Stream redaction is post-hoc value-matching.** Sound for the Uber Eats password and each registered
  cookie value, but a transformed value (hex, split across frames) or a <3-char value evades the
  enumerated encodings (`redaction.ts:29-31`). Defence-in-depth residual, tested edges pinned.

---

## The real retry numbers (Area: retry budgets)

The engine runs **one attempt per step with no deterministic per-step retry** — every failure escalates
to the LLM fixer, bounded by a single budget:

```
REHEARSAL_BUDGET (api/src/automation/rehearsal.ts:322-333)
  maxFixerCalls:      25   per run
  maxPatchesPerIndex:  5   per step index
  maxWallClockMs: 240000   (4 min) — REHEARSAL ONLY; a normal run has no wall-clock cap
  maxNormalPauses:     5   fast-path + fixer pauses on a normal run
```

- **Vision re-grounding** is implicit only: one cache→vision fallthrough per attempt
  (`engine.ts:1543-1601`), one forced re-observe on an empty screenshot (`engine.ts:1520-1528`),
  locator-ladder probes at 2 s / 15 s (`executor.ts:16-17`). There is no dedicated re-ground counter.
- **Full re-plans mid-run: zero.** Planning happens once at authoring; the fixer patches locally
  (`insert_before` / `replace_current` / `skip_current` / `abort` / `pause_for_user`), never re-plans.
- **Hard stop:** budget exhaustion *does* surface (SSE `runError`, terminal `failed`) — it does not burn
  tokens forever. But there is **no wall-clock cap on a normal (non-rehearsal) run**, and a fast-path
  CAPTCHA/MFA detector (`rehearsal.ts:detectHumanActionable`) pauses immediately without spending a fixer call.

**Proposed knob locations** (for the follow-up, not built here):
- (a) *small per-step retry + one vision re-ground* → a new `STEP_RETRY_BUDGET` beside `REHEARSAL_BUDGET`,
  consumed in the executor's cache→vision fallthrough (`engine.ts:1543-1601`) — today that fallthrough is
  the only "retry" and it is uncounted.
- (b) *bounded full re-plans per discovery* → has no home yet because discovery-as-a-phase does not exist
  (see Area C); it lands with the discovery loop, as a counter on the discovery driver.
- (c) *hard stop that surfaces* → add a `maxWallClockMs` to normal runs in the same budget object; the
  surfacing path (`runError` → terminal) already exists.

---

## The real locality behavior (Area D)

| Clause (approved policy) | Today | Anchor |
|---|---|---|
| browser-steps default to bridge | **P** — routes to daemon *if paired*, else hosted; no "prefer bridge" gate | `engine.ts:453-467` getBrowser |
| cloud egress opt-in per integration, permissive origins only | **A** — `egress-policy.ts resolveEgress/proxyOptionFor` implement the exact semantics but have **no caller**; no permissive-vs-adversarial classification exists | `egress-policy.ts:80-127` |
| bridge-offline schedule = blocked run + notify | **D** — yields a generic `automation_failed` schedule run that counts toward the 20-strike auto-pause and notifies nobody | `engine.ts:713-748`, `schedules/supervisor.ts:47-53` |
| never datacenter fallback for adversarial targets | **D** — **prod accidentally conforms** (halts `awaiting_daemon`, no fallback, because `localBrowserEnabled` defaults off in prod); **non-prod silently runs hosted for every target** | `config.ts:41` `localBrowserEnabled=!isProd` |

The vocabulary for all four clauses exists and is tested (`egress-policy.ts`,
`StepDeclaration.offlinePolicy` `fail|queue`); it is simply **unwired** — nothing consumes it at the
launch path (`local-browser-session.ts` `chromium.launch`). This is the good kind of gap: design done,
wiring pending.

---

## Ranked gap list — what blocks the acceptance flow, in order

Ranked by the order the 7-step acceptance flow would hit each, with the load-bearing ones first.

**G1 — No interactive browser executor on the bridge. (foundation)**
The daemon exposes file tools + build-only headless `browse` (title/text, launch+close per call) + a
headed *manual-login* ceremony. It cannot click/fill/navigate. `DaemonBrowserSession` dispatches
`PlaywrightAction`s to a daemon `browser` capability the bridge does not implement
(`ekoa-bridge/src/tools/tier2/index.ts:27` `TIER2_TOOL_NAMES=['bash','browser']`;
`daemon-runtime.ts:73-88` refuses every browser `tool.invoke`). **Consequence:** the entire acceptance
flow "on the bridge in the user's real session" cannot run; execution always falls to the hosted
headless browser. This is the single biggest realism lever and it is absent.

**G2 — The needs-credentials pause does not exist end-to-end. (the single human stop)**
No `needs_credentials` `RunStatus` (`types.ts:520-528`); the nearest are `paused_for_user` (manual
Continue) and `awaiting_integration` (terminal, manual re-run). No surfaced path from a paused run to
`/cofre`. No automatic resume — `resumeRun` is a user-set flag; nothing observes Cofre item minting /
grant issuance / session establishment to resume a waiting run. The building blocks (`ensureSession`,
`typistLogin`, `checkoutSession`) are complete and security-tested but wired **only to the Citius sync
rail**, not the automation run loop. This is the "only human interaction in the flow" — and it is not
connected.

**G3 — OTP/MFA login is not handled. (blocks credential establishment for Uber Eats)**
The typist handles username+password only and **hard-requires a password field**; the OTP relay exists
only as `shared/` schema (`RelayPrompt`/`CompleteRelay`), with no server-side issuance, no intake, and
no typed-code primitive (an OTP sibling of `typeOutOfBand`). No `ubereats.com`/`auth.uber.com` entry in
`recipes.json` `loginUrls` (`resolveLoginUrl` refuses without a declared URL). Uber prompts for an
emailed/SMS code routinely, so this is on the critical path.

**G4 — No network capture layer. (blocks discovery step 3)**
Zero hits for `Network.enable` / `recordHar` / request-response listeners across both repos. Nothing
records the underlying XHR/fetch traffic during navigation — endpoints, headers, tokens, JSON shapes.
This is the core input for "compile the flow into replayed internal API calls" and it does not exist.

**G5 — No CDP call-injection replay. (blocks the cheap-form compile, step 4)**
Replay today is exactly the two forms the acceptance flow rules out: server-side `api_call`
(own fetch + `authIntegrationKey`, no page session) and deterministic DOM steps
(`executors/api-call.ts`, the PlaywrightAction cache). There is no primitive that injects a fetch/XHR
into the authenticated page (CDP `Runtime.evaluate` / Playwright `evaluate`) to reuse the session's own
cookies/tokens against the target's private API.

**G6 — No self-heal on drift; no superseded-action recompile. (blocks step 6)**
`self-heal` / `supersede` appear nowhere in `automation/` (only in the unrelated legacy-runtime-import
and publish-snapshot code). The rehearsal fixer patches a *running* spec locally; nothing detects a
drifted action across runs and re-discovers → recompiles → supersedes the definition. Goal-verify is
per-step vision `verify`, not a run-level "did we achieve the goal" gate that could trigger heal.

**G7 — Adversarial fingerprint / session realness. (blocks the target itself)**
Execution browser is bundled **headless Playwright Chromium, no stealth args, `navigator.webdriver=true`,
HeadlessChrome UA**, in a **fresh empty datacenter context** with cookies grafted from an earlier capture
(`browser-pool.ts:32`, `local-browser-session.ts:108-118`). No real device, no consistent TLS/JA3, no
localStorage/IndexedDB seeding (`local-browser-session.ts:142-143` unimplemented). Uber Eats correlates
cookie provenance with device/IP/TLS; replayed cookies on a headless client from a datacenter IP read as
a hijacked/bot session. The residential-egress proxy that could mask the IP (`egress-policy.ts:127`) is
unwired. **This is why G1 matters most: only running in a real browser on the user's device makes the
client plausible.**

**G8 — Bridge-side transit lifecycle unbuilt; secret delivery unwired. (blocks running on the bridge with a real credential)**
The daemon-side RAM-hold → execution-time injection → post-exit zeroization is prose in the wire schema,
not code; it is "never on disk" today only because the payload is dropped on arrival
(`daemon-runtime.ts:89-94`). `deliverSecrets`/`authoriseDelivery` have **zero production callers** in
`ekoa-code` and `local-command.ts:169` sends `env: undefined` — the Cortex delivery path is built but
uncalled.

**G9 — Bridge screenshots never reach the plane. (blocks evidence from bridge runs — ties to convergence S1)**
The designed pipe (daemon `observation.screenshotB64` → `DaemonBrowserSession` → `snap()` → screenshot
plane) is missing at both ends: the daemon captures no screenshots, and the Cortex seam
(`server.ts:679`) drops `screenshotB64` even if it arrived. The plane itself (auth, tenancy, retention)
is real and serves hosted runs.

**G10 — Locality clauses unwired (blocked-run + no-fallback). (safety, not first-run blocker)**
Per the table above: the offline-schedule path yields `automation_failed` not `blocked`+notify, and
non-prod silently runs hosted. The egress-policy vocabulary exists; consuming it at `getBrowser` and
`chromium.launch` closes clauses 2-4.

**Cosmetic / not load-bearing:** the KMS-root caveat (real structure, local wrapper — a threat-model
upgrade, not an acceptance blocker); <3-char and transformed-value redaction edges; the v1 envelope
fallback (Cofre always mints v2); portal event-log polish. Real, worth doing, but they do not stop the flow.

---

## Draft plan skeleton (candidate slices only — NOT the plan)

Written for Gonçalo's review. Ordering, ownership, and effort are proposals; the real plan follows.
Dependencies on the approved convergence waves (S1 evidence, S2 detail page, …) are named.

**Track I — the bridge becomes a real interactive surface** (closes G1, G8, G9; the foundation)
- **I-a** Daemon browser executor: a persistent-context CDP browser on the bridge speaking the
  `PlaywrightAction` vocabulary, per-session tier-2 enablement, ledgered. Add a real `browser`
  `BridgeCapability` (today `local.filesystem` stand-in).
- **I-b** Session injection into the bridge browser: deliver the stored Uber Eats `storageState` via the
  existing one-time `secret.deliver` lifecycle (wire the uncalled Cortex path; implement the daemon RAM-hold
  + zeroize half).
- **I-c** Per-step screenshot capture on the daemon → map `observation.screenshotB64` through
  `server.ts:679` into the existing screenshot plane. **Feeds convergence S1 (evidence model) directly** —
  browser-steps evidence on the bridge lands here.

**Track II — the single human stop** (closes G2, G3; independent of Track I, both feed the acceptance run)
- **II-a** A `needs_credentials` pause: a run that resolves a browser-steps action to an origin with no
  Cofre item/grant halts in a new pause class carrying the origin + a portal deep-link.
- **II-b** Auto-resume: an observer on Cofre item-mint / grant-issue / session-establish that resumes the
  waiting run (the `resumeRun` flag exists; the trigger does not). **Depends on the run loop calling
  `ensureSession`/`checkoutSession` — today only Citius does.**
- **II-c** OTP: the relay's server half (issue `RelayPrompt` on a paused login, intake `CompleteRelay`, a
  fixed typed-code primitive) + a recipe shape that allows an OTP field / passwordless login +
  `ubereats.com` recipe entry. Honors the approved re-auth policy: silent re-auth under a standing grant
  when no OTP; always pause for a human when OTP is involved.

**Track III — discovery → capture → replay** (closes G4, G5, G6; the engine's new spine)
- **III-a** Network-capture layer: CDP `Network` domain (or Playwright request/response listeners) recording
  endpoints/headers/token-bearing requests/JSON shapes during a vision-driven run, redacted through the
  existing `SecretRegistry` before anything persists.
- **III-b** Vision-first discovery phase + its re-plan budget (knob (b) lands here) → produces a candidate
  recipe.
- **III-c** CDP call-injection replay step type: a `Runtime.evaluate` fetch inside the authenticated page,
  compiled from captured calls; the executor picks cheapest-reliable (replayed internal call → scripted DOM →
  vision fallback). Second-run determinism (already real for DOM cache) extends to this form.
- **III-d** Self-heal: a run-level goal-verify gate that, on drift/failure, re-enters III-b and supersedes the
  action definition (the copy-on-author + `supersedes` machinery exists in integrations; wire it to a heal trigger).

**Track IV — locality + adversarial realism** (closes G7, G10; safety + the target-fitness lever)
- **IV-a** Wire `resolveEgress` + `offlinePolicy` at `getBrowser`/`chromium.launch`; map `awaiting_daemon`
  through the schedules supervisor to a **blocked** run + notify (closes the D-3/D-4 divergence). Retry knobs
  (a) and (c) land alongside.
- **IV-b** Fingerprint/realness for the bridge browser (real Chrome channel or stealth context; consistent UA;
  no `webdriver` tell). Residential egress only where a bridge is genuinely unavailable and the origin is
  permissive. Adversarial targets: bridge-only, never datacenter.

**Track V — the acceptance run** (the proof; strictly last)
- Depends on I + II + III (+ IV for realism). Slots **after convergence Wave 1's S2 detail page** so the
  discovered action, its steps, evidence, and runs are all visible in the converged Integrations surface.
  The end-to-end Uber Eats read-only flow with the single credential stop is the completion gate — the exact
  proof the follow-up task must produce.

**Load-bearing vs cosmetic, for sequencing:** Tracks I + II are load-bearing and independent — they can run
in parallel and both are prerequisites for any acceptance run. Track III is the largest and the true engine
work; it depends on I-a (a real browser to capture from). Track IV is safety + realism and can lag until the
first end-to-end run exists to harden. Track V is the gate.

**Relationship to the convergence plan:** none of this conflicts with Waves 1-4; it *extends* them.
S1 (evidence) is where I-c lands; S2 (detail page) is where the discovered action and its runs surface;
the achieve reuse ladder (S4/S5) is unaffected because discovery mints browser-steps actions, not authored
api-call ones. The convergence hide-slice (S7/S8) should not hide Automations until Track I gives browser-steps
actions a real execution home, or the acceptance target loses its only non-datacenter surface.
