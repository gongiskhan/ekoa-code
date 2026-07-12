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

- **Knowledge uploads** — `POST /api/v1/knowledge/uploads` (`knowledge.ts:129-150`):
  - **raw binary body** (`expressRaw({ type: '*/*', limit: UPLOAD_LIMIT })`), NOT multipart.
  - Filename via **`X-Filename` header** (URL-decoded), collection via optional **`X-Collection`
    header** (`knowledge.ts:130-135`).
  - **Size limit 50 MB** default, env-overridable `EKOA_KNOWLEDGE_UPLOAD_MAX_SIZE`
    (`knowledge.ts:24-25`).
  - **Formats indexed:** plain text/markdown only (`.md`, `.txt`, `.markdown`, or `text/*`
    content-type — `service.ts:248-254`). Everything else is stored as a blob and registered
    `unindexed` (`service.ts:282-285`).
- **Generic uploads plane** — `shared/src/uploads.ts:14-22` declares `POST /api/v1/uploads`
  (`auth: 'user'`, `kind: 'binary'`) returning `{ uploadId, displayName, size, folderRoot? }`.
  (No `api/src/routes/uploads.ts` was found in this pass — the contract exists; the binary-plane
  handler is elsewhere/generic. Flagged as a gap to confirm if F1 targets this plane.)
- **Chat attachments** — chat already has an attachments notion: `input.attachments`
  (`chat.ts:136`) flips routing to a code-generation hint and the `text-attachments` tool policy
  (Read/Glob/Grep, **no knowledge tools mounted**, `chat.ts:137-149`). This is a *build/coding*
  attachment path, not a knowledge-ingest path.

### Could build-chat accept uploads mid-run today, or does F1 need a new path?

- The **knowledge upload route accepts an upload at any time** (it is independent of a run) and
  ingests text into the org vault synchronously. A client *could* upload to
  `/api/v1/knowledge/uploads` mid-conversation, and a subsequent build/chat turn would then find it
  via grounding/tools (index write is immediate, §2).
- But there is **no wiring that ties an upload into the *current* build run** — no "attach this doc
  to this session" flow, and the build/chat SSE run does not itself accept a file body. So:
  - **If F1 = "documents the user uploaded to the org are available to the build agent"** → already
    works via the existing upload route + the grounding/tools the build already mounts (§2, §3). No
    new path.
  - **If F1 = "upload a file *inside* the build-chat turn and have it ingested + grounded for that
    run"** → needs a **new upload path** (either a new endpoint or extending the build-chat request
    to carry a doc), then a `ingestDocument` call before/at run assembly. The plumbing to *call*
    ingest exists (§2); the *transport* to receive a file mid-run does not.

---

## 5. Knowledge tests inventory (`api/tests/knowledge/`)

| File | What it covers | F1/D1 relevance |
|---|---|---|
| `grounding.test.ts` | legal-context detector; cited-or-silent (both branches); build gating; **org partition** (`:75-82` orgB never sees orgA); shared-corpus grounding (`:83-`) | **D1** extends: assistant grounds under owner org; shared-corpus hit surfaced |
| `index-store.test.ts` | accent folding; ranking; write/delete hooks; **org partition — cross-org search impossible** (`:69-82`); shared dual-scope (`:103-135`); doc-map invariant; query-builder injection-safety | **F1/D1** rely on these; new ingest must keep the invariant green |
| `service.test.ts` | ingest+delete (`:39-50`, write hook indexes); uploads (`.md` indexed, binary un-indexed); **cross-org: orgB cannot delete orgA uploads** (`:77`); `readDocWithShared` shadow/fallback (`:84-107`); **`_shared` write-protected 403** (`:111-126`); backfill+reindex | **F1** extends: mid-build ingest is a new `ingestDocument` caller — add a test that a build ingest lands in the *build actor's* org and is searchable, and that it CANNOT write `_shared` |
| `importer.test.ts` | `parseOldDoc` mapping; dry-run writes nothing; execute writes `_shared` vault+index; idempotency/force/prune; source-under-data-dir guard | Unchanged by F1/D1 (offline `_shared` path) |
| `vault.test.ts` | frontmatter round-trip; CRUD+browse; **org partition** (`:68`); path-traversal guard | Underpins F1/D1 isolation; unchanged mechanics |

**Cross-org isolation tests that already exist (inventory only — do NOT design changes):**
- `index-store.test.ts:69-82` — orgA search never returns orgB docs (same terms).
- `index-store.test.ts:103-135` — dual-scope: own + `_shared` only; `scope` never leaks `orgId`;
  `_shared`-scope caller reads only `_shared`; `clearOrg` touches one partition.
