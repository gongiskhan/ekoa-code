/**
 * Transport for the per-integration LESSONS surface (slice C3, against
 * `GET|PATCH /api/v1/integrations/:key/lessons`).
 *
 * A thin adapter over the typed client, not a second HTTP layer: the two endpoints are ordinary
 * `shared/` descriptors, so `api.integrations.getLessons` / `setLessons` already carry the path,
 * the method, the auth header, the timeout and the dev-time response validation. What this module
 * adds is the mapping from the wire's THREE refusals onto the three things the panel must do
 * differently, so the component never reads a status code or an error `details` bag:
 *
 *   404 NOT_FOUND        -> `absent`: this integration has no lessons row (a shipped package, or a
 *                          definition this user cannot see). The panel renders nothing rather than
 *                          an empty editable box promising a save the server would refuse.
 *   400 `stale_revision` -> `stale`: someone else saved while this editor was typing. The DRAFT IS
 *                          NEVER DISCARDED — the panel shows both texts and lets the human choose.
 *   anything else        -> `error`, carrying the server's own PT-PT message when it sent one.
 */
import { ApiError } from '@/lib/api/errors';
import { api } from '@/lib/api';
import type { IntegrationLessonsView } from '@ekoa/shared';
import { IntegrationLessonsView as IntegrationLessonsViewSchema } from '@ekoa/shared';

/** The `details.code` the api sends when `expectedUpdatedAt` no longer names the stored row. */
export const STALE_REVISION_CODE = 'stale_revision';

export type LessonsLoadResult =
  | { kind: 'ready'; view: IntegrationLessonsView }
  | { kind: 'absent' }
  | { kind: 'error'; message: string };

export type LessonsSaveResult =
  | { kind: 'saved'; view: IntegrationLessonsView }
  | { kind: 'stale'; view: IntegrationLessonsView }
  | { kind: 'error'; message: string };

const GENERIC_FAILURE = 'Não foi possível contactar o serviço de integrações.';

/**
 * The stale refusal carries the CURRENT stored view in `details.current`. It is `safeParse`d
 * before the panel is allowed to show it as "what is stored now" — a conflict screen that
 * mis-states the other version is worse than no conflict screen.
 */
function staleViewOf(err: ApiError): IntegrationLessonsView | null {
  const details = (err.details ?? {}) as { code?: unknown; current?: unknown };
  if (details.code !== STALE_REVISION_CODE) return null;
  const parsed = IntegrationLessonsViewSchema.safeParse(details.current);
  return parsed.success ? parsed.data : null;
}

export async function loadIntegrationLessons(key: string): Promise<LessonsLoadResult> {
  try {
    return { kind: 'ready', view: await api.integrations.getLessons({ key }) };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { kind: 'absent' };
    return { kind: 'error', message: err instanceof ApiError ? err.message : GENERIC_FAILURE };
  }
}

export async function saveIntegrationLessons(
  key: string,
  lessons: string,
  expectedUpdatedAt?: string,
): Promise<LessonsSaveResult> {
  try {
    const view = await api.integrations.setLessons({
      key,
      lessons,
      ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}),
    });
    return { kind: 'saved', view };
  } catch (err) {
    if (err instanceof ApiError) {
      const current = staleViewOf(err);
      if (current) return { kind: 'stale', view: current };
      return { kind: 'error', message: err.message };
    }
    return { kind: 'error', message: GENERIC_FAILURE };
  }
}

/** The panel's whole dependency on the network, injected so the component can be driven directly
 *  in tests without standing up the request core beneath it. */
export interface LessonsTransport {
  load(key: string): Promise<LessonsLoadResult>;
  save(key: string, lessons: string, expectedUpdatedAt?: string): Promise<LessonsSaveResult>;
}

export const defaultLessonsTransport: LessonsTransport = {
  load: loadIntegrationLessons,
  save: saveIntegrationLessons,
};
