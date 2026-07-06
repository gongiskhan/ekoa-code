/**
 * App-data access for the artifact family (ch04 §4.2, ch03 §3.8.10/§3.8.11).
 *
 * The backend runtime's `appData.*` capability (handle-rpc) and the app-data
 * backups service both need to read/clear/re-import an app's collections. The
 * served-app data plane already owns the canonical store via `CollectionsEngine`
 * over the single `app_data` physical collection; this module is the thin
 * server-side twin of that plane, scoped by a raw scope key so the SAME rows the
 * served UI reads are visible here:
 *   - per-app scope:   scopeKey === appId                     (window.__ekoa)
 *   - shared scope:    scopeKey === `usr.<ownerUserId>`       (window.__ekoa.shared)
 *
 * Collection enumeration is a `distinct` over the physical collection (the engine
 * has no list-collections surface); every read/write still routes through the
 * engine so scoping + validation stay identical to the served plane.
 */
import type { Scope } from '../data/collections-engine.js';
import { CollectionsEngine } from '../data/collections-engine.js';
import { APP_DATA_COLLECTION } from '../data/collections-engine.js';
import { getDb } from '../data/mongo.js';

export interface AppDataDeps {
  now: () => number;
  genId: () => string;
}

export interface AppDataDump {
  collections: Record<string, Array<Record<string, unknown>>>;
  counts: Record<string, number>;
  totalItems: number;
  at: string;
}

/** Build the engine scope for a raw scope key (per-app id OR `usr.<owner>`). */
function scopeFor(scopeKey: string): Scope {
  return { scopeKey, appId: scopeKey };
}

export class AppDataAccess {
  private engine: CollectionsEngine;
  constructor(private deps: AppDataDeps) {
    this.engine = new CollectionsEngine(deps);
  }

  /** Distinct logical collection names stored under a scope key. */
  async listCollections(scopeKey: string): Promise<string[]> {
    const names = (await getDb()
      .collection(APP_DATA_COLLECTION)
      .distinct('collection', { appId: scopeKey })) as string[];
    return names.filter((n) => typeof n === 'string');
  }

  list(scopeKey: string, collection: string): Promise<Array<Record<string, unknown>>> {
    return this.engine.list(scopeFor(scopeKey), collection);
  }

  get(scopeKey: string, collection: string, id: string): Promise<Record<string, unknown> | null> {
    return this.engine.get(scopeFor(scopeKey), collection, id);
  }

  create(scopeKey: string, collection: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.engine.create(scopeFor(scopeKey), collection, data);
  }

  update(scopeKey: string, collection: string, id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.engine.upsert(scopeFor(scopeKey), collection, id, patch);
  }

  delete(scopeKey: string, collection: string, id: string): Promise<boolean> {
    return this.engine.delete(scopeFor(scopeKey), collection, id);
  }

  /** Read every collection for a scope into one dump (download + snapshot source). */
  async exportAll(scopeKey: string): Promise<AppDataDump> {
    const collections: Record<string, Array<Record<string, unknown>>> = {};
    const counts: Record<string, number> = {};
    let totalItems = 0;
    for (const name of await this.listCollections(scopeKey)) {
      const items = await this.list(scopeKey, name);
      collections[name] = items;
      counts[name] = items.length;
      totalItems += items.length;
    }
    return { collections, counts, totalItems, at: new Date(this.deps.now()).toISOString() };
  }

  /** Delete every item in every collection for a scope. Returns items removed. */
  async clearAll(scopeKey: string): Promise<number> {
    let removed = 0;
    for (const name of await this.listCollections(scopeKey)) {
      for (const item of await this.list(scopeKey, name)) {
        const id = item.id;
        if (typeof id === 'string' && (await this.delete(scopeKey, name, id))) removed++;
      }
    }
    return removed;
  }

  /** Write a dump's items back through create() (ids preserved). Returns items written. */
  async importDump(scopeKey: string, dump: AppDataDump): Promise<number> {
    let written = 0;
    for (const [name, items] of Object.entries(dump.collections)) {
      for (const item of items) {
        await this.create(scopeKey, name, item as Record<string, unknown>);
        written++;
      }
    }
    return written;
  }
}
