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

if (!login.ok) die(`login failed as ${USER}: ${login.status}`);
const { token } = await login.json();

// POST /api/v1/credentials is super-admin only; it takes effect immediately (in-memory cache).
const res = await fetch(`${API}/api/v1/credentials`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ mode, secret }),
});

const body = await res.json().catch(() => ({}));
if (!res.ok) die(`credential rejected (${res.status}): ${JSON.stringify(body)}`);

// The response echoes only the health, never the secret.
console.log(`[provision] mode=${mode} accepted; claudeAuth=${JSON.stringify(body.claudeAuth ?? {})}`);

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
if (health?.claudeAuth?.configured) console.log('[provision] /health confirms claudeAuth.configured=true - chat runs will reach the model.');
else die(`/health still reports claudeAuth=${JSON.stringify(health?.claudeAuth ?? {})}`);
