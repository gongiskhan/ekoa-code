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
import { pathToFileURL } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import { loadConfig, type Config } from './config.js';
import { connectMongo } from './data/mongo.js';
import { users } from './data/stores.js';
import { CollectionsEngine, sharedScope } from './data/collections-engine.js';
import { loadActivation } from './data/activation.js';
import { loadRevocations } from './auth/revocation.js';
import { seedAdmin } from './auth/service.js';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { orgRouter, orgsRouter } from './routes/org.js';
import { settingsRouter } from './routes/settings.js';
import { sessionsRouter } from './routes/sessions.js';
import { memoriesRouter } from './routes/memories.js';
import { registoRouter } from './routes/registo.js';
import { billingRouter } from './routes/billing.js';
import { llmHealth, registerGateway, loadCredential } from './llm/index.js';
import { setUsageNotifier } from './billing/index.js';
import { integrationsRouter } from './routes/integrations.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { triggersRouter } from './routes/triggers.js';
import { hooksRouter } from './routes/hooks.js';
import { notificationsRouter } from './routes/notifications.js';
import { sseManager } from './events/sse-manager.js';
import { servedDataRouter } from './apps/served-data.js';
import { devServeRouter } from './apps/dev-serve.js';
import { servingRouter } from './apps/serving.js';
import { appRegistry } from './apps/app-registry.js';
import { appBuilder } from './apps/builder.js';
import { loadSlugIndex } from './apps/slug-index.js';
import { seedFeaturedArtifacts } from './apps/featured-seeder.js';
import { buildAndRegisterFeaturedArtifacts } from './apps/featured-builder.js';
import { resolveApp } from './apps/registry.js';
import { appFilesRouter } from './apps/app-files.js';
import { buildLinkRouter } from './apps/build-link.js';
import { appSsoRouter } from './integrations/app-sso.js';
import { m365ProxyRouter } from './integrations/m365-proxy.js';
import { appCloudFilesRouter } from './integrations/app-cloud-files.js';
import { adobeSignRouter } from './integrations/adobe-sign.js';
import type { ResolveAppScope } from './integrations/app-scope.js';
import { legalRouter } from './legal/router.js';
import { designTokensHandler } from './services/design-tokens.js';
import { companySpaceRouter } from './routes/company-space.js';
import { verifyToken } from './auth/jwt.js';
import { artifactsRouter } from './routes/artifacts.js';
// G7B — agent execution (ch05 + ch08): chat/job routers, the injected agent seams, and the
// boot obligations (content ingest, knowledge backfill, orphan sweep).
import { chatRouter } from './routes/chat.js';
import { jobsRouter } from './routes/jobs.js';
import {
  setAssembleAgentContext,
  setKnowledgeGrounding,
  setVerifyRunner,
  setBuildMechanics,
  sweepOrphans,
} from './agents/index.js';
import { assembleAgentContext, bootContentLoader, configureContentLoader } from './content/index.js';
import { backfillKnowledgeIndex, buildGroundingBlock } from './knowledge/index.js';
import { verifyRunner } from './apps/verify-runner.js';
import { createBuildMechanics } from './apps/build-mechanics.js';
import { logActivity } from './data/activity.js';

export interface RuntimeDeps {
  now: () => number;
  genId: () => string;
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

  // Usage push seam (§6.7, ch02 §2.8 seam 1): billing/ never imports events/, so the composition
  // root injects the notifier that pushes `usage_updated` on the billee's notifications channel.
  setUsageNotifier(usageUpdatedNotifier);

  // G7B — agent-execution seams (ch02 §2.8, ch05 §5.5/§5.6.2). agents/ codes against typed seams;
  // the composition root binds the real collaborators (structural binding is where the shapes are
  // checked). server.ts is the only file that may reach across these seams.
  setAssembleAgentContext(assembleAgentContext); // content loader (ch08 §8.3.2, ch05 §5.5.1)
  // Knowledge grounding (ch08 §8.4 slot 5): buildGroundingBlock already applies the chat-always /
  // build-only-legal rule internally, so the adapter only maps agentKind → its chat|build kind.
  setKnowledgeGrounding(async ({ orgId, query, agentKind }) =>
    buildGroundingBlock({ orgId, query, kind: agentKind === 'chat' ? 'chat' : 'build' }).block,
  );
  setVerifyRunner(verifyRunner); // per-build verification (ch07 §7.2.6)
  setBuildMechanics(createBuildMechanics(deps)); // the G6 build pipeline (ch07 §7.2-§7.4)
  // Integration pre-fetch (§5.5.2 layer 3) + automation catalog (layer 4) land at G8 — an honest
  // cross-gate deferral; both keep their safe empty defaults until then.

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

