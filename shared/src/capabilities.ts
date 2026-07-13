/**
 * Capability vocabulary for the platform permission seam (operator-run S0).
 * NAMES ONLY — no role mapping here (this is the shared contract vocabulary).
 * The real role→capability mapping and every authorization decision live in
 * `api/src/auth/capabilities.ts` (the `can()` matrix) since the operator-run
 * security block (H1); the former permissive stub is gone (H5 grep-gates that
 * the retired stub marker never resurfaces anywhere in the tree).
 */
import { z } from 'zod';

export const Capability = z.enum([
  'canBuildApps',
  'canEditApps',
  'canCreateArtifacts',
  'canUseChat',
]);
export type Capability = z.infer<typeof Capability>;
