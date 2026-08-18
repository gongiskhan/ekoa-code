import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFile, resetFirstWriteState, read, ToolError } from '../../src/tools/index.js';
import { makeHarness, sha256, GRANT, SESSION, type Harness } from './harness.js';

/**
 * `write`/`edit` — write-back with a sha256 precondition and a per-session-per-file first-write
 * confirmation state machine (§18.2.2; FLOW_PLAN write-back). Writes are inbound: NOT egress-counted.
 */
const SHA256_EMPTY = sha256('');

let h: Harness;
beforeEach(() => {
  resetFirstWriteState(); // the first-write tracker is process-wide; reset it per test
  h = makeHarness();
});
afterEach(() => h.cleanup());

/** Read a fixture file's raw bytes back (bypassing the tool, for assertions). */
function onDisk(rel: string): string {
  return readFileSync(join(h.grantRoot, rel), 'utf8');
}

describe('write — sha256 precondition', () => {
  it('writes over an existing file when the expected hash matches (confirmed first write)', () => {
    h.file('notas.md', 'antigo');
    const w = writeFile(h.ctx(), GRANT, 'notas.md', { content: 'novo' }, { expectedSha256: sha256('antigo'), confirmed: true });
    expect(w).toEqual({ bytesWritten: 4, sha256Before: sha256('antigo'), sha256After: sha256('novo') });
    expect(onDisk('notas.md')).toBe('novo');

    const row = h.rows().at(-1)!;
    expect(row).toMatchObject({
      kind: 'write',
      tool: 'write',
      path: 'notas.md',
      bytesWritten: 4,
      sha256Before: sha256('antigo'),
      sha256After: sha256('novo'),
      session: SESSION,
      taskId: 'task-1',
    });
    // A write is inbound — nothing is accounted against egress.
    expect(h.egress.used(SESSION)).toBe(0);
  });

  it('refuses a stale expected hash with "write conflict" (denied S1, file untouched)', () => {
    h.file('notas.md', 'antigo');
    let caught: ToolError | undefined;
    try {
      writeFile(h.ctx(), GRANT, 'notas.md', { content: 'novo' }, { expectedSha256: sha256('WRONG'), confirmed: true });
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.reason).toBe('write conflict');
    expect(caught?.principle).toBe('S1');
    expect(h.denials().at(-1)).toMatchObject({ reason: 'write conflict', principle: 'S1', tool: 'write' });
    expect(onDisk('notas.md')).toBe('antigo'); // untouched
  });

  it('refuses expectedSha256:null on an EXISTING file (it is not a create)', () => {
    h.file('notas.md', 'antigo');
    expect(() =>
      writeFile(h.ctx(), GRANT, 'notas.md', { content: 'novo' }, { expectedSha256: null, confirmed: true }),
    ).toThrow(/write conflict/);
    expect(onDisk('notas.md')).toBe('antigo');
  });
});

describe('write — create semantics', () => {
  it('creates a new file when expectedSha256 is explicitly null (before = sha256 of empty)', () => {
    const w = writeFile(h.ctx(), GRANT, 'new.txt', { content: 'oi' }, { expectedSha256: null, confirmed: true });
    expect(w.sha256Before).toBe(SHA256_EMPTY);
    expect(w.sha256After).toBe(sha256('oi'));
    expect(onDisk('new.txt')).toBe('oi');
    expect(h.rows().at(-1)).toMatchObject({ kind: 'write', sha256Before: SHA256_EMPTY, path: 'new.txt' });
  });

  it('refuses a create that passes a hash instead of null (missing file is never implicitly empty)', () => {
    let caught: ToolError | undefined;
    try {
      // Even the *correct* empty-file hash is disallowed — a create must pass null.
      writeFile(h.ctx(), GRANT, 'new.txt', { content: 'oi' }, { expectedSha256: SHA256_EMPTY, confirmed: true });
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.reason).toBe('write conflict');
    expect(caught?.principle).toBe('S1');
  });
});

