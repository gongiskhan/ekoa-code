'use client';

/**
 * The window manager layer (surface contract 4.2): floating + tiled windows
 * above the desktop. Edge snapping and drop-to-split are the load-bearing
 * arrangement; freeform floating is secondary. Custom pointer-event
 * implementation - no windowing/DnD library.
 *
 * Mechanics worth knowing:
 * - Drag/resize use setPointerCapture on the handle, so moves keep flowing to
 *   the handle even over iframes; a transparent shield additionally covers
 *   every window body while a gesture is active (belt and braces - an iframe
 *   that somehow receives the pointer would wedge the drag).
 * - During a move the layer mutates the window element's style imperatively
 *   and only commits to the store on pointerup, so heavy surfaces do not
 *   re-render at pointer rate. Divider drags go through the store (the tiled
 *   layout must reflow) behind a rAF gate.
 * - A window's BODY declares `@container` (contract 2.3.4).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, X } from 'lucide-react';
import { getSurface } from '@/lib/os/registry';
import { OS_STRINGS } from '@/lib/os/strings';
import { computeLayout, type Quadrant } from '@/lib/os/tiling';
import type { Rect, SurfaceHost, WindowState } from '@/lib/os/types';
import { useActiveWorkspace, useOsStore } from '@/stores/os';
import { IconButton } from '@/components/ui/button';

const EDGE_ZONE_PX = 24;
const DRAG_THRESHOLD_PX = 4;
const DIVIDER_PX = 6;
const DEFAULT_MIN = { w: 320, h: 240 };

type DragState =
  | {
      kind: 'move';
      winId: string;
      pointerId: number;
      startX: number;
      startY: number;
      startRect: Rect;
      /** Tiled windows detach on first real movement. */
      wasTiled: boolean;
      moved: boolean;
      liveRect: Rect;
    }
  | {
      kind: 'resize';
      winId: string;
      pointerId: number;
      startX: number;
      startY: number;
      startRect: Rect;
      edge: 'e' | 's' | 'se';
      liveRect: Rect;
    };

type DropCandidate =
  | { kind: 'edge'; side: 'left' | 'right' }
  | { kind: 'window'; targetId: string; quadrant: Quadrant };

