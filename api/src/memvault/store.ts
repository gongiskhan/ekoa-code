/**
 * memvault file store (slice E2): markdown CRUD for the per-user notes tree, every path
 * minted by the jail (jail.ts is the ONLY path-resolution point — this file deliberately
 * never imports node:path; walk paths concatenate '/' onto jail-issued roots and
 * readdir-issued entry names, never onto user input).
 *
 * On-disk format — STOCK BASIC-MEMORY REBUILDABLE: one plain-markdown file per note with a
 * YAML frontmatter block a stock `basic-memory sync` can index (title, type, permalink,
 * tags, plus created/modified). Scalars are JSON-encoded (valid YAML double-quoted scalars,
 * same convention as knowledge/vault.ts) and tags are a JSON array (valid YAML flow
 * sequence), so titles carrying colons/quotes/newlines round-trip unambiguously:
 *
 *   ---
 *   title: "Reunião com o cliente"
 *   type: "note"
 *   permalink: "briefs/reuniao-com-o-cliente"
 *   tags: ["cliente","2026"]
 *   created: "2026-07-30T10:00:00.000Z"
 *   modified: "2026-07-30T10:00:00.000Z"
 *   ---
 *   <markdown body>
 *
 * Writes are temp-then-rename (crash-safe: a reader never sees a torn file; the *.tmp name
 * neither ends in .md nor starts with '.', so the list walk ignores stray leftovers).
 * The E3 seams (search/export) build on exactly this format plus listNotes/readNote.
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { NOTE_PERMALINK_MAX, NOTE_PERMALINK_RE } from '@ekoa/shared';
import { ensureUserRoot, notePath, userRoot } from './jail.js';

export interface StoredNote {
  permalink: string;
  title: string;
  folder?: string;
  tags: string[];
  type: string;
  created: string;
  modified: string;
  contentMd: string;
}

export type StoredNoteMeta = Omit<StoredNote, 'contentMd'>;

export interface WriteNoteInput {
  /** Final permalink — already derived + contract-validated by the service. */
  permalink: string;
  title: string;
  tags: string[];
  type: string;
  contentMd: string;
}

const FM_KEYS = ['title', 'type', 'permalink', 'tags', 'created', 'modified'] as const;
type FmKey = (typeof FM_KEYS)[number];

/** `briefs/2026/nota` -> `briefs/2026`; a root-level permalink has no folder. */
function folderOf(permalink: string): string | undefined {
  const idx = permalink.lastIndexOf('/');
  return idx === -1 ? undefined : permalink.slice(0, idx);
}

export function serializeNote(fm: { title: string; type: string; permalink: string; tags: string[]; created: string; modified: string }, body: string): string {
  const lines = ['---'];
  for (const k of FM_KEYS) {
    lines.push(`${k}: ${JSON.stringify(fm[k])}`);
  }
  lines.push('---', '');
  return `${lines.join('\n')}${body}`;
}

export function parseNote(raw: string): { fm: Record<FmKey, unknown>; body: string } {
  const fm: Partial<Record<FmKey, unknown>> = {};
  if (raw.startsWith('---\n')) {
    const end = raw.indexOf('\n---', 3);
    if (end !== -1) {
      for (const line of raw.slice(4, end).split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim() as FmKey;
        if (!FM_KEYS.includes(key)) continue;
        const rest = line.slice(idx + 1).trim();
        try {
          fm[key] = JSON.parse(rest);
        } catch {
          fm[key] = rest;
        }
      }
      const afterFence = raw.indexOf('\n', end + 1);
      const body = afterFence === -1 ? '' : raw.slice(afterFence + 1);
      return { fm: fm as Record<FmKey, unknown>, body };
    }
  }
  return { fm: fm as Record<FmKey, unknown>, body: raw };
}

