import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * THE CONSUMER BOUNDARY, as a test (E7 review F5).
 *
 * The boundary that keeps this package an API client rather than a second implementation is a set
 * of eslint zones, and a zone is only worth its comment if it FIRES. Two of these were dead when
 * written - the `bin` zone matched files the config globally ignored, and `scripts` was in no zone
 * at all - which nothing caught, because a rule that never fires and a rule that is satisfied look
 * identical in a green build.
 *
 * So each edge is exercised here through the real root config: a violating import must produce
 * `import/no-restricted-paths`, and the two ALLOWED edges must stay silent (a zone that flags
 * everything proves nothing either).
 *
 * NOT covered here: web/ -> clients/. web/ self-lints under its own flat config
 * (web/eslint.config.mjs), which this workspace does not load; that edge is enforced there by
 * `no-restricted-imports` and proved by running web's own lint.
 */
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The slice of eslint's Node API this test uses. Declared locally rather than pulled from
 * `@types/eslint`: eslint is the ROOT toolchain (like the api sources this suite's e2e harness
 * boots), and a consumer package should not grow a dependency to describe someone else's linter.
 */
interface LintMessage {
  ruleId: string | null;
  message: string;
}
interface EslintLike {
  lintText(code: string, opts: { filePath: string; warnIgnored?: boolean }): Promise<Array<{ messages: LintMessage[] }>>;
}
type EslintCtor = new (opts: { cwd: string }) => EslintLike;

let eslint: EslintLike;
let originalCwd: string;
beforeAll(() => {
  // The zones are written as paths relative to the REPO ROOT, and `import/no-restricted-paths`
  // resolves them against `process.cwd()` - not against the config file - so it only enforces
  // anything when eslint runs from the root, which is how `npm run lint` invokes it. Reproduce
  // that here rather than pretend the rule is location-independent: run from the root, and the
  // test is then testing the gate as CI actually runs it.
  originalCwd = process.cwd();
  process.chdir(repoRoot);
  const { ESLint } = createRequire(import.meta.url)('eslint') as { ESLint: EslintCtor };
  eslint = new ESLint({ cwd: repoRoot });
});
afterAll(() => {
  process.chdir(originalCwd);
});

/** Lint a hypothetical file at `path` and return the restricted-path messages it produced. */
async function zoneErrors(path: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: join(repoRoot, path), warnIgnored: false });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'import/no-restricted-paths')
    .map((m) => m.message);
}

describe('clients/ may not import the platform', () => {
  it.each([
    ['clients/cortex-cli/src/__zone-probe.ts', "import { buildApp } from '../../../api/src/server.js';"],
    ['clients/cortex-cli/bin/__zone-probe.mjs', "import { buildApp } from '../../../api/src/server.js';"],
    ['clients/cortex-cli/scripts/__zone-probe.mjs', "import { buildApp } from '../../../api/src/server.js';"],
  ])('%s -> api/ is refused', async (path, source) => {
    const errors = await zoneErrors(path, source);
    expect(errors.join('\n')).toContain('clients/ must not import from api/');
  });
});

describe('the platform may not depend on a consumer', () => {
  it.each([
    ['api/src/__zone-probe.ts', "import { CortexClient } from '../../clients/cortex-cli/src/client.js';"],
    ['api/src/__zone-probe.ts', "import { CortexClient } from '@ekoa/cortex-cli/dist/client.js';"],
    ['shared/src/__zone-probe.ts', "import { CortexClient } from '../../clients/cortex-cli/src/client.js';"],
  ])('%s importing %s is refused', async (path, source) => {
    const errors = await zoneErrors(path, source);
    expect(errors.join('\n')).toContain('must not import from clients/');
  });
});

describe('the edges that are ALLOWED stay silent', () => {
  it('clients/ -> shared/ is the contract, and is fine', async () => {
    expect(await zoneErrors('clients/cortex-cli/src/__zone-probe.ts', "import { ErrorEnvelope } from '@ekoa/shared';")).toEqual([]);
    expect(await zoneErrors('clients/cortex-cli/src/__zone-probe.ts', "import { OPERATIONS } from './generated/operations.js';")).toEqual([]);
  });

  it('clients/*/tests -> api/ is the deliberate carve-out for the in-process harness', async () => {
    expect(await zoneErrors('clients/cortex-cli/tests/__zone-probe.ts', "import { buildApp } from '../../../api/src/server.js';")).toEqual([]);
  });
});
