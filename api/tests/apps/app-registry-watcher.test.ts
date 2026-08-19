import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * app-registry watcher mechanics (2026-08-19, findings `artifact-family-test-leaks-watchers`).
 *
 * The registry used to hold ONE chokidar watcher PER REGISTERED APP, each closing over its own
 * appId, and attached no `error` listener to any of them. This suite pins the replacement:
 * a single lazily-created watcher driven with add()/unwatch(), events routed back to an app by
 * longest matching watched-path prefix, and watch failures degraded to a warning instead of an
 * unhandled rejection that kills the process.
 *
 * chokidar is mocked so every assertion here is deterministic - no real inotify, no sleeping on
 * filesystem events. The real-chokidar counterpart (paths actually watched, events actually
 * delivered) is `app-registry-watch-live.test.ts`.
 *
 * No app in this file exists on disk: `register()` tolerates a missing manifest (readManifest
 * returns null on ENOENT) and falls back to `<projectDir>/dist`, which is exactly the shape the
 * routing table needs. Keeping it off-disk keeps the suite hermetic and fast.
 */

/**
 * `vi.hoisted` runs BEFORE the file's imports are initialised, so the fake watcher carries its
 * own two-line emitter rather than extending `node:events`.
 */
const chokidarSpy = vi.hoisted(() => {
  class FakeWatcher {
    /** Paths currently watched by THIS watcher, as the registry has driven it. */
    live = new Set<string>();
    addCalls: string[][] = [];
    unwatchCalls: string[][] = [];
    closed = false;
    private handlers = new Map<string, ((...args: never[]) => void)[]>();

    on(event: string, fn: (...args: never[]) => void): this {
      const list = this.handlers.get(event) ?? [];
      list.push(fn);
      this.handlers.set(event, list);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const fn of this.handlers.get(event) ?? []) (fn as (...a: unknown[]) => void)(...args);
    }

    listenerCount(event: string): number {
      return (this.handlers.get(event) ?? []).length;
    }

    add(paths: string[]): this {
      this.addCalls.push([...paths]);
      for (const p of paths) this.live.add(p);
      return this;
    }

    unwatch(paths: string[]): this {
      this.unwatchCalls.push([...paths]);
      for (const p of paths) this.live.delete(p);
      return this;
    }

    async close(): Promise<void> {
      this.closed = true;
      this.live.clear();
    }
  }

  const state = {
    FakeWatcher,
    /** Every watcher the registry has ever constructed, in order. */
    created: [] as FakeWatcher[],
    /** Options the factory was called with, in order. */
    options: [] as unknown[],
    reset(): void {
      state.created = [];
      state.options = [];
    },
  };
  return state;
});

vi.mock('chokidar', () => ({
  watch: (paths: string[], options: unknown) => {
    const w = new chokidarSpy.FakeWatcher();
    w.add(paths);
    w.addCalls.length = 0; // the constructor's initial paths are not an add() call
    chokidarSpy.created.push(w);
    chokidarSpy.options.push(options);
    return w;
  },
}));

import { appRegistry } from '../../src/apps/app-registry.js';

const ROOT = '/nonexistent-ekoa-appreg';
/** projectDir for a synthetic app; with no manifest on disk its distDir is `<projectDir>/dist`. */
const proj = (name: string) => `${ROOT}/${name}`;
const manifestOf = (name: string) => `${ROOT}/${name}/manifest.json`;
const distOf = (name: string) => `${ROOT}/${name}/dist`;

/** The one watcher that should exist. Fails loudly if the registry made more than one. */
function onlyWatcher() {
  expect(chokidarSpy.created).toHaveLength(1);
  return chokidarSpy.created[0]!;
}

/** Drive a change through the shared watcher exactly as chokidar would. */
const emitChange = (path: string) => onlyWatcher().emit('change', path);
const emitUnlink = (path: string) => onlyWatcher().emit('unlink', path);

