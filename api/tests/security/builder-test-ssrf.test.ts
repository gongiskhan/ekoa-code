import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, integrationBuilderSessions } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { integrationBuilderRouter } from '../../src/routes/integration-builder.js';
import { createSession } from '../../src/agents/integration-builder.js';
import { IntegrationBuilderTestResponse } from '@ekoa/shared';

/**
 * SECURITY SUITE - SSRF ON THE INTEGRATION BUILDER'S `/test` RAIL.
 *
 * `POST /api/v1/integration-builder/test` executes ONE action's `httpConfig` live. Until this
 * change it did so on a BARE `fetch`, against a URL that comes out of a MODEL-authored builder
 * session, while the docblock claimed it matched "the same posture as the action executor" - which
 * sends through `guardedFetch`. Any authenticated user could therefore make the API host issue a
 * request to a destination only the API host can reach: the cloud metadata service, a container
 * admin port, an internal service on the private network.
 *
 * The refusal is proved against the ROUTE'S REAL DEFAULT - there is no injected transport here on
 * purpose, because a seam is exactly what a bypass would hide behind.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `bsess_${seq++}` };

const ACTOR = { userId: 'u-builder', orgId: 'orgSsrf', role: 'user' } as const;

async function seedSession(baseUrl: string, path = '/x', method: 'GET' | 'POST' = 'GET'): Promise<string> {
  const s = await createSession(ACTOR, deps, {
    integrationKey: 'meu-servico',
    currentPackage: {
      version: '1.0',
      integrationKey: 'meu-servico',
      displayName: 'Meu Serviço',
      authType: 'api_key',
      configSchema: [],
      actions: [
        {
          actionName: 'ping',
          description: 'ping',
          mutates: method !== 'GET',
          httpConfig: { method, baseUrl, path, headers: { Authorization: 'Bearer {{api_key}}' } },
        },
      ],
    },
    currentSkillMd: '# meu-servico',
  });
  return s._id;
}

const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });

let token: string;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_builder_ssrf');
  const app = express();
  app.use(express.json());
  app.use('/api/v1/integration-builder', integrationBuilderRouter(deps));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  for (const s of [users, integrationBuilderSessions]) await s.deleteMany({});
  await users.insert({
    _id: ACTOR.userId, username: ACTOR.userId, passwordHash: await hashPassword('pw123456'),
    role: 'user', orgId: ACTOR.orgId, active: true,
  } as never);
  setActivation(ACTOR.userId, { active: true, billingLocked: false });
  token = (await login(ACTOR.userId, 'pw123456', false, deps)).token;
});

describe('integration-builder /test - SSRF guard', () => {
  const blocked: Array<[string, string]> = [
    ['loopback', 'http://127.0.0.1:9999'],
    ['loopback by name', 'http://localhost:9999'],
    ['cloud metadata (link-local)', 'http://169.254.169.254'],
    ['private RFC1918 /8', 'http://10.0.0.5:8080'],
    ['private RFC1918 /16', 'http://192.168.1.1'],
    ['IPv6 loopback', 'http://[::1]:9999'],
  ];

  for (const [what, baseUrl] of blocked) {
    it(`refuses ${what} without contacting it`, async () => {
      const sessionId = await seedSession(baseUrl, '/latest/meta-data/');
      const res = await api('/api/v1/integration-builder/test', token, {
        method: 'POST',
        body: JSON.stringify({ builderSessionId: sessionId, actionKey: 'ping', testCredentials: { api_key: 'k' } }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; error?: string; response?: unknown };
      expect(IntegrationBuilderTestResponse.safeParse(body).success).toBe(true);
      expect(body.success).toBe(false);
      // The destination is NEVER echoed back: a refused URL is caller-chosen text and the reply
      // would otherwise be a probe for what the API host can reach.
      expect(body.error).toBe('Pedido bloqueado por segurança.');
      expect(body.response).toBeUndefined();
    });
  }

  it('a MUTATING action is refused by the guard on the same terms (no method-shaped exemption)', async () => {
    const sessionId = await seedSession('http://169.254.169.254', '/latest/meta-data/', 'POST');
    const res = await api('/api/v1/integration-builder/test', token, {
      method: 'POST',
      body: JSON.stringify({ builderSessionId: sessionId, actionKey: 'ping', testCredentials: { api_key: 'k' } }),
    });
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Pedido bloqueado por segurança.');
  });

  it("another user's session is a 404 - the SSRF fix does not widen who may drive this rail", async () => {
    const sessionId = await seedSession('http://127.0.0.1:9999');
    await users.insert({
      _id: 'u-other', username: 'u-other', passwordHash: await hashPassword('pw123456'),
      role: 'user', orgId: ACTOR.orgId, active: true,
    } as never);
    setActivation('u-other', { active: true, billingLocked: false });
    const otherToken = (await login('u-other', 'pw123456', false, deps)).token;
    const res = await api('/api/v1/integration-builder/test', otherToken, {
      method: 'POST',
      body: JSON.stringify({ builderSessionId: sessionId, actionKey: 'ping' }),
    });
    expect(res.status).toBe(404);
  });
});
