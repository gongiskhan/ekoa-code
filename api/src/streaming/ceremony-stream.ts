/**
 * streaming/ceremony-stream.ts — the live view of an ATTENDED CEREMONY window (D-CEREMONY-STREAM).
 *
 * The ceremony's browser runs on the BRIDGE (residential, real Chrome — `clients/bridge`). When the
 * human is not sitting at that machine, this relays the window to their dashboard on whatever device
 * they ARE on: JPEG frames arrive from the daemon as `ceremony.frame` and go DOWN this socket; the
 * human's mouse/keyboard come UP this socket and go back to the daemon as `ceremony.input`. So a
 * person logs into the bridge's window from their own laptop, with none of the focus war a headed
 * window on a remote machine would cause.
 *
 * IT REUSES the canvas media channel wholesale — the same short-TTL, single-use, audience-scoped
 * token (`auth.ts`), the same wire messages (`protocol.ts`, which the dashboard `openCanvas` client
 * speaks), the same 1000/4000 close contract — but is a SEPARATE session type and registry because
 * its frames are PUSHED IN from the bridge (not read off a local Playwright page) and its input is
 * PUSHED OUT to the bridge (not dispatched to a local CDP session). Keyed by the ceremony `requestId`.
 *
 * CREDENTIAL PRIVACY (the reason for every "never logged" below). During a ceremony the human types
 * their real password into the streamed window, so a `key` input message carries a password
 * character and a frame is a picture of the login page. Both cross Cortex in RAM only and are NEVER
 * written to a log, a trace or the ledger — the same obligation `secret.deliver` carries. This module
 * logs auth failures and lifecycle events by requestId ONLY, never a frame or an input payload.
 */
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { signStreamToken, tokenTtlSeconds, verifyStreamToken, consumeStreamToken } from './auth.js';
import { ClientMessageSchema, type MouseMessage, type KeyMessage } from './protocol.js';

/** The ceremony media-channel path, distinct from the run canvas (`/api/v1/automation-stream/`). */
export const CEREMONY_WS_PATH_PREFIX = '/api/v1/ceremony-stream/';

/**
 * The registry-leak backstop: the longest a ceremony stream may sit registered before it self-closes.
 *
 * DERIVED FROM THE CEREMONY, NOT THE VIEWER TOKEN (D-CEREMONY-STREAM lifecycle, L4). This used to be
 * `tokenTtlSeconds() + 30`, so lowering `EKOA_STREAMING_TOKEN_TTL_SECONDS` (a viewer-auth knob) would
 * silently cut a LIVE stream out from under a human mid-login. The backstop only guards against a
 * leaked registry entry when a ceremony expires without ever pushing a session, so it is pinned to a
 * fixed lifetime comfortably past the daemon's ~9-minute ceremony window (and the rail's 10-minute
 * `CEREMONY_TTL_MS`) - the socket-drop and completion paths still close far earlier in the common case.
 */
export const CEREMONY_STREAM_MAX_MS = 11 * 60_000;

