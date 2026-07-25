# Word track changes and comments

Ekoa edits **existing Word documents** with NATIVE Word review artifacts: tracked changes
(`w:ins` / `w:del`, attributed author + date, visible in Word's review pane) and native comments
(`word/comments.xml`), preserving the original formatting (styles, numbering, runs). The lawyer
opens the result in Word and accepts/rejects as usual.

Ported from ekoa-dev (`docs/word-track-changes.md`) in track 2C and **rewritten against
ekoa-code's real seams**. Where the two systems differ, the difference is called out - nothing
here describes a dev-only capability as if it existed in this repo.

Module map: `services/docx-redline.ts` + `services/docx-comments.ts` (pure buffer engine) ->
`apps/document-source.ts` (per-artifact lifecycle) -> `apps/app-docx.ts` (served-app REST) and
`agents/sdk-tools.ts` `docxToolSpecs` (agent tools through `agents/seams.ts`). Ingest lives in
`integrations/docx-fetch.ts`. Everything is wired at the composition root (`server.ts`) and
nowhere else.

---

## 1. Engine: @adeu/core, pinned EXACTLY at 1.28.0

`api/src/services/docx-redline.ts` wraps `@adeu/core` (MIT). The dependency is pinned EXACTLY
(`"@adeu/core": "1.28.0"` in `api/package.json` - **no caret**): the wrapper works around
documented engine bugs, so a version bump invalidates it and must be re-validated against the
suites below. `jszip` is a runtime dep (container inspection), `fflate` a devDep. Deps hoist to
the root `node_modules` / `package-lock.json` (npm workspaces).

Service surface:

| Export | What it does |
|---|---|
| `applyRedline(buffer, ops, { author, timestamp? })` | Atomic batch of `RedlineOp`s (`modify` / `accept` / `reject` / `reply` / `resolve` / `unresolve`); returns `{ buffer, report }` |
| `acceptAllRevisions(buffer)` | Clean copy - every revision accepted (see §2.4: comments do NOT survive on 1.28.0) |
| `projectDocx(buffer)` | CriticMarkup markdown projection (`{++ins++}`, `{--del--}`, `{>>[Chg:N kind] author<<}`, `{>>[Com:N] author @ date: text<<}`) |
| `validateDocx(buffer)` | Container sanity check (ZIP opens, required parts present, `word/document.xml` parses) |
| `RedlineBatchError` | Per-op failures carrying adeu's messages VERBATIM (occurrence lists included) |

### 1.1 Op shapes (aligned with adeu's `process_batch`)

- **Replace**: `{ type: 'modify', target_text, new_text }` - applied as a MINIMAL diff (a pure
  addition inside a phrase yields only `w:ins`, no `w:del` pair - correct Word behavior; a
  replacement therefore spans several runs, so never assert on contiguous text in raw XML).
- **Delete**: `new_text: ''`.
- **Comment-only**: `new_text === target_text` plus `comment`.
- **Insert paragraphs**: keep `target_text` unchanged at the start of `new_text` and append `\n`
  continuation lines. Plain lines clone the anchor paragraph's `pPr` INCLUDING clause numbering -
  the correct way to continue numbered clauses. A `# ` prefix maps to Heading 1.
- `match_mode: 'strict' | 'first' | 'all'` - strict (default) fails an ambiguous target with an
  actionable occurrence list; surface it verbatim.
- `accept` / `reject` / `reply` / `resolve` / `unresolve` take the `Chg` / `Com` id (`target_id`)
  read off the projection.

### 1.2 Comment resolution (`resolve` / `unresolve`) - NOT an adeu op

adeu's `DocumentChange` union has no action that marks a comment thread done: it can create, reply
to and delete comments, and its projection REPORTS resolution (a `(RESOLVED)` suffix straight after
the date), but nothing sets the flag. `api/src/services/docx-comments.ts` adds it over the DOM
handles adeu exposes at the package boundary (`DocumentObject.pkg`), writing exactly what Word
writes:

```xml
<!-- word/commentsExtended.xml -->
<w15:commentEx w15:paraId="9D5593F0" w15:done="1"/>
<w15:commentEx w15:paraId="3A741BA2" w15:paraIdParent="9D5593F0" w15:done="1"/>
```

- **Thread-level, like Word.** Resolution belongs to the thread, so `setCommentThreadResolved`
  walks `w15:paraIdParent` to the root and flips every member. Callers may pass whichever
  `[Com:n]` id the user clicked (root or reply). `commentsExtended.xml` is the ONLY part that
  carries the state - `commentsIds.xml` and `commentsExtensible.xml` do not.
- **`w:comment` is never touched.** adeu's reader tolerates a `w15:done` there, but Word neither
  writes nor reads it, so setting it would make our projection disagree with Word's review pane.
- **Atomic with the engine ops.** `applyRedline` splits the batch: adeu's ops go to
  `process_batch`, resolve ops are applied on the SAME `DocumentObject` afterwards, before the
  single `save()`. That ordering is what makes a "reply then resolve" batch mark the newly created
  reply done too. Engine failure positions count only the ops adeu was given, so they are remapped
  back to positions in the CALLER's array. A resolve-only batch skips `process_batch` entirely and
  reports `engine: 'ekoa-docx-comments'`. The report gains `resolutions_applied` /
  `resolutions_unchanged` (an idempotent re-resolve counts as unchanged).
- **Package traps guarded** (each silently corrupts a .docx). `DocumentObject.relateTo` does NOT
  dedupe - it appends a `<Relationship>` with a fresh rId every call - so the part is related only
  when not already linked, and pre-existing duplicates are healed. `contentType` comes from the
  `[Content_Types].xml` Override, so a package shipping `commentsExtended.xml` without one falls
  back to a path lookup rather than growing a second, ignored part. Word keys `commentEx` on a
  comment's LAST paragraph while adeu keys it on the FIRST, so the existing entry is located by
  trying EVERY paragraph of the comment - matching one convention only would mint a spurious
  `commentEx` and resolve a phantom single-message thread.

### 1.3 Comment anchor repair (engine bug worked around)

A comment lives in TWO places: the record in `word/comments.xml` and the anchor in
`word/document.xml` (`w:commentRangeStart` / `w:commentRangeEnd` plus a run holding
`w:commentReference`). **@adeu/core 1.28.0 drops all three markers when it ACCEPTS a tracked change
whose region carried a comment**, leaving the record behind as an orphan. Word and Google Docs both
need the anchor, so the comment silently vanishes from the review pane while still sitting in the
file - and `docx_read` stops showing it too, because the projection derives `[Com:n]` markers from
the anchors.

`applyRedline` therefore snapshots every comment's anchored text (`captureCommentAnchors`) on the
freshly loaded commit document and, after the batch, restores any anchor the engine dropped
(`repairCommentAnchors`), re-attaching to the same text so the original **author, date and thread
are preserved** - re-creating the comment through a fresh `modify` would reattribute it to whoever
accepted the change, which is unacceptable on a legal review. Matching is whitespace-normalised and
run-granular. Report fields: `comment_anchors_repaired`, `comments_dropped`.

Two deliberate rules:

- A comment whose text is genuinely gone (an accepted deletion) is **removed**, record plus
  `commentEx` entry - a record pointing at nothing is invisible in every editor and would otherwise
  accumulate forever. This matches Word, which discards a comment when its anchor text is accepted
  away.
- A comment that was ALREADY unanchored before the batch is **left exactly as found**. Nothing in
  the file says where it belonged, so re-anchoring it would be a guess on someone's legal document.

A document that never had `commentsExtended` records no `paraIdParent`, so its comments are
independent threads - which is how Word displays them too. adeu's `w15:p` (parent comment id on
`w:comment`) is honoured as a fallback.

