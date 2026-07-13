# H2 delegation brief - SECURITY: identity/session handoff (whoami detection, detect-then-ask)

Slice H2 (api, size 5, dep H1 passed). Second slice of the atomic security block. Run commits
DIRECTLY TO MAIN; the lead runs gates. DESIGN IS DECIDED: slices/H2/decision-memo.md (read it -
the topology exploration + the option analysis + the fail-closed decision are all there). Spec:
BRIEF.md Phase 9b.

## WHAT H2 BUILDS (the memo's decision, option 1 + fail-closed degradation)

The served-app assistant panel must DETECT whether the current viewer is an admin of the app's
owner org, WITHOUT a per-app login and WITHOUT weakening the panel plane's visitor-blindness for
anything privileged. Detection only; every privileged action stays gated server-side by H1.

### 1. GET /api/app-assistant/whoami (api/src/apps/app-assistant-route.ts)
- A NEW route on the existing app-assistant router (sibling of POST /api/app-assistant). Header
  `X-Ekoa-App-Id` (reuse the exact charset/collision checks admit() already applies - the reserved
  `usr.` prefix rejection etc.). Optional `Authorization: Bearer <token>`.
- Behaviour: resolve the app -> owner (reuse admit()'s resolveApp/owner resolution). If a Bearer
  token is present, verify it through the SAME chain requireAuth/verifySseToken use (verifyToken +
  jti + isRevoked + activation active + tokenEpoch) - do NOT hand-roll a weaker check. Then answer
  `{ admin: boolean }`:
  - `admin: true` IFF the verified caller's role is org-admin OR super-admin, the caller's orgId
    equals the app OWNER's orgId (super-admin: any org), AND `can(caller, 'canEditApps')` is true.
  - EVERYTHING else -> `{ admin: false }`: no token, invalid/expired/revoked token, epoch-stale
    token, wrong org, user role, cross-origin (token simply absent). FAIL-CLOSED.
- CRITICAL: this endpoint NEVER 4xx's on a missing/invalid token - it always returns 200
  `{ admin: false }` so it is not an oracle (a 401 vs 200 would leak token validity; a 403 would
  leak app existence). The ONLY non-200 is if `X-Ekoa-App-Id` itself is malformed/charset-invalid
  (same 400 admit() already gives) or the app id does not resolve (same shape admit() uses for an
  unknown app - match admit()'s existing behaviour exactly so whoami is not a new existence oracle
  beyond what POST already exposes). It NEVER grounds, NEVER bills, NEVER widens admission.
- Keep the served-app plane's visitor-blindness intact: this is a DECLARED, DOCUMENTED exception
  for detection only. Comment it as such. The POST /api/app-assistant path is UNCHANGED (still
  header-scoped, still never reads the caller JWT for grounding/billing).

### 2. Shared contract (shared/src/app-assistant.ts)
- Add `AppAssistantWhoamiResponse = z.object({ admin: z.boolean() }).strict()` (+ the descriptor
  entry if the app-assistant endpoints have a descriptor map). Additive only. Contract test both
  branches.

### 3. Panel detection (api/assets/panel-runtime/src/AssistantPanel.jsx)
- On mount (the lazy asset already self-mounts), read the platform token from localStorage
  (`ekoa_token` - the key web/lib/api/token.ts uses) inside a try/catch (cross-origin/sandboxed
  iframe access throws - swallow to false). Call GET /api/app-assistant/whoami ONCE with
  `X-Ekoa-App-Id` (the panel already knows its app id - reuse how POST gets it) and the Bearer
  token if readable. Store `admin` in panel state (default false).
- DETECT-THEN-ASK (binding): `admin: true` NEVER auto-enables anything. H2 exposes ONLY the state
  flag + at most a DISCREET, non-intrusive indicator that an admin capability exists (a small,
  quiet affordance - the actual edit-mode switch + its opt-in UX is H3, do NOT build it here). No
  mode change, no edit tools, no new privileged calls. PT-PT, no emoji, no em/en-dash.
- Zero-token invariant intact: whoami is a cheap non-LLM GET; it must not count as or trigger an
  assistant turn.

## TESTS (modules travel with tests)
- Unit (api/tests/apps/app-assistant.test.ts or a new whoami test): the whoami matrix - no token
  -> admin:false; invalid/expired/epoch-stale token -> false; a user-role token of the owner org
  -> false; an org-admin of ANOTHER org -> false; an org-admin of the OWNER org -> true;
  super-admin -> true; and NEVER a 4xx on a bad/missing token (always 200). Malformed X-Ekoa-App-Id
  -> the same 400 as POST.
- Contract (app-assistant.contract.test.ts): the {admin:boolean} response validates against the
  shared schema, both true and false.
- Panel (api/tests/apps/assistant-panel.test.ts): the panel reads the token defensively (try/catch)
  and calls whoami once; a false result renders NO admin affordance; the detect-then-ask invariant
  (no privileged action on true) is pinned structurally.

## CONSTRAINTS
No edit-mode UX (H3), no queue (H4). Reuse H1's can() + the verify chain - do NOT introduce a second
identity path or a per-app login. The POST /api/app-assistant grounding/billing path stays byte-for-
byte visitor-blind. PT-PT, no emoji, no em/en-dash. Nothing outside api/src/llm touches the provider.
No commits, no stack ops - working tree + impl-notes + worker-status.txt (DONE-GREEN | vitest
summary | BLOCKED:<reason>).

## VERIFY LOCALLY
cd api && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json; eslint touched
files; npx vitest run tests/apps tests/contract (+ the full lane if anything shared changed); repo
root npm run gate:chokepoint. The panel asset must still compile: node assets/panel-runtime/build.mjs.

## RESERVED PATHS (held for you)
api/src/apps/app-assistant-route.ts, api/src/apps/app-assistant.ts, shared/src/app-assistant.ts,
api/assets/panel-runtime/src/AssistantPanel.jsx, api/tests/apps/app-assistant.test.ts,
api/tests/contract/app-assistant.contract.test.ts, api/tests/apps/assistant-panel.test.ts,
slices/H2/**.
