"use client";

import { useEffect, useRef } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAutomationsStore } from '@/stores/automations';
import {
  openCanvas,
  CANVAS_CLOSE_NORMAL,
  type CanvasSession,
  type CanvasInputEvent,
  type CanvasStatus,
} from '@/lib/api';
import type { StreamingConnectionStatus, StreamingSession } from '@/types/automation';

interface Props {
  session: StreamingSession;
  onStatusChange?: (status: StreamingConnectionStatus) => void;
}

/** Map the media-channel status to the store's connection status vocabulary. */
function canvasStatusToConnection(status: CanvasStatus): StreamingConnectionStatus {
  switch (status) {
    case 'connecting':
      return 'connecting';
    case 'open':
      return 'connected';
    case 'closed':
    default:
      return 'disconnected';
  }
}

export default function PauseForUserCanvas({ session, onStatusChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasSessionRef = useRef<CanvasSession | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingBitmapRef = useRef<ImageBitmap | null>(null);
  const viewportRef = useRef<{ width: number; height: number }>(session.viewport);
  const isMobile = useIsMobile();
  const setStreamingStatus = useAutomationsStore((s) => s.setStreamingStatus);

  useEffect(() => {
    viewportRef.current = session.viewport;
  }, [session.viewport]);

  const updateStatus = (status: StreamingConnectionStatus) => {
    setStreamingStatus(status);
    onStatusChange?.(status);
  };

  const paintImageDirect = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
    ctx.drawImage(img, 0, 0);
  };

  const scheduleRepaint = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      const bitmap = pendingBitmapRef.current;
      if (!canvas || !bitmap) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      ctx.drawImage(bitmap, 0, 0);
      try { bitmap.close(); } catch { /* noop */ }
      pendingBitmapRef.current = null;
    });
  };

  // Frame paint pump driven by rAF - drops late frames so we never block.
  const handleIncomingFrame = (frame: Blob) => {
    if (typeof window !== 'undefined' && 'createImageBitmap' in window) {
      void createImageBitmap(frame)
        .then((bitmap) => {
          const previous = pendingBitmapRef.current;
          if (previous) {
            try { previous.close(); } catch { /* noop */ }
          }
          pendingBitmapRef.current = bitmap;
          scheduleRepaint();
        })
        .catch(() => { /* drop frame */ });
      return;
    }
    // Fallback: paint via an object URL when ImageBitmap is unavailable.
    const url = URL.createObjectURL(frame);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      paintImageDirect(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  // Canvas lifecycle. The single WebSocket transport lives in `web/lib/api/canvas.ts`
  // (openCanvas); this component only paints frames and forwards input. The named close
  // codes are terminal (1000 = normal hand-back / run resumes, 4000 = takeover) and the
  // media channel never auto-reconnects.
  useEffect(() => {
    const canvas = openCanvas({
      wsUrl: session.wsUrl,
      token: session.token,
      viewport: session.viewport,
    });
    canvasSessionRef.current = canvas;

    const offFrame = canvas.onFrame((frame) => handleIncomingFrame(frame));
    const offStatus = canvas.onStatusChange((status) => {
      updateStatus(canvasStatusToConnection(status));
    });
    const offClose = canvas.onClose((_code, resumed) => {
      // 1000 (resumed hand-back): the run resumes and the overlay unmounts as the
      // store clears the streaming session. 4000 / errors: surface as offline.
      updateStatus(resumed ? 'idle' : 'failed');
    });

    return () => {
      offFrame();
      offStatus();
      offClose();
      canvasSessionRef.current = null;
      canvas.close(CANVAS_CLOSE_NORMAL);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const pending = pendingBitmapRef.current;
      if (pending) {
        try { pending.close(); } catch { /* noop */ }
        pendingBitmapRef.current = null;
      }
    };
    // session token / wsUrl identify the connection target; reopen if either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, session.wsUrl]);

  // ============================================================================
  // Input capture
  // ============================================================================

  const sendInput = (event: CanvasInputEvent) => {
    canvasSessionRef.current?.sendInput(event);
  };

  const canvasToViewport = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const viewport = viewportRef.current;
    const vx = (localX / rect.width) * viewport.width;
    const vy = (localY / rect.height) * viewport.height;
    return {
      x: Math.max(0, Math.min(viewport.width, Math.round(vx))),
      y: Math.max(0, Math.min(viewport.height, Math.round(vy))),
    };
  };

  const buildModifiers = (e: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }): string[] => {
    const modifiers: string[] = [];
    if (e.metaKey) modifiers.push('Meta');
    if (e.ctrlKey) modifiers.push('Control');
    if (e.altKey) modifiers.push('Alt');
    if (e.shiftKey) modifiers.push('Shift');
    return modifiers;
  };

  const handleMouseAction = (
    e: React.MouseEvent<HTMLCanvasElement>,
    action: 'down' | 'up' | 'move',
  ) => {
    e.preventDefault();
    if (action === 'down') {
      // preventDefault on mousedown suppresses native focus shift, so the
      // canvas would never receive keyboard events without this.
      canvasRef.current?.focus();
    }
    const pos = canvasToViewport(e.clientX, e.clientY);
    if (!pos) return;
    if (action === 'down') {
      sendInput({ type: 'mousedown', x: pos.x, y: pos.y, button: e.button });
    } else if (action === 'up') {
      sendInput({ type: 'mouseup', x: pos.x, y: pos.y, button: e.button });
    } else {
      sendInput({ type: 'mousemove', x: pos.x, y: pos.y });
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos = canvasToViewport(e.clientX, e.clientY);
    if (!pos) return;
    sendInput({ type: 'wheel', x: pos.x, y: pos.y, deltaX: e.deltaX, deltaY: e.deltaY });
  };

  const handleKey = (e: React.KeyboardEvent<HTMLCanvasElement>, action: 'down' | 'up') => {
    e.preventDefault();
    const modifiers = buildModifiers(e);
    if (action === 'down') {
      sendInput({ type: 'keydown', key: e.key, code: e.code, modifiers });
    } else {
      sendInput({ type: 'keyup', key: e.key, code: e.code, modifiers });
    }
  };

  const handleTouch = (
    e: React.TouchEvent<HTMLCanvasElement>,
    action: 'down' | 'up' | 'move',
  ) => {
    e.preventDefault();
    if (action === 'down') {
      canvasRef.current?.focus();
    }
    const t = action === 'up' ? e.changedTouches[0] : e.touches[0];
    if (!t) return;
    const pos = canvasToViewport(t.clientX, t.clientY);
    if (!pos) return;
    if (action === 'down') {
      sendInput({ type: 'mousedown', x: pos.x, y: pos.y, button: 0 });
    } else if (action === 'up') {
      sendInput({ type: 'mouseup', x: pos.x, y: pos.y, button: 0 });
    } else {
      sendInput({ type: 'mousemove', x: pos.x, y: pos.y });
    }
  };

  // Block native context menu so right-click can be forwarded.
  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
  };

  // ============================================================================
  // Render
  // ============================================================================

  const aspectRatio = `${session.viewport.width} / ${session.viewport.height}`;
  const maxHeightClass = isMobile ? 'max-h-[50vh]' : 'max-h-[70vh]';

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      width={session.viewport.width}
      height={session.viewport.height}
      style={{ aspectRatio, touchAction: 'none' }}
      className={`block w-full ${maxHeightClass} object-contain rounded-lg border border-neutral-300 bg-neutral-900 outline-none focus:ring-2 focus:ring-cyan-500`}
      onMouseDown={(e) => handleMouseAction(e, 'down')}
      onMouseUp={(e) => handleMouseAction(e, 'up')}
      onMouseMove={(e) => handleMouseAction(e, 'move')}
      onWheel={handleWheel}
      onKeyDown={(e) => handleKey(e, 'down')}
      onKeyUp={(e) => handleKey(e, 'up')}
      onTouchStart={(e) => handleTouch(e, 'down')}
      onTouchEnd={(e) => handleTouch(e, 'up')}
      onTouchMove={(e) => handleTouch(e, 'move')}
      onContextMenu={handleContextMenu}
    />
  );
}
