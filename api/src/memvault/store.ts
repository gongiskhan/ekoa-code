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
 *
 * Slice E3 adds the two read-only seams over exactly this format: {@link allPermalinks} (what
 * the FTS rebuild walks) and {@link collectVaultFiles} + {@link streamTar} (the export). Both
 * ride the SAME dot-skipping walk, so the derived `<userRoot>/.index/` is structurally
 * invisible to them — the export ships markdown only, by construction rather than by filter.
 */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { NOTE_PERMALINK_MAX, NOTE_PERMALINK_RE } from '@ekoa/shared';
import { ensureUserRoot, notePath, resolvedUserRoot } from './jail.js';

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

/**
 * EVERY note permalink in the user's tree, ascending — the one walk the whole module shares
 * (list pages, the FTS rebuild, the export). Because the walk skips dot-entries, the reserved
 * `.index/` never appears here, so nothing built on top of it can ever surface derived data.
 *
 * The root comes from `resolvedUserRoot`, NOT the unchecked `userRoot`: this is the only place
 * the module hands a directory straight to readdir, so a user root that is itself a symlink
 * into another tenant's tree must fail closed HERE (E2 review F2) — it throws
 * JailViolationError, which the service maps to the uniform 404 like any other escape.
 */
export async function allPermalinks(userId: string): Promise<string[]> {
  const out: string[] = [];
  await walkPermalinks(await resolvedUserRoot(userId), '', out);
  return out.sort();
}

export interface ListOptions {
  folder?: string;
  limit?: number;
  cursor?: string;
}

/** Deterministic page (permalink-ascending) of note metadata. Only the page's files are
 *  opened; `nextCursor` is the last permalink when more remain. */
export async function listNotes(userId: string, opts: ListOptions = {}): Promise<{ items: StoredNoteMeta[]; nextCursor?: string }> {
  const all = await allPermalinks(userId);
  const filtered = opts.folder ? all.filter((p) => p.startsWith(`${opts.folder}/`)) : all;
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

// ---------------------------------------------------------------------------------------
// Export seam (slice E3): the user's MARKDOWN as a tar.
//
// Format choice: an UNCOMPRESSED tar written by `archiver`, an EXISTING api/ dependency
// (api/package.json "archiver": "^7.0.1", already the app-code .zip writer) whose tar backend
// ships with it — so no new dependency, and no hand-rolled tar writer to maintain. archiver
// carries no type declarations and `@types/archiver` is not a repo dependency, so it is loaded
// through createRequire and typed to the minimal surface used here, exactly as
// services/app-archive.ts documents for the zip path.
//
// The archive is DETERMINISTIC: entries are permalink-ascending, each entry's mtime is the
// note's own `modified` frontmatter (not wall-clock) and the mode is a fixed 0644, so exporting
// an unchanged vault twice produces byte-identical tars.
// ---------------------------------------------------------------------------------------

interface TarArchive {
  on(event: 'error' | 'warning', listener: (err: Error) => void): this;
  pipe<T extends NodeJS.WritableStream>(destination: T): T;
  append(source: Buffer, data: { name: string; date: Date; mode: number }): this;
  finalize(): Promise<void>;
  pointer(): number;
}
type ArchiverFactory = (format: 'tar', options?: { gzip?: boolean }) => TarArchive;
const archiver = createRequire(import.meta.url)('archiver') as ArchiverFactory;

/** Fixed mtime for a note whose frontmatter carries no usable `modified` (unix epoch — a
 *  constant, never wall-clock, so the archive stays reproducible). */
const EPOCH = new Date(0);

export interface VaultFile {
  /** Entry name inside the archive: `<permalink>.md`, POSIX-style, relative — never absolute. */
  name: string;
  /** The note file's raw bytes exactly as they sit on disk (frontmatter + body). */
  content: Buffer;
  /** Entry mtime, taken from the note's own frontmatter. */
  date: Date;
}

/** Read one note file's raw bytes through the jail, or null when it is absent. */
export async function readNoteFile(userId: string, permalink: string): Promise<Buffer | null> {
  const { file } = await notePath(userId, permalink);
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}

/**
 * Collect the caller's markdown for export. Every path is jail-minted from a permalink the
 * dot-skipping walk produced, so the set is exactly "this user's notes": no other tenant's
 * files, and no `.index/` (a dot-dir the walk never descends). Runs to completion BEFORE any
 * response header goes out, so a failure is still a clean envelope rather than a torn stream.
 */
export async function collectVaultFiles(userId: string): Promise<VaultFile[]> {
  const files: VaultFile[] = [];
  for (const permalink of await allPermalinks(userId)) {
    const content = await readNoteFile(userId, permalink);
    if (!content) continue; // raced away between walk and read
    const { fm } = parseNote(content.toString('utf8'));
    const modified = typeof fm.modified === 'string' ? new Date(fm.modified) : EPOCH;
    files.push({ name: `${permalink}.md`, content, date: Number.isNaN(modified.getTime()) ? EPOCH : modified });
  }
  return files;
}

export interface TarResult {
  files: number;
  bytes: number;
}

/** Stream already-collected entries into `out` as an uncompressed tar. Resolves once the sink
 *  has finished; rejects on an archiver or sink error (the caller destroys a committed
 *  response rather than appending an envelope to a half-written body). */
export function streamTar(files: VaultFile[], out: NodeJS.WritableStream): Promise<TarResult> {
  return new Promise<TarResult>((resolve, reject) => {
    const archive = archiver('tar');
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve({ files: files.length, bytes: archive.pointer() });
    };
    archive.on('error', fail);
    out.on('error', fail);
    out.on('finish', done);
    out.on('close', done);
    archive.pipe(out);
    for (const f of files) archive.append(f.content, { name: f.name, date: f.date, mode: 0o644 });
    void archive.finalize();
  });
}
