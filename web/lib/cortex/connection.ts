/**
 * Singleton HTTP+SSE connection manager for Cortex.
 *
 * Resilient design:
 * - HTTP for CRUD actions (fetch-based, no persistent connection needed)
 * - SSE for streaming events (EventSource with auto-reconnect)
 * - Token updates trigger SSE reconnect
 * - Page visibility / online-offline listeners trigger SSE reconnect
 */

type ServerEvent = {
  type: string;
  trace_id?: string | null;
  request_id?: string;
  [key: string]: unknown;
};

type EventHandler = (event: ServerEvent) => void;
type StreamHandler = (event: ServerEvent) => void;

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

type StatusListener = (status: ConnectionStatus) => void;

function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const DEFAULT_ACTION_TIMEOUT = 120_000;

class CortexConnection {
  private eventSource: EventSource | null = null;
  private status: ConnectionStatus = 'disconnected';
  private statusListeners = new Set<StatusListener>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private streamHandlers = new Set<StreamHandler>();
  private token: string | null = null;
  private baseUrl: string = '';
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private authUser: { id: string; role: string; scopes: string[] } | null = null;

  // -- Status --

  getStatus(): ConnectionStatus {
    return this.status;
  }

  getAuthUser() {
    return this.authUser;
  }

  isConnected(): boolean {
    return this.status === 'connected';
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(newStatus: ConnectionStatus) {
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      listener(newStatus);
    }
  }

  // -- Connect / Disconnect --

  connect(baseUrl: string, token: string | null): void {
    this.baseUrl = baseUrl;
    this.token = token;
    this.intentionalClose = false;
    this.reconnectAttempts = 0;

    if (token) {
      this.connectSSE();
    } else {
      // No token -- connected but unauthenticated (login page flow)
      // SSE requires a token, so we just mark as connected for HTTP actions
      this.setStatus('connected');
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.closeSSE();
    this.authUser = null;
    this.setStatus('disconnected');
  }

  updateToken(token: string | null): void {
    this.token = token;
    if (token) {
      // Reconnect SSE with new token
      this.closeSSE();
      this.intentionalClose = false;
      this.reconnectAttempts = 0;
      this.connectSSE();
    } else {
      this.closeSSE();
      this.setStatus('disconnected');
    }
  }

  reconnectNow(): void {
    if (this.isConnected()) return;
    if (this.intentionalClose) return;
    if (!this.token) return;
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.connectSSE();
  }

  // -- SSE Connection --

  private connectSSE(): void {
    this.closeSSE();
    if (!this.token) return;

    this.setStatus('connecting');

    // Build SSE URL with token in query param (EventSource cannot set headers)
    const sseUrl = `${this.getApiBaseUrl()}/api/v1/events?token=${encodeURIComponent(this.token)}`;

    const es = new EventSource(sseUrl);
    this.eventSource = es;

    // Listen for the connected event (custom event type)
    es.addEventListener('connected', (e) => {
      this.reconnectAttempts = 0;
      try {
        const data = JSON.parse(e.data);
        this.setStatus('connected');
        this.handleMessage(data);
      } catch {
        this.setStatus('connected');
      }
    });

    // Listen for all known event types
    const eventTypes = [
      'routing', 'stream', 'tool_event', 'skill_event', 'plan_step',
      'complete', 'error',
      'action_stream', 'action_complete', 'action_error',
      'auth_result', 'file_data', 'action_result',
      'automation_run_step', 'automation_run_complete',
      'automation_run_error', 'automation_run_paused',
      'automation_run_patch', 'automation_run_pause_for_user',
      'automation_run_resumed', 'automation_run_streaming_available',
      'automation_run_awaiting_consent', 'automation_run_awaiting_daemon',
      'automation_step_output_chunk',
      'preview_reload',
      'build_intent',
      'integration_build_intent',
      'integration_ready',
      'usage_updated',
      'usage_progress',
      'chat_answer',
    ];

    for (const type of eventTypes) {
      es.addEventListener(type, (e) => {
        try {
          const data = JSON.parse(e.data);
          this.handleMessage(data);
        } catch { /* ignore malformed events */ }
      });
    }

    es.onerror = () => {
      // EventSource auto-reconnects, but if it closes we handle it
      if (es.readyState === EventSource.CLOSED) {
        this.eventSource = null;
        this.setStatus('disconnected');
        if (!this.intentionalClose) {
          this.scheduleReconnect();
        }
      }
    };
  }

  private closeSSE(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(500 * Math.pow(1.5, Math.min(this.reconnectAttempts, 20)), 15_000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose && this.token) {
        this.connectSSE();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // -- Language --

  private getCurrentLanguage(): string {
    try {
      const stored = localStorage.getItem('ekoa_language');
      if (stored) {
        const parsed = JSON.parse(stored);
        return parsed?.state?.language || 'pt';
      }
    } catch { /* ignore */ }
    return 'pt';
  }

  // -- HTTP Base URL --

  getApiBaseUrl(): string {
    return this.baseUrl;
  }

  // -- Message handling (SSE events) --

  private handleMessage(data: ServerEvent): void {
    // Auth result handling
    if (data.type === 'auth_result') {
      if (data.success) {
        this.authUser = data.user as { id: string; role: string; scopes: string[] } | null;
      } else {
        this.authUser = null;
      }
    }

    // Stream events dispatch
    const streamTypes = new Set([
      'routing', 'stream', 'tool_event', 'skill_event', 'plan_step',
      'complete', 'error', 'action_stream', 'action_complete', 'action_error',
      'automation_run_step', 'automation_run_complete',
      'automation_run_error', 'automation_run_paused',
      'automation_run_patch', 'automation_run_pause_for_user',
      'automation_run_resumed', 'automation_run_streaming_available',
      'automation_run_awaiting_consent', 'automation_run_awaiting_daemon',
      'automation_step_output_chunk',
      'chat_answer',
      'integration_build_intent', 'integration_ready',
    ]);
    if (streamTypes.has(data.type)) {
      for (const handler of this.streamHandlers) {
        handler(data);
      }
    }

    // Typed event handlers
    const handlers = this.eventHandlers.get(data.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(data);
      }
    }

    // Wildcard handlers
    const wildcardHandlers = this.eventHandlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        handler(data);
      }
    }
  }

