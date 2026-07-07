/**
 * The event-stream client (ch12 §12.3). Replaces the SSE half of the old singleton: no
 * firehose, no wildcard, no client-side trace filtering (FC-007/FC-010). Opens ONLY the
 * four sanctioned scoped streams (ch03 §3.6), each typed to its `shared/events.ts` union.
 * `new EventSource(` appears ONLY in this file (acceptance criterion 6).
 *
 * SSE framing (ch03 §3.6): `event: <type>` + `data: <json>` + monotonic `id:`. Native
 * `EventSource` reconnects with `Last-Event-ID`, so the server replays from its bounded
 * ring buffer; a manual backoff re-open loses that, so consumers re-sync via `GET /:id`
 * after the payload-free `ready` signal (that re-sync is the hook's job, not this module's).
 *
 * The stream manager subscribes to the token accessor (§12.2.4): a new token re-opens
 * every active stream (FC-004), a cleared token closes them all. Resilience listeners
 * (`visibilitychange` / `online` / `focus`) trigger an immediate reconnect (FC-005).
 * Backoff is 500ms x 1.5^n capped at 15s (FC-008). Everything is SSR-guarded.
 */

import type { ChatRunEvent, JobEvent, AutomationRunEvent, NotificationEvent } from '@ekoa/shared';
import { resolveBaseUrl } from './base-url';
import { getToken, subscribe as subscribeToken } from './token';

export type StreamStatus = 'disconnected' | 'connecting' | 'connected';
export type Unsubscribe = () => void;

export interface EventStream<E extends { type: string }> {
  readonly status: StreamStatus;
  onStatusChange(fn: (status: StreamStatus) => void): Unsubscribe;
  on<K extends E['type']>(type: K, handler: (event: Extract<E, { type: K }>) => void): Unsubscribe;
  close(): void;
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_FACTOR = 1.5;
const BACKOFF_CAP_MS = 15_000;

// -- Shared stream manager --------------------------------------------------------------

const activeStreams = new Set<SseStream<{ type: string }>>();
let tokenSubscribed = false;
let resilienceAttached = false;

function ensureManager(): void {
  if (typeof window === 'undefined') return;
  if (!tokenSubscribed) {
    tokenSubscribed = true;
    // Token change: a new token re-auths every open stream; a cleared token closes them.
    subscribeToken((token) => {
      for (const stream of [...activeStreams]) {
        if (token) stream.reauth();
        else stream.close();
      }
    });
  }
  if (!resilienceAttached) {
    resilienceAttached = true;
    const kick = () => {
      for (const stream of [...activeStreams]) stream.reconnectNow();
    };
    window.addEventListener('online', kick);
    window.addEventListener('focus', kick);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') kick();
    });
  }
}

// -- SSE stream implementation ----------------------------------------------------------

