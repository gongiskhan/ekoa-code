# Batch-1 "testable app" — handoff to continue on another machine

**Written:** 2026-07-09 · **Branch:** everything is on `main` (no feature branches — do NOT create any).
**rc-1 tag:** untouched. **Run id:** `20260708-203034-41fe4774`.

This is the autothing "batch-1 testable app" run (7 slices fixing the 2026-07-08 hardening findings).
It was paused mid-Slice-1 because the origin machine had issues. Everything below is committed and
pushed to `main`. Pick up from **Slice 1's one remaining blocker**, then continue Slices 2–7.

---

## What this run is

Goal: make the rebuilt Ekoa app testable end-to-end (login → chat → build → click around) with few
visible errors, WITHOUT the deep e2e-harness work (that is batch 2). Seven serial slices, spine first:

| # | Slice | Tag | Status |
|---|-------|-----|--------|
| 1 | **F2** — model-credential endpoint + default-topology gateway self-auth | `batch1-f2` | **impl+tests DONE; live turn blocked (see below); NOT tagged** |
| 2 | F16+F28 — honest build-completion gate + request-fulfilment verifier | `batch1-f16-f28` | not started |
| 3 | F20 — chat streamed text over the SDK result tail | `batch1-f20` | not started |
| 4 | F1 — auth lifecycle (refresh/logout/password/device) | `batch1-f1` | not started |
| 5 | F22 — memoryView orgId + tags/tier defaults | `batch1-f22` | not started |
| 6 | Scoped F4+F5 UI-called route mounts + F6 JSON-404 envelope | `batch1-routes` | not started |
| 7 | F25 — host-context-bleed reproduce-or-dismiss (MANDATORY) | `batch1-f25` | not started |

**The binding plan is `docs/autothing/runs/20260708-203034-41fe4774/FLOW_PLAN.md`** — it has the full
per-slice acceptance, explorer-verified file:line anchors, frozen invariants, out-of-scope list, and
the run mechanics. Read it first. The per-finding specs are in `docs/release/patch-briefs/*.md`.

## Frozen invariants (every slice)
- **FIXED-13 chokepoint:** no Anthropic client / base-URL literal / provider import outside
  `api/src/llm/`; no subprocess spawn with a non-chokepoint provider base URL. (`npm run gate:chokepoint`)
- No weakening of gateway auth, tenant/org scoping, or the anonymisation egress path.
- **Regression-test-FIRST:** commit a failing test that reproduces the bug, then make it green.
- One checkpoint commit + one git tag per slice. Import boundaries + module direction lint-enforced
  (routes never import `data/` directly — go through a domain module).
- Diagrams under `spec/diagrams/` updated in the same slice when structure/flow/shape changes (FIXED-12).

## Out of scope (do NOT pull forward)
Batch-2 e2e harness; F10, F26, F3, F9, F7, F24, F27; F6 beyond the 404 envelope; docs-gaps; the
de-scope-candidate F5 domains (app-assistant, integration-builder, ekoa-local extras, agent-face,
uploads, seed-featured, triggers-list); the pre-existing e2e:server baseline debt.

---

## Slice 1 (F2) — exactly where it stands

**DONE and committed** (commits `c8b821f` red tests, `fdb570b` implementation; `7a4d588` is the Next bump):
- `POST /api/v1/credentials` — super-admin, write-only, audit-logged (`credential.set`). New router
  `api/src/routes/credentials.ts` → `provisionCredential` in `api/src/llm/credentials.ts` (re-exported
  via `api/src/llm/index.ts`). New `shared/src/credentials.ts` schema, registered in the descriptor map.
  Contract test `api/tests/contract/credentials.test.ts` GREEN.
- Boot gateway-key provisioning: `api/src/config.ts` `provisionedGatewayKey()` derives a random key when
  `LLM_GATEWAY_API_KEY` is unset; `buildSubprocessEnv` presents the **gateway** key (not the model secret)
  when the chokepoint is the local loopback gateway (`isLocalGatewayChokepoint`). The model secret stays
  server-side; the gateway re-injects it upstream (`client.proxyGatewayMessages`). FIXED-13 intact.
  Unit test `api/tests/llm/gateway-boot-auth.test.ts` GREEN.
- Bug found+fixed during the live turn: the gateway forwarded the provider's `content-encoding: gzip`
  header on an **already-decoded** body → SDK died with **ZlibError**. Fixed in `api/src/llm/gateway.ts`
  (strip `content-encoding` with the other hop-by-hop headers). Guarded in the boot-auth test.
