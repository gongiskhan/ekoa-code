import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * RAW CONTROL-BYTE gate (E5 review F7 ratchet). A committed gate for a defect class that has now
 * shipped TWICE in this run's security suites: a probe payload meant to be an ESCAPE (the six characters
 * backslash-u-0-0-0-0) written instead as the literal byte, so the source file contains a real NUL.
 *
 * WHY IT IS WORTH A GATE. A raw NUL turns the file BINARY for the whole toolchain that guards this
 * repo: `git diff` prints "Binary files differ" instead of the change, `grep`/`rg` skip the file by
 * default, and every grep-based CI gate the repo relies on (scripts/chokepoint-grep.sh,
 * scripts/garrison-grep.sh, scripts/encryption-key-grep.sh, and the structural gates in
 * tests/security/) silently stop covering it. A security suite that is invisible to the security
 * gates is worse than no suite: it looks like coverage. The byte is also invisible in review — the
 * diff renders it as nothing at all.
 *
 * WHAT IS BANNED: every C0 control byte except tab (0x09), LF (0x0A) and CR (0x0D), plus DEL
 * (0x7F). That is exactly the set git's binary heuristic and the standard grep tools react to.
 * Ordinary text, accents and emoji-free UTF-8 prose are unaffected.
 *
 * THE FIX IS ALWAYS THE SAME: write the escape ('a' + backslash-u-0-0-0-0 + 'b') or construct the
 * bytes (`Buffer.from([0x01, 0x02])`). Both keep the test's intent and keep the file text.
 *
 * ALLOWLIST: three PRE-EXISTING occurrences, each the same defect in a file outside this slice's
 * write scope. It is SHRINK-ONLY — the test fails if an allowlisted file is cleaned up and its
 * entry is left behind, so the list cannot rot into permanent furniture.
 */
const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/api/tests/security
const ROOT = resolve(HERE, '../../..'); // <root>

/** Trees whose files must stay grep-visible: the test estate and the shared contract. */
const SCANNED = ['api/tests', 'api/src', 'shared/src'];

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml']);

/** Files that carry a raw control byte TODAY, with the reason and the fix. Shrink-only. */
const ALLOWLIST = new Map<string, string>([
  [
    'api/tests/contract/app-files.test.ts',
    "0x01/0x02 inside Buffer.from('olá mundo binário …') — a deliberate binary upload payload written as raw bytes; fix is Buffer.concat with Buffer.from([0x01, 0x02]).",
  ],
  [
    'api/tests/apps/document-source.test.ts',
    "a raw NUL in the ['NUL byte', 'foo\\0bar'] charset probe — same defect as the one this gate was written for; fix is the '\\u0000' escape.",
  ],
  [
    'api/src/llm/anonymise/index.ts',
    "parts.join(NUL) uses a raw NUL as an audit-record separator; fix is '\\u0000'. Inside the egress chokepoint, which only its own slice may edit.",
  ],
]);

/** Banned: C0 controls except \t \n \r, plus DEL. */
function isBannedByte(b: number): boolean {
  if (b === 0x09 || b === 0x0a || b === 0x0d) return false;
  return b < 0x20 || b === 0x7f;
}

export interface ByteHit {
  file: string; // repo-relative, forward-slashed
  offset: number;
  byte: number;
  line: number; // 1-based
}

/** Every banned byte in a buffer, with its 1-based line number. Pure — self-tested below. */
export function scanBuffer(buf: Buffer, file: string): ByteHit[] {
  const out: ByteHit[] = [];
  let line = 1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i] as number;
    if (b === 0x0a) { line++; continue; }
    if (isBannedByte(b)) out.push({ file, offset: i, byte: b, line });
  }
  return out;
}

