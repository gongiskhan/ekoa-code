# Leg C - the UI surfaces

Real-UI login as `admin`/`tmp12345`, Chromium at 1440x1000, Portuguese UI.

| File | What it shows |
| --- | --- |
| `C01-integrations-list.png` | The list page: platform integrations, the counters (Todas / Ativadas / Configuradas / Disponíveis), per-card connection state, and the CITIUS card carrying the bridge-absence line *"Nenhuma máquina ligada. Abra a Ponte Ekoa na máquina onde tem o certificado ou o leitor de cartões."* |
| `C02-citius-detail.png` | `/integrations/citius` - all six actions with backing chips (**Passos no navegador**, **Dados sincronizados**, **Pedido HTTP**), consent chips (**Apenas leitura** vs **Escrita - precisa de autorização**), each action's resolved target, and per-action *Executar agora* |
| `C03-processos-action-open.png` | The S9 `processos` action expanded: the **COBERTURA** sentence in full, the target line `dados já sincronizados neste Ekoa (citius.processos)`, and the three per-action panels - AS MINHAS NOTAS, ÚLTIMA EXECUÇÃO COM SUCESSO, AGENDAMENTOS |
| `C04-note-written.png` | The S3 notes affordance with one note written, plus its privacy caveat: *"Só o utilizador vê estas notas. O assistente lê-as quando planeia esta ação, por isso não escreva palavras-passe nem chaves aqui."* |
| `C05-note-erased.png` | The same panel after *Remover* - back to "Ainda não há nota." The estate is clean; no note of mine survives this run |
| `C06-steps-view.png` | The read-only steps view of the provisioned `consultar_notificacoes`: all **9** steps of the bound automation rendered as prose, each with its own *Nota sobre o passo N* affordance |
| `C07-schedules.png` | `/schedules` empty state, with the converged copy naming the three target kinds |
| `C08-citius-card-provisioned.png` | The CITIUS card after provisioning: each action now shows its bound automation by name (*CITIUS/eTribunal — consultar notificações*) with a *Ver passos* link |
| `C09-schedule-form.png` | The new-schedule form with **Ação de integração** chosen: integration picker, action picker, the action's own declared parameters (`desde`, with its help text), recurrence, timezone, and a live *Antevisão* of the next three runs |
| `C10-schedules-populated.png` | `/schedules` with the S9 reference schedule created through this form: *CITIUS - sincronizar notificacoes (referencia S9)*, "Todos os dias às 09:00", "Próxima execução dentro de 6 h", with enable / run-now / delete |

## PROVEN

- The integration detail page is a real surface, not a stub: actions, backings, consent state,
  targets, read-only steps, evidence and schedules all render off the server's own rows.
- S3's note affordance works at BOTH granularities the store supports - an action-level note and a
  per-step note - and its round trip (write, render, erase) is complete.
- The schedules surface reaches an `integration_action` target and renders the action's declared
  args as the form's own fields. Creating the S9 reference schedule needed no automation UI at all.
- The converged copy holds where a user can see it: the three schedule target kinds, the consent
  dialog and the detail page carry no "Automação" branding.

## DEVIATION from the brief

The brief asked for provisioning to be run **via the UI button**. It was run via
`POST /api/v1/integrations/citius/provision-automations` instead, because at that point the dev
dashboard was unusable (see the defect note below) and the report in leg E needed the automations to
exist. `C08` is the post-provisioning card state; the button itself was never clicked, and once an
integration is provisioned the card replaces it with the bound-automation rows, so it cannot now be
captured without unprovisioning.

## CONSOLE ERRORS SEEN (this is evidence capture, not a zero-console-error spec)

- `GET http://localhost:4111/api/v1/sync/citius/notificacoes/state` -> **404**, on every visit to
  `/integrations`, and **twice per visit**. The 404 itself is designed - `web/lib/sync/citius-sync.ts`
  distinguishes "not for this deployment" from a failure, and three e2e specs say so in comments -
  but it still lands as two console errors on a dashboard route, which is the bar
  `docs/testing.md` sets for band-1 specs. The duplicate call is the part that looks unintended.
  Recorded in `docs/findings.md` as a MINOR.
- One Next.js LCP warning about `/ekoa_logo.png` wanting `loading="eager"`. Cosmetic, dev-only.
- A burst of `ERR_CONNECTION_RESET` / `ERR_EMPTY_RESPONSE` on `_next/static/chunks/*` at 02:03 is
  **mine, not the product's**: it is the moment I killed the runaway dev server (below).

## UI NITS worth a second look (not filed as findings)

- On a `tenant-read` action the **O QUE FAZ** section header renders with nothing under it
  (`C03`): there is no request and no step list to show, so the heading is empty.
- The evidence response sample overflows its container horizontally with no visible scroll
  affordance - long JSON lines are clipped at the card's right edge (`B04-trusted-after.png`).
- A schedule row (`C10`) never names the integration or action it will run; the only identification
  is the free-text name the creator typed.
- The credentials panel masks **non-secret** config values too: `cedula_profissional` and
  `nome_mandatario` are declared `secret: false` and still render as `••••••••••••`, so a user
  cannot check what they typed without re-editing.

## THE DEV-SERVER DEFECT THAT COST THIS LEG AN HOUR (infrastructure, not product)

The `next dev` server booted by `run-ekoa-code/driver.mjs` degenerated into a runaway: sustained
~1000% CPU and 32 GB RSS, taking 3-6 minutes of application-code time per route compile, then
serving documents whose client bundles never arrived (blank pages behind the layout's hydration
spinner), and finally not answering `/login` at all. It recompiled `/settings/api-keys` three times
without any source change. Killed and restarted (see SUMMARY.md for how the API was preserved);
after the restart with a cleared `web/.next/dev/cache`, `/login` compiled in **4.5 s** and every
route in this leg loaded in seconds. Not a product defect and not filed as one, but it is a real
hazard for anyone driving this stack, and the working around is worth knowing.
