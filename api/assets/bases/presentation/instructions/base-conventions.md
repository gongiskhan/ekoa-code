---
name: base-conventions
description: Conventions for presentation base - slide deck format
---

# Base Conventions - presentation

This base produces a **slide deck**. Each route/segment is a slide. Keyboard navigation (←/→) is mandatory.

## Visual styling - runtime tokens only

Every app's `index.html` links to `/api/design-tokens.css`. Use the variable contract in `api/assets/bases/CSS_VARS_CONTRACT.md`. The same vocabulary applies to decks - compose the variables, never invent new ones, and never invert them to force a look the brand didn't ask for.

```css
body { background: var(--color-bg, #FFFFFF); color: var(--color-text, #0F172A); }
.slide h1 { font-size: var(--text-5xl, 3rem); }
.cta { background: var(--color-primary, #0F766E); color: var(--color-on-primary, #FFFFFF); }
```

Every value must reference a variable with a fallback. No hex literals; no `:root` overrides.

## What's already done

- `frontend/src/index.jsx` - entry point.
- `frontend/src/App.jsx` - slide container: keyboard nav, fullscreen, page numbers. Do not rebuild it; add slides instead (see Rules).
- `frontend/src/slides/index.js` - the slide registry (**edit this**: import and list your slide components here, in presentation order) plus one example slide (`Title.jsx`) to replace.

## Rules

1. **One slide per component.** Each slide lives in `frontend/src/slides/{name}.jsx`; register it in `frontend/src/slides/index.js`.
2. **Slide types** (shell classes already styled in `index.css`; compose as `className="slide slide-content"`):
   - `.slide-title` - display h1 + subline, optional `.slide-title-meta` row (orador, equipa, data)
   - `.slide-section` - section divider: oversized display type + one supporting line
   - `.slide-content` - h2 + bullets with authored markers (primary dash on `ul`, counter on `ol`)
   - `.slide-two-col` - two-column grid, h2 spanning both; add `.lead-left` / `.lead-right` for an asymmetric split
   - `.slide-statement` - one big centered claim; `<strong>` lifts a phrase in the brand colour
   - `.slide-figure` - image-dominant: one dominant `<figure>` + short `<figcaption>` (baseline `img`/`figcaption` treatment ships in `index.css`, so images never overflow the stage)
   - `.slide-closing` - final slide: thank-you line + contact or next step
3. **Type sizes:** the shell already sets projection scale - `--text-5xl` for slide h1, `--text-4xl` for h2, `--text-xl`/`--text-2xl` for body and bullets (decks read at a distance), with tight display leading and slight negative tracking. Don't shrink headings back to document sizes.
4. **Light and professional by default.** Background `var(--color-bg, …)`, text `var(--color-text, …)` - the same direction as every other base. A dark deck is a deliberate choice for a brand that calls for it, never the reach-for-nothing default (post-incident house style, `api/src/agents/build.ts` BUILD_SYSTEM_PROMPT). If the org's own brand tokens resolve dark, the deck follows them - that's the tokens doing their job, not a forced inversion.
5. **Keyboard navigation** - ← previous, → next (plus space / PageUp / PageDown), F fullscreen. Numeric readout in the lower-right; thin progress bar on the bottom edge. Both come from the shell.
6. **Sparse content.** Maximum 7 bullets per slide.
7. **No app-data calls.** Slides are static content.
8. **No auth.** Decks are typically presented or shared via URL.
9. **Motion earns its place here.** `import { motion, AnimatePresence } from 'motion/react'` is available (verified against this platform's esbuild pipeline, `api/package.json`) - a slide transition or a staggered bullet reveal is the kind of high-impact, low-noise motion this base wants; keep it purposeful, not decorative.
