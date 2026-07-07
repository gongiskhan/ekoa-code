/**
 * streaming/ — the live browser canvas media relay (ch03 §3.7 carve-out; RESOLVED Q-01;
 * B17 port). The ONE scoped exception to FIXED-2's no-WebSockets rule: JPEG frames down,
 * mouse/keyboard input up, authenticated by a short-TTL token — never a JSON API payload.
 *
 * Public surface (module-map §2.6 — streaming/ imports config.ts + node builtins + ws +
 * playwright types only):
 *  - openSession()  — the automation engine calls this when a run pauses for the user; it
 *    registers the Playwright page as a streamable session, mints the token, and returns
 *    { token, wsUrl, viewport, ttlSeconds }. The first three are the `streaming_available`
 *    SSE event body (ch03 §3.6.3).
 *  - closeSession() — the engine calls this on resume/end to tear the session down (1000).
 *  - attachCanvasServer() — the composition root (server.ts) mounts this on the HTTP server;
 *    it owns the `upgrade` handshake: token verify + ownership + session liveness, then the
 *    bidirectional media channel.
 */
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Page } from 'playwright';
import { WebSocketServer, type WebSocket } from 'ws';
import { signStreamToken, tokenTtlSeconds, verifyStreamToken, consumeStreamToken } from './auth.js';
import { StreamSession, type RunStateProbe } from './session.js';
import {
  getSession,
  registerSession,
  unregisterSession,
} from './registry.js';

/** Canonical canvas WS path (the socket is `${CANVAS_WS_PATH_PREFIX}${traceId}?token=...`).
 *  Single source of truth: openSession builds `wsUrl` from it and attachCanvasServer listens
 *  on it, so the two never desync. This is the media-channel path, distinct from the four SSE
 *  streams and the REST surface (ch03 §3.7). */
export const CANVAS_WS_PATH_PREFIX = '/api/v1/automation-stream/';

const ALLOWED_ORIGINS = (process.env.EKOA_STREAMING_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export interface OpenSessionInput {
  traceId: string;
  page: Page;
  ownerUserId: string;
  /** Returns 'paused_for_user' if the run is currently paused. Input is dispatched ONLY while
   *  this reports paused_for_user (the state gate). */
  isPaused: RunStateProbe;
  /** Optional structured logger; defaults to a console-based redacted logger. */
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface OpenSessionResult {
  /** Short-TTL canvas token — rides the `streaming_available` event, authenticates the socket. */
  token: string;
  /** WS path the client dials: `${CANVAS_WS_PATH_PREFIX}${traceId}` (resolve against origin). */
  wsUrl: string;
  viewport: { width: number; height: number };
  ttlSeconds: number;
}

export async function openSession(input: OpenSessionInput): Promise<OpenSessionResult> {
  const session = new StreamSession({
    traceId: input.traceId,
    page: input.page,
    ownerUserId: input.ownerUserId,
    isPaused: input.isPaused,
    onLog: input.log ?? defaultLog,
  });
  await session.open();
  registerSession(input.traceId, session);
  const token = signStreamToken({ userId: input.ownerUserId, traceId: input.traceId });
  return {
    token,
    wsUrl: `${CANVAS_WS_PATH_PREFIX}${input.traceId}`,
    viewport: session._viewport(),
    ttlSeconds: tokenTtlSeconds(),
  };
}

export async function closeSession(traceId: string, reason: string = 'closed'): Promise<void> {
  const session = getSession(traceId);
  if (!session) return;
  unregisterSession(traceId, session);
  await session.close(reason);
}

export interface AttachCanvasOptions {
  /**
   * OPTIONAL defense-in-depth ownership gate. Returns the active run owner for a traceId, or
   * null if none. When provided (wired from the automation engine's active-run registry in
   * server.ts), the socket is additionally rejected unless the run is live and its owner
   * matches the token subject. The self-contained ownership check (token subject === the
   * StreamSession's stored ownerUserId) always runs regardless.
   */
  resolveActiveRun?: (traceId: string) => { ownerUserId: string } | null;
  /** Optional structured logger. */
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export function attachCanvasServer(httpServer: HttpServer, opts: AttachCanvasOptions = {}): WebSocketServer {
  // maxPayload bounds every inbound frame: mouse/key JSON is tiny, so an 8 KiB cap is generous
  // and closes the memory-DoS vector where a giant frame is buffered before parse (Codex G8).
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  const log = opts.log ?? defaultLog;

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith(CANVAS_WS_PATH_PREFIX)) {
      // Not our path; another handler may take it (express or otherwise).
      // We must NOT destroy the socket here.
      return;
    }
    handleUpgrade(wss, req, socket as Socket, head, opts.resolveActiveRun, log);
  });

  wss.on('connection', (ws, req) => {
    const traceId = extractTraceId(req.url);
    if (!traceId) {
      ws.close(1008, 'invalid-trace');
      return;
    }
    const session = getSession(traceId);
    if (!session) {
      ws.close(1011, 'session-gone');
      return;
    }
    session.attachSocket(ws);
  });

  return wss;
}

function handleUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
  resolveActiveRun: AttachCanvasOptions['resolveActiveRun'],
  log: (event: string, fields: Record<string, unknown>) => void,
): void {
  const traceId = extractTraceId(req.url);
  if (!traceId) {
    rejectSocket(socket, 400, 'bad-request');
    return;
  }

  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      log('streaming.auth_failure', { reason: 'origin-rejected', traceId });
      rejectSocket(socket, 403, 'origin-rejected');
      return;
    }
  }

  const token = parseToken(req.url);
  const verified = verifyStreamToken(token, traceId);
  if (!verified.ok) {
    log('streaming.auth_failure', { reason: verified.reason, traceId });
    rejectSocket(socket, 401, 'unauthorized');
    return;
  }

  const session = getSession(traceId);
  if (!session) {
    rejectSocket(socket, 404, 'no-session');
    return;
  }

  // Self-contained ownership check: the token subject must match the session's stored owner.
  // The streaming session registry is authoritative for liveness+ownership, so this holds
  // without importing the automation engine (module-map §2.6).
  if (session.ownerUserId !== verified.claims.sub) {
    log('streaming.auth_failure', { reason: 'ownership-mismatch', traceId });
    rejectSocket(socket, 403, 'ownership-mismatch');
    return;
  }

  // Optional additional gate: the run must be live and owned by the token subject.
  if (resolveActiveRun) {
    const active = resolveActiveRun(traceId);
    if (!active || active.ownerUserId !== verified.claims.sub) {
      log('streaming.auth_failure', { reason: 'ownership-mismatch', traceId });
      rejectSocket(socket, 403, 'ownership-mismatch');
      return;
    }
  }

  // Single-use: consume the token so a client closed with 4000 (takeover) cannot reconnect with
  // the same credential, and a leaked short-TTL token cannot be replayed (landmine 8). LAST check
  // — only once every other gate passed, so a rejected upgrade never burns a token. A legitimate
  // new viewer takes over with a fresh streaming_available token.
  if (!consumeStreamToken(verified.claims.jti, verified.claims.exp)) {
    log('streaming.auth_failure', { reason: 'token-replayed', traceId });
    rejectSocket(socket, 401, 'token-replayed');
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
    wss.emit('connection', ws, req);
  });
}

function extractTraceId(reqUrl: string | undefined): string | null {
  if (!reqUrl) return null;
  if (!reqUrl.startsWith(CANVAS_WS_PATH_PREFIX)) return null;
  const tail = reqUrl.slice(CANVAS_WS_PATH_PREFIX.length);
  const qIdx = tail.indexOf('?');
  const id = qIdx >= 0 ? tail.slice(0, qIdx) : tail;
  if (!id || /[/\s]/.test(id)) return null;
  return id;
}

function parseToken(reqUrl: string | undefined): string | undefined {
  if (!reqUrl) return undefined;
  const qIdx = reqUrl.indexOf('?');
  if (qIdx < 0) return undefined;
  const params = new URLSearchParams(reqUrl.slice(qIdx + 1));
  const token = params.get('token');
  return token ?? undefined;
}

function rejectSocket(socket: Socket, status: number, reason: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  } catch {
    // socket may already be closed
  }
  try { socket.destroy(); } catch { /* already destroyed */ }
}

function defaultLog(event: string, fields: Record<string, unknown>): void {
  console.log(`[${event}]`, JSON.stringify(fields));
}

export {
  extractTraceId as _extractTraceIdForTest,
  parseToken as _parseTokenForTest,
};
