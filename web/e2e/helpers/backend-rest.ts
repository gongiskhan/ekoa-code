import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Backend helpers for ported specs, over the REBUILD's REST contract.
 *
 * WHY THIS EXISTS. Several ported specs drove the backend through the old Cortex's RPC dispatcher —
 * `POST /api/v1/action { app: 'ekoa.auth', intent: 'login', params }` — and read `{ success, data }`
 * off the envelope. That endpoint does not exist in this repo and is not in the `shared/` contract
 * at all: the rebuild is REST. So every such call returned a 404 body, `success` and `data.token`
 * came back `undefined`, and the spec died in `beforeAll` on `expect(token).toBeTruthy()` — before
 * reaching a single product assertion. Seven test failures, none of which were about the product.
 *
 * WHAT THIS IS NOT. It is not a spec edit to make a failing assertion pass. The ported specs'
 * assertions are untouched; only the TRANSPORT their fixtures use is repointed from a retired
 * dispatcher to the endpoints that replaced it. If a spec then fails, that failure is real and is a
 * product defect to fix — which is the whole point of getting them running again.
 *
 * CORRECTION (2026-07-31). This docblock used to end by saying `ekoa.templates/*` and
 * `ekoa.artifact-backend/*` "have no REST equivalent, no route and no `shared/` module — those
 * surfaces were never built in the rebuild". That was wrong, and three specs stayed red on the
 * strength of it. The surfaces exist; the rebuild RENAMED the concept — a "template instance" is an
 * ARTIFACT. See the artifacts section at the foot of this file for the intent-to-route mapping,
 * every line of which was checked against the running API.
 */
