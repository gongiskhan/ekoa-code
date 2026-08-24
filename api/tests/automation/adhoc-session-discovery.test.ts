import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { SessionMetadata } from '@ekoa/shared';
import { runAutomation } from '../../src/automation/engine.js';
import {
  setDaemonConnectionResolver,
  setScopedMemoryResolver,
  __resetAutomationSeamsForTests,
  type DaemonStepRequest,
} from '../../src/automation/seams.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';
import { automations, automationRuns } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport } from '../agents/_setup.js';
import { captureSessionWithGrant } from '../../src/cofre/index.js';
import type { Actor } from '@ekoa/shared';
import type { RunContext } from '../../src/automation/engine.js';
import type { Automation } from '../../src/automation/types.js';

/**
 * THE AD-HOC SESSION REACHES THE MACHINE ON A DISCOVERY RUN TOO (S-inject, review round F3).
 *
 * THE DEFECT THIS PINS. `armNetworkCapture` runs BEFORE the credential gate, and arming CREATES the
 * browser session and TAKES the machine's browser lease. A jar is built with cookies or without
 * them - there is no injecting into a live one - so on an `observeNetwork` run the lease-taking
 * frame went out with no session, the gate then saw `sessionUnresolved === false` (a browser
 * existed), and the ad-hoc lookup never ran at all. The whole feature was inert on precisely the
 * discovery / recipe-compile runs that a free-text goal most often takes to an undeclared origin.
 * It failed SAFE - a signed-out run, no leak, no cross-tenant reach - but it failed.
 *
 * WHAT IS ASSERTED. The FIRST request the daemon receives - the lease-taking one, whichever kind it
 * is - carries the stored `storageState`. That is the only frame on which it can still matter, so
 * asserting on "some frame carried it" would pass for a delivery that arrives too late to be worn.
 *
 * The declared path is untouched by the fix and is covered by `session-deliver.contract.test.ts`;
 * the observed/unobserved pair below is what shows the two now behave the same way.
 */

const HOST = 'portal.adhoc.example';
const COOKIE = 'discovery-session-cookie-0001';
const STORAGE_STATE = {
  cookies: [{ name: 'SESSIONID', value: COOKIE, domain: HOST, path: '/' }],
  origins: [],
};

const ctx: RunContext = {
  ownerUserId: 'u1',
  orgId: 'o1',
  triggeredBy: 'user',
  visitedAutomationIds: new Set(),
  traceId: 't1',
};

/** The actor the engine builds from `ctx` - the session must be minted under exactly this one. */
const actor: Actor = { userId: 'u1', orgId: 'o1', role: 'user' } as Actor;

/** An UNDECLARED adversarial origin: a bare navigate the run states for itself, nothing declared. */
const automation: Automation = {
  id: 'auto-adhoc',
  name: 'Ad-hoc portal read',
  description: '',
  ownerUserId: 'u1',
  steps: [{ id: 's1', description: 'open the portal', type: 'navigate', url: `https://${HOST}/inbox` }],
  createdAt: '',
  updatedAt: '',
};

const METADATA: SessionMetadata = {
  establishedBy: { kind: 'cloud' },
  boundEgress: { kind: 'datacenter' },
  establishedAt: new Date().toISOString(),
  healthy: true,
} as SessionMetadata;

/** Records every step request the engine dispatches, in order. */
function recordingDaemon(): { seen: DaemonStepRequest[] } {
  const seen: DaemonStepRequest[] = [];
  setDaemonConnectionResolver(() => ({
    pairingId: 'p-1',
    runStep: async (req: DaemonStepRequest) => {
      seen.push(req);
      return {
        ok: true,
        observation: {
          screenshotB64: '',
          data: {
            url: `https://${HOST}/inbox`,
            title: 'Inbox',
            domShapeSketch: 'tags:|roles:|landmarks:0',
            viewport: { w: 1280, h: 800 },
          },
        },
      };
    },
  }));
  return { seen };
}

describe('an ad-hoc session is delivered on the LEASE-TAKING frame, observed or not', () => {
  beforeAll(() => bootAgentTestDb('ekoa_automation_adhoc_discovery'));
  afterAll(shutdownAgentTestDb);

  beforeEach(async () => {
    resetAgentState();
    __resetAutomationSeamsForTests();
    process.env.EKOA_AUTOMATION_LOCAL_BROWSER = 'false';
    __resetAutomationConfigForTests();
    setScopedMemoryResolver(async () => []);
    await automations.insert({ _id: automation.id, ...automation } as never);
    const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
    await captureSessionWithGrant(actor, {
      label: HOST,
      boundOrigins: [HOST],
      storageState: STORAGE_STATE,
      metadata: METADATA,
    });
  });

  afterEach(async () => {
    restoreTransport();
    __resetAutomationSeamsForTests();
    delete process.env.EKOA_AUTOMATION_LOCAL_BROWSER;
    __resetAutomationConfigForTests();
    await automations.deleteMany({});
    await automationRuns.deleteMany({});
  });

  it('delivers it on an OBSERVED (discovery) run, where the capture frame takes the lease', async () => {
    const daemon = recordingDaemon();

    await runAutomation(automation.id, ctx, { observeNetwork: () => undefined });

    expect(daemon.seen.length).toBeGreaterThan(0);
    const first = daemon.seen[0]!;
    // The capture arm IS the lease-taking frame on this path - the assertion is non-vacuous only if
    // that is what we are looking at, so check it rather than assume it.
    expect(first.input).toMatchObject({ captureOp: 'start' });
    expect(first.sessionState).toEqual(STORAGE_STATE);
  });

  it('delivers it on an ORDINARY run, where the navigate takes the lease', async () => {
    const daemon = recordingDaemon();

    await runAutomation(automation.id, ctx);

    expect(daemon.seen.length).toBeGreaterThan(0);
    const first = daemon.seen[0]!;
    expect(first.sessionState).toEqual(STORAGE_STATE);
  });

  it('delivers it ONCE, never on a later frame', async () => {
    const daemon = recordingDaemon();

    await runAutomation(automation.id, ctx, { observeNetwork: () => undefined });

    const carrying = daemon.seen.filter((r) => r.sessionState !== undefined);
    expect(carrying).toHaveLength(1);
    expect(daemon.seen.indexOf(carrying[0]!)).toBe(0);
  });

  it('delivers NOTHING when the owner holds no session for that origin', async () => {
    const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
    await cofreItems.raw.deleteMany({});
    await cofreGrants.raw.deleteMany({});
    const daemon = recordingDaemon();

    await runAutomation(automation.id, ctx, { observeNetwork: () => undefined });

    // Silence, not an empty delivery: the machine's own persistent profile is what "no session"
    // has to keep meaning.
    expect(daemon.seen.every((r) => r.sessionState === undefined)).toBe(true);
  });
});
