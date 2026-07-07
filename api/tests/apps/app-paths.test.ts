import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectDirFor } from '../../src/apps/app-paths.js';
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
