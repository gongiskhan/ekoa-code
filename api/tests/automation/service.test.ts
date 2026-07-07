import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import {
  Automation as AutomationSchema,
  PlanResponse as PlanResponseSchema,
  RunRecord as RunRecordSchema,
  CatalogResponse as CatalogResponseSchema,
  ConsentResult as ConsentResultSchema,
  ApprovedCommand as ApprovedCommandSchema,
  RevokeApprovedCommandResponse as RevokeSchema,
} from '@ekoa/shared';
import * as svc from '../../src/automation/service.js';
import {
  setDaemonConnectionResolver,
  setScopedMemoryResolver,
  setPlatformIntegrationCaller,
  setRunEventEmitterFactory,
  __resetAutomationSeamsForTests,
  type ResultEnvelope,
} from '../../src/automation/seams.js';
import type { RunEventEmitter } from '../../src/automation/engine.js';
import type { StepRecord } from '../../src/automation/types.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import { writeActionCache, lookupActionCache } from '../../src/automation/cache.js';
import { isCommandShapeApproved } from '../../src/automation/consent.js';
import { fingerprintFromParts } from '../../src/automation/fingerprint.js';
import { automations, automationRuns, approvedCommands, memories } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';

/**
 * automation/ service surface (ch03 §3.8.18) — the actor-scoped one-function-per-route API the
 * router calls. Verifies org-scoping + creator-owned writes, the plan-from-goal landmine-9 double
 * side effect, the live consent flow (once/always/stop) through the in-memory signal registry, step
 * feedback cache eviction, the catalog/approved-commands surfaces, and the trigger-delivery entry —
 * with responses validated against the shared/automations.ts zod schemas.
 */
const admin: Actor = { userId: 'admin1', orgId: 'o1', role: 'org-admin' };
const builder: Actor = { userId: 'u1', orgId: 'o1', role: 'builder' };
const otherOrg: Actor = { userId: 'x1', orgId: 'o2', role: 'builder' };

const OK_PLAN = JSON.stringify({
  status: 'ok', name: 'Guardar página', description: 'abre e guarda', reasoning: 'r',
  steps: [{ id: 'open', type: 'navigate', url: 'https://example.com' }, { id: 'save', type: 'browser', description: 'click save' }],
});

async function waitFor(pred: () => Promise<boolean>, ms = 4000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await pred()) return;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 40));
  }
}

