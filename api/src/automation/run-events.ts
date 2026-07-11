/**
 * Pure mapping from a StepRecord to the `step` AutomationRunEvent wire payload (§3.6.3). Extracted
 * from server.ts's `makeRunSseEmitter` so the enrichment mapping is unit-testable WITHOUT the SSE
 * manager: the composition root's emitter stays a thin `sseManager.emit(...)` wrapper around this.
 *
 * The old cortex forwarded the same enrichment (handlers/automations-handler.ts) so the run UI can
 * render a step's outcome — screenshot, one-line error, tier, duration, non-browser output, and the
 * structured error `details` the IntegrationErrorPanel expands — without a follow-up fetch. Kept
 * lean: no a11y snapshots, no raw screenshot bytes (the served URL is a capability path). The
 * error `details` are already redacted + length-bounded at the executor, so they forward verbatim.
 */
import type { StepRecord } from './types.js';
import { screenshotUrlFromPath } from './persistence.js';

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

export function automationStepEventPayload(record: StepRecord, runId: string): AutomationStepEventPayload {
  const screenshotUrl = screenshotUrlFromPath(record.screenshotPath);
  return {
    runId,
    stepIndex: record.index,
    status: record.status,
    ...(record.stepId ? { stepId: record.stepId } : {}),
    ...(record.tier ? { tier: record.tier } : {}),
    ...(record.error?.message ? { error: record.error.message } : {}),
    ...(record.error?.details !== undefined ? { errorDetails: record.error.details } : {}),
    ...(screenshotUrl ? { screenshotUrl } : {}),
    ...(record.output !== undefined ? { output: record.output } : {}),
    ...(typeof record.durationMs === 'number' ? { durationMs: record.durationMs } : {}),
  };
}
