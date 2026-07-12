# Slice C5 — registry round-trip gate + test-harness dual use

## Deliverable
`api/tests/e2e/action-registry.e2e.mjs` — a committed, re-runnable browser driver that proves the
operate loop end-to-end against a REAL served app: Cortex issues actions over the injected in-page
runtime (C3) and the app VISIBLY executes them.

## What it asserts (live, on the credentialed boot-b stack)
1. Builds ONE sample app from the `app` base through the real jobs pipeline (verifyBuilds OFF — the
   gate tests the RUNTIME round-trip, not the LLM verifier, whose verdict is nondeterministic and
   orthogonal; same pattern as j3-build build1).
2. Embeds the served app in a host IFRAME (the real production topology; the runtime posts to
   window.parent and refuses same-window drive by design).
3. The server-injected action runtime is present inside the frame.
4. A `highlight` action draws the visible ring over the target (issue -> visible execute).
5. A `setField` action drives the app's own input through the native setter + input/change events
   (dispatches as a user-equivalent interaction, so app validation always runs).
6. A `destructive` action prompts a confirmation card BEFORE any dispatch.
7. Cancelling the confirmation reports `cancelled` (the destructive action never ran).

## Determinism
The driver plants its OWN known probe target (`data-demo-target="c5-probe"`) into the served app
rather than depending on an LLM-generated landmark — the round-trip exercises the true server
injection + runtime in a real served app, independent of what any given generation produced.

## Test-harness dual use (FLOW_PLAN C5)
`driveAppAction(page, action, params)` in the driver is the exact helper a journey probe / tester
agent reuses to drive a built app's registry — one investment, two uses.

## The audit dimension
"audit rows land" for assistant-driven actions is proven server-side by C4's unit round-trip
(auditAssistantAction -> logActivity) and lands end-to-end once D1 mounts the assistant (D3 gate).
This driver proves the CLIENT round-trip the assistant depends on.

## KNOWN GAP for the operator + D2 (flagged)
The runtime drives via postMessage to a PARENT frame (the demo-bridge/iframe topology used by the
dashboard preview and tour player). The in-app assistant PANEL (D2) is same-document, so it will
need a direct in-window API (e.g. window.__ekoaActions.execute) OR to drive via an iframe — the
runtime currently refuses same-window posts. D2 must add this; noted so the panel slice does not
rediscover it.

## Suite-ledger note (operator, at merge)
This e2e is a feature-run artifact on the unmerged `operator-run` branch. The build-run
SUITE_LEDGER.json uses the G0..G13/CUTOVER gate vocabulary and is already in its documented
committed-baseline-debt state (docs/testing.md); registering an operator-run driver there with a
non-gate targetGate corrupts the census. The operator should register `action-registry` in the
ledger when folding operator-run into main.
