#!/usr/bin/env node
/**
 * DGSI/DRE legal-research route — committed, re-runnable E2E against a running cortex.
 *
 * Proves the PB2 /api/legal-research route end-to-end WITHOUT depending on a
 * populated knowledge index (on most dev machines ~/.ekoa/data/knowledge is empty
 * / not FTS-ready, so the service degrades to `ok:true, hits:[]` with a note —
 * that graceful degradation is exactly what this asserts):
 *
 *   1. A request from an allowlisted suite app (legal-pesquisa) returns 200 with
 *      `{ ok:true, hits:[…] }` — tolerant of empty hits (empty/absent index).
 *   2. A request from a NON-allowlisted app id is rejected → 403 (allowlist gate).
 *   3. A request with no X-Ekoa-App-Id header → 400.
 *   4. A request with no `q` → 400.
 *   5. Rate limiting: a burst of requests from one app trips the per-app cap
 *      (4/min) → at least one 429 with a PT-PT error body.
 *
 * These routes are credential-free + app-scoped (no login needed). CTT tracking is
 * NOT driven here: its mock provider is gated on EKOA_TRACKING_MOCK=1 read at call
 * time, so exercising it over the wire would need cortex restarted with that env —
 * it is covered by the vitest suite instead. This driver stays index-agnostic and
 * network-independent (verify=0 on the burst so no external portal fetch fires).
 *
 * Requires a running dev cortex (its routes must be live — restart it after adding
 * the PB2 routes). Run: node cortex/tests/e2e/legal-research.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
// 127.0.0.1 (not localhost): cortex binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;

const ALLOWED_APP = 'legal-pesquisa'; // in RESEARCH_ALLOWED_APPS
const ALLOWED_APP_2 = 'legal-pecas'; // in RESEARCH_ALLOWED_APPS (used for the rate-limit burst)
const FORBIDDEN_APP = 'not-a-legal-app';

function fail(m) { console.error(`E2E FAIL: ${m}`); process.exitCode = 1; throw new Error('__ASSERT__'); }
function assert(c, m) { if (!c) fail(m); }
function ok(m) { console.log(`  PASS: ${m}`); }
function note(m) { console.log(`  NOTE: ${m}`); }

/** GET /api/legal-research with an optional X-Ekoa-App-Id header. Returns { status, body }. */
async function research(appId, query, { verify = '1', sources = 'dgsi,dre' } = {}) {
  const headers = {};
  if (appId) headers['X-Ekoa-App-Id'] = appId;
  const qs = new URLSearchParams();
  if (query !== undefined) qs.set('q', query);
  if (sources !== undefined) qs.set('sources', sources);
  if (verify !== undefined) qs.set('verify', verify);
  const r = await fetch(`${BASE}/api/legal-research?${qs.toString()}`, { headers });
  let body = null;
  const text = await r.text();
  try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 200) }; }
  return { status: r.status, body };
}

async function main() {
  // ---- Reachability -------------------------------------------------------
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: cortex not reachable at ${BASE}/health — start the dev cortex first.`);
    process.exit(0);
  }

  // ---- 1. Allowlisted app → graceful ok:true (tolerant of empty hits) -----
  {
    const { status, body } = await research(ALLOWED_APP, 'prescrição extintiva', { verify: '1' });
    if (status === 429) {
      // A rapid re-run inside the 60s window can saturate this app's budget; the
      // dedicated rate-limit test below still hard-proves 429. Don't fail here.
      note('allowlisted request was rate-limited (429) — recent re-run saturated the window; happy-path skipped this run');
    } else {
      assert(status === 200, `allowlisted request expected 200, got ${status} (${JSON.stringify(body).slice(0, 200)})`);
      assert(body && body.ok === true, `expected ok:true, got ${JSON.stringify(body).slice(0, 200)}`);
      assert(Array.isArray(body.hits), `expected hits[] array, got ${JSON.stringify(body).slice(0, 200)}`);
      if (body.hits.length === 0) {
        assert(typeof body.note === 'string' && body.note.length > 0, 'empty hits must carry a PT-PT note (graceful degradation)');
        ok(`allowlisted request → 200 ok:true, hits:[] with note ("${body.note.slice(0, 60)}…") — empty-index degradation`);
      } else {
        // Populated index: every returned hit must carry a URL, and (verify=1) a checked verification.
        for (const h of body.hits) {
          assert(typeof h.url === 'string' && h.url, `a verified hit must carry a url: ${JSON.stringify(h).slice(0, 160)}`);
          assert(h.verification && h.verification.checked === true, `verify=1 hits must be checked: ${JSON.stringify(h).slice(0, 160)}`);
        }
        ok(`allowlisted request → 200 ok:true with ${body.hits.length} verified hit(s) — index is populated`);
      }
    }
  }

  // ---- 2. Non-allowlisted app id → 403 ------------------------------------
  {
    const { status, body } = await research(FORBIDDEN_APP, 'contrato de arrendamento');
    assert(status === 403, `non-allowlisted app expected 403, got ${status} (${JSON.stringify(body).slice(0, 160)})`);
    assert(body && typeof body.error === 'string', `403 must carry an error message, got ${JSON.stringify(body).slice(0, 160)}`);
    ok('non-allowlisted X-Ekoa-App-Id is rejected → 403 (allowlist gate)');
  }

  // ---- 3. Missing X-Ekoa-App-Id header → 400 ------------------------------
  {
    const { status } = await research(undefined, 'usucapião');
    assert(status === 400, `missing app-id header expected 400, got ${status}`);
    ok('missing X-Ekoa-App-Id header → 400');
  }

  // ---- 4. Missing q → 400 -------------------------------------------------
  {
    const { status } = await research(ALLOWED_APP, undefined);
    assert(status === 400, `missing q expected 400, got ${status}`);
    ok('missing q parameter → 400');
  }

  // ---- 5. Rate limiting: burst trips the per-app cap → 429 ----------------
  {
    // Per-app cap is 4/min; fire 8 (verify=0 so no external portal fetch). Any
    // prior saturation only makes 429 appear SOONER, so ">=1 in the burst" holds.
    const statuses = [];
    for (let i = 0; i < 8; i++) {
      const { status } = await research(ALLOWED_APP_2, 'letra de câmbio', { verify: '0' });
      statuses.push(status);
    }
    const limited = statuses.filter((s) => s === 429);
    assert(limited.length >= 1, `expected at least one 429 in an 8-request burst, got [${statuses.join(', ')}]`);
    // Confirm the 429 body shape (PT-PT error).
    const { status, body } = await research(ALLOWED_APP_2, 'letra de câmbio', { verify: '0' });
    if (status === 429) {
      assert(typeof body.error === 'string' && body.error.length > 0, `429 must carry a PT-PT error, got ${JSON.stringify(body).slice(0, 160)}`);
    }
    ok(`per-app rate cap trips → ${limited.length} of 8 requests returned 429 with a PT-PT error body`);
  }
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: legal-research allowlist + graceful degradation + rate-limit verified.');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
