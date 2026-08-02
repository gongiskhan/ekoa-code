/**
 * The integration-builder SAVE path (slice A3) — builder saves land in the tenant-scoped Mongo
 * store, PRIVATE BY DEFAULT, replacing the retired disk runtime tier (`writeRuntimePackage`).
 *
 * The contract:
 *   - A save creates/updates the acting user's OWN definition row ((actor.orgId, key), stamped
 *     from the verified actor — never from a request body). A NEW row is `visibility: 'private'`,
 *     `origin: {kind: 'authored'}`: sharing is E1's explicit surface (`setVisibility`), never a
 *     side effect of saving.
 *   - A RE-save updates the row's package content and PRESERVES its tier and provenance — an
 *     `org`-shared definition stays shared across an edit, and nothing here can touch `global`.
 *   - A RESERVED key (every shipped baseline package + `pipedream`) is refused, with NO
 *     loaded-session exemption (A2-residual 4): the old exemption let a builder session that had
 *     merely LOADED a shipped key clobber it in the process-wide runtime tier. The tenant either
 *     keeps the shipped package or forks it under a distinct key of their own.
 *   - A row currently `global` is refused: its content is what EVERY org resolves, so editing it
 *     is a publish-level action (slice E2's scrubbed-snapshot flow), not a builder save. This
 *     applies to super-admins too — uniform, so there is no path that mutates the published tier
 *     without the publish ceremony.
 *   - A key held by ANOTHER same-org user's row the actor may not write answers `key_taken`. The
 *     one-row-per-(org,key) primitive makes an in-org existence signal unavoidable here; the
 *     cross-org no-existence-oracle posture is untouched (another org's rows never collide — the
 *     `_id` hashes the orgId).
 *
 * `fieldsFromPackageConfig` is the ONE mapping from the canonical `IntegrationPackageConfig`
 * (what the builder emits / config.json holds) onto the stored document's content fields — shared
 * with the boot legacy importer so the two write paths can never drift.
 */
import type { Actor } from '@ekoa/shared';
import {
  reservedIntegrationKeys,
  type IntegrationPackageConfig,
} from './definitions.js';
import {
  integrationDefinitionStore,
  definitionIdFor,
  canWriteDefinition,
  IntegrationDefinitionStore,
  IntegrationDefinitionStoreError,
  type IntegrationDefinitionDoc,
} from './definition-store.js';

/** Well-formed integration key (the builder parser's rule, re-checked at the write seam). */
const SAVE_KEY_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

/** The package-content subset of the stored document — everything a save may rewrite. Absent
 *  optionals are OMITTED, never written as explicit `undefined`: the Mongo driver serialises an
 *  `undefined` property as `null`, and the shared read schemas type these fields `.optional()`
 *  (undefined-or-absent, `null` REJECTED) — the exact silent-blank failure `triggerView`
 *  (events/service.ts) documents. */
export function fieldsFromPackageConfig(config: IntegrationPackageConfig, skillMd: string) {
  return {
    key: config.integrationKey,
    ...(config.displayName !== undefined ? { displayName: config.displayName } : {}),
    ...(config.description !== undefined ? { description: config.description } : {}),
    ...(config.version !== undefined ? { version: config.version } : {}),
    ...(config.authType !== undefined ? { authType: config.authType } : {}),
    ...(config.provider !== undefined ? { provider: config.provider } : {}),
    ...(config.category !== undefined ? { category: config.category } : {}),
    configSchema: config.configSchema ?? [],
    actions: config.actions ?? [],
    ...(config.credentialGuide !== undefined ? { credentialGuide: config.credentialGuide } : {}),
    ...(config.sessionConnect !== undefined ? { sessionConnect: config.sessionConnect } : {}),
    ...(config.webhookConfig !== undefined ? { webhookConfig: config.webhookConfig } : {}),
    ...(config.listenerConfig !== undefined ? { listenerConfig: config.listenerConfig } : {}),
    skillMd,
  };
}

export type SaveAuthoredResult =
  | { ok: true; doc: IntegrationDefinitionDoc; created: boolean }
  | { ok: false; code: 'invalid_key' | 'reserved_key' | 'key_taken' | 'published_row'; message: string };

/**
 * Persist the actor's authored integration package. See the module header for the contract; the
 * store's own gates (actor congruence, non-empty identity, replace-write gate) run underneath as
 * belt-and-braces — this function never bypasses them.
 */
export async function saveAuthoredDefinition(
  actor: Actor,
  config: IntegrationPackageConfig,
  skillMd: string,
  store: IntegrationDefinitionStore = integrationDefinitionStore,
): Promise<SaveAuthoredResult> {
  const key = config.integrationKey;
  if (typeof key !== 'string' || !SAVE_KEY_RE.test(key)) {
    return { ok: false, code: 'invalid_key', message: `invalid integration key: ${JSON.stringify(key)}` };
  }
  if (reservedIntegrationKeys().has(key)) {
    return {
      ok: false,
      code: 'reserved_key',
      message: `integration key '${key}' names a shipped platform integration — save your version under a different key`,
    };
  }

  const content = fieldsFromPackageConfig(config, skillMd);
  const existing = await store.getById(definitionIdFor(actor.orgId, key));

  if (!existing) {
    // PRIVATE BY DEFAULT — the whole point of the slice. Publishing is a later, explicit act.
    const doc = await store.create(
      {
        ...content,
        orgId: actor.orgId,
        userId: actor.userId,
        visibility: 'private',
        origin: { kind: 'authored' },
      },
      { actor },
    );
    return { ok: true, doc, created: true };
  }

  if (!canWriteDefinition(existing, actor)) {
    return {
      ok: false,
      code: 'key_taken',
      message: `integration key '${key}' is already in use in your organisation — choose a different key`,
    };
  }
  if (existing.visibility === 'global') {
    return {
      ok: false,
      code: 'published_row',
      message: `integration '${key}' is published globally — a published definition is edited through the publish flow, not a builder save`,
    };
  }

  // Re-save: new content, SAME tier + provenance + authorship (an edit is not a share, an
  // un-share, or a change of author).
  const doc = await store.create(
    {
      ...content,
      orgId: existing.orgId,
      userId: existing.userId,
      visibility: existing.visibility,
      ...(existing.origin !== undefined ? { origin: existing.origin } : {}),
      ...(existing.lessons !== undefined ? { lessons: existing.lessons } : {}),
      ...(existing.publishedSnapshot !== undefined ? { publishedSnapshot: existing.publishedSnapshot } : {}),
      createdAt: existing.createdAt,
    },
    { actor, onConflict: 'replace' },
  );
  return { ok: true, doc, created: false };
}

export { IntegrationDefinitionStoreError };
