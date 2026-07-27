/**
 * cofre/items.ts — item and grant lifecycle.
 *
 * The shape is a deliberate GENERALIZATION of `api/src/auth/gateway-keys-service.ts`, which already
 * ships mint / list / revoke / fail-closed-verify / throttled-last-used / per-item caps with Registo
 * events and an e2e-tested UI. The discovery gate initially scored this lifecycle "absent"; it is
 * not, and building a second one beside it would have been the wrong call. What the Cofre adds is
 * the typed item model, origin binding, and the grant layer.
 */
import { randomUUID } from 'node:crypto';
import type { Actor, CofreItem, CofreItemType, GrantDuration } from '@ekoa/shared';
import { assertGrantAllowedForItemType } from '@ekoa/shared';
import { encrypt } from '../data/crypto.js';
import { cofreItems, cofreGrants } from './store.js';
import { isGrantActive } from './service.js';
import type { CofreItemDoc, CofreGrantDoc } from './types.js';

export interface CofreDeps {
  now?: () => number;
  genId?: () => string;
}

const TTL_MS: Record<Exclude<GrantDuration, 'this_run' | 'until_locked'>, number> = {
  '10_minutes': 10 * 60_000,
  '40_minutes': 40 * 60_000,
  '1_day': 24 * 60 * 60_000,
  '1_week': 7 * 24 * 60 * 60_000,
  '1_month': 30 * 24 * 60 * 60_000,
};

export interface MintCofreItemInput {
  type: CofreItemType;
  label: string;
  /** The secret. Encrypted immediately; never stored, logged or echoed in plaintext. */
  value: string;
  /** Hosts this credential may reach (I6). Required and non-empty for http/browser item types —
   *  an item with no binding is unusable, and that is the intended fail-closed default. */
  boundOrigins?: string[];
  identityPointer?: string;
  expiresAt?: string;
}

/** Item types that are USED against a network origin and therefore must declare one. */
const ORIGIN_BOUND_TYPES: ReadonlySet<CofreItemType> = new Set<CofreItemType>([
  'password',
  'api_key',
  'oauth_token',
  'session',
  'software_certificate',
]);

export async function mintCofreItem(
  actor: Actor,
  input: MintCofreItemInput,
  deps: CofreDeps = {},
): Promise<CofreItemDoc> {
  const now = new Date(deps.now?.() ?? Date.now()).toISOString();
  const id = deps.genId?.() ?? `itm_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  const boundOrigins = input.boundOrigins ?? [];
  if (ORIGIN_BOUND_TYPES.has(input.type) && boundOrigins.length === 0) {
    // Fail at CREATION, not at use: an item with no binding would refuse on every use anyway, and
    // failing here says why once instead of failing opaquely forever.
    throw new Error(`a ${input.type} item must declare at least one bound origin (I6)`);
  }
  const doc: CofreItemDoc = {
    _id: id,
    orgId: actor.orgId,
    userId: actor.userId,
    visibility: 'private',
    type: input.type,
    label: input.label,
    boundOrigins,
    valueCiphertext: encrypt(input.value),
    createdAt: now,
    updatedAt: now,
    ...(input.identityPointer ? { identityPointer: input.identityPointer } : {}),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
  } as CofreItemDoc;
  await cofreItems.raw.insert(doc as never);
  return doc;
}

/**
 * Issue a grant. I7 is asserted here as well as in the schema: a `certificate_identity` may only
 * ever be granted for a single run, so a TTL request on one throws rather than being silently
 * downgraded — a silent downgrade would leave the UI believing it had asked for something it did
 * not get.
 */
export async function issueGrant(
  actor: Actor,
  itemId: string,
  duration: GrantDuration,
  opts: { runId?: string } = {},
  deps: CofreDeps = {},
): Promise<CofreGrantDoc> {
  const item = await cofreItems.getVisible(actor, itemId);
  if (!item) throw new Error('credential not found');
  assertGrantAllowedForItemType(item.type, duration);

  const nowMs = deps.now?.() ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const id = deps.genId?.() ?? `grt_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

  const base = {
    _id: id,
    orgId: actor.orgId,
    userId: actor.userId,
    visibility: 'private' as const,
    itemId,
    issuedAt: now,
    duration,
  };

  let doc: CofreGrantDoc;
  if (duration === 'this_run') {
    if (!opts.runId) throw new Error('a this_run grant requires the run it belongs to');
    doc = { ...base, scope: 'this_run', runId: opts.runId } as CofreGrantDoc;
  } else if (duration === 'until_locked') {
    doc = { ...base, scope: 'until_locked' } as CofreGrantDoc;
  } else {
    doc = {
      ...base,
      scope: 'ttl',
      expiresAt: new Date(nowMs + TTL_MS[duration]).toISOString(),
    } as CofreGrantDoc;
  }
  await cofreGrants.raw.insert(doc as never);
  return doc;
}

/** The item as a client sees it. There is no code path from a stored row to a value in this view. */
export async function listCofreItems(actor: Actor, now = Date.now()): Promise<CofreItem[]> {
  const items = await cofreItems.listVisible(actor);
  const grants = await cofreGrants.listVisible(actor);
  return items.map((item) => {
    const live = grants.filter((g) => g.itemId === item._id && isGrantActive(g, { now }));
    // `this_run` grants are excluded from the resting state on purpose: an item unlocked only for a
    // run in flight reads as "Em utilização" while held and "Bloqueada" otherwise, never as a
    // standing unlock the user did not ask for.
    const untilLocked = live.find((g) => g.scope === 'until_locked');
    const ttl = live.find((g) => g.scope === 'ttl');
    const state = item.heldByRunId
      ? 'in_use'
      : untilLocked
        ? 'unlocked_until_locked'
        : ttl
          ? 'unlocked'
          : 'locked';
    return {
      id: item._id,
      ref: `cofre:${item._id}`,
      type: item.type,
      label: item.label,
      state,
      boundOrigins: item.boundOrigins,
      ...(state === 'unlocked' && ttl?.expiresAt ? { unlockedUntil: ttl.expiresAt } : {}),
      ...(item.heldByRunId ? { heldByRunId: item.heldByRunId } : {}),
      ...(item.lastUsedAt ? { lastUsedAt: item.lastUsedAt } : {}),
      ...(item.lastUsedBy ? { lastUsedBy: item.lastUsedBy } : {}),
      createdAt: item.createdAt,
      ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
      ...(item.identityPointer ? { identityPointer: item.identityPointer } : {}),
    } satisfies CofreItem;
  });
}
