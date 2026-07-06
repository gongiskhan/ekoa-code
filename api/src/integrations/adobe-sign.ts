/**
 * Adobe Acrobat Sign — the e-signature stack for served artifacts (integrations/,
 * ch02 §2.6; G4 debt re-owned at G6 for POST /api/signature/send + /api/adobe-sign/*).
 *
 * This module owns the byte-compatible WIRE surface carried from the old server.ts
 * block (requireAdobeAppContext, sendAdobeError, the status/send/agreement reads,
 * and the deliberately public webhook echo), the credential-free signature-provider
 * facade (adobe-sign active, CMD pluggable behind it), and the inbound-webhook
 * business logic.
 *
 * The LIVE Adobe REST/OAuth/PDF path (transient-document upload, agreement
 * creation, signing-URL polling, HTML→PDF via the browser pool, OAuth refresh,
 * credential decrypt) is behind an injected `AdobeSignBackend` seam. It depends on
 * modules that land in their own build phases (platform-oauth, artifact-pdf, the
 * integration credential store), so the default backend is "not connected": every
 * privileged call raises `not_connected` (→ 409) and `isConnected` is false — the
 * exact contract the served apps and the signature-provider tests exercise without
 * credentials. The composition root injects the live backend once those modules
 * exist. (DEVIATION logged in RUN_LOG: live Adobe integration deferred; wire
 * contract + error mapping preserved.)
 */
import { Buffer } from 'node:buffer';
import { Router, type Request, type Response } from 'express';

// ----------------------------------------------------------------------------
// Types + errors (carried from cortex/src/services/adobe-sign.ts)
// ----------------------------------------------------------------------------

export interface SignRecipient {
  email: string;
  name?: string;
  /** SIGNER (default) | APPROVER | ACCEPTOR | CERTIFIED_RECIPIENT | FORM_FILLER */
  role?: string;
  /** 1-based signing position; equal orders sign in parallel. */
  order?: number;
}

export interface SendForSignatureInput {
  ownerUserId?: string;
  documentName: string;
  fileName?: string;
  html?: string;
  pdfBase64?: string;
  recipients: SignRecipient[];
  ccs?: string[];
  message?: string;
  redirectUrl?: string;
  externalRef?: { appId?: string; propostaId?: string; clientEmail?: string };
}

export interface SigningUrl {
  email: string;
  esignUrl: string;
}

export interface SendForSignatureResult {
  agreementId: string;
  status: string;
  signingUrls: SigningUrl[];
}

export class AdobeSignNotConnectedError extends Error {
  readonly code = 'not_connected';
  constructor(message = 'Adobe Acrobat Sign is not connected for this workspace.') {
    super(message);
    this.name = 'AdobeSignNotConnectedError';
  }
}

export class AdobeSignError extends Error {
  readonly status: number;
  readonly detail?: string;
  constructor(message: string, status = 502, detail?: string) {
    super(message);
    this.name = 'AdobeSignError';
    this.status = status;
    this.detail = detail;
  }
}

// ----------------------------------------------------------------------------
// Pluggable live backend (default: not connected)
// ----------------------------------------------------------------------------

/**
 * The privileged Adobe REST operations. The default implementation is "not
 * connected"; the composition root injects a live backend (transient-document
 * upload + agreement creation + OAuth) once the integration modules land.
 */
export interface AdobeSignBackend {
  isConnected(ownerUserId?: string): Promise<boolean>;
  sendForSignature(input: SendForSignatureInput): Promise<SendForSignatureResult>;
  getAgreement(ownerUserId: string | undefined, agreementId: string): Promise<unknown>;
  getSigningUrls(ownerUserId: string | undefined, agreementId: string): Promise<SigningUrl[]>;
  getCombinedDocument(ownerUserId: string | undefined, agreementId: string): Promise<{ bytes: Buffer; contentType: string }>;
}

export const notConnectedBackend: AdobeSignBackend = {
  async isConnected(): Promise<boolean> {
    return false;
  },
  async sendForSignature(): Promise<SendForSignatureResult> {
    throw new AdobeSignNotConnectedError();
  },
  async getAgreement(): Promise<unknown> {
    throw new AdobeSignNotConnectedError();
  },
  async getSigningUrls(): Promise<SigningUrl[]> {
    throw new AdobeSignNotConnectedError();
  },
  async getCombinedDocument(): Promise<{ bytes: Buffer; contentType: string }> {
    throw new AdobeSignNotConnectedError();
  },
};

