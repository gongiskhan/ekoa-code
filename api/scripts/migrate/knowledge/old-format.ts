/**
 * Old-cortex knowledge-doc parser (the shared-corpus import, ch04 §4.4.1 + ch10 §10.3 discipline).
 *
 * The old corpus is one markdown file per document with a `---`-fenced frontmatter block of
 * `key: value` lines whose keys are ALREADY camelCase:
 *
 *   ---
 *   id: 9f3c...            (may disagree with the filename — an anomaly, not fatal)
 *   collection: jurisprudencia
 *   title: Acórdão do STJ de 2024
 *   sourceType: crawl
 *   sourceUrl: https://dgsi.pt/jstj.nsf/...   (URLs carry colons — split at the FIRST only)
 *   date: 2024-03-01T00:00:00.000Z
 *   hash: sha256:ab12...    (kept for import idempotency)
 *   language: pt
 *   sourceId: seed-42       (dropped — not part of the new vault frontmatter)
 *   ---
 *   <markdown body>
 *
 * The FILENAME (sans `.md`) is the authoritative docId; a frontmatter `id` that disagrees is
 * surfaced as an anomaly for the caller to count/journal, never a silent overwrite. A file with no
 * frontmatter fence, or no title, is malformed → `null` (the caller counts + journals it). This
 * module is pure (no filesystem): the caller supplies the raw text, filename docId and collection,
 * and applies the mtime fallback for a missing `date`.
 */
import type { DocFrontmatter } from '../../../src/knowledge/vault.js';

export interface OldDoc {
  /** Authoritative id: the source filename (sans `.md`). */
  docId: string;
  collection: string;
  /** The new vault frontmatter (createdAt is '' when the source had no `date` — the caller fills
   *  the file-mtime fallback, which needs the filesystem this pure parser deliberately avoids). */
  fm: DocFrontmatter;
  body: string;
  /** Source `hash` frontmatter if present (else undefined → the caller hashes the raw text). */
  hash?: string;
  /** True when the frontmatter `id` disagreed with the filename (counted as an anomaly). */
  idMismatch: boolean;
}

/** Parse one old-format document. Returns null when the file is malformed (no fenced frontmatter,
 *  or no title) — the caller counts and journals it; nothing is ever silently dropped. */
export function parseOldDoc(raw: string, filenameDocId: string, collection: string): OldDoc | null {
  if (!raw.startsWith('---\n')) return null;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return null;

  const block = raw.slice(4, end);
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':'); // FIRST colon only — the value (e.g. a URL) may carry more
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    fields[key] = line.slice(idx + 1).trim();
  }

  const title = fields.title ?? '';
  if (!title) return null; // a doc with no title is malformed

  // Body begins after the closing `\n---` fence line and its trailing newline.
  const afterFence = raw.indexOf('\n', end + 1);
  const body = afterFence === -1 ? '' : raw.slice(afterFence + 1);

  const fm: DocFrontmatter = {
    title,
    createdAt: fields.date ?? '', // date → createdAt; '' signals the caller's mtime fallback
    ...(fields.sourceUrl ? { sourceUrl: fields.sourceUrl } : {}),
    ...(fields.sourceType ? { sourceType: fields.sourceType } : {}),
    ...(fields.language ? { language: fields.language } : {}),
  };

  return {
    docId: filenameDocId, // authoritative
    collection,
    fm,
    body,
    ...(fields.hash ? { hash: fields.hash } : {}),
    idMismatch: fields.id !== undefined && fields.id !== filenameDocId,
  };
}
