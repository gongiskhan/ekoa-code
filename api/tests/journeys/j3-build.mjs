#!/usr/bin/env node
/**
 * J3-build — the operator's priority journey: chat/session -> BUILD job -> served app, against the
 * CREDENTIALED Boot-B stack (REAL model calls). Phase dispatcher so the long model-triggering leg
 * (build#1 SSE, up to 20 min) runs isolated and the fast API/disk legs re-run cheaply.
 *
 *   node j3-build.mjs setup    create org BuildCo + bc-u1(builder)/bc-adm(org-admin) + a session
 *   node j3-build.mjs build1   settings verifyBuilds=false, POST /jobs (Pessoa quotes), follow SSE
 *   node j3-build.mjs served   git snapshot + github-off + served bundle capture + app-data plane
 *   node j3-build.mjs j1        served-plane deactivation half (app-data 403 ACCOUNT_DISABLED)
 *   node j3-build.mjs j5        branding half (design-tokens per-app vs neutral)
 *
 * State (non-secret ids only) rides api/tests/evidence/J3-build/state.json; each phase re-logs in
 * by the fixed dev password, so no token is ever persisted. j3b-followup.mjs imports the shared
 * helpers below for build#2.
 */
import { readFile, writeFile, mkdir, cp, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { api, login, sseCollect, evidence, EVIDENCE_ROOT, BASE, PASS, FAIL, INFO } from './_lib.mjs';

export const J = 'J3-build';
export const PW = 'tmp12345'; // fixed dev password for the BuildCo users (throwaway mem-mongo)
const STATE_FILE = join(EVIDENCE_ROOT, J, 'state.json');
const ACTIONS_LOG = join(EVIDENCE_ROOT, 'J9-billing', 'actions-log-build.json');

// ---- shared state (ids only; never a token) ------------------------------------------------
export async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, 'utf8')); } catch { return {}; }
}
export async function saveState(patch) {
  const cur = await loadState();
  const next = { ...cur, ...patch };
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(next, null, 2) + '\n');
  return next;
}

// ---- MANDATORY actions log (append every model-triggering action) --------------------------
export async function appendAction(entry) {
  await mkdir(dirname(ACTIONS_LOG), { recursive: true });
  let arr = [];
  try { arr = JSON.parse(await readFile(ACTIONS_LOG, 'utf8')); if (!Array.isArray(arr)) arr = []; } catch { arr = []; }
  arr.push({ ts: new Date().toISOString(), ...entry });
  await writeFile(ACTIONS_LOG, JSON.stringify(arr, null, 2) + '\n');
}

// ---- SSE frame compaction (text_chunk->120c, tool_event->{phase,tool}, counts per type) -----
const VERIFY_RE = /verifica[çc][aã]o|a testar/i;
export function compactFrames(frames) {
  const counts = {};
  const kept = [];
  let verifyBanner = null;
  for (const f of frames) {
    const d = f.data;
    const type = (d && typeof d === 'object' && d.type) || f.event || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
    if (!d || typeof d !== 'object') { kept.push({ event: f.event, raw: String(d).slice(0, 120) }); continue; }
    if (d.type === 'text_chunk') { kept.push({ type: 'text_chunk', text: String(d.text || '').slice(0, 120) }); continue; }
    if (d.type === 'tool_event') { kept.push({ type: 'tool_event', phase: d.phase, tool: d.tool }); continue; }
    if (d.type === 'plan_step') {
      const banner = `${d.description || ''} ${d.detail || ''}`.trim();
      if (VERIFY_RE.test(banner) && !verifyBanner) verifyBanner = banner;
      kept.push({ type: 'plan_step', status: d.status, description: d.description, detail: d.detail });
      continue;
    }
    if (d.type === 'complete') { kept.push({ type: 'complete', durationMs: d.durationMs, artifactId: d.artifactId, slug: d.slug, appUrl: d.appUrl, result: d.result }); continue; }
    if (d.type === 'error') { kept.push({ type: 'error', code: d.code, message: d.message }); continue; }
    if (d.type === 'routing') { kept.push({ type: 'routing', tier: d.tier, reason: d.reason }); continue; }
    kept.push({ type }); // ready / context_event / preview_reload
  }
  return { counts, frames: kept, verifyBanner };
}
export function isTerminal(f) {
  const d = f && f.data;
  return !!(d && typeof d === 'object' && (d.type === 'complete' || d.type === 'error'));
}
export function terminalOf(compact) {
  const last = [...compact.frames].reverse().find((f) => f.type === 'complete' || f.type === 'error');
  return last || null;
}

