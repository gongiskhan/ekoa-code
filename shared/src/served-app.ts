/** Served-app data plane contract: route census + auth mapping (ch03 §3.9, paths outside /api/v1). */
import { z } from 'zod';
import { OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';
import { PortalDossierRecordsResponse, PortalCertidaoRequest, PortalCertidaoResponse } from './portal.js';

/** An opaque stored document in a served-app collection (shape owned by the app, ch04). */
export const AppDataDocument = z.record(z.unknown());
export type AppDataDocument = z.infer<typeof AppDataDocument>;

/** Generic string query bag for the served-app GET service routes. */
export const GenericQuery = z.record(z.string());
export type GenericQuery = z.infer<typeof GenericQuery>;

/** The byte-compat list envelope the served-data plane actually emits:
 *  `{ success: true, data: [...] }` (apps/served-data.ts header contract). */
export const AppDataListEnvelope = z
  .object({ success: z.literal(true), data: z.array(AppDataDocument) })
  .passthrough();
export type AppDataListEnvelope = z.infer<typeof AppDataListEnvelope>;

/** GET /api/app-sso/session — 200 in BOTH states (identity, or `data: null` signed out).
 *  The quiet sibling of `/me` for on-load probes: a signed-out visitor's app load must
 *  produce ZERO non-2xx console noise (the browser logs every non-2xx regardless of JS
 *  handling). `/me` keeps its byte-compat 401 untouched (§3.9); precedent for the
 *  always-200 shape: app-assistant whoami's `{ admin: false }`. */
export const AppSsoSessionResponse = z.object({
  success: z.literal(true),
  data: z
    .object({
      email: z.string(),
      name: z.string().nullable(),
      oid: z.string().nullable(),
      tid: z.string().nullable(),
      canSendMail: z.boolean(),
    })
    .nullable(),
});
export type AppSsoSessionResponse = z.infer<typeof AppSsoSessionResponse>;

/** GET /api/demos/:appId/availability — 200 in BOTH states. The assistant panel's
 *  teach-launcher probe: a tourless app is a by-design state, not an error, so the
 *  probe must never 404 into the console. The spec route /api/demos/:appId keeps its
 *  404 for a genuinely absent tour (the loud-and-recoverable house rule). */
export const DemoAvailabilityResponse = z.object({ available: z.boolean() });
export type DemoAvailabilityResponse = z.infer<typeof DemoAvailabilityResponse>;

export const servedAppEndpoints = {
  // Per-app data CRUD (/api/app-data/:collection[/:id]), header-scoped, no JWT.
  appDataList: { method: 'GET', path: '/api/app-data/:collection', auth: 'header-scoped', response: AppDataListEnvelope },
  appDataGet: { method: 'GET', path: '/api/app-data/:collection/:id', auth: 'header-scoped', response: AppDataDocument },
  appDataCreate: { method: 'POST', path: '/api/app-data/:collection', auth: 'header-scoped', request: AppDataDocument, response: AppDataDocument },
  appDataUpsert: { method: 'PUT', path: '/api/app-data/:collection/:id', auth: 'header-scoped', request: AppDataDocument, response: AppDataDocument },
  appDataDelete: { method: 'DELETE', path: '/api/app-data/:collection/:id', auth: 'header-scoped', response: OkResponse },

  // Owner-shared data (/api/app-shared/:collection[/:id]), header + server-side owner-scope resolution.
  appSharedList: { method: 'GET', path: '/api/app-shared/:collection', auth: 'header-scoped', response: AppDataListEnvelope },
  appSharedGet: { method: 'GET', path: '/api/app-shared/:collection/:id', auth: 'header-scoped', response: AppDataDocument },
  appSharedCreate: { method: 'POST', path: '/api/app-shared/:collection', auth: 'header-scoped', request: AppDataDocument, response: AppDataDocument },
  appSharedUpsert: { method: 'PUT', path: '/api/app-shared/:collection/:id', auth: 'header-scoped', request: AppDataDocument, response: AppDataDocument },
  appSharedDelete: { method: 'DELETE', path: '/api/app-shared/:collection/:id', auth: 'header-scoped', response: OkResponse },

  // App files (raw bytes + metadata headers).
  appFileUpload: { method: 'POST', path: '/api/app-files', auth: 'header-scoped', kind: 'binary', response: z.unknown() },
  appFileGet: { method: 'GET', path: '/api/app-files/:appId/:id', auth: 'header-scoped', kind: 'binary', response: z.unknown() },
  appFileDelete: { method: 'DELETE', path: '/api/app-files/:appId/:id', auth: 'header-scoped', response: OkResponse },

  // PDF export.
  appPdfExport: { method: 'POST', path: '/api/app-pdf', auth: 'header-scoped', kind: 'binary', request: z.unknown(), response: z.unknown() },

  // Cloud files (workspace credential injected server-side, never reaches the page).
  appCloudFilesStatus: { method: 'GET', path: '/api/app-cloud-files/status', auth: 'header-scoped', response: z.unknown() },
  appCloudFilesUpload: { method: 'POST', path: '/api/app-cloud-files/:provider/upload', auth: 'header-scoped', kind: 'binary', response: z.unknown() },
  appCloudFilesList: { method: 'GET', path: '/api/app-cloud-files/:provider/list', auth: 'header-scoped', query: GenericQuery, response: z.unknown() },
  appCloudFilesDownload: { method: 'GET', path: '/api/app-cloud-files/:provider/download', auth: 'header-scoped', kind: 'binary', query: GenericQuery, response: z.unknown() },

  // End-user SSO (per-app HttpOnly cookie, Path=/api/app-sso, 8h TTL).
  appSsoLogin: { method: 'POST', path: '/api/app-sso/login', auth: 'header-scoped', request: z.record(z.unknown()), response: z.unknown() },
  appSsoSetPassword: { method: 'POST', path: '/api/app-sso/set-password', auth: 'header-scoped', request: z.record(z.unknown()), response: OkResponse },
  appSsoLogout: { method: 'POST', path: '/api/app-sso/logout', auth: 'header-scoped', response: OkResponse },
  appSsoMe: { method: 'GET', path: '/api/app-sso/me', auth: 'header-scoped', response: z.unknown() },
  appSsoSession: { method: 'GET', path: '/api/app-sso/session', auth: 'header-scoped', response: AppSsoSessionResponse },
  appSsoMicrosoftStart: { method: 'GET', path: '/api/app-sso/microsoft/start', auth: 'header-scoped', response: z.unknown() },
  appSsoMicrosoftCallback: { method: 'GET', path: '/api/app-sso/microsoft/callback', auth: 'header-scoped', query: GenericQuery, response: z.unknown() },
  appSsoM365: { method: 'POST', path: '/api/app-sso/m365/*', auth: 'header-scoped', request: z.unknown(), response: z.unknown() },

  // Workspace Graph proxy (Q-10: X-Ekoa-App-Id + per-app manifest opt-in, optional JWT).
  m365Proxy: { method: 'POST', path: '/api/m365/*', auth: 'app-id-gated', request: z.unknown(), response: z.unknown() },

  // Integration credential-injection proxy (optional-JWT; executeEndpoint must keep resolving).
  integrationProxy: { method: 'POST', path: '/api/integration/:key/*', auth: 'optional-jwt', request: z.unknown(), response: z.unknown() },

  // Legal-suite services (per-endpoint app allowlist + sliding-window rate limits).
  legalCalculos: { method: 'POST', path: '/api/legal/calculos', auth: 'header-scoped', request: z.unknown(), response: z.unknown() },
  legalTranscricao: { method: 'POST', path: '/api/legal/transcricao', auth: 'header-scoped', request: z.unknown(), response: z.unknown() },
  legalResearch: { method: 'GET', path: '/api/legal-research', auth: 'header-scoped', query: GenericQuery, response: z.unknown() },
  trackingConsulta: { method: 'GET', path: '/api/tracking/consulta', auth: 'header-scoped', query: GenericQuery, response: z.unknown() },
  citiusConsulta: { method: 'GET', path: '/api/citius/consulta', auth: 'header-scoped', query: GenericQuery, response: z.unknown() },
  // Portal connector receiving surface (mega-run E1) - the first legal descriptor that is
  // NOT z.unknown() (08-portal-audit.md pin 1): a dossiê's portal-sourced documents/events.
  legalPortalDossier: { method: 'GET', path: '/api/legal/portal', auth: 'header-scoped', query: GenericQuery, response: PortalDossierRecordsResponse },
  // Retrieval-by-access-code for the three open-data certidão sources (mega-run E2/E3,
  // BRIEF §8 items 1-3): fetches + parses + attaches a PortalDocument, returning the
  // structured record alongside it.
  legalPortalCertidao: {
    method: 'POST',
    path: '/api/legal/portal/certidao',
    auth: 'header-scoped',
    request: PortalCertidaoRequest,
    response: PortalCertidaoResponse,
  },
  signatureSend: { method: 'POST', path: '/api/signature/send', auth: 'header-scoped', request: z.unknown(), response: z.unknown() },

  // Adobe Sign webhook (deliberately public; authenticity re-verified server-side).
  adobeSignWebhookGet: { method: 'GET', path: '/api/adobe-sign/webhook', auth: 'public', query: GenericQuery, response: z.unknown() },
  adobeSignWebhookPost: { method: 'POST', path: '/api/adobe-sign/webhook', auth: 'public', request: z.unknown(), response: z.unknown() },

  // App health probe (injected into every served HTML; featured artifacts skipped).
  appHealth: { method: 'POST', path: '/api/app-health', auth: 'header-scoped', request: z.record(z.unknown()), response: OkResponse },

  // Static serving (shareability gate on document requests; slug-to-canonical-id resolution).
  serveApp: { method: 'GET', path: '/apps/:idOrSlug/', auth: 'public', kind: 'static', query: GenericQuery, response: z.unknown() },
  serveBuild: { method: 'GET', path: '/build/:slug', auth: 'public', kind: 'static', response: z.unknown() },
  demoBridge: { method: 'GET', path: '/__ekoa/demo-bridge.js', auth: 'public', kind: 'static', response: z.unknown() },
  demoAvailability: { method: 'GET', path: '/api/demos/:appId/availability', auth: 'public', response: DemoAvailabilityResponse },
} as const satisfies DomainDescriptorMap;
