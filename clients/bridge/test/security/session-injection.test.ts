import { describe, it, expect } from 'vitest';
import { makeRig, invokeAndWait, GRANT, type SecurityRig } from './helpers.js';
import type { BridgeFrame } from '../../src/wire/index.js';

/**
 * SECURITY SUITE - the DELIVERED SESSION is worn by the run it was delivered to, by no other run,
 * and never leaves this machine (S-inject; docs/decisions.md 2026-08-24, D-ADHOC-3).
 *
 * THE CLASS. `session.deliver` is the second frame in the union that carries credential material,
 * and a captured `storageState` is credential-equivalent: it authenticates a human at a portal as
 * completely as their password does. So it inherits the whole `secret.deliver` custody rule - RAM
 * only, never on bridge disk, never in a log, never on an outbound frame - plus one obligation a
 * secret does not have, because a session is injected into a jar that OUTLIVES the run: it must be
 * gone from both the jar and this process when the lease is released.
 *
 * WHY THE ASSERTIONS ARE ON `cookiesAdded` AND NOT ON THE HOLD. Asserting that the daemon REMEMBERS
 * a delivery proves it remembered something; the property that matters is that the browser context
 * the run drives was actually handed those cookies, because that - and only that - is what makes
 * the run start authenticated. The rig's fake context records what `addCookies` received, which is
 * the same call `browser/profile.ts` makes on the real one.
 */

const cookie = (name: string, value: string): Record<string, unknown> => ({
  name,
  value,
  domain: 'portal.test',
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
});

const deliverSession = (runId: string, storageState: unknown): BridgeFrame =>
  ({ type: 'session.deliver', runId, storageState }) as BridgeFrame;

/** A browser step for a NAMED run and lease - the two keys this whole suite is about. */
const browserStep = (invocationId: string, runId: string, leaseId: string): BridgeFrame =>
  ({
    type: 'tool.invoke',
    invocationId,
    capability: 'desktop.automation',
    input: {
      capability: 'browser',
      input: { owner: 'u1', leaseId, action: { action: 'navigate', url: 'https://portal.test/inbox' } },
      runId,
    },
  }) as BridgeFrame;

const releaseLease = (invocationId: string, runId: string, leaseId: string): BridgeFrame =>
  ({
    type: 'tool.invoke',
    invocationId,
    capability: 'desktop.automation',
    input: { capability: 'browser', input: { owner: 'u1', leaseId, leaseOp: 'release' }, runId },
  }) as BridgeFrame;

