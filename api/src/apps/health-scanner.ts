/**
 * Proactive app-health scanner (ch07 §7.11). Ported from the old
 * services/app-health-scanner.ts, adapted to the ekoa-code stores + an INJECTED
 * page-loader seam so the browser dependency stays out of this module (and out of
 * tests).
 *
 * The in-page probe (§7.6) only fires when a user opens an app, leaving old apps
 * without a verdict. At startup this scanner headlessly opens every UNCHECKED,
 * NON-FEATURED, registered artifact (concurrency 4) so the probe fires and POSTs
 * its report. The scanner itself NEVER writes the store - only the probe's
 * `/api/app-health` handler persists a verdict. Featured artifacts are skipped (one
 * viewer's flaky load must not flip a global badge). Skippable via
 * `EKOA_DISABLE_HEALTH_SCAN=1`.
 */
import { artifacts } from '../data/stores.js';
import type { ArtifactDoc } from './artifacts-service.js';
import { appRegistry } from './app-registry.js';

const SCAN_CONCURRENCY = 4;

export interface HealthScanDeps {
  /** Injected headless page open (the real one drives the shared browser pool). */
  loadPage: (url: string) => Promise<void>;
  /** Origin the probe reports from, e.g. `http://localhost:4111`. */
  baseUrl: string;
  /** Override the concurrency (default 4). */
  concurrency?: number;
  /** Force-skip (in addition to the EKOA_DISABLE_HEALTH_SCAN env toggle). */
  disabled?: boolean;
  /** Injected registry lookup (defaults to the shared appRegistry). */
  isRegistered?: (artifactId: string) => boolean;
}

export interface HealthScanResult {
  /** Artifacts opened headlessly so the probe could fire. */
  scanned: number;
  /** Unchecked artifacts skipped because they are not registered (nothing to load). */
  skippedUnregistered: number;
  totalUnchecked: number;
  durationMs: number;
  skipped: boolean;
}

async function processBatch(ids: string[], concurrency: number, run: (id: string) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < ids.length) {
      const i = next++;
      const id = ids[i] as string;
      try {
        await run(id);
      } catch (err) {
        console.warn(`[health-scanner] ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
}

/**
 * One-shot scan of every non-featured artifact whose health verdict is unknown.
 * Registered ones are headlessly opened so the in-page probe reports; the scanner
 * never writes a verdict itself.
 */
export async function scanUncheckedArtifacts(deps: HealthScanDeps): Promise<HealthScanResult> {
  const start = Date.now();
  if (deps.disabled || process.env.EKOA_DISABLE_HEALTH_SCAN === '1') {
    return { scanned: 0, skippedUnregistered: 0, totalUnchecked: 0, durationMs: 0, skipped: true };
  }
  const isRegistered = deps.isRegistered ?? ((id: string) => !!appRegistry.getApp(id));
  const concurrency = deps.concurrency ?? SCAN_CONCURRENCY;

  const all = (await artifacts.find({})) as ArtifactDoc[];
  const unchecked = all.filter((a) => !a.featured && (a as { health?: unknown }).health === undefined);
  const registered = unchecked.filter((a) => isRegistered(a._id));
  const unregistered = unchecked.length - registered.length;

  if (registered.length > 0) {
    await processBatch(registered.map((a) => a._id), concurrency, (id) =>
      deps.loadPage(`${deps.baseUrl.replace(/\/$/, '')}/apps/${id}/`),
    );
  }
  return {
    scanned: registered.length,
    skippedUnregistered: unregistered,
    totalUnchecked: unchecked.length,
    durationMs: Date.now() - start,
    skipped: false,
  };
}
