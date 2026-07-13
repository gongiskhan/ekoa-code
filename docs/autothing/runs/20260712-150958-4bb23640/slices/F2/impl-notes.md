# F2 - FEES SAMPLE APP + SEEDED DOCS + CITED-ANSWER GATE - impl notes

Slice F2 of the autothing run (branch `operator-run`). Kind: mixed, size 2. The LIVE PROOF of F1
(knowledge-during-build). Deps F1 + D1 (both passed). No production code change: this is a proof
slice. I did NOT commit; the lead runs the gates.

## What F2 proves

F1 shipped and unit/integration-tested three pieces: a deterministic domain-heavy detector, a
first-build hook that narrates `plan_step{knowledge-scope}` + ingests `JobCreateRequest.knowledgeDocs`
into the org knowledge area via the `ingestBuildKnowledge` seam + narrates
`plan_step{knowledge-indexed}`, and the jobs route/shared contract carrying `knowledgeDocs`. F1's own
gate stopped at the seam-over-real-FTS integration level; the full live proof was deferred to F2 by
plan. F2 closes that: on the running credentialed boot-b stack, a single real fees build carries a
seeded reference doc, and all three F1 behaviours are observed end to end at once:

1. **NARRATED.** The build stream (job SSE) carried `plan_step{status:'knowledge-scope'}` and
   `plan_step{status:'knowledge-indexed'}`, PT-PT, no emoji, no em/en-dash - proving the detector
   fired on the fees description and the hook ran on THIS real build.
2. **INGESTED (org-scoped + searchable).** The build's `knowledgeDocs` carried ONE reference doc; the
   `knowledge-indexed` narration confirmed exactly `1 documento`, and the doc landed in the OWNER
   org's knowledge area.
3. **CITED.** The served app's assistant (`POST /api/app-assistant`, owner-org grounding, `kind:'chat'`
   always grounds) answered a fees question naming the seeded circular, the reply carried the seeded
   FACT (`55 euros` / cinquenta e cinco), was NOT a refusal, and the citations included the seeded doc
   (title `Circular EKF-2211`) - a doc that entered the org THROUGH the build, not via a side-channel
   `POST /knowledge/documents`. That is exactly what F1 added, proven live.

## The gate: `api/tests/e2e/fees-knowledge.e2e.mjs`

A committed, re-runnable, black-box driver over the running dev cortex (`backend.port`, the boot-b
proxy). Modelled on `assistant-modes.e2e.mjs` (D3) + `assistant-billing.e2e.mjs` (G1). Flow:

1. Login admin; `PATCH /settings/me { build.verifyBuilds:false }` (verify is nondeterministic +
   orthogonal, same as C5/D2/D3/E2/G1); create a session; `POST /jobs` (kind build) with a
   FEES-domain-heavy PT-PT description (`"...calcular taxas de justiça e custas processuais de um
   escritório de advogados"`) AND `knowledgeDocs:[{ title:"Circular EKF-2211", text:"A Circular
   EKF-2211 fixa em cinquenta e cinco euros a taxa base de justiça..." }]`.
2. **Narration capture via SSE, not the persisted record.** The `JobRecord` persists only
   status/result/routing/error - NOT the event stream - so the `plan_step` narrations are not
   readable post-hoc from `GET /jobs/:id`. The driver therefore SUBSCRIBES to `GET /jobs/:id/events`
   (SSE, `?token=`) the instant the build is created, before polling, and accumulates every parsed
   `JobEvent`. F1's narration fires right after routing (before the agent runs), so it is captured in
   the first handful of frames, well before the build completes. Assertions: a
   `plan_step{knowledge-scope}` whose copy names the financeira domain + the org-knowledge-area
   phrasing, and a `plan_step{knowledge-indexed}` confirming exactly `1 documento` - both PT-PT, no
   emoji, no em/en-dash.
