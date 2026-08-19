import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * app-registry watcher mechanics (2026-08-19, findings `artifact-family-test-leaks-watchers`).
 *
 * What this suite pins:
 *   - every registered app gets its OWN chokidar watcher, and `unregister()` CLOSES it (chokidar's
 *     `unwatch()` releases only the exact path handed to it and permanently ignores the subtree,
 *     so a registry-wide watcher driven with add()/unwatch() cannot release what it took - see
 *     `app-registry-watch-live.test.ts`, which measures the descriptors rather than asserting);
 *   - watch failures are HANDLED. chokidar reports an `fs.watch` failure as an `error` event, and
 *     an EventEmitter 'error' with no listener throws; here that lands as an unhandled rejection,
 *     which reddens a whole vitest run whose tests all passed. The EMFILE/ENOSPC warning is
 *     deduplicated across every app's watcher, so one host condition produces one warning;
 *   - register/unregister are serialised per appId, and `stop()` drains in-flight ops before it
 *     tears the state down.
 *
 * chokidar and manifest reads are mocked so every assertion here is deterministic - no real
 * inotify, no sleeping on filesystem events. The real-chokidar counterpart (descriptors actually
 * released, events actually delivered) is `app-registry-watch-live.test.ts`.
 */

/** The shape the test body uses; the class itself is built inside the mock factory. */
type FakeWatcher = {
  /** Paths this watcher was constructed over, minus anything unwatched. */
  live: Set<string>;
  closed: boolean;
  emit(event: string, ...args: unknown[]): boolean;
  listenerCount(event: string): number;
};

const chokidarSpy = vi.hoisted(() => {
  const state = {
    /** Every watcher the registry has constructed, in order. */
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

/**
 * The fake extends the REAL `node:events` EventEmitter rather than hand-rolling `on`/`emit`.
 * A hand-rolled emit that walks its handler list and returns cannot reproduce the behaviour this
 * suite exists to pin - a real emitter THROWS on an 'error' with no listener - so the error case
 * would pass against a registry that attaches no listener at all. The factory is async so it can
 * `await import` the emitter: `vi.hoisted` state is initialised before the file's imports, but a
 * `vi.mock` factory is not.
 */
vi.mock('chokidar', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWatcherImpl extends EventEmitter {
    live: Set<string>;
    closed = false;

    constructor(paths: string[]) {
      super();
      this.live = new Set(paths);
    }

    add(paths: string[]): this {
      for (const p of paths) this.live.add(p);
      return this;
    }

    unwatch(paths: string[]): this {
      for (const p of paths) this.live.delete(p);
      return this;
    }

    async close(): Promise<void> {
      this.closed = true;
    }
  }

  return {
    watch: (paths: string[], options: unknown) => {
      const w = new FakeWatcherImpl(paths);
      chokidarSpy.created.push(w as unknown as FakeWatcher);
      chokidarSpy.options.push(options);
      return w;
    },
  };
});

/**
 * `readManifest` is mocked too: it lets one case hold a register OPEN across a `stop()` (the
 * registry awaits it mid-register), which is the only way to exercise the drain.
 */
const manifestSpy = vi.hoisted(() => {
  const state = {
    impl: (async () => null) as (projectDir: string) => Promise<unknown>,
    /**
     * Set by the case that holds a register open across a `stop()`. Teardown always releases it:
     * `stop()` drains the op chain, so a gate left shut would hang `afterEach` rather than fail it.
     */
    release: null as (() => void) | null,
    reset(): void {
      state.release?.();
      state.release = null;
      state.impl = async () => null;
    },
  };
  return state;
});

vi.mock('../../src/apps/manifest.js', () => ({
  readManifest: (projectDir: string) => manifestSpy.impl(projectDir),
}));

import { appRegistry } from '../../src/apps/app-registry.js';

const ROOT = '/nonexistent-ekoa-appreg';
/** projectDir for a synthetic app; with no manifest its distDir is `<projectDir>/dist`. */
const proj = (name: string) => `${ROOT}/${name}`;
const manifestOf = (name: string) => `${ROOT}/${name}/manifest.json`;
const distOf = (name: string) => `${ROOT}/${name}/dist`;

/** The watcher created for the Nth `register()` call in this test, in order. */
const watcherAt = (index: number): FakeWatcher => {
  const w = chokidarSpy.created[index];
  expect(w, `no watcher was created at index ${index}`).toBeDefined();
  return w!;
};

beforeEach(async () => {
  await appRegistry.stop();
  chokidarSpy.reset();
  manifestSpy.reset();
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  vi.useRealTimers();
  manifestSpy.reset();
  await appRegistry.stop();
  vi.restoreAllMocks();
});

describe('app-registry: one chokidar watcher per registered app', () => {
  it('watches nothing until the first app is registered', () => {
    expect(chokidarSpy.created).toHaveLength(0);
  });

  it('gives each registered app its own watcher over its manifest.json and its dist', async () => {
    const N = 12;
    for (let i = 0; i < N; i++) await appRegistry.register(`app${i}`, proj(`app${i}`));

    expect(appRegistry.size).toBe(N);
    expect(chokidarSpy.created).toHaveLength(N);
    for (let i = 0; i < N; i++) {
      expect([...watcherAt(i).live].sort()).toEqual([distOf(`app${i}`), manifestOf(`app${i}`)].sort());
    }
  });

  it('passes every watcher the same options, ignoring dotfiles and node_modules', async () => {
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));

    expect(chokidarSpy.options).toHaveLength(2);
    for (const options of chokidarSpy.options) {
      expect(options).toMatchObject({ ignoreInitial: true, persistent: true });
      const { ignored } = options as { ignored: RegExp };
      // Assert the PATTERN, not `toMatchObject({ ignored: /.../ })`: a RegExp in vitest's expected
      // position is a MATCHER, so that form is satisfied by any RegExp at all - including one that
      // matches nothing. `source` is a string and compares as one.
      expect(ignored.source).toBe(String.raw`(^|[/\\])\.|node_modules`);
      expect(ignored.test(`${distOf('a')}/node_modules/pkg/index.js`)).toBe(true);
      expect(ignored.test(`${proj('a')}/.git/config`)).toBe(true);
      expect(ignored.test(`${distOf('a')}/index.html`)).toBe(false);
    }
  });
});

