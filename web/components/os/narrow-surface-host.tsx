'use client';

/**
 * Narrow-viewport OS mode (surface contract 4.4): no windows, no chrome -
 * the focused surface renders full-screen over the desktop, with a slim bar
 * (title + minimize/close) and the Dock below acting as the switcher. Same
 * manifests, same actions; the tile tree stays in the store untouched so a
 * desktop revisit restores it.
 */

import React from 'react';
import { ChevronDown, X } from 'lucide-react';
import { getSurface } from '@/lib/os/registry';
import { OS_STRINGS } from '@/lib/os/strings';
import type { SurfaceHost } from '@/lib/os/types';
import { useActiveWorkspace, useOsStore } from '@/stores/os';
import { IconButton } from '@/components/ui/button';

export function NarrowSurfaceHost({ host }: { host: SurfaceHost }) {
  const workspace = useActiveWorkspace();
  const minimizeWindow = useOsStore((s) => s.minimizeWindow);
  const closeWindow = useOsStore((s) => s.closeWindow);

  if (!workspace) return null;
  // Topmost non-minimized window is the full-screen surface; none -> the
  // desktop shows through.
  const top = [...workspace.windows].reverse().find((w) => !w.minimized);
  if (!top) return null;

  const manifest = getSurface(top.surfaceId);
  const title = top.title ?? manifest?.title ?? top.surfaceId;

  const windowHost: SurfaceHost = {
    ...host,
    requestClose: () => closeWindow(top.id),
  };

  return (
    <div
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-surface"
      data-testid={`os-fullscreen-${top.surfaceId}`}
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-neutral-50 pl-3 pr-1">
        <span className="truncate text-xs font-medium text-neutral-700">{title}</span>
        <div className="flex items-center">
          <IconButton
            icon={ChevronDown}
            label={OS_STRINGS.window.minimize}
            size="sm"
            onClick={() => minimizeWindow(top.id)}
          />
          <IconButton
            icon={X}
            label={OS_STRINGS.window.close}
            size="sm"
            onClick={() => closeWindow(top.id)}
          />
        </div>
      </div>
      {/* Full-screen body still declares @container - here it measures the viewport. */}
      <div className="@container flex min-h-0 flex-1 overflow-hidden">
        {manifest ? (
          <manifest.component instanceId={top.id} props={top.props} host={windowHost} />
        ) : (
          <p className="p-6 text-sm text-neutral-400">{top.surfaceId}</p>
        )}
      </div>
    </div>
  );
}
