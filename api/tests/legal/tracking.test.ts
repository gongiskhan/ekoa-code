/**
 * Ported from cortex/tests/services/ctt-tracking.test.ts. Adapted harness: imports
 * from legal/tracking, and the deterministic mock fixture (RR123456789PT.json) is
 * written to a temp dir at setup instead of a committed cortex fixture; the
 * integration config is the injected `loadConfig` seam. Assertions carried verbatim.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  trackShipment,
  mapStatusPt,
  normalizeTrackingJson,
  isNonTrackablePrefix,
  TRACKING_ID_RE,
  type TrackingDeps,
  type TrackFetchImpl,
} from '../../src/legal/tracking.js';

let FIXTURES_DIR: string;

beforeAll(async () => {
  FIXTURES_DIR = await mkdtemp(join(tmpdir(), 'ekoa-ctt-'));
  await writeFile(
    join(FIXTURES_DIR, 'RR123456789PT.json'),
    JSON.stringify({
      status: 'entregue',
      events: [
        { date: '2026-06-01T09:00:00Z', statusPt: 'Aceite pelos CTT', location: 'CTT Lisboa' },
        { date: '2026-06-02T14:00:00Z', statusPt: 'Em trânsito', location: 'Centro de Distribuição Postal' },
        { date: '2026-06-03T11:00:00Z', statusPt: 'Entregue ao destinatário', location: 'Lisboa' },
      ],
    }),
  );
});
afterAll(async () => {
  await rm(FIXTURES_DIR, { recursive: true, force: true });
});

/** A fetchImpl seam that always answers with the given JSON body + 200 ok. */
function fakeFetch(json: unknown, opts: { ok?: boolean; status?: number } = {}): TrackFetchImpl {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  return async () => ({
    ok,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  });
}

describe('ctt-tracking · format + prefix guards', () => {
  it('accepts the UPU format XX000000000XX', () => {
    expect(TRACKING_ID_RE.test('RR123456789PT')).toBe(true);
    expect(TRACKING_ID_RE.test('RR12345678PT')).toBe(false); // 8 digits
    expect(TRACKING_ID_RE.test('rr123456789pt')).toBe(false); // lowercase
  });

  it('flags Q/U/JA prefixes as non-trackable', () => {
    expect(isNonTrackablePrefix('QA123456789PT')).toBe(true);
    expect(isNonTrackablePrefix('UZ123456789PT')).toBe(true);
    expect(isNonTrackablePrefix('JA123456789PT')).toBe(true);
    expect(isNonTrackablePrefix('RR123456789PT')).toBe(false);
  });

  it('rejects an invalid identifier with a clean PT error, no provider call', async () => {
    let fetched = false;
    const deps: TrackingDeps = {
      env: { EKOA_TRACKING_MOCK: '1' },
      fetchImpl: async () => {
        fetched = true;
        return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
      },
    };
    const res = await trackShipment('NOT-A-CODE', deps);
    expect(res.ok).toBe(false);
    expect(res.provider).toBe('none');
    expect(res.status).toBe('desconhecido');
    expect(res.error).toMatch(/inválido/i);
    expect(fetched).toBe(false);
  });

  it('returns desconhecido (ok:true) with a PT note for Q/U/JA objects', async () => {
    const res = await trackShipment('QA123456789PT', { env: { EKOA_TRACKING_MOCK: '1' }, fixturesDir: FIXTURES_DIR });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe('none');
    expect(res.status).toBe('desconhecido');
    expect(res.note).toMatch(/Q\/U\/JA/);
  });
});

