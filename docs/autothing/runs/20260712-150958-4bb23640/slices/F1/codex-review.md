Reading additional input from stdin...
OpenAI Codex v0.142.5
--------
workdir: /Users/ggomes/dev/ekoa-code
model: gpt-5.4
provider: openai
approval: never
sandbox: read-only
reasoning effort: medium
reasoning summaries: none
session id: 019f5a68-17f2-75e3-913e-11ef78d3665b
--------
user
You are an adversarial cross-model code reviewer. Repo: /Users/ggomes/dev/ekoa-code, branch operator-run. Review COMMIT 376f560 (run: git show 376f560) - slice F1 'knowledge-during-build' of a gated feature run. Acceptance: build scoping deterministically detects domain-heavy apps (6-domain PT+EN lexical detector, api/src/agents/domain-scoping.ts); narrates a PT-PT knowledge request in the build stream (plan_step reuse, no shared/ contract change); mid-build ingest via a new injected seam ingestBuildKnowledge (api/src/agents/seams.ts, bound in api/src/server.ts to knowledge ingestDocument, sourceType build-scoping); org-scoped via the run actor with _shared refused by the existing service guard; additive optional BuildCreateInput.knowledgeDocs; first-build only; non-blocking. Constraints to enforce: NO new security/auth/permission logic (a stubbed can() seam era exists; H block owns security); no model calls in the detector; no @anthropic-ai import outside api/src/llm/; agents/ must not import knowledge/ directly (seam bound only in server.ts); tier direction respected. Context docs: docs/autothing/runs/20260712-150958-4bb23640/analysis/03-knowledge-hooks.md (design ground truth) and slices/F1/impl-notes.md (worker claims - verify, do not trust). Tests added: tests/agents/domain-scoping.test.ts, tests/knowledge/build-knowledge-ingest.test.ts, tests/agents/build.test.ts F1 block. Find REAL defects: org-isolation holes (any path where orgId comes from client-controllable input), _shared write paths, the build hook firing on follow-ups or blocking/failing builds, detector false positives/negatives with concrete inputs, dishonest tests (tautologies), type unsoundness, boundary violations. Number findings with severity High/Medium/Low + file:line + concrete failure scenario; say APPROVE or NEEDS-WORK at the end. Style nits are Low.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `376f560` against the F1 acceptance and constraints first, then I’ll inspect the claimed hook/detector/tests and trace any org or boundary violations back to concrete code paths.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "pwd && ls -la && [ -d .codegraph ] && echo CODEGRAPH_PRESENT || echo CODEGRAPH_MISSING && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'AGENTS.md' -g 'docs/autothing/runs/20260712-150958-4bb23640/analysis/03-knowledge-hooks.md' -g 'slices/F1/impl-notes.md'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
/Users/ggomes/dev/ekoa-code
total 1232
drwxr-xr-x@  32 ggomes  staff    1024 Jul 12 16:38 .
drwxr-xr-x   30 ggomes  staff     960 Jul  8 20:58 ..
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 04:34 .claude
drwxr-xr-x@   9 ggomes  staff     288 Jul 13 08:36 .codegraph
-rw-r--r--@   1 ggomes  staff     281 Jul  8 10:24 .dockerignore
drwxr-xr-x@   5 ggomes  staff     160 Jul 12 15:57 .ekoa-run
-rw-r--r--@   1 ggomes  staff    5369 Jul  8 04:08 .eslintrc.cjs
drwxr-xr-x@  16 ggomes  staff     512 Jul 13 08:35 .git
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:59 .githooks
drwxr-xr-x@   3 ggomes  staff      96 Jul  6 18:55 .github
-rw-r--r--@   1 ggomes  staff     791 Jul 11 22:20 .gitignore
-rw-r--r--@   1 ggomes  staff     450 Jul  7 02:23 .npmrc
drwxr-xr-x@  56 ggomes  staff    1792 Jul 12 07:34 .playwright-cli
drwxr-xr-x@   6 ggomes  staff     192 Jul 11 22:20 .walkthrough
-rw-r--r--@   1 ggomes  staff    5797 Jul 11 22:20 CLAUDE.md
-rw-r--r--@   1 ggomes  staff    1992 Jul  8 10:24 Dockerfile.api
-rw-r--r--@   1 ggomes  staff    1658 Jul  8 10:24 Dockerfile.web
-rw-r--r--@   1 ggomes  staff   28666 Jul 13 08:01 RUN_LOG.md
drwxr-xr-x@  18 ggomes  staff     576 Jul 12 19:38 api
-rw-r--r--@   1 ggomes  staff       5 Jul  6 22:50 backend.port
drwxr-xr-x@   6 ggomes  staff     192 Jul  8 10:26 deploy
drwxr-xr-x@  17 ggomes  staff     544 Jul 13 07:49 docs
drwxr-xr-x@   3 ggomes  staff      96 Jul  8 09:40 ekoa-data
drwxr-xr-x@ 715 ggomes  staff   22880 Jul 11 15:53 node_modules
-rw-r--r--@   1 ggomes  staff  545459 Jul 11 22:20 package-lock.json
-rw-r--r--@   1 ggomes  staff    1751 Jul  8 04:36 package.json
-rw-r--r--@   1 ggomes  staff    1070 Jul  7 01:01 playwright.config.ts
drwxr-xr-x@  11 ggomes  staff     352 Jul 11 22:20 scripts
drwxr-xr-x@   8 ggomes  staff     256 Jul  6 19:06 shared
drwxr-xr-x@   3 ggomes  staff      96 Jul 12 06:09 test-results
-rw-r--r--@   1 ggomes  staff     429 Jul  6 18:55 tsconfig.base.json
drwxr-xr-x@  24 ggomes  staff     768 Jul 13 02:47 web
CODEGRAPH_PRESENT
docs/autothing/runs/20260712-150958-4bb23640/analysis/03-knowledge-hooks.md

exec
/bin/zsh -lc 'git show --stat --oneline 376f560' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-W0Pu9btD' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-a8DWHKoQ' (errno=Operation not permitted)
376f560 feat(operator-run/f1): knowledge-during-build - domain scoping + mid-build ingest + narration
 api/src/agents/build.ts                            |  37 +++-
 api/src/agents/domain-scoping.ts                   | 177 ++++++++++++++++++
 api/src/agents/index.ts                            |   3 +
 api/src/agents/seams.ts                            |  40 ++++
 api/src/knowledge/index.ts                         |   4 +
 api/src/server.ts                                  |  20 +-
 api/tests/agents/build.test.ts                     |  96 +++++++++-
 api/tests/agents/domain-scoping.test.ts            | 109 +++++++++++
 api/tests/knowledge/build-knowledge-ingest.test.ts | 111 ++++++++++++
 .../slices/F1/impl-notes.md                        | 201 +++++++++++++++++++++
 docs/diagrams/04-agent-job.excalidraw              |  64 ++++++-
 11 files changed, 853 insertions(+), 9 deletions(-)

codex
The repo is CodeGraph-indexed, so I’m using that plus the design notes before reading the changed files. I’ve confirmed the commit touches the exact F1 paths the worker claimed.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "sed -n '1,220p' docs/autothing/runs/20260712-150958-4bb23640/analysis/03-knowledge-hooks.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
# A3 — Knowledge-area hooks (verified analysis)

Basis for **F1** (knowledge-during-build) and **D1** (served-app assistant domain answers).
Read-only pass over `api/src/knowledge/`, `api/src/agents/`, `api/src/apps/`, `shared/src/`,
`api/tests/knowledge/`, and the composition root (`api/src/server.ts`). All paths absolute, line
numbers cited. Auth/session internals noted by filename only, not explored.

Headline: **the build pipeline already grounds knowledge and already mounts the knowledge tools
with the build actor's org** — F1 is mostly an *enrichment of an existing call*, not a new hook.
And the served-app assistant endpoint contract **already exists** (`/api/app-assistant`) but has
**no route implementation** — D1 is a new route that reuses `buildGroundingBlock` /
`searchKnowledgeIndex` under the artifact owner's org.

---

## 1. Indexing paths today

### What triggers ingest

Two, and only two, write paths reach the vault + FTS index:

1. **REST upload / document create** (online, org-scoped) — `api/src/routes/knowledge.ts`:
   - `POST /api/v1/knowledge/documents` (`knowledge.ts:42-52`) → `ingestDocument(actor, body, deps)`
     (`service.ts:172-201`).
   - `POST /api/v1/knowledge/uploads` (`knowledge.ts:129-150`, raw body + `X-Filename` /
     `X-Collection` headers) → `createUpload(actor, {...}, deps)` (`service.ts:259-301`). Plain
     text/markdown is ingested (`isTextUpload`, `service.ts:250-254`) via `ingestDocument`; other
     formats are stored as a blob and registered `status: 'registered'` (un-indexed, honest — no
     silent partial index).
   - `POST /api/v1/knowledge/reindex` (`knowledge.ts:159-167`, org-admin/super-admin only) →
     `reindexOrg` (`service.ts:328-334`): `clearOrg` then `indexOrgFromVault`.
2. **Offline importer CLI** (the `_shared` corpus only) — `npm run tool:knowledge-import`
   (`api/package.json:14` → `api/scripts/migrate/knowledge/cli.ts` → `importer.ts`
   `runKnowledgeImport`, `importer.ts:180-348`). This is the **sole sanctioned writer of
   `_shared`**; it writes vault files + `bulkIndexDocs` + `optimizeIndex` (`importer.ts:224-256,
   325-328`). Dry-run by default, idempotent via a hash state file, `--execute` to write.

There is **no crawler** (the `sources` "crawl" endpoints return honest "nothing happened",
`knowledge.ts:96-116`), and **no human search REST endpoint** by design — agents consume search/read
via in-process tools, not REST (`knowledge.ts:1-4`).

### What an entry looks like — on disk and in the index

Filesystem layout (`paths.ts:1-11, 45-77`), all under one data dir (`EKOA_DATA_DIR` or
`~/.ekoa/data`):

```
<dataDir>/knowledge/vault/<orgId>/<collection>/<docId>.md   one file/doc, JSON-encoded frontmatter
<dataDir>/knowledge/uploads/<orgId>/<uploadId>              raw upload blob (P-07)
<dataDir>/knowledge/index/fts.db                            derived FTS5 index (regenerable)
```

- **Vault file** (`vault.ts:36-44, 71-83`): a `---`-fenced frontmatter block with a fixed scalar set
  — `title`, `sourceUrl?`, `sourceType?`, `language?`, `createdAt` — each **`JSON.stringify`-encoded**
  so colons/quotes/newlines round-trip, followed by the markdown body. `vault.ts` is the ONLY writer
  of vault files.
- **Index row** (`index-store.ts:26-36, 99-106`): one FTS5 row in `knowledge_fts` with columns
  `orgId, collection, docId` (all `UNINDEXED`), `title, body` (searchable), and
  `createdAt, sourceUrl, sourceType, language` (`UNINDEXED`). Tokenizer
  `unicode61 remove_diacritics 2` folds accents on both sides. A side map `knowledge_doc_map`
  (`index-store.ts:112-118`) keys `(orgId, collection, docId) → ftsRowid` so writes/deletes are a
  point lookup rather than an O(table) scan; it self-heals on open if it drifts
  (`healDocMap`, `index-store.ts:128-141`).

### Org partitioning + `_shared` corpus rules

- **Partition is a path segment AND a stored column.** Every vault path is `vault/<orgId>/...`
  (`paths.ts:55-66`); every index row stores `orgId` and **every search filters by it**
  (`search`, `index-store.ts:237-258`: `WHERE ... orgId IN (?, ?)`). A cross-org search is
  structurally impossible (proven by tests, §5).
- **`_shared`** (`paths.ts:32-40`, `SHARED_ORG_ID = '_shared'`): the one reserved public legal-spine
  partition consulted by *every* org's search. It rides the same path-safety and index code as a
  normal org. The `_` prefix passes `SEGMENT_RE` yet **can never collide** with a real org id
  (`randomUUID` is hex+dashes, never `_`-prefixed), so no firm is ever routed to it.
- **`_shared` is read-only online.** `assertNotSharedActor` (`service.ts:54-65`) refuses any request
  actor presenting `orgId === '_shared'` on every mutating service op (ingest, upload, delete,
  reindex) with `FORBIDDEN 403`. Only the offline importer writes it.
- **Search is dual-scope** (`index-store.ts:230-272`): a caller sees its own partition **plus**
  `_shared`, nothing else. When the caller *is* `_shared` the two ids collapse to one scan (no dup).
  Each hit carries `scope: 'org' | 'shared'` (`index-store.ts:45-48, 268`) but the raw `orgId`
  never surfaces.
- **Read fallback / shadowing** (`readDocWithShared`, `service.ts:221-230`): an org doc shadows a
  `_shared` doc on the same `(collection, docId)`; a `_shared`-scope caller reads it once.

---

## 2. Mid-build indexing feasibility

### Is a tier-5 → tier-3 call legal? Yes — twice over.

- **Tier table** (`docs/architecture.md:67-81`): `agents/`, `apps/` are **tier 5**; `knowledge/` is
  **tier 3**. Imports point strictly downward → a tier-5 module importing tier-3 `knowledge/` is a
  legal downward import.
- **Lint does NOT forbid it.** `.eslintrc.cjs` `import/no-restricted-paths` zones
  (`.eslintrc.cjs:56-102`) cover only: repo boundaries (web/api/shared), "nothing imports `routes/`
  or `server.ts`", and "`routes/` ↛ `data/`". There is **no zone** restricting `agents/` or `apps/`
  from importing `knowledge/`. The seam pattern (`server.ts` wiring, below) is a **dependency-inversion
  convention for testability**, not a lint rule. So F1 has two legal shapes: a direct
  `import { knowledgeService } from '../knowledge/index.js'` OR a new injected seam.
- Note the standing convention (`knowledge/index.ts:10-25`): today `agents/` never imports
  `knowledge/` directly — it reaches search/read/grounding through the seams `server.ts` binds.

### The call the build flow would make

`ingestDocument` already has exactly the signature a mid-build ingest needs
(`service.ts:172-201`):

```ts
ingestDocument(
  actor: Actor,                                        // { userId, orgId, role }
  input: { collection, title, text, sourceUrl?, sourceType?, language? },
  deps: { now: () => number; genId: () => string },
): Promise<{ id: string }>
```

It writes the vault file **and runs the index write hook** (`index.indexDoc`, `service.ts:189-199`).
The build pipeline already carries everything it needs:

- `build.ts` has `input.actor` with `.orgId` and `.userId` throughout (e.g. `build.ts:346-347,
  109-110, 200`).
- `build.ts` already threads `input.deps` for `now`/`genId` (`build.ts:502`, and `deps` reach
  `createBuildMechanics(deps)` at `server.ts:219`).

So a mid-build ingest is `ingestDocument(input.actor, {collection, title, text, sourceType:'build-upload'}, input.deps)` — no new plumbing for identity or deps.

### Does ingestion need an FTS rebuild/optimize afterwards? No.

- `ingestDocument` → `index.indexDoc` → `bulkIndexDocs([row])` in one transaction with
  insert-or-replace semantics (`index-store.ts:145-187`). The doc is **immediately searchable**;
  no rebuild needed. (`service.test.ts:40-50` proves ingest → searchable in the same call.)
- `optimizeIndex` (`index-store.ts:189-193`) is a **segment-merge for query speed after a bulk
  import** — the importer calls it once at the end of an execute run (`importer.ts:327`). A handful
  of docs ingested mid-build do **not** warrant it; it is off the hot path.
- `bulkIndexDocs` / `reindexOrg` / `backfillKnowledgeIndex` are for bulk/heal, not per-doc ingest.
  F1 should call the per-doc `ingestDocument`, not the batch path.

**Conclusion:** F1 ingest during build = a plain `ingestDocument` call with the build actor + deps.
No rebuild, no optimize, no new index mechanics.

---

## 3. Retrieval + citation path for a served-app assistant (D1)

### `buildGroundingBlock` — exact I/O (`grounding.ts:40-70`)

Input (`GroundingInput`, `grounding.ts:40-46`):
```ts
{ orgId: string; query: string; kind: 'chat' | 'build'; limit?: number /* default 5 */ }
```
Output (`GroundingResult`, `grounding.ts:48-51`):
```ts
{ block: string; hits: SearchHit[] }
```
- `kind: 'build'` gates on the deterministic legal-context detector (`isLegalContext`,
  `grounding.ts:34-38`): non-legal build → `{ block: '', hits: [] }`. `kind: 'chat'` always grounds.
  **A served-app assistant is conversational → use `kind: 'chat'`** (always ground).
- Empty when nothing relevant in the org partition (**cited-or-silent** — never hallucinated
  filler, `grounding.ts:63-69`).
- The block is `search(orgId, query, limit)` (dual-scope: caller's org + `_shared`), formatted by
  `formatBlock` (`grounding.ts:53-61`).

### How citations reference entries

Citations are **`collection / title` + `(doc <docId>)`**, numbered, one per hit
(`formatBlock`, `grounding.ts:56-59`):
```
CONHECIMENTO (excertos com fonte citada; use apenas o que for relevante):
[1] <collection> / <title> (doc <docId>)
<snippet>
```
Each `SearchHit` (`index-store.ts:38-48`) carries `docId, collection, title, sourceUrl?, snippet,
score, scope`. The **row `orgId` never surfaces** (only `scope: 'org'|'shared'`). So a citation is
addressed by `(collection, docId)` — the same pair `knowledge_read` takes.

### How `agents/context.ts` consumes it for chat today

- Chat calls `assembleRunContext({ ..., isChat: true, groundKnowledge: false })`
  (`chat.ts:124-132`). Inside, **Layer 2** (`context.ts:89-93`) calls the `knowledgeGrounding`
  seam (`if (input.isChat || input.groundKnowledge)`) and pushes the returned block into the system
  prompt sections. The seam is bound at the root to `buildGroundingBlock`
  (`server.ts:215-217`), mapping `agentKind → kind`.
- Separately, chat mounts the **in-process knowledge tools** so the model can search/read on demand
  (`chat.ts:144-149` → `knowledgeToolSpecs(input.actor)`, `sdk-tools.ts:27-71`). Those bind to
  `searchKnowledgeIndex` / `readDocWithShared` at the root (`server.ts:227-239`). The tool's `orgId`
  comes from the run actor, **never from tool arguments** (`sdk-tools.ts:1-6, 43, 60-64`).

### What `/api/app-assistant` would need to reuse it under the ARTIFACT OWNER's org

The endpoint contract **already exists** but **has no route** (see §Memo + grep in §5):
`shared/src/app-assistant.ts:22-30` — `POST /api/app-assistant`, `auth: 'header-scoped'`,
request `{ message, history? }`, response `{ reply }`.

`header-scoped` = the served-app admission plane (no JWT), keyed on the `X-Ekoa-App-Id` header,
the same mechanism as `/api/app-data/*` (`shared/src/served-app.ts:22-33`,
`api/src/apps/served-data.ts:68-136`). The owner-org resolution chain a D1 route needs:

1. `X-Ekoa-App-Id` header → `resolveApp(header)` (`apps/registry.ts:24-50`) → `ResolvedApp` with
   **`ownerUserId`** (`registry.ts:11-21`).
2. Owner-activation gate (`admitOwner`, `served-data.ts:85-101`) — fail-closed if the owner's
   account is disabled/billing-locked. D1 should reuse this.
3. `ownerUserId → orgId`: the actor's org lives on the user record — `actorOf` reads
   `u.orgId` (`api/src/routes/helpers.ts:11-13`); the users store carries `orgId`
   (`api/src/data/stores.ts:54`). D1 must look up the owner's `orgId` from `ownerUserId`
   (a users-store read; exact function is an auth/session detail, noted not explored).
4. With `orgId` in hand, call `buildGroundingBlock({ orgId, query: message, kind: 'chat' })`
   (grounding) and/or mount `knowledgeToolSpecs({ userId: ownerUserId, orgId })` on the run — the
   grounding + tools are **already org-agnostic in signature**, so reuse is a matter of passing the
   *owner's* org rather than the request actor's.

The load-bearing D1 property: the served-app visitor is anonymous, so the assistant must run under
the **artifact owner's** org (resolved server-side from the app id), never a caller-supplied org.
The existing seams enforce "orgId from actor, not from arguments"; D1 continues that by deriving
orgId from the resolved app owner.

---

## 4. Upload-during-chat mechanics

### How uploads reach the platform today


exec
/bin/zsh -lc "rg --files | rg '("'^|/)(PRD|PLANING|TASKS)'"\\.md"'$|slices/F1/impl-notes'"\\.md"'$'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
docs/autothing/runs/20260712-150958-4bb23640/slices/F1/impl-notes.md

exec
/bin/zsh -lc "sed -n '1,260p' docs/autothing/runs/20260712-150958-4bb23640/slices/F1/impl-notes.md" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
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

codex
I have the design ground truth and the worker’s claims. Next I’m checking whether the implementation actually follows the seam/tier/org constraints, rather than trusting the notes or test descriptions.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'codegraph explore "executeBuildJob detectDomainHeavy knowledgeScopingNarration knowledgeIndexedNarration ingestBuildKnowledge BuildCreateInput"' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'git show 376f560 -- api/src/agents/build.ts api/src/agents/domain-scoping.ts api/src/agents/seams.ts api/src/server.ts api/src/knowledge/index.ts api/tests/agents/build.test.ts api/tests/agents/domain-scoping.test.ts api/tests/knowledge/build-knowledge-ingest.test.ts' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-JWuS8oPK' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-YOgRb85u' (errno=Operation not permitted)
commit 376f560a86d290e337558f731edad46b0f6c2e8a
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 08:35:40 2026 +0100

    feat(operator-run/f1): knowledge-during-build - domain scoping + mid-build ingest + narration
    
    Deterministic domain-heavy detector (api/src/agents/domain-scoping.ts): pure
    lexical PT+EN classifier over 6 domains (juridico/financeiro/saude/seguros/
    conformidade/imobiliario), accent-folded, false-positive-safe matching (short
    tokens exact, stems prefix-only - syntax/taxonomy/vatican never fire). No model
    call, no egress.
    
    Mid-build ingest seam ingestBuildKnowledge (agents/seams.ts, bound in server.ts
    to knowledge/ ingestDocument, sourceType build-scoping): org-scoped by
    construction (orgId rides the run actor), _shared refused by the existing
    service guard, immediately searchable to the same run's mounted knowledge
    tools. Honest no-op default when unwired.
    
    Build-flow hook (executeBuildJob, first-build only): domain-heavy description
    narrates plan_step{knowledge-scope} (PT-PT formal, brand-neutral, no emoji);
    scoping-provided knowledgeDocs (additive BuildCreateInput field) are ingested
    via the seam and narrated plan_step{knowledge-indexed}. Non-blocking/non-fatal.
    plan_step reuse = no shared/ contract change (dedicated SSE event deferred to
    the web slice to respect protocol parity).
    
    Upload transport: REUSE POST /api/v1/knowledge/uploads (ingest is immediately
    searchable mid-run) - no new endpoint. Diagram 04-agent-job updated.
    
    Wall: shared+api-src+api-test tsc clean; eslint 0/0; chokepoint grep clean;
    vitest agents+knowledge 163/163 (31 new: detector/copy, seam over real
    FTS+mongo-mem incl. org isolation + _shared 403, build-flow narrate/ingest/
    skip). Live proof lands with F2 (fees app + cited answer) per FLOW_PLAN.
    
    Claude-Session: https://claude.ai/code/session_015PyYEsLxYr7bEe5EP6pNd3

diff --git a/api/src/agents/build.ts b/api/src/agents/build.ts
index 2efaf21..862b24f 100644
--- a/api/src/agents/build.ts
+++ b/api/src/agents/build.ts
@@ -39,7 +39,8 @@ import {
   resetArtifactToDraft,
   type JobRecord,
 } from './jobs.js';
-import { assembleAgentContext, getBuildMechanics, knowledgeGrounding, verifyRunner } from './seams.js';
+import { assembleAgentContext, getBuildMechanics, knowledgeGrounding, ingestBuildKnowledge, verifyRunner } from './seams.js';
+import { detectDomainHeavy, knowledgeScopingNarration, knowledgeIndexedNarration } from './domain-scoping.js';
 import { logActivity } from '../data/activity.js';
 
 /** Registo (F3): build lifecycle rows, metadata-only (ids/codes — NEVER the request description
@@ -67,6 +68,11 @@ export interface BuildCreateInput {
   attachments?: unknown[];
   fieldValues?: Record<string, unknown>;
   configValues?: Record<string, unknown>;
+  /** F1 knowledge-during-build: scoping-provided reference documents to ingest into the org
+   *  knowledge area DURING a domain-heavy first build (org-scoped by the run's actor, immediately
+   *  searchable to the run's knowledge tools). Additive + optional; populated by the scoping UI +
+   *  jobs route in a later slice, exercised directly by the build tests here. */
+  knowledgeDocs?: Array<{ title: string; text: string; collection?: string }>;
   deps: { now: () => number; genId: () => string };
 }
 
@@ -335,6 +341,35 @@ export async function executeBuildJob(jobId: string, input: BuildCreateInput, ab
     sink.routing(decision.tier, opts.firstBuild ? 'first build' : 'follow-up build');
     await patchJob(jobId, { routing: { tier: decision.tier, reason: opts.firstBuild ? 'first build' : 'follow-up build' } });
 
+    // F1 knowledge-during-build (§5.5.2 knowledge area). The first-build scoping phase runs a
+    // DETERMINISTIC domain-heavy detector (no model call, no egress) over the request. A
+    // domain-heavy app NARRATES a knowledge request on the build stream (upload reference
+    // documents to the org knowledge area) and, when the request carried scoping-provided
+    // documents, ingests them into the org knowledge area for THIS run - org-scoped by the run's
+    // actor, refused for the reserved _shared partition, and immediately searchable to the
+    // knowledge tools mounted below. Non-blocking + non-fatal: the build never waits on or fails
+    // for knowledge scoping (mirrors the content/grounding layers).
+    if (opts.firstBuild) {
+      try {
+        const scope = detectDomainHeavy(input.description);
+        if (scope.domainHeavy) {
+          sink.planStep('knowledge-scope', knowledgeScopingNarration(scope.domains));
+          let indexed = 0;
+          for (const doc of input.knowledgeDocs ?? []) {
+            const { id } = await ingestBuildKnowledge(
+              input.actor,
+              { collection: doc.collection || 'uploads', title: doc.title, text: doc.text, sourceType: 'build-scoping' },
+              input.deps,
+            );
+            if (id) indexed++;
+          }
+          if (indexed > 0) sink.planStep('knowledge-indexed', knowledgeIndexedNarration(indexed));
+        }
+      } catch (err) {
+        console.warn('[build] knowledge scoping failed (non-fatal):', err instanceof Error ? err.message : err);
+      }
+    }
+
     const policy = toolPolicyFor('build');
     const liveMarkers = new MarkerProcessor();
     let capturedSessionId: string | undefined;
diff --git a/api/src/agents/domain-scoping.ts b/api/src/agents/domain-scoping.ts
new file mode 100644
index 0000000..287eae1
--- /dev/null
+++ b/api/src/agents/domain-scoping.ts
@@ -0,0 +1,177 @@
+/**
+ * Knowledge-during-build scoping (F1). A DETERMINISTIC, no-model-call detector the first-build
+ * scoping phase runs over the build request to decide whether the app looks domain-heavy - i.e.
+ * it leans on specialised, org-held knowledge (legal rules, fee/tax schedules, clinical protocols,
+ * insurance policies, regulatory obligations, property terms). When it fires, the build NARRATES
+ * a knowledge request in the job stream (upload reference documents to the org knowledge area) and,
+ * when the request carried scoping-provided documents, ingests them into the org knowledge area for
+ * that run (agents/build.ts). The build never blocks on or fails for knowledge scoping.
+ *
+ * This detector is intentionally SEPARATE from knowledge/grounding.ts `isLegalContext`: that one
+ * gates whether a build proactively GROUNDS the legal spine; this one gates whether the build
+ * NARRATES a knowledge request across several domains. Keeping them decoupled avoids agents/
+ * reaching into knowledge/ for a keyword list and lets each evolve on its own concern. No model
+ * call, no egress - a pure lexical classifier (CLAUDE.md FIXED-4: platform logic is design-time TS).
+ */
+
+/** Fold to a lowercase, accent-stripped form for keyword matching (mirrors grounding.ts `fold`). */
+function fold(s: string): string {
+  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
+}
+
+/** Word tokens of the folded text (letters + digits), used for stem/exact matching. */
+function tokens(folded: string): string[] {
+  return folded.match(/[a-z0-9]+/g) ?? [];
+}
+
+/**
+ * A keyword matches when:
+ *  - multi-word phrase  -> substring of the folded text ("processo judicial");
+ *  - short token (<= 3) -> an EXACT token match ("iva", "vat", "kyc") - never a substring, so
+ *    "vat" does not fire on "vatican" and "fee" does not fire on "feed";
+ *  - stem (>= 4)        -> a token that equals or STARTS WITH it ("taxa" -> "taxas",
+ *    "apolice" -> "apolices"), so Portuguese plurals/inflections match without a stemmer.
+ * The stem rule is deliberately prefix-only (not substring) so "tax"-like fragments never fire on
+ * unrelated words; bare "tax" is not a keyword for exactly that reason (see FINANCEIRO below).
+ */
+function matchesKeyword(folded: string, toks: string[], kw: string): boolean {
+  if (kw.includes(' ')) return folded.includes(kw);
+  if (kw.length <= 3) return toks.includes(kw);
+  return toks.some((t) => t === kw || t.startsWith(kw));
+}
+
+/** A knowledge domain: an internal key, its PT-PT label for narration, and its PT+EN keyword set. */
+interface KnowledgeDomain {
+  key: string;
+  /** PT-PT label used in the operator-facing narration (formal register, brand-neutral). */
+  label: string;
+  keywords: string[];
+}
+
+/**
+ * The domain keyword sets (PT + EN, accent-insensitive). Curated to fire on apps that clearly lean
+ * on specialised org knowledge and to stay silent on generic apps (CRM, dashboards, to-do lists,
+ * shops, blogs). Deliberately conservative: terms that also occur in generic apps are left out
+ * (e.g. "orcamento"/"budget", bare "payment", bare "policy", bare "tax") to avoid false positives.
+ */
+const DOMAINS: KnowledgeDomain[] = [
+  {
+    key: 'juridico',
+    label: 'jurídica',
+    keywords: [
+      // PT
+      'tribunal', 'acordao', 'jurisprudencia', 'advogado', 'advocacia', 'juridic', 'peticao',
+      'penhora', 'sentenca', 'citacao', 'clausula', 'contrato', 'litigio', 'processo judicial',
+      'diligencia', 'contestacao', 'escritura', 'notario',
+      // EN
+      'lawsuit', 'litigation', 'court', 'attorney', 'plaintiff', 'defendant', 'statute',
+      'jurisdiction', 'case law', 'legal case',
+    ],
+  },
+  {
+    key: 'financeiro',
+    label: 'financeira',
+    keywords: [
+      // PT - fees/tax/accounting (NOT "orcamento"/budget, which is common in generic apps)
+      'taxa', 'taxas', 'custas', 'honorarios', 'juros', 'imposto', 'iva', 'fatura', 'faturacao',
+      'contabil', 'contabilidade', 'tesouraria', 'tarifario', 'fiscal',
+      // EN - "tax" is omitted on purpose ("syntax"/"taxonomy"); the specific forms below are safe
+      'fee', 'fees', 'invoice', 'invoicing', 'vat', 'accounting', 'tariff', 'levy',
+    ],
+  },
+  {
+    key: 'saude',
+    label: 'clínica',
+    keywords: [
+      // PT
+      'clinic', 'clinico', 'paciente', 'doente', 'diagnostico', 'prescricao', 'medicamento',
+      'sintoma', 'terapeutica',
+      // EN
+      'patient', 'clinical', 'diagnosis', 'prescription', 'dosage', 'healthcare',
+    ],
+  },
+  {
+    key: 'seguros',
+    label: 'seguros',
+    keywords: [
+      // PT
+      'seguro', 'apolice', 'sinistro', 'resseguro', 'segurado',
+      // EN
+      'insurance', 'underwriting', 'actuarial', 'insurance claim', 'insurance policy',
+    ],
+  },
+  {
+    key: 'conformidade',
+    label: 'de conformidade regulamentar',
+    keywords: [
+      // PT
+      'rgpd', 'conformidade', 'regulament', 'branqueamento de capitais',
+      // EN
+      'gdpr', 'compliance', 'regulatory', 'statutory', 'hipaa', 'kyc', 'aml',
+    ],
+  },
+  {
+    key: 'imobiliario',
+    label: 'imobiliária',
+    keywords: [
+      // PT
+      'imovel', 'imoveis', 'arrendamento', 'senhorio', 'inquilino', 'imobiliaria', 'hipoteca',
+      // EN
+      'real estate', 'property lease', 'landlord', 'tenant', 'mortgage',
+    ],
+  },
+];
+
+export interface DomainScopingResult {
+  domainHeavy: boolean;
+  /** The internal keys of the matched domains, in DOMAINS order (stable). */
+  domains: string[];
+}
+
+/**
+ * Detect whether a build request looks domain-heavy. Deterministic (no model call): it folds the
+ * text, tokenises it, and matches the curated per-domain keyword sets. Returns every matched
+ * domain key so the narration can name the area(s).
+ */
+export function detectDomainHeavy(text: string): DomainScopingResult {
+  const folded = fold(text ?? '');
+  const toks = tokens(folded);
+  const domains = DOMAINS.filter((d) => d.keywords.some((kw) => matchesKeyword(folded, toks, kw))).map((d) => d.key);
+  return { domainHeavy: domains.length > 0, domains };
+}
+
+/** PT-PT label list for the matched domain keys ("jurídica e financeira"). Unknown keys ignored. */
+function domainLabels(domainKeys: string[]): string {
+  const labels = domainKeys
+    .map((k) => DOMAINS.find((d) => d.key === k)?.label)
+    .filter((l): l is string => Boolean(l));
+  if (labels.length === 0) return 'especializada';
+  if (labels.length === 1) return labels[0]!;
+  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
+}
+
+/**
+ * The operator-facing knowledge request narrated in the build stream when the app looks
+ * domain-heavy. PT-PT, formal register (voce - "pode carregar", never tuteio), brand-neutral,
+ * no emoji, no em-dash. Tells the operator WHERE the domain knowledge lives (the org knowledge
+ * area) and that documents added there are used in this build. The build does not block on it.
+ */
+export function knowledgeScopingNarration(domainKeys: string[]): string {
+  const area = domainLabels(domainKeys);
+  return (
+    `Esta aplicação parece assentar em conhecimento especializado (área ${area}). ` +
+    'Pode carregar documentos de referência para a área de conhecimento da organização; ' +
+    'assim que estiverem disponíveis, são tidos em conta nesta construção.'
+  );
+}
+
+/**
+ * Confirmation narrated after scoping-provided documents are indexed into the org knowledge area
+ * during the build. Same register/constraints as {@link knowledgeScopingNarration}.
+ */
+export function knowledgeIndexedNarration(count: number): string {
+  const verb = count === 1 ? 'Foi indexado' : 'Foram indexados';
+  const noun = count === 1 ? 'documento' : 'documentos';
+  const avail = count === 1 ? 'já está disponível' : 'já estão disponíveis';
+  return `${verb} ${count} ${noun} na área de conhecimento da organização; ${avail} para esta construção.`;
+}
diff --git a/api/src/agents/seams.ts b/api/src/agents/seams.ts
index c7c7d66..90808a9 100644
--- a/api/src/agents/seams.ts
+++ b/api/src/agents/seams.ts
@@ -9,6 +9,7 @@
  * Each seam has a safe, honest default: an empty context / no grounding / a no-op verifier that
  * reports "not run". A missing collaborator degrades gracefully, never crashes a run.
  */
+import type { Actor } from '@ekoa/shared';
 
 // --- Content loader (ch05 §5.5.1, ch08) --------------------------------------------------
 
@@ -61,6 +62,44 @@ export function knowledgeGrounding(input: KnowledgeGroundingInput): Promise<stri
   return knowledgeGroundingFn(input);
 }
 
