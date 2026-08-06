import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactBundle } from '@ekoa/shared';
import {
  convertDevBundle,
  normalizeAppData,
  decodeUtf8Strict,
  readUtf8Strict,
} from '../../scripts/migrate/convert-dev-bundle.mjs';
import { validateManifest } from '../../src/apps/manifest.js';

/**
 * 2B-S5 converter (api/scripts/migrate/convert-dev-bundle.mjs). Proves the prod
 * cortex export envelope (schemaVersion 1, base64 scaffold, seedData / app-data
 * dump) converts to a shared ArtifactBundle that VALIDATES against the shared zod
 * schema and carries the app-data under `data` in the canonical
 * `{ collections, counts, totalItems, at }` shape importArtifact reapplies — and
 * that non-UTF-8 input is refused loudly instead of silently corrupted.
 *
 * The envelope fixtures mimic the exact bytes the prod exporter emits (cortex
 * services/artifact-bundle.ts: `contentB64` = Buffer.toString('base64')), not a
 * pre-massaged plaintext shape the wired path never produces.
 */

/** A realistic prod (cortex) export envelope with base64 scaffold + featured seedData. */
function devEnvelope(overrides: Record<string, unknown> = {}) {
  const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');
  return {
    schemaVersion: 1,
    manifest: { id: 'prod-app-08dd', name: 'SALOMAO ERP', extends: 'app-auth-persistent', version: '2.3.0' },
    scaffold: [
      { path: 'frontend/src/index.jsx', contentB64: b64('export const App = () => "olá";\n') },
      { path: 'skills/SKILL.md', contentB64: b64('# skill\nAção jurídica.\n') },
    ],
    seedData: {
      utilizadores: [{ id: 'u1', email: 'a@brasilsalomao.pt' }, { id: 'u2', email: 'b@brasilsalomao.pt' }],
      propostas: [{ id: 'p1', estado: 'rascunho' }],
    },
    exportedAt: '2026-07-24T10:00:00.000Z',
    sourceArtifactId: 'prod-app-08dd',
    ...overrides,
  };
}

describe('convert-dev-bundle: envelope -> shared ArtifactBundle (incl. data)', () => {
  it('maps manifest/scaffold/seedData and validates against the shared ArtifactBundle schema', () => {
    const bundle = convertDevBundle(devEnvelope());
    // Output is a schema-valid shared ArtifactBundle (contract-test discipline).
    const parsed = ArtifactBundle.safeParse(bundle);
    expect(parsed.success, JSON.stringify(parsed.error)).toBe(true);

    expect(bundle.manifestId).toBe('prod-app-08dd');
    expect(bundle.name).toBe('SALOMAO ERP');
    expect(bundle.version).toBe('2.3.0');

    // Scaffold base64 was decoded to plaintext utf-8 file content, plus the reconstructed
    // manifest.json (see the manifest-fidelity block below).
    expect(bundle.files).toHaveLength(3);
    const index = bundle.files!.find((f) => f.path === 'frontend/src/index.jsx');
    expect(index!.content).toBe('export const App = () => "olá";\n');

    // seedData wrapped into the canonical app-data dump under `data`.
    expect(bundle.data).toBeDefined();
    const data = bundle.data!;
    expect(Object.keys(data.collections).sort()).toEqual(['propostas', 'utilizadores']);
    expect(data.collections.utilizadores).toHaveLength(2);
    expect(data.counts).toEqual({ utilizadores: 2, propostas: 1 });
    expect(data.totalItems).toBe(3);
    expect(data.at).toBe('2026-07-24T10:00:00.000Z');
  });

  it('carries the ids verbatim so a seeded row keeps its prod id', () => {
    const bundle = convertDevBundle(devEnvelope());
    const rows = bundle.data!.collections.utilizadores!;
    expect(rows.map((r) => r.id)).toEqual(['u1', 'u2']);
  });

  it('a separate --data app-data dump takes priority over inline seedData', () => {
    // The real prod app-data dump (AppDataBackups.exportAll shape) passed via --data.
    const appData = {
      appId: 'prod-app-08dd',
      exportedAt: '2026-07-24T11:22:33.000Z',
      collections: { clientes: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] },
      counts: { clientes: 3 },
      totalItems: 3,
    };
    const bundle = convertDevBundle(devEnvelope(), { appData });
    const data = bundle.data!;
    expect(Object.keys(data.collections)).toEqual(['clientes']); // seedData ignored
    expect(data.totalItems).toBe(3);
    expect(data.at).toBe('2026-07-24T11:22:33.000Z');
  });

  it('emits NO data field when the envelope carries no app-data (additive: data-less bundle)', () => {
    const env = devEnvelope();
    delete (env as Record<string, unknown>).seedData;
    const bundle = convertDevBundle(env);
    expect(bundle.data).toBeUndefined();
    expect(ArtifactBundle.safeParse(bundle).success).toBe(true);
  });

  it('accepts an inline envelope.appData dump', () => {
    const env = devEnvelope({ seedData: undefined, appData: { collections: { faturas: [{ id: 'f1' }] } } });
    const bundle = convertDevBundle(env);
    expect(bundle.data!.collections.faturas).toHaveLength(1);
  });
});

