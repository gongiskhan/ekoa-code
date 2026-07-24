/**
 * Signature-agreement reverse indexes (2B-S3) — the store-backed backing for the
 * e-signature webhook seams.
 *
 * A row maps a provider agreement/request id -> the ERP proposal (+ owning app/user)
 * that created it: written at send time, read by the inbound webhook to (a) route the
 * event to the exact app + `propostas` record and (b) pick the owner-scoped credentials
 * for the authenticity re-fetch. The row is intentionally TINY and NON-SENSITIVE (no
 * credentials); the webhook NEVER trusts it for signature STATE — it always re-fetches
 * owner-scoped and re-confirms the client actually signed.
 *
 * Why this module (not the provider modules): `integrations/zoho-sign.ts` and
 * `integrations/adobe-sign.ts` deliberately stay OUT of the mongodb import chain so the
 * hermetic proxy e2e drives their real backends under plain node (every collaborator
 * injected). This store-backed layer is the SEPARATE module the composition root
 * (server.ts) wires into their injected `recordAgreement` / `findAgreement` seams.
 * `integrations/` MAY import `data/` (module tiers), so the record/find helpers read the
 * physical `zoho_agreements` + `adobe_agreements` stores directly here.
 *
 * The physical stores live in `data/stores.ts` (the canonical Store registry the ch10
 * migration imports from) and ride the migration passthrough (import-tool.ts) so a prod
 * cutover carries the reverse index verbatim under each row's `_id` (= the agreement /
 * request id).
 */
import { zohoAgreements, adobeAgreements } from '../data/stores.js';
import type { Doc } from '../data/store.js';
import type { ZohoAgreementRef } from './zoho-sign.js';
import type { AdobeAgreementRef } from './adobe-sign.js';

// ----------------------------------------------------------------------------
// Zoho — keyed by requestId (`_id`). Record (send time) + find (webhook re-route).
// ----------------------------------------------------------------------------

/** Persist the requestId -> proposta reverse index (send time). Upsert by `_id` so a
 *  resend of the same request is idempotent. */
export async function recordZohoAgreement(ref: ZohoAgreementRef): Promise<void> {
  const doc: Doc = {
    _id: ref.id,
    appId: ref.appId,
    propostaId: ref.propostaId,
    ownerUserId: ref.ownerUserId,
    clientEmail: ref.clientEmail,
    createdAt: ref.createdAt,
  };
  await zohoAgreements.put(doc);
}

/** Resolve a Zoho requestId to its reverse-index row, or null when it is not one of our
 *  ERP requests (an account-scoped webhook fires for every request in the workspace). */
export async function findZohoAgreement(requestId: string): Promise<ZohoAgreementRef | null> {
  const doc = await zohoAgreements.get(requestId);
  if (!doc) return null;
  return {
    id: String(doc._id),
    appId: String(doc.appId ?? ''),
    propostaId: String(doc.propostaId ?? ''),
    ownerUserId: String(doc.ownerUserId ?? ''),
    clientEmail: String(doc.clientEmail ?? ''),
    createdAt: String(doc.createdAt ?? ''),
  };
}

// ----------------------------------------------------------------------------
// Adobe — keyed by agreementId (`_id`). Find only: the live Adobe send/record path
// lands with a live Adobe backend; today Adobe rows arrive ONLY via the ch10 migration
// passthrough (facade backend never sends). The migrated rows + this find make the
// inbound-webhook dispatch live (fail-closed on the notConnected re-fetch).
// ----------------------------------------------------------------------------

/** Resolve an Adobe agreementId to its reverse-index row, or null when unknown. */
export async function findAdobeAgreement(agreementId: string): Promise<AdobeAgreementRef | null> {
  const doc = await adobeAgreements.get(agreementId);
  if (!doc) return null;
  return {
    ownerUserId: String(doc.ownerUserId ?? ''),
    appId: String(doc.appId ?? ''),
    propostaId: String(doc.propostaId ?? ''),
    clientEmail: String(doc.clientEmail ?? ''),
  };
}
