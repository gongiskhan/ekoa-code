# Featured-artifact production-readiness ledger

WS10 Stage A deliverable (2026-08-08). Scope: evaluate all 42 featured artifacts
(`api/assets/featured-artifacts/*`) for "lawyer-production-readiness" - would a Portuguese lawyer
put this in front of a client or use it in real practice TODAY - and produce a disposition,
KEEP+UPGRADE or DEMOTE, with per-artifact reasons. This is an EVALUATION-ONLY pass: no manifest,
gallery, or ranking code changed here. Stage B (demotion mechanism) and Stage C (visual/functional
upgrade, gated on WS6 build-intent inference + WS7 design defaults) consume this ledger; neither is
this document. This supersedes and merges two review passes done the same day - the second, more
detailed brief arrived after the first pass had already shipped; nothing from either pass is
dropped here.

## Method and its limitation

Each artifact was reviewed against:
1. The manifest (`manifest.json`: Portuguese `description`, `extends` template kind, `outputKind`,
   `featuredRank` - lower number is more prominent in the existing gallery ordering).
2. Its pre-rendered screenshot at `~/.ekoa/data/artifact-screenshots/<id>.png` - all 42 exist
   (captured 2026-07-18 in one batch; `cobrancas.png` refreshed 2026-08-06 alongside its rebuild).
   These are produced by `api/src/services/artifact-screenshot.ts` via
   `api/src/apps/featured-builder.ts`'s fire-and-forget, self-healing-only-when-missing capture -
   they do NOT auto-refresh when scaffold source changes, only when the PNG is absent.
3. The scaffold source (`scaffold/frontend/src/`, `seed-data.json` where present) - read for real
   functional depth (working CRUD, calculation engines, state machines) versus a shallow static
   mockup, and for PT-PT copy quality, Ekoa branding consistency, and the presence of the built-in
   assistant surface where the artifact's base should carry one.

This is screenshot-plus-source review, NOT live interaction - nothing was booted, clicked, or driven
through Playwright for the evaluation itself (several sibling WS agents had uncommitted edits in
this working tree at the time, so booting anything was off the table regardless). A screen that
never renders a particular state (an error toast, a multi-step wizard's second screen, a hover
tooltip) was not seen. Where source code closes that gap - e.g. confirming a button actually calls a
real endpoint rather than only reading its JSX - it is cited explicitly below; where it does not,
the artifact is judged on what was actually visible/readable, not assumed.

Six parallel review passes covered all 42 (7 each) for the first pass; a second, more detailed pass
re-verified every artifact against a fuller rubric and added the PT-PT/branding/assistant-surface
axes. A cross-cutting pass over the redundancy pairs and the compliance finding was run personally
before finalizing dispositions, both times. **UNCERTAIN: 0** - every artifact had readable scaffold
source regardless of screenshot quality, so a confident source-grounded disposition was possible in
every case; two artifacts have a genuinely broken screenshot (noted below) but that did not block
judging the underlying app.

**Id-to-screenshot mapping**, verified rather than assumed: `featured-seeder.ts` seeds each row with
`_id: manifest.id` (line ~155), and every one of the 42 manifests' own `id` field is identical to its
asset directory name (confirmed by reading all 42 `manifest.json` files). So `<id>.png` is the
correct, unambiguous screenshot for every artifact - all 42 matched cleanly, none needed remapping.

**Assistant-surface check, and a correction to the brief that requested it.** The brief for the
second pass pointed at `api/src/apps/app-paths.ts:76-80` as the assistant-surface gate; that function
(`isAppArtifact`) answers a different question (is this a BUILT app with a code sandbox, for the
code-editing capability gate - a `data.projectDir`/`data.artifactType==='app'` check), not whether
the operator assistant panel exists. The real gate is `api/src/apps/artifact-type.ts` (module header:
"whether the operator assistant surface exists at all (only `app`)" - `ArtifactType: 'app'`) together
with `api/src/apps/base-loader.ts`'s `BASE_IDS`: the `app`, `app-auth-persistent` and
`app-integration-heavy` bases get the assistant; `landing` and `presentation` never do - by design,
not a defect, since a landing page or a slide deck has no ongoing data/workflow for an assistant to
help with. Noted per artifact below; the pattern is identical for every artifact on a given base, not
a distinguishing evaluation criterion between artifacts that share one.

## Rubric

