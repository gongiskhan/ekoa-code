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
import {
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  copyFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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
// A quoted `builder` ROLE string literal. Deliberately quote-only (h5-reviewer L1): a backtick
// matcher would false-fire on doc-comment PROSE (markdown code formatting like "renamed `builder`
// -> `user`"), which is worse than the near-zero-risk gap it closes - a role value is written as a
// plain string literal ('builder'), never a template literal, in this codebase. The per-file COUNT
// pin below is the real robustness upgrade (a NEW quoted orphan in an allowlisted file now fails).
const BUILDER_RE = /['"]builder['"]/;

/**
 * The ONLY files permitted to carry a quoted `builder` role literal after the H1 rename. Each is a
 * sanctioned survivor - a NEW hit in ANY other file fails the gate. Repo-relative, forward-slashed.
 */
// The ONLY files permitted to carry a `builder` role literal after the H1 rename, each pinned to its
// EXACT current count (h5-reviewer L2: a file-level allowlist would let a NEW orphan literal added to
// an allowlisted file pass silently; pinning the count makes any ADDITION fail the gate too).
const BUILDER_ALLOWLIST = new Map<string, number>([
  // Legacy-JWT normalization shim (H1): a token minted before the rename still carries role
  // 'builder'; verifyToken maps it to 'user' at the single verify chokepoint (+ its doc comments).
  ['api/src/auth/jwt.ts', 2],
  // migrateBuilderRole: the idempotent boot migration query `users.find({ role: 'builder' })` that
  // rewrites any legacy row to 'user' and bumps its token epoch.
  ['api/src/auth/users-service.ts', 2],
  // web SESSION-KIND 'builder' - the app-building SESSION kind persisted server-side, NOT a user
  // ROLE. Out of the role model entirely (the H1 rename touched roles, not session kinds).
  ['web/stores/orchestration.ts', 1],
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
    // Per-file COUNT pin (h5-reviewer L2): an allowlisted file must carry EXACTLY its sanctioned
    // number of builder literals - a NEW one ADDED to an allowlisted file (or a stale entry whose
    // literals were removed) fails the gate, so the allowlist can never silently hide a fresh orphan.
    for (const [allowed, expected] of BUILDER_ALLOWLIST) {
      const actual = hits.filter((h) => h.file === allowed).length;
      expect(actual, `allowlist entry ${allowed}: expected ${expected} builder literal(s), found ${actual} - a NEW one must be renamed to 'user' or the count updated with justification`).toBe(expected);
    }
  });
});

/**
 * NON-TAUTOLOGY PROOF (in-suite, durable): the pure matcher + allowlist logic detect planted
 * violations and reject the exact identifiers they must NOT match. If someone weakens the regex into
 * a no-op, THESE fail - so the two tree scans above can never silently become vacuous.
 */
/**
 * THE CHOKEPOINT GATE COVERS WHAT ITS COMMENT CLAIMS (D2 re-review LOW-3, then the four bypasses a
 * fresh-context verifier reproduced against the widened gate).
 *
 * History, each item now pinned below by a case that RUNS THE REAL SCRIPT against a planted
 * violation (behaviour, not the script's text — revert the fix and the matching case goes red):
 *   1. it scanned `api/test` (a fixture dir holding only fake-daemon) while claiming to cover the
 *      test harness; the real suite `api/tests` was unscanned.
 *   2. its allow-marker was filtered over the whole `path:line:content` output line, so a DIRECTORY
 *      or FILE named `chokepoint-gate-allow` exempted an unbounded subtree — defeating both
 *      properties the marker exists for (one-line granularity; `grep -rn` over content enumerates
 *      every exemption).
 *   3. it was case-SENSITIVE while its comment claimed case-insensitive, so a provider host spelled
 *      with a capital A passed (DNS is case-insensitive, so that URL resolves) — and its exemption
 *      filters were `-iv`, so `api/tests/LLM/` inherited the chokepoint suite's exemption. The
 *      case-insensitivity was on the wrong side of the fence.
 *   4. it scanned `web/src`, WHICH DOES NOT EXIST: the whole frontend, `scripts/` and the shipped
 *      `clients/` CLI workspace were unscanned while the comment claimed the frontend was covered.
 *
 * TWO HARNESSES, deliberately:
 *   - REAL TREE (the probe is written into the repo under a dot-prefixed, pid-unique directory and
 *     removed in `finally`; the script's roots are hardcoded on purpose — a gate whose scan scope is
 *     settable from outside is a gate with a switch). This is what proves the declared roots match
 *     the ACTUAL repo layout, which is exactly what `web/src` got wrong.
 *   - SANDBOX (a byte-for-byte copy of the real script executed against a synthetic tree under
 *     os.tmpdir()). Used for the cases that cannot be run against the repo without mutating it —
 *     per-root coverage of every declared root, and the missing-root failure itself.
 */