+// --- Mid-build knowledge ingest (F1 knowledge-during-build) -------------------------------
+
+/** A scoping-provided document the build persists into the org knowledge area DURING a run. */
+export interface BuildKnowledgeDoc {
+  collection: string;
+  title: string;
+  text: string;
+  /** Marks the doc as build-originated (default at the binding: `build-scoping`). */
+  sourceType?: string;
+  language?: string;
+}
+
+/**
+ * Persist a scoping-provided document into the org knowledge area during a build. The orgId rides
+ * the run's actor (org-scoped BY CONSTRUCTION - never a tool/request argument), and the real
+ * binding forwards to the knowledge service's `ingestDocument`, which refuses the reserved
+ * `_shared` partition (assertNotSharedActor) and indexes the doc immediately (searchable to the
+ * run's knowledge tools with no rebuild/optimize). Honest default: an unwired root ingests nothing
+ * and returns an empty id, so the build narrates no false "indexed" confirmation.
+ */
+export type IngestBuildKnowledgeFn = (
+  actor: Actor,
+  doc: BuildKnowledgeDoc,
+  deps: { now: () => number; genId: () => string },
+) => Promise<{ id: string }>;
+const defaultIngestBuildKnowledge: IngestBuildKnowledgeFn = async () => ({ id: '' });
+let ingestBuildKnowledgeFn: IngestBuildKnowledgeFn = defaultIngestBuildKnowledge;
+export function setIngestBuildKnowledge(fn: IngestBuildKnowledgeFn): void {
+  ingestBuildKnowledgeFn = fn;
+}
+export function ingestBuildKnowledge(
+  actor: Actor,
+  doc: BuildKnowledgeDoc,
+  deps: { now: () => number; genId: () => string },
+): Promise<{ id: string }> {
+  return ingestBuildKnowledgeFn(actor, doc, deps);
+}
+
 // --- In-process MCP knowledge tools (ch05 §5.4.4) -----------------------------------------
 
 /** A search hit the `knowledge_search` tool cites (docId + collection locate it for a read). */
