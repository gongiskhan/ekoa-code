# Flow Plan — run 20260717-202309-d797918a

Brief: test all 29 legal apps (featured artifacts) thoroughly; fix defects; add lawyer-useful capabilities, UX polish, and honest integrations for Portuguese lawyers' daily practice.

## Slices

| # | Slice ID | Title | Kind | Routes (area skill: ekoa-architecture + ekoa-testing) | Parallel group | Status |
|---|----------|-------|------|-------------------------------------------------------|----------------|--------|
| 0 | S0-smoke-foundation | Smoke sweep + shared-layer sync gate + Invalid-Date fix | mixed | all 29 /apps/legal-*/ + /artifacts | serial-first | passed |
| 1 | S1-spine-productivity | nucleo, kanban, tempos, agenda, agenda-reservas | ui | /apps/legal-{nucleo,kanban,tempos,agenda,agenda-reservas}/ | A (after S0) | passed |
| 2 | S2-court-deadlines | prazos, citius, apoio, insolvencias (+ prazo/citius engines) | ui | /apps/legal-{prazos,citius,apoio,insolvencias}/ | A (after S0) | passed |
| 3 | S3-money | calculos, honorarios, financas, cobrancas, injuncoes (+ money engines) | ui | /apps/legal-{calculos,honorarios,financas,cobrancas,injuncoes}/ | A (after S0) | passed |
| 4 | S4-drafting | contratos, pecas, modelos, forms | ui | /apps/legal-{contratos,pecas,modelos,forms}/ | B (after A) | passed |
| 5 | S5-records | dossie, assinatura, transcricao, correio | ui | /apps/legal-{dossie,assinatura,transcricao,correio}/ | B (after A) | passed |
| 6 | S6-compliance | kyc, rcbe, conflitos, recursos (+ kyc/ferias engines) | ui | /apps/legal-{kyc,rcbe,conflitos,recursos}/ | B (after A) | passed |
| 7 | S7-knowledge-portal | pesquisa, jurimetria, portal | ui | /apps/legal-{pesquisa,jurimetria,portal}/ | B (after A) | passed |