- F13 rider: `api/src/llm/credentials.ts` header comment "Firestore" → "Mongo".
- Two existing tests repinned to the EXPLICIT external-chokepoint posture (they asserted model-secret
  injection, now the non-default topology): `api/tests/llm/credentials.test.ts`,
  `api/tests/llm/agent-transport.test.ts`. Test-bug class, logged.

**THE ONE BLOCKER — why `batch1-f2` is not tagged.** With the credentialed default-topology stack up
(`node docs/release/probes/boot-b.mjs up`, direct=0), the gateway now authenticates and forwards (no
401, no ZlibError), but the provider returns:

```
HTTP 400 {"type":"error","error":{"type":"invalid_request_error",
  "message":"context_management: Extra inputs are not permitted ..."}}
```

The installed Agent SDK sends a `context_management` field the Anthropic OAuth beta
`/v1/messages?beta=true` endpoint rejects. **This is orthogonal to F2's credential+auth scope** — auth
plumbing works; the payload shape does not. **Next action (a decision):**
- Option A (preferred, in-scope for the chokepoint): strip/allowlist unknown top-level fields
  (`context_management` and any others the OAuth beta endpoint rejects) from the gateway-forwarded
  payload in `api/src/llm/client.ts` `proxyGatewayMessages` (near where it builds `payload`), and add a
  unit test. This keeps the fix inside the one egress module.
- Option B: pin/patch the `@anthropic-ai/claude-agent-sdk` version to one whose payload the endpoint
  accepts. Heavier; touches the dependency surface.

Reproduce the blocker:
```bash
node docs/release/probes/boot-b.mjs up            # boots credentialed stack (reads operator OAuth from Keychain)
# wait for "READY ... claudeAuth.ok=true"
node docs/autothing/runs/20260708-203034-41fe4774/slices/f2-credentials/e2e-gateway-turn.mjs
# currently prints terminalType:"error", replyPreview:"API Error: 400 ... context_management ..."
pkill -f boot-b.mjs                                # teardown
```
When that probe prints `F2-E2E: PASS`, F2 acceptance (b) is met.

**Still OWED for F2 before tagging** (S1 is a security-boundary slice, so these run regardless of profile):
the fresh-context adversarial review, the independent adversarial test, an asciinema walkthrough, and the
per-slice Codex pass. Then `checkpoint: batch1 f2 ...` + `git tag batch1-f2`.

---

## How to run / verify locally
- **Full stack, credentialed:** `node docs/release/probes/boot-b.mjs up` (api on internal :4211, CORS
  proxy :4111, Next web :3000; seeds the operator's Keychain OAuth token into a throwaway mem-mongo —
  never logs it). Teardown: `pkill -f boot-b.mjs`.
- **Uncredentialed / real UI:** the `run-ekoa-code` skill / `docs/autothing/runs/.../` probes.
- **Gates:** `npm run ci:lane` (lint → 4 grep gates → typecheck → test → web build). Security wall:
  `npm run gate:sast`, `gate:secrets`, `gate:audit` (all currently exit 0). **Do not** run `ci:lane`
  concurrently with docker/colima builds (known mongo-memory-server hang under load — `docs/autothing/known-flakes.md`).
- Test suites: `npm test` (api 944/1-skip, shared 32, web 113 — all green on this commit).

## Continuing the autothing run on the other machine
The run's durable state is under `docs/autothing/runs/20260708-203034-41fe4774/` (FLOW_PLAN, evidence-index,
RUN_LOG at repo root). To resume the gated build loop, re-invoke the skill; it reads those files:

```
resume the autothing run 20260708-203034-41fe4774 on main (batch-1 testable app). Do NOT create any
branch or worktree — commit straight to main. Finish Slice 1 (F2): fix the gateway-forwarded payload so
the live boot-b chat turn completes (strip the context_management / unknown top-level fields the OAuth
beta endpoint rejects, in api/src/llm/client.ts proxyGatewayMessages, with a unit test), get
docs/autothing/runs/20260708-203034-41fe4774/slices/f2-credentials/e2e-gateway-turn.mjs to print
F2-E2E: PASS, run the owed adversarial review + adversarial test + walkthrough + codex-slice, then tag
batch1-f2. Then continue Slices 2-7 per docs/autothing/runs/20260708-203034-41fe4774/FLOW_PLAN.md, one
checkpoint commit + tag per slice, regression-test-first, all on main.
```

## Operator note
The `/config` safeguard switch could not be restored programmatically (it is an interactive `/config`
toggle, not a settings-file key). Set it back to `true` yourself if you flipped it for this run.
