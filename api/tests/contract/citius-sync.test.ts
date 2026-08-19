/**
 * CS6 CONTRACT — the flagged, dashboard-auth sync surface (`api/src/routes/sync.ts`).
 *
 * Every response validates against its NAMED `shared/` schema (`SyncRunOutcome`, `SyncStateView`,
 * `SyncRunReport`) and every non-2xx against the shared error envelope, per the house rule. The
 * router is mounted on a bare express app (the `automations.test.ts` pattern) with the session and
 * transport seams injected at the mock portal, so the whole rail — auth, flag, sync, verification,
 * Mongo — runs for real without a browser.
 *
 * WHAT THIS SURFACE IS NOT is as load-bearing as what it is. RUN_SPEC's non-goals put the Citius
 * proof behind dashboard auth plus a flag and OFF the user-or-key capability surface, so this suite
 * also pins the negative: the route mounts `requireAuth` and nothing else, carries no descriptor in
 * `ALL_ENDPOINTS`, and cannot be reached with a gateway key because there is no key admission on it
 * at all. A future slice that promotes the sync has to change these assertions deliberately.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { ErrorEnvelope, SyncRunOutcome, SyncRunReport, SyncStateView, ALL_ENDPOINTS } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, loadConfig, defaultLlmConfig } from '../../src/config.js';
import { buildApp } from '../../src/server.js';
import { decodeHtml, parseHiddenFields } from '../../src/legal/portal-html.js';
import { syncRouter, CITIUS_SYNC_FLAG, citiusSyncEnabled } from '../../src/routes/sync.js';
import { CofreLockedError } from '../../src/cofre/index.js';
import type { CitiusTransport } from '../../src/legal/citius-mandatarios-http.js';
import type { EnsureSessionInput, EnsureSessionResult } from '../../src/automation/session-establishment.js';
// @ts-expect-error - JS mock helper, no d.ts
import { startMockCitius } from '../helpers/mock-citius-webforms-server.mjs';

let mem: MongoMemoryServer;
let mock: Awaited<ReturnType<typeof startMockCitius>>;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };

/** Swappable per test: what the injected `ensureSession` answers with. */
let sessionAnswer: () => Promise<EnsureSessionResult>;
/** Every establishment input the router handed down, so the PERMIT it composes can be asserted. */
let sessionInputs: EnsureSessionInput[] = [];

const liveTransport: CitiusTransport = async (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: 'manual' });

const api = (p: string, t?: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(t ? { authorization: `Bearer ${t}` } : {}),
      ...(init.headers ?? {}),
    },
  });

