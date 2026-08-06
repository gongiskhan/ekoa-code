import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { integrationConfigs, approvedIntegrationActions } from '../../src/data/stores.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import {
  AppEmailIntegrationsResponse,
  SendAppEmailResponse,
  CreateAppEmailDraftResponse,
  AppEmailInboxResponse,
  ErrorEnvelope,
} from '@ekoa/shared';
import { appEmailRouter } from '../../src/integrations/app-email.js';
import type { ResolvedAppScope } from '../../src/integrations/app-scope.js';
import type { CloudFilesStatus } from '../../src/integrations/app-cloud-files.js';

/**
 * CONTRACT: the served-app email plane `/api/app-email/*`.
 *
 * Two things are pinned here that the service-level suite cannot reach:
 *
 *  1. THE WIRE SHAPE. Every response validates against the shared zod schema — including the
 *     failure bodies, which ride a 502 and are still typed (an app reads `code`, not a status).
 *     Admission refusals speak the shared ERROR envelope, like every other served-app plane.
 *  2. ADMISSION. The header is the only identity, so what it admits is the security boundary: an
 *     unregistered app, a dev-serve app with no owner, an org-less owner and a deactivated or
 *     billing-locked owner all get nothing — and each is refused with the SAME shape, so the plane
 *     is not an existence oracle for apps a caller cannot otherwise see.
 *
 * The router takes injected seams (integrations/ may not import apps/), mounted on a bare express
 * app exactly as the composition root wires it.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;

const APPS: Record<string, ResolvedAppScope> = {
  app1: { appId: 'app1', ownerUserId: 'owner1', isServed: true, m365Proxy: false },
  slug1: { appId: 'app1', ownerUserId: 'owner1', isServed: true, m365Proxy: false },
  /** Registered, but its owner has no org — nothing to spend. */
  orgless: { appId: 'orgless', ownerUserId: 'ownerNoOrg', isServed: true, m365Proxy: false },
  /** A dev-serve id: resolvable, but carries no artifact owner. */
  devserve: { appId: 'devserve', ownerUserId: '', isServed: true, m365Proxy: false },
  /** Known to the resolver but NOT served. */
  unserved: { appId: 'unserved', ownerUserId: 'owner1', isServed: false, m365Proxy: false },
  dead: { appId: 'dead', ownerUserId: 'ownerDead', isServed: true, m365Proxy: false },
  locked: { appId: 'locked', ownerUserId: 'ownerLocked', isServed: true, m365Proxy: false },
};

const ORGS: Record<string, string> = { owner1: 'org1', ownerDead: 'org1', ownerLocked: 'org1' };

