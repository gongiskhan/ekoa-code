/**
 * integrations/credential-cofre.ts — the WS-C credential SHADOW and its comparator (slice B2).
 *
 * ================================ WHAT THIS IS, IN RULE-10 TERMS ============================
 * CLAUDE.md rule 10: a state migration is SHADOW -> COMPARE -> cutover-or-remove, with the review
 * date fixed at the start. This module is all three halves of the first two, and nothing else:
 *
 *   SHADOW  — every write to a user-defined integration config ALSO mints (or refreshes) a Cofre
 *             item holding the same credential bundle, joined to the config both ways
 *             (`config.cofreItemId` <-> `item.integrationLink`). `credentialsCiphertext` remains
 *             the LIVE read: nothing that works today starts depending on the new store.
 *   COMPARE — every real credential read (the composition root's credential-loader seam) runs
 *             `compareCredentialShadow`, which reads the SAME credential back through the Cofre —
 *             tenancy, grant, link and origin binding included — and reports whether a cutover
 *             today would return the same values under the same policy. The report carries field
 *             NAMES and a status, never a value.
 *   CUTOVER-OR-REMOVE — 2026-08-15 (docs/decisions.md). On that date the Cofre read becomes the
 *             only read and `credentialsCiphertext` is backfilled and dropped, or this whole
 *             module and the join go. There is no third option and no flag that becomes furniture.
 *
 * ONE THING IS NOT SHADOWED, DELIBERATELY: the ORIGIN BINDING is live from day one. The origin
 * resolver below prefers the Cofre item's own `boundOrigins` (and answers REFUSE when the grant is
 * revoked) over the previous derivation from the definition's action base URLs. That is not a
 * shadow, it is the security half of the slice, and it is safe to land ahead of the value cutover
 * because it only ever NARROWS: an integration with no item keeps exactly the binding it had.
 *
 * WHY NARROWING MATTERS (the acceptance criterion). Before B2 the allow-list for an integration's
 * credential was derived from that same integration's own action `baseUrl`s — a definition an agent
 * or a user AUTHORS. So the artifact being authorised and the artifact granting the authorisation
 * were the same file: adding an action pointing at `attacker.example` widened the credential's own
 * egress in the same edit. After B2 the allow-list is the set of hosts bound INTO the Cofre item at
 * the moment the human typed the credentials, and an authored action naming a host outside it is
 * refused at `assertOriginAllowed` before any request is issued.
 *
 * ================================ KNOWN, JOURNALED RESIDUALS ================================
 * 1. ORG-SHARED CONFIGS. Cofre items are OWNER-scoped, never org-visible (decisions.md 2026-07-27,
 *    sub-decision (a)) — a credential is not a document. An org-admin's org-shared config therefore
 *    mints an item owned by that admin, and a same-org PEER's run sees `unreachable` and keeps the
 *    pre-WS-C binding. Nothing is weakened for them; they simply are not yet covered. Widening the
 *    Cofre to an org-visible tier is a tenancy decision, not something a shadow may take on the
 *    way past, so it is the explicit question for the 2026-08-15 review.
 * 2. RESERVED ROWS (platform-oauth / pipedream) are out of WS-C scope by RUN_SPEC assumption 4 and
 *    are filtered out by the CALLER (`integrations/service.ts`), which owns that predicate.
 */
import type { Actor } from '@ekoa/shared';
import {
  mintIntegrationCredentialItem,
  updateIntegrationCredentialValue,
  findIntegrationCredentialItem,
  integrationOriginScope,
  unwrapForIntegration,
  discardIntegrationCredentialItem,
  CofreLockedError,
  CredentialOriginError,
  type IntegrationItemLink,
} from '../cofre/index.js';
import { originFromBaseUrl } from '../security/origin-binding.js';
import { resolveDefinition } from './definition-registry.js';

/**
 * The part of an `IntegrationConfigDoc` this module needs. Structural rather than an import so the
 * dependency runs ONE way (`service.ts` -> here) with no import cycle, even a type-only one.
 */
