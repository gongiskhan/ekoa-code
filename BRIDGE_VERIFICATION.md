# Bridge Ground-Truth Verification

**Date:** 2026-08-18 · **Subject:** `ekoa-bridge` (the local daemon) vs `ekoa-code/api/src/bridge` (the
Cortex-side server) · **Method:** six parallel read-only auditors, key facts re-run and re-read at the
cited lines by the main session. Read-only; nothing committed; build/test probes run locally and discarded.
**Measured against:** the interactive-executor target (persistent headed Chrome profile, driven step by
step, credential ceremony, network capture, CDP replay, secret transit) — stated for scoping, not built.
**Prior art:** VERIFICATION.md, CONVERGENCE_PLAN.md, COFRE_ENGINE_VERIFICATION.md. This report expands the
"no interactive browser executor on the user's device" fact that the last report made load-bearing.

---

## Headline

**The bridge is a separate, healthy, well-built repo — but it is a *file* daemon, not a browser daemon,
and its one mature capability is currently failing against production Cortex.**

Three findings dominate:

1. **It is a genuinely separate repo, and it is cleanly liftable.** `ekoa-bridge` imports nothing from
   ekoa-code at runtime, is chokepoint-clean, ESM/Node-20 like the monorepo, and syncs its wire contract
   by a *vendored copy + a drift test*. Moving it in is **moderate untangling**, and its home is a
   workspace package (`clients/bridge`), not `api/src/`.
2. **The executor surface is a file executor.** Seven Tier-1 file tools driven by a bounded JSON step
   runner — production-grade and heavily tested. Everything browser is either build-only (`browse`:
   headless, title/text, no click/fill) or the attended login ceremony (headed, captures `storageState`
   only). There is **no step-driving browser executor at all** — the daemon *deliberately refuses* the
   `tool.invoke` frame that Cortex's `DaemonBrowserSession` dispatches to.
3. **The bridge↔Cortex contract has drifted, invisibly, into a live break.** ekoa-code's Cofre landing
   (2026-07-29) added a per-pairing signing secret and a required `orgId`; the bridge never learned to
   fetch/store the secret, so `delegation.ts` now returns **`denied`**. The cross-repo integration canary
   has been red for ~3 weeks, and there is **no CI** to have caught it. This plausibly breaks real file
   delegations against current production Cortex, not just the tests.

The blunt verdict: **the bridge's own code is solid; its seam to Cortex is bit-rotted; and the entire
interactive-executor target is greenfield on top of it.**

---

## Verdict summary

Legend: **C** conforms · **P** partial · **D** diverges · **A** absent · **F** fact. ● blocks the interactive-executor target.

| Area | Item | V | |
|---|---|---|---|
| A | Separate repo, self-contained (ESM, Node 20, no cross-repo imports, chokepoint-clean) | **F** | |
| A | Contract sync = vendored wire copy + cross-repo drift test | **F** | |
| A | **Migration difficulty** | **moderate** | |
| B | Transport: outbound WS dial, backoff/jitter/heartbeat/half-open watchdog | **F** | |
| B | Auth: OAuth device-flow pairing; ephemeral per-dial bridge JWT; platform JWT in config.json (0600) | **F** | |
| B | Per-machine identity: a stable `pairingId` (hostname+rand) survives restart | **F** | |
| B | Bridge never reads the per-pairing signing secret → tasks rejected | **C**(gap confirmed) | ● |
| C | File tools (7) + bounded step runner + path jail | **C** | |
| C | Bash/terminal (Tier-2, allowlisted env) | **P** | |
| C | Headless build-only `browse` (title/text, launch-per-call, no interaction) | **P** | ● |
| C | Headed attended ceremony (human login → `storageState`) | **C** | |
| C | **Step-driving browser executor / `tool.invoke` execution** | **A** | ● |
| C | The engine: file-tool step runner, no browser/interaction verbs | **C**(as-is) | ● |
| D | One-time RAM-hold → inject → zeroize secret lifecycle (bridge side) | **A** | ● |
| D | No-disk: config.json holds tokens; no secret buffer persisted | **P** | |
| D | Zeroization / buffer scrubbing | **A** | ● |
| D | Bridge-side outbound-stream redaction | **A** | ● |
| D | Egress ledger records metadata only, never a value | **C** | |
| E | Build + typecheck + lint + CLI smoke | **C** | |
| E | Unit tests: 336/337 (skip 1); full 339/347 | **P** | |
| E | Cross-repo integration canary RED ~3 weeks (Cofre contract drift → live break) | **D** | ● |
| E | CI | **A** | ● |
| E | **Health verdict** | **rough-but-working; bit-rotted at the seam** | |
| F | Bridge captures no screenshots anywhere | **A** | ● |
| F | Wire `tool.result` frame has no screenshot/observation channel | **P** | ● |
| F | Cortex seam drops `screenshotB64` (real seam at `api/src/server.ts:676-680`) | **D** | ● |
| F | The screenshot plane itself is real and serves hosted runs | **C** | |

