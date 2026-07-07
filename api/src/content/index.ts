/**
 * content/ public surface (ch08 §8.3.2 + ch05 §5.5.1).
 *
 * The four composition/management functions and the ch05 wrapper, bound to a lazily-built
 * default loader. No REST surface (ch03 has no /content resource; ch08 §8.7 criterion 2).
 *
 * Imports: config.ts + ./loader + ./manifest + node builtins only (ch02 §2.6 — content/
 * may import config.ts only). The default loader's data directory follows the codebase's
 * path convention (`process.env.EKOA_DATA_DIR` || `~/.ekoa/data`, mirroring the sandbox-root
 * pattern in apps/); a typed `config.dataDir` key is a wiring improvement returned to the
 * composition root. The audit write path (FIXED-8) is injected via configureContentLoader.
 */
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config.js';
import {
  createContentLoader,
  type ContentLoader,
  type ContentAudit,
  type PackageRecord,
  type ComposeResult,
  type AgentContext,
  type ContentLoaderDeps,
} from './loader.js';

/** Default data directory (codebase convention: env override else `~/.ekoa/data`). */
function defaultDataDir(): string {
  return process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
}

/** Repo baseline package root: api/content/ resolved relative to this module (works from
 *  both src/content and dist/content — two levels up lands on api/). */
function defaultBaselineDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
}

let singleton: ContentLoader | undefined;
let auditSeam: ContentAudit | undefined;

function loader(): ContentLoader {
  if (!singleton) {
    loadConfig(); // fail closed on a bad config before any content IO (content/ is config-only)
    singleton = createContentLoader({
      dataDir: defaultDataDir(),
      baselineDir: defaultBaselineDir(),
      audit: auditSeam,
    });
  }
  return singleton;
}

/** Wire the audit write path (FIXED-8) at the composition root, before boot. Rebuilds the
 *  default loader so the seam takes effect on the next call. */
export function configureContentLoader(deps: { audit?: ContentAudit }): void {
  auditSeam = deps.audit;
  singleton = undefined;
}

/** Boot ingest (ch08 §8.3.1): call once from server.ts after config load. Idempotent. */
export function bootContentLoader(): Promise<void> {
  return loader().ingestAll();
}

// The four §8.3.2 functions.
export const composeContext: ContentLoader['composeContext'] = (userId, agent, taskPackages) =>
  loader().composeContext(userId, agent, taskPackages);
export const importPackage: ContentLoader['importPackage'] = (dirOrArchive, source) =>
  loader().importPackage(dirOrArchive, source);
export const removePackage: ContentLoader['removePackage'] = (name) => loader().removePackage(name);
export const listPackages: ContentLoader['listPackages'] = () => loader().listPackages();

// The ch05 §5.5.1 wrapper `agents/` codes against.
export const assembleAgentContext: ContentLoader['assembleAgentContext'] = (input) =>
  loader().assembleAgentContext(input);

// Factory + types for the composition root and tests (plumbing, not operational API).
export { createContentLoader };
export type {
  ContentLoader,
  ContentAudit,
  ContentLoaderDeps,
  PackageRecord,
  ComposeResult,
  AgentContext,
};
export { AGENT_KINDS, type AgentKind, ContentValidationError } from './manifest.js';
