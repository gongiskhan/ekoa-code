# Featured-artifact production-readiness ledger

WS10 Stage A deliverable (2026-08-08). Scope: evaluate all 42 featured artifacts
(`api/assets/featured-artifacts/*`) for "lawyer-production-readiness" and produce a disposition -
KEEP+UPGRADE or DEMOTE - with per-artifact reasons. This is an EVALUATION-ONLY pass: no manifest,
gallery, or ranking code changed here. Stage B (demotion mechanism) and Stage C (visual/functional
upgrade, gated on WS6 build-intent inference + WS7 design defaults) consume this ledger; neither is
this document.

## Method

Each artifact was reviewed against:
1. The manifest (`manifest.json`: Portuguese `description`, `extends` template kind, `outputKind`,
   `featuredRank` - lower number is more prominent in the existing gallery ordering).
2. Its pre-rendered screenshot at `~/.ekoa/data/artifact-screenshots/<slug>.png` - all 42 exist
   (captured 2026-07-18 in one batch; `cobrancas.png` refreshed 2026-08-06 alongside its rebuild).
   These are produced by `api/src/services/artifact-screenshot.ts` via
   `api/src/apps/featured-builder.ts`'s fire-and-forget, self-healing-only-when-missing capture -
   they do NOT auto-refresh when scaffold source changes, only when the PNG is absent.
3. The scaffold source (`scaffold/frontend/src/`, `seed-data.json` where present) - read for real
   functional depth (working CRUD, calculation engines, state machines) versus a shallow static
   mockup.

Six parallel review passes covered all 42 (7 each); every finding below cites the specific file/
logic the reviewer actually read, not a description-level guess. I then ran a cross-cutting pass
over the redundancy pairs and the compliance finding myself before finalizing dispositions.

## Rubric

- **Domain fit** - would a Portuguese law firm actually use this in its practice (client/case work
  or firm-ops), or is it generic template window-dressing with no connection to the vertical?
- **Functional depth** - real workflows/calculations/state machines wired end-to-end into the UI,
  versus decorative logic files or static mockups.
- **Visual/professional polish** - from the screenshot: consistent design, no lorem-ipsum/
  placeholder text, no broken renders, believable Portuguese content, density appropriate for a
  professional tool handling client data.
- **Legal-domain correctness** (for `legal-*` apps) - correct citation of real statutes/institutions
  (CPC, CIRE, EOA, Lei 83/2017, Citius, RCBE, SinOA, InvoiceXpress...) and honest boundary-keeping
  (human-in-the-loop disclaimers actually enforced in code, not just claimed in the description).
- **Redundancy** - does this artifact duplicate a stronger sibling's job closely enough that both
  being prominently featured reads as an unfinished platform rather than a considered offering?

**Disposition:** KEEP+UPGRADE = on-thesis and functionally real now; queued for a visual/functional
upgrade pass in Stage C. DEMOTE = off-thesis, redundant with a stronger sibling, or actively
undermines credibility/compliance if shown to a prospective legal customer.

## Disposition summary

```
KEEP+UPGRADE (34): ai-assistant, booking-system, erp-imobiliario, help-desk, cobrancas,
quarterly-report, legal-nucleo, legal-dossie, legal-financas, legal-honorarios, legal-tempos,
legal-kanban, legal-agenda, legal-agenda-reservas, legal-prazos, legal-citius, legal-injuncoes,
legal-insolvencias, legal-recursos, legal-calculos, legal-conflitos, legal-kyc, legal-rcbe,
legal-apoio, legal-portal, legal-assinatura, legal-correio, legal-forms, legal-pecas, legal-modelos,
legal-contratos, legal-pesquisa, legal-jurimetria, legal-transcricao

DEMOTE (8): agency-portfolio, ecommerce-catalog, invoice-manager, marketing-landing, pitch-deck,
sales-crm, task-manager, legal-cobrancas
```

The `legal-*` family (29 artifacts) scored KEEP+UPGRADE across the board bar one internal
redundancy (`legal-cobrancas`, superseded by the standalone `cobrancas`) - it is a genuinely
well-researched vertical product (real statute citations, deliberate human-in-the-loop boundaries
enforced in code, a shared "espinha" data model most satellite apps plug into correctly). The
generic, pre-legal-pivot templates fared worse: 6 of the 8 demotions are non-`legal-*` artifacts
that are either off-thesis for a law firm (agency-portfolio, ecommerce-catalog, marketing-landing,
pitch-deck) or redundant with a `legal-*` sibling that already does the same job with case/client
context they lack (sales-crm vs legal-nucleo, task-manager vs legal-kanban).

