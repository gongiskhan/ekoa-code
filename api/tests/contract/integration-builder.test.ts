import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, billingAccounts, tokenEvents, integrationConfigs, integrationBuilderSessions, integrationDefinitions } from '../../src/data/stores.js';
import { definitionIdFor, type IntegrationDefinitionDoc } from '../../src/integrations/definition-store.js';
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
 * the shared schemas, with a fake chokepoint transport scripting the model's two fenced blocks.
 * A3: saves land in the tenant-scoped Mongo definition store (private-by-default); EKOA_DATA_DIR is
 * still isolated so the suite can PROVE the retired disk runtime tier stays untouched. The test
 * route runs against an ephemeral local HTTP server (no live call).
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

async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'user', orgId = 'orgA') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
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
  for (const s of [users, orgs, billingAccounts, tokenEvents, integrationConfigs, integrationBuilderSessions, integrationDefinitions]) await s.deleteMany({});
  await orgs.insert({ _id: 'orgA', name: 'Org A', displayName: 'Org A', createdAt: 'x' } as never);
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

  // D2 parity: the chat turn now runs on the shared authoring core (agents/integration-agent.ts),
  // which classifies an outage / an empty reply / an abort as TYPED outcomes. These two cases pin
  // the builder's mapping of them at the WIRE, because that mapping is what the merge could have
  // silently changed (the planner's opposite policy sits behind the same core).
  it('an egress OUTAGE on the chat turn is a 500 error envelope, not a partial 200', async () => {
    __setTransportForTests(makeFakeTransport({ oneShotThrow: 'error' }));
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');

    const res = await authed('/api/v1/integration-builder/chat', t, { method: 'POST', body: JSON.stringify({ message: 'connect something' }) });
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body.error as { code: string }).code).toBe('INTERNAL');
  });

  it('an EMPTY model reply is an ordinary package-less turn: 200, no package, no validation errors', async () => {
    __setTransportForTests(makeFakeTransport({ oneShotText: '' }));
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');

    const res = await authed('/api/v1/integration-builder/chat', t, { method: 'POST', body: JSON.stringify({ message: 'olá' }) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(IntegrationBuilderChatResponse.safeParse(body).success).toBe(true);
    expect(body.generatedPackage).toEqual({});
    expect(body.validationErrors).toEqual([]);
    // …and the turn is still persisted (an empty assistant message), as it always was.
    const session = (await integrationBuilderSessions.get(body.builderSessionId as string)) as { messages?: Array<{ role: string }> } | null;
    expect(session?.messages?.length).toBe(2);
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
  it('saves the package as the actor\'s OWN Mongo definition, PRIVATE by default, and configures the org with credentials (A3)', async () => {
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

    // The definition landed in the tenant-scoped store, stamped from the VERIFIED ACTOR (never a
    // body field), private-by-default, with authored provenance.
    const row = (await integrationDefinitions.get(definitionIdFor('orgA', 'weather-api'))) as IntegrationDefinitionDoc | null;
    expect(row).toBeTruthy();
    expect(row!.orgId).toBe('orgA');
    expect(row!.userId).toBe('admin');
    expect(row!.visibility).toBe('private');
    expect(row!.origin?.kind).toBe('authored');
    expect(row!.skillMd).toContain('# Weather API');

    // NOTHING touched the retired disk runtime tier, and the process-wide sync cache never sees
    // the tenant definition (the leak surface A3 closed).
    expect(existsSync(join(dataDir, 'integrations', 'runtime'))).toBe(false);
    expect(getDefinition('weather-api')).toBeNull();

    // The saving user resolves their definition through the tenant-scoped list route…
    const mine = (await readJson(await authed('/api/v1/integrations', t))) as { items?: Array<{ key: string }> };
    expect((mine.items ?? []).some((d) => d.key === 'weather-api')).toBe(true);
    // …and ANOTHER ORG's user does not (isolation, memvault class).
    await mkUser('outsider', 'user', 'orgB');
    const theirs = (await readJson(await authed('/api/v1/integrations', await tokenFor('outsider')))) as { items?: Array<{ key: string }> };
    expect((theirs.items ?? []).some((d) => d.key === 'weather-api')).toBe(false);

    // Org config created (credentials encrypted at rest, never echoed).
    const configs = await integrationConfigs.find({ orgId: 'orgA', integrationKey: 'weather-api' });
    expect(configs.length).toBe(1);
    expect(JSON.stringify(configs[0])).not.toContain('k-123456');
  });

  it('rejects a save whose key collides with a reserved key (4xx envelope), writing NOTHING', async () => {
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
    expect(await integrationDefinitions.get(definitionIdFor('orgA', 'pipedream'))).toBeNull();
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

  it('an edit cycle preserves the stored SKILL.md BYTE-EXACTLY — the egress scrub never round-trips (A3 review F3)', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');

    // Legitimate documentation that the PROMPT-egress scrub redacts ("authorization: required" —
    // the reviewer's probe). Before the fix, GET seeded the session from the SCRUBBED view and one
    // ordinary save wrote "authorization: [REDACTED]" over the tenant's real text, permanently.
    const legit = '# notes\nauthorization: required\nSee docs.\n';
    const iso = new Date().toISOString();
    await integrationDefinitions.insert({
      _id: definitionIdFor('orgA', 'my-notes'),
      orgId: 'orgA', userId: 'admin', visibility: 'private', key: 'my-notes',
      displayName: 'My Notes', description: 'd', authType: 'api_key', provider: 'X', category: 'test',
      configSchema: [{ key: 'api_key', label: 'K', type: 'password', required: true, secret: true }],
      credentialGuide: '1. x',
      actions: [{ actionName: 'ping', description: 'd', mutates: false, httpConfig: { method: 'GET', baseUrl: 'https://api.x.example', path: '/p' } }],
      skillMd: legit, origin: { kind: 'authored' }, createdAt: iso, updatedAt: iso,
    } as never);

    // LOAD: the editable body is the RAW stored body, not the scrubbed egress view.
    const load = await readJson(await authed('/api/v1/integration-builder/package?integrationKey=my-notes', t));
    const gp = load.generatedPackage as { skillMd?: string };
    expect(gp.skillMd).toBe(legit);

    // SAVE the session back unchanged (the ordinary edit cycle) — the stored bytes must survive.
    const save = await authed('/api/v1/integration-builder/package', t, {
      method: 'PUT', body: JSON.stringify({ builderSessionId: load.builderSessionId }),
    });
    expect(save.status).toBe(200);
    const row = (await integrationDefinitions.get(definitionIdFor('orgA', 'my-notes'))) as IntegrationDefinitionDoc;
    expect(row.skillMd).toBe(legit);
    expect(row.skillMd).not.toContain('[REDACTED]');
  });

  it('an edit cycle preserves a real pasted CREDENTIAL in an action header byte-exactly (the config half of the A3 F3 round trip)', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');

    // A genuine pasted credential — the shape a tenant hardcodes instead of using {{api_key}}.
    // Composed at runtime so no credential-shaped literal is ever committed.
    const planted = `Bearer ${['sk', 'live', ['9aXbZ', 'Q1r2s3t4u5v6'].join('')].join('_')}`;
    const iso = new Date().toISOString();
    await integrationDefinitions.insert({
      _id: definitionIdFor('orgA', 'my-crm'),
      orgId: 'orgA', userId: 'admin', visibility: 'private', key: 'my-crm',
      displayName: 'My CRM', description: 'd', authType: 'api_key', provider: 'X', category: 'test',
      configSchema: [{ key: 'api_key', label: 'K', type: 'password', required: true, secret: true }],
      credentialGuide: '1. x',
      actions: [{
        actionName: 'ping', description: 'd', mutates: false,
        httpConfig: { method: 'GET', baseUrl: 'https://api.x.example', path: '/p', headers: { Authorization: planted } },
      }],
      skillMd: '# crm\n', origin: { kind: 'authored' }, createdAt: iso, updatedAt: iso,
    } as never);

    // LOAD: the editable config is the RAW stored config for a row of the actor's own org — the
    // redacted read view here would be written back by the save below.
    const load = await readJson(await authed('/api/v1/integration-builder/package?integrationKey=my-crm', t));
    const header = (load.generatedPackage as { config?: { actions?: Array<{ httpConfig?: { headers?: Record<string, string> } }> } })
      .config?.actions?.[0]?.httpConfig?.headers?.Authorization;
    expect(header).toBe(planted);
    expect(header).not.toContain('[REDACTED]');

    // SAVE the session back unchanged (the ordinary edit cycle) — the stored credential survives,
    // so the action executor keeps sending the real header instead of the literal "[REDACTED]".
    const save = await authed('/api/v1/integration-builder/package', t, {
      method: 'PUT', body: JSON.stringify({ builderSessionId: load.builderSessionId }),
    });
    expect(save.status).toBe(200);
    const row = (await integrationDefinitions.get(definitionIdFor('orgA', 'my-crm'))) as IntegrationDefinitionDoc;
    const stored = (row.actions[0] as { httpConfig?: { headers?: Record<string, string> } }).httpConfig?.headers?.Authorization;
    expect(stored).toBe(planted);
    expect(JSON.stringify(row.actions)).not.toContain('[REDACTED]');
  });

  it('a FOREIGN org\'s global row still loads SCRUBBED — the raw view is own-org only', async () => {
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');

    const foreign = `Bearer ${['sk', 'live', ['7bYcW', 'M8n9o0p1q2r3'].join('')].join('_')}`;
    const iso = new Date().toISOString();
    await orgs.insert({ _id: 'orgB', name: 'Org B', displayName: 'Org B', createdAt: 'x' } as never);
    await integrationDefinitions.insert({
      _id: definitionIdFor('orgB', 'shared-thing'),
      orgId: 'orgB', userId: 'other', visibility: 'global', key: 'shared-thing',
      displayName: 'Shared Thing', description: 'd', authType: 'api_key', provider: 'X', category: 'test',
      configSchema: [{ key: 'api_key', label: 'K', type: 'password', required: true, secret: true }],
      credentialGuide: '1. x',
      actions: [{
        actionName: 'ping', description: 'd', mutates: false,
        httpConfig: { method: 'GET', baseUrl: 'https://api.y.example', path: '/p', headers: { Authorization: foreign } },
      }],
      skillMd: '# shared\n', origin: { kind: 'authored' }, createdAt: iso, updatedAt: iso,
    } as never);

    const load = await readJson(await authed('/api/v1/integration-builder/package?integrationKey=shared-thing', t));
    const gp = load.generatedPackage as { config?: { actions?: Array<{ httpConfig?: { headers?: Record<string, string> } }> } };
    expect(gp.config?.actions?.[0]?.httpConfig?.headers?.Authorization).toBe('[REDACTED]');
    // The foreign author's credential never reaches the reader: a foreign row is a FORK source, so
    // no round trip can destroy the original and the scrub costs nothing.
    expect(JSON.stringify(load)).not.toContain(foreign);
  });
});

/**
 * D2 re-review HIGH-1 — THE RAW EDITABLE VIEW IS EXACTLY THE SAVE PATH'S ADMISSION SET.
 *
 * D2 gated the raw (byte-exact, unscrubbed) projection on `doc.orgId === actor.orgId`, which is
 * strictly WIDER than what `PUT /package` accepts. The cross-org case above was pinned; the two
 * INTRA-tenant cases were not, and both were plaintext-credential reads by a principal with no
 * write reach at all (both answered `[REDACTED]` before D2):
 *   - a plain `user` peer over a peer's `org`-shared row  → PUT 403 `key_taken`;
 *   - ANY reader of an own-org `global` row, author incl. → PUT 403 `published_row`.
 * The positive case (an org-admin over the same peer row: RAW + PUT 200) is pinned alongside them
 * so the gate is the SAVE SET and not merely "narrower than before".
 *
 * Non-tautology: the credential is really in the stored row (asserted from Mongo), the reader
 * really resolves the row (the load is 200 with the row's own displayName, not a 404), and the
 * refusal really writes nothing (the stored bytes are re-read after the PUT).
 */
describe('GET /package raw projection == the PUT admission set (D2 re-review HIGH-1)', () => {
  /** A peer-authored row carrying a pasted credential in an action header AND in its SKILL.md.
   *  Composed at runtime so no credential-shaped literal is ever committed. */
  async function plantRow(key: string, opts: { userId: string; visibility: 'private' | 'org' | 'global' }) {
    const secret = `Bearer ${['sk', 'live', [key.replace(/-/g, ''), 'K4m5N6p7Q8r9'].join('')].join('_')}`;
    const iso = new Date().toISOString();
    await integrationDefinitions.insert({
      _id: definitionIdFor('orgA', key),
      orgId: 'orgA', userId: opts.userId, visibility: opts.visibility, key,
      displayName: `Row ${key}`, description: 'd', authType: 'api_key', provider: 'X', category: 'test',
      configSchema: [{ key: 'api_key', label: 'K', type: 'password', required: true, secret: true }],
      credentialGuide: '1. x',
      actions: [{
        actionName: 'ping', description: 'd', mutates: false,
        httpConfig: { method: 'GET', baseUrl: 'https://api.x.example', path: '/p', headers: { Authorization: secret } },
      }],
      skillMd: `# ${key}\nauthorization: ${secret}\n`,
      origin: { kind: 'authored' }, createdAt: iso, updatedAt: iso,
    } as never);
    return secret;
  }

  const headerOf = (load: Record<string, unknown>): string | undefined =>
    (load.generatedPackage as { config?: { actions?: Array<{ httpConfig?: { headers?: Record<string, string> } }> } })
      .config?.actions?.[0]?.httpConfig?.headers?.Authorization;

  const storedHeaderOf = async (key: string): Promise<string | undefined> => {
    const row = (await integrationDefinitions.get(definitionIdFor('orgA', key))) as IntegrationDefinitionDoc;
    return (row.actions[0] as { httpConfig?: { headers?: Record<string, string> } }).httpConfig?.headers?.Authorization;
  };

  it("a plain USER peer reading a peer's org-shared row gets SCRUBBED — the save answers 403 for them", async () => {
    await mkUser('author', 'user');
    await mkUser('peer', 'user');
    const secret = await plantRow('peer-shared', { userId: 'author', visibility: 'org' });
    expect(await storedHeaderOf('peer-shared')).toBe(secret); // the credential really is stored

    const t = await tokenFor('peer');
    const load = await readJson(await authed('/api/v1/integration-builder/package?integrationKey=peer-shared', t));
    // The peer DOES resolve the row (org-shared is visible to them) — this is not a 404 passing
    // for a scrub.
    expect((load.generatedPackage as { config?: { displayName?: string } }).config?.displayName).toBe('Row peer-shared');
    expect(headerOf(load)).toBe('[REDACTED]');
    // …and the skillMd half of the same package (resolveSkillMdRaw) is scrubbed too — A3's fix
    // closed only the cross-org half of this predicate.
    expect((load.generatedPackage as { skillMd?: string }).skillMd).not.toContain(secret);
    expect(JSON.stringify(load)).not.toContain(secret);

    // The reason it must be scrubbed: this principal can never save the row back.
    const save = await authed('/api/v1/integration-builder/package', t, {
      method: 'PUT', body: JSON.stringify({ builderSessionId: load.builderSessionId }),
    });
    expect(save.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(save)).success).toBe(true);
    expect(await storedHeaderOf('peer-shared')).toBe(secret); // the refusal wrote nothing
  });

  it('an own-org GLOBAL row loads SCRUBBED even for its OWN AUTHOR — the save answers 403 published_row', async () => {
    await mkUser('author', 'user');
    const secret = await plantRow('published-thing', { userId: 'author', visibility: 'global' });

    const t = await tokenFor('author');
    const load = await readJson(await authed('/api/v1/integration-builder/package?integrationKey=published-thing', t));
    expect((load.generatedPackage as { config?: { displayName?: string } }).config?.displayName).toBe('Row published-thing');
    expect(headerOf(load)).toBe('[REDACTED]');
    expect((load.generatedPackage as { skillMd?: string }).skillMd).not.toContain(secret);
    expect(JSON.stringify(load)).not.toContain(secret);

    const save = await authed('/api/v1/integration-builder/package', t, {
      method: 'PUT', body: JSON.stringify({ builderSessionId: load.builderSessionId }),
    });
    expect(save.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(save)).success).toBe(true);
    expect(await storedHeaderOf('published-thing')).toBe(secret);
  });

  it("an ORG-ADMIN over the same peer row still gets the RAW package — and the save round-trips it", async () => {
    await mkUser('author', 'user');
    await mkUser('boss', 'org-admin');
    const secret = await plantRow('admin-writable', { userId: 'author', visibility: 'org' });

    const t = await tokenFor('boss');
    const load = await readJson(await authed('/api/v1/integration-builder/package?integrationKey=admin-writable', t));
    expect(headerOf(load)).toBe(secret);
    expect((load.generatedPackage as { skillMd?: string }).skillMd).toContain(secret);

    // The whole reason the raw view exists: this actor's ordinary edit cycle must not write
    // "[REDACTED]" over the tenant's real header.
    const save = await authed('/api/v1/integration-builder/package', t, {
      method: 'PUT', body: JSON.stringify({ builderSessionId: load.builderSessionId }),
    });
    expect(save.status).toBe(200);
    expect(await storedHeaderOf('admin-writable')).toBe(secret);
    const row = (await integrationDefinitions.get(definitionIdFor('orgA', 'admin-writable'))) as IntegrationDefinitionDoc;
    expect(row.skillMd).toContain(secret);
    expect(row.skillMd).not.toContain('[REDACTED]');
  });
});

