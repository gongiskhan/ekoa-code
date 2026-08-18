import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ContainmentError,
  realRoot,
  resolveWithinGrant,
  relativeToRealRoot,
} from '../../src/containment/index.js';

/**
 * Coverage for THE single resolver. The temp tree mirrors the fake-daemon adversarial suite
 * (`ekoa-code/api/tests/fake-daemon/adversarial.test.ts` S1 block): a granted dir with an in-grant
 * file, a sibling `outside/` dir with a secret, an in-grant symlink to an in-grant file, and an
 * in-grant symlink escaping to the secret. Trees are built per-test via mkdtemp — never committed
 * fixtures. Synthetic contents only. Plus the HARDENED nonexistent-target branch (docs/decisions.md
 * "Containment resolver hardened beyond the harness for write-back"): a missing leaf under an
 * escaping in-grant symlink must be DENIED (write-escape), and a missing leaf given via a symlinked
 * root form must be ALLOWED (no allow/deny flip on existence).
 */
let root: string;
let grantRoot: string;
let linksOk = false;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ekoa-containment-'));
  grantRoot = join(root, 'granted');
  mkdirSync(grantRoot, { recursive: true });
  mkdirSync(join(root, 'outside'), { recursive: true });
  writeFileSync(join(grantRoot, 'contrato.txt'), 'in-grant contract body, section 3.1');
  writeFileSync(join(root, 'outside', 'secret.txt'), 'SECRET outside the grant');
  linksOk = false;
  try {
    symlinkSync(join(grantRoot, 'contrato.txt'), join(grantRoot, 'inside-link'));
    symlinkSync(join(root, 'outside', 'secret.txt'), join(grantRoot, 'escape-link'));
    // A DIRECTORY symlink escaping the grant, and a DANGLING file symlink escaping the grant — both
    // exercise the missing-leaf-under-escaping-link branch that the read-only harness mishandled.
    symlinkSync(join(root, 'outside'), join(grantRoot, 'dirlink'));
    symlinkSync(join(root, 'outside', 'does-not-exist.txt'), join(grantRoot, 'dangling-escape'));
    linksOk = true;
  } catch {
    /* symlinks unsupported on this filesystem */
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** True only when the grant root's realpath differs from its lexical path (root is itself a symlink,
 *  e.g. macOS /var -> /private/var). Used to skip the symlinked-root assertions honestly elsewhere. */
function rootIsSymlinked(): boolean {
  return realRoot(grantRoot) !== grantRoot;
}

describe('resolveWithinGrant — containment (S1)', () => {
  it('resolves an in-grant read path to the real file', () => {
    const resolved = resolveWithinGrant(grantRoot, 'contrato.txt');
    expect(resolved).toBe(realpathSync(join(grantRoot, 'contrato.txt')));
    expect(resolved.startsWith(realRoot(grantRoot))).toBe(true);
  });

  it('DENIES a ../ traversal read outside the grant', () => {
    expect(() => resolveWithinGrant(grantRoot, '../outside/secret.txt')).toThrow(ContainmentError);
    try {
      resolveWithinGrant(grantRoot, '../outside/secret.txt');
    } catch (err) {
      expect((err as ContainmentError).reason).toBe('path escapes the granted root: ../outside/secret.txt');
    }
  });

  it.skipIf(!process.platform)('ALLOWS a symlink inside the grant pointing at an in-grant file', (ctx) => {
    if (!linksOk) ctx.skip();
    const resolved = resolveWithinGrant(grantRoot, 'inside-link');
    expect(resolved).toBe(realpathSync(join(grantRoot, 'contrato.txt')));
  });

  it('DENIES a symlink to an EXISTING out-of-grant target', (ctx) => {
    if (!linksOk) ctx.skip();
    expect(() => resolveWithinGrant(grantRoot, 'escape-link')).toThrow(ContainmentError);
  });

  it('DENIES a missing leaf UNDER an escaping DIRECTORY symlink (write-escape closed)', (ctx) => {
    if (!linksOk) ctx.skip();
    // granted/dirlink -> <root>/outside (exists, resolves OUTSIDE). A create of dirlink/new.txt must
    // NOT be handed back an in-grant-looking path — that would let a write land outside the grant.
    expect(() => resolveWithinGrant(grantRoot, 'dirlink/new.txt')).toThrow(ContainmentError);
  });

  it('DENIES a DANGLING escape symlink (missing target, still resolves outside)', (ctx) => {
    if (!linksOk) ctx.skip();
    // granted/dangling-escape -> <root>/outside/does-not-exist.txt (target missing). The nearest
    // existing ancestor is the escape link's parent inside the grant, but the link itself resolves
    // out: resolving it must deny, not fall back to an in-grant lexical path.
    expect(() => resolveWithinGrant(grantRoot, 'dangling-escape')).toThrow(ContainmentError);
  });

  it('DENIES an absolute path outside the grant', () => {
    expect(() => resolveWithinGrant(grantRoot, join(root, 'outside', 'secret.txt'))).toThrow(ContainmentError);
  });

  it('ALLOWS an absolute path inside the grant — existing AND missing leaf alike (no existence flip)', () => {
    const insideExisting = join(grantRoot, 'contrato.txt');
    expect(resolveWithinGrant(grantRoot, insideExisting)).toBe(realpathSync(insideExisting));
    // The bug the review caught: on a symlinked root, an absolute in-grant path with a MISSING leaf
    // must still be ALLOWED (a create target), not denied because realpath(fullPath) throws.
    const insideMissing = join(grantRoot, 'to-create.txt');
    const resolvedMissing = resolveWithinGrant(grantRoot, insideMissing);
    expect(resolvedMissing).toBe(join(realRoot(grantRoot), 'to-create.txt'));
  });

  it('DENIES a nonexistent path reached via traversal', () => {
    expect(() => resolveWithinGrant(grantRoot, '../nope/missing.txt')).toThrow(ContainmentError);
  });

  it('ALLOWS a nonexistent in-grant leaf and returns the REAL-root path (caller handles ENOENT)', () => {
    const resolved = resolveWithinGrant(grantRoot, 'missing.txt');
    expect(resolved).toBe(join(realRoot(grantRoot), 'missing.txt'));
    // Regression guard for the false-denial: same request via a relative name and via the absolute
    // real-root name must agree, and neither may throw.
    expect(resolveWithinGrant(grantRoot, join(realRoot(grantRoot), 'missing.txt'))).toBe(resolved);
  });

  it('ALLOWS a nested nonexistent in-grant path (nearest existing ancestor is in-grant)', () => {
    const resolved = resolveWithinGrant(grantRoot, 'sub/dir/new.txt');
    expect(resolved).toBe(join(realRoot(grantRoot), 'sub', 'dir', 'new.txt'));
  });

  it('ALLOWS the grant root itself (".")', () => {
    expect(resolveWithinGrant(grantRoot, '.')).toBe(realRoot(grantRoot));
  });
});

