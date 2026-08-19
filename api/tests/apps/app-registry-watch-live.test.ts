import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import {
  readdirSync,
  readlinkSync,
  readFileSync,
  watch as fsWatch,
  mkdtempSync,
  mkdirSync,
  chmodSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appRegistry } from '../../src/apps/app-registry.js';

/**
 * app-registry against the REAL chokidar and the REAL filesystem (2026-08-19). The mocked suite
 * (`app-registry-watcher.test.ts`) pins the bookkeeping; this one MEASURES the resource, because
 * the bookkeeping cannot see it: a registry that dutifully forgets an app while chokidar keeps its
 * descriptors open sails through every mocked assertion.
 *
 * The measured resource is the inotify WATCH DESCRIPTOR, one per watched file and directory,
 * counted from `/proc/self/fdinfo` (`inotify wd:` lines on this process's inotify fds). It is the
 * resource `fs.inotify.max_user_watches` caps, and the one an unregister must give back.
 *
 * These cases need the OS to hand out watches. A dev box already at its per-user
 * `fs.inotify.max_user_instances` (128, and browsers/dev servers eat it fast) cannot, and the
 * REGISTRY'S contract there is to degrade quietly - which is what the mocked suite asserts. So
 * this file probes the capability once and SKIPS rather than reporting a red for the host's
 * state: a suite that goes red for a known-ignorable reason is how a real red gets ignored.
 */

/** Can this process watch a path at all? False on a host at its inotify instance cap. */
const WATCH_CAPABLE = (() => {
  try {
    fsWatch(tmpdir(), () => {}).close();
    return true;
  } catch {
    return false;
  }
})();

const ON_LINUX = process.platform === 'linux';

/**
 * Can a directory be made genuinely unreadable to THIS process? That is the safe way to provoke a
 * real chokidar `error` event: no global resource has to be exhausted, unlike the original repro
 * for this finding, which needed the host's whole `fs.inotify.max_user_instances` pool occupied.
 * Running as root, or on a filesystem that ignores mode bits, defeats it - hence the probe.
 */
const PERMISSION_DENIABLE = (() => {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'ekoa-permprobe-'));
    const locked = join(dir, 'locked');
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      readdirSync(locked);
      return false;
    } catch {
      return true;
    } finally {
      chmodSync(locked, 0o755);
    }
  } catch {
    return false;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
})();

let root: string;
const seenDistChanges: string[] = [];

/** inotify instances held by THIS process (Linux only; each is an anon_inode:inotify fd). */
function inotifyFds(): string[] {
  const fds: string[] = [];
  for (const fd of readdirSync('/proc/self/fd')) {
    try {
      if (readlinkSync(`/proc/self/fd/${fd}`) === 'anon_inode:inotify') fds.push(fd);
    } catch {
      /* fd closed between readdir and readlink */
    }
  }
  return fds;
}

/**
 * Watch DESCRIPTORS held by this process - the thing an unwatch/close is supposed to release, and
 * the thing `max_user_watches` counts. One per watched file and directory, so a `dist/` with ten
 * subdirectories is twelve of these, not one.
 */
function watchDescriptors(): number {
  let n = 0;
  for (const fd of inotifyFds()) {
    try {
      for (const line of readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8').split('\n')) {
        if (line.startsWith('inotify wd:')) n++;
      }
    } catch {
      /* fd closed between readdir and read */
    }
  }
  return n;
}

