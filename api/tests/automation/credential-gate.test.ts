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

  /**
   * THE ADDRESS AND THE BINDING ARE TWO FACTS, and this block is what stops them being one again.
   *
   * `origin` is a bare host because a credential binds to a host. But a ceremony has to OPEN a
   * window, and a bare host cannot say http-vs-https or name a port - so the daemon prepended
   * `https://` and went to :443. That made every portal not on https default port unreachable,
   * including this repo's own acceptance fixture at `http://127.0.0.1:45180`, whose ceremony leg
   * could therefore never complete (found live 2026-08-31: ERR_CONNECTION_TIMED_OUT at
   * `https://127.0.0.1/`). `siteUrl` carries scheme + host + port and nothing else.
   */
  describe('the openable address (siteUrl)', () => {
    it('carries the scheme and port a bare host cannot, for an http portal on a non-default port', async () => {
      const verdict = await gate([declared({ type: 'navigate', url: 'http://127.0.0.1:45180/painel' })], 0);
      expect(verdict.kind === 'needs-credentials' && verdict.request.origin).toBe('127.0.0.1');
      expect(verdict.kind === 'needs-credentials' && verdict.request.siteUrl).toBe('http://127.0.0.1:45180');
    });

    it('is absent when it would only repeat the daemon\'s own default', async () => {
      // `https://<origin>` is exactly what the daemon assumes unaided, so emitting it would add a
      // field carrying no information and a second place for the two to disagree.
      const verdict = await gate([declared({ type: 'navigate', url: 'https://portal.example/login' })], 0);
      expect(verdict.kind === 'needs-credentials' && verdict.request.siteUrl).toBeUndefined();
    });

    it('keeps a non-default port even on https', async () => {
      const verdict = await gate([declared({ type: 'navigate', url: 'https://portal.example:8443/login' })], 0);
      expect(verdict.kind === 'needs-credentials' && verdict.request.siteUrl).toBe('https://portal.example:8443');
    });

    it('drops the path and the query, which is the whole reason a full URL was refused', async () => {
      // A login link's query routinely carries a token, and this value ends up in a window a human
      // is sitting in front of. Scheme and port are not secrets; everything after the authority is.
      const verdict = await gate(
        [declared({ type: 'navigate', url: 'http://portal.example:8080/login?token=SECRET#frag' })],
        0,
      );
      expect(verdict.kind === 'needs-credentials' && verdict.request.siteUrl).toBe('http://portal.example:8080');
    });

    it('refuses a non-http scheme rather than pointing a headed window at it', async () => {
      const verdict = await gate([declared({ type: 'navigate', url: 'file:///etc/passwd' })], 0);
      // No host to bind to either, so the gate declines the step outright.
      expect(verdict).toEqual({ kind: 'not-applicable' });
    });

    it('rides the deep link so the portal can hand it back on establish', async () => {
      const verdict = await gate([declared({ type: 'navigate', url: 'http://127.0.0.1:45180/painel' })], 0);
      expect(verdict.kind === 'needs-credentials' && verdict.request.portalDeepLink).toBe(
        cofrePortalDeepLink('127.0.0.1', 'http://127.0.0.1:45180'),
      );
      expect(cofrePortalDeepLink('127.0.0.1', 'http://127.0.0.1:45180')).toBe(
        '/cofre?origin=127.0.0.1&siteUrl=http%3A%2F%2F127.0.0.1%3A45180',
      );
    });

    it('leaves the deep link exactly as it was when there is no widening to carry', async () => {
      expect(cofrePortalDeepLink('portal.example')).toBe('/cofre?origin=portal.example');
      expect(cofrePortalDeepLink('portal.example', null)).toBe('/cofre?origin=portal.example');
    });

    it('reaches the ceremony prompt the portal renders', async () => {
      const verdict = await gate([declared({ type: 'navigate', url: 'http://127.0.0.1:45180/painel' })], 0);
      expect(verdict.kind === 'needs-credentials' && verdict.request.ceremony?.siteUrl).toBe(
        'http://127.0.0.1:45180',
      );
      // The binding half is untouched: the prompt still names the host the capture binds to.
      expect(verdict.kind === 'needs-credentials' && verdict.request.ceremony?.siteOrigin).toBe('127.0.0.1');
    });
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

  /**
   * ...AND IT CARRIES THE TWO FACTS ITS CALLER CANNOT RE-DERIVE.
   *
   * The engine has to decide whether the machine checkout named is merely ASLEEP or has been
   * REVOKED - the difference between a neutral wait and a terminal "re-establish this session" -
   * and only the engine holds the fleet listing that answers it. Both facts therefore travel as
   * DATA. Fold either back into `reason` and the caller is parsing an English sentence to route a
   * halt; drop `requiredPairingId` and the retirement classification silently stops firing, which
   * restores the unbounded schedule retry it exists to remove (docs/findings.md, 2026-08-19).
   */
  it('...and it names the machine and the portal as DATA, not only inside the message', async () => {
    const verdict = await gate([declared({ type: 'navigate', url: 'https://portal.example/login' })], 0, {
      ensure: async () => ({
        status: 'needs-egress',
        itemId: 'itm_1',
        required: { kind: 'residential', pairingId: 'pair_7' },
      }),
    });
    expect(verdict).toMatchObject({
      kind: 'needs-machine',
      origin: 'portal.example',
      requiredPairingId: 'pair_7',
    });
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
 *
 * AND IT TRAVELS WITH ITS ORIGIN. A session belongs to ONE portal, so a bare pairing id is a value
 * that can be misfiled - the run loop kept one in a run-level variable and applied it to every later
 * browser step, so a run touching two portals judged portal B against portal A's ceremony machine.
 * The gate emits `{ origin, pairingId }` together, which is what makes that misfiling impossible to
 * express rather than merely discouraged.
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
    // THE ORIGIN COMES WITH IT. Without it the run loop has a machine and no idea which portal it
    // is about, which is exactly the state in which it filed one portal's preference against
    // another's steps.
    expect(verdict).toMatchObject({
      kind: 'ready',
      preferredPairing: { origin: 'portal.example', pairingId: 'pair_home' },
    });
  });

  it('...and the origin it names is the one this step was gated for, not some other step’s', async () => {
    // Two portals in one step list, gated at the SECOND. `resolveStepOrigin` walks backwards from
    // the index, so the pairing must be labelled `outra.example` - the site this step is about.
    const verdict = await gate(
      [
        declared({ type: 'integration', integrationKey: 'portal', integrationAction: 'fetch' }),
        declared({ type: 'integration', integrationKey: 'outra', integrationAction: 'fetch' }),
      ],
      1,
      {
        loadActionDeclaration: async (key) => ({
          httpConfig: { baseUrl: key === 'outra' ? 'https://outra.example/api' : 'https://portal.example/api' },
        }),
        ensure: ready('pair_home'),
      },
    );
    expect(verdict).toMatchObject({
      kind: 'ready',
      preferredPairing: { origin: 'outra.example', pairingId: 'pair_home' },
    });
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
    expect(verdict).not.toHaveProperty('preferredPairing');
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
    expect(verdict).not.toHaveProperty('preferredPairing');
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
