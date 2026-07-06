---
name: base-conventions
description: Conventions for presentation base — slide deck format
---

# Base Conventions — presentation

This base produces a **slide deck**. Each route/segment is a slide. Keyboard navigation (←/→) is mandatory.

## Visual styling — runtime tokens only

Every app's `index.html` links to `/api/design-tokens.css`. Use the variable contract in `ekoa-data/bases/CSS_VARS_CONTRACT.md`. The same vocabulary applies to decks; presentation-specific intensity (dark background, large type) is achieved by composing the variables, not by inventing new ones.

```css
body { background: var(--color-text, #0F172A); color: var(--color-bg, #FFFFFF); }
.slide h1 { font-size: var(--text-3xl, 1.875rem); }
.cta { background: var(--color-primary, #0F766E); }
```

Every value must reference a variable with a fallback. No hex literals; no `:root` overrides.

## What's already done

- `frontend/src/index.jsx` — entry with keyboard listener.
- `frontend/src/App.jsx` — slide container.

## Rules

1. **One slide per component.** Each slide lives in `frontend/src/slides/{name}.jsx`.
2. **Slide types:**
   - title — large h1 + subline
   - content — h2 + bullet/body
   - two-column — h2 + two columns of content
   - image-focus — image-dominant slide
3. **Type sizes:** use `--text-3xl` for slide h1, `--text-2xl` for h2, `--text-lg` or `--text-xl` for body (decks read at a distance).
4. **Dark by default.** Background `var(--color-text, …)`, text `var(--color-bg, …)` — the contrast inversion is intentional and inherits the brand neutral pair.
5. **Keyboard navigation** — ← previous, → next, F fullscreen. Page numbers in the lower-right.
6. **Sparse content.** Maximum 7 bullets per slide.
7. **No app-data calls.** Slides are static content.
8. **No auth.** Decks are typically presented or shared via URL.