function toStoredNote(permalink: string, raw: string): StoredNote {
  const { fm, body } = parseNote(raw);
  const folder = folderOf(permalink);
  return {
    permalink,
    title: typeof fm.title === 'string' && fm.title ? fm.title : permalink,
    ...(folder !== undefined ? { folder } : {}),
    tags: Array.isArray(fm.tags) ? fm.tags.filter((t): t is string => typeof t === 'string') : [],
    type: typeof fm.type === 'string' && fm.type ? fm.type : 'note',
    created: typeof fm.created === 'string' ? fm.created : '',
    modified: typeof fm.modified === 'string' ? fm.modified : '',
    contentMd: body,
  };
}

/** Create or overwrite one note. Preserves `created` across overwrites; temp-then-rename. */
export async function writeNote(userId: string, input: WriteNoteInput, nowIso: string): Promise<StoredNote> {
  await ensureUserRoot(userId);
  const { file, dir } = await notePath(userId, input.permalink);
  const existing = await readNote(userId, input.permalink);
  const created = existing?.created || nowIso;
  const fm = {
    title: input.title,
    type: input.type,
    permalink: input.permalink,
    tags: input.tags,
    created,
    modified: nowIso,
  };
  await mkdir(dir, { recursive: true });
  const content = serializeNote(fm, input.contentMd);
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
  const folder = folderOf(input.permalink);
  return { ...fm, ...(folder !== undefined ? { folder } : {}), contentMd: input.contentMd };
}

/** Read one note, or null when it does not exist IN THIS USER'S TREE (a jail violation —
 *  symlink escape — throws and is NOT a null: the service maps it to its own verdict). */
export async function readNote(userId: string, permalink: string): Promise<StoredNote | null> {
  const { file } = await notePath(userId, permalink);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }
  return toStoredNote(permalink, raw);
}

/** Delete one note. False when already absent. */
export async function deleteNote(userId: string, permalink: string): Promise<boolean> {
  const { file } = await notePath(userId, permalink);
  try {
    await unlink(file);
    return true;
  } catch {
    return false;
  }
}

/** Recursively collect note permalinks under the user root. Skips dotfiles and dot-dirs
 *  (including .index/), never descends into symlinked directories (Dirent.isDirectory()
 *  is false for symlinks — a planted link cannot pull foreign trees into a listing). */
async function walkPermalinks(absDir: string, relPrefix: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await walkPermalinks(`${absDir}/${e.name}`, rel, out);
    } else if (e.isFile() && e.name.endsWith('.md')) {
      const permalink = rel.slice(0, -3);
      // Only jail-representable permalinks are listed; anything else on disk is foreign noise.
      if (permalink.length <= NOTE_PERMALINK_MAX && NOTE_PERMALINK_RE.test(permalink)) out.push(permalink);
    }
  }
}

export interface ListOptions {
  folder?: string;
  limit?: number;
  cursor?: string;
}

/** Deterministic page (permalink-ascending) of note metadata. Only the page's files are
 *  opened; `nextCursor` is the last permalink when more remain. */
export async function listNotes(userId: string, opts: ListOptions = {}): Promise<{ items: StoredNoteMeta[]; nextCursor?: string }> {
  const root = userRoot(userId);
  const all: string[] = [];
  await walkPermalinks(root, '', all);
  const filtered = (opts.folder ? all.filter((p) => p.startsWith(`${opts.folder}/`)) : all).sort();
  const after = opts.cursor ? filtered.filter((p) => p > (opts.cursor as string)) : filtered;
  const limit = opts.limit ?? 100;
  const page = after.slice(0, limit);
  const items: StoredNoteMeta[] = [];
  for (const permalink of page) {
    const note = await readNote(userId, permalink);
    if (!note) continue; // raced away between walk and read
    const { contentMd: _body, ...meta } = note;
    items.push(meta);
  }
  return { items, ...(after.length > limit && page.length > 0 ? { nextCursor: page[page.length - 1] as string } : {}) };
}