const BE = process.env.BACKEND_URL ?? 'http://localhost:4111';

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, what: string): Promise<T> {
  if (!res.ok()) {
    throw new Error(`${what} failed: HTTP ${res.status()} — ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/** Log in as the seeded admin and return the bearer token. */
export async function login(
  request: APIRequestContext,
  username = 'admin',
  password = 'tmp12345',
): Promise<string> {
  // Generous timeout on purpose: login runs bcrypt at cost 12 and is the slowest call in the
  // suite, especially while the dev stack is still warming.
  const res = await request.post(`${BE}/api/v1/auth/login`, {
    data: { username, password },
    timeout: 60_000,
  });
  const body = await json<{ token?: string }>(res, 'login');
  expect(body.token, 'backend login returned a JWT').toBeTruthy();
  return body.token as string;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export interface SessionSummary {
  id: string;
  type?: string;
  messageCount?: number;
}

/**
 * The list envelope is `{ items: [...] }` — verified against the running API, not guessed. An
 * earlier version of this helper accepted `{ sessions }` or a bare array and silently returned []
 * for the real shape, so the caller's cleanup deleted nothing and the spec then ran against a
 * resumed session instead of a fresh one. A wrong-shaped read that returns EMPTY rather than
 * throwing is the worst kind: every caller sees "nothing to do" and carries on.
 */
export async function listSessions(request: APIRequestContext, token: string): Promise<SessionSummary[]> {
  const res = await request.get(`${BE}/api/v1/sessions`, { headers: auth(token), timeout: 30_000 });
  const body = await json<{ items?: SessionSummary[] }>(res, 'list sessions');
  if (!Array.isArray(body.items)) {
    throw new Error(`list sessions: expected { items: [...] }, got keys [${Object.keys(body).join(', ')}]`);
  }
  return body.items;
}

export async function deleteSession(request: APIRequestContext, token: string, id: string): Promise<void> {
  await request.delete(`${BE}/api/v1/sessions/${encodeURIComponent(id)}`, { headers: auth(token), timeout: 30_000 });
}

/** Patch the org/global settings singleton. Requires an org-admin or super-admin token. */
export async function patchSettings(
  request: APIRequestContext,
  token: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await request.patch(`${BE}/api/v1/settings`, { headers: auth(token), data: patch, timeout: 30_000 });
  return json<Record<string, unknown>>(res, 'patch settings');
}

// ---------------------------------------------------------------------------
// Artifacts — what the retired `ekoa.templates` / `ekoa.artifact-backend` intents became
// ---------------------------------------------------------------------------

/**
 * The docblock at the top of this file says `ekoa.templates/*` and `ekoa.artifact-backend/*` have
 * "no REST equivalent, no route and no `shared/` module". That was WRONG, and three specs sat red
 * for it. The surfaces exist — the rebuild renamed the concept: a "template instance" is an
 * ARTIFACT. Every intent those specs needed has a route, in `shared/src/artifacts.ts`, mounted and
 * answering:
 *
 *   ekoa.templates/import-instance   -> POST   /api/v1/artifacts/import
 *   ekoa.templates/list-instances    -> GET    /api/v1/artifacts        ({ items, featured })
 *   ekoa.templates/get-instance      -> GET    /api/v1/artifacts/:id
 *   ekoa.templates/update-instance   -> PATCH  /api/v1/artifacts/:id
 *   ekoa.templates/delete-instance   -> DELETE /api/v1/artifacts/:id
 *   ekoa.templates/versions-list     -> GET    /api/v1/artifacts/:id/versions
 *   ekoa.artifact-backend/run-sample -> POST   /api/v1/artifacts/:id/backend/sample-run
 *
 * Shapes below were read off the RUNNING API, not off the schema — the list envelope really is
 * `{ items, featured }`, which is why `listArtifacts` returns both instead of flattening.
 */
export interface ArtifactSummary {
  id: string;
  name?: string;
  slug?: string;
  status?: string;
  featured?: boolean;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function importArtifact(
  request: APIRequestContext,
  token: string,
  bundle: unknown,
): Promise<ArtifactSummary> {
  const res = await request.post(`${BE}/api/v1/artifacts/import`, {
    headers: auth(token),
    data: { bundle },
    timeout: 60_000,
  });
  return json<ArtifactSummary>(res, 'import artifact');
}

export async function listArtifacts(
  request: APIRequestContext,
  token: string,
): Promise<{ items: ArtifactSummary[]; featured: ArtifactSummary[] }> {
  const res = await request.get(`${BE}/api/v1/artifacts`, { headers: auth(token), timeout: 30_000 });
  const body = await json<{ items?: ArtifactSummary[]; featured?: ArtifactSummary[] }>(res, 'list artifacts');
  if (!Array.isArray(body.items)) {
    throw new Error(`list artifacts: expected { items: [...] }, got keys [${Object.keys(body).join(', ')}]`);
  }
  return { items: body.items, featured: body.featured ?? [] };
}

export async function getArtifact(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<ArtifactSummary> {
  const res = await request.get(`${BE}/api/v1/artifacts/${encodeURIComponent(id)}`, {
    headers: auth(token),
    timeout: 30_000,
  });
  return json<ArtifactSummary>(res, 'get artifact');
}

export async function patchArtifact(
  request: APIRequestContext,
  token: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<ArtifactSummary> {
  const res = await request.patch(`${BE}/api/v1/artifacts/${encodeURIComponent(id)}`, {
    headers: auth(token),
    data: patch,
    timeout: 30_000,
  });
  return json<ArtifactSummary>(res, 'patch artifact');
}

/** Best-effort delete, for cleanup: a 404 on an already-gone artifact is not a failure. */
export async function deleteArtifact(request: APIRequestContext, token: string, id: string): Promise<void> {
  await request
    .delete(`${BE}/api/v1/artifacts/${encodeURIComponent(id)}`, { headers: auth(token), timeout: 30_000 })
    .catch(() => undefined);
}

export async function listArtifactVersions(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<Array<Record<string, unknown>>> {
  const res = await request.get(`${BE}/api/v1/artifacts/${encodeURIComponent(id)}/versions`, {
    headers: auth(token),
    timeout: 30_000,
  });
  const body = await json<{ items?: Array<Record<string, unknown>> }>(res, 'list artifact versions');
  return body.items ?? [];
}

export async function runBackendSample(
  request: APIRequestContext,
  token: string,
  id: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await request.post(`${BE}/api/v1/artifacts/${encodeURIComponent(id)}/backend/sample-run`, {
    headers: auth(token),
    data,
    timeout: 60_000,
  });
  return json<Record<string, unknown>>(res, 'backend sample run');
}
