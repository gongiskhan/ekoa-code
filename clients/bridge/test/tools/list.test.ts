import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { list, ToolError } from '../../src/tools/index.js';
import { makeHarness, GRANT, SESSION, type Harness } from './harness.js';

/** `list` — directory listing within a grant, symlinks classified (never followed), ledgered+capped. */
let h: Harness;
beforeEach(() => {
  h = makeHarness();
  h.file('contrato.txt', 'x'.repeat(10));
  h.file('notas.md', 'y'.repeat(4));
  h.dir('sub');
});
afterEach(() => h.cleanup());

describe('list — happy path', () => {
  it('returns dirents sorted by name, with kind and (non-dir) size', () => {
    const { entries } = list(h.ctx(), GRANT, '.');
    expect(entries.map((e) => e.name)).toEqual(['contrato.txt', 'notas.md', 'sub']);
    expect(entries.find((e) => e.name === 'contrato.txt')).toEqual({
      name: 'contrato.txt',
      kind: 'file',
      size: 10,
    });
    const sub = entries.find((e) => e.name === 'sub')!;
    expect(sub.kind).toBe('dir');
    expect(sub.size).toBeUndefined(); // directory sizes are platform noise — omitted
  });

  it('emits ONE list egress row whose bytesOut is the serialized listing length, capped like a read', () => {
    const { entries } = list(h.ctx(), GRANT, '.');
    const rows = h.rows();
    expect(rows).toHaveLength(1);
    const serialized = Buffer.from(JSON.stringify(entries), 'utf8').length;
    expect(rows[0]).toMatchObject({ kind: 'read', tool: 'list', bytesOut: serialized });
    expect(h.egress.used(SESSION)).toBe(serialized);
  });

  it('classifies a symlink as symlink WITHOUT following it', () => {
    let linksOk = true;
    try {
      symlinkSync(join(h.grantRoot, 'contrato.txt'), join(h.grantRoot, 'a-link'));
    } catch {
      linksOk = false;
    }
    if (!linksOk) return;
    const { entries } = list(h.ctx(), GRANT, '.');
    const link = entries.find((e) => e.name === 'a-link')!;
    expect(link.kind).toBe('symlink'); // reported as the link itself, not the target file
  });
});

describe('list — denials', () => {
  it('a listing outside the grant is denied S1 and ledgered', () => {
    expect(() => list(h.ctx(), GRANT, '../outside')).toThrow(ToolError);
    expect(h.denials().at(-1)).toMatchObject({ principle: 'S1', tool: 'list' });
  });

  it('honours the egress cap on the serialized listing (S5)', () => {
    let caught: ToolError | undefined;
    try {
      list(h.ctx({ budgetBytes: 4 }), GRANT, '.');
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.reason).toBe('egress cap reached');
    expect(caught?.principle).toBe('S5');
    expect(h.denials().at(-1)).toMatchObject({ tool: 'list', principle: 'S5' });
  });
});
