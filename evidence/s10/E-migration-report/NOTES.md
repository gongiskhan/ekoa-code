# Leg E - the S7 automation -> integrations migration report

`GET /api/v1/integrations/automation-migration-report`, as `admin` with a platform JWT.

## Before any automation existed - `00-before-provision.json`

```json
{ "mode": "report-only", "generatedAt": "2026-08-23T01:51:59.518Z", "scanned": 0,
  "truncated": false, "tiers": { "flatten": 0, "wrap": 0, "engineInternalBehindWrappers": 0 },
  "entries": [], "errors": [] }
```

A fresh dev stack holds no automations, so the honest report over it is an empty one - the endpoint
answers rather than 404ing or inventing rows. `mode: "report-only"` rides the artifact itself, which
is D3's promise restated by the thing it governs: nothing on this contract writes, renumbers or
deletes.

## After provisioning CITIUS - `01-provision-automations.json`, `02-after-provision.json`

`POST /api/v1/integrations/citius/provision-automations` created 4 automations, one per
browser-steps action (`notificacoes`, `processo`, `documentos`, `submissao`). The report then reads:

```json
{ "mode": "report-only", "scanned": 4, "truncated": false,
  "tiers": { "flatten": 0, "wrap": 4, "engineInternalBehindWrappers": 4 }, "errors": [] }
```

Every one of the four classifies identically, and the entries carry the reasoning rather than just
the verdict:

| automation | steps | tier | flattenRefusals | engineInternal | degradations |
| --- | --- | --- | --- | --- | --- |
| consultar notificações | 9 | `wrap` | `not-single-step`, `step-not-api-call` | `rehearsal-vision` | `mid-run-pause-collapses` |
| consultar processo | 8 | `wrap` | same | `rehearsal-vision` | `mid-run-pause-collapses` |
| documentos de um processo | 10 | `wrap` | same | `rehearsal-vision` | `mid-run-pause-collapses` |
| submeter peça | 10 | `wrap` | same | `rehearsal-vision` | `mid-run-pause-collapses` |

Each entry also carries `ownerUserId`, `visibility: "org"`, a `shapeHash`,
`destinationIntegrationKey: "citius"` and `source: { integrationKey, templateKey }`.

### PROVEN

- The S7 classifier runs over real rows on a live stack and puts the Citius sequences in the tier the
  plan predicted: **wrap**, with the engine-internal feature that keeps them there named
  (`rehearsal-vision`) rather than implied.
- **The refusals are stated, not inferred.** `flattenRefusals` says exactly why tier 1 does not
  apply - more than one step, and the steps are not `api_call`. A reader does not have to re-derive
  the classifier's reasoning from the tier name.
- **The known degradation is recorded rather than hidden**: `mid-run-pause-collapses` is on every
  entry, which is the plan's own admission that synchronous action semantics collapse a mid-run
  pause to a coded failure, carried on the artifact where a migration planner will actually see it.
- `truncated: false` and an empty `errors` array make the report's completeness explicit.

### NOT PROVEN

- **Tier 1 (`flatten`) was never exercised**: no single-step `api_call` automation existed on this
  stack, so `flatten: 0` here is an absence of input, not a demonstration that flattening works.
- Nothing was migrated. This is the report, and only the report - which is exactly D3.
