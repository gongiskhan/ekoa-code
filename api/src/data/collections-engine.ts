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

  async delete(scope: Scope, collection: string, id: string): Promise<void> {
    guardCollectionName(collection);
    await col().deleteOne({ _id: docId(scope, collection, id), appId: scope.scopeKey, collection });
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
