/**
 * Legal-suite served-app service routes (ch03 §3.9, ch07 §7.14). Thin routes:
 * gate + rate-limit + translate; ALL logic lives in the legal/ services. Carried
 * byte-compatibly from the old server.ts registrations (the 37-spec legal
 * Playwright suite and featured apps drive these with no JWT).
 *
 *   POST /api/legal/calculos      CALCULOS_ALLOWED_APPS   30/120 per min
 *   POST /api/legal/transcricao   TRANSCRICAO_ALLOWED_APPS 6/12 per min
 *   GET  /api/legal-research       RESEARCH_ALLOWED_APPS    4/10 per min
 *   GET  /api/tracking/consulta    TRACKING_ALLOWED_APPS    6/20 per min
 *   GET  /api/citius/consulta      CITIUS_ALLOWED_APPS      6/20 per min (+ registration)
 *   GET  /api/legal/portal         PORTAL_ALLOWED_APPS      20/60 per min (+ registration)
 *   POST /api/legal/portal/certidao PORTAL_ALLOWED_APPS     10/30 per min (+ registration)
 *
 * The gate, allowlists and rate windows are carried exactly; see access-gate.ts.
 * Every dependency that reaches outside legal/ (slug→app resolution, the owner
 * spine, the knowledge search backend, the integration config, STT metering) is an
 * INJECTED seam wired by the composition root (server.ts), so this module never
 * imports apps/, auth/ or routes/ (ch02 §2.7).
 */
import { Router, type Request, type Response } from 'express';
import {
  requireLegalSuiteApp,
  makeAppRateLimiter,
  type LegalGateDeps,
  type ResolvedLegalApp,
  type NowFn,
} from './access-gate.js';
import { loadCanonicalTabela, mergeTabela, computeJuros, computeCustas, verificarAtualizacaoTaxas, emitirAlarmeTabelas, type AlarmeStore } from './calculos.js';
import { legalResearch, type ResearchSearchImpl, type ResearchFetchImpl } from './research.js';
import { trackShipment, type TrackingDeps } from './tracking.js';
import { consultarCitius, type FetchImpl as CitiusFetchImpl } from './citius.js';
import { getSttProvider, meterStt, type SttUsageRecorder } from './transcricao.js';
import { listPortalDossierRecords, type PortalSpineDeps } from './portal.js';
import { retrieveCertidao, type SaveBlobFn, type FetchImpl as PortalCertidaoFetchImpl } from './portal-connectors.js';
import { pollInsolvencyWatches, type InsolvencyWatchSpineDeps, type FetchImpl as InsolvenciaFetchImpl } from './insolvencia-watch.js';
import type { ActivationState } from '../data/activation.js';
import type { ActivityActor } from '../data/activity.js';
import type { PortalCertidaoSource } from '@ekoa/shared';

// --- Allowlists (carried verbatim from the old server.ts) --------------------
const CITIUS_ALLOWED_APPS = new Set(['legal-citius', 'legal-nucleo', 'legal-prazos', 'legal-dossie']);
// Same four processo-touching apps as Citius (mega-run E1) - the dossiê's own apps.
const PORTAL_ALLOWED_APPS = CITIUS_ALLOWED_APPS;
const TRACKING_ALLOWED_APPS = new Set(['legal-correio', 'legal-apoio', 'legal-dossie', 'legal-nucleo']);
const RESEARCH_ALLOWED_APPS = new Set(['legal-pesquisa', 'legal-pecas']);
const CALCULOS_ALLOWED_APPS = new Set(['legal-calculos', 'legal-cobrancas', 'legal-injuncoes', 'legal-honorarios', 'legal-pecas']);
const TRANSCRICAO_ALLOWED_APPS = new Set(['legal-transcricao']);

/** Engine-error message → 400 (a validation refusal) vs 500 (a service fault). */
const CALCULOS_VALIDATION_RE = /inválid|não pode|em falta|casas decimais|calendário|Tabela|UC|negativo|excede|inteiro/i;
/** STT refusal (consent / unavailable) → 400 vs 500. */
const TRANSCRICAO_REFUSAL_RE = /consentimento|indisponível|item #1[34]/i;

