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
 * Ops here: write/read/list/delete. Search + export are the NEXT slice (E3) — they will add
 * their own endpoints to this map; the on-disk format (plain markdown + YAML frontmatter,
 * stock `basic-memory sync`-indexable) is the seam they build on.
 */
import { z } from 'zod';
import { IsoTimestamp } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

/** Permalink grammar: slug segments of [a-z0-9-_] (first char alphanumeric) joined by '/'.
 *  No '.', no '\', no spaces, no leading '/', nothing empty — traversal is unrepresentable. */
export const NOTE_PERMALINK_RE = /^[a-z0-9][a-z0-9-_]*(\/[a-z0-9][a-z0-9-_]*)*$/;
export const NOTE_PERMALINK_MAX = 512;

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
} as const satisfies DomainDescriptorMap;
