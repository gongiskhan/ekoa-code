/**
 * server.ts — the composition root (ch02 §2.6). Builds the Express app, mounts routers,
 * wires the injected seams (ch02 §2.8), and runs boot. The only file allowed to import
 * everything. This is the G0 skeleton: config boot gate + /health; domain routers mount
 * as their phases land.
 *
 * Carried boot behaviors (ch02 §2.6):
 *  - fail-closed config validation (ch09 §9.7): missing ENCRYPTION_KEY / JWT_SECRET refuses boot.
 *  - process-level exception posture: uncaughtException/unhandledRejection log and continue.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { loadConfig, type Config } from './config.js';
import { securityHeaders } from './security-headers.js';
import { connectMongo } from './data/mongo.js';
import { users, integrationConfigs, triggers } from './data/stores.js';
import { CollectionsEngine, sharedScope, appScope } from './data/collections-engine.js';
import { loadActivation } from './data/activation.js';
import { loadRevocations } from './auth/revocation.js';
import { seedAdmin } from './auth/service.js';
import { migrateBuilderRole } from './auth/users-service.js';
import { sendError } from './routes/helpers.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { orgRouter, orgsRouter } from './routes/org.js';
import { brandingRouter } from './routes/branding.js';
import { settingsRouter } from './routes/settings.js';
import { sessionsRouter } from './routes/sessions.js';
import { memoriesRouter } from './routes/memories.js';
import { registoRouter } from './routes/registo.js';
import { changeRequestsRouter } from './routes/change-requests.js';
import { billingRouter } from './routes/billing.js';
import { credentialsRouter } from './routes/credentials.js';
import { llmHealth, registerGateway, loadCredential, setRulesetResolver } from './llm/index.js';
import { setUsageNotifier } from './billing/index.js';
import { integrationsRouter } from './routes/integrations.js';
import { integrationBuilderRouter } from './routes/integration-builder.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { triggersRouter } from './routes/triggers.js';
import { hooksRouter } from './routes/hooks.js';
import { notificationsRouter } from './routes/notifications.js';
import { sseManager } from './events/sse-manager.js';
import { startDelivery, stopDelivery } from './events/delivery.js';
import { attachCanvasServer } from './streaming/index.js';
import { attachVoiceServer } from './voice/index.js';
import { attachBridgeServer, bufferLedgerRow, delegateToLocal, rowsForSession } from './bridge/index.js';
import { maskedCountsForCorrelations } from './services/platform-crud.js';
import { bridgeTokenRouter } from './routes/bridge.js';
import { servedDataRouter } from './apps/served-data.js';
import { appAssistantRouter } from './apps/app-assistant-route.js';
import { devServeRouter } from './apps/dev-serve.js';
import { servingRouter } from './apps/serving.js';
import { appRegistry } from './apps/app-registry.js';
import { appBuilder } from './apps/builder.js';
import { loadSlugIndex } from './apps/slug-index.js';
import { seedFeaturedArtifacts } from './apps/featured-seeder.js';
import { buildAndRegisterFeaturedArtifacts } from './apps/featured-builder.js';
import { resolveApp } from './apps/registry.js';
import { appFilesRouter, saveAppFileBlob } from './apps/app-files.js';
import { appDocxRouter } from './apps/app-docx.js';
import {
  getStatus as docxGetStatus,
  getProjection as docxGetProjection,
  getCurrent as docxGetCurrent,
  getClean as docxGetClean,
  applyReview as docxApplyReview,
  restoreSource as docxRestoreSource,
  setSource as docxSetSource,
  applyEdits as docxApplyEdits,
} from './apps/document-source.js';
import { projectDocx } from './services/docx-redline.js';
import { createDocxFetcher } from './integrations/docx-fetch.js';
import { buildLinkRouter } from './apps/build-link.js';
import { appSsoRouter } from './integrations/app-sso.js';
import { m365ProxyRouter } from './integrations/m365-proxy.js';
import { appCloudFilesRouter } from './integrations/app-cloud-files.js';
import { adobeSignRouter, handleAdobeWebhook, notConnectedBackend } from './integrations/adobe-sign.js';
import { zohoSignRouter, makeZohoSignBackend, handleZohoWebhook } from './integrations/zoho-sign.js';
import { recordZohoAgreement, findZohoAgreement, findAdobeAgreement } from './integrations/sign-agreements.js';
import type { ResolveAppScope } from './integrations/app-scope.js';
import { legalRouter } from './legal/router.js';
import { CITIUS_WATCH_COLLECTION } from './legal/insolvencia-watch.js';
import { designTokensHandler } from './services/design-tokens.js';
import { getArtifactScreenshotDir } from './services/artifact-screenshot.js';
import { appPdfRouter, getArtifactPdfDir, renderHtmlToPdf } from './apps/pdf.js';
import { getBrandAssetsDir } from './services/branding/index.js';
import { companySpaceRouter } from './routes/company-space.js';
import { verifyToken } from './auth/jwt.js';
import { verifySseToken } from './auth/middleware.js';
import { verifyGatewayKey } from './auth/gateway-keys-service.js';
import { gatewayKeysRouter } from './routes/gateway-keys.js';
import { cofreRouter } from './routes/cofre.js';
import { artifactsRouter } from './routes/artifacts.js';
// G7B — agent execution (ch05 + ch08): chat/job routers, the injected agent seams, and the
// boot obligations (content ingest, knowledge backfill, orphan sweep).
import { chatRouter } from './routes/chat.js';
import { jobsRouter } from './routes/jobs.js';
import {
  setAssembleAgentContext,
  setKnowledgeGrounding,
  setIngestBuildKnowledge,
  setKnowledgeToolSearch,
  setKnowledgeToolRead,
  setLoadContextContent,
  setDelegateToLocal,
  setLocalActivitySources,
  setVerifyRunner,
  setBuildMechanics,
  setDocxToolSeams,
  setIntegrationPrefetch,
  setCatalog,
  sweepOrphans,
} from './agents/index.js';
import { assembleAgentContext, bootContentLoader, composeContext, configureContentLoader } from './content/index.js';
import { backfillKnowledgeIndex, buildGroundingBlock, ingestDocument, searchKnowledgeIndex, readDocWithShared } from './knowledge/index.js';
// G8 — automation engine + integrations execution layer + delivery targets + canvas.
import { automationsRouter } from './routes/automations.js';
import { platformIntegrationsRouter, oauthCallbackRouter } from './routes/platform-integrations.js';
import { pipedreamRouter } from './routes/pipedream.js';
import {
  setRunEventEmitterFactory,
  setIntegrationActionExecutor,
  setPlatformIntegrationCaller,
  setIntegrationCredentialLoader,
  setIntegrationOriginResolver,
  setScopedMemoryResolver,
  setAppDataStore,
  setArtifactResolver,
  setCatalogSources,
  setLocalBrowserContextProvider,
  setAutomationContentSections,
  startRunForTrigger,
  runAutomationForAction,
  buildAutomationCatalog,
  formatCatalogForPrompt,
  automationStepEventPayload,
  automationRunsRoot,
  screenshotPlaneRouter,
  sweepExpiredScreenshots,
  type RunEventEmitter,
} from './automation/index.js';
import {
  executeUserIntegrationAction,
  type AutomationBackedHandler,
  callPlatformIntegration,
  findConfigForOwner,
  integrationPrefetch,
  integrationSkillMd,
  listDefinitions,
  getDefinition,
} from './integrations/index.js';
import { invokeArtifactBackend } from './apps/backend-runtime/index.js';
import { getArtifactById, projectDirFor } from './apps/app-paths.js';
import { listVisibleMemories } from './memory/index.js';
import { getSharedBrowser } from './services/browser-pool.js';
import { originFromBaseUrl } from './security/origin-binding.js';
import { setDeliveryTargets } from './events/delivery.js';
import {
  configureListenerSupervisor,
  startListenerSupervisor,
  stopListenerSupervisor,
  enqueueListenerEvent,
  type SupervisorTrigger,
} from './events/listener-supervisor.js';
import { readListenerCursor, writeListenerCursor, bumpListenerFailure } from './events/listener-state.js';
import { buildArtifactBackendInputs } from './integrations/event-sources/dispatch-input.js';
import { hydrateEmailInput } from './integrations/event-sources/email-hydrate.js';
import type { TriggerDoc } from './events/service.js';
import { decrypt, encrypt, envelopeDecrypt } from './data/crypto.js';
import { verifyRunner } from './apps/verify-runner.js';
import { createBuildMechanics } from './apps/build-mechanics.js';
import { logActivity } from './data/activity.js';
import { denyListRulesetFieldsFor } from './services/deny-list.js';

export interface RuntimeDeps {
  now: () => number;
  genId: () => string;
}

/**
 * Adapt the automation engine's RunEventEmitter callback seam onto the AutomationRunEvent wire
 * union (§3.6.3) on the 'automation' SSE stream. Every payload matches shared/events.ts; the
 * engine itself never imports events/ (ch02 §2.8 — the seam the old engine already had, B7).
 */
