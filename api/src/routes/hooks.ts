/**
 * Webhook ingress router (ch03 §3.8.17, ch09 invariant 9). Path kept verbatim: `/hooks/:triggerId`
 * (registered with providers). Mounted with a RAW-body parser BELOW any JSON parser so the HMAC
 * verifier sees the unmodified bytes (invariant 9 step 6). Public — auth is the HMAC signature.
 */
import { Router, type Request, type Response } from 'express';
import express from 'express';
import { handleIngress, hubChallenge } from '../events/service.js';

export function hooksRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  // Raw body for signature verification — never JSON-parsed above the verifier.
  r.use(express.raw({ type: '*/*', limit: '5mb' }));

  // GET handles Meta-style hub-challenge handshakes (timing-safe token compare).
  r.get('/:triggerId', (req: Request, res: Response) => {
    const token = process.env.WEBHOOK_HUB_VERIFY_TOKEN ?? '';
    const challenge = hubChallenge(req.query as Record<string, unknown>, token);
    if (challenge !== null) return res.status(200).send(challenge);
    res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid handshake.' } });
  });

  r.post('/:triggerId', async (req: Request, res: Response) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const signature =
      (req.header('x-hub-signature-256') ?? req.header('x-signature') ?? req.header('x-webhook-signature') ?? undefined) as string | undefined;
    const result = await handleIngress(req.params.triggerId as string, raw, signature, deps);
    res.status(result.status).json(result.body);
  });

  return r;
}
