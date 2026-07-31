import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Actor } from '@ekoa/shared';
import * as svc from '../../src/automation/service.js';
import { __resetAutomationSeamsForTests } from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import { automations, automationRuns, automationRunIdempotency, activityLogs } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';

/**
 * Idempotent run create (slice E4) at the SERVICE level — the layer where the dedupe key is
 * derived. The HTTP behaviour (202 vs 200, the header, the race) is covered by
 * tests/contract/automations.test.ts; what can only be pinned here is:
 *
 *  - the key spans (automationId, RUN OWNER, key) and is derived exactly that way, so the store
 *    layout cannot drift silently under a green HTTP test;
 *  - it is the RUN OWNER, not the caller: a super-admin running someone else's automation lands on
 *    the owner's dedupe entry, because the run it would create belongs to the owner;
 *  - a run that never started rolls its mapping back, so the key is not poisoned forever.
 */
const owner: Actor = { userId: 'u1', orgId: 'o1', role: 'user' };
const root: Actor = { userId: 'root', orgId: 'o-root', role: 'super-admin' };
const stranger: Actor = { userId: 'x1', orgId: 'o2', role: 'user' };

const dedupeId = (automationId: string, ownerUserId: string, key: string): string =>
  createHash('sha256').update(`${automationId}|${ownerUserId}|${key}`).digest('hex');

async function seedAutomation(id: string, ownerUserId = 'u1', orgId = 'o1'): Promise<void> {
  await automations.insert({
    _id: id,
    id,
    name: id,
    description: '',
    steps: [], // no steps → the engine finalises immediately; this suite is about the create path
    ownerUserId,
    orgId,
    createdAt: '',
    updatedAt: '',
  } as never);
}

