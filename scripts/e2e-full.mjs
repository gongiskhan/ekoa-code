#!/usr/bin/env node
/**
 * Full-stack ledger run (the "web lane" of ch14 §14.2.5) — boots api + CORS proxy +
 * Next.js web, then runs the suite-ledger runner with EKOA_E2E_WEB=1 so the
 * `needsWeb` dashboard specs (band1/band2/band4) actually execute.
 *
 *   npm run e2e:full
 *
 * Why a proxy (same reasons as .claude/skills/run-ekoa-code/driver.mjs, the proven
 * dev bring-up this harness is adapted from):
 *   1. next.config.ts computes the dashboard CSP `connect-src` from the API origin;
 *   2. the api ships NO CORS middleware on purpose (same-origin behind an edge proxy
 *      in production), so the cross-origin dev/e2e login needs injected CORS headers.
 * The real api listens on an internal port; a zero-dependency reverse proxy fronts
 * it with permissive CORS; `next dev` points at the proxy.
 *
 * Ports are parameterized so the lane can run BESIDE a live dev stack (which owns
 * the committed defaults :4111/:3000 on an operator machine):
 *   EKOA_E2E_API_PORT   (default 4211)  the real api
 *   EKOA_E2E_PROXY_PORT (default 4111)  the CORS proxy — what web + specs target
 *   EKOA_E2E_WEB_PORT   (default 3000)  next dev
 * Every port is preflight-checked and a collision fails fast with the override to
 * set — `next dev` would otherwise silently auto-increment to a port the runner is
 * not watching.
 *
 * The proxy origin is exported as EKOA_E2E_API_ORIGIN, honored by next.config.ts
 * (client bundle AND the CSP connect-src), web/e2e/helpers/legal.ts,
 * web/e2e/global-setup.ts, the band4 specs that call the api directly, and the
 * ledger runner's driver base — the single override name for "the api(proxy) this
 * harness booted". EKOA_API_URL / EKOA_API_BASE are ALSO pinned to it in the
 * runner env (belt-and-braces: two ported specs historically read those names;
 * a lingering shell value must never retarget a spec at a live dev database).
 *
 * Beside a live dev stack, one hazard remains: FROZEN band1 specs that read the
 * committed `backend.port` file (demos.spec) would cross-target the live api. The
 * ledger runner skips its `portfileBound` specs (printed, never silent) when the
 * portfile disagrees with EKOA_E2E_API_ORIGIN; full coverage of those specs needs
 * the live stack stopped so the harness can own the default ports.
 *
 * Readiness gates (deterministic): DEV-API READY (api /health answered) → featured
 * prebuild summary (band2/band3 need real served bundles, not placeholders; the
 * prebuild FAILURE line rejects fast instead of burning the timeout) → proxy
 * /health → web /login (next dev cold compile can take minutes). Then:
 *   EKOA_E2E_WEB=1 node scripts/suite-ledger-run.mjs --run
 * Teardown (scripts/lib/harness.mjs): SIGTERM every child's process group (children
 * are spawned detached so next dev / mongod / playwright browsers die with their
 * wrappers), close the proxy, SIGKILL stragglers, exit the runner's code.
 *
 * NOTE for operators: `next dev` with the isolated dist dir rewrites the COMMITTED
 * web/next-env.d.ts and web/tsconfig.json includes to point at .next-e2e. The
 * harness warns when it happened; `git restore web/next-env.d.ts web/tsconfig.json`
 * before committing (they must keep pointing at .next — CI has no .next-e2e).
 */
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureDemosSpine, assertPortFree, waitForHttp, attachWatcher, makeTeardown } from './lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const API_PORT = process.env.EKOA_E2E_API_PORT || '4211';
const PROXY_PORT = process.env.EKOA_E2E_PROXY_PORT || '4111';
const WEB_PORT = process.env.EKOA_E2E_WEB_PORT || '3000';
const API_ORIGIN = `http://localhost:${PROXY_PORT}`;
const WEB_BASE = `http://localhost:${WEB_PORT}`;

