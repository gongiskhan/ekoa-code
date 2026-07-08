# G12 built-in full-repo security review (F1) — triage

Fresh-context whole-repo security pass (Opus, decorrelated from the Codex scopes — no implementer context, gathered its own evidence). Read every named security-critical surface: auth (jwt/middleware/revocation/config), the scoped data layer (scoped/store/collections-engine/crypto), the LLM chokepoint (client/credentials/gateway/rate-caps), bridge (token/server), integrations (action-executor/app-sso), automation (local-command), the served-app plane (serving/injected-context/served-data/app-files), SSRF (url-safety/url-fetcher), webhooks (webhook-verifiers/events), path confinement (safe-path), and route wiring.

**Verdict: issues-found — 2 medium, no critical/high.** The reviewer's own summary: the posture is "genuinely strong and consistent with a long hardened build" — alg-pinned JWT + jti revocation + token-epoch + fail-closed activation; structural tenant scoping (cannot express an unscoped query, uniform 404s); deny-by-default on every route; chokepoint rate/spend caps + anonymisation with ephemeral-vault clearing; SSRF guard covering decimal/hex/IPv4-mapped-IPv6 + DNS-rebind + redirect:error; timing-safe webhook HMAC + dedup; the bridge connect-auth chain; app-SSO PKCE+nonce+RS256+single-use-state; realpath path jails; a fully parameterized collections engine. No injection, IDOR/BOLA, credential-in-cleartext, system-prompt leakage, or NoSQL injection found.

## Finding 1 (MED) — security-headers baseline absent → FIXED

The spec mandates (ch09 §9.8 **D1**, FIXED-14) a composition-root security-headers middleware — CSP, HSTS, X-Content-Type-Options, frame-ancestors — plus **a header-presence contract test**, and served apps under CSP. Verified absent repo-wide (no helmet, no header middleware, no test). D1 is a baseline control, NOT a §9.9 certification-phase deferral, so its absence is a real conformance gap the final security phase must close.

**Fix:**
- `api/src/security-headers.ts` — composition-root middleware (mounted first in `buildApp`): universal `X-Content-Type-Options: nosniff` + `Referrer-Policy: no-referrer` + `Strict-Transport-Security` on every response; surface-split for the rest — the JSON API surface (`/api*`, `/health`, `/hooks`) gets a locked `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'` + `X-Frame-Options: DENY` (these responses render nothing, so the strict CSP cannot break them); the served-app plane gets `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` — **framing-scoped containment (anti-clickjacking) that preserves FIXED-9 byte-compat** (the ported bundles keep loading their own inline/external resources; a resource-restricting CSP there would break the 127-spec served-app suite).
- `web/next.config.ts` `headers()` — the dashboard half of D1: a dashboard-scoped CSP (self + Next's inline; connect to the API origin; `frame-ancestors 'none'`) + HSTS/nosniff/referrer/X-Frame-Options.
- `api/tests/security-headers.test.ts` — the mandated header-presence contract test (3 tests: universal headers; strict API-surface CSP/DENY; served-app framing containment). **The determinism ratchet guard for this class.**

## Finding 2 (MED) — per-app served-data plane keyed on the forgeable `X-Ekoa-App-Id` header → ACCEPTED (documented)

The reviewer flagged the per-app key-value plane (`/api/app-data`) as authorized only by the client-supplied `X-Ekoa-App-Id` header (cross-app read/write of app-global data) — and rated materiality "medium … may be an accepted design." Confirmed **accepted byte-compat design**: `served-data.ts` documents it verbatim — the OLD per-app plane never required app existence and keyed data on the charset-checked header directly (FIXED-9 byte-compat); per-app data is app-global by design, never per-user-private. The private/shareable plane (`/api/app-shared`) DOES carry real hardening (resolved-owner requirement + same-origin guard + `sharedData` opt-in + activation gate), and per-user data lives behind the platform JWT / app-SSO session. Changing the per-app plane's auth would break byte-compat and the 127-spec served-app suite.

**Action:** documented the deliberate split in `docs/security/access-control.md` ("Served-app data planes (byte-compat, by design)") so the open posture is a recorded decision, not an oversight. No code change (would regress byte-compat).

## Guard added (determinism ratchet)
`api/tests/security-headers.test.ts` pins the D1 baseline so a future removal of the headers is machine-caught.