  // -- Event subscription --

  on(eventType: string, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }

  onStream(handler: StreamHandler): () => void {
    this.streamHandlers.add(handler);
    return () => this.streamHandlers.delete(handler);
  }

  // -- HTTP Actions --

  /**
   * Send an action via HTTP POST and get the response.
   * No SSE connection needed -- this is a simple request/response.
   */
  async sendAction<T = unknown>(
    app: string,
    intent: string,
    params: Record<string, unknown> = {},
    timeout: number = DEFAULT_ACTION_TIMEOUT,
  ): Promise<T> {
    const requestId = uuid();
    const url = `${this.getApiBaseUrl()}/api/v1/action`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ app, intent, params, request_id: requestId }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (data.type === 'action_error') {
        throw new Error(data.error || 'Action failed');
      }

      if (data.type === 'action_result' && data.success) {
        return data.data as T;
      }

      // Unexpected response shape -- return as-is
      return data as T;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Action timeout: ${app}/${intent}`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Send an AI chat request via HTTP POST.
   * Returns the trace_id. Events stream via SSE.
   */
  sendRequest(message: string, sessionId: string, options?: {
    mode?: 'auto' | 'force_local' | 'force_external' | 'force_orchestrated';
    metadata?: Record<string, unknown>;
    traceId?: string;
  }): string {
    const traceId = options?.traceId || uuid();
    const url = `${this.getApiBaseUrl()}/api/v1/request`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Fire and forget -- response is just { trace_id, status: 'accepted' }
    const metadata = { ...(options?.metadata || {}), language: this.getCurrentLanguage() };
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message,
        session_id: sessionId,
        trace_id: traceId,
        mode: options?.mode || 'auto',
        metadata,
      }),
    }).catch((err) => {
      console.error('[cortex] Request failed:', err);
    });

    return traceId;
  }

  /**
   * Cancel an in-flight chat-agent request by trace_id. The server aborts the
   * running SDK query (owner-scoped). Returns true when the server confirms the
   * run was found and aborted. Unsubscribing the client SSE alone does NOT stop
   * the server, which is why Stop must call this.
   */
  async cancelRequest(traceId: string): Promise<boolean> {
    if (!traceId) return false;
    const url = `${this.getApiBaseUrl()}/api/v1/request/cancel`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ trace_id: traceId }),
      });
      const d = await res.json().catch(() => null);
      return !!(d && d.cancelled);
    } catch (err) {
      console.error('[cortex] Request cancel failed:', err);
      return false;
    }
  }

  /**
   * Send a file upload via HTTP POST.
   * This replaces the WS file_upload message.
   */
  sendFileUpload(filename: string, contentBase64: string, mimeType: string): string {
    const requestId = uuid();
    // File uploads use the action protocol.
    this.sendAction('ekoa.knowledge', 'upload-file', {
      filename,
      contentBase64,
      mimeType,
      requestId,
    }).catch((err) => {
      console.error('[cortex] File upload failed:', err);
    });
    return requestId;
  }
}

// ============================================
// Singleton
// ============================================

let instance: CortexConnection | null = null;

export function getConnection(): CortexConnection {
  if (!instance) {
    instance = new CortexConnection();
  }
  return instance;
}

export function getPortFromEnv(): number | null {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  // Empty string means same-origin (Caddy proxy) -- no explicit port
  if (envUrl === '') return null;
  if (typeof window !== 'undefined' && envUrl) {
    try {
      const url = new URL(envUrl);
      if (url.port) return parseInt(url.port, 10);
      // Valid URL with no explicit port: use protocol default (null suppresses
      // the ":port" suffix so https://api.example.com stays on :443, not :4111).
      return null;
    } catch { /* ignore */ }
  }
  // No fallback: next.config.ts injects NEXT_PUBLIC_API_URL from
  // ../backend.port and fails the build if it can't. A missing value here
  // means the bundle was built without that injection — surface loudly.
  throw new Error(
    "NEXT_PUBLIC_API_URL is not set. Ensure backend.port exists at the " +
      "repo root (garrison writes it) and that next.config.ts ran."
  );
}

/**
 * Initialize the HTTP+SSE connection with the Cortex server.
 * Sets up visibility/online listeners for resilient reconnection.
 * Called once at app startup.
 */
export function initConnection(host?: string, port?: number): CortexConnection {
  const conn = getConnection();
  // Single source of truth: NEXT_PUBLIC_API_URL when set carries the full
  // protocol + host + port for cortex. Stripping anything but the port
  // breaks prod, where cortex lives on api.ekoa.io but the frontend on
  // app.ekoa.io. Only fall back to window.location for the explicit
  // same-origin case (NEXT_PUBLIC_API_URL='') or when the caller passes
  // host/port explicitly (the dev override path).
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  let baseUrl: string;
  if (host || port != null) {
    const apiHost = host || (typeof window !== 'undefined' ? window.location.hostname : 'localhost');
    const apiPort = port ?? getPortFromEnv();
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';
    baseUrl = apiPort != null
      ? `${protocol}://${apiHost}:${apiPort}`
      : `${protocol}://${apiHost}`;
  } else if (envUrl) {
    // Trust the env value verbatim — it has the protocol+host+(port).
    baseUrl = envUrl;
  } else {
    // envUrl is '' (same-origin) or undefined: build from window.
    const apiHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';
    baseUrl = `${protocol}://${apiHost}`;
  }
  const token = typeof window !== 'undefined' ? localStorage.getItem('ekoa_token') : null;
  conn.connect(baseUrl, token);

  // -- Resilience listeners --
  if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !conn.isConnected()) {
        conn.reconnectNow();
      }
    });
    window.addEventListener('online', () => {
      if (!conn.isConnected()) {
        conn.reconnectNow();
      }
    });
    window.addEventListener('focus', () => {
      if (!conn.isConnected()) {
        conn.reconnectNow();
      }
    });
  }

  return conn;
}

/**
 * Reconnect with a new auth token (after login).
 */
export function reconnectWithToken(token: string): void {
  const conn = getConnection();
  conn.updateToken(token);
}

/**
 * Resolve a relative Cortex URL (e.g. /template-screenshots/foo.png) to
 * an absolute URL using the current API base. Pass-through for absolute URLs.
 */
export function resolveApiUrl(path: string): string {
  if (!path || !path.startsWith('/')) return path;
  return `${getConnection().getApiBaseUrl()}${path}`;
}

export default CortexConnection;
