/**
 * ledger/index.ts — barrel for the append-only local egress ledger (§18.5 S6).
 * See ledger.ts for provenance, the fsync-per-append durability policy, and the session-filename
 * sanitisation scheme. This is the only import surface other slices should use for the ledger.
 */
export {
  EgressLedger,
  ReadLedgerRow,
  DenialLedgerRow,
  WriteLedgerRow,
  CapConsentLedgerRow,
  AutomationLedgerRow,
  LedgerRow,
} from './ledger.js';
export type { LedgerReadResult } from './ledger.js';
