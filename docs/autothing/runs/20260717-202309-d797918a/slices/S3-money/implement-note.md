# S3-money - implement note (run 20260717-202309-d797918a)

Implementer note for the money slice: calculos, honorarios, financas, cobrancas,
injuncoes. All rules honored: NO uncited number, additive engine changes only,
frozen legal-*.spec.ts untouched, shared scaffold layer untouched, dev stack not
touched (edits are invisible until the lead's rebuild).

## Rate table (api/assets/legal-engines/tabelas-taxas.json, versao 2)

Juros de mora comerciais - 28 semiannual rows, 2013-S1 through 2026-S2, every
row citing its Aviso. Verified current through 2026 by web search against the
DGTes/DR series:

| Semestre | Taxa | Fonte | Verificacao |
|----------|------|-------|-------------|
| 2025-S1 | 11,15% | Aviso n.º 1278/2025/2, DGTF | verified (DR) |
| 2025-S2 | 10,15% | Aviso n.º 16792/2025/2, ETF | verified (DR) |
| 2026-S1 | 10,15% | Aviso n.º 822/2026/2, ETF | verified (DR) |
| 2026-S2 | 10,40% | Aviso n.º 16623/2026/2, ETF | verified (DR) |

Civil rate: 4% (Portaria n.º 291/2003). UC: 102,00 EUR for 2024/2025/2026 -
2025 held by Lei n.º 45-A/2024 (OE 2025); 2026 held by art. 242.º da Lei n.º
73-A/2025, de 30 de dezembro (OE 2026). Retencao IRS: 23%.

**Known defect (report-only, frozen-pin bound):** the 2023 rows keep the
byte-identical citations 'Aviso n.º 1261/2023, DGTF' / 'Aviso n.º 20214/2023,
DGTF' because the byte-frozen legal-calculos.spec.ts pins them in its 2023
golden. The factually correct 2023 Avisos are 1672/2023 (S1) and 14922/2023
(S2). The RATES are correct; only these two citation strings are wrong.
Changing them requires editing the frozen spec - lead authority, logged for
findings.

**Seed overlay heal:** the spine seeds `tabelas_taxas` marker rows with
aviso/nota `'confirmar'` (2025-S2 carried a wrong 10,25 placeholder vs the
verified 10,15). App-local `tabelas-heal.js` (curarTabelasTaxas) deletes ONLY
literal marker rows on Calculos app load - never crawler-written rows, never
the whole collection. First load of Juros/Custas heals permanently.

## Per-app changes (all app-local; shared layer untouched)

### legal-calculos
- `tabelas-heal.js` (new): marker-row heal, awaited by JurosPage + CustasPage
  before `obterTabela()`.
- `pages/exportar-pdf.js` (new): exportPdf-bridge helper (documentoHtml with
  table/aviso-legal/rodape styles, escapeHtml, pdfDisponivel).
- JurosPage/CustasPage: heal await; `custas-uc-base` testid exposes the cited
  UC base (art. 242.º Lei 73-A/2025 for 2026).
- MemoriasPage: real PDF export per memoria via the bridge (window.print
  fallback outside the platform); rodape cites Avisos DGTF/ETF, RCP,
  Portaria 291/2003.

### legal-honorarios
- `pages/exportar-pdf.js` (new, byte copy).
- PreFaturasPage: `pf-imprimir` rewired to real PDF export ("Não é fatura
  certificada" in body + rodape); `pf-origem-tempos` badge on eligible
  lancamentos with `registoTempoId`.
- LancamentosPage: `lanc-origem-tempos` "Do Tempos" badge.
- tempos->honorarios is a data-shape contract ONLY: honorarios reads
  `lancamentos` in the exact shape tempos' buildLancamentoPayload writes
  (processoId, clienteId, tipo 'honorario', modo 'hora', horas, tarifaHora,
  valor, data, faturado:false, registoTempoId). Tempos app untouched.

### legal-financas
- `pages/financas-csv.js` (new): pure CSV builder - BOM, ';' separator, comma
  decimals, CRLF, signed credits, and the ALWAYS-present disclaimer line
  "Documento de conferência gerado pela app Finanças (Ekoa) - não é extrato
  contabilístico certificado."
- ContaCorrentePage: optional per-processo filter (`cc-processo`; default ''
  keeps the frozen default-filter pins 885,60/500,00/385,60 intact); honest
  exclusion notice `cc-sem-processo-aviso` for movements without processoId;
  new KPI `cc-provisoes` (sum of estado 'recebida' saldos in scope);
  `cc-exportar-csv` download of the current scope.
- DespesasPage: `despesas-filtro-processo` + honest visible-rows totals line
  `despesas-total-filtro`; approving a despesa now stamps the CC debito with
  `processoId` + `despesaId` (additive fields).
- ProvisoesPage: receiving a provisao stamps the CC credito with `processoId`
  + `provisaoId` (additive fields). Old rows without processoId keep working
  and are declared, not hidden.

### legal-cobrancas
- Engine `cobrancas.mjs` (canonical + byte-synced scaffold copy - diff
  verified): ADDITIVE exports `AGING_NEXT_ACTION`/`proximaAcaoBucket`
  (0-30 lembrete; 31-60 interpelacao, art. 805.º/1 CC; 61+ injuncao, DL
  269/98) and `cartaInterpelacao` (pure, deterministic). Honesty encoded:
  without a calculos result the letter NEVER carries a rate or interest figure
  (arts. 805.º/806.º CC, "a liquidar à data do pagamento", no '%' anywhere);
  with juros it cites art. 102.º CCom + DL 62/2013 + every troço's Aviso;
  the deadline counts from RECEPTION (prazoEstimado is an estimate only);
  missing sender leaves the signature blank. Existing exports untouched.
- CobrancasPage: `aging-*-acao` next-action hints per escalao (frozen spec
  reads only `*-count` innerText - safe).
- CobrancaDetailPage: new EscaladaCobranca card - `cobranca-proxima-acao`,
  `cobranca-carta-gerar` (juros from the LIVE calculos service, P2-001; on
  service failure the letter degrades honestly + error toast),
  `cobranca-interpelacao-texto`, `cobranca-carta-nota`, `cobranca-carta-pdf`
  (bridge), `cobranca-injuncao-link` deep-link
  `/apps/legal-injuncoes/?cobranca=<id>`.
- `pages/exportar-pdf.js` (new, byte copy).

### legal-injuncoes
- Engine `injuncoes.mjs` UNTOUCHED (elegibilidade DL 269/98 art. 1.º /
  DL 62/2013 art. 10.º, state machine, requerimento format Portaria
  220-A/2008 red. 267/2018 already correct).
- InjuncoesPage: receives the `?cobranca=` handoff - preselects a valid
  vencida; ghost/ineligible ids get the honest `injuncao-atalho-aviso`
  (never a silent substitute).
- InjuncaoDetailPage: `injuncao-requerimento-pdf` conference-minute export
  (pedido table, exposicao de factos, fundamentacao with elegibilidade +
  per-troco Avisos + RCP/UC cite, aviso-legal "não é o formulário oficial do
  BNI nem uma submissão"), logs `requerimento-exportado` proveniencia
  'manual-assistido'; `injuncao-trilho` lifecycle card; BNI card link-outs to
  the VERIFIED official portals: Citius (citius.tribunaisnet.mj.pt -
  electronic submission is mandatory via Citius for mandatarios) and
  Justiça.gov.pt injunction-document consultation. Note: the brief said
  "BALCAO+" - implemented as BNI/Citius + Justiça.gov.pt since those are the
  verified official portals; no API is faked, manual-first with provenance
  events (frozen spec's bni-passo-0..3 flow untouched).
- `pages/exportar-pdf.js` (new, byte copy).

## Additivity proof

- Full legal unit suite was green after the table rewrite (109/109 earlier in
  the run); the three S3 unit files re-verified green at the end: 17/17
  (calculos-taxas-2026 6, financas-csv 5, cobrancas-carta 6).
- `computeAging`/`reconcileCobranca` behavior pinned unchanged
  (cobrancas-carta.test.ts additivity golden + frozen legal-cobrancas.spec.ts).
- Frozen default-filter pins of legal-financas.spec.ts preserved by design
  (processo filter defaults to '' = original behavior).
- Engine copies byte-identical (diff -q: COBRANCAS-SYNCED, EXPORTPDF-SYNCED).
- `npm run typecheck` clean; `npm run lint` 0 errors (241 pre-existing
  warnings elsewhere, none in S3 files).

## Unit tests (api/tests/legal/)

- `calculos-taxas-2026.test.ts` - 4-troco golden 2025-01-01 -> 2026-07-17
  (161351c), isolated 2026-S2 pin (10,40%), civil 4%, 28-row Aviso-format
  hygiene, UC bases. 6/6.
- `financas-csv.test.ts` - byte-exact extrato golden, disclaimer-always pin,
  processo header variant, csvCampo escaping, eurCsv pins. 5/5.
- `cobrancas-carta.test.ts` - sem-juros honesty (no '%'), com-juros golden
  (11613.51; all 4 Avisos cited), purity, prazo degradation, next-action
  ruler, computeAging additivity. 6/6.

## New e2e specs (web/e2e/) - NOT yet run (lead serializes rebuild + e2e)

- `legal-x-calculos.spec.ts` - marker heal reaches zero; 4-troco juros via UI
  with all four 2025/2026 Avisos as badges + memoria; custas cites the 2026 UC
  base (Lei 73-A/2025) and 102,00; memoria exports a real PDF.
- `legal-x-honorarios.spec.ts` - tempos-shaped lancamento gets "Do Tempos" in
  Lancamentos + pf-elegiveis; pre-fatura calc + real PDF export.
- `legal-x-financas.spec.ts` - per-processo view (honest exclusions,
  provisoes KPI, saldo per scope); CSV download content-checked (disclaimer,
  processo header, signed rows); despesas processo filter + honest totals.
- `legal-x-cobrancas.spec.ts` - aging next-action cites per escalao; carta
  com juros from the live service + PDF; injuncao deep-link href.
- `legal-x-injuncoes.spec.ts` - ?cobranca= handoff (valid preselect + honest
  ghost notice), elegibilidade cites toggle (DL 62/2013 vs DL 269/98); criar
  -> trilho 'Criada', Citius/Justica.gov.pt link-outs, service-calculated
  juros/taxa, requerimento PDF + 'requerimento-exportado' provenance event.

All five: legalAppUrl idiom, spine fixtures via page.evaluate, per-run nonce +
self-cleaning afterEach, zero-pageerror assertions, 90s boot-class first waits
and 60-90s PDF-bridge waits. Ledger registration (SUITE_LEDGER.json,
playwright.band3_served_app) is the lead's landing step.

## What the lead must verify after rebuild

1. Rebuild picks up the five scaffolds (mtime-based featured-builder) and the
   canonical tabelas-taxas.json.
2. Frozen suite still green - especially legal-calculos (2023 golden 560,96 +
   'a confirmar' badge), legal-financas (885,60/500,00/385,60), legal-cobrancas
   (aging counts + reconciliation), legal-honorarios, legal-injuncoes.
3. The five new legal-x-* specs green; then register them in SUITE_LEDGER.
4. findings.md entry (lead-owned file) for the 2023 Aviso citation defect.
