#!/usr/bin/env node
/**
 * Boot-B — the CREDENTIALED full-stack bring-up (companion to the run-ekoa-code driver and
 * scripts/dev-api.mjs). It boots the WHOLE ekoa stack (api + CORS proxy + Next.js web) against
 * an ephemeral mongodb-memory-server that has a REAL model credential seeded into it BEFORE the
 * server boots, so `GET /health` reports `claudeAuth.ok=true` and the live LLM chokepoint has a
 * usable subscription token. This is the difference from Boot-A (uncredentialed): here the model
 * egress path is actually authenticated.
 *
 * SECRET HYGIENE IS THE ACCEPTANCE BAR (read before editing):
 *   - The Cortex model credential comes from a DEDICATED account file (~/.config/ekoa/
 *     claude-credentials.json or $EKOA_CLAUDE_CREDENTIALS — see readCortexCredential()), NEVER
 *     the local Claude Code login by default (concurrent use of that token invalidated the
 *     operator's session — known flake). It is seeded ONLY in-process via setCredential(), which
 *     AES-encrypts it at rest in the throwaway mem-mongo. It is NEVER written to stdout/stderr/
 *     any file/any log, NEVER placed in a child process argv, and NEVER put in a spawned child's
 *     environment. The credential dies with the in-memory mongo at teardown.
 *   - We deliberately seed ONLY { mode, secret } — NO refreshToken / expiresAt — so the
 *     credential module never takes a refresh path that could rotate anyone's live token.
 *   - Every error this harness rethrows/logs is run through redact() so a stray token substring
 *     can never leak into the terminal.
 *
 * WHY A PROXY (same reason as the run-ekoa-code driver): the api ships no CORS middleware (prod is
 * same-origin behind an edge proxy) and the web CSP `connect-src` is computed from
 * NEXT_PUBLIC_API_URL. So the real api runs on an INTERNAL port (4211) and a zero-dependency
 * reverse proxy on :4111 injects permissive CORS; the web bundle + node drivers already resolve
 * to :4111. The proxy block below is carried verbatim from the run-ekoa-code driver.
 *
 * COMMANDS:
 *   node docs/release/probes/boot-b.mjs up      (default) boot the seeded stack, print a READY
 *                                               line, stay alive until SIGINT/SIGTERM.
 *   node docs/release/probes/boot-b.mjs down    print kill hints (pkill patterns) and exit.
 *
 * ENV:
 *   EKOA_LLM_DIRECT=1   point the LLM chokepoint base URL straight at https://api.anthropic.com
 *                       (otherwise the config default chokepoint route is used).
 *
 * Ports (fixed to match the run-ekoa-code driver's contract): api=:4211 (internal), proxy=:4111,
 * web=:3000.
 */
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..'); // docs/release/probes -> repo root

const API_PORT = '4211'; // internal, the real api server
const PROXY_PORT = '4111'; // what web + drivers resolve to (CORS shim)
const WEB_PORT = '3000';
const DIRECT = process.env.EKOA_LLM_DIRECT === '1';
const WEB_BASE = `http://localhost:${WEB_PORT}`;

// Dev-only secrets — never used in any deployed environment. The api child and the in-process
// credential-seeding step MUST share the SAME ENCRYPTION_KEY (so the server can decrypt the row
// we seed) and the SAME mem-mongo URI.
const ENCRYPTION_KEY = 'dev-only-encryption-key';
const JWT_SECRET = 'dev-only-jwt-secret';

const require = createRequire(join(ROOT, 'api', 'package.json'));
const { MongoMemoryServer } = require('mongodb-memory-server');

const children = [];
let proxyServer = null;
let mem = null;
let tearingDown = false;