describe('automation service surface (§3.8.18)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_service'));
  afterAll(shutdownAgentTestDb);
  beforeEach(() => {
    resetAgentState({ oneShotText: OK_PLAN }); // fake LLM: planner gets a valid plan
    __resetAutomationSeamsForTests();
    svc.__resetAutomationServiceForTests();
    __resetAutomationConfigForTests();
    process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'false';
    setScopedMemoryResolver(async () => []);
  });
  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    svc.__resetAutomationServiceForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    await approvedCommands.deleteMany({});
    await memories.deleteMany({});
  });

  // ---- CRUD + scoping -----------------------------------------------------

  it('canCreateAutomation: org-admin yes, builder only when the org enables it', () => {
    expect(svc.canCreateAutomation(admin)).toBe(true);
    expect(svc.canCreateAutomation(builder)).toBe(false);
    expect(svc.canCreateAutomation(builder, { allowBuilderAutomations: true })).toBe(true);
  });

  it('create is org-admin-gated; a builder is forbidden unless the org allows authoring', async () => {
    await expect(svc.createAutomation(builder, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const created = await svc.createAutomation(admin, { name: 'Relatório', description: 'diário' });
    expect(AutomationSchema.safeParse(created).success).toBe(true);
    expect(created.ownerId).toBe('admin1');
    expect(created.orgId).toBe('o1');
  });

  it('automations are org-scoped for read and creator/admin-scoped for write', async () => {
    const a = await svc.createAutomation(admin, { name: 'Org thing' });
    // another user in the SAME org can read it (org-scoped)
    expect((await svc.getAutomation(builder, a.id)).id).toBe(a.id);
    // a user in ANOTHER org cannot (uniform NOT_FOUND)
    await expect(svc.getAutomation(otherOrg, a.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // a same-org builder (not the creator, not admin) cannot patch it
    await expect(svc.patchAutomation(builder, a.id, { name: 'hijack' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // the org-admin can
    const patched = await svc.patchAutomation(admin, a.id, { name: 'Renamed' });
    expect(patched.name).toBe('Renamed');

    const list = await svc.listAutomations(builder);
    expect(list.map((x) => x.id)).toContain(a.id);
    expect(await svc.listAutomations(otherOrg)).toHaveLength(0);
  });

  // ---- plan-from-goal (Landmine 9) ---------------------------------------

  it('planFromGoal persists the automation AND starts a rehearsal run (landmine 9)', async () => {
    const res = await svc.planFromGoal(builder, { goal: 'abre example.com e guarda', language: 'pt-PT' });
    expect(PlanResponseSchema.safeParse(res).success).toBe(true);
    expect(res.rehearsing).toBe(true);
    expect(res.automation).toBeDefined();
    expect(res.runId).toBeTruthy();
    // side effect 1: automation persisted, owned by the actor + org
    const stored = await automations.get(res.automation!.id);
    expect((stored as { ownerUserId?: string; orgId?: string }).ownerUserId).toBe('u1');
    expect((stored as { orgId?: string }).orgId).toBe('o1');
    // side effect 2: a rehearsal run record exists (register-early)
    const run = await svc.getRunRecord(builder, res.runId!);
    expect(RunRecordSchema.safeParse(run).success).toBe(true);
    expect(run.automationId).toBe(res.automation!.id);
  });

  // ---- startRun 202 register-early + run visibility -----------------------

  it('startRun registers the run before responding; getRunRecord finds it immediately', async () => {
    const a = await svc.createAutomation(admin, { name: 'Empty' }); // zero steps -> completes fast
    const { runId } = await svc.startRun(admin, a.id);
    expect(runId).toBeTruthy();
    const run = await svc.getRunRecord(admin, runId); // no race: the record is pre-inserted synchronously
    expect(run.id).toBe(runId);
    expect(run.automationId).toBe(a.id);
    expect(RunRecordSchema.safeParse(run).success).toBe(true);
  });

  it('startRun on an automation you do not own is forbidden', async () => {
    const a = await svc.createAutomation(admin, { name: 'Admin owned' });
    await expect(svc.startRun(builder, a.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  // ---- live consent flow through the service (once/always/stop) -----------

  it('resolveConsent "always" persists the shape, resumes the paused run, and it completes', async () => {
    // A local_command automation, with a fake daemon connected so it reaches awaiting_consent.
    await automations.insert({
      _id: 'cauto', id: 'cauto', name: 'Consent auto', description: '', ownerUserId: 'u1', orgId: 'o1',
      steps: [{ id: 's1', type: 'local_command', description: 'list tmp', commandTemplate: { argv: ['ls', '-la', '/tmp'] } }],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    } as never);
    const env: ResultEnvelope = { ok: true, observation: { data: { exitCode: 0, stdout: 'ok', stderr: '' } } };
    setDaemonConnectionResolver(() => ({ runStep: async () => env }));

    const { runId } = await svc.startRun(builder, 'cauto');
    await waitFor(async () => (await svc.getRunRecord(builder, runId)).status === 'awaiting_consent');

    const consent = await svc.resolveConsent(builder, runId, { decision: 'always', shape: 'ls -la <DIR>' });
    expect(ConsentResultSchema.safeParse(consent).success).toBe(true);
    expect(consent).toMatchObject({ decision: 'always', resumed: true, persisted: true });
    expect(await isCommandShapeApproved('u1', 'ls -la <DIR>')).toBe(true);

    await waitFor(async () => (await svc.getRunRecord(builder, runId)).status === 'completed');
  });

  it('cancelRun on a paused run is owner-scoped and cancels it; unknown/cross-org is idempotent false', async () => {
    await automations.insert({
      _id: 'cauto2', id: 'cauto2', name: 'Consent auto 2', description: '', ownerUserId: 'u1', orgId: 'o1',
      steps: [{ id: 's1', type: 'local_command', description: 'list', commandTemplate: { argv: ['ls', '/tmp'] } }],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    } as never);
    setDaemonConnectionResolver(() => ({ runStep: async () => ({ ok: true, observation: { data: { exitCode: 0 } } }) }));

    const { runId } = await svc.startRun(builder, 'cauto2');
    await waitFor(async () => (await svc.getRunRecord(builder, runId)).status === 'awaiting_consent');

    // cross-org cannot cancel (idempotent false, no leak)
    expect(await svc.cancelRun(otherOrg, runId)).toEqual({ cancelled: false });
    // owner cancels a live paused run
    expect(await svc.cancelRun(builder, runId)).toEqual({ cancelled: true });
    await waitFor(async () => (await svc.getRunRecord(builder, runId)).status === 'cancelled');
    // second cancel is idempotent
    expect(await svc.cancelRun(builder, runId)).toEqual({ cancelled: false });
    // unknown run
    expect(await svc.cancelRun(builder, 'no-such-run')).toEqual({ cancelled: false });
  });

  // ---- step feedback eviction --------------------------------------------

  it('submitStepFeedback evicts the fingerprint-matched cache entry on a thumbs_down', async () => {
    const fp = fingerprintFromParts({ url: 'https://x.com/a', title: 'A', headingText: 'h', shapeSketch: 'tags:|roles:|landmarks:0', viewport: { w: 1280, h: 800 } });
    await writeActionCache({ automationId: 'fa', stepId: 's1', fingerprint: fp, action: { kind: 'click', locator: { strategy: 'role', role: 'button', name: 'Save' } }, actor: builder, confidence: 'high' });
    // Seed a run whose step carries that fingerprint.
    await automationRuns.insert({
      _id: 'frun', id: 'frun', automationId: 'fa', status: 'completed', startedAt: '2026-01-01T00:00:00Z',
      inputs: {}, steps: [{ stepId: 's1', index: 0, status: 'completed', tier: 'vision', durationMs: 1, fingerprint: fp }],
      triggeredBy: 'user', ownerUserId: 'u1', orgId: 'o1',
    } as never);

    const res = await svc.submitStepFeedback(builder, 'frun', 's1', { kind: 'thumbs_down' });
    expect(res).toEqual({ ok: true, evicted: true });
    expect(await lookupActionCache('fa', 's1', fp, builder)).toBeNull(); // gone
  });

  // ---- catalog + approved commands ---------------------------------------

  it('buildCatalog returns a shape-valid CatalogResponse', async () => {
    const cat = await svc.buildCatalog(builder);
    expect(CatalogResponseSchema.safeParse(cat).success).toBe(true);
    expect(Array.isArray(cat.automations)).toBe(true);
    expect(Array.isArray(cat.integrationActions)).toBe(true);
  });

  it('listApprovedCommands + revokeApprovedCommand round-trip', async () => {
    await approvedCommands.insert({ _id: 'u1::cat <FILE>', userId: 'u1', shape: 'cat <FILE>', createdAt: '2026-01-01T00:00:00Z' } as never);
    const list = await svc.listApprovedCommands(builder);
    expect(ApprovedCommandSchema.array().safeParse(list).success).toBe(true);
    expect(list.map((c) => c.shape)).toContain('cat <FILE>');

    const revoked = await svc.revokeApprovedCommand(builder, { shape: 'cat <FILE>' });
    expect(RevokeSchema.safeParse(revoked).success).toBe(true);
    expect(revoked).toEqual({ revoked: true, remaining: 0 });
  });

  // ---- run event emitter wiring (§3.6.3) ---------------------------------

  it('a factory-injected emitter receives stepUpdate + runComplete for a started run', async () => {
    await automations.insert({
      _id: 'eauto', id: 'eauto', name: 'Emit auto', description: '', ownerUserId: 'u1', orgId: 'o1',
      steps: [{ id: 's1', type: 'integration', integrationKey: 'google-workspace', integrationAction: 'send', description: 'send' }],
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    } as never);
    setPlatformIntegrationCaller(async () => ({ success: true, data: {} }));

    const stepUpdates: StepRecord[] = [];
    let completed = false;
    const emitter: RunEventEmitter = {
      stepUpdate: (rec) => { stepUpdates.push(rec); },
      runComplete: () => { completed = true; },
      runError: () => {},
      runPaused: () => {},
    };
    setRunEventEmitterFactory((runId) => (runId ? emitter : undefined));

    const { runId } = await svc.startRun(builder, 'eauto');
    await waitFor(async () => (await svc.getRunRecord(builder, runId)).status === 'completed');

    expect(stepUpdates.length).toBeGreaterThan(0); // the run streamed step updates
    expect(completed).toBe(true);                  // ...and a terminal complete
  });

  // ---- trigger delivery entry --------------------------------------------

  it('startRunForTrigger reports a missing automation as a PERMANENT failure', async () => {
    const out = await svc.startRunForTrigger({ automationId: 'ghost', ownerUserId: 'u1', orgId: 'o1', triggeredBy: 'webhook' });
    expect(out).toEqual({ outcome: 'failed', permanent: true });
  });

  it('startRunForTrigger runs under the trigger owner and awaits terminal status', async () => {
    await automations.insert({
      _id: 'tauto', id: 'tauto', name: 'Trigger auto', description: '', ownerUserId: 'u1', orgId: 'o1',
      steps: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    } as never);
    const out = await svc.startRunForTrigger({ automationId: 'tauto', ownerUserId: 'u1', orgId: 'o1', triggeredBy: 'webhook' });
    expect(out.outcome).toBe('completed');
    expect(out.permanent).toBe(false);
    expect(out.runId).toBeTruthy();
  });
});