  // Raw-body served-app planes mount BEFORE the global JSON parser: their proxied/
  // uploaded bytes must arrive unconsumed (each carries its own per-route parsers).
  app.use('/api/m365', m365ProxyRouter({ resolveAppScope, getWorkspaceGraphToken: workspaceNotConnected('Microsoft workspace integration'), verifyToken }));
  app.use('/api/app-cloud-files', appCloudFilesRouter({
    resolveAppScope,
    getStatus: async () => ({ google: { connected: false, needsReauth: false }, microsoft: { connected: false, needsReauth: false } }),
    getAccessToken: workspaceNotConnected('Workspace cloud storage'),
  }));
  app.use('/api/app-files', appFilesRouter());
  app.use('/api/app-sso', appSsoRouter({ ...deps, resolveAppScope }));

  app.use(express.json({ limit: '1mb' }));

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
  app.use('/api/v1/orgs', orgsRouter(deps));
  app.use('/api/v1/settings', settingsRouter(deps));
  app.use('/api/v1/sessions', sessionsRouter(deps));
  app.use('/api/v1/memories', memoriesRouter(deps));
  app.use('/api/v1/registo', registoRouter(deps));
  app.use('/api/v1/billing', billingRouter(deps));
  // G7B — agent execution: chat runs + build/brand-research jobs (ch03 §3.8.7-8). The router
  // internal paths determine the surface: /api/v1/chat/runs, /api/v1/jobs.
  app.use('/api/v1/chat', chatRouter(deps));
  app.use('/api/v1/jobs', jobsRouter(deps));
  // G7 — the ekoa-local LLM gateway sub-app (ch03 §3.10; metering inside the chokepoint,
  // §6.5.4). Mounted at /api/v1/llm; the owner-bypass token verifier is injected (llm/ needs
  // no auth/ import — the gateway takes it as a dep). Bills wire-tier FAST per proxied call.
  registerGateway(app, { verifyToken });
  // G4 — integrations + knowledge.
  app.use('/api/v1/integrations', integrationsRouter(deps));
  app.use('/api/v1/knowledge', knowledgeRouter(deps));
  // G5 — push infrastructure + triggers.
  app.use('/api/v1/triggers', triggersRouter(deps));
  app.use('/api/v1/notifications', notificationsRouter());
  // G6 — artifacts (platform) + the byte-compatible served-app plane (outside /api/v1).
  app.use('/api/v1/artifacts', artifactsRouter(deps));
  app.use('/api/v1/company-space', companySpaceRouter(deps));
  app.use('/api', servedDataRouter(deps));
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
  }));
  app.use('/', adobeSignRouter({ resolveApp: resolveAppScope }));
  app.get('/api/design-tokens.css', designTokensHandler());
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
  loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active })));
  await loadRevocations(Math.floor(deps.now() / 1000));
  await loadCredential(); // G7: load the central model credential (§6.2; no-op when unconfigured)

  // G7B — agent-execution boot obligations (ch08 §8.3.1, ch04 §4.4.1, ch05 §5.2.1). All three are
  // resilient on a fresh/empty data directory: content ingest ensures its dirs, the knowledge
  // backfill ensures the index dir and no-ops on an already-populated index, and the orphan sweep
  // finds nothing to sweep. Ordered after connectMongo (the sweep + backfill read collections).
  await bootContentLoader();
  await backfillKnowledgeIndex();
  await sweepOrphans(deps.now);

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
      app.listen(config.port, () => {
        console.log(`[ekoa-api] listening on :${config.port} (${config.nodeEnv})`);
        bootPostListen();
      });
    })
    .catch((err) => {
      console.error('[ekoa-api] boot failed:', err);
      process.exit(1);
    });

  // Shutdown obligations (ch07 §7.16): dispose esbuild watch contexts + registry watchers.
  const shutdown = () => {
    void Promise.allSettled([appBuilder.dispose(), appRegistry.stop()]).then(() => process.exit(0));
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