const ALLOWED_ORIGINS = (process.env.EKOA_STREAMING_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** The default ceremony viewport — the bridge opens its window at `DEFAULT_VIEWPORT` (1280x800,
 *  `clients/bridge/src/browser/chrome-launch.ts`); a `viewport` server message re-sizes the canvas
 *  if the daemon ever reports a different one. */
const CEREMONY_VIEWPORT = { width: 1280, height: 800 };

/** One mouse/key event, in the wire shape the daemon dispatches (`CeremonyInputEvent` in shared —
 *  structurally the media channel's own `mouse`/`key`). */
export type CeremonyInput = MouseMessage | KeyMessage;

export interface CeremonyStreamHooks {
  /** Relay one input event to the bridge as a `ceremony.input` frame. RAM only, never logged. */
  sendInput: (event: CeremonyInput) => void;
  /** A viewer connected (true) or dropped (false): the bridge starts/stops the screencast so a
   *  ceremony nobody is watching costs no frames. */
  onViewerChange: (connected: boolean) => void;
  /** requestId-only structured logger. NEVER called with a frame or an input payload. */
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export class CeremonyStreamSession {
  readonly requestId: string;
  readonly ownerUserId: string;
  /** The pairing that may deliver frames for this ceremony — the machine holding the window. A
   *  `ceremony.frame` arriving from any OTHER pairing is dropped (see `pushFrame`), so a compromised
   *  daemon cannot inject a spoofed frame onto this owner's dashboard even if it learns the requestId.
   *  This is the binding the input direction already had; the frame direction now matches it. */
  readonly pairingId: string;
  private socket: WebSocket | null = null;
  private readonly hooks: CeremonyStreamHooks;
  private readonly log: (event: string, fields: Record<string, unknown>) => void;
  private closed = false;
  private ttlTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: { requestId: string; ownerUserId: string; pairingId: string; hooks: CeremonyStreamHooks }) {
    this.requestId = opts.requestId;
    this.ownerUserId = opts.ownerUserId;
    this.pairingId = opts.pairingId;
    this.hooks = opts.hooks;
    this.log = opts.hooks.log ?? (() => {});
  }

  attachSocket(socket: WebSocket): void {
    if (this.socket) {
      // Socket-level takeover: a second viewer grabbed this ceremony. Close the displaced socket with
      // 4000 — the client must NOT reconnect (the canvas close-code contract, landmine 8).
      try {
        this.socket.close(4000, 'replaced');
      } catch {
        /* already gone */
      }
    }
    this.socket = socket;
    this.send({ type: 'viewport', width: CEREMONY_VIEWPORT.width, height: CEREMONY_VIEWPORT.height });

    socket.on('message', (raw) => this.handleClientMessage(raw));
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.hooks.onViewerChange(false);
      }
    });
    // Tell the bridge to START producing frames now that someone is watching.
    this.hooks.onViewerChange(true);
    this.log('ceremony.stream.viewer_attached', { requestId: this.requestId });
  }

  /** A frame arrived from the bridge (`ceremony.frame`). Forward it down the socket — dropping it if
   *  the socket is backpressured, so a slow viewer never makes Cortex buffer unboundedly. NEVER logs
   *  the frame data. */
  pushFrame(seq: number, jpegBase64: string): void {
    const s = this.socket;
    if (!s || s.readyState !== s.OPEN) return;
    // Relay-side backpressure: if the viewer is not draining, skip this frame rather than queue it.
    if (typeof s.bufferedAmount === 'number' && s.bufferedAmount > 1_000_000) return;
    this.send({ type: 'frame', seq, jpegBase64 });
  }

  private handleClientMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    } catch {
      return; // an unparseable input is dropped, never logged (it may hold a keystroke)
    }
    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) return;
    const msg = result.data;
    if (msg.type === 'mouse' || msg.type === 'key') {
      // Straight to the bridge. NEVER logged — a key is a password character.
      this.hooks.sendInput(msg);
    }
    // 'frame_ack' / 'ping': the bridge caps its own frame rate, so acks need no relay; ping is a
    // client keepalive with nothing to answer here.
  }

  private send(message: Record<string, unknown>): void {
    const s = this.socket;
    if (!s || s.readyState !== s.OPEN) return;
    try {
      s.send(JSON.stringify(message));
    } catch {
      /* socket went away between the check and the send */
    }
  }

  setTtlTimer(timer: ReturnType<typeof setTimeout>): void {
    this.ttlTimer = timer;
  }

  close(code = 1000, reason = 'closed'): void {
    if (this.closed) return;
    this.closed = true;
    if (this.ttlTimer) {
      clearTimeout(this.ttlTimer);
      this.ttlTimer = null;
    }
    const s = this.socket;
    this.socket = null;
    if (s) {
      try {
        s.close(code, reason);
      } catch {
        /* already gone */
      }
    }
    this.hooks.onViewerChange(false);
    this.log('ceremony.stream.closed', { requestId: this.requestId, reason });
  }
}