/** A REAL login against the mock, returned in the Playwright `storageState` shape CS5 hands over. */
async function establishedSession(): Promise<EnsureSessionResult> {
  const loginRes = await fetch(`${mock.baseUrl}${mock.loginPath}`);
  const html = decodeHtml(Buffer.from(await loginRes.arrayBuffer()), loginRes.headers.get('content-type') ?? '');
  const hidden = parseHiddenFields(html);
  const res = await fetch(`${mock.baseUrl}${mock.loginPath}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      __VIEWSTATE: hidden.__VIEWSTATE!,
      __VIEWSTATEGENERATOR: hidden.__VIEWSTATEGENERATOR!,
      __EVENTVALIDATION: hidden.__EVENTVALIDATION!,
      'ctl00$cph$txtUserName': 'cedula-1234',
      'ctl00$cph$txtUserPass': ['segredo', 'de', 'teste'].join('-'),
    }).toString(),
  });
  const value = res.headers.getSetCookie().find((c) => c.startsWith('ASP.NET_SessionId'))!.split(';')[0]!.split('=')[1]!;
  return {
    status: 'reused',
    itemId: 'cofre-item-citius',
    storageState: { cookies: [{ name: 'ASP.NET_SessionId', value, domain: '127.0.0.1', path: '/', secure: false }] },
  };
}

/** The body every run posts: point the connector at the mock instead of the real court portal. */
const runBody = (): string => JSON.stringify({ baseUrl: mock.baseUrl, inboxPath: mock.inboxPath, throttleMs: 0 });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_contract_citius_sync');
  mock = await startMockCitius({ pageSize: 2 });
  sessionAnswer = establishedSession;

  await orgs.insert({ _id: 'firmaA', name: 'Firma A' } as never);
  for (const id of ['adv1', 'adv2']) {
    await users.insert({
      _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'firmaA', active: true,
    } as never);
    setActivation(id, { active: true, billingLocked: false });
  }

  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/sync',
    syncRouter({
      establishSession: (input) => { sessionInputs.push(input); return sessionAnswer(); },
      markSessionUnhealthy: async () => true,
      enumerateDeps: { transport: liveTransport, sleep: async () => {} },
      genRunId: () => 'contract-run',
    }),
  );
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 90_000);

afterAll(async () => {
  delete process.env[CITIUS_SYNC_FLAG];
  server.close();
  await mock.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(() => {
  process.env[CITIUS_SYNC_FLAG] = 'true';
  sessionAnswer = establishedSession;
  sessionInputs = [];
  mock.scenario({ cmd: 'reset' });
});

const tokenFor = async (u: string): Promise<string> => (await login(u, 'pw123456', false, deps)).token;
const json = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// 1. the flag
// ---------------------------------------------------------------------------

describe('sync routes · the flag is the first gate, and it is default-OFF', () => {
  it('is OFF unless the env var is exactly "true"', () => {
    for (const v of ['1', 'yes', 'TRUE', 'True', '']) {
      process.env[CITIUS_SYNC_FLAG] = v;
      expect(citiusSyncEnabled()).toBe(false);
    }
    delete process.env[CITIUS_SYNC_FLAG];
    expect(citiusSyncEnabled()).toBe(false);
    process.env[CITIUS_SYNC_FLAG] = 'true';
    expect(citiusSyncEnabled()).toBe(true);
  });

  it('answers 404 (schema-valid) on BOTH routes when disabled — and identically with or without a token', async () => {
    const t = await tokenFor('adv1');
    delete process.env[CITIUS_SYNC_FLAG];
    for (const [path, init] of [
      ['/api/v1/sync/citius/notificacoes', { method: 'POST', body: runBody() }],
      ['/api/v1/sync/citius/notificacoes/state', {}],
    ] as const) {
      const withToken = await api(path, t, init);
      const without = await api(path, undefined, init);
      expect(withToken.status).toBe(404);
      expect(without.status).toBe(404);
      const body = await json(withToken);
      expect(ErrorEnvelope.safeParse(body).success).toBe(true);
      expect((body.error as { code: string }).code).toBe('NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// 1b. the hosted-typist permit - this rail obeys the same rule as every other consumer
// ---------------------------------------------------------------------------

/**
 * P4.1 - WHO MAY TYPE A LAWYER'S COURT PASSWORD INTO THE HOSTED BROWSER.
 *
 * `ensureSession` opens THIS PROCESS's Chromium and submits a password only when handed a
 * `hostedTypist` permit, and the run loop composes that permit from the origin's POSTURE. This rail
 * briefly composed it by writing `hostedTypist: {}` into the call - an unconditional yes, for a
 * court portal, from a datacenter IP, whatever anyone had declared. That is both the substitution
 * P4.1 exists to stop, performed by the one act that hands over a secret, and a per-consumer
 * exemption from a rule everything else obeys (Capability Contract rule 3).
 *
 * The permit is now composed at the router from `classifyOrigin`, and the sync drives a hard-coded
 * portal walk rather than a declared `IntegrationAction`, so nobody has ever declared it permissive
 * and the honest answer is NO. Asserted on the INPUT the rail actually received, because the seam is
 * injected here and a mock cannot be relied on to enforce what the real one would.
 *
 * SAID PLAINLY: THIS ASSERTS A CONSTANT, and it is worth having anyway. `classifyOrigin` returns the
 * frozen CLOSED classification whenever no action is passed, and `hostedTypistPermitForPortal`
 * passes none, so no `baseUrl` in the request body can make the permit appear - there is no input
 * that would red this by exercising the other branch. What it pins is the WIRING: that the router
 * composes the permit from posture at all rather than writing `hostedTypist: {}` into the call, which
 * is what it did before, and which no type or gate would have caught. The day the walk is promoted
 * onto a declared action and that action reaches `classifyOrigin` here, this stops being a constant
 * and starts being a real branch - see the docblock on `hostedTypistPermitForPortal`.
 */
describe('sync routes · the hosted typist gets no permit for an unclassified portal', () => {
  /**
   * `adv2`, not `adv1`. The sync state is keyed by the acting user (hazard 4 in `citius-sync.ts`),
   * and the walk lands rows + advances a watermark, so borrowing the same actor as the sync case
   * below would make ITS landed count depend on whether this block ran first.
   *
   * The run is answered with `needs-human` so nothing is enumerated at all: the assertion is about
   * the INPUT the rail composed, and the establishment call happens before any walk begins.
   */
  it('withholds the permit entirely rather than defaulting it open', async () => {
    sessionAnswer = async () => ({
      status: 'needs-human', route: 'attended', reason: 'a person must establish this', attempted: false,
    });
    const t = await tokenFor('adv2');
    const res = await api('/api/v1/sync/citius/notificacoes', t, { method: 'POST', body: runBody() });
    expect(res.status).toBe(200);
    expect(sessionInputs).toHaveLength(1);
    // ABSENT, not `{}`: presence IS the permission, so an empty object would be a yes.
    expect(sessionInputs[0]).not.toHaveProperty('hostedTypist');
    // ...and no residential machine either. The sync replays the captured session over SERVER-SIDE
    // HTTP with no proxy seam, so claiming a machine would make checkout RELEASE a
    // residential-bound session this rail would then replay from a datacenter IP - the exact
    // vantage mismatch checkout exists to refuse.
    expect(sessionInputs[0]).not.toHaveProperty('residentialAvailable');
  });
});

// ---------------------------------------------------------------------------
// 2. dashboard auth — and NOT the capability surface
// ---------------------------------------------------------------------------

describe('sync routes · dashboard auth only', () => {
  it('an unauthenticated call is 401 with a schema-valid envelope', async () => {
    const res = await api('/api/v1/sync/citius/notificacoes', undefined, { method: 'POST', body: runBody() });
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body.error as { code: string }).code).toBe('UNAUTHENTICATED');
  });

  it('a garbage bearer token is 401, not a 500', async () => {
    const res = await api('/api/v1/sync/citius/notificacoes/state', 'not-a-jwt');
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await json(res)).success).toBe(true);
  });

  it('the router is REALLY MOUNTED in the app factory (the wiring, pinned)', async () => {
    // This surface carries no descriptor, so neither the mount-coverage nor the OpenAPI gate can
    // see it: without this test, deleting the `app.use('/api/v1/sync', …)` line in server.ts would
    // red nothing. With the flag ON, a MOUNTED router answers 401 to an anonymous call (its own
    // requireAuth); an UNMOUNTED path falls through to the app's 404. The two are distinguishable,
    // which is what makes this a real assertion rather than a smoke test.
    const app = buildApp(
      { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() },
      deps,
    );
    const booted = await new Promise<Server>((r) => { const s = app.listen(0, () => r(s)); });
    try {
      const p = (booted.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${p}/api/v1/sync/citius/notificacoes/state`);
      expect(res.status).toBe(401);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);

      // …and with the flag OFF the same mounted route answers 404 — proving the 401 above came
      // from the router and not from an accidental match somewhere else.
      delete process.env[CITIUS_SYNC_FLAG];
      const off = await fetch(`http://127.0.0.1:${p}/api/v1/sync/citius/notificacoes/state`);
      expect(off.status).toBe(404);
      expect(ErrorEnvelope.safeParse(await off.json()).success).toBe(true);
    } finally {
      booted.close();
    }
  }, 60_000);

  it('the sync is DELIBERATELY ABSENT from the public contract (RUN_SPEC non-goal)', () => {
    const paths = Object.values(ALL_ENDPOINTS).flatMap((map) =>
      Object.values(map as Record<string, { path: string }>).map((d) => d.path),
    );
    expect(paths.length).toBeGreaterThan(50); // NON-VACUITY: the scan really sees the contract
    expect(paths.some((p) => p.includes('/sync/'))).toBe(false);
    // …and the router mounts NO key admission: a gateway key has no door here at all.
    const routeSrc = String(syncRouter);
    expect(routeSrc).not.toContain('requireUserOrApiKey');
  });
});

