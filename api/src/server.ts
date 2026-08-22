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
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { loadConfig, type Config } from './config.js';
import { securityHeaders } from './security-headers.js';
import { connectMongo } from './data/mongo.js';
import { users, triggers } from './data/stores.js';
import { CollectionsEngine, sharedScope, ownerSharedScope, appScope } from './data/collections-engine.js';
import { loadActivation } from './data/activation.js';
import { loadRevocations } from './auth/revocation.js';
import { seedAdmin } from './auth/service.js';
import { migrateBuilderRole } from './auth/users-service.js';
import { ERROR_STATUS, type ErrorCode } from '@ekoa/shared';
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
import { llmHealth, registerGateway, loadCredential, setRulesetResolver, completeFast, type UserWorkAgentType } from './llm/index.js';
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
import { attachBridgeServer, bufferLedgerRow, delegateToLocal, rowsForSession, getConnectionByOwner, invokeTool, bridgeConnectionCount, createDaemonStepConnection, authoriseDelivery, deliverSecrets, newInvocationId, isCapabilityGranted } from './bridge/index.js';
// Deep import, as `routes/integrations.ts` already does for the same registry: the fleet listing
// selection is allowed to see is not on the bridge module's public face, and adding it there is a
// change to a module this slice does not own.
import { egressCandidatesForOrg } from './bridge/registry.js';
import { maskedCountsForCorrelations } from './services/platform-crud.js';
import { bridgeTokenRouter } from './routes/bridge.js';
import { servedDataRouter } from './apps/served-data.js';
import { appAssistantRouter } from './apps/app-assistant-route.js';
import { appVisionRouter } from './apps/app-vision-route.js';
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
import { appEmailRouter } from './integrations/app-email.js';
import { createWorkspaceCredentials } from './integrations/workspace-credential.js';
import { adobeSignRouter, handleAdobeWebhook, notConnectedBackend } from './integrations/adobe-sign.js';
import { zohoSignRouter, makeZohoSignBackend, handleZohoWebhook } from './integrations/zoho-sign.js';
import { zohoOAuthRouter } from './integrations/zoho-oauth.js';
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
import { verifySseToken, requireAuth, requireRole, type AuthedRequest } from './auth/middleware.js';
import { verifyGatewayKey } from './auth/gateway-keys-service.js';
import { gatewayKeysRouter } from './routes/gateway-keys.js';
import { memvaultRouter } from './routes/memvault.js';
import { cofreRouter } from './routes/cofre.js';
import { setCredentialEstablishedNotifier } from './cofre/index.js';
import { artifactsRouter } from './routes/artifacts.js';
// G7B — agent execution (ch05 + ch08): chat/job routers, the injected agent seams, and the
// boot obligations (content ingest, knowledge backfill, orphan sweep).
import { chatRouter } from './routes/chat.js';
import { jobsRouter } from './routes/jobs.js';
import { uploadsRouter } from './routes/uploads.js';
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
// D3 — the AUTHORING seam for `achieve`. A DEEP import of the shared authoring core, the same one
// `automation/planner.ts` takes: the core's only dependency is the chokepoint, and the builder's
// adapter (which pulls in billing/, the agent seams and the builder session store) is deliberately
// not on this path. `integrations/` is tier 3 and may not import it, which is why it arrives here
// as a typed callback rather than an upward import.
import { authorWithRepair } from './agents/authoring-core.js';
import { assembleAgentContext, bootContentLoader, composeContext, configureContentLoader } from './content/index.js';
import { backfillKnowledgeIndex, buildGroundingBlock, ingestDocument, searchKnowledgeIndex, readDocWithShared, seedKnowledgeSources } from './knowledge/index.js';
import { startKnowledgeScheduler } from './knowledge/crawl/scheduler.js';
// G8 — automation engine + integrations execution layer + delivery targets + canvas.
import { automationsRouter } from './routes/automations.js';
import { platformIntegrationsRouter, oauthCallbackRouter } from './routes/platform-integrations.js';
import { pipedreamRouter } from './routes/pipedream.js';
import { syncRouter } from './routes/sync.js';
import {
  setRunEventEmitterFactory,
  setIntegrationActionExecutor,
  setPlatformIntegrationCaller,
  setIntegrationCredentialLoader,
  setIntegrationOriginResolver,
  setIntegrationActionDeclarationResolver,
  setCredentialResumeDriver,
  onCredentialEstablished,
  redispatchRunAwaitingCredentials,
  setScopedMemoryResolver,
  // S3 - the run owner's own integration notes, for the planner and the rehearsal fixer.
  setIntegrationFeedbackResolver,
  setAppDataStore,
  setArtifactResolver,
  setCatalogSources,
  setLocalBrowserContextProvider,
  localBrowserContextProviderUsing,
  setEgressCandidateResolver,
  setDaemonConnectionResolver,
  setAutomationContentSections,
  startRunForTrigger,
  automationBackedActionHandler,
  buildAutomationCatalog,
  formatCatalogForPrompt,
  automationStepEventPayload,
  automationRunsRoot,
  screenshotPlaneRouter,
  sweepExpiredScreenshots,
  collectRunEvidence,
  type RunEventEmitter,
} from './automation/index.js';
import { type ActionDrafter, type PlanDrafter } from './integrations/integration-achieve.js';
import type { AppCollections } from './integrations/action-compose.js';
import { type CapabilityContext } from './integrations/integration-capability.js';
import { platformStatus } from './integrations/platform-oauth.js';
import {
  executeUserIntegrationAction,
  type AutomationBackedHandler,
  type ExecutorDeps,
  callPlatformIntegration,
  findConfigForOwner,
  persistRotatedCredentials,
  beginConfigOAuth,
  findConfigByOAuthState,
  persistConfigOAuthGrant,
  integrationPrefetch,
  resolveDefinition,
  listDefinitionsFor,
  resolveSkillMd,
  // C3 — the PROMPT view of an integration's accumulated lessons, and the one place the two halves
  // of the `load_context` body are joined.
  lessonsForPrompt,
  composeIntegrationContext,
  // Slice S3 - the two PROMPT views of a person's own notes: per-integration (the `load_context`
  // third section) and per-owner (the automation planner + rehearsal seam). Both arrive already
  // scrubbed and capped; the byte-exact author views live behind the route layer and this file
  // never reaches them.
  feedbackForPrompt,
  feedbackSectionsForOwner,
  // Slice S1: the evidence store the executor's capture seam is bound to, which also owns the
  // retention pins the screenshot sweep must spare and the TTL sweep that is now the only automatic
  // collector, plus the window that sweep reports.
  actionEvidenceStore,
  EVIDENCE_RETENTION_DAYS,
} from './integrations/index.js';
// Deep import, deliberately NOT via the integrations barrel (A3 review L2): the importer mints a
// platform-level actor, so only THIS composition-root boot path may reach it — keeping it off the
// barrel means no route module can pick it up by accident (pinned by a barrel-surface test).
import { importLegacyRuntimePackages, LEGACY_IMPORT_OPT_IN_ENV } from './integrations/legacy-runtime-import.js';
import {
  invokeArtifactBackend,
  WorkerThreadRuntime,
  NullArtifactBackendRuntime,
  setArtifactBackendRuntime,
} from './apps/backend-runtime/index.js';
import { AppDataAccess } from './apps/app-data-access.js';
import { listEmailIntegrations, sendAppEmail, type AppEmailDeps, type AppEmailContext } from './integrations/app-email.js';
import { getArtifactById, projectDirFor } from './apps/app-paths.js';
import { listVisibleMemories } from './memory/index.js';
import { getSharedBrowser } from './services/browser-pool.js';
import type { Browser } from 'playwright';
// B2 (WS-C): the credential-egress allow-list and the credential SHADOW comparator both live in
// integrations/credential-cofre.ts — one implementation, reachable from the seams below and from a
// test, rather than a derivation written inline in the composition root where nothing can exercise it.
import {
  egressOriginsForIntegration,
  loadIntegrationCredentialFields,
  observeCredentialShadow,
} from './integrations/credential-cofre.js';
import { setDeliveryTargets } from './events/delivery.js';
import {
  configureListenerSupervisor,
  startListenerSupervisor,
  stopListenerSupervisor,
  enqueueListenerEvent,
  type SupervisorTrigger,
} from './events/listener-supervisor.js';
import {
  configureScheduleSupervisor,
  startScheduleSupervisor,
  stopScheduleSupervisor,
  mapAutomationOutcome,
  mapIntegrationOutcome,
} from './schedules/supervisor.js';
import { schedulesRouter } from './routes/schedules.js';
import { readListenerCursor, writeListenerCursor, bumpListenerFailure } from './events/listener-state.js';
import { buildArtifactBackendInputs } from './integrations/event-sources/dispatch-input.js';
import { hydrateEmailInput } from './integrations/event-sources/email-hydrate.js';
import type { TriggerDoc } from './events/service.js';
import { envelopeDecrypt } from './data/crypto.js';
import { verifyRunner } from './apps/verify-runner.js';
import { createBuildMechanics } from './apps/build-mechanics.js';
import { logActivity } from './data/activity.js';
import { denyListRulesetFieldsFor } from './services/deny-list.js';

export interface RuntimeDeps {
  now: () => number;
  genId: () => string;
  /**
   * How this process opens the shared hosted Chromium. Defaults to `getSharedBrowser`, which is a
   * real Playwright launch - so the ONE composition-root binding that turns a resolved egress route
   * into an actual proxy could not be observed without launching a browser, and consequently was
   * observed by nothing (`tests/automation/composition-root-locality.test.ts` is what closes that).
   * Optional: every existing caller passes `{ now, genId }` and gets production's opener.
   */
  openBrowser?: () => Promise<Browser>;
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
    // Forwarded WHOLE: the wire event is the persisted `RunCredentialRequest` plus a `type`
    // discriminator (`shared/src/events.ts`), so field-picking here could only introduce drift
    // between what a live viewer sees and what a reloading one reads off `GET /runs/:id`.
    runNeedsCredentials: (_id, info) => emit('needs_credentials', { ...info }),
    runOutputChunk: (_id, info) => emit('step_output_chunk', { stepIndex: info.stepIndex, stream: info.stream, chunk: info.chunk }),
  };
}

