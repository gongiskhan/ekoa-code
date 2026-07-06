import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

/**
 * Gallery "Importar artefacto" update-in-place flow, against the REAL backend:
 *   1. A bundle whose manifest.id matches an app the user owns offers
 *      "Atualizar a app existente (mantém dados e URL)" vs "Criar nova instância".
 *   2. Update keeps the instance id + slug, refreshes the name, and points the
 *      user at Versões / Dados e cópias de segurança.
 *   3. "Criar nova instância" still creates a separate copy.
 *   4. A non-matching bundle imports directly with no dialog (unchanged path).
 *
 * Requires the dev servers (Session Start Rule). Instances created here are
 * deleted in afterAll. Backend semantics (snapshot/versions/no-reseed/rollback)
 * are locked by cortex/tests/services/artifact-bundle-update.test.ts.
 */

function backendUrl(): string {
  try {
    return `http://localhost:${readFileSync(resolve(__dirname, '..', '..', 'backend.port'), 'utf-8').trim()}`;
  } catch {
    return 'http://localhost:4111';
  }
}

const STAMP = Date.now().toString(36);
const MANIFEST_ID = `e2e-upd-src-${STAMP}`;
const NAME_V1 = `E2E Update App ${STAMP} v1`;
const NAME_V2 = `E2E Update App ${STAMP} v2`;

const b64 = (s: string) => Buffer.from(s).toString('base64');

function makeBundle(version: number, name: string, manifestId = MANIFEST_ID) {
  return {
    schemaVersion: 1,
    manifest: {
      id: manifestId,
      name,
      version: `${version}.0.0`,
      entryPoint: 'frontend/src/index.jsx',
      outputDir: 'dist/',
      type: 'jsx-app',
      extends: 'app-auth-persistent',
    },
    scaffold: [
      {
        path: 'frontend/src/index.jsx',
        contentB64: b64(
          "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')).render(<App />);\n",
        ),
      },
      { path: 'frontend/src/App.jsx', contentB64: b64(`export default function App(){ return <h1>versao ${version}</h1>; }\n`) },
    ],
    exportedAt: new Date().toISOString(),
    sourceArtifactId: manifestId,
  };
}

let token = '';
let baseId = '';
let baseSlug = '';
let tmp = '';
const cleanupIds: string[] = [];

async function action(request: APIRequestContext, app: string, intent: string, params: Record<string, unknown>) {
  const res = await request.post(`${backendUrl()}/api/v1/action`, {
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    data: { app, intent, params, request_id: `e2e-${Math.random().toString(36).slice(2)}` },
    // import/update intents run a real esbuild server-side; don't trip on a busy backend
    timeout: 30_000,
  });
  return res.json();
}

async function listOwnInstances(request: APIRequestContext): Promise<Array<{ id: string; slug?: string; name?: string; title?: string }>> {
  const res = await action(request, 'ekoa.templates', 'list-instances', {});
  const data = res.data as { instances?: unknown[] } | unknown[];
  return (Array.isArray(data) ? data : (data?.instances ?? [])) as Array<{ id: string; slug?: string; name?: string; title?: string }>;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/chat/, { timeout: 20_000 });
}