const API_READY_TIMEOUT_MS = 180_000;
const PREBUILD_TIMEOUT_MS = 10 * 60_000;
const PROXY_TIMEOUT_MS = 10_000;
const WEB_TIMEOUT_MS = 180_000;

const children = [];
let proxyServer = null;

function log(m) { process.stdout.write(`[e2e-full] ${m}\n`); }

// ---- CORS reverse proxy (:PROXY_PORT -> :API_PORT) -------------------------
// Adapted from .claude/skills/run-ekoa-code/driver.mjs (findings F-2026-07-12):
// upstream connections are NOT keep-alive pooled — the api closes idle sockets
// after its 5s keepAliveTimeout, and reusing a pooled socket at that moment dies
// with ECONNRESET before any response. Fresh loopback connections per request are
// sub-millisecond; bodyless idempotent requests get one retry.
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

// Upstream-wins merge: the api sets its own Access-Control-* on some planes
// (/apps/* answers Access-Control-Allow-Origin: *); a double header is rejected
// by browsers outright, so only inject what upstream did not already set.
function mergeResponseHeaders(proxyRes, req) {
  const headers = { ...proxyRes.headers };
  for (const [k, v] of Object.entries(corsHeaders(req))) {
    if (!(k.toLowerCase() in headers)) headers[k] = v;
  }
  return headers;
}

const upstreamAgent = new http.Agent({ keepAlive: false });

