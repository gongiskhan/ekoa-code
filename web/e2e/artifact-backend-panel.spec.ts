import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

function backendUrl(): string {
  try {
    return `http://localhost:${readFileSync(resolve(__dirname, '..', '..', 'backend.port'), 'utf-8').trim()}`;
  } catch {
    return 'http://localhost:4111';
  }
}

const STAMP = Date.now().toString(36);
const NAME_BE = `E2E Backend App ${STAMP}`;
const NAME_PLAIN = `E2E Plain App ${STAMP}`;
const b64 = (s: string) => Buffer.from(s).toString('base64');

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
  const manifest: Record<string, unknown> = {
    id: `e2e-be-${STAMP}-${withBackend ? 'be' : 'plain'}`,
    name,
    version: '1.0.0',
    entryPoint: 'frontend/src/index.jsx',
    outputDir: 'dist/',
    type: 'jsx-app',
    extends: 'app-auth-persistent',
  };
  const scaffold = [{ path: 'frontend/src/index.jsx', contentB64: b64(FRONTEND_SRC) }];
  if (withBackend) {
    manifest.backend = { entryPoint: 'backend/index.js', handlers: ['onEmail'] };
    scaffold.push({ path: 'backend/index.js', contentB64: b64(BACKEND_SRC) });
  }
  return { schemaVersion: 1, manifest, scaffold, exportedAt: new Date().toISOString(), sourceArtifactId: manifest.id };
}

let token = '';
let backendAppId = '';
let plainAppId = '';

async function action(request: APIRequestContext, app: string, intent: string, params: Record<string, unknown>) {
  const res = await request.post(`${backendUrl()}/api/v1/action`, {
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    data: { app, intent, params, request_id: `e2e-${Math.random().toString(36).slice(2)}` },
    timeout: 30_000,
  });
  return res.json();
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
  // budget; the run-sample poll waits on the fire-and-forget post-import build.
  test.setTimeout(90_000);
  const loginRes = await action(request, 'ekoa.auth', 'login', { username: 'admin', password: 'tmp12345' });
  expect(loginRes.success).toBe(true);
  token = (loginRes.data as { token: string }).token;

  const impBe = await action(request, 'ekoa.templates', 'import-instance', { bundle: makeBundle(NAME_BE, true) });
  expect(impBe.success).toBe(true);
  backendAppId = (impBe.data as { id: string }).id;

  const impPlain = await action(request, 'ekoa.templates', 'import-instance', { bundle: makeBundle(NAME_PLAIN, false) });
  expect(impPlain.success).toBe(true);
  plainAppId = (impPlain.data as { id: string }).id;

  // The post-import backend build is fire-and-forget; poll a dry-run until the
  // bundle is built and the handler invokes cleanly (no writes — pure dry-run).
  await expect
    .poll(async () => {
      const r = await action(request, 'ekoa.artifact-backend', 'run-sample', { id: backendAppId, entrypoint: 'onEmail', input: { subject: 'poll' } });
      return (r?.data as { result?: { ok?: boolean } } | undefined)?.result?.ok === true;
    }, { timeout: 40_000, intervals: [1000, 1500, 2000] })
    .toBe(true);
});

test.afterAll(async ({ request }) => {
  for (const id of [backendAppId, plainAppId]) {
    if (id) await action(request, 'ekoa.templates', 'delete-instance', { id }).catch(() => {});
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
