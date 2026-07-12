VERDICT: approve

# C5 fresh-context review — action-registry round-trip e2e driver (commit 5acd1ab)

Reviewer: review-agroup (fresh context, no implementer notes beyond the cited files).
Scope judged: is the committed driver a SOUND, deterministic, re-runnable gate for the
FLOW_PLAN C5 acceptance, and is the "audit rows land" deferral honest.

## Summary

Approve. `api/tests/e2e/action-registry.e2e.mjs` is a real, falsifiable, deterministic
gate that drives the REAL server-injected runtime (C3) in a REAL served app over the REAL
postMessage protocol — not a mock. It asserts all four live round-trip properties (issue,
visible execute, destructive confirm-before-dispatch, cancel-reports-cancelled). The
`verifyBuilds=off` choice is correct, not a weakening. The "audit rows land" dimension is
honestly scoped: genuinely proven at C4 unit level and slated for D3 e2e — C5 is not dodging
it. The flagged D2 gap is real and correctly recorded, not hidden. Findings below are all
low-severity / non-blocking.

## Findings

### F1 (low, informational) — dual-use helper does not handle the confirm flow
`api/tests/e2e/action-registry.e2e.mjs:124-142` — `driveAppAction()` resolves on the FIRST
`actions.result` matching the id. For a destructive action the runtime posts
`actions.result {status:'confirm-pending'}` FIRST (runtime line 348), so the helper would
resolve early with a non-terminal status rather than awaiting confirm/cancel. Constraint:
the impl-notes advertise `driveAppAction` as "the exact helper a journey probe / tester
agent uses to drive a built app's registry" (dual-use). It is correct for C5's own use (only
non-destructive highlight/setField, each of which posts exactly one terminal result — the
driver deliberately uses bespoke blocks for the destructive path, lines 177-206). But as the
reusable tester harness it is incomplete for destructive actions. Not a gate-correctness bug;
worth tightening before a journey probe relies on it for destructive actions.

### F2 (low, cosmetic) — stale header docstring about the driven target
`api/tests/e2e/action-registry.e2e.mjs:19-21` claims the round-trip runs "over the app
base's stable shell landmarks (data-demo-target=\"app-nav\" etc.)". The implementation
instead PLANTS and drives its own `data-demo-target="c5-probe"` (lines 108-115, 162-173).
The impl-notes "Determinism" section is accurate (self-planted probe); only the file header
drifted. A future reader could be misled about what target is exercised.

### F3 (low, hygiene) — verifyBuilds left disabled
`api/tests/e2e/action-registry.e2e.mjs:54` PATCHes `settings/me { build: { verifyBuilds:
false } }` and never restores it — a persistent side-effect on the shared boot-b admin
account. Idempotent across re-runs and matches the documented j3-build convention, so it does
not break the gate; noted as shared-state hygiene.

