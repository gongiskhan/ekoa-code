/**
 * Thin-route helpers (ch02 §2.6): actor extraction from the verified JWT, uniform error
 * shaping (CONV-2), and zod request validation. Routers do exactly three things: validate,
 * call one domain module, shape the response.
 */
import type { Response } from 'express';
import type { ZodTypeAny, infer as zInfer } from 'zod';
import { ERROR_STATUS, type ErrorCode, type Actor } from '@ekoa/shared';
import type { AuthedRequest } from '../auth/middleware.js';

export function actorOf(req: AuthedRequest): Actor {
  const u = req.user!;
  return { userId: u.sub, orgId: u.orgId, role: u.role };
}

export function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
}

export function notFound(res: Response): void {
  sendError(res, 'NOT_FOUND', 'Não encontrado.');
}

/** Validate req.body against a schema; on failure send 400 and return undefined. */
export function parseBody<S extends ZodTypeAny>(res: Response, schema: S, body: unknown): zInfer<S> | undefined {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
    return undefined;
  }
  return parsed.data as zInfer<S>;
}
