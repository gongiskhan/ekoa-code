/**
 * Real build mechanics over the ch07 (G6) app pipeline — the heavy work `agents/` invokes but
 * does not own (ch05 §5.6.2, ch07 §7.2/§7.3/§7.4). Wired at the composition root via
 * `setBuildMechanics`; imported ONLY by server.ts.
 *
 * The shape mirrors the `BuildMechanics` seam in `agents/seams.ts` structurally — this module
 * does NOT import `agents/` (tier direction, ch02 §2.7): the composition root binds the object
 * to the seam, and server.ts's `setBuildMechanics` call is where the shapes are type-checked
 * (the same structural-binding pattern content/ uses for `assembleAgentContext`). apps/ MAY
 * import data/ (store access) — done the way artifacts-service.ts does it.
 */
import { rm, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { artifacts, slugs, users } from '../data/stores.js';
import { generateSlug, type ArtifactDoc } from './artifacts-service.js';
import { newProjectDir, projectDirFor, patchArtifactData } from './app-paths.js';
import { indexSlug } from './slug-index.js';
import { scaffoldApp } from './scaffold.js';
import { appBuilder, validateBundle } from './builder.js';
import { appRegistry } from './app-registry.js';
import { readManifest, writeManifest } from './manifest.js';
import { loadBase, baseProjectFiles, isBaseId, type LoadedBase } from './base-loader.js';
import { readUiActions } from './action-manifest.js';
import { classifyArtifactType, baseForType, typeForBase } from './artifact-type.js';
import type { ArtifactType } from '@ekoa/shared';
import { commitSnapshot, SecretCommitError } from '../services/commit-guard.js';
import { captureArtifactScreenshot } from '../services/artifact-screenshot.js';

export interface BuildMechanicsDeps {
  now: () => number;
  genId: () => string;
}

const execFileAsync = promisify(execFile);

/** Content fingerprints of the Ekoa scaffold placeholder (assets/scaffold-templates/App.jsx).
 *  A built output still carrying any of these is serving the scaffold, not the user's app. */
const SCAFFOLD_MARKERS = ['scaffold-root', "Let's build something that will change", 'Powered by Ekoa'] as const;

/**
 * Build the real BuildMechanics over the G6 pipeline. A factory because the mechanics need the
 * runtime `deps` (id + clock) the composition root owns — the same deps every domain router gets.
 */
export function createBuildMechanics(deps: BuildMechanicsDeps) {
  /** Resolve a user's org (private artifacts still carry orgId for tenancy). Best-effort: an
   *  unresolved user yields '' rather than failing the build. The seam does not thread orgId
   *  (it passes only userId), so the composition root resolves it here — a documented adapter. */
  async function orgIdFor(userId: string): Promise<string> {
    try {
      return (await users.get(userId))?.orgId ?? '';
    } catch {
      return '';
    }
  }

  /** First-line-derived app name for the artifact + deterministic slug seed. */
  function deriveAppName(description: string): string {
    const firstLine = (description.split('\n')[0] ?? '').replace(/\s+/g, ' ').trim().slice(0, 60).trim();
    return firstLine || 'App';
  }

  /**
   * Resolve the internal base + artifact type a first build scaffolds from.
   * B1: an EXPLICIT `templateId` naming a base wins (a known-but-broken base fails
   * LOUD; an unknown id warns and falls through to classification — featured ids
   * also travel this field historically). C1: with no explicit selection, the
   * scoping classifier decides the artifact type (deterministic signals first,
   * FAST chokepoint one-shot on ambiguity, `app` on any failure) and the type's
   * base scaffolds the build. Only a base that fails to LOAD after classification
   * degrades to the generic starters (warned, never silent).
   */
  async function baseFor(
    templateId: string | undefined,
    description: string,
    userId: string,
  ): Promise<{ base: LoadedBase | null; artifactType: ArtifactType }> {
    if (templateId && isBaseId(templateId)) {
      const base = await loadBase(templateId); // explicit selection: broken base fails loud
      return { base, artifactType: typeForBase(base.id) };
    }
    if (templateId) {
      console.warn(`[build-mechanics] templateId "${templateId}" names no internal base; classifying instead`);
    }
    const artifactType = await classifyArtifactType(description, userId);
    try {
      return { base: await loadBase(baseForType(artifactType)), artifactType };
    } catch (err) {
      console.warn(`[build-mechanics] base "${baseForType(artifactType)}" failed to load; generic starters:`, err instanceof Error ? err.message : err);
      return { base: null, artifactType };
    }
  }

  /** Load the base an existing artifact extends (manifest `extends`) for follow-up
   *  prompt injection. Non-fatal: a missing/invalid manifest or base yields null. */
  async function baseOfProject(projectDir: string): Promise<LoadedBase | null> {
    try {
      const m = await readManifest(projectDir);
      if (!m?.extends || !isBaseId(m.extends)) return null;
      return await loadBase(m.extends);
    } catch (err) {
      console.warn('[build-mechanics] base of project failed to load (non-fatal):', err instanceof Error ? err.message : err);
      return null;
    }
  }

  /** Resolve the artifact's build output dir (manifest.outputDir, default `dist/`). */
  async function distDirOf(projectDir: string): Promise<string> {
    let outputDir = 'dist';
    try {
      const m = await readManifest(projectDir);
      if (m?.outputDir) outputDir = m.outputDir;
    } catch {
      /* invalid/absent manifest — the default dist/ is correct */
    }
    return join(projectDir, outputDir);
  }

  /** IIFE bundle-format check (ch07 §7.2.3), with the plain-HTML exception: a plain-HTML app
   *  (§7.2.1) emits no `bundle.js`, so a served `index.html` with no bundle is a valid build. */
  async function bundleValid(distDir: string): Promise<{ ok: boolean; error?: string }> {
    const v = await validateBundle(distDir);
    if (v.valid) return { ok: true };
    if (existsSync(join(distDir, 'index.html')) && !existsSync(join(distDir, 'bundle.js'))) {
      return { ok: true };
    }
    return { ok: false, error: v.error };
  }

  return {
    /**
     * First build (ch05 §5.6.2 first-build branch, ch07 §7.3/§7.4 trigger 1): create the draft
     * artifact with its session + project-dir linkage in the data bag, scaffold the app tree, run
     * the immediate initial build + watch (non-fatal — the agent will fix the code), and register
     * it so the preview is live before the agent runs.
     */
    async prepareFirstBuild(input: {
      userId: string;
      sessionId: string;
      description: string;
      language: string;
      templateId?: string;
    }): Promise<{ artifactId: string; projectDir: string; slug: string; appUrl: string; basePromptSections?: string[] }> {
      const { base, artifactType } = await baseFor(input.templateId, input.description, input.userId);
      const artifactId = deps.genId();
      const name = deriveAppName(input.description);
      const slug = await generateSlug(name, deps);
      // Point the reservation at the new artifact and keep the in-memory serving index current
      // (the same two-step artifacts-service.createArtifact performs, ch07 §7.8).
      await slugs.put({ _id: slug, artifactId });
      indexSlug(slug, artifactId);

      const projectDir = newProjectDir(input.userId, artifactId);
      const appUrl = `/apps/${artifactId}/`;
      const orgId = await orgIdFor(input.userId);

      const doc: ArtifactDoc = {
        _id: artifactId,
        name,
        slug,
        userId: input.userId,
        orgId,
        visibility: 'private',
        status: 'draft',
        // artifactType (C1): the scoping classifier's verdict — the operator surface
        // exists only for 'app' artifacts (downstream slices read this, never re-classify).
        data: { projectDir, appUrl, sessionId: input.sessionId, artifactType },
      };
      await artifacts.insert(doc as never);

      await scaffoldApp({
        appId: artifactId,
        name,
        projectDir,
        description: input.description,
        ...(base ? { templateScaffoldFiles: baseProjectFiles(base) } : {}),
      });
      // Persist the base linkage (manifest `extends`) so follow-up builds and the
      // per-build base-manifest verification know which base this artifact is on.
      if (base) {
        const m = await readManifest(projectDir);
        if (m) {
          m.extends = base.id;
          await writeManifest(projectDir, m);
        }
      }
      // Trigger 1: initial build + watch, before the agent starts. A failure here is non-fatal.
      try {
        await appBuilder.build(artifactId, projectDir);
        await appBuilder.watch(artifactId, projectDir);
      } catch (err) {
        console.warn(`[build-mechanics] ${artifactId}: initial build/watch failed (non-fatal):`, err instanceof Error ? err.message : err);
      }
      await appRegistry.register(artifactId, projectDir, input.userId, name);

      return { artifactId, projectDir, slug, appUrl, ...(base ? { basePromptSections: base.promptSections } : {}) };
    },

    /** Follow-up resolution (ch05 §5.3.5, §5.4.5): the artifact record → its project dir, the
     *  SDK session id to resume with, and its existing slug + served URL (follow-up completion
     *  re-activates with these — carrying '' through blanked the slug on every follow-up).
     *  Null when the artifact is gone. */
    async resolveFollowUp(artifactId: string): Promise<{ projectDir: string; resumeSessionId?: string; slug: string; appUrl: string; basePromptSections?: string[] } | null> {
      const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
      if (!art) return null;
      const projectDir = projectDirFor(art);
      const data = (art.data as Record<string, unknown> | undefined) ?? {};
      const resumeSessionId = typeof data.sdkSessionId === 'string' ? data.sdkSessionId : undefined;
      const appUrl = typeof data.appUrl === 'string' && data.appUrl ? data.appUrl : `/apps/${artifactId}/`;
      const base = await baseOfProject(projectDir);
      return {
        projectDir,
        ...(resumeSessionId ? { resumeSessionId } : {}),
        slug: art.slug ?? '',
        appUrl,
        ...(base ? { basePromptSections: base.promptSections } : {}),
      };
    },

    /**
     * Final bundle (ch05 §5.6.2 step 2, ch07 §7.4 trigger 3): stop the watcher FIRST (concurrent
     * esbuild ops on the shared service crash it), wipe output, then build up to 2 attempts, each
     * validated by the IIFE bundle-format check. Returns an honest error note on failure.
     */
    async finalizeBundle(input: { artifactId: string; projectDir: string }): Promise<{ ok: boolean; error?: string }> {
      await appBuilder.unwatch(input.artifactId);
      const distDir = await distDirOf(input.projectDir);
      let lastError: string | undefined;
      for (let attempt = 1; attempt <= 2; attempt++) {
        await rm(distDir, { recursive: true, force: true });
        const result = await appBuilder.build(input.artifactId, input.projectDir);
        if (!result.success) {
          lastError = result.errors.join('; ') || 'A compilação final falhou.';
          continue;
        }
        const valid = await bundleValid(distDir);
        if (valid.ok) return { ok: true };
        lastError = valid.error ?? 'O pacote final não passou a validação de formato.';
      }
      return { ok: false, error: lastError ?? 'A compilação final falhou.' };
    },

    /**
     * Version snapshot (ch05 §5.6.2 step 3, ch07 §7.9) through the shared per-repo lock. A broken
     * final build is committed tagged `[build-failed]` (users may revert FROM a broken version).
     * The secret-commit guard BLOCKS loudly (throws, with an audit row) — that must reach the
     * pipeline; any other git hiccup is best-effort and never fails an otherwise-good build.
     */
    async snapshot(input: { artifactId: string; projectDir: string; broken: boolean }): Promise<void> {
      const art = (await artifacts.get(input.artifactId)) as ArtifactDoc | null;
      const userId = art?.userId ?? '';
      const username = (userId ? (await users.get(userId))?.username : undefined) || userId || 'ekoa-agent';
      try {
        await commitSnapshot({
          projectDir: input.projectDir,
          message: input.broken ? 'Build failed' : 'Build',
          authorName: username,
          authorEmail: `${userId || 'agent'}@ekoa.local`,
          buildFailed: input.broken,
          ...(userId && art
            ? { audit: { actor: { userId, username, orgId: art.orgId }, deps } }
            : {}),
        });
      } catch (err) {
        if (err instanceof SecretCommitError) throw err; // loud block, ch07 §7.9
        console.warn(`[build-mechanics] ${input.artifactId}: version snapshot failed (non-fatal):`, err instanceof Error ? err.message : err);
      }
    },

    /** Fire-and-forget screenshot (ch05 §5.6.2 step 8; ch07 §7.11). Same discipline as the
     *  featured-builder capture: never fails the run, EKOA_SCREENSHOTS_DISABLED=1 skips
     *  entirely (headless CI / tests). */
    screenshot(artifactId: string): void {
      if (process.env.EKOA_SCREENSHOTS_DISABLED === '1') return;
      void captureArtifactScreenshot(artifactId).catch((err) => {
        console.warn(
          `[build-mechanics] ${artifactId}: screenshot capture failed (non-fatal):`,
          err instanceof Error ? err.message : err,
        );
      });
    },

    /** Persist the SDK session id onto the artifact data bag ONLY when it changed (ch05 §5.4.5). */
    async persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void> {
      const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
      const current = (art?.data as Record<string, unknown> | undefined)?.sdkSessionId;
      if (current === sdkSessionId) return;
      await patchArtifactData(artifactId, { sdkSessionId });
    },

    /** (Re)start the incremental watcher with a rebuild callback (ch07 §7.4 trigger 2) — the
     *  live-preview heartbeat: appBuilder.watch is idempotent (disposes any prior context), so
     *  this cleanly replaces the callback-less watcher prepareFirstBuild started, and gives
     *  FOLLOW-UP builds (which historically ran with no watcher at all) a live preview too.
     *  Non-fatal like the initial watch — the final bundle still happens at completion. */
    async watchRebuilds(input: { artifactId: string; projectDir: string; onRebuild: () => void }): Promise<void> {
      try {
        await appBuilder.watch(input.artifactId, input.projectDir, input.onRebuild);
      } catch (err) {
        console.warn(`[build-mechanics] ${input.artifactId}: watch-for-preview failed (non-fatal):`, err instanceof Error ? err.message : err);
      }
    },

    /** Activate the artifact with a MERGE onto its existing data bag (ch05 §5.6.2 step 7): a
     *  wholesale replace historically dropped customization + lineage fields. */
    async activateArtifact(input: { artifactId: string; slug: string; appUrl: string; projectDir?: string }): Promise<void> {
      // operator-run C2: capture the app's declared UI action manifest (the operate
      // contract) at activation. Valid → persisted for the assistant/tools; invalid →
      // the ERROR is persisted so the failure is visible (fail-loud) without failing
      // an otherwise working build; absent → both keys cleared (a re-build that
      // removed the section removes the operator surface).
      let uiActions: { actionManifest?: unknown; actionManifestError?: string } = {};
      if (input.projectDir) {
        try {
          const res = await readUiActions(input.projectDir);
          if (res.status === 'valid') uiActions = { actionManifest: res.manifest };
          else if (res.status === 'invalid') {
            console.warn(`[build-mechanics] ${input.artifactId}: ui_actions invalid — ${res.error}`);
            uiActions = { actionManifestError: res.error };
          }
        } catch (err) {
          console.warn(`[build-mechanics] ${input.artifactId}: ui_actions read failed (non-fatal):`, err instanceof Error ? err.message : err);
        }
      }
      await artifacts.update(input.artifactId, (a) => {
        const prev = { ...((a.data as Record<string, unknown> | undefined) ?? {}) };
        delete prev.actionManifest;
        delete prev.actionManifestError;
        const data = { ...prev, appUrl: input.appUrl, ...uiActions };
        return { ...a, status: 'active', slug: input.slug, data };
      });
    },

    /**
     * Honest-completion gate (F16, ch05 §5.6.2 step 5a). Three deterministic signals over the
     * project tree the moment the completion sequence runs:
     *   1. entrypoint-untouched — `git diff` from the scaffold baseline (the repo ROOT commit,
     *      "Initial scaffold", scaffold.ts seedGit) to the WORKING TREE shows no change under
     *      `frontend/src/`;
     *   2. scaffold-fingerprinted output — the built `dist/bundle.js` (or, for a plain-HTML app,
     *      `dist/index.html`) still carries a scaffold marker;
     *   3. orphan top-level HTML — a `*.html` other than `index.html` at the project root (the
     *      builder never serves those; builder.ts entry resolution).
     * NOT clean when 1 or 2 holds (3 sharpens the reason). Infra hiccups (no git, unreadable
     * dist) degrade that signal to "no evidence" rather than failing the build on gate plumbing —
     * the gate exists to catch the model's miss, never to fabricate one.
     */
    async assertProgress(input: { artifactId: string; projectDir: string }): Promise<{ clean: boolean; reasons: string[] }> {
      const reasons: string[] = [];

      // Signal 1: entrypoint subtree unchanged vs the scaffold baseline (root commit).
      let entrypointUntouched = false;
      try {
        const { stdout: root } = await execFileAsync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: input.projectDir });
        const base = root.trim().split('\n')[0];
        if (base) {
          const { stdout: diff } = await execFileAsync('git', ['diff', '--name-only', base, '--', 'frontend/src'], { cwd: input.projectDir });
          entrypointUntouched = diff.trim() === '';
        }
      } catch {
        /* no git / no baseline: no evidence either way — rely on the output fingerprint */
      }

      // Signal 2: built output still fingerprints as the scaffold. Also note whether the app is
      // still a BUNDLE app — a valid plain-HTML app (§7.2.1: served index, no bundle.js) never
      // touches frontend/src, so signal 1 only applies while a bundle is what is served.
      let outputIsScaffold = false;
      let bundleExists = false;
      try {
        const distDir = await distDirOf(input.projectDir);
        const bundlePath = join(distDir, 'bundle.js');
        const htmlPath = join(distDir, 'index.html');
        bundleExists = existsSync(bundlePath);
        const target = bundleExists ? bundlePath : existsSync(htmlPath) ? htmlPath : null;
        if (target) {
          const content = await readFile(target, 'utf-8');
          outputIsScaffold = SCAFFOLD_MARKERS.some((m) => content.includes(m));
        }
      } catch {
        /* unreadable output: no evidence */
      }

      // Signal 1b (operator-run B3): base-built artifact whose base-manifest mustEdit files are
      // untouched vs the scaffold baseline. The base shell is pixel-tested and looks plausible
      // served as-is, so the generic scaffold markers (signal 2) never fire on it — this is the
      // per-base refinement that closes the F16/F28 class for base-built apps.
      const baseUntouched: string[] = [];
      try {
        const projectBase = await baseOfProject(input.projectDir);
        const mustEdit = projectBase?.manifest.mustEdit ?? [];
        if (mustEdit.length > 0) {
          const { stdout: root } = await execFileAsync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd: input.projectDir });
          const baseCommit = root.trim().split('\n')[0];
          if (baseCommit) {
            const { stdout: diff } = await execFileAsync('git', ['diff', '--name-only', baseCommit, '--'], { cwd: input.projectDir });
            const changed = new Set(diff.trim().split('\n').filter(Boolean));
            for (const path of mustEdit) {
              if (!changed.has(path)) baseUntouched.push(path);
            }
          }
        }
      } catch {
        /* no git / unreadable manifest: no evidence either way */
      }

      // Signal 3: orphan top-level HTML (the classic miss: the real app written where it is never served).
      let orphanHtml: string[] = [];
      try {
        const entries = await readdir(input.projectDir, { withFileTypes: true });
        orphanHtml = entries
          .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.html') && e.name.toLowerCase() !== 'index.html')
          .map((e) => e.name);
      } catch {
        /* unreadable root: no evidence */
      }

      const entrypointSignal = entrypointUntouched && bundleExists;
      if (entrypointSignal) reasons.push('frontend/src está inalterado desde o modelo inicial');
      if (outputIsScaffold) reasons.push('a aplicação compilada continua o modelo Ekoa');
      if (baseUntouched.length > 0) {
        reasons.push(`ficheiro(s) do modelo interno por preencher: ${baseUntouched.join(', ')}`);
      }
      if (orphanHtml.length > 0 && (entrypointSignal || outputIsScaffold || baseUntouched.length > 0)) {
        reasons.push(`ficheiro(s) HTML solto(s) na raiz nunca servidos: ${orphanHtml.join(', ')}`);
      }

      return { clean: !entrypointSignal && !outputIsScaffold && baseUntouched.length === 0, reasons };
    },
  };
}
