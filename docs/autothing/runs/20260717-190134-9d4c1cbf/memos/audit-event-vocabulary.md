# Decision memo - one activity-event vocabulary (voice turns + app actions + portal events)

Run `20260717-190134-9d4c1cbf`, slice A5. BRIEF §3/§7: voice turns and app actions land in the
same activity-log substrate - one event vocabulary, decided ONCE here, extended per part.

## Substrate (existing, unchanged)

- Read shape: `RegistoEntry {actor, actionType, timestamp, targetIds?, usageCounts?}`
  (`shared/src/registo.ts:6-15`), listed by `/api/v1/registo` (:42-49).
- Single write path: `logActivity(actor{userId,username,orgId}, category, type, deps, metadata?)`
  (`api/src/data/activity.ts:21-40`); direct collection writes are grep-banned.
- Mapping: the read surface renders `actionType = `${category}.${type}``
  (`api/src/services/platform-crud.ts:173`). So the vocabulary IS the (category, type) pair.

## Naming rules (the decision)

1. `category` = one product plane, one word (kebab where compound). `type` = a dot-path inside the
   plane, noun first, final segment the outcome/verb where one exists (the landed precedent:
   `app-assistant` + `action.dispatched|confirm-pending|cancelled|failed`,
   `api/src/apps/assistant-tools.ts:80-101`).
2. `metadata` carries references only (ids, refs, provider/lang labels) - never content bodies.
   Raw audio is transient by BRIEF §5; the transcript lives as a chat message, the event carries
   its ref.
3. `usageCounts` keys reuse the metering counter names VERBATIM - the ledger and the activity row
   never invent two names for one quantity (BRIEF §5 "no duplicate ledger concepts").
4. Extension per part = new rows in this table, additive only; existing rows never rename.

## The namespace

| actionType | writer | targetIds | metadata (refs only) | usageCounts |
|---|---|---|---|---|
| `app-assistant.action.<outcome>` | landed (assistant-tools.ts:93); outcome = dispatched / confirm-pending / cancelled / failed | - | artifactId, actionId, kind, destructive, confirmed, runId? | - |
| `voice.turn` | C2, per finished voice turn | [sessionId] | source:'voice', transcriptMessageId (final transcript ref), lang, mode (manual/talking) | voice_stt_ms |
| `voice.tts` | C2, per spoken reply | [sessionId] | provider, lang, sheetId? | voice_tts_chars |
| `portal.document.retrieved` | E2/E3 on certidao attach | [dossierId] | source, type, subjectIds, fileRef | - |
| `portal.watch.hit` | E4 on watcher match | [dossierId] | source, kind, subjectRef | - |

- Voice rows follow the app-assistant precedent (audit through the one `logActivity` path, refs
  not bodies); `source:'voice'` + the transcript ref satisfy BRIEF §5's "a voice turn logs like
  any agent action". Counter names match FLOW_PLAN C2's per-org counters exactly (rule 3).
- Portal rows mirror the bound E record shapes (`PortalDocument {source,type,subjectIds,
  retrievedAt,fileRef}`, `PortalEvent {source,kind,subjectRef,dossierRef,observedAt}` - FLOW_PLAN
  "Structural decisions"; `analysis/08-portal-audit.md` verdicts). The later signed-in connectors
  extend these rows the same way they extend the records - additive, no redesign.
- D2 is the alignment check: app-assistant rows are already vocabulary-conformant; D2 verifies
  the voice/app shapes stay aligned (e.g. whether app rows gain a `source` field for symmetry)
  and collapses to a note if nothing is needed (FLOW_PLAN D2).

## Known gap (memo'd, NOT fixed this run)

Automations write ZERO `logActivity` rows - grep-negative on 20260712, re-verified still true on
today's main (`analysis/05-refresh-and-topology.md` §1.1; the 20260712 `memos/registry.md`
consequence "automations today write NOTHING to the global audit" still binds; their run ledger
`automation_runs` is separate). The `automation.*` category prefix is RESERVED by this memo for
that future work; wiring it is not in any Part A-E slice.
