import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The shared legal layer must stay byte-identical across every legal scaffold.
 *
 * The apps are bundled by esbuild from their own scaffolds, so the shared files have to be
 * PHYSICALLY present in each one. That makes drift both easy and invisible: edit
 * `legal-citius`'s copy of `shared.js` to fix something, and 28 other apps keep the old
 * behaviour while every test still passes.
 *
 * HOW THIS CHANGED, AND WHY. The ported version shelled out to
 * `scripts/sync-legal-shared.mjs --check`, which compared each copy against a canonical
 * `ekoa-data/legal-shared/`. Neither the script nor that directory was ever ported into this repo,
 * so the spec did not test drift — it failed with MODULE_NOT_FOUND on every run, and had done so
 * for as long as the estate has been running. A spec that always fails protects nothing; it just
 * teaches everyone to expect a red line.
 *
 * Rather than import a canonical layer this repo has not chosen a home for — a real design
 * decision, not a mechanical port — this asserts the invariant the script existed to protect,
 * using only what is here: the copies must all AGREE. If they do, the canonical layer is whatever
 * they agree on, and drift is exactly the condition where they stop. That is the same guarantee
 * from the other end, and it needs nothing that does not exist.
 *
 * Discovery is by glob, deliberately (the old script's own reasoning): a legal app added tomorrow
 * is inside the gate the moment it has a scaffold, rather than being silently outside a list of
 * six that was already a list of 29.
 */
const REPO_ROOT = resolve(__dirname, '..', '..');
const FEATURED = join(REPO_ROOT, 'api/assets/featured-artifacts');

/** The shared layer, relative to `scaffold/frontend/src`. */
const SHARED_FILES = [
  'styles.css',
  'shared.js',
  'demo.js',
  'rcbe.js',
  'calculos-cliente.js',
  'assinatura-cliente.js',
  'demo-spine.js',
  'components/Layout.jsx',
  'components/Icons.jsx',
  'components/ui.jsx',
];

const srcDir = (app: string) => join(FEATURED, app, 'scaffold', 'frontend', 'src');

function legalApps(): string[] {
  if (!existsSync(FEATURED)) return [];
  return readdirSync(FEATURED, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('legal-'))
    .map((e) => e.name)
    .filter((name) => existsSync(srcDir(name)))
    .sort();
}

const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

test.describe('the shared legal layer does not drift between scaffolds', () => {
  const apps = legalApps();

  test('there are legal scaffolds to check at all', () => {
    // Guards the failure mode this replaces: a check that silently passes over an empty set is
    // indistinguishable from a check that passed.
    expect(apps.length, `no legal-* scaffolds found under ${FEATURED}`).toBeGreaterThan(1);
  });

  for (const file of SHARED_FILES) {
    test(`${file} is identical in every legal scaffold`, () => {
      const present = apps.filter((a) => existsSync(join(srcDir(a), file)));
      // Every app carries every shared file: a MISSING copy is drift too, and the loudest kind,
      // because the app builds without it and simply behaves differently.
      expect(present, `${file} missing from: ${apps.filter((a) => !present.includes(a)).join(', ')}`)
        .toEqual(apps);

      const byHash = new Map<string, string[]>();
      for (const app of present) {
        const h = digest(join(srcDir(app), file));
        byHash.set(h, [...(byHash.get(h) ?? []), app]);
      }
      const variants = [...byHash.entries()]
        .map(([h, owners]) => `  ${h.slice(0, 12)}  ${owners.join(', ')}`)
        .join('\n');
      expect(byHash.size, `${file} has ${byHash.size} variants across scaffolds:\n${variants}`).toBe(1);
    });
  }
});
