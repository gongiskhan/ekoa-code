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
 *   EKOA_TAILNET=1          expose the stack on this machine's tailscale name + IP (auto-resolved)
 *   EKOA_PUBLIC_WEB_HOST    comma-separated extra hosts the stack is reached on (what
 *                           EKOA_TAILNET resolves into; drives next allowedDevOrigins,
 *                           the dev CSP widening, and the api frame-ancestors allowlist)
 *   EKOA_PUBLIC_API_URL     full API origin baked into the web bundle verbatim (rarely
 *                           needed — without it the browser adopts the page host at runtime)
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureTailnetServe, resolveTailnetHosts } from '../../../scripts/tailnet.mjs';

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

// EKOA_TAILNET=1: expose the stack on this machine's tailscale address(es). Resolved once
// here into EKOA_PUBLIC_WEB_HOST so tailnet mode and a hand-set public host stay ONE
// mechanism - everything downstream (next allowedDevOrigins + dev CSP widening in
// next.config.ts, the api frame-ancestors allowlist below) reads the same variable. An
// explicit EKOA_PUBLIC_WEB_HOST always wins.
//
// When the tailnet has HTTPS certs, TLS is additionally terminated on the SAME port numbers
// via `tailscale serve` (ensureTailnetServe explains why plain http on a ts.net host a
// browser has seen HTTPS on is a dead end). TAILNET_HTTPS_HOST non-null = https URLs work.
let TAILNET_HTTPS_HOST = null;
if (/^(1|true|yes)$/i.test(process.env.EKOA_TAILNET || '')) {
  const tailnet = resolveTailnetHosts();
  if (!tailnet) {
    throw new Error('EKOA_TAILNET is set but no tailscale address resolved - is tailscaled up? (`tailscale status`)');
  }
  if (!process.env.EKOA_PUBLIC_WEB_HOST) process.env.EKOA_PUBLIC_WEB_HOST = tailnet.hosts.join(',');
  const serveResult = ensureTailnetServe([
    { port: WEB_PORT, target: `http://127.0.0.1:${WEB_PORT}` },
    { port: PROXY_PORT, target: `http://127.0.0.1:${PROXY_PORT}` },
  ]);
  if (serveResult === 'on') {
    TAILNET_HTTPS_HOST = tailnet.dnsName;
  } else {
    log(`tailnet https unavailable (${serveResult}) - http URLs only; a browser that has seen`);
    log(`https on this host (HSTS) will refuse them with ERR_SSL_PROTOCOL_ERROR`);
  }
}
// Hosts (no scheme/port) the stack is additionally reached on, e.g. a tailnet name + IP.
const PUBLIC_WEB_HOSTS = (process.env.EKOA_PUBLIC_WEB_HOST || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

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
  // A stack bound to public host(s) (EKOA_PUBLIC_WEB_HOST, e.g. a tailnet name + IP) serves
  // the dashboard from those origins — the api's /apps/* frame-ancestors allowlist must name
  // them or the artifact preview iframe is CSP-blocked with only a browser console line to
  // show for it (found live 2026-08-07 driving the stack from a phone over tailscale). An
  // explicit EKOA_DASHBOARD_ORIGINS always wins; localhost stays so a local browser keeps working.
  const env = { ...process.env, PORT: API_PORT };
  if (PUBLIC_WEB_HOSTS.length && !process.env.EKOA_DASHBOARD_ORIGINS) {
    // Both schemes per host: tailscale serve terminates TLS on the same port, so the
    // dashboard origin the browser carries can be http OR https depending on how it arrived.
    env.EKOA_DASHBOARD_ORIGINS = [
      `http://localhost:${WEB_PORT}`,
      ...PUBLIC_WEB_HOSTS.flatMap((h) => [`http://${h}:${WEB_PORT}`, `https://${h}:${WEB_PORT}`]),
    ].join(',');
    log(`api frame-ancestors allowlist: ${env.EKOA_DASHBOARD_ORIGINS}`);
  }
  const child = spawn('node', args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code) => { if (!tearingDown) { log(`API exited (${code})`); teardown(1); } });
  children.push(child);
}