const BUILD1_DESC = 'Uma página simples que mostra uma citação aleatória de Fernando Pessoa a cada clique num botão. Sem backend.';

// ============================================================================================
async function phaseSetup(results) {
  const admin = await login('admin', 'tmp12345');

  // Org BuildCo (super-admin). Idempotent-ish: on non-201, find it in the list.
  let org = await api('POST', '/api/v1/orgs', { token: admin, body: { name: 'BuildCo', displayName: 'BuildCo' } });
  let orgId = org.body && org.body.id;
  if (org.status !== 201 || !orgId) {
    const list = await api('GET', '/api/v1/orgs', { token: admin });
    const found = (list.body && list.body.items || []).find((o) => o.name === 'BuildCo');
    orgId = found && found.id;
  }
  if (orgId) PASS('J3.org', `BuildCo org ${orgId}`, results);
  else return FAIL('J3.org', `could not create/find BuildCo: ${org.status} ${JSON.stringify(org.body)}`, results);

  // Users: bc-u1 (builder), bc-adm (org-admin) — both super-admin-created into BuildCo.
  const mkUser = async (username, role) => {
    const r = await api('POST', '/api/v1/users', { token: admin, body: { username, password: PW, role, orgId } });
    if (r.status === 201 && r.body && r.body.id) { PASS(`J3.user.${username}`, `${username} ${role} ${r.body.id}`, results); return r.body.id; }
    // fallback: list org users as admin
    const list = await api('GET', '/api/v1/users', { token: admin, headers: {} });
    const found = (list.body && list.body.items || []).find((u) => u.username === username);
    if (found) { INFO(`J3.user.${username}`, `${username} already existed ${found.id}`, results); return found.id; }
    FAIL(`J3.user.${username}`, `create failed ${r.status} ${JSON.stringify(r.body)}`, results);
    return null;
  };
  const u1Id = await mkUser('bc-u1', 'builder');
  const admId = await mkUser('bc-adm', 'org-admin');

  // Confirm both can log in.
  const u1 = await login('bc-u1', PW);
  const me1 = await api('GET', '/api/v1/auth/me', { token: u1 });
  if (me1.status === 200) PASS('J3.u1.login', `bc-u1 login+me role=${me1.body && me1.body.role}`, results);
  else FAIL('J3.u1.login', `bc-u1 me ${me1.status}`, results);
  const adm = await login('bc-adm', PW);
  const meA = await api('GET', '/api/v1/auth/me', { token: adm });
  if (meA.status === 200) PASS('J3.adm.login', `bc-adm login+me role=${meA.body && meA.body.role}`, results);
  else FAIL('J3.adm.login', `bc-adm me ${meA.status}`, results);

  // A session for bc-u1 to hang the build on.
  const sess = await api('POST', '/api/v1/sessions', { token: u1, body: { name: 'Pessoa build', type: 'build' } });
  const sessionId = sess.body && sess.body.id;
  if (sess.status === 201 || (sess.status === 200 && sessionId)) PASS('J3.session', `session ${sessionId}`, results);
  else FAIL('J3.session', `session create ${sess.status} ${JSON.stringify(sess.body)}`, results);

  await saveState({ orgId, u1Id, admId, sessionId });
}

