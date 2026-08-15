/**
 * Type declarations for the convert-dev-state build-tooling module (salomao carry-over S4).
 * The runtime is plain ESM JS (`.mjs`, no product imports); these types let the round-trip
 * unit test consume it with real types under NodeNext resolution.
 */

/** An old-stack (ekoa-dev JsonStore) row: keyed `id`, arbitrary further fields. */
export type OldRow = Record<string, unknown> & { id: string };

/** A new-stack import-tool-ready row: keyed `_id`. */
export type NewRow = Record<string, unknown> & { _id: string };

export const ADOBE_REFUSAL: string;

export function decryptOldCredential(ciphertext: string, oldKey: string): string;
export function encryptNewCredential(plaintext: string, newKey: string): string;

export interface ConvertOpts {
  orgId: string;
  oldKey: string;
  newKey: string;
  rewriteAppIds?: Record<string, string>;
}

export function convertIntegrationConfigs(
  oldRows: readonly OldRow[],
  opts: ConvertOpts,
): { rows: NewRow[]; notes: string[] };

export function convertZohoAgreements(
  oldRows: readonly OldRow[],
  opts?: { rewriteAppIds?: Record<string, string> },
): { rows: NewRow[]; notes: string[] };

export function convertDevState(
  input: {
    integrationConfigs?: unknown;
    zohoAgreements?: unknown;
    adobeAgreements?: unknown;
  },
  opts: ConvertOpts,
): { integrationConfigs: NewRow[]; zohoAgreements: NewRow[]; notes: string[] };