- **Domain fit** - would a Portuguese law firm actually use this in its practice (client/case work
  or firm-ops), or is it generic template window-dressing with no connection to the vertical?
- **Functional depth** - real workflows/calculations/state machines wired end-to-end into the UI,
  versus decorative logic files or static mockups.
- **Visual/professional polish** - from the screenshot: consistent design, no lorem-ipsum/
  placeholder text, no broken renders, believable Portuguese content, density appropriate for a
  professional tool handling client data.
- **PT-PT copy quality** - correct European Portuguese (never PT-BR), professional register, no
  untranslated English, no placeholder text.
- **Ekoa branding consistency** - matches the current Ekoa brand as it exists in this repo today.
- **Legal-domain correctness** (for `legal-*` apps) - correct citation of real statutes/institutions
  (CPC, CIRE, EOA, Lei 83/2017, Citius, RCBE, SinOA, InvoiceXpress...) and honest boundary-keeping
  (human-in-the-loop disclaimers actually enforced in code, not just claimed in the description).
- **Assistant surface** - is this an `app`-family base (gets the built-in assistant, `ui_actions`,
  tours) or a `landing`/`presentation` base (silently has none, correctly)? Noted, not scored - see
  Method above.
- **Redundancy** - does this artifact duplicate a stronger sibling's job closely enough that both
  being prominently featured reads as an unfinished platform rather than a considered offering?

**Disposition:** KEEP+UPGRADE = on-thesis and functionally real now; queued for a visual/functional
upgrade pass in Stage C. DEMOTE = off-thesis, redundant with a stronger sibling, or actively
undermines credibility/compliance if shown to a prospective legal customer. "Looks unfinished" is
never a reason on its own below - every disposition cites the specific file/behavior that earned it.

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
enforced in code, a shared "espinha" data model most satellite apps plug into correctly, and - see
finding 2 below - the only part of the gallery with disciplined PT-PT throughout). The generic,
pre-legal-pivot templates fared worse: 6 of the 8 demotions are non-`legal-*` artifacts that are
either off-thesis for a law firm (agency-portfolio, ecommerce-catalog, marketing-landing, pitch-deck)
or redundant with a `legal-*` sibling that already does the same job with case/client context they
lack (sales-crm vs legal-nucleo, task-manager vs legal-kanban).

## Cross-cutting findings (feed Stage B / recorded in `docs/findings.md`)

1. **Compliance conflict: `invoice-manager` natively emits fiscal-looking invoices**, contradicting
   the platform's own stated policy elsewhere in the same gallery (`legal-financas`'s manifest: "a
   emissão de faturas certificadas passa exclusivamente pela integração InvoiceXpress (AT) - a Ekoa
   nunca emite faturas nativamente"). `InvoicesPage.jsx`'s `nextInvoiceNumber()` mints sequential
   `FT {year}/{seq}` numbers and `InvoicePrintPage.jsx` renders a full issuer/client-NIF,
   IVA-broken-out, printable invoice via `window.print()` - a working DIY fiscal-invoice pipeline. A
   lawyer forking this to bill honorários would issue a legally non-compliant fatura outside
   certified invoicing software. Logged as an OPEN finding, not just a ledger note - see
   `docs/findings.md` (`featured-invoice-manager-noncompliant-invoicing`).
2. **PT-BR contamination is real but localized, not systemic.** Grepped all scaffold source for
   PT-BR-only markers (`usuário`, `cadastro/cadastrar/cadastrado`, `celular`, `aplicativo`, `tela` as
   "screen"). Two artifacts fail this check, both non-`legal-*` and both otherwise KEEP or DEMOTE for
   unrelated reasons: `erp-imobiliario`'s `App.jsx` uses "cadastrado"/"cadastro" roughly 20 times
   where PT-PT would say "registado"/"registo" (e.g. "Nenhum cliente cadastrado", "não está
   cadastrado. Cadastre-o antes de salvar") and "aplicativo da CGD" where PT-PT says "aplicação";
   `invoice-manager`'s `ClientsPage.jsx` has "O cadastro central das entidades" (moot given its
   compliance-driven demotion above, but confirms the same pattern). The entire 29-artifact `legal-*`
   family came back clean - PT-PT `ecrã` (never `tela`), `registo`/`registar` throughout, correct
   formal register. This correlates cleanly with the redundancy pattern above: the artifacts written
   for the legal vertical are also the ones with disciplined PT-PT; the generic/imported-feeling
   templates are where PT-BR leaks in - a real signal about which parts of this gallery were actually
   authored for this market. **`erp-imobiliario` is a KEEP+UPGRADE artifact, so this is a named Stage
   C work item, not just an observation**: its PT-BR contamination must be fixed as part of the
   upgrade pass, alongside the apartment-portfolio de-verticalization already required (finding-level
   detail in its per-artifact entry below).
