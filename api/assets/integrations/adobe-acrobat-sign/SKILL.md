---
name: adobe-acrobat-sign
description: Adobe Acrobat Sign e-signature — send documents for signature, track agreement status, fetch signing links, list and cancel agreements. Use for "send for signature", "e-sign", "digital signature", "Adobe Sign".
---

# Adobe Acrobat Sign

Electronic signatures via the Adobe Acrobat Sign REST API (v6). Authenticated with
an **Integration Key** used as a Bearer token (no OAuth dance required).

## Connecting (credentials)

Two fields, entered once on the Integrations page:

- **Integration Key** (`integration_key`, secret) — the Bearer token.
- **API Access Point** (`api_access_point`) — your account's regional API base,
  e.g. `https://api.na4.adobesign.com`. Read the shard from your Acrobat Sign URL
  after login (`secure.na4.adobesign.com` → `api.na4.adobesign.com`). If unsure,
  connect with any region and run **test_connection** — it returns the correct
  `apiAccessPoint`.

### How to create the Integration Key

Verified against Adobe's help docs (helpx.adobe.com/sign/developer/integration-key.html,
last updated 2026-03) as of July 2026:

1. **Requires an Enterprise Acrobat Sign account.** Free, Individual, and
   Business plans do not expose the Integration Key link. If you don't already
   have Enterprise access, start the free 30-day trial at
   <https://www.adobe.com/acrobat/business/sign.html> — it unlocks the full
   enterprise feature set, including API access. If you already have a paid
   account but the link is missing, contact Acrobat Sign support to request
   access.
2. Log in at <https://secure.adobesign.com>.
3. Go to **Account → Acrobat Sign API → API Information**, then click the
   **Integration Key** link.
4. Name the key (e.g. "Ekoa") and select the scopes `agreement_read` and
   `agreement_write`. Do **not** select `agreement_send` — it's deprecated and
   not accepted on API v6, which this integration uses.
5. Save and copy the key — it is shown once, valid up to 10 years, and its name
   and scopes can't be edited afterwards.

Adobe now recommends OAuth over Integration Keys for new integrations (see
"Integration keys vs OAuth" on the same help page), though Integration Keys
remain supported for server-to-server workflows like this one.

## Actions (this integration)

These run through the generic integration executor (read/track/cancel only — no
file upload):

- **test_connection** — verify the key and discover `apiAccessPoint`.
- **list_agreements** — agreements visible to the key's user.
- **get_agreement** `{ agreement_id }` — metadata + status (`OUT_FOR_SIGNATURE`,
  `SIGNED`, `CANCELLED`, …).
- **get_signing_urls** `{ agreement_id }` — current signer's hosted signing
  URL(s). Empty/404 while still processing or for email-only delivery.
- **get_agreement_documents** `{ agreement_id }` — document ids of the agreement.
- **cancel_agreement** `{ agreement_id, comment? }` — cancel an in-process
  agreement.

## Sending a document for signature (served apps)

Acrobat Sign requires a real document (PDF/DOC/DOCX — **not HTML**) uploaded as a
multipart *transient document* before an agreement can be created. The generic
executor can't do multipart, so served artifacts send documents through the
platform proxy instead:

```
POST /api/adobe-sign/send        (via window.__ekoa.fetch — adds X-Ekoa-App-Id)
{
  "documentName": "Proposta PROP-0042 — Brasil Salomão",
  "fileName": "proposta-PROP-0042.pdf",
  "html": "<!doctype html>…",          // rendered to PDF server-side, OR:
  "pdfBase64": "JVBERi0…",             // raw PDF bytes
  "recipients": [ { "email": "client@example.com", "name": "Cliente" } ],
  "message": "Por favor reveja e assine.",
  "redirectUrl": "https://…"            // optional post-sign redirect
}
→ { "success": true, "agreementId": "CBJCH…", "status": "OUT_FOR_SIGNATURE",
    "signingUrls": [ { "email": "…", "esignUrl": "https://secure.…/apiesign?pid=…" } ] }
```

Other proxy reads (same `X-Ekoa-App-Id` scoping):

- `GET /api/adobe-sign/status` → `{ connected: boolean }`
- `GET /api/adobe-sign/agreements/:id` → agreement status
- `GET /api/adobe-sign/agreements/:id/signing-urls` → signing URLs
- `GET /api/adobe-sign/agreements/:id/document` → the signed combined PDF (binary)

The proxy loads + decrypts the workspace's connected Adobe credentials; the page
never sees the integration key. Recipients are also emailed a signing link by
Acrobat Sign, so signing works even when `signingUrls` is empty.
