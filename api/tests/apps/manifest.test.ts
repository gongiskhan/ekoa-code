import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest, readManifest, writeManifest, createDefaultManifest } from '../../src/apps/manifest.js';

/**
 * `validateManifest` returns a WHITELIST, not the input object: a key it does not name is
 * silently dropped. That is the safety property (an app cannot smuggle fields into the
 * registry) and it is also a trap — `m365Proxy` was read by the composition root and the
 * Graph proxy while validation stripped it, so the per-app opt-in could never be granted and
 * the workspace plane answered 403 for every app (findings.md
 * `m365proxy-manifest-flag-stripped`). These tests pin BOTH halves: the declared optional
 * flags survive a round-trip, and an undeclared key still does not.
 */
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-manifest-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const base = {
  id: 'app1',
  name: 'App One',
  version: '1.0.0',
  entryPoint: 'frontend/src/index.jsx',
  outputDir: 'dist/',
  type: 'jsx-app',
};

describe('manifest opt-in flags survive validation', () => {
  it('carries m365Proxy through validate', () => {
    expect(validateManifest({ ...base, m365Proxy: true }).m365Proxy).toBe(true);
    expect(validateManifest({ ...base, m365Proxy: false }).m365Proxy).toBe(false);
  });

  it('carries m365Proxy through a write → read round-trip on disk', async () => {
    await writeManifest(dir, { ...createDefaultManifest('app1', 'App One'), m365Proxy: true });
    expect((await readManifest(dir))?.m365Proxy).toBe(true);
  });

  it('reads m365Proxy from a manifest.json the app author wrote by hand', async () => {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...base, m365Proxy: true, backend: { entryPoint: 'backend/index.js', handlers: ['onEmail'] } }));
    const m = await readManifest(dir);
    expect(m?.m365Proxy).toBe(true);
    expect(m?.backend?.handlers).toEqual(['onEmail']);
  });

  it('omits the key entirely when absent — never a `false` the registry would read as an opt-out record', () => {
    expect('m365Proxy' in validateManifest(base)).toBe(false);
  });

  it('rejects a non-boolean rather than coercing a truthy string into an opt-in', () => {
    expect(() => validateManifest({ ...base, m365Proxy: 'true' })).toThrow(/m365Proxy/);
    expect(() => validateManifest({ ...base, m365Proxy: 1 })).toThrow(/m365Proxy/);
  });

  it('still drops an UNDECLARED key (the whitelist property this trap comes from)', () => {
    const out = validateManifest({ ...base, someFutureFlag: true }) as unknown as Record<string, unknown>;
    expect('someFutureFlag' in out).toBe(false);
  });
});
