/**
 * The collections engine (FIXED-5, ch04 §4.2). One generic deterministic data API over
 * Firestore serving every user app from a per-app manifest. One physical collection
 * (`app_data`) holds every logical collection of every app; documents are
 *   { _id: "<scopeKey>::<collection>::<itemId>", appId, collection, item, _rev }
 * The eight carried semantics (§4.2.8) are all implemented here: scoping via a single
 * query-binding point, shared `usr.<owner>` scope, charset guard, `_rev` CAS, envelope,
 * PUT-upsert, seed routing (all writes go through this module), parity (one driver).
 */
import { z } from 'zod';
import type { Collection, Filter } from 'mongodb';
import { getDb } from './mongo.js';

export const APP_DATA_COLLECTION = 'app_data';

/** The physical app_data document shape (ch04 §4.2.2). String `_id`, not ObjectId. */
interface AppDataDoc {
  _id: string;
  appId: string;
  collection: string;
  item: Record<string, unknown>;
  _rev: number;
}

// ---- Manifest schema (app-facing zod; lives in data/, not shared/ — ch04 §4.2.3) ----
export const collectionName = z
  .string()
  .regex(/^[a-zA-Z0-9._-]{1,100}$/)
  .refine((n) => !n.startsWith('__') && !n.startsWith('usr.'), 'reserved prefix');

export const fieldRule = z.object({
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
  required: z.boolean().default(false),
  maxLength: z.number().int().positive().optional(),
  pattern: z.string().optional(),
  enum: z.array(z.string()).optional(),
});

export const accessLevel = z.enum(['app', 'session', 'server']);

export const collectionRule = z.object({
  scope: z.enum(['app', 'shared']).default('app'),
  fields: z.record(collectionName, fieldRule).optional(),
  additionalFields: z.boolean().default(true),
  access: z
    .object({ read: accessLevel.default('app'), write: accessLevel.default('app') })
    .default({ read: 'app', write: 'app' }),
  maxItemBytes: z.number().int().positive().max(900_000).default(262_144),
});

export const collectionsBlock = z.object({
  declaredOnly: z.boolean().default(false),
  definitions: z.record(collectionName, collectionRule),
});
export type CollectionsBlock = z.infer<typeof collectionsBlock>;

const CHARSET = /^[a-zA-Z0-9._-]{1,100}$/;

export class EngineError extends Error {
  constructor(public code: string, public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export interface Scope {
  /** canonical app id, or `usr.<ownerUserId>` for shared scope (server-resolved only). */
  scopeKey: string;
  appId: string;
}

/** One logical collection a scope holds, by NAME and by the field names its rows carry. Never a
 *  value: this is the shape `listCollectionFields` answers, and its only consumer puts it in a
 *  prompt. */
export interface CollectionFields {
  name: string;
  /** Every field name appearing on any row of this collection, sorted. */
  fields: string[];
}

/** The single query-binding point: every driver query is built through this (§4.2.8 #1). */
function docId(scope: Scope, collection: string, itemId: string): string {
  return `${scope.scopeKey}::${collection}::${itemId}`;
}

function col(): Collection<AppDataDoc> {
  return getDb().collection<AppDataDoc>(APP_DATA_COLLECTION);
}

/** Typed _id filter (string _id, not ObjectId). */
function idFilter(_id: string, extra?: Partial<AppDataDoc>): Filter<AppDataDoc> {
  return { _id, ...extra } as Filter<AppDataDoc>;
}

function guardCollectionName(name: string): void {
  if (!CHARSET.test(name)) throw new EngineError('INVALID_COLLECTION', 400, `Invalid collection name: ${name}`);
  if (name.startsWith('__')) throw new EngineError('RESERVED_COLLECTION', 403, `Reserved collection: ${name}`);
  if (name.startsWith('usr.')) throw new EngineError('RESERVED_COLLECTION', 403, `Reserved collection: ${name}`);
}

/** Validate a persisted record against a declared collection's field rules (§4.2.4 step 4). */
function validateItem(rule: z.infer<typeof collectionRule> | undefined, item: Record<string, unknown>): void {
  if (!rule?.fields) return;
  const failures: Array<{ field: string; rule: string }> = [];
  for (const [field, fr] of Object.entries(rule.fields)) {
    const v = item[field];
    if (fr.required && (v === undefined || v === null)) failures.push({ field, rule: 'required' });
    if (v === undefined || v === null) continue;
    if (fr.type === 'string' && typeof v === 'string') {
      if (fr.maxLength && v.length > fr.maxLength) failures.push({ field, rule: 'maxLength' });
      if (fr.pattern && !new RegExp(fr.pattern).test(v)) failures.push({ field, rule: 'pattern' });
      if (fr.enum && !fr.enum.includes(v)) failures.push({ field, rule: 'enum' });
    }
  }
  if (failures.length > 0) {
    throw new EngineError('VALIDATION_FAILED', 422, 'Dados inválidos para a coleção.', { fields: failures });
  }
}

function nowIso(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** A supplied timestamp survives an import only when it is a non-empty parseable date string
 *  (kept VERBATIM - never re-serialized); anything else falls back to the server stamp. */
function importedTimestamp(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v)) ? v : undefined;
}

export interface EngineDeps {
  now: () => number;
  genId: () => string;
}

export class CollectionsEngine {
  constructor(private deps: EngineDeps) {}

