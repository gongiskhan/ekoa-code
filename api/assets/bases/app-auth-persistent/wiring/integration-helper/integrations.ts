/**
 * Integration helper for app-auth-persistent.
 *
 * Provides the canonical `callIntegration<T>()` contract. Apps call this for
 * any cross-service action (email send, calendar list, etc.). If no provider
 * is connected for the requested category, returns the
 * `{ ok: false; status: 'needs_integration'; ... }` shape so the UI can render
 * the IntegrationNeededBoundary.
 */

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

const EKOA_FETCH: (input: RequestInfo, init?: RequestInit) => Promise<Response> =
  typeof window !== 'undefined' && (window as Window & { __ekoa?: { fetch?: typeof fetch } }).__ekoa?.fetch
    ? (window as Window & { __ekoa: { fetch: typeof fetch } }).__ekoa.fetch
    : typeof window !== 'undefined' && typeof window.fetch === 'function'
      ? window.fetch.bind(window)
      : (() => {
          throw new Error('No fetch available — Ekoa runtime not initialised');
        });

export async function callIntegration<T = unknown>(
  category: IntegrationCategory,
  action: string,
  args: Record<string, unknown> = {}
): Promise<CallIntegrationResult<T>> {
  const res = await EKOA_FETCH('/api/v1/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: 'ekoa.integrations',
      intent: 'call',
      params: { category, action, args },
    }),
  });

  if (!res.ok) {
    return {
      ok: false,
      status: 'needs_integration',
      integration: category,
      message: `Não foi possível executar a acção (${res.status}).`,
    };
  }

  const body = (await res.json()) as
    | { type: 'action_result'; data: { ok: true; data: T } | { ok: false; status: 'needs_integration'; integration: IntegrationCategory; options?: string[]; message: string } }
    | { type: 'action_error'; error: string };

  if (body.type === 'action_error') {
    return {
      ok: false,
      status: 'needs_integration',
      integration: category,
      message: body.error || 'Erro inesperado.',
    };
  }

  return body.data;
}
