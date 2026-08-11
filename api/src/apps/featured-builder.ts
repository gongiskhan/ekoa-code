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
 *    and accepted - reference/invisible-behaviors §8.4);
 *  - before a `legal-*` artifact's screenshot is (re)captured, the shared "Fonseca
 *    & Associados" demo spine is ensured installed first (WS10 screenshot-seeding
 *    fix, see `ensureLegalDemoSpineInstalled` below) - a bare, uninteracted page
 *    load otherwise always shows the family's genuinely-empty first-run state,
 *    understating every one of the 29 legal-* artifacts regardless of how deep
 *    the app actually is.
 */
import { readFile, readdir, mkdir, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { appBuilder } from './builder.js';
import { appRegistry } from './app-registry.js';
import { artifacts } from '../data/stores.js';
import { recordedProjectDir } from './app-paths.js';
import { featuredArtifactsDir, featuredArtifactDir } from './featured-seeder.js';
import { captureArtifactScreenshot, getArtifactScreenshotDir } from '../services/artifact-screenshot.js';
import { getSharedBrowser } from '../services/browser-pool.js';
import { loadConfig } from '../config.js';

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
    const workingDir = recordedProjectDir(data); // jail-resolved (ch09 invariant 10), never raw
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

/**
 * ROOT CAUSE (WS10 screenshot-seeding gap). `captureArtifactScreenshot` does a bare,
 * uninteracted `page.goto()` - no login, no clicks. The `legal-*` family's shared client/
 * case spine (`window.__ekoa.shared`, served by `/api/app-shared/*`) requires no visitor
 * auth either (`served-data.ts` `scopeFor` derives the scope from the app's OWNER, not
 * the requester), so that is not the gate. The real gate is that the demo dataset itself
 * is never auto-loaded: `legal-nucleo`'s `DashboardPage.jsx` is the ONLY scaffold that
 * wires an "Instalar dados de demonstração" button (`data-testid="demo-instalar"`,
 * calling `instalarDemo()` from the family's shared, byte-identical `demo-spine.js`), and
 * a real user has to click it. Every other `legal-*` app only READS the same shared
 * collections - installing once, via legal-nucleo, seeds the "Fonseca & Associados" set
 * for the whole family in one shot, because the shared scope is keyed by OWNER
 * (`usr.<ownerUserId>`), not by individual app id - all 29 legal-* artifacts share one
 * owner (the bootstrap super-admin) and therefore one namespace.
 *
 * This function drives that exact button via a real page, rather than re-implementing
 * the seed content server-side - the dataset's own file header is explicit that
 * `demo-spine.js` is canonical and copied byte-for-byte into every scaffold
 * (`web/e2e/legal-shared-drift.spec.ts` pins that); a second, server-side copy would be
 * exactly the drift that spec exists to prevent. Idempotent and safe to call repeatedly:
 * `instalarDemo()` itself no-ops when already installed (the card shows "Remover..."
 * instead of "Instalar...", which this checks for before clicking anything).
 *
 * NOT called on every boot - only when the caller has decided a legal-* screenshot is
 * about to be (re)captured (see `buildAndRegisterFeaturedArtifacts` below), so a normal
 * steady-state boot with nothing to capture never pays for the extra page load.
 */
export async function ensureLegalDemoSpineInstalled(): Promise<{
  installed: boolean;
  alreadyInstalled: boolean;
}> {
  const browser = await getSharedBrowser();
  const page = await browser.newPage();
  try {
    const target = `http://localhost:${loadConfig().port}/apps/legal-nucleo/`;
    await page.goto(target, { waitUntil: 'networkidle', timeout: 30_000 });
    const installButton = page.locator('[data-testid="demo-instalar"]');
    if ((await installButton.count()) === 0) {
      // No install button - either already installed (the card shows "Remover
      // dados de demonstração" instead) or legal-nucleo isn't the build this
      // page resolved to. Either way there is nothing safe to click.
      return { installed: false, alreadyInstalled: true };
    }
    await installButton.click();
    // instalarDemo() reloads the page itself on success or failure - wait for that
    // navigation to settle rather than a fixed sleep, so this isn't flaky under load.
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    return { installed: true, alreadyInstalled: false };
  } finally {
    await page.close().catch(() => {});
  }
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
  // legal-nucleo first, whenever present: it is the only scaffold that hosts the
  // "Instalar dados de demonstração" button (ensureLegalDemoSpineInstalled navigates
  // straight to it), so it must already be built + registered before any OTHER
  // legal-* artifact in this same run can trigger that ensure step below.
  ids.sort((a, b) => (a === 'legal-nucleo' ? -1 : b === 'legal-nucleo' ? 1 : 0));
  let legalDemoEnsureAttempted = false;

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
        // WS10 screenshot-seeding fix: a legal-* screenshot about to be (re)captured
        // otherwise always shows the family's genuinely-empty first-run state. Ensure
        // the shared demo spine is installed ONCE per run (legal-nucleo sorts first
        // above, so it is already servable by the time any legal-* id reaches here) -
        // awaited, not fire-and-forget, so it always completes before the capture that
        // depends on it. A normal boot where nothing needs a shot never reaches this.
        if (manifest.id.startsWith('legal-') && !legalDemoEnsureAttempted) {
          legalDemoEnsureAttempted = true;
          try {
            const outcome = await ensureLegalDemoSpineInstalled();
            if (outcome.installed) {
              console.log('[featured-builder] legal-* shared demo spine installed for screenshot capture');
            }
          } catch (err) {
            console.warn(
              `[featured-builder] legal-* demo spine ensure failed (screenshots may show an empty state) - ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
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
