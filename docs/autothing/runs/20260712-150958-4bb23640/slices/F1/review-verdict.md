# F1 (knowledge-during-build) — fresh-context adversarial review

**Verdict: APPROVE**

Commit under review: `376f560` (`feat(operator-run/f1): knowledge-during-build`). Reviewed
against FLOW_PLAN acceptance + the A3 design ground truth
(`analysis/03-knowledge-hooks.md`). Every load-bearing property was verified by reading the
seam + binding + build hook and by running the suites myself — not trusting the impl-notes.
The one substantive finding (detector precision) is bounded to non-blocking narration and does
not break, fail, or leak anything; it is worth tightening before the scoping UI exposes it
(F2/G), but it is not a blocker for this api slice whose live proof lands with F2.

## Evidence gathered (all independently run)

- **Tests, run from `api/`:**
  - `npx vitest run tests/agents/domain-scoping.test.ts` → **7 passed**.
  - `npx vitest run tests/knowledge/build-knowledge-ingest.test.ts` → **4 passed**.
  - `npx vitest run tests/agents/build.test.ts` → **20 passed** (incl. the 4-test F1 block).
  - Total 31 new, matches the commit claim.
- **Org isolation is structural, verified in source:** `ingestDocument`
  (`api/src/knowledge/service.ts:172-201`) derives the partition from `actor.orgId` for both the
  vault write (`:184`) and the index write (`:190`) — never from `input`. `assertNotSharedActor`
  (`:61-65`) runs first (`:173`) and throws `FORBIDDEN 403` for a `_shared` actor. The seam
  (`api/src/agents/seams.ts:82-101`) and the build call (`api/src/agents/build.ts:359-363`) pass
  `input.actor` through; the `doc` argument carries only `collection/title/text/sourceType` — no
  orgId channel exists. The isolation + `_shared`-403 tests are real assertions over a real FTS
  index + mongo-mem (`build-knowledge-ingest.test.ts:82-99`), not tautologies: they ingest with
  `actor('orgA')`, assert `search('orgB', …)` is empty (which also catches a `_shared` leak,
  since orgB search is dual-scope), and assert the `_shared` actor rejects with `code:'FORBIDDEN',
  status:403` and is a `KnowledgeError`.
- **No new auth/permission logic** in the diff (binding constraint held): the change reuses the
  existing `input.actor` threading and the existing `assertNotSharedActor` guard. The seam and the
  `server.ts` binding (`api/src/server.ts:220-236`) are pure forwarders; nothing grants, denies, or
  authenticates.
- **Egress: purely lexical.** `api/src/agents/domain-scoping.ts` has **zero imports** and only
  string ops (`fold`/`tokens`/`includes`/`startsWith`); no `@anthropic*`, no `api.anthropic.com`.
  `npm run gate:chokepoint` → clean. `domain-scoping.test.ts` proves `syntax`/`taxonomy` and the
  short-token `vat`→`vatican` guard stay silent.
- **Build-flow hook** (`api/src/agents/build.ts:352-371`): first-build only (`if (opts.firstBuild)`),
  wrapped in `try/catch` + `console.warn` (non-fatal — a throwing seam cannot fail the build),
  narrates `knowledge-scope` only inside `if (scope.domainHeavy)`, ingests only by looping
  `input.knowledgeDocs ?? []` inside that branch, and `knowledge-indexed` fires only when
  `indexed > 0`. The honest `{ id: '' }` default makes `if (id) indexed++` a no-op when unwired, so
  no false confirmation. Ingest at `:359` precedes the knowledge-tool mount at `:406`, so a doc is
  searchable to the same run — the "immediately searchable" claim holds. Follow-up skip verified by
  code + `build.test.ts` "follow-up builds skip knowledge scoping".
- **Contract:** `shared/` is untouched by the commit (`git show 376f560 --stat -- shared/` empty).
  `plan_step` is a valid `JobEvent` member with `status: z.string()`
  (`shared/src/events.ts:75-80`), so the two free-string statuses need no contract change; no new
  contract test required. `sink.planStep(status, description?, detail?)`
  (`api/src/agents/streaming.ts:109`) matches the call sites.
- **Tier/import boundaries:** `agents/` does **not** import `knowledge/` (the only `knowledge/`
  hit in `api/src/agents/` is a doc comment at `domain-scoping.ts:10`); the seam is bound solely in
  `server.ts`. `seams.ts` only adds a type-only `Actor` import from `@ekoa/shared` (allowed).
- **Typecheck / lint:** at the committed state, `npx tsc --noEmit -p api/tsconfig.json` → **exit 0,
  0 errors** (see Observation 1 for the working-tree caveat); `npx eslint` over the 6 changed source
  files → **exit 0**.
- **PT-PT copy** (`domain-scoping.ts:143-176`): formal register ("Pode carregar", asserted no
  "podes"), no emoji, no em/en-dash, brand-neutral (no "ekoa"), correct 1-vs-many agreement.

## Findings

### 1. [Medium] Domain detector fires on common software-building vocabulary (false positives)

