import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAutomation, type RunContext } from '../../src/automation/engine.js';
import {
  setDaemonConnectionResolver,
  setScopedMemoryResolver,
  __resetAutomationSeamsForTests,
  type DaemonStepRequest,
} from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import { automations, automationRuns } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import type { Automation } from '../../src/automation/types.js';

/**
 * THE SUB-AUTOMATION DEADLOCK, from the end that causes it.
 *
 * A `sub_automation` step runs a SECOND run inside the first: its own runId, its own run record,
 * the same owner - therefore the same daemon connection and the same browser profile - while the
 * parent sits blocked on `await runAutomation(child)`.
 *
 * With the daemon's lease keyed by runId, the child's first browser step queued on the per-profile
 * chain behind a lease the parent holds for the whole parent run, and the parent could not release
 * until the child returned. Neither could ever move. The idle backstop made it worse rather than
 * better: the parent counted as idle while it waited, so two minutes in its lease was REAPED and
 * its next browser step was refused by name.
 *
 * The fix is a lease id threaded down the call tree, and this file asserts the FRAMES that come out
 * of the engine, because that is where the property lives: one lease for the tree, one release, and
 * it is sent by the outermost pass.
 */
const OBSERVATION = {
  ok: true,
  observation: {
    screenshotB64: Buffer.from('PNGBYTES').toString('base64'),
    data: {
      url: 'https://portal.test/inbox',
      title: 'Portal',
      domShapeSketch: 'tags:div=1|roles:button=1|landmarks:1',
      viewport: { w: 1280, h: 800 },
    },
  },
};

let frames: DaemonStepRequest[];
let dataDir: string;

const ctx = (): RunContext => ({
  ownerUserId: 'u1',
  orgId: 'o1',
  triggeredBy: 'user',
  visitedAutomationIds: new Set(),
  traceId: 't1',
});

function automation(id: string, steps: Automation['steps']): Automation {
  return {
    id,
    name: id,
    description: '',
    ownerUserId: 'u1',
    steps,
    createdAt: '',
    updatedAt: '',
  };
}

const leaseIdsOf = (): string[] => [...new Set(frames.map((f) => (f.input as { leaseId?: string }).leaseId ?? '(none)'))];
const releases = (): DaemonStepRequest[] => frames.filter((f) => (f.input as { leaseOp?: string }).leaseOp === 'release');
const pageFrames = (): DaemonStepRequest[] => frames.filter((f) => (f.input as { action?: unknown }).action !== undefined);

