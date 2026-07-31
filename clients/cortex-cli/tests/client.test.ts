import { describe, it, expect } from 'vitest';
import {
  CortexApiError,
  CortexClient,
  CortexNetworkError,
  CortexTimeoutError,
  OPERATIONS,
  OPERATION_IDS,
} from '../src/client.js';

/**
 * Unit suite for THE fetch wrapper: request assembly, the success-status semantics that carry
 * contract meaning, the shared error envelope, the binary path, and the two failure modes that
 * never produce a response (timeout, network).
 *
 * Everything here runs against an injected `fetchImpl`, so it is fast and deterministic; the
 * wrapper's behaviour against the REAL server is proven separately in e2e.test.ts.
 */

interface Recorded {
  url: string;
  init: RequestInit;
}

/** A fetch stub that records the call and answers a canned response. */
function stub(response: Response | ((url: string, init: RequestInit) => Response | Promise<Response>)) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return typeof response === 'function' ? response(url, init) : response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const client = (fetchImpl: typeof fetch, baseUrl = 'https://cortex.example.com/') =>
  new CortexClient({ baseUrl, apiKey: 'ekoa_gk_test', clientTag: 'cortex-cli/9.9.9', fetchImpl });

describe('generated operation table', () => {
  it('carries all 27 contract operations, each with its declared success statuses', () => {
    expect(OPERATION_IDS).toHaveLength(27);
    expect(OPERATIONS['automations.createRun'].successStatuses).toEqual([202, 200]);
    expect(OPERATIONS['automations.create'].successStatuses).toEqual([201]);
    expect(OPERATIONS['memvault.exportVault'].kind).toBe('binary');
    expect(OPERATIONS['memvault.exportVault'].mediaType).toBe('application/x-tar');
    expect(OPERATIONS['memvault.writeNote']).toMatchObject({ method: 'POST', path: '/api/v1/memvault/notes' });
    // Every operation has a positive timeout the wrapper can arm.
    for (const id of OPERATION_IDS) expect(OPERATIONS[id].timeoutMs).toBeGreaterThan(0);
  });
});

/**
 * COMPILE-TIME contract. This function is never called: every `@ts-expect-error` below fails
 * `tsc -p tsconfig.test.json` if the wrapper ever stops refusing that call, so the typed slots are
 * a gate and not just a comment. (The suite's tsconfig covers tests/, so CI runs this.)
 */
async function _typedSlotsAreEnforced(c: CortexClient): Promise<void> {
  await c.call('memvault.listNotes', {}); // every parameter optional -> no slot needed
  await c.call('memvault.listNotes', { query: { folder: 'briefs' } });
  await c.call('knowledge.readKnowledgeDoc', { path: { collection: 'c', docId: 'd' } });
  // @ts-expect-error readNote's permalink query is required
  await c.call('memvault.readNote', {});
  // @ts-expect-error writeNote requires a request body
  await c.call('memvault.writeNote', {});
  // @ts-expect-error getRun requires its path id
  await c.call('automations.getRun', {});
  // @ts-expect-error listCollections declares no path parameters
  await c.call('knowledge.listCollections', { path: { id: 'x' } });
  // @ts-expect-error listNotes declares no request body
  await c.call('memvault.listNotes', { body: { anything: true } });
  // @ts-expect-error there is no such operation in the contract
  await c.call('memvault.mintKey', {});
  const tar = await c.call('memvault.exportVault', {});
  const note = await c.call('memvault.readNote', { query: { permalink: 'a/b' } });
  tar.data.byteLength.toFixed(); // binary operations decode to bytes
  note.data.contentMd.toUpperCase(); // json operations decode to their schema type
}

describe('request assembly', () => {
  it('sends the bearer key, the trace-only X-Client header and the operation media type', async () => {
    const { calls, fetchImpl } = stub(json({ items: [] }));
    await client(fetchImpl).call('memvault.listNotes', {});
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.url).toBe('https://cortex.example.com/api/v1/memvault/notes');
    expect(calls[0]?.init.method).toBe('GET');
    expect(headers.authorization).toBe('Bearer ekoa_gk_test');
    expect(headers['x-client']).toBe('cortex-cli/9.9.9');
    expect(headers.accept).toBe('application/json');
    expect(headers['content-type']).toBeUndefined(); // no body, no content-type
  });

  it('substitutes and encodes path parameters, and drops undefined query values', async () => {
    const { calls, fetchImpl } = stub(json({ runId: 'r1', steps: [] }));
    await client(fetchImpl).call('automations.getRunLogs', { path: { id: 'run/../etc' } });
    expect(calls[0]?.url).toBe('https://cortex.example.com/api/v1/automations/runs/run%2F..%2Fetc/logs');

    const { calls: qcalls, fetchImpl: qfetch } = stub(json({ items: [] }));
    await client(qfetch).call('memvault.listNotes', { query: { folder: 'briefs', limit: 5 } });
    expect(qcalls[0]?.url).toBe('https://cortex.example.com/api/v1/memvault/notes?folder=briefs&limit=5');
  });

  it('serialises a JSON body and sets content-type', async () => {
    const { calls, fetchImpl } = stub(json({ hits: [] }));
    await client(fetchImpl).call('memvault.searchNotes', { body: { query: 'zebra', limit: 3 } });
    expect((calls[0]?.init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(calls[0]?.init.body).toBe('{"query":"zebra","limit":3}');
  });

  it('refuses to build a URL with a missing path parameter instead of calling a wrong one', async () => {
    const { calls, fetchImpl } = stub(json({}));
    await expect(
      client(fetchImpl).call('automations.getRun', { path: { id: '' } as { id: string } }),
    ).rejects.toThrow(/missing path parameter "id"/);
    expect(calls).toHaveLength(0);
  });
});

describe('success-status semantics', () => {
  it('automations.createRun: 202 is a fresh run, 200 is an idempotent replay', async () => {
    const fresh = await client(stub(json({ runId: 'r1' }, 202)).fetchImpl).call('automations.createRun', {
      path: { id: 'a1' },
      body: { idempotencyKey: 'k' },
    });
    expect(fresh.status).toBe(202);
    expect(fresh.created).toBe(true);
    expect(fresh.replayed).toBe(false);

    const replay = await client(stub(json({ runId: 'r1' }, 200)).fetchImpl).call('automations.createRun', {
      path: { id: 'a1' },
      body: { idempotencyKey: 'k' },
    });
    expect(replay.status).toBe(200);
    expect(replay.created).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.data.runId).toBe('r1');
  });

  it('a status outside the declared success set is a refusal, never a silently accepted body', async () => {
    const { fetchImpl } = stub(new Response(null, { status: 204 }));
    await expect(client(fetchImpl).call('memvault.listNotes', {})).rejects.toMatchObject({
      name: 'CortexApiError',
      status: 204,
      code: 'NON_ENVELOPE_RESPONSE',
    });
  });

  it('the binary operation returns bytes and asks for its own media type', async () => {
    const tar = Buffer.from('ustar-ish bytes\0\0');
    const { calls, fetchImpl } = stub(new Response(tar, { status: 200, headers: { 'content-type': 'application/x-tar' } }));
    const res = await client(fetchImpl).call('memvault.exportVault', {});
    expect((calls[0]?.init.headers as Record<string, string>).accept).toBe('application/x-tar');
    expect(Buffer.isBuffer(res.data)).toBe(true);
    expect(res.data.equals(tar)).toBe(true);
  });
});

