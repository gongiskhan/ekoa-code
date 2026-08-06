/** Served-app document-extraction contract — `POST /api/app-vision/extract`.
 *
 * A served app sends a document and gets back structured fields. The point of the endpoint is that
 * nobody wants to retype an invoice, and the point of THIS contract is that the app never receives
 * the model's prose — only parsed JSON, or a typed refusal it can act on.
 *
 * `data` is deliberately `unknown`: the shape depends on `kind`, the model is instructed to produce
 * it, and pinning it here would turn every prompt refinement into a breaking contract change. What
 * IS pinned is the envelope — success, a machine-readable failure code, and nothing else. In
 * particular the raw reply never appears on the wire.
 */
import { z } from 'zod';
import type { DomainDescriptorMap } from './descriptor.js';

/** What the caller is asking to have read. Drives the extraction schema the model is held to. */
export const AppVisionExtractKind = z.enum(['invoice', 'bank-statement']);
export type AppVisionExtractKind = z.infer<typeof AppVisionExtractKind>;

/**
 * Why an extraction did not produce data.
 *
 * `no_text_layer` is the one that matters: the PDF is a SCAN, so there is nothing to read, and the
 * app should ask the user to photograph the document instead (which routes to the vision branch and
 * works). It is a refusal with an instruction attached, not a failure.
 */
export const AppVisionFailureCode = z.enum([
  'invalid_input',
  'too_large',
  'no_text_layer',
  'parse_failed',
  'llm_error',
]);
export type AppVisionFailureCode = z.infer<typeof AppVisionFailureCode>;

export const AppVisionExtractRequest = z
  .object({
    kind: AppVisionExtractKind,
    /** Base64 image bytes, NO `data:` prefix. Exactly one of imageBase64 / pdfBase64. */
    imageBase64: z.string().optional(),
    mediaType: z.string().optional(),
    /** Base64 PDF bytes, NO `data:` prefix. */
    pdfBase64: z.string().optional(),
    language: z.enum(['pt', 'en']).optional(),
  })
  .refine((v) => !!v.imageBase64 !== !!v.pdfBase64, {
    message: 'Indique exatamente um de imageBase64 / pdfBase64.',
  });
export type AppVisionExtractRequest = z.infer<typeof AppVisionExtractRequest>;

export const AppVisionExtractResponse = z.object({
  success: z.boolean(),
  /** The extracted object. Shape follows `kind`; unconstrained here on purpose (see the header). */
  data: z.unknown().optional(),
  error: z.string().optional(),
  code: AppVisionFailureCode.optional(),
});
export type AppVisionExtractResponse = z.infer<typeof AppVisionExtractResponse>;

export const appVisionEndpoints = {
  visionExtract: {
    method: 'POST',
    path: '/api/app-vision/extract',
    auth: 'header-scoped',
    request: AppVisionExtractRequest,
    response: AppVisionExtractResponse,
    // A refusal is a 422 carrying the same typed body — the app reads `code`, not the status.
    successStatus: [200, 422],
  },
} as const satisfies DomainDescriptorMap;
