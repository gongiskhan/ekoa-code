/**
 * Parse the MANIFEST.md file at an artifact's project root. Returns a
 * typed ArtifactManifest with capabilities-as-recipes that the
 * EkoaActionExecutor can interpret.
 *
 * Format:
 *   ---
 *   name: <string>
 *   purpose: <string>
 *   data_model:
 *     <collection_name>:
 *       fields: { ... }
 *       indexed_by: <string>
 *   external_dependencies:
 *     integrations: [<string>]
 *     artifacts: [<string>]
 *   capabilities:
 *     - name: <slug>
 *       description: <string>
 *       inputs:
 *         <name>: { type: <string>, required: <bool> }
 *       recipe:
 *         - { op: ..., ... }
 *       result_template: <string>
 *   ---
 *
 *   (optional markdown body — ignored)
 *
 * Ported as-is (carryover-audit B24, `manifest-parser.ts` = port-as-is): node crypto/fs +
 * js-yaml + the platform-primitive type only.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import type { PlatformPrimitive } from './platform-primitives.js';

export interface ArtifactManifestCapabilityInput {
  type: string;
  required?: boolean;
  description?: string;
  defaultValue?: unknown;
}

export interface ArtifactManifestCapability {
  name: string;
  description: string;
  inputs: Record<string, ArtifactManifestCapabilityInput>;
  recipe: PlatformPrimitive[];
  result_template?: string;
  mutates?: boolean;
}

export interface ArtifactManifestDataModelEntry {
  fields: Record<string, string>;
  indexed_by?: string;
}

export interface ArtifactManifestExternalDependencies {
  integrations?: string[];
  artifacts?: string[];
}

export interface ArtifactManifest {
  name: string;
  purpose: string;
  data_model: Record<string, ArtifactManifestDataModelEntry>;
  external_dependencies?: ArtifactManifestExternalDependencies;
  capabilities: ArtifactManifestCapability[];
  /** SHA-1 of the original frontmatter text. Used for cache invalidation. */
  revision: string;
  /** Raw frontmatter object for forward-compat fields the parser doesn't model. */
  raw: Record<string, unknown>;
}

export class ManifestParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManifestParseError';
  }
}

/**
 * Parse manifest text (the entire MANIFEST.md file contents).
 */
export function parseManifest(text: string): ArtifactManifest {
  const frontmatter = extractFrontmatter(text);
  if (!frontmatter) {
    throw new ManifestParseError('MANIFEST.md is missing YAML frontmatter (--- … ---)');
  }
  const { yamlText, rev } = frontmatter;

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlText);
  } catch (err) {
    throw new ManifestParseError(`failed to parse YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ManifestParseError('MANIFEST.md frontmatter must be an object');
  }
  const obj = parsed as Record<string, unknown>;

  const name = requireString(obj, 'name');
  const purpose = requireString(obj, 'purpose');
  const data_model = (obj.data_model as Record<string, ArtifactManifestDataModelEntry>) ?? {};
  const external_dependencies = (obj.external_dependencies as ArtifactManifestExternalDependencies) ?? undefined;
  const rawCaps = obj.capabilities;

  if (!Array.isArray(rawCaps)) {
    throw new ManifestParseError(`capabilities must be an array, got ${typeof rawCaps}`);
  }

  const capabilities: ArtifactManifestCapability[] = rawCaps.map((c: unknown, idx: number) => {
    if (!c || typeof c !== 'object') {
      throw new ManifestParseError(`capability[${idx}] is not an object`);
    }
    const cap = c as Record<string, unknown>;
    const capName = requireString(cap, 'name');
    const capDesc = requireString(cap, 'description');
    const inputs = (cap.inputs as Record<string, ArtifactManifestCapabilityInput>) ?? {};
    const recipe = cap.recipe;
    if (!Array.isArray(recipe)) {
      throw new ManifestParseError(`capability "${capName}" recipe must be an array`);
    }
    return {
      name: capName,
      description: capDesc,
      inputs,
      recipe: recipe as PlatformPrimitive[],
      result_template: typeof cap.result_template === 'string' ? cap.result_template : undefined,
      mutates: cap.mutates === true,
    };
  });

  return {
    name,
    purpose,
    data_model,
    external_dependencies,
    capabilities,
    revision: rev,
    raw: obj,
  };
}

/**
 * Convenience: read MANIFEST.md from disk and parse.
 */
export function loadManifestFromFile(filePath: string): ArtifactManifest {
  const text = readFileSync(filePath, 'utf8');
  return parseManifest(text);
}

/**
 * Find a capability by name.
 */
export function getCapability(manifest: ArtifactManifest, capabilityName: string): ArtifactManifestCapability | null {
  return manifest.capabilities.find((c) => c.name === capabilityName) ?? null;
}

function extractFrontmatter(text: string): { yamlText: string; rev: string } | null {
  // Frontmatter format: --- on its own line, then yaml, then --- on its own line.
  const match = /^---\s*\n([\s\S]+?)\n---\s*(\n|$)/.exec(text);
  if (!match) return null;
  const yamlText = match[1]!;
  const rev = createHash('sha1').update(yamlText).digest('hex');
  return { yamlText, rev };
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new ManifestParseError(`MANIFEST.md frontmatter is missing required string field "${key}"`);
  }
  return v;
}
