import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * S5 uploaded-file blob migration tool (api/scripts/migrate/migrate-app-files.mjs).
 *
 * The OLD stack (ekoa-dev cortex) keeps blobs at <dataDir>/app-data/<appId>/files/<uuid>
 * with metadata rows in the reserved '__files' app-data collection (a JSON array at
 * <appDir>/__files.json on the fs backend). The NEW stack (api/src/apps/app-files.ts)
 * serves the same blob layout but requires a {uuid}.json SIDECAR per blob - a raw blob
 * copy serves 404. These tests drive the REAL operator surface (the CLI as a
 * subprocess, real exit codes) over temp dirs.
 *
 * The served sidecar shape is PINNED here rather than exercised through the real
 * reader: appFilesStore is module-private in api/src/apps/app-files.ts (only the
 * router and saveAppFileBlob are exported), and mounting the router drags in
 * resolveApp + activation state - not cheap. The pins cite the exact lines:
 *   - AppFileMeta { id, name, size, type, createdAt }   app-files.ts:31
 *   - save() writes JSON.stringify(meta) in that key order   app-files.ts:68-69
 *   - get() JSON.parse's the sidecar and requires the blob   app-files.ts:72-84
 *   - serving sets Content-Type/Content-Length/Content-Disposition from
 *     meta.type / meta.size / meta.name   app-files.ts:186-188
 *
 * All fixture data is synthetic (fixed test uuids, fake names, fake bytes) - never
 * real client data.
 */

const SCRIPT = fileURLToPath(new URL('../../scripts/migrate/migrate-app-files.mjs', import.meta.url));
const APP_ID = 'migrated-legal-app-test';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

// Binary-ish synthetic bytes (non-utf8) prove the copy is byte-faithful.
const BYTES_A = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0xfe, 0x01]);
const BYTES_B = Buffer.from('synthetic-kyc-doc-not-real', 'utf8');

/** Old fs-backend '__files' row: { id, name, size, type } from cortex save() plus
 *  createdAt/updatedAt stamped by buildNewItem (app-data-backend.ts:54-61). */
function rowFor(id: string, bytes: Buffer, over: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Contrato Assinado (teste).pdf',
    size: bytes.length,
    type: 'application/pdf',
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-02T11:00:00.000Z',
    ...over,
  };
}

const tempRoots: string[] = [];
afterEach(() => {
  for (const d of tempRoots.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'migrate-app-files-'));
  tempRoots.push(d);
  return d;
}

/** Lay out an old-stack app-data dir: files/<uuid> blobs + __files.json rows. */
function makeSrc(root: string, rows: unknown[], blobs: Record<string, Buffer>): string {
  const src = join(root, 'src-app-data');
  mkdirSync(join(src, 'files'), { recursive: true });
  writeFileSync(join(src, '__files.json'), JSON.stringify(rows, null, 2));
  for (const [id, bytes] of Object.entries(blobs)) writeFileSync(join(src, 'files', id), bytes);
  return src;
}

function targetFilesDir(dataRoot: string): string {
  // Mirror of the serving layout: <dataDir>/app-data/<appId>/files (app-files.ts:52-54).
  return join(dataRoot, 'app-data', APP_ID, 'files');
}

