import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

/**
 * s7 (D6) — diagnostics honesty at the gateway: closes FINDINGS 502-masks-401. A TERMINAL
 * credential failure answers a typed non-retryable `credential_error` (503), a rate-cap a
 * typed 429, and only genuinely transient transport failures keep the retryable 502. Plus:
 * terminal provider statuses land on /health's claudeAuth.lastProviderError as a CLASS +
 * timestamp (never bodies, never secrets), and providerErrorClassOf maps statuses.
 */

const proxyMock = vi.fn();
vi.mock('../../src/llm/client.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, proxyGatewayMessages: (...a: unknown[]) => proxyMock(...a) };
});
vi.mock('../../src/billing/allowance.js', () => ({ checkAllowance: async () => ({ ok: true }) }));

import { gatewayRouter } from '../../src/llm/gateway.js';
import { LlmRateCapError } from '../../src/llm/client.js';
import {
  CredentialError,
  noteProviderError,
  providerErrorClassOf,
  claudeAuthStatus,
  __resetCredentialsForTests,
} from '../../src/llm/credentials.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

let server: Server; let port: number;

beforeEach(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's';
  process.env.LLM_GATEWAY_API_KEY = 'gw-key';
  __resetConfigForTests(); loadConfig();
  __resetCredentialsForTests();
  proxyMock.mockReset();
  if (server) await new Promise<void>((r) => server.close(() => r()));
  const app = express();
  app.use('/api/v1/llm', gatewayRouter({ verifyToken: () => ({ sub: 'u1' }) }));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
});

async function post(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/llm/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': 'gw-key' },
    body: JSON.stringify({ model: 'x', max_tokens: 8, messages: [] }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function errType(body: Record<string, unknown>): string {
  return ((body.error as Record<string, unknown>)?.type as string) ?? '';
}

describe('gateway terminal-vs-transient classing (502-masks-401 fix)', () => {
  it('a CredentialError is a typed non-retryable credential_error 503 — never a 502', async () => {
    proxyMock.mockRejectedValueOnce(new CredentialError('api-key credential rejected (401)'));
    const { status, body } = await post();
    expect(status).toBe(503);
    expect(errType(body)).toBe('credential_error');
    // No secret material on the wire.
    expect(JSON.stringify(body)).not.toContain('401)');
  });

  it('a rate-cap rejection is a typed 429', async () => {
    proxyMock.mockRejectedValueOnce(new LlmRateCapError({ ok: false, retryAfterMs: 1000 } as never));
    const { status, body } = await post();
    expect(status).toBe(429);
    expect(errType(body)).toBe('rate_limit_error');
  });

  it('a transient transport failure stays a retryable 502 api_error', async () => {
    proxyMock.mockRejectedValueOnce(new Error('socket hang up'));
    const { status, body } = await post();
    expect(status).toBe(502);
    expect(errType(body)).toBe('api_error');
  });
});

describe('claudeAuth.lastProviderError (class + timestamp, no bodies)', () => {
  it('noteProviderError surfaces on claudeAuthStatus and resets with the test helper', () => {
    expect(claudeAuthStatus().lastProviderError).toBeUndefined();
    noteProviderError('auth', { now: () => 1_700_000_000_000 });
    const st = claudeAuthStatus();
    expect(st.lastProviderError).toEqual({ class: 'auth', at: new Date(1_700_000_000_000).toISOString() });
    __resetCredentialsForTests();
    expect(claudeAuthStatus().lastProviderError).toBeUndefined();
  });

  it('providerErrorClassOf maps terminal 4xx distinctly from transient 5xx', () => {
    expect(providerErrorClassOf(400)).toBe('invalid_request');
    expect(providerErrorClassOf(401)).toBe('auth');
    expect(providerErrorClassOf(402)).toBe('billing');
    expect(providerErrorClassOf(403)).toBe('auth');
    expect(providerErrorClassOf(429)).toBe('rate_limit');
    expect(providerErrorClassOf(500)).toBe('transient');
    expect(providerErrorClassOf(529)).toBe('transient');
    expect(providerErrorClassOf(200)).toBeUndefined();
  });
});
