/**
 * J1-auth — authentication lifecycle & admission plane probes (ch03 §3.2, ch09 §9.7).
 * Records the real behaviour of login/me/refresh/logout, the deactivation admission plane
 * (REST + SSE), and the contract-declared-but-maybe-unmounted auth surfaces.
 */
import { api, login, sseCollect, evidence, PASS, FAIL, INFO } from './_lib.mjs';

const J = 'J1-auth';
const results = [];
const ev = {};

async function main() {
  // (a) login admin → me 200
  const adminLogin = await api('POST', '/api/v1/auth/login', { body: { username: 'admin', password: 'tmp12345' } });
  ev.login = { status: adminLogin.status, isJson: adminLogin.isJson, body: adminLogin.body };
  const token = adminLogin.body && adminLogin.body.token;
  if (adminLogin.status === 200 && token) PASS('J1a.login', 'admin login 200 with token', results);
  else FAIL('J1a.login', `expected 200+token, got ${adminLogin.status}`, results);

  const me = await api('GET', '/api/v1/auth/me', { token });
  ev.me = { status: me.status, body: me.body };
  if (me.status === 200 && me.body && me.body.username === 'admin') PASS('J1a.me', `me 200 role=${me.body.role} orgId=${me.body.orgId}`, results);
  else FAIL('J1a.me', `expected 200, got ${me.status}`, results);

  // (b) refresh — contract declares POST /auth/refresh 200; record actual
  const refresh = await api('POST', '/api/v1/auth/refresh', { token });
  ev.refresh = { status: refresh.status, contentType: refresh.contentType, bodyHead: (refresh.text || '').slice(0, 160), isJson: refresh.isJson };
  INFO('J1b.refresh', `POST /auth/refresh -> ${refresh.status} ct=${refresh.contentType || 'none'} json=${refresh.isJson} head="${(refresh.text || '').slice(0, 60).replace(/\n/g, ' ')}"`, results);

  // (c) logout, then re-check the SAME token (revocation present?)
  const logout = await api('POST', '/api/v1/auth/logout', { token, body: {} });
  ev.logout = { status: logout.status, contentType: logout.contentType, body: logout.body, bodyHead: (logout.text || '').slice(0, 160) };
  INFO('J1c.logout', `POST /auth/logout -> ${logout.status} json=${logout.isJson} body=${JSON.stringify(logout.body) || (logout.text || '').slice(0, 60)}`, results);
  const meAfterLogout = await api('GET', '/api/v1/auth/me', { token });
  ev.meAfterLogout = { status: meAfterLogout.status, body: meAfterLogout.body };
  if (meAfterLogout.status === 200) INFO('J1c.revocation', `token STILL VALID after logout (me -> 200) — no server-side revocation on logout`, results);
  else INFO('J1c.revocation', `token invalidated after logout (me -> ${meAfterLogout.status})`, results);

  // (d) bad-cred + garbage bearer → 401 envelope UNAUTHENTICATED
  const badCred = await api('POST', '/api/v1/auth/login', { body: { username: 'admin', password: 'wrong-nope' } });
  ev.badCred = { status: badCred.status, body: badCred.body };
  const badCredCode = badCred.body && badCred.body.error && badCred.body.error.code;
  if (badCred.status === 401 && badCredCode === 'UNAUTHENTICATED') PASS('J1d.badcred', `bad login -> 401 ${badCredCode}`, results);
  else FAIL('J1d.badcred', `expected 401 UNAUTHENTICATED, got ${badCred.status} ${badCredCode}`, results);

  const garbage = await api('GET', '/api/v1/auth/me', { headers: { authorization: 'Bearer not-a-real-jwt' } });
  ev.garbageBearer = { status: garbage.status, body: garbage.body };
  const garbageCode = garbage.body && garbage.body.error && garbage.body.error.code;
  const garbageEnvelopeOk = garbage.body && garbage.body.error && typeof garbage.body.error.code === 'string' && typeof garbage.body.error.message === 'string';
  if (garbage.status === 401 && garbageEnvelopeOk) PASS('J1d.garbage', `garbage bearer -> 401 ${garbageCode} (valid envelope)`, results);
  else FAIL('J1d.garbage', `expected 401 envelope, got ${garbage.status} envelope=${garbageEnvelopeOk}`, results);

  // (e) create org ProbeA + builder pa-u1 in it; login pa-u1; me OK
  const orgA = await api('POST', '/api/v1/orgs', { token, body: { name: 'ProbeA', displayName: 'Probe A' } });
  ev.orgCreate = { status: orgA.status, body: orgA.body };
  const orgAId = orgA.body && orgA.body.id;
  if (orgA.status === 201 && orgAId) PASS('J1e.org', `created org ProbeA id=${orgAId}`, results);
  else FAIL('J1e.org', `expected 201, got ${orgA.status}`, results);

  const uname = 'pa-u1-' + Date.now();
  const userCreate = await api('POST', '/api/v1/users', { token, body: { username: uname, password: 'pw123456', role: 'builder', orgId: orgAId } });
  ev.userCreate = { status: userCreate.status, body: userCreate.body };
  const userId = userCreate.body && userCreate.body.id;
  if (userCreate.status === 201 && userId) PASS('J1e.user', `created builder ${uname} id=${userId} role=${userCreate.body.role}`, results);
  else FAIL('J1e.user', `expected 201, got ${userCreate.status} body=${JSON.stringify(userCreate.body)}`, results);

  const paToken = userCreate.status === 201 ? await login(uname, 'pw123456') : null;
  const paMe = paToken ? await api('GET', '/api/v1/auth/me', { token: paToken }) : { status: 0 };
  ev.paMe = { status: paMe.status, body: paMe.body };
  if (paMe.status === 200) PASS('J1e.paLogin', `pa-u1 login+me 200`, results);
  else FAIL('J1e.paLogin', `expected 200, got ${paMe.status}`, results);

  // (f) deactivate pa-u1, then probe REST + SSE + me with the (now stale) token
  const deactivate = await api('PATCH', `/api/v1/users/${userId}`, { token, body: { active: false } });
  ev.deactivate = { status: deactivate.status, body: deactivate.body };
  INFO('J1f.deactivate', `PATCH active:false -> ${deactivate.status} active=${deactivate.body && deactivate.body.active}`, results);

  const paSessions = paToken ? await api('GET', '/api/v1/sessions', { token: paToken }) : { status: 0, body: null };
  ev.paSessionsDisabled = { status: paSessions.status, body: paSessions.body };
  const psCode = paSessions.body && paSessions.body.error && paSessions.body.error.code;
  const psMsg = (paSessions.body && paSessions.body.error && paSessions.body.error.message) || '';
  if (paSessions.status === 403 && psCode === 'ACCOUNT_DISABLED' && /bloqueada/i.test(psMsg)) {
    PASS('J1f.rest', `REST GET /sessions (disabled) -> 403 ACCOUNT_DISABLED, msg contains 'bloqueada'`, results);
  } else {
    FAIL('J1f.rest', `expected 403 ACCOUNT_DISABLED+'bloqueada', got ${paSessions.status} ${psCode} msg="${psMsg}"`, results);
  }

  const paSse = paToken ? await sseCollect('/api/v1/notifications/events', { token: paToken, timeoutMs: 6000 }) : { ok: false, status: 0 };
  ev.paSseDisabled = { ok: paSse.ok, status: paSse.status, closedReason: paSse.closedReason, errorBody: paSse.errorBody, frames: paSse.frames };
  const sseCode = paSse.errorBody && paSse.errorBody.error && paSse.errorBody.error.code;
  if (paSse.status === 403 && sseCode === 'ACCOUNT_DISABLED') {
    PASS('J1f.sse', `SSE notifications (disabled) -> 403 ACCOUNT_DISABLED msg="${(paSse.errorBody.error.message || '')}"`, results);
  } else {
    FAIL('J1f.sse', `expected 403 ACCOUNT_DISABLED, got status=${paSse.status} code=${sseCode} reason=${paSse.closedReason}`, results);
  }

  const paMeDisabled = paToken ? await api('GET', '/api/v1/auth/me', { token: paToken }) : { status: 0, body: null };
  ev.paMeDisabled = { status: paMeDisabled.status, body: paMeDisabled.body };
  const meDisCode = paMeDisabled.body && paMeDisabled.body.error && paMeDisabled.body.error.code;
  INFO('J1f.me', `/auth/me with disabled-user token -> ${paMeDisabled.status} ${meDisCode || ''} (brief expected 401; activation check runs before epoch)`, results);

  // (g) reactivate; fresh login works
  const reactivate = await api('PATCH', `/api/v1/users/${userId}`, { token, body: { active: true } });
  ev.reactivate = { status: reactivate.status, body: reactivate.body };
  let freshOk = false;
  if (reactivate.status === 200) {
    try {
      const freshToken = await login(uname, 'pw123456');
      const freshMe = await api('GET', '/api/v1/auth/me', { token: freshToken });
      freshOk = freshMe.status === 200;
      ev.reactivatedMe = { status: freshMe.status, body: freshMe.body };
    } catch (e) {
      ev.reactivatedMe = { error: String(e.message || e) };
    }
  }
  if (freshOk) PASS('J1g.reactivate', `reactivated -> fresh login+me 200`, results);
  else FAIL('J1g.reactivate', `reactivate/fresh-login failed (reactivate=${reactivate.status})`, results);

  // (h) contract-declared auth endpoints: password change + device start
  const pwChange = await api('POST', '/api/v1/auth/password', { token, body: { currentPassword: 'tmp12345', newPassword: 'tmp12345x' } });
  ev.passwordChange = { status: pwChange.status, contentType: pwChange.contentType, isJson: pwChange.isJson, bodyHead: (pwChange.text || '').slice(0, 160) };
  INFO('J1h.password', `POST /auth/password -> ${pwChange.status} json=${pwChange.isJson} ct=${pwChange.contentType || 'none'}`, results);
  // restore the admin password if it actually changed
  if (pwChange.status >= 200 && pwChange.status < 300) {
    await api('POST', '/api/v1/auth/password', { token, body: { currentPassword: 'tmp12345x', newPassword: 'tmp12345' } });
    ev.passwordRestored = true;
  }

  const device = await api('POST', '/api/v1/auth/device', { body: {} });
  ev.deviceStart = { status: device.status, contentType: device.contentType, isJson: device.isJson, bodyHead: (device.text || '').slice(0, 160) };
  INFO('J1h.device', `POST /auth/device -> ${device.status} json=${device.isJson} ct=${device.contentType || 'none'}`, results);

  // (i) super-admin password reset for another user
  const reset = userId ? await api('POST', `/api/v1/users/${userId}/password`, { token, body: { newPassword: 'pw999999' } }) : { status: 0 };
  ev.userPasswordReset = { status: reset.status, contentType: reset.contentType, isJson: reset.isJson, bodyHead: (reset.text || '').slice(0, 160) };
  INFO('J1i.userpw', `POST /users/:id/password -> ${reset.status} json=${reset.isJson} ct=${reset.contentType || 'none'} head="${(reset.text || '').slice(0, 60).replace(/\n/g, ' ')}"`, results);

  const evFile = await evidence(J, 'j1-auth', { results, detail: ev });
  console.log(`INFO J1.evidence ${evFile}`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
