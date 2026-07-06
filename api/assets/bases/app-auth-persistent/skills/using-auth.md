---
name: using-auth
description: How to use the Ekoa authentication primitives in an app-auth-persistent build
---

# Using Auth

This base provides authenticated sessions out of the box. You do not need to invent any login UI.

## What you get

- A logged-in session is guaranteed by the time `App.jsx` mounts. The user reaches the app via Ekoa's authenticated routes; if no session exists they are bounced to `/login` upstream.
- `window.__EKOA_TOKEN` — the user's JWT, available globally. Use it for backend calls if you ever need raw fetch.
- `window.__EKOA_APP_ID` — this app's id; you rarely need it directly.
- `window.__ekoa.fetch()` — the wrapper that auto-attaches the token. **Always prefer this over raw `fetch`.**

## What to NOT do

- Do not write a login form. The user is already logged in.
- Do not store tokens in `localStorage`. The injection model handles this.
- Do not introduce a different auth library. Use what is here.

## Reading the user identity

If your app needs to display the user name or scope data per-user, call `window.__ekoa.fetch('/api/v1/action', { method: 'POST', body: JSON.stringify({ app: 'ekoa.auth', intent: 'me' }) })` once on mount and cache the result in component state. Never store identity in app-data.

## Logout

The platform header offers a logout affordance; your app does not need its own. If a request returns 401 the wrapper triggers a re-auth flow automatically; assume the token is fresh.
