# S6-compliance - implement note

Run `20260717-202309-d797918a`, slice **S6-compliance** (kyc, rcbe, conflitos, recursos + kyc/ferias engines).
Wave B, shared working tree with S4/S5/S7 - only the files listed here belong to S6.

Static gates run locally after implementation (NOT the live dev stack): `npm run typecheck` clean (3 workspaces); `npm run lint` 0 errors, 0 findings in any S6 file; `npm run gate:chokepoint` clean; engine golden gates `ferias-engine.test.ts` + `kyc-checksum.test.ts` = 29 tests pass. The e2e specs were NOT run here - the lead runs the Playwright suite.

---

## Per-app: what changed

### kyc - NIF/NIPC checksum, Lei 83/2017, 7-year archive radar
- **Engine (additive, proven):** `api/assets/legal-engines/kyc.mjs` and its byte-identical scaffold copy `.../legal-kyc/scaffold/frontend/src/engine/kyc.mjs` each gained `validaNumeroFiscal` / `validaNif` / `validaNipc` (Portuguese mod-11: weights 9..2 over first 8 digits, `sum % 11`, check digit = 0 if remainder < 2 else `11 - remainder`; first digit 1/2/3 singular, 5/6/7/8/9 coletiva). Diff vs HEAD = **90 additions, 0 deletions** in both files: existing AML/risk scoring is untouched line-for-line. The two copies are byte-identical to each other (gate asserts it).
- **UI:** `NovaFichaPage.jsx` identification step renders `kyc-nif-check` with `data-nif-valido="true|false"` and the mod-11 reason; it validates against the selected cliente's nature (`kyc-tipo` particular->NIF, empresa->NIPC), so a valid singular NIF used as a NIPC is correctly rejected. `App.jsx` adds the `/arquivo` route. The Lei 83/2017 citation and 7-year conservation banner (`kyc-conservacao`) are on the Fichas list.
- **New surface:** `ArquivoRadarPage.jsx` - the conservation radar (art. 51.º / Lei n.º 83/2017), read-only, approved fichas by `arquivarAte`, banded `radar-banda-{em-conservacao|proximo|atingido|sem-data}` (`>180d` = em-conservacao). No deletion path anywhere before the archive date.
- **Synthetic-only rule honoured:** every fixture NIF/NIPC is synthetic; the "invalid" ones carry a deliberately wrong check digit so the validator REJECTS them - the spec asserts the rejection, never a fake pass.

### rcbe - obligations calendar, dedup with KYC over spine, declaração export
- **Additive only** (see closure-map note below - the ported journey was already green).
- **UI:** `EntidadeDetailPage.jsx` (+85/-5): `chaveBeneficiario` (NIF-first, else NFD-folded name) + `dedupBeneficiarios` (keeps highest `percentagem`, preserves first-appearance order, pure). `meusBos` is now deduped; `duplicadosOcultos` drives the `rcbe-bo-dedup` note. Added `rcbe-exportar-pdf` in the prepared-declaração branch.
- **New surface:** `declaracao-pdf.js` - `declaracaoRcbeHtml(...)` returns self-contained HTML + filename `declaracao-rcbe-<nipc>-<geradoEm>`; BOs table, obligations table, `[X]`/`[ ]` checklist, Lei 89/2017 + Portaria 233/2018 footer. Handler appends `.pdf`.
- All ported testids preserved (`rcbe-detalhe`, `rcbe-bos`, `rcbe-bo-row`, `rcbe-calendario`, `rcbe-obrigacao`, `rcbe-declaracao`, `rcbe-preparar`, `portal-passo-{i}`, `rcbe-arquivar`). Ported spec file is byte-frozen (unmodified in tree).

### conflitos - deterministic fuzzy search, art. 99.º EOA, decision log, link-only nucleo
- **UI/logic:** `conflitos-search.js` adds order-independent token-subset matching: substring hit stays `parcial:false`; if not a substring but all query words (>=2 chars, 2+ tokens) appear as substrings in any order, it is a hit with `parcial:true`. Recall only WIDENS - every prior substring hit still matches, single-token queries are unchanged, and NIF matching is untouched (exact digits only). `VerificarPage.jsx` renders a truthful `conflitos-hit-aproximada` badge when `h.parcial`.
- **Decision log persisted:** `onRegistar` writes to the `conflitos_check` collection (`termo`, `resultado[]`, `decisao`, `decididoPor`, `notas`, `executadoEm`).
- **Link-only nucleo hook:** a cliente hit renders `conflitos-hit-link` as a plain anchor whose `href = appHref('legal-nucleo', 'clientes/<refId>')` = `/apps/legal-nucleo/clientes/<id>`. The app never navigates there and nucleo is not touched. art. 99.º EOA cited in the disclaimer.

### recursos - ferias golden tests (CT art. 238/239), alocação view, mapa export
- **Engine unchanged:** `ferias.mjs` is unmodified vs HEAD; I added golden node tests only. Scaffold copy byte-identical to canonical.
- **New golden gate:** `api/tests/legal/ferias-engine.test.ts` - byte-identity assert + pinned goldens (art 239 mid-month `9x2=18`, cap 20, late Oct 4, art 238 = 22, before-admission 0; `diasUteisEntre` week=5, feriado exclusion 5->4, inverted=0; `saldoFerias` 22->17; feriados fixos; `parseData` throws on impossible/out-of-range).
- **Alocação view** already existed (`AlocacoesPage.jsx`: `alocacoes-page`, `alocacoes-tabela`, `nova-alocacao`) - no code change, covered by spec.
- **New surface:** `mapa-ferias-pdf.js` - `mapaFeriasHtml(...)` returns HTML + filename `mapa-ferias-<geradoEm>`; `AusenciasPage.jsx` adds `mapa-exportar-pdf` calling `api.exportPdf({ ..., landscape:true, filename:'mapa-ferias-<date>.pdf', download:true })`, guarded against a missing bridge.

