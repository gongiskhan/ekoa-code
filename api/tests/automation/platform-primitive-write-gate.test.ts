import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs, approvedIntegrationActions, users } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import { executeRecipe, EkoaActionFailure, type EkoaActionContext, type PlatformPrimitive } from '../../src/automation/platform-primitives.js';
import { setPlatformIntegrationCaller, __resetAutomationSeamsForTests } from '../../src/automation/seams.js';
import { callPlatformIntegration } from '../../src/integrations/platform-call.js';
import { connectPlatform, completeCallback, type PlatformHttp, type PlatformOAuthEnv, type OAuthDeps } from '../../src/integrations/platform-oauth.js';
import { resolveDefinition } from '../../src/integrations/definition-registry.js';
import { approveAction, describeAction } from '../../src/integrations/action-consent.js';

/**
 * THE ARTIFACT RECIPE RAIL - `integration.call` on a platform integration.
 *
 * An Ekoa-built artifact's capability recipe can name any action of any integration. On the two
 * platform packages that short-circuited to `callPlatformIntegration`, which had no write gate at
 * all: an artifact could send mail from the org's mailbox with nobody asked.
 *
 * Driven through the REAL seam body the composition root binds (the lambda below is server.ts's,
 * verbatim in the part that matters), not through a stub that would prove only that a stub was
 * called. The last describe pins the composition root's own source so a future edit cannot quietly
 * stop forwarding the acting user - which would silently turn every platform write on this rail
 * into an unapprovable refusal, or (dropping the code instead) hide the refusal from the engine.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ORG = 'orgPrim';
const OWNER = 'u-artifact-owner';

let mem: MongoMemoryServer;
let seq = 0;
let clock = 1_700_000_000_000;

const env: PlatformOAuthEnv = {
  google: { clientId: 'gid', clientSecret: 'gsecret', redirectBaseUrl: 'https://app.example' },
  microsoft: { clientId: 'mid', clientSecret: 'msecret', redirectBaseUrl: 'https://app.example', tenantId: 'common' },
};

function jsonRes(status: number, obj: unknown) {
  return {
    ok: status >= 200 && status < 300, status,
    json: async () => obj, text: async () => JSON.stringify(obj),
    headers: { forEach: () => undefined }, statusText: '',
  } as unknown as Response;
}
function makeHttp(): { http: PlatformHttp; calls: string[] } {
  const calls: string[] = [];
  const http: PlatformHttp = async (url) => {
    calls.push(url);
    if (url.includes('oauth2.googleapis.com/token')) return jsonRes(200, { access_token: 'atk-1', refresh_token: 'rtk-1', token_type: 'Bearer', expires_in: 3600, scope: 's' });
    if (url.includes('googleapis.com/oauth2/v2/userinfo')) return jsonRes(200, { email: 'user@acme.pt' });
    return jsonRes(200, { ok: true });
  };
  return { http, calls };
}
const depsWith = (http: PlatformHttp): OAuthDeps => ({ now: () => clock, genId: () => `id_${seq++}`, http, env });

let providerCalls: string[] = [];

/** The composition root's platform seam body: resolve the caller's org, forward the acting user. */
function wireProductionSeam(): void {
  setPlatformIntegrationCaller(async (call, pactor) => {
    const owner = (await users.get(pactor.userId)) as { orgId?: string } | null;
    if (!owner?.orgId) return { success: false, error: 'platform integration unavailable: the calling user has no organisation' };
    const { http, calls } = makeHttp();
    const r = await callPlatformIntegration(
      { orgId: owner.orgId, integrationKey: call.integrationKey, actionName: call.actionName, args: call.args, actingUserId: pactor.userId },
      depsWith(http),
    );
    providerCalls.push(...calls.filter((u) => u.includes('gmail.googleapis.com')));
    return { success: r.success, data: r.data, error: r.error, details: r.code };
  });
}