function makeRunSseEmitter(runId: string): RunEventEmitter {
  const emit = (type: string, data: object): void => {
    try {
      sseManager.emit('automation', runId, type, data);
    } catch (err) {
      console.warn('[automation-sse] emit failed:', err instanceof Error ? err.message : err);
    }
  };
  return {
    // Forward the StepRecord enrichment (screenshot URL, tier, one-line error, output, duration) so
    // the run UI renders a step's outcome without a follow-up fetch. Mapping lives in automation/
    // (unit-tested) — this stays a thin emit.
    stepUpdate: (record, id) => emit('step', automationStepEventPayload(record, id)),
    runComplete: (_id, _durationMs, summary) => emit('complete', { summary }),
    runError: (_id, error) => emit('error', { code: 'AUTOMATION_FAILED', message: error }),
    runPaused: (_id, _reason, service) => emit('paused', { service }),
    runPatch: (_id, info) => emit('patch', { patch: { ...info } }),
    runPauseForUser: (_id, info) => emit('pause_for_user', {
      stepIndex: info.stepIndex,
      reasoning: info.reasoning,
      userInstructions: info.userInstructions,
      ...(info.failureMessage ? { failureMessage: info.failureMessage } : {}),
      ...(info.screenshotUrl ? { screenshotUrl: info.screenshotUrl } : {}),
    }),
    runResumed: () => emit('resumed', {}),
    runStreamingAvailable: (_id, info) => emit('streaming_available', { token: info.token, wsUrl: info.wsUrl, viewport: info.viewport }),
    runAwaitingConsent: (_id, info) => emit('awaiting_consent', { stepIndex: info.stepIndex, shape: info.shape, argv: info.argv, description: info.description }),
    runAwaitingDaemon: (_id, info) => emit('awaiting_daemon', { stepIndex: info.stepIndex, capability: info.capability, reason: info.reason }),
    runOutputChunk: (_id, info) => emit('step_output_chunk', { stepIndex: info.stepIndex, stream: info.stream, chunk: info.chunk }),
  };
}

const defaultDeps: RuntimeDeps = { now: () => Date.now(), genId: () => randomUUID() };

/** The usage push (§6.7): a bare `usage_updated` poke on the billee's notifications channel,
 *  fired once per ledger write (ch03 §3.6.4). Best-effort — a push failure NEVER fails the
 *  metering/turn (fire-and-forget with error log; the tracker also guards the call). */
export function usageUpdatedNotifier(userId: string): void {
  if (!userId) return;
  try {
    sseManager.emit('notifications', userId, 'usage_updated', {});
  } catch (err) {
    console.warn('[billing] usage_updated push failed:', err instanceof Error ? err.message : err);
  }
}

