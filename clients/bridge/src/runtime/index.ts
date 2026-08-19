export { DaemonRuntime, type DaemonRuntimeDeps, type TaskBinding } from './daemon-runtime.js';
export {
  executeToolInvocation,
  // The recorder's end-of-life hook and its observer. `serve.ts` binds the first to EVERY lease's
  // end (P2.2), so the live header values a capture held cannot outlive the session they came from.
  disposeNetworkRecorder,
  hasNetworkRecorder,
  type ToolExecutionResult,
  type ToolExecutorDeps,
} from './tool-executor.js';
export { OutboundRedactor } from './outbound-redactor.js';
export { SecretHold, type SecretHoldDeps } from './secret-hold.js';