function run(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    // Blank EKOA_DATA_DIR so a developer's real env never leaks into a test run
    // ('' is falsy in the script's `EKOA_DATA_DIR || ~/.ekoa/data` resolution).
    env: { ...process.env, EKOA_DATA_DIR: '', ...env },
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

function baseArgs(src: string, dataRoot: string): string[] {
  return ['--src', src, '--app-id', APP_ID, '--data-dir', dataRoot];
}

describe('migrate-app-files: happy path', () => {
  it('copies blobs and synthesizes served-shape sidecars, leaving --src untouched', () => {
    const root = tempRoot();
    const src = makeSrc(root, [rowFor(ID_A, BYTES_A), rowFor(ID_B, BYTES_B, { name: 'Cartão de Cidadão.pdf', type: 'image/png', createdAt: '2026-06-15T09:30:00.000Z' })], { [ID_A]: BYTES_A, [ID_B]: BYTES_B });
    const dataRoot = join(root, 'data');
    const srcListingBefore = readdirSync(join(src, 'files')).sort();
    const srcRowsBefore = readFileSync(join(src, '__files.json'), 'utf8');

    const res = run(baseArgs(src, dataRoot));
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('2 copied, 0 overwritten, 0 unchanged');

    const target = targetFilesDir(dataRoot);
    // Blobs byte-identical (binary-safe).
    expect(readFileSync(join(target, ID_A)).equals(BYTES_A)).toBe(true);
    expect(readFileSync(join(target, ID_B)).equals(BYTES_B)).toBe(true);

    // Sidecars byte-identical to what a live appFilesStore.save() writes:
    // JSON.stringify of AppFileMeta in key order id,name,size,type,createdAt
    // (api/src/apps/app-files.ts:31,68-69). createdAt is preserved from the old
    // row; updatedAt and any other row field are dropped.
    const rawA = readFileSync(join(target, `${ID_A}.json`), 'utf8');
    expect(rawA).toBe(JSON.stringify({
      id: ID_A,
      name: 'Contrato Assinado (teste).pdf',
      size: BYTES_A.length,
      type: 'application/pdf',
      createdAt: '2026-05-01T10:00:00.000Z',
    }));
    const parsedA = JSON.parse(rawA) as Record<string, unknown>;
    expect(Object.keys(parsedA)).toEqual(['id', 'name', 'size', 'type', 'createdAt']);

    // PT-PT display name survives (both stacks share the same sanitize rule).
    const parsedB = JSON.parse(readFileSync(join(target, `${ID_B}.json`), 'utf8')) as Record<string, unknown>;
    expect(parsedB.name).toBe('Cartão de Cidadão.pdf');
    expect(parsedB.type).toBe('image/png');
    expect(parsedB.createdAt).toBe('2026-06-15T09:30:00.000Z');

    // --src is read-only: same entries, same metadata bytes.
    expect(readdirSync(join(src, 'files')).sort()).toEqual(srcListingBefore);
    expect(readFileSync(join(src, '__files.json'), 'utf8')).toBe(srcRowsBefore);
    expect(readdirSync(src).sort()).toEqual(['__files.json', 'files']);
  });

  it('reads the __files rows from a dump JSON when no __files.json exists (bare-array collections are never metadata)', () => {
    const root = tempRoot();
    const src = join(root, 'src-app-data');
    mkdirSync(join(src, 'files'), { recursive: true });
    writeFileSync(join(src, 'files', ID_A), BYTES_A);
    // Ordinary old app-data collection (bare JSON array) - must be ignored.
    writeFileSync(join(src, 'clientes.json'), JSON.stringify([{ id: 'c1', nif: '000000000' }]));
    // The prod app-data dump shape carries collections.__files.
    writeFileSync(join(src, 'dump.json'), JSON.stringify({
      appId: 'prod-app-synthetic',
      collections: { __files: [rowFor(ID_A, BYTES_A)], clientes: [{ id: 'c1' }] },
    }));
    const dataRoot = join(root, 'data');

    const res = run(baseArgs(src, dataRoot));
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('dump.json');
    expect(existsSync(join(targetFilesDir(dataRoot), `${ID_A}.json`))).toBe(true);
  });

  it('refuses ambiguous metadata: two dump files both carrying __files', () => {
    const root = tempRoot();
    const src = join(root, 'src-app-data');
    mkdirSync(join(src, 'files'), { recursive: true });
    writeFileSync(join(src, 'files', ID_A), BYTES_A);
    writeFileSync(join(src, 'dump1.json'), JSON.stringify({ collections: { __files: [rowFor(ID_A, BYTES_A)] } }));
    writeFileSync(join(src, 'dump2.json'), JSON.stringify({ __files: [rowFor(ID_A, BYTES_A)] }));
    const dataRoot = join(root, 'data');

    const res = run(baseArgs(src, dataRoot));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('ambiguous metadata');
    expect(existsSync(join(dataRoot, 'app-data'))).toBe(false);
  });

  it('resolves the default data dir from EKOA_DATA_DIR when --data-dir is omitted (config.ts:342 resolution)', () => {
    const root = tempRoot();
    const src = makeSrc(root, [rowFor(ID_A, BYTES_A)], { [ID_A]: BYTES_A });
    const dataRoot = join(root, 'env-data');

    const res = run(['--src', src, '--app-id', APP_ID], { EKOA_DATA_DIR: dataRoot });
    expect(res.status).toBe(0);
    expect(existsSync(join(targetFilesDir(dataRoot), ID_A))).toBe(true);
  });
});

describe('migrate-app-files: orphan refusal', () => {
  it('refuses loudly on a blob with no metadata row, writing NOTHING; --allow-orphans proceeds while reporting', () => {
    const root = tempRoot();
    // ID_C blob has no row.
    const src = makeSrc(root, [rowFor(ID_A, BYTES_A)], { [ID_A]: BYTES_A, [ID_C]: BYTES_B });
    const dataRoot = join(root, 'data');

    const refused = run(baseArgs(src, dataRoot));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('orphan blob');
    expect(refused.stderr).toContain(ID_C);
    // All-or-nothing: the matched pair was NOT written either.
    expect(existsSync(join(dataRoot, 'app-data'))).toBe(false);

    const allowed = run([...baseArgs(src, dataRoot), '--allow-orphans']);
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain(ID_C); // still reported
    const target = targetFilesDir(dataRoot);
    expect(existsSync(join(target, ID_A))).toBe(true);
    expect(existsSync(join(target, `${ID_A}.json`))).toBe(true);
    expect(existsSync(join(target, ID_C))).toBe(false); // orphan skipped, not copied
  });

  it('refuses loudly on a row with no blob; --allow-orphans proceeds, also reporting invalid-id rows', () => {
    const root = tempRoot();
    // ID_B row has no blob; one row has a non-uuid id (unservable: app-files.ts:33-36).
    const src = makeSrc(
      root,
      [rowFor(ID_A, BYTES_A), rowFor(ID_B, BYTES_B), { id: 'not-a-uuid', name: 'x.pdf' }],
      { [ID_A]: BYTES_A },
    );
    const dataRoot = join(root, 'data');

    const refused = run(baseArgs(src, dataRoot));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('orphan row');
    expect(refused.stderr).toContain(ID_B);
    expect(existsSync(join(dataRoot, 'app-data'))).toBe(false);

    const allowed = run([...baseArgs(src, dataRoot), '--allow-orphans']);
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain(ID_B);
    expect(allowed.stdout).toContain('invalid');
    const target = targetFilesDir(dataRoot);
    expect(existsSync(join(target, ID_A))).toBe(true);
    expect(existsSync(join(target, `${ID_B}.json`))).toBe(false); // no sidecar without a blob
  });
});

describe('migrate-app-files: idempotency', () => {
  it('re-run over an already-migrated target is a no-op; differing target content refuses unless --force', () => {
    const root = tempRoot();
    const src = makeSrc(root, [rowFor(ID_A, BYTES_A), rowFor(ID_B, BYTES_B)], { [ID_A]: BYTES_A, [ID_B]: BYTES_B });
    const dataRoot = join(root, 'data');
    const target = targetFilesDir(dataRoot);

    expect(run(baseArgs(src, dataRoot)).status).toBe(0);
    const mtimeAfterFirst = statSync(join(target, ID_A)).mtimeMs;

    const second = run(baseArgs(src, dataRoot));
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('0 copied, 0 overwritten, 2 unchanged');
    expect(statSync(join(target, ID_A)).mtimeMs).toBe(mtimeAfterFirst); // no rewrite

    // Corrupt the migrated blob: a re-run must refuse, --force restores it.
    writeFileSync(join(target, ID_A), Buffer.concat([BYTES_A, Buffer.from([0x00])]));
    const refused = run(baseArgs(src, dataRoot));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('DIFFERENT content');

    const forced = run([...baseArgs(src, dataRoot), '--force']);
    expect(forced.status).toBe(0);
    expect(forced.stdout).toContain('1 overwritten');
    expect(readFileSync(join(target, ID_A)).equals(BYTES_A)).toBe(true);
  });

  it("refuses a row/blob size mismatch (blob may be truncated - Content-Length is served from meta.size); --force writes the ACTUAL size", () => {
    const root = tempRoot();
    const src = makeSrc(root, [rowFor(ID_A, BYTES_A, { size: 999 })], { [ID_A]: BYTES_A });
    const dataRoot = join(root, 'data');

    const refused = run(baseArgs(src, dataRoot));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('size mismatch');
    expect(existsSync(join(dataRoot, 'app-data'))).toBe(false);

    const forced = run([...baseArgs(src, dataRoot), '--force']);
    expect(forced.status).toBe(0);
    const meta = JSON.parse(readFileSync(join(targetFilesDir(dataRoot), `${ID_A}.json`), 'utf8')) as { size: number };
    // Content-Length must match the bytes on disk (app-files.ts:187), so the
    // actual blob size wins over the lying row.
    expect(meta.size).toBe(BYTES_A.length);
  });
});

describe('migrate-app-files: dry-run', () => {
  it('plans and reports but touches nothing', () => {
    const root = tempRoot();
    const src = makeSrc(root, [rowFor(ID_A, BYTES_A), rowFor(ID_B, BYTES_B)], { [ID_A]: BYTES_A, [ID_B]: BYTES_B });
    const dataRoot = join(root, 'data');

    const res = run([...baseArgs(src, dataRoot), '--dry-run']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('dry-run');
    expect(res.stdout).toContain('would write: 2 copied');
    expect(existsSync(join(dataRoot, 'app-data'))).toBe(false);
    expect(existsSync(dataRoot)).toBe(false); // not even the root is created
  });
});
