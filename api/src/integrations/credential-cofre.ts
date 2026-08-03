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
 * 1. ORG-SHARED CONFIGS: the VALUE, and only the value. Cofre items are OWNER-scoped (decisions.md
 *    2026-07-27, sub-decision (a)) — a credential is not a document — so an org-shared config's item
 *    belongs to the admin who typed it and a same-org PEER cannot READ it: the comparator answers
 *    `shadow_unreachable` for them and a cutover today would leave that class unreadable. That is
 *    the explicit question for the 2026-08-15 review.
 *    WHAT IS NO LONGER RESIDUAL (B2 review C1/H1): the peer's EGRESS BINDING and the config's
 *    DESTRUCTION. Both now cross the owner boundary through the server-stamped join, because both
 *    are restrictions rather than disclosures — see the org-shared custody section of
 *    `cofre/integration-items.ts`. Until that landed, a peer of an org-shared config fell through to
 *    the definition-derived list, i.e. the author-widenable artifact this whole slice exists to stop
 *    trusting, and it was the ADMIN's credential that egressed to the author's new host.
 * 2. RESERVED ROWS (platform-oauth / pipedream) are out of WS-C scope by RUN_SPEC assumption 4 and
 *    are filtered out by the CALLER (`integrations/service.ts`), which owns that predicate.
 * 3. THE RAILS THE COMPARATOR DOES NOT COVER, named rather than implied — see
 *    `observeCredentialShadow`.
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
  type IntegrationItemAccess,
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
  /**
   * Undefined means ORG-SHARED (org-admin-authored, usable by the whole org); a value means
   * owner-only. Load-bearing here, not decoration: it is what tells the Cofre join that a reader or
   * a deleter who does not own the item may still be the config's legitimate holder.
   */
  ownerUserId?: string;
  /** The WS-C join: the Cofre item shadowing this config's credentials. Server-stamped. */
  cofreItemId?: string;
  /** The legacy column — still the live read until the 2026-08-15 cutover. */
  credentialsCiphertext?: string;
}

/** The link identifying this config's credential item, in both directions. */
export function linkForConfig(config: IntegrationCredentialConfig): IntegrationItemLink {
  return { integrationKey: config.integrationKey, configId: config._id };
}

/** The access this config grants over its joined item: org-shared configs reach the owner's item
 *  for RESTRICTION and DESTRUCTION only (see `cofre/integration-items.ts`). One expression of the
 *  predicate, so no call site can quietly disagree about which configs are shared. */
