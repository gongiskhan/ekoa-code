import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig, defaultLlmConfig, type Config } from '../../src/config.js';
import { sseManager } from '../../src/events/sse-manager.js';
import { buildApp, usageUpdatedNotifier } from '../../src/server.js';
import { recordTokenEvent, __resetUsageNotifierForTests, __resetPlatformBilleeForTests, type TokenEventInput } from '../../src/billing/tracker.js';

/**
 * Finding 3 (§6.7 usage push): the tracker fires the injected usage notifier after each ledger
 * write, and the composition root (server.ts) MUST wire it to push `usage_updated` on the billee's
 * notifications channel (ch03 §3.6.4). Before the fix setUsageNotifier was never called, so the
 * push never fired. These cover the notifier function itself + the buildApp wiring end-to-end.
 */
let mem: MongoMemoryServer;
const T0 = 1_800_000_000_000;

const testConfig: Config = {
  port: 0,
  jwtSecret: 'test',
  encryptionKey: 'test',
  nodeEnv: 'test',
  llmChokepointBaseUrl: 'http://127.0.0.1:0/api/v1/llm',
  llm: defaultLlmConfig(),
};

const event = (over: Partial<TokenEventInput> = {}): TokenEventInput => ({
  billeeUserId: 'u1',
  attributionKind: 'user_work',
  agentType: 'chat',
  model: 'claude-haiku-4-5-20251001',
  tier: 'FAST',
  raw: { input: 100, output: 50, cacheCreate: 0, cacheRead: 0 },
  now: T0,
  ...over,
});

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test';
  process.env.JWT_SECRET = 'test';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_usage_push');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetUsageNotifierForTests();
  __resetPlatformBilleeForTests();
  for (const c of ['token_events', 'billing_accounts', 'settings', 'users']) {
    await getDb().collection(c).deleteMany({});
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  __resetUsageNotifierForTests();
});

describe('usageUpdatedNotifier (server.ts)', () => {
  it('emits a bare usage_updated poke on the billee notifications channel', () => {
    const emit = vi.spyOn(sseManager, 'emit').mockImplementation(() => {});
    usageUpdatedNotifier('userA');
    expect(emit).toHaveBeenCalledWith('notifications', 'userA', 'usage_updated', {});
  });

  it('skips an empty billee (platform admin id is resolved by the tracker before the poke)', () => {
    const emit = vi.spyOn(sseManager, 'emit').mockImplementation(() => {});
    usageUpdatedNotifier('');
    expect(emit).not.toHaveBeenCalled();
  });

  it('is fire-and-forget: an emit failure never throws back to the caller (§6.7)', () => {
    vi.spyOn(sseManager, 'emit').mockImplementation(() => { throw new Error('sse down'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => usageUpdatedNotifier('userA')).not.toThrow();
  });
});

describe('buildApp wires the usage push so a ledger write pokes the channel (Finding 3)', () => {
  it('recordTokenEvent fires usage_updated for the billee after buildApp wiring', async () => {
    const emit = vi.spyOn(sseManager, 'emit').mockImplementation(() => {});
    buildApp(testConfig); // composition root calls setUsageNotifier(usageUpdatedNotifier)
    await recordTokenEvent(event({ billeeUserId: 'u1' }));
    expect(emit).toHaveBeenCalledWith('notifications', 'u1', 'usage_updated', {});
  });
});
