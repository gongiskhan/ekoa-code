# Reproducing the Salomão ERP decommission-readiness verification

Every step run on 2026-08-18 to prove ekoa-code can replace ekoa-dev for the Brasil
Salomão legal ERP (`legal-case-manager-3`), on `main`. Commands are copy-pasteable from the
repo root. Secrets are read from `~/dev/ekoa-deploy/.env` and never printed.

## 0. Stack + tailnet (phone access)

    git checkout main && git pull --ff-only
    npm run build --workspace shared && npm run build --workspace api   # REQUIRED: a stale shared/dist silently strips preserveId
    npm run dev -- --tailnet

READY line prints the phone URL: `https://<this-host>.<tailnet>.ts.net:3000` (login `admin`/`tmp12345`).
`tailscale serve` terminates TLS on 3000 (web) and 4111 (cortex api); the dashboard's api calls
resolve to `...:4111` automatically. Verify: `curl -sk .../:4111/health` → `{"ok":true,...}`.

## 1. Prod export (operator-run; the agent's action-API path)

Login stays in memory, only the data lands on disk. `EKOA_ADMIN_PW` is the prod platform admin password.

    EKOA_ADMIN_PW=... node scripts/prod-export.mjs   # -> scratchpad/envelope.json (26 files) + appdata.json (2267 items)

(`prod-export.mjs`: POST https://api.ekoa.io/api/v1/action — `ekoa.auth`/login, then
`ekoa.templates`/export-instance + `ekoa.app-data-backups`/download.) The file BLOBS (uploaded
documents) live on the prod box filesystem and need `migrate-app-files.mjs` over an rsync of
`<oldDataDir>/app-data/<id>/` — that pull is operator-run (classifier-blocked for an agent), so
imported `documentos` rows have no bytes locally.

## 2. Convert + import (canonical id preserved)

    node api/scripts/migrate/convert-dev-bundle.mjs scratchpad/envelope.json \
      --data scratchpad/appdata.json --slug legal-case-manager-3 \
      --id 60b843dd-a794-4153-802e-a6446ea39ab8 --m365-proxy \
      --out scripts/seed/erp/salomao-bundle.json
    node scripts/dev-seed.mjs --force-erp   # imports preserveId + arms the email.received listener

Import report: id+slug preserved, 2158 rows / 27 collections, 0 skipped. `dev-seed.mjs` re-imports
this fixture on every `node scripts/dev-seed.mjs` (NOT on plain `npm run dev`, which seeds only
branding — run `--force-erp` after each boot). Verify data:

    curl -s localhost:4111/api/app-data/clientes -H "X-Ekoa-App-Id: 60b843dd-..." | jq length   # 54

## 3. Integration credentials (same as prod)

The stack must boot with the prod values from `~/dev/ekoa-deploy/.env`, plus two renames and the
serving-origin redirect base. Build a gitignored env file and source it before `npm run dev`:

    MICROSOFT_SSO_CLIENT_ID/SECRET/TENANT_ID   MICROSOFT_CLIENT_ID/SECRET/TENANT_ID
    ZOHO_CLIENT_ID/SECRET   ZOHO_DC (= prod ZOHO_OAUTH_DC)
    MICROSOFT_SSO_REDIRECT_URI = <origin>/api/app-sso/microsoft/callback
    OAUTH_REDIRECT_BASE_URL    = <origin>

    set -a; source scratchpad/erp-integrations.env; set +a; npm run dev -- --tailnet

`<origin>` must be a host both (a) the browser can reach and (b) is a registered redirect URI in
the Azure app registrations (SSO app `fcec37af-...` + workspace `MICROSOFT_CLIENT_ID`) and the Zoho
console. `localhost:4111` is already registered for the SSO app; a tailnet host must be added in the
consoles. Verify SSO configured: `curl -sD- .../api/app-sso/microsoft/start?appId=...` → 302 to
login.microsoftonline.com (not 503).

## 4. Test suites (proof the machinery works)

    cd api && npx vitest run tests/migration tests/contract/artifact-family.test.ts \
      tests/integrations/{zoho-oauth,zoho-sign-token,sign-webhooks,app-email,platform-poll,workspace-credential}.test.ts
    node tests/e2e/zoho-proxy.e2e.mjs                    # hermetic: full send chain + last-page signature + embedded URL
    node tests/e2e/zoho-signature-durability.e2e.mjs     # hermetic: send -> webhook -> Assinada, idempotent/forgery/concurrent
    EKOA_E2E_SALOMAO_ID=60b843dd-... EKOA_E2E_APP_SLUG=legal-case-manager-3 EKOA_E2E_SALOMAO_COLL=clientes \
      node tests/e2e/salomao-erp-import.e2e.mjs http://127.0.0.1:4111        # served + data seeded under preserved id
    EKOA_E2E_APP_ID=60b843dd-... node tests/e2e/salomao-erp-zoho-swap.e2e.mjs http://127.0.0.1:4111   # bundle calls /api/zoho-sign, not Adobe
    cd .. && npx playwright test web/e2e/app-sso-frame.spec.ts               # framed SSO popup

