---
name: base-conventions
description: Always-loaded conventions for builds using the app base (the default interactive multi-page app)
---

# Base Conventions - app

This is the default base: an interactive multi-page app with visitor identity (anonymous by default - whoami() may be null), per-app persistence, platform-executed integration capabilities (never a client-side integration call), error boundaries, and the platform's assistant mount point. Apply these conventions on every build that uses this base.

## THE SHELL IS ALREADY BUILT - add pages, don't rebuild it

The project was scaffolded from the platform's pre-built, pixel-tested shell:

- `frontend/src/App.jsx` - the left-nav multi-page shell. It renders the top bar (app name + current user), the left nav, and the active page inside a root `<ErrorBoundary>`. **Customize by adding pages; do not recreate the shell.**
- `frontend/src/index.jsx` - entry point (renders `<App />` into `#root`). Don't rewrite it.
- `frontend/src/index.css` - shell styles, written entirely against the CSS-variable contract with fallbacks.

The wiring libraries under `frontend/src/lib/` are shipped and ready - import them, don't reinvent:

- `lib/auth.ts` - `getCurrentUser()` (best-effort identity for the top bar) and `getAppId()`.
- `lib/jsonStore.ts` - per-app persistence: `list/get/create/update/remove`.
- `lib/protocol-client.ts` - typed wrappers over the injected runtime: `whoami/signIn/signOut`, `graphFetch` (the visitor's Microsoft 365), `exportPdf`, `cloudFiles`. Each degrades cleanly when the runtime is absent.
- `lib/ErrorBoundary.jsx` - the shipped recoverable error UI (mounted at the shell root and around each page).
- `lib/IntegrationNeededBoundary.jsx` - the "connect a provider" CTA for a `needs_integration` result.

## What you edit

- **Pages.** Write a component under `frontend/src/pages/{PascalCase}.jsx` and register it in the `PAGES` array in `App.jsx` (`{ id, label, component }`). The first entry is the default page - the shipped starter is a user-facing "a construir..." placeholder the end user watches while you work; ALWAYS replace it with the product's real first screen before finishing.
- **Page content and data.** Read/write through `lib/jsonStore`. An app never calls an external service directly - cross-service work is declared as `integration.call` capabilities in `MANIFEST.md` and executed by the platform; the only in-app integration call is the visitor's own Microsoft 365 via `lib/protocol-client`'s `graphFetch`.
- **Shell chrome only for user-requested extras** (a user menu, a global search box). Keep the top bar, the nav mechanism, the root error boundary, and the assistant mount intact.

## Rules

1. **Start from the existing files.** Modify `App.jsx` to register pages; add page components under `frontend/src/pages/`. Do not rewrite `index.jsx`/`index.css` without a strong reason.
2. **NEVER remove the assistant mount point.** The empty `<div id="ekoa-assistant-root">` in `App.jsx` is where the platform's operator assistant panel mounts in a later slice. Do not delete it, do not render your own children into it, do not repurpose it.
3. **NEVER remove the `data-demo-target` attributes** on the shell landmarks (`app-shell`, `app-topbar`, `app-nav`, `app-content`, `assistant-root`). Platform tooling targets them by those stable selectors.
4. **Never call an external service directly** - no OAuth, no API keys, no SDKs. Declare cross-service actions as `integration.call` capabilities in `MANIFEST.md` (platform-executed); use `graphFetch` only for the visitor's Microsoft 365. When a needed integration is not connected, render `<IntegrationNeededBoundary />`.
5. **Always wrap data-rendering subtrees in `<ErrorBoundary>`** (already at the page root; add more around risky subtrees). Never swallow a fetch error silently - surface it.
6. **Always render an empty state** for a collection that can be empty - use the shipped `.empty-state` block (`.empty-state-title` + `.empty-state-subtitle`) from `index.css`. Say what the collection is and what the user does first; never just "Sem dados".
7. **Style only through the CSS-variable contract with fallbacks.** No hex literals in component code. The brand arrives at runtime via `/api/design-tokens.css`. On a primary-filled surface the label colour is `var(--color-on-primary, #FFFFFF)`, never `--color-bg`.
8. **Never use `localStorage`/`sessionStorage`/`indexedDB` for primary data.** Use the app-data API (`lib/jsonStore`).
9. **Compose the shipped primitives before writing component CSS.** `index.css` ships a crafted, brand-adaptive vocabulary with every state already covered - `.btn` (`.btn-primary`/`.btn-secondary`/`.btn-ghost`/`.btn-danger`, `.btn-sm`), `.field`/`.field-label`/`.field-error` with `.input`/`.select`/`.textarea`, `.card`, `.table` inside `.table-scroll`, `.badge` variants, `.skeleton`, and the `.page`/`.page-header`/`.page-title`/`.page-subtitle` frame. Plain `h2`/`h3`/`p` inside `.page` already sit on the vertical rhythm. Reach for a new class when the product needs one, not to re-solve a button.

## The assistant mount SUPERSEDES the "no side panel" rule

The prior app base forbade inventing a side panel or chat mode. **That prohibition is lifted for exactly one thing: the platform-provided `#ekoa-assistant-root` mount, which is part of this shell and which you must keep.** It is NOT license to build your own assistant: you still must not invent a chat UI, a wizard, or a second assistant surface of your own. The single sanctioned assistant surface is the platform mount; leave it empty and untouched.

## Routing (only if you add react-router)

The shipped shell switches pages with plain component state, not URL routes - most builds never
need more. If your product needs deep-linkable or parameterized routes (e.g. `/contactos/:id`)
and you add `react-router-dom`, one thing is easy to get wrong and breaks the whole app:

**A top-level `<BrowserRouter>` MUST derive `basename` at mount time - never omit it, never
hardcode it.** The built app is served at `/apps/<id>/`, not at the domain root, so
`window.location.pathname` there is `/apps/<id>/...`. A `<BrowserRouter>` with no basename (it
defaults to `/`) matches routes as if the app owned the whole domain - it never matches the real
served path, and the app renders blank or falls into its own not-found route.

```js
const m = window.location.pathname.match(/^(\/apps\/[^/]+)/);
const basename = m ? m[1] : '/';

root.render(<BrowserRouter basename={basename}><App /></BrowserRouter>);
```

(Deriving from `window.__EKOA_APP_ID` instead is equally correct. `HashRouter`/`MemoryRouter`
don't need this - they don't route off the served path.) A repo-wide test
(`api/tests/apps/featured-router-catalog-guard.test.ts`) builds every scaffold that mounts a
`BrowserRouter` and fails loudly, by name, if this is missing or wrong.

## Naming

- Page files: `frontend/src/pages/{PascalCase}.jsx`.
- Library files: `frontend/src/lib/{kebab-case}.{ts,js}` (or the shipped `PascalCase.jsx` components).
- Collection names: kebab-case plurals (`todos`, `customer-contacts`).
