import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EgressLedger } from '../../src/ledger/index.js';
import { GrantTable } from '../../src/session/index.js';
import { loadGrants } from '../../src/auth/index.js';
import {
  browseDirectory,
  startLocalSurface,
  type LocalSurfaceHandle,
} from '../../src/surface/index.js';

/**
 * The C3 browser surface (decisions.md 2026-07-11): grants list/mint/revoke + /browse + the
 * all-sessions ledger, exactly as the hosted dashboard consumes them over loopback.
 */
let home: string;
let files: string;
let ledgerDir: string;
let ledger: EgressLedger;
let table: GrantTable;
let handle: LocalSurfaceHandle;
let suffix = 0;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'ekoa-surf-home-'));
  files = mkdtempSync(join(tmpdir(), 'ekoa-surf-files-'));
  ledgerDir = join(home, 'ledger');
  ledger = new EgressLedger(ledgerDir);
  table = new GrantTable();
  suffix = 0;
  handle = await startLocalSurface(
    {
      getStatus: () => ({ paired: true, connection: 'open' }),
      ledger,
      grants: { home, table, randomSuffix: () => `t${(suffix += 1)}`, now: () => 1_752_200_000_000 },
      browseRoots: [files],
    },
    0,
  );
});
afterEach(async () => {
  await handle.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(files, { recursive: true, force: true });
});

const base = () => `http://127.0.0.1:${handle.port}`;
const getJson = async (path: string) => {
  const res = await fetch(`${base()}${path}`);
  return { status: res.status, body: (await res.json().catch(() => undefined)) as Record<string, unknown> };
};
const postJson = async (path: string, body: unknown) => {
  const res = await fetch(`${base()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as Record<string, unknown> };
};

describe('grants over the surface (C3)', () => {
  it('starts empty, mints a dir grant into BOTH truths, lists it', async () => {
    expect((await getJson('/grants')).body).toEqual({ grants: [] });

    const dir = join(files, 'contratos');
    mkdirSync(dir);
    const created = await postJson('/grants', { path: dir, session: 'sess-web-1', label: 'Contratos 2026' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      grantRef: 'g-t1',
      path: dir,
      session: 'sess-web-1',
      label: 'Contratos 2026',
      requested: 'dir',
    });

    // Durable truth: grants.json. Live truth: the running daemon's table resolves it.
    expect(loadGrants(home)).toHaveLength(1);
    expect(table.grantFor('g-t1', 'sess-web-1')).toMatchObject({ root: dir });
    expect(table.grantFor('g-t1', 'other-session')).toBeUndefined(); // still session-scoped (S2)

    const listed = await getJson('/grants');
    const grants = listed.body.grants as { grantRef: string; path: string; label: string }[];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ grantRef: 'g-t1', path: dir, label: 'Contratos 2026' });
  });

  it('a FILE pick grants its PARENT folder, honestly, labelled with the file name', async () => {
    const dir = join(files, 'docs');
    mkdirSync(dir);
    const file = join(dir, 'contrato.pdf');
    writeFileSync(file, 'x');

    const created = await postJson('/grants', { path: file, session: 's1' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ path: dir, label: 'contrato.pdf', requested: 'file' });
  });

  it('404s a missing path and 400s a bodyless/invalid mint', async () => {
    expect((await postJson('/grants', { path: join(files, 'nope'), session: 's1' })).status).toBe(404);
    expect((await postJson('/grants', { session: 's1' })).status).toBe(400);
    expect((await postJson('/grants', { path: '', session: 's1' })).status).toBe(400);
    const res = await fetch(`${base()}/grants`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('revoke drops the grant from store AND live table, idempotently', async () => {
    const dir = join(files, 'd');
    mkdirSync(dir);
    const { body } = await postJson('/grants', { path: dir, session: 's1' });

    const first = await postJson('/grants/revoke', { grantRef: body.grantRef });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ revoked: true });
    expect(loadGrants(home)).toHaveLength(0);
    expect(table.grantFor(body.grantRef as string, 's1')).toBeUndefined();

    const second = await postJson('/grants/revoke', { grantRef: body.grantRef });
    expect(second.body).toEqual({ revoked: false });
  });
});

describe('browse (the in-app picker read)', () => {
  it('lists the root when no path is given: dirs first, dotfiles hidden, sizes on files', async () => {
    mkdirSync(join(files, 'bdir'));
    mkdirSync(join(files, 'adir'));
    writeFileSync(join(files, 'zeta.txt'), 'abc');
    writeFileSync(join(files, '.hidden'), 'x');

    const { status, body } = await getJson('/browse');
    expect(status).toBe(200);
    expect(body.path).toBe(files);
    expect(body.parent).toBeUndefined(); // the root has no parent inside the allowed roots
    expect(body.entries).toEqual([
      { name: 'adir', kind: 'dir' },
      { name: 'bdir', kind: 'dir' },
      { name: 'zeta.txt', kind: 'file', size: 3 },
    ]);
  });

  it('navigates into a subdirectory and reports its parent', async () => {
    const sub = join(files, 'sub');
    mkdirSync(sub);
    const { body } = await getJson(`/browse?path=${encodeURIComponent(sub)}`);
    expect(body.path).toBe(sub);
    expect(body.parent).toBe(files);
  });

  it('403s outside the allowed roots (including .. traversal)', async () => {
    expect((await getJson(`/browse?path=${encodeURIComponent(tmpdir())}`)).status).toBe(403);
    expect((await getJson(`/browse?path=${encodeURIComponent(join(files, '..'))}`)).status).toBe(403);
  });

  it('404s a file or missing path', async () => {
    writeFileSync(join(files, 'f.txt'), 'x');
    expect((await getJson(`/browse?path=${encodeURIComponent(join(files, 'f.txt'))}`)).status).toBe(404);
    expect((await getJson(`/browse?path=${encodeURIComponent(join(files, 'missing'))}`)).status).toBe(404);
  });

  it('renders a symlinked directory as a plain entry (not walkable)', () => {
    const real = mkdtempSync(join(tmpdir(), 'ekoa-surf-outside-'));
    try {
      symlinkSync(real, join(files, 'link'));
      const outcome = browseDirectory(files, [files]);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        const link = outcome.result.entries.find((e) => e.name === 'link');
        expect(link?.kind).toBe('file');
      }
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });
});

describe('all-sessions ledger read (C3 follow-up)', () => {
  const row = (session: string, ts: string, path: string) => ({
    kind: 'read' as const,
    ts,
    session,
    correlationId: `c-${path}`,
    path,
    byteRange: '0-1',
    bytesOut: 1,
    sha256: 'a'.repeat(64),
    tool: 'read',
    taskId: 't1',
  });

  it('merges every session ts-ordered; per-session read still works', async () => {
    ledger.append(row('sess-b', '2026-07-11T10:00:02.000Z', 'b.txt'));
    ledger.append(row('sess-a', '2026-07-11T10:00:01.000Z', 'a.txt'));
    ledger.append(row('sess-a', '2026-07-11T10:00:03.000Z', 'c.txt'));

    const all = await getJson('/ledger');
    expect(all.status).toBe(200);
    expect((all.body.rows as { path: string }[]).map((r) => r.path)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(all.body.corrupt).toBe(0);

    const one = await getJson('/ledger?session=sess-a');
    expect(one.body.rows).toHaveLength(2);
    expect(one.body.session).toBe('sess-a');
  });
});
