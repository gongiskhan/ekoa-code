/**
 * Sheets domain contract (Part B decision B.B, run 20260717-190134): sheets are per-session
 * subdocuments {sheetId, title, createdFromMessageId, revisions[]} living ON the session
 * record - no collection of their own. Legacy sessions carry no sheets; the api derives a
 * one-sheet-per-assistant-message view at read time, so these schemas describe BOTH stored
 * and derived sheets. The revision array is plain (decision B.C: artifact versioning is NOT
 * reused). The zod consts are Sheet / SheetRevision ("Revision" alone would be too vague in
 * the flat shared/ export namespace).
 */
import { z } from 'zod';
import { Id, IsoTimestamp, itemsResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const SheetRevision = z
  .object({
    revisionId: Id,
    /** Markdown body of the sheet at this revision. */
    content: z.string(),
    createdAt: IsoTimestamp,
    /** Username of the editor. Present on user edits; agent revisions omit it. */
    editedBy: z.string().optional(),
    editSource: z.enum(['agent', 'user']),
    /** The edit instruction that produced this revision (user edits). */
    instruction: z.string().optional(),
  })
  .passthrough();
export type SheetRevision = z.infer<typeof SheetRevision>;

export const Sheet = z
  .object({
    sheetId: Id,
    title: z.string(),
    /** The assistant message this sheet was created from (the back-reference of B.B). */
    createdFromMessageId: Id,
    /** Ordered oldest-first; the LAST entry is the canonical (latest) revision. */
    revisions: z.array(SheetRevision).min(1),
  })
  .passthrough();
export type Sheet = z.infer<typeof Sheet>;

export const SheetListResponse = itemsResponse(Sheet);
export type SheetListResponse = z.infer<typeof SheetListResponse>;

export const SheetRenameRequest = z.object({ title: z.string().min(1) });
export type SheetRenameRequest = z.infer<typeof SheetRenameRequest>;

/** A user edit. `editSource`/`editedBy`/`createdAt` are stamped server-side, never claimed. */
export const SheetRevisionCreateRequest = z.object({
  content: z.string().min(1),
  instruction: z.string().optional(),
});
export type SheetRevisionCreateRequest = z.infer<typeof SheetRevisionCreateRequest>;

export const sheetsEndpoints = {
  list: {
    method: 'GET',
    path: '/api/v1/sessions/:id/sheets',
    auth: 'user',
    response: SheetListResponse,
  },
  rename: {
    method: 'PATCH',
    path: '/api/v1/sessions/:id/sheets/:sheetId',
    auth: 'user',
    request: SheetRenameRequest,
    response: Sheet,
  },
  createRevision: {
    method: 'POST',
    path: '/api/v1/sessions/:id/sheets/:sheetId/revisions',
    auth: 'user',
    request: SheetRevisionCreateRequest,
    response: Sheet,
  },
} as const satisfies DomainDescriptorMap;
