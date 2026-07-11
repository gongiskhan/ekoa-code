# Ekoa Code — Local-Bridge Consumer Surfaces Run Brief (FC-400..FC-412 + bridge diagnostics)

**Mission.** The ekoa-bridge daemon exists, pairs, serves, and executes chat-driven delegations (proven live 2026-07-10: a browser chat turn called `delegate_to_local`, the daemon read `contrato.txt` inside a grant, composed via the chokepoint, and the answer returned derived-output-only). What does NOT exist is everything the spec promises the **user** for this story: the web has no real bridge presence, no grants/ledger view, no reference-attach affordance, no trust chip, no device-approval page — and the bridge path's failure modes are invisible (three separate provider 4xxs surfaced as blank answers or "temporariamente indisponível" during the live run). This run builds the consumer half: **spec §12.6's FC-400..FC-412 block, the hosted plumbing they need, and the diagnostics honesty the live run showed is missing.**

---

## Context — what changed just before this brief (2026-07-10/11)

- `delegate_to_local` is now wired into chat/build runs (commit `2e3e199`: seam in `agents/seams.ts`, `delegateToolSpec` actor-bound, policy classes, root binding). It was spec'd (§5.4.8), diagrammed (11-delegation-security), mechanism-built — but never registered; the gap was found the first time a REAL daemon connected.
- Two masked-failure bugs were found live and fixed: the chokepoint forwarded its internal `metadata.session_id` to the wire → 400 that silently emptied every bridge compose answer (`d2c8463`); the daemon's compose body lacked `max_tokens` (ekoa-bridge `4bda1bf`). Both invisible to the operator — same disease as the open `502-masks-401` FINDINGS item.
- The daemon side (sibling repo `../ekoa-bridge`) is DONE for this story's spine: pairing (device flow), WS transport, S1–S6 security, file tools, egress ledger, loopback surface (`/status`, `/ledger?session=`). Counterpart gaps it still has are FLAGGED in this brief (see "Counterpart changes"), never silently assumed.
- Still true in web/: `use-bridge-presence.ts` is a hardcoded `not-installed` stub (its own SEAM comment says wire it here); `/settings/devices` is a 404 (the CLI pair flow points users there); `attachBridgeServer` is mounted with no `onLedgerRow` consumer (daemon `ledger_row` frames are dropped hosted-side); there is no REST read for bridge status (only `POST /api/v1/bridge/token`).

## Authority order (unchanged from the repo's standing rules)

1. `spec/` wins over code and over this brief's prose. The FC block is **spec/12-web-client-migration.md §12.6 (FC-400..FC-412)** — it carries verbatim PT-PT copy, per-item fates, and ship-gates. Do not redraft copy that section already fixes.
2. ch18 owns the wire/daemon contract; ch17 owns anonymisation + the §17.9 claims ceiling; ch03 owns endpoint naming; the **fake-daemon harness (`api/test/fake-daemon/` + `api/tests/fake-daemon/`) stays the executable wire contract** — it must remain green untouched.
3. The sibling `../ekoa-bridge` repo is this run's **read-only counterpart**: needed changes there are flagged contract corrections recorded in both repos' docs (it has its own owner/run), never edited silently from here.
4. Repo standing rules apply in full: FIXED-1/2/3/13 (lint + grep enforced), five-layer QA (contract test per new endpoint; adversarial Codex for llm/-, auth-, shared/-touching PRs), diagrams updated with structural changes, PT-PT strings, no emoji, claims discipline (§12.6 acceptance criterion 14).

## Preconditions (S0 — nothing else starts until these hold)

