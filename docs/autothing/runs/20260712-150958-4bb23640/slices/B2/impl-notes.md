# Slice B2 - author the internal `app` base

The strategic default base every future generated app builds from. It is `app-auth-persistent` promoted into a real, pixel-tested scaffold, plus two net-new surfaces (a first-class protocol client and the operator assistant mount point), with the donor's token drift reconciled to the CSS-var contract.

## Files created (all under `api/assets/bases/app/`)

**Descriptor / tokens**
- `manifest.json` - `{id:"app", name:"Ekoa App", description, version:"1.0.0", mustEdit:["frontend/src/App.jsx"]}`. `mustEdit` added to match the sibling bases' schema (see Deviations).
- `tokens.json` - copied from the donor verbatim (kept for parity; the loader does not consume it - tokens are served by reference at `/api/design-tokens.css`).

**scaffold/ (a REAL pre-built shell, copied verbatim into the project)**
- `scaffold/frontend/src/App.jsx` - the left-nav multi-page shell. Renders top bar (app name from `document.title` + current user from `getCurrentUser`), a `PAGES`-registry left nav with local-state page switching, the active page inside a root `<ErrorBoundary>`, and the EMPTY `<div id="ekoa-assistant-root" data-demo-target="assistant-root" />` assistant mount (commented: the panel runtime mounts here in a later slice; no panel implementation, no chat UI). Shell landmarks carry `data-demo-target` attributes (`app-shell`, `app-topbar`, `app-nav`, `app-content`, `assistant-root`). A default inline `HomePage` (clean starting-point, no mock data) is the first registered page.
- `scaffold/frontend/src/index.jsx` - standard entry (`createRoot(#root)`), same as the generic/document scaffolds.
- `scaffold/frontend/src/index.css` - full shell styling using ONLY the CSS-var contract vocabulary with fallbacks (`--color-*`, `--font-sans/mono`, `--text-*`, `--space-*`, `--radius-*`, `--shadow-*`). Reconciles the donor's drifted `--spacing-*`/`--typography-*` names to `--space-*`/`--text-*`.

