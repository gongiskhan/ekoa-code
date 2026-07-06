/**
 * Rastreio de objetos CTT — adaptador de tracking com fornecedores em cadeia.
 *
 * DESENHADO COMO COSTURA (seam), não como integração viva. Hoje NENHUM fornecedor
 * real está configurado: `ctt-direct` e `aggregator` reportam `isConfigured:false`
 * e a cadeia degrada para o fornecedor `mock` (apenas com `EKOA_TRACKING_MOCK=1`).
 *
 * Ordem da cadeia (primeiro configurado ganha): ctt-direct → aggregator → mock.
 *
 * NOTA DE DOMÍNIO — objetos sem rastreio: os CTT não disponibilizam rastreio para
 * certos tipos de objeto (código a começar por Q, U ou JA). Esses devolvem
 * `status:'desconhecido'`, sem chamar qualquer fornecedor.
 *
 * Formato do identificador (padrão UPU): duas letras + nove dígitos + duas letras
 * de país, ex.: `RR123456789PT`.
 *
 * Carried from cortex/src/services/ctt-tracking.ts (B21, adapt): the integration
 * credential store is an INJECTED `loadConfig` seam (default: no provider
 * configured); the default HTTP fetch rides the SSRF-guarded `guardedFetch`.
 */
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { guardedFetch } from '../services/url-fetcher.js';

/** Formato UPU típico: XX 000000000 XX (2 letras, 9 dígitos, 2 letras de país). */
export const TRACKING_ID_RE = /^[A-Z]{2}[0-9]{9}[A-Z]{2}$/;

export type TrackingStatus = 'aceite' | 'em_transito' | 'entregue' | 'devolvido' | 'desconhecido';

export interface TrackingEvent {
  date: string;
  statusPt: string;
  location?: string;
}

export interface TrackingResult {
  ok: boolean;
  trackingId: string;
  /** 'ctt-direct' | 'aggregator' | 'mock' | 'none'. */
  provider: string;
  status: TrackingStatus;
  events: TrackingEvent[];
  error?: string;
  note?: string;
}

/** Resposta mínima de que o adaptador precisa — compatível com o `fetch` global. */
export interface TrackFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type TrackFetchImpl = (url: string, init?: { method?: string; headers?: Record<string, string> }) => Promise<TrackFetchResponse>;

/** Costuras injetáveis — os testes fornecem-nas; produção usa os defaults. */
export interface TrackingDeps {
  /** Resolve os campos de credencial de uma integração por tipo (default: null). */
  loadConfig?: (type: string) => Promise<Record<string, string> | null>;
  /** Costura de `fetch` para os fornecedores HTTP reais. */
  fetchImpl?: TrackFetchImpl;
  /** Diretório dos fixtures do fornecedor mock. */
  fixturesDir?: string;
  /** Ambiente (para o flag EKOA_TRACKING_MOCK). Por omissão `process.env`. */
  env?: Record<string, string | undefined>;
}

export interface TrackingProvider {
  key: 'ctt-direct' | 'aggregator' | 'mock';
  isConfigured(deps: TrackingDeps): Promise<boolean>;
  track(trackingId: string, deps: TrackingDeps): Promise<TrackingResult>;
}

const HTTP_TIMEOUT_MS = 8_000;

/** Default HTTP fetch: SSRF-guarded. Tests inject their own. */
const defaultFetch: TrackFetchImpl = async (url, init) => {
  return guardedFetch(url, { method: init?.method ?? 'GET', headers: init?.headers, timeoutMs: HTTP_TIMEOUT_MS });
};

