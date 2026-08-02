import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { triggers, webhookAudit, eventQueue, integrationConfigs, integrationDefinitions } from '../../src/data/stores.js';
import { handleIngress, handleGetCallbackIngress, createTrigger, type TriggerDoc } from '../../src/events/service.js';
import { createConfig } from '../../src/integrations/service.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import type { Actor } from '@ekoa/shared';

/**
 * Webhook POLICY reads are TENANT-SCOPED under the trigger's owner (slice A3, A2-residual 2).
 *
 * `secretSourceFor`/`getCallbackConfigFor` used to read the process-wide MERGED disk cache — the
 * last two consumers of it — so one tenant's runtime package could steer how EVERY tenant's
 * deliveries were verified. Now the definition resolves through the A2 registry with
 * `actorForOwnedRow(trigger.orgId, trigger.ownerUserId)`. These cases are the ACTOR ASSERTIONS
 * for the two events/ call sites (the A2 TEST-GAP): an org-scoped stored definition steers ITS
 * org's trigger and provably NOT another org's trigger with the very same integration key — a
 * wrong actor at either site cannot pass both sides.
 *
 * Plus the fail-closed floor: an org-less trigger (broken row) answers 500 on BOTH ingress rails
 * and never enqueues — the listener-supervisor precedent (commit fb72df7) applied to webhooks.
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };

const ownerA: Actor = { userId: 'ownerA', orgId: 'orgA', role: 'user' };
const ownerB: Actor = { userId: 'ownerB', orgId: 'orgB', role: 'user' };

const sign = (secret: string, body: string): string =>
  'sha256=' + createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');

/** orgA's STORED (org-shared) definition for KEY, declaring the webhook policy under test. */
async function seedOrgADefinition(webhookConfig: Record<string, unknown>): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId: 'orgA', userId: 'ownerA', visibility: 'org', key: 'tenant-pay',
      displayName: 'Tenant Pay', configSchema: [], actions: [], skillMd: '# tenant-pay',
      webhookConfig,
    },
    { actor: ownerA },
  );
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_webhook_policy_scope');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  for (const s of [triggers, webhookAudit, eventQueue, integrationConfigs, integrationDefinitions]) await s.deleteMany({});
});

describe('secretSource policy is the OWNER org\'s definition, not a process-wide cache', () => {
  it('orgA\'s credentialField policy verifies orgA\'s trigger; orgB\'s SAME-KEY trigger stays on its own trigger secret', async () => {
    await seedOrgADefinition({ secretSource: { credentialField: 'hook_secret' } });
    await createConfig(ownerA, { integrationKey: 'tenant-pay', configValues: { hook_secret: 'A-cred-secret' } }, deps);

    const a = (await createTrigger(ownerA, { targetKind: 'automation', integrationKey: 'tenant-pay', eventName: 'paid', automationId: 'x', secret: 'A-trigger-secret' }, deps)).trigger;
    const b = (await createTrigger(ownerB, { targetKind: 'automation', integrationKey: 'tenant-pay', eventName: 'paid', automationId: 'x', secret: 'B-trigger-secret' }, deps)).trigger;

    const body = '{"paid":true}';
    // orgA's trigger verifies against the CREDENTIAL (its org's policy)…
    expect((await handleIngress(a._id, Buffer.from(body), sign('A-cred-secret', body), deps)).outcome).toBe('accepted');
    // …and NOT against its trigger secret (the credentialField policy replaced it).
    expect((await handleIngress(a._id, Buffer.from(`${body} `), sign('A-trigger-secret', `${body} `), deps)).status).toBe(401);

    // orgB's trigger for the SAME KEY: orgA's org-scoped definition is invisible to orgB, so the
    // policy read resolves nothing and the TRIGGER secret verifies — the actor at the call site
    // was provably the TRIGGER's org, not a global cache.
    expect((await handleIngress(b._id, Buffer.from(body), sign('B-trigger-secret', body), deps)).outcome).toBe('accepted');
    // The cross-check: orgA's credential secret does NOT verify orgB's trigger.
    expect((await handleIngress(b._id, Buffer.from(`${body} `), sign('A-cred-secret', `${body} `), deps)).status).toBe(401);
  });
});

describe('getCallback policy is likewise owner-org-scoped', () => {
  const cbConfig = {
    getCallback: { keyParam: 'chave', secretSource: { credentialField: 'anti_phishing_key' }, dedupParams: ['ref'], responseBody: 'OK' },
  };

  it('orgA\'s stored getCallback declaration applies to orgA\'s trigger and NOT to orgB\'s same-key trigger', async () => {
    await seedOrgADefinition(cbConfig);
    await createConfig(ownerA, { integrationKey: 'tenant-pay', configValues: { anti_phishing_key: 'A-key' } }, deps);

    const a = (await createTrigger(ownerA, { targetKind: 'automation', integrationKey: 'tenant-pay', eventName: 'paid', automationId: 'x' }, deps)).trigger;
    const b = (await createTrigger(ownerB, { targetKind: 'automation', integrationKey: 'tenant-pay', eventName: 'paid', automationId: 'x' }, deps)).trigger;

    // orgA's trigger IS a getCallback ingress under its org's declaration.
    const rA = await handleGetCallbackIngress(a._id, { chave: 'A-key', ref: 'R1' }, deps);
    expect(rA).toEqual({ status: 200, body: 'OK', outcome: 'accepted' });

    // orgB's trigger: the declaration is invisible to its org → NOT a getCallback integration for
    // it → null (falls through to the handshake path). A process-wide read would have answered.
    expect(await handleGetCallbackIngress(b._id, { chave: 'A-key', ref: 'R1' }, deps)).toBeNull();
  });
});

describe('an org-less trigger fails CLOSED on both rails (the fb72df7 precedent)', () => {
  async function insertBrokenTrigger(): Promise<string> {
    const id = deps.genId();
    await triggers.insert({
      _id: id, ownerUserId: 'ownerA', orgId: '', integrationKey: 'tenant-pay', eventName: 'paid',
      targetKind: 'automation', automationId: 'x', algorithm: 'hmac-sha256-hex', disabled: false,
    } as unknown as TriggerDoc as never);
    return id;
  }

  it('POST ingress: 500, audited, nothing enqueued — even with a correct trigger-shaped signature', async () => {
    const id = await insertBrokenTrigger();
    const body = '{"paid":true}';
    const res = await handleIngress(id, Buffer.from(body), sign('anything', body), deps);
    expect(res.status).toBe(500);
    expect(res.outcome).toBe('rejected_other');
    expect(await eventQueue.find({ triggerId: id })).toHaveLength(0);
    expect((await webhookAudit.find({ triggerId: id }))[0]).toMatchObject({ outcome: 'rejected_other' });
  });

  it('GET callback ingress: 500, never a silent fall-through, nothing enqueued', async () => {
    const id = await insertBrokenTrigger();
    const res = await handleGetCallbackIngress(id, { chave: 'x', ref: 'R1' }, deps);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
    expect(res!.outcome).toBe('rejected_other');
    expect(await eventQueue.find({ triggerId: id })).toHaveLength(0);
  });
});
