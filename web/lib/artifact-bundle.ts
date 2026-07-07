/**
 * Artifact import file reader.
 *
 * Import accepts two interchangeable formats for the SAME artifact:
 *   1. the JSON bundle envelope produced by the `export-instance` intent, and
 *   2. the `.zip` produced by "Transferir código" (GET /api/v1/artifacts/:id/download).
 *
 * The zip carries `manifest.json` at the scaffold root, so it round-trips into
 * the full bundle envelope the backend's `importArtifact` / `updateArtifactFromBundle`
 * already consume — including the manifest `id`/`extends` that drive import's
 * update-in-place match and base validation. That means a downloaded app can be
 * re-imported with no lossy "always a copy" fallback.
 *
 * This mirrors the bundle shape in `cortex/src/services/artifact-bundle.ts`
 * (BundleScaffoldFile / ArtifactBundle, the EXCLUDED_TOP_DIRS runtime dirs).
 */

import { unzipSync } from 'fflate';

export interface BundleScaffoldFile {
  path: string;
  contentB64: string;
}

export interface ArtifactBundle {
  schemaVersion: 1;
  manifest: Record<string, unknown> & { id?: string; name: string; extends?: string };
  scaffold: BundleScaffoldFile[];
  seedData?: Record<string, unknown[]>;
  exportedAt: string;
  sourceArtifactId?: string;
}

/** Runtime/build dirs that never belong in a portable bundle (matches the backend). */
const EXCLUDED_TOP_DIRS = new Set([
  'dist',
  'node_modules',
  '.git',
  'app-data',
  '.sdk-session',
  '.versions',
  '.claude',
  'session-env',
]);

/** Standard-base64-encode bytes without Buffer (browser-safe, chunked for large files). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // 32 KB — under the fromCharCode arg-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** True if the bytes start with the ZIP local-file-header magic "PK\x03\x04". */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * Reconstruct an importable {@link ArtifactBundle} from a downloaded app `.zip`.
 * Throws a user-facing (PT) error when the zip carries no manifest.json — i.e.
 * it isn't an Ekoa app export.
 */
export function bundleFromZip(zipBytes: Uint8Array): ArtifactBundle {
  const entries = unzipSync(zipBytes);
  const paths = Object.keys(entries);

  // The shallowest manifest.json marks the scaffold root. "Transferir código"
  // writes files at the zip root (prefix ""), but a hand-zipped folder may wrap
  // everything one level deep — strip that prefix uniformly either way.
  const manifestPaths = paths
    .filter((p) => p.split('/').pop() === 'manifest.json')
    .sort((a, b) => a.split('/').length - b.split('/').length);
  if (manifestPaths.length === 0) {
    throw new Error('O ficheiro .zip não é uma aplicação Ekoa válida (manifest.json em falta).');
  }
  const manifestPath = manifestPaths[0];
  const prefix = manifestPath.slice(0, manifestPath.length - 'manifest.json'.length); // '' or 'sub/'

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(new TextDecoder().decode(entries[manifestPath])) as Record<string, unknown>;
  } catch {
    throw new Error('O manifest.json dentro do .zip está corrompido.');
  }

  const scaffold: BundleScaffoldFile[] = [];
  for (const full of paths) {
    if (full.endsWith('/')) continue; // directory entry
    if (prefix && !full.startsWith(prefix)) continue; // outside the scaffold root
    const rel = full.slice(prefix.length);
    if (!rel || rel === 'manifest.json') continue; // manifest travels in its own field
    if (rel.includes('..')) continue;
    if (EXCLUDED_TOP_DIRS.has(rel.split('/')[0])) continue; // never bundle runtime dirs
    scaffold.push({ path: rel, contentB64: bytesToBase64(entries[full]) });
  }

  const id = typeof manifest.id === 'string' && manifest.id ? manifest.id : undefined;
  const name =
    typeof manifest.name === 'string' && manifest.name ? manifest.name : id ?? 'Aplicação importada';

  return {
    schemaVersion: 1,
    manifest: { ...manifest, name, ...(id ? { id } : {}) } as ArtifactBundle['manifest'],
    scaffold,
    exportedAt: new Date().toISOString(),
    ...(id ? { sourceArtifactId: id } : {}),
  };
}

/**
 * Read a user-selected import file into a bundle object, accepting BOTH the JSON
 * bundle envelope and a downloaded app `.zip`. Detection is by content (ZIP magic
 * bytes) with a filename/MIME fallback, so a mis-typed or missing MIME still works.
 */
export async function readBundleFile(file: File): Promise<unknown> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = looksLikeZip(bytes) || /\.zip$/i.test(file.name) || file.type === 'application/zip';
  if (isZip) return bundleFromZip(bytes);
  return JSON.parse(new TextDecoder().decode(bytes));
}
