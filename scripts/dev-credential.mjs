#!/usr/bin/env node
/**
 * Dev model-credential manager: mint, refresh, and store the Claude OAuth token the dev
 * stack needs, then (optionally) provision it into the RUNNING stack.
 *
 * WHY: the credential lives only in the API's AES-encrypted `credentials` store and dev
 * Mongo is ephemeral, so every boot needs a fresh provisioning pass
 * (.claude/skills/run-ekoa-code/provision-credential.mjs). Historically the operator had
 * to hand-place a token in the drop-file. This script closes the loop: it keeps the
 * drop-file valid on its own - refreshing the token when it expires, and when there is
 * nothing to refresh it opens the browser on the Claude authorize page so the operator
 * only has to press "Authorize" (OAuth 2.0 authorization-code + PKCE, RFC 8252 loopback
 * redirect - no code copy/paste).
 *
 * The minted token pair is DEDICATED to ekoa dev: it is a separate OAuth session from the
 * operator's Claude Code login, so it does not rotate under a live `claude` session (the
 * failure mode documented in docs/known-flakes.md).
 *
 * Drop-file: ~/.config/ekoa/claude-credentials.json (override: EKOA_CLAUDE_CREDENTIALS)
 *   { "accessToken": "...", "refreshToken": "...", "expiresAt": 1760000000000 }
 * Legacy shape { "accessToken": "..." } (e.g. a long-lived `claude setup-token` value) is
 * accepted as-is and used until it stops working (then run with --reauth).
 *
 * Secrets hygiene: tokens are never printed, never passed as argv, and reach the API only
 * through provision-credential.mjs (env -> POST body). The drop-file is chmod 600.
 *
 * OAuth endpoints/client: extracted from the installed Claude Code CLI (2.1.209), which
 * performs this exact flow for its own login. The token endpoint accepts JSON; we retry
 * form-encoded on a 4xx just in case that ever changes.
 *
 * CLI:
 *   node scripts/dev-credential.mjs                # ensure a valid token exists (refresh/mint)
 *   node scripts/dev-credential.mjs --provision    # ...and provision it into the running stack
 *   node scripts/dev-credential.mjs --reauth       # force a fresh browser authorize
 *   node scripts/dev-credential.mjs --no-browser   # never open a browser (refresh/stored only)
 */
import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Claude Code's public OAuth client (subscription login). Verified against CLI 2.1.209.
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = process.env.EKOA_OAUTH_AUTHORIZE_URL ?? 'https://claude.com/cai/oauth/authorize';
const TOKEN_URL = process.env.EKOA_OAUTH_TOKEN_URL ?? 'https://platform.claude.com/v1/oauth/token';
const SCOPES = 'org:create_api_key user:profile user:inference';

const CRED_PATH = process.env.EKOA_CLAUDE_CREDENTIALS ?? join(homedir(), '.config', 'ekoa', 'claude-credentials.json');
const AUTH_TIMEOUT_MS = Number(process.env.EKOA_OAUTH_TIMEOUT_MS) || 300_000;
// Refresh this long before the recorded expiry so a token never dies mid-run.
const EXPIRY_SLACK_MS = 5 * 60_000;

const log = (m) => process.stderr.write(`[dev-credential] ${m}\n`);

// ---- drop-file --------------------------------------------------------------
function readCredFile() {
  try {
    const cred = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
    if (!cred || typeof cred.accessToken !== 'string') return null;
    chmodSync(CRED_PATH, 0o600); // tighten a hand-placed file that predates this script
    return cred;
  } catch {
    return null;
  }
}