/** Every string anywhere in a frame, so an assertion cannot be fooled by nesting. */
function stringsIn(value: unknown, depth = 0): string[] {
  if (depth > 12) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((v) => stringsIn(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((v) => stringsIn(v, depth + 1));
  }
  return [];
}

function allOutboundText(rig: SecurityRig): string {
  return rig.sent.flatMap((f) => stringsIn(f)).join('\n');
}

describe('a delivered session is worn by the run it was delivered to', () => {
  it('injects the delivered cookies into the browser context that run drives', async () => {
    const rig = makeRig();
    rig.runtime.onFrame(deliverSession('run-A', { cookies: [cookie('SESSIONID', 'A-cookie-value-000111')], origins: [] }));

    const result = await invokeAndWait(rig, browserStep('inv-1', 'run-A', 'lease-A'));

    expect(result.ok).toBe(true);
    expect(rig.cookiesAdded.map((c) => c['value'])).toContain('A-cookie-value-000111');
  });

  it('accepts the WRAPPED shape the Cofre stores, not only a raw storageState', async () => {
    const rig = makeRig();
    // `parseSessionState` takes both, and it must: the capture half writes the wrapper and a
    // delivery that only understood one of the two would work for some items and silently not for
    // others - the worst possible split, because both look identical from Cortex.
    rig.runtime.onFrame(
      deliverSession('run-W', {
        storageState: { cookies: [cookie('SESSIONID', 'W-cookie-value-000222')], origins: [] },
        capturedAt: '2026-08-24T00:00:00.000Z',
      }),
    );

    await invokeAndWait(rig, browserStep('inv-1', 'run-W', 'lease-W'));

    expect(rig.cookiesAdded.map((c) => c['value'])).toContain('W-cookie-value-000222');
  });

  it('delivers NOTHING to a run that was delivered nothing - no most-recent fallback', async () => {
    const rig = makeRig();
    // THE ISOLATION PROPERTY, at the daemon's own key space. One daemon serves one owner but many
    // runs, and a lookup that answered with "the only session we hold" would be exactly how run B
    // ends up wearing run A's cookies. An unknown run starts signed out, visibly and recoverably.
    rig.runtime.onFrame(deliverSession('run-A', { cookies: [cookie('SESSIONID', 'A-cookie-value-000111')], origins: [] }));

    const result = await invokeAndWait(rig, browserStep('inv-2', 'run-B', 'lease-B'));

    expect(result.ok).toBe(true);
    expect(rig.cookiesAdded).toHaveLength(0);
  });
});

describe('a delivered session does not outlive the run', () => {
  it('WIPES THE JAR at lease release and forgets the delivery', async () => {
    const rig = makeRig();
    rig.runtime.onFrame(deliverSession('run-A', { cookies: [cookie('SESSIONID', 'A-cookie-value-000111')], origins: [] }));
    await invokeAndWait(rig, browserStep('inv-1', 'run-A', 'lease-A'));
    expect(rig.runtime.heldSessionCount()).toBe(1);

    const released = await invokeAndWait(rig, releaseLease('inv-2', 'run-A', 'lease-A'));

    expect(released.ok).toBe(true);
    // BOTH HALVES, and neither is sufficient alone. `clearCookies` is what stops the session
    // surviving on the shared PERSISTENT profile the next automation will use; the hold going to
    // zero is what stops it surviving in this PROCESS's memory. The durable copy lives in the
    // Cofre and nowhere else.
    expect(rig.cookiesCleared.count).toBeGreaterThan(0);
    expect(rig.runtime.heldSessionCount()).toBe(0);
  });

  it('a re-run after release starts SIGNED OUT until a new delivery arrives', async () => {
    const rig = makeRig();
    rig.runtime.onFrame(deliverSession('run-A', { cookies: [cookie('SESSIONID', 'A-cookie-value-000111')], origins: [] }));
    await invokeAndWait(rig, browserStep('inv-1', 'run-A', 'lease-A'));
    await invokeAndWait(rig, releaseLease('inv-2', 'run-A', 'lease-A'));
    rig.cookiesAdded.length = 0;

    // Same runId, a fresh lease - the shape a resumed pass takes. The forgetting has to be real:
    // if the hold had kept the state, this pass would silently re-wear a session Cortex has not
    // re-authorised, which is the whole reason the release drops it.
    await invokeAndWait(rig, browserStep('inv-3', 'run-A', 'lease-A2'));

    expect(rig.cookiesAdded).toHaveLength(0);
  });

  it('drops every held session when the socket goes away', () => {
    const rig = makeRig();
    rig.runtime.onFrame(deliverSession('run-A', { cookies: [cookie('SESSIONID', 'A-cookie-value-000111')], origins: [] }));
    rig.runtime.onFrame(deliverSession('run-B', { cookies: [cookie('SESSIONID', 'B-cookie-value-000333')], origins: [] }));
    expect(rig.runtime.heldSessionCount()).toBe(2);

    rig.runtime.clearSessions();

    expect(rig.runtime.heldSessionCount()).toBe(0);
  });

  it('drops every held session at shutdown, alongside the secrets', () => {
    const rig = makeRig();
    rig.runtime.onFrame(deliverSession('run-A', { cookies: [cookie('SESSIONID', 'A-cookie-value-000111')], origins: [] }));

    rig.runtime.zeroizeSecrets();

    expect(rig.runtime.heldSessionCount()).toBe(0);
  });
});

describe('a delivered session never leaves this machine', () => {
  it('puts no part of the storageState on any outbound frame', async () => {
    const rig = makeRig();
    const value = 'A-cookie-value-000111';
    rig.runtime.onFrame(deliverSession('run-A', { cookies: [cookie('SESSIONID', value)], origins: [] }));

    await invokeAndWait(rig, browserStep('inv-1', 'run-A', 'lease-A'));
    await invokeAndWait(rig, releaseLease('inv-2', 'run-A', 'lease-A'));

    // Structural, not filtered: nothing in the daemon ever BUILDS a frame from a delivered session,
    // so there is nothing here for the redactor to catch. The next case covers the other half - an
    // echo the daemon did not author.
    expect(allOutboundText(rig)).not.toContain(value);
    expect(rig.sent.some((f) => f.type === 'session.deliver')).toBe(false);
  });

  it('REDACTS the session cookie when the PAGE echoes it back', async () => {
    const rig = makeRig();
    const value = 'A-cookie-value-000111';
    rig.runtime.onFrame(deliverSession('run-A', { cookies: [cookie('SESSIONID', value)], origins: [] }));
    // The page now prints the session cookie into its own title/url/heading - a portal that puts a
    // token in a query string, a debug banner, an error page. The daemon did not author this text
    // and cannot refuse to observe it, so the ONLY thing standing between the value and the wire is
    // the outbound filter being armed at delivery time.
    rig.pageText.value = value;

    const result = await invokeAndWait(rig, browserStep('inv-1', 'run-A', 'lease-A'));

    expect(result.ok).toBe(true);
    expect(allOutboundText(rig)).not.toContain(value);
  });

  it('writes nothing about the delivery to the daemon log', async () => {
    const rig = makeRig();
    const value = 'A-cookie-value-000111';
    rig.runtime.onFrame(deliverSession('run-A', { cookies: [cookie('SESSIONID', value)], origins: [] }));
    await invokeAndWait(rig, browserStep('inv-1', 'run-A', 'lease-A'));

    // Not even the FACT of it. "A session arrived for run X", joined against a run listing, is a
    // statement about which portals this tenant holds sessions for - the same reasoning that keeps
    // `secret.deliver`'s env-var NAMES out of the log.
    const log = rig.logs.join('\n');
    expect(log).not.toContain(value);
    expect(log).not.toContain('session.deliver');
  });

  it('keeps a delivered session out of the bash rail entirely', async () => {
    const rig = makeRig();
    const value = 'A-cookie-value-000111';
    rig.runtime.onFrame(deliverSession('run-A', { cookies: [cookie('SESSIONID', value)], origins: [] }));

    // A session is a BROWSER credential. A bash step for the same run must not receive it in its
    // environment, its argv or its output - the two rails deliver different things and the hold is
    // only ever read by the browser executor.
    const result = await invokeAndWait(rig, {
      type: 'tool.invoke',
      invocationId: 'inv-b',
      capability: 'local.bash',
      input: { capability: 'bash', input: { argv: ['/usr/bin/env'], cwd: '.', grantRef: GRANT }, runId: 'run-A' },
    } as BridgeFrame);

    expect(stringsIn(result).join('\n')).not.toContain(value);
  });
});