beforeEach(async () => {
  await appRegistry.stop();
  chokidarSpy.reset();
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  await appRegistry.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('app-registry: one shared watcher for the whole registry', () => {
  it('watches nothing until the first app is registered', () => {
    expect(chokidarSpy.created).toHaveLength(0);
  });

  it('creates exactly ONE watcher for N registered apps, adding each app\'s paths to it', async () => {
    const N = 12;
    for (let i = 0; i < N; i++) await appRegistry.register(`app${i}`, proj(`app${i}`));

    // The headline invariant. Before this change the registry called the chokidar factory once
    // per app, so this read `toHaveLength(12)`.
    expect(chokidarSpy.created).toHaveLength(1);
    expect(appRegistry.size).toBe(N);

    const watcher = onlyWatcher();
    expect(watcher.addCalls).toHaveLength(N - 1); // app0 came in through the factory
    const live = [...watcher.live];
    for (let i = 0; i < N; i++) {
      expect(live).toContain(manifestOf(`app${i}`));
      expect(live).toContain(distOf(`app${i}`));
    }
  });

  it('keeps the per-app watch options identical to the per-app watchers they replaced', async () => {
    await appRegistry.register('a', proj('a'));
    expect(chokidarSpy.options[0]).toMatchObject({
      ignoreInitial: true,
      persistent: true,
      ignored: /(^|[/\\])\.|node_modules/,
    });
  });
});

describe('app-registry: routing an event on the shared watcher back to its app', () => {
  it('notifies the app that owns the changed dist, and only that app', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));

    emitChange(`${distOf('a')}/index.html`);
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual(['a']);
  });

  it('routes a nested project to the INNER app (longest matching prefix), not its container', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    // `inner` lives inside `outer`'s dist tree, so the event path matches BOTH apps' watched
    // paths. Substring/first-match routing would hand it to `outer`.
    await appRegistry.register('outer', proj('outer'));
    await appRegistry.register('inner', `${distOf('outer')}/inner`);

    emitChange(`${distOf('outer')}/inner/dist/bundle.js`);
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual(['inner']);
  });

  it('does not let one app claim a sibling whose path merely starts with the same characters', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('site', proj('site'));
    await appRegistry.register('site-backup', proj('site-backup'));

    emitChange(`${distOf('site-backup')}/index.html`);
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual(['site-backup']); // a bare startsWith() on '/…/site' would say 'site'
  });

  it('ignores an event under no registered app', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));

    emitChange(`${ROOT}/somewhere-else/dist/index.html`);
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual([]);
  });

  it('debounces per app+file (100 ms) and keeps two apps\' bursts independent', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));

    emitChange(`${distOf('a')}/index.html`);
    emitChange(`${distOf('a')}/index.html`);
    emitChange(`${distOf('a')}/index.html`);
    emitChange(`${distOf('b')}/index.html`);
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toEqual([]); // still inside the debounce window
    await vi.advanceTimersByTimeAsync(100);

    expect(seen.sort()).toEqual(['a', 'b']); // one notification each, not three for 'a'
  });

  it('routes an unlink immediately (no debounce) and drops the manifest for the right app', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));

    emitUnlink(`${distOf('b')}/index.html`);
    expect(seen).toEqual(['b']); // synchronous, exactly as the per-app watchers behaved
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('app-registry: unregister touches only its own app', () => {
  it('unwatches that app\'s paths, leaves the others watched, and leaves the watcher open', async () => {
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));
    const watcher = onlyWatcher();

    await appRegistry.unregister('b');

    expect(watcher.closed).toBe(false);
    expect(watcher.unwatchCalls).toEqual([[manifestOf('b'), distOf('b')]]);
    expect([...watcher.live].sort()).toEqual([distOf('a'), manifestOf('a')].sort());
    expect(chokidarSpy.created).toHaveLength(1); // still the one watcher
  });

  it('clears only the unregistered app\'s pending debounce timers', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));

    emitChange(`${distOf('a')}/index.html`);
    emitChange(`${distOf('b')}/index.html`);
    expect(vi.getTimerCount()).toBe(2);

    await appRegistry.unregister('b');
    expect(vi.getTimerCount()).toBe(1); // b's timer gone, a's still armed

    await vi.advanceTimersByTimeAsync(150);
    expect(seen).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(0); // and nothing survives the flush
  });

  it('stops routing events to an unregistered app', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.unregister('a');

    emitChange(`${distOf('a')}/index.html`);
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual([]);
  });

  it('keeps a shared path watched while another app still wants it', async () => {
    // Two ids over the SAME project tree (a fork/rename mid-flight does exactly this). With one
    // watcher, unwatching on behalf of one must not blind the other.
    await appRegistry.register('a', proj('shared'));
    await appRegistry.register('a-copy', proj('shared'));
    const watcher = onlyWatcher();

    await appRegistry.unregister('a-copy');

    expect(watcher.unwatchCalls).toEqual([]);
    expect([...watcher.live].sort()).toEqual([distOf('shared'), manifestOf('shared')].sort());

    await appRegistry.unregister('a');
    expect([...watcher.live]).toEqual([]); // last owner gone -> now it is released
  });
});

