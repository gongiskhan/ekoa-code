# S4-drafting - implement note (run 20260717-202309-d797918a)

Implementer note for the drafting slice: contratos, pecas, modelos, forms. All
rules honored: synthetic data only (fixture NIF checksum-INVALID by design),
frozen legal-*.spec.ts untouched, shared scaffold layer untouched
(shared.js/styles.css/demo-spine.js/demo.js/components), api/assets/bases and
SUITE_LEDGER.json and findings.md untouched, dev stack on :3000/:4111 not touched
(edits are app-local scaffold sources - invisible until the lead's mtime rebuild).

All four apps are React SPAs served at `/apps/legal-<x>/`. Every change is
app-local (inside each app's `scaffold/frontend/src/`). The two document builders
already emit real OOXML (verified below); this slice adds the missing UX (deep-links,
outline, precedent insertion, preview, mapping polish, one-click procuração) plus
the e2e coverage the acceptance asks for.

## Per-app changes (all app-local; shared layer untouched)

### legal-contratos
- `pages/GerarWizardPage.jsx`: RECEIVING side of the modelos->contratos deep-link.
  New `useSearchParams` reads `?cliente=&processo=`; a one-time effect
  (`prefillDoneRef`) pre-selects step 1 ONLY after the spine loads and ONLY if the
  ids are valid - the cliente must exist, and the processo must exist AND belong to
  that cliente (otherwise just the cliente is set; never invents data). Placeholders
  already resolved-or-flagged pre-existed: `gerar-confirmar` stays disabled while
  `placeholdersEmFalta.length > 0` and `gerar-placeholders-erro` lists them.
- `pages/procuracao-forense.js` (pre-existing this slice): pure module holding
  `PROCURACAO_FORENSE_MODELO` - a mandato-judicial minuta whose corpo cites
  **artigo 44.º** (poderes forenses gerais + substabelecer) and **artigo 45.º**
  (poderes especiais: confessar/desistir/transigir) do Código de Processo Civil;
  `fonteOriginal` records the CPC provenance. No `window`, no `new Date()`.
- `pages/GaleriaPage.jsx`: `procuracao-forense-rapida` one-click button -
  `onProcuracaoForense` REUSES an existing "Procuração forense" modelo if present
  (matched by name, avoids duplicates on repeat clicks) else creates it, then opens
  `/gerar/<id>`.
- The .docx builder `pages/modelo-docx.js` (`buildModeloDocx`) uses
  `HeadingLevel.TITLE` / `HEADING_1` + `LevelFormat.DECIMAL` numbering - emits real
  Word `w:val="Title"`/`"Heading1"`/`<w:numPr>` + a `word/numbering.xml` part
  (node-verified, see Additivity proof).

### legal-modelos
- `pages/ModelosPage.jsx`: search + tags + preview + BOTH deep-link exits.
  - Search (`modelos-pesquisa`, `SearchInput`) folds accents (`foldText`) across
    name/categoria/fonte/licença/descrição; instant (no debounce).
  - Tags: distinct categorias become filter chips (`modelos-tag-todas` +
    `modelos-tag-<categoria>`); selecting one narrows `rows` by exact category.
    Empty-vs-no-results EmptyState distinction (ordenados.length===0 vs
    rows.length===0).
  - Preview: read-only Modal `modelo-preview-drawer` with `modelo-preview-corpo`
    (pre-wrap), `modelo-preview-fonte` (cited), `modelo-preview-licenca`,
    `modelo-preview-var-<i>` chips.
  - "Usar modelo" deep-links (SENDING side, app-local URL contract):
    row `modelo-usar-<id>` -> `/apps/legal-contratos/gerar/<id>`;
    row `modelo-usar-pecas-<id>` -> `/apps/legal-pecas/?modelo=<id>`;
    same two inside the preview (`modelo-preview-usar`,
    `modelo-preview-usar-pecas`). Fonte cited per row (`modelo-fonte-<id>` badge).
  - Fixed two em dashes to plain dash in the table fallbacks.

### legal-pecas
- `pages/pecas-logic.js`: `composeBody` now accepts a `modelo` (precedente priority,
  then modelo corpo via `substitute(modelo.corpo, resolveValues(...))`, then the
  estrutura-tipo); `composeSkeleton` threads `modelo` through. `composeHeader`
  already auto-fills the COURT HEADER (tribunal + `Processo n.º <numero>`).
- `pages/PecasPage.jsx`: RECEIVING side of the modelos->pecas deep-link. New
  `useSearchParams` reads `?modelo=<id>` once (`deepLinkDoneRef`), `getShared`s it,
  opens the "Nova peça" assistant seeded (`pecas-modelo-seed` banner +
  `pecas-modelo-seed-nome`), then deletes the param via `setSearchParams(...,
  {replace:true})` so reload/share does not reopen it. `criarPeca` passes the seed
  modelo into `composeSkeleton` (only when no precedente chosen) and stamps
  `row.modeloId`.
- `pages/EditorPage.jsx`: OUTLINE nav + PRECEDENT insertion.
  - `extractOutline(corpo)` lists uppercase headings; `pecas-outline` +
    `pecas-outline-<i>` chips; `saltarPara` focuses the corpo textarea and moves the
    selection to that heading's line (deterministic - selectionStart moves).
  - `precedentesRelevantes` (same-tipo first); `inserirPrecedente` appends the
    precedente corpo with `{{chaves}}` resolved from processo/cliente and persists
    (`pecas-precedentes-inserir`, `pecas-inserir-precedente-<id>`).
- The .docx builder `pages/pecas-docx.js` (`buildPecaDocx`) mirrors the contratos
  builder - Word Title/Heading1/numbered-list XML (.docx PARITY, node-verified).

### legal-forms
- `pages/PreencherPage.jsx`: mapping-editor polish over the pre-existing
  AcroForm autofill+archive.
  - `resumoMapa` memo counts resolved fields; `forms-mapa-resumo`
    ("X de Y com valor"), `forms-mapa-lacunas` ("N da espinha por preencher", only
    when > 0), `forms-repor-sugestao` re-applies the heuristic (`reporSugestao`).
  - Fixed an em dash in the "sem valor" hint.
  - Pre-existing (already satisfied acceptance): file upload -> `detectForm` +
    `computeFingerprint` + `suggestMapeamento` -> `form_templates` row -> the
    mapping table; `exportar` runs `fillAndFlatten`, `uploadFile`, then archives a
    `documentos` row (`origem:'legal-forms'`, `tipo:'pdf'`, `versao:1`,
    `clienteId`) to the spine and offers a `/api/app-files/` download.
- The heuristic order (engine `forms.mjs`, UNTOUCHED): nif/email/morada/
  processo/tribunal before nome; NIF grouped `123 456 780`; dates ISO->DD/MM/YYYY.

## Fixture provenance (SYNTHETIC)

- `web/e2e/fixtures/requerimento-generico-form.pdf` (committed, 7143 bytes,
  1-page A4 AcroForm). GENERATED SYNTHETIC - not a real official form. 7 text
  fields DISTINCT from the app's embedded 5-field example:
  `outorgante_nome, contribuinte, residencia, correio_eletronico, autos_numero,
  juizo, data_requerimento`. The only printed identifier is a footer NIF
  `123 456 780` whose check digit is **INVALID by design** (fails módulo-11), so
  it can never collide with a real taxpayer. Fingerprint hashCampos `67b1575d`.
  Generator script lived in the session scratchpad (pdf-lib), not committed - the
  PDF is the artifact.

## Additivity / correctness proof (node, from repo root)

- **docx builders emit real Word XML.** A node harness imported `buildModeloDocx`
  (contratos) and `buildPecaDocx` (pecas), packed with `Packer.toBuffer`, and
  unzipped with fflate: both `word/document.xml` contain `w:val="Title"`,
  `w:val="Heading1"`, `<w:numPr>`, and a `word/numbering.xml` part is present.
  ALL PASS.
- **forms pipeline is proven against the committed fixture.** A node harness
  mirrored `detectForm -> computeFingerprint -> suggestMapeamento ->
  resolveMapeamento -> fillAndFlatten`: 7 fields detected; auto-map
  contribuinte->cliente.nif, outorgante_nome->cliente.nome,
  residencia->cliente.morada, correio_eletronico->cliente.email,
  autos_numero->processo.numero, juizo->processo.tribunal,
  data_requerimento->manual; NIF grouped `123 456 780`; date `17/07/2026`; after
  flatten 0 AcroForm fields remain. ALL PASS.
- **specs transpile clean.** All four new specs pass esbuild `ts` transform (the
  same transform Playwright uses). No typecheck/lint run touched app or shared code.
- No shared-layer file, no `api/assets/bases`, no SUITE_LEDGER.json, no
  findings.md, no frozen legal-*.spec.ts, and no other slice's app dir was edited.

## New e2e specs (web/e2e/) - NOT yet run (lead serializes rebuild + e2e)

- `legal-x-contratos.spec.ts` - generates a .docx via the wizard, fetches the
  archived bytes from `/api/app-files/`, UNZIPS (fflate) and asserts
  `w:val="Title"`/`"Heading1"`/`<w:numPr>` + `word/numbering.xml` in
  word/document.xml AND the resolved cliente name in the body; the one-click
  `procuracao-forense-rapida` creates (and on a 2nd click REUSES) a "Procuração
  forense" modelo citing artigo 44.º/45.º CPC + Código de Processo Civil in
  fonteOriginal; the `?cliente=&processo=` deep-link pre-selects step 1 (and an
  invalid id leaves the selects empty without breaking the page).
- `legal-x-pecas.spec.ts` - new peça from a processo has the tribunal + número in
  the court header; the outline lists uppercase headings and jumping to a later
  one moves the corpo selection; a same-tipo precedente inserts with
  `{{processo_numero}}` resolved (placeholder no longer present); exporting
  produces an OOXML .docx with Word styles (parity); the `?modelo=` deep-link opens
  the seeded assistant (`pecas-modelo-seed`) and the seed corpo lands resolved.
- `legal-x-modelos.spec.ts` - accent-insensitive search filters the list; a
  distinct category chip narrows it and "Todas" restores; the preview drawer shows
  corpo + fonte (cited) + licença + variable chips; the row AND preview deep-link
  hrefs equal the exact app-local contract
  (`/apps/legal-contratos/gerar/<id>`, `/apps/legal-pecas/?modelo=<id>`); each row
  shows a fonte badge.
- `legal-x-forms.spec.ts` - uploads the committed synthetic fixture via the file
  input; asserts the 7 AcroForm fields are detected and auto-mapped from the spine
  (nif/nome/morada/email/processo/tribunal; the date field stays manual); after
  selecting cliente+processo the NIF resolves grouped `123 456 780` and the resumo
  reads "6 de 7 com valor"; "repor sugestão" re-applies the heuristic; filling +
  exporting archives a `documentos` row (`origem:'legal-forms'`, `tipo:'pdf'`,
  `versao:1`) and offers a `/api/app-files/` download.

All four: `legalAppUrl`/`cortexBase` idiom from `web/e2e/helpers/legal.ts`; spine
fixtures created/torn-down via `window.__ekoa.shared` (per-run suffix nonce,
self-cleaning afterAll); zero-pageerror assertions; `test.describe.serial` with
20s boot-class first waits and 15-20s PDF/DOCX-bridge waits. fflate resolves from
the repo-root node_modules (Playwright runs from repo root). Ledger registration
(`api/tests/SUITE_LEDGER.json`, playwright band) is the lead's landing step - NOT
touched here.

## What the lead must verify after rebuild

1. Rebuild picks up the four scaffolds (mtime-based featured-builder) so the
   deep-links, outline, preview, procuração button, and mapping polish are live.
2. Frozen suite still green - especially the byte-frozen
   `legal-{contratos,pecas,modelos,forms}.spec.ts` (all four apps' base journeys)
   and `legal-contratos-gerar.spec.ts`.
3. The four new `legal-x-{contratos,pecas,modelos,forms}.spec.ts` green under the
   rebuilt stack; then register them in `SUITE_LEDGER.json` (lead-owned).
4. Confirm the committed fixture `web/e2e/fixtures/requerimento-generico-form.pdf`
   is included in the PR (it is untracked/new).
5. Cross-app deep-link END-TO-END (modelos->contratos and modelos->pecas) is
   asserted here only at the URL-contract level per app; a full cross-app
   navigation e2e (leaving one BrowserRouter basename for another) is a candidate
   for a later periodic-audit vision pass if the lead wants belt-and-braces.
