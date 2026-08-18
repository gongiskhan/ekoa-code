import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stat, ToolError } from '../../src/tools/index.js';
import { makeHarness, GRANT, SESSION, type Harness } from './harness.js';

/** `stat` — file metadata within a grant, ledgered+capped like the other derived-content tools. */
let h: Harness;
beforeEach(() => {
  h = makeHarness();
  h.file('contrato.txt', 'x'.repeat(42));
  h.dir('sub');
});
afterEach(() => h.cleanup());

describe('stat — happy path', () => {
  it('returns size, ISO mtime and kind for a file', () => {
    const s = stat(h.ctx(), GRANT, 'contrato.txt');
    expect(s.size).toBe(42);
    expect(s.kind).toBe('file');
    expect(() => new Date(s.mtime).toISOString()).not.toThrow();
    expect(new Date(s.mtime).toISOString()).toBe(s.mtime);
  });

  it('reports a directory as kind dir', () => {
    expect(stat(h.ctx(), GRANT, 'sub').kind).toBe('dir');
  });

  it('emits one stat egress row sized to the serialized metadata (capped like a read)', () => {
    const s = stat(h.ctx(), GRANT, 'contrato.txt');
    const serialized = Buffer.from(JSON.stringify(s), 'utf8').length;
    const rows = h.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'read', tool: 'stat', path: 'contrato.txt', bytesOut: serialized });
    expect(h.egress.used(SESSION)).toBe(serialized);
  });
});

describe('stat — denials', () => {
  it('a stat outside the grant is denied S1 and ledgered', () => {
    expect(() => stat(h.ctx(), GRANT, '../outside/secret.txt')).toThrow(ToolError);
    expect(h.denials().at(-1)).toMatchObject({ principle: 'S1', tool: 'stat' });
  });

  it('honours the egress cap on the serialized metadata (S5)', () => {
    let caught: ToolError | undefined;
    try {
      stat(h.ctx({ budgetBytes: 5 }), GRANT, 'contrato.txt');
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.principle).toBe('S5');
    expect(h.denials().at(-1)).toMatchObject({ tool: 'stat', principle: 'S5' });
  });
});
