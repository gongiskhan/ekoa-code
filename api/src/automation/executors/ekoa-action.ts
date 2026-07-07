/**
 * Ekoa action step executor.
 *
 * Operates directly on an Ekoa-built artifact's data layer via the
 * platform-primitives interpreter. Reads the artifact's MANIFEST.md to
 * find the named capability, walks its recipe, and writes/reads to
 * appDataStore as the recipe directs.
 *
 * No browser, no app runtime spin-up — server-side direct calls.
 */

import type {
  Step,
  StepRecord,
  Automation,
  StepOutput,
  ResolvedAction,
  EkoaActionResolved,
} from '../types.js';
import type { RunContext } from '../engine.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  loadManifestFromFile,
  getCapability,
  ManifestParseError,
  type ArtifactManifest,
} from '../manifest-parser.js';
import {
  executeRecipe,
  EkoaActionFailure,
  setInvokeArtifactCapability,
  type EkoaActionContext,
} from '../platform-primitives.js';
import { interpolate } from '../template-vars.js';
import { resolveArtifactProjectDir as resolveArtifactSeam } from '../seams.js';

interface ExecuteEkoaActionArgs {
  step: Step;
  index: number;
  runId: string;
  automation: Automation;
  ctx: RunContext;
  inputs: Record<string, unknown>;
  baseRecord: StepRecord;
  stepStart: number;
  finishRecord: (
    base: StepRecord,
    status: StepRecord['status'],
    stepStart: number,
    extras: {
      tier?: StepRecord['tier'];
      resolvedAction?: ResolvedAction;
      error?: { message: string; recoverable: boolean; details?: unknown };
      output?: StepOutput;
    },
  ) => StepRecord;
}

export async function executeEkoaActionStep(args: ExecuteEkoaActionArgs): Promise<StepRecord> {
  const { step, ctx, inputs, baseRecord, stepStart, finishRecord } = args;

  const spec = step.ekoaAction;
  if (!spec || !spec.artifactSlug || !spec.capabilityName) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: `ekoa_action step ${step.id} missing ekoaAction.artifactSlug or .capabilityName`,
        recoverable: false,
      },
    });
  }

  // Resolve slug → app id → project dir
  const resolution = await resolveArtifactProjectDir(spec.artifactSlug);
  if (!resolution) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: `ekoa_action target artifact "${spec.artifactSlug}" not found — check the slug is correct and the artifact is built`,
        recoverable: false,
      },
    });
  }
  const { artifactId, projectDir } = resolution;

  // Load MANIFEST.md
  const manifestPath = join(projectDir, 'MANIFEST.md');
  let manifest: ArtifactManifest;
  if (!existsSync(manifestPath)) {
    // Lazy generation will happen separately (Phase 5 hooks). For now, fail with clear message.
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: `MANIFEST.md not found at ${manifestPath}. Ask the coding agent to generate a manifest for this artifact.`,
        recoverable: true,
      },
    });
  }
  try {
    manifest = loadManifestFromFile(manifestPath);
  } catch (err) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: err instanceof ManifestParseError ? err.message : `failed to load manifest: ${err instanceof Error ? err.message : String(err)}`,
        recoverable: false,
      },
    });
  }

  const capability = getCapability(manifest, spec.capabilityName);
  if (!capability) {
    const available = manifest.capabilities.map((c) => c.name).join(', ') || '(none)';
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: {
        message: `capability "${spec.capabilityName}" not found in ${manifest.name}. Available: ${available}`,
        recoverable: false,
      },
    });
  }

  // Merge step inputs with automation inputs — step-level overrides automation-level.
  const mergedInputs = { ...inputs, ...spec.inputs };

  // Execute recipe
  const actionCtx: EkoaActionContext = {
    userId: ctx.ownerUserId,
    artifactId,
    inputs: mergedInputs,
    captured: {},
    trace: [],
  };

  const execStart = Date.now();
  try {
    await executeRecipe(capability.recipe, actionCtx);
  } catch (err) {
    const message = err instanceof EkoaActionFailure ? err.message : (err instanceof Error ? err.message : String(err));
    const duration = Date.now() - execStart;
    const output: StepOutput = {
      kind: 'ekoa_action',
      trace: actionCtx.trace,
      result: `failed: ${message}`,
      capturedValues: actionCtx.captured,
      durationMs: duration,
    };
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache',
      error: { message, recoverable: !(err instanceof EkoaActionFailure) || true },
      output,
      resolvedAction: makeResolved(artifactId, capability.name, capability.recipe, manifest.revision),
    });
  }

  const duration = Date.now() - execStart;
  const result = renderResultTemplate(capability.result_template, mergedInputs, actionCtx.captured);

  const output: StepOutput = {
    kind: 'ekoa_action',
    trace: actionCtx.trace,
    result,
    capturedValues: actionCtx.captured,
    durationMs: duration,
  };

  return finishRecord(baseRecord, 'completed', stepStart, {
    tier: 'cache',
    output,
    resolvedAction: makeResolved(artifactId, capability.name, capability.recipe, manifest.revision),
  });
}

function makeResolved(
  artifactId: string,
  capabilityName: string,
  recipeSnapshot: unknown[],
  revision: string,
): EkoaActionResolved {
  return { kind: 'ekoa_action', artifactId, capabilityName, recipeSnapshot, manifestRev: revision };
}

function renderResultTemplate(
  template: string | undefined,
  inputs: Record<string, unknown>,
  captured: Record<string, unknown>,
): string {
  if (!template) return 'ekoa_action completed';
  // Pre-process: replace {{captured.x.field}} with deep lookup before passing to interpolate
  let out = template;
  out = out.replace(/\{\{\s*captured\.([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\s*\}\}/g, (_match, path: string) => {
    const parts = path.split('.');
    const root = parts[0]!;
    let val: unknown = captured[root];
    for (let i = 1; i < parts.length; i++) {
      if (val == null || typeof val !== 'object') { val = undefined; break; }
      val = (val as Record<string, unknown>)[parts[i]!];
    }
    return val == null ? '' : String(val);
  });
  return interpolate(out, inputs, Object.fromEntries(Object.entries(captured).map(([k, v]) => [k, v == null ? '' : String(v)])));
}

export interface ResolveArtifactResult {
  artifactId: string;
  projectDir: string;
}

export function resolveArtifactProjectDir(slugOrId: string): Promise<ResolveArtifactResult | null> {
  return resolveArtifactSeam(slugOrId);
}

// Wire artifact.invoke primitive to recursive ekoa_action execution.
// Resolves another artifact's capability and runs its recipe in-process.
setInvokeArtifactCapability(async (slug, capabilityName, inputs, userId) => {
  const resolution = await resolveArtifactProjectDir(slug);
  if (!resolution) throw new EkoaActionFailure(`artifact.invoke: artifact "${slug}" not found`);
  const manifestPath = join(resolution.projectDir, 'MANIFEST.md');
  if (!existsSync(manifestPath)) throw new EkoaActionFailure(`artifact.invoke: MANIFEST.md missing for ${slug}`);
  const manifest = loadManifestFromFile(manifestPath);
  const cap = getCapability(manifest, capabilityName);
  if (!cap) throw new EkoaActionFailure(`artifact.invoke: capability "${capabilityName}" not in ${slug}`);
  const subCtx: EkoaActionContext = {
    userId,
    artifactId: resolution.artifactId,
    inputs,
    captured: {},
    trace: [],
  };
  await executeRecipe(cap.recipe, subCtx);
  return subCtx.captured;
});