## Cross-cutting findings (feed Stage B / recorded in `docs/findings.md`)

1. **Compliance conflict: `invoice-manager` natively emits fiscal-looking invoices**, contradicting
   the platform's own stated policy elsewhere in the same gallery (`legal-financas`: "a emissão de
   faturas certificadas passa exclusivamente pela integração InvoiceXpress (AT) - a Ekoa nunca emite
   faturas nativamente"). Logged as an OPEN finding, not just a ledger note - see
   `docs/findings.md`.
2. **Screenshot-seeding gap understates the `legal-*` family.** Most `legal-*` screenshots show an
   empty/zero-data state ("Sem clientes - abra um no Núcleo", empty KPI tiles) because the capture
   runs standalone, without the shared spine's "Fonseca & Associados" demo data seeded. The
   underlying apps are frequently very deep (see e.g. `legal-agenda`, `legal-citius`,
   `legal-calculos`) but their gallery thumbnails currently undersell that. This is a single root
   cause affecting many artifacts at once and is worth fixing before Stage C's visual pass, so the
   "before" comparison isn't measured against an artificially empty screenshot.
3. **Two screenshots show a real broken state, not just empty data**: `booking-system.png` renders
   fully blank content pane (sidebar visible, body white); `sales-crm.png` renders a "Página não
   encontrada" 404 route instead of the dashboard. Both need investigation and a recapture
   independent of any disposition decision.
4. **Ranking anomalies in the existing `featuredRank` data** (pre-dates this audit, not introduced
   by it): `legal-agenda-reservas` has no `featuredRank` at all (schema allows it - the field is
   optional - but it's a gap); `sales-crm` (rank 10) and `task-manager` (rank 20) currently outrank
   every single `legal-*` artifact despite this audit demoting both - they read as leftover ranking
   from before the platform specialized into the legal vertical.
5. **No demotion mechanism exists yet.** `shared/src/artifacts.ts` only has an optional
   `featuredRank: z.number().int().optional()` - there is no `hidden`/`demoted`/`status` field on
   the featured-artifact manifest schema today. Stage B needs to add one (or otherwise decide how a
   demoted artifact stops surfacing prominently in the gallery); this ledger intentionally does not
   prescribe the mechanism.

## Per-artifact ledger

### DEMOTE (8)

- **`agency-portfolio`** (rank 100, landing_page). Creative-branding-agency portfolio site
  ("Atelier Tinta") - visually the most tastefully executed pure design in the whole set, but the
  industry is entirely wrong for a law firm, and its one interactive element (the contact form)
  only calls `setSubmitted(true)` locally - it never actually sends anything.
- **`ecommerce-catalog`** (rank 50, web_app). Competently built retail product/order/customer CRUD
  (stock-level badges, SKU/price/color-tone validation) - but "loja online" inventory and order
  fulfillment has no bearing on a law firm's practice. Off-thesis regardless of build quality.
- **`invoice-manager`** (rank 60, web_app). Working DIY invoice generator - sequential `FT
  {year}/{seq}` numbering, NIF fields, itemized IVA breakdown, print-to-PDF - i.e. exactly the
  uncertified native fiscal-invoice emission the platform's own `legal-financas`/`legal-honorarios`
  explicitly refuse to do for Portuguese tax-compliance reasons. Featuring this template risks a
  lawyer forking it to bill honorários outside certified invoicing software. See finding #1 above.
- **`marketing-landing`** (rank 90, landing_page). Well-executed generic SaaS landing page
  (subscription pricing at EUR19/69/199 per month, "avaliação gratuita de 14 dias", tech-company
  trust-logo strip) - the wrong shape for a law firm's public site (practice areas, credentials,
  case results, consultation CTA), not a copy-swap away from being useful.
- **`pitch-deck`** (rank 110, presentation_html). A polished 12-slide investor-fundraising deck
  (Market/Traction/BusinessModel/Ask - "Procuramos 3,2M€ ... série B"). Portuguese law firms are
  partnerships, not VC-backed startups; the entire premise doesn't apply to the target customer.
