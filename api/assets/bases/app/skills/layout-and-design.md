---
name: layout-and-design
description: How to apply the runtime design tokens and the shipped left-nav shell for an app build
---

# Layout & Design

This base ships a left-nav multi-page shell (`frontend/src/App.jsx`) and its
styles (`frontend/src/index.css`). Visual styling is delivered at runtime via
the platform's design-tokens stylesheet - never bake hex literals into the app.

## Runtime design tokens

The platform serves a global stylesheet at `GET /api/design-tokens.css` publishing the locked CSS-variable contract. Every app's `index.html` already links to it. **Do not duplicate the link tag; do not re-emit these variables on `:root`; do not `import`/`@import` the endpoint (it breaks the bundler).**

When company branding changes, the endpoint regenerates and every running app picks up the new colours on next reload - no rebuild.

### How to consume

Write every style using the variable contract with a fallback:

```css
.btn-primary {
  background: var(--color-primary, #0F766E);
  color: var(--color-bg, #FFFFFF);
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  border-radius: var(--radius-md, 0.5rem);
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: var(--text-base, 0.9375rem);
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.05));
}

.card {
  background: var(--color-surface, #F8FAFC);
  border: 1px solid var(--color-border, #E2E8F0);
  border-radius: var(--radius-lg, 0.75rem);
  padding: var(--space-6, 1.5rem);
}
```

### What NOT to do

- Do **not** inline a hex literal in any style - it breaks brand inheritance.
- Do **not** import `tokens.json` and spread it onto `:root` - the runtime endpoint is the single source of truth.
- Do **not** use Tailwind colour utilities (`bg-teal-500`) - they bypass the contract.

## The shipped shell

`App.jsx` already implements the shell described in `layouts/left-nav-shell.md`:

- Top bar (48px): app name (from `document.title`) on the left, the current user on the right.
- Left nav (220px desktop, wraps on mobile <768px): one button per registered page; the active page is highlighted.
- Content area: scrolls vertically, max-width 1200px, wrapped in `<ErrorBoundary>`.

**Add pages, don't rebuild the shell.** Write a page component under `frontend/src/pages/{PascalCase}.jsx` and register it in the `PAGES` array in `App.jsx` (`{ id, label, component }`). The shell switches pages from local state - add a router only if the app genuinely needs deep-linkable URLs; do not swap out the shipped nav.

## Shipped components

- `frontend/src/lib/ErrorBoundary.jsx` - wrap any data-rendering subtree (see the `error-boundary` recipe).
- `frontend/src/lib/IntegrationNeededBoundary.jsx` - render on a `needs_integration` result (see the `integration-needed` recipe).
- Empty states - see the `empty-state` recipe; render one for every collection that can be empty.

## Typography scale

Use the locked scale only: `--text-xs` (12) labels, `--text-sm` (14) secondary, `--text-base` (15) body, `--text-lg` (18) section headings, `--text-xl` (20) card titles, `--text-2xl` (24) page titles, `--text-3xl` (30) hero. Do not invent sizes outside it.