describe('ctt-tracking · provider chain', () => {
  it('returns a clean "no provider" error when nothing is configured', async () => {
    const res = await trackShipment('RR123456789PT', { loadConfig: async () => null, env: {} });
    expect(res.ok).toBe(false);
    expect(res.provider).toBe('none');
    expect(res.error).toMatch(/Nenhum fornecedor/i);
  });

  it('falls back to the mock ONLY when EKOA_TRACKING_MOCK=1', async () => {
    const withoutEnv = await trackShipment('RR999999999PT', { loadConfig: async () => null, env: {} });
    expect(withoutEnv.provider).toBe('none');

    const withEnv = await trackShipment('RR999999999PT', {
      loadConfig: async () => null,
      env: { EKOA_TRACKING_MOCK: '1' },
      fixturesDir: FIXTURES_DIR,
    });
    expect(withEnv.provider).toBe('mock');
  });

  it('replays a deterministic fixture through the mock provider', async () => {
    const res = await trackShipment('RR123456789PT', {
      loadConfig: async () => null,
      env: { EKOA_TRACKING_MOCK: '1' },
      fixturesDir: FIXTURES_DIR,
    });
    expect(res.ok).toBe(true);
    expect(res.provider).toBe('mock');
    expect(res.status).toBe('entregue');
    expect(res.events).toHaveLength(3);
    expect(res.events[0]!.statusPt).toMatch(/Aceite/);
    expect(res.events[2]!.location).toBe('Lisboa');
  });

  it('synthesizes em_transito for an RR…PT id with no fixture', async () => {
    const res = await trackShipment('RR999999999PT', {
      loadConfig: async () => null,
      env: { EKOA_TRACKING_MOCK: '1' },
      fixturesDir: FIXTURES_DIR,
    });
    expect(res.provider).toBe('mock');
    expect(res.status).toBe('em_transito');
    expect(res.events.length).toBeGreaterThan(0);
  });

  it('returns desconhecido for a non-RR id with no fixture', async () => {
    const res = await trackShipment('LX123456789PT', {
      loadConfig: async () => null,
      env: { EKOA_TRACKING_MOCK: '1' },
      fixturesDir: FIXTURES_DIR,
    });
    expect(res.provider).toBe('mock');
    expect(res.status).toBe('desconhecido');
    expect(res.note).toBeTruthy();
  });

  it('prefers ctt-direct over the mock when its config is present (fallback order)', async () => {
    const deps: TrackingDeps = {
      loadConfig: async (type) => (type === 'ctt-tracking' ? { base_url: 'https://ctt.example', api_key: 'k' } : null),
      env: { EKOA_TRACKING_MOCK: '1' },
      fixturesDir: FIXTURES_DIR,
      fetchImpl: fakeFetch({
        events: [
          { date: '2026-06-01T10:00:00Z', status: 'Aceite pelos CTT' },
          { date: '2026-06-03T09:00:00Z', status: 'Entregue', location: 'Porto' },
        ],
      }),
    };
    const res = await trackShipment('RR123456789PT', deps);
    expect(res.provider).toBe('ctt-direct');
    expect(res.status).toBe('entregue');
    expect(res.events.at(-1)?.location).toBe('Porto');
  });

  it('uses the aggregator when ctt-direct is unconfigured but the aggregator is', async () => {
    const deps: TrackingDeps = {
      loadConfig: async (type) => (type === 'ctt-aggregator' ? { endpoint: 'https://agg.example', token: 't' } : null),
      env: {},
      fetchImpl: fakeFetch({ status: 'Em trânsito', events: [{ data: '2026-06-02', estado: 'Expedido' }] }),
    };
    const res = await trackShipment('RR123456789PT', deps);
    expect(res.provider).toBe('aggregator');
    expect(res.status).toBe('em_transito');
  });

  it('degrades to a PT error when the configured provider is unreachable', async () => {
    const deps: TrackingDeps = {
      loadConfig: async (type) => (type === 'ctt-tracking' ? { base_url: 'https://ctt.example', api_key: 'k' } : null),
      env: {},
      fetchImpl: async () => {
        throw new Error('network down');
      },
    };
    const res = await trackShipment('RR123456789PT', deps);
    expect(res.provider).toBe('ctt-direct');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/indisponível/i);
  });
});

describe('ctt-tracking · normalization helpers', () => {
  it('maps PT/EN status text to the canonical enum', () => {
    expect(mapStatusPt('Entregue ao destinatário')).toBe('entregue');
    expect(mapStatusPt('Delivered')).toBe('entregue');
    expect(mapStatusPt('Em trânsito')).toBe('em_transito');
    expect(mapStatusPt('Aceite pelos CTT')).toBe('aceite');
    expect(mapStatusPt('Objeto devolvido')).toBe('devolvido');
    expect(mapStatusPt('qualquer coisa estranha')).toBe('desconhecido');
    expect(mapStatusPt('')).toBe('desconhecido');
  });

  it('derives the overall status from the latest event by date', () => {
    const res = normalizeTrackingJson(
      { events: [{ date: '2026-06-03', status: 'Entregue' }, { date: '2026-06-01', status: 'Aceite' }] },
      'RR123456789PT',
      'ctt-direct',
    );
    expect(res.status).toBe('entregue'); // latest by date, not by array order
    expect(res.events).toHaveLength(2);
  });
});
