---
name: layout-and-design
description: How to apply the runtime design tokens and the left-nav shell layout for an app-auth-persistent build
---

# Layout & Design

This base ships a left-nav shell layout. Visual styling is delivered at runtime via the platform's design-tokens stylesheet — never bake hex literals into the app.

## Runtime design tokens

The platform serves a global stylesheet at `GET /api/design-tokens.css` that publishes the locked CSS variable contract (see `ekoa-data/bases/CSS_VARS_CONTRACT.md`). Every app's `index.html` already links to it via the scaffold template. **Do not duplicate the link tag; do not re-emit these variables on `:root` in your own CSS.**

When the company branding changes, this endpoint regenerates and every running app picks up the new colours on next reload — no rebuild.

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

- Do **not** inline a hex literal in any style — it breaks brand inheritance.
- Do **not** import `tokens.json` and spread it onto `:root` — that pattern is legacy; the runtime endpoint is the single source of truth.
- Do **not** use Tailwind colour utilities (`bg-teal-500`, `text-slate-700`) — they bypass the variable contract.

## The left-nav shell

See `layouts/left-nav-shell.md` for the canonical layout. Implement it as a `<Shell>` component:

- Top bar (40-48px): app name on the left, optional user widget on the right.
- Left nav (220px on desktop, drawer on mobile <768px): nav links, each with an icon and label.
- Content area: scrolls vertically; max-width 1200px on wide screens.
- Empty-state and error-boundary regions live inside the content area.

Use `var(--space-*)` for paddings, `var(--shadow-md, …)` for the top bar elevation, `var(--color-border, …)` for borders.

## Required regions

Every page must include:

1. **Header** with page title from the route.
2. **Empty state** when the collection is empty — use the `empty-state.json` recipe shape.
3. **Error boundary** wrapping any data-fetching component — use the `error-boundary.json` recipe shape.

## Multi-page

The shell is multi-page. Use React Router (already wired in the base). Do not write a one-page app.

## Typography scale

Use the locked scale:

- `--text-xs` (12px) — labels, captions
- `--text-sm` (14px) — secondary text
- `--text-base` (15px) — body
- `--text-lg` (18px) — section headings
- `--text-xl` (20px) — card titles
- `--text-2xl` (24px) — page titles
- `--text-3xl` (30px) — hero / landing only

Do not invent sizes outside this scale.
