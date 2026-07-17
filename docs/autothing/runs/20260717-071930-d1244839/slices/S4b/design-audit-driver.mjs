/**
 * S4b design-audit driver (standalone, NOT part of the e2e suite).
 * Drives the real /settings/api-keys page, captures the states the design audit judges,
 * and dumps measured geometry so the audit cites numbers, not vibes.
 *
 *   node docs/autothing/runs/20260717-071930-d1244839/slices/S4b/design-audit-driver.mjs
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

/** Measured geometry beats eyeballing: box model of the elements the rubric asks about. */
async function geometry(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1) };
    };
    const q = (s) => document.querySelector(s);
    const tid = (t) => q(`[data-testid="${t}"]`);
    const card = tid('gateway-key-label-input')?.closest('.rounded-xl');
    const rows = [...document.querySelectorAll('tbody tr')];
    const ths = [...document.querySelectorAll('thead th')];
    return {
      docScrollW: document.documentElement.scrollWidth,
      viewportW: window.innerWidth,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      mintCard: box(card),
      mintInput: box(tid('gateway-key-label-input')),
      mintInputWrapper: box(tid('gateway-key-label-input')?.parentElement?.parentElement),
      mintButton: box(tid('gateway-key-mint')),
      listCard: box(tid('gateway-key-list')),
      table: box(q('table')),
      showOnce: box(tid('gateway-key-show-once')),
      secret: box(tid('gateway-key-secret')),
      config: box(tid('gateway-key-config')),
      headers: ths.map((th) => ({ text: th.textContent?.trim(), w: +th.getBoundingClientRect().width.toFixed(1) })),
      rowHeights: rows.map((r) => +r.getBoundingClientRect().height.toFixed(1)),
      // gaps between the stacked cards (the page sets mt-4; PageShell sets space-y-8 - who wins?)
      cardGaps: (() => {
        const cards = [...document.querySelectorAll('[data-testid="settings-api-keys-page"] .rounded-xl')];
        return cards.slice(1).map((c, i) => +(c.getBoundingClientRect().top - cards[i].getBoundingClientRect().bottom).toFixed(1));
      })(),
      computedMt: [...document.querySelectorAll('[data-testid="settings-api-keys-page"] .rounded-xl')].map(
        (c) => getComputedStyle(c).marginTop,
      ),
    };
  });
}

async function mintKey(page, label) {
  await page.getByTestId('gateway-key-label-input').fill(label);
  await page.getByTestId('gateway-key-mint').click();
  await page.getByTestId('gateway-key-show-once').waitFor({ state: 'visible', timeout: 30_000 });
}

async function run(name, width, height) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  const report = { viewport: `${width}x${height}` };
  await login(page);
  await page.goto(`${BASE}/settings/api-keys`);
  await page.getByTestId('settings-api-keys-page').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);

  // --- State 1: the page as an operator first meets it (list may already have rows)
  await shot(page, `design-${name}.png`);
  report.initial = await geometry(page);

  // --- State 2: the show-once panel (the one irreversible moment)
  const stamp = Date.now().toString(36);
  await mintKey(page, `auditoria-${stamp}`);
  await page.waitForTimeout(400);
  await shot(page, `design-${name}-show-once.png`);
  report.showOnceState = await geometry(page);

  // --- State 3: list with an active + a revoked row
  await page.getByTestId('gateway-key-dismiss').click();
  await mintKey(page, `auditoria-revogada-${stamp}`);
  await page.getByTestId('gateway-key-dismiss').click();
  await page.waitForTimeout(300);
  const revokeRow = page.locator('tr', { hasText: `auditoria-revogada-${stamp}` });
  await revokeRow.getByTestId('gateway-key-revoke').click();
  await page.waitForTimeout(300);

  // --- State 4: the inline revoke confirm (captured before confirming)
  await shot(page, `design-${name}-revoke-confirm.png`);
  report.revokeConfirmState = await geometry(page);
  report.confirmCellWidth = await page
    .locator('tbody tr td:last-child')
    .first()
    .evaluate((el) => +el.getBoundingClientRect().width.toFixed(1));

  await revokeRow.getByTestId('gateway-key-revoke-confirm').click();
  await revokeRow.getByTestId('gateway-key-status-revoked').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(page, `design-${name}-list-mixed.png`);
  report.mixedListState = await geometry(page);

  // --- Reference: a sibling settings page, same viewport
  await page.goto(`${BASE}/settings/devices`);
  await page.getByTestId('settings-devices-page').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await shot(page, `reference-devices-${name}.png`);

  await browser.close();
  return report;
}

const desktop = await run('desktop', 1440, 900);
const mobile = await run('mobile', 390, 844);
console.log(JSON.stringify({ desktop, mobile }, null, 2));
