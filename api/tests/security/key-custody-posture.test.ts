import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';
import { currentKeyWrapper } from '../../src/data/kms.js';

/**
 * SECURITY SUITE — the key-custody posture is machine-checked against the doc (Cofre A-8).
 *
 * WHY THIS EXISTS. `data/kms.ts` recorded an honesty requirement as a COMMENT: "docs/security.md's
 * threat model must not claim the KMS property while `LocalKeyWrapper` is the one in use." A comment
 * cannot fail a build. This suite is that requirement as a test, and it is the determinism ratchet
 * docs/security.md itself demands — the doc and the code cannot drift apart in EITHER direction.
 *
 * The difference the doc must not misstate is not cosmetic: under `LocalKeyWrapper` the per-tenant
 * DEKs are wrapped by a key derived from `ENCRYPTION_KEY`, so a database breach PLUS that one
 * environment variable yields plaintext. Under a Cloud KMS wrapper it does not. A reader who trusts
 * a stale doc mis-scopes an incident.
 *
 * TWO ASSERTIONS, AND WHY ONE IS NOT ENOUGH. The obvious check — the wrapper id published in
 * security.md equals `currentKeyWrapper().keyId` — is necessary but NOT sufficient on its own,
 * because these tests never run the composition root. If `server.ts` installed a KMS wrapper at
 * boot, `currentKeyWrapper()` here would still report the module default and the check would pass
 * while the doc was wrong about production. So the second assertion is that NOTHING in the shipped
 * tree calls `setKeyWrapper` — which is what makes the module default the thing every environment
 * actually runs. Together they are sound: wiring a real wrapper (K-2) turns this suite red, and the
 * fix is to update the published posture in the same change.
 */

const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/security
const ROOT = resolve(HERE, '../../..'); // <root>

/** The marker security.md publishes, e.g. `key-wrapper: local-v1`. */
const MARKER = /`key-wrapper:\s*([a-z0-9-]+)`/i;

/** Pure: pull the published wrapper id out of doc text, or null when the marker is absent. */
export function publishedWrapperId(docText: string): string | null {
  return docText.match(MARKER)?.[1] ?? null;
}

const SOURCE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

function walkSourceFiles(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(absDir)) {
    const abs = join(absDir, entry);
    if (statSync(abs).isDirectory()) out.push(...walkSourceFiles(abs));
    else if (SOURCE_EXT.has(abs.slice(abs.lastIndexOf('.')))) out.push(abs);
  }
  return out;
}

/**
 * Pure: does this line CALL setKeyWrapper (as opposed to declaring it)? `\b` matches after a dot,
 * so a namespace-qualified `kms.setKeyWrapper(...)` is caught too — a gate that only saw bare
 * calls would be silently defeated by an `import * as kms`.
 */
export function callsSetKeyWrapper(line: string): boolean {
  return /\bsetKeyWrapper\s*\(/.test(line) && !/export\s+function\s+setKeyWrapper/.test(line);
}

describe('published key-custody posture matches the installed wrapper', () => {
  const securityDoc = readFileSync(resolve(ROOT, 'docs/security.md'), 'utf8');

  it('docs/security.md publishes a wrapper id', () => {
    expect(publishedWrapperId(securityDoc)).not.toBeNull();
  });

  it('the published wrapper id IS the installed one', () => {
    expect(publishedWrapperId(securityDoc)).toBe(currentKeyWrapper().keyId);
  });

  it('the local wrapper is honestly labelled as local, not as KMS', () => {
    // Belt-and-braces on the one substitution that would be silently wrong: publishing a
    // kms-shaped id while the module default is still the ENCRYPTION_KEY-derived wrapper.
    const published = publishedWrapperId(securityDoc);
    if (currentKeyWrapper().keyId.startsWith('local')) {
      expect(published?.startsWith('kms')).toBe(false);
    }
  });
});

describe('the wrapper seam is unwired, which is what makes the module default authoritative', () => {
  const shippedDirs = ['api/src', 'api/scripts'];

  // Deliberately NO file-level allowlist, not even for kms.ts itself. The matcher already excludes
  // the declaration by SHAPE, so exempting the declaring file would buy nothing and would blind the
  // gate to a call placed inside it — the one file where a self-install is easiest to write.
  it('nothing in the shipped tree calls setKeyWrapper', () => {
    const hits: string[] = [];
    for (const dir of shippedDirs) {
      for (const abs of walkSourceFiles(resolve(ROOT, dir))) {
        const rel = relative(ROOT, abs).split('\\').join('/');
        readFileSync(abs, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (callsSetKeyWrapper(line)) hits.push(`${rel}:${i + 1}`);
          });
      }
    }
    // A hit is not a defect — it is K-2 landing. It means the posture published in
    // docs/security.md must be re-derived from the wrapper that boot actually installs.
    expect(hits).toEqual([]);
  });
});

describe('the matchers are not vacuous', () => {
  it('publishedWrapperId finds a planted id and reports absence', () => {
    expect(publishedWrapperId('Installed wrapper: `key-wrapper: kms-euw4-v1` - checked.')).toBe(
      'kms-euw4-v1',
    );
    expect(publishedWrapperId('no marker here')).toBeNull();
  });

  it('publishedWrapperId would DETECT a drifted doc', () => {
    // The failure this suite exists to catch, exercised against planted text so the assertion
    // above is provably a real comparison and not a pair of undefineds.
    expect(publishedWrapperId('`key-wrapper: kms-euw4-v1`')).not.toBe(currentKeyWrapper().keyId);
  });

  it('callsSetKeyWrapper detects a call and ignores the declaration', () => {
    expect(callsSetKeyWrapper('  setKeyWrapper(new CloudKmsWrapper(cfg));')).toBe(true);
    expect(callsSetKeyWrapper('kms.setKeyWrapper(w);')).toBe(true); // an `import * as kms` route
    expect(callsSetKeyWrapper('export function setKeyWrapper(next: KeyWrapper): void {')).toBe(
      false,
    );
    expect(callsSetKeyWrapper('const wrapper = currentKeyWrapper();')).toBe(false);
  });
});
