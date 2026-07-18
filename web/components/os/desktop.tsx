'use client';

/**
 * The desktop: icons for the active workspace's items (surfaces + artifacts),
 * each with the three-trigger action menu (always-visible "...", right-click,
 * long-press). Click opens; membership/pinning are client state (contract 4.3).
 */

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play, Pin, PinOff, MonitorX } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/stores/i18n';
import { getSurface } from '@/lib/os/registry';
import { OS_STRINGS } from '@/lib/os/strings';
import type { ActionDef, DesktopItemRef, SurfaceHost } from '@/lib/os/types';
import { useActiveWorkspace, useOsStore, sameRef } from '@/stores/os';
import { ActionMenu, ActionMenuButton, type ActionMenuPosition } from '@/components/ui/action-menu';
import { useLongPress } from '@/hooks/useLongPress';
import { Box } from 'lucide-react';
import {
  buildArtifactActions,
  type ArtifactActionCtx,
  type ArtifactLike,
} from '@/components/artifacts/artifact-actions';
import type { OsArtifact } from './os-shell';

interface DesktopProps {
  artifacts: OsArtifact[];
  host: SurfaceHost;
  onStartRename: (artifact: OsArtifact) => void;
  onRequestDelete: (artifact: OsArtifact) => void;
  onRefresh: () => void;
}

interface OpenMenu {
  ref: DesktopItemRef;
  pos: ActionMenuPosition;
}