// --- registry (requestId → session) -----------------------------------------
const sessions = new Map<string, CeremonyStreamSession>();

export interface OpenCeremonyStreamInput {
  requestId: string;
  ownerUserId: string;
  /** The machine holding the ceremony window — the only pairing whose `ceremony.frame` frames are
   *  accepted for this stream. */
  pairingId: string;
  hooks: CeremonyStreamHooks;
}

export interface OpenCeremonyStreamResult {
  token: string;
  wsUrl: string;
  viewport: { width: number; height: number };
  ttlSeconds: number;
}

/** Register a ceremony as streamable and mint the viewer's short-TTL token. Called from
 *  `/sessions/establish` when the paired daemon advertises `attended.livestream`. */
export function openCeremonyStream(input: OpenCeremonyStreamInput): OpenCeremonyStreamResult {
  const prior = sessions.get(input.requestId);
  if (prior) prior.close(1000, 'replaced-session');
  const session = new CeremonyStreamSession({
    requestId: input.requestId,
    ownerUserId: input.ownerUserId,
    pairingId: input.pairingId,
    hooks: input.hooks,
  });
  sessions.set(input.requestId, session);
  // Backstop: if the ceremony expires without ever pushing a session (the human walked away), the
  // `onCeremonyEnded` close never fires, so self-close after a FIXED max lifetime rather than leak
  // the registry entry. Pinned to `CEREMONY_STREAM_MAX_MS` and NOT to the viewer-token TTL, so a low
  // `EKOA_STREAMING_TOKEN_TTL_SECONDS` cannot close an actively-used stream mid-login. The socket-drop
  // and completion paths close earlier in the common case.
  const ttlTimer = setTimeout(() => closeCeremonyStream(input.requestId, { reason: 'ttl' }), CEREMONY_STREAM_MAX_MS);
  ttlTimer.unref?.();
  session.setTtlTimer(ttlTimer);
  return {
    token: signStreamToken({ userId: input.ownerUserId, traceId: input.requestId }),
    wsUrl: `${CEREMONY_WS_PATH_PREFIX}${input.requestId}`,
    viewport: { ...CEREMONY_VIEWPORT },
    ttlSeconds: tokenTtlSeconds(),
  };
}

/**
 * A `ceremony.frame` arrived from the bridge — push it to the viewer (if any). `pairingId` is the
 * socket the frame DELIVERED ON, and it must match the pairing that opened this stream, or the frame
 * is dropped: a compromised daemon on another pairing that guessed the requestId must not be able to
 * paint this owner's dashboard. This mirrors the binding the input path already enforces.
 */
export function pushCeremonyFrame(requestId: string, pairingId: string, seq: number, jpegBase64: string): void {
  const session = sessions.get(requestId);
  if (!session || session.pairingId !== pairingId) return;
  session.pushFrame(seq, jpegBase64);
}

/**
 * Tear the stream down (ceremony ended/expired). Idempotent.
 *
 * PAIRING GATE (L4). A caller that names a delivering pairing - a `session.push` handler acting on a
 * frame from some machine - may only close a stream owned by THAT pairing. Without it, a daemon on any
 * pairing could refuse-push a victim's requestId and, via the catch-side teardown, close the victim's
 * live ceremony stream (a transient cross-tenant DoS, the mirror of the `pushCeremonyFrame` pairing
 * guard). Internal callers (the TTL backstop, a replaced session) pass no `requirePairingId` and close
 * unconditionally.
 */
export function closeCeremonyStream(
  requestId: string,
  opts: { reason?: string; requirePairingId?: string } = {},
): void {
  const session = sessions.get(requestId);
  if (!session) return;
  if (opts.requirePairingId !== undefined && session.pairingId !== opts.requirePairingId) return;
  sessions.delete(requestId);
  session.close(1000, opts.reason ?? 'ceremony-ended');
}

export function getCeremonyStreamSession(requestId: string): CeremonyStreamSession | undefined {
  return sessions.get(requestId);
}