const defaultDeps: RuntimeDeps = { now: () => Date.now(), genId: () => randomUUID() };

/**
 * The CLIENT-FAULT status a thrown error is claiming, or undefined when it is not claiming one
 * (E5 review F3). `http-errors` — and Express's own internals, which use it — put the code on
 * `status` and mirror it on `statusCode`. Only 4xx counts: a thrown 5xx is a server fault and goes
 * down the INTERNAL path with a full error log, exactly as before.
 */
function statusOfError(err: unknown): number | undefined {
  const e = err as { status?: unknown; statusCode?: unknown } | null;
  for (const raw of [e?.status, e?.statusCode]) {
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 400 && raw < 500) return raw;
  }
  return undefined;
}

/** The shared ErrorCode whose canonical status is `status`, derived FROM the contract table so the
 *  two cannot drift. An unmapped 4xx (405, 406, …) degrades to VALIDATION_FAILED rather than being
 *  answered as a server error — a client fault stays a client fault. */
function errorCodeForStatus(status: number): ErrorCode {
  const match = (Object.entries(ERROR_STATUS) as Array<[ErrorCode, number]>).find(([, s]) => s === status);
  return match ? match[0] : 'VALIDATION_FAILED';
}

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

/**
 * S1 (findings.md `artifact-backend-runtime-never-wired`): the process-wide artifact-backend
 * runtime the app factory registers. Tracked here so a re-composed factory (tests build the app
 * repeatedly in one process) and the boot shutdown both retire the SAME instance instead of
 * orphaning worker threads behind a replaced singleton.
 */
let artifactBackendRuntime: WorkerThreadRuntime | null = null;

/** Dispose the registered artifact-backend runtime and reset the singleton to the Null runtime
 *  (fail-closed: post-teardown invokes answer "not initialised", never a dead worker). Called on
 *  the boot shutdown path beside the other teardown; exported so the composition test can drive
 *  the same teardown the process runs. */
export async function disposeArtifactBackendRuntime(): Promise<void> {
  const rt = artifactBackendRuntime;
  artifactBackendRuntime = null;
  if (!rt) return;
  setArtifactBackendRuntime(new NullArtifactBackendRuntime());
  await rt.dispose();
}

/** FIXED-4: the one line of prompt prose the artifact-backend model seam owns, as a TS constant.
 *  Carried behavior from the old adapter's language pin - the backend `llm.*` capability forwards
 *  the app's language preference, and a PT app must not drift into English replies. */
