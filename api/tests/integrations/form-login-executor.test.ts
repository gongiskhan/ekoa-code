/**
 * The `form-login` action BACKING, end to end through `executeUserIntegrationAction`: a package
 * declares a `form-login` action with a stored username/password, the executor decrypts the
 * credentials, runs the login against the (mock) portal over the injected manual transport, and
 * returns the authenticated page. Proves the wiring (definitions.resolveBackingType branch +
 * executor dispatch) on top of the runner's own suite (form-login.test.ts), with NO real account.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { createConfig } from '../../src/integrations/service.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import { executeUserIntegrationAction } from '../../src/integrations/action-executor.js';
import type { ManualFetch } from '../../src/integrations/form-login.js';
// @ts-expect-error - JS mock helper, no d.ts
import { startMockCitius } from '../helpers/mock-citius-webforms-server.mjs';

const KEY = 'formloginco';
let mem: MongoMemoryServer;
let mock: Awaited<ReturnType<typeof startMockCitius>>;
let fixtureRoot: string;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = (userId: string) => ({ userId, orgId: 'orgA', role: 'user' } as const);

// Loopback manual transport (redirect:'manual') to reach the in-process mock; the executor / runner
// still assert the origin binding before every call, so this cannot leave the bound hosts.
const loopback: ManualFetch = (url, opts) =>
  fetch(url, { method: opts.method, headers: opts.headers, body: opts.body, redirect: 'manual' });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = ['test', 'encryption', 'key', '32', 'characters'].join('-');
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mock = await startMockCitius();
  fixtureRoot = mkdtempSync(join(tmpdir(), 'ekoa-formlogin-'));
  mkdirSync(join(fixtureRoot, KEY), { recursive: true });
  writeFileSync(
    join(fixtureRoot, KEY, 'config.json'),
    JSON.stringify({
      version: '1.0',
      integrationKey: KEY,
      displayName: 'Form Login Co',
      authType: 'api_key',
      configSchema: [
        { key: 'login_username', label: 'Utilizador', type: 'string', required: true, secret: true },
        { key: 'login_password', label: 'Palavra-passe', type: 'password', required: false, secret: true },
      ],
      actions: [
        {
          actionName: 'ler_caixa',
          description: 'Lê a caixa por autenticação HTTP com credenciais guardadas.',
          mutates: false,
          backingType: 'form-login',
          formLogin: {
            loginUrl: `${mock.baseUrl}/habilus/myhabilus/login.aspx`,
            usernameField: 'ctl00$cph$txtUserName',
            passwordField: 'ctl00$cph$txtUserPass',
            usernameConfigKey: 'login_username',
            passwordConfigKey: 'login_password',
            submitField: 'ctl00$cph$ImBtnLogin',
            submitKind: 'image',
            successUrlContains: 'CaixaCorreio.aspx',
            targetUrl: `${mock.baseUrl}/habilus/myhabilus/CaixaCorreio.aspx`,
            targetLoginRedirectContains: 'login.aspx',
          },
          argsSchema: { type: 'object', properties: {}, required: [] },
        },
      ],
    }),
    'utf-8',
  );
  process.env.EKOA_INTEGRATIONS_DIR = fixtureRoot;
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_form_login');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  await mock.close();
  delete process.env.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  await integrationConfigs.deleteMany({});
});

describe('form-login action backing (executeUserIntegrationAction)', () => {
  it('logs in with the stored credentials and returns the authenticated page', async () => {
    mock.scenario({ cmd: 'reset' });
    mock.scenario({ cmd: 'addItems', count: 2 });
    await createConfig(
      actor('u1'),
      { integrationKey: KEY, configValues: { login_username: '51934', login_password: 'demo-passphrase' } },
      deps,
    );
    const res = await executeUserIntegrationAction(
      { orgId: 'orgA', ownerUserId: 'u1', integrationKey: KEY, actionName: 'ler_caixa', args: {} },
      { formLoginManualFetch: loopback },
    );
    expect(res.success).toBe(true);
    const data = res.data as Record<string, unknown>;
    expect(data.authenticated).toBe(true);
    expect(data.loginStatus).toBe('authenticated');
    expect(data.targetStatus).toBe(200);
    expect(String(data.htmlPreview)).toMatch(/Processo/i);
    // The password never rode back to the caller.
    expect(JSON.stringify(res)).not.toContain('demo-passphrase');
  });

  it('refuses with not_connected when the stored credentials are blank', async () => {
    mock.scenario({ cmd: 'reset' });
    await createConfig(
      actor('u1'),
      { integrationKey: KEY, configValues: { login_username: '51934', login_password: '' } },
      deps,
    );
    const res = await executeUserIntegrationAction(
      { orgId: 'orgA', ownerUserId: 'u1', integrationKey: KEY, actionName: 'ler_caixa', args: {} },
      { formLoginManualFetch: loopback },
    );
    expect(res.success).toBe(false);
    expect(res.code).toBe('not_connected');
  });
});
