import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectDirFor, backendBundlePath } from '../../src/apps/app-paths.js';
import { sandboxRoot } from '../../src/services/safe-path.js';
import type { ArtifactDoc } from '../../src/apps/artifacts-service.js';

/**
 * projectDirFor jails a recorded `data.projectDir` (ch09 invariant 10, FIXED-8). `data` is a
 * client-influenceable bag: a PATCHed `data.projectDir` pointing outside the sandbox must NEVER
 * become the follow-up build's cwd/HOME. Any escaping recorded path is ignored in favour of the
 * deterministic in-jail layout — closing the sandbox-escape vector.
 */
let sandbox: string;
const PRIOR = process.env.SANDBOX_ROOT;

function art(over: Partial<ArtifactDoc> & { _id: string; userId: string }): ArtifactDoc {
  return { name: 'x', orgId: 'o1', visibility: 'private', ...over } as ArtifactDoc;
}

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'ekoa-app-paths-'));
  process.env.SANDBOX_ROOT = sandbox;
});

afterAll(async () => {
  if (PRIOR === undefined) delete process.env.SANDBOX_ROOT;
  else process.env.SANDBOX_ROOT = PRIOR;
  await rm(sandbox, { recursive: true, force: true });
});

describe('projectDirFor — recorded data.projectDir is jailed (ch09 invariant 10)', () => {
  const defaultLayout = (userId: string, id: string) => join(sandboxRoot(), `user-${userId}`, id);

  it('ignores an ABSOLUTE recorded projectDir pointing outside the sandbox', () => {
    const a = art({ _id: 'art1', userId: 'u1', data: { projectDir: '/etc' } });
    const resolved = projectDirFor(a);
    expect(resolved).toBe(defaultLayout('u1', 'art1'));
    expect(resolved.startsWith(sandboxRoot())).toBe(true);
    expect(resolved).not.toBe('/etc');
  });

  it('ignores a TRAVERSAL recorded projectDir that escapes the sandbox', () => {
    const a = art({ _id: 'art2', userId: 'u1', data: { projectDir: '../../../../etc/passwd' } });
    const resolved = projectDirFor(a);
    expect(resolved).toBe(defaultLayout('u1', 'art2'));
    expect(resolved.startsWith(sandboxRoot())).toBe(true);
  });

  it('honours a legitimate recorded projectDir that is inside the sandbox', () => {
    const inside = join(sandboxRoot(), 'user-u1', 'art3');
    const a = art({ _id: 'art3', userId: 'u1', data: { projectDir: inside } });
    expect(projectDirFor(a)).toBe(inside);
  });

  it('falls back to the deterministic layout when no projectDir is recorded', () => {
    const a = art({ _id: 'art4', userId: 'u2', data: {} });
    expect(projectDirFor(a)).toBe(defaultLayout('u2', 'art4'));
  });
});

/**
 * backendBundlePath resolves a SEEDED FEATURED app's backend from the featured-builds MIRROR, not
 * the scaffold projectDirFor returns for it. Regression for the empty-inbox chain (2026-09-04):
 * projectDirFor early-returns the versioned scaffold dir for a seeded featured app (no build output
 * there), and the record's patched data.projectDir points at the mirror but is outside the sandbox
 * jail so recordedProjectDir drops it — so the backend was permanently `no backend bundle` and
 * onNotificacaoCitius/onEmail never ran.
 */
describe('backendBundlePath — seeded featured app resolves from the featured-builds mirror', () => {
  let builds: string;
  const PRIOR_BUILDS = process.env.EKOA_FEATURED_BUILDS_DIR;

  beforeAll(async () => {
    builds = await mkdtemp(join(tmpdir(), 'ekoa-featured-builds-'));
    process.env.EKOA_FEATURED_BUILDS_DIR = builds;
  });
  afterAll(async () => {
    if (PRIOR_BUILDS === undefined) delete process.env.EKOA_FEATURED_BUILDS_DIR;
    else process.env.EKOA_FEATURED_BUILDS_DIR = PRIOR_BUILDS;
    await rm(builds, { recursive: true, force: true });
  });

  const seededFeatured = (id: string) =>
    art({ _id: id, userId: 'system', featured: true, data: { seededFrom: 'assets/featured-artifacts' } });

  it('finds the bundle in the mirror even though projectDirFor points at the scaffold', async () => {
    const a = seededFeatured('legal-citius');
    await mkdir(join(builds, 'legal-citius', 'dist-backend'), { recursive: true });
    await writeFile(join(builds, 'legal-citius', 'dist-backend', 'backend.mjs'), 'export async function onNotificacaoCitius(){}');
    // The scaffold projectDirFor returns has NO build output, so the OLD lookup would be null.
    expect(projectDirFor(a).endsWith('/scaffold')).toBe(true);
    expect(backendBundlePath(a)).toBe(join(builds, 'legal-citius', 'dist-backend', 'backend.mjs'));
  });

  it('returns null for a seeded featured app whose mirror bundle has not been built', () => {
    expect(backendBundlePath(seededFeatured('legal-unbuilt'))).toBeNull();
  });

  it('a NON-featured app still resolves its bundle under the in-jail working copy (unchanged)', async () => {
    const inside = join(sandboxRoot(), 'user-u9', 'built-app');
    const a = art({ _id: 'built-app', userId: 'u9', data: { projectDir: inside } });
    await mkdir(join(inside, 'dist-backend'), { recursive: true });
    await writeFile(join(inside, 'dist-backend', 'backend.mjs'), 'export function onWebhook(){}');
    expect(backendBundlePath(a)).toBe(join(inside, 'dist-backend', 'backend.mjs'));
  });
});
