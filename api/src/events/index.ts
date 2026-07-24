/**
 * events/ public entry (ch02 §2.6): the push infrastructure — SSE manager, the durable
 * dedup event queue, and the trigger delivery pipeline. Delivery targets are injected at
 * the composition root; the pipeline start()s only after the HTTP server is listening.
 */
export { sseManager } from './sse-manager.js';
export {
  enqueue,
  claimNext,
  markDelivered,
  markFailed,
  markDead,
  recoverStuck,
  retryDelayMs,
  MAX_DELIVERY_ATTEMPTS,
  type QueuedEvent,
} from './queue.js';
export {
  startDelivery,
  stopDelivery,
  wakeDelivery,
  setDeliveryTargets,
  type DeliveryTargets,
  type DeliveryEvent,
  type DeliveryOutcome,
} from './delivery.js';
export {
  listTriggers,
  createTrigger,
  deleteTrigger,
  handleIngress,
  triggerView,
  hubChallenge,
  type TriggerDoc,
  type TriggerPollConfig,
  type IngressResult,
  type IngressOutcome,
} from './service.js';
export {
  readListenerCursor,
  writeListenerCursor,
  bumpListenerFailure,
  deleteListenerCursor,
  type ListenerStateDoc,
} from './listener-state.js';
export {
  ListenerSupervisor,
  enqueueListenerEvent,
  type ListenerSupervisorDeps,
  type SupervisorTrigger,
} from './listener-supervisor.js';
