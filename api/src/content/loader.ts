/**
 * content/ context loader (ch08 §8.3) — a loader, not a framework (FIXED-6).
 *
 * It validates packages, stores them by hash in a content-addressed cache, composes
 * per-user directories, and hands paths to `agents/`. No plugin system, no hooks, no
 * inter-package deps, no schema migrations, no runtime markdown interpretation, no model
 * calls, no per-request work beyond a directory-path lookup (ch08 §8.3).
 *
 * On-disk layout (ch08 §8.3.1), all under `dataDir/content/`:
 *   store/<sha256>/                        content-addressed cache, write-once, verified on read
 *   runtime/<package>/                     runtime-authored / imported sources (durable)
 *   compose/user-<id>/<agent>/<hash>/      materialized compositions, immutable
 * plus the repo baseline at `baselineDir` (api/content/, read-only at runtime).
 *
 * Imports: node builtins + ./manifest only. No other api/src import — the audit write path
 * (data/ logActivity, FIXED-8) is reached through an injected `audit` seam wired by the
 * composition root, because content/ may import config.ts only (ch02 §2.6).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  copyFileSync,
  rmSync,
  renameSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import {
  validatePackageDir,
  frontmatterDescription,
  type ContentManifest,
  type AgentKind,
} from './manifest.js';

/** A package known to the loader, resolved to its content-addressed store hash. */
export interface PackageRecord {
  name: string;
  version: string;
  hash: string;
  mode: 'eager' | 'on-demand';
  agents: AgentKind[];
  files: string[];
  /** Storage tier the winning version came from; runtime shadows baseline (§8.3.2 rule 2). */
  source: 'baseline' | 'runtime';
}

/** The result of a composition (ch08 §8.3.2 rule 5), handed to `agents/`. */
export interface ComposeResult {
  dir: string;
  hash: string;
  eagerFiles: string[];
  onDemandFiles: string[];
}

/** The ch05 §5.5.1 wrapper shape `agents/` codes against. */
export interface AgentContext {
  contextDir: string;
  promptSections: string[];
  contentVersion: string;
}

/** Audit seam (FIXED-8). The composition root wires this to `data/` `logActivity`; the
 *  loader defaults to a no-op so tests and boot never require the persistence tier. */
export type ContentAudit = (event: { type: string; metadata: Record<string, unknown> }) => void;

export interface ContentLoaderDeps {
  /** Base data directory; the loader owns `<dataDir>/content/**`. */
  dataDir: string;
  /** Repo baseline package root (api/content/), read-only at runtime. */
  baselineDir: string;
  /** Injected audit write path (FIXED-8); defaults to no-op. */
  audit?: ContentAudit;
  /** Clock seam for quarantine/sweep timestamps; defaults to Date.now. */
  now?: () => number;
}

/** The loader's public surface: the four §8.3.2 functions + the §5.5.1 wrapper, plus a
 *  boot ingest. No REST surface, no schemas (ch08 §8.7 criterion 2). */
