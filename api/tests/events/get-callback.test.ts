import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { triggers, webhookAudit, eventQueue, integrationConfigs } from '../../src/data/stores.js';
import { createTrigger, handleGetCallbackIngress } from '../../src/events/service.js';
import { createConfig } from '../../src/integrations/service.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * GET-as-EVENT callback ingress (Ifthenpay-style, carried webhooks-handler semantics): the
 * provider confirms a payment with a plain GET + a shared anti-phishing key resolved from the
 * OWNER's decrypted credential field. Key verified timing-safe → 401; disabled AFTER the key
 * check → 410; dedup on the declared params; success + duplicate both answer the exact
 * responseBody the provider resends until it sees ('OK').
 */
let mem: MongoMemoryServer;
let fixtureRoot: string;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = { userId: 'owner-1', orgId: 'orgA', role: 'builder' as const };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  fixtureRoot = mkdtempSync(join(tmpdir(), 'ekoa-getcb-'));
  mkdirSync(join(fixtureRoot, 'payprov'), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'payprov', 'config.json'),
    JSON.stringify({
      version: '1.0',
      integrationKey: 'payprov',
      displayName: 'PayProv',
      authType: 'api_key',
      provider: 'payprov',
      category: 'test',
      configSchema: [],
      actions: [],
      webhookConfig: {
        getCallback: {
          keyParam: 'chave',
          secretSource: { credentialField: 'anti_phishing_key' },
          dedupParams: ['referencia', 'datahorapag'],
          responseBody: 'OK',
        },
      },
    }),
    'utf-8',
  );
  process.env.EKOA_INTEGRATIONS_DIR = fixtureRoot;
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_getcb');
}, 60_000);
afterAll(async () => {
  delete process.env.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions();
  rmSync(fixtureRoot, { recursive: true, force: true });
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  for (const s of [triggers, webhookAudit, eventQueue, integrationConfigs]) await s.deleteMany({});
});

async function seed(disabled = false) {
  await createConfig(actor, { integrationKey: 'payprov', configValues: { anti_phishing_key: 'K-secreta' } }, deps);
  const { trigger } = await createTrigger(
    actor,
    { targetKind: 'automation', integrationKey: 'payprov', eventName: 'payment', automationId: 'a1' },
    deps,
  );
  if (disabled) await triggers.update(trigger._id, (t) => ({ ...t, disabled: true }));
  return trigger._id;
}

const q = (chave: string, referencia = 'R1') => ({ chave, referencia, valor: '10.00', datahorapag: 'D1' });

describe('GET-callback ingress (Ifthenpay semantics)', () => {
  it('accepts a correct key with the exact responseBody, enqueues once, and dedups the replay', async () => {
    const id = await seed();
    const r1 = await handleGetCallbackIngress(id, q('K-secreta'), deps);
    expect(r1).toEqual({ status: 200, body: 'OK', outcome: 'accepted' });
    expect(await eventQueue.find({})).toHaveLength(1);

    // The provider resends until it sees OK — the duplicate ALSO answers OK, nothing re-queued.
    const r2 = await handleGetCallbackIngress(id, q('K-secreta'), deps);
    expect(r2).toEqual({ status: 200, body: 'OK', outcome: 'duplicate' });
    expect(await eventQueue.find({})).toHaveLength(1);

    // A different referencia is a NEW event.
    const r3 = await handleGetCallbackIngress(id, q('K-secreta', 'R2'), deps);
    expect(r3!.outcome).toBe('accepted');
    expect(await eventQueue.find({})).toHaveLength(2);
  });

  it('rejects a wrong key with 401 and queues nothing', async () => {
    const id = await seed();
    const r = await handleGetCallbackIngress(id, q('errada'), deps);
    expect(r!.status).toBe(401);
    expect(await eventQueue.find({})).toHaveLength(0);
  });

  it('a disabled trigger rejects 410 AFTER the key check (wrong key still 401)', async () => {
    const id = await seed(true);
    expect((await handleGetCallbackIngress(id, q('errada'), deps))!.status).toBe(401);
    expect((await handleGetCallbackIngress(id, q('K-secreta'), deps))!.status).toBe(410);
    expect(await eventQueue.find({})).toHaveLength(0);
  });

  it('returns null (falls through to the handshake path) for non-getCallback integrations', async () => {
    await createConfig(actor, { integrationKey: 'gh', configValues: {} }, deps).catch(() => undefined);
    const { trigger } = await createTrigger(
      actor,
      { targetKind: 'automation', integrationKey: 'gh', eventName: 'push', automationId: 'a1', secret: 's' },
      deps,
    );
    expect(await handleGetCallbackIngress(trigger._id, q('x'), deps)).toBeNull();
  });

  it('missing owner credential → 500 secret-unavailable (never a silent accept)', async () => {
    // Trigger exists but NO integration config row for the owner.
    const { trigger } = await createTrigger(
      actor,
      { targetKind: 'automation', integrationKey: 'payprov', eventName: 'payment', automationId: 'a1' },
      deps,
    );
    const r = await handleGetCallbackIngress(trigger._id, q('K-secreta'), deps);
    expect(r!.status).toBe(500);
    expect(await eventQueue.find({})).toHaveLength(0);
  });
});
