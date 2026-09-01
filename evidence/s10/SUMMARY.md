# S10 - evidence run, operator-free legs

**Stack:** `main` @ `d6f4357`, API in `built` mode, real UI, real model credential, real third-party
egress. **Date:** 2026-08-23. **Caller:** `admin` (super-admin), plus one minted gateway key.
**Nothing was pushed. No product code was changed.** The only tracked file touched is
`docs/findings.md`; `evidence/s10/` is untracked by design.

| Leg | Verdict |
| --- | --- |
| A - the under-40 compose demo | **Partially proven** - the ladder and the destructive-goal refusal are proven whole; the compose rung never fired for lack of Citius rows |
| B - the self-extension demo | **Proven end to end**, with two UI gaps found |
| C - the UI surfaces | **Proven**, with one deviation (provisioning run over the API) |
| D - the promotion dry-run | **Proven on the wire**, and it found a real defect |
| E - the migration report | **Proven** for the `wrap` tier; `flatten` had no input to exercise |

Nothing is blocked on the operator. The model credential provisioned cleanly
(`node scripts/dev-credential.mjs --no-browser --provision` -> `claudeAuth.ok=true, mode=oauth`), so
leg B ran for real.

---

## A - the under-40 compose demo -> `A-compose-demo/`

`POST /api/v1/integrations/citius/achieve` with the canonical goal
*"todos os processos de clientes com menos de 40 anos"*, against a Citius connected through the real
UI but with no portal session (this box has no bridge, no certificate, no card reader).

**Proven.** The deterministic matcher picked `processos` from the goal text with no model choosing
the action; the **entire ladder rides the 200** with a distinct verdict and a plain-language reason
per rung; and S9's `tenant-read` backing answered with the never-synced watermark
(`sincronizacao: { marcaDagua: null, notificacoesGuardadas: 0 }`,
`origem: "citius-notificacoes-sincronizadas"`) instead of an error. The compose rung's cheap
disqualification fired **before** a planning turn was bought - an empty row set cost zero tokens and
the ladder says why. The pre-connection run of the same call is kept too, because it is the sharper
shape: a coded executor failure (`not_connected`) travelled back **beside** the compose verdict
rather than being converted into a refusal.

The destructive goal *"apagar todos os processos antigos"* is refused with `read_only_match` and a
message that names the verb, the action, what it can do, and the honest escape hatch. Nothing ran:
no execute, no egress, no model turn. `refused` carries no ladder, by the type's construction.

**Not proven.** `outcome: "composed"` was never produced. No `ComposePlan` was drafted or verified
and no rows were narrowed, because `processos` returns nothing until a real Citius session lands
notifications. The narrowing itself remains covered only by the committed suites. Setup detail: the
legal spine was seeded through the Nucleo exactly as `web/e2e/global-setup.ts` does, and `idade` +
`numeroProcesso` were then written onto those `clientes` rows through the app's own shared-data
plane - so the caller genuinely holds an age-bearing collection in the scope compose reads.

## B - the self-extension demo -> `B-self-extension/`

**Proven end to end on a live stack.** Under a gateway key, a goal no action satisfied minted
`listar_publicacoes` as **provisional**, verified by 8 deterministic checks, with the ladder showing
`reuse: skipped` / `mint: taken`. Then each guardrail was exercised rather than described:

- trust with a shape that is not the one shown -> refused, *"A acao mudou desde que foi apresentada"*;
- trust with the right shape but before any run -> refused, *"Esta acao ainda nao foi executada com
  sucesso"* - this is **S1 giving graduation teeth**, promotion now rests on a validated run;
- running it while provisional -> 403 `awaiting_consent` with the exact request in the consent body.

A human then approved the write in the **real UI dialog** (which shows the exact
`GET https://jsonplaceholder.typicode.com/posts` and both decision meanings, and never says
"Automacao"); the action ran once for real; trust was accepted on that run and answered
`state: "trusted", mutates: false`. The byte-identical goal re-run through the same key came back
`outcome: "executed"`, `reuse: taken`, **zero authoring** - no `mint` rung on the answer at all.
A gateway key could author but could not bless its own work: `achieve` is `user-or-key`, `trust` is
`user`-only, and both halves were exercised with the key in hand.

**Two gaps found**, both filed: there is **no UI anywhere for `trust`** (zero callers in `web/`), so
the loop's promotion step can only be completed over the API; and the detail page's "Autorizar na
pagina de integracoes" link lands on the platform tab rather than on the user's own integration.

## C - the UI surfaces -> `C-ui-surfaces/`

