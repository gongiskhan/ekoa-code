import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, integrationConfigs } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import { connectPlatform, completeCallback, type PlatformHttp, type PlatformOAuthEnv, type OAuthDeps } from '../../src/integrations/platform-oauth.js';
import { integrationPrefetch, __resetPrefetchCacheForTests } from '../../src/integrations/prefetch.js';

/**
 * G8: the live integration pre-fetch (ch05 §5.5.2 layer 3). A keyword hit pre-fetches live
 * Google/Microsoft data into a prompt block via the platform API caller; a keyword-less follow-up
 * within the 60s TTL replays from cache with no second provider call; no keyword + cold cache
 * (or no connection / unknown user) returns ''. All provider HTTP is injected — never live.
 */
let mem: MongoMemoryServer;
let seq = 0;
let clock = 1_700_000_000_000;

const env: PlatformOAuthEnv = {
  google: { clientId: 'gid', clientSecret: 'gsecret', redirectBaseUrl: 'https://app.example' },
  microsoft: { clientId: 'mid', clientSecret: 'msecret', redirectBaseUrl: 'https://app.example', tenantId: 'common' },
};

interface FakeRes {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  headers: { forEach: () => void };
  statusText?: string;
}
function res(status: number, obj: unknown): FakeRes {
  return { ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj), headers: { forEach: () => undefined }, statusText: '' };
}

/** Fake transport: OAuth token/userinfo for connect, canned Gmail data for the API caller.
 *  Counts calls to the Gmail API so a cache hit can be proven (no second call). */
function makeHttp(): { http: PlatformHttp; gmailCalls: () => number } {
  let gmail = 0;
  const http: PlatformHttp = async (url) => {
    if (url.includes('oauth2.googleapis.com/token') || url.includes('login.microsoftonline.com')) {
      return res(200, { access_token: 'atk', refresh_token: 'rtk', token_type: 'Bearer', expires_in: 3600, scope: 'openid email' }) as unknown as Response;
    }
    if (url.includes('oauth2/v2/userinfo')) return res(200, { email: 'user@acme.pt' }) as unknown as Response;
    if (url.includes('gmail.googleapis.com')) {
      gmail += 1;
      if (url.includes('/messages/')) return res(200, { id: 'm1', payload: { headers: [{ name: 'Subject', value: 'Olá' }] } }) as unknown as Response;
      if (url.includes('/labels')) return res(200, { labels: [{ id: 'INBOX', name: 'INBOX' }] }) as unknown as Response;
      return res(200, { messages: [{ id: 'm1' }, { id: 'm2' }] }) as unknown as Response;
    }
    return res(200, { ok: true }) as unknown as Response;
  };
  return { http, gmailCalls: () => gmail };
}

function deps(http: PlatformHttp): OAuthDeps {
  return { now: () => clock, genId: () => `id_${seq++}`, http, env };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  delete process.env.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_prefetch');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  clock = 1_700_000_000_000;
  __resetPrefetchCacheForTests();
  await users.deleteMany({});
  await integrationConfigs.deleteMany({});
});

async function seedUser(userId: string, orgId: string) {
  await users.insert({ _id: userId, username: userId, passwordHash: 'x', role: 'user', orgId, active: true });
}
async function connectGoogle(orgId: string, http: PlatformHttp) {
  const admin = { userId: 'admin', orgId, username: 'admin' };
  const c = await connectPlatform(admin, 'google', deps(http));
  if (!c.ok) throw new Error('connect failed');
  await completeCallback('google', { code: 'code', state: c.state }, deps(http));
}

describe('integrationPrefetch (ch05 §5.5.2 layer 3)', () => {
  it('a keyword hit pre-fetches live data into a prompt block', async () => {
    const { http, gmailCalls } = makeHttp();
    await seedUser('u1', 'orgA');
    await connectGoogle('orgA', http);

    const block = await integrationPrefetch({ userId: 'u1', message: 'quantos emails tenho hoje?' }, { oauth: deps(http) });
    expect(block).toContain('Live Integration Data');
    expect(block).toContain('Google Workspace Data');
    expect(gmailCalls()).toBeGreaterThan(0);
  });

  it('a keyword-less follow-up within 60s replays from cache with no second provider call', async () => {
    const { http, gmailCalls } = makeHttp();
    await seedUser('u1', 'orgA');
    await connectGoogle('orgA', http);

    await integrationPrefetch({ userId: 'u1', message: 'ver os meus emails' }, { oauth: deps(http) });
    const afterFirst = gmailCalls();
    expect(afterFirst).toBeGreaterThan(0);

    clock += 30_000; // still inside the 60s TTL
    const followUp = await integrationPrefetch({ userId: 'u1', message: 'sim' }, { oauth: deps(http) });
    expect(followUp).toContain('Live Integration Data'); // served from the warm cache
    expect(gmailCalls()).toBe(afterFirst); // NO new provider call
  });

  it('re-fetches once the cache has expired past 60s', async () => {
    const { http, gmailCalls } = makeHttp();
    await seedUser('u1', 'orgA');
    await connectGoogle('orgA', http);

    await integrationPrefetch({ userId: 'u1', message: 'emails' }, { oauth: deps(http) });
    const afterFirst = gmailCalls();
    clock += 61_000; // past the TTL
    const again = await integrationPrefetch({ userId: 'u1', message: 'sim' }, { oauth: deps(http) });
    expect(again).toBe(''); // cache cold + no keyword → nothing
    // A fresh keyword hit re-fetches.
    await integrationPrefetch({ userId: 'u1', message: 'emails' }, { oauth: deps(http) });
    expect(gmailCalls()).toBeGreaterThan(afterFirst);
  });

  it('returns "" when no keyword fires and the cache is cold', async () => {
    const { http } = makeHttp();
    await seedUser('u1', 'orgA');
    await connectGoogle('orgA', http);
    expect(await integrationPrefetch({ userId: 'u1', message: 'olá, tudo bem?' }, { oauth: deps(http) })).toBe('');
  });

  it('returns "" when the org has no connected integration', async () => {
    const { http } = makeHttp();
    await seedUser('u1', 'orgA'); // seeded but never connected
    expect(await integrationPrefetch({ userId: 'u1', message: 'quantos emails?' }, { oauth: deps(http) })).toBe('');
  });

  it('returns "" for an unknown user (fail-soft)', async () => {
    const { http } = makeHttp();
    expect(await integrationPrefetch({ userId: 'ghost', message: 'emails' }, { oauth: deps(http) })).toBe('');
  });

  it('is cache-isolated per org — one org\'s data never serves another', async () => {
    const { http, gmailCalls } = makeHttp();
    await seedUser('u1', 'orgA');
    await seedUser('u2', 'orgB');
    await connectGoogle('orgA', http);
    await connectGoogle('orgB', http);

    await integrationPrefetch({ userId: 'u1', message: 'emails' }, { oauth: deps(http) });
    const afterA = gmailCalls();
    // orgB follow-up "sim" must NOT be served from orgA's warm cache → cold → ''.
    const bFollow = await integrationPrefetch({ userId: 'u2', message: 'sim' }, { oauth: deps(http) });
    expect(bFollow).toBe('');
    // orgB's own keyword hit fetches fresh (its own cache), proving no cross-org cache reuse.
    const bBlock = await integrationPrefetch({ userId: 'u2', message: 'emails' }, { oauth: deps(http) });
    expect(bBlock).toContain('Live Integration Data');
    expect(gmailCalls()).toBeGreaterThan(afterA);
  });
});
