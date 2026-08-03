/**
 * cofre/types.ts — the stored shapes. Deliberately NOT the wire shapes: `shared/src/cofre.ts` owns
 * what a client sees, and the difference between the two is the whole point of this module — the
 * stored row has a ciphertext, the view has none and never may.
 */
import type { Doc } from '../data/store.js';
import type { CofreItemType, GrantScope, GrantDuration } from '@ekoa/shared';

/**
 * The INTEGRATION -> ITEM join (slice B2, WS-C).
 *
 * Stamped server-side at mint and never accepted from a wire body (`CofreItemCreateRequest` has no
 * such field, and zod strips what it does not declare). It is the item's PROVENANCE, and it is what
 * makes "an authored action cannot name a secret outside the integration's granted scope" checkable:
 * a credential read names the (integrationKey, configId) it believes it is reading for, and the item
 * refuses when its own link disagrees. Without it, a config row whose `cofreItemId` was tampered
 * with — or an action authored under integration A pointing at integration B's item — would resolve
 * to whatever item the id happened to name, and the only remaining gate would be ownership.
 *
 * Deliberately a plain pair of strings: `cofre/` must not import `integrations/` (it is the lower
 * tier, consumed by it), so the join is expressed as data, not as a type dependency.
 */
export interface IntegrationItemLink {
  /** The integration definition key the credential belongs to (`citius`, `stripe`, …). */
  integrationKey: string;
  /** The `integration_configs` row this item shadows (`IntegrationConfigDoc._id`). */
  configId: string;
}

/**
 * A stored Cofre item.
 *
 * `valueCiphertext` uses the existing `data/crypto.ts` wire format
 * (`base64(iv).base64(tag).base64(ct)`), so WS-K can prefix a version tag and let v1 and v2 rows
 * coexist without a migration flag day. There is no plaintext field, and `unwrap()` is the only
 * function that ever decrypts one.
 */
export interface CofreItemDoc extends Doc {
  orgId: string;
  /** The owning user. Cofre items are owner-scoped, never org-visible by default: a credential is
   *  not a document, so there is no "shared with the org" state to opt into by accident. */
  userId: string;
  type: CofreItemType;
  label: string;
  /** Hosts this item's value may be sent to (I6). Empty means the item is unusable, NOT unrestricted. */
  boundOrigins: string[];
  valueCiphertext: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  lastUsedBy?: string;
  /** Session items: health/expiry of the captured storageState. */
  expiresAt?: string;
  /** certificate_identity: the human-readable pointer; there is no key material to store. */
  identityPointer?: string;
  /** Session items: where the session was established and what egress it is bound to (E5). */
  sessionMetadata?: Record<string, unknown>;
  /** Set while a run holds the item — drives the live "Em utilização" state. */
  heldByRunId?: string;
  /** Integration-minted items only (WS-C): which integration config this item holds the
   *  credentials for. Absent on every hand-minted item, which is exactly what distinguishes the
   *  auto-granted connect ceremony from an ordinary "store this password" mint. */
  integrationLink?: IntegrationItemLink;
}

/**
 * A stored grant. One row per (item, issuance). Grants are PER-CREDENTIAL — there is no vault-wide
 * unlock, because the blast radius of one is the entire Cofre.
 */
export interface CofreGrantDoc extends Doc {
  orgId: string;
  userId: string;
  itemId: string;
  scope: GrantScope;
  duration?: GrantDuration;
  issuedAt: string;
  /** TTL scope only. */
  expiresAt?: string;
  /** this_run scope only — the grant dies with the run, not with a clock. */
  runId?: string;
  /** Set by lock-now / lock-all; a revoked grant is never resurrected. */
  revokedAt?: string;
}