/** A project with a manifest, a dist, and `subdirs` directories inside dist. */
async function mkApp(id: string, subdirs = 0, parent = root): Promise<string> {
  const projectDir = join(parent, id);
  await mkdir(join(projectDir, 'dist'), { recursive: true });
  for (let i = 0; i < subdirs; i++) await mkdir(join(projectDir, 'dist', `sub${i}`), { recursive: true });
  await writeFile(
    join(projectDir, 'manifest.json'),
    JSON.stringify({ id, name: id, version: '1.0.0', entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/', type: 'jsx-app' }),
  );
  await writeFile(join(projectDir, 'dist', 'index.html'), '<html></html>');
  return projectDir;
}

/** Poll until `check` holds or the deadline passes; returns whether it held. */
async function until(check: () => boolean, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

/** chokidar's initial scan is async and `ignoreInitial` fires nothing for it - let it finish arming. */
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ekoa-appreg-live-'));
});

afterEach(async () => {
  await appRegistry.stop();
  seenDistChanges.length = 0;
});

afterAll(async () => {
  await appRegistry.stop();
  await rm(root, { recursive: true, force: true });
});

describe.runIf(WATCH_CAPABLE)('app-registry: the watchers really watch, and really route', () => {
  it('delivers a dist write to the owning app only', async () => {
    const a = await mkApp('live-a');
    const b = await mkApp('live-b');
    appRegistry.onDistChange((id) => seenDistChanges.push(id));
    await appRegistry.register('live-a', a);
    await appRegistry.register('live-b', b);
    await settle();

    await writeFile(join(a, 'dist', 'bundle.js'), '/* v1 */');

    expect(await until(() => seenDistChanges.includes('live-a'))).toBe(true);
    expect(seenDistChanges).not.toContain('live-b');
  });

  it('notifies EVERY app registered over the same project dir', async () => {
    // A fork or rename mid-flight leaves two ids over one tree. Each id has its own watcher, so
    // each is notified - the contract the per-app watchers have always had. A registry that routed
    // one shared watcher's event to a single winning app would notify only the first.
    const dir = await mkApp('live-twin');
    appRegistry.onDistChange((id) => seenDistChanges.push(id));
    await appRegistry.register('twin-a', dir);
    await appRegistry.register('twin-b', dir);
    await settle();

    await writeFile(join(dir, 'dist', 'bundle.js'), '/* v1 */');

    expect(await until(() => seenDistChanges.includes('twin-a') && seenDistChanges.includes('twin-b'))).toBe(true);
  });

  it('leaves a co-registered app watching when its twin is unregistered', async () => {
    const dir = await mkApp('live-twin-drop');
    appRegistry.onDistChange((id) => seenDistChanges.push(id));
    await appRegistry.register('drop-a', dir);
    await appRegistry.register('drop-b', dir);
    await settle();

    await appRegistry.unregister('drop-a');
    await settle();
    await writeFile(join(dir, 'dist', 'after.js'), '/* v2 */');

    expect(await until(() => seenDistChanges.includes('drop-b'))).toBe(true);
    expect(seenDistChanges).not.toContain('drop-a');
  });

  it('leaves the enclosing app watching when a NESTED app is unregistered', async () => {
    // chokidar's `unwatch(path)` is permanent - it calls `_addIgnoredPath(path, recursive)` - so a
    // registry that unwatched a nested app's tree off a shared watcher would blind the enclosing
    // app for that subtree for good, and re-registering would not heal it. Closing that app's own
    // watcher has no such effect on its neighbour's.
    const outer = await mkApp('live-outer');
    const inner = await mkApp('live-inner', 0, join(outer, 'dist'));
    appRegistry.onDistChange((id) => seenDistChanges.push(id));
    await appRegistry.register('live-outer', outer);
    await appRegistry.register('live-inner', inner);
    await settle();

    await appRegistry.unregister('live-inner');
    await settle();
    await writeFile(join(inner, 'dist', 'after.js'), '/* v2 */');

    expect(await until(() => seenDistChanges.includes('live-outer'))).toBe(true);
    expect(seenDistChanges).not.toContain('live-inner');
  });

  it.runIf(PERMISSION_DENIABLE)(
    'HANDLES a real chokidar error event, so the run does not die of an unhandled rejection',
    async () => {
      // The whole finding, end to end and without exhausting anything global: an unreadable
      // directory inside a watched dist makes real chokidar emit a real `error`. With no listener
      // that becomes an unhandled rejection and vitest fails the RUN while reporting every test as
      // passed - measured here at exit 1 with "Unhandled Rejection: EACCES: permission denied,
      // watch '<dist>/locked'" and the test itself still green. With the listener: exit 0, one
      // warning, the app still registered and served.
      const projectDir = await mkApp('live-eacces');
      const locked = join(projectDir, 'dist', 'locked');
      await mkdir(locked, { recursive: true });
      await chmod(locked, 0o000);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await appRegistry.register('live-eacces', projectDir);
        await settle(1500);

        expect(warn.mock.calls.map((c) => String(c[0]))).toContain('[app-registry] watcher error:');
        expect(appRegistry.getApp('live-eacces')?.distDir).toBe(join(projectDir, 'dist'));
      } finally {
        warn.mockRestore();
        await chmod(locked, 0o755);
      }
    },
    30_000,
  );

  it('re-arms after stop(): a fresh watcher still delivers events', async () => {
    const a = await mkApp('live-rearm');
    appRegistry.onDistChange((id) => seenDistChanges.push(id));
    await appRegistry.register('live-rearm', a);
    await appRegistry.stop();

    appRegistry.onDistChange((id) => seenDistChanges.push(id)); // stop() drops listeners
    await appRegistry.register('live-rearm', a);
    await settle();

    await writeFile(join(a, 'dist', 'after-stop.js'), '/* v2 */');
    expect(await until(() => seenDistChanges.includes('live-rearm'))).toBe(true);
  });
});

