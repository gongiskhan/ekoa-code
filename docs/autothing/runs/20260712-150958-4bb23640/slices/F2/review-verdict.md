# F2 fresh-context adversarial review verdict

**Commit:** 528cd9b `feat(operator-run/f2): fees app + seeded docs + cited-answer live gate`
**Reviewer:** fresh-context (no prior stake); static review + claims cross-checked against source and `slices/F2/live-output.txt`. Did NOT run the live driver.
**Diff reviewed:** `api/tests/e2e/fees-knowledge.e2e.mjs` (new, 335 lines) + 3 run docs (`slices/F1/followup-detector-precision.md`, `slices/F2/impl-notes.md`, `slices/F2/live-output.txt`). No production code, no security/permission logic, chokepoint untouched (confirmed by `git show --stat`).

## VERDICT: NEEDS-WORK

One Medium blocker (Finding 1) — cheaply fixable (a per-run unique token) and it corrects a false self-claim in the driver's own docstring. Everything else holds: the assertion honesty (the crux) is sound on every leg, the transient hardening and budget caps are real, and the fixtures are clean. The recorded PASS is not spurious — F1 is genuinely proven this run — but the committed artifact's *re-run* integrity (an explicit acceptance requirement) is broken, and the evidence already shows it manifesting.

---

## What holds (evidence-backed)

**Assertion honesty — the crux — HONEST on all four sub-checks:**

- (a) **Narration matches the REAL plan_step statuses + PT-PT copy properties.** The driver keys on `e.type === 'plan_step' && e.status === 'knowledge-scope'|'knowledge-indexed'` (driver:271-273), which is the exact shape `JobStreamSink.planStep` emits (`streaming.ts:109-110` → `{ type:'plan_step', status, description }`) via the hook (`build.ts:363,377`). It reads `.description`, the field the sink sets. It requires the domain named (`/financeira/`, driver:285), the org-knowledge-area phrasing (`/conhecimento/ && /organiza/`, driver:286,295), and the **exact `\b1\s+documento\b` count** (driver:293). I traced the copy: `knowledgeScopingNarration(['juridico','financeiro'])` yields "…(área jurídica e financeira)… área de conhecimento da organização…" and `knowledgeIndexedNarration(1)` yields "Foi indexado 1 documento na área de conhecimento da organização…" (`domain-scoping.ts`). The `\b1\s+documento\b` regex is genuinely count-sensitive: `knowledgeIndexedNarration(2)` produces "…2 documentos…" (plural noun), which the regex rejects — so the assertion truly ties to exactly one ingested doc. No emoji/dash assertions run against these two strings (driver:287-288,296-297).

- (b) **CITED triple requires ALL THREE and a refusal-with-citations FAILS.** Pass condition is `seededCited && factCited && !refused` (driver:319). `seededCited` requires a `citations[].title` containing `EKF-2211` (driver:315) — the citation shape is real (`app-assistant.ts:268-271` maps `grounding.hits[].title` into `citations[].title`). `factCited` tests the reply for `/cinquenta\s+e\s+cinco|55/` (driver:91), a *fabricated* value obtainable only from the seeded doc's grounding snippet — so it genuinely depends on the doc being grounded, not model priors. A refusal sets `refused=true → !refused=false`, failing the gate even with citations present. Honest.

- (c) **Seed reaches the org ONLY via the build's `knowledgeDocs`.** Grep confirms no `POST /knowledge/documents` (or any knowledge POST) anywhere in the driver — the sole knowledge path is `knowledgeDocs:[KB_DOC]` on the build POST (driver:207). The route forwards it (`routes/jobs.ts:51`), the contract validates it (`shared/src/jobs.ts:46-54`, max 20 / 256 KiB), and the hook ingests it org-scoped via `ingestBuildKnowledge(input.actor, …)` (`build.ts:367`). The assistant grounds only under the server-resolved owner org (`app-assistant.ts:267`, `input.owner.orgId`). So the cited doc provably entered through the build — exactly F1's claim.

- (d) **Subscribe-then-poll ordering + replay ring closes the attach-after-`fire()` race, and a miss fails loud.** The route sends the 202 then calls `result.fire()` (`routes/jobs.ts:57-58`), so the build (and its early narration) starts after the POST returns; the driver subscribes to the SSE immediately after (driver:264-267) and only then polls. The narration can fire in the ~ms window before the SSE fetch lands, but `collectJobEvents` opens with `Last-Event-ID: 0` (driver:126,134), and `attach` replays every buffered event with `id > 0` (`sse-manager.ts:43-44`) from the per-job ring (200 events, not idle-swept during an active build). `writeFrame` emits real `id:` lines (`sse-manager.ts:74`), so reconnects replay only the gap (no loss/dupes). If the narration is never captured, `assert(scope,…)`/`assert(indexed,…)` (driver:283,292) fail loud — no vacuous pass. Note: `verifySseToken` reuses the JWT verify (`middleware.ts:59-73`), so the login token works directly as `?token=`, and the owner owns the job so the pre-attach ownership check passes.

**Transient hardening — bounded, fails loud past caps:** build-poll tolerates 30 *consecutive* transients, resetting on any good poll, then fails (driver:68,218-223); SSE reconnects capped at 5 total (driver:70,145,161); the build-creation POST is single-shot, never retried (driver:197-208) — a blip there fails loud rather than spawning a second build. All bounds are real (not infinite).

**Budget — capped and enforced:** `LLM_BUDGET=3` HTTP turns, enforced both in `assistantTurn` (driver:296-298) and the loop bound (driver:313); the build is one single-shot job. impl-notes accounts the real spend transparently: 2 builds total (run-1 crashed poll-side after its build completed server-side; run-2 green) + 1 assistant turn (green run, first attempt). Within caps.

