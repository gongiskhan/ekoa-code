import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManifest } from '../../src/apps/manifest.js';

/**
 * WHAT AN IMPORTED APP DECLARES MUST SURVIVE THE IMPORT.
 *
 * `importArtifact` adopts the bundle's own `manifest.json` (re-stamping id + name) via
 * `ensureManifest`. That manifest is where an app declares the things nothing else can infer:
 * the server-side backend and its handler names (the SALOMAO ERP's `onEmail`, which turns a
 * polled mailbox into a prospect), the base it extends, the shared-data namespace, and the
 * workspace Graph opt-in. Every one of them is a silent-loss hazard - an app whose manifest was
 * quietly defaulted still builds, still serves its UI, and simply never does the thing.
 *
 * These tests exercise the READ half at the exact fidelity the import depends on: the manifest
 * bytes a prod export carries, through `readManifest`, with the ERP's real declarations. The
 * write half (id/name re-stamping, and the refusal on an invalid manifest) is asserted from the
 * same fixtures. Full round-trip through `importArtifact` needs Mongo + a build and lives in the
 * operator-run driver `api/tests/e2e/salomao-erp-import.e2e.mjs`.
 */
let dir: string;

/** The manifest the prod `legal-case-manager-3` export carries, plus the opt-in ekoa-code adds. */
const ERP_MANIFEST = {
  id: '60b843dd-a794-4153-802e-a6446ea39ab8',
  name: 'ERP Jurídico',
  version: '1.0.0',
  entryPoint: 'frontend/src/index.jsx',
  outputDir: 'dist/',
  type: 'jsx-app',
  extends: 'app-auth-persistent',
  backend: { entryPoint: 'backend/index.js', handlers: ['onEmail'] },
  m365Proxy: true,
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ekoa-import-manifest-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function plant(manifest: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

describe('a prod ERP manifest survives the read the import performs', () => {
  it('keeps the backend handler, the base, and the workspace opt-in', async () => {
    await plant(ERP_MANIFEST);
    const m = await readManifest(dir);
    expect(m?.backend).toEqual({ entryPoint: 'backend/index.js', handlers: ['onEmail'] });
    expect(m?.extends).toBe('app-auth-persistent');
    expect(m?.m365Proxy).toBe(true);
    expect(m?.type).toBe('jsx-app');
  });

  it('an app WITHOUT the opt-in stays without it — the flag is never inferred', async () => {
    const { m365Proxy: _omitted, ...noOptIn } = ERP_MANIFEST;
    await plant(noOptIn);
    expect((await readManifest(dir))?.m365Proxy).toBeUndefined();
  });

  it('a manifest that is present but INVALID throws, so the import can refuse it', async () => {
    // The realistic corruption: a hand-edited flag typed as a string. Before the manifest was
    // validated for it, this shape either sailed through and did nothing, or (with the old
    // `.catch(() => null)` in ensureManifest) replaced the whole manifest with a default and
    // took `backend.handlers` with it.
    await plant({ ...ERP_MANIFEST, m365Proxy: 'true' });
    await expect(readManifest(dir)).rejects.toThrow(/m365Proxy/);
  });

  it('a manifest declaring a backend with no handlers is refused, not silently accepted', async () => {
    await plant({ ...ERP_MANIFEST, backend: { entryPoint: 'backend/index.js', handlers: [] } });
    await expect(readManifest(dir)).rejects.toThrow(/backend\.handlers/);
  });

  it('a bundle with no manifest at all reads as null (the default-manifest path)', async () => {
    await mkdir(dir, { recursive: true });
    expect(await readManifest(dir)).toBeNull();
  });
});