@@ -338,6 +377,7 @@ export function getBuildMechanics(): BuildMechanics {
 export function __resetAgentSeamsForTests(): void {
   assembleAgentContextFn = defaultAssembleAgentContext;
   knowledgeGroundingFn = defaultKnowledgeGrounding;
+  ingestBuildKnowledgeFn = defaultIngestBuildKnowledge;
   knowledgeToolSearchFn = defaultKnowledgeToolSearch;
   knowledgeToolReadFn = defaultKnowledgeToolRead;
   loadContextContentFn = defaultLoadContextContent;
diff --git a/api/src/knowledge/index.ts b/api/src/knowledge/index.ts
index ab528f8..748862e 100644
--- a/api/src/knowledge/index.ts
+++ b/api/src/knowledge/index.ts
@@ -12,6 +12,10 @@ export {
   backfillKnowledgeIndex,
   KnowledgeError,
   readDocWithShared,
+  // The mid-build ingest path (F1): server.ts binds this to the agents/ ingestBuildKnowledge seam
+  // so a build can persist scoping-provided docs into the org knowledge area (org-scoped by actor,
+  // _shared refused, immediately searchable). agents/ never imports knowledge/ - it goes via the seam.
+  ingestDocument,
   type CreateDocumentInput,
 } from './service.js';
 export { buildGroundingBlock, isLegalContext, type GroundingInput, type GroundingResult } from './grounding.js';
diff --git a/api/src/server.ts b/api/src/server.ts
index 60d5dda..d8eede0 100644
--- a/api/src/server.ts
+++ b/api/src/server.ts
@@ -78,6 +78,7 @@ import { jobsRouter } from './routes/jobs.js';
 import {
   setAssembleAgentContext,
   setKnowledgeGrounding,
+  setIngestBuildKnowledge,
   setKnowledgeToolSearch,
   setKnowledgeToolRead,
   setLoadContextContent,
@@ -90,7 +91,7 @@ import {
   sweepOrphans,
 } from './agents/index.js';
 import { assembleAgentContext, bootContentLoader, composeContext, configureContentLoader } from './content/index.js';
-import { backfillKnowledgeIndex, buildGroundingBlock, searchKnowledgeIndex, readDocWithShared } from './knowledge/index.js';
+import { backfillKnowledgeIndex, buildGroundingBlock, ingestDocument, searchKnowledgeIndex, readDocWithShared } from './knowledge/index.js';
 // G8 — automation engine + integrations execution layer + delivery targets + canvas.
 import { automationsRouter } from './routes/automations.js';
 import { platformIntegrationsRouter, oauthCallbackRouter } from './routes/platform-integrations.js';
@@ -216,6 +217,23 @@ export function buildApp(config: Config, deps: RuntimeDeps = defaultDeps): Expre
   setKnowledgeGrounding(async ({ orgId, query, agentKind }) =>
     buildGroundingBlock({ orgId, query, kind: agentKind === 'chat' ? 'chat' : 'build' }).block,
   );
+  // F1 knowledge-during-build: the mid-build ingest seam. The orgId rides the run's actor (org
+  // partitioning is structural, not a request argument); ingestDocument refuses the reserved
+  // _shared partition and indexes the doc immediately, so a scoping-provided doc is searchable to
+  // the same run's knowledge tools. sourceType marks it build-originated.
+  setIngestBuildKnowledge(async (actor, doc, deps) =>
+    ingestDocument(
+      actor,
+      {
+        collection: doc.collection,
+        title: doc.title,
+        text: doc.text,
+        sourceType: doc.sourceType ?? 'build-scoping',
+        ...(doc.language ? { language: doc.language } : {}),
+      },
+      deps,
+    ),
+  );
   setVerifyRunner(verifyRunner); // per-build verification (ch07 §7.2.6)
   setBuildMechanics(createBuildMechanics(deps)); // the G6 build pipeline (ch07 §7.2-§7.4)
   // Anonymisation ruleset resolver (ch17 §17.7; F10): every egress request resolves the org's
diff --git a/api/tests/agents/build.test.ts b/api/tests/agents/build.test.ts
index 4d95def..2f9f495 100644
--- a/api/tests/agents/build.test.ts
+++ b/api/tests/agents/build.test.ts
@@ -1,12 +1,13 @@
 import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
 import { sseManager } from '../../src/events/sse-manager.js';
 import { handleBuildCreate, executeBuildJob, type BuildCreateInput } from '../../src/agents/build.js';
-import { registerRun, getRun, liveRunCount } from '../../src/agents/registry.js';
+import { registerRun, liveRunCount } from '../../src/agents/registry.js';
 import { persistJob, type JobRecord } from '../../src/agents/jobs.js';
-import { setBuildMechanics, setVerifyRunner, type BuildMechanics, type VerifyRunResult } from '../../src/agents/seams.js';
+import { setBuildMechanics, setVerifyRunner, setIngestBuildKnowledge, __resetAgentSeamsForTests, type BuildMechanics, type VerifyRunResult, type BuildKnowledgeDoc } from '../../src/agents/seams.js';
+import type { Actor } from '@ekoa/shared';
 import { jobs, userSettings, activityLogs } from '../../src/data/stores.js';
 import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from './_setup.js';
-import type { FakeTransport, FakeTransportScript } from './_fake-transport.js';
+import type { FakeTransport } from './_fake-transport.js';
 
 /**
  * Build jobs (ch05 §5.6.2). Acceptance criteria 1 (409, reservation, aborted-classifier bail),
@@ -225,6 +226,95 @@ describe('build execution (§5.4, §5.6.2)', () => {
   });
 });
 
+describe('F1 knowledge-during-build — scoping narrates a knowledge request and ingests scoping docs', () => {
+  beforeAll(() => bootAgentTestDb('ekoa_build_f1'));
+  afterAll(shutdownAgentTestDb);
+  beforeEach(async () => { await seedUser('u1', 'o1'); });
+  afterEach(async () => { __resetAgentSeamsForTests(); vi.restoreAllMocks(); restoreTransport(); await jobs.deleteMany({}); await userSettings.deleteMany({}); });
+
+  const passVerify = () => setVerifyRunner(async (): Promise<VerifyRunResult> => ({ ran: true, passed: true }));
+  const planSteps = (events: Array<{ stream: string; type: string; data: unknown }>, status: string) =>
+    events.filter((e) => e.stream === 'job' && e.type === 'plan_step' && (e.data as { status?: string }).status === status);
+
+  it('a domain-heavy first build NARRATES a knowledge-scope plan_step (PT-PT, no emoji)', async () => {
+    const t = resetAgentState({ finalText: 'built' });
+    const { events } = startEvents();
+    passVerify();
+    let ingestCalls = 0;
+    setIngestBuildKnowledge(async () => { ingestCalls++; return { id: 'x' }; });
+    const { mech } = fakeMechanics();
+    // "taxas"/"custas" -> financial domain; no knowledgeDocs -> narrate only, no ingest.
+    await execFirstBuild(t, mech, { actor, username: 'u1', sessionId: 's1', description: 'Aplicação para calcular as taxas e custas de um processo', language: 'pt', deps: deps() });
+
+    const scoped = planSteps(events, 'knowledge-scope');
+    expect(scoped).toHaveLength(1);
+    const msg = (scoped[0]!.data as { description?: string }).description ?? '';
+    expect(msg).toContain('área de conhecimento da organização');
+    expect(msg).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u); // no emoji
+    expect(msg).not.toMatch(/[—–]/); // no em/en dash
+    expect(ingestCalls).toBe(0); // nothing to ingest without knowledgeDocs
+    expect(planSteps(events, 'knowledge-indexed')).toHaveLength(0);
+  });
+
+  it('scoping-provided documents are ingested via the seam with the RUN ACTOR org + narrated', async () => {
+    const t = resetAgentState({ finalText: 'built' });
+    const { events } = startEvents();
+    passVerify();
+    const seen: Array<{ actor: Actor; doc: BuildKnowledgeDoc }> = [];
+    setIngestBuildKnowledge(async (a, doc) => { seen.push({ actor: a, doc }); return { id: `kd_${seen.length}` }; });
+    const { mech } = fakeMechanics();
+    await execFirstBuild(t, mech, {
+      actor, username: 'u1', sessionId: 's1', language: 'pt', deps: deps(),
+      description: 'Gestão de apólices de seguro e sinistros',
+      knowledgeDocs: [{ title: 'Manual de subscrição', text: 'regras de subscrição e franquias' }],
+    });
+
+    // the seam saw the build actor's org (org-scoped by construction) + the scoping doc
+    expect(seen).toHaveLength(1);
+    expect(seen[0]!.actor.orgId).toBe('o1');
+    expect(seen[0]!.doc.title).toBe('Manual de subscrição');
+    expect(seen[0]!.doc.sourceType).toBe('build-scoping');
+    // and the build narrated the indexed confirmation
+    const indexed = planSteps(events, 'knowledge-indexed');
+    expect(indexed).toHaveLength(1);
+    expect((indexed[0]!.data as { description?: string }).description).toContain('Foi indexado 1 documento');
+  });
+
+  it('a generic (non-domain-heavy) first build neither narrates nor ingests', async () => {
+    const t = resetAgentState({ finalText: 'built' });
+    const { events } = startEvents();
+    passVerify();
+    let ingestCalls = 0;
+    setIngestBuildKnowledge(async () => { ingestCalls++; return { id: 'x' }; });
+    const { mech } = fakeMechanics();
+    await execFirstBuild(t, mech, {
+      actor, username: 'u1', sessionId: 's1', language: 'pt', deps: deps(),
+      description: 'Cria uma lista de tarefas com um painel de estatísticas',
+      knowledgeDocs: [{ title: 'irrelevante', text: 'nao deve ser indexado' }], // ignored: not domain-heavy
+    });
+    expect(planSteps(events, 'knowledge-scope')).toHaveLength(0);
+    expect(ingestCalls).toBe(0);
+  });
+
+  it('follow-up builds skip knowledge scoping (scoping is a first-build phase)', async () => {
+    resetAgentState({ finalText: 'ok' });
+    const { events } = startEvents();
+    passVerify();
+    let ingestCalls = 0;
+    setIngestBuildKnowledge(async () => { ingestCalls++; return { id: 'x' }; });
+    const fm = fakeMechanics();
+    const jobId = 'job-f1-followup';
+    const abort = new AbortController();
+    registerRun({ id: jobId, ownerUserId: 'u1', orgId: 'o1', kind: 'build', abort, startedAt: 0, artifactId: 'artK', sessionId: 's1' });
+    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', artifactId: 'artK', request: { description: 'x', language: 'pt' }, createdAt: 'x' } as JobRecord);
+    setBuildMechanics(fm.mech);
+    // a domain-heavy description on a FOLLOW-UP must not trigger scoping
+    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'adiciona o cálculo de taxas e custas', language: 'pt', artifactId: 'artK', knowledgeDocs: [{ title: 'x', text: 'y' }], deps: deps() }, abort, { firstBuild: false, artifactId: 'artK' });
+    expect(planSteps(events, 'knowledge-scope')).toHaveLength(0);
+    expect(ingestCalls).toBe(0);
+  });
+});
+
 describe('Registo build lifecycle rows (F3) — a terminal build audits exactly once, metadata-only', () => {
   beforeAll(() => bootAgentTestDb('ekoa_build_registo'));
   afterAll(shutdownAgentTestDb);
diff --git a/api/tests/agents/domain-scoping.test.ts b/api/tests/agents/domain-scoping.test.ts
new file mode 100644
index 0000000..c9c1e8f
--- /dev/null
+++ b/api/tests/agents/domain-scoping.test.ts
@@ -0,0 +1,109 @@
+import { describe, it, expect } from 'vitest';
+import {
+  detectDomainHeavy,
+  knowledgeScopingNarration,
+  knowledgeIndexedNarration,
+} from '../../src/agents/domain-scoping.js';
+
+/**
+ * F1 knowledge-during-build: the deterministic domain-heavy detector + its operator-facing
+ * narration. No model call, no egress - a pure lexical classifier. The detector decides whether a
+ * first build NARRATES a knowledge request; the copy builders produce the PT-PT formal, brand-
+ * neutral, emoji-free / em-dash-free narration streamed on the build's plan_step channel.
+ */
+
+// Emoji + pictographic ranges (enough to catch an accidental UI emoji per the global rule).
+const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
+const EM_DASH_RE = /[\u2014\u2013]/; // em dash / en dash - the copy must use a plain hyphen only
+
+describe('detectDomainHeavy (deterministic, PT + EN)', () => {
+  it('fires on domain-heavy PT requests and names the matched domain(s)', () => {
+    const legal = detectDomainHeavy('Aplicação para gerir peças de um processo judicial e prazos de recurso');
+    expect(legal.domainHeavy).toBe(true);
+    expect(legal.domains).toContain('juridico');
+
+    const fees = detectDomainHeavy('Uma aplicação para calcular as taxas e custas de um processo');
+    expect(fees.domainHeavy).toBe(true);
+    // "taxas"/"custas" are financial; "processo" alone is NOT legal (only "processo judicial" is)
+    expect(fees.domains).toContain('financeiro');
+
+    const health = detectDomainHeavy('Prontuário clínico para o registo de pacientes e diagnósticos');
+    expect(health.domainHeavy).toBe(true);
+    expect(health.domains).toContain('saude');
+
+    const insurance = detectDomainHeavy('Gestão de apólices de seguro e participação de sinistros');
+    expect(insurance.domainHeavy).toBe(true);
+    expect(insurance.domains).toContain('seguros');
+  });
+
+  it('fires on domain-heavy EN requests', () => {
+    expect(detectDomainHeavy('An app to calculate court fees for a lawsuit').domainHeavy).toBe(true);
+    expect(detectDomainHeavy('An app to calculate court fees for a lawsuit').domains).toEqual(
+      expect.arrayContaining(['juridico', 'financeiro']),
+    );
+    expect(detectDomainHeavy('A tool to manage insurance claims and underwriting').domains).toContain('seguros');
+    expect(detectDomainHeavy('Invoicing and VAT accounting workspace').domains).toContain('financeiro');
+    expect(detectDomainHeavy('A GDPR compliance register for the organisation').domains).toContain('conformidade');
+  });
+
+  it('stays silent on generic apps (PT + EN), avoiding substring false positives', () => {
+    for (const generic of [
+      'build a crm',
+      'build a dashboard for sales',
+      'cria uma lista de tarefas',
+      'loja online de t-shirts',
+      'build a syntax highlighter', // must NOT fire on "syntax" (contains "tax")
+      'a taxonomy browser for animals', // must NOT fire on "taxonomy"
+      'personal budget tracker', // "budget" is deliberately not a keyword
+      'um blog pessoal com comentários',
+    ]) {
+      const r = detectDomainHeavy(generic);
+      expect(r.domainHeavy, `"${generic}" must not be domain-heavy`).toBe(false);
+      expect(r.domains).toEqual([]);
+    }
+  });
+
+  it('is accent-insensitive and tolerant of empty input', () => {
+    expect(detectDomainHeavy('APOLICE de SEGURO').domainHeavy).toBe(true);
+    expect(detectDomainHeavy('').domainHeavy).toBe(false);
+  });
+});
+
+describe('knowledgeScopingNarration (PT-PT, formal, brand-neutral)', () => {
+  it('names the area, points at the org knowledge area, and stays within the copy rules', () => {
+    const msg = knowledgeScopingNarration(['financeiro']);
+    expect(msg).toContain('financeira');
+    expect(msg).toContain('área de conhecimento da organização');
+    expect(msg).toContain('Pode carregar'); // formal register (voce), not tuteio
+    expect(msg).not.toContain('podes'); // no tuteio
+    expect(msg).not.toMatch(EMOJI_RE);
+    expect(msg).not.toMatch(EM_DASH_RE);
+    expect(msg.toLowerCase()).not.toContain('ekoa'); // brand-neutral
+  });
+
+  it('lists multiple domains with a PT conjunction', () => {
+    const msg = knowledgeScopingNarration(['juridico', 'financeiro']);
+    expect(msg).toContain('jurídica e financeira');
+    expect(msg).not.toMatch(EMOJI_RE);
+    expect(msg).not.toMatch(EM_DASH_RE);
+  });
+});
+
+describe('knowledgeIndexedNarration (PT-PT confirmation)', () => {
+  it('agrees in number for one vs many documents and stays within the copy rules', () => {
+    const one = knowledgeIndexedNarration(1);
+    expect(one).toContain('Foi indexado 1 documento');
+    expect(one).toContain('já está disponível');
+
+    const many = knowledgeIndexedNarration(3);
+    expect(many).toContain('Foram indexados 3 documentos');
+    expect(many).toContain('já estão disponíveis');
+
+    for (const msg of [one, many]) {
+      expect(msg).toContain('área de conhecimento da organização');
+      expect(msg).not.toMatch(EMOJI_RE);
+      expect(msg).not.toMatch(EM_DASH_RE);
+      expect(msg.toLowerCase()).not.toContain('ekoa');
+    }
+  });
+});
diff --git a/api/tests/knowledge/build-knowledge-ingest.test.ts b/api/tests/knowledge/build-knowledge-ingest.test.ts
new file mode 100644
index 0000000..f4bff67
--- /dev/null
+++ b/api/tests/knowledge/build-knowledge-ingest.test.ts
@@ -0,0 +1,111 @@
+import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
+import { mkdtemp, rm } from 'node:fs/promises';
+import { tmpdir } from 'node:os';
+import { join } from 'node:path';
+import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
+import { connectMongo, closeMongo } from '../../src/data/mongo.js';
+import type { Actor } from '@ekoa/shared';
+import { ingestDocument, listDocuments, KnowledgeError } from '../../src/knowledge/service.js';
+import { search, closeIndex } from '../../src/knowledge/index-store.js';
+import { SHARED_ORG_ID } from '../../src/knowledge/paths.js';
+import {
+  ingestBuildKnowledge,
+  setIngestBuildKnowledge,
+  __resetAgentSeamsForTests,
+} from '../../src/agents/seams.js';
+
+/**
+ * F1 knowledge-during-build: the mid-build ingest seam (agents/seams.ts `ingestBuildKnowledge`),
+ * wired exactly as the composition root wires it (server.ts) - forwarding to the knowledge
+ * service's `ingestDocument` with a `build-scoping` sourceType default. Proves the load-bearing
+ * invariants at the seam: the doc lands in the RUN ACTOR's org partition, is searchable
+ * IMMEDIATELY (no rebuild/optimize), never crosses into another org, and the reserved `_shared`
+ * partition is refused (the service's assertNotSharedActor - no new permission logic here).
+ */
+let mem: MongoMemoryServer;
+let dir: string;
+let n = 0;
+const deps = { now: () => 1_700_000_000_000 + n, genId: () => `d${n++}` };
+const actor = (orgId: string): Actor => ({ userId: `u-${orgId}`, orgId, role: 'builder' });
+
+// The production binding (server.ts): forward to ingestDocument, default sourceType 'build-scoping'.
+const bindLikeServer = (): void =>
+  setIngestBuildKnowledge(async (a, doc, d) =>
+    ingestDocument(
+      a,
+      {
+        collection: doc.collection,
+        title: doc.title,
+        text: doc.text,
+        sourceType: doc.sourceType ?? 'build-scoping',
+        ...(doc.language ? { language: doc.language } : {}),
+      },
+      d,
+    ),
+  );
+
+beforeAll(async () => {
+  mem = await createMem();
+  await connectMongo(mem.getUri(), 'ekoa_build_knowledge_ingest');
+}, 60_000);
+afterAll(async () => {
+  await closeMongo();
+  await mem.stop();
+});
+beforeEach(async () => {
+  dir = await mkdtemp(join(tmpdir(), 'ekoa-build-ingest-'));
+  process.env.EKOA_DATA_DIR = dir;
+  bindLikeServer();
+});
+afterEach(async () => {
+  __resetAgentSeamsForTests();
+  closeIndex();
+  delete process.env.EKOA_DATA_DIR;
+  await rm(dir, { recursive: true, force: true });
+});
+
+describe('ingestBuildKnowledge seam (mid-build ingest)', () => {
+  it('ingests into the run actor org and the doc is IMMEDIATELY searchable', async () => {
+    const { id } = await ingestBuildKnowledge(
+      actor('orgA'),
+      { collection: 'uploads', title: 'Tabela de custas 2026', text: 'taxa de justiça e custas do processo' },
+      deps,
+    );
+    expect(id).toBeTruthy();
+    // searchable in the same call - no reindex/backfill/optimize between ingest and search
+    expect(search('orgA', 'custas', 5).map((h) => h.docId)).toContain(id);
+    // sourceType marks it build-originated (default at the binding)
+    const listed = await listDocuments(actor('orgA'), {});
+    expect(listed.items.find((d) => d.id === id)?.sourceType).toBe('build-scoping');
+  });
+
+  it('is org-scoped: a second org never sees the doc (partition holds)', async () => {
+    const { id } = await ingestBuildKnowledge(
+      actor('orgA'),
+      { collection: 'uploads', title: 'Só orgA', text: 'penhora de bens do executado' },
+      deps,
+    );
+    expect(search('orgA', 'penhora', 5).map((h) => h.docId)).toContain(id);
+    expect(search('orgB', 'penhora', 5)).toHaveLength(0); // orgB partition is empty
+  });
+
+  it('refuses the reserved _shared partition (FORBIDDEN 403 via the service guard)', async () => {
+    await expect(
+      ingestBuildKnowledge(actor(SHARED_ORG_ID), { collection: 'c', title: 'T', text: 'x' }, deps),
+    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
+    await expect(
+      ingestBuildKnowledge(actor(SHARED_ORG_ID), { collection: 'c', title: 'T', text: 'x' }, deps),
+    ).rejects.toBeInstanceOf(KnowledgeError);
+  });
+
+  it('honest default (unwired root): ingests nothing and returns an empty id', async () => {
+    __resetAgentSeamsForTests(); // drop the server-like binding
+    const { id } = await ingestBuildKnowledge(
+      actor('orgA'),
+      { collection: 'uploads', title: 'T', text: 'prazo de recurso' },
+      deps,
+    );
+    expect(id).toBe('');
+    expect(search('orgA', 'prazo', 5)).toHaveLength(0); // nothing persisted
+  });
+});

 succeeded in 735ms:
## Exploration: executeBuildJob detectDomainHeavy knowledgeScopingNarration knowledgeIndexedNarration ingestBuildKnowledge BuildCreateInput

Found 206 symbols across 56 files.

### Blast radius — what depends on these (update/verify before editing)

- `knowledgeIndexedNarration` (api/src/agents/domain-scoping.ts:172) — 3 callers in `api/src/agents/build.ts`; tests: `api/tests/agents/domain-scoping.test.ts`
- `executeBuildJob` (api/src/agents/build.ts:253) — 4 callers in `api/src/agents/build.ts`; tests: `api/tests/agents/build.test.ts`
- `ingestBuildKnowledge` (api/src/agents/seams.ts:95) — 3 callers in `api/src/agents/build.ts`; tests: `api/tests/knowledge/build-knowledge-ingest.test.ts`
- `BuildCreateInput` (api/src/agents/build.ts:59) — 7 callers in `api/src/agents/build.ts`; tests: `api/tests/agents/build.test.ts`
- `Scope` (api/src/data/collections-engine.ts:65) — 10 callers in `api/src/apps/app-data-access.ts`, `api/src/data/collections-engine.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- executeBuildJob → knowledgeIndexedNarration
- ingestBuildKnowledge → ingestBuildKnowledgeFn
- executeBuildJob → ingestBuildKnowledge
- detectDomainHeavy → fold
- detectDomainHeavy → tokens
- detectDomainHeavy → map
- knowledgeScopingNarration → domainLabels
- executeBuildJob → knowledgeScopingNarration
- resolveMemoryInjection → map
- delegateToolSpec → map
- ... and 193 more

**references:**
- BuildCreateInput → Actor
- scopeFor → Scope
- docId → Scope
- list → Scope
- get → Scope
- create → Scope
- IngestBuildKnowledgeFn → Actor
- executeBuildJob → onTimeout
- auditBuild → BuildCreateInput
- handleBuildCreate → BuildCreateInput
- ... and 127 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/agents/build.ts — imports(imports), Actor(imports), loadAgentsConfig(imports), checkAllowance(imports), runAgent(imports), decideForTask(imports), runPostRunExtraction(imports), getRun(imports), removeRun(imports), finalizeOnce(imports), +25 more

```typescript
7	 * (step 5, ch07 §7.2.6), the provider-error reroute (§5.3.7), the dual-fire guard (§5.3.4), and
8	 * the P-10 persistence + in-process zombie net.
9	 */
10	import type { Actor } from '@ekoa/shared';
11	import { loadAgentsConfig } from '../config.js';
12	import { checkAllowance } from '../billing/index.js';
13	import { BILLING_PAGE_URL } from '../billing/constants.js';
14	import { runAgent, decideForTask, LlmAbortedError } from '../llm/index.js';
15	import { runPostRunExtraction } from '../memory/index.js';
16	import { userSettings } from '../data/stores.js';
17	import {
18	  registerRun,
19	  getRun,
20	  removeRun,
21	  finalizeOnce,
22	  hasLiveJobForArtifact,
23	  reserveFirstBuild,
24	  bindReservation,
25	  releaseReservation,
26	} from './registry.js';
27	import { JobStreamSink, emitIntegrationBuildIntent, emitChatAnswer } from './streaming.js';
28	import { MarkerProcessor, scanProviderError } from './markers.js';
29	import { StreamingIdentityRedactor } from './branding.js';
30	import { toolPolicyFor } from './tools.js';
31	import { knowledgeToolSpecs, loadContextToolSpec, delegateToolSpec } from './sdk-tools.js';
32	import { classifyInBuildIntent } from './guided-build.js';
33	import {
34	  persistJob,
35	  patchJob,
36	  getJob,
37	  jobView,
38	  nonTerminalJobForArtifact,
39	  resetArtifactToDraft,
40	  type JobRecord,
41	} from './jobs.js';
42	import { assembleAgentContext, getBuildMechanics, knowledgeGrounding, ingestBuildKnowledge, verifyRunner } from './seams.js';
43	import { detectDomainHeavy, knowledgeScopingNarration, knowledgeIndexedNarration } from './domain-scoping.js';
44	import { logActivity } from '../data/activity.js';
45	
46	/** Registo (F3): build lifecycle rows, metadata-only (ids/codes — NEVER the request description
47	 *  or any prompt text). The single audit write path (FIXED-8); best-effort so bookkeeping never
48	 *  fails a build. `type` is created | completed | failed | cancelled. */
49	function auditBuild(input: BuildCreateInput, type: string, metadata: Record<string, unknown>): void {
50	  void logActivity(
51	    { userId: input.actor.userId, username: input.username, orgId: input.actor.orgId },
52	    'build',
53	    type,
54	    input.deps,
55	    metadata,
56	  ).catch(() => undefined);
57	}
58	
59	export interface BuildCreateInput {
60	  actor: Actor;
61	  username: string;
62	  sessionId: string;
63	  description: string;
64	  language: string;
65	  templateId?: string;
66	  integrationKeys?: string[];
67	  artifactId?: string;
68	  attachments?: unknown[];
69	  fieldValues?: Record<string, unknown>;
70	  configValues?: Record<string, unknown>;
71	  /** F1 knowledge-during-build: scoping-provided reference documents to ingest into the org
72	   *  knowledge area DURING a domain-heavy first build (org-scoped by the run's actor, immediately
73	   *  searchable to the run's knowledge tools). Additive + optional; populated by the scoping UI +
74	   *  jobs route in a later slice, exercised directly by the build tests here. */
75	  knowledgeDocs?: Array<{ title: string; text: string; collection?: string }>;
76	  deps: { now: () => number; genId: () => string };
77	}
78	
79	export type BuildCreateResult =
80	  | { status: 'created'; job: ReturnType<typeof jobView>; fire: () => void }
```

#### api/src/agents/domain-scoping.ts — knowledgeIndexedNarration(function), detectDomainHeavy(function), knowledgeScopingNarration(function), fold(function), tokens(function), domainLabels(function), matchesKeyword(function), DomainScopingResult(interface)

```typescript
1	/**
2	 * Knowledge-during-build scoping (F1). A DETERMINISTIC, no-model-call detector the first-build
3	 * scoping phase runs over the build request to decide whether the app looks domain-heavy - i.e.
4	 * it leans on specialised, org-held knowledge (legal rules, fee/tax schedules, clinical protocols,
5	 * insurance policies, regulatory obligations, property terms). When it fires, the build NARRATES
6	 * a knowledge request in the job stream (upload reference documents to the org knowledge area) and,
7	 * when the request carried scoping-provided documents, ingests them into the org knowledge area for
8	 * that run (agents/build.ts). The build never blocks on or fails for knowledge scoping.
9	 *
10	 * This detector is intentionally SEPARATE from knowledge/grounding.ts `isLegalContext`: that one
11	 * gates whether a build proactively GROUNDS the legal spine; this one gates whether the build
12	 * NARRATES a knowledge request across several domains. Keeping them decoupled avoids agents/
13	 * reaching into knowledge/ for a keyword list and lets each evolve on its own concern. No model
14	 * call, no egress - a pure lexical classifier (CLAUDE.md FIXED-4: platform logic is design-time TS).
15	 */
16	
17	/** Fold to a lowercase, accent-stripped form for keyword matching (mirrors grounding.ts `fold`). */
18	function fold(s: string): string {
19	  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
20	}
21	
22	/** Word tokens of the folded text (letters + digits), used for stem/exact matching. */
23	function tokens(folded: string): string[] {
24	  return folded.match(/[a-z0-9]+/g) ?? [];
25	}
26	
27	/**
28	 * A keyword matches when:
29	 *  - multi-word phrase  -> substring of the folded text ("processo judicial");
30	 *  - short token (<= 3) -> an EXACT token match ("iva", "vat", "kyc") - never a substring, so
31	 *    "vat" does not fire on "vatican" and "fee" does not fire on "feed";
32	 *  - stem (>= 4)        -> a token that equals or STARTS WITH it ("taxa" -> "taxas",
33	 *    "apolice" -> "apolices"), so Portuguese plurals/inflections match without a stemmer.
34	 * The stem rule is deliberately prefix-only (not substring) so "tax"-like fragments never fire on
35	 * unrelated words; bare "tax" is not a keyword for exactly that reason (see FINANCEIRO below).
36	 */
37	function matchesKeyword(folded: string, toks: string[], kw: string): boolean {
38	  if (kw.includes(' ')) return folded.includes(kw);
39	  if (kw.length <= 3) return toks.includes(kw);
40	  return toks.some((t) => t === kw || t.startsWith(kw));
41	}
42	
43	/** A knowledge domain: an internal key, its PT-PT label for narration, and its PT+EN keyword set. */
44	interface KnowledgeDomain {
45	  key: string;
46	  /** PT-PT label used in the operator-facing narration (formal register, brand-neutral). */
47	  label: string;
48	  keywords: string[];
49	}
50	
51	/**
52	 * The domain keyword sets (PT + EN, accent-insensitive). Curated to fire on apps that clearly lean
53	 * on specialised org knowledge and to stay silent on generic apps (CRM, dashboards, to-do lists,
54	 * shops, blogs). Deliberately conservative: terms that also occur in generic apps are left out
55	 * (e.g. "orcamento"/"budget", bare "payment", bare "policy", bare "tax") to avoid false positives.
56	 */
57	const DOMAINS: KnowledgeDomain[] = [
58	  {
59	    key: 'juridico',
60	    label: 'jurídica',
61	    keywords: [
62	      // PT
63	      'tribunal', 'acordao', 'jurisprudencia', 'advogado', 'advocacia', 'juridic', 'peticao',
64	      'penhora', 'sentenca', 'citacao', 'clausula', 'contrato', 'litigio', 'processo judicial',
65	      'diligencia', 'contestacao', 'escritura', 'notario',
66	      // EN
67	      'lawsuit', 'litigation', 'court', 'attorney', 'plaintiff', 'defendant', 'statute',
68	      'jurisdiction', 'case law', 'legal case',
69	    ],
70	  },
71	  {
72	    key: 'financeiro',
73	    label: 'financeira',
74	    keywords: [
75	      // PT - fees/tax/accounting (NOT "orcamento"/budget, which is common in generic apps)
76	      'taxa', 'taxas', 'custas', 'honorarios', 'juros', 'imposto', 'iva', 'fatura', 'faturacao',
77	      'contabil', 'contabilidade', 'tesouraria', 'tarifario', 'fiscal',
78	      // EN - "tax" is omitted on purpose ("syntax"/"taxonomy"); the specific forms below are safe
79	      'fee', 'fees', 'invoice', 'invoicing', 'vat', 'accounting', 'tariff', 'levy',
80	    ],
81	  },
82	  {
83	    key: 'saude',
84	    label: 'clínica',
85	    keywords: [
86	      // PT
87	      'clinic', 'clinico', 'paciente', 'doente', 'diagnostico', 'prescricao', 'medicamento',
88	      'sintoma', 'terapeutica',
89	      // EN
90	      'patient', 'clinical', 'diagnosis', 'prescription', 'dosage', 'healthcare',
91	    ],
92	  },
93	  {
94	    key: 'seguros',
95	    label: 'seguros',
96	    keywords: [
97	      // PT
98	      'seguro', 'apolice', 'sinistro', 'resseguro', 'segurado',
99	      // EN
100	      'insurance', 'underwriting', 'actuarial', 'insurance claim', 'insurance policy',
101	    ],
102	  },
103	  {
104	    key: 'conformidade',
105	    label: 'de conformidade regulamentar',
106	    keywords: [
107	      // PT
108	      'rgpd', 'conformidade', 'regulament', 'branqueamento de capitais',
109	      // EN
110	      'gdpr', 'compliance', 'regulatory', 'statutory', 'hipaa', 'kyc', 'aml',
111	    ],
112	  },
113	  {
114	    key: 'imobiliario',
115	    label: 'imobiliária',
116	    keywords: [
117	      // PT
118	      'imovel', 'imoveis', 'arrendamento', 'senhorio', 'inquilino', 'imobiliaria', 'hipoteca',
119	      // EN
120	      'real estate', 'property lease', 'landlord', 'tenant', 'mortgage',
121	    ],
122	  },
123	];
124	
125	export interface DomainScopingResult {
126	  domainHeavy: boolean;
127	  /** The internal keys of the matched domains, in DOMAINS order (stable). */
128	  domains: string[];
129	}
130	
131	/**
132	 * Detect whether a build request looks domain-heavy. Deterministic (no model call): it folds the
133	 * text, tokenises it, and matches the curated per-domain keyword sets. Returns every matched
134	 * domain key so the narration can name the area(s).
135	 */
136	export function detectDomainHeavy(text: string): DomainScopingResult {
137	  const folded = fold(text ?? '');
138	  const toks = tokens(folded);
139	  const domains = DOMAINS.filter((d) => d.keywords.some((kw) => matchesKeyword(folded, toks, kw))).map((d) => d.key);
140	  return { domainHeavy: domains.length > 0, domains };
141	}
142	
143	/** PT-PT label list for the matched domain keys ("jurídica e financeira"). Unknown keys ignored. */
144	function domainLabels(domainKeys: string[]): string {
145	  const labels = domainKeys
146	    .map((k) => DOMAINS.find((d) => d.key === k)?.label)
147	    .filter((l): l is string => Boolean(l));
148	  if (labels.length === 0) return 'especializada';
149	  if (labels.length === 1) return labels[0]!;
150	  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`;
151	}
152	
153	/**
154	 * The operator-facing knowledge request narrated in the build stream when the app looks
155	 * domain-heavy. PT-PT, formal register (voce - "pode carregar", never tuteio), brand-neutral,
156	 * no emoji, no em-dash. Tells the operator WHERE the domain knowledge lives (the org knowledge
157	 * area) and that documents added there are used in this build. The build does not block on it.
158	 */
159	export function knowledgeScopingNarration(domainKeys: string[]): string {
160	  const area = domainLabels(domainKeys);
161	  return (
162	    `Esta aplicação parece assentar em conhecimento especializado (área ${area}). ` +
163	    'Pode carregar documentos de referência para a área de conhecimento da organização; ' +
164	    'assim que estiverem disponíveis, são tidos em conta nesta construção.'
165	  );
166	}
167	
168	/**
169	 * Confirmation narrated after scoping-provided documents are indexed into the org knowledge area
170	 * during the build. Same register/constraints as {@link knowledgeScopingNarration}.
171	 */
172	export function knowledgeIndexedNarration(count: number): string {
173	  const verb = count === 1 ? 'Foi indexado' : 'Foram indexados';
174	  const noun = count === 1 ? 'documento' : 'documentos';
175	  const avail = count === 1 ? 'já está disponível' : 'já estão disponíveis';
176	  return `${verb} ${count} ${noun} na área de conhecimento da organização; ${avail} para esta construção.`;
177	}
```

#### api/src/agents/seams.ts — references(references), calls(calls), Actor(references), BuildKnowledgeDoc(references), IngestBuildKnowledgeFn(references), knowledgeGrounding(function), BuildKnowledgeDoc(interface), IngestBuildKnowledgeFn(type_alias), ingestBuildKnowledgeFn(variable), setIngestBuildKnowledge(function), +4 more

```typescript
58	export function setKnowledgeGrounding(fn: KnowledgeGroundingFn): void {
59	  knowledgeGroundingFn = fn;
60	}
61	export function knowledgeGrounding(input: KnowledgeGroundingInput): Promise<string> {
62	  return knowledgeGroundingFn(input);
63	}
64	
65	// --- Mid-build knowledge ingest (F1 knowledge-during-build) -------------------------------
66	
67	/** A scoping-provided document the build persists into the org knowledge area DURING a run. */
68	export interface BuildKnowledgeDoc {
69	  collection: string;
70	  title: string;
71	  text: string;
72	  /** Marks the doc as build-originated (default at the binding: `build-scoping`). */
73	  sourceType?: string;
74	  language?: string;
75	}
76	
77	/**
78	 * Persist a scoping-provided document into the org knowledge area during a build. The orgId rides
79	 * the run's actor (org-scoped BY CONSTRUCTION - never a tool/request argument), and the real
80	 * binding forwards to the knowledge service's `ingestDocument`, which refuses the reserved
81	 * `_shared` partition (assertNotSharedActor) and indexes the doc immediately (searchable to the
82	 * run's knowledge tools with no rebuild/optimize). Honest default: an unwired root ingests nothing
83	 * and returns an empty id, so the build narrates no false "indexed" confirmation.
84	 */
85	export type IngestBuildKnowledgeFn = (
86	  actor: Actor,
87	  doc: BuildKnowledgeDoc,
88	  deps: { now: () => number; genId: () => string },
89	) => Promise<{ id: string }>;
90	const defaultIngestBuildKnowledge: IngestBuildKnowledgeFn = async () => ({ id: '' });
91	let ingestBuildKnowledgeFn: IngestBuildKnowledgeFn = defaultIngestBuildKnowledge;
92	export function setIngestBuildKnowledge(fn: IngestBuildKnowledgeFn): void {
93	  ingestBuildKnowledgeFn = fn;
94	}
95	export function ingestBuildKnowledge(
96	  actor: Actor,
97	  doc: BuildKnowledgeDoc,
98	  deps: { now: () => number; genId: () => string },
99	): Promise<{ id: string }> {
100	  return ingestBuildKnowledgeFn(actor, doc, deps);
101	}
102	
103	// --- In-process MCP knowledge tools (ch05 §5.4.4) -----------------------------------------
104	

... (gap) ...

282	export function setVerifyRunner(fn: VerifyRunnerFn): void {
283	  verifyRunnerFn = fn;
284	}
285	export function verifyRunner(input: VerifyRunInput): Promise<VerifyRunResult> {
286	  return verifyRunnerFn(input);
287	}
288	
289	// --- Build mechanics (ch07 §7.2; the apps/ build pipeline, wired at the root) -------------
290	

... (gap) ...

369	export function setBuildMechanics(fn: BuildMechanics): void {
370	  buildMechanics = fn;
371	}
372	export function getBuildMechanics(): BuildMechanics {
373	  return buildMechanics;
374	}
375	
376	/** Reset every seam to its default (tests). */
377	export function __resetAgentSeamsForTests(): void {
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc 'codegraph node api/src/agents/build.ts' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "rg -n \"knowledgeDocs|firstBuild|executeBuildJob\\(|setIngestBuildKnowledge|ingestBuildKnowledge|detectDomainHeavy|@anthropic-ai|knowledge/index|knowledge/service\" api/src api/tests shared/src" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
api/tests/knowledge/index-store.test.ts:9:} from '../../src/knowledge/index-store.js';
shared/src/knowledge.ts:238:    path: '/api/v1/knowledge/index-status',
api/tests/knowledge/grounding.test.ts:5:import { indexDoc, closeIndex } from '../../src/knowledge/index-store.js';
api/tests/knowledge/build-knowledge-ingest.test.ts:8:import { ingestDocument, listDocuments, KnowledgeError } from '../../src/knowledge/service.js';
api/tests/knowledge/build-knowledge-ingest.test.ts:9:import { search, closeIndex } from '../../src/knowledge/index-store.js';
api/tests/knowledge/build-knowledge-ingest.test.ts:12:  ingestBuildKnowledge,
api/tests/knowledge/build-knowledge-ingest.test.ts:13:  setIngestBuildKnowledge,
api/tests/knowledge/build-knowledge-ingest.test.ts:18: * F1 knowledge-during-build: the mid-build ingest seam (agents/seams.ts `ingestBuildKnowledge`),
api/tests/knowledge/build-knowledge-ingest.test.ts:33:  setIngestBuildKnowledge(async (a, doc, d) =>
api/tests/knowledge/build-knowledge-ingest.test.ts:67:describe('ingestBuildKnowledge seam (mid-build ingest)', () => {
api/tests/knowledge/build-knowledge-ingest.test.ts:69:    const { id } = await ingestBuildKnowledge(
api/tests/knowledge/build-knowledge-ingest.test.ts:83:    const { id } = await ingestBuildKnowledge(
api/tests/knowledge/build-knowledge-ingest.test.ts:94:      ingestBuildKnowledge(actor(SHARED_ORG_ID), { collection: 'c', title: 'T', text: 'x' }, deps),
api/tests/knowledge/build-knowledge-ingest.test.ts:97:      ingestBuildKnowledge(actor(SHARED_ORG_ID), { collection: 'c', title: 'T', text: 'x' }, deps),
api/tests/knowledge/build-knowledge-ingest.test.ts:103:    const { id } = await ingestBuildKnowledge(
api/tests/knowledge/importer.test.ts:9:import { search, closeIndex } from '../../src/knowledge/index-store.js';
api/tests/agents/domain-scoping.test.ts:3:  detectDomainHeavy,
api/tests/agents/domain-scoping.test.ts:19:describe('detectDomainHeavy (deterministic, PT + EN)', () => {
api/tests/agents/domain-scoping.test.ts:21:    const legal = detectDomainHeavy('Aplicação para gerir peças de um processo judicial e prazos de recurso');
api/tests/agents/domain-scoping.test.ts:25:    const fees = detectDomainHeavy('Uma aplicação para calcular as taxas e custas de um processo');
api/tests/agents/domain-scoping.test.ts:30:    const health = detectDomainHeavy('Prontuário clínico para o registo de pacientes e diagnósticos');
api/tests/agents/domain-scoping.test.ts:34:    const insurance = detectDomainHeavy('Gestão de apólices de seguro e participação de sinistros');
api/tests/agents/domain-scoping.test.ts:40:    expect(detectDomainHeavy('An app to calculate court fees for a lawsuit').domainHeavy).toBe(true);
api/tests/agents/domain-scoping.test.ts:41:    expect(detectDomainHeavy('An app to calculate court fees for a lawsuit').domains).toEqual(
api/tests/agents/domain-scoping.test.ts:44:    expect(detectDomainHeavy('A tool to manage insurance claims and underwriting').domains).toContain('seguros');
api/tests/agents/domain-scoping.test.ts:45:    expect(detectDomainHeavy('Invoicing and VAT accounting workspace').domains).toContain('financeiro');
api/tests/agents/domain-scoping.test.ts:46:    expect(detectDomainHeavy('A GDPR compliance register for the organisation').domains).toContain('conformidade');
api/tests/agents/domain-scoping.test.ts:60:      const r = detectDomainHeavy(generic);
api/tests/agents/domain-scoping.test.ts:67:    expect(detectDomainHeavy('APOLICE de SEGURO').domainHeavy).toBe(true);
api/tests/agents/domain-scoping.test.ts:68:    expect(detectDomainHeavy('').domainHeavy).toBe(false);
api/tests/knowledge/service.test.ts:12:} from '../../src/knowledge/service.js';
api/tests/knowledge/service.test.ts:13:import { search, closeIndex } from '../../src/knowledge/index-store.js';
api/tests/agents/build.test.ts:6:import { setBuildMechanics, setVerifyRunner, setIngestBuildKnowledge, __resetAgentSeamsForTests, type BuildMechanics, type VerifyRunResult, type BuildKnowledgeDoc } from '../../src/agents/seams.js';
api/tests/agents/build.test.ts:50:  await executeBuildJob(jobId, input, abort, { firstBuild: true });
api/tests/agents/build.test.ts:106:    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'x', language: 'pt', deps: deps() }, abort, { firstBuild: true });
api/tests/agents/build.test.ts:140:    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'change', language: 'pt', artifactId: 'artF', deps: deps() }, abort, { firstBuild: false, artifactId: 'artF' });
api/tests/agents/build.test.ts:152:    await executeBuildJob(jobId2, { actor, username: 'u1', sessionId: 's1', description: 'change', language: 'pt', artifactId: 'artF2', deps: deps() }, abort2, { firstBuild: false, artifactId: 'artF2' });
api/tests/agents/build.test.ts:244:    setIngestBuildKnowledge(async () => { ingestCalls++; return { id: 'x' }; });
api/tests/agents/build.test.ts:246:    // "taxas"/"custas" -> financial domain; no knowledgeDocs -> narrate only, no ingest.
api/tests/agents/build.test.ts:255:    expect(ingestCalls).toBe(0); // nothing to ingest without knowledgeDocs
api/tests/agents/build.test.ts:264:    setIngestBuildKnowledge(async (a, doc) => { seen.push({ actor: a, doc }); return { id: `kd_${seen.length}` }; });
api/tests/agents/build.test.ts:269:      knowledgeDocs: [{ title: 'Manual de subscrição', text: 'regras de subscrição e franquias' }],
api/tests/agents/build.test.ts:288:    setIngestBuildKnowledge(async () => { ingestCalls++; return { id: 'x' }; });
api/tests/agents/build.test.ts:293:      knowledgeDocs: [{ title: 'irrelevante', text: 'nao deve ser indexado' }], // ignored: not domain-heavy
api/tests/agents/build.test.ts:304:    setIngestBuildKnowledge(async () => { ingestCalls++; return { id: 'x' }; });
api/tests/agents/build.test.ts:312:    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'adiciona o cálculo de taxas e custas', language: 'pt', artifactId: 'artK', knowledgeDocs: [{ title: 'x', text: 'y' }], deps: deps() }, abort, { firstBuild: false, artifactId: 'artK' });
api/tests/apps/app-assistant.test.ts:3:import type { SearchHit } from '../../src/knowledge/index.js';
api/src/knowledge/paths.ts:8: *   <dataDir>/knowledge/index/fts.db                            (derived FTS5 index, regenerable)
api/src/knowledge/index.ts:15:  // The mid-build ingest path (F1): server.ts binds this to the agents/ ingestBuildKnowledge seam
api/src/agents/build.ts:42:import { assembleAgentContext, getBuildMechanics, knowledgeGrounding, ingestBuildKnowledge, verifyRunner } from './seams.js';
api/src/agents/build.ts:43:import { detectDomainHeavy, knowledgeScopingNarration, knowledgeIndexedNarration } from './domain-scoping.js';
api/src/agents/build.ts:75:  knowledgeDocs?: Array<{ title: string; text: string; collection?: string }>;
api/src/agents/build.ts:147:    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: true }),
api/src/agents/build.ts:217:    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: false, artifactId }),
api/src/agents/build.ts:224:  firstBuild: boolean;
api/src/agents/build.ts:253:export async function executeBuildJob(jobId: string, input: BuildCreateInput, abort: AbortController, opts: ExecOpts): Promise<void> {
api/src/agents/build.ts:311:    if (opts.firstBuild) {
api/src/agents/build.ts:341:    sink.routing(decision.tier, opts.firstBuild ? 'first build' : 'follow-up build');
api/src/agents/build.ts:342:    await patchJob(jobId, { routing: { tier: decision.tier, reason: opts.firstBuild ? 'first build' : 'follow-up build' } });
api/src/agents/build.ts:352:    if (opts.firstBuild) {
api/src/agents/build.ts:354:        const scope = detectDomainHeavy(input.description);
api/src/agents/build.ts:358:          for (const doc of input.knowledgeDocs ?? []) {
api/src/agents/build.ts:359:            const { id } = await ingestBuildKnowledge(
api/src/agents/build.ts:508:        depth: opts.firstBuild ? 'full' : 'scoped',
api/src/agents/domain-scoping.ts:136:export function detectDomainHeavy(text: string): DomainScopingResult {
api/src/llm/index.ts:4: * this surface; nothing else imports @anthropic-ai/* or references the provider host.
api/src/agents/seams.ts:91:let ingestBuildKnowledgeFn: IngestBuildKnowledgeFn = defaultIngestBuildKnowledge;
api/src/agents/seams.ts:92:export function setIngestBuildKnowledge(fn: IngestBuildKnowledgeFn): void {
api/src/agents/seams.ts:93:  ingestBuildKnowledgeFn = fn;
api/src/agents/seams.ts:95:export function ingestBuildKnowledge(
api/src/agents/seams.ts:100:  return ingestBuildKnowledgeFn(actor, doc, deps);
api/src/agents/seams.ts:380:  ingestBuildKnowledgeFn = defaultIngestBuildKnowledge;
api/src/agents/index.ts:23:  setIngestBuildKnowledge,
api/src/agents/registry.ts:173:  reservations.set(sessionId, { jobId: '', expiresAt: now + loadAgentsConfig().firstBuildReservationTtlMs });
api/src/routes/knowledge.ts:14:} from '../knowledge/service.js';
api/src/server.ts:81:  setIngestBuildKnowledge,
api/src/server.ts:94:import { backfillKnowledgeIndex, buildGroundingBlock, ingestDocument, searchKnowledgeIndex, readDocWithShared } from './knowledge/index.js';
api/src/server.ts:224:  setIngestBuildKnowledge(async (actor, doc, deps) =>
api/tests/contract/knowledge.test.ts:14:import { closeIndex } from '../../src/knowledge/index-store.js';
api/tests/contract/knowledge.test.ts:163:    const status = await api('/api/v1/knowledge/index-status', admT);
api/src/config.ts:47:  firstBuildReservationTtlMs: number;
api/src/config.ts:133:    firstBuildReservationTtlMs: envInt('FIRST_BUILD_RESERVATION_TTL_MS', 2_700_000),
api/src/llm/sdk-tools.ts:5: * may import `@anthropic-ai/*` (FIXED-3/13, ch02 §2.9).
api/src/llm/sdk-tools.ts:17:import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
api/src/llm/client.ts:19:import { query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
api/src/apps/app-assistant-route.ts:32:import { buildGroundingBlock } from '../knowledge/index.js';
api/src/apps/app-assistant.ts:35:import type { GroundingInput, GroundingResult } from '../knowledge/index.js';

exec
/bin/zsh -lc 'codegraph explore "handleBuildCreate reserveFirstBuild bindReservation firstBuild BuildCreateInput actorOf jobs route knowledgeDocs"' in /Users/ggomes/dev/ekoa-code
 succeeded in 239ms:
**api/src/agents/build.ts** — 603 lines, 13 symbols · used by 1 file: api/tests/agents/build.test.ts

1	/**
2	 * Build jobs (ch05 §5.6.2). The §5.2 pipeline plus build specifics: follow-up detection and the
3	 * in-build classifier (under the abort rules of §5.3.2), the first-build reservation (§5.3.3) and
4	 * the one-follow-up-per-artifact 409 (§5.3.5), routing floored at the expert tier, the inactivity
5	 * + wall-clock timers (§5.3.6), session resume via sdkSessionId persisted-only-when-changed
6	 * (§5.4.5), the completion sequence (§5.6.2 steps 1-8) including the per-build verification stage
7	 * (step 5, ch07 §7.2.6), the provider-error reroute (§5.3.7), the dual-fire guard (§5.3.4), and
8	 * the P-10 persistence + in-process zombie net.
9	 */
10	import type { Actor } from '@ekoa/shared';
11	import { loadAgentsConfig } from '../config.js';
12	import { checkAllowance } from '../billing/index.js';
13	import { BILLING_PAGE_URL } from '../billing/constants.js';
14	import { runAgent, decideForTask, LlmAbortedError } from '../llm/index.js';
15	import { runPostRunExtraction } from '../memory/index.js';
16	import { userSettings } from '../data/stores.js';
17	import {
18	  registerRun,
19	  getRun,
20	  removeRun,
21	  finalizeOnce,
22	  hasLiveJobForArtifact,
23	  reserveFirstBuild,
24	  bindReservation,
25	  releaseReservation,
26	} from './registry.js';
27	import { JobStreamSink, emitIntegrationBuildIntent, emitChatAnswer } from './streaming.js';
28	import { MarkerProcessor, scanProviderError } from './markers.js';
29	import { StreamingIdentityRedactor } from './branding.js';
30	import { toolPolicyFor } from './tools.js';
31	import { knowledgeToolSpecs, loadContextToolSpec, delegateToolSpec } from './sdk-tools.js';
32	import { classifyInBuildIntent } from './guided-build.js';
33	import {
34	  persistJob,
35	  patchJob,
36	  getJob,
37	  jobView,
38	  nonTerminalJobForArtifact,
39	  resetArtifactToDraft,
40	  type JobRecord,
41	} from './jobs.js';
42	import { assembleAgentContext, getBuildMechanics, knowledgeGrounding, ingestBuildKnowledge, verifyRunner } from './seams.js';
43	import { detectDomainHeavy, knowledgeScopingNarration, knowledgeIndexedNarration } from './domain-scoping.js';
44	import { logActivity } from '../data/activity.js';
45	
46	/** Registo (F3): build lifecycle rows, metadata-only (ids/codes — NEVER the request description
47	 *  or any prompt text). The single audit write path (FIXED-8); best-effort so bookkeeping never
48	 *  fails a build. `type` is created | completed | failed | cancelled. */
49	function auditBuild(input: BuildCreateInput, type: string, metadata: Record<string, unknown>): void {
50	  void logActivity(
51	    { userId: input.actor.userId, username: input.username, orgId: input.actor.orgId },
52	    'build',
53	    type,
54	    input.deps,
55	    metadata,
56	  ).catch(() => undefined);
57	}
58	
59	export interface BuildCreateInput {
60	  actor: Actor;
61	  username: string;
62	  sessionId: string;
63	  description: string;
64	  language: string;
65	  templateId?: string;
66	  integrationKeys?: string[];
67	  artifactId?: string;
68	  attachments?: unknown[];
69	  fieldValues?: Record<string, unknown>;
70	  configValues?: Record<string, unknown>;
71	  /** F1 knowledge-during-build: scoping-provided reference documents to ingest into the org
72	   *  knowledge area DURING a domain-heavy first build (org-scoped by the run's actor, immediately
73	   *  searchable to the run's knowledge tools). Additive + optional; populated by the scoping UI +
74	   *  jobs route in a later slice, exercised directly by the build tests here. */
75	  knowledgeDocs?: Array<{ title: string; text: string; collection?: string }>;
76	  deps: { now: () => number; genId: () => string };
77	}
78	
79	export type BuildCreateResult =
80	  | { status: 'created'; job: ReturnType<typeof jobView>; fire: () => void }
81	  | { status: 'answered'; reason: string }
82	  | { status: 'conflict' };
83	
84	/**
85	 * Handle `POST /jobs` (build) up to the response (§5.6.2). First builds reserve synchronously and
86	 * respond `created`; follow-ups run the in-build classifier and may respond `answered` with no
87	 * job. A concurrent follow-up on the same artifact is `conflict` → the route returns 409
88	 * DUPLICATE_BUILD.
89	 */
90	export async function handleBuildCreate(input: BuildCreateInput): Promise<BuildCreateResult> {
91	  return input.artifactId ? handleFollowUp(input, input.artifactId) : handleFirstBuild(input);
92	}
93	
94	// --- First build -------------------------------------------------------------------------
95	
96	async function handleFirstBuild(input: BuildCreateInput): Promise<BuildCreateResult> {
97	  // Reserve synchronously BEFORE any async work (§5.3.3). A live reservation binds the second
98	  // POST to the running job and returns it (the build_intent broadcast reaches every open tab).
99	  const reservation = reserveFirstBuild(input.sessionId, input.deps.now());
100	  if (!reservation.ok) {
101	    // Bound to the existing job — return it as `created` pointing at the running job.
102	    const existingId = reservation.jobId;
103	    return {
104	      status: 'created',
105	      job: { id: existingId, status: 'running', createdAt: new Date(input.deps.now()).toISOString() },
106	      fire: () => {},
107	    };
108	  }
109	
110	  const jobId = input.deps.genId();
111	  bindReservation(input.sessionId, jobId);
112	  const abort = new AbortController();
113	  registerRun({
114	    id: jobId,
115	    ownerUserId: input.actor.userId,
116	    orgId: input.actor.orgId,
117	    kind: 'build',
118	    abort,
119	    startedAt: input.deps.now(),
120	    sessionId: input.sessionId,
121	  });
122	
123	  const record: JobRecord = {
124	    _id: jobId,
125	    kind: 'build',
126	    status: 'created',
127	    userId: input.actor.userId,
128	    sessionId: input.sessionId,
129	    request: {
130	      description: input.description,
131	      language: input.language,
132	      ...(input.templateId ? { templateId: input.templateId } : {}),
133	      ...(input.integrationKeys ? { integrationKeys: input.integrationKeys } : {}),
134	      ...(input.fieldValues ? { fieldValues: input.fieldValues } : {}),
135	      ...(input.configValues ? { configValues: input.configValues } : {}),
136	    },
137	    createdAt: new Date(input.deps.now()).toISOString(),
138	  };
139	  // Persist BEFORE responding so `GET /jobs/:id` finds the record as soon as the 202 returns
140	  // ("respond early once the record exists", §5.2 step 2).
141	  await persistJob(record);
142	  auditBuild(input, 'created', { jobId }); // Registo (F3)
143	
144	  return {
145	    status: 'created',
146	    job: jobView(record),
147	    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: true }),
148	  };
149	}
150	
151	// --- Follow-up ---------------------------------------------------------------------------
152	
153	async function handleFollowUp(input: BuildCreateInput, artifactId: string): Promise<BuildCreateResult> {
154	  // One follow-up build per artifact (§5.3.5): reject a concurrent build targeting the same
155	  // artifact — two would resume the same SDK transcript and corrupt it.
156	  if (hasLiveJobForArtifact(artifactId) || (await nonTerminalJobForArtifact(artifactId))) {
157	    return { status: 'conflict' };
158	  }
159	
160	  const jobId = input.deps.genId();
161	  const abort = new AbortController();
162	  registerRun({
163	    id: jobId,
164	    ownerUserId: input.actor.userId,
165	    orgId: input.actor.orgId,
166	    kind: 'build',
167	    abort,
168	    startedAt: input.deps.now(),
169	    artifactId,
170	    sessionId: input.sessionId,
171	  });
172	
173	  // In-build message classifier BEFORE any build work, under the abort rules of §5.3.2.
174	  let intent: Awaited<ReturnType<typeof classifyInBuildIntent>>;
175	  try {
176	    intent = await classifyInBuildIntent(input.description, input.actor.userId, abort.signal);
177	  } catch (err) {
178	    removeRun(jobId);
179	    if (err instanceof LlmAbortedError) {
180	      // Abort NEVER falls through to a build (§5.3.2): zero jobs created, zero side effects.
181	      return { status: 'answered', reason: 'Execução cancelada.' };
182	    }
183	    // Non-abort classifier failure is non-fatal and defaults to proceeding (§5.6.2) — handled by
184	    // classifyInBuildIntent's own fallback, so reaching here is an unexpected error: answer safely.
185	    return { status: 'answered', reason: 'Não foi possível processar o pedido.' };
186	  }
187	
188	  if (intent === 'integration-build') {
189	    emitIntegrationBuildIntent(input.actor.userId, { sessionId: input.sessionId });
190	    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'Vou ligar essa integração primeiro.' });
191	    removeRun(jobId);
192	    return { status: 'answered', reason: 'integration-build' };
193	  }
194	  if (intent === 'question') {
195	    // In-build answer flow (cheap tier), delivered as chat_answer; no job (§5.6.2).
196	    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'A aplicação está a ser construída; posso ajudar com isso.' });
197	    removeRun(jobId);
198	    return { status: 'answered', reason: 'question' };
199	  }
200	
201	  // modification → proceed with the build. projectDir resolved server-side from the artifact.
202	  const record: JobRecord = {
203	    _id: jobId,
204	    kind: 'build',
205	    status: 'created',
206	    userId: input.actor.userId,
207	    sessionId: input.sessionId,
208	    artifactId,
209	    request: { description: input.description, language: input.language },
210	    createdAt: new Date(input.deps.now()).toISOString(),
211	  };
212	  await persistJob(record);
213	  auditBuild(input, 'created', { jobId, artifactId }); // Registo (F3)
214	  return {
215	    status: 'created',
216	    job: jobView(record),
217	    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: false, artifactId }),
218	  };
219	}
220	
221	// --- Execution ---------------------------------------------------------------------------
222	
223	interface ExecOpts {
224	  firstBuild: boolean;
225	  artifactId?: string;
226	}
227	
228	/**
229	 * F16 steering: the build agent's system prompt names the served entrypoint and forbids the
230	 * orphan-HTML failure mode (the app compiled and served is ALWAYS the manifest entrypoint —
231	 * `frontend/src/index.jsx` importing `App.jsx`; a standalone top-level HTML file is never
232	 * served). The honest-completion gate below is the SYSTEM's catch for when the model errs
233	 * anyway — this prompt just makes the miss rare.
234	 */
235	const BUILD_SYSTEM_PROMPT = [
236	  'You are building a web app inside an Ekoa app workspace.',
237	  'The served application is compiled from the manifest entrypoint: frontend/src/index.jsx, which renders frontend/src/App.jsx.',
238	  'Make ALL user-visible changes by editing frontend/src/App.jsx (and files it imports under frontend/src/).',
239	  'NEVER write a standalone top-level *.html file as the deliverable - top-level HTML files are not served; only the compiled entrypoint bundle is.',
240	  'Do not edit dist/ by hand - it is build output, regenerated from frontend/src/.',
241	  // White-label (ch12; operator report 2026-07-11: the final summary named `window.__ekoa.exportPdf`).
242	  'Your FINAL message is read by a non-technical end user. Write it in the language of their request.',
243	  'In that final message NEVER mention internal platform APIs (window.__ekoa or any of its members), file paths, bundlers, manifests, libraries, or any implementation machinery.',
244	  'Describe what the app DOES in product terms ("um botão que descarrega o documento em PDF"), never HOW it is wired.',
245	].join('\n');
246	
247	/**
248	 * Run the build job through the chokepoint and drive the completion sequence (§5.6.2). Terminal
249	 * state is owned by the finalize path (dual-fire guarded). The in-process zombie net lives in the
250	 * `finally`: a run left non-terminal is flipped to `failed { PIPELINE_STUCK }` and the artifact
251	 * reset to draft (§5.2.1).
252	 */
253	export async function executeBuildJob(jobId: string, input: BuildCreateInput, abort: AbortController, opts: ExecOpts): Promise<void> {
254	  const entry = getRun(jobId);
255	  const sink = new JobStreamSink(jobId);
256	  const start = input.deps.now();
257	  const cfg = loadAgentsConfig();
258	  const mech = getBuildMechanics();
259	
260	  let artifactId = opts.artifactId ?? '';
261	  let projectDir = '';
262	  let slug = '';
263	  let appUrl = '';
264	  let resumeSessionId: string | undefined;
265	  let terminalReached = false;
266	
267	  const finishError = async (code: string): Promise<void> => {
268	    if (finalizeOnce(jobId)) {
269	      sink.error(code, 'A construção falhou.');
270	      await patchJob(jobId, { status: 'failed', error: { code, message: 'A construção falhou.' }, endedAt: new Date(input.deps.now()).toISOString() });
271	      if (artifactId) await resetArtifactToDraft(artifactId); // artifact stays draft on error (§5.6.2)
272	    }
273	    terminalReached = true;
274	  };
275	
276	  // Inactivity + wall-clock timers (§5.3.6). Inactivity resets on every stream/tool/plan
277	  // callback; wall clock is absolute. On a timeout: if abort is already set (cancel owns terminal
278	  // state) stay quiet; otherwise route through the finalized-guarded error path.
279	  let inactivityTimer: NodeJS.Timeout;
280	  const resetInactivity = (): void => {
281	    clearTimeout(inactivityTimer);
282	    inactivityTimer = setTimeout(onTimeout, cfg.buildInactivityTimeoutMs);
283	  };
284	  const wallClock = setTimeout(onTimeout, cfg.buildWallClockMs);
285	  function onTimeout(): void {
286	    if (abort.signal.aborted) return; // cancel owns the terminal state
287	    if (entry) entry.timedOut = true;
288	    abort.abort();
289	  }
290	  resetInactivity();
291	
292	  try {
293	    await patchJob(jobId, { status: 'running', startedAt: new Date(input.deps.now()).toISOString() });
294	
295	    // Billing gate (§5.2 step 3).
296	    const allow = await checkAllowance(input.actor.userId);
297	    if (abort.signal.aborted) { await settleAborted(); return; }
298	    if (!allow.ok) {
299	      clearTimers();
300	      if (finalizeOnce(jobId)) {
301	        const url = allow.billingUrl ?? BILLING_PAGE_URL;
302	        sink.error('BILLING_BLOCKED', `${allow.message ?? 'Faturação bloqueada.'} ${url}`);
303	        await patchJob(jobId, { status: 'failed', error: { code: 'BILLING_BLOCKED', message: allow.message ?? 'Faturação bloqueada.' }, endedAt: new Date(input.deps.now()).toISOString() });
304	      }
305	      terminalReached = true;
306	      return;
307	    }
308	
309	    // First-build vs follow-up resolution.
310	    let basePromptSections: string[] = [];
311	    if (opts.firstBuild) {
312	      const prep = await mech.prepareFirstBuild({ userId: input.actor.userId, sessionId: input.sessionId, description: input.description, language: input.language, ...(input.templateId ? { templateId: input.templateId } : {}) });
313	      artifactId = prep.artifactId;
314	      projectDir = prep.projectDir;
315	      slug = prep.slug;
316	      appUrl = prep.appUrl;
317	      basePromptSections = prep.basePromptSections ?? [];
318	      if (entry) entry.artifactId = artifactId;
319	      await patchJob(jobId, { artifactId });
320	    } else {
321	      const resolved = await mech.resolveFollowUp(artifactId);
322	      if (!resolved) { clearTimers(); await finishError('ADAPTER_ERROR'); return; }
323	      projectDir = resolved.projectDir;
324	      resumeSessionId = resolved.resumeSessionId;
325	      slug = resolved.slug;
326	      appUrl = resolved.appUrl;
327	      basePromptSections = resolved.basePromptSections ?? [];
328	    }
329	    if (abort.signal.aborted) { await settleAborted(); return; }
330	
331	    // Live build surface: the scaffold (or the existing app, on a follow-up) is served ALREADY —
332	    // tell the client where, so the preview iframe + real file tree show from second zero, and
333	    // wire the watcher so every incremental rebuild reloads the preview as the agent writes.
334	    if (artifactId && appUrl) {
335	      sink.artifact({ artifactId, appUrl, ...(slug ? { slug } : {}) });
336	      if (projectDir) await mech.watchRebuilds({ artifactId, projectDir, onRebuild: () => sink.previewReload() });
337	    }
338	
339	    // Routing floored at the expert tier (§5.2 step 5); emit the routing event.
340	    const decision = decideForTask(input.description, undefined, 'EXPERT');
341	    sink.routing(decision.tier, opts.firstBuild ? 'first build' : 'follow-up build');
342	    await patchJob(jobId, { routing: { tier: decision.tier, reason: opts.firstBuild ? 'first build' : 'follow-up build' } });
343	
344	    // F1 knowledge-during-build (§5.5.2 knowledge area). The first-build scoping phase runs a
345	    // DETERMINISTIC domain-heavy detector (no model call, no egress) over the request. A
346	    // domain-heavy app NARRATES a knowledge request on the build stream (upload reference
347	    // documents to the org knowledge area) and, when the request carried scoping-provided
348	    // documents, ingests them into the org knowledge area for THIS run - org-scoped by the run's
349	    // actor, refused for the reserved _shared partition, and immediately searchable to the
350	    // knowledge tools mounted below. Non-blocking + non-fatal: the build never waits on or fails
351	    // for knowledge scoping (mirrors the content/grounding layers).
352	    if (opts.firstBuild) {
353	      try {
354	        const scope = detectDomainHeavy(input.description);
355	        if (scope.domainHeavy) {
356	          sink.planStep('knowledge-scope', knowledgeScopingNarration(scope.domains));
357	          let indexed = 0;
358	          for (const doc of input.knowledgeDocs ?? []) {
359	            const { id } = await ingestBuildKnowledge(
360	              input.actor,
361	              { collection: doc.collection || 'uploads', title: doc.title, text: doc.text, sourceType: 'build-scoping' },
362	              input.deps,
363	            );
364	            if (id) indexed++;
365	          }
366	          if (indexed > 0) sink.planStep('knowledge-indexed', knowledgeIndexedNarration(indexed));
367	        }
368	      } catch (err) {
369	        console.warn('[build] knowledge scoping failed (non-fatal):', err instanceof Error ? err.message : err);
370	      }
371	    }
372	
373	    const policy = toolPolicyFor('build');
374	    const liveMarkers = new MarkerProcessor();
375	    let capturedSessionId: string | undefined;
376	
377	    // The coding kind's content sections lead the build system prompt (before this run's F16
378	    // entrypoint steering) — pre-fix, builds sent ONLY the 6-line inline prompt and the whole
379	    // coding-agent content package was dead weight. The grounding block self-gates (legal-context
380	    // builds only, §5.5.2 layer 2); both layers are non-fatal.
381	    let contentSections: string[] = [];
382	    let groundingBlock = '';
383	    try {
384	      contentSections = (await assembleAgentContext({ agentKind: 'coding', userId: input.actor.userId })).promptSections;
385	      groundingBlock = await knowledgeGrounding({ userId: input.actor.userId, orgId: input.actor.orgId, query: input.description, agentKind: 'coding' });
386	    } catch (err) {
387	      console.warn('[build] content/grounding assembly failed (non-fatal):', err instanceof Error ? err.message : err);
388	    }
389	
390	    const handle = runAgent(
391	      {
392	        prompt: input.description,
393	        // F16: pin the agent to the served entrypoint. Nothing else names it (settingSources is
394	        // empty, §5.4.2), so without this the agent may write a standalone HTML file that is
395	        // never served while the scaffold keeps being compiled. Flows through runAgent's
396	        // anonymise path like every prompt (client.ts systemPrompt handling).
397	        // Base conventions (operator-run B1) sit between the universal coding sections and
398	        // the grounding block: universal judgment first, then the selected base's structural
399	        // invariants, then dynamic knowledge, then the F16 entrypoint steer.
400	        systemPrompt: [...contentSections, ...basePromptSections, groundingBlock, BUILD_SYSTEM_PROMPT].filter(Boolean).join('\n\n'),
401	        decision,
402	        allowedTools: policy.allowedTools,
403	        maxTurns: policy.maxTurns,
404	        // Builds mount the knowledge tools + the context-loading tool + the §5.4.8 local-bridge
405	        // delegation tool as in-process MCP (§5.4.4; ch18 §18.2).
406	        sdkTools: [...knowledgeToolSpecs(input.actor), loadContextToolSpec(input.actor, 'coding'), delegateToolSpec(input.actor, input.sessionId)],
407	        cwd: projectDir || undefined,
408	        homeDir: projectDir || undefined, // build runs set HOME = projectDir (§5.4.1)
409	        ...(resumeSessionId ? { resume: resumeSessionId } : {}),
410	        signal: abort.signal,
411	        callbacks: {
412	          onToolEvent: (e) => { resetInactivity(); sink.toolEvent(e); },
413	          onSessionId: (sid) => { capturedSessionId = sid; },
414	          onPlanNotification: () => resetInactivity(),
415	        },
416	      },
417	      { kind: 'user_work', agentType: 'build', billeeUserId: input.actor.userId, sessionId: input.sessionId, runId: jobId, artifactId },
418	    );
419	
420	    // Two channels, mirroring chat.ts (§5.6.1): the ANSWER stream (`text`) and the working
421	    // commentary (`thinking` — intermediate-turn narration + thinking blocks, where the engine
422	    // happily self-identifies). Pre-fix, build funneled BOTH into text_chunk, so the user's
423	    // transcript filled with mid-word fragments of internal narration rendered as regular
424	    // messages (operator report 2026-07-11). Each channel gets its own marker filter; the
425	    // thinking channel is additionally engine-identity-redacted (branding.ts).
426	    const thinkingMarkers = new MarkerProcessor();
427	    const thinkingRedactor = new StreamingIdentityRedactor();
428	    const emitThinking = (piece: string): void => {
429	      if (piece) sink.thinking(piece);
430	    };
431	    let streamedAny = false; // ANSWER chunks only: thinking must not mask a provider-error-as-result
432	    for await (const ev of handle.events) {
433	      resetInactivity();
434	      if (ev.type === 'thinking') {
435	        emitThinking(thinkingRedactor.push(thinkingMarkers.push(ev.text)));
436	        continue;
437	      }
438	      streamedAny = true;
439	      const clean = liveMarkers.push(ev.text);
440	      if (clean) sink.text(clean);
441	    }
442	    const thinkingTail = thinkingMarkers.end();
443	    emitThinking(thinkingRedactor.push(thinkingTail.text) + thinkingRedactor.end());
444	    const tail = liveMarkers.end();
445	    if (tail.text) sink.text(tail.text);
446	    const result = await handle.result;
447	    clearTimers();
448	
449	    if (result.aborted) { await settleAborted(); return; }
450	
451	    // §5.6.2 completion sequence, step 1: provider-error-as-result reroute (§5.3.7). Scanned only
452	    // on the nothing-streamed fallback shape — same reasoning as chat.ts (F20 made result.text the
453	    // full accumulation; legitimate build narration can mention error terms).
454	    if (!streamedAny && scanProviderError(result.text)) { await finishError('ADAPTER_ERROR'); return; }
455	
456	    // Session resume (§5.4.5): persist sdkSessionId ONLY when it differs from what we resumed with.
457	    if (capturedSessionId && capturedSessionId !== resumeSessionId) {
458	      await mech.persistSdkSessionId(artifactId, capturedSessionId);
459	    }
460	
461	    // Step 2: final bundle. Step 3: version snapshot (broken builds snapshotted with a failure tag).
462	    const bundle = await mech.finalizeBundle({ artifactId, projectDir });
463	    await mech.snapshot({ artifactId, projectDir, broken: !bundle.ok });
464	
465	    // Step 4: slug — preserved on follow-ups, generated on first builds (already resolved in prep).
466	
467	    // Step 5a (F16): honest-completion gate. Deterministic evidence the work reached the SERVED
468	    // surface — an untouched entrypoint subtree / scaffold-fingerprinted dist means the user's
469	    // app was never built (the classic miss: the real app written to an orphan top-level HTML
470	    // that is never served). A gate hit is a DISTINCT non-success terminal: it surfaces to the
471	    // user and the job fails — never a clean `completed` over a scaffold. Runs before the model
472	    // verification (step 5) so a scaffold build is never billed a verification pass.
473	    const progress = await mech.assertProgress({ artifactId, projectDir });
474	    if (!progress.clean) {
475	      if (finalizeOnce(jobId)) {
476	        const detail = progress.reasons.join('; ');
477	        const message = `A construção não chegou à aplicação servida (a página continua o modelo inicial). ${detail}`.trim();
478	        sink.error('BUILD_UNFULFILLED', message);
479	        await patchJob(jobId, { status: 'failed', error: { code: 'BUILD_UNFULFILLED', message }, endedAt: new Date(input.deps.now()).toISOString() });
480	      }
481	      terminalReached = true;
482	      return;
483	    }
484	
485	    // Step 5: per-build verification (default ON per user's build.verifyBuilds). Full acceptance
486	    // pass on a first build; scoped tests + smoke on a follow-up. The runner receives the user's
487	    // REQUEST and asserts request-fulfilment (F28), not mere rendering. Verdict semantics:
488	    //   - ran+passed  → clean, no note.
489	    //   - ran+FAILED  → GATES completion (F28): a distinct non-success terminal that surfaces to
490	    //     the user — never a silent `completed` with a note (that was verification theater: the
491	    //     gate that exists to catch a served scaffold passed it and billed for the pass).
492	    //   - not-run (e.g. credential-skip) → honest note-only, never a failure (§5.6.2 step 5).
493	    let verifyNote: string | undefined;
494	    const verifyEnabled = (await userSettings.get(input.actor.userId))?.build?.verifyBuilds ?? true;
495	    if (verifyEnabled) {
496	      sink.planStep('verifying', 'A testar a aplicação...');
497	      // The verify stage streams its narration through the thinking channel — it used to be a
498	      // silent multi-minute void (operator report 2026-07-11). Its own filter chain: raw runner
499	      // text → marker filter → engine-identity redaction. Verify is bounded by its own wall
500	      // clock inside the runner (verifyWallClockMs), not the build timers (cleared above).
501	      const verifyMarkers = new MarkerProcessor();
502	      const verifyRedactor = new StreamingIdentityRedactor();
503	      const verdict = await verifyRunner({
504	        artifactId,
505	        projectDir,
506	        appUrl,
507	        userId: input.actor.userId,
508	        depth: opts.firstBuild ? 'full' : 'scoped',
509	        request: input.description,
510	        onProgress: (text) => {
511	          const clean = verifyRedactor.push(verifyMarkers.push(text));
512	          if (clean) sink.thinking(clean);
513	        },
514	      });
515	      if (verdict.ran && !verdict.passed) {
516	        if (finalizeOnce(jobId)) {
517	          const message = `A verificação da aplicação falhou. ${verdict.note ?? ''}`.trim();
518	          sink.error('VERIFY_FAILED', message);
519	          await patchJob(jobId, { status: 'failed', error: { code: 'VERIFY_FAILED', message }, endedAt: new Date(input.deps.now()).toISOString() });
520	        }
521	        terminalReached = true;
522	        return;
523	      }
524	      if (!verdict.ran && verdict.note) verifyNote = verdict.note;
525	    }
526	
527	    // Step 6: complete event. Notes (bundle error / honest verify not-run) are APPENDED to the
528	    // agent's user-facing summary, never a replacement for it — pre-fix, any note clobbered the
529	    // whole summary, so the user's "done" message was just "verification did not run: ..."
530	    // (operator report 2026-07-11).
531	    const notes = [bundle.ok ? '' : (bundle.error ?? 'A compilação final falhou.'), verifyNote ?? ''].filter(Boolean).join(' ');
532	    const completionText = [result.text, notes].filter(Boolean).join('\n\n') || notes;
533	    if (finalizeOnce(jobId)) {
534	      sink.complete({ result: completionText, artifactId, slug, appUrl }, input.deps.now() - start);
535	      await patchJob(jobId, { status: 'completed', result: { text: completionText, slug, appUrl }, endedAt: new Date(input.deps.now()).toISOString() });
536	    }
537	    terminalReached = true;
538	
539	    // Step 7: artifact → active with a MERGE onto its data bag (§5.6.2 step 7).
540	    // projectDir lets activation capture the app's declared UI action manifest (C2).
541	    await mech.activateArtifact({ artifactId, slug, appUrl, ...(projectDir ? { projectDir } : {}) });
542	    // Step 8: fire-and-forget screenshot + post-run memory extraction OFF the terminal event.
543	    mech.screenshot(artifactId);
544	    void runPostRunExtraction({ userId: input.actor.userId, username: input.username, orgId: input.actor.orgId, sessionId: input.sessionId, runId: jobId, transcript: `${input.description}\n\n${result.text}`, deps: input.deps }).catch(() => undefined);
545	  } catch (err) {
546	    clearTimers();
547	    await finishError('ADAPTER_ERROR');
548	    void err;
549	  } finally {
550	    clearTimers();
551	    // In-process zombie net (§5.2.1): a run somehow still non-terminal after the pipeline exits is
552	    // flipped to failed { PIPELINE_STUCK } and its artifact reset to draft.
553	    if (!terminalReached && finalizeOnce(jobId)) {
554	      sink.error('PIPELINE_STUCK', 'A construção terminou num estado inconsistente.');
555	      await patchJob(jobId, { status: 'failed', error: { code: 'PIPELINE_STUCK', message: 'Pipeline stuck.' }, endedAt: new Date(input.deps.now()).toISOString() });
556	      if (artifactId) await resetArtifactToDraft(artifactId);
557	    }
558	    if (input.sessionId) releaseReservation(input.sessionId, jobId); // guarded by job id (§5.3.3)
559	    removeRun(jobId);
560	    // Registo (F3): ONE terminal row per build, from the record's final status (guaranteed-once
561	    // here — every terminal transition has already patched the store). Metadata is ids/codes only.
562	    // Best-effort: a store read that fails (e.g. the DB went away as the process exits) must NOT
563	    // become an unhandled rejection on this fire-and-forget pipeline — swallow it like the audit
564	    // write itself (a missed bookkeeping row never fails a build).
565	    try {
566	      const finalJob = await getJob(jobId);
567	      const st = finalJob?.status;
568	      if (st === 'completed') auditBuild(input, 'completed', { jobId, ...(artifactId ? { artifactId } : {}) });
569	      else if (st === 'failed') auditBuild(input, 'failed', { jobId, code: finalJob?.error?.code ?? 'UNKNOWN' });
570	      else if (st === 'cancelled') auditBuild(input, 'cancelled', { jobId });
571	    } catch {
572	      /* terminal-audit read failed (shutdown/db hiccup) — best-effort, never fails the build */
573	    }
574	  }
575	
576	  function clearTimers(): void {
577	    clearTimeout(inactivityTimer);
578	    clearTimeout(wallClock);
579	  }
580	
581	  // Cancelled/plain-abort terminal: set the cancelled status (cancel set it BEFORE the abort, so
582	  // the terminal transition here is the cancelled one; a plain abort stays quiet).
583	  async function bail(): Promise<void> {
584	    clearTimers();
585	    if (entry?.cancelled && finalizeOnce(jobId)) {
586	      await patchJob(jobId, { status: 'cancelled', endedAt: new Date(input.deps.now()).toISOString() });
587	    }
588	    terminalReached = true;
589	  }
590	
591	  // Abort resolution (§5.3.6): a timeout surfaces a terminal ERROR wherever the abort lands —
592	  // including the early checkpoints before the stream — while a user Stop stays silent (cancel
593	  // owns the terminal state). Found by the G7B fresh-context review: bail() alone is
594	  // timeout-blind, so a timeout during checkAllowance/prepare was misreported as a cancel.
595	  async function settleAborted(): Promise<void> {
596	    clearTimers();
597	    if (entry?.timedOut && !entry.cancelled) await finishError('TIMEOUT');
598	    else await bail();
599	  }
600	}
601	
602	export { getJob };
603	

 succeeded in 599ms:
