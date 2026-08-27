"use client";

import { useEffect, useRef, useState } from 'react';
import {
  openCanvas,
  CANVAS_CLOSE_NORMAL,
  type CanvasSession,
  type CanvasInputEvent,
  type CanvasStatus,
} from '@/lib/api';

/**
 * The reusable live browser canvas: it opens ONE media-channel socket (`openCanvas`, the FIXED-2
 * carve-out), paints the JPEG frames onto a `<canvas>`, and forwards the human's mouse/keyboard back
 * up. Two callers wear it: the automation-run pause (`pause-for-user-canvas.tsx`) and the attended
 * ceremony login (`cofre/ceremony-login-canvas.tsx`). It owns NO store — status is reported through
 * callbacks so each caller wires it into its own state, and the media logic lives in exactly one
 * place.
 */
export interface LiveCanvasSession {
  wsUrl: string;
  token: string;
  viewport: { width: number; height: number };
}

export interface LiveCanvasViewProps {
  session: LiveCanvasSession;
  /** Connection lifecycle, mapped from the media channel's own status. */
  onStatusChange?: (status: CanvasStatus) => void;
  /** `resumed` is true for the normal (1000) hand-back close, false for takeover (4000)/errors. */
  onClose?: (code: number, resumed: boolean) => void;
  className?: string;
  maxHeightClass?: string;
}

