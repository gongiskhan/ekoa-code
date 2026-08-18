import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { GrantTable, EgressAccounting } from '../../src/session/index.js';
import { EgressLedger } from '../../src/ledger/index.js';
import { resetFirstWriteState } from '../../src/tools/index.js';
import { runDelegatedTask, parseTaskProgram, type ProviderComplete } from '../../src/engine/index.js';
import type { DelegatedTask } from '../../src/wire/index.js';
import type { TaskProgram } from '../../src/engine/index.js';

/**
 * The delegation engine (S8), driven end to end over the committed tool + session + ledger layers.
 * The engine assumes the task binding was already verified (that is the S3 verify layer), so tests
 * build a DelegatedTask directly and exercise program parsing, step execution, the denial→status
 * mapping, the single provider-compose round trip, and the derived-output-only guard. Synthetic data
 * only; temp grant + ledger trees per test.
 */
const SESSION = 'sess-A';
const GRANT = 'g1';

let root: string;
let grantRoot: string;
let ledgerDir: string;
let grantTable: GrantTable;
let egress: EgressAccounting;
let ledger: EgressLedger;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ekoa-engine-'));
  grantRoot = join(root, 'granted');
  mkdirSync(grantRoot, { recursive: true });
  ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-engine-ledger-'));
  grantTable = new GrantTable([{ grantRef: GRANT, root: grantRoot, session: SESSION }]);
  egress = new EgressAccounting();
  ledger = new EgressLedger(ledgerDir);
  resetFirstWriteState();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(ledgerDir, { recursive: true, force: true });
});

