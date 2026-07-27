import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { resolveContained, assertNotSensitivePath, PathContainmentError } from '../../src/security/path-containment.js';

/**
 * SECURITY SUITE — ekoa_action filesystem containment (Cofre R-1; invariants I5, I1, I2, I4).
 *
 * `resolveUserPath` was `if (isAbsolute(path)) return path;`, so a MODEL-authored manifest recipe
 * had unrestricted read/write on the API host and the bytes landed in the persisted capturedValues
 * and in the calling agent's tool result. Each case below pins one escape.
 */
describe('resolveContained', () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    const base = mkdtempSync(join(tmpdir(), 'ekoa-containment-'));
    mkdirSync(join(base, 'workspace'), { recursive: true });
    mkdirSync(join(base, 'outside'), { recursive: true });
    // realpath BOTH: on macOS mkdtemp returns /var/... which is a symlink to /private/var/...,
    // so a raw startsWith(root) comparison would fail against the resolver's canonical output.
    root = realpathSync(join(base, 'workspace'));
    outside = realpathSync(join(base, 'outside'));
    writeFileSync(join(outside, 'secret.txt'), 'TOP-SECRET');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('allows an ordinary relative path inside the root', () => {
    const { real } = resolveContained(root, 'notes/report.json');
    expect(real.startsWith(root)).toBe(true);
  });

  it('refuses an absolute path outside the root (the exact old behaviour)', () => {
    // The old resolver returned this verbatim.
    expect(() => resolveContained(root, '/etc/passwd')).toThrow(PathContainmentError);
  });

  it('refuses traversal out of the root', () => {
    expect(() => resolveContained(root, '../outside/secret.txt')).toThrow(/escapes the workspace root/);
    expect(() => resolveContained(root, 'a/b/../../../outside/secret.txt')).toThrow(/escapes/);
  });

  it('refuses a symlink pointing outside the root (real path, not lexical)', () => {
    symlinkSync(join(outside, 'secret.txt'), join(root, 'innocent.txt'));
    expect(() => resolveContained(root, 'innocent.txt')).toThrow(/escapes the workspace root/);
  });

  it('refuses a NOT-YET-EXISTING leaf reached through an escaping symlink (the write-escape)', () => {
    // A naive "realpath, fall back to lexical on ENOENT" hands back an in-root-looking path here
    // and lets file.write land outside. This is the case the daemon resolver was hardened for.
    symlinkSync(outside, join(root, 'link-to-outside'));
    expect(() => resolveContained(root, 'link-to-outside/newfile.txt')).toThrow(/escapes/);
  });

  it('allows a not-yet-existing leaf that genuinely stays inside', () => {
    const { real } = resolveContained(root, 'sub/dir/newfile.txt');
    expect(real.startsWith(root)).toBe(true);
  });

  it('refuses a NUL byte and an empty path', () => {
    expect(() => resolveContained(root, 'a\0b')).toThrow(/NUL/);
    expect(() => resolveContained(root, '')).toThrow(/empty path/);
  });

  it('allows an absolute path that genuinely IS inside the root', () => {
    const { real } = resolveContained(root, join(root, 'notes.txt'));
    expect(real).toBe(join(root, 'notes.txt'));
  });

  it('refuses a host-absolute path rather than reinterpreting it as root-relative', () => {
    // Silently rewriting /etc/passwd to <root>/etc/passwd would turn a containment breach into a
    // confusing ENOENT and hide what the recipe actually asked for.
    expect(() => resolveContained(root, '/etc/passwd')).toThrow(/escapes the workspace root/);
  });
});

describe('sensitive-path denylist (defence in depth, inside the root)', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ekoa-denylist-')));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    ['.env', '.env'],
    ['.env.production', '.env.production'],
    ['an ssh private key', 'id_rsa'],
    ['an ed25519 key', 'id_ed25519'],
    ['a PEM', 'server.pem'],
    ['a PKCS#12', 'cert.p12'],
    ['a PFX', 'cert.pfx'],
    ['a raw key', 'private.key'],
    ['npm credentials', '.npmrc'],
    ['netrc', '.netrc'],
    ['git credentials', '.git-credentials'],
  ])('refuses %s even inside the root', (_label, name) => {
    expect(() => resolveContained(root, name)).toThrow(/credential-bearing/);
  });

  it.each([['.ssh'], ['.aws'], ['.gnupg'], ['.kube'], ['.docker']])(
    'refuses the whole %s subtree',
    (dir) => {
      expect(() => resolveContained(root, `${dir}/anything`)).toThrow(/credential-bearing/);
    },
  );

  it('still allows ordinary workspace files', () => {
    expect(() => resolveContained(root, 'clients.json')).not.toThrow();
    expect(() => resolveContained(root, 'reports/2026/fees.csv')).not.toThrow();
    // A file merely CONTAINING "env" in its name is not credential-bearing.
    expect(() => resolveContained(root, 'environment-report.txt')).not.toThrow();
  });

  it('catches a benign NAME whose real target is credential-bearing', () => {
    mkdirSync(join(root, '.ssh'), { recursive: true });
    writeFileSync(join(root, '.ssh', 'id_rsa'), 'KEY');
    symlinkSync(join(root, '.ssh', 'id_rsa'), join(root, 'notes.txt'));
    // Denylist runs on the REAL path, so the label does not launder it.
    expect(() => resolveContained(root, 'notes.txt')).toThrow(/credential-bearing/);
  });

  it('assertNotSensitivePath is callable standalone (shared with the bridge resolver, H-7)', () => {
    expect(() => assertNotSensitivePath('/any/root/.env', '.env')).toThrow(PathContainmentError);
    expect(() => assertNotSensitivePath('/any/root/ok.json', 'ok.json')).not.toThrow();
  });
});

describe('the concrete exploits the gate found', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'ekoa-exploit-')));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('cannot read /proc/self/environ (provider keys, ENCRYPTION_KEY, JWT_SECRET)', () => {
    expect(() => resolveContained(root, '/proc/self/environ')).toThrow(PathContainmentError);
  });

  it('cannot read the host user home directory', () => {
    expect(() => resolveContained(root, homedir())).toThrow(PathContainmentError);
    expect(() => resolveContained(root, join(homedir(), '.ssh', 'id_rsa'))).toThrow(PathContainmentError);
  });

  it('cannot read a service-account JSON by absolute path', () => {
    expect(() => resolveContained(root, '/var/secrets/service-account.json')).toThrow(PathContainmentError);
  });

  it('confines a write that previously landed anywhere on the host', () => {
    const { real } = resolveContained(root, 'out.txt');
    writeFileSync(real, 'ok');
    expect(readFileSync(real, 'utf8')).toBe('ok');
    expect(real.startsWith(root)).toBe(true);
  });
});
