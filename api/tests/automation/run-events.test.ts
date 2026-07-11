import { describe, it, expect } from 'vitest';
import { automationStepEventPayload } from '../../src/automation/run-events.js';
import { AutomationRunEvent } from '@ekoa/shared';
import type { StepRecord } from '../../src/automation/types.js';

/**
 * The `step` SSE enrichment mapping (§3.6.3). The composition root's emitter is a thin
 * `sseManager.emit('step', automationStepEventPayload(record, id))`, so this unit test pins the
 * StepRecord → wire-payload contract the run UI depends on: the disk `screenshotPath` becomes a
 * served `/automation-screenshots/...` capability URL, the structured error collapses to a one-line
 * string, and the enrichment fields are present only when the record carries them.
 */
describe('automationStepEventPayload (§3.6.3 step enrichment)', () => {
  it('maps a rich StepRecord to the enriched step payload (screenshotPath → screenshotUrl, error + details)', () => {
    // `details` is the already-redacted + length-bounded structure the executor produced; the mapper
    // forwards it verbatim (the IntegrationErrorPanel expands it live). Redaction is the executor's
    // job — proven by api/tests/automation/api-call-redaction.test.ts — not the mapper's.
    const details = { request: { method: 'POST', url: 'https://api.example.com/send' }, response: { status: 500, body: '<redacted>' } };
    const record: StepRecord = {
      stepId: 's1',
      index: 3,
      status: 'failed',
      tier: 'vision',
      durationMs: 1234,
      screenshotPath: 'automation-runs/auto-1/run-9/step-3.png',
      error: { message: 'outcome not met: a página não corresponde', recoverable: true, details },
      output: { kind: 'api_call', status: 500, responseHeaders: {}, responseBody: '{}', responseBodyIsJson: true, truncated: false, durationMs: 5 },
    };

    const payload = automationStepEventPayload(record, 'run-9');

    expect(payload.runId).toBe('run-9');
    expect(payload.stepIndex).toBe(3);
    expect(payload.status).toBe('failed');
    expect(payload.stepId).toBe('s1');
    expect(payload.tier).toBe('vision');
    expect(payload.durationMs).toBe(1234);
    // The capability URL drops the `automation-runs/` prefix (the static plane roots there).
    expect(payload.screenshotUrl).toBe('/automation-screenshots/auto-1/run-9/step-3.png');
    // The structured error is flattened to a one-line message; the panel payload rides errorDetails.
    expect(payload.error).toBe('outcome not met: a página não corresponde');
    expect(payload.errorDetails).toEqual(details);
    expect(payload.output).toEqual(record.output);
  });

  it('omits enrichment fields a lean StepRecord does not carry', () => {
    const record: StepRecord = { stepId: 's1', index: 0, status: 'completed', tier: 'cache', durationMs: 12 };
    const payload = automationStepEventPayload(record, 'run-1');
    expect(payload).not.toHaveProperty('screenshotUrl');
    expect(payload).not.toHaveProperty('error');
    expect(payload).not.toHaveProperty('errorDetails');
    expect(payload).not.toHaveProperty('output');
    expect(payload.status).toBe('completed');
  });

  it('omits errorDetails when the step failed without structured details', () => {
    const record: StepRecord = {
      stepId: 's1', index: 0, status: 'failed', tier: 'vision', durationMs: 8,
      error: { message: 'captura de ecrã indisponível', recoverable: true },
    };
    const payload = automationStepEventPayload(record, 'run-1');
    expect(payload.error).toBe('captura de ecrã indisponível');
    expect(payload).not.toHaveProperty('errorDetails');
  });

  it('the mapped payload validates as the shared AutomationRunEvent `step` member', () => {
    const record: StepRecord = {
      stepId: 's1', index: 1, status: 'completed', tier: 'cache', durationMs: 40,
      screenshotPath: 'automation-runs/a/r/step-1.png',
    };
    const evt = { type: 'step', ...automationStepEventPayload(record, 'r') };
    const parsed = AutomationRunEvent.safeParse(evt);
    expect(parsed.success).toBe(true);
  });
});