### 1.4 Engine quirks the wrapper defends against

- **The `'1.'` marker trap**: NEVER start an inserted line with a `1.`-style markdown marker - it
  maps to `pStyle ListNumber` and breaks the document's real numbering. (Baked into the agent tool
  guidance, `MODIFY_GUIDANCE`.)
- **`process_batch` MUTATES the op objects it receives** (stashes `_match_start_index` plus a
  CIRCULAR `_active_mapper_ref` holding live DOM nodes, consumed positionally on the next pass).
  Reusing one ops array for dry-run then commit misplaces every edit. The wrapper feeds each pass
  fresh shallow copies with underscore-prefixed keys stripped (`cleanOps`); never `JSON.stringify`
  ops after passing them raw to the engine.
- **Dry-run atomicity rule**: ALWAYS dry-run the whole batch on a throwaway `DocumentObject` first
  and commit on a second fresh load only if every edit resolves. A commit-side failure still throws
  before save - a partially mutated buffer is never returned. This keeps lawyer-facing batches
  atomic.
- `engine.timestamp = 'ISO'` pins revision `w:date`; comment `w:date` stays wall-clock (accepted).
  The service layer does NOT expose timestamp pinning, so **production revision dates are
  wall-clock** - only tests pin them.
- `report.version` self-reports a stale internal constant; harmless, not asserted.

