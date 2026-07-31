/**
 * cofre/types.ts — the stored shapes. Deliberately NOT the wire shapes: `shared/src/cofre.ts` owns
 * what a client sees, and the difference between the two is the whole point of this module — the
 * stored row has a ciphertext, the view has none and never may.
 */
import type { Doc } from '../data/store.js';
import type { CofreItemType, GrantScope, GrantDuration } from '@ekoa/shared';

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