/** Fold de acentos para mapeamento de estados tolerante (ç/ã/õ/é → c/a/o/e). */
function fold(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

/** Mapeia texto de estado (PT ou EN) do portal para o enum canónico. */
export function mapStatusPt(text: string): TrackingStatus {
  const t = fold(text);
  if (!t) return 'desconhecido';
  if (/entreg|delivered/.test(t)) return 'entregue';
  if (/devolv|return/.test(t)) return 'devolvido';
  if (/transit|expedi|encaminhad|a caminho|distribuic|out for delivery|em curso/.test(t)) return 'em_transito';
  if (/aceit|accepted|registad|recolhid|received|aguarda entrada/.test(t)) return 'aceite';
  return 'desconhecido';
}

/**
 * Normaliza um corpo JSON genérico de portal de tracking para o TrackingResult.
 * Deliberadamente liberal e defensivo — campos em falta degradam para
 * `desconhecido`. Aceita `events`/`eventos` como array de
 * `{ date|data, status|estado|descricao, location|local }`.
 */
export function normalizeTrackingJson(json: unknown, trackingId: string, provider: string): TrackingResult {
  const obj = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const rawEvents = (Array.isArray(obj.events) ? obj.events : Array.isArray(obj.eventos) ? obj.eventos : []) as Array<Record<string, unknown>>;
  const events: TrackingEvent[] = rawEvents
    .map((e) => {
      const date = String(e.date ?? e.data ?? e.datetime ?? e.timestamp ?? '');
      const statusPt = String(e.status ?? e.estado ?? e.descricao ?? e.description ?? '');
      const location = e.location ?? e.local ?? e.localizacao;
      const ev: TrackingEvent = { date, statusPt };
      if (location != null && String(location).trim()) ev.location = String(location);
      return ev;
    })
    .filter((e) => e.date || e.statusPt);
  events.sort((a, b) => {
    const ta = Date.parse(a.date);
    const tb = Date.parse(b.date);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
    return ta - tb;
  });
  const topStatus = obj.status ?? obj.estado;
  const last = events[events.length - 1];
  const status: TrackingStatus = last ? mapStatusPt(last.statusPt) : mapStatusPt(String(topStatus ?? ''));
  return { ok: true, trackingId, provider, status, events };
}

/** Resolve os campos de config desencriptados de uma integração por tipo. */
async function resolveTrackingConfig(type: string, deps: TrackingDeps): Promise<Record<string, string> | null> {
  if (deps.loadConfig) return deps.loadConfig(type);
  return null; // sem integração viva ligada (estado atual, sem contrato CTT)
}

/** Fornecedor HTTP real (CTT direto ou agregador). Só ativo com uma config presente. */
function makeHttpProvider(key: 'ctt-direct' | 'aggregator', configType: string): TrackingProvider {
  return {
    key,
    async isConfigured(deps) {
      const cfg = await resolveTrackingConfig(configType, deps);
      return !!(cfg && (cfg.base_url || cfg.endpoint) && (cfg.api_key || cfg.token || cfg.value));
    },
    async track(trackingId, deps) {
      const cfg = (await resolveTrackingConfig(configType, deps)) || {};
      const base = String(cfg.base_url || cfg.endpoint || '');
      const apiKey = String(cfg.api_key || cfg.token || cfg.value || '');
      if (!base) {
        return { ok: false, trackingId, provider: key, status: 'desconhecido', events: [], error: 'Integração de rastreio sem base_url configurado.' };
      }
      const url = `${base}${base.includes('?') ? '&' : '?'}tracking=${encodeURIComponent(trackingId)}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      try {
        const f = deps.fetchImpl ?? defaultFetch;
        const res = await f(url, { method: 'GET', headers });
        if (!res || !res.ok) {
          return { ok: false, trackingId, provider: key, status: 'desconhecido', events: [], error: 'Serviço de rastreio indisponível de momento.' };
        }
        let json: unknown = null;
        try {
          json = await res.json();
        } catch {
          return { ok: false, trackingId, provider: key, status: 'desconhecido', events: [], error: 'Resposta de rastreio ilegível.' };
        }
        return normalizeTrackingJson(json, trackingId, key);
      } catch {
        return { ok: false, trackingId, provider: key, status: 'desconhecido', events: [], error: 'Serviço de rastreio indisponível de momento.' };
      }
    },
  };
}

/** Fornecedor determinístico para dev/teste — só ativo com EKOA_TRACKING_MOCK=1. */
const mockProvider: TrackingProvider = {
  key: 'mock',
  async isConfigured(deps) {
    const env = deps.env ?? process.env;
    return env.EKOA_TRACKING_MOCK === '1';
  },
  async track(trackingId, deps) {
    // 1. Replay determinístico a partir de um fixture, quando o dir foi fornecido.
    if (deps.fixturesDir) {
      const file = join(deps.fixturesDir, `${trackingId}.json`);
      if (existsSync(file)) {
        try {
          const data = JSON.parse(readFileSync(file, 'utf-8')) as Partial<TrackingResult>;
          return {
            ok: true,
            trackingId,
            provider: 'mock',
            status: (data.status as TrackingStatus) || 'desconhecido',
            events: Array.isArray(data.events) ? data.events : [],
            ...(data.note ? { note: data.note } : {}),
          };
        } catch {
          /* fixture ilegível → cai no sintético abaixo */
        }
      }
    }
    // 2. Sintético "em trânsito" para identificadores RR…PT sem fixture.
    if (/^RR[0-9]{9}PT$/.test(trackingId)) {
      const now = new Date();
      const day = (offset: number) => new Date(now.getTime() - offset * 86_400_000).toISOString();
      return {
        ok: true,
        trackingId,
        provider: 'mock',
        status: 'em_transito',
        events: [
          { date: day(2), statusPt: 'Aceite pelos CTT', location: 'CTT Lisboa' },
          { date: day(1), statusPt: 'Em trânsito', location: 'Centro de Distribuição Postal' },
        ],
      };
    }
    // 3. Sem informação — desconhecido honesto.
    return {
      ok: true,
      trackingId,
      provider: 'mock',
      status: 'desconhecido',
      events: [],
      note: 'Sem informação de rastreio para este objeto no fornecedor de teste.',
    };
  },
};

/** Cadeia de fornecedores, na ordem de preferência. */
const PROVIDERS: TrackingProvider[] = [
  makeHttpProvider('ctt-direct', 'ctt-tracking'),
  makeHttpProvider('aggregator', 'ctt-aggregator'),
  mockProvider,
];

/** Objetos cujo prefixo indica um tipo sem rastreio disponível nos CTT. */
export function isNonTrackablePrefix(trackingId: string): boolean {
  return trackingId.startsWith('JA') || trackingId.startsWith('Q') || trackingId.startsWith('U');
}

/**
 * Rastreia um objeto CTT, percorrendo a cadeia de fornecedores (o primeiro
 * configurado ganha). Valida o formato ANTES de qualquer chamada; identificadores
 * de tipos sem rastreio (Q/U/JA) devolvem `desconhecido` diretamente.
 */
export async function trackShipment(trackingId: string, deps: TrackingDeps = {}): Promise<TrackingResult> {
  const id = String(trackingId || '').trim().toUpperCase();
  if (!TRACKING_ID_RE.test(id)) {
    return {
      ok: false,
      trackingId: id,
      provider: 'none',
      status: 'desconhecido',
      events: [],
      error: 'Identificador de objeto inválido. Formato esperado: duas letras, nove dígitos e duas letras de país (ex.: RR123456789PT).',
    };
  }
  if (isNonTrackablePrefix(id)) {
    return {
      ok: true,
      trackingId: id,
      provider: 'none',
      status: 'desconhecido',
      events: [],
      note: 'Este tipo de objeto (prefixo Q/U/JA) não dispõe de rastreio nos CTT.',
    };
  }
  for (const provider of PROVIDERS) {
    if (await provider.isConfigured(deps)) {
      return provider.track(id, deps);
    }
  }
  return {
    ok: false,
    trackingId: id,
    provider: 'none',
    status: 'desconhecido',
    events: [],
    error: 'Nenhum fornecedor de rastreio está configurado. Configure a integração CTT ou defina EKOA_TRACKING_MOCK=1 em ambiente de teste.',
  };
}

/** Exposto para testes: a cadeia de fornecedores por omissão. */
export const trackingProviders = PROVIDERS;
