# BSM ops — MPN / verified-publisher runbook

> **CUTOVER-SCOPE.** This is an operator runbook for earning the Microsoft
> "verified publisher" badge on the Ekoa app registration, not a per-PR
> engineering task. It runs outside the build lane, gated on manual Partner
> Center + Entra steps. Ported from the dev reference
> (`ekoa-dev/briefs/mpn-publisher-verification-runbook.md`); status lines are the
> dev snapshot (2026-07-02) and must be re-checked in Partner Center before use.

## Why this matters / why it can wait

The verified-publisher badge lifts Microsoft's block on **end-user self-consent**
for multitenant apps — but only in tenants whose policy already allows user
consent. Many corporates (BSM included) require **admin** consent regardless, and
tenant-wide admin consent works **today** with none of this (see
`docs/ops/bsm-admin-consent.md`). So: do the MPN / verified-publisher work
**before onboarding customers whose tenants allow user self-consent**; it is not
on the critical path for an admin-consent customer like BSM.

## Status snapshot (dev, 2026-07-02 — re-verify before acting)

Enrolled in the **Microsoft AI Cloud Partner Program** under **Modern Marathon
Lda** (Largo da Boavista 1 1dir, Oeiras, 2780-205, PT; NIPC 514472359; primary
contact Goncalo Gomes / goncalo.p.gomes@outlook.com).

- **Partner ID (PartnerGlobal / PGA): `7132492`** ← the one used for publisher
  verification.
- Partner ID (PartnerLocation): `7132493`.
- **Verification status: Pending** at snapshot (business verification; NIPC
  provided so usually hours to ~5 business days). Watch
  goncalo.p.gomes@outlook.com and Partner Center → Legal info.

Remaining: wait for **Verified** status, resolve the tenant question (Option A vs
B below), then the Entra "Add MPN ID" step with `7132492`.

Original state before enrollment: the Ekoa app registration
(`fcec37af-ec3b-4387-a43a-b44853d2156d`) lives in the **personal "Default
Directory" tenant** (`16ba3ec3-8c81-419c-9fd3-8d34e9132530`), **not** in the
ekoaai work tenant.

## The structural decision (read first)

Publisher verification requires the person clicking "Add MPN ID" in the app's
home tenant to **also** be an admin on the (verified) Partner Center account, and
Microsoft ties the check to **work** accounts. A personal-MSA "Default Directory"
home makes this painful. Two paths:

### Option A (recommended, cleaner long-term): re-home the app registration in the ekoaai tenant

- Create a **new** app registration in the ekoaai tenant (**new client ID**),
  replicating: multitenant + personal accounts, the redirect URIs (incl.
  `https://api.ekoa.io/api/app-sso/microsoft/callback`), publisher domain
  ekoa.io, the delegated Graph permissions (`app-sso.ts` `SSO_SCOPES`:
  `openid profile email offline_access Mail.Send Calendars.ReadWrite`), and a
  client secret.
- Update `MICROSOFT_SSO_CLIENT_ID` / `MICROSOFT_SSO_CLIENT_SECRET` (and the paired
  `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET`) in the api env — dev and prod
  (`ekoa-deploy` `.env`) — and redeploy the api.
- **Cost: every existing consent resets.** BSM (and any tenant/user that has
  consented) must consent **again** for the new client ID — this is the
  client-conversion cascade documented in `docs/ops/bsm-admin-consent.md`.
- If you pick A, do it **before or right after** the BSM consent round, never
  months later.

### Option B: keep the app where it is

- In the Default Directory tenant, create a member **work** account (e.g.
  `admin@<defaultdir>.onmicrosoft.com`) and grant it Global Admin there.
- After Partner enrollment, associate that tenant / add that user to the Partner
  Center account so one identity satisfies both sides.
- No client-ID change, no re-consent — but fragile and off the paved path;
  Microsoft support in this area assumes work tenants.

## Enrollment steps (account creation + agreements — operator does these)

1. Go to `https://partner.microsoft.com/dashboard/account/exp/enrollment/welcome`
   (signed in as the ekoaai work account) and enroll in the **Microsoft AI Cloud
   Partner Program** (free membership).
2. Fill the **legal business profile**: legal entity name, registered address,
   primary contact. Business verification runs after submit (1–5 business days;
   may request registration documents).
3. Complete **email/employment verification** for the enrolling user. Having
   ekoa.io as a verified domain on the ekoaai tenant helps (Entra ID → Custom
   domain names → add ekoa.io + DNS TXT); an `@ekoa.io` work account is the
   smoothest verifier identity.
4. Once Legal info shows **Verified**, copy the **Partner ID** (7 digits) from
   Account settings → Identifiers. Use the type **PartnerGlobal (PGA)**
   (`7132492`), **not** a location ID.

## Final step (Entra — add MPN ID to verify publisher)

5. In Entra: app registration → **Branding & properties** → **Add MPN ID to
   verify publisher** → enter the **PGA** Partner ID (`7132492`) → Verify and
   save. Requirements at that moment:
   - signed-in user is admin in the app's **home** tenant **and** an account admin
     on the Partner Center account (this is where Option A vs B bites);
   - app publisher domain verified (already done: ekoa.io);
   - Partner account verified.
6. Confirm the consent screen now shows the blue **verified** badge — test with a
   fresh sign-in from any tenant.

## Cross-references

- `docs/ops/bsm-admin-consent.md` — the admin-consent onboarding + the
  client-conversion cascade a client-ID change triggers.
- `api/src/integrations/app-sso.ts` — `SSO_SCOPES`, `MICROSOFT_SSO_*` env, the
  callback path, and the `admin_consent=true` landing page.
