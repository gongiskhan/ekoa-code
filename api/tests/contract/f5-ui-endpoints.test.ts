import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, knowledgeSources, bridgePairings } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { managedAutomationId } from '../../src/automation/integration-automations.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import * as bridgeRegistry from '../../src/bridge/registry.js';
import { __resetCeremoniesForTests, __openCeremonyCount } from '../../src/bridge/attended.js';
import { __resetCrawlRunnerForTests } from '../../src/knowledge/crawl/runner.js';
import {
  KnowledgeSource, CrawlStartResponse, CrawlStatusResponse, RefreshScheduleResponse,
  SessionCaptureStatus, ConnectSessionResponse, ProvisionAutomationsResponse, ErrorEnvelope,
} from '@ekoa/shared';

/**
 * F5 subset (batch-1 S6): the knowledge + integrations endpoints the dashboard calls. Several have
 * NO backing infrastructure (no crawler; no server-side session-capture orchestration). Per the F5
 * brief those get HONEST contract-valid minimal implementations: they answer the declared shape
 * with truthful "nothing happened" values and NEVER fabricate a completed crawl or a captured
 * session. A fake success here would be worse than the 404 it replaces.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_f5_ui_endpoints');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  // Ceremonies and registry spies are PROCESS state, not store state: `__resetCeremoniesForTests`
  // was imported here but never called, so an open ceremony and a mocked `getConnectionByOwner`
  // both survived into the next test. That stayed invisible while no test asserted on a CLEAN
  // starting point, and became an order-dependent failure the moment one did.
  __resetCeremoniesForTests(); vi.restoreAllMocks();
  __resetCrawlRunnerForTests();
  await users.deleteMany({}); await orgs.deleteMany({}); await knowledgeSources.deleteMany({});
  await bridgePairings.deleteMany({});
  await orgs.insert({ _id: 'orgA', name: 'A', createdAt: 'x' } as never);
  await orgs.insert({ _id: 'orgB', name: 'B', createdAt: 'x' } as never);
  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true });
  setActivation('u1', { active: true, billingLocked: false });
});
const tokenFor = async () => (await login('u1', 'pw123456', false, deps)).token;

const seedSource = () =>
  knowledgeSources.insert({ _id: 's1', orgId: 'orgA', url: 'https://exemplo.pt', kind: 'web', seedId: 'seed-1' } as never);
const seedForeignSource = () =>
  knowledgeSources.insert({ _id: 's-other', orgId: 'orgB', url: 'https://outra.pt', kind: 'web' } as never);

describe('knowledge: PATCH /sources/:id', () => {
  it('updates a source and returns a contract-valid KnowledgeSource', async () => {
    await seedSource();
    const t = await tokenFor();
    const res = await authed('/api/v1/knowledge/sources/s1', t, { method: 'PATCH', body: JSON.stringify({ enabled: false, collection: 'docs' }) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(KnowledgeSource.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.id).toBe('s1');
    expect(body.enabled).toBe(false);
    expect(body.collection).toBe('docs');
    // sourceView aligned to the contract: `kind` surfaces as `type`. WS8c split the earlier
    // naming collision - `seedId` (the internal idempotent-seed marker) and `seedTemplate` (the
    // real `{url,from,to,step}` object) are now two distinct wire fields, never conflated.
    expect(body.type).toBe('web');
    expect(body.seedId).toBe('seed-1');
    expect(body.seedTemplate).toBeNull();
  });

  it('another org\'s source is invisible: 404 envelope, nothing written', async () => {
    await seedForeignSource();
    const t = await tokenFor();
    const res = await authed('/api/v1/knowledge/sources/s-other', t, { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect((await knowledgeSources.get('s-other') as unknown as { enabled?: boolean }).enabled).toBeUndefined();
  });
});

describe('knowledge: crawl endpoints (WS8c - real crawler; trigger gated to super-admin)', () => {
  /**
   * `url` is a LOOPBACK address that `assertSafeUrl` refuses synchronously, zero live network:
   * `startCrawl` still reserves the run and answers `started:true` (the reservation and the HTTP
   * response happen before the background crawl's first fetch attempt), then the background job
   * settles to `state:'error'` on its own. This file only proves the ENDPOINTS' wire contract and
   * the auth gate - real HTTP transport against saved fixtures is covered separately in
   * `tests/knowledge/crawl/*.test.ts`. Never point this at a real hostname (WS8c constraint: no
   * test may make a live request to a real site).
   */
  const seedCrawlableSource = () =>
    knowledgeSources.insert({ _id: 's1', orgId: 'orgA', url: 'http://127.0.0.1:1/refused-by-ssrf', kind: 'crawl' } as never);
  const mkSuperAdmin = async () => {
    await users.insert({ _id: 'admin1', username: 'admin1', passwordHash: await hashPassword('pw123456'), role: 'super-admin', orgId: 'orgA', active: true });
    setActivation('admin1', { active: true, billingLocked: false });
    return (await login('admin1', 'pw123456', false, deps)).token;
  };

  it('POST /sources/:id/crawl is refused for a plain user (403) - writing into `_shared` is privileged, unlike browsing it', async () => {
    await seedSource();
    const t = await tokenFor();
    const res = await authed('/api/v1/knowledge/sources/s1/crawl', t, { method: 'POST' });
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('POST /sources/:id/crawl as super-admin genuinely starts a run (started:true), settling to an honest error with zero live network', async () => {
    await seedCrawlableSource();
    const admin = await mkSuperAdmin();
    const res = await authed('/api/v1/knowledge/sources/s1/crawl', admin, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(CrawlStartResponse.safeParse(body).success).toBe(true);
    expect(body.started).toBe(true);
    expect(body.alreadyRunning).toBe(false);

    // Poll status until the (fast - no network ever attempted) background run settles.
    let status: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      status = await readJson(await authed('/api/v1/knowledge/sources/s1/crawl', admin));
      if (status.running === false) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(CrawlStatusResponse.safeParse(status).success).toBe(true);
    expect(status.running).toBe(false);
    expect((status.progress as Record<string, unknown> | undefined)?.state).toBe('error');
  });

  it('a second POST while one is in flight answers alreadyRunning:true, never a duplicate run', async () => {
    await seedCrawlableSource();
    const admin = await mkSuperAdmin();
    const first = authed('/api/v1/knowledge/sources/s1/crawl', admin, { method: 'POST' });
    const second = await readJson(await authed('/api/v1/knowledge/sources/s1/crawl', admin, { method: 'POST' }));
    expect(second.started).toBe(false);
    expect(second.alreadyRunning).toBe(true);
    await first; // drain the in-flight request before the test ends
  });

  it('GET /sources/:id/crawl (crawlStatus, ordinary `user` tier) validates with no run yet: running:false, no progress, real ledger stats', async () => {
    await seedCrawlableSource();
    const t = await tokenFor();
    const res = await authed('/api/v1/knowledge/sources/s1/crawl', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(CrawlStatusResponse.safeParse(body).success).toBe(true);
    expect(body.running).toBe(false);
    expect(body.progress).toBeUndefined();
    expect(body.stats).toMatchObject({ total: 0, pending: 0, ok: 0, error: 0, withDoc: 0 });
  });

  it('crawl endpoints 404 on another org\'s source (POST checked as super-admin, GET as an ordinary user)', async () => {
    await seedForeignSource();
    const admin = await mkSuperAdmin();
    const postRes = await authed('/api/v1/knowledge/sources/s-other/crawl', admin, { method: 'POST' });
    expect(postRes.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await readJson(postRes)).success).toBe(true);

    const t = await tokenFor();
    const getRes = await authed('/api/v1/knowledge/sources/s-other/crawl', t);
    expect(getRes.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await readJson(getRes)).success).toBe(true);
  });

  it('GET /knowledge/refresh-schedule answers a REAL ScheduleInfo (WS8c - the scheduler is real now, never null)', async () => {
    const t = await tokenFor();
    const res = await authed('/api/v1/knowledge/refresh-schedule', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(RefreshScheduleResponse.safeParse(body).success).toBe(true);
    const schedule = body.schedule as Record<string, unknown>;
    expect(schedule).toBeTruthy();
    expect(typeof schedule.enabled).toBe('boolean');
    expect(schedule.hour).toBeGreaterThanOrEqual(0);
    expect(schedule.hour).toBeLessThanOrEqual(23);
    expect(typeof schedule.nextRunAt).toBe('string');
  });
});

describe('integrations: session + provisioning (no capture infra — honest, never a fake captured session)', () => {
  // An UNKNOWN key is a 404 here for the same reason it is on every other `:key` route (A2): a key
  // the actor cannot see must be byte-identical to one that does not exist. The pre-ignition stub
  // answered 200 for any string because it never looked the key up — it had nothing to look up.
  it('GET|POST /:key/session on an unknown key is the uniform 404, not a blind 200', async () => {
    const t = await tokenFor();
    for (const init of [{}, { method: 'POST' as const }]) {
      const res = await authed('/api/v1/integrations/definitely-not-an-integration/session', t, init);
      expect(res.status).toBe(404);
    }
  });

  it('GET /:key/session on a NON-session integration says so, and claims no capture', async () => {
    const t = await tokenFor();
    const res = await authed('/api/v1/integrations/google-workspace/session', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(SessionCaptureStatus.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.status).toBe('none');
    expect((body.session as { status: string }).status).toBe('none');
    // `supported` is a property of the PACKAGE: google-workspace authenticates by OAuth, so session
    // capture does not apply to it at all.
    expect((body.sessionConnect as { supported: boolean }).supported).toBe(false);
    // The dashboard derefs `.actions` on this body (integrations page automation rows):
    // the contract carries an explicit (possibly empty) array, never undefined.
    expect(Array.isArray(body.actions), JSON.stringify(body)).toBe(true);
  });

  /**
   * The browser_session package with NO machine connected. This is the case the whole rail turns on:
   * `supported` is true (citius declares sessionConnect + authType browser_session) while
   * `available` is false (nothing is paired in this test process), and the two must not collapse
   * into one another — telling a user with no machine online that the feature does not exist is the
   * same class of untruth the old hardcoded stub told everyone.
   */
  it('GET /:key/session on a session integration separates supported from available', async () => {
    const t = await tokenFor();
    const res = await authed('/api/v1/integrations/citius/session', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(SessionCaptureStatus.safeParse(body).success, JSON.stringify(body)).toBe(true);
    const connect = body.sessionConnect as { supported: boolean; available: boolean; loginUrl?: string };
    expect(connect.supported).toBe(true);
    expect(connect.available).toBe(false); // no bridge paired in this process
    expect(connect.loginUrl).toBe('https://portal.tribunais.org.pt');
    expect(body.status).toBe('none'); // nothing captured, and it does not pretend otherwise
  });

  it('POST /:key/session REFUSES rather than queueing when no machine is connected', async () => {
    const t = await tokenFor();
    const res = await authed('/api/v1/integrations/citius/session', t, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ConnectSessionResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    // A ceremony needs a human AT the machine, so "we will ask when it comes back" would mean
    // asking at a moment nobody is standing there (bridge/attended.ts).
    expect(body.started).toBe(false);
    expect((body.session as { status: string }).status).toBe('failed');
    expect((body.session as { message: string }).message).toMatch(/máquina/i);
  });

  /**
   * THE PATH THAT MATTERS: a machine IS connected, so the ceremony actually opens.
   *
   * The two facts asserted are the ones the rail is built on. First, the request goes to a machine
   * resolved from the ACTOR — a caller-supplied pairingId would let one user pop a login prompt on
   * another user's screen and bank the session against their own org. Second, the ORIGIN Cortex
   * declares is the package's own `sessionConnect.loginUrl`, never anything the client sent, which
   * is what makes the returned session provably the session for the portal we asked about.
   */
  it('POST /:key/session opens a ceremony on the ACTOR\'s machine, for the PACKAGE\'s origin', async () => {
    const t = await tokenFor();
    // The machine must ADVERTISE the capability, not merely hold a socket — see the
    // "too old to capture" case below for what that distinction was added to stop.
    await bridgeRegistry.registerPairing({
      pairingId: 'pair-f5', org: 'orgA', ownerUserId: 'u1', capabilities: ['attended.card_login'],
    });
    vi.spyOn(bridgeRegistry, 'getConnectionByOwner').mockReturnValue({
      pairingId: 'pair-f5',
      org: 'orgA',
      ownerUserId: 'u1',
    } as unknown as ReturnType<typeof bridgeRegistry.getConnectionByOwner>);
    const sendToPairing = vi.spyOn(bridgeRegistry, 'sendToPairing').mockReturnValue(true);

    const res = await authed('/api/v1/integrations/citius/session', t, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ConnectSessionResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.started).toBe(true);
    expect((body.session as { status: string }).status).toBe('waiting_login');

    expect(sendToPairing).toHaveBeenCalledTimes(1);
    const [pairingId, frame] = sendToPairing.mock.calls[0] as [string, Record<string, unknown>];
    expect(pairingId).toBe('pair-f5'); // the actor's machine, not a request field
    expect(frame.type).toBe('attended.request');
    expect(frame.origin).toBe('https://portal.tribunais.org.pt'); // the package's origin
    expect(__openCeremonyCount()).toBe(1);

    // Still status metadata only — a started ceremony must not start leaking session material.
    const text = JSON.stringify(body);
    expect(text).not.toContain('storageState');
    expect(text).not.toContain('cookies');
  });

  /**
   * A LIVE SOCKET IS NOT A CAPABLE MACHINE — the regression this pins actually shipped.
   *
   * The bridge daemon's vendored wire contract did not carry `attended.request` at all, so the
   * frame failed its union and was dropped by the transport with no log line and no error path.
   * Cortex, meanwhile, checked only that SOME socket was open: `sendToPairing` returned true, the
   * GET said "Pronto: a sessão é capturada na sua máquina", the POST answered `started: true`, and
   * the ceremony sat open until it expired. Every layer reported success; no browser ever opened.
   *
   * Advertisement (I-1) is the fact that distinguishes the two, so both endpoints now ask for it.
   * A machine that has never sent `hello` advertises nothing — which is exactly the older daemon.
   */
  it('a connected machine that does NOT advertise the capability is reported as unusable, not ready', async () => {
    const t = await tokenFor();
    await bridgeRegistry.registerPairing({ pairingId: 'pair-old', org: 'orgA', ownerUserId: 'u1' });
    vi.spyOn(bridgeRegistry, 'getConnectionByOwner').mockReturnValue({
      pairingId: 'pair-old', org: 'orgA', ownerUserId: 'u1',
    } as unknown as ReturnType<typeof bridgeRegistry.getConnectionByOwner>);
    const sendToPairing = vi.spyOn(bridgeRegistry, 'sendToPairing').mockReturnValue(true);

    const get = await readJson(await authed('/api/v1/integrations/citius/session', t));
    const connect = get.sessionConnect as { supported: boolean; available: boolean; message: string };
    expect(connect.supported).toBe(true); // the PACKAGE still supports it
    expect(connect.available).toBe(false); // this MACHINE cannot do it
    expect(connect.message).toMatch(/antiga|atualize/i);

    // And the POST must refuse rather than promise: this is the call that says "a browser is
    // opening on your machine", so a `started: true` here is the lie the user actually sees.
    const post = await readJson(await authed('/api/v1/integrations/citius/session', t, { method: 'POST' }));
    expect(post.started).toBe(false);
    expect((post.session as { status: string }).status).toBe('failed');
    expect(sendToPairing).not.toHaveBeenCalled();
    expect(__openCeremonyCount()).toBe(0);
  });

  it('POST /:key/session on a NON-session integration answers failed, never started', async () => {
    const t = await tokenFor();
    const res = await authed('/api/v1/integrations/google-workspace/session', t, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ConnectSessionResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.started).toBe(false);
    expect((body.session as { status: string }).status).toBe('failed'); // the enum's honest value
  });

  it('the session responses never carry captured credential material (storageState/cookies)', async () => {
    const t = await tokenFor();
    for (const init of [{}, { method: 'POST' }]) {
      const text = await (await authed('/api/v1/integrations/citius/session', t, init)).text();
      expect(text).not.toContain('storageState');
      expect(text).not.toContain('cookies');
    }
  });

  it('POST /:key/provision-automations: unknown key → 404 envelope; a bound key MATERIALIZES managed automations idempotently', async () => {
    const t = await tokenFor();
    // Unknown definition → uniform 404 (the pre-provisioner stub answered fake zeros here).
    const missing = await authed('/api/v1/integrations/gmail/provision-automations', t, { method: 'POST' });
    expect(missing.status).toBe(404);

    // citius ships 4 automation-bound actions with repo-authored templates: provisioning
    // materializes them as org automations under the deterministic, ORG-SCOPED managed id
    // (C1 — the id used to be `citius-<template>` for every tenant, so the second org to
    // provision the package silently got nothing).
    const res = await authed('/api/v1/integrations/citius/provision-automations', t, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ProvisionAutomationsResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.provisioned).toBe(true);
    expect(body.created).toBe(4);
    const rows = body.actions as Array<{ provisioned: boolean; automationId: string | null; automationName: string | null; automationTemplate: string | null }>;
    expect(rows.filter((row) => row.provisioned)).toHaveLength(4);
    for (const row of rows.filter((r) => r.provisioned)) {
      // The caller is u1 of orgA: the id is the tenant's own, derived from (org, key, template).
      expect(row.automationId).toBe(managedAutomationId('orgA', 'citius', String(row.automationTemplate)));
      expect(row.automationName).toBeTruthy();
    }

    // Idempotent: a re-provision refreshes in place, never duplicates.
    const again = await readJson(await authed('/api/v1/integrations/citius/provision-automations', t, { method: 'POST' }));
    expect(again.created).toBe(0);
    expect(again.updated).toBe(4);

    // The session view reflects the materialized rows (the dashboard's card state).
    const session = await readJson(await authed('/api/v1/integrations/citius/session', t));
    const sRows = (session.actions ?? []) as Array<{ provisioned: boolean }>;
    expect(sRows.filter((row) => row.provisioned)).toHaveLength(4);
  });

  it('all three require auth (401 envelope)', async () => {
    for (const [m, p] of [['GET', '/session'], ['POST', '/session'], ['POST', '/provision-automations']] as const) {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/gmail${p}`, { method: m, headers: { 'content-type': 'application/json' } });
      expect(res.status).toBe(401);
      expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    }
  });
});