export interface LegalRouterDeps {
  /** Resolve a slug-or-id header to a registered app (owner + canonical id), or null. */
  resolveApp: (idOrSlug: string) => Promise<ResolvedLegalApp | null>;
  /** Rate-limiter clock + `avisoTabelas`/alarme "now". Default: Date.now. */
  now?: NowFn;
  /** Activation lookup (Amendment 2). Default: the data/ activation cache. */
  getActivation?: (userId: string) => ActivationState | undefined;
  /** Legal research seams (knowledge FTS + link verification). */
  research?: { searchImpl?: ResearchSearchImpl; fetchImpl?: ResearchFetchImpl };
  /** CTT tracking seams (integration config / fetch / mock fixtures). */
  tracking?: TrackingDeps;
  /** Citius live-fetch seam (default: SSRF-guarded live fetch). */
  citius?: { fetchImpl?: CitiusFetchImpl };
  /** legal/calculos owner-spine seams (overlay + missing-update alarme), best-effort. */
  calculos?: {
    getOverlay?: (app: ResolvedLegalApp) => Promise<Array<Record<string, unknown>>>;
    alarmeStore?: AlarmeStore;
  };
  /** legal/transcricao owner-spine seams. Absent => the route 400s (spine unresolved). */
  transcricao?: {
    getRow: (app: ResolvedLegalApp, collection: string, id: string) => Promise<Record<string, unknown> | null>;
    updateRow: (app: ResolvedLegalApp, collection: string, id: string, patch: Record<string, unknown>) => Promise<void>;
    recordUsage?: SttUsageRecorder;
  };
  /** legal/portal owner-spine seams (mega-run E1). Absent => the route 503s. */
  portal?: PortalSpineDeps;
  /** legal/portal-connectors seams (mega-run E2/E3): the blob-save path (required - no
   *  honest default exists for writing bytes) and an optional fetch/base-URL override for
   *  tests. Absent `saveBlob` => the route 503s (same posture as `portal` above). */
  portalCertidao?: {
    saveBlob: SaveBlobFn;
    fetchImpl?: PortalCertidaoFetchImpl;
    baseUrls?: Partial<Record<PortalCertidaoSource, string>>;
  };
  /** legal/insolvencia-watch owner-spine seams (mega-run E4): the citius_watches satellite
   *  collection + an optional fetch/base-URL override for tests. Absent `insolvenciaWatch`
   *  => the manual poll route 503s (same posture as `portal`/`portalCertidao` above). */
  insolvenciaWatch?: InsolvencyWatchSpineDeps & {
    fetchImpl?: InsolvenciaFetchImpl;
    baseUrl?: string;
  };
}

