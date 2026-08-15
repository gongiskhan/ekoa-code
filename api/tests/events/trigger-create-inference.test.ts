import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { triggers } from '../../src/data/stores.js';
import { createTrigger, type TriggerDoc } from '../../src/events/service.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * Listener-kind inference at trigger CREATE time (2A-S2, dev parity: triggers-handler's
 * isPlatformProvider branch). A platform provider (M365 / Google Workspace) has no webhook
 * ingress - the supervisor polls kind:'listener' rows only - so createTrigger must stamp
 * kind + pollConfig itself; otherwise the product path creates a webhook-kind row NOTHING
 * polls and the mailbox watch is silently dead while reporting success.
 */
let mem: MongoMemoryServer; let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = { userId: 'u1', orgId: 'orgA', role: 'user' as const };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_trigger_inference');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });
beforeEach(async () => { await triggers.deleteMany({}); });

const backendTarget = { targetKind: 'artifact-backend' as const, artifactId: 'art-1', entrypoint: 'onEmail' };

describe('createTrigger listener inference (2A-S2)', () => {
  it('microsoft-365 => kind listener + pollConfig from the platform config (60s default)', async () => {
    const { trigger } = await createTrigger(actor, { ...backendTarget, integrationKey: 'microsoft-365', eventName: 'email.received' }, deps);
    expect(trigger.kind).toBe('listener');
    expect(trigger.pollConfig).toEqual({ actionName: 'list_emails', intervalMs: 60_000 });
    // The supervisor discovers listeners with find({ kind: 'listener' }) - the row must MATCH.
    const polled = (await triggers.find({ kind: 'listener' })) as TriggerDoc[];
    expect(polled.map((t) => t._id)).toContain(trigger._id);
  });

  it('google-workspace => kind listener + its own poll action', async () => {
    const { trigger } = await createTrigger(actor, { ...backendTarget, integrationKey: 'google-workspace', eventName: 'email.received' }, deps);
    expect(trigger.kind).toBe('listener');
    expect(trigger.pollConfig).toEqual({ actionName: 'list_emails', intervalMs: 60_000 });
  });

  it('pollIntervalMs overrides the cadence, never the poll action', async () => {
    const { trigger } = await createTrigger(actor, { ...backendTarget, integrationKey: 'microsoft-365', eventName: 'email.received', pollIntervalMs: 30_000 }, deps);
    expect(trigger.pollConfig).toEqual({ actionName: 'list_emails', intervalMs: 30_000 });
  });

  it('a platform provider is a listener even if the caller says webhook (dev parity: nothing could deliver to it)', async () => {
    const { trigger } = await createTrigger(actor, { ...backendTarget, integrationKey: 'microsoft-365', eventName: 'email.received', kind: 'webhook' }, deps);
    expect(trigger.kind).toBe('listener');
    expect(trigger.pollConfig?.actionName).toBe('list_emails');
  });

  it('non-platform provider stays webhook-implicit: no kind field persisted, no pollConfig', async () => {
    const { trigger } = await createTrigger(actor, { targetKind: 'automation', integrationKey: 'gh', eventName: 'push', automationId: 'auto-1' }, deps);
    expect(trigger.kind).toBeUndefined();
    expect(trigger.pollConfig).toBeUndefined();
    // Migration-free semantic: the stored row carries NO kind field at all.
    const stored = (await triggers.get(trigger._id)) as TriggerDoc;
    expect('kind' in stored && stored.kind !== undefined).toBe(false);
    expect(await triggers.find({ kind: 'listener' })).toHaveLength(0);
  });

  it('an explicit non-platform listener keeps its caller-supplied pollConfig (2A-S1 semantics unchanged)', async () => {
    const { trigger } = await createTrigger(actor, {
      targetKind: 'automation', integrationKey: 'citius', eventName: 'notificacao', automationId: 'auto-2',
      kind: 'listener', pollConfig: { actionName: 'consultar_notificacoes', intervalMs: 120_000 },
    }, deps);
    expect(trigger.kind).toBe('listener');
    expect(trigger.pollConfig).toEqual({ actionName: 'consultar_notificacoes', intervalMs: 120_000 });
  });
});
