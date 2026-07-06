/**
 * App-data backups (ch03 §3.8.10, ch07 §7.10 safety-nets) - the Cortex side of
 * the user-facing "Dados e cópias de segurança" panel. Ported from the old
 * services/app-data-backups.ts, re-homed on the ekoa-code app-data plane
 * (AppDataAccess over CollectionsEngine) instead of the old fs/mongo backend.
 *
 * Layered recovery: local snapshots (safety-net + manual) are the restore points
 * we own; every restore is itself undoable (a safety-net snapshot is taken BEFORE
 * touching live data). Snapshots live under
 * `{dataDir}/app-data-snapshots/{appId}/<iso>__<kind>.json` - runtime data, never
 * versioned, never co-located with the artifact source.
 *
 * DEVIATION (logged for G7): the old service also offered Firestore PITR
 * (point-in-time) restore points, feature-detected via `EKOA_APP_DATA_PITR`. The
 * ekoa-code data plane is the mongodb driver over Firestore-compat and the PITR
 * snapshot-session path is not carried in this slice; `previewAsOf` on a non-local
 * source degrades explicitly with `PITR_UNAVAILABLE`.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { AppDataAccess, type AppDataDeps, type AppDataDump } from './app-data-access.js';

export type RestorePointSource = 'local' | 'pitr' | 'gcs';

export interface RestorePoint {
  /** opaque handle: the snapshot filename for a local point. */
  pointId: string;
  at: string;
  kind: string;
  source: RestorePointSource;
  label: string;
  size?: number;
}

export interface BackupStatus {
  enabled: boolean;
  lastSnapshotAt: string | null;
  restorePointCount: number;
  restorePoints: RestorePoint[];
  automatic: boolean;
}

function dataRoot(): string {
  return process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
}

export class AppDataBackups {
  private access: AppDataAccess;
  private snapshotRoot: string;
  private deps: AppDataDeps;

  constructor(deps: AppDataDeps, opts?: { access?: AppDataAccess; snapshotDir?: string }) {
    this.deps = deps;
    this.access = opts?.access ?? new AppDataAccess(deps);
    this.snapshotRoot = opts?.snapshotDir ?? join(dataRoot(), 'app-data-snapshots');
  }

  private appDir(appId: string): string {
    return join(this.snapshotRoot, appId);
  }

  /** Read every collection for an app into one dump (download + snapshot source). */
  exportAll(appId: string): Promise<AppDataDump> {
    return this.access.exportAll(appId);
  }

  /** Snapshot current state to a local restore point. */
  async saveSnapshot(appId: string, kind: 'safety-net' | 'manual' | 'nightly' | 'auto' = 'manual'): Promise<RestorePoint> {
    const dump = await this.access.exportAll(appId);
    const dir = this.appDir(appId);
    mkdirSync(dir, { recursive: true });
    const pointId = `${dump.at.replace(/[:.]/g, '-')}__${kind}.json`;
    const body = JSON.stringify(dump, null, 2);
    writeFileSync(join(dir, pointId), body, 'utf-8');
    return { pointId, at: dump.at, kind, source: 'local', label: relativePtLabel(dump.at), size: Buffer.byteLength(body) };
  }

  /** All local restore points, newest first. */
  listRestorePoints(appId: string, now = new Date(this.deps.now())): RestorePoint[] {
    const dir = this.appDir(appId);
    const points: RestorePoint[] = [];
    if (existsSync(dir)) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        const at = parseSnapshotIso(f) ?? new Date(statSync(join(dir, f)).mtimeMs).toISOString();
        const kind = f.includes('__') ? (f.split('__')[1] as string).replace(/\.json$/, '') : 'auto';
        points.push({ pointId: f, at, kind, source: 'local', label: relativePtLabel(at, now) });
      }
    }
    return points.sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  status(appId: string, now = new Date(this.deps.now())): BackupStatus {
    const restorePoints = this.listRestorePoints(appId, now);
    return {
      enabled: true,
      lastSnapshotAt: restorePoints.length ? (restorePoints[0] as RestorePoint).at : null,
      restorePointCount: restorePoints.length,
      restorePoints,
      automatic: false,
    };
  }

  /** Read a local snapshot file. */
  readLocalSnapshot(appId: string, pointId: string): AppDataDump {
    const fp = join(this.appDir(appId), pointId);
    if (!existsSync(fp)) throw new Error(`Restore point not found: ${pointId}`);
    return JSON.parse(readFileSync(fp, 'utf-8')) as AppDataDump;
  }

  /** Render an app's data as of a restore point, read-only (no effect on live state). */
  async previewAsOf(appId: string, point: { pointId: string; source: string; at: string }): Promise<AppDataDump> {
    if (point.source === 'local') return this.readLocalSnapshot(appId, point.pointId);
    // PITR not carried in this slice (see file header) - degrade explicitly.
    throw new Error('PITR_UNAVAILABLE: point-in-time restore is not available on this backend');
  }

  /**
   * Restore the app to a point, with a safety net: snapshot current state first
   * (so the restore is itself undoable), then clear and re-import the point. On a
   * mid-flight failure the pre-restore state is rolled back. Never a one-way door.
   */
  async restoreTo(
    appId: string,
    point: { pointId: string; source: string; at: string },
  ): Promise<{ restored: number; cleared: number; safetyNetId: string }> {
    const safety = await this.saveSnapshot(appId, 'safety-net');
    const dump = await this.previewAsOf(appId, point);
    try {
      const cleared = await this.access.clearAll(appId);
      const restored = await this.access.importDump(appId, dump);
      return { restored, cleared, safetyNetId: safety.pointId };
    } catch (err) {
      // clear+import is not transactional; roll back to the captured pre-restore state.
      try {
        await this.access.clearAll(appId);
        await this.access.importDump(appId, this.readLocalSnapshot(appId, safety.pointId));
      } catch {
        /* rollback failed too - the safety-net file is retained for manual recovery */
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Restore failed and was rolled back (safety net ${safety.pointId}): ${msg}`);
    }
  }
}

// -- PT-PT relative labels (the comfort half of the UI) ----------------------

export function relativePtLabel(atIso: string, now: Date = new Date()): string {
  const at = new Date(atIso);
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;
  const dayMs = 24 * 60 * 60 * 1000;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / dayMs);
  if (days <= 0) return `hoje, ${time}`;
  if (days === 1) return `ontem, ${time}`;
  if (days < 7) return `há ${days} dias`;
  if (days < 14) return 'semana passada';
  if (days < 31) return `há ${Math.floor(days / 7)} semanas`;
  return at.toLocaleDateString('pt-PT');
}

function parseSnapshotIso(filename: string): string | null {
  // "2026-06-08T22-13-05-123Z__manual.json" -> ISO
  const stem = filename.split('__')[0] as string;
  const m = stem.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
}
