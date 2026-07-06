import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { appBuilder } from '../../src/apps/builder.js';
import { WorkerThreadRuntime, type RuntimeDeps } from '../../src/apps/backend-runtime/runtime.js';

/**
 * Artifact-backend worker runtime (B19, C05-20..23). Drives the runtime through a
 * REAL fixture backend bundle built with the production appBuilder in a temp dir,
 * with the model + notify + app-data seams injected as stubs. Proves the four named
 * lifecycle invariants: post-DELETE refusal, post-settle capability rejection,
 * hung-handler timeout + fresh worker, and true dry-run.
 */

let projectDir: string;
let bundlePath: string;

// -- injected app-data stub (records + persists in-memory) --------------------
type Row = Record<string, unknown>;
let store: Map<string, Row[]>;
let seq = 0;
function rowsOf(scopeKey: string, collection: string): Row[] {
  const k = `${scopeKey}::${collection}`;
  if (!store.has(k)) store.set(k, []);
  return store.get(k)!;
}
const appData: RuntimeDeps['appData'] = {
  list: async (s, c) => rowsOf(s, c),
  get: async (s, c, id) => rowsOf(s, c).find((r) => r.id === id) ?? null,
  create: async (s, c, data) => {
    const item = { id: (data.id as string) ?? `itm-${++seq}`, ...data };
    rowsOf(s, c).push(item);
    return item;
  },
  update: async (s, c, id, patch) => {
    const arr = rowsOf(s, c);
    const i = arr.findIndex((r) => r.id === id);
    const next = { ...(arr[i] ?? { id }), ...patch, id };
    if (i >= 0) arr[i] = next; else arr.push(next);
    return next;
  },
  delete: async (s, c, id) => {
    const arr = rowsOf(s, c);
    const i = arr.findIndex((r) => r.id === id);
    if (i < 0) return false;
    arr.splice(i, 1);
    return true;
  },
};

let modelCalls = 0;
const emails: Array<{ to: string[]; subject: string }> = [];
const notifications: Array<{ userId: string; event: unknown }> = [];

function baseDeps(): Partial<RuntimeDeps> {
  return {
    now: () => Date.now(),
    resolveOwner: async () => ({ ownerUserId: 'owner1', sharedData: false }),
    resolveBundlePath: async () => bundlePath,
    appData,
    callModel: async () => { modelCalls++; return 'STUB-CLASSIFICATION'; },
    sendToUser: (userId, event) => { notifications.push({ userId, event }); },
    sendEmail: async (_owner, a) => { emails.push({ to: a.to, subject: a.subject }); return { success: true }; },
  };
}

function makeRuntime(opts: { invokeTimeoutMs?: number } = {}): WorkerThreadRuntime {
  return new WorkerThreadRuntime(baseDeps(), { invokeTimeoutMs: opts.invokeTimeoutMs ?? 60_000, startupTimeoutMs: 15_000 });
}

const BACKEND_SOURCE = `
export async function echo(input, ekoa) { ekoa.info('echo', { got: input }); return { echoed: input }; }
export async function createRow(input, ekoa) {
  await ekoa.appData.create('rows', { v: (input && input.v) ?? 'x' });
  return { ok: true };
}
export async function classify(input, ekoa) { const out = await ekoa.llm.classify({ message: 'x' }); return { out }; }
export async function sendMail(input, ekoa) { await ekoa.notify.email({ to: ['a@b.pt'], subject: 'Hi', body: 'B' }); return { sent: true }; }
export async function hang() { await new Promise(() => {}); }
export async function deferredWrite(input, ekoa) {
  await ekoa.appData.create('rows', { first: true });
  setTimeout(() => { void ekoa.appData.create('rows', { late: true }); }, 40);
  return { ok: true };
}
`;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();

  projectDir = await mkdtemp(join(tmpdir(), 'ekoa-backend-'));
  await mkdir(join(projectDir, 'backend'), { recursive: true });
  await mkdir(join(projectDir, 'dist'), { recursive: true });
  // Root index.html => the frontend build takes the plain-HTML fast path (success),
  // so build() proceeds to bundle the declared backend.
  await writeFile(join(projectDir, 'index.html'), '<!doctype html><html><body>fixture</body></html>');
  await writeFile(join(projectDir, 'backend', 'index.mjs'), BACKEND_SOURCE);
  await writeFile(
    join(projectDir, 'manifest.json'),
    JSON.stringify({
      id: 'fixture', name: 'Fixture', version: '1.0.0',
      entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/', type: 'html-app',
      backend: { entryPoint: 'backend/index.mjs', handlers: ['echo', 'createRow', 'classify', 'sendMail', 'hang', 'deferredWrite'] },
    }),
  );

  await appBuilder.build('fixture', projectDir);
  bundlePath = join(projectDir, 'dist-backend', 'backend.mjs');
  expect(existsSync(bundlePath)).toBe(true);
}, 60_000);

