/**
 * THE REPLAY'S OWN WIRING, through the REAL frame handler (slice P2.3).
 *
 * `inject-inheritance.test.ts` proves the mechanism against a real browser. This suite proves the
 * PLUMBING that gets there: that an `injectedCall` frame arriving on an ordinary lease - one that
 * never armed a capture, which is EVERY replay lease, because a replay run does not drive the
 * automation - still ends up with a recorder listening, a page on the call's origin, and the
 * recipe's header NAMES filled from what that page's own traffic revealed.
 *
 * THE FAILURE THIS PINS. The first cut read `recorders.get(leaseId)` and forwarded `{}` when there
 * was none. On a replay lease there is never one, so `recipe.headerNames` - the single most valuable
 * thing a capture learns, "which header carries the session" - was dropped on the one path that
 * exists to use it. Every unit test passed: they all handed the resolver in themselves.
 *
 * Everything below drives `executeToolInvocation`, the real `ProfileManager` and the real recorder;
 * only the page is a fake, and it is a fake that MOVES - `goto` changes its url and emits the boot
 * traffic a real site emits, because a page that cannot do those two things cannot tell a working
 * replay from a broken one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileManager, type ProfileContext, type ProfilePage } from '../../src/browser/index.js';
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
const LEASE = 'lease-replay';
const PROFILE = 'profile-replay';
const ORIGIN = 'https://portal.example';
/** The value the SITE sends. It is never named in a frame and never stored in a recipe. */
const LIVE_CSRF = 'csrf-live-7c21';

let home: string;
let ledgerDir: string;
let profiles: ProfileManager;
let pages: FakePage[] = [];

interface FakePage extends ProfilePage {
  scripts: string[];
  gotos: string[];
}

/**
 * A page that MOVES. `goto` lands it on the requested origin and emits the one request a real site
 * emits on load - its own authenticated API call, carrying the header the recipe knows by name.
 * That emission is the only source of the live value in this suite.
 */
function fakePage(): FakePage {
  const handlers: Array<(r: unknown) => void> = [];
  let current = 'about:blank';
  const scripts: string[] = [];
  const gotos: string[] = [];
  const page = {
    scripts,
    gotos,
    url: () => current,
    isClosed: () => false,
    close: async () => undefined,
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    title: async () => 'Processos',
    viewportSize: () => ({ width: 1280, height: 800 }),
    screenshot: async () => Buffer.from('png'),
    goto: async (url: string) => {
      gotos.push(url);
      current = `${url}/`;
      // The site's own boot traffic, as Playwright would report it to the recorder.
      for (const h of handlers) {
        h({
          url: () => `${url}/api/session`,
          status: () => 200,
          headers: () => ({ 'content-type': 'application/json' }),
          text: async () => '{"ok":true}',
          request: () => ({
            url: () => `${url}/api/session`,
            method: () => 'GET',
            resourceType: () => 'xhr',
            headers: () => ({ 'x-csrf-token': LIVE_CSRF, accept: 'application/json' }),
            postData: () => null,
          }),
        });
      }
      return null;
    },
    evaluate: async (script: string) => {
      scripts.push(script);
      return JSON.stringify({
        status: 200,
        ok: true,
        bodyText: '{"items":[]}',
        truncated: false,
        contentType: 'application/json',
        responseHeaderNames: ['content-type'],
      });
    },
    on: (_e: string, h: (r: unknown) => void) => { handlers.push(h); },
    off: (_e: string, h: (r: unknown) => void) => {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    },
  };
  return page as unknown as FakePage;
}

