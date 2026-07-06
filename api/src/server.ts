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
import { pathToFileURL } from 'node:url';
import express, { type Express, type Request, type Response } from 'express';
import { loadConfig, type Config } from './config.js';

export function buildApp(config: Config): Express {
  const app = express();
  app.set('env', config.nodeEnv);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Public health surface (ch03 §3.8.23) — field shape carried; external watchdogs depend on it.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      claudeAuth: { ok: false, configured: false },
      clockSkewSec: 0,
      bridgeConnections: 0,
      pendingEvents: 0,
    });
  });

  // Domain routers mount here as their build phases land (G2 auth → G13).
  return app;
}

/** Boot: validate config (fail-closed), install process guards, start listening. */
export function boot(): void {
  // Process-level exception posture (carried): log and continue; never crash on a stray throw.
  process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
  process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));

  const config = loadConfig(); // throws on missing ENCRYPTION_KEY / JWT_SECRET (fail-closed)
  const app = buildApp(config);
  app.listen(config.port, () => {
    console.log(`[ekoa-api] listening on :${config.port} (${config.nodeEnv})`);
  });
}

// Boot only when run directly (not when imported by the contract suite's app factory).
// Use pathToFileURL so the comparison holds under paths with spaces/non-ASCII chars and
// percent-encoding — a naive `file://${argv[1]}` would silently mismatch and never boot.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  boot();
}
