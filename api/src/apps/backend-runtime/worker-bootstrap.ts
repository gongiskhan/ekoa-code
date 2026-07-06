/**
 * Worker bootstrap - core-owned code that runs INSIDE the artifact-backend worker
 * (Layer 2, B19). NOT artifact code. Ported verbatim from the old
 * services/artifact-backend/worker-bootstrap.ts.
 *
 * Shipped as an eval-string (CommonJS) rather than a file so it runs identically
 * under ts-node (dev), compiled `node dist/` (prod), and vitest - none of which
 * agree on how to execute a sibling worker entry. The string uses only Node
 * built-ins + dynamic `import()` of the artifact's esbuild bundle.
 *
 * Protocol (see runtime.ts WorkerThreadRuntime for the other half):
 *   main -> worker : { type:'invoke', invokeId, entrypoint, input, token, bundleUrl }
 *   worker -> main : { type:'ready' }
 *                    { type:'rpc', rpcId, invokeId, token, method, args }   (awaited)
 *                    { type:'log', invokeId, entry }                        (fire-and-forget)
 *                    { type:'invoke-result', invokeId, ok, result?, error? }
 *   main -> worker : { type:'rpc-result', rpcId, ok, value? , error? }
 *
 * The worker builds the credential-free `ekoa` handle: every method is an RPC
 * carrying the per-invoke capability token; core validates it and executes the
 * call. The worker imports the bundle and calls the named handler `(input, ekoa)`.
 */

export const WORKER_BOOTSTRAP_SOURCE = String.raw`
const { parentPort } = require('worker_threads');
if (!parentPort) { throw new Error('artifact-backend worker has no parentPort'); }

let rpcSeq = 0;
const pending = new Map();

parentPort.on('message', (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'rpc-result') {
    const p = pending.get(m.rpcId);
    if (!p) return;
    pending.delete(m.rpcId);
    if (m.ok) p.resolve(m.value);
    else p.reject(new Error(typeof m.error === 'string' ? m.error : 'capability error'));
    return;
  }
  if (m.type === 'invoke') {
    void runInvoke(m);
  }
});

function makeEkoa(token, invokeId) {
  const inFlight = new Set();
  const rpc = (method, args) => {
    const p = new Promise((resolve, reject) => {
      const rpcId = 'rpc-' + (++rpcSeq);
      pending.set(rpcId, { resolve, reject });
      parentPort.postMessage({ type: 'rpc', rpcId, invokeId, token, method, args: args || {} });
    });
    const tracked = p.then(() => null, (e) => ({ error: String(e && e.message ? e.message : e) }));
    inFlight.add(tracked);
    void tracked.then(() => inFlight.delete(tracked));
    return p;
  };
  const log = (level, msg, meta) => {
    try {
      parentPort.postMessage({
        type: 'log', invokeId,
        entry: { level: String(level || 'info'), msg: String(msg == null ? '' : msg), meta: meta || undefined, at: new Date().toISOString() },
      });
    } catch (_e) { /* logging must never throw into the handler */ }
  };
  const ekoa = {
    appData: {
      list: (collection) => rpc('appData.list', { collection }),
      get: (collection, id) => rpc('appData.get', { collection, id }),
      create: (collection, data) => rpc('appData.create', { collection, data }),
      update: (collection, id, patch) => rpc('appData.update', { collection, id, patch }),
      delete: (collection, id) => rpc('appData.delete', { collection, id }),
      shared: {
        list: (collection) => rpc('appData.shared.list', { collection }),
        get: (collection, id) => rpc('appData.shared.get', { collection, id }),
        create: (collection, data) => rpc('appData.shared.create', { collection, data }),
        update: (collection, id, patch) => rpc('appData.shared.update', { collection, id, patch }),
        delete: (collection, id) => rpc('appData.shared.delete', { collection, id }),
      },
    },
    llm: {
      classify: (opts) => rpc('llm.classify', opts || {}),
      complete: (opts) => rpc('llm.complete', opts || {}),
    },
    notify: {
      inApp: (title, body, meta) => rpc('notify.inApp', { title, body, meta }),
      email: (opts) => rpc('notify.email', opts || {}),
    },
    log: log,
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
  };
  const drain = async () => {
    const errors = [];
    const seen = new Set();
    for (;;) {
      const batch = [...inFlight].filter((p) => !seen.has(p));
      if (batch.length === 0) break;
      for (const p of batch) seen.add(p);
      const results = await Promise.all(batch);
      for (const r of results) if (r) errors.push(r);
    }
    return errors;
  };
  return { ekoa, drain };
}

async function runInvoke(m) {
  const { invokeId, entrypoint, input, token, bundleUrl } = m;
  const { ekoa, drain } = makeEkoa(token, invokeId);
  try {
    const mod = await import(bundleUrl);
    const fn = mod && (mod[entrypoint] || (mod.default && mod.default[entrypoint]));
    if (typeof fn !== 'function') {
      throw new Error('backend bundle does not export handler "' + entrypoint + '"');
    }
    const result = await fn(input, ekoa);
    const bgErrors = await drain();
    if (bgErrors.length > 0) {
      parentPort.postMessage({ type: 'invoke-result', invokeId, ok: false, error: 'background capability call failed: ' + bgErrors.map((e) => e.error).join('; ') });
    } else {
      parentPort.postMessage({ type: 'invoke-result', invokeId, ok: true, result: safe(result) });
    }
  } catch (e) {
    try { await drain(); } catch (_e) { /* ignore */ }
    parentPort.postMessage({ type: 'invoke-result', invokeId, ok: false, error: String(e && e.message ? e.message : e) });
  }
}

function safe(v) {
  try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); }
  catch (_e) { return null; }
}

parentPort.postMessage({ type: 'ready' });
`;
