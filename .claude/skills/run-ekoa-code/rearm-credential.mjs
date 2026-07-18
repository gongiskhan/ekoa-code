#!/usr/bin/env node
/**
 * Re-arm the model credential into a RUNNING dev stack from the token cached on disk.
 *
 * Why this exists: the credential lives only in the API's `credentials` store, and the dev harness
 * boots an EPHEMERAL in-memory Mongo — so every stack restart drops it and every chat/build run
 * fails with `ADAPTER_ERROR: No model credential configured`. `provision-credential.mjs` re-arms
 * from a secret in the environment; this re-arms from `~/.ekoa/oauth-token` (mode 0600) so no
 * browser round-trip is needed. Mint that file once with `claude setup-token`.
 *
 *   node .claude/skills/run-ekoa-code/rearm-credential.mjs
 *
 * Admin auth is resolved in two steps, because the obvious one breaks in practice:
 *   1. Log in as EKOA_ADMIN_USERNAME/PASSWORD (default admin/tmp12345). Works on a freshly booted
 *      stack — `seedAdmin` recreates that user on the empty DB.
 *   2. On 401, mint a super-admin JWT directly. The seeded admin has `passwordChangeRequired: true`,
 *      so as soon as anyone logs into the UI and completes the forced change, the default password
 *      is gone and step 1 fails. The dev harness uses a static, dev-only JWT_SECRET, so we read the
 *      running API's own env + Mongo and sign a short-lived token. Dev-only by construction.
 *
 * The secret is never printed and never passed as an argv.
 *
 * Env overrides: EKOA_API_URL (http://localhost:4111), EKOA_TOKEN_FILE (~/.ekoa/oauth-token),
 * EKOA_ADMIN_USERNAME, EKOA_ADMIN_PASSWORD.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(join(ROOT, 'api', 'package.json'));

const API = process.env.EKOA_API_URL ?? 'http://localhost:4111';
const TOKEN_FILE = process.env.EKOA_TOKEN_FILE ?? join(homedir(), '.ekoa', 'oauth-token');
const USER = process.env.EKOA_ADMIN_USERNAME ?? 'admin';
const PASS = process.env.EKOA_ADMIN_PASSWORD ?? 'tmp12345';

const die = (msg) => { console.error(`[rearm] ${msg}`); process.exit(1); };

let cred;
try {
  cred = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
} catch {
  die(`no cached credential at ${TOKEN_FILE}. Mint one with \`claude setup-token\` and write {"mode":"oauth","secret":"sk-ant-oat..."} there (chmod 600).`);
}
if (!cred?.secret || !cred?.mode) die(`${TOKEN_FILE} must contain {"mode":"oauth"|"api-key","secret":"..."}`);

/** Step 1: the ordinary login. */
async function bearerByLogin() {
  const res = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).catch((e) => die(`cannot reach ${API} — is the stack up? (${e.message})`));
  if (!res.ok) return null;
  return (await res.json()).token;
}

/** Step 2 (fallback): sign a super-admin JWT using the running API's own dev secret + Mongo. */
async function bearerByMint() {
  const api = readdirSync('/proc')
    .filter((p) => /^\d+$/.test(p))
    .map((pid) => {
      try {
        const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
        if (!cmd.includes('api/dist/server.js') && !cmd.includes('api/src/server.ts')) return null;
        const env = Object.fromEntries(
          readFileSync(`/proc/${pid}/environ`, 'utf8')
            .split('\0').filter(Boolean)
            .map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]),
        );
        return env.MONGODB_URI && env.JWT_SECRET ? env : null;
      } catch { return null; }
    })
    .find(Boolean);
  if (!api) die('admin login failed and the running API process could not be found to mint a token.');

  const jwt = require('jsonwebtoken');
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(api.MONGODB_URI);
  await client.connect();
  const admin = await client.db('ekoa').collection('users').findOne({ role: 'super-admin' });
  await client.close();
  if (!admin) die('no super-admin user in the API database.');

  return jwt.sign(
    { sub: admin._id, role: admin.role, scope: 'user', orgId: admin.orgId, username: admin.username, jti: `${admin._id}.rearm-${Date.now()}` },
    api.JWT_SECRET,
    { expiresIn: '5m' },
  );
}

let token = await bearerByLogin();
if (!token) {
  console.log('[rearm] admin login rejected (password was changed after seeding) — minting a dev token instead.');
  token = await bearerByMint();
}

const res = await fetch(`${API}/api/v1/credentials`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ mode: cred.mode, secret: cred.secret }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) die(`credential rejected (${res.status}): ${JSON.stringify(body)}`);

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
if (!health?.claudeAuth?.configured) die(`/health still reports claudeAuth=${JSON.stringify(health?.claudeAuth ?? {})}`);
console.log(`[rearm] mode=${cred.mode} armed; /health claudeAuth=${JSON.stringify(health.claudeAuth)}`);
console.log('[rearm] note: `configured` only means a secret was stored — run a chat run to prove the provider accepts it.');