  async list(scope: Scope, collection: string): Promise<Record<string, unknown>[]> {
    guardCollectionName(collection);
    const docs = await col()
      .find({ appId: scope.scopeKey, collection })
      .sort({ 'item.createdAt': 1, _id: 1 })
      .toArray();
    return docs.map((d) => d.item);
  }

  async get(scope: Scope, collection: string, id: string): Promise<Record<string, unknown> | null> {
    guardCollectionName(collection);
    const d = await col().findOne({ _id: docId(scope, collection, id), appId: scope.scopeKey, collection });
    return d ? d.item : null;
  }

  async create(
    scope: Scope,
    collection: string,
    body: Record<string, unknown>,
    rule?: z.infer<typeof collectionRule>,
  ): Promise<Record<string, unknown>> {
    guardCollectionName(collection);
    const id = typeof body.id === 'string' && body.id ? body.id : this.deps.genId();
    const now = nowIso(this.deps.now());
    const { id: _drop, createdAt: _c, updatedAt: _u, ...fields } = body;
    const item = { id, createdAt: now, updatedAt: now, ...fields };
    this.checkSize(rule, item);
    validateItem(rule, item);
    try {
      await col().insertOne({ _id: docId(scope, collection, id), appId: scope.scopeKey, collection, item, _rev: 0 });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) {
        // id collision → treat as update-through-create is not allowed; surface conflict
        throw new EngineError('SLUG_TAKEN', 409, `Item id already exists: ${id}`);
      }
      throw e;
    }
    return item;
  }