// Assembled from fragments, never written as literals, so THIS file does not trip the gate it
// tests (api/tests is scanned and this file is not exempt).
const TOKEN = ['anthrop', 'ic'].join('');
const HOST = `https://api.${TOKEN}.com/v1/messages`;
const GATE = resolve(ROOT, 'scripts/chokepoint-grep.sh');

/** Does the filesystem hosting the sandboxes distinguish `LLM` from `llm`? Linux yes, macOS
 *  (APFS, default config) no. Probed once, in the same tmpdir the sandboxes are made in. */
const CASE_SENSITIVE_FS = (() => {
  const probe = mkdtempSync(join(tmpdir(), 'fs-case-'));
  try {
    mkdirSync(join(probe, 'llm'));
    return !existsSync(join(probe, 'LLM'));
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

/**
 * Every root `scripts/chokepoint-grep.sh` declares. Hardcoded here INDEPENDENTLY of the script, so
 * dropping one from the script's ROOTS makes the per-root case below go red instead of silently
 * un-scanning a subtree.
 */
const DECLARED_ROOTS = [
  'api/src',
  'api/test',
  'api/tests',
  'api/scripts',
  'api/assets',
  'shared/src',
  'web/app',
  'web/components',
  'web/hooks',
  'web/lib',
  'web/locales',
  'web/stores',
  'web/types',
  'web/e2e',
  'web/__tests__',
  'web/scripts',
  'scripts',
  'clients',
];

describe('chokepoint grep gate: real-tree scope + exemption mechanism', () => {
  const PROBE_DIR = resolve(ROOT, `api/tests/.chokepoint-gate-probe-${process.pid}`);
  const PROBE = join(PROBE_DIR, 'probe.ts');

  /** Run the real gate against `content` planted under api/tests; returns its exit status. */
  function gateStatusWith(content: string): { status: number; stdout: string } {
    mkdirSync(PROBE_DIR, { recursive: true });
    try {
      writeFileSync(PROBE, content);
      const r = spawnSync('bash', [GATE], { cwd: ROOT, encoding: 'utf8' });
      return { status: r.status ?? -1, stdout: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    } finally {
      rmSync(PROBE_DIR, { recursive: true, force: true });
    }
  }

  it('a provider reference planted in api/tests FAILS the gate (the path it never used to scan)', () => {
    const { status, stdout } = gateStatusWith(`export const u = '${HOST}';\n`);
    expect(status, `gate output:\n${stdout}`).not.toBe(0);
    expect(stdout).toContain('.chokepoint-gate-probe');
  });

  it('the same line carrying the `chokepoint-gate-allow` marker is exempt', () => {
    const { status, stdout } = gateStatusWith(`export const u = '${HOST}'; // chokepoint-gate-allow\n`);
    expect(status, `gate output:\n${stdout}`).toBe(0);
  });

  it('the marker is LINE-scoped — one on a neighbouring line exempts nothing', () => {
    const { status } = gateStatusWith(`// chokepoint-gate-allow\nexport const u = '${HOST}';\n`);
    expect(status).not.toBe(0);
  });

  it('a violation in the FRONTEND, in scripts/ and in the shipped clients/ CLI fails on the real tree', () => {
    // The `web/src` bug in the flesh: these three roots exist in the repo and were entirely
    // unscanned. One gate run, three probes, so the window in which the tree carries them is a
    // single ~0.1s invocation. (The remaining roots are covered exhaustively in the sandbox suite.)
    const dirs = ['web/lib', 'scripts', 'clients'].map((r) =>
      resolve(ROOT, r, `.chokepoint-gate-probe-${process.pid}`),
    );
    try {
      for (const d of dirs) {
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, 'probe.ts'), `export const u = '${HOST}';\n`);
      }
      const r = spawnSync('bash', [GATE], { cwd: ROOT, encoding: 'utf8' });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      expect(r.status, `gate output:\n${out}`).not.toBe(0);
      for (const root of ['web/lib', 'scripts', 'clients']) {
        expect(out, `root ${root} is declared but its planted violation was not reported`).toContain(
          `${root}/.chokepoint-gate-probe`,
        );
      }
    } finally {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    }
  });

  it('every declared root really exists in the repo (a dangling root is scanned as empty)', () => {
    const dangling = DECLARED_ROOTS.filter((r) => !existsSync(resolve(ROOT, r)));
    expect(dangling, `declared scan roots that are not directories: ${dangling.join(', ')}`).toEqual([]);
  });

  it('the gate is clean on the tree as it stands (the pre-existing hits were triaged, not ignored)', () => {
    const r = spawnSync('bash', [GATE], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status, `${r.stdout ?? ''}${r.stderr ?? ''}`).toBe(0);
  });
});

/**
 * SANDBOX SUITE — the real script, byte-for-byte, executed against a synthetic tree in os.tmpdir().
 * Hermetic (no repo mutation, no race with a concurrent lint/typecheck) and exhaustive: it can
 * plant in EVERY declared root, and can delete a root to prove the missing-root failure.
 */
describe('chokepoint grep gate: bypass matrix (sandboxed copy of the real script)', () => {
  /** A synthetic repo whose only content is the roots the gate declares. Caller removes it. */
  function makeSandbox(roots: string[] = DECLARED_ROOTS): string {
    const dir = mkdtempSync(join(tmpdir(), 'chokepoint-gate-'));
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(GATE, join(dir, 'scripts', 'chokepoint-grep.sh'));
    for (const r of roots) mkdirSync(join(dir, r), { recursive: true });
    // The two exempt paths, so their case-sensitivity can be exercised.
    if (roots.includes('api/src')) mkdirSync(join(dir, 'api/src/llm'), { recursive: true });
    if (roots.includes('api/tests')) mkdirSync(join(dir, 'api/tests/llm'), { recursive: true });
    return dir;
  }

  function runGate(dir: string): { status: number; out: string } {
    const r = spawnSync('bash', [join(dir, 'scripts', 'chokepoint-grep.sh')], { cwd: dir, encoding: 'utf8' });
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  }

  /** Plant `files` (relative path -> content) in a fresh sandbox, run the gate, clean up. */
  function gateWith(files: Record<string, string>, roots?: string[]): { status: number; out: string } {
    const dir = makeSandbox(roots);
    try {
      for (const [rel, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), content);
      }
      return runGate(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const decl = (value: string) => `export const u = '${value}';\n`;

  it('an empty sandbox is clean (the matrix below is not just "everything fails")', () => {
    const { status, out } = gateWith({});
    expect(status, out).toBe(0);
  });

  it('EVERY declared root is really scanned — one probe per root, all reported', () => {
    const files: Record<string, string> = {};
    for (const r of DECLARED_ROOTS) files[`${r}/zz-probe.ts`] = decl(HOST);
    const { status, out } = gateWith(files);
    expect(status, out).not.toBe(0);
    for (const r of DECLARED_ROOTS) {
      expect(out, `root ${r} is declared but its planted violation was NOT reported`).toContain(`${r}/zz-probe.ts`);
    }
  });

  it('a DECLARED ROOT THAT DOES NOT EXIST fails the gate (the `web/src` class of blind spot)', () => {
    const { status, out } = gateWith({}, DECLARED_ROOTS.filter((r) => r !== 'web/lib'));
    expect(status, out).not.toBe(0);
    expect(out).toContain('do not exist');
    expect(out).toContain('web/lib');
  });

  it('the allow-marker cannot be smuggled into a DIRECTORY name', () => {
    const { status, out } = gateWith({ 'api/tests/chokepoint-gate-allow/p.ts': decl(HOST) });
    expect(status, out).not.toBe(0);
    expect(out).toContain('api/tests/chokepoint-gate-allow/p.ts');
  });

  it('the allow-marker cannot be smuggled into a FILE name', () => {
    const { status, out } = gateWith({ 'api/tests/x/chokepoint-gate-allow.ts': decl(HOST) });
    expect(status, out).not.toBe(0);
    expect(out).toContain('api/tests/x/chokepoint-gate-allow.ts');
  });

  it('the marker still exempts exactly its own line, and only its own line', () => {
    const same = gateWith({ 'api/src/p.ts': `export const u = '${HOST}'; // chokepoint-gate-allow\n` });
    expect(same.status, same.out).toBe(0);
    const adjacent = gateWith({ 'api/src/p.ts': `// chokepoint-gate-allow\nexport const u = '${HOST}';\n` });
    expect(adjacent.status, adjacent.out).not.toBe(0);
  });

  it('an UPPER-CASE provider host fails (DNS is case-insensitive, so that URL works)', () => {
    const upper = `https://api.${['Anthrop', 'ic'].join('')}.com/v1/messages`;
    const { status, out } = gateWith({ 'api/src/p.ts': decl(upper) });
    expect(status, out).not.toBe(0);
  });

  it('an UPPER-CASE package scope and a bare upper-case host both fail', () => {
    const scope = `@${['ANTHROP', 'IC'].join('')}-ai/sdk`;
    const a = gateWith({ 'api/src/p.ts': `import x from '${scope}';\n` });
    expect(a.status, a.out).not.toBe(0);
    const host = ['ANTHROP', 'IC.COM'].join('');
    const b = gateWith({ 'api/src/p.ts': decl(host) });
    expect(b.status, b.out).not.toBe(0);
  });

  it('the real chokepoint module and its own suite ARE exempt', () => {
    const real = gateWith({ 'api/src/llm/p.ts': decl(HOST), 'api/tests/llm/p.ts': decl(HOST) });
    expect(real.status, real.out).toBe(0);
  });

  // The sandbox pre-creates `api/src/llm`, so on a case-INSENSITIVE filesystem (macOS APFS by
  // default) `mkdir api/src/LLM` is a no-op and the planted file lands in the exempt directory —
  // the setup cannot express the case at all, and the assertion would fail on the harness rather
  // than on the gate. The gate's own matching is case-sensitive regardless of the host; this runs
  // for real on CI (Linux). Skipping is the honest report: a case the machine cannot pose.
  it.skipIf(!CASE_SENSITIVE_FS)('the PATH exemptions are case-SENSITIVE — api/src/LLM and api/tests/LLM inherit nothing', () => {
    const src = gateWith({ 'api/src/LLM/p.ts': decl(HOST) });
    expect(src.status, src.out).not.toBe(0);
    const tests = gateWith({ 'api/tests/LLM/p.ts': decl(HOST) });
    expect(tests.status, tests.out).not.toBe(0);
  });

  it('a split-string literal is still caught by the broad token pass', () => {
    const { status, out } = gateWith({ 'api/src/p.ts': `const u = 'api.' + '${TOKEN}.com';\n` });
    expect(status, out).not.toBe(0);
  });

  it('the sanctioned wiring identifier and prose do NOT trip it (why pass 2 is case-sensitive)', () => {
    // ANTHROPIC_BASE_URL is the mechanism CLAUDE.md MANDATES for pointing a subprocess AT the
    // chokepoint, and the capitalised proper noun is prose; banning either would mean ~40 markers.
    const env = gateWith({ 'api/src/p.ts': 'const e = { ANTHROPIC_BASE_URL: cfg.chokepoint };\n' });
    expect(env.status, env.out).toBe(0);
    const prose = gateWith({ 'api/src/p.ts': '// The Anthropic-compatible provider endpoint.\n' });
    expect(prose.status, prose.out).toBe(0);
  });
});

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