`api/src/agents/domain-scoping.ts` — the `>=4`-char stem rule (`matchesKeyword`, `:47-51`,
`t === kw || t.startsWith(kw)`) and a few short/exact tokens fire on words that are ordinary in the
product's core use case (building software apps). Empirically verified against the real detector:

- `"Build a multi-tenant admin dashboard"` → **FIRE [imobiliario]** — `tenant` (`:112`) matches
  multi-tenancy, a ubiquitous SaaS term.
- `"A tennis court booking app"` and `"A courtesy call scheduler"` → **FIRE [juridico]** — `court`
  (`:79`, stem) matches `court`, `courtesy`, `courtroom`, `courtyard`.
- `"Sistema de login seguro para utilizadores"` → **FIRE [seguros]** — `seguro` (`:88`) is also the
  everyday PT adjective "safe/secure".

Concrete failure: for these very common requests the build stream narrates a confidently-wrong
knowledge request ("esta aplicação parece assentar em conhecimento especializado (área
imobiliária/jurídica/seguros)…"), and once F2/G surface the scoping-upload affordance the operator
sees a wrong-domain prompt on a mainstream SaaS request. **Blast radius is bounded**: the hook is
non-blocking and does not ingest unless `knowledgeDocs` is supplied, so nothing breaks, fails, or
leaks — this is a precision/UX defect, not a correctness or isolation one. Suggested tightening:
drop or word-boundary-guard `tenant`/`court`/`seguro`, or require a companion domain term. Given the
feature's entire job is to *detect* domain-heavy apps, the mis-fires on staple app-builder inputs
warrant fixing before the UI makes the narration visible.

### 2. [Low] `>=4`-char prefix-stem misses some PT plurals (false negatives)

`matchesKeyword` prefix-stem (`domain-scoping.ts:50`) does not catch inflections whose stem
diverges before the keyword ends, e.g. `fiscal` → `fiscais` (`fiscais`.startsWith(`fiscal`) is
false). Verified: `"faturas fiscais"` only fires because `fatura`/`faturacao` catches it, not
`fiscal`. Impact: occasional silent narration on a genuinely domain-heavy request. Low — the
keyword sets overlap enough that most such inputs still fire via a sibling term.

### 3. [Low] Partial mid-loop ingest failure emits no `knowledge-indexed` confirmation

`api/src/agents/build.ts:357-366`: if `ingestBuildKnowledge` throws on the Nth doc after N-1
already landed, the `catch` (`:368`) is reached before `if (indexed > 0)`, so the operator is told
nothing even though some docs were indexed and are searchable. Honest-but-incomplete; an edge case
(ingest rarely throws for a valid non-`_shared` actor). Consider narrating `indexed` in a `finally`
or catching per-doc. Low.

### 4. [Low] `área seguros` reads ungrammatically in PT narration

`domainLabels` (`domain-scoping.ts:158-166`) yields the label `seguros` verbatim, so
`knowledgeScopingNarration` produces "conhecimento especializado (área seguros)". PT wants "área de
seguros" (or "área seguradora"). The other five labels agree with "área" (jurídica, financeira,
clínica, imobiliária, de conformidade regulamentar). A one-word copy fix. Low/style.

## Observations (not F1 defects — flagged for the lead)

1. **Concurrent working-tree edit breaks the api src typecheck right now.** The working tree (not
   commit `376f560`) has an uncommitted 1-line edit to `api/src/routes/jobs.ts:51`
   (`...(body.knowledgeDocs ? { knowledgeDocs: body.knowledgeDocs } : {})`), which does **not**
   typecheck because the `shared/` build-job request schema has no `knowledgeDocs` field yet
   (`error TS2339` ×2). This is exactly the "jobs-route population + shared/ additive field"
   work F1 explicitly deferred to F2/G, now mid-flight by another agent. F1's *committed* src
   typechecks clean (verified: stashing that one line → `tsc -p api/tsconfig.json` exit 0, 0
   errors). Heads-up: whoever commits the `jobs.ts` line must add `knowledgeDocs` to the build-job
   request schema in `shared/src` in the same unit, or the build stays red.

2. **Narration slightly over-promises for non-legal domains.** The copy says uploaded docs "são
   tidos em conta nesta construção", but build *grounding* is legal-gated
   (`build.ts:385`, `agentKind:'coding'` → `isLegalContext`), so for e.g. insurance/health the docs
   are reachable only via the mounted `knowledge_search`/`knowledge_read` tools (`build.ts:406`),
   not proactively grounded. Defensible (the tools are mounted, so the agent *can* use them), and
   the impl-notes call this out as deferred. No action required for F1.

## Bottom line

All load-bearing invariants for F1's acceptance — org-scoped-by-construction ingest, `_shared`
refusal via the existing guard, no new auth/permission logic, purely-lexical detector with no
egress, first-build-only non-blocking hook, ingest only when domain-heavy AND docs supplied,
follow-up skip, `shared/` untouched with valid `plan_step` reuse, and real (non-tautological) tests
that I ran green — are verified. The findings are quality/precision items bounded to non-blocking
narration. **APPROVE.**
