/**
 * Capability vocabulary for the platform permission seam (operator-run S0).
 * NAMES ONLY — no role mapping, no enforcement, no authorization semantics.
 * The real role→capability mapping and every authorization decision land in the
 * operator-run security block (H1); until then `api/src/auth/capabilities.ts`
 * exposes a PERMISSIVE stub over these names.
 */
import { z } from 'zod';

export const Capability = z.enum([
  'canBuildApps',
  'canEditApps',
  'canCreateArtifacts',
  'canUseChat',
]);
export type Capability = z.infer<typeof Capability>;