---

## 2. Document lifecycle: `apps/document-source.ts`

`api/src/apps/document-source.ts` owns the artifact-linked document. It sits beside `app-files.ts`
(tier: apps), not in `services/`, because it is per-artifact state, not pure computation. All
business logic is here; the agent tools and the routes stay thin.

Per app, fixed well-known names colocated with the app's other data:

```
<EKOA_DATA_DIR>/app-data/{appId}/docx/document-source.docx    (as ingested, PRISTINE)
<EKOA_DATA_DIR>/app-data/{appId}/docx/document-current.docx   (with redlines)
<EKOA_DATA_DIR>/app-data/{appId}/docx/document-meta.json      ({fileName, origin, updatedAt})
```

`EKOA_DATA_DIR` defaults to `~/.ekoa/data` and is read live (tests point it at a temp dir).
`appFilesStore` was deliberately NOT reused: UUID blob names plus append-only metadata would need
an indirection layer, and re-linking would orphan blobs.

Load-bearing properties:

- **Path safety.** `docxDir()` is the SOLE builder of an app path, and it applies ekoa-code's
  `app-files.ts` ingress rule VERBATIM - `collectionName.safeParse(appId).success` AND
  `!appId.startsWith('usr.')`. (Dev used its `isValidCollection` + `isReservedScope` pair; this is
  the one deliberate deviation.) Every filesystem path in the module goes through it, so traversal,
  absolute paths, the reserved shared scope and out-of-charset ids can never reach the disk -
  whichever caller (agent tool context or route header) supplied the id.
- **Per-app write serialization.** `setSource`, `applyEdits` and `restoreSource` are
  read-modify-write sequences over the same fixed blob names, so each app id gets an in-process
  promise chain (`Map<appId, Promise>` tail-chaining, entries dropped when the tail settles). Two
  concurrent batches would otherwise silently drop one batch's tracked changes.
- **Atomic writes.** Every write is temp file + rename.
- **One ingest choke.** `setSource` rejects a buffer over `DOCX_MAX_BYTES` (25 MB) and rejects
  anything `validateDocx` will not open - the single point every ingest branch (path / url /
  provider) passes through, so a fetch-side check that was bypassed still cannot land.

Exports: `setSource`, `getStatus`, `getCurrent`, `getProjection`, `getClean`, `applyEdits`,
`applyReview`, `restoreSource`, `NoDocumentSourceError` (PT-PT message).

- `getClean` accepts every revision and names the result `{base}-final.docx`.
- `applyReview` is the served-app entry point: it resolves the author SERVER-SIDE from the artifact
  owner (`artifacts` -> `users`, fallback `"Ekoa"`) and then runs the same `applyEdits` pipeline, so
  a human reviewer's edits are attributed to them and stay distinct from the agent's.
- `restoreSource` re-derives the working copy from the PRISTINE source blob. It is the recourse
  behind the served app's "Repor original" action, and the reason the source blob is kept at all:
  accept/reject rewrite the working copy in place and Word has no undo once a revision is settled.

### 2.4 The clean copy does NOT keep comments (divergence from dev's doc)

