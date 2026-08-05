import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import {
  login as restLogin,
  importArtifact,
  listArtifacts,
  getArtifact,
  patchArtifact,
  deleteArtifact,
} from './helpers/backend-rest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { uiLogin } from './helpers/ui-login';

/**
 * U1 — /artifacts "Aplicações" section + universal "Usar" button + featured
 * apps as directly-editable artifacts with an update-by-consent badge.
 *
 * Against the REAL dev servers (Session Start Rule). Featured instances are the
 * seeded ekoa-data apps; own instances created here are cleaned up in afterAll.
 * The badge test mutates ONE featured instance's data via the super-admin
 * update-instance intent and restores it verbatim afterwards.
 */

function backendUrl(): string {
  try {
    return `http://localhost:${readFileSync(resolve(__dirname, '..', '..', 'backend.port'), 'utf-8').trim()}`;
  } catch {
    return 'http://localhost:4111';
  }
}

const STAMP = Date.now().toString(36);

let token = '';
const cleanupIds: string[] = [];

// TRANSPORT ONLY. This spec used to seed through `POST /api/v1/action { app: 'ekoa.templates' }`,
// a dispatcher the rebuild retired — it 404s, so `loginRes.success` was `undefined` and the spec
// died in beforeAll without reaching one product assertion. The assertions below are untouched;
// only the fixtures' transport moves to the REST routes that replaced the intents. A "template
// instance" is an ARTIFACT here, which is the whole of the rename.

function makeBundle(name: string, manifestId: string) {
  // The CONTRACT shape (`shared/src/artifacts.ts` ArtifactBundle), not the portable envelope the
  // reader produces for a downloaded zip: this fixture posts straight at the REST route, so it
  // sends what the route validates. `files[].content` is plain text — base64 is the portable
  // envelope's concern and `toContractBundle` is what bridges the two for a real user's file.
  return {
    manifestId,
    name,
    version: '1.0.0',
    files: [
      {
        path: 'frontend/src/index.jsx',
        content:
          "import { createRoot } from 'react-dom/client';\nimport App from './App';\ncreateRoot(document.getElementById('root')).render(<App />);\n",
      },
      { path: 'frontend/src/App.jsx', content: 'export default function App(){ return <h1>own app</h1>; }\n' },
    ],
  };
}

async function listFeatured(request: APIRequestContext): Promise<Array<{ id: string; slug?: string; name?: string; data?: Record<string, unknown> }>> {
  const { featured } = await listArtifacts(request, token);
  return featured as Array<{ id: string; slug?: string; name?: string; data?: Record<string, unknown> }>;
}

async function login(page: Page) {
  await uiLogin(page);
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
  token = await restLogin(request);
});

test.afterAll(async ({ request }) => {
  for (const id of cleanupIds) {
    await deleteArtifact(request, token, id);
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
  const imp = await importArtifact(request, token, makeBundle(name, `e2e-own-usar-${STAMP}`));
  expect(imp.id, 'import returned an artifact id').toBeTruthy();
  const ownId = imp.id;
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
  const beforeCount = (await listArtifacts(request, token)).items.length;

  await login(page);
  await page.goto('/artifacts');
  const card = page.getByTestId(`starting-point-card-${target.id}`);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();

  // The card click routes to the direct-edit chat via ?continue=<featuredId>.
  await page.waitForURL(new RegExp(`/chat\\?continue=${target.id}`), { timeout: 15_000 });

  const afterCount = (await listArtifacts(request, token)).items.length;
  expect(afterCount).toBe(beforeCount);

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

/**
 * SKIPPED, and the reason is a hardening rather than a defect.
 *
 * This test seeds its precondition by PATCHing `data.customized` + `data.updateAvailable` onto a
 * featured artifact — the old RPC dispatcher allowed it. The rebuild does not: both keys are in
 * `RESERVED_ARTIFACT_DATA_KEYS` (`api/src/apps/artifacts-service.ts`) and are stripped twice, at the
 * route boundary and again in `patchArtifact`. That is deliberate and correct — the same list keeps
 * a client from writing `projectDir` (a build-sandbox path-injection) and `tours` (a stored-content
 * injection into the public GET /api/demos/:appId). A client that could forge "this app has an
 * update" could also drive the update flow it gates.
 *
 * So the fixture path is closed BY DESIGN and there is no legitimate public route to the state. The
 * behaviour under test is real and still worth covering; what it needs is a server-side seam (drive
 * `featured-seeder.ts` with a bumped manifest version), which is a test-harness change with its own
 * design, not something to improvise here. Weakening the reserved-key list to make a test pass
 * would trade a security control for a green tick.
 *
 * Tracked in `docs/findings.md` as `featured-update-badge-unreachable-from-a-spec`.
 */
test.skip('featured update badge: "Manter a minha versão" clears the badge and records ignoredVersion', async ({ page, request }) => {
  const errors = watchConsole(page);
  const featured = await listFeatured(request);
  expect(featured.length).toBeGreaterThan(0);
  const target = featured[featured.length - 1];

  // Snapshot the original data so we can restore it verbatim afterwards.
  const originalGet = await getArtifact(request, token, target.id);
  const originalData = (originalGet.data as Record<string, unknown>) ?? {};

  // Simulate the seeder having flagged an update for a customized instance.
  const patched = { ...originalData, customized: true, updateAvailable: { version: '9.9.9' } };
  const patchRes = await patchArtifact(request, token, target.id, { data: patched });
  // REST answers with the artifact, not an `{ success }` envelope. Assert the patch LANDED, which
  // is what the old envelope check was standing in for and is a stronger claim than a flag.
  expect((patchRes.data as Record<string, unknown>)?.customized, 'patch persisted').toBe(true);

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
    const after = await getArtifact(request, token, target.id);
    const afterData = (after.data as Record<string, unknown>) ?? {};
    expect(afterData.ignoredVersion).toBe('9.9.9');
    expect(afterData.updateAvailable ?? null).toBeNull();
  } finally {
    // Restore the featured instance's data to its pre-test state. update-instance
    // MERGES data for featured instances, so explicitly clear the keys the test
    // introduced rather than relying on a replace.
    await patchArtifact(request, token, target.id, {
      data: { ...originalData, customized: false, updateAvailable: null, ignoredVersion: null },
    }).catch(() => {});
  }

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
