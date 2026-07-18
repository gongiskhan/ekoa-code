/**
 * Legal-suite served-app plane — contract tests (ch03 §3.9, ch07 §7.14, §8.10).
 * Mounts the legal router, the Adobe Sign router and the design-tokens handler on a
 * bare express app with STUB injected deps (no mongo), the served-app.test.ts way.
 * Asserts the byte-compatible access gate (missing header, non-allowlisted 403 PT,
 * sliding-window 429 PT + blocked-hit-not-recorded), the Amendment-2 owner-activation
 * layer (CONV-2 403/402, validated against the shared ErrorEnvelope), the citius
 * fixture parse, transcricao mock determinism, the signature/adobe gate, and the
 * design-tokens org isolation. Success bodies validate against the shared descriptor.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ErrorEnvelope, servedAppEndpoints } from '@ekoa/shared';
import { legalRouter, type ResolvedLegalApp } from '../../src/legal/index.js';
import { adobeSignRouter } from '../../src/integrations/adobe-sign.js';
import { designTokensHandler, type OrgBrand } from '../../src/services/design-tokens.js';
import type { ActivationState } from '../../src/data/activation.js';
import type { FetchImpl as CitiusFetchImpl, FetchLikeResponse } from '../../src/legal/citius.js';

const citiusFixture = readFileSync(fileURLToPath(new URL('../e2e/fixtures/citius-consulta.html', import.meta.url)));

// --- Stub injected deps -----------------------------------------------------
// Allowlisted apps map to a registered owner; a few resolve to a deactivated /
// billing-locked owner (Amendment 2) or to null (unregistered).
const APPS: Record<string, ResolvedLegalApp | null> = {
  'legal-calculos': { appId: 'legal-calculos', ownerUserId: 'owner-active' },
  'legal-pesquisa': { appId: 'legal-pesquisa', ownerUserId: 'owner-active' },
  'legal-correio': { appId: 'legal-correio', ownerUserId: 'owner-active' },
  'legal-citius': { appId: 'legal-citius', ownerUserId: 'owner-active' }, // registered
  'legal-transcricao': { appId: 'legal-transcricao', ownerUserId: 'owner-active' },
  'legal-cobrancas': { appId: 'legal-cobrancas', ownerUserId: 'owner-disabled' }, // allowlisted (calculos), deactivated owner
  'legal-honorarios': { appId: 'legal-honorarios', ownerUserId: 'owner-locked' }, // allowlisted (calculos), billing-locked owner
  'legal-injuncoes': { appId: 'legal-injuncoes', ownerUserId: 'owner-missing' }, // allowlisted (calculos), owner with NO activation record
  // 'legal-prazos' is citius-allowlisted but NOT registered (resolveApp -> null)
};
const ACTIVATION: Record<string, ActivationState> = {
  'owner-active': { active: true, billingLocked: false, tokenEpoch: 0 },
  'owner-disabled': { active: false, billingLocked: false, tokenEpoch: 0 },
  'owner-locked': { active: true, billingLocked: true, tokenEpoch: 0 },
};

let clock = 1_700_000_000_000;
const recordedStt: Array<Record<string, unknown>> = [];
const transcricaoRows: Record<string, Record<string, unknown>> = { t1: { estado: 'a_transcrever' } };

const citiusFetch: CitiusFetchImpl = async (): Promise<FetchLikeResponse> => ({
  status: 200,
  ok: true,
  headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
  arrayBuffer: async () => citiusFixture.buffer.slice(citiusFixture.byteOffset, citiusFixture.byteOffset + citiusFixture.byteLength) as ArrayBuffer,
});

const brandFor = async (appIdOrSlug: string): Promise<OrgBrand | null> => {
  if (appIdOrSlug === 'app-a') return { branding: { primaryColor: '#AA0000' } };
  if (appIdOrSlug === 'app-b') return { branding: { primaryColor: '#00BB00' } };
  return null;
};

let server: Server;
let port: number;

// mega-run E1 — a dossiê's own portal-sourced documentos/eventos rows, keyed by owner
// (the shared owner-spine), pre-seeded exactly as attachPortalDocument/attachPortalEvent
// would leave them (api/tests/legal/portal.test.ts exercises those functions directly;
// this file only exercises the READ route + gate, no mongo needed here either).
const portalDocumentos: Record<string, Array<Record<string, unknown>>> = {
  'owner-active': [
    {
      nome: 'Certidão comercial - certidao-permanente',
      tipo: 'certidao-permanente',
      processoId: 'proc-1',
      data: '2026-07-18',
      origem: 'portal',
      ficheiro: { fileId: 'f1', appId: 'legal-dossie', url: '/api/app-files/legal-dossie/f1', mime: 'application/pdf', size: 111 },
      versao: 1,
      source: 'certidao-comercial',
      subjectIds: ['500000000'],
      retrievedAt: '2026-07-18T10:00:00.000Z',
    },
  ],
};
const portalEventos: Record<string, Array<Record<string, unknown>>> = {
  'owner-active': [
    {
      processoId: 'proc-1',
      titulo: 'Nova publicação encontrada',
      data: '2026-07-18',
      tipo: 'portal.watch.hit',
      origem: 'portal',
      source: 'citius-insolvencia',
      kind: 'watch.hit',
      subjectRef: 'Contraparte Lda',
      observedAt: '2026-07-18T11:00:00.000Z',
      payload: {},
    },
  ],
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    legalRouter({
      resolveApp: async (h) => APPS[h] ?? null,
      getActivation: (u) => ACTIVATION[u],
      now: () => clock,
      research: { searchImpl: () => [] }, // empty index -> ok:true, hits:[], note
      tracking: { env: { EKOA_TRACKING_MOCK: '1' } },
      citius: { fetchImpl: citiusFetch },
      transcricao: {
        getRow: async (_app, _col, id) => transcricaoRows[id] ?? null,
        updateRow: async (_app, _col, id, patch) => {
          transcricaoRows[id] = { ...(transcricaoRows[id] ?? {}), ...patch };
        },
        recordUsage: (u) => {
          recordedStt.push(u as Record<string, unknown>);
        },
      },
      portal: {
        getOwnerOrgId: async () => 'org-legal',
        createDocumento: async (a, row) => {
          (portalDocumentos[a.ownerUserId] ??= []).push(row);
          return row;
        },
        createEvento: async (a, row) => {
          (portalEventos[a.ownerUserId] ??= []).push(row);
          return row;
        },
        listDocumentos: async (a, processoId) => (portalDocumentos[a.ownerUserId] ?? []).filter((r) => r.processoId === processoId),
        listEventos: async (a, processoId) => (portalEventos[a.ownerUserId] ?? []).filter((r) => r.processoId === processoId),
      },
    }),
  );
  app.use(adobeSignRouter({ resolveApp: async (h) => APPS[h] ?? null }));
  app.get('/api/design-tokens.css', designTokensHandler({ resolveOrgBrand: brandFor }));
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  port = (server.address() as { port: number }).port;
});
afterAll(() => {
  server.close();
});
// Advance the injected clock past the window between tests so per-test rate
// windows never bleed into each other.
beforeEach(() => {
  clock += 120_000;
});

const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const appApi = (p: string, appId: string, init: RequestInit = {}) => api(p, { ...init, headers: { 'x-ekoa-app-id': appId, ...(init.headers ?? {}) } });

describe('legal-suite gate — header + charset + allowlist (byte-compat)', () => {
  it('missing X-Ekoa-App-Id header -> 400 (all five endpoints)', async () => {
    expect((await api('/api/legal/calculos', { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await api('/api/legal/transcricao', { method: 'POST', body: '{}' })).status).toBe(400);
    expect((await api('/api/legal-research?q=x')).status).toBe(400);
    expect((await api('/api/tracking/consulta?tracking=RR123456789PT')).status).toBe(400);
    const c = await api('/api/citius/consulta?processo=1');
    expect(c.status).toBe(400);
    expect(await c.json()).toEqual({ error: 'Missing X-Ekoa-App-Id header' });
  });

  it('non-allowlisted app -> 403 with the PT-PT refusal', async () => {
    const res = await appApi('/api/legal-research?q=x', 'not-a-legal-app');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Aplicação não autorizada para esta consulta.' });
  });

  it('citius has its own PT refusal and requires registration', async () => {
    const forbidden = await appApi('/api/citius/consulta?processo=1', 'not-a-legal-app');
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: 'Aplicação não autorizada para a consulta Citius' });
    // allowlisted (legal-prazos) but not registered -> 404 Unknown app
    const unregistered = await appApi('/api/citius/consulta?processo=1', 'legal-prazos');
    expect(unregistered.status).toBe(404);
    expect(await unregistered.json()).toEqual({ error: 'Unknown app' });
  });

  it('an invalid-charset header id -> 400 Invalid', async () => {
    const res = await appApi('/api/legal-research?q=x', 'bad id;with spaces');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid X-Ekoa-App-Id header' });
  });
});

describe('legal-suite — happy paths validate against the shared descriptor', () => {
  it('POST /api/legal/calculos (juros) -> ok:true with the source-cited troços', async () => {
    const res = await appApi('/api/legal/calculos', 'legal-calculos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'juros', params: { valor: 10000, dataVencimento: '2023-04-01', dataFim: '2023-09-30', tipoJuro: 'comercial' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tipo: string; resultado: { total: number }; avisoTabelas: unknown };
    expect(body.ok).toBe(true);
    expect(body.tipo).toBe('juros');
    expect(body.resultado.total).toBe(560.96);
    expect(body.avisoTabelas).toBeTruthy();
    expect(servedAppEndpoints.legalCalculos!.response!.safeParse(body).success).toBe(true);
  });

  it('POST /api/legal/calculos with an invalid tipo -> 400 PT', async () => {
    const res = await appApi('/api/legal/calculos', 'legal-calculos', { method: 'POST', body: JSON.stringify({ tipo: 'nope' }) });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toMatchObject({ error: expect.stringContaining('tipo de cálculo inválido') });
  });

  it('POST /api/legal/calculos with a validation-refused engine input -> 400 with the engine message', async () => {
    const res = await appApi('/api/legal/calculos', 'legal-calculos', {
      method: 'POST',
      body: JSON.stringify({ tipo: 'juros', params: { dataVencimento: '2024-01-01', dataFim: '2024-12-31', tipoJuro: 'civil' } }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/capital em falta/i);
  });

  it('GET /api/legal-research (empty index) -> ok:true, hits:[], PT note', async () => {
    const res = await appApi('/api/legal-research?q=prescrição&sources=dgsi,dre', 'legal-pesquisa');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; hits: unknown[]; note?: string };
    expect(body.ok).toBe(true);
    expect(body.hits).toEqual([]);
    expect(body.note).toBeTruthy();
    expect(servedAppEndpoints.legalResearch!.response!.safeParse(body).success).toBe(true);
  });

  it('GET /api/legal-research without q -> 400 PT', async () => {
    const res = await appApi('/api/legal-research', 'legal-pesquisa');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Parâmetro "q" em falta' });
  });

  it('GET /api/tracking/consulta (mock) -> em_transito', async () => {
    const res = await appApi('/api/tracking/consulta?tracking=RR123456789PT', 'legal-correio');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string; provider: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe('em_transito');
    expect(servedAppEndpoints.trackingConsulta!.response!.safeParse(body).success).toBe(true);
  });

  it('GET /api/citius/consulta parses the committed fixture into publicações', async () => {
    const res = await appApi('/api/citius/consulta?processo=1234/26.0T8LSB', 'legal-citius');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { processo: string; publicacoes: Array<{ processo: string; ato: string }> };
    expect(body.processo).toBe('1234/26.0T8LSB');
    expect(body.publicacoes).toHaveLength(2);
    expect(body.publicacoes[0]!.ato).toBe('Citação');
    expect(servedAppEndpoints.citiusConsulta!.response!.safeParse(body).success).toBe(true);
  });

  it('GET /api/legal/portal returns the dossiê\'s portal-sourced documents + events, validated against the shared descriptor', async () => {
    // 'legal-citius' is the registered PORTAL_ALLOWED_APPS member in this fixture map
    // (legal-dossie/legal-nucleo/legal-prazos are allowlisted-but-unregistered here, same
    // as the citius happy-path test above).
    const res = await appApi('/api/legal/portal?processoId=proc-1', 'legal-citius');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { documentos: unknown[]; eventos: unknown[] };
    expect(body.documentos).toHaveLength(1);
    expect(body.eventos).toHaveLength(1);
    expect(servedAppEndpoints.legalPortalDossier!.response!.safeParse(body).success).toBe(true);
  });

  it('GET /api/legal/portal for a dossiê with no portal activity -> 200, empty arrays', async () => {
    const res = await appApi('/api/legal/portal?processoId=proc-none', 'legal-citius');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documentos: [], eventos: [] });
  });
});

describe('GET /api/legal/portal — gate (mega-run E1, same discipline as citius)', () => {
  it('missing processoId -> 400 PT', async () => {
    const res = await appApi('/api/legal/portal', 'legal-citius');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Parâmetro "processoId" em falta' });
  });

  it('non-allowlisted app -> 403 PT', async () => {
    const res = await appApi('/api/legal/portal?processoId=proc-1', 'not-a-legal-app');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Aplicação não autorizada para consultar o dossiê' });
  });

  it('allowlisted but unregistered app -> 404 Unknown app', async () => {
    const res = await appApi('/api/legal/portal?processoId=proc-1', 'legal-prazos');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Unknown app' });
  });

  it('missing X-Ekoa-App-Id header -> 400', async () => {
    const res = await api('/api/legal/portal?processoId=proc-1');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Missing X-Ekoa-App-Id header' });
  });
});

describe('legal-transcricao — deterministic mock engine', () => {
  it('same WAV request -> the same transcript shape (mock, 6 segments, 181.2s)', async () => {
    const call = () => appApi('/api/legal/transcricao', 'legal-transcricao', { method: 'POST', body: JSON.stringify({ transcricaoId: 't1' }) });
    const a = (await (await call()).json()) as { ok: boolean; engine: string; durationSec: number; segmentos: number };
    const b = (await (await call()).json()) as typeof a;
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect(a.engine).toBe('mock');
    expect(a.durationSec).toBe(181.2);
    expect(a.segmentos).toBe(6);
    expect(recordedStt.some((r) => r.agentType === 'stt:mock')).toBe(true);
  });

  it('unknown transcricaoId -> 404 PT', async () => {
    const res = await appApi('/api/legal/transcricao', 'legal-transcricao', { method: 'POST', body: JSON.stringify({ transcricaoId: 'ghost' }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Transcrição não encontrada.' });
  });

  it('missing transcricaoId -> 400 PT', async () => {
    const res = await appApi('/api/legal/transcricao', 'legal-transcricao', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'transcricaoId em falta.' });
  });
});

describe('Amendment 2 — owner activation gates the plane (CONV-2 envelope)', () => {
  it('a deactivated owner -> 403 ACCOUNT_DISABLED', async () => {
    const res = await appApi('/api/legal/calculos', 'legal-cobrancas', { method: 'POST', body: JSON.stringify({ tipo: 'tabela' }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });

  it('a billing-locked owner -> 402 BILLING_LOCKED', async () => {
    const res = await appApi('/api/legal/calculos', 'legal-honorarios', { method: 'POST', body: JSON.stringify({ tipo: 'tabela' }) });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body as { error: { code: string } }).error.code).toBe('BILLING_LOCKED');
  });

  it('an owner with no activation record fails CLOSED -> 403 ACCOUNT_DISABLED (ch09)', async () => {
    const res = await appApi('/api/legal/calculos', 'legal-injuncoes', { method: 'POST', body: JSON.stringify({ tipo: 'tabela' }) });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('legal-suite rate limits — 429 PT + a blocked hit is not recorded', () => {
  it('legal-research (4/min per app): the 5th is 429, and blocked hits do not extend the cooldown', async () => {
    const t0 = clock; // window origin
    const hit = () => appApi('/api/legal-research?q=x&verify=0', 'legal-pesquisa');

    // 4 succeed within the window.
    for (let i = 0; i < 4; i++) expect((await hit()).status).toBe(200);
    // the 5th is rate-limited (429) with the PT message.
    const limited = await hit();
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: string }).error).toMatch(/Tente novamente dentro de um minuto/);

    // 30s later, still within the window -> more requests are blocked (429).
    clock = t0 + 30_000;
    for (let i = 0; i < 5; i++) expect((await hit()).status).toBe(429);

    // 61s after the origin: the 4 recorded hits have expired. If the blocked hits
    // at t0+30s had been recorded they would still be in-window and this would 429;
    // because a blocked caller's hit is NOT recorded, the window is empty -> 200.
    clock = t0 + 61_000;
    expect((await hit()).status).toBe(200);
  });
});

describe('signature/send + adobe-sign gate (requireAdobeAppContext)', () => {
  it('missing header -> 400; unknown app -> 404', async () => {
    expect((await api('/api/signature/send', { method: 'POST', body: '{}' })).status).toBe(400);
    const unknown = await appApi('/api/signature/send', 'no-such-app', { method: 'POST', body: JSON.stringify({ recipients: [] }) });
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'Unknown app' });
  });

  it('registered app, no Adobe connection -> 409 not_connected (default backend)', async () => {
    const res = await appApi('/api/signature/send', 'legal-calculos', {
      method: 'POST',
      body: JSON.stringify({ title: 'Doc', recipients: [{ email: 'a@b.pt' }] }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('not_connected');
  });

  it('GET /api/adobe-sign/status -> connected:false for the default backend', async () => {
    const res = await appApi('/api/adobe-sign/status', 'legal-calculos');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });

  it('the webhook echoes X-AdobeSign-ClientId (deliberately public)', async () => {
    const res = await api('/api/adobe-sign/webhook', { method: 'GET', headers: { 'x-adobesign-clientid': 'cid-123' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-adobesign-clientid')).toBe('cid-123');
    expect(await res.json()).toEqual({ xAdobeSignClientId: 'cid-123' });
  });
});

describe('design-tokens.css — Amendment 2 org isolation on the plane', () => {
  it('an app of org A never receives org B tokens; a no-brand app gets the platform default', async () => {
    const a = await (await api('/api/design-tokens.css?app=app-a')).text();
    const b = await (await api('/api/design-tokens.css?app=app-b')).text();
    const none = await (await api('/api/design-tokens.css?app=unknown')).text();
    expect(a).toContain('--color-primary: #AA0000;');
    expect(a).not.toContain('#00BB00');
    expect(b).toContain('--color-primary: #00BB00;');
    expect(none).toContain('--color-primary: #0F766E;'); // platform default
  });
});
