/**
 * Auth router (ch03 §3.8.1). Thin: validate against shared/, call the auth service, shape
 * the response. Login/device are public; me/refresh/logout require auth.
 */
import { Router, type Request, type Response } from 'express';
import { LoginRequest } from '@ekoa/shared';
import { login, AuthError } from '../auth/service.js';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';

export function authRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();

  r.post('/login', async (req: Request, res: Response) => {
    const parsed = LoginRequest.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Dados inválidos.', details: { issues: parsed.error.issues } } });
    }
    try {
      const { username, password, rememberMe } = parsed.data as { username: string; password: string; rememberMe?: boolean };
      const result = await login(username, password, !!rememberMe, deps);
      res.json({ token: result.token, user: result.user, passwordChangeRequired: result.passwordChangeRequired, expiresIn: result.expiresIn });
    } catch (e) {
      if (e instanceof AuthError) return res.status(e.status).json({ error: { code: e.code, message: e.message } });
      throw e;
    }
  });

  r.get('/me', requireAuth, (req: AuthedRequest, res: Response) => {
    const u = req.user!;
    res.json({ id: u.sub, username: u.username, role: u.role, orgId: u.orgId, active: true });
  });

  return r;
}