describe('the browser lease a call tree shares', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_sub_lease'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    resetAgentState(); // fake LLM transport; nothing here needs the model
    __resetAutomationSeamsForTests();
    dataDir = mkdtempSync(join(tmpdir(), 'ekoa-sublease-'));
    process.env.EKOA_AUTOMATION_DATA_DIR = dataDir;
    process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'false';
    __resetAutomationConfigForTests();
    frames = [];
    setDaemonConnectionResolver(() => ({
      pairingId: 'pair-1',
      runStep: async (req: DaemonStepRequest) => {
        frames.push(req);
        return OBSERVATION;
      },
    }));
    setScopedMemoryResolver(async () => []);
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    delete process.env.EKOA_AUTOMATION_DATA_DIR;
    __resetAutomationConfigForTests();
    rmSync(dataDir, { recursive: true, force: true });
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
  });

  it('gives the CHILD its parent lease, and lets the parent go on using it afterwards', async () => {
    // navigate steps only: they resolve without the model, so this exercises the lease and nothing
    // else. The parent uses the browser, hands off to a child that uses it, and uses it again.
    await automations.insert({
      _id: 'child',
      ...automation('child', [{ id: 'c1', type: 'navigate', description: 'ir para a caixa', url: 'https://portal.test/inbox' }]),
    } as never);
    await automations.insert({
      _id: 'parent',
      ...automation('parent', [
        { id: 'p1', type: 'navigate', description: 'entrar', url: 'https://portal.test/login' },
        { id: 'p2', type: 'sub_automation', description: 'correr a sub-automacao', subAutomationId: 'child' },
        { id: 'p3', type: 'navigate', description: 'voltar', url: 'https://portal.test/done' },
      ]),
    } as never);

    const result = await runAutomation('parent', ctx());
    expect(result.status).toBe('completed');

    // ONE lease for the whole tree. This is the assertion: a child with a lease of its own is the
    // deadlock, and a child with its parent's is the fix.
    expect(leaseIdsOf()).toHaveLength(1);
    expect(leaseIdsOf()[0]).not.toBe('(none)');

    // TWO runs, though - the child is a real run with its own record.
    const runIds = [...new Set(pageFrames().map((f) => f.runId))];
    expect(runIds).toHaveLength(2);
    expect(runIds).toContain(result.runId);

    // The child's frames sit BETWEEN the parent's, which is what "the parent carried on afterwards"
    // means on the wire.
    const owners = pageFrames().map((f) => (f.runId === result.runId ? 'parent' : 'child'));
    expect(owners).toEqual(['parent', 'child', 'parent']);
  });

  it('releases the lease EXACTLY ONCE, from the outermost run, after the child is finished', async () => {
    await automations.insert({
      _id: 'child',
      ...automation('child', [{ id: 'c1', type: 'navigate', description: 'ir', url: 'https://portal.test/inbox' }]),
    } as never);
    await automations.insert({
      _id: 'parent',
      ...automation('parent', [
        { id: 'p1', type: 'navigate', description: 'entrar', url: 'https://portal.test/login' },
        { id: 'p2', type: 'sub_automation', description: 'sub', subAutomationId: 'child' },
      ]),
    } as never);

    const result = await runAutomation('parent', ctx());
    expect(result.status).toBe('completed');

    // A child that released its own lease on the way out would drop the page, wipe the jar and sign
    // the user out from under the parent the moment it returned.
    expect(releases()).toHaveLength(1);
    expect(releases()[0]!.runId).toBe(result.runId);
    expect((releases()[0]!.input as { leaseId: string }).leaseId).toBe(leaseIdsOf()[0]);
    expect(frames.at(-1)).toBe(releases()[0]); // last frame of the whole tree
  });

  it('releases a lease the CHILD opened even though the parent never touched a browser', async () => {
    // `used` is a field on the shared lease object precisely for this: the pass that owns the lease
    // has to send the release for work a sub-automation did, or the session sits in the jar until
    // the daemon's idle backstop reaps it minutes later.
    await automations.insert({
      _id: 'child',
      ...automation('child', [{ id: 'c1', type: 'navigate', description: 'ir', url: 'https://portal.test/inbox' }]),
    } as never);
    await automations.insert({
      _id: 'parent',
      ...automation('parent', [{ id: 'p1', type: 'sub_automation', description: 'sub', subAutomationId: 'child' }]),
    } as never);

    const result = await runAutomation('parent', ctx());
    expect(result.status).toBe('completed');
    expect(pageFrames()).toHaveLength(1); // only the child ever drove the browser
    expect(pageFrames()[0]!.runId).not.toBe(result.runId);
    expect(releases()).toHaveLength(1);
    expect(releases()[0]!.runId).toBe(result.runId); // ... and the PARENT ended it
  });

  it('sends NO release for a run tree that never opened a browser', async () => {
    // One frame (and one ledger row on the machine) per browser-less run would be noise about a
    // lease that was never taken - and the `finally` must not announce the end of something that
    // was never started. An api_call-only tree is the ordinary shape of that.
    await automations.insert({
      _id: 'child',
      ...automation('child', [
        { id: 'c1', type: 'api_call', description: 'ler', apiRequest: { method: 'GET', url: 'https://api.example.test/things' } } as never,
      ]),
    } as never);
    await automations.insert({
      _id: 'parent',
      ...automation('parent', [{ id: 'p1', type: 'sub_automation', description: 'sub', subAutomationId: 'child' }]),
    } as never);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    try {
      const result = await runAutomation('parent', ctx());
      expect(result.status).toBe('completed');
      expect(frames).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
