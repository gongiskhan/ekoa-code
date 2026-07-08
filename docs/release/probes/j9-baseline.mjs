/**
 * J9-billing — the pre-model-call metering baseline (ch06). Captures billing usage + history for
 * the super-admin and a fresh probe user, plus the health metering counters, so Boot B can do the
 * post-call arithmetic (every model call is metered; no unmetered gateway calls).
 */
import { api, login, evidence, PASS, FAIL, INFO } from './_lib.mjs';

const J = 'J9-billing';
const results = [];
const ev = {};
const stamp = Date.now();

async function main() {
  const admin = await login('admin', 'tmp12345');

  // A fresh probe user (own org) for a clean per-user baseline.
  const org = await api('POST', '/api/v1/orgs', { token: admin, body: { name: 'BillBase-' + stamp, displayName: 'BillBase' } });
  const orgId = org.body && org.body.id;
  const uname = 'bill-u1-' + stamp;
  const user = await api('POST', '/api/v1/users', { token: admin, body: { username: uname, password: 'pw123456', role: 'builder', orgId } });
  const userToken = user.status === 201 ? await login(uname, 'pw123456') : null;
  ev.setup = { orgStatus: org.status, userStatus: user.status, userId: user.body && user.body.id };

  // Admin baseline
  const adminUsage = await api('GET', '/api/v1/billing/usage', { token: admin });
  const adminHistory = await api('GET', '/api/v1/billing/history', { token: admin });
  ev.adminBilling = { usage: { status: adminUsage.status, body: adminUsage.body }, history: { status: adminHistory.status, body: adminHistory.body } };
  const au = adminUsage.body || {};
  if (adminUsage.status === 200) PASS('J9.adminUsage', `admin usage tokensUsed=${au.tokensUsed} balanceUsd=${au.balanceUsd} tokenLimit=${au.tokenLimit} overage=${au.overageEnabled}`, results);
  else FAIL('J9.adminUsage', `expected 200, got ${adminUsage.status}`, results);
  INFO('J9.adminHistory', `admin history -> ${adminHistory.status}, ${((adminHistory.body && adminHistory.body.items) || []).length} entries`, results);

  // Probe-user baseline
  const userUsage = userToken ? await api('GET', '/api/v1/billing/usage', { token: userToken }) : { status: 0, body: null };
  const userHistory = userToken ? await api('GET', '/api/v1/billing/history', { token: userToken }) : { status: 0, body: null };
  ev.userBilling = { usage: { status: userUsage.status, body: userUsage.body }, history: { status: userHistory.status, body: userHistory.body } };
  const uu = userUsage.body || {};
  if (userUsage.status === 200 && uu.tokensUsed === 0) PASS('J9.userUsage', `probe user usage zero-state tokensUsed=0 balanceUsd=${uu.balanceUsd} tokenLimit=${uu.tokenLimit}`, results);
  else INFO('J9.userUsage', `probe user usage -> ${userUsage.status} tokensUsed=${uu.tokensUsed}`, results);
  INFO('J9.userHistory', `probe user history -> ${userHistory.status}, ${((userHistory.body && userHistory.body.items) || []).length} entries`, results);

  // Health metering counters
  const health = await api('GET', '/health');
  ev.health = { status: health.status, body: health.body };
  const hb = health.body || {};
  if (health.status === 200 && hb.meteringAnomalies === 0 && hb.gatewayUnmeteredCalls === 0) {
    PASS('J9.metering', `baseline meteringAnomalies=0 gatewayUnmeteredCalls=0 (clean)`, results);
  } else {
    INFO('J9.metering', `meteringAnomalies=${hb.meteringAnomalies} gatewayUnmeteredCalls=${hb.gatewayUnmeteredCalls} (recorded)`, results);
  }

  const evFile = await evidence(J, 'j9-billing', { results, detail: ev });
  console.log(`INFO J9.evidence ${evFile}`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
