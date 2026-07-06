/**
 * Generic domain-store factory (ch04 §4.3.3 JsonStore-semantics mapping). Every platform
 * domain store is one physical Mongo collection with `_id`-as-key documents. Uniqueness is
 * the deterministic-`_id` insert pattern (duplicate-key error = taken); no unique indexes
 * anywhere (§4.3.2). Updates are CAS on a `_rev` field with bounded retries; single-use
 * consumes use atomic `findOneAndDelete`. The data layer relies only on single-document
 * atomic operations (§4.1) — no load-bearing multi-document transactions.
 */
import type { Collection, Filter, OptionalUnlessRequiredId } from 'mongodb';
import { getDb } from './mongo.js';

export interface Doc {
  _id: string;
  _rev?: number;
  [k: string]: unknown;
}

const MAX_CAS_RETRIES = 5;

export class Store<T extends Doc> {
  constructor(public readonly name: string) {}

  private col(): Collection<T> {
    return getDb().collection<T>(this.name);
  }

  /** Insert with a deterministic _id. Returns false if the id is already taken (duplicate key). */
  async insert(doc: T): Promise<boolean> {
    try {
      await this.col().insertOne({ ...doc, _rev: 0 } as OptionalUnlessRequiredId<T>);
      return true;
    } catch (e) {
      if (isDuplicateKey(e)) return false;
      throw e;
    }
  }

  async get(id: string): Promise<T | null> {
    return (await this.col().findOne(byId<T>(id))) as T | null;
  }

  /** Upsert: replace if present (bumping _rev), create if absent. */
  async put(doc: T): Promise<T> {
    const next = { ...doc, _rev: (doc._rev ?? 0) + 1 };
    await this.col().replaceOne(byId<T>(doc._id), next as unknown as T, { upsert: true });
    return next;
  }

  /** Compare-and-swap update via a mutator, with bounded retries on concurrent _rev drift. */
  async update(id: string, mutate: (cur: T) => T): Promise<T | null> {
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const cur = (await this.col().findOne(byId<T>(id))) as T | null;
      if (!cur) return null;
      const rev = cur._rev ?? 0;
      const next = { ...mutate(cur), _id: id, _rev: rev + 1 } as T;
      const res = await this.col().replaceOne({ _id: id, _rev: rev } as Filter<T>, next as unknown as T);
      if (res.matchedCount === 1) return next;
      // lost the CAS race → re-read and retry
    }
    throw new Error(`CAS update exhausted retries for ${this.name}/${id}`);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.col().deleteOne(byId<T>(id));
    return res.deletedCount === 1;
  }

  /** Atomic single-use consume (anti-replay): removes and returns the doc, or null. */
  async consume(id: string): Promise<T | null> {
    const res = await this.col().findOneAndDelete(byId<T>(id));
    return (res ?? null) as T | null;
  }

  async find(filter: Record<string, unknown> = {}, sort?: Record<string, 1 | -1>): Promise<T[]> {
    let q = this.col().find(filter as Filter<T>);
    if (sort) q = q.sort(sort);
    return (await q.toArray()) as unknown as T[];
  }

  async deleteMany(filter: Record<string, unknown>): Promise<number> {
    const res = await this.col().deleteMany(filter as Filter<T>);
    return res.deletedCount;
  }
}

function byId<T extends Doc>(id: string): Filter<T> {
  return { _id: id } as Filter<T>;
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: number }).code === 11000;
}
