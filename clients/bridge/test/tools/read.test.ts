import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { read, ToolError, type ReadResult } from '../../src/tools/index.js';
import { makeHarness, sha256, GRANT, SESSION, type Harness } from './harness.js';

/**
 * `read` — byte-range reads within a grant, ledgered and capped (§18.5 S1/S5; parity: fake-daemon
 * `read`). Every tree is a per-test temp dir; contents are synthetic.
 */
const BODY = 'linha 1 alfa\nlinha 2 beta\nlinha 3 alfa gama\n'; // 44 bytes, ASCII

let h: Harness;
beforeEach(() => {
  h = makeHarness();
  h.file('contrato.txt', BODY);
});
afterEach(() => h.cleanup());

describe('read — happy path', () => {
  it('reads the whole file, ledgers one read row with byteRange 0-len (harness parity)', () => {
    const r: ReadResult = read(h.ctx(), GRANT, 'contrato.txt');
    expect(r.text).toBe(BODY);
    expect(r.byteRange).toBe(`0-${BODY.length}`);
    expect(r.bytesOut).toBe(BODY.length);

    const rows = h.rows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'read',
      session: SESSION,
      taskId: 'task-1',
      correlationId: 'corr-1',
      path: 'contrato.txt',
      byteRange: `0-${BODY.length}`,
      bytesOut: BODY.length,
      sha256: sha256(BODY),
      tool: 'read',
    });
    expect(h.egress.used(SESSION)).toBe(BODY.length);
  });

  it('the ledger row sha256 is over the emitted bytes', () => {
    read(h.ctx(), GRANT, 'contrato.txt');
    const row = h.rows()[0]!;
    expect(row.kind === 'read' && row.sha256).toBe(sha256(BODY));
  });
});

describe('read — byte ranges on the raw buffer', () => {
  it('reads a mid-file range [start,end)', () => {
    const r = read(h.ctx(), GRANT, 'contrato.txt', { start: 0, end: 7 });
    expect(r.text).toBe('linha 1');
    expect(r.byteRange).toBe('0-7');
    expect(r.bytesOut).toBe(7);
    expect(h.egress.used(SESSION)).toBe(7);
  });

  it('clamps an over-the-end range to the file length', () => {
    const r = read(h.ctx(), GRANT, 'contrato.txt', { start: 6, end: 9999 });
    expect(r.byteRange).toBe(`6-${BODY.length}`);
    expect(r.bytesOut).toBe(BODY.length - 6);
    expect(r.text).toBe(BODY.slice(6));
  });

  it('a start at/after the end yields an empty emission (range clamps, no over-index)', () => {
    const r = read(h.ctx(), GRANT, 'contrato.txt', { start: 9999, end: 10000 });
    expect(r.text).toBe('');
    expect(r.bytesOut).toBe(0);
    expect(r.byteRange).toBe(`${BODY.length}-${BODY.length}`);
  });
});

describe('read — out-of-grant denial (S1, ledgered)', () => {
  it('a ../ traversal is denied with a containment reason and ledgered as S1', () => {
    expect(() => read(h.ctx(), GRANT, '../outside/secret.txt')).toThrow(ToolError);
    let caught: ToolError | undefined;
    try {
      read(h.ctx(), GRANT, '../outside/secret.txt');
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.principle).toBe('S1');
    expect(caught?.reason).toBe('path escapes the granted root: ../outside/secret.txt');

    const denials = h.denials();
    expect(denials.length).toBeGreaterThanOrEqual(1);
    expect(denials.at(-1)).toMatchObject({
      kind: 'denial',
      reason: 'path escapes the granted root: ../outside/secret.txt',
      principle: 'S1',
      tool: 'read',
      session: SESSION,
    });
    // A denied read emits nothing and accounts nothing.
    expect(h.rows().some((r) => r.kind === 'read')).toBe(false);
    expect(h.egress.used(SESSION)).toBe(0);
  });

  it('a symlink escaping the grant is denied (realpath catches it)', () => {
    let linksOk = true;
    try {
      symlinkSync(join(h.root, 'outside-secret'), join(h.grantRoot, 'escape-link'));
    } catch {
      linksOk = false;
    }
    if (!linksOk) return;
    expect(() => read(h.ctx(), GRANT, 'escape-link')).toThrow(ToolError);
    expect(h.denials().at(-1)).toMatchObject({ principle: 'S1', tool: 'read' });
  });

  it('a grant not held for this session is unknown (S1) — resolution is session-scoped', () => {
    // The harness grant belongs to SESSION; a task for another session cannot name it.
    let caught: ToolError | undefined;
    try {
      read(h.ctx({ session: 'sess-OTHER' }), GRANT, 'contrato.txt');
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.principle).toBe('S1');
    expect(caught?.reason).toBe(`unknown grant: ${GRANT}`);
  });
});

describe('read — egress cap (S5, strict >)', () => {
  it('a read whose bytes would exceed the budget is denied cap-reached and ledgered S5', () => {
    let caught: ToolError | undefined;
    try {
      read(h.ctx({ budgetBytes: BODY.length - 1 }), GRANT, 'contrato.txt');
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught).toBeInstanceOf(ToolError);
    expect(caught?.reason).toBe('egress cap reached');
    expect(caught?.principle).toBe('S5');

    expect(h.denials().at(-1)).toMatchObject({
      reason: 'egress cap reached',
      principle: 'S5',
      tool: 'read',
    });
    // Nothing accounted, no read row on a cap breach.
    expect(h.egress.used(SESSION)).toBe(0);
    expect(h.rows().some((r) => r.kind === 'read')).toBe(false);
  });

  it('a read hitting the budget EXACTLY is allowed (strict >, harness parity)', () => {
    const r = read(h.ctx({ budgetBytes: BODY.length }), GRANT, 'contrato.txt');
    expect(r.bytesOut).toBe(BODY.length);
    expect(h.egress.used(SESSION)).toBe(BODY.length);
  });

  it('accumulates per session across reads; a later read that would breach is denied', () => {
    const ctx = h.ctx({ budgetBytes: BODY.length + 5 });
    read(ctx, GRANT, 'contrato.txt'); // uses 44
    // A second whole-file read would push usage to 88 > 49 → cap.
    expect(() => read(ctx, GRANT, 'contrato.txt')).toThrow(ToolError);
    expect(h.egress.used(SESSION)).toBe(BODY.length);
  });
});