/** Uppercased Adobe status considered "signed/complete". */
function isAdobeSignedStatus(s: unknown): boolean {
  const v = String(s || '').toUpperCase();
  return v === 'SIGNED' || v === 'COMPLETED' || v === 'APPROVED' || v === 'ACCEPTED' || v === 'DELEGATED' || v === 'FORM_FILLED';
}

/**
 * Has the given signer (the "client") signed this agreement? Pure port of the ERP
 * `adobeEmailSigned`: true if the whole agreement is signed/complete, OR any
 * participant matching `email` is in a signed status.
 */
export function adobeClientSigned(agreement: unknown, email: string): boolean {
  const a = (agreement || {}) as {
    status?: string;
    participantSetsInfo?: Array<{ status?: string; memberInfos?: Array<{ email?: string; status?: string }> }>;
  };
  if (isAdobeSignedStatus(a.status)) return true;
  const want = String(email || '').toLowerCase();
  const sets = Array.isArray(a.participantSetsInfo) ? a.participantSetsInfo : [];
  const mine: string[] = [];
  for (const s of sets) {
    for (const m of s.memberInfos || []) {
      if (String(m.email || '').toLowerCase() === want) {
        mine.push(String(m.status || s.status || '').toUpperCase());
      }
    }
  }
  return mine.length > 0 && mine.some((st) => isAdobeSignedStatus(st));
}

// ----------------------------------------------------------------------------
// Signature-provider facade (credential-free contract; adobe-sign active, CMD stub)
// ----------------------------------------------------------------------------

export interface SignatureRecipient {
  email: string;
  name?: string;
  role?: string;
  order?: number;
}
export interface SignatureSendInput {
  ownerUserId?: string;
  title: string;
  documentPdfBase64?: string;
  documentHtml?: string;
  recipients: SignatureRecipient[];
}
export interface SignatureSendResult {
  ok: boolean;
  provider: string;
  agreementId?: string;
  status?: string;
  signingUrls?: SigningUrl[];
  code?: string;
  error?: string;
}
export interface SignatureProvider {
  key: string;
  isAvailable(ownerUserId?: string): Promise<boolean>;
  send(input: SignatureSendInput): Promise<SignatureSendResult>;
}

/** Sanitized `{ code, error }` from an Adobe service error. */
function adobeErrorFields(err: unknown): { code?: string; error: string } {
  const e = err as { code?: string; message?: string };
  return { code: e?.code, error: e?.message || 'Pedido de assinatura falhou.' };
}

/** Mensagem única PT-PT enquanto a CMD (Chave Móvel Digital) não está ligada. */
export const CMD_UNAVAILABLE_MESSAGE =
  'A assinatura com Chave Móvel Digital ainda não está disponível. A via de assinatura ativa é a Adobe Sign.';

const cmdSignatureProvider: SignatureProvider = {
  key: 'cmd',
  async isAvailable(): Promise<boolean> {
    return false;
  },
  async send(): Promise<SignatureSendResult> {
    return { ok: false, provider: 'cmd', code: 'not_available', error: CMD_UNAVAILABLE_MESSAGE };
  },
};

/** Active provider — delegates to the injected Adobe backend (never reimplements it). */
function makeAdobeSignatureProvider(backend: AdobeSignBackend): SignatureProvider {
  return {
    key: 'adobe-sign',
    async isAvailable(ownerUserId): Promise<boolean> {
      return backend.isConnected(ownerUserId);
    },
    async send(input): Promise<SignatureSendResult> {
      try {
        const result = await backend.sendForSignature({
          ownerUserId: input.ownerUserId,
          documentName: input.title,
          html: input.documentHtml,
          pdfBase64: input.documentPdfBase64,
          recipients: input.recipients,
        });
        return { ok: true, provider: 'adobe-sign', agreementId: result.agreementId, status: result.status, signingUrls: result.signingUrls };
      } catch (err) {
        return { ok: false, provider: 'adobe-sign', ...adobeErrorFields(err) };
      }
    },
  };
}