export function Desktop({ artifacts, host, onStartRename, onRequestDelete, onRefresh }: DesktopProps) {
  const router = useRouter();
  const { pages_artifacts: a } = useTranslation();
  const workspace = useActiveWorkspace();
  const pinItem = useOsStore((s) => s.pinItem);
  const unpinItem = useOsStore((s) => s.unpinItem);
  const removeDesktopItem = useOsStore((s) => s.removeDesktopItem);

  const [menu, setMenu] = useState<OpenMenu | null>(null);

  const artifactActions = useMemo(() => buildArtifactActions(a), [a]);

  // Surface icons get their own small menu (open / pin / remove), built on the
  // same ActionDef machinery the artifact items use.
  const surfaceActions: ActionDef<{ ref: DesktopItemRef }>[] = useMemo(
    () => [
      {
        id: 'open',
        label: OS_STRINGS.desktop.open,
        icon: Play,
        run: ({ ref }) => host.openSurface(ref.id),
      },
      {
        id: 'pin',
        label: OS_STRINGS.desktop.pinToDock,
        icon: Pin,
        available: ({ ref }) => !workspace?.pinnedIds.some((r) => sameRef(r, ref)),
        run: ({ ref }) => pinItem(ref),
      },
      {
        id: 'unpin',
        label: OS_STRINGS.dock.unpin,
        icon: PinOff,
        available: ({ ref }) => !!workspace?.pinnedIds.some((r) => sameRef(r, ref)),
        run: ({ ref }) => unpinItem(ref),
      },
      {
        id: 'remove',
        label: OS_STRINGS.desktop.removeFromDesktop,
        icon: MonitorX,
        run: ({ ref }) => removeDesktopItem(ref),
      },
    ],
    [host, workspace?.pinnedIds, pinItem, unpinItem, removeDesktopItem],
  );

  if (!workspace) return null;

  const menuArtifact =
    menu?.ref.kind === 'artifact' ? artifacts.find((ar) => ar.id === menu.ref.id) ?? null : null;

  const artifactCtx: ArtifactActionCtx | null = menuArtifact
    ? {
        artifact: menuArtifact,
        host,
        ui: {
          open: (artifact) =>
            host.openSurface('artifact-app', {
              artifactId: artifact.id,
              title: artifact.title || artifact.name,
              appUrl: (artifact as OsArtifact).appUrl,
            }),
          continueInChat: (artifact) => router.push(`/chat?continue=${artifact.id}`),
          startRename: (artifact) => onStartRename(artifact as OsArtifact),
          requestDelete: (artifact) => onRequestDelete(artifact as OsArtifact),
          refreshList: onRefresh,
          isPinned: (artifact) =>
            workspace.pinnedIds.some((r) => sameRef(r, { kind: 'artifact', id: artifact.id })),
          pinToDock: (artifact) => pinItem({ kind: 'artifact', id: artifact.id }),
          unpinFromDock: (artifact) => unpinItem({ kind: 'artifact', id: artifact.id }),
          removeFromDesktop: (artifact) =>
            removeDesktopItem({ kind: 'artifact', id: artifact.id }),
        },
      }
    : null;

  const openItem = (ref: DesktopItemRef) => {
    if (ref.kind === 'surface') {
      host.openSurface(ref.id);
      return;
    }
    const artifact = artifacts.find((ar) => ar.id === ref.id);
    if (artifact) {
      host.openSurface('artifact-app', {
        artifactId: artifact.id,
        title: artifact.title || artifact.name,
        appUrl: artifact.appUrl,
      });
    }
  };

  return (
    <div className="absolute inset-0 overflow-y-auto p-5 scrollbar-light" data-testid="os-desktop">
      {workspace.desktopItems.length === 0 && (
        <p className="mt-16 text-center text-sm text-neutral-400">
          {OS_STRINGS.shell.emptyDesktop}
        </p>
      )}
      <div className="flex flex-wrap content-start items-start gap-2">
        {workspace.desktopItems.map((ref) => {
          if (ref.kind === 'surface') {
            const manifest = getSurface(ref.id);
            if (!manifest) return null;
            return (
              <DesktopIcon
                key={`surface-${ref.id}`}
                testId={`os-icon-surface-${ref.id}`}
                label={manifest.title}
                icon={manifest.icon}
                onOpen={() => openItem(ref)}
                onMenu={(pos) => setMenu({ ref, pos })}
              />
            );
          }
          const artifact = artifacts.find((ar) => ar.id === ref.id);
          if (!artifact) return null; // deleted artifacts are filtered on render (contract 4.3)
          return (
            <DesktopIcon
              key={`artifact-${ref.id}`}
              testId={`os-icon-artifact-${ref.id}`}
              label={artifact.title || artifact.name || 'Artefacto'}
              icon={Box}
              dimmed={!artifact.appUrl}
              onOpen={() => openItem(ref)}
              onMenu={(pos) => setMenu({ ref, pos })}
            />
          );
        })}
      </div>

      {/* One menu, three triggers - artifact items use the shared definition,
          surface items the small surface list. */}
      {menu?.ref.kind === 'artifact' ? (
        <ActionMenu
          items={artifactActions}
          ctx={artifactCtx as ArtifactActionCtx}
          position={menu?.pos ?? null}
          onClose={() => setMenu(null)}
        />
      ) : (
        <ActionMenu
          items={surfaceActions}
          ctx={{ ref: menu?.ref as DesktopItemRef }}
          position={menu?.pos ?? null}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function DesktopIcon({
  label,
  icon: Icon,
  onOpen,
  onMenu,
  dimmed,
  testId,
}: {
  label: string;
  icon: LucideIcon;
  onOpen: () => void;
  onMenu: (pos: ActionMenuPosition) => void;
  dimmed?: boolean;
  testId: string;
}) {
  const { onContextMenu: _lp, ...longPress } = useLongPress(onMenu);
  void _lp;
  return (
    <div className="relative w-24" data-testid={testId}>
      <button
        onClick={onOpen}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onMenu({ x: e.clientX, y: e.clientY });
        }}
        {...longPress}
        title={label}
        className="flex w-full flex-col items-center gap-1.5 rounded-xl p-2 transition-colors hover:bg-neutral-900/[0.04] focus-ring"
      >
        <span
          className={`flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface shadow-card ${
            dimmed ? 'opacity-50' : ''
          }`}
        >
          <Icon size={26} className="text-teal-700" aria-hidden />
        </span>
        <span className="line-clamp-2 w-full text-center text-[11px] leading-tight text-neutral-700">
          {label}
        </span>
      </button>
      {/* Always-visible "..." (never hover-gated - touch has no hover). */}
      <ActionMenuButton
        onOpen={onMenu}
        label={OS_STRINGS.window.moreActions}
        className="absolute -right-0.5 -top-0.5 h-6 w-6 rounded-full border border-line bg-surface shadow-card"
      />
    </div>
  );
}
