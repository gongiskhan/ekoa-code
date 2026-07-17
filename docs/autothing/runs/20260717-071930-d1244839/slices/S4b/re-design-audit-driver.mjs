/**
 * S4b design RE-AUDIT driver (standalone, NOT part of the e2e suite) - verifies fix 2d5399f.
 * Same states as the first pass, re- prefix, plus the measurements that decided the original
 * verdict: table-vs-card geometry at both widths, shell scroll, and - new for this pass - whether
 * ui/table's `overflow-hidden` wrapper CLIPS content out of reach at narrow.
 *
 *   node docs/autothing/runs/20260717-071930-d1244839/slices/S4b/re-design-audit-driver.mjs
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

async function geometry(page) {
  return page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1) };
    };
    const tid = (t) => document.querySelector(`[data-testid="${t}"]`);
    const shell = document.querySelector('[data-testid="settings-api-keys-page"]');
    const table = document.querySelector('table');
    const wrap = table?.parentElement; // ui/table's overflow-hidden self-carding container
    const inp = tid('gateway-key-label-input');
    const mintCard = inp?.closest('.rounded-xl');
    const revoke = tid('gateway-key-revoke');
    return {
      // --- the two structural findings ---
      shell_scrollW: shell?.scrollWidth, shell_clientW: shell?.clientWidth,
      shell_scrollsHorizontally: shell ? shell.scrollWidth > shell.clientWidth : null,
      doc_scrollW: document.documentElement.scrollWidth, doc_clientW: document.documentElement.clientWidth,
      doc_overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      wrap_overflowX: wrap ? getComputedStyle(wrap).overflowX : null,
      wrap_clientW: wrap?.clientWidth, table_scrollW: table?.scrollWidth,
      table_escapesWrap: wrap && table ? table.getBoundingClientRect().right > wrap.getBoundingClientRect().right + 0.5 : null,
      table_overhangPx: wrap && table ? +(table.getBoundingClientRect().right - wrap.getBoundingClientRect().right).toFixed(1) : null,
      // CLIPPING: overflow-hidden hides rather than scrolls - is anything cut out of reach?
      table_contentClipped: wrap && table ? table.scrollWidth > wrap.clientWidth + 0.5 : null,
      revokeBtn: box(revoke),
      revokeFullyVisible: revoke ? revoke.getBoundingClientRect().right <= window.innerWidth : null,
      // --- mint form fill ---
      mintCard: box(mintCard), mintInput: box(inp), mintButton: box(tid('gateway-key-mint')),
      mintInputFillsCard: mintCard && inp
        ? +(mintCard.getBoundingClientRect().right - 20 - inp.getBoundingClientRect().right).toFixed(1)
        : null,
      mintBtnLines: (() => { const b = tid('gateway-key-mint'); return b ? +(b.getBoundingClientRect().height).toFixed(1) : null; })(),
      // --- table chrome vs canonical ---
      visibleHeaders: [...document.querySelectorAll('thead th')]
        .filter((th) => getComputedStyle(th).display !== 'none')
        .map((th) => ({ t: th.textContent?.trim(), w: +th.getBoundingClientRect().width.toFixed(1) })),
      theadBg: (() => { const th = document.querySelector('thead'); return th ? getComputedStyle(th).backgroundColor : null; })(),
      thStyle: (() => { const th = document.querySelector('thead th'); if (!th) return null; const s = getComputedStyle(th);
        return { fs: s.fontSize, fw: s.fontWeight, tt: s.textTransform, ls: s.letterSpacing, color: s.color, pad: s.padding }; })(),
      rowHeights: [...document.querySelectorAll('tbody tr')].map((r) => +r.getBoundingClientRect().height.toFixed(1)),
      // --- badges ---
      badges: [...document.querySelectorAll('tbody [class*="rounded-full"]')].slice(0, 4).map((b) => {
        const s = getComputedStyle(b);
        return { text: b.textContent?.trim(), bg: s.backgroundColor, color: s.color, radius: s.borderRadius };
      }),
      dates: [...document.querySelectorAll('tbody tr')].slice(0, 3).map((r) => r.children[2]?.textContent?.trim()),
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
  const consoleErrors = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  await login(page);
  await page.goto(`${BASE}/settings/api-keys`);
  await page.getByTestId('settings-api-keys-page').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);

  await shot(page, `re-design-${name}.png`);
  report.initial = await geometry(page);

  const stamp = Date.now().toString(36);
  await mintKey(page, `reaudit-${stamp}`);
  await page.waitForTimeout(400);
  await shot(page, `re-design-${name}-show-once.png`);
  report.showOnce = await geometry(page);

  await page.getByTestId('gateway-key-dismiss').click();
  await mintKey(page, `reaudit-rev-${stamp}`);
  await page.getByTestId('gateway-key-dismiss').click();
  await page.waitForTimeout(300);

  // --- the revoke DIALOG (was: paragraph in a td)
  const revokeRow = page.locator('tr', { hasText: `reaudit-rev-${stamp}` });
  await revokeRow.getByTestId('gateway-key-revoke').click();
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(400);
  await shot(page, `re-design-${name}-revoke-dialog.png`);
  report.dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return {
      box: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      withinViewport: r.left >= 0 && r.right <= window.innerWidth,
      centeredWithin: +Math.abs(r.left - (window.innerWidth - r.right)).toFixed(1),
      text: d.textContent?.trim().slice(0, 200),
      buttons: [...d.querySelectorAll('button')].map((b) => b.textContent?.trim()).filter(Boolean),
    };
  });
  report.dialogOpen_tableGeom = await geometry(page);

  // confirm it through the dialog
  await page.getByRole('dialog').getByRole('button', { name: /revogar/i }).click();
  await revokeRow.getByTestId('gateway-key-status-revoked').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await shot(page, `re-design-${name}-list-mixed.png`);
  report.mixedList = await geometry(page);

  report.consoleErrors = consoleErrors;
  await browser.close();
  return report;
}

const desktop = await run('desktop', 1440, 900);
const mobile = await run('mobile', 390, 844);
console.log(JSON.stringify({ desktop, mobile }, null, 2));
