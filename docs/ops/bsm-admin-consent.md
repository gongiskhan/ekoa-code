# BSM ops — Microsoft tenant admin-consent onboarding

> **CUTOVER-SCOPE.** This is a customer-onboarding cutover brief for the BSM
> (brasilsalomão) Microsoft 365 sign-in, not a per-PR engineering task. It is
> executed once per customer tenant by the operator, outside the normal build
> lane. Code is truth: the authoritative scope + callback + client-id values are
> the constants in `api/src/integrations/app-sso.ts`, not this document — keep
> them in lockstep (see "Must-match invariants" below).

## What this is

Ekoa authenticates a served app's end users (the BSM lawyers/staff) with their
own Microsoft 365 accounts, via delegated OIDC + Graph. The served-app SSO plane
is `api/src/integrations/app-sso.ts` (`/api/app-sso/microsoft/start` →
`/microsoft/callback`). Because BSM's tenant policy requires **admin consent**
for third-party apps, a tenant admin must grant consent **once per tenant**
before any user in that tenant can sign in. There is nothing to register on
BSM's side — no app registration, no client secret, no service account. The Ekoa
app registration already exists; the admin only clicks "Accept" on the consent
link.

Until consent is granted, users hitting `/microsoft/start` are bounced by
Microsoft with "Need admin approval" and the callback never receives a `code`
(the `admin_consent=true` landing page is handled at
`app-sso.ts` `/microsoft/callback`, `ssoAdminConsentPage`).

## App registration facts

| Field | Value |
| --- | --- |
| App name | Ekoa |
| Application (client) ID | `fcec37af-ec3b-4387-a43a-b44853d2156d` |
| Publisher domain | ekoa.io |
| Callback (redirect URI) | `https://api.ekoa.io/api/app-sso/microsoft/callback` |
| Delegated scopes requested | `openid profile email offline_access Mail.Send Calendars.ReadWrite` |

All permissions are **delegated** — the app acts only on behalf of the
signed-in user, never with standalone/application access to the organisation:

- `openid`, `profile`, `email` — sign-in + user identification (basic profile;
  no separate `User.Read` is requested by `app-sso.ts`).
- `offline_access` — refresh token so Graph actions survive the ~1h access-token
  life (`getSessionGraphAccessToken` refreshes on expiry).
- `Mail.Send` — send email as the signed-in user.
- `Calendars.ReadWrite` — create/edit the signed-in user's calendar events.

The scope string above is `SSO_SCOPES` in `app-sso.ts`. If the app's Entra
delegated-permission set diverges from `SSO_SCOPES`, sign-in still works but the
Graph proxy (`/api/app-sso/m365/*`) will 403 on the missing permission — keep the
two in lockstep.

## The two admin-consent URLs

An admin of the tenant opens the link, signs in, and clicks "Accept". BSM spans
two tenants; grant consent in **each tenant that has users on the platform**.

**Tenant `brasilsalomao.pt`** (tenant ID `565d5266-387d-4012-8e8d-7ce764c9ea8c`):

```
https://login.microsoftonline.com/565d5266-387d-4012-8e8d-7ce764c9ea8c/v2.0/adminconsent?client_id=fcec37af-ec3b-4387-a43a-b44853d2156d&scope=openid%20profile%20email%20offline_access%20Mail.Send%20Calendars.ReadWrite&redirect_uri=https%3A%2F%2Fapi.ekoa.io%2Fapi%2Fapp-sso%2Fmicrosoft%2Fcallback
```

**Tenant `brasilsalomao.com.br`** (tenant ID `41bb0273-6fc0-4dd9-95f5-4043246fdd1a`):

```
https://login.microsoftonline.com/41bb0273-6fc0-4dd9-95f5-4043246fdd1a/v2.0/adminconsent?client_id=fcec37af-ec3b-4387-a43a-b44853d2156d&scope=openid%20profile%20email%20offline_access%20Mail.Send%20Calendars.ReadWrite&redirect_uri=https%3A%2F%2Fapi.ekoa.io%2Fapi%2Fapp-sso%2Fmicrosoft%2Fcallback
```

After "Accept", the admin lands on `api.ekoa.io/api/app-sso/microsoft/callback?admin_consent=true&tenant=…`,
which renders the "Consentimento concedido" confirmation page (`ssoAdminConsentPage`).
Users in that tenant can sign in immediately afterward.

## Must-match invariants (do not skip)

