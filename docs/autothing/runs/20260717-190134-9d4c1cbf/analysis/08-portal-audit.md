# Track 8 - Portal connector audit (read-only; Citius first)

Run 20260717-190134-9d4c1cbf, slice A4. No live portal calls were made; every claim is from code/tests/assets. Decides Part E per `../FLOW_PLAN.md` E1-E5.

## 1. Citius - what exists today (three distinct surfaces)

### 1a. Public consulta of citacoes/notificacoes (the only ported, working connector)
- Service: `api/src/legal/citius.ts`. Target surface: `www.citius.mj.pt/portal/consultas/ConsultasCitacoes.aspx` (citius.ts:21), query `NumProcesso` (citius.ts:154-158). Retrieve-only.
- How it gets in (shape): public area, no session, no credential - a plain GET; the portal is ASP.NET WebForms and a sessionless GET often lands on an error page, which the service detects heuristically (`looksUnavailable`, citius.ts:103-109) and reports honestly ("ACEITAVELMENTE FRAGIL, por desenho", citius.ts:5-11).
- Plumbing: default fetch is the SSRF-guarded `guardedFetch` with a 12s timeout (citius.ts:51-56); `fetchImpl` is an injected seam so all gates run on committed fixtures. Charset-correct latin1/1252 decode for PT legal portals (`decodeHtml`, citius.ts:64-78).
- Normalization: zero-dependency regex table walker `parsePublicacoes` (citius.ts:118-151) -> `CitiusPublicacao { processo, tribunal, data, ato, texto }` (citius.ts:23-29), wrapped in `CitiusConsultaResult { ok, processo, publicacoes[], source:'live'|'unavailable', error? }` (citius.ts:31-38).
- Route: `GET /api/citius/consulta` (`api/src/legal/router.ts:264-292`). Gate: `X-Ekoa-App-Id` header, allowlist {legal-citius, legal-nucleo, legal-prazos, legal-dossie} (router.ts:35), registration required (router.ts:269), owner-activation fail-closed (`api/src/legal/access-gate.ts:98-137`), rate 6/20 per min (router.ts:82). Contract descriptor `citiusConsulta` exists but its response is `z.unknown()` (`shared/src/served-app.ts:97`).
- Failure behavior: the service never throws - empty processo -> PT error; fetch failure, non-2xx, or error-page heuristic -> `{ ok:false, source:'unavailable', error:'Consulta Citius indisponivel' }` (citius.ts:170-200); route maps that to 503 PT (router.ts:284-291).
- Proof: fixture unit tests `api/tests/legal/citius.test.ts` (utf-8 + latin1 fixtures at `api/tests/e2e/fixtures/citius-consulta*.html`); contract test drives the real route against the fixture and validates the descriptor (`api/tests/contract/legal-plane.test.ts:196-203`; gate refusals at 113-132).
- Where results land: NOWHERE in product code. No scaffold, served app, or web page calls `/api/citius/consulta` (repo-wide grep: only tests and the shared descriptor). The route is a proven, unused faucet.

### 1b. Public consulta of distribuicao (declared, parser not ported)
- Declared as integration action `consulta_publica_distribuicao` - credential-free `httpConfig` GET against `www.citius.mj.pt/portal/consultas/ConsultasDistribuicao.aspx` (`api/assets/integrations/citius/config.json`, actions[4]; authType-free, no Authorization header - asserted by `api/tests/e2e/citius-integration.e2e.mjs` lines ~157-166).
- The fixture was ported (`api/tests/e2e/fixtures/citius/consulta-distribuicao.html`, referenced by `api/tests/SUITE_LEDGER.json:460`) but the legacy normalizer (cortex `citius-etribunal.ts consultaPublica`, named in the e2e header, citius-integration.e2e.mjs:18-21) was NOT ported. Retrieval declared; no parser in `api/src`.

### 1c. Signed-in Portal dos Mandatarios / eTribunal (declared shell, pre-checkpoint)
- Versioned integration `api/assets/integrations/citius/config.json`: `authType: "browser_session"`, `sessionConnect.loginUrl: https://portal.tribunais.org.pt`. Entry shape (report only): one interactive lawyer authentication (OA certificate or Chave Movel Digital via autenticacao.gov.pt), session captured and encrypted, reused until expiry; no stored password (credentialGuide in config.json). There is no official API.
- Four automation-bound actions: `consultar_notificacoes`, `consultar_processo`, `fetch_documentos_processo` (retrieve) and `submeter_peca` (submit, `mutates:true`), each `automationBinding` + `passCredentials:true`, backed by browser-automation templates `automations/{notificacoes,processo,documentos,submissao}.json`.
- A poll listener is DECLARED: `listenerConfig { pollAction:'consultar_notificacoes', intervalMs:900000, dedupKeyField:'id', events:[notificacao.recebida] }` (config.json).
- Reality: the e2e (`api/tests/e2e/citius-integration.e2e.mjs:1-30`) proves registry load + action shapes only; the actions resolve to `unknown_automation` until a real session checkpoint - the honest pre-checkpoint state. No live-portal gate anywhere.

