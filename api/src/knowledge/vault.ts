/**
 * The knowledge vault (ch04 §4.4.1): a filesystem markdown corpus, one file per document with
 * a small frontmatter block, org-partitioned by path segment. This module is the ONLY writer of
 * vault files; it holds no search logic (that is the lexical index) and imports nothing from
 * llm/ (knowledge/ has no path to the egress module — CLAUDE.md, ekoa-architecture).
 *
 * Frontmatter is a fixed set of scalar fields, each JSON-encoded so titles/URLs carrying colons,
 * quotes or newlines round-trip unambiguously:
 *
 *   ---
 *   title: "Acórdão do STJ"
 *   sourceUrl: "https://dgsi.pt/..."
 *   createdAt: "2026-07-07T10:00:00.000Z"
 *   ---
 *   <markdown body>
 */
import { mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import { collectionDir, docPath, orgVaultDir, vaultRoot, isSafeSegment } from './paths.js';

export interface DocFrontmatter {
  title: string;
  sourceUrl?: string;
  sourceType?: string;
  language?: string;
  createdAt: string;
}

export interface VaultDoc extends DocFrontmatter {
  docId: string;
  collection: string;
  size: number;
}

const FM_KEYS: (keyof DocFrontmatter)[] = ['title', 'sourceUrl', 'sourceType', 'language', 'createdAt'];

export function serializeDoc(fm: DocFrontmatter, body: string): string {
  const lines = ['---'];
  for (const k of FM_KEYS) {
    const v = fm[k];
    if (v !== undefined) lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push('---', '');
  return `${lines.join('\n')}${body}`;
}

export function parseDoc(raw: string): { fm: DocFrontmatter; body: string } {
  const fm: Partial<DocFrontmatter> = {};
  if (!raw.startsWith('---\n')) return { fm: { title: '', createdAt: '' }, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { fm: { title: '', createdAt: '' }, body: raw };
  const block = raw.slice(4, end);
  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim() as keyof DocFrontmatter;
    if (!FM_KEYS.includes(key)) continue;
    const rest = line.slice(idx + 1).trim();
    try {
      fm[key] = JSON.parse(rest) as string;
    } catch {
      fm[key] = rest;
    }
  }
  // body begins after the closing `\n---` line and its trailing newline
  const afterFence = raw.indexOf('\n', end + 1);
  const body = afterFence === -1 ? '' : raw.slice(afterFence + 1);
  return { fm: { title: fm.title ?? '', createdAt: fm.createdAt ?? '', ...fm }, body };
}

/** Write (create or overwrite) one document file. Returns the persisted VaultDoc. */
export async function writeDoc(
  orgId: string,
  collection: string,
  docId: string,
  fm: DocFrontmatter,
  body: string,
): Promise<VaultDoc> {
  const path = docPath(orgId, collection, docId);
  await mkdir(collectionDir(orgId, collection), { recursive: true });
  const content = serializeDoc(fm, body);
  await writeFile(path, content, 'utf8');
  return { docId, collection, size: Buffer.byteLength(content, 'utf8'), ...fm };
}

/** Read one document's frontmatter + body, or null if it does not exist in this org. */
export async function readDoc(
  orgId: string,
  collection: string,
  docId: string,
): Promise<{ fm: DocFrontmatter; body: string } | null> {
  try {
    return parseDoc(await readFile(docPath(orgId, collection, docId), 'utf8'));
  } catch {
    return null;
  }
}

/** Delete one document file. Returns false when it was already absent. */
export async function deleteDoc(orgId: string, collection: string, docId: string): Promise<boolean> {
  const path = docPath(orgId, collection, docId);
  try {
    await stat(path);
  } catch {
    return false;
  }
  await rm(path, { force: true });
  return true;
}

/** List every org partition present on disk (used by the startup backfill). */
export async function listOrgIds(): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(vaultRoot(), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory() && isSafeSegment(e.name)).map((e) => e.name).sort();
}

/** List collection names present in an org's vault (directory browse, not search). */
export async function listCollections(orgId: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(orgVaultDir(orgId), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isDirectory() && isSafeSegment(e.name)).map((e) => e.name).sort();
}

/** Enumerate every document in an org (optionally one collection). Filesystem browse: reads each
 *  file's frontmatter. Deterministic order: createdAt then docId. */
export async function listAllDocs(orgId: string, collection?: string): Promise<VaultDoc[]> {
  const collections = collection ? [collection] : await listCollections(orgId);
  const out: VaultDoc[] = [];
  for (const coll of collections) {
    if (!isSafeSegment(coll)) continue;
    let files: string[];
    try {
      files = await readdir(collectionDir(orgId, coll));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const docId = file.slice(0, -3);
      if (!isSafeSegment(docId)) continue;
      const parsed = await readDoc(orgId, coll, docId);
      if (!parsed) continue;
      const content = serializeDoc(parsed.fm, parsed.body);
      out.push({ docId, collection: coll, size: Buffer.byteLength(content, 'utf8'), ...parsed.fm });
    }
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.docId < b.docId ? -1 : 1));
  return out;
}

/** Paginated slice of {@link listAllDocs}. */
export async function listDocs(
  orgId: string,
  opts: { collection?: string; offset?: number; limit?: number } = {},
): Promise<{ items: VaultDoc[]; total: number }> {
  const all = await listAllDocs(orgId, opts.collection);
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 50;
  return { items: all.slice(offset, offset + limit), total: all.length };
}
