# Planning working notes (run 20260717-190134-9d4c1cbf) — durable pre-compaction flush

State: Phase 1 (exploration). 5 Fable-pinned Explore subagents spawned ~19:11Z, named:
explore-chat, explore-operator, explore-voice, explore-portals, explore-plumbing. If resuming and
their reports are lost, respawn with the same briefs (chat inventory / operator delta / voice
landing zone + garrison / portals + dossiê / automations-knowledge plumbing).

## Established facts (verified this session)

- Coord: agent-mail identity **CalmPeak**, project /Users/ggomes/dev/ekoa-code; planning lock held
  (heartbeat each turn); run-wide intent declared. Release both + end_planning at run end.
- Preflight: all tools present; hook active (no /goal needed); sentinel armed cap 250 (to be
  re-derived after slicing). HUMAN-ACTION LIST in RUN_LOG (no Deepgram/ElevenLabs/OpenRouter keys,
  no gcloud ADC, GCP project from brief not visible; Part F file missing everywhere).
- Prior run 20260712-150958 (operator, 31/31 PASSED incl. H block, merged): Part D of this brief is
  ALREADY LANDED → D = verify + delta. Its analyses 01–04 + memos (registry/tour-format/base-set/
  token-shrink) are committed and standing. Registry memo: UI action registry is client-plane, unified
  at MANIFEST level; automations engine untouched; automations write NOTHING to logActivity today
  (audit-vocabulary memo input). Tour memo: demo-spec v1 reused, registry-ID == demo-target namespace.
  Base memo: document first, app second; app base = ~80% reuse of app-auth-persistent + 2 mounts.
- J3 probe = api/tests/journeys/j3-build.mjs (+j3b-followup); journey suite = j0–j9 permanent.
- Suite ledger: api/tests/SUITE_LEDGER.json census via scripts/suite-ledger-run.mjs; ci:lane = the
  per-PR gate; gate:sast/secrets/audit outside the lane. New suite ⇒ ledger registration same change.
- Architecture pins: streaming/ = the ONE WebSocket carve-out (FIXED-2) — voice WS = extend it or a
  documented second carve-out + diagram; events/ = SSE manager (reply_summary event lands there);
  billing/tracker.ts = single metering writer (voice_stt_ms/voice_tts_chars + assistant counters
  extend ONE ledger); memory/ post-run extraction = where the summary Haiku(FAST-tier) hook sits;
  legal/citius.ts exists (track 8); shared/registo.ts = org ACTIVITY-LOG read surface (RegistoEntry:
  actor/actionType/timestamp/targetIds) — audit-event memo extends this vocabulary; api serves
  dist (rebuild+restart+re-provision credential per api change — walkthrough notes).
- shared/ existing modules incl. action-manifest, app-assistant, artifact-type, change-request,
  capabilities, chat, sessions, events, billing, knowledge. New this run: sheets (or extend
  chat/sessions), voice, portal-document/portal-event records.
- Meter evidence: gateway run 7 slices ≈ 7.6h wall (~45–55 min/slice incl closing); operator run 31
  slices ≈ 2 days. Forecast memo: ~30–40 slices ⇒ ~1.5–2.5 days; E = shock absorber; F = own run
  (file missing anyway).
- garrison voice assets: ~/dev/garrison fittings/seed/deepgram-voice (apm.yml, README, scripts/
  {server,connector,probe,start}.mjs); origin/feat/local-voice-jarvis exists; main has only
  legacy-voice.tsx under web-channel-default/ui (voice-machine/capture on the branch).
- Dev boot: node .claude/skills/run-ekoa-code/driver.mjs up (web :3000, api :4111, admin/tmp12345);
  chat SSE quirks + selector gotchas in .walkthrough/notes.md (READ before any e2e/walkthrough work).

## Next steps (in order)

1. Collect 5 explorer reports → fold into RUN_SPEC (structural decisions B.A–F, voice placement,
   E record shapes, D-delta list).
2. Phase 2: 2–3 Plan subagents (Fable-pinned): B architect, C architect, D-delta+E architect.
3. Phase 3 review → finalize RUN_SPEC (assumptions ledger) → FLOW_PLAN slice table (kinds, sizes
   ≤8, groups, deps; docs-kind reduced gates; profile build; deliberateRed+mutation ON).
4. Update sentinel turnCap = max(300, 80×slices); RUN_LOG DECISION; replace RUN-START
   pending-sizing → build profile.
5. end_planning + release planning-only state; Phase 2/3 foundation detect (expected no-op: repo
   founded); Phase 4 build loop (baseline journey suite green BEFORE first implementation slice;
   per-slice agent-mail file reservations; codexSliceReview conditional ON (build profile);
   all codex exec serial).
6. Operator notification early (autothing-report) with human-action list + plan summary.
