---
name: run-ekoa-code
description: Run, launch, boot, or screenshot the ekoa-code app locally — the full stack (Express API + Next.js dashboard) with a real-UI login. Use to start the app, see a change working in the real dashboard, or capture a screenshot. Handles the CSP + CORS traps that make a plain `npm run dev` fail to log in.
---

# Run ekoa-code

ekoa-code is **two apps that must run together**: the Express API (`:4111`, an
ephemeral in-memory Mongo in dev) and the Next.js dashboard (`:3000`). The
dashboard logs in against the API. Driving it is done through
[`driver.mjs`](driver.mjs) (boots the whole stack) plus the global
`playwright-cli` (drives the browser). All paths below are relative to the repo
root.

**Why you can't just `npm run dev`** (both traps are real; the driver handles both):
1. `next.config.ts` builds the dashboard's CSP `connect-src` from
   `process.env.NEXT_PUBLIC_API_URL`. Plain `next dev` leaves it unset, so the
   browser **blocks the login fetch** as a CSP violation.
2. The API ships **no CORS** on purpose — in production the web and API are
   same-origin behind an edge proxy. Cross-origin dev gets no
   `Access-Control-Allow-Origin`, so login fails preflight.

The committed e2e harness only ever boots the API; the dashboard specs
historically relied on an uncommitted "operator full-stack env" (RUN_LOG
DEVIATION, 2026-07-08). This driver **is** that missing bring-up: it runs the
real API on an internal port (`4211`), puts a tiny zero-dependency CORS reverse
proxy on `4111` (the port `backend.port` names, so the web bundle resolves to
it), and starts `next dev` with `NEXT_PUBLIC_API_URL=http://localhost:4111`.
Auth is token-based (Bearer in localStorage), so a CORS shim is enough.

## Prerequisites

- Node 20 (`node --version` → `v20.19.4`; repo pins `>=20 <21`).
- Workspace deps installed: `npm ci` (standard npm-workspaces bootstrap).
- The API build the fast path uses (tsc, seconds):
  ```bash
  npm run build --workspace shared && npm run build --workspace api
  ```
  (Or set `EKOA_API_MODE=dev` to run the API via ts-node with no build.)
- Playwright's Chromium: `npx playwright install chromium` (already present if
  the e2e suite has run).

## Run (agent path)

### One-shot proof — boot, real-UI login, screenshot, tear down

Self-contained. Boots the stack, logs in as `admin`/`tmp12345`, screenshots each
route to `.ekoa-run/` (gitignored), exits 0 on success:

```bash
node .claude/skills/run-ekoa-code/driver.mjs smoke /chat /integrations /memory
```

Expected tail:
```
[run-ekoa-code] login OK -> landed on /chat
[run-ekoa-code] screenshot /chat -> .../.ekoa-run/chat.png
```
Default route is `/chat` if you pass none. Then look at the PNGs in `.ekoa-run/`.

### Interactive — keep the stack up and drive it yourself

```bash
node .claude/skills/run-ekoa-code/driver.mjs up
```
Prints, then stays alive until Ctrl-C:
```
[run-ekoa-code] READY  web=http://localhost:3000  api(proxy)=http://localhost:4111  login=admin/tmp12345
```
With it running (in another shell / background), drive the dashboard with the
global `playwright-cli` — this is the exact login the e2e suite uses:

```bash
playwright-cli -s=ekoa open http://localhost:3000/login
playwright-cli -s=ekoa run-code "async (page) => { await page.locator('input[type=\"text\"], input:not([type])').first().fill('admin'); await page.locator('input[type=\"password\"]').first().fill('tmp12345'); await page.getByRole('button', { name: /entrar|iniciar/i }).first().click(); await page.waitForURL(/\/chat/, { timeout: 60000 }); return page.url(); }"
playwright-cli -s=ekoa screenshot
playwright-cli -s=ekoa close
```

Routes worth visiting after login: `/chat` (landing), `/integrations`,
`/memory`, `/knowledge`, `/automations`, `/artifacts`, `/usage`, `/settings`.

### Served legal/demo apps (API only, no dashboard needed)

The API also serves ~184 standalone apps at `/apps/<slug>/` with permissive CORS
already — no proxy needed. With any stack up (or just the API), e.g.
`http://localhost:4111/apps/legal-nucleo/`.

## Env overrides

`EKOA_API_PORT` (4211) · `EKOA_WEB_PORT` (3000) · `EKOA_ADMIN_USERNAME` (admin) ·
`EKOA_ADMIN_PASSWORD` (tmp12345) · `EKOA_SHOT_DIR` (.ekoa-run) ·
`EKOA_API_MODE` (`built` | `dev`).

## Gotchas

- **`backend.port` pins the browser's API origin.** In dev, `next.config.ts`
  reads `../backend.port` (committed `4111`) and inlines it as
  `NEXT_PUBLIC_API_URL`, ignoring the shell env. That's why the proxy has to
  occupy `4111` and the real API is moved to `4211` — pointing the browser at any
  other port doesn't work.
- **A plain cross-origin `next dev` cannot log in.** Symptom on `/login`:
  `Failed to fetch` + console `... violates the following Content Security Policy
  directive: "connect-src ..."` then a CORS preflight error to
  `/api/v1/auth/login`. Both are the two traps above; use the driver.
- **`/api/v1/auth/refresh` 404 after login means a stale API build.** The
  endpoint exists (`api/src/routes/auth.ts`, F1 auth-lifecycle fix, 2026-07-09);
  a 404 means `api/dist` predates it — rerun the build step above and restart.
  Login still succeeds (the auth store treats refresh failure as non-fatal), but
  the console 404 violates the zero-console-error QA bar, so don't ship on it.
- **Login lands on `/chat`, not `/`.** The success signal is
  `waitForURL(/\/chat/)`.
- **`next dev` cold-compiles on first hit.** First `/login` (and each first route
  visit) can take 10-30s; the driver waits up to 180s for `/login`.
- **The UI is Portuguese.** Login button is "Entrar"; the driver matches
  `/entrar|iniciar/i`.

## Test (not the same as running)

Running the app is not testing it — for the suite (ledger-gated e2e, contract,
unit) and the CI lane, load `.claude/skills/ekoa-testing`. One tie-in worth
knowing: `npm run e2e` runs `playwright test` for due specs but does **not**
start the web server, so the band1 dashboard specs (login → `/chat` on `:3000`)
need this driver's `up` running alongside — exactly the full-stack bring-up the
committed harness never provided.

## Troubleshooting

- **`api/dist/server.js missing`** → run the build step above, or use
  `EKOA_API_MODE=dev`.
- **`EADDRINUSE` on 3000/4111/4211** → a previous run is still up. Kill it:
  `pkill -f "driver.mjs"; pkill -f "next dev"; pkill -f "dev-api.mjs"`.
- **`web /login never became reachable`** → `next dev` failed to compile; check
  its output (the driver streams it) — usually a missing dep (`npm ci`).
- **Login times out on `/chat`** → confirm the API is healthy through the proxy:
  `curl -s http://localhost:4111/health` should be `200`. If the browser console
  shows a CSP/CORS error, you launched `next dev` yourself without the driver.