function backendModelLanguageLine(language?: string): string {
  if (!language || language === 'en') return '';
  const label = language === 'pt' ? 'European Portuguese (português de Portugal, PT-PT)' : language;
  return `Respond ONLY in ${label}. Code identifiers may remain in English.`;
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
      const orgId = user?.orgId;
      const cfg = orgId ? await findConfigForOwner(orgId, userId, key) : null;
      if (orgId && cfg && (cfg as { enabled?: boolean }).enabled !== false) {
        // A2: the knowledge body is resolved TENANT-SCOPED under the requesting user's own org, so
        // a tenant that authored its own package serves ITS SKILL.md, not the shipped one.
        // C3: and the integration's accumulated LESSONS are appended under one heading. BOTH
        // halves come from the PROMPT views (`resolveSkillMd` / `lessonsForPrompt`), which are
        // scrubbed and cross-org-safe; the byte-exact views exist only for the editor and must
        // never be reached from here.
        // S3: and the CALLER'S OWN notes are the third section. THREE halves now, and all three
        // come from the PROMPT views: `resolveSkillMd` and `lessonsForPrompt` were already
        // scrubbed and cross-org-safe, and `feedbackForPrompt` is scrubbed, capped and keyed by
        // this actor's own org AND user id - so the notes a build/chat/automation agent sees
        // through `load_context` are the notes of the person whose run it is, never a colleague's
        // and never the org's pooled ones.
        const actor = { userId, orgId, role: 'user' as const };
        const raw = await resolveSkillMd(actor, key);
        const lessons = await lessonsForPrompt(actor, key);
        const feedback = await feedbackForPrompt(actor, key);
        const body = composeIntegrationContext(raw === null ? null : stripFrontmatter(raw), lessons, feedback);
        if (body !== null) return body;
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
    try {
      // A2: the org is now load-bearing — integration definitions in the catalog are tenant-scoped.
      // Role stays the least-privileged `user` (the previous call passed superAdmin: false).
      const catalog = await buildAutomationCatalog({ userId, orgId, role: 'user' });
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
  //    The mapping itself lives in `automation/service.ts` (`automationBackedActionHandler`) rather
  //    than inline here: which fields cross this seam is a security decision - the action's
  //    identity and the owner's write assent both ride it - and a mapping that exists only inside
  //    this function is one no test can enter through.
  const runAutomationBackedAction: AutomationBackedHandler = automationBackedActionHandler();
  /**
   * THE ONE EXECUTOR DEPS BUNDLE (slice S1), for exactly the reason the paragraph above gives for
   * `runAutomationBackedAction` itself: an executor call site that omits a seam does not fail - it
   * silently loses the behaviour that seam carries. That warning was written about the automation
   * handler, and there are four call sites. Evidence capture is a second seam with the same
   * property, so the seams are bundled ONCE here and every call site spreads the bundle rather than
   * re-listing its members; adding a third seam later cannot half-land.
   *
   * `recordActionEvidence` is the real tenant-scoped store and `collectRunEvidence` is the
   * automation-tier collector. The two halves meet HERE and nowhere else, which is what keeps
   * `integrations/` free of any import edge to `automation/` (FIXED-1).
   */
  const executorDeps: ExecutorDeps = {
    runAutomationBackedAction,
    recordActionEvidence: (key, evidence) => actionEvidenceStore.recordEvidence(key, evidence),
    collectRunEvidence: (runId) => collectRunEvidence(runId),
    // THE BUNDLE CARRIES CAPTURE SEAMS ONLY, AND NO COLLECTION SEAM (round five). Round four bound a
    // third member here - `discardOwnActionEvidence`, the reader's own collection - and called
    // `bindDefinitionEvidenceReconciler()` on the next line for the write-time one. Both are gone
    // with the collectors they fed: a run's refusal and a definition write are each one instant's
    // answer, and an evidence row is durable. Retention is decided by time
    // (`sweepScreenshotsSparingPinnedEvidence`, at boot AND on the `startRetentionSweepRail` timer),
    // by the owner's own DELETE, and by a newer validated run superseding the old sample. See
    // `integrations/action-evidence-store.ts`.
  };
  setIntegrationActionExecutor(async (call) => {
    const owner = (await users.get(call.ownerUserId)) as { orgId?: string } | null;
    // REFUSE an org-less caller (A2 review F4). Before A2 an empty orgId merely missed a credential
    // lookup; now it is the READ ACTOR, and an actor with no org matches no own row and every
    // `global` row — i.e. it would resolve an arbitrary tenant's package (and its egress origins).
    // A user with no org is a broken row, not a tenant: fail closed rather than resolve someone.
    if (!owner?.orgId) {
      return { success: false, error: 'integration unavailable: the calling user has no organisation', details: 'not_connected' };
    }
    const r = await executeUserIntegrationAction(
      {
        orgId: owner.orgId,
        ownerUserId: call.ownerUserId,
        integrationKey: call.integrationKey,
        actionName: call.actionName,
        args: call.args,
      },
      executorDeps,
    );
    return { success: r.success, data: r.data, error: r.error, details: r.code };
  });
  // 3. Platform integrations (Google/Microsoft) behind automation + listener steps.
  setPlatformIntegrationCaller(async (call, pactor) => {
    const owner = (await users.get(pactor.userId)) as { orgId?: string } | null;
    // Same fail-closed rule as the action executor above (A2 review F4): with A2 the orgId selects
    // WHICH definition resolves, so an empty one would reach every global row.
    if (!owner?.orgId) {
      return { success: false, error: 'platform integration unavailable: the calling user has no organisation' };
    }
    const r = await callPlatformIntegration(
      {
        orgId: owner.orgId,
        integrationKey: call.integrationKey,
        actionName: call.actionName,
        args: call.args,
        // THE ACTING HUMAN, forwarded so the platform write gate has an approval to look up.
        // The seam's actor is the run/step owner; without it every mutating platform action on this
        // rail would be refused as unattended and there would be no way to say yes (platform-call.ts).
        // The LISTENER supervisor's own `callPlatform` binding below deliberately forwards nothing.
        actingUserId: pactor.userId,
      },
      { now: deps.now, genId: deps.genId },
    );
    // `details: r.code` mirrors the user-defined executor binding above: the engine classes an
    // `awaiting_consent` refusal by its CODE, and dropping it here left the platform rail's refusal
    // indistinguishable from an ordinary failure (retried, and fixer-visible).
    return { success: r.success, data: r.data, error: r.error, details: r.code };
  });
  // 4. Decrypted credential fields for api_call auth injection (encrypted at rest, ch09).
  //
  // B2 (WS-C, Rule 10): this is still the LIVE read — `credentialsCiphertext` decides what the
  // api_call step interpolates, exactly as before. The Cofre item minted at connect is the SHADOW,
  // and every read compares the two so the 2026-08-15 review decides the cutover on measurements
  // rather than on hope. The comparison never changes what is returned and never throws.
  // The BODY lives in `integrations/credential-cofre.ts` (`loadIntegrationCredentialFields`), not
  // here: a lambda in the composition root cannot be exercised by a test, which is the A2 review's
  // dead-code class, and the B2 review found the consequence — the comparator sat INSIDE the
  // decrypt's `catch { return null }`, so any throw on the measurement path would have answered
  // "integration not connected". This root wires the collaborators and nothing else.
  const credentialReadDeps = {
    resolveOwnerOrgId: async (ownerUserId: string) =>
      ((await users.get(ownerUserId)) as { orgId?: string } | null)?.orgId ?? null,
    findConfig: findConfigForOwner,
    // Cofre B-4: org-bound v2 envelope; v1 rows still read (no flag day).
    decrypt: (ciphertext: string, orgId: string) => envelopeDecrypt(ciphertext, orgId),
  };
  setIntegrationCredentialLoader((integrationKey, ownerUserId) =>
    loadIntegrationCredentialFields(credentialReadDeps, integrationKey, ownerUserId),
  );
  // 4b. Bound origins for that credential (Cofre R-2, invariant I6). The api_call step writes its
  // URL from a MODEL-authored template, so the destination and the credential have independent
  // provenance — which is why the credential, not the request, must name where it may go.
  //
  // B2: RE-POINTED AT THE COFRE, and this half is NOT a shadow. When the integration's credentials
  // are a Cofre item, the allow-list is that item's own `boundOrigins` — the hosts bound in at the
  // moment the human typed the credentials — and it is EMPTY (i.e. refuse) the moment the grant is
  // revoked, which is what makes "lock = revoke" real on this rail. The previous derivation (the
  // definition's own action baseUrls, A2's tenant-scoped read) remains only as the fallback for a
  // config with no item: an integration that worked yesterday works today (Rule 7 additive).
  //
  // WHY THE CHANGE. The old allow-list was derived from the very artifact an agent or a user
  // AUTHORS, so adding an action pointing at `attacker.example` widened that credential's own
  // egress in the same edit — the authorised artifact and the authorising artifact were one file.
  // The item's binding is fixed by the connect ceremony and an authored action cannot extend it.
  setIntegrationOriginResolver((integrationKey, actor) =>
    egressOriginsForIntegration(actor, integrationKey, findConfigForOwner, deps.now()),
  );
  // 4b. The ACTION's own declaration for the credential gate (P3.1/P3.2): its resolved
  // `httpConfig.baseUrl` (the repo's one origin truth since `declaredOrigins` was deleted) and its
  // posture / attended-auth labels, which `origin-posture.ts` folds into a classification. Resolved
  // as the RUN ACTOR for exactly the reason above it: the same key names a different package per
  // org, so an unscoped read would apply one tenant's declaration to another tenant's run. A key or
  // action that resolves to nothing answers null, which classifies CLOSED.
  setIntegrationActionDeclarationResolver(async (integrationKey, actionName, actor) => {
    const def = await resolveDefinition(actor, integrationKey);
    const action = def?.actions?.find((a) => a.actionName === actionName);
    if (!action) return null;
    // Only the three fields the gate reads travel. An `IntegrationAction` also carries request
    // templates and credential wiring, and the seam's type is the statement that none of that is
    // the credential gate's business.
    return {
      ...(action.posture ? { posture: action.posture } : {}),
      ...(action.authProfile ? { authProfile: action.authProfile } : {}),
      ...(action.httpConfig?.baseUrl ? { httpConfig: { baseUrl: action.httpConfig.baseUrl } } : {}),
    };
  });
  // 4b. Slice S3 - the RUN OWNER'S OWN integration notes, for the planner and the rehearsal fixer.
  //
  // THE ORG IS RESOLVED HERE AND NOWHERE ELSE, which is the whole reason this seam takes a user id
  // alone (`automation/seams.ts`). The automation tier holds an owner user id on both callers and
  // no org; handing it one to pass back would make "whose tenant" a value a run could carry
  // wrongly, and the wrong tenant here is one org's free text landing in another's model turn. The
  // users store is the single fact, exactly as the `load_context` integration fallback resolves it.
  //
  // A user with no org row resolves to no sections rather than to a wildcard: `feedbackSectionsForOwner`
  // refuses an empty org, so an unresolvable owner reads nothing instead of everything.
  setIntegrationFeedbackResolver(async (ownerUserId) => {
    const user = (await users.get(ownerUserId)) as { orgId?: string } | null;
    const orgId = user?.orgId;
    if (!orgId) return [];
    return feedbackSectionsForOwner({ userId: ownerUserId, orgId, role: 'user' });
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
  //    A2: both definition reads are TENANT-SCOPED (the actor comes from the catalog builder), so
  //    an agent prompt only ever advertises integrations the caller may actually see. `listenerConfig`
  //    is now carried through as the SkillEntry declares it — without it the listener event-name
  //    resolution in automation/catalog.ts could never resolve and always fell back to the raw
  //    poll-action name.
  setCatalogSources({
    getVisibleSkills: async (actor) =>
      (await listDefinitionsFor(actor)).map((d) => ({
        integrationKey: d.integrationKey,
        actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
        ...(d.listenerConfig ? { listenerConfig: d.listenerConfig } : {}),
      })),
    getSkill: async (actor, integrationKey) => {
      const d = await resolveDefinition(actor, integrationKey);
      return d
        ? {
            integrationKey: d.integrationKey,
            actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
            ...(d.listenerConfig ? { listenerConfig: d.listenerConfig } : {}),
          }
        : undefined;
    },
    getConnectedPlatformAccounts: async () => [],
    listEkoaActions: async () => [],
  });
  // 9. The in-process local browser for browser-step automations (services/ shared pool).
  //
  // P4.1: the context is launched WITH the run's resolved route out. The proxy is a `newContext`
  // option and cannot be applied afterwards, which is why the resolution travels down from the run
  // loop (`automation/locality.ts` decided it; the provider only renders it).
  //
  // THE BODY IS NOT WRITTEN HERE ANY MORE, and that is deliberate: as an inline closure reaching
  // straight for `getSharedBrowser()` it was the only place a resolved route became actually-proxied
  // traffic and the only such place nothing could bind, so gutting it to a bare `newContext()` - a
  // silent datacenter run for every residential automation - was caught by no suite.
  // `localBrowserContextProviderUsing` takes the browser as an ARGUMENT, which is what makes it
  // drivable from a test; this line is now only the binding.
  //
  // AND THE BINDING ITSELF IS OBSERVED, because moving the body did not by itself make this line
  // testable - deleting it left the whole suite green, since every automation test installs its own
  // provider before touching the engine. `deps.openBrowser` (production: `getSharedBrowser`) is how
  // `tests/automation/composition-root-locality.test.ts` drives THIS line with a recording browser
  // and asserts the proxy actually reaches `newContext`.
  setLocalBrowserContextProvider(localBrowserContextProviderUsing(deps.openBrowser ?? getSharedBrowser));
  // 9b. The org's machines, for egress selection (Cofre WS-I). `egressCandidatesForOrg` already
  // returns the INTERSECTION of what each machine advertises and what the org granted (I-3), which
  // is the only list selection may ever see — an advertisement is a self-assertion, not an
  // authorisation. That now covers the ADDRESS as well as the capability: a machine whose
  // advertised endpoint is not the one the org's grant names is not a residential candidate and
  // carries no endpoint at all. Org-scoped by construction: a foreign machine is not a candidate.
  //
  // BINDING IT IS WHAT LETS `[]` MEAN SOMETHING. The seam answers `EgressCandidate[] | null`, and
  // only a resolver that actually asked the registry may say `[]` - "this org has no machines",
  // which halts a run TERMINALLY rather than waiting for hardware that does not exist. The unbound
  // default says `null` (ignorance) precisely so a half-wired process cannot make that claim - and
  // deleting this line restored that ignorance with the whole suite still green, which is why
  // `tests/automation/composition-root-locality.test.ts` now asserts the `[]` an unbound seam
  // cannot produce.
  setEgressCandidateResolver((orgId) => egressCandidatesForOrg(orgId));
  // 10. THE DAEMON SEAM (Cofre J-1 wiring). This is a SECURITY EVENT, not plumbing: the moment it
  // is wired, `local_command` and daemon-driven browser steps become reachable end to end, and
  // every latent I5/I9 defect in that path goes live. The plan gates it explicitly — "J-1 must not
  // land before H-1, H-4, J-4 and J-7" — and all four are in:
  //   H-1  value-keyed redaction on every model-bound and log-bound stream
  //   H-4  ingress redaction, so a step echoing a delivered credential is filtered before it
  //        reaches the run record, the SSE stream or the model
  //   J-4  the I9 primitive; `envWhitelist` DELETED, so nothing reads this server's own env
  //   J-7  the write flag is no longer the model's to assert, and command shapes bind to the exact
  //        command rather than a wildcard class
  //
  // What is deliberately NOT granted here: the resolver hands back a connection for any live
  // socket, and the connection then refuses every step the ORG has not granted that machine (I-3,
  // re-read per step), so wiring the seam does not by itself authorise anything. A fleet with no
  // capability grants stays exactly as inert as it was before this line existed - the difference is
  // that granting one now works.
  //
  // This comment used to say the RESOLVER only returns a connection when the capability is granted.
  // It never did, and could not: the resolver is handed an owner, not a step, so it does not know
  // which capability to ask about. The check is per STEP, inside the connection, and it is the
  // FIRST thing `runStep` does - before the credential delivery, which is the ordering that was
  // wrong (`isCapabilityGranted` below is what fixes it, and `invokeTool` re-checks behind it).
  //
  // The step dispatch itself lives in `bridge/daemon-step-seam.ts` - extracted so it can be
  // imported and asserted on, which is how four defects that were invisible here got closed: a
  // browser step dispatched under `local.filesystem` (it is `desktop.automation`), the per-step
  // screenshot dropped on the floor, a secret-delivery pair with no production caller, and a
  // credential decrypted and shipped to a machine the org had never authorised.
  setDaemonConnectionResolver((ownerUserId: string) => {
    const conn = getConnectionByOwner(ownerUserId);
    if (!conn) return null;
    return createDaemonStepConnection(conn, {
      isCapabilityGranted,
      invoke: (input) => invokeTool(input),
      newInvocationId,
      authoriseDelivery,
      deliverSecrets: (actor, input) => deliverSecrets(actor, input),
    }) as never;
  });

  // 11. THE CREDENTIAL-ESTABLISHED OBSERVER (P3.1). Two bindings, one loop, and the direction is
  // the whole point: `cofre/` declares a notifier it calls when a credential becomes usable, and
  // `automation/` declares a resume driver it calls when a waiting run should restart. Neither
  // module imports the other — cofre sits below automation in the tier table — and this is the one
  // place they meet, exactly as the daemon seam above.
  //
  // NOT LOAD-BEARING ALONE, deliberately (plan trap T7). The waiter registry is process-local, so a
  // restart forgets it; the run is still persisted `needs_credentials`, the reloading client still
  // recovers it, and the `/cofre` establish action still drives `POST /runs/:id/resume` itself.
  // Both paths converge on `resumeRun`/`redispatchRunAwaitingCredentials`, which re-read the row.
  setCredentialEstablishedNotifier((event) => {
    onCredentialEstablished(event);
  });
  setCredentialResumeDriver(redispatchRunAwaitingCredentials);

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
        executorDeps,
      ),
    now: () => new Date(deps.now()).toISOString(),
  });

  // Schedules — the timer rail (one-time + recurring runs of a target with fixed params).
  // Injected across the seams here (ch02 §2.8): an automation target fires through the SAME
  // startRunForTrigger the delivery pipeline uses (server-trusted owner, org + private-visibility
  // re-verified at fire time, triggeredBy 'schedule'); an integration-action target fires through
  // the ONE executeUserIntegrationAction rail with the ONE runAutomationBackedAction binding, so
  // the write gate answers exactly as it does everywhere else (awaiting_consent → a `blocked`
  // run). Outcome mapping lives in schedules/supervisor.ts — these lambdas stay one-liners.
  // The loop is STARTED post-listen (below) and stopped on shutdown.
  const scheduleSupervisor = configureScheduleSupervisor({
    runAutomation: (s, t) =>
      startRunForTrigger({
        automationId: t.automationId,
        ownerUserId: s.ownerUserId,
        orgId: s.orgId,
        triggeredBy: 'schedule',
        ...(t.inputs ? { inputs: t.inputs } : {}),
      }).then(mapAutomationOutcome),
    runIntegrationAction: (s, t) =>
      executeUserIntegrationAction(
        {
          orgId: s.orgId,
          ownerUserId: s.ownerUserId,
          integrationKey: t.integrationKey,
          actionName: t.actionName,
          args: t.args ?? {},
        },
        executorDeps,
      ).then(mapIntegrationOutcome),
    // P4.1: a blocked fire is waiting on its owner, and nothing else surfaces it — `blocked` is
    // neutral against the failure ceiling by design, so without this a schedule could sit waiting
    // on a machine for weeks in silence. The per-user notifications channel (ch03 §3.6.4), the same
    // rail `usage_updated` rides. No message: the client derives its text from the code.
    notifyBlocked: ({ ownerUserId, scheduleId, runId, code }) => {
      sseManager.emit('notifications', ownerUserId, 'schedule_blocked', {
        type: 'schedule_blocked',
        scheduleId,
        runId,
        ...(code ? { code } : {}),
      });
    },
    now: () => new Date(deps.now()).toISOString(),
    genId: () => deps.genId(),
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
  // Workspace-credential seams (ch06/G8 territory). The workspace of a served app is the ORG
  // OF ITS OWNER - platform-OAuth rows are org-scoped - so the token is resolved per request
  // from the app scope the router already admitted, never from an ambient process-wide
  // connection. Not-connected stays honest (throws `not connected` / reports connected:false).
  const workspaceCredentials = createWorkspaceCredentials({
    resolveOwnerOrgId: async (ownerUserId: string) =>
      ((await users.get(ownerUserId)) as { orgId?: string } | null)?.orgId ?? null,
    oauth: { now: deps.now, genId: deps.genId },
  });
  /** The docx link/cloud ingest runs on a BUILD, whose tool calls carry an appId but no owner
   *  down to this seam, so it keeps the honest not-connected state rather than guessing whose
   *  workspace to spend. Threading the run's owner through `agents/seams.ts fetchFromCloud` is
   *  the open follow-up (docs/dev-parity.md); the direct-URL branch is unaffected and live. */
  const workspaceCloudFilesForDocx = {
    getStatus: async () => ({ google: { connected: false, needsReauth: false }, microsoft: { connected: false, needsReauth: false } }),
    getAccessToken: async (): Promise<never> => {
      throw Object.assign(new Error('Workspace cloud storage is not connected'), { code: 'not_connected' });
    },
  };

  // 2C-S5 - the three ekoa-docx agent tools (agents/sdk-tools.ts `docxToolSpecs`, mounted on
  // build runs). agents/ owns no document logic: the per-artifact document lifecycle
  // (apps/document-source.ts), the pure track-changes engine (services/docx-redline.ts) and the
  // SSRF-guarded link/cloud ingest (integrations/docx-fetch.ts, over the workspace-credential
  // seam above) reach it ONLY through this seam, wired here and nowhere else. The appId the tools
  // act on binds from the RUN (build.ts: appId = artifactId), never from a tool argument.
  const docxFetcher = createDocxFetcher(workspaceCloudFilesForDocx);
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
  app.use('/api/m365', m365ProxyRouter({ resolveAppScope, getWorkspaceGraphToken: workspaceCredentials.graphToken, verifyToken }));
  app.use('/api/app-cloud-files', appCloudFilesRouter({
    resolveAppScope,
    getStatus: workspaceCredentials.status,
    getAccessToken: workspaceCredentials.accessToken,
  }));
  app.use('/api/app-files', appFilesRouter());
  app.use('/api/app-sso', appSsoRouter({ ...deps, resolveAppScope }));
  // Served-app email plane: the app names an email-capable action, the platform runs it under the
  // OWNER's connection (and the owner's standing approval — a send is a write, so it goes through
  // the same consent gate every other platform write does). Carries its own JSON parser, so it
  // mounts here with the other raw-body served-app planes.
  const appEmailDeps: AppEmailDeps = {
    resolveAppScope,
    resolveOwnerOrgId: async (ownerUserId: string) =>
      ((await users.get(ownerUserId)) as { orgId?: string } | null)?.orgId ?? null,
    workspaceStatus: workspaceCredentials.status,
    oauth: { now: deps.now, genId: deps.genId },
  };
  app.use('/api/app-email', appEmailRouter(appEmailDeps));

  // S1 (findings.md `artifact-backend-runtime-never-wired`) - register the artifact-backend
  // WorkerThreadRuntime. Until this block existed no setArtifactBackendRuntime caller existed in
  // api/src, so the singleton stayed NullArtifactBackendRuntime and every delivery-pipeline
  // invoke (server.ts setDeliveryTargets above) answered "artifact backend runtime is not
  // initialised". Only the seams the runtime's production defaults leave inert are bound here -
  // the model capability through the llm/ public entry and the two notify deliveries - plus
  // app-data on the injected clock/id deps. resolveOwner/resolveBundlePath deliberately stay on
  // the runtime's own defaults (backend-runtime/runtime.ts defaultRuntimeDeps: artifacts store +
  // manifest sharedData + backendBundlePath), one implementation rather than a copy here (Rule 1).
  // Capability grants match exactly what tests/apps/backend-runtime.test.ts pins: appData CRUD,
  // llm.classify/llm.complete, notify.inApp, notify.email. No integration seam (runIntegration)
  // is granted.
  void disposeArtifactBackendRuntime(); // a re-composed factory retires the previous instance
  const backendAppData = new AppDataAccess(deps);
  artifactBackendRuntime = new WorkerThreadRuntime({
    now: deps.now,
    // App-data CRUD via the existing AppDataAccess seam - the same rows the served UI reads
    // (per-app scope = appId; shared scope = usr.<owner>), scoping fixed core-side by the
    // capability token (handle-rpc.ts).
    appData: backendAppData,
    // MODEL seam: the llm/ public entry, FAST by construction (completeFast cannot express a
    // higher tier). Attribution is ch06 §6.4.1 site 14 - `artifact-backend:<entrypoint>`, billed
    // to the artifact OWNER with the artifact stamped. The seam hands agentType pre-tagged
    // (handle-rpc.ts); any other value is re-tagged rather than letting a worker choose its own
    // billing vocabulary.
    callModel: async (opts) => {
      const agentType: UserWorkAgentType = opts.agentType.startsWith('artifact-backend:')
        ? (opts.agentType as `artifact-backend:${string}`)
        : `artifact-backend:${opts.agentType}`;
      const system = [opts.system, backendModelLanguageLine(opts.language)].filter(Boolean).join('\n\n');
      const res = await completeFast(
        { messages: [{ role: 'user', content: opts.message }], ...(system ? { system } : {}) },
        { kind: 'user_work', agentType, billeeUserId: opts.ownerUserId, artifactId: opts.billingArtifactId },
      );
      return res.text;
    },
    // NOTIFY in-app: the per-user notifications channel (ch03 §3.6.4) - the same rail as
    // usage_updated. Best-effort: a push failure never fails the capability (handle-rpc already
    // persisted the row in the app's _notifications collection).
    sendToUser: (userId, event) => {
      try {
        sseManager.emit('notifications', userId, event.type, event);
      } catch (err) {
        console.warn('[artifact-backend] notify push failed:', err instanceof Error ? err.message : err);
      }
    },
    // NOTIFY email: the SAME plane a served page uses (integrations/app-email.ts). sendAppEmail
    // re-resolves an email-send-capable action from the OWNER's own definitions and runs it with
    // the owner as actingUserId, so the platform write gate (consent) binds exactly as it does on
    // /api/app-email/send. The backend capability names no integration, so the first CONNECTED
    // sender is picked (preferring one not needing reauth); none connected is an honest failure.
    sendEmail: async (ownerUserId, a) => {
      const orgId = await appEmailDeps.resolveOwnerOrgId(ownerUserId);
      if (!orgId) return { success: false, error: 'app owner has no organisation' };
      const ctx: AppEmailContext = { appId: 'artifact-backend', ownerUserId, orgId };
      const senders = await listEmailIntegrations(ctx, appEmailDeps);
      const sender = senders.find((s) => s.connected && !s.needsReauth) ?? senders.find((s) => s.connected);
      if (!sender) return { success: false, error: 'no connected email integration for the app owner' };
      const res = await sendAppEmail(
        {
          integrationKey: sender.integrationKey,
          actionName: sender.actionName,
          to: a.to,
          subject: a.subject,
          body: a.body,
          ...(a.bodyContentType === 'HTML' || a.bodyContentType === 'Text' ? { bodyContentType: a.bodyContentType } : {}),
        },
        ctx,
        appEmailDeps,
      );
      return res.success ? { success: true } : { success: false, error: res.error };
    },
  });
  setArtifactBackendRuntime(artifactBackendRuntime);

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
  /**
   * The artifact BUNDLE routes are exempt for the same reason: they mount their own larger parser
   * (routes/artifacts.ts `bundleJson`), and a real app export does not fit in 1 MB - the
   * production `legal-case-manager-3` bundle is 1.34 MB of source before any app-data. Matched
   * exactly, case-insensitively, so no other artifact route widens: `/import` is a fixed path and
   * `/:id/bundle-update` is pinned by both ends with the id charset in between.
   */
  const BUNDLE_UPDATE_RE = /^\/api\/v1\/artifacts\/[a-z0-9._-]{1,100}\/bundle-update$/i;
  const isBundlePath = (path: string): boolean =>
    path.toLowerCase() === '/api/v1/artifacts/import' || BUNDLE_UPDATE_RE.test(path);
  /**
   * Served-app document extraction is exempt for the same reason: its body is base64 file bytes and
   * it mounts its own 25 MB parser (apps/app-vision-route.ts). Without this the global parser runs
   * FIRST and 413s an ordinary phone photo of an invoice, so the plane's own deliberate ~14 MB
   * ceiling - and its typed `too_large` answer - would be unreachable dead code.
   */
  const isVisionPath = (path: string): boolean => path.toLowerCase() === '/api/app-vision/extract';
  app.use((req: Request, res: Response, next: NextFunction) =>
    isGatewayPath(req.path) || isBundlePath(req.path) || isVisionPath(req.path) ? next() : globalJson(req, res, next));
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
      // LIVE DAEMON SOCKETS, which is what the field name promises. This reported
      // `sseManager.connectionCount` - the browser SSE count - so `/health` answered 1 when a
      // dashboard tab was open and 0 with a bridge genuinely connected, in both directions at
      // once. `bridgeConnectionCount()` is documented in bridge/registry.ts as this field's
      // source and had no callers.
      bridgeConnections: bridgeConnectionCount(),
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
  // WS4a - composer attachment staging (raw body + X-Filename/X-Folder, same protocol as
  // knowledge's /uploads sub-route). Chat/job runs reference the returned uploadId, never a
  // client-supplied path.
  app.use('/api/v1/uploads', uploadsRouter(deps));
  // G7 — the ekoa-local LLM gateway sub-app (ch03 §3.10; metering inside the chokepoint,
  // §6.5.4). Mounted at /api/v1/llm; the token verifier AND the per-user key verifier (S4a)
  // are injected (llm/ needs no auth/ import — the gateway takes them as deps). A user-key
  // principal bills its OWNER; the static key stays platform overhead.
  registerGateway(app, { verifyToken, verifyGatewayKey });
  // S4a — per-user gateway API keys: mint (show-once) / list / revoke, self-service.
  app.use('/api/v1/gateway-keys', gatewayKeysRouter(deps));
  // E2 — memvault ("cortex memory"): per-user markdown notes, JWT or gateway-key admission
  // (requireUserOrApiKey inside the router); state is per-user files behind the path jail.
  app.use('/api/v1/memvault', memvaultRouter(deps));
  // Cofre (WS-B B-3): credential custody. Every authorization decision lives in api/src/cofre/,
  // not the router — one place to audit, and one place for WS-K's KMS envelope to install behind.
  app.use('/api/v1/cofre', cofreRouter(deps));
  // G4 — integrations + knowledge.
  // D1: the router now also carries the PUBLIC `user-or-key` capability surface, whose execute
  // endpoint runs on the SAME gated executor as the other three rails - so it is handed the SAME
  // `runAutomationBackedAction` bound once above. Omitting it here would leave every
  // automation-backed action (citius' poll, every browser-steps action) answering
  // `automation_required` on the capability rail alone, i.e. one rail quietly behaving differently
  // from the other three. This is a WIRING argument, not a second executor: no consent check, no
  // credential read and no dispatch decision lives at this call site.
  // D3: `achieve` (execute-or-author) is on this router, so the composition root also binds the
  // AUTHORING seam. It is ONE LINE on purpose — everything that decides what gets STORED (the
  // prompt, the parse, the deterministic guardrail suite, the fork, the provisional state) lives
  // in `integrations/integration-achieve.ts`, so nothing security-relevant sits in a lambda here.
  // `emptyReply: 'unavailable'` is the planner's rule rather than the builder's: an empty reply to
  // "write me an action" is a transport failing quietly, never an action.
  const draftAction: ActionDrafter = (input) => authorWithRepair({ ...input, emptyReply: 'unavailable' });
  // S4/S5: the PLANNING seam - the reuse ladder's two upper rungs (parametrize, compose). The SAME
  // authoring core, on the same `emptyReply` rule, and ONE LINE for the same reason the line above
  // is one: the output contracts, the parsers and BOTH deterministic guardrail suites live in
  // `integrations/action-parametrize.ts` and `integrations/action-compose.ts`, so nothing that
  // decides what a model may fill in - or what may be joined against whose data - sits in a lambda
  // here.
  const planStep: PlanDrafter = (input) => authorWithRepair({ ...input, emptyReply: 'unavailable' });
  // The compose rung's DATA side, and the ONE place its tenancy is decided.
  //
  // THE UNIT IS THE OWNER, because that is the only unit `app_data` HAS for shared rows. Every read
  // in `CollectionsEngine` binds on `scope.scopeKey` - `usr.<ownerUserId>` - and `Scope.appId` is
  // never part of any query. An earlier shape of this binding looped `listArtifacts(actor)` and
  // built a `sharedScope(artifactId, art.userId)` per artifact, which was wrong twice over and is
  // the pair of holes `api/tests/security/achieve-compose-isolation.test.ts` tests 5 and 6 pin:
  //
  //   - it decided AMBIGUITY per ARTIFACT over data scoped per OWNER, so anyone owning a second app
  //     - holding anything at all, `clients` or not - saw one namespace as two sources and could
  //     never compose;
  //   - it treated "an artifact I may SEE" as "its owner's data I may READ". A peer's org-visible
  //     app resolved to `usr.<peer>`: that peer's ENTIRE owner-shared namespace, spanning apps the
  //     caller cannot see and collections the visible artifact never names. Artifact visibility is
  //     not an entitlement to its owner's rows, and a read rung that can enumerate a colleague's
  //     collections is not a reuse ladder.
  //
  // So the scope is the ACTING USER'S OWN, resolved from the verified actor and from nothing else.
  // Rule 5: per-user scoped storage, enforced here. It is exactly the scope this user's own apps
  // read and write through the served plane (`sharedScope(appId, ownerUserId)` for an app they
  // own), so the rung grants no reach their own app does not already have - and none over anybody
  // else's rows. Widening this to a colleague's app is a real product question with no answer in
  // the store today (there is no per-app dimension to grant); it is D-S5-1 in `docs/decisions.md`,
  // with a review date, not a default.
  //
  // (The MUTATION that proves this is a gate, and it was RUN rather than asserted: delete the
  // tenancy filter at the single query-binding point - drop `appId: scope.scopeKey` from
  // `CollectionsEngine.list`, and separately from `listCollectionFields`. The isolation suite reds
  // in both directions, rows and prompt names, and nothing else in the estate notices.)
  //
  // THE LISTER ANSWERS FIELDS, NOT JUST NAMES, and that is a tenancy fact as much as a prompt one:
  // the field names of the caller's own collections now go into a planning prompt, so they travel
  // under exactly the same owner-scoped binding the rows do. `listCollectionFields` binds on the
  // same `appId: scope.scopeKey` every other read uses, so a peer's field names are as unreachable
  // as a peer's rows - which the isolation suite asserts directly rather than by inference.
  const achieveCollections: AppCollections = {
    list: (actor) => automationAppData.listCollectionFields(ownerSharedScope(actor.userId)),
    read: async (actor, collection) => {
      const rows = await automationAppData.list(ownerSharedScope(actor.userId), collection);
      // ONE scope means one answer: rows, or the name is not one this caller holds. There is no
      // ambiguity to report, because there are no longer two places for a name to be found in.
      return rows.length > 0 ? { kind: 'rows', rows } : { kind: 'unknown_collection' };
    },
  };
  // The PLATFORM seam for the public capability rail. The org comes from the VERIFIED principal
  // the route already built (never from the request), and the acting user is forwarded so the
  // platform write gate has an approval to look up - the same reason the automation seam above
  // forwards one. `callPlatformIntegration` enforces that gate itself, so routing here does not
  // move the gate, only the credential custody it reads.
  const callPlatform: CapabilityContext['callPlatform'] = (input) =>
    callPlatformIntegration(
      {
        orgId: input.orgId,
        integrationKey: input.integrationKey,
        actionName: input.actionName,
        args: input.args,
        ...(input.actingUserId ? { actingUserId: input.actingUserId } : {}),
      },
      deps,
    );
  // Read side of the same custody. `platformStatus` reports the org's live connection without
  // spending a token, so the catalog and the execute answer from the same place.
  const platformConnected: CapabilityContext['platformConnected'] = async (orgId, integrationKey) => {
    const provider = integrationKey === 'google-workspace' ? 'google' : 'microsoft';
    const status = await platformStatus({ userId: '', orgId, role: 'user' }, provider);
    return status.connected;
  };
  app.use(
    '/api/v1/integrations',
    integrationsRouter({
      ...deps,
      runAutomationBackedAction,
      // Slice S1: the evidence seams, from the ONE bundle bound above rather than re-listed here -
      // this router is the fourth executor call site, and the seam-omitted-at-one-call-site failure
      // is the one the bundle exists to make impossible.
      executorEvidence: {
        recordActionEvidence: executorDeps.recordActionEvidence!,
        collectRunEvidence: executorDeps.collectRunEvidence!,
      },
      draftAction,
      planStep,
      appCollections: achieveCollections,
      callPlatform,
      platformConnected,
    }),
  );
  // ch03 §3.8.14 — the AI integration builder (chat/load/save/test).
  app.use('/api/v1/integration-builder', integrationBuilderRouter(deps));
  app.use('/api/v1/knowledge', knowledgeRouter(deps));
  // G5 — push infrastructure + triggers.
  app.use('/api/v1/triggers', triggersRouter(deps));
  app.use('/api/v1/notifications', notificationsRouter());
  // G8 — automations (§3.8.18) + the platform-integration execution layer (§3.8.15/16).
  app.use('/api/v1/automations', automationsRouter());
  // Schedules — user-or-key capability surface; run-now fires through the supervisor seam.
  app.use('/api/v1/schedules', schedulesRouter({ now: deps.now, genId: deps.genId, fireNow: (s) => scheduleSupervisor.fireNow(s) }));
  app.use('/api/v1/platform-integrations', platformIntegrationsRouter(deps));
  // The OAuth callback path is kept VERBATIM (§3.8.15): it is a registered redirect URI.
  app.use('/api/v1/oauth', oauthCallbackRouter(deps));
  // Zoho Sign OAuth popup connect (ported from ekoa-dev 09a29bb7/e620e740/d8e4538e). The grant
  // lands in the ordinary `zoho-sign` integration config - the bundle the service and the action
  // executor already read - so nothing downstream distinguishes an OAuth connect from a pasted
  // one. `integrations/` may not import `auth/`, so the admin gate and the actor projection are
  // injected here, the same shape m365-proxy.ts takes its verifier.
  app.use('/', zohoOAuthRouter({
    now: deps.now,
    genState: deps.genId,
    requireAdmin: ((req, res, next) =>
      requireAuth(req as AuthedRequest, res, () =>
        requireRole('org-admin', 'super-admin')(req as AuthedRequest, res, next))) as RequestHandler,
    actorOf: (req) => {
      const u = (req as AuthedRequest).user!;
      return { userId: u.sub, orgId: u.orgId, isAdmin: u.role === 'org-admin' || u.role === 'super-admin' };
    },
    appOrigin: process.env.EKOA_APP_ORIGIN ?? '',
    beginConnect: (actor, state, expiresAt) =>
      beginConfigOAuth(
        { userId: actor.userId, orgId: actor.orgId, role: actor.isAdmin ? 'org-admin' : 'user' },
        'zoho-sign',
        state,
        expiresAt,
        deps,
      ),
    findByState: (state, now) => findConfigByOAuthState('zoho-sign', state, now),
    persistGrant: (row, patch) => persistConfigOAuthGrant(row._id, patch),
  }));
  app.use('/api/v1/pipedream', pipedreamRouter(deps));
  // CS6 — the Caixa Citius read-only notifications sync. DASHBOARD AUTH + A DEFAULT-OFF FLAG
  // (CITIUS_SYNC_ENABLED), deliberately NOT on the user-or-key capability surface (RUN_SPEC
  // non-goal): no descriptor, no OpenAPI entry, no gateway-key admission. Mounted here so the
  // dashboard can drive it; it graduates through the integration execute endpoint, not by being
  // promoted in place. The router's own flag gate runs BEFORE requireAuth, so a disabled feature
  // answers 404 identically with and without a token.
  app.use('/api/v1/sync', syncRouter());
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

  // TERMINAL ERROR ENVELOPE for the platform API. Sibling of the F6 404 above and mounted right
  // after it — i.e. AFTER every /api/v1 router — so a throw that escapes a handler cannot reach
  // Express's default error handler, which answers text/html carrying the stack trace and
  // ABSOLUTE SERVER PATHS. (Found by the E2 review as F1: a contract-valid memvault write whose
  // permalink exceeded the filesystem's 255-byte component limit did exactly that. The 4-arg
  // handler near the top of this file is mounted BEFORE the routers and only sees body-parser
  // failures.) Scoped to /api/v1 for the same reason the 404 is: the served-app byte-compat
  // plane owns its own error behavior and its ported specs pin it.
  app.use('/api/v1', (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    // Nothing to shape once bytes are on the wire (a streaming/binary route): let Express's
    // default handler destroy the connection rather than append JSON to a partial body.
    if (res.headersSent) return next(err);
    // A CLIENT-FAULT throw carries its own 4xx status and must keep it (E5 review F3). The one
    // that actually reaches here is Express's own `decode_param`: a malformed percent-escape in a
    // path segment (`/…/%zz/x`, `/…/%e0%a4`) throws a URIError with status 400, which this handler
    // used to flatten into 500 INTERNAL — a server-fault code, and an `[api-error]` line writing
    // the attacker's raw segment into the log, for a request the client simply got wrong. The
    // pre-router body-parser shaper already honours err.status; it never sees router errors.
    const status = statusOfError(err);
    if (status !== undefined) {
      // Client fault: log at WARN, and log only the SHAPE — never the attacker-controlled path.
      console.warn('[api-error] client fault', status, err instanceof Error ? err.name : typeof err);
      return sendError(res, errorCodeForStatus(status), 'Pedido inválido.');
    }
    console.error('[api-error]', err);
    sendError(res, 'INTERNAL', 'Erro interno.');
  });

  app.use('/api', servedDataRouter(deps));
  // Served-app assistant (operator-run D1): POST /api/app-assistant, header-scoped, runs under the
  // resolved artifact owner's org + billing through the llm/ chokepoint.
  app.use('/api', appAssistantRouter());
  // Served-app document extraction: POST /api/app-vision/extract, same admission plane as the
  // assistant (owner-activation + allowance billed to the owner). Carries its OWN 25 MB parser for
  // the base64 file bytes, so it must mount BEFORE the global 1 MB parser could reject a photo -
  // Express uses the FIRST parser that runs, and the router-level one wins because this mount sits
  // ahead of any later re-parse.
  app.use('/api', appVisionRouter());
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
  // config custody (findConfigForOwner + decrypt), credential persistence (the ONE
  // rotation writer, service.persistRotatedCredentials - legacy column then WS-C shadow),
  // and (2B-S3) the requestId→proposta reverse-index write at send time (recordAgreement).
  // Built BEFORE the Adobe router so the pluggable /api/signature/send facade can route
  // `provider:'zoho-sign'` to this live backend (2B-S4 swap).
  const zohoBackend = makeZohoSignBackend({
    getOwnerOrgId: async (ownerUserId) => (await users.get(ownerUserId))?.orgId ?? null,
    findConfigForOwner,
    // B1: org-bound envelope, reads v1 rows transparently. Was flat `decrypt`, which threw on a
    // v2 config written by POST /integrations/configs (the latent unreadable-zoho-config bug).
    decrypt: (ciphertext, orgId) => envelopeDecrypt(ciphertext, orgId),
    renderHtmlToPdf,
    // BOTH STORES (B2 review H2). This lambda used to write `credentialsCiphertext` and nothing
    // else, so a shadowed zoho-shaped row went to permanent `drift` on its first token refresh and
    // a cutover would have replaced a fresh refresh_token with the connect-time one. The body is
    // `service.persistRotatedCredentials` — a function a test can drive, not a root lambda.
    persistOwnerCredentialUpdates: async (configId, ownerUserId, currentFields, updates) => {
      await persistRotatedCredentials(configId, ownerUserId, currentFields, updates);
    },
    // The WS-C comparator on the served-app signature rail (B2 review M1): a real credential read
    // that B2's "every read" claim did not actually cover.
    observeCredentialRead: (orgId, ownerUserId, config, fields) => {
      void observeCredentialShadow(
        { userId: ownerUserId, orgId, role: 'user' },
        {
          _id: config._id,
          orgId,
          integrationKey: 'zoho-sign',
          ...(config.ownerUserId !== undefined ? { ownerUserId: config.ownerUserId } : {}),
          ...(config.cofreItemId !== undefined ? { cofreItemId: config.cofreItemId } : {}),
          ...(config.credentialsCiphertext !== undefined
            ? { credentialsCiphertext: config.credentialsCiphertext }
            : {}),
        },
        fields,
      );
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

/**
 * What one pass of the retention sweep did. Named rather than inlined so `logRetentionSweep` and the
 * rail below can both take it, which is what keeps `bootState`'s `await` pinned by the compiler: the
 * counts are READ by a typed call, and neither `void sweep(...)` (type `undefined`) nor a dropped
 * `await` (type `Promise<…>`) is assignable to this.
 */
export interface RetentionSweepCounts {
  removed: number;
  scanned: number;
  pinned: number;
  evidenceRemoved: number;
}

/**
 * THE SCREENSHOT RETENTION SWEEP, JOINED TO THE EVIDENCE PINS (slice S1).
 *
 * WHY THIS IS A NAMED, EXPORTED FUNCTION AND NOT THREE LINES INSIDE `bootState`. The two halves are
 * pinned separately - `pinnedRunIdsForRetention` by the isolation suite, the sweeper's pin guard by
 * `screenshot-plane.test.ts` - and NOTHING joined them: deleting `pinnedRunIds` from the
 * `sweepExpiredScreenshots` call left the entire lane green, because `bootState` was entered by no
 * test at all. `sweepExpiredScreenshots` now REQUIRES the argument (a dropped or renamed field stops
 * compiling), and this function is the one production composition of the two halves, entered
 * directly by `tests/automation/composition-root-screenshot-pins.test.ts` against the real store and
 * a real tree. `bootState` is entered there too, so the call below is proved and not assumed.
 *
 * BEST EFFORT, AND "BEST EFFORT" MEANS SKIPPING - NOT PROCEEDING WITHOUT THE FACTS (round five).
 * (Round nine note: every "boot" in the paragraphs below now reads PASS. This function runs at boot
 * AND on the retention rail, so "the next boot collects them" would be a claim about a deploy.)
 * The previous revision of this note said the pin read "degrades to pin nothing", and the code did
 * exactly that: `.catch(() => new Set())` and then swept ANYWAY. That is the one failure mode this
 * note itself names as destroying data, written down as the design. Reproduced: a healthy pin read
 * gives {removed:1, pinned:1}; a failing one gave {removed:2, pinned:0} - every screenshot behind a
 * LIVE, unexpired evidence row deleted, across every tenant at once (the screenshot tree has
 * `<automationId>/<runId>` in it and no org), with no restore path, on a transient Mongo blip.
 *
 * SO A PIN READ THAT FAILS SKIPS THE SWEEP FOR THIS PASS. The screenshots stay one more pass -
 * bounded, recoverable, and the next pass with a healthy read collects them, at most one
 * `RETENTION_SWEEP_INTERVAL_MS` later rather than at the next deploy. It is the same
 * instant-vs-durable error as the evidence collectors round five removed: one failed read at one
 * moment must not decide the fate of data whose lifetime is durable. A sweep failure still never
 * fails boot, and never kills the rail either; the whole thing still degrades to "swept nothing" and
 * never to a throw.
 *
 * AWAITED BY `bootState`, where the first cut was fire-and-forget. `sweepOrphans` above sets the
 * precedent, and the reason is the same: an obligation that resolves after boot "finishes" is one no
 * caller can wait on and no test can observe without polling. The sweep is bounded by the run tree
 * and cannot throw, so awaiting it can delay listen but cannot prevent it.
 *
 * AND THE AWAIT IS PINNED BY THE CALL SITE, NOT BY A TEST - stated precisely because the previous
 * revision of this note claimed otherwise. No case in the pins suite could tell `await sweep(...)`
 * from `void sweep(...)`: `bootState` awaits several slower things afterwards, so the sweep always
 * finished first anyway and the mutant left 5/5 green. What actually made the binding observable was
 * `sweepExpiredScreenshots`'s REQUIRED `pinnedRunIds` option plus that suite. So the await is pinned
 * the same way - by making the mutant not compile: `bootState` READS the counts this returns, and
 * `void` has no `.removed`. That is why the log line below moved to the call site and did not stay
 * here; a result nobody reads is a result an `await` cannot be proved to have waited for.
 *
 * ── IT IS NOT A BOOT-ONLY OBLIGATION ANY MORE (round nine) ────────────────────────────────────
 *
 * `bootState` is still the first caller, but it is no longer the ONLY one: `startRetentionSweepRail`
 * below re-enters this same composition on a timer, so the retention windows this function enforces
 * stop being contingent on somebody deploying. See that function for the defect that was.
 */
export async function sweepScreenshotsSparingPinnedEvidence(
  now: () => number,
): Promise<RetentionSweepCounts> {
  // THE EVIDENCE RETENTION SWEEP RUNS FIRST, AND THE ORDER IS THE POINT (round four). An evidence
  // row that ages out here releases its screenshot pin, and releasing it BEFORE the pin set is read
  // means the run it was pinning is swept on THIS pass rather than the next one. Reversed, every
  // expiring row would grant its screenshots one extra pass's grace - a retention rule that is a
  // little bit longer than it says it is.
  //
  // AND THIS IS THE ONLY THING THAT ENDS AN ORPHANED ROW BY ITSELF (round five). Every synchronous
  // collector is gone, so TTL is the collector: a row nobody re-validates goes at
  // `EVIDENCE_RETENTION_DAYS` - plus at most one `RETENTION_SWEEP_INTERVAL_MS`, the rail's tick
  // spacing - whether or not anything ever noticed its action stopped resolving, and no vantage has
  // to be right about anything for that to be correct.
  const evidenceRemoved = await actionEvidenceStore
    .sweepExpiredEvidence({ now: now() })
    .catch((err: unknown) => {
      console.warn(`[integrations] the action-evidence retention sweep did not run: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    });
  // THE PIN READ IS A PRECONDITION OF THE SWEEP, NOT AN EMBELLISHMENT ON IT. `null` here is "we do
  // not know what is pinned", and the only safe thing to do without that knowledge is nothing: an
  // unpinned sweep deletes the screenshots behind live evidence rows, irrecoverably, for every
  // tenant. Skipping costs one PASS of retained PNGs - one tick, not one deploy. See the docblock.
  const pinnedRunIds = await actionEvidenceStore
    .pinnedRunIdsForRetention()
    .catch((err: unknown) => {
      console.warn(
        '[automation] screenshot retention: the evidence pin read failed, so the sweep is SKIPPED this '
          + `pass rather than run unpinned (it would delete screenshots behind live evidence): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });
  if (pinnedRunIds === null) return { removed: 0, scanned: 0, pinned: 0, evidenceRemoved };
  try {
    return { ...(await sweepExpiredScreenshots({ now, pinnedRunIds })), evidenceRemoved };
  } catch {
    return { removed: 0, scanned: 0, pinned: 0, evidenceRemoved };
  }
}

/** The one place a completed sweep is reported. Both callers - `bootState` and the rail - use it, so
 *  an operator reading logs cannot tell a boot sweep from a scheduled one by its shape, only by when
 *  it appeared. */
function logRetentionSweep(counts: RetentionSweepCounts): void {
  if (counts.removed > 0 || counts.pinned > 0) {
    console.log(
      `[automation] screenshot retention: removed ${counts.removed}/${counts.scanned} run dirs, `
        + `spared ${counts.pinned} pinned by evidence`,
    );
  }
  if (counts.evidenceRemoved > 0) {
    console.log(
      `[integrations] action-evidence retention: removed ${counts.evidenceRemoved} row(s) not `
        + `re-validated in ${EVIDENCE_RETENTION_DAYS} days`,
    );
  }
}

/**
 * HOW OFTEN THE RETENTION SWEEP RE-RUNS WITHOUT A RESTART.
 *
 * SIX HOURS, AND THE NUMBER IS A TRADE. It is the term that turns "at most `EVIDENCE_RETENTION_DAYS`"
 * and "at most `DEFAULT_SCREENSHOT_RETENTION_DAYS`" into "at most that, PLUS one of these", so it has
 * to be small against both windows (it is 0.25% of seven days) and large against the work: a tick
 * walks the whole `<automationId>/<runId>` tree with a `stat` per run directory, and there is nothing
 * to gain from doing that hourly to shave minutes off a 90-day bound.
 *
 * IT IS A LITERAL IN THE TEST, both ways: `the retention rail` in
 * `api/tests/automation/composition-root-screenshot-pins.test.ts` arms the rail with NO interval
 * argument - production's exact call - and asserts that nothing fires one millisecond before
 * `6 * 60 * 60 * 1000` and exactly one tick fires at it. Shortening this reddens the first assertion,
 * lengthening it reddens the second.
 */
export const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const retentionRail: {
  timer: ReturnType<typeof setInterval> | null;
  sweeping: Promise<RetentionSweepCounts | null> | null;
} = { timer: null, sweeping: null };

/**
 * ONE TICK OF THE RETENTION RAIL.
 *
 * RE-ENTRANCY-GUARDED, and not for tidiness: the screenshot half walks a filesystem tree whose size
 * grows with run volume, so a tick can outlast the interval on a big tree. Two overlapping passes
 * would both read the pin set, both `readdir` the same directories and both `rm` the same expired
 * ones - the second one racing `ENOENT`s the first one is mid-way through. A tick that arrives while
 * one is in flight therefore does NOTHING and answers `null`, the way `ScheduleSupervisor.tick` does;
 * the next interval picks it up.
 *
 * WHAT THE `catch` IS ACTUALLY FOR, stated precisely rather than left looking like the mechanism.
 * `sweepScreenshotsSparingPinnedEvidence` catches all three of its own legs, so a Mongo blip or a
 * bad `stat` cannot reach here. ONE thing can: `now()`. It is evaluated eagerly (`{ now: now() }`)
 * before any promise exists, so an injected clock that throws rejects the whole composition - and
 * this is the callback of a `setInterval`, where an unhandled rejection would repeat forever. The
 * `catch` also covers the future leg that forgets its own.
 */
export async function retentionSweepTick(now: () => number = Date.now): Promise<RetentionSweepCounts | null> {
  if (retentionRail.sweeping !== null) return null;
  const pass = (async (): Promise<RetentionSweepCounts | null> => {
    try {
      const counts = await sweepScreenshotsSparingPinnedEvidence(now);
      logRetentionSweep(counts);
      return counts;
    } catch (err) {
      console.warn(
        `[retention] the sweep tick failed; the rail stays armed and the next tick retries: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  })();
  retentionRail.sweeping = pass;
  try {
    return await pass;
  } finally {
    if (retentionRail.sweeping === pass) retentionRail.sweeping = null;
  }
}

/**
 * ARM THE RETENTION RAIL - the trigger the two retention windows were missing (round nine).
 *
 * ── THE DEFECT THIS CLOSES, STATED AS THE DEFECT IT WAS ───────────────────────────────────────
 *
 * `sweepExpiredEvidence` and `sweepExpiredScreenshots` had EXACTLY ONE caller chain between them:
 * `sweepScreenshotsSparingPinnedEvidence` -> `bootState` -> `boot()`. There was no interval, and no
 * Mongo TTL index anywhere in this repo. So both windows were contingent on a PROCESS RESTART, in a
 * deployment (`deploy/staging/docker-compose.yml`, `restart: unless-stopped`; `deploy/api.service.json`,
 * a long-lived container over a persistent volume) that is built not to restart. An api container that
 * runs six months without a deploy kept EVERY evidence row for six months - a durable capped copy of
 * one person's real third-party request and response, client names, processo numbers, invoice totals -
 * and every automation-backed row kept its `pinnedRunIds` exemption for six months with it, so the
 * per-step PNGs of authenticated client-portal sessions outlived the seven-day screenshot sweep too.
 *
 * FOUR DOCUMENTS PLUS THE SHARED DESCRIPTOR SAID "AT MOST 90 DAYS" AND MEANT "AT MOST 90 DAYS AFTER
 * SOMEBODY DEPLOYS". Round five removed every synchronous collector on the strength of "TTL is the
 * collector", and round six then enforced the CONSTANT - 90 -> 89 and 90 -> 91 both redden - without
 * enforcing the TRIGGER. Enforcing a number that nothing fires is enforcing nothing; that is the
 * lesson this function exists to carry, and it is why the pin below is a TICK and not a constant.
 *
 * ── WHY AN INTERVAL AND NOT A MONGO TTL INDEX ─────────────────────────────────────────────────
 *
 * Both were on the table and the index does not do the job:
 *
 *   1. IT WOULD ONLY COLLECT HALF. Mongo would drop the evidence row; nothing would then sweep the
 *      SCREENSHOTS the row was pinning, because that half is a filesystem walk in this process and
 *      needs a trigger of its own regardless. The window that is worst to leave un-triggered is
 *      precisely the one an index cannot reach.
 *   2. IT WOULD BE INVISIBLE TO THE PIN ORDER. `sweepScreenshotsSparingPinnedEvidence` sweeps
 *      evidence BEFORE reading the pins so an expiring row releases its screenshots in the same pass.
 *      An index deleting rows on Mongo's own schedule takes that ordering out of this process's hands.
 *   3. `validatedAt` IS A STRING. It is an ISO-8601 stamp, deliberately - it orders
 *      lexicographically, which is what lets `sweepExpiredEvidence` express its cutoff as one
 *      `deleteMany` with no materialisation. A TTL index needs a BSON `Date`, so an index means
 *      either changing the stored type or carrying a second parallel field, and CLAUDE.md rule 10 is
 *      explicit that a permanent parallel field is not a thing this repo ships.
 *
 * ── SHAPE ─────────────────────────────────────────────────────────────────────────────────────
 *
 * UNREF'D, like every other timer rail here (`listener-supervisor`, `schedules/supervisor`,
 * `events/delivery`, `knowledge/crawl/scheduler`): a six-hour handle that kept the event loop alive
 * would turn an idle process into one that will not shut down. Asserted rather than trusted -
 * `__retentionSweepTimerForTests` hands the suite the handle and it checks `hasRef()`, the same way
 * `bridge/secret-delivery.ts` exposes its own sweep handle.
 *
 * NO IMMEDIATE FIRST TICK, unlike `ScheduleSupervisor.start`. `bootState` has just awaited the very
 * same composition one line above; an immediate tick would sweep an already-swept tree.
 *
 * ARMED FROM `bootState` AND NOT FROM `boot()`'s POST-LISTEN BLOCK, which is a deliberate departure
 * from where the other three rails start, for two reasons. It has no dependence on the HTTP listener
 * (the reason delivery and the listener supervisor must wait is re-entrant calls needing a live
 * socket); and `boot()` is entered by no test in this repo, which is the exact defect class this
 * slice has already hit once - the `pinnedRunIds` argument lived in a `bootState` that no test
 * entered, and `composition-root-screenshot-pins.test.ts` exists because of it. Arming here means the
 * production line is proved by the same suite that proves the boot sweep, rather than by nothing.
 */
export function startRetentionSweepRail(opts: { now?: () => number; intervalMs?: number } = {}): void {
  if (retentionRail.timer !== null) return; // idempotent: a second boot in one process re-uses the rail
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? RETENTION_SWEEP_INTERVAL_MS;
  const timer = setInterval(() => { void retentionSweepTick(now); }, intervalMs);
  timer.unref?.();
  retentionRail.timer = timer;
}

/** Disarm the rail and wait out the pass in flight, so a shutdown cannot leave a half-finished
 *  `rm -r` of a run directory behind it. Idempotent. */
export async function stopRetentionSweepRail(): Promise<void> {
  if (retentionRail.timer !== null) {
    clearInterval(retentionRail.timer);
    retentionRail.timer = null;
  }
  const pass = retentionRail.sweeping;
  if (pass) await pass;
}

/** Test helper: the armed handle, so a suite can assert it exists and is unref'd rather than trust
 *  either. The shape `bridge/secret-delivery.ts` uses for the same purpose. */
export function __retentionSweepTimerForTests(): ReturnType<typeof setInterval> | null {
  return retentionRail.timer;
}

/** Boot the persistence + admission state (ch09 §9.7): connect fail-fast, load the
 *  activation map + revocation set, seed the founder super-admin. Then the apps/
 *  boot obligations (ch07 §7.16): registry scan + slug-index load (parallel block),
 *  featured-artifact seeding + orphan sweep (sequential migrations). */
export async function bootState(deps: RuntimeDeps = defaultDeps): Promise<void> {
  // The impeccable design plugin (mounted on build runs, agents/build.ts) ships scripts whose
  // full mode makes one metadata GET to impeccable.style for its challenger catalog. Tenant
  // builds must not contact third parties, so force the documented offline/degraded path via the
  // env every agent subprocess inherits (llm/credentials.ts buildSubprocessEnv copies process.env).
  // ||= so an operator who deliberately set either var keeps their value.
  process.env.IMPECCABLE_API_URL ||= 'http://127.0.0.1:1'; // unroutable: instant local-roll fallback
  process.env.DO_NOT_TRACK ||= '1';
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
  //
  // Slice S1 - PINNED EVIDENCE RUNS ARE SPARED. A browser-steps/bash-cli evidence row stores
  // `{runId, stepIndex}` POINTERS into a run's screenshots rather than copies, so sweeping that run
  // would leave the detail page rendering broken images and would destroy the "last validated run"
  // a promotion to `trusted` rests on. The pin set is read here (the sweeper keeps no edge to
  // `integrations/`) and is bounded to the ONE run each action's LIVE evidence names: evidence is
  // superseded wholesale, so a newly validated run releases the previous pin in the same write.
  //
  // THE RESULT IS READ, AND THAT IS WHAT PINS THE `await`. Nothing in the pins suite can distinguish
  // an awaited call from a fire-and-forget one here (boot goes on to await slower things, so the
  // sweep wins the race either way), so the distinction is made structural instead: `void` has no
  // `.removed`, so the mutant stops compiling. See the function's own note.
  const screenshotSweep = await sweepScreenshotsSparingPinnedEvidence(deps.now);
  logRetentionSweep(screenshotSweep);
  // AND THE SAME SWEEP IS NOW ARMED ON A TIMER, which is the whole point of round nine: until this
  // line, BOTH retention windows fired only on a process restart, in a deployment built not to
  // restart. Armed AFTER the one-shot above so the first tick cannot race it, and unref'd so it
  // cannot hold the process open. See `startRetentionSweepRail` for why it is here and not in
  // `boot()`'s post-listen block with the other three rails.
  startRetentionSweepRail({ now: deps.now });

  // A3 — the FROZEN legacy disk runtime tier scan (Rule-10 review 2026-08-15). REPORT-ONLY by
  // default: it persists nothing unless the operator set EKOA_IMPORT_LEGACY_RUNTIME=1 (A3 review
  // F2 — a silent boot-time global publish of author-less packages re-widened what A2 narrowed;
  // deviation from RUN_SPEC assumption 3 journaled in docs/decisions.md 2026-08-03). When opted
  // in: idempotent per key via the content-hash comparator; a changed disk file after import is
  // reported as DRIFT and never overwrites the Mongo row (Mongo wins). The importer never throws
  // (a broken directory lands in the report) and the call is guarded anyway — the legacy tier
  // must not be able to stop boot (A3 review L1).
  try {
    const legacy = await importLegacyRuntimePackages();
    if (legacy.imported.length + legacy.wouldImport.length + legacy.skipped.length + legacy.drift.length + legacy.errors.length > 0) {
      console.log(
        `[legacy-runtime-import] mode ${legacy.mode}: imported ${legacy.imported.length}, would-import ${legacy.wouldImport.length}, ` +
        `unchanged ${legacy.skipped.length}, drift ${legacy.drift.length}, errors ${legacy.errors.length}`,
      );
      for (const e of legacy.errors) console.warn(`[legacy-runtime-import] '${e.key}': ${e.error}`);
    }
  } catch (err) {
    console.warn(
      `[legacy-runtime-import] scan failed (boot continues; set ${LEGACY_IMPORT_OPT_IN_ENV} aside and inspect the directory):`,
      err instanceof Error ? err.message : err,
    );
  }

  const seedUser = process.env.EKOA_ADMIN_USERNAME;
  const seedPass = process.env.EKOA_ADMIN_PASSWORD;
  if (seedUser && seedPass) {
    // The forced rotation is the default and the only production behaviour; a local stack may
    // opt out (config gate is hard-false under NODE_ENV=production) because its Mongo is
    // ephemeral, so the prompt re-arms on every boot and breaks credential provisioning.
    await seedAdmin(seedUser, seedPass, deps, {
      forcePasswordChange: !loadConfig().seedAdminSkipsPasswordChange,
    });
  }

  // ch07 §7.16 - parallel boot block, then sequential migrations.
  await Promise.all([appRegistry.start(appRegistry.sandboxRoot), loadSlugIndex()]);
  const seeded = await seedFeaturedArtifacts();
  console.log(
    `[featured-seeder] seeded ${seeded.seeded}, refreshed ${seeded.refreshed}, orphans removed ${seeded.orphansRemoved}`,
  );

  // WS8b - the default Portuguese legal crawl-source METADATA. Idempotent per seedId; a no-op
  // once already seeded or before any super-admin exists (EKOA_ADMIN_* unset), in which case the
  // next boot retries.
  const sourcesSeeded = await seedKnowledgeSources();
  console.log(
    `[knowledge-sources-seeder] inserted ${sourcesSeeded.inserted}, skipped ${sourcesSeeded.skipped}, total ${sourcesSeeded.total}`,
  );
}

/** Post-listen, fire-and-forget obligations (ch07 §7.16): featured prebuild, the knowledge
 *  nightly refresh scheduler (WS8c - arms a timer for the next 03:00 local occurrence; never
 *  fires immediately, so it is inert within a test's lifetime even though `buildApp`-only test
 *  harnesses never call this function at all). */
export function bootPostListen(): void {
  void buildAndRegisterFeaturedArtifacts()
    .then((r) => console.log(`[featured-builder] built ${r.built}, skipped ${r.skipped}, failed ${r.failed}, registered ${r.registered}`))
    .catch((err) => console.warn('[featured-builder] prebuild failed:', err instanceof Error ? err.message : err));
  startKnowledgeScheduler();
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
        // The schedules timer rail — same post-listen rule; env kill EKOA_SCHEDULES_DISABLED=1.
        startScheduleSupervisor();
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
  // the delivery pipeline drains in-flight dispatches (the rest recovers next boot, §12.3);
  // the retention rail disarms and waits out the pass in flight, so no half-finished `rm -r` of a
  // run directory is left behind; the artifact-backend runtime terminates its worker threads (S1).
  const shutdown = () => {
    void Promise.allSettled([
      stopListenerSupervisor(),
      stopScheduleSupervisor(),
      stopRetentionSweepRail(),
      stopDelivery(),
      appBuilder.dispose(),
      appRegistry.stop(),
      disposeArtifactBackendRuntime(),
    ]).then(() => process.exit(0));
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
