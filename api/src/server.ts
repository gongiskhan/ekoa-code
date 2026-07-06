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
import { integrationsRouter } from './routes/integrations.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { triggersRouter } from './routes/triggers.js';
import { hooksRouter } from './routes/hooks.js';
import { notificationsRouter } from './routes/notifications.js';
import { sseManager } from './events/sse-manager.js';
import { servedDataRouter } from './apps/served-data.js';
import { servingRouter } from './apps/serving.js';
import { verifyToken } from './auth/jwt.js';
import { artifactsRouter } from './routes/artifacts.js';

export interface RuntimeDeps {
  now: () => number;
  genId: () => string;
}

const defaultDeps: RuntimeDeps = { now: () => Date.now(), genId: () => randomUUID() };

export function buildApp(config: Config, deps: RuntimeDeps = defaultDeps): Express {
  const app = express();
  app.set('env', config.nodeEnv);
  app.disable('x-powered-by');

  // Webhook ingress mounts FIRST with its own raw-body parser, BELOW/BEFORE the JSON parser,
  // so the HMAC verifier sees unmodified bytes (ch09 invariant 9 step 6).
  app.use('/hooks', hooksRouter(deps));

  app.use(express.json({ limit: '1mb' }));

  // Public health surface (ch03 §3.8.23) — field shape carried; external watchdogs depend on it.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      claudeAuth: { ok: false, configured: false },
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
  // G4 — integrations + knowledge.
  app.use('/api/v1/integrations', integrationsRouter(deps));
  app.use('/api/v1/knowledge', knowledgeRouter(deps));
  // G5 — push infrastructure + triggers.
  app.use('/api/v1/triggers', triggersRouter(deps));
  app.use('/api/v1/notifications', notificationsRouter());
  // G6 — artifacts (platform) + the byte-compatible served-app data plane (outside /api/v1).
  app.use('/api/v1/artifacts', artifactsRouter(deps));
  app.use('/api', servedDataRouter(deps));
  // Serving pipeline (ch07 §7.5-7.7): /apps/:idOrSlug/* + demo-bridge + app-health.
  // The owner-bypass token verifier is injected here (apps/ never imports auth/, ch02 §2.7).
  app.use('/', servingRouter({ verifyToken }));

  return app;
}

/** Boot the persistence + admission state (ch09 §9.7): connect fail-fast, load the
 *  activation map + revocation set, seed the founder super-admin. */
export async function bootState(deps: RuntimeDeps = defaultDeps): Promise<void> {
  await connectMongo(); // fail-fast on a bad connection string
  const allUsers = await users.find({});
  loadActivation(allUsers.map((u) => ({ userId: u._id, active: u.active })));
  await loadRevocations(Math.floor(deps.now() / 1000));
  const seedUser = process.env.EKOA_ADMIN_USERNAME;
  const seedPass = process.env.EKOA_ADMIN_PASSWORD;
  if (seedUser && seedPass) await seedAdmin(seedUser, seedPass, deps);
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
      });
    })
    .catch((err) => {
      console.error('[ekoa-api] boot failed:', err);
      process.exit(1);
    });
}

// Boot only when run directly (not when imported by the contract suite's app factory).
// Use pathToFileURL so the comparison holds under paths with spaces/non-ASCII chars and
// percent-encoding — a naive `file://${argv[1]}` would silently mismatch and never boot.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  boot();
}
