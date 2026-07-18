/**
 * Independent functional probe - S4b: per-user gateway API keys (/settings/api-keys)
 *
 * Fresh-context probe: selectors were discovered from the LIVE DOM, not from any spec.
 * Run:  cd /Users/ggomes/dev/ekoa-code && node docs/autothing/runs/20260717-071930-d1244839/slices/S4b/adversarial-probe.mjs
 *
 * Requires the stack up (web :3000, api :4111) AND the model credential provisioned
 * (node scripts/dev-credential.mjs --no-browser --provision) - count_tokens proxies
 * upstream, so an unprovisioned stack answers 503 instead of 200.
 */
import { chromium } from '@playwright/test';

const WEB = 'http://localhost:3000';
const API = 'http://localhost:4111';
const LABEL = `probe-key-${Date.now().toString(36)}`;

const results = [];
const consoleErrors = [];
let failed = 0;

function check(id, ok, detail) {
  results.push({ id, ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}${detail ? ` :: ${detail}` : ''}`);
}

async function countTokens(secret) {
  const res = await fetch(`${API}/api/v1/llm/v1/messages/count_tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'ola' }] }),
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

const browser = await chromium.launch();
const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();

// --- AC7: console error collection, active for the whole session ---
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`[console] ${m.text()}`);
});
page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));

// ---------- real UI login ----------
// NOTE: fill() can land before React hydrates (the input event is dropped, so the
// submit button stays disabled). Re-fill until the button actually enables.
await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
const userInput = page.locator('input[type="text"]').first();
const passInput = page.locator('input[type="password"]').first();
const submitBtn = page.getByRole('button', { name: 'Entrar' });
await userInput.waitFor({ state: 'visible', timeout: 15000 });

for (let attempt = 0; attempt < 15; attempt++) {
  await userInput.fill('admin');
  await passInput.fill('tmp12345');
  try {
    await submitBtn.waitFor({ state: 'visible', timeout: 1000 });
    if (await submitBtn.isEnabled()) break;
  } catch { /* retry */ }
  await page.waitForTimeout(500);
}
if (!(await submitBtn.isEnabled())) throw new Error('login submit never enabled - could not reach the app');
await submitBtn.click();
await page.waitForURL('**/chat', { timeout: 30000 });

// ---------- AC1: sidebar entry + page reachable + mint form ----------
const sidebarLink = page.locator(`a[href="/settings/api-keys"]`).first();
const sidebarCount = await sidebarLink.count();
const sidebarTitle = sidebarCount
  ? await sidebarLink.locator('[title]').first().getAttribute('title').catch(() => null)
  : null;
check('AC1.sidebar-entry-exists', sidebarCount === 1, `href=/settings/api-keys count=${sidebarCount}`);
check('AC1.sidebar-entry-labelled-Chaves-de-API', sidebarTitle === 'Chaves de API', `title=${JSON.stringify(sidebarTitle)}`);

// navigate BY CLICKING the sidebar entry (not a direct goto)
await sidebarLink.click();
await page.waitForURL('**/settings/api-keys', { timeout: 15000 });
await page.getByTestId('settings-api-keys-page').waitFor({ state: 'visible', timeout: 15000 });
check('AC1.sidebar-click-lands-on-page', page.url().endsWith('/settings/api-keys'), page.url());

const labelInput = page.getByTestId('gateway-key-label-input');
const mintBtn = page.getByTestId('gateway-key-mint');
check('AC1.mint-form-input-visible', await labelInput.isVisible(), await labelInput.getAttribute('placeholder'));
check('AC1.mint-form-button-visible', await mintBtn.isVisible(), (await mintBtn.innerText()).trim());

// ---------- AC2: mint -> show-once panel ----------
await labelInput.fill(LABEL);
await mintBtn.click();

const panel = page.getByTestId('gateway-key-show-once');
await panel.waitFor({ state: 'visible', timeout: 15000 });