  /**
   * Import-only create variant (S3 migration fidelity). Identical to `create` in every other
   * respect - name guard, size cap, field rules, id-collision refusal - but preserves the row's
   * own `createdAt`/`updatedAt` when they arrive as parseable date strings, server-stamping only
   * the absent/invalid ones. Without this every migrated record shows import day as its history.
   * NOT route-reachable: the served-app data plane and the backend-runtime `appData.*` capability
   * call `create` (which keeps re-stamping, unweakened); the only caller is the artifact-import
   * path (AppDataAccess.importDumpReport <- applyImportedAppData).
   */
  async importCreate(
    scope: Scope,
    collection: string,
    body: Record<string, unknown>,
    rule?: z.infer<typeof collectionRule>,
  ): Promise<Record<string, unknown>> {
    guardCollectionName(collection);
    const id = typeof body.id === 'string' && body.id ? body.id : this.deps.genId();
    const now = nowIso(this.deps.now());
    const { id: _drop, createdAt: suppliedCreatedAt, updatedAt: suppliedUpdatedAt, ...fields } = body;
    const item = {
      id,
      createdAt: importedTimestamp(suppliedCreatedAt) ?? now,
      updatedAt: importedTimestamp(suppliedUpdatedAt) ?? now,
      ...fields,
    };
    this.checkSize(rule, item);
    validateItem(rule, item);
    try {
      await col().insertOne({ _id: docId(scope, collection, id), appId: scope.scopeKey, collection, item, _rev: 0 });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) {
        throw new EngineError('SLUG_TAKEN', 409, `Item id already exists: ${id}`);
      }
      throw e;
    }
    return item;
  }

  /** PUT upsert (§4.2.8 #6): update-merge if present, create with the given id if absent. */
  async upsert(
    scope: Scope,
    collection: string,
    id: string,
    body: Record<string, unknown>,
    rule?: z.infer<typeof collectionRule>,
  ): Promise<Record<string, unknown>> {
    guardCollectionName(collection);
    const _id = docId(scope, collection, id);
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await col().findOne({ _id, appId: scope.scopeKey, collection });
      const now = nowIso(this.deps.now());
      if (!cur) {
        const { id: _di, createdAt: _c, updatedAt: _u, ...fields } = body;
        const item = { id, createdAt: now, updatedAt: now, ...fields };
        this.checkSize(rule, item);
        validateItem(rule, item);
        try {
          await col().insertOne({ _id, appId: scope.scopeKey, collection, item, _rev: 0 });
          return item;
        } catch (e) {
          if ((e as { code?: number }).code === 11000) continue; // raced; retry as update
          throw e;
        }
      }
      const prevItem = cur.item;
      const rev = cur._rev ?? 0;
      const { id: _di, createdAt: _c, updatedAt: _u, ...patch } = body;
      const item = { ...prevItem, ...patch, id, createdAt: prevItem.createdAt, updatedAt: now };
      this.checkSize(rule, item);
      validateItem(rule, item);
      const res = await col().replaceOne(
        idFilter(_id, { _rev: rev }),
        { appId: scope.scopeKey, collection, item, _rev: rev + 1 },
      );
      if (res.matchedCount === 1) return item;
    }
    throw new EngineError('INTERNAL', 500, 'Upsert CAS exhausted retries');
  }

  /** Returns true when an item was deleted, false when the id was absent (the
   *  served-app wire distinguishes `{success:true}` from 404 'Not found'). */
  async delete(scope: Scope, collection: string, id: string): Promise<boolean> {
    guardCollectionName(collection);
    const res = await col().deleteOne({ _id: docId(scope, collection, id), appId: scope.scopeKey, collection });
    return res.deletedCount === 1;
  }

  /**
   * WHICH logical collections this scope holds AND WHICH FIELDS their rows carry - the names of
   * both, never a value.
   *
   * Read-only, additive, and built on the SAME single query-binding point every other read uses
   * (`appId: scope.scopeKey`), so it cannot reach a scope the other reads cannot. It exists because
   * `achieve`'s compose rung has to NAME the caller's own collections in a prompt, and discovering
   * them by listing every row of each and looking at what came back would be a read of everybody's
   * data to answer a question about labels.
   *
   * IT RETURNS THE FIELDS BECAUSE A NAME ALONE IS NOT ENOUGH TO ASK THE QUESTION WITH. An earlier
   * shape answered names only, and the rung then asked a model to name a FIELD of one of these
   * collections that it had never been shown - so the only thing the model could do was invent an
   * identifier, and an invented field name does not fail: `matchesSimpleQuery` reads `undefined` off
   * every row and the join quietly returns a SHORTER LIST presented as the answer. Showing the
   * fields turns that guess into a selection from a known set, and a name outside the set into a
   * deterministic refusal (`integrations/action-compose.ts`, D-S5-5).
   *
   * THE FIELD SET IS EXACT RATHER THAN SAMPLED, and that is what makes the refusal fair: a sampled
   * union is a SUBSET of the real one, so a legitimate field the sample happened to miss would be
   * refused and the caller would lose a narrowing they were entitled to. The cost is one scan of
   * this scope, which is the same order as the `distinct` this replaced, on a path that is about to
   * spend a model call.
   *
   * A COLLECTION WHOSE ROWS CARRY NO FIELDS AT ALL STILL APPEARS, with an empty `fields` - it exists,
   * and a lister that dropped it would tell the caller they hold less than they do. (Every row this
   * engine writes carries `id`/`createdAt`/`updatedAt`, so that is a shape only a direct driver write
   * can produce; it is handled rather than assumed away.)
   */
  async listCollectionFields(scope: Scope): Promise<CollectionFields[]> {
    const grouped = await col()
      .aggregate<{ _id: unknown; fields: unknown[] }>([
        { $match: { appId: scope.scopeKey } },
        { $project: { collection: 1, field: { $map: { input: { $objectToArray: '$item' }, in: '$$this.k' } } } },
        { $unwind: { path: '$field', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$collection', fields: { $addToSet: '$field' } } },
      ])
      .toArray();
    return grouped
      .filter((g): g is { _id: string; fields: unknown[] } => typeof g._id === 'string')
      .map((g) => ({
        name: g._id,
        // BOTH SORTS ARE LOAD-BEARING, and neither is tidiness. These names go straight into a MODEL
        // PROMPT, so their order is part of the input to a nondeterministic step: unsorted, the
        // prompt varies with the driver's own return order and the same tenant asking the same goal
        // twice is asked a different question.
        fields: g.fields.filter((f): f is string => typeof f === 'string').sort(),
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  private checkSize(rule: z.infer<typeof collectionRule> | undefined, item: Record<string, unknown>): void {
    const max = rule?.maxItemBytes ?? 262_144;
    if (Buffer.byteLength(JSON.stringify(item), 'utf8') > max) {
      throw new EngineError('ITEM_TOO_LARGE', 413, 'Item excede o tamanho máximo.');
    }
  }
}

/** Resolve an app scope. A client-supplied id starting with `usr.` is rejected (§4.2.6 #2). */
export function appScope(appId: string): Scope {
  if (!CHARSET.test(appId)) throw new EngineError('INVALID_COLLECTION', 400, 'Invalid app id');
  if (appId.startsWith('usr.')) throw new EngineError('FORBIDDEN', 403, 'Reserved scope');
  return { scopeKey: appId, appId };
}

/** Resolve a shared owner scope. The owner comes from the server (registry), never the client. */
export function sharedScope(appId: string, ownerUserId: string): Scope {
  return { scopeKey: `usr.${ownerUserId}`, appId };
}

/**
 * THE SHARED SCOPE BY ITS ONLY REAL UNIT: the OWNER.
 *
 * `sharedScope` takes an `appId` and carries it on the returned `Scope`, which reads as though a
 * shared collection belonged to an app. IT DOES NOT, and the code above is unambiguous about it:
 * `docId` and every filter in this class bind on `scope.scopeKey` (`usr.<ownerUserId>`), while
 * `Scope.appId` is never part of any query. Two apps owned by the same person therefore address ONE
 * namespace - the owner's - and "the collections of app X" is not a question `app_data` can answer.
 *
 * A caller that reasons per-APP over shared rows is deciding on a unit the store does not have: it
 * sees one namespace as N sources, and it mistakes "an app I may see" for "its owner's data I may
 * read". Both are wrong, and both cost `achieve`'s compose rung a round (`docs/decisions.md`,
 * D-S5-1). A caller whose unit is the OWNER says so by calling THIS function; `sharedScope` stays
 * for the serving planes, which genuinely have an app in hand and pass it through.
 */
export function ownerSharedScope(ownerUserId: string): Scope {
  return { scopeKey: `usr.${ownerUserId}`, appId: `usr.${ownerUserId}` };
}
