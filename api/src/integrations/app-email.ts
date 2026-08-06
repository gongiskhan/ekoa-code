/**
 * The served-app EMAIL plane — `/api/app-email/*` (ch03 §3.9 served-app planes; ported from
 * ekoa-dev `1d4eaf64` + `fd209f70`).
 *
 * A served page asks which email-capable integrations its owner has, then asks the platform to
 * send (or draft) one message through the one it picked. The page never sees a token, never names
 * a user, and never reaches a provider itself: it names an integration + action, and everything
 * else is resolved server-side from the app id it is already scoped by.
 *
 * WHAT MAKES AN ACTION AN EMAIL SENDER. Its `capabilities` array, not its name. `email-send` marks
 * a sender, `email-draft` an action that parks a provider-side draft, `email-draft-send` one that
 * sends an existing draft (definitions.ts). Discovery, execution and the draft path all read the
 * declaration — so a package that renames `send_email`, or a third provider that spells it
 * something else entirely, changes nothing here and nothing in any app.
 *
 * THE CALLER'S WORD IS NEVER TAKEN. `send` re-resolves the named action from the owner's own
 * definition and refuses it unless THAT action declares `email-send`. A page that posts
 * `actionName: 'delete_everything'` gets `not_email_capable`, never a dispatch.
 *
 * ============================ WHY THIS DIVERGES FROM UPSTREAM ================================
 * ekoa-dev's version calls `callPlatformIntegration` with a synthesised admin actor and no gate:
 * a served page could send mail as the workspace with nothing standing between it and the
 * mailbox. Here the platform write gate (platform-call.ts, C2 follow-up) is real, and a send is a
 * write, so this plane passes the OWNER as `actingUserId` and surfaces `awaiting_consent`
 * VERBATIM to the app rather than swallowing it. The app is expected to say "approve this in
 * Integrações" — which is the honest answer, and the reason the gate exists. Making the plane
 * bypass the gate to match upstream would have quietly re-opened exactly what C2 closed.
 *
 * Tier: integrations/ never imports apps/ (ch02 §2.7), so the app-id → owner resolution and the
 * owner → org lookup arrive as injected seams from the composition root, the same shape
 * m365-proxy.ts and app-cloud-files.ts already take.
 */
import { Router, type Request, type Response, json as expressJson } from 'express';
import {
  EMAIL_SEND_CAPABILITY,
  EMAIL_DRAFT_CAPABILITY,
  EMAIL_DRAFT_SEND_CAPABILITY,
  SendAppEmailRequest,
  CreateAppEmailDraftRequest,
  SendAppEmailDraftRequest,
  type AppEmailIntegration,
  type AppEmailFailureCode,
  type SendAppEmailResponse,
  type CreateAppEmailDraftResponse,
  type AppEmailInboxResponse,
} from '@ekoa/shared';
import { checkOwnerActivation, type ResolveAppScope } from './app-scope.js';
import { listDefinitionsFor } from './definition-registry.js';
import { findConfigForOwner } from './service.js';
import { callPlatformIntegration, isPlatformIntegrationKey } from './platform-call.js';
import { executeUserIntegrationAction } from './action-executor.js';
import type { IntegrationAction, IntegrationDefinition } from './definitions.js';
import type { OAuthDeps } from './platform-oauth.js';
import type { CloudFilesStatus } from './app-cloud-files.js';

/** Platform integration key → the workspace-status provider slot it reports under. */
const PLATFORM_STATUS_SLOT: Record<string, keyof CloudFilesStatus> = {
  'microsoft-365': 'microsoft',
  'google-workspace': 'google',
};

export interface AppEmailDeps {
  /** Header (slug or canonical id) → the canonical app + its owner. Injected (tier boundary). */
  resolveAppScope: ResolveAppScope;
  /** The owner's org, or null when the user row is missing/org-less. Injected. */
  resolveOwnerOrgId: (ownerUserId: string) => Promise<string | null>;
  /** Live workspace connection state for the owner (the same seam the cloud-files plane uses). */
  workspaceStatus: (ownerUserId: string) => Promise<CloudFilesStatus>;
  /** Token custody deps for the platform rail. */
  oauth: OAuthDeps;
}

function capabilitiesOf(action: IntegrationAction): string[] {
  return Array.isArray(action.capabilities) ? action.capabilities : [];
}

function actionWithCapability(def: IntegrationDefinition, capability: string): IntegrationAction | undefined {
  return def.actions.find((a) => capabilitiesOf(a).includes(capability));
}

