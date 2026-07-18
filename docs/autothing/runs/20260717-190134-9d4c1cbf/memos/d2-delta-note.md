# D2 delta note — operator activity-vocabulary alignment (run 20260717-190134-9d4c1cbf)

**Verdict: NO new code. The one-vocabulary alignment the A5 audit-event-vocabulary memo decided
is already realized on today's branch.** D2 collapses to this note per FLOW_PLAN ("collapses to a
note if none").

## Evidence
- The operator app-assistant rows (landed 20260712) write `logActivity(actor, 'app-assistant',
  `action.${outcome}`, deps, metadata)` — `api/src/apps/assistant-tools.ts:93`.
- The voice rows (C2, this run) write `logActivity(actor, 'voice', 'turn'|'tts', deps,
  {source:'voice', ...}, {voice_stt_ms|voice_tts_chars})` — `api/src/voice/index.ts:183,356`.
- BOTH call the SAME `logActivity(actor, category, type, deps, metadata?, usageCounts?)` seam
  (`api/src/data/activity.ts:21`) writing the RegistoEntry substrate (actor/actionType/timestamp/
  targetIds/usageCounts). The `category.type` namespace (`app-assistant.action.<outcome>`,
  `voice.turn`, `voice.tts`, and Part E's `portal.document.retrieved`/`portal.watch.hit`)
  is the ONE vocabulary the memo decided, extended per part exactly as planned.

## The remaining BRIEF §6 D-text deltas — none require build this run
- D1-D6 equivalents all landed in the operator run (verified in Part A analysis/05 + D1's 61/61
  green operator asserts). The artifact-type classifier stays UNWIRED (capability seam only, per
  BRIEF §6 D2 "do not wire it here") — confirmed unchanged.
- The known operator gap is a driver-hardening item (assistant-modes DO-turn live-model flake,
  known-flakes.md), not a product delta.

## Automations zero-logActivity gap (memo-noted, not fixed)
The audit-event-vocabulary memo recorded that the automations engine writes NOTHING to logActivity
(only the `automation_runs` ledger). That remains true and remains a documented follow-up
(reserved `automation.*` namespace), out of this run's scope — not a D2 regression.
