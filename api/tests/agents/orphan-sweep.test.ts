import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { sweepOrphans } from '../../src/agents/jobs.js';
import { getRun, __resetRegistryForTests } from '../../src/agents/registry.js';
import { jobs, automationRuns, artifacts } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb } from './_setup.js';

/**
 * Boot orphan sweep + ephemeral chat runs (ch05 §5.2.1, P-10). Acceptance criterion 2: a job
 * left non-terminal by a crash boots to `failed { ORPHANED }` and its artifact to `draft`; a
 * pre-crash chat run is gone from the (empty) registry, giving `GET /chat/runs/:id` 404.
 */
describe('sweepOrphans (§5.2.1, P-10)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_orphan_sweep'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await jobs.deleteMany({}); await automationRuns.deleteMany({}); await artifacts.deleteMany({}); });
  afterEach(() => __resetRegistryForTests());

  it('marks non-terminal jobs + automation runs failed ORPHANED and resets their artifacts to draft', async () => {
    await jobs.put({ _id: 'j-run', kind: 'build', status: 'running', userId: 'u1', artifactId: 'art1', createdAt: 'x' });
    await jobs.put({ _id: 'j-created', kind: 'build', status: 'created', userId: 'u1', artifactId: 'art2', createdAt: 'x' });
    await jobs.put({ _id: 'j-done', kind: 'build', status: 'completed', userId: 'u1', createdAt: 'x' }); // terminal — untouched
    await automationRuns.put({ _id: 'ar1', status: 'running', artifactId: 'art3' });
    await artifacts.put({ _id: 'art1', status: 'active' });
    await artifacts.put({ _id: 'art2', status: 'active' });
    await artifacts.put({ _id: 'art3', status: 'active' });

    const result = await sweepOrphans(() => 1_700_000_000_000);
    expect(result.jobs).toBe(2);
    expect(result.runs).toBe(1);
    expect(result.artifacts).toBe(3);

    const jRun = (await jobs.get('j-run')) as unknown as { status: string; error?: { code: string } };
    expect(jRun.status).toBe('failed');
    expect(jRun.error?.code).toBe('ORPHANED');
    expect(((await jobs.get('j-done')) as unknown as { status: string }).status).toBe('completed'); // untouched
    expect(((await automationRuns.get('ar1')) as unknown as { status: string }).status).toBe('failed');
    for (const id of ['art1', 'art2', 'art3']) {
      expect(((await artifacts.get(id)) as unknown as { status: string }).status).toBe('draft');
    }
  });

  it('is idempotent — a second sweep finds nothing left', async () => {
    await jobs.put({ _id: 'j', kind: 'build', status: 'running', userId: 'u1', createdAt: 'x' });
    await sweepOrphans(() => 1);
    const second = await sweepOrphans(() => 2);
    expect(second.jobs).toBe(0);
  });

  it('a pre-crash chat run is absent from the registry after restart (→ 404)', () => {
    // Simulate a restart: the in-memory registry is empty; a previously-live chat run id resolves
    // to undefined, which the route turns into 404 (§5.2.1).
    __resetRegistryForTests();
    expect(getRun('pre-crash-chat-run')).toBeUndefined();
  });
});
