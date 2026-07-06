/**
 * App code archive — zips an app's on-disk working copy into a downloadable .zip
 * (spec/07-app-pipeline.md §7.9, code-egress door; ch03 §3.8.9).
 *
 * "Git as system of record" gives users durable history; this gives them the code
 * itself, on demand, with no lock-in and no github.com URL ever exposed. We zip the
 * working copy directly (offline path) rather than fetching a GitHub zipball, so
 * download works even before/without a remote.
 *
 * Excludes the same noise the Files panel hides (build output, node_modules, .git,
 * per-app data) and, as defense-in-depth against the download leaking a credential,
 * refuses to archive any file the secret guard flags - the caller (the HTTP route,
 * another slice) maps that refusal to `422 SECRET_GUARD_BLOCKED`.
 */

import { join, relative, sep } from 'node:path';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { scanText, SecretCommitError } from './commit-guard.js';

// archiver ships no type declarations and `@types/archiver` is not a dependency of
// this repo (the old repo carried it - reported as a missing devDependency). An
// untyped external module cannot be augmented in-place, so we load it via
// createRequire and type the minimal surface we use locally - keeping the port
// type-safe without editing package.json.
const nodeRequire = createRequire(import.meta.url);

interface ArchiverInstance {
  on(event: 'error', listener: (err: Error) => void): this;
  pipe<T extends NodeJS.WritableStream>(destination: T): T;
  file(filepath: string, data: { name: string }): this;
  finalize(): Promise<void>;
  pointer(): number;
}
type ArchiverFactory = (format: string, options?: { zlib?: { level?: number } }) => ArchiverInstance;
const archiver = nodeRequire('archiver') as ArchiverFactory;

/** Directory names excluded anywhere in the tree (matches the Files panel). */
const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.versions',
  '.sdk-session',
  '.claude',
  'session-env',
  'app-data',
]);

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // skip absurdly large files

export interface CollectedFile {
  /** path relative to projectDir (POSIX-style, what goes into the zip) */
  rel: string;
  /** absolute path on disk */
  abs: string;
  size: number;
}

/**
 * Walk the working copy and return the files that belong in the archive.
 * Throws SecretCommitError if any text file contains a high-confidence secret.
 */
export async function collectAppFiles(projectDir: string): Promise<CollectedFile[]> {
  const out: CollectedFile[] = [];

  async function walk(dir: string): Promise<void> {
    if (out.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (entry.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry.name)) continue;
        if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
        await walk(join(dir, entry.name));
      } else if (entry.isFile()) {
        if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
        const abs = join(dir, entry.name);
        let stat: fs.Stats;
        try {
          stat = await fs.promises.stat(abs);
        } catch {
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) continue;
        const rel = relative(projectDir, abs).split(sep).join('/');
        out.push({ rel, abs, size: stat.size });
      }
    }
  }

  await walk(projectDir);

  // Defense-in-depth: never ship a download that contains a credential, even if it
  // somehow reached disk uncommitted (the commit guard covers the commit path).
  const findings: ReturnType<typeof scanText> = [];
  for (const f of out) {
    if (f.size > 512 * 1024) continue; // large/binary — skip scan
    let content: string;
    try {
      content = await fs.promises.readFile(f.abs, 'utf-8');
    } catch {
      continue;
    }
    findings.push(...scanText(f.rel, content));
  }
  if (findings.length > 0) throw new SecretCommitError(findings);

  return out;
}

/** Sanitize an app name/slug into a safe zip filename base. */
export function safeZipName(nameOrSlug: string): string {
  const base = (nameOrSlug || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'app';
}

/**
 * Pipe an already-collected file list into `out` as a zip. Resolves when fully
 * written. Kept separate from collectAppFiles so callers (the HTTP route) can run
 * the secret check BEFORE any response headers/bytes go out.
 */
export function streamFiles(
  files: CollectedFile[],
  out: NodeJS.WritableStream,
): Promise<{ files: number; bytes: number }> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    let settled = false;
    archive.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    out.on('close', () => {
      if (!settled) {
        settled = true;
        resolve({ files: files.length, bytes: archive.pointer() });
      }
    });
    archive.pipe(out);
    for (const f of files) {
      archive.file(f.abs, { name: f.rel });
    }
    void archive.finalize();
  });
}

/**
 * Convenience: collect + stream. Rejects on a secret finding (before any bytes are
 * written) or an archiver error. The HTTP route splits the two phases so a secret
 * becomes a clean 422 instead of a corrupt stream.
 */
export async function streamAppArchive(
  projectDir: string,
  out: NodeJS.WritableStream,
): Promise<{ files: number; bytes: number }> {
  const files = await collectAppFiles(projectDir); // may throw SecretCommitError
  return streamFiles(files, out);
}
