/**
 * integrations/action-resolution.ts - THE ONE ANSWER to "which actions of this integration can this
 * (org, owner) actually reach right now" (slice S1, verification round four).
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
 *
 * Because three consecutive rounds of S1 answered that question with a re-derivation of it, and the
 * re-derivation was wrong in a different way each time. The question has a genuinely different
 * answer per reader, and every term of the difference lives in a different module:
 *
 *   - WHICH DOCUMENT. `getForActor` prefers the reader's own org row, then any `global` row from any
 *     org, then nothing; `resolveDefinition` falls through to the SHIPPED DISK BASELINE when the
 *     store holds nothing. A reader whose own org's row is a colleague's `private` one resolves the
 *     global or the baseline, not the row their org owns.
 *   - WHICH CONTENT OF IT. A row belonging to ANOTHER org is read through its FROZEN
 *     `publishedSnapshot` (`crossOrgView` -> `publishedViewOf`), never through its live fields. So
 *     an author dropping an action from their live row does NOT drop it for a consumer org until
 *     the row is re-published - the snapshot is deliberately carried forward by the replace branch.
 *   - AS WHOM. For an ORG-SHARED credential the definition resolves as the credential's CUSTODIAN
 *     and never as the reader (`definitionActorForCredential`; `credential-cofre.ts` sets out the
 *     exfiltration hole that rule closed). A peer running such a credential reaches whatever the
 *     custodian reaches, including the custodian's `private` row - which the peer cannot see.
 *
 * A collector that asks `getForActor(runner)` gets the LIVE row and the RUNNER, i.e. the wrong
 * answer on two of those three axes, and the consequence of a wrong answer there is the deletion of
 * somebody's only copy of their own data. So the question is asked ONCE, here, in the exact terms
 * the executor runs an action in - and `action-executor.ts` itself is a caller, which is what keeps
 * this from becoming a fourth re-derivation. If this file is wrong, execution is wrong too, loudly
 * and immediately, rather than silently deleting rows in the background.
 *
 * ── WHAT IT IS NOT ───────────────────────────────────────────────────────────────────────────
 *
 * NOT a gate and NOT an authorisation. It resolves; every gate the executor applies afterwards (the
 * write-consent check, the origin binding, the transport refusal) stays exactly where it is. And it
 * decrypts NOTHING: the config row is read for its custodian stamp alone, which is the same
 * un-decrypted read `executeUserIntegrationAction` already made before any gate.
 */
import type { Actor } from '@ekoa/shared';
import type { IntegrationDefinition } from './definitions.js';
import { resolveDefinition } from './definition-registry.js';
import { definitionActorForCredential } from './credential-cofre.js';
import { findConfigForOwner, type IntegrationConfigDoc } from './service.js';

/**
 * The resolution of one (org, owner, integration), as a run sees it.
 *
 * `definitionActor` is the principal the package was resolved AS - the credential's custodian, which
 * for an owner-scoped or absent config IS the owner. `config` is carried out so the executor does
 * not read the row twice.
 */
export interface OwnerActionSurface {
  definitionActor: Actor;
  config: IntegrationConfigDoc | null;
  definition: IntegrationDefinition | null;
}

/**
 * Resolve what this owner reaches. `null` means the (reader, config) pair is INCOHERENT - an
 * org-less reader, or a config row from another tenant - which is a refusal and never "resolve it as
 * somebody" (the failure mode `definitionActorForCredential` exists to remove).
 */
export async function resolveOwnerActionSurface(
  orgId: string,
  ownerUserId: string,
  integrationKey: string,
  deps: {
    findConfig?: (orgId: string, ownerUserId: string, key: string) => Promise<IntegrationConfigDoc | null>;
    resolve?: (actor: Actor, key: string) => Promise<IntegrationDefinition | null>;
  } = {},
): Promise<OwnerActionSurface | null> {
  const reader: Actor = { userId: ownerUserId, orgId, role: 'user' };
  const findConfig = deps.findConfig ?? findConfigForOwner;
  const resolve = deps.resolve ?? resolveDefinition;
  // THE CONFIG ROW IS READ FIRST, and the ordering is the executor's own (2026-08-03 review,
  // CRITICAL-1): a definition resolves per (key, PRINCIPAL), so the row has to be in hand before
  // the package can be resolved as the credential's custodian rather than as the reader.
  const config = await findConfig(orgId, ownerUserId, integrationKey);
  const definitionActor = definitionActorForCredential(reader, config);
  if (!definitionActor) return null;
  return { definitionActor, config, definition: await resolve(definitionActor, integrationKey) };
}

/**
 * The same resolution, projected onto the ONLY thing a retention decision may look at: the set of
 * action NAMES this owner can still reach.
 *
 * THE THREE-WAY ANSWER IS THE POINT, and collapsing it is exactly the bug this replaced. `null` is
 * "we could not find out" and is NEVER the same as the empty set: an incoherent custodian, a Mongo
 * blip or a resolver failure must leave every row standing, while "the key resolves and names no
 * such action" is a real, actionable empty answer. A two-way answer would turn one failed read into
 * silent deletion of a tenant's only copy of its own data.
 */
export async function resolvableActionNamesForOwner(
  orgId: string,
  ownerUserId: string,
  integrationKey: string,
  deps: Parameters<typeof resolveOwnerActionSurface>[3] = {},
): Promise<ReadonlySet<string> | null> {
  if (orgId === '' || ownerUserId === '' || integrationKey === '') return null;
  let surface: OwnerActionSurface | null;
  try {
    surface = await resolveOwnerActionSurface(orgId, ownerUserId, integrationKey, deps);
  } catch (err) {
    console.warn(
      `[integrations] could not resolve '${integrationKey}' for ${orgId}/${ownerUserId}: `
        + `${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
  if (!surface) return null; // incoherent custodian - a refusal, not an empty reach
  return new Set((surface.definition?.actions ?? []).map((action) => action.actionName));
}