- **`sales-crm`** (rank 10, web_app). Solid, real CRUD (DataContext-backed pipeline, realistic
  Portuguese seed data) - but a $-valued deal-pipeline model doesn't match how a firm manages
  clients/processos, `legal-nucleo` already owns that job in law-firm-native terms, and its own
  screenshot currently renders a "Página não encontrada" 404 instead of the dashboard. Its rank 10
  (more prominent than every other artifact in the gallery) no longer makes sense.
- **`task-manager`** (rank 20, web_app). One of the better-built generic templates reviewed (full
  CRUD, computed overdue/priority stats, clean empty state) - but `legal-kanban` already provides
  the same kanban job with client/matter context this one cannot have (its tasks are isolated from
  any case record). Its rank 20 is a clear leftover from before the legal-* family existed.
- **`legal-cobrancas`** (rank 60, web_app). Real engineering (Ifthenpay/Stripe webhook
  reconciliation, WhatsApp opt-out citing RGPD + EOA) on the identical job as the standalone
  `cobrancas` artifact - which, on direct comparison, is deeper (a full per-profile escalation
  engine, a legally-cited interest calculator with an integer-cent audit trail, an approval-gated
  compliant email workflow, a real `engine/tests/` suite) and fresher (rebuilt/rescreenshotted
  2026-08-06, task "Port the Cobranças featured artifact"). Two "Cobranças" apps side by side in the
  gallery reads as an unfinished platform. Before fully retiring `legal-cobrancas`, Stage C should
  check whether its webhook-reconciliation and WhatsApp-opt-out mechanisms are worth porting into
  `cobrancas`, since `cobrancas` currently lacks a payment-gateway webhook of its own.

### KEEP+UPGRADE (34)

Grouped by family; each entry: what's real, what Stage C should prioritize.

**Firm-ops / non-legal, kept on merit**

- **`ai-assistant`** (rank 70, agent_app). Real knowledge-retrieval scorer (tokenized set-overlap
  matching against seeded documents) plus a genuine fire-and-forget call into the platform's own
  `/api/v1/request` agent endpoint - not a stub. Upgrade: reskin the seed data from retail
  returns/store-hours to a legal-services scenario (honorários/prazos FAQ) so the demo reads as
  built for a law firm, not a retailer.
