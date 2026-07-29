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
 * NOT EVERY INTENT HAS A HOME HERE. `ekoa.templates/*` and `ekoa.artifact-backend/*` have no REST
 * equivalent, no route and no `shared/` module — those surfaces were never built in the rebuild, so
 * the specs that need them cannot be repointed and are tracked separately in `docs/findings.md`.
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