/** Console-error watchdog: fail on page errors and app console.error output.
 * Excluded as environmental: resource-load 404 noise (other artifacts'
 * screenshots) and Next dev-mode performance.measure instrumentation
 * ("cannot have a negative time stamp"), which fires on plain page loads. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    if (/cannot have a negative time stamp/.test(err.message)) return;
    errors.push(`pageerror: ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource/.test(text)) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

async function importViaUi(page: Page, bundlePath: string) {
  await page.setInputFiles('input[type="file"][accept*="json"]', bundlePath);
}

test.beforeAll(async ({ request }) => {
  tmp = mkdtempSync(join(tmpdir(), 'ekoa-e2e-upd-'));
  const loginRes = await action(request, 'ekoa.auth', 'login', { username: 'admin', password: 'tmp12345' });
  expect(loginRes.success).toBe(true);
  token = (loginRes.data as { token: string }).token;

  const imp = await action(request, 'ekoa.templates', 'import-instance', { bundle: makeBundle(1, NAME_V1) });
  expect(imp.success).toBe(true);
  baseId = (imp.data as { id: string }).id;
  baseSlug = (imp.data as { slug: string }).slug;
  cleanupIds.push(baseId);
});

test.afterAll(async ({ request }) => {
  for (const id of cleanupIds) {
    await action(request, 'ekoa.templates', 'delete-instance', { id }).catch(() => {});
  }
});

test('matching bundle offers the choice; update keeps id + slug and guides to Versões/backups', async ({ page, request }) => {
  const errors = watchConsole(page);
  await login(page);
  await page.goto('/artifacts');
  await expect(page.getByTestId('import-artifact-button')).toBeVisible();
  // The match is computed against the loaded gallery — wait for our app's card.
  await expect(page.getByText(NAME_V1).first()).toBeVisible({ timeout: 15_000 });

  const v2Path = join(tmp, 'bundle-v2.json');
  writeFileSync(v2Path, JSON.stringify(makeBundle(2, NAME_V2)));
  await importViaUi(page, v2Path);

  const dialog = page.getByTestId('update-or-create-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Atualizar a app existente (mantém dados e URL)');
  await expect(dialog).toContainText('Criar nova instância');
  await expect(dialog).toContainText(NAME_V1);

  await page.getByTestId('update-existing-button').click();

  // Snapshot + commit + esbuild run server-side; allow a real build's latency.
  const toast = page.getByTestId('build-link-toast');
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await expect(toast).toContainText('atualizada');
  await expect(toast).toContainText('Versões');
  await expect(toast).toContainText('cópias de segurança');
  await expect(dialog).not.toBeVisible();

  // Identity held: same id, same slug, refreshed name; no second instance.
  const instances = await listOwnInstances(request);
  const mine = instances.filter((i) => (i.name ?? i.title ?? '').includes(`E2E Update App ${STAMP}`));
  expect(mine).toHaveLength(1);
  expect(mine[0].id).toBe(baseId);
  expect(mine[0].slug).toBe(baseSlug);
  expect(mine[0].name ?? mine[0].title).toBe(NAME_V2);

  // The update is a revision: history carries the pre-update snapshot.
  const versions = await action(request, 'ekoa.templates', 'versions-list', { artifactId: baseId });
  const messages = ((versions.data as { versions: Array<{ message: string }> }).versions ?? []).map((v) => v.message);
  expect(messages).toContain('update from bundle');
  expect(messages).toContain('pre-update snapshot');

  expect(errors).toEqual([]);
});

test('"Criar nova instância" creates a separate copy instead of touching the original', async ({ page, request }) => {
  const errors = watchConsole(page);
  await login(page);
  await page.goto('/artifacts');
  await expect(page.getByText(NAME_V2).first()).toBeVisible({ timeout: 15_000 });

  const v2Path = join(tmp, 'bundle-v2-copy.json');
  writeFileSync(v2Path, JSON.stringify(makeBundle(2, NAME_V2)));
  await importViaUi(page, v2Path);

  // Escape dismisses the choice without importing anything…
  await expect(page.getByTestId('update-or-create-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('update-or-create-dialog')).not.toBeVisible();

  // …then the same bundle re-offers the choice and create-new proceeds.
  await importViaUi(page, v2Path);
  await expect(page.getByTestId('update-or-create-dialog')).toBeVisible();
  await page.getByTestId('create-new-instance-button').click();

  const toast = page.getByTestId('build-link-toast');
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await expect(toast).toContainText('Artefacto importado');

  const instances = await listOwnInstances(request);
  const mine = instances.filter((i) => (i.name ?? i.title ?? '').includes(`E2E Update App ${STAMP}`));
  expect(mine).toHaveLength(2);
  const copy = mine.find((i) => i.id !== baseId);
  expect(copy).toBeTruthy();
  expect(copy?.slug).not.toBe(baseSlug);
  if (copy) cleanupIds.push(copy.id);

  expect(errors).toEqual([]);
});

test('a non-matching bundle imports directly with no choice dialog', async ({ page, request }) => {
  const errors = watchConsole(page);
  await login(page);
  await page.goto('/artifacts');
  await expect(page.getByTestId('import-artifact-button')).toBeVisible();

  const freshPath = join(tmp, 'bundle-fresh.json');
  const freshName = `E2E Fresh App ${STAMP}`;
  writeFileSync(freshPath, JSON.stringify(makeBundle(1, freshName, `e2e-unrelated-${STAMP}`)));
  await importViaUi(page, freshPath);

  const toast = page.getByTestId('build-link-toast');
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await expect(toast).toContainText('Artefacto importado');
  await expect(page.getByTestId('update-or-create-dialog')).not.toBeVisible();

  const instances = await listOwnInstances(request);
  const fresh = instances.find((i) => (i.name ?? i.title ?? '') === freshName);
  expect(fresh).toBeTruthy();
  if (fresh) cleanupIds.push(fresh.id);

  expect(errors).toEqual([]);
});

/** Create a fresh imported instance via the API and return its id/slug/name. */
async function createInstance(request: APIRequestContext, manifestId: string, name: string) {
  const imp = await action(request, 'ekoa.templates', 'import-instance', { bundle: makeBundle(1, name, manifestId) });
  expect(imp.success).toBe(true);
  const d = imp.data as { id: string; slug: string };
  cleanupIds.push(d.id);
  return { id: d.id, slug: d.slug };
}

