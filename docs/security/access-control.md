# Access control policy

One page (security addendum E.5; spec ch09 §9.2, §9.3, §9.8-A). Grows into the ISMS at certification phase (§9.9).

## Principles

- **Deny by default.** Every `/api/v1` route passes auth middleware; the pre-auth exemptions are exactly the `public` class of ch03 §3.2 (login, device flow, health, demos, public static assets), enforced by a route-census contract test.
- **Authorization is code, never the model** (A1). Every tool call and data access is authorized by deterministic code against the caller's identity and org. A model-decided authorization path is a review-rejectable finding.
- **Object-level checks on every resource fetch** (A2): ownership/org verified on the loaded object, uniform 403/404 (no existence leaks), exercised by the cross-org adversarial suite at every gate.
- **Org scoping is structural, not disciplinary** (A3): the `data/` scoped repository layer is the only query constructor and cannot express an unscoped query; routes never import `data/`.
- **Least privilege**: agent runs execute in the requesting user's security context with a minimal per-context tool allowlist (A4); no generic high-privilege identity for user work. Service accounts per function, separated dev/prod projects (owner action, D5).

## Roles

Exactly three: `super-admin` (platform), `org-admin` (org administration), `builder` (default member). Scopes derive from the role; privileged routes re-resolve the user from the store, never trusting stale token claims. Private items (memories, artifacts) are invisible to org admins; sharing is explicit.

## Credential planes (mutually non-interchangeable)

| Class | TTL | Notes |
|---|---|---|
| Platform session JWT | 24 h (30 d rememberMe) | single mint point in `auth/`; verifier positively rejects bridge tokens |
| Bridge token (daemon WS) | 600 s | `aud: ekoa-bridge` + pairing binding; verifier rejects session JWTs |
| App-SSO session (served apps) | 8 h | HttpOnly opaque cookie, server-side record, one canonical appId |
| Gateway key | static | constant-compare on the ekoa-local gateway |

## Lifecycle

- Accounts are org-bound with a write-through `active` map: deactivation takes effect immediately (boot- and admission-gated).
- Deactivation and role change bump the token epoch, invalidating outstanding JWTs (§9.6).
- Bridge pairings are org-scoped, revocable at any time (kill switch), and revocation tombstones survive redials.
- MFA on all admin surfaces (GCP console, deploy credentials, data access) is an owner action (A5), flagged on the cutover checklist.

## Served-app data planes (byte-compat, by design)

The per-app key-value plane (`/api/app-data/:collection`) is **unauthenticated app-global storage**, scoped by the client-supplied `X-Ekoa-App-Id` header — carried verbatim from old Cortex for byte-compatibility (FIXED-9; the old plane never required the app to exist). It is app-global by design and must **never** hold confidential or per-user-private data. Anything private lives on a server-authenticated plane instead: the **shared** namespace (`/api/app-shared`) requires a resolved owner, a same-origin guard, and an explicit `sharedData` opt-in; per-user data lives behind the platform JWT or the app-SSO session (server-side record, one canonical appId). This split is deliberate — recorded here so the per-app plane's open posture is a documented decision, not an oversight (whole-repo security review, G12).

## Audit

Auth events, admin operations, and privileged data access (who read what, when; CCBE-aligned for legal data) land in Registo through the single audit write path.