describe('idempotent run create (slice E4)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_idempotency'));
  afterAll(shutdownAgentTestDb);
  beforeEach(() => {
    resetAgentState(); // fake LLM transport — nothing here reaches a model
    __resetAutomationSeamsForTests();
    __resetAutomationConfigForTests();
    svc.__resetAutomationServiceForTests();
  });
  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    await automationRunIdempotency.deleteMany({});
    await activityLogs.deleteMany({});
  });

  it('records the mapping under sha256(automationId|ownerUserId|key) and replays it', async () => {
    await seedAutomation('auto-1');
    const first = await svc.startRun(owner, 'auto-1', { idempotencyKey: 'k-1' });
    expect(first.created).toBe(true);

    const doc = await automationRunIdempotency.get(dedupeId('auto-1', 'u1', 'k-1'));
    expect(doc?.runId).toBe(first.runId);
    expect(typeof doc?.at).toBe('string');
    // The caller's key is never STORED, only hashed into the _id.
    expect(JSON.stringify(doc)).not.toContain('k-1');

    const replay = await svc.startRun(owner, 'auto-1', { idempotencyKey: 'k-1' });
    expect(replay).toEqual({ runId: first.runId, created: false });
  });

  it('a super-admin run lands on the OWNER key, not the caller — the run belongs to the owner', async () => {
    await seedAutomation('auto-2');
    // super-admin runs u1's automation: the run's owner is u1 (server-trusted), so that is what
    // the dedupe key must span.
    const asRoot = await svc.startRun(root, 'auto-2', { idempotencyKey: 'partilhada' });
    expect(asRoot.created).toBe(true);
    expect(await automationRunIdempotency.get(dedupeId('auto-2', 'u1', 'partilhada'))).toBeTruthy();
    expect(await automationRunIdempotency.get(dedupeId('auto-2', 'root', 'partilhada'))).toBeNull();

    const asOwner = await svc.startRun(owner, 'auto-2', { idempotencyKey: 'partilhada' });
    expect(asOwner).toEqual({ runId: asRoot.runId, created: false });
  });

  it('every component of the key discriminates: automation, owner, key', async () => {
    await seedAutomation('auto-a', 'u1');
    await seedAutomation('auto-b', 'u1');
    await seedAutomation('auto-c', 'u2', 'o1');

    const a = await svc.startRun(owner, 'auto-a', { idempotencyKey: 'kk' });
    const b = await svc.startRun(owner, 'auto-b', { idempotencyKey: 'kk' }); // different automation
    const c = await svc.startRun(owner, 'auto-a', { idempotencyKey: 'outra' }); // different key
    const d = await svc.startRun({ userId: 'u2', orgId: 'o1', role: 'user' }, 'auto-c', { idempotencyKey: 'kk' }); // different owner

    expect(new Set([a.runId, b.runId, c.runId, d.runId]).size).toBe(4);
    for (const [automationId, ownerUserId, key] of [
      ['auto-a', 'u1', 'kk'],
      ['auto-b', 'u1', 'kk'],
      ['auto-a', 'u1', 'outra'],
      ['auto-c', 'u2', 'kk'],
    ] as const) {
      expect(await automationRunIdempotency.get(dedupeId(automationId, ownerUserId, key)), `${automationId}|${ownerUserId}|${key}`).toBeTruthy();
    }
  });

  it('no key: nothing is written to the dedupe store and every call is a fresh run', async () => {
    await seedAutomation('auto-3');
    const a = await svc.startRun(owner, 'auto-3');
    const b = await svc.startRun(owner, 'auto-3', { inputs: { x: 1 } });
    expect(a.created && b.created).toBe(true);
    expect(a.runId).not.toBe(b.runId);
    expect(await automationRunIdempotency.find({})).toEqual([]);
  });

  it('authorization comes FIRST: a refused caller never plants a mapping', async () => {
    await seedAutomation('auto-4');
    await expect(svc.startRun(stranger, 'auto-4', { idempotencyKey: 'intruso' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A same-org non-owner is FORBIDDEN rather than NOT_FOUND, and equally plants nothing.
    await expect(svc.startRun({ userId: 'u9', orgId: 'o1', role: 'user' }, 'auto-4', { idempotencyKey: 'intruso' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await automationRunIdempotency.find({})).toEqual([]);
  });

  it('a run that never started rolls its mapping back, so the key stays usable', async () => {
    await seedAutomation('auto-5');
    const insert = vi.spyOn(automationRuns, 'insert').mockRejectedValueOnce(new Error('falha de escrita'));
    await expect(svc.startRun(owner, 'auto-5', { idempotencyKey: 'k-rollback' })).rejects.toThrow(/falha de escrita/);
    insert.mockRestore();

    expect(await automationRunIdempotency.get(dedupeId('auto-5', 'u1', 'k-rollback'))).toBeNull();
    const retry = await svc.startRun(owner, 'auto-5', { idempotencyKey: 'k-rollback' });
    expect(retry.created).toBe(true);
    expect((await automationRunIdempotency.get(dedupeId('auto-5', 'u1', 'k-rollback')))?.runId).toBe(retry.runId);
  });

  it('audits ONLY key-admitted creates (the JWT path is untouched), carrying keyId + x-client', async () => {
    await seedAutomation('auto-6');
    await svc.startRun(owner, 'auto-6', { idempotencyKey: 'sem-chave-api' });
    expect(await activityLogs.find({ category: 'automations' })).toEqual([]);

    const call = { principal: { keyId: 'gk-1', xClient: 'claude-code' }, username: 'ana' };
    const created = await svc.startRun(owner, 'auto-6', { idempotencyKey: 'com-chave' }, call);
    await svc.startRun(owner, 'auto-6', { idempotencyKey: 'com-chave' }, call); // replay

    const rows = (await activityLogs.find({ category: 'automations' })) as unknown as Array<{ type: string; username: string; metadata: Record<string, unknown> }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.type).toBe('automation_run_create');
      expect(row.username).toBe('ana');
      expect(row.metadata.keyId).toBe('gk-1');
      expect(row.metadata.xClient).toBe('claude-code');
      expect(row.metadata.runId).toBe(created.runId);
    }
    expect(rows.map((r) => r.metadata.idempotent).sort()).toEqual([false, true]);
  });
});
