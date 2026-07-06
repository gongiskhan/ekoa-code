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
 */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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

class AppRegistry {
  private apps = new Map<string, RegisteredApp>();
  private watchers = new Map<string, FSWatcher>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private distChangeListeners: DistChangeListener[] = [];
  private _sandboxRoot: string | null = null;

  get sandboxRoot(): string {
    return this._sandboxRoot || process.env.SANDBOX_ROOT || join(homedir(), '.ekoa', 'sandboxes');
  }

  /** Register an app and start watching its manifest + dist. Idempotent (re-register replaces). */
  async register(appId: string, projectDir: string, userId?: string, name?: string): Promise<void> {
    if (this.apps.has(appId)) await this.unregister(appId);

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

  /** Unregister an app and stop its watcher. Static files remain on disk. */
  async unregister(appId: string): Promise<void> {
    const watcher = this.watchers.get(appId);
    if (watcher) {
      await watcher.close();
      this.watchers.delete(appId);
    }
    for (const [key, timer] of this.debounceTimers.entries()) {
      if (key.startsWith(`${appId}:`)) {
        clearTimeout(timer);
        this.debounceTimers.delete(key);
      }
    }
    this.apps.delete(appId);
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

  /** Stop all watchers and clear the registry (shutdown obligation, ch07 §7.16). */
  async stop(): Promise<void> {
    for (const id of [...this.apps.keys()]) await this.unregister(id);
    this.distChangeListeners = [];
  }

  private startWatcher(appId: string, projectDir: string, distDir: string): void {
    const watcher = chokidarWatch([join(projectDir, 'manifest.json'), distDir], {
      ignoreInitial: true,
      persistent: true,
      ignored: /(^|[/\\])\.|node_modules/,
    });

    const debouncedChange = (filePath: string) => {
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
    };

    watcher.on('add', debouncedChange);
    watcher.on('change', debouncedChange);
    watcher.on('unlink', (filePath) => this.handleFileRemove(appId, filePath));
    this.watchers.set(appId, watcher);
  }

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
