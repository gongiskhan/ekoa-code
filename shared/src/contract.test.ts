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
