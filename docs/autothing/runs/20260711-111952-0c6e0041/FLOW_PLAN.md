# FLOW_PLAN — run 20260711-111952-0c6e0041 — Local-bridge UX completion (cross-repo)

Owner directive (2026-07-11, after watching the consumer-run walkthrough): pairing-code once is
fine; per-attach authorization ceremony is not. **Connected = trusted**: users select files and
folders visually — no typed codes, no typed paths. Add a browsing capability. Show the registo
(ledger) and every privacy section with real data. **The read-only restriction on `../ekoa-bridge`
is lifted for this run** ("work together with ekoa-bridge to finish this work") — the C1–C5
counterpart items are implemented there now, under that repo's own conventions (containment lint,
PT i18n, vitest, decisions.md).

Grounding: spec §12.6 (FC-400..FC-412), docs/bridge-counterpart-changes.md (C1–C5),
docs/local-bridge-consumer-run-brief.md (prior run), ekoa-bridge CLAUDE.md + eslint containment
rules (surface/ is fs-owning — browse may live there; realpath stays in the resolver).

## Locked decisions

- **D1 — In-app file browser replaces the native picker (FC-401 connected state).** The daemon
  serves `GET /browse` (loopback, CORS'd); the web renders a navigable folder dialog. The C4
  native-picker endpoint is dropped, the typed-reference dialog is REMOVED (it was the pre-C4
  fallback the owner rejected). Spec §12.6 FC-401 amended in the same unit of work.
- **D2 — Selection IS authorization.** Picking a folder (or file) in the browser is the grant
  gesture. FC-411 consent stays, first-time-per-session only (already so). No other ceremony.
- **D3 — Grants mint at SEND time, bound to the real chat session.** Picks are pending
  `{path,label}` tokens; on send the web mints grants via `POST /grants` with the resolved
  sessionId, then passes `references:[{grantRef,label}]` as today. Fixes the latent
  foreign-session denial (delegate binds `session=chat sessionId`; CLI grants were 'default').
  Selecting a FILE grants its parent folder — stated honestly in the consent copy.
- **D4 — Stable loopback origin `http://127.0.0.1:8791`** (config `surfacePort`, `--port`), CORS
  allowlist (`surfaceOrigins`, default `http://localhost:3000`), Host-header check (DNS-rebind
  guard), bind stays 127.0.0.1. CORS is not exposure.
- **D5 — Registo view = all-sessions ledger.** `GET /ledger` without `session` returns all rows
  (+session field); web shows newest-first with session labels resolved via api.sessions.list,
  per-session filter kept. Browse/serve surfaces stay read-honest: unavailable ≠ empty.
- **D6 — Claims ceiling untouched.** All new copy is operational PT-PT UX copy (no custody
  claims); CLAIMS_SHIP_GATED stays true; forbidden phrases stay absent.

## Slices

| id | repo | title | acceptance | status |
|----|------|-------|------------|--------|
| s0 | both | Preflight: codex probe, decision records, baselines | codex credential probed (owed gates recorded if dead); owner authorization + D1–D6 recorded in both repos' decision logs/RUN_LOGs; ci:lane green at start | passed |
| s1 | bridge | Stable port + CORS + Host check | surface binds 8791 (config+flag, recorded in config.json + /status.port); OPTIONS preflight + ACAO allowlist; non-loopback Host → 403; vitest suite; lint/build green | passed |
| s2 | bridge | Browser surface: grants + browse + all-sessions ledger | GET /grants (store+live), POST /grants {path,session,label?} mints into store AND live GrantTable (file→parent dir), POST /grants/revoke drops both, GET /browse?path within browseRoots (default home, dotfiles hidden), GET /ledger sans session merges all; vitest incl. containment edges | passed |
| s3 | bridge | C5 compose-error honesty | provider_response error body → honest PT note in delegation_result.answer (never ''); vitest | passed |
| s4 | web | bridge-local client v2 | browse()/createGrant()/revokeDaemonGrant()/fetchDaemonLedger(all) typed + tolerant; openDaemonPicker + typed-dialog code removed; unit tests | passed |
| s5 | web | File-browser reference flow | attach → browser dialog (navigate, breadcrumb, choose pasta/ficheiro) → FC-411 once → pending token chip → send mints grant(sessionId) → references in createRun; zero typed input; e2e vs schema-validated stub daemon | passed |
| s6 | web | Grants + registo sections live | grants list+revoke against daemon; ledger all-sessions default, session labels, kind labels, corrupt count; honest offline/unavailable states kept; e2e updated | passed |
| s7 | both | Spec amendment + diagrams + docs closure | spec §12.6 FC-401/§12.6.1 amended (in-app browser); diagrams 11 (+04 if shapes move) updated; bridge-counterpart-changes.md marked implemented (C1–C5→done); RUN_LOG both repos | passed |
| s8 | both | E2E: stub + live lanes | reference-attach/privacy-grants-ledger specs rewritten for browse flow; live-bridge.spec extends: browse→grant→presence (+ pairProc exit-race fix); full ci:lane + bridge vitest green | passed |
| s9 | ekoa-code | Run walkthrough video | re-recorded journey with the new UX (pair → connect → browse-pick → token → registo view), self-verified frames | passed |

Order: s0 → s1 → s2 → s3 → s4 → s5 → s6 → s7 → s8 → s9 (bridge before web; spec/docs after the
shapes settle; evidence last). Shared runtime serialized (one dev stack, one recorder).

## Cut lines (ordered) / never-cut

Cut candidates in order: s3 (C5) → all-sessions ledger merge (D5 falls back to per-session picker).
Never cut: FIXED-1/2/3/13 gates, claims ceiling (D6), honest degrades, the browse dialog itself
(the run's point), session-binding fix (D3), committed tests per slice.

## Blockers carried in

codex credential 401 (remediation `codex login`, operator-only) — adversarial gates recorded owed
if still dead. Model credential absent — live chat-leg still annotation-gated (LIVE_MODEL=1).