// ---- CORS reverse proxy (:PROXY_PORT -> :API_PORT) -------------------------
// Zero-dependency. Reflects Origin + allows the Authorization header so the
// cross-origin dashboard fetch (token auth) is accepted. Forwards websockets
// too (chat streaming) via the 'upgrade' event.
//
// Upstream connections are NOT keep-alive pooled: Node 19+ made the global
// agent keep-alive by default, and the API server closes idle sockets after
// its default 5s keepAliveTimeout — reusing a pooled socket the server is
// closing at that same moment dies with ECONNRESET before any response, which
// used to surface as a raw 502 "proxy error" document in the preview iframe
// (findings ledger F-2026-07-12). A fresh loopback connection per request is
// sub-millisecond and immune to that race; bodyless idempotent requests also
// get one retry in case the upstream socket dies some other transient way.
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

// Upstream-wins header merge: the api sets its own Access-Control-* on some planes
// (/apps/* and design tokens answer Access-Control-Allow-Origin: *, which
// web/lib/preview-probe.ts relies on). proxyRes.headers arrive lowercased while
// corsHeaders() names are mixed-case, so a plain object spread emitted BOTH copies,
// and a multi-valued Access-Control-Allow-Origin is rejected by browsers outright.
// Only inject the CORS headers upstream did not already set.
function mergeResponseHeaders(proxyRes, req) {
  const headers = { ...proxyRes.headers };
  for (const [k, v] of Object.entries(corsHeaders(req))) {
    if (!(k.toLowerCase() in headers)) headers[k] = v;
  }
  return headers;
}

const upstreamAgent = new http.Agent({ keepAlive: false });

function startProxy() {
  return new Promise((resolve, reject) => {
    proxyServer = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders(req));
        res.end();
        return;
      }
      // GET/HEAD carry no body, so a failed attempt can be replayed verbatim;
      // anything with a body has already been piped and cannot be.
      const retryable = req.method === 'GET' || req.method === 'HEAD';
      const forward = (attempt) => {
        // Set when WE tear the upstream down because the browser left, so the error
        // handler below can tell that apart from a genuine upstream failure (and, for
        // GET/HEAD, not "retry" a request nobody is waiting for any more).
        let clientGone = false;
        const proxyReq = http.request(
          { host: '127.0.0.1', port: API_PORT, method: req.method, path: req.url, headers: req.headers, agent: upstreamAgent },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, mergeResponseHeaders(proxyRes, req));
            proxyRes.pipe(res);
          },
        );
        // Propagate the client's disconnect upstream. `pipe` only forwards data, never
        // teardown, so without this an SSE stream (/api/v1/notifications/events, chat,
        // jobs, automations) that the browser closed left this proxy request - and with
        // it the API's SseManager client and its 30s keepalive timer - open FOREVER.
        // Measured 2026-08-05: /health reported 67 attached SSE clients against 12 real
        // sockets after a few hours of drill runs. Straight to :4211 the same connect/
        // abort returns to baseline in under 3s, so the API was always correct and this
        // proxy was the leak. A stale count is not cosmetic: it is read as evidence of a
        // product defect (docs/findings.md).
        const onClientClose = () => {
          clientGone = true;
          proxyReq.destroy();
        };
        res.once('close', onClientClose);
        proxyReq.on('close', () => res.off('close', onClientClose));
        proxyReq.on('error', (err) => {
          if (clientGone) return; // we destroyed it on purpose; the client is already gone
          log(`proxy upstream error (${req.method} ${req.url} attempt ${attempt}): ${err.code || err.message}`);
          if (res.headersSent) { res.destroy(); return; } // mid-stream: never append to a partial body
          if (retryable && attempt === 1) { forward(2); return; }
          res.writeHead(502, { ...corsHeaders(req), 'Content-Type': 'text/plain' });
          res.end(`proxy error: upstream API request failed (${err.code || err.message})`);
        });
        if (retryable) proxyReq.end();
        else req.pipe(proxyReq);
      };
      forward(1);
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
    // Wildcard first; loopback fallback. A persistently-armed `tailscale serve` mount holds
    // <tailscale-ip>:PORT inside tailscaled (survives stack restarts, needs root to remove),
    // which makes the wildcard bind EADDRINUSE on every boot AFTER the one that armed it.
    // The mount proxies to http://127.0.0.1:PORT, so loopback is exactly what it needs -
    // tailnet traffic still arrives; only direct plain-http LAN access is lost, which the
    // HSTS note above already declares a dead end on this host.
    proxyServer.once('error', (err) => {
      if (err && err.code === 'EADDRINUSE') {
        log(`:${PROXY_PORT} wildcard bind taken (tailscale serve TLS mount?) - rebinding on 127.0.0.1 only`);
        proxyServer.once('error', reject);
        proxyServer.listen(Number(PROXY_PORT), '127.0.0.1', () => {
          log(`CORS proxy listening on 127.0.0.1:${PROXY_PORT} -> :${API_PORT}`);
          resolve();
        });
        return;
      }
      reject(err);
    });
    proxyServer.listen(Number(PROXY_PORT), () => {
      log(`CORS proxy listening on :${PROXY_PORT} -> :${API_PORT}`);
      resolve();
    });
  });
}

