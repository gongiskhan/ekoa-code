import { Box } from 'lucide-react';
import type { SurfaceManifest } from '@/lib/os/types';
import { ArtifactsSurface } from './artifacts-surface';

/** The artifacts manager - run 1's template surface (contract 2.5). */
export const artifactsSurface: SurfaceManifest = {
  id: 'artifacts',
  title: 'Artefactos',
  icon: Box,
  minSize: { w: 360, h: 420 },
  preferredSize: { w: 960, h: 640 },
  singleton: true,
  component: ArtifactsSurface,
  actions: [],
};
