# F11: Session rename no-ops + responses omit createdAt/updatedAt (apply the stashed fix)

**Severity / class:** medium / bug

**Symptom:** `PATCH /api/v1/sessions/:id` with `{name}` silently no-ops (the contract patches `name`; the
stored doc field is `title`, with no translation), and session responses omit the contract-required
`createdAt`/`updatedAt`. Evidence: `git stash@{0}`; `shared/src` vs
`api/src/services/platform-crud.ts`.

**Root cause (re-confirmed at current rc-1 - the fix is NOT applied to the tree):**
- `sessionView` (`api/src/services/platform-crud.ts:52`) returns `{id,userId,title,status,messageCount}`
  - no `name`, no `createdAt`, no `updatedAt`. The shared `Session`/`SessionSummary`
  (`shared/src/sessions.ts:18-41`) require `createdAt`+`updatedAt` (IsoTimestamp) and use `name`
  (optional), so responses are contract-invalid.
- `PATCH` passes the body straight through: `api/src/routes/sessions.ts:36`
  (`updateSession(s._id, body ...)`) into `updateSession` (`platform-crud.ts:64`) which spreads the
  patch onto a `title`-keyed doc - `name` never maps to `title`, so a rename does nothing.

**This fix already exists as `git stash@{0}`** ("pre-hardening-run: uncommitted sessions-contract fix").
It touches exactly three source files: `api/src/data/stores.ts` (adds `createdAt`/`updatedAt` to
`SessionDoc`), `api/src/routes/sessions.ts` (translates `name`->`title` in PATCH, threads `deps` to
`updateSession`), `api/src/services/platform-crud.ts` (`sessionView` emits `name` + `createdAt` +
`updatedAt` with an epoch fallback and omits `name` when titleless; `createSession` stamps timestamps;
`updateSession` bumps `updatedAt`; `addMessage` bumps `updatedAt`).

**How to apply safely (do NOT blind-pop):**
1. `git stash show -p stash@{0}` and read every hunk.
2. Re-confirm against the CURRENT tree (a later commit `5e91370` landed; these 3 files are clean at
   baseline now). Apply with `git stash apply stash@{0}` then review, OR re-create the hunks by hand.
3. Signature change check: the stash changes `updateSession` from `(id,patch)` to `(id,patch,deps)`.
   There is exactly ONE caller (`routes/sessions.ts:36`) and the stash updates it - confirm the build
   has no other caller (grep `updateSession`) before trusting it.
4. The contract test IS in the stash - `git stash push -u` stored the untracked file in the stash
   commit's THIRD parent (invisible to plain `git stash show`). Recover it with:
   `git show 'stash@{0}^3:api/tests/contract/sessions.test.ts' > api/tests/contract/sessions.test.ts`
   (96 lines, verified present). `git stash apply` also restores it. Review it against the criteria
   below and extend if it leaves any unasserted.

**Regression test first:** `api/tests/contract/sessions.test.ts` (contract suite, in-process factory).
BEFORE the fix it must fail: (1) `POST /sessions` response validates against `Session` via `safeParse`
with `createdAt`+`updatedAt` present; (2) `PATCH /:id {name:'X'}` then `GET` shows `name:'X'` (rename
round-trips, not a no-op) and `updatedAt` advanced past `createdAt`; (3) `GET /sessions` validates
against `SessionSummary` with timestamps; (4) a titleless session omits `name` (never `null`) and still
carries timestamps (epoch fallback). Extend if the stash left any of these unasserted.

**Acceptance:** rename persists and round-trips; `createdAt`/`updatedAt` present and schema-valid on
create/list/patch; `updatedAt` advances on rename and on `addMessage`; contract suite + schema-coverage
+ protocol-parity gates green; drop `stash@{0}` once landed.

**Notes:** no LLM/import-boundary/chokepoint impact; pure data-shape + contract fix. No diagram change
(no structural change). Ported e2e session specs must stay green (ekoa-testing: ported specs are never
edited to pass).
