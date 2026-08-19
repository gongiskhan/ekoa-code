/**
 * App registry (ch07 §7.3; carryover B2 - adapted). Tracks REGISTERED (served) apps
 * and the metadata static serving needs: distDir, projectDir, userId, name, manifest.
 * Each registered app's manifest.json and dist directory are watched via chokidar
 * (100 ms per-file debounce); dist changes notify listeners (cache busting / reload).
 * Boot scans the sandbox root's user-* project directories and registers only
 * projects with a valid manifest.json. Unregister keeps static files on disk.
 *
 * The B2 verdict drops the old per-app content maps (skills/recipes/instructions
 * hot-reloading) - dead weight in the new architecture; agent-facing content is
 * ch08's concern and never lives inside user app trees.
 *
 * WATCH FAILURES NEVER REACH THE TEST LANE OR THE LOG AS NOISE (2026-08-19; findings
 * `artifact-family-test-leaks-watchers`). chokidar surfaces an `fs.watch` failure as an `error`
 * event, and an EventEmitter 'error' with no listener throws - here, inside chokidar's own promise
 * chain, so it lands as an unhandled rejection. The API process survives that (server.ts installs
 * `uncaughtException` / `unhandledRejection` handlers that log and continue, before anything calls
 * `appRegistry.start()`), but vitest fails a RUN on an unhandled rejection even when every test
 * passes, which is how this surfaced. Every watcher therefore carries an `error` listener, and the
 * EMFILE/ENOSPC warning is deduplicated ACROSS watchers by a single registry-level flag, so a host
 * out of watch capacity produces one warning rather than one per served app. Serving is unaffected
 * either way: it reads from disk and never consults a watcher.
 *
 * ONE WATCHER PER APP, DELIBERATELY (same date, after measuring the alternative). Collapsing the
 * `Map<appId, FSWatcher>` into a single registry-wide watcher driven with `add()` / `unwatch()`
 * looks like a saving and is not:
 *
 *   - It saves no inotify INSTANCES. libuv keeps one inotify fd per event loop and every
 *     `fs.watch` in the process adds a watch DESCRIPTOR to it, so 1 watcher and 300 watchers both
 *     cost exactly one instance (measured, chokidar 5.0.0 / Node 20.19.4 / Linux 6.17). Anyone
 *     reaching for this file to raise a supposed "~128 apps" ceiling from
 *     `fs.inotify.max_user_instances` is chasing the wrong resource: the per-user cap a server
 *     hosting many apps can actually hit is `max_user_watches` (one per watched file and
 *     directory), a function of the PATHS watched, which the watcher count does not change.
 *   - It LEAKS the descriptors it was supposed to conserve. `FSWatcher.unwatch(path)` closes only
 *     the closers registered under that exact path string (chokidar 5.0.0 `_closePath`); every
 *     directory chokidar discovered BELOW it keeps its own live `fs.watch`. Measured with 8 apps
 *     of `dist/` + 10 subdirectories each: `close()` per app releases 96 of 96 descriptors,
 *     `unwatch()` releases 16. The process footprint would become the high-water mark of every app
 *     ever registered, reachable from `POST /api/company-space/:artifactId/stop` and
 *     `POST /api/dev/unregister`.
 *   - `unwatch()` is also permanent: it calls `_addIgnoredPath(path, {recursive:true})`, so
 *     unregistering an app NESTED inside another app's tree would blind the enclosing app for that
 *     subtree for the life of the watcher, and re-registering would not heal it.
 *
 * `close()` has none of those properties, and the one thing the collapse genuinely bought - one
 * failure report instead of N - is bought here by the shared warning flag instead.
 */
import { readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { watch as chokidarWatch, type FSWatcher } from 'chokidar';
import { readManifest, type AppManifest } from './manifest.js';

export interface RegisteredApp {
  /** Unique app id (matches the artifact id or manifest.id). */
  id: string;
  name: string;
  /** Absolute path to the build output directory (<projectDir>/<outputDir>). */
  distDir: string;
  /** Absolute path to the project root. */
  projectDir: string;
  /** Owner user id (extracted from the sandbox path when not provided). */
  userId: string;
  registeredAt: Date;
  manifest: AppManifest | null;
}

export type DistChangeListener = (appId: string) => void;

/** chokidar options, identical for every app's watcher; kept in one place. */
const WATCH_OPTIONS = {
  ignoreInitial: true,
  persistent: true,
  ignored: /(^|[/\\])\.|node_modules/,
} as const;

/** Bound on `stop()`'s drain: ops that keep chaining must never hang shutdown. */
const MAX_DRAIN_ROUNDS = 50;

class AppRegistry {
  private apps = new Map<string, RegisteredApp>();
  private watchers = new Map<string, FSWatcher>();
  /**
   * appId -> watched file -> pending 100 ms timer. Nested rather than keyed `${appId}:${filePath}`
   * with a `startsWith('${appId}:')` sweep on unregister: a manifest's `id` is an arbitrary
   * non-empty string (`validateManifest`), so an app called `a` unregistering used to cancel the
   * pending timers of an unrelated app called `a:b`, and boot registers every user's apps into
   * this one map.
   */
  private debounceTimers = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
  private distChangeListeners: DistChangeListener[] = [];
  private _sandboxRoot: string | null = null;
  /** Serialises register/unregister per appId (see `serialize`). */
  private opChain = new Map<string, Promise<void>>();
  /** One warning per registry lifetime when the host runs out of watch capacity. */
  private watchLimitWarned = false;

  get sandboxRoot(): string {
    return this._sandboxRoot || process.env.SANDBOX_ROOT || join(homedir(), '.ekoa', 'sandboxes');
  }

  /** Register an app and start watching its manifest + dist. Idempotent (re-register replaces). */
  async register(appId: string, projectDir: string, userId?: string, name?: string): Promise<void> {
    return this.serialize(appId, () => this.registerLocked(appId, projectDir, userId, name));
  }

  /** Unregister an app and close its watcher. Static files remain on disk. */
  async unregister(appId: string): Promise<void> {
    return this.serialize(appId, () => this.unregisterLocked(appId));
  }

  getApp(appId: string): RegisteredApp | undefined {
    return this.apps.get(appId);
  }

  listApps(): RegisteredApp[] {
    return [...this.apps.values()];
  }

  get size(): number {
    return this.apps.size;
  }

  /** Fires whenever a registered app's dist directory changes. */
  onDistChange(listener: DistChangeListener): void {
    this.distChangeListeners.push(listener);
  }

  /** Boot scan (ch07 §7.16): register every user-* project with a valid manifest. */
  async start(sandboxRoot: string): Promise<void> {
    this._sandboxRoot = sandboxRoot;
    let userDirs: string[];
    try {
      userDirs = await readdir(sandboxRoot);
    } catch {
      console.log('[app-registry] no sandboxes directory found, starting empty');
      return;
    }
    for (const userDir of userDirs) {
      if (!userDir.startsWith('user-')) continue;
      const userPath = join(sandboxRoot, userDir);
      const userId = userDir.replace('user-', '');
      let projects: string[];
      try {
        projects = await readdir(userPath);
      } catch {
        continue;
      }
      for (const project of projects) {
        const projectPath = join(userPath, project);
        try {
          const manifest = await readManifest(projectPath);
          if (manifest) await this.register(manifest.id, projectPath, userId, manifest.name);
        } catch {
          /* skip projects with invalid manifests */
        }
      }
    }
    console.log(`[app-registry] started - ${this.apps.size} app(s) loaded`);
  }

  /**
   * Close every watcher and clear the registry (shutdown obligation, ch07 §7.16). Leaves the
   * registry re-armable: a later `register()` builds fresh watchers. Suites that call `stop()`
   * between cases and keep going depend on that.
   *
   * It DRAINS the op chains first. `registerLocked` awaits `readManifest` mid-flight, so a stop
   * that tore the state down underneath an in-flight register would let that register resume
   * afterwards and arm a watcher nobody holds a reference to - the exact orphan `serialize` was
   * added to prevent, re-opened from the other side.
   */
  async stop(): Promise<void> {
    await this.drainOps();
    const watchers = [...this.watchers.values()];
    this.watchers.clear();
    this.apps.clear();
    this.opChain.clear();
    for (const byFile of this.debounceTimers.values()) for (const timer of byFile.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.distChangeListeners = [];
    this.watchLimitWarned = false;
    await Promise.all(watchers.map((w) => w.close()));
  }

  /** Wait for in-flight register/unregister work to settle (bounded; ops may chain). */
  private async drainOps(): Promise<void> {
    for (let round = 0; round < MAX_DRAIN_ROUNDS && this.opChain.size > 0; round++) {
      // Links never reject (see `serialize`), so this settles rather than short-circuits.
      await Promise.all([...this.opChain.values()]);
    }
  }

  /**
   * Runs `op` after any in-flight register/unregister for the SAME appId has settled.
   * `registerLocked` checks `apps.has(appId)` and then AWAITS `readManifest`, so without this
   * two concurrent registers for one id both pass the guard and the second overwrites the
   * first's watcher entry, leaving the first's watcher open forever. Failures never poison the
   * chain: the next link runs whichever way the previous one settled.
   */
  private serialize<T>(appId: string, op: () => Promise<T>): Promise<T> {
    const prior = this.opChain.get(appId) ?? Promise.resolve();
    const result = prior.then(op, op);
    const link = result.then(
      () => undefined,
      () => undefined,
    );
    this.opChain.set(appId, link);
    void link.then(() => {
      if (this.opChain.get(appId) === link) this.opChain.delete(appId);
    });
    return result;
  }

  private async registerLocked(appId: string, projectDir: string, userId?: string, name?: string): Promise<void> {
    if (this.apps.has(appId)) await this.unregisterLocked(appId);

    let manifest: AppManifest | null = null;
    try {
      manifest = await readManifest(projectDir);
    } catch {
      /* invalid manifest tolerated - serving still works from the default dist */
    }

    const outputDir = manifest?.outputDir || 'dist/';
    const distDir = resolve(projectDir, outputDir);
    const resolvedUserId = userId || extractUserIdFromPath(projectDir);
    const resolvedName = name || manifest?.name || appId;

    const app: RegisteredApp = {
      id: appId,
      name: resolvedName,
      distDir,
      projectDir,
      userId: resolvedUserId,
      registeredAt: new Date(),
      manifest,
    };
    this.apps.set(appId, app);
    this.startWatcher(appId, projectDir, distDir);
    console.log(`[app-registry] registered "${appId}" (${resolvedName}) - dist: ${distDir}`);
  }

  /**
   * `close()`, never `unwatch()`. See the header: `unwatch()` releases only the descriptor for the
   * exact path handed to it and permanently ignores that subtree; `close()` releases every
   * descriptor this app's watcher took.
   */
  private async unregisterLocked(appId: string): Promise<void> {
    const watcher = this.watchers.get(appId);
    this.watchers.delete(appId);
    for (const timer of this.debounceTimers.get(appId)?.values() ?? []) clearTimeout(timer);
    this.debounceTimers.delete(appId);
    this.apps.delete(appId);
    if (watcher) await watcher.close();
  }

  private startWatcher(appId: string, projectDir: string, distDir: string): void {
    const watcher = chokidarWatch([resolve(projectDir, 'manifest.json'), resolve(distDir)], WATCH_OPTIONS);

    const debouncedChange = (filePath: string) => {
      let byFile = this.debounceTimers.get(appId);
      if (!byFile) {
        byFile = new Map();
        this.debounceTimers.set(appId, byFile);
      }
      const existing = byFile.get(filePath);
      if (existing) clearTimeout(existing);
      byFile.set(
        filePath,
        setTimeout(() => {
          const current = this.debounceTimers.get(appId);
          current?.delete(filePath);
          if (current?.size === 0) this.debounceTimers.delete(appId);
          void this.handleFileChange(appId, filePath);
        }, 100),
      );
    };

    watcher.on('add', debouncedChange);
    watcher.on('change', debouncedChange);
    watcher.on('unlink', (filePath: string) => this.handleFileRemove(appId, filePath));
    watcher.on('error', (err: unknown) => this.onWatchError(err));
    this.watchers.set(appId, watcher);
  }

  /**
   * Watching is best-effort. A host at its `fs.inotify.max_user_instances` /
   * `max_user_watches` cap answers every `fs.watch` with EMFILE / ENOSPC; without this listener
   * chokidar's error event becomes an unhandled rejection, which reddens a whole vitest run whose
   * tests all passed. Serving is unaffected (static files are read from disk), so this degrades to
   * a warning - once per registry lifetime, across every app's watcher.
   */
  private onWatchError(err: unknown): void {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'EMFILE' || code === 'ENOSPC') {
      if (this.watchLimitWarned) return;
      this.watchLimitWarned = true;
      console.warn(
        `[app-registry] host is out of filesystem watch capacity (${code}) - dist hot-reload is off, serving is unaffected. Raise fs.inotify.max_user_instances / fs.inotify.max_user_watches.`,
      );
      return;
    }
    console.warn('[app-registry] watcher error:', err);
  }

  /**
   * PRE-EXISTING, PRESERVED: a manifest edit that moves `outputDir` updates `app.distDir` but does
   * NOT re-point the watch; re-registering the app (which every build path already does) re-arms
   * it.
   */
  private async handleFileChange(appId: string, filePath: string): Promise<void> {
    const app = this.apps.get(appId);
    if (!app) return;

    if (isManifestOf(app, filePath)) {
      try {
        app.manifest = await readManifest(app.projectDir);
        if (app.manifest) {
          app.name = app.manifest.name;
          app.distDir = resolve(app.projectDir, app.manifest.outputDir);
        }
      } catch {
        app.manifest = null;
      }
      return;
    }
    if (isUnderDist(app, filePath)) this.notifyDistChange(appId);
  }

  private handleFileRemove(appId: string, filePath: string): void {
    const app = this.apps.get(appId);
    if (!app) return;
    if (isManifestOf(app, filePath)) {
      app.manifest = null;
      return;
    }
    if (isUnderDist(app, filePath)) this.notifyDistChange(appId);
  }

  private notifyDistChange(appId: string): void {
    for (const listener of this.distChangeListeners) {
      try {
        listener(appId);
      } catch (err) {
        console.warn('[app-registry] dist change listener error:', err);
      }
    }
  }
}

/**
 * The app's OWN manifest.json, by whole path - not `filePath.endsWith('manifest.json')`, which
 * also claims a build output called `app-manifest.json` and swallows its dist notification.
 */
function isManifestOf(app: RegisteredApp, filePath: string): boolean {
  return filePath === resolve(app.projectDir, 'manifest.json');
}

/** Inside the app's dist, matched on a whole path SEGMENT so `dist` never claims `dist-backup`. */
function isUnderDist(app: RegisteredApp, filePath: string): boolean {
  return filePath === app.distDir || filePath.startsWith(app.distDir + sep);
}

/** Extract the owner id from a sandbox path like .../sandboxes/user-abc123/project. */
function extractUserIdFromPath(projectDir: string): string {
  for (const part of projectDir.split('/')) {
    if (part.startsWith('user-')) return part.replace('user-', '');
  }
  return 'unknown';
}

export const appRegistry = new AppRegistry();