export function legalRouter(deps: LegalRouterDeps): Router {
  const r = Router();
  const now: NowFn = deps.now ?? Date.now;
  const gateDeps: LegalGateDeps = { resolveApp: deps.resolveApp, getActivation: deps.getActivation };

  // Per-endpoint sliding-window limiters (per-app / global caps, per minute).
  const calculosLimited = makeAppRateLimiter(30, 120, 60_000, now);
  const transcricaoLimited = makeAppRateLimiter(6, 12, 60_000, now);
  const researchLimited = makeAppRateLimiter(4, 10, 60_000, now);
  const trackingLimited = makeAppRateLimiter(6, 20, 60_000, now);
  const citiusLimited = makeAppRateLimiter(6, 20, 60_000, now);
  const portalLimited = makeAppRateLimiter(20, 60, 60_000, now);
  const portalCertidaoLimited = makeAppRateLimiter(10, 30, 60_000, now);
  const insolvenciaPollLimited = makeAppRateLimiter(10, 30, 60_000, now);

  const noStore = (res: Response): void => {
    res.setHeader('Cache-Control', 'no-store');
  };

  // --- POST /api/legal/calculos ---------------------------------------------
  r.post('/api/legal/calculos', async (req: Request, res: Response) => {
    noStore(res);
    const app = await requireLegalSuiteApp(req, res, gateDeps, { allowed: CALCULOS_ALLOWED_APPS });
    if (!app) return;
    if (calculosLimited(app.appId)) {
      res.status(429).json({ error: 'Demasiados pedidos de cálculo. Tente novamente dentro de um minuto.' });
      return;
    }

    const body = (req.body ?? {}) as { tipo?: unknown; params?: unknown };
    const tipo = String(body.tipo || '');
    const params = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>;

    const overlay = deps.calculos?.getOverlay ? await deps.calculos.getOverlay(app).catch(() => []) : [];
    const tabela = mergeTabela(loadCanonicalTabela(), overlay);
    const avisoTabelas = verificarAtualizacaoTaxas(new Date(now()), tabela);

    // Best-effort missing-update alarme onto the owner spine (never blocks/faults).
    if (deps.calculos?.alarmeStore && app.ownerUserId) {
      void emitirAlarmeTabelas(`usr.${app.ownerUserId}`, new Date(now()), { store: deps.calculos.alarmeStore, tabela }).catch(() => {});
    }

    if (tipo === 'tabela') {
      res.json({ ok: true, tipo, tabela, avisoTabelas });
      return;
    }
    if (tipo !== 'juros' && tipo !== 'custas') {
      res.status(400).json({ error: 'tipo de cálculo inválido: use "juros", "custas" ou "tabela".' });
      return;
    }
    try {
      const resultado = await (tipo === 'juros' ? computeJuros(params as never, tabela) : computeCustas(params as never, tabela));
      res.json({ ok: true, tipo, resultado, avisoTabelas });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (CALCULOS_VALIDATION_RE.test(msg)) {
        res.status(400).json({ error: msg });
      } else {
        res.status(500).json({ error: 'Serviço de cálculos indisponível.' });
      }
    }
  });

  // --- POST /api/legal/transcricao ------------------------------------------
  r.post('/api/legal/transcricao', async (req: Request, res: Response) => {
    noStore(res);
    const app = await requireLegalSuiteApp(req, res, gateDeps, { allowed: TRANSCRICAO_ALLOWED_APPS });
    if (!app) return;
    if (transcricaoLimited(app.appId)) {
      res.status(429).json({ error: 'Demasiados trabalhos de transcrição. Tente novamente dentro de um minuto.' });
      return;
    }
    if (!deps.transcricao || !app.ownerUserId) {
      res.status(400).json({ error: 'Não foi possível resolver o dono da espinha.' });
      return;
    }

    const body = (req.body ?? {}) as { transcricaoId?: unknown; engine?: unknown; consentCloud?: unknown; durationSec?: unknown };
    const transcricaoId = String(body.transcricaoId || '').trim();
    if (!transcricaoId) {
      res.status(400).json({ error: 'transcricaoId em falta.' });
      return;
    }
    const engine = body.engine != null ? String(body.engine) : undefined;
    const consentCloud = body.consentCloud === true;

    const row = await deps.transcricao.getRow(app, 'transcricoes', transcricaoId);
    if (!row) {
      res.status(404).json({ error: 'Transcrição não encontrada.' });
      return;
    }

    try {
      const provider = await getSttProvider(engine);
      const result = await provider.transcribe(Buffer.alloc(0), { language: 'pt-PT', diarize: true, consentCloud });

      // Write progress/segments back to the owner spine row (best-effort). Byte-compat
      // with the old endpoint (cortex server.ts:2370): the row's `segmentos` field is
      // the ARRAY (the served app reads row.segmentos to render getByTestId('segmentos'));
      // the RESPONSE `segmentos` is the count. `transcritoEm` carried.
      await deps.transcricao
        .updateRow(app, 'transcricoes', transcricaoId, {
          estado: 'transcrito',
          engine: result.engine,
          durationSec: result.durationSec,
          segmentos: result.segments,
          transcritoEm: new Date(now()).toISOString(),
        })
        .catch(() => {});

      // Meter stt:<engine> per started audio minute (best-effort).
      try {
        await meterStt(
          { userId: app.ownerUserId, sessionId: transcricaoId, engine: result.engine, durationSec: result.durationSec, artifactId: app.appId },
          deps.transcricao.recordUsage,
        );
      } catch {
        /* metering is best-effort — never loses the finished transcription */
      }

      res.json({ ok: true, transcricaoId, engine: result.engine, durationSec: result.durationSec, segmentos: result.segments.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (TRANSCRICAO_REFUSAL_RE.test(msg)) {
        res.status(400).json({ error: msg });
      } else {
        res.status(500).json({ error: 'Serviço de transcrição indisponível.' });
      }
    }
  });

  // --- GET /api/legal-research ----------------------------------------------
  r.get('/api/legal-research', async (req: Request, res: Response) => {
    noStore(res);
    const app = await requireLegalSuiteApp(req, res, gateDeps, { allowed: RESEARCH_ALLOWED_APPS });
    if (!app) return;
    if (researchLimited(app.appId)) {
      res.status(429).json({ error: 'Demasiados pedidos de pesquisa. Tente novamente dentro de um minuto.' });
      return;
    }

    const q = String(req.query.q || '').trim();
    if (!q) {
      res.status(400).json({ error: 'Parâmetro "q" em falta' });
      return;
    }
    const sourcesRaw = req.query.sources;
    const sources = typeof sourcesRaw === 'string'
      ? sourcesRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      : undefined;
    const verifyRaw = req.query.verify;
    const verify = !(verifyRaw === '0' || verifyRaw === 'false');

    try {
      const result = await legalResearch(q, {
        sources,
        verify,
        searchImpl: deps.research?.searchImpl,
        fetchImpl: deps.research?.fetchImpl,
      });
      res.json(result);
    } catch {
      res.status(503).json({ error: 'Pesquisa jurídica indisponível' });
    }
  });

  // --- GET /api/tracking/consulta -------------------------------------------
  r.get('/api/tracking/consulta', async (req: Request, res: Response) => {
    noStore(res);
    const app = await requireLegalSuiteApp(req, res, gateDeps, { allowed: TRACKING_ALLOWED_APPS });
    if (!app) return;
    if (trackingLimited(app.appId)) {
      res.status(429).json({ error: 'Demasiados pedidos de rastreio. Tente novamente dentro de um minuto.' });
      return;
    }

    const tracking = String(req.query.tracking || '').trim();
    if (!tracking) {
      res.status(400).json({ error: 'Parâmetro "tracking" em falta' });
      return;
    }
    try {
      const result = await trackShipment(tracking, deps.tracking ?? {});
      if (!result.ok) {
        const status = /inválido/i.test(result.error || '') ? 400 : 503;
        res.status(status).json(result);
        return;
      }
      res.json(result);
    } catch {
      res.status(503).json({ error: 'Serviço de rastreio indisponível', tracking });
    }
  });

  // --- GET /api/citius/consulta ---------------------------------------------
  r.get('/api/citius/consulta', async (req: Request, res: Response) => {
    noStore(res);
    const app = await requireLegalSuiteApp(req, res, gateDeps, {
      allowed: CITIUS_ALLOWED_APPS,
      notAllowedMessage: 'Aplicação não autorizada para a consulta Citius',
      requireRegistered: true,
    });
    if (!app) return;
    if (citiusLimited(app.appId)) {
      res.status(429).json({ error: 'Demasiados pedidos de consulta. Tente novamente dentro de um minuto.' });
      return;
    }

    const processo = String(req.query.processo || '').trim();
    if (!processo) {
      res.status(400).json({ error: 'Parâmetro "processo" em falta' });
      return;
    }
    try {
      const result = await consultarCitius(processo, { fetchImpl: deps.citius?.fetchImpl });
      if (!result.ok) {
        res.status(503).json({ error: result.error || 'Consulta Citius indisponível', processo });
        return;
      }
      res.json({ processo: result.processo, publicacoes: result.publicacoes });
    } catch {
      res.status(503).json({ error: 'Consulta Citius indisponível', processo });
    }
  });

  // --- GET /api/legal/portal (mega-run E1) -----------------------------------
  r.get('/api/legal/portal', async (req: Request, res: Response) => {
    noStore(res);
    const app = await requireLegalSuiteApp(req, res, gateDeps, {
      allowed: PORTAL_ALLOWED_APPS,
      notAllowedMessage: 'Aplicação não autorizada para consultar o dossiê',
      requireRegistered: true,
    });
    if (!app) return;
    if (portalLimited(app.appId)) {
      res.status(429).json({ error: 'Demasiados pedidos de consulta ao dossiê. Tente novamente dentro de um minuto.' });
      return;
    }

    const processoId = String(req.query.processoId || '').trim();
    if (!processoId) {
      res.status(400).json({ error: 'Parâmetro "processoId" em falta' });
      return;
    }
    if (!deps.portal) {
      res.status(503).json({ error: 'Consulta de documentos de portal indisponível' });
      return;
    }
    try {
      const records = await listPortalDossierRecords(app, processoId, deps.portal);
      res.json(records);
    } catch {
      res.status(503).json({ error: 'Consulta de documentos de portal indisponível' });
    }
  });

  // --- POST /api/legal/portal/certidao (mega-run E2/E3) ----------------------
  const CERTIDAO_SOURCES = new Set<string>(['certidao-comercial', 'certidao-predial', 'certidao-civil']);
  r.post('/api/legal/portal/certidao', async (req: Request, res: Response) => {
    noStore(res);
    const app = await requireLegalSuiteApp(req, res, gateDeps, {
      allowed: PORTAL_ALLOWED_APPS,
      notAllowedMessage: 'Aplicação não autorizada para consultar o dossiê',
      requireRegistered: true,
    });
    if (!app) return;
    if (portalCertidaoLimited(app.appId)) {
      res.status(429).json({ error: 'Demasiados pedidos de certidão. Tente novamente dentro de um minuto.' });
      return;
    }

    const body = (req.body ?? {}) as { source?: unknown; accessCode?: unknown; processoId?: unknown; subjectIds?: unknown };
    const source = String(body.source || '');
    if (!CERTIDAO_SOURCES.has(source)) {
      res.status(400).json({ error: 'Parâmetro "source" inválido: use "certidao-comercial", "certidao-predial" ou "certidao-civil".' });
      return;
    }
    const accessCode = String(body.accessCode || '').trim();
    if (!accessCode) {
      res.status(400).json({ error: 'Parâmetro "accessCode" em falta' });
      return;
    }
    const processoId = String(body.processoId || '').trim();
    if (!processoId) {
      res.status(400).json({ error: 'Parâmetro "processoId" em falta' });
      return;
    }
    const subjectIds = Array.isArray(body.subjectIds) ? body.subjectIds.map((s) => String(s)) : [];

    if (!deps.portal || !deps.portalCertidao) {
      res.status(503).json({ error: 'Consulta de certidão indisponível' });
      return;
    }
    try {
      const ownerOrgId = await deps.portal.getOwnerOrgId(app.ownerUserId);
      if (!ownerOrgId) {
        res.status(503).json({ error: 'Consulta de certidão indisponível' });
        return;
      }
      // No independent end-user JWT exists on this served-app plane (header-scoped only,
      // same as every legal-suite route) - the app's own resolved owner is the acting
      // principal, exactly like apps/app-assistant-route.ts's owner-actor pattern.
      const actor: ActivityActor = { userId: app.ownerUserId, username: app.appId, orgId: ownerOrgId };
      const result = await retrieveCertidao(app, processoId, source as PortalCertidaoSource, accessCode, subjectIds, actor, {
        ...deps.portal,
        ...deps.portalCertidao,
        now,
      });
      if (!result.ok) {
        res.status(503).json({ error: result.error });
        return;
      }
      res.json({ ok: true, source, record: result.record, document: result.document });
    } catch {
      res.status(503).json({ error: 'Consulta de certidão indisponível' });
    }
  });

  // --- POST /api/legal/portal/insolvency/poll (mega-run E4) ------------------
  // No scheduler exists yet (insolvencia-watch.ts doc comment records the decision): this
  // route runs ONE poll cycle for a single dossiê so a test/gate/future UI action can trigger
  // a watcher event deterministically. The operator/cron invokes `pollInsolvencyWatches`
  // directly, looping dossiês, for the scheduled path.
  r.post('/api/legal/portal/insolvency/poll', async (req: Request, res: Response) => {
    noStore(res);
    const app = await requireLegalSuiteApp(req, res, gateDeps, {
      allowed: PORTAL_ALLOWED_APPS,
      notAllowedMessage: 'Aplicação não autorizada para consultar o dossiê',
      requireRegistered: true,
    });
    if (!app) return;
    if (insolvenciaPollLimited(app.appId)) {
      res.status(429).json({ error: 'Demasiados pedidos de vigilância de insolvência. Tente novamente dentro de um minuto.' });
      return;
    }

    const body = (req.body ?? {}) as { processoId?: unknown };
    const processoId = String(body.processoId || '').trim();
    if (!processoId) {
      res.status(400).json({ error: 'Parâmetro "processoId" em falta' });
      return;
    }
    if (!deps.portal || !deps.insolvenciaWatch) {
      res.status(503).json({ error: 'Vigilância de insolvência indisponível' });
      return;
    }
    try {
      const ownerOrgId = await deps.portal.getOwnerOrgId(app.ownerUserId);
      if (!ownerOrgId) {
        res.status(503).json({ error: 'Vigilância de insolvência indisponível' });
        return;
      }
      // No independent end-user JWT exists on this served-app plane (header-scoped only) -
      // the app's own resolved owner is the acting principal, same synthesis as the certidão
      // route above.
      const actor: ActivityActor = { userId: app.ownerUserId, username: app.appId, orgId: ownerOrgId };
      const result = await pollInsolvencyWatches(app, processoId, actor, {
        ...deps.portal,
        ...deps.insolvenciaWatch,
        now,
      });
      res.json(result);
    } catch {
      res.status(503).json({ error: 'Vigilância de insolvência indisponível' });
    }
  });

  return r;
}
