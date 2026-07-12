---
name: base-conventions
description: Always-loaded conventions for builds using the app base (the default interactive multi-page app)
---

# Base Conventions - app

This is the default base: an authenticated, interactive, multi-page app with per-app persistence, the integrations client, error boundaries, and the platform's assistant mount point. Apply these conventions on every build that uses this base.

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

- **Pages.** Write a component under `frontend/src/pages/{PascalCase}.jsx` and register it in the `PAGES` array in `App.jsx` (`{ id, label, component }`). The first entry is the default page - replace the shipped starter with the product's real first screen.
- **Page content and data.** Read/write through `lib/jsonStore`. An app never calls an external service directly - cross-service work is declared as `integration.call` capabilities in `MANIFEST.md` and executed by the platform; the only in-app integration call is the visitor's own Microsoft 365 via `lib/protocol-client`'s `graphFetch`.
- **Shell chrome only for user-requested extras** (a user menu, a global search box). Keep the top bar, the nav mechanism, the root error boundary, and the assistant mount intact.

## Rules

1. **Start from the existing files.** Modify `App.jsx` to register pages; add page components under `frontend/src/pages/`. Do not rewrite `index.jsx`/`index.css` without a strong reason.
2. **NEVER remove the assistant mount point.** The empty `<div id="ekoa-assistant-root">` in `App.jsx` is where the platform's operator assistant panel mounts in a later slice. Do not delete it, do not render your own children into it, do not repurpose it.
3. **NEVER remove the `data-demo-target` attributes** on the shell landmarks (`app-shell`, `app-topbar`, `app-nav`, `app-content`, `assistant-root`). Platform tooling targets them by those stable selectors.
4. **Never call an external service directly** - no OAuth, no API keys, no SDKs. Declare cross-service actions as `integration.call` capabilities in `MANIFEST.md` (platform-executed); use `graphFetch` only for the visitor's Microsoft 365. When a needed integration is not connected, render `<IntegrationNeededBoundary />`.
5. **Always wrap data-rendering subtrees in `<ErrorBoundary>`** (already at the page root; add more around risky subtrees). Never swallow a fetch error silently - surface it.
6. **Always render an empty state** for a collection that can be empty (`empty-state` recipe).
7. **Style only through the CSS-variable contract with fallbacks.** No hex literals in component code. The brand arrives at runtime via `/api/design-tokens.css`.
8. **Never use `localStorage`/`sessionStorage`/`indexedDB` for primary data.** Use the app-data API (`lib/jsonStore`).

## The assistant mount SUPERSEDES the "no side panel" rule

The prior app base forbade inventing a side panel or chat mode. **That prohibition is lifted for exactly one thing: the platform-provided `#ekoa-assistant-root` mount, which is part of this shell and which you must keep.** It is NOT license to build your own assistant: you still must not invent a chat UI, a wizard, or a second assistant surface of your own. The single sanctioned assistant surface is the platform mount; leave it empty and untouched.

## Naming

- Page files: `frontend/src/pages/{PascalCase}.jsx`.
- Library files: `frontend/src/lib/{kebab-case}.{ts,js}` (or the shipped `PascalCase.jsx` components).
- Collection names: kebab-case plurals (`todos`, `customer-contacts`).
