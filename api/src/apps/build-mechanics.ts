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
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { artifacts, slugs, users } from '../data/stores.js';
import { generateSlug, type ArtifactDoc } from './artifacts-service.js';
import { newProjectDir, projectDirFor, patchArtifactData } from './app-paths.js';
import { indexSlug } from './slug-index.js';
import { scaffoldApp } from './scaffold.js';
import { appBuilder, validateBundle } from './builder.js';
import { appRegistry } from './app-registry.js';
import { readManifest } from './manifest.js';
import { commitSnapshot, SecretCommitError } from '../services/commit-guard.js';

export interface BuildMechanicsDeps {
  now: () => number;
  genId: () => string;
}

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
    }): Promise<{ artifactId: string; projectDir: string; slug: string; appUrl: string }> {
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
        data: { projectDir, appUrl, sessionId: input.sessionId },
      };
      await artifacts.insert(doc as never);

      await scaffoldApp({ appId: artifactId, name, projectDir, description: input.description });
      // Trigger 1: initial build + watch, before the agent starts. A failure here is non-fatal.
      try {
        await appBuilder.build(artifactId, projectDir);
        await appBuilder.watch(artifactId, projectDir);
      } catch (err) {
        console.warn(`[build-mechanics] ${artifactId}: initial build/watch failed (non-fatal):`, err instanceof Error ? err.message : err);
      }
      await appRegistry.register(artifactId, projectDir, input.userId, name);

      return { artifactId, projectDir, slug, appUrl };
    },

    /** Follow-up resolution (ch05 §5.3.5, §5.4.5): the artifact record → its project dir and the
     *  SDK session id to resume with. Null when the artifact is gone. */
    async resolveFollowUp(artifactId: string): Promise<{ projectDir: string; resumeSessionId?: string } | null> {
      const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
      if (!art) return null;
      const projectDir = projectDirFor(art);
      const data = (art.data as Record<string, unknown> | undefined) ?? {};
      const resumeSessionId = typeof data.sdkSessionId === 'string' ? data.sdkSessionId : undefined;
      return { projectDir, ...(resumeSessionId ? { resumeSessionId } : {}) };
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

    /** Fire-and-forget screenshot (ch05 §5.6.2 step 8). Honest no-op: the screenshot machinery is
     *  not built in G7B — no fake PNG is produced. */
    screenshot(_artifactId: string): void {
      /* not built in G7B — see RUN_LOG */
    },

    /** Persist the SDK session id onto the artifact data bag ONLY when it changed (ch05 §5.4.5). */
    async persistSdkSessionId(artifactId: string, sdkSessionId: string): Promise<void> {
      const art = (await artifacts.get(artifactId)) as ArtifactDoc | null;
      const current = (art?.data as Record<string, unknown> | undefined)?.sdkSessionId;
      if (current === sdkSessionId) return;
      await patchArtifactData(artifactId, { sdkSessionId });
    },

    /** Activate the artifact with a MERGE onto its existing data bag (ch05 §5.6.2 step 7): a
     *  wholesale replace historically dropped customization + lineage fields. */
    async activateArtifact(input: { artifactId: string; slug: string; appUrl: string }): Promise<void> {
      await artifacts.update(input.artifactId, (a) => {
        const data = { ...((a.data as Record<string, unknown> | undefined) ?? {}), appUrl: input.appUrl };
        return { ...a, status: 'active', slug: input.slug, data };
      });
    },
  };
}
