/**
 * App Manifest Schema (ch07 §7.1.1, §7.3 — port-as-is, carryover-audit A3).
 *
 * Defines the canonical manifest.json that lives at the root of every sandbox app
 * project. The coding agent writes it when creating an app; the build tool reads it to
 * know what to build; the registry reads it for metadata.
 *
 * File: <projectDir>/manifest.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ============================================
// Schema
// ============================================

/** The type of app, which determines how the build tool processes it. */
export type AppType = 'jsx-app' | 'html-app' | 'static' | 'static-html';

export interface AppManifest {
  /** Unique app ID (matches artifact instance ID). */
  id: string;

  /** Human-readable name. */
  name: string;

  /** Semver version string (default "1.0.0"). */
  version: string;

  /** Optional description. */
  description?: string;

  /**
   * Main entry file relative to the project root.
   * Default: "frontend/src/index.jsx"
   */
  entryPoint: string;

  /**
   * Build output directory relative to the project root.
   * Default: "dist/"
   */
  outputDir: string;

  /** App type that determines how the build tool processes it. */
  type: AppType;

  /**
   * CDN / importmap dependencies.
   * Keys are package names, values are CDN URLs or version specifiers.
   */
  dependencies?: Record<string, string>;

  /** Optional Cortex API configuration injected at build time. */
  cortexApi?: {
    /** Cortex API base URL (injected at build time). */
    baseUrl?: string;
  };

  /**
   * Optional base template this artifact extends. References an id under `ekoa-data/bases/`.
   * If absent, the base loader applies the default base (`app-auth-persistent`).
   */
  extends?: string;

  /**
   * Optional server-side backend (Layer 2). When present, the build esbuild-bundles
   * `entryPoint` (platform:node, esm) to `dist-backend/backend.mjs`; the worker
   * imports that bundle and core invokes the named `handlers` with `(input, ekoa)`.
   * The `ekoa` capability handle is injected at call time - never imported.
   */
  backend?: {
    /** Entry file relative to the project root, e.g. "backend/index.js". */
    entryPoint: string;
    /** Exported handler names invokable by core, e.g. ["onEmail"]. */
    handlers: string[];
  };

  /**
   * Opt in to the per-owner SHARED app-data namespace. When `true`, the served
   * app gains `window.__ekoa.shared.*`, reading/writing collections scoped to
   * the artifact's OWNER (resolved server-side) instead of its own appId - so
   * every artifact this account owns that also opts in shares those collections.
   * Absent/false: the app sees only its own per-app data (the default isolation).
   */
  sharedData?: boolean;
}

// ============================================
// Constants
// ============================================

const MANIFEST_FILENAME = 'manifest.json';
const DEFAULT_ENTRY_POINT = 'frontend/src/index.jsx';
const DEFAULT_OUTPUT_DIR = 'dist/';
const DEFAULT_VERSION = '1.0.0';
const DEFAULT_TYPE: AppType = 'jsx-app';

const VALID_TYPES: ReadonlySet<AppType> = new Set(['jsx-app', 'html-app', 'static', 'static-html']);

// ============================================
// Helpers
// ============================================

/**
 * Create a manifest with sensible defaults.
 */
export function createDefaultManifest(appId: string, name: string): AppManifest {
  return {
    id: appId,
    name,
    version: DEFAULT_VERSION,
    entryPoint: DEFAULT_ENTRY_POINT,
    outputDir: DEFAULT_OUTPUT_DIR,
    type: DEFAULT_TYPE,
  };
}

/**
 * Validate unknown data against the manifest schema.
 * Returns a typed AppManifest on success, throws on invalid data.
 */
