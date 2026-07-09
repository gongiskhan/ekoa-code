/**
 * Auth router (ch03 §3.8.1, F1 lifecycle). Thin: validate against shared/, call the auth
 * service/device flow, shape the response. Public: login, device start/poll. Authed: me,
 * refresh, logout, password, device/approve.
 */
import { Router, type Request, type Response } from 'express';
import { LoginRequest, ChangePasswordRequest, DevicePollRequest, DeviceApproveRequest, LogoutRequest } from '@ekoa/shared';
import { login, changePassword, logoutSelf, logoutOther, AuthError } from '../auth/service.js';
import { signToken } from '../auth/jwt.js';
import { startDeviceAuth, pollDeviceAuth, approveDeviceAuth } from '../auth/device.js';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { sendError, parseBody } from './helpers.js';

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

  // F1: re-sign the verified claims (a fresh jti — the old token stays valid to ITS expiry;
  // no rotation redesign per the brief's non-goals).
  r.post('/refresh', requireAuth, (req: AuthedRequest, res: Response) => {
    const u = req.user!;
    const { token, expiresIn } = signToken(
      { sub: u.sub, role: u.role, scope: u.scope, orgId: u.orgId, username: u.username, jti: `${u.sub}.${deps.genId()}` },
      false,
    );
    res.json({ token, expiresIn });
  });

  // F1: logout. Self: revoke the CALLER's jti. Admin variant { userId }: super-admin anywhere,
  // org-admin scoped to its own org — enforced in the service (the static auth class cannot
  // express "user for self, admin for others"; shared/src/auth.ts logout note).
  r.post('/logout', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, LogoutRequest, req.body ?? {});
    if (body === undefined) return;
    const caller = req.user!;
    const targetId = body.userId && body.userId !== caller.sub ? body.userId : undefined;
    if (!targetId) {
      await logoutSelf(caller, deps);
      return res.json({ ok: true });
    }
    const outcome = await logoutOther(caller, targetId);
    if (outcome === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão para terminar a sessão de outro utilizador.');
    if (outcome === 'not-found') return sendError(res, 'NOT_FOUND', 'Utilizador não encontrado.');
    res.json({ ok: true });
  });

  // F1: self password change — verify current, store new, clear passwordChangeRequired.
  r.post('/password', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ChangePasswordRequest, req.body);
    if (body === undefined) return;
    try {
      await changePassword(req.user!.sub, body.currentPassword, body.newPassword);
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof AuthError) return res.status(e.status).json({ error: { code: e.code, message: e.message } });
      throw e;
    }
  });

  // F1 device flow (shared deviceStart/devicePoll/deviceApprove; mongo-backed, single-use).
  r.post('/device', async (_req: Request, res: Response) => {
    res.json(await startDeviceAuth(deps));
  });

  r.post('/device/poll', async (req: Request, res: Response) => {
    const body = parseBody(res, DevicePollRequest, req.body);
    if (body === undefined) return;
    res.json(await pollDeviceAuth(body.deviceCode, deps));
  });

  r.post('/device/approve', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, DeviceApproveRequest, req.body);
    if (body === undefined) return;
    const ok = await approveDeviceAuth(body.userCode, req.user!.sub, !!body.deny, deps);
    if (!ok) return sendError(res, 'NOT_FOUND', 'Código de dispositivo inválido ou expirado.');
    res.json({ ok: true });
  });

  return r;
}
