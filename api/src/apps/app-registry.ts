/**
 * App registry (ch07 §7.3; carryover B2 - adapted). Tracks REGISTERED (served) apps
 * and the metadata static serving needs: distDir, projectDir, userId, name, manifest.
 * Every registered app's manifest.json and dist directory are watched (100 ms per-file
 * debounce); dist changes notify listeners (cache busting / reload).
 * Boot scans the sandbox root's user-* project directories and registers only
 * projects with a valid manifest.json. Unregister keeps static files on disk.
 *
 * The B2 verdict drops the old per-app content maps (skills/recipes/instructions
 * hot-reloading) - dead weight in the new architecture; agent-facing content is
 * ch08's concern and never lives inside user app trees.
 *
 * ONE WATCHER FOR THE WHOLE REGISTRY (2026-08-19; findings `artifact-family-test-leaks-watchers`,
 * corrected in place that day - read it before assuming what this bought). The registry used to
 * hold a `Map<appId, FSWatcher>` - one chokidar watcher per served app, each closing over its own
 * appId. It now holds a single lazily-created FSWatcher
 * and drives it with `add()` / `unwatch()`, routing each event back to an app by LONGEST
 * matching watched-path prefix. Two things this buys, and one thing it deliberately does not:
 *
 *   - It bounds the failure noise. When the host cannot hand out watches at all (see the error
 *     handling below), chokidar reports one error per watcher, so N served apps used to produce
 *     N reports of one condition. One watcher reports it once.
 *   - It removes per-app watcher bookkeeping: one object, one set of listeners, one close.
 *   - It does NOT change how many inotify INSTANCES the process uses. libuv keeps a single
 *     inotify fd per event loop and every `fs.watch` in the process adds a watch DESCRIPTOR to
 *     it, so 1 watcher and 300 watchers both cost exactly one instance (measured, chokidar
 *     5.0.0 / Node 20.19.4 / Linux 6.17). Anyone reaching for this file to raise a supposed
 *     "~128 apps" ceiling from `fs.inotify.max_user_instances` is chasing the wrong resource:
 *     the per-user cap that a server hosting many apps can actually hit is
 *     `max_user_watches` (one per watched file and directory), and that is a function of the
 *     PATHS watched, which collapsing the watchers does not change.
 *
 * WATCH FAILURES NEVER TAKE THE PROCESS DOWN. Watching is a hot-reload convenience; serving
 * reads from disk and does not depend on it. chokidar surfaces `fs.watch` failures as an
 * `error` event, and an EventEmitter 'error' with no listener becomes an unhandled rejection -
 * which, under Node's default `--unhandled-rejections=throw`, kills the API server. The single
 * watcher therefore always carries an error listener that degrades to a warning.
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

/** Identical to the options the per-app watchers used; kept in one place now there is one watcher. */
const WATCH_OPTIONS = {
  ignoreInitial: true,
  persistent: true,
  ignored: /(^|[/\\])\.|node_modules/,
} as const;

class AppRegistry {
  private apps = new Map<string, RegisteredApp>();
  /** THE watcher. Created lazily on the first register, so a process that serves no app watches nothing. */
  private watcher: FSWatcher | null = null;
  /** Routing table: appId -> the absolute paths handed to the watcher for it. */
  private watchedPaths = new Map<string, string[]>();
  /** How many apps want each path watched - two apps may legitimately share one (nested trees). */
  private pathRefs = new Map<string, number>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
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