## Flow (call path among the symbols you queried)

1. handleBuildCreate (api/src/agents/build.ts:90)
   ↓ calls
2. handleFirstBuild (api/src/agents/build.ts:96)
   ↓ calls
3. reserveFirstBuild (api/src/agents/registry.ts:168)

> Full source for these symbols is below — the call flow among them, followed by their bodies.
## Exploration: handleBuildCreate reserveFirstBuild bindReservation firstBuild BuildCreateInput actorOf jobs route knowledgeDocs

Found 219 symbols across 68 files.

### Blast radius — what depends on these (update/verify before editing)

- `reserveFirstBuild` (api/src/agents/registry.ts:168) — 3 callers in `api/src/agents/build.ts`; tests: `api/tests/agents/registry.test.ts`
- `BuildCreateInput` (api/src/agents/build.ts:59) — 7 callers in `api/src/agents/build.ts`; tests: `api/tests/agents/build.test.ts`
- `FirstBuildPrep` (api/src/agents/seams.ts:291) — 1 caller in `api/src/agents/seams.ts`; ⚠️ no covering tests found
- `bindReservation` (api/src/agents/registry.ts:178) — 3 callers in `api/src/agents/build.ts`; tests: `api/tests/agents/registry.test.ts`
- `handleBuildCreate` (api/src/agents/build.ts:90) — 1 caller; tests: `api/tests/agents/build.test.ts`

### Relationships

**calls:**
- handleFirstBuild → reserveFirstBuild
- handleFirstBuild → now
- buildApp → setBuildMechanics
- executeBuildJob → getBuildMechanics
- fakeMechanics → push
- execFirstBuild → registerRun
- execFirstBuild → persistJob
- handleFirstBuild → bindReservation
- handleBuildCreate → handleFollowUp
- handleBuildCreate → handleFirstBuild
- ... and 229 more

**references:**
- BuildCreateInput → Actor
- BuildMechanics → FirstBuildPrep
- BuildMechanics → FollowUpResolution
- noopBuildMechanics → BuildMechanics
- buildMechanics → BuildMechanics
- setBuildMechanics → BuildMechanics
- getBuildMechanics → BuildMechanics
- fakeMechanics → BuildMechanics
- execFirstBuild → BuildMechanics
- execFirstBuild → FakeTransport
- ... and 142 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/agents/build.ts — imports(imports), now(calls), BuildCreateInput(references), BuildCreateResult(references), removeRun(calls), registerRun(calls), JobRecord(references), persistJob(calls), auditBuild(calls), jobView(calls), +34 more

```typescript
7	 * (step 5, ch07 §7.2.6), the provider-error reroute (§5.3.7), the dual-fire guard (§5.3.4), and
8	 * the P-10 persistence + in-process zombie net.
9	 */
10	import type { Actor } from '@ekoa/shared';
11	import { loadAgentsConfig } from '../config.js';
12	import { checkAllowance } from '../billing/index.js';
13	import { BILLING_PAGE_URL } from '../billing/constants.js';
14	import { runAgent, decideForTask, LlmAbortedError } from '../llm/index.js';
15	import { runPostRunExtraction } from '../memory/index.js';
16	import { userSettings } from '../data/stores.js';
17	import {
18	  registerRun,
19	  getRun,
20	  removeRun,
21	  finalizeOnce,
22	  hasLiveJobForArtifact,
23	  reserveFirstBuild,
24	  bindReservation,
25	  releaseReservation,
26	} from './registry.js';
27	import { JobStreamSink, emitIntegrationBuildIntent, emitChatAnswer } from './streaming.js';
28	import { MarkerProcessor, scanProviderError } from './markers.js';
29	import { StreamingIdentityRedactor } from './branding.js';
30	import { toolPolicyFor } from './tools.js';
31	import { knowledgeToolSpecs, loadContextToolSpec, delegateToolSpec } from './sdk-tools.js';
32	import { classifyInBuildIntent } from './guided-build.js';
33	import {
34	  persistJob,
35	  patchJob,
36	  getJob,
37	  jobView,
38	  nonTerminalJobForArtifact,
39	  resetArtifactToDraft,
40	  type JobRecord,
41	} from './jobs.js';
42	import { assembleAgentContext, getBuildMechanics, knowledgeGrounding, ingestBuildKnowledge, verifyRunner } from './seams.js';
43	import { detectDomainHeavy, knowledgeScopingNarration, knowledgeIndexedNarration } from './domain-scoping.js';
44	import { logActivity } from '../data/activity.js';
45	
46	/** Registo (F3): build lifecycle rows, metadata-only (ids/codes — NEVER the request description
47	 *  or any prompt text). The single audit write path (FIXED-8); best-effort so bookkeeping never
48	 *  fails a build. `type` is created | completed | failed | cancelled. */
49	function auditBuild(input: BuildCreateInput, type: string, metadata: Record<string, unknown>): void {
50	  void logActivity(
51	    { userId: input.actor.userId, username: input.username, orgId: input.actor.orgId },
52	    'build',
53	    type,
54	    input.deps,
55	    metadata,
56	  ).catch(() => undefined);
57	}
58	
59	export interface BuildCreateInput {
60	  actor: Actor;
61	  username: string;
62	  sessionId: string;
63	  description: string;
64	  language: string;
65	  templateId?: string;
66	  integrationKeys?: string[];
67	  artifactId?: string;
68	  attachments?: unknown[];
69	  fieldValues?: Record<string, unknown>;
70	  configValues?: Record<string, unknown>;
71	  /** F1 knowledge-during-build: scoping-provided reference documents to ingest into the org
72	   *  knowledge area DURING a domain-heavy first build (org-scoped by the run's actor, immediately
73	   *  searchable to the run's knowledge tools). Additive + optional; populated by the scoping UI +
74	   *  jobs route in a later slice, exercised directly by the build tests here. */
75	  knowledgeDocs?: Array<{ title: string; text: string; collection?: string }>;
76	  deps: { now: () => number; genId: () => string };
77	}
78	
79	export type BuildCreateResult =
80	  | { status: 'created'; job: ReturnType<typeof jobView>; fire: () => void }
81	  | { status: 'answered'; reason: string }
82	  | { status: 'conflict' };
83	
84	/**
85	 * Handle `POST /jobs` (build) up to the response (§5.6.2). First builds reserve synchronously and
86	 * respond `created`; follow-ups run the in-build classifier and may respond `answered` with no
87	 * job. A concurrent follow-up on the same artifact is `conflict` → the route returns 409
88	 * DUPLICATE_BUILD.
89	 */
90	export async function handleBuildCreate(input: BuildCreateInput): Promise<BuildCreateResult> {
91	  return input.artifactId ? handleFollowUp(input, input.artifactId) : handleFirstBuild(input);
92	}
93	
94	// --- First build -------------------------------------------------------------------------
95	
96	async function handleFirstBuild(input: BuildCreateInput): Promise<BuildCreateResult> {
97	  // Reserve synchronously BEFORE any async work (§5.3.3). A live reservation binds the second
98	  // POST to the running job and returns it (the build_intent broadcast reaches every open tab).
99	  const reservation = reserveFirstBuild(input.sessionId, input.deps.now());
100	  if (!reservation.ok) {
101	    // Bound to the existing job — return it as `created` pointing at the running job.
102	    const existingId = reservation.jobId;
103	    return {
104	      status: 'created',
105	      job: { id: existingId, status: 'running', createdAt: new Date(input.deps.now()).toISOString() },
106	      fire: () => {},
107	    };
108	  }
109	
110	  const jobId = input.deps.genId();
111	  bindReservation(input.sessionId, jobId);
112	  const abort = new AbortController();
113	  registerRun({
114	    id: jobId,
115	    ownerUserId: input.actor.userId,
116	    orgId: input.actor.orgId,
117	    kind: 'build',
118	    abort,
119	    startedAt: input.deps.now(),
120	    sessionId: input.sessionId,
121	  });
122	
123	  const record: JobRecord = {
124	    _id: jobId,
125	    kind: 'build',
126	    status: 'created',
127	    userId: input.actor.userId,
128	    sessionId: input.sessionId,
129	    request: {
130	      description: input.description,
131	      language: input.language,
132	      ...(input.templateId ? { templateId: input.templateId } : {}),
133	      ...(input.integrationKeys ? { integrationKeys: input.integrationKeys } : {}),
134	      ...(input.fieldValues ? { fieldValues: input.fieldValues } : {}),
135	      ...(input.configValues ? { configValues: input.configValues } : {}),
136	    },
137	    createdAt: new Date(input.deps.now()).toISOString(),
138	  };
139	  // Persist BEFORE responding so `GET /jobs/:id` finds the record as soon as the 202 returns
140	  // ("respond early once the record exists", §5.2 step 2).
141	  await persistJob(record);
142	  auditBuild(input, 'created', { jobId }); // Registo (F3)
143	
144	  return {
145	    status: 'created',
146	    job: jobView(record),
147	    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: true }),
148	  };
149	}
150	
151	// --- Follow-up ---------------------------------------------------------------------------
152	
153	async function handleFollowUp(input: BuildCreateInput, artifactId: string): Promise<BuildCreateResult> {
154	  // One follow-up build per artifact (§5.3.5): reject a concurrent build targeting the same
155	  // artifact — two would resume the same SDK transcript and corrupt it.
156	  if (hasLiveJobForArtifact(artifactId) || (await nonTerminalJobForArtifact(artifactId))) {
157	    return { status: 'conflict' };
158	  }
159	
160	  const jobId = input.deps.genId();
161	  const abort = new AbortController();
162	  registerRun({
163	    id: jobId,
164	    ownerUserId: input.actor.userId,
165	    orgId: input.actor.orgId,
166	    kind: 'build',
167	    abort,
168	    startedAt: input.deps.now(),
169	    artifactId,
170	    sessionId: input.sessionId,
171	  });
172	
173	  // In-build message classifier BEFORE any build work, under the abort rules of §5.3.2.
174	  let intent: Awaited<ReturnType<typeof classifyInBuildIntent>>;
175	  try {
176	    intent = await classifyInBuildIntent(input.description, input.actor.userId, abort.signal);
177	  } catch (err) {
178	    removeRun(jobId);
179	    if (err instanceof LlmAbortedError) {
180	      // Abort NEVER falls through to a build (§5.3.2): zero jobs created, zero side effects.
181	      return { status: 'answered', reason: 'Execução cancelada.' };
182	    }
183	    // Non-abort classifier failure is non-fatal and defaults to proceeding (§5.6.2) — handled by
184	    // classifyInBuildIntent's own fallback, so reaching here is an unexpected error: answer safely.
185	    return { status: 'answered', reason: 'Não foi possível processar o pedido.' };
186	  }
187	
188	  if (intent === 'integration-build') {
189	    emitIntegrationBuildIntent(input.actor.userId, { sessionId: input.sessionId });
190	    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'Vou ligar essa integração primeiro.' });
191	    removeRun(jobId);
192	    return { status: 'answered', reason: 'integration-build' };
193	  }
194	  if (intent === 'question') {
195	    // In-build answer flow (cheap tier), delivered as chat_answer; no job (§5.6.2).
196	    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'A aplicação está a ser construída; posso ajudar com isso.' });
197	    removeRun(jobId);
198	    return { status: 'answered', reason: 'question' };
199	  }
200	
201	  // modification → proceed with the build. projectDir resolved server-side from the artifact.
202	  const record: JobRecord = {
203	    _id: jobId,
204	    kind: 'build',
205	    status: 'created',
206	    userId: input.actor.userId,
207	    sessionId: input.sessionId,
208	    artifactId,
209	    request: { description: input.description, language: input.language },
210	    createdAt: new Date(input.deps.now()).toISOString(),
211	  };
212	  await persistJob(record);
213	  auditBuild(input, 'created', { jobId, artifactId }); // Registo (F3)
214	  return {
215	    status: 'created',
216	    job: jobView(record),
217	    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: false, artifactId }),
218	  };
219	}
220	
221	// --- Execution ---------------------------------------------------------------------------
222	
```

#### api/src/agents/registry.ts — reserveFirstBuild(function), bindReservation(function), Reservation(interface), registerRun(function), cancelRun(function), canCancel(function), hasLiveJobForArtifact(function), removeRun(function), RunKind(type_alias), LiveRunEntry(interface)