export function __resetCeremonyStreamsForTest(): void {
  for (const s of sessions.values()) s.close(1000, 'test-cleanup');
  sessions.clear();
}

// --- WS server (upgrade + connection) ---------------------------------------

export interface AttachCeremonyStreamOptions {
  log?: (event: string, fields: Record<string, unknown>) => void;
}

/** Mount the ceremony media channel on the HTTP server (a sibling of `attachCanvasServer`). Owns the
 *  upgrade handshake: token verify → owner scope → single-use, then the bidirectional channel. */
export function attachCeremonyStreamServer(httpServer: HttpServer, opts: AttachCeremonyStreamOptions = {}): WebSocketServer {
  // maxPayload bounds every inbound message — mouse/key JSON is tiny, so 8 KiB is generous and closes
  // the memory-DoS vector where a giant message is buffered before parse.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 });
  const log = opts.log ?? defaultLog;

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith(CEREMONY_WS_PATH_PREFIX)) return; // not our path
    handleUpgrade(wss, req, socket as Socket, head, log);
  });

  wss.on('connection', (ws, req) => {
    const requestId = extractRequestId(req.url);
    if (!requestId) {
      ws.close(1008, 'invalid-request');
      return;
    }
    const session = sessions.get(requestId);
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
  log: (event: string, fields: Record<string, unknown>) => void,
): void {
  const requestId = extractRequestId(req.url);
  if (!requestId) {
    rejectSocket(socket, 400, 'bad-request');
    return;
  }
  if (ALLOWED_ORIGINS.length > 0) {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      log('ceremony.stream.auth_failure', { reason: 'origin-rejected', requestId });
      rejectSocket(socket, 403, 'origin-rejected');
      return;
    }
  }
  const verified = verifyStreamToken(parseToken(req.url), requestId);
  if (!verified.ok) {
    log('ceremony.stream.auth_failure', { reason: verified.reason, requestId });
    rejectSocket(socket, 401, 'unauthorized');
    return;
  }
  const session = sessions.get(requestId);
  if (!session) {
    rejectSocket(socket, 404, 'no-session');
    return;
  }
  // Owner scope: the token subject must own this ceremony. The registry is authoritative.
  if (session.ownerUserId !== verified.claims.sub) {
    log('ceremony.stream.auth_failure', { reason: 'ownership-mismatch', requestId });
    rejectSocket(socket, 403, 'ownership-mismatch');
    return;
  }
  // Single-use LAST, so a rejected upgrade never burns the token.
  if (!consumeStreamToken(verified.claims.jti, verified.claims.exp)) {
    log('ceremony.stream.auth_failure', { reason: 'token-replayed', requestId });
    rejectSocket(socket, 401, 'token-replayed');
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws: WebSocket) => wss.emit('connection', ws, req));
}

function extractRequestId(reqUrl: string | undefined): string | null {
  if (!reqUrl || !reqUrl.startsWith(CEREMONY_WS_PATH_PREFIX)) return null;
  const tail = reqUrl.slice(CEREMONY_WS_PATH_PREFIX.length);
  const qIdx = tail.indexOf('?');
  const id = qIdx >= 0 ? tail.slice(0, qIdx) : tail;
  if (!id || /[/\s]/.test(id)) return null;
  return id;
}

function parseToken(reqUrl: string | undefined): string | undefined {
  if (!reqUrl) return undefined;
  const qIdx = reqUrl.indexOf('?');
  if (qIdx < 0) return undefined;
  return new URLSearchParams(reqUrl.slice(qIdx + 1)).get('token') ?? undefined;
}

function rejectSocket(socket: Socket, status: number, reason: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  } catch {
    /* already closed */
  }
  try {
    socket.destroy();
  } catch {
    /* already destroyed */
  }
}

function defaultLog(event: string, fields: Record<string, unknown>): void {
  console.log(`[${event}]`, JSON.stringify(fields));
}

export { extractRequestId as _extractRequestIdForTest, parseToken as _parseTokenForTest };
