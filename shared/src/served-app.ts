/** Served-app data plane contract: route census + auth mapping (ch03 §3.9, paths outside /api/v1). */
import { z } from 'zod';
import { OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';
import { PortalDossierRecordsResponse, PortalCertidaoRequest, PortalCertidaoResponse, InsolvenciaPollRequest, InsolvenciaPollResponse } from './portal.js';

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

// ---------------------------------------------------------------------------
// Zoho Sign served-app proxy (/api/zoho-sign/*, ch03 §2.6 e-sign; 2B-S2). Like the
// Adobe status/send/agreement reads, the send/status/sign-url/document routes stay
// router-internal (mounted, undescribed — served-app /api/* paths are outside the
// /api/v1 mount-coverage walker); ONLY the deliberately public webhook GET/POST + the
// /return bounce are described below (schema-coverage COVERED). These request/response
// schemas are the shared contract the router's responses validate against.
// ---------------------------------------------------------------------------

/** One recipient of a Zoho send request. */
export const ZohoSignSendRecipient = z.object({
  email: z.string(),
  name: z.string().optional(),
  /** Zoho action type; only SIGN is placed with a signature field. */
  role: z.string().optional(),
  /** 1-based signing position; distinct orders sign sequentially. */
  order: z.number().optional(),
  /** When true, mint an embedded (in-portal) signing URL; otherwise Zoho emails. */
  embedded: z.boolean().optional(),
});
export type ZohoSignSendRecipient = z.infer<typeof ZohoSignSendRecipient>;

/** POST /api/zoho-sign/send body. `documentName` defaults server-side; `externalRef.appId`
 *  is server-trusted (taken from the app context, never the body). */
export const ZohoSendRequest = z.object({
  documentName: z.string().optional(),
  fileName: z.string().optional(),
  html: z.string().optional(),
  pdfBase64: z.string().optional(),
  recipients: z.array(ZohoSignSendRecipient),
  message: z.string().optional(),
  redirectUrl: z.string().optional(),
  expirationDays: z.number().optional(),
  isSequential: z.boolean().optional(),
  language: z.string().optional(),
  externalRef: z
    .object({ appId: z.string().optional(), propostaId: z.string().optional(), clientEmail: z.string().optional() })
    .optional(),
});
export type ZohoSendRequest = z.infer<typeof ZohoSendRequest>;

/** A per-recipient signing URL (embedded one-time URL, or null when Zoho emails them). */
export const ZohoSigningUrl = z.object({ email: z.string(), signUrl: z.string().nullable() });
export type ZohoSigningUrl = z.infer<typeof ZohoSigningUrl>;

/** POST /api/zoho-sign/send success body. */
export const ZohoSendResponse = z.object({
  success: z.literal(true),
  requestId: z.string(),
  status: z.string(),
  signingUrls: z.array(ZohoSigningUrl),
});
export type ZohoSendResponse = z.infer<typeof ZohoSendResponse>;

/** GET /api/zoho-sign/status body. */
export const ZohoStatusResponse = z.object({ connected: z.boolean() });
export type ZohoStatusResponse = z.infer<typeof ZohoStatusResponse>;

/** GET /api/zoho-sign/requests/:id/sign-url body (null when the signer is email-only). */
export const ZohoSignUrlResponse = z.object({ signUrl: z.string().nullable() });
export type ZohoSignUrlResponse = z.infer<typeof ZohoSignUrlResponse>;

/** GET /api/zoho-sign/requests/:id body — the raw Zoho request metadata (app-owned shape). */
export const ZohoRequestResponse = z.object({ request: z.record(z.unknown()) });
export type ZohoRequestResponse = z.infer<typeof ZohoRequestResponse>;

// ---------------------------------------------------------------------------
// Pluggable e-signature facade (POST /api/signature/send, ch03 §2.6; 2B-S4). The one
// credential-free route that picks a provider by `body.provider` — `zoho-sign` (live),
// `cmd` (inactive Autenticação.Gov seam) or `adobe`/default (the Adobe facade). Both the
// request and the response were `z.unknown()` before the swap; they are given REAL zod
// schemas here. SHRINK-ONLY: `.passthrough()` + optional fields keep every existing served-app
// payload valid (the route ignores unknown body keys and defaults `title`/`recipients`), so
// tightening the descriptor cannot reject a byte-compat payload.
// ---------------------------------------------------------------------------

/** One recipient of a pluggable-facade send. `email` is the only load-bearing field; extra
 *  keys pass through (the route forwards recipients to the chosen provider as-is). */
export const SignatureSendRecipient = z
  .object({
    email: z.string(),
    name: z.string().optional(),
    /** SIGNER (default) | APPROVER | ACCEPTOR | CERTIFIED_RECIPIENT | FORM_FILLER. */
    role: z.string().optional(),
    /** 1-based signing position; equal orders sign in parallel. */
    order: z.number().optional(),
  })
  .passthrough();
export type SignatureSendRecipient = z.infer<typeof SignatureSendRecipient>;

/** POST /api/signature/send body. `provider` picks the backend; `title` defaults server-side;
 *  `recipients` defaults to `[]`. All optional + passthrough for byte-compat with existing apps. */
export const SignatureSendRequest = z
  .object({
    provider: z.string().optional(),
    title: z.string().optional(),
    documentHtml: z.string().optional(),
    documentPdfBase64: z.string().optional(),
    recipients: z.array(SignatureSendRecipient).optional(),
  })
  .passthrough();
export type SignatureSendRequest = z.infer<typeof SignatureSendRequest>;

/** A per-recipient embedded signing URL surfaced by the facade (`esignUrl`, unlike the
 *  Zoho-native `signUrl`; email-only signers are dropped rather than returned as null). */
export const SignatureSigningUrl = z.object({ email: z.string(), esignUrl: z.string() }).passthrough();
export type SignatureSigningUrl = z.infer<typeof SignatureSigningUrl>;

/** POST /api/signature/send response. Covers the provider result (`{ ok, provider, ... }` at
 *  2xx, or the sanitized `{ ok:false, code, error }` at 409/501/502) AND the app-context gate's
 *  flat `{ error }` (400/404 — the accepted served-app flat-error precedent), so the one
 *  descriptor represents every body the route emits. `ok`/`provider` are therefore optional and
 *  `.passthrough()` keeps it byte-safe. */
export const SignatureSendResponse = z
  .object({
    ok: z.boolean().optional(),
    provider: z.string().optional(),
    agreementId: z.string().optional(),
    status: z.string().optional(),
    signingUrls: z.array(SignatureSigningUrl).optional(),
    code: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();
export type SignatureSendResponse = z.infer<typeof SignatureSendResponse>;

// ---------------------------------------------------------------------------
// App DOCX served-app plane (/api/app-docx/*, ch07 document base v2; 2C-S4). The served
// document-base app's window onto its linked Word document (source + redlines managed by
// apps/document-source.ts over the services/docx-redline engine). Header-scoped like
// app-files (X-Ekoa-App-Id, no JWT); admission mirrors app-files' admitApp INCLUDING the
// owner-activation gate. status/projection/edits return JSON validated against these
// schemas; current/clean stream the working/clean .docx bytes (kind:'binary', like the
// app-files binary routes). Non-2xx bodies: the owner-activation gate emits the shared
// ErrorEnvelope (403 ACCOUNT_DISABLED / 402 BILLING_LOCKED); the header/404/500/422 paths
// use the accepted served-app flat { error } precedent (422 also carries per-op failures).
// ---------------------------------------------------------------------------

/** GET /api/app-docx/status — the linked-document status. `fileName`/`updatedAt` are present
 *  only when a source is linked; an app with no document emits just `{ hasSource:false }`. */
export const AppDocxStatusResponse = z.object({
  hasSource: z.boolean(),
  fileName: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type AppDocxStatusResponse = z.infer<typeof AppDocxStatusResponse>;

/** GET /api/app-docx/projection — the CriticMarkup markdown projection of the working doc. */
export const AppDocxProjectionResponse = z.object({
  markdown: z.string(),
  fileName: z.string(),
});
export type AppDocxProjectionResponse = z.infer<typeof AppDocxProjectionResponse>;

/** The redline engine's per-batch report (apps/document-source.applyReview → services/
 *  docx-redline). App-owned numeric/detail shape; `.passthrough()` keeps it byte-safe as the
 *  engine's report grows (the route forwards the report as-is). */
export const AppDocxReviewReport = z
  .object({
    actions_applied: z.number().optional(),
    actions_skipped: z.number().optional(),
    actions_already_resolved: z.number().optional(),
    edits_applied: z.number().optional(),
    edits_skipped: z.number().optional(),
    occurrences_modified: z.number().optional(),
    skipped_details: z.array(z.string()).optional(),
    edits: z.array(z.record(z.unknown())).optional(),
    engine: z.string().optional(),
    version: z.string().optional(),
    resolutions_applied: z.number().optional(),
    resolutions_unchanged: z.number().optional(),
    comment_anchors_repaired: z.number().optional(),
    comments_dropped: z.number().optional(),
  })
  .passthrough();
export type AppDocxReviewReport = z.infer<typeof AppDocxReviewReport>;

/** POST /api/app-docx/edits body — the human review batch. Each op's `type` is one of
 *  accept/reject/reply/modify/resolve/unresolve; the structural fields are validated by the
 *  engine, so the shared shape stays permissive (record) here. */
export const AppDocxEditsRequest = z.object({ ops: z.array(z.record(z.unknown())) });
export type AppDocxEditsRequest = z.infer<typeof AppDocxEditsRequest>;

/** POST /api/app-docx/edits success body — the fresh projection + the engine report. */
export const AppDocxEditsResponse = z.object({
  markdown: z.string(),
  fileName: z.string(),
  report: AppDocxReviewReport,
});
export type AppDocxEditsResponse = z.infer<typeof AppDocxEditsResponse>;

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
  // Manual insolvência-watch poll trigger (mega-run E4, BRIEF §8 item 4): no scheduler
  // exists yet (see InsolvenciaPollRequest doc comment for the decision) - runs one poll
  // cycle for a single dossiê, same tier + allowlist as the other portal routes.
  legalPortalInsolvencyPoll: {
    method: 'POST',
    path: '/api/legal/portal/insolvency/poll',
    auth: 'header-scoped',
    request: InsolvenciaPollRequest,
    response: InsolvenciaPollResponse,
  },
  signatureSend: { method: 'POST', path: '/api/signature/send', auth: 'header-scoped', request: SignatureSendRequest, response: SignatureSendResponse },

  // Adobe Sign webhook (deliberately public; authenticity re-verified server-side).
  adobeSignWebhookGet: { method: 'GET', path: '/api/adobe-sign/webhook', auth: 'public', query: GenericQuery, response: z.unknown() },
  adobeSignWebhookPost: { method: 'POST', path: '/api/adobe-sign/webhook', auth: 'public', request: z.unknown(), response: z.unknown() },

  // Zoho Sign webhook (deliberately public + credential-free; authenticity re-verified
  // server-side in 2B-S3). The send/status/sign-url/document routes stay router-internal.
  zohoSignWebhookGet: { method: 'GET', path: '/api/zoho-sign/webhook', auth: 'public', query: GenericQuery, response: OkResponse },
  zohoSignWebhookPost: { method: 'POST', path: '/api/zoho-sign/webhook', auth: 'public', request: z.unknown(), response: OkResponse },
  // Post-sign redirect bounce: Zoho redirect_pages rejects a bare '#', so we 302 to the
  // hash route; the ekoa.io / configured-origin guard keeps it from being an open redirector.
  zohoSignReturn: { method: 'GET', path: '/api/zoho-sign/return', auth: 'public', kind: 'redirect', query: GenericQuery, response: z.unknown() },

  // App DOCX (document base v2, 2C-S4): the served app's window onto its linked Word doc.
  // Header-scoped like app-files; admission mirrors app-files' admitApp incl. the owner-
  // activation gate. current/clean stream the working/clean .docx bytes (binary).
  appDocxStatus: { method: 'GET', path: '/api/app-docx/status', auth: 'header-scoped', response: AppDocxStatusResponse },
  appDocxProjection: { method: 'GET', path: '/api/app-docx/projection', auth: 'header-scoped', response: AppDocxProjectionResponse },
  appDocxCurrent: { method: 'GET', path: '/api/app-docx/current', auth: 'header-scoped', kind: 'binary', response: z.unknown() },
  appDocxClean: { method: 'POST', path: '/api/app-docx/clean', auth: 'header-scoped', kind: 'binary', response: z.unknown() },
  appDocxEdits: { method: 'POST', path: '/api/app-docx/edits', auth: 'header-scoped', request: AppDocxEditsRequest, response: AppDocxEditsResponse },

  // App health probe (injected into every served HTML; featured artifacts skipped).
  appHealth: { method: 'POST', path: '/api/app-health', auth: 'header-scoped', request: z.record(z.unknown()), response: OkResponse },

  // Static serving (shareability gate on document requests; slug-to-canonical-id resolution).
  serveApp: { method: 'GET', path: '/apps/:idOrSlug/', auth: 'public', kind: 'static', query: GenericQuery, response: z.unknown() },
  serveBuild: { method: 'GET', path: '/build/:slug', auth: 'public', kind: 'static', response: z.unknown() },
  demoBridge: { method: 'GET', path: '/__ekoa/demo-bridge.js', auth: 'public', kind: 'static', response: z.unknown() },
  demoAvailability: { method: 'GET', path: '/api/demos/:appId/availability', auth: 'public', response: DemoAvailabilityResponse },
} as const satisfies DomainDescriptorMap;
