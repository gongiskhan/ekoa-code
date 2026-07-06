/**
 * Settings router (ch03 §3.8.5). Persistence via the platform-crud service (ch02 §2.7).
 */
import { Router, type Response } from 'express';
import { PlatformSettingsPatch, UserSettingsPatch } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { mergedSettings, patchOrgSettings, patchUserSettings } from '../services/platform-crud.js';
import { actorOf, parseBody } from './helpers.js';

export function settingsRouter(_deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', async (req: AuthedRequest, res: Response) => {
    const a = actorOf(req);
    res.json(await mergedSettings(a.userId, a.orgId));
  });

  r.patch('/', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    const a = actorOf(req);
    const body = parseBody(res, PlatformSettingsPatch, req.body);
    if (!body) return;
    await patchOrgSettings(a.orgId, body as Record<string, unknown>);
    res.json(await mergedSettings(a.userId, a.orgId));
  });

  r.patch('/me', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, UserSettingsPatch, req.body);
    if (!body) return;
    const a = actorOf(req);
    await patchUserSettings(a.userId, body as Record<string, unknown>);
    res.json(await mergedSettings(a.userId, a.orgId));
  });

  return r;
}
