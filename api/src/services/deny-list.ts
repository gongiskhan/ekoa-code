/**
 * Org anonymisation deny-list service (ch17 §17.4 (b), ch04 §4.3; F10). Owns the
 * `anonymisation_deny_lists` collection: entries are org-scoped-encrypted AT REST through the
 * one crypto module (ch04 acceptance 11) and NEVER leave this module in cleartext — the list
 * surface is metadata-only (§4.3.4) and the ruleset loader hands the anonymiser a re-wrapped
 * CIPHERTEXT so decryption stays on the pipeline's access-logged path (§17.4 (b), D3).
 *
 * This module deliberately imports nothing from `llm/` (services/ may not — ch02 §2.6/§2.7):
 * `denyListRulesetFieldsFor` returns a plain fields object and the composition root
 * (server.ts) folds it into the `setRulesetResolver` seam.
 */
import { anonymisationDenyLists } from '../data/stores.js';
import type { Doc } from '../data/store.js';
import { encryptForScope, decryptForScope } from '../data/crypto.js';
import { logActivity, type ActivityActor, type LogActivityDeps } from '../data/activity.js';

export interface DenyListEntryDoc extends Doc {
  orgId: string;
  /** Org-scoped ciphertext of the party-name literal — never plaintext at rest. */
  value: string;
  entityClass: string;
  addedBy: string;
  addedAt: string;
}

/** Metadata-only view — the cleartext value NEVER appears in any response (ch04 §4.3.4). */
export interface DenyListEntryView {
  id: string;
  entityClass: string;
  addedBy: string;
  addedAt: string;
}

const view = (d: DenyListEntryDoc): DenyListEntryView => ({
  id: d._id,
  entityClass: d.entityClass,
  addedBy: d.addedBy,
  addedAt: d.addedAt,
});

// Per-org resolver cache: chat/build egress resolves the ruleset on EVERY request (client.ts),
// so the loader memoizes the re-wrapped ciphertext. In-process writes invalidate immediately;
// cross-process changes surface within the TTL window (a conscious staleness bound, RUN_LOG
// DECISION batch-final s1).
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; fields: { denyListCiphertext?: string } }>();

export function __resetDenyListCacheForTests(): void {
  cache.clear();
}

function invalidate(orgId: string): void {
  cache.delete(orgId);
}

export async function listDenyList(orgId: string): Promise<DenyListEntryView[]> {
  const rows = (await anonymisationDenyLists.find({ orgId })) as DenyListEntryDoc[];
  return rows.map(view);
}

/** Defense-in-depth mirror of the shared `DenyListEntityClass` enum: the route's zod schema is
 *  the boundary guard; this keeps a direct service caller from storing a free string either. */
const ENTITY_CLASSES = new Set(['NIF', 'NIPC', 'NISS', 'IBAN', 'CC', 'UTENTE', 'PROCESSO', 'PARTY', 'PERSON']);

export async function addDenyListEntry(
  orgId: string,
  value: string,
  entityClass: string,
  actor: ActivityActor,
  deps: LogActivityDeps,
): Promise<DenyListEntryView> {
  if (!ENTITY_CLASSES.has(entityClass)) throw new Error(`invalid deny-list entityClass: not in the closed enum`);
  const doc: DenyListEntryDoc = {
    _id: deps.genId ? deps.genId() : `dl_${deps.now()}`,
    orgId,
    value: encryptForScope(value, orgId),
    entityClass,
    addedBy: actor.userId,
    addedAt: new Date(deps.now()).toISOString(),
  };
  await anonymisationDenyLists.insert(doc as never);
  invalidate(orgId);
  // Audit ids-only — the literal is secret material and never reaches the activity log (D3).
  await logActivity(actor, 'anonymisation', 'deny-list.add', deps, { entryId: doc._id, entityClass });
  return view(doc);
}

export async function removeDenyListEntry(
  orgId: string,
  id: string,
  actor: ActivityActor,
  deps: LogActivityDeps,
): Promise<boolean> {
  const row = (await anonymisationDenyLists.get(id)) as DenyListEntryDoc | null;
  // Org mismatch is indistinguishable from absent — uniform 404 posture (ch09).
  if (!row || row.orgId !== orgId) return false;
  await anonymisationDenyLists.delete(id);
  invalidate(orgId);
  await logActivity(actor, 'anonymisation', 'deny-list.remove', deps, { entryId: id });
  return true;
}

/**
 * The ruleset fields the composition root folds into `setRulesetResolver` (F10). Entries are
 * decrypted here (service layer owns the store) and immediately RE-WRAPPED as the single
 * org-scoped `denyListCiphertext` the anonymiser expects, so `resolveDenyList` keeps its
 * decrypt-and-access-log semantics unchanged and the plaintext never rides the ruleset object.
 * An org with no entries gets NO deny-list fields (the empty ruleset stays cheap and is not an
 * at-rest access event).
 */
export async function denyListRulesetFieldsFor(orgId: string): Promise<{ denyListCiphertext?: string }> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.fields;
  const rows = (await anonymisationDenyLists.find({ orgId })) as DenyListEntryDoc[];
  const fields: { denyListCiphertext?: string } =
    rows.length === 0
      ? {}
      : { denyListCiphertext: encryptForScope(JSON.stringify(rows.map((r) => decryptForScope(r.value, orgId))), orgId) };
  cache.set(orgId, { at: Date.now(), fields });
  // D3: this cache-fill decrypt is itself an access to secret material — logged metadata-only
  // (count, never values), complementing the per-request denyListAccessed count on anon audit
  // rows (codex s1 finding 2 mitigation). Best-effort: bookkeeping never fails egress.
  if (rows.length > 0) {
    await logActivity(
      { userId: 'system', username: 'system', orgId },
      'anonymisation',
      'deny-list.load',
      { now: () => Date.now() },
      { entries: rows.length },
    ).catch(() => undefined);
  }
  return fields;
}