test('detail view: "Atualizar a partir de ficheiro" updates the app IN PLACE', async ({ page, request }) => {
  const errors = watchConsole(page);
  const mid = `e2e-detail-upd-${STAMP}`;
  const v1 = `E2E Detail Upd ${STAMP} v1`;
  const v2 = `E2E Detail Upd ${STAMP} v2`;
  const created = await createInstance(request, mid, v1);

  await login(page);
  await page.goto('/artifacts');
  await page.getByText(v1).first().click();
  // Detail view: the upload-update control is scoped to this artifact's id.
  const input = page.locator(`input[data-testid="upload-update-input-${created.id}"]`);
  await expect(input).toHaveCount(1, { timeout: 15_000 });

  const v2Path = join(tmp, 'detail-upd-v2.json');
  // manifest.id === the source id the instance remembers (data.importedFrom),
  // so the non-force update path succeeds without the mismatch confirm.
  writeFileSync(v2Path, JSON.stringify(makeBundle(2, v2, mid)));
  await input.setInputFiles(v2Path);

  const toast = page.getByTestId('build-link-toast');
  await expect(toast).toBeVisible({ timeout: 30_000 });
  await expect(toast).toContainText('atualizada');

  // Identity held: same id + slug, refreshed name, no new instance.
  const instances = await listOwnInstances(request);
  const mine = instances.filter((i) => (i.name ?? i.title ?? '').includes(`E2E Detail Upd ${STAMP}`));
  expect(mine).toHaveLength(1);
  expect(mine[0].id).toBe(created.id);
  expect(mine[0].slug).toBe(created.slug);
  expect(mine[0].name ?? mine[0].title).toBe(v2);

  expect(errors).toEqual([]);
});

test('detail view: Delete removes the artifact', async ({ page, request }) => {
  const errors = watchConsole(page);
  const name = `E2E Detail Del ${STAMP}`;
  const created = await createInstance(request, `e2e-detail-del-${STAMP}`, name);

  await login(page);
  await page.goto('/artifacts');
  await page.getByText(name).first().click();

  await page.locator(`[data-testid="delete-artifact-${created.id}"]`).click();
  // Confirm in the DeleteDialog (its confirm button is the exact word "Eliminar").
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();

  // Returns to the list and the card is gone.
  await expect(page.getByText(name)).toHaveCount(0, { timeout: 15_000 });

  const instances = await listOwnInstances(request);
  expect(instances.find((i) => i.id === created.id)).toBeUndefined();

  expect(errors).toEqual([]);
});
