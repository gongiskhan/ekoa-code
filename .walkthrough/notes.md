# Walkthrough notes — ekoa

## Flows that matter
- The build arc is THE product story: chat request -> [[EKOA_BUILD]] handoff -> building -> finished artifact -> preview renders -> follow-up change takes effect.
- Knowledge chat: a real legal question answered with corpus citations (262k-doc `_shared` corpus) is the differentiator; always show the citation.
- Automations plan-from-goal: goal in, real plan steps out.
- Brand research: run it, then PROVE persistence (org branding after reload / GET /org evidence panel).
- Integration-builder: chat handoff or panel -> generated package -> saved -> visible on /integrations.

## Captions
- PT-PT captions (the product UI is Portuguese; walkthroughs double as product material).
- Plain language; never internal codenames (no "chokepoint", "seam", "FIXED-n").

## Always show
- The verified result highlighted (the artifact rendering, the citation, the persisted branding), not just the submit.
- Evidence panels for persistence proofs (GET /org, GET /artifacts) with the proving line highlighted.

## Avoid on camera
- Login typing (use .walkthrough/auth.json storageState).
- Terminals, test runners (banned by the skill anyway).
- /users and /usage token figures are fine (demo instance), but never credentials/secrets screens.

## Selector gotchas (learned 2026-07-11)
- getByRole name matching is SUBSTRING: `button:Marca` also hits "Pesquisar Marca". Use `role:tab:X` for tabs, exact-CSS (`span:text-is("...")`) for step labels.
- `text:Passo 1` double-matches (span + wrapper div render the same text) and substring-hits "Passo 10+".
- Chat run-start signal: `[title="Cancelar build"]` (the queue button only exists when text is typed mid-run). Run-end: `[title="Enviar mensagem"]` reappears.
- /chat auto-resumes the latest session: DELETE walkthrough sessions via API before recording chat flows, else the empty-state composer never shows.
- Automations plan-from-goal AUTO-STARTS a rehearsal run on the editor: two Cancelar buttons mid-run (`button.ml-auto.border-red-300` is the activity-bar one); engine caches rehearsal step results across repeated runs of the same plan.
- Integration builder is a TWO-TURN handshake in chat: turn 1 the agent OFFERS ("Podemos construir uma integração com o {Serviço}. Queres que comece já?"), turn 2 the user confirms ("Sim, começa já...") → the [[EKOA_INTEGRATION_BUILD]] marker fires → the side panel mounts and generates. A single-turn "cria uma integração..." gets misclassified as an app build. Signals: offer `text:Queres que comece`; panel `text:Integration Builder`; ready `text:Integration package ready to save`; saved `text:está pronta`; card on /integrations `text:Countries`.
- Delete the created automation/session between takes (duplicate names → ambiguous asserts).
- Chat page has a persistent SSE: a `continue + speed:8` timelapse segment on /chat CRASHES ("produced no parseable result"). Use a `waitBefore` CUT (wait off-camera for the signal, then record statically) instead of timelapse on chat.
- AI-built integrations land under `/integrations?tab=plataforma` (NOT `?tab=minhas`, which is empty). The card `h3` is the displayName; the per-card "Mostrar mais" toggle is AMBIGUOUS (one per card) — scope to the card or skip expansion and prove actions via an evidence panel (GET /api/v1/integrations filtered).
- The chat→integration confirmation deterministically also spawns a failed app build (ledgered `integration-handoff-spurious-build`): keep the confirm+generate off-camera (cut) and feature the saved card + evidence to keep the video clean.
- BUILD walkthrough: recording a live 5-15 min build via `continue`+`waitBefore` on the chat page CRASHES (WS-heavy). Instead: (1) fresh chat segment shows the request + the working indicator — assert on `[title="Cancelar build"]` (stable while running), NOT the transient `text:Construindo app`; and keep the request SHORT (a long `fill` on the auto-resizing landing composer times out `pressSequentially`). (2) Title-card CUT. (3) A FRESH browser segment on `http://localhost:4111/apps/<artifactId>/` (the served app — permissive CORS, no dashboard SSE) shows the real built app rendering + interact + assert (use `text:IVA (23%)`, NOT `text:Total` which also matches "Subtotal"). (4) evidence panel: `curl /apps/<id>/` proves it is served HTML. Pre-build the artifact off-camera and hardcode its `/apps/<id>/` URL.
- 2026-07-11: five verified walkthroughs recorded (automations, knowledge, brand, integration, build). Gallery http://100.108.210.116:8099. Superseded/flagged takes pruned so only the 5 verified finals remain.

## Environment
- Stack via `node .claude/skills/run-ekoa-code/driver.mjs up` (web :3000, api proxy :4111). Login admin/tmp12345 lands on /chat.
- API serves dist: after api/src changes, rebuild + restart + re-provision credential before recording.
- Dashboard keeps a persistent SSE (notifications + chat streams): prefer selector waits over networkidle-ish settles; settle each fresh page with a waitFor before its first caption beat.
- Real model runs: chat legal answer ~60s; builds take minutes (use continue + speed/waitBefore); brand research ~1-2 min.

## Operator-suite lessons (2026-07-14, 3 verified walkthroughs: panel / edit-mode / pedidos)
- Fresh app-base apps are PRIVATE: plain /apps/<id>/ 410s until `PATCH /artifacts/:id {shareable:true}`; `visibility:'org'` additionally gates change-request filing + org-admin edit (both needed for the operator flows).
- `POST /users` WITHOUT orgId puts the user in a NEW org - pass the admin's orgId explicitly (request-changes-journey pattern) or the pedido file 404s on cross-org isolation. Re-mint the auth state after recreating a user (the JWT carries sub+orgId).
- Panel auth on :4111: craft storageState with `ekoa_token` on BOTH origins (:3000 + :4111) and strip `ekoa_orchestration` (stale session pointers 404 on camera). `playwright-cli state-save` resolves relative to the CALLER cwd - use absolute paths.
- Recorder gotchas: `goto` paths inside continue segments MUST be absolute URLs (relative never navigates, beats fail downstream); a goto INSIDE a recorded segment poisons the NEXT continue segment's reattach ("produced no parseable result") - make the following segment FRESH (re-open with authState) instead; `text:X` waitFors can match a CLOSED select's option text (invisible - times out) - scope waits to `[data-testid=...] tr:has-text(...)`.
- Edit-mode filming: the served page never auto-reloads after a patch run - approve/revert from the sha diff, THEN reload to show the effect; the post-RESTORE dist rebuild is LAZY (~60-90s) - bridge with a speed-8 continue segment of captioned reload cycles; generated task apps HIDE bulk buttons on an empty list - seed a row before asserting them.
- Pedidos queue keeps take residue - dismiss stale open pedidos (POST /change-requests/:id/dismiss) between takes; the chat-refusal pedido carries the AGENT-drafted build description, not the user's literal message (by design).
- This stack's patch runs took ~2-8 min (faster than the 12-17 min worst case); build the request text to name button labels in quotes so asserts are deterministic.
- Stack ops: the model credential is per-boot (`provision-credential.mjs` with the token from ~/.config/ekoa/claude-credentials.json accessToken); panel-runtime.js and action-runtime-client.js are cached in memory at first serve/boot - asset fixes go live only on restart (restart wipes the DB: rebuild fixtures + re-provision + re-mint auth).