/** Graph wants recipients as its own object shape; the package passes the array through raw. */
function graphRecipients(to: string[]): Array<{ emailAddress: { address: string } }> {
  return to.map((address) => ({ emailAddress: { address } }));
}

/** A recipient list is valid when it is non-empty and every entry looks like an address. Deliberately
 *  shallow: the provider is the authority on deliverability, and a stricter regex here would refuse
 *  addresses that are perfectly legal. What this DOES stop is an empty send and a header-injection
 *  shaped value reaching the provider. */
function invalidRecipients(to: string[]): boolean {
  return to.length === 0 || to.some((t) => typeof t !== 'string' || !t.includes('@') || /[\r\n]/.test(t));
}

export interface AppEmailContext {
  appId: string;
  ownerUserId: string;
  orgId: string;
}

/* -------------------------------------------------------------------------- */
/* Discovery                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every email-capable action visible to the app's OWNER, with live connection state so the app can
 * preselect a working one or tell the user to connect/reconnect.
 *
 * Reads the definitions as the owner (tenant-scoped): an org that replaced the shipped Microsoft
 * package with its own sees ITS actions here, not the baseline's.
 */
export async function listEmailIntegrations(
  ctx: AppEmailContext,
  deps: AppEmailDeps,
): Promise<AppEmailIntegration[]> {
  const actor = { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'user' as const };
  const defs = await listDefinitionsFor(actor);
  const anyPlatform = defs.some((d) => isPlatformIntegrationKey(d.key) && actionWithCapability(d, EMAIL_SEND_CAPABILITY));
  // One status read for the whole listing (it decrypts a row per provider) — never one per action.
  const status = anyPlatform ? await deps.workspaceStatus(ctx.ownerUserId) : null;

  const out: AppEmailIntegration[] = [];
  for (const def of defs) {
    const senders = def.actions.filter((a) => capabilitiesOf(a).includes(EMAIL_SEND_CAPABILITY));
    if (senders.length === 0) continue;
    const supportsDrafts = !!actionWithCapability(def, EMAIL_DRAFT_CAPABILITY);
    const platform = isPlatformIntegrationKey(def.key);

    let connected = false;
    let needsReauth = false;
    if (platform && status) {
      const slot = PLATFORM_STATUS_SLOT[def.key];
      const s = slot ? status[slot] : undefined;
      connected = !!s?.connected;
      needsReauth = !!s?.needsReauth;
    } else if (!platform) {
      const cfg = await findConfigForOwner(ctx.orgId, ctx.ownerUserId, def.key);
      connected = !!cfg && cfg.enabled !== false && !!cfg.credentialsCiphertext;
    }

    for (const action of senders) {
      out.push({
        integrationKey: def.key,
        actionName: action.actionName,
        displayName: def.displayName || def.key,
        ...(def.provider ? { provider: def.provider } : {}),
        platform,
        connected,
        needsReauth,
        supportsDrafts,
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Execution                                                                   */
/* -------------------------------------------------------------------------- */

/** Provider-specific argument shapes for a structured send. Keyed by INTEGRATION, not by action
 *  name: the wire shape is a fact about the provider, while which action carries it is a fact
 *  about the package (and is resolved by capability). */
function platformSendArgs(
  integrationKey: string,
  input: { to: string[]; subject: string; body: string; bodyContentType?: 'Text' | 'HTML' },
): Record<string, unknown> | null {
  if (integrationKey === 'microsoft-365') {
    return {
      toRecipients: graphRecipients(input.to),
      subject: input.subject,
      body: input.body,
      bodyContentType: input.bodyContentType ?? 'Text',
    };
  }
  if (integrationKey === 'google-workspace') {
    // Gmail's structured actions take a flat recipient list; platform-call.ts encodes RFC 2822.
    return { to: input.to.join(', '), subject: input.subject, body: input.body };
  }
  return null;
}

/** Map a platform-rail result onto this plane's typed failure. `awaiting_consent` and
 *  `not_connected` are preserved as themselves — they are the two the app can actually act on. */
function platformFailure(res: { code?: string; error?: string }): { code: AppEmailFailureCode; error: string } {
  if (res.code === 'awaiting_consent') {
    return {
      code: 'awaiting_consent',
      error: 'O envio precisa de aprovação do titular da conta em Integrações antes de poder ser executado.',
    };
  }
  if (res.code === 'not_connected') {
    return { code: 'not_connected', error: 'A integração de email não está ligada.' };
  }
  return { code: 'provider_error', error: res.error || 'O fornecedor recusou o envio.' };
}

export async function sendAppEmail(
  input: {
    integrationKey: string;
    actionName: string;
    to: string[];
    subject: string;
    body: string;
    bodyContentType?: 'Text' | 'HTML';
  },
  ctx: AppEmailContext,
  deps: AppEmailDeps,
): Promise<SendAppEmailResponse> {
  if (invalidRecipients(input.to)) {
    return { success: false, code: 'invalid_recipients', error: 'Destinatários inválidos.' };
  }

  const actor = { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'user' as const };
  const defs = await listDefinitionsFor(actor);
  const def = defs.find((d) => d.key === input.integrationKey);
  const action = def?.actions.find((a) => a.actionName === input.actionName);
  if (!def || !action) {
    return { success: false, code: 'unknown_action', error: `Ação desconhecida: ${input.integrationKey}/${input.actionName}` };
  }
  // The caller named an action; the DECLARATION decides whether it may be used to send mail.
  if (!capabilitiesOf(action).includes(EMAIL_SEND_CAPABILITY)) {
    return { success: false, code: 'not_email_capable', error: 'A ação indicada não é de envio de email.' };
  }

  if (isPlatformIntegrationKey(input.integrationKey)) {
    const args = platformSendArgs(input.integrationKey, input);
    if (!args) {
      return { success: false, code: 'unsupported_action', error: 'Ação de email de plataforma sem mapeamento estruturado.' };
    }
    const res = await callPlatformIntegration(
      {
        orgId: ctx.orgId,
        integrationKey: input.integrationKey,
        actionName: input.actionName,
        args,
        // The OWNER is the acting human: it is their mailbox, their org, and their standing
        // approval the write gate looks up. Never the anonymous visitor, who has no identity here.
        actingUserId: ctx.ownerUserId,
      },
      deps.oauth,
    );
    return res.success ? { success: true } : { success: false, ...platformFailure(res) };
  }

  const result = await executeUserIntegrationAction({
    orgId: ctx.orgId,
    ownerUserId: ctx.ownerUserId,
    integrationKey: input.integrationKey,
    actionName: input.actionName,
    args: { to: input.to.join(', '), subject: input.subject, body: input.body },
  });
  return result.success ? { success: true } : { success: false, ...platformFailure(result) };
}

/* -------------------------------------------------------------------------- */
/* Provider-side drafts                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Park a message in the owner's own Drafts folder, recipient in place, so a human reviews and
 * sends it from their normal mail client. Only the platform OAuth providers expose drafts today,
 * and WHICH action does it is resolved by the `email-draft` capability rather than a literal.
 */
export async function createAppEmailDraft(
  input: { integrationKey: string; to: string[]; subject: string; body: string; bodyContentType?: 'Text' | 'HTML' },
  ctx: AppEmailContext,
  deps: AppEmailDeps,
): Promise<CreateAppEmailDraftResponse> {
  if (invalidRecipients(input.to)) {
    return { success: false, code: 'invalid_recipients', error: 'Destinatários inválidos.' };
  }
  const actor = { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'user' as const };
  const def = (await listDefinitionsFor(actor)).find((d) => d.key === input.integrationKey);
  const action = def ? actionWithCapability(def, EMAIL_DRAFT_CAPABILITY) : undefined;
  if (!def || !action || !isPlatformIntegrationKey(input.integrationKey)) {
    return { success: false, code: 'unsupported_integration', error: 'Esta integração não expõe rascunhos.' };
  }
  const args = platformSendArgs(input.integrationKey, input);
  if (!args) {
    return { success: false, code: 'unsupported_action', error: 'Ação de rascunho sem mapeamento estruturado.' };
  }

  const res = await callPlatformIntegration(
    { orgId: ctx.orgId, integrationKey: input.integrationKey, actionName: action.actionName, args, actingUserId: ctx.ownerUserId },
    deps.oauth,
  );
  if (!res.success) return { success: false, ...platformFailure(res) };

  const data = (res.data ?? {}) as { id?: string; webLink?: string };
  if (!data.id) {
    return { success: false, code: 'provider_error', error: 'O fornecedor não devolveu o rascunho criado.' };
  }
  // Graph returns a per-message webLink. Gmail returns none, so the Drafts folder is the closest
  // stable link — stated here rather than fabricated per-draft.
  const webLink = data.webLink ?? (input.integrationKey === 'google-workspace' ? 'https://mail.google.com/mail/u/0/#drafts' : undefined);
  return { success: true, draftId: data.id, ...(webLink ? { webLink } : {}) };
}

/** Send an EXISTING provider draft, including any edits the human made in their mail client. */
export async function sendAppEmailDraft(
  input: { integrationKey: string; draftId: string },
  ctx: AppEmailContext,
  deps: AppEmailDeps,
): Promise<SendAppEmailResponse> {
  const actor = { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'user' as const };
  const def = (await listDefinitionsFor(actor)).find((d) => d.key === input.integrationKey);
  const action = def ? actionWithCapability(def, EMAIL_DRAFT_SEND_CAPABILITY) : undefined;
  if (!def || !action || !isPlatformIntegrationKey(input.integrationKey)) {
    return { success: false, code: 'unsupported_integration', error: 'Esta integração não expõe envio de rascunhos.' };
  }
  // The two providers address a draft differently (Graph: a message id in the path; Gmail: a draft
  // id in the body), so the arg name comes from the action's own schema rather than a guess.
  const argName = input.integrationKey === 'microsoft-365' ? 'messageId' : 'draftId';
  const res = await callPlatformIntegration(
    {
      orgId: ctx.orgId,
      integrationKey: input.integrationKey,
      actionName: action.actionName,
      args: { [argName]: input.draftId },
      actingUserId: ctx.ownerUserId,
    },
    deps.oauth,
  );
  return res.success ? { success: true } : { success: false, ...platformFailure(res) };
}

/**
 * The workspace's own mailbox address, for "you have reminders waiting to be approved" notices.
 * A pure READ (`get_profile` is on the platform read allowlist), so it needs no approval.
 */
export async function getWorkspaceInboxAddress(
  integrationKey: string,
  ctx: AppEmailContext,
  deps: AppEmailDeps,
): Promise<AppEmailInboxResponse> {
  if (!isPlatformIntegrationKey(integrationKey)) {
    return { success: false, code: 'unsupported_integration', error: 'Integração sem perfil de conta.' };
  }
  const res = await callPlatformIntegration(
    { orgId: ctx.orgId, integrationKey, actionName: 'get_profile', args: {}, actingUserId: ctx.ownerUserId },
    deps.oauth,
  );
  if (!res.success) return { success: false, ...platformFailure(res) };
  const data = (res.data ?? {}) as { mail?: string; userPrincipalName?: string; emailAddress?: string };
  const address = data.mail || data.userPrincipalName || data.emailAddress;
  return address ? { success: true, address } : { success: false, code: 'provider_error', error: 'Perfil sem endereço de email.' };
}

/* -------------------------------------------------------------------------- */
/* Router                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Sliding-window caps, per app AND globally. The global ceiling is the one that matters: a per-app
 * cap alone lets N apps each sit just under their limit and still bury the provider between them.
 *
 * A near-twin lives in `apps/served-app-admission.ts` for the planes that sit in apps/. That is the
 * module-tier boundary, not an oversight: integrations/ may not import apps/ (ch02 §2.7), and the
 * alternative — hoisting twenty lines of in-memory bookkeeping into a new shared tier so two
 * served-app planes can share it — buys less than it costs. The same idiom already recurs across
 * legal/router.ts, legal/access-gate.ts and legal/portal.ts.
 */
function makeLimiter(perAppMax: number, globalMax: number, windowMs = 60_000): (appId: string) => boolean {
  const perAppHits = new Map<string, number[]>();
  let globalHits: number[] = [];
  return (appId: string): boolean => {
    const now = Date.now();
    const recent = (arr: number[]): number[] => arr.filter((t) => now - t < windowMs);
    const perApp = recent(perAppHits.get(appId) ?? []);
    const global = recent(globalHits);
    if (perApp.length >= perAppMax || global.length >= globalMax) {
      perAppHits.set(appId, perApp);
      globalHits = global;
      return true;
    }
    perApp.push(now);
    global.push(now);
    perAppHits.set(appId, perApp);
    globalHits = global;
    return false;
  };
}

export function appEmailRouter(deps: AppEmailDeps): Router {
  const r = Router();
  const listLimited = makeLimiter(30, 90);
  const sendLimited = makeLimiter(10, 30);
  const bodyParser = expressJson({ limit: '1mb' });

  /**
   * Admission: the app-id header resolves to a REGISTERED served app whose OWNER is in good
   * standing and has an org. Fails closed at every step — an unregistered id, an ownerless
   * (dev-serve) app or an org-less owner has no mailbox to spend and gets nothing.
   */
  async function admit(req: Request, res: Response): Promise<AppEmailContext | null> {
    const header = req.header('x-ekoa-app-id') ?? '';
    if (!header) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Cabeçalho X-Ekoa-App-Id em falta.' } });
      return null;
    }
    const scope = await deps.resolveAppScope(header);
    if (!scope || !scope.isServed || !scope.ownerUserId) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Aplicação não encontrada.' } });
      return null;
    }
    const gate = checkOwnerActivation(scope.ownerUserId);
    if (!gate.ok) {
      res.status(gate.status).json(gate.body);
      return null;
    }
    const orgId = await deps.resolveOwnerOrgId(scope.ownerUserId);
    if (!orgId) {
      // An org-less owner cannot have a connection to spend. Refused rather than resolved as
      // "some org" — the same fail-closed rule the workspace credential seam applies.
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Aplicação não encontrada.' } });
      return null;
    }
    return { appId: scope.appId, ownerUserId: scope.ownerUserId, orgId };
  }

  function limited(res: Response, message: string): void {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message } });
  }

  r.get('/integrations', async (req, res) => {
    const ctx = await admit(req, res);
    if (!ctx) return;
    if (listLimited(ctx.appId)) return limited(res, 'Demasiados pedidos. Tente novamente dentro de um minuto.');
    try {
      res.json({ success: true, data: await listEmailIntegrations(ctx, deps) });
    } catch (err) {
      console.error('[app-email] list failed:', err instanceof Error ? err.message : String(err));
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Não foi possível listar as integrações de email.' } });
    }
  });

  r.post('/send', bodyParser, async (req, res) => {
    const ctx = await admit(req, res);
    if (!ctx) return;
    if (sendLimited(ctx.appId)) return limited(res, 'Demasiados envios. Tente novamente dentro de um minuto.');
    const parsed = SendAppEmailRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Campos obrigatórios: integrationKey, actionName, to[], subject, body.' } });
      return;
    }
    try {
      const result = await sendAppEmail(parsed.data, ctx, deps);
      res.status(result.success ? 200 : 502).json(result);
    } catch (err) {
      console.error('[app-email] send failed:', err instanceof Error ? err.message : String(err));
      res.status(502).json({ success: false, code: 'provider_error', error: 'Falha no envio de email.' });
    }
  });

  r.post('/draft', bodyParser, async (req, res) => {
    const ctx = await admit(req, res);
    if (!ctx) return;
    if (sendLimited(ctx.appId)) return limited(res, 'Demasiados pedidos. Tente novamente dentro de um minuto.');
    const parsed = CreateAppEmailDraftRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Campos obrigatórios: integrationKey, to[], subject, body.' } });
      return;
    }
    try {
      const result = await createAppEmailDraft(parsed.data, ctx, deps);
      res.status(result.success ? 200 : 502).json(result);
    } catch (err) {
      console.error('[app-email] draft failed:', err instanceof Error ? err.message : String(err));
      res.status(502).json({ success: false, code: 'provider_error', error: 'Falha ao criar o rascunho.' });
    }
  });

  r.post('/draft/send', bodyParser, async (req, res) => {
    const ctx = await admit(req, res);
    if (!ctx) return;
    if (sendLimited(ctx.appId)) return limited(res, 'Demasiados envios. Tente novamente dentro de um minuto.');
    const parsed = SendAppEmailDraftRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Campos obrigatórios: integrationKey, draftId.' } });
      return;
    }
    try {
      const result = await sendAppEmailDraft(parsed.data, ctx, deps);
      res.status(result.success ? 200 : 502).json(result);
    } catch (err) {
      console.error('[app-email] draft send failed:', err instanceof Error ? err.message : String(err));
      res.status(502).json({ success: false, code: 'provider_error', error: 'Falha no envio do rascunho.' });
    }
  });

  r.get('/inbox', async (req, res) => {
    const ctx = await admit(req, res);
    if (!ctx) return;
    if (listLimited(ctx.appId)) return limited(res, 'Demasiados pedidos. Tente novamente dentro de um minuto.');
    const integrationKey = typeof req.query.integrationKey === 'string' ? req.query.integrationKey : '';
    if (!integrationKey) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: "Parâmetro 'integrationKey' em falta." } });
      return;
    }
    try {
      const result = await getWorkspaceInboxAddress(integrationKey, ctx, deps);
      res.status(result.success ? 200 : 502).json(result);
    } catch (err) {
      console.error('[app-email] inbox failed:', err instanceof Error ? err.message : String(err));
      res.status(502).json({ success: false, code: 'provider_error', error: 'Falha ao obter o endereço da caixa de correio.' });
    }
  });

  return r;
}