### 1d. Where Citius data actually lands today (the triage path, not the connector)
- The Caixa Citius engine `api/assets/legal-engines/citius-process.mjs` (synced copies in scaffolds via `scripts/sync-legal-shared.mjs`) parses a notification, matches `processos` on the shared spine (line 87), and writes `citius_notificacoes` (line 25), `prazos` (line 119) and `eventos` (line 132) - deterministic, needs-review-first, idempotent by `sourceRef` (header, lines 1-20).
- Intake is email (`legal-citius` scaffold backend `onEmail`, `api/assets/featured-artifacts/legal-citius/scaffold/manifest.json:10-12`) or paste - NOT the consulta route. UI: served app over `window.__ekoa.shared` (`web/e2e/legal-citius.spec.ts:5-19`).

## 2. Other portal-touching code (brief)

- **DGSI / DRE** (`api/src/legal/research.ts`): not a portal scraper. Lexical FTS over knowledge-vault collections `jurisprudencia`/`legislacao` (research.ts:19-22) + verify-only HEAD/GET of the cited dgsi.pt / DRE URLs through `guardedFetch` (`verifyUrl`, research.ts:121-143), cited-or-silent. Route `GET /api/legal-research` (router.ts:201-233). Retrieve/verify only, public URLs.
- **RCBE**: manual assisted flow only, canonical `rcbe.js` synced into every legal scaffold (e.g. `api/assets/featured-artifacts/legal-dossie/scaffold/frontend/src/rcbe.js:1-17`): a deep link to `rcbe.justica.gov.pt` + a tolerant parser of pasted extract text -> `{ entidade, nipc, beneficiarios[] }`; explicitly "O RCBE NAO tem API publica ... aqui nao ha qualquer persistencia nem rede". Client-side, public portal, manual retrieve.
- **CTT tracking** (`api/src/legal/tracking.ts`): a seam, not an integration - chain ctt-direct -> aggregator -> mock, no real provider configured (tracking.ts:4-6, 134); `normalizeTrackingJson` -> `TrackingResult` (tracking.ts:106-129). Route `GET /api/tracking/consulta` (router.ts:236-261).
- **Portal das Financas, predial/comercial/civil registries, insolvencia publications**: NO connector code anywhere in `api/src`, `web`, `shared` (repo grep). `legal-financas` is spine bookkeeping + InvoiceXpress for invoicing (its manifest.json); `legal-insolvencias` is a credor-side register with no portal calls (only a demo-seed DRE URL, scaffold shared.js:642). "eTribunal" IS the Citius signed-in integration (1c) - no separate code.

## 3. The dossie reality

- There is NO first-class dossie/case/matter/processo entity in the platform data model. `shared/src` has no such schema (the only 'PROCESSO' is a deny-list entity class literal, `shared/src/org.ts:191`); the dashboard has no case pages (`web/app/(dashboard)/`: artifacts, automations, chat, integrations, knowledge, memory, orgs, pedidos, registo, settings, usage, users); `api/src/routes/company-space.ts:1-9` is artifact serving state, not a case space.
- The de facto dossie is the served-app SHARED SPINE: per-owner (`usr.<ownerUserId>`) collections - `processos`, `clientes`, `documentos`, `prazos`, `eventos`, `envelopes`, ... - accessed through `window.__ekoa.shared` (`legal-dossie` scaffold `shared.js:9-21`). The `legal-dossie` app ("Compila o dossie completo de um processo", `api/assets/featured-artifacts/legal-dossie/manifest.json`) composes the dossier view per `processos` row (ProcessoPage + Dossie/Documentos/Prazos/Cronologia tabs).
- Closest receiving surface for externally-retrieved files TODAY: blob to app-files (`POST /api/app-files`, served at `/api/app-files/{appId}/{id}`, `api/src/apps/app-files.ts:1-17`) + a metadata row in `documentos` shaped `{ nome, tipo, processoId, data, origem, ficheiro:{fileId, appId, url, mime, size}, versao }` - exactly what `DocumentosTab.jsx:287-305` writes on upload. Events attach as `eventos` rows keyed by `processoId` (citius-process.mjs:132).

## 4. Polling / watcher infra an insolvency watcher could reuse