export function buildApp(config: Config, deps: RuntimeDeps = defaultDeps): Express {
  const app = express();
  app.set('env', config.nodeEnv);
  app.disable('x-powered-by');

  // Security-headers baseline (ch09 §9.8 D1, FIXED-14) — before any route so every response
  // (JSON API + served-app plane) inherits nosniff/HSTS/referrer + a surface-appropriate CSP
  // and frame policy. A served-app handler may override before emit.
  app.use(securityHeaders);

  // Usage push seam (§6.7, ch02 §2.8 seam 1): billing/ never imports events/, so the composition
  // root injects the notifier that pushes `usage_updated` on the billee's notifications channel.
  setUsageNotifier(usageUpdatedNotifier);

  // G7B — agent-execution seams (ch02 §2.8, ch05 §5.5/§5.6.2). agents/ codes against typed seams;
  // the composition root binds the real collaborators (structural binding is where the shapes are
  // checked). server.ts is the only file that may reach across these seams.
  setAssembleAgentContext(assembleAgentContext); // content loader (ch08 §8.3.2, ch05 §5.5.1)
  // The automation planner's eager content sections ride the same loader (automation/ may not
  // import content/ — this seam is its one route to the composed package).
  setAutomationContentSections(async (userId) => (await assembleAgentContext({ agentKind: 'automation', userId })).promptSections);
  // Knowledge grounding (ch08 §8.4 slot 5): buildGroundingBlock already applies the chat-always /
  // build-only-legal rule internally, so the adapter only maps agentKind → its chat|build kind.
  setKnowledgeGrounding(async ({ orgId, query, agentKind }) =>
    buildGroundingBlock({ orgId, query, kind: agentKind === 'chat' ? 'chat' : 'build' }).block,
  );
  // F1 knowledge-during-build: the mid-build ingest seam. The orgId rides the run's actor (org
  // partitioning is structural, not a request argument); ingestDocument refuses the reserved
  // _shared partition and indexes the doc immediately, so a scoping-provided doc is searchable to
  // the same run's knowledge tools. sourceType marks it build-originated.
  setIngestBuildKnowledge(async (actor, doc, deps) =>
    ingestDocument(
      actor,
      {
        collection: doc.collection,
        title: doc.title,
        text: doc.text,
        sourceType: doc.sourceType ?? 'build-scoping',
        ...(doc.language ? { language: doc.language } : {}),
      },
      deps,
    ),
  );
  setVerifyRunner(verifyRunner); // per-build verification (ch07 §7.2.6)
  setBuildMechanics(createBuildMechanics(deps)); // the G6 build pipeline (ch07 §7.2-§7.4)
  // Anonymisation ruleset resolver (ch17 §17.7; F10): every egress request resolves the org's
  // ruleset through this seam — the store-backed loader hands the anonymiser the org's
  // deny-list as org-scoped ciphertext, so decryption stays on the pipeline's access-logged
  // path. Without this wiring every org ran the default EMPTY deny-list.
  setRulesetResolver(async (orgId) => ({ orgId, ...(await denyListRulesetFieldsFor(orgId)) }));
  // The §5.4.4 in-process knowledge tools: org partitioning rides the seam signature — the
  // orgId reaches these from the run's actor, never from tool arguments (agents/sdk-tools.ts).
  setKnowledgeToolSearch(async ({ orgId, query, limit }) =>
    searchKnowledgeIndex(orgId, query, limit).map((h) => ({
      docId: h.docId,
      collection: h.collection,
      title: h.title,
      sourceUrl: h.sourceUrl ?? '',
      snip: h.snippet,
    })),
  );
  setKnowledgeToolRead(async ({ orgId, collection, docId }) => {
    const doc = await readDocWithShared(orgId, collection, docId);
    return doc ? { title: doc.fm.title, sourceUrl: doc.fm.sourceUrl ?? '', body: doc.body } : null;
  });
  // The build-run `load_context` tool (§5.4.4): a named on-demand file from the user's composed
  // context. The name matches against the loader's OWN returned file list (never a joined path),
  // so the tool argument cannot traverse; frontmatter strips like the eager prompt sections.
  setLoadContextContent(async ({ userId, agentKind, name }) => {
    const stripFrontmatter = (raw: string): string => {
      if (!raw.startsWith('---')) return raw;
      const end = raw.indexOf('\n---', 3);
      if (end === -1) return raw;
      const after = raw.indexOf('\n', end + 1);
      return after === -1 ? '' : raw.slice(after + 1).replace(/^\n+/, '');
    };
    const composed = await composeContext(userId, agentKind);
    const file = composed.onDemandFiles.find((f) => {
      const base = f.replace(/\\/g, '/').split('/').pop() ?? '';
      return base === name || base.replace(/\.[^.]+$/, '') === name;
    });
    if (file) return stripFrontmatter(await readFile(file, 'utf8'));
    // Fallback: `integration-<key>` resolves to the integration package's knowledge SKILL.md
    // when the caller's org has that integration configured (on-demand — zero eager tokens).
    // The key is validated against the definitions registry before any filesystem read.
    const m = /^integration-([a-z0-9][a-z0-9-]*)$/.exec(name);
    if (m) {
      const key = m[1]!;
      const user = (await users.get(userId)) as { orgId?: string } | null;
      const cfg = user?.orgId ? await findConfigForOwner(user.orgId, userId, key) : null;
      if (cfg && (cfg as { enabled?: boolean }).enabled !== false) {
        const raw = integrationSkillMd(key);
        if (raw) return stripFrontmatter(raw);
      }
    }
    return null;
  });
  // ch05 §5.4.8 / ch18 §18.2 — the hosted delegate_to_local tool: chat/build runs delegate local
  // file work to the user's paired daemon over the bridge. org + pairing resolve from the live
  // registry inside the bridge tool (never from tool arguments); the result is derived output
  // only, and offline is an honest `unreachable` (never an upload).
  setDelegateToLocal((actor, req) => delegateToLocal(actor, req));
  // FC-402 (run s5, D3) — the trust chip's two joins: buffered daemon ledger rows (bytes/files)
  // and the anon-audit mask counts by correlation id (§17.6). Both reads, no persistence.
  setLocalActivitySources({
    ledgerRows: (session, correlationIds) => rowsForSession(session, correlationIds),
    maskedCounts: (orgId, correlationIds) => maskedCountsForCorrelations(orgId, correlationIds),
  });
  // G8 — the §5.5.2 chat grounding seams land: live integration pre-fetch (layer 3) and the
  // cross-agent automation/integration catalog (layer 4).
  setIntegrationPrefetch(integrationPrefetch);
  setCatalog(async ({ userId, orgId }) => {
    void orgId; // catalog visibility is user-keyed; org scoping rides the underlying stores
    try {
      const catalog = await buildAutomationCatalog(userId, false);
      return formatCatalogForPrompt(catalog);
    } catch {
      return ''; // catalog failures are non-fatal (§5.5.2 layer 4)
    }
  });

  // G8 — automation engine seams (ch02 §2.8; automation/ may not import events/, apps/ or the
  // composition surfaces directly, so the root binds every collaborator).
  // 1. Run events → the automation SSE stream (§3.6.3): the emitter factory adapts the engine's
  //    callback seam onto the AutomationRunEvent wire union, replayable via Last-Event-ID.
  setRunEventEmitterFactory((runId) => makeRunSseEmitter(runId));
  // 2. Integration action execution (user-defined skills; §5.6.7 integration steps).
  //    integração-por-automação (carried B25): an `automationBinding` action runs the bound
  //    automation under the verified owner; integrations/ never imports automation/ (tiers). This
  //    handler is bound ONCE and handed to EVERY caller of the executor — the automation engine's
  //    `integration` step below AND the listener supervisor's user-defined poll (2A-S4). An
  //    executor call site that omits it silently breaks every automation-backed action of that
  //    integration (e.g. citius, whose poll action is automation-backed), so there is exactly one.
  const runAutomationBackedAction: AutomationBackedHandler = async (b) => {
    const out = await runAutomationForAction({
      binding: b.binding as { automationId: string; argMap?: Record<string, string>; passCredentials?: boolean },
      args: b.args,
      credentialFields: b.credentialFields,
      orgId: b.orgId,
      ownerUserId: b.ownerUserId,
    });
    return { success: out.success, ...(out.code ? { code: out.code } : {}), ...(out.error ? { error: out.error } : {}), ...(out.data !== undefined ? { data: out.data } : {}) };
  };
  setIntegrationActionExecutor(async (call) => {
    const owner = (await users.get(call.ownerUserId)) as { orgId?: string } | null;
    const r = await executeUserIntegrationAction(
      {
        orgId: owner?.orgId ?? '',
        ownerUserId: call.ownerUserId,
        integrationKey: call.integrationKey,
        actionName: call.actionName,
        args: call.args,
      },
      { runAutomationBackedAction },
    );
    return { success: r.success, data: r.data, error: r.error, details: r.code };
  });
  // 3. Platform integrations (Google/Microsoft) behind automation + listener steps.
  setPlatformIntegrationCaller(async (call, pactor) => {
    const owner = (await users.get(pactor.userId)) as { orgId?: string } | null;
    const r = await callPlatformIntegration(
      { orgId: owner?.orgId ?? '', integrationKey: call.integrationKey, actionName: call.actionName, args: call.args },
      { now: deps.now, genId: deps.genId },
    );
    return { success: r.success, data: r.data, error: r.error };
  });
  // 4. Decrypted credential fields for api_call auth injection (encrypted at rest, ch09).
  setIntegrationCredentialLoader(async (integrationKey, ownerUserId) => {
    const owner = (await users.get(ownerUserId)) as { orgId?: string } | null;
    if (!owner?.orgId) return null;
    const cfg = await findConfigForOwner(owner.orgId, ownerUserId, integrationKey);
    if (!cfg?.credentialsCiphertext) return null;
    try {
      // Cofre B-4: org-bound v2 envelope; v1 rows still read (no flag day).
      const values = JSON.parse(await envelopeDecrypt(cfg.credentialsCiphertext, cfg.orgId)) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
    } catch {
      return null;
    }
  });
  // 4b. Bound origins for that credential (Cofre R-2, invariant I6). The api_call step writes its
  // URL from a MODEL-authored template, so the destination and the credential have independent
  // provenance; the integration's own declared base URL is the interim binding until Cofre items
  // carry per-item `boundOrigins` (WS-C). An integration with no usable declared host resolves to
  // an EMPTY list, and the seam refuses on empty — unbound never means unrestricted.
  setIntegrationOriginResolver(async (integrationKey) => {
    const def = getDefinition(integrationKey);
    if (!def) return [];
    const origins = new Set<string>();
    for (const action of Object.values(def.actions ?? {})) {
      const baseUrl = (action as { httpConfig?: { baseUrl?: string } }).httpConfig?.baseUrl;
      if (!baseUrl) continue;
      // A templated host (`{{region}}.api.example.com`) cannot be pinned at this layer; skip it
      // rather than binding to a pattern that would match more than it should.
      const host = originFromBaseUrl(baseUrl);
      if (host) origins.add(host);
    }
    return [...origins];
  });
  // 5. Automation-scoped memory snippets for vision prompts (correction memories, §11.6).
  setScopedMemoryResolver(async (q) => {
    const all = await listVisibleMemories({ userId: q.ownerUserId, orgId: q.orgId, role: 'user' });
    const tag = `automation:${q.automationId}`;
    return all
      .filter((m) => (m.tags ?? []).includes(tag) && typeof m.content === 'string')
      .slice(0, q.maxMemories)
      .map((m) => m.content as string);
  });
  // 6. App-data collections behind ekoa_action steps (the served-app shared plane, G6).
  const automationAppData = new CollectionsEngine(deps);
  const appScopeOf = async (artifactId: string) => {
    const art = await getArtifactById(artifactId);
    return sharedScope(artifactId, (art?.userId as string | undefined) ?? '');
  };
  setAppDataStore({
    list: async (a, c) => automationAppData.list(await appScopeOf(a), c),
    get: async (a, c, id) => automationAppData.get(await appScopeOf(a), c, id),
    create: async (a, c, data) => (await automationAppData.create(await appScopeOf(a), c, data)) as { id: string } & Record<string, unknown>,
    update: async (a, c, id, patch) => automationAppData.upsert(await appScopeOf(a), c, id, patch),
    delete: async (a, c, id) => automationAppData.delete(await appScopeOf(a), c, id),
  });
  // 7. Artifact resolution for ekoa_action target apps (slug or id → project dir, jailed), ORG-
  //    SCOPED to the run: a cross-org artifact is refused, so an ekoa_action step can never resolve
  //    and execute another org's capability against its app-data (Codex G8).
  setArtifactResolver(async (slugOrId, requesterOrgId) => {
    const resolved = await resolveApp(slugOrId);
    if (!resolved || !resolved.artifactBacked) return null;
    const art = await getArtifactById(resolved.appId);
    if (!art || art.orgId !== requesterOrgId) return null;
    return { artifactId: resolved.appId, projectDir: projectDirFor(art) };
  });
  // 8. Catalog sources: integration definitions feed skills; connected platform accounts and
  //    artifact (ekoa_action) capabilities keep honest empties this gate — the seam carries no
  //    org context for accounts and no MANIFEST-capability surface exists yet (G9 note).
  setCatalogSources({
    getVisibleSkills: () =>
      listDefinitions().map((d) => ({
        integrationKey: d.integrationKey,
        actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
      })),
    getSkill: (integrationKey) => {
      const d = getDefinition(integrationKey);
      return d
        ? {
            integrationKey: d.integrationKey,
            actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
          }
        : undefined;
    },
    getConnectedPlatformAccounts: async () => [],
    listEkoaActions: async () => [],
  });
  // 9. The in-process local browser for browser-step automations (services/ shared pool).
  setLocalBrowserContextProvider(async () => {
    const browser = await getSharedBrowser();
    return browser.newContext();
  });
  // (setDaemonConnectionResolver stays on its honest default — the bridge lands at G8A.)

  // G8 — trigger delivery targets (ch02 §2.8: injected callbacks, never upward imports).
  setDeliveryTargets({
    startAutomationRun: async (automationId, event) => {
      const outcome = await startRunForTrigger({
        automationId,
        // Server-trusted owner from the trigger record, NEVER the inbound payload (§5.6.7).
        ownerUserId: event.trigger.ownerUserId,
        orgId: event.trigger.orgId,
        triggeredBy: 'webhook',
        event: {
          triggerId: event.trigger._id,
          integrationKey: event.trigger.integrationKey,
          eventName: event.trigger.eventName,
          receivedAt: new Date(deps.now()).toISOString(),
          payload: event.payload,
          rawHeaders: {},
        },
      });
      if (outcome.outcome === 'completed') return { ok: true };
      return { ok: false, reason: `run ended ${outcome.outcome}`, ...(outcome.permanent ? { permanent: true } : {}) };
    },
    invokeArtifactBackend: async (artifactId, entrypoint, event) => {
      // Delivery-side cross-org guard (Codex G8, defense-in-depth alongside the trigger-creation
      // check): the runtime resolves the artifact by raw id, so verify HERE that the target belongs
      // to the trigger owner's org before invoking. A foreign/unknown artifact is a permanent
      // failure — never executed, never retried.
      const art = await getArtifactById(artifactId);
      if (!art || art.orgId !== event.trigger.orgId) {
        return { ok: false, reason: 'artifact not in the trigger owner org', permanent: true };
      }
      try {
        // Build the dispatch input(s) (2A-S2, 2A-S3). An email-source listener (M365/Google)
        // hydrates the FULL message into the frozen EmailInput envelope — read_email via
        // callPlatformIntegration bound to the TRIGGER'S org (OAuth refresh in core), so the
        // artifact never touches Graph/OAuth. A WhatsApp envelope FANS OUT to one MessageInput per
        // inbound message (zero for a statuses-only notification → a dispatched no-op). Every other
        // source keeps the generic { event, trigger } envelope unchanged. A read failure THROWS out
        // of hydrateEmailInput → caught below → non-permanent failure → the delivery pipeline
        // retries (never a truncated preview body handed to the backend).
        const inputs = await buildArtifactBackendInputs(
          { id: event.trigger._id, integrationKey: event.trigger.integrationKey, eventName: event.trigger.eventName },
          event.payload,
          {
            hydrateEmail: (trigger, listItem) =>
              hydrateEmailInput(trigger, listItem, {
                call: (args) =>
                  callPlatformIntegration(
                    {
                      orgId: event.trigger.orgId,
                      integrationKey: (args.integrationKey as string) ?? trigger.integrationKey,
                      actionName: args.actionName as string,
                      args: (args.args as Record<string, unknown>) ?? {},
                    },
                    { now: deps.now, genId: deps.genId },
                  ),
              }),
          },
        );
        // One invocation per input. ZERO inputs (a WhatsApp statuses-only notification) is a
        // successful no-op: nothing to hand the backend, and the event stays audited + delivered
        // rather than burning the retry schedule. A mid-batch failure fails the WHOLE delivery, so
        // the retry re-invokes the earlier messages too — the backend dedupes on the wamid.
        for (const input of inputs) {
          const result = await invokeArtifactBackend(artifactId, entrypoint, input);
          if (!result.ok) return { ok: false, reason: result.error ?? 'backend handler reported failure' };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : 'backend invoke failed' };
      }
    },
  });

  // G8/2A-S1+S4 — listener supervisor: the durable poll→enqueue rail for `kind:'listener'` triggers.
  // Injected across the seams here (ch02 §2.8: only the composition root wires collaborators):
  // the listener-state cursor store, the SHARED event queue (via enqueueListenerEvent — never a
  // second queue), callPlatformIntegration bound to each trigger's org (OAuth refresh in core) for
  // the M365/Google branch, and executeUserIntegrationAction bound to each trigger's org + owner for
  // every other (user-defined) integration.
  // The loop is STARTED post-listen (below) and stopped on shutdown.
  configureListenerSupervisor({
    listListeners: async () => {
      const rows = (await triggers.find({ kind: 'listener' })) as TriggerDoc[];
      return rows.filter((t) => !t.disabled) as SupervisorTrigger[];
    },
    readCursor: (triggerId) => readListenerCursor(triggerId),
    writeCursor: (triggerId, cursor) => writeListenerCursor(triggerId, cursor, new Date(deps.now()).toISOString()),
    bumpFailure: (triggerId, error) => bumpListenerFailure(triggerId, error, new Date(deps.now()).toISOString()),
    enqueue: (input) => enqueueListenerEvent(input, new Date(deps.now()).toISOString()),
    // Platform (M365/Google) poll call — OAuth refresh + token custody live in platform-oauth.ts;
    // the poller supplies { integrationKey, actionName, args }, the trigger supplies the org.
    callPlatform: (trigger, call) =>
      callPlatformIntegration(
        {
          orgId: trigger.orgId,
          integrationKey: (call.integrationKey as string) ?? trigger.integrationKey,
          actionName: call.actionName as string,
          args: (call.args as Record<string, unknown>) ?? {},
        },
        { now: deps.now, genId: deps.genId },
      ),
    // User-defined (non-platform) poll call (2A-S4) — the SAME executor the automation `integration`
    // step uses, with the SAME automation-backed handler, bound to the trigger's own org + owner so
    // the poll runs under the owner's stored credentials and never a caller's. The automation seam
    // is NOT optional here: citius — the one shipped non-deferred user-defined listener source —
    // polls via an `automationBinding` action (consultar_notificacoes), so omitting it would leave
    // that listener permanently failing with `automation_required`. Actions whose package declares a
    // transport the executor does not implement (the imap package) come back as an
    // `unsupported_transport` failure, which the poll turns into a throw → backoff + audit row.
    callUserIntegration: (trigger, call) =>
      executeUserIntegrationAction(
        {
          orgId: trigger.orgId,
          ownerUserId: trigger.ownerUserId,
          integrationKey: call.integrationKey,
          actionName: call.actionName,
          args: call.args,
        },
        { runAutomationBackedAction },
      ),
    now: () => new Date(deps.now()).toISOString(),
  });

  // content/ audit write path (FIXED-8, ch08): the loader reaches data/ logActivity ONLY through
  // this injected seam, wired BEFORE boot ingest. Fire-and-forget — an audit hiccup never blocks
  // content IO.
  configureContentLoader({
    audit: ({ type, metadata }) => {
      void logActivity({ userId: 'system', username: 'system', orgId: '' }, 'execute', type, deps, metadata).catch(() => undefined);
    },
  });

  // Webhook ingress mounts FIRST with its own raw-body parser, BELOW/BEFORE the JSON parser,
  // so the HMAC verifier sees unmodified bytes (ch09 invariant 9 step 6).
  app.use('/hooks', hooksRouter(deps));

  // Injected app-scope seam (ch02 §2.7): integrations/ never imports apps/, so the
  // composition root builds the header->canonical-app resolver from apps/ internals.
  // Byte-compat: the served-app planes are key-value by app id (the old plane never
  // required the app to exist), so a charset-valid id ALWAYS resolves to a scope; an
  // artifact/registry hit fills the owner + served facts, an unregistered dev id gets
  // an empty owner (its owner-activation admission then has no subject - see
  // checkOwnerActivation). The Q-10 workspace m365 proxy gates on `isServed` +
  // `m365Proxy` separately, so an unregistered id can never reach the workspace token.
  const APP_ID_CHARSET = /^[a-zA-Z0-9._-]{1,100}$/;
  const resolveAppScope: ResolveAppScope = async (idOrSlug) => {
    if (!APP_ID_CHARSET.test(idOrSlug) || idOrSlug.startsWith('usr.')) return null;
    const appRow = await resolveApp(idOrSlug);
    const appId = appRow?.appId ?? idOrSlug;
    const reg = appRegistry.getApp(appId);
    return {
      appId,
      ownerUserId: appRow?.artifactBacked ? appRow.ownerUserId : '',
      isServed: !!reg,
      m365Proxy: (reg?.manifest as { m365Proxy?: boolean } | null)?.m365Proxy === true,
    };
  };
  // Workspace-credential seams (ch06/G8 territory): until the platform-integrations
  // credential store lands, the workspace planes surface the honest not-connected state.
  const workspaceNotConnected = (what: string) => async (): Promise<never> => {
    throw Object.assign(new Error(`${what} is not connected`), { code: 'not_connected' });
  };
  /** The workspace cloud-storage credential seam, shared by the served-app cloud plane and the
   *  docx link ingest: both report the same honest not-connected state until the platform-
   *  integrations credential store lands - never a silent failure or a fake success. */
  const workspaceCloudFiles = {
    getStatus: async () => ({ google: { connected: false, needsReauth: false }, microsoft: { connected: false, needsReauth: false } }),
    getAccessToken: workspaceNotConnected('Workspace cloud storage'),
  };

  // 2C-S5 - the three ekoa-docx agent tools (agents/sdk-tools.ts `docxToolSpecs`, mounted on
  // build runs). agents/ owns no document logic: the per-artifact document lifecycle
  // (apps/document-source.ts), the pure track-changes engine (services/docx-redline.ts) and the
  // SSRF-guarded link/cloud ingest (integrations/docx-fetch.ts, over the workspace-credential
  // seam above) reach it ONLY through this seam, wired here and nowhere else. The appId the tools
  // act on binds from the RUN (build.ts: appId = artifactId), never from a tool argument.
  const docxFetcher = createDocxFetcher(workspaceCloudFiles);
  setDocxToolSeams({
    projectBuffer: (buffer) => projectDocx(buffer),
    getProjection: docxGetProjection,
    setSource: async (appId, opts) => {
      const status = await docxSetSource(appId, opts);
      return { fileName: status.fileName ?? opts.fileName };
    },
    applyEdits: docxApplyEdits,
    fetchFromUrl: (url) => docxFetcher.fetchDocxFromUrl(url),
    fetchFromCloud: (provider, opts) => docxFetcher.fetchDocxFromCloud(provider, opts),
  });

  // Raw-body served-app planes mount BEFORE the global JSON parser: their proxied/
  // uploaded bytes must arrive unconsumed (each carries its own per-route parsers).
  app.use('/api/m365', m365ProxyRouter({ resolveAppScope, getWorkspaceGraphToken: workspaceNotConnected('Microsoft workspace integration'), verifyToken }));
  app.use('/api/app-cloud-files', appCloudFilesRouter({ resolveAppScope, ...workspaceCloudFiles }));
  app.use('/api/app-files', appFilesRouter());
  app.use('/api/app-sso', appSsoRouter({ ...deps, resolveAppScope }));

  // The LLM gateway sub-app carries its own 50 MB body limit (stock Claude Code clients
  // routinely send >1 MB bodies - long transcripts, base64 screenshots). The global 1 MB parser
  // must not pre-parse its routes, or the router-level limit is dead code and every large
  // gateway body 413s before reaching it (S3, run 20260717; surfaced by the S1 fresh review).
  // The gateway router carries its own Anthropic-shaped body-parser error handler.
  // Exact-subtree + case-insensitive match (codex S3 Medium: bare startsWith also exempted
  // /api/v1/llmfoo; S3 fresh review F1: Express route matching is case-insensitive by default,
  // so /API/v1/llm was a live gateway route the case-sensitive predicate did not exempt).
  const globalJson = express.json({ limit: '1mb' });
  const isGatewayPath = (path: string): boolean => {
    const p = path.toLowerCase();
    return p === '/api/v1/llm' || p.startsWith('/api/v1/llm/');
  };
  app.use((req: Request, res: Response, next: NextFunction) =>
    isGatewayPath(req.path) ? next() : globalJson(req, res, next));
  // Body-parser failures (malformed JSON, over-limit payloads) must speak the CONV-2 envelope:
  // without this, Express's default handler returns an HTML page with the full stack trace and
  // absolute server paths — pre-auth, on every JSON route (2026-07-09 adversarial-test finding;
  // guarded by tests/contract/malformed-json.test.ts).
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const e = err as { type?: string; status?: number } | null;
    if (e?.type === 'entity.too.large') { sendError(res, 'PAYLOAD_TOO_LARGE', 'Corpo do pedido demasiado grande.'); return; }
    if (e && typeof e.status === 'number' && e.status >= 400 && e.status < 500) {
      sendError(res, 'VALIDATION_FAILED', 'Corpo do pedido inválido.');
      return;
    }
    next(err);
  });

  // Public health surface (ch03 §3.8.23) — field shape carried; external watchdogs depend on it.
  // G7: the LLM-chokepoint slice (claudeAuth field carried verbatim as the watchdog contract,
  // §6.2.4; plus the metering-anomaly + gateway-unmetered counters, §6.3 rule 3 / §6.5.4).
  app.get('/health', (_req: Request, res: Response) => {
    const llm = llmHealth();
    res.json({
      ok: true,
      claudeAuth: llm.claudeAuth,
      meteringAnomalies: llm.meteringAnomalies,
      gatewayUnmeteredCalls: llm.gatewayUnmeteredCalls,
      clockSkewSec: 0,
      bridgeConnections: sseManager.connectionCount,
      pendingEvents: 0,
    });
  });

  // Domain routers (mounted as their build phases land — G2 auth onward).
  app.use('/api/v1/auth', authRouter(deps));
  // G3 — platform CRUD domains.
  app.use('/api/v1/users', usersRouter(deps));
  app.use('/api/v1/org', orgRouter(deps));
  // F4: the contract branding paths (PUT /api/v1/branding + POST /api/v1/branding/research).
  app.use('/api/v1/branding', brandingRouter(deps));
  app.use('/api/v1/orgs', orgsRouter(deps));
  app.use('/api/v1/settings', settingsRouter(deps));
  app.use('/api/v1/sessions', sessionsRouter(deps));
  app.use('/api/v1/memories', memoriesRouter(deps));
  app.use('/api/v1/registo', registoRouter(deps));
  app.use('/api/v1/change-requests', changeRequestsRouter(deps));
  app.use('/api/v1/billing', billingRouter(deps));
  // F2 — model-credential provisioning (super-admin, write-only, audit-logged; ch06 §6.2).
  app.use('/api/v1/credentials', credentialsRouter(deps));
  // G7B — agent execution: chat runs + build/brand-research jobs (ch03 §3.8.7-8). The router
  // internal paths determine the surface: /api/v1/chat/runs, /api/v1/jobs.
  app.use('/api/v1/chat', chatRouter(deps));
  app.use('/api/v1/jobs', jobsRouter(deps));
  // G7 — the ekoa-local LLM gateway sub-app (ch03 §3.10; metering inside the chokepoint,
  // §6.5.4). Mounted at /api/v1/llm; the token verifier AND the per-user key verifier (S4a)
  // are injected (llm/ needs no auth/ import — the gateway takes them as deps). A user-key
  // principal bills its OWNER; the static key stays platform overhead.
  registerGateway(app, { verifyToken, verifyGatewayKey });
  // S4a — per-user gateway API keys: mint (show-once) / list / revoke, self-service.
  app.use('/api/v1/gateway-keys', gatewayKeysRouter(deps));
  // Cofre (WS-B B-3): credential custody. Every authorization decision lives in api/src/cofre/,
  // not the router — one place to audit, and one place for WS-K's KMS envelope to install behind.
  app.use('/api/v1/cofre', cofreRouter(deps));
  // G4 — integrations + knowledge.
  app.use('/api/v1/integrations', integrationsRouter(deps));
  // ch03 §3.8.14 — the AI integration builder (chat/load/save/test).
  app.use('/api/v1/integration-builder', integrationBuilderRouter(deps));
  app.use('/api/v1/knowledge', knowledgeRouter(deps));
  // G5 — push infrastructure + triggers.
  app.use('/api/v1/triggers', triggersRouter(deps));
  app.use('/api/v1/notifications', notificationsRouter());
  // G8 — automations (§3.8.18) + the platform-integration execution layer (§3.8.15/16).
  app.use('/api/v1/automations', automationsRouter());
  app.use('/api/v1/platform-integrations', platformIntegrationsRouter(deps));
  // The OAuth callback path is kept VERBATIM (§3.8.15): it is a registered redirect URI.
  app.use('/api/v1/oauth', oauthCallbackRouter(deps));
  app.use('/api/v1/pipedream', pipedreamRouter(deps));
  // G8A — the bridge token mint (ch18 §18.3.2, §3.10); the WS connect + provider endpoint are on
  // the bridge WS server attached at boot, not REST.
  app.use('/api/v1/bridge', bridgeTokenRouter());
  // G6 — artifacts (platform) + the byte-compatible served-app plane (outside /api/v1).
  app.use('/api/v1/artifacts', artifactsRouter(deps));
  app.use('/api/v1/company-space', companySpaceRouter(deps));

  // F6: terminal JSON-404 for the platform API. Every non-2xx body must validate against the
  // shared error envelope (QA block); an unmounted /api/v1/* path previously fell through to
  // Express's default HTML 404, so clients that parse JSON got HTML. SCOPED TO /api/v1 on
  // purpose: the served-app data plane (/api/app-data, /api/app-shared), /api/design-tokens.css,
  // /api/m365 and the /apps/* SPA fallbacks own their own not-found behavior. It sits AFTER every
  // /api/v1 router, so a mounted route still answers (a 401 stays a 401, never a 404).
  app.use('/api/v1', (_req: Request, res: Response) => {
    sendError(res, 'NOT_FOUND', 'Não encontrado.');
  });

  app.use('/api', servedDataRouter(deps));
  // Served-app assistant (operator-run D1): POST /api/app-assistant, header-scoped, runs under the
  // resolved artifact owner's org + billing through the llm/ chokepoint.
  app.use('/api', appAssistantRouter());
  // App DOCX served-app plane (2C-S4): the document-base app's window onto its linked Word doc.
  // Mounted AFTER the global JSON parser (its /edits + /clean bodies are JSON). Admission is
  // app-files' admitApp incl. the owner-activation gate (inside the router); the document-source
  // service functions are the injected seam - the composition root binds the real ones here.
  app.use('/', appDocxRouter({
    getStatus: docxGetStatus,
    getProjection: docxGetProjection,
    getCurrent: docxGetCurrent,
    getClean: docxGetClean,
    applyReview: docxApplyReview,
    restoreSource: docxRestoreSource,
  }));
  // Legal vertical services + e-signature (full paths carried inside the routers).
  // The owner-spine seams read/write the app owner's SHARED collections (usr.<owner>)
  // through the collections engine - the same spine the app itself drives via
  // window.__ekoa.shared. legal/ may import data/, but the SCOPE derivation lives at
  // the composition root so the resolver stays the one injected seam.
  const legalEngine = new CollectionsEngine(deps);
  const spineScope = (a: { appId: string; ownerUserId: string }) => sharedScope(a.appId, a.ownerUserId);
  app.use('/', legalRouter({
    resolveApp: resolveAppScope,
    transcricao: {
      getRow: (a, coll, id) => legalEngine.get(spineScope(a), coll, id),
      updateRow: async (a, coll, id, patch) => { await legalEngine.upsert(spineScope(a), coll, id, patch); },
    },
    calculos: {
      getOverlay: (a) => legalEngine.list(spineScope(a), 'tabelas_taxas_overlay').catch(() => []),
      alarmeStore: {
        list: (scope, coll) => legalEngine.list({ scopeKey: scope, appId: scope }, coll),
        create: (scope, coll, data) => legalEngine.create({ scopeKey: scope, appId: scope }, coll, data),
      },
    },
    // Portal connector owner-spine seams (mega-run E1): documentos/eventos through the
    // same collections engine the app itself drives; getOwnerOrgId is the org-scoping
    // check no prior legal-suite route needed (access-gate.ts's ResolvedLegalApp carries
    // no orgId).
    portal: {
      getOwnerOrgId: async (ownerUserId) => (await users.get(ownerUserId))?.orgId ?? null,
      createDocumento: (a, row) => legalEngine.create(spineScope(a), 'documentos', row),
      createEvento: (a, row) => legalEngine.create(spineScope(a), 'eventos', row),
      listDocumentos: (a, processoId) =>
        legalEngine.list(spineScope(a), 'documentos').then((rows) => rows.filter((r) => r.processoId === processoId)),
      listEventos: (a, processoId) =>
        legalEngine.list(spineScope(a), 'eventos').then((rows) => rows.filter((r) => r.processoId === processoId)),
    },
    // Portal certidão-by-access-code connector seams (mega-run E2/E3): the blob-save path
    // is the SAME app-files store a served app's own uploadFile uses (saveAppFileBlob),
    // never a second storage mechanism or an HTTP self-call.
    portalCertidao: {
      saveBlob: async (appId, name, contentType, bytes) => {
        const meta = await saveAppFileBlob(appId, name, contentType, bytes);
        return { fileId: meta.id, url: `/api/app-files/${appId}/${meta.id}`, mime: meta.type, size: meta.size };
      },
    },
    // Insolvência-watch owner-spine seams (mega-run E4): the citius_watches satellite
    // collection through the SAME collections engine as documentos/eventos - a watch is
    // ordinary dossiê data, not a new storage mechanism.
    insolvenciaWatch: {
      listWatches: (a, processoId) =>
        legalEngine.list(spineScope(a), CITIUS_WATCH_COLLECTION).then((rows) => rows.filter((r) => r.processoId === processoId)),
      updateWatch: async (a, watchId, patch) => {
        await legalEngine.upsert(spineScope(a), CITIUS_WATCH_COLLECTION, watchId, patch);
      },
    },
  }));
  // E-signature inbound-webhook advance (2B-S3), shared by both providers: a signature
  // completion advances the owner's `propostas` record to 'Assinada' through the SAME
  // collections engine the served app itself drives. `propostas` is PER-APP data (the
  // /api/app-data plane's appScope), not the org-shared spine — so the advance keys on
  // the canonical appId carried in the reverse-index row, never a client value. The
  // handlers NEVER trust the payload: they re-fetch owner-scoped and re-confirm the client
  // signed before this idempotent (stage !== 'Assinada') advance.
  const getProposta = (appId: string, id: string) => legalEngine.get(appScope(appId), 'propostas', id);
  const updateProposta = async (appId: string, id: string, patch: Record<string, unknown>): Promise<void> => {
    await legalEngine.upsert(appScope(appId), 'propostas', id, patch);
  };
  // Zoho Sign served-app proxy (2B-S2/S3): sibling of the Adobe proxy, but Zoho is the
  // fully LIVE provider. Every external dep is injected from this composition root —
  // HTML→PDF (integrations/ may NOT import apps/), the owner→org lookup (ResolvedAppScope
  // has no orgId, the same users-store lambda the legal portal seam uses at L661 above),
  // config custody (findConfigForOwner + decrypt), credential persistence (re-encrypt +
  // integrationConfigs CAS, mirroring the executor's persistProviderCredentialUpdates),
  // and (2B-S3) the requestId→proposta reverse-index write at send time (recordAgreement).
  // Built BEFORE the Adobe router so the pluggable /api/signature/send facade can route
  // `provider:'zoho-sign'` to this live backend (2B-S4 swap).
  const zohoBackend = makeZohoSignBackend({
    getOwnerOrgId: async (ownerUserId) => (await users.get(ownerUserId))?.orgId ?? null,
    findConfigForOwner,
    decrypt,
    renderHtmlToPdf,
    persistOwnerCredentialUpdates: async (configId, currentFields, updates) => {
      const merged: Record<string, unknown> = { ...currentFields, ...updates };
      delete merged.storageState;
      const ciphertext = encrypt(JSON.stringify(merged));
      await integrationConfigs.update(configId, (cur) => ({ ...cur, credentialsCiphertext: ciphertext }));
    },
    recordAgreement: recordZohoAgreement,
  });
  // Adobe stays facade-only (notConnectedBackend): wiring the webhook deps + the
  // adobe_agreements find makes migrated rows routable and the dispatch LIVE, but the
  // owner-scoped re-fetch (getAgreement) fails closed → a forged/real event is a no-op
  // until a live Adobe backend exists. The resolveApp gate + webhook echo are unchanged.
  // 2B-S4: the shared pluggable /api/signature/send route lives on this router; it is given
  // BOTH backends so `provider:'zoho-sign'` reaches live Zoho while default/'adobe' stays the
  // facade and 'cmd' the inactive seam. (The ERP itself signs via /api/zoho-sign/* directly.)
  app.use('/', adobeSignRouter({
    resolveApp: resolveAppScope,
    backend: notConnectedBackend,
    zohoBackend,
    onWebhook: (payload) =>
      handleAdobeWebhook(payload, {
        findAgreement: findAdobeAgreement,
        getAgreement: (ownerUserId, agreementId) => notConnectedBackend.getAgreement(ownerUserId, agreementId),
        getProposta,
        updateProposta,
      }),
  }));
  app.use('/', zohoSignRouter({
    resolveApp: resolveAppScope,
    backend: zohoBackend,
    // 2B-S3 inbound webhook: the owner-scoped re-fetch runs through the SAME live backend's
    // getRequest (never the payload); a client-signed request idempotently advances the
    // proposta exactly once (a replay is a no-op).
    onWebhook: (payload) =>
      handleZohoWebhook(payload, {
        findAgreement: findZohoAgreement,
        getRequest: (ownerUserId, requestId) => zohoBackend.getRequest(ownerUserId, requestId),
        getProposta,
        updateProposta,
      }),
  }));
  app.get('/api/design-tokens.css', designTokensHandler());
  // Served-app document export (ch07 §7.12): window.__ekoa.exportPdf POSTs the serialized DOM
  // here; the rendered PDF is served from /artifact-pdfs below. Was never mounted in the port -
  // every in-app "Descarregar PDF" 404'd (caught live by the per-build verifier, 2026-07-11).
  app.use('/', appPdfRouter());
  mkdirSync(getArtifactPdfDir(), { recursive: true });
  app.use('/artifact-pdfs', express.static(getArtifactPdfDir(), { fallthrough: false }));
  // Artifact thumbnails (ch07 §7.11): PNGs captured post-build, served publicly. The dir is
  // pre-created so a fresh data dir serves clean 404s instead of an ENOENT from static().
  mkdirSync(getArtifactScreenshotDir(), { recursive: true });
  app.use('/artifact-screenshots', express.static(getArtifactScreenshotDir(), { fallthrough: false }));
  // Per-step automation screenshots (ch12): PNGs written per run at <dataDir>/automation-runs/
  // <automationId>/<runId>/step-N.png.
  //
  // SUPERSEDES the `express.static` capability-URL mount (Cofre R-3). These are screenshots of an
  // AUTHENTICATED session on a client portal — for this product, processo numbers and client NIFs
  // rendered as pixels — and they were served with no auth middleware, no tenant check and no
  // expiry. The recorded rationale was that an <img> cannot carry an Authorization header; the
  // answer is the SAME short-lived-query-token pattern the SSE stream already uses for exactly
  // that constraint, not trading the control away. The URL SHAPE is unchanged, so every persisted
  // screenshotUrl keeps resolving; the client appends `?token=<jwt>`.
  mkdirSync(automationRunsRoot(), { recursive: true });
  app.use(
    '/automation-screenshots',
    screenshotPlaneRouter({
      verifyQueryToken: (token) => {
        const v = verifySseToken(token);
        return v.ok
          ? { ok: true as const, claims: { sub: v.claims.sub, orgId: v.claims.orgId, role: v.claims.role } }
          : { ok: false as const, status: v.status, code: v.code };
      },
      onDenied: ({ runId, actorUserId, actorOrg }) => {
        console.warn(`[automation] screenshot access denied run=${runId} actor=${actorUserId} org=${actorOrg}`);
      },
    }),
  );
  // Brand-research logos (ch05 §5.6.4): the pipeline downloads + validates the owner's logo and
  // stores it under <dataDir>/brand-assets; served publicly read-only like the artifact
  // thumbnails above (the dashboard renders `/brand-assets/<file>` via <img>). Dir pre-created so
  // a fresh data dir serves clean 404s instead of an ENOENT from static().
  mkdirSync(getBrandAssetsDir(), { recursive: true });
  app.use('/brand-assets', express.static(getBrandAssetsDir(), { fallthrough: false }));
  // Build-share links (ch07 §7.7): fork-per-click.
  app.use('/build', buildLinkRouter({ ...deps, verifyToken }));
  // Serving pipeline (ch07 §7.5-7.7): /apps/:idOrSlug/* + demo-bridge + demos + app-health.
  // The owner-bypass token verifier is injected here (apps/ never imports auth/, ch02 §2.7).
  app.use('/', servingRouter({ verifyToken }));
  // Dev-serve (ch07 §7.4 trigger 6) - hard-off in production-like environments.
  app.use('/', devServeRouter(config.nodeEnv !== 'production'));

  return app;
}