- `grounding.test.ts:75-82` — slot-5 builder for orgB never surfaces orgA knowledge.
- `service.test.ts:77` — orgB cannot delete orgA uploads (uniform not-found).
- `service.test.ts:111-126` — `_shared` write-protected (403) for a shared actor.
- `vault.test.ts:68` — orgB never sees orgA documents/collections.

**F1/D1 slices must extend:**
- **F1** → `service.test.ts`: a new "ingest during build" test asserting the doc lands in the build
  actor's org (searchable via `search(orgId, ...)`), is invisible to a second org, and a
  `_shared` build actor is refused. Grounding/tool tests already cover the *retrieval* side.
- **D1** → `grounding.test.ts` (+ a new route/contract test): assistant grounding runs under the
  **artifact owner's** org, not a caller-supplied one; a served visitor cannot steer org; every
  response validates against `AssistantChatResponse` (contract test — new endpoint = new contract
  test, per QA layer 3). The cross-org isolation guarantees above are the invariants D1's route
  must not break.

---

## Memo input — does F1 need a NEW hook, or a plain call into `knowledgeService`?

### F1 (knowledge-during-build): **a plain call, plus (conditionally) a new upload transport.**

- **Retrieval into the build is already wired.** `build.ts` already:
  - grounds knowledge with the build actor's org — `knowledgeGrounding({ userId, orgId,
    query: input.description, agentKind: 'coding' })` (`build.ts:347`), block folded into the
    build system prompt (`build.ts:359`); and
  - mounts the `knowledge_search` / `knowledge_read` in-process tools with the actor —
    `knowledgeToolSpecs(input.actor)` (`build.ts:365`, `sdk-tools.ts:27-71`).
  So a build agent *already* reads org + `_shared` knowledge. **No new retrieval hook needed for
  F1.** (Note the build-grounding self-gates to legal-context via `kind:'build'` — if F1 wants
  builds to always ground regardless of legal keywords, that is a one-line policy change at
  `server.ts:215-217` / `build.ts:347`, not a new hook.)
- **Ingest into the org mid-build is a plain service call.** `ingestDocument(input.actor,
  {...}, input.deps)` (`service.ts:172-201`) — legal downward tier-5→tier-3 import (unrestricted by
  lint, §2), immediately searchable, no rebuild/optimize. If the team wants to preserve the
  seam convention, add a thin `setKnowledgeIngest` seam mirroring the existing knowledge seams
  (`seams.ts:56-96`, `server.ts:227-239`); but that is a *style* choice, not a requirement — a
  direct import is legal and simpler.
- **The one place F1 may need genuinely new code:** a **transport to receive a file *within* the
  build-chat turn**. The existing knowledge-upload route (`knowledge.ts:129-150`, raw body +
  `X-Filename`, 50 MB) ingests fine but is decoupled from any run. If F1's UX is "drop a file into
  the build conversation and use it now", the run request/SSE flow must carry (or reference) the
  upload, then call `ingestDocument` at context assembly. Evidence: no run endpoint accepts a file
  body today; `chat.ts` attachments (`chat.ts:136-149`) are a code/Read-Glob-Grep path, not a
  knowledge-ingest path.

### D1 (served-app assistant): **a NEW route, reusing existing knowledge functions — no new knowledge hook.**

- The endpoint **contract exists** (`shared/src/app-assistant.ts:22-30`, `/api/app-assistant`,
  `header-scoped`) but **no route implements it** — verified: no match for
  `app-assistant`/`assistantChat`/`appAssistantRouter` in `api/src/server.ts`,
  `api/src/routes/index.ts`, or any `api/src/routes/*assist*` file.
- The retrieval pieces D1 needs are all present and org-parameterised: `buildGroundingBlock`
  (`grounding.ts:65`, use `kind:'chat'`), `searchKnowledgeIndex` / `readDocWithShared`
  (`index.ts:24-25`, `server.ts:227-239`), and `knowledgeToolSpecs` (`sdk-tools.ts:27`). D1 reuses
  them **under the artifact owner's org**, resolved server-side: `X-Ekoa-App-Id` →
  `resolveApp` → `ownerUserId` (`registry.ts:24-50`) → owner `orgId` (`stores.ts:54`,
  `helpers.ts:11-13`), gated by `admitOwner` (`served-data.ts:85-101`). The org must come from the
  resolved owner, never the anonymous visitor — consistent with the standing "orgId from actor, not
  arguments" rule (`sdk-tools.ts:1-6`).

**Bottom line:** neither F1 nor D1 needs a new *knowledge-area* hook to read/ground. F1 = an
enrichment of the build's existing grounding + a plain `ingestDocument` call (a run-scoped upload
transport is the only possibly-new plumbing). D1 = a new *route* under `apps/` (or `routes/`)
that resolves owner-org from the served-app header and reuses the existing grounding/search
functions.
