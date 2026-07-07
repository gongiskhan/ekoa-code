/**
 * content/ package manifest + import-time validation (ch08 §8.1).
 *
 * A content package is a directory with a `content.json` manifest, one or more skill
 * files (`*.md` with YAML frontmatter carrying `description`), and optional inert assets.
 * The loader reads the manifest as the ONLY structure it interprets; it never reads a
 * markdown body except to verify existence and hash it (FIXED-6). This module owns the
 * one zod schema (no schema versioning/migrations — an incompatible manifest fails import
 * with a clear error, ch08 §8.3) and the mechanical enforcement of the 8.2 cannot-list:
 * NO executable content ships as content (the ekoa-data/legal-engines/*.mjs pattern the
 * rule exists to kill).
 *
 * Imports: zod + node builtins only. No api/src import (content/ may import config.ts
 * only, ch02 §2.6; this file needs neither).
 */
import { z } from 'zod';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

export const AGENT_KINDS = ['coding', 'chat', 'automation'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** The `content.json` manifest schema (ch08 §8.1). `.strict()` rejects unknown keys so a
 *  fitting cannot smuggle loader directives past the four fields the platform reads. */
export const contentManifestSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'package name must be lower-case kebab (a-z, 0-9, -)'),
    version: z.string().min(1),
    description: z.string().min(1),
    agents: z.array(z.enum(AGENT_KINDS)).min(1),
    mode: z.enum(['eager', 'on-demand']),
    files: z.array(z.string().min(1)).min(1),
  })
  .strict();

export type ContentManifest = z.infer<typeof contentManifestSchema>;

/** Thrown by every validation failure; callers (importPackage, boot ingest) surface it. */
export class ContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentValidationError';
  }
}

/** Extensions that carry executable content and are rejected at import time (ch08 §8.1). */
const EXECUTABLE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.sh', '.py']);

/** POSIX executable-bit mask (owner/group/other x). */
const EXECUTABLE_BIT = 0o111;

/** Walk a package directory, returning every file as a POSIX-style relative path,
 *  excluding the manifest itself. */
function walkFiles(root: string): string[] {
  const out: string[] = [];
  const recur = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        recur(abs);
      } else if (entry.isFile()) {
        const rel = relative(root, abs).split(sep).join('/');
        if (rel !== 'content.json') out.push(rel);
      }
    }
  };
  recur(root);
  return out;
}

/** Read the leading YAML frontmatter block and return its `description` value, or
 *  undefined when absent. Deliberately minimal: the loader reads only this one key and
 *  never interprets the rest of the body (FIXED-6). */
export function frontmatterDescription(body: string): string | undefined {
  if (!body.startsWith('---')) return undefined;
  const end = body.indexOf('\n---', 3);
  if (end === -1) return undefined;
  const block = body.slice(3, end);
  for (const line of block.split('\n')) {
    const m = /^\s*description\s*:\s*(.+?)\s*$/.exec(line);
    if (m && m[1]) return m[1].replace(/^["']|["']$/g, '');
  }
  return undefined;
}

/**
 * Validate a package directory (ch08 §8.1). Returns the parsed manifest on success;
 * throws `ContentValidationError` on any of: unparseable/invalid manifest, a listed file
 * that does not exist, a file on disk outside the manifest list, an executable file (by
 * extension or executable bit), or a listed `.md` skill file missing its frontmatter
 * `description`. At least one `.md` skill file is required.
 */
export function validatePackageDir(dir: string): ContentManifest {
  let raw: string;
  try {
    raw = readFileSync(join(dir, 'content.json'), 'utf8');
  } catch {
    throw new ContentValidationError(`content.json not found in package: ${dir}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ContentValidationError(`content.json is not valid JSON in ${dir}: ${(e as Error).message}`);
  }
  const result = contentManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ContentValidationError(`invalid content.json in ${dir}: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  }
  const manifest = result.data;

  const listed = new Set(manifest.files);
  const onDisk = walkFiles(dir);
  const onDiskSet = new Set(onDisk);

  // Every listed file exists.
  for (const f of manifest.files) {
    if (!onDiskSet.has(f)) throw new ContentValidationError(`package ${manifest.name}: listed file missing on disk: ${f}`);
  }
  // No file outside the list.
  for (const f of onDisk) {
    if (!listed.has(f)) throw new ContentValidationError(`package ${manifest.name}: file present but not listed in manifest: ${f}`);
  }

  // No executable content: extension blacklist + executable bit.
  let skillFiles = 0;
  for (const f of manifest.files) {
    const ext = extname(f).toLowerCase();
    if (EXECUTABLE_EXTENSIONS.has(ext)) {
      throw new ContentValidationError(`package ${manifest.name}: executable content is not allowed: ${f}`);
    }
    const mode = statSync(join(dir, f)).mode;
    if ((mode & EXECUTABLE_BIT) !== 0) {
      throw new ContentValidationError(`package ${manifest.name}: file has an executable bit set: ${f}`);
    }
    if (ext === '.md') {
      const body = readFileSync(join(dir, f), 'utf8');
      if (!frontmatterDescription(body)) {
        throw new ContentValidationError(`package ${manifest.name}: skill file ${f} lacks a frontmatter description`);
      }
      skillFiles += 1;
    }
  }
  if (skillFiles === 0) {
    throw new ContentValidationError(`package ${manifest.name}: at least one .md skill file is required`);
  }
  return manifest;
}