describe('symlinked-root behaviour (ledger-path parity) — via an explicit root symlink', () => {
  let linkRoot: string;
  let haveRootLink = false;

  beforeEach(() => {
    // Build a REAL symlink to the grant root so the symlinked-root path is exercised on every OS,
    // not just incidentally on macOS /var. `linkRoot` is a symlink that points at grantRoot.
    linkRoot = join(root, 'grant-link');
    haveRootLink = false;
    try {
      symlinkSync(grantRoot, linkRoot);
      haveRootLink = true;
    } catch {
      /* symlinks unsupported */
    }
  });

  it('resolves via a symlinked root and yields a clean relative ledger path (no ../)', (ctx) => {
    if (!haveRootLink) ctx.skip();
    const resolved = resolveWithinGrant(linkRoot, 'contrato.txt');
    // realpath of the link equals realpath of the grant, so the file is contained.
    expect(resolved).toBe(realpathSync(join(grantRoot, 'contrato.txt')));
    const rel = relativeToRealRoot(linkRoot, resolved);
    expect(rel).toBe('contrato.txt');
    expect(rel.startsWith('..')).toBe(false);
  });

  it('a missing leaf under a symlinked root is ALLOWED (create target, no existence flip)', (ctx) => {
    if (!haveRootLink) ctx.skip();
    const resolved = resolveWithinGrant(linkRoot, 'new.txt');
    expect(resolved).toBe(join(realRoot(linkRoot), 'new.txt'));
    expect(existsSync(dirname(resolved))).toBe(true);
  });
});

describe('relativeToRealRoot', () => {
  it("returns '.' (NOT the absolute real path) when the path IS the root — no local path leaks to a ledger row", () => {
    const rootReal = realRoot(grantRoot);
    const rel = relativeToRealRoot(grantRoot, rootReal);
    expect(rel).toBe('.');
    // The absolute path (username + local layout) must never appear — ledger rows go to Cortex.
    expect(rel).not.toContain(grantRoot);
    expect(rel.startsWith('/')).toBe(false);
  });

  it('accepts a precomputed real root and yields the same result (hot-path syscall avoidance)', () => {
    const resolved = resolveWithinGrant(grantRoot, 'contrato.txt');
    const withRecompute = relativeToRealRoot(grantRoot, resolved);
    const withPrecomputed = relativeToRealRoot(grantRoot, resolved, realRoot(grantRoot));
    expect(withPrecomputed).toBe(withRecompute);
    expect(withPrecomputed).toBe('contrato.txt');
  });

  it('is meaningful on a symlinked root specifically', () => {
    if (!rootIsSymlinked()) return expect(true).toBe(true); // documented: only asserts where root is a symlink
    const resolved = resolveWithinGrant(grantRoot, 'contrato.txt');
    expect(relativeToRealRoot(grantRoot, resolved).startsWith('..')).toBe(false);
  });
});
