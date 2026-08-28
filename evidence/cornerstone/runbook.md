# Cornerstone live acceptance - operator runbook

The mechanical loop is proven deterministically (see `SUMMARY.md`). This runbook completes the one
operator-gated leg: a REAL bridge daemon capturing a REAL browser's private API against the fixture
portal, through a REAL ceremony, then self-healing on drift. Run it on a machine with a display
(the ceremony opens a headed Chrome).

## 0. Prerequisites (once)
- On a machine with a browser. The bridge daemon and the ceremony need a real display.
- A model credential for the stack (an ekoa-account OAuth token, NOT Claude Code's own login):
  `claude setup-token` on any machine -> `sk-ant-oat...`.

## 1. Repack the bridge (the deployed daemon may predate captureOp)
```bash
cd clients/bridge && npm run pack:dist
```
This is the step the audit flagged as pending: a stale packed bundle refuses `captureOp` at its zod
boundary and the hosted run compiles NOTHING while reporting success. Repack first.

## 2. Boot a HEAD-build stack with the credential provisioned
```bash
# from the repo root, on the display machine:
CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat... node scripts/dev-credential.mjs --store --provision
npm run build --workspace shared && npm run build --workspace api
npm run dev            # boots api+web, auto-provisions, seeds brand
# confirm: curl -s localhost:4111/health | jq .claudeAuth  ->  {ok:true, configured:true}
```

## 3. Pair the bridge daemon and grant desktop.automation
- Start the repacked daemon and pair it to the running stack (Settings -> Devices in the dashboard,
  or the daemon's own pairing flow).
- Grant `desktop.automation` to the pairing. NOTE (audit): a re-pair silently drops the
  `desktop.automation` advertisement and an ephemeral-Mongo restart drops the server-side grant -
  re-establish BOTH after any restart, or capture/replay silently degrade.

## 4. Start the fixture portal (the login-gated "outside site")
```bash
node evidence/cornerstone/fixture-portal.mjs      # http://127.0.0.1:45180  (login: demo / demo123)
```
It serves: a login wall, a dashboard whose own JS fetches a private `/api/pedidos`, and (with
`EKOA_FIXTURE_BREAK=1`) the same API moved to `/api/v2/pedidos` - the drift the self-heal survives.

## 5. THE DEMO
1. **Free-text run.** In the dashboard, Integrações -> Minhas -> the "Automatizar um site" goal box:
   `listar os pedidos pendentes em http://127.0.0.1:45180/painel`. Submit.
   -> the plan mints a "Minha Integração" keyed `127-0-0-1-45180`; the page lands on its detail.
2. **Ceremony.** Run the minted action. It halts `needs_credentials` on the login wall; the banner
   deep-links the ceremony. Log in (demo / demo123) in the headed window; the session is captured.
   The run resumes and completes.
3. **Learn.** The post-ceremony re-run (or the next natural run) captures `/api/pedidos` and compiles
   a recipe - confirm the recipe badge appears on the action, "header names only".
   `curl -s localhost:4111/api/v1/integrations/recipes -H "Authorization: Bearer <tok>" | jq` shows
   the recipe with `calls: ["GET http://127.0.0.1:45180/api/pedidos"]` and no header VALUES.
4. **Zero-model replay, faster.** Run the action again. It replays with zero model calls; the run-now
   toast says "Respondida pela receita aprendida"; the detail page's recipe stats show the replay
   time vs the learned-run time.
5. **Self-heal.** Restart the fixture with `EKOA_FIXTURE_BREAK=1` (the API moves to `/api/v2/pedidos`).
   Run the action: the replay drifts (the old endpoint 404s), the next run re-learns, and the recipe
   supersedes (version bumps, lineage stamped). The detail page shows the new version.

## 6. Capture
Screenshot each of the five steps into `evidence/cornerstone/live/` and note the run ids. Then this
leg matches the deterministic proof, and the acceptance demo is whole.

## Honesty
If the daemon refuses `captureOp` (stale bundle) or the grant is missing, step 3 will complete the
run but learn NOTHING (no recipe badge) - that is the "unit-green while broken" failure mode the
whole build guards against. Verify the recipe actually appears before calling the demo done.
