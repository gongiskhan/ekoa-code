/**
 * H5 committed grep gates (BRIEF Phase 10 deliverable 2). Two standing tree invariants of the
 * security block, asserted in-suite (they run in the FULL vitest lane the operator runs, mirroring
 * scripts/chokepoint-grep.sh's intent but self-contained + self-proving):
 *
 *   1. NO permissive-stub survives. H1 replaced the pre-security-block `can()` permissive stub with
 *      the real capability matrix and deleted its pinned stub test. The retired grep-marker
 *      `PERMISSIVE-STUB` / `PERMISSIVE_STUB` MUST NOT reappear anywhere in api/src or shared/src - a
 *      hit means a blanket-allow body crept back in.
 *   2. NO orphan `builder` ROLE ref. H1 renamed the role value `builder` -> `user`. A quoted
 *      `'builder'` / `"builder"` ROLE literal may survive ONLY in the small sanctioned allowlist
 *      below (the legacy-JWT shim, the migration query + its doc comments, and the web SESSION-KIND
 *      `builder` - a session kind, NOT a user role). A `'builder'` literal ANYWHERE else in api/src,
 *      shared/src, or web/{app,components,stores} is a NEW orphan role ref and FAILS the gate.
 *
 * NON-TAUTOLOGY: the matcher + allowlist logic are pure functions, unit-tested against planted
 * violations in the same file, so the gate is provably not vacuous (a real `'builder'` / stub marker
 * IS detected, and a non-allowlisted file IS flagged) without needing a one-off manual plant.
 *
 * SCOPE NOTE (why the org-setting KEY is not allowlisted): `allowBuilderAutomations` is the persisted
 * org-setting key whose data-compat wire name kept "Builder" after the role rename. It is an unquoted
 * identifier substring, so the quoted-role-literal matcher below never matches it - it needs no
 * allowlist entry, and this is asserted by the matcher self-test.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/security
const ROOT = resolve(HERE, '../../..'); // <root>

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** A single matched line, repo-relative (POSIX-normalised so the allowlist is portable). */
interface Hit {
  file: string; // repo-relative, forward-slashed
  line: number; // 1-based
  text: string;
}

/** Recursively collect source files under an absolute dir (skips non-existent dirs). */
function walkSourceFiles(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(absDir)) {
    const abs = join(absDir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      out.push(...walkSourceFiles(abs));
    } else if (SOURCE_EXT.has(abs.slice(abs.lastIndexOf('.')))) {
      out.push(abs);
    }
  }
  return out;
}

/** 1-based line numbers in `content` whose text matches `re` (re must be non-global). */
export function matchingLines(content: string, re: RegExp): number[] {
  const lines = content.split('\n');
  const nums: number[] = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i] as string)) nums.push(i + 1);
  return nums;
}

/** Scan every source file under the given repo-relative dirs for `re`, returning repo-relative hits. */
function scanTree(relDirs: string[], re: RegExp): Hit[] {
  const hits: Hit[] = [];
  for (const relDir of relDirs) {
    for (const abs of walkSourceFiles(resolve(ROOT, relDir))) {
      const content = readFileSync(abs, 'utf8');
      const relFile = relative(ROOT, abs).split(sep).join('/');
      for (const line of matchingLines(content, re)) {
        hits.push({ file: relFile, line, text: (content.split('\n')[line - 1] as string).trim() });
      }
    }
  }
  return hits;
}