---

## rcbe closure map (assertion -> element) + IMPORTANT correction

FLOW_PLAN.md (line 28) lists the ported `legal-rcbe` journey as a **red spec to close by building the missing surface**. **On the committed build this is not accurate:** the rcbe journey surface (`EntidadeDetailPage.jsx` with `rcbe-preparar` / `portal-passo-{i}` / `rcbe-arquivar`) was ported in commit `f784856` and predates this run. The ported `web/e2e/legal-rcbe.spec.ts` is byte-frozen and unmodified in my tree, and its testids all exist on the pre-existing surface. My rcbe work is therefore **additive** (dedup note + declaração PDF export), NOT a red->green closure. This is surfaced honestly rather than claiming a closure I did not perform. The lead should confirm the ported `legal-rcbe` spec is green on rebuild; if it is red, the cause is elsewhere (e.g. demo-spine install), not a missing surface I was meant to build.

New rcbe assertions (in `legal-x-rcbe.spec.ts`) -> element:
| assertion | element |
| --- | --- |
| duplicate BO folded, person counts once | `rcbe-bo-row` count stays 2 (2 seeded BOs, injected dup hidden) |
| dedup stated to the user | `rcbe-bo-dedup` visible, contains "unificadas" |
| declaração export produces a real PDF | `rcbe-exportar-pdf` click -> download `declaracao-rcbe-<nipc>-<YYYY-MM-DD>.pdf` |

---

## Engine additivity proof
- `kyc.mjs` (both copies): `git diff` vs HEAD = 90 additions, **0 deletions** -> existing logic byte-for-byte unchanged; new checksum validators only. Copies byte-identical to each other (asserted by `kyc-checksum.test.ts`).
- `ferias.mjs`: unchanged vs HEAD (no diff). Golden tests added around it; copy byte-identical to canonical (asserted by `ferias-engine.test.ts`).

---

## Specs written (for the lead to register in the SUITE_LEDGER)
- `web/e2e/legal-x-kyc.spec.ts` (+ fixture `web/e2e/fixtures/legal-x-kyc.fixtures.ts`) - 3 tests: loads clean; NIF/NIPC checksum (synthetic invalid rejected, valid accepted, natureza mismatch); 7-year radar (Lei 83/2017).
- `web/e2e/legal-x-recursos.spec.ts` - 4 tests: loads clean; ferias direito from engine (art. 238 -> 22); alocação view; mapa de ferias PDF export.
- `web/e2e/legal-x-conflitos.spec.ts` - 3 tests: order-independent fuzzy match + "aproximada" badge (and no invented matches); link-only nucleo deep-link href (no navigation); decision persisted to `conflitos_check`.
- `web/e2e/legal-x-rcbe.spec.ts` - 2 tests: beneficiários dedup; declaração checklist PDF export.

Golden gates (already in `api/tests/legal/`, run under vitest): `ferias-engine.test.ts`, `kyc-checksum.test.ts`.

## S6 files changed
Modified: `legal-conflitos/.../conflitos-search.js`, `legal-conflitos/.../VerificarPage.jsx`, `legal-kyc/.../App.jsx`, `legal-kyc/.../engine/kyc.mjs`, `legal-kyc/.../NovaFichaPage.jsx`, `legal-rcbe/.../EntidadeDetailPage.jsx`, `legal-recursos/.../AusenciasPage.jsx`, `api/assets/legal-engines/kyc.mjs`.
New: `legal-kyc/.../ArquivoRadarPage.jsx`, `legal-rcbe/.../declaracao-pdf.js`, `legal-recursos/.../mapa-ferias-pdf.js`, `api/tests/legal/ferias-engine.test.ts`, `api/tests/legal/kyc-checksum.test.ts`, the 4 `web/e2e/legal-x-*.spec.ts` + `web/e2e/fixtures/legal-x-kyc.fixtures.ts`.
(Many other modified/new files in `git status` belong to the concurrent S4/S5/S7 slices on the shared tree - NOT S6.)

## What the lead must verify after rebuild
1. Rebuild the served apps (the scaffolds are compiled/served by cortex) so the new pages/PDF bridges ship. My new UI is NOT live until then.
2. Run the 4 new `legal-x-*` specs + confirm the ported `legal-rcbe` and `legal-conflitos` specs stay green (the frozen `legal-conflitos` NIF exact/partial invariant and single-token "Padaria" hits are preserved by the token-subset widening; verified offline against `conflitos-search.js`).
3. Register the 4 new specs (and the 2 engine golden gates if not already) in `api/tests/SUITE_LEDGER.json`.
4. Confirm the PDF-export specs against the real `exportPdf` bridge in CI (server-side Chromium) - locally I could only assert the download filename shape, not run the bridge.
5. Update the affected diagrams under `docs/diagrams/` for the new kyc radar screen, rcbe declaração-export, and conflitos deep-link hook (diagram invariant FIXED-12).
