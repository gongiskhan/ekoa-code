'use client';

/**
 * The window layer: renders the active workspace's windows above the desktop.
 * A window = surface instance + layout state (contract 4.1); its BODY declares
 * `@container`, so @bp-* variants inside the mounted surface measure the
 * window, not the viewport (contract 2.3.4).
 */

import React from 'react';
import { Minus, X } from 'lucide-react';
import { getSurface } from '@/lib/os/registry';
import { OS_STRINGS } from '@/lib/os/strings';
import type { SurfaceHost, WindowState } from '@/lib/os/types';
import { useActiveWorkspace, useOsStore } from '@/stores/os';
import { IconButton } from '@/components/ui/button';

export function WindowLayer({ host }: { host: SurfaceHost }) {
  const workspace = useActiveWorkspace();
  if (!workspace) return null;

  return (
    <>
      {workspace.windows.map((win, index) =>
        win.minimized ? null : (
          <OsWindow key={win.id} win={win} zIndex={10 + index} host={host} />
        ),
      )}
    </>
  );
}

function OsWindow({ win, zIndex, host }: { win: WindowState; zIndex: number; host: SurfaceHost }) {
  const focusWindow = useOsStore((s) => s.focusWindow);
  const minimizeWindow = useOsStore((s) => s.minimizeWindow);
  const closeWindow = useOsStore((s) => s.closeWindow);

  const manifest = getSurface(win.surfaceId);
  const title = win.title ?? manifest?.title ?? win.surfaceId;

  // Every window carries its own requestClose so surface actions can close it.
  const windowHost: SurfaceHost = {
    ...host,
    requestClose: () => closeWindow(win.id),
  };

  return (
    <section
      role="dialog"
      aria-label={title}
      data-testid={`os-window-${win.surfaceId}`}
      style={{
        left: win.rect.x,
        top: win.rect.y,
        width: win.rect.w,
        height: win.rect.h,
        zIndex,
      }}
      className="absolute flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-raised"
      onPointerDown={() => focusWindow(win.id)}
    >
      {/* Title bar. */}
      <div
        data-window-titlebar
        className="flex h-9 shrink-0 cursor-default select-none items-center justify-between border-b border-line bg-neutral-50 pl-3 pr-1"
      >
        <span className="truncate text-xs font-medium text-neutral-700">{title}</span>
        <div className="flex items-center">
          <IconButton
            icon={Minus}
            label={OS_STRINGS.window.minimize}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              minimizeWindow(win.id);
            }}
          />
          <IconButton
            icon={X}
            label={OS_STRINGS.window.close}
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              closeWindow(win.id);
            }}
          />
        </div>
      </div>

      {/* The window body IS the surface's container (contract 2.3.4). */}
      <div className="@container flex min-h-0 flex-1 overflow-hidden">
        {manifest ? (
          <manifest.component instanceId={win.id} props={win.props} host={windowHost} />
        ) : (
          <p className="p-6 text-sm text-neutral-400">{win.surfaceId}</p>
        )}
      </div>
    </section>
  );
}
