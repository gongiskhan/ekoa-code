# F1 - KNOWLEDGE-DURING-BUILD - impl notes

Slice F1 of the autothing run (branch `operator-run`). Kind: api (server-side; no web/ dashboard
work). Size 5/100. Deterministic verification only (vitest + tsc + eslint) - the LIVE proof lands
with F2's gate after E2 frees the boot-b stack. I did NOT commit; the lead runs the gates.

## What I built + why

F1's acceptance is a build-flow enrichment, not a new knowledge-area subsystem. A3
(`analysis/03-knowledge-hooks.md`) already proved: (1) builds ground knowledge + mount the
org-scoped knowledge tools with the build actor; (2) mid-build ingest is a plain `ingestDocument`
call, immediately searchable; (3) the standing convention is a SEAM bound in `server.ts`; (4) the
upload transport gap is that nothing ties an upload to the current run. F1 closes the loop with
three pieces:

1. **Deterministic domain-heavy detector** - `api/src/agents/domain-scoping.ts` (NEW).
   `detectDomainHeavy(text) -> { domainHeavy, domains[] }`. Pure lexical classifier: fold (lowercase
   + strip accents, mirrors `grounding.ts`), tokenise, match curated PT+EN keyword sets per domain.
   **No model call, no egress** (CLAUDE.md FIXED-4). Returns the matched domain KEYS so the
   narration can name the area(s). Also exports the two PT-PT copy builders
   (`knowledgeScopingNarration`, `knowledgeIndexedNarration`).

   - **Why a new detector, not `grounding.ts` isLegalContext:** the two serve different concerns and
     I kept them decoupled on purpose. `isLegalContext` (tier-3 knowledge/) gates whether a build
     proactively GROUNDS the legal spine; `detectDomainHeavy` (tier-5 agents/) gates whether the
     build NARRATES a knowledge request across several domains. Reusing isLegalContext would (a)
     force agents/ to reach into knowledge/ for a keyword list, (b) collapse "which domain" to a
     boolean, and (c) couple the narration policy to the grounding gate. Independent modules, each
     owning its concern, is the cleaner long-term shape. Documented in the module header.

   - **Detection signal set (deterministic):** 6 domains, each a tight PT+EN keyword set chosen to
     fire on apps that lean on specialised org knowledge and stay silent on generic apps:
     - `juridico` (label "jurídica"): tribunal, acordao, jurisprudencia, advogado, advocacia,
       juridic, peticao, penhora, sentenca, citacao, clausula, contrato, litigio, "processo
       judicial", diligencia, contestacao, escritura, notario / lawsuit, litigation, court,
       attorney, plaintiff, defendant, statute, jurisdiction, "case law", "legal case".
     - `financeiro` ("financeira"): taxa, taxas, custas, honorarios, juros, imposto, iva, fatura,
       faturacao, contabil, contabilidade, tesouraria, tarifario, fiscal / fee, fees, invoice,
       invoicing, vat, accounting, tariff, levy.
     - `saude` ("clínica"): clinic, clinico, paciente, doente, diagnostico, prescricao, medicamento,
       sintoma, terapeutica / patient, clinical, diagnosis, prescription, dosage, healthcare.
     - `seguros` ("seguros"): seguro, apolice, sinistro, resseguro, segurado / insurance,
       underwriting, actuarial, "insurance claim", "insurance policy".
     - `conformidade` ("de conformidade regulamentar"): rgpd, conformidade, regulament,
       "branqueamento de capitais" / gdpr, compliance, regulatory, statutory, hipaa, kyc, aml.
     - `imobiliario` ("imobiliária"): imovel, imoveis, arrendamento, senhorio, inquilino,
       imobiliaria, hipoteca / "real estate", "property lease", landlord, tenant, mortgage.
   - **Matcher (false-positive-safe):** multi-word keyword -> folded substring; short token (<=3,
     e.g. iva/vat/kyc/aml) -> EXACT token match (never substring, so "vat" does not fire on
     "vatican"); stem (>=4) -> token equals-or-STARTS-WITH (so "taxa"->"taxas", "apolice"->
     "apolices" match without a stemmer). Prefix-only (not substring), and bare English "tax" is
     deliberately excluded, so "syntax"/"taxonomy" never fire. Generic terms that also occur in
     everyday apps ("orcamento"/budget, bare "payment", bare "policy") are intentionally omitted.