describe('app-registry: stop() closes the one watcher and leaves the registry re-armable', () => {
  it('closes the watcher, empties the registry and clears every pending timer', async () => {
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));
    const watcher = onlyWatcher();
    emitChange(`${distOf('a')}/index.html`);
    emitChange(`${distOf('b')}/index.html`);
    expect(vi.getTimerCount()).toBe(2);

    await appRegistry.stop();

    expect(watcher.closed).toBe(true);
    expect(appRegistry.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-creates a fresh watcher on the next register (build-failure.test.ts stops in beforeEach and keeps going)', async () => {
    await appRegistry.register('a', proj('a'));
    await appRegistry.stop();
    await appRegistry.register('a', proj('a'));

    expect(chokidarSpy.created).toHaveLength(2);
    expect(chokidarSpy.created[0]!.closed).toBe(true);
    const fresh = chokidarSpy.created[1]!;
    expect(fresh.closed).toBe(false);
    expect([...fresh.live].sort()).toEqual([distOf('a'), manifestOf('a')].sort());

    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    fresh.emit('change', `${distOf('a')}/index.html`);
    await vi.advanceTimersByTimeAsync(150);
    expect(seen).toEqual(['a']); // and the re-armed watcher actually routes
  });

  it('drops dist-change listeners so a stopped registry notifies nobody', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.stop();
    chokidarSpy.reset();
    await appRegistry.register('a', proj('a'));

    emitChange(`${distOf('a')}/index.html`);
    await vi.advanceTimersByTimeAsync(150);
    expect(seen).toEqual([]);
  });
});

describe('app-registry: a host out of watch capacity degrades, it does not crash', () => {
  it('handles the watcher error event instead of leaving it to become an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await appRegistry.register('a', proj('a'));
    const watcher = onlyWatcher();

    // An EventEmitter 'error' with no listener THROWS; chokidar's own error path turns it into an
    // unhandled rejection. Either way the API process dies for a hot-reload convenience.
    expect(watcher.listenerCount('error')).toBe(1);

    const emfile = Object.assign(new Error("EMFILE: too many open files, watch '/x'"), { code: 'EMFILE' });
    expect(() => watcher.emit('error', emfile)).not.toThrow();
    expect(() => watcher.emit('error', emfile)).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1); // one warning, not one per failing path
    expect(String(warn.mock.calls[0]?.[0])).toContain('EMFILE');
  });

  it('still serves registered apps after a watch failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await appRegistry.register('a', proj('a'));
    onlyWatcher().emit('error', Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));

    expect(appRegistry.getApp('a')?.distDir).toBe(distOf('a'));
    expect(appRegistry.listApps().map((x) => x.id)).toEqual(['a']);
  });
});

describe('app-registry: concurrent registers for one id do not orphan watched paths', () => {
  it('leaves exactly one routing entry, so unregister releases everything it took', async () => {
    // register() checks `apps.has(appId)` and then AWAITS readManifest. Two concurrent calls for
    // one id both pass that guard; without serialisation the second overwrites the first's
    // routing entry and the first's paths stay watched forever.
    await Promise.all([appRegistry.register('a', proj('first')), appRegistry.register('a', proj('second'))]);
    const watcher = onlyWatcher();
    expect(appRegistry.size).toBe(1);

    await appRegistry.unregister('a');

    expect([...watcher.live]).toEqual([]);
  });
});
