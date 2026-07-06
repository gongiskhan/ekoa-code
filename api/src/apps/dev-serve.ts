/**
 * Dev-serve API (ch07 §7.4 trigger 6, carried) - local external-app development
 * only. Lets a developer register an out-of-repo project directory so the api
 * builds it with the SAME AppBuilder pipeline and serves it at /apps/<id>/ with
 * the SAME injected context - byte-identical to the served runtime, no drift.
 *
 * DISABLED in production-like environments (it serves an arbitrary local
 * directory). The old gate keyed on NODE_ENV plus the retired installation-id
 * plane; the rebuild's signal is config.nodeEnv === 'production' (the caller
 * passes `enabled` from the composition root - config policy stays there).
 */
import { Router, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appBuilder } from './builder.js';
import { appRegistry } from './app-registry.js';

const DEV_SERVE_OWNER = 'dev-external';

function isValidDevId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9._-]{1,100}$/.test(id);
}

export function devServeRouter(enabled: boolean): Router {
  const r = Router();

  const gate = (res: Response): boolean => {
    if (!enabled) {
      res.status(403).json({ error: 'dev-serve is disabled in production' });
      return false;
    }
    return true;
  };

  // POST /api/dev/register { id, dir, name? } - build + register + watch.
  r.post('/api/dev/register', async (req: Request, res: Response) => {
    if (!gate(res)) return;
    const { id, dir, name } = (req.body ?? {}) as { id?: string; dir?: string; name?: string };
    if (!isValidDevId(id)) return void res.status(400).json({ error: 'id must match [a-zA-Z0-9._-]{1,100}' });
    if (typeof dir !== 'string' || !dir.trim()) return void res.status(400).json({ error: 'dir (absolute project path) is required' });
    const projectDir = resolve(dir);
    if (!existsSync(projectDir)) return void res.status(400).json({ error: `dir not found: ${projectDir}` });
    if (!existsSync(join(projectDir, 'manifest.json'))) return void res.status(400).json({ error: `no manifest.json in ${projectDir}` });
    try {
      const build = await appBuilder.build(id, projectDir);
      await appRegistry.register(id, projectDir, DEV_SERVE_OWNER, name);
      await appBuilder.watch(id, projectDir);
      res.json({
        success: true,
        data: {
          id,
          dir: projectDir,
          url: `/apps/${id}/`,
          build: { success: build.success, errors: build.errors, warnings: build.warnings },
        },
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'dev register failed' });
    }
  });

  // POST /api/dev/unregister { id }
  r.post('/api/dev/unregister', async (req: Request, res: Response) => {
    if (!gate(res)) return;
    const { id } = (req.body ?? {}) as { id?: string };
    if (!isValidDevId(id)) return void res.status(400).json({ error: 'invalid id' });
    try {
      await appBuilder.unwatch(id);
      await appRegistry.unregister(id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'dev unregister failed' });
    }
  });

  // GET /api/dev/list - dev-serve apps only.
  r.get('/api/dev/list', (_req: Request, res: Response) => {
    if (!gate(res)) return;
    const apps = appRegistry
      .listApps()
      .filter((a) => a.userId === DEV_SERVE_OWNER)
      .map((a) => ({ id: a.id, dir: a.projectDir, name: a.name, url: `/apps/${a.id}/` }));
    res.json({ success: true, data: apps });
  });

  return r;
}
