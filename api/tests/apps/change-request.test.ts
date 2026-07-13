import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * H4 change request (non-admins) - BEHAVIOURAL unit tests of the panel's file-request controller
 * (api/assets/panel-runtime/src/change-request.js) + SOURCE-contract pins on AssistantPanel.jsx.
 *
 * The controller is a browser ASSET compiled by esbuild (outside the tsc program), so it is
 * imported at RUNTIME via its file URL and driven with a FAKE fetch - proving the real network
 * flow: the filing POSTs the thin platform endpoint `/api/v1/change-requests` with the served-app
 * `X-Ekoa-App-Id` header + the platform Bearer, and REQUIRES a logged-in user (no token / a 401
 * both resolve to the calm `needs-login` outcome the panel renders as "inicie sessão"). This is a
 * SEPARATE plane from the visitor-blind POST /api/app-assistant, which stays untouched.
 */

type FetchInit = { method?: string; headers?: Record<string, string>; body?: string };
type FetchImpl = (url: string, init?: FetchInit) => Promise<unknown>;
interface ChangeRequestApi {
  CHANGE_REQUESTS_ENDPOINT: string;
  REQUEST_COPY: Record<string, string>;
  fileChangeRequest(a: { fetchImpl: FetchImpl; appId?: string; token?: string; text: string; route?: string; screenState?: string }): Promise<{ outcome: string; status?: number; request?: unknown }>;
}

const MODULE_URL = new URL('../../assets/panel-runtime/src/change-request.js', import.meta.url);
const MODULE_SRC = readFileSync(fileURLToPath(MODULE_URL), 'utf-8');
const PANEL_URL = new URL('../../assets/panel-runtime/src/AssistantPanel.jsx', import.meta.url);
const PANEL_SRC = readFileSync(fileURLToPath(PANEL_URL), 'utf-8');

let cr: ChangeRequestApi;
beforeAll(async () => {
  cr = (await import(/* @vite-ignore */ MODULE_URL.href)) as unknown as ChangeRequestApi;
});

interface Recorded { url: string; method: string; headers: Record<string, string>; body?: string }
function jsonRes(status: number, data: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}
/** A fetch that records every call and answers the change-requests endpoint per the scenario. */
function scenario(opts: { status?: number; data?: unknown; throwErr?: boolean }) {
  const calls: Recorded[] = [];
  const fetchImpl: FetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    if (opts.throwErr) throw new Error('network down');
    return jsonRes(opts.status ?? 200, opts.data ?? { id: 'c1', orgId: 'orgB', requesterUserId: 'u', requesterName: 'u', text: 't', status: 'open', createdAt: '2026-07-13T00:00:00.000Z' });
  };
  return { fetchImpl, calls };
}

describe('H4 change-request controller: fileChangeRequest (fake fetch)', () => {
  it('files with the served-app header + Bearer, capturing route + screen; 2xx -> filed', async () => {
    const s = scenario({ status: 200 });
    const res = await cr.fileChangeRequest({ fetchImpl: s.fetchImpl, appId: 'appX', token: 'tok', text: '  Adicione um botão  ', route: '/faturas', screenState: 'Tabela de honorários' });
    expect(res.outcome).toBe('filed');
    expect(s.calls.length).toBe(1);
    const call = s.calls[0]!;
    expect(call.url).toBe(cr.CHANGE_REQUESTS_ENDPOINT);
    expect(call.url).toBe('/api/v1/change-requests');
    expect(call.method).toBe('POST');
    expect(call.headers['X-Ekoa-App-Id']).toBe('appX');
    expect(call.headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse(call.body || '{}') as { text: string; route?: string; screenState?: string };
    expect(body.text).toBe('Adicione um botão'); // trimmed
    expect(body.route).toBe('/faturas');
    expect(body.screenState).toBe('Tabela de honorários');
  });

  it('no token -> needs-login BEFORE any call (filing requires a session)', async () => {
    const s = scenario({ status: 200 });
    const res = await cr.fileChangeRequest({ fetchImpl: s.fetchImpl, appId: 'appX', token: '', text: 'olá' });
    expect(res.outcome).toBe('needs-login');
    expect(s.calls.length).toBe(0);
  });

  it('a 401 -> needs-login (the calm "inicie sessão" note)', async () => {
    const s = scenario({ status: 401, data: { error: { code: 'UNAUTHENTICATED', message: 'x' } } });
    const res = await cr.fileChangeRequest({ fetchImpl: s.fetchImpl, appId: 'appX', token: 'expired', text: 'olá' });
    expect(res.outcome).toBe('needs-login');
  });

  it('no app id -> failed (nothing to scope to); empty text -> failed; a network throw -> failed', async () => {
    const s1 = scenario({ status: 200 });
    expect((await cr.fileChangeRequest({ fetchImpl: s1.fetchImpl, appId: '', token: 'tok', text: 'olá' })).outcome).toBe('failed');
    expect(s1.calls.length).toBe(0);
    const s2 = scenario({ status: 200 });
    expect((await cr.fileChangeRequest({ fetchImpl: s2.fetchImpl, appId: 'appX', token: 'tok', text: '   ' })).outcome).toBe('failed');
    const s3 = scenario({ throwErr: true });
    expect((await cr.fileChangeRequest({ fetchImpl: s3.fetchImpl, appId: 'appX', token: 'tok', text: 'olá' })).outcome).toBe('failed');
  });

  it('a 403/500 -> failed carrying the status', async () => {
    const s = scenario({ status: 403, data: { error: { code: 'FORBIDDEN', message: 'x' } } });
    const res = await cr.fileChangeRequest({ fetchImpl: s.fetchImpl, appId: 'appX', token: 'tok', text: 'olá' });
    expect(res.outcome).toBe('failed');
    expect(res.status).toBe(403);
  });

  it('the needs-login copy is the calm PT-PT login line; the controller carries no emoji', () => {
    expect((cr.REQUEST_COPY.needsLogin ?? '').toLowerCase()).toContain('inicie sessão');
    expect(MODULE_SRC.match(/\p{Extended_Pictographic}/u)).toBeNull();
    // A separate plane: the controller targets the platform queue endpoint, never the visitor assistant.
    expect(MODULE_SRC).toContain('/api/v1/change-requests');
    expect(MODULE_SRC).not.toContain('/api/app-assistant');
  });
});

describe('H4 change-request panel: source-contract pins (AssistantPanel.jsx)', () => {
  it('the "Pedir alteração" affordance is gated by admin === false (non-admins only)', () => {
    // The request section renders only when !admin (an admin uses edit mode instead).
    expect(PANEL_SRC).toMatch(/\{!admin \?[\s\S]*ekoa-assistant-request/);
    // The button is present in the idle phase.
    expect(PANEL_SRC).toContain('ekoa-assistant-request-open');
  });

  it('submit captures the current route + screen and files via the change-request controller', () => {
    expect(PANEL_SRC).toMatch(/from '\.\/change-request'/);
    // submitRequest passes the captured route + screen context to the controller.
    expect(PANEL_SRC).toMatch(/fileChangeRequest\(\{[\s\S]*route: currentRoute\(\)[\s\S]*screenState: captureScreenState\(\)/);
    // The three outcomes map to the calm notes (filed / needs-login / failed).
    expect(PANEL_SRC).toContain("result.outcome === 'filed'");
    expect(PANEL_SRC).toContain("result.outcome === 'needs-login'");
  });
});
