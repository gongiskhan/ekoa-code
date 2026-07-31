import { describe, it, expect } from 'vitest';
import { CortexClient, CortexApiError, CortexNetworkError } from '../src/client.js';
import { main } from '../src/cli.js';
import { makeRedactor, REDACTED } from '../src/redact.js';
import type { Io } from '../src/output.js';

/**
 * CREDENTIAL LEAK REGRESSIONS (E7 fresh-context review F1 + F2).
 *
 * Both findings are the same shape: a message built from bytes this process did not author ends up
 * on stderr, and from there in the agent transcript, CI logs and journald. The two carriers are an
 * origin that reflects our request headers in its error body (F1) and the transport quoting a
 * rejected header VALUE (F2). Every assertion here checks the SECRET ITSELF is absent - not that
 * some pattern was matched - because a redactor that only recognises `Bearer <x>` fails on the
 * first reflection that quotes the key somewhere else.
 */

const KEY = 'ekoa_gk_SUPERSECRETKEYVALUE123';
const ENV = { CORTEX_BASE_URL: 'https://cortex.example.com', CORTEX_API_KEY: KEY };

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (t) => out.push(t), err: (t) => err.push(t), outBytes: () => undefined } };
}

const client = (fetchImpl: typeof fetch, apiKey = KEY) =>
  new CortexClient({ baseUrl: 'https://cortex.example.com', apiKey, clientTag: 'cortex-cli/9.9.9', fetchImpl });

/** An origin that echoes the request headers back inside its error body. */
function reflectingOrigin(status: number, contentType = 'application/json'): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body =
      contentType === 'application/json'
        ? JSON.stringify({ message: 'upstream failed', request: { headers: init.headers } })
        : `<html><body>rejected: ${JSON.stringify(init.headers)}</body></html>`;
    return new Response(body, { status, headers: { 'content-type': contentType } });
  }) as unknown as typeof fetch;
}