describe('reserved keys: chat and save agree (A3 review L4)', () => {
  it('the chat NEVER exempts a reserved key — even for a stale session carrying the retired loadedKey field', async () => {
    __setTransportForTests(makeFakeTransport({ oneShotText: modelReply('pipedream', 'https://api.x.example') }));
    await mkUser('admin', 'org-admin');
    const t = await tokenFor('admin');

    // A pre-fix session doc pinning the reserved key as "loaded" — the exact state that used to
    // make the chat present a package the PUT would then refuse with an error.
    await integrationBuilderSessions.insert({
      _id: 'stale-sess', userId: 'admin', orgId: 'orgA', integrationKey: 'pipedream',
      loadedKey: 'pipedream', messages: [], validationErrors: [], createdAt: 'x', updatedAt: 'x',
    } as never);

    const chat = await readJson(await authed('/api/v1/integration-builder/chat', t, {
      method: 'POST', body: JSON.stringify({ message: 'edit pipedream', builderSessionId: 'stale-sess' }),
    }));
    const chatErrors = (chat.validationErrors as Array<{ message: string }>).map((e) => e.message).join('\n');
    expect(chatErrors).toContain('reserved');

    // …and the save for the same session refuses too: one verdict on every surface.
    const save = await authed('/api/v1/integration-builder/package', t, {
      method: 'PUT', body: JSON.stringify({ builderSessionId: 'stale-sess' }),
    });
    expect(save.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(save)).success).toBe(true);
    expect(await integrationDefinitions.get(definitionIdFor('orgA', 'pipedream'))).toBeNull();
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
