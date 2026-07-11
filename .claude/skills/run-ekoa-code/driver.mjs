#!/usr/bin/env node
/**
 * run-ekoa-code driver — bring up the FULL ekoa-code stack locally and drive the
 * Next.js dashboard through a real-UI login, then screenshot it.
 *
 * WHY THIS EXISTS (the whole reason a plain `npm run dev` is not enough):
 *   ekoa-code is two apps — the Express API (:4111, memory-mongo in dev) and the
 *   Next.js dashboard (:3000). The browser talks to the API cross-origin, but:
 *     1. next.config.ts computes the dashboard's CSP `connect-src` from
 *        process.env.NEXT_PUBLIC_API_URL. Plain `next dev` leaves it unset, so the
 *        browser BLOCKS the login fetch to the API (CSP violation).
 *     2. The API ships NO CORS middleware on purpose — in production the web and API
 *        are same-origin behind an edge proxy (Cloudflare/Caddy). Cross-origin dev
 *        therefore gets no `Access-Control-Allow-Origin` and login fails preflight.
 *   The committed e2e harness (scripts/e2e-with-server.mjs) only ever boots the API;
 *   the band1 dashboard specs historically relied on "the operator's local full-stack
 *   dev env" that was never committed (see RUN_LOG DEVIATION, 2026-07-08). This driver
 *   IS that missing full-stack bring-up, made reproducible and zero-setup.
 *
 * HOW IT SOLVES IT:
 *   - The real API runs on an INTERNAL port (default 4211).
 *   - A tiny zero-dependency reverse proxy occupies the port `backend.port` names
 *     (4111) — the port the web bundle + node drivers already resolve to — and
 *     injects permissive CORS (reflecting Origin, allowing the Authorization header)
 *     onto every API response. Auth is token-based (Bearer in localStorage), so a
 *     CORS shim is sufficient; no cookie/credentials gymnastics.
 *   - `next dev` runs on :3000 with NEXT_PUBLIC_API_URL=http://localhost:4111, which
 *     both satisfies the CSP connect-src AND points the browser at the proxy.
 *   Net: the dashboard at :3000 reaches the API through the CORS proxy and logs in.
 *
 * COMMANDS:
 *   node .claude/skills/run-ekoa-code/driver.mjs up
 *       Boot API + proxy + web, print a READY line with URLs, stay alive until
 *       Ctrl-C. Use this, then drive http://localhost:3000 with `playwright-cli`.
 *
 *   node .claude/skills/run-ekoa-code/driver.mjs smoke [route ...]
 *       Boot the whole stack, log in through the real UI (admin/tmp12345), screenshot
 *       each route (default: /chat), tear everything down, exit 0 on success.
 *       Screenshots land in .ekoa-run/ (gitignored). e.g.
 *         node .../driver.mjs smoke /chat /integrations /memory
 *
 * ENV OVERRIDES:
 *   EKOA_API_PORT (4211) EKOA_WEB_PORT (3000) EKOA_ADMIN_USERNAME (admin)
 *   EKOA_ADMIN_PASSWORD (tmp12345) EKOA_SHOT_DIR (.ekoa-run)
 *   EKOA_API_MODE (built|dev, default built — --built needs api/dist, run `npm run build` first)
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..'); // .claude/skills/run-ekoa-code -> repo root

const readBackendPort = () => {
  try {
    const p = readFileSync(join(ROOT, 'backend.port'), 'utf8').trim();
    if (/^\d+$/.test(p)) return p;
  } catch { /* fall through */ }
  return '4111';
};

const PROXY_PORT = readBackendPort();               // what web + drivers resolve to
const API_PORT = process.env.EKOA_API_PORT || '4211'; // internal, the real API
const WEB_PORT = process.env.EKOA_WEB_PORT || '3000';
const USER = process.env.EKOA_ADMIN_USERNAME || 'admin';
const PASS = process.env.EKOA_ADMIN_PASSWORD || 'tmp12345';
const API_MODE = process.env.EKOA_API_MODE || 'built';
const SHOT_DIR = process.env.EKOA_SHOT_DIR || join(ROOT, '.ekoa-run');
const WEB_BASE = `http://localhost:${WEB_PORT}`;

