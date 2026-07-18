import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { cortexBase } from './helpers/legal';

/**
 * Layer 3 — the artifact backend panel, against a REAL fixture backend.
 *
 * Imports a bundle that declares a backend (manifest.backend + backend/index.js);
 * the import builds the dist-backend bundle (app-builder), so the artifact has a
 * working server-side handler. Then drives the panel beside "Dados e cópias de
 * segurança":
 *   1. shows the declared handlers + a status badge
 *   2. "Executar simulação" runs a TRUE dry-run (no data written) and reports the
 *      suppressed effects
 *   3. enable/disable flips the state
 *   4. an artifact with NO backend shows the empty state
 * Zero console errors throughout.
 *
 * Backend semantics are locked by cortex/tests/artifact-backend/*. Requires the
 * dev servers (Session Start Rule). Imported instances are deleted in afterAll.
 */

const STAMP = Date.now().toString(36);
const NAME_BE = `E2E Backend App ${STAMP}`;
const NAME_PLAIN = `E2E Plain App ${STAMP}`;

const FRONTEND_SRC =
  "import { createRoot } from 'react-dom/client';\nfunction App(){ return <h1>backend fixture</h1>; }\ncreateRoot(document.getElementById('root')).render(<App />);\n";

// Fixture handler — appData.create + notify.inApp are dry-run-suppressed; no llm,
// so "run sample" stays fast + free + side-effect-free.
const BACKEND_SRC =
  "export async function onEmail(input, ekoa){\n" +
  "  ekoa.log('info', 'sample received', { subject: input && input.subject });\n" +
  "  const rec = await ekoa.appData.create('records', { subject: (input && input.subject) || 'n/a' });\n" +
  "  await ekoa.notify.inApp('Novo registo', 'Criado a partir de exemplo');\n" +
  "  return { recordId: rec.id };\n" +
  "}\n";

function makeBundle(name: string, withBackend: boolean) {
  // The import stamps only id+name into manifest.json; type/extends/backend survive
  // only via a FULLY-valid manifest.json carried in files[] (all of id, name, version,
  // entryPoint, outputDir, type present) - a partial manifest is silently replaced by
  // a backend-less jsx-app default and every backend assertion would fail downstream.
  const manifestId = `e2e-be-${STAMP}-${withBackend ? 'be' : 'plain'}`;
  const manifest: Record<string, unknown> = {
    id: manifestId,
    name,
    version: '1.0.0',
    entryPoint: 'frontend/src/index.jsx',
    outputDir: 'dist/',
    type: 'jsx-app',
    extends: 'app-auth-persistent',
  };
  const files = [{ path: 'frontend/src/index.jsx', content: FRONTEND_SRC }];
  if (withBackend) {
    manifest.backend = { entryPoint: 'backend/index.js', handlers: ['onEmail'] };
    files.push({ path: 'backend/index.js', content: BACKEND_SRC });
  }
  files.push({ path: 'manifest.json', content: JSON.stringify(manifest, null, 2) });
  return { manifestId, name, version: '1.0.0', files };
}

let token = '';
let backendAppId = '';
let plainAppId = '';

// Typed REST transport (ch03). Import + sample-run are admin-gated (canBuildApps /
// canEditApps), so every call carries the harness admin's Bearer token once minted.
function apiPost(request: APIRequestContext, path: string, body: unknown) {
  return request.post(`${cortexBase()}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    data: body,
    timeout: 30_000,
  });
}

function apiDelete(request: APIRequestContext, path: string) {
  return request.delete(`${cortexBase()}${path}`, {
    headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    timeout: 30_000,
  });
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/chat/, { timeout: 20_000 });
}

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

async function openArtifact(page: Page, name: string) {
  await page.goto('/artifacts');
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  await page.getByText(name).first().click();
}

test.beforeAll(async ({ request }) => {
  // Importing two bundles + a cold esbuild build (frontend fetches React from a
  // CDN on first run, plus the backend node bundle) can exceed the default hook
  // budget; a build failure only warns (import still 201s as 'draft'), so the
  // run-sample poll proves the handler actually invokes cleanly before the UI runs.
  test.setTimeout(90_000);
  const loginRes = await apiPost(request, '/api/v1/auth/login', { username: 'admin', password: 'tmp12345' });
  expect(loginRes.ok()).toBe(true);
  token = ((await loginRes.json()) as { token: string }).token;

  const impBe = await apiPost(request, '/api/v1/artifacts/import', { bundle: makeBundle(NAME_BE, true) });
  expect(impBe.status()).toBe(201);
  backendAppId = ((await impBe.json()) as { id: string }).id;

  const impPlain = await apiPost(request, '/api/v1/artifacts/import', { bundle: makeBundle(NAME_PLAIN, false) });
  expect(impPlain.status()).toBe(201);
  plainAppId = ((await impPlain.json()) as { id: string }).id;

  // Poll a dry-run until the handler invokes cleanly (no writes - pure dry-run).
  await expect
    .poll(async () => {
      const r = await apiPost(request, `/api/v1/artifacts/${backendAppId}/backend/sample-run`, { entrypoint: 'onEmail', input: { subject: 'poll' } });
      if (!r.ok()) return false;
      return ((await r.json()) as { result?: { ok?: boolean } }).result?.ok === true;
    }, { timeout: 40_000, intervals: [1000, 1500, 2000] })
    .toBe(true);
});

test.afterAll(async ({ request }) => {
  for (const id of [backendAppId, plainAppId]) {
    if (id) await apiDelete(request, `/api/v1/artifacts/${id}`).catch(() => {});
  }
});

test('backend panel: declared handlers, status, dry-run sample, enable toggle — zero console errors', async ({ page }) => {
  const errors = watchConsole(page);
  await login(page);
  await openArtifact(page, NAME_BE);

  const panel = page.getByTestId('artifact-backend-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Código de servidor');
  await expect(page.getByTestId('backend-handlers')).toContainText('onEmail');
  await expect(page.getByTestId('backend-state')).toBeVisible();

  // TRUE dry-run — runs the handler, writes nothing, reports the suppressed effects.
  await page.getByTestId('backend-run-sample').click();
  const result = page.getByTestId('backend-sample-result');
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(result).toContainText('nada foi gravado');

  // Disable flips the state badge; re-enable restores it.
  await page.getByTestId('backend-toggle').click();
  await expect(page.getByTestId('backend-state')).toContainText('Desativado', { timeout: 10_000 });
  await page.getByTestId('backend-toggle').click();
  await expect(page.getByTestId('backend-state')).not.toContainText('Desativado', { timeout: 10_000 });

  expect(errors).toEqual([]);
});

test('an artifact with no backend shows the empty state', async ({ page }) => {
  const errors = watchConsole(page);
  await login(page);
  await openArtifact(page, NAME_PLAIN);

  await expect(page.getByTestId('artifact-backend-panel')).toBeVisible();
  await expect(page.getByTestId('backend-none')).toBeVisible();
  await expect(page.getByTestId('backend-none')).toContainText('não tem código de servidor');

  expect(errors).toEqual([]);
});
