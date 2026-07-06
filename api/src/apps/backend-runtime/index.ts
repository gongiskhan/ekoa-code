/**
 * Artifact backend runtime (Layer 2, B19) public surface. Re-exports the runtime
 * contract + the trigger-delivery seam the composition root hands to events/
 * (ch02 §2.8): events/ never imports apps/ - it receives `invokeArtifactBackend`
 * as an injected typed callback.
 */
import { getArtifactBackendRuntime, type InvokeOptions, type InvokeResult } from './runtime.js';
import { projectDirFor } from '../app-paths.js';
import { readManifest } from '../manifest.js';
import type { ArtifactDoc } from '../artifacts-service.js';

export * from './runtime.js';
export {
  mintCapabilityToken,
  verifyCapabilityToken,
  unavailableModelCapability,
  type CapabilityDeps,
  type CapabilityClaims,
  type ModelCapability,
  type DryRunEffect,
} from './handle-rpc.js';

/**
 * Trigger-delivery seam (ch02 §2.8): the typed invoke the composition root injects
 * into events/ so a webhook/listener can dispatch to an artifact backend WITHOUT
 * events/ importing apps/. Delegates to the process-wide runtime.
 */
export function invokeArtifactBackend(
  artifactId: string,
  entrypoint: string,
  input: unknown,
  opts?: InvokeOptions,
): Promise<InvokeResult> {
  return getArtifactBackendRuntime().invoke(artifactId, entrypoint, input, opts);
}

/** The backend declared in an artifact's manifest (entryPoint + handlers), or null. */
export async function readDeclaredBackend(art: ArtifactDoc): Promise<{ entryPoint: string; handlers: string[] } | null> {
  try {
    const manifest = await readManifest(projectDirFor(art));
    return manifest?.backend ?? null;
  } catch {
    return null;
  }
}
