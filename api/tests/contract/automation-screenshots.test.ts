import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { writeStepScreenshot, screenshotUrlFromPath } from '../../src/automation/persistence.js';
import { __resetAutomationConfigForTests } from '../../src/automation/config.js';

/**
 * The `/automation-screenshots` static plane (ch12): per-step PNGs written under
 * <dataDir>/automation-runs/<automationId>/<runId>/step-N.png are served publicly as capability
 * URLs, so the run UI can render them via <img> (which cannot carry an Authorization header). This
 * exercises the REAL composition-root mount in buildApp against a fixture written by the real
 * `writeStepScreenshot`, and the disk-path → served-URL mapping the wire uses.
 */
let server: Server;
let port: number;
let dataDir: string;
let artifactDataDir: string;
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  dataDir = await mkdtemp(join(tmpdir(), 'ekoa-automation-shots-'));
  artifactDataDir = await mkdtemp(join(tmpdir(), 'ekoa-artifact-shots-'));
  process.env.EKOA_AUTOMATION_DATA_DIR = dataDir; // where writeStepScreenshot + the static mount root
  process.env.EKOA_DATA_DIR = artifactDataDir; // keep buildApp's artifact-screenshot dir off ~
  __resetConfigForTests();
  loadConfig();
  __resetAutomationConfigForTests(); // so automationRunsRoot() reads the temp dir the mount will serve
  const app = buildApp(cfg);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 30_000);

afterAll(async () => {
  server.close();
  await rm(dataDir, { recursive: true, force: true });
  await rm(artifactDataDir, { recursive: true, force: true });
  delete process.env.EKOA_AUTOMATION_DATA_DIR;
  delete process.env.EKOA_DATA_DIR;
  __resetAutomationConfigForTests();
});

const get = (p: string) => fetch(`http://127.0.0.1:${port}${p}`);

describe('automation step screenshots static plane (ch12)', () => {
  it('serves a PNG written by writeStepScreenshot at its screenshotUrl, and 404s a missing one', async () => {
    const rel = writeStepScreenshot('auto-7', 'run-42', 0, PNG);
    expect(rel).toBe('automation-runs/auto-7/run-42/step-0.png');
    const url = screenshotUrlFromPath(rel);
    expect(url).toBe('/automation-screenshots/auto-7/run-42/step-0.png');

    const ok = await get(url!);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type') ?? '').toContain('image/png');
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(PNG);

    const missing = await get('/automation-screenshots/auto-7/run-42/step-99.png');
    expect(missing.status).toBe(404);
  });
});
