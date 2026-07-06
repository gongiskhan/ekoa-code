---
name: base-conventions
description: Conventions for landing base — single-page marketing/promo
---

# Base Conventions — landing

This base produces a **single-page marketing/promo** site. SEO and performance matter. Persistence is NOT wired (a landing page doesn't store user data); auth is NOT wired (a landing page is public).

## What's already done

- `frontend/src/index.jsx` — entry point.
- `frontend/src/App.jsx` — single-page shell with sections.
- `frontend/src/tokens.json` — resolved design tokens (more expressive than the auth base).
- `manifest.json` — declares `extends: "landing"`.

## Rules

1. **Single page.** Sections flow vertically: hero → features → social proof → CTA → footer.
2. **Semantic HTML.** Use `<header>`, `<section>`, `<main>`, `<footer>`. Each section gets a heading.
3. **Performance first.** Inline critical CSS, lazy-load images, avoid heavy client-side state.
4. **No login form.** Landing pages don't authenticate.
5. **No app-data calls.** Landing pages don't persist user data (use a form-submission integration if needed).
6. **CTAs prominent.** Primary CTA in hero AND in a final section.
7. **Mobile first.** Single column on mobile, multi-column at md+ breakpoints.
8. **Apply tokens.** Read `tokens.json`, expose as CSS variables, never inline hex colours.

## Required regions

- Hero with H1, subhead, and primary CTA.
- At least one features/benefits section.
- A footer with copyright + minimal links.
