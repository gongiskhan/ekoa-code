/**
 * schedules/ public entry — the tier-4 timer rail (one-time + recurring runs of a target with
 * fixed params; targets execute through seams injected at the composition root).
 */
export {
  configureScheduleSupervisor,
  getScheduleSupervisor,
  startScheduleSupervisor,
  stopScheduleSupervisor,
  ScheduleSupervisor,
  type ScheduleSupervisorDeps,
  type ScheduleFireOutcome,
} from './supervisor.js';
export type { ScheduleDoc, ScheduleRunDoc } from './store.js';
export { nextOccurrence, occurrencesOf, validateSpec, isValidTimeZone } from './recurrence.js';
