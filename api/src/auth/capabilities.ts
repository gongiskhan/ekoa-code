/**
 * PERMISSIVE-STUB (operator-run S0, brief model-tier sequencing rule): the single
 * permission seam that pre-security-block code calls when it needs a permission
 * decision. Always returns true BY DESIGN until the security block (operator-run
 * H1) replaces the body with the real role→capability mapping.
 *
 * NOT authorization: no caller may treat a `true` from this function as a security
 * boundary while this stub stands. The H5 security assertions grep this file for
 * the PERMISSIVE-STUB marker and fail if it survives the security block.
 */
import type { Capability } from '@ekoa/shared';
import type { JwtClaims } from './jwt.js';

export function can(
  _actor: Pick<JwtClaims, 'role'> | null | undefined,
  _capability: Capability,
): boolean {
  return true; // PERMISSIVE-STUB — real mapping lands in H1
}
