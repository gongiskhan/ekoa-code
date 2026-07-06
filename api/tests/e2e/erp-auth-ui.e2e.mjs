#!/usr/bin/env node
/**
 * ERP auth UI — committed, re-runnable end-to-end driver (served artifact).
 *
 * Drives the Brasil Salomão ERP served at /apps/<id>/ through the new auth:
 *   1. Router gate — a signed-out visit to an internal route (#/clientes) renders
 *      the login screen, NOT the internal screen.
 *   2. Password login — valid email+password enters the app (lands on the
 *      requested/dashboard route) with no console errors.
 *   3. Wrong password — shows an inline error and stays on login.
 *
 * Seeds a throwaway provisioned user (bcrypt hash via bcryptjs) into the app's
 * own `utilizadores` collection over the open app-data API, then removes it.
 * APP_ID defaults to the local ERP sandbox id; override with ERP_APP_ID.
 *
 * Requires a running dev cortex serving the (rebuilt) artifact.
 * Run: node tests/e2e/erp-auth-ui.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
// Adapted for the rebuild (test-audit 5.1, helper-level only): the old default was a
// machine-local fork UUID; the deterministic target is the seeded featured app id.
const APP_ID = process.env.ERP_APP_ID || 'erp-imobiliario';
const COLL = 'utilizadores';
const TEST_EMAIL = 'e2e.login@brasilsalomao.pt';
const TEST_PW = 'e2e-pw-123456';

function fail(msg) { console.error(`E2E FAIL: ${msg}`); process.exit(1); }
function assert(c, m) { if (!c) fail(m); }
const H = { 'Content-Type': 'application/json', 'X-Ekoa-App-Id': APP_ID };

async function listUsers() { return (await (await fetch(`${BASE}/api/app-data/${COLL}`, { headers: H })).json()).data || []; }
async function delUser(id) { await fetch(`${BASE}/api/app-data/${COLL}/${id}`, { method: 'DELETE', headers: H }); }

async function cleanup() {
  for (const r of await listUsers()) if (r && r.email === TEST_EMAIL) await delUser(r.id);
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) fail(`cortex not reachable at ${BASE}/health`);

  await cleanup();
  // seed a provisioned master with a known password
  const seed = await fetch(`${BASE}/api/app-data/${COLL}`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ email: TEST_EMAIL, name: 'E2E Login', role: 'master', area: '—', dept: '—', initials: 'EL', color: '#1d7fa8', estado: 'Ativo', passwordHash: bcrypt.hashSync(TEST_PW, 10) }),
  });
  assert(seed.status === 201, `seed user -> ${seed.status}`);

  const browser = await chromium.launch();
  const errors = [];
  // The app probes whoami() (/api/app-sso/me) on load; a signed-out probe and the
  // intentional wrong-password attempt return 401, which the browser logs as a
  // benign "Failed to load resource: 401". That is expected — only flag real JS
  // errors (uncaught exceptions) and non-401 console errors.
  const wire = (page) => {
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/Failed to load resource.*\b401\b/.test(t)) return;
      errors.push(t);
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && e.message) || e)));
  };
  try {
    // 1. Router gate: signed-out internal route → login form, not the internal screen.
    const ctx1 = await browser.newContext();
    const p1 = await ctx1.newPage();
    wire(p1);
    await p1.goto(`${BASE}/apps/${APP_ID}/#/clientes`, { waitUntil: 'load' });
    await p1.waitForSelector('input[type=email]', { timeout: 15000 }).catch(() => fail('gate: login email field never appeared on #/clientes'));
    const sawClientes = await p1.locator('text=Carteira de clientes').count().catch(() => 0);
    assert(sawClientes === 0, 'gate: internal Clientes screen rendered while signed out');
    await ctx1.close();

    // 2. Password login from /login → enters the app (dashboard).
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    wire(p2);
    await p2.goto(`${BASE}/apps/${APP_ID}/#/login`, { waitUntil: 'load' });
    await p2.waitForSelector('input[type=email]', { timeout: 15000 });
    await p2.fill('input[type=email]', TEST_EMAIL);
    await p2.fill('input[type=password]', TEST_PW);
    await p2.click('button:has-text("Entrar")');
    await p2.waitForFunction(() => location.hash.includes('/dashboard'), { timeout: 15000 })
      .catch(() => fail('login: did not navigate to /dashboard after valid credentials'));
    const stillLogin = await p2.locator('input[type=password]').count();
    assert(stillLogin === 0, 'login: password field still present after successful login');
    await ctx2.close();

    // 3. Wrong password → inline error, stays on login.
    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    wire(p3);
    await p3.goto(`${BASE}/apps/${APP_ID}/#/login`, { waitUntil: 'load' });
    await p3.waitForSelector('input[type=email]', { timeout: 15000 });
    await p3.fill('input[type=email]', TEST_EMAIL);
    await p3.fill('input[type=password]', 'wrong-password');
    await p3.click('button:has-text("Entrar")');
    await p3.waitForSelector('[role=alert]', { timeout: 10000 }).catch(() => fail('wrong-pw: no error alert shown'));
    const onLogin = await p3.locator('input[type=password]').count();
    assert(onLogin > 0, 'wrong-pw: should stay on login form');
    await ctx3.close();

    assert(errors.length === 0, `console errors during flow:\n${errors.join('\n')}`);
    console.log('E2E PASS: router gate blocks signed-out internal route; password login enters; wrong password errors; no console errors');
  } finally {
    await browser.close();
    await cleanup();
  }
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.stack || e.message : String(e)));
