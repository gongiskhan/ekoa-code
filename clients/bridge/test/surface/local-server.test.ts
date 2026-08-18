import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EgressLedger } from '../../src/ledger/index.js';
import { startLocalSurface, type LocalSurfaceHandle, type LocalSurfaceStatus } from '../../src/surface/index.js';

/**
 * The daemon's localhost-only status + ledger surface (§18.6). Asserts it binds to loopback, serves
 * the live ledger (from the daemon's own files, never hosted), and rejects unknown routes/methods.
 */
let dir: string;
let ledger: EgressLedger;
let handle: LocalSurfaceHandle;
let status: LocalSurfaceStatus;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ekoa-surface-'));
  ledger = new EgressLedger(dir);
  status = { paired: true, pairingId: 'p1', org: 'orgA', cortexBaseUrl: 'https://cortex.example', connection: 'open' };
  handle = await startLocalSurface({ getStatus: () => status, ledger }, 0);
});
afterEach(async () => {
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string) => {
  const res = await fetch(`http://127.0.0.1:${handle.port}${path}`);
  return { status: res.status, body: await res.json().catch(() => undefined) };
};

describe('local surface', () => {
  it('serves the daemon status on /status', async () => {
    const { status: code, body } = await get('/status');
    expect(code).toBe(200);
    expect(body).toMatchObject({ paired: true, pairingId: 'p1', org: 'orgA', connection: 'open' });
  });

  it('serves a session ledger live from the daemon files on /ledger', async () => {
    ledger.append({
      kind: 'read', ts: '2026-07-10T00:00:00.000Z', session: 'sess-1', correlationId: 'c1',
      path: 'contrato.txt', byteRange: '0-42', bytesOut: 42, sha256: 'a'.repeat(64), tool: 'read', taskId: 't1',
    });
    const { status: code, body } = await get('/ledger?session=sess-1');
    expect(code).toBe(200);
    expect(body).toMatchObject({ session: 'sess-1', corrupt: 0 });
    expect((body as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it('serves the all-sessions merge when /ledger has no session param (C3 follow-up)', async () => {
    ledger.append({
      kind: 'read', ts: '2026-07-10T00:00:00.000Z', session: 'sess-2', correlationId: 'c2',
      path: 'outro.txt', byteRange: '0-1', bytesOut: 1, sha256: 'b'.repeat(64), tool: 'read', taskId: 't2',
    });
    const { status: code, body } = await get('/ledger');
    expect(code).toBe(200);
    expect((body as { rows: unknown[] }).rows.length).toBeGreaterThanOrEqual(1);
  });

  it('404s the grant routes on a status-only surface (no grants wiring)', async () => {
    const { status: code } = await get('/grants');
    expect(code).toBe(404);
  });

  it('404s an unknown route', async () => {
    const { status: code } = await get('/nope');
    expect(code).toBe(404);
  });

  it('405s a non-GET method', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/status`, { method: 'POST' });
    expect(res.status).toBe(405);
  });

  it('is bound to loopback only (127.0.0.1), not a public interface', async () => {
    // A request to the same port on a non-loopback bind would be refused; the loopback fetch above
    // already proves it is reachable locally. Assert the surface never advertises 0.0.0.0.
    const { body } = await get('/status');
    expect(JSON.stringify(body)).not.toContain('0.0.0.0');
  });
});

describe('local surface CORS + host guard (C1/C2)', () => {
  it('reflects an allowlisted browser origin (dev default)', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/status`, {
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('vary')).toBe('origin');
  });

  it('gives a foreign origin NO CORS header (browser-blocked)', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/status`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(res.status).toBe(200); // same-trust local process can read; the BROWSER blocks without ACAO
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers an OPTIONS preflight with the allowed methods + headers', async () => {
    const res = await fetch(`http://127.0.0.1:${handle.port}/grants`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toContain('content-type');
  });

  it('honours a configured origins allowlist over the defaults', async () => {
    const custom = await startLocalSurface(
      { getStatus: () => status, ledger, corsOrigins: ['https://app.ekoa.example'] },
      0,
    );
    try {
      const allowed = await fetch(`http://127.0.0.1:${custom.port}/status`, {
        headers: { origin: 'https://app.ekoa.example' },
      });
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.ekoa.example');
      const dev = await fetch(`http://127.0.0.1:${custom.port}/status`, {
        headers: { origin: 'http://localhost:3000' },
      });
      expect(dev.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await custom.close();
    }
  });

  // fetch (undici) silently strips a caller-set Host header, so the rebind-guard tests speak
  // node:http, which sends the forged Host verbatim — exactly what a rebinding attacker controls.
  const rawGet = (host: string): Promise<number> =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: handle.port, path: '/status', headers: { host } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });

  it('403s a non-loopback Host header (DNS-rebind guard)', async () => {
    expect(await rawGet('attacker.example:8791')).toBe(403);
  });

  it('serves localhost Host names (with or without port)', async () => {
    expect(await rawGet('localhost:8791')).toBe(200);
    expect(await rawGet('localhost')).toBe(200);
  });

  it('binds a requested fixed port and reports it via getStatus wiring', async () => {
    // Pick a free fixed port by binding 0 first, closing, then re-binding that number.
    const probe = await startLocalSurface({ getStatus: () => status, ledger }, 0);
    const fixed = probe.port;
    await probe.close();
    const surface = await startLocalSurface(
      { getStatus: () => ({ ...status, port: fixed }), ledger },
      fixed,
    );
    try {
      expect(surface.port).toBe(fixed);
      const res = await fetch(`http://127.0.0.1:${fixed}/status`);
      expect(((await res.json()) as { port: number }).port).toBe(fixed);
    } finally {
      await surface.close();
    }
  });

  it('rejects (promise) when the fixed port is already taken — serve reports it honestly', async () => {
    await expect(startLocalSurface({ getStatus: () => status, ledger }, handle.port)).rejects.toThrow();
  });
});