describe('failures', () => {
  it('a refusal is decoded from the SHARED error envelope, code, message and details intact', async () => {
    const envelope = {
      error: { code: 'NOT_FOUND', message: 'Nota não encontrada.', details: { permalink: 'a/b' } },
    };
    const { fetchImpl } = stub(json(envelope, 404));
    const error = await client(fetchImpl)
      .call('memvault.readNote', { query: { permalink: 'a/b' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CortexApiError);
    const api = error as CortexApiError;
    expect(api.status).toBe(404);
    expect(api.code).toBe('NOT_FOUND');
    expect(api.message).toBe('Nota não encontrada.');
    expect(api.details).toEqual({ permalink: 'a/b' });
    expect(api.operationId).toBe('memvault.readNote');
  });

  it('a non-envelope failure body is reported as such (never re-shaped into a fake envelope)', async () => {
    const html = new Response('<!DOCTYPE html><h1>502 Bad Gateway</h1>', { status: 502, headers: { 'content-type': 'text/html' } });
    const error = (await client(stub(html).fetchImpl)
      .call('memvault.listNotes', {})
      .catch((e: unknown) => e)) as CortexApiError;
    expect(error.code).toBe('NON_ENVELOPE_RESPONSE');
    expect(error.status).toBe(502);
    expect(error.message).toContain('502 Bad Gateway');

    // Valid JSON that is not the envelope is equally refused.
    const wrong = (await client(stub(json({ error: 'just a string' }, 400)).fetchImpl)
      .call('memvault.listNotes', {})
      .catch((e: unknown) => e)) as CortexApiError;
    expect(wrong.code).toBe('NON_ENVELOPE_RESPONSE');
  });

  it('a success body that is not JSON is INVALID_RESPONSE, not a crash', async () => {
    const { fetchImpl } = stub(new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }));
    const error = (await client(fetchImpl)
      .call('memvault.listNotes', {})
      .catch((e: unknown) => e)) as CortexApiError;
    expect(error).toBeInstanceOf(CortexApiError);
    expect(error.code).toBe('INVALID_RESPONSE');
  });

  it('an over-running request aborts at the per-call timeout', async () => {
    let aborted = false;
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      })) as unknown as typeof fetch;
    const started = Date.now();
    const error = (await client(fetchImpl)
      .call('memvault.listNotes', { timeoutMs: 40 })
      .catch((e: unknown) => e)) as CortexTimeoutError;
    expect(error).toBeInstanceOf(CortexTimeoutError);
    expect(error.code).toBe('TIMEOUT');
    expect(error.timeoutMs).toBe(40);
    expect(error.message).toContain('memvault.listNotes');
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('the operation timeout defaults to the generated per-operation value', async () => {
    const { calls, fetchImpl } = stub(json({ items: [] }));
    await client(fetchImpl).call('memvault.listNotes', {});
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.init.signal?.aborted).toBe(false); // the timer is cleared on completion
    expect(OPERATIONS['memvault.listNotes'].timeoutMs).toBe(30_000);
  });

  it('a transport failure is a CortexNetworkError naming the url', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    const error = (await client(fetchImpl)
      .call('memvault.listNotes', {})
      .catch((e: unknown) => e)) as CortexNetworkError;
    expect(error).toBeInstanceOf(CortexNetworkError);
    expect(error.code).toBe('NETWORK');
    expect(error.message).toContain('https://cortex.example.com/api/v1/memvault/notes');
    expect(error.message).toContain('fetch failed');
  });

  it("a caller's own abort signal cancels the call", async () => {
    const controller = new AbortController();
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const promise = client(fetchImpl).call('memvault.listNotes', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(CortexTimeoutError);
  });
});
