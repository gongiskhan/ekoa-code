/**
 * BridgeSocket — the daemon's single outbound WebSocket to Cortex, speaking the frozen
 * BridgeFrame wire (src/wire). The daemon DIALS OUT (NAT-friendly; Cortex is the WS server,
 * ch18 §18.3.1); auth is a short-lived bridge token resolved via `getToken()` immediately before
 * EACH (re)connect (TTL ~600s, checked at upgrade — mint fresh every time).
 *
 * Provenance: transport skeleton (backoff/jitter/stability-gate/half-open watchdog/single-flight
 * reconnect) is a copy-with-review port of the archived `ekoa-local/src/control/client.ts`
 * (ControlChannelClient, Pi-free) per docs/decisions.md "Salvage from archived ekoa-local".
 * All message handling is REWRITTEN to BridgeFrame — the old capability-RPC protocol predates
 * the delegation wire and shares nothing with it.
 *
 * Terminal revocation (ch18 §18.3.5, S4): a refused upgrade with reason `pairing-revoked`, or a
 * server close with reason `revoked`, is TERMINAL — the pairingId is tombstoned server-side
 * forever, so redialing is useless and misleading. The socket enters state 'revoked' and never
 * reconnects; re-pairing needs a fresh pairingId.
 */
import WebSocket from 'ws';
import { BridgeFrame } from '../wire/index.js';

export type BridgeSocketState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'revoked' | 'closed';

export interface BridgeSocketBackoff {
  initialMs: number;
  maxMs: number;
  stabilityMs: number;
  pongTimeoutMs: number;
  heartbeatMs: number;
}

const DEFAULT_BACKOFF: BridgeSocketBackoff = {
  initialMs: 1_000,
  maxMs: 30_000,
  stabilityMs: 10_000,
  pongTimeoutMs: 10_000,
  heartbeatMs: 30_000,
};

/** Bounded outbound queue while not OPEN: drop-oldest, so a long outage cannot grow memory and
 *  the freshest frames (latest ledger rows / results) win. Documented choice; cap 100. */
const SEND_QUEUE_CAP = 100;

export interface BridgeSocketOptions {
  /** http(s) or ws(s) base of Cortex; normalised to ws(s). */
  wsBase: string;
  pairingId: string;
  /** Resolves a currently-valid bridge token before each dial (mint fresh; TTL ~600s). */
  getToken: () => Promise<string>;
  onFrame: (frame: BridgeFrame) => void;
  onStateChange?: (state: BridgeSocketState) => void;
  backoff?: Partial<BridgeSocketBackoff>;
}

export class BridgeSocket {
  private ws: WebSocket | null = null;
  private state: BridgeSocketState = 'idle';
  private reconnectMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogLast = 0;
  private readonly cfg: BridgeSocketBackoff;
  private readonly queue: BridgeFrame[] = [];

  constructor(private readonly opts: BridgeSocketOptions) {
    this.cfg = { ...DEFAULT_BACKOFF, ...opts.backoff };
    this.reconnectMs = this.cfg.initialMs;
  }