3. **The `presentation` base's known dark-by-default style shows up in exactly and only its two
   artifacts.** `pitch-deck` and `quarterly-report` - the only two artifacts on the `presentation`
   base - both render dark cover slides. This is independent confirmation of the WS7 root cause: the
   base's `instructions/base-conventions.md` hard-codes "Dark by default" (a sibling agent is removing
   that line as part of WS7). The blast radius this evidence shows is precisely these two artifacts
   and nothing else - the other 40 (`app`-family and `landing` bases) do not exhibit the pattern and
   need no theme intervention as part of Stage C. Per the brief, this was NOT held against either
   artifact's design-quality score here: `pitch-deck` is demoted on content-relevance grounds
   regardless (an investor pitch deck is not what a law-firm partnership needs) and `quarterly-report`
   is kept on the strength of its actual computed-chart logic, independent of the theme.
4. **Screenshot-seeding gap understates the `legal-*` family.** Most `legal-*` screenshots
   (`legal-nucleo`, `legal-dossie`, `legal-financas`, `legal-agenda`, `legal-injuncoes`,
   `legal-insolvencias` and others) show an empty/zero-data state ("Sem clientes - abra um no
   Núcleo", empty KPI tiles) because the capture runs standalone, without the shared spine's "Fonseca
   & Associados" demo data seeded. The underlying apps are frequently very deep (see e.g.
   `legal-agenda`, `legal-citius`, `legal-calculos`) but their gallery thumbnails currently undersell
   that - the screenshots alone would have produced a worse verdict than reading the source did.
   **STATUS UPDATE (2026-08-08, later the same day):** root-caused and fixed in a follow-on unit of
   work - `legal-nucleo`'s `DashboardPage.jsx` is the only scaffold with an "Instalar dados de
   demonstração" button, and installing once seeds the whole family (the shared scope is keyed by
   owner, not per-app). `ensureLegalDemoSpineInstalled()` in `api/src/apps/featured-builder.ts` now
   drives that button before any `legal-*` screenshot is (re)captured; a deliberate-recapture CLI
   (`npm run tool:recapture-featured-screenshots --workspace api`) exists to force the 29 already-
   stale PNGs to refresh, since self-heal only fires when a PNG is missing. Verified live (isolated
   scratch stack) with real before/after screenshots for `legal-nucleo` and `legal-prazos`. See
   `docs/findings.md` (`featured-legal-spine-screenshots-unseeded`) for the fix detail; not committed.
5. **Two screenshots show a genuine broken render, not just an empty/zero-data state.**
   `booking-system.png` renders a fully blank content pane (sidebar chrome intact, body white) with
   no crash cause visible in `CalendarGrid.jsx`/`useData.js` - looks like a stale/broken capture, not
   a code defect, but needs a recapture before anyone judges this artifact by its thumbnail.
   `sales-crm.png` renders "Página não encontrada" instead of the dashboard - a real broken default
   route, on an artifact already demoted for other reasons. Both need investigation independent of
   any disposition decision.
