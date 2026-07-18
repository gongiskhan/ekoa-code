import type { SurfaceManifest } from './types';
import { artifactsSurface } from '@/components/artifacts/artifacts.surface';
import { artifactAppSurface } from '@/components/artifacts/artifact-app.surface';

/**
 * The surface registry (contract 2.4): the one place that lists every surface,
 * NAV_ITEMS-style - one import + one line per surface. Manifest CONTENT lives
 * co-located with each surface's component; batch-two conversions add a line
 * here.
 */
export const SURFACES: SurfaceManifest[] = [
  artifactsSurface,
  artifactAppSurface,
];

export function getSurface(id: string): SurfaceManifest | undefined {
  return SURFACES.find((s) => s.id === id);
}
