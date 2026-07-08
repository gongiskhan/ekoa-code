import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { bundleFromZip, readBundleFile, looksLikeZip, type ArtifactBundle } from '@/lib/artifact-bundle';

/** Build a zip shaped like "Transferir código" output: files at the root, manifest.json included. */
function makeAppZip(opts?: { prefix?: string; withRuntimeNoise?: boolean }): Uint8Array {
  const prefix = opts?.prefix ?? '';
  const manifest = {
    id: 'app-123',
    name: 'Cash Flow',
    version: '1.0.0',
    entryPoint: 'frontend/src/index.jsx',
    outputDir: 'dist/',
    type: 'jsx-app',
    extends: 'app-auth-persistent',
  };
  const files: Record<string, Uint8Array> = {
    [`${prefix}manifest.json`]: strToU8(JSON.stringify(manifest, null, 2)),
    [`${prefix}frontend/src/index.jsx`]: strToU8('export default function App() { return null }'),
    [`${prefix}frontend/src/styles.css`]: strToU8('body { margin: 0 }'),
  };
  if (opts?.withRuntimeNoise) {
    files[`${prefix}dist/bundle.js`] = strToU8('console.log(1)');
    files[`${prefix}node_modules/x/index.js`] = strToU8('module.exports = {}');
  }
  return zipSync(files);
}

describe('looksLikeZip', () => {
  it('detects the ZIP magic bytes', () => {
    expect(looksLikeZip(makeAppZip())).toBe(true);
    expect(looksLikeZip(strToU8('{"schemaVersion":1}'))).toBe(false);
  });
});

describe('bundleFromZip', () => {
  it('reconstructs the full importable bundle envelope', () => {
    const bundle = bundleFromZip(makeAppZip());
    expect(bundle.schemaVersion).toBe(1);
    // manifest is hoisted into its own field, carrying id + extends for the
    // backend's update-in-place match and base validation.
    expect(bundle.manifest.id).toBe('app-123');
    expect(bundle.manifest.name).toBe('Cash Flow');
    expect(bundle.manifest.extends).toBe('app-auth-persistent');
    // sourceArtifactId mirrors the manifest id so import can offer update-in-place.
    expect(bundle.sourceArtifactId).toBe('app-123');
  });

  it('excludes manifest.json from scaffold and base64-encodes file contents', () => {
    const bundle = bundleFromZip(makeAppZip());
    const paths = bundle.scaffold.map((f) => f.path).sort();
    expect(paths).toEqual(['frontend/src/index.jsx', 'frontend/src/styles.css']);
    const css = bundle.scaffold.find((f) => f.path === 'frontend/src/styles.css')!;
    expect(Buffer.from(css.contentB64, 'base64').toString('utf-8')).toBe('body { margin: 0 }');
  });

  it('drops runtime/build dirs (dist, node_modules) even if present in the zip', () => {
    const bundle = bundleFromZip(makeAppZip({ withRuntimeNoise: true }));
    expect(bundle.scaffold.some((f) => f.path.startsWith('dist/'))).toBe(false);
    expect(bundle.scaffold.some((f) => f.path.startsWith('node_modules/'))).toBe(false);
  });

  it('strips a wrapping top-level folder (hand-zipped project dir)', () => {
    const bundle = bundleFromZip(makeAppZip({ prefix: 'cash-flow/' }));
    expect(bundle.manifest.id).toBe('app-123');
    expect(bundle.scaffold.map((f) => f.path).sort()).toEqual([
      'frontend/src/index.jsx',
      'frontend/src/styles.css',
    ]);
  });

  it('throws a clear error when the zip has no manifest.json', () => {
    const zip = zipSync({ 'frontend/src/index.jsx': strToU8('x') });
    expect(() => bundleFromZip(zip)).toThrow(/manifest\.json/i);
  });
});

describe('readBundleFile', () => {
  function fileFrom(bytes: Uint8Array, name: string, type = ''): File {
    return new File([bytes as unknown as BlobPart], name, { type });
  }

  it('reconstructs a bundle from a .zip file', async () => {
    const bundle = (await readBundleFile(fileFrom(makeAppZip(), 'cash-flow.zip'))) as ArtifactBundle;
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.manifest.id).toBe('app-123');
  });

  it('parses a JSON bundle file unchanged', async () => {
    const json: ArtifactBundle = {
      schemaVersion: 1,
      manifest: { id: 'app-9', name: 'JSON App', extends: 'app-auth-persistent' },
      scaffold: [{ path: 'frontend/src/index.jsx', contentB64: 'eA==' }],
      exportedAt: '2026-06-18T00:00:00.000Z',
      sourceArtifactId: 'app-9',
    };
    const file = fileFrom(strToU8(JSON.stringify(json)), 'app.json', 'application/json');
    const parsed = (await readBundleFile(file)) as ArtifactBundle;
    expect(parsed).toEqual(json);
  });

  it('detects a zip by content even when the filename says .json', async () => {
    // Defense against a mislabelled download — magic-byte sniff wins.
    const bundle = (await readBundleFile(fileFrom(makeAppZip(), 'mislabelled.json'))) as ArtifactBundle;
    expect(bundle.manifest.id).toBe('app-123');
  });
});