6. **Ranking anomalies in the existing `featuredRank` data** (pre-dates this audit, not introduced by
   it): `legal-agenda-reservas` has no `featuredRank` at all (schema allows it - the field is
   optional - but it's a gap, and it is likely accidental since all 41 other artifacts have one);
   `sales-crm` (rank 10) and `task-manager` (rank 20) currently outrank every single `legal-*`
   artifact (which start at rank 40) despite this audit demoting both as redundant with a `legal-*`
   sibling that does the same job with case/client context they lack - they read as leftover ranking
   from before the platform specialized into the legal vertical.
   **STANDALONE RECOMMENDATION, independent of the demote decision above:** even if the operator
   declines demoting `sales-crm`/`task-manager` outright, ranks 10 and 20 are wrong on their own
   terms and should move behind the `legal-*` block (rank >= 40) regardless of what else happens to
   either artifact - a generic CRM and a generic kanban board have no principled claim to being MORE
   prominent than every purpose-built legal tool in the gallery.
7. **The `icon` manifest field is declared and universally dead.** All 42 manifests omit `icon` (the
   seeder's internal `FeaturedArtifactManifest` type declares it optional; `shared/src/artifacts.ts`'s
   wire `Artifact` schema does not carry an `icon` field at all, and no web component under
   `web/components/artifacts/` or `chat-stripes.tsx` reads `.icon`). This is not 42 individual
   oversights - the field is unused end-to-end. Either wire it into the gallery card (each artifact
   currently falls back to whatever generic icon the card component defaults to) or drop it from the
   manifest interface; leaving it declared-but-ignored is misleading to whoever authors the next
   featured artifact. Logged as a finding (`featured-icon-field-dead`) rather than left only here.
8. **No demotion mechanism existed at the time of the first pass; one now exists.** At the time this
   audit was written, `shared/src/artifacts.ts` had only an optional
   `featuredRank: z.number().int().optional()` and no `hidden`/`demoted`/`status` field on the
   featured-artifact schema. **STATUS UPDATE:** Stage B has since shipped
   `api/src/apps/featured-demote.ts` + `api/scripts/demote-featured/cli.ts` (`npm run
   tool:demote-featured`) - deliberately disposition-agnostic (it demotes whatever id it is given;
   "which ids" is this ledger's decision, not that module's). It demotes by materialising the
   scaffold into the admin's own sandbox as a normal artifact row and removing the asset dir, rather
   than by adding a visibility field to the schema - so the underlying "no visibility flag" gap this
   finding originally named is resolved by a different mechanism, not by the field ever being added.

## Per-artifact ledger

### DEMOTE (8)

- **`agency-portfolio`** (rank 100, outputKind `landing_page`) - extends `landing` (no assistant
  surface; correct for a landing page). A creative-branding-agency portfolio site ("Atelier Tinta") -
  visually the most tastefully executed pure design in the whole set (restrained teal accent, real
  stats bar, no lorem ipsum), but the industry is entirely wrong for a law firm, and its one
  interactive element does not work: `Contact.jsx`'s form only calls `setSubmitted(true)` locally, it
  never actually sends the message anywhere. PT-PT copy is clean.
- **`ecommerce-catalog`** (rank 50, `web_app`) - extends `app-auth-persistent` (assistant surface
  present). Competently built retail CRUD - `ProductsPage.jsx` has real search, category chips,
  stock-level badges, and a full product form wired to `useCollection`/`createItem`/`updateItem` -
  but "gestão de produtos, encomendas e clientes para uma loja online" (inventory, SKUs, order
  fulfillment) has no bearing on a law firm's practice, which does not sell physical stock. Off-thesis
  regardless of build quality. PT-PT copy is clean.
- **`invoice-manager`** (rank 60, `web_app`) - extends `app-auth-persistent` (assistant surface
  present). The one artifact with a live compliance problem, not just a fit problem (finding 1 above).
  `InvoicesPage.jsx`'s `nextInvoiceNumber()` mints sequential `FT {year}/{seq}` numbers and
  `InvoicePrintPage.jsx` renders a full issuer/client-NIF, IVA-broken-out, printable invoice via
  `window.print()` - i.e. exactly the uncertified native fiscal-invoice emission the platform's own
  `legal-financas`/`legal-honorarios` explicitly refuse to do for Portuguese tax-compliance reasons.
  Featuring this template risks a lawyer forking it to bill honorários outside certified invoicing
  software. Also has a PT-BR leak (finding 2): "O cadastro central das entidades" (`ClientsPage.jsx`)
  where PT-PT says "registo".
- **`marketing-landing`** (rank 90, `landing_page`) - extends `landing` (no assistant surface;
  correct). Well-executed generic SaaS landing page (subscription pricing at EUR19/69/199 per month,
  "avaliação gratuita de 14 dias. Sem cartão de crédito.", a trust-logo strip citing fictional
  tech-company names like "Northwind"/"lumen.io") - the wrong shape for a law firm's public site
  (practice areas, credentials, case results, consultation CTA), not a copy-swap away from being
  useful; the section structure itself does not generalize. PT-PT copy is clean.
- **`pitch-deck`** (rank 110, `presentation_html`) - extends `presentation` (no assistant surface;
  correct; shows the dark-editorial pattern named in finding 3, not held against it here). A polished
  12-slide, keyboard-navigable investor-fundraising deck (`App.jsx`) with real stat cards and a
  proportional budget-allocation chart - genuinely more than static images - but the content is an
  end-to-end Series-B narrative (slides literally named Market/Traction/BusinessModel/Ask:
  "Procuramos 3,2M€ ... equipa preparada para uma série B"). Portuguese law firms are partnerships,
  not VC-backed startups; the entire premise doesn't apply to the target customer. PT-PT copy is
  clean.
- **`sales-crm`** (rank 10, `web_app`) - extends `app-auth-persistent` (assistant surface present).
  Real, solid CRUD (`App.jsx`/`Deals.jsx`/`DataContext.jsx`: React Router pages, a kanban pipeline by
  deal stage, full create/edit forms, `/api/app-data/*` persistence) backed by realistic seed data (7
  contacts, 7 deals, 8 activities) - but a EUR-valued deal-pipeline model doesn't match how a
  Portuguese law firm manages clients/processos, `legal-nucleo` ("Clientes e processos - o núcleo
  partilhado", rank 40) already owns that job in law-firm-native terms, and its own screenshot
  currently renders a "Página não encontrada" 404 instead of the dashboard (finding 5). Its rank 10 -
  more prominent than every other artifact in the gallery - no longer makes sense (finding 6). PT-PT
  copy is clean.
- **`task-manager`** (rank 20, `web_app`) - extends `app-auth-persistent` (assistant surface
  present). One of the better-built generic templates reviewed: full search/filter, drag-to-move task
  cards, computed overdue/priority stats, realistic 4-list/15-task seed data, all persisted through
  `/api/app-data/*` - but `legal-kanban` ("Quadro de tarefas... sobre a espinha partilhada", rank 47)
  already provides the same kanban job WITH client/matter context this artifact cannot have (its
  tasks are isolated from any case record). Its rank 20 - more prominent than every `legal-*`
  artifact - is a clear leftover from before that sibling existed (finding 6). PT-PT copy is clean.
- **`legal-cobrancas`** (rank 60, `web_app`) - extends `app-auth-persistent` (assistant surface
  present). Real engineering on its own terms (`engine/cobrancas.mjs`: 3-bucket aging, a
  WhatsApp-opt-out reminder sequencer citing RGPD + the Estatuto da OA; `backend/index.js`: a genuine
  idempotent Ifthenpay/Stripe webhook handler) - but it targets the identical job as the standalone
  `cobrancas` artifact, and on direct comparison `cobrancas` is deeper (a full per-profile escalation
  engine with promise-to-pay handling, a legally-cited moratory-interest calculator with an
  integer-cent audit trail, an approval-gated compliant email queue, a real `engine/tests/` suite) and
  fresher (rebuilt/rescreenshotted 2026-08-06, task "Port the Cobranças featured artifact"). Two
  "Cobranças" apps side by side in the gallery reads as an unfinished platform, not a considered
  offering. Before fully retiring `legal-cobrancas`, Stage C should check whether its
  webhook-reconciliation and WhatsApp-opt-out mechanisms - real capabilities `cobrancas` currently
  lacks - are worth porting into `cobrancas` first. PT-PT copy is clean.

### KEEP+UPGRADE (34)

Grouped by family; each entry states rank/base/assistant-surface plus what actually earned the keep
and what Stage C should prioritize.

**Firm-ops / non-legal, kept on merit**

- **`ai-assistant`** (rank 70, `agent_app`) - extends `app-integration-heavy` (assistant surface
  present - and this artifact IS a chat-assistant demo in its own right, exercising the same class of
  surface it showcases). A real tokenized knowledge-retrieval scorer (`App.jsx`'s
  `pickKnowledge`/`tokens`) composing a cited reply, plus a genuine fire-and-forget call into the
  platform's own `/api/v1/request` endpoint - not a stub. Upgrade: reskin the seed data from retail
  returns/store-hours to a legal-services scenario (honorários/prazos FAQ) so the demo reads as built
  for a law firm, not a retailer. PT-PT clean.
- **`booking-system`** (rank 40, `web_app`) - extends `app-auth-persistent` (assistant surface
  present). Real month-grid calendar CRUD (`Calendar.jsx`) backed by realistic seed data (5 services,
  6 customers, 10 bookings, a full weekly-availability schedule including a closed Sunday). BLOCKING
  for Stage C (finding 5): its screenshot currently renders fully blank - recapture and confirm it
  isn't a real render bug before investing further. PT-PT clean.
- **`erp-imobiliario`** (rank 35, `web_app`) - extends `app-auth-persistent` (assistant surface
  present). The single deepest artifact in the entire audit: a ~10,700-line `App.jsx` with
  OFX/CSV/XLSX/PDF bank-statement parsing, a TOConline accounting-import parser, Jaccard-similarity
  auto-categorization, a full DRE, projected-vs-realized cash flow, and role-based permissions -
  production-grade financial engineering, not a demo. The "Imobiliário" (real-estate/apartment-
  portfolio) framing is off-thesis for a law-firm gallery, but the underlying engine is firm-wide
  treasury/accounting, not matter-level - complementary altitude to `legal-financas` (client/matter-
  level), not redundant with it. TWO concrete, named Stage C requirements, not just "polish": (1)
  de-verticalize the apartment/rental-specific naming and copy so it reads as general firm accounting;
  (2) fix the PT-BR contamination named in finding 2 - "cadastrado"/"cadastro" appears roughly 20
  times where PT-PT needs "registado"/"registo", and "aplicativo da CGD" needs "aplicação".
- **`help-desk`** (rank 80, `web_app`) - extends `app-integration-heavy` (assistant surface present).
  A full ticket lifecycle wired to the platform's actual `/api/v1/action` integration contract with a
  correct "needs_integration" fallback CTA when email isn't connected - correctly demonstrates the
  real integration architecture rather than faking it. Plausible fit for client query/support
  tracking. Stage C should check for surface overlap with `legal-portal`'s two-way client messaging
  before investing in both. PT-PT clean.
- **`quarterly-report`** (rank 120, `presentation_html`) - extends `presentation` (no assistant
  surface - correct; shows the dark-theme default named in finding 3, not held against it here).
  `Revenue.jsx` computes a real SVG bar chart from a data array (actual vs. plan, derived YoY%) rather
  than a static image, and `Q4Plan.jsx` enforces an owner+deadline structure per priority - genuine
  template logic, not a flat mockup. The Highlights/Revenue/Customers/Operations/Plan slide shape
  maps reasonably onto a firm's internal partner/management review, unlike `pitch-deck`'s investor
  framing. Upgrade: swap SaaS-specific copy (ARR, "distribuidores") for professional-services
  equivalents (billables, clients, practice priorities). PT-PT clean.
- **`cobrancas`** (rank 30, `web_app`) - extends `app-auth-persistent` (assistant surface present).
  The audit's flagship: a per-profile escalation engine (promise-to-pay suspension/resumption,
  frequency caps, digest coalescing in `engine/escalonamento.mjs`), a legally-cited moratory-interest
  calculator (Art. 559.º CC, DL 62/2013, integer-cent precision, full "showWork" audit trail in
  `engine/juros.mjs`), bank-statement reconciliation with auto-learned matching rules
  (`engine/matching.mjs`), and an approval-gated client-communication queue aligned with EOA
  deontological expectations. Backed by a real `engine/tests/` suite. Freshest screenshot in the
  audit (2026-08-06). PT-PT clean.

**The `legal-*` shared-spine core** - all extend `app-auth-persistent`, assistant surface present on
every one below.

- **`legal-nucleo`** (rank 40) - the shared client/case data model (29 collections in
  `demo-spine.js`/`shared.js`) the rest of the family plugs into; idempotent self-healing seeding with
  cross-tab Web Locks concurrency handling. Its own screenshot was an empty-state capture (spine
  unseeded standalone, finding 4 - now fixed, see status update) but the code is coherent and legally
  sound (`engine/citius-parser.mjs` refuses to guess an act/date/process number under ambiguity).
  Demoting the spine would break every satellite app's premise - keep it prominent.
- **`legal-dossie`** (rank 45) - per-case compilation view enforcing real matter confidentiality
  ("sigilo entre processos" in `ProcessoPage.jsx`) with genuine `window.print()` PDF export.
- **`legal-financas`** (rank 59) and **`legal-honorarios`** (rank 43) - confirmed complementary, not
  redundant: `legal-honorarios`'s `engine/honorarios.mjs` computes a cent-precision fee pre-invoice
  (base/IVA/retenção, re-entrancy-guarded, `showWork`-transparent) and tags it
  `origem: 'honorarios'`; `legal-financas`'s Faturação page consumes exactly that tag to queue
  certified InvoiceXpress emission, while its own Conta Corrente/Despesas/Provisões pages cover the
  broader client-ledger scope honorários doesn't touch. Both correctly hard-refuse native invoice
  emission - the policy `invoice-manager` violates (finding 1).
- **`legal-tempos`** (rank 46) - time capture that feeds honorários via an idempotent transfer
  (`onTransferir` re-fetches and searches for an orphaned lançamento before creating a new one, never
  double-bills). Deliberately has no billing UI of its own - a feed, not a duplicate.
- **`legal-kanban`** (rank 47) - task board over the shared `tarefas` collection; `kanban-logic.js`
  correctly treats `estado` as canonical and column placement as presentation-only, so it can't
  desync from Núcleo's task list. The sibling `task-manager` was demoted in favor of this one.
- **`legal-agenda`** (rank 52) and **`legal-agenda-reservas`** (rank MISSING - finding 6) - team
  calendar plus paid public booking; a real multi-participant free-slot intersection engine
  (`engine/agenda.mjs`) and a payment-webhook handler that re-verifies availability at confirmation
  time and cancels-with-notification on a detected double-booking race rather than silently
  overwriting - the strongest backend logic in the whole audit. `legal-agenda-reservas` needs a
  `featuredRank` assigned and its screenshot recaptured with seeded session types (currently an
  honest but unappealing "no sessions available" empty state) in Stage C.

**Deadline / credit-recovery engines** - all `app-auth-persistent`, assistant present.

- **`legal-prazos`** (rank 41) - CPC deadline engine (`engine/prazo.mjs`): computes Easter via
  Meeus/Jones/Butcher to derive movable holidays, models férias judiciais, implements the Art.
  139.º/5 fine window, and fails fast on an unknown regime rather than silently defaulting. Anchor
  artifact - Citius, Insolvências and Injunções all delegate to it. Best-populated screenshot in the
  deadline family.
- **`legal-citius`** (rank 42) - the most defensively engineered logic in the audit: only trusts an
  authenticated `@citius.mj.pt` sender for automated deadline creation, strips hidden HTML
  (anti-spoofing), and has an explicit negation-window check so it won't fire on phrases like "sem
  contestação".
- **`legal-injuncoes`** (rank 64) - correct DL 269/98 (EUR15,000 cap) vs. DL 62/2013 (uncapped,
  commercial-only) eligibility split; explicitly delegates interest/fee math to `legal-calculos`
  rather than reimplementing it (documented boundary "FRONTEIRA P2-001").
- **`legal-insolvencias`** (rank 66) - correctly reuses the shared prazo engine with `regime: 'cire'`
  for the CIRE Art. 9.º continuous (non-suspending) 30-day count instead of reimplementing it.
- **`legal-calculos`** (rank 61) - moratory-interest and court-fee (RCP) engine; integer-cent
  arithmetic, per-tranche legal citations, and marks any gap in its rate table `incompleto`/
  `'confirmar'` with zero interest rather than guessing - the strongest "cite your source, flag your
  uncertainty" discipline in the audit. Complementary with `legal-prazos` (dates vs. money), not
  redundant.
- **`legal-recursos`** (rank 48) - firm-internal HR: `engine/ferias.mjs` correctly implements Código
  do Trabalho Art. 238.º/239.º leave entitlement, including the admission-year proration rule, and
  hard-blocks clinical notes from ever being collected for sick-leave records (a real
  data-minimization decision). A different job from its deadline-engine batch-mates but a legitimate
  one, judged on its own terms.

**Compliance / client-facing** - all `app-auth-persistent`, assistant present.

- **`legal-conflitos`** (rank 49) - Art. 99.º EOA conflict check with diacritic-folding search and a
  mandatory human decision field; a real UI-rendered disclaimer (`conflitos-disclaimer` test id).
- **`legal-kyc`** (rank 54) and **`legal-rcbe`** (rank 65) - their claimed shared-data link is
  VERIFIED real in source (both read/write the identical `beneficiarios_efetivos` collection,
  code-commented "P2-007: UMA estrutura de beneficiários efetivos, duas apps"), not just asserted in
  the manifest. `legal-kyc`'s risk engine correctly cites Lei n.º 83/2017; `legal-rcbe`'s calendar
  correctly models the real 25% threshold plus initial/update/annual-confirmation deadlines.
- **`legal-apoio`** (rank 58) - reuses the same rigorous deadline engine for SinOA legal-aid
  deadlines and is honest that it never submits on the lawyer's behalf, matching SinOA's real lack of
  a public submission API.
- **`legal-portal`** (rank 53) - a genuinely dual-audience app (office admin view plus a separate
  client-facing `/cliente*` portal) with per-app credential isolation (client passwords never touch
  office-wide data), explicit invisible-by-default sharing, and an audit-trail writer - the security
  model is real in the code, not just described.
- **`legal-assinatura`** (rank 44) - qualified e-signature envelope state machine correctly modeling
  the Portaria 350-A/2025 transition (advanced tolerated through 2026, qualified mandatory from
  2027); honestly marks unavailable provider stubs `disponivel:false` rather than faking them.
- **`legal-correio`** (rank 55) - registered-mail tracking; explicit in comments that its reference
  is NOT the real CTT reference, and handles all three real outcomes of a tracking lookup (events /
  no-info / provider-unavailable) gracefully - the "desenho honesto" the manifest claims.

**Drafting / research / analytics** - all `app-auth-persistent`, assistant present.

- **`legal-modelos`** (rank 51) -> **`legal-contratos`** (rank 44) -> **`legal-pecas`** (rank 57):
  confirmed three genuinely distinct, non-redundant pipeline stages (official-source template library
  with documented licensing exclusions -> wizard-generated contracts from spine data ->
  procedural-pleading drafting with citation/calc-memo insertion from `legal-pesquisa`/
  `legal-calculos`) - verified by reading the shared `variaveis`/origem schema contract in
  `modelos-util.js`. `legal-modelos` has the best-realized screenshot in the entire audit - a
  populated grid of real, correctly-licensed template cards.
- **`legal-forms`** (rank 50) - distinct again (AcroForm PDF field-filling, not docx generation):
  FNV-1a template fingerprinting, confidence-scored auto-mapping, and learned-layout memory that
  improves across repeat filings.
- **`legal-pesquisa`** (rank 56) - the audit's strongest domain-correctness result: the "never invent
  a source" discipline is enforced in the logic layer itself (`hitsParaCitacoes` silently drops any
  hit without a URL rather than fabricating one), not just claimed in copy.
