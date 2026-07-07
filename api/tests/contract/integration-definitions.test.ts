import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, integrationConfigs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  IntegrationDefinitionListResponse,
  ActiveIntegrationListResponse,
  RefreshRegistryResponse,
  ErrorEnvelope,
} from '@ekoa/shared';

/**
 * G6 S7 gate: the integration DEFINITIONS registry (ch03 §3.8.13 read surface). Proves the
 * three registry routes against the shared contract schemas and asserts the ported CITIUS
 * package exposes exactly the shapes the citius-integration e2e driver checks (portal actions
 * automation-bound + passCredentials, mutates flags, listenerConfig, credential-free public
 * consulta), that `active` joins definitions to org-enabled configs, that definitions never
 * surface configured credential values, and that refresh reloads from disk (org-admin only).
 *
 * The registry reads a FIXTURE copy of api/assets/integrations (EKOA_INTEGRATIONS_DIR) so the
 * refresh test can drop a new package on disk without mutating the real assets tree.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_INTEGRATIONS = join(__dirname, '..', '..', 'assets', 'integrations');

let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number; let fixtureRoot: string;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

type Action = { actionName: string; description?: string; mutates?: boolean; httpConfig?: { method?: string; baseUrl?: string; headers?: Record<string, string> }; automationBinding?: { automationId?: string; passCredentials?: boolean } };
type Def = Record<string, unknown> & { key: string; integrationKey?: string; authType?: string; actions?: Action[]; configSchema?: Array<{ secret?: boolean }>; credentialGuide?: string; listenerConfig?: { pollAction?: string; dedupKeyField?: string; eventArrayField?: string } };
type Active = { key: string; actions?: Array<{ actionName: string }>; listenerEvents?: Array<{ name: string }> };

async function mkUser(id: string, username: string, orgId: string, role: 'super-admin' | 'org-admin' | 'builder') {
  await users.insert({ _id: id, username, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  // Fixture copy of the real versioned packages so refresh can add one on disk in isolation.
  fixtureRoot = mkdtempSync(join(tmpdir(), 'ekoa-intdefs-'));
  cpSync(REAL_INTEGRATIONS, fixtureRoot, { recursive: true });
  process.env.EKOA_INTEGRATIONS_DIR = fixtureRoot;
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_intdefs');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  server.close(); await closeMongo(); await mem.stop();
  delete process.env.EKOA_INTEGRATIONS_DIR;
  rmSync(fixtureRoot, { recursive: true, force: true });
});
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  for (const s of [users, integrationConfigs]) await s.deleteMany({});
});

describe('integration definitions registry (ch03 §3.8.13) — list / active / refresh', () => {
  it('GET /integrations lists the ported packages; CITIUS carries the driver-asserted shapes', async () => {
    await mkUser('u1', 'u1', 'orgA', 'builder');
    const res = await api('/api/v1/integrations', await tokenFor('u1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Def[] };
    expect(IntegrationDefinitionListResponse.safeParse(body).success).toBe(true);

    const citius = body.items.find((d) => d.key === 'citius');
    expect(citius, 'citius definition present').toBeTruthy();
    expect(citius!.integrationKey).toBe('citius');
    // Ported reality: authType is 'browser_session' (session-capture). The retired e2e driver's
    // `=== 'none'` assertion was already stale against this very package (old + new config.json
    // both ship 'browser_session'); grounding the contract in the package, not the stale driver.
    expect(citius!.authType).toBe('browser_session');

    const byName: Record<string, Action> = Object.fromEntries((citius!.actions ?? []).map((a) => [a.actionName, a]));
    // The four portal actions bind to automations and pass the captured session; no httpConfig.
    for (const name of ['consultar_notificacoes', 'consultar_processo', 'fetch_documentos_processo', 'submeter_peca']) {
      const a = byName[name];
      expect(a, `portal action ${name}`).toBeTruthy();
      if (!a) continue;
      expect(typeof a.automationBinding?.automationId).toBe('string');
      expect((a.automationBinding?.automationId ?? '').length).toBeGreaterThan(0);
      expect(a.automationBinding?.passCredentials).toBe(true);
      expect(a.httpConfig).toBeUndefined();
    }
    expect(byName['fetch_documentos_processo']!.automationBinding?.automationId).toBe('citius-documentos-template');
    expect(byName['fetch_documentos_processo']!.mutates).toBe(false);
    expect(byName['submeter_peca']!.mutates).toBe(true);
    expect(byName['consultar_notificacoes']!.mutates).toBe(false);

    // Notification listener: polls consultar_notificacoes, dedups by id over the notificacoes array.
    expect(citius!.listenerConfig?.pollAction).toBe('consultar_notificacoes');
    expect(citius!.listenerConfig?.dedupKeyField).toBe('id');
    expect(citius!.listenerConfig?.eventArrayField).toBe('notificacoes');

    // Credential-free public consulta: httpConfig GET against citius.mj.pt, no session, no auth header.
    const pub = byName['consulta_publica_distribuicao'];
    expect(pub, 'consulta_publica_distribuicao present').toBeTruthy();
    expect(pub!.httpConfig?.method).toBe('GET');
    expect(pub!.automationBinding).toBeUndefined();
    expect(Object.keys(pub!.httpConfig?.headers ?? {}).map((h) => h.toLowerCase())).not.toContain('authorization');
    expect(pub!.httpConfig?.baseUrl ?? '').toMatch(/citius\.mj\.pt/);

    // configSchema holds no secret fields (session captured, not stored); credentialGuide explains it.
    expect((citius!.configSchema ?? []).some((f) => f.secret === true)).toBe(false);
    expect(typeof citius!.credentialGuide).toBe('string');
    expect(citius!.credentialGuide ?? '').toMatch(/sess/i);
  });

  it('GET /integrations/active exposes action + listener catalogs for org-connected integrations only', async () => {
    await mkUser('adm', 'adm', 'orgA', 'org-admin');
    const t = await tokenFor('adm');
    // With no configs yet, nothing is active.
    const empty = (await (await api('/api/v1/integrations/active', t)).json()) as { items: Active[] };
    expect(empty.items).toHaveLength(0);

    // Connect citius (org-admin authors an org-shared config, enabled by default).
    await api('/api/v1/integrations/configs', t, { method: 'POST', body: JSON.stringify({ integrationKey: 'citius', configValues: { cedula_profissional: '12345' } }) });
    const res = await api('/api/v1/integrations/active', t);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Active[] };
    expect(ActiveIntegrationListResponse.safeParse(body).success).toBe(true);

    const citius = body.items.find((e) => e.key === 'citius');
    expect(citius, 'citius is active once connected').toBeTruthy();
    expect((citius!.actions ?? []).map((a) => a.actionName)).toContain('consultar_notificacoes');
    expect((citius!.listenerEvents ?? []).map((e) => e.name)).toContain('notificacao.recebida');
    // A defined-but-unconnected integration (stripe) is NOT active.
    expect(body.items.find((e) => e.key === 'stripe')).toBeFalsy();
  });

  it('definitions never surface configured credential VALUES (registry is not the config store)', async () => {
    await mkUser('u2', 'u2', 'orgA', 'builder');
    const t = await tokenFor('u2');
    await api('/api/v1/integrations/configs', t, { method: 'POST', body: JSON.stringify({ integrationKey: 'stripe', configValues: { apiKey: 'sk-live-SECRETdeadbeef' } }) });
    const text = await (await api('/api/v1/integrations', t)).text();
    expect(text).not.toContain('sk-live-SECRETdeadbeef');
  });

  it('POST /integrations/refresh reloads from disk — org-admin only (builder 403)', async () => {
    await mkUser('adm', 'adm', 'orgA', 'org-admin');
    await mkUser('bld', 'bld', 'orgA', 'builder');

    // Builder is forbidden (ch03 §3.8.13: refresh is org-admin).
    const forb = await api('/api/v1/integrations/refresh', await tokenFor('bld'), { method: 'POST' });
    expect(forb.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await forb.json()).success).toBe(true);

    // Drop a NEW package on disk, with credential-named fields at top level and nested in an action.
    const probeKey = 'temp-refresh-probe';
    const probeDir = join(fixtureRoot, probeKey);
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, 'config.json'), JSON.stringify({
      version: '1.0', skillType: 'integration', integrationKey: probeKey,
      displayName: 'Temp Probe', description: 'x', authType: 'none', provider: 'test', category: 'test',
      configSchema: [],
      actions: [{ actionName: 'probe_action', description: 'p', mutates: false, apiKey: 'nested-secret-redact-me' }],
      apiKey: 'top-level-secret-drop-me',
    }), 'utf-8');

    const t = await tokenFor('adm');
    const res = await api('/api/v1/integrations/refresh', t, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; keys: string[] };
    expect(RefreshRegistryResponse.safeParse(body).success).toBe(true);
    expect(body.keys).toContain(probeKey);
    expect(body.keys).toContain('citius');
    expect(body.count).toBe(body.keys.length);

    // The new package is now listed; both secret-named fields are scrubbed (allowlist + redaction).
    const listed = (await (await api('/api/v1/integrations', t)).json()) as { items: Def[] };
    const probe = listed.items.find((d) => d.key === probeKey);
    expect(probe, 'probe package listed after refresh').toBeTruthy();
    const probeJson = JSON.stringify(probe);
    expect(probeJson).not.toContain('top-level-secret-drop-me');
    expect(probeJson).not.toContain('nested-secret-redact-me');
    expect(((probe!.actions ?? [])[0] as Record<string, unknown>).apiKey).toBe('[REDACTED]');

    rmSync(probeDir, { recursive: true, force: true });
  });
});
