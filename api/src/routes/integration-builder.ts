/**
 * Integration-builder router (ch03 §3.8.14). The four-endpoint contract:
 *   POST /api/v1/integration-builder/chat     — one builder chat turn (agents/integration-builder)
 *   GET  /api/v1/integration-builder/package  — load the user's session for an integration key
 *   PUT  /api/v1/integration-builder/package  — save the generated package to the runtime tier
 *   POST /api/v1/integration-builder/test     — execute one action against the supplied credentials
 *
 * All four are `auth: 'user'` (any authenticated user; no role gate). Non-2xx bodies are the shared
 * error envelope (sendError). The router owns the load/save/test orchestration and may import
 * integrations/ (compute the reserved-key set, write the runtime package, create the org config,
 * interpolate an action's httpConfig); the agent module stays integrations-free.
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import {
  IntegrationBuilderChatRequest,
  IntegrationBuilderLoadQuery,
  IntegrationBuilderTestRequest,
} from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { actorOf, parseBody, sendError, notFound } from './helpers.js';
import {
  handleBuilderChat,
  getOwnedSession,
  findSessionForKey,
  createSession,
  markSessionSaved,
  generatedPackageOf,
  validationErrorsOf,
} from '../agents/integration-builder.js';
import { validateConfig } from '../agents/integration-builder-parser.js';
import {
  reservedIntegrationKeys,
  writeRuntimePackage,
  getDefinition,
  integrationSkillMd,
  createConfig,
  updateConfig,
  findConfigForOwner,
  type IntegrationDefinition,
  type IntegrationPackageConfig,
  type IntegrationActionHttpConfig,
} from '../integrations/index.js';
import { interpolate, interpolateObj, buildVars, findHeaderValue, formUrlEncode } from '../integrations/http-template.js';

/** Project a loaded definition back into the editable package (config.json) shape. */
function definitionToConfig(def: IntegrationDefinition): IntegrationPackageConfig {
  return {
    version: def.version,
    integrationKey: def.key,
    displayName: def.displayName,
    description: def.description,
    authType: def.authType,
    provider: def.provider,
    category: def.category,
    configSchema: def.configSchema,
    actions: def.actions,
    credentialGuide: def.credentialGuide,
    sessionConnect: def.sessionConnect,
    webhookConfig: def.webhookConfig,
    listenerConfig: def.listenerConfig,
  };
}

/**
 * The save request as it arrives on the wire. The shared `IntegrationBuilderSaveRequest` is a
 * `union([{ builderSessionId }, { generatedPackage, testCredentials? }])`: the web sends BOTH a
 * session id AND the package AND credentials, which a strict union parse would collapse to the
 * first variant and DROP the package + credentials. We validate a superset so no field is lost;
 * the RESPONSE stays the strict shared `IntegrationBuilderSaveResponse`.
 */
const SavePackageBody = z.object({
  builderSessionId: z.string().optional(),
  generatedPackage: z.unknown().optional(),
  testCredentials: z.record(z.unknown()).optional(),
  configValues: z.record(z.unknown()).optional(),
});

/**
 * Execute ONE action's httpConfig with request-supplied test credentials + input. This is the
 * builder's ephemeral test path: credentials come from the request, are NEVER logged or persisted,
 * and no encrypted config row is involved. User-defined integration actions call arbitrary
 * user-configured endpoints by design and are not SSRF-gated (spec §9 invariant 8), same posture
 * as the action executor — so a plain fetch is used.
 */