2. **Mid-build ingest seam** - `api/src/agents/seams.ts` (additive) + bound in `api/src/server.ts`.
   `ingestBuildKnowledge(actor, doc, deps) -> { id }`, honest default `{ id: '' }` (unwired root
   ingests nothing, so the build narrates no false confirmation). The composition root binds it to
   `knowledge/ ingestDocument` with a `build-scoping` sourceType default. **Org-scoped BY
   CONSTRUCTION** (orgId rides the run's actor, never a request/tool argument) and the reserved
   `_shared` partition is refused by the service's existing `assertNotSharedActor` - **no new
   permission logic** (H block owns that; I only reuse existing org threading + the existing guard).
   Immediately searchable (no rebuild/optimize, per A3).
   - Followed the seam convention (like `knowledgeGrounding`) rather than a direct tier-5->tier-3
     import, for testability + to keep agents/ collaborator-free. `knowledge/index.ts` was widened
     additively to export `ingestDocument` for the `server.ts` binding.

3. **Build-flow hook** - `api/src/agents/build.ts` `executeBuildJob`, first-build branch only
   (`opts.firstBuild`; scoping is a first-build phase - follow-ups skip it). After the routing
   event and before the tool-policy/run setup (so ingested docs are searchable to the mounted
   knowledge tools in the SAME run): run `detectDomainHeavy(input.description)`; if domain-heavy,
   narrate `plan_step { status: 'knowledge-scope' }`, then ingest each `input.knowledgeDocs` via the
   seam (org-scoped) and, if any landed, narrate `plan_step { status: 'knowledge-indexed' }`.
   **Non-blocking + non-fatal** (wrapped in try/catch + console.warn, mirroring the content/grounding
   layers) - the build never waits on or fails for knowledge scoping. Added an additive optional
   `knowledgeDocs?: Array<{ title; text; collection? }>` to `BuildCreateInput`.

### "Asks where the domain knowledge comes from"
Satisfied by the narration. `knowledgeScopingNarration` tells the operator the app looks
domain-heavy in area X and that they can carry reference documents to the **org knowledge area**,
which the build then uses. PT-PT, formal register (voce - "pode carregar", never tuteio),
brand-neutral (no "EKOA"), no emoji, no em-dash (asserted in tests).

### Upload-transport verdict: REUSE `POST /api/v1/knowledge/uploads` (no new endpoint)
Per A3 §4, that route accepts an upload at ANY time (raw body + `X-Filename`/`X-Collection`, 50 MB,
text/markdown ingested synchronously) and the ingest is immediately visible to the very next
grounding/tool call in the same run. So a doc uploaded mid-build is reachable by the build agent's
`knowledge_search`/`knowledge_read` tools with **zero new transport**. I added NO new upload
endpoint. The new `ingestBuildKnowledge` seam covers the distinct case A3 flagged as the only
possibly-new plumbing: content the BUILD itself receives to persist (scoping-provided docs on the
run request), which the uploads route cannot represent because it is decoupled from any run.

### Narration channel: REUSE `plan_step` (no shared/events.ts change)
The build stream's `JobEvent` union already carries `plan_step { status, description?, detail? }`,
already client-handled (the verify stage emits it), and the detector's output is a narration. I put
the copy in `description` under two new free-string statuses (`knowledge-scope`,
`knowledge-indexed`). I deliberately did NOT add a new `JobEvent` member: a server-emitted event with
no web subscriber risks the ch13 §13.5 protocol-parity gate, and web work is out of scope for this
api slice. A dedicated structured event (to drive an upload affordance) is a clean F2/G/H add when
the web side lands. Consequence: no `shared/` contract change was needed, so no contract-test
addition was required (test (d) is vacuous this slice). The reused `plan_step` payloads are already
covered as valid `JobEvent` members.

## Files touched (all within reserved paths)

New:
- `api/src/agents/domain-scoping.ts` - detector + PT-PT narration copy.
- `api/tests/agents/domain-scoping.test.ts` - detector + copy unit tests.
- `api/tests/knowledge/build-knowledge-ingest.test.ts` - the seam wired like server.ts, over real
  FTS + mongo-mem in a temp `EKOA_DATA_DIR`.

Modified:
- `api/src/agents/seams.ts` - `ingestBuildKnowledge` seam (+ `Actor` import, + reset).
- `api/src/agents/index.ts` - re-export `setIngestBuildKnowledge` + types.
- `api/src/agents/build.ts` - `knowledgeDocs?` on `BuildCreateInput` + the first-build scoping hook.
- `api/src/knowledge/index.ts` - additive export of `ingestDocument` for the server.ts binding.
- `api/src/server.ts` - bind `setIngestBuildKnowledge` -> `ingestDocument` (build-scoping sourceType).
- `api/tests/agents/build.test.ts` - F1 describe block (narrate / ingest-with-actor-org / generic
  silent / follow-up skip). Also removed two pre-existing dead imports (getRun, FakeTransportScript)
  to clear their lint warnings.
- `docs/diagrams/04-agent-job.excalidraw` - F1 knowledge-scoping note beside the C1 scoping note.

NOT touched (by design): `shared/src/{chat,events,knowledge}.ts` (plan_step reuse -> no additive
contract needed), `api/src/apps/build-mechanics.ts` (not needed), and all E2-reserved files.

## Commands run + results

- `npm run typecheck --workspace shared` -> PASS.
- `npx tsc --noEmit -p api/tsconfig.json` (api SRC) -> PASS (exit 0), no F1 errors.
- `npx tsc --noEmit -p api/tsconfig.test.json` (api TESTS) -> 3 errors, ALL pre-existing and in
  E2's active tour area (`tests/apps/serving-tours.test.ts`: `ServingDeps.verifyToken`;
  `tests/apps/tour-writer.test.ts`: tour `.dump`/`.card`). None reference any F1 file (grep-filtered
  to confirm). Flagged, not mine - E2 is live-editing tour-player/AssistantPanel right now.
