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
