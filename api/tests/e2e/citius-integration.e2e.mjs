#!/usr/bin/env node
/**
 * CITIUS / eTribunal — committed, re-runnable E2E (skill-registration + action-shape proof).
 *
 * Proves, against a RUNNING dev cortex, that the versioned CITIUS integration:
 *   1. is loaded into the integration registry (refresh-registry),
 *   2. exposes the four portal actions bound to automations (automationBinding
 *      present, passCredentials true; submeter_peca mutates, fetch_documentos_processo
 *      reads), plus the notification listenerConfig, and
 *   3. exposes the credential-free public consulta action (httpConfig GET, no
 *      auth header), with authType 'none'.
 *
 * Why the action-shape proof (not a live public-consulta run): the legacy
 * `ekoa.integrations execute` intent returns decrypted config for the agent
 * layer and needs a connected config id; the httpConfig path would hit the live
 * www.citius.mj.pt WebForms portal, which is non-deterministic (and the portal
 * needs no session, but its availability/HTML is not stable enough for a gate).
 * So this driver asserts the loaded skill's action shapes are correct, and the
 * ACTUAL public-consulta parse (against a saved fixture, fetchImpl injected) is
 * proven deterministically by the vitest suite tests/services/citius-etribunal.test.ts.
 *
 * The four portal actions genuinely need a REAL lawyer session at the §8
 * checkpoint (certificate / Chave Móvel Digital captured once), plus the connect
 * flow (citius-connect.ts provisionCitiusAutomations) that materializes their
 * automations — until then they resolve to unknown_automation. That is the honest
 * pre-checkpoint state; this E2E does not fake a session or a portal.
 *
 * Auth: login admin/tmp12345 via the ekoa.auth action API for a JWT.
 * Run: node cortex/tests/e2e/citius-integration.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
// 127.0.0.1 (not localhost): cortex binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;

const CITIUS_KEY = 'citius';

function fail(m) { console.error(`E2E FAIL: ${m}`); process.exitCode = 1; throw new Error('__ASSERT__'); }
function assert(c, m) { if (!c) fail(m); }
function ok(m) { console.log(`  PASS: ${m}`); }
function note(m) { console.log(`  NOTE: ${m}`); }

let TOKEN = null;
async function action(app, intent, params = {}) {
  const r = await fetch(`${BASE}/api/v1/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify({ app, intent, params, request_id: randomUUID() }),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t, _status: r.status }; }
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: cortex not reachable at ${BASE}/health — start the dev cortex first.`);
    process.exit(0);
  }

  // ---- Login --------------------------------------------------------------
  const login = await action('ekoa.auth', 'login', { username: 'admin', password: 'tmp12345', rememberMe: true });
  TOKEN = login?.data?.token;
  assert(TOKEN, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
  ok('logged in (JWT acquired)');

  // ---- Load the versioned skill into the registry -------------------------
  const refreshed = await action('ekoa.integrations', 'refresh-registry', {});
  const keys = refreshed?.data?.skills || [];
  assert(keys.includes(CITIUS_KEY),
    `citius skill not loaded after refresh-registry; keys=${JSON.stringify(keys).slice(0, 400)}`);
  ok(`citius integration skill loaded into the registry`);

  // ---- Fetch the loaded skill + assert its action shapes ------------------
  const listed = await action('ekoa.integrations', 'list-skills', {});
  const skills = Array.isArray(listed?.data) ? listed.data : [];
  const citius = skills.find((s) => s.integrationKey === CITIUS_KEY);
  assert(citius, `citius skill not visible via list-skills`);
  ok(`citius skill visible via list-skills (displayName="${citius.displayName}")`);

  // authType is the honest 'none' — no stored password; session captured interactively.
  assert(citius.authType === 'none',
    `expected authType 'none' (session-capture model), got '${citius.authType}'`);
  ok(`authType is 'none' (session-capture, no stored credential field)`);

  const byName = Object.fromEntries((citius.actions || []).map((a) => [a.actionName, a]));

  // The four portal actions bind to automations (automationBinding + passCredentials).
  for (const name of ['consultar_notificacoes', 'consultar_processo', 'fetch_documentos_processo', 'submeter_peca']) {
    const a = byName[name];
    assert(a, `missing portal action "${name}"`);
    assert(a.automationBinding && typeof a.automationBinding.automationId === 'string' && a.automationBinding.automationId,
      `action "${name}" is not automation-backed (no automationBinding.automationId)`);
    assert(a.automationBinding.passCredentials === true,
      `action "${name}" must pass the captured session (passCredentials=true)`);
    assert(!a.httpConfig, `automation-backed action "${name}" must not carry an httpConfig`);
  }
  ok('consultar_notificacoes / consultar_processo / fetch_documentos_processo / submeter_peca are automationBinding + passCredentials');

  // The flagship: fetch_documentos_processo binds to the documentos template and is a read.
  assert(byName['fetch_documentos_processo'].automationBinding.automationId === 'citius-documentos-template',
    'fetch_documentos_processo must bind to the documentos template marker');
  assert(byName['fetch_documentos_processo'].mutates === false, 'fetch_documentos_processo must be mutates:false');
  ok('fetch_documentos_processo bound to citius-documentos-template (mutates:false)');

  assert(byName['submeter_peca'].mutates === true, 'submeter_peca must be marked mutates:true');
  assert(byName['consultar_notificacoes'].mutates === false, 'consultar_notificacoes must be mutates:false');
  ok('submeter_peca mutates:true; consultas mutates:false');

  // The notification listener: the skill declares a listenerConfig (poll = consultar_notificacoes).
  assert(citius.listenerConfig && citius.listenerConfig.pollAction === 'consultar_notificacoes',
    `citius must declare a listenerConfig polling consultar_notificacoes; got ${JSON.stringify(citius.listenerConfig)}`);
  assert(citius.listenerConfig.dedupKeyField === 'id' && citius.listenerConfig.eventArrayField === 'notificacoes',
    'listenerConfig must dedup by id over the notificacoes array');
  ok('citius declares a notification listenerConfig (poll consultar_notificacoes, dedup by id)');

  // The public consulta is executor-native + credential-free (httpConfig GET, no auth header).
  const pub = byName['consulta_publica_distribuicao'];
  assert(pub, 'missing consulta_publica_distribuicao action');
  assert(pub.httpConfig && pub.httpConfig.method === 'GET', 'consulta_publica_distribuicao must be an httpConfig GET');
  assert(!pub.automationBinding, 'public consulta must not be automation-backed (no session needed)');
  const authHeaderNames = Object.keys(pub.httpConfig.headers || {}).map((h) => h.toLowerCase());
  assert(!authHeaderNames.includes('authorization'),
    'public consulta must carry no Authorization header (no auth)');
  assert(/citius\.mj\.pt/.test(pub.httpConfig.baseUrl || ''),
    `public consulta must target the citius.mj.pt public portal, got baseUrl='${pub.httpConfig.baseUrl}'`);
  ok('consulta_publica_distribuicao is a credential-free httpConfig GET against citius.mj.pt');

  // Config schema fields are non-secret (no stored password); credentialGuide present.
  const secretFields = (citius.configSchema || []).filter((f) => f.secret);
  assert(secretFields.length === 0,
    `citius config must hold no secret fields (session is captured, not stored); found: ${secretFields.map((f) => f.key).join(', ')}`);
  assert(typeof citius.credentialGuide === 'string' && /sess/i.test(citius.credentialGuide),
    'credentialGuide must explain the session-capture flow');
  ok('configSchema holds no secrets; credentialGuide explains session capture');

  note('public-consulta parse is proven deterministically by tests/services/citius-etribunal.test.ts (fixture + injected fetch)');
  note('§8 checkpoint: the four portal actions need a REAL lawyer session (certificate / Chave Móvel Digital) + the connect flow (provisionCitiusAutomations) that materializes their automations');
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: CITIUS integration loaded; portal actions automation-backed (session), public consulta credential-free.');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