// --- Secret hygiene ---------------------------------------------------------
// The live token, held only in memory. redact() scrubs it (and any obvious token-shaped
// substring) from anything we are about to print, as belt-and-braces on top of never logging it.
let CRED_TOKEN = null;
function redact(msg) {
  let s = typeof msg === 'string' ? msg : String(msg && msg.message ? msg.message : msg);
  if (CRED_TOKEN && s.includes(CRED_TOKEN)) s = s.split(CRED_TOKEN).join('[REDACTED]');
  return s;
}
function log(m) { process.stdout.write(`[boot-b] ${redact(m)}\n`); }

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

// --- Read the CORTEX model credential (a DEDICATED account, never the local Claude Code one) --
//
// WHY: seeding the LOCAL Claude Code account's OAuth token into the test stack and firing live
// chat turns from the gateway repeatedly invalidated the operator's Claude Code session mid-work
// (concurrent use of one subscription token from two clients; see docs/autothing/known-flakes.md).
// Cortex test stacks therefore authenticate with their OWN account, resolved in this order:
//
//   1. $EKOA_CLAUDE_CREDENTIALS            — explicit path to a Cortex credential JSON file
//   2. ~/.config/ekoa/claude-credentials.json  — the dedicated default location
//   3. legacy local-Claude-Code sources    — ONLY with EKOA_USE_LOCAL_CLAUDE_CREDS=1, loudly
//      warned (macOS Keychain item / ~/.claude/.credentials.json). Never the default.
//
// Accepted JSON shapes in the Cortex credential file (all values are secrets — never logged):
//   { "claudeAiOauth": { "accessToken": "sk-ant-oat01-..." } }   (a Claude Code credentials blob)
//   { "accessToken": "sk-ant-oat01-..." }                        (bare OAuth/long-lived token)
//   { "apiKey": "sk-ant-api03-..." }                             (Anthropic API key -> mode api-key)
//
// PROVISIONING the dedicated account (one-time):
//   - Subscription (Pro/Max) account: on any machine logged into THAT account, run
//     `claude setup-token` and paste the printed long-lived token:
//       mkdir -p ~/.config/ekoa && cat > ~/.config/ekoa/claude-credentials.json <<'J'
//       { "accessToken": "<the setup-token output>" }
//       J
//       chmod 600 ~/.config/ekoa/claude-credentials.json
//   - Or an API-key account: { "apiKey": "sk-ant-api03-..." } in the same file.
function readCortexCredential() {
  const explicit = process.env.EKOA_CLAUDE_CREDENTIALS;
  const dedicated = join(process.env.HOME || '', '.config', 'ekoa', 'claude-credentials.json');
  const candidates = [explicit, dedicated].filter(Boolean);

  for (const credFile of candidates) {
    if (!existsSync(credFile)) continue;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(credFile, 'utf8').trim());
    } catch {
      throw new Error(`${credFile} is not valid JSON — see the provisioning notes at the top of boot-b.mjs`);
    }
    const oauth = (parsed && parsed.claudeAiOauth && parsed.claudeAiOauth.accessToken) || (parsed && parsed.accessToken);
    if (typeof oauth === 'string' && oauth.length > 0) {
      log(`Cortex credential: dedicated oauth token from ${credFile === explicit ? '$EKOA_CLAUDE_CREDENTIALS' : '~/.config/ekoa/claude-credentials.json'} (not the local Claude Code account)`);
      return { mode: 'oauth', secret: oauth };
    }
    const apiKey = parsed && parsed.apiKey;
    if (typeof apiKey === 'string' && apiKey.length > 0) {
      log(`Cortex credential: dedicated api-key from ${credFile === explicit ? '$EKOA_CLAUDE_CREDENTIALS' : '~/.config/ekoa/claude-credentials.json'} (not the local Claude Code account)`);
      return { mode: 'api-key', secret: apiKey };
    }
    throw new Error(`${credFile} carries no usable credential (expected accessToken, claudeAiOauth.accessToken, or apiKey)`);
  }

  // Legacy path: the LOCAL Claude Code account. Explicit opt-in only — this is the behavior
  // that kept killing the operator's Claude Code session.
  if (process.env.EKOA_USE_LOCAL_CLAUDE_CREDS === '1') {
    log('WARNING: EKOA_USE_LOCAL_CLAUDE_CREDS=1 — seeding the LOCAL Claude Code account token.');
    log('WARNING: live turns from this stack can invalidate your Claude Code login (known flake).');
    let raw = null;
    if (process.platform === 'darwin') {
      try {
        raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { encoding: 'utf8' });
      } catch {
        /* fall through to the file */
      }
    }
    if (raw === null) {
      const legacyFile = join(process.env.HOME || '', '.claude', '.credentials.json');
      if (existsSync(legacyFile)) raw = readFileSync(legacyFile, 'utf8');
    }
    if (raw !== null) {
      let parsed;
      try {
        parsed = JSON.parse(raw.trim());
      } catch {
        throw new Error('the local Claude Code credential store was not the expected JSON shape');
      }
      const token = (parsed && parsed.claudeAiOauth && parsed.claudeAiOauth.accessToken) || (parsed && parsed.accessToken);
      if (typeof token === 'string' && token.length > 0) return { mode: 'oauth', secret: token };
    }
    throw new Error('EKOA_USE_LOCAL_CLAUDE_CREDS=1 but no local Claude Code credential was found');
  }

  throw new Error(
    'no Cortex model credential configured. Provision the DEDICATED account file (never the local ' +
      'Claude Code login): put { "accessToken": "<claude setup-token output>" } or ' +
      '{ "apiKey": "sk-ant-api03-..." } at ~/.config/ekoa/claude-credentials.json (chmod 600), or ' +
      'point $EKOA_CLAUDE_CREDENTIALS at such a file. See the notes above readCortexCredential() ' +
      'in boot-b.mjs. (Legacy escape hatch: EKOA_USE_LOCAL_CLAUDE_CREDS=1 — NOT recommended, it ' +
      'invalidates your Claude Code session.)',
  );
}