// ---------------------------------------------------------------------------
// 3. the run — every response against its named schema
// ---------------------------------------------------------------------------

describe('sync routes · POST /citius/notificacoes', () => {
  it('runs a real sync and answers a schema-valid `ran` outcome carrying a schema-valid report', async () => {
    mock.scenario({ cmd: 'addItems', count: 3 });
    const t = await tokenFor('adv1');
    const res = await api('/api/v1/sync/citius/notificacoes', t, { method: 'POST', body: runBody() });
    expect(res.status).toBe(200);
    const body = await json(res);

    const parsed = SyncRunOutcome.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    expect(body.status).toBe('ran');
    expect(SyncRunReport.safeParse(body.report).success).toBe(true);
    const report = body.report as { outcome: string; landed: number };
    expect(report.outcome).toBe('complete');
    expect(report.landed).toBe(5);
  }, 60_000);

  it('never leaks the Cofre item id onto the wire', async () => {
    const t = await tokenFor('adv1');
    const res = await api('/api/v1/sync/citius/notificacoes', t, { method: 'POST', body: runBody() });
    const raw = JSON.stringify(await json(res));
    expect(raw).not.toContain('cofre-item-citius');
    expect(raw).not.toContain('ASP.NET_SessionId');
  }, 60_000);

  it('a needs-human establishment is a 200 outcome, not an error — and says whether a login was spent', async () => {
    sessionAnswer = async () => ({
      status: 'needs-human', route: 'attended', reason: 'cartão de advogado necessário', attempted: false,
    });
    const t = await tokenFor('adv1');
    const res = await api('/api/v1/sync/citius/notificacoes', t, { method: 'POST', body: runBody() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(SyncRunOutcome.safeParse(body).success).toBe(true);
    expect(body.status).toBe('needs-human');
    expect(body.attempted).toBe(false);
    expect(body.report).toBeUndefined(); // nothing ran, so there is no report to give
  });

  it('a needs-egress establishment is its own 200 outcome', async () => {
    sessionAnswer = async () => ({
      status: 'needs-egress', itemId: 'i1', required: { kind: 'residential', pairingId: 'pair-7' },
    });
    const t = await tokenFor('adv1');
    const res = await api('/api/v1/sync/citius/notificacoes', t, { method: 'POST', body: runBody() });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(SyncRunOutcome.safeParse(body).success).toBe(true);
    expect(body.status).toBe('needs-egress');
  });

  it('a locked credential is a 403 with a schema-valid envelope — the kill switch, not a fault', async () => {
    sessionAnswer = async () => { throw new CofreLockedError('bloqueado'); };
    const t = await tokenFor('adv1');
    const res = await api('/api/v1/sync/citius/notificacoes', t, { method: 'POST', body: runBody() });
    expect(res.status).toBe(403);
    const body = await json(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body.error as { code: string }).code).toBe('FORBIDDEN');
    expect(JSON.stringify(body)).not.toContain('bloqueado'); // the message is ours, not the layer's
  });

  it('a malformed body is 400 VALIDATION_FAILED, schema-valid', async () => {
    const t = await tokenFor('adv1');
    const res = await api('/api/v1/sync/citius/notificacoes', t, {
      method: 'POST', body: JSON.stringify({ maxPages: -3 }),
    });
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body.error as { code: string }).code).toBe('VALIDATION_FAILED');
  });
});

