/**
 * Frontend mirror of the cortex automation types. Kept in sync by hand
 * — when the cortex types change, update this file.
 *
 * Source of truth: cortex/src/automation/types.ts
 */

export type StepType =
  | 'browser'
  | 'verify'
  | 'integration'
  | 'sub_automation'
  | 'navigate'
  | 'wait'
  | 'local_command'
  | 'api_call'
  | 'ekoa_action';

export interface LocalCommandSpec {
  argv: string[];
  cwd?: string;
  timeoutMs?: number;
  stdin?: string;
  envWhitelist?: string[];
}

export type ApiCallMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
export type ApiCallBodyKind = 'json' | 'text' | 'form' | 'none';

export interface ApiCallSpec {
  method: ApiCallMethod;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  bodyKind?: ApiCallBodyKind;
  timeoutMs?: number;
  authIntegrationKey?: string;
}

export interface EkoaActionSpec {
  artifactSlug: string;
  capabilityName: string;
  inputs: Record<string, unknown>;
}

export interface Step {
  id: string;
  description: string;
  type: StepType;
  expectedOutcome?: string;

  // Type-discriminated extras
  url?: string;                            // navigate
  durationMs?: number;                     // wait
  integrationKey?: string;                 // integration
  integrationAction?: string;              // integration
  argsTemplate?: Record<string, string>;   // integration / sub_automation
  subAutomationId?: string;                // sub_automation
  commandTemplate?: LocalCommandSpec;      // local_command
  apiRequest?: ApiCallSpec;                // api_call
  ekoaAction?: EkoaActionSpec;             // ekoa_action
}