// --- Seed the credential into mem-mongo BEFORE the server boots -----------------------------
// In-process: connect to the mem-mongo, encrypt+persist the credential singleton, disconnect.
// process.env must carry the mem URI + ENCRYPTION_KEY + JWT_SECRET BEFORE importing the dist
// modules, because config reads env (and crypto derives its key from ENCRYPTION_KEY).
async function seedCredential(cred) {
  process.env.MONGODB_URI = mem.getUri();
  process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.JWT_SECRET = JWT_SECRET;

  const mongoMod = await import(pathToFileURL(join(ROOT, 'api', 'dist', 'data', 'mongo.js')).href);
  const credMod = await import(pathToFileURL(join(ROOT, 'api', 'dist', 'llm', 'credentials.js')).href);

  await mongoMod.connectMongo(); // reads process.env.MONGODB_URI, db 'ekoa' (same as the server)
  try {
    // Deliberately OMIT refreshToken/expiresAt: no refresh path can rotate anyone's live token.
    await credMod.setCredential({ mode: cred.mode, secret: cred.secret });
  } finally {
    await mongoMod.closeMongo();
  }
  log(`credential seeded into mem-mongo (${cred.mode}, no-refresh)`);
}

// --- API (node api/dist/server.js against our seeded mem-mongo) -----------------------------
function bootApi() {
  const entry = join(ROOT, 'api', 'dist', 'server.js');
  log(`booting api on :${API_PORT} (built) direct=${DIRECT ? '1' : '0'}`);
  const env = {
    ...process.env,
    PORT: API_PORT,
    MONGODB_URI: mem.getUri(),
    ENCRYPTION_KEY,
    JWT_SECRET,
    EKOA_ADMIN_USERNAME: 'admin',
    EKOA_ADMIN_PASSWORD: 'tmp12345',
    ...(DIRECT ? { LLM_CHOKEPOINT_BASE_URL: 'https://api.anthropic.com' } : {}),
  };
  const child = spawn('node', [entry], { cwd: join(ROOT, 'api'), env, stdio: 'inherit' });
  child.on('exit', (code) => { if (!tearingDown) { log(`api exited (${code})`); teardown(1); } });
  children.push(child);
}

