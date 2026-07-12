/**
 * Base Template Loader (operator-run B1).
 *
 * Reconnects the internal-bases system the rebuild ported as content only
 * (assets arrived in commit f75d2d5; the consuming loader lived in the old
 * codebase at cortex/src/services/base-loader.ts and was never ported — see
 * docs/autothing/runs/20260712-150958-4bb23640/analysis/04-internal-templates.md).
 *
 * A base is a directory under api/assets/bases/<id>/ carrying invariants as
 * CONTENT: a zod-validated manifest.json, prose instructions/ + skills/ +
 * layouts/ (markdown, injected into the build system prompt when the base is
 * selected), recipes/ (json), wiring/ (library files copied into the project
 * under frontend/src/lib/), and scaffold/ (ready-made project files copied
 * VERBATIM — the shell is pre-built; the coding agent fills in content
 * instead of regenerating structure from prose).
 *
 * Structure is COPIED into the sandbox (no inheritance propagation — standing
 * decision); design tokens stay SERVED BY REFERENCE via /api/design-tokens.css
 * (per-org), so a base's tokens.json is deliberately NOT consumed here.
 *
 * Bases are re-read from disk on every call (no cache — same posture as the
 * scaffold templates' one-shot read; base selection is a per-first-build event,
 * not a hot path). The id set is a closed enum: additions require code change
 * (the operator-run B2 slice adds `app`).
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const BASE_IDS = [
  'app-auth-persistent',
  'landing',
  'presentation',
  'app-integration-heavy',
  'document',
] as const;

export type BaseId = (typeof BASE_IDS)[number];

const baseManifestSchema = z.object({
  id: z.enum(BASE_IDS),
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().min(1),
  /**
   * Project-relative files generation MUST modify vs the scaffold baseline
   * (operator-run B3). The honest-completion gate fails a base-built artifact
   * whose mustEdit files are untouched — the base shell looks plausible served
   * as-is, which is exactly the F16/F28 failure class the generic scaffold
   * markers cannot see. Absent/empty = the generic subtree signal suffices.
   */
  mustEdit: z.array(z.string().min(1)).optional(),
});

export type BaseManifest = z.infer<typeof baseManifestSchema>;

export interface BaseFile {
  /** Path relative to the base subdirectory it was read from. */
  relPath: string;
  content: string;
}

export interface LoadedBase {
  id: BaseId;
  manifest: BaseManifest;
  /** Markdown bodies injected into the build system prompt, in order:
   *  instructions first (conventions), then skills (how-tos), then layouts. */
  promptSections: string[];
  /** Ready-made project files from scaffold/, copied verbatim (project-relative paths). */
  scaffoldFiles: BaseFile[];
  /** Library files from wiring/, mapped to frontend/src/lib/<basename> in the project. */
  wiringFiles: BaseFile[];
  rootDir: string;
}

/** Root of the bases content tree: api/assets/bases (dev and dist layouts both
 *  resolve to api/assets, mirroring scaffold.ts TEMPLATES_DIR). */
export function basesDir(): string {
  return join(__dirname, '..', '..', 'assets', 'bases');
}

export function isBaseId(value: string): value is BaseId {
  return (BASE_IDS as readonly string[]).includes(value);
}

/**
 * Load a base by id. Throws on an unknown id, a missing directory, or an
 * invalid manifest — a selected base that cannot load is a build-time error,
 * never a silent fallback (the CALLER decides whether absence of selection
 * falls back to the generic starters).
 */
export async function loadBase(rawId: string): Promise<LoadedBase> {
  if (!isBaseId(rawId)) {
    throw new Error(`BaseNotFound: "${rawId}" is not one of ${BASE_IDS.join(', ')}`);
  }
  const id: BaseId = rawId;
  const root = join(basesDir(), id);
  if (!existsSync(root)) {
    throw new Error(`BaseNotFound: directory missing at ${root}`);
  }

  const manifestPath = join(root, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`BaseInvalid: missing manifest.json at ${manifestPath}`);
  }
  const parsed = baseManifestSchema.safeParse(JSON.parse(await readFile(manifestPath, 'utf-8')));
  if (!parsed.success) {
    throw new Error(`BaseInvalid: manifest.json at ${manifestPath}: ${parsed.error.message}`);
  }
  if (parsed.data.id !== id) {
    throw new Error(`BaseInvalid: manifest.id=${parsed.data.id} does not match dir=${id}`);
  }

  const instructions = await readMarkdownDir(join(root, 'instructions'));
  const skills = await readMarkdownDir(join(root, 'skills'));
  const layouts = await readMarkdownDir(join(root, 'layouts'));
  const scaffoldFiles = await readAllFiles(join(root, 'scaffold'));
  const wiringFiles = await readAllFiles(join(root, 'wiring'));

  return {
    id,
    manifest: parsed.data,
    promptSections: [...instructions, ...skills, ...layouts],
    scaffoldFiles,
    wiringFiles,
    rootDir: root,
  };
}

/**
 * The project-file list a selected base feeds into scaffoldApp's
 * `templateScaffoldFiles`: the scaffold/ tree verbatim (already
 * project-relative) plus each wiring file mapped to frontend/src/lib/<basename>
 * (the location the base conventions describe — e.g. wiring/integration-helper/
 * integrations.ts lands at frontend/src/lib/integrations.ts). Scaffold files
 * win over wiring files on a path collision.
 */
export function baseProjectFiles(base: LoadedBase): Array<{ path: string; content: string }> {
  const byPath = new Map<string, string>();
  for (const w of base.wiringFiles) {
    byPath.set(`frontend/src/lib/${basename(w.relPath)}`, w.content);
  }
  for (const s of base.scaffoldFiles) {
    byPath.set(s.relPath, s.content);
  }
  // Fail LOUD on any path scaffoldApp's safety guard would silently drop
  // (absolute, or containing '..' — including legal-but-cursed names like
  // "notes..md"): a base file that would vanish from projects is a broken
  // base, not a skippable entry (codex B1 finding, determinism-ratchet guard).
  for (const path of byPath.keys()) {
    if (path.startsWith('/') || path.includes('..')) {
      throw new Error(`BaseInvalid: base "${base.id}" emits unsafe project path "${path}" (scaffold would silently drop it)`);
    }
  }
  return [...byPath.entries()].map(([path, content]) => ({ path, content }));
}

// ============================================
// Internal helpers
// ============================================

async function readMarkdownDir(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out: Array<{ name: string; body: string }> = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    out.push({ name: e.name, body: await readFile(join(dir, e.name), 'utf-8') });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name)).map((f) => f.body.trim());
}

async function readAllFiles(dir: string, prefix = ''): Promise<BaseFile[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const out: BaseFile[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await readAllFiles(full, rel)));
    } else if (e.isFile()) {
      const s = await stat(full);
      if (s.size > 2_000_000) continue; // never inline a runaway binary
      out.push({ relPath: rel, content: await readFile(full, 'utf-8') });
    }
  }
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
