# H2 decision memo - identity/session handoff into served apps (decide-and-document)

Per BRIEF Phase 9b: explore -> decide per topology -> document; detect-then-ask stands regardless.
Exploration facts: slices/H1/exploration-auth-surface.md §3 (no re-exploration needed).

## Topology (fact base)

- **Deployment**: dashboard (web), API, and served apps share ONE origin; apps are subpaths
  `/apps/<idOrSlug>/`. The platform JWT lives in `localStorage['ekoa_token']` - same-origin pages
  (INCLUDING served apps) can read the SAME localStorage.
- **Dev**: the preview iframe loads apps from the api proxy origin (:4111) while the dashboard is
  :3000 - CROSS-origin; the token is NOT visible to the app page there.
- Served-app END-USER identity (app-sso cookies) is a separate, per-app system - untouched by H2.
- The platform admission plane (H1) already enforces capability + ownership server-side on every
  edit vector (`POST /jobs` follow-up requires the caller JWT + canEditApps + writability).

## Options weighed

1. **Same-origin localStorage read by the PANEL (platform asset) + server-side detection** - the
   panel attaches the platform JWT (when present) to ONE dedicated detection endpoint; everything
   privileged is enforced server-side by the H1 gates.
2. postMessage probe to the opener/parent dashboard - only works when opened from Ekoa; adds a
   cross-window protocol; still needs server-side enforcement anyway.
3. Signed short-lived token appended on open-from-Ekoa - a second token class to mint, scope,
   expire and audit; duplicates what the JWT+server gates already give; helps only the dev
   cross-origin case, which graceful degradation covers.
4. Shared httpOnly cookie - changes the platform session model (localStorage-only today) for one
   feature; cookie would ride EVERY same-origin request including app asset fetches; oversized.

## DECISION: option 1 + fail-closed degradation

- **Detection**: the panel calls `GET /api/app-assistant/whoami` with `X-Ekoa-App-Id` +
  `Authorization: Bearer <token from localStorage, if readable>`. The endpoint - a deliberate,
  documented EXCEPTION to the assistant plane's visitor-blindness, for DETECTION ONLY (it never
  grounds, never bills, never widens admission) - verifies the JWT through the standard
  requireAuth-equivalent checks and answers `{ admin: boolean }`: true iff the verified caller is
  `org-admin`/`super-admin` of the artifact OWNER's org AND `can('canEditApps')`. Anything else
  (no token, cross-origin dev, invalid/expired, wrong org, user role) -> `{ admin: false }` -
  fail-closed, indistinguishable, no probing signal (no 403s that leak whether the app exists).
- **Detect-then-ask (binding)**: `admin: true` NEVER auto-enables anything. The panel renders a
  discreet affordance; edit powers require an explicit per-session opt-in (H3 owns that UX and the
  mode switch). On a shared machine, an abandoned admin session degrades to a visible affordance
  only - every actual edit action re-hits the H1 server gates with the same JWT.
- **Cross-origin dev preview**: token unreadable -> detection false -> no affordance. Acceptable:
  the dev preview is not the admin editing surface; opening the app directly on the api origin
  (or in deployment) detects normally. No magic-link in v1 (YAGNI; the queue path H4 covers
  "I cannot edit here" flows).
- **Exposure honesty**: any same-origin page - including generated app code - can ALREADY read
  `localStorage['ekoa_token']`. H2 does not widen that exposure (the panel reading it in-page adds
  nothing an app script could not do); the mitigations are the pre-existing epoch/revocation
  machinery + H1 server-side gating on every privileged action + this being ledgered for the
  platform-hardening backlog (a move to httpOnly platform sessions is a post-run decision,
  orthogonal to H). Recorded so H6's codex pass sees it stated, not hidden.
- **Reuse Cortex identity; no per-app login for admins** (brief binding) - satisfied: the ONLY
  identity involved is the platform JWT, verified by the platform verifier.

## H2 implementation scope (after H1 lands)

1. `GET /api/app-assistant/whoami` on the app-assistant router: X-Ekoa-App-Id charset checks
   reused; Bearer optional; standard token verification incl. revocation/epoch/activation; owner
   resolution reused from admit(); response `{ admin: boolean }` (shared zod contract + contract
   test; never 4xx on missing/invalid token - always 200 `{ admin: false }` unless the app id
   itself is invalid).
2. Panel: on mount (lazy asset), read the token (try/catch - cross-origin/sandbox safe), call
   whoami once, expose `admin` on panel state. NO UX beyond a state flag + a minimal discreet
   indicator; H3 consumes it.
3. Tests: unit (endpoint matrix: no token / invalid / expired-epoch / wrong-org admin / same-org
   user / same-org org-admin / super-admin), contract (200 shape both ways), panel state test.
   Live probe (lead): curl whoami with and without a real admin token on the dev stack.