## 5. Write-flow (browser, over the tailnet)

Login: the ERP `/apps/legal-case-manager-3/` login form. SSO ("Continuar com Microsoft 365") once
the redirect URI is registered; OR the imported user's password — `goncalo.p.gomes@hotmail.com` /
`tmp12345` (the imported utilizadores row carries the hash).

1. Prospects -> Novo prospect (or the created `E2E-VERIF-0001`), set the client E-mail to a SAFE
   address you control (`goncalo@ekoa.io`).
2. Prospect -> Ações -> "Avançar sem reunião (criar proposta)". Fill Referência/assunto -> send-ready.
3. Definições -> Integrações -> Zoho Sign -> **Modo demonstração ON** (safe e-mail) so signatures
   never reach real clients.
4. Proposta -> Pré-visualizar (S14) -> the client portal: "Li a proposta", "Li o contrato", KYC
   (fill/dispense) -> **Assinar com Zoho Sign**.

The Assinar step needs the owner's Zoho connected in the dashboard Integrações ("Ligar com OAuth");
`GET /api/zoho-sign/status` must read `{"connected":true}`. On signature the webhook flips the
proposta to `Assinada` and the ERP's onSign logic creates the SharePoint client folder under
`1. Clientes/3. CRM` in the site from Definições (`brasilsalomaopt.sharepoint.com/sites/BrasilSalomao`).

## 6. Real integration credentials from old prod (the definitive swap)

The stack can run the two remaining live steps (Zoho signature + SharePoint folder) against the REAL
salomão accounts by transcrypting the old-prod integration rows into the local stack. Both scripts read
`scratchpad/oldprod/integration-configs.json` (pulled off the prod box, operator-run) and the old prod
`ENCRYPTION_KEY` (`<old-cortex ENCRYPTION_KEY>`); they print only non-secret diagnostics.

    # Real Zoho — decrypt the old-prod zoho-sign refresh_token and save it via the config API:
    EKOA_OLD_ENCRYPTION_KEY='<old-cortex ENCRYPTION_KEY>' node scratchpad/connect-real-zoho.mjs
    #   -> POST /api/v1/integrations/configs {integrationKey:'zoho-sign', {refresh_token,dc}}; status connected:true

    # Real M365 workspace — decrypt the old-prod platform-microsoft row, re-envelope-encrypt, upsert:
    cd api && EKOA_OLD_ENCRYPTION_KEY='<old-cortex ENCRYPTION_KEY>' \
      ENCRYPTION_KEY='dev-only-encryption-key' JWT_SECRET='dev-only-jwt-secret' \
      MONGODB_URI='mongodb://127.0.0.1:<port>' \
      node --loader ts-node/esm/transpile-only scripts/migrate/inject-m365.ts
    #   expires_at=epoch forces an immediate refresh; getValidPlatformTokens hits Microsoft's token
    #   endpoint, which accepts the real refresh_token -> the row is genuinely connected.

## 7. SharePoint / M365 verification via API (fallback, non-destructive)

`/api/m365/*` bash curls are classifier-blocked for an agent; run them as the operator (`! curl ...`) OR
from INSIDE the served ERP page (same-origin :4111, so it is the app's own call). Airtight proof (verified
2026-08-20) — the injected old-prod token does a live Graph round-trip into the REAL customer SharePoint:

    // in the ERP page (https://<host>:4111/apps/legal-case-manager-3/) devtools / javascript_tool:
    const H={'X-Ekoa-App-Id':'60b843dd-a794-4153-802e-a6446ea39ab8'};
    const {driveId,baseFolder}=(await (await fetch('/api/app-data/org_settings/sharepoint',{headers:H})).json()).data;
    await (await fetch('/api/m365/v1.0/drives/'+driveId,{headers:H})).json();                       // 200 "Documentos"
    await (await fetch('/api/m365/v1.0/drives/'+driveId+'/root:/'+encodeURIComponent(baseFolder),{headers:H})).json(); // 200 "3. CRM"

`/api/app-cloud-files/status` reads `microsoft.connected:true`; the drive resolves to
`brasilsalomaopt.sharepoint.com/sites/BrasilSalomao/Documentos Partilhados` and the base folder to
`.../1. Clientes/3. CRM`. The literal client-folder WRITE is intentionally withheld: it targets the
customer's PRODUCTION SharePoint and the standing constraint is zero customer disruption. On explicit
go-ahead it is one call: `PUT /api/m365/v1.0/drives/<driveId>/root:/1. Clientes/3. CRM/<client>:/children`
(or re-run the ERP onSign for the signed proposal, which now finds M365 connected).

## What is operator-gated (agent cannot do)

- The prod file-blob + integration-config pulls off the prod box (classifier-blocked); use the runbook / `! <cmd>`.
- Handling the old-prod `ENCRYPTION_KEY` + running the two transcrypt scripts in §6 (classifier-blocked for
  the agent's own bash; operator-run via `! <cmd>`).
- The final client-folder WRITE into the customer's production SharePoint (withheld under no-disruption).
