---
name: landing-craft
description: How to compose a high-quality single-page marketing site on the landing base
---

# Landing Craft

The landing base is optimised for marketing and conversion. Your output must look professional at first glance.

## Visual styling - runtime tokens only

The platform serves `GET /api/design-tokens.css` and every app's `index.html` already links to it. Use the variable contract documented in `api/assets/bases/CSS_VARS_CONTRACT.md`. Every CSS value must reference a variable with a fallback. Never inline a hex literal.

```css
.hero { background: var(--color-bg, #FFFFFF); }
.hero h1 {
  color: var(--color-text, #0F172A);
  font-family: var(--font-display, system-ui, sans-serif);
  font-size: clamp(var(--text-4xl, 2.25rem), 1.35rem + 3vw, var(--text-6xl, 3.75rem));
  line-height: 1.05;
  letter-spacing: -0.02em;
}
.cta { background: var(--color-primary, #0F766E); color: var(--color-on-primary, #FFFFFF); }
```

When the company branding changes, the link picks up new colours on next reload - no rebuild.

## Section vocabulary

- **Hero** - main proposition. Headline (h1), subhead, primary CTA, optional secondary CTA, optional hero image.
- **Trust strip** - social proof: customer logos, ratings, press mentions.
- **Features / Benefits** - 3-6 value props. Give them structure, not three identical cards (see the visual rules below).
- **How it works** - numbered or stepped explanation.
- **Pricing** (optional) - clear tiers, primary tier highlighted.
- **Testimonials** - quotes with names + photos/companies.
- **FAQ** (optional) - 4–8 collapsible items.
- **Final CTA** - repeat the primary action call.
- **Footer** - copyright, minimal links.

## Visual rules

- Hero copy ≤ 12 words for the headline, ≤ 30 words for the subhead.
- One primary colour, used for the main CTA and accents. Variable: `--color-primary`.
- Type scale: the hero h1 is display type - `--text-5xl`, fluid up to `--text-6xl` on wide screens (the shipped `index.css` already sets this with a `clamp()`); `--text-3xl` for section h2; `--text-base` for body. Headings go through `var(--font-display, …)`, with leading 1.05-1.2 and tracking -0.01em..-0.025em at those sizes. A 30px hero reads as a document heading, not a landing page.
- Padding between sections: `var(--space-24)` on desktop, `var(--space-16)` on mobile. Sections with anchors need `scroll-margin-top` so the sticky header never covers the heading (shipped).
- Mobile: single column. Tablet (md): two-column features. Desktop (lg+): up to three.
- CTA labels on a primary fill use `var(--color-on-primary, #FFFFFF)`, never `--color-bg`.
- Do not ship a features section as three identical icon-plus-heading-plus-text cards - that clone grid is the single clearest tell of a templated page. The shipped scaffold shows the alternative: one lead feature carrying weight, supporting rows on keylines.

## SEO

- Set `<title>` and `<meta name="description">` from the user's brand.
- Use one `<h1>` per page (the hero headline).
- Image `alt` attributes always populated.

## What NOT to do

- No login/signup form (landing pages don't auth).
- No app-data API calls. If a form submission is needed, route through `callIntegration('email', 'send', ...)` to email the lead.
- No multi-page ROUTING - no router, no separate URLs per section. That is the only thing "one page" restricts: within that one page, build the FULL site depth the section vocabulary above calls for (hero through footer), tied together with in-page anchor nav. A thin one-screen stub is under-delivering, not "keeping it simple."
- No CMS-style dynamic content. The page is static.
- No hex literals; no Tailwind utility colours; no per-app `:root` overrides.
