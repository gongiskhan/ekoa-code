# S1-spine-productivity - implement note

Run `20260717-202309-d797918a`, slice S1. Seed edits are in the featured-artifact
scaffolds and will only appear in the served apps after the lead's rebuild; the
five new specs are written to run against that rebuilt state. `seedSpine()` and
the whole frozen shared layer were NOT touched. `SUITE_LEDGER.json` was NOT
touched (lead registers the specs at landing).

## legal-nucleo

- **NEW `pages/QuickOpen.jsx`** - Ctrl+K / Cmd+K quick-open palette (app-local,
  mounted in `App.jsx` inside the Layout). Accent-folded search over clientes
  (nome/nif/email, excludes arquivado) and processos (numero/tribunal/area/
  cliente nome), max 6 per kind, ArrowUp/Down + Enter navigation, Escape/backdrop
  close, deep-links to `/clientes/:id` and `/processos/:id`. The shortcut always
  requires a modifier so it never steals keys from text inputs. Uses `autoFocus`
  because the frozen SearchInput does not forward refs.
- **`pages/ProcessoDetailPage.jsx`** - two new cards. "Lancamentos financeiros":
  the processo's `lancamentos` sorted by data desc, 5 most recent, Faturado /
  Pre-fatura badge per row, count + por-faturar + total footer, links to
  honorarios and to tempos with `?processo=<id>`. "Noutras aplicacoes":
  deep-links to kanban (`?processo=<id>`) and agenda. Testids:
  `processo-lancamentos`, `processo-lancamento`, `processo-lancamentos-total`,
  `processo-ligacoes`, `link-{honorarios,tempos,kanban,agenda}`.
- **NEW `pages/csv.js`** - `csvEscape` (RFC-4180: quote when `[",\r\n]`, double
  quotes), `buildCsv` (BOM as `\uFEFF` escape + CRLF), `downloadCsv` (Blob
  anchor). **`pages/ClientesPage.jsx`** - "Exportar CSV" button
  (`clientes-exportar-csv`) exporting the CURRENT filtered rows with fixed
  header `nome,tipo,nif,email,telefone,processos`; disabled when empty.

## legal-agenda

- **NEW `pages/ics.js`** - deterministic ICS module: fixed
  `PRODID:-//Ekoa Legal//Agenda//PT`, full Europe/Lisbon VTIMEZONE (WET/WEST
  RRULEs), UIDs `evento-<id>@ekoa-legal` / `reserva-<id>@ekoa-legal`, DTSTAMP
  derived from updatedAt/createdAt (never now()), wall-clock
  `DTSTART;TZID=Europe/Lisbon`, all-day `VALUE=DATE` with exclusive DTEND, RFC
  5545 escaping, 75-octet folding, CRLF. Node-unit-checked byte determinism.
- **`pages/agenda-logic.js`** - appended pure `sobreposicoesDeParticipantes`:
  occupying reservas (`hold|pendente_pagamento|confirmada`, mirroring the
  engine) x participantesNecessarios + timed eventos' pessoaIds; reserva-derived
  eventos deduped; day-only eventos excluded; sorted per-pessoa sweep.
- **NEW `pages/agenda-print.js`** - deterministic print HTML for the exportPdf
  bridge (day sections, dia-inteiro + HH:MM ranges, "Sem marcacoes." for empty).
- **`pages/AgendaPage.jsx`** - header: "Exportar .ics" (`agenda-exportar-ics`,
  whole displayed week -> `agenda-semana-<segunda>.ics`) and week print
  (`agenda-print-semana`, landscape -> `agenda-semana-<segunda>.pdf`); per-day
  print icon (`agenda-print-dia[data-dia]`, portrait); per-proxima .ics
  (`agenda-proxima-ics` -> `reserva-<id>.ics`); amber overlap banner
  (`agenda-sobreposicoes` / `agenda-sobreposicao`, "Nome: A (data HH:MM-HH:MM)
  sobrepoe-se a B (...)"). All print paths degrade honestly with an error toast
  when `window.__ekoa.exportPdf` is absent.

## legal-agenda-reservas

- **NEW `pages/ics.js`** - byte-identical copy of agenda's module (public app
  imports nothing from the staff suite).
