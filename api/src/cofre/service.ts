/**
 * cofre/service.ts — THE policy-lock seam (Cofre WS-B/WS-C; invariants I4, I6).
 *
 * `unwrap()` is the ONE function in the codebase that turns a credential reference into a value.
 * Every credential read must route through it, and it is fail-closed on four independent grounds:
 * tenancy, an active grant, origin binding, and item existence.
 *
 * WHY ONE FUNCTION. Three later pieces of work install here without touching a single call site:
 *   - WS-K swaps `decrypt()` for a per-tenant DEK wrapped by a Cloud KMS key. The envelope is a
 *     change to `key()`/`unwrap()`, not a repo-wide refactor — but ONLY while this stays the sole
 *     chokepoint. If any workstream bypasses it, WS-K becomes a repo-wide refactor.
 *   - The parked passkey-PRF crypto-lock becomes an ADDITIONAL precondition inside the same
 *     function, so the grant check can later become a key-share requirement.
 *   - The Registo "item used" event has exactly one place to fire from, which is why the audit can
 *     be trusted to be complete.
 *
 * WHAT IT IS NOT. This is a POLICY lock, honestly: Cortex can decrypt an item whenever a grant
 * exists, so Ekoa is a trusted custodian, not zero-knowledge. That is stated plainly in the product
 * copy and must never be marketed otherwise.
 */
import type { Actor, CofreItemType } from '@ekoa/shared';
import { envelopeDecrypt } from '../data/crypto.js';
import { assertOriginAllowed, CredentialOriginError } from '../security/origin-binding.js';
import { cofreItems, cofreGrants } from './store.js';
import type { CofreItemDoc, CofreGrantDoc } from './types.js';

/** Refused by the lock. Distinct from "not found": the item exists and the caller may see it, but
 *  no active grant covers this use. */
export class CofreLockedError extends Error {
  readonly code = 'COFRE_LOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'CofreLockedError';
  }
}

/** The item does not exist, or belongs to someone else. Uniform, so it is not an existence oracle. */
export class CofreNotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(message = 'credential not found') {
    super(message);
    this.name = 'CofreNotFoundError';
  }
}

/**
 * Where the value is about to be used. `origin` is REQUIRED for http/browser use: an item is bound
 * to the hosts it may reach (I6), and a use context that cannot name its destination cannot be
 * checked, so it is refused rather than waved through.
 */
export type UsageContext =
  | { kind: 'http'; origin: string }
  | { kind: 'browser'; origin: string }
  /** A non-browser step (bash/script/desktop). The I9 primitive is the only legitimate caller. */
  | { kind: 'process'; processLabel: string };

export interface UnwrapOptions {
  /** The run asking. A `this_run` grant is consumed by this id, never by a clock. */
  runId?: string;
  now?: () => number;
}

export interface UnwrappedCredential {
  itemId: string;
  type: CofreItemType;
  /** The plaintext. RAM-only for the use window; callers must not persist or log it, and every
   *  stream they produce must pass the run's SecretRegistry (security/redaction.ts). */
  value: string;
}

/** Is this grant live right now? */
export function isGrantActive(grant: CofreGrantDoc, opts: { runId?: string; now: number }): boolean {
  if (grant.revokedAt) return false;
  switch (grant.scope) {
    case 'this_run':
      // Consumed by run identity. No runId in context → the grant cannot apply; refuse.
      return Boolean(opts.runId) && grant.runId === opts.runId;
    case 'ttl':
      return Boolean(grant.expiresAt) && Date.parse(grant.expiresAt!) > opts.now;
    case 'until_locked':
      return true; // only `revokedAt` ends it — that is what "até eu bloquear" means
    default:
      return false;
  }
}

/**
 * Resolve a credential reference to its value. THE seam.
 *
 * Order matters and is deliberate: tenancy, then grant, then origin. The origin check is last
 * because it is the only one that needs the item's own binding, but it still runs BEFORE the
 * decrypt — a refused destination never causes an unwrap.
 */
export async function unwrap(
  itemId: string,
  actor: Actor,
  usage: UsageContext,
  opts: UnwrapOptions = {},
): Promise<UnwrappedCredential> {
  const now = opts.now?.() ?? Date.now();

  // 1. Tenancy. A row outside the actor's scope reads as absent (uniform NOT_FOUND, never 403).
  const item = await cofreItems.getVisible(actor, itemId);
  if (!item) throw new CofreNotFoundError();

  // 2. Grant. DEFAULT DENY — no grant, no value. There is no vault-wide unlock to fall back on.
  const grants = await cofreGrants.listVisible(actor, { itemId });
  const active = grants.find((g) => isGrantActive(g, { ...(opts.runId ? { runId: opts.runId } : {}), now }));
  if (!active) {
    throw new CofreLockedError(`credential ${itemId} is locked: no active grant for this use`);
  }

  // 3. Origin binding (I6). An http/browser use must name a destination the item is bound to.
  //    A `process` use has no origin, so the binding is the DECLARATION that made the grant — the
  //    I9 primitive is the only caller that may construct one.
  if (usage.kind === 'http' || usage.kind === 'browser') {
    assertOriginAllowed(originAsUrl(usage.origin), {
      allowedOrigins: item.boundOrigins,
      credentialLabel: item.label,
    });
  }

  // 4. Only now does anything decrypt — through the versioned envelope (K-1), keyed per ORG.
  //    v1 rows decrypt unchanged, so this seam did not need a migration flag day; installing a
  //    Cloud KMS wrapper at the composition root is the remaining step and touches nothing here.
  const value = await envelopeDecrypt(item.valueCiphertext, item.orgId);
  return { itemId: item._id, type: item.type, value };
}

/** `assertOriginAllowed` parses a URL; a bare host from a browser context is normalised here. */
function originAsUrl(origin: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(origin) ? origin : `https://${origin}`;
}

/** Re-exported so callers can branch on the refusal reason without importing three modules. */
export { CredentialOriginError };

/** Mark an item used. Called by `unwrap`'s callers after a SUCCESSFUL use so a refused attempt
 *  does not advance "last used" — the dashboard's last-used must mean "a value was actually
 *  handed over", not "someone asked". */
export async function recordUse(actor: Actor, itemId: string, usedBy: string, now = Date.now()): Promise<void> {
  await cofreItems.raw.update(itemId, (cur) => ({
    ...(cur as CofreItemDoc),
    lastUsedAt: new Date(now).toISOString(),
    lastUsedBy: usedBy,
  }));
}

/** Lock one item: revoke every live grant on it. Idempotent. */
export async function lockItem(actor: Actor, itemId: string, now = Date.now()): Promise<number> {
  const grants = await cofreGrants.listVisible(actor, { itemId });
  let revoked = 0;
  for (const g of grants) {
    if (g.revokedAt) continue;
    await cofreGrants.raw.update(g._id, (cur) => ({
      ...(cur as CofreGrantDoc),
      revokedAt: new Date(now).toISOString(),
    }));
    revoked++;
  }
  return revoked;
}

/** "Bloquear tudo" — revoke every live grant the actor holds. */
export async function lockAll(actor: Actor, now = Date.now()): Promise<number> {
  const grants = await cofreGrants.listVisible(actor);
  let revoked = 0;
  for (const g of grants) {
    if (g.revokedAt) continue;
    await cofreGrants.raw.update(g._id, (cur) => ({
      ...(cur as CofreGrantDoc),
      revokedAt: new Date(now).toISOString(),
    }));
    revoked++;
  }
  return revoked;
}
