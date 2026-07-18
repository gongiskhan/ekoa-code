/**
 * Portal connector records (BRIEF §8 Part E, run 20260717-190134-9d4c1cbf, slice E1).
 * ONE normalized portal-document record and ONE portal-event record for EVERY portal
 * connector - the open-data (no sign-in) connectors this run add (E2 certidão comercial,
 * E3 certidão predial/registo civil, E4 insolvência watcher, E5 DGSI/DRE verify-only) and
 * the signed-in connectors of the follow-up run (Citius rebuild, Portal das Finanças, BNI,
 * RCBE, IRN services). The follow-up connectors EXTEND these shapes (new `source`/`kind`
 * values, extra fields riding `.passthrough()`) - they never redesign them (FLOW_PLAN
 * "Structural decisions"; `analysis/08-portal-audit.md` "Part E pins" #1). Lowest viable
 * tier: no discriminated unions per source, no connector-specific subtypes here.
 */
import { z } from 'zod';
import { IsoTimestamp } from './common.js';

/**
 * The app-files/documentos file-reference shape. No shared `FileRef` schema exists yet
 * (every legal descriptor was `z.unknown()` before this file - 08-portal-audit.md pin 1);
 * this mirrors the `ficheiro` object DocumentosTab.jsx:287-305 already writes on upload
 * (`{ fileId, appId, url, mime, size }`), so a portal-retrieved document attaches through
 * the SAME shape the existing UI already renders.
 */
export const PortalFileRef = z.object({
  fileId: z.string(),
  appId: z.string(),
  url: z.string(),
  mime: z.string(),
  size: z.number(),
});
export type PortalFileRef = z.infer<typeof PortalFileRef>;

/** The open-data (no-sign-in) sources this run's connectors cover (BRIEF §8 scope 1-5).
 *  Signed-in follow-up sources are NOT enumerated here - the follow-up brief extends this
 *  enum, it does not redesign the record around it. */
export const PortalSource = z.enum([
  'certidao-comercial',
  'certidao-predial',
  'certidao-civil',
  'citius-insolvencia',
  'dgsi',
  'dre',
]);
export type PortalSource = z.infer<typeof PortalSource>;

/**
 * One retrieved portal document, normalized the same way regardless of source. `type` is
 * a free-form connector-supplied label (e.g. "certidao-permanente"); `subjectIds` are the
 * NIFs/names/codes the document concerns; `parsed` carries the structured record a
 * connector extracted (e.g. the company/property fields) - optional because a verify-only
 * connector (E5, DGSI/DRE) never produces one. `.passthrough()`: the signed-in follow-up
 * connectors extend this record with extra fields without a schema break (assertion in
 * shared/src/contract.test.ts).
 */
export const PortalDocument = z
  .object({
    source: PortalSource,
    type: z.string(),
    subjectIds: z.array(z.string()),
    retrievedAt: IsoTimestamp,
    fileRef: PortalFileRef,
    parsed: z.object({}).passthrough().optional(),
  })
  .passthrough();
export type PortalDocument = z.infer<typeof PortalDocument>;

/** `document.retrieved` covers a connector attaching a document (E2/E3); `watch.hit`
 *  covers a polling watcher match (E4, e.g. a new Citius insolvência publication). */
export const PortalEventKind = z.enum(['document.retrieved', 'watch.hit']);
export type PortalEventKind = z.infer<typeof PortalEventKind>;

/**
 * One portal-originated dossiê event. `dossierRef` is a `processos` row id on the
 * shared owner-spine - there is no first-class case/matter entity in the platform data
 * model (08-portal-audit.md Part 3), so the dossiê IS the `processos` row. `payload` is
 * passthrough so a watcher can mirror its source-specific hit shape verbatim (e.g.
 * Citius' `CitiusPublicacao`, `api/src/legal/citius.ts`) without a translation schema.
 */
export const PortalEvent = z
  .object({
    source: PortalSource,
    kind: PortalEventKind,
    subjectRef: z.string(),
    dossierRef: z.string(),
    observedAt: IsoTimestamp,
    payload: z.object({}).passthrough(),
  })
  .passthrough();
export type PortalEvent = z.infer<typeof PortalEvent>;

/** GET /api/legal/portal response (the E1 read surface): a dossiê's portal-sourced
 *  documents + events, so the legal-dossie served app can render them (BRIEF §8 gate). */
export const PortalDossierRecordsResponse = z.object({
  documentos: z.array(PortalDocument),
  eventos: z.array(PortalEvent),
});
export type PortalDossierRecordsResponse = z.infer<typeof PortalDossierRecordsResponse>;

/**
 * POST /api/legal/portal/certidao (mega-run E2/E3, BRIEF §8 items 1-3): retrieval-by-
 * access-code for the three open-data certidão sources this run's connectors cover. A
 * strict subset of `PortalSource` (`.extract`, zod ≥3.20) - keeps the request enum in
 * lockstep with the record enum without a second literal list to drift.
 *
 * `accessCode` and `subjectIds` are ORDINARY client-supplied dossiê fields (BRIEF §8
 * constraint 0), never secrets: `accessCode` authenticates to the EXTERNAL portal only
 * and is never written into a stored record, a log line, or an audit row
 * (api/src/legal/portal-connectors.ts never persists it).
 */
export const PortalCertidaoSource = PortalSource.extract(['certidao-comercial', 'certidao-predial', 'certidao-civil']);
export type PortalCertidaoSource = z.infer<typeof PortalCertidaoSource>;

export const PortalCertidaoRequest = z.object({
  source: PortalCertidaoSource,
  accessCode: z.string().min(1),
  processoId: z.string().min(1),
  subjectIds: z.array(z.string()).default([]),
});
export type PortalCertidaoRequest = z.infer<typeof PortalCertidaoRequest>;

/** 200 response: the structured record the connector parsed (shape varies by source -
 *  passthrough, same "no discriminated unions" pin as `PortalDocument.parsed`) plus the
 *  `PortalDocument` the retrieval attached to the dossiê. */
export const PortalCertidaoResponse = z.object({
  ok: z.literal(true),
  source: PortalCertidaoSource,
  record: z.object({}).passthrough(),
  document: PortalDocument,
});
export type PortalCertidaoResponse = z.infer<typeof PortalCertidaoResponse>;
