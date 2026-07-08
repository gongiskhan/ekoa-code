# J5 per-org branding overlay resolution (director-verified, live)

Boot B, credentialed. Closes the branding-resolution half that worker-b-build did not reach.

- Neutral default (no `?app`): `GET /api/design-tokens.css` -> `--color-primary: #0F766E` (the platform
  teal - no org brand leaked).
- `PUT /api/v1/org/branding {branding:{primaryColor:'#AB2244'}}` as admin (Founder org) -> 200, branding
  persisted.
- Per-app resolution: `GET /api/design-tokens.css?app=agency-portfolio` (a Founder-owned featured app)
  -> `--color-primary: #AB2244`. The org brand overlays correctly, resolved server-side from the app
  slug.

Verdict: per-org branding overlay + neutral-default fallback both work as designed. Combined with the
Boot-A neutral-default check and the J5 knowledge/memory cross-org 404s, J5 org isolation is PASS end
to end. (Note: an org with no brand research resolves to the neutral default, which is the correct
"no research ran" behavior.)
