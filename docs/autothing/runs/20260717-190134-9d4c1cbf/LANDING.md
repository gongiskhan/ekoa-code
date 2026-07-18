# LANDING — Ekoa Mega Run (run 20260717-190134-9d4c1cbf)

**Terminal state: `completed-with-blockers`.** 26 of 27 slices passed with the full gate bar;
**C6 is blocked on external vendor credentials** the operator must provide (a named external
cause + exact remediation, not a code failure). Branch `mega-run` off `main`; nothing merged —
the operator reviews the diff and merges per part. Profile **build**. Model policy held: the run
ran on Fable, with a **model-fallback to Sonnet** for the Part C7 + Part E implementers/reviewers
(Fable usage-limit — capacity/limit cause, NOT the security-triggered Opus switch); the cross-model
gate throughout was Codex (gpt-5.5 high).

## What landed (per part — merge posture)

- **Part A (6/6, merge-safe):** analyses 05 (tracks 1-5 refresh + browser topology), 06 (chat
  inventory), 07 (voice reuse — the BRIEF's jarvis artifacts do NOT exist; C slices are new writes),
  08 (portal audit + verdict table); 4 decision memos (B structural A-F, C deviations, audit-event
  vocabulary, meter forecast). The prior run's registry/tour/base memos still bind.
- **Part B (7/7, merge-safe):** the unified chat layout — sheets persistence + canonical-context
  assembly (B1), reply_summary FAST-tier post-run hook on the notifications channel (B2), layout
  unification with the panel-host union (B3), the sheet feed (B4), summary cards + composer chip +
  agent revisions (B5), mobile overlay + i18n (B6), the live-model proof + evidence walkthrough (B7).
  B7 forced 5 real fixes incl. the **partial-delta streaming transport change** (text_reset
  retraction protocol) and summary persistence.
- **Part C (6/7 passed; C6 BLOCKED, merge-safe standalone):** voice as a modality on the unified
  page — the WS voice relay module (C1, sibling of the streaming carve-out), metering (C2), the pure
  reducer + grace window + PT/EN speakable (C3), the capture chain + Silero VAD + mic UI + ouvir (C4),
  the TTS text pipeline + playback client (C5), the voice proof + latency + walkthrough (C7). Ships
  ungated behind stub providers; a live vendor swaps in via config with zero client change.
- **Part D (2/2, verify+delta):** the operator surface (landed in run 20260712) re-verified on this
  branch — 6/7 operator drivers green (61 asserts incl. assistant-billing, unaffected by C2's billing
  changes); one live-model DO-turn flake is PRE-EXISTING (reproduced on clean main). The A5
  one-activity-vocabulary alignment is already realized (D2 note-only).
- **Part E (5/5; C6-independent, merge-safe):** the open-data portal tier — PortalDocument/PortalEvent
  records + the dossiê receiving surface (E1), certidão-by-access-code connectors comercial/predial/
  civil (E2/E3), the insolvência publications watcher (E4), DGSI/DRE verify + the BRIEF §8 gate + a
  walkthrough (E5). The gate proves one dossiê receiving a comercial certidão by code AND a watcher
  event, both rendering with verbatim PT-PT strings.

## THE BLOCKER (operator action required)

**C6 (live voice STT + TTS bake-off) — BLOCKED on external vendor credentials.** Absent on this
machine at run end (re-checked at C's start per the non-improvisation rule; the human-action list was
flagged at RUN-START):
1. `DEEPGRAM_API_KEY` reachable by the dev stack (live Nova-3 STT + keyterm dictionary).
2. Google Cloud TTS access (ADC or a service-account) on the brief-named project `bazinga-491610`
   (not among this machine's visible gcloud projects) or a named replacement.
3. Optional `ELEVENLABS_API_KEY` for the bake-off fallback candidate.
Everything except live-vendor calls is proven green behind stub providers; the provider registry is
config-behind-contract, so C6 becomes a config-and-verify slice once the keys land — not new build.

## Landing-packet additions (per BRIEF §11)

- **Decision memos:** memos/{b-structural,c-voice-deviations,audit-event-vocabulary,meter-forecast,
  d2-delta-note,e5-dgsi-dre-verify,voice-latency}.md + the prior run's standing memos.
- **Portal connector audit table (track 8):** analysis/08-portal-audit.md — per-connector verdicts
  (Citius publico citacoes -> E4 base; distribuicao + signed-in -> follow-up run; DGSI/DRE -> E5
  verify-only; Financas/registos -> E2/E3 new).
- **Instruction-token reduction:** already banked by the prior operator run (analysis/05 notes the
  baseline is now stale at SKILL.md 10,546 B; Part D was verify-not-rebuild, so no new shrink).
- **TTS bake-off:** DEFERRED to C6 (vendor-gated). memos/voice-latency.md carries the first
  latency-dashboard numbers (clearly labeled stub-provider, not vendor).
- **Per-part gate evidence:** slices/*/gate-status.json; three verified evidence walkthroughs
  (ekoa/part-b-unified-chat, ekoa/part-c-voice, ekoa/part-e-portals; sha256 + bytes in
  evidence-index.json).
- **Merge recommendation:** B, C (stubs), E merge-safe standalone; D is verify-only; Part F is a
  separate follow-up run (input file missing).

## Deviations / decisions / model-fallbacks (needs human eyes)

- **DEVIATION (subagent transport):** background Agent/Task subagents returned nothing for 80+ min
  early in the session; the run switched to SYNCHRONOUS subagent spawns for all work — friction-logged.
- **DEVIATION (model-fallback):** Fable usage-limit forced a Sonnet fallback for the C7+E
  implementers/reviewers (capacity cause, recorded per Part 3). The orchestrator and Codex gate were
  unaffected. `model-fallbacks:2`.
- **DECISION (Part F not reached):** the security-block input file is missing on this machine; Part F
  is its own follow-up run per BRIEF §10.
- **DECISION (branch):** run branch `mega-run`, merge only after operator diff review (BRIEF §0).

## Open findings (docs/findings.md) — the run FIXED the security one

- **FIXED this run:** `context-block-hold-back-leak` (the run-level security review + codex checkpoint
  found and closed it: an unclosed/nested `<ekoa-context>` internal state block could stream to the
  live wire / TTS; drain() now depth-balances + holds back + drops at flush; exhaustively re-verified).
- **OPEN (low, documented v1 limits):** `insolvencia-watch-at-least-once` (E4 duplicate-event edge),
  `answer-channel-preamble-leak` + `chip-title-raw-first-line` + `knowledge-tool-sync-io-stall`
  (quality/perf, from B7/C7 live testing) — all follow-up hardening, none blocking.
- **PRE-EXISTING flake:** the assistant-modes DO-turn (reproduced on clean main; known-flakes.md).

## Gate summary

| Layer | Result |
|---|---|
| Slices | 26 passed + 1 blocked (C6, external creds); buildable-remaining 0 |
| Deterministic wall | typecheck 0, lint 0, chokepoint 0, gitleaks 0 (closing lane) |
| Estates | api 207 files (1906 passed, 1 skipped), web 337, shared 58, diagram-integrity 13 |
| Per-slice review | fresh-context review on every code slice; codexSliceReview on every boundary slice |
| Independent test | Part B + Part C independent fresh-context passes (both PASS) |
| Evidence | 3 verified walkthroughs (B, C, E) |
| Built-in security review | issues-fixed (context-block leak) |
| Codex checkpoint | issues-fixed (transport leak closed; boundaries rebutted; shared clean) |
| Journeys | j0-j9 green at checkpoints; J3 re-run at B1/B7; operator 6/7 at D1 |