export interface ContentLoader {
  composeContext(userId: string, agent: AgentKind, taskPackages?: string[]): Promise<ComposeResult>;
  importPackage(dirOrArchive: string, source: string): Promise<PackageRecord>;
  removePackage(name: string): Promise<void>;
  listPackages(): Promise<PackageRecord[]>;
  assembleAgentContext(input: { agentKind: AgentKind; userId: string }): Promise<AgentContext>;
  /** Boot behavior (ch08 §8.3.1): ingest baseline + runtime, quarantine corruption, sweep
   *  stale compositions. Idempotent; invoked once at boot by the composition root and
   *  lazily on first use otherwise. */
  ingestAll(): Promise<void>;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Reject filesystem-unsafe user/agent path segments before they name a directory. */
function safeSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error(`content loader: unsafe ${label} segment: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Strip a leading YAML frontmatter block, leaving the prose body for the system prompt. */
function stripFrontmatter(body: string): string {
  if (!body.startsWith('---')) return body;
  const end = body.indexOf('\n---', 3);
  if (end === -1) return body;
  const after = body.indexOf('\n', end + 1);
  return after === -1 ? '' : body.slice(after + 1).replace(/^\n+/, '');
}

export function createContentLoader(deps: ContentLoaderDeps): ContentLoader {
  const now = deps.now ?? Date.now;
  const audit: ContentAudit = deps.audit ?? (() => {});
  const contentRoot = join(deps.dataDir, 'content');
  const storeDir = join(contentRoot, 'store');
  const runtimeDir = join(contentRoot, 'runtime');
  const composeRoot = join(contentRoot, 'compose');

  /** Winning package per name (runtime shadows baseline). Rebuilt by ingestAll. */
  const registry = new Map<string, PackageRecord>();
  let ready = false;

  const ensureDirs = (): void => {
    for (const d of [storeDir, runtimeDir, composeRoot]) mkdirSync(d, { recursive: true });
  };

  /** Directories directly under `root` that contain a content.json. */
  const packageDirs = (root: string): string[] => {
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'content.json')))
      .map((e) => join(root, e.name));
  };

  /**
   * Canonical archive hash (ch08 §8.3.1): sha256 over the sorted file list (content.json +
   * manifest files) with each file's relative path, byte length, and bytes folded in.
   */
  const canonicalHash = (dir: string, files: string[]): string => {
    const all = ['content.json', ...files].sort();
    const h = createHash('sha256');
    for (const rel of all) {
      const buf = readFileSync(join(dir, rel));
      h.update(rel);
      h.update('\0');
      h.update(String(buf.length));
      h.update('\0');
      h.update(buf);
    }
    return h.digest('hex');
  };

  /** Copy content.json + listed files from a source dir into a store/runtime dest. */
  const copyPackage = (srcDir: string, destDir: string, files: string[]): void => {
    mkdirSync(destDir, { recursive: true });
    for (const rel of ['content.json', ...files]) {
      const dest = join(destDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(srcDir, rel), dest);
    }
  };

  /** Validate + hash a source dir, ensure it exists write-once in the store, return its record. */
  const ingestIntoStore = (sourceDir: string, source: 'baseline' | 'runtime'): PackageRecord => {
    const manifest: ContentManifest = validatePackageDir(sourceDir);
    const hash = canonicalHash(sourceDir, manifest.files);
    const dest = join(storeDir, hash);
    if (!existsSync(dest)) copyPackage(sourceDir, dest, manifest.files);
    return {
      name: manifest.name,
      version: manifest.version,
      hash,
      mode: manifest.mode,
      agents: manifest.agents,
      files: manifest.files,
      source,
    };
  };

  /** Register a record, honoring runtime-shadows-baseline precedence (§8.3.2 rule 2). */
  const register = (rec: PackageRecord): void => {
    const existing = registry.get(rec.name);
    if (!existing || (existing.source === 'baseline' && rec.source === 'runtime')) {
      registry.set(rec.name, rec);
    }
  };

  /** Re-hash every store entry; quarantine any whose contents no longer match its name,
   *  re-ingesting from source when possible, else dropping loudly (ch08 §8.3.2). */
  const corruptionSweep = (sourceByHash: Map<string, string>): void => {
    if (!existsSync(storeDir)) return;
    for (const entry of readdirSync(storeDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.includes('.corrupt.')) continue;
      const hash = entry.name;
      const dir = join(storeDir, hash);
      let actual = '';
      try {
        const manifest = validatePackageDir(dir);
        actual = canonicalHash(dir, manifest.files);
      } catch {
        actual = '';
      }
      if (actual === hash) continue;
      const quarantine = `${dir}.corrupt.${now()}`;
      renameSync(dir, quarantine);
      audit({ type: 'content.store.quarantined', metadata: { hash, quarantine } });
      const src = sourceByHash.get(hash);
      if (src && existsSync(src)) {
        const manifest = validatePackageDir(src);
        copyPackage(src, dir, manifest.files);
        audit({ type: 'content.store.reingested', metadata: { hash, source: src } });
      } else {
        audit({ type: 'content.store.dropped', metadata: { hash } });
        // eslint-disable-next-line no-console
        console.error(`content loader: store entry ${hash} was corrupt and has no source; dropped from compositions`);
      }
    }
  };

  /** Delete composition directories older than 7 days (immutable; safe at boot — a fresh
   *  process holds no in-flight jobs referencing them). */
  const composeSweep = (): void => {
    if (!existsSync(composeRoot)) return;
    const cutoff = now() - SEVEN_DAYS_MS;
    for (const user of readdirSync(composeRoot, { withFileTypes: true })) {
      if (!user.isDirectory()) continue;
      const userDir = join(composeRoot, user.name);
      for (const agent of readdirSync(userDir, { withFileTypes: true })) {
        if (!agent.isDirectory()) continue;
        const agentDir = join(userDir, agent.name);
        for (const comp of readdirSync(agentDir, { withFileTypes: true })) {
          if (!comp.isDirectory()) continue;
          const compDir = join(agentDir, comp.name);
          if (statSync(compDir).mtimeMs < cutoff) rmSync(compDir, { recursive: true, force: true });
        }
      }
    }
  };

  const ingestAll = async (): Promise<void> => {
    ensureDirs();
    registry.clear();
    const sourceByHash = new Map<string, string>();
    const sources: Array<{ dir: string; source: 'baseline' | 'runtime' }> = [
      ...packageDirs(deps.baselineDir).map((dir) => ({ dir, source: 'baseline' as const })),
      ...packageDirs(runtimeDir).map((dir) => ({ dir, source: 'runtime' as const })),
    ];
    for (const s of sources) {
      const rec = ingestIntoStore(s.dir, s.source);
      sourceByHash.set(rec.hash, s.dir);
      register(rec);
    }
    corruptionSweep(sourceByHash);
    composeSweep();
    ready = true;
  };

  const ensureReady = async (): Promise<void> => {
    if (!ready) await ingestAll();
  };

  /** Symlink each package's store dir into the composition dir, copying as a fallback. */
  const materialize = (dir: string, packages: PackageRecord[]): void => {
    mkdirSync(dir, { recursive: true });
    for (const p of packages) {
      const target = join(storeDir, p.hash);
      const link = join(dir, p.name);
      if (existsSync(link)) continue;
      try {
        symlinkSync(target, link, 'dir');
      } catch {
        copyPackage(target, link, p.files);
      }
    }
  };

  /** The composition hash names the directory (ch08 §8.3.2 rule 4). */
  const compositionHash = (hashes: string[]): string =>
    createHash('sha256').update(hashes.join('\n')).digest('hex');

  const composeContext = async (
    userId: string,
    agent: AgentKind,
    taskPackages: string[] = [],
  ): Promise<ComposeResult> => {
    await ensureReady();
    const user = safeSegment(userId, 'userId');

    // Rule 1 + 2: select by agent, runtime already shadows baseline in the registry.
    const base = [...registry.values()]
      .filter((p) => p.agents.includes(agent))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Rule 3: append caller task packages, in caller order, de-duplicated by name.
    const ordered: PackageRecord[] = [];
    const seen = new Set<string>();
    for (const p of base) {
      if (!seen.has(p.name)) {
        ordered.push(p);
        seen.add(p.name);
      }
    }
    for (const name of taskPackages) {
      const p = registry.get(name);
      if (!p) throw new Error(`content loader: unknown task package: ${name}`);
      if (!seen.has(p.name)) {
        ordered.push(p);
        seen.add(p.name);
      }
    }

    // Rule 4: the ordered hash list's hash names the composition dir; reuse if present.
    const hash = compositionHash(ordered.map((p) => p.hash));
    const dir = join(composeRoot, `user-${user}`, agent, hash);
    if (!existsSync(dir)) materialize(dir, ordered);

    // Rule 5: eager vs on-demand split over the .md skill files.
    const eagerFiles: string[] = [];
    const onDemandFiles: string[] = [];
    for (const p of ordered) {
      for (const f of p.files) {
        if (extname(f).toLowerCase() !== '.md') continue;
        (p.mode === 'eager' ? eagerFiles : onDemandFiles).push(join(dir, p.name, f));
      }
    }
    return { dir, hash, eagerFiles, onDemandFiles };
  };

  const assembleAgentContext = async (input: {
    agentKind: AgentKind;
    userId: string;
  }): Promise<AgentContext> => {
    const r = await composeContext(input.userId, input.agentKind);
    const promptSections = r.eagerFiles.map((f) => stripFrontmatter(readFileSync(f, 'utf8')));
    return { contextDir: r.dir, promptSections, contentVersion: r.hash };
  };

  const importPackage = async (dirOrArchive: string, source: string): Promise<PackageRecord> => {
    await ensureReady();
    const st = statSync(dirOrArchive);
    if (!st.isDirectory()) {
      // v1 ships store + composition only (P-21); the sole runtime author (the integration
      // builder) writes a directory. Archive ingestion needs an extractor dependency and is
      // deferred — reported to the lead, not silently improvised.
      throw new Error(
        `content loader: archive import is not implemented in v1; provide a package directory (source=${source})`,
      );
    }
    const manifest = validatePackageDir(dirOrArchive);
    const runtimeDest = join(runtimeDir, manifest.name);
    mkdirSync(runtimeDir, { recursive: true });
    rmSync(runtimeDest, { recursive: true, force: true });
    copyPackage(dirOrArchive, runtimeDest, manifest.files);
    const rec = ingestIntoStore(runtimeDest, 'runtime');
    registry.set(rec.name, rec); // runtime shadows baseline unconditionally
    audit({ type: 'content.package.imported', metadata: { name: rec.name, hash: rec.hash, source } });
    return rec;
  };

  const removePackage = async (name: string): Promise<void> => {
    await ensureReady();
    const runtimeDest = join(runtimeDir, name);
    if (existsSync(runtimeDest)) rmSync(runtimeDest, { recursive: true, force: true });
    registry.delete(name);
    // Reveal a shadowed baseline of the same name, if one exists (removal drops the runtime
    // source; store entries and old compositions are left for the boot sweep, §8.3.2).
    const baselineSub = join(deps.baselineDir, name);
    if (existsSync(join(baselineSub, 'content.json'))) {
      register(ingestIntoStore(baselineSub, 'baseline'));
    }
    audit({ type: 'content.package.removed', metadata: { name } });
  };

  const listPackages = async (): Promise<PackageRecord[]> => {
    await ensureReady();
    return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  return {
    composeContext,
    importPackage,
    removePackage,
    listPackages,
    assembleAgentContext,
    ingestAll,
  };
}