// ---------------------------------------------------------------------------
// 4. the state read, and per-user scoping
// ---------------------------------------------------------------------------

describe('sync routes · GET /citius/notificacoes/state', () => {
  it('answers a schema-valid state view before any run has happened', async () => {
    const t = await tokenFor('adv2');
    const res = await api('/api/v1/sync/citius/notificacoes/state', t);
    expect(res.status).toBe(200);
    const body = await json(res);
    const parsed = SyncStateView.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.success ? {} : parsed.error.issues)).toBe(true);
    expect(body.watermark).toBeNull();
    expect(body.latest).toBeUndefined();
  });

  it('ONE ORG IS NOT ONE INBOX: a colleague\'s sync does not move this caller\'s watermark', async () => {
    mock.scenario({ cmd: 'addItems', count: 3 });
    const t1 = await tokenFor('adv1');
    const ran = await api('/api/v1/sync/citius/notificacoes', t1, { method: 'POST', body: runBody() });
    expect(ran.status).toBe(200);

    const mine = await json(await api('/api/v1/sync/citius/notificacoes/state', t1));
    expect(SyncStateView.safeParse(mine).success).toBe(true);
    expect(mine.watermark).not.toBeNull();
    expect((mine.latest as { outcome: string }).outcome).toBe('complete');

    // adv2 shares the org and shares nothing else: their cursor is still at the beginning
    const t2 = await tokenFor('adv2');
    const theirs = await json(await api('/api/v1/sync/citius/notificacoes/state', t2));
    expect(SyncStateView.safeParse(theirs).success).toBe(true);
    expect(theirs.watermark).toBeNull();
    expect(theirs.landed).toBe(0);
  }, 60_000);
});
