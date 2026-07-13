import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, billingAccounts, tokenEvents, integrationConfigs, integrationBuilderSessions } from '../../src/data/stores.js';
import { setCredential, __resetCredentialsForTests } from '../../src/llm/credentials.js';
import { __setTransportForTests, __resetTransportForTests } from '../../src/llm/client.js';
import { makeFakeTransport } from '../agents/_fake-transport.js';
import { getDefinition, refreshDefinitions } from '../../src/integrations/definitions.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  IntegrationBuilderChatResponse,
  IntegrationBuilderLoadResponse,
  IntegrationBuilderSaveResponse,
  IntegrationBuilderTestResponse,
  ErrorEnvelope,
} from '@ekoa/shared';

/**
 * PR4 — the AI integration builder (ch03 §3.8.14). Contract coverage for the four endpoints against
 * the shared schemas, with a fake chokepoint transport scripting the model's two fenced blocks. The
 * runtime tier writes into an isolated EKOA_DATA_DIR; the test route runs against an ephemeral local
 * HTTP server (no live call).
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number; let dataDir: string;
const savedDataEnv = process.env.EKOA_DATA_DIR;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

/** A scripted model reply: prose + the two fenced blocks, for a package targeting `baseUrl`. */
function modelReply(key: string, baseUrl: string): string {
  const config = {
    integrationKey: key,
    displayName: 'Weather API',
    description: 'Fetch weather data.',
    authType: 'api_key',
    provider: 'WeatherCo',
    category: 'data',
    configSchema: [{ key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true, helpText: 'From the dashboard.' }],
    credentialGuide: '1. Sign in.\n2. Copy the API key.',
    actions: [{
      actionName: 'ping',
      description: 'Ping the weather API.',
      mutates: false,
      argsSchema: { type: 'object', properties: { city: { type: 'string' } }, required: [] },
      returnSchema: { type: 'object' },
      httpConfig: { method: 'GET', baseUrl, path: '/echo', headers: { Authorization: 'Bearer {{api_key}}' }, queryParams: { city: '{{city}}' } },
    }],
  };
  return [
    "Here's what I'm setting up:",
    '- Ping the weather API',
    '',
    'You can always come back to add more actions later.',
    '',
    '## How to get your credentials',
    '1. Sign in.',
    '',
    '## Testing your integration',
    'Open the Tests tab, enter your key, and run Ping.',
    '',
    '```skill-md',
    '---',
    `name: ${key}`,
    'description: Weather integration',
    '---',
    '# Weather API',
    'A knowledge doc.',
    '```',
    '',
    '```config-json',
    JSON.stringify(config, null, 2),
    '```',
  ].join('\n');
}

async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: 'orgA', active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  dataDir = mkdtempSync(join(tmpdir(), 'ekoa-ib-data-'));
  process.env.EKOA_DATA_DIR = dataDir;
  delete process.env.EKOA_INTEGRATIONS_DIR; // baseline = the real shipped assets
  __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_integration_builder');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close(); await closeMongo(); await mem.stop();
  if (savedDataEnv === undefined) delete process.env.EKOA_DATA_DIR; else process.env.EKOA_DATA_DIR = savedDataEnv;
  refreshDefinitions();
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  __resetTransportForTests(); __resetCredentialsForTests();
  for (const s of [users, orgs, billingAccounts, tokenEvents, integrationConfigs, integrationBuilderSessions]) await s.deleteMany({});
  await orgs.insert({ _id: 'orgA', name: 'Org A', displayName: 'Org A', createdAt: 'x' } as never);
  // Drop any runtime package a prior test wrote, and reload the registry from disk.
  rmSync(join(dataDir, 'integrations', 'runtime'), { recursive: true, force: true });
  refreshDefinitions();
  await setCredential({ mode: 'oauth', secret: 'tok' });
});

