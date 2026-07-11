import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { appPdfRouter } from '../../src/apps/pdf.js';

/**
 * POST /api/app-pdf - the served-app document-export endpoint `window.__ekoa.exportPdf`
 * calls (carried from the old plane; was never mounted in the port, so every in-app
 * "Descarregar PDF" 404'd - caught live by the per-build verifier, 2026-07-11).
 *
 * Validation surface only (no browser): header scoping, html-required, size cap. The happy
 * path needs the shared Chromium and is exercised by the live-verification playbook.
 */
let server: Server;
let port: number;

const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, init);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'k';
  process.env.JWT_SECRET ??= 's';
  __resetConfigForTests();
  loadConfig();
  const app = express();
  app.use('/', appPdfRouter());
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  __resetConfigForTests();
});

describe('POST /api/app-pdf (validation surface)', () => {
  it('rejects a missing/invalid X-Ekoa-App-Id with 400', async () => {
    const res = await api('/api/app-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<p>x</p>' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/X-Ekoa-App-Id/);
  });

  it('rejects a header that is not a safe basename charset', async () => {
    const res = await api('/api/app-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ekoa-App-Id': '../etc' },
      body: JSON.stringify({ html: '<p>x</p>' }),
    });
    expect(res.status).toBe(400);
  });

  it('requires non-empty html', async () => {
    const res = await api('/api/app-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ekoa-App-Id': 'app-1' },
      body: JSON.stringify({ html: '   ' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/html/);
  });

  it('caps the payload at 4MB (413)', async () => {
    const res = await api('/api/app-pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ekoa-App-Id': 'app-1' },
      body: JSON.stringify({ html: 'x'.repeat(4_000_001) }),
    });
    expect(res.status).toBe(413);
  });
});