/** Factory: `adobe-sign` (default/unknown key) or the inactive `cmd` seam. */
export function getSignatureProvider(key: string, backend: AdobeSignBackend): SignatureProvider {
  if (key === 'cmd') return cmdSignatureProvider;
  return makeAdobeSignatureProvider(backend);
}

// ----------------------------------------------------------------------------
// Inbound-webhook business logic (owner-scoped re-verify; replay-safe)
// ----------------------------------------------------------------------------

export interface AdobeAgreementRef {
  ownerUserId: string;
  appId: string;
  propostaId: string;
  clientEmail: string;
}
export interface AdobeWebhookDeps {
  findAgreement: (agreementId: string) => Promise<AdobeAgreementRef | null>;
  getAgreement: (ownerUserId: string, agreementId: string) => Promise<unknown>;
  getProposta: (appId: string, id: string) => Promise<Record<string, unknown> | null>;
  updateProposta: (appId: string, id: string, patch: Record<string, unknown>) => Promise<void>;
}

function isSignatureRelevantEvent(eventName: string): boolean {
  if (!eventName) return true;
  const v = eventName.toUpperCase();
  return v.includes('ACTION_COMPLETED') || v.includes('WORKFLOW_COMPLETED') || v.includes('SIGNED') || v.includes('COMPLETED');
}

function extractAgreementId(payload: Record<string, unknown>): string {
  const agreement = payload.agreement as { id?: string } | undefined;
  return String((agreement && agreement.id) || payload.agreementId || '').trim();
}

/**
 * Process one Adobe webhook notification. NEVER trusts the payload for signature
 * STATE: it resolves the agreementId to a known record, RE-FETCHES owner-scoped,
 * and only then confirms the client signed. Idempotent (guarded on stage !==
 * 'Assinada'). Best-effort — swallows-and-logs every error. Returns an outcome
 * string for logging/tests.
 */
export async function handleAdobeWebhook(payload: Record<string, unknown>, deps: AdobeWebhookDeps): Promise<string> {
  try {
    const agreementId = extractAgreementId(payload);
    const eventName = String(payload.event || payload.eventType || '');
    if (!agreementId) return log('ignored: no agreementId in payload');

    const ref = await deps.findAgreement(agreementId);
    if (!ref) return log(`ignored: unknown agreementId ${agreementId}`);
    if (!isSignatureRelevantEvent(eventName)) return log(`ignored: non-signature event ${eventName} for ${agreementId}`);

    let agreement: unknown;
    try {
      agreement = await deps.getAgreement(ref.ownerUserId, agreementId);
    } catch (e) {
      return log(`skip: getAgreement failed for ${agreementId}: ${(e as Error)?.message}`);
    }
    if (!adobeClientSigned(agreement, ref.clientEmail)) {
      return log(`skip: client ${ref.clientEmail} not signed yet on ${agreementId} (event ${eventName})`);
    }

    let proposta: Record<string, unknown> | null = null;
    try {
      proposta = await deps.getProposta(ref.appId, ref.propostaId);
    } catch {
      proposta = null;
    }
    if (!proposta) return log(`skip: proposta ${ref.propostaId} not found in ${ref.appId}`);
    if (String(proposta.stage) === 'Assinada') return log(`no-op: proposta ${ref.propostaId} already Assinada`);

    const nowIso = new Date().toISOString();
    const existingESig = proposta.eSignature && typeof proposta.eSignature === 'object' ? (proposta.eSignature as Record<string, unknown>) : {};
    const assinatura = proposta.assinatura && typeof proposta.assinatura === 'object' ? (proposta.assinatura as Record<string, unknown>) : {};
    const signatario = String(assinatura.nome || proposta.client || 'Cliente');

    await deps.updateProposta(ref.appId, ref.propostaId, {
      stage: 'Assinada',
      eSignature: { ...existingESig, status: 'SIGNED', clientSignedAt: nowIso },
      assinaturaCliente: { nome: signatario, data: nowIso },
      assinadaEm: nowIso,
      conversionPending: true,
    });
    return log(`advanced proposta ${ref.propostaId} (${ref.appId}) -> Assinada + conversionPending (agreement ${agreementId})`);
  } catch (e) {
    return log(`error: ${(e as Error)?.message}`);
  }
}

