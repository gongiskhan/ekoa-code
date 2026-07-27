import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeRecipe, type EkoaActionContext, type PlatformPrimitive } from '../../src/automation/platform-primitives.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';

/**
 * SECURITY SUITE — the ekoa_action file primitives are WIRED to containment (Cofre R-1).
 *
 * The resolver has its own unit suite (action-path-containment.test.ts). This one proves the
 * primitives actually call it: a recipe is the MODEL-authored artefact, so the escape that matters
 * is the one reachable through `executeRecipe`, not through the resolver's public API.
 */
describe('file.read / file.write containment through executeRecipe', () => {
  let dataDir: string;
  let outside: string;

  const ctx = (): EkoaActionContext => ({
    userId: 'user-1',
    orgId: 'orgA',
    artifactId: 'artifact-1',
    inputs: {},
    captured: {},
    trace: [],
  });

  const workspace = (orgId = 'orgA', userId = 'user-1'): string =>
    join(realpathSync(dataDir), 'action-workspace', orgId, userId);

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ekoa-actionfs-'));
    outside = mkdtempSync(join(tmpdir(), 'ekoa-actionfs-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'TOP-SECRET-CONTENT');
    process.env.EKOA_AUTOMATION_DATA_DIR = dataDir;
    __resetAutomationConfigForTests();
  });

  afterEach(() => {
    delete process.env.EKOA_AUTOMATION_DATA_DIR;
    __resetAutomationConfigForTests();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('writes and reads back inside the per-owner workspace', async () => {
    const c = ctx();
    await executeRecipe(
      [
        { op: 'file.write', path: 'notes.txt', content: 'hello' },
        { op: 'file.read', path: 'notes.txt', returnAs: 'back' },
      ] as PlatformPrimitive[],
      c,
    );
    expect(c.captured.back).toBe('hello');
    expect(readFileSync(join(workspace(), 'notes.txt'), 'utf8')).toBe('hello');
  });

  it('REFUSES file.read of an absolute host path — the live breach', async () => {
    const c = ctx();
    await expect(
      executeRecipe([{ op: 'file.read', path: '/etc/passwd', returnAs: 'leak' }] as PlatformPrimitive[], c),
    ).rejects.toThrow(/escapes the workspace root/);
    expect(c.captured.leak).toBeUndefined();
  });

  it('REFUSES file.read of another temp location by absolute path', async () => {
    const c = ctx();
    await expect(
      executeRecipe(
        [{ op: 'file.read', path: join(outside, 'secret.txt'), returnAs: 'leak' }] as PlatformPrimitive[],
        c,
      ),
    ).rejects.toThrow(/escapes the workspace root/);
    // The whole point: the bytes must not reach ctx.captured, which is persisted as capturedValues
    // and returned into the calling agent's tool result.
    expect(JSON.stringify(c.captured)).not.toContain('TOP-SECRET-CONTENT');
  });

  it('REFUSES traversal out of the workspace', async () => {
    const c = ctx();
    await expect(
      executeRecipe(
        [{ op: 'file.read', path: '../../../../etc/passwd', returnAs: 'leak' }] as PlatformPrimitive[],
        c,
      ),
    ).rejects.toThrow(/escapes the workspace root/);
  });

  it('REFUSES file.write outside the workspace (no file is created)', async () => {
    const target = join(outside, 'planted.txt');
    const c = ctx();
    await expect(
      executeRecipe([{ op: 'file.write', path: target, content: 'x' }] as PlatformPrimitive[], c),
    ).rejects.toThrow(/escapes the workspace root/);
    expect(existsSync(target)).toBe(false);
  });

  it('REFUSES a write through an escaping symlink planted inside the workspace', async () => {
    mkdirSync(workspace(), { recursive: true });
    symlinkSync(outside, join(workspace(), 'link'));
    const c = ctx();
    await expect(
      executeRecipe([{ op: 'file.write', path: 'link/planted.txt', content: 'x' }] as PlatformPrimitive[], c),
    ).rejects.toThrow(/escapes/);
    expect(existsSync(join(outside, 'planted.txt'))).toBe(false);
  });

  it('REFUSES credential-bearing names even inside the workspace', async () => {
    const c = ctx();
    await expect(
      executeRecipe([{ op: 'file.read', path: '.env', returnAs: 'leak' }] as PlatformPrimitive[], c),
    ).rejects.toThrow(/credential-bearing/);
    await expect(
      executeRecipe([{ op: 'file.read', path: '.ssh/id_rsa', returnAs: 'leak' }] as PlatformPrimitive[], c),
    ).rejects.toThrow(/credential-bearing/);
  });

  it('maps ~ to the workspace root, NOT the host home directory', async () => {
    const c = ctx();
    await executeRecipe(
      [
        { op: 'file.write', path: '~/tilde.txt', content: 'in-workspace' },
        { op: 'file.read', path: '~/tilde.txt', returnAs: 'back' },
      ] as PlatformPrimitive[],
      c,
    );
    expect(c.captured.back).toBe('in-workspace');
    expect(readFileSync(join(workspace(), 'tilde.txt'), 'utf8')).toBe('in-workspace');
  });

  it('isolates one owner from another', async () => {
    const a = ctx();
    await executeRecipe([{ op: 'file.write', path: 'mine.txt', content: 'A-data' }] as PlatformPrimitive[], a);

    const b: EkoaActionContext = { ...ctx(), userId: 'user-2' };
    await expect(
      executeRecipe([{ op: 'file.read', path: 'mine.txt', returnAs: 'x' }] as PlatformPrimitive[], b),
    ).rejects.toThrow();
    expect(JSON.stringify(b.captured)).not.toContain('A-data');
  });

  it('isolates one org from another', async () => {
    const a = ctx();
    await executeRecipe([{ op: 'file.write', path: 'mine.txt', content: 'orgA-data' }] as PlatformPrimitive[], a);

    const b: EkoaActionContext = { ...ctx(), orgId: 'orgB' };
    await expect(
      executeRecipe([{ op: 'file.read', path: 'mine.txt', returnAs: 'x' }] as PlatformPrimitive[], b),
    ).rejects.toThrow();
    expect(JSON.stringify(b.captured)).not.toContain('orgA-data');
  });

  it('refuses an identifier that could climb out of the workspace', async () => {
    const evil: EkoaActionContext = { ...ctx(), orgId: '../../..' };
    await expect(
      executeRecipe([{ op: 'file.read', path: 'x.txt', returnAs: 'y' }] as PlatformPrimitive[], evil),
    ).rejects.toThrow(/unsafe identifier/);
  });
});
