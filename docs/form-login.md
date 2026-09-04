# Server-side form login — a reusable integration capability

`api/src/integrations/form-login.ts` logs an integration in to a portal that authenticates with a
plain **username/password HTML form**, entirely server-side, and hands back a session cookie jar
(and, optionally, the HTML of a target page fetched with that session). It is **generic**: nothing
in it is specific to any one integration — the whole login is driven by a reviewed descriptor.

CITIUS/eTribunal (the Habilus `login.aspx` username/password screen) is the first intended consumer,
but the same descriptor shape fits any form-login portal, which is why it lives in `integrations/`
as a shared capability rather than in a vertical.

## When to use it (and when not)

Use it for a portal that accepts a **username + password form POST** and keeps you in with a session
cookie. It logs in and reads in one fast HTTP sequence with no human and no browser, which is exactly
what an **unattended poller** needs — the attended browser/typist rail (`ensureSession`) needs a human
at a paired machine and yields a session many portals expire in minutes.

Do **not** use it for:
- **Certificate / Chave Móvel Digital / Cartão de Cidadão / OTP / federated (OAuth) logins.** Those
  are interactive by design; they still need the attended browser path (`authProfile.attended`).
- **A portal behind a WAF that blocks datacentre IPs.** This path egresses from the platform's own IP
  (there is no residential-proxy egress on the HTTP path — that lives only on the bridge/browser rail).
  A 403 comes back as `status: 'blocked'` so the caller can fall back to the browser route.

## What it does

```
GET  loginUrl            → read the hidden/anti-forgery fields (ASP.NET __VIEWSTATE/__EVENTVALIDATION,
                           or any framework's <input type=hidden>) + the form's POST target; absorb any
                           WAF cookie set here into the jar
POST credentials         → every hidden field echoed verbatim + usernameField + passwordField + an
                           optional submit button; the session Set-Cookie the portal sets ON the 302 is
                           captured (a plain guarded fetch throws on the redirect and loses it — see below)
(follow the redirect chain, carrying the jar, re-checking the origin binding on every hop)
GET  targetUrl           → optional; with the session cookie, so the caller gets authenticated HTML
```

The result is a typed `FormLoginResult`: `authenticated` (with `targetHtml` when a `targetUrl` was
given), `authenticated-no-target` (logged in, but the session did not cover the target page —
e.g. a sub-app that needs a further auth step), `auth-failed`, `blocked`, or `error`. It never throws
for an expected outcome; only a **caller config error** (an empty or unbound `allowedOrigins`) throws,
the same `CredentialOriginError` `credentialedFetch` throws.

## Descriptor (reviewed package data — never model-authored)

```ts
interface FormLoginDescriptor {
  loginUrl: string;              // the login page to GET (and POST to, unless the page declares a <form action>)
  usernameField: string;         // the form field NAME, e.g. 'ctl00$cph$txtUserName'
  passwordField: string;         // the form field NAME, e.g. 'ctl00$cph$txtUserPass'
  submitField?: string;          // optional submit control name; an ASP.NET image button sends <name>.x/.y
  submitKind?: 'image' | 'button';
  successUrlContains?: string;   // login OK when the final post-login URL contains this
  failureBodyContains?: string;  // login failed when the post response body contains this
  targetUrl?: string;            // optional page to fetch after login
  targetLoginRedirectContains?: string; // marks a target that bounced to login (session did not cover it)
  maxRedirects?: number;         // default 5
  userAgent?: string;            // override the request UA
}
```

The field **names** (not ids) are what a WebForms POST needs. A browser re-submits every hidden input
verbatim, so the runner echoes **all** `<input type=hidden>` fields it parsed from the login page
(`__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION`, …) — dropping them is how a WebForms POST
gets rejected.

## Security posture (asserted by the suite)

- **The password never reaches a model, prompt, URL, or log.** Every outward string (reasons, errors)
  is put through a run-scoped `SecretRegistry` (`security/redaction.ts`) seeded with the username and
  password; the credentials travel only in the POST body. The suite pins that no returned field
  contains the password.
