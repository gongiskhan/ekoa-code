# Slice B2 - gate-failure fix: rewire the `app` base off the retired `/api/v1/action` envelope

## Root cause

The base's donor-derived wiring carried the OLD Cortex control-plane envelope
`POST /api/v1/action` (`ekoa.auth`/`intent:me`, `ekoa.integrations`/`call`). That
route is RETIRED on the rebuilt platform (404). The live gate built a real app
from the base, the shell's identity call hit the dead endpoint, and the verifier
honestly failed it.

The sanctioned served-app client is the INJECTED runtime `window.__ekoa`, stamped
into every served document by `api/src/apps/injected-context.ts` (the byte-compat
plane, api-contract 3.9). Ground truth read directly from that file and from
`api/src/integrations/app-sso.ts` (the `/api/app-sso/me` payload) before writing -
no invented shapes this time.

## Files changed (all under `api/assets/bases/app/`)

- **`wiring/protocol-client.ts`** - fully rewritten as the typed client OVER the
  injected runtime. Exports typed `whoami()`, `signIn()`, `signOut()`,
  `graphFetch()`, `exportPdf()`, `cloudFiles`, plus `getRuntime()` and a typed
  `RuntimeUnavailable` error and the `WhoAmI`/`EkoaRuntime` interfaces. Degrade
  rules: `whoami()` -> `null` when the runtime is absent (read path, silent); the
  action wrappers (`signIn/signOut/graphFetch/exportPdf/cloudFiles`) throw
  `RuntimeUnavailable` the caller can catch. **REMOVED** the `/api/v1/action`
  envelope and `callIntegration` entirely. `WhoAmI` matches the real
  `/api/app-sso/me` data: `{ email, name|null, oid|null, tid|null, canSendMail }`.
- **`wiring/auth.ts`** - rewritten over `whoami()` + `window.__EKOA_APP_ID`.
  `getCurrentUser()` returns `WhoAmI | null`, cached, NON-THROWING (logged-out or
  absent-runtime both -> null). `getAppId()` returns `string | null` (no throw).
  Re-exports `signIn`/`signOut`. Doc states: authorize by `oid` (+`tid`), never
  `email`. (`jsonStore.ts` was left UNCHANGED - it targets `/api/app-data`, which
  is correct.)
- **`scaffold/frontend/src/App.jsx`** - top-bar user now renders the `WhoAmI|null`
  shape: `{user ? (user.name || user.email) : ''}` (nothing for an anonymous
  visitor). Header comment updated to the real protocol surface. The shell makes
  no other runtime call and does not throw when `window.__ekoa` is absent
  (getCurrentUser resolves null; HomePage is static; ErrorBoundary is inert).
- **`skills/using-auth.md`** - rewritten to the `whoami`/`signIn`/`signOut`
  surface, the `oid(+tid)`-never-`email` rule, the anonymous-by-default posture,
  and the note that the reliable SSO context is the standalone `/apps/{slug}/`
  URL (iframe third-party-cookie limits).
- **`skills/using-integrations.md`** - rewritten to the real model: an app never
  calls an external API directly; cross-service work is `integration.call`
  capabilities declared in `MANIFEST.md` and executed by the platform; the only
  in-app integration call is the visitor's own Microsoft 365 via `graphFetch`;
  `IntegrationNeededBoundary` is the UI state when a needed integration is not
  connected (e.g. `graphFetch` -> 401/403). `callIntegration` removed.
- **`recipes/integration-needed.json`** - `renderWhen` re-pointed from
  `callIntegration returns needs_integration` to "a capability the UI depends on
  has no connected integration (e.g. graphFetch 401/403)"; subtext line delinted.
- **`instructions/base-conventions.md`** - the shipped-lib list entry for
  `protocol-client.ts` and rules 4 + the "what you edit" bullet rewritten off
  `callIntegration`/`action(...)` onto the capabilities + `graphFetch` model.
- **`wiring/IntegrationNeededBoundary.jsx`** - header comment delinted (no longer
  references `callIntegration`); component body unchanged.

No change to `api/src/**` or the B2 test in this fix: the added loader test
asserts only the assistant mount + that `protocol-client.ts` maps into `lib/`
(both still true), not any protocol-client internals - so it did not need updating.

## Validation (all green)

- `npx vitest run tests/apps/base-loader.test.ts` (from `api/`) - **12 passed**
  (the file has grown with C1's classifier tests, incl. `no templateId ... app
  default` which builds a REAL app from this base and asserts the shell + `extends:'app'`).
- `npx tsc --noEmit -p tsconfig.json` - **exit 0**. `npx tsc --noEmit -p tsconfig.test.json` - **exit 0**.
- `npx eslint src/apps/base-loader.ts` - **exit 0**.
- **Offline esbuild bundle proof** (deeper graph now: `index.jsx -> App.jsx ->
  {lib/auth -> lib/protocol-client, lib/ErrorBoundary}`) - resolves, TS strips,
  **0 warnings**.
- **Runtime-degrade proof** (bundled `auth.ts`+`protocol-client.ts`, exercised in
  node with `window` stubs) - all 7 checks pass: no `window` -> `getCurrentUser`
  null / `getAppId` null / no throw; `window` present but no `__ekoa` -> null / no
  throw; `signIn()` throws typed `RuntimeUnavailable`; runtime present + logged
  out (`whoami->null`) -> null / no throw; runtime present + signed in -> `WhoAmI`
  keyed by `oid`. This is the exact contract the gate needed: the shell renders
  fully with no runtime (no error card), and in a real served app calls the
  injected `whoami()` (which hits `/api/app-sso/me`, a live endpoint) instead of
  the retired `/api/v1/action`.
- Re-swept the base: 0 references to `/api/v1/action`, `callIntegration`,
  `action(app...`, `action_result/error`, `__EKOA_TOKEN`; 0 em-dashes; 0 emoji.

## Scope
Touched only `api/assets/bases/app/**` and this notes file. Did NOT commit; did NOT touch other bases.
