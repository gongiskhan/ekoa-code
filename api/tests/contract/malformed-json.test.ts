import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { ErrorEnvelope } from '@ekoa/shared';

/**
 * F2 adversarial-test finding (2026-07-09): a syntactically MALFORMED JSON body (as opposed to a
 * schema-invalid one) bypassed the CONV-2 error envelope entirely - express.json()'s parse error
 * fell through to Express's default handler, which returned an HTML page carrying the full stack
 * trace and absolute server paths (node_modules/body-parser/...). Pre-auth and app-wide: every
 * JSON route under /api was affected, including /api/v1/auth/login. That is an information leak
 * (FIXED-8 posture) and violates the QA rule that every non-2xx body validates against the shared
 * error envelope.
 *
 * Contract: malformed JSON on any /api route -> 400 with the shared ErrorEnvelope
 * (VALIDATION_FAILED), never HTML, never a stack frame or filesystem path.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_malformed_json');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

const postMalformed = (path: string) =>
  fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"broken":',
  });

describe('malformed JSON bodies return the shared error envelope, never a stack trace', () => {
  for (const path of ['/api/v1/auth/login', '/api/v1/credentials', '/api/v1/users']) {
    it(`POST ${path} with truncated JSON -> 400 ErrorEnvelope, no HTML, no server paths`, async () => {
      const res = await postMalformed(path);
      expect(res.status).toBe(400);
      const text = await res.text();
      // never the Express default HTML error page / stack dump
      expect(text).not.toContain('<!DOCTYPE html>');
      expect(text).not.toContain('node_modules');
      expect(text).not.toContain('at ');
      let body: unknown;
      expect(() => { body = JSON.parse(text); }).not.toThrow();
      expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    });
  }

  it('an oversized JSON body (>1mb limit) also gets an envelope, not an HTML error page', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'a'.repeat(1_100_000), password: 'x' }),
    });
    expect(res.status).toBe(413);
    const text = await res.text();
    expect(text).not.toContain('<!DOCTYPE html>');
    expect(text).not.toContain('node_modules');
    expect(ErrorEnvelope.safeParse(JSON.parse(text)).success).toBe(true);
  });
});

/**
 * THE ARTIFACT BUNDLE ROUTES ARE EXEMPT FROM THE 1 MB GLOBAL PARSER.
 *
 * A real app export does not fit in 1 MB: the production `legal-case-manager-3` bundle is 1.34 MB
 * of source before any app-data dump, and prod's own exporter admits files up to 1.5 MB EACH. Under
 * the global limit `POST /api/v1/artifacts/import` could only ever accept toy bundles and every
 * genuine import answered 413 - found on the first real one (2026-08-06). The exemption is only
 * half the fix: if the global parser consumed the body first, the router's own larger limit would
 * be dead code, which is exactly the trap the LLM gateway hit in run 20260717. So the assertions
 * below are about WHERE the refusal comes from, not just that one happens: an over-1 MB body must
 * get PAST the parser and be refused by auth/validation instead.
 */
describe('artifact bundle routes accept a real-world bundle (>1mb)', () => {
  const bigBundle = () =>
    JSON.stringify({ bundle: { manifestId: 'app', name: 'App', files: [{ path: 'frontend/src/index.jsx', content: 'x'.repeat(1_400_000) }] } });

  it('POST /artifacts/import with a 1.4 MB body is NOT refused by the body parser', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/artifacts/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bigBundle(),
    });
    // Unauthenticated here, so 401 is the expected refusal - the POINT is that it is not 413.
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(401);
  });

  it('POST /artifacts/:id/bundle-update with a 1.4 MB body is NOT refused by the body parser', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/artifacts/art_123/bundle-update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bigBundle(),
    });
    expect(res.status).not.toBe(413);
    expect(res.status).toBe(401);
  });

  it('the exemption does NOT widen to its neighbours - another artifact route still caps at 1 MB', async () => {
    // `/import` is a fixed path and `/:id/bundle-update` is pinned at both ends; a sibling route
    // under the same router must still hit the global parser, or the carve-out is a hole.
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(1_400_000) }),
    });
    expect(res.status).toBe(413);
    expect(ErrorEnvelope.safeParse(JSON.parse(await res.text())).success).toBe(true);
  });

  it('a path that merely CONTAINS the bundle segment is not exempt', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/artifacts/art_123/bundle-update/extra`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bigBundle(),
    });
    expect(res.status).toBe(413);
  });
});