- Durable dedup event queue: `api/src/events/queue.ts` - `UNIQUE(triggerId, dedupKey)` as deterministic `_id`, retry schedule + dead-letter (queue.ts:1-40).
- Triggers + ingress + delivery: `api/src/events/service.ts` (`TriggerDoc.targetKind: 'automation' | 'artifact-backend'`, service.ts:17-29); delivery pipeline with injected targets and a 5s safety-net drain (`delivery.ts:65,140`); SSE manager for UI push (`api/src/events/sse-manager.ts`).
- Listener polling is DECLARED but has NO runtime: automation trigger kind `'listener' { pollAction, pollIntervalMs }` exists in types (`api/src/automation/types.ts:301-307`), catalog view (`catalog.ts:129-135`), run attribution (`service.ts:563`), backend-runtime attribution (`backend-runtime/runtime.ts:255`) and the citius `listenerConfig` - but `pollIntervalMs` is consumed nowhere (grep: only types.ts:306). No cron/scheduler exists; the only periodic loop in the codebase is the delivery safety-net drain.

## 5. Verdict table

| connector | surfaces touched | retrieve/submit | public vs signed-in | normalization shape | verdict |
|---|---|---|---|---|---|
| Citius publico - citacoes/notificacoes (`legal/citius.ts`) | ConsultasCitacoes.aspx | retrieve | public | `CitiusPublicacao{processo,tribunal,data,ato,texto}` (typed in api, `z.unknown()` in shared) | extend + promote-to-Part-E (E4 base) |
| Citius publico - distribuicao (integration action) | ConsultasDistribuicao.aspx | retrieve | public | none ported (fixture only) | rebuild (follow-up; not needed for E gate) |
| Citius/eTribunal signed-in (integration + automations) | Portal dos Mandatarios: notificacoes, processo, documentos, submissao | retrieve x3 + submit x1 | signed-in (captured browser session) | none (returnSchema `object`; automations unmaterialized) | rebuild-or-extend in follow-up run (excluded from E by FLOW_PLAN "Run 2 note") |
| DGSI/DRE research (`legal/research.ts`) | none live (vault FTS + URL verify) | retrieve (verify-only) | public | `LegalResearchHit` | extend (E5 verify-only rides it as-is) |
| RCBE (`rcbe.js`, client-side) | deep link + pasted extract | retrieve (manual) | public, manual | `{entidade,nipc,beneficiarios[]}` | extend later; not Part E |
| CTT tracking (`legal/tracking.ts`) | none configured (seam) | retrieve | n/a | `TrackingResult` | extend later; not a Part E portal |
| Portal das Financas / predial / comercial / civil registries | absent | - | - | none | build new in Part E (E2/E3 public tier); signed-in parts to follow-up |

## 6. Part E pins

1. **Record shape - keep the FLOW_PLAN shapes; do not promote an existing one.** No current normalization can be `PortalDocument`: `CitiusPublicacao` is an event-like row (no file ref, no subject ids) and the distribuicao/signed-in paths have no shape at all. Pin `PortalDocument {source,type,subjectIds,retrievedAt,fileRef,parsed?}` + `PortalEvent {source,kind,subjectRef,dossierRef,observedAt,payload}` (FLOW_PLAN:69-70) as NEW zod schemas in `shared/` - the first legal contract that is not `z.unknown()` (today all legal descriptors are, `served-app.ts:92-98`). Citius watcher hits map `CitiusPublicacao` verbatim into `PortalEvent.payload`; `citius.ts`'s internal shape stays as-is.
2. **Receiving surface for E1: the existing spine, not a new entity.** `dossierRef` = a `processos` row id; a portal document = app-files blob + a `documentos` row `{processoId, ficheiro{fileId,url,mime,size}, origem:'portal', ...parsed}` mirroring DocumentosTab.jsx:287-305; a watcher hit = `eventos` row + the `PortalEvent` record. This renders in legal-dossie with zero UI invention and satisfies the E gate ("both rendering in the dossie", FLOW_PLAN via BRIEF §8). Do not build a dashboard-tier dossie entity in this run.
3. **E4 watcher**: reuse triggers + dedup queue + delivery + SSE wholesale (`triggerId::dedupKey` gives publication-level idempotency for free); the missing piece is a small poll scheduler. Recommend implementing it as the generic listener runtime consuming `pollIntervalMs` (`automation/types.ts:306`) so the declared citius `listenerConfig` becomes real in the follow-up run at no extra cost.
4. **E2/E3**: copy the `citius.ts` discipline exactly - committed fixtures, injected `fetchImpl`, `guardedFetch` default, honest `unavailable`. `decodeHtml` (citius.ts:64-78) is directly reusable for any PT registry HTML; extract it to a shared helper inside `api/src/legal/` when E2 lands.
5. **E5**: DGSI/DRE verify-only needs no new code path - ride `verifyUrl` (research.ts:121-143).
6. **FLOW_PLAN adjustment (minor)**: E1 should also decide the auth tier for portal routes - the existing consulta route is header-scoped app-gated (access-gate), which fits served apps but not a dashboard dossie surface; state the chosen tier in E1's acceptance rather than inheriting the legal-suite gate implicitly. No other E1-E5 changes needed; A4 confirms E's premise (public tier is genuinely public; nothing signed-in leaks into E).