// ============================================================================================
async function phaseBuild1(results) {
  const st = await loadState();
  const u1 = await login('bc-u1', PW);

  // 1) verifyBuilds = false, confirm.
  const patch = await api('PATCH', '/api/v1/settings/me', { token: u1, body: { build: { verifyBuilds: false } } });
  const conf = await api('GET', '/api/v1/settings', { token: u1 });
  const vOff = conf.body && conf.body.build && conf.body.build.verifyBuilds;
  if (patch.status === 200 && vOff === false) PASS('J3.verifyOff', `verifyBuilds=false confirmed`, results);
  else FAIL('J3.verifyOff', `patch=${patch.status} confirmed=${JSON.stringify(vOff)}`, results);

  // 2) BUILD#1 — POST /jobs, expect 202 created.
  await appendAction({ journey: J, username: 'bc-u1', action: 'build#1 POST /jobs (Pessoa quotes, verify OFF)', expectedAgentTypes: ['build', 'memory-extract'] });
  const create = await api('POST', '/api/v1/jobs', { token: u1, body: { kind: 'build', description: BUILD1_DESC, sessionId: st.sessionId, language: 'pt' } });
  const jobId = create.body && create.body.job && create.body.job.id;
  if (create.status === 202 && create.body && create.body.status === 'created' && jobId) PASS('J3.build1.create', `202 created job ${jobId}`, results);
  else { FAIL('J3.build1.create', `expected 202 created, got ${create.status} ${JSON.stringify(create.body)}`, results); await evidence(J, 'build1', { results, create: { status: create.status, body: create.body } }); return; }

  // Follow SSE to terminal (20 min). lastEventId:'0' forces full replay so no early frame is lost.
  const t0 = Date.now();
  const sse = await sseCollect(`/api/v1/jobs/${jobId}/events`, { token: u1, timeoutMs: 20 * 60 * 1000, lastEventId: '0', until: isTerminal });
  const wallSec = Math.round((Date.now() - t0) / 1000);
  const compact = compactFrames(sse.frames);
  const terminal = terminalOf(compact);

  // ASSERT: no verification banner (verify OFF).
  if (!compact.verifyBanner) PASS('J3.build1.noVerify', `no verification plan_step (verify OFF) — plan_step count=${compact.counts.plan_step || 0}`, results);
  else FAIL('J3.build1.noVerify', `unexpected verification banner with verify OFF: "${compact.verifyBanner}"`, results);

  if (terminal && terminal.type === 'complete') PASS('J3.build1.terminal', `SSE complete in ${wallSec}s, appUrl=${terminal.appUrl} slug=${terminal.slug}`, results);
  else INFO('J3.build1.terminal', `SSE terminal=${terminal ? terminal.type : 'none'} closedReason=${sse.closedReason} wall=${wallSec}s`, results);

  // Job + artifact records.
  const job = await api('GET', `/api/v1/jobs/${jobId}`, { token: u1 });
  const artifactId = (job.body && job.body.artifactId) || (terminal && terminal.artifactId);
  const slug = (job.body && job.body.slug) || (terminal && terminal.slug);
  let artifact = null;
  if (artifactId) { const a = await api('GET', `/api/v1/artifacts/${artifactId}`, { token: u1 }); artifact = { status: a.status, body: a.body }; }
  INFO('J3.build1.job', `job status=${job.body && job.body.status} artifactId=${artifactId} slug=${slug}`, results);

  await saveState({ jobId1: jobId, artifactId, slug, appUrl: terminal && terminal.appUrl, build1WallSec: wallSec });
  await evidence(J, 'build1', {
    results,
    create: { status: create.status, body: create.body },
    wallSec,
    frameCounts: compact.counts,
    frames: compact.frames,
    terminal,
    job: { status: job.status, body: job.body },
    artifact,
  });
}

