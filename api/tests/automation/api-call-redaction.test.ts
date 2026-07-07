import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeApiCallStep } from '../../src/automation/executors/api-call.js';
import { setIntegrationCredentialLoader, __resetAutomationSeamsForTests } from '../../src/automation/seams.js';
import type { Step, StepRecord, Automation } from '../../src/automation/types.js';
import type { RunContext } from '../../src/automation/engine.js';

/**
 * CREDENTIAL BOUNDARY for api_call steps (ch05 §5.6.7; G8 Codex finding): a decrypted integration
 * secret interpolated into the URL query string, the request BODY, or a NON-auth-shaped header must
 * be redacted from the PERSISTED resolvedAction + error details (GET /automations/runs/:id returns
 * the step record). Only the real outbound request carries the un-redacted values.
 */
const SECRET = 'sk-live-SUPER-SECRET-key-1234';

const ctx = (): RunContext => ({
  ownerUserId: 'owner-1',
  orgId: 'orgA',
  triggeredBy: 'user',
  visitedAutomationIds: new Set(),
  traceId: 't1',
});

const baseRecord = (): StepRecord => ({ stepId: 's1', index: 0, description: 'call', status: 'running', tier: 'cache', durationMs: 0 } as unknown as StepRecord);

/** finishRecord stub: capture the extras (resolvedAction + error) the executor persists. */
function makeFinish() {
  const captured: { resolvedAction?: unknown; error?: unknown; status?: string; output?: unknown } = {};
  const finishRecord = (base: StepRecord, status: StepRecord['status'], _start: number, extras: { resolvedAction?: unknown; error?: unknown; output?: unknown }): StepRecord => {
    captured.status = status;
    captured.resolvedAction = extras.resolvedAction;
    captured.error = extras.error;
    captured.output = extras.output;
    return { ...base, status } as StepRecord;
  };
  return { finishRecord, captured };
}

async function runApiCall(spec: Record<string, unknown>) {
  const step = { id: 's1', description: 'call', type: 'api_call', apiRequest: spec } as unknown as Step;
  const { finishRecord, captured } = makeFinish();
  await executeApiCallStep({
    step,
    index: 0,
    runId: 'r1',
    automation: { id: 'a1', name: 'A', steps: [] } as unknown as Automation,
    ctx: ctx(),
    inputs: {},
    baseRecord: baseRecord(),
    stepStart: 0,
    finishRecord,
  });
  return captured;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setIntegrationCredentialLoader(async () => ({ apiKey: SECRET }));
  // A 200 so the executor persists resolvedAction on the success path.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
  );
});
afterEach(() => {
  fetchSpy.mockRestore();
  __resetAutomationSeamsForTests();
});

describe('api_call credential redaction (§5.6.7)', () => {
  it('redacts the secret from a URL query string in the persisted resolvedAction — but sends it for real', async () => {
    const captured = await runApiCall({
      method: 'GET',
      url: 'https://api.example.com/data?token={{integration.stripe.apiKey}}',
      authIntegrationKey: 'stripe',
    });
    const resolved = captured.resolvedAction as { url: string };
    expect(resolved.url).not.toContain(SECRET);
    expect(resolved.url).toContain('<redacted>');
    // The REAL request used the un-redacted URL.
    expect(fetchSpy.mock.calls[0]![0]).toContain(SECRET);
  });

  it('redacts the secret from a NON-auth-shaped header value in the persisted resolvedAction', async () => {
    const captured = await runApiCall({
      method: 'GET',
      url: 'https://api.example.com/data',
      headers: { 'X-Stripe-Key': '{{integration.stripe.apiKey}}' },
      authIntegrationKey: 'stripe',
    });
    const resolved = captured.resolvedAction as { headers: Record<string, string> };
    expect(JSON.stringify(resolved.headers)).not.toContain(SECRET);
    // The real request carried the header value.
    const sentHeaders = fetchSpy.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(sentHeaders['X-Stripe-Key']).toBe(SECRET);
  });

  it('redacts the secret from the request BODY in the persisted resolvedAction', async () => {
    const captured = await runApiCall({
      method: 'POST',
      url: 'https://api.example.com/data',
      body: '{"client_secret":"{{integration.stripe.apiKey}}"}',
      bodyKind: 'json',
      authIntegrationKey: 'stripe',
    });
    const resolved = captured.resolvedAction as { body?: string };
    expect(resolved.body).not.toContain(SECRET);
    expect(resolved.body).toContain('<redacted>');
  });

  it('redacts the secret from error details when the call fails non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 401, statusText: 'Unauthorized' }));
    const captured = await runApiCall({
      method: 'GET',
      url: 'https://api.example.com/data?token={{integration.stripe.apiKey}}',
      authIntegrationKey: 'stripe',
    });
    expect(captured.status).toBe('failed');
    expect(JSON.stringify(captured.error)).not.toContain(SECRET);
  });

  it('redacts a secret carried in a NETWORK-ERROR message (Codex round-4 — fetch throws with the URL)', async () => {
    // A fetch rejection whose message echoes the resolved URL (which carries the secret).
    fetchSpy.mockRejectedValueOnce(new Error(`connect ECONNREFUSED https://api.example.com/data?token=${SECRET}`));
    const captured = await runApiCall({
      method: 'GET',
      url: 'https://api.example.com/data?token={{integration.stripe.apiKey}}',
      authIntegrationKey: 'stripe',
    });
    expect(captured.status).toBe('failed');
    expect(JSON.stringify(captured.error)).not.toContain(SECRET);
  });

  it('redacts a secret echoed in the HTTP statusText / reason phrase (Codex round-6)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 400, statusText: `Bad ${SECRET}` }));
    const captured = await runApiCall({
      method: 'GET',
      url: 'https://api.example.com/data?token={{integration.stripe.apiKey}}',
      authIntegrationKey: 'stripe',
    });
    expect(captured.status).toBe('failed');
    const output = captured.output as { statusText?: string };
    expect(output.statusText).not.toContain(SECRET);
    expect(JSON.stringify(captured.error)).not.toContain(SECRET);
  });

  it('redacts a secret ECHOED back in the response body/output (Codex round-2)', async () => {
    // A server that reflects the client secret in its error body.
    fetchSpy.mockResolvedValueOnce(
      new Response(`{"error":"invalid client_secret: ${SECRET}"}`, { status: 400, statusText: 'Bad Request' }),
    );
    const captured = await runApiCall({
      method: 'POST',
      url: 'https://api.example.com/data',
      body: '{"client_secret":"{{integration.stripe.apiKey}}"}',
      bodyKind: 'json',
      authIntegrationKey: 'stripe',
    });
    expect(captured.status).toBe('failed');
    // Neither the persisted output nor the error details may carry the echoed secret.
    const output = captured.output as { responseBody?: string };
    expect(output.responseBody).not.toContain(SECRET);
    expect(JSON.stringify(captured.error)).not.toContain(SECRET);
  });
});