  /** Unregister an app and stop watching its paths. Static files remain on disk. */
  async unregister(appId: string): Promise<void> {
    return this.serialize(appId, async () => this.unregisterLocked(appId));
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
   * Close the watcher and clear the registry (shutdown obligation, ch07 §7.16). Leaves the
   * registry re-armable: a later `register()` creates a fresh watcher from scratch. Suites that
   * call `stop()` between cases and keep going depend on that.
   */
  async stop(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = null;
    this.apps.clear();
    this.watchedPaths.clear();
    this.pathRefs.clear();
    this.opChain.clear();
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.distChangeListeners = [];
    this.watchLimitWarned = false;
    if (watcher) await watcher.close();
  }

  /**
   * Runs `op` after any in-flight register/unregister for the SAME appId has settled.
   * `registerLocked` checks `apps.has(appId)` and then AWAITS `readManifest`, so without this
   * two concurrent registers for one id both pass the guard and the second overwrites the
   * first's routing entry, orphaning its watched paths. Failures never poison the chain: the
   * next link runs whichever way the previous one settled.
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
    if (this.apps.has(appId)) this.unregisterLocked(appId);

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
    this.watchApp(appId, projectDir, distDir);
    console.log(`[app-registry] registered "${appId}" (${resolvedName}) - dist: ${distDir}`);
  }

  private unregisterLocked(appId: string): void {
    const paths = this.watchedPaths.get(appId);
    if (paths) {
      this.watchedPaths.delete(appId);
      // Only stop watching a path no other registered app still wants (nested trees can share one).
      const dropped = paths.filter((path) => this.releasePath(path));
      if (dropped.length > 0) this.watcher?.unwatch(dropped);
    }
    const prefix = `${appId}:`;
    for (const [key, timer] of this.debounceTimers.entries()) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        this.debounceTimers.delete(key);
      }
    }
    this.apps.delete(appId);
  }

  /** Add this app's paths to the shared watcher, creating it on first use. */
  private watchApp(appId: string, projectDir: string, distDir: string): void {
    const paths = [resolve(projectDir, 'manifest.json'), resolve(distDir)];
    this.watchedPaths.set(appId, paths);
    const fresh = paths.filter((path) => this.retainPath(path));
    if (fresh.length === 0) return; // already watched for another app sharing the tree

    if (!this.watcher) {
      const watcher = chokidarWatch(fresh, WATCH_OPTIONS);
      watcher.on('add', (path: string) => this.onFsEvent(path, 'change'));
      watcher.on('change', (path: string) => this.onFsEvent(path, 'change'));
      watcher.on('unlink', (path: string) => this.onFsEvent(path, 'unlink'));
      watcher.on('error', (err: unknown) => this.onWatchError(err));
      this.watcher = watcher;
      return;
    }
    this.watcher.add(fresh);
  }

  private retainPath(path: string): boolean {
    const next = (this.pathRefs.get(path) ?? 0) + 1;
    this.pathRefs.set(path, next);
    return next === 1;
  }

  private releasePath(path: string): boolean {
    const next = (this.pathRefs.get(path) ?? 1) - 1;
    if (next <= 0) {
      this.pathRefs.delete(path);
      return true;
    }
    this.pathRefs.set(path, next);
    return false;
  }

  /**
   * Map a watcher event back to the app that asked for it. LONGEST matching watched-path prefix
   * wins, and a match is a whole path SEGMENT (`<watched>` or `<watched>/...`) - never a bare
   * substring - so `/apps/site` cannot claim an event under `/apps/site-backup`, and an app
   * nested inside another app's tree gets its own events rather than its parent's.
   */
  private routeToApp(filePath: string): string | undefined {
    let bestApp: string | undefined;
    let bestLength = -1;
    for (const [appId, paths] of this.watchedPaths.entries()) {
      for (const watched of paths) {
        if (filePath !== watched && !filePath.startsWith(watched + sep)) continue;
        if (watched.length > bestLength) {
          bestLength = watched.length;
          bestApp = appId;
        }
      }
    }
    return bestApp;
  }

  private onFsEvent(filePath: string, kind: 'change' | 'unlink'): void {
    const appId = this.routeToApp(filePath);
    if (!appId) return;
    if (kind === 'unlink') {
      this.handleFileRemove(appId, filePath);
      return;
    }
    const key = `${appId}:${filePath}`;
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        void this.handleFileChange(appId, filePath);
      }, 100),
    );
  }

  /**
   * Watching is best-effort. A host at its `fs.inotify.max_user_instances` /
   * `max_user_watches` cap answers every `fs.watch` with EMFILE / ENOSPC; without this listener
   * chokidar's error event becomes an unhandled rejection that ends the process. Serving is
   * unaffected (static files are read from disk), so this degrades to a warning - once.
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
   * NOT re-point the watch - the per-app watchers behaved the same way, and re-registering the app
   * (which every build path already does) re-arms it. Left alone here so this change stays a
   * watcher-plumbing change; the routing table deliberately keys off the paths actually WATCHED,
   * while the dist test below keys off the app's current `distDir`, exactly as before.
   */
  private async handleFileChange(appId: string, filePath: string): Promise<void> {
    const app = this.apps.get(appId);
    if (!app) return;

    if (filePath.endsWith('manifest.json')) {
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
    if (filePath.startsWith(app.distDir)) this.notifyDistChange(appId);
  }

  private handleFileRemove(appId: string, filePath: string): void {
    const app = this.apps.get(appId);
    if (!app) return;
    if (filePath.endsWith('manifest.json')) {
      app.manifest = null;
      return;
    }
    if (filePath.startsWith(app.distDir)) this.notifyDistChange(appId);
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

/** Extract the owner id from a sandbox path like .../sandboxes/user-abc123/project. */
function extractUserIdFromPath(projectDir: string): string {
  for (const part of projectDir.split('/')) {
    if (part.startsWith('user-')) return part.replace('user-', '');
  }
  return 'unknown';
}

export const appRegistry = new AppRegistry();