/** Boot the persistence + admission state (ch09 §9.7): connect fail-fast, load the
 *  activation map + revocation set, seed the founder super-admin. Then the apps/
 *  boot obligations (ch07 §7.16): registry scan + slug-index load (parallel block),
 *  featured-artifact seeding + orphan sweep (sequential migrations). */
export async function bootState(deps: RuntimeDeps = defaultDeps): Promise<void> {
  await connectMongo(); // fail-fast on a bad connection string
  const allUsers = await users.find({});
  // Reload the FULL admission state per user, not just `active` (H1): the durable `tokenEpoch` and
  // `billingLocked` columns must survive restart, or every revocation and every billing lock resets
  // at boot (a demoted admin's old JWT re-admits, a locked account re-opens). loadActivation defaults
  // the two optionals when a legacy row predates the columns.
  loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active, billingLocked: u.billingLocked, tokenEpoch: u.tokenEpoch })));
  // H1 idempotent migration: rewrite any retired `builder` role → `user` and bump its token epoch
  // (runs after loadActivation so the epoch lands in the in-memory map; no-op once migrated).
  const migratedRoles = await migrateBuilderRole();
  if (migratedRoles > 0) console.log(`[role-migration] builder -> user: ${migratedRoles} user(s) migrated`);
  await loadRevocations(Math.floor(deps.now() / 1000));
  await loadCredential(); // G7: load the central model credential (§6.2; no-op when unconfigured)

  // G7B — agent-execution boot obligations (ch08 §8.3.1, ch04 §4.4.1, ch05 §5.2.1). All three are
  // resilient on a fresh/empty data directory: content ingest ensures its dirs, the knowledge
  // backfill ensures the index dir and no-ops on an already-populated index, and the orphan sweep
  // finds nothing to sweep. Ordered after connectMongo (the sweep + backfill read collections).
  await bootContentLoader();
  await backfillKnowledgeIndex();
  await sweepOrphans(deps.now);
  // Cofre R-3: per-step screenshots had NO retention — every reference in api/src was a write or a
  // path builder, so stale PNGs of authenticated client-portal sessions accumulated forever in an
  // unindexed tree. That is a GDPR erasure gap, so the sweeper lands with the auth change rather
  // than as a follow-up. Best-effort by construction: a sweep failure must never fail boot.
  void sweepExpiredScreenshots({ now: deps.now })
    .then(({ removed, scanned }) => {
      if (removed > 0) console.log(`[automation] screenshot retention: removed ${removed}/${scanned} run dirs`);
    })
    .catch(() => {});

  const seedUser = process.env.EKOA_ADMIN_USERNAME;
  const seedPass = process.env.EKOA_ADMIN_PASSWORD;
  if (seedUser && seedPass) await seedAdmin(seedUser, seedPass, deps);

  // ch07 §7.16 - parallel boot block, then sequential migrations.
  await Promise.all([appRegistry.start(appRegistry.sandboxRoot), loadSlugIndex()]);
  const seeded = await seedFeaturedArtifacts();
  console.log(
    `[featured-seeder] seeded ${seeded.seeded}, refreshed ${seeded.refreshed}, orphans removed ${seeded.orphansRemoved}`,
  );
}