function log(msg: string): string {
  console.log('[adobe-webhook]', msg);
  return msg;
}

// ----------------------------------------------------------------------------
// Route helpers (carried verbatim from cortex/src/server.ts)
// ----------------------------------------------------------------------------

const SAFE_APP_ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

export interface AdobeRouterDeps {
  /** Resolve X-Ekoa-App-Id (slug or id) -> registered app (owner + canonical id), or null. */
  resolveApp: (idOrSlug: string) => Promise<{ appId: string; ownerUserId: string } | null>;
  /** Live Adobe backend. Default: notConnectedBackend (isConnected=false, calls -> not_connected). */
  backend?: AdobeSignBackend;
  /** Platform Adobe clientId to compare the webhook `X-AdobeSign-ClientId` against (echo either way). */
  adobeClientId?: string;
  /** Inbound-webhook dispatch (fired async after the 200 echo). Default: no-op. */
  onWebhook?: (payload: Record<string, unknown>) => Promise<unknown>;
}

/** Map an adobe-sign service error to a sanitized HTTP response. */
export function sendAdobeError(res: Response, err: unknown): void {
  const e = err as { code?: string; status?: number; message?: string; detail?: string };
  if (e?.code === 'not_connected') {
    res.status(409).json({ error: 'not_connected', message: e.message || 'Adobe Acrobat Sign is not connected.' });
    return;
  }
  const status = typeof e?.status === 'number' && e.status >= 400 && e.status < 600 ? e.status : 502;
  const message = e?.message || 'Adobe Acrobat Sign request failed.';
  console.error('[adobe-sign]', message, e?.detail ? `· ${e.detail}` : '');
  res.status(status).json({ error: message });
}