afterAll(async () => {
  await appBuilder.dispose();
  await rm(projectDir, { recursive: true, force: true });
});

beforeEach(() => {
  store = new Map();
  seq = 0;
  modelCalls = 0;
  emails.length = 0;
  notifications.length = 0;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('artifact-backend worker runtime (B19)', () => {
  it('invokes a handler and captures logs; the model + notify seams are injected', async () => {
    const rt = makeRuntime();
    try {
      const echo = await rt.invoke('art-echo', 'echo', { hello: 'world' });
      expect(echo.ok).toBe(true);
      expect(echo.result).toEqual({ echoed: { hello: 'world' } });
      expect(echo.logs.some((l) => l.msg === 'echo')).toBe(true);

      const cls = await rt.invoke('art-cls', 'classify', {});
      expect(cls.ok).toBe(true);
      expect((cls.result as { out: string }).out).toBe('STUB-CLASSIFICATION');
      expect(modelCalls).toBe(1);

      const mail = await rt.invoke('art-mail', 'sendMail', {});
      expect(mail.ok).toBe(true);
      expect(emails).toHaveLength(1);
      expect(emails[0]!.to).toEqual(['a@b.pt']);
    } finally {
      await rt.dispose();
    }
  });

  it('C05-23: dry-run captures effects WITHOUT persisting; reads still run', async () => {
    const rt = makeRuntime();
    try {
      const r = await rt.invoke('art-dry', 'createRow', { v: 42 }, { dryRun: true, invokedBy: 'sample' });
      expect(r.ok).toBe(true);
      expect(r.dryRunEffects).toBeDefined();
      expect(r.dryRunEffects!.some((e) => e.capability === 'appData.create')).toBe(true);
      // The persistent write was suppressed - nothing landed in the store.
      expect(rowsOf('art-dry', 'rows')).toHaveLength(0);
    } finally {
      await rt.dispose();
    }
  });

  it('a non-dry invocation DOES persist (control for the dry-run suppression)', async () => {
    const rt = makeRuntime();
    try {
      const r = await rt.invoke('art-live', 'createRow', { v: 7 });
      expect(r.ok).toBe(true);
      expect(r.dryRunEffects).toBeUndefined();
      expect(rowsOf('art-live', 'rows')).toHaveLength(1);
    } finally {
      await rt.dispose();
    }
  });

  it('C05-20: a revoked (deleted) artifact refuses further invokes', async () => {
    const rt = makeRuntime();
    try {
      const { fullyDrained } = await rt.revoke('art-del');
      expect(fullyDrained).toBe(true);
      const r = await rt.invoke('art-del', 'echo', { x: 1 });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/revoked/i);
      // A queued invoke that races the revoke is also refused.
      rt.revoke('art-del2');
      const r2 = await rt.invoke('art-del2', 'echo', {});
      expect(r2.ok).toBe(false);
    } finally {
      await rt.dispose();
    }
  });

  it('C05-21: a capability call after the handler settled is refused (no post-settle write lands)', async () => {
    const rt = makeRuntime();
    try {
      const r = await rt.invoke('art-post', 'deferredWrite', {});
      expect(r.ok).toBe(true);
      // The awaited write landed; the setTimeout-scheduled write fires AFTER settle
      // and is refused - it must never reach the app-data store.
      await wait(200);
      expect(rowsOf('art-post', 'rows')).toHaveLength(1);
    } finally {
      await rt.dispose();
    }
  });

  it('C05-22: a hung handler times out, recycles the worker, and the next invoke gets a fresh worker', async () => {
    const rt = makeRuntime({ invokeTimeoutMs: 400 });
    try {
      const hung = await rt.invoke('art-hang', 'hang', {}, { timeoutMs: 400 });
      expect(hung.ok).toBe(false);
      expect(hung.error).toMatch(/timed out/i);
      // The next invoke must not be blocked on the dead worker - a fresh worker runs it.
      const fresh = await rt.invoke('art-hang', 'echo', { again: true });
      expect(fresh.ok).toBe(true);
      expect(fresh.result).toEqual({ echoed: { again: true } });
    } finally {
      await rt.dispose();
    }
  }, 20_000);

  it('setEnabled(false) refuses invokes; re-enabling restores them', async () => {
    const rt = makeRuntime();
    try {
      rt.setEnabled('art-gate', false);
      const off = await rt.invoke('art-gate', 'echo', {});
      expect(off.ok).toBe(false);
      expect(off.error).toMatch(/disabled/i);
      rt.setEnabled('art-gate', true);
      const on = await rt.invoke('art-gate', 'echo', { back: true });
      expect(on.ok).toBe(true);
    } finally {
      await rt.dispose();
    }
  });
});
