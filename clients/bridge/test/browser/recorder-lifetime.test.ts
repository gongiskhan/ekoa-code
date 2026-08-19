/**
 * THE NETWORK RECORDER'S LIFETIME (slice P2.2) - it ends when the LEASE ends, by every route.
 *
 * The recorder is the ONE place a live header VALUE exists on this machine: it is what lets a
 * valueless recipe reconstitute a working authenticated call. A recorder that outlives its lease is
 * therefore a remembered credential for a session that no longer exists - exactly what the
 * two-plane rule forbids.
 *
 * THERE ARE THREE WAYS A LEASE ENDS AND ONLY ONE OF THEM SENDS A FRAME:
 *
 *   1. `leaseOp:'release'` - the run ended and Cortex said so;
 *   2. THE IDLE BACKSTOP   - Cortex went away mid-run and no frame is ever sent;
 *   3. `closeAll`          - the daemon is shutting down and no frame is ever sent.
 *
 * The first version of this slice disposed the recorder on route 1 only (plus an explicit
 * `captureOp:'stop'`, which is also a frame). Routes 2 and 3 left it resident, with its live map
 * intact, for the lifetime of the process. Every case below drives the REAL `ProfileManager` and
 * the REAL executor, and asserts the absence afterwards - `hasNetworkRecorder` exists precisely
 * because "the values are gone" has no other observable.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProfileManager,
  type ProfileContext,
  type ProfilePage,
} from '../../src/browser/index.js';
import {
  executeToolInvocation,
  disposeNetworkRecorder,
  hasNetworkRecorder,
  type ToolExecutorDeps,
} from '../../src/runtime/index.js';
import { GrantTable } from '../../src/session/index.js';
import { EgressLedger } from '../../src/ledger/index.js';
import { AutomationEnablement } from '../../src/tools/tier2/index.js';
import { SecretHold } from '../../src/runtime/secret-hold.js';

const SESSION = 'bridge:p1';
const LEASE = 'lease-1';
const PROFILE = 'profile-1';

let home: string;
let ledgerDir: string;
let profiles: ProfileManager;

/** A page the recorder can attach to. `on` is what `NetworkRecorder.attach` needs; the rest is the
 *  minimum `observePage` touches. */
function fakePage(): ProfilePage & { handlers: number } {
  const handlers: Array<(r: unknown) => void> = [];
  const page = {
    handlers: 0,
    url: () => 'https://portal.example/cases',
    isClosed: () => false,
    close: async () => undefined,
    evaluate: async () => '',
    on: (_e: string, h: (r: unknown) => void) => { handlers.push(h); page.handlers = handlers.length; },
    off: (_e: string, h: (r: unknown) => void) => {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
      page.handlers = handlers.length;
    },
  };
  return page as unknown as ProfilePage & { handlers: number };
}

function fakeContext(): ProfileContext {
  const opened: ProfilePage[] = [];
  return {
    newPage: async () => { const p = fakePage(); opened.push(p); return p; },
    pages: () => opened,
    addCookies: async () => undefined,
    clearCookies: async () => undefined,
    addInitScript: async () => undefined,
    close: async () => undefined,
  } as unknown as ProfileContext;
}

function deps(): ToolExecutorDeps {
  const enablement = new AutomationEnablement();
  enablement.enable(SESSION);
  return {
    capabilities: ['desktop.automation'],
    enablement,
    session: SESSION,
    ledger: new EgressLedger(ledgerDir),
    grants: new GrantTable([]),
    profiles,
    secrets: new SecretHold(),
    profileIdFor: () => PROFILE,
  };
}

/** Arm the recorder for `LEASE`, exactly as Cortex's `captureOp:'start'` frame does. */
async function armCapture(): Promise<void> {
  const result = await executeToolInvocation(
    {
      invocationId: 'inv-1',
      capability: 'desktop.automation',
      input: { capability: 'browser', runId: 'run-1', input: { leaseId: LEASE, owner: 'u1', captureOp: 'start' } },
    },
    deps(),
  );
  expect(result.ok).toBe(true);
  expect(hasNetworkRecorder(LEASE)).toBe(true);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ekoa-recorder-'));
  ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-recorder-ledger-'));
});

