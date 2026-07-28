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

---

# Second flag round — Cofre J-2 (2026-07-28)

> **STATUS: OPEN.** Flagged from ekoa-code's Cofre run; NOT implemented in `../ekoa-bridge`. The
> Cortex side of J-2 landed without needing any of this, and a current daemon keeps working
> unchanged — C6 is verified compatible, C7 is the part that needs the counterpart.

## C6 — No change needed, recorded so the next daemon change does not break it

Bridge connect tokens are now **single-use**: each carries a `jti` and the connect path spends it
exactly once (`api/src/bridge/connect-nonce.ts`). A replay is refused `token-replayed` and, most
importantly, does **not** evict the live socket.

The shipped daemon is already compatible and this was verified by reading it, not assumed:
`src/transport/bridge-socket.ts` calls `getToken()` immediately before **every** (re)dial and
`src/auth/bridge-token.ts` mints over HTTP with **no caching**. Recorded here because the
compatibility is a property of that behaviour: **a daemon that starts caching its bridge token
for the token's 600s life would connect once and then fail every redial with `token-replayed`.**
Mint-per-dial is now load-bearing, not an implementation detail.

Also: the `?token=` query-string fallback on `/api/v1/bridge/connect/:pairingId` is **removed**.
The daemon already uses the `Authorization: Bearer` header, so nothing changes for it; any
out-of-tree tooling still using the query form breaks deliberately (a URL-borne token is written
to every proxy and access log along the path).

## C7 — Connect-token proof-of-possession (the remaining half of J-2)

Single-use narrows the replay window from "the token's full 600s" to "a race the attacker must
win against the real daemon's own dial". That is a large reduction and **not** a closure: an
attacker positioned to capture the token in transit (a compromised proxy terminating TLS) can
still race and win, and the prize is the daemon's socket.

Closing it needs the daemon to prove possession of something the token alone does not carry, which
is a two-repo change and therefore flagged rather than built:

- the daemon generates a keypair at pair time and registers the public key (it already stores a
  per-pairing signing secret from R-8 — `config.json` today, OS keychain under J-8, which should
  land first so the new private key is not written to disk in cleartext);
- `POST /api/v1/bridge/token` accepts a client nonce/public-key binding and Cortex embeds the
  binding in the token's claims;
- the WS upgrade carries a signature over `(jti, pairingId, timestamp)` that Cortex verifies
  against the registered key before spending the nonce.

Until C7 lands, the honest statement of the property is: a captured bridge token is single-use and
must beat the legitimate daemon to the socket, rather than being freely replayable for ten minutes.

## C8 — `confirmed` should stop being a boolean the sender can set (J-7)

`src/tools/write.ts` step 2 gates a first write on `pre.confirmed === true`, and the file's header
says the user assents Cortex-side. Nothing Cortex-side checked it, and ekoa-code's tool description
**instructed the model to set it** — so, because Cortex signs the model's TaskProgram verbatim, the
signature laundered a model self-assertion into an authorisation the daemon trusts.

**Closed from the ekoa-code side, and the daemon needs no change to be safe today**: Cortex now
refuses to sign any task whose `write` step carries `confirmed: true` without a matching owner
approval (`api/src/bridge/write-approval.ts`), and the model is told the field is not its to write.
Since Cortex is the only signer of delegated tasks, that is sufficient.

**Flagged as defence in depth**: the daemon currently trusts a boolean in a message it received.
Preferred shape is a Cortex-issued, per-file approval token — signed with the pairing secret
(already present since R-8), naming `{grantRef, relPath, sha256Before, expiry, nonce}` — that the
daemon verifies instead of reading `confirmed`. Then a task that reaches the daemon without a real
user confirmation cannot be constructed by anything, not merely by anything well-behaved.

Note for whoever implements it: keep the daemon's first-write rule as-is until the token exists.
Removing the boolean check before the replacement lands would widen the hole rather than close it.
