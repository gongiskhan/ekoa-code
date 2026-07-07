import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import { buildApp, boot } from '../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../src/config.js';

/**
 * G0 runtime correctness gate: the fail-closed boot gate (ch09 §9.7) and the carried
 * /health shape (ch03 §3.8.23). A committed, re-runnable assertion — not exploration.
 */
const testConfig: Config = {
  port: 0,
  jwtSecret: 'test',
  encryptionKey: 'test',
  nodeEnv: 'test',
  llmChokepointBaseUrl: 'http://127.0.0.1:0/api/v1/llm',
  llm: defaultLlmConfig(),
};

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
  __resetConfigForTests();
});

describe('boot config gate (fail-closed, ch09 §9.7)', () => {
  it('refuses to load config without ENCRYPTION_KEY', () => {
    process.env.JWT_SECRET = 'x';
    delete process.env.ENCRYPTION_KEY;
    __resetConfigForTests();
    expect(() => loadConfig()).toThrow(/ENCRYPTION_KEY/);
  });

  it('refuses to load config without JWT_SECRET', () => {
    process.env.ENCRYPTION_KEY = 'k';
    delete process.env.JWT_SECRET;
    __resetConfigForTests();
    expect(() => loadConfig()).toThrow(/JWT_SECRET/);
  });

  it('rejects a non-numeric PORT and defaults an empty PORT to 4111', () => {
    process.env.JWT_SECRET = 'x';
    process.env.ENCRYPTION_KEY = 'k';
    process.env.PORT = 'abc';
    __resetConfigForTests();
    expect(() => loadConfig()).toThrow(/PORT/);
    process.env.PORT = '';
    __resetConfigForTests();
    expect(loadConfig().port).toBe(4111);
    delete process.env.PORT;
  });
});

describe('/health surface (ch03 §3.8.23)', () => {
  it('returns the carried health field shape', async () => {
    const app = buildApp(testConfig);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server!.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body).toHaveProperty('claudeAuth');
    expect(body).toHaveProperty('clockSkewSec');
    expect(body).toHaveProperty('bridgeConnections');
  });
});

// `boot` is exported and referenced so the composition root stays covered as routers land.
void boot;
