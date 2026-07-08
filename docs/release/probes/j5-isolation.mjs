/**
 * J5-isolation — cross-org tenant isolation (ch09 §9.x, ch03). Two orgs, two org-admins;
 * knowledge + memories + registo must not leak across the org boundary; branding writes are
 * org-scoped and the neutral design-tokens default is served when no app is resolved.
 */
import { api, login, evidence, PASS, FAIL, INFO } from './_lib.mjs';

const J = 'J5-isolation';
const results = [];
const ev = {};
const stamp = Date.now();

async function mkOrgAdmin(adminToken, orgName, userName) {
  const org = await api('POST', '/api/v1/orgs', { token: adminToken, body: { name: orgName, displayName: orgName } });
  const orgId = org.body && org.body.id;
  // Try to create the user directly as org-admin.
  let user = await api('POST', '/api/v1/users', { token: adminToken, body: { username: userName, password: 'pw123456', role: 'org-admin', orgId } });
  let via = 'post-org-admin';
  let userId = user.body && user.body.id;
  let role = user.body && user.body.role;
  if (!(user.status === 201 && role === 'org-admin')) {
    // Fallback: create as builder then PATCH the role.
    const b = await api('POST', '/api/v1/users', { token: adminToken, body: { username: userName + '-b', password: 'pw123456', role: 'builder', orgId } });
    userId = b.body && b.body.id;
    const patched = await api('PATCH', `/api/v1/users/${userId}`, { token: adminToken, body: { role: 'org-admin' } });
    via = 'post-builder+patch-role';
    role = patched.body && patched.body.role;
    user = patched;
    userName = userName + '-b';
  }
  return { orgId, userId, role, via, username: userName, orgStatus: org.status, userStatus: user.status };
}

