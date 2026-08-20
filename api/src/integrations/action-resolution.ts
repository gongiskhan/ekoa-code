/**
 * integrations/action-resolution.ts - THE ONE ANSWER to "which package, as whom, does THIS RUN
 * execute against" (slice S1).
 *
 * ── WHAT IT IS FOR, AND WHAT IT IS EMPHATICALLY NOT FOR (round five) ─────────────────────────
 *
 * IT ANSWERS FOR A RUN, AT THE INSTANT OF THE RUN, AND NOTHING ELSE READS IT. Rounds two to four
 * also pointed retention decisions at this question - which actions an owner can still reach - and
 * every one of them deleted somebody's only copy of their own data, because a resolution is a fact
 * about one instant from one vantage and an evidence row is durable. Reachability now decides
 * exactly one thing: whether this call runs or is refused, which the caller is told immediately.
 * Retention is decided by time, by the owner, and by a newer sample - see
 * `action-evidence-store.ts`. DO NOT re-point a collector at this module.
 *
 * ── WHY THE RESOLUTION IS ONE FUNCTION ANYWAY ────────────────────────────────────────────────
 *
 * Because it is genuinely subtle, and three rounds of re-deriving it inside other modules got it
 * wrong differently each time. The question has a different answer per reader, and every term of the
 * difference lives in a different module:
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
 * A caller that asks `getForActor(runner)` gets the LIVE row and the RUNNER, i.e. the wrong answer
 * on two of those three axes. So the question is asked ONCE, here, in the exact terms the executor
 * runs an action in - and `action-executor.ts` is the caller, which is what keeps this from becoming
 * a re-derivation. If this file is wrong, execution is wrong too, loudly and immediately.
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

// ── THE RETENTION PROJECTION IS GONE (round five) ────────────────────────────────────────────
//
// `resolvableActionNamesForOwner` used to sit here: the same resolution projected onto the set of
// action NAMES an owner reaches, answering three ways so that "we could not find out" (`null`) could
// never be read as "reaches nothing" (the empty set). It had exactly two callers - a write-time
// reconciler and a reader-side collector - and BOTH are deleted, because the question they asked it
// is not answerable synchronously at all: a correct instantaneous answer still governs a row that
// outlives the instant. See `action-evidence-store.ts`'s removal rule.
//
// The three-way discipline itself was right and is not lost. It survives one tier down, in
// `resolveOwnerActionSurface`'s `null`, which the executor turns into `credential_invalid` rather
// than into "this owner reaches nothing" - and a refusal is a thing a caller is TOLD, never a thing
// that deletes their data.
