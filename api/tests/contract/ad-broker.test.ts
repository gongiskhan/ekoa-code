import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { AdSearchResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * S1 contract: POST /api/v1/ad-broker/search — the machine-to-machine Meta Ad Library broker.
 * Bootstrap mirrors mount-coverage (mongo-mem + buildApp + listen(0)); auth is the x-api-key
 * config singleton, so the key is set in process.env before loadConfig and the fail-closed case
 * deletes it + resets config within a single isolated test. Every non-2xx body validates against
 * the shared ErrorEnvelope; every 200 against AdSearchResponse.
 */
const KEY = 'brk-secret';
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const URL = () => `http://127.0.0.1:${port}/api/v1/ad-broker/search`;
const search = (body: unknown, headers: Record<string, string> = { 'x-api-key': KEY }) =>
  fetch(URL(), { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; process.env.AD_BROKER_API_KEY = KEY;
  __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_ad_broker');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  server.close(); await closeMongo(); await mem.stop();
  delete process.env.AD_BROKER_API_KEY; __resetConfigForTests();
});

describe('auth (x-api-key, fail-closed)', () => {
  it('401 with a valid-envelope body when no key is sent', async () => {
    const res = await search({ searchTerms: 'shoes', countryCode: 'US' }, {});
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
  });

  it('401 when the key is wrong', async () => {
    const res = await search({ searchTerms: 'shoes', countryCode: 'US' }, { 'x-api-key': 'not-the-key' });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
  });

  it('401 fail-closed when AD_BROKER_API_KEY is unset (even with the previously-valid header)', async () => {
    const saved = process.env.AD_BROKER_API_KEY;
    try {
      delete process.env.AD_BROKER_API_KEY;
      __resetConfigForTests();
      const res = await search({ searchTerms: 'shoes', countryCode: 'US' }, { 'x-api-key': KEY });
      expect(res.status).toBe(401);
      expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    } finally {
      process.env.AD_BROKER_API_KEY = saved;
      __resetConfigForTests(); loadConfig();
    }
  });
});

describe('request validation (400 VALIDATION_FAILED)', () => {
  /** A body-schema (zod) failure: VALIDATION_FAILED envelope carrying `{issues}`. */
  const expectZod400 = async (body: unknown) => {
    const res = await search(body);
    expect(res.status).toBe(400);
    const parsed = await res.json();
    expect(ErrorEnvelope.safeParse(parsed).success).toBe(true);
    const env = parsed as { error: { code: string; details?: { issues?: unknown[] } } };
    expect(env.error.code).toBe('VALIDATION_FAILED');
    expect(Array.isArray(env.error.details?.issues)).toBe(true); // zod issues surface as details
  };
  /** A service-level cursor failure: same 400/VALIDATION_FAILED envelope, but no zod `issues`. */
  const expectCursor400 = async (body: unknown) => {
    const res = await search(body);
    expect(res.status).toBe(400);
    const parsed = await res.json();
    expect(ErrorEnvelope.safeParse(parsed).success).toBe(true);
    expect((parsed as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  };

  it('rejects BOTH searchTerms and advertiserName', async () => {
    await expectZod400({ searchTerms: 'shoes', advertiserName: 'Nike', countryCode: 'US' });
  });
  it('rejects NEITHER searchTerms nor advertiserName', async () => {
    await expectZod400({ countryCode: 'US' });
  });
  it('rejects a malformed countryCode', async () => {
    await expectZod400({ searchTerms: 'shoes', countryCode: 'usa' });
  });
  it('rejects dateFrom after dateTo', async () => {
    await expectZod400({ searchTerms: 'shoes', countryCode: 'US', dateFrom: '2024-06-01', dateTo: '2024-01-01' });
  });
  it('rejects a malformed cursor (not base64url JSON) — decoded in the service', async () => {
    const junk = Buffer.from('hello-not-json', 'utf8').toString('base64url');
    await expectCursor400({ searchTerms: 'shoes', countryCode: 'US', cursor: junk });
  });
  it('rejects a FOREIGN cursor (minted for a different query) — h-binding', async () => {
    const first = await (await search({ searchTerms: 'shoes', countryCode: 'US', pageSize: 10 })).json() as { nextCursor: string };
    expect(typeof first.nextCursor).toBe('string');
    // Same-shaped, valid cursor, but a DIFFERENT query → hash mismatch → 400.
    await expectCursor400({ searchTerms: 'cars', countryCode: 'US', pageSize: 10, cursor: first.nextCursor });
  });
});

describe('search results (200, AdSearchResponse)', () => {
  it('200 body validates against the shared schema and respects pageSize', async () => {
    const res = await search({ searchTerms: 'sapatos', countryCode: 'PT', pageSize: 15 });
    expect(res.status).toBe(200);
    const body = await res.json();
    const parsed = AdSearchResponse.safeParse(body);
    expect(parsed.success).toBe(true);
    const page = body as { records: unknown[]; nextCursor: string | null };
    expect(page.records.length).toBeLessThanOrEqual(15);
    expect(page.records.length).toBeGreaterThan(0);
  });

  it('a full cursor walk terminates (nextCursor null) with unique ids and a bounded total', async () => {
    const req = { advertiserName: 'Atlas Retail', countryCode: 'US', pageSize: 25 };
    const ids: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: Response = await search(cursor ? { ...req, cursor } : req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(AdSearchResponse.safeParse(body).success).toBe(true);
      const page = body as { records: { id: string }[]; nextCursor: string | null };
      expect(page.records.length).toBeLessThanOrEqual(25);
      for (const r of page.records) ids.push(r.id);
      cursor = page.nextCursor;
      pages++;
      expect(pages).toBeLessThan(100); // guard against a non-terminating walk
    } while (cursor !== null);

    expect(new Set(ids).size).toBe(ids.length); // all ids unique across the walk
    expect(ids.length).toBeGreaterThanOrEqual(20); // total is 20..250 by construction
    expect(ids.length).toBeLessThanOrEqual(250);
  });

  it('the SAME cursor twice returns a deep-equal page (retry idempotency)', async () => {
    const req = { searchTerms: 'promoção', countryCode: 'PT', pageSize: 20 };
    const first = await (await search(req)).json() as { nextCursor: string };
    expect(typeof first.nextCursor).toBe('string');

    const again = { ...req, cursor: first.nextCursor };
    const a = await (await search(again)).json();
    const b = await (await search(again)).json();
    expect(a).toEqual(b);
    expect(AdSearchResponse.safeParse(a).success).toBe(true);
  });
});