/**
 * THE MANIFEST MUST ARRIVE AS A FILE.
 *
 * ekoa-code's importer reads what an app declares - `backend.handlers` (the SALOMAO ERP's
 * `onEmail`), the `extends` base, the `m365Proxy` workspace opt-in - from `manifest.json` in the
 * project dir. The prod envelope carries that information in its `manifest` FIELD, and the real
 * 2026-08-05 `legal-case-manager-3` export carried 26 scaffold files with NO manifest.json among
 * them. Before this, the converter kept only id/name/version from the field and dropped the rest,
 * so the import wrote a default manifest and the app arrived with no backend and no base: it
 * would have built, served its UI, and silently never processed an email.
 */
describe('convert-dev-bundle: the envelope manifest becomes manifest.json', () => {
  const manifestOf = (bundle: { files?: Array<{ path: string; content: string }> }) =>
    JSON.parse(bundle.files!.find((f) => f.path === 'manifest.json')!.content) as Record<string, unknown>;

  it('reconstructs manifest.json when the scaffold has none, keeping backend + extends', () => {
    const env = devEnvelope({
      manifest: {
        id: 'prod-app-08dd',
        name: 'SALOMAO ERP',
        version: '2.3.0',
        entryPoint: 'frontend/src/index.jsx',
        outputDir: 'dist/',
        type: 'jsx-app',
        extends: 'app-auth-persistent',
        backend: { entryPoint: 'backend/index.js', handlers: ['onEmail'] },
      },
    });
    const m = manifestOf(convertDevBundle(env));
    expect(m.backend).toEqual({ entryPoint: 'backend/index.js', handlers: ['onEmail'] });
    expect(m.extends).toBe('app-auth-persistent');
    expect(m.type).toBe('jsx-app');
    expect(m.version).toBe('2.3.0');
  });

  it('fills the build fields a minimal prod manifest omits, so the import validates', () => {
    // The prod exporter synthesises a manifest from defaults when the app has no file on disk;
    // an older/sparser one may carry only id + name.
    const env = devEnvelope({ manifest: { id: 'prod-app-08dd', name: 'SALOMAO ERP' } });
    const m = manifestOf(convertDevBundle(env));
    expect(m).toMatchObject({ entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/', type: 'jsx-app', version: '1.0.0' });
  });

  it('the envelope manifest WINS over a stale scaffold copy of the same file', () => {
    const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');
    const env = devEnvelope({
      manifest: { id: 'prod-app-08dd', name: 'SALOMAO ERP', type: 'jsx-app', backend: { entryPoint: 'backend/index.js', handlers: ['onEmail'] } },
      scaffold: [{ path: 'manifest.json', contentB64: b64('{"id":"stale","name":"Stale","type":"static"}') }],
    });
    const bundle = convertDevBundle(env);
    expect(bundle.files!.filter((f) => f.path === 'manifest.json')).toHaveLength(1); // never both
    const m = manifestOf(bundle);
    expect(m.backend).toEqual({ entryPoint: 'backend/index.js', handlers: ['onEmail'] });
    expect(m.type).toBe('jsx-app');
  });

  it('the reconstructed manifest passes ekoa-code’s own validator', () => {
    const env = devEnvelope({
      manifest: {
        id: 'prod-app-08dd', name: 'SALOMAO ERP', version: '2.3.0',
        entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/', type: 'jsx-app',
        extends: 'app-auth-persistent', backend: { entryPoint: 'backend/index.js', handlers: ['onEmail'] },
      },
    });
    const m = validateManifest(manifestOf(convertDevBundle(env)));
    expect(m.backend?.handlers).toEqual(['onEmail']);
    expect(m.extends).toBe('app-auth-persistent');
  });

  it('carries an m365Proxy opt-in through when the operator adds one', () => {
    const env = devEnvelope({
      manifest: { id: 'prod-app-08dd', name: 'SALOMAO ERP', type: 'jsx-app', m365Proxy: true },
    });
    expect(validateManifest(manifestOf(convertDevBundle(env))).m365Proxy).toBe(true);
  });
});

describe('convert-dev-bundle: refuses non-UTF-8 LOUDLY (no silent corruption)', () => {
  it('throws, naming the scaffold path, when a base64 scaffold entry decodes to non-UTF-8 bytes', () => {
    const env = devEnvelope({
      scaffold: [
        { path: 'assets/logo.png', contentB64: Buffer.from([0xff, 0xfe, 0xfd, 0x80]).toString('base64') },
      ],
      seedData: undefined,
    });
    expect(() => convertDevBundle(env)).toThrowError(/assets\/logo\.png.*not valid UTF-8|not valid UTF-8.*assets\/logo\.png/);
  });

  it('decodeUtf8Strict throws on invalid bytes and passes valid utf-8 through', () => {
    expect(decodeUtf8Strict(Buffer.from('olá utf-8', 'utf-8'), 'x')).toBe('olá utf-8');
    expect(() => decodeUtf8Strict(Buffer.from([0xc3, 0x28]), 'y')).toThrowError(/not valid UTF-8/);
  });

  it('readUtf8Strict refuses a non-UTF-8 input file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'conv-utf8-'));
    try {
      const bad = join(dir, 'bad.json');
      writeFileSync(bad, Buffer.from([0x7b, 0xff, 0xfe, 0x7d])); // {<invalid>}
      expect(() => readUtf8Strict(bad)).toThrowError(/not valid UTF-8/);
      const ok = join(dir, 'ok.json');
      writeFileSync(ok, Buffer.from('{"ok":true,"a":"ção"}', 'utf-8'));
      expect(JSON.parse(readUtf8Strict(ok))).toEqual({ ok: true, a: 'ção' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('convert-dev-bundle: envelope validation + app-data normalization', () => {
  it('rejects an unsupported schemaVersion and a missing manifest', () => {
    expect(() => convertDevBundle(devEnvelope({ schemaVersion: 2 }))).toThrowError(/schemaVersion/);
    expect(() => convertDevBundle(devEnvelope({ manifest: undefined }))).toThrowError(/manifest is missing/);
    expect(() => convertDevBundle(devEnvelope({ manifest: { name: 'x' } }))).toThrowError(/manifest\.id/);
  });

  it('rejects a traversal / absolute scaffold path', () => {
    expect(() => convertDevBundle(devEnvelope({ scaffold: [{ path: '../evil', contentB64: '' }], seedData: undefined }))).toThrowError(/unsafe scaffold path/);
    expect(() => convertDevBundle(devEnvelope({ scaffold: [{ path: '/etc/passwd', contentB64: '' }], seedData: undefined }))).toThrowError(/unsafe scaffold path/);
  });

  it('normalizeAppData returns undefined for empty/absent data and a dump for a collection map', () => {
    expect(normalizeAppData(undefined)).toBeUndefined();
    expect(normalizeAppData({})).toBeUndefined();
    expect(normalizeAppData({ collections: {} })).toBeUndefined();
    const dump = normalizeAppData({ a: [{ id: '1' }] }, '2026-01-01T00:00:00.000Z');
    expect(dump).toEqual({ collections: { a: [{ id: '1' }] }, counts: { a: 1 }, totalItems: 1, at: '2026-01-01T00:00:00.000Z' });
  });
});