Ten screenshots: the integrations list; the Citius detail page with all six actions carrying backing
and consent chips and resolved targets; the `processos` action open showing the full **COBERTURA**
sentence and `dados ja sincronizados neste Ekoa (citius.processos)`; the notes affordance with a note
written **and then erased** (the estate is clean); the read-only steps view of the provisioned
`consultar_notificacoes` with all 9 steps and a per-step note affordance on each; and the schedules
surface, including the S9 **reference schedule created through the real form** as an
`integration_action` target ("Todos os dias as 09:00").

**Deviation:** provisioning was run over the API, not the UI button, because the dashboard was
unusable at that moment (below) and leg E needed the automations. Once provisioned the card replaces
the button with the bound-automation rows, so the button cannot now be captured without unprovisioning.

**Console errors seen:** `/api/v1/sync/citius/notificacoes/state` 404s **twice** on every
`/integrations` visit. The 404 is designed; landing it as two console errors on a dashboard route is
not, and it makes the zero-console-error bar unmeetable there. Filed. Also four UI nits worth a
second look, listed in that leg's NOTES.

## D - the promotion dry-run -> `D-promotion-dryrun/`

A private definition was built through real product paths - the builder's save, a real 200 execution
producing an S1 evidence row, an S3 feedback note - and then run through the S6 publish **preview**.

**The D5 structural exclusion is proven on the wire.** The origin row holds an evidence row with an
8 KB-capped verbatim sample of real third-party account content (names, emails, phone numbers), a
feedback note in the author's own words, and the authored action's `authoredBy` and typed `goal`.
Walking **every key** of the snapshot the preview would publish: no `evidence`, no `feedback`, no
`runId`, no `validatedAt`, no `authoredBy`, no `goal`, no `note`. None of it is filtered out - none
of it is reachable from the publish path in the first place. The redaction report is explicit rather
than silent, and `modelPass: { status: "applied", spansApplied: 0 }` distinguishes "the model pass
ran and found nothing" from "the model pass did not run".

**Caveat:** credential scrubbing was not meaningfully exercised - the definition is
`authType: "none"` with an empty `configSchema`, so the floor had no credential-named fields to redact.

**Defect found** (filed): the one redaction that did fire is a false positive that changes behavior -
the floor redacts `authoring.shape`, a 32-char md5 fingerprint, as a `literal-secret-token`, and
because `authored-action.ts` decides effective state by comparing against that value, a published
TRUSTED action reads as `provisional` in the receiving org. It fails closed, but silently.

## E - the migration report -> `E-migration-report/`

**Proven.** After provisioning, all four Citius sequences classify **`wrap`**, each carrying its
reasoning rather than just its verdict: `flattenRefusals: ["not-single-step", "step-not-api-call"]`,
`engineInternal: ["rehearsal-vision"]`, and the known `degradations: ["mid-run-pause-collapses"]` -
the plan's own admission, carried where a migration planner will see it. `mode: "report-only"` rides
the artifact itself. **`flatten` was never exercised**: no single-step `api_call` automation existed,
so `flatten: 0` is an absence of input, not a demonstration.

---

## What surprised me

1. **The dev dashboard degenerated into a runaway mid-run** - not a product defect, but it cost an
   hour and is worth knowing about. The `next dev` server booted by `run-ekoa-code/driver.mjs`
   climbed to sustained ~1000% CPU and 32 GB RSS, took 3-6 minutes of application-code time per
   route compile, recompiled `/settings/api-keys` three times with no source change, served
   documents whose client bundles never arrived (blank pages behind the layout's hydration spinner),
   and finally stopped answering `/login` at all.

   **Recovering without losing the run:** the driver tears the whole stack down when the web child
   exits, and the API's Mongo is ephemeral - so a plain restart would have destroyed the connected
   Citius, the demo definition, its evidence row, the feedback note, the trusted action and the
   gateway key. Instead: `kill -9` the **driver** first (its exit handler never runs, so the API
   child is orphaned and survives), then kill only the verified `next` tree, then stand a
   replacement CORS proxy on `:4111 -> :4211` and start `next dev` by hand with the driver's own env
   (`NEXT_PUBLIC_API_URL=http://localhost:4111`, `-H 127.0.0.1`). Every pid was checked against
   `/proc/<pid>/cwd` before being signalled. After the restart with `web/.next/dev/cache` cleared,
   `/login` compiled in **4.5 s**.

2. **Graduation really does have teeth now.** I expected `trust` to be a shape check and it refused
   me twice - once for the shape, once for the missing validated run - which is the S1 claim
   actually holding at runtime rather than in a docblock.

3. **The publish floor's one redaction was a false positive**, and finding it took walking the
   preview rather than reading it: the report says "32 characters removed from `authoring.shape`",
   which looks like the scrub working until you ask what reads that field.

4. **`achieve` never lies about what happened.** Every answer in this run carried the ladder beside
   it, including the two where a rung stood down - and the pre-connection call is the proof that
   matters: the executor's own `not_connected` came back intact with the compose verdict attached,
   rather than being laundered into a refusal.
