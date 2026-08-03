/**
 * Transport for the flag-gated Citius sync rail (slice CS7, against CS6's `api/src/routes/sync.ts`).
 *
 * WHY A RAW FETCH AND NOT THE TYPED CLIENT. `web/lib/api` is generated at the TYPE level from the
 * `shared/` endpoint descriptor maps, and the sync rail deliberately has no descriptor: CS6 keeps
 * it out of `ALL_ENDPOINTS` because it is dashboard-auth plumbing, not part of the public,
 * versioned capability contract (RUN_SPEC non-goal: the sync graduates through the integration
 * execute endpoint, not by being promoted here). So there is nothing for the client factory to
 * generate from, and this module talks to the two routes directly - through the SAME single
 * base-URL resolver and the SAME single token accessor every other caller uses, so no new API
 * origin and no second token reader enter the tree.
 *
 * WHAT IT STILL ENFORCES. Every response is `safeParse`d against its named `shared/` schema before
 * it is handed to the UI. A payload that does not validate is reported as an ERROR, never rendered:
 * a panel whose entire job is to say "we can prove your inbox is complete" must not make that claim
 * from a body it could not parse.
 */
import { ErrorEnvelope, SyncRunOutcome, SyncStateView } from '@ekoa/shared';
import { resolveBaseUrl } from '@/lib/api/base-url';
import { getToken } from '@/lib/api/token';

/** The mounted prefix (`api/src/server.ts`: `app.use('/api/v1/sync', syncRouter())`). */
const SYNC_BASE = '/api/v1/sync';
export const CITIUS_SYNC_STATE_PATH = `${SYNC_BASE}/citius/notificacoes/state`;
export const CITIUS_SYNC_RUN_PATH = `${SYNC_BASE}/citius/notificacoes`;

/**
 * `unavailable` is the FLAG being off (or the route not mounted): CS6 answers 404 for a disabled
 * feature, deliberately indistinguishable from a route that does not exist, so the panel treats it
 * as "this surface is not for this deployment" and renders nothing at all - not an error, not an
 * empty state, not an advert for a feature the operator has not opted into.
 */
export type SyncStateResult =
  | { kind: 'ready'; state: SyncStateView }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

export type SyncRunResult =
  | { kind: 'outcome'; outcome: SyncRunOutcome }
  | { kind: 'unavailable' }
  | { kind: 'error'; message: string };

const CONTRACT_MISMATCH = 'A resposta do servidor não corresponde ao contrato de sincronização.';
const GENERIC_FAILURE = 'Não foi possível contactar o serviço de sincronização.';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** The server's own PT-PT message when the body is a shared error envelope; a fallback otherwise. */
async function messageFrom(response: Response): Promise<string> {
  try {
    const parsed = ErrorEnvelope.safeParse(await response.json());
    if (parsed.success) return parsed.data.error.message;
  } catch {
    /* not JSON - fall through to the generic message */
  }
  return GENERIC_FAILURE;
}

export async function fetchCitiusSyncState(signal?: AbortSignal): Promise<SyncStateResult> {
  let response: Response;
  try {
    response = await fetch(`${resolveBaseUrl()}${CITIUS_SYNC_STATE_PATH}`, {
      method: 'GET',
      headers: { ...authHeaders() },
      ...(signal ? { signal } : {}),
    });
  } catch {
    return { kind: 'error', message: GENERIC_FAILURE };
  }
  if (response.status === 404) return { kind: 'unavailable' };
  if (!response.ok) return { kind: 'error', message: await messageFrom(response) };

  const parsed = SyncStateView.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { kind: 'error', message: CONTRACT_MISMATCH };
  return { kind: 'ready', state: parsed.data };
}

export async function runCitiusSync(signal?: AbortSignal): Promise<SyncRunResult> {
  let response: Response;
  try {
    response = await fetch(`${resolveBaseUrl()}${CITIUS_SYNC_RUN_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: '{}',
      ...(signal ? { signal } : {}),
    });
  } catch {
    return { kind: 'error', message: GENERIC_FAILURE };
  }
  if (response.status === 404) return { kind: 'unavailable' };
  if (!response.ok) return { kind: 'error', message: await messageFrom(response) };

  const parsed = SyncRunOutcome.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { kind: 'error', message: CONTRACT_MISMATCH };
  return { kind: 'outcome', outcome: parsed.data };
}