```typescript
1	/**
2	 * The in-memory run registry + first-build reservation map (ch05 §5.2.2, §5.3.1, §5.3.3,
3	 * §5.3.4). This is the single-process concurrency substrate for every streaming run class
4	 * (FIXED-8). It holds:
5	 *   - one `LiveRunEntry` per live run (chat, build, brand-research, agent-face), inserted
6	 *     synchronously at creation (§5.2 step 1: a fast Stop must always find its target) and
7	 *     removed in the run wrapper's `finally`;
8	 *   - the `finalized` dual-fire guard (§5.3.4) and the `timedOut` timeout-vs-Stop flag (§5.3.6);
9	 *   - the 45-minute first-build reservation keyed by `sessionId` (§5.3.3);
10	 *   - owner-scoped idempotent cancel with set-before-abort ordering (§5.3.1).
11	 */
12	import type { Actor } from '@ekoa/shared';
13	import { loadAgentsConfig } from '../config.js';
14	
15	export type RunKind = 'chat' | 'build' | 'brand-research' | 'agent-face';
16	
17	export interface LiveRunEntry {
18	  id: string;
19	  ownerUserId: string;
20	  /** Owner's org — org-admins may cancel build jobs in their own org (§5.3.1). */
21	  orgId?: string;
22	  kind: RunKind;
23	  /** Shared by cancel and the timeout timers (§5.3.6). */
24	  abort: AbortController;
25	  /** Dual-fire guard: exactly one of complete/error may finalize (§5.3.4). */
26	  finalized: boolean;
27	  /** Distinguishes a timeout (surfaces a terminal error) from a user Stop (silent) (§5.3.6). */
28	  timedOut: boolean;
29	  /** Set by cancel BEFORE the abort fires, so the abort path stays quiet (§5.3.1). */
30	  cancelled: boolean;
31	  startedAt: number;
32	  /** Build jobs: the artifact this run targets (follow-up 409 query, §5.3.5). */
33	  artifactId?: string;
34	  sessionId?: string;
35	  /** Terminal snapshot for chat runs (kept readable until process exit, §5.2.1/§5.6.8). */
36	  status?: 'running' | 'complete' | 'cancelled' | 'error';
37	  result?: unknown;
38	  error?: { code: string; message: string };
39	  durationMs?: number;
40	}
41	
42	const runs = new Map<string, LiveRunEntry>();
43	
44	/** Insert a run synchronously at creation (§5.2 step 1). */
45	export function registerRun(input: {
46	  id: string;
47	  ownerUserId: string;
48	  orgId?: string;
49	  kind: RunKind;
50	  abort: AbortController;
51	  startedAt: number;
52	  artifactId?: string;
53	  sessionId?: string;
54	}): LiveRunEntry {
55	  const entry: LiveRunEntry = {
56	    id: input.id,
57	    ownerUserId: input.ownerUserId,
58	    orgId: input.orgId,
59	    kind: input.kind,
60	    abort: input.abort,
61	    finalized: false,
62	    timedOut: false,
63	    cancelled: false,
64	    startedAt: input.startedAt,
65	    artifactId: input.artifactId,
66	    sessionId: input.sessionId,
67	  };
68	  runs.set(input.id, entry);
69	  return entry;
70	}
71	
72	export function getRun(id: string): LiveRunEntry | undefined {
73	  return runs.get(id);
74	}
75	
76	/** Remove a run (the run wrapper's `finally`). */
77	export function removeRun(id: string): void {
78	  runs.delete(id);
79	}
80	
81	/** Record a chat run's terminal snapshot and KEEP the entry readable until process exit
82	 *  (§5.2.1/§5.6.8): `GET /chat/runs/:id` serves it; a restart empties the registry → 404. */
83	export function settleChatRun(id: string, patch: { status: 'complete' | 'cancelled' | 'error'; result?: unknown; error?: { code: string; message: string }; durationMs?: number }): void {
84	  const entry = runs.get(id);
85	  if (!entry) return;
86	  entry.status = patch.status;
87	  if (patch.result !== undefined) entry.result = patch.result;
88	  if (patch.error) entry.error = patch.error;
89	  if (patch.durationMs !== undefined) entry.durationMs = patch.durationMs;
90	}
91	
92	/** Wire-facing `ChatRun` projection (shared/chat.ts) of a live/terminal chat entry. */
93	export function chatRunView(entry: LiveRunEntry): {
94	  id: string;
95	  status: 'pending' | 'running' | 'complete' | 'cancelled' | 'error';
96	  sessionId?: string;
97	  result?: unknown;
98	  error?: { code: string; message: string };
99	  durationMs?: number;
100	} {
101	  return {
102	    id: entry.id,
103	    status: entry.status ?? 'running',
104	    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
105	    ...(entry.result !== undefined ? { result: entry.result } : {}),
106	    ...(entry.error ? { error: entry.error } : {}),
107	    ...(entry.durationMs !== undefined ? { durationMs: entry.durationMs } : {}),
108	  };
109	}
110	
111	/**
112	 * Claim the single terminal transition for a run (§5.3.4 dual-fire guard). Returns true for the
113	 * FIRST caller and false for every subsequent one — the second complete/error arrival after a
114	 * wall-clock race is a no-op.
115	 */
116	export function finalizeOnce(id: string): boolean {
117	  const entry = runs.get(id);
118	  if (!entry || entry.finalized) return false;
119	  entry.finalized = true;
120	  return true;
121	}
122	
123	/** True when a run targeting `artifactId` is still live (the follow-up 409 query, §5.3.5). */
124	export function hasLiveJobForArtifact(artifactId: string): boolean {
125	  for (const e of runs.values()) {
126	    if (e.kind === 'build' && e.artifactId === artifactId && !e.finalized) return true;
127	  }
128	  return false;
129	}
130	
131	/**
132	 * Owner-scoped idempotent cancel (§5.3.1). Ordering is load-bearing: set `cancelled` BEFORE
133	 * firing the abort so the abort path observes the cancelled state and stays quiet instead of
134	 * double-reporting. Cancelling a terminal/unknown run returns `{ cancelled: false }` without
135	 * error. Authorization: owner, an org-admin over a build job in its own org, or a super-admin.
136	 */
137	export function cancelRun(id: string, actor: Actor): { cancelled: boolean } {
138	  const entry = runs.get(id);
139	  if (!entry || entry.finalized || entry.cancelled) return { cancelled: false };
140	  if (!canCancel(entry, actor)) return { cancelled: false };
141	  entry.cancelled = true; // BEFORE abort (§5.3.1)
142	  entry.abort.abort();
143	  return { cancelled: true };
144	}
145	
146	function canCancel(entry: LiveRunEntry, actor: Actor): boolean {
147	  if (entry.ownerUserId === actor.userId) return true;
148	  if (actor.role === 'super-admin') return true;
149	  if (actor.role === 'org-admin' && entry.kind === 'build' && entry.orgId && entry.orgId === actor.orgId) return true;
150	  return false;
151	}
152	
153	// --- First-build reservation map (§5.3.3) ------------------------------------------------
154	
155	interface Reservation {
156	  jobId: string;
157	  expiresAt: number;
158	}
159	const reservations = new Map<string, Reservation>();
160	
161	/**
162	 * Reserve a first-build slot for `sessionId`, synchronously before any async work (§5.3.3). A
163	 * second reservation while a live one exists returns the existing job id (the caller binds to it
164	 * and returns the running job). The reservation stores an empty job id until `bindReservation`
165	 * sets it — but the mint happens synchronously with no await in between, so a concurrent caller
166	 * never observes the empty window.
167	 */
168	export function reserveFirstBuild(sessionId: string, now: number): { ok: true } | { ok: false; jobId: string } {
169	  const existing = reservations.get(sessionId);
170	  if (existing && existing.expiresAt > now) {
171	    return { ok: false, jobId: existing.jobId };
172	  }
173	  reservations.set(sessionId, { jobId: '', expiresAt: now + loadAgentsConfig().firstBuildReservationTtlMs });
174	  return { ok: true };
175	}
176	
177	/** Bind a freshly-minted job id to the live reservation for `sessionId`. */
178	export function bindReservation(sessionId: string, jobId: string): void {
179	  const r = reservations.get(sessionId);
180	  if (r) r.jobId = jobId;
181	}
182	
183	/**
184	 * Release the reservation for `sessionId`, guarded by job id: a late release cannot free a newer
185	 * reservation (§5.3.3). Called from the run wrapper's `finally`.
186	 */
187	export function releaseReservation(sessionId: string, jobId: string): void {
188	  const r = reservations.get(sessionId);
189	  if (r && r.jobId === jobId) reservations.delete(sessionId);
190	}
191	
192	/** Test-only: clear all registry + reservation state. */
193	export function __resetRegistryForTests(): void {
194	  runs.clear();
195	  reservations.clear();
196	}
197	
198	/** Test/introspection: current live run count. */
199	export function liveRunCount(): number {
200	  return runs.size;
201	}
```

#### api/src/routes/helpers.ts — actorOf(function)

```typescript
1	/**
2	 * Thin-route helpers (ch02 §2.6): actor extraction from the verified JWT, uniform error
3	 * shaping (CONV-2), and zod request validation. Routers do exactly three things: validate,
4	 * call one domain module, shape the response.
5	 */
6	import type { Response } from 'express';
7	import type { ZodTypeAny, infer as zInfer } from 'zod';
8	import { ERROR_STATUS, type ErrorCode, type Actor } from '@ekoa/shared';
9	import type { AuthedRequest } from '../auth/middleware.js';
10	
11	export function actorOf(req: AuthedRequest): Actor {
12	  const u = req.user!;
13	  return { userId: u.sub, orgId: u.orgId, role: u.role };
14	}
15	
16	export function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
17	  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
18	}
19	
20	export function notFound(res: Response): void {
21	  sendError(res, 'NOT_FOUND', 'Não encontrado.');
22	}
23	
24	/** Validate req.body against a schema; on failure send 400 and return undefined. */
25	export function parseBody<S extends ZodTypeAny>(res: Response, schema: S, body: unknown): zInfer<S> | undefined {
26	  const parsed = schema.safeParse(body);
27	  if (!parsed.success) {
28	    sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
29	    return undefined;
30	  }
31	  return parsed.data as zInfer<S>;
32	}
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I’m checking the write path now. The main risk isn’t the happy path the tests exercise, it’s whether client-supplied fields can steer the org/collection or whether the build hook violates the “non-blocking” promise under slow or failing ingest.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc 'codegraph explore "ingestDocument CreateDocumentInput assertNotSharedActor writeDoc path validation collection validate segment"' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph explore "search(orgId query limit) SHARED_ORG_ID listDocuments CreateDocumentInput knowledge service"' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc 'codegraph explore "jobs route handleBuildCreate parseBody shared jobs contract BuildCreateInput knowledgeDocs"' in /Users/ggomes/dev/ekoa-code
 succeeded in 774ms:
## Exploration: ingestDocument CreateDocumentInput assertNotSharedActor writeDoc path validation collection validate segment

Found 156 symbols across 54 files.

### Blast radius — what depends on these (update/verify before editing)

- `ingestDocument` (api/src/knowledge/service.ts:172) — 9 callers in `api/src/knowledge/service.ts`, `api/src/routes/knowledge.ts`, `api/src/server.ts`, `api/src/knowledge/index.ts`; tests: `api/tests/knowledge/service.test.ts`, `api/tests/knowledge/build-knowledge-ingest.test.ts`
- `writeDoc` (api/src/knowledge/vault.ts:71) — 4 callers in `api/scripts/migrate/knowledge/importer.ts`; tests: `api/tests/knowledge/vault.test.ts`, `api/tests/knowledge/service.test.ts`
- `ValidateRule` (api/src/automation/platform-primitives.ts:34) — 2 callers in `api/src/automation/platform-primitives.ts`; ⚠️ no covering tests found
- `CreateDocumentInput` (api/src/knowledge/service.ts:149) — 2 callers in `api/src/knowledge/index.ts`, `api/src/knowledge/service.ts`; ⚠️ no covering tests found

### Relationships

**calls:**
- ingestDocument → assertNotSharedActor
- ingestDocument → now
- writeDoc → serializeDoc
- runKnowledgeImport → writeDoc
- executeEkoaActionStep → executeRecipe
- executePrimitive → list
- executePrimitive → push
- executePrimitive → get
- executePrimitive → renderObjectRefs
- executePrimitive → delete
- ... and 179 more

**references:**
- PlatformPrimitive → ValidateRule
- validateRule → ValidateRule
- PlatformPrimitive → TemplateRef
- PlatformPrimitive → SimpleQuery
- PlatformPrimitive → ConditionExpr
- executeRecipe → PlatformPrimitive
- executePrimitive → PlatformPrimitive
- renderRef → TemplateRef
- evalQuery → SimpleQuery
- evalCondition → ConditionExpr
- ... and 44 more

**instantiates:**
- executePrimitive → EkoaActionFailure
- assertNotSharedActor → KnowledgeError

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/knowledge/service.ts — Actor(references), KnowledgeError(instantiates), references(references), calls(calls), Deps(references), KnowledgeUploadDoc(interface), Deps(interface), KnowledgeError(class), constructor(method), assertNotSharedActor(function), +9 more

```typescript
31	  crawlConfig?: Record<string, unknown>;
32	}
33	
34	export interface KnowledgeUploadDoc extends Doc {
35	  orgId: string;
36	  filename: string;
37	  collection?: string;
38	  docIds: string[];
39	  status: string;
40	  size?: number;
41	  contentType?: string;
42	  storedPath?: string; // storage-relative (P-07)
43	  createdAt?: string;
44	}
45	
46	export interface Deps { now: () => number; genId: () => string }
47	
48	export class KnowledgeError extends Error {
49	  constructor(public code: string, public status: number, message: string) {
50	    super(message);
51	  }
52	}
53	
54	/**
55	 * Tenancy guard for the reserved shared partition (ch04 §4.4.1). The `_shared` corpus is a
56	 * read-only public legal spine, written ONLY by the offline importer CLI. No real actor is ever
57	 * assigned this org id (UUIDs never collide with it), so this is a structural invariant, not a
58	 * user-facing permission: any request actor presenting the shared org id is refused before it can
59	 * mutate the corpus through the service.
60	 */
61	function assertNotSharedActor(actor: Actor): void {
62	  if (actor.orgId === SHARED_ORG_ID) {
63	    throw new KnowledgeError('FORBIDDEN', 403, 'A coleção partilhada é só de leitura.');
64	  }
65	}
66	
67	// --- Sources (G4, unchanged) ---------------------------------------------------------------
68	

... (gap) ...

88	  return knowledgeSources.find({ orgId: actor.orgId }) as Promise<KnowledgeSourceDoc[]>;
89	}
90	
91	export async function addSource(actor: Actor, input: { url: string; kind?: string; seedId?: string }, deps: Deps): Promise<KnowledgeSourceDoc> {
92	  // SSRF-validate the user-supplied URL at write time (ch09 invariant 8).
93	  try {
94	    assertSafeUrl(input.url);
95	  } catch (e) {
96	    if (e instanceof SsrfError) throw new KnowledgeError('VALIDATION_FAILED', 400, 'URL não permitido.');
97	    throw e;
98	  }
99	  const id = deps.genId();
100	  const doc: KnowledgeSourceDoc = { _id: id, orgId: actor.orgId, url: input.url, kind: input.kind, seedId: input.seedId };
101	  await knowledgeSources.insert(doc as never);
102	  return doc;
103	}
104	
105	export async function getVisibleSource(actor: Actor, id: string): Promise<KnowledgeSourceDoc | null> {
106	  const s = (await knowledgeSources.get(id)) as KnowledgeSourceDoc | null;

... (gap) ...

113	 * `type`/`seedTemplate` names are mapped back onto the store's `kind`/`seedId`. A changed `url` is
114	 * SSRF-validated exactly as `addSource` does — a patch must not be a bypass of that gate.
115	 */
116	export async function updateSource(
117	  actor: Actor,
118	  id: string,
119	  patch: { url?: string; type?: string; collection?: string; seedTemplate?: string | null; enabled?: boolean },
120	): Promise<KnowledgeSourceDoc | null> {
121	  const s = await getVisibleSource(actor, id);
122	  if (!s) return null;
123	  if (patch.url !== undefined) {
124	    try {
125	      assertSafeUrl(patch.url);
126	    } catch (e) {
127	      if (e instanceof SsrfError) throw new KnowledgeError('VALIDATION_FAILED', 400, 'URL não permitido.');
128	      throw e;
129	    }
130	  }
131	  const next: Partial<KnowledgeSourceDoc> = {
132	    ...(patch.url !== undefined ? { url: patch.url } : {}),
133	    ...(patch.type !== undefined ? { kind: patch.type } : {}),
134	    ...(patch.collection !== undefined ? { collection: patch.collection } : {}),
135	    ...(patch.seedTemplate !== undefined ? { seedId: patch.seedTemplate ?? undefined } : {}),
136	    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
137	  };
138	  return (await knowledgeSources.update(id, (cur) => ({ ...cur, ...next } as never))) as unknown as KnowledgeSourceDoc | null;
139	}
140	
141	export async function deleteSource(actor: Actor, id: string): Promise<boolean> {
142	  const s = await getVisibleSource(actor, id);
143	  if (!s) return false;
144	  return knowledgeSources.delete(id);
145	}
146	
147	// --- Vault documents (this slice) -----------------------------------------------------------
148	
149	export interface CreateDocumentInput {
150	  collection: string;
151	  title: string;
152	  text: string;
153	  sourceUrl?: string;
154	  sourceType?: string;
155	  language?: string;
156	}
157	
158	function toSummary(d: vault.VaultDoc, now?: string) {
159	  return {

... (gap) ...

169	}
170	
171	/** Ingest a document: write the vault file, then run the index write hook. Returns the id. */
172	export async function ingestDocument(actor: Actor, input: CreateDocumentInput, deps: Deps): Promise<{ id: string }> {
173	  assertNotSharedActor(actor);
174	  const docId = deps.genId();
175	  const createdAt = new Date(deps.now()).toISOString();
176	  const fm: vault.DocFrontmatter = {
177	    title: input.title,
178	    sourceUrl: input.sourceUrl,
179	    sourceType: input.sourceType,
180	    language: input.language,
181	    createdAt,
182	  };
183	  try {
184	    await vault.writeDoc(actor.orgId, input.collection, docId, fm, input.text);
185	  } catch (e) {
186	    if (e instanceof PathSafetyError) throw new KnowledgeError('VALIDATION_FAILED', 400, 'Coleção inválida.');
187	    throw e;
188	  }
189	  index.indexDoc({
190	    orgId: actor.orgId,
191	    collection: input.collection,
192	    docId,
193	    title: input.title,
194	    body: input.text,
195	    createdAt,
196	    sourceUrl: input.sourceUrl,
197	    sourceType: input.sourceType,
198	    language: input.language,
199	  });
200	  return { id: docId };
201	}
202	
203	export async function listDocuments(
204	  actor: Actor,
```

#### api/src/knowledge/vault.ts — writeDoc(function), DocFrontmatter(interface), serializeDoc(function), VaultDoc(interface), listAllDocs(function), deleteDoc(function)

```typescript
1	/**
2	 * The knowledge vault (ch04 §4.4.1): a filesystem markdown corpus, one file per document with
3	 * a small frontmatter block, org-partitioned by path segment. This module is the ONLY writer of
4	 * vault files; it holds no search logic (that is the lexical index) and imports nothing from
5	 * llm/ (knowledge/ has no path to the egress module — CLAUDE.md, ekoa-architecture).
6	 *
7	 * Frontmatter is a fixed set of scalar fields, each JSON-encoded so titles/URLs carrying colons,
8	 * quotes or newlines round-trip unambiguously:
9	 *
10	 *   ---
11	 *   title: "Acórdão do STJ"
12	 *   sourceUrl: "https://dgsi.pt/..."
13	 *   createdAt: "2026-07-07T10:00:00.000Z"
14	 *   ---
15	 *   <markdown body>
16	 */
17	import { mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
18	import { collectionDir, docPath, orgVaultDir, vaultRoot, isSafeSegment } from './paths.js';
19	
20	export interface DocFrontmatter {
21	  title: string;
22	  sourceUrl?: string;
23	  sourceType?: string;
24	  language?: string;
25	  createdAt: string;
26	}
27	
28	export interface VaultDoc extends DocFrontmatter {
29	  docId: string;
30	  collection: string;
31	  size: number;
32	}
33	
34	const FM_KEYS: (keyof DocFrontmatter)[] = ['title', 'sourceUrl', 'sourceType', 'language', 'createdAt'];
35	
36	export function serializeDoc(fm: DocFrontmatter, body: string): string {
37	  const lines = ['---'];
38	  for (const k of FM_KEYS) {
39	    const v = fm[k];
40	    if (v !== undefined) lines.push(`${k}: ${JSON.stringify(v)}`);
41	  }
42	  lines.push('---', '');
43	  return `${lines.join('\n')}${body}`;
44	}
45	
46	export function parseDoc(raw: string): { fm: DocFrontmatter; body: string } {
47	  const fm: Partial<DocFrontmatter> = {};
48	  if (!raw.startsWith('---\n')) return { fm: { title: '', createdAt: '' }, body: raw };
49	  const end = raw.indexOf('\n---', 3);
50	  if (end === -1) return { fm: { title: '', createdAt: '' }, body: raw };
51	  const block = raw.slice(4, end);
52	  for (const line of block.split('\n')) {
53	    const idx = line.indexOf(':');
54	    if (idx === -1) continue;
55	    const key = line.slice(0, idx).trim() as keyof DocFrontmatter;
56	    if (!FM_KEYS.includes(key)) continue;
57	    const rest = line.slice(idx + 1).trim();
58	    try {
59	      fm[key] = JSON.parse(rest) as string;
60	    } catch {
61	      fm[key] = rest;
62	    }
63	  }
64	  // body begins after the closing `\n---` line and its trailing newline
65	  const afterFence = raw.indexOf('\n', end + 1);
66	  const body = afterFence === -1 ? '' : raw.slice(afterFence + 1);
67	  return { fm: { title: fm.title ?? '', createdAt: fm.createdAt ?? '', ...fm }, body };
68	}
69	
70	/** Write (create or overwrite) one document file. Returns the persisted VaultDoc. */
71	export async function writeDoc(
72	  orgId: string,
73	  collection: string,
74	  docId: string,
75	  fm: DocFrontmatter,
76	  body: string,
77	): Promise<VaultDoc> {
78	  const path = docPath(orgId, collection, docId);
79	  await mkdir(collectionDir(orgId, collection), { recursive: true });
80	  const content = serializeDoc(fm, body);
81	  await writeFile(path, content, 'utf8');
82	  return { docId, collection, size: Buffer.byteLength(content, 'utf8'), ...fm };
83	}
84	
85	/** Read one document's frontmatter + body, or null if it does not exist in this org. */
86	export async function readDoc(
87	  orgId: string,
88	  collection: string,
89	  docId: string,
90	): Promise<{ fm: DocFrontmatter; body: string } | null> {
91	  try {
92	    return parseDoc(await readFile(docPath(orgId, collection, docId), 'utf8'));
93	  } catch {
94	    return null;
95	  }
96	}
97	
98	/** Delete one document file. Returns false when it was already absent. */
99	export async function deleteDoc(orgId: string, collection: string, docId: string): Promise<boolean> {
100	  const path = docPath(orgId, collection, docId);
101	  try {
102	    await stat(path);
103	  } catch {
104	    return false;
105	  }
106	  await rm(path, { force: true });
107	  return true;
108	}
109	
110	/** List every org partition present on disk (used by the startup backfill). */
111	export async function listOrgIds(): Promise<string[]> {
112	  let entries: import('node:fs').Dirent[];
113	  try {
114	    entries = await readdir(vaultRoot(), { withFileTypes: true });
115	  } catch {
116	    return [];
117	  }
118	  return entries.filter((e) => e.isDirectory() && isSafeSegment(e.name)).map((e) => e.name).sort();
119	}
120	
121	/** List collection names present in an org's vault (directory browse, not search). */
122	export async function listCollections(orgId: string): Promise<string[]> {
123	  let entries: import('node:fs').Dirent[];
124	  try {
125	    entries = await readdir(orgVaultDir(orgId), { withFileTypes: true });
126	  } catch {
127	    return [];
128	  }
129	  return entries.filter((e) => e.isDirectory() && isSafeSegment(e.name)).map((e) => e.name).sort();
130	}
131	
132	/** Enumerate every document in an org (optionally one collection). Filesystem browse: reads each
133	 *  file's frontmatter. Deterministic order: createdAt then docId. */
134	export async function listAllDocs(orgId: string, collection?: string): Promise<VaultDoc[]> {
135	  const collections = collection ? [collection] : await listCollections(orgId);
136	  const out: VaultDoc[] = [];
137	  for (const coll of collections) {
138	    if (!isSafeSegment(coll)) continue;
139	    let files: string[];
140	    try {
141	      files = await readdir(collectionDir(orgId, coll));
142	    } catch {
143	      continue;
144	    }
145	    for (const file of files) {
146	      if (!file.endsWith('.md')) continue;
147	      const docId = file.slice(0, -3);
148	      if (!isSafeSegment(docId)) continue;
149	      const parsed = await readDoc(orgId, coll, docId);
150	      if (!parsed) continue;
151	      const content = serializeDoc(parsed.fm, parsed.body);
152	      out.push({ docId, collection: coll, size: Buffer.byteLength(content, 'utf8'), ...parsed.fm });
153	    }
154	  }
155	  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.docId < b.docId ? -1 : 1));
156	  return out;
157	}
158	
159	/** Paginated slice of {@link listAllDocs}. */
160	export async function listDocs(
161	  orgId: string,
162	  opts: { collection?: string; offset?: number; limit?: number } = {},
163	): Promise<{ items: VaultDoc[]; total: number }> {
164	  const all = await listAllDocs(orgId, opts.collection);
165	  const offset = opts.offset ?? 0;
166	  const limit = opts.limit ?? 50;
167	  return { items: all.slice(offset, offset + limit), total: all.length };
168	}
```

#### web/components/ui/input.tsx — Input(function), Input(constant)

```tsx
1	'use client';
2	import React from 'react';
3	import type { LucideIcon } from 'lucide-react';
4	import { fieldClasses, labelClasses, hintClasses, errorTextClasses, useFieldId } from './field';
5	
6	export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
7	  label?: string;
8	  hint?: string;
9	  error?: string;
10	  leftIcon?: LucideIcon;
11	  wrapperClassName?: string;
12	}
13	
14	export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
15	  { label, hint, error, leftIcon: LeftIcon, className, wrapperClassName, id, ...rest },
16	  ref,
17	) {
18	  const inputId = useFieldId(label, id);
19	  const describedById = `${inputId}-desc`;
20	  const hasDescription = Boolean(error || hint);
21	  return (
22	    <div className={wrapperClassName}>
23	      {label && (
24	        <label htmlFor={inputId} className={labelClasses}>
25	          {label}
26	        </label>
27	      )}
28	      <div className="relative">
29	        {LeftIcon && (
30	          <LeftIcon
31	            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
32	            aria-hidden
33	          />
34	        )}
35	        <input
36	          ref={ref}
37	          id={inputId}
38	          aria-invalid={error ? true : undefined}
39	          aria-describedby={hasDescription ? describedById : undefined}
40	          className={`${fieldClasses(!!error)} ${LeftIcon ? 'pl-9' : ''} ${className ?? ''}`}
41	          {...rest}
42	        />
43	      </div>
44	      {error && (
45	        <p id={describedById} className={errorTextClasses}>
46	          {error}
47	        </p>
48	      )}
49	      {hint && !error && (
50	        <p id={describedById} className={hintClasses}>
51	          {hint}
52	        </p>
53	      )}
54	    </div>
55	  );
56	});
```

#### shared/src/knowledge.ts — CollectionsResponse(type_alias)

```typescript
1	/** Knowledge domain contract (ch03 §3.8.20): org-partitioned vault CRUD, sources, uploads, heal ops. */
2	import { z } from 'zod';
3	import { Id, IsoTimestamp, listResponse, itemsResponse, OkResponse, PaginationQuery, Language } from './common.js';
4	import type { DomainDescriptorMap } from './descriptor.js';
5	
6	export const KnowledgeDocSummary = z
7	  .object({
8	    id: Id,
9	    collection: z.string(),
10	    title: z.string(),
11	    sourceUrl: z.string().optional(),
12	    sourceType: z.string().optional(),
13	    language: z.string().optional(),
14	    size: z.number().int().nonnegative().optional(),
15	    chunks: z.number().int().nonnegative().optional(),
16	    createdAt: IsoTimestamp.optional(),
17	    updatedAt: IsoTimestamp.optional(),
18	  })
19	  .passthrough();
20	export type KnowledgeDocSummary = z.infer<typeof KnowledgeDocSummary>;
21	
22	export const KnowledgeSource = z
23	  .object({
24	    id: Id,
25	    url: z.string(),
26	    type: z.string().optional(),
27	    collection: z.string().optional(),
28	    seedTemplate: z.string().nullable().optional(),
29	    enabled: z.boolean().optional(),
30	    lastCrawledAt: IsoTimestamp.optional(),
31	    createdAt: IsoTimestamp.optional(),
32	    updatedAt: IsoTimestamp.optional(),
33	  })
34	  .passthrough();
35	export type KnowledgeSource = z.infer<typeof KnowledgeSource>;
36	
37	export const SourceInput = z
38	  .object({
39	    url: z.string(),
40	    type: z.string().optional(),
41	    collection: z.string().optional(),
42	    seedTemplate: z.string().nullable().optional(),
43	    enabled: z.boolean().optional(),
44	  })
45	  .passthrough();
46	export type SourceInput = z.infer<typeof SourceInput>;
47	
48	export const UploadDoc = z
49	  .object({
50	    id: Id,
51	    uploadId: z.string().optional(),
52	    filename: z.string(),
53	    collection: z.string().optional(),
54	    size: z.number().int().nonnegative().optional(),
55	    contentType: z.string().optional(),
56	    indexedAt: IsoTimestamp.optional(),
57	    createdAt: IsoTimestamp.optional(),
58	  })
59	  .passthrough();
60	export type UploadDoc = z.infer<typeof UploadDoc>;
61	
62	export const IndexStatus = z
63	  .object({
64	    status: z.string(),
65	    documentCount: z.number().int().nonnegative().optional(),
66	    collectionCount: z.number().int().nonnegative().optional(),
67	    lastIndexedAt: IsoTimestamp.optional(),
68	  })
69	  .passthrough();
70	export type IndexStatus = z.infer<typeof IndexStatus>;
71	
72	export const CollectionsResponse = itemsResponse(z.string());
73	export type CollectionsResponse = z.infer<typeof CollectionsResponse>;
74	
75	export const DocumentsQuery = PaginationQuery.extend({
76	  collection: z.string().optional(),
77	});
78	export type DocumentsQuery = z.infer<typeof DocumentsQuery>;
79	
80	export const DocumentsResponse = listResponse(KnowledgeDocSummary);
81	export type DocumentsResponse = z.infer<typeof DocumentsResponse>;
82	
83	export const CreateDocumentRequest = z.object({
84	  collection: z.string(),
85	  title: z.string(),
86	  text: z.string(),
87	  sourceUrl: z.string().optional(),
88	  sourceType: z.string().optional(),
89	  language: Language.optional(),
90	});
91	export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequest>;
92	
93	export const CreateDocumentResponse = z.object({ id: z.string() });
94	export type CreateDocumentResponse = z.infer<typeof CreateDocumentResponse>;
95	
96	export const SourcesResponse = itemsResponse(KnowledgeSource);
97	export type SourcesResponse = z.infer<typeof SourcesResponse>;
98	
99	export const CrawlStartResponse = z.object({
100	  started: z.boolean(),
101	  alreadyRunning: z.boolean(),
102	});
103	export type CrawlStartResponse = z.infer<typeof CrawlStartResponse>;
104	
105	export const CrawlStatusResponse = z
106	  .object({
107	    running: z.boolean(),
108	    progress: z.number().optional(),
109	    stats: z.record(z.unknown()).optional(),
110	  })
111	  .passthrough();
112	export type CrawlStatusResponse = z.infer<typeof CrawlStatusResponse>;
113	
114	export const RefreshScheduleResponse = z
115	  .object({
116	    schedule: z.record(z.unknown()).nullable(),
117	  })
118	  .passthrough();
119	export type RefreshScheduleResponse = z.infer<typeof RefreshScheduleResponse>;
120	
121	export const UploadsResponse = itemsResponse(UploadDoc);
122	export type UploadsResponse = z.infer<typeof UploadsResponse>;
123	
124	export const CreateUploadResponse = z
125	  .object({
126	    uploadId: z.string(),
127	  })
128	  .passthrough();
129	export type CreateUploadResponse = z.infer<typeof CreateUploadResponse>;
130	
131	export const DeleteUploadResponse = z.object({
132	  removed: z.boolean(),
133	  docsRemoved: z.number().int().nonnegative(),
134	});
135	export type DeleteUploadResponse = z.infer<typeof DeleteUploadResponse>;
136	
137	export const ReindexResponse = z.object({ started: z.boolean() });
138	export type ReindexResponse = z.infer<typeof ReindexResponse>;
139	
140	export const knowledgeEndpoints = {
141	  listCollections: {
142	    method: 'GET',
143	    path: '/api/v1/knowledge/collections',
144	    auth: 'user',
145	    response: CollectionsResponse,
146	  },
147	  listDocuments: {
148	    method: 'GET',
149	    path: '/api/v1/knowledge/documents',
150	    auth: 'user',
151	    query: DocumentsQuery,
152	    response: DocumentsResponse,
153	  },
154	  createDocument: {
155	    method: 'POST',
156	    path: '/api/v1/knowledge/documents',
157	    auth: 'user',
158	    request: CreateDocumentRequest,
159	    response: CreateDocumentResponse,
160	  },
161	  deleteDocument: {
162	    method: 'DELETE',
163	    path: '/api/v1/knowledge/collections/:collection/documents/:id',
164	    auth: 'user',
165	    response: OkResponse,
166	  },
167	  listSources: {
168	    method: 'GET',
169	    path: '/api/v1/knowledge/sources',
170	    auth: 'user',
171	    response: SourcesResponse,
172	  },
173	  createSource: {
174	    method: 'POST',
175	    path: '/api/v1/knowledge/sources',
176	    auth: 'user',
177	    request: SourceInput,
178	    response: KnowledgeSource,
179	  },
180	  updateSource: {
181	    method: 'PATCH',
182	    path: '/api/v1/knowledge/sources/:id',
183	    auth: 'user',
184	    request: SourceInput.partial(),
185	    response: KnowledgeSource,
186	  },
187	  deleteSource: {
188	    method: 'DELETE',
189	    path: '/api/v1/knowledge/sources/:id',
190	    auth: 'user',
191	    response: OkResponse,
192	  },
193	  crawlSource: {
194	    method: 'POST',
195	    path: '/api/v1/knowledge/sources/:id/crawl',
196	    auth: 'user',
197	    response: CrawlStartResponse,
198	  },
199	  crawlStatus: {
200	    method: 'GET',
201	    path: '/api/v1/knowledge/sources/:id/crawl',
202	    auth: 'user',
203	    response: CrawlStatusResponse,
204	  },
205	  refreshSchedule: {
206	    method: 'GET',
207	    path: '/api/v1/knowledge/refresh-schedule',
208	    auth: 'user',
209	    response: RefreshScheduleResponse,
210	  },
211	  listUploads: {
212	    method: 'GET',
213	    path: '/api/v1/knowledge/uploads',
214	    auth: 'user',
215	    response: UploadsResponse,
216	  },
217	  createUpload: {
218	    method: 'POST',
219	    path: '/api/v1/knowledge/uploads',
220	    auth: 'user',
221	    response: CreateUploadResponse,
222	    kind: 'binary',
223	  },
224	  deleteUpload: {
225	    method: 'DELETE',
226	    path: '/api/v1/knowledge/uploads/:id',
227	    auth: 'user',
228	    response: DeleteUploadResponse,
229	  },
230	  reindex: {
231	    method: 'POST',
232	    path: '/api/v1/knowledge/reindex',
233	    auth: 'org-admin',
234	    response: ReindexResponse,
235	  },
236	  indexStatus: {
237	    method: 'GET',
238	    path: '/api/v1/knowledge/index-status',
239	    auth: 'org-admin',
240	    response: IndexStatus,
241	  },
242	} as const satisfies DomainDescriptorMap;
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

 succeeded in 852ms:
## Exploration: jobs route handleBuildCreate parseBody shared jobs contract BuildCreateInput knowledgeDocs

Found 220 symbols across 70 files.

### Blast radius — what depends on these (update/verify before editing)

- `BuildCreateInput` (api/src/agents/build.ts:59) — 7 callers in `api/src/agents/build.ts`; tests: `api/tests/agents/build.test.ts`
- `handleBuildCreate` (api/src/agents/build.ts:90) — 1 caller; tests: `api/tests/agents/build.test.ts`
- `parseBody` (api/src/routes/helpers.ts:25) — 38 callers in `api/src/routes/settings.ts`, `api/src/routes/billing.ts`, `api/src/routes/pipedream.ts`, `api/src/routes/triggers.ts` +14 more; ⚠️ no covering tests found
- `parseBody` (api/src/bridge/provider.ts:107) — 1 caller in `api/src/bridge/provider.ts`; ⚠️ no covering tests found