export interface AutomationInputField {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

export type AutomationTrigger =
  | { kind: 'manual' }
  | { kind: 'webhook'; triggerId: string; integrationKey: string; eventName: string }
  | { kind: 'listener'; triggerId: string; integrationKey: string; pollAction: string; pollIntervalMs: number };

export interface Automation {
  id: string;
  name: string;
  description: string;
  steps: Step[];
  inputSchema?: { fields: AutomationInputField[] };
  ownerUserId: string;
  trigger?: AutomationTrigger;
  /** Set by the integration provisioner when this automation was materialized from an integration template. */
  source?: { integrationKey: string; templateKey: string };
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Run records
// ============================================================================

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type StepTier = 'cache' | 'vision' | 'cache-then-vision';

export interface StepFeedback {
  kind: 'thumbs_up' | 'thumbs_down' | 'correction';
  note?: string;
  submittedAt: string;
}

export interface EkoaActionTraceEntry {
  op: string;
  summary: string;
  durationMs: number;
  status: 'ok' | 'failed';
  error?: string;
}

export type StepOutput =
  | {
      kind: 'local_command';
      stdout: string;
      stderr: string;
      exitCode: number | null;
      durationMs: number;
      truncated: boolean;
      timedOut: boolean;
    }
  | {
      kind: 'api_call';
      status: number;
      statusText?: string;
      responseHeaders: Record<string, string>;
      responseBody: string;
      responseBodyIsJson: boolean;
      truncated: boolean;
      durationMs: number;
    }
  | {
      kind: 'ekoa_action';
      trace: EkoaActionTraceEntry[];
      result: string;
      capturedValues: Record<string, unknown>;
      durationMs: number;
    };

export interface StepRecord {
  stepId: string;
  index: number;
  status: StepStatus;
  tier: StepTier;
  resolvedAction?: unknown;
  assertionResolved?: unknown;
  visionReasoning?: string;
  error?: { message: string; recoverable: boolean; details?: IntegrationErrorDetails | unknown };
  screenshotPath?: string;
  durationMs: number;
  feedback?: StepFeedback;
  output?: StepOutput;
}

export interface IntegrationErrorDetails {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response?: {
    status: number;
    statusText?: string;
    headers: Record<string, string>;
    body: string;
    bodyIsJson: boolean;
  };
  transportError?: string;
}

export type RunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_integration'
  | 'paused_for_user'
  | 'awaiting_consent'
  | 'awaiting_daemon';

export interface ConsentRequest {
  stepIndex: number;
  shape: string;
  argv: string[];
  description: string;
}

export interface DaemonRequest {
  stepIndex: number;
  capability: 'browser' | 'bash';
  reason: string;
}

export interface RunRecord {
  id: string;
  automationId: string;
  startedAt: string;
  endedAt?: string;
  status: RunStatus;
  inputs: Record<string, unknown>;
  steps: StepRecord[];
  triggeredBy: 'user' | 'agent' | 'webhook' | 'listener';
  parentRunId?: string;
  awaitingIntegration?: { service: string; reason: string };
  consentRequest?: ConsentRequest;
  daemonRequest?: DaemonRequest;
}

// ============================================================================
// Catalog
// ============================================================================

export interface AutomationCatalogEntry {
  id: string;
  name: string;
  description: string;
  inputs: Array<{ name: string; required: boolean; description: string }>;
  lastRunAt?: string;
  lastRunSucceeded?: boolean;
}

export interface IntegrationActionCatalogEntry {
  integrationKey: string;
  actionName: string;
  description: string;
  argsSummary: string;
  mutates: boolean;
}

// ============================================================================
// Live SSE event types
// ============================================================================

export interface AutomationRunStepEvent {
  type: 'automation_run_step';
  trace_id: string;
  runId: string;
  stepIndex: number;
  stepId: string;
  status: StepStatus;
  tier: StepTier;
  resolvedAction?: unknown;
  error?: string;
  errorDetails?: IntegrationErrorDetails | unknown;
  screenshotUrl?: string;
  output?: StepOutput;
  durationMs: number;
}

export interface AutomationRunCompleteEvent {
  type: 'automation_run_complete';
  trace_id: string;
  runId: string;
  durationMs: number;
  summary: string;
}

export interface AutomationRunErrorEvent {
  type: 'automation_run_error';
  trace_id: string;
  runId: string;
  error: string;
  partialResults: number;
}

export interface AutomationRunPausedEvent {
  type: 'automation_run_paused';
  trace_id: string;
  runId: string;
  reason: 'awaiting_integration';
  service: string;
}

export type FailureKind = 'verify_failed' | 'browser_failed' | 'navigate_failed' | 'integration_failed' | 'other';
export type PatchKind = 'insert_before' | 'replace_current' | 'skip_current' | 'abort';

export interface AutomationRunPatchEvent {
  type: 'automation_run_patch';
  trace_id: string;
  runId: string;
  stepIndex: number;
  phase: 'proposing' | 'applied' | 'aborted';
  failureKind?: FailureKind;
  failureMessage?: string;
  patchKind?: PatchKind;
  reasoning?: string;
  newStepDescription?: string;
  attemptNumber?: number;
}

export interface AutomationRunPauseForUserEvent {
  type: 'automation_run_pause_for_user';
  trace_id: string;
  runId: string;
  stepIndex: number;
  reasoning: string;
  userInstructions: string;
  failureMessage?: string;
  screenshotUrl?: string;
}

export interface AutomationRunResumedEvent {
  type: 'automation_run_resumed';
  trace_id: string;
  runId: string;
  stepIndex: number;
}

export interface AutomationRunStreamingAvailableEvent {
  type: 'automation_run_streaming_available';
  trace_id: string;
  runId: string;
  wsUrl: string;
  token: string;
  viewport: { width: number; height: number };
}

export type StreamingConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

export interface StreamingSession {
  token: string;
  wsUrl: string;
  viewport: { width: number; height: number };
  status: StreamingConnectionStatus;
}

export interface AutomationRunAwaitingConsentEvent {
  type: 'automation_run_awaiting_consent';
  trace_id: string;
  runId: string;
  stepIndex: number;
  shape: string;
  argv: string[];
  description: string;
}

export interface AutomationRunAwaitingDaemonEvent {
  type: 'automation_run_awaiting_daemon';
  trace_id: string;
  runId: string;
  stepIndex: number;
  capability: 'browser' | 'bash';
  reason: string;
}

export interface AutomationStepOutputChunkEvent {
  type: 'automation_step_output_chunk';
  trace_id: string;
  runId: string;
  stepIndex: number;
  stream: 'stdout' | 'stderr';
  chunk: string;
}

export type AutomationLiveEvent =
  | AutomationRunStepEvent
  | AutomationRunCompleteEvent
  | AutomationRunErrorEvent
  | AutomationRunPausedEvent
  | AutomationRunPatchEvent
  | AutomationRunPauseForUserEvent
  | AutomationRunResumedEvent
  | AutomationRunStreamingAvailableEvent
  | AutomationRunAwaitingConsentEvent
  | AutomationRunAwaitingDaemonEvent
  | AutomationStepOutputChunkEvent;
