import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { allEndpointsFlat } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';

/**
 * F5 mount-coverage drift gate (batch-1 S6). Every path declared in the `shared/` descriptor maps
 * must be MOUNTED. The signal, now that F6's terminal JSON-404 has landed, is envelope-vs-HTML at
 * the router level rather than a body heuristic:
 *
 *   mounted   -> the router answers (401 UNAUTHENTICATED for an authed route, or its own status)
 *   unmounted -> the terminal /api/v1 handler answers 404 NOT_FOUND
 *
 * We probe UNAUTHENTICATED on purpose: an authed route's `requireAuth` fires before route matching,
 * so a 401 proves the router exists without needing a fixture per endpoint. A `public` route answers
 * with its own status. Only a 404 NOT_FOUND means "no router claimed this path".
 *
 * EXCLUDED paths carry a written reason. The list may only SHRINK.
 *
 * KNOWN LIMIT (stated, not hidden): a router mounts with `requireAuth`, so ANY path beneath it
 * answers 401 unauthenticated — this gate therefore proves the ROUTER exists, not that a specific
 * sub-route within it does. A missing `GET /memories/stats` is shadowed by `GET /memories/:id` and
 * looks mounted here. Per-endpoint contract tests are what cover that; this gate covers whole-router
 * and distinct-path drift, which is what actually regressed (integration-builder, uploads, ...).
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

/**
 * Endpoints intentionally not probed by this gate, each with the reason it cannot be. NOT a
 * "not yet mounted" allowlist — an unmounted endpoint must fail this test.
 */
const EXCLUDED = new Map<string, string>([
  // Not under /api/v1: the terminal 404 (and therefore this gate's signal) does not apply.
  ...allEndpointsFlat()
    .filter((e) => !e.path.startsWith('/api/v1'))
    .map((e) => [`${e.domain}.${e.name}`, 'outside /api/v1 (served-app plane, legal, oauth callbacks)'] as [string, string]),
  // SSE endpoints hold the connection open; probing them would hang this suite.
  ['notifications.events', 'SSE stream — probing holds the connection open'],
  ['chat.runEvents', 'SSE stream — probing holds the connection open'],
  ['jobs.events', 'SSE stream — probing holds the connection open'],
  ['automations.runEvents', 'SSE stream — probing holds the connection open'],
]);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_mount_coverage');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

/** Fill `:param` segments with a placeholder so the route matcher can reach the handler. */
const concretePath = (p: string) => p.replace(/:[A-Za-z0-9_]+/g, 'probe');

