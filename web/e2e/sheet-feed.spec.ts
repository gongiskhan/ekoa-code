import { test, expect, type Page } from '@playwright/test';

/**
 * Sheet feed (Part B slice B4, run 20260717-190134): the real desk surface replacing the
 * B3 placeholder internals. Proves, against the LIVE stack (no protocol stubs at all):
 *
 *   1. The feed renders each sheet's markdown (react-markdown output, never raw markers)
 *      with the consistent footer: provenance (memoriesUsed + traceId from the source
 *      message metadata - the B1 writers), the actions row (editar / copiar / promover
 *      stub with its "Brevemente" tooltip), and 2-3 heuristic follow-up suggestions.
 *   2. Typography scales with CONTENT LENGTH via a class switch (locked decision 10):
 *      short = sheet-scale-display, medium = sheet-scale-article, long = sheet-scale-dense.
 *   3. copiar puts the latest revision markdown on the clipboard (real clipboard read).
 *   4. editar posts to the live B1 revisions endpoint (2xx asserted via waitForResponse),
 *      the sheet renders the new revision, and prev/next revision navigation walks
 *      revisions[] both ways.
 *
 * Real UI login, PT-PT strings (the app's default locale), zero console errors.
 */

const API = 'http://localhost:4111';

// Content-length scale fixtures (thresholds: <240 display, <=1600 article, >1600 dense).
const SHORT_BODY = 'Sim, o prazo de contestação é de 30 dias.';
const MEDIUM_TITLE = 'Guia de reuniões eficazes';
const MEDIUM_BODY = [
  `# ${MEDIUM_TITLE}`,
  '',
  'Uma reunião eficaz começa com uma **agenda clara** e termina com decisões registadas.',
  '',
  '- Prepare a agenda com antecedência',
  '- Partilhe os documentos com os participantes',
  '- Registe as decisões e os próximos passos',
  '',
  'Cada ponto deve ter um responsável e um tempo alocado, e a ata deve seguir no próprio dia.',
].join('\n');
const LONG_BODY =
  '# Parecer sobre prazos processuais\n\n' +
  Array.from(
    { length: 12 },
    (_, i) =>
      `Parágrafo ${i + 1}: ` +
      'A contagem dos prazos processuais segue o Código de Processo Civil e suspende-se em férias judiciais quando aplicável. '.repeat(
        2,
      ),
  ).join('\n\n');

const TRACE_ID = 'trace-b4-e2e';
const MEMORIES_USED = 2;
const EDITED_BODY = 'O prazo de contestação é de 30 dias, nos termos do artigo 569 do CPC.';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

/** Console + non-asset 4xx tracking (regressions-dashboard pattern). */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  const devAssetNoise = /\/_next\/|hot-update|favicon/;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/^Failed to load resource/.test(msg.text())) return;
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (r) => {
    if (r.status() < 400 || devAssetNoise.test(r.url())) return;
    // Known OPEN finding (docs/findings.md: login session double-create race): the /chat
    // landing intermittently GETs a just-created session id that 404s. Scoped exclusion.
    if (r.status() === 404 && /\/api\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url())) return;
    errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

