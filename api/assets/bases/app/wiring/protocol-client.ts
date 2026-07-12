/**
 * Protocol client for the `app` base.
 *
 * One typed entry to the served-app control plane. Every server-side action the
 * platform exposes rides a single envelope: POST /api/v1/action with
 * `{ app, intent, params }`, answered by an `action_result` (success) or an
 * `action_error`. `auth.ts` and the integrations helper below all speak this
 * runtime - this module makes the envelope first-class instead of hand-rolled
 * at each call site.
 */

declare global {
  interface Window {
    __ekoa?: { fetch?: typeof fetch };
  }
}

type FetchLike = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

function ekoaFetch(): FetchLike {
  if (typeof window !== 'undefined' && window.__ekoa?.fetch) return window.__ekoa.fetch;
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') return window.fetch.bind(window);
  throw new Error('No fetch available - Ekoa runtime not initialised');
}

export interface ActionResult<T> {
  type: 'action_result';
  request_id?: string;
  success: true;
  data: T;
}

export interface ActionError {
  type: 'action_error';
  request_id?: string;
  error: string;
}

export type ActionEnvelope<T> = ActionResult<T> | ActionError;

/** Thrown when an action returns `action_error` or a non-2xx transport status. */
export class ActionFailed extends Error {
  readonly app: string;
  readonly intent: string;
  readonly status?: number;
  constructor(message: string, app: string, intent: string, status?: number) {
    super(message);
    this.name = 'ActionFailed';
    this.app = app;
    this.intent = intent;
    this.status = status;
  }
}

/**
 * Post one action envelope and return its `data`, or throw `ActionFailed` on an
 * `action_error` / non-2xx response. This is the generic path every server
 * action rides; specialised helpers (callIntegration below) are built on it.
 */
export async function action<T = unknown>(
  app: string,
  intent: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const res = await ekoaFetch()('/api/v1/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app, intent, params }),
  });

  if (!res.ok) {
    throw new ActionFailed(`Action ${app}/${intent} failed (${res.status}).`, app, intent, res.status);
  }

  const body = (await res.json()) as ActionEnvelope<T>;
  if (body.type === 'action_error') {
    throw new ActionFailed(body.error || `Action ${app}/${intent} failed.`, app, intent);
  }
  return body.data;
}

// ---------------------------------------------------------------------------
// Integrations - the same contract app-auth-persistent shipped, now built over
// `action`. The integration proxy answers INSIDE the envelope's data with
// either { ok: true, data } or the needs_integration shape; a transport/action
// failure is mapped to the same needs_integration shape so the UI has one
// branch to render (IntegrationNeededBoundary).
// ---------------------------------------------------------------------------

export type IntegrationCategory =
  | 'email'
  | 'calendar'
  | 'files-storage'
  | 'payments'
  | 'external-api'
  | 'spreadsheets'
  | 'crm'
  | 'sms'
  | 'maps';

export type CallIntegrationResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: 'needs_integration';
      integration: IntegrationCategory;
      options?: string[];
      message: string;
    };

export async function callIntegration<T = unknown>(
  category: IntegrationCategory,
  actionName: string,
  args: Record<string, unknown> = {}
): Promise<CallIntegrationResult<T>> {
  try {
    // The proxy returns the CallIntegrationResult<T> shape as the envelope data.
    return await action<CallIntegrationResult<T>>('ekoa.integrations', 'call', {
      category,
      action: actionName,
      args,
    });
  } catch (err) {
    return {
      ok: false,
      status: 'needs_integration',
      integration: category,
      message: err instanceof Error && err.message ? err.message : 'Não foi possível executar a acção.',
    };
  }
}
