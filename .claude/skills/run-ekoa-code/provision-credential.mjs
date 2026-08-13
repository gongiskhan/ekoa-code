#!/usr/bin/env node
/**
 * Provision the model credential into a RUNNING dev stack (ch06 §6.2).
 *
 * The credential lives only in the API's `credentials` store (AES-encrypted). There is no env
 * fallback: `SCRUBBED_PROVIDER_ENV` strips inherited ANTHROPIC_* from every SDK subprocess, so
 * an unconfigured stack fails every chat/build run with `ADAPTER_ERROR: No model credential
 * configured for this environment`. The dev harness boots an EPHEMERAL in-memory Mongo, so this
 * must be re-run after every stack restart.
 *
 * The secret is read from the environment and POSTed straight to the API. It is never printed,
 * never written to disk, and never passed as an argv (which would land in the process table).
 *
 *   API key:
 *     ANTHROPIC_API_KEY=sk-ant-... node .claude/skills/run-ekoa-code/provision-credential.mjs
 *
 *   OAuth token (a Claude subscription; get one with `claude setup-token`):
 *     CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat... node .claude/skills/run-ekoa-code/provision-credential.mjs
 *
 * Env overrides: EKOA_API_URL (http://localhost:4111), EKOA_ADMIN_USERNAME, EKOA_ADMIN_PASSWORD.
 */
const API = process.env.EKOA_API_URL ?? 'http://localhost:4111';
const USER = process.env.EKOA_ADMIN_USERNAME ?? 'admin';
const PASS = process.env.EKOA_ADMIN_PASSWORD ?? 'tmp12345';

const oauth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const apiKey = process.env.ANTHROPIC_API_KEY;
const mode = oauth ? 'oauth' : apiKey ? 'api-key' : null;
const secret = oauth ?? apiKey;

// Renewal material for oauth mode, read from the environment like the secret itself. The API
// can only refresh a token it was handed the means to refresh: provisioning the access token
// ALONE (what this script did until 2026-08-11) stores a credential that works until it expires
// and then fails every model run. `scripts/dev-credential.mjs` sets these from the drop-file.
const refreshToken = mode === 'oauth' ? process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN : undefined;
const expiresAtRaw = mode === 'oauth' ? process.env.CLAUDE_CODE_OAUTH_EXPIRES_AT : undefined;
const expiresAt = expiresAtRaw && Number.isFinite(Number(expiresAtRaw)) ? Number(expiresAtRaw) : undefined;

if (!mode) {
  console.error('No credential in env. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN.');
  console.error('The value is read from the environment only - never pass it as an argument.');
  process.exit(2);
}

const die = (msg) => { console.error(`[provision] ${msg}`); process.exit(1); };

const login = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: USER, password: PASS }),
}).catch((e) => die(`cannot reach ${API} - is the stack up? (${e.message})`));

if (!login.ok) {
  // A 401 here is almost always the seeded admin's password having been rotated away from the
  // dev default - the operator changed it to clear a forced-change prompt, and this script still
  // sends EKOA_ADMIN_PASSWORD (default `tmp12345`). Say so, instead of a bare status code.
  if (login.status === 401) {
    die(
      `login failed as ${USER}: 401 (wrong password).\n` +
      `  This stack's admin password is not "${PASS}". Re-run with the real one:\n` +
      `    EKOA_ADMIN_PASSWORD='<password>' node ${process.argv[1].replace(process.cwd() + '/', '')}\n` +
      `  A stack booted through scripts/dev-api.mjs seeds admin/tmp12345 and (since 2026-08-10)\n` +
      `  no longer forces a change, so a restart also restores the default.`,
    );
  }
  die(`login failed as ${USER}: ${login.status}`);
}
const { token } = await login.json();

// POST /api/v1/credentials is super-admin only; it takes effect immediately (in-memory cache).
const res = await fetch(`${API}/api/v1/credentials`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({
    mode,
    secret,
    ...(refreshToken ? { refreshToken } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) die(`credential rejected (${res.status}): ${JSON.stringify(body)}`);

// The response echoes only the health, never the secret.
console.log(`[provision] mode=${mode} accepted; claudeAuth=${JSON.stringify(body.claudeAuth ?? {})}`);
if (mode === 'oauth' && !refreshToken) {
  console.warn(
    '[provision] WARNING: no refresh token provisioned - this credential CANNOT be renewed and\n' +
    '  every model run will fail once it expires. Provision via `node scripts/dev-credential.mjs\n' +
    '  --provision`, which carries the refresh token from the drop-file.',
  );
}

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
if (health?.claudeAuth?.configured) console.log('[provision] /health confirms claudeAuth.configured=true - chat runs will reach the model.');
else die(`/health still reports claudeAuth=${JSON.stringify(health?.claudeAuth ?? {})}`);