function file(relPath: string, content: string): void {
  const abs = join(grantRoot, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
}

function makeTask(program: TaskProgram | string, over: Partial<DelegatedTask> = {}): DelegatedTask {
  const task = typeof program === 'string' ? program : JSON.stringify(program);
  return {
    taskId: 'task-1', org: 'orgA', user: 'u1', session: SESSION, pairingId: 'p1',
    grantRefs: [GRANT], task, budget: { egressBytes: 1_000_000, modelSpend: { userId: 'u1' } },
    expiry: '2999-01-01T00:00:00Z', nonce: 'n1', sig: 'unused-by-engine',
    ...over,
  } as DelegatedTask;
}

function deps(over: Partial<Parameters<typeof runDelegatedTask>[1]> = {}) {
  return { grantTable, egress, ledger, now: () => 1_700_000_000_000, ...over };
}

const rows = () => ledger.readAll(SESSION).rows;
const denials = () => rows().filter((r) => r.kind === 'denial');

describe('parseTaskProgram', () => {
  it('parses a valid v1 program', () => {
    const p = parseTaskProgram(JSON.stringify({ v: 1, steps: [{ tool: 'read', grantRef: GRANT, relPath: 'a.txt' }] }));
    expect(p?.v).toBe(1);
    expect(p?.steps).toHaveLength(1);
  });
  it('returns null for non-JSON and for a wrong shape', () => {
    expect(parseTaskProgram('not json')).toBeNull();
    expect(parseTaskProgram(JSON.stringify({ v: 2, steps: [] }))).toBeNull();
    expect(parseTaskProgram(JSON.stringify({ steps: 'nope' }))).toBeNull();
    expect(parseTaskProgram(JSON.stringify({ v: 1, steps: [{ tool: 'bash', cmd: 'rm -rf /' }] }))).toBeNull();
  });
});

describe('runDelegatedTask — denial mapping', () => {
  it('an unparseable (natural-language) task → denied + a ledgered S3 denial, never guessed', async () => {
    const result = await runDelegatedTask(makeTask('please summarise my contract'), deps());
    expect(result.status).toBe('denied');
    expect(denials().at(-1)).toMatchObject({ principle: 'S3', reason: 'task not executable: unsupported shape' });
  });

  it('a read of an out-of-grant path → denied (S1 containment) + ledgered', async () => {
    file('secret.txt', 'x');
    const program: TaskProgram = { v: 1, steps: [{ tool: 'read', grantRef: GRANT, relPath: '../escape.txt' }] };
    const result = await runDelegatedTask(makeTask(program), deps());
    expect(result.status).toBe('denied');
    expect(denials().at(-1)?.principle).toBe('S1');
  });

  it('an unknown grantRef → denied', async () => {
    const program: TaskProgram = { v: 1, steps: [{ tool: 'read', grantRef: 'g-unknown', relPath: 'a.txt' }] };
    const result = await runDelegatedTask(makeTask(program), deps());
    expect(result.status).toBe('denied');
  });

  it('exceeding the egress budget → cap_reached', async () => {
    file('big.txt', 'X'.repeat(100));
    const program: TaskProgram = { v: 1, steps: [{ tool: 'read', grantRef: GRANT, relPath: 'big.txt' }] };
    const result = await runDelegatedTask(makeTask(program, { budget: { egressBytes: 10, modelSpend: { userId: 'u1' } } }), deps());
    expect(result.status).toBe('cap_reached');
  });
});

describe('runDelegatedTask — successful programs', () => {
  it('runs read steps, collects citations, ledgers reads, and returns derived-only ok', async () => {
    file('contrato.txt', 'Secção 3.1: indemnizações limitadas a 12 meses. NIF 500000000.');
    const program: TaskProgram = {
      v: 1,
      steps: [{ tool: 'read', grantRef: GRANT, relPath: 'contrato.txt', as: 'c', cite: true }],
      answer: 'A secção 3.1 limita as indemnizações a 12 meses.',
    };
    const result = await runDelegatedTask(makeTask(program), deps());
    expect(result.status).toBe('ok');
    expect(result.answer).toMatch(/12 meses/);
    expect(result.citations).toEqual([{ path: 'contrato.txt', range: expect.stringMatching(/^0-\d+$/) }]);
    expect(result.telemetry.egressBytes).toBeGreaterThan(0);
    expect(result.ledgerRefs.length).toBeGreaterThan(0);
    // DERIVED-OUTPUT-ONLY: the raw file bytes never appear in the result.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('NIF 500000000');
    expect(serialized).not.toContain('indemnizações limitadas a 12 meses');
    // The read was ledgered.
    expect(rows().some((r) => r.kind === 'read' && r.tool === 'read')).toBe(true);
  });

  it('a compose step sends the excerpts to the provider and returns the provider answer', async () => {
    file('contrato.txt', 'Parte: ACME Lda. Secção 3.1.');
    let captured: unknown;
    const providerComplete: ProviderComplete = async (body) => {
      captured = body;
      return { content: [{ type: 'text', text: 'resumo derivado do contrato' }] };
    };
    const program: TaskProgram = {
      v: 1,
      steps: [{ tool: 'read', grantRef: GRANT, relPath: 'contrato.txt', as: 'c', cite: true }],
      compose: { provider: true, instructions: 'Resuma a secção 3.1' },
    };
    const result = await runDelegatedTask(makeTask(program), deps({ providerComplete }));
    expect(result.status).toBe('ok');
    expect(result.answer).toBe('resumo derivado do contrato');
    // The excerpt crossed Boundary 1 in the provider request body...
    expect(JSON.stringify(captured)).toContain('ACME Lda');
    // ...but NOT in the returned result.
    expect(JSON.stringify(result)).not.toContain('ACME Lda');
    // Real-provider parity (found live): the Messages wire requires max_tokens; the daemon sends
    // no `model` (Cortex's provider endpoint clamps it to its wire tier, §18.4).
    const body = captured as Record<string, unknown>;
    expect(typeof body.max_tokens).toBe('number');
    expect(body.model).toBeUndefined();
  });

  it('C5: a provider ERROR body surfaces as an honest PT note, never an empty answer', async () => {
    file('contrato.txt', 'Secção 3.1.');
    const program: TaskProgram = {
      v: 1,
      steps: [{ tool: 'read', grantRef: GRANT, relPath: 'contrato.txt', as: 'c' }],
      compose: { provider: true, instructions: 'Resuma' },
    };

    const auth: ProviderComplete = async () => ({ type: 'error', error: { type: 'credential_error', message: 'gateway said no' } });
    const authResult = await runDelegatedTask(makeTask(program), deps({ providerComplete: auth }));
    expect(authResult.status).toBe('ok');
    expect(authResult.answer).toContain('recusou a credencial da ponte');

    const billing: ProviderComplete = async () => ({ type: 'error', error: { type: 'BILLING_LOCKED', message: 'A sua conta tem um problema de faturação. Contacte o suporte.' } });
    const billingResult = await runDelegatedTask(makeTask(program), deps({ providerComplete: billing }));
    expect(billingResult.answer).toBe('A sua conta tem um problema de faturação. Contacte o suporte.');

    const rate: ProviderComplete = async () => ({ type: 'error', error: { type: 'rate_limit_error', message: '' } });
    expect((await runDelegatedTask(makeTask(program), deps({ providerComplete: rate }))).answer).toContain('limite de utilização');

    const unknown: ProviderComplete = async () => ({ type: 'error', error: { type: 'api_error', message: 'x' } });
    expect((await runDelegatedTask(makeTask(program), deps({ providerComplete: unknown }))).answer).toContain('api_error');
  });

  it('a compose step with no providerComplete wired → denied (no local brain, ADR-001)', async () => {
    file('a.txt', 'hello');
    const program: TaskProgram = {
      v: 1,
      steps: [{ tool: 'read', grantRef: GRANT, relPath: 'a.txt', as: 'a' }],
      compose: { provider: true },
    };
    const result = await runDelegatedTask(makeTask(program), deps());
    expect(result.status).toBe('denied');
  });

  it('the derived-output-only guard THROWS if the provider answer echoes a whole excerpt verbatim (leak backstop)', async () => {
    const leak = 'CONFIDENTIAL client roster: Petrova Holdings, ACME Lda, and 40 more names.';
    file('roster.txt', leak);
    const providerComplete: ProviderComplete = async () => ({ content: [{ type: 'text', text: leak }] });
    const program: TaskProgram = {
      v: 1,
      steps: [{ tool: 'read', grantRef: GRANT, relPath: 'roster.txt', as: 'r' }],
      compose: { provider: true },
    };
    await expect(runDelegatedTask(makeTask(program), deps({ providerComplete }))).rejects.toThrow(/derived-output-only/);
  });

  it('a write step records a patch proposal (path + hash-summary), not the file bytes', async () => {
    file('notes.md', 'old');
    const before = createHash('sha256').update(Buffer.from('old', 'utf8')).digest('hex');
    const program: TaskProgram = {
      v: 1,
      steps: [{ tool: 'write', grantRef: GRANT, relPath: 'notes.md', content: 'new content', expectedSha256: before, confirmed: true }],
    };
    const result = await runDelegatedTask(makeTask(program), deps());
    expect(result.status).toBe('ok');
    expect(result.patches?.[0]?.path).toBe('notes.md');
    expect(JSON.stringify(result)).not.toContain('new content');
    expect(rows().some((r) => r.kind === 'write')).toBe(true);
  });
});

describe('runDelegatedTask — cancel', () => {
  it('an aborted signal stops the program and returns denied', async () => {
    file('a.txt', 'x');
    const controller = new AbortController();
    controller.abort();
    const program: TaskProgram = { v: 1, steps: [{ tool: 'read', grantRef: GRANT, relPath: 'a.txt' }] };
    const result = await runDelegatedTask(makeTask(program), deps({ signal: controller.signal }));
    expect(result.status).toBe('denied');
  });
});
