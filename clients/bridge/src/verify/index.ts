/**
 * verify/index.ts — barrel for the ordered S2 task-binding verification. The engine imports
 * `verifyDelegatedTask` and passes a `DenialSink` that ledgers each denial (S3 itself is fs-free).
 */
export { verifyDelegatedTask } from './verify-task.js';
export type { Denial, DenialSink, VerifyContext } from './verify-task.js';
