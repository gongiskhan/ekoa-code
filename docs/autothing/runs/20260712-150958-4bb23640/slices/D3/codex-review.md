1. **[Major] [api/tests/e2e/assistant-modes.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-modes.e2e.mjs:397)** - CITED now pins that a seeded citation title contains `EKZ-7788`, but it still does not pin the actual answer. Any non-refusal reply with the seeded citation passes, even if it omits or gets wrong the known fact `dez anos`, while the PASS/docs claim a grounded answer. Assert the reply contains the expected retention period.

2. **[Major] [api/tests/e2e/assistant-modes.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-modes.e2e.mjs:404)** - The CITED `Fontes` DOM assertion is global and can pass on a stale citations block from an earlier turn. The panel renders citations per assistant turn, but the driver only does `.ekoa-assistant-citations-title.last()` after earlier grounded turns may already have rendered `Fontes`. Scope this to the assistant turn created by the CITED response, or count citation blocks before/after and assert the new DOM block contains `EKZ-7788`.

3. **[Medium] [api/tests/e2e/assistant-modes.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-modes.e2e.mjs:372)** - The TEACH regex is stricter than the prompt contract. `app-assistant.ts` asks for “passo a passo”, but the test only accepts line-anchored `1.` / `1)` markers, rejecting common valid formats like `Passo 1:`. That can flake on a legitimate teach response unless the prompt is tightened to require this exact format.

4. **[Minor] [docs/autothing/runs/20260712-150958-4bb23640/slices/D3/live-gate.md](/Users/ggomes/dev/ekoa-code/docs/autothing/runs/20260712-150958-4bb23640/slices/D3/live-gate.md:23)** - Evidence doc drift: `live-gate.md` still reports SHOW `658` chars and TEACH `1139` chars, but refreshed `live-output.txt` reports `740` and `897`. Not product behavior, but the recorded PASS evidence is internally inconsistent.

Checked: `benign()` matches D2’s allowlist logic, the requested commits themselves touch only test/evidence docs, and the assistant-turn budget is max 6, under the requested <=7.

CODEX VERDICT: needs-work
