# G1 delegation brief (DRAFT - prepared at tick 984 while E2/F1 in flight; delegate after E2 frees the stack)

Slice G1: assistant metering + billing-truth probe extension (tours/registry free). Kind api, size 3, dep D1 (passed). Gate needs the live stack AND the E2 tour player (for the "tour playback provably free" assertion) - delegate only after E2's gate.

GROUND TRUTH (verified at draft time):
- D1 already meters: app-assistant calls runOneShot with assistant-chat attribution billed to the resolved owner (D1 impl-notes). G1 PROVES it live and extends the probe; it does not re-implement metering.
- Attribution surface: token_events rows carry agentType (api/src/billing/tracker.ts:47,194); /billing/breakdown groups by agentType (api/src/billing/service.ts:96-109).
- Billing-truth mechanics: journeys log every model-triggering call to api/tests/evidence/J9-billing/actions-log-*.json (_chat.mjs:10-20, j3-build.mjs:26) and reconcile against GET /api/v1/billing/history (j2-grounding.mjs:83-88 pattern).

G1 ACCEPTANCE (FLOW_PLAN): every assistant LLM turn metered + attributed (extends token_events/agentType); billing-truth probe extended to assistant turns and green; tour playback + registry-only actions provably free.

SHAPE:
1. New probe api/tests/journeys/ (or e2e driver per D3 precedent) asserting: (a) N assistant turns -> exactly N new token_events rows, agentType assistant-chat, billed to the RESOLVED OWNER (not the visitor); (b) rows visible in /api/v1/billing/history + breakdown shows assistant-chat; (c) TOUR PLAYBACK (E2 player, full run of the overview tour) produces ZERO new token_events; (d) registry-only action dispatch (window.__ekoaActions.execute) produces ZERO new token_events.
2. Fix attribution gaps ONLY if the probe finds them (billing files then in scope; keep additive).
3. Contract test for any response-shape addition; none expected.

CONSTRAINTS: no security/permission logic (H block); egress chokepoint untouched; serialize on the stack (sole user by then); PT-PT for any user-facing string; diagram update only if a structural change happens (none expected - probe-only slice likely).

RESERVED PATHS (reserve at delegation): api/tests/journeys/** (new probe file), api/tests/e2e/assistant-billing.e2e.mjs (if driver form), api/src/billing/** (contingent), slices/G1/**.

NOTE: check F1's landed narration events before finalizing - if F1 added build-stream knowledge narration with model-triggering calls, extend the actions-log coverage to them here or flag to F2.
