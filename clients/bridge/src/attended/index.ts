/**
 * attended/index.ts — barrel for the attended ceremony rail (Cofre J-5), the machine half of
 * `attended.request` / `session.push`. See ceremony.ts for why the origin is Cortex's to declare
 * and why "the human closed the window" is the completion signal.
 */
export {
  runAttendedCeremony,
  CeremonyError,
  type CeremonyRequest,
  type CeremonyDeps,
  type CeremonyBrowser,
  type CeremonyContext,
  type CeremonyPage,
} from './ceremony.js';