export interface IntegrationCredentialConfig {
  _id: string;
  orgId: string;
  integrationKey: string;
  name?: string;
  /** The WS-C join: the Cofre item shadowing this config's credentials. Server-stamped. */
  cofreItemId?: string;
  /** The legacy column — still the live read until the 2026-08-15 cutover. */
  credentialsCiphertext?: string;
}

/** The link identifying this config's credential item, in both directions. */
export function linkForConfig(config: IntegrationCredentialConfig): IntegrationItemLink {
  return { integrationKey: config.integrationKey, configId: config._id };
}

// ---------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------

/**
 * The hosts an integration DECLARES, derived from its own action base URLs — the pre-WS-C binding,
 * lifted verbatim out of the composition root so the fallback and the mint-time binding are the one
 * implementation instead of two that can drift.
 *
 * Tenant-scoped through `resolveDefinition` (A2): the same key resolves to a different package per
 * org, so resolving it unscoped would bind one org's credential to another org's declared hosts. A
 * templated host (`{{region}}.api.example.com`) is SKIPPED rather than pinned — binding to a pattern
 * would match more than it should. An integration with no usable declared host yields an EMPTY list,
 * and every consumer of this list treats empty as refuse.
 */
export async function declaredOriginsForIntegration(actor: Actor, integrationKey: string): Promise<string[]> {
  const def = await resolveDefinition(actor, integrationKey);
  if (!def) return [];
  const origins = new Set<string>();
  for (const action of Object.values(def.actions ?? {})) {
    const baseUrl = (action as { httpConfig?: { baseUrl?: string } }).httpConfig?.baseUrl;
    if (!baseUrl) continue;
    const host = originFromBaseUrl(baseUrl);
    if (host) origins.add(host);
  }
  return [...origins];
}

/**
 * THE ORIGIN-RESOLVER BODY (the `setIntegrationOriginResolver` seam, re-pointed at the Cofre).
 *
 * Resolution order, and why each branch is what it is:
 *   1. The actor's config for this key holds a Cofre item they own and a LIVE grant -> the item's
 *      own `boundOrigins`. This is the granted scope, fixed when the human typed the credentials;
 *      an action authored afterwards cannot extend it.
 *   2. The item is theirs but LOCKED -> `[]`, i.e. refuse. Lock is the kill switch and it must not
 *      be routed around by falling back to a wider list.
 *   3. No item is reachable (not migrated yet, or an org-shared config used by a peer) -> the
 *      pre-WS-C declared-origin derivation, unchanged. Additive: an integration that worked
 *      yesterday works today (Rule 7).
 *
 * `findConfigForOwner` is injected rather than imported so this module stays free of an import
 * cycle with `service.ts`, which calls the mint below.
 */
export async function egressOriginsForIntegration(
  actor: Actor,
  integrationKey: string,
  findConfig: (orgId: string, ownerUserId: string, key: string) => Promise<IntegrationCredentialConfig | null>,
  now = Date.now(),
): Promise<string[]> {
  const config = await findConfig(actor.orgId, actor.userId, integrationKey);
  if (config?.cofreItemId) {
    const scope = await integrationOriginScope(actor, config.cofreItemId, linkForConfig(config), now);
    if (scope.kind === 'granted') return scope.origins;
    if (scope.kind === 'locked') return [];
  }
  return declaredOriginsForIntegration(actor, integrationKey);
}

// ---------------------------------------------------------------------------
// The shadow write
// ---------------------------------------------------------------------------

/**
 * Mint (or refresh) the Cofre item shadowing this config's credentials. Returns the item id to
 * stamp onto the config row, or null when no item could be minted.
 *
 * NULL IS NOT AN ERROR AND IS NOT SWALLOWED SILENTLY: it means the integration declares no usable
 * host, so an origin-bound item would be refused at mint (`mintCofreItem` fails a `password`/
 * `api_key` with an empty binding by design — unbound is not unrestricted). Such an integration's
 * credential is equally refused on the api_call rail today, so the shadow simply has nothing to
 * hold; the comparator reports `shadow_absent` and the Rule-10 review sees the count.
 *
 * A REFRESH KEEPS THE GRANT STATE (see `updateIntegrationCredentialValue`): rotating credentials
 * must not silently undo a lock the user set.
 *
 * Infrastructure failures are caught, logged and turned into null. The shadow must never be able to
 * break the connect flow it is shadowing — that is the whole point of a shadow — but a mint that
 * failed is visible both in the log and, later, as `shadow_absent` at every read.
 */
