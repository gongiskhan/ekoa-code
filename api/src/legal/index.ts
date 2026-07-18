/**
 * legal/ module public entry (ch02 §2.6). The legal vertical: the served-app
 * service routes (calculos, transcricao, legal-research, tracking, citius) behind
 * the access gate, plus the pure work-law simulators and the source-cited
 * calculation engines. The composition root (server.ts) mounts `legalRouter(deps)`
 * and wires the injected seams; nothing outside this module reaches into the
 * internals.
 */
export { legalRouter, type LegalRouterDeps } from './router.js';
export { requireLegalSuiteApp, makeAppRateLimiter, isSafeAppId, type ResolvedLegalApp, type LegalGateDeps } from './access-gate.js';

// Pure work-law calculators (also bundled into the "Simuladores de Trabalho" app).
export * from './simuladores.js';

// Legal calculation service + rate table (source of truth for the golden figures).
export {
  mergeTabela,
  computeJuros,
  computeCustas,
  verificarAtualizacaoTaxas,
  emitirAlarmeTabelas,
  loadCanonicalTabela,
  type TabelaTaxas,
  type JurosParams,
  type CustasParams,
  type AlarmeTabelas,
  type AlarmeStore,
} from './calculos.js';

// Domain services (consumed by agents/automations too; ch03 §3.9).
export { legalResearch, type LegalResearchResult, type LegalResearchHit, type ResearchSearchImpl } from './research.js';
export { consultarCitius, parsePublicacoes, decodeHtml, type CitiusPublicacao, type CitiusConsultaResult } from './citius.js';
export { trackShipment, mapStatusPt, normalizeTrackingJson, isNonTrackablePrefix, TRACKING_ID_RE, type TrackingResult, type TrackingDeps } from './tracking.js';
export { parseAvisoEtf, refreshTabelasTaxas, type AvisoEtfRow } from './tabelas-taxas.js';
export {
  getSttProvider,
  listSttProviders,
  meterStt,
  MOCK_FIXTURE_SEGMENTS,
  STT_TOKENS_PER_MINUTE,
  type SttResult,
  type SttProvider,
  type SttUsageRecorder,
} from './transcricao.js';

// Portal connector receiving surface (mega-run E1; ch03 §3.9).
export {
  attachPortalDocument,
  attachPortalEvent,
  listPortalDossierRecords,
  PortalOrgMismatchError,
  type PortalSpineDeps,
} from './portal.js';
