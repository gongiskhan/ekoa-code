#!/usr/bin/env node
/**
 * App-user password auth — committed, re-runnable end-to-end driver.
 *
 * Proves the server-issued password-login contract for served artifacts:
 *   POST /api/app-sso/login        — verify password vs the app's own user row,
 *                                     mint the per-app session cookie.
 *   POST /api/app-sso/set-password — require a valid session; self-service for
 *                                     anyone, others only for a privileged role.
 *
 * Black-box over HTTP against the running dev cortex (backend.port). Seeds a
 * throwaway `utilizadores`-shaped collection via the open app-data API (the
 * initial bcrypt hash is computed locally with bcryptjs), then drives the two
 * routes incl. wrong-password, unknown-user, no-session, and the privilege gate.
 * Idempotent: clears its own seed rows on each run.
 *
 * Requires a running dev cortex. Run: node tests/e2e/app-auth.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
const APP_ID = 'dev-e2e-app-auth';
const COLL = 'utilizadores';
const COOKIE = `ekoa_app_sso_${APP_ID}`;

function fail(msg) { console.error(`E2E FAIL: ${msg}`); process.exit(1); }
function assert(cond, msg) { if (!cond) fail(msg); }

const H = (extra) => ({ 'Content-Type': 'application/json', 'X-Ekoa-App-Id': APP_ID, ...(extra || {}) });

async function appData(method, path, body) {
  return fetch(`${BASE}/api/app-data/${path}`, {
    method, headers: H(), ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function login(identity, password, cookie) {
  return fetch(`${BASE}/api/app-sso/login`, {
    method: 'POST',
    headers: H(cookie ? { Cookie: cookie } : undefined),
    body: JSON.stringify({ collection: COLL, identityField: 'email', identity, password }),
  });
}
async function setPassword(identity, password, cookie, collection = COLL) {
  return fetch(`${BASE}/api/app-sso/set-password`, {
    method: 'POST',
    headers: H(cookie ? { Cookie: cookie } : undefined),
    body: JSON.stringify({ collection, identityField: 'email', identity, password }),
  });
}
async function me(cookie) {
  return fetch(`${BASE}/api/app-sso/me`, { headers: H(cookie ? { Cookie: cookie } : undefined) });
}
function cookieFrom(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of raw) {
    const m = new RegExp(`(?:^|, )${COOKIE}=([^;]+)`).exec(c) || new RegExp(`${COOKIE}=([^;]+)`).exec(c);
    if (m) return `${COOKIE}=${m[1]}`;
  }
  return null;
}

async function main() {
  // sanity: cortex up
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) fail(`cortex not reachable at ${BASE}/health — start dev cortex first`);

  // 0. idempotent cleanup of any prior seed rows
  const existing = await (await appData('GET', COLL)).json().catch(() => ({ data: [] }));
  for (const r of existing.data || []) {
    if (r && (r.email === 'master@e2e.test' || r.email === 'adv@e2e.test')) {
      await appData('DELETE', `${COLL}/${r.id}`);
    }
  }

  // 1. seed two users (master with a known bcrypt hash; advogado with no password)
  const masterPw = 'master-pw-1';
  const masterHash = bcrypt.hashSync(masterPw, 10);
  const cMaster = await appData('POST', COLL, { email: 'master@e2e.test', name: 'Master E2E', role: 'master', passwordHash: masterHash });
  assert(cMaster.status === 201, `seed master -> ${cMaster.status}`);
  const cAdv = await appData('POST', COLL, { email: 'adv@e2e.test', name: 'Adv E2E', role: 'advogado' });
  assert(cAdv.status === 201, `seed advogado -> ${cAdv.status}`);

  // 2. login master OK → 200 + Set-Cookie, no passwordHash leaked
  const r2 = await login('master@e2e.test', masterPw);
  assert(r2.status === 200, `login master -> ${r2.status}`);
  const j2 = await r2.json();
  assert(j2.success && j2.data && j2.data.email === 'master@e2e.test', `login payload: ${JSON.stringify(j2)}`);
  assert(!('passwordHash' in (j2.data || {})), 'login leaked passwordHash');
  const masterCookie = cookieFrom(r2);
  assert(masterCookie, 'login did not set the session cookie');

  // 3. me() with the cookie → identity
  const r3 = await me(masterCookie);
  assert(r3.status === 200, `me -> ${r3.status}`);
  const j3 = await r3.json();
  assert(j3.data && j3.data.email === 'master@e2e.test', `me payload: ${JSON.stringify(j3)}`);
  assert(!('passwordHash' in (j3.data || {})), 'me leaked passwordHash');

  // 4. wrong password → 401
  assert((await login('master@e2e.test', 'nope')).status === 401, 'wrong password did not 401');
  // 5. unknown identity → 401
  assert((await login('ghost@e2e.test', 'whatever')).status === 401, 'unknown user did not 401');
  // 6. user with no password set → 401
  assert((await login('adv@e2e.test', 'anything')).status === 401, 'no-password user did not 401');

  // 7. set-password WITHOUT a session → 401
  assert((await setPassword('adv@e2e.test', 'adv-pw-1')).status === 401, 'set-password without session did not 401');

  // 8. master sets advogado's password → 200; advogado can then log in
  const r8 = await setPassword('adv@e2e.test', 'adv-pw-1', masterCookie);
  assert(r8.status === 200, `master set adv password -> ${r8.status}: ${await r8.text()}`);
  const r8b = await login('adv@e2e.test', 'adv-pw-1');
  assert(r8b.status === 200, `advogado login after set -> ${r8b.status}`);
  const advCookie = cookieFrom(r8b);
  assert(advCookie, 'advogado login set no cookie');

  // 9. advogado tries to set ANOTHER user's password → 403 (privilege gate)
  const r9 = await setPassword('master@e2e.test', 'hijack', advCookie);
  assert(r9.status === 403, `advogado set OTHER password -> ${r9.status} (expected 403)`);

  // 10. advogado sets their OWN password → 200 (self-service always allowed)
  const r10 = await setPassword('adv@e2e.test', 'adv-pw-2', advCookie);
  assert(r10.status === 200, `advogado self set-password -> ${r10.status}`);
  assert((await login('adv@e2e.test', 'adv-pw-2')).status === 200, 'login with self-updated password failed');
  assert((await login('adv@e2e.test', 'adv-pw-1')).status === 401, 'old password still worked after self-update');

  // 11. Escalation guard (Codex 3A finding): a non-privileged session must NOT gain
  // privilege by pointing set-password at a collection where it planted a forged
  // `role: master` row. Authorization is bound to the session's login collection.
  const PWN = 'pwn_e2e';
  await appData('POST', PWN, { email: 'adv@e2e.test', role: 'master' });      // forged caller role
  await appData('POST', PWN, { email: 'master@e2e.test', role: 'master' });   // a target in the side collection
  const esc = await setPassword('master@e2e.test', 'hijacked', advCookie, PWN);
  assert(esc.status === 403, `escalation via planted collection NOT blocked -> ${esc.status} (expected 403)`);
  // 11b. Cross-collection SELF bypass must also be blocked: a caller setting their
  // OWN email's password in a collection other than their login collection is not
  // "self" (Codex r2) — would otherwise password-enable a planted privileged row.
  const escSelf = await setPassword('adv@e2e.test', 'planted-pw', advCookie, PWN);
  assert(escSelf.status === 403, `cross-collection self set-password NOT blocked -> ${escSelf.status} (expected 403)`);
  for (const r of (await (await appData('GET', PWN)).json()).data || []) await appData('DELETE', `${PWN}/${r.id}`);

  // cleanup
  const after = await (await appData('GET', COLL)).json();
  for (const r of after.data || []) {
    if (r && (r.email === 'master@e2e.test' || r.email === 'adv@e2e.test')) await appData('DELETE', `${COLL}/${r.id}`);
  }

  console.log('E2E PASS: login (200/401), session cookie + me(), set-password session-gated + privilege gate + self-service');
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.stack || e.message : String(e)));
