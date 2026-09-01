import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { resumeRun } from '../../src/automation/service.js';
import { setResumeLearnDriver, __resetAutomationSeamsForTests } from '../../src/automation/seams.js';
import { __resetCredentialWaitersForTests } from '../../src/automation/credential-waiters.js';
import { automations, automationRuns } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState } from '../agents/_setup.js';

/**
 * K3 - LEARN ACROSS THE CEREMONY (D-CORNERSTONE-LEARN-ON-RESUME).
 *
 * A run that halts `needs_credentials` cannot learn: the resumed engine pass runs uninstrumented
 * (the engine has no learn concept), so without this slice the canonical first contact - action on
 * a new site, login wall, ceremony, resume, completion - produced NO recipe (the audit's confirmed
 * `resume-severs-learning` finding). The fix: the parked row carries the storable action's
 * identity (`actionRetry`, stamped by `runAutomationForAction` - pinned in replay-mount.test.ts),
 * and when the RESUMED pass completes, `dispatchCredentialResume` fires ONE background
 * re-execution through the seam this suite drives. The real engine runs here (a zero-step
 * automation, the cheapest thing that still completes); only the driver is a spy.
 */
const actor: Actor = { userId: 'u1', orgId: 'o1', role: 'user' } as Actor;
const AUTOMATION_ID = 'auto-zero';

function seedRun(over: Record<string, unknown> = {}) {
  return automationRuns.insert({
    _id: 'run-parked',
    id: 'run-parked',
    automationId: AUTOMATION_ID,
    startedAt: new Date().toISOString(),
    status: 'needs_credentials',
    steps: [],
    ownerUserId: 'u1',
    orgId: 'o1',
    credentialRequest: { stepIndex: 0, origin: 'portal.acme.example', description: 'login' },
    ...over,
  } as never);
}

describe('the post-ceremony learn re-run', () => {
  beforeAll(() => bootAgentTestDb('ekoa_resume_learn'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => {
    resetAgentState({});
    __resetAutomationSeamsForTests();
    __resetCredentialWaitersForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    await automations.insert({
      _id: AUTOMATION_ID, id: AUTOMATION_ID, name: 'zero', description: 'd', steps: [],
      ownerUserId: 'u1', orgId: 'o1',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
  });

  it('fires the driver with the parked action identity once the resumed pass completes', async () => {
    const driver = vi.fn(async () => undefined);
    setResumeLearnDriver(driver);
    await seedRun({ actionRetry: { integrationKey: 'portal-acme-example', actionName: 'listar_pedidos', args: { q: '1' } } });

    const r = await resumeRun(actor, 'run-parked');
    expect(r.resumed).toBe(true);

    await vi.waitFor(() => expect(driver).toHaveBeenCalledOnce(), { timeout: 5_000 });
    expect(driver).toHaveBeenCalledWith({
      orgId: 'o1',
      ownerUserId: 'u1',
      integrationKey: 'portal-acme-example',
      actionName: 'listar_pedidos',
      args: { q: '1' },
    });
    // The resumed run itself completed - the learn re-run rides completion, never replaces it.
    const row = (await automationRuns.get('run-parked')) as { status?: string } | null;
    expect(row?.status).toBe('completed');
  });

  it('the resumed pass keeps the run\'s persisted CONFIG VALUES - {{config.*}} means on resume what it meant before the halt (found live, 2026-09-01)', async () => {
    // The live shape: a citius run halted at the fixture's login wall, the ceremony completed, and
    // the resumed pass rebuilt its context WITHOUT configValues - so `{{config.portal_url}}`
    // resolved to nothing and the no-destination guard (its own 2026-09-01 fix) failed the run.
    // With the values persisted on the row and rebuilt here, the navigate resolves its address
    // again; without a daemon in this suite it then halts awaiting the browser, which is exactly
    // the discriminating observation: address lost = the guard's named refusal, address kept =
    // the step got far enough to want a browser.
    await automations.deleteMany({});
    await automations.insert({
      _id: AUTOMATION_ID, id: AUTOMATION_ID, name: 'portal', description: 'd',
      steps: [{ id: 'abrir-portal', type: 'navigate', description: 'abrir', url: '{{config.portal_url}}' }],
      ownerUserId: 'u1', orgId: 'o1',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
    await seedRun({ configValues: { portal_url: 'http://127.0.0.1:45190' } });

    const r = await resumeRun(actor, 'run-parked');
    expect(r.resumed).toBe(true);

    await vi.waitFor(async () => {
      const row = (await automationRuns.get('run-parked')) as { steps?: Array<{ stepId?: string; error?: { message?: string } }> } | null;
      expect(row?.steps?.length).toBeGreaterThan(0);
    }, { timeout: 5_000 });
    const row = (await automationRuns.get('run-parked')) as { steps?: Array<{ stepId?: string; error?: { message?: string } }> } | null;
    const step0 = row?.steps?.[0];
    expect(step0?.stepId).toBe('abrir-portal');
    // The address SURVIVED: the step resolved its origin and got as far as the LOCALITY decision
    // (an adversarial 127.0.0.1 with no machine connected), never the no-destination refusal.
    expect(step0?.error?.message ?? '').not.toContain('no destination');
    expect(step0?.error?.message ?? '').toMatch(/adversarial|daemon/);
  });

  it('a parked row WITHOUT the identity stamp resumes normally and fires nothing', async () => {
    const driver = vi.fn(async () => undefined);
    setResumeLearnDriver(driver);
    await seedRun();

    const r = await resumeRun(actor, 'run-parked');
    expect(r.resumed).toBe(true);
    await vi.waitFor(async () => {
      const row = (await automationRuns.get('run-parked')) as { status?: string } | null;
      expect(row?.status).toBe('completed');
    }, { timeout: 5_000 });
    expect(driver).not.toHaveBeenCalled();
  });

  it('a resumed pass that does NOT complete fires nothing', async () => {
    const driver = vi.fn(async () => undefined);
    setResumeLearnDriver(driver);
    // A step the engine refuses without any browser: an `integration` step naming no integration
    // fails the run immediately, so the resumed pass ends `failed` rather than `completed`.
    await automations.update(AUTOMATION_ID, (d) => ({
      ...(d as object),
      steps: [{ id: 's1', type: 'integration', description: 'sem chave' }],
    } as never));
    await seedRun({ actionRetry: { integrationKey: 'k', actionName: 'a', args: {} } });

    const r = await resumeRun(actor, 'run-parked');
    expect(r.resumed).toBe(true);
    await vi.waitFor(async () => {
      const row = (await automationRuns.get('run-parked')) as { status?: string } | null;
      expect(row?.status).toBe('failed');
    }, { timeout: 5_000 });
    expect(driver).not.toHaveBeenCalled();
  });

  it('an unbound seam costs nothing: the resume completes exactly as before K3', async () => {
    await seedRun({ actionRetry: { integrationKey: 'k', actionName: 'a', args: {} } });
    const r = await resumeRun(actor, 'run-parked');
    expect(r.resumed).toBe(true);
    await vi.waitFor(async () => {
      const row = (await automationRuns.get('run-parked')) as { status?: string } | null;
      expect(row?.status).toBe('completed');
    }, { timeout: 5_000 });
  });
});
