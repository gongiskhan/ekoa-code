import { describe, it, expect, vi } from 'vitest';
import type { Actor } from '@ekoa/shared';
import {
  evaluateCredentialGate,
  credentialEstablishmentMode,
  cofrePortalDeepLink,
} from '../../src/automation/credential-gate.js';
import type { Step } from '../../src/automation/types.js';

/**
 * THE GATE: what triggers it, where the origin comes from, and what it asks the human for.
 *
 * The whole point of the slice is that this is GENERAL. `ensureSession` used to be reachable from
 * exactly one place — the Citius sync rail — so every other integration got no session handling at
 * all. Nothing below names an integration except as data, and the first block asserts that the
 * trigger is a DECLARATION rather than a guess about which sites look like portals.
 */

const actor: Actor = { userId: 'u1', orgId: 'o1', role: 'user' } as Actor;

function step(over: Partial<Step> = {}): Step {
  return { id: 's1', description: 'do a thing', type: 'browser', ...over } as Step;
}

function declared(over: Partial<Step> = {}): Step {
  return step({ declaration: { credentialRefs: ['cofre:itm_password_1'] }, ...over });
}

function gate(
  steps: Step[],
  index: number,
  deps: Parameters<typeof evaluateCredentialGate>[1] = {},
  /** The P4.1 run-loop facts. An absent `hostedBrowser` is the CLOSED default: it is what the run
   *  loop supplies when this process has no hosted browser to offer for the step at all. */
  over: Partial<Parameters<typeof evaluateCredentialGate>[0]> = {},
) {
  return evaluateCredentialGate(
    { actor, runId: 'run_1', automationName: 'A run', steps, index, ...over },
    {
      loadActionDeclaration: async () => null,
      ensure: async () => ({ status: 'needs-human', route: 'attended', reason: 'nothing stored', attempted: false }),
      ...deps,
    },
  );
}

describe('what triggers the gate', () => {
  it('a step that declares no credential is not gated (backward compat, trap T6)', async () => {
    const ensure = vi.fn();
    const verdict = await gate([step({ type: 'navigate', url: 'https://portal.example/login' })], 0, {
      ensure: ensure as never,
    });
    expect(verdict).toEqual({ kind: 'not-applicable' });
    // Not merely "answered not-applicable" — it must not have COST anything either.
    expect(ensure).not.toHaveBeenCalled();
  });

  it('a declared step with no resolvable origin is not gated, and does not halt the run', async () => {
    const ensure = vi.fn();
    // A templated URL is a host the run has not resolved yet, which is not a statement about where
    // a credential goes. Halting on it would be a stop nobody can act on.
    const verdict = await gate([declared({ type: 'navigate', url: 'https://{{input.host}}/login' })], 0, {
      ensure: ensure as never,
    });
    expect(verdict).toEqual({ kind: 'not-applicable' });
    expect(ensure).not.toHaveBeenCalled();
  });

  it('a declared step with an origin is gated', async () => {
    const verdict = await gate([declared({ type: 'navigate', url: 'https://portal.example/login' })], 0);
    expect(verdict.kind).toBe('needs-credentials');
  });
});

describe('where the origin comes from', () => {
  it("a navigate step's own URL", async () => {
    const verdict = await gate([declared({ type: 'navigate', url: 'https://Portal.Example:443/x?y=1' })], 0);
    expect(verdict.kind === 'needs-credentials' && verdict.request.origin).toBe('portal.example');
  });

  it("an integration step's resolved httpConfig.baseUrl, through the seam", async () => {
    const loadActionDeclaration = vi.fn(async () => ({ httpConfig: { baseUrl: 'https://api.acme.example/v2' } }));
    const verdict = await gate(
      [declared({ type: 'integration', integrationKey: 'acme', integrationAction: 'fetch' })],
      0,
      { loadActionDeclaration: loadActionDeclaration as never },
    );
    expect(loadActionDeclaration).toHaveBeenCalledWith('acme', 'fetch', actor);
    expect(verdict.kind === 'needs-credentials' && verdict.request.origin).toBe('api.acme.example');
  });

  it('a browser step inherits the portal the run most recently navigated to', async () => {
    const steps = [
      step({ id: 's0', type: 'navigate', url: 'https://portal.example/login' }),
      declared({ id: 's1', type: 'browser' }),
    ];
    const verdict = await gate(steps, 1);
    expect(verdict.kind === 'needs-credentials' && verdict.request.origin).toBe('portal.example');
    expect(verdict.kind === 'needs-credentials' && verdict.request.stepIndex).toBe(1);
  });

  it('walks backwards to the NEAREST preceding origin, not the first one', async () => {
    const steps = [
      step({ id: 's0', type: 'navigate', url: 'https://first.example/' }),
      step({ id: 's1', type: 'navigate', url: 'https://second.example/' }),
      declared({ id: 's2', type: 'browser' }),
    ];
    const verdict = await gate(steps, 2);
    expect(verdict.kind === 'needs-credentials' && verdict.request.origin).toBe('second.example');
  });
});