function startProxy() {
  return new Promise((resolvePromise, reject) => {
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
        const proxyReq = http.request(
          { host: '127.0.0.1', port: API_PORT, method: req.method, path: req.url, headers: req.headers, agent: upstreamAgent },
          (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 502, mergeResponseHeaders(proxyRes, req));
            proxyRes.pipe(res);
          },
        );
        proxyReq.on('error', (err) => {
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
    proxyServer.on('error', reject);
    proxyServer.listen(Number(PROXY_PORT), () => {
      log(`CORS proxy listening on :${PROXY_PORT} -> :${API_PORT}`);
      resolvePromise();
    });
  });
}

const teardown = makeTeardown({ children, closers: [() => proxyServer && proxyServer.close()] });
process.on('SIGINT', () => { log('SIGINT — tearing down'); teardown(130); });
process.on('SIGTERM', () => { log('SIGTERM — tearing down'); teardown(143); });

/** The live-stack portfile, if any (repo-root backend.port, written by garrison). */
function portfilePort() {
  try { return readFileSync(join(ROOT, 'backend.port'), 'utf8').trim(); }
  catch { return null; }
}

/** Warn when `next dev` rewrote committed files to point at the isolated dist dir. */
function warnIfNextRegeneratedFiles() {
  try {
    const dirty = execSync('git diff --name-only -- web/next-env.d.ts web/tsconfig.json', { cwd: ROOT, encoding: 'utf8' }).trim();
    if (dirty) {
      log(`WARNING: next dev rewrote committed file(s) for the isolated dist dir: ${dirty.split('\n').join(', ')}`);
      log('         run `git restore web/next-env.d.ts web/tsconfig.json` before committing.');
    }
  } catch { /* not a git checkout — nothing to warn about */ }
}

async function main() {
  if (!existsSync(join(ROOT, 'api', 'dist', 'server.js'))) {
    throw new Error('api/dist/server.js missing — run `npm run build` first');
  }
  await assertPortFree(API_PORT, 'api', 'EKOA_E2E_API_PORT');
  await assertPortFree(PROXY_PORT, 'proxy', 'EKOA_E2E_PROXY_PORT');
  await assertPortFree(WEB_PORT, 'web', 'EKOA_E2E_WEB_PORT');
  ensureDemosSpine(ROOT);

  const livePort = portfilePort();
  if (livePort && livePort !== PROXY_PORT) {
    log(`NOTE: backend.port declares a live dev stack on :${livePort} (harness proxy is :${PROXY_PORT}).`);
    log('      The ledger runner will skip its portfileBound frozen specs (demos) — printed, not');
    log('      silent. Stop the live stack and run on the default ports for full coverage.');
  }

  log(`booting api on :${API_PORT} (dev-api --built)`);
  const api = spawn('node', [join(ROOT, 'scripts', 'dev-api.mjs'), '--built'], {
    cwd: ROOT,
    // EKOA_APP_ORIGIN: the api's /apps frame-ancestors allowlist (security-headers.ts)
    // defaults to the dev dashboard :3000; the harness web port must be allowlisted or
    // the artifact preview overlay iframe renders empty (regressions-dashboard red,
    // 2026-07-18 run).
    env: { ...process.env, PORT: API_PORT, EKOA_APP_ORIGIN: WEB_BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // own process group, so teardown reaches mongod/builder grandchildren
  });
  api.on('exit', (code) => { if (!teardown.started) { log(`api exited (${code})`); teardown(1); } });
  children.push(api);
  const apiWatch = attachWatcher(api);
  await apiWatch.waitForLine(/DEV-API READY/, API_READY_TIMEOUT_MS, 'DEV-API READY');
  await apiWatch.waitForLine(/\[featured-builder\] built /, PREBUILD_TIMEOUT_MS, 'featured prebuild', {
    failPattern: /\[featured-builder\] prebuild failed/,
    failLabel: 'featured prebuild FAILED (see [featured-builder] output above)',
  });

  await startProxy();
  if (!(await waitForHttp(`${API_ORIGIN}/health`, { timeoutMs: PROXY_TIMEOUT_MS }))) {
    throw new Error(`proxy did not forward /health on :${PROXY_PORT}`);
  }
  log('proxy healthy');

  log(`booting web (next dev) on :${WEB_PORT} with EKOA_E2E_API_ORIGIN=${API_ORIGIN}`);
  // Next 16 keeps a per-distDir dev singleton lock (<distDir>/dev/lock), so a live
  // `next dev` on the default .next blocks a second one even on another port. The
  // harness uses its own dist dir (next.config.ts already honors NEXT_BUILD_DIST_DIR
  // for isolated gate builds) so it can boot beside a live dev stack.
  const web = spawn('npm', ['run', 'dev', '--workspace', 'web'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: WEB_PORT,
      EKOA_E2E_API_ORIGIN: API_ORIGIN,
      NEXT_BUILD_DIST_DIR: process.env.NEXT_BUILD_DIST_DIR ?? '.next-e2e',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true, // own process group, so teardown reaches next dev under the npm wrapper
  });
  web.on('exit', (code) => { if (!teardown.started) { log(`web exited (${code})`); teardown(1); } });
  children.push(web);
  if (!(await waitForHttp(`${WEB_BASE}/login`, { timeoutMs: WEB_TIMEOUT_MS }))) {
    throw new Error(`web /login never became reachable on ${WEB_BASE} (next dev cold compile can be slow)`);
  }
  log(`web /login reachable — running the ledger web lane`);

  const exitCode = await new Promise((resolvePromise) => {
    const runner = spawn('node', [join(ROOT, 'scripts', 'suite-ledger-run.mjs'), '--run'], {
      cwd: ROOT,
      env: {
        ...process.env,
        EKOA_E2E_WEB: '1',
        EKOA_E2E_API_ORIGIN: API_ORIGIN,
        WEB_BASE_URL: WEB_BASE,
        // Belt-and-braces: pin the two legacy env names some ported specs read to the
        // harness origin, so a lingering shell value can never point a spec at a live
        // dev database (review finding, 2026-07-18).
        EKOA_API_URL: API_ORIGIN,
        EKOA_API_BASE: API_ORIGIN,
      },
      stdio: 'inherit',
      detached: true, // tracked: teardown must reach playwright + its browsers
    });
    runner.on('exit', (code) => resolvePromise(code ?? 1));
    children.push(runner);
  });
  warnIfNextRegeneratedFiles();
  teardown(exitCode);
}

main().catch((err) => {
  log(`FAILED: ${err instanceof Error ? err.message : err}`);
  teardown(1);
});