3. **Cited answer via the direct API path.** After the build completes, the driver drives
   `POST /api/app-assistant` directly with `X-Ekoa-App-Id:<artifactId>` and a fees question naming
   the circular verbatim. The three-part D3 CITED assertion set: the reply carries the FACT (`55` /
   `cinquenta e cinco`), is not a refusal (D3's refusal regex), and `citations[].title` includes the
   `EKF-2211` token.

### Why direct-drive `POST /api/app-assistant`, not the panel

The lead's brief sanctioned either "open the served app as a visitor (featured, like G1) or drive
`POST /api/app-assistant` directly". I chose direct-drive for this committed gate because it is the
more deterministic path and it fully satisfies F2's acceptance:

- The app-assistant route (`api/src/apps/app-assistant-route.ts`) is header-scoped and NEVER reads
  the caller JWT; admission resolves the owner purely from `X-Ekoa-App-Id` via `resolveApp` (which
  returns `artifactBacked:true` + `ownerUserId` for a freshly built draft artifact - no featuring or
  publishing needed), grounds under the owner org, and returns the same `citations` the panel renders.
  So the direct call exercises the identical grounding + citation path the panel uses, minus the
  browser.
- The panel's DOM rendering of the "Fontes" block is already proven live by D3 (the CITED turn) and
  D2. F2's distinctive new surface is the BUILD-time narration + ingestion and that the fees app's
  build-ingested doc is citable - all of which the direct path proves without a browser, a strict
  console allowlist, or Playwright flakiness. No screenshots are required (the brief scopes those to
  "if panel-driven").

### Seed design (D3/G1 model)

The boot-b owner org searches its OWN partition AND a large authority-boosted `_shared` legal corpus,
so a generic doc is buried below top-k. The seed therefore carries a DISTINCTIVE token (`EKF-2211`) in
title + body, the fee fact sits IMMEDIATELY after the token (so it lands inside grounding's short
snippet window), and the query names the circular verbatim - so the seeded doc ranks #1. The live
result confirmed it: the seeded doc surfaced as citations [1] and [2] (top two hits), ahead of three
`_shared` acórdãos.

## The transient-502 hardening round (real finding, driver-side fix)

The FIRST live run created build `4d2ff6e0` and then CRASHED in the build-status poll with
`SyntaxError: Unexpected token 'p', "proxy error" is not valid JSON`. Diagnosis (confirmed by the
lead): the boot-b dev CORS proxy answers a pre-response upstream socket error with a text/plain 502
`proxy error...` body while a busy api is deep in a heavy build phase - the KNOWN
`F-2026-07-12-preview-502` class (docs/findings.md:143). The build itself was fine server-side; only
my driver's naive `(await fetch()).json()` was brittle. This is a DRIVER bug, not a platform defect,
so I hardened the driver (no api/src touched):

- **`safeJson(url, init)`** - fetch + parse that NEVER throws: a non-2xx status or a non-JSON body
  comes back as `{ ok:false, status, json:null, text }` so callers treat it as transient.
- **Build-status poll** tolerates bounded consecutive transients (30) with a 1s backoff, resetting the
  counter on any good poll; only a real `failed` status or the 10-min deadline fails the gate.
- **SSE collector** reconnects (bounded, 5) on a mid-build stream drop, re-attaching with
  `Last-Event-ID:<highest id seen>` so the per-job replay ring re-delivers only the gap (no loss, no
  dupes). First connect uses `Last-Event-ID:0` to replay anything buffered before attach (closes the
  attach-after-`fire()` race).
- **Cited turn** tolerates a transient non-200 within the LLM HTTP-turn budget.
- **Build-creation `POST /jobs` is deliberately NEVER retried** - a fresh build has no dedup key, so a
  retry could spawn a SECOND build; a blip there fails loud instead (rare - the api is not busy at
  creation time).

The green re-run then hit exactly this class once (`build poll transient 1/30 (status 502) -
retrying`) and recovered cleanly - direct proof the hardening was both necessary and correct.

## Commands run + results

- `node --check api/tests/e2e/fees-knowledge.e2e.mjs` -> syntax OK (both the initial and hardened
  versions). `npx eslint` reports the file as ignored-by-pattern, same as every other
  `tests/e2e/*.e2e.mjs` driver (they are not linted).
- Pre-flight smoke (scratchpad, no model calls): login 200 + SSE subscribe/parse against a missing job
  -> parsed the `ready` frame correctly, validating the SSE plumbing before spending a build.
- **Run 1 (initial driver)** under asciinema: build `4d2ff6e0` created + completed server-side, but
  the driver crashed in the poll on the `proxy error` 502 (the finding above). E2E FAIL.
- **Run 2 (hardened driver)** under asciinema -> **F2 LIVE GATE: PASS**. Build `11382545` ->
  artifact `62524cc7`; captured 73 job stream events; one tolerated 502 poll blip; narration
  (knowledge-scope naming `área jurídica e financeira`, knowledge-indexed `Foi indexado 1 documento`)
  + cited answer (`...é de 55 euros [1][2]`, citations `["Circular EKF-2211","Circular
  EKF-2211", 3x Acórdão]`) all held.

Evidence in `slices/F2/`: `evidence-live.cast` (asciinema of the green run) + `live-output.txt` (teed
stdout of the green run).

## LLM budget accounting (across ALL runs)

- **Builds burned: 2.** Build `4d2ff6e0` (run 1 - completed server-side; the driver crashed poll-side
  before any assistant turn, so 0 turns spent there) and build `11382545` (run 2 - the green gate).
  The lead pre-authorised this second build. No third build was created (the creation POST is
  single-shot by design).
- **Assistant turns burned: 1.** Only the green run reached the cited turn, and it passed on the FIRST
  attempt (no retry line printed). Run 1 never reached the assistant. Well within the 2+1 cap.
- Pre-flight smoke made 0 model calls (login + SSE only).

## Observations (not defects)

- **Multi-domain detection.** The description contains `advogados` (juridico stem `advogado`) as well
  as `taxas`/`custas` (financeiro), so `detectDomainHeavy` correctly returned BOTH domains and the
  narration named `área jurídica e financeira`. This is correct behaviour; the gate asserts on
  `/financeira/` presence, which is robust to the extra juridico label.
- **Em-dash in the assistant REPLY.** The model's PT-PT reply contained an em-dash (`processo concreto
  - bastando...`). This is model runtime output, NOT F1's authored narration copy, so it is out of
  scope for the no-em-dash rule (which the gate enforces only on the two `plan_step` descriptions, and
  those are dash-free). Flagged to preempt reviewer confusion.

## Reserved-path compliance

Only `api/tests/e2e/fees-knowledge.e2e.mjs` (new) and `docs/.../slices/F2/**` were touched. `git
status` shows zero changes under `api/src/**`, `api/assets/**`, or `shared/src/**`. No stack restart,
no scaffold edits, no security/permission logic. (The pre-existing `web/next-env.d.ts` modification was
present at session start and is not mine.)

## Deferred (with reasons)

- **Panel-driven "Fontes" rendering for the fees app.** Deliberately not re-proven here: D2/D3 already
  prove the panel renders the citations block live, and F2's new surface (build narration + ingestion +
  a build-ingested doc being citable) is fully proven by the direct API path with less flakiness. A
  panel-driven variant is a clean add if a later slice wants the fees-app screenshot specifically.
- **`gate-status.json` / SUITE_LEDGER rows.** Left to the lead (the lead runs the gates and owns the
  ledger bookkeeping; both are outside my reserved paths).
