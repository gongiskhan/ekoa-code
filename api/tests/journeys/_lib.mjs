/**
 * Boot-A probe kit — zero-dependency Node-20 helpers for HTTP/SSE/HMAC probes against the
 * LIVE stack at http://localhost:4111. Read-only against the product: probes never modify
 * api/, web/, shared/ and never touch external network. Evidence lands under
 * api/tests/evidence/<journey>/<name>.json.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BASE = process.env.EKOA_BASE ?? 'http://localhost:4111';
const __dirname = dirname(fileURLToPath(import.meta.url));
export const PROBES_DIR = __dirname;
export const REPO_ROOT = join(__dirname, '..', '..', '..');
export const EVIDENCE_ROOT = join(__dirname, '..', 'evidence');

/** POST /auth/login → bearer token (throws only if the login itself is unusable). */
export async function login(username, password) {
  const r = await api('POST', '/api/v1/auth/login', { body: { username, password } });
  if (!r.isJson || !r.body || typeof r.body.token !== 'string') {
    throw new Error(`login failed for ${username}: status=${r.status} body=${(r.text || '').slice(0, 200)}`);
  }
  return r.body.token;
}

/**
 * One HTTP call. Returns { status, headers, text, body(parsed-if-json), isJson, contentType }.
 * A network failure is surfaced as { status:0, error } rather than throwing, so a probe can
 * record it as evidence. `redirect:'manual'` so 301/302 are observable (never followed).
 */
export async function api(method, path, opts = {}) {
  const { token, body, rawBody, headers = {}, timeoutMs = 20000 } = opts;
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (rawBody !== undefined) {
    payload = rawBody;
  } else if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!h['content-type']) h['content-type'] = 'application/json';
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(BASE + path, { method, headers: h, body: payload, signal: ctrl.signal, redirect: 'manual' });
    const text = await res.text();
    const ct = res.headers.get('content-type') || '';
    let parsed = null;
    let isJson = false;
    try {
      parsed = JSON.parse(text);
      isJson = ct.includes('json') || (parsed !== null && typeof parsed === 'object');
    } catch {
      isJson = false;
    }
    const ho = {};
    res.headers.forEach((v, k) => { ho[k] = v; });
    return { status: res.status, headers: ho, text, body: parsed, isJson, contentType: ct };
  } catch (e) {
    return { status: 0, headers: {}, text: '', body: null, isJson: false, contentType: '', error: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

/** sha256 HMAC over the raw bytes, GitHub-style `sha256=<hex>` header value. */
export function hmacSign(secret, rawBody) {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(rawBody)).digest('hex');
}

function parseSseChunk(chunk) {
  let event;
  let id;
  const dataLines = [];
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    else if (line.startsWith('id:')) id = line.slice(3).trim();
    // ':' comment / keepalive lines are ignored
  }
  const dataRaw = dataLines.join('\n');
  let data = dataRaw;
  if (dataRaw) { try { data = JSON.parse(dataRaw); } catch { /* keep raw string */ } }
  return { event, id, data };
}

/**
 * Open an SSE stream and collect frames. Returns:
 *   { ok, status, frames:[{event,id,data}], closedReason, errorBody? }
 * `token` is appended as ?token= when the path has none (SSE auth is query-based, CONV-1).
 * `until(frame)` — optional predicate; when it returns true the stream is closed early.
 * `lastEventId` — sets the Last-Event-ID header (pass '0' to force full replay-ring delivery,
 * which avoids a race where a fast terminal frame fires before the client attaches).
 */
export async function sseCollect(path, opts = {}) {
  const { token, timeoutMs = 20000, until, headers = {}, lastEventId } = opts;
  const url = new URL(BASE + path);
  if (token && !url.searchParams.get('token')) url.searchParams.set('token', token);
  const h = { accept: 'text/event-stream', ...headers };
  if (lastEventId !== undefined) h['last-event-id'] = String(lastEventId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const frames = [];
  let closedReason = 'timeout';
  let status = 0;
  try {
    const res = await fetch(url, { headers: h, signal: ctrl.signal });
    status = res.status;
    if (!res.ok) {
      let errorText = '';
      try { errorText = await res.text(); } catch { /* ignore */ }
      let errorBody = errorText;
      try { errorBody = JSON.parse(errorText); } catch { /* keep raw */ }
      clearTimeout(timer);
      return { ok: false, status, frames, closedReason: 'http-error', errorBody };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let stop = false;
    while (!stop) {
      const { value, done } = await reader.read();
      if (done) { closedReason = 'stream-end'; break; }
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const frame = parseSseChunk(chunk);
        if (frame.event === undefined && (frame.data === undefined || frame.data === '')) continue;
        frames.push(frame);
        if (until && until(frame)) { closedReason = 'until'; stop = true; ctrl.abort(); break; }
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      if (closedReason !== 'until') closedReason = 'timeout';
    } else {
      closedReason = 'error:' + String(e && e.message ? e.message : e);
    }
  } finally {
    clearTimeout(timer);
  }
  return { ok: true, status: status || 200, frames, closedReason };
}

/** Write pretty JSON evidence to api/tests/evidence/<journey>/<name>.json; returns the path. */
export async function evidence(journey, name, obj) {
  const dir = join(EVIDENCE_ROOT, journey);
  await mkdir(dir, { recursive: true });
  const file = join(dir, name + '.json');
  await writeFile(file, JSON.stringify(obj, null, 2) + '\n');
  return file;
}

/** One assertion line: `PASS|FAIL|INFO <id> <detail>`. Accumulates into `results` if given. */
export function record(kind, id, detail, results) {
  const line = `${kind} ${id} ${detail}`;
  console.log(line);
  if (results) results.push({ kind, id, detail });
  return { kind, id, detail };
}
export const PASS = (id, detail, results) => record('PASS', id, detail, results);
export const FAIL = (id, detail, results) => record('FAIL', id, detail, results);
export const INFO = (id, detail, results) => record('INFO', id, detail, results);

/** Body classifier for the contract sweep: 'envelope' | 'json' | 'html' | 'string' | 'empty'. */
export function bodyKind(res) {
  const t = (res.text || '').trim();
  if (t === '') return 'empty';
  if (res.isJson && res.body && typeof res.body === 'object') {
    if (res.body.error && typeof res.body.error === 'object' && typeof res.body.error.code === 'string') return 'envelope';
    return 'json';
  }
  if (t.startsWith('<') || (res.contentType || '').includes('html')) return 'html';
  return 'string';
}

/** A tiny sleep (used sparingly for poll loops; never in the request path). */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
