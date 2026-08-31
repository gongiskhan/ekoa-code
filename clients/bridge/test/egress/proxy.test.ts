import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { connect } from 'node:net';
import { startEgressProxy, type EgressProxy } from '../../src/egress/proxy.js';
import { resolveCapabilities } from '../../src/cli/commands/serve.js';

/**
 * THE MACHINE'S OWN RESIDENTIAL EGRESS.
 *
 * These assert the proxy actually carries traffic, because the defect it exists to close was
 * precisely a capability that was ADVERTISED and could not be served. A test that only checked the
 * capability string would reproduce that failure rather than catch it.
 */

let proxy: EgressProxy | undefined;
let origin: Server | undefined;

afterEach(async () => {
  await proxy?.close();
  proxy = undefined;
  await new Promise<void>((r) => (origin ? origin.close(() => r()) : r()));
  origin = undefined;
});

/** A throwaway origin server, so the proxy has something real to reach. */
async function startOrigin(handler: (path: string) => { status: number; body: string }): Promise<number> {
  origin = createServer((req, res) => {
    const out = handler(req.url ?? '');
    res.writeHead(out.status, { 'content-type': 'text/plain' });
    res.end(out.body);
  });
  await new Promise<void>((resolve) => origin!.listen(0, '127.0.0.1', () => resolve()));
  const addr = origin.address();
  if (!addr || typeof addr === 'string') throw new Error('origin has no port');
  return addr.port;
}

/** Speak the proxy protocol directly - no client library, so what is asserted is the wire. */
function throughProxy(proxyAddr: string, rawRequest: string): Promise<string> {
  const [host, port] = proxyAddr.split(':');
  return new Promise((resolve, reject) => {
    const sock = connect({ host: host!, port: Number(port) }, () => sock.write(rawRequest));
    let out = '';
    sock.setTimeout(5_000, () => {
      sock.destroy();
      reject(new Error('timed out talking to the proxy'));
    });
    sock.on('data', (c) => {
      out += c.toString();
    });
    sock.on('close', () => resolve(out));
    sock.on('error', reject);
  });
}

describe('the daemon serves its own residential egress', () => {
  it('binds loopback by default - a routable bind is never chosen for the operator', async () => {
    // Port 0 throughout this file: the real default is FIXED (8792) so a grant survives a restart,
    // and a suite that raced for that one port would be flaky on a machine already serving it.
    proxy = await startEgressProxy({ port: 0 });
    expect(proxy.address.startsWith('127.0.0.1:')).toBe(true);
  });

  it('forwards a plain http request in absolute form, and reports the origin unchanged', async () => {
    const port = await startOrigin((path) => ({ status: 200, body: `hello from ${path}` }));
    proxy = await startEgressProxy({ port: 0 });

    const res = await throughProxy(
      proxy.address,
      `GET http://127.0.0.1:${port}/pedidos HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
    );
    expect(res).toContain('200');
    expect(res).toContain('hello from /pedidos');
    expect(proxy.served).toBe(1);
  });

  it('opens a CONNECT tunnel and does not look inside it', async () => {
    const port = await startOrigin(() => ({ status: 200, body: 'tunnelled' }));
    proxy = await startEgressProxy({ port: 0 });

    // The tunnel carries a second, ordinary request - which is exactly how https rides this path.
    const res = await throughProxy(
      proxy.address,
      `CONNECT 127.0.0.1:${port} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`
        + `GET /painel HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
    );
    expect(res).toContain('200 Connection Established');
    expect(res).toContain('tunnelled');
  });

  it('answers 502 rather than hanging when the destination is unreachable', async () => {
    proxy = await startEgressProxy({ port: 0 });
    // Port 1 on loopback: nothing listens, and the refusal is immediate.
    const res = await throughProxy(
      proxy.address,
      'GET http://127.0.0.1:1/ HTTP/1.1\r\nHost: 127.0.0.1:1\r\nConnection: close\r\n\r\n',
    );
    expect(res).toContain('502');
  });

  it('refuses a request that is not in proxy form', async () => {
    proxy = await startEgressProxy({ port: 0 });
    const res = await throughProxy(proxy.address, 'GET /not-absolute HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    expect(res).toContain('400');
  });

  it('stops listening once closed, so a stopped daemon offers no relay', async () => {
    const p = await startEgressProxy({ port: 0 });
    const addr = p.address;
    await p.close();
    await expect(
      throughProxy(addr, 'GET http://127.0.0.1:1/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'),
    ).rejects.toThrow();
  });
});

/**
 * The capability and the endpoint are one fact. This is the half that was broken in production: a
 * bridge with no endpoint advertised no residential egress, so it could not check out the sessions
 * its own ceremonies had captured.
 */
describe('advertisement follows the endpoint', () => {
  it('advertises egress.residential once the daemon has an address to serve it at', async () => {
    expect(resolveCapabilities(undefined, undefined)).not.toContain('egress.residential');
    proxy = await startEgressProxy({ port: 0 });
    expect(resolveCapabilities(undefined, proxy.address)).toContain('egress.residential');
  });
});
