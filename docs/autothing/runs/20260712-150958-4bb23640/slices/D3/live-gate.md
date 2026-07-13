# D3 live gate — PASS

Verdict: **PASS** (driver exit 0, final line `D3 LIVE GATE: PASS`). One committed, re-runnable
scripted gate — `api/tests/e2e/assistant-modes.e2e.mjs` — drives the operator assistant's three
modes plus the operate-loop properties D2 deferred, live in a REAL served `app`-base app, in a REAL
Chromium, on the credentialed boot-b stack (`/health` `claudeAuth.ok`, oauth). No product source
touched — test-only slice. Model-call budget honoured: 4 live turns on the green run (do, show,
teach, cited), with DO and CITED each carrying a 1-retry margin (≤6 total).

## Properties proven (real served app, real browser, credentialed stack)

- **DO (Operar).** "Adicione um cliente chamado Ana" → server mode `do`; response carried 1 action;
  the panel dispatched it through `window.__ekoaActions.execute`; the C3 runtime VISIBLY drove the
  planted target — its field value became "Ana" in the DOM and transient runtime UI
  (`[data-ekoa-actions-ui]` highlight/badge) appeared; the panel rendered "Ação executada."
  Screenshot `live-01-do-highlight.png`.
- **DESTRUCTIVE confirm-before-dispatch.** The declared destructive `custom` action showed the PT-PT
  card "Confirmar ação: Apagar todos os clientes" and did NOT run before confirmation (sentinel
  un-run); it ran only on Confirmar. Screenshot `live-02-confirm.png`.
- **PAUSE-ON-USER-INPUT.** With one action executing and a setField queued behind it, a REAL
  `isTrusted` click cancelled BOTH (`status:'cancelled', detail:'user-input'`); the queue did not
  continue — the queued setField never overwrote the field (still "Ana").
- **SHOW (Mostrar).** Unpinned "Dê-me uma visão geral da aplicação" → `response.mode === 'show'`
  (server inference), reflected on the toggle ("Mostrar" pressed); 658-char reply.
- **TEACH (Ensinar).** Unpinned "Ensine-me passo a passo como criar um cliente" →
  `response.mode === 'teach'`, reflected on the toggle; step-structured 1139-char reply. Screenshot
  `live-03-teach.png`.
- **CITED.** "Quantos anos de retenção estabelece a Circular Interna EKZ-7788…" → the SEEDED doc
  surfaced as a citation (asserted by its distinctive token in `response.citations`, not merely
  `citations.length>0`) and the model gave a real grounded answer — *"…estabelece dez anos como
  prazo de retenção dos documentos dos clientes [2][3]"* (NOT a refusal); the panel rendered the
  "Fontes" block. Screenshot `live-04-fontes.png`.
- **Zero non-benign console errors** — strict gate green after allowlisting EXACTLY the same two
  pre-existing platform signatures the D2 gate documented (below).

Evidence: `evidence-live.cast` (asciinema, clean run), `live-output.txt` (tee'd run), `live-01..04.png`.

## Determinism (why re-runnable, not flaky)

The operate surface is CONTROLLED: the driver PATCHes a known action manifest onto the artifact
(read + validated by the app-assistant admission middleware on every request) and plants the
matching `data-demo-target` landmark (C5 technique). Mode assertions ride the SERVER's deterministic
`inferMode` classifier (the driver never pins a mode). The destructive-confirm and
pause-on-user-input properties are driven directly through the same-document `window.__ekoaActions`
API the panel uses — no model call — so they are fully deterministic. CITED grounds on a seeded doc
carrying a distinctive reference token the query names verbatim, so it ranks #1 against the
authority-boosted ~200k-doc `_shared` legal corpus (verified offline against the live FTS index),
with the answer adjacent to the token so it survives grounding's 12-token snippet — the assertion
pins that seeded doc in `response.citations` and rejects a refusal reply. Only the DO and CITED turns
depend on model prose, each carrying one retry.

## Pre-existing platform findings (flagged, NOT fixed here — inherited from D2)

Both fire on EVERY served app and predate this run; the driver's `benign()` is copied verbatim from
`assistant-panel.e2e.mjs`:

1. `GET /api/app-sso/me` → **401** for an anonymous visitor (injected whoami,
   `api/src/apps/injected-context.ts:110`; treated as the normal "no session" state).
2. `POST /api/app-health` → **5xx** through the dev CORS proxy (injected health beacon,
   `injected-context.ts:244`; a dev-proxy artifact, not present same-origin in prod).

Anything else still fails the console gate.