const children = [];
let proxyServer = null;
let tearingDown = false;

function log(m) { process.stdout.write(`[run-ekoa-code] ${m}\n`); }

async function waitForHttp(url, { timeoutMs = 120_000, okBelow = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < okBelow) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ---- API -------------------------------------------------------------------
function bootApi() {
  const args = ['scripts/dev-api.mjs'];
  if (API_MODE === 'built') {
    if (!existsSync(join(ROOT, 'api', 'dist', 'server.js'))) {
      throw new Error('api/dist/server.js missing — run `npm run build` first, or set EKOA_API_MODE=dev');
    }
    args.push('--built');
  }
  log(`booting API on :${API_PORT} (mode=${API_MODE})`);
  const child = spawn('node', args, {
    cwd: ROOT,
    env: { ...process.env, PORT: API_PORT },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => { if (!tearingDown) { log(`API exited (${code})`); teardown(1); } });
  children.push(child);
}

// ---- CORS reverse proxy (:PROXY_PORT -> :API_PORT) -------------------------
// Zero-dependency. Reflects Origin + allows the Authorization header so the
// cross-origin dashboard fetch (token auth) is accepted. Forwards websockets
// too (chat streaming) via the 'upgrade' event.
function corsHeaders(req) {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Authorization,Content-Type,X-Filename',
    'Access-Control-Expose-Headers': '*',
    Vary: 'Origin',
  };
}

function startProxy() {
  return new Promise((resolve, reject) => {
    proxyServer = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req));
        res.end();
        return;
      }
      const proxyReq = http.request(
        { host: '127.0.0.1', port: API_PORT, method: req.method, path: req.url, headers: req.headers },
        (proxyRes) => {
          const headers = { ...proxyRes.headers, ...corsHeaders(req) };
          res.writeHead(proxyRes.statusCode || 502, headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on('error', () => { if (!res.headersSent) res.writeHead(502, corsHeaders(req)); res.end('proxy error'); });
      req.pipe(proxyReq);
    });
    // Forward websocket upgrades (streaming) straight through.
    proxyServer.on('upgrade', (req, socket, head) => {
      const upstream = net.connect(Number(API_PORT), '127.0.0.1', () => {
        upstream.write(
          `${req.method} ${req.url} HTTP/1.1\r\n` +
            Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
            '\r\n\r\n',
        );
        if (head && head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    });
    proxyServer.on('error', reject);
    proxyServer.listen(Number(PROXY_PORT), () => {
      log(`CORS proxy listening on :${PROXY_PORT} -> :${API_PORT}`);
      resolve();
    });
  });
}

// ---- Web (Next.js dev) -----------------------------------------------------
function bootWeb() {
  log(`booting web (next dev) on :${WEB_PORT} with NEXT_PUBLIC_API_URL=http://localhost:${PROXY_PORT}`);
  const child = spawn('npm', ['run', 'dev', '--workspace', 'web'], {
    cwd: ROOT,
    env: { ...process.env, PORT: WEB_PORT, NEXT_PUBLIC_API_URL: `http://localhost:${PROXY_PORT}` },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => { if (!tearingDown) { log(`web exited (${code})`); teardown(1); } });
  children.push(child);
}

// ---- Bring the whole stack up ---------------------------------------------
async function bootStack() {
  bootApi();
  // Cold boots register ~200 featured apps before /health answers (~90s observed 2026-07-11).
  if (!(await waitForHttp(`http://127.0.0.1:${API_PORT}/health`, { timeoutMs: 180_000 }))) {
    throw new Error(`API did not answer /health on :${API_PORT}`);
  }
  log('API healthy');
  await startProxy();
  if (!(await waitForHttp(`http://localhost:${PROXY_PORT}/health`, { timeoutMs: 10_000 }))) {
    throw new Error(`proxy did not forward /health on :${PROXY_PORT}`);
  }
  log('proxy healthy');
  bootWeb();
  if (!(await waitForHttp(`${WEB_BASE}/login`, { timeoutMs: 180_000 }))) {
    throw new Error(`web /login never became reachable on ${WEB_BASE} (next dev cold compile can be slow)`);
  }
  log('web /login reachable');
}

// ---- Real-UI login (same selectors as the e2e suite) -----------------------
// Hydration-robust: on a cold `next dev` compile the inputs can be filled BEFORE
// React hydrates, so the DOM value is set but no onChange fires and the "Entrar"
// button stays disabled. Re-fill until the button reports enabled, then click.
async function login(page) {
  await page.goto(`${WEB_BASE}/login`, { waitUntil: 'domcontentloaded' });
  const user = page.locator('input[type="text"], input:not([type])').first();
  const pass = page.locator('input[type="password"]').first();
  const submit = page.getByRole('button', { name: /entrar|iniciar/i }).first();
  await user.waitFor({ state: 'visible', timeout: 60_000 });
  for (let attempt = 0; attempt < 15; attempt++) {
    await user.fill(USER);
    await pass.fill(PASS);
    if (await submit.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(1000); // give hydration time, then re-fill
  }
  await submit.click({ timeout: 15_000 });
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

function teardown(code) {
  if (tearingDown) return;
  tearingDown = true;
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* ignore */ } }
  if (proxyServer) { try { proxyServer.close(); } catch { /* ignore */ } }
  setTimeout(() => {
    for (const c of children) { try { if (!c.killed) c.kill('SIGKILL'); } catch { /* ignore */ } }
    process.exit(code);
  }, 1500);
}
process.on('SIGINT', () => { log('SIGINT — tearing down'); teardown(130); });
process.on('SIGTERM', () => { log('SIGTERM — tearing down'); teardown(143); });

// ---- Commands --------------------------------------------------------------
async function cmdUp() {
  await bootStack();
  log('');
  log(`READY  web=${WEB_BASE}  api(proxy)=http://localhost:${PROXY_PORT}  login=${USER}/${PASS}`);
  log('Drive it: playwright-cli -s=ekoa open ' + WEB_BASE + '/login   (Ctrl-C here to stop the stack)');
  // Stay alive.
  await new Promise(() => {});
}

async function cmdSmoke(routes) {
  const targets = routes.length ? routes : ['/chat'];
  mkdirSync(SHOT_DIR, { recursive: true });
  await bootStack();
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  let failed = false;
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    log(`logging in as ${USER} ...`);
    await login(page);
    log('login OK -> landed on /chat');
    for (const route of targets) {
      if (route !== '/chat' || page.url().indexOf('/chat') === -1) {
        await page.goto(`${WEB_BASE}${route}`, { waitUntil: 'domcontentloaded' });
      }
      await page.waitForTimeout(2500);
      const name = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
      const out = join(SHOT_DIR, `${name}.png`);
      await page.screenshot({ path: out, fullPage: true });
      log(`screenshot ${route} -> ${out}`);
    }
  } catch (err) {
    failed = true;
    log(`SMOKE FAILED: ${err && err.message ? err.message : err}`);
  } finally {
    await browser.close();
  }
  teardown(failed ? 1 : 0);
}

const [, , cmd, ...rest] = process.argv;
if (cmd === 'up') {
  cmdUp().catch((e) => { log(`up failed: ${e.message}`); teardown(1); });
} else if (cmd === 'smoke') {
  cmdSmoke(rest).catch((e) => { log(`smoke failed: ${e.message}`); teardown(1); });
} else {
  process.stdout.write('usage: driver.mjs <up|smoke [route ...]>\n');
  process.exit(2);
}
