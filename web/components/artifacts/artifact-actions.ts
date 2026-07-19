import { Play, Pencil, TextCursorInput, CopyPlus, Trash2, Pin, PinOff, MonitorX } from 'lucide-react';
import { api, tryCall } from '@/lib/api';
import { toast } from '@/stores/toast';
import type { ActionDef, SurfaceHost } from '@/lib/os/types';
import { OS_STRINGS } from '@/lib/os/strings';
import type { Translations } from '@/locales/types';

/**
 * The artifact item-type action list (surface contract 3.3): ONE definition,
 * rendered by the always-visible "...", right-click, and long-press - on the
 * classic artifacts cards and on OS-mode desktop icons alike. Commands map to
 * EXISTING endpoints only; `ui` is the seam each mount binds to its own
 * affordances (classic overlay/dialog state vs OS windows).
 */

/** Structural subset of the artifact both mounts already hold. */
export interface ArtifactLike {
  id: string;
  status: string;
  slug?: string;
  title?: string;
  name?: string;
}

export interface ArtifactActionUi {
  open: (artifact: ArtifactLike) => void;
  continueInChat: (artifact: ArtifactLike) => void;
  startRename: (artifact: ArtifactLike) => void;
  requestDelete: (artifact: ArtifactLike) => void;
  refreshList: () => void;
  /** OS shell only: dock pinning + desktop membership (client state). */
  isPinned?: (artifact: ArtifactLike) => boolean;
  pinToDock?: (artifact: ArtifactLike) => void;
  unpinFromDock?: (artifact: ArtifactLike) => void;
  removeFromDesktop?: (artifact: ArtifactLike) => void;
}

export interface ArtifactActionCtx {
  artifact: ArtifactLike;
  host: SurfaceHost;
  ui: ArtifactActionUi;
}

export function isArtifactRunnable(status: string): boolean {
  return (
    status === 'running' || status === 'ready' || status === 'active' || status === 'healthy'
  );
}

export function buildArtifactActions(
  labels: Translations['pages_artifacts'],
): ActionDef<ArtifactActionCtx>[] {
  return [
    {
      id: 'open',
      label: labels.cardMenu.open,
      icon: Play,
      available: ({ artifact }) => isArtifactRunnable(artifact.status),
      run: ({ artifact, host, ui }) => {
        if (host.mode === 'os') {
          host.openSurface('artifact-app', {
            artifactId: artifact.id,
            title: artifact.title || artifact.name,
          });
        } else {
          ui.open(artifact);
        }
      },
    },
    {
      id: 'continue-in-chat',
      label: labels.continueWorking,
      icon: Pencil,
      run: ({ artifact, ui }) => ui.continueInChat(artifact),
    },
    {
      id: 'rename',
      label: labels.cardMenu.rename,
      icon: TextCursorInput,
      run: ({ artifact, ui }) => ui.startRename(artifact),
    },
    {
      id: 'duplicate',
      label: labels.cardMenu.duplicate,
      icon: CopyPlus,
      run: async ({ artifact, ui }) => {
        const result = await tryCall(() => api.artifacts.fork({ id: artifact.id }));
        if (result.ok) {
          toast.success(labels.cardMenu.duplicateDone);
          ui.refreshList();
        } else {
          toast.error(result.error.message);
        }
      },
    },
    // OS-shell-only items (availability keys on host.mode + the ui hooks the
    // shell binds; labels are OS-only strings, raw PT-PT per contract 6.1.5).
    {
      id: 'pin-dock',
      label: OS_STRINGS.desktop.pinToDock,
      icon: Pin,
      available: ({ host, ui, artifact }) =>
        host.mode === 'os' && !!ui.pinToDock && !(ui.isPinned?.(artifact) ?? false),
      run: ({ artifact, ui }) => ui.pinToDock?.(artifact),
    },
    {
      id: 'unpin-dock',
      label: OS_STRINGS.dock.unpin,
      icon: PinOff,
      available: ({ host, ui, artifact }) =>
        host.mode === 'os' && !!ui.unpinFromDock && (ui.isPinned?.(artifact) ?? false),
      run: ({ artifact, ui }) => ui.unpinFromDock?.(artifact),
    },
    {
      id: 'remove-desktop',
      label: OS_STRINGS.desktop.removeFromDesktop,
      icon: MonitorX,
      available: ({ host, ui }) => host.mode === 'os' && !!ui.removeFromDesktop,
      run: ({ artifact, ui }) => ui.removeFromDesktop?.(artifact),
    },
    {
      id: 'delete',
      label: labels.deleteArtifact,
      icon: Trash2,
      destructive: true,
      run: ({ artifact, ui }) => ui.requestDelete(artifact),
    },
  ];
}