const ctx = (): EkoaActionContext => ({
  userId: OWNER, orgId: ORG, artifactId: 'art-1', inputs: {}, captured: {}, trace: [],
});

const callPrimitive = (actionName: string, args: Record<string, unknown> = {}): PlatformPrimitive[] => [
  { op: 'integration.call', integrationKey: 'google-workspace', actionName, args, returnAs: 'out' },
];

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  delete process.env.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_primitive_write_gate');
}, 60_000);
afterAll(async () => { await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  clock = 1_700_000_000_000;
  providerCalls = [];
  for (const s of [integrationConfigs, approvedIntegrationActions, users]) await s.deleteMany({});
  await users.insert({ _id: OWNER, username: OWNER, orgId: ORG, role: 'user', active: true } as never);
  wireProductionSeam();
  const { http } = makeHttp();
  const connect = await connectPlatform({ userId: OWNER, orgId: ORG, username: OWNER }, 'google', depsWith(http));
  if (!connect.ok) throw new Error('connect failed');
  await completeCallback('google', { code: 'c', state: connect.state }, depsWith(http));
});
afterEach(() => { __resetAutomationSeamsForTests(); });

describe('artifact recipe rail - integration.call', () => {
  it('REFUSES an unapproved send_email and the recipe fails loudly', async () => {
    await expect(executeRecipe(callPrimitive('send_email', { raw: 'x' }), ctx())).rejects.toBeInstanceOf(EkoaActionFailure);
    expect(providerCalls).toEqual([]);
  });

  it('runs the write once the artifact owner has approved that action', async () => {
    const def = await resolveDefinition({ userId: OWNER, orgId: ORG, role: 'user' }, 'google-workspace');
    const action = def!.actions.find((a) => a.actionName === 'send_email')!;
    await approveAction({ orgId: ORG, userId: OWNER }, describeAction('google-workspace', action), 'always');

    const c = ctx();
    await executeRecipe(callPrimitive('send_email', { raw: 'x' }), c);
    expect(providerCalls.length).toBe(1);
    expect(c.trace.at(-1)?.status).toBe('ok');
  });

  it('a READ primitive auto-runs (Rule 7 - existing recipes untouched)', async () => {
    const c = ctx();
    await executeRecipe(callPrimitive('list_emails'), c);
    expect(providerCalls.length).toBe(1);
    expect(c.captured.out).toBeDefined();
  });
});

describe('the composition root forwards what the gate needs', () => {
  const serverSrc = readFileSync(resolve(HERE, '../../src/server.ts'), 'utf8');
  const platformSeam = serverSrc.slice(serverSrc.indexOf('setPlatformIntegrationCaller('));

  it('the platform seam forwards the acting user, so an approval is findable', () => {
    expect(platformSeam.slice(0, 1400)).toContain('actingUserId: pactor.userId');
  });

  it('the platform seam forwards the CODE, so the engine can tell a refusal from a failure', () => {
    expect(platformSeam.slice(0, 1400)).toContain('details: r.code');
  });

  it('the LISTENER binding forwards NO acting user - an unattended poll cannot ride an approval', () => {
    const listener = serverSrc.slice(serverSrc.indexOf('callPlatform: (trigger, call)'));
    expect(listener.slice(0, 600)).toContain('orgId: trigger.orgId');
    expect(listener.slice(0, 600)).not.toContain('actingUserId');
  });

  it('the gate cannot migrate to the composition root', () => {
    // C2 pinned the same property for its own rail: a gate a caller performs is a gate a new
    // caller forgets. The only `checkActionConsent` on this rail is inside platform-call.ts.
    expect(serverSrc).not.toContain('checkActionConsent');
    expect(serverSrc).not.toContain('platformActionRequiresConsent');
    const platformCallSrc = readFileSync(resolve(HERE, '../../src/integrations/platform-call.ts'), 'utf8');
    expect(platformCallSrc.match(/await checkActionConsent\(/g)?.length).toBe(1);
  });
});
