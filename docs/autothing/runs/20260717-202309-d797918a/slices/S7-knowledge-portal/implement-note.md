# S7-knowledge-portal - implement note

Run `20260717-202309-d797918a`, slice S7. Seed edits are in the featured-artifact
scaffolds and will only appear in the served apps after the lead's rebuild; the
three new specs are written to run against that rebuilt state. `seedSpine()` and
the whole frozen shared layer (shared.js, styles.css, demo-spine.js, demo.js,
components/{Layout,ui,Icons}.jsx) were NOT touched. `SUITE_LEDGER.json` was NOT
touched (lead registers the specs at landing).

Three apps in scope: legal-pesquisa, legal-jurimetria, legal-portal. All app-local
logic modules were verified in isolation with `node` (pure functions) and all
edited/created JSX/JS was transpiled with the exact featured-builder esbuild
config (`--loader:.js=jsx --loader:.jsx=jsx --jsx=automatic`) and every import was
cross-checked against the real exports of the shared components / app modules.
`api/assets/**` is ignored by the root ESLint config, so the scaffold files are
NOT root-linted; the three web specs ARE linted (web flat config) and typechecked
(`web/tsc --noEmit`) - both pass clean.

## legal-pesquisa

- **NEW `pages/citacao-pt.js`** - pure, app-local citation formatter for the
  Portuguese forum norm. Exports `extrairTribunal` (full tribunal name or bare
  sigla -> STJ/STA/TC/TRL/TRP/TRC/TRE/TRG), `extrairProcesso` (foro proc-number
  form), `extrairData` (ISO / DD/MM/AAAA / DD-MM-AAAA -> normalised DD-MM-AAAA),
  `formatarCitacao(citacao) -> { referencia, url, forma }` where `forma` is
  `acordao` (jurisprudence with tribunal+proc, e.g.
  `Ac. TRL de 12-03-2024, proc. 123/20.0T8LSB`), `diploma` (legislation, suffixed
  `, in Diário da República`), or `titulo` (honest degradation when canonical
  elements are missing), `citacaoParaClipboard` (reference + `(url)`), and async
  `copiarTexto` (clipboard with legacy `execCommand` fallback). NUNCA-INVENTAR:
  the URL always travels; jurisprudence is recognised only when `fonte` (upper)
  === `DGSI`, matching how the spine stores citation `fonte` (via `fonteLabel`).
