/**
 * operator-run S0: documents the PERMISSIVE-STUB contract of the can() seam.
 * This test is DELIBERATELY asserting permissiveness — the seam exists so
 * pre-security-block code has one chokepoint to call; the security block (H1)
 * replaces the stub, and the H5 capability-matrix suite REPLACES this test.
 * If this test still exists after the security block lands, that is a defect.
 */
import { describe, it, expect } from 'vitest';
import { Capability } from '@ekoa/shared';
import { can } from '../../src/auth/capabilities.js';

describe('can() permission seam (S0 permissive stub)', () => {
  it('returns true for every capability and any actor while the stub stands', () => {
    for (const capability of Capability.options) {
      expect(can({ role: 'builder' }, capability)).toBe(true);
      expect(can(null, capability)).toBe(true);
      expect(can(undefined, capability)).toBe(true);
    }
  });

  it('the capability vocabulary is the brief-designed set (names only, no semantics)', () => {
    expect(Capability.options).toEqual([
      'canBuildApps',
      'canEditApps',
      'canCreateArtifacts',
      'canUseChat',
    ]);
  });
});