afterEach(() => {
  // Belt and braces: the map is process-local and shared across tests in this file.
  disposeNetworkRecorder(LEASE);
  rmSync(home, { recursive: true, force: true });
  rmSync(ledgerDir, { recursive: true, force: true });
});

describe('the recorder does not outlive its lease', () => {
  it('route 1 - the explicit release drops it', async () => {
    profiles = new ProfileManager({ home, idleCloseMs: 0, runIdleMs: 0, launch: async () => fakeContext() });
    await armCapture();

    await executeToolInvocation(
      {
        invocationId: 'inv-2',
        capability: 'desktop.automation',
        input: { capability: 'browser', runId: 'run-1', input: { leaseId: LEASE, owner: 'u1', leaseOp: 'release' } },
      },
      deps(),
    );
    expect(hasNetworkRecorder(LEASE)).toBe(false);
  });

  it('route 2 - THE IDLE BACKSTOP drops it, and nobody sent a frame', async () => {
    // A short backstop, and no release. This is Cortex going away mid-run: the daemon reaps the
    // lease on its own, and before this fix that reap left the live header map resident.
    profiles = new ProfileManager({ home, idleCloseMs: 0, runIdleMs: 20, launch: async () => fakeContext() });
    await armCapture();

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(profiles.openRuns()).not.toContain(LEASE);
    expect(hasNetworkRecorder(LEASE)).toBe(false);
  });

  it('route 3 - DAEMON SHUTDOWN drops it, and nobody sent a frame either', async () => {
    profiles = new ProfileManager({ home, idleCloseMs: 0, runIdleMs: 0, launch: async () => fakeContext() });
    await armCapture();

    await profiles.closeAll();
    expect(hasNetworkRecorder(LEASE)).toBe(false);
  });

  it('and the explicit `captureOp:\'stop\'` still drops it too', async () => {
    profiles = new ProfileManager({ home, idleCloseMs: 0, runIdleMs: 0, launch: async () => fakeContext() });
    await armCapture();

    await executeToolInvocation(
      {
        invocationId: 'inv-3',
        capability: 'desktop.automation',
        input: { capability: 'browser', runId: 'run-1', input: { leaseId: LEASE, owner: 'u1', captureOp: 'stop' } },
      },
      deps(),
    );
    expect(hasNetworkRecorder(LEASE)).toBe(false);
  });
});

describe('the lease-end hook is a general holding, not a recorder special case', () => {
  it('fires once per lease, on the reap, and is not re-fired by a later release', async () => {
    profiles = new ProfileManager({ home, idleCloseMs: 0, runIdleMs: 20, launch: async () => fakeContext() });
    let fired = 0;
    await profiles.withRunLease({ leaseId: 'lease-2', profileId: PROFILE }, async () => undefined);
    profiles.onLeaseEnd('lease-2', () => { fired += 1; });

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fired).toBe(1);

    // A release arriving after the backstop already reaped is the ordinary case; it must not run
    // the cleanup a second time.
    await profiles.releaseRun('lease-2');
    expect(fired).toBe(1);
  });

  it('a THROWING hook does not stop the lease from ending', async () => {
    profiles = new ProfileManager({ home, idleCloseMs: 0, runIdleMs: 0, launch: async () => fakeContext() });
    await profiles.withRunLease({ leaseId: 'lease-3', profileId: PROFILE }, async () => undefined);
    profiles.onLeaseEnd('lease-3', () => { throw new Error('cleanup exploded'); });

    await expect(profiles.releaseRun('lease-3')).resolves.toBeUndefined();
    expect(profiles.openRuns()).not.toContain('lease-3');
  });
});
