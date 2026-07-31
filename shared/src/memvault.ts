/**
 * memvault domain contract (slice E2) — the per-user markdown-notes capability, branded
 * "cortex memory" client-side. State is per-user files on disk (api/src/memvault/); tenancy
 * isolation is the point, so the permalink grammar is deliberately strict: lowercase slug
 * segments joined by '/', no dots ANYWHERE (so '.', '..', dotfiles and extensions are
 * unrepresentable at the contract level), max 512 chars. The jail re-validates server-side.
 *
 * Reads/deletes address a note via a QUERY param (`?permalink=folder/slug`) rather than a
 * path param: permalinks are multi-segment and express `:params` do not match '/'. (No repo
 * precedent mounts a wildcard path for this; recorded as the E2 design choice.)
 *
 * Ops: write/read/list/delete (E2) + search/export (E3). Both E3 ops are per-caller by
 * construction rather than by parameter — neither takes a tenant/owner argument, because the
 * only tenant either can address is the verified principal's own partition.
 */
import { z } from 'zod';
import { IsoTimestamp } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

/** Permalink grammar: slug segments of [a-z0-9-_] (first char alphanumeric) joined by '/'.
 *  No '.', no '\', no spaces, no leading '/', nothing empty — traversal is unrepresentable. */
export const NOTE_PERMALINK_MAX = 512;

/**
 * Per-SEGMENT ceiling, and it is a filesystem fact, not a taste call: every segment becomes one
 * path component on disk (`<segment>/` or `<segment>.md`, plus the write's `.<12 hex>.tmp`
 * suffix), and the common Linux/macOS limit is 255 BYTES per component. Without this the
 * contract admitted a 512-char single segment, the write hit ENAMETOOLONG deep inside the store,
 * and a contract-VALID request became an HTTP 500 (E2 review finding F1). 200 leaves the
 * temp-name suffix room: 200 + '.md' + '.' + 12 + '.tmp' = 220 < 255.
 */
export const NOTE_PERMALINK_SEGMENT_MAX = 200;

const SEGMENT_SRC = `[a-z0-9][a-z0-9-_]{0,${NOTE_PERMALINK_SEGMENT_MAX - 1}}`;
/** Built from the constant so the two can never drift. Linear-time: the segment character class
 *  excludes '/', so there is no ambiguity for a backtracking engine to explode on. */
export const NOTE_PERMALINK_RE = new RegExp(`^${SEGMENT_SRC}(\\/${SEGMENT_SRC})*$`);

export const NotePermalink = z.string().min(1).max(NOTE_PERMALINK_MAX).regex(NOTE_PERMALINK_RE);
export type NotePermalink = z.infer<typeof NotePermalink>;

/** A folder is just a permalink prefix (same grammar) — `briefs` or `briefs/2026`. */
export const NoteFolder = NotePermalink;

/** The YAML frontmatter block persisted at the top of every note file (basic-memory
 *  compatible: title/type/permalink/tags are what a stock `basic-memory sync` indexes). */
export const NoteFrontmatter = z.object({
  title: z.string().min(1).max(300),
  type: z.string().min(1).max(64),
  permalink: NotePermalink,
  tags: z.array(z.string().min(1).max(64)).max(50),
  created: IsoTimestamp,
  modified: IsoTimestamp,
});
export type NoteFrontmatter = z.infer<typeof NoteFrontmatter>;

/** The wire record: frontmatter + the derived folder (permalink minus its last segment)
 *  + the markdown body. */
export const NoteRecord = NoteFrontmatter.extend({
  folder: NoteFolder.optional(),
  contentMd: z.string(),
});
export type NoteRecord = z.infer<typeof NoteRecord>;

export const WriteNoteRequest = z.object({
  /** Optional: the server derives `folder/slug(title)` when absent. */
  permalink: NotePermalink.optional(),
  title: z.string().min(1).max(300),
  folder: NoteFolder.optional(),
  tags: z.array(z.string().min(1).max(64)).max(50).optional(),
  type: z.string().min(1).max(64).optional(),
  contentMd: z.string().max(1_000_000),
});
export type WriteNoteRequest = z.infer<typeof WriteNoteRequest>;