Status: pending | in_progress | passed | blocked (mirror of each slice's gate-status.json).

## Ground truth (verified during planning)

- Seeds: `api/assets/featured-artifacts/legal-<x>/scaffold/frontend/src/...` (+ `manifest.json`; citius also `scaffold/backend/index.js`). Apps are 3.6k–5.7k lines each, PT-PT, deterministic. NEVER touch `api/assets/bases/`.
- Rebuild: mtime-based (`api/src/apps/featured-builder.ts`); edit seed → restart stack (`npm run dev` / driver `up`) → wait for `[featured-builder] built N…` log. `EKOA_SCREENSHOTS_DISABLED=1` speeds boots. Never "customize" a featured app in the dashboard (sets `data.customized`, detaches the seed). Committed lane: `npm run build` once → `npm run e2e:server`.
- E2E: direct `page.goto(legalAppUrl('legal-x'))` (helper `web/e2e/helpers/legal.ts`; cortex from `backend.port`, default :4111). Served apps need no login in dev. Spine fixtures via `page.evaluate` on `window.__ekoa.shared.*` (idiom: ported `legal-prazos.spec.ts`). Dashboard pages: baseURL :3000 + real login admin/tmp12345.
- Test estate: 37 ported `legal-*.spec.ts` in `SUITE_LEDGER.json` band3_served_app are BYTE-FROZEN (never edit; failures = product defects). New coverage = NEW spec files (`legal-x-*.spec.ts` names) registered in `api/tests/SUITE_LEDGER.json` in the same change; `npm run gate:ledger` enforces census both directions.
- Shared layer: `shared.js, styles.css, components/{Layout,ui,Icons}.jsx, demo-spine.js, demo.js` byte-identical across all 29 scaffolds. Ported `legal-shared-drift.spec.ts` (RED today) calls missing `scripts/sync-legal-shared.mjs --check` — S0 builds it (read the full ported spec for the expected canonical dir + output; spec header mentions `ekoa-data/legal-shared/`). After S0, shared layer is FROZEN to S0 ownership; domain slices add app-local files only.
- Engines: canonical `api/assets/legal-engines/*.mjs` with per-app copies under each scaffold's `engine/`. Copies cross app dirs (prazo.mjs in prazos/citius/apoio/insolvencias; citius-* also in nucleo) — ownership is FILE-level per the table above. Engine changes must be additive; ported specs pin golden values (e.g. prazos 2026-06-05 +5 úteis → 2026-06-15).
- Known red ported specs in scope to close by building the missing surface: `legal-shared-drift` (S0), `legal-rcbe` journey (S6). Other reds (band2 legacy, integrations UI, simuladores-trabalho) are pre-existing, out of scope (docs/findings.md `e2e-estate-baseline-13`).
- `node_modules` is MISSING in this checkout — foundation phase runs `npm install` before anything.

## Acceptance per slice

- **S0-smoke-foundation**: (1) new `web/e2e/legal-apps-smoke.spec.ts` opens all 29 apps: `__EKOA_APP_ID` present, not "Building", Layout mounts, `window.__ekoa.shared` available, zero pageerror/console errors; (2) `/artifacts` never renders "Invalid Date" (fix `web/app/(dashboard)/artifacts/page.tsx` formatDate + raw `new Date(...)` at ~1165/1381; hide row when absent) + new `web/e2e/artifact-cards-dates.spec.ts`; close finding `artifact-cards-invalid-date`; (3) `scripts/sync-legal-shared.mjs` (`--check`/`--write`) + canonical shared dir; ported `legal-shared-drift.spec.ts` green UNMODIFIED; (4) both new specs registered in ledger, `npm run gate:ledger` green; load-breaking defects found by the sweep fixed here (behavioral defects routed to owning slice).
- **S1-spine-productivity**: nucleo: Ctrl+K quick-open (clientes+processos, deep-links), processo detail aggregates spine (prazos/eventos/lancamentos) with cross-app deep-links, clientes CSV export — `seedSpine()` cascade untouched. agenda: .ics export (event + calendar, Europe/Lisbon, deterministic body), participant overlap warning, day/week print via exportPdf. agenda-reservas: honest empty/degraded states, confirmation offers .ics. kanban: filter by processo/cliente, card deep-link to nucleo, keyboard movement. tempos: billable → honorarios `lancamentos` over spine (FK-correct, pré-fatura only), weekly timesheet exportPdf, timer reload persistence. New specs `legal-x-{nucleo,agenda,kanban,tempos}.spec.ts` green + ledger.
- **S2-court-deadlines**: prazos: .ics of pending prazos (all-day VEVENT + VALARM D-2), férias judiciais view citing LOSJ art. 28.º, memória de cálculo exportPdf; golden engine values stay byte-green. citius: bulk triage multi-select, multi-notification paste split, triage writes prazo+evento to spine + dossie deep-link, `onEmail` backend surfaced honestly in UI. apoio: SADT pedido pack via exportPdf from spine data, nomeação/escusa deadlines feed prazos radar. insolvencias: 30 dias CONTÍNUOS (CIRE art. 128.º cited) visibly distinct from CPC úteis, credor checklist, deep-links to cobrancas/injuncoes. New specs 4× + ledger.
- **S3-money**: calculos: juros de mora troços verified current through 2026 (civil+comercial, cited Avisos DGTes; WebSearch-verify; golden unit tests per troço), RCP taxa de justiça UC calculator cited, memória de cálculo exportPdf. honorarios: pré-fatura PDF (base/IVA/retenção, "não é fatura certificada"), import billable tempos from spine (data-shape contract only with S1). financas: per-processo conta-corrente saldo+provisões, CSV export with honest disclaimer, despesas polish. cobrancas: carta de interpelação deterministic + exportPdf, aging escalões with next-action, injunção handoff deep-link. injuncoes: elegibilidade citing DL 269/98, requerimento draft export, lifecycle tracking with manual-first BALCAO+ link-out. NO uncited number. New specs 5× + ledger.
- **S4-drafting**: contratos: .docx quality (headings/numbering; e2e unzips and inspects XML), placeholders resolved-or-flagged, one-click procuração forense. pecas: court header auto-fill, precedent insertion, .docx parity, outline nav. modelos: search+tags+preview, "usar modelo" deep-link prefill into pecas/contratos (URL-param contract, app-local both sides), fonte cited. forms: AcroForm autofill proven on committed synthetic fixture PDF, mapping editor polish, filled PDF archived to spine documentos. New specs 4× + ledger.
- **S5-records**: dossie: one-click full-dossier PDF (cover/cronologia/doc index), uploadFile with preview, cronologia ordering asserted — ported `legal-dossie.spec.ts` selectors undisturbed. assinatura: demo/manual boundaries explicit (no fake success), deterministic hash manifest per envelope, timeline polish. transcricao: keyboard-first review (play/pause, timestamp insert, speaker rename propagates), export with timestamps. correio: manual-first CTT tracking (honest link-out), comprovativo upload → spine documentos, dossie round-trip deep-link. New specs 4× + ledger.
- **S6-compliance**: kyc: NIF/NIPC checksum validation (checksum-INVALID synthetic fixtures ONLY), risk factors cite Lei 83/2017, 7-year archive radar. rcbe: obligations calendar, beneficiários deduped with KYC over spine, declaração checklist export; CLOSE ported `legal-rcbe` journey red by building the missing surface. conflitos: deterministic fuzzy search across clientes/contrapartes citing art. 99.º EOA, decision log persisted, link-only nucleo hook. recursos: férias golden tests (CT art. 238.º/239.º), alocação view, mapa de férias exportPdf. New specs 4× + ledger.
- **S7-knowledge-portal**: pesquisa: "fonte verificada" badge only after link confirmation, honest failure state, saved searches per processo, PT citation copy. jurimetria: every stat shows fonte+período, own-processos comparison from spine, honest empty state. portal: explicit-share-only proven in e2e (non-partilhado never renders), client timeline, branded extrato PDF. UI-plane assertions only (server authz H-block out of scope). New specs 3× + ledger.

## Parallelism

- S0 serial first (validates harness, freezes shared layer, lands sync gate).
- Wave A: S1, S2, S3 concurrently (disjoint files; nucleo engine copies carved to S2; S1/S3 tempos→honorarios contract is data-shape only).
- Wave B: S4, S5, S6, S7 concurrently (disjoint).
- Always serialized: ONE dev stack (:3000/:4111), ONE featured-rebuild cycle per batch of seed edits (~90s cold boot), Playwright workers=1 (one e2e lane at a time), `SUITE_LEDGER.json` appends in landing order.
- Full regression (`npm run gate:ledger` + e2e lane) after each wave.

## Global acceptance

Every slice: committed+ledger-registered green specs, typecheck/lint/build 0, fresh-context review approve, independent test pass, design audit clean, verified walkthrough video. Content rule: legal figures (juros, custas, prazos, férias) carry citations; unverifiable → last-known value + source + honest note. PT-PT copy, no emojis, synthetic data only in fixtures. Tracked in `<runDir>/evidence-index.json → globalGate`.