function accessForConfig(config: IntegrationCredentialConfig, now?: number): IntegrationItemAccess {
  return { sharedConfig: config.ownerUserId == null, ...(now !== undefined ? { now } : {}) };
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
 * THE RULE, IN ONE LINE: a config that HAS a joined item is governed by that item, whoever is
 * reading. The fallback exists for configs that have NO item, and for nothing else.
 *
 * Resolution order, and why each branch is what it is:
 *   1. The config holds a Cofre item with a LIVE grant -> the item's own `boundOrigins`. This is
 *      the granted scope, fixed when the human typed the credentials; an action authored afterwards
 *      cannot extend it. For an ORG-SHARED config the item is the admin author's, and the peer gets
 *      the admin's granted scope (see `cofre/integration-items.ts` on why a restriction may cross
 *      the owner boundary when a value may not).
 *   2. The item is joined but LOCKED, or joined and NOT REACHABLE -> `[]`, i.e. refuse. Lock is the
 *      kill switch. Unreachable-despite-a-join means the item was deleted out from under the config
 *      or the id was tampered with; falling back there would restore the wider list precisely when
 *      the narrower authority has gone missing. Re-saving the config re-mints and unsticks it.
 *   3. No item at all -> the pre-WS-C declared-origin derivation, unchanged. Additive: an
 *      integration that worked yesterday works today (Rule 7).
 *
 * WHAT BRANCH 2 FIXES (B2 review C1). It used to fall through to branch 3 on `unreachable`, and for
 * the whole ORG-SHARED class that was every peer, every run: `bob`, role `user`, owning nothing and
 * having typed nothing, got the AUTHOR-WIDENED definition list for the ADMIN's credential — a host
 * added to the definition after the connect was sent the admin's secret, through the real
 * `executeApiCallStep`. Not cross-tenant and not a regression (pre-B2 everyone got that list), but
 * the slice's acceptance criterion was unmet for the entire class while the journal called it benign.
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
    const scope = await integrationOriginScope(
      actor,
      config.cofreItemId,
      linkForConfig(config),
      accessForConfig(config, now),
    );
    return scope.kind === 'granted' ? scope.origins : [];
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
        accessForConfig(config),
      );
      if (rotation === 'updated') return config.cofreItemId;
      if (rotation === 'foreign') {
        // The item exists and belongs to ANOTHER user, and this config did not authorise reaching
        // it (it is owner-scoped, or the item is in another org). Minting a replacement would move
        // custody to the writer AND strand the original owner's item, still auto-granted, joined to
        // nothing. Keep the join; the comparator reports `drift` to the owner and
        // `shadow_unreachable` to the writer, which is the honest description of what happened.
        //
        // The ORG-SHARED case no longer arrives here (B2 review H2/C1): two org-admins sharing a
        // config now rotate the SAME item in place — custody is unchanged, which is 46df997's
        // property, but the shadow stays in step instead of drifting permanently from the first
        // rotation onward.
        console.warn(
          `[credential-cofre] WS-C shadow not rotated for ${config.integrationKey}: the joined item belongs to another user and this config does not reach it; the join is left intact`,
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
    console.warn(`[credential-cofre] WS-C shadow mint failed for ${config.integrationKey}: ${errorKind(err)}`);
    return null;
  }
}

/**
 * The CLASS of a failure, never its text (B2 review L2).
 *
 * Both catch blocks around this line sit downstream of a bundle that was in plaintext microseconds
 * earlier: a serialisation error carries the offending value's own `toJSON`/getter message, an
 * envelope error carries whatever the crypto layer or a third-party library put in it. Logging that
 * verbatim puts unbounded, externally-influenced text on a secret-adjacent path — the
 * `secretregistry-serialized-credentials-in-plaintext` class of defect, arrived at from the other
 * end. The constructor name is what actually distinguishes these failures in practice (a
 * `CofreLockedError` from a `CredentialOriginError` from a `TypeError`), and the statuses the
 * comparator reports are the diagnosis surface — not this line.
 */
function errorKind(err: unknown): string {
  if (err instanceof Error) return err.constructor?.name || err.name || 'Error';
  return typeof err;
}

/**
 * What became of a config's shadow item when the config was deleted. NOT a boolean, and not
 * discarded (B2 review H1): the failure mode this path had was SILENT, so the outcome has to be
 * expressible.
 *   - `discarded` the item and every grant on it are gone.
 *   - `absent`    the config carried no join — nothing to destroy.
 *   - `orphaned`  a join existed and the item did not go. It is still out there, still granted, and
 *                 no longer reachable through any config: an operator has to be told.
 *   - `error`     the discard threw. Same consequence as `orphaned`, different cause.
 */
export type CredentialShadowDiscard = 'discarded' | 'absent' | 'orphaned' | 'error';

