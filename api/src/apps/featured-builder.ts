/**
 * Featured-artifact prebuilder (ch07 §7.13, carried; runs post-listen,
 * fire-and-forget). Materialises each featured scaffold into a runtime build dir
 * OUTSIDE the versioned tree (the featured-builds mirror), esbuilds it via the
 * ported AppBuilder, and registers it so /apps/{id}/ and screenshots work without
 * a first visitor. Carried behaviors, each load-bearing:
 *  - freshness check: skip when dist/index.html is at least as new as the newest
 *    source file;
 *  - MANDATORY bare-import pre-check: an unresolvable bare import crashes the
 *    esbuild service from a socket callback (uncatchable - kills the process),
 *    so such scaffolds are detected and skipped cleanly;
 *  - customized featured artifacts build from the user's WORKING COPY - the
 *    scaffold is never force-copied over user edits (U1);
 *  - registration happens even on build failure (the error HTML serves instead
 *    of the placeholder);
 *  - screenshots fire-and-forget, self-healing only when the prior PNG is missing;
 *  - scaffolds with a declared backend get the artifact's data.projectDir patched
 *    to the mirror dir (fresh-read-then-write; the residual race is documented
 *    and accepted - reference/invisible-behaviors §8.4).
 */
import { readFile, readdir, mkdir, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { appBuilder } from './builder.js';
import { appRegistry } from './app-registry.js';
import { artifacts } from '../data/stores.js';
import { featuredArtifactsDir, featuredArtifactDir } from './featured-seeder.js';
import { captureArtifactScreenshot, getArtifactScreenshotDir } from '../services/artifact-screenshot.js';

const _require = createRequire(import.meta.url);

/** The featured-builds mirror under the data dir - build output stays out of the
 *  versioned tree. The same root the serving lazy-heal trusts. */
export function builtBuildsRoot(): string {
  return (
    process.env.EKOA_FEATURED_BUILDS_DIR ||
    join(process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data'), 'featured-builds')
  );
}

interface ManifestLite {
  id: string;
  name: string;
  /** Whether the scaffold declares a server-side backend (Layer 2). */
  hasBackend: boolean;
}

async function readManifestLite(scaffoldDir: string): Promise<ManifestLite | null> {
  try {
    const raw = await readFile(join(scaffoldDir, 'manifest.json'), 'utf-8');
    const m = JSON.parse(raw) as Record<string, unknown>;
    if (typeof m.id === 'string' && typeof m.name === 'string') {
      const backend = m.backend;
      const hasBackend =
        !!backend && typeof backend === 'object' &&
        typeof (backend as Record<string, unknown>).entryPoint === 'string';
      return { id: m.id, name: m.name, hasBackend };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Bare specifiers on either side of `from` - skips relative paths and CDN URLs
 *  (the cdnResolverPlugin handles URLs at build time). Carried verbatim. */
const BARE_IMPORT_RE =
  /(?:^|\s)(?:import|export)(?:\s+[^'"`;]*?from)?\s+['"`](?!\.|\/|https?:)([^'"`]+)['"`]/g;

async function collectBareImports(root: string): Promise<Set<string>> {
  const found = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'dist' || e.name === 'node_modules' || e.name === '.git') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (/\.(jsx?|tsx?|mjs|cjs)$/i.test(e.name)) {
        const src = await readFile(full, 'utf-8').catch(() => '');
        for (const match of src.matchAll(BARE_IMPORT_RE)) {
          found.add(match[1] as string);
        }
      }
    }
  };
  await walk(root);
  return found;
}

/** Specifiers that fail to resolve from the api runtime context - anything this
 *  rejects also fails inside appBuilder.build (same nodePaths + walk-up). */
function unresolvableImports(specs: Iterable<string>): string[] {
  const out: string[] = [];
  for (const spec of specs) {
    try {
      _require.resolve(spec);
    } catch {
      out.push(spec);
    }
  }
  return out;
}

async function newestMtime(root: string): Promise<number> {
  let newest = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'dist' || e.name === 'node_modules' || e.name === '.git') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else {
        const s = await stat(full);
        if (s.mtimeMs > newest) newest = s.mtimeMs;
      }
    }
  };
  await walk(root);
  return newest;
}

async function isFresh(buildDir: string, scaffoldDir: string): Promise<boolean> {
  const distIndex = join(buildDir, 'dist', 'index.html');
  if (!existsSync(distIndex)) return false;
  try {
    const [distStat, srcMtime] = await Promise.all([stat(distIndex), newestMtime(scaffoldDir)]);
    return distStat.mtimeMs >= srcMtime;
  } catch {
    return false;
  }
}

/** Build (or skip-if-fresh) and register one featured artifact. */
/** Returns `{ built }`: true when a real build ran, false when the existing dist was
 *  fresh and reused. The caller uses this for the built/skipped metrics and the
 *  self-healing screenshot decision - freshness is judged against the ACTUAL build
 *  source (the working copy for a customized artifact, the mirror for a scaffold),
 *  never a single pre-computed guess against the mirror. */
