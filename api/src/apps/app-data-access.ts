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

/** Per-collection outcome of a migration-grade import (S3); mirrors the shared
 *  `ImportCollectionReport` wire shape so the import response carries it verbatim. */
export interface ImportCollectionResult {
  name: string;
  imported: number;
  skipped: number;
  error?: string;
}

export interface ImportDumpReport {
  collections: ImportCollectionResult[];
  imported: number;
  skipped: number;
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

  /** Write a dump's items back through create() (ids preserved). Returns items written.
   *  STRICT on purpose: the backups restore path depends on a throw to trigger its rollback,
   *  and an engine-produced dump can never carry reserved names. Migration imports of FOREIGN
   *  dumps go through `importDumpReport` below instead. */
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

  /**
   * Migration-grade dump import (S3) with per-collection fault isolation: one bad collection or
   * row never kills the rest. Reserved (`__*`) and shared-scope (`usr.*`) collections are SKIPPED
   * with an explicit per-collection report - a real prod dump carries the engine's own `__files`
   * bookkeeping, which `guardCollectionName` would refuse row by row; skipping it here names the
   * decision instead of drowning the whole seed. Rows go through the engine's `importCreate` so a
   * valid supplied createdAt/updatedAt survives; a data-shaped failure (oversized row, id
   * collision, invalid name) becomes a reported skip, never a wholesale abort.
   */
  async importDumpReport(scopeKey: string, dump: AppDataDump): Promise<ImportDumpReport> {
    const collections: ImportCollectionResult[] = [];
    for (const [name, items] of Object.entries(dump.collections)) {
      if (name.startsWith('__') || name.startsWith('usr.')) {
        collections.push({ name, imported: 0, skipped: items.length, error: 'RESERVED_COLLECTION: skipped on import' });
        continue;
      }
      const result: ImportCollectionResult = { name, imported: 0, skipped: 0 };
      for (const item of items) {
        try {
          await this.engine.importCreate(scopeFor(scopeKey), name, item as Record<string, unknown>);
          result.imported++;
        } catch (err) {
          result.skipped++;
          if (!result.error) result.error = err instanceof Error ? err.message : String(err);
        }
      }
      collections.push(result);
    }
    return {
      collections,
      imported: collections.reduce((n, c) => n + c.imported, 0),
      skipped: collections.reduce((n, c) => n + c.skipped, 0),
    };
  }
}