export const WriteNoteResponse = NoteRecord;
export type WriteNoteResponse = z.infer<typeof WriteNoteResponse>;

export const NotePermalinkQuery = z.object({ permalink: NotePermalink });
export type NotePermalinkQuery = z.infer<typeof NotePermalinkQuery>;

export const NoteListQuery = z.object({
  folder: NoteFolder.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  /** Opaque page cursor: the last permalink of the previous page. */
  cursor: z.string().max(NOTE_PERMALINK_MAX).optional(),
});
export type NoteListQuery = z.infer<typeof NoteListQuery>;

/** List rows carry metadata only — the body stays on disk until readNote. */
export const NoteListItem = NoteRecord.omit({ contentMd: true });
export type NoteListItem = z.infer<typeof NoteListItem>;

export const NoteListResponse = z.object({
  items: z.array(NoteListItem),
  /** Present when a further page exists; pass back as ?cursor=. */
  nextCursor: z.string().optional(),
});
export type NoteListResponse = z.infer<typeof NoteListResponse>;

export const DeleteNoteResponse = z.object({ ok: z.literal(true) });
export type DeleteNoteResponse = z.infer<typeof DeleteNoteResponse>;

/** Full-text search over the CALLER'S OWN notes (E3). There is no tenant/owner field: the
 *  server searches the verified principal's partition and nothing else exists to ask for. */
export const NoteSearchRequest = z.object({
  query: z.string().min(1).max(1_000),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export type NoteSearchRequest = z.infer<typeof NoteSearchRequest>;

/** A hit names the note and (optionally) shows why it matched. `snippet` is a highlight
 *  fragment of the matching column; `score` is larger-is-better relevance. Both are optional:
 *  they are index-derived presentation, never something a client should key logic on. */
export const NoteSearchHit = z.object({
  permalink: NotePermalink,
  title: z.string(),
  snippet: z.string().optional(),
  score: z.number().optional(),
});
export type NoteSearchHit = z.infer<typeof NoteSearchHit>;

export const NoteSearchResponse = z.object({ hits: z.array(NoteSearchHit) });
export type NoteSearchResponse = z.infer<typeof NoteSearchResponse>;

export const memvaultEndpoints = {
  writeNote: {
    method: 'POST',
    path: '/api/v1/memvault/notes',
    auth: 'user-or-key',
    request: WriteNoteRequest,
    response: WriteNoteResponse,
  },
  readNote: {
    method: 'GET',
    path: '/api/v1/memvault/note',
    auth: 'user-or-key',
    query: NotePermalinkQuery,
    response: NoteRecord,
  },
  listNotes: {
    method: 'GET',
    path: '/api/v1/memvault/notes',
    auth: 'user-or-key',
    query: NoteListQuery,
    response: NoteListResponse,
  },
  deleteNote: {
    method: 'DELETE',
    path: '/api/v1/memvault/note',
    auth: 'user-or-key',
    query: NotePermalinkQuery,
    response: DeleteNoteResponse,
  },
  searchNotes: {
    method: 'POST',
    path: '/api/v1/memvault/search',
    auth: 'user-or-key',
    request: NoteSearchRequest,
    response: NoteSearchResponse,
  },
  /** Streams a tar of the caller's MARKDOWN — the derived per-user search index is never in
   *  it. `kind: 'binary'` marks the body as opaque bytes (the servedApp/uploads precedent):
   *  there is no JSON response schema to validate, so `response` is z.unknown(). `mediaType`
   *  states the concrete type the route sends, so the published spec does not have to guess
   *  (E6 review F6 — it guessed application/octet-stream, and that was wrong). */
  exportVault: {
    method: 'GET',
    path: '/api/v1/memvault/export',
    auth: 'user-or-key',
    kind: 'binary',
    mediaType: 'application/x-tar',
    response: z.unknown(),
  },
} as const satisfies DomainDescriptorMap;
