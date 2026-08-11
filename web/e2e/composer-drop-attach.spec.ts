import { test, expect, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

/**
 * WS4b - composer drag-drop + paste, against the REAL dev servers (Session Start Rule): a
 * dropped/pasted file genuinely reaches `POST /api/v1/uploads` (WS4a's real endpoint) and lands
 * as a visible attachment chip, and a pasted long-text block stages as a text attachment instead
 * of filling the textarea. Exercises the empty-state composer (`page.tsx`) - the one every fresh
 * session lands on; the in-session composer (`chat-panel.tsx`) shares the identical handler
 * logic and is covered at the unit level (`chat-panel-composer.test.tsx`) since reaching it here
 * needs a session with content first, which the drop/paste logic itself doesn't depend on.
 *
 * DataTransfer is constructed in-page (`page.evaluateHandle`) and handed to `dispatchEvent` -
 * Playwright has no first-class drag-and-drop-a-real-OS-file API, so this is the standard way to
 * simulate a browser-level file drop/paste.
 */

async function login(page: Page) {
  await uiLogin(page);
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function fileDataTransfer(page: Page, name: string, content: string, type = 'text/plain') {
  return page.evaluateHandle(
    ({ name, content, type }) => {
      const dt = new DataTransfer();
      const file = new File([content], name, { type });
      dt.items.add(file);
      return dt;
    },
    { name, content, type },
  );
}

test.describe('composer drag-drop + paste (WS4b)', () => {
  test('a file dropped onto the composer stages as a visible attachment chip', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    const dropZone = page.getByTestId('composer-drop-zone');
    await expect(dropZone).toBeVisible();

    const dataTransfer = await fileDataTransfer(page, 'nota-e2e.txt', 'conteúdo de teste do drop');
    await dropZone.dispatchEvent('drop', { dataTransfer });

    // The staged attachment renders as a chip carrying the file's display name.
    await expect(page.getByText('nota-e2e.txt')).toBeVisible({ timeout: 15_000 });

    const meaningful = errors.filter((e) => !e.includes('favicon') && !e.includes('Download the React DevTools'));
    expect(meaningful, `console errors: ${meaningful.join(' | ')}`).toHaveLength(0);
  });

  test('a long pasted text block stages as a text attachment, never filling the textarea', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    const composer = page.locator('textarea').first();
    await composer.click();

    const longText = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20); // > 800 chars
    const dataTransfer = await fileDataTransfer(page, 'ignored.txt', longText); // ClipboardEvent reuses the same DataTransfer shape
    await composer.dispatchEvent('paste', { clipboardData: dataTransfer });

    // Staged as an attachment chip (the label is a truncated snippet of the pasted text) -
    // never dumped into the textarea.
    await expect(page.getByText(/Lorem ipsum/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(composer).toHaveValue('');

    const meaningful = errors.filter((e) => !e.includes('favicon') && !e.includes('Download the React DevTools'));
    expect(meaningful, `console errors: ${meaningful.join(' | ')}`).toHaveLength(0);
  });

  test('a short pasted text stays in the textarea (no attachment, native paste untouched)', async ({ page }) => {
    await login(page);

    const composer = page.locator('textarea').first();
    await composer.click();

    const shortText = 'olá, isto é uma mensagem curta';
    const dataTransfer = await page.evaluateHandle((text) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      return dt;
    }, shortText);
    await composer.dispatchEvent('paste', { clipboardData: dataTransfer });

    // Our handler never called preventDefault for this paste, so the browser's own native
    // paste-insert ran: the text landed in the textarea, exactly like before this feature shipped.
    await expect(composer).toHaveValue(shortText);
  });
});