// ============================================================================================
async function phaseServed(results) {
  const st = await loadState();
  const u1 = await login('bc-u1', PW);
  const slug = st.slug;
  const bundleDir = join(EVIDENCE_ROOT, J, 'bundle');
  await mkdir(bundleDir, { recursive: true });
  const detail = {};

  // 3) Locate projectDir via the artifact files endpoint; git snapshot.
  let projectDir = null;
  if (st.artifactId) {
    const files = await api('GET', `/api/v1/artifacts/${st.artifactId}/files`, { token: u1 });
    projectDir = files.body && files.body.projectDir;
    detail.filesEndpoint = { status: files.status, projectDir, fileCount: (files.body && files.body.files || []).length };
  }
  if (!projectDir) {
    // fallback: newest sandbox dir for bc-u1
    try {
      const base = join(process.env.HOME, '.ekoa', 'sandboxes', `user-${st.u1Id}`);
      if (existsSync(base)) {
        const kids = (await readdir(base)).map((n) => join(base, n));
        let newest = null; let mtime = 0;
        for (const k of kids) { const s = await stat(k).catch(() => null); if (s && s.isDirectory() && s.mtimeMs > mtime) { mtime = s.mtimeMs; newest = k; } }
        projectDir = newest;
      }
    } catch { /* ignore */ }
    detail.projectDirFallback = projectDir;
  }

  const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000 }).trim(); } catch (e) { return `ERR: ${e && e.message ? e.message.slice(0, 200) : e}`; } };
  if (projectDir && existsSync(projectDir)) {
    detail.gitLog = sh('git', ['-C', projectDir, 'log', '--oneline', '-5']);
    detail.ls = sh('ls', ['-1', projectDir]);
    detail.lsDist = sh('bash', ['-c', `ls -1 '${projectDir}/dist' 2>/dev/null | head -20`]);
    // 4) GitHub honest-off: expect NO remote.
    detail.gitRemote = sh('git', ['-C', projectDir, 'remote', '-v']);
    const remoteEmpty = !detail.gitRemote || detail.gitRemote === '' || detail.gitRemote.startsWith('ERR');
    if (remoteEmpty) PASS('J3.github.off', `no git remote configured (honest GitHub-off)`, results);
    else INFO('J3.github.off', `git remote present: ${detail.gitRemote.slice(0, 120)}`, results);
    // source tree + main component
    detail.sourceTree = sh('bash', ['-c', `cd '${projectDir}' && find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -60`]);
    // copy candidate main source files into bundle/
    const srcCandidates = sh('bash', ['-c', `cd '${projectDir}' && ls src/*.jsx src/*.tsx src/*.js src/*.ts src/App.* index.html app.js main.js 2>/dev/null | head -8`]).split('\n').filter((s) => s && !s.startsWith('ERR'));
    for (const rel of srcCandidates) {
      try { await cp(join(projectDir, rel), join(bundleDir, 'src__' + rel.replace(/[/\\]/g, '__'))); } catch { /* ignore */ }
    }
    detail.copiedSource = srcCandidates;
  } else {
    INFO('J3.github.off', `projectDir not found on disk (projectDir=${projectDir})`, results);
    detail.projectDirMissing = projectDir;
  }
  await saveState({ projectDir });

  // 5) Served bundle. anon + ?token= status, headers (CSP), save index.html + main JS bundle + tree.
  const anon = await api('GET', `/apps/${slug}/`, {});
  const owner = await api('GET', `/apps/${slug}/?token=${u1}`, {});
  detail.serve = {
    anon: { status: anon.status, contentType: anon.contentType },
    owner: { status: owner.status, contentType: owner.contentType },
    headers: anon.status === 200 ? anon.headers : owner.headers,
  };
  const servedHtml = anon.status === 200 ? anon.text : owner.text;
  if (servedHtml && servedHtml.length) {
    await writeFile(join(bundleDir, 'served-index.html'), servedHtml);
    // extract main JS bundle asset(s)
    const assets = [...servedHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    detail.assets = assets;
    let mainJs = assets.find((a) => /assets\/|bundle|index|main/.test(a)) || assets[0];
    if (mainJs) {
      const assetPath = mainJs.startsWith('http') ? new URL(mainJs).pathname + (new URL(mainJs).search || '') : mainJs;
      const full = mainJs.startsWith('http') ? mainJs : `/apps/${slug}/${mainJs.replace(/^\.?\//, '')}`;
      const jsRes = await api('GET', full.startsWith('http') ? assetPath : full, {});
      if (jsRes.status === 200 && jsRes.text) { await writeFile(join(bundleDir, 'main-bundle.js'), jsRes.text); detail.mainJs = { url: full, status: jsRes.status, bytes: jsRes.text.length }; }
      else detail.mainJs = { url: full, status: jsRes.status, note: 'fetch non-200' };
    }
  }
  const serveOk = anon.status === 200 || owner.status === 200;
  if (serveOk) PASS('J3.serve', `anon=${anon.status} owner=${owner.status} (sharing default)`, results);
  else INFO('J3.serve', `served page anon=${anon.status} owner=${owner.status}`, results);
  // CSP header note
  const csp = detail.serve.headers && (detail.serve.headers['content-security-policy'] || detail.serve.headers['content-security-policy-report-only']);
  INFO('J3.serve.csp', csp ? `CSP present (${String(csp).slice(0, 80)}...)` : `no CSP header on /apps/${slug}/`, results);

  // 7) app-data plane: POST then GET (header-scoped, no JWT).
  const post = await api('POST', '/api/app-data/probe-notes', { headers: { 'x-ekoa-app-id': slug, 'content-type': 'application/json' }, body: { nota: 'probe' } });
  const get = await api('GET', '/api/app-data/probe-notes', { headers: { 'x-ekoa-app-id': slug } });
  detail.appData = { post: { status: post.status, body: post.body }, get: { status: get.status, body: get.body } };
  const created = post.status === 201 && post.body && post.body.success === true;
  if (created) PASS('J3.appdata.post', `POST probe-notes -> 201 {success:true}`, results);
  else FAIL('J3.appdata.post', `expected 201 success, got ${post.status} ${JSON.stringify(post.body)}`, results);
  const readBack = get.status === 200 && get.body && get.body.success === true;
  const rows = readBack && (get.body.data ? (Array.isArray(get.body.data) ? get.body.data : [get.body.data]) : []);
  if (readBack && rows.length >= 1 && rows.some((r) => r && r.nota === 'probe')) PASS('J3.appdata.get', `GET probe-notes -> row with nota=probe (${rows.length} row/s)`, results);
  else INFO('J3.appdata.get', `GET probe-notes -> ${get.status} ${JSON.stringify(get.body).slice(0, 200)}`, results);

  await evidence(J, 'served', { results, slug, projectDir, detail });
}

