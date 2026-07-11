import { createServer, type Server } from 'node:http';
import { test, expect, type Page } from '@playwright/test';
import { BridgeStatusResponse } from '@ekoa/shared';

/**
 * Daemon-served grants + registo (run 20260711-111952 s6; FC-406/FC-407, D2/D5) —
 * deterministic, LLM-free.
 *
 * The browser fetches grants and the egress ledger STRAIGHT from the daemon's loopback
 * surface; nothing transits the hosted API. This spec plays the daemon: a real HTTP server
 * on 127.0.0.1:8791 (the stable C1 port) serving the C1-C3 contract with CORS (C2), while
 * the hosted presence endpoint is stubbed 'connected' (schema-validated). Asserts: the live
 * grants list renders with revoke wired (round-trips to the stub daemon, the list
 * refreshes), the registo defaults to the ALL-SESSIONS view (`GET /ledger` with no param,
 * D5) rendering read/write/denial kinds each labelled with its session, and a daemon
 * WITHOUT the C3 endpoints yields the honest unavailable state — never fabricated data.
 * Real UI login, zero console errors.
 */

const DAEMON_PORT = 8791;
const CONNECTED = { paired: true, live: true, pairingId: 'pair-e2e', lastSeenAt: '2026-07-11T06:00:00.000Z' };

// Two sessions, so the all-sessions merge (D5) is exercised, newest-first.
const LEDGER_ROWS = [
  { kind: 'read', ts: '2026-07-11T06:00:00Z', session: 'sess-a', correlationId: 'c1', path: '/clientes/contrato.txt', byteRange: '0-3100', bytesOut: 3100, sha256: 'h', tool: 'read', taskId: 't1' },
  { kind: 'write', ts: '2026-07-11T06:01:00Z', session: 'sess-a', taskId: 't1', path: '/clientes/nota.txt', bytesWritten: 42, sha256Before: 'a', sha256After: 'b', tool: 'write' },
  { kind: 'denial', ts: '2026-07-11T06:02:00Z', session: 'sess-b', reason: 'caminho fora da autorização', principle: 'S2', tool: 'read' },
];

interface StubDaemon {
  server: Server;
  grants: Array<{ grantRef: string; label: string; path: string; scope: string; session: string; createdAt: string }>;
  revoked: string[];
  serveGrants: boolean;
}

