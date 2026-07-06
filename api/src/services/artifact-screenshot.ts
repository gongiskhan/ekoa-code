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
  const raw = process.env.EKOA_DATA_DIR || './data';
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
