/**
 * Served-app document-extraction plane — `POST /api/app-vision/extract`.
 *
 * The header-scoped entry a served page calls with an invoice photo or a PDF. It reuses the shared
 * served-app admission (`served-app-admission.ts`): the `X-Ekoa-App-Id` header resolves to an
 * artifact-backed app, the OWNER's activation gates the plane, and the billing allowance is checked
 * against that same owner — because this endpoint spends the owner's model budget on behalf of a
 * visitor who has no account.
 *
 * The route only gates, caps and translates. The extraction contract lives in `app-vision.ts`.
 *
 * The body carries base64 file bytes, so it gets its own parser with a raised limit — the global
 * 1 MB parser would 413 an ordinary phone photo of an invoice long before the plane's own,
 * deliberate ~14 MB ceiling could answer with a typed `too_large`.
 */
import { Router, type Request, type Response, json as expressJson } from 'express';
import { AppVisionExtractRequest, type AppVisionExtractResponse } from '@ekoa/shared';
import { allowanceMiddleware } from '../billing/index.js';
import { runOneShot, decideForTask } from '../llm/index.js';
import { parseFirstJsonObject } from '../services/json-extract.js';
import { extractPdfText } from '../services/pdf-text.js';
import { appVisionExtract, type AppVisionDeps } from './app-vision.js';
import { admitServedApp, makeAppRateLimiter, sendAppError, type ServedAppAdmission } from './served-app-admission.js';

interface VisionRequest extends Request {
  ekoaVision?: ServedAppAdmission;
}

/** Extraction is a reasoning task on a document, never a FAST classification — floored at WORKHORSE. */
const prodDeps: AppVisionDeps = {
  oneShot: runOneShot,
  decide: (message) => decideForTask(message, undefined, 'WORKHORSE'),
  extractPdfText: (bytes) => extractPdfText(bytes),
  parseJson: parseFirstJsonObject,
};

export function appVisionRouter(deps: AppVisionDeps = prodDeps): Router {
  const r = Router();
  // Tighter than the email plane's: every call here is a model call against the owner's budget,
  // and a document is not something a user submits thirty times a minute.
  const limited = makeAppRateLimiter(6, 20);
  const bodyParser = expressJson({ limit: '25mb' });

  const admit = async (req: VisionRequest, res: Response, next: () => void): Promise<void> => {
    const admission = await admitServedApp(req, res);
    if (!admission) return;
    req.ekoaVision = admission;
    next();
  };

  const admitGuarded = (req: VisionRequest, res: Response, next: () => void): void => {
    void admit(req, res, next).catch((err) => {
      console.error('[app-vision] admission failed:', err instanceof Error ? err.message : err);
      sendAppError(res, 'INTERNAL', 'Erro interno.');
    });
  };

  const allowance = allowanceMiddleware((req) => (req as VisionRequest).ekoaVision?.owner.userId);

  r.post('/app-vision/extract', bodyParser, admitGuarded, allowance, async (req: VisionRequest, res) => {
    const admission = req.ekoaVision;
    if (!admission) {
      sendAppError(res, 'INTERNAL', 'Erro interno.'); // unreachable: admit ran first
      return;
    }
    if (limited(admission.appId)) {
      sendAppError(res, 'RATE_LIMITED', 'Demasiados pedidos. Tente novamente dentro de um minuto.');
      return;
    }

    const parsed = AppVisionExtractRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendAppError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
      return;
    }

    try {
      const result: AppVisionExtractResponse = await appVisionExtract(
        { ...parsed.data, appId: admission.appId, ownerUserId: admission.owner.userId },
        deps,
      );
      // A refusal is a typed body, not an envelope: the app branches on `code`. 422 rather than 502
      // because nothing failed upstream — the input could not be extracted from.
      res.status(result.success ? 200 : 422).json(result);
    } catch (err) {
      console.error('[app-vision] extract failed:', err instanceof Error ? err.message : err);
      sendAppError(res, 'INTERNAL', 'A extração está indisponível de momento.');
    }
  });

  return r;
}
