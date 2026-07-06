---
name: base-conventions
description: Always-loaded conventions for builds using the app-auth-persistent base
---

# Base Conventions — app-auth-persistent

This is an authenticated multi-page app with per-user persistence. Apply these conventions on every build that uses this base.

## What's already done

The scaffold already includes:

- `frontend/src/index.jsx` — entry point with `<App />` and resolved tokens applied to `:root` as CSS variables.
- `frontend/src/App.jsx` — left-nav shell with placeholder pages. Customize, don't recreate.
- `frontend/src/lib/integrations.ts` — `callIntegration<T>()` helper.
- `frontend/src/lib/integration-needed-boundary.tsx` — the boundary component.
- `frontend/src/tokens.json` — resolved design tokens (base + branding + featured overrides).
- `manifest.json` — declares `extends: "app-auth-persistent"`.
- Auth wiring — token injection lives in `window.__EKOA_TOKEN`; the fetch wrapper in `window.__ekoa.fetch` auto-attaches it.
- Persistence wiring — `window.__ekoa.fetch('/api/app-data/{collection}')` reads/writes per-app JsonStore.

## Rules

1. **Always start from the existing files.** Modify `App.jsx`, add new page components under `frontend/src/pages/`, extend the nav in `App.jsx`. Do not rewrite `index.jsx` unless you have a strong reason.
2. **Always use `callIntegration`** for any external service. Never write raw OAuth or API key handling.
3. **Always read `tokens.json`** for colours, spacing, typography. Apply via CSS variables. No hex literals in component code.
4. **Always handle the `needs_integration` shape** when integrations are involved. Render `<IntegrationNeededBoundary />` when present.
5. **Always wrap data-fetching in error boundaries** (see `recipes/error-boundary.json`).
6. **Always render an empty state** for collections (see `recipes/empty-state.json`).
7. **Never use localStorage for primary data.** Use the app-data API.
8. **Never invent a new chat mode, side panel, or wizard.** The user reaches the app via Ekoa's chat; the app itself is just the deliverable.

## Naming

- Page files: `frontend/src/pages/{PascalCase}.jsx`.
- Library files: `frontend/src/lib/{kebab-case}.{ts,js}`.
- Collection names: `kebab-case` plurals (`todos`, `customer-contacts`).