### Relationships

**references:**
- BuildCreateInput → Actor
- handleBuildCreate → BuildCreateInput
- handleBuildCreate → BuildCreateResult
- createProviderHandler → ProviderDeps
- createProviderHandler → ProviderHandler
- createProviderHandler → ResolvedPairing
- Select → SelectProps
- Textarea → TextareaProps
- SearchInput → SearchInputProps
- parseBody → S
- ... and 137 more

**calls:**
- handleBuildCreate → handleFollowUp
- handleBuildCreate → handleFirstBuild
- handleFollowUp → hasLiveJobForArtifact
- handleFollowUp → nonTerminalJobForArtifact
- handleFollowUp → registerRun
- parseBody → sendError
- createProviderHandler → parseBody
- createProviderHandler → errorFrame
- createProviderHandler → withSessionIdentity
- attachBridgeServer → createProviderHandler
- ... and 271 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/agents/build.ts — now(calls), BuildCreateInput(references), BuildCreateResult(references), removeRun(calls), registerRun(calls), JobRecord(references), persistJob(calls), auditBuild(calls), jobView(calls), executeBuildJob(calls), +17 more

```typescript
46	/** Registo (F3): build lifecycle rows, metadata-only (ids/codes — NEVER the request description
47	 *  or any prompt text). The single audit write path (FIXED-8); best-effort so bookkeeping never
48	 *  fails a build. `type` is created | completed | failed | cancelled. */
49	function auditBuild(input: BuildCreateInput, type: string, metadata: Record<string, unknown>): void {
50	  void logActivity(
51	    { userId: input.actor.userId, username: input.username, orgId: input.actor.orgId },
52	    'build',
53	    type,
54	    input.deps,
55	    metadata,
56	  ).catch(() => undefined);
57	}
58	
59	export interface BuildCreateInput {
60	  actor: Actor;
61	  username: string;
62	  sessionId: string;
63	  description: string;
64	  language: string;
65	  templateId?: string;
66	  integrationKeys?: string[];
67	  artifactId?: string;
68	  attachments?: unknown[];
69	  fieldValues?: Record<string, unknown>;
70	  configValues?: Record<string, unknown>;
71	  /** F1 knowledge-during-build: scoping-provided reference documents to ingest into the org
72	   *  knowledge area DURING a domain-heavy first build (org-scoped by the run's actor, immediately
73	   *  searchable to the run's knowledge tools). Additive + optional; populated by the scoping UI +
74	   *  jobs route in a later slice, exercised directly by the build tests here. */
75	  knowledgeDocs?: Array<{ title: string; text: string; collection?: string }>;
76	  deps: { now: () => number; genId: () => string };
77	}
78	
79	export type BuildCreateResult =
80	  | { status: 'created'; job: ReturnType<typeof jobView>; fire: () => void }
81	  | { status: 'answered'; reason: string }
82	  | { status: 'conflict' };
83	
84	/**
85	 * Handle `POST /jobs` (build) up to the response (§5.6.2). First builds reserve synchronously and
86	 * respond `created`; follow-ups run the in-build classifier and may respond `answered` with no
87	 * job. A concurrent follow-up on the same artifact is `conflict` → the route returns 409
88	 * DUPLICATE_BUILD.
89	 */
90	export async function handleBuildCreate(input: BuildCreateInput): Promise<BuildCreateResult> {
91	  return input.artifactId ? handleFollowUp(input, input.artifactId) : handleFirstBuild(input);
92	}
93	
94	// --- First build -------------------------------------------------------------------------
95	
96	async function handleFirstBuild(input: BuildCreateInput): Promise<BuildCreateResult> {
97	  // Reserve synchronously BEFORE any async work (§5.3.3). A live reservation binds the second
98	  // POST to the running job and returns it (the build_intent broadcast reaches every open tab).
99	  const reservation = reserveFirstBuild(input.sessionId, input.deps.now());
100	  if (!reservation.ok) {
101	    // Bound to the existing job — return it as `created` pointing at the running job.
102	    const existingId = reservation.jobId;
103	    return {
104	      status: 'created',
105	      job: { id: existingId, status: 'running', createdAt: new Date(input.deps.now()).toISOString() },
106	      fire: () => {},
107	    };
108	  }
109	
110	  const jobId = input.deps.genId();
111	  bindReservation(input.sessionId, jobId);
112	  const abort = new AbortController();
113	  registerRun({
114	    id: jobId,
115	    ownerUserId: input.actor.userId,
116	    orgId: input.actor.orgId,
117	    kind: 'build',
118	    abort,
119	    startedAt: input.deps.now(),
120	    sessionId: input.sessionId,
121	  });
122	
123	  const record: JobRecord = {
124	    _id: jobId,
125	    kind: 'build',
126	    status: 'created',
127	    userId: input.actor.userId,
128	    sessionId: input.sessionId,
129	    request: {
130	      description: input.description,
131	      language: input.language,
132	      ...(input.templateId ? { templateId: input.templateId } : {}),
133	      ...(input.integrationKeys ? { integrationKeys: input.integrationKeys } : {}),
134	      ...(input.fieldValues ? { fieldValues: input.fieldValues } : {}),
135	      ...(input.configValues ? { configValues: input.configValues } : {}),
136	    },
137	    createdAt: new Date(input.deps.now()).toISOString(),
138	  };
139	  // Persist BEFORE responding so `GET /jobs/:id` finds the record as soon as the 202 returns
140	  // ("respond early once the record exists", §5.2 step 2).
141	  await persistJob(record);
142	  auditBuild(input, 'created', { jobId }); // Registo (F3)
143	
144	  return {
145	    status: 'created',
146	    job: jobView(record),
147	    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: true }),
148	  };
149	}
150	
151	// --- Follow-up ---------------------------------------------------------------------------
152	
153	async function handleFollowUp(input: BuildCreateInput, artifactId: string): Promise<BuildCreateResult> {
154	  // One follow-up build per artifact (§5.3.5): reject a concurrent build targeting the same
155	  // artifact — two would resume the same SDK transcript and corrupt it.
156	  if (hasLiveJobForArtifact(artifactId) || (await nonTerminalJobForArtifact(artifactId))) {
157	    return { status: 'conflict' };
158	  }
159	
160	  const jobId = input.deps.genId();
161	  const abort = new AbortController();
162	  registerRun({
163	    id: jobId,
164	    ownerUserId: input.actor.userId,
165	    orgId: input.actor.orgId,
166	    kind: 'build',
167	    abort,
168	    startedAt: input.deps.now(),
169	    artifactId,
170	    sessionId: input.sessionId,
171	  });
172	
173	  // In-build message classifier BEFORE any build work, under the abort rules of §5.3.2.
174	  let intent: Awaited<ReturnType<typeof classifyInBuildIntent>>;
175	  try {
176	    intent = await classifyInBuildIntent(input.description, input.actor.userId, abort.signal);
177	  } catch (err) {
178	    removeRun(jobId);
179	    if (err instanceof LlmAbortedError) {
180	      // Abort NEVER falls through to a build (§5.3.2): zero jobs created, zero side effects.
181	      return { status: 'answered', reason: 'Execução cancelada.' };
182	    }
183	    // Non-abort classifier failure is non-fatal and defaults to proceeding (§5.6.2) — handled by
184	    // classifyInBuildIntent's own fallback, so reaching here is an unexpected error: answer safely.
185	    return { status: 'answered', reason: 'Não foi possível processar o pedido.' };
186	  }
187	
188	  if (intent === 'integration-build') {
189	    emitIntegrationBuildIntent(input.actor.userId, { sessionId: input.sessionId });
190	    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'Vou ligar essa integração primeiro.' });
191	    removeRun(jobId);
192	    return { status: 'answered', reason: 'integration-build' };
193	  }
194	  if (intent === 'question') {
195	    // In-build answer flow (cheap tier), delivered as chat_answer; no job (§5.6.2).
196	    emitChatAnswer(input.actor.userId, { sessionId: input.sessionId, sourceRunId: jobId, text: 'A aplicação está a ser construída; posso ajudar com isso.' });
197	    removeRun(jobId);
198	    return { status: 'answered', reason: 'question' };
199	  }
200	
201	  // modification → proceed with the build. projectDir resolved server-side from the artifact.
202	  const record: JobRecord = {
203	    _id: jobId,
204	    kind: 'build',
205	    status: 'created',
206	    userId: input.actor.userId,
207	    sessionId: input.sessionId,
208	    artifactId,
209	    request: { description: input.description, language: input.language },
210	    createdAt: new Date(input.deps.now()).toISOString(),
211	  };
212	  await persistJob(record);
213	  auditBuild(input, 'created', { jobId, artifactId }); // Registo (F3)
214	  return {
215	    status: 'created',
216	    job: jobView(record),
217	    fire: () => void executeBuildJob(jobId, input, abort, { firstBuild: false, artifactId }),
218	  };
219	}
220	
221	// --- Execution ---------------------------------------------------------------------------
222	
```

#### api/src/bridge/provider.ts — parseBody(function), createProviderHandler(function), errorFrame(function), withSessionIdentity(function), ProviderDeps(interface), ProviderHandler(interface), ResolvedPairing(interface), ProviderResponseFrame(type_alias)

```typescript
1	/**
2	 * bridge/provider.ts — the Anthropic-compatible provider endpoint for bridge traffic (ch18 §18.4).
3	 * The local Pi loop reasons on the user's machine but has no model of its own; it emits
4	 * `provider_request` frames and Cortex serves the completion. This face exists ONLY for bridge
5	 * traffic and routes EVERY completion through the one LLM chokepoint (`api/src/llm/`, FIXED-13) —
6	 * anonymisation, attribution (`user_work`, billed to the delegating user), and metering all happen
7	 * there, on the single egress path, with no bypass. This module imports the chokepoint's PUBLIC
8	 * entry only (`proxyGatewayMessages`); it never imports the provider SDK directly.
9	 *
10	 * The cross-org guard (§18.4.4) is checked server-side, per request, BEFORE any model call, as a
11	 * chain: `provider credential -> pairing -> org`. The credential resolves to exactly one LIVE,
12	 * non-revoked pairing; the pairing resolves to exactly one org (from the registry, never a request
13	 * body); the conversation id the request carries must belong to that org. Because org is derived
14	 * from the pairing and not the request, a credential for org A can never address org B's vault —
15	 * there is no request field that would let it name one. Activation admission joins the chain: a
16	 * deactivated / billing-locked owner is refused before any model call (§18.3.2, §18.4.4).
17	 */
18	import type { BridgeFrame } from '@ekoa/shared';
19	import { proxyGatewayMessages } from '../llm/index.js';
20	import { getActivation as defaultGetActivation } from '../data/activation.js';
21	import { sessions, users } from '../data/stores.js';
22	import { readBridgeToken, BridgeAuthError } from './token.js';
23	import { getPairingById, isLive } from './registry.js';
24	
25	type ProviderRequestFrame = Extract<BridgeFrame, { type: 'provider_request' }>;
26	type ProviderResponseFrame = Extract<BridgeFrame, { type: 'provider_response' }>;
27	
28	/** The pairing a provider credential resolves to (§18.4.4). */
29	export interface ResolvedPairing {
30	  pairingId: string;
31	  org: string;
32	  ownerUserId: string;
33	}
34	
35	export interface ProviderDeps {
36	  /** credential -> exactly one LIVE, non-revoked pairing (§18.4.4 step 1). Throws to reject. */
37	  resolvePairingByCredential?: (credential: string) => Promise<ResolvedPairing>;
38	  /** conversation id -> its owning org (§18.4.4 step 3). Undefined => unknown session (rejected). */
39	  resolveSessionOrg?: (sessionId: string) => Promise<string | undefined>;
40	  /** The chokepoint completion. Default: the llm/ gateway pass-through (anonymise + attribute +
41	   *  meter; FIXED-13). The `correlationId` is recorded on the hosted anon-audit so it joins the
42	   *  daemon's egress-ledger row (§18.5 S6). Injected as a fake in tests. */
43	  runCompletion?: (reqBody: Record<string, unknown>, billeeUserId: string, correlationId: string) => Promise<{ status: number; body: string }>;
44	  getActivation?: (userId: string) => { active: boolean; billingLocked: boolean } | undefined;
45	}
46	
47	export interface ProviderOutcome {
48	  /** The frame to send back to the daemon (always a `provider_response`, correlated by id). */
49	  frame: ProviderResponseFrame;
50	  /** false when the request was rejected before any model call (auth/cross-org/activation). */
51	  ok: boolean;
52	  /** Stable reason for server-side audit/logging on a rejection. */
53	  reason?: string;
54	}
55	
56	export interface ProviderHandler {
57	  /** `senderPairingId` is the pairing of the LIVE socket the frame arrived on (§18.4.4): the
58	   *  credential must resolve to THAT pairing, so a credential cannot be replayed from another
59	   *  socket to address a different pairing's org/vault. */
60	  handle(frame: ProviderRequestFrame, senderPairingId: string): Promise<ProviderOutcome>;
61	}
62	
63	/** Default credential resolution (§18.4.4 step 1). The pairing-bound provider credential is the
64	 *  bridge-token class ({org, pairing} scoping): it names its pairing, which the registry resolves
65	 *  to its org — the request never asserts its own org. A credential that does not verify, or
66	 *  resolves to no live / a revoked pairing, is rejected. */
67	async function defaultResolvePairingByCredential(credential: string): Promise<ResolvedPairing> {
68	  let pairingId: string;
69	  try {
70	    pairingId = readBridgeToken(credential).pairingId;
71	  } catch {
72	    throw new BridgeAuthError('invalid-credential', 'provider credential did not verify');
73	  }
74	  const row = await getPairingById(pairingId);
75	  if (!row || row.revokedAt !== null || !isLive(pairingId)) {
76	    throw new BridgeAuthError('no-live-pairing', 'credential resolves to no live, non-revoked pairing');
77	  }
78	  return { pairingId: row.pairingId, org: row.org, ownerUserId: row.ownerUserId };
79	}
80	
81	/** Default conversation -> org resolution (§18.4.4 step 3): the session's user's org. */
82	async function defaultResolveSessionOrg(sessionId: string): Promise<string | undefined> {
83	  const s = (await sessions.get(sessionId)) as { userId?: string } | null;
84	  if (!s?.userId) return undefined;
85	  const u = (await users.get(s.userId)) as { orgId?: string } | null;
86	  return u?.orgId ?? undefined;
87	}
88	
89	/** Build an Anthropic-style error response frame, correlated so the daemon's pending request
90	 *  resolves. `errorType` carries the CONV-2 code for activation refusals (§18.4.4). */
91	function errorFrame(correlationId: string, errorType: string, message: string): ProviderResponseFrame {
92	  return { type: 'provider_response', correlationId, body: { type: 'error', error: { type: errorType, message } } };
93	}
94	
95	/** Set the propagated conversation id on the request metadata so the chokepoint keys the
96	 *  anonymisation vault by {org, session} (§18.4.3, §17.5). */
97	function withSessionIdentity(body: unknown, session: string): Record<string, unknown> {
98	  const obj = body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {};
99	  const meta = obj.metadata && typeof obj.metadata === 'object' ? { ...(obj.metadata as Record<string, unknown>) } : {};
100	  meta.session_id = session;
101	  obj.metadata = meta;
102	  return obj;
103	}
104	
105	/** Parse a provider body string to an object when possible (the frame body is `unknown`; the daemon
106	 *  gets a JSON object), else pass the raw string through. */
107	function parseBody(body: string): unknown {
108	  try {
109	    return JSON.parse(body);
110	  } catch {
111	    return body;
112	  }
113	}
114	
115	/**
116	 * Build the provider-request handler. The composition root wires the default deps (real chokepoint
117	 * + real registry + real session resolution); tests inject fakes to exercise the auth chain without
118	 * a model.
119	 */
120	export function createProviderHandler(deps: ProviderDeps = {}): ProviderHandler {
121	  const resolvePairing = deps.resolvePairingByCredential ?? defaultResolvePairingByCredential;
122	  const resolveSessionOrg = deps.resolveSessionOrg ?? defaultResolveSessionOrg;
123	  const runCompletion = deps.runCompletion ?? proxyGatewayMessages;
124	  const getActivation = deps.getActivation ?? defaultGetActivation;
125	
126	  return {
127	    async handle(frame: ProviderRequestFrame, senderPairingId: string): Promise<ProviderOutcome> {
128	      const { correlationId, session, credential, body } = frame;
129	
130	      // 1. credential -> live, non-revoked pairing (§18.4.4 step 1).
131	      let pairing: ResolvedPairing;
132	      try {
133	        pairing = await resolvePairing(credential);
134	      } catch {
135	        return { frame: errorFrame(correlationId, 'authentication_error', 'no live pairing for credential'), ok: false, reason: 'no-live-pairing' };
136	      }
137	
138	      // Bind the credential to the SENDING socket (§18.4.4): the credential must resolve to the
139	      // pairing whose live socket this frame arrived on. Otherwise a daemon could present a
140	      // credential minted for a different pairing (another org's) over its own socket and address
141	      // that org's session/vault - the socket auth would say pairing A while the credential names B.
142	      if (pairing.pairingId !== senderPairingId) {
143	        return { frame: errorFrame(correlationId, 'permission_error', 'credential does not match this connection'), ok: false, reason: 'credential-socket-mismatch' };
144	      }
145	
146	      // Activation admission BEFORE any model call (§18.3.2, §18.4.4). Fail closed on a cache miss.
147	      const act = getActivation(pairing.ownerUserId);
148	      if (!act || !act.active) {
149	        return { frame: errorFrame(correlationId, 'ACCOUNT_DISABLED', 'A sua conta está bloqueada. Contacte o suporte.'), ok: false, reason: 'ACCOUNT_DISABLED' };
150	      }
151	      if (act.billingLocked) {
152	        return { frame: errorFrame(correlationId, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.'), ok: false, reason: 'BILLING_LOCKED' };
153	      }
154	
155	      // 2 + 3. pairing -> org (registry), and the conversation must belong to that org — checked
156	      // BEFORE any model call (§18.4.4). org is derived from the pairing, never the request body,
157	      // so a credential for org A can never name org B's vault.
158	      const sessionOrg = await resolveSessionOrg(session);
159	      if (!sessionOrg || sessionOrg !== pairing.org) {
160	        return { frame: errorFrame(correlationId, 'permission_error', 'conversation does not belong to this pairing org'), ok: false, reason: 'cross-org-session' };
161	      }
162	
163	      // Route through the chokepoint: session-identity propagation + attribution to the delegating
164	      // user + metering all happen inside llm/ (FIXED-13). Only the de-tokenized completion returns.
165	      // The daemon's per-request correlationId is recorded on the hosted anon-audit (§18.5 S6), so
166	      // the audit entry and the daemon's egress-ledger row share ONE join key (§18.8 criterion 5).
167	      const reqBody = withSessionIdentity(body, session);
168	      const forward = await runCompletion(reqBody, pairing.ownerUserId, correlationId);
169	      return { frame: { type: 'provider_response', correlationId, body: parseBody(forward.body) }, ok: forward.status >= 200 && forward.status < 300 };
170	    },
171	  };
172	}
```

#### api/src/routes/helpers.ts — parseBody(function), sendError(function), actorOf(function), notFound(function)

```typescript
1	/**
2	 * Thin-route helpers (ch02 §2.6): actor extraction from the verified JWT, uniform error
3	 * shaping (CONV-2), and zod request validation. Routers do exactly three things: validate,
4	 * call one domain module, shape the response.
5	 */
6	import type { Response } from 'express';
7	import type { ZodTypeAny, infer as zInfer } from 'zod';
8	import { ERROR_STATUS, type ErrorCode, type Actor } from '@ekoa/shared';
9	import type { AuthedRequest } from '../auth/middleware.js';
10	
11	export function actorOf(req: AuthedRequest): Actor {
12	  const u = req.user!;
13	  return { userId: u.sub, orgId: u.orgId, role: u.role };
14	}
15	
16	export function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
17	  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
18	}
19	
20	export function notFound(res: Response): void {
21	  sendError(res, 'NOT_FOUND', 'Não encontrado.');
22	}
23	
24	/** Validate req.body against a schema; on failure send 400 and return undefined. */
25	export function parseBody<S extends ZodTypeAny>(res: Response, schema: S, body: unknown): zInfer<S> | undefined {
26	  const parsed = schema.safeParse(body);
27	  if (!parsed.success) {
28	    sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
29	    return undefined;
30	  }
31	  return parsed.data as zInfer<S>;
32	}
```

#### web/components/ui/input.tsx — Input(function), Input(constant)

```tsx
1	'use client';
2	import React from 'react';
3	import type { LucideIcon } from 'lucide-react';
4	import { fieldClasses, labelClasses, hintClasses, errorTextClasses, useFieldId } from './field';
5	
6	export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
7	  label?: string;
8	  hint?: string;
9	  error?: string;
10	  leftIcon?: LucideIcon;
11	  wrapperClassName?: string;
12	}
13	
14	export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
15	  { label, hint, error, leftIcon: LeftIcon, className, wrapperClassName, id, ...rest },
16	  ref,
17	) {
18	  const inputId = useFieldId(label, id);
19	  const describedById = `${inputId}-desc`;
20	  const hasDescription = Boolean(error || hint);
21	  return (
22	    <div className={wrapperClassName}>
23	      {label && (
24	        <label htmlFor={inputId} className={labelClasses}>
25	          {label}
26	        </label>
27	      )}
28	      <div className="relative">
29	        {LeftIcon && (
30	          <LeftIcon
31	            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
32	            aria-hidden
33	          />
34	        )}
35	        <input
36	          ref={ref}
37	          id={inputId}
38	          aria-invalid={error ? true : undefined}
39	          aria-describedby={hasDescription ? describedById : undefined}
40	          className={`${fieldClasses(!!error)} ${LeftIcon ? 'pl-9' : ''} ${className ?? ''}`}
41	          {...rest}
42	        />
43	      </div>
44	      {error && (
45	        <p id={describedById} className={errorTextClasses}>
46	          {error}
47	        </p>
48	      )}
49	      {hint && !error && (
50	        <p id={describedById} className={hintClasses}>
51	          {hint}
52	        </p>
53	      )}
54	    </div>
55	  );
56	});
```

#### shared/src/knowledge.ts — KnowledgeDocSummary(type_alias)

```typescript
17	    updatedAt: IsoTimestamp.optional(),
18	  })
19	  .passthrough();
20	export type KnowledgeDocSummary = z.infer<typeof KnowledgeDocSummary>;
21	
22	export const KnowledgeSource = z
23	  .object({
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

 succeeded in 892ms:
## Exploration: search(orgId query limit) SHARED_ORG_ID listDocuments CreateDocumentInput knowledge service

Found 142 symbols across 55 files.

### Blast radius — what depends on these (update/verify before editing)

- `listDocuments` (api/src/knowledge/service.ts:203) — 4 callers in `api/src/routes/knowledge.ts`; tests: `api/tests/knowledge/service.test.ts`, `api/tests/knowledge/build-knowledge-ingest.test.ts`
- `CreateDocumentInput` (api/src/knowledge/service.ts:149) — 2 callers in `api/src/knowledge/index.ts`, `api/src/knowledge/service.ts`; ⚠️ no covering tests found
- `search` (api/src/knowledge/index-store.ts:237) — 7 callers in `web/app/(dashboard)/integrations/page.tsx`, `web/app/(dashboard)/settings/branding/page.tsx`, `api/src/knowledge/index.ts`; tests: `api/tests/knowledge/importer.test.ts`, `api/tests/knowledge/index-store.test.ts`, `api/tests/knowledge/service.test.ts`, `api/tests/knowledge/build-knowledge-ingest.test.ts`
- `SearchInputProps` (web/components/ui/search-input.tsx:7) — 1 caller in `web/components/ui/search-input.tsx`; ⚠️ no covering tests found

### Relationships

**calls:**
- listDocuments → toSummary
- knowledgeRouter → listDocuments
- ingestDocument → assertNotSharedActor
- ingestDocument → now
- search → toMatchQuery
- search → connect
- search → collectionAuthority
- connect → indexDbPath
- connect → healDocMap
- bulkIndexDocs → connect
- ... and 155 more

**references:**
- ingestDocument → CreateDocumentInput
- search → SearchHit
- makeDeps → SearchHit
- hit → SearchHit
- bulkIndexDocs → IndexRow
- orgStatus → IndexStatus
- makeDeps → Captured
- SearchInput → SearchInputProps
- Captured → OneShotOptions
- Captured → LlmAttribution
- ... and 35 more

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### api/src/knowledge/index-store.ts — connect(calls), get(calls), IndexRow(interface), SearchHit(interface), collectionAuthority(function), search(function), SearchHit(references), toMatchQuery(calls), collectionAuthority(calls), IndexStatus(interface), +5 more

```typescript
23	import { existsSync, mkdirSync } from 'node:fs';
24	import { indexDbPath, SHARED_ORG_ID } from './paths.js';
25	
26	export interface IndexRow {
27	  orgId: string;
28	  collection: string;
29	  docId: string;
30	  title: string;
31	  body: string;
32	  createdAt?: string;
33	  sourceUrl?: string;
34	  sourceType?: string;
35	  language?: string;
36	}
37	
38	export interface SearchHit {
39	  docId: string;
40	  collection: string;
41	  title: string;
42	  sourceUrl?: string;
43	  snippet: string;
44	  score: number;
45	  /** Which partition the hit came from: the caller's own vault, or the shared corpus. The row's
46	   *  orgId itself never surfaces on a hit (a caller must not learn the shared id or its own). */
47	  scope: 'org' | 'shared';
48	}
49	
50	/** Collection-authority weight: a firm's authoritative legal collections outrank incidental
51	 *  matches on an otherwise-equal BM25 score. Deterministic, keyword-based, default 1.0. */
52	export function collectionAuthority(collection: string): number {
53	  const c = collection.toLowerCase();
54	  if (c.includes('spine') || c.includes('espinha')) return 1.5;
55	  if (c.includes('legal') || c.includes('shared') || c.includes('jurisprud')) return 1.25;
56	  return 1.0;
57	}
58	
59	// Portuguese + English stopwords: dropped from the MATCH query so grounding never triggers on
60	// grammatical filler ("de", "the"). Small and deterministic.

... (gap) ...

