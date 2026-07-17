# RUN_SPEC — Ekoa Mega Run (run 20260717-190134-9d4c1cbf)

**Status: DRAFT — being written during planning; locked when FLOW_PLAN derives from it.**
Canonical brief: `BRIEF.md` (same dir, verbatim). Profile/turn-cap/sizing: end of this file.
Run policy reminders: every subagent spawn pins `claude-fable-5`; Parts A–D text avoids the
restricted vocabulary per BRIEF §0 (product/plumbing wording only; the one seam is named
`can(capability)`); the second input file is opened only if/when Part F begins; synthetic data only.

## What / why (one paragraph)

Unify the `/chat` page on one grammar (transcript rail + deliverables panel; every assistant reply
= summary card left + full "sheet" right, sheets revisable in place) — then add voice as a modality
on that unified page (streaming STT relay, adaptive endpointing, per-language TTS behind one
interface, metered per org) — verify-and-close the small delta on the already-landed app-operator
product — and give the dossiê model its first open-data portal feeds (certidões by access code +
an insolvency-publications watcher). Part F (the final block) has its own input file, which is
MISSING on this machine; per BRIEF §10 it becomes its own follow-up run unless the operator drops
the file before A–E land.

## The delta discovery that shapes this run (dig-don't-assume, done at planning)

Run `20260712-150958-4bb23640` ("Ekoa Apps Get an Operator", 31/31 PASSED, merged to main,
evidence pass 2026-07-14) already landed what BRIEF Part D describes: base registry + app base
(D1), artifact-type classifier + action registry + in-page runtime + audit rows (D2), assistant
panel with three modes + pause-on-input (D3), build-time tours + zero-token playback (D4),
knowledge-during-build with citations (D5), assistant metering + panel perf budget (D6) — plus the
follow-on block that replaced the capability stub with the real layer, edit mode, and the
request-changes queue. Its Part-A analyses (tracks 1–4) and three decision memos (registry,
tour-format, base-set) are committed in that run's docs and remain standing.

**Therefore:** Part D here is a VERIFICATION + DELTA part, not a build part. Part A here reuses
tracks 1–4 (verify-still-true + topology addendum) and does new digs only for tracks 5–8. The
run's real new build weight: Part B (chat layout), Part C (voice), Part E (portals).

## Acceptance criteria (run level; per-part gates carried from BRIEF)

- **A**: committed analyses for tracks 5–8 (6/7 fold into B/C planning here) + the track-8 portal
  audit table with per-connector verdicts + four net-new memos (Part B structural A–F; Part C voice
  deviations if any; audit-event vocabulary; meter forecast incl. split proposal if needed) +
  refresh notes on the standing 1–4 analyses/memos. No mid-run stop; decide-and-document.
- **B**: BRIEF §4 proof — one session: short+long Q&A as cards+sheets, 3 successive edits = one
  sheet with 3 revisions, chip dismiss → new sheet, build-mode coexistence in the same session,
  reload restores everything, mobile FAB overlay; unit tests on canonical-context assembly;
  summary-failure degradation verified; PT-PT strings.
- **C**: BRIEF §5 — voice on the unified page, manual + talking modes, barge-in, adaptive grace
  window, reducer unit tests ported (Node, zero mocks); latency instrumentation logged; STT/TTS
  metering counters per org; vendor-live slices conditional on keys (human-action list).
- **D**: the six landed capabilities re-verified green on main today (suite ledger + J3 + the
  operator e2e files) + only genuine deltas built (one activity-log event vocabulary with Part C;
  anything the verification finds drifted).
- **E**: BRIEF §8 gate — one dossiê receives a comercial certidão by access code AND one watcher
  event end-to-end, both rendering in the dossiê; normalized portal-document + portal-event
  records; PT-PT strings. (Live portal calls in dev are synthetic/fixture-driven; no real
  credentials.)
- **Cross-cutting**: journey suite green at every checkpoint; J3 after anything touching the build
  pipeline; diagrams updated with structure; suite-ledger registration travels with every new
  suite; PT-PT conventions (o seu/a sua, ecrã, por omissão, sem travessões); no emoji in UI code.

## Non-goals (from BRIEF, binding)

Registo UI; promover flows beyond a stub; automations/channels rendering changes; Ekoa OS
concepts; wake word / speech-to-speech / user voice selection / Web Speech API / marketing-site
voice; VAD-gated streaming (v1.1); speaker enrollment/diarization; Cortex Gateway module changes;
explainer variant for non-app artifacts; template resurrection; per-app login systems; signed-in
portal connectors (follow-up brief); real browser automation for the app assistant.

## Assumptions ledger (chosen vs alternative; grows during planning)

1. **Missing §1 vendor keys do not stop the run.** Chosen: proceed A→B; Part C vendor-live slices
   re-check at C start and block-with-named-cause if still absent; operator notified at minute
   zero (RUN_LOG human-action list). Alternative: hard preflight failure — rejected: A/B/D/E have
   zero dependency on the keys and the brief prizes coherent partial landings.
2. **Part F**: input file missing ⇒ planned as NOT reached this run (BRIEF §10 fallback: it
   becomes the next run whole). If the operator drops the file mid-run, the meter decides at the
   E→F boundary. Alternative: pause and wait — forbidden (unattended).
3. **Part D scope = verify + delta** (evidence above). Alternative: rebuild per BRIEF §6 text —
   rejected: the work already exists on main with passed gates; rebuilding violates
   lowest-viable-tier and dig-don't-assume.
4. **The garrison voice assets live in `~/dev/garrison`** (fitting `fittings/seed/deepgram-voice`,
   branch `origin/feat/local-voice-jarvis`), not `~/dev/agent-garrison` as the brief writes.
   Chosen: treat garrison as the reuse source. Alternative: treat the asset as absent — rejected,
   verified present.
5. **Lead-context synthesis** (RUN_LOG DECISION 2026-07-17T20:30Z): 8 subagents returned nothing
   in 80+ min (session-level failure); the lead planned directly from its own verified reads.
   Alternative: keep waiting — rejected (unbounded stall). Consequence: implement slices re-verify
   file-level specifics before editing; A2/A3/A4 exist precisely to pin exact paths early.
6. **Structural decisions B.A–B.F, C WS placement, C dictionary store, E record shapes** — bound in
   FLOW_PLAN "Structural decisions"; A5 commits the memo versions with evidence. Notables: panel
   host = discriminated union in the existing orchestration store; sheets = session-record
   subdocuments, plain revision arrays; continue-vs-new = local heuristic; summary = FAST-tier
   post-run hook + `reply_summary` SSE; blank transition on first send; voice = `voice/` module
   beside the streaming carve-out (diagrammed); keyterm dictionary in Mongo NOT Firestore (platform
   persistence — deviation from BRIEF §5 wording, memo'd); E records extend-not-redesign for later
   signed-in connectors.
7. **Branch**: run branch `mega-run` off main (BRIEF §0 operator-review-before-merge wins over the
   current-branch default). Checkpoint tags `mega/<sliceId>`.

## Sizing / profile / turn cap (final)

Profile **build** — 27 slices ≈ 107 pts, max slice 7 (B3). deliberateRed + mutation ON;
codexSliceReview every slice; docs-kind reduced gates recorded as kind-conditional skips.
Turn cap **2160** (sentinel updated 20:32Z). Meter posture: E is the shock absorber (drop whole
if tight); Part F is already out of scope this run (missing input file → its own follow-up run).

**SPEC LOCKED 2026-07-17T20:32Z — FLOW_PLAN derives from this file.**