const secret = (await page.getByTestId('gateway-key-secret').innerText()).trim();
check('AC2.panel-visible', await panel.isVisible());
check('AC2.secret-prefix-ekoa_gk_', secret.startsWith('ekoa_gk_'), `secret.len=${secret.length} prefix=${secret.slice(0, 8)}`);

const copyBtn = page.getByTestId('gateway-key-copy');
check('AC2.copy-button-present', await copyBtn.isVisible(), (await copyBtn.innerText()).trim());

// copy button actually places the exact secret on the clipboard
let clipboardOk = false, clipboardDetail = '';
try {
  await copyBtn.click();
  await page.waitForTimeout(400);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  clipboardOk = clip === secret;
  clipboardDetail = clipboardOk ? 'clipboard === secret' : `clipboard mismatch (len=${clip?.length})`;
} catch (e) {
  clipboardDetail = `clipboard read unavailable: ${e.message}`;
}
check('AC2.copy-button-copies-exact-secret', clipboardOk, clipboardDetail);

const warnText = (await page.getByTestId('gateway-key-show-once-warning').innerText()).trim();
const warnsNotShownAgain = /não volta a ser mostrada/i.test(warnText);
check('AC2.explicit-not-shown-again-warning', warnsNotShownAgain, JSON.stringify(warnText));

const config = (await page.getByTestId('gateway-key-config').innerText()).trim();
check('AC2.config-has-ANTHROPIC_BASE_URL', config.includes(`ANTHROPIC_BASE_URL=${API}/api/v1/llm`),
  JSON.stringify(config.split('\n').find((l) => l.startsWith('ANTHROPIC_BASE_URL')) ?? config));
check('AC2.config-has-ANTHROPIC_AUTH_TOKEN-exact-secret', config.includes(`ANTHROPIC_AUTH_TOKEN=${secret}`),
  `token line matches minted secret: ${config.includes(`ANTHROPIC_AUTH_TOKEN=${secret}`)}`);

// ---------- AC3: list row ----------
const row = page.locator('tr', { hasText: LABEL }).first();
await row.waitFor({ state: 'visible', timeout: 10000 });
const cells = await row.locator('td').allInnerTexts();
const expectedHint = `ekoa_gk_...${secret.slice(-4)}`;
const rowText = await row.innerText();

check('AC3.row-has-label', cells[0]?.trim() === LABEL, JSON.stringify(cells[0]));
check('AC3.row-hint-is-truncated-last4', cells[1]?.trim() === expectedHint, `got=${JSON.stringify(cells[1]?.trim())} expected=${JSON.stringify(expectedHint)}`);
check('AC3.row-NEVER-shows-full-secret', !rowText.includes(secret), 'full secret absent from row');
check('AC3.row-has-created-date', /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cells[2]?.trim() ?? ''), JSON.stringify(cells[2]));
check('AC3.row-status-active', (await row.getByTestId('gateway-key-status-active').count()) === 1
  && (await row.getByTestId('gateway-key-status-active').innerText()).trim() === 'Ativa', JSON.stringify(cells[4]));

// ---------- AC6a: api honours the ACTIVE key ----------
const before = await countTokens(secret);
check('AC6a.active-key-count_tokens-200', before.status === 200, `HTTP ${before.status} body=${JSON.stringify(before.body)}`);
check('AC6a.active-key-returns-input_tokens', typeof before.body?.input_tokens === 'number', `input_tokens=${before.body?.input_tokens}`);

// ---------- AC4: after reload the secret is GONE ----------
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByTestId('settings-api-keys-page').waitFor({ state: 'visible', timeout: 15000 });
await page.locator('tr', { hasText: LABEL }).first().waitFor({ state: 'visible', timeout: 10000 });

const bodyText = await page.locator('body').innerText();
const renderedDom = await page.content();
const rawSource = await (await fetch(`${WEB}/settings/api-keys`)).text();

