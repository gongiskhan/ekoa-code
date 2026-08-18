import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { grep, ToolError } from '../../src/tools/index.js';
import { makeHarness, GRANT, SESSION, type Harness } from './harness.js';

/** `grep` — @vscode/ripgrep-backed search within a grant: argument-injection hardened, output-capped,
 *  ledgered+capped like the other derived-content tools. Runs the real rg binary against temp trees. */
let h: Harness;
beforeEach(() => {
  h = makeHarness();
  h.file('contrato.txt', 'linha 1 alfa\nlinha 2 beta\nlinha 3 alfa gama\n');
  h.file('notas.md', '# notas\nalfa aqui\n');
  h.file('sub/deep.txt', 'alfa em profundidade\n');
});
afterEach(() => h.cleanup());

describe('grep — matches via the ripgrep binary', () => {
  it('finds matching lines across files with relative paths and 1-based line numbers', async () => {
    const { matches } = await grep(h.ctx(), GRANT, 'alfa');
    // Order is ripgrep's traversal order — assert as a set.
    const asSet = matches.map((m) => `${m.path}:${m.line}:${m.text}`).sort();
    expect(asSet).toEqual(
      [
        'contrato.txt:1:linha 1 alfa',
        'contrato.txt:3:linha 3 alfa gama',
        'notas.md:2:alfa aqui',
        'sub/deep.txt:1:alfa em profundidade',
      ].sort(),
    );
    // One grep egress row, sized to the serialized matches.
    const serialized = Buffer.from(JSON.stringify(matches), 'utf8').length;
    expect(h.rows()).toHaveLength(1);
    expect(h.rows()[0]).toMatchObject({ kind: 'read', tool: 'grep', bytesOut: serialized });
  });

  it('truncates long lines to maxLineLength', async () => {
    h.file('long.txt', `alfa ${'z'.repeat(2000)}\n`);
    const { matches } = await grep(h.ctx(), GRANT, 'alfa', { maxLineLength: 20 });
    for (const m of matches) expect(m.text.length).toBeLessThanOrEqual(20);
  });
});

describe('grep — argument-injection guard', () => {
  it('rejects a pattern beginning with "-" (denied S1, ledgered), never spawning rg', async () => {
    let caught: ToolError | undefined;
    try {
      await grep(h.ctx(), GRANT, '-x');
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught).toBeInstanceOf(ToolError);
    expect(caught?.reason).toBe('grep pattern rejected: leading dash');
    expect(caught?.principle).toBe('S1');
    expect(h.denials().at(-1)).toMatchObject({ tool: 'grep', principle: 'S1' });
  });
});

describe('grep — containment + cap', () => {
  it('a grant not held for this session is denied S1', async () => {
    let caught: ToolError | undefined;
    try {
      await grep(h.ctx({ session: 'sess-OTHER' }), GRANT, 'alfa');
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.principle).toBe('S1');
    expect(caught?.reason).toBe(`unknown grant: ${GRANT}`);
  });

  it('a cap breach on the serialized matches is denied S5 (matches found, but too big to emit)', async () => {
    let caught: ToolError | undefined;
    try {
      await grep(h.ctx({ budgetBytes: 10 }), GRANT, 'alfa');
    } catch (e) {
      caught = e as ToolError;
    }
    expect(caught?.reason).toBe('egress cap reached');
    expect(caught?.principle).toBe('S5');
    expect(h.denials().at(-1)).toMatchObject({ tool: 'grep', principle: 'S5' });
    expect(h.egress.used(SESSION)).toBe(0);
  });
});

describe('grep — output is bounded on a huge file', () => {
  it('stops at maxMatches rather than returning every match', async () => {
    const lines = Array.from({ length: 3000 }, (_v, i) => `alfa linha ${i}`).join('\n');
    h.file('huge.txt', `${lines}\n`);
    const { matches } = await grep(h.ctx(), GRANT, 'alfa', { maxMatches: 200 });
    expect(matches).toHaveLength(200);
  });

  it('is bounded by the 1MB stdout cap even with maxMatches effectively unbounded', async () => {
    // ~3000 long matching lines produce well over 1MB of ripgrep --json output; the maxBuffer cap
    // kills the child and we parse the bounded capture, so the result is bounded below the total.
    const lines = Array.from({ length: 3000 }, (_v, i) => `alfa ${'z'.repeat(500)} ${i}`).join('\n');
    h.file('huge.txt', `${lines}\n`);
    const { matches } = await grep(h.ctx(), GRANT, 'alfa', { maxMatches: 1_000_000 });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.length).toBeLessThan(3000);
  });
});