---

## A. Location, shape, migration

**Separate repo, cleanly self-contained.** `git remote` = `github.com/gongiskhan/ekoa-bridge`; own toplevel,
own `package.json` (`ekoa-bridge` v0.3.0, *"executor-only local daemon … No local agent loop (ADR-001)"*).
TypeScript ESM (`type:module`, NodeNext), `.nvmrc=20`, plain `tsc -b` (no bundler). Distributed as an
`npm pack` `.tgz` via GitHub Releases; installed globally on laptops (`install.sh`/`install.ps1`), paired by
device-code, `autostart on` writing a per-user macOS **LaunchAgent** (`gui/$UID`, `LimitLoadToSessionType Aqua`
— so the attended ceremony can put a *headed* browser on screen) or a Linux systemd user unit. CLI is
hand-rolled argv dispatch: `pair/status/serve/unpair/grant/autostart`.

**Coupling is minimal and deliberate.** Runtime imports **no** ekoa-code package (`grep` finds only
doc-comment provenance notes). Deps: `playwright, ws, zod, execa, @vscode/ripgrep, mammoth, pdfjs-dist`.
Contract sync is a **vendored copy**: `src/wire/contract.ts` is byte-copied from
`ekoa-code/shared/src/ekoa-local.ts @ ef786f8` (delegation section), guarded by `test/wire/drift.test.ts`
which imports ekoa-code's built dist when `EKOA_CODE_DIR` resolves and asserts canonical byte-parity. It is
**chokepoint-clean** (no `@anthropic-ai` / `api.anthropic.com`) — it never talks to a model provider (ADR-001,
Cortex is the only brain).

**Migration difficulty: MODERATE untangling.** The `src/` lift is clean; the snags are real but bounded:
- **Right home is `clients/bridge`, not `api/src/`.** The `clients/*` workspace + import-boundary zones + the
  chokepoint grep scope already exist (`cortex-cli` is the precedent). Placing it under `api/src/` would drag
  it into the anthropic import ban and the api-server build — wrong for a separate-process daemon.
- **Toolchain version skew is the biggest snag.** Bridge is on **ESLint 10 (flat config) + TS 6 + @types/node 26**;
  the monorepo is on **ESLint 8 (`.eslintrc.cjs`) + TS 5 + @types/node 20**. ESLint 10 dropped `.eslintrc`
  support, so one root `eslint .` can't lint both trees. Either migrate the root to flat config + bump TS, or
  downgrade the bridge to the monorepo toolchain, before it passes the root gates.
- **The vendored wire becomes a real `@ekoa/shared` import** — a *simplification* (deletes the copy + drift
  dance), but it must happen atomically with the move.
- **Playwright + a headed daemon must not bundle into the api server** — the package stays independently built
  and separately launched.

---

## B. Connection, auth, per-machine identity

- **Transport:** the daemon **dials out** (NAT-friendly) to `wss://…/api/v1/bridge/connect/:pairingId`; Cortex
  is the WS server (`api/src/bridge/server.ts:48`). Auth token is header-only, re-minted before every (re)dial.
  Full lifecycle: backoff 1s→30s with full jitter, a 10s stability window before reset, single-flight reconnect,
  30s app-level ping / 10s pong / 3-period half-open watchdog (`transport/bridge-socket.ts`).
- **Auth/pairing:** OAuth 2.0 Device Authorization Grant — the `XXXX-XXXX` is the device `userCode`. On approval
  the daemon stores a platform JWT (access+refresh) in `~/.ekoa-bridge/config.json` (0600). The **bridge token**
  is a second JWT class: ephemeral (600s TTL), minted per dial via `POST /api/v1/bridge/token {pairingId}`,
  never stored (`auth/bridge-token.ts`).
