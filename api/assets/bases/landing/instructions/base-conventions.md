---
name: base-conventions
description: Conventions for landing base - single-page marketing/promo
---

# Base Conventions - landing

This base is the target for ANY "site"/"website"/"página web" request (WS6 incident fix - a
website is never a slide deck; see the `presentation` base for that). It produces a rich,
**single-page** marketing/institutional site: not a bare hero-plus-footer, a full site's worth of
content flowing down one scrollable page. SEO and performance matter. Persistence is NOT wired (a
landing page doesn't store user data); auth is NOT wired (a landing page is public).

## What's already done

- `frontend/src/index.jsx` - entry point.
- `frontend/src/App.jsx` - a full section skeleton (header nav, hero, trust strip, features, how
  it works, pricing, testimonials, FAQ, final CTA, footer) with clearly-marked PLACEHOLDER copy -
  **replace every placeholder; delete any section the brief genuinely doesn't need.** This is a
  starting point, not a finished page.
- `frontend/src/index.css` - the landing design system for that skeleton, written entirely on the
  locked token contract (`var(--token, fallback)`, no hex literals): browser surfaces (selection,
  focus ring, scrollbar), buttons, the translucent sticky header and its mobile sheet, the hero
  display scale and its brand-tinted field, the feature ledger, the numbered step path, the
  pull-quote, the animated FAQ rows, the tinted final-CTA band, the footer, plus hover/active/
  focus-visible states and the reduced-motion guards. **Extend it - do not replace it**; add rules
  for the sections the brief needs and keep every value going through the token contract.
- `manifest.json` - declares `extends: "landing"`.
- There is no `tokens.json` in the project - design tokens are served at RUNTIME by
  `/api/design-tokens.css` (already linked in `index.html`); never read a static tokens file.

## Rules

1. **One page, many sections - not one page, few sections.** This is still a SINGLE page (rule 8
   below: no client-side routing), but "single page" describes the navigation model, not the
   content depth. A real marketing site covers the full vocabulary below top to bottom; a
   four-section stub reads as unfinished. In-page anchor nav (`<a href="#features">` + a header
   with the section links) ties it together - never a router.
2. **Section vocabulary** (see `skills/landing-craft.md` for the full brief on each): header/nav,
   hero, trust strip, features/benefits, how it works, pricing (when relevant), testimonials, FAQ,
   final CTA, footer. Not every request needs every section (an internal-tool landing page may
   skip pricing/testimonials) - but default to covering what applies rather than trimming to the
   bare minimum.
3. **Semantic HTML.** Use `<header>`, `<section>`, `<main>`, `<footer>`. Each section gets a
   heading.
4. **Performance first.** Inline critical CSS, lazy-load images, avoid heavy client-side state.
5. **No login form.** Landing pages don't authenticate.
6. **No app-data calls.** Landing pages don't persist user data (use a form-submission integration
   if needed).
7. **CTAs prominent.** Primary CTA in the hero, the header, AND a final section.
8. **No client-side routing.** One page, one URL - navigation between sections is in-page anchor
   scroll (`scroll-behavior: smooth` + `#anchor` links), never a router or separate routes. This
   is the one constraint that doesn't loosen with section count.
9. **Mobile first.** Single column on mobile, multi-column at md+ breakpoints.
10. **Apply tokens.** Use the `var(--color-…)`/`var(--space-…)`/`var(--text-…)` contract from
    `/api/design-tokens.css`, never inline hex colours or Tailwind colour utilities.

## Required regions

- Header with nav links to the page's sections + a CTA.
- Hero with H1, subhead, and primary CTA.
- At least the features/benefits section beyond the hero - most real sites also want trust strip,
  how-it-works, testimonials, and FAQ; include what fits the brief.
- A final CTA section (don't rely on the hero's CTA alone once the visitor has scrolled).
- A footer with copyright + minimal links.