describe.runIf(WATCH_CAPABLE && ON_LINUX)('app-registry: watch descriptors, measured', () => {
  const APPS = 6;
  const SUBDIRS = 8;
  /** manifest.json + dist + one per subdirectory. */
  const PER_APP = SUBDIRS + 2;

  it(
    'gives every watch descriptor back when its app is unregistered',
    async () => {
      const dirs: string[] = [];
      for (let i = 0; i < APPS; i++) dirs.push(await mkApp(`live-fd-${i}`, SUBDIRS));
      await settle();
      const baseline = watchDescriptors();

      for (let i = 0; i < APPS; i++) await appRegistry.register(`live-fd-${i}`, dirs[i]!);
      await settle(800);
      const armed = watchDescriptors();
      // Sanity: the fixture really is many descriptors per app, so the release below is a real
      // measurement and not a comparison of two zeroes.
      expect(armed - baseline).toBeGreaterThanOrEqual(APPS * PER_APP);

      await appRegistry.unregister('live-fd-0');
      await settle();
      const afterOne = watchDescriptors();
      expect(armed - afterOne).toBeGreaterThanOrEqual(PER_APP);

      for (let i = 1; i < APPS; i++) await appRegistry.unregister(`live-fd-${i}`);
      await settle();

      // The whole point. `FSWatcher.unwatch(dist)` releases the descriptor for `dist` and leaves
      // every subdirectory below it watched, so the process footprint would ratchet up to the
      // high-water mark of every app ever registered. `close()` gives all of them back.
      expect(watchDescriptors()).toBe(baseline);
      expect(appRegistry.size).toBe(0);
    },
    60_000,
  );

  it(
    'gives every watch descriptor back on stop()',
    async () => {
      await settle();
      const baseline = watchDescriptors();
      for (let i = 0; i < APPS; i++) await appRegistry.register(`live-stopfd-${i}`, await mkApp(`live-stopfd-${i}`, SUBDIRS));
      await settle(800);
      expect(watchDescriptors() - baseline).toBeGreaterThanOrEqual(APPS * PER_APP);

      await appRegistry.stop();
      await settle();

      expect(watchDescriptors()).toBe(baseline);
    },
    60_000,
  );

  it(
    'DOCUMENTS (does not guard) that watcher count is not the inotify INSTANCE count',
    async () => {
      // This case cannot fail on anything this repo controls - libuv keeps one inotify instance per
      // event loop and hands every fs.watch a descriptor on it, so the count below is 1 whether the
      // registry holds one watcher or a hundred. It is here because the opposite was assumed, twice,
      // and drove a change: the ceiling a many-app host can genuinely reach is `max_user_watches`
      // (the descriptors the two cases above measure), never `max_user_instances`.
      const before = inotifyFds().length;
      for (let i = 0; i < 24; i++) await appRegistry.register(`live-many-${i}`, await mkApp(`live-many-${i}`));
      await settle(800);

      expect(appRegistry.size).toBe(24);
      expect(inotifyFds().length - before).toBeLessThanOrEqual(1);
    },
    60_000,
  );
});
