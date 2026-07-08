/**
 * J0-contract-sweep — the systematic contract-vs-code inventory. Enumerates EVERY endpoint
 * declared in shared/src/*.ts descriptor maps and determines MOUNTED vs NOT using only harmless
 * requests: GET/SSE read; non-GET send an intentionally-invalid `{}` body; DELETE hit an
 * obviously-nonexistent id; all :params → 'zzz-nonexistent-probe'. A mounted route answers with
 * a JSON envelope/body (or an event-stream); an unmounted one falls through to Express HTML.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { api, login, evidence, bodyKind, BASE, REPO_ROOT, INFO } from './_lib.mjs';

const J = 'J0-contract-sweep';
const SHARED_SRC = join(REPO_ROOT, 'shared', 'src');
const PARAM = 'zzz-nonexistent-probe';

/** Parse every endpoint descriptor from the shared/src domain files. */
async function enumerateEndpoints() {
  const files = (await readdir(SHARED_SRC)).filter((f) => f.endsWith('.ts'));
  const re = /method:\s*'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*path:\s*'([^']+)'\s*,\s*auth:\s*'([^']+)'([\s\S]{0,320}?)\n\s*\},/g;
  const out = [];
  for (const f of files) {
    const domain = f.replace(/\.ts$/, '');
    const text = await readFile(join(SHARED_SRC, f), 'utf8');
    let m;
    while ((m = re.exec(text)) !== null) {
      const [, method, path, auth, tail] = m;
      const kindMatch = /kind:\s*'([^']+)'/.exec(tail);
      out.push({ domain, method, path, auth, kind: kindMatch ? kindMatch[1] : 'rest' });
    }
  }
  return out;
}

function concretePath(path) {
  return path.replace(/:[A-Za-z0-9_]+/g, PARAM);
}

/** Probe an SSE endpoint: classify by content-type without hanging on the open stream. */
async function probeSse(path, token) {
  const url = new URL(BASE + path);
  url.searchParams.set('token', token);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2500);
  try {
    const res = await fetch(url, { headers: { accept: 'text/event-stream' }, signal: ctrl.signal });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('event-stream')) { clearTimeout(timer); ctrl.abort(); return { status: res.status, bodyKind: 'sse', mounted: true }; }
    let text = '';
    try { text = await res.text(); } catch { /* ignore */ }
    clearTimeout(timer);
    const t = text.trim();
    if (t.startsWith('{') || t.startsWith('[')) return { status: res.status, bodyKind: 'json', mounted: true };
    if (t.startsWith('<') || ct.includes('html')) return { status: res.status, bodyKind: 'html', mounted: false };
    return { status: res.status, bodyKind: t === '' ? 'empty' : 'string', mounted: false };
  } catch (e) {
    clearTimeout(timer);
    return { status: 0, bodyKind: 'timeout-open', mounted: true, note: String(e && e.message ? e.message : e) };
  }
}

async function main() {
  const admin = await login('admin', 'tmp12345');
  const endpoints = await enumerateEndpoints();
  const rows = [];

  for (const ep of endpoints) {
    const probePath = concretePath(ep.path);
    const isSse = ep.kind === 'sse' || probePath.endsWith('/events');
    let status = 0;
    let kind = 'unknown';
    let mounted = null;

    try {
      if (isSse) {
        const s = await probeSse(probePath, admin);
        status = s.status; kind = s.bodyKind; mounted = s.mounted;
      } else if (ep.method === 'GET') {
        const res = await api('GET', probePath, { token: admin, timeoutMs: 8000 });
        status = res.status; kind = bodyKind(res);
        mounted = kind === 'html' ? false : (kind === 'empty' || kind === 'string' ? null : true);
      } else if (ep.method === 'DELETE') {
        const res = await api('DELETE', probePath, { token: admin, timeoutMs: 8000 });
        status = res.status; kind = bodyKind(res);
        mounted = kind === 'html' ? false : (kind === 'empty' ? null : true);
      } else {
        // POST/PUT/PATCH — intentionally-invalid empty body.
        const res = await api(ep.method, probePath, { token: admin, body: {}, timeoutMs: 8000 });
        status = res.status; kind = bodyKind(res);
        mounted = kind === 'html' ? false : (kind === 'empty' ? null : true);
      }
    } catch (e) {
      kind = 'probe-error';
      rows.push({ ...ep, probePath, status, bodyKind: kind, mounted: null, error: String(e && e.message ? e.message : e) });
      continue;
    }
    rows.push({ ...ep, probePath, status, bodyKind: kind, mounted });
  }

  const total = rows.length;
  const notMounted = rows.filter((r) => r.mounted === false);
  const ambiguous = rows.filter((r) => r.mounted === null);
  const mountedCount = rows.filter((r) => r.mounted === true).length;

  // Emit one INFO line per NOT-mounted or ambiguous / non-envelope row.
  for (const r of notMounted) {
    INFO('SWEEP.notmounted', `${r.method} ${r.path} (declared in ${r.domain}, auth=${r.auth}) -> status=${r.status} body=${r.bodyKind} => NOT MOUNTED`);
  }
  for (const r of ambiguous) {
    INFO('SWEEP.ambiguous', `${r.method} ${r.path} (${r.domain}) -> status=${r.status} body=${r.bodyKind} => ambiguous (non-JSON, non-HTML)`);
  }
  console.log(`INFO SWEEP.summary total=${total} mounted=${mountedCount} notMounted=${notMounted.length} ambiguous=${ambiguous.length}`);

  const evFile = await evidence(J, 'sweep', {
    summary: { total, mounted: mountedCount, notMounted: notMounted.length, ambiguous: ambiguous.length },
    notMounted: notMounted.map((r) => `${r.method} ${r.path} [${r.domain}]`),
    ambiguous: ambiguous.map((r) => `${r.method} ${r.path} [${r.domain}] (${r.bodyKind})`),
    rows,
  });
  console.log(`INFO SWEEP.evidence ${evFile}`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