**Fixtures — clean.** `FEES_DESC`, `KB_DOC.title`, `KB_DOC.text`, `FEES_Q` are well-formed PT-PT with no emoji and no em/en-dash. (The em-dashes flagged in Finding 3 are in English code comments, not the fixtures; the `const DASH = /[—–]/` at driver:99 intentionally contains the char — it is the detector.)

---

## Findings

### 1. [MEDIUM — BLOCKER] Fixed `KB_TOKEN` + per-build re-ingest with no cleanup breaks the CITED leg's re-run isolation; the driver's docstring falsely claims otherwise
**Files:** `api/tests/e2e/fees-knowledge.e2e.mjs:78` (`const KB_TOKEN = 'EKF-2211'` — a hardcoded constant), `:83-88` (`KB_DOC`), `:315` (`c.title.includes(KB_TOKEN)`), `:51-52` (docstring: *"Idempotent (each run seeds a fresh doc; the distinctive token keeps re-runs unambiguous)"*). Evidence: `slices/F2/live-output.txt` citations line + `impl-notes.md` "LLM budget accounting".

The token is **fixed across runs**, the doc is ingested **fresh through every build** (no upsert/dedup on the `ingestBuildKnowledge` path — `sourceType:'build-scoping'` inserts), and **nothing cleans it up**. So each run leaves another byte-identical "Circular EKF-2211" doc in the owner org, and the CITED assertion (`title.includes('EKF-2211')`) matches **any** of them.

This is not hypothetical — it is already happening. The green run's own citations are `["Circular EKF-2211","Circular EKF-2211","Acórdão…","Acórdão…","Acórdão…"]` (`live-output.txt`): **two** identical EKF-2211 docs, one ingested by run-1's build (`4d2ff6e0`, which impl-notes confirms "completed server-side" and thus ingested its knowledgeDoc before the driver crashed) and one by run-2's build. This is the exact scenario the review mandate names as a real finding: *"a second run's citation assertion matching the FIRST run's doc."*

**Concrete false-pass scenario:** on a future run, suppose F1's ingest regresses to "returns an id (narration fires `1 documento`) but the doc is not actually searchable to grounding" (wrong partition, index write dropped, grounding stops reading `build-scoping` docs). The NARRATED leg still passes (the `knowledge-indexed` narration is driven by the returned id, not by searchability), and the CITED leg passes because a **prior run's** identical residue doc surfaces and is cited. The gate greens while this run's end-to-end knowledge-during-build is broken — defeating F2's entire purpose (the live proof that a doc entering *through the build* is citable). Because this gate lives in the suite and is re-run on the shared boot-b stack (never a clean org again), every future run's CITED leg is permanently residue-contaminated.

Severity is Medium, not High, because the NARRATED leg independently proves *this* run's hook fired and ingested, and a total ingest failure fails loud regardless of residue — so the residue masks only the narrow "ingested-but-not-searchable" partial regression of the CITED leg. But re-runnability is an explicit F2 acceptance requirement ("committed re-runnable driver"), and the docstring at :51-52 asserts a re-run unambiguity the code does not provide and the evidence disproves — an honesty gap in an artifact whose whole job is honest proof.

**Fix (one-line):** make the reference token unique per run (e.g. `const KB_TOKEN = \`EKF-${Date.now().toString(36).toUpperCase()}\`` woven into title + body + `FEES_Q`) so the CITED leg pins on *this* run's doc; optionally best-effort delete the doc at the end. Then correct the :51-52 docstring. (Contrast D3/`assistant-modes.e2e.mjs`, which the driver is modelled on: it also uses a fixed token but seeds once per run via `POST /knowledge/documents`, a single-shot side channel — F2's per-build re-ingest with no dedup is what turns the fixed token into accumulating residue.)

### 2. [LOW] `verifyBuilds:false` left unrestored on the shared owner
**File:** `:189` — the driver PATCHes `settings/me { build.verifyBuilds:false }` and never restores it, leaving the admin owner with build verification disabled on the shared stack after the run. Consistent with the sibling gates (C5/D2/D3/E2/G1 per the comment) and therefore an accepted convention, but it is unrestored shared-stack residue worth naming. Non-blocking.

### 3. [LOW] Em-dashes in the driver's authored comments/docstring violate the house no-em-dash rule
**File:** `:3,16,24,26,35,39,46,49,51,73,94,188,197,224,280,283,292,301,310` — English prose comments use "—". The seeded fixtures and the intentional detector regex (`:99`) are fine; only comment prose is affected. Cosmetic, non-blocking.

---

## Not a defect (noted for completeness)
- **Em-dash in the assistant REPLY** (`live-output.txt`: "…processo concreto — bastando…") is model runtime output, correctly out of scope for the no-em-dash rule, which the gate enforces only on the two platform-authored `plan_step` descriptions (both dash-free). Pre-flagged in impl-notes.
- **Multi-domain narration** ("área jurídica e financeira") is correct: `advogados` fires `juridico` alongside `taxas`/`custas` firing `financeiro`; the gate asserts `/financeira/` presence, robust to the extra label.
- **`slices/F1/followup-detector-precision.md`** is a doc-only handoff that correctly corrects a mis-disposition in the F1 gate record (review-f1's Medium was detector *false positives*, not subsumed by codex's false-*negative* fix) and appropriately defers the detector tightening until after F2's gate closes (F2 depends on the running dist). Good hygiene, no F2 impact.

## To flip to APPROVE
Fix Finding 1 (per-run unique token + corrected docstring). Findings 2–3 are non-blocking and can ride along or be waived. No re-derivation of the F1 plumbing is needed — it is sound as reviewed.
