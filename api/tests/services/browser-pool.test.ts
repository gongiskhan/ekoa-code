import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSharedBrowser, closeSharedBrowser } from '../../src/services/browser-pool.js';
import { captureArtifactScreenshot, getArtifactScreenshotDir } from '../../src/services/artifact-screenshot.js';

/**
 * Shared browser pool (spec/07 §7.11) + artifact screenshot. Guarded on the
 * Chromium binary: if playwright has not finished downloading it, the launch tests
 * skip with a clear reason rather than failing for an infra reason.
 */

let chromiumOk = false;
try {
  const { chromium } = await import('playwright');
  chromiumOk = existsSync(chromium.executablePath());
} catch {
  chromiumOk = false;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // \x89 P N G

it.runIf(!chromiumOk)('SKIPPED: playwright Chromium binary is not installed on this machine', () => {
  expect(chromiumOk).toBe(false);
});

describe.skipIf(!chromiumOk)('browser pool + artifact screenshot (Chromium available)', () => {
  const prevDataDir = process.env.EKOA_DATA_DIR;
  let dataDir: string;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'shot-'));
    process.env.EKOA_DATA_DIR = dataDir;
  });
  afterAll(async () => {
    await closeSharedBrowser();
    if (prevDataDir === undefined) delete process.env.EKOA_DATA_DIR;
    else process.env.EKOA_DATA_DIR = prevDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('reuses ONE shared browser across concurrent callers (launch guard)', async () => {
    const [b1, b2] = await Promise.all([getSharedBrowser(), getSharedBrowser()]);
    expect(b1).toBe(b2); // concurrent launches collapse to a single instance
    expect(b1.isConnected()).toBe(true);
  });

  it('captures a PNG of a data: URL under the data directory', async () => {
    const page = 'data:text/html,<html><body style="margin:0"><h1>Ekoa</h1></body></html>';
    const result = await captureArtifactScreenshot('inst-1', { url: page });

    expect(result.url).toBe('/artifact-screenshots/inst-1.png');
    expect(result.width).toBe(1280);
    expect(result.path).toBe(join(getArtifactScreenshotDir(), 'inst-1.png'));
    expect(existsSync(result.path)).toBe(true);

    const buf = readFileSync(result.path);
    expect(buf.subarray(0, 4).equals(PNG_MAGIC)).toBe(true); // real PNG
  });
});
