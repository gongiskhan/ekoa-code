import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig, defaultLlmConfig, type Config } from '../../src/config.js';
import { buildApp } from '../../src/server.js';
import { appRegistry } from '../../src/apps/app-registry.js';
import { __resetSlugIndexForTests } from '../../src/apps/slug-index.js';
import { seedFeaturedArtifacts } from '../../src/apps/featured-seeder.js';
import { buildAndRegisterFeaturedArtifacts, ensureLegalDemoSpineInstalled } from '../../src/apps/featured-builder.js';
import { closeSharedBrowser, getSharedBrowser } from '../../src/services/browser-pool.js';

/**
 * WS10 screenshot-seeding fix: `ensureLegalDemoSpineInstalled` drives the REAL
 * "Instalar dados de demonstração" button (only `legal-nucleo`'s DashboardPage wires it)
 * via a real page rather than reimplementing the seed content server-side. Two properties
 * matter here more than the dispositions do, because a future refactor could silently
 * break either without any other suite noticing:
 *
 *  - ORDERING: `buildAndRegisterFeaturedArtifacts` must guarantee `legal-nucleo` is built
 *    + registered before ANY `legal-*` artifact's screenshot-capture branch can trigger
 *    the ensure-install call (it navigates straight to `/apps/legal-nucleo/`) - otherwise
 *    the call hits an unregistered app, finds no button, and (because the attempt is
 *    latched to "tried once per run" regardless of outcome) never retries even once
 *    legal-nucleo DOES become servable later in the same run.
 *  - IDEMPOTENCE: a second call must no-op cleanly (no throw, no re-click) once the
 *    install button is gone, rather than assuming it is always present.
 *
 * Guarded on the Chromium binary like `tests/services/browser-pool.test.ts` - skips with a
 * clear reason on a machine that hasn't downloaded it, rather than failing for an infra
 * reason.
 */

let chromiumOk = false;
try {
  const { chromium } = await import('playwright');
  chromiumOk = existsSync(chromium.executablePath());
} catch {
  chromiumOk = false;
}

it.runIf(!chromiumOk)('SKIPPED: playwright Chromium binary is not installed on this machine', () => {
  expect(chromiumOk).toBe(false);
});

