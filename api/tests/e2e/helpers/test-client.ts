/**
 * HTTP+SSE Test Client for Ekoa E2E Tests
 *
 * Provides a typed client for exercising the Cortex HTTP action protocol
 * in integration tests. Uses Node.js built-in `fetch` for HTTP requests.
 *
 * The client handles:
 * - Login via `POST /api/v1/action` with `ekoa.auth` / `login` intent
 * - Authenticated action calls with JWT bearer token
 * - Request ID generation
 *
 * SSE streaming is intentionally omitted -- action responses are synchronous.
 */

import { randomUUID } from 'node:crypto';

/** Shape of a successful action response from Cortex. */
export interface ActionResult<T = unknown> {
  type: 'action_result';
  request_id: string;
  success: true;
  data: T;
}

/** Shape of an error action response from Cortex. */
export interface ActionError {
  type: 'action_error';
  request_id: string;
  error: string;
}

export class EkoaTestClient {
  private token: string | null = null;

  constructor(private baseUrl: string) {}

  /**
   * Authenticate as a user and store the JWT for subsequent requests.
   * @returns The JWT token string.
   */
  async login(email: string, password: string): Promise<string> {
    const requestId = randomUUID();
    const res = await fetch(`${this.baseUrl}/api/v1/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'ekoa.auth',
        intent: 'login',
        params: { email, password },
        request_id: requestId,
      }),
    });

    if (!res.ok) {
      throw new Error(`Login HTTP error: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as ActionResult<{ token: string }> | ActionError;

    if (body.type === 'action_error') {
      throw new Error(`Login failed: ${body.error}`);
    }

    // The auth handler returns the token inside the data payload
    const data = body.data as Record<string, unknown>;
    const token = (data.token ?? data.jwt ?? data.access_token) as string | undefined;
    if (!token) {
      throw new Error('Login response did not contain a token');
    }

    this.token = token;
    return token;
  }

  /**
   * Send an authenticated action request to Cortex.
   *
   * @param app    - The domain app ID (e.g. 'ekoa.memory')
   * @param intent - The action intent (e.g. 'create')
   * @param params - Optional parameters for the action
   * @returns The parsed `data` field from the action_result envelope.
   * @throws If the response is an action_error or HTTP error.
   */
  async action<T = unknown>(
    app: string,
    intent: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const requestId = randomUUID();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseUrl}/api/v1/action`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        app,
        intent,
        params: params ?? {},
        request_id: requestId,
      }),
    });

    const body = (await res.json()) as ActionResult<T> | ActionError;

    if (body.type === 'action_error') {
      throw new Error(`Action ${app}/${intent} failed: ${body.error}`);
    }

    return body.data as T;
  }

  /** Get the current JWT token (null if not logged in). */
  getToken(): string | null {
    return this.token;
  }

  /** Set the JWT token directly (useful for tests that mock auth). */
  setToken(token: string): void {
    this.token = token;
  }

  /** Clear stored token and release any resources. */
  close(): void {
    this.token = null;
  }
}