describe('app-registry: events reach the app that owns them', () => {
  it('notifies the app whose dist changed, and only that app', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));

    watcherAt(0).emit('change', `${distOf('a')}/index.html`);
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual(['a']);
  });

  it('debounces per app+file (100 ms) and keeps two apps\' bursts independent', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));

    watcherAt(0).emit('change', `${distOf('a')}/index.html`);
    watcherAt(0).emit('change', `${distOf('a')}/index.html`);
    watcherAt(0).emit('change', `${distOf('a')}/index.html`);
    watcherAt(1).emit('change', `${distOf('b')}/index.html`);
    await vi.advanceTimersByTimeAsync(50);
    expect(seen).toEqual([]); // still inside the debounce window
    await vi.advanceTimersByTimeAsync(100);

    expect(seen.sort()).toEqual(['a', 'b']); // one notification each, not three for 'a'
  });

  it('handles an unlink immediately, with no debounce', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));

    watcherAt(0).emit('unlink', `${distOf('a')}/index.html`);

    expect(seen).toEqual(['a']); // synchronous
    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats an edit of the app\'s own manifest.json as a manifest reload, not a dist change', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    manifestSpy.impl = async () => ({
      id: 'a',
      name: 'renamed',
      version: '1.0.0',
      entryPoint: 'x.jsx',
      outputDir: 'dist/',
      type: 'jsx-app',
    });
    await appRegistry.register('a', proj('a'));

    watcherAt(0).emit('change', manifestOf('a'));
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual([]);
    expect(appRegistry.getApp('a')?.name).toBe('renamed');
  });

  it('treats a BUILD OUTPUT whose filename ends in manifest.json as a dist change', async () => {
    // The guard used to be `filePath.endsWith('manifest.json')`, which also claims
    // `<dist>/app-manifest.json` - a perfectly ordinary build output - and swallows its
    // notification, so a rebuild that only rewrote that file never busted a cache.
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    let manifestReads = 0;
    manifestSpy.impl = async () => {
      manifestReads++;
      return null;
    };
    await appRegistry.register('a', proj('a'));
    manifestReads = 0; // the read register() itself does is not the one under test

    watcherAt(0).emit('change', `${distOf('a')}/app-manifest.json`);
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual(['a']);
    expect(manifestReads).toBe(0);
  });

  it('does not let the app\'s dist claim a sibling directory that merely shares its prefix', async () => {
    // Reachable, not contrived: a manifest edit re-points `app.distDir` but deliberately does NOT
    // re-point the WATCH (see the note on handleFileChange). So an app watching `<proj>/dist-backup`
    // can end up with `distDir = <proj>/dist`, and the paths its watcher really reports are the
    // dist-backup ones. `filePath.startsWith(app.distDir)` says `<proj>/dist-backup/index.html` is
    // inside `<proj>/dist`; matching on a whole path segment says it is not.
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    const manifest = (outputDir: string) => ({
      id: 'a',
      name: 'a',
      version: '1.0.0',
      entryPoint: 'x.jsx',
      outputDir,
      type: 'jsx-app',
    });
    manifestSpy.impl = async () => manifest('dist-backup/');
    await appRegistry.register('a', proj('a'));
    expect([...watcherAt(0).live]).toContain(`${proj('a')}/dist-backup`);

    manifestSpy.impl = async () => manifest('dist/');
    watcherAt(0).emit('change', manifestOf('a'));
    await vi.advanceTimersByTimeAsync(150);
    expect(appRegistry.getApp('a')?.distDir).toBe(distOf('a'));

    watcherAt(0).emit('change', `${proj('a')}/dist-backup/index.html`);
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual([]);
  });
});

