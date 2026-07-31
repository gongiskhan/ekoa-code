import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../src/cli.js';
import type { Io } from '../src/output.js';

/**
 * CLI-level suite: argument handling, the three exit codes, the `--json` contract (exactly one
 * document on stdout, errors on stderr only) and the `memory write` invocation contract that an
 * outside spool drain depends on. HTTP is stubbed here; e2e.test.ts proves the same paths against
 * the real server.
 */

const ENV = { CORTEX_BASE_URL: 'https://cortex.example.com', CORTEX_API_KEY: 'ekoa_gk_test' };

interface Captured {
  io: Io;
  out: string[];
  err: string[];
  bytes: Buffer[];
}
function capture(): Captured {
  const out: string[] = [];
  const err: string[] = [];
  const bytes: Buffer[] = [];
  return { out, err, bytes, io: { out: (t) => out.push(t), err: (t) => err.push(t), outBytes: (b) => bytes.push(b) } };
}

/** A fetch stub answering one canned JSON body, recording what it was asked. */
function stub(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const note = {
  title: 'Nota',
  type: 'note',
  permalink: 'capture/one',
  tags: [],
  created: '2026-07-31T09:00:00.000Z',
  modified: '2026-07-31T09:00:00.000Z',
  contentMd: '# Nota\ncorpo',
};

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'cortex-cli-unit-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('configuration', () => {
  it('is environment-only: a missing variable is a usage failure naming it, and nothing is defaulted', async () => {
    for (const missing of ['CORTEX_BASE_URL', 'CORTEX_API_KEY']) {
      const cap = capture();
      const env = { ...ENV, [missing]: '' };
      const code = await main(['memory', 'list'], { io: cap.io, env, fetchImpl: stub({ items: [] }).fetchImpl });
      expect(code).toBe(2);
      expect(cap.err.join('\n')).toContain(missing);
      expect(cap.out).toEqual([]);
    }
  });

  it('never embeds a key or an origin: the source contains no ekoa_gk_ literal and no default base url', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const srcDir = new URL('../src/', import.meta.url).pathname;
    const files = readdirSync(srcDir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const text = readFileSync(join(srcDir, file), 'utf8');
      expect(text, file).not.toMatch(/ekoa_gk_[A-Za-z0-9]/);
      expect(text, file).not.toMatch(/CORTEX_BASE_URL\s*\?\?/); // no silent fallback origin
    }
  });
});

describe('exit codes', () => {
  it('0 for a successful call', async () => {
    const cap = capture();
    const code = await main(['memory', 'list', '--json'], { io: cap.io, env: ENV, fetchImpl: stub({ items: [] }).fetchImpl });
    expect(code).toBe(0);
  });

  it('1 for an api refusal, with the envelope code and message on stderr and stdout untouched', async () => {
    const cap = capture();
    const { fetchImpl } = stub({ error: { code: 'NOT_FOUND', message: 'Nota não encontrada.' } }, 404);
    const code = await main(['memory', 'read', 'nao/existe', '--json'], { io: cap.io, env: ENV, fetchImpl });
    expect(code).toBe(1);
    expect(cap.out).toEqual([]);
    const doc = JSON.parse(cap.err.join('\n')) as { ok: boolean; error: { code: string; status: number } };
    expect(doc).toMatchObject({ ok: false, error: { code: 'NOT_FOUND', status: 404 } });
  });

  it('2 for usage: unknown group, unknown command, unknown flag, missing argument, extra argument', async () => {
    const cases: string[][] = [
      ['nope', 'list'],
      ['memory', 'frobnicate'],
      ['memory', 'list', '--nope', 'x'],
      ['memory', 'read'],
      ['memory', 'list', 'extra'],
      ['memory', 'write', '--permalink', 'a/b'], // no content source
      ['memory', 'write', '--file', 'x', '--content', 'y', '--permalink', 'a/b'], // two sources
      ['memory', 'export'], // no --out
      ['automations', 'run', 'a1', '--input', 'k=v', '--inputs-json', '{}'],
      ['automations', 'run', 'a1', '--input', 'novalue'],
      ['memory', 'list', '--limit', 'lots'],
      ['memory', 'list', '--limit', '9999'],
    ];
    for (const argv of cases) {
      const cap = capture();
      const code = await main(argv, { io: cap.io, env: ENV, fetchImpl: stub({ items: [] }).fetchImpl });
      expect(code, argv.join(' ')).toBe(2);
      expect(cap.err.join('\n'), argv.join(' ')).not.toBe('');
    }
  });

  it('0 for --help on the root and on every group', async () => {
    for (const argv of [['--help'], ['memory', '--help'], ['knowledge', '-h'], ['automations', '--help']]) {
      const cap = capture();
      expect(await main(argv, { io: cap.io, env: {} }), argv.join(' ')).toBe(0);
      expect(cap.out.join('\n')).toContain('cortex');
    }
    // Bare `cortex` is a usage failure, and its help goes to stderr so stdout stays parseable.
    const bare = capture();
    expect(await main([], { io: bare.io, env: {} })).toBe(2);
    expect(bare.out).toEqual([]);
  });
});