1. **`MICROSOFT_SSO_CLIENT_ID` must match the `client_id` in the URLs.** The api
   reads `process.env.MICROSOFT_SSO_CLIENT_ID` (`app-sso.ts` `ssoClientId()`) to
   build the authorize/token requests. If the deployed `MICROSOFT_SSO_CLIENT_ID`
   is not `fcec37af-ec3b-4387-a43a-b44853d2156d`, the admin will have consented
   for one app while the platform authenticates as a different one — sign-in
   fails (`AADSTS` client mismatch / invalid_client). Verify the prod env
   (`ekoa-deploy` `.env`) before sending the links.
2. **`redirect_uri` must match the app registration + `MICROSOFT_SSO_REDIRECT_URI`.**
   `app-sso.ts` uses `MICROSOFT_SSO_REDIRECT_URI` when set, else derives
   `${origin}/api/app-sso/microsoft/callback`. It must be a registered redirect
   URI on the Entra app or Microsoft rejects the callback.
3. **`MICROSOFT_SSO_CLIENT_SECRET` / `MICROSOFT_SSO_TENANT_ID`** must be the
   secret + (optional) home tenant for that same client id.

## Client-conversion cascade (why you almost never change the client ID)

Admin consent is bound to the **client ID**. If the Ekoa app registration's
client ID ever changes — most likely by re-homing the registration into the
ekoaai tenant per the MPN / verified-publisher runbook (Option A) — the effect
cascades:

- **Every prior admin consent resets.** BSM (both tenants) and any other tenant
  or user that had consented must consent **again** for the new client ID —
  re-send both URLs with the new `client_id`.
- **`MICROSOFT_SSO_CLIENT_ID` / `MICROSOFT_SSO_CLIENT_SECRET` (and the paired
  `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`) must be updated in lockstep**
  in dev + prod env, and the api redeployed, in the SAME change — a half-swapped
  env is a hard outage (users consented against one id, platform authenticates as
  another).
- Because it forces a full re-consent round, do a client-ID change **before or
  immediately alongside** the BSM consent round — never months after onboarding.

See `docs/ops/bsm-mpn-verified-publisher.md` (Option A vs B) for when a client-ID
change is on the table.

## Verify it worked

1. From a browser signed into the target tenant, open the served BSM app and
   trigger Microsoft sign-in (`/api/app-sso/microsoft/start?...`).
2. Consent screen shows "Accept" (not "Need admin approval").
3. After accept, the callback sets the per-app session cookie and returns to the
   app; `/api/app-sso/me` reports the signed-in identity.
4. An `/api/app-sso/m365/*` Graph call (e.g. send mail / read calendar) returns
   2xx rather than `graph_not_authorized` (403).

---

## Appendix — customer-facing email (PT-PT, as sent to BSM IT)

Ported verbatim from the dev reference (`ekoa-dev/briefs/bsm-admin-consent-email.md`).
Note: the historically-sent email listed `User.Read` in the human-readable
permission list; the machine-authoritative scope set is `SSO_SCOPES` above. When
re-sending, use the URLs from "The two admin-consent URLs" section (they carry
the code-accurate scope string).

> **Para:** suporte@brasilsalomao.com.br
> **Cc:** (Luciana Costa / Fernando Senise, conforme o contacto habitual)
> **Assunto:** Ekoa – Autorização de administrador para início de sessão com Microsoft 365
>
> Prezados,
>
> À semelhança do que foi configurado em 2025 para o JVRIS EDGE (ROOX), a
> plataforma Ekoa autentica os utilizadores com as contas Microsoft 365 da vossa
> organização. Neste caso o pedido é mais simples: **não é necessário registar
> nenhuma aplicação no vosso portal Azure, nem criar client secret, nem conta de
> serviço**. Basta que um administrador do Microsoft 365 conceda, uma única vez,
> o consentimento de administrador para a aplicação.
>
> **Dados da aplicação:** Nome: Ekoa · Application (client) ID:
> `fcec37af-ec3b-4387-a43a-b44853d2156d` · Publisher domain: ekoa.io ·
> Permissões solicitadas (todas **delegadas** — a aplicação age apenas em nome do
> utilizador com sessão iniciada). Para conceder o consentimento, um administrador
> do tenant abre o link correspondente ao seu tenant (acima), inicia sessão e
> clica em "Aceitar". Após clicar em "Aceitar", verá uma página de confirmação
> ("Consentimento concedido") e os utilizadores passam de imediato a conseguir
> iniciar sessão. Sem este consentimento, os utilizadores veem a mensagem
> "Necessidade de aprovação de administrador" ao iniciar sessão na plataforma.
>
> Qualquer questão, estamos ao dispor. Melhores cumprimentos,
