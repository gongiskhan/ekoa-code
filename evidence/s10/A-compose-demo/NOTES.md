# Leg A - the under-40 compose demo, and the destructive-goal refusal

Stack: main @ d6f4357, API `built` mode on :4211 behind the :4111 CORS proxy, web on :3000.
Caller: `admin` (super-admin) with a platform JWT. Date: 2026-08-23.

## What was set up first, and through which product path

1. **The legal spine** (`clientes`, `processos`, ...) was seeded exactly the way the committed e2e
   `global-setup` seeds it - by opening `/apps/legal-nucleo/` in a real browser and letting the app's
   own `seedCollectionIfEmpty` run. 6 clientes / 8 processos / 1 kyc_ficha.
2. **The two fields the compose rung needs** were then written onto those same `clientes` rows
   through the app's own shared-data plane (`window.__ekoa.shared.update`, i.e. the served-app
   `PUT /api/app-data/clientes/:id` route) - never by touching Mongo:
   - `idade`: 31, 52, 39, 40, 25, 61 (chosen to straddle 40 so a narrowing would be observable)
   - `numeroProcesso`: the case number of the `processos` row that references that client.
   This is the join direction the committed canonical suite pins
   (`api/tests/integrations/citius-processos-ladder.test.ts`): the CALLER'S collection carries the
   case number and the age; the action's rows carry `processo`.
3. **CITIUS was connected through the real UI** - the card's "Configure as credenciais para ativar"
   form on `/integrations`, cedula `12345`, mandatario "Dra. Marilia Costa". No portal session was
   ever established (that needs the Ekoa bridge on a machine with the certificate/card reader).

## A1 - the canonical goal

`POST /api/v1/integrations/citius/achieve` with
`{"goal":"todos os processos de clientes com menos de 40 anos"}` -> `achieve-under40.json`
(headers, including the 200, in `achieve-under40.headers.txt`).

```json
{
  "outcome": "executed",
  "actionName": "processos",
  "result": { "success": true, "status": 200,
    "data": { "processos": [], "origem": "citius-notificacoes-sincronizadas",
              "sincronizacao": { "marcaDagua": null, "notificacoesGuardadas": 0 } } },
  "ladder": [
    { "rung": "parametrize", "verdict": "skipped",
      "detail": "the caller supplied every argument the action declares" },
    { "rung": "compose", "verdict": "skipped",
      "detail": "\"processos\" returned no rows, so there is nothing to narrow" },
    { "rung": "reuse", "verdict": "taken" }
  ]
}
```

### PROVEN

- The deterministic matcher picked `processos` from the goal text alone - no model chose the action.
- The **whole ladder travels on the 200**, with a distinct verdict and a plain-language reason per
  rung. `skipped` is used for both non-firing rungs and is correctly distinguished from `refused`
  (nothing was judged and thrown away) - the four-verdict vocabulary is live on the wire.
- **S9's tenant-read backing answers with the watermark rather than an error**: `marcaDagua: null` +
  `notificacoesGuardadas: 0` is the never-synced fact, stated. `origem` names the provenance. The
  action contacted nothing - no portal, no session, no credential decryption.
- The compose rung's cheap disqualification fires **before** a planning turn is bought: an empty row
  set costs zero model tokens, and the ladder says so in the platform's own words.

### FIRST RUN, BEFORE CITIUS WAS CONNECTED (kept, because it is the more interesting shape)

The identical call against a *disconnected* citius answered `outcome: "executed"` with
`result.success:false, code:"not_connected"` and the compose step reading
`"processos" did not succeed, so its own answer is returned unchanged rather than narrowed`. That is
the single-exit rule holding: a rung that could not apply did not convert the executor's own coded
failure into a refusal, and did not swallow it.

### NOT PROVEN by this leg

- **The compose rung was never entered end-to-end.** No planning turn ran, no `ComposePlan` was
  verified, no rows were narrowed, and `outcome: "composed"` was not produced. That needs a Citius
  session landing real notifications, which this headless box cannot establish. The narrowing itself
  is covered only by the committed suites, not by this evidence run.
- Nothing here says anything about whether the portal's inbox HTML parses.

## A2 - the destructive goal (new safety behavior)

`{"goal":"apagar todos os processos antigos"}` -> `achieve-destructive-refusal.json`, HTTP 200:

```json
{
  "outcome": "refused",
  "code": "read_only_match",
  "message": "this goal asks to apagar, and the only action that fits it - \"processos\" - can only read. Nothing here can carry out that change; name the action directly if you meant to read.",
  "candidates": ["processos"]
}
```

### PROVEN

- A goal whose verb is destructive, matched against a read-only action, is **refused rather than
  silently satisfied by a read**. Before this rung existed the same input answered
  `outcome: "executed"` - a claim the goal had been ACHIEVED - by listing processes.
- The refusal names the offending verb (`apagar`), names the action, says what it can do, and offers
  the honest escape hatch ("name the action directly if you meant to read"). `candidates` carries
  the matched action so a client can act on it.
- `refused` carries **no `ladder`**, which is the type's own construction rather than a convention:
  no rung produced an answer, so there is no rung to report.
- Nothing ran: no execute, no egress, no model turn.
