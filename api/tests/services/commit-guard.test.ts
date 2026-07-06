import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { activityLogs } from '../../src/data/stores.js';
import {

// Planted credential assembled at runtime so the fixture never exists as a
// literal on disk (the repo's own gitleaks gate stays strict).
const plantedKey = ['sk-ant', 'api03', 'FAKE'.repeat(6)].join('-');

  scanText,
  commitSnapshot,
  readVersions,
  SecretCommitError,
  type SnapshotAudit,
} from '../../src/services/commit-guard.js';

/**
 * Secret guard + version snapshot (spec/07 §7.9, ch09 code-egress):
 *  - the pure scanner flags high-confidence credentials only;
 *  - the git snapshot commits a clean tree and tags a broken final build
 *    `[build-failed]` (asserted via real `git log`);
 *  - a planted credential BLOCKS the snapshot and writes a `commit-blocked`
 *    activity row (with findings) through the single audit write path.
 *
 * Git operations run against real temp repos via `git`.
 */

let mem: MongoMemoryServer;
let sandbox: string;
let counter = 0;
const prevEnv: Record<string, string | undefined> = {};

const actor = { userId: 'u1', username: 'User One', orgId: 'orgA' };
const deps = { now: () => 1_700_000_000_000 + counter++, genId: () => `act_${counter++}` };
const audit: SnapshotAudit = { actor, deps };

function freshRepo(): string {
  const dir = join(sandbox, `app-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const gitSubjects = (dir: string): string[] =>
  execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf-8' }).trim().split('\n').filter(Boolean);

beforeAll(async () => {
  for (const k of ['SANDBOX_ROOT', 'EKOA_SECRET_GUARD']) prevEnv[k] = process.env[k];
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'sbx-')));
  process.env.SANDBOX_ROOT = sandbox;
  delete process.env.EKOA_SECRET_GUARD; // default 'block'
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_services');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  rmSync(sandbox, { recursive: true, force: true });
  for (const k of ['SANDBOX_ROOT', 'EKOA_SECRET_GUARD']) {
    if (prevEnv[k] === undefined) delete process.env[k];
    else process.env[k] = prevEnv[k]!;
  }
});

beforeEach(async () => {
  await activityLogs.deleteMany({});
});

describe('scanText (pure scanner)', () => {
  it('flags a high-confidence credential and reports rule + line, never the value', () => {
    const findings = scanText('config.ts', `const a = 1;\nconst key = "${plantedKey}";`);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ path: 'config.ts', rule: 'openai-anthropic-key', line: 2 });
  });

  it('passes clean source and skips lockfiles', () => {
    expect(scanText('src/main.ts', 'export const x = 1;')).toEqual([]);
    // A "secret" in a lockfile basename is skipped (hash false-positive territory).
    expect(scanText('package-lock.json', 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toEqual([]);
  });
});

describe('commitSnapshot (version snapshot)', () => {
  it('commits a clean tree, then tags a broken final build [build-failed]', async () => {
    const dir = freshRepo();
    writeFileSync(join(dir, 'index.html'), '<!doctype html>v1', 'utf-8');

    const first = await commitSnapshot({ projectDir: dir, message: 'build 1', authorName: 'Dev', authorEmail: 'dev@ekoa.local' });
    expect(first.createdNew).toBe(true);
    expect(first.sha).toBeTruthy();

    let versions = await readVersions(dir);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ message: 'build 1', buildFailed: false });

    // No changes → no new commit; returns current HEAD.
    const noop = await commitSnapshot({ projectDir: dir, message: 'build 1 again', authorName: 'Dev', authorEmail: 'dev@ekoa.local' });
    expect(noop.createdNew).toBe(false);
    expect(noop.sha).toBe(first.sha);

    // Broken final build is committed, tagged.
    writeFileSync(join(dir, 'index.html'), '<!doctype html>broken', 'utf-8');
    const broken = await commitSnapshot({
      projectDir: dir,
      message: 'final build',
      authorName: 'Dev',
      authorEmail: 'dev@ekoa.local',
      buildFailed: true,
    });
    expect(broken.createdNew).toBe(true);

    versions = await readVersions(dir);
    expect(versions[0]).toMatchObject({ message: 'final build', buildFailed: true });
    // Assert the literal tag via raw git log.
    expect(gitSubjects(dir)[0]).toBe('[build-failed] final build');
  });

  it('blocks a planted credential and writes a commit-blocked activity row with findings', async () => {
    const dir = freshRepo();
    writeFileSync(join(dir, 'app.js'), 'const ok = true;', 'utf-8');
    // Synthetic, checksum-invalid fake credential.
    writeFileSync(join(dir, 'secrets.js'), `const key = "${plantedKey}";`, 'utf-8');

    await expect(
      commitSnapshot({ projectDir: dir, message: 'build with secret', authorName: 'Dev', authorEmail: 'dev@ekoa.local', audit }),
    ).rejects.toBeInstanceOf(SecretCommitError);

    // The snapshot was refused: no commit landed.
    expect(await readVersions(dir)).toHaveLength(0);
    // The file remains on disk (the guard blocks the commit, not the save).
    expect(existsSync(join(dir, 'secrets.js'))).toBe(true);

    // A commit-blocked audit row was written through the single write path, with findings.
    const rows = await activityLogs.find({ type: 'commit-blocked' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'u1', username: 'User One', orgId: 'orgA', category: 'execute' });
    const findings = (rows[0]!.metadata as { findings: Array<{ path: string }> }).findings;
    expect(findings.some((f) => f.path === 'secrets.js')).toBe(true);
  });

  it('confines projectDir to the sandbox (rejects an out-of-jail path)', async () => {
    await expect(
      commitSnapshot({ projectDir: '/etc', message: 'x', authorName: 'Dev', authorEmail: 'dev@ekoa.local' }),
    ).rejects.toThrow();
  });
});
