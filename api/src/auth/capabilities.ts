/**
 * The platform capability layer (operator-run H1 security block). The single permission seam:
 * every capability decision in the api goes through `can()`. A PURE role→capability map — it
 * carries NO org/resource context by design (resource + tenancy checks stay separate:
 * `loadWritable`/`loadReadable` in apps/app-paths.ts, the org scoping in the users/registo
 * services). Wiring `can()` into a route does not replace an ownership check; the two compose.
 *
 * Matrix (brief §9a):
 *   super-admin → all four capabilities.
 *   org-admin   → all four capabilities.
 *   user        → canUseChat + canCreateArtifacts ONLY (chat + non-app artifacts; a plain user
 *                 cannot build or change apps — canBuildApps/canEditApps are admin-only).
 *   null/undefined actor → NOTHING (fail closed: an absent actor has no capabilities, so a caller
 *                 that forgets to resolve the actor is denied rather than silently allowed).
 *
 * This REPLACES the pre-security-block permissive stub (whose grep-marker the H5 security
 * assertions fail on): every decision here is a real capability grant, never a blanket allow.
 */
import type { Capability, Role } from '@ekoa/shared';
import type { JwtClaims } from './jwt.js';

/** The role→capability grid. `Record<Role, …>` so a new Role value is a compile error until it is
 *  given an explicit capability set here (fail-closed by construction — no role defaults to more). */
const CAPABILITIES: Record<Role, ReadonlyArray<Capability>> = {
  'super-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
  'org-admin': ['canBuildApps', 'canEditApps', 'canCreateArtifacts', 'canUseChat'],
  user: ['canCreateArtifacts', 'canUseChat'],
};

/** Does `actor` hold `capability`? Pure role lookup. A null/undefined actor holds nothing, and an
 *  unrecognised role (e.g. a stale value a signature-valid token might still carry) also holds
 *  nothing — both fail closed. Resource/tenancy authorization is a SEPARATE, composed check. */
export function can(
  actor: Pick<JwtClaims, 'role'> | null | undefined,
  capability: Capability,
): boolean {
  if (!actor) return false;
  const granted = CAPABILITIES[actor.role] as ReadonlyArray<Capability> | undefined;
  return granted?.includes(capability) ?? false;
}