describe.skipIf(!chromiumOk)('ensureLegalDemoSpineInstalled (WS10 screenshot-seeding fix)', () => {
  let mem: MongoMemoryServer;
  let fixtureRoot: string;
  let buildsRoot: string;
  let dataDir: string;
  let server: Server;
  let port: number;

  /** A minimal featured-artifact fixture, mirroring `featured.test.ts`'s own helper. */
  async function mkFixture(id: string, indexSource: string): Promise<void> {
    const dir = join(fixtureRoot, id);
    await mkdir(join(dir, 'scaffold', 'frontend', 'src'), { recursive: true });
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ id, name: `App ${id}`, version: '1.0.0' }));
    await writeFile(
      join(dir, 'scaffold', 'manifest.json'),
      JSON.stringify({ id, name: `App ${id}`, version: '1.0.0', type: 'jsx-app', entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/' }),
    );
    await writeFile(join(dir, 'scaffold', 'frontend', 'src', 'index.jsx'), indexSource);
  }

  /** Plain DOM, no React needed - this fixture stands in for legal-nucleo's real
   *  DashboardPage.jsx demo-spine card closely enough to exercise the ensure function:
   *  an "Instalar..." button that, once clicked, PERSISTS installed=true server-side (via
   *  the generic per-app `window.__ekoa` data plane every served app gets injected, the
   *  same bridge the real demo-spine card uses, just on the per-app collection rather than
   *  the shared one - this test isn't exercising the cross-artifact sharing, only the
   *  ordering/idempotence of the click itself) and a FRESH page load reflects that by
   *  rendering "Remover..." instead. A page-local DOM swap alone would not be a faithful
   *  stand-in: the real card's installed state survives a reload precisely because it is
   *  written to the server, and a naive in-memory-only fixture would pass this test even
   *  if `ensureLegalDemoSpineInstalled` clicked a button that changed nothing durable. */
  const NUCLEO_INDEX = `
    (async function () {
      function render(installed) {
        document.body.innerHTML = installed
          ? '<div id="root"><button data-testid="demo-remover">Remover dados de demonstração</button></div>'
          : '<div id="root"><button data-testid="demo-instalar">Instalar dados de demonstração</button></div>';
        if (!installed) {
          document.querySelector('[data-testid="demo-instalar"]').addEventListener('click', async function () {
            await window.__ekoa.create('demo_state', { installed: true });
            render(true);
          });
        }
      }
      var rows = await window.__ekoa.list('demo_state');
      render(rows.some(function (r) { return r && r.installed; }));
    })();
  `;
  const STUB_INDEX = `document.getElementById('root').textContent = 'stub';`;

  /** Loads a fresh page and reports which of the two testids is present. */
  async function readDemoState(): Promise<'not-installed' | 'installed' | 'neither'> {
    const browser = await getSharedBrowser();
    const page = await browser.newPage();
    try {
      await page.goto(`http://localhost:${port}/apps/legal-nucleo/`, { waitUntil: 'networkidle', timeout: 30_000 });
      if ((await page.locator('[data-testid="demo-remover"]').count()) > 0) return 'installed';
      if ((await page.locator('[data-testid="demo-instalar"]').count()) > 0) return 'not-installed';
      return 'neither';
    } finally {
      await page.close().catch(() => {});
    }
  }

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = 'k';
    process.env.JWT_SECRET = 's';
    fixtureRoot = await mkdtemp(join(tmpdir(), 'ekoa-demo-spine-fixture-'));
    buildsRoot = await mkdtemp(join(tmpdir(), 'ekoa-demo-spine-builds-'));
    dataDir = await mkdtemp(join(tmpdir(), 'ekoa-demo-spine-data-'));
    process.env.EKOA_FEATURED_BUILDS_DIR = buildsRoot;
    process.env.EKOA_DATA_DIR = dataDir;
    __resetConfigForTests();
    loadConfig();

    mem = await createMem();
    await connectMongo(mem.getUri(), 'ekoa_demo_spine');
    await users.insert({ _id: 'sa-demo-spine', username: 'admin', passwordHash: 'x', role: 'super-admin', orgId: 'org-demo-spine', active: true } as never);
    setActivation('sa-demo-spine', { active: true, billingLocked: false });

    // Created in an order that would expose an ordering regression: on a directory
    // listing that preserves creation order (the common case), removing the
    // legal-nucleo-first sort in buildAndRegisterFeaturedArtifacts would process this
    // one BEFORE legal-nucleo exists.
    await mkFixture('legal-aardvark', STUB_INDEX);
    await mkFixture('legal-nucleo', NUCLEO_INDEX);

    const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
    const app = buildApp(cfg, { now: () => Date.now(), genId: () => `id_${Math.random()}` });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    port = (server.address() as { port: number }).port;
    // ensureLegalDemoSpineInstalled/captureArtifactScreenshot both read the port from the
    // global config, not from `cfg` above (which only fixed the LOCAL buildApp instance) -
    // point it at the real bound port before anything navigates.
    process.env.PORT = String(port);
    __resetConfigForTests();
    loadConfig();
  }, 120_000);

  afterAll(async () => {
    await closeSharedBrowser();
    server?.close();
    await appRegistry.stop();
    await closeMongo();
    await mem.stop();
    __resetSlugIndexForTests();
    for (const d of [fixtureRoot, buildsRoot, dataDir]) await rm(d, { recursive: true, force: true });
    delete process.env.EKOA_FEATURED_BUILDS_DIR;
    delete process.env.EKOA_DATA_DIR;
    delete process.env.PORT;
  });

  it('installs the shared demo spine exactly once, gated on legal-nucleo already being built + registered, and a second call no-ops', async () => {
    await seedFeaturedArtifacts(fixtureRoot);
    const buildResult = await buildAndRegisterFeaturedArtifacts(fixtureRoot);
    expect(buildResult.failed).toBe(0);
    expect(buildResult.registered).toBe(2);

    // ORDERING: a fresh page load of legal-nucleo shows the installed state. This is only
    // possible if legal-nucleo was already servable at the moment the automatic
    // ensure-install call fired during the buildAndRegisterFeaturedArtifacts() run above -
    // i.e. the id-sort that puts legal-nucleo first did its job, even though
    // legal-aardvark was created (and would otherwise be listed) first.
    expect(await readDemoState()).toBe('installed');

    // IDEMPOTENCE: the fixture's button removes itself once clicked, so a second call
    // finds no install button on a fresh page load. It must report that cleanly instead
    // of throwing or clicking whatever `demo-remover` now shows.
    const second = await ensureLegalDemoSpineInstalled();
    expect(second).toEqual({ installed: false, alreadyInstalled: true });

    // Confirm the no-op really was a no-op: nothing about the installed state moved.
    expect(await readDemoState()).toBe('installed');
  }, 90_000);
});
