# S2-court-deadlines - implement note

Run `20260717-202309-d797918a`, slice S2. Implementer note - written before the lead's rebuild,
so all UI-level claims below are "verified in source + node", not "seen in the served app".

## Engine: ZERO changes (proof)

No engine file was touched by this slice. `computePrazo` already supported everything S2 needed
(`regime: 'cire'`, `contagem: 'corridos'`, `suspendeFerias`), so the additive-only requirement was
met by making no change at all.

- sha256 of `api/assets/legal-engines/prazo.mjs` and all four per-app copies
  (`legal-{prazos,citius,apoio,insolvencias}/scaffold/frontend/src/engine/prazo.mjs`) is identical:
  `88c680ce12cf4f63dd8e4e60acb90af59576252fe4c690dfbec815c9dda5b662`.
- `git status api/assets/legal-engines/` shows `prazo.mjs` and `citius-*.mjs` clean (the dirty
  engine files there - cobrancas.mjs, kyc.mjs, tabelas-taxas.json - belong to other slices).
- Golden values re-verified with plain `node` against the canonical engine (all GREEN):
  - 2026-06-05 + 5 uteis -> 2026-06-15
  - 2026-09-07 + 5 uteis -> 2026-09-14
  - 2026-09-07 + 30 corridos -> 2026-10-07
  - 2026-07-10, regime cire, 30 -> 2026-08-10 (multaAte 2026-08-13)
  - 2026-07-10 + 30 uteis suspendeFerias -> 2026-10-08
  - 2026-09-07 + 15 corridos -> 2026-09-22
  - Pascoa 2026 = 2026-04-05 (Ramos 2026-03-29, 2.ª-feira 2026-04-06)

## Per-app changes (seed edits - invisible until the featured-builder rebuild)

