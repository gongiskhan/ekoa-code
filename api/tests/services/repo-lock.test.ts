import { describe, it, expect, beforeEach } from 'vitest';
import { withRepoLock } from '../../src/services/repo-lock.js';

/**
 * Per-repo lock (spec/07 §7.9): sections on the SAME key serialize (observable
 * ordering); sections on DIFFERENT keys run concurrently.
 */

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('withRepoLock', () => {
  let order: string[];
  beforeEach(() => {
    order = [];
  });

  async function section(tag: string, holdMs: number): Promise<void> {
    order.push(`${tag}:start`);
    await delay(holdMs);
    order.push(`${tag}:end`);
  }

  it('serializes two sections on the same key (B waits for A)', async () => {
    const a = withRepoLock('repo1', () => section('A', 40));
    const b = withRepoLock('repo1', () => section('B', 5));
    await Promise.all([a, b]);
    // B is queued behind A even though B is much shorter.
    expect(order).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
  });

  it('runs sections on different keys concurrently', async () => {
    const x = withRepoLock('repoX', () => section('X', 40));
    const y = withRepoLock('repoY', () => section('Y', 5));
    await Promise.all([x, y]);
    // Both start before either ends (interleaved), and the shorter one ends first.
    expect(order.slice(0, 2).sort()).toEqual(['X:start', 'Y:start']);
    expect(order.indexOf('Y:end')).toBeLessThan(order.indexOf('X:end'));
  });

  it('returns the real result and a rejection does not poison later work on the key', async () => {
    const value = await withRepoLock('repo2', async () => 42);
    expect(value).toBe(42);

    await expect(withRepoLock('repo2', async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    // The key is still usable after a rejected section.
    const after = await withRepoLock('repo2', async () => 'ok');
    expect(after).toBe('ok');
  });
});