/** Disconnecting an integration destroys its shadow item and every grant on it. Never throws. */
export async function discardCredentialShadow(
  actor: Actor,
  config: IntegrationCredentialConfig,
): Promise<CredentialShadowDiscard> {
  if (!config.cofreItemId) return 'absent';
  try {
    const discarded = await discardIntegrationCredentialItem(
      actor,
      config.cofreItemId,
      linkForConfig(config),
      accessForConfig(config),
    );
    if (discarded) return 'discarded';
    // A live, auto-granted, fully extractable credential for an integration the user just removed.
    // Loud by construction: this used to return void and the caller used to discard the boolean, so
    // the exact failure the reviewer reproduced left no trace anywhere.
    console.warn(
      `[credential-cofre] WS-C shadow ORPHANED for ${config.integrationKey} (config ${config._id}): the joined credential item was not reachable and survives the config's deletion, still granted`,
    );
    return 'orphaned';
  } catch (err) {
    console.warn(
      `[credential-cofre] WS-C shadow discard failed for ${config.integrationKey} (config ${config._id}): ${errorKind(err)}; the item may survive the config, still granted`,
    );
    return 'error';
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
 * Log a comparator verdict — ONLY when it changes for that config AND THAT READER.
 *
 * The credential loader runs on every api_call step, so an unconditional line would be a per-minute
 * log flood per integration, which is how a signal becomes noise and then becomes filtered out
 * entirely. A transition IS the event worth reading: "config X went match -> drift" is the Rule-10
 * alarm; "config X is still match" is not.
 *
 * KEYED ON (config, reader), not on the config alone (B2 review M3). One org-shared config has many
 * readers and they legitimately get DIFFERENT verdicts — the admin who owns the item reads `match`,
 * a peer reads `shadow_unreachable`. Under a config-only key those two alternate forever, so every
 * single read was a transition and the de-dup produced exactly the flood it was written to prevent
 * (measured: 6 lines for 12 reads). The reader is part of the verdict, so it is part of the key.
 */
const lastReported = new Map<string, { status?: CredentialShadowStatus; sampledAt?: number }>();
const MAX_TRACKED_READERS = 1000;

/** The de-dup / sampling key: a verdict belongs to a (config, reader) pair, never to a config. */
function shadowKey(configId: string, readerUserId: string): string {
  return `${configId}|${readerUserId}`;
}

function trackerFor(key: string): { status?: CredentialShadowStatus; sampledAt?: number } {
  const existing = lastReported.get(key);
  if (existing) return existing;
  if (lastReported.size >= MAX_TRACKED_READERS) lastReported.clear();
  const fresh = {};
  lastReported.set(key, fresh);
  return fresh;
}

export function reportCredentialShadow(report: CredentialShadowReport, readerUserId = ''): void {
  const tracker = trackerFor(shadowKey(report.configId, readerUserId));
  if (tracker.status === report.status) return;
  tracker.status = report.status;
  if (report.status === 'match') return; // the healthy steady state is not news
  const drift = report.driftKeys?.length ? ` fields=[${report.driftKeys.join(',')}]` : '';
  console.warn(
    `[credential-cofre] WS-C shadow ${report.status} for ${report.integrationKey} (config ${report.configId})${drift}`,
  );
}

/**
 * How often ONE (config, reader) pair is actually measured. See `observeCredentialShadow`.
 */
export const CREDENTIAL_SHADOW_SAMPLE_INTERVAL_MS = 60_000;

/**
 * THE COMPARATOR'S ONE ENTRY POINT for a live credential read: measure, report, never throw, and
 * never measure more often than the migration can change (B2 review L1 + M1 + M2).
 *
 * SAMPLED, AND WHY THE SAMPLE IS NOT BIASED. A full comparison costs an item read, a grant list, a
 * tenant definition resolve and a second decrypt — measured at 6.2x the legacy-only read, paid on
 * every api_call step of every run. What it measures, though, is a STEP FUNCTION, not a per-read
 * random variable: a config is `match` until a write lands in one store and not the other, and then
 * it is `drift` until something fixes it. Sampling the first read of each (config, reader) per
 * minute therefore observes every state the unsampled comparator would observe, with a detection
 * latency bounded by the interval — it cannot miss a transition, only date it up to a minute late.
 * A sample that dropped reads at random WOULD be biased (short-lived runs would under-report), which
 * is why this is a time window per pair rather than a probability per read.
 *
 * NEVER THROWS, and it is called OUTSIDE the caller's own `try`. `compareCredentialShadow` already
 * absorbs everything, but the reporting around it did not: while the observer sat inside the live
 * read's `try { … } catch { return null }`, any throw on the measurement path would have been
 * indistinguishable from "this integration is not connected" (B2 review L1).
 *
 * WHICH RAILS ACTUALLY REACH THIS — stated exactly, because B2's own claim ("every real credential
 * read, per api_call step and per listener tick") was wrong in both directions:
 *   - COVERED: the automation `api_call` rail (`loadIntegrationCredentialFields` below, wired into
 *     `setIntegrationCredentialLoader`) and the served-app Zoho Sign rail
 *     (`integrations/zoho-sign.ts`, through its injected `observeCredentialRead`).
 *   - NOT COVERED: `integrations/action-executor.ts`, which decrypts the config itself. That is
 *     BOTH the integration-action route and the listener rail (`event-sources/user-defined-poll.ts`
 *     polls through that executor), so listener ticks are not measured at all. It is a live surface
 *     of another slice at the time of writing and could not be touched here; the 2026-08-15 review
 *     must read the census as "the api_call and Zoho rails", not "every read".
 */
export async function observeCredentialShadow(
  actor: Actor,
  config: IntegrationCredentialConfig,
  legacyFields: Record<string, string>,
  now = Date.now(),
): Promise<void> {
  try {
    const tracker = trackerFor(shadowKey(config._id, actor.userId));
    if (tracker.sampledAt !== undefined && now - tracker.sampledAt < CREDENTIAL_SHADOW_SAMPLE_INTERVAL_MS) return;
    tracker.sampledAt = now;
    reportCredentialShadow(await compareCredentialShadow(actor, config, legacyFields), actor.userId);
  } catch {
    // A comparator that can break the path it measures is worse than no comparator. There is
    // nothing useful to log here either: the logging is what would have thrown.
  }
}

export function __resetCredentialShadowReportingForTests(): void {
  lastReported.clear();
}

// ---------------------------------------------------------------------------
// The live credential read
// ---------------------------------------------------------------------------

/** The stores and crypto the live read needs, injected so this body is a testable function rather
 *  than a lambda in the composition root — the A2 review's dead-code class. */
export interface CredentialReadDeps {
  /** users.get(...).orgId. Null when the user has no org: fail closed, never resolve a tenant. */
  resolveOwnerOrgId: (ownerUserId: string) => Promise<string | null>;
  findConfig: (orgId: string, ownerUserId: string, key: string) => Promise<IntegrationCredentialConfig | null>;
  /** The org-bound versioned envelope (K-1); v1 rows read unchanged. */
  decrypt: (ciphertext: string, orgId: string) => Promise<string>;
}

/**
 * THE LIVE CREDENTIAL READ for the automation `api_call` rail (the `setIntegrationCredentialLoader`
 * seam's body). Still the LEGACY column — `credentialsCiphertext` decides what the step
 * interpolates, exactly as before B2 — with the Cofre comparison running beside it.
 *
 * The measurement is OUTSIDE the decrypt's `try`: "the credential did not decrypt" and "the
 * measurement of the credential failed" must never be the same answer to the caller, and while the
 * observer sat inside that block the second silently became "integration not connected" (L1).
 */
export async function loadIntegrationCredentialFields(
  deps: CredentialReadDeps,
  integrationKey: string,
  ownerUserId: string,
): Promise<Record<string, string> | null> {
  const orgId = await deps.resolveOwnerOrgId(ownerUserId);
  if (!orgId) return null;
  const config = await deps.findConfig(orgId, ownerUserId, integrationKey);
  if (!config?.credentialsCiphertext) return null;
  let fields: Record<string, string>;
  try {
    const values = JSON.parse(await deps.decrypt(config.credentialsCiphertext, config.orgId)) as Record<string, unknown>;
    fields = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
  } catch {
    return null;
  }
  await observeCredentialShadow({ userId: ownerUserId, orgId, role: 'user' }, config, fields);
  return fields;
}