describe('app-registry: unregister closes exactly one watcher', () => {
  it('closes that app\'s watcher and leaves the others open', async () => {
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));

    await appRegistry.unregister('b');

    expect(watcherAt(1).closed).toBe(true);
    expect(watcherAt(0).closed).toBe(false);
    expect(appRegistry.listApps().map((x) => x.id)).toEqual(['a']);
  });

  it('clears only the unregistered app\'s pending debounce timers', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));

    watcherAt(0).emit('change', `${distOf('a')}/index.html`);
    watcherAt(1).emit('change', `${distOf('b')}/index.html`);
    expect(vi.getTimerCount()).toBe(2);

    await appRegistry.unregister('b');
    expect(vi.getTimerCount()).toBe(1); // b's timer gone, a's still armed

    await vi.advanceTimersByTimeAsync(150);
    expect(seen).toEqual(['a']);
    expect(vi.getTimerCount()).toBe(0); // and nothing survives the flush
  });

  it('cancels only its own timers when one app id is a PREFIX of another', async () => {
    // A manifest's `id` is any non-empty string (`validateManifest`), and boot registers every
    // user's apps into one registry, so `a` and `a:b` can coexist. Sweeping pending timers with
    // `key.startsWith('${appId}:')` over a flat `${appId}:${filePath}` map let `a`'s unregister
    // cancel `a:b`'s pending reload.
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('a:b', proj('a-b'));

    watcherAt(0).emit('change', `${distOf('a')}/index.html`);
    watcherAt(1).emit('change', `${distOf('a-b')}/index.html`);
    expect(vi.getTimerCount()).toBe(2);

    await appRegistry.unregister('a');
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(150);
    expect(seen).toEqual(['a:b']);
  });

  it('notifies nobody for an app that is already unregistered', async () => {
    const seen: string[] = [];
    appRegistry.onDistChange((id) => seen.push(id));
    await appRegistry.register('a', proj('a'));
    await appRegistry.unregister('a');

    watcherAt(0).emit('change', `${distOf('a')}/index.html`);
    await vi.advanceTimersByTimeAsync(150);

    expect(seen).toEqual([]);
  });

  it('closes the old watcher when an app is re-registered over a new project dir', async () => {
    await appRegistry.register('a', proj('first'));
    await appRegistry.register('a', proj('second'));

    expect(chokidarSpy.created).toHaveLength(2);
    expect(watcherAt(0).closed).toBe(true);
    expect(watcherAt(1).closed).toBe(false);
    expect([...watcherAt(1).live].sort()).toEqual([distOf('second'), manifestOf('second')].sort());
  });
});