async function buildAndRegisterOne(scaffoldDir: string, manifest: ManifestLite): Promise<{ built: boolean }> {
  // U1: a customized featured artifact has a persistent working copy - build from
  // THAT, never force-copy the scaffold over the user's edits.
  try {
    const row = await artifacts.get(manifest.id);
    const data = (row?.data ?? {}) as Record<string, unknown>;
    const workingDir = typeof data.projectDir === 'string' ? data.projectDir : undefined;
    if (row && data.customized === true && workingDir && existsSync(workingDir)) {
      const fresh = await isFresh(workingDir, workingDir);
      if (!fresh) {
        const result = await appBuilder.build(manifest.id, workingDir);
        if (!result.success) {
          console.warn(`[featured-builder] ${manifest.id}: working-copy build failed - ${result.errors.join('; ')}`);
        }
      }
      await appRegistry.register(manifest.id, workingDir, 'system', manifest.name);
      return { built: !fresh };
    }
  } catch (err) {
    console.warn(
      `[featured-builder] ${manifest.id}: working-copy check failed, falling back to scaffold - ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const buildDir = join(builtBuildsRoot(), manifest.id);

  // Mirror scaffold -> buildDir (recursive overwrite so changes propagate; dist/
  // node_modules/.git filtered so build output never sneaks into the copy).
  await mkdir(buildDir, { recursive: true });
  await cp(scaffoldDir, buildDir, {
    recursive: true,
    force: true,
    filter: (path) => {
      const rel = path.slice(scaffoldDir.length).replace(/^\/+/, '');
      if (!rel) return true;
      const top = rel.split('/')[0];
      return !(top === 'dist' || top === 'node_modules' || top === '.git');
    },
  });

  const scaffoldFresh = await isFresh(buildDir, scaffoldDir);
  if (!scaffoldFresh) {
    const result = await appBuilder.build(manifest.id, buildDir);
    if (!result.success) {
      // Register anyway - the error HTML serves instead of the placeholder.
      console.warn(`[featured-builder] ${manifest.id}: build failed - ${result.errors.join('; ')}`);
    } else {
      console.log(`[featured-builder] ${manifest.id}: built in ${result.durationMs.toFixed(0)}ms`);
    }
  }

  // userId='system' marks these registrations as platform-owned.
  await appRegistry.register(manifest.id, buildDir, 'system', manifest.name);

  // Backend scaffolds: the artifact-backend runtime resolves its bundle from the
  // record's data.projectDir - patch it to the mirror dir. Fresh read via the
  // store's mutate-update keeps the clobber window minimal (documented race).
  if (manifest.hasBackend) {
    try {
      await artifacts.update(manifest.id, (a) => {
        const data = (a.data ?? {}) as Record<string, unknown>;
        if (data.projectDir === buildDir) return a;
        return { ...a, data: { ...data, projectDir: buildDir } };
      });
    } catch (err) {
      console.warn(
        `[featured-builder] ${manifest.id}: projectDir patch failed - ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { built: !scaffoldFresh };
}

export interface FeaturedBuildResult {
  built: number;
  skipped: number;
  failed: number;
  registered: number;
}

/** Walk the featured catalog, materialise + build + register each scaffold, and
 *  queue self-healing screenshots. @param overrideRoot test hook only. */
export async function buildAndRegisterFeaturedArtifacts(overrideRoot?: string): Promise<FeaturedBuildResult> {
  const root = overrideRoot ?? featuredArtifactsDir();
  const result: FeaturedBuildResult = { built: 0, skipped: 0, failed: 0, registered: 0 };
  if (!existsSync(root)) return result;

  const dirEntries = await readdir(root, { withFileTypes: true });
  const ids = dirEntries.filter((e) => e.isDirectory()).map((e) => e.name);

  for (const id of ids) {
    const scaffoldDir = join(overrideRoot ? join(root, id) : featuredArtifactDir(id), 'scaffold');
    if (!existsSync(scaffoldDir)) continue;
    const manifest = await readManifestLite(scaffoldDir);
    if (!manifest) {
      console.warn(`[featured-builder] ${id}: missing/invalid scaffold manifest, skipping`);
      result.failed++;
      continue;
    }
    // MANDATORY gate (ch07 §7.13): an unresolvable bare import crashes the esbuild
    // service process uncatchably - skip cleanly instead.
    const bareImports = await collectBareImports(scaffoldDir);
    const missing = unresolvableImports(bareImports);
    if (missing.length > 0) {
      console.warn(`[featured-builder] ${id}: skipping - unresolvable bare import(s): ${missing.join(', ')}`);
      result.failed++;
      continue;
    }
    try {
      // buildAndRegisterOne judges freshness against the ACTUAL build source
      // (working copy for customized, mirror for scaffold) and reports whether it
      // built - a pre-computed guess against the mirror was always stale for
      // customized artifacts (they build from the working copy), miscounting them
      // as `built` and re-shooting every boot.
      const { built } = await buildAndRegisterOne(scaffoldDir, manifest);
      result.registered++;
      if (built) result.built++;
      else result.skipped++;

      // Fire-and-forget screenshot; self-heal only when the prior PNG is missing.
      // EKOA_SCREENSHOTS_DISABLED=1 skips capture entirely (the same toggle class
      // §7.11 sanctions for the health scanner; tests and headless CI use it).
      const shotPath = join(getArtifactScreenshotDir(), `${manifest.id}.png`);
      const needsShot = built || !existsSync(shotPath);
      if (needsShot && process.env.EKOA_SCREENSHOTS_DISABLED !== '1') {
        void (async () => {
          try {
            await captureArtifactScreenshot(manifest.id);
          } catch (err) {
            console.warn(
              `[featured-builder] ${manifest.id}: screenshot capture failed - ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        })();
      }
    } catch (err) {
      result.failed++;
      console.warn(
        `[featured-builder] ${manifest.id}: build/register failed - ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
