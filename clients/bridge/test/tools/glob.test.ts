import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { glob, ToolError } from '../../src/tools/index.js';
import { makeHarness, GRANT, SESSION, type Harness } from './harness.js';

/** `glob` — restricted glob match over a symlink-free walk of the grant, ledgered+capped. */
let h: Harness;
beforeEach(() => {
  h = makeHarness();
  h.file('contrato.txt', 'a');
  h.file('notas.md', 'b');
  h.file('sub/deep.txt', 'c');
  h.file('sub/inner/deeper.txt', 'd');
});
afterEach(() => h.cleanup());

describe('glob — matcher semantics', () => {
  it('`*` matches within a single segment only (no separator crossing)', () => {
    expect(glob(h.ctx(), GRANT, '*.txt').paths).toEqual(['contrato.txt']);
  });

  it('`**/*.txt` matches .txt at any depth, including the root', () => {
    expect(glob(h.ctx(), GRANT, '**/*.txt').paths).toEqual([
      'contrato.txt',
      'sub/deep.txt',
      'sub/inner/deeper.txt',
    ]);
  });

  it('a subdirectory pattern matches only under that directory', () => {
    expect(glob(h.ctx(), GRANT, 'sub/*.txt').paths).toEqual(['sub/deep.txt']);
  });

  it('`?` matches exactly one non-separator character', () => {
    h.file('a1.log', 'x');
    h.file('a12.log', 'y');
    expect(glob(h.ctx(), GRANT, 'a?.log').paths).toEqual(['a1.log']);
  });

  it('results are POSIX-separated and sorted', () => {
    const { paths } = glob(h.ctx(), GRANT, '**');
    expect(paths).toEqual([...paths].sort());
    expect(paths.every((p) => !p.includes('\\'))).toBe(true);
  });
});

describe('glob — symlinks are never followed or emitted', () => {
  it('a symlinked directory is not recursed into and a symlinked file is not a result', () => {
    let linksOk = true;
    try {
      symlinkSync(join(h.grantRoot, 'sub'), join(h.grantRoot, 'sub-link'));
      symlinkSync(join(h.grantRoot, 'contrato.txt'), join(h.grantRoot, 'file-link.txt'));
    } catch {
      linksOk = false;
    }
    if (!linksOk) return;
    const { paths } = glob(h.ctx(), GRANT, '**/*.txt');
    expect(paths).not.toContain('file-link.txt');
    expect(paths.some((p) => p.startsWith('sub-link/'))).toBe(false);
  });
});

describe('glob — ledger + cap', () => {
  it('emits one glob egress row sized to the serialized results (capped like a read)', () => {
    const { paths } = glob(h.ctx(), GRANT, '**/*.txt');
    const serialized = Buffer.from(JSON.stringify(paths), 'utf8').length;
    const rows = h.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'read', tool: 'glob', bytesOut: serialized });
    expect(h.egress.used(SESSION)).toBe(serialized);
  });

  it('a cap breach on the serialized results is denied S5', () => {
    let caught: ToolError | undefined;
    try {
      glob(h.ctx({ budgetBytes: 2 }), GRANT, '**/*.txt');
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.principle).toBe('S5');
    expect(h.denials().at(-1)).toMatchObject({ tool: 'glob', principle: 'S5' });
  });
});