export function adobeSignRouter(deps: AdobeRouterDeps): Router {
  const r = Router();
  const backend = deps.backend ?? notConnectedBackend;

  /** X-Ekoa-App-Id -> registered app -> ownerUserId (owner-scoped credential lookup). */
  async function requireAdobeAppContext(req: Request, res: Response): Promise<{ ownerUserId: string; appId: string } | null> {
    const headerId = (req.headers['x-ekoa-app-id'] as string | undefined) || '';
    if (!headerId) {
      res.status(400).json({ error: 'Missing X-Ekoa-App-Id header' });
      return null;
    }
    const resolved = await deps.resolveApp(headerId);
    const appId = resolved?.appId ?? headerId;
    if (!SAFE_APP_ID_RE.test(appId)) {
      res.status(400).json({ error: 'Invalid X-Ekoa-App-Id header' });
      return null;
    }
    if (!resolved) {
      res.status(404).json({ error: 'Unknown app' });
      return null;
    }
    return { ownerUserId: resolved.ownerUserId, appId };
  }

  /** Adobe webhook echo: proves we control the endpoint (weak authenticator). */
  function echoAdobeClientId(req: Request, res: Response): void {
    res.setHeader('Cache-Control', 'no-store');
    const clientId = (req.headers['x-adobesign-clientid'] as string | undefined) || '';
    if (clientId) {
      if (deps.adobeClientId && clientId !== deps.adobeClientId) {
        console.warn('[adobe-sign] webhook clientId mismatch (echoing anyway)');
      }
      res.setHeader('X-AdobeSign-ClientId', clientId);
    }
    res.status(200).json({ xAdobeSignClientId: clientId });
  }

  // GET /api/adobe-sign/status
  r.get('/api/adobe-sign/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ctx = await requireAdobeAppContext(req, res);
    if (!ctx) return;
    try {
      res.json({ connected: await backend.isConnected(ctx.ownerUserId) });
    } catch (err) {
      sendAdobeError(res, err);
    }
  });

  // POST /api/adobe-sign/send
  r.post('/api/adobe-sign/send', async (req, res) => {
    const ctx = await requireAdobeAppContext(req, res);
    if (!ctx) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const externalRefIn = (body.externalRef && typeof body.externalRef === 'object' ? body.externalRef : {}) as Record<string, unknown>;
    try {
      const result = await backend.sendForSignature({
        ownerUserId: ctx.ownerUserId,
        documentName: String(body.documentName || 'Documento'),
        fileName: body.fileName != null ? String(body.fileName) : undefined,
        html: body.html != null ? String(body.html) : undefined,
        pdfBase64: body.pdfBase64 != null ? String(body.pdfBase64) : undefined,
        recipients: Array.isArray(body.recipients) ? (body.recipients as SignRecipient[]) : [],
        ccs: Array.isArray(body.ccs) ? (body.ccs as string[]) : undefined,
        message: body.message != null ? String(body.message) : undefined,
        redirectUrl: body.redirectUrl != null ? String(body.redirectUrl) : undefined,
        // appId is server-trusted (from the app context), never the body.
        externalRef: { appId: ctx.appId, propostaId: externalRefIn.propostaId != null ? String(externalRefIn.propostaId) : undefined, clientEmail: externalRefIn.clientEmail != null ? String(externalRefIn.clientEmail) : undefined },
      });
      res.json({ success: true, ...result });
    } catch (err) {
      sendAdobeError(res, err);
    }
  });

  // GET /api/adobe-sign/agreements/:id
  r.get('/api/adobe-sign/agreements/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ctx = await requireAdobeAppContext(req, res);
    if (!ctx) return;
    try {
      res.json({ success: true, agreement: await backend.getAgreement(ctx.ownerUserId, req.params.id as string) });
    } catch (err) {
      sendAdobeError(res, err);
    }
  });

  // GET /api/adobe-sign/agreements/:id/signing-urls
  r.get('/api/adobe-sign/agreements/:id/signing-urls', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ctx = await requireAdobeAppContext(req, res);
    if (!ctx) return;
    try {
      res.json({ success: true, signingUrls: await backend.getSigningUrls(ctx.ownerUserId, req.params.id as string) });
    } catch (err) {
      sendAdobeError(res, err);
    }
  });

  // GET /api/adobe-sign/agreements/:id/document
  r.get('/api/adobe-sign/agreements/:id/document', async (req, res) => {
    const ctx = await requireAdobeAppContext(req, res);
    if (!ctx) return;
    try {
      const { bytes, contentType } = await backend.getCombinedDocument(ctx.ownerUserId, req.params.id as string);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="agreement-${req.params.id}.pdf"`);
      res.send(bytes);
    } catch (err) {
      sendAdobeError(res, err);
    }
  });

  // GET/POST /api/adobe-sign/webhook — deliberately public (echo + async dispatch).
  r.get('/api/adobe-sign/webhook', (req, res) => echoAdobeClientId(req, res));
  r.post('/api/adobe-sign/webhook', (req, res) => {
    echoAdobeClientId(req, res); // reply 200 immediately
    const payload = (req.body ?? {}) as Record<string, unknown>;
    if (deps.onWebhook) {
      Promise.resolve(deps.onWebhook(payload)).catch((e) => console.error('[adobe-sign] webhook dispatch failed:', (e as Error)?.message));
    }
  });

  // POST /api/signature/send — pluggable e-signature provider (default adobe-sign).
  r.post('/api/signature/send', async (req, res) => {
    const ctx = await requireAdobeAppContext(req, res);
    if (!ctx) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const providerKey = body.provider != null ? String(body.provider) : 'adobe-sign';
    const provider = getSignatureProvider(providerKey, backend);
    try {
      const result = await provider.send({
        ownerUserId: ctx.ownerUserId,
        title: String(body.title || 'Documento'),
        documentPdfBase64: body.documentPdfBase64 != null ? String(body.documentPdfBase64) : undefined,
        documentHtml: body.documentHtml != null ? String(body.documentHtml) : undefined,
        recipients: Array.isArray(body.recipients) ? (body.recipients as SignatureRecipient[]) : [],
      });
      if (!result.ok) {
        const status = result.code === 'not_connected' ? 409 : result.code === 'not_available' ? 501 : 502;
        res.status(status).json(result);
        return;
      }
      res.json(result);
    } catch {
      res.status(502).json({ ok: false, error: 'Pedido de assinatura falhou.' });
    }
  });

  return r;
}