describe('app-registry: a host out of watch capacity degrades, it does not crash', () => {
  it('gives every watcher an error listener, so an EMFILE never becomes an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const id of ['a', 'b', 'c']) await appRegistry.register(id, proj(id));

    const emfile = () => Object.assign(new Error("EMFILE: too many open files, watch '/x'"), { code: 'EMFILE' });
    for (let i = 0; i < 3; i++) {
      expect(watcherAt(i).listenerCount('error')).toBe(1);
      // The fake is a real EventEmitter: with no listener this THROWS the error argument, exactly
      // as chokidar's watcher does inside its own promise chain.
      expect(() => watcherAt(i).emit('error', emfile())).not.toThrow();
    }
    watcherAt(0).emit('error', emfile()); // and a repeat on an already-reported watcher

    // The dedup is registry-wide: one host condition, one warning, however many apps are served.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('EMFILE');
  });

  it('keeps serving registered apps after a watch failure', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await appRegistry.register('a', proj('a'));

    watcherAt(0).emit('error', Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));

    expect(appRegistry.getApp('a')?.distDir).toBe(distOf('a'));
    expect(appRegistry.listApps().map((x) => x.id)).toEqual(['a']);
  });

  it('logs an unexpected watcher error every time, without the capacity dedup', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await appRegistry.register('a', proj('a'));

    watcherAt(0).emit('error', new Error('something else'));
    watcherAt(0).emit('error', new Error('something else'));

    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('app-registry: stop() closes everything and leaves the registry re-armable', () => {
  it('closes every watcher, empties the registry and clears every pending timer', async () => {
    await appRegistry.register('a', proj('a'));
    await appRegistry.register('b', proj('b'));
    watcherAt(0).emit('change', `${distOf('a')}/index.html`);
    watcherAt(1).emit('change', `${distOf('b')}/index.html`);
    expect(vi.getTimerCount()).toBe(2);

    await appRegistry.stop();

    expect(watcherAt(0).closed).toBe(true);
    expect(watcherAt(1).closed).toBe(true);
    expect(appRegistry.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-arms on the next register (build-failure.test.ts stops in beforeEach and keeps going)', async () => {
    await appRegistry.register('a', proj('a'));
    await appRegistry.stop();
    await appRegistry.register('a', proj('a'));

    expect(chokidarSpy.created).toHaveLength(2);
    expect(watcherAt(0).closed).toBe(true);
    const fresh = watcherAt(1);
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

    watcherAt(0).emit('change', `${distOf('a')}/index.html`);
    await vi.advanceTimersByTimeAsync(150);
    expect(seen).toEqual([]);
  });

  it('waits for an in-flight register, so no watcher outlives stop()', async () => {
    // registerLocked AWAITS readManifest and only then arms the watcher. A stop() that cleared the
    // state without draining would return with the registry apparently empty, and the register
    // would then resume and arm a watcher nothing holds a reference to - open for the life of the
    // process. That is the orphan `serialize` closes from the register side, re-opened from stop's.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    manifestSpy.impl = async () => {
      await gate;
      return null;
    };
    manifestSpy.release = release;

    const registering = appRegistry.register('a', proj('a'));
    await Promise.resolve(); // let registerLocked reach its await
    const stopping = appRegistry.stop();
    release();
    await Promise.all([registering, stopping]);

    expect(appRegistry.size).toBe(0);
    expect(chokidarSpy.created).toHaveLength(1);
    expect(watcherAt(0).closed).toBe(true);
  });
});

describe('app-registry: concurrent registers for one id do not orphan a watcher', () => {
  it('leaves exactly one open watcher, and unregister closes it', async () => {
    // register() checks `apps.has(appId)` and then AWAITS readManifest. Two concurrent calls for
    // one id both pass that guard; without serialisation the second overwrites the first's entry
    // in the watcher map and the first's watcher stays open forever.
    await Promise.all([appRegistry.register('a', proj('first')), appRegistry.register('a', proj('second'))]);
    expect(appRegistry.size).toBe(1);
    expect(chokidarSpy.created.filter((w) => !w.closed)).toHaveLength(1);

    await appRegistry.unregister('a');

    expect(chokidarSpy.created.filter((w) => !w.closed)).toHaveLength(0);
  });
});