- **NEW `pages/CopiarCitacao.jsx`** - `CopiarCitacaoButton({ citacao, size })`.
  Renders the PT reference (`pesquisa-citacao-pt-texto`), a copy button
  (`pesquisa-copiar-citacao`) that copies `citacaoParaClipboard(citacao)`, and a
  discreet form label (`pesquisa-citacao-pt-forma`, e.g. "forma do foro
  (acórdão)"). Wrapper testid `pesquisa-citacao-pt`.
- **`pages/PesquisarPage.jsx`** - each live `ResultadoCard` now renders a
  `CopiarCitacaoButton` under the citation chip, fed from the hit
  (`{ fonte, titulo, url, excerto, citation }`). No change to the search / verify
  / save flow: the "fonte verificada" badge is still driven solely by
  `verificacaoOk(hit.verification)`, and hits without a resolving URL are already
  dropped by the route.
- **`pages/HistoricoPage.jsx`** - added a per-processo saved-search filter
  (`pesquisa-filtro-processo`, a Select listing only processos that HAVE saved
  searches, each with its count) that narrows the history list
  (`pesquisa-historico-lista`); an honest empty state distinguishes "no searches
  at all" from "no searches in this processo". Each stored citation chip now
  carries a `CopiarCitacaoButton`.

## legal-jurimetria

- **NEW `pages/jurimetria-stats.js`** - pure, app-local statistics with
  provenance. `AMOSTRA_MINIMA = 3`. `construirLinhas(processos, referencias)`
  groups the office's FINDOS (arquivados with abertura/fecho) by area and returns
  rows `{ area, n, mediaMeses|null, suficiente, periodoInterno, refMeses,
  refFonte, refPeriodo }`; an internal average is emitted ONLY when
  `n >= AMOSTRA_MINIMA` (else `suficiente:false`, honest "sem dados suficientes").
  `fonteInterna(linha)` -> "Amostra interna (n=…, fechos ANO-ANO)";
  `fontePublica(linha)` -> "DGPJ… · período" or null; `totalFindos`,
  `comparadorSemDados` helpers. Node-checked: all six seeded areas at n=6 are
  suficiente; a sparse office reports "sem dados".
- **`pages/JurimetriaPage.jsx`** (full rewrite onto jurimetria-stats.js) - the
  comparator table gained two provenance columns, "Fonte interna"
  (`fonte-interna-{area}`) and "Fonte pública" (`fonte-publica-{area}`), so every
  number now carries fonte+período. New honest-empty affordances:
  `interna-sem-dados-{area}` (per-area low-sample cell) and `jurimetria-sem-dados`
  (whole-table panel when no area qualifies). PRESERVED all ported-spec selectors:
  `jurimetria-tabela`, `jurimetria-linha`, `jurimetria-gerar`, `jurimetria-ficha`,
  `interna-{area}`; the ficha still contains `FICHA DE EXPECTATIVAS`,
  `Fonte pública`, `médias históricas`, `Não constituem garantia`.

## legal-portal

- **NEW `cliente/extrato.js`** - pure, app-local. `construirCronologia(vis)`
  builds the client timeline drawn EXCLUSIVELY from resolved visibility
  (`vis.evs` / `vis.docs` / `vis.estados`), sorted newest-first;
  `extratoHtml({ vis, clienteNome, clienteEmail, escritorio, geradoEm }) ->
  { html, filename }` produces a branded, white-label extract HTML (selo + brand
  + summary boxes + chronology table + footer) listing ONLY shared items - empty
  visibility renders "Nada partilhado consigo ainda". By construction a
  non-shared item cannot enter either output. Node-checked.
- **`cliente/ClientePage.jsx`** - inside the `portal-shared` (non-empty) block, a
  Cronologia section (`portal-cronologia`, items `portal-cronologia-item`) and a
  "Descarregar extrato (PDF)" button (`portal-extrato`) that calls
  `window.__ekoa.exportPdf({ html, filename, format: 'A4' })` with the HTML from
  `extratoHtml` and writes a `portal_acesso`-style audit. Both draw from the same
  `vis` (from `resolveVisibility`) as the rest of the page - the explicit-share
  invariant is structural, not a check that can be forgotten.

## New specs (lead: register in SUITE_LEDGER at landing)

All under `web/e2e/`, alongside the byte-frozen ported specs; lint + typecheck
clean. Boot-class waits (20-90s). No protocol stubs except the schema-neutral
`/api/app-pdf` mock in the portal extract test (it only inspects the posted HTML).

- **`legal-x-pesquisa.spec.ts`** (3 tests) - (1) live search over the empty local
  index shows the honest failure state and renders ZERO result cards / ZERO
  citation chips / ZERO "verificada" badges (the badge is never fabricated);
  (2) two searches seeded on two processos, the `pesquisa-filtro-processo` filter
  narrows to each and back to all; (3) a seeded DGSI citation renders exactly
  `Ac. TRL de 12-03-2024, proc. 123/20.0T8LSB` with the acórdão form + copy
  button, and a DRE citation renders as the diploma form. Self-cleaning by nonce
  in `pesquisas.pergunta`.
- **`legal-x-jurimetria.spec.ts`** (2 tests) - (1) every comparator row carries a
  visible internal provenance (`n=…`) AND public provenance (DGPJ), the table
  cites `dados.justica|DGPJ` and `meses`; (2) the internal average is sourced from
  the office's own findos on the spine (cross-checked: >= 3 arquivados with
  abertura/fecho), labelled "Amostra interna", not a public figure. Read-only;
  installs the demo set idempotently.
- **`legal-x-portal.spec.ts`** (2 tests) - seeds one SHARED and one
  never-shared "SEGREDO" document; (1) after sharing only the first, the client
  sees exactly it, the cronologia renders from visibility, and the secret doc name
  appears NOWHERE on the authenticated surface; (2) the branded extrato PDF
  payload (intercepted at `/api/app-pdf`) carries the office brand, lists the
  shared doc, and NEVER contains the secret doc name. Server authz (H-block) is
  explicitly out of scope - these are UI-plane assertions. Self-cleaning by
  timestamped seed teardown.

## What the lead must verify after rebuild

1. Rebuild the three featured apps (mtime rebuild) so the new/edited scaffold
   files land in the served apps.
2. Register the three specs in `api/tests/SUITE_LEDGER.json`.
3. Run the three new specs plus the ported `legal-pesquisa` / `legal-jurimetria`
   / `legal-portal` specs against the rebuilt stack; the ported specs must stay
   green (selectors preserved).
4. WHITE-LABEL FOLLOW-UP (honest gap): the extrato brand uses a hardcoded honest
   default `MARCA_ESCRITORIO = 'Escritório'` in ClientePage.jsx and a matching
   default in extrato.js, because no office/org brand source exists in
   whoami/injected-context today. When a brand field is added to the tenant/office
   identity, thread it through `extratoHtml({ escritorio })`; the portal spec
   asserts on the current default string and will need updating then.
