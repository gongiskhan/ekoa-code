# F2 codexSliceReview: BLOCKED-EXTERNAL (recorded, not skipped)

codex exec failed twice with "Quota exceeded. Check your plan and billing details."
(OpenAI plan quota exhausted after the run's many review passes). The gate is recorded
blocked-external; obligations:
1. RETRY the F2 codex pass when quota resets (before the operator's diff review if possible).
2. H-BLOCK CONTINGENCY: H6 requires a codex adversarial pass over the whole security block.
   Before opening H, probe codex availability; if still exhausted, STOP CLEANLY after G2
   (FLOW_PLAN: "if the meter runs short, stop cleanly after G and leave H untouched").
