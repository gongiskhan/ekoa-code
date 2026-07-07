import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
// @ts-expect-error - JS mock helper, no d.ts
import { startMockPipedream } from '../helpers/mock-pipedream-server.mjs';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, settings, billingAccounts, tokenEvents } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import {
  savePipedreamConfig,
  removePipedreamConfig,
  getPipedreamStatus,
  getConnectToken,
  listConnectedAccounts,
  disconnectAccount,
  runPipedreamAction,
  resetPipedreamCaches,
  type PipedreamDeps,
} from '../../src/integrations/pipedream.js';

/**
 * G8: the Pipedream Connect layer (ch03 §3.8.16). Functional coverage rides the pinned mock
 * server (helpers/mock-pipedream-server.mjs) via the injected transport; the SSRF-guard case uses
 * the DEFAULT (guarded) transport with a private base URL to prove an external call to a private
 * address is refused. Credentials are stored org-scoped + encrypted; the run path is gated by the
 * master toggle and the billing allowance and metered.
 */
let mem: MongoMemoryServer;
let mock: Awaited<ReturnType<typeof startMockPipedream>>;

const admin = { userId: 'admin1', orgId: 'orgA', role: 'org-admin' } as const;
const user = { userId: 'user1', orgId: 'orgA', role: 'builder' } as const;

/** Transport pointed at the local mock (the guarded default would block a 127.0.0.1 mock). */
function mockDeps(): PipedreamDeps {
  return { baseUrl: mock.url, fetchImpl: (url, init) => fetch(url, init as RequestInit) };
}

async function configure() {
  await savePipedreamConfig(admin, { clientId: 'cid', clientSecret: 'csecret', projectId: 'proj_1', environment: 'production' });
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_pipedream');
  mock = await startMockPipedream();
}, 60_000);

afterAll(async () => {
  await mock.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  resetPipedreamCaches();
  mock.reset();
  for (const s of [integrationConfigs, settings, billingAccounts, tokenEvents]) await s.deleteMany({});
});

describe('Pipedream config + status (ch03 §3.8.16)', () => {
  it('is not configured until an org config is saved; credentials are stored encrypted', async () => {
    expect((await getPipedreamStatus(user, mockDeps())).configured).toBe(false);
    const saved = await configure();
    void saved;
    const row = (await integrationConfigs.get('pipedream-orgA')) as { credentialsCiphertext?: string } | null;
    expect(row?.credentialsCiphertext).toBeTruthy();
    expect(row!.credentialsCiphertext).not.toContain('csecret');

    const status = await getPipedreamStatus(user, mockDeps());
    expect(status).toMatchObject({ configured: true, enabled: true });
    expect(status.accountCount).toBe(1); // the mock's default account
  });

  it('config is org-scoped — another org sees not configured', async () => {
    await configure();
    const otherOrgUser = { userId: 'x', orgId: 'orgB', role: 'builder' } as const;
    expect((await getPipedreamStatus(otherOrgUser, mockDeps())).configured).toBe(false);
  });

  it('removeConfig clears it', async () => {
    await configure();
    expect((await removePipedreamConfig(admin))).toEqual({ ok: true });
    expect((await getPipedreamStatus(user, mockDeps())).configured).toBe(false);
  });

  it('reports enabled:false when the master toggle is off', async () => {
    await configure();
    await settings.put({ _id: 'default', integration: { pipedreamEnabled: false } } as never);
    expect((await getPipedreamStatus(user, mockDeps())).enabled).toBe(false);
  });
});

describe('Pipedream connect link + accounts', () => {
  it('mints a connect token carrying the external_user_id', async () => {
    await configure();
    const tok = await getConnectToken(user, mockDeps());
    expect(tok.token).toMatch(/^ctok_/);
    expect(tok.connectLinkUrl).toContain('connect.html');
    expect(typeof tok.expiresAt).toBe('string');
  });

  it('lists and disconnects the user\'s accounts', async () => {
    await configure();
    const accounts = await listConnectedAccounts(user, mockDeps());
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: 'apn_mock1', app: 'slack' });
    await disconnectAccount(user, 'apn_mock1', mockDeps());
    expect(mock.stats.deletedAccounts).toContain('apn_mock1');
  });

  it('caches the client-credentials token across calls (2 runs → 1 token exchange)', async () => {
    await configure();
    const deps = mockDeps();
    await runPipedreamAction({ actor: user, app: 'slack', actionKey: 'send', args: {} }, deps);
    await runPipedreamAction({ actor: user, app: 'slack', actionKey: 'send', args: {} }, deps);
    expect(mock.stats.tokenCalls).toBe(1);
    expect(mock.stats.runCalls).toBe(2);
  });
});

describe('Pipedream action run — gating + metering', () => {
  it('runs when configured + enabled + allowed, and meters the attempt', async () => {
    await configure();
    const res = await runPipedreamAction({ actor: user, app: 'slack', actionKey: 'send_message', args: { text: 'hi' } }, mockDeps());
    expect(res.success).toBe(true);
    expect(mock.lastRun).toMatchObject({ id: 'send_message', external_user_id: 'user1' });
    // Metered: a token event was written for the billee.
    const events = await tokenEvents.find({});
    expect(events.length).toBeGreaterThan(0);
  });

  it('refuses (disabled) when the master toggle is off — no external call', async () => {
    await configure();
    await settings.put({ _id: 'default', integration: { pipedreamEnabled: false } } as never);
    const res = await runPipedreamAction({ actor: user, app: 'slack', actionKey: 'send', args: {} }, mockDeps());
    expect(res).toMatchObject({ success: false, code: 'disabled' });
    expect(mock.stats.runCalls).toBe(0);
  });

  it('refuses (not_configured) when the org has no config', async () => {
    const res = await runPipedreamAction({ actor: user, app: 'slack', actionKey: 'send', args: {} }, mockDeps());
    expect(res).toMatchObject({ success: false, code: 'not_configured' });
  });

  it('maps a provider error status to a coarse code without echoing the body', async () => {
    await configure();
    const res = await runPipedreamAction({ actor: user, app: 'slack', actionKey: 'error-429', args: {} }, mockDeps());
    expect(res).toMatchObject({ success: false, code: 'rate_limited' });
    expect(JSON.stringify(res)).not.toContain('simulated provider error');
  });
});

describe('Pipedream SSRF guard (default transport)', () => {
  it('refuses an external call to a private address via the guarded default transport', async () => {
    await configure();
    // No injected fetchImpl → the SSRF-guarded default; a link-local base URL must be refused.
    const res = await runPipedreamAction(
      { actor: user, app: 'slack', actionKey: 'send', args: {} },
      { baseUrl: 'http://169.254.169.254' },
    );
    expect(res).toMatchObject({ success: false, code: 'transport_error' });
    // The refusal message is generic — never the raw SSRF reason / URL.
    expect(res.error).not.toContain('169.254');
  });
});
