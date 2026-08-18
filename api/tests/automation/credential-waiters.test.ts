import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Actor } from '@ekoa/shared';
import { runAutomation, type RunContext } from '../../src/automation/engine.js';
import {
  setDaemonConnectionResolver,
  setScopedMemoryResolver,
  setIntegrationActionDeclarationResolver,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import {
  onCredentialEstablished,
  setCredentialResumeDriver,
  registerCredentialWaiter,
  clearCredentialWaiter,
  credentialWaiterCount,
  __resetCredentialWaitersForTests,
} from '../../src/automation/credential-waiters.js';
import { redispatchRunAwaitingCredentials, resumeRun } from '../../src/automation/service.js';
import {
  captureSessionWithGrant,
  setCredentialEstablishedNotifier,
  __resetCredentialNotifierForTests,
} from '../../src/cofre/index.js';
import { automations, automationRuns } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import type { Automation, RunRecord } from '../../src/automation/types.js';

/**
 * THE AUTO-RESUME OBSERVER (P3.1-resume).
 *
 * Three things are proven here and they are not the same thing:
 *   1. the REGISTRY matches correctly (owner, org, and the subdomain DIRECTION);
 *   2. the SEAM is wired in the direction the architecture requires — `cofre/` calls a callback it
 *      declares itself and never imports `automation/`;
 *   3. the LOOP actually closes: a run halts, a human establishes a credential through the ordinary
 *      Cofre path, and the run moves again without anyone asking it to.
 *
 * (3) is the one that can only be faked by not writing it. The registry test would pass against a
 * registry nothing consults, so the last block runs the real engine, the real store, the real
 * `captureSessionWithGrant`, and the real re-dispatcher, with the two seams bound exactly as
 * `server.ts` binds them.
 */

const actor: Actor = { userId: 'u1', orgId: 'o1', role: 'user' } as Actor;
const ORIGIN = 'portal.acme.example';

describe('the waiter registry', () => {
  beforeEach(() => __resetCredentialWaitersForTests());
  afterEach(() => __resetCredentialWaitersForTests());

  function park(over: Partial<{ runId: string; orgId: string; userId: string; origin: string }> = {}) {
    registerCredentialWaiter({ runId: 'run_1', orgId: 'o1', userId: 'u1', origin: ORIGIN, ...over });
  }

  it('wakes a run whose origin the new credential covers', () => {
    const driver = vi.fn();
    setCredentialResumeDriver(driver);
    park();
    expect(onCredentialEstablished({ orgId: 'o1', userId: 'u1', boundOrigins: [ORIGIN] })).toEqual(['run_1']);
    expect(driver).toHaveBeenCalledWith('run_1');
  });

  it('does NOT wake another user, or another org', () => {
    const driver = vi.fn();
    setCredentialResumeDriver(driver);
    park();
    expect(onCredentialEstablished({ orgId: 'o1', userId: 'mallory', boundOrigins: [ORIGIN] })).toEqual([]);
    expect(onCredentialEstablished({ orgId: 'o2', userId: 'u1', boundOrigins: [ORIGIN] })).toEqual([]);
    expect(driver).not.toHaveBeenCalled();
    expect(credentialWaiterCount()).toBe(1); // still parked
  });

  it('covering runs PARENT -> child, never child -> parent', () => {
    setCredentialResumeDriver(() => {});
    // A credential bound to the parent domain covers a run waiting on a subdomain.
    park({ runId: 'child', origin: 'sub.acme.example' });
    expect(onCredentialEstablished({ orgId: 'o1', userId: 'u1', boundOrigins: ['acme.example'] })).toEqual(['child']);

    // The inverse must NOT hold: a credential for one subdomain does not satisfy a run pointed at
    // the parent (and therefore at every other subdomain under it).
    park({ runId: 'parent', origin: 'acme.example' });
    expect(onCredentialEstablished({ orgId: 'o1', userId: 'u1', boundOrigins: ['sub.acme.example'] })).toEqual([]);
  });

  it('is one-shot: a woken waiter is gone, so a mint-then-grant pair costs at most two wakes', () => {
    setCredentialResumeDriver(() => {});
    park();
    expect(onCredentialEstablished({ orgId: 'o1', userId: 'u1', boundOrigins: [ORIGIN] })).toEqual(['run_1']);
    expect(credentialWaiterCount()).toBe(0);
    expect(onCredentialEstablished({ orgId: 'o1', userId: 'u1', boundOrigins: [ORIGIN] })).toEqual([]);
  });

  it('an item with no bound origin wakes nobody (I6: unbound is unusable, not universal)', () => {
    setCredentialResumeDriver(() => {});
    park();
    expect(onCredentialEstablished({ orgId: 'o1', userId: 'u1', boundOrigins: [] })).toEqual([]);
    expect(credentialWaiterCount()).toBe(1);
  });

  it('a driver that throws does not stop the other runs from being woken', () => {
    const seen: string[] = [];
    setCredentialResumeDriver((runId) => {
      seen.push(runId);
      if (runId === 'a') throw new Error('boom');
    });
    park({ runId: 'a' });
    park({ runId: 'b' });
    expect(onCredentialEstablished({ orgId: 'o1', userId: 'u1', boundOrigins: [ORIGIN] }).sort()).toEqual(['a', 'b']);
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('clearing un-parks a run (cancel, resume, terminal)', () => {
    setCredentialResumeDriver(() => {});
    park();
    clearCredentialWaiter('run_1');
    expect(onCredentialEstablished({ orgId: 'o1', userId: 'u1', boundOrigins: [ORIGIN] })).toEqual([]);
  });
});

describe('the seam runs in the direction the tier table requires', () => {
  it('no file in cofre/ imports automation/', () => {
    // The architectural claim this whole design rests on. Lint enforces the repo-level zones; this
    // asserts the specific edge the observer would be tempted to add — `cofre/items.ts` reaching up
    // to `automation/credential-waiters.js` — which is a one-line change that would compile.
    const dir = fileURLToPath(new URL('../../src/cofre/', import.meta.url));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(`${dir}${file}`, 'utf8');
      const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(withoutComments, `cofre/${file} must not import automation/`).not.toMatch(
        /from\s+['"][^'"]*\.\.\/automation\//,
      );
    }
  });

  it('the notifier default is a no-op, so an unbound seam changes nothing', () => {
    __resetCredentialNotifierForTests();
    __resetCredentialWaitersForTests();
    const driver = vi.fn();
    setCredentialResumeDriver(driver);
    registerCredentialWaiter({ runId: 'run_1', orgId: 'o1', userId: 'u1', origin: ORIGIN });
    // Nothing bound => the Cofre-side call goes nowhere and the waiter stays parked.
    expect(credentialWaiterCount()).toBe(1);
    expect(driver).not.toHaveBeenCalled();
    __resetCredentialWaitersForTests();
  });
});

/**
 * THE LOOP, CLOSED. Real engine, real store, real Cofre capture, real re-dispatcher, and the two
 * seams bound exactly as the composition root binds them.
 */
describe('a run halted for credentials resumes when the credential appears', () => {
  const ctx: RunContext = {
    ownerUserId: 'u1',
    orgId: 'o1',
    triggeredBy: 'user',
    visitedAutomationIds: new Set(),
    traceId: 't1',
  };

  const automation: Automation = {
    id: 'auto-acme',
    name: 'Fetch from acme',
    description: '',
    ownerUserId: 'u1',
    steps: [
      {
        id: 's1',
        description: 'open acme',
        type: 'integration',
        integrationKey: 'acme',
        integrationAction: 'fetch',
        declaration: { credentialRefs: ['cofre:itm_password_1'] },
      },
    ],
    createdAt: '',
    updatedAt: '',
  } as Automation;

  beforeAll(() => bootAgentTestDb('ekoa_credential_resume'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    resetAgentState();
    __resetAutomationSeamsForTests();
    __resetCredentialWaitersForTests();
    __resetCredentialNotifierForTests();
    process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'false';
    __resetAutomationConfigForTests();
    setDaemonConnectionResolver(() => null);
    setScopedMemoryResolver(async () => []);
    setIntegrationActionDeclarationResolver(async () => ({ httpConfig: { baseUrl: `https://${ORIGIN}/app` } }));
    // EXACTLY the composition root's two lines.
    setCredentialEstablishedNotifier((event) => {
      onCredentialEstablished(event);
    });
    setCredentialResumeDriver(redispatchRunAwaitingCredentials);
    await automations.insert({ _id: automation.id, ...automation } as never);
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    __resetCredentialWaitersForTests();
    __resetCredentialNotifierForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
    const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
  });

  async function statusOf(runId: string): Promise<string> {
    return ((await automationRuns.get(runId)) as unknown as RunRecord).status;
  }

  /** Wait for the fire-and-forget re-dispatch to land. Bounded — a hang is a failure, not a wait. */
  async function settle(runId: string, awayFrom: string): Promise<string> {
    for (let i = 0; i < 100; i++) {
      const s = await statusOf(runId);
      if (s !== awayFrom) return s;
      await new Promise((r) => setTimeout(r, 20));
    }
    return statusOf(runId);
  }

  it('establishing a session for the origin re-dispatches the run past the halt', async () => {
    const halted = await runAutomation('auto-acme', ctx);
    expect(halted.status).toBe('needs_credentials');
    expect(credentialWaiterCount()).toBe(1);

    // The human does the ordinary thing: a session for this portal lands in the Cofre. Nothing in
    // this call knows a run exists.
    await captureSessionWithGrant(actor, {
      label: 'acme',
      boundOrigins: [ORIGIN],
      storageState: { cookies: [{ domain: ORIGIN, name: 'sid', value: 'x' }], origins: [] },
      metadata: {
        establishedBy: { kind: 'cloud' },
        boundEgress: { kind: 'datacenter' },
        establishedAt: new Date().toISOString(),
        healthy: true,
      },
    });

    const settled = await settle(halted.runId, 'needs_credentials');
    // It got PAST the credential gate. Where it lands after that is the integration rail's business
    // (no executor is bound here, so it halts on the integration) — the assertion is that the
    // credential halt is gone and nobody clicked anything to clear it.
    expect(settled).not.toBe('needs_credentials');
    expect(credentialWaiterCount()).toBe(0);

    const run = (await automationRuns.get(halted.runId)) as unknown as RunRecord;
    expect(run.id).toBe(halted.runId); // the SAME run, not a new one
  });

  it('the two resume legs racing dispatch ONE pass, not two', async () => {
    const halted = await runAutomation('auto-acme', ctx);
    expect(halted.status).toBe('needs_credentials');

    await captureSessionWithGrant(actor, {
      label: 'acme',
      boundOrigins: [ORIGIN],
      storageState: { cookies: [{ domain: ORIGIN, name: 'sid', value: 'x' }], origins: [] },
      metadata: {
        establishedBy: { kind: 'cloud' },
        boundEgress: { kind: 'datacenter' },
        establishedAt: new Date().toISOString(),
        healthy: true,
      },
    });

    // The client's own leg, firing immediately after the mint the observer just saw. This is the
    // ordinary case, not a contrived one: both are driven by the same user action.
    const second = await resumeRun(actor, halted.runId);
    // Exactly one of the two claims the run. Whichever lost answers false rather than starting a
    // duplicate engine pass over the same run id.
    expect(second.resumed).toBe(false);

    const settled = await settle(halted.runId, 'needs_credentials');
    expect(settled).not.toBe('needs_credentials');
    // ONE run record, one set of step records — a second pass would have appended over them.
    const run = (await automationRuns.get(halted.runId)) as unknown as RunRecord;
    expect(run.steps.filter((s) => s.index === 0)).toHaveLength(1);
  });

  it('a credential for an unrelated origin leaves the run parked', async () => {
    const halted = await runAutomation('auto-acme', ctx);
    expect(halted.status).toBe('needs_credentials');

    await captureSessionWithGrant(actor, {
      label: 'somewhere else',
      boundOrigins: ['unrelated.example'],
      storageState: { cookies: [{ domain: 'unrelated.example', name: 'sid', value: 'x' }], origins: [] },
      metadata: {
        establishedBy: { kind: 'cloud' },
        boundEgress: { kind: 'datacenter' },
        establishedAt: new Date().toISOString(),
        healthy: true,
      },
    });

    await new Promise((r) => setTimeout(r, 100));
    expect(await statusOf(halted.runId)).toBe('needs_credentials');
    expect(credentialWaiterCount()).toBe(1);
  });

  it('another org member establishing their own credential does not move this run', async () => {
    const halted = await runAutomation('auto-acme', ctx);
    expect(halted.status).toBe('needs_credentials');

    const peer: Actor = { userId: 'peer', orgId: 'o1', role: 'user' } as Actor;
    await captureSessionWithGrant(peer, {
      label: 'acme',
      boundOrigins: [ORIGIN],
      storageState: { cookies: [{ domain: ORIGIN, name: 'sid', value: 'y' }], origins: [] },
      metadata: {
        establishedBy: { kind: 'cloud' },
        boundEgress: { kind: 'datacenter' },
        establishedAt: new Date().toISOString(),
        healthy: true,
      },
    });

    await new Promise((r) => setTimeout(r, 100));
    // Cofre items are owner-scoped: the peer's session is not this run owner's to use.
    expect(await statusOf(halted.runId)).toBe('needs_credentials');
    expect(credentialWaiterCount()).toBe(1);
  });
});
