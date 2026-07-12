# Slice D3 — scripted three-mode + operate-loop live gate

One committed, re-runnable driver — `api/tests/e2e/assistant-modes.e2e.mjs` — that proves the
operator assistant's THREE MODES end-to-end plus the operate-loop properties D2's gate deferred,
live in a real served `app`-base app driven by a real Chromium on the credentialed boot-b stack.
No product source was touched: D3 is a test-only slice (the panel/endpoint/runtime it exercises
are C3/D1/D2 code, already landed).

## What the gate proves (all live, real model calls through the llm/ chokepoint)

1. **DO (Operar).** "Adicione um cliente chamado Ana" → server infers mode `do`; the response
   carries ≥1 action; the panel dispatches it through `window.__ekoaActions.execute`; the C3
   runtime VISIBLY drives it — the target field's value becomes "Ana" in the DOM and transient
   runtime UI (highlight ring / driving badge, `[data-ekoa-actions-ui]`) appears; the panel renders
   the "Ação executada." result line. Screenshot `live-01-do-highlight.png`.
2. **DESTRUCTIVE confirm-before-dispatch.** The declared destructive action shows the PT-PT
   confirmation card ("Confirmar ação: Apagar todos os clientes") and does NOT run before the user
   confirms (sentinel un-run), then runs only on Confirmar. Screenshot `live-02-confirm.png`.
3. **PAUSE-ON-USER-INPUT.** With an action executing and another queued behind it, a REAL
   (`isTrusted`) user click cancels BOTH; the queue does not continue (the queued setField never
   overwrites the field, which stays "Ana").
4. **SHOW (Mostrar).** "Dê-me uma visão geral da aplicação" unpinned → `response.mode === 'show'`
   (server inference), reflected on the panel toggle; non-empty reply.
5. **TEACH (Ensinar).** "Ensine-me passo a passo como criar um cliente" unpinned →
   `response.mode === 'teach'`, reflected on the toggle; a step-structured reply. Screenshot
   `live-03-teach.png`.
6. **CITED.** A domain question grounds on real org knowledge → non-empty `citations`; the panel
   renders the "Fontes" block. Screenshot `live-04-fontes.png`.
7. **Zero non-benign page JS console errors** throughout, using the SAME documented allowlist as
   the D2 driver (anonymous whoami 401 + dev-proxy app-health 5xx).

Final driver line printed only when ALL hold: `D3 LIVE GATE: PASS`.

## Determinism strategy (why this gate is re-runnable, not flaky)

A committed gate cannot depend on what a given model generation produced. Three sources of
non-determinism were removed at the seams, leaving the model calls asserted only on STRUCTURE:

- **The operate surface is CONTROLLED, not scraped.** After building one fresh app-base app, the
  driver `PATCH`es a known action manifest onto the artifact data bag
  (`PATCH /api/v1/artifacts/:id` with `{ data: { actionManifest } }` — `patchArtifact` MERGES the
  data bag, so `appUrl` etc. survive, and `actionManifest` is not a reserved key). The manifest is
  REAL: the app-assistant admission middleware reads `art.data.actionManifest` and validates it
  against the shared `AppActionManifest` contract on EVERY request. It declares a non-destructive
  `setField` (`adicionar-cliente` → target `d3-nome-cliente`) and a destructive `custom`
  (`apagar-todos-clientes`). The matching `data-demo-target` landmark is planted in the served page
  as a direct child of `<body>` (React never reclaims it), exactly the C5 action-registry technique.
- **The destructive-confirm and pause properties are driven DIRECTLY through the same-document
  `window.__ekoaActions` API the panel itself uses — no model call.** This is the lead's evident
  intent (the model budget covers do/show/teach/cited + one retry; pause is a *synthesized*
  interaction, not a turn) and it makes those two properties fully deterministic while exercising
  the identical runtime executor the panel drives.
- **Mode assertions ride the SERVER's deterministic classifier**, not the model. `inferMode`
  (app-assistant.ts) is a keyword classifier: "visão geral" → `show`, "passo a passo"/"como " →
  `teach`, everything else → `do`. The driver never pins a mode (never clicks a mode button), so the
  server infers and echoes it; the panel reflects `response.mode` on the toggle. The assertions are
  on the echoed mode + the reflected toggle label, never on model prose.
- **Only the DO turn depends on the model emitting a structured action** (the one irreducibly
  model-driven step). It carries ONE retry (the field-fill + action-present check); the other turns
  assert deterministic properties (mode echo, citation presence). Model-call budget: at most 5
  (do[+1 retry], show, teach, cited).

## Key mechanics

- **Response bodies captured per turn** via `page.waitForResponse(POST /api/app-assistant)` set up
  BEFORE the send, so `response.mode` / `actions` / `citations` are read deterministically rather
  than scraped from the DOM.
- **Runtime UI observed** by a `MutationObserver` installed before the DO send that flags any
  `[data-ekoa-actions-ui]` node — the highlight ring and driving badge auto-clear (~2.5s), so a
  MutationObserver is the reliable way to prove they appeared without racing the timer.
- **Destructive sentinel** (C5 technique): `window.__ekoaApp.actions['apagar-todos-clientes']` is a
  flag-flipping stub; the gate asserts it is un-run while the confirm card is up and run after
  Confirmar. Clicks on the confirm card do NOT trip pause-on-user-input (the runtime ignores events
  on its own `[data-ekoa-actions-ui]` surface — verified in action-runtime-client.js `onUserInput`).
- **Pause proof of "queue does not continue":** the queued action is a setField that WOULD overwrite
  the field to a sentinel value; after the trusted click both promises resolve
  `{status:'cancelled', detail:'user-input'}` and the field is still "Ana".
- **Console allowlist** (`benign()`) is copied VERBATIM from `assistant-panel.e2e.mjs` — the two
  pre-existing platform signatures (whoami 401 `injected-context.ts:110`, app-health 5xx
  `injected-context.ts:244`); every other console error fails the gate.

## Observed on the green run

- The DO turn's model reply: *"Vou adicionar o cliente 'Ana' ao registo. Preenchi o campo de
  registo com o nome 'Ana'…"* — a genuine grounded PT-PT turn; the runtime drove the field to "Ana".
- CITED returned 5 citations — the boot-b owner org already carries a legal corpus
  (jurisprudência / legislação), so grounding surfaced those; the driver ALSO seeds one
  `manual-interno` doc so a hit is guaranteed regardless of corpus state. The assertion is on
  `citations.length > 0` + the rendered "Fontes" block, so it holds either way.
- Grounding is unconditional for `kind:'chat'`, so the DO turn ALSO rendered a "Fontes" block
  (visible in `live-01`); harmless — an extra, correct affordance.

## Validation

- `node --check api/tests/e2e/assistant-modes.e2e.mjs` — clean.
- Full green run on the credentialed boot-b stack (health `claudeAuth.ok`, oauth):
  `D3 LIVE GATE: PASS` (see `live-output.txt` and `evidence-live.cast`). Every PASS line + the four
  screenshots captured.

## Diagram note

No structural / data-shape change: D3 adds a test driver only. The nodes it exercises
(`POST /api/app-assistant`, the C3 runtime, the D2 panel) are already in the diagrams. No diagram
update required — lead to confirm per FIXED-12.
