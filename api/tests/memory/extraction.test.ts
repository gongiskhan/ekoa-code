import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { runPostRunExtraction } from '../../src/memory/extraction.js';
import { userSettings, memories, tokenEvents, activityLogs } from '../../src/data/stores.js';
import { __resetAgentsConfigForTests } from '../../src/config.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from '../agents/_setup.js';

/**
 * Post-run memory extraction (ch05 §5.8, P-12). Acceptance criterion 10: toggle off → zero
 * extraction model calls; toggle on → exactly one FAST `memory-extract` ledger row, the memory
 * write is `visibility: 'private'`, and a Registo entry exists.
 */
let seq = 0;
const deps = { now: () => 1_700_000_000_000, genId: () => `m_${seq++}` };
const FACT_JSON = '[{"title":"Prefers PT-PT","content":"The user prefers Portuguese (Portugal)."}]';

describe('runPostRunExtraction (§5.8)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_mem_extract'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); });
  afterEach(async () => {
    restoreTransport();
    await memories.deleteMany({});
    await tokenEvents.deleteMany({});
    await activityLogs.deleteMany({});
    await userSettings.deleteMany({});
    delete process.env.MEMORY_AUTO_EXTRACT_ENABLED;
    __resetAgentsConfigForTests();
  });

  it('with the toggle ON (default) writes exactly one FAST memory-extract ledger row, a PRIVATE memory, and a Registo entry', async () => {
    resetAgentState({ oneShotText: FACT_JSON });
    const res = await runPostRunExtraction({ userId: 'u1', username: 'u1', orgId: 'o1', sessionId: 's1', runId: 'r1', transcript: 'user: I speak Portuguese', deps });
    expect(res.written).toBe(1);

    const extractRows = (await tokenEvents.find({ agentType: 'memory-extract' })) as unknown as Array<{ tier: string; attributionKind: string }>;
    expect(extractRows).toHaveLength(1);
    expect(extractRows[0]!.tier).toBe('FAST');
    expect(extractRows[0]!.attributionKind).toBe('user_work');

    const mems = (await memories.find({ userId: 'u1' })) as unknown as Array<{ visibility: string }>;
    expect(mems).toHaveLength(1);
    expect(mems[0]!.visibility).toBe('private'); // sharedness is never inferred

    const registo = (await activityLogs.find({ type: 'memory_auto_extracted' }));
    expect(registo.length).toBe(1);
  });

  it('with the per-user toggle OFF makes ZERO extraction model calls', async () => {
    await userSettings.put({ _id: 'u1', memory: { autoExtract: false } });
    resetAgentState({ oneShotText: FACT_JSON });
    const res = await runPostRunExtraction({ userId: 'u1', username: 'u1', orgId: 'o1', transcript: 'anything', deps });
    expect(res.skipped).toBe(true);
    expect((await tokenEvents.find({ agentType: 'memory-extract' }))).toHaveLength(0);
    expect((await memories.find({ userId: 'u1' }))).toHaveLength(0);
  });

  it('with the platform kill switch OFF makes ZERO extraction model calls', async () => {
    process.env.MEMORY_AUTO_EXTRACT_ENABLED = 'false';
    __resetAgentsConfigForTests();
    resetAgentState({ oneShotText: FACT_JSON });
    const res = await runPostRunExtraction({ userId: 'u1', username: 'u1', orgId: 'o1', transcript: 'anything', deps });
    expect(res.skipped).toBe(true);
    expect((await tokenEvents.find({ agentType: 'memory-extract' }))).toHaveLength(0);
  });

  it('consolidation is deterministic — a duplicate fact is not written twice', async () => {
    resetAgentState({ oneShotText: FACT_JSON });
    await runPostRunExtraction({ userId: 'u1', username: 'u1', orgId: 'o1', transcript: 't', deps });
    resetAgentState({ oneShotText: FACT_JSON });
    await runPostRunExtraction({ userId: 'u1', username: 'u1', orgId: 'o1', transcript: 't', deps });
    expect((await memories.find({ userId: 'u1' }))).toHaveLength(1); // consolidated, no duplicate
  });
});