async function executeActionForTest(
  httpConfig: IntegrationActionHttpConfig,
  args: Record<string, unknown>,
  credentials: Record<string, unknown>,
): Promise<{ success: boolean; statusCode?: number; response?: unknown; error?: string }> {
  const { stringVars, rawVars } = buildVars(args, credentials);
  const baseUrl = interpolate(httpConfig.baseUrl, stringVars);
  if (!/^https?:\/\//i.test(baseUrl)) return { success: false, error: 'URL base em falta ou inválido.' };
  let url: URL;
  try {
    url = new URL(`${baseUrl}${interpolate(httpConfig.path, stringVars)}`);
  } catch {
    return { success: false, error: 'URL do pedido inválido.' };
  }
  if (httpConfig.queryParams) {
    for (const [key, tpl] of Object.entries(httpConfig.queryParams)) {
      const val = interpolate(tpl, stringVars);
      if (val !== '') url.searchParams.set(key, val);
    }
  }
  const headers: Record<string, string> = {};
  if (httpConfig.headers) {
    for (const [key, tpl] of Object.entries(httpConfig.headers)) headers[key] = interpolate(tpl, stringVars);
  }
  let body: string | undefined;
  if (httpConfig.bodyTemplate && httpConfig.method !== 'GET') {
    const interp = interpolateObj(httpConfig.bodyTemplate, stringVars, rawVars);
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(interp)) if (v !== '' && v !== undefined) clean[k] = v;
    const contentType = findHeaderValue(headers, 'content-type') ?? '';
    body = contentType.includes('application/x-www-form-urlencoded') ? formUrlEncode(clean) : JSON.stringify(clean);
    if (!contentType) headers['Content-Type'] = 'application/json';
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const resp = await fetch(url.toString(), { method: httpConfig.method, headers, body, signal: controller.signal });
    const text = await resp.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* keep the raw text */
    }
    return resp.ok
      ? { success: true, statusCode: resp.status, response: data }
      : { success: false, statusCode: resp.status, response: data, error: `HTTP ${resp.status}${resp.statusText ? ` ${resp.statusText}` : ''}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: /abort/i.test(msg) ? 'Tempo limite do pedido excedido.' : msg };
  } finally {
    clearTimeout(timeout);
  }
}

export function integrationBuilderRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  // --- chat ---
  r.post('/chat', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, IntegrationBuilderChatRequest, req.body);
    if (body === undefined) return;
    const actor = actorOf(req);
    const outcome = await handleBuilderChat({
      actor,
      message: body.message,
      language: body.language,
      ...(body.builderSessionId ? { sessionId: body.builderSessionId } : {}),
      reservedKeys: reservedIntegrationKeys(),
      deps,
    });
    if (!outcome.ok) return sendError(res, outcome.code, outcome.message);
    res.status(200).json(outcome.response);
  });

  // --- load ---
  r.get('/package', async (req: AuthedRequest, res: Response) => {
    const q = IntegrationBuilderLoadQuery.safeParse(req.query);
    if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
    const actor = actorOf(req);
    const integrationKey = q.data.integrationKey;

    let session = await findSessionForKey(actor.userId, integrationKey);
    if (!session) {
      // No live session: rebuild an editable one from the saved package, when the key exists.
      const def = getDefinition(integrationKey);
      if (!def) return notFound(res);
      session = await createSession(actor, deps, {
        integrationKey,
        loadedKey: integrationKey,
        currentPackage: definitionToConfig(def),
        currentSkillMd: integrationSkillMd(integrationKey) ?? '',
      });
    }
    res.status(200).json({
      builderSessionId: session._id,
      generatedPackage: generatedPackageOf(session),
      messages: session.messages,
      validationErrors: validationErrorsOf(session),
    });
  });

  // --- save ---
  r.put('/package', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SavePackageBody, req.body);
    if (body === undefined) return;
    const actor = actorOf(req);

    const session = body.builderSessionId ? await getOwnedSession(actor.userId, body.builderSessionId) : null;
    const posted = body.generatedPackage as { skillMd?: string; config?: unknown } | undefined;
    const config = (posted?.config ?? session?.currentPackage) as IntegrationPackageConfig | undefined;
    const skillMd = posted?.skillMd ?? session?.currentSkillMd ?? '';
    if (!config || typeof config !== 'object') {
      return sendError(res, 'VALIDATION_FAILED', 'Nenhum pacote para guardar.');
    }

    const errors = validateConfig(config, {
      reservedKeys: reservedIntegrationKeys(),
      ...(session?.loadedKey ? { loadedKey: session.loadedKey } : {}),
    });
    if (errors.length > 0) return sendError(res, 'VALIDATION_FAILED', 'Pacote inválido.', { errors });

    const key = config.integrationKey;
    writeRuntimePackage(key, config as unknown as Record<string, unknown>, skillMd);

    // Auto-configure the org integration when the save carries credentials, so it lands `configured`.
    const creds = (body.testCredentials ?? body.configValues) as Record<string, unknown> | undefined;
    let configured = false;
    if (creds && Object.keys(creds).length > 0) {
      const existing = await findConfigForOwner(actor.orgId, actor.userId, key);
      if (existing) await updateConfig(actor, existing._id, { configValues: creds });
      else await createConfig(actor, { integrationKey: key, configValues: creds, name: config.displayName ?? key }, deps);
      configured = true;
    }

    // The session now edits a saved integration: pin loadedKey so future re-saves of this key pass.
    if (session) await markSessionSaved(session._id, { config, skillMd, integrationKey: key }, deps);

    res.status(200).json({ integrationKey: key, displayName: config.displayName ?? key, saved: true, configured });
  });

  // --- test ---
  r.post('/test', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, IntegrationBuilderTestRequest, req.body);
    if (body === undefined) return;
    const actor = actorOf(req);
    const session = await getOwnedSession(actor.userId, body.builderSessionId);
    if (!session || session.currentPackage == null) return notFound(res);

    const config = session.currentPackage as IntegrationPackageConfig;
    const action = (config.actions ?? []).find((a) => a.actionName === body.actionKey);
    if (!action || !action.httpConfig) {
      res.status(200).json({ actionKey: body.actionKey, success: false, error: `Ação "${body.actionKey}" não encontrada ou sem httpConfig.` });
      return;
    }

    const result = await executeActionForTest(action.httpConfig, body.testInput ?? {}, body.testCredentials ?? {});
    res.status(200).json({ actionKey: body.actionKey, ...result });
  });

  return r;
}
