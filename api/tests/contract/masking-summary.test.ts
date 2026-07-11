import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, activityLogs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { logActivity } from '../../src/data/activity.js';
import { MaskingSummaryResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * GET /api/v1/registo/masking-summary (FC-408; §17.6) — the caller's OWN anonymisation-audit
 * aggregate: entity classes and counts, never bodies, never the vault. Per-user (auth `user`,
 * NOT admin-gated): scoping is the requester's own userId within their org — another user's
 * events never aggregate in. Every non-2xx validates against the shared error envelope.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, orgId = 'orgA') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'builder', orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const authed = (p: string, t: string) => api(p, { headers: { authorization: `Bearer ${t}` } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

/** Seed an anonymisation-audit row through the SINGLE audit write path (ch09 invariant 3). */
async function seedAudit(userId: string, orgId: string, correlationId: string, classes: Record<string, number>) {
  await logActivity({ userId, username: userId, orgId }, 'anonymisation', 'egress-mask', deps, {
    correlationId,
    classes,
    entityCount: Object.values(classes).reduce((a, b) => a + b, 0),
    payloadHash: 'h',
    nerAvailable: true,
  });
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_masking_summary');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await activityLogs.deleteMany({});
});

describe('GET /api/v1/registo/masking-summary', () => {
  it('aggregates the caller\'s own audited classes; schema-valid; metadata only', async () => {
    await mkUser('u1');
    await seedAudit('u1', 'orgA', 'c1', { nomes: 14, NIF: 3 });
    await seedAudit('u1', 'orgA', 'c2', { nomes: 2 });
    const res = await authed('/api/v1/registo/masking-summary', await tokenFor('u1'));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(MaskingSummaryResponse.safeParse(body).success).toBe(true);
    expect(body).toEqual({ classes: { nomes: 16, NIF: 3 }, entityCount: 19, events: 2 });
  });

  it('zero events -> honest zeros (never invented)', async () => {
    await mkUser('u1');
    const body = await readJson(await authed('/api/v1/registo/masking-summary', await tokenFor('u1')));
    expect(MaskingSummaryResponse.safeParse(body).success).toBe(true);
    expect(body).toEqual({ classes: {}, entityCount: 0, events: 0 });
  });

  it("scoped to the requester: another user's events never aggregate in", async () => {
    await mkUser('u1'); await mkUser('u2');
    await seedAudit('u2', 'orgA', 'c9', { IBAN: 5 });
    const body = await readJson(await authed('/api/v1/registo/masking-summary', await tokenFor('u1')));
    expect(body).toEqual({ classes: {}, entityCount: 0, events: 0 });
  });

  it('a builder (non-admin) CAN read it, unlike the admin-gated registo list', async () => {
    await mkUser('u1');
    const t = await tokenFor('u1');
    expect((await authed('/api/v1/registo/masking-summary', t)).status).toBe(200);
    const listRes = await authed('/api/v1/registo', t);
    expect(listRes.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(listRes)).success).toBe(true);
  });

  it('unauthenticated -> 401 envelope', async () => {
    const res = await api('/api/v1/registo/masking-summary');
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('maskedCountsForCorrelations joins on the nested metadata.correlationId ($in, real mongo)', async () => {
    const { maskedCountsForCorrelations } = await import('../../src/services/platform-crud.js');
    await mkUser('u1');
    await seedAudit('u1', 'orgA', 'c1', { nomes: 14, NIF: 3 });
    await seedAudit('u1', 'orgA', 'c2', { nomes: 1 });
    await seedAudit('u1', 'orgB', 'c1', { IBAN: 9 }); // other org, same correlation id: never joins
    expect(await maskedCountsForCorrelations('orgA', ['c1'])).toEqual({ nomes: 14, NIF: 3 });
    expect(await maskedCountsForCorrelations('orgA', ['c1', 'c2'])).toEqual({ nomes: 15, NIF: 3 });
    expect(await maskedCountsForCorrelations('orgA', [])).toEqual({});
  });
});