describe('write — first-write confirmation state machine', () => {
  it('the FIRST write to a file in a session requires confirmed:true', () => {
    h.file('notas.md', 'antigo');
    let caught: ToolError | undefined;
    try {
      writeFile(h.ctx(), GRANT, 'notas.md', { content: 'novo' }, { expectedSha256: sha256('antigo') });
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.reason).toBe('confirmation required');
    expect(caught?.principle).toBe('S1');
    expect(h.denials().at(-1)).toMatchObject({ reason: 'confirmation required', tool: 'write' });
    expect(onDisk('notas.md')).toBe('antigo'); // refused write leaves the file untouched
  });

  it('after a confirmed first write, a SECOND write to the same file needs no confirmation', () => {
    h.file('notas.md', 'antigo');
    const w1 = writeFile(h.ctx(), GRANT, 'notas.md', { content: 'novo' }, { expectedSha256: sha256('antigo'), confirmed: true });
    // Second write, confirmed omitted — allowed because this file was already confirmed this session.
    const w2 = writeFile(h.ctx(), GRANT, 'notas.md', { content: 'mais novo' }, { expectedSha256: w1.sha256After });
    expect(w2.sha256After).toBe(sha256('mais novo'));
    expect(onDisk('notas.md')).toBe('mais novo');
  });

  it('a refused first write still counts as "first" — confirmation is required on retry', () => {
    h.file('notas.md', 'antigo');
    // First attempt: correct hash but no confirmation → refused.
    expect(() =>
      writeFile(h.ctx(), GRANT, 'notas.md', { content: 'novo' }, { expectedSha256: sha256('antigo') }),
    ).toThrow(/confirmation required/);
    // Retry, still unconfirmed → still refused (the failed write did not flip the state).
    expect(() =>
      writeFile(h.ctx(), GRANT, 'notas.md', { content: 'novo' }, { expectedSha256: sha256('antigo') }),
    ).toThrow(/confirmation required/);
  });
});

describe('edit — exact-string patch primitive', () => {
  it('replaces the first occurrence and ledgers a write row with tool "edit"', () => {
    h.file('deep.txt', 'alfa e alfa');
    const before = read(h.ctx(), GRANT, 'deep.txt').text;
    const e = writeFile(
      h.ctx(),
      GRANT,
      'deep.txt',
      { patch: { find: 'alfa', replace: 'BETA' } },
      { expectedSha256: sha256(before), confirmed: true },
    );
    expect(onDisk('deep.txt')).toBe('BETA e alfa'); // only the first occurrence
    expect(e.sha256After).toBe(sha256('BETA e alfa'));
    expect(h.rows().at(-1)).toMatchObject({ kind: 'write', tool: 'edit', path: 'deep.txt' });
  });

  it('targets a specific 1-based occurrence', () => {
    h.file('deep.txt', 'alfa e alfa e alfa');
    const before = read(h.ctx(), GRANT, 'deep.txt').text;
    writeFile(
      h.ctx(),
      GRANT,
      'deep.txt',
      { patch: { find: 'alfa', replace: 'BETA', occurrence: 2 } },
      { expectedSha256: sha256(before), confirmed: true },
    );
    expect(onDisk('deep.txt')).toBe('alfa e BETA e alfa');
  });

  it('denies when the edit target is absent (never silently no-ops)', () => {
    h.file('deep.txt', 'nada aqui');
    let caught: ToolError | undefined;
    try {
      writeFile(
        h.ctx(),
        GRANT,
        'deep.txt',
        { patch: { find: 'ausente', replace: 'x' } },
        { expectedSha256: sha256('nada aqui'), confirmed: true },
      );
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.reason).toBe('edit target not found');
    expect(caught?.principle).toBe('S1');
    expect(onDisk('deep.txt')).toBe('nada aqui');
  });
});

describe('write — containment', () => {
  it('a write outside the grant is denied S1 and ledgered', () => {
    expect(() =>
      writeFile(h.ctx(), GRANT, '../outside/evil.txt', { content: 'x' }, { expectedSha256: null, confirmed: true }),
    ).toThrow(ToolError);
    expect(h.denials().at(-1)).toMatchObject({ principle: 'S1', tool: 'write' });
  });
});