function writeCredFile(cred) {
  mkdirSync(dirname(CRED_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(CRED_PATH, `${JSON.stringify(cred, null, 2)}\n`, { mode: 0o600 });
  chmodSync(CRED_PATH, 0o600); // writeFileSync mode is ignored when the file already exists
}

const isExpired = (cred) => typeof cred.expiresAt === 'number' && Date.now() > cred.expiresAt - EXPIRY_SLACK_MS;

// ---- token endpoint ---------------------------------------------------------
// JSON first (what the CLI sends today); one form-encoded retry for robustness.
async function postToken(body) {
  let res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status >= 400 && res.status < 500) {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || typeof json.access_token !== 'string') {
    const detail = json.error_description ?? json.error ?? `HTTP ${res.status}`;
    throw new Error(`token endpoint rejected the request: ${detail}`);
  }
  return json;
}

function toCred(tokenResponse, previous) {
  return {
    accessToken: tokenResponse.access_token,
    // Refresh tokens rotate; keep the old one only if the response omits a new one.
    refreshToken: tokenResponse.refresh_token ?? previous?.refreshToken,
    expiresAt: typeof tokenResponse.expires_in === 'number' ? Date.now() + tokenResponse.expires_in * 1000 : undefined,
  };
}

async function refreshCred(cred) {
  log('access token expired - refreshing');
  const json = await postToken({ grant_type: 'refresh_token', refresh_token: cred.refreshToken, client_id: CLIENT_ID });
  const next = toCred(json, cred);
  writeCredFile(next);
  log('refreshed and saved');
  return next;
}

// ---- browser authorize flow (PKCE + loopback redirect) ----------------------
function openBrowser(url) {
  // `start` is a cmd.exe builtin, not an executable; the empty '' is its window-title slot.
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  // spawn failures surface as an async 'error' event; without a listener they crash the process.
  child.on('error', () => log('could not auto-open a browser - use the URL above'));
  child.unref();
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}

async function browserAuthorize() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = b64url(crypto.randomBytes(32));

  let settle;
  const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const page = (title, body) =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;margin:4rem auto;max-width:30rem"><h1>${title}</h1><p>${body}</p></body>`;
  const handler = (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // Connection: close so completed/keep-alive sockets don't hold the CLI's event loop open.
    if (url.pathname !== '/callback') { res.writeHead(404, { connection: 'close' }); res.end(); return; }
    // The state guards BOTH branches: a forged request must not abort or complete the flow.
    if (url.searchParams.get('state') !== state) { res.writeHead(400, { connection: 'close' }); res.end('state mismatch'); return; }
    const authError = url.searchParams.get('error');
    if (authError) {
      res.writeHead(200, { 'content-type': 'text/html', connection: 'close' });
      res.end(page('Authorization failed', 'You can close this tab. See the terminal for details.'));
      // sanitized: never echo raw query input into the terminal (escape-sequence injection)
      settle.reject(new Error(`authorize page returned error=${authError.replace(/[^\w.-]/g, '')}`));
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) { res.writeHead(400, { connection: 'close' }); res.end('missing code'); return; }
    res.writeHead(200, { 'content-type': 'text/html', connection: 'close' });
    res.end(page('Authorization complete', 'You can close this tab and return to the terminal.'));
    settle.resolve(code);
  };

  // Listen on both loopback families: the redirect_uri names `localhost` (the host the
  // authorization server accepts) and the browser may resolve it to 127.0.0.1 or ::1.
  // The port is OS-assigned on the v4 bind, so [::1] on that same port may be taken by
  // someone else - retry with a fresh port rather than silently leaving ::1 to a stranger.
  let v4; let v6 = null;
  for (let attempt = 0; attempt < 5 && !v6; attempt++) {
    if (v4) v4.close();
    v4 = await listen(http.createServer(handler), 0, '127.0.0.1');
    v6 = await listen(http.createServer(handler), v4.address().port, '::1').catch(() => null);
  }
  if (!v6) log('note: could not bind [::1] - continuing IPv4-only (fine unless your browser resolves localhost to ::1 only)');
  const port = v4.address().port;
  const redirectUri = `http://localhost:${port}/callback`;

  const authorize = new URL(AUTHORIZE_URL);
  authorize.searchParams.set('client_id', CLIENT_ID);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', SCOPES);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('state', state);

  log('opening the browser - press "Authorize" to grant the dev stack a model credential');
  log(`if no browser opens, visit: ${authorize.href}`);
  openBrowser(authorize.href);

  const timer = setTimeout(
    () => settle.reject(new Error(`no authorization after ${Math.round(AUTH_TIMEOUT_MS / 1000)}s`)),
    AUTH_TIMEOUT_MS,
  );
  try {
    const code = await result;
    const json = await postToken({
      grant_type: 'authorization_code',
      code,
      state,
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    const cred = toCred(json);
    writeCredFile(cred);
    log(`authorized and saved to ${CRED_PATH}`);
    return cred;
  } finally {
    clearTimeout(timer);
    for (const srv of [v4, v6]) {
      if (!srv) continue;
      srv.closeAllConnections?.(); // idle keep-alive sockets would otherwise pin the event loop
      srv.close();
    }
  }
}

// ---- ensure ------------------------------------------------------------------
/**
 * Returns { mode: 'oauth', token } | { mode: 'api-key' } | null (nothing available).
 * Precedence: explicit env > drop-file (refreshed as needed) > browser authorize.
 */
export async function ensureCredential({ reauth = false, allowBrowser = true } = {}) {
  if (!reauth) {
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { mode: 'oauth', token: process.env.CLAUDE_CODE_OAUTH_TOKEN };
    if (process.env.ANTHROPIC_API_KEY) return { mode: 'api-key' };
  }

  const stored = readCredFile();
  if (!reauth && stored) {
    if (!isExpired(stored)) {
      if (typeof stored.expiresAt !== 'number') log(`using stored token from ${CRED_PATH} (no expiry recorded - if model calls fail, run: npm run dev:auth)`);
      return { mode: 'oauth', token: stored.accessToken };
    }
    if (stored.refreshToken) {
      try {
        return { mode: 'oauth', token: (await refreshCred(stored)).accessToken };
      } catch (err) {
        log(`refresh failed (${err.message}) - falling back to a fresh authorize`);
      }
    }
  }

  const interactive = process.stdout.isTTY || process.env.EKOA_FORCE_BROWSER === '1';
  if (!allowBrowser || !interactive) {
    if (stored) { log('non-interactive: using the stored token as-is'); return { mode: 'oauth', token: stored.accessToken }; }
    log('non-interactive and no stored credential - cannot mint one (run `npm run dev:auth` in a terminal)');
    return null;
  }
  try {
    return { mode: 'oauth', token: (await browserAuthorize()).accessToken };
  } catch (err) {
    log(`browser authorize failed: ${err.message}`);
    if (stored) { log('falling back to the stored token'); return { mode: 'oauth', token: stored.accessToken }; }
    return null;
  }
}

// ---- provision into the running stack ---------------------------------------
export function provisionCredential(cred) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (cred.mode === 'oauth') {
      env.CLAUDE_CODE_OAUTH_TOKEN = cred.token;
      delete env.ANTHROPIC_API_KEY; // provision script prefers oauth; keep the env unambiguous
    }
    const child = spawn('node', [join(ROOT, '.claude', 'skills', 'run-ekoa-code', 'provision-credential.mjs')], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

// ---- CLI ---------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const cred = await ensureCredential({ reauth: args.includes('--reauth'), allowBrowser: !args.includes('--no-browser') });
  if (!cred) { log('no credential available'); process.exit(1); }
  log(`credential ready (mode=${cred.mode})`);
  if (args.includes('--provision')) {
    const ok = await provisionCredential(cred);
    if (!ok) { log('provisioning FAILED - is the stack up on :4111?'); process.exit(1); }
  }
}
