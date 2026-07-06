import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWithinJail, resolveSafePath, sandboxRoot, UnsafePathError } from '../../src/services/safe-path.js';

/**
 * Safe-path helper (ch09 invariant 10): jails user-derived paths to the owner
 * sandbox, hardened against `..` traversal, absolute-outside paths, and symlink
 * escapes (realpath re-check). Accepts a normal nested path.
 */

describe('resolveWithinJail', () => {
  let jail: string;
  let outside: string;

  beforeAll(() => {
    // realpath so the symlink re-check compares like-for-like on macOS (/var → /private/var).
    jail = realpathSync(mkdtempSync(join(tmpdir(), 'jail-')));
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'outside-')));
    mkdirSync(join(jail, 'a', 'b'), { recursive: true });
    // A symlink INSIDE the jail pointing at an existing directory OUTSIDE it.
    symlinkSync(outside, join(jail, 'escape'));
  });

  afterAll(() => {
    rmSync(jail, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('accepts a normal nested relative path', () => {
    expect(resolveWithinJail(jail, 'a/b/c.txt')).toBe(join(jail, 'a/b/c.txt'));
  });

  it('accepts an absolute path inside the jail', () => {
    const p = join(jail, 'a', 'file.txt');
    expect(resolveWithinJail(jail, p)).toBe(p);
  });

  it('rejects `..` traversal out of the jail', () => {
    expect(() => resolveWithinJail(jail, '../evil.txt')).toThrow(UnsafePathError);
    expect(() => resolveWithinJail(jail, 'a/../../evil.txt')).toThrow(UnsafePathError);
  });

  it('rejects an absolute path outside the jail', () => {
    expect(() => resolveWithinJail(jail, '/etc/passwd')).toThrow(UnsafePathError);
    expect(() => resolveWithinJail(jail, join(outside, 'x'))).toThrow(UnsafePathError);
  });

  it('rejects a path that escapes the jail via a symlinked component', () => {
    expect(() => resolveWithinJail(jail, 'escape/secret.txt')).toThrow(UnsafePathError);
  });
});

describe('resolveSafePath (sandbox convenience)', () => {
  const prev = process.env.SANDBOX_ROOT;
  let root: string;
  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'sbx-')));
    process.env.SANDBOX_ROOT = root;
  });
  afterAll(() => {
    if (prev === undefined) delete process.env.SANDBOX_ROOT;
    else process.env.SANDBOX_ROOT = prev;
    rmSync(root, { recursive: true, force: true });
  });

  it('jails to the SANDBOX_ROOT and rejects escapes', () => {
    expect(sandboxRoot()).toBe(root);
    expect(resolveSafePath('user-1/app/index.ts')).toBe(join(root, 'user-1/app/index.ts'));
    expect(() => resolveSafePath('../../etc/passwd')).toThrow(UnsafePathError);
  });
});
