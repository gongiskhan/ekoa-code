---
name: zoho-sign
description: Zoho Sign e-signature — send documents for signature, track request status, mint embedded signing links, list and recall requests. Use for "send for signature", "e-sign", "digital signature", "Zoho Sign".
---

# Zoho Sign

Electronic signatures via the Zoho Sign REST API (v1). Authenticated with OAuth
2.0 — every call sends `Authorization: Zoho-oauthtoken <access_token>` (NOT
`Bearer`). Access tokens live 1 hour; the platform refreshes them automatically
from a permanent refresh token (`cortex/src/services/zoho-sign.ts`).

## Connecting (credentials)

Zoho has no long-lived API key. Two ways to connect, entered once on the
Integrations page:

**A. Self Client (recommended, no env config needed):**

- **Client ID** / **Client Secret** (`client_id` / `client_secret`) — from a
  *Self Client* created at <https://api-console.zoho.com> (EU: api-console.zoho.eu).
- **Grant Code** (`grant_code`, one-time) — from the Self Client's *Generate
  Code* tab with scopes `ZohoSign.documents.ALL,ZohoSign.account.READ`. It
  expires within minutes: save the card and run **test_connection** right away;
  the first use exchanges it for a permanent refresh token which is stored in
  the same encrypted bundle (the grant code is cleared). (Alternatively paste a
  `refresh_token` you exchanged yourself and leave the grant code empty.)
- **Data Center** (`dc`) — `com` (US), `eu`, `in`, `jp`, `au`, `ca` or `sa`.
  Read it off your Zoho Sign URL: `sign.zoho.com` → `com`, `sign.zoho.eu` → `eu`.

Hosts derive from `dc`: API `https://sign.zoho.<dc>`, accounts/token
`https://accounts.zoho.<dc>`.

**B. Connect with OAuth (browser popup) — PREFERRED:** the "Connect via OAuth"
button on the integration card. Requires `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET`
in `cortex/.env` — a *Server-based Applications* client at api-console.zoho.eu
(match your account's data center) with redirect URI
`<base>/api/v1/oauth/zoho/callback`, where `<base>` is
`ZOHO_OAUTH_REDIRECT_BASE_URL` if set (Zoho accepts `http://localhost:<port>`,
so local dev needs no tunnel) else `EKOA_OAUTH_REDIRECT_BASE_URL`. Optional
`ZOHO_OAUTH_DC` (default `eu`) picks where the authorize page opens; the
callback's `location` param pins the account's real DC. The stored bundle holds
only `{ refresh_token, dc }` — refreshes fall back to the env client creds, so
rotating `ZOHO_CLIENT_SECRET` never orphans a connection. Reconnecting always
re-issues a fresh refresh token (`prompt=consent` + `access_type=offline`).

## Actions (this integration)

These run through the generic integration executor (read/track/recall only — no
file upload). The platform injects `{{api_base}}` and a fresh `{{access_token}}`
just-in-time from the stored credentials, so the templates never see the raw
secrets:

- **test_connection** — verify credentials by listing requests (also performs
  the one-time grant-code exchange right after connecting).
- **list_requests** — signature requests visible to the connected user.
- **get_request** `{ request_id }` — metadata + status. `request_status`:
  `draft`, `inprogress`, `completed`, `declined`, `recalled`, `expired`;
  per-recipient `actions[].action_status`: `NOACTION`, `UNOPENED`, `VIEWED`,
  `SIGNED`.
- **recall_request** `{ request_id }` — recall (cancel) an in-progress request.

## Sending documents (platform proxy — served apps)

Creating and sending a signature request needs a `multipart/form-data` upload
plus Zoho's two-step create→submit flow, which the generic executor cannot
express. Served apps use the platform proxy instead (routes in
`cortex/src/server.ts`, service in `cortex/src/services/zoho-sign.ts`), called
with `window.__ekoa.fetch` (the injected `X-Ekoa-App-Id` header authorizes the
app; credentials never reach the page):

- `GET /api/zoho-sign/status` → `{ connected: boolean }`
- `POST /api/zoho-sign/send` →
  `{ documentName, fileName?, html | pdfBase64, recipients: [{ email, name?, role?, order?, embedded? }], message?, redirectUrl?, externalRef?: { propostaId, clientEmail } }`
  → `{ success, requestId, status, signingUrls: [] }`. The proxy renders HTML to
  PDF server-side (Zoho does not accept HTML) and auto-places one Signature
  field per signer on the LAST page (Zoho refuses to send a signer with no
  fields).
- `GET /api/zoho-sign/requests/:id` → `{ request }` — raw Zoho request object.
- `GET /api/zoho-sign/requests/:id/sign-url?email=...` → `{ signUrl }` — a fresh
  **one-time embedded signing URL, valid ~2 minutes**; mint it at click time,
  never store it. Only for recipients sent with `embedded: true` (Zoho does NOT
  email embedded recipients — the app is responsible for getting them to the
  link); others get Zoho's own email and `signUrl` is `null`.
- `GET /api/zoho-sign/requests/:id/document` → the (partially) signed PDF.

**Webhook:** `POST /api/zoho-sign/webhook` receives Zoho Sign webhook events
(register the URL in Zoho Sign → Settings → Developer → Webhooks) and advances
the owning ERP proposal server-side after an owner-scoped re-fetch confirms the
client signed. The payload itself is never trusted for signature state.

The proxy routes and webhook are delivered by a later slice; the generic actions
above are live now.

## Limits worth knowing

- 50 API calls/minute on most endpoints (account-wide — keep polls modest).
- Max 25 recipients per request (the proxy caps at 10), 25 MB per document
  (proxy caps at 10 MB), 40 documents / 40 MB per request envelope.
- Embedded sign URLs are one-time and expire in ~2 minutes.
- Zoho does NOT rotate refresh tokens on refresh — the stored one is permanent
  until revoked.
