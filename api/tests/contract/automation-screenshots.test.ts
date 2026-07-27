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
 * The `/automation-screenshots` plane (ch12), through the REAL composition-root mount in buildApp.
 *
 * REWRITTEN for Cofre R-3. This test previously asserted the plane served a PNG to an
 * UNAUTHENTICATED caller — it pinned the vulnerability as the contract. These are screenshots of an
 * authenticated session on a client portal; the plane is now authenticated (a short-lived platform
 * JWT in the query string, the same pattern the SSE stream uses because EventSource cannot set
 * headers either) and tenant-scoped against the run.
 *
 * The URL SHAPE is unchanged, which is the part the wire depends on: `writeStepScreenshot` ->
 * `screenshotUrlFromPath` still produces `/automation-screenshots/<automationId>/<runId>/step-N.png`
 * and every persisted `screenshotUrl` keeps resolving. Authorization is exercised in depth by
 * tests/security/screenshot-plane.test.ts; this file pins the mapping and the composition-root
 * refusal.
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

describe('automation step screenshots plane (ch12; authenticated per Cofre R-3)', () => {
  it('maps a written screenshot to its served URL shape (unchanged by R-3)', () => {
    const rel = writeStepScreenshot('auto-7', 'run-42', 0, PNG);
    expect(rel).toBe('automation-runs/auto-7/run-42/step-0.png');
    expect(screenshotUrlFromPath(rel)).toBe('/automation-screenshots/auto-7/run-42/step-0.png');
  });

  it('REFUSES an unauthenticated read of a real screenshot at the composition root', async () => {
    const rel = writeStepScreenshot('auto-7', 'run-42', 0, PNG);
    const url = screenshotUrlFromPath(rel)!;
    const res = await get(url);
    expect(res.status).toBe(401);
    // The bytes must not appear in the refusal body.
    expect(await res.text()).not.toContain('PNG');
  });

  it('REFUSES an unauthenticated read with a garbage token', async () => {
    const rel = writeStepScreenshot('auto-7', 'run-42', 0, PNG);
    const res = await get(`${screenshotUrlFromPath(rel)!}?token=not-a-jwt`);
    expect(res.status).toBe(401);
  });

  it('still 401s (not 404s) for a missing file, so existence is not an oracle', async () => {
    const missing = await get('/automation-screenshots/auto-7/run-42/step-99.png');
    expect(missing.status).toBe(401);
  });
});
