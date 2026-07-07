"use client";

import { useEffect, useRef } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useAutomationsStore } from '@/stores/automations';
import type { StreamingConnectionStatus, StreamingSession } from '@/types/automation';

interface Props {
  session: StreamingSession;
  onStatusChange?: (status: StreamingConnectionStatus) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 750;
const PING_INTERVAL_MS = 25_000;

const MOUSE_BUTTON: Record<number, 'left' | 'middle' | 'right'> = {
  0: 'left',
  1: 'middle',
  2: 'right',
};

interface ServerFrame {
  type: 'frame';
  seq: number;
  jpegBase64: string;
}

interface ServerViewport {
  type: 'viewport';
  width: number;
  height: number;
}

interface ServerError {
  type: 'error';
  code: string;
  message: string;
}

interface ServerPong {
  type: 'pong';
  t: number;
}

type ServerMessage = ServerFrame | ServerViewport | ServerError | ServerPong;

export default function PauseForUserCanvas({ session, onStatusChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingFrameRef = useRef<{ seq: number; bitmap: ImageBitmap } | null>(null);
  const rafRef = useRef<number | null>(null);
  const viewportRef = useRef<{ width: number; height: number }>(session.viewport);
  const closedByCallerRef = useRef(false);
  const isMobile = useIsMobile();
  const setStreamingStatus = useAutomationsStore((s) => s.setStreamingStatus);

  useEffect(() => {
    viewportRef.current = session.viewport;
  }, [session.viewport]);

  const updateStatus = (status: StreamingConnectionStatus) => {
    setStreamingStatus(status);
    onStatusChange?.(status);
  };

  // WebSocket lifecycle.
  useEffect(() => {
    closedByCallerRef.current = false;
    reconnectAttemptsRef.current = 0;

    const url = appendToken(session.wsUrl, session.token);

    const open = () => {
      updateStatus('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        console.error('[streaming] failed to open WebSocket', err);
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        updateStatus('connected');
        if (pingTimerRef.current) clearInterval(pingTimerRef.current);
        pingTimerRef.current = setInterval(() => {
          const sock = wsRef.current;
          if (sock && sock.readyState === WebSocket.OPEN) {
            try { sock.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch { /* noop */ }
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(e.data) as ServerMessage;
        } catch {
          return;
        }
        if (msg.type === 'frame') {
          handleIncomingFrame(msg);
        } else if (msg.type === 'viewport') {
          viewportRef.current = { width: msg.width, height: msg.height };
        } else if (msg.type === 'error') {
          console.warn('[streaming] server error', msg.code, msg.message);
        }
      };

      ws.onerror = (e) => {
        console.warn('[streaming] WebSocket error', e);
      };

      ws.onclose = (e) => {
        // Stale close: a newer WS instance has already replaced this one
        // (StrictMode double-mount + cortex takeover policy). Don't reconnect —
        // the active socket is still alive and reconnecting would evict it.
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        if (closedByCallerRef.current) return;
        // 1000 = normal close (we initiated), 4000 = cortex takeover (newer
        // connection won). Either way, don't loop.
        if (e.code === 1000 || e.code === 4000) return;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closedByCallerRef.current) return;
      reconnectAttemptsRef.current += 1;
      if (reconnectAttemptsRef.current > MAX_RECONNECT_ATTEMPTS) {
        updateStatus('failed');
        return;
      }
      updateStatus('disconnected');
      const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttemptsRef.current - 1);
      reconnectTimerRef.current = setTimeout(open, delay);
    };

    open();

    return () => {
      closedByCallerRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try { ws.close(1000, 'unmount'); } catch { /* noop */ }
      }
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const pending = pendingFrameRef.current;
      if (pending) {
        try { pending.bitmap.close(); } catch { /* noop */ }
        pendingFrameRef.current = null;
      }
    };
    // session token / wsUrl identify the connection target; reconnect if either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.token, session.wsUrl]);

  // Frame paint pump driven by rAF — drops late frames so we never block.
  const handleIncomingFrame = (frame: ServerFrame) => {
    const dataUrl = `data:image/jpeg;base64,${frame.jpegBase64}`;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const decode = 'createImageBitmap' in window
        ? createImageBitmap(img)
        : Promise.resolve(null);
      decode.then((bitmap) => {
        const previous = pendingFrameRef.current;
        if (previous) {
          try { previous.bitmap.close(); } catch { /* noop */ }
        }
        if (bitmap) {
          pendingFrameRef.current = { seq: frame.seq, bitmap };
        } else {
          // Fallback: paint directly without ImageBitmap.
          paintImageDirect(img);
          ackFrame(frame.seq);
          return;
        }
        ackFrame(frame.seq);
        scheduleRepaint();
      }).catch(() => {
        paintImageDirect(img);
        ackFrame(frame.seq);
      });
    };
    img.onerror = () => { /* drop frame */ };
    img.src = dataUrl;
  };

  const ackFrame = (seq: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'frame_ack', seq })); } catch { /* noop */ }
    }
  };

  const scheduleRepaint = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      const pending = pendingFrameRef.current;
      if (!canvas || !pending) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      if (canvas.width !== pending.bitmap.width || canvas.height !== pending.bitmap.height) {
        canvas.width = pending.bitmap.width;
        canvas.height = pending.bitmap.height;
      }
      ctx.drawImage(pending.bitmap, 0, 0);
      try { pending.bitmap.close(); } catch { /* noop */ }
      pendingFrameRef.current = null;
    });
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

  // ============================================================================
  // Input capture
  // ============================================================================

  const sendInput = (msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(msg)); } catch { /* noop */ }
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

  const buildModifiers = (e: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }) => ({
    metaKey: !!e.metaKey,
    ctrlKey: !!e.ctrlKey,
    altKey: !!e.altKey,
    shiftKey: !!e.shiftKey,
  });

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
    sendInput({
      type: 'mouse',
      x: pos.x,
      y: pos.y,
      button: MOUSE_BUTTON[e.button] ?? 'left',
      action,
      modifiers: buildModifiers(e),
    });
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const pos = canvasToViewport(e.clientX, e.clientY);
    if (!pos) return;
    sendInput({
      type: 'mouse',
      x: pos.x,
      y: pos.y,
      button: 'left',
      action: 'wheel',
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      modifiers: buildModifiers(e),
    });
  };

  const handleKey = (e: React.KeyboardEvent<HTMLCanvasElement>, action: 'down' | 'up') => {
    e.preventDefault();
    sendInput({
      type: 'key',
      code: e.code,
      key: e.key,
      action,
      modifiers: buildModifiers(e),
    });
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
    sendInput({
      type: 'mouse',
      x: pos.x,
      y: pos.y,
      button: 'left',
      action,
      modifiers: { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false },
    });
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

function appendToken(wsUrl: string, token: string): string {
  if (!token) return wsUrl;
  const sep = wsUrl.includes('?') ? '&' : '?';
  return `${wsUrl}${sep}token=${encodeURIComponent(token)}`;
}
