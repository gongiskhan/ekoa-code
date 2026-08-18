#!/usr/bin/env node
/**
 * scripts/pack-dist.mjs - build the shippable `.tgz`.
 *
 * WHY THIS EXISTS AT ALL. The daemon is installed globally on operators' laptops
 * (`npm i -g ekoa-bridge-<version>.tgz`, see packaging/README.md), and it depends on `@ekoa/shared`
 * as a `*` workspace dependency. `*` resolves only inside this monorepo: npm on a laptop would try
 * to fetch `@ekoa/shared` from the registry, where it is not published, and the install would fail.
 * `clients/cortex-cli` sidesteps the same problem by copying shared's GENERATED TYPES, which works
 * because it only needs types at build time. That does not work here: the daemon uses shared's
 * RUNTIME - `BridgeFrame` and friends are zod schemas it parses every inbound frame with, and
 * `canonicalTaskBinding` is the function it signs bytes with. Those are values, not types.
 *
 * So the shipped artifact INLINES `@ekoa/shared` with esbuild, and everything else stays external
 * (playwright, ws, execa, zod, pdfjs-dist, mammoth, @vscode/ripgrep - real installs on the laptop,
 * some of them with native binaries or browser downloads that must not be bundled).
 *
 * The bundle is built into a staging tree, NEVER over `dist/`. `dist/` is the `tsc -b` output that
 * CI typechecks and the test suites run against, and quietly replacing one of its files with a
 * bundle would leave the working tree in a state `tsc -b` believes is current. The staging manifest
 * is DERIVED from this package's real package.json (devDependencies dropped, `@ekoa/shared` dropped
 * because it is now inlined) rather than hand-maintained, so it cannot drift from it.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGE = path.join(PKG_ROOT, '.pack');

const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));

/** Everything the laptop installs for real. `@ekoa/shared` is deliberately NOT here - it is inlined. */
const externalNames = Object.keys(pkg.dependencies ?? {}).filter((n) => n !== '@ekoa/shared');
// Subpaths too: extract-text.ts dynamic-imports 'pdfjs-dist/legacy/build/pdf.mjs', which esbuild
// would otherwise try to resolve and bundle even though the bare name is external.
const external = externalNames.flatMap((n) => [n, `${n}/*`]);

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(path.join(STAGE, 'dist', 'cli'), { recursive: true });

const outfile = path.join(STAGE, 'dist', 'cli', 'index.js');
await build({
  entryPoints: [path.join(PKG_ROOT, 'src', 'cli', 'index.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external,
  sourcemap: false,
  legalComments: 'none',
});
chmodSync(outfile, 0o755);

// The `bin` is executed directly, so it must keep the entry's `#!/usr/bin/env node`. esbuild
// preserves a leading shebang, but a silent loss here produces a globally-installed command that
// the shell tries to run as a shell script, so assert it rather than assume it.
if (!readFileSync(outfile, 'utf8').startsWith('#!')) {
  throw new Error('pack-dist: the bundle lost its shebang - the installed bin would not be executable');
}

// A bundle that still names the workspace dependency would fail on the laptop exactly as the
// unbundled one did, so assert the inlining actually happened rather than trusting the config.
const bundled = readFileSync(outfile, 'utf8');
if (/from\s*["']@ekoa\/shared["']/.test(bundled) || /require\(["']@ekoa\/shared["']\)/.test(bundled)) {
  throw new Error('pack-dist: @ekoa/shared survived as an import in the bundle - it would not resolve on a laptop');
}

cpSync(path.join(PKG_ROOT, 'packaging'), path.join(STAGE, 'packaging'), { recursive: true });

const shipped = {
  name: pkg.name,
  version: pkg.version,
  private: pkg.private,
  type: pkg.type,
  description: pkg.description,
  engines: pkg.engines,
  bin: pkg.bin,
  files: pkg.files,
  dependencies: Object.fromEntries(externalNames.map((n) => [n, pkg.dependencies[n]])),
};
writeFileSync(path.join(STAGE, 'package.json'), `${JSON.stringify(shipped, null, 2)}\n`);

execFileSync('npm', ['pack', '--pack-destination', PKG_ROOT], { cwd: STAGE, stdio: 'inherit' });

const tarball = readdirSync(PKG_ROOT).filter((f) => f.endsWith('.tgz')).sort();
console.log(`\npacked: ${tarball.map((f) => path.join(PKG_ROOT, f)).join('\n        ')}`);
