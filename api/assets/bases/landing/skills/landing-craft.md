---
name: landing-craft
description: How to compose a high-quality single-page marketing site on the landing base
---

# Landing Craft

The landing base is optimised for marketing and conversion. Your output must look professional at first glance.

## Visual styling — runtime tokens only

The platform serves `GET /api/design-tokens.css` and every app's `index.html` already links to it. Use the variable contract documented in `ekoa-data/bases/CSS_VARS_CONTRACT.md`. Every CSS value must reference a variable with a fallback. Never inline a hex literal.

```css
.hero { background: var(--color-bg, #FFFFFF); }
.hero h1 { color: var(--color-text, #0F172A); font-size: var(--text-3xl, 1.875rem); }
.cta { background: var(--color-primary, #0F766E); color: var(--color-bg, #FFFFFF); }
```

When the company branding changes, the link picks up new colours on next reload — no rebuild.

## Section vocabulary

- **Hero** — main proposition. Headline (h1), subhead, primary CTA, optional secondary CTA, optional hero image.
- **Trust strip** — social proof: customer logos, ratings, press mentions.
- **Features / Benefits** — 3–6 cards highlighting value props.
- **How it works** — numbered or stepped explanation.
- **Pricing** (optional) — clear tiers, primary tier highlighted.
- **Testimonials** — quotes with names + photos/companies.
- **FAQ** (optional) — 4–8 collapsible items.
- **Final CTA** — repeat the primary action call.
- **Footer** — copyright, minimal links.

## Visual rules

- Hero copy ≤ 12 words for the headline, ≤ 30 words for the subhead.
- One primary colour, used for the main CTA and accents. Variable: `--color-primary`.
- Type scale: use `--text-3xl` for hero h1, `--text-2xl` for section h2, `--text-base` for body.
- Padding between sections: `var(--space-16)` minimum on desktop, `var(--space-12)` on mobile.
- Mobile: single column. Tablet (md): two-column features. Desktop (lg+): up to three.

## SEO

- Set `<title>` and `<meta name="description">` from the user's brand.
- Use one `<h1>` per page (the hero headline).
- Image `alt` attributes always populated.

## What NOT to do

- No login/signup form (landing pages don't auth).
- No app-data API calls. If a form submission is needed, route through `callIntegration('email', 'send', ...)` to email the lead.
- No multi-page routing. This is one page.
- No CMS-style dynamic content. The page is static.
- No hex literals; no Tailwind utility colours; no per-app `:root` overrides.
