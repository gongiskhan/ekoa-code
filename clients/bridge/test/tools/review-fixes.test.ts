import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { read } from '../../src/tools/read.js';
import { stat } from '../../src/tools/stat.js';
import { list } from '../../src/tools/list.js';
import { grep } from '../../src/tools/grep.js';
import { writeFile, resetFirstWriteState } from '../../src/tools/write.js';
import { ToolError } from '../../src/tools/index.js';
import { makeHarness, GRANT, type Harness } from './harness.js';

/**
 * Regression tests for the S3–S7 review findings (docs/decisions "Tool/ledger review fixes"):
 * fs errors on a resolver-admitted path become LEDGERED ToolErrors; grep exit 2 is a failure not an
 * empty success; grep/list('.') ledger paths are grant-relative ('.'), never the absolute local path;
 * ranged reads read only the window.
 */
let h: Harness;
beforeEach(() => {
  h = makeHarness();
  resetFirstWriteState();
});
afterEach(() => h.cleanup());

describe('fs errors on a resolver-admitted path are ledgered ToolErrors, not raw throws', () => {
  it('read of a missing in-grant file → ToolError(S1) + a ledgered denial (file not found)', () => {
    expect(() => read(h.ctx(), GRANT, 'does-not-exist.txt')).toThrow(ToolError);
    const d = h.denials().at(-1);
    expect(d?.principle).toBe('S1');
    expect(d?.reason).toMatch(/not found/);
    expect(d?.tool).toBe('read');
  });

  it('read of a directory (EISDIR) → ToolError + ledgered denial', () => {
    h.dir('subdir');
    expect(() => read(h.ctx(), GRANT, 'subdir')).toThrow(ToolError);
    expect(h.denials().at(-1)?.reason).toMatch(/directory/);
  });

  it('stat of a missing file → ToolError + ledgered denial', () => {
    expect(() => stat(h.ctx(), GRANT, 'nope.txt')).toThrow(ToolError);
    expect(h.denials().at(-1)).toMatchObject({ principle: 'S1', tool: 'stat' });
  });

  it('list of a missing dir → ToolError + ledgered denial', () => {
    expect(() => list(h.ctx(), GRANT, 'no-such-dir')).toThrow(ToolError);
    expect(h.denials().at(-1)).toMatchObject({ principle: 'S1', tool: 'list' });
  });

  it('write INTO a directory path (EISDIR) → ToolError + ledgered denial, not a raw crash', () => {
    h.dir('adir');
    expect(() => writeFile(h.ctx(), GRANT, 'adir', { content: 'x' }, { expectedSha256: null, confirmed: true })).toThrow(ToolError);
    expect(h.denials().at(-1)?.principle).toBe('S1');
  });
});

describe('grep exit-code discipline', () => {
  it('a valid pattern with no matches → empty result (exit 1 is normal), ledgered as a grep row', async () => {
    h.file('a.txt', 'hello world');
    const res = await grep(h.ctx(), GRANT, 'zzz-not-present');
    expect(res.matches).toEqual([]);
    expect(h.rows().some((r) => r.kind === 'read' && r.tool === 'grep')).toBe(true);
  });

  it('a malformed regex (rg exit 2) → ToolError(S1) + ledgered denial, NOT a silent empty success', async () => {
    h.file('a.txt', 'hello');
    await expect(grep(h.ctx(), GRANT, 'foo(')).rejects.toBeInstanceOf(ToolError);
    const d = h.denials().at(-1);
    expect(d?.reason).toMatch(/pattern/);
    expect(d?.tool).toBe('grep');
    // No successful grep egress row was written for the failed search.
    expect(h.rows().some((r) => r.kind === 'read' && r.tool === 'grep')).toBe(false);
  });
});

describe('ledger paths never leak the absolute local path', () => {
  it("grep ledgers path '.' (the grant root), not the absolute filesystem path", async () => {
    h.file('a.txt', 'match me');
    await grep(h.ctx(), GRANT, 'match');
    const row = h.rows().find((r) => r.kind === 'read' && r.tool === 'grep');
    expect(row && 'path' in row ? row.path : undefined).toBe('.');
    expect(JSON.stringify(h.rows())).not.toContain(h.grantRoot);
  });

  it("list('.') ledgers path '.' too", () => {
    h.file('a.txt', 'x');
    list(h.ctx(), GRANT, '.');
    const row = h.rows().find((r) => r.kind === 'read' && r.tool === 'list');
    expect(row && 'path' in row ? row.path : undefined).toBe('.');
  });

  it('a match under a subdir still ledgers a grant-RELATIVE match path (no absolute leak)', async () => {
    h.file('sub/deep.txt', 'needle here');
    const res = await grep(h.ctx(), GRANT, 'needle');
    expect(res.matches.length).toBeGreaterThan(0);
    for (const m of res.matches) {
      expect(m.path.startsWith('/')).toBe(false);
      expect(m.path).not.toContain(h.grantRoot);
    }
  });
});

describe('ranged read', () => {
  it('reads exactly the requested window and ledgers that byteRange', () => {
    h.file('doc.txt', 'ABCDEFGHIJ'); // 10 bytes
    const r = read(h.ctx(), GRANT, 'doc.txt', { start: 2, end: 6 });
    expect(r.text).toBe('CDEF');
    expect(r.byteRange).toBe('2-6');
    expect(r.bytesOut).toBe(4);
  });

  it('clamps an over-the-end range to the file size', () => {
    h.file('doc.txt', 'ABC');
    const r = read(h.ctx(), GRANT, 'doc.txt', { start: 1, end: 999 });
    expect(r.text).toBe('BC');
    expect(r.byteRange).toBe('1-3');
  });

  it('a start past the end yields an empty emission', () => {
    h.file('doc.txt', 'ABC');
    const r = read(h.ctx(), GRANT, 'doc.txt', { start: 10, end: 20 });
    expect(r.text).toBe('');
    expect(r.byteRange).toBe('3-3');
    expect(r.bytesOut).toBe(0);
  });

  it('a symlink INSIDE the grant is still read through the range path', () => {
    h.file('target.txt', 'ZYXWVUT');
    try {
      symlinkSync(join(h.grantRoot, 'target.txt'), join(h.grantRoot, 'link.txt'));
    } catch {
      return; // symlinks unsupported here
    }
    const r = read(h.ctx(), GRANT, 'link.txt', { start: 0, end: 3 });
    expect(r.text).toBe('ZYX');
  });
});
