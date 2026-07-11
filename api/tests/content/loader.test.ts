/**
 * content/ loader suite (ch08 §8.7 criteria 2-4). Vitest, no server needed: every test
 * builds packages on disk under a temp dataDir + baselineDir and drives the loader through
 * createContentLoader (the DI seam the composition root uses). Covers: the public surface,
 * the imports-only-config static invariant, executable rejection (the row-11 regression),
 * composition order + runtime-shadows-baseline, determinism/reuse, immutability across
 * updates, corruption quarantine, the eager/on-demand split, task-package append (slot 8),
 * and the three-agent coverage over the real baseline packages.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
  chmodSync,
  lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createContentLoader,
  type ContentAudit,
  type ContentLoaderDeps,
} from '../../src/content/loader.js';
import { ContentValidationError } from '../../src/content/manifest.js';
import * as contentIndex from '../../src/content/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_BASELINE = join(HERE, '..', '..', 'content');

interface PackageSpec {
  name: string;
  version?: string;
  agents: Array<'coding' | 'chat' | 'automation'>;
  mode: 'eager' | 'on-demand';
  /** file path -> body; the manifest `files` list is the keys. */
  files: Record<string, string>;
}

const skill = (description: string, body = 'corpo da skill'): string =>
  `---\ndescription: ${description}\n---\n# Skill\n${body}\n`;

