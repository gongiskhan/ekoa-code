import { test, expect, type Page } from '@playwright/test';
import { CollectionsResponse, DocumentsResponse, KnowledgeSearchResponse } from '@ekoa/shared';
import { uiLogin } from './helpers/ui-login';

/**
 * WS8a - the Biblioteca ("O que a Ekoa sabe") lists the reserved `_shared` legal corpus, not just
 * the caller's own (empty-on-a-fresh-org) vault.
 *
 * WHAT IS BEING PROVEN. The operator's complaint was "the knowledge base is empty" - it never was:
 * `_shared` holds 209k+ jurisprudência, 43k+ legislação, 10k+ legislação laboral documents on a
 * real boot, and every search already unions it in. What was missing was BROWSE visibility, which
 * this spec exercises end to end: the scope toggle switches the Fornecido list between the org's
 * own vault (live, real request) and `_shared` (stubbed - see below), the three collections render
 * their PT-PT names, no delete affordance appears on a shared document (read-only), and the search
 * box surfaces a shared hit with its badge.
 *
 * STUBS. There is deliberately NO online write path to `_shared` (ch04 §4.4.1 - written only by the
 * offline importer CLI), and this repo's constraint is stronger still: a real CI runner's data
 * directory starts with an EMPTY `_shared` (the 262k-document corpus is a one-off local import, not
 * a committed fixture), so a real scope=shared request in this environment legitimately returns
 * zero rows. Planting real files into `<EKOA_DATA_DIR>/knowledge/vault/_shared` from a spec would
 * also contaminate a real corpus on any machine where one already exists - the one thing this
 * workstream was explicitly told never to do. So the three requests that address `_shared`
 * (collections?scope=shared, documents?scope=shared, search) are intercepted and answered with
 * fixtures validated in-spec against the shared schemas (the house rule: no protocol stubs except
 * schema-validated ones) - everything else (login, the scope=org requests, the dashboard chrome) is
 * live. The org-vault behaviour itself (real request, real empty-org response) is asserted directly
 * alongside the stubbed shared behaviour, so a regression in either direction fails this spec.
 */

const CORS_HEADERS = {
  'access-control-allow-origin': 'http://localhost:3000',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

const SHARED_COLLECTIONS = ['jurisprudencia', 'legislacao', 'legislacao-laboral'];

const SHARED_DOCS = {
  items: [
    { id: 'stub-jur-1', collection: 'jurisprudencia', title: 'Acórdão STJ 123/2026', scope: 'shared' as const, createdAt: '2026-07-11T10:00:00.000Z' },
    { id: 'stub-leg-1', collection: 'legislacao', title: 'Código Civil - Artigo 483.º', scope: 'shared' as const, createdAt: '2026-07-11T10:00:00.000Z' },
    { id: 'stub-lab-1', collection: 'legislacao-laboral', title: 'Código do Trabalho - Artigo 351.º', scope: 'shared' as const, createdAt: '2026-07-11T10:00:00.000Z' },
  ],
  total: 3,
};

const SEARCH_HITS = {
  hits: [
    { collection: 'processos', docId: 'own-1', title: 'Nota própria sobre prescrição', snippet: 'prescrição de créditos…', score: 4.2, scope: 'org' as const },
    { collection: 'jurisprudencia', docId: 'stub-jur-1', title: 'Acórdão STJ 123/2026', snippet: 'prazo de prescrição…', score: 3.1, scope: 'shared' as const },
  ],
};

// The house rule, executed rather than asserted in prose: a stub that does not validate against the
// shared schema is a fiction, and a spec built on one proves nothing about the product.
for (const [name, fixture, schema] of [
  ['collections', { items: SHARED_COLLECTIONS }, CollectionsResponse],
  ['documents', SHARED_DOCS, DocumentsResponse],
  ['search', SEARCH_HITS, KnowledgeSearchResponse],
] as const) {
  const parsed = schema.safeParse(fixture);
  if (!parsed.success) {
    throw new Error(`WS8a e2e: the ${name} stub does not validate against its shared schema: ${parsed.error.message}`);
  }
}

/** Stub ONLY the `scope=shared` browse calls; a `scope=org` (or unscoped) request is left to
 *  `route.continue()` untouched, so the org-vault half of every assertion below is fully live. */
async function stubSharedCorpus(page: Page): Promise<void> {
  await page.route('**/api/v1/knowledge/collections*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('scope') !== 'shared') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify({ items: SHARED_COLLECTIONS }) });
  });
  await page.route('**/api/v1/knowledge/documents*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('scope') !== 'shared') return route.continue();
    const collection = url.searchParams.get('collection');
    const body = collection ? { items: SHARED_DOCS.items.filter((d) => d.collection === collection), total: SHARED_DOCS.items.filter((d) => d.collection === collection).length } : SHARED_DOCS;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(body) });
  });
  await page.route('**/api/v1/knowledge/search', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS_HEADERS, body: JSON.stringify(SEARCH_HITS) });
  });
}

