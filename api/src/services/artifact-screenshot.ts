/**
 * Artifact screenshot capture (spec/07-app-pipeline.md §7.11).
 *
 * Captures a screenshot of a built artifact app served at `/apps/<id>/` using the
 * shared headless Chromium from the browser pool (one process, concurrent-launch
 * guard, process-exit cleanup - all owned by `browser-pool.ts`). Capture is at
 * 1280x800, waits for network-idle plus an 800 ms paint settle, times out at 30 s,
 * and OVERWRITES the previous PNG on every call (no debounce). PNGs are written
 * under the data directory and served publicly at `/artifact-screenshots/<id>.png`
 * (the route mount lands in another slice).
 *
 * Adapted from the old service, which duplicated the browser lifecycle inline;
 * §7.11 fixes it to the shared pool, so this module now depends on `browser-pool`.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';
import { loadConfig } from '../config.js';
import { getSharedBrowser } from './browser-pool.js';

export interface ArtifactScreenshotResult {
  /** Absolute path to the saved PNG. */
  path: string;
  /** Relative URL: /artifact-screenshots/{instanceId}.png */
  url: string;
  width: number;
  height: number;
}

export interface CaptureOptions {
  /** Override the target URL (tests pass a `data:` URL to avoid a live server). */
  url?: string;
}

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;
const SCREENSHOT_TIMEOUT_MS = 30_000;
/** Extra settle time after networkidle so React SPAs finish painting. */
const RENDER_SETTLE_MS = 800;

/**
 * Operational data directory. `config.ts` carries no data-dir field, so this is
 * env-derived and late-bound (read per call) rather than computed at import time -
 * which also keeps it overridable in tests. Default `./data` per the slice brief.
 */
function dataDir(): string {
  const raw = process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/** Absolute path to the artifact-screenshot directory (`<dataDir>/artifact-screenshots`). */
export function getArtifactScreenshotDir(): string {
  return join(dataDir(), 'artifact-screenshots');
}

function ensureScreenshotDir(): string {
  const dir = getArtifactScreenshotDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Capture a screenshot of a built artifact app. The artifact must be served at
 * `/apps/{instanceId}/`; every call overwrites the previous screenshot.
 * `opts.url` overrides the target (used by tests).
 */
export async function captureArtifactScreenshot(
  instanceId: string,
  opts: CaptureOptions = {},
): Promise<ArtifactScreenshotResult> {
  const dir = ensureScreenshotDir();
  const filePath = join(dir, `${instanceId}.png`);
  const target = opts.url ?? `http://localhost:${loadConfig().port}/apps/${instanceId}/`;

  const browser = await getSharedBrowser();
  const page = await browser.newPage({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
  });

  try {
    await page.goto(target, { waitUntil: 'networkidle', timeout: SCREENSHOT_TIMEOUT_MS });
    await page.waitForTimeout(RENDER_SETTLE_MS);
    await page.screenshot({ path: filePath, type: 'png', fullPage: false });

    return {
      path: filePath,
      url: `/artifact-screenshots/${instanceId}.png`,
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/** The screenshot URL for an instance, or undefined if none has been captured yet. */
export function getArtifactScreenshotUrl(instanceId: string): string | undefined {
  const filePath = join(getArtifactScreenshotDir(), `${instanceId}.png`);
  return existsSync(filePath) ? `/artifact-screenshots/${instanceId}.png` : undefined;
}

// ---- Lazy/on-demand backfill (§7.11) ------------------------------------------------------
//
// A card with no screenshot (16 of 27 own artifacts, measured locally - every artifact built
// before this capture path existed) showed a blank/placeholder box forever: nothing ever
// re-captured it. Rather than a boot-time sweep across every artifact (would stampede Playwright
// across dozens of apps at once, the exact thing the featured-catalog boot build already has to
// bound with its own concurrency), the LIST route (routes/artifacts.ts) calls `ensureArtifactScreenshot`
// per listed artifact that lacks one: fire-and-forget, deduped per id so repeat list calls from
// concurrent tabs/polling don't stack captures for the same artifact, and capped so a list full of
// misses doesn't launch dozens of concurrent page loads at once either.

const MAX_CONCURRENT_BACKFILLS = 2;
const backfillInFlight = new Set<string>();
const backfillQueue: string[] = [];
let backfillActive = 0;

function pumpBackfillQueue(): void {
  while (backfillActive < MAX_CONCURRENT_BACKFILLS && backfillQueue.length > 0) {
    const instanceId = backfillQueue.shift() as string;
    backfillActive++;
    captureArtifactScreenshot(instanceId)
      .catch((err) => {
        console.warn(`[artifact-screenshot] backfill capture failed for ${instanceId} (non-fatal):`, err instanceof Error ? err.message : err);
      })
      .finally(() => {
        backfillActive--;
        backfillInFlight.delete(instanceId);
        pumpBackfillQueue();
      });
  }
}

/**
 * Kick a background capture for an artifact that has none yet. Fire-and-forget - never blocks the
 * caller and never throws. A no-op when `EKOA_SCREENSHOTS_DISABLED` is set (tests / CI), a capture
 * for this id is already queued or running, or one already exists on disk. Concurrency-capped
 * across ALL callers (not just per-id) so a list response full of misses queues rather than
 * stampedes.
 */
export function ensureArtifactScreenshot(instanceId: string): void {
  if (process.env.EKOA_SCREENSHOTS_DISABLED === '1') return;
  if (backfillInFlight.has(instanceId)) return;
  if (getArtifactScreenshotUrl(instanceId)) return;
  backfillInFlight.add(instanceId);
  backfillQueue.push(instanceId);
  pumpBackfillQueue();
}
