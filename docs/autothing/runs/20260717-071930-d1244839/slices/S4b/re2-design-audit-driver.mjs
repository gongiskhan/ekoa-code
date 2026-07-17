/**
 * S4b design RE-AUDIT 2 driver (standalone) - verifies fix fcaaa83.
 * The whole finding-2 saga is "content does not fit its container", so this measures the tightest
 * reachable states, not just the two nominal viewports:
 *   - 1440: all 6 columns, card capped at max-w-2xl
 *   - 768 : the md boundary - all 6 columns turn on while the card is STILL 672 (same as 1440)
 *   - 390 : Nome + Estado + action only; the revoke action must be visible AND tappable in-card
 *   - 390 with a maxLength=64 label - a reachable state the input permits
 *
 *   node docs/autothing/runs/20260717-071930-d1244839/slices/S4b/re2-design-audit-driver.mjs
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const shot = (page, name) => page.screenshot({ path: join(OUT, name), fullPage: true });

async function login(page) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 90_000 });
}

/** The measurement that decided rounds 1 and 2: does the table fit, and is the action reachable? */
async function fit(page) {
  return page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return { noTable: true };
    const wrap = table.parentElement;
    const wr = wrap.getBoundingClientRect();
    const clipRight = wr.right - 1;
    const revoke = document.querySelector('[data-testid="gateway-key-revoke"]');
    const rb = revoke?.getBoundingClientRect();
    return {
      wrap_clientW: wrap.clientWidth,
      table_scrollW: table.scrollWidth,
      table_offsetW: table.offsetWidth,
      overBy: +(table.scrollWidth - wrap.clientWidth).toFixed(1),
      CLIPPED: table.scrollWidth > wrap.clientWidth + 0.5,
      wrapCanScroll: wrap.scrollWidth > wrap.clientWidth,
      shell_scrollsH: (() => { const s = document.querySelector('[data-testid="settings-api-keys-page"]');
        return s ? s.scrollWidth > s.clientWidth : null; })(),
      doc_overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      visibleCols: [...document.querySelectorAll('thead th')]
        .filter((th) => getComputedStyle(th).display !== 'none').map((th) => th.textContent?.trim() || '(action)'),
      // the action: present, inside the card, and big enough to tap?
      revoke: rb ? { x: +rb.x.toFixed(1), right: +rb.right.toFixed(1), w: +rb.width.toFixed(1), h: +rb.height.toFixed(1) } : null,
      revoke_insideCard: rb ? rb.right <= clipRight + 0.5 : null,
      revoke_pastClipPx: rb ? +(rb.right - clipRight).toFixed(1) : null,
      revoke_ariaLabel: revoke?.getAttribute('aria-label') ?? null,
      revoke_tapTarget: rb ? `${+rb.width.toFixed(0)}x${+rb.height.toFixed(0)}` : null,
      // hit-test the action's centre: does the click actually land on the button?
      revoke_hitTest: rb ? (() => {
        const el = document.elementFromPoint(rb.x + rb.width / 2, rb.y + rb.height / 2);
        return el ? (el.closest('[data-testid="gateway-key-revoke"]') ? 'button' : el.tagName + '.' + String(el.className).slice(0, 30)) : 'nothing';
      })() : null,
      rowHeights: [...document.querySelectorAll('tbody tr')].slice(0, 6).map((r) => +r.getBoundingClientRect().height.toFixed(1)),
    };
  });
}

async function mintKey(page, label) {
  await page.getByTestId('gateway-key-label-input').fill(label);
  await page.getByTestId('gateway-key-mint').click();
  await page.getByTestId('gateway-key-show-once').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('gateway-key-dismiss').click();
}

async function open(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await login(page);
  await page.goto(`${BASE}/settings/api-keys`);
  await page.getByTestId('settings-api-keys-page').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  return page;
}

const browser = await chromium.launch();
const out = {};

// --- 1440: widest state, all 6 columns
{
  const page = await open(browser, 1440, 900);
  const errs = []; page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  out.desktop_1440 = await fit(page);
  await shot(page, 're2-design-desktop.png');
  // dialog, now naming the key
  await page.locator('[data-testid="gateway-key-revoke"]').first().click();
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(page, 're2-design-desktop-revoke-dialog.png');
  out.dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const r = d.getBoundingClientRect();
    return { withinViewport: r.left >= 0 && r.right <= window.innerWidth, text: d.textContent?.trim().slice(0, 220) };
  });
  await page.getByRole('dialog').getByRole('button', { name: /cancelar/i }).click();
  await page.waitForTimeout(300);
  const stamp = Date.now().toString(36);
  await mintKey(page, `re2-${stamp}`);
  await page.waitForTimeout(400);
  await shot(page, 're2-design-desktop-show-once.png');
  await mintKey(page, `re2-mix-${stamp}`);
  await page.waitForTimeout(300);
  await shot(page, 're2-design-desktop-list-mixed.png');
  out.desktop_1440_mixed = await fit(page);
  out.desktop_consoleErrors = errs;
  await page.close();
}

// --- 768: the md boundary. All 6 columns ON, card still capped at 672 = the true worst case.
{
  const page = await open(browser, 768, 900);
  out.boundary_768 = await fit(page);
  await shot(page, 're2-design-md-boundary-768.png');
  await page.close();
}
// --- 767: one px below md
{
  const page = await open(browser, 767, 900);
  out.boundary_767 = await fit(page);
  await page.close();
}
// --- 640 / 639: the sm boundary
{
  const page = await open(browser, 640, 900);
  out.boundary_640 = await fit(page);
  await page.close();
}

// --- 390: mixed list, the action must be visible and tappable inside the card
{
  const page = await open(browser, 390, 844);
  const errs = []; page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  out.mobile_390 = await fit(page);
  await shot(page, 're2-design-mobile.png');
  const stamp = Date.now().toString(36);
  await mintKey(page, `re2-m-${stamp}`);
  await page.waitForTimeout(400);
  await shot(page, 're2-design-mobile-show-once.png');
  await mintKey(page, `re2-mrev-${stamp}`);
  await page.waitForTimeout(300);
  out.mobile_390_mixed = await fit(page);
  await shot(page, 're2-design-mobile-list-mixed.png');
  // the dialog at narrow
  const row = page.locator('tr', { hasText: `re2-mrev-${stamp}` });
  await row.getByTestId('gateway-key-revoke').click();
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(page, 're2-design-mobile-revoke-dialog.png');
  out.mobile_dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const r = d.getBoundingClientRect();
    return { withinViewport: r.left >= 0 && r.right <= window.innerWidth, text: d.textContent?.trim().slice(0, 220) };
  });
  await page.getByRole('dialog').getByRole('button', { name: /revogar/i }).click();
  await row.getByTestId('gateway-key-status-revoked').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);

  // --- the reachable edge case: a maxLength=64 label
  const long = 'chave-do-portatil-de-trabalho-do-goncalo-para-o-claude-code-2026';
  await mintKey(page, long);
  await page.waitForTimeout(500);
  out.mobile_390_longLabel = { labelLen: long.length, ...(await fit(page)) };
  await shot(page, 're2-design-mobile-long-label.png');
  out.mobile_consoleErrors = errs;
  await page.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 1));