describe('what the halt carries', () => {
  it('an origin, a deep link, a mode and a reason — and no field a value could occupy', async () => {
    const verdict = await gate([declared({ type: 'navigate', url: 'https://portal.example/login' })], 0);
    expect(verdict.kind).toBe('needs-credentials');
    if (verdict.kind !== 'needs-credentials') return;
    // A password reference EXISTS here, so checkout wanting a person means the password is not the
    // missing piece: the ask is a ceremony, and a ceremony carries its login prompt.
    expect(Object.keys(verdict.request).sort()).toEqual([
      'ceremony',
      'integrationKey',
      'mode',
      'origin',
      'portalDeepLink',
      'reason',
      'stepIndex',
    ]);
    expect(verdict.request.portalDeepLink).toBe(cofrePortalDeepLink('portal.example'));
    // Not even the REFERENCE travels. It is opaque and non-secret, but the halt has no reason to
    // carry it and a payload that carries what it does not need is how the next field gets added.
    expect(JSON.stringify(verdict.request)).not.toContain('cofre:itm_password_1');
  });

  it('the ceremony variant carries a login relay prompt the portal can render', async () => {
    const verdict = await gate([declared({ type: 'navigate', url: 'https://portal.example/login' })], 0, {
      loadActionDeclaration: async () => null,
      ensure: async () => ({ status: 'needs-human', route: 'relay', reason: 'unknown login form', attempted: true }),
    });
    expect(verdict.kind).toBe('needs-credentials');
    if (verdict.kind !== 'needs-credentials') return;
    expect(verdict.request.mode).toBe('ceremony');
    expect(verdict.request.ceremony).toMatchObject({ operation: 'login', siteOrigin: 'portal.example' });
  });

  it('a live session is READY, not a halt', async () => {
    const verdict = await gate([declared({ type: 'navigate', url: 'https://portal.example/login' })], 0, {
      ensure: async () => ({ status: 'reused', itemId: 'itm_1', storageState: { cookies: [] } }),
    });
    expect(verdict).toMatchObject({ kind: 'ready', itemId: 'itm_1' });
  });

  it('a healthy session with no route out is a MACHINE problem, not a credential one', async () => {
    // Sending the user to the Cofre to fix an egress gap would be a lie; there is nothing there to
    // establish. It surfaces as the existing "a machine of yours is needed" halt instead.
    const verdict = await gate([declared({ type: 'navigate', url: 'https://portal.example/login' })], 0, {
      ensure: async () => ({
        status: 'needs-egress',
        itemId: 'itm_1',
        required: { kind: 'residential', pairingId: 'pair_7' },
      }),
    });
    expect(verdict.kind).toBe('needs-machine');
    expect(verdict.kind === 'needs-machine' && verdict.reason).toContain('pair_7');
  });
});

describe('credentialEstablishmentMode — what the human is asked to do', () => {
  it('an attended-auth origin is ALWAYS a ceremony, whatever else is true', () => {
    for (const route of ['attended', 'relay'] as const) {
      for (const hasCredentialRef of [true, false]) {
        expect(credentialEstablishmentMode({ requiresAttendedAuth: true, route, hasCredentialRef })).toBe('ceremony');
      }
    }
  });

  it('no credential stored yet and no attended requirement => typist (the cheapest honest ask)', () => {
    expect(
      credentialEstablishmentMode({ requiresAttendedAuth: false, route: 'attended', hasCredentialRef: false }),
    ).toBe('typist');
  });

  it('a password exists and checkout still wants a person => ceremony', () => {
    expect(
      credentialEstablishmentMode({ requiresAttendedAuth: false, route: 'attended', hasCredentialRef: true }),
    ).toBe('ceremony');
  });

  it('the relay route is always a ceremony: the typist met a form it does not know', () => {
    expect(
      credentialEstablishmentMode({ requiresAttendedAuth: false, route: 'relay', hasCredentialRef: false }),
    ).toBe('ceremony');
  });
});

