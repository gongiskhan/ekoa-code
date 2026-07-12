---
name: using-auth
description: How to use the Ekoa identity primitives shipped by the app base
---

# Using Auth

This base ships auth wiring at `frontend/src/lib/auth.ts`. You do not build a login UI.

## What you get

- The app is reached through Ekoa's authenticated routes; a session already exists by the time `App.jsx` mounts.
- `getAppId()` - this app's id (rarely needed directly).
- `getCurrentUser()` - best-effort identity of the dashboard user that opened the app, for personalisation only (greeting, avatar). It is cached and falls back to a synthetic anonymous user in standalone runs, so it never throws. The shell already calls it for the top bar.
- `window.__ekoa.fetch()` - the platform fetch wrapper that attaches the `X-Ekoa-App-Id` header. Prefer it over raw `fetch`. App-data is scoped per-app by that header - there is no auth token for you to manage.

## What NOT to do

- Do not write a login form. The user is already logged in.
- Do not store identity or tokens in `localStorage`/`sessionStorage`.
- Do not introduce a different auth library. Use what is shipped.
- Do not persist per-user identity into app-data; app-data is shared by all visitors of `/apps/{id}/`. Read identity live from `getCurrentUser()` when you need it.