  currentState(): BridgeSocketState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === 'revoked' || this.state === 'closed') return;
    this.setState(this.state === 'idle' ? 'connecting' : 'reconnecting');

    let token: string;
    try {
      token = await this.opts.getToken();
    } catch {
      this.scheduleReconnect();
      return;
    }

    const ws = new WebSocket(this.buildUrl(), { headers: { authorization: `Bearer ${token}` } });
    this.ws = ws;

    ws.on('unexpected-response', (_req, res) => {
      // The server refuses the Upgrade with a CONV-2 JSON error body (bridge/server.ts refuse()).
      let body = '';
      res.on('data', (c: Buffer) => { body += c.toString(); });
      res.on('end', () => {
        if (isRevokedRefusal(body)) {
          this.terminalRevoke();
        } else {
          this.scheduleReconnect();
        }
      });
    });

    ws.on('open', () => {
      this.setState('open');
      this.startHeartbeat();
      // Backoff resets only after the connection proves STABLE (accept-then-drop servers would
      // otherwise hot-loop at initialMs) — salvage review M34.
      if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
      this.stabilityTimer = setTimeout(() => { this.reconnectMs = this.cfg.initialMs; }, this.cfg.stabilityMs);
      this.stabilityTimer.unref?.();
      this.flushQueue();
    });

    ws.on('message', (data: WebSocket.RawData) => {
      this.watchdogLast = Date.now();
      this.onRaw(typeof data === 'string' ? data : data.toString());
    });

    ws.on('ping', () => { this.watchdogLast = Date.now(); }); // ws auto-pongs protocol pings

    ws.on('pong', () => {
      this.watchdogLast = Date.now();
      if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
    });

    ws.on('close', (_code, reasonBuf) => {
      const reason = reasonBuf?.toString() ?? '';
      this.stopHeartbeat();
      if (this.stabilityTimer) { clearTimeout(this.stabilityTimer); this.stabilityTimer = null; }
      if (this.ws === ws) this.ws = null;
      if (reason === 'revoked') {
        this.terminalRevoke();
        return;
      }
      // 'replaced' (another socket took the pairing) reconnects with normal backoff: the server
      // retires stale sockets on redial, so a live daemon that was replaced re-registers cleanly.
      this.scheduleReconnect();
    });

    ws.on('error', () => { /* the close event that follows runs the recovery */ });
  }

  /** Send a frame when OPEN; otherwise queue it (bounded, drop-oldest). Returns true when sent now. */
  send(frame: BridgeFrame): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(frame));
        return true;
      } catch {
        return false;
      }
    }
    if (this.state === 'revoked' || this.state === 'closed') return false;
    this.queue.push(frame);
    if (this.queue.length > SEND_QUEUE_CAP) this.queue.shift();
    return false;
  }

  close(): void {
    this.setState('closed');
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.stabilityTimer) { clearTimeout(this.stabilityTimer); this.stabilityTimer = null; }
    try { this.ws?.close(1000, 'daemon-closing'); } catch { /* already gone */ }
    this.ws = null;
  }

  private terminalRevoke(): void {
    this.setState('revoked');
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.stabilityTimer) { clearTimeout(this.stabilityTimer); this.stabilityTimer = null; }
    try { this.ws?.close(); } catch { /* already gone */ }
    this.ws = null;
    this.queue.length = 0;
  }

  private onRaw(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // drop unparseable frames (§18.3.1 discipline, both directions)
    }
    const res = BridgeFrame.safeParse(parsed);
    if (!res.success) return; // drop invalid frames silently
    const frame = res.data;
    if (frame.type === 'ping') {
      this.send({ type: 'pong' });
      return;
    }
    this.opts.onFrame(frame);
  }

  private flushQueue(): void {
    while (this.queue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const frame = this.queue.shift()!;
      try {
        this.ws.send(JSON.stringify(frame));
      } catch {
        this.queue.unshift(frame);
        return;
      }
    }
  }

  private buildUrl(): string {
    const base = this.opts.wsBase.replace(/^http/, 'ws').replace(/\/+$/, '');
    // Token travels ONLY in the Authorization header, never the URL (proxy logs — salvage M04).
    return `${base}/api/v1/bridge/connect/${encodeURIComponent(this.opts.pairingId)}`;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.watchdogLast = Date.now();
    this.heartbeat = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // Half-open watchdog: if nothing (frames, pings, pongs) arrived for 3 heartbeat periods,
      // terminate so 'close' fires and the backoff reconnect takes over.
      if (Date.now() - this.watchdogLast > this.cfg.heartbeatMs * 3) {
        try { ws.terminate(); } catch { /* already gone */ }
        return;
      }
      if (this.pongTimer) return; // a ping is already outstanding
      try { ws.ping(); } catch { return; }
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null;
        try { ws.terminate(); } catch { /* already gone */ }
      }, this.cfg.pongTimeoutMs);
      this.pongTimer.unref?.();
    }, this.cfg.heartbeatMs);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.pongTimer) { clearTimeout(this.pongTimer); this.pongTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.state === 'revoked' || this.state === 'closed') return;
    if (this.reconnectTimer) return; // single-flight: never stack reconnects (salvage M43)
    this.setState('reconnecting');
    const ceiling = this.reconnectMs;
    this.reconnectMs = Math.min(this.reconnectMs * 2, this.cfg.maxMs);
    // Full jitter in [ceiling/2, ceiling] so daemon fleets don't redial in lockstep (salvage M34).
    const delay = Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
    // NOT unref'd: while the socket is down this timer is the daemon's only live handle; unref'ing
    // would let the process exit mid-backoff (salvage stress-test finding).
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private setState(next: BridgeSocketState): void {
    if (this.state === next) return;
    this.state = next;
    this.opts.onStateChange?.(next);
  }
}

/** A refused Upgrade body indicating terminal revocation (server refuse(): CONV-2 envelope with
 *  details.reason 'pairing-revoked'). Parsed leniently — an unparseable body is NOT terminal. */
function isRevokedRefusal(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { error?: { details?: { reason?: string } } };
    return parsed.error?.details?.reason === 'pairing-revoked';
  } catch {
    return false;
  }
}
