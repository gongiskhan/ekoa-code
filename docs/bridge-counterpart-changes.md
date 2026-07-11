# ekoa-bridge counterpart changes (flagged from the ekoa-code consumer run, 2026-07-11)

> **STATUS: IMPLEMENTED (2026-07-11).** All items below were built in `../ekoa-bridge` during
> the owner-authorized cross-repo run `20260711-111952-0c6e0041` ("connected = trusted; add a
> browsing capability; finish this work together with ekoa-bridge"), which lifted the read-only
> rule for that run. C1/C2 → `feat(surface): C1/C2` (bridge `a2f9866`); C3 → `feat(surface): C3`
> (bridge `9d7657e`) — note C4 (native picker) was **retired**, replaced by the in-app file
> browser reading `GET /browse` (owner directive; spec §12.6.1 amended); C5 → `feat(engine): C5`
> (bridge `cc7827b`). The web side now consumes the real shapes; the honest unavailable/offline
> states remain for older daemons. Kept for provenance.

Flagged contract corrections/additions the sibling `ekoa-bridge` repo needs so the §12.6
consumer surfaces built in ekoa-code (run `20260711-053853-0c6e0041`, brief:
`docs/local-bridge-consumer-run-brief.md`) work against a real daemon. Same discipline as
the daemon run's flags in reverse: recorded here, implemented by ekoa-bridge's own run,
never edited silently from this repo. The web side is coded to these shapes and renders
honest "unavailable/offline" states against a daemon that predates them.

## C1 — Stable loopback port

`startLocalSurface` binds an ephemeral port per `serve` (`src/surface/local-server.ts`,
`port = 0`). The browser cannot discover it. Needed: a configurable fixed default —
**proposed default `8791`** (config key + `--port` flag), recorded in `config.json` and in
`GET /status`. The web consumer reads `NEXT_PUBLIC_BRIDGE_LOCAL_ORIGIN`
(default `http://127.0.0.1:8791`) and adds the same origin to the dashboard CSP
`connect-src` (`web/next.config.ts`; `web/lib/bridge-local.ts`).

## C2 — CORS on the loopback surface

The surface sends no CORS headers, so a browser fetch from the app origin is blocked even
when reachable. Needed: `Access-Control-Allow-Origin` for the app origins (dev
`http://localhost:3000`, prod app origin — configurable list), `GET, POST` +
`content-type`, and `OPTIONS` preflight handling. **Bind stays 127.0.0.1-only; CORS is not
exposure** — the surface stays unreachable off-machine.

## C3 — GET /grants + POST /grants/revoke on the loopback surface

Today only `GET /status` and `GET /ledger?session=` exist. FC-406 needs:
- `GET /grants` → `{ grants: [{ grantRef, label?, path?, scope?, createdAt? }] }` — the
  session grant table, live.
- `POST /grants/revoke` body `{ grantRef }` → drop from the grant table; effective at the
  next grant resolution, not retroactive (§12.6.3).

The web client (`web/lib/bridge-local.ts`) is coded to exactly these shapes (tolerant
parse; unknown fields pass through).

Follow-up under C3 (flagged, lower priority): an **all-sessions ledger read**
(`GET /ledger` without `session`) — the FC-407 viewer currently drives a per-session
picker because the surface 400s without a `session` param.

## C4 — Picker endpoint — RETIRED, replaced by the in-app file browser

The native OS dialog (`POST /picker`) was **dropped** in favour of an **in-app file browser**
(owner directive, 2026-07-11: non-technical users pick visually, in the app, not via an OS
dialog round-trip). The daemon instead serves `GET /browse?path=` (loopback, CORS'd,
browseRoots-scoped, dotfiles hidden, symlinked dirs unwalkable) and the web renders the
navigable dialog; the pick is minted through `POST /grants` at message-send time. The typed
grantRef fallback is likewise retired. Implemented in bridge `9d7657e`; spec §12.6.1 amended.

## C5 — Compose error surfacing

A `provider_response` carrying an error body currently degrades to an empty compose answer.
The daemon should map typed provider errors (the CONV-2 codes the ekoa-code provider
endpoint emits after its diagnostics-honesty slice) to an honest PT-PT note in the
`delegation_result` instead of `answer: ''`.