export function validateManifest(data: unknown): AppManifest {
  if (!data || typeof data !== 'object') {
    throw new Error('Manifest must be a non-null object');
  }

  const obj = data as Record<string, unknown>;

  // Required string fields
  if (typeof obj.id !== 'string' || !obj.id.trim()) {
    throw new Error('Manifest "id" must be a non-empty string');
  }
  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    throw new Error('Manifest "name" must be a non-empty string');
  }
  if (typeof obj.version !== 'string' || !obj.version.trim()) {
    throw new Error('Manifest "version" must be a non-empty string');
  }
  if (typeof obj.entryPoint !== 'string' || !obj.entryPoint.trim()) {
    throw new Error('Manifest "entryPoint" must be a non-empty string');
  }
  if (typeof obj.outputDir !== 'string' || !obj.outputDir.trim()) {
    throw new Error('Manifest "outputDir" must be a non-empty string');
  }

  // Type enum
  if (typeof obj.type !== 'string' || !VALID_TYPES.has(obj.type as AppType)) {
    throw new Error(`Manifest "type" must be one of: ${[...VALID_TYPES].join(', ')}`);
  }

  // Optional fields
  if (obj.description !== undefined && typeof obj.description !== 'string') {
    throw new Error('Manifest "description" must be a string if provided');
  }

  if (obj.dependencies !== undefined) {
    if (!obj.dependencies || typeof obj.dependencies !== 'object' || Array.isArray(obj.dependencies)) {
      throw new Error('Manifest "dependencies" must be a plain object if provided');
    }
    for (const [key, val] of Object.entries(obj.dependencies as Record<string, unknown>)) {
      if (typeof val !== 'string') {
        throw new Error(`Manifest dependency "${key}" value must be a string`);
      }
    }
  }

  if (obj.extends !== undefined && (typeof obj.extends !== 'string' || !obj.extends.trim())) {
    throw new Error('Manifest "extends" must be a non-empty string if provided');
  }

  if (obj.backend !== undefined) {
    if (!obj.backend || typeof obj.backend !== 'object' || Array.isArray(obj.backend)) {
      throw new Error('Manifest "backend" must be a plain object if provided');
    }
    const b = obj.backend as Record<string, unknown>;
    if (typeof b.entryPoint !== 'string' || !b.entryPoint.trim()) {
      throw new Error('Manifest "backend.entryPoint" must be a non-empty string');
    }
    if ((b.entryPoint as string).startsWith('/')) {
      throw new Error('Manifest "backend.entryPoint" must be a relative path');
    }
    if ((b.entryPoint as string).includes('..')) {
      throw new Error('Manifest "backend.entryPoint" must not contain ".."');
    }
    if (!Array.isArray(b.handlers) || b.handlers.length === 0 || !b.handlers.every((h) => typeof h === 'string' && h.trim())) {
      throw new Error('Manifest "backend.handlers" must be a non-empty array of strings');
    }
  }

  if (obj.sharedData !== undefined && typeof obj.sharedData !== 'boolean') {
    throw new Error('Manifest "sharedData" must be a boolean if provided');
  }

  if (obj.cortexApi !== undefined) {
    if (!obj.cortexApi || typeof obj.cortexApi !== 'object' || Array.isArray(obj.cortexApi)) {
      throw new Error('Manifest "cortexApi" must be a plain object if provided');
    }
    const cApi = obj.cortexApi as Record<string, unknown>;
    if (cApi.baseUrl !== undefined && typeof cApi.baseUrl !== 'string') {
      throw new Error('Manifest "cortexApi.baseUrl" must be a string if provided');
    }
  }

  // Path safety: reject absolute paths and path traversals
  if ((obj.entryPoint as string).startsWith('/')) {
    throw new Error('Manifest "entryPoint" must be a relative path');
  }
  if ((obj.entryPoint as string).includes('..')) {
    throw new Error('Manifest "entryPoint" must not contain ".."');
  }
  if ((obj.outputDir as string).startsWith('/')) {
    throw new Error('Manifest "outputDir" must be a relative path');
  }
  if ((obj.outputDir as string).includes('..')) {
    throw new Error('Manifest "outputDir" must not contain ".."');
  }

  return {
    id: obj.id,
    name: obj.name,
    version: obj.version,
    entryPoint: obj.entryPoint,
    outputDir: obj.outputDir,
    type: obj.type as AppType,
    ...(obj.description !== undefined && { description: obj.description as string }),
    ...(obj.dependencies !== undefined && { dependencies: obj.dependencies as Record<string, string> }),
    ...(obj.cortexApi !== undefined && { cortexApi: obj.cortexApi as AppManifest['cortexApi'] }),
    ...(obj.extends !== undefined && { extends: obj.extends as string }),
    ...(obj.backend !== undefined && { backend: obj.backend as AppManifest['backend'] }),
    ...(obj.sharedData !== undefined && { sharedData: obj.sharedData as boolean }),
  };
}

/**
 * Read and validate manifest.json from a project directory.
 * Returns null if the manifest file does not exist.
 * Throws if the file exists but is invalid JSON or fails validation.
 */
export async function readManifest(projectDir: string): Promise<AppManifest | null> {
  const manifestPath = join(projectDir, MANIFEST_FILENAME);
  let raw: string;

  try {
    raw = await readFile(manifestPath, 'utf-8');
  } catch (err: unknown) {
    // File not found - not an error, just no manifest yet
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${manifestPath}`);
  }

  return validateManifest(parsed);
}

/**
 * Write manifest.json to a project directory.
 */
export async function writeManifest(projectDir: string, manifest: AppManifest): Promise<void> {
  // Validate before writing to ensure we never write invalid data
  validateManifest(manifest);

  const manifestPath = join(projectDir, MANIFEST_FILENAME);
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}