export async function mintOrRefreshCredentialShadow(
  actor: Actor,
  config: IntegrationCredentialConfig,
  values: Record<string, unknown>,
): Promise<string | null> {
  const link = linkForConfig(config);
  try {
    const boundOrigins = await declaredOriginsForIntegration(actor, config.integrationKey);
    if (config.cofreItemId) {
      const rotation = await updateIntegrationCredentialValue(
        actor,
        config.cofreItemId,
        link,
        values,
        boundOrigins,
      );
      if (rotation === 'updated') return config.cofreItemId;
      if (rotation === 'foreign') {
        // The item belongs to ANOTHER user — the org-shared case: two org-admins share the config
        // and the second one rotates it. Minting a replacement would move custody to the writer AND
        // strand the first admin's item, still auto-granted, joined to nothing. Keep the join; the
        // comparator now reports `drift` to the owner and `shadow_unreachable` to the writer, which
        // is the honest description of what just happened and is what the 2026-08-15 review needs.
        console.warn(
          `[credential-cofre] WS-C shadow not rotated for ${config.integrationKey}: the joined item belongs to another user (org-shared custody); the join is left intact`,
        );
        return config.cofreItemId;
      }
      // `stale` — the id names nothing reachable, or one of this actor's own items under a
      // different link. A fresh mint orphans nobody and unsticks a config whose item was deleted.
    }
    if (boundOrigins.length === 0) return null;
    const item = await mintIntegrationCredentialItem(actor, {
      link,
      label: config.name ?? config.integrationKey,
      values,
      boundOrigins,
    });
    return item._id;
  } catch (err) {
    console.warn(
      `[credential-cofre] WS-C shadow mint failed for ${config.integrationKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Disconnecting an integration destroys its shadow item and every grant on it. Never throws. */
export async function discardCredentialShadow(actor: Actor, config: IntegrationCredentialConfig): Promise<void> {
  if (!config.cofreItemId) return;
  try {
    await discardIntegrationCredentialItem(actor, config.cofreItemId, linkForConfig(config));
  } catch (err) {
    console.warn(
      `[credential-cofre] WS-C shadow discard failed for ${config.integrationKey}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// The comparator
// ---------------------------------------------------------------------------

/**
 * What a cutover-today would do for this config.
 *   - `match`              both stores decrypt to the same bundle under the same policy. Ready.
 *   - `drift`              both readable, values disagree. A write reached one store and not the
 *                          other; the field NAMES are reported so it is diagnosable without a value.
 *   - `legacy_absent`      the config carries no ciphertext — nothing to compare against.
 *   - `shadow_absent`      no item joined (not migrated yet, or the mint had no origin to bind to).
 *   - `shadow_unreachable` an item id is joined but no such item is visible to this reader under
 *                          this link — the org-shared-peer residual, or a tampered/stale id.
 *   - `shadow_locked`      the user revoked the grant. At cutover this read REFUSES, correctly.
 *   - `shadow_refused`     an active grant, but the item's bound origins no longer cover the host
 *                          the definition now declares. The single most useful pre-cutover signal:
 *                          it names the integrations whose authored actions have drifted away from
 *                          the scope the human granted.
 *   - `shadow_error`       anything else (a decrypt/parse failure). Never silent.
 */
export type CredentialShadowStatus =
  | 'match'
  | 'drift'
  | 'legacy_absent'
  | 'shadow_absent'
  | 'shadow_unreachable'
  | 'shadow_locked'
  | 'shadow_refused'
  | 'shadow_error';

/**
 * The comparator's verdict. CARRIES NO CREDENTIAL VALUE and must never be given one: it is logged,
 * and at cutover it is what the review reads. `driftKeys` are CONFIG-FIELD NAMES, which are already
 * public in the definition's `configSchema` (`GET /api/v1/integrations` returns them) — never the
 * values behind them. This is the `secretregistry-serialized-credentials-in-plaintext` class
 * (docs/findings.md): a type that rides on a logged result must be safe to serialise in full.
 */
export interface CredentialShadowReport {
  status: CredentialShadowStatus;
  integrationKey: string;
  configId: string;
  itemId?: string;
  /** Field NAMES whose values differ between the two stores, or exist in only one. Never values. */
  driftKeys?: string[];
}

/** Field names that disagree between the live bundle and the shadow bundle. Names only. */
function driftingKeys(legacy: Record<string, string>, shadow: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(legacy), ...Object.keys(shadow)]);
  return [...keys].filter((k) => legacy[k] !== shadow[k]).sort();
}

/**
 * Read this config's credentials back through the Cofre and compare them with what the live column
 * just produced. NEVER THROWS: a comparator that can break the path it is measuring is worse than
 * no comparator.
 *
 * THE USAGE ORIGIN IS THE DEFINITION'S OWN DECLARED HOST, not one derived from the item, and that
 * choice is what makes the origin ground non-tautological: it asks "would this credential still be
 * allowed to reach the host this integration actually calls today?". When the definition declares no
 * host at all (it was edited after the connect), the item's own first bound origin is used — the
 * origin question is moot there because the api_call rail refuses an empty declared list anyway, and
 * the DATA question is still worth answering.
 */
export async function compareCredentialShadow(
  actor: Actor,
  config: IntegrationCredentialConfig,
  legacyFields: Record<string, string>,
): Promise<CredentialShadowReport> {
  const base = { integrationKey: config.integrationKey, configId: config._id };
  if (!config.credentialsCiphertext) return { ...base, status: 'legacy_absent' };
  if (!config.cofreItemId) return { ...base, status: 'shadow_absent' };
  const link = linkForConfig(config);
  const itemId = config.cofreItemId;
  try {
    const item = await findIntegrationCredentialItem(actor, itemId, link);
    if (!item) return { ...base, status: 'shadow_unreachable' };
    const declared = await declaredOriginsForIntegration(actor, config.integrationKey);
    const origin = declared[0] ?? item.boundOrigins[0];
    if (!origin) return { ...base, itemId, status: 'shadow_error' };
    const { fields } = await unwrapForIntegration(actor, itemId, link, { kind: 'http', origin });
    const driftKeys = driftingKeys(legacyFields, fields);
    return driftKeys.length > 0
      ? { ...base, itemId, status: 'drift', driftKeys }
      : { ...base, itemId, status: 'match' };
  } catch (err) {
    if (err instanceof CofreLockedError) return { ...base, itemId, status: 'shadow_locked' };
    if (err instanceof CredentialOriginError) return { ...base, itemId, status: 'shadow_refused' };
    return { ...base, itemId, status: 'shadow_error' };
  }
}

/**
 * Log a comparator verdict — ONLY when it changes for that config.
 *
 * The credential loader runs on every api_call step and every listener tick, so an unconditional
 * line would be a per-minute log flood per integration, which is how a signal becomes noise and then
 * becomes filtered out entirely. A transition IS the event worth reading: "config X went match ->
 * drift" is the Rule-10 alarm; "config X is still match" is not.
 */
const lastReported = new Map<string, CredentialShadowStatus>();
const MAX_TRACKED_CONFIGS = 1000;

export function reportCredentialShadow(report: CredentialShadowReport): void {
  if (lastReported.get(report.configId) === report.status) return;
  if (lastReported.size >= MAX_TRACKED_CONFIGS) lastReported.clear();
  lastReported.set(report.configId, report.status);
  if (report.status === 'match') return; // the healthy steady state is not news
  const drift = report.driftKeys?.length ? ` fields=[${report.driftKeys.join(',')}]` : '';
  console.warn(
    `[credential-cofre] WS-C shadow ${report.status} for ${report.integrationKey} (config ${report.configId})${drift}`,
  );
}

export function __resetCredentialShadowReportingForTests(): void {
  lastReported.clear();
}
