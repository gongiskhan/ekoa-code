# FLOW_PLAN — Local-Bridge Consumer Surfaces (run 20260711-053853-0c6e0041)

Source of authority: `docs/local-bridge-consumer-run-brief.md` (committed in S0a) + spec §12.6 (FC-400..FC-412), §17.9, ch18. Spec wins over brief prose. Locked decisions D1–D7 are binding; never-cut list applies (FIXED-1/2/13, derived-output-only, §17.9 ceiling, fake-daemon harness untouched, PT-PT, honest negatives).

**User constraint:** security-flavored work LAST — S7 (llm/-touching diagnostics) and S0b (owed retroactive Codex reviews of `2e3e199`, `d2c8463`) run at the end; S0b before S7 so review findings fix-forward inside the run.

**Planning decisions (autonomous):**
- Explore subagents were unresponsive; recon done inline (all brief "contract facts" re-verified 2026-07-11 against code — all hold). Plan-subagent phase skipped: the brief pre-locks the design.
- KEY DISCOVERY: the §12.6 surfaces already EXIST drafted+stubbed (`web/components/privacy/*`: attach menu, reference action 3 states, trust chip + panel, first-grant dialog, onboarding card, all six settings sections; all copy in `web/lib/privacy-claims.ts` with `CLAIMS_SHIP_GATED=true`). This run wires TRUTH into them, not new surfaces. Copy is NOT redrafted.
- D7 (stale model-tier defaults in `api/src/config.ts`) folded into S7 (batches the one llm/-adjacent adversarial review; env overrides already work).
- Grants/ledger daemon reads (S4): counterpart C1–C3 do not exist yet (verified: daemon `local-server.ts` serves only GET /status + /ledger?session=, no CORS, ephemeral port). S4 builds the web side against the wire shapes in `shared/src/ekoa-local.ts` (EgressLedgerRow), driven by an e2e stub daemon; against a real daemon it renders the honest unavailable/offline states until C1–C3 land. Flagged in `docs/bridge-counterpart-changes.md`, never silently assumed.
- S6 picker fallback (pre-authorized by brief): typed grantRef input (`g-…` + label) in the connected state until C4 lands — the CLI mints grants today; flagged, not silent.

## Slices

| id | title | kind | parallel group | status |
|----|-------|------|----------------|--------|
| s0a | Preconditions: brief committed, codex live, baseline green | infra | A (serial first) | pending |
| s1 | GET /api/v1/bridge/status (hosted, registry-only) | api+shared | B | pending |
| s2 | Presence wiring: poll S1 from use-bridge-presence | ui | C | pending |
| s3 | /settings/devices approval page | ui | C (disjoint from s2) | pending |
| s4 | Daemon-served grants+ledger sections + CSP | ui | D | pending |
| s5 | Trust chip data path: onLedgerRow buffer + audit join + masking summary | mixed | D (api files disjoint from s4) | pending |
| s6 | Reference attach: tokens → chat metadata → run context | mixed | E | pending |
| s0b | Owed retroactive Codex reviews (2e3e199, d2c8463) | review | F | pending |
| s7 | Diagnostics honesty (502-masks-401, lastProviderError, reason logging) + D7 defaults | api | F (after s0b) | pending |
| s8 | OPTIONAL cross-repo live e2e lane | evidence | G | pending |

Cut lines (brief, in order): s8 → s6-native-picker(already fallback) → s5-mask-join(bytes-only chip) → s7-compressed(classing+logging only). s1–s4 + claims discipline NOT cuttable.

## Slice detail