function startStubDaemon(): Promise<StubDaemon> {
  const state: StubDaemon = {
    server: null as unknown as Server,
    grants: [
      { grantRef: 'g-contratos', label: 'Contratos 2026', path: '/clientes/contratos', scope: 'folder', session: 'sess-a', createdAt: '2026-07-11T05:00:00Z' },
      { grantRef: 'g-kyc', label: 'kyc-ficha.pdf', path: '/clientes/kyc', scope: 'file', session: 'sess-a', createdAt: '2026-07-11T05:10:00Z' },
    ],
    revoked: [],
    serveGrants: true,
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${DAEMON_PORT}`);
    // C2: CORS for the app origin; bind stays loopback-only.
    res.setHeader('access-control-allow-origin', 'http://localhost:3000');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/status') return json(200, { paired: true, pairingId: 'pair-e2e', connection: 'connected' });
    if (url.pathname === '/grants' && req.method === 'GET') {
      if (!state.serveGrants) return json(404, { error: 'not found' });
      return json(200, { grants: state.grants });
    }
    if (url.pathname === '/grants/revoke' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const { grantRef } = JSON.parse(raw) as { grantRef: string };
        state.revoked.push(grantRef);
        state.grants = state.grants.filter((g) => g.grantRef !== grantRef);
        json(200, { ok: true });
      });
      return;
    }
    if (url.pathname === '/ledger') {
      const session = url.searchParams.get('session');
      // D5: no session param → the all-sessions merge; a param → that session's rows only.
      const rows = session ? LEDGER_ROWS.filter((r) => r.session === session) : LEDGER_ROWS;
      return json(200, session ? { session, rows, corrupt: 0 } : { rows, corrupt: 0 });
    }
    return json(404, { error: 'not found' });
  });
  state.server = server;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(DAEMON_PORT, '127.0.0.1', () => resolve(state));
  });
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

function trackConsoleErrors(page: Page, opts: { allow?: (text: string, url: string) => boolean } = {}): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (opts.allow?.(msg.text(), msg.location()?.url ?? '')) return;
    errors.push(msg.text());
  });
  return errors;
}

async function stubConnectedPresence(page: Page) {
  expect(BridgeStatusResponse.safeParse(CONNECTED).success).toBe(true);
  await page.route('**/api/v1/bridge/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONNECTED) }),
  );
}

/** The ledger picker needs at least one hosted session; create one through the real API. */
async function ensureSession(page: Page): Promise<void> {
  const token = await page.evaluate(() => window.localStorage.getItem('ekoa_token'));
  const res = await page.request.post('http://localhost:4111/api/v1/sessions', {
    headers: { authorization: `Bearer ${token}` },
    data: { name: 'e2e-ledger-session' },
  });
  expect(res.status(), 'session create').toBeLessThan(300);
}

test.describe('daemon-served grants + ledger (FC-406/FC-407)', () => {
  let daemon: StubDaemon;

  test.beforeAll(async () => {
    daemon = await startStubDaemon();
  });
  test.afterAll(async () => {
    await new Promise<void>((r) => daemon.server.close(() => r()));
  });

  test('grants render live from the daemon and revoke round-trips', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    daemon.serveGrants = true;
    daemon.grants = [
      { grantRef: 'g-contratos', label: 'Contratos 2026', scope: 'folder', createdAt: '2026-07-11T05:00:00Z' },
      { grantRef: 'g-kyc', label: 'kyc-ficha.pdf', scope: 'file', createdAt: '2026-07-11T05:10:00Z' },
    ];
    daemon.revoked = [];

    await stubConnectedPresence(page);
    await login(page);
    await ensureSession(page);
    await page.goto('/settings/privacy');

    const grants = page.getByTestId('privacy-grants');
    await expect(grants.getByTestId('grants-list')).toBeVisible({ timeout: 15_000 });
    await expect(grants.getByText('Contratos 2026')).toBeVisible();
    await expect(grants.getByText('kyc-ficha.pdf')).toBeVisible();

    await grants.getByTestId('grant-revoke-g-contratos').click();
    await expect(grants.getByText('Contratos 2026')).not.toBeVisible({ timeout: 10_000 });
    await expect(grants.getByText('kyc-ficha.pdf')).toBeVisible();
    expect(daemon.revoked).toEqual(['g-contratos']);

    // FC-407: the ledger renders the daemon's rows (read + write + denial kinds).
    const ledger = page.getByTestId('privacy-ledger');
    await expect(ledger.getByTestId('ledger-rows')).toBeVisible({ timeout: 15_000 });
    await expect(ledger.getByTestId('ledger-row-read')).toBeVisible();
    await expect(ledger.getByTestId('ledger-row-write')).toBeVisible();
    await expect(ledger.getByTestId('ledger-row-denial')).toBeVisible();
    await expect(ledger.getByText('/clientes/contrato.txt')).toBeVisible();
    await expect(ledger.getByText('3,0 KB')).toBeVisible();

    expect(errors, `zero console errors, got: ${errors.join(' | ')}`).toEqual([]);
  });

  test('a daemon without C3 yields the honest unavailable state, never fabricated data', async ({ page }) => {
    // The pre-C3 daemon 404s /grants (React dev double-effect makes it two). Chrome logs
    // each expected 4xx as a resource console error WITHOUT a usable location URL, so the
    // allowance matches the message text: 404s are exactly this test's stimulus.
    const errors = trackConsoleErrors(page, {
      allow: (text) => text.includes('status of 404'),
    });
    daemon.serveGrants = false;

    await stubConnectedPresence(page);
    await login(page);
    await page.goto('/settings/privacy');

    const grants = page.getByTestId('privacy-grants');
    await expect(grants.getByTestId('grants-unavailable')).toBeVisible({ timeout: 15_000 });
    await expect(grants.getByText('Atualize a aplicação da ponte local.')).toBeVisible();

    expect(errors, `zero console errors, got: ${errors.join(' | ')}`).toEqual([]);
  });
});