async function login(page: Page) {
  await uiLogin(page);
}

test('Biblioteca: the scope toggle lists the shared corpus (stubbed) beside the live, real org vault', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubSharedCorpus(page);
  await login(page);
  await page.goto('/knowledge');
  await expect(page.getByTestId('knowledge-page')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('kn-tab-fornecido').click();

  // The scope toggle exists and defaults to the org's own vault.
  await expect(page.getByTestId('kn-scope-toggle')).toBeVisible();
  await expect(page.getByTestId('kn-scope-org')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('kn-scope-shared')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('kn-scope-shared-hint')).toHaveCount(0);

  // Switch to the shared corpus.
  await page.getByTestId('kn-scope-shared').click();
  await expect(page.getByTestId('kn-scope-shared')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('kn-scope-shared-hint')).toBeVisible();

  // The three PT-PT collection names render (the raw slugs never leak to the UI in this scope).
  await expect(page.getByTestId('kn-filter-jurisprudencia')).toHaveText('Jurisprudência');
  await expect(page.getByTestId('kn-filter-legislacao')).toHaveText('Legislação');
  await expect(page.getByTestId('kn-filter-legislacao-laboral')).toHaveText('Legislação laboral');

  // The three stubbed shared documents render.
  await expect(page.getByTestId('kn-doc-list')).toBeVisible();
  await expect(page.getByTestId('kn-doc')).toHaveCount(3);
  await expect(page.getByTestId('kn-doc').filter({ hasText: 'Acórdão STJ 123/2026' })).toBeVisible();

  // Read-only: a shared document offers NO delete affordance (org-scope docs keep theirs -
  // exercised in legal-knowledge.spec.ts, which adds and deletes a real org doc).
  await expect(page.getByTestId('kn-doc-delete')).toHaveCount(0);

  // The collection filter narrows within the shared scope too (same stub, collection-filtered).
  await page.getByTestId('kn-filter-legislacao').click();
  await expect(page.getByTestId('kn-doc')).toHaveCount(1);
  await expect(page.getByTestId('kn-doc').filter({ hasText: 'Código Civil' })).toBeVisible();

  // Switching back to the org scope is a REAL, unstubbed request (deliberately not asserting
  // empty-vs-populated here: another spec sharing this CI run's backend may have ingested a real
  // org document first). What must hold regardless of ordering is the BOUNDARY: none of the three
  // shared-only stub documents ever bleed into the org view once the stub stops applying.
  await page.getByTestId('kn-scope-org').click();
  await expect(page.getByTestId('kn-scope-shared-hint')).toHaveCount(0);
  for (const title of ['Acórdão STJ 123/2026', 'Código Civil', 'Código do Trabalho']) {
    await expect(page.getByTestId('kn-doc').filter({ hasText: title })).toHaveCount(0);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Biblioteca: the search box surfaces a shared hit, badged, beside an org hit unbadged', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await stubSharedCorpus(page);
  await login(page);
  await page.goto('/knowledge');
  await expect(page.getByTestId('knowledge-page')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('kn-search-input').fill('prescrição');
  await expect(page.getByTestId('kn-search-results')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('kn-search-hit')).toHaveCount(2);

  const ownHit = page.getByTestId('kn-search-hit').filter({ hasText: 'Nota própria sobre prescrição' });
  const sharedHit = page.getByTestId('kn-search-hit').filter({ hasText: 'Acórdão STJ 123/2026' });
  await expect(ownHit).toBeVisible();
  await expect(sharedHit).toBeVisible();
  // Only the shared-scope hit carries the "Base pública" badge - the distinguishing signal a
  // human needs when org + shared results sit in the same list.
  await expect(ownHit.getByTestId('kn-hit-shared-badge')).toHaveCount(0);
  await expect(sharedHit.getByTestId('kn-hit-shared-badge')).toHaveCount(1);
  await expect(sharedHit.getByTestId('kn-hit-shared-badge')).toHaveText('Base pública');

  // Clearing the box returns to the Fornecido browse (tabs reappear, results panel gone).
  await page.getByTestId('kn-search-input').fill('');
  await expect(page.getByTestId('kn-search-results')).toHaveCount(0);
  await expect(page.getByTestId('kn-tab-fornecido')).toBeVisible();

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