export function WindowLayer({ host }: { host: SurfaceHost }) {
  const workspace = useActiveWorkspace();
  const setWindowRect = useOsStore((s) => s.setWindowRect);
  const snapEdge = useOsStore((s) => s.snapEdge);
  const dropSplit = useOsStore((s) => s.dropSplit);
  const untile = useOsStore((s) => s.untile);
  const setTileRatio = useOsStore((s) => s.setTileRatio);

  const layerRef = useRef<HTMLDivElement>(null);
  const windowEls = useRef(new Map<string, HTMLElement>());
  const dragRef = useRef<DragState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [candidate, setCandidate] = useState<DropCandidate | null>(null);
  const [bounds, setBounds] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  // Desktop bounds via ResizeObserver - the tiled layout reflows with them.
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const update = () => setBounds({ x: 0, y: 0, w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tiling = workspace?.tiling ?? null;
  const layout = useMemo(() => computeLayout(tiling, bounds, DIVIDER_PX), [tiling, bounds]);

  const displayRect = useCallback(
    (win: WindowState): Rect => {
      const tiled = layout.rects[win.id];
      if (win.mode === 'tile' && tiled) return tiled;
      // Clamp floats into view so a restored layout on a smaller screen stays reachable.
      const w = Math.min(win.rect.w, Math.max(bounds.w, 320));
      const h = Math.min(win.rect.h, Math.max(bounds.h, 240));
      const x = Math.min(Math.max(win.rect.x, 80 - w), Math.max(bounds.w - 80, 0));
      const y = Math.min(Math.max(win.rect.y, 0), Math.max(bounds.h - 40, 0));
      return { x, y, w, h };
    },
    [layout.rects, bounds],
  );

  const localPoint = (e: React.PointerEvent) => {
    const rect = layerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const applyLive = (winId: string, rect: Rect) => {
    const el = windowEls.current.get(winId);
    if (!el) return;
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
  };

  const findCandidate = useCallback(
    (p: { x: number; y: number }, draggedId: string): DropCandidate | null => {
      if (p.x <= EDGE_ZONE_PX) return { kind: 'edge', side: 'left' };
      if (p.x >= bounds.w - EDGE_ZONE_PX) return { kind: 'edge', side: 'right' };
      if (!workspace) return null;
      // Topmost first (array order = z-order).
      for (let i = workspace.windows.length - 1; i >= 0; i--) {
        const win = workspace.windows[i];
        if (win.id === draggedId || win.minimized) continue;
        const r = displayRect(win);
        if (p.x < r.x || p.x > r.x + r.w || p.y < r.y || p.y > r.y + r.h) continue;
        const dx = (p.x - (r.x + r.w / 2)) / r.w;
        const dy = (p.y - (r.y + r.h / 2)) / r.h;
        const quadrant: Quadrant =
          Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'top' : 'bottom');
        return { kind: 'window', targetId: win.id, quadrant };
      }
      return null;
    },
    [bounds.w, workspace, displayRect],
  );

  // ---- Move gesture ----

  const beginMove = useCallback(
    (e: React.PointerEvent, win: WindowState) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const rect = displayRect(win);
      dragRef.current = {
        kind: 'move',
        winId: win.id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startRect: rect,
        wasTiled: win.mode === 'tile',
        moved: false,
        liveRect: rect,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [displayRect],
  );

  const moveDrag = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.kind !== 'move' || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved) {
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        setDragActive(true);
        if (drag.wasTiled) {
          // Detach: the window floats under the pointer at its remembered size.
          untile(drag.winId);
          const win = workspace?.windows.find((w) => w.id === drag.winId);
          const w = win?.rect.w ?? drag.startRect.w;
          const h = win?.rect.h ?? drag.startRect.h;
          const p = localPoint(e);
          drag.startRect = { x: p.x - Math.min(120, w / 2), y: p.y - 16, w, h };
          drag.startX = e.clientX;
          drag.startY = e.clientY;
        }
      }
      drag.liveRect = {
        ...drag.startRect,
        x: drag.startRect.x + (e.clientX - drag.startX),
        y: drag.startRect.y + (e.clientY - drag.startY),
      };
      applyLive(drag.winId, drag.liveRect);
      setCandidate(findCandidate(localPoint(e), drag.winId));
    },
    [findCandidate, untile, workspace],
  );

  const endMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.kind !== 'move' || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      setDragActive(false);
      const final = candidate;
      setCandidate(null);
      if (!drag.moved) return;
      if (final?.kind === 'edge') {
        snapEdge(drag.winId, final.side);
        return;
      }
      if (final?.kind === 'window') {
        dropSplit(final.targetId, drag.winId, final.quadrant);
        return;
      }
      setWindowRect(drag.winId, drag.liveRect);
    },
    [candidate, snapEdge, dropSplit, setWindowRect],
  );

  // ---- Resize gesture (floating windows) ----

  const beginResize = useCallback(
    (e: React.PointerEvent, win: WindowState, edge: 'e' | 's' | 'se') => {
      e.stopPropagation();
      const rect = displayRect(win);
      dragRef.current = {
        kind: 'resize',
        winId: win.id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startRect: rect,
        edge,
        liveRect: rect,
      };
      setDragActive(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [displayRect],
  );

  const resizeDrag = useCallback(
    (e: React.PointerEvent, win: WindowState) => {
      const drag = dragRef.current;
      if (!drag || drag.kind !== 'resize' || e.pointerId !== drag.pointerId) return;
      const min = getSurface(win.surfaceId)?.minSize ?? DEFAULT_MIN;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      drag.liveRect = {
        ...drag.startRect,
        w: drag.edge !== 's' ? Math.max(min.w, drag.startRect.w + dx) : drag.startRect.w,
        h: drag.edge !== 'e' ? Math.max(min.h, drag.startRect.h + dy) : drag.startRect.h,
      };
      applyLive(drag.winId, drag.liveRect);
    },
    [],
  );

  const endResize = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.kind !== 'resize' || e.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      setDragActive(false);
      setWindowRect(drag.winId, drag.liveRect);
    },
    [setWindowRect],
  );

  // ---- Divider drag (tiled ratio) ----

  const ratioFrameRef = useRef<number | null>(null);
  const onDividerMove = useCallback(
    (e: React.PointerEvent, path: string, dir: 'row' | 'col', region: Rect) => {
      if (!(e.buttons & 1)) return;
      const p = localPoint(e);
      const ratio =
        dir === 'row'
          ? (p.x - region.x - DIVIDER_PX / 2) / Math.max(1, region.w - DIVIDER_PX)
          : (p.y - region.y - DIVIDER_PX / 2) / Math.max(1, region.h - DIVIDER_PX);
      if (ratioFrameRef.current !== null) return;
      ratioFrameRef.current = requestAnimationFrame(() => {
        ratioFrameRef.current = null;
        setTileRatio(path, ratio);
      });
    },
    [setTileRatio],
  );

  if (!workspace) return null;

  // Snap/split preview rect.
  let preview: Rect | null = null;
  if (candidate?.kind === 'edge') {
    const half = Math.round((bounds.w - DIVIDER_PX) / 2);
    preview =
      candidate.side === 'left'
        ? { x: 0, y: 0, w: half, h: bounds.h }
        : { x: bounds.w - half, y: 0, w: half, h: bounds.h };
  } else if (candidate?.kind === 'window') {
    const target = workspace.windows.find((w) => w.id === candidate.targetId);
    if (target) {
      const r = displayRect(target);
      const half = { w: Math.round(r.w / 2), h: Math.round(r.h / 2) };
      preview =
        candidate.quadrant === 'left'
          ? { x: r.x, y: r.y, w: half.w, h: r.h }
          : candidate.quadrant === 'right'
            ? { x: r.x + r.w - half.w, y: r.y, w: half.w, h: r.h }
            : candidate.quadrant === 'top'
              ? { x: r.x, y: r.y, w: r.w, h: half.h }
              : { x: r.x, y: r.y + r.h - half.h, w: r.w, h: half.h };
    }
  }

  const floatingBase = 20;

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0" data-testid="os-window-layer">
      {workspace.windows.map((win, index) => {
        if (win.minimized) return null;
        const rect = displayRect(win);
        const z = win.mode === 'tile' ? 10 : floatingBase + index;
        return (
          <OsWindow
            key={win.id}
            win={win}
            rect={rect}
            zIndex={z}
            host={host}
            shield={dragActive}
            registerEl={(el) => {
              if (el) windowEls.current.set(win.id, el);
              else windowEls.current.delete(win.id);
            }}
            onBeginMove={beginMove}
            onMoveDrag={moveDrag}
            onEndMove={endMove}
            onBeginResize={beginResize}
            onResizeDrag={resizeDrag}
            onEndResize={endResize}
          />
        );
      })}

      {/* Tiled dividers. */}
      {layout.dividers.map((d) => (
        <div
          key={d.path || 'root'}
          role="separator"
          aria-orientation={d.dir === 'row' ? 'vertical' : 'horizontal'}
          data-testid={`os-divider-${d.path || 'root'}`}
          style={{ left: d.rect.x, top: d.rect.y, width: d.rect.w, height: d.rect.h, zIndex: 15 }}
          className={`pointer-events-auto absolute transition-colors hover:bg-teal-600/40 ${
            d.dir === 'row' ? 'cursor-col-resize' : 'cursor-row-resize'
          }`}
          onPointerDown={(e) => (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)}
          onPointerMove={(e) => onDividerMove(e, d.path, d.dir, d.region)}
        />
      ))}

      {/* Snap/split preview. */}
      {preview && (
        <div
          data-testid="os-snap-preview"
          style={{ left: preview.x, top: preview.y, width: preview.w, height: preview.h, zIndex: 60 }}
          className="pointer-events-none absolute rounded-xl border-2 border-teal-500/70 bg-teal-500/15"
        />
      )}
    </div>
  );
}

