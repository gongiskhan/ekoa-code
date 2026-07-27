/**
 * Pure mapping from a StepRecord to the `step` AutomationRunEvent wire payload (§3.6.3). Extracted
 * from server.ts's `makeRunSseEmitter` so the enrichment mapping is unit-testable WITHOUT the SSE
 * manager: the composition root's emitter stays a thin `sseManager.emit(...)` wrapper around this.
 *
 * The old cortex forwarded the same enrichment (handlers/automations-handler.ts) so the run UI can
 * render a step's outcome — screenshot, one-line error, tier, duration, non-browser output, and the
 * structured error `details` the IntegrationErrorPanel expands — without a follow-up fetch. Kept
 * lean: no a11y snapshots, no raw screenshot bytes (the served URL is a capability path).
 *
 * REDACTION (Cofre R-6). This module's header used to assert that error `details` "are already
 * redacted at the executor, so they forward verbatim". That was only ever true of the `api_call`
 * executor — every other step type (browser assertions, local_command, ekoa_action) reaches this
 * mapper unfiltered, and whatever it emits goes onto the SSE stream and into the persisted record.
 * The mapper therefore takes an OPTIONAL run-scoped `SecretRegistry`: when the run resolved
 * credentials, every free-text and structured field passes through it on the way out. Passing no
 * registry is the honest no-op for a run that touched no secrets.
 */
import type { StepRecord } from './types.js';
import { screenshotUrlFromPath } from './persistence.js';
import type { SecretRegistry } from '../security/redaction.js';

/** The shape emitted on the automation SSE stream as the `step` event's data (matches the OPTIONAL
 *  enrichment fields on shared/events.ts AutomationRunEvent → `step`). */
export interface AutomationStepEventPayload {
  runId: string;
  stepIndex: number;
  status: string;
  stepId?: string;
  tier?: string;
  error?: string;
  errorDetails?: unknown;
  screenshotUrl?: string;
  output?: unknown;
  durationMs?: number;
}

export function automationStepEventPayload(
  record: StepRecord,
  runId: string,
  secrets?: SecretRegistry,
): AutomationStepEventPayload {
  const screenshotUrl = screenshotUrlFromPath(record.screenshotPath);
  const text = (s: string): string => (secrets ? secrets.redact(s) : s);
  const tree = (v: unknown): unknown => (secrets ? secrets.redactDeep(v) : v);
  return {
    runId,
    stepIndex: record.index,
    status: record.status,
    ...(record.stepId ? { stepId: record.stepId } : {}),
    ...(record.tier ? { tier: record.tier } : {}),
    ...(record.error?.message ? { error: text(record.error.message) } : {}),
    ...(record.error?.details !== undefined ? { errorDetails: tree(record.error.details) } : {}),
    ...(screenshotUrl ? { screenshotUrl } : {}),
    ...(record.output !== undefined ? { output: tree(record.output) } : {}),
    ...(typeof record.durationMs === 'number' ? { durationMs: record.durationMs } : {}),
  };
}
