import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile sheet-feed overlay (Part B slice B6, run 20260717-190134; BRIEF locked decision 9:
 * "Mobile unchanged: rail + FAB overlay; the sheet feed becomes the overlay content").
 * Proves, on a mobile viewport (390x844, below the md breakpoint) against the LIVE stack
 * (no protocol stubs at all):
 *
 *   1. The desktop side panel is hidden; the rail + FAB pattern renders instead, with the
 *      FABs carrying LOCALIZED accessible names (the B3 review note: "mobile FAB strings
 *      still hardcoded English") - "Mostrar painel" + "Histórico de sessões".
 *   2. Tapping the panel FAB opens the bottom-sheet overlay whose content is the sheet
 *      feed (the B3 panel-union inheritance): drawer header names "Folhas" (not the build
 *      "Pré-visualização"), the feed's own desktop header row stays hidden (no double
 *      title), and the seeded sheet cards render.
 *   3. Footer actions are reachable and tappable inside the overlay: the LAST card (below
 *      the fold - the overlay scrolls) takes a real copiar tap ("Copiado" feedback +
 *      clipboard holds the revision markdown) and editar opens the inline edit area.
 *   4. A follow-up pill sets the composer chip; after closing the overlay the chip
 *      ("A editar: ...") is visible in the MOBILE composer and the pill text is drafted.
 *   5. Zero console errors (carried e2e discipline).
 *
 * Real UI login, PT-PT strings (the app's default locale).
 */

const API = 'http://localhost:4111';

const SHORT_BODY = 'Sim, o prazo de contestação é de 30 dias.';
const MEDIUM_BODY = [
  '# Guia de reuniões eficazes',
  '',
  'Uma reunião eficaz começa com uma **agenda clara** e termina com decisões registadas.',
  '',
  '- Prepare a agenda com antecedência',
  '- Partilhe os documentos com os participantes',
  '- Registe as decisões e os próximos passos',
].join('\n');
const LONG_BODY =
  '# Parecer sobre prazos processuais\n\n' +
  Array.from(
    { length: 10 },
    (_, i) =>
      `Parágrafo ${i + 1}: ` +
      'A contagem dos prazos processuais segue o Código de Processo Civil e suspende-se em férias judiciais quando aplicável. '.repeat(
        2,
      ),
  ).join('\n\n');

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

test.describe('mobile sheet-feed overlay (B6)', () => {
  // Below the md (768px) breakpoint: the desktop panel is display:none and the
  // page renders the rail + FAB overlay pattern (locked decision 9).
  test.use({ viewport: { width: 390, height: 844 } });

  test('FAB opens the overlay; overlay hosts the sheet feed; footer actions tappable; chip renders in the mobile composer', async ({
    page,
  }) => {
    // -- Seed via the API (Playwright request context; the page never sees these calls).
    const loginRes = await page.request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'admin', password: 'tmp12345' },
    });
    expect(loginRes.ok()).toBe(true);
    const { token } = (await loginRes.json()) as { token: string };
    const auth = { authorization: `Bearer ${token}` };

    // Pre-clean: /chat auto-resumes the most recent session; stale sessions would leave
    // ambiguous sheet cards. Fresh slate per run keeps the asserts deterministic.
    const listRes = await page.request.get(`${API}/api/v1/sessions`, { headers: auth });
    expect(listRes.ok()).toBe(true);
    const { items: existing } = (await listRes.json()) as { items: Array<{ id: string }> };
    for (const s of existing) {
      await page.request.delete(`${API}/api/v1/sessions/${s.id}`, { headers: auth });
    }

    const createRes = await page.request.post(`${API}/api/v1/sessions`, {
      headers: auth,
      data: { name: 'Folhas móvel B6' },
    });
    expect(createRes.status()).toBe(201);
    const { id: sessionId } = (await createRes.json()) as { id: string };

    // Three assistant replies -> three derived sheets (B1 read path). Three cards make
    // the 85vh overlay scroll, so reaching the LAST card proves overlay scrolling.
    for (const content of [SHORT_BODY, MEDIUM_BODY, LONG_BODY]) {
      const msgRes = await page.request.post(`${API}/api/v1/sessions/${sessionId}/messages`, {
        headers: auth,
        data: { role: 'assistant', content, metadata: { isEssential: true, type: 'text' } },
      });
      expect(msgRes.status()).toBe(201);
    }

    const errors = trackConsoleErrors(page);
    await login(page);
    await page.goto(`/chat/${sessionId}`);

    // 1. MOBILE FRAME: the desktop panel container is display:none below md; the FABs
    //    render with LOCALIZED accessible names (the B6 i18n fix - PT is the default).
    const panelFab = page.getByRole('button', { name: 'Mostrar painel' });
    await expect(panelFab).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Histórico de sessões' })).toBeVisible();
    await expect(page.getByTestId('side-panel-container')).toBeHidden();
    await expect(page.getByTestId('sheet-feed')).toBeHidden();

    // 2. FAB -> overlay hosts the SHEET FEED (the B3 panel-union inheritance). All
    //    overlay locators scope to the drawer: the CSS-hidden desktop container keeps
    //    its own feed instance in the DOM.
    await panelFab.click();
    const drawer = page.getByTestId('mobile-side-panel-drawer');
    const feed = drawer.getByTestId('sheet-feed');
    await expect(feed).toBeVisible({ timeout: 15_000 });
    const cards = drawer.getByTestId('sheet-card');
    await expect(cards).toHaveCount(3, { timeout: 30_000 });
    // Drawer header names the sheet feed, not the build preview...
    await expect(drawer.getByTestId('mobile-drawer-title')).toHaveText('Folhas');
    // ...and the feed's own desktop header row stays hidden (no stacked double title).
    await expect(feed.getByTestId('sheet-feed-header')).toBeHidden();

    // 3a. FOOTER ACTIONS REACHABLE: the LAST card sits below the fold; the overlay
    //     scrolls it into reach and copiar takes a real tap.
    const lastCard = cards.nth(2);
    await lastCard.scrollIntoViewIfNeeded();
    await expect(lastCard.getByTestId('sheet-action-edit')).toBeVisible();
    const copy = lastCard.getByTestId('sheet-action-copy');
    await expect(copy).toBeVisible();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await copy.click();
    await expect(copy).toContainText('Copiado');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard, 'clipboard holds the tapped sheet markdown').toBe(LONG_BODY);

    // 3b. editar opens the inline edit area on mobile too; cancelar restores the card.
    await lastCard.getByTestId('sheet-action-edit').click();
    await expect(lastCard.getByTestId('sheet-edit-area')).toBeVisible();
    await lastCard.getByTestId('sheet-edit-cancel').click();
    await expect(lastCard.getByTestId('sheet-edit-area')).toHaveCount(0);

    // 4. FOLLOW-UP PILL -> composer chip in the MOBILE composer (locked 6: the pill is
    //    the manual SET affordance; the chip must be visible before any send).
    const firstCard = cards.nth(0);
    await firstCard.scrollIntoViewIfNeeded();
    const pill = firstCard.getByTestId('sheet-follow-up').first();
    const pillText = (await pill.innerText()).trim();
    await pill.click();
    await drawer.getByRole('button', { name: 'Ocultar painel' }).click();
    await expect(feed).toBeHidden();
    const chip = page.getByTestId('composer-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('A editar:');
    await expect(
      page.locator('textarea'),
      'the pill text is drafted into the mobile composer',
    ).toHaveValue(pillText);

    // 5. Zero console errors on the dashboard (carried e2e discipline).
    const real = errors.filter((e) => !/event.?source|notifications\/events|network error/i.test(e));
    expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
  });
});