describe('generality (Rule 3: no consumer special-casing)', () => {
  it('two unrelated integrations, declared identically, get identical treatment', async () => {
    const build = (key: string, host: string) =>
      gate([declared({ type: 'integration', integrationKey: key, integrationAction: 'fetch' })], 0, {
        loadActionDeclaration: async () => ({ httpConfig: { baseUrl: `https://${host}/api` } }),
      });

    const a = await build('citius', 'citius.mj.pt');
    const b = await build('some-other-erp', 'erp.example');
    expect(a.kind).toBe('needs-credentials');
    expect(b.kind).toBe('needs-credentials');
    if (a.kind !== 'needs-credentials' || b.kind !== 'needs-credentials') return;

    expect(a.request.mode).toBe(b.request.mode);
    expect(Object.keys(a.request).sort()).toEqual(Object.keys(b.request).sort());
    // Blank out the four things that are genuinely per-integration or per-issuance (the origin, the
    // key, the deep link derived from the origin, and the relay's own id + site). If anything ELSE
    // differs, something branched on the integration.
    const normalise = (r: typeof a.request) => ({
      ...r,
      origin: '',
      integrationKey: '',
      portalDeepLink: '',
      ...(r.ceremony ? { ceremony: { ...r.ceremony, relayId: '', siteOrigin: '', expiresAt: '' } } : {}),
    });
    expect(normalise(a.request)).toEqual(normalise(b.request));
  });

  it('the posture declaration is what makes a login attended — not the key', async () => {
    const verdict = await gate(
      [declared({ type: 'integration', integrationKey: 'anything', integrationAction: 'fetch' })],
      0,
      {
        loadActionDeclaration: async () => ({
          httpConfig: { baseUrl: 'https://otp.example/api' },
          authProfile: { attended: true },
        }),
        ensure: async (input) => {
          // The classification travels into establishment, which is where it becomes a veto (P3.3).
          expect(input.requiresAttendedAuth).toBe(true);
          return { status: 'needs-human', route: 'attended', reason: 'attended', attempted: false };
        },
      },
    );
    expect(verdict.kind === 'needs-credentials' && verdict.request.mode).toBe('ceremony');
  });
});

/**
 * P4.2 — THE CEREMONY PAIRING TRAVELS, AND ONLY WHERE IT MEANS SOMETHING.
 *
 * A captured session was made at a particular vantage point, and the pairing where its ceremony
 * happened is already on the item (`sessionMetadata.establishedBy.pairingId`). For an ADVERSARIAL
 * origin that is a routing preference: run there or wait. For a PERMISSIVE one it is noise — the
 * credential is portable, so pinning the run to a laptop would cost availability for nothing.
 *
 * The gate is where both facts are in hand (the posture it just classified, the pairing checkout
 * reported), which is why the filter lives here rather than downstream.
 */
describe('the ceremony pairing is a preference for adversarial origins only', () => {
  const ready = (pairingId?: string) => async () => ({
    status: 'reused' as const,
    itemId: 'itm_session_1',
    storageState: { cookies: [] },
    ...(pairingId ? { establishedByPairingId: pairingId } : {}),
  });

  it('an adversarial origin carries it', async () => {
    const verdict = await gate(
      [declared({ type: 'integration', integrationKey: 'portal', integrationAction: 'fetch' })],
      0,
      {
        loadActionDeclaration: async () => ({ httpConfig: { baseUrl: 'https://portal.example/api' } }),
        ensure: ready('pair_home'),
      },
    );
    expect(verdict).toMatchObject({ kind: 'ready', preferredPairingId: 'pair_home' });
  });

  it('a permissive origin drops it — a portable credential has no home', async () => {
    const verdict = await gate(
      [declared({ type: 'integration', integrationKey: 'portal', integrationAction: 'fetch' })],
      0,
      {
        loadActionDeclaration: async () => ({
          posture: 'permissive',
          httpConfig: { baseUrl: 'https://portal.example/api' },
        }),
        ensure: ready('pair_home'),
      },
    );
    expect(verdict.kind).toBe('ready');
    expect(verdict).not.toHaveProperty('preferredPairingId');
  });

  it('a cloud-established session names no machine, so there is nothing to prefer', async () => {
    const verdict = await gate(
      [declared({ type: 'integration', integrationKey: 'portal', integrationAction: 'fetch' })],
      0,
      {
        loadActionDeclaration: async () => ({ httpConfig: { baseUrl: 'https://portal.example/api' } }),
        ensure: ready(),
      },
    );
    expect(verdict.kind).toBe('ready');
    expect(verdict).not.toHaveProperty('preferredPairingId');
  });
});

