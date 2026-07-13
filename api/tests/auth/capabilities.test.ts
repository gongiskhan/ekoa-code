/**
 * The real capability matrix (operator-run H1). REPLACES the S0 permissive-stub test: `can()` now
 * enforces the brief §9a role→capability grid, not a blanket `true`. The H5 security assertions
 * grep the source (api/src/auth/capabilities.ts) for the retired stub marker and fail if it
 * survives; this suite pins the behavior that replaced it.
 */
import { describe, it, expect } from 'vitest';
import { Capability } from '@ekoa/shared';
import { can } from '../../src/auth/capabilities.js';

// The authoritative grid. Every (role × capability) cell is asserted below — both the grants and
// the denials — so a future edit to the matrix cannot silently widen a role.
const EXPECTED: Record<'super-admin' | 'org-admin' | 'user', Record<Capability, boolean>> = {
  'super-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
  'org-admin': { canBuildApps: true, canEditApps: true, canCreateArtifacts: true, canUseChat: true },
  user: { canBuildApps: false, canEditApps: false, canCreateArtifacts: true, canUseChat: true },
};

describe('can() capability matrix (H1)', () => {
  it('every role × capability cell matches the brief grid (all 12 cells)', () => {
    for (const role of Object.keys(EXPECTED) as Array<keyof typeof EXPECTED>) {
      for (const capability of Capability.options) {
        expect(can({ role }, capability), `${role} / ${capability}`).toBe(EXPECTED[role][capability]);
      }
    }
  });

  it('a user holds exactly canUseChat + canCreateArtifacts — never the app build/edit capabilities', () => {
    expect(can({ role: 'user' }, 'canUseChat')).toBe(true);
    expect(can({ role: 'user' }, 'canCreateArtifacts')).toBe(true);
    expect(can({ role: 'user' }, 'canBuildApps')).toBe(false);
    expect(can({ role: 'user' }, 'canEditApps')).toBe(false);
  });

  it('admins (org-admin + super-admin) hold every capability', () => {
    for (const role of ['org-admin', 'super-admin'] as const) {
      for (const capability of Capability.options) {
        expect(can({ role }, capability), `${role} / ${capability}`).toBe(true);
      }
    }
  });

  it('a null/undefined actor holds NOTHING (fail closed)', () => {
    for (const capability of Capability.options) {
      expect(can(null, capability), `null / ${capability}`).toBe(false);
      expect(can(undefined, capability), `undefined / ${capability}`).toBe(false);
    }
  });

  it('the capability vocabulary is the brief-designed set (unchanged by H1)', () => {
    expect(Capability.options).toEqual(['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat']);
  });
});
