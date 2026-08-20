/**
 * integrations/evidence-reconcile.ts - the WRITE-TIME collector for `integration_action_evidence`,
 * and the whole of it (slice S1, verification round four).
 *
 * ── THE RULE THIS FILE EXISTS TO MAKE STRUCTURAL ─────────────────────────────────────────────
 *
 * A WRITE BY ONE ORG MUST NEVER DELETE ANOTHER ORG'S DATA. Not narrowly, not carefully, not with a
 * better actor. Three rounds of S1 tried to reconcile every tenant's rows from a definition write
 * and produced, in order: rows orphaned for every consumer of a `global` definition (the collector
 * was scoped to the writing org), then deletion ACROSS a tenant boundary twice over (the collector
 * asked for the LIVE row while a consumer resolves the FROZEN snapshot, and asked as the RUNNER
 * while an org-shared credential resolves as the CUSTODIAN). The correction is a shape, not a
 * parameter: this collector's ORG IS A REQUIRED ARGUMENT and every query it issues carries it, so
 * the blast radius of the worst bug it can contain is the writing tenant itself.
 *
 * ── AND INSIDE THAT ORG, THE QUESTION IS ASKED THE PRODUCTION WAY ────────────────────────────
 *
 * "Own org" is a necessary bound, not a sufficient one: even inside one tenant the answer differs
 * per reader. A member whose colleague's row is `private` resolves the shipped baseline or a foreign
 * `global` row instead; a member on an ORG-SHARED credential resolves as its custodian, including
 * the custodian's private row. So this asks `resolvableActionNamesForOwner` - the SAME function
 * `action-executor.ts` runs an action through - rather than any re-derivation of it. If that answer
 * is wrong, execution is wrong first, loudly.
 *
 * ── WHY IT IS A SEAM ON THE STORE AND NOT AN IMPORT INSIDE IT ────────────────────────────────
 *
 * The writes that narrow reach live in `definition-store.ts`, which stands on `data/` and
 * `security/` alone and CANNOT import the resolution (that would be a cycle:
 * `definition-registry.ts` imports the definition store). Putting the call at the four higher-tier
 * call sites instead - the builder save, `achieve`'s two in-place writes, the visibility route -
 * would make reachability a thing four authors have to remember, which is the failure mode this
 * slice has already shipped twice. So the store declares ONE seam, this module implements it, and
 * the composition root binds the two together - the pattern `setIntegrationActionExecutor` and
 * `setIntegrationOriginResolver` already established for exactly this "a lower tier needs a
 * higher-tier answer" problem.
 *
 * UNBOUND, NOTHING IS COLLECTED AT WRITE TIME. That is a deliberate posture and not a hole: the
 * reader's own path still collects its own rows, the boot retention sweep still ends every row that
 * ages out, and the owner's erasure control still works. Failing to collect leaves a bounded
 * retention gap; collecting wrongly destroys a tenant's only copy.
 *
 * ── BOUNDED, BECAUSE IT RUNS INSIDE AN ORDINARY SAVE ─────────────────────────────────────────
 *
 * One projected listing scoped to (org, key), then ONE resolution per distinct OWNER - not per row.
 * `MAX_RECONCILED_OWNERS` caps the fan-out: past it the collector stops and says so, and the rows it
 * did not reach are left to the reader path and the retention sweep. An ordinary definition save
 * must not become an unbounded number of round-trips because an integration got popular.
 */
import {
  actionEvidenceStore,
  type ActionEvidenceKey,
  type ActionEvidenceOwnerRef,
} from './action-evidence-store.js';
import { resolvableActionNamesForOwner } from './action-resolution.js';
import { setDefinitionEvidenceReconciler } from './definition-store.js';

/**
 * How many distinct owners one write reconciles. A hard cap rather than a soft one: exceeding it
 * SKIPS the remainder instead of paying for it, because the alternative - N sequential database
 * round-trips awaited inside every ordinary save of a popular integration - is a latency cliff that
 * only shows up in the tenants with the most data.
 */
export const MAX_RECONCILED_OWNERS = 25;

export interface ReconcileDeps {
  listOwnerRefsInOrg?: (orgId: string, integrationKey: string) => Promise<ActionEvidenceOwnerRef[]>;
  resolvableActionNames?: (orgId: string, ownerUserId: string, key: string) => Promise<ReadonlySet<string> | null>;
  discardEvidence?: (key: ActionEvidenceKey) => Promise<boolean>;
}