### F4 (informational, OUT OF C5 SCOPE) — origin-rejection path unexercised behaviorally
The runtime's cross-origin security path (a mismatched/hostile origin being REJECTED — runtime
lines 517-522, 530) is exercised nowhere behaviorally. C5 runs SAME-ORIGIN (host page is itself
loaded from the `/apps/` origin, deliberately, to get same-origin DOM access — driver line 88),
so origin validation always trivially matches; the C3 unit test `api/tests/apps/
action-runtime.test.ts` asserts origin logic only as source-string `toContain('hostOrigin')`
checks, not behavior. This is a coverage gap in the RUNTIME's security path, not a C5 defect
(C5's acceptance is the functional round-trip). Flagged so it is not assumed covered by C5.

## Judgments on the team-lead's specific questions

(a) Real server-injected runtime in a real served app, not a mock — YES. Verified the wiring
myself: `injectAppContext()` (`api/src/apps/injected-context.ts:261`) stamps
`<script src="/__ekoa/action-runtime.js">`; `api/src/apps/serving.ts:427` serves the real
`assets/action-runtime-client.js` byte-for-byte. The driver builds a real app through the
jobs pipeline, loads it at `/apps/:id/`, and gates on `window.__ekoaActionRuntimeInstalled`
(set only by the real runtime, line 42) via a 15s waitForFunction that would fail the gate if
the runtime were absent. Every assertion (ring `[data-ekoa-actions-ui]`, field value via the
native setter, confirm card `ekoa-confirm-acao`, cancelled result) checks a real DOM/protocol
effect of the real runtime. The gate is falsifiable: any broken/absent behavior exits 1.

(b) Deterministic, not LLM-landmark-dependent — YES. Self-plants `c5-probe` +
`#c5-probe-input` and drives THAT, independent of what the generation produced. postMessage
ordering guarantees `actions.init` is processed before `actions.execute` (same source→target
pair, ordered delivery), so the origin-pin-then-execute sequence is not racy. Target
resolution and card detection use generous polls (8s / 6s). The highlight ring is drawn
BEFORE the `done` result is posted (runtime: highlightTarget then finish), so the immediate
`ringDrawn` check cannot lose the 2.5s auto-clear race. No flakiness found in frame selection
(excludes mainFrame, single iframe), origin handling (same-origin, explicit targetOrigin), or
the confirm/cancel sequencing (listener attached before the click).

(c) verifyBuilds=off — CORRECT, not an inappropriate weakening. The runtime is injected by
`injectAppContext` regardless of the LLM verify stage; the verifier's verdict is
nondeterministic and orthogonal to the runtime round-trip. The gate asserts the runtime over
a self-planted probe, so build-content quality is irrelevant to what C5 claims. Disabling
verify makes the build deterministic/faster without touching the asserted surface.

(d) Asserts the four round-trip properties — YES. issue (real `actions.execute`),
visible execute (highlight ring present AND setField value applied through the
native-setter/input+change path — a strong assertion, not just a status echo),
destructive confirm (card `ekoa-confirm-acao` seen BEFORE any dispatch; runtime posts
`confirm-pending` and shows the card before perform), and cancel (clicking cancel yields
`actions.result status:'cancelled'`, proving the destructive action never ran).

(e) "audit deferred to C4/D3" — HONEST, not a dodge. Verified C4 myself:
`auditAssistantAction` (`api/src/apps/assistant-tools.ts:80`) has a real unit round-trip in
`api/tests/apps/assistant-tools.test.ts:64-110` that writes and reads back exactly one audit
row with ids-only metadata (no prompt text) and maps outcome variants to distinct types.
That is the server-side audit proof. The assistant-driven end-to-end audit legitimately
cannot land until D1 mounts the assistant (D3 gate). C5 proves precisely the CLIENT round-trip
the assistant depends on, and the scoping is disclosed in both impl-notes and the file header.

D2 gap real and recorded — YES. Confirmed the runtime's `post()` (line 66) returns early when
`window.parent === window`, so a same-document panel gets no replies; a same-document host
must add a direct in-window API (or drive via an iframe). The impl-notes "KNOWN GAP for the
operator + D2" section records this explicitly for the panel slice. Not hidden.

## EVIDENCE

- `git show 5acd1ab --stat` — commit adds only `api/tests/e2e/action-registry.e2e.mjs`
  (212 lines) + impl-notes; no product code touched (pure gate addition).
- `node -c api/tests/e2e/action-registry.e2e.mjs` → SYNTAX OK.
- Read the full driver (212 lines) and the full runtime `api/assets/action-runtime-client.js`
  (557 lines); cross-checked the postMessage envelope (`__ekoaActions:1`), the
  init→execute→result/cancelled protocol, native-setter setField path, confirm-card landmark
  ids, and the parent-only `post()` early return.
- Verified injection wiring: `api/src/apps/injected-context.ts:261` +
  `api/src/apps/serving.ts:264-433` (route `/__ekoa/action-runtime.js` serves the real asset).
- Verified C4 audit proof: `api/src/apps/assistant-tools.ts:80` +
  `api/tests/apps/assistant-tools.test.ts:64-110` (one-row-lands, ids-only metadata, outcome
  variants).
- Read captured live run `slices/C5/round-trip-output.txt`: 7 PASS lines + terminal
  "E2E PASS: action-registry round-trip (issue -> visible execute -> destructive confirm ->
  cancel)". Consistent with the driver's assertion order.
- I did NOT run the e2e (needs the live boot-b stack); judged from code + captured output as
  instructed.