describe('--json output', () => {
  it('prints exactly ONE parseable document per command and nothing else', async () => {
    const cases: Array<{ argv: string[]; body: unknown; status?: number }> = [
      { argv: ['memory', 'list', '--json'], body: { items: [] } },
      { argv: ['memory', 'search', 'x', '--json'], body: { hits: [] } },
      { argv: ['memory', 'read', 'a/b', '--json'], body: note },
      { argv: ['memory', 'delete', 'a/b', '--json'], body: { ok: true } },
      { argv: ['knowledge', 'collections', '--json'], body: { items: ['x'] } },
      { argv: ['knowledge', 'search', 'x', '--json'], body: { hits: [] } },
      { argv: ['knowledge', 'documents', '--json'], body: { items: [], total: 0 } },
      { argv: ['knowledge', 'read', 'col', 'doc', '--json'], body: { id: 'doc', collection: 'col', title: 'T', contentMd: 'x', scope: 'org' } },
      { argv: ['automations', 'list', '--json'], body: { items: [] } },
      { argv: ['automations', 'show', 'a1', '--json'], body: { id: 'a1', name: 'A' } },
      { argv: ['automations', 'status', 'r1', '--json'], body: { id: 'r1', automationId: 'a1', status: 'completed' } },
      { argv: ['automations', 'logs', 'r1', '--json'], body: { runId: 'r1', steps: [] } },
      { argv: ['automations', 'watch', 'r1', '--json'], body: { id: 'r1', automationId: 'a1', status: 'completed' } },
      { argv: ['automations', 'run', 'a1', '--json'], body: { runId: 'r1' }, status: 202 },
    ];
    for (const { argv, body, status } of cases) {
      const cap = capture();
      const code = await main(argv, { io: cap.io, env: ENV, fetchImpl: stub(body, status).fetchImpl });
      expect(code, argv.join(' ')).toBe(0);
      expect(cap.out, argv.join(' ')).toHaveLength(1);
      const doc = JSON.parse(cap.out[0] as string) as { ok: boolean; command: string; status: number };
      expect(doc.ok, argv.join(' ')).toBe(true);
      expect(doc.command).toBe(argv.slice(0, 2).join(' '));
      expect(doc.status).toBe(status ?? 200);
    }
  });

  it('watch polls until the run settles, and gives up with exit 1 when it does not', async () => {
    // Two "running" answers then "completed": watch must keep polling and stop on its own.
    let polls = 0;
    const settling = (async () => {
      polls += 1;
      const status = polls >= 3 ? 'completed' : 'running';
      return new Response(JSON.stringify({ id: 'r1', automationId: 'a1', status }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    const settled = capture();
    expect(
      await main(['automations', 'watch', 'r1', '--interval-ms', '100', '--timeout-ms', '20000', '--json'], {
        io: settled.io,
        env: ENV,
        fetchImpl: settling,
      }),
    ).toBe(0);
    expect(JSON.parse(settled.out[0] as string)).toMatchObject({ terminal: true, blocked: false, polls: 3 });

    // A run that never settles ends as an api-class failure, not a hang.
    const stuck = capture();
    const code = await main(['automations', 'watch', 'r1', '--interval-ms', '100', '--timeout-ms', '250', '--json'], {
      io: stuck.io,
      env: ENV,
      fetchImpl: stub({ id: 'r1', automationId: 'a1', status: 'running' }).fetchImpl,
    });
    expect(code).toBe(1);
    expect(JSON.parse(stuck.err.join('\n'))).toMatchObject({ ok: false, error: { code: 'WATCH_TIMEOUT' } });

    // A run parked on a human gate stops the poll too, flagged as blocked rather than terminal.
    const blocked = capture();
    expect(
      await main(['automations', 'watch', 'r1', '--json'], {
        io: blocked.io,
        env: ENV,
        fetchImpl: stub({ id: 'r1', automationId: 'a1', status: 'awaiting_consent' }).fetchImpl,
      }),
    ).toBe(0);
    expect(JSON.parse(blocked.out[0] as string)).toMatchObject({ terminal: false, blocked: true });
  });

  it('automations run exposes the 202-vs-200 replay distinction', async () => {
    const fresh = capture();
    await main(['automations', 'run', 'a1', '--idempotency-key', 'k', '--json'], {
      io: fresh.io,
      env: ENV,
      fetchImpl: stub({ runId: 'r1' }, 202).fetchImpl,
    });
    expect(JSON.parse(fresh.out[0] as string)).toMatchObject({ status: 202, created: true, replayed: false, data: { runId: 'r1' } });

    const replay = capture();
    await main(['automations', 'run', 'a1', '--idempotency-key', 'k', '--json'], {
      io: replay.io,
      env: ENV,
      fetchImpl: stub({ runId: 'r1' }, 200).fetchImpl,
    });
    expect(JSON.parse(replay.out[0] as string)).toMatchObject({ status: 200, created: false, replayed: true, data: { runId: 'r1' } });

    // Human mode says the same thing in words.
    const human = capture();
    await main(['automations', 'run', 'a1'], { io: human.io, env: ENV, fetchImpl: stub({ runId: 'r1' }, 200).fetchImpl });
    expect(human.out.join('\n')).toContain('replayed run r1');
  });
});

describe('memory write invocation contract', () => {
  it('`memory write --file <path> --permalink <key> --json` needs nothing else and sends the file verbatim', async () => {
    const file = join(dir, 'capture-2026-07-31.md');
    writeFileSync(file, '# Captured heading\n\nbody text\n', 'utf8');
    const cap = capture();
    const { calls, fetchImpl } = stub(note);
    const code = await main(['memory', 'write', '--file', file, '--permalink', 'capture/one', '--json'], {
      io: cap.io,
      env: ENV,
      fetchImpl,
    });
    expect(code).toBe(0);
    const sent = JSON.parse(calls[0]?.init.body as string) as Record<string, unknown>;
    expect(calls[0]?.url).toBe('https://cortex.example.com/api/v1/memvault/notes');
    expect(sent.permalink).toBe('capture/one');
    expect(sent.contentMd).toBe('# Captured heading\n\nbody text\n');
    expect(sent.title).toBe('Captured heading'); // derived from the body's first heading
    expect(JSON.parse(cap.out[0] as string)).toMatchObject({ ok: true, command: 'memory write', status: 200 });
  });

  it('derives a title from the file name when the body has no heading, and honours --title', async () => {
    const file = join(dir, 'no-heading-note.md');
    writeFileSync(file, 'just a body\n', 'utf8');

    const derived = stub(note);
    await main(['memory', 'write', '--file', file, '--permalink', 'a/b'], { io: capture().io, env: ENV, fetchImpl: derived.fetchImpl });
    expect(JSON.parse(derived.calls[0]?.init.body as string).title).toBe('no-heading-note');

    const explicit = stub(note);
    await main(['memory', 'write', '--file', file, '--title', 'Explícito', '--tag', 'a', '--tag', 'b', '--folder', 'briefs'], {
      io: capture().io,
      env: ENV,
      fetchImpl: explicit.fetchImpl,
    });
    expect(JSON.parse(explicit.calls[0]?.init.body as string)).toMatchObject({ title: 'Explícito', tags: ['a', 'b'], folder: 'briefs' });
  });

  it('a missing --file is a usage failure, not a half-written note', async () => {
    const cap = capture();
    const { calls, fetchImpl } = stub(note);
    const code = await main(['memory', 'write', '--file', join(dir, 'absent.md'), '--permalink', 'a/b', '--json'], {
      io: cap.io,
      env: ENV,
      fetchImpl,
    });
    expect(code).toBe(2);
    expect(calls).toHaveLength(0);
    expect(JSON.parse(cap.err.join('\n'))).toMatchObject({ ok: false, error: { code: 'USAGE' } });
  });
});