/** Post-listen, fire-and-forget obligations (ch07 §7.16): featured prebuild. */
export function bootPostListen(): void {
  void buildAndRegisterFeaturedArtifacts()
    .then((r) => console.log(`[featured-builder] built ${r.built}, skipped ${r.skipped}, failed ${r.failed}, registered ${r.registered}`))
    .catch((err) => console.warn('[featured-builder] prebuild failed:', err instanceof Error ? err.message : err));
}

/** Boot: validate config (fail-closed), install process guards, start listening. */
export function boot(): void {
  // Process-level exception posture (carried): log and continue; never crash on a stray throw.
  process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
  process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

  const config = loadConfig(); // throws on missing ENCRYPTION_KEY / JWT_SECRET (fail-closed)
  const app = buildApp(config);
  bootState()
    .then(() => {
      const httpServer = app.listen(config.port, () => {
        console.log(`[ekoa-api] listening on :${config.port} (${config.nodeEnv})`);
        bootPostListen();
        // Boot ordering constraint (ch02 §2.6 server.ts row): the trigger delivery pipeline
        // starts only AFTER the HTTP server is listening, so re-entrant deliveries (a run
        // calling back into this server) find a live listener.
        void startDelivery();
        // 2A-S1: the listener supervisor (durable poll→enqueue) also starts post-listen — its polls
        // enqueue into the same queue the (now-running) delivery pipeline drains.
        void startListenerSupervisor();
      });
      // The live browser canvas media channel (FIXED-2 carve-out, RESOLVED Q-01): a WS
      // upgrade surface on the same HTTP server, short-TTL token auth, 1000/4000 close codes.
      attachCanvasServer(httpServer);
      // The voice relay (mega-run C1, BRIEF §5): streaming/'s sibling WS carve-out -
      // /api/voice/stream (STT relay) + /api/voice/tts-stream ({clear} barge-in), session-JWT
      // ?token= auth (CONV-1), stub providers until C6 lands vendor keys.
      attachVoiceServer(httpServer);
      // The daemon-to-Cortex bridge (ch18 §18.3, outside FIXED-2's frontend rule): the WS server
      // the ekoa-local daemon dials into. Org resolution reads the users store; a ledger row is
      // display metadata only (§18.6, never persisted hosted by default).
      attachBridgeServer(httpServer, {
        resolveUserOrg: async (userId) => ((await users.get(userId)) as { orgId?: string } | null)?.orgId,
        // FC-402 (run s5, D3): ledger rows land in the bounded in-memory per-session buffer
        // the chat pipeline joins per turn — transient display metadata, never persisted.
        onLedgerRow: bufferLedgerRow,
      });
    })
    .catch((err) => {
      console.error('[ekoa-api] boot failed:', err);
      process.exit(1);
    });

  // Shutdown obligations (ch07 §7.16): dispose esbuild watch contexts + registry watchers;
  // the delivery pipeline drains in-flight dispatches (the rest recovers next boot, §12.3).
  const shutdown = () => {
    void Promise.allSettled([stopListenerSupervisor(), stopDelivery(), appBuilder.dispose(), appRegistry.stop()]).then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Boot only when run directly (not when imported by the contract suite's app factory).
// Use pathToFileURL so the comparison holds under paths with spaces/non-ASCII chars and
// percent-encoding — a naive `file://${argv[1]}` would silently mismatch and never boot.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  boot();
}