**wiring/ (mapped by the loader to `frontend/src/lib/<basename>`)**
- `auth.ts` - copied from donor (dropped the stale `cortex/...` path reference in the comment). `getAppId` / `getCurrentUser`.
- `jsonStore.ts` - copied from donor (dropped the stale `cortex/...` reference). `list/get/create/update/remove`.
- `IntegrationNeededBoundary.jsx` - copied from donor with the drifted inline tokens reconciled to the contract (`--spacing-lg`->`--space-6`, `--typography-h3-size`->`--text-xl`, raw rem literals -> `--space-*`/`--text-*`, `#fff`->`var(--color-bg)`).
- `protocol-client.ts` - **NEW.** The first-class typed client the donor's `auth.ts`/`integrations.ts` used ad-hoc: `action(app, intent, params)` posts the `{app,intent,params}` envelope to `/api/v1/action` and returns `data`, throwing `ActionFailed` on `action_error`/non-2xx (mirrors the real envelope shapes `action_result`/`action_error` from `tests/e2e/helpers/test-client.ts`). `callIntegration<T>()` is re-exported OVER `action`, preserving the exact `{ok:true,data}` / `{ok:false,status:'needs_integration',...}` shapes and mapping any transport/action failure to `needs_integration` so the UI has one branch.
- `ErrorBoundary.jsx` - **NEW.** A real React class error boundary (from the donor's `error-boundary` recipe): `getDerivedStateFromError` + `componentDidCatch`, `retry()`, optional `fallback({error,retry})`/`onError`, default card ("Ocorreu um problema" / "Tentar de novo" / "Reportar") styled via the contract tokens.

**instructions/**
- `base-conventions.md` - **NEW (major adaptation).** Documents what is already built (shell, auth, persistence, protocol client, error boundaries, assistant mount), what the agent edits (pages under `frontend/src/pages/` + the `PAGES` registry, page data), and the rules. Rule 2/3 forbid removing the assistant mount and the `data-demo-target` attributes. A dedicated section EXPLICITLY supersedes the donor's "never invent a side panel" prohibition ONLY for the platform `#ekoa-assistant-root` mount, while still forbidding the agent from inventing its own chat/assistant UI.

**skills/** (EN, mirroring the donor app base; terse)
- `using-auth.md` - reconciled to the shipped `auth.ts`: `getCurrentUser`/`getAppId`, per-app header scoping, no token to manage, no login form. (Dropped the donor skill's `window.__EKOA_TOKEN` JWT claim, which contradicted the shipped `auth.ts`.)
- `using-persistence.md` - adapted to import from `./lib/jsonStore` (donor content otherwise accurate).
- `using-integrations.md` - `callIntegration` import path moved to `./lib/protocol-client`; boundary import fixed to `./lib/IntegrationNeededBoundary` (donor had a wrong `./lib/integration-needed-boundary` path); added a short note on the generic `action` envelope.
- `layout-and-design.md` - stale `ekoa-data/bases/CSS_VARS_CONTRACT.md` path dropped; "React Router (already wired)" replaced with the shipped `PAGES`-registry / local-state nav; points at the shipped `ErrorBoundary`/`IntegrationNeededBoundary`.

**layouts/**
- `left-nav-shell.md` - adapted from the donor: ASCII diagram updated to show the `ErrorBoundary` + assistant mount, informal `spacing.lg`/`typography.h2` notation reconciled to `--space-*`/`--text-*`, routing section rewritten for the state-based `PAGES` nav.

**recipes/**
- `empty-state.json` - copied from donor verbatim.
- `integration-needed.json` - copied; `--spacing-lg`->`--space-6`; added a `shipped` note pointing at the shipped component.
- `error-boundary.json` - updated to reference the SHIPPED `frontend/src/lib/ErrorBoundary.jsx` (import + use, do not hand-build); `--spacing-md`->`--space-4`; added the async-error guidance.

## Code change (one line class)
- `api/src/apps/base-loader.ts` - added `'app'` as the first entry of `BASE_IDS`. (The file was concurrently edited by B3 to add an optional `mustEdit` field + honest-completion signal; my one-line change applied cleanly alongside it.)

## Test added
- `api/tests/apps/base-loader.test.ts` - added one test to the `registry + loader (B1)` describe: `loadBase('app')` returns `scaffoldFiles` containing `frontend/src/App.jsx` whose content includes `'ekoa-assistant-root'`, and `baseProjectFiles(base)` maps `protocol-client.ts` to `frontend/src/lib/protocol-client.ts`.

## Validation (all green)
- `npx vitest run tests/apps/base-loader.test.ts` (from `api/`) - **9 passed** (8 pre-existing incl. B3's gate test + my new one).
- `npx tsc --noEmit -p tsconfig.json` - **exit 0**. `npx tsc --noEmit -p tsconfig.test.json` - **exit 0**. (Wiring `.ts` template files live under `api/assets/` and are outside both tsconfigs' `include`, so they are not typechecked here - correct, they reference runtime globals.)
- `npx eslint src/apps/base-loader.ts` - **exit 0**.
- **End-to-end bundle check (offline):** materialized the base's mapped project layout (scaffold -> `frontend/src/*`, wiring -> `frontend/src/lib/<basename>`) and bundled `index.jsx` with esbuild (`jsx: 'automatic'`, React/react-dom marked external as they resolve via esm.sh at real build time). Result: local module graph resolves (App.jsx -> `./lib/auth`, `./lib/ErrorBoundary`; index.jsx -> App.jsx + index.css), TS types strip, JSX transforms, **0 warnings, ~7.6 KB JS**. This is the first base whose scaffold imports wiring files from `lib/`, so this path was worth proving.
- JSON validity re-checked for all 5 JSON files after the punctuation pass.
- No emoji in any authored file. Em-dashes converted to plain dashes across the base per the machine owner's standing rule (this is fresh authored output; a byte-diff vs the donor is not an acceptance criterion).

## Deviations from the brief (all deliberate)
1. **`mustEdit` in the manifest.** The brief's manifest shape predated B3's schema change. B3 (concurrent) added an optional `mustEdit: string[]` consumed by the honest-completion gate and populated it on the sibling bases (`document` -> `documentData.js`, `app-auth-persistent` -> `App.jsx`). I set the app base's `mustEdit` to `["frontend/src/App.jsx"]` for consistency and so the strategic base is gated like its siblings (an untouched shell is exactly the F16/F28 "looks plausible but empty" failure). Optional field, so it does not conflict with the brief's stated shape.
2. **No separate `integrations.ts` in wiring.** Per the brief, `callIntegration` is re-exported over the generic `action` inside `protocol-client.ts` rather than shipped as its own `integrations.ts`. Skills/recipes import `callIntegration` from `./lib/protocol-client`.
3. **State-based nav instead of React Router.** The shipped shell uses a `PAGES` registry + local-state switch (like the document base's tab pattern) rather than a router dependency, for robustness (no CDN router resolution) and simplicity. Skills/layout updated to match; a router is called out as opt-in when deep-linkable URLs are actually needed.
4. **Token drift reconciled in copied components too** (`IntegrationNeededBoundary.jsx`, recipe visual rules), not only in `index.css` - shipping known-drifted `--spacing-*`/`--typography-*` names into the strategic base would defeat the purpose of the reconciliation.
5. **`using-auth.md` reconciled to the shipped `auth.ts`** - the donor skill's `window.__EKOA_TOKEN` claim contradicted its own wiring (which states there is no inline token); kept the skill consistent with the code it ships.

## Scope
Touched only: `api/assets/bases/app/**`, `api/src/apps/base-loader.ts` (one line), `api/tests/apps/base-loader.test.ts` (one test), and this impl-notes file. Did NOT commit (lead commits).