- `npx eslint <9 touched files>` -> 0 errors. Removed two pre-existing dead imports in
  build.test.ts (getRun, FakeTransportScript) to clear their warnings; one pre-existing warning
  remains (`t` at build.test.ts:300, a `void t` in the UNCHANGED sdkSessionId test - not F1 code).
- `npx vitest run tests/agents/domain-scoping.test.ts tests/knowledge/build-knowledge-ingest.test.ts
  tests/agents/build.test.ts` -> **31 passed**.
- `npx vitest run tests/knowledge tests/agents` (regression) -> **163 passed (20 files)**.
- `npm run gate:chokepoint` (root) -> clean (no `@anthropic-ai/` or `api.anthropic.com` outside
  `api/src/llm/`). F1 adds no model call.

## Test inventory

(a) Detector + narration - `api/tests/agents/domain-scoping.test.ts`:
- positive PT (juridico via "processo judicial", financeiro via taxas/custas, saude, seguros) +
  positive EN (court/fees -> juridico+financeiro, insurance, invoicing/VAT, GDPR compliance);
- negative: crm, sales dashboard, lista de tarefas, loja online, **"syntax highlighter"** and
  **"taxonomy browser"** (substring-false-positive guards), "personal budget tracker", blog;
- accent-insensitivity + empty input;
- copy rules: names the area, points at "área de conhecimento da organização", formal "Pode
  carregar" / no "podes", NO emoji, NO em/en-dash, brand-neutral (no "ekoa"); number agreement for
  1 vs many indexed docs.

(b) Mid-build ingest seam - `api/tests/knowledge/build-knowledge-ingest.test.ts` (real FTS +
mongo-mem, seam wired exactly as server.ts):
- ingest lands in the run actor's org and is IMMEDIATELY searchable (same call), sourceType
  `build-scoping`;
- org-scoped: a second org never sees it (partition holds);
- reserved `_shared` refused (FORBIDDEN 403, `KnowledgeError`) via the service guard;
- honest default (unwired root) ingests nothing, returns empty id.

(c) Build-flow narration/ingest - `api/tests/agents/build.test.ts` F1 block:
- domain-heavy first build emits exactly one `knowledge-scope` plan_step, PT-PT, no emoji/dash, and
  does NOT ingest without knowledgeDocs;
- scoping-provided docs are ingested via the seam **with the run actor's org (`o1`)** + `build-scoping`
  sourceType, and a `knowledge-indexed` plan_step is narrated ("Foi indexado 1 documento");
- a generic first build neither narrates nor ingests (knowledgeDocs ignored when not domain-heavy);
- follow-up builds skip knowledge scoping even with a domain-heavy description.

## Diagram updated
`docs/diagrams/04-agent-job.excalidraw` (the agent-job lifecycle) - added a note beside the C1
scoping-classifier box describing the F1 hook: first-build scoping also runs the deterministic
domain-heavy detector; domain-heavy -> `plan_step { knowledge-scope }` + ingest scoping docs via the
`ingestBuildKnowledge` seam (server.ts -> ingestDocument; org-scoped, `_shared` refused, searchable
to the run's knowledge tools) -> `plan_step { knowledge-indexed }`; non-blocking, follow-ups skip.
The existing SSE-union box already lists `plan_step`, so no union change was needed there.

## Deferred to F2 / G / H (with reasons)

- **Web upload affordance + jobs-route population of `knowledgeDocs`.** The capability (seam +
  first-build hook + additive `BuildCreateInput.knowledgeDocs`) is wired and tested by populating
  the field directly in the build tests. The web scoping UI that lets the operator drop reference
  docs, and the `api/src/routes/jobs.ts` + `shared/` jobs-request additive field that carry them
  from the client, are deferred to F2/G (F2 is api slice's LIVE proof; jobs.ts is out of my reserved
  paths). Until then the primary in-run path is the reused uploads route + the mounted knowledge
  tools; `knowledgeDocs` is the forward-looking scoping-provided-content path.
- **A dedicated structured SSE event for the knowledge request** (to render an upload button):
  deferred to when web lands, to avoid the protocol-parity gate risk of a server event with no
  subscriber. `plan_step` reuse is sufficient for the api slice.
- **Build grounding on domain-heavy (not just legal).** Left unchanged: build grounding stays
  legal-gated; the build agent reaches domain docs via the always-mounted knowledge tools (not the
  legal-gated proactive block). D1's served-app assistant grounds with `kind:'chat'` (always), so
  F2's cited-answer path does not need this. A one-line policy change if a later slice wants
  proactive domain grounding.
- **SUITE_LEDGER.json rows** for the two new suites: the ledger is not test-enforced (no TS test
  references it) and it is outside my reserved paths; leaving the ledger bookkeeping to the lead.

## Observed (not mine)
Pre-existing api test-project typecheck errors in E2's active tour area
(`tests/apps/serving-tours.test.ts`, `tests/apps/tour-writer.test.ts`) - unrelated to F1, surfaced
by E2's in-flight tour-player/AssistantPanel work in the shared tree. Left for E2/the lead.