- **`legal-jurimetria`** (rank 67) - correctly scoped as descriptive statistics, never outcome
  prediction, and the ethical framing repeats through the manifest, page copy, and the generated
  client-facing sheet. BUT it is the thinnest artifact reviewed (~125 lines) and its own
  `referencias.json` flags every national average it cites as `"nota": "confirmar"` - placeholder
  pending real DGPJ ingestion - while the table presents each figure next to a specific source/period
  as if final. Upgrade priority: wire the real DGPJ data source (already scaffolded) before this is
  fully lawyer-trustworthy; also fix a copy typo ("saram-se" should read "sanam-se").
- **`legal-transcricao`** (rank 63) - Art. 640.º CPC appeal-excerpt export is hard-gated behind a
  `revisto` (reviewed) state in code (`if (!row || row.estado !== 'revisto') return`), not just
  described as reviewed-first; RGPD-conscious retention copy and a judicial-secrecy upload flag.

## Stage B / Stage C notes (non-binding)

- Stage B's demotion mechanism now exists (finding 8) and is deliberately disposition-agnostic; this
  ledger names WHICH 8 ids to demote and why, and stops there.
- Recommend Stage C re-run the screenshot capture WITH the shared spine's demo data seeded before any
  before/after visual comparison (finding 4, now fixed via `ensureLegalDemoSpineInstalled` +
  `npm run tool:recapture-featured-screenshots`) - several `legal-*` artifacts will look far better
  than their current gallery thumbnail once a deliberate recapture runs, independent of any new
  design work.
- Two named, artifact-specific Stage C work items beyond general "upgrade": `erp-imobiliario`'s PT-BR
  contamination (finding 2) and apartment-portfolio de-verticalization, and `legal-jurimetria`'s
  placeholder DGPJ figures presented as final (its own entry above).
- The dead `icon` manifest field (finding 7) needs a decision - wire it up or delete it - independent
  of any individual artifact's disposition.