function OsWindow({
  win,
  rect,
  zIndex,
  host,
  shield,
  registerEl,
  onBeginMove,
  onMoveDrag,
  onEndMove,
  onBeginResize,
  onResizeDrag,
  onEndResize,
}: {
  win: WindowState;
  rect: Rect;
  zIndex: number;
  host: SurfaceHost;
  shield: boolean;
  registerEl: (el: HTMLElement | null) => void;
  onBeginMove: (e: React.PointerEvent, win: WindowState) => void;
  onMoveDrag: (e: React.PointerEvent) => void;
  onEndMove: (e: React.PointerEvent) => void;
  onBeginResize: (e: React.PointerEvent, win: WindowState, edge: 'e' | 's' | 'se') => void;
  onResizeDrag: (e: React.PointerEvent, win: WindowState) => void;
  onEndResize: (e: React.PointerEvent) => void;
}) {
  const focusWindow = useOsStore((s) => s.focusWindow);
  const minimizeWindow = useOsStore((s) => s.minimizeWindow);
  const closeWindow = useOsStore((s) => s.closeWindow);

  const manifest = getSurface(win.surfaceId);
  const title = win.title ?? manifest?.title ?? win.surfaceId;

  const windowHost: SurfaceHost = {
    ...host,
    requestClose: () => closeWindow(win.id),
  };

  return (
    <section
      ref={registerEl}
      role="dialog"
      aria-label={title}
      data-testid={`os-window-${win.surfaceId}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex }}
      className={`pointer-events-auto absolute flex min-h-0 flex-col overflow-hidden border border-line bg-surface shadow-raised ${
        win.mode === 'tile' ? 'rounded-lg' : 'rounded-xl'
      }`}
      onPointerDown={() => focusWindow(win.id)}
    >
      {/* Title bar = the move handle. */}
      <div
        data-window-titlebar
        className="flex h-9 shrink-0 cursor-grab select-none items-center justify-between border-b border-line bg-neutral-50 pl-3 pr-1 active:cursor-grabbing"
        onPointerDown={(e) => {
          // Buttons handle their own clicks.
          if ((e.target as HTMLElement).closest('button')) return;
          onBeginMove(e, win);
        }}
        onPointerMove={onMoveDrag}
        onPointerUp={onEndMove}
        onPointerCancel={onEndMove}
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
      <div className="@container relative flex min-h-0 flex-1 overflow-hidden">
        {manifest ? (
          <manifest.component instanceId={win.id} props={win.props} host={windowHost} />
        ) : (
          <p className="p-6 text-sm text-neutral-400">{win.surfaceId}</p>
        )}
        {/* Gesture shield: keeps iframes from eating a drag (contract 6.2.2). */}
        {shield && <div className="absolute inset-0 z-10" />}
      </div>

      {/* Resize handles (floating only; tiled regions resize via dividers). */}
      {win.mode === 'float' && (
        <>
          <div
            className="absolute inset-y-2 -right-0.5 w-2 cursor-ew-resize"
            data-resize-handle="e"
            onPointerDown={(e) => onBeginResize(e, win, 'e')}
            onPointerMove={(e) => onResizeDrag(e, win)}
            onPointerUp={onEndResize}
            onPointerCancel={onEndResize}
          />
          <div
            className="absolute inset-x-2 -bottom-0.5 h-2 cursor-ns-resize"
            data-resize-handle="s"
            onPointerDown={(e) => onBeginResize(e, win, 's')}
            onPointerMove={(e) => onResizeDrag(e, win)}
            onPointerUp={onEndResize}
            onPointerCancel={onEndResize}
          />
          <div
            className="absolute -bottom-0.5 -right-0.5 h-4 w-4 cursor-nwse-resize"
            data-resize-handle="se"
            onPointerDown={(e) => onBeginResize(e, win, 'se')}
            onPointerMove={(e) => onResizeDrag(e, win)}
            onPointerUp={onEndResize}
            onPointerCancel={onEndResize}
          />
        </>
      )}
    </section>
  );
}