// ---- Web (Next.js dev) -----------------------------------------------------

/** True when the WILDCARD bind of `port` is free. A persistently-armed `tailscale serve`
 *  mount holds <tailscale-ip>:port inside tailscaled across stack restarts, making the
 *  wildcard EADDRINUSE while loopback stays free - the same collision the proxy handles. */
function wildcardPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(Number(port), () => probe.close(() => resolve(true)));
  });
}

async function bootWeb() {
  // EKOA_PUBLIC_API_URL, when the operator set it, is the origin the BROWSER must use and
  // therefore the one the bundle and its CSP are built against (next.config.ts resolves it).
  // Leave it alone here: overwriting it with a loopback URL is exactly what makes a stack
  // driven from another machine fail with a blocked fetch and no server-side trace.
  const apiUrl = process.env.EKOA_PUBLIC_API_URL?.trim() || `http://localhost:${PROXY_PORT}`;
  const args = ['run', 'dev', '--workspace', 'web'];
  if (!(await wildcardPortFree(WEB_PORT))) {
    log(`:${WEB_PORT} wildcard bind taken (tailscale serve TLS mount?) - next dev binds 127.0.0.1 only`);
    args.push('--', '-H', '127.0.0.1');
  }
  log(`booting web (next dev) on :${WEB_PORT} with NEXT_PUBLIC_API_URL=${apiUrl}`);
  const child = spawn('npm', args, {
    cwd: ROOT,
    env: { ...process.env, PORT: WEB_PORT, NEXT_PUBLIC_API_URL: apiUrl },
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
  await bootWeb();
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
    // .killed only records that a signal was SENT; a child that ignored SIGTERM still has
    // exitCode/signalCode null - that is the condition for escalating.
    for (const c of children) { try { if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL'); } catch { /* ignore */ } }
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
  if (TAILNET_HTTPS_HOST) {
    // TLS termination claims these ports for tailnet-inbound traffic, so https is THE
    // tailnet URL (plain http from a peer now reaches the TLS listener, not the app).
    log(`TAILNET  web=https://${TAILNET_HTTPS_HOST}:${WEB_PORT}  api(proxy)=https://${TAILNET_HTTPS_HOST}:${PROXY_PORT}`);
  } else {
    for (const h of PUBLIC_WEB_HOSTS) {
      log(`TAILNET  web=http://${h}:${WEB_PORT}  api(proxy)=http://${h}:${PROXY_PORT}`);
    }
  }
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