describe('POST /api/v1/integration-builder/chat', () => {
  it('generates a package from a scripted model reply and persists the session', async () => {
    __setTransportForTests(makeFakeTransport({ oneShotText: modelReply('weather-api', 'https://api.weather.example') }));
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');

    const res = await authed('/api/v1/integration-builder/chat', t, { method: 'POST', body: JSON.stringify({ message: 'connect the weather API' }) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(IntegrationBuilderChatResponse.safeParse(body).success).toBe(true);

    const gp = body.generatedPackage as { skillMd?: string; config?: { integrationKey?: string } };
    expect(gp.config?.integrationKey).toBe('weather-api');
    expect(gp.skillMd).toContain('# Weather API');
    expect(body.validationErrors).toEqual([]);

    // Session persisted with both turns; the assistant text has the fenced blocks stripped.
    const session = (await integrationBuilderSessions.get(body.builderSessionId as string)) as { messages?: Array<{ role: string; content: string }> } | null;
    expect(session?.messages?.length).toBe(2);
    const assistant = session?.messages?.find((m) => m.role === 'assistant');
    expect(assistant?.content).not.toContain('```config-json');
    expect(assistant?.content).toContain("Here's what I'm setting up");
  });

  it('unauthenticated chat gets a 401 envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/integration-builder/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'x' }),
    });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});

describe('PUT /api/v1/integration-builder/package (save)', () => {
  it('writes the runtime package, registers it userCreated, and configures the org with credentials', async () => {
    __setTransportForTests(makeFakeTransport({ oneShotText: modelReply('weather-api', 'https://api.weather.example') }));
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');

    const chat = await readJson(await authed('/api/v1/integration-builder/chat', t, { method: 'POST', body: JSON.stringify({ message: 'connect the weather API' }) }));
    const generatedPackage = chat.generatedPackage;

    const saveRes = await authed('/api/v1/integration-builder/package', t, {
      method: 'PUT',
      body: JSON.stringify({ builderSessionId: chat.builderSessionId, generatedPackage, testCredentials: { api_key: 'k-123456' } }),
    });
    expect(saveRes.status).toBe(200);
    const save = await readJson(saveRes);
    expect(IntegrationBuilderSaveResponse.safeParse(save).success).toBe(true);
    expect(save.integrationKey).toBe('weather-api');
    expect(save.saved).toBe(true);
    expect(save.configured).toBe(true);

    // Runtime package on disk + in the registry as userCreated.
    expect(existsSync(join(dataDir, 'integrations', 'runtime', 'weather-api', 'config.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'integrations', 'runtime', 'weather-api', 'SKILL.md'))).toBe(true);
    expect(getDefinition('weather-api')?.userCreated).toBe(true);

    // Org config created (credentials encrypted at rest, never echoed).
    const configs = await integrationConfigs.find({ orgId: 'orgA', integrationKey: 'weather-api' });
    expect(configs.length).toBe(1);
    expect(JSON.stringify(configs[0])).not.toContain('k-123456');
  });

  it('rejects a save whose key collides with a reserved key (4xx envelope)', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const config = {
      integrationKey: 'pipedream',
      displayName: 'Nope', description: 'd', authType: 'api_key', provider: 'X', category: 'test',
      configSchema: [{ key: 'api_key', label: 'K', type: 'password', required: true, secret: true, helpText: 'x' }],
      credentialGuide: '1. x',
      actions: [{ actionName: 'ping', description: 'd', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://api.x.example', path: '/p' } }],
    };
    const res = await authed('/api/v1/integration-builder/package', t, { method: 'PUT', body: JSON.stringify({ generatedPackage: { skillMd: '# x', config } }) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect(existsSync(join(dataDir, 'integrations', 'runtime', 'pipedream'))).toBe(false);
  });
});

describe('GET /api/v1/integration-builder/package (load)', () => {
  it('loads the session for a key, rebuilding it from the saved runtime package when none is live', async () => {
    __setTransportForTests(makeFakeTransport({ oneShotText: modelReply('weather-api', 'https://api.weather.example') }));
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');

    // Generate + save so a runtime package exists.
    const chat = await readJson(await authed('/api/v1/integration-builder/chat', t, { method: 'POST', body: JSON.stringify({ message: 'connect the weather API' }) }));
    await authed('/api/v1/integration-builder/package', t, { method: 'PUT', body: JSON.stringify({ builderSessionId: chat.builderSessionId, generatedPackage: chat.generatedPackage }) });

    const res = await authed('/api/v1/integration-builder/package?integrationKey=weather-api', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(IntegrationBuilderLoadResponse.safeParse(body).success).toBe(true);
    const gp = body.generatedPackage as { config?: { integrationKey?: string } };
    expect(gp.config?.integrationKey).toBe('weather-api');
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it('returns a 404 envelope for an unknown integration key with no session', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const res = await authed('/api/v1/integration-builder/package?integrationKey=nonexistent-key', t);
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});

describe('POST /api/v1/integration-builder/test', () => {
  let mock: Server; let mockPort: number; const reqs: Array<{ url: string; auth?: string }> = [];

  beforeAll(async () => {
    mock = createServer((req: IncomingMessage, res: ServerResponse) => {
      reqs.push({ url: req.url ?? '', auth: req.headers['authorization'] as string | undefined });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, echoedCity: new URL(req.url ?? '', 'http://x').searchParams.get('city') }));
    });
    await new Promise<void>((r) => { mock.listen(0, () => r()); });
    mockPort = (mock.address() as { port: number }).port;
  });
  afterAll(() => { mock.close(); });

  it('executes one action against the supplied credentials and returns the wire shape', async () => {
    reqs.length = 0;
    __setTransportForTests(makeFakeTransport({ oneShotText: modelReply('weather-api', `http://127.0.0.1:${mockPort}`) }));
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');
    const chat = await readJson(await authed('/api/v1/integration-builder/chat', t, { method: 'POST', body: JSON.stringify({ message: 'connect the weather API' }) }));

    const res = await authed('/api/v1/integration-builder/test', t, {
      method: 'POST',
      body: JSON.stringify({ builderSessionId: chat.builderSessionId, actionKey: 'ping', testCredentials: { api_key: 'secret-abc' }, testInput: { city: 'Lisboa' } }),
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(IntegrationBuilderTestResponse.safeParse(body).success).toBe(true);
    expect(body.success).toBe(true);
    expect(body.statusCode).toBe(200);
    expect((body.response as { echoedCity?: string }).echoedCity).toBe('Lisboa');

    // The credential + argument were interpolated into the outbound request.
    expect(reqs[0]?.auth).toBe('Bearer secret-abc');
    expect(reqs[0]?.url).toContain('city=Lisboa');

    // Test credentials are NEVER persisted onto the session.
    const session = (await integrationBuilderSessions.get(chat.builderSessionId as string)) as Record<string, unknown> | null;
    expect(JSON.stringify(session)).not.toContain('secret-abc');
  });

  it('unauthenticated test gets a 401 envelope', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/integration-builder/test`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ builderSessionId: 'x', actionKey: 'ping' }),
    });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});