function fakeContext(): ProfileContext {
  const opened: ProfilePage[] = [];
  return {
    newPage: async () => { const p = fakePage(); pages.push(p); opened.push(p); return p; },
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

/** One `injectedCall` frame, exactly as Cortex sends it: a URL and header NAMES. */
function injectFrame(headerNames: string[], url = `${ORIGIN}/api/cases`) {
  return {
    invocationId: 'inv-replay',
    capability: 'desktop.automation' as const,
    input: {
      capability: 'browser' as const,
      runId: 'replay-run',
      input: { leaseId: LEASE, owner: 'u1', injectedCall: { method: 'GET', url, headerNames } },
    },
  };
}

/** A page act that provokes traffic (a navigate re-loads the origin, and the fake emits the site's
 *  boot request). What the lease's recorder does with that traffic is the thing under test. */
function actFrame(invocationId: string) {
  return {
    invocationId,
    capability: 'desktop.automation' as const,
    input: {
      capability: 'browser' as const,
      runId: 'replay-run',
      input: { leaseId: LEASE, owner: 'u1', action: { action: 'navigate', url: ORIGIN } },
    },
  };
}

/** Cortex arming a real capture on the same lease. */
function captureStartFrame() {
  return {
    invocationId: 'inv-capture',
    capability: 'desktop.automation' as const,
    input: {
      capability: 'browser' as const,
      runId: 'replay-run',
      input: { leaseId: LEASE, owner: 'u1', captureOp: 'start' as const },
    },
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ekoa-replay-wiring-'));
  ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-replay-wiring-ledger-'));
  pages = [];
  profiles = new ProfileManager({ home, launch: async () => fakeContext(), idleCloseMs: 0, runIdleMs: 0 });
});

afterEach(async () => {
  disposeNetworkRecorder(LEASE);
  await profiles.closeAll().catch(() => undefined);
  rmSync(home, { recursive: true, force: true });
  rmSync(ledgerDir, { recursive: true, force: true });
});

describe('an injectedCall frame on a lease that never armed a capture', () => {
  it('lands the page on the call\'s origin and fills the learned NAME from the live session', async () => {
    const result = await executeToolInvocation(injectFrame(['x-csrf-token']), deps());
    expect(result.ok).toBe(true);

    const page = pages[0]!;
    // It navigated - the page began on about:blank, which inherits nothing.
    expect(page.gotos).toEqual([ORIGIN]);
    // …and the script it ran carries the value the SITE revealed, forwarded by the NAME the recipe
    // supplied. Neither the frame nor the recipe ever held this string.
    expect(page.scripts).toHaveLength(1);
    expect(page.scripts[0]).toContain(LIVE_CSRF);
    expect(page.scripts[0]).toContain('x-csrf-token');
  });

  it('forwards NOTHING for a name the live session never showed - it does not invent one', async () => {
    const result = await executeToolInvocation(injectFrame(['x-absent-header']), deps());
    expect(result.ok).toBe(true);
    const script = pages[0]!.scripts[0]!;
    expect(script).not.toContain('x-absent-header');
    expect(script).not.toContain(LIVE_CSRF);
  });

  it('never forges cookie from the live map - the jar is the browser\'s to supply', async () => {
    // `cookie` IS in the recorder's live map (the boot request carries one on a real site), and
    // forging it would replace the live jar with a remembered value.
    await executeToolInvocation(injectFrame(['cookie', 'x-csrf-token']), deps());
    const script = pages[0]!.scripts[0]!;
    expect(script).not.toMatch(/"cookie"\s*:/i);
    expect(script).toContain(LIVE_CSRF);
  });

  it('arms the recorder VALUES-ONLY - it keeps the live map and buffers no body for a reader that does not exist', async () => {
    await executeToolInvocation(injectFrame(['x-csrf-token']), deps());
    // The replay armed one even though nobody sent `captureOp:'start'`.
    expect(hasNetworkRecorder(LEASE)).toBe(true);

    // THE OBSERVABLE for "not buffering": a page act drains the lease's recorder onto its
    // observation. The navigation above provoked real traffic, so a BUFFERING recorder would hand
    // that exchange - response body and all - back to Cortex here. Nothing drains a replay's
    // recorder in production, so those bodies would just accumulate on the user's machine.
    const acted = await executeToolInvocation(actFrame('inv-act-1'), deps());
    expect(acted.ok).toBe(true);
    expect((acted.output as { captures?: unknown[] }).captures).toBeUndefined();

    // …and the SAME recorder upgrades when a capture is genuinely armed, rather than a second one
    // being attached to the same page (which would record every exchange twice).
    await executeToolInvocation(captureStartFrame(), deps());
    const afterArming = await executeToolInvocation(actFrame('inv-act-2'), deps());
    const captures = (afterArming.output as { captures?: unknown[] }).captures ?? [];
    expect(captures).toHaveLength(1);

    // The lease ends: the live values go with it, by the one funnel every route lands on.
    await profiles.releaseRun(LEASE, { profileId: PROFILE });
    expect(hasNetworkRecorder(LEASE)).toBe(false);
  });
});