/**
 * Reconcile the evidence rows THIS ORG holds for THIS integration, and no others.
 *
 * FAILS TOWARDS KEEPING AT EVERY STEP, and the asymmetry is the reason: a kept row is a bounded
 * retention gap that three other mechanisms still close, while a deleted row is unrecoverable tenant
 * data. So a listing that throws collects nothing; a resolution that cannot be reached (`null` -
 * which is NOT the empty set) keeps every row of that owner; a discard that throws does not abandon
 * the rest of the batch; and the cap skips rather than guesses.
 *
 * BEST EFFORT AND LOUD. The write that narrowed the reach has already landed by the time this runs,
 * so a throw here must never undo it or be reported as a failed save.
 */
export async function reconcileOwnOrgEvidence(
  orgId: string,
  integrationKey: string,
  deps: ReconcileDeps = {},
): Promise<number> {
  if (orgId === '' || integrationKey === '') return 0;
  const list = deps.listOwnerRefsInOrg
    ?? ((org: string, key: string) => actionEvidenceStore.listOwnerRefsInOrg(org, key));
  const resolvable = deps.resolvableActionNames ?? resolvableActionNamesForOwner;
  const discard = deps.discardEvidence ?? ((key: ActionEvidenceKey) => actionEvidenceStore.discardEvidence(key));

  let refs: ActionEvidenceOwnerRef[];
  try {
    refs = await list(orgId, integrationKey);
  } catch (err) {
    console.warn(
      `[integrations] could not list ${orgId}'s evidence of '${integrationKey}' to reconcile it: ${messageOf(err)}`,
    );
    return 0;
  }

  // `null` records "we asked and could not find out", which is not the same as "resolves nothing".
  const resolvedPerOwner = new Map<string, ReadonlySet<string> | null>();
  let discarded = 0;
  for (const ref of refs) {
    // A ROW OUTSIDE THE RECONCILED ORG IS NOT THIS WRITE'S BUSINESS, whatever the listing returned.
    // The query already filters on `orgId`, so this can only fire on a hand-written row or a future
    // change to the listing - and on that day it is the difference between a bug and a cross-tenant
    // deletion, which is the failure this whole file exists to make unreachable.
    if (ref.orgId !== orgId) continue;
    if (ref.actionName === '') continue;
    if (ref.ownerUserId === '') {
      // A row naming no owner cannot be addressed by the removal primitive (its key would not be
      // tenant-scoped), so it can never be superseded or discarded by name either. No writer in this
      // codebase produces that shape, so this is loud rather than handled - and the retention sweep
      // is what actually ends such a row.
      console.warn(
        `[integrations] an evidence row of '${integrationKey}' in org ${orgId} names no owner and cannot `
          + 'be reconciled - the retention sweep is what will end it',
      );
      continue;
    }
    if (!resolvedPerOwner.has(ref.ownerUserId) && resolvedPerOwner.size >= MAX_RECONCILED_OWNERS) {
      console.warn(
        `[integrations] '${integrationKey}' has evidence for more than ${MAX_RECONCILED_OWNERS} owners in `
          + `org ${orgId}; the rest is left to the reader path and the retention sweep`,
      );
      break;
    }
    if (!resolvedPerOwner.has(ref.ownerUserId)) {
      resolvedPerOwner.set(ref.ownerUserId, await resolvable(orgId, ref.ownerUserId, integrationKey));
    }
    const names = resolvedPerOwner.get(ref.ownerUserId);
    if (names == null || names.has(ref.actionName)) continue;
    try {
      if (await discard({ orgId, ownerUserId: ref.ownerUserId, integrationKey, actionName: ref.actionName })) {
        discarded += 1;
      }
    } catch (err) {
      console.warn(
        `[integrations] the evidence of ${integrationKey}/${ref.actionName} outlived the action it was `
          + `evidence for, for ${orgId}/${ref.ownerUserId}: ${messageOf(err)}`,
      );
    }
  }
  return discarded;
}

/**
 * Bind the collector onto the definition store's seam. The composition root calls THIS rather than
 * reaching for the setter, so the production wiring is one named thing a test can enter - and a test
 * that enters it is exercising the same composition `buildApp` does, not a re-invention of it.
 */
export function bindDefinitionEvidenceReconciler(): void {
  setDefinitionEvidenceReconciler((orgId, integrationKey) => reconcileOwnOrgEvidence(orgId, integrationKey));
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
