import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import { createConfig } from '../../src/integrations/service.js';
import { executeUserIntegrationAction, type FetchLike } from '../../src/integrations/action-executor.js';

/**
 * G8: the user-defined integration action runner (carryover-audit B25), adapted from
 * cortex/tests/automation/integration-action-executor.test.ts to the ekoa-code architecture —
 * the action shape now comes from the on-disk definitions registry, credentials from an
 * encrypted (real crypto) config row in the org-scoped store, and the transport is injected.
 *
 * The load-bearing assertions carry: JIT decrypt + interpolation + the HTTP call, per-owner
 * credential scoping, disabled/not-connected/unknown paths, and — critically — that a credential
 * NEVER leaks into the result on success OR failure (header AND request-body redaction).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_INTEGRATIONS = join(__dirname, '..', '..', 'assets', 'integrations');

let mem: MongoMemoryServer;
let seq = 0;
let fixtureRoot: string;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };

const actor = (userId: string, role: 'org-admin' | 'builder' = 'builder') => ({ userId, orgId: 'orgA', role } as const);

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { forEach: (cb: (v: string, k: string) => void) => void };
  text: () => Promise<string>;
}
function mkResponse(status: number, body: string): FakeResponse {
  return { ok: status >= 200 && status < 300, status, statusText: '', headers: { forEach: () => undefined }, text: async () => body };
}
function fakeFetch(handler: (url: string, init?: Parameters<FetchLike>[1]) => FakeResponse): { fn: FetchLike; calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> } {
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init) as unknown as Response;
  };
  return { fn, calls };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  fixtureRoot = mkdtempSync(join(tmpdir(), 'ekoa-exec-'));
  cpSync(REAL_INTEGRATIONS, fixtureRoot, { recursive: true });
  // An 'acme' api_key integration + a 'noauth' authType:none integration.
  mkdirSync(join(fixtureRoot, 'acme'), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'acme', 'config.json'),
    JSON.stringify({
      version: '1.0',
      integrationKey: 'acme',
      displayName: 'Acme',
      authType: 'api_key',
      provider: 'acme',
      category: 'test',
      configSchema: [],
      actions: [
        { actionName: 'list_things', description: 'list', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://api.acme.example', path: '/things', headers: { Authorization: 'Bearer {{api_key}}' }, queryParams: { limit: '{{limit}}' } } },
        { actionName: 'token_grant', description: 'grant', mutates: false, httpConfig: { method: 'POST', baseUrl: 'https://api.acme.example', path: '/oauth/token', headers: { 'Content-Type': 'application/json' }, bodyTemplate: { client_secret: '{{api_key}}', grant_type: 'client_credentials' } } },
        { actionName: 'query_key', description: 'key in query', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://api.acme.example', path: '/data', queryParams: { token: '{{api_key}}' } } },
        { actionName: 'no_http', description: 'noop', mutates: false },
      ],
    }),
    'utf-8',
  );
  process.env.EKOA_INTEGRATIONS_DIR = fixtureRoot;
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_exec');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  delete process.env.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await integrationConfigs.deleteMany({});
});

async function connectAcme(userId: string, apiKey: string, opts: { enabled?: boolean } = {}) {
  const cfg = await createConfig(actor(userId), { integrationKey: 'acme', configValues: { api_key: apiKey } }, deps);
  if (opts.enabled === false) await integrationConfigs.update(cfg._id, (cur) => ({ ...cur, enabled: false }));
}

describe('executeUserIntegrationAction (G8, ch03 §3.8.13)', () => {
  it('returns unknown_integration for an unknown key', async () => {
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'nope', actionName: 'x', args: {} });
    expect(res.success).toBe(false);
    expect(res.code).toBe('unknown_integration');
  });

  it('returns unknown_action when the action is not on the integration', async () => {
    await connectAcme('u1', 'k');
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'nope', args: {} });
    expect(res.success).toBe(false);
    expect(res.code).toBe('unknown_action');
  });

  it('returns not_connected when no credential row exists for the owner', async () => {
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'list_things', args: { limit: 10 } });
    expect(res.success).toBe(false);
    expect(res.code).toBe('not_connected');
  });

  it('decrypts JIT, interpolates path/query/header, and calls the endpoint', async () => {
    await connectAcme('u1', 'secret-123');
    const ff = fakeFetch(() => mkResponse(200, JSON.stringify({ items: [{ id: 1 }] })));
    const res = await executeUserIntegrationAction(
      { orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'list_things', args: { limit: 25 } },
      { fetchImpl: ff.fn },
    );
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ items: [{ id: 1 }] });
    expect(ff.calls[0]!.url).toContain('limit=25');
    expect((ff.calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer secret-123');
  });

  it('never leaks credential plaintext on success', async () => {
    await connectAcme('u1', 'super-secret-token');
    const ff = fakeFetch(() => mkResponse(200, '{"x":1}'));
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'list_things', args: {} }, { fetchImpl: ff.fn });
    expect(JSON.stringify(res)).not.toContain('super-secret-token');
  });

  it('never leaks credential plaintext on HTTP error (header redaction)', async () => {
    await connectAcme('u1', 'super-secret-token');
    const ff = fakeFetch(() => mkResponse(401, '{"error":"unauthorized"}'));
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'list_things', args: {} }, { fetchImpl: ff.fn });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain('super-secret-token');
  });

  it('never leaks a credential carried in the request body (body redaction), but keeps it debuggable', async () => {
    await connectAcme('u1', 'body-secret-xyz');
    const ff = fakeFetch(() => mkResponse(400, '{"error":"invalid_grant"}'));
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'token_grant', args: {} }, { fetchImpl: ff.fn });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res)).not.toContain('body-secret-xyz');
    expect(res.details?.request.body).toMatch(/client_secret/);
  });

  it('never leaks a credential carried in the URL query string on error (URL redaction — G8 review)', async () => {
    await connectAcme('u1', 'query-secret-abc');
    const ff = fakeFetch(() => mkResponse(403, '{"error":"forbidden"}'));
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'query_key', args: {} }, { fetchImpl: ff.fn });
    expect(res.success).toBe(false);
    // The real request carried the secret in the query string...
    expect(ff.calls[0]!.url).toContain('query-secret-abc');
    // ...but the surfaced failure summary must not.
    expect(JSON.stringify(res)).not.toContain('query-secret-abc');
    expect(res.details?.request.url).not.toContain('query-secret-abc');
  });

  it('does not use another owner\'s credential row (per-owner scoping)', async () => {
    await connectAcme('someone-else', 'their-key');
    const ff = fakeFetch(() => mkResponse(200, '{}'));
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'list_things', args: {} }, { fetchImpl: ff.fn });
    expect(res.success).toBe(false);
    expect(res.code).toBe('not_connected');
    expect(ff.calls).toHaveLength(0);
  });

  it('returns disabled when the integration row is disabled', async () => {
    await connectAcme('u1', 'k', { enabled: false });
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'list_things', args: {} });
    expect(res.success).toBe(false);
    expect(res.code).toBe('disabled');
  });

  it('reports a friendly transport error on timeout/abort', async () => {
    await connectAcme('u1', 'k');
    const ff: FetchLike = () => Promise.reject(new Error('The user aborted a request.'));
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'list_things', args: {} }, { fetchImpl: ff });
    expect(res.success).toBe(false);
    expect(res.code).toBe('transport_error');
  });

  it('rejects an action that has neither httpConfig nor automationBinding', async () => {
    await connectAcme('u1', 'k');
    const res = await executeUserIntegrationAction({ orgId: 'orgA', ownerUserId: 'u1', integrationKey: 'acme', actionName: 'no_http', args: {} });
    expect(res.success).toBe(false);
    expect(res.code).toBe('unsupported_auth_type');
  });
});