ekoa-dev's doc claimed "`acceptAllRevisions` - comments SURVIVE (they are annotations, not
revisions - Word semantics)". **That claim is false for @adeu/core 1.28.0 and was never tested** -
dev's `acceptAllRevisions` is byte-identical to ours and its test only asserted the absence of
`w:ins`/`w:del`. Verified in this repo (2026-07-25): `accept_all_revisions` drops
`word/comments.xml`, `commentsExtended.xml`, `commentsIds.xml`, `commentsExtensible.xml` AND the
in-document anchors, so `POST /api/app-docx/clean` returns a document with no review thread at all.

The behavior is KEPT rather than worked around: for the "final copy to send to the counterparty"
use case, stripping internal review notes is the safer default (leaking them is a real legal risk).
The working copy (`GET /api/app-docx/current`) is unaffected and carries everything. This is PINNED
by a tripwire test (`api/tests/apps/docx-word-gate.test.ts`) so a future engine bump or a deliberate
fix flips the suite visibly instead of changing a lawyer-facing download silently. Recorded in
`docs/findings.md` (`docx-clean-drops-comments`).

---

## 3. Ingest: `integrations/docx-fetch.ts`

`api/src/integrations/docx-fetch.ts` resolves a lawyer-supplied link or cloud reference into real
`.docx` bytes. It is reached only through the `docx_source_set` agent tool - **no HTTP route
ingests a document today** (see §5).

Four shapes, and what each one actually does in this repo:

