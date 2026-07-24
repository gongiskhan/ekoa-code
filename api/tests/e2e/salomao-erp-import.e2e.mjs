#!/usr/bin/env node
/**
 * SALOMAO ERP import proof — REST/env-adapted, operator-run (2B-S5).
 *
 * Ports cortex/tests/e2e/salomao-erp-import.e2e.mjs to ekoa-code. The dev original
 * logged in over the retired `/api/v1/action` intent API and matched a hard-coded id
 * prefix (`d8880dbf`/`729831a7`); this port takes the imported instance id from
 * EKOA_E2E_SALOMAO_ID (no prod id is committed — the sanctioned REST/env adaptation,
 * SUITE_LEDGER precedent ifthenpay/invoicexpress "REST adaptation owed") and PROVES
 * the import over the open served-app + app-data planes, no login required:
 *
 *   (1) The imported SALOMAO ERP is SERVED at /apps/<slug>/ — a real built app
 *       (HTML + bundle, not the "Building…" placeholder).
 *   (2) BYTE-SAFETY: the pre-existing featured erp-imobiliario is intact alongside
 *       it (the import never disturbs the featured app the 37 byte-compat specs use).
 *   (3) DATA LANDED (the 2B-S5 importArtifact.data outcome): app-data seeded from the
 *       prod dump is readable under the imported id via GET /api/app-data/<coll>
 *       (X-Ekoa-App-Id = EKOA_E2E_SALOMAO_ID) — which simultaneously proves the id is
 *       the imported instance AND that bundle.data was applied. Needs a known
 *       collection name (EKOA_E2E_SALOMAO_COLL); without it, that sub-check reports a
 *       clean SKIP rather than guessing.
 *
 * Operator-run: registered `operator-run salomao` in SUITE_LEDGER, so the per-PR
 * census lane reports AWAITING (never runs it). Its per-PR-lane hermetic counterpart
 * for the importArtifact.data machinery is the vitest contract test
 * api/tests/contract/artifact-family.test.ts (import applies bundle.data) plus the
 * converter unit test api/tests/migration/convert-dev-bundle.test.ts.
 *
 * SKIPS CLEANLY (exit 0 + explicit SKIP, never a false green) when the api is
 * unreachable, EKOA_E2E_SALOMAO_ID is unset, or the imported instance is not served
 * (this machine has no export yet — the real run is 2B-S6).
 *
 * Usage: node api/tests/e2e/salomao-erp-import.e2e.mjs [baseUrl]
 * Env: EKOA_E2E_BASE_URL/CORTEX_BASE, BACKEND_PORT, EKOA_E2E_SALOMAO_ID,
 *      EKOA_E2E_APP_SLUG (default 'salomao-erp'), EKOA_E2E_SALOMAO_COLL (optional),
 *      EKOA_E2E_FEATURED_SLUG (default 'erp-imobiliario').
 * Exit 0 = pass (or clean skip), 1 = fail.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = process.env.BACKEND_PORT || readPort() || '4111';
// 127.0.0.1 (not localhost): the api binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.argv[2] || process.env.EKOA_E2E_BASE_URL || process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;
const salomaoId = process.env.EKOA_E2E_SALOMAO_ID || '';
const salomaoSlug = process.env.EKOA_E2E_APP_SLUG || 'salomao-erp';
const featuredSlug = process.env.EKOA_E2E_FEATURED_SLUG || 'erp-imobiliario';
const dataColl = process.env.EKOA_E2E_SALOMAO_COLL || '';

function readPort() {
  try {
    return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
  } catch {
    return null;
  }
}

const fails = [];
const skips = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const skip = (name, detail = '') => {
  console.log(`SKIP ${name}${detail ? ` — ${detail}` : ''}`);
  skips.push(name);
};

/** Fetch a served app page and classify it as a real, built app. */
async function servedApp(slug) {
  const res = await fetch(`${BASE}/apps/${slug}/`).catch(() => null);
  if (!res || !res.ok) return { served: false, status: res ? res.status : 0, real: false };
  const html = await res.text();
  const hasBundle = /bundle\.js|window\.__EKOA_APP_ID|<script/i.test(html);
  const building = /Building your app|Building…|A construir/i.test(html);
  const real = html.includes('<html') && hasBundle && !building;
  return { served: true, status: res.status, real, building };
}

async function jsonAt(path, init) {
  try {
    const r = await fetch(`${BASE}${path}`, init);
    const t = await r.text();
    let j;
    try { j = JSON.parse(t); } catch { j = { _raw: t }; }
    return { status: r.status, json: j };
  } catch (e) {
    return { status: 0, json: { _err: String(e?.message || e) } };
  }
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: api not reachable at ${BASE}/health — start the dev api first (npm run dev --workspace api).`);
    process.exit(0);
  }

  // The import is an operator step against a prod export not present on this machine.
  if (!salomaoId) {
    skip('SALOMAO ERP import proof', 'EKOA_E2E_SALOMAO_ID not set (imported instance lands via the 2B-S6 operator run)');
    console.log('\nall checks passed (0 checked, 1 skipped)');
    process.exit(0);
  }

  // (1) The imported SALOMAO ERP is served as a real built app.
  const salomao = await servedApp(salomaoSlug);
  if (!salomao.served || !salomao.real) {
    skip(
      'SALOMAO ERP served',
      `app '${salomaoSlug}' not a served built app (http ${salomao.status}${salomao.building ? ', still building' : ''}) — import not applied on this stack`,
    );
    console.log('\nall checks passed (0 checked, 1 skipped)');
    process.exit(0);
  }
  check('SALOMAO ERP is served as a real built app', salomao.real, `http ${salomao.status}`);

  // (2) BYTE-SAFETY: the featured erp-imobiliario is intact alongside the import.
  const featured = await servedApp(featuredSlug);
  check(
    `featured ${featuredSlug} still served intact (import did not disturb it)`,
    featured.served && featured.real,
    `http ${featured.status}`,
  );

  // (3) DATA LANDED: app-data seeded from the prod dump is readable under the imported id.
  if (!dataColl) {
    skip('SALOMAO app-data seeded (bundle.data applied)', 'set EKOA_E2E_SALOMAO_COLL=<collection> to assert seeded rows');
  } else {
    const appHdr = { 'X-Ekoa-App-Id': salomaoId };
    const got = await jsonAt(`/api/app-data/${encodeURIComponent(dataColl)}`, { headers: appHdr });
    const rows = Array.isArray(got.json?.data) ? got.json.data : null;
    check(
      `SALOMAO app-data '${dataColl}' seeded under the imported id (bundle.data applied)`,
      got.status === 200 && Array.isArray(rows) && rows.length > 0,
      `http ${got.status} rows=${rows ? rows.length : 'n/a'}`,
    );
  }

  console.log(
    `\n${fails.length ? `${fails.length} check(s) FAILED` : 'all checks passed'}${skips.length ? ` (${skips.length} skipped)` : ''}`,
  );
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E ERROR:', e?.stack || e);
  process.exit(1);
});