- **`reservas-data.js`** - `spineDisponivel()` (bridge presence probe).
- **`pages/ReservarPage.jsx`** - honest degraded state: load failure or missing
  bridge renders `reservas-indisponivel` ("Nao foi possivel ligar ao servico de
  marcacoes...") + `reservas-tentar` retry, never the "no sessions" empty state
  (this also fixed a latent unhandled rejection: `carregar` had try/finally
  without catch). Deep-link to a vanished tipo shows
  `reservas-tipo-indisponivel` over the type list. The confirmada panel offers
  "Adicionar ao calendario (.ics)" (`reservas-ics` -> `reserva-<id>.ics`).

## legal-kanban

- **`pages/BoardPage.jsx`** - `?processo=` / `?cliente=` URL params initialize
  the filters (new `kanban-filtro-cliente`; testid added to the existing
  processo select as `kanban-filtro-processo`); cliente resolution falls back
  from `tarefa.clienteId` to the processo's cliente; the filter Selects include
  the active filter id even when no card matches (the Select must not lie).
  Cards: `tabIndex=0`, ArrowLeft/ArrowRight move to the adjacent column through
  the same `moveTo`/`movePatch` path as "Mover para" (estado-sync rules intact),
  focus follows the moved card (`pendingFocusRef`); `aria-keyshortcuts` + title
  hint; keys are ignored when the event target is a child control. New
  `kanban-card-nucleo` link to `/apps/legal-nucleo/processos/<id>`.
  `kanban-logic.js` untouched.

## legal-tempos

- Transfer contract and timer persistence were already correct (FK-correct
  payload, `faturado:false`, idempotency via `registoTempoId` + orphan repair;
  timer state lives in the spine row) - verified, not changed.
- **`pages/RegistosPage.jsx`** - `?processo=` deep-link (target of the Nucleo's
  `link-tempos`) preselects the processo in BOTH the timer and manual forms; an
  unknown id is cleared once processos load so a ghost FK can never ride into a
  created registo.
- **NEW `pages/tempos-print.js`** - deterministic weekly timesheet HTML from
  `agruparSemana` (per-day sections, faturavel/estado column, week totals).
  Node-unit-checked (determinism, HTML escaping, totals, no scripts).
- **`pages/SemanaPage.jsx`** - "Exportar folha (PDF)" (`semana-exportar-pdf`)
  via `window.__ekoa.exportPdf` -> `folha-tempos-<segunda>.pdf`, honest error
  toast when the bridge is absent.

## New specs (for the lead to register in SUITE_LEDGER.json)

- `web/e2e/legal-x-nucleo.spec.ts` - quick-open (open/search/navigate/Escape),
  processo-detail lancamentos aggregation + `?processo=` deep-link hrefs,
  clientes CSV (BOM escape, fixed header, CRLF, doubled quotes).
- `web/e2e/legal-x-agenda.spec.ts` - week .ics byte-determinism (two downloads
  compared), PRODID/VTIMEZONE/derived UIDs/CRLF-only, per-proxima .ics, overlap
  warning from two occupying reservas sharing a pessoa, week print produces a
  real PDF download (7 per-day buttons present).
- `web/e2e/legal-x-agenda-reservas.spec.ts` - degraded state via route-abort of
  `/api/app-shared/**` + retry recovery, tipo-inexistente note, free-tipo
  booking confirms and downloads the .ics.
- `web/e2e/legal-x-kanban.spec.ts` - `?processo=` prefilter + nucleo card link,
  cliente filter via processo fallback, arrow-key movement with estado sync and
  focus retention.
- `web/e2e/legal-x-tempos.spec.ts` - `?processo=` preselect + ghost-id honest
  clear, timer reload persistence (HH:MM:SS parsed >= elapsed), weekly timesheet
  PDF download.

All specs follow the ported idiom: nonce-tagged fixtures injected via
`window.__ekoa.shared`, best-effort FK/nonce teardown in afterEach, zero
`pageerror` assertions, screenshots under `.playwright-cli/x-*/`.

## What the lead must verify after rebuild (I could not run the stack)

1. The five specs green (I could not execute Playwright per runtime discipline;
   `npm run typecheck` and `npm run lint` pass, esbuild parses every scaffold
   edit).
2. The two exportPdf specs assume `/api/app-pdf` renders within 60s in the e2e
   environment (server-side Chromium pool). If the pool is unavailable there,
   those two tests fail honestly - the buttons themselves degrade with a toast.
3. The reservas .ics spec books through the seeded "Reuniao de acompanhamento"
   (free + publico) and assumes the engine offers slots for it via
   `agenda_publica` after a staff visit, as it does for Consulta inicial.
4. Rebuild pickup: scaffold mtimes changed in 5 apps (nucleo, agenda,
   agenda-reservas, kanban, tempos).
