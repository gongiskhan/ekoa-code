import { it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import { RefreshRegistryResponse } from '@ekoa/shared';

/**
 * POST /api/v1/integrations/refresh is no longer a cross-tenant KEY ENUMERATION (A2-residual 1).
 *
 * Pre-A3 the route's `{count, keys}` folded in the disk runtime tier — one directory holding
 * EVERY tenant's authored package keys — so any org-admin of any org could enumerate what other
 * tenants had built. Non-tautological: the foreign package IS on the box (file exists) and the
 * baseline key IS in the response; only the runtime key is gone.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let tmp: string;
let seq = 0;
const savedEnv: Record<string, string | undefined> = {};
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-refreshenum-'));
  const baselineDir = join(tmp, 'baseline');
  mkdirSync(join(baselineDir, 'demo-base'), { recursive: true });
  writeFileSync(
    join(baselineDir, 'demo-base', 'config.json'),
    JSON.stringify({ integrationKey: 'demo-base', displayName: 'Demo', authType: 'none', configSchema: [], actions: [] }),
  );
  savedEnv.EKOA_INTEGRATIONS_DIR = process.env.EKOA_INTEGRATIONS_DIR;
  savedEnv.EKOA_DATA_DIR = process.env.EKOA_DATA_DIR;
  process.env.EKOA_INTEGRATIONS_DIR = baselineDir;
  process.env.EKOA_DATA_DIR = join(tmp, 'data');
  __resetConfigForTests();
  loadConfig();
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_refresh_enum');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
  process.env.EKOA_INTEGRATIONS_DIR = savedEnv.EKOA_INTEGRATIONS_DIR;
  process.env.EKOA_DATA_DIR = savedEnv.EKOA_DATA_DIR;
  refreshDefinitions();
  rmSync(tmp, { recursive: true, force: true });
});

it('POST /integrations/refresh answers the shipped baseline only — a foreign runtime key on the box is NOT enumerated', async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  await users.deleteMany({});
  await users.insert({ _id: 'admA', username: 'admA', passwordHash: await hashPassword('pw123456'), role: 'org-admin', orgId: 'orgA', active: true } as never);
  setActivation('admA', { active: true, billingLocked: false });
  const token = (await login('admA', 'pw123456', false, deps)).token;

  // ANOTHER TENANT's authored package sits in the (frozen) runtime tier on this box.
  const foreign = join(tmp, 'data', 'integrations', 'runtime', 'orgb-secret-tool');
  mkdirSync(foreign, { recursive: true });
  writeFileSync(
    join(foreign, 'config.json'),
    JSON.stringify({ integrationKey: 'orgb-secret-tool', displayName: 'B secret', authType: 'none', configSchema: [], actions: [] }),
  );
  expect(existsSync(join(foreign, 'config.json'))).toBe(true); // non-tautology: it IS on the box

  const res = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/refresh`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { count: number; keys: string[] };
  expect(RefreshRegistryResponse.safeParse(body).success).toBe(true);
  expect(body.keys).toContain('demo-base'); // the baseline positive
  expect(body.keys).not.toContain('orgb-secret-tool'); // the enumeration is CLOSED
  expect(body.count).toBe(body.keys.length);
});
