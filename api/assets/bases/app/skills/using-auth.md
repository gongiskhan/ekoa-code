---
name: using-auth
description: How to use the Ekoa end-user SSO identity primitives shipped by the app base
---

# Using Auth

This base ships identity wiring at `frontend/src/lib/auth.ts` (over the injected
runtime's end-user SSO). You do not build a login form.

## What you get

- `getCurrentUser()` -> `{ email, name, oid, tid, canSendMail } | null`. The signed-in visitor, or `null` when logged out OR the runtime is absent (standalone preview, file://). Cached, best-effort, and NON-THROWING - the shell renders fully for an anonymous visitor. The shipped shell already calls it for the top bar.
- `signIn(returnPath?)` - starts the full-page Microsoft sign-in. Call it from an explicit "Entrar" affordance when your app needs a known visitor.
- `signOut()` - ends the visitor session.
- `getAppId()` -> this app's id, or `null` outside a served-app document.

## Authorize by `oid` (+ `tid`), never by `email`

`email` is mutable and display-only. Any per-visitor authorization or data scoping must key on the immutable `oid` (with `tid` for the tenant). Never trust `email` as an identity key.

## Anonymous by default

An app is reachable without a session. Gate only what genuinely needs a known visitor, and render a clean anonymous state (or an "Entrar" button that calls `signIn()`) otherwise. Do not assume a visitor is present.

## The reliable SSO context is the standalone URL

Sign-in depends on the per-app cookie, which the dashboard iframe cannot always set (third-party cookie limits). The trustworthy SSO context is the standalone `/apps/{slug}/` URL - test login there, not inside the embedded preview.

## Password sign-in (platform-managed alternative to Microsoft SSO)

When the app needs its own username/password login instead of (or beside) Microsoft SSO, the
platform provides the flow - never build your own:
- `window.__ekoa.passwordSignIn(identity, password)` - sign in against the app's own user rows.
- `window.__ekoa.setUserPassword(...)` - set/change a password (self-service; a privileged caller
  may set others', gated by the platform).
`whoami()`/`getCurrentUser()`/`signOut()` work identically afterwards. Still authorize by `oid`
(+ `tid`), never `email`.

## What NOT to do

- Do not write a login form or introduce another auth library. Use `signIn()` / `passwordSignIn()`.
- Do not store identity or tokens in `localStorage`/`sessionStorage`.
- Do not persist per-visitor identity into app-data; app-data is shared by all visitors of `/apps/{id}/`. Read identity live from `getCurrentUser()`.
- Do not confuse the visitor identity (SSO) with the workspace account behind integrations - they are different principals.
