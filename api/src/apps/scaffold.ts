/**
 * App Scaffold (ch07 §7.1.1, §7.3 - port-as-is, carryover-audit A3).
 *
 * Creates the canonical directory structure for a new sandbox app. Reads starter file
 * templates from api/assets/scaffold-templates/ so the "what a new app looks like"
 * knowledge lives in content files, not in TypeScript code.
 *
 * Canonical structure (the legacy per-app content directories - skills/, recipes/,
 * instructions/ - are NOT carried; they are dead weight in the new architecture and
 * dropped per the B2 verdict, reference/carryover-audit.md B2 / spec/07 §7.3):
 *   {projectDir}/
 *     frontend/
 *       src/
 *         App.jsx
 *         index.jsx
 *         index.css
 *     dist/           (esbuild output - created on first build)
 *     manifest.json   (app metadata)
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultManifest, writeManifest, type AppManifest } from './manifest.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================
// Directory structure
// ============================================

const SUBDIRS = [
  'frontend/src',
] as const;

// ============================================
// Template loading
// ============================================

/**
 * Path to scaffold template content files. Assets live at api/assets, which is
 * __dirname/../.. plus assets/ in both the dev (api/src/apps) and built (api/dist/apps)
 * layouts.
 */
const TEMPLATES_DIR = join(__dirname, '..', '..', 'assets', 'scaffold-templates');

/**
 * Starter files to write into the project.
 * [relative path in project, filename in templates dir]
 */
const STARTER_FILES: ReadonlyArray<[string, string]> = [
  ['frontend/src/index.jsx', 'index.jsx'],
  ['frontend/src/App.jsx', 'App.jsx'],
  ['frontend/src/index.css', 'index.css'],
];

/** Cache loaded templates to avoid re-reading on every scaffold call. */
const templateCache = new Map<string, string>();

async function loadTemplate(filename: string): Promise<string> {
  const cached = templateCache.get(filename);
  if (cached) return cached;
  const content = await readFile(join(TEMPLATES_DIR, filename), 'utf-8');
  templateCache.set(filename, content);
  return content;
}

// ============================================
// Best-effort per-artifact git seed
// ============================================

const GITIGNORE_BODY = `dist/
node_modules/
app-data/
`;

/**
 * Run a git subcommand in `cwd`, resolving to whether it exited cleanly. Never rejects:
 * a missing git binary (`error` event) resolves false. Hooks are bypassed (`--no-verify`
 * on commit) and stdio is ignored so the scaffold stays silent and side-effect free.
 */
function runGit(cwd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn('git', args, { cwd, stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Seed the per-artifact git repo so the first agent iteration already has a parent commit
 * (spec/07 §7.3, reference/invisible-behaviors.md section 8.2). Best-effort: never fails the
 * scaffold on a git hiccup, and skips entirely when the project is already a repo (idempotent).
 */
async function seedGit(projectDir: string): Promise<void> {
  try {
    if (await exists(join(projectDir, '.git'))) return; // already a repo - leave it alone
    if (!(await runGit(projectDir, ['init']))) return;
    await writeFile(join(projectDir, '.gitignore'), GITIGNORE_BODY, 'utf-8');
    await runGit(projectDir, ['add', '-A']);
    await runGit(projectDir, [
      '-c', 'user.name=ekoa-agent',
      '-c', 'user.email=agent@ekoa.local',
      'commit', '--no-verify', '-m', 'Initial scaffold',
    ]);
  } catch (err) {
    console.warn('[scaffold] vcs init failed:', err instanceof Error ? err.message : err);
  }
}

// ============================================
// Scaffold function
// ============================================

export interface ScaffoldOptions {
  /** App ID (matches artifact instance ID). */
  appId: string;

  /** Human-readable app name. */
  name: string;

  /** Absolute path to the project directory. */
  projectDir: string;

  /** Optional description. */
  description?: string;

  /** Skip writing starter source files (for non-JSX apps). */
  skipStarterFiles?: boolean;

  /** Template-specific scaffold files. When provided, these are written instead of generic starter files. */
  templateScaffoldFiles?: Array<{ path: string; content: string }>;
}

export interface ScaffoldResult {
  manifest: AppManifest;
  filesCreated: string[];
}

/**
 * Scaffold a new app with the canonical directory structure.
 * Idempotent: skips files/dirs that already exist.
 */
export async function scaffoldApp(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const { appId, name, projectDir, description, skipStarterFiles, templateScaffoldFiles } = opts;
  const filesCreated: string[] = [];

  // Create subdirectories
  for (const subdir of SUBDIRS) {
    await mkdir(join(projectDir, subdir), { recursive: true });
  }

  // Write manifest.json (skip if already exists)
  const manifest = createDefaultManifest(appId, name);
  if (description) {
    manifest.description = description;
  }

  const manifestPath = join(projectDir, 'manifest.json');
  if (!(await exists(manifestPath))) {
    await writeManifest(projectDir, manifest);
    filesCreated.push('manifest.json');
  }

  // Write scaffold files: template-specific if available, otherwise generic starters
  if (templateScaffoldFiles && templateScaffoldFiles.length > 0) {
    for (const file of templateScaffoldFiles) {
      // Validate path safety
      if (file.path.startsWith('/') || file.path.includes('..')) continue;

      const fullPath = join(projectDir, file.path);
      // Always overwrite: template scaffold files take priority over any
      // pre-existing files in the session directory (e.g. generic starters)
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, 'utf-8');
      filesCreated.push(file.path);
    }
  } else if (!skipStarterFiles) {
    for (const [relPath, templateFile] of STARTER_FILES) {
      const fullPath = join(projectDir, relPath);
      if (!(await exists(fullPath))) {
        const content = await loadTemplate(templateFile);
        await writeFile(fullPath, content, 'utf-8');
        filesCreated.push(relPath);
      }
    }
  }

  // Seed the per-artifact git repo so the first agent iteration already has a
  // parent commit. Best-effort: never fail the scaffold on a git hiccup.
  await seedGit(projectDir);

  return { manifest, filesCreated };
}

// ============================================
// Helpers
// ============================================

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
