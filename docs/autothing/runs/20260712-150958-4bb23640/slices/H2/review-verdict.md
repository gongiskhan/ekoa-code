# H2 fresh-context adversarial SECURITY review — `GET /api/app-assistant/whoami`

Reviewer: fresh-context adversarial security reviewer (no prior stake). Commit `8b6116a`.
Scope: detection-only admin handoff for the served-app assistant panel (detect-then-ask).

## Independently verified (not trusted from impl-notes)

- `cd api && npx vitest run tests/apps tests/contract` → exit **0** (full run, re-run twice).
- Targeted H2 files verbose: **64/64 pass** — the full whoami fail-closed matrix, the pure
  `isOwnerOrgAdmin` grid, the strict-contract branch tests, and the panel detect-then-ask pins.
- `npx tsc --noEmit -p tsconfig.json` → 0; `-p tsconfig.test.json` → 0.
- `eslint` on the four touched files → 0 errors / 0 warnings.
- Chokepoint grep (`api.anthropic.com` / `@anthropic-ai/` outside `api/src/llm/`) → CLEAN (whoami
  issues no model call).
- Diagram 10 (`10-privacy-boundaries.excalidraw`, FIXED-12) updated with an accurate whoami
  detection-exception note (optional JWT, same verify chain, `{admin}` iff owner-org admin +
  canEditApps, fail-closed 200, never grounds/bills/widens, detect-then-ask).

## Adversarial focus findings

**1. Genuinely fail-closed? YES.** `detectOwnerOrgAdmin` (`app-assistant-route.ts:98-104`): no/
malformed Bearer → false; `verifySseToken` is wrapped so `verifyToken` throwing (expired/invalid-
sig/wrong-alg — HS256 is pinned, `jwt.ts:52` — and bridge-token rejection, `jwt.ts:57`) returns
`{ok:false}` → false; missing `jti`/revoked/activation-miss/deactivated/epoch-stale → false. The
handler `.catch` maps any internal throw to a **500, never a 4xx** (`app-assistant-route.ts:263-268`).
No token-failure path yields anything but `200 {admin:false}` (or the 500) — the matrix asserts 200
on every bad-token case. The verify chain used (`verifySseToken`, `middleware.ts:59-73`) is the SAME
chain `requireAuth` runs (`verifyToken` + `jti` + `isRevoked` + activation-active + `tokenEpoch`);
the only leg `requireAuth` adds is the **billing-lock 402**, which is immaterial to admin detection
(a billing-locked admin is still an admin, and detection grants nothing). No weaker hand-rolled
check, no second identity path. SOUND.

**2. Oracle analysis — no new oracle. SOUND.** whoami's only non-200s are `resolveAssistantApp`'s
400 (charset/`usr.` prefix) and 404 (unresolved owner) — the *shared* function POST admission uses,
so byte-identical existence surface (the test asserts 400 parity on BOTH whoami and POST). The
`{admin}` boolean leaks only "is the caller an admin of THIS app's owner org", which an org-admin can
already determine for their own org via the platform artifacts API, and which is uniformly `false`
for other orgs and for unauthenticated callers — no membership leak beyond the pre-existing surface.
Notably whoami does **not** run the owner activation/billing gate POST runs, so it leaks *less* about
owner state than POST (returns 200 where POST returns 403/402). Timing only distinguishes "did I
present a token" (attacker already knows). No shape/timing oracle.

**3. POST not weakened — still byte-for-byte visitor-blind. SOUND.** The refactor lifted the header
charset/`usr.`/owner-resolution checks verbatim into `resolveAssistantApp` (`:59-74`); `admit`
(`:133-169`) calls it and maps `invalid-id`→400 / `not-found`→404 identically, then runs the
UNCHANGED owner-activation/billing/owner-org/manifest resolution. whoami is a separate handler with
NO allowance middleware and NO llm deps; the throwing-deps harness proves whoami never grounds/routes/
bills, and the pre-existing D1 "grounds under the OWNER org and bills the OWNER" test still passes. No
shared mutable state, no middleware-order change.

**4. Capability correctness. SOUND.** `isOwnerOrgAdmin` (`:83-88`) gates on H1's
`can(claims,'canEditApps')` first — a `user` (grid: canCreateArtifacts+canUseChat only) stops there
→ false (tested). super-admin spans every org; org-admin requires `claims.orgId === ownerOrgId`.
`ownerOrgId` is resolved server-side from `users.get(app.ownerUserId).orgId` (`:252-253`) — never
caller input; `claims.orgId` is the signed JWT value. Wrong-org admin → false (tested). The caller
controls only which app-id to probe, not the owner-org mapping.

**5. Panel. SOUND.** `readPlatformToken` (`AssistantPanel.jsx:79-87`) is fully try/catch → null, so
a cross-origin/sandboxed-iframe `SecurityError` cannot crash the mount. The token is read from
same-origin `localStorage` and attached ONLY to the relative `WHOAMI_ENDPOINT` GET (same-origin) —
never logged, persisted, or sent elsewhere. `admin:true` lights only a static, inert "Administrador"
badge (no `onClick`, no mode change, no privileged call; `setAdmin` called exactly once) — the badge
renders a constant PT-PT string, no interpolated data, so no XSS. Detect-then-ask upheld; edit UX is
correctly deferred to H3.

**6. Test honesty. SOUND.** The whoami matrix runs over the REAL router, the REAL `verifySseToken`
chain, REAL `login`-minted tokens, real `bumpTokenEpoch`/directly-signed-expired tokens, and
mongodb-memory-server — not a mock. It asserts `200`-not-4xx on every bad/missing/expired/epoch-stale/
wrong-org/user-role case, and the contract test validates both branches against the real `.strict()`
shared schema (and rejects extra fields). No always-pass mock.

## Observations (informational — not blockers)

- whoami intentionally skips the owner activation/billing gate; a badge could therefore light for an
  app whose owner is suspended. Security-neutral (detection grants nothing; every privileged action
  re-hits the H1 gates on the *caller*; owner gating happens at POST/edit time), and it leaks less,
  not more, than POST. No change required.
- The same-origin platform-token exposure (any served app's own JS can already read
  `localStorage['ekoa_token']`) is pre-existing, unchanged by H2, honestly documented in the decision
  memo, and ledgered for platform hardening. Out of scope for H2.

No High, Medium, or Low defects found. Clean, careful, oracle-aware implementation with honest tests.

VERDICT: APPROVE