check('AC4.panel-gone-after-reload', (await page.getByTestId('gateway-key-show-once').count()) === 0);
check('AC4.secret-absent-from-visible-text', !bodyText.includes(secret));
check('AC4.secret-absent-from-rendered-DOM', !renderedDom.includes(secret));
check('AC4.secret-absent-from-page-source', !rawSource.includes(secret), `raw source ${rawSource.length} bytes`);
check('AC4.row-still-present-after-reload', (await page.locator('tr', { hasText: LABEL }).count()) === 1);
check('AC4.hint-still-shown-after-reload',
  (await page.locator('tr', { hasText: LABEL }).first().locator('td').nth(1).innerText()).trim() === expectedHint);

// ---------- AC5: revoke requires inline confirm ----------
const row2 = page.locator('tr', { hasText: LABEL }).first();
await row2.getByTestId('gateway-key-revoke').click();
await page.waitForTimeout(600);

// clicking revoke must NOT revoke yet - a confirm must appear first
const confirmBtn = row2.getByTestId('gateway-key-revoke-confirm');
check('AC5.inline-confirm-appears', (await confirmBtn.count()) === 1);
check('AC5.cancel-affordance-present', (await row2.getByTestId('gateway-key-revoke-cancel').count()) === 1);
check('AC5.still-active-before-confirming', (await row2.getByTestId('gateway-key-status-active').count()) === 1,
  'status still Ativa while confirm pending');

const stillActive = await countTokens(secret);
check('AC5.api-still-accepts-before-confirm', stillActive.status === 200, `HTTP ${stillActive.status}`);

// cancel restores the plain revoke button (no revocation)
await row2.getByTestId('gateway-key-revoke-cancel').click();
await page.waitForTimeout(500);
check('AC5.cancel-aborts-revocation',
  (await row2.getByTestId('gateway-key-revoke').count()) === 1 && (await row2.getByTestId('gateway-key-status-active').count()) === 1,
  'cancel returns to Ativa + Revogar button');

// now really revoke
await row2.getByTestId('gateway-key-revoke').click();
await row2.getByTestId('gateway-key-revoke-confirm').click();
await row2.getByTestId('gateway-key-status-revoked').waitFor({ state: 'visible', timeout: 10000 });

check('AC5.status-flips-to-revoked', (await row2.getByTestId('gateway-key-status-revoked').innerText()).trim() === 'Revogada');
check('AC5.revoke-control-disappears',
  (await row2.getByTestId('gateway-key-revoke').count()) === 0 && (await row2.getByTestId('gateway-key-revoke-confirm').count()) === 0,
  'no revoke/confirm control on the revoked row');

// ---------- AC6b: api rejects the REVOKED key ----------
const after = await countTokens(secret);
check('AC6b.revoked-key-count_tokens-401', after.status === 401, `HTTP ${after.status} body=${JSON.stringify(after.body)}`);

// revocation must survive a reload
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByTestId('settings-api-keys-page').waitFor({ state: 'visible', timeout: 15000 });
const row3 = page.locator('tr', { hasText: LABEL }).first();
await row3.waitFor({ state: 'visible', timeout: 10000 });
check('AC5.revoked-persists-after-reload', (await row3.getByTestId('gateway-key-status-revoked').count()) === 1);

// ---------- AC7 ----------
check('AC7.zero-console-errors', consoleErrors.length === 0, consoleErrors.length ? consoleErrors.join(' | ') : 'none');

await browser.close();

console.log('\n================ SUMMARY ================');
console.log(`label under test : ${LABEL}`);
console.log(`checks           : ${results.length}`);
console.log(`failed           : ${failed}`);
console.log(`console errors   : ${consoleErrors.length}`);
console.log(`RESULT: ${failed === 0 ? 'pass' : 'fail'}`);
process.exit(failed === 0 ? 0 : 1);
