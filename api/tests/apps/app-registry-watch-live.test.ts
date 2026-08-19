import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { readdirSync, readlinkSync, watch as fsWatch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appRegistry } from '../../src/apps/app-registry.js';

/**
 * app-registry against the REAL chokidar and the REAL filesystem (2026-08-19). The mocked suite
 * (`app-registry-watcher.test.ts`) pins the routing logic; this one proves the shared watcher is
 * actually wired to the filesystem - a watcher whose paths were never really added would sail
 * through every mocked assertion.
 *
 * It also measures the resource the collapse is often WRONGLY assumed to save. libuv keeps one
 * inotify instance per event loop and every fs.watch adds a watch DESCRIPTOR to it, so the
 * per-process instance count is 1 whether the registry holds one watcher or hundreds. The
 * assertion below is deliberately `<= 1` rather than "N watchers cost N instances": it documents
 * the measured truth so nobody re-derives the wrong ceiling from this file.
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

let root: string;
const seenDistChanges: string[] = [];

/** inotify instances held by THIS process (Linux only; each is an anon_inode:inotify fd). */
function inotifyInstances(): number {
  let n = 0;
  for (const fd of readdirSync('/proc/self/fd')) {
    try {
      if (readlinkSync(`/proc/self/fd/${fd}`) === 'anon_inode:inotify') n++;
    } catch {
      /* fd closed between readdir and readlink */
    }
  }
  return n;
}

async function mkApp(id: string): Promise<string> {
  const projectDir = join(root, id);
  await mkdir(join(projectDir, 'dist'), { recursive: true });
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

describe.runIf(WATCH_CAPABLE)('app-registry: the shared watcher really watches, and really routes', () => {
  it('delivers a dist write to the owning app only', async () => {
    const a = await mkApp('live-a');
    const b = await mkApp('live-b');
    appRegistry.onDistChange((id) => seenDistChanges.push(id));
    await appRegistry.register('live-a', a);
    await appRegistry.register('live-b', b);
    // chokidar's initial scan is async; ignoreInitial means nothing fires for it, so give it a
    // beat to finish arming before mutating anything.
    await new Promise((r) => setTimeout(r, 400));

    await writeFile(join(a, 'dist', 'bundle.js'), '/* v1 */');

    expect(await until(() => seenDistChanges.includes('live-a'))).toBe(true);
    expect(seenDistChanges).not.toContain('live-b');
  });

  it.runIf(process.platform === 'linux')(
    'costs the process ONE inotify instance no matter how many apps are registered',
    async () => {
      const before = inotifyInstances();
      for (let i = 0; i < 24; i++) await appRegistry.register(`live-many-${i}`, await mkApp(`live-many-${i}`));
      await new Promise((r) => setTimeout(r, 400));

      expect(appRegistry.size).toBe(24);
      expect(inotifyInstances() - before).toBeLessThanOrEqual(1);
    },
    60_000,
  );

  it('re-arms after stop(): a fresh watcher still delivers events', async () => {
    const a = await mkApp('live-rearm');
    appRegistry.onDistChange((id) => seenDistChanges.push(id));
    await appRegistry.register('live-rearm', a);
    await appRegistry.stop();

    appRegistry.onDistChange((id) => seenDistChanges.push(id)); // stop() drops listeners
    await appRegistry.register('live-rearm', a);
    await new Promise((r) => setTimeout(r, 400));

    await writeFile(join(a, 'dist', 'after-stop.js'), '/* v2 */');
    expect(await until(() => seenDistChanges.includes('live-rearm'))).toBe(true);
  });
});