234	 * partition the two ids collapse to one (no duplicate scope). Each hit carries `scope` derived from
235	 * its row's orgId; the orgId itself never surfaces.
236	 */
237	export function search(orgId: string, query: string, limit = 5): SearchHit[] {
238	  const match = toMatchQuery(query);
239	  if (!match) return [];
240	  const d = connect();
241	  // The caller's partition + the shared corpus. `IN (?, ?)` with equal ids when the caller is the
242	  // shared partition collapses to a single-partition scan with no duplicate rows.
243	  const shared = orgId === SHARED_ORG_ID ? orgId : SHARED_ORG_ID;
244	  // Over-fetch so the authority re-rank has candidates, then trim to `limit`.
245	  const rows = d
246	    .prepare(
247	      // bm25 weights are positional over EVERY column (incl. UNINDEXED): only title (col 3) and
248	      // body (col 4) carry weight; title is up-weighted so a title hit outranks a body-only hit.
249	      // Adding orgId to the SELECT does not shift the weights — bm25 is keyed on table columns.
250	      `SELECT orgId, docId, collection, title, sourceUrl,
251	              snippet(knowledge_fts, -1, '', '', ' … ', 12) AS snip,
252	              bm25(knowledge_fts, 0.0, 0.0, 0.0, 10.0, 1.0, 0.0, 0.0, 0.0, 0.0) AS score
253	       FROM knowledge_fts
254	       WHERE knowledge_fts MATCH ? AND orgId IN (?, ?)
255	       ORDER BY score
256	       LIMIT ?`,
257	    )
258	    .all(match, orgId, shared, Math.max(limit * 4, limit)) as RawHit[];
259	  // bm25 is smaller-is-better (negative); relevance = -score, then scale by authority.
260	  const ranked = rows
261	    .map((r) => ({
262	      docId: r.docId,
263	      collection: r.collection,
264	      title: r.title,
265	      sourceUrl: r.sourceUrl || undefined,
266	      snippet: r.snip,
267	      score: -r.score * collectionAuthority(r.collection),
268	      scope: (r.orgId === SHARED_ORG_ID ? 'shared' : 'org') as 'org' | 'shared',
269	    }))
270	    .sort((a, b) => b.score - a.score);
271	  return ranked.slice(0, limit);
272	}
273	
274	export interface IndexStatus {
275	  documentCount: number;
276	  collectionCount: number;
277	}
278	
279	/** Per-org index counts (org-admin heal surface). */
280	export function orgStatus(orgId: string): IndexStatus {
281	  const row = connect()
282	    .prepare('SELECT COUNT(*) AS documentCount, COUNT(DISTINCT collection) AS collectionCount FROM knowledge_fts WHERE orgId = ?')
283	    .get(orgId) as { documentCount: number; collectionCount: number };
284	  return { documentCount: row.documentCount, collectionCount: row.collectionCount };
285	}
286	
287	/** Total rows across all orgs (backfill emptiness check). */
288	export function totalRows(): number {
289	  return (connect().prepare('SELECT COUNT(*) AS n FROM knowledge_fts').get() as { n: number }).n;
290	}
291	
292	/** Ensure the index directory exists (used by boot before a scan writes rows). */
293	export async function ensureIndexDir(): Promise<void> {
294	  await mkdir(dirname(indexDbPath()), { recursive: true });
295	}
296	
297	/** Close the DB handle (tests; graceful shutdown). Safe to call when never opened. */
298	export function closeIndex(): void {
```

#### api/src/knowledge/service.ts — Actor(references), references(references), KnowledgeError(instantiates), calls(calls), Deps(references), getVisibleSource(calls), Deps(interface), KnowledgeError(class), assertNotSharedActor(function), sourceView(function), +15 more

```typescript
43	  createdAt?: string;
44	}
45	
46	export interface Deps { now: () => number; genId: () => string }
47	
48	export class KnowledgeError extends Error {
49	  constructor(public code: string, public status: number, message: string) {
50	    super(message);
51	  }
52	}
53	
54	/**
55	 * Tenancy guard for the reserved shared partition (ch04 §4.4.1). The `_shared` corpus is a
56	 * read-only public legal spine, written ONLY by the offline importer CLI. No real actor is ever
57	 * assigned this org id (UUIDs never collide with it), so this is a structural invariant, not a
58	 * user-facing permission: any request actor presenting the shared org id is refused before it can
59	 * mutate the corpus through the service.
60	 */
61	function assertNotSharedActor(actor: Actor): void {
62	  if (actor.orgId === SHARED_ORG_ID) {
63	    throw new KnowledgeError('FORBIDDEN', 403, 'A coleção partilhada é só de leitura.');
64	  }
65	}
66	
67	// --- Sources (G4, unchanged) ---------------------------------------------------------------
68	
69	/**
70	 * Aligned to the shared `KnowledgeSource` contract (F5): the store's `kind`/`seedId` surface under
71	 * the contract's names `type`/`seedTemplate`, and `collection`/`enabled`/`lastCrawledAt` are
72	 * emitted so a client that validates the response does not reject it. `enabled` defaults to true —
73	 * a source with no explicit flag has always been crawled/considered, so `true` is the honest read.
74	 */
75	export function sourceView(s: KnowledgeSourceDoc) {
76	  return {
77	    id: s._id,
78	    url: s.url,
79	    type: s.kind,
80	    collection: s.collection,
81	    seedTemplate: s.seedId ?? null,
82	    enabled: s.enabled ?? true,
83	    ...(s.lastCrawledAt ? { lastCrawledAt: s.lastCrawledAt } : {}),
84	  };
85	}
86	
87	export async function listSources(actor: Actor): Promise<KnowledgeSourceDoc[]> {
88	  return knowledgeSources.find({ orgId: actor.orgId }) as Promise<KnowledgeSourceDoc[]>;
89	}
90	
91	export async function addSource(actor: Actor, input: { url: string; kind?: string; seedId?: string }, deps: Deps): Promise<KnowledgeSourceDoc> {
92	  // SSRF-validate the user-supplied URL at write time (ch09 invariant 8).
93	  try {
94	    assertSafeUrl(input.url);
95	  } catch (e) {
96	    if (e instanceof SsrfError) throw new KnowledgeError('VALIDATION_FAILED', 400, 'URL não permitido.');
97	    throw e;
98	  }
99	  const id = deps.genId();
100	  const doc: KnowledgeSourceDoc = { _id: id, orgId: actor.orgId, url: input.url, kind: input.kind, seedId: input.seedId };
101	  await knowledgeSources.insert(doc as never);
102	  return doc;
103	}
104	
105	export async function getVisibleSource(actor: Actor, id: string): Promise<KnowledgeSourceDoc | null> {
106	  const s = (await knowledgeSources.get(id)) as KnowledgeSourceDoc | null;
107	  if (!s || s.orgId !== actor.orgId) return null; // cross-org → uniform 404
108	  return s;
109	}
110	
111	/**
112	 * Patch a source (F5). Cross-org reads as not-found (uniform 404) before any write. The contract's
113	 * `type`/`seedTemplate` names are mapped back onto the store's `kind`/`seedId`. A changed `url` is
114	 * SSRF-validated exactly as `addSource` does — a patch must not be a bypass of that gate.
115	 */
116	export async function updateSource(
117	  actor: Actor,
118	  id: string,
119	  patch: { url?: string; type?: string; collection?: string; seedTemplate?: string | null; enabled?: boolean },
120	): Promise<KnowledgeSourceDoc | null> {
121	  const s = await getVisibleSource(actor, id);
122	  if (!s) return null;
123	  if (patch.url !== undefined) {
124	    try {
125	      assertSafeUrl(patch.url);
126	    } catch (e) {
127	      if (e instanceof SsrfError) throw new KnowledgeError('VALIDATION_FAILED', 400, 'URL não permitido.');
128	      throw e;
129	    }
130	  }
131	  const next: Partial<KnowledgeSourceDoc> = {
132	    ...(patch.url !== undefined ? { url: patch.url } : {}),
133	    ...(patch.type !== undefined ? { kind: patch.type } : {}),
134	    ...(patch.collection !== undefined ? { collection: patch.collection } : {}),
135	    ...(patch.seedTemplate !== undefined ? { seedId: patch.seedTemplate ?? undefined } : {}),
136	    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
137	  };
138	  return (await knowledgeSources.update(id, (cur) => ({ ...cur, ...next } as never))) as unknown as KnowledgeSourceDoc | null;
139	}
140	
141	export async function deleteSource(actor: Actor, id: string): Promise<boolean> {
142	  const s = await getVisibleSource(actor, id);
143	  if (!s) return false;
144	  return knowledgeSources.delete(id);
145	}
146	
147	// --- Vault documents (this slice) -----------------------------------------------------------
148	
149	export interface CreateDocumentInput {
150	  collection: string;
151	  title: string;
152	  text: string;
153	  sourceUrl?: string;
154	  sourceType?: string;
155	  language?: string;
156	}
157	
158	function toSummary(d: vault.VaultDoc, now?: string) {
159	  return {
160	    id: d.docId,
161	    collection: d.collection,
162	    title: d.title,
163	    sourceUrl: d.sourceUrl,
164	    sourceType: d.sourceType,
165	    language: d.language,
166	    size: d.size,
167	    createdAt: d.createdAt || now,
168	  };
169	}
170	
171	/** Ingest a document: write the vault file, then run the index write hook. Returns the id. */
172	export async function ingestDocument(actor: Actor, input: CreateDocumentInput, deps: Deps): Promise<{ id: string }> {
173	  assertNotSharedActor(actor);
174	  const docId = deps.genId();
175	  const createdAt = new Date(deps.now()).toISOString();
176	  const fm: vault.DocFrontmatter = {
177	    title: input.title,
178	    sourceUrl: input.sourceUrl,
179	    sourceType: input.sourceType,
180	    language: input.language,
181	    createdAt,
182	  };
183	  try {
184	    await vault.writeDoc(actor.orgId, input.collection, docId, fm, input.text);
185	  } catch (e) {
186	    if (e instanceof PathSafetyError) throw new KnowledgeError('VALIDATION_FAILED', 400, 'Coleção inválida.');
187	    throw e;
188	  }
189	  index.indexDoc({
190	    orgId: actor.orgId,
191	    collection: input.collection,
192	    docId,
193	    title: input.title,
194	    body: input.text,
195	    createdAt,
196	    sourceUrl: input.sourceUrl,
197	    sourceType: input.sourceType,
198	    language: input.language,
199	  });
200	  return { id: docId };
201	}
202	
203	export async function listDocuments(
204	  actor: Actor,
205	  opts: { collection?: string; offset?: number; limit?: number },
206	): Promise<{ items: ReturnType<typeof toSummary>[]; total: number }> {
207	  const { items, total } = await vault.listDocs(actor.orgId, opts);
208	  return { items: items.map((d) => toSummary(d)), total };
209	}
210	
211	export async function listCollections(actor: Actor): Promise<string[]> {
212	  return vault.listCollections(actor.orgId);
```

#### shared/src/knowledge.ts — KnowledgeSource(type_alias), KnowledgeDocSummary(type_alias)

```typescript
1	/** Knowledge domain contract (ch03 §3.8.20): org-partitioned vault CRUD, sources, uploads, heal ops. */
2	import { z } from 'zod';
3	import { Id, IsoTimestamp, listResponse, itemsResponse, OkResponse, PaginationQuery, Language } from './common.js';
4	import type { DomainDescriptorMap } from './descriptor.js';
5	
6	export const KnowledgeDocSummary = z
7	  .object({
8	    id: Id,
9	    collection: z.string(),
10	    title: z.string(),
11	    sourceUrl: z.string().optional(),
12	    sourceType: z.string().optional(),
13	    language: z.string().optional(),
14	    size: z.number().int().nonnegative().optional(),
15	    chunks: z.number().int().nonnegative().optional(),
16	    createdAt: IsoTimestamp.optional(),
17	    updatedAt: IsoTimestamp.optional(),
18	  })
19	  .passthrough();
20	export type KnowledgeDocSummary = z.infer<typeof KnowledgeDocSummary>;
21	
22	export const KnowledgeSource = z
23	  .object({
24	    id: Id,
25	    url: z.string(),
26	    type: z.string().optional(),
27	    collection: z.string().optional(),
28	    seedTemplate: z.string().nullable().optional(),
29	    enabled: z.boolean().optional(),
30	    lastCrawledAt: IsoTimestamp.optional(),
31	    createdAt: IsoTimestamp.optional(),
32	    updatedAt: IsoTimestamp.optional(),
33	  })
34	  .passthrough();
35	export type KnowledgeSource = z.infer<typeof KnowledgeSource>;
36	
37	export const SourceInput = z
38	  .object({
39	    url: z.string(),
40	    type: z.string().optional(),
41	    collection: z.string().optional(),
42	    seedTemplate: z.string().nullable().optional(),
43	    enabled: z.boolean().optional(),
44	  })
45	  .passthrough();
46	export type SourceInput = z.infer<typeof SourceInput>;
47	
48	export const UploadDoc = z
49	  .object({
50	    id: Id,
51	    uploadId: z.string().optional(),
52	    filename: z.string(),
53	    collection: z.string().optional(),
54	    size: z.number().int().nonnegative().optional(),
55	    contentType: z.string().optional(),
56	    indexedAt: IsoTimestamp.optional(),
57	    createdAt: IsoTimestamp.optional(),
58	  })
59	  .passthrough();
60	export type UploadDoc = z.infer<typeof UploadDoc>;
61	
62	export const IndexStatus = z
63	  .object({
64	    status: z.string(),
65	    documentCount: z.number().int().nonnegative().optional(),
66	    collectionCount: z.number().int().nonnegative().optional(),
67	    lastIndexedAt: IsoTimestamp.optional(),
68	  })
69	  .passthrough();
70	export type IndexStatus = z.infer<typeof IndexStatus>;
71	
72	export const CollectionsResponse = itemsResponse(z.string());
73	export type CollectionsResponse = z.infer<typeof CollectionsResponse>;
74	
75	export const DocumentsQuery = PaginationQuery.extend({
76	  collection: z.string().optional(),
77	});
78	export type DocumentsQuery = z.infer<typeof DocumentsQuery>;
79	
80	export const DocumentsResponse = listResponse(KnowledgeDocSummary);
81	export type DocumentsResponse = z.infer<typeof DocumentsResponse>;
82	
83	export const CreateDocumentRequest = z.object({
84	  collection: z.string(),
85	  title: z.string(),
86	  text: z.string(),
87	  sourceUrl: z.string().optional(),
88	  sourceType: z.string().optional(),
89	  language: Language.optional(),
90	});
91	export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequest>;
92	
93	export const CreateDocumentResponse = z.object({ id: z.string() });
94	export type CreateDocumentResponse = z.infer<typeof CreateDocumentResponse>;
95	
96	export const SourcesResponse = itemsResponse(KnowledgeSource);
97	export type SourcesResponse = z.infer<typeof SourcesResponse>;
98	
99	export const CrawlStartResponse = z.object({
100	  started: z.boolean(),
101	  alreadyRunning: z.boolean(),
102	});
103	export type CrawlStartResponse = z.infer<typeof CrawlStartResponse>;
104	
105	export const CrawlStatusResponse = z
106	  .object({
107	    running: z.boolean(),
108	    progress: z.number().optional(),
109	    stats: z.record(z.unknown()).optional(),
110	  })
111	  .passthrough();
112	export type CrawlStatusResponse = z.infer<typeof CrawlStatusResponse>;
113	
114	export const RefreshScheduleResponse = z
115	  .object({
116	    schedule: z.record(z.unknown()).nullable(),
117	  })
118	  .passthrough();
119	export type RefreshScheduleResponse = z.infer<typeof RefreshScheduleResponse>;
120	
121	export const UploadsResponse = itemsResponse(UploadDoc);
122	export type UploadsResponse = z.infer<typeof UploadsResponse>;
123	
124	export const CreateUploadResponse = z
125	  .object({
126	    uploadId: z.string(),
127	  })
128	  .passthrough();
129	export type CreateUploadResponse = z.infer<typeof CreateUploadResponse>;
130	
131	export const DeleteUploadResponse = z.object({
132	  removed: z.boolean(),
133	  docsRemoved: z.number().int().nonnegative(),
134	});
135	export type DeleteUploadResponse = z.infer<typeof DeleteUploadResponse>;
136	
137	export const ReindexResponse = z.object({ started: z.boolean() });
138	export type ReindexResponse = z.infer<typeof ReindexResponse>;
139	
140	export const knowledgeEndpoints = {
141	  listCollections: {
142	    method: 'GET',
143	    path: '/api/v1/knowledge/collections',
144	    auth: 'user',
145	    response: CollectionsResponse,
146	  },
147	  listDocuments: {
148	    method: 'GET',
149	    path: '/api/v1/knowledge/documents',
150	    auth: 'user',
151	    query: DocumentsQuery,
152	    response: DocumentsResponse,
153	  },
154	  createDocument: {
155	    method: 'POST',
156	    path: '/api/v1/knowledge/documents',
157	    auth: 'user',
158	    request: CreateDocumentRequest,
159	    response: CreateDocumentResponse,
160	  },
161	  deleteDocument: {
162	    method: 'DELETE',
163	    path: '/api/v1/knowledge/collections/:collection/documents/:id',
164	    auth: 'user',
165	    response: OkResponse,
166	  },
167	  listSources: {
168	    method: 'GET',
169	    path: '/api/v1/knowledge/sources',
170	    auth: 'user',
171	    response: SourcesResponse,
172	  },
173	  createSource: {
174	    method: 'POST',
175	    path: '/api/v1/knowledge/sources',
176	    auth: 'user',
177	    request: SourceInput,
178	    response: KnowledgeSource,
179	  },
180	  updateSource: {
181	    method: 'PATCH',
182	    path: '/api/v1/knowledge/sources/:id',
183	    auth: 'user',
184	    request: SourceInput.partial(),
185	    response: KnowledgeSource,
186	  },
187	  deleteSource: {
188	    method: 'DELETE',
189	    path: '/api/v1/knowledge/sources/:id',
190	    auth: 'user',
191	    response: OkResponse,
192	  },
193	  crawlSource: {
194	    method: 'POST',
195	    path: '/api/v1/knowledge/sources/:id/crawl',
196	    auth: 'user',
197	    response: CrawlStartResponse,
198	  },
199	  crawlStatus: {
200	    method: 'GET',
201	    path: '/api/v1/knowledge/sources/:id/crawl',
202	    auth: 'user',
203	    response: CrawlStatusResponse,
204	  },
205	  refreshSchedule: {
206	    method: 'GET',
207	    path: '/api/v1/knowledge/refresh-schedule',
208	    auth: 'user',
209	    response: RefreshScheduleResponse,
210	  },
211	  listUploads: {
212	    method: 'GET',
213	    path: '/api/v1/knowledge/uploads',
214	    auth: 'user',
215	    response: UploadsResponse,
216	  },
217	  createUpload: {
218	    method: 'POST',
219	    path: '/api/v1/knowledge/uploads',
220	    auth: 'user',
221	    response: CreateUploadResponse,
222	    kind: 'binary',
223	  },
224	  deleteUpload: {
225	    method: 'DELETE',
226	    path: '/api/v1/knowledge/uploads/:id',
227	    auth: 'user',
228	    response: DeleteUploadResponse,
229	  },
230	  reindex: {
231	    method: 'POST',
232	    path: '/api/v1/knowledge/reindex',
233	    auth: 'org-admin',
234	    response: ReindexResponse,
235	  },
236	  indexStatus: {
237	    method: 'GET',
238	    path: '/api/v1/knowledge/index-status',
239	    auth: 'org-admin',
240	    response: IndexStatus,
241	  },
242	} as const satisfies DomainDescriptorMap;
```

#### web/components/ui/search-input.tsx — SearchInputProps(interface), SearchInput(function)

```tsx
1	'use client';
2	import type React from 'react';
3	import { Search, X } from 'lucide-react';
4	import { useTranslation } from '@/stores/i18n';
5	import { fieldClasses } from './field';
6	
7	interface SearchInputProps
8	  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
9	  value: string;
10	  onValueChange: (value: string) => void;
11	  className?: string;
12	}
13	
14	export function SearchInput({ value, onValueChange, className, ...rest }: SearchInputProps) {
15	  const { common } = useTranslation();
16	  const clearLabel = common?.clear ?? 'Limpar';
17	  return (
18	    <div className={`relative ${className ?? ''}`}>
19	      <Search
20	        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
21	        aria-hidden
22	      />
23	      <input
24	        type="text"
25	        {...rest}
26	        value={value}
27	        onChange={(e) => onValueChange(e.target.value)}
28	        className={`${fieldClasses(false)} pl-9 pr-9`}
29	      />
30	      {value && (
31	        <button
32	          type="button"
33	          aria-label={clearLabel}
34	          onClick={() => onValueChange('')}
35	          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md text-neutral-400 hover:text-neutral-600 focus-ring"
36	        >
37	          <X className="h-4 w-4" aria-hidden />
38	        </button>
39	      )}
40	    </div>
41	  );
42	}
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
The storage path looks structurally org-scoped and `_shared` is still guarded. I’m checking one remaining question: whether this slice is actually reachable through the build API, or whether `knowledgeDocs` only exists on an internal TypeScript interface and never crosses a validated route.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'codegraph explore "jobsRouter build create request schema shared jobs endpoint description language templateId integrationKeys knowledgeDocs"' in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "rg -n \"knowledgeDocs|jobsEndpoints|build request|templateId|integrationKeys|attachments|fieldValues|configValues\" shared/src api/src/routes api/src | sed -n '1,240p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
shared/src/index.ts:13:import { jobsEndpoints } from './jobs.js';
shared/src/index.ts:75:  jobs: jobsEndpoints,
api/src/routes/integrations.ts:31:const CreateConfig = z.object({ integrationKey: z.string(), configValues: z.record(z.unknown()), name: z.string().optional() });
api/src/routes/integrations.ts:32:const UpdateConfig = z.object({ enabled: z.boolean().optional(), configValues: z.record(z.unknown()).optional() });
api/src/routes/integrations.ts:68:    const c = await createConfig(actorOf(req), body as { integrationKey: string; configValues: Record<string, unknown>; name?: string }, deps);
api/src/routes/integrations.ts:78:    const result = await updateConfig(a, target._id, body as { enabled?: boolean; configValues?: Record<string, unknown> });
api/src/routes/chat.ts:43:      ...(body.attachments ? { attachments: body.attachments } : {}),
api/src/routes/jobs.ts:45:      ...(body.templateId ? { templateId: body.templateId } : {}),
api/src/routes/jobs.ts:46:      ...(body.integrationKeys ? { integrationKeys: body.integrationKeys } : {}),
api/src/routes/jobs.ts:48:      ...(body.attachments ? { attachments: body.attachments } : {}),
api/src/routes/jobs.ts:49:      ...(body.fieldValues ? { fieldValues: body.fieldValues } : {}),
api/src/routes/jobs.ts:50:      ...(body.configValues ? { configValues: body.configValues } : {}),
shared/src/jobs.ts:37:  templateId: z.string().optional(),
shared/src/jobs.ts:38:  integrationKeys: z.array(z.string()).optional(),
shared/src/jobs.ts:40:  attachments: z.array(UploadRef).optional(),
shared/src/jobs.ts:41:  fieldValues: z.record(z.unknown()).optional(),
shared/src/jobs.ts:42:  configValues: z.record(z.unknown()).optional(),
shared/src/jobs.ts:55:export const jobsEndpoints = {
shared/src/chat.ts:41:  attachments: z.array(UploadRef).optional(),
shared/src/integrations.ts:103:  configValues: z.record(z.unknown()),
shared/src/integrations.ts:109:  configValues: z.record(z.unknown()).optional(),
api/src/routes/integration-builder.ts:76:  configValues: z.record(z.unknown()).optional(),
api/src/routes/integration-builder.ts:213:    const creds = (body.testCredentials ?? body.configValues) as Record<string, unknown> | undefined;
api/src/routes/integration-builder.ts:217:      if (existing) await updateConfig(actor, existing._id, { configValues: creds });
api/src/routes/integration-builder.ts:218:      else await createConfig(actor, { integrationKey: key, configValues: creds, name: config.displayName ?? key }, deps);
api/src/routes/integration-builder.ts:76:  configValues: z.record(z.unknown()).optional(),
api/src/routes/integration-builder.ts:213:    const creds = (body.testCredentials ?? body.configValues) as Record<string, unknown> | undefined;
api/src/routes/integration-builder.ts:217:      if (existing) await updateConfig(actor, existing._id, { configValues: creds });
api/src/routes/integration-builder.ts:218:      else await createConfig(actor, { integrationKey: key, configValues: creds, name: config.displayName ?? key }, deps);
api/src/routes/jobs.ts:45:      ...(body.templateId ? { templateId: body.templateId } : {}),
api/src/routes/jobs.ts:46:      ...(body.integrationKeys ? { integrationKeys: body.integrationKeys } : {}),
api/src/routes/jobs.ts:48:      ...(body.attachments ? { attachments: body.attachments } : {}),
api/src/routes/jobs.ts:49:      ...(body.fieldValues ? { fieldValues: body.fieldValues } : {}),
api/src/routes/jobs.ts:50:      ...(body.configValues ? { configValues: body.configValues } : {}),
api/src/routes/chat.ts:43:      ...(body.attachments ? { attachments: body.attachments } : {}),
api/src/routes/integrations.ts:31:const CreateConfig = z.object({ integrationKey: z.string(), configValues: z.record(z.unknown()), name: z.string().optional() });
api/src/routes/integrations.ts:32:const UpdateConfig = z.object({ enabled: z.boolean().optional(), configValues: z.record(z.unknown()).optional() });
api/src/routes/integrations.ts:68:    const c = await createConfig(actorOf(req), body as { integrationKey: string; configValues: Record<string, unknown>; name?: string }, deps);
api/src/routes/integrations.ts:78:    const result = await updateConfig(a, target._id, body as { enabled?: boolean; configValues?: Record<string, unknown> });
api/src/agents/build.ts:65:  templateId?: string;
api/src/agents/build.ts:66:  integrationKeys?: string[];
api/src/agents/build.ts:68:  attachments?: unknown[];
api/src/agents/build.ts:69:  fieldValues?: Record<string, unknown>;
api/src/agents/build.ts:70:  configValues?: Record<string, unknown>;
api/src/agents/build.ts:75:  knowledgeDocs?: Array<{ title: string; text: string; collection?: string }>;
api/src/agents/build.ts:132:      ...(input.templateId ? { templateId: input.templateId } : {}),
api/src/agents/build.ts:133:      ...(input.integrationKeys ? { integrationKeys: input.integrationKeys } : {}),
api/src/agents/build.ts:134:      ...(input.fieldValues ? { fieldValues: input.fieldValues } : {}),
api/src/agents/build.ts:135:      ...(input.configValues ? { configValues: input.configValues } : {}),
api/src/agents/build.ts:312:      const prep = await mech.prepareFirstBuild({ userId: input.actor.userId, sessionId: input.sessionId, description: input.description, language: input.language, ...(input.templateId ? { templateId: input.templateId } : {}) });
api/src/agents/build.ts:358:          for (const doc of input.knowledgeDocs ?? []) {
api/src/agents/domain-scoping.ts:3: * scoping phase runs over the build request to decide whether the app looks domain-heavy - i.e.
api/src/agents/domain-scoping.ts:132: * Detect whether a build request looks domain-heavy. Deterministic (no model call): it folds the
api/src/integrations/service.ts:71:export async function createConfig(actor: Actor, input: { integrationKey: string; configValues: Record<string, unknown>; name?: string }, deps: Deps): Promise<IntegrationConfigDoc> {
api/src/integrations/service.ts:80:    credentialsCiphertext: encrypt(JSON.stringify(input.configValues)), // encrypted at rest
api/src/integrations/service.ts:106:export async function updateConfig(actor: Actor, id: string, patch: { enabled?: boolean; configValues?: Record<string, unknown> }): Promise<{ verdict: WriteVerdict; config?: IntegrationConfigDoc }> {
api/src/integrations/service.ts:113:    ...(patch.configValues ? { credentialsCiphertext: encrypt(JSON.stringify(patch.configValues)) } : {}),
api/src/agents/tools.ts:22:/** Read-only file tools for a text run that carries attachments (§5.4.4). */
api/src/agents/tools.ts:25:export type RunToolClass = 'chat' | 'build' | 'text-attachments' | 'pure-text' | 'brand-research' | 'integration-builder';
api/src/agents/tools.ts:48:    case 'text-attachments':
api/src/agents/context.ts:27:  /** The user's message / build request — drives memory overlap + knowledge grounding + prefetch. */
api/src/agents/jobs.ts:29:    templateId?: string;
api/src/agents/jobs.ts:30:    integrationKeys?: string[];
api/src/agents/jobs.ts:31:    attachments?: unknown[];
api/src/agents/jobs.ts:32:    fieldValues?: Record<string, unknown>;
api/src/agents/jobs.ts:33:    configValues?: Record<string, unknown>;
api/src/agents/chat.ts:4: * is persisted immediately at creation; routing is floored at the standard tier (attachments
api/src/agents/chat.ts:37:  attachments?: unknown[];
api/src/agents/chat.ts:135:    // Routing floored at the standard tier; attachments imply the code-generation hint (§5.6.1).
api/src/agents/chat.ts:136:    const hasAttachments = !!input.attachments?.length;
api/src/agents/chat.ts:138:    const policy = hasAttachments ? toolPolicyFor('text-attachments') : toolPolicyFor('chat');
api/src/agents/chat.ts:140:    // in-process MCP (§5.4.4; ch18 §18.2); the attachments variant is Read/Glob/Grep only and
api/src/agents/chat.ts:152:    // Only when the delegation tool is actually mounted (the attachments variant mounts no
api/src/agents/seams.ts:257:  /** The user's build request (F28): the verifier asserts request-FULFILMENT — the served DOM is
api/src/agents/seams.ts:323:  prepareFirstBuild(input: { userId: string; sessionId: string; description: string; language: string; templateId?: string }): Promise<FirstBuildPrep>;
api/src/automation/types.ts:10: *     stored as memory attachments, replayed deterministically on
api/src/apps/verify-runner.ts:45:  /** The user's build request (F28): the verifier asserts request-FULFILMENT, not mere rendering. */
api/src/apps/artifact-type.ts:3: * what KIND of artifact a build request produces, and therefore which internal
api/src/apps/artifact-type.ts:93:/** The artifact type an EXPLICIT base selection implies (templateId path). */
api/src/apps/build-mechanics.ts:68:   * B1: an EXPLICIT `templateId` naming a base wins (a known-but-broken base fails
api/src/apps/build-mechanics.ts:77:    templateId: string | undefined,
api/src/apps/build-mechanics.ts:81:    if (templateId && isBaseId(templateId)) {
api/src/apps/build-mechanics.ts:82:      const base = await loadBase(templateId); // explicit selection: broken base fails loud
api/src/apps/build-mechanics.ts:85:    if (templateId) {
api/src/apps/build-mechanics.ts:86:      console.warn(`[build-mechanics] templateId "${templateId}" names no internal base; classifying instead`);
api/src/apps/build-mechanics.ts:145:      templateId?: string;
api/src/apps/build-mechanics.ts:147:      const { base, artifactType } = await baseFor(input.templateId, input.description, input.userId);
api/src/llm/client.ts:187:  /** Base64 image attachments for vision one-shots (§6.2.1 runOneShot). */

 succeeded in 607ms:
## Exploration: jobsRouter build create request schema shared jobs endpoint description language templateId integrationKeys knowledgeDocs

Found 203 symbols across 82 files.

### Blast radius — what depends on these (update/verify before editing)

- `Language` (shared/src/common.ts:27) — 4 callers in `shared/src/integration-builder.ts`, `shared/src/knowledge.ts`, `shared/src/automations.ts`, `shared/src/chat.ts`; ⚠️ no covering tests found
- `EndpointDescriptor` (shared/src/descriptor.ts:24) — 7 callers in `web/lib/api/core.ts`, `web/lib/api/index.ts`, `shared/src/descriptor.ts`; ⚠️ no covering tests found
- `EndpointKind` (shared/src/descriptor.ts:22) — 1 caller in `shared/src/descriptor.ts`; ⚠️ no covering tests found
- `BuildCreateInput` (api/src/agents/build.ts:59) — 7 callers in `api/src/agents/build.ts`; tests: `api/tests/agents/build.test.ts`

### Relationships

**references:**
- EndpointDescriptor → HttpMethod
- EndpointDescriptor → AuthClass
- EndpointDescriptor → EndpointKind
- DomainDescriptorMap → EndpointDescriptor
- splitArgs → EndpointDescriptor
- buildUrl → EndpointDescriptor
- request → EndpointDescriptor
- createClient → EndpointDescriptor
- ALL_ENDPOINTS → DomainDescriptorMap
- splitArgs → RequestArgs
- ... and 171 more

**calls:**
- splitArgs → pathParamNames
- splitArgs → queryShapeKeys
- buildUrl → resolveBaseUrl
- request → getToken
- request → currentLanguage
- request → handleUnauthorized
- request → toApiError
- jobsRouter → Router
- appFilesRouter → Router
- buildLinkRouter → Router
- ... and 253 more

**instantiates:**
- splitArgs → ApiError

### Source Code

> The code below is the **verbatim, current on-disk source** of these files — re-read from disk on this call and line-numbered, byte-for-byte identical to what the Read tool returns. It is NOT a summary, outline, or stale cache. Treat each block as a Read you have already performed: do not Read a file shown here.

#### web/lib/api/core.ts — imports(imports), ApiError(instantiates), EndpointDescriptor(imports), ApiError(imports), resolveBaseUrl(imports), getToken(imports), RequestOptions(interface), RequestArgs(type_alias), request(function), EndpointDescriptor(references), +8 more

```typescript
11	 * `Response`/`Blob` via `opts.responseType`.
12	 */
13	
14	import type { EndpointDescriptor } from '@ekoa/shared';
15	import { ErrorEnvelope } from '@ekoa/shared';
16	import { ApiError } from './errors';
17	import { resolveBaseUrl } from './base-url';
18	import { getToken, clearToken } from './token';
19	
20	const DEFAULT_TIMEOUT_MS = 120_000;
21	/** Persisted auth-store key cleared alongside the token on a 401 (ch12 §12.2.3). */
22	const AUTH_STATE_KEY = 'ekoa_auth';
23	
24	export interface RequestOptions {
25	  /** Caller abort signal, merged with the per-descriptor timeout. */
26	  signal?: AbortSignal;
27	  /** Extra request headers (binary uploads set `X-Filename` etc. here). */
28	  headers?: Record<string, string>;
29	  /** Raw body for `kind: 'binary'` endpoints (Blob / ArrayBuffer / FormData / ...). */
30	  rawBody?: BodyInit;
31	  /** How to read a 2xx body. `json` (default) parses + validates; `blob`/`response` for downloads. */
32	  responseType?: 'json' | 'blob' | 'response';
33	}
34	
35	export type RequestArgs = Record<string, unknown>;
36	
37	// -- Language source seam (§12.2.3, FC-009/FC-069) --------------------------------------
38	//

... (gap) ...

195	
196	// -- The request core -------------------------------------------------------------------
197	
198	export async function request(descriptor: EndpointDescriptor, args?: RequestArgs, opts?: RequestOptions): Promise<unknown> {
199	  const { params, query, body } = splitArgs(descriptor, args);
200	  const url = buildUrl(descriptor, params, query);
201	
202	  const headers: Record<string, string> = { ...(opts?.headers ?? {}) };
203	  const token = getToken();
204	  if (token && descriptor.auth !== 'public') {
205	    headers['Authorization'] = `Bearer ${token}`;
206	  }
207	
208	  // Language interceptor (§12.2.3): inject the single-source language into the body.
209	  let jsonBody = body;
210	  if (descriptor.language) {
211	    const language = currentLanguage();
212	    if (language) jsonBody = { ...(jsonBody ?? {}), language };
213	  }
214	
215	  // Body encoding.
216	  let fetchBody: BodyInit | undefined;
217	  if (descriptor.kind === 'binary') {
218	    fetchBody = opts?.rawBody;
219	  } else if (jsonBody !== undefined && (descriptor.request !== undefined || Object.keys(jsonBody).length > 0)) {
220	    headers['Content-Type'] = 'application/json';
221	    fetchBody = JSON.stringify(jsonBody);
222	  }
223	
224	  // Per-descriptor timeout + caller abort, merged into one controller.
225	  const timeoutMs = descriptor.timeoutMs ?? DEFAULT_TIMEOUT_MS;
226	  const controller = new AbortController();
227	  let timedOut = false;
228	  let abortedByCaller = false;
229	  const timer = setTimeout(() => {
230	    timedOut = true;
231	    controller.abort();
232	  }, timeoutMs);
233	  const onCallerAbort = () => {
234	    abortedByCaller = true;
235	    controller.abort();
236	  };
237	  if (opts?.signal) {
238	    if (opts.signal.aborted) onCallerAbort();
239	    else opts.signal.addEventListener('abort', onCallerAbort, { once: true });
240	  }
241	
242	  let res: Response;
243	  try {
244	    res = await fetch(url, { method: descriptor.method, headers, body: fetchBody, signal: controller.signal });
245	  } catch (error) {
246	    if (timedOut) throw new ApiError(0, 'TIMEOUT', `Request timed out after ${timeoutMs}ms`);
247	    if (abortedByCaller) throw new ApiError(0, 'ABORTED', 'Request aborted');
248	    throw new ApiError(0, 'NETWORK_ERROR', error instanceof Error ? error.message : 'Network request failed');
249	  } finally {
250	    clearTimeout(timer);
251	    opts?.signal?.removeEventListener('abort', onCallerAbort);
252	  }
253	
254	  if (!res.ok) {
255	    if (res.status === 401 && descriptor.auth !== 'public') handleUnauthorized();
256	    throw await toApiError(res);
257	  }
258	
259	  if (opts?.responseType === 'response') return res;
260	  if (opts?.responseType === 'blob') return res.blob();
261	
262	  if (res.status === 204) return undefined;
263	  const text = await res.text();
264	  let data: unknown;
265	  try {
266	    data = text ? JSON.parse(text) : undefined;
267	  } catch {
268	    throw new ApiError(0, 'CONTRACT_MISMATCH', `Response for ${descriptor.method} ${descriptor.path} was not valid JSON`);
269	  }
270	
271	  // Contract validation in dev/test (ch13 contract tests). Off in production for cost.
272	  if (process.env.NODE_ENV !== 'production' && descriptor.response && data !== undefined) {
273	    const check = descriptor.response.safeParse(data);
274	    if (!check.success) {
275	      throw new ApiError(
276	        0,
277	        'CONTRACT_MISMATCH',
278	        `Response for ${descriptor.method} ${descriptor.path} failed contract validation`,
279	        check.error.issues,
280	      );
281	    }
282	  }
283	
284	  return data;
285	}
286	
```

#### api/src/apps/builder.ts — calls(calls), build(method), references(references)

```typescript
356	   * server-side backend bundle (Layer 2). Backend build errors are merged into
357	   * the result so a backend that doesn't compile fails the build loudly.
358	   */
359	  async build(appId: string, sandboxPath: string): Promise<BuildResult> {
360	    const frontend = await this.buildFrontend(appId, sandboxPath);
361	
362	    let manifest: AppManifest | null = null;
363	    try { manifest = await readManifest(sandboxPath); } catch { /* invalid - no backend */ }
364	    if (!manifest?.backend) return frontend;
365	
366	    const backend = await this.buildBackend(appId, sandboxPath, manifest.backend);
367	    return {
368	      success: frontend.success && backend.success,
369	      errors: [...frontend.errors, ...backend.errors],
370	      warnings: [...frontend.warnings, ...backend.warnings],
371	      durationMs: frontend.durationMs + backend.durationMs,
372	      outputFiles: [...frontend.outputFiles, ...backend.outputFiles],
373	    };
374	  }
375	
376	  /**
377	   * Bundle an artifact's backend entry with esbuild for Node (esm, bundled) to
```

#### api/src/data/collections-engine.ts — calls(calls), create(method), references(references), instantiates(instantiates)

```typescript
134	    return d ? d.item : null;
135	  }
136	
137	  async create(
138	    scope: Scope,
139	    collection: string,
140	    body: Record<string, unknown>,
141	    rule?: z.infer<typeof collectionRule>,
142	  ): Promise<Record<string, unknown>> {
143	    guardCollectionName(collection);
144	    const id = typeof body.id === 'string' && body.id ? body.id : this.deps.genId();
145	    const now = nowIso(this.deps.now());
146	    const { id: _drop, createdAt: _c, updatedAt: _u, ...fields } = body;
147	    const item = { id, createdAt: now, updatedAt: now, ...fields };
148	    this.checkSize(rule, item);
149	    validateItem(rule, item);
150	    try {
151	      await col().insertOne({ _id: docId(scope, collection, id), appId: scope.scopeKey, collection, item, _rev: 0 });
152	    } catch (e) {
153	      if ((e as { code?: number }).code === 11000) {
154	        // id collision → treat as update-through-create is not allowed; surface conflict
155	        throw new EngineError('SLUG_TAKEN', 409, `Item id already exists: ${id}`);
156	      }
157	      throw e;
158	    }
159	    return item;
160	  }
161	
162	  /** PUT upsert (§4.2.8 #6): update-merge if present, create with the given id if absent. */
163	  async upsert(
```

#### api/src/routes/jobs.ts — jobsRouter(function)

```typescript
1	/**
2	 * Build/brand-research jobs router (ch03 §3.8.8, §3.6.2). `POST /jobs` creates BUILD jobs; the
3	 * response is `created` (with the job) or `answered` (in-build classifier resolved it, no job) or
4	 * 409 DUPLICATE_BUILD (a concurrent follow-up on the same artifact). `GET /jobs/:id` serves the
5	 * persisted record (P-10); events stream over `events/` via ?token=. Routes never touch `data/`.
6	 */
7	import { Router, type Request, type Response } from 'express';
8	import { JobCreateRequest } from '@ekoa/shared';
9	import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
10	import { sseManager } from '../events/sse-manager.js';
11	import { handleBuildCreate, cancelRun } from '../agents/index.js';
12	import { getJob, jobView } from '../agents/jobs.js';
13	import { actorOf, notFound, parseBody, sendError } from './helpers.js';
14	
15	export function jobsRouter(deps: { now: () => number; genId: () => string }): Router {
16	  const r = Router();
17	
18	  r.get('/:id/events', async (req: Request, res: Response) => {
19	    const auth = verifySseToken(req.query.token as string | undefined);
20	    if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
21	    const id = req.params.id as string;
22	    // Ownership check BEFORE attach (Codex checkpoint): a valid SSE token must NOT subscribe to
23	    // another user's job stream (cross-user event/output leak). Mirrors the guarded GET /:id + the
24	    // chat SSE route. A missing job attaches (nothing streams); only a foreign OWNED job is refused.
25	    const job = await getJob(id);
26	    if (job && job.userId !== auth.claims.sub) {
27	      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Sem permissão.' } });
28	    }
29	    const lastEventId = req.header('last-event-id');
30	    sseManager.attach(res, auth.claims.sub, 'job', id, lastEventId ? Number(lastEventId) : undefined);
31	  });
32	
33	  r.use(requireAuth);
34	
35	  r.post('/', async (req: AuthedRequest, res: Response) => {
36	    const body = parseBody(res, JobCreateRequest, req.body);
37	    if (!body) return;
38	    const actor = actorOf(req);
39	    const result = await handleBuildCreate({
40	      actor,
41	      username: req.user!.username,
42	      sessionId: body.sessionId,
43	      description: body.description,
44	      language: body.language,
45	      ...(body.templateId ? { templateId: body.templateId } : {}),
46	      ...(body.integrationKeys ? { integrationKeys: body.integrationKeys } : {}),
47	      ...(body.artifactId ? { artifactId: body.artifactId } : {}),
48	      ...(body.attachments ? { attachments: body.attachments } : {}),
49	      ...(body.fieldValues ? { fieldValues: body.fieldValues } : {}),
50	      ...(body.configValues ? { configValues: body.configValues } : {}),
51	      deps,
52	    });
53	    if (result.status === 'conflict') return sendError(res, 'DUPLICATE_BUILD', 'Já existe uma construção em curso para esta aplicação.');
54	    if (result.status === 'answered') return res.status(200).json({ status: 'answered', reason: result.reason });
55	    res.status(202).json({ status: 'created', job: result.job });
56	    result.fire();
57	  });
58	
59	  r.get('/:id', async (req: AuthedRequest, res: Response) => {
60	    const job = await getJob(req.params.id as string);
61	    const actor = actorOf(req);
62	    if (!job || (job.userId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
63	    res.json(jobView(job));
64	  });
65	
66	  r.post('/:id/cancel', (req: AuthedRequest, res: Response) => {
67	    res.json(cancelRun(req.params.id as string, actorOf(req)));
68	  });
69	
70	  return r;
71	}
```

#### shared/src/integration-builder.ts — IntegrationBuilderMessage(type_alias), IntegrationBuilderLoadQuery(type_alias), integration-builder.ts(file)

```typescript
1	/** Integration builder contract (ch03 §3.8.14). */
2	import { z } from 'zod';
3	import { Language } from './common.js';
4	import type { DomainDescriptorMap } from './descriptor.js';
5	
6	export const IntegrationBuilderMessage = z
7	  .object({
8	    role: z.string(),
9	    content: z.string(),
10	  })
11	  .passthrough();
12	export type IntegrationBuilderMessage = z.infer<typeof IntegrationBuilderMessage>;
13	
14	export const IntegrationBuilderValidationError = z
15	  .object({
16	    path: z.string().optional(),
17	    message: z.string(),
18	  })
19	  .passthrough();
20	export type IntegrationBuilderValidationError = z.infer<typeof IntegrationBuilderValidationError>;
21	
22	export const GeneratedPackage = z
23	  .object({
24	    integrationKey: z.string().optional(),
25	    displayName: z.string().optional(),
26	    actions: z.array(z.unknown()).optional(),
27	  })
28	  .passthrough();
29	export type GeneratedPackage = z.infer<typeof GeneratedPackage>;
30	
31	export const IntegrationBuilderChatRequest = z.object({
32	  message: z.string(),
33	  builderSessionId: z.string().optional(),
34	  // Bare default schema (not `.optional()`): `Language` already applies the PT default
35	  // when omitted (ch03 §3.4). `.optional()` would neutralize it (ZodOptional(ZodDefault)).
36	  language: Language,
37	});
38	export type IntegrationBuilderChatRequest = z.infer<typeof IntegrationBuilderChatRequest>;
39	
40	export const IntegrationBuilderChatResponse = z.object({
41	  builderSessionId: z.string(),
42	  generatedPackage: GeneratedPackage,
43	  validationErrors: z.array(IntegrationBuilderValidationError),
44	});
45	export type IntegrationBuilderChatResponse = z.infer<typeof IntegrationBuilderChatResponse>;
46	
47	export const IntegrationBuilderLoadQuery = z.object({
48	  integrationKey: z.string(),
49	});
50	export type IntegrationBuilderLoadQuery = z.infer<typeof IntegrationBuilderLoadQuery>;
51	
52	export const IntegrationBuilderLoadResponse = z.object({
53	  builderSessionId: z.string(),
54	  generatedPackage: GeneratedPackage,
55	  messages: z.array(IntegrationBuilderMessage),
56	  validationErrors: z.array(IntegrationBuilderValidationError),
57	});
58	export type IntegrationBuilderLoadResponse = z.infer<typeof IntegrationBuilderLoadResponse>;
59	
60	export const IntegrationBuilderSaveRequest = z.union([
61	  z.object({ builderSessionId: z.string() }),
62	  z.object({
63	    generatedPackage: GeneratedPackage,
64	    testCredentials: z.record(z.unknown()).optional(),
65	  }),
66	]);
67	export type IntegrationBuilderSaveRequest = z.infer<typeof IntegrationBuilderSaveRequest>;
68	
69	export const IntegrationBuilderSaveResponse = z.object({
70	  integrationKey: z.string(),
71	  displayName: z.string(),
72	  saved: z.boolean(),
73	  configured: z.boolean().optional(),
74	});
75	export type IntegrationBuilderSaveResponse = z.infer<typeof IntegrationBuilderSaveResponse>;
76	
77	export const IntegrationBuilderTestRequest = z.object({
78	  builderSessionId: z.string(),
79	  actionKey: z.string(),
80	  testCredentials: z.record(z.unknown()).optional(),
81	  testInput: z.record(z.unknown()).optional(),
82	});
83	export type IntegrationBuilderTestRequest = z.infer<typeof IntegrationBuilderTestRequest>;
84	
85	export const IntegrationBuilderTestResponse = z.object({
86	  actionKey: z.string(),
87	  success: z.boolean(),
88	  statusCode: z.number().optional(),
89	  response: z.unknown().optional(),
90	  error: z.string().optional(),
91	});
92	export type IntegrationBuilderTestResponse = z.infer<typeof IntegrationBuilderTestResponse>;
93	
94	export const integrationBuilderEndpoints = {
95	  chat: {
96	    method: 'POST',
97	    path: '/api/v1/integration-builder/chat',
98	    auth: 'user',
99	    request: IntegrationBuilderChatRequest,
100	    response: IntegrationBuilderChatResponse,
101	    timeoutMs: 300000,
102	    language: true,
103	  },
104	  load: {
105	    method: 'GET',
106	    path: '/api/v1/integration-builder/package',
107	    auth: 'user',
108	    query: IntegrationBuilderLoadQuery,
109	    response: IntegrationBuilderLoadResponse,
110	  },
111	  save: {
112	    method: 'PUT',
113	    path: '/api/v1/integration-builder/package',
114	    auth: 'user',
115	    request: IntegrationBuilderSaveRequest,
116	    response: IntegrationBuilderSaveResponse,
117	  },
118	  test: {
119	    method: 'POST',
120	    path: '/api/v1/integration-builder/test',
121	    auth: 'user',
122	    request: IntegrationBuilderTestRequest,
123	    response: IntegrationBuilderTestResponse,
124	    timeoutMs: 60000,
125	  },
126	} as const satisfies DomainDescriptorMap;
```

#### shared/src/descriptor.ts — EndpointDescriptor(interface), EndpointKind(type_alias), HttpMethod(type_alias), AuthClass(type_alias), DomainDescriptorMap(type_alias)

```typescript
1	import type { ZodTypeAny } from 'zod';
2	
3	/**
4	 * Endpoint descriptor (ch02 §2.2, ch12 §12.2.1): the machine-readable form of the
5	 * ch03 endpoint tables. `api/` mounts validation from these; `web/` derives its
6	 * typed client from them. Descriptor maps are contract DATA, not code.
7	 */
8	export type AuthClass =
9	  | 'public'
10	  | 'user'
11	  | 'org-admin'
12	  | 'super-admin'
13	  | 'token-query'
14	  | 'hmac'
15	  | 'header-scoped'
16	  | 'optional-jwt'
17	  | 'app-id-gated'
18	  | 'bridge';
19	
20	export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
21	
22	export type EndpointKind = 'rest' | 'sse' | 'ws' | 'binary' | 'redirect' | 'static';
23	
24	export interface EndpointDescriptor {
25	  method: HttpMethod;
26	  path: string;
27	  auth: AuthClass;
28	  request?: ZodTypeAny;
29	  response?: ZodTypeAny;
30	  query?: ZodTypeAny;
31	  timeoutMs?: number;
32	  /** default request language when the endpoint carries user-visible model output (ch03 §3.4). */
33	  language?: boolean;
34	  kind?: EndpointKind;
35	}
36	
37	export type DomainDescriptorMap = Record<string, EndpointDescriptor>;
```

#### shared/src/common.ts — Language(constant), Actor(interface), Role(type_alias)

```typescript
1	import { z } from 'zod';
2	
3	/** Shared primitives used across domains. ISO-8601 UTC timestamps (ch03 §3.4).
4	 *  Accepts both `Z` and explicit-offset forms; the server mints UTC. (A trailing
5	 *  `.or(z.string())` would make the datetime check dead, so it is deliberately absent.) */
6	export const IsoTimestamp = z.string().datetime({ offset: true });
7	export const Id = z.string().min(1);
8	
9	/** Uniform list-with-total envelope for paginated reads (ch03 §3.4). */
10	export const listResponse = <T extends z.ZodTypeAny>(item: T) =>
11	  z.object({ items: z.array(item), total: z.number().int().nonnegative() });
12	
13	/** Simple items wrapper (non-paginated collections). */
14	export const itemsResponse = <T extends z.ZodTypeAny>(item: T) =>
15	  z.object({ items: z.array(item) });
16	
17	export const OkResponse = z.object({ ok: z.literal(true) });
18	export type OkResponse = z.infer<typeof OkResponse>;
19	
20	/** Pagination query shared by list endpoints. */
21	export const PaginationQuery = z.object({
22	  limit: z.coerce.number().int().positive().max(500).optional(),
23	  offset: z.coerce.number().int().nonnegative().optional(),
24	});
25	
26	/** Language field for endpoints producing user-visible model output (ch03 §3.4). */
27	export const Language = z.enum(['pt', 'en']).default('pt');
28	
29	/** Org sharing visibility (Amendment 2): default private. */
30	export const Visibility = z.enum(['private', 'org']);
31	
32	/** The three-role model (Amendment 2). */
33	export const Role = z.enum(['super-admin', 'org-admin', 'builder']);
34	export type Role = z.infer<typeof Role>;
35	
36	/** The per-request actor context derived from the verified JWT. A plain type (no wire
37	 *  schema) placed here so every api tier — data/, auth/, routes/, services/ — can name it
38	 *  without crossing an import boundary. */
39	export interface Actor {
40	  userId: string;
41	  orgId: string;
42	  role: Role;
43	}
44	
45	/** Reference to a staged upload by opaque id (ch03 §3.4). */
46	export const UploadRef = z.object({
47	  uploadId: z.string(),
48	  displayName: z.string().optional(),
49	});
50	export type UploadRef = z.infer<typeof UploadRef>;
```


... (output truncated to budget; the source above is complete and verbatim — treat it as already Read. For any area not covered, run another codegraph_explore with the specific names — do NOT Read these files.)

codex
I found one likely contract gap and one runtime behavior gap. I’m validating them with the actual route/schema and with concrete detector inputs so the review only calls out defects that reproduce, not hypotheticals.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
exec
/bin/zsh -lc "sed -n '1,140p' shared/src/jobs.ts" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
// Build jobs domain contract (ch03 §3.8.8, §3.6.2): job resource, create, cancel, event stream.
import { z } from 'zod';
import { UploadRef } from './common.js';
import { JobEvent } from './events.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const Job = z
  .object({
    id: z.string(),
    status: z.string(),
    artifactId: z.string().optional(),
    slug: z.string().optional(),
    createdAt: z.string(),
    /** brand-research: whether the merge wrote anything onto org.branding. */
    brandingApplied: z.boolean().optional(),
    /** brand-research: whether usable brand COLORS were applied. `false` means the site yielded
     *  no non-neutral color the research could trust — the fail-loud signal the old platform
     *  raised as NO_PRIMARY_COLOR; the client tells the user to set colors manually. */
    colorsApplied: z.boolean().optional(),
    /** brand-research: non-fatal degradation codes (e.g. NO_PRIMARY_COLOR). */
    warnings: z.array(z.string()).optional(),
    /** The terminal failure cause (F7): the record has always persisted it, but jobView omitted
     *  it, so a failed job looked cause-less to clients. Present only on a failed job. */
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  })
  .passthrough();
export type Job = z.infer<typeof Job>;

export const JobCreateRequest = z.object({
  // POST /jobs creates BUILD jobs only (ch03 §3.8.8). Brand-research jobs are created
  // exclusively via POST /branding/research (§3.8.4, org-admin) and merely reuse the
  // jobs RESOURCE for state/events — they are not creatable through this endpoint.
  kind: z.literal('build'),
  description: z.string(),
  sessionId: z.string(),
  language: z.enum(['pt', 'en']).default('pt'),
  templateId: z.string().optional(),
  integrationKeys: z.array(z.string()).optional(),
  artifactId: z.string().optional(),
  attachments: z.array(UploadRef).optional(),
  fieldValues: z.record(z.unknown()).optional(),
  configValues: z.record(z.unknown()).optional(),
});
export type JobCreateRequest = z.infer<typeof JobCreateRequest>;

export const JobCreateResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('created'), job: Job }),
  z.object({ status: z.literal('answered'), reason: z.string() }),
]);
export type JobCreateResponse = z.infer<typeof JobCreateResponse>;

export const JobCancelResponse = z.object({ cancelled: z.boolean() });
export type JobCancelResponse = z.infer<typeof JobCancelResponse>;

export const jobsEndpoints = {
  create: {
    method: 'POST',
    path: '/api/v1/jobs',
    auth: 'user',
    request: JobCreateRequest,
    response: JobCreateResponse,
    language: true,
  },
  get: {
    method: 'GET',
    path: '/api/v1/jobs/:id',
    auth: 'user',
    response: Job,
  },
  cancel: {
    method: 'POST',
    path: '/api/v1/jobs/:id/cancel',
    auth: 'user',
    response: JobCancelResponse,
  },
  events: {
    method: 'GET',
    path: '/api/v1/jobs/:id/events',
    auth: 'token-query',
    kind: 'sse',
    response: JobEvent,
  },
} as const satisfies DomainDescriptorMap;

hook: PreToolUse Completed
exec
/bin/zsh -lc "node --input-type=module -e \"import { detectDomainHeavy } from './api/src/agents/domain-scoping.ts'; const cases=['Portal para medicos de um hospital com agendas e historicos clinicos','Medical scheduling app for doctors and hospitals','Law firm case management for attorneys and plaintiffs','Property lease tracker for landlords and tenants']; for (const c of cases) console.log(JSON.stringify({c,r:detectDomainHeavy(c)}));\"" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
node:internal/modules/esm/get_format:189
  throw new ERR_UNKNOWN_FILE_EXTENSION(ext, filepath);
        ^

TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for /Users/ggomes/dev/ekoa-code/api/src/agents/domain-scoping.ts
    at Object.getFileProtocolModuleFormat [as file:] (node:internal/modules/esm/get_format:189:9)
    at defaultGetFormat (node:internal/modules/esm/get_format:232:36)
    at defaultLoad (node:internal/modules/esm/load:145:22)
    at async ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:477:45) {
  code: 'ERR_UNKNOWN_FILE_EXTENSION'
}

Node.js v20.19.4

hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc 'cat package.json' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
{
  "name": "ekoa-code",
  "private": true,
  "version": "0.0.0-rc",
  "description": "Rebuilt Ekoa/Cortex platform: api/, web/, shared/ (FIXED-1). npm workspaces (P-17).",
  "workspaces": [
    "shared",
    "api",
    "web"
  ],
  "engines": {
    "node": ">=20 <21"
  },
  "scripts": {
    "build": "npm run build --workspace shared && npm run build --workspace api && npm run build --workspace web",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "eslint . && npm run lint --workspace web",
    "test": "npm run test --workspaces --if-present",
    "test:contract": "npm run test:contract --workspace api --if-present",
    "e2e": "node scripts/suite-ledger-run.mjs --run",
    "gate:chokepoint": "bash scripts/chokepoint-grep.sh",
    "gate:encryption-key": "bash scripts/encryption-key-grep.sh",
    "gate:garrison": "bash scripts/garrison-grep.sh",
    "gate:sast": "semgrep --config scripts/semgrep.yml --error --quiet api/src shared/src",
    "gate:secrets": "gitleaks detect --no-banner --redact -c scripts/gitleaks.toml",
    "gate:audit": "npm audit --audit-level=high",
    "ci:lane": "npm run lint && npm run gate:chokepoint && npm run gate:encryption-key && npm run gate:garrison && npm run typecheck && npm run test && NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-http://localhost:4111} npm run build",
    "gate:ledger": "node scripts/suite-ledger-run.mjs",
    "e2e:server": "node scripts/e2e-with-server.mjs"
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.15.0",
    "@typescript-eslint/parser": "^8.15.0",
    "eslint": "^8.57.1",
    "eslint-import-resolver-typescript": "^3.6.3",
    "eslint-plugin-import": "^2.31.0",
    "typescript": "^5.6.3",
    "vitest": "^4.1.10"
  }
}

exec
/bin/zsh -lc "ls node_modules/.bin | rg '"'^(tsx|ts-node)$'"'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
ts-node

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "node --loader ts-node/esm --input-type=module -e \"import { detectDomainHeavy } from './api/src/agents/domain-scoping.ts'; const cases=['Portal para medicos de um hospital com agendas e historicos clinicos','Medical scheduling app for doctors and hospitals','Law firm case management for attorneys and plaintiffs','Property lease tracker for landlords and tenants']; for (const c of cases) console.log(JSON.stringify({c,r:detectDomainHeavy(c)}));\"" in /Users/ggomes/dev/ekoa-code
 succeeded in 879ms:
(node:96335) ExperimentalWarning: `--experimental-loader` may be removed in the future; instead use `register()`:
--import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));'
(Use `node --trace-warnings ...` to show where the warning was created)
{"c":"Portal para medicos de um hospital com agendas e historicos clinicos","r":{"domainHeavy":true,"domains":["saude"]}}
{"c":"Medical scheduling app for doctors and hospitals","r":{"domainHeavy":false,"domains":[]}}
{"c":"Law firm case management for attorneys and plaintiffs","r":{"domainHeavy":true,"domains":["juridico"]}}
{"c":"Property lease tracker for landlords and tenants","r":{"domainHeavy":true,"domains":["imobiliario"]}}

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "node --loader ts-node/esm --input-type=module -e \"import { detectDomainHeavy } from './api/src/agents/domain-scoping.ts'; const cases=['Aplicação médica para médicos e hospitais','App para consultas medicas e hospitais','Clinical records for patients and prescriptions','Compliance portal for KYC and AML']; for (const c of cases) console.log(JSON.stringify({c,r:detectDomainHeavy(c)}));\"" in /Users/ggomes/dev/ekoa-code
 succeeded in 709ms:
(node:96458) ExperimentalWarning: `--experimental-loader` may be removed in the future; instead use `register()`:
--import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));'
(Use `node --trace-warnings ...` to show where the warning was created)
{"c":"Aplicação médica para médicos e hospitais","r":{"domainHeavy":false,"domains":[]}}
{"c":"App para consultas medicas e hospitais","r":{"domainHeavy":false,"domains":[]}}
{"c":"Clinical records for patients and prescriptions","r":{"domainHeavy":true,"domains":["saude"]}}
{"c":"Compliance portal for KYC and AML","r":{"domainHeavy":true,"domains":["conformidade"]}}

