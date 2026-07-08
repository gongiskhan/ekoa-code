import { describe, it, expect } from 'vitest';
import {
  ALL_ENDPOINTS,
  allEndpointsFlat,
  ErrorEnvelope,
  ERROR_STATUS,
  SSE_STREAMS,
} from './index.js';

/**
 * G0 contract skeleton (ch03 §3.12, ch13 §13.5). Asserts the shared/ contract is
 * well-formed and covers the ch03 map at the structural level. Deep per-endpoint
 * validation lands with the contract suite from G2 onward.
 */
describe('shared contract', () => {
  it('loads all 24 domain descriptor maps', () => {
    expect(Object.keys(ALL_ENDPOINTS).length).toBe(24);
  });

  it('every endpoint descriptor is well-formed', () => {
    for (const e of allEndpointsFlat()) {
      expect(e.method, `${e.domain}.${e.name} method`).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(e.path, `${e.domain}.${e.name} path`).toMatch(/^\//);
      expect(e.auth, `${e.domain}.${e.name} auth`).toBeTruthy();
    }
  });

  it('exactly four web-client SSE streams (CONV-4)', () => {
    // The four sanctioned SSE endpoints under /api/v1 for web clients. The P-18 TUI
    // compatibility channel (GET /api/v1/events) is excluded — it is TUI-only (ch03 §3.10).
    const sse = allEndpointsFlat().filter(
      (e) => e.kind === 'sse' && e.path.startsWith('/api/v1') && e.path !== '/api/v1/events',
    );
    const paths = sse.map((e) => e.path).sort();
    expect(paths).toEqual(
      [
        '/api/v1/automations/runs/:id/events',
        '/api/v1/chat/runs/:id/events',
        '/api/v1/jobs/:id/events',
        '/api/v1/notifications/events',
      ].sort(),
    );
    expect(SSE_STREAMS.length).toBe(4);
  });

  it('no retired transport endpoints except the P-18 TUI channel (ch03 acceptance 8)', () => {
    const retired = ['/api/v1/action', '/api/v1/request', '/api/v1/request/cancel'];
    const paths = allEndpointsFlat().map((e) => e.path);
    for (const r of retired) expect(paths).not.toContain(r);
  });

  it('no teams route (ch03 acceptance 9)', () => {
    const paths = allEndpointsFlat().map((e) => e.path);
    expect(paths.some((p) => p.includes('/teams'))).toBe(false);
  });

  it('the Amendment 2 org/registo/settings routes are present (ch03 acceptance 9)', () => {
    const paths = allEndpointsFlat().map((e) => e.path);
    for (const p of ['/api/v1/org', '/api/v1/orgs', '/api/v1/registo', '/api/v1/settings/me']) {
      expect(paths, p).toContain(p);
    }
  });

  it('error envelope validates and every code maps to a status (ch03 acceptance 10)', () => {
    const parsed = ErrorEnvelope.safeParse({
      error: { code: 'ACCOUNT_DISABLED', message: 'A sua conta está bloqueada.' },
    });
    expect(parsed.success).toBe(true);
    expect(ERROR_STATUS.ACCOUNT_DISABLED).toBe(403);
    expect(ERROR_STATUS.BILLING_LOCKED).toBe(402);
  });

  it('POST /jobs accepts only build kind, not brand-research (ch03 §3.8.8)', async () => {
    const { JobCreateRequest } = await import('./jobs.js');
    expect(JobCreateRequest.safeParse({ kind: 'build', description: 'x', sessionId: 's' }).success).toBe(true);
    expect(JobCreateRequest.safeParse({ kind: 'brand-research', description: 'x', sessionId: 's' }).success).toBe(false);
  });

  it('TriggerCreateRequest accepts both spec-shaped variants (ch03 §3.8.17, landmine 2)', async () => {
    const { TriggerCreateRequest } = await import('./triggers.js');
    // automation target — flat, no `kind`, no `target`
    expect(
      TriggerCreateRequest.safeParse({ automationId: 'a', integrationKey: 'k', eventName: 'e' }).success,
    ).toBe(true);
    // artifact-backend target — nested target.kind
    expect(
      TriggerCreateRequest.safeParse({
        integrationKey: 'k',
        eventName: 'e',
        target: { kind: 'artifact-backend', artifactId: 'x', entrypoint: 'main' },
      }).success,
    ).toBe(true);
  });

  it('language default applies when omitted (ch03 §3.4)', async () => {
    const { ChatRunCreateRequest } = await import('./chat.js');
    const parsed = ChatRunCreateRequest.parse({ sessionId: 's', message: 'olá' });
    expect(parsed.language).toBe('pt');
  });

  it('NotificationEvent can represent the ready stream-open ack (ch03 §3.6)', async () => {
    const { NotificationEvent } = await import('./events.js');
    expect(NotificationEvent.safeParse({ type: 'ready' }).success).toBe(true);
    expect(NotificationEvent.safeParse({ type: 'usage_updated' }).success).toBe(true);
  });

  it('no auth cell carries a bare "admin" class (ch03 acceptance 11)', () => {
    for (const e of allEndpointsFlat()) {
      expect(['public', 'user', 'org-admin', 'super-admin', 'token-query', 'hmac', 'header-scoped', 'optional-jwt', 'app-id-gated', 'bridge']).toContain(e.auth);
    }
  });
});

/**
 * G12 security phase - contract-level egress/injection guards (the shared/ Codex scope).
 * Each test pins a fix so the class is machine-caught forever (the determinism ratchet).
 */
describe('shared contract - security ratchet (G12)', () => {
  it('the error envelope details is bounded to plain JSON - non-JSON internal objects cannot validate', () => {
    // Accidental internal objects (a Date, a Buffer, a bigint) in details are exactly the
    // careless-`sendError` leak shapes; the JsonValue bound rejects them at the contract boundary
    // (ch09 §9.3 invariant 2 is the runtime control; this makes the contract test a guard too).
    const buf = { error: { code: 'INTERNAL', message: 'x', details: { blob: Buffer.from('secret') } } };
    expect(ErrorEnvelope.safeParse(buf).success).toBe(false);
    const date = { error: { code: 'INTERNAL', message: 'x', details: { at: new Date() } } };
    expect(ErrorEnvelope.safeParse(date).success).toBe(false);
    const big = { error: { code: 'INTERNAL', message: 'x', details: { n: 10n } } };
    expect(ErrorEnvelope.safeParse(big).success).toBe(false);
    // legitimate structured details (validation issues, a billingUrl) still pass
    const okDetails = { error: { code: 'VALIDATION_FAILED', message: 'x', details: { issues: [{ code: 'invalid_type', path: ['a'], message: 'req' }], billingUrl: 'https://x' } } };
    expect(ErrorEnvelope.safeParse(okDetails).success).toBe(true);
  });

  it('AuthUser is strict - a passwordHash-bearing object cannot validate as an AuthUser (no secret leak)', async () => {
    const { AuthUser } = await import('./auth.js');
    const base = { id: 'u1', username: 'a', role: 'builder', orgId: 'o1', active: true };
    expect(AuthUser.safeParse(base).success).toBe(true);
    expect(AuthUser.safeParse({ ...base, passwordHash: '$2b$...' }).success).toBe(false);
    expect(AuthUser.safeParse({ ...base, resetToken: 'deadbeef' }).success).toBe(false);
  });

  it('session-capture responses carry status metadata only, never the captured storageState', async () => {
    const { SessionCaptureStatus, ConnectSessionResponse } = await import('./integrations.js');
    expect(SessionCaptureStatus.safeParse({ status: 'ok', session: { status: 'captured', capturedAt: '2026-07-08T00:00:00Z' } }).success).toBe(true);
    // a raw Playwright storageState (cookies) is not a legal session snapshot
    expect(
      SessionCaptureStatus.safeParse({ status: 'ok', session: { cookies: [{ name: 'sid', value: 'secret' }] } }).success,
    ).toBe(false);
    expect(ConnectSessionResponse.safeParse({ started: true, session: { status: 'waiting_login' } }).success).toBe(true);
    expect(ConnectSessionResponse.safeParse({ started: true, session: { storageState: { cookies: [] } } }).success).toBe(false);
  });

  it('DelegatedTask signing bytes are injective - a non-finite egress budget cannot be signed (§18.1)', async () => {
    const { DelegatedTask, canonicalTaskBinding } = await import('./ekoa-local.js');
    const base = {
      taskId: 't', org: 'o', user: 'u', session: 's', pairingId: 'p', grantRefs: ['g'],
      task: 'read', budget: { egressBytes: 1000, modelSpend: { userId: 'u' } }, expiry: '2026-07-08T00:00:00Z', nonce: 'n', sig: 'x',
    };
    expect(DelegatedTask.safeParse(base).success).toBe(true);
    // an Infinity egress cap is rejected at the schema boundary (would canonicalise to `null`)
    expect(DelegatedTask.safeParse({ ...base, budget: { egressBytes: Infinity, modelSpend: { userId: 'u' } } }).success).toBe(false);
    // and the canonicaliser refuses a non-finite number defensively
    expect(() => canonicalTaskBinding({ ...base, budget: { egressBytes: Infinity, modelSpend: { userId: 'u' } } } as never)).toThrow(/non-finite/);
    // two distinct finite budgets produce distinct signing bytes (injective)
    const a = canonicalTaskBinding({ ...base, budget: { egressBytes: 1000, modelSpend: { userId: 'u' } } });
    const b = canonicalTaskBinding({ ...base, budget: { egressBytes: 2000, modelSpend: { userId: 'u' } } });
    expect(a).not.toBe(b);
  });
});