// --- CORS reverse proxy (:PROXY_PORT -> :API_PORT) — carried verbatim from the run-ekoa-code
// driver. Reflects Origin + allows the Authorization header so the cross-origin dashboard fetch
// (token auth) is accepted. Forwards websockets (chat streaming) via the 'upgrade' event.
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

// --- Web (Next.js dev) — same shape as the run-ekoa-code driver -----------------------------
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

// --- Bring the whole stack up ---------------------------------------------------------------
async function bootStack() {
  const entry = join(ROOT, 'api', 'dist', 'server.js');
  if (!existsSync(entry)) {
    throw new Error('api/dist/server.js missing — run `npm run build` first (the stack runs --built)');
  }
  log('starting mongodb-memory-server ...');
  mem = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });

  const cred = readCortexCredential();
  CRED_TOKEN = cred.secret; // arm the redactor
  log('Cortex model credential loaded (not logged)');
  await seedCredential(cred);

  bootApi();
  if (!(await waitForHttp(`http://127.0.0.1:${API_PORT}/health`, { timeoutMs: 60_000 }))) {
    throw new Error(`api did not answer /health on :${API_PORT}`);
  }
  log('api healthy');

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

function teardown(code) {
  if (tearingDown) return;
  tearingDown = true;
  for (const c of children) { try { c.kill('SIGTERM'); } catch { /* ignore */ } }
  if (proxyServer) { try { proxyServer.close(); } catch { /* ignore */ } }
  // Stop the mem-mongo — the seeded (encrypted) credential dies with it.
  const stopMem = mem ? mem.stop().catch(() => {}) : Promise.resolve();
  setTimeout(() => {
    for (const c of children) { try { if (!c.killed) c.kill('SIGKILL'); } catch { /* ignore */ } }
    void stopMem.finally(() => process.exit(code));
  }, 1500);
}
process.on('SIGINT', () => { log('SIGINT — tearing down'); teardown(130); });
process.on('SIGTERM', () => { log('SIGTERM — tearing down'); teardown(143); });

// --- Commands -------------------------------------------------------------------------------
async function cmdUp() {
  await bootStack();
  // Report the seeded auth state from the LIVE health surface (never the token itself).
  let ok = false;
  let mode = 'unknown';
  try {
    const r = await fetch(`http://localhost:${PROXY_PORT}/health`);
    const h = await r.json();
    ok = !!(h && h.claudeAuth && h.claudeAuth.ok);
    mode = (h && h.claudeAuth && h.claudeAuth.mode) || 'unknown';
  } catch (e) {
    log(`could not read /health claudeAuth: ${redact(e)}`);
  }
  log('');
  log(`READY api(proxy)=:${PROXY_PORT} web=:${WEB_PORT} claudeAuth.ok=${ok} mode=${mode} direct=${DIRECT ? '1' : '0'}`);
  log('Drive it: playwright-cli open ' + WEB_BASE + '/login   (Ctrl-C here to stop the stack)');
  await new Promise(() => {}); // stay alive
}

function cmdDown() {
  process.stdout.write(
    '[boot-b] down — this command starts nothing; to stop a running boot-b stack, send SIGINT to it,\n' +
      '         or use these kill hints:\n' +
      "  pkill -f 'docs/release/probes/boot-b.mjs'\n" +
      "  pkill -f 'api/dist/server.js'\n" +
      "  pkill -f 'next dev'\n",
  );
  process.exit(0);
}

const [, , cmd = 'up'] = process.argv;
if (cmd === 'up') {
  cmdUp().catch((e) => { log(`up failed: ${redact(e)}`); teardown(1); });
} else if (cmd === 'down') {
  cmdDown();
} else {
  process.stdout.write('usage: boot-b.mjs <up|down>\n');
  process.exit(2);
}
