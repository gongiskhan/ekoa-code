import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { cortexBase } from './helpers/legal';

/**
 * U1 — /artifacts "Aplicações" section + universal "Usar" button + featured
 * apps as directly-editable artifacts with an update-by-consent badge.
 *
 * Against the REAL dev servers (Session Start Rule). Featured instances are the
 * seeded ekoa-data apps; own instances created here are cleaned up in afterAll.
 * The badge test mutates ONE featured instance's data via the admin REST PATCH
 * and restores it verbatim afterwards.
 */

const STAMP = Date.now().toString(36);

let token = '';
const cleanupIds: string[] = [];

async function api(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await request.fetch(`${cortexBase()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    ...(body !== undefined && { data: body }),
    timeout: 30_000,
  });
  return { status: res.status(), json: await res.json().catch(() => ({})) };
}

function makeBundle(name: string, manifestId: string) {
  // The import stamps only id+name into manifest.json; type/extends survive the
  // import only via a fully-valid manifest.json carried in files[] (all six
  // required fields), else the server silently substitutes a default manifest.
  const manifest = {
    id: manifestId,
    name,
    version: '1.0.0',
    entryPoint: 'frontend/src/index.jsx',
    outputDir: 'dist/',
    type: 'jsx-app',
    extends: 'app-auth-persistent',
  };
  return {
    manifestId,
    name,
    version: '1.0.0',
    files: [
      { path: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
      { path: 'frontend/src/index.jsx', content: "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')).render(<App />);\n" },
      { path: 'frontend/src/App.jsx', content: 'export default function App(){ return <h1>own app</h1>; }\n' },
    ],
  };
}

async function listFeatured(request: APIRequestContext): Promise<Array<{ id: string; slug?: string; name?: string; data?: Record<string, unknown> }>> {
  const res = await api(request, 'GET', '/api/v1/artifacts');
  const body = res.json as { featured?: unknown[] };
  return (body?.featured ?? []) as Array<{ id: string; slug?: string; name?: string; data?: Record<string, unknown> }>;
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/chat/, { timeout: 20_000 });
}

/** Fail on genuine JS errors; ignore environmental resource-load / dev-mode noise. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    if (/cannot have a negative time stamp/.test(err.message)) return;
    errors.push(`pageerror: ${err.message}`);
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource|favicon/.test(text)) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

test.beforeAll(async ({ request }) => {
  const loginRes = await api(request, 'POST', '/api/v1/auth/login', { username: 'admin', password: 'tmp12345' });
  expect(loginRes.status).toBe(200);
  token = (loginRes.json as { token: string }).token;
});

test.afterAll(async ({ request }) => {
  for (const id of cleanupIds) {
    await api(request, 'DELETE', `/api/v1/artifacts/${id}`).catch(() => {});
  }
});

test('the Aplicações section lists the featured apps, each with a "Usar" action, no console errors', async ({ page, request }) => {
  const errors = watchConsole(page);
  await login(page);
  await page.goto('/artifacts');

  const strip = page.getByTestId('starting-points-strip');
  await expect(strip).toBeVisible({ timeout: 20_000 });
  // Section header renamed to "Aplicações" (with its subtitle).
  await expect(strip.getByText('Aplicações', { exact: true })).toBeVisible();

  // The seeded featured catalog is large; assert a healthy floor.
  const cards = strip.locator('[data-testid^="starting-point-card-"]');
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });
  expect(await cards.count()).toBeGreaterThanOrEqual(21);

  // Every featured card exposes a primary "Usar" that opens the served app.
  const useButtons = strip.locator('[data-testid^="starting-point-use-"]');
  expect(await useButtons.count()).toBe(await cards.count());
  await expect(useButtons.first()).toHaveText('Usar');

  // Cross-check against the API count.
  const featured = await listFeatured(request);
  expect(featured.length).toBe(await cards.count());

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('an own artifact card shows the universal "Usar" button', async ({ page, request }) => {
  const errors = watchConsole(page);
  const name = `E2E Own Usar ${STAMP}`;
  const imp = await api(request, 'POST', '/api/v1/artifacts/import', { bundle: makeBundle(name, `e2e-own-usar-${STAMP}`) });
  expect(imp.status).toBe(201);
  const ownId = (imp.json as { id: string }).id;
  cleanupIds.push(ownId);

  await login(page);
  await page.goto('/artifacts');
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`artifact-use-${ownId}`)).toBeVisible();
  await expect(page.getByTestId(`artifact-use-${ownId}`)).toHaveText('Usar');

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('clicking a featured card routes to its chat (?continue=) instead of forking', async ({ page, request }) => {
  const errors = watchConsole(page);
  const featured = await listFeatured(request);
  expect(featured.length).toBeGreaterThan(0);
  const target = featured[0];

  // No fork must be created: own-instance count stays the same.
  const beforeList = await api(request, 'GET', '/api/v1/artifacts');
  const beforeCount = ((beforeList.json as { items?: unknown[] }).items ?? []).length;

  await login(page);
  await page.goto('/artifacts');
  const card = page.getByTestId(`starting-point-card-${target.id}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();

  // The card click routes to the direct-edit chat via ?continue=<featuredId>.
  await page.waitForURL(new RegExp(`/chat\\?continue=${target.id}`), { timeout: 15_000 });

  const afterList = await api(request, 'GET', '/api/v1/artifacts');
  const afterCount = ((afterList.json as { items?: unknown[] }).items ?? []).length;
  expect(afterCount).toBe(beforeCount);

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('featured update badge: "Manter a minha versão" clears the badge and records ignoredVersion', async ({ page, request }) => {
  // Expected-fail until the featured-update product decision lands: the server
  // strips the reserved keys (customized, updateAvailable) at the PATCH boundary,
  // so the badge state this test seeds cannot exist yet. Ledger entry:
  // docs/findings.md `featured-update-decision-pending` (director brief note B).
  // test.fail() flips this spec red the day the seed starts landing.
  test.fail();
  const errors = watchConsole(page);
  const featured = await listFeatured(request);
  expect(featured.length).toBeGreaterThan(0);
  const target = featured[featured.length - 1];

  // Snapshot the original data so we can restore it verbatim afterwards.
  // KNOWN GAP: no artifacts REST response returns the data bag, so this
  // snapshot is always empty (docs/findings.md, featured-update decision pending).
  const originalGet = await api(request, 'GET', `/api/v1/artifacts/${target.id}`);
  const originalData = ((originalGet.json as { data?: Record<string, unknown> })?.data) ?? {};

  // Simulate the seeder having flagged an update for a customized instance.
  // KNOWN GAP: the server strips RESERVED_ARTIFACT_DATA_KEYS (customized,
  // updateAvailable) at this PATCH boundary, so the seed cannot land and this
  // test is expected to fail until the featured-update product decision lands
  // (docs/findings.md).
  const patched = { ...originalData, customized: true, updateAvailable: { version: '9.9.9' } };
  const patchRes = await api(request, 'PATCH', `/api/v1/artifacts/${target.id}`, { data: patched });
  expect(patchRes.status).toBe(200);

  try {
    await login(page);
    await page.goto('/artifacts');

    const badge = page.getByTestId(`featured-update-badge-${target.id}`);
    await expect(badge).toBeVisible({ timeout: 20_000 });
    await badge.click();

    const dialog = page.getByTestId('featured-update-dialog');
    await expect(dialog).toBeVisible();
    await page.getByTestId('featured-update-keep').click();

    // Badge gone from the UI…
    await expect(page.getByTestId('featured-update-toast')).toBeVisible({ timeout: 10_000 });
    await expect(badge).toHaveCount(0, { timeout: 10_000 });

    // …and ignoredVersion persisted, updateAvailable cleared.
    const after = await api(request, 'GET', `/api/v1/artifacts/${target.id}`);
    const afterData = (after.json as { data?: Record<string, unknown> })?.data ?? {};
    expect(afterData.ignoredVersion).toBe('9.9.9');
    expect(afterData.updateAvailable ?? null).toBeNull();
  } finally {
    // Restore the featured instance's data to its pre-test state. PATCH data
    // MERGES, so explicitly clear the keys the test introduced rather than
    // relying on a replace.
    await api(request, 'PATCH', `/api/v1/artifacts/${target.id}`, {
      data: { ...originalData, customized: false, updateAvailable: null, ignoredVersion: null },
    }).catch(() => {});
  }

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
