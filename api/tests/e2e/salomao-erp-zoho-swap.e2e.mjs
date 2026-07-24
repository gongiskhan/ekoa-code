#!/usr/bin/env node
/**
 * SALOMAO ERP e-signature swap — Adobe -> Zoho (2B-S4), REST-adapted, operator-run.
 *
 * Ports cortex/tests/e2e/salomao-erp-zoho-swap.e2e.mjs to ekoa-code. The dev original
 * hard-coded the imported app id; this port takes it from EKOA_E2E_APP_ID /
 * EKOA_E2E_SALOMAO_ID (the sanctioned REST/env adaptation — no prod id is committed) and
 * splits the proof into two layers so the swap is PROVABLE before the SALOMAO instance
 * import (2B-S5) lands:
 *
 *   (1) PLATFORM SWAP — provable against a bare running api, no imported instance:
 *       the /api/zoho-sign proxy + the pluggable /api/signature/send facade are MOUNTED
 *       (their own app-context gate answers 400, NOT the terminal 404 of an unmounted
 *       path), and so is the Adobe router. This is the BSM target-state wiring: Zoho is
 *       the live provider on the platform.
 *   (2) ERP-INSTANCE SWAP — the served SALOMAO bundle signs via Zoho and NEVER Adobe, and
 *       the /api/zoho-sign proxy drives a real create->submit->embedded-URL flow for the
 *       ERP owner. Needs the locally imported prod instance (2B-S5) + a connected
 *       zoho-sign config; each half SKIPs cleanly (never a false green) when its
 *       precondition is absent. Adobe stays facade-only for that owner (connected:false).
 *
 * Operator-run: registered at `operator-run salomao` in SUITE_LEDGER, so the per-PR census
 * lane reports it AWAITING (never runs it), and the 2B-S6 verification run drives it against
 * the credentialed live stack with EKOA_E2E_APP_ID set.
 *
 * Usage: node api/tests/e2e/salomao-erp-zoho-swap.e2e.mjs [baseUrl]
 * Env: EKOA_E2E_BASE_URL/CORTEX_BASE, BACKEND_PORT, EKOA_E2E_APP_ID|EKOA_E2E_SALOMAO_ID,
 *      EKOA_E2E_APP_SLUG (default 'salomao-erp').
 * Exit 0 = pass (or clean skip), 1 = fail.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = process.env.BACKEND_PORT || readPort() || '4111';
// 127.0.0.1 (not localhost): the api binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.argv[2] || process.env.EKOA_E2E_BASE_URL || process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;
const appId = process.env.EKOA_E2E_APP_ID || process.env.EKOA_E2E_SALOMAO_ID || '';
const appSlug = process.env.EKOA_E2E_APP_SLUG || 'salomao-erp';

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

async function jsonAt(path, init) {
  try {
    const r = await fetch(`${BASE}${path}`, init);
    const t = await r.text();
    let j;
    try {
      j = JSON.parse(t);
    } catch {
      j = { _raw: t };
    }
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

  // (1) PLATFORM SWAP — the swap wiring is present on the platform regardless of the ERP import.
  const zStatus = await jsonAt('/api/zoho-sign/status');
  check(
    '/api/zoho-sign router is MOUNTED (its gate answers 400, not an unmounted 404)',
    zStatus.status === 400,
    `status=${zStatus.status} body=${JSON.stringify(zStatus.json).slice(0, 120)}`,
  );
  const aStatus = await jsonAt('/api/adobe-sign/status');
  check('/api/adobe-sign router is MOUNTED (its gate answers 400)', aStatus.status === 400, `status=${aStatus.status}`);
  const sig = await jsonAt('/api/signature/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('/api/signature/send facade is MOUNTED (gate 400 without an app header)', sig.status === 400, `status=${sig.status}`);

  // (2) ERP-INSTANCE SWAP — the served SALOMAO bundle signs via Zoho, never Adobe.
  const page = await fetch(`${BASE}/apps/${appSlug}/`).catch(() => null);
  if (!page || !page.ok) {
    skip('ERP bundle Adobe->Zoho swap', `app '${appSlug}' not served (imported instance lands in 2B-S5)`);
  } else {
    const html = await page.text();
    const m = html.match(/src="\.?\/?(bundle\.js)"/) || ['', 'bundle.js'];
    const bundle = await (await fetch(`${BASE}/apps/${appSlug}/${m[1]}`)).text();
    check('ERP app serves a bundle', html.includes('<html') && bundle.length > 1000, `bundle ${bundle.length}B`);
    check('bundle calls /api/zoho-sign', bundle.includes('/api/zoho-sign'));
    check('bundle no longer calls /api/adobe-sign', !bundle.includes('/api/adobe-sign'));
  }

  // (3) PROXY FLOW — the /api/zoho-sign proxy drives a real Zoho signature flow for the owner.
  if (!appId) {
    skip('zoho proxy create->submit flow', 'no EKOA_E2E_APP_ID/EKOA_E2E_SALOMAO_ID (imported instance id) set');
  } else {
    const appHdr = { 'X-Ekoa-App-Id': appId };
    const adobe = (await jsonAt('/api/adobe-sign/status', { headers: appHdr })).json;
    check('Adobe stays facade-only for the ERP owner (connected:false)', adobe.connected === false, JSON.stringify(adobe).slice(0, 120));
    const status = (await jsonAt('/api/zoho-sign/status', { headers: appHdr })).json;
    if (!status.connected) {
      skip('zoho proxy create->submit flow', `ERP owner has no connected zoho-sign config (status: ${JSON.stringify(status).slice(0, 120)})`);
    } else {
      check('zoho-sign connected for the ERP owner', status.connected === true);
      const send = (
        await jsonAt('/api/zoho-sign/send', {
          method: 'POST',
          headers: { ...appHdr, 'content-type': 'application/json' },
          body: JSON.stringify({
            documentName: 'E2E Proposta',
            html: '<html><body><h1>Proposta</h1><p>Assinatura via Zoho Sign.</p></body></html>',
            recipients: [{ email: 'cliente@example.com', name: 'Cliente E2E', embedded: true }],
            externalRef: { propostaId: 'e2e', clientEmail: 'cliente@example.com' },
          }),
        })
      ).json;
      check('proxy send creates + submits a request', send.success === true && !!send.requestId, `id=${send.requestId} status=${send.status}`);
      check('embedded signing URL minted', Array.isArray(send.signingUrls) && !!send.signingUrls[0]?.signUrl, JSON.stringify(send.signingUrls).slice(0, 160));
      if (send.requestId) {
        const got = (await jsonAt(`/api/zoho-sign/requests/${send.requestId}`, { headers: appHdr })).json;
        check('request is retrievable + in progress', ['inprogress', 'draft'].includes(got.request?.request_status), got.request?.request_status);
      }
    }
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
