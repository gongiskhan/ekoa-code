#!/usr/bin/env node
/**
 * convert-dev-bundle (ch10 migrate tooling, 2B-S5) — build-tooling, not product code.
 *
 * Converts a PROD (ekoa-dev / cortex) artifact-export envelope into the ekoa-code
 * shared `ArtifactBundle` (shared/src/artifacts.ts), INCLUDING the app-data so the
 * imported instance carries its real data. The two formats differ:
 *
 *   PROD envelope (cortex services/artifact-bundle.ts, "schemaVersion: 1"):
 *     { schemaVersion: 1,
 *       manifest: { id, name, extends?, version?, ... },
 *       scaffold: [{ path, contentB64 }],        // BASE64-encoded bytes
 *       seedData?: Record<string, unknown[]>,     // featured seed (collection -> items)
 *       appData?:  { collections: Record<string, unknown[]>, ... },  // full app-data dump
 *       exportedAt, sourceArtifactId? }
 *
 *   shared ArtifactBundle (ekoa-code):
 *     { manifestId, name?, slug?, version?,
 *       files?: [{ path, content }],              // PLAINTEXT utf-8 content
 *       data?:  Record<string, unknown> }         // seeded by importArtifact (2B-S5)
 *
 * The envelope's `manifest` field is ALWAYS written into `files` as `manifest.json` (see the
 * comment at the reconstruction site). ekoa-code's importer reads what an app declares - its
 * `backend.handlers`, its `extends` base, its `m365Proxy` opt-in - from that file, and a prod
 * export does not necessarily carry one in its scaffold.
 *
 * The prod "app-data dump" (super-admin export from api.ekoa.io) may arrive INLINE
 * in the envelope (`appData`) OR as a SEPARATE file passed with `--data`. Its
 * canonical shape matches ekoa-code's AppDataAccess/AppDataBackups dump
 * (`{ collections, counts, totalItems, at }`); a bare cortex `seedData`
 * (collection -> items) is also accepted and wrapped. The converter always emits
 * the normalized `{ collections, counts, totalItems, at }` dump under `data` — the
 * exact shape importArtifact reapplies via AppDataAccess.importDump.
 *
 * NON-UTF-8 IS REFUSED LOUDLY. ekoa-code's `files[].content` is a plaintext utf-8
 * string; the prod scaffold carries base64 bytes that may be binary (images/fonts).
 * Blindly `.toString('utf-8')`-ing binary silently corrupts it (replacement chars),
 * so both the input file read AND every decoded scaffold entry are strict-decoded
 * and an explicit error naming the offending input/path is thrown — never a silent
 * lossy conversion. (ekoa-code's own exporter simply skips binary; for a one-shot
 * prod import a missing asset must surface, not vanish.)
 *
 * Usage:
 *   node api/scripts/migrate/convert-dev-bundle.mjs <envelope.json> \
 *     [--data <appdata-dump.json>] [--out <bundle.json>] [--slug <slug>]
 *
 *   <envelope.json>  prod cortex export envelope (schemaVersion 1)
 *   --data           optional separate prod app-data dump ({collections,...} or seedData)
 *   --out            write the shared bundle here (default: stdout)
 *   --slug           set bundle.slug (imports mint a fresh slug regardless; advisory)
 *
 * Read-only on its inputs. No DB, no network, no product imports (build-tooling).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Strict utf-8 decode: throw an explicit, labelled error on any invalid byte. */
export function decodeUtf8Strict(buf, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new Error(
      `convert-dev-bundle: ${label} is not valid UTF-8 — refusing to convert (a plaintext ArtifactBundle cannot carry binary without silent corruption).`,
    );
  }
}

/** Read a file as raw bytes and strict-decode as utf-8 (refuse a non-utf-8 input file loudly). */
export function readUtf8Strict(path) {
  return decodeUtf8Strict(readFileSync(path), `input file "${path}"`);
}

/** True when `v` is a plain object whose every value is an array (a collections map). */
function isCollectionsMap(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const entries = Object.values(v);
  return entries.length > 0 && entries.every((x) => Array.isArray(x));
}

/**
 * Normalize any accepted app-data source into the canonical dump shape
 * `{ collections, counts, totalItems, at }`. Accepts:
 *   - a dump: { collections: {name: [...]}, ... }
 *   - a bare seedData: { name: [...] }   (cortex featured seed)
 * Returns undefined when there is no app-data to carry.
 */
export function normalizeAppData(source, fallbackAt) {
  if (source == null) return undefined;
  if (typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('convert-dev-bundle: app-data must be an object (a dump or a collection map).');
  }
  let collections;
  if (isCollectionsMap(source.collections)) collections = source.collections;
  else if (source.collections !== undefined && (source.collections === null || typeof source.collections !== 'object')) {
    throw new Error('convert-dev-bundle: app-data.collections must be an object mapping collection names to arrays.');
  } else if (isCollectionsMap(source)) collections = source;
  else return undefined; // empty / no usable collections

  const counts = {};
  let totalItems = 0;
  for (const [name, items] of Object.entries(collections)) {
    counts[name] = items.length;
    totalItems += items.length;
  }
  const at = typeof source.at === 'string' ? source.at
    : typeof source.exportedAt === 'string' ? source.exportedAt
    : fallbackAt ?? new Date(0).toISOString();
  return { collections, counts, totalItems, at };
}

