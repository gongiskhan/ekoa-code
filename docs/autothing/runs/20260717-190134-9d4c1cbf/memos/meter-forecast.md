# Decision memo - meter forecast (split proposal per BRIEF §3/§10)

Run `20260717-190134-9d4c1cbf`, slice A5. BRIEF §3: if the full run clearly cannot fit, this memo
proposes the split point. It does not: the forecast fits. Evidence below; all timestamps from
`RUN_LOG.md` (grep `20260717-190134` for this run's entries).

## Evidence (measured prior runs on this repo, same gate discipline)

- **Gateway run** `20260717-071930-d1244839`: RUN-START 07:20:54Z -> terminal PASSED 14:59:15Z =
  **~7.6 h for 7 slices** (S1-S7 per `analysis/05-refresh-and-topology.md` header) including the
  run-level closing gates + codex checkpoint. ~1.1 h/slice.
- **Operator run** `20260712-150958-4bb23640`: RUN-START 2026-07-12T15:09:58Z -> final H6 gate
  2026-07-13, with operator-requested aborts/resumes between = **~2 days for 31 slices**, 31/31
  PASSED, dual review per slice. ~1 h/slice net of pauses.
- **This run**: 27 slices ~= 107 pts (RUN_SPEC "Sizing"). RUN-START 19:02:22Z; A0 PASSED
  21:31:38Z, A2 21:40, A3 21:49, A4 21:58, A1 22:06:55Z; A5 closing ~22:1xZ. **A0-A5 (6 slices,
  14 pts) in ~4 h wall**, INCLUDING the 80+ min planning-subagent stall (DECISION 20:32:15Z,
  lead-context synthesis) and the A0 baseline red-classification detour (GATE 21:02 -> 21:23).

## Forecast

Remaining B+C+D+E = **21 slices ~= 93 pts** (B 33, C 33, D 5, E 22). At the measured build-slice
rate (~1 h/slice with full gates), remaining work is roughly **21-30 h of gated effort** - it fits
the multi-day window the BRIEF assumes (§0 "fully unattended multi-day run"). Do NOT extrapolate
from tonight's ~10 min/slice on A1-A4: those are docs-kind slices under reduced gates; the
build-rate baseline is the gateway/operator number.

Buffers already structured in:

- **E is the drop-whole shock absorber** (22 pts): depends only on A4 (done) and its own E1;
  nothing downstream depends on it (BRIEF §10). If the forecast tightens at the C boundary, E
  drops whole at the cost of a follow-up brief, not rework - the split point is pre-decided and
  needs no new memo.
- **C6 is vendor-gated**, not schedule-gated: if keys are still absent it lands `blocked` with the
  named missing item (FLOW_PLAN C6; RUN_SPEC assumption 1) - bounded cost, no stall.
- **Part F is its own follow-up run REGARDLESS of the meter**: its input file
  (`ekoa-mega-run-security-block.md`) was NOT FOUND at preflight (RUN_LOG GATE 19:09:55Z,
  human-action item 5), so per BRIEF §10 it is not planned this run (RUN_SPEC assumption 2). The
  biggest block is already split off; this is not a meter decision and no meter outcome changes it
  unless the operator drops the file before E lands.

## Recommendation

**Proceed full A -> B -> C -> D -> E; no further split proposed.** The only conditional is the
pre-decided one: drop E whole if the meter tightens after C (re-evaluate at the C7 gate). F is
already a separate run pending its input file.