- **Codex credential restored** (`codex login` or a working key). Then run the **owed retroactive adversarial reviews**: `2e3e199` (agents/ tool wiring) and `d2c8463` (llm/ chokepoint metadata strip) — both merged review-less under a dead credential, recorded in RUN_LOG. Findings fix-forward before new slices.
- Full baseline green: `npm run ci:lane` + `gate:chokepoint`/`gate:garrison`/`gate:secrets`.
- Sibling `../ekoa-bridge` checked out and built (its integration suite runs against THIS repo's dist; keep it green as a cross-repo canary).

## Locked decisions

- **D1 — Presence is hosted-registry truth, polled over REST.** FC-401/FC-405's heartbeat state comes from a new `GET /api/v1/bridge/status` (owner-scoped): `{ paired, live, pairingId?, lastSeenAt? }` derived from the pairing registry (`getPairingById`/`isLive`/heartbeat). "Not installed" = no pairing row for the user; "offline" = paired but not live; "connected" = live. Web polls via the typed REST client (10–15 s). **No WebSockets in web** (FIXED-2; EventSource stays confined to `lib/api/stream.ts`).
- **D2 — Grants, ledger, and the picker are served by the DAEMON, read directly from the browser.** FC-407 is explicit: the ledger renders from data served live by the daemon, never hosted storage. The web reaches the daemon's loopback surface (`http://127.0.0.1:<port>`) directly; this needs counterpart items C1–C3 and a CSP `connect-src` addition for the daemon origin. Grant paths and ledger rows never transit or persist hosted-side.
- **D3 — Trust-chip data is transient, joined on correlationId.** Wire `onLedgerRow` at the composition root into a bounded in-memory per-session buffer (TTL minutes, never persisted — §18.2). Mask counts come from the ch17 §17.6 audit metadata. Join key: the daemon-minted correlationId (§18.5 S6 — already proven live). Surface per-turn to the client as a typed SSE event or turn metadata; spec cut-line honored: the chip may ship bytes-only, but the audit-join lands before any client-facing privacy demo (FC-402 note).
- **D4 — Grant refs reach the model through run context, not hand-typed chat text.** Reference tokens in the composer carry `{grantRef, label}`; the chat route passes them as message metadata; `agents/context.ts` injects one "autorizações locais ativas nesta sessão" line so the model calls `delegate_to_local` with real refs. (Today's UX — the user pasting `g-…` into the message — is the fallback, not the product.)
- **D5 — Device approval gets its page.** `/settings/devices`: authed input for the `XXXX-XXXX` userCode → `POST /api/v1/auth/device/approve` (endpoint exists). The CLI (`ekoa-bridge pair`) already prints this exact path.
- **D6 — Diagnostics honesty is in scope.** The open FINDINGS item `502-masks-401` plus the two live finds define the slice: the gateway must class terminal provider 4xx (auth, billing, invalid-request) as non-retryable typed errors distinct from transient 5xx; `/health.claudeAuth` gains a `lastProviderError` class (no bodies, no secrets); the bridge provider path logs rejection `reason`s (the `ProviderOutcome.reason` field exists and is currently dropped). White-labelling of user-facing text stays — operators get truth in health/logs, users keep the branded message.
- **D7 — Default model tiers refreshed.** `config.ts` defaults (`claude-sonnet-4-6`, `claude-opus-4-8[1m]`) are stale; the live run overrode via env. Refresh defaults to current ids, keep env overrides, re-check tier weights with billing.

## Slices

Each slice = code + tests (five-layer QA) + diagrams touched if structural + checkpoint commit; gates: suite green, typecheck/lint/chokepoint 0, contract test per new endpoint, Codex review where the QA table requires it.

- **S0 — Preconditions + owed reviews** (above). Gate: reviews closed, baseline green.
- **S1 — Hosted bridge status.** `GET /api/v1/bridge/status` (+ shared/ zod schema, contract tests incl. the non-2xx envelope; schema-coverage gate). Registry-only; no daemon round trip.
- **S2 — Presence wiring (FC-401 states, FC-405).** Replace the `use-bridge-presence` stub with an S1 poll; all four existing consumers (bridge-status, grants, ledger sections, reference action) light up with **no change to their own code** (the stub's SEAM promise). E2E with a schema-validated stub: three states render, zero console errors.
- **S3 — Device approval page (D5).** Small; unblocks the human pairing loop end-to-end in the UI.
- **S4 — Daemon-served grants + ledger (FC-406, FC-407).** Depends on counterpart C1–C3. Grants list with revoke (revoke effective next tool call, not retroactive); ledger viewer rendering the daemon's rows (read + write + denial kinds). CSP updated for the daemon origin. Export = named fast-follow, not this run.
- **S5 — Trust chip + masking summary (FC-402, FC-403, FC-408; D3).** `onLedgerRow` buffer → per-turn chip (bytes-out; then mask counts via audit join); the "i" custody panel (FC-403) with §17.9-ceiling copy (ship-gated strings stay disabled until their mechanism gate passes — criterion 14).
- **S6 — Reference attach (FC-400, FC-401 connected-state, FC-411, FC-412; D4).** Attach menu (Upload/Reference), picker flow against counterpart C4, first-grant dialog (verbatim copy in spec), legal-org onboarding card, grant-refs-into-context. If C4 slips, the connected state may ship with a typed-path/folder input instead of the native picker — flagged, not silent.
- **S7 — Diagnostics honesty (D6).** Closes FINDINGS `502-masks-401`; adds `lastProviderError`; logs provider rejection reasons. Adversarial Codex mandatory (llm/-touching).
- **S8 (optional) — Cross-repo live e2e lane.** Boot the sibling daemon against a dev api (the reverse of ekoa-bridge's integration suite): playwright drives login → pair → grant → chat file-read. Not a CI gate; a scripted, repeatable evidence lane.

**Suggested order:** S0 → S1 → S2 → S3 (thin, high-value spine) → S4/S5 in parallel → S6 → S7 → S8.

## Cut lines (in order, if the run must shrink)

1. S8 (evidence lane) — cut first.
2. S6 native picker → typed-path input (the rest of S6 stays).
3. S5 mask-count join → bytes-only chip (spec-sanctioned cut, but the join must land before any client-facing privacy demo, and NO claims copy enables without its gate).
4. S7 compresses to: terminal-4xx classing + reason logging only (health field deferred).
S1–S4 and the claims discipline are not cuttable.

## Never-cut

- FIXED-2 (no web WebSockets), FIXED-13 (chokepoint), FIXED-1 boundaries — lint/grep gates stay green.
- Derived-output-only: no raw local content, grant paths, or ledger rows in hosted persistence (FC-407; §18.2).
- §17.9 claims ceiling: no enabled string exceeds the A1 ceiling; forbidden-phrase grep = zero in shipped copy (criterion 14). Ship-gated copy ships disabled, never redrafted-around.
- The fake-daemon harness stays green and unmodified (wire lockstep with the real daemon).
- PT-PT formal register, no emoji, product name via its constant.
- Honesty: a state the system cannot prove (presence, join, claims) renders as its honest negative, never a fabricated positive — the presence stub got this right; keep it right.

## Counterpart changes required in ekoa-bridge (flagged — its own repo/run implements)

- **C1 — Stable loopback port.** The local surface currently binds an ephemeral port per `serve`. Needs a configurable fixed default (config + `--port`), plus the port recorded in `config.json`/`status` for discovery.
- **C2 — CORS on the loopback surface** for the web origins (dev `http://localhost:3000`, prod app origin) — bind stays 127.0.0.1-only; CORS ≠ exposure.
- **C3 — `GET /grants` (+ revoke action) on the loopback surface.** Today only `/status` and `/ledger?session=` exist. FC-406 needs list + revoke (revoke = drop from the grant table; effective next resolution).
- **C4 — Picker endpoint** (native folder/file dialog → mints a session grant → returns `{grantRef, label}`). The largest counterpart item; phase behind C1–C3.
- **C5 — Compose error surfacing.** A provider_response carrying an error body currently degrades to an empty answer; the daemon should map typed provider errors (the CONV-2 codes the provider endpoint already emits) to an honest PT-PT note in the result.

## Contract facts the slices code against (verified 2026-07-11)

- Pairing/presence sources: `bridge/registry.ts` `getPairingById`, `isLive`, `getConnectionByOwner`, heartbeat in `bridge/server.ts`.
- `ledger_row` frames reach `attachBridgeServer` deps as `onLedgerRow?(taskId, row)` — currently unwired at the root (`server.ts` passes only `resolveUserOrg`).
- Device flow endpoints (all live): `POST /api/v1/auth/device`, `/device/poll`, `/device/approve`.
- Bridge token mint: `POST /api/v1/bridge/token` (platform JWT → bridge token). No GET status exists yet (S1 adds it).
- Daemon loopback today: `GET /status` → `{paired, pairingId, org, cortexBaseUrl, connection}`; `GET /ledger?session=` → rows (read/write/denial kinds, correlationIds).
- Approved-commands endpoints for FC-409: `GET /automations/approved-commands`, `POST .../revoke` (§3.8.18) — unchanged, re-homed UI only.
- The delegation tool result already returns `ledgerRefs` + citations; correlationIds join daemon ledger ↔ hosted anon-audit (proven live, S6 of ch18 §18.5).