describe('mount-coverage: every declared /api/v1 path is mounted (F5 drift gate)', () => {
  it('no declared endpoint falls through to the terminal NOT_FOUND handler', async () => {
    const probes = allEndpointsFlat().filter((e) => !EXCLUDED.has(`${e.domain}.${e.name}`));
    expect(probes.length).toBeGreaterThan(50); // sanity: the walker really found the descriptors

    const unmounted: string[] = [];
    for (const e of probes) {
      const res = await fetch(`http://127.0.0.1:${port}${concretePath(e.path)}`, {
        method: e.method,
        headers: { 'content-type': 'application/json' },
        ...(e.method === 'GET' || e.method === 'DELETE' ? {} : { body: '{}' }),
      });
      if (res.status !== 404) continue; // any non-404 means a router claimed the path
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
      // F6 guarantees a JSON envelope either way; NOT_FOUND from the terminal handler is the
      // "nothing claimed this path" signal. A router's own 404 (e.g. unknown id) carries the same
      // code, so a genuinely mounted route with a probe-shaped id can look unmounted — we accept
      // that conservatism: it can only produce a FALSE ALARM, never a false pass.
      if (body.error?.code === 'NOT_FOUND') unmounted.push(`${e.domain}.${e.name}  ${e.method} ${e.path}`);
    }

    // Routes whose 404 is legitimately their OWN (an unknown :id / :key probe reaching the
    // handler), verified by hand. Each proves mounted-ness some other way (its own contract test).
    const OWN_404 = new Set<string>([
      'memories.get', 'memories.update', 'memories.delete',
      'sessions.get', 'sessions.update', 'sessions.delete', 'sessions.getMessages', 'sessions.addMessage',
      'artifacts.get', 'artifacts.patch', 'artifacts.remove',
      'org.patchOrg',
      'jobs.get', 'jobs.cancel', 'chat.getRun', 'chat.cancelRun',
      'knowledge.deleteDocument',
    ]);
    /**
     * DE-SCOPED for rc-1 (batch-1 FLOW_PLAN "do NOT pull forward"): declared in `shared/` but
     * deliberately unmounted. They are listed here EXPLICITLY so the gate stays honest — a new
     * unmounted endpoint fails the build, and removing one of these from shared/ (or mounting it)
     * makes this list shrink. It may only shrink.
     */
    const DESCOPED = new Set<string>([
      'integrationBuilder.chat', 'integrationBuilder.load', 'integrationBuilder.save', 'integrationBuilder.test',
      'uploads.create',
      'ekoaLocal.agentFaceRun', 'ekoaLocal.agentFaceCancel',
      'ekoaLocal.bridgeConnect', 'ekoaLocal.bridgeDebugInvoke', 'ekoaLocal.tuiEvents',
    ]);
    // Declared in shared/ but UNMOUNTED, and — because they are SUB-PATHS under a requireAuth
    // router (sessions, automations) — INVISIBLE to this unauthenticated probe (it sees the
    // router's 401, not the terminal 404). They cannot appear in `unmounted`; the separate
    // authenticated test below proves them unmounted. Listed so the drift is not hidden.
    // (S6 review finding 2.) Both are out of batch-1's named scope.
    const DESCOPED_SUBPATH = new Set<string>(['sessions.seedFeatured', 'triggers.listTriggers']);

    const real = unmounted.filter((u) => {
      const name = u.split('  ')[0] as string;
      return !OWN_404.has(name) && !DESCOPED.has(name);
    });
    expect(real, `declared but UNMOUNTED (fell through to the terminal 404):\n${real.join('\n')}`).toEqual([]);

    // The top-level de-scoped set must be EXACTLY what is unmounted: if one gets mounted, shrink it.
    const stillUnmounted = new Set(unmounted.map((u) => u.split('  ')[0] as string).filter((n) => DESCOPED.has(n)));
    expect([...DESCOPED].filter((n) => !stillUnmounted.has(n)), 'DESCOPED entries that are now mounted — remove them from the list').toEqual([]);
    // Sub-path de-scoped endpoints must NOT have leaked into the unauthenticated unmounted list
    // (they can't be seen here); if one does, it means the router itself was removed — investigate.
    expect(unmounted.map((u) => u.split('  ')[0]).filter((n) => DESCOPED_SUBPATH.has(n as string)), 'a sub-path de-scoped endpoint became visibly unmounted').toEqual([]);
  }, 120_000);

  it('the two SUB-PATH de-scoped endpoints are genuinely unmounted (authenticated probe sees the terminal 404, not a handler)', async () => {
    // The unauthenticated gate above cannot see these (401 shadows them). Prove them unmounted
    // WITH a token: if either is later mounted, this fails and the DESCOPED list must shrink.
    process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
    const { users } = await import('../../src/data/stores.js');
    const { setActivation } = await import('../../src/data/activation.js');
    const { login } = await import('../../src/auth/service.js');
    const { hashPassword } = await import('../../src/auth/password.js');
    await users.insert({ _id: 'mc-u', username: 'mc-u', passwordHash: await hashPassword('pw123456'), role: 'super-admin', orgId: 'o', active: true } as never);
    setActivation('mc-u', { active: true, billingLocked: false });
    const { token } = await login('mc-u', 'pw123456', false, { now: () => Date.now(), genId: () => `id-${Math.random()}` });
    for (const path of ['/api/v1/sessions/probe/seed-featured', '/api/v1/automations/probe/triggers']) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: path.endsWith('triggers') ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
      expect(res.status, `${path} should be an unmounted 404 today`).toBe(404);
      expect(body.error?.code).toBe('NOT_FOUND');
    }
    await users.deleteMany({});
  });

  it('the exclusion list only carries written reasons (no silent skips)', () => {
    for (const [name, reason] of EXCLUDED) {
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(10);
    }
  });
});