codex
I’ve reproduced a concrete detector miss now. I’m also validating the route gap instead of inferring it from the schema, because if `knowledgeDocs` is stripped at the API boundary the “mid-build ingest” path is only test-reachable.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "node --loader ts-node/esm --input-type=module -e \"import { JobCreateRequest } from './shared/src/jobs.ts'; const parsed = JobCreateRequest.parse({kind:'build',description:'x',sessionId:'s',language:'pt',knowledgeDocs:[{title:'T',text:'doc'}]}); console.log(JSON.stringify(parsed));\"" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "node --loader ts-node/esm --input-type=module -e \"import { detectDomainHeavy } from './api/src/agents/domain-scoping.ts'; const cases=['Aplicação médica para médicos e hospitais','Medical scheduling app for doctors and hospitals']; for (const c of cases) console.log(c+' => '+JSON.stringify(detectDomainHeavy(c)));\"" in /Users/ggomes/dev/ekoa-code
 succeeded in 1043ms:
(node:96681) ExperimentalWarning: `--experimental-loader` may be removed in the future; instead use `register()`:
--import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));'
(Use `node --trace-warnings ...` to show where the warning was created)
Aplicação médica para médicos e hospitais => {"domainHeavy":false,"domains":[]}
Medical scheduling app for doctors and hospitals => {"domainHeavy":false,"domains":[]}

 succeeded in 2195ms:
(node:96673) ExperimentalWarning: `--experimental-loader` may be removed in the future; instead use `register()`:
--import 'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("ts-node/esm", pathToFileURL("./"));'
(Use `node --trace-warnings ...` to show where the warning was created)
{"kind":"build","description":"x","sessionId":"s","language":"pt"}

hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse
exec
/bin/zsh -lc "nl -ba shared/src/jobs.ts | sed -n '24,52p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
    24	    error: z.object({ code: z.string(), message: z.string() }).optional(),
    25	  })
    26	  .passthrough();
    27	export type Job = z.infer<typeof Job>;
    28	
    29	export const JobCreateRequest = z.object({
    30	  // POST /jobs creates BUILD jobs only (ch03 §3.8.8). Brand-research jobs are created
    31	  // exclusively via POST /branding/research (§3.8.4, org-admin) and merely reuse the
    32	  // jobs RESOURCE for state/events — they are not creatable through this endpoint.
    33	  kind: z.literal('build'),
    34	  description: z.string(),
    35	  sessionId: z.string(),
    36	  language: z.enum(['pt', 'en']).default('pt'),
    37	  templateId: z.string().optional(),
    38	  integrationKeys: z.array(z.string()).optional(),
    39	  artifactId: z.string().optional(),
    40	  attachments: z.array(UploadRef).optional(),
    41	  fieldValues: z.record(z.unknown()).optional(),
    42	  configValues: z.record(z.unknown()).optional(),
    43	});
    44	export type JobCreateRequest = z.infer<typeof JobCreateRequest>;
    45	
    46	export const JobCreateResponse = z.discriminatedUnion('status', [
    47	  z.object({ status: z.literal('created'), job: Job }),
    48	  z.object({ status: z.literal('answered'), reason: z.string() }),
    49	]);
    50	export type JobCreateResponse = z.infer<typeof JobCreateResponse>;
    51	
    52	export const JobCancelResponse = z.object({ cancelled: z.boolean() });

hook: PreToolUse Completed
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/src/routes/jobs.ts | sed -n '35,55p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
    35	  r.post('/', async (req: AuthedRequest, res: Response) => {
    36	    const body = parseBody(res, JobCreateRequest, req.body);
    37	    if (!body) return;
    38	    const actor = actorOf(req);
    39	    const result = await handleBuildCreate({
    40	      actor,
    41	      username: req.user!.username,
    42	      sessionId: body.sessionId,
    43	      description: body.description,
    44	      language: body.language,
    45	      ...(body.templateId ? { templateId: body.templateId } : {}),
    46	      ...(body.integrationKeys ? { integrationKeys: body.integrationKeys } : {}),
    47	      ...(body.artifactId ? { artifactId: body.artifactId } : {}),
    48	      ...(body.attachments ? { attachments: body.attachments } : {}),
    49	      ...(body.fieldValues ? { fieldValues: body.fieldValues } : {}),
    50	      ...(body.configValues ? { configValues: body.configValues } : {}),
    51	      deps,
    52	    });
    53	    if (result.status === 'conflict') return sendError(res, 'DUPLICATE_BUILD', 'Já existe uma construção em curso para esta aplicação.');
    54	    if (result.status === 'answered') return res.status(200).json({ status: 'answered', reason: result.reason });
    55	    res.status(202).json({ status: 'created', job: result.job });

exec
/bin/zsh -lc "nl -ba api/src/agents/build.ts | sed -n '344,371p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   344	    // F1 knowledge-during-build (§5.5.2 knowledge area). The first-build scoping phase runs a
   345	    // DETERMINISTIC domain-heavy detector (no model call, no egress) over the request. A
   346	    // domain-heavy app NARRATES a knowledge request on the build stream (upload reference
   347	    // documents to the org knowledge area) and, when the request carried scoping-provided
   348	    // documents, ingests them into the org knowledge area for THIS run - org-scoped by the run's
   349	    // actor, refused for the reserved _shared partition, and immediately searchable to the
   350	    // knowledge tools mounted below. Non-blocking + non-fatal: the build never waits on or fails
   351	    // for knowledge scoping (mirrors the content/grounding layers).
   352	    if (opts.firstBuild) {
   353	      try {
   354	        const scope = detectDomainHeavy(input.description);
   355	        if (scope.domainHeavy) {
   356	          sink.planStep('knowledge-scope', knowledgeScopingNarration(scope.domains));
   357	          let indexed = 0;
   358	          for (const doc of input.knowledgeDocs ?? []) {
   359	            const { id } = await ingestBuildKnowledge(
   360	              input.actor,
   361	              { collection: doc.collection || 'uploads', title: doc.title, text: doc.text, sourceType: 'build-scoping' },
   362	              input.deps,
   363	            );
   364	            if (id) indexed++;
   365	          }
   366	          if (indexed > 0) sink.planStep('knowledge-indexed', knowledgeIndexedNarration(indexed));
   367	        }
   368	      } catch (err) {
   369	        console.warn('[build] knowledge scoping failed (non-fatal):', err instanceof Error ? err.message : err);
   370	      }
   371	    }

exec
/bin/zsh -lc "nl -ba api/src/agents/domain-scoping.ts | sed -n '72,96p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
    72	    key: 'financeiro',
    73	    label: 'financeira',
    74	    keywords: [
    75	      // PT - fees/tax/accounting (NOT "orcamento"/budget, which is common in generic apps)
    76	      'taxa', 'taxas', 'custas', 'honorarios', 'juros', 'imposto', 'iva', 'fatura', 'faturacao',
    77	      'contabil', 'contabilidade', 'tesouraria', 'tarifario', 'fiscal',
    78	      // EN - "tax" is omitted on purpose ("syntax"/"taxonomy"); the specific forms below are safe
    79	      'fee', 'fees', 'invoice', 'invoicing', 'vat', 'accounting', 'tariff', 'levy',
    80	    ],
    81	  },
    82	  {
    83	    key: 'saude',
    84	    label: 'clínica',
    85	    keywords: [
    86	      // PT
    87	      'clinic', 'clinico', 'paciente', 'doente', 'diagnostico', 'prescricao', 'medicamento',
    88	      'sintoma', 'terapeutica',
    89	      // EN
    90	      'patient', 'clinical', 'diagnosis', 'prescription', 'dosage', 'healthcare',
    91	    ],
    92	  },
    93	  {
    94	    key: 'seguros',
    95	    label: 'seguros',
    96	    keywords: [

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/tests/agents/build.test.ts | sed -n '258,272p;300,314p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   258	
   259	  it('scoping-provided documents are ingested via the seam with the RUN ACTOR org + narrated', async () => {
   260	    const t = resetAgentState({ finalText: 'built' });
   261	    const { events } = startEvents();
   262	    passVerify();
   263	    const seen: Array<{ actor: Actor; doc: BuildKnowledgeDoc }> = [];
   264	    setIngestBuildKnowledge(async (a, doc) => { seen.push({ actor: a, doc }); return { id: `kd_${seen.length}` }; });
   265	    const { mech } = fakeMechanics();
   266	    await execFirstBuild(t, mech, {
   267	      actor, username: 'u1', sessionId: 's1', language: 'pt', deps: deps(),
   268	      description: 'Gestão de apólices de seguro e sinistros',
   269	      knowledgeDocs: [{ title: 'Manual de subscrição', text: 'regras de subscrição e franquias' }],
   270	    });
   271	
   272	    // the seam saw the build actor's org (org-scoped by construction) + the scoping doc
   300	    resetAgentState({ finalText: 'ok' });
   301	    const { events } = startEvents();
   302	    passVerify();
   303	    let ingestCalls = 0;
   304	    setIngestBuildKnowledge(async () => { ingestCalls++; return { id: 'x' }; });
   305	    const fm = fakeMechanics();
   306	    const jobId = 'job-f1-followup';
   307	    const abort = new AbortController();
   308	    registerRun({ id: jobId, ownerUserId: 'u1', orgId: 'o1', kind: 'build', abort, startedAt: 0, artifactId: 'artK', sessionId: 's1' });
   309	    await persistJob({ _id: jobId, kind: 'build', status: 'created', userId: 'u1', artifactId: 'artK', request: { description: 'x', language: 'pt' }, createdAt: 'x' } as JobRecord);
   310	    setBuildMechanics(fm.mech);
   311	    // a domain-heavy description on a FOLLOW-UP must not trigger scoping
   312	    await executeBuildJob(jobId, { actor, username: 'u1', sessionId: 's1', description: 'adiciona o cálculo de taxas e custas', language: 'pt', artifactId: 'artK', knowledgeDocs: [{ title: 'x', text: 'y' }], deps: deps() }, abort, { firstBuild: false, artifactId: 'artK' });
   313	    expect(planSteps(events, 'knowledge-scope')).toHaveLength(0);
   314	    expect(ingestCalls).toBe(0);

codex
1. **High** — [shared/src/jobs.ts](/Users/ggomes/dev/ekoa-code/shared/src/jobs.ts:29), [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:35): the public build API cannot carry `knowledgeDocs` at all. `JobCreateRequest` does not declare the field, and the router never forwards it into `handleBuildCreate`, so real `POST /api/v1/jobs` requests silently lose the docs before F1’s ingest hook can see them. I verified this by parsing a request body with `knowledgeDocs`: Zod returned the object without that field. The new tests are misleading here because they inject `knowledgeDocs` directly into `execFirstBuild` / `executeBuildJob` instead of exercising the route path, e.g. [api/tests/agents/build.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/agents/build.test.ts:266).

2. **Medium** — [api/src/agents/build.ts](/Users/ggomes/dev/ekoa-code/api/src/agents/build.ts:352): the hook is not actually non-blocking. It `await`s every `ingestBuildKnowledge(...)` call serially before tool setup and before `runAgent` starts. If ingest is slow or stalls on disk/index I/O, the build just sits there and the agent never starts until that work finishes or times out. A single bad/slow document also prevents later docs from being attempted because the whole loop is wrapped in one outer `try`.

3. **Medium** — [api/src/agents/domain-scoping.ts](/Users/ggomes/dev/ekoa-code/api/src/agents/domain-scoping.ts:83): the health-domain detector has obvious PT+EN false negatives. Its keyword set omits common terms like `médica`, `médicos`, `hospital`, `consultas`, `medical`, `doctor`, and `hospital`. Reproducible misses: `detectDomainHeavy('Aplicação médica para médicos e hospitais')` and `detectDomainHeavy('Medical scheduling app for doctors and hospitals')` both return `domainHeavy: false`, so a clearly domain-heavy healthcare app will not trigger the knowledge request.

I did not find an org-isolation hole or `_shared` write bypass in this slice; the seam remains actor-bound and the existing knowledge guard still rejects `_shared`.

**NEEDS-WORK**
hook: Stop
hook: Stop Completed
tokens used
107,553
1. **High** — [shared/src/jobs.ts](/Users/ggomes/dev/ekoa-code/shared/src/jobs.ts:29), [api/src/routes/jobs.ts](/Users/ggomes/dev/ekoa-code/api/src/routes/jobs.ts:35): the public build API cannot carry `knowledgeDocs` at all. `JobCreateRequest` does not declare the field, and the router never forwards it into `handleBuildCreate`, so real `POST /api/v1/jobs` requests silently lose the docs before F1’s ingest hook can see them. I verified this by parsing a request body with `knowledgeDocs`: Zod returned the object without that field. The new tests are misleading here because they inject `knowledgeDocs` directly into `execFirstBuild` / `executeBuildJob` instead of exercising the route path, e.g. [api/tests/agents/build.test.ts](/Users/ggomes/dev/ekoa-code/api/tests/agents/build.test.ts:266).

2. **Medium** — [api/src/agents/build.ts](/Users/ggomes/dev/ekoa-code/api/src/agents/build.ts:352): the hook is not actually non-blocking. It `await`s every `ingestBuildKnowledge(...)` call serially before tool setup and before `runAgent` starts. If ingest is slow or stalls on disk/index I/O, the build just sits there and the agent never starts until that work finishes or times out. A single bad/slow document also prevents later docs from being attempted because the whole loop is wrapped in one outer `try`.

3. **Medium** — [api/src/agents/domain-scoping.ts](/Users/ggomes/dev/ekoa-code/api/src/agents/domain-scoping.ts:83): the health-domain detector has obvious PT+EN false negatives. Its keyword set omits common terms like `médica`, `médicos`, `hospital`, `consultas`, `medical`, `doctor`, and `hospital`. Reproducible misses: `detectDomainHeavy('Aplicação médica para médicos e hospitais')` and `detectDomainHeavy('Medical scheduling app for doctors and hospitals')` both return `domainHeavy: false`, so a clearly domain-heavy healthcare app will not trigger the knowledge request.

I did not find an org-isolation hole or `_shared` write bypass in this slice; the seam remains actor-bound and the existing knowledge guard still rejects `_shared`.

**NEEDS-WORK**
