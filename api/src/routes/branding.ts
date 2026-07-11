/**
 * Branding router (F4, ch03 §3.8.4). The contract declares `PUT /api/v1/branding` and
 * `POST /api/v1/branding/research`; only `PUT /api/v1/org/branding` was ever mounted, so both
 * contract paths returned Express HTML 404 and the brand-research journey failed at step one.
 *
 * The save handler is the SAME handler the org router mounts — exported and reused, never
 * duplicated (the brief's non-goal). Research enqueues the existing `agents/brand-research.ts`
 * job: no new LLM egress path, the agent reaches the model through the llm/ chokepoint as before.
 */
import { Router, type Response } from 'express';
import { BrandingResearchRequest } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { runBrandResearch } from '../agents/brand-research.js';
import { assertSafeUrl, SsrfError } from '../services/url-safety.js';
import { saveBrandingHandler } from './org.js';
import { actorOf, parseBody, sendError } from './helpers.js';

export function brandingRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  // The contract path for the branding save (alias of PUT /api/v1/org/branding — one handler).
  r.put('/', requireRole('org-admin', 'super-admin'), saveBrandingHandler);

  r.post('/research', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, BrandingResearchRequest, req.body);
    if (body === undefined) return;
    // Normalise a scheme-less host to https:// so the guard (and the pipeline's fetch) get a full
    // URL. SSRF guard (ch09 invariant 8): url-safety.ts names the brand-research target as a URL
    // the platform must guard - the pipeline's deterministic server-side fetches all re-guard, but
    // reject an unsafe target at the boundary too so no job is even created for one.
    const websiteUrl = /^https?:\/\//i.test(body.websiteUrl) ? body.websiteUrl : `https://${body.websiteUrl}`;
    try {
      assertSafeUrl(websiteUrl);
    } catch (e) {
      if (e instanceof SsrfError) return sendError(res, 'VALIDATION_FAILED', 'URL não permitido.');
      throw e;
    }
    const actor = actorOf(req);
    // The structured instructions live in the agent's system prompt (agents/brand-research.ts);
    // the user turn carries only the research target.
    const prompt = `URL do sítio web a investigar: ${websiteUrl}`;
    const { jobId, fire } = runBrandResearch({ actor, prompt, websiteUrl, language: 'pt', deps });
    fire(); // fire-and-forget: the job streams its progress on the jobs channel
    res.status(202).json({ jobId }); // BrandingResearchResponse — not a job envelope
  });

  return r;
}