/** Materialize a package directory under `root`. Returns the package dir path. */
function writePackage(root: string, spec: PackageSpec): string {
  const dir = join(root, spec.name);
  mkdirSync(dir, { recursive: true });
  for (const [rel, body] of Object.entries(spec.files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  writeFileSync(
    join(dir, 'content.json'),
    JSON.stringify({
      name: spec.name,
      version: spec.version ?? '1.0.0',
      description: `pacote ${spec.name}`,
      agents: spec.agents,
      mode: spec.mode,
      files: Object.keys(spec.files),
    }),
  );
  return dir;
}

describe('content loader', () => {
  let tmp: string;
  let dataDir: string;
  let baselineDir: string;
  let auditEvents: Array<{ type: string; metadata: Record<string, unknown> }>;
  let audit: ContentAudit;

  const makeLoader = (over: Partial<ContentLoaderDeps> = {}) =>
    createContentLoader({ dataDir, baselineDir, audit, ...over });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ekoa-content-'));
    dataDir = join(tmp, 'data');
    baselineDir = join(tmp, 'baseline');
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(baselineDir, { recursive: true });
    auditEvents = [];
    audit = (e) => auditEvents.push(e);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('exposes exactly the four §8.3.2 functions plus the §5.5.1 wrapper (no REST surface)', () => {
    const loader = makeLoader();
    for (const fn of ['composeContext', 'importPackage', 'removePackage', 'listPackages', 'assembleAgentContext']) {
      expect(typeof (loader as unknown as Record<string, unknown>)[fn]).toBe('function');
    }
    // The public module re-exports the same operational surface, the factory, and boot/wiring
    // helpers — but nothing route-, schema-, or handler-shaped (ch08 §8.7 criterion 2).
    const exported = Object.keys(contentIndex);
    expect(exported).toEqual(expect.arrayContaining(['composeContext', 'importPackage', 'removePackage', 'listPackages', 'assembleAgentContext']));
    for (const name of exported) {
      expect(name.toLowerCase()).not.toMatch(/rout|handler|schema|endpoint|middleware/);
    }
  });

  it('imports only config.ts among api/src modules (ch02 §2.6)', () => {
    const srcDir = join(HERE, '..', '..', 'src', 'content');
    const sources = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    expect(sources.length).toBeGreaterThan(0);
    const importRe = /\bfrom\s+['"]([^'"]+)['"]/g;
    for (const file of sources) {
      const text = readFileSync(join(srcDir, file), 'utf8');
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(text)) !== null) {
        const spec = m[1];
        if (!spec) continue;
        // Cross-module api/src imports look like '../<module>/...'. The only permitted one
        // is '../config'. In-module ('./...'), node builtins, and 'zod' are all fine.
        if (spec.startsWith('../')) {
          expect(spec.replace(/\.js$/, '')).toBe('../config');
        }
        expect(spec).not.toMatch(/@anthropic/);
        expect(spec).not.toMatch(/\bllm\b/);
      }
    }
  });

  it('rejects an executable file at import time — the row-11 .mjs regression', async () => {
    const loader = makeLoader();
    const src = join(tmp, 'evil');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'SKILL.md'), skill('ok'));
    writeFileSync(join(src, 'juros.mjs'), 'export const x = 1;');
    writeFileSync(
      join(src, 'content.json'),
      JSON.stringify({ name: 'evil', version: '1.0.0', description: 'x', agents: ['coding'], mode: 'eager', files: ['SKILL.md', 'juros.mjs'] }),
    );
    await expect(loader.importPackage(src, 'test')).rejects.toBeInstanceOf(ContentValidationError);
  });

  it('rejects a file with the executable bit set', async () => {
    const loader = makeLoader();
    const src = join(tmp, 'execbit');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'SKILL.md'), skill('ok'));
    const data = join(src, 'sample.txt');
    writeFileSync(data, 'inert');
    chmodSync(data, 0o755);
    writeFileSync(
      join(src, 'content.json'),
      JSON.stringify({ name: 'execbit', version: '1.0.0', description: 'x', agents: ['coding'], mode: 'eager', files: ['SKILL.md', 'sample.txt'] }),
    );
    await expect(loader.importPackage(src, 'test')).rejects.toBeInstanceOf(ContentValidationError);
  });

  it('rejects a package with a file outside the manifest list', async () => {
    const loader = makeLoader();
    const src = join(tmp, 'extra');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'SKILL.md'), skill('ok'));
    writeFileSync(join(src, 'stray.txt'), 'not listed');
    writeFileSync(
      join(src, 'content.json'),
      JSON.stringify({ name: 'extra', version: '1.0.0', description: 'x', agents: ['coding'], mode: 'eager', files: ['SKILL.md'] }),
    );
    await expect(loader.importPackage(src, 'test')).rejects.toBeInstanceOf(ContentValidationError);
  });

  it('selects packages by agent and splits eager vs on-demand', async () => {
    writePackage(baselineDir, { name: 'coding-base', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('base') } });
    writePackage(baselineDir, { name: 'coding-ref', agents: ['coding'], mode: 'on-demand', files: { 'REF.md': skill('ref') } });
    writePackage(baselineDir, { name: 'chat-base', agents: ['chat'], mode: 'eager', files: { 'SKILL.md': skill('chat') } });
    const loader = makeLoader();

    const coding = await loader.composeContext('u1', 'coding');
    expect(coding.eagerFiles.map((f) => f.split('/').slice(-2).join('/'))).toEqual(['coding-base/SKILL.md']);
    expect(coding.onDemandFiles.map((f) => f.split('/').slice(-2).join('/'))).toEqual(['coding-ref/REF.md']);

    const chat = await loader.composeContext('u1', 'chat');
    expect(chat.eagerFiles.some((f) => f.includes('coding-base'))).toBe(false);
    expect(chat.eagerFiles.map((f) => f.split('/').slice(-2).join('/'))).toEqual(['chat-base/SKILL.md']);
  });

  it('runtime shadows a baseline package of the same name', async () => {
    writePackage(baselineDir, { name: 'shadowed', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('baseline body', 'BASELINE') } });
    const loader = makeLoader();
    await loader.ingestAll();

    let pkgs = await loader.listPackages();
    expect(pkgs.find((p) => p.name === 'shadowed')?.source).toBe('baseline');

    // Import a same-name package from the runtime author path; it must shadow the baseline.
    writePackage(tmp, { name: 'shadowed', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('runtime body', 'RUNTIME') } });
    await loader.importPackage(join(tmp, 'shadowed'), 'integration-builder');

    pkgs = await loader.listPackages();
    expect(pkgs.find((p) => p.name === 'shadowed')?.source).toBe('runtime');

    const ctx = await loader.assembleAgentContext({ agentKind: 'coding', userId: 'u1' });
    expect(ctx.promptSections.join('\n')).toContain('RUNTIME');
    expect(ctx.promptSections.join('\n')).not.toContain('BASELINE');
  });

  it('composition is deterministic: same inputs reuse the same hash and directory', async () => {
    writePackage(baselineDir, { name: 'p1', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('one') } });
    writePackage(baselineDir, { name: 'p2', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('two') } });
    const loader = makeLoader();

    const a = await loader.composeContext('u1', 'coding');
    const mtime = statSync(a.dir).mtimeMs;
    const b = await loader.composeContext('u1', 'coding');
    expect(b.hash).toBe(a.hash);
    expect(b.dir).toBe(a.dir);
    // Reused, not rebuilt.
    expect(statSync(b.dir).mtimeMs).toBe(mtime);
  });

  it('an update produces a new composition; the old immutable directory survives', async () => {
    writePackage(baselineDir, { name: 'evolving', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('v1 body', 'ONE') } });
    const loader = makeLoader();
    const first = await loader.composeContext('u1', 'coding');
    expect(existsSync(first.dir)).toBe(true);

    // Import a new version of the same package (new content -> new store hash).
    writePackage(tmp, { name: 'evolving', version: '2.0.0', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('v2 body', 'TWO') } });
    await loader.importPackage(join(tmp, 'evolving'), 'integration-builder');

    const second = await loader.composeContext('u1', 'coding');
    expect(second.hash).not.toBe(first.hash);
    expect(second.dir).not.toBe(first.dir);
    // Old composition still intact (running jobs keep it).
    expect(existsSync(first.dir)).toBe(true);
    expect(readFileSync(first.eagerFiles[0]!, 'utf8')).toContain('ONE');
    expect(readFileSync(second.eagerFiles[0]!, 'utf8')).toContain('TWO');
  });

  it('appends caller task packages (slot 8) regardless of the agent filter', async () => {
    writePackage(baselineDir, { name: 'coding-base', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('base') } });
    // A task package the base coding selection would NOT include (declared for chat).
    writePackage(baselineDir, { name: 'task-pack', agents: ['chat'], mode: 'on-demand', files: { 'TASK.md': skill('task') } });
    const loader = makeLoader();

    const without = await loader.composeContext('u1', 'coding');
    expect(without.onDemandFiles.some((f) => f.includes('task-pack'))).toBe(false);

    const withTask = await loader.composeContext('u1', 'coding', ['task-pack']);
    expect(withTask.onDemandFiles.some((f) => f.includes('task-pack'))).toBe(true);
    expect(withTask.hash).not.toBe(without.hash);
  });

  it('quarantines a corrupt store entry at boot and re-ingests from source', async () => {
    writePackage(baselineDir, { name: 'corruptible', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('good body', 'GOOD') } });
    const first = makeLoader();
    await first.ingestAll();

    // Tamper the store copy so its content no longer matches its hash-named directory.
    const storeDir = join(dataDir, 'content', 'store');
    const hashDir = readdirSync(storeDir).find((d) => !d.includes('.corrupt.'))!;
    writeFileSync(join(storeDir, hashDir, 'SKILL.md'), skill('tampered', 'EVIL'));

    // A fresh loader over the same dataDir sweeps corruption at boot.
    const second = makeLoader();
    await second.ingestAll();

    expect(auditEvents.some((e) => e.type === 'content.store.quarantined')).toBe(true);
    expect(auditEvents.some((e) => e.type === 'content.store.reingested')).toBe(true);
    // The store entry was restored from the baseline source.
    expect(readFileSync(join(storeDir, hashDir, 'SKILL.md'), 'utf8')).toContain('GOOD');

    const ctx = await second.assembleAgentContext({ agentKind: 'coding', userId: 'u1' });
    expect(ctx.promptSections.join('\n')).toContain('GOOD');
  });

  it('drops a corrupt store entry loudly when its source is gone', async () => {
    writePackage(baselineDir, { name: 'gone', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('body', 'BODY') } });
    const first = makeLoader();
    await first.ingestAll();

    const storeDir = join(dataDir, 'content', 'store');
    const hashDir = readdirSync(storeDir).find((d) => !d.includes('.corrupt.'))!;
    writeFileSync(join(storeDir, hashDir, 'SKILL.md'), skill('tampered', 'EVIL'));
    // Remove the source so re-ingest is impossible.
    rmSync(join(baselineDir, 'gone'), { recursive: true, force: true });

    const second = makeLoader();
    await second.ingestAll();
    expect(auditEvents.some((e) => e.type === 'content.store.quarantined')).toBe(true);
    expect(auditEvents.some((e) => e.type === 'content.store.dropped')).toBe(true);
    const pkgs = await second.listPackages();
    expect(pkgs.find((p) => p.name === 'gone')).toBeUndefined();
  });

  it('removePackage drops a runtime source and reveals a shadowed baseline', async () => {
    writePackage(baselineDir, { name: 'dual', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('baseline', 'BASE') } });
    const loader = makeLoader();
    writePackage(tmp, { name: 'dual', version: '9.9.9', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('runtime', 'OVERRIDE') } });
    await loader.importPackage(join(tmp, 'dual'), 'integration-builder');
    expect((await loader.listPackages()).find((p) => p.name === 'dual')?.source).toBe('runtime');

    await loader.removePackage('dual');
    const after = (await loader.listPackages()).find((p) => p.name === 'dual');
    expect(after?.source).toBe('baseline');
    const ctx = await loader.assembleAgentContext({ agentKind: 'coding', userId: 'u1' });
    expect(ctx.promptSections.join('\n')).toContain('BASE');
  });

  it('materializes compositions by symlink where supported', async () => {
    writePackage(baselineDir, { name: 'linked', agents: ['coding'], mode: 'eager', files: { 'SKILL.md': skill('x') } });
    const loader = makeLoader();
    const ctx = await loader.composeContext('u1', 'coding');
    const link = join(ctx.dir, 'linked');
    // Either a symlink (preferred) or a real dir (copy fallback) — both valid.
    const st = lstatSync(link);
    expect(st.isSymbolicLink() || st.isDirectory()).toBe(true);
  });

  describe('real baseline packages (three-agent coverage)', () => {
    const loader = () => createContentLoader({ dataDir, baselineDir: REAL_BASELINE, audit });

    it('each agent gets its own base package and not the others', async () => {
      const l = loader();
      const coding = await l.composeContext('u1', 'coding');
      const chat = await l.composeContext('u1', 'chat');
      const automation = await l.composeContext('u1', 'automation');

      const names = (files: string[]) => files.map((f) => f.split('/').slice(-2, -1)[0]);

      expect(names(coding.eagerFiles)).toContain('coding-agent');
      expect(names(coding.eagerFiles)).not.toContain('chat-agent');
      expect(names(coding.eagerFiles)).not.toContain('automation-agent');
      // legal-spine is an on-demand coding package (Q-09): eligible for coding, cheap until loaded.
      expect(names(coding.onDemandFiles)).toContain('legal-spine');

      expect(names(chat.eagerFiles)).toEqual(['chat-agent']);
      expect(names(chat.onDemandFiles)).not.toContain('legal-spine');

      expect(names(automation.eagerFiles)).toEqual(['automation-agent']);
    });

    it('assembleAgentContext returns eager bodies as promptSections with a content version', async () => {
      const l = loader();
      const ctx = await l.assembleAgentContext({ agentKind: 'chat', userId: 'u1' });
      expect(ctx.contentVersion).toMatch(/^[0-9a-f]{64}$/);
      expect(ctx.promptSections.length).toBe(1);
      expect(ctx.promptSections[0]).toContain('Assistente');
      // Frontmatter is stripped from the prose handed to the prompt.
      expect(ctx.promptSections[0]).not.toContain('description:');
    });

    it('eager content stays inside the per-kind budget (felt-speed gate)', async () => {
      // Chars, not tokens (CI-stable): ~4 chars/token. Chat is the TTFT-relevant kind — its
      // eager budget guards the "agent feels quick" trait; the others guard drift. Raising a
      // budget is a deliberate decision, not a side effect of a content edit.
      const BUDGET_CHARS = { chat: 8_000, coding: 14_000, automation: 3_500 } as const;
      const l = loader();
      for (const kind of ['chat', 'coding', 'automation'] as const) {
        const ctx = await l.assembleAgentContext({ agentKind: kind, userId: 'u1' });
        const total = ctx.promptSections.reduce((n, s) => n + s.length, 0);
        expect(total, `${kind} eager content ${total} chars > budget ${BUDGET_CHARS[kind]}`).toBeLessThanOrEqual(BUDGET_CHARS[kind]);
      }
    });

    it('the composed chat content carries the marker vocabulary the pipeline strips (drift guard)', async () => {
      // The chat content teaches the EXACT markers agents/markers.ts matches; if the content
      // drifts to another spelling the delegation silently dies.
      const l = loader();
      const ctx = await l.assembleAgentContext({ agentKind: 'chat', userId: 'u1' });
      const body = ctx.promptSections.join('\n');
      expect(body).toContain('[[EKOA_BUILD]]');
      expect(body).toContain('[[EKOA_INTEGRATION_BUILD]]');
      expect(body).toContain('<ekoa-context>');
      expect(body).toContain('knowledge_search');
    });
  });
});