/** Reject traversal/absolute scaffold paths (no side-doors into the import target). */
function assertSafeRelPath(path) {
  const parts = String(path).split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) throw new Error('convert-dev-bundle: scaffold entry has an empty path.');
  if (parts.some((s) => s === '..') || String(path).startsWith('/')) {
    throw new Error(`convert-dev-bundle: unsafe scaffold path "${path}" (traversal/absolute).`);
  }
  return parts.join('/');
}

/**
 * Pure conversion: prod envelope -> shared ArtifactBundle. `opts.appData` is a
 * separately-loaded app-data source (from --data); it takes priority over the
 * envelope's inline `appData`/`seedData`.
 */
export function convertDevBundle(envelope, opts = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('convert-dev-bundle: envelope must be a JSON object.');
  }
  if (envelope.schemaVersion !== 1) {
    throw new Error(`convert-dev-bundle: unsupported envelope schemaVersion ${JSON.stringify(envelope.schemaVersion)} (expected 1).`);
  }
  const manifest = envelope.manifest;
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('convert-dev-bundle: envelope.manifest is missing.');
  }
  if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
    throw new Error('convert-dev-bundle: envelope.manifest.id is missing.');
  }
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new Error('convert-dev-bundle: envelope.manifest.name is missing.');
  }
  if (!Array.isArray(envelope.scaffold)) {
    throw new Error('convert-dev-bundle: envelope.scaffold must be an array.');
  }

  const files = [];
  for (const entry of envelope.scaffold) {
    if (!entry || typeof entry !== 'object') throw new Error('convert-dev-bundle: malformed scaffold entry.');
    if (typeof entry.path !== 'string') throw new Error('convert-dev-bundle: scaffold entry path missing.');
    if (typeof entry.contentB64 !== 'string') throw new Error(`convert-dev-bundle: scaffold entry "${entry.path}" has no contentB64.`);
    const rel = assertSafeRelPath(entry.path);
    const bytes = Buffer.from(entry.contentB64, 'base64');
    const content = decodeUtf8Strict(bytes, `scaffold file "${rel}"`);
    files.push({ path: rel, content });
  }

  // THE MANIFEST TRAVELS AS A FILE, ALWAYS.
  //
  // `envelope.manifest` is the exporter's canonical view of the app: it starts from prod's
  // defaults and overlays the on-disk manifest.json, so it is the one place `backend`
  // (`{entryPoint, handlers:['onEmail']}`) and `extends` (the base) are guaranteed to be. But
  // ekoa-code's importer reads the manifest from a FILE in the project dir - so unless one is in
  // `files`, the import writes a DEFAULT manifest and the app arrives without its backend
  // handlers and without its base. Observed for real: the 2026-08-05 legal-case-manager-3 export
  // carried 26 scaffold files and no manifest.json, while `envelope.manifest.backend` named
  // `onEmail`. Reconstructing it here is what makes the two formats actually equivalent.
  //
  // The envelope's manifest WINS over a scaffold copy of the same file: prod assembled it on
  // purpose (and `manifest.id`/`name` are re-stamped by the importer for the new instance
  // anyway), so a stale on-disk copy must not decide what the imported app declares.
  const manifestFile = {
    entryPoint: 'frontend/src/index.jsx',
    outputDir: 'dist/',
    type: 'jsx-app',
    ...manifest,
    version: typeof manifest.version === 'string' ? manifest.version : '1.0.0',
  };
  const withoutManifest = files.filter((f) => f.path !== 'manifest.json');
  withoutManifest.push({ path: 'manifest.json', content: JSON.stringify(manifestFile, null, 2) + '\n' });

  const fallbackAt = typeof envelope.exportedAt === 'string' ? envelope.exportedAt : undefined;
  const data = normalizeAppData(opts.appData ?? envelope.appData ?? envelope.seedData, fallbackAt);

  const bundle = { manifestId: manifest.id, name: manifest.name };
  if (typeof opts.slug === 'string' && opts.slug) bundle.slug = opts.slug;
  bundle.files = withoutManifest;
  if (data) bundle.data = data;
  bundle.version = typeof manifest.version === 'string' ? manifest.version : '1.0.0';
  return bundle;
}

// ------------------------------ CLI ------------------------------

function parseArgs(argv) {
  const get = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
  return {
    envelope: positional[0],
    data: get('--data'),
    out: get('--out'),
    slug: get('--slug'),
  };
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.envelope) {
    process.stderr.write('usage: convert-dev-bundle.mjs <envelope.json> [--data <appdata.json>] [--out <bundle.json>] [--slug <slug>]\n');
    process.exit(2);
  }
  const envelope = JSON.parse(readUtf8Strict(args.envelope));
  const appData = args.data ? JSON.parse(readUtf8Strict(args.data)) : undefined;
  const bundle = convertDevBundle(envelope, { appData, slug: args.slug });
  const json = JSON.stringify(bundle, null, 2) + '\n';
  if (args.out) {
    writeFileSync(args.out, json);
    process.stderr.write(
      `convert-dev-bundle: wrote ${bundle.files.length} file(s)` +
      `${bundle.data ? `, ${bundle.data.totalItems} app-data item(s) across ${Object.keys(bundle.data.collections).length} collection(s)` : ', no app-data'}` +
      ` -> ${args.out}\n`,
    );
  } else {
    process.stdout.write(json);
  }
}

// Run as CLI only when invoked directly (importable as a module for tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`convert-dev-bundle: ERROR — ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}