| Shape | Status here |
|---|---|
| Plain `https` URL | **Fully live.** Guarded direct fetch through `services/url-fetcher.ts` `guardedFetchFollow`, which re-runs `assertSafeUrl` + a resolved-IP re-check on EVERY redirect hop (strictly stronger than dev's hand-rolled loop): a public URL cannot 30x into loopback / private / metadata hosts. |
| Local `path` | **Fully live** (the tool's `path` branch). Resolved strictly INSIDE the run's allowed directories; traversal rejected. |
| OneDrive / SharePoint share link | Classified `graph-share` and downloaded via the Microsoft Graph shares API with the WORKSPACE M365 connection. **Degrades honestly**: until the workspace credential store is connected, the injected `getStatus` reports not-connected and the caller gets the PT-PT "ligue a integração" error - never a silent failure or a fake success. |
| Google Drive / Docs link, and `provider` + `fileId`/`query` (`fetchDocxFromCloud`) | Same: real code path over `integrations/app-cloud-files.ts` (native Docs auto-export to `.docx`), **honest not-connected degrade** until the workspace credential lands. `fetchDocxFromCloud` returns `chosenFrom` so the tool can report which file a `query` picked. |

Token access is an INJECTED seam (`{ getStatus, getAccessToken }`, the same shape
`app-cloud-files.ts` uses) built with `createDocxFetcher(deps)` at the composition root -
`docx-fetch.ts` never reaches into a credential store. The Graph / Drive download branches hit fixed
trusted hosts, so a raw fetch there is correct; the SSRF guard is for the request-derived URL.

25 MB is enforced THREE times on the direct path - declared `Content-Length`, a streaming byte count
that **cancels the body the instant the cap is passed** (an unbounded chunked response is never
buffered), and the final buffer - plus Graph's `driveItem.size`. HTML bodies (login pages) are
detected. All errors are PT-PT `Error.message`s handlers can surface directly. Whatever the branch,
`setSource` re-enforces the cap on the final buffer (§2).

---

## 4. Agent surface: three in-process tools, no separate MCP server

ekoa-dev shipped `cortex/src/adapters/docx-mcp.ts`, an SDK MCP server built with
`createSdkMcpServer` from `@anthropic-ai/claude-agent-sdk`. **That does not port**: only
`api/src/llm/` may import the provider SDK (FIXED-3/8/13). The three tools are re-expressed as
ordinary `SdkToolSpec`s in `api/src/agents/sdk-tools.ts` (`docxToolSpecs`) and mounted by the
chokepoint on the ONE in-process `ekoa` MCP server, so the wire names are **`mcp__ekoa__docx_*`**
(dev's separate `mcp__ekoa-docx__*` server is gone). Nothing changes for the model.

| Tool | Behavior |
|---|---|
| `docx_read` | Projection + a 4-line legend. With `path`, reads any `.docx` inside the allowed dirs; without arguments, reads the artifact's linked document. |
| `docx_source_set` | The ingest paths of §3; returns file name + the full projection. |
| `docx_apply_edits` | Atomic batch, `dry_run` supported; revisions attributed `"<username> (Ekoa)"`. |

Load-bearing details:

- A `RedlineBatchError` comes back as tool **CONTENT** (`{status:'rejected', applied:false,
  failures:[{index,error}]}`), never a throw, so the model reads adeu's occurrence guidance and
  self-corrects. It is detected by the error's own `name` + shape (the property-based precedent from
  `app-docx.ts`), so `sdk-tools.ts` needs no runtime import of the engine.
- `PROJECTION_LEGEND` and `MODIFY_GUIDANCE` are copied BYTE-FOR-BYTE from dev - they are
  prompt-engineering artifacts, not prose.
- Collaborators arrive ONLY through `DocxToolSeams` (`api/src/agents/seams.ts`), wired in
  `server.ts` and nowhere else; the honest default answers "Word document support is not wired in
  this deployment." as tool content. This is what keeps `agents/` from importing `apps/` sideways.
- `agents/build.ts` binds `appId = artifactId`, `userName = input.username` and
  `allowedDirs = [projectDir]` **from the run**, never from tool arguments.
- Mount policy (`agents/tools.ts`): `DOCX_TOOLS` are on the **BUILD** row only - they are
  artifact-bound. Chat and text-attachment runs do not carry them.

**DESCOPED, journaled** (`docs/decisions.md` 2026-07-25): dev also mounted a read-only `docx_read`
on chat-with-attachments. ekoa-code's text-attachments run class mounts no in-process tools and has
no attachment-path plumbing, so that subset is not ported; the descope is pinned by the no-appId
test in `tests/agents/docx-tools.test.ts`.

### 4.1 Routing a document review to the document base - PARTIAL here

The failure mode to guard against: a user drops a Word file into chat and asks to "revê este
contrato", and the assistant answers the proposed changes *inline in the chat bubble* instead of
producing the real redlined `.docx`.

The routing chain in this repo is: the chat agent emits the `[[EKOA_BUILD]]` marker (`agents/
markers.ts`) -> `apps/build-mechanics.ts` calls `classifyArtifactType(description, userId)` ->
`baseForType` picks the `document` base. Two of the three layers are in place:

**Layer 1 - the chat-agent skill (present, but generic).** `api/content/chat-agent/SKILL.md` carries
*"Entregáveis constroem-se, não se despejam no chat"*: any request for an artefact the user wants to
keep, use or share - software AND documents (proposta, relatório, apresentação, **contrato**,
orçamento) - must emit `[[EKOA_BUILD]]`, never be pasted whole into the chat bubble; a QUESTION about
the data ("resume isto", "qual é o mais barato?") stays conversation. It does NOT carry dev's more
specific rule that **reviewing / revising / redlining an EXISTING attached document** is a document
build - the rule is written around producing a NEW deliverable.

**Layer 2 - `classifyArtifactType` (present, 2C-S6).** `api/src/apps/artifact-type.ts` gained Word's
review vocabulary in the `document` signal - `registo/controlo de alterações`, `alterações
registadas`, `marcas de revisão`, `redline(s)`, `track(ed) changes`. Every phrase is **ANCHORED**: it
only fires when a document/Word noun sits within 40 characters in the same clause, because none of
these is Word-only vocabulary ("track changes no código", "registar alterações no inventário" are app
requests). Unanchored, they fall through to the classifier one-shot, whose prompt answers `app` when
in doubt. The misroute guard is pinned in `tests/apps/artifact-type.test.ts` - do not unanchor any
of these.

**Layer 3 - attachment awareness (ABSENT).** Dev threaded attachment filenames into
`selectBaseTemplate` / `detectBuildIntent` so that a `.docx` filename plus a review verb routed to
`document` even when the message is just "revê isto". Here those two functions are the generic ch05
classifiers in `agents/guided-build.ts` (currently unreferenced outside their own module), no
attachment filename reaches `classifyArtifactType`, and `build-mechanics.ts` classifies the
description text alone. So a request that leans on the ATTACHMENT rather than on the words can still
miss the document base. Open item (§8).

---

## 5. Served-app surface: `/api/app-docx` + the document base shell

`api/src/apps/app-docx.ts` is mounted at `/` in `server.ts` **after** the global JSON body parser
(its POST bodies are JSON). Scoped by the `X-Ekoa-App-Id` header like app-files, no JWT, FLAT
responses.

| Route | Response |
|---|---|
| `GET /api/app-docx/status` | `{ hasSource, fileName?, updatedAt? }` |
| `GET /api/app-docx/projection` | `{ markdown, fileName }` |
| `GET /api/app-docx/current` | redlined `.docx` bytes (Content-Disposition with RFC 5987 `filename*` for PT names) |
| `POST /api/app-docx/clean` | `{base}-final.docx` bytes, revisions accepted (§2.4: no comments) |
| `POST /api/app-docx/edits` | `{ ops: RedlineOp[] }` -> `{ markdown, fileName, report }` (200) or `{ error, failures }` (422) |
| `POST /api/app-docx/restore` | `{ markdown, fileName }` - re-derive the working copy from the pristine source |

`shared/src/served-app.ts` carries the descriptors + zod schemas (`appDocxStatus`,
`appDocxProjection`, `appDocxCurrent` and `appDocxClean` as `kind:'binary'`, `appDocxEdits`,
`appDocxRestore`), all COVERED in the schema-coverage gate, with contract tests in
`api/tests/contract/app-docx.test.ts`.

- **`/edits` is the human review surface**: accept/reject a tracked change
  (`{type:'accept'|'reject', target_id}`), add a comment (`{type:'modify', target_text, new_text:
  same, comment}`), reply (`{type:'reply', target_id, text}`), resolve/reopen
  (`{type:'resolve'|'unresolve', target_id}`). Op `type` is allow-listed at the route; the engine
  validates structure; `RedlineBatchError` maps to 422 with per-op failures verbatim. The author is
  resolved SERVER-SIDE (§2) and never trusted from the client.
- **No ingest route.** Linking a source document happens through `docx_source_set`, not over HTTP.
  `docx-fetch.ts` is therefore not consumed by this router - a deliberate deviation recorded rather
  than a route invented to use it.
- 404 JSON on `NoDocumentSourceError`, 400 on a missing/invalid header, 500 otherwise. The GET
  routes and `/clean` parse no body (the platform's `ekoaFetch` always sends
  `Content-Type: application/json` with an empty body; the global `express.json()` yields `{}`).
- The service functions are an INJECTED seam; the router hard-wires no singleton and maps error
  taxonomy by the error's own `name`/shape, so it imports no collaborator at runtime.

### 5.1 Trust model - state it plainly

**This plane authenticates NO caller.** Same posture as `/api/app-files`: whoever holds the app id
can read and mutate that app's document - read the full text, download the bytes, and PERSIST
tracked changes whose author is stamped as the ARTIFACT OWNER. `admitApp` gates the resolved
**owner's** activation (403 `ACCOUNT_DISABLED` / 402 `BILLING_LOCKED`, fail-closed - an ekoa-code
improvement over dev that is kept), not the caller's identity. A deleted artifact's id resolves to
null, so the gate is skipped and the orphaned blobs stay readable to anyone holding the id.

This is the pre-existing served-app posture, recorded as the HIGH gap
`served-app-data-unauthenticated-writes` in `docs/findings.md` + `docs/security.md`, and PINNED as a
tripwire in `api/tests/security/app-docx-authz.test.ts` so a future hardening flips the suite
visibly.

### 5.2 The document base shell (source mode)

`api/assets/bases/document/scaffold/frontend/src/App.jsx` has two modes. Authored mode renders
`blocks` (including ekoa-code's own `pagebreak` / `signatures` types - the graft is additive and
that half is pinned by its own e2e test). **Source mode** activates when `documentData.sourceDocument`
is set: it fetches the projection via `window.__ekoa.fetch`, renders it as a preview (CriticMarkup
parsed to ins/del spans + PT-labelled Chg/Com chips; preview numbering is clause-local, the real
numbering lives in the docx), shows the PT-PT banner *"Documento original: {fileName} - as alterações
são registadas (registo de alterações do Word)"*, and offers "Descarregar Word (alterações
registadas)" / "Descarregar versão limpa" / "Repor original". Cloud save in source mode uploads the
`/current` bytes under the original file name.

Interactive review: each rendered tracked change is clickable to reveal Aceitar/Rejeitar; selecting
text floats an "Adicionar comentário" button opening a composer; each thread card carries
Responder + Resolver/Reabrir. All post to `/api/app-docx/edits` and re-render from the returned
`markdown`. A del/ins replacement pair is settled by sending an accept/reject op for each paired Chg
id in ONE batch. 422 reasons surface as a dismissable PT-PT toast through a failure-family mapper -
the engine's own English (`Action 1 Failed: Target ID 9999 not found.`) must never reach a PT-PT
reader, which the e2e provokes for real. "Repor original" confirms first, then POSTs `/restore`.
All interactive chrome is `no-print` + `data-no-pdf` so downloads/PDF stay clean.

Meta-span parsing is line-based, because ONE `{>>...<<}` span carries several entries and mixes
kinds: the projection emits every `[Chg:n kind]` line for an anchor followed by every `[Com:n]` line
of the threads anchored there, and a comment body may itself span lines. Comments of one span render
as a single thread card (one row per message). Resolved state is parsed from the `(RESOLVED)`
suffix; the header/body split is the FIRST `": "`. Chips are RECTANGLES, not pills (a 999px radius
on a multi-line chip draws an ellipse that crosses the text box). Blocks left empty by a
marker-only source line are dropped rather than rendered as a bare bullet or a blank heading band.

---

## 6. Tests

| File | What it pins |
|---|---|
| `api/tests/services/docx/docx-redline.test.ts` | Engine wrapper: authorship + pinned dates, comments wiring, formatting preservation (untouched paragraphs and `styles.xml`/`numbering.xml` byte-identical), atomic batch rejection with adeu's occurrence guidance, CriticMarkup projection, container validation |
| `api/tests/services/docx/docx-comments.test.ts` | Resolution: thread-wide flip from root or reply id, the exact `w15:done` OOXML with `w:comment` left clean, idempotence, reply-then-resolve in one batch, caller-array failure indexes, the three package traps, and comment-anchor survival across accept |
| `api/tests/apps/document-source.test.ts` | `docxDir()` path safety (14 rejection families + a 200-case deterministic generative sweep), the 25 MB cap, per-app write serialization, `applyReview` owner attribution, `restoreSource` |
| `api/tests/apps/docx-word-gate.test.ts` | **The gate** (§7): the native-Word proof over the real lifecycle and the re-upload round-trip |
| `api/tests/integrations/docx-fetch.test.ts` | URL classification, SSRF pre-check + redirect-hop rejection, the 25 MB triple incl. the streaming cancel, Graph/Drive branches + honest not-connected degrade, `fetchDocxFromCloud` |
| `api/tests/apps/app-docx-routes.test.ts` | All six routes over a real mounted router + real document-source, incl. the owner-activation gate |
| `api/tests/contract/app-docx.test.ts` | Every 2xx body against its named `shared/` schema; binary magic; the non-2xx envelopes |
| `api/tests/security/app-docx-authz.test.ts` | The unauthenticated-plane TRIPWIRE (§5.1) + a mount probe over the real `buildApp` |
| `api/tests/agents/docx-tools.test.ts` | The three tools over the real engine + lifecycle, the mount policy (chat/text-attachments must NOT carry them), the path jail, `RedlineBatchError` -> content, the not-wired default |
| `api/tests/apps/artifact-type.test.ts` | The anchored review-vocabulary routing + the misroute guard |
| `web/e2e/document-redline.spec.ts` | The served review surface end-to-end through the REAL base scaffold: accept, comment on a selection, reply, resolve, restore - proved by unzipping the downloaded `.docx`, not by the DOM; the PT-PT 422 path; and the authored-mode no-regression half |

Shared scaffolding (not census files): `api/tests/services/docx/contrato-fixture.ts` (a PT-PT
contract with real accents and numbered clauses), `web/e2e/fixtures/contrato-redline.docx`
(regenerate with `scripts/make-redline-fixture.mjs`, which drives the product's own engine so the
committed binary stays auditable).

Every suite above is registered in `api/tests/SUITE_LEDGER.json`. All of them are hermetic and
LLM-free.

---

## 7. The docx gate

The gate for track 2C. Sub-checks, and how to run each:

| # | Check | How |
|---|---|---|
| a | Served review path: accept / comment / reply / resolve round-trip through the real routes | `node scripts/dev-api.mjs --built` then `npx playwright test web/e2e/document-redline.spec.ts` (or the whole lane: `npm run e2e:server`) |
| b | Native Word proof: `w:ins`/`w:del` carry author + date, `word/comments.xml` exists and is wired, `commentsExtended.xml` carries `w15:done`, the clean file is free of ins/del markup | `npx vitest run tests/apps/docx-word-gate.test.ts --root api` (also runs in `npm test`) |
| c | LibreOffice conversion smoke | `npm run build --workspace api && node scripts/docx-libreoffice-smoke.mjs` - converts both produced `.docx` files to PDF and asserts non-empty output. Requires `soffice`/`libreoffice` on PATH; without it the script reports **NOT RUN** honestly (`--require` turns that into a failure) |
| d | Re-upload round-trip: a produced redlined `.docx` re-linked with `setSource` keeps usable projection ids | in `tests/apps/docx-word-gate.test.ts` - re-links the produced bytes AND a repackaged copy, then drives an accept/reject by an id read off the RE-INGESTED projection |
| e | Agent path: "revê este contrato com track changes" through the real dashboard producing a redlined doc | NOT hermetic - needs a live model credential and the dashboard (§7.1) |

The tool-level equivalent of (e) is covered deterministically by `tests/agents/docx-tools.test.ts`
(the three tools over the real engine and the real lifecycle, LLM-free). What (e) adds on top is the
*routing* half - that a chat request actually reaches the document base and mounts the docx tools.

**A desktop Word review-pane pass remains the gold standard and is still a human step** (§8).

### 7.1 Running the agent path (e) by hand

```bash
npm run build --workspace api                      # the dev api serves api/dist
node .claude/skills/run-ekoa-code/driver.mjs up    # boots api + web
npm run dev:auth                                   # re-provision the model credential (dev Mongo is ephemeral)
```

Then, in the dashboard at `http://localhost:3000`: start a chat, attach or reference a `.docx`, and
ask *"revê este contrato com track changes"*. Expected: the request classifies as a `document`
artifact (§4.1), the build run mounts `mcp__ekoa__docx_source_set` / `docx_read` /
`docx_apply_edits`, the agent links the file and emits a batch, and the served app opens in source
mode with the redline preview. Verify the FILE, not the chat bubble: download
`GET /api/app-docx/current` and unzip it.

---

## 8. Open items

- **Desktop Word validation.** Outputs are verified structurally (OOXML assertions) and by
  LibreOffice conversion; a human pass in desktop Word (review pane, accept/reject, comment threads)
  is still pending.
- **Chat-side routing of a document review (§4.1).** The attachment-awareness layer is absent: no
  attachment filename reaches `classifyArtifactType`, and the chat-agent skill's build rule is
  written around producing a NEW deliverable rather than redlining an existing one. A request that
  leans on the ATTACHMENT rather than on review vocabulary can still be answered inline.
- **Chat-with-attachments `docx_read`** - descoped (§4), waiting on an attachment-path plumbing +
  tool-mounting story for the text-attachments run class.
- **Workspace cloud credentials.** The Graph / Drive ingest branches are implemented and degrade
  honestly; they go live when the workspace credential store is connected.
- **Write-back to the original OneDrive/SharePoint item** (PUT with eTag/If-Match for conflict
  safety) - today the flow downloads a copy; saving back to the source item is not implemented.
- **Per-user SSO Files scope.** Cloud ingest uses the WORKSPACE integration; fetching "the user's
  own" files through end-user M365 SSO is not wired.
- **The `/api/app-docx` plane authenticates no caller** (§5.1) - tracked as the HIGH finding
  `served-app-data-unauthenticated-writes`.