// The retired permissive-stub grep marker (hyphen or underscore form).
const STUB_RE = /PERMISSIVE[-_]STUB/;
// A quoted `builder` ROLE literal: exactly `builder` (lowercase - a role value is never capitalised)
// bounded by a single or double quote on both sides. Deliberately does NOT match feature identifiers
// (`integrationBuilder`, `appBuilder`, `builderSessionId`), the site-builder detection code, the
// `pages.builder.*` locale namespace, or the `allowBuilderAutomations` org-setting key.
const BUILDER_RE = /['"]builder['"]/;

/**
 * The ONLY files permitted to carry a quoted `builder` role literal after the H1 rename. Each is a
 * sanctioned survivor - a NEW hit in ANY other file fails the gate. Repo-relative, forward-slashed.
 */
const BUILDER_ALLOWLIST = new Set<string>([
  // Legacy-JWT normalization shim (H1): a token minted before the rename still carries role
  // 'builder'; verifyToken maps it to 'user' at the single verify chokepoint (+ its doc comment).
  'api/src/auth/jwt.ts',
  // migrateBuilderRole: the idempotent boot migration query `users.find({ role: 'builder' })` that
  // rewrites any legacy row to 'user' and bumps its token epoch (+ its doc comments).
  'api/src/auth/users-service.ts',
  // web SESSION-KIND 'builder' - the app-building SESSION kind persisted server-side, NOT a user
  // ROLE. Out of the role model entirely (the H1 rename touched roles, not session kinds).
  'web/stores/orchestration.ts',
]);

describe('grep gate: no permissive stub survives (H5)', () => {
  it('PERMISSIVE-STUB / PERMISSIVE_STUB appears nowhere in api/src or shared/src', () => {
    const hits = scanTree(['api/src', 'shared/src'], STUB_RE);
    expect(
      hits,
      `retired permissive-stub marker resurfaced:\n${hits.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join('\n')}`,
    ).toEqual([]);
  });
});

describe('grep gate: no orphan `builder` role ref survives (H5)', () => {
  it('every quoted `builder` role literal in api/src + shared/src + ALL live web source roots is in the sanctioned allowlist', () => {
    const hits = scanTree(
      // ALL live web source roots (codex-h5 Low: web/lib + web/hooks + web/types + web/locales were
      // previously unscanned, so an orphan role literal there would have evaded the gate). web/e2e is
      // test code (excluded); node_modules/.next never appear under these source roots.
      ['api/src', 'shared/src', 'web/app', 'web/components', 'web/hooks', 'web/lib', 'web/locales', 'web/stores', 'web/types'],
      BUILDER_RE,
    );
    const orphans = hits.filter((h) => !BUILDER_ALLOWLIST.has(h.file));
    expect(
      orphans,
      `NEW orphan \`builder\` role ref (not in the sanctioned allowlist):\n${orphans
        .map((h) => `  ${h.file}:${h.line}  ${h.text}`)
        .join('\n')}\nIf this is a legitimate survivor, add it to BUILDER_ALLOWLIST with a comment; otherwise rename it to 'user'.`,
    ).toEqual([]);
    // Sanity: the allowlisted files ARE actually present in the tree (a stale allowlist entry that
    // no longer matches anything is dead weight the gate should surface).
    for (const allowed of BUILDER_ALLOWLIST) {
      const stillHasLiteral = hits.some((h) => h.file === allowed);
      expect(stillHasLiteral, `allowlist entry ${allowed} no longer carries a builder literal - prune it`).toBe(true);
    }
  });
});

/**
 * NON-TAUTOLOGY PROOF (in-suite, durable): the pure matcher + allowlist logic detect planted
 * violations and reject the exact identifiers they must NOT match. If someone weakens the regex into
 * a no-op, THESE fail - so the two tree scans above can never silently become vacuous.
 */
describe('grep gate matchers are not vacuous (H5 self-test)', () => {
  it('the builder-role matcher catches a planted role literal and ignores feature identifiers', () => {
    // Planted violations - MUST match.
    expect(matchingLines("const role = 'builder';", BUILDER_RE)).toEqual([1]);
    expect(matchingLines('body.role = "builder"', BUILDER_RE)).toEqual([1]);
    expect(matchingLines("Role = z.enum(['super-admin','org-admin','builder'])", BUILDER_RE)).toEqual([1]);
    // Legitimate non-role uses - MUST NOT match (the precision the gate depends on).
    expect(matchingLines('import { integrationBuilder } from "./x";', BUILDER_RE)).toEqual([]);
    expect(matchingLines('const builderSessionId = newId();', BUILDER_RE)).toEqual([]);
    expect(matchingLines('orgSettings.allowBuilderAutomations === true', BUILDER_RE)).toEqual([]);
    expect(matchingLines('detectSiteBuilder(url)', BUILDER_RE)).toEqual([]);
    expect(matchingLines('title: "Builder"', BUILDER_RE)).toEqual([]); // capitalised UI label, not a role value
  });

  it('the permissive-stub matcher catches both marker spellings', () => {
    expect(matchingLines('return true; // PERMISSIVE-STUB', STUB_RE)).toEqual([1]);
    expect(matchingLines('/* PERMISSIVE_STUB */', STUB_RE)).toEqual([1]);
    expect(matchingLines('// a permissive stub over these names', STUB_RE)).toEqual([]); // prose, not the marker
  });

  it('the allowlist is not a blanket pass - a NEW orphan ref in a non-allowlisted file is flagged', () => {
    const synthetic: Hit[] = [
      { file: 'api/src/routes/new-thing.ts', line: 7, text: "role: 'builder'" },
      { file: 'api/src/auth/jwt.ts', line: 61, text: "role 'builder'" }, // allowlisted survivor
    ];
    const orphans = synthetic.filter((h) => !BUILDER_ALLOWLIST.has(h.file));
    expect(orphans).toEqual([{ file: 'api/src/routes/new-thing.ts', line: 7, text: "role: 'builder'" }]);
  });
});