test.describe('sheet feed (B4)', () => {
  test('renders markdown sheets with footer, length-scaled typography, live copiar and editar with revision navigation', async ({
    page,
  }) => {
    // -- Seed via the API (Playwright request context; the page never sees these calls).
    const loginRes = await page.request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'admin', password: 'tmp12345' },
    });
    expect(loginRes.ok()).toBe(true);
    const { token } = (await loginRes.json()) as { token: string };
    const auth = { authorization: `Bearer ${token}` };

    // Pre-clean: /chat auto-resumes the most recent session; stale sessions would also
    // leave ambiguous sheet cards. Fresh slate per run keeps the asserts deterministic.
    const listRes = await page.request.get(`${API}/api/v1/sessions`, { headers: auth });
    expect(listRes.ok()).toBe(true);
    const { items: existing } = (await listRes.json()) as { items: Array<{ id: string }> };
    for (const s of existing) {
      await page.request.delete(`${API}/api/v1/sessions/${s.id}`, { headers: auth });
    }

    const createRes = await page.request.post(`${API}/api/v1/sessions`, {
      headers: auth,
      data: { name: 'Folhas B4' },
    });
    expect(createRes.status()).toBe(201);
    const { id: sessionId } = (await createRes.json()) as { id: string };

    // Three assistant replies -> three derived sheets (B1 read path), one per scale tier.
    // The medium one carries the provenance metadata the B1 writers stamp on real runs.
    const bodies: Array<{ content: string; metadata: Record<string, unknown> }> = [
      { content: SHORT_BODY, metadata: { isEssential: true, type: 'text' } },
      {
        content: MEDIUM_BODY,
        metadata: { isEssential: true, type: 'text', traceId: TRACE_ID, memoriesUsed: MEMORIES_USED },
      },
      { content: LONG_BODY, metadata: { isEssential: true, type: 'text' } },
    ];
    for (const body of bodies) {
      const msgRes = await page.request.post(`${API}/api/v1/sessions/${sessionId}/messages`, {
        headers: auth,
        data: { role: 'assistant', ...body },
      });
      expect(msgRes.status()).toBe(201);
    }

    const errors = trackConsoleErrors(page);
    await login(page);

    // Direct-load the seeded session: the panel is present for any conversation with
    // content (locked decision 2) and the feed serves the LIVE B1 sheets read.
    await page.goto(`/chat/${sessionId}`);
    await expect(page.getByTestId('sheet-feed')).toBeVisible({ timeout: 30_000 });
    const cards = page.getByTestId('sheet-card');
    await expect(cards).toHaveCount(3, { timeout: 30_000 });

    // 1a. MARKDOWN: rendered elements, never raw markers.
    const mediumCard = cards.nth(1);
    await expect(
      mediumCard.locator('strong', { hasText: 'agenda clara' }),
      'bold markdown renders as <strong>',
    ).toBeVisible();
    await expect(mediumCard.locator('li')).toHaveCount(3);
    await expect(mediumCard.locator('h1', { hasText: MEDIUM_TITLE })).toBeVisible();
    await expect(page.getByText('**agenda clara**')).toHaveCount(0);

    // 1b. FOOTER - provenance line (PT-PT "n memórias usadas" + subtle traceId).
    const provenance = mediumCard.getByTestId('sheet-provenance');
    await expect(provenance).toContainText(`${MEMORIES_USED} memórias usadas`);
    await expect(provenance).toContainText(TRACE_ID);

    // 1c. FOOTER - actions row: editar + copiar live, promover a disabled-style stub
    //     with the "Brevemente" tooltip on its wrapper.
    await expect(mediumCard.getByTestId('sheet-action-edit')).toBeVisible();
    await expect(mediumCard.getByTestId('sheet-action-copy')).toBeVisible();
    const promote = mediumCard.getByTestId('sheet-action-promote');
    await expect(promote).toBeVisible();
    await expect(promote).toBeDisabled();
    await expect(mediumCard.locator('span[title="Brevemente"]')).toBeVisible();

    // 1d. FOOTER - 2-3 heuristic follow-up suggestions.
    const followUps = await mediumCard.getByTestId('sheet-follow-up').count();
    expect(followUps, 'between 2 and 3 follow-up suggestions').toBeGreaterThanOrEqual(2);
    expect(followUps).toBeLessThanOrEqual(3);

    // 2. TYPOGRAPHY CLASS SWITCH (locked 10): the scale class follows content length.
    const sheetBodies = page.getByTestId('sheet-body');
    await expect(sheetBodies.nth(0)).toHaveClass(/sheet-scale-display/);
    await expect(sheetBodies.nth(1)).toHaveClass(/sheet-scale-article/);
    await expect(sheetBodies.nth(2)).toHaveClass(/sheet-scale-dense/);

    // 3. COPIAR: the latest revision markdown lands on the real clipboard.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await mediumCard.getByTestId('sheet-action-copy').click();
    await expect(mediumCard.getByTestId('sheet-action-copy')).toContainText('Copiado');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard, 'clipboard holds the latest revision markdown').toBe(MEDIUM_BODY);

    // 4. EDITAR: inline edit posts to the LIVE B1 revisions endpoint; the sheet renders
    //    the new revision and revision navigation appears.
    const shortCard = cards.nth(0);
    await shortCard.getByTestId('sheet-action-edit').click();
    const editArea = shortCard.getByTestId('sheet-edit-area');
    await expect(editArea).toBeVisible();
    await expect(editArea, 'edit area prefills the shown revision').toHaveValue(SHORT_BODY);
    await editArea.fill(EDITED_BODY);

    const revisionResponse = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        r.url().includes(`/api/v1/sessions/${sessionId}/sheets/`) &&
        r.url().endsWith('/revisions'),
      { timeout: 30_000 },
    );
    await shortCard.getByTestId('sheet-edit-save').click();
    const revisionRes = await revisionResponse;
    expect(revisionRes.status(), 'live revisions endpoint answers 201').toBe(201);

    // The new revision renders and the nav reports 2 of 2.
    await expect(shortCard.getByTestId('sheet-body')).toContainText('artigo 569');
    const revLabel = shortCard.getByTestId('sheet-rev-label');
    await expect(revLabel).toHaveText('Revisão 2 de 2');
    await expect(shortCard.getByTestId('sheet-rev-next')).toBeDisabled();

    // Walk back to revision 1 (the original agent revision), then forward again.
    await shortCard.getByTestId('sheet-rev-prev').click();
    await expect(revLabel).toHaveText('Revisão 1 de 2');
    await expect(shortCard.getByTestId('sheet-body')).toContainText('prazo de contestação é de 30 dias');
    await expect(shortCard.getByTestId('sheet-rev-prev')).toBeDisabled();
    await shortCard.getByTestId('sheet-rev-next').click();
    await expect(revLabel).toHaveText('Revisão 2 de 2');
    await expect(shortCard.getByTestId('sheet-body')).toContainText('artigo 569');

    // Zero console errors on the dashboard (carried e2e discipline).
    const real = errors.filter((e) => !/event.?source|notifications\/events|network error/i.test(e));
    expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
  });
});
