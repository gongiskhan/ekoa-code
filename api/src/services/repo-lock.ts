/**
 * Per-repo serialization lock (spec/07-app-pipeline.md §7.9; carryover services
 * sweep, `repo-lock` row).
 *
 * All git writes for a single app repo - agent-stop auto-commit, user file-save
 * commit, version restore, and the GitHub push - must be serialized so they can't
 * interleave and corrupt repo state. ONE lock per repo shared by the commit and
 * push paths, keyed by the same `projectDir`; two separate mutexes would not be
 * mutually exclusive. A simple per-key promise chain is sufficient at this scale.
 */

const chains = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after any in-flight work for `key` (typically a projectDir) has
 * settled, and before any later call for the same key. The caller receives the
 * real result/rejection; the internal sequencing chain never rejects (so a
 * rejected task with no follow-up doesn't surface as an unhandled rejection).
 */
export function withRepoLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = chains.get(key) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  const gate: Promise<unknown> = next.then(
    () => undefined,
    () => undefined,
  );
  const tracked = gate.finally(() => {
    if (chains.get(key) === tracked) chains.delete(key);
  });
  chains.set(key, tracked);
  return next;
}