export default function LiveCanvasView({ session, onStatusChange, onClose, className, maxHeightClass }: LiveCanvasViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasSessionRef = useRef<CanvasSession | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<string | null>(null);
  const viewportRef = useRef<{ width: number; height: number }>(session.viewport);
  /**
   * The natural pixel size of the frames actually arriving. Two things read it: clicks map INTO this
   * space (the producer has clamped the screencast to the page's CSS viewport, which is the space
   * `Input.dispatch*` is in), and the display box is sized to its aspect ratio. Sizing the box to the
   * REAL frame aspect is what removes the object-contain letterbox - a box locked to a guessed
   * aspect ratio (the old `session.viewport`) mismatches the frame, letterboxes it, and then maps
   * clicks over the black bars so they land off-target (the ceremony coordinate bug, 2026-08-27).
   */
  const frameSizeRef = useRef<{ width: number; height: number }>(session.viewport);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number }>(session.viewport);

  useEffect(() => {
    viewportRef.current = session.viewport;
  }, [session.viewport]);

  const paintImageDirect = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }
    // Adopt the frame's true dimensions as the coordinate + aspect space. `frameSizeRef` is what the
    // click mapper reads (synchronously); the state drives the box aspect ratio re-render.
    if (frameSizeRef.current.width !== img.naturalWidth || frameSizeRef.current.height !== img.naturalHeight) {
      const next = { width: img.naturalWidth, height: img.naturalHeight };
      frameSizeRef.current = next;
      setFrameSize(next);
    }
    ctx.drawImage(img, 0, 0);
  };

  // Frame paint pump driven by rAF - only the LATEST pending frame is painted, so a slow decode or a
  // busy tab drops intermediate frames rather than queueing behind them.
  const scheduleRepaint = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const dataUrl = pendingFrameRef.current;
      pendingFrameRef.current = null;
      if (!dataUrl) return;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => paintImageDirect(img);
      img.onerror = () => { /* drop a frame that failed to decode */ };
      img.src = dataUrl;
    });
  };

  // A frame is a ready-to-paint `data:image/jpeg;base64,...` URL (the media channel is text JSON —
  // see web/lib/api/canvas.ts). Stash the latest and let the rAF pump paint it.
  const handleIncomingFrame = (frameDataUrl: string) => {
    pendingFrameRef.current = frameDataUrl;
    scheduleRepaint();
  };

  useEffect(() => {
    const canvas = openCanvas({ wsUrl: session.wsUrl, token: session.token, viewport: session.viewport });
    canvasSessionRef.current = canvas;

    const offFrame = canvas.onFrame((frame) => handleIncomingFrame(frame));
    const offStatus = canvas.onStatusChange((status) => onStatusChange?.(status));
    const offViewport = canvas.onViewport((vp) => {
      viewportRef.current = vp;
    });
    const offClose = canvas.onClose((code, resumed) => onClose?.(code, resumed));

    return () => {
      offFrame();
      offStatus();
      offViewport();
      offClose();
      canvasSessionRef.current = null;
      canvas.close(CANVAS_CLOSE_NORMAL);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingFrameRef.current = null;
    };
    // session token / wsUrl identify the connection target; reopen if either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, session.wsUrl]);

  // ---- input capture --------------------------------------------------------
  const sendInput = (event: CanvasInputEvent) => {
    canvasSessionRef.current?.sendInput(event);
  };

  const canvasToViewport = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    // Map into the FRAME's pixel space, not a guessed viewport: with the box sized to the frame's
    // aspect there is no letterbox, so the rect maps 1:1 onto the rendered image, and the frame space
    // equals the page CSS-pixel space the producer dispatches input in.
    const viewport = frameSizeRef.current;
    const vx = ((clientX - rect.left) / rect.width) * viewport.width;
    const vy = ((clientY - rect.top) / rect.height) * viewport.height;
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

  const handleMouseAction = (e: React.MouseEvent<HTMLCanvasElement>, action: 'down' | 'up' | 'move') => {
    e.preventDefault();
    if (action === 'down') canvasRef.current?.focus(); // preventDefault suppresses native focus shift
    const pos = canvasToViewport(e.clientX, e.clientY);
    if (!pos) return;
    if (action === 'down') sendInput({ type: 'mousedown', x: pos.x, y: pos.y, button: e.button });
    else if (action === 'up') sendInput({ type: 'mouseup', x: pos.x, y: pos.y, button: e.button });
    else sendInput({ type: 'mousemove', x: pos.x, y: pos.y });
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
    if (action === 'down') sendInput({ type: 'keydown', key: e.key, code: e.code, modifiers });
    else sendInput({ type: 'keyup', key: e.key, code: e.code, modifiers });
  };

  const handleTouch = (e: React.TouchEvent<HTMLCanvasElement>, action: 'down' | 'up' | 'move') => {
    e.preventDefault();
    if (action === 'down') canvasRef.current?.focus();
    const t = action === 'up' ? e.changedTouches[0] : e.touches[0];
    if (!t) return;
    const pos = canvasToViewport(t.clientX, t.clientY);
    if (!pos) return;
    if (action === 'down') sendInput({ type: 'mousedown', x: pos.x, y: pos.y, button: 0 });
    else if (action === 'up') sendInput({ type: 'mouseup', x: pos.x, y: pos.y, button: 0 });
    else sendInput({ type: 'mousemove', x: pos.x, y: pos.y });
  };

  const aspectRatio = `${frameSize.width} / ${frameSize.height}`;

  return (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      width={session.viewport.width}
      height={session.viewport.height}
      style={{ aspectRatio, touchAction: 'none' }}
      className={
        className ??
        `block w-full ${maxHeightClass ?? 'max-h-[70vh]'} object-contain rounded-lg border border-neutral-300 bg-neutral-900 outline-none focus:ring-2 focus:ring-cyan-500`
      }
      onMouseDown={(e) => handleMouseAction(e, 'down')}
      onMouseUp={(e) => handleMouseAction(e, 'up')}
      onMouseMove={(e) => handleMouseAction(e, 'move')}
      onWheel={handleWheel}
      onKeyDown={(e) => handleKey(e, 'down')}
      onKeyUp={(e) => handleKey(e, 'up')}
      onTouchStart={(e) => handleTouch(e, 'down')}
      onTouchEnd={(e) => handleTouch(e, 'up')}
      onTouchMove={(e) => handleTouch(e, 'move')}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}