- **Origin binding first, always.** `assertOriginAllowed` runs before any byte or cookie is sent, on
  every request including every redirect hop, regardless of the transport — a credential/cookie can
  only travel to a host the credential is bound to (from the Cofre item's `boundOrigins`). In
  production the transport is `guardedFetchManual`, which also runs the SSRF guard.
- **At most once.** A rejected password is a consumed attempt against portals with unknown lock-out
  policies, so there is **no retry loop**, and classification is conservative (a 200 re-render of the
  login form, or a declared failure marker, is `auth-failed`).
- **The cookie jar is credential-safe** (`services/cookie-jar.ts`): host- and path-scoped, a `Domain=`
  honoured only when the setting host is within it (no forged wider domain), `Secure` cookies withheld
  from `http://`. It carries no public-suffix list of its own — it is always paired with the origin
  binding, which constrains the hosts it is ever driven against.

## The building blocks (reusable on their own)

| Piece | File | What it adds |
|---|---|---|
| `guardedFetchManual` | `services/url-fetcher.ts` | SSRF-guarded fetch with `redirect:'manual'`, so a caller can read `Set-Cookie`/`Location` off a 302. The existing `guardedFetch` (`redirect:'error'`) throws on any 3xx and `guardedFetchFollow` never surfaces intermediate `Set-Cookie`; a form login needs the session cookie the portal sets on the post-login redirect. |
| `credentialedFetchManual` | `security/origin-binding.ts` | the same, behind the required origin binding. |
| `CookieJar` | `services/cookie-jar.ts` | a small, conservative, origin-scoped HTTP cookie jar for multi-step server-side flows. |
| `parseHiddenInputs` / `parseFormAction` / `looksLikeLoginForm` | `services/portal-forms.ts` | pure login-page HTML helpers (hidden fields, form target, login-page detection). |

## How another integration adopts it

1. Declare `username` and `password` as `secret: true` fields in the package `config.json`
   `configSchema` — `createConfig`/`updateConfig` encrypt them under the org-bound envelope
   automatically, and a `secret` field is excluded from `publicConfigValues` (so it never reaches the
   `{{config.*}}` template channel).
2. Declare a `formLogin` descriptor (the shape above) as reviewed package data.
3. The action's server-side handler decrypts the credentials (`loadIntegrationCredentialFields` /
   the action rail's `decryptCredentialFields`), builds a `SecretRegistry`, derives `allowedOrigins`
   from the Cofre item's `boundOrigins`, and calls `performFormLogin(descriptor, {username, password},
   { allowedOrigins, secrets, credentialLabel })`. The returned `targetHtml` (or the cookie jar, fed
   to a downstream reader) is what the action parses.

## Status

**Built, wired, and tested (per-PR vitest lane).** All green with no regressions across the
integrations suite:

- The runner + its four building blocks, proven end to end against the in-process mock ASP.NET
  WebForms portal (`api/tests/integrations/form-login.test.ts`,
  `api/tests/helpers/mock-citius-webforms-server.mjs`) — GET login, echo hidden state, POST
  credentials, capture the session cookie off the 302, read the authenticated inbox, password proven
  not to leak, one-shot auth.
- The **`form-login` backing** is wired: `IntegrationActionBackingType` + a `resolveBackingType`
  branch (`integrations/definitions.ts`, with the same contradiction rules as the other backings),
  and an executor dispatch in `action-executor.ts` that runs AFTER the credential decrypt and returns
  the fetched page. The manual transport is an optional `ExecutorDeps.formLoginManualFetch` seam
  (defaults to `guardedFetchManual`, so production needs **no `server.ts` change**); tests inject a
  loopback transport. Covered by `tests/integrations/action-backing-type.test.ts` (the resolve cases)
  and `tests/integrations/form-login-executor.test.ts` (the full dispatch against the mock).
- **CITIUS** is configured as the first consumer (`api/assets/integrations/citius/config.json`):
  `login_username`/`login_password` secret fields and a `ler_notificacoes_http` `form-login` action
  pointed at `.../habilus/myhabilus/login.aspx` with `targetUrl`
  `.../NotificacoesCitacoes/NotCitIndex.aspx`.

## Live-confirmed against real CITIUS (2026-09-04)

Running `ler_notificacoes_http` with the owner's stored `login_username`/`login_password` logged in
over HTTP, landed on `Entrada.aspx`, fetched `NotCitIndex.aspx` (200), and **parsed the real
notifications** into structured rows — in ~0.5s, read-only, no browser, no model, no session-expiry
gap. It answered the open question: **a fresh HTTP form-login session DOES authenticate
`NotCitIndex.aspx` in one shot**, unlike the browser-captured session that had expired. Two field-name
facts the mock had guessed wrong were corrected from the live form: the CITIUS login fields are the
BARE `txtUserName`/`txtUserPass`/`ImBtnLogin` (not `ctl00$cph$…`), and the notifications grid is an
ASP.NET **DataGrid** `…_dgNotificacoes` whose per-row cells carry named control ids.

- **Parser — done.** `parseAspNetGridRows(html, gridIdContains, fields)` (`services/portal-forms.ts`)
  extracts an ASP.NET DataGrid/GridView by the stable `_ctlNN_<FieldSuffix>` cell-id pattern. Declared
  per action as `formLogin.resultParse` (a `gridIdContains` + `fields` map); when present the executor
  returns `rows` instead of a raw HTML preview. CITIUS maps
  `{ ato: NomeActo, data: DataElaboracao, tribunal: NomeTribunal, unidade: DescricaoUnidadeOrganica,
  especie: DescricaoEspecie, origem: lblOrigem, documento: lnkDoc }`.

## The 8-hour poller

The CITIUS package declares `ler_notificacoes_http` as a polled listener source
(`citius/config.json` `listenerConfig`): `intervalMs: 28_800_000` (8h), `eventArrayField: 'rows'`,
`dedupKeyField: 'id'` (the notification's own `IdDoc`), `cursorField: 'cursor'` (a signature of the
current id set, so the listener can arm). The listener rail is generic: `pollUserDefinedSource` runs
the action, reads the rows, dedups each by `id` against the queue's `UNIQUE(triggerId, dedupKey)`, and
delivers each new one to the artifact backend. Because the parser now yields `processo`, `ato`, `data`
and `id`, the notifications carry the process number — the `resultParse` maps the named DataGrid cells
plus the plain "Processo" cell (`columns: { processo: 7 }`).

The delivery target already exists: `legal-citius`'s backend `onNotificacaoCitius(input, ekoa)` reads
exactly `event.processo / ato / data / id`, runs the deterministic prazo engine, and writes the
needs-review inbox row + the bell. It was written for this listener.

**To arm it (operator/runtime step):** a `legal-citius` app must be registered, then create the
listener trigger:

```
POST /api/v1/triggers
{ "integrationKey": "citius", "eventName": "notificacao.recebida",
  "target": { "kind": "artifact-backend", "artifactId": "<legal-citius app id>", "entrypoint": "onNotificacaoCitius" } }
```

The supervisor then polls every 8h (override per-trigger with `pollIntervalMs`). Note the rail's
NO-BACKFILL rule: the establishing poll adopts the cursor and delivers nothing, so the artifact should
show the CURRENT list via a direct `ler_notificacoes_http` call on open, and the poller alerts on new
notifications from then on.

## Remaining

- **Register a `legal-citius` app + create the trigger** (the operator step above) to run the poller live.
- **Chat.** Surface the notifications (and a documents-by-process action) in the chat flow.
- **Duplicate config rows.** The UI credential save can create a second `integration_configs` row for
  the same owner; `findConfigForOwner` then picks nondeterministically and the executor can read the
  row without the credentials. Needs an upsert-on-save fix.
- **Governance.** The module map diagram (`docs/diagrams/`) is owed an update for the new capability +
  backing (FIXED-12).
