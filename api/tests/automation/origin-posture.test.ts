/**
 * Origin posture: the closed default, and the two things that must be structurally impossible
 * rather than merely discouraged - cloud egress on an adversarial origin, and a `permissive` label
 * following an action off the origin it was written for.
 *
 * This module is consumed by three later decisions (cloud-egress opt-in, bridge-only routing,
 * typist-vs-attended re-auth). Each of them reads it and none of them re-derives it, so every hole
 * here would be a hole in all three.
 */
import { describe, it, expect } from 'vitest';

import {
  classifyOrigin,
  resolveTargetPosture,
  type OriginPosture,
  type PostureBearingAction,
} from '../../src/automation/origin-posture.js';
import type {
  IntegrationAction,
  IntegrationActionOriginPosture,
} from '../../src/integrations/definitions.js';

// ---------------------------------------------------------------------------
// Compile-time pins (api/tsconfig.test.json typechecks this file, so these ARE gates)
// ---------------------------------------------------------------------------

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

/**
 * The posture union is declared twice on purpose - integrations/ (the declaration site) sits below
 * automation/ (the resolver) in the tier table and the dependency runs one way. This pin is what
 * stops the duplication from drifting: add a third posture on one side only and typecheck fails.
 */
export type _PostureUnionsAreIdentical = Assert<Equal<OriginPosture, IntegrationActionOriginPosture>>;

/** A real `IntegrationAction` must satisfy the structural shape the resolver reads. */
export type _IntegrationActionIsPostureBearing = Assert<
  IntegrationAction extends PostureBearingAction ? true : false
>;

// ---------------------------------------------------------------------------

const apiAction = (over: Partial<PostureBearingAction> = {}): PostureBearingAction => ({
  httpConfig: { baseUrl: 'https://portal.example.com' },
  ...over,
});

describe('classifyOrigin - default closed', () => {
  it('an origin with no action at all is adversarial with no cloud egress', () => {
    const c = classifyOrigin('https://portal.example.com');
    expect(c.posture).toBe('adversarial');
    expect(c.requiresAttendedAuth).toBe(false);
    expect(c.cloudEgressAllowed).toBe(false);
  });

  it('an action that declares nothing is adversarial - silence is not assent', () => {
    const c = classifyOrigin('https://portal.example.com', apiAction());
    expect(c.posture).toBe('adversarial');
    expect(c.cloudEgressAllowed).toBe(false);
  });

  it('a value that is not a URL gets the closed answer rather than a guess', () => {
    for (const bogus of ['', 'portal.example.com', 'not a url', '/relative/path']) {
      const c = classifyOrigin(bogus, apiAction({ posture: 'permissive' }));
      expect(c.posture).toBe('adversarial');
      expect(c.cloudEgressAllowed).toBe(false);
    }
  });
});

describe('classifyOrigin - an explicit declaration', () => {
  it('a permissive action opens cloud egress for its own origin', () => {
    const c = classifyOrigin('https://portal.example.com', apiAction({ posture: 'permissive' }));
    expect(c.posture).toBe('permissive');
    expect(c.cloudEgressAllowed).toBe(true);
  });

  it('compares origins, not strings: scheme+host+port match is enough', () => {
    const action = apiAction({ posture: 'permissive', httpConfig: { baseUrl: 'https://Portal.Example.com/api/v2?x=1' } });
    expect(classifyOrigin('https://portal.example.com/anything', action).posture).toBe('permissive');
  });

  it('THE CONTAINMENT RULE: the label does not follow the action off its own origin', () => {
    const action = apiAction({ posture: 'permissive' });
    // A redirect, an OAuth hop, a third-party embed - none of them inherit the author's label.
    for (const elsewhere of ['https://evil.example.com', 'http://portal.example.com', 'https://portal.example.com:8443']) {
      const c = classifyOrigin(elsewhere, action);
      expect(c.posture).toBe('adversarial');
      expect(c.cloudEgressAllowed).toBe(false);
    }
  });

  it('a browser-steps action (no httpConfig) has no origin of its own, so its label applies', () => {
    // Its origin is wherever its automation navigates; the author's label is the only statement
    // anyone has made about it, and the caller is executing THAT action.
    const c = classifyOrigin('https://tribunal.example.pt', { posture: 'permissive' });
    expect(c.posture).toBe('permissive');
    expect(c.cloudEgressAllowed).toBe(true);
  });

  it('attended auth is independent of posture - a permissive site can still demand an OTP', () => {
    const c = classifyOrigin('https://portal.example.com', apiAction({
      posture: 'permissive',
      authProfile: { attended: true },
    }));
    expect(c.posture).toBe('permissive');
    expect(c.requiresAttendedAuth).toBe(true);

    const d = classifyOrigin('https://portal.example.com', apiAction({
      posture: 'adversarial',
      authProfile: { attended: false },
    }));
    expect(d.posture).toBe('adversarial');
    expect(d.requiresAttendedAuth).toBe(false);
  });
});

describe('cloudEgressAllowed is structurally impossible on an adversarial origin', () => {
  it('no combination of declarations produces adversarial + cloud egress', () => {
    const declarations: PostureBearingAction[] = [
      {},
      { posture: 'adversarial' },
      { posture: 'adversarial', authProfile: { attended: true } },
      apiAction({ posture: 'adversarial' }),
      apiAction({ posture: 'permissive' }), // classified against a DIFFERENT origin below
    ];
    for (const action of declarations) {
      const c = classifyOrigin('https://other.example.com', action);
      if (c.posture === 'adversarial') expect(c.cloudEgressAllowed).toBe(false);
    }
  });

  it('the classification is frozen, so a consumer cannot flip the field after the fact', () => {
    const c = classifyOrigin('https://portal.example.com', apiAction());
    expect(Object.isFrozen(c)).toBe(true);
    // Non-strict assignment to a frozen object is a silent no-op; a TS caller would not compile.
    expect(() => {
      Object.defineProperty(c, 'cloudEgressAllowed', { value: true });
    }).toThrow();
    expect(c.cloudEgressAllowed).toBe(false);
  });
});

describe('resolveTargetPosture - posture wins over the cloud default (plan trap T9)', () => {
  const cloud = { kind: 'cloud' } as const;

  it('a declaration-free step (which defaults to cloud) is overridden on an adversarial origin', () => {
    // This is the legacy case the rule exists for: every automation authored before posture
    // existed declares nothing, and resolveStepDeclaration fills that in as target: cloud.
    const verdict = resolveTargetPosture(cloud, classifyOrigin('https://portal.example.com'));
    expect(verdict.cloudAllowed).toBe(false);
    expect(verdict.overriddenByPosture).toBe(true);
    expect(verdict.reason).toMatch(/adversarial/);
  });

  it('a permissive origin keeps its cloud target', () => {
    const c = classifyOrigin('https://portal.example.com', apiAction({ posture: 'permissive' }));
    const verdict = resolveTargetPosture(cloud, c);
    expect(verdict.cloudAllowed).toBe(true);
    expect(verdict.overriddenByPosture).toBe(false);
  });

  it('an explicit non-cloud target is not an override - it already asks for a machine', () => {
    const c = classifyOrigin('https://portal.example.com');
    for (const target of [
      { kind: 'pinned', pairingId: 'pair-1' } as const,
      { kind: 'any', capability: 'egress.residential' } as const,
    ]) {
      const verdict = resolveTargetPosture(target, c);
      expect(verdict.cloudAllowed).toBe(false);
      expect(verdict.overriddenByPosture).toBe(false);
    }
  });
});
