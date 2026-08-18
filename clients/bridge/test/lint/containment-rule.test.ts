import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

/**
 * PROOF that the single-resolver lint enforcement actually fires (S1). We run the REPO'S REAL
 * `.eslintrc.cjs` over virtual files (via a filePath - no real files are written into src/) and
 * assert the ban holds in EVERY form a second path resolver could be smuggled in.
 *
 * The S2 review proved an earlier, narrower rule (member-call only) left the invariant unenforced in
 * exactly the idioms the resolver itself uses. Each payload below is one of those bypass forms; all
 * must be caught outside the owning modules, and the owning containment module must stay exempt.
 *
 * The config under test is the MONOREPO ROOT config, not a config this package owns. When the
 * daemon moved into `clients/bridge` its flat ESLint config was deleted and these rules were ported
 * into the root `.eslintrc.cjs` (Rule 4 there). A port is exactly the kind of change that can look
 * done and enforce nothing - a mistyped glob, a rule silently replaced by a later override - so
 * this suite points at the real root config and the real `clients/bridge/...` paths, and fails if
 * the ported rules do not fire on them.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** A bridge-relative source path as the ROOT config sees it. */
const inBridge = (rel: string) => path.join('clients', 'bridge', rel);

async function lintText(text: string, filePath: string) {
  // The repo enforces its boundaries through a legacy `.eslintrc.cjs`, which is what the `ESLint`
  // class resolves on ESLint 8 (flat config is the separate `FlatESLint`). `cwd` is the repo root
  // so that config is the one that cascades onto the file.
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(text, { filePath });
  expect(result).toBeDefined();
  return {
    errorCount: result!.errorCount,
    ruleIds: result!.messages.map((m) => m.ruleId),
  };
}

// Every way to reach realpath. Each MUST trigger no-restricted-syntax outside the resolver.
const REALPATH_FORMS: Array<{ name: string; code: string }> = [
  { name: 'member call', code: `import * as fs from 'node:fs';\nfs.realpathSync('/tmp');\n` },
  { name: 'bare named-import call', code: `import { realpathSync } from 'node:fs';\nrealpathSync('/tmp');\n` },
  { name: 'aliased named-import call', code: `import { realpathSync as rp } from 'node:fs';\nrp('/tmp');\n` },
  { name: '.native member call', code: `import * as fs from 'node:fs';\nfs.realpathSync.native('/tmp');\n` },
  { name: 'async realpath', code: `import { realpath } from 'node:fs/promises';\nawait realpath('/tmp');\n` },
];

// Every way to acquire the fs module. Each MUST be banned in a NON-owning module.
const FS_ACQUISITION_FORMS: Array<{ name: string; code: string; rule: string }> = [
  { name: 'static named import', code: `import { readFileSync } from 'node:fs';\nreadFileSync('/tmp/x');\n`, rule: 'no-restricted-imports' },
  { name: 'static namespace import', code: `import * as fs from 'fs';\nfs.readFileSync('/tmp/x');\n`, rule: 'no-restricted-imports' },
  { name: 'dynamic import()', code: `const fs = await import('node:fs');\nfs.readFileSync('/tmp/x');\n`, rule: 'no-restricted-syntax' },
  { name: 'require()', code: `const fs = require('fs');\nfs.readFileSync('/tmp/x');\n`, rule: 'no-restricted-syntax' },
  { name: 'process.getBuiltinModule', code: `const fs = process.getBuiltinModule('node:fs');\nfs.readFileSync('/tmp/x');\n`, rule: 'no-restricted-syntax' },
];

describe('containment lint enforcement (single-resolver rule, S1)', () => {
  // realpath must be unreachable outside the resolver by ANY containment rule. A direct call form
  // trips the syntax selector; an ALIASED import trips the import-binding ban instead — which rule
  // fires is an implementation detail, so we assert a containment rule fired, not which one.
  const CONTAINMENT_RULES = ['no-restricted-syntax', 'no-restricted-imports'];
  const firedAContainmentRule = (ruleIds: (string | null)[]) => ruleIds.some((r) => r !== null && CONTAINMENT_RULES.includes(r));

  describe('realpath is banned OUTSIDE the resolver in every call form', () => {
    for (const form of REALPATH_FORMS) {
      it(`bans realpath (${form.name}) in a non-owning module (src/engine)`, async () => {
        const { errorCount, ruleIds } = await lintText(form.code, inBridge('src/engine/violation.ts'));
        expect(errorCount, form.name).toBeGreaterThan(0);
        expect(firedAContainmentRule(ruleIds), `${form.name}: ${ruleIds.join(',')}`).toBe(true);
      });
      it(`bans realpath (${form.name}) in an fs-owning module (src/tools) too`, async () => {
        const { errorCount, ruleIds } = await lintText(form.code, inBridge('src/tools/reader.ts'));
        expect(errorCount, form.name).toBeGreaterThan(0);
        expect(firedAContainmentRule(ruleIds), `${form.name}: ${ruleIds.join(',')}`).toBe(true);
      });
    }
  });

  describe('fs acquisition is banned OUTSIDE the fs-owning modules in every form', () => {
    for (const form of FS_ACQUISITION_FORMS) {
      it(`bans fs acquisition (${form.name}) in a non-owning module (src/engine)`, async () => {
        const { errorCount, ruleIds } = await lintText(form.code, inBridge('src/engine/violation.ts'));
        expect(errorCount, form.name).toBeGreaterThan(0);
        expect(ruleIds, form.name).toContain(form.rule);
      });
    }
  });

  it('EXEMPTS the owning containment module from every ban (all realpath forms clean)', async () => {
    for (const form of REALPATH_FORMS) {
      const { ruleIds } = await lintText(form.code, inBridge('src/containment/resolver-extra.ts'));
      expect(ruleIds, form.name).not.toContain('no-restricted-syntax');
      expect(ruleIds, form.name).not.toContain('no-restricted-imports');
    }
  });

  it('ALLOWS static fs import in an fs-owning module (src/tools) — it owns fs access', async () => {
    const { ruleIds } = await lintText(`import { readFileSync } from 'node:fs';\nreadFileSync('/tmp/x');\n`, inBridge('src/tools/reader.ts'));
    expect(ruleIds).not.toContain('no-restricted-imports');
  });

  it('does NOT leak the bridge fs ban onto the rest of the repo (api owns its own filesystem use)', async () => {
    // A ban that fired repo-wide would be enforcing something nobody agreed to, and would go
    // unnoticed here because every assertion above is about bridge paths. Pin the scope.
    const { ruleIds } = await lintText(`import { readFileSync } from 'node:fs';\nreadFileSync('/tmp/x');\n`, path.join('api', 'src', 'content', 'probe.ts'));
    expect(ruleIds).not.toContain('no-restricted-imports');
    expect(ruleIds).not.toContain('no-restricted-syntax');
  });
});