- **Routing:** `pairingId` is the addressing key end to end — token↔path match, jti spend, owner match, org
  resolved from the owner (never a body), then an in-memory `Map<pairingId, LiveConnection>`.
- **Per-machine identity already exists for preferential-bridge.** `pairingId` = sanitised OS hostname + a random
  4-byte suffix, persisted in `config.json`, **survives restart** (`pair.ts:23-26`, `serve.ts:73-86`), mirrored in
  Cortex's durable `bridge_pairings` row (`{pairingId, org, ownerUserId, capabilities?, egressEndpoint?,
  signingSecretCiphertext?}`). The `hello` frame advertises `machineName` + `capabilities[]`. **The
  preferential-bridge concept can build directly on `pairingId`** — a session captured on a machine can record
  that machine's `pairingId` as its preference; no new identity primitive is needed.
- **The signing-secret gap (Cofre re-verify — still holds, and it is load-bearing):** Cortex mints a per-pairing
  signing secret, signs every `DelegatedTask` with it, and *offers it back* in the token-mint response
  (`routes/bridge.ts:53-57`). **The bridge never reads it** — `mintBridgeToken` parses only `data.token`. Every
  signed task is therefore rejected at the first ordered check. This blocks *any* delegated executor, interactive
  or file.

---

## C. The executor surface (the crux)

**What is mature:** a **file executor**. Seven Tier-1 tools (`read/list/glob/grep/stat/write/extract_text`,
the last via mammoth+pdfjs) driven by `engine/engine.ts` `runDelegatedTask` — a *bounded step runner, not an
agent loop* (ADR-001) — parsing a JSON `TaskProgram` (`task-program.ts`, a zod discriminatedUnion over the seven
tools) through a single path-jail resolver, ledger, and egress cap. Production-grade, heavily tested.

**What is build-only:** the Tier-2 `browse` tool — `chromium.launch({headless:true})`, launch-and-close per call,
returns `{url, title, text}` only, **no click/fill/navigate-beyond-one-goto**, off by default, one smoke test. A
read-a-static-page probe, not a driven session.

**What is headed but single-purpose:** the attended ceremony — headed **bundled Playwright chromium**, human logs
in, `storageState()` snapshotted on a 2s interval and pushed back as a Cofre session item. Well tested. Captures
**only** `storageState`, never a screenshot, and the "done" signal is the human closing the window.

**What is ABSENT (the target):** a **step-driving browser executor**. Cortex's `DaemonBrowserSession` dispatches
each `PlaywrightAction` (navigate/click/fill/press/select/…/screenshot) expecting an observation envelope
`{kind:'page', screenshotB64, text, data:{url, domSnapshot, fingerprint}}` — the daemon **refuses the
`tool.invoke` frame outright** (`daemon-runtime.ts:73-88`, *"não implementado nesta versão"*), and the refusal is
deliberate (it would need the tier-2 gate, the I9 secret lifecycle, and evidence validation first).

**The gap to the target, precisely:** (1) a `browser` `tool.invoke` handler that runs `PlaywrightAction`s and
returns the observation envelope; (2) a **persistent headed context** (`launchPersistentContext + userDataDir`)
per owner/integration — today only ephemeral `newContext`; (3) a real Chrome channel (or hardened bundled
chromium) presenting a real device; (4) `storageState` **injection** into that context for a run — the capture
half exists, the inject half does not; (5) network capture + CDP replay (both absent per the Cofre report). This
is an entirely separate executor from the bounded, derived-output-only file engine.

---

## D. Secret transit + redaction (bridge side)

The Cofre report holds and is re-confirmed. On the bridge:
- **One-time RAM-hold → inject → zeroize is prose-only.** `secret.deliver` is a bare `break` that drops the
  payload (honestly: without storing, echoing, *or logging* the env-var names); its paired `tool.invoke` is
  refused, so there is nothing to inject into (`daemon-runtime.ts:89-94`). The lifecycle text lives only in the
  wire schema docblock. **ABSENT** as code.
- **Zeroization: ABSENT.** No `Buffer.fill(0)` / scrub anywhere (`bash.ts`'s `scrubbedEnv` *constructs* an
  allowlisted env; it wipes nothing). Node string immutability means a delivered secret couldn't be zeroized as
  a string anyway — a design note for the rebuild.
- **Outbound-stream redaction: ABSENT.** No redaction module on the bridge at all; frames are sent raw
  (`bridge-socket.ts`). All value-keyed redaction lives on Cortex's *ingress* side. Low-risk today (the daemon
  holds no delivered secret to echo), but the moment `tool.invoke` execution turns on, child stdout/stderr and
  browser observations cross back unredacted — so bridge-side redaction is a prerequisite of any executor, not a
  later polish.
- **Egress ledger records metadata only, never a value. CONFORMS.** Config.json persists tokens (0600); no secret
  buffer is written to disk.

---

## E. Health

**The bridge's own code is solid.** `typecheck` 0, `build` 0, `lint` 0, CLI smokes without pairing (PT-PT
`--help`/`status`), **336/337 unit tests pass** (1 skip) in ~16s; the published `latest.tgz` is byte-identical to
`0.3.0` and matches `package.json` — not stale. Node 20.19.4 matches. Last commit 2026-08-07 (protocol v2 +
attended ceremony + autostart).

**But it is bit-rotted at the seam — and the rot is a live break, not a stale test.** The full suite is
**339/347**; all 7 failures are the two cross-repo integration files (`round-trip`, `evidence`) — the canary that
boots real ekoa-code `api/dist`. I re-ran them: **7/10 fail with `expected 'denied' to be 'ok'`.** Root cause,
traced: ekoa-code commit `5e3d0d6` (feat(cofre), 2026-07-29) added (a) the per-pairing signing secret that
`delegation.ts` now requires, and (b) a required `orgId` on `DelegationActor`. The bridge harness — and, per the
`serve.ts:114` / `pair.ts:72` trace, **plausibly the live pair ceremony** — never fetches or stores the
per-pairing secret, so `serve()` verifies against `''` and every delegated task is denied. **This means the
bridge's one mature capability may be broken against current production Cortex**, and it went unnoticed because
there is **no CI** (`.github/` absent entirely).

**Health verdict: rough-but-working; bit-rotted at the seam.** Solid core, invisible contract break, zero CI.

---

## F. Screenshots + evidence (feeds convergence S1)

The designed pipe (daemon `observation.screenshotB64` → Cortex `DaemonBrowserSession` → `snap()` → screenshot
plane) is broken at **both ends plus the middle**:
- **Daemon: captures no screenshots anywhere.** `grep` for screenshot/screencast/`page.screenshot`/cdp over
  `ekoa-bridge/src` = zero image-capture hits. The ceremony captures `storageState`; `browse` returns text.
- **Wire: no channel.** `tool.result` = `{ok, output?, error?}` — no `screenshotB64`, no observation field. Even a
  captured screenshot has nowhere to ride (a structural gap the Cofre report didn't name).
- **Cortex seam: drops it.** The real seam is `api/src/server.ts:676-680` (the Cofre report's `bridge/server.ts:679`
  is stale) — it maps the daemon result into `observation.data` only and never sets `observation.screenshotB64`,
  so `DaemonBrowserSession.ingest` reads an always-empty `screenshotB64` for every bridge run.
- **The plane itself is real** (`automation/screenshot-plane.ts`: auth, tenancy, retention, `?token=` JWT) and
  serves hosted runs today. **What convergence S1 needs from the bridge is entirely upstream of it:** a browser
  step must actually execute on the daemon, capture a PNG, carry it over a new wire channel, and be un-dropped at
  the seam — none of which exists.

---

## Ranked gap list — what blocks the interactive-executor target first

**BG1 — The daemon refuses `tool.invoke`; there is no step-driving browser executor. (foundation)**
Everything else in the target stacks on this. `daemon-runtime.ts:73-88`.

**BG2 — The signing-secret gap breaks all delegation, interactive or file. (prerequisite + live bug)**
The bridge never reads Cortex's per-pairing signing secret, so every signed task is denied — the red canary and a
plausible production break. Fix: read `signingSecret` from the `/bridge/token` response, persist per `pairingId`,
handle rotation on re-pair. `auth/bridge-token.ts`, `serve.ts:114`, `pair.ts:72`.

**BG3 — No persistent headed real-Chrome profile. (the realism lever)**
Only ephemeral `newContext` on bundled chromium exists. Target needs `launchPersistentContext + userDataDir`, a
real Chrome channel, and `storageState` injection into it. Ties directly to COFRE_ENGINE_VERIFICATION G7 (fingerprint).

**BG4 — Screenshot capture + wire channel + un-dropped seam. (blocks S1 evidence for bridge runs)**
Three-part fix across both repos and the contract. Feeds convergence S1.

**BG5 — Bridge-side secret lifecycle: RAM-hold → inject → zeroize + outbound redaction. (safety, gates BG1)**
Must land with `tool.invoke` execution, not after — the moment steps run, unredacted output crosses back.

**BG6 — No CI. (why the rot was invisible)**
No gate runs typecheck/lint/unit/the cross-repo canary. Cheap to add; would have caught BG2 three weeks ago.

**BG7 — Network capture + CDP replay on the bridge. (the discovery pipeline)**
Absent (per the Cofre report); depends on BG1/BG3 existing first.

**Cosmetic / not load-bearing for the target:** the toolchain version skew (a migration chore, not a runtime gap);
`browse` being build-only (superseded by BG1/BG3); the stale `serve.ts` docstring; `revokePairing`-class dead code.

---

## Draft track skeleton (candidate slices — NOT the plan)

For Gonçalo's review. Ordering and effort are proposals; the real plan follows. Dependencies on the Cofre/engine
gaps (COFRE_ENGINE_VERIFICATION G1-G10) and convergence waves (S1 evidence, S2 detail page) named inline.

**Track 0 — de-rot + move in (do first; small, unblocks everything)**
- **B0-a** Fix the signing-secret handshake (BG2): daemon reads + persists the per-pairing secret; supply `orgId`
  in the integration harness; get the cross-repo canary green. This is also a **live production fix**, independent
  of any rebuild.
- **B0-b** Add CI to the bridge (BG6): typecheck + lint + unit + the cross-repo canary (with `EKOA_DRIFT_REQUIRED=1`).
- **B0-c** Move `ekoa-bridge` → `clients/bridge` as a workspace package (moderate untangle): reconcile the ESLint 10 /
  TS 6 skew, convert the vendored wire to a real `@ekoa/shared` import (delete `src/wire/contract.ts` + the drift
  test), keep it independently built and separately launched, add its `clients/*` import-boundary zone. Do this
  **after** B0-a so the canary proves parity across the move.

**Track 1 — the interactive browser executor (the foundation; COFRE_ENGINE G1)**
- **B1-a** A `browser` `tool.invoke` handler that runs the `PlaywrightAction` vocabulary and returns the observation
  envelope (BG1). Depends on B0-a (tasks must not be denied).
- **B1-b** A **persistent headed context** per owner/integration (`launchPersistentContext + userDataDir`), real
  Chrome channel, `storageState` injection (BG3). This is the realism lever for adversarial targets.
- **B1-c** The bridge-side secret lifecycle + outbound redaction (BG5), landing *with* B1-a.

**Track 2 — evidence + capture (feeds convergence S1 and COFRE_ENGINE G4)**
- **B2-a** Per-step screenshot capture on the daemon + a `screenshotB64`/observation channel on the wire + un-drop
  the Cortex seam (BG4). This is the bridge half of convergence S1's browser-steps evidence.
- **B2-b** Network capture under the driven session (BG7 / COFRE_ENGINE G4) — depends on B1 existing.

**Track 3 — locality + preferential-bridge (COFRE_ENGINE G7/G10)**
- **B3-a** Preferential-bridge: record the origin `pairingId` on a captured session; route adversarial sessions to
  their origin bridge; permissive/API integrations carry no preference. Builds directly on the existing stable
  `pairingId` — **no new identity primitive needed.**
- **B3-b** The needs-credentials pause + attended-ceremony-in-the-headed-window wiring (COFRE_ENGINE G2/G3) — the
  ceremony exists; connecting it to the run loop and OTP is the Cofre/engine track, with the bridge providing the
  headed window.

**Sequencing against the other plans:**
- **Track 0 is independent and urgent** — B0-a is a live production fix that stands alone.
- Track 1 is the foundation the whole COFRE_ENGINE execution plane (its Tracks I-III) sits on; B1-a ≈ COFRE_ENGINE I-a.
- **Do not run the convergence hide-slice (S7/S8) until Track 1 gives browser-steps actions a real execution home**
  — restating the constraint from COFRE_ENGINE_VERIFICATION: hiding Automations before the bridge can execute would
  strand the acceptance target's only non-datacenter surface.
- The move (B0-c) should precede heavy rebuild investment so new work lands in-tree under the monorepo gates, not in
  a separate repo that has to be moved later.