class SseStream<E extends { type: string }> implements EventStream<E> {
  private es: EventSource | null = null;
  private _status: StreamStatus = 'disconnected';
  private readonly statusSubs = new Set<(status: StreamStatus) => void>();
  private readonly handlers = new Map<string, Set<(event: unknown) => void>>();
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly path: string) {
    // SSR / non-browser: stay a no-op disconnected stream.
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    ensureManager();
    activeStreams.add(this as unknown as SseStream<{ type: string }>);
    this.connect();
  }

  get status(): StreamStatus {
    return this._status;
  }

  onStatusChange(fn: (status: StreamStatus) => void): Unsubscribe {
    this.statusSubs.add(fn);
    return () => {
      this.statusSubs.delete(fn);
    };
  }

  on<K extends E['type']>(type: K, handler: (event: Extract<E, { type: K }>) => void): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const wrapped = handler as (event: unknown) => void;
    set.add(wrapped);
    // Attach the named-event listener on the live source for this type (idempotent for a
    // stable function reference); reconnects re-attach every known type in connect().
    if (this.es) this.es.addEventListener(type, this.namedListener);
    return () => {
      set?.delete(wrapped);
    };
  }

  close(): void {
    this.closed = true;
    this.clearTimer();
    this.teardownEs();
    this.setStatus('disconnected');
    activeStreams.delete(this as unknown as SseStream<{ type: string }>);
  }

  /** Re-open with the current token (token-change re-auth). */
  reauth(): void {
    if (this.closed) return;
    this.attempt = 0;
    this.clearTimer();
    this.reopen();
  }

  /** Immediate reconnect attempt if not already connected (resilience listeners). */
  reconnectNow(): void {
    if (this.closed || this._status === 'connected') return;
    this.attempt = 0;
    this.clearTimer();
    this.reopen();
  }

  private connect(): void {
    if (this.closed) return;
    const token = getToken();
    // Streams open only when a token exists (FC-003); a tokenless session stays idle.
    if (!token) {
      this.setStatus('disconnected');
      return;
    }
    this.setStatus('connecting');
    const url = `${resolveBaseUrl()}${this.path}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    this.es = es;
    es.onopen = () => {
      this.attempt = 0;
      this.setStatus('connected');
    };
    es.onerror = () => {
      // readyState CONNECTING => native auto-reconnect in flight (keeps Last-Event-ID).
      // readyState CLOSED => hard failure; take over with our own backoff re-open.
      if (es.readyState === EventSource.CLOSED) {
        this.setStatus('disconnected');
        this.scheduleReconnect();
      } else {
        this.setStatus('connecting');
      }
    };
    es.onmessage = this.defaultListener;
    for (const type of this.handlers.keys()) es.addEventListener(type, this.namedListener);
  }

  private reopen(): void {
    this.teardownEs();
    this.connect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, this.attempt), BACKOFF_CAP_MS);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reopen();
    }, delay);
  }

  private clearTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardownEs(): void {
    if (this.es) {
      this.es.onopen = null;
      this.es.onerror = null;
      this.es.onmessage = null;
      try {
        this.es.close();
      } catch {
        /* ignore */
      }
      this.es = null;
    }
  }

  // Named SSE events (`event: <type>`): the DOM event type IS the union `type`.
  private readonly namedListener = (event: MessageEvent): void => {
    this.dispatch(event.type, event.data);
  };

  // Default (unnamed) SSE events: dispatch by the payload's `type` field. Defensive - the
  // ch03 contract uses named events, so this rarely fires and never double-dispatches.
  private readonly defaultListener = (event: MessageEvent): void => {
    this.dispatch('message', event.data);
  };

  private dispatch(domType: string, raw: string): void {
    let payload: { type?: string } | undefined;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return;
    }
    const type = domType !== 'message' ? domType : payload?.type;
    if (!type) return;
    const set = this.handlers.get(type);
    if (set) for (const handler of [...set]) handler(payload);
  }

  private setStatus(status: StreamStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const fn of [...this.statusSubs]) fn(status);
  }
}

// -- The four sanctioned factories (ch03 §3.6) ------------------------------------------

/** Chat run stream (§3.6.1). Opened on run creation; closed by the client on complete/error. */
export function openChatRunStream(runId: string): EventStream<ChatRunEvent> {
  return new SseStream<ChatRunEvent>(`/api/v1/chat/runs/${encodeURIComponent(runId)}/events`);
}

/** Build / brand-research job stream (§3.6.2). */
export function openJobStream(jobId: string): EventStream<JobEvent> {
  return new SseStream<JobEvent>(`/api/v1/jobs/${encodeURIComponent(jobId)}/events`);
}

/** Automation run stream (§3.6.3). Opened per active run. */
export function openAutomationRunStream(runId: string): EventStream<AutomationRunEvent> {
  return new SseStream<AutomationRunEvent>(`/api/v1/automations/runs/${encodeURIComponent(runId)}/events`);
}

/** Per-user notifications stream (§3.6.4). Opened once per authenticated session by the ApiProvider. */
export function openNotificationsStream(): EventStream<NotificationEvent> {
  return new SseStream<NotificationEvent>('/api/v1/notifications/events');
}