### s0a — Preconditions
`git add docs/local-bridge-consumer-run-brief.md` + commit. Probe codex liveness (`codex exec` trivial prompt; key present but last known 401 — if dead, `codex login` is operator-external → record blocker, S0b/S7-review becomes the blocker path, everything else proceeds). Baseline: `npm run ci:lane` + `gate:chokepoint` + `gate:garrison` + `gate:secrets` exit 0. Sibling `../ekoa-bridge` builds (`npm run build` there; integration suite is its own repo's lane — canary only).
Acceptance: brief committed; baseline commands exit 0; codex verdict recorded in RUN_LOG.

### s1 — Hosted bridge status (D1)
- `shared/src/ekoa-local.ts`: `BridgeStatusResponse = { paired: boolean, live: boolean, pairingId?: string, lastSeenAt?: string }` + `bridgeStatus: { method GET, path /api/v1/bridge/status, auth 'user', response }` descriptor.
- `api/src/bridge/registry.ts`: `getPairingByOwner(ownerUserId)` via `bridgePairings.find({ ownerUserId, revokedAt: null })` (org check vs requester); in-memory `lastSeenAt` stamped in `markAlive`.
- `api/src/routes/bridge.ts`: GET `/status` (requireAuth): no row → `{paired:false, live:false}`; row + not live → `{paired:true, live:false, pairingId}`; live → `{paired:true, live:true, pairingId, lastSeenAt}`. Registry-only, NO daemon round trip.
- Contract tests (`api/tests/contract/`): three states + 401 envelope; SUITE_LEDGER + schema-coverage entry.
Acceptance: contract suite green incl. coverage gate; ci:lane green. Diagram: 11-delegation-security annotated (status read path) — or GATE note "presence read-path annotation".

### s2 — Presence wiring (FC-401 states, FC-405)
- `web/hooks/use-bridge-presence.ts`: poll `bridgeStatus` via `request()` every 12s (+ on focus; keep exported `BridgePresence` shape). Map: !paired→`not-installed`; paired&&!live→`offline`; live→`connected`. Fetch failure → last-known/honest `not-installed`? NO — failure of the HOSTED endpoint keeps previous state with stale flag internal; first-load failure = `not-installed` (honest negative).
- Consumers unchanged (SEAM promise): grants/bridge-status/ledger sections + reference action light up.
- Unit test (mapping + poll lifecycle, vitest fake timers). E2e `bridge-presence.spec.ts`: schema-validated stub of GET /api/v1/bridge/status; three states render in bridge-status-section + reference action; zero console errors.
Acceptance: all four consumers render all three states with no consumer diffs; e2e green.

### s3 — /settings/devices (D5)
- `web/app/(dashboard)/settings/devices/page.tsx`: authed page, `XXXX-XXXX` userCode input → `deviceApprove` descriptor (`{userCode}`; deny button optional per `DeviceApproveRequest.deny`). PT-PT formal copy (new operational strings in privacy-claims.ts style or local constants; no claims). Success/error envelope states.
- E2e with schema-validated stub + real-UI login; unit test for code normalization (uppercase, hyphen).
Acceptance: page reachable (nav entry not required by spec — CLI prints the URL), approve flow works against stub; e2e green.

### s4 — Daemon-served grants + ledger (FC-406/407; D2)
- `web/lib/bridge-local.ts`: loopback client, origin `NEXT_PUBLIC_BRIDGE_LOCAL_ORIGIN` (default `http://127.0.0.1:8765` — placeholder until C1 fixes the port; configurable). Zod-parse responses against `EgressLedgerRow` shapes from shared. Timeout ~2s; failure → honest section states (`grantsOffline` / `ledgerOffline` copy, already drafted).
- `grants-section.tsx`/`ledger-section.tsx`: when presence `connected`, fetch daemon `/grants` (C3 shape: `{grants:[{grantRef,label|path,createdAt}]}` — coded to the flagged contract, tolerant parse) and `/ledger?session=<current chat session>`; revoke POST → C3. Until counterpart lands: 404/network → unavailable state (never fabricated data). Grant paths/ledger rows NEVER sent to hosted API or persisted.
- `web/next.config.ts`: CSP `connect-src` gains the daemon origin (dev + prod env-driven).
- `docs/bridge-counterpart-changes.md`: C1–C5 recorded (C1 stable port; C2 CORS for app origins, keep 127.0.0.1 bind; C3 GET /grants + POST revoke; C4 picker+grant-mint endpoint; C5 compose-error surfacing) + the all-sessions-ledger note.
- E2e: node stub daemon on 127.0.0.1 (schema-validated rows: read/write/denial kinds) booted by the spec; sections render rows + revoke; zero console errors.
Acceptance: with stub daemon: grants+ledger render live data, revoke wired; without: honest offline states; CSP allows loopback fetch; no hosted persistence (grep + review).

### s5 — Trust chip + masking summary (FC-402/403/408; D3)
- api: `api/src/bridge/activity-buffer.ts` — bounded in-memory per-session buffer (cap ~200 rows/session, TTL ~15min, sweep; NEVER persisted, §18.2). `api/src/server.ts` wires `attachBridgeServer({ onLedgerRow })` → buffer.
- Join: in the chat run pipeline (`agents/chat.ts` where the delegation tool result returns): pull buffered rows for the turn's correlationIds (`result.ledgerRefs`), aggregate `LocalFileActivity {files[{path,range}], bytesOut, correlationId}`; mask counts joined from the anonymisation audit metadata (ch17 §17.6) by correlationId via an injected seam accessor (tier rules). Emit per-turn as a new `ChatRunEvent` variant `local_activity` (shared/src/events.ts — shared-touching ⇒ adversarial review) consumed into the in-memory message store; NOT persisted in session messages (transient display metadata, §18.2).
- web: `stores/orchestration.ts` handles `local_activity` → `message.metadata.localFileActivity`; mount `<TrustChip>` in main chat message rendering (`app/(dashboard)/chat/[[...sessionId]]/page.tsx`; builder chat-panel already mounts it).
- FC-408 masking summary: new hosted endpoint GET `/api/v1/privacy/masking-summary` (org/owner-scoped counts by entity class from the audit metadata store; never bodies) + shared schema + contract test; `masking-summary-section.tsx` fetches it (its `maskingPending` copy stays for the empty/gated case).
- CLAIMS stay ship-gated (`CLAIMS_SHIP_GATED` remains true — criterion 14; mask clause + custody panel render via GatedClaim as today). Chip may render bytes-only if audit join incomplete (spec cut-line) — but join is in scope.
- Tests: buffer unit (TTL/cap/never-persist), join unit, contract test for masking-summary + envelope, e2e `trust-chip.spec.ts` (schema-validated SSE stub streaming `local_activity`; chip renders read summary + bytes; gated claim placeholder visible; zero console errors). Diagram: 04 (event union) + 11 (buffer/join) annotated.
Acceptance: live-shaped stub turn renders chip with real numbers; buffer bounded+transient; masking summary renders counts; forbidden-phrase grep zero; adversarial review pass (shared/-touching).

### s6 — Reference attach (FC-400/401/411/412; D4)
- `shared/src/chat.ts`: `ReferenceToken = { grantRef: string, label: string }`; `ChatRunCreateRequest.references?: ReferenceToken[]` (shared-touching ⇒ adversarial review).
- web composer (chat page + builder chat-panel): reference-token state (chips with label + remove); `ComposerAttachMenu.onReferenceCreated` → token; send path includes `references`. Connected-state picker: try daemon picker endpoint (C4, flagged shape `POST /picker` → `{grantRef,label}`); when absent → typed-input dialog (grantRef `g-…` + label) per brief's pre-authorized fallback. First-grant dialog flow already built (FC-411). Legal onboarding card (FC-412) already mounted — verify acceptance only.
- api: `routes/chat.ts` passes `references` → `agents/chat.ts` run input → context line (PT-PT): `Autorizações locais ativas nesta sessão: g-x (label)…` injected in prompt assembly (`agents/context.ts`/chat.ts) so the model calls `delegate_to_local` with real refs (bind stays actor-side).
- Tests: shared schema contract test; api unit (context line renders refs; absent refs → no line); web unit (token add/remove/send payload); e2e `reference-attach.spec.ts` (stub status connected + stub create-run asserting `references` in request body; token flow through first-grant dialog; zero console errors). Diagram: 11 annotated (refs → context path).
Acceptance: token → send → context line proven by tests; fallback flagged in counterpart doc; adversarial review pass.

### s0b — Owed retroactive reviews
`codex` adversarial review of `2e3e199` (agents/ wiring) and `d2c8463` (llm/ metadata strip) diffs; findings fix-forward as normal slices-lets; verdicts in RUN_LOG. If credential dead after S0a remediation attempt → external blocker recorded.

### s7 — Diagnostics honesty (D6) + D7
- `api/src/llm/gateway.ts`: terminal provider 4xx (400 invalid_request, 401/403 auth, 402 billing) → typed non-retryable CONV-2 errors (distinct code, e.g. `PROVIDER_TERMINAL`), 5xx/network stay 502 retryable class. White-label user copy unchanged.
- `api/src/llm/credentials.ts`: `claudeAuthStatus()` gains `lastProviderError: { class, at } | null` (no bodies/secrets); surfaced via existing `/health.claudeAuth` (shared health schema updated if modeled + contract test).
- `api/src/bridge/provider.ts`: rejection `reason` (ProviderOutcome.reason) logged server-side (structured console, no payload echo).
- D7: `api/src/config.ts` model-tier defaults refreshed to current ids (env overrides preserved; tier weights re-checked vs billing config).
- Tests: unit classing matrix; health contract test; fake-daemon suite untouched+green. Adversarial Codex MANDATORY (llm/-touching). Diagram: 06 annotated if flow changed.
Acceptance: FINDINGS `502-masks-401` closed (entry updated); gates green; Codex approve.

### s8 (optional) — Live e2e lane
`scripts/e2e-live-bridge.mjs`: boots api (dev config) + `../ekoa-bridge` daemon (pair via device flow) + playwright spec `live-bridge.e2e.ts` (env-gated `LIVE_BRIDGE=1`, ledger-scoped skip otherwise): login → pair → grant (CLI) → chat file-read → chip/ledger visible. Never a CI gate.

## Verification (every slice)
ci:lane + gate:chokepoint/garrison/secrets exit 0; contract test per new endpoint + non-2xx envelope; SUITE_LEDGER updated (ratchet holds); zero-console-errors in dashboard e2e; PT-PT/no-emoji; forbidden-phrase grep zero; diagrams updated or "no structural change" in the gate entry; checkpoint commit per slice (`feat/fix(...)` + RUN_LOG entry); Codex adversarial review where shared/llm/auth touched (s1 shared? — yes descriptor+schema ⇒ review; s5, s6, s7 mandatory).

## Critical files
- `shared/src/ekoa-local.ts`, `shared/src/chat.ts`, `shared/src/events.ts` — contract additions (S1/S5/S6)
- `api/src/routes/bridge.ts`, `api/src/bridge/registry.ts`, `api/src/server.ts` — status + buffer wiring (S1/S5)
- `web/hooks/use-bridge-presence.ts` — the SEAM (S2)
- `web/components/privacy/*` (existing consumers; minimal diffs only), `web/lib/privacy-claims.ts` (copy source; do not redraft)
- `api/src/llm/gateway.ts`, `api/src/llm/credentials.ts`, `api/src/bridge/provider.ts`, `api/src/config.ts` (S7)
