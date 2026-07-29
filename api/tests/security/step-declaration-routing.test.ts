import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import { resolveStepDeclaration } from '../../src/automation/types.js';
import {
  selectConnectionForStep,
  attachLiveConnection,
  __resetLiveConnectionsForTests,
} from '../../src/bridge/registry.js';

/**
 * SECURITY SUITE — step declarations and capability-matched placement (Cofre E-2 / E-4).
 *
 * BEFORE: the router picked "the newest live socket for this owner". A step could not say which
 * machine it needed, what that machine had to be able to do, or what should happen when the answer
 * was "none" — so every step ran wherever the last daemon to connect happened to be, and a step
 * written for the machine with the card reader would silently run on the laptop without one.
 *
 * The declaration is what makes placement expressible, and the DEFAULTS are what make it safe: a
 * step that declares nothing gets no capabilities, the `cloud` target, no credentials, and
 * `offlinePolicy: 'fail'`. Declaring nothing asks for nothing and stops — it does not mean
 * "anything goes", which is the reading a permissive default would have invited.
 */
const OWNER = 'owner-1';
const ORG = 'org-1';

const fakeWs = () => ({ send() {}, close() {}, terminate() {} }) as unknown as WebSocket;

function connect(pairingId: string, over: { org?: string; ownerUserId?: string } = {}) {
  return attachLiveConnection({
    pairingId,
    org: over.org ?? ORG,
    ownerUserId: over.ownerUserId ?? OWNER,
    ws: fakeWs(),
  });
}

beforeEach(() => __resetLiveConnectionsForTests());
afterEach(() => __resetLiveConnectionsForTests());

describe('E-2: an absent declaration resolves to the CLOSED defaults', () => {
  it('a step that declares nothing asks for nothing and refuses offline', () => {
    const d = resolveStepDeclaration({});
    expect(d.requiredCapabilities).toEqual([]);
    expect(d.target).toEqual({ kind: 'cloud' });
    expect(d.attended).toBe(false);
    expect(d.credentialRefs).toEqual([]);
    // The one that matters: a run that silently proceeds from a datacenter IP when it was written
    // to leave from a residential one is both a correctness and a detection problem.
    expect(d.offlinePolicy).toBe('fail');
  });

  it('a PARTIAL declaration keeps its stated fields and defaults the rest', () => {
    const d = resolveStepDeclaration({ declaration: { target: { kind: 'any', capability: 'local.bash' } } });
    expect(d.target).toEqual({ kind: 'any', capability: 'local.bash' });
    expect(d.offlinePolicy).toBe('fail');
    expect(d.attended).toBe(false);
  });

  it('REFUSES a raw secret in credentialRefs — references only (I5/I9)', () => {
    expect(() => resolveStepDeclaration({ declaration: { credentialRefs: ['sk-live-not-a-ref'] } })).toThrow();
  });

  it('refuses a capability outside the closed vocabulary', () => {
    expect(() =>
      resolveStepDeclaration({ declaration: { requiredCapabilities: ['local.rm-rf' as never] } }),
    ).toThrow();
  });
});

describe('E-4: placement follows the declaration, never "newest socket wins"', () => {
  const usable = (m: Record<string, string[]>) => new Map<string, readonly string[]>(Object.entries(m));

  it('cloud targets resolve to no machine at all', () => {
    connect('p1');
    expect(
      selectConnectionForStep({ ownerUserId: OWNER, org: ORG, target: { kind: 'cloud' }, usable: usable({ p1: ['local.bash'] }) }),
    ).toBeUndefined();
  });

  it('THE OLD BEHAVIOUR IS GONE: a newer socket does not win a capability it lacks', () => {
    connect('has-reader');
    connect('newer-plain'); // registered later — under the old rule this always won
    const chosen = selectConnectionForStep({
      ownerUserId: OWNER,
      org: ORG,
      target: { kind: 'any', capability: 'attended.card_login' },
      usable: usable({ 'has-reader': ['attended.card_login'], 'newer-plain': ['local.bash'] }),
    });
    expect(chosen?.pairingId).toBe('has-reader');
  });

  it('a PINNED target is that machine or nothing — never a substitute', () => {
    connect('pinned-one');
    connect('other');
    const caps = usable({ 'pinned-one': ['local.bash'], other: ['local.bash'] });

    expect(
      selectConnectionForStep({ ownerUserId: OWNER, org: ORG, target: { kind: 'pinned', pairingId: 'pinned-one' }, usable: caps })
        ?.pairingId,
    ).toBe('pinned-one');

    // The pinned machine is offline: no fallback, even though `other` could do the work. The run
    // declared a specific computer for a reason (its reader, its VPN, its residential line).
    __resetLiveConnectionsForTests();
    connect('other');
    expect(
      selectConnectionForStep({ ownerUserId: OWNER, org: ORG, target: { kind: 'pinned', pairingId: 'pinned-one' }, usable: caps }),
    ).toBeUndefined();
  });

  it('a pinned machine still needs the required capabilities', () => {
    connect('p1');
    expect(
      selectConnectionForStep({
        ownerUserId: OWNER,
        org: ORG,
        target: { kind: 'pinned', pairingId: 'p1' },
        usable: usable({ p1: ['local.bash'] }),
        requiredCapabilities: ['egress.residential'],
      }),
    ).toBeUndefined();
  });

  it('the target capability is required IN ADDITION to requiredCapabilities', () => {
    connect('p1');
    connect('p2');
    const chosen = selectConnectionForStep({
      ownerUserId: OWNER,
      org: ORG,
      target: { kind: 'any', capability: 'egress.residential' },
      usable: usable({ p1: ['egress.residential'], p2: ['egress.residential', 'local.bash'] }),
      requiredCapabilities: ['local.bash'],
    });
    expect(chosen?.pairingId).toBe('p2');
  });

  it('an UNGRANTED machine is never selected, however loudly it advertises (I-3)', () => {
    connect('rogue');
    expect(
      selectConnectionForStep({
        ownerUserId: OWNER,
        org: ORG,
        target: { kind: 'any', capability: 'local.bash' },
        usable: usable({}), // nothing granted
      }),
    ).toBeUndefined();
  });

  it('never crosses an ORG boundary, on either target kind', () => {
    connect('foreign', { org: 'other-org' });
    const caps = usable({ foreign: ['local.bash'] });
    expect(
      selectConnectionForStep({ ownerUserId: OWNER, org: ORG, target: { kind: 'any', capability: 'local.bash' }, usable: caps }),
    ).toBeUndefined();
    expect(
      selectConnectionForStep({ ownerUserId: OWNER, org: ORG, target: { kind: 'pinned', pairingId: 'foreign' }, usable: caps }),
    ).toBeUndefined();
  });

  it('never crosses an OWNER boundary', () => {
    connect('someone-elses', { ownerUserId: 'owner-2' });
    expect(
      selectConnectionForStep({
        ownerUserId: OWNER,
        org: ORG,
        target: { kind: 'any', capability: 'local.bash' },
        usable: usable({ 'someone-elses': ['local.bash'] }),
      }),
    ).toBeUndefined();
  });

  it('no match returns undefined so the caller applies the OFFLINE POLICY', () => {
    // Placement reports a fact about the fleet; what to do about it belongs to the run. Returning
    // some other machine here would take that decision away from the declaration.
    expect(
      selectConnectionForStep({ ownerUserId: OWNER, org: ORG, target: { kind: 'any', capability: 'local.bash' }, usable: usable({}) }),
    ).toBeUndefined();
  });
});