All paths below are under `api/assets/featured-artifacts/<app>/scaffold/frontend/src/`.
The frozen shared layer (shared.js, styles.css, demo-spine.js, demo.js, components/*) was not touched.

### legal-prazos
- NEW `pages/ics.js` - `construirIcsPrazos(prazos, {processoNumero})`: deterministic RFC 5545
  builder. Fixed `PRODID:-//Ekoa Legal//legal-prazos//PT`, `X-WR-TIMEZONE:Europe/Lisbon` +
  VTIMEZONE block, UID `prazo-<spineId>@ekoa-legal`, all-day `DTSTART/DTEND;VALUE=DATE` (DTEND
  exclusive +1d), `SUMMARY:Prazo: <descricao>`, VALARM `TRIGGER:-P2D` with `DESCRIPTION:D-2: ...`.
  CRLF line endings, 74-octet folding. Excludes estado 'cumprido'; rows with invalid dataLimite
  are counted in `ignorados` (never emitted as broken VEVENTs). No now()-derived content, so two
  consecutive exports are byte-identical.
- NEW `pages/FeriasPage.jsx` - ferias judiciais view at `/ferias`: year Select (anoAtual-1..+2),
  the three periods engine-derived via `isFeriasJudiciais`/`domingoPascoa` boundaries, feriados
  from `feriadosNacionais(ano)`. Cites LOSJ (Lei n.º 62/2013, art. 28.º) + CPC art. 138.º n.º 1,
  and contrasts CIRE art. 9.º n.º 1 (insolvency runs through ferias).
- NEW `pages/memoria-pdf.js` - `memoriaCalculoHtml({resultado, processoLabel})`; filename
  `memoria-prazo-<dataNotificacao>-<dias><contagem>`.
- EDITED `App.jsx` (nav + route + title for /ferias), `CalculadoraPage.jsx` (button
  `exportar-memoria`, exportPdf-bridge guard with honest error toast), `PrazosListPage.jsx`
  (button `exportar-ics`, honest incluidos/ignorados toast).

### legal-citius
- NEW `pages/triage-commit.js` - `confirmarTriagem(...)`: idempotent (re-reads the notif; returns
  `ja-tratada` if already matched), writes prazo (origem 'citius', metadata.notificacaoId) +
  evento tipo 'citius-notificacao' to the spine, updates the notif to matched with prazoId +
  dataLimite mirror, and rings the bell with a deep-link href. `propostaAutomatica(...)`: only
  proposes when ato has a regra, data is valid, and the processo resolves - otherwise honest
  needs-review. `origemNotif(...)`: 'email' vs 'colada' from sourceRef/contentRef, null when
  unknowable.
- NEW `pages/colar-split.js` - `splitNotificacoes(raw)`: separator lines (`[-_=]{3,}`) always
  split; blank-line blocks split only when every block independently looks like a notification
  (processo number + ato keyword or labelled date); otherwise the paste stays one segment.
- EDITED `InboxPage.jsx` - bulk triage: per-row checkboxes (`bulk-select-<id>`), bulk bar with
  honest "N selecionada(s) · M pronta(s) para confirmar", bulk confirm with a parts-joined honest
  result ("2 confirmadas · 1 mantida para revisão"); per-row origem Badge ('Email'/'Colada');
  bottom card `citius-email-canal` surfacing the onEmail backend honestly (origem nao autenticada,
  nunca cria prazo sozinho, alertedAt semantics).
- EDITED `ColarPage.jsx` - multi-notification paste: splits, per-segment results
  (`citius-resultado-seg-<i>`) + summary `citius-multi-resumo`.
- EDITED `NotificacaoPage.jsx` - delegates confirm to `confirmarTriagem`; Origem row; dossie
  deep-link anchor `abrir-dossie` -> `/apps/legal-dossie/processo/<processoId>`.

### legal-apoio
- EDITED `pages/apoio-logic.js` - ADDITIVE: `PRAZOS_TIPO_PEDIDO` (nomeacao: 30 dias corridos,
  Lei n.º 34/2004 art. 33.º; escusa: 15 dias corridos, art. 34.º) and `gerarPrazosPedido(tipo,
  data)` = SinOA pair + tipo extras (each extra carries `fonte` + engine `resultado`).
  `proteccao_juridica` output is JSON-identical to `gerarPrazosSinOA` (node-verified), so the
  frozen legal-apoio spec's golden (exactly 2 origem-'apoio' prazos) is untouched.
- NEW `pages/pack-pdf.js` - `packPedidoHtml(...)`: deterministic SADT pedido pack from spine data
  (identificacao, prazos with fontes, honorarios/despesas with registoRef, fontes legais, honest
  "submissao no SinOA e manual" aviso). Filename `pack-apoio-<pedidoId>`.
- EDITED `pages/PedidoDetailPage.jsx` - prazos preview + registration now via `gerarPrazosPedido`;
  each generated prazo persists `regraAplicada` when it has a fonte; per-prazo fonte line
  (`apoio-prazo-fonte-<idx>`); pack button `apoio-pack-pdf` through the exportPdf bridge with
  guard + honest toasts.

### legal-insolvencias
- EDITED `pages/InsolvenciasPage.jsx` - live comparativo while filling the despacho date:
  CIRE block (`insolv-cire-limite`, citation `insolv-cire-citacao` quoting CIRE art. 128.º n.º 1,
  art. 9.º n.º 1, CC art. 279.º al. e)) visually distinct (solid accent border) from the
  hypothetical CPC block (`insolv-cpc-limite`, dashed + "NAO se aplicam aqui"). The spine prazo
  now carries `tipoContagem: 'corridos'`, a descricao naming the continuous counting, and
  `regraAplicada` with the art. 128.º citation; deliberately NO multaAte (art. 139.º multa is a
  CPC figure, legally dubious for reclamacao de creditos).
- EDITED `pages/InsolvenciaDetailPage.jsx` - contagem Badge ("Dias continuos - CIRE art. 128.º"),
  CPC contrast paragraph (`insolv-cpc-contraste`), 6-item credor checklist persisted on the
  insolvencia row (`insolv-check-<key>`, progresso "N de 6"), deep-links card: cobranca
  (`/apps/legal-cobrancas/cobranca/<id>`) + injuncoes (`/apps/legal-injuncoes/`) with honest
  devedor-insolvente copy.

## New specs (4 - ledger registration is the lead's job at landing)

- `web/e2e/legal-x-prazos.spec.ts` - 3 tests: deterministic .ics (byte-identical double download,
  PRODID/UID/VALARM D-2 pins, honest exclusions, CRLF-only); ferias view (LOSJ citation + 2026
  engine dates + year switch); memoria PDF via the golden calculadora flow (real download,
  filename `memoria-prazo-2026-06-05-5uteis.pdf`).
- `web/e2e/legal-x-citius.spec.ts` - 3 tests: bulk triage (3 injected notifs, selective-only
  checkboxes - never select-todas, honest "2 confirmadas · 1 mantida", spine verification of
  prazo/evento/matched + dossie deep-link href); multi-notification paste (`---` separator, 1
  matched + 1 needs-review, spine truth); email-canal honesty panel copy.
- `web/e2e/legal-x-apoio.spec.ts` - 2 tests: nomeacao via real UI (SinOA pair + art. 33.º prazo,
  golden 2026-09-07 -> 2026-10-07, fonte on panel + regraAplicada in spine); escusa (art. 34.º,
  2026-09-07 -> 2026-09-22) + pack PDF real download `pack-apoio-<id>.pdf`. afterEach includes
  the same origem-'apoio' backstop delete the frozen spec uses.
- `web/e2e/legal-x-insolvencias.spec.ts` - 1 test: comparativo golden (despacho 2026-07-10 ->
  CIRE 2026-08-10 vs CPC 2026-10-08) with citations; spine prazo corridos + art. 128.º regra;
  checklist persistence across a reload; deep-link hrefs. Creates its own cobranca via the spine
  API (frozen-spec idiom) and cleans everything up.

All specs: nonce/stamp-tagged fixtures, afterEach cleanup, zero-pageerror assertion, screenshots
under `.playwright-cli/`.

## Verification already done (pre-rebuild)

- `npm run typecheck` - PASSED (shared/api/web, includes the 4 new specs).
- `npm run lint` - 0 errors; 220 pre-existing warnings, none from S2 files.
- Node checks of every pure module (ics builder, colar-split, triage proposta, apoio prazos +
  pack html, comparativo values) - ALL GREEN, including proof that `proteccao_juridica` output is
  byte-identical to the pre-S2 SinOA pair.

## What the lead must verify after rebuild

1. Rebuild picks up the seed edits (mtime), then run the 4 new specs:
   `legal-x-prazos`, `legal-x-citius`, `legal-x-apoio`, `legal-x-insolvencias`.
2. Confirm the frozen specs stay green: `legal-prazos`, `legal-citius`, `legal-apoio`,
   `legal-insolvencias` (S2 was designed around their pins; apoio is the sensitive one - the
   tipo extras append AFTER the SinOA pair and the new spec backstop-deletes origem-'apoio').
3. Register the 4 new specs in the suite ledger (lead-owned file).

## Risks / known limits (honest)

- The two PDF assertions (memoria, pack) depend on `/api/app-pdf`'s server-side Chromium pool;
  if the pool is unavailable the server returns 503 and the specs fail on download timeout -
  that failure is the honest surfacing of an environment defect, not a spec bug. S1's agenda
  spec proves real downloads work in this environment today.
- The ferias spec pins 2026 dates via explicit `selectOption('2026')`; the year select spans
  anoAtual-1..anoAtual+2, so the pin stays selectable through calendar year 2027 and would need
  a re-pin in 2028.
- FeriasPage uses `.card-header`/`.list-plain` class names that do not exist in the frozen
  styles.css; layout is carried by inline styles, the class names are inert.
- Seed edits are invisible at :4111 until the lead's rebuild; nothing in this slice was verified
  against the served apps post-edit (by design - runtime is lead-serialized).
