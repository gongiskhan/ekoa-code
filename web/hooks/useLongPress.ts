'use client';
import { useCallback, useRef } from 'react';

export interface LongPressPoint {
  x: number;
  y: number;
}

interface LongPressOptions {
  delayMs?: number;
  moveTolerancePx?: number;
}

/**
 * Touch/pen long-press detector (surface contract 3.1 - the third trigger of
 * every action menu). Mouse users have right-click; long-press fires only for
 * touch/pen pointers. Movement beyond the tolerance cancels. After a fire, the
 * synthesized click and context-menu events are suppressed so the menu the
 * caller opened is not immediately dismissed or duplicated.
 */
export function useLongPress(
  onLongPress: (point: LongPressPoint) => void,
  { delayMs = 500, moveTolerancePx = 8 }: LongPressOptions = {},
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<LongPressPoint | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      const point = { x: e.clientX, y: e.clientY };
      origin.current = point;
      fired.current = false;
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress(point);
      }, delayMs);
    },
    [onLongPress, delayMs],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!origin.current) return;
      const dx = e.clientX - origin.current.x;
      const dy = e.clientY - origin.current.y;
      if (dx * dx + dy * dy > moveTolerancePx * moveTolerancePx) cancel();
    },
    [cancel, moveTolerancePx],
  );

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Mobile browsers synthesize contextmenu on long-press; the menu is
    // already open, so swallow it.
    if (fired.current) e.preventDefault();
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (fired.current) {
      e.preventDefault();
      e.stopPropagation();
      fired.current = false;
    }
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu,
    onClickCapture,
  };
}
