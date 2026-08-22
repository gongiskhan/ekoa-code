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

  /**
   * `opts.projection` is the SIZE bound on a read, and it is a third optional argument rather than
   * a changed signature so every existing caller keeps its meaning unchanged (Rule 7, additive).
   *
   * It exists because a collection whose rows are LARGE and whose row COUNT grows with tenants
   * cannot be walked whole just to build a set of short strings. `integration_action_evidence` is
   * the case that forced it: rows hold a capped request + response sample (hundreds of KB) and
   * accumulate as orgs x owners x integrations x actions with no TTL, and the driver materialises
   * every document it returns - so an unprojected `find({})` over 10k rows is a multi-gigabyte
   * allocation. That failure is NOT catchable: an OOM abort kills the process rather than rejecting
   * the promise, so a `.catch` around such a read degrades nothing. Naming the two fields a reader
   * actually needs is what makes the read bounded.
   *
   * `opts.limit` is the OTHER size bound, on the same option bag and additive in the same way
   * (Rule 7 - every existing caller keeps its meaning). A projection bounds each ROW; some reads
   * need to bound the COUNT. `integration_action_feedback` is the case that forced this one: its
   * owner-scoped prompt read runs on the hot path of every automation plan and wants the newest
   * twenty notes of a person who may hold thousands. Applied by the DRIVER (`.limit()`), so the cap
   * governs what is FETCHED rather than what survives a `.slice()` afterwards - which is the whole
   * difference between a bounded read and a bounded answer. Pair it with `sort`: a limit over an
   * unordered cursor answers an arbitrary subset. `automation/migration-report.ts` is the second
   * caller (its review round F12/F19, independently of the first): the scan asks for cap + 1 so the
   * database decides which rows come back and `truncated` is a fact rather than an inference.
   */
  async find(
    filter: Record<string, unknown> = {},
    sort?: Record<string, 1 | -1>,
    opts: { projection?: Record<string, 0 | 1>; limit?: number } = {},
  ): Promise<T[]> {
    let q = opts.projection
      ? this.col().find(filter as Filter<T>, { projection: opts.projection })
      : this.col().find(filter as Filter<T>);
    if (sort) q = q.sort(sort);
    if (opts.limit !== undefined && Number.isFinite(opts.limit) && opts.limit > 0) q = q.limit(opts.limit);
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