function walk(absDir: string): string[] {
  if (!existsSync(absDir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(absDir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.next') continue;
    const abs = join(absDir, entry);
    if (statSync(abs).isDirectory()) {
      out.push(...walk(abs));
    } else if (SOURCE_EXT.has(abs.slice(abs.lastIndexOf('.')))) {
      out.push(abs);
    }
  }
  return out;
}

const repoRelative = (abs: string): string => relative(ROOT, abs).split(sep).join('/');

describe('raw control-byte gate (E5 review F7 ratchet)', () => {
  const files = SCANNED.flatMap((tree) => walk(resolve(ROOT, tree)));

  it('scans a real, non-trivial file set (the gate is not vacuously green)', () => {
    expect(files.length).toBeGreaterThan(200);
    const rels = files.map(repoRelative);
    expect(rels).toContain('api/tests/security/knowledge-scoping.test.ts');
    expect(rels).toContain('api/tests/security/memvault-isolation.test.ts');
    expect(rels).toContain('shared/src/knowledge.ts');
  });

  it('no source file under api/tests, api/src or shared/src carries a raw control byte', () => {
    const hits: ByteHit[] = [];
    for (const abs of files) {
      const rel = repoRelative(abs);
      if (ALLOWLIST.has(rel)) continue;
      hits.push(...scanBuffer(readFileSync(abs), rel));
    }
    const report = hits
      .map((h) => `${h.file}:${h.line} (offset ${h.offset}) 0x${h.byte.toString(16).padStart(2, '0')}`)
      .join('\n');
    expect(
      hits,
      `raw control bytes found — write the \\uXXXX escape instead (a raw byte makes the file BINARY to git, grep and every grep-based CI gate):\n${report}`,
    ).toEqual([]);
  });

  it('the allowlist is SHRINK-ONLY: every entry still has a byte, and carries a written reason', () => {
    for (const [rel, reason] of ALLOWLIST) {
      const abs = resolve(ROOT, rel);
      expect(existsSync(abs), `${rel} is allowlisted but does not exist — drop the entry`).toBe(true);
      const found = scanBuffer(readFileSync(abs), rel);
      expect(
        found.length,
        `${rel} is CLEAN now — remove it from the allowlist (this list may only shrink)`,
      ).toBeGreaterThan(0);
      expect(reason.length, `${rel} needs a written reason`).toBeGreaterThan(30);
    }
  });

  it('NON-TAUTOLOGY: the scanner fires on planted bytes and stays silent on ordinary text', () => {
    // The exact defect this gate exists for, and its correct form. NOTE how the "bad" fixture is
    // BUILT rather than written: a literal raw byte here would make this very file binary again.
    const withRawByte = (prefix: string, byte: number, suffix: string): Buffer =>
      Buffer.concat([Buffer.from(prefix, 'utf8'), Buffer.from([byte]), Buffer.from(suffix, 'utf8')]);
    expect(scanBuffer(withRawByte("for (const c of ['a", 0x00, "b']) {\n"), 'x.ts')).toHaveLength(1);
    // ...and the ESCAPED form (six plain characters) is clean.
    expect(scanBuffer(Buffer.from("for (const c of ['a\\u0000b']) {\n", 'utf8'), 'x.ts')).toEqual([]);
    // Every banned byte is caught, at the right line.
    expect(scanBuffer(withRawByte('linha1\nlinha2', 0x01, '\n'), 'x.ts')).toEqual([
      { file: 'x.ts', offset: 13, byte: 0x01, line: 2 },
    ]);
    for (const b of [0x00, 0x01, 0x0b, 0x0c, 0x1b, 0x1f, 0x7f]) {
      expect(scanBuffer(Buffer.from([0x61, b, 0x62]), 'x.ts'), `0x${b.toString(16)}`).toHaveLength(1);
    }
    // Text that must NOT trip it: tabs, CRLF, accented UTF-8, and a high byte.
    expect(scanBuffer(Buffer.from('\tcláusula\r\nAcórdão — ação\n', 'utf8'), 'x.ts')).toEqual([]);
  });
});
