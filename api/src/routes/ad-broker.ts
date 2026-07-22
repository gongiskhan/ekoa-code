/**
 * ad-broker router — POST /api/v1/ad-broker/search. A machine-to-machine surface for an Apify
 * actor to page the Meta Ad Library (stubbed data source; see ../ad-broker/service.ts).
 *
 * Auth is a static API key (x-api-key == config.adBrokerApiKey), the gateway.ts precedent — a
 * machine has no JWT/org/activation/billing to admit. The compare is constant-time and FAIL-CLOSED:
 * an unset AD_BROKER_API_KEY means everyone gets 401, never an open endpoint. Thin-router shape is
 * unchanged: validate (shared/ zod) → one domain call → shape.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AdSearchRequest } from '@ekoa/shared';
import { loadConfig } from '../config.js';
import { sendError, parseBody } from './helpers.js';
import { searchAds, AdBrokerError } from '../ad-broker/service.js';

/** Constant-time string compare; a length mismatch short-circuits (timingSafeEqual throws on
 *  unequal-length buffers) — the only timing signal it leaks is length, which is not secret. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** x-api-key admission. Fail-closed: no configured key ⇒ 401 for everyone. */
function requireBrokerKey(req: Request, res: Response, next: NextFunction): void {
  const configured = loadConfig().adBrokerApiKey;
  const provided = req.headers['x-api-key'];
  if (!configured || typeof provided !== 'string' || !safeEqual(provided, configured)) {
    sendError(res, 'UNAUTHENTICATED', 'Chave de API inválida ou em falta.');
    return;
  }
  next();
}

export function adBrokerRouter(_deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireBrokerKey);

  r.post('/search', (req: Request, res: Response) => {
    const body = parseBody(res, AdSearchRequest, req.body);
    if (!body) return;
    try {
      res.json(searchAds(body));
    } catch (e) {
      if (e instanceof AdBrokerError) return sendError(res, e.code, e.message);
      throw e;
    }
  });

  return r;
}
