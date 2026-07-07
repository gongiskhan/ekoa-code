import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import {
  setCredential,
  getSecret,
  forceRefresh,
  claudeAuthStatus,
  buildSubprocessEnv,
  loadCredential,
  __setRefreshFnForTests,
  __setNowForTests,
  __resetCredentialsForTests,
} from '../../src/llm/credentials.js';

/**
 * Central credential custody (ch06 §6.2.4). The three owed semantics — proactive refresh
 * before expiry, refresh-and-retry-once on 401, and a persistent-failure alert that latches
 * `lastRefreshError` and flips `/health` `claudeAuth.ok` to false. No rotation-mutex /
 * pool / watchdog machinery exists to test — it is deleted.
 */
let mem: MongoMemoryServer;
const T0 = 1_800_000_000_000;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_llm_cred');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetCredentialsForTests();
  __setNowForTests(() => T0);
  await getDb().collection('credentials').deleteMany({});
});
afterEach(() => vi.restoreAllMocks());

describe('proactive refresh before expiry (oauth)', () => {
  it('refreshes when within the expiry margin and returns the new token', async () => {
    await setCredential({ mode: 'oauth', secret: 'tok1', refreshToken: 'rt1', expiresAt: T0 + 60 * 60 * 1000 });
    const refresh = vi.fn(async () => ({ secret: 'tok2', expiresAt: T0 + 2 * 60 * 60 * 1000, refreshToken: 'rt2' }));
    __setRefreshFnForTests(refresh);

    // Far from expiry: no refresh, original token.
    expect(await getSecret()).toBe('tok1');
    expect(refresh).not.toHaveBeenCalled();

    // Advance to within the 5-minute margin: proactive refresh fires.
    __setNowForTests(() => T0 + 60 * 60 * 1000 - 60 * 1000);
    expect(await getSecret()).toBe('tok2');
    expect(refresh).toHaveBeenCalledOnce();

    // The refreshed token is persisted (survives a reload) and auth is healthy.
    __resetCredentialsForTests();
    __setNowForTests(() => T0);
    await loadCredential();
    expect(await getSecret()).toBe('tok2');
    expect(claudeAuthStatus()).toMatchObject({ ok: true, configured: true, mode: 'oauth' });
  });
});

describe('refresh-and-retry-once on 401', () => {
  it('forceRefresh performs exactly one refresh and returns the new secret', async () => {
    await setCredential({ mode: 'oauth', secret: 'stale', refreshToken: 'rt1', expiresAt: T0 + 60 * 60 * 1000 });
    const refresh = vi.fn(async () => ({ secret: 'fresh', expiresAt: T0 + 60 * 60 * 1000 }));
    __setRefreshFnForTests(refresh);

    const next = await forceRefresh();
    expect(next).toBe('fresh');
    expect(refresh).toHaveBeenCalledOnce();
    expect(claudeAuthStatus().ok).toBe(true);
  });
});

describe('persistent failure latches lastRefreshError and flips claudeAuth.ok', () => {
  it('latches the alert once and reports ok:false with lastRefreshError', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: T0 + 60 * 60 * 1000 });
    __setRefreshFnForTests(async () => { throw new Error('refresh endpoint 500'); });

    await expect(forceRefresh()).rejects.toThrow(/refresh endpoint 500/);
    // A second failure must not re-log (latched exactly once), but stays failed.
    await expect(forceRefresh()).rejects.toThrow();

    const status = claudeAuthStatus();
    expect(status.ok).toBe(false);
    expect(status.configured).toBe(true);
    expect(status.lastRefreshError).toMatch(/forced refresh failed/);
    expect(err).toHaveBeenCalledOnce(); // latched: logged exactly once
  });
});

describe('buildSubprocessEnv scrubs inherited provider env and injects per mode', () => {
  it('oauth mode injects CLAUDE_CODE_OAUTH_TOKEN + chokepoint base URL, scrubs ANTHROPIC_API_KEY', async () => {
    process.env.ANTHROPIC_API_KEY = 'leaked-key';
    process.env.ANTHROPIC_BASE_URL = 'https://provider.example';
    try {
      await setCredential({ mode: 'oauth', secret: 'oauth-tok', expiresAt: T0 + 60 * 60 * 1000 });
      const env = await buildSubprocessEnv();
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-tok');
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBe(loadConfig().llmChokepointBaseUrl);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
    }
  });

  it('api-key mode injects ANTHROPIC_API_KEY', async () => {
    await setCredential({ mode: 'api-key', secret: 'sk-test' });
    const env = await buildSubprocessEnv();
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBe(loadConfig().llmChokepointBaseUrl);
  });
});
