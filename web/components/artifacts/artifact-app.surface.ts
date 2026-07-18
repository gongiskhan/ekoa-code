import { AppWindow } from 'lucide-react';
import type { SurfaceManifest } from '@/lib/os/types';
import { ArtifactAppSurface } from './artifact-app-surface';

/** A served artifact app in a window - multi-instance, keyed by artifactId (contract 2.5). */
export const artifactAppSurface: SurfaceManifest = {
  id: 'artifact-app',
  title: 'Aplicação',
  icon: AppWindow,
  minSize: { w: 320, h: 240 },
  preferredSize: { w: 900, h: 600 },
  singleton: false,
  component: ArtifactAppSurface,
  actions: [],
};