/**
 * P4.1 - THE TYPIST'S BROWSER IS GATED ON POSTURE, and this is the block that would have caught
 * the defect the first cut of this slice shipped with.
 *
 * THE FAILURE. The gate fires on a declaration (`credentialRefs`), with no precondition of any
 * kind, and it calls `ensureSession` - whose typist path OPENS THE HOSTED CHROMIUM and submits a
 * password. Posture was consulted here for exactly one thing (`requiresAttendedAuth`) and never for
 * whether a browser might be opened at all, so a step naming a Cofre item against a portal nobody
 * had classified would: classify CLOSED (adversarial, not attended) => reach the typist => open
 * hosted Chromium with no route argument, i.e. the datacenter => type the password into an
 * adversarial origin. That is the precise event this whole slice exists to prevent.
 *
 * THE ASSERTION SHAPE. Every case below asserts on the ARGUMENT handed to `ensureSession`, not on
 * the verdict: the verdict cannot distinguish "refused to open a browser" from "opened one and it
 * failed", and the permit is exactly the thing that decides which happened.
 */
describe('the typist may only open a hosted browser posture permits', () => {
  const permissive = { posture: 'permissive' as const, httpConfig: { baseUrl: 'https://portal.example' } };

  /** Capture what the gate asked `ensureSession` for. */
  function spyEnsure() {
    const calls: Array<Record<string, unknown>> = [];
    const ensure = (async (input: Record<string, unknown>) => {
      calls.push(input);
      return { status: 'needs-human', route: 'attended', reason: 'nothing stored', attempted: false };
    }) as never;
    return { ensure, calls };
  }

  const portalStep = () => declared({ type: 'navigate', url: 'https://portal.example/login' });

  it('an UNDECLARED origin gets NO permit, even when the run loop offered a hosted browser', async () => {
    const { ensure, calls } = spyEnsure();
    await gate([portalStep()], 0, { ensure }, { hostedBrowser: {} });
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('hostedTypist');
  });

  it('an ADVERSARIAL declaration gets no permit either - it is the same answer, stated', async () => {
    const { ensure, calls } = spyEnsure();
    await gate(
      [declared({ type: 'integration', integrationKey: 'portal', integrationAction: 'fetch' })],
      0,
      { ensure, loadActionDeclaration: async () => ({ posture: 'adversarial', httpConfig: { baseUrl: 'https://portal.example' } }) },
      { hostedBrowser: {} },
    );
    expect(calls[0]).not.toHaveProperty('hostedTypist');
  });

  it('a PERMISSIVE origin gets the permit, carrying the route the run loop resolved', async () => {
    const { ensure, calls } = spyEnsure();
    const egress = { outcome: 'machine' as const, pairingId: 'pair_home', proxyUrl: 'http://100.64.0.7:1080' };
    await gate(
      [declared({ type: 'integration', integrationKey: 'portal', integrationAction: 'fetch' })],
      0,
      { ensure, loadActionDeclaration: async () => permissive },
      { hostedBrowser: { egress } },
    );
    expect(calls[0]!['hostedTypist']).toEqual({ egress });
  });

  it('...and NOT when the run loop offered no hosted browser at all', async () => {
    // Both halves are required and neither is sufficient. This is the half posture cannot supply:
    // a production deployment with the hosted browser off, or a step whose locality is the bridge.
    const { ensure, calls } = spyEnsure();
    await gate(
      [declared({ type: 'integration', integrationKey: 'portal', integrationAction: 'fetch' })],
      0,
      { ensure, loadActionDeclaration: async () => permissive },
    );
    expect(calls[0]).not.toHaveProperty('hostedTypist');
  });

  it('a permissive origin with no resolved route still gets a permit, for the datacenter', async () => {
    const { ensure, calls } = spyEnsure();
    await gate(
      [declared({ type: 'integration', integrationKey: 'portal', integrationAction: 'fetch' })],
      0,
      { ensure, loadActionDeclaration: async () => permissive },
      { hostedBrowser: {} },
    );
    expect(calls[0]!['hostedTypist']).toEqual({});
  });
});