- **`booking-system`** (rank 40, web_app). Real month-grid calendar CRUD backed by realistic seed
  data (5 services, 6 customers, 10 bookings, a full weekly availability schedule including a
  closed Sunday). BLOCKING: its screenshot currently renders fully blank - recapture (and confirm
  it isn't a real render bug) before Stage C investment.
- **`erp-imobiliario`** (rank 35, web_app). The single deepest artifact in the entire audit: a
  ~10,700-line `App.jsx` with OFX/CSV/XLSX/PDF bank-statement parsing, a TOConline import parser,
  Jaccard-similarity auto-categorization, a full DRE, and role-based permissions - production-grade
  financial engineering. The "Imobiliário" (real-estate/apartment-portfolio) framing is off-thesis
  for a law firm gallery, but the underlying engine is firm-wide treasury/accounting, not
  matter-level - complementary altitude to `legal-financas` (which is client/matter-level), not
  redundant with it. Upgrade: de-verticalize the naming/copy away from apartment-portfolio specifics
  so it reads as general firm accounting/treasury.
- **`help-desk`** (rank 80, web_app). Real ticket lifecycle wired to the platform's actual
  `/api/v1/action` integration contract (with a correct "needs_integration" fallback CTA). Plausible
  firm-ops fit for client query/support tracking. Note for Stage C: check for surface overlap with
  `legal-portal`'s two-way client messaging before investing in both.
- **`quarterly-report`** (rank 120, presentation_html). Real computed SVG bar chart (actual vs.
  plan, derived YoY%) rather than a static image; the Highlights/Revenue/Customers/Operations/Plan
  slide shape maps onto a firm's internal partner/management review reasonably well, unlike
  `pitch-deck`'s investor framing. Upgrade: swap SaaS-specific copy (ARR, "distribuidores") for
  professional-services equivalents (billables, clients, practice priorities).
- **`cobrancas`** (rank 30, web_app). The audit's flagship: a per-profile escalation engine
  (promise-to-pay handling, frequency caps, digest coalescing), a legally-cited moratory-interest
  calculator (Art. 559.º CC, DL 62/2013, integer-cent precision, full "showWork" audit trail), bank
  reconciliation with auto-learned matching rules, and an approval-gated client-communication queue
  - directly aligned with EOA deontological expectations. Freshest and deepest of the two
  "Cobranças" apps (see `legal-cobrancas` demotion above).

**The `legal-*` shared-spine core**

- **`legal-nucleo`** (rank 40) - the shared client/case data model (29 collections) the rest of the
  family plugs into; idempotent self-healing seeding with cross-tab Web Locks concurrency handling.
  Demoting the spine would break every satellite app's premise - keep it prominent.
- **`legal-dossie`** (rank 45) - per-case compilation view with correct matter-confidentiality
  enforcement ("sigilo entre processos") and real print/PDF export.
- **`legal-financas`** (rank 59) / **`legal-honorarios`** (rank 43) - confirmed complementary, not
  redundant: honorários computes a fee pre-invoice (cent-precision, re-entrancy-guarded,
  `showWork`-transparent) and tags it `origem: 'honorarios'`; finanças' Faturação page consumes
  exactly that tag to queue certified InvoiceXpress emission, while its own Conta Corrente/
  Despesas/Provisões pages cover the broader client-ledger scope honorários doesn't touch. Both
  correctly hard-refuse native invoice emission.
- **`legal-tempos`** (rank 46) - time capture that feeds honorários via an idempotent transfer
  (`onTransferir` re-fetches and searches for an orphaned lançamento before creating a new one,
  never double-bills). Deliberately has no billing UI of its own - a feed, not a duplicate.
- **`legal-kanban`** (rank 47) - task board over the shared `tarefas` collection; correctly treats
  `estado` as canonical and column placement as presentation-only, so it can't desync from Núcleo's
  task list. This is the sibling `task-manager` was demoted in favor of.
- **`legal-agenda`** (rank 52) / **`legal-agenda-reservas`** (rank MISSING - see finding #4) - team
  calendar plus paid public booking; a real multi-participant free-slot intersection engine and a
  payment-webhook handler that re-verifies availability at confirmation time and cancels-with-
  notification on a detected double-booking race, rather than silently overwriting. The strongest
  backend logic in the whole audit. Upgrade: assign `legal-agenda-reservas` a `featuredRank` and
  recapture its screenshot with seeded session types (currently an honest but unappealing "no
  sessions available" empty state).

**Deadline / credit-recovery engines**

- **`legal-prazos`** (rank 41) - CPC deadline engine; computes Easter via Meeus/Jones/Butcher to
  derive movable holidays, models férias judiciais, implements the Art. 139.º/5 fine window, and
  fails fast on an unknown regime rather than silently defaulting. Anchor artifact - Citius,
  Insolvências and Injunções all delegate to it.
- **`legal-citius`** (rank 42) - the most defensively engineered logic in the audit: only trusts an
  authenticated `@citius.mj.pt` sender for automated deadline creation, strips hidden HTML
  (anti-spoofing), and has an explicit negation-window check so it won't fire on phrases like "sem
  contestação".
- **`legal-injuncoes`** (rank 64) - correct DL 269/98 (EUR15,000 cap) vs. DL 62/2013 (uncapped,
  commercial-only) eligibility split; explicitly does not compute interest/fees itself, delegating
  to `legal-calculos` by design (documented boundary "FRONTEIRA P2-001").
  `legal-insolvencias` (rank 66) - correctly reuses the shared prazo engine with `regime: 'cire'`
  for the CIRE Art. 9.º continuous (non-suspending) 30-day count rather than reimplementing it.
- **`legal-calculos`** (rank 61) - moratory-interest and court-fee (RCP) engine; integer-cent
  arithmetic, per-tranche legal citations, and marks any gap in its rate table `incompleto`/
  `'confirmar'` with zero interest rather than guessing - the strongest "cite your source, flag your
  uncertainty" discipline in the audit. Complementary with `legal-prazos` (dates vs. money), not
  redundant.
- **`legal-recursos`** (rank 48) - firm-internal HR (leave entitlement correctly implementing
  Código do Trabalho Art. 238.º/239.º, including the admission-year proration rule), a different job
  from its deadline-engine batch-mates but a legitimate one; also hard-blocks clinical notes from
  ever being collected for sick-leave records (a real data-minimization decision).

**Compliance / client-facing**

- **`legal-conflitos`** (rank 49) - Art. 99.º EOA conflict check with diacritic-folding search and a
  mandatory human decision field; a real UI-rendered disclaimer (`conflitos-disclaimer` test id).
- **`legal-kyc`** (rank 54) / **`legal-rcbe`** (rank 65) - Lei 83/2017 risk engine (weighted PEP/
  country/channel factors, leap-year-safe 7-year retention) and RCBE obligation calendar; their
  claimed shared-data link is VERIFIED real in source (both read/write the identical
  `beneficiarios_efetivos` collection, code-commented "P2-007: UMA estrutura, duas apps"), not just
  asserted in the manifest.
- **`legal-apoio`** (rank 58) - SinOA/legal-aid workflow; reuses the same rigorous deadline engine
  (Easter algorithm, judicial recess, CIRE handling) and is honest that it never submits on the
  lawyer's behalf, matching SinOA's real lack of a public submission API.
- **`legal-portal`** (rank 53) - dual-audience app (office admin + a genuinely separate
  client-facing `/cliente*` portal) with per-app credential isolation (client passwords never touch
  office-wide data), explicit invisible-by-default sharing, and an audit-trail writer - the security
  model is real in the code, not just described.
- **`legal-assinatura`** (rank 44) - qualified e-signature envelope state machine correctly modeling
  the Portaria 350-A/2025 transition (advanced tolerated through 2026, qualified mandatory from
  2027); honestly marks unavailable provider stubs as `disponivel:false` rather than faking them.
- **`legal-correio`** (rank 55) - registered-mail tracking; explicit in comments that its reference
  format is NOT the real CTT reference and handles all three real outcomes of a tracking lookup
  (events / no-info / provider-unavailable) gracefully - the "desenho honesto" the manifest claims.

**Drafting / research / analytics**

- **`legal-modelos`** (rank 51) -> **`legal-contratos`** (rank 44) -> **`legal-pecas`** (rank 57):
  confirmed as three genuinely distinct, non-redundant pipeline stages (official-source template
  library with documented licensing exclusions -> wizard-generated contracts from spine data ->
  procedural-pleading drafting with citation/calc-memo insertion from `legal-pesquisa`/
  `legal-calculos`) - verified by reading the shared `variaveis`/origem schema contract in
  `modelos-util.js`. `legal-modelos` has the best-realized screenshot in the entire audit (a
  populated grid of real, correctly-licensed template cards).
- **`legal-forms`** (rank 50) - distinct again (AcroForm PDF field-filling, not docx generation):
  FNV-1a template fingerprinting, confidence-scored auto-mapping, and learned-layout memory that
  improves across repeat filings.
- **`legal-pesquisa`** (rank 56) - the audit's strongest domain-correctness result: the "never
  invent a source" discipline is enforced in the logic layer itself (`hitsParaCitacoes` silently
  drops any hit without a URL rather than fabricating one), not just claimed in copy.
- **`legal-jurimetria`** (rank 67) - correctly scoped as descriptive statistics, never outcome
  prediction, and the ethical framing repeats through the manifest, page copy, and the generated
  client-facing sheet. BUT it is the thinnest artifact reviewed (~125 lines) and its own
  `referencias.json` flags every national average it cites as `"nota": "confirmar"` - i.e.
  placeholder pending real DGPJ ingestion - while the table presents each figure next to a specific
  source/period as if final. Upgrade priority: wire the real DGPJ data source (already scaffolded)
  before this is fully lawyer-trustworthy; also fix a copy typo ("saram-se" -> "sanam-se").
- **`legal-transcricao`** (rank 63) - Art. 640.º CPC appeal-excerpt export is hard-gated behind a
  `revisto` (reviewed) state in code (`if (!row || row.estado !== 'revisto') return`), not just
  described as reviewed-first; RGPD-conscious retention copy and a judicial-secrecy upload flag.

## Stage B / Stage C notes (non-binding - Stage B owns the mechanism)

- No `hidden`/`demoted` field exists on the featured-artifact manifest schema
  (`shared/src/artifacts.ts`) today; `featuredRank` is optional and currently just an ordering hint,
  not a visibility gate. Stage B needs to decide the mechanism (a new field, a curated allowlist in
  the gallery route, or repurposing `featuredRank` with a reserved "demoted" band) - this ledger
  intentionally stops at "which 8 slugs" rather than prescribing "how."
- Recommend Stage C re-run the screenshot capture WITH the shared spine's demo data seeded before
  any before/after visual comparison, given finding #2 above - several `legal-*` artifacts will look
  far better than their current gallery thumbnail once that's fixed, independent of any new design
  work.
