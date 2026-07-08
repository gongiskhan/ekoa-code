import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import type { Server } from 'node:http';
import { buildApp } from '../src/server.js';
import { __resetConfigForTests, defaultLlmConfig, type Config } from '../src/config.js';

// buildApp registers the gateway, which reads loadConfig() (JWT_SECRET/ENCRYPTION_KEY required).
beforeAll(() => {
  process.env.JWT_SECRET = 'test';
  process.env.ENCRYPTION_KEY = 'test';
});

/**
 * Security-headers baseline presence gate (ch09 §9.8 D1, FIXED-14). The spec mandates a
 * composition-root headers middleware AND "a header-presence contract test" — this is it.
 * Asserts the universal headers on every response and the surface-split CSP/frame policy
 * (strict for the JSON API surface, framing-scoped containment for the served-app plane).
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
async function start(): Promise<number> {
  const app = buildApp(testConfig);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server!.address();
  return typeof addr === 'object' && addr ? addr.port : 0;
}

afterEach(() => {
  server?.close();
  server = undefined;
  __resetConfigForTests();
});

describe('security-headers baseline (ch09 §9.8 D1, FIXED-14)', () => {
  it('sets the universal headers on every response', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('strict-transport-security')).toMatch(/max-age=\d+/);
    // x-powered-by is disabled (no framework fingerprint)
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('locks down the JSON API surface: strict CSP + DENY framing', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('contains the served-app plane with frame-ancestors (anti-clickjacking), not a resource-breaking CSP', async () => {
    const port = await start();
    // A served-app-plane path (not /api*, not /health): the root serving surface.
    const res = await fetch(`http://127.0.0.1:${port}/apps/nonexistent-app-id/`, { redirect: 'manual' });
    // whatever the status, the plane's headers are set by the middleware
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(res.headers.get('content-security-policy')).not.toContain("default-src 'none'");
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