// ============================================================================================
async function phaseJ1(results) {
  const st = await loadState();
  const admin = await login('admin', 'tmp12345');
  const slug = st.slug;

  // deactivate bc-u1
  const off = await api('PATCH', `/api/v1/users/${st.u1Id}`, { token: admin, body: { active: false } });
  INFO('J1s.deactivate', `PATCH bc-u1 active:false -> ${off.status}`, results);

  // app-data GET with X-Ekoa-App-Id -> 403 ACCOUNT_DISABLED (owner-activation admission plane)
  const g = await api('GET', '/api/app-data/probe-notes', { headers: { 'x-ekoa-app-id': slug } });
  const code = g.body && g.body.error && g.body.error.code;
  if (g.status === 403 && code === 'ACCOUNT_DISABLED') PASS('J1s.appdata403', `disabled owner -> 403 ACCOUNT_DISABLED`, results);
  else FAIL('J1s.appdata403', `expected 403 ACCOUNT_DISABLED, got ${g.status} code=${code} ${JSON.stringify(g.body).slice(0, 160)}`, results);

  // anon served page while owner disabled
  const anon = await api('GET', `/apps/${slug}/`, {});
  INFO('J1s.servedAnon', `anon /apps/${slug}/ while owner disabled -> ${anon.status} ${anon.contentType}`, results);

  // reactivate
  const on = await api('PATCH', `/api/v1/users/${st.u1Id}`, { token: admin, body: { active: true } });
  if (on.status === 200) PASS('J1s.reactivate', `bc-u1 reactivated`, results);
  else FAIL('J1s.reactivate', `reactivate ${on.status}`, results);

  await evidence('J1-auth', 'j1-served-plane', { results, slug, appData403: { status: g.status, body: g.body }, servedAnon: { status: anon.status, contentType: anon.contentType } });
}

