# D2 live gate — PASS

Verdict: **PASS** (driver exit 0, final line `D2 LIVE GATE: PASS`). Gate authored by the lead: the gate worker rebuilt shared+api dist, rebooted the credentialed stack (boot-b), built a FRESH app-base sample app (post-15b230e scaffold, verifyBuilds off), wrote the driver (`api/tests/e2e/assistant-panel.e2e.mjs`), captured evidence, and applied the lead-directed console allowlist — then stalled; the lead ran the final clean re-run and wrote this verdict.

## Properties proven (real served app, real browser, credentialed stack)

- **A — panel mounts in the real bundle.** The launcher ("Assistente") is visible in the freshly-built served app: the React-18 async mount-timing fix (bounded animation-frame poll in `mount.js`) holds in the real esbuild bundle, not just jsdom. Screenshot `live-01-launcher.png`.
- **B — first-open message.** Clicking the launcher opens the panel; the three-capability PT-PT first-open message with the three example prompts and the Operar/Mostrar/Ensinar mode toggle is visible. Screenshot `live-02-panel-open.png`.
- **C — real assistant turn.** Typed a PT-PT question, sent: `POST /api/app-assistant` fired with `X-Ekoa-App-Id=66886258-3a5d-4863-ab60-ea9badc6058c`, status 200, and a real 1,059-char PT-PT reply rendered in the panel ("Esta aplicação é uma ferramenta de gestão de clientes simples…") — a genuine model call through the chokepoint, grounded and billed to the artifact owner. Screenshot `live-03-reply.png`.
- **D — zero non-benign console errors.** Strict console gate green after allowlisting EXACTLY two documented pre-existing platform behaviors (below).

Evidence: `evidence-live.cast` (asciinema, final clean run), `live-01..03.png`.

## Pre-existing platform findings (flagged, NOT fixed here)

Both surfaced by this driver's new strict console gate; both predate this run and fire on EVERY served app (C5's driver never asserted console errors):

1. `GET /api/app-sso/me` → **401** for an anonymous visitor. Emitted by the injected runtime's `whoami` (`api/src/apps/injected-context.ts:110`); the auth lib treats 401 as the normal "no visitor session" state, but the browser logs the failed resource. Candidate platform fix: return 200 `{user:null}` for anonymous (contract response is `z.unknown()`, so additive). → platform hardening list / H block.
2. `POST /api/app-health` → **502** through the dev proxy. Emitted by the injected health beacon (`injected-context.ts:244`). Candidate dev-proxy forwarding gap (relates to d55bd02's proxy hardening). → platform hardening list.

The driver allowlists exactly these two signatures (url + status match, comment citing the source line each); anything else still fails the gate.
