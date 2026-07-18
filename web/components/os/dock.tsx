'use client';

/**
 * The dock: pinned items + the active workspace's open windows. Pinned items
 * open/focus their target; window chips restore/focus. Every dock item keeps
 * a visible "..." affordance (right-click/long-press are accelerators).
 */

import React, { useState } from 'react';
import { Box, X, Play, PinOff } from 'lucide-react';
import { getSurface } from '@/lib/os/registry';
import { OS_STRINGS } from '@/lib/os/strings';
import type { ActionDef, DesktopItemRef, SurfaceHost, WindowState } from '@/lib/os/types';
import { useActiveWorkspace, useOsStore } from '@/stores/os';
import { ActionMenu, type ActionMenuPosition } from '@/components/ui/action-menu';
import { useLongPress } from '@/hooks/useLongPress';
import type { OsArtifact } from './os-shell';

type DockTarget =
  | { kind: 'pin'; ref: DesktopItemRef }
  | { kind: 'window'; window: WindowState };

export function Dock({ host, artifacts }: { host: SurfaceHost; artifacts: OsArtifact[] }) {
  const workspace = useActiveWorkspace();
  const unpinItem = useOsStore((s) => s.unpinItem);
  const restoreWindow = useOsStore((s) => s.restoreWindow);
  const closeWindow = useOsStore((s) => s.closeWindow);

  const [menu, setMenu] = useState<{ target: DockTarget; pos: ActionMenuPosition } | null>(null);

  if (!workspace) return null;

  const openPin = (ref: DesktopItemRef) => {
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

  const menuItems: ActionDef<DockTarget>[] = [
    {
      id: 'open',
      label: OS_STRINGS.dock.open,
      icon: Play,
      available: (t) => t.kind === 'pin',
      run: (t) => {
        if (t.kind === 'pin') openPin(t.ref);
      },
    },
    {
      id: 'restore',
      label: OS_STRINGS.window.restore,
      icon: Play,
      available: (t) => t.kind === 'window',
      run: (t) => {
        if (t.kind === 'window') restoreWindow(t.window.id);
      },
    },
    {
      id: 'unpin',
      label: OS_STRINGS.dock.unpin,
      icon: PinOff,
      available: (t) => t.kind === 'pin',
      run: (t) => {
        if (t.kind === 'pin') unpinItem(t.ref);
      },
    },
    {
      id: 'close',
      label: OS_STRINGS.window.close,
      icon: X,
      destructive: true,
      available: (t) => t.kind === 'window',
      run: (t) => {
        if (t.kind === 'window') closeWindow(t.window.id);
      },
    },
  ];

  return (
    <div className="flex h-14 shrink-0 items-center justify-center gap-1 border-t border-line bg-surface/80 px-4 glass" data-testid="os-dock">
      {workspace.pinnedIds.map((ref) => {
        const label =
          ref.kind === 'surface'
            ? getSurface(ref.id)?.title ?? ref.id
            : artifacts.find((ar) => ar.id === ref.id)?.title ?? null;
        if (label === null) return null;
        const Icon = ref.kind === 'surface' ? getSurface(ref.id)?.icon ?? Box : Box;
        return (
          <DockButton
            key={`pin-${ref.kind}-${ref.id}`}
            testId={`os-dock-pin-${ref.id}`}
            label={label}
            onActivate={() => openPin(ref)}
            onMenu={(pos) => setMenu({ target: { kind: 'pin', ref }, pos })}
          >
            <Icon size={20} className="text-teal-700" aria-hidden />
          </DockButton>
        );
      })}

      {workspace.windows.length > 0 && (
        <div className="mx-2 h-7 w-px bg-line" aria-hidden />
      )}

      {workspace.windows.map((win) => (
        <DockButton
          key={win.id}
          testId={`os-dock-window-${win.id}`}
          label={win.title ?? getSurface(win.surfaceId)?.title ?? win.surfaceId}
          active={!win.minimized}
          onActivate={() => restoreWindow(win.id)}
          onMenu={(pos) => setMenu({ target: { kind: 'window', window: win }, pos })}
        >
          <span className="max-w-[120px] truncate text-xs">
            {win.title ?? getSurface(win.surfaceId)?.title ?? win.surfaceId}
          </span>
        </DockButton>
      ))}

      <ActionMenu
        items={menuItems}
        ctx={menu?.target as DockTarget}
        position={menu?.pos ?? null}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}

function DockButton({
  label,
  active,
  onActivate,
  onMenu,
  children,
  testId,
}: {
  label: string;
  active?: boolean;
  onActivate: () => void;
  onMenu: (pos: ActionMenuPosition) => void;
  children: React.ReactNode;
  testId: string;
}) {
  const { onContextMenu: _lp, ...longPress } = useLongPress(onMenu);
  void _lp;
  return (
    <button
      onClick={onActivate}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
      {...longPress}
      title={label}
      data-testid={testId}
      className={`flex h-10 items-center justify-center gap-1.5 rounded-xl border px-2.5 transition-colors focus-ring ${
        active
          ? 'border-teal-600/40 bg-teal-600/10 text-teal-800'
          : 'border-line bg-surface text-neutral-600 hover:border-line-strong hover:bg-neutral-50'
      }`}
    >
      {children}
    </button>
  );
}