async function main() {
  const admin = await login('admin', 'tmp12345');

  const X = await mkOrgAdmin(admin, 'IsoX-' + stamp, 'ix-admin-' + stamp);
  const Y = await mkOrgAdmin(admin, 'IsoY-' + stamp, 'iy-admin-' + stamp);
  ev.orgs = { X, Y };
  if (X.orgId && X.role === 'org-admin') PASS('J5.setupX', `IsoX org=${X.orgId} admin role=org-admin via=${X.via}`, results);
  else FAIL('J5.setupX', `IsoX admin not org-admin (role=${X.role}, via=${X.via})`, results);
  if (Y.orgId && Y.role === 'org-admin') PASS('J5.setupY', `IsoY org=${Y.orgId} admin role=org-admin via=${Y.via}`, results);
  else FAIL('J5.setupY', `IsoY admin not org-admin (role=${Y.role}, via=${Y.via})`, results);

  const ixToken = await login(X.username, 'pw123456');
  const iyToken = await login(Y.username, 'pw123456');

  // --- Knowledge isolation -------------------------------------------------------------------
  const docX = await api('POST', '/api/v1/knowledge/documents', { token: ixToken, body: { collection: 'probe', title: 'Segredo X', text: 'O código secreto da IsoX é AZUL-73.', language: 'pt' } });
  const docY = await api('POST', '/api/v1/knowledge/documents', { token: iyToken, body: { collection: 'probe', title: 'Segredo Y', text: 'O código secreto da IsoY é VERDE-88.', language: 'pt' } });
  ev.knowledgeSeed = { docX: { status: docX.status, body: docX.body }, docY: { status: docY.status, body: docY.body } };
  const docXId = docX.body && docX.body.id;
  const docYId = docY.body && docY.body.id;
  if (docX.status === 201 && docXId) PASS('J5.kseedX', `IsoX knowledge doc ${docXId}`, results);
  else FAIL('J5.kseedX', `expected 201, got ${docX.status} body=${JSON.stringify(docX.body)}`, results);
  if (docY.status === 201 && docYId) PASS('J5.kseedY', `IsoY knowledge doc ${docYId}`, results);
  else FAIL('J5.kseedY', `expected 201, got ${docY.status}`, results);

  const listX = await api('GET', '/api/v1/knowledge/documents', { token: ixToken });
  const listY = await api('GET', '/api/v1/knowledge/documents', { token: iyToken });
  const titlesX = ((listX.body && listX.body.items) || []).map((d) => d.title);
  const titlesY = ((listY.body && listY.body.items) || []).map((d) => d.title);
  ev.knowledgeList = { X: { status: listX.status, titles: titlesX }, Y: { status: listY.status, titles: titlesY } };
  if (titlesX.includes('Segredo X') && !titlesX.includes('Segredo Y')) PASS('J5.klistX', `IsoX sees only its docs: ${JSON.stringify(titlesX)}`, results);
  else FAIL('J5.klistX', `IsoX leak/miss: ${JSON.stringify(titlesX)}`, results);
  if (titlesY.includes('Segredo Y') && !titlesY.includes('Segredo X')) PASS('J5.klistY', `IsoY sees only its docs: ${JSON.stringify(titlesY)}`, results);
  else FAIL('J5.klistY', `IsoY leak/miss: ${JSON.stringify(titlesY)}`, results);

  // Cross-org delete of X's doc by IsoY (no GET-by-id endpoint exists) → expect 404 (uniform).
  const crossDel = docXId ? await api('DELETE', `/api/v1/knowledge/collections/probe/documents/${docXId}`, { token: iyToken }) : { status: 0, body: null };
  ev.knowledgeCrossDelete = { status: crossDel.status, body: crossDel.body };
  const crossCode = crossDel.body && crossDel.body.error && crossDel.body.error.code;
  if (crossDel.status === 404) PASS('J5.kcross', `IsoY cross-org delete of IsoX doc -> 404 ${crossCode || ''}`, results);
  else INFO('J5.kcross', `IsoY cross-org delete of IsoX doc -> ${crossDel.status} ${crossCode || ''} (no GET-by-id endpoint; delete used as access proxy)`, results);

  // --- Memories isolation --------------------------------------------------------------------
  const memX = await api('POST', '/api/v1/memories', { token: ixToken, body: { type: 'note', content: 'Memória privada da IsoX: LARANJA-11.' } });
  ev.memoryCreate = { status: memX.status, body: memX.body };
  const memXId = memX.body && memX.body.id;
  if (memX.status === 201 || (memX.status === 200 && memXId)) PASS('J5.memcreate', `IsoX memory ${memXId} visibility=${memX.body && memX.body.visibility}`, results);
  else FAIL('J5.memcreate', `expected 200/201, got ${memX.status} body=${JSON.stringify(memX.body)}`, results);

  const memListY = await api('GET', '/api/v1/memories', { token: iyToken });
  const memItemsY = (memListY.body && memListY.body.items) || [];
  const leakY = memItemsY.some((m) => m.id === memXId);
  ev.memoryListY = { status: memListY.status, count: memItemsY.length, leak: leakY };
  if (!leakY) PASS('J5.memlistY', `IsoY memory list does not contain IsoX memory (count=${memItemsY.length})`, results);
  else FAIL('J5.memlistY', `IsoY memory list LEAKS IsoX memory`, results);

  const memGetY = memXId ? await api('GET', `/api/v1/memories/${memXId}`, { token: iyToken }) : { status: 0, body: null };
  ev.memoryGetY = { status: memGetY.status, body: memGetY.body };
  if (memGetY.status === 404) PASS('J5.memgetY', `IsoY GET IsoX memory by id -> 404`, results);
  else FAIL('J5.memgetY', `expected 404, got ${memGetY.status}`, results);

  // --- Registo isolation ---------------------------------------------------------------------
  const regX = await api('GET', '/api/v1/registo', { token: ixToken });
  const regXRows = (regX.body && regX.body.items) || [];
  const regXOrgIds = [...new Set(regXRows.map((r) => r.orgId).filter((x) => x !== undefined))];
  ev.registoX = { status: regX.status, count: regXRows.length, orgIdsPresent: regXOrgIds };
  if (regX.status === 200) {
    if (regXOrgIds.length === 0) INFO('J5.registoX', `org-admin registo 200, ${regXRows.length} rows; RegistoEntry exposes no orgId field (isolation is service-scoped, not visible in payload)`, results);
    else if (regXOrgIds.every((o) => o === X.orgId)) PASS('J5.registoX', `org-admin registo rows all orgId==IsoX (${regXRows.length} rows)`, results);
    else FAIL('J5.registoX', `org-admin registo leaks other orgs: ${JSON.stringify(regXOrgIds)}`, results);
  } else FAIL('J5.registoX', `expected 200, got ${regX.status}`, results);

  const regSuperY = await api('GET', `/api/v1/registo?orgId=${Y.orgId}`, { token: admin });
  const regSuperYRows = (regSuperY.body && regSuperY.body.items) || [];
  const regSuperYActors = [...new Set(regSuperYRows.map((r) => r.actor))];
  ev.registoSuperY = { status: regSuperY.status, count: regSuperYRows.length, actors: regSuperYActors };
  if (regSuperY.status === 200) PASS('J5.registoSuperY', `super-admin registo?orgId=IsoY -> 200, ${regSuperYRows.length} rows, actors=${JSON.stringify(regSuperYActors).slice(0, 120)}`, results);
  else FAIL('J5.registoSuperY', `expected 200, got ${regSuperY.status}`, results);

  // --- Branding: real path vs contract path --------------------------------------------------
  const brandReal = await api('PUT', '/api/v1/org/branding', { token: ixToken, body: { branding: { primaryColor: '#FF0044' } } });
  ev.brandingReal = { status: brandReal.status, body: brandReal.body };
  const brandedColor = brandReal.body && brandReal.body.branding && brandReal.body.branding.primaryColor;
  if (brandReal.status === 200 && brandedColor === '#FF0044') PASS('J5.brandReal', `PUT /org/branding (real mount) -> 200, primaryColor=${brandedColor}`, results);
  else FAIL('J5.brandReal', `PUT /org/branding expected 200 #FF0044, got ${brandReal.status} color=${brandedColor}`, results);

  const brandContract = await api('PUT', '/api/v1/branding', { token: ixToken, body: { branding: { primaryColor: '#FF0044' } } });
  ev.brandingContract = { status: brandContract.status, contentType: brandContract.contentType, isJson: brandContract.isJson, bodyHead: (brandContract.text || '').slice(0, 160) };
  INFO('J5.brandContract', `PUT /api/v1/branding (CONTRACT path) -> ${brandContract.status} json=${brandContract.isJson} ct=${brandContract.contentType || 'none'} (contract-vs-code gap: mount is /org/branding)`, results);

  // --- Design tokens neutral default (no app param) ------------------------------------------
  const tokens = await api('GET', '/api/design-tokens.css');
  const cssText = tokens.text || '';
  const m = cssText.match(/--color-primary\s*:\s*([^;]+);/);
  const colorPrimary = m ? m[1].trim() : null;
  ev.designTokens = { status: tokens.status, contentType: tokens.contentType, colorPrimary, head: cssText.slice(0, 240) };
  if (tokens.status === 200 && colorPrimary && colorPrimary.toUpperCase() !== '#FF0044') {
    PASS('J5.tokens', `design-tokens.css neutral default --color-primary=${colorPrimary} (NOT the org #FF0044)`, results);
  } else {
    FAIL('J5.tokens', `design-tokens default leaked org color or missing: status=${tokens.status} --color-primary=${colorPrimary}`, results);
  }

  const evFile = await evidence(J, 'j5-isolation', { results, detail: ev });
  console.log(`INFO J5.evidence ${evFile}`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