describe('F1 - a reflected error body never carries the key into a message', () => {
  it('non-envelope JSON: the key is redacted out of CortexApiError.message', async () => {
    const error = (await client(reflectingOrigin(500))
      .call('memvault.listNotes', {})
      .catch((e: unknown) => e)) as CortexApiError;
    expect(error).toBeInstanceOf(CortexApiError);
    expect(error.code).toBe('NON_ENVELOPE_RESPONSE');
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain('SUPERSECRET');
    expect(error.message).toContain(REDACTED); // the reflection is still visible, just defused
  });

  it('non-JSON body: same guarantee on the other refusal branch', async () => {
    const error = (await client(reflectingOrigin(502, 'text/html'))
      .call('memvault.listNotes', {})
      .catch((e: unknown) => e)) as CortexApiError;
    expect(error.message).not.toContain('SUPERSECRET');
    expect(error.message).toContain(REDACTED);
  });

  it('the key is scrubbed BEFORE the 300-byte excerpt, so truncation cannot leave a usable prefix', async () => {
    // Push the reflected header past the excerpt cut-off: scrubbing after truncating would leave
    // the first characters of the key in the message.
    const padded = (async () =>
      new Response(JSON.stringify({ pad: 'x'.repeat(280), auth: `Bearer ${KEY}` }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const error = (await client(padded)
      .call('memvault.listNotes', {})
      .catch((e: unknown) => e)) as CortexApiError;
    expect(error.message).not.toContain('ekoa_gk_S');
    expect(error.message).not.toContain('SUPERSECRET');
  });

  it('an envelope whose message or details echo the key is scrubbed too', async () => {
    const echoing = (async () =>
      new Response(
        JSON.stringify({
          error: { code: 'VALIDATION_FAILED', message: `bad token ${KEY}`, details: { seen: `Bearer ${KEY}` } },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;
    const error = (await client(echoing)
      .call('memvault.listNotes', {})
      .catch((e: unknown) => e)) as CortexApiError;
    expect(error.message).not.toContain('SUPERSECRET');
    expect(JSON.stringify(error.details)).not.toContain('SUPERSECRET');
  });

  it('end to end through the CLI: neither stderr stream carries the key, in --json or human mode', async () => {
    for (const argv of [
      ['memory', 'list', '--json'],
      ['memory', 'list'],
    ]) {
      const cap = capture();
      const code = await main(argv, { io: cap.io, env: ENV, fetchImpl: reflectingOrigin(500) });
      expect(code).toBe(1);
      const printed = [...cap.out, ...cap.err].join('\n');
      expect(printed, argv.join(' ')).not.toContain(KEY);
      expect(printed, argv.join(' ')).not.toContain('SUPERSECRET');
      expect(printed).toContain(REDACTED);
    }
  });
});

describe('F2 - a transport error that quotes the rejected header value never carries the key', () => {
  /** Exactly undici's shape: `Headers.append: "<value>" is an invalid header value.` */
  const quotingTransport = (key: string): typeof fetch =>
    (() => Promise.reject(new TypeError(`Headers.append: "Bearer ${key}" is an invalid header value.`))) as unknown as typeof fetch;

  it('a key with an interior newline is redacted out of CortexNetworkError.message', async () => {
    const wrapped = 'ekoa_gk_SUPERSECRET\nVALUE123';
    const error = (await client(quotingTransport(wrapped), wrapped)
      .call('memvault.listNotes', {})
      .catch((e: unknown) => e)) as CortexNetworkError;
    expect(error).toBeInstanceOf(CortexNetworkError);
    expect(error.message).not.toContain('SUPERSECRET');
    expect(error.detail).not.toContain('SUPERSECRET');
    expect(error.message).toContain(REDACTED);
  });

  it('and the JSON-escaped spelling of the same key, which a quoted body would use', () => {
    const wrapped = 'ekoa_gk_SUPERSECRET\nVALUE123';
    const redact = makeRedactor(wrapped);
    expect(redact(`raw: ${wrapped}`)).not.toContain('SUPERSECRET');
    expect(redact(`json: ${JSON.stringify(wrapped)}`)).not.toContain('SUPERSECRET');
  });

  it('end to end through the CLI: stderr carries no fragment of the key', async () => {
    const wrapped = 'ekoa_gk_SUPERSECRET\nVALUE123';
    const cap = capture();
    const code = await main(['memory', 'list', '--json'], {
      io: cap.io,
      env: { ...ENV, CORTEX_API_KEY: wrapped },
      fetchImpl: quotingTransport(wrapped),
    });
    expect(code).toBe(1);
    expect(cap.err.join('\n')).not.toContain('SUPERSECRET');
  });
});

describe('the redactor itself', () => {
  it('redacts by VALUE in any position, not by looking for "Bearer"', () => {
    const redact = makeRedactor(KEY);
    expect(redact(`{"x":"${KEY}"}`)).toBe(`{"x":"${REDACTED}"}`);
    expect(redact(`${KEY} at the start`)).toBe(`${REDACTED} at the start`);
    expect(redact(`ends with ${KEY}`)).toBe(`ends with ${REDACTED}`);
    expect(redact(`twice ${KEY} and ${KEY}`)).toBe(`twice ${REDACTED} and ${REDACTED}`);
  });

  it('replaces with a FIXED marker, so the secret length does not leak', () => {
    expect(makeRedactor(KEY)(KEY)).toBe(REDACTED);
    expect(makeRedactor('ekoa_gk_short1')('ekoa_gk_short1')).toBe(REDACTED);
  });

  it('nets a gateway key that is NOT the one we hold (defence in depth)', () => {
    expect(makeRedactor(KEY)('someone else: ekoa_gk_OTHERTENANTKEY')).not.toContain('OTHERTENANTKEY');
  });

  it('leaves ordinary text alone and ignores absent or implausibly short secrets', () => {
    const redact = makeRedactor(undefined, '', 'abc');
    expect(redact('a perfectly ordinary message about abc')).toBe('a perfectly ordinary message about abc');
  });
});