// ============================================================================================
async function phaseJ5(results) {
  const st = await loadState();
  const adm = await login('bc-adm', PW);
  const slug = st.slug;
  const dir = join(EVIDENCE_ROOT, 'J5-isolation');
  await mkdir(dir, { recursive: true });

  // PUT branding (REAL mount is /api/v1/org/branding, per Boot-A; /api/v1/branding 404s)
  const put = await api('PUT', '/api/v1/org/branding', { token: adm, body: { branding: { primaryColor: '#AB2244' } } });
  if (put.status === 200) PASS('J5b.put', `PUT /org/branding primaryColor=#AB2244 -> 200`, results);
  else FAIL('J5b.put', `branding PUT -> ${put.status} ${JSON.stringify(put.body).slice(0, 160)}`, results);

  const withApp = await api('GET', `/api/design-tokens.css?app=${slug}`, {});
  const neutral = await api('GET', `/api/design-tokens.css`, {});
  const pick = (css) => { const m = /--color-primary:\s*([^;]+);/.exec(css || ''); return m && m[1].trim(); };
  const appColor = pick(withApp.text);
  const neutralColor = pick(neutral.text);
  if (appColor && appColor.toUpperCase() === '#AB2244') PASS('J5b.appToken', `design-tokens?app=${slug} --color-primary=${appColor}`, results);
  else FAIL('J5b.appToken', `expected #AB2244, got ${appColor}`, results);
  if (neutralColor && neutralColor.toUpperCase() === '#0F766E') PASS('J5b.neutral', `design-tokens (no app) --color-primary=${neutralColor} (neutral)`, results);
  else FAIL('J5b.neutral', `expected neutral #0F766E, got ${neutralColor}`, results);

  await writeFile(join(dir, 'design-tokens-app.css'), (withApp.text || '').split('\n').slice(0, 40).join('\n') + '\n');
  await writeFile(join(dir, 'design-tokens-neutral.css'), (neutral.text || '').split('\n').slice(0, 40).join('\n') + '\n');
  await evidence('J5-isolation', 'j5-branding-half', { results, slug, put: { status: put.status }, appColor, neutralColor });
}

// ============================================================================================
async function main() {
  const phase = process.argv[2];
  const results = [];
  const phases = { setup: phaseSetup, build1: phaseBuild1, served: phaseServed, j1: phaseJ1, j5: phaseJ5 };
  const fn = phases[phase];
  if (!fn) { console.error(`usage: j3-build.mjs <${Object.keys(phases).join('|')}>`); process.exit(2); }
  console.log(`=== J3-build phase=${phase} base=${BASE} ===`);
  await fn(results);
  console.log(`=== phase=${phase} done: ${results.filter((r) => r.kind === 'PASS').length} PASS, ${results.filter((r) => r.kind === 'FAIL').length} FAIL ===`);
}

// Only auto-run when invoked directly (j3b-followup imports helpers from this module).
if (process.argv[1] && process.argv[1].endsWith('j3-build.mjs')) {
  main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
}