const status: CloudFilesStatus = {
  google: { connected: false, needsReauth: false },
  microsoft: { connected: false, needsReauth: true },
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_app_email_contract');

  const app = express();
  app.use('/api/app-email', appEmailRouter({
    resolveAppScope: async (idOrSlug) => APPS[idOrSlug] ?? null,
    resolveOwnerOrgId: async (userId) => ORGS[userId] ?? null,
    workspaceStatus: async () => status,
    oauth: { now: () => Date.now(), genId: () => 'id_0' },
  }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  setActivation('owner1', { active: true, billingLocked: false });
  setActivation('ownerDead', { active: false, billingLocked: false });
  setActivation('ownerLocked', { active: true, billingLocked: true });
  // Deliberately ACTIVE and in good standing: this owner's app must be refused for the one reason
  // under test — no org — rather than tripping the activation gate first and proving nothing.
  setActivation('ownerNoOrg', { active: true, billingLocked: false });
  await integrationConfigs.deleteMany({});
  await approvedIntegrationActions.deleteMany({});
});

const base = (): string => `http://127.0.0.1:${port}`;

function get(path: string, appId?: string): Promise<Response> {
  return fetch(`${base()}${path}`, { headers: appId ? { 'x-ekoa-app-id': appId } : {} });
}

function post(path: string, body: unknown, appId?: string): Promise<Response> {
  return fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(appId ? { 'x-ekoa-app-id': appId } : {}) },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Wire shape
// ---------------------------------------------------------------------------

describe('app-email contract — every response validates against the shared schema', () => {
  it('GET /integrations answers the typed listing', async () => {
    const res = await get('/api/app-email/integrations', 'app1');
    expect(res.status).toBe(200);
    const parsed = AppEmailIntegrationsResponse.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    // The stale-grant case reaches the app as `needsReauth`, not as a bare "not connected":
    // the difference is the whole point (reconnect vs connect).
    const m365 = parsed.success ? parsed.data.data.find((i) => i.integrationKey === 'microsoft-365') : undefined;
    expect(m365).toMatchObject({ connected: false, needsReauth: true, platform: true });
  });

  it('a slug resolves to the same app as its canonical id', async () => {
    const viaSlug = await get('/api/app-email/integrations', 'slug1');
    expect(viaSlug.status).toBe(200);
    expect(AppEmailIntegrationsResponse.safeParse(await viaSlug.json()).success).toBe(true);
  });

  it('a REFUSED send is a 502 carrying the typed failure body, not an error envelope', async () => {
    const res = await post(
      '/api/app-email/send',
      { integrationKey: 'microsoft-365', actionName: 'send_email', to: ['c@acme.pt'], subject: 'S', body: 'B' },
      'app1',
    );
    expect(res.status).toBe(502);
    const parsed = SendAppEmailResponse.safeParse(await res.json());
    expect(parsed.success).toBe(true);
    // Nothing is connected and nothing is approved, so the write gate answers first — by design,
    // so an unapproved caller cannot probe connection state.
    expect(parsed.success && parsed.data.code).toBe('awaiting_consent');
  });

  it('a refused DRAFT and DRAFT SEND validate against their own schemas', async () => {
    const draft = await post(
      '/api/app-email/draft',
      { integrationKey: 'microsoft-365', to: ['c@acme.pt'], subject: 'S', body: 'B' },
      'app1',
    );
    expect(CreateAppEmailDraftResponse.safeParse(await draft.json()).success).toBe(true);

    const send = await post('/api/app-email/draft/send', { integrationKey: 'microsoft-365', draftId: 'd1' }, 'app1');
    expect(SendAppEmailResponse.safeParse(await send.json()).success).toBe(true);
  });

  it('GET /inbox validates against its schema', async () => {
    const res = await get('/api/app-email/inbox?integrationKey=microsoft-365', 'app1');
    expect(AppEmailInboxResponse.safeParse(await res.json()).success).toBe(true);
  });

  it('a malformed body is a 400 in the shared ERROR envelope', async () => {
    const res = await post('/api/app-email/send', { integrationKey: 'microsoft-365' }, 'app1');
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it("GET /inbox without integrationKey is a 400 envelope, never a guess at 'the' provider", async () => {
    const res = await get('/api/app-email/inbox', 'app1');
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

describe('app-email contract — admission fails closed on every plane entry', () => {
  const ENTRIES: Array<[string, (appId?: string) => Promise<Response>]> = [
    ['GET /integrations', (a) => get('/api/app-email/integrations', a)],
    ['GET /inbox', (a) => get('/api/app-email/inbox?integrationKey=microsoft-365', a)],
    ['POST /send', (a) => post('/api/app-email/send', { integrationKey: 'microsoft-365', actionName: 'send_email', to: ['c@acme.pt'], subject: 'S', body: 'B' }, a)],
    ['POST /draft', (a) => post('/api/app-email/draft', { integrationKey: 'microsoft-365', to: ['c@acme.pt'], subject: 'S', body: 'B' }, a)],
    ['POST /draft/send', (a) => post('/api/app-email/draft/send', { integrationKey: 'microsoft-365', draftId: 'd1' }, a)],
  ];

  it.each(ENTRIES)('%s without the app-id header is a 400 envelope', async (_name, call) => {
    const res = await call(undefined);
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it.each(ENTRIES)('%s with an UNKNOWN app is a 404 envelope', async (_name, call) => {
    const res = await call('nope');
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it.each(ENTRIES)('%s on a NOT-SERVED app is a 404 envelope', async (_name, call) => {
    expect((await call('unserved')).status).toBe(404);
  });

  it.each(ENTRIES)('%s on a dev-serve app with no owner is a 404 envelope', async (_name, call) => {
    expect((await call('devserve')).status).toBe(404);
  });

  it.each(ENTRIES)('%s on an ORG-LESS owner is a 404 envelope — no org, no mailbox', async (_name, call) => {
    expect((await call('orgless')).status).toBe(404);
  });

  it.each(ENTRIES)('%s under a DEACTIVATED owner is 403 ACCOUNT_DISABLED', async (_name, call) => {
    const res = await call('dead');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });

  it.each(ENTRIES)('%s under a BILLING-LOCKED owner is 402 BILLING_LOCKED', async (_name, call) => {
    const res = await call('locked');
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body as { error: { code: string } }).error.code).toBe('BILLING_LOCKED');
  });

  it('the unknown-app and not-served refusals are INDISTINGUISHABLE', async () => {
    const unknown = await get('/api/app-email/integrations', 'nope');
    const unserved = await get('/api/app-email/integrations', 'unserved');
    expect(unknown.status).toBe(unserved.status);
    expect(await unknown.json()).toEqual(await unserved.json());
  });
});
