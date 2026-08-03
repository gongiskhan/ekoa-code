/**
 * Integration-builder router (ch03 §3.8.14). The four-endpoint contract:
 *   POST /api/v1/integration-builder/chat     — one builder chat turn (agents/integration-agent)
 *   GET  /api/v1/integration-builder/package  — load the user's session for an integration key
 *   PUT  /api/v1/integration-builder/package  — save the generated package (tenant-scoped Mongo
 *                                               definition, private-by-default — slice A3)
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
  type Actor,
} from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { actorOf, parseBody, sendError, notFound } from './helpers.js';
// D2: the chat turn runs on the SHARED authoring core (agents/integration-agent.ts) — the same
// core the automation planner authors through. The session store stays the builder's own.
import { handleBuilderChat } from '../agents/integration-agent.js';
import {
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
  saveAuthoredDefinition,
  resolveDefinition,
  resolveSkillMdRaw,
  integrationDefinitionStore,
  createConfig,
  updateConfig,
  findConfigForOwner,
  type IntegrationDefinition,
  type IntegrationPackageConfig,
  type IntegrationActionHttpConfig,
} from '../integrations/index.js';
import { interpolate, interpolateObj, buildVars, findHeaderValue, formUrlEncode } from '../integrations/http-template.js';

/** Everything the editable package needs. The projected read shape (`IntegrationDefinition`) and
 *  the RAW stored row (`IntegrationDefinitionDoc`) both satisfy it with identical field types, so
 *  ONE projection serves both and cannot drift between the scrubbed and the byte-exact path. */
type PackageConfigSource = Pick<
  IntegrationDefinition,
  | 'version' | 'displayName' | 'description' | 'authType' | 'provider' | 'category'
  | 'configSchema' | 'actions' | 'credentialGuide' | 'sessionConnect' | 'webhookConfig' | 'listenerConfig'
> & { key: string };

/** Project a loaded definition back into the editable package (config.json) shape. */
function definitionToConfig(def: PackageConfigSource): IntegrationPackageConfig {
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
 * The builder's EDITABLE package for a key — the config half of A3's raw/scrubbed split.
 *
 * `resolveDefinition` projects through `redactSecrets`, which replaces the value of every
 * credential-named property with `[REDACTED]` unless it is a pure `{{template}}`. That view is
 * correct for reading and for model egress, and DESTRUCTIVE for editing: this route seeds a
 * builder session from it and PUT persists the session back, so one ordinary edit cycle used to
 * overwrite a tenant's real `Authorization` header with the literal string `[REDACTED]` — which
 * `action-executor.ts` then SENDS as the request's auth header. Exactly the round trip A3 review
 * F3 closed for `skillMd` (`resolveSkillMdRaw`), left open on the config.
 *
 * So: a row of the actor's OWN ORG comes back byte-exact, everything else stays scrubbed. The
 * own-org condition is `resolveSkillMdRaw`'s rule, verbatim and for its reason (A3 re-review
 * HIGH-2): `getForActor` legitimately answers another org's `global` row, and serving THAT raw
 * would hand a foreign author's pasted credential to the reader in plaintext. A foreign row is a
 * FORK source — no round trip can destroy the original, so the scrub costs nothing there.
 */
async function editablePackageFor(actor: Actor, key: string): Promise<IntegrationPackageConfig | null> {
  const doc = await integrationDefinitionStore.getForActor(actor, key);
  if (doc && doc.orgId === actor.orgId) return definitionToConfig(doc);
  const def = await resolveDefinition(actor, key);
  return def ? definitionToConfig(def) : null;
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
      // A2: resolved TENANT-SCOPED, so the builder loads the actor's OWN definition when they have
      // one and the shipped baseline otherwise — never another tenant's package of the same key.
      // A3 (+ review L4): there is NO loadedKey exemption anywhere any more. Loading a shipped
      // BASELINE package still opens an editable session, but the reserved key stays reserved on
      // every surface — chat validation AND save — so the chat can never present as valid a
      // package the PUT then refuses; the user forks under a distinct key (A2-residual 4).
      const config = await editablePackageFor(actor, integrationKey);
      if (!config) return notFound(res);
      session = await createSession(actor, deps, {
        integrationKey,
        // BYTE-EXACT for an own-org row, scrubbed for a foreign one — the config half of the same
        // no-round-trip rule the body below carries (see editablePackageFor).
        currentPackage: config,
        // RAW, deliberately (A3 review F3): this seeds the builder's EDITABLE body, and PUT
        // persists it back — a scrubbed view here would write "[REDACTED]" over the stored text
        // on the next ordinary save. The scrubbed view (`resolveSkillMd`) is for prompt egress.
        currentSkillMd: (await resolveSkillMdRaw(actor, integrationKey)) ?? '',
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

    // A3: NO loadedKey exemption on save — a reserved (shipped) key is refused even for a session
    // that loaded it, so a builder save can never shadow a baseline package (A2-residual 4).
    const errors = validateConfig(config, { reservedKeys: reservedIntegrationKeys() });
    if (errors.length > 0) return sendError(res, 'VALIDATION_FAILED', 'Pacote inválido.', { errors });

    // A3: the save lands in the tenant-scoped Mongo store, PRIVATE BY DEFAULT, stamped from the
    // verified actor (the retired disk runtime tier was one world-readable directory). Sharing is
    // the explicit E1 surface, never a save side effect.
    const key = config.integrationKey;
    const saved = await saveAuthoredDefinition(actor, config, skillMd);
    if (!saved.ok) {
      return saved.code === 'key_taken' || saved.code === 'published_row'
        ? sendError(res, 'FORBIDDEN', saved.message)
        : sendError(res, 'VALIDATION_FAILED', 'Pacote inválido.', { errors: [saved.message] });
    }

    // Auto-configure the org integration when the save carries credentials, so it lands `configured`.
    const creds = (body.testCredentials ?? body.configValues) as Record<string, unknown> | undefined;
    let configured = false;
    if (creds && Object.keys(creds).length > 0) {
      const existing = await findConfigForOwner(actor.orgId, actor.userId, key);
      if (existing) await updateConfig(actor, existing._id, { configValues: creds });
      else await createConfig(actor, { integrationKey: key, configValues: creds, name: config.displayName ?? key }, deps);
      configured = true;
    }

    // The session now edits the saved integration: its package/body snapshot tracks the save.
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
