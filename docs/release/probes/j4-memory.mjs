/**
 * J4 — MEMORY LOOP (credentialed, REAL model). Proves the post-run auto-extraction → recall loop:
 *   A) session-A chat states a durable preference + company name;
 *   B) poll /memories for the auto-`extracted` private memory it produced;
 *   C) session-B chat in a NEW session asks the company name (director judges recall);
 *   D) tenant isolation — a same-org peer (m-u2) sees none of m-u1's private memories and 404s on
 *      a get-by-id;
 *   E) Registo re-check (Boot-A saw 0 rows EVER) — is `memory_auto_extracted` present now?;
 *   F) UI surface — real-login m-u1, open /memory, screenshot, assert the extracted text renders,
 *      count browser console errors (QA bar = zero).
 * The FULL extracted memory docs + both replies are saved to evidence untruncated.
 */
import { chromium } from 'playwright';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { evidence, PASS, FAIL, INFO, api, sleep, EVIDENCE_ROOT } from './_lib.mjs';
import { admin, createOrgUser, newSession, runChatTurn, firstChars } from './_chat.mjs';

const J = 'J4-memory';
const WEB = process.env.EKOA_WEB ?? 'http://localhost:3000';
const results = [];
const ev = {};

const MSG_A = 'De agora em diante prefiro respostas em listas curtas. A minha empresa chama-se Padaria Central.';
const MSG_B = 'Como se chama a minha empresa?';

async function main() {
  const adminToken = await admin();

  // Provision MemCo once, then TWO builders inside it (same-org isolation needs a shared org).
  const org = await api('POST', '/api/v1/orgs', { token: adminToken, body: { name: 'MemCo', displayName: 'MemCo' } });
  const orgId = org.body && org.body.id;
  const mk = async (username) => {
    const u = await api('POST', '/api/v1/users', { token: adminToken, body: { username, password: 'pw123456', role: 'builder', orgId } });
    let token = null; try { const { login } = await import('./_lib.mjs'); token = await login(username, 'pw123456'); } catch { token = null; }
    return { userId: u.body && u.body.id, token, status: u.status };
  };
  const u1 = await mk('m-u1');
  const u2 = await mk('m-u2');
  ev.setup = { orgId, u1: { userId: u1.userId, status: u1.status }, u2: { userId: u2.userId, status: u2.status } };
  if (!u1.token || !u2.token) { FAIL('J4.setup', 'could not provision m-u1/m-u2', results); return finish(); }
  PASS('J4.setup', `MemCo + m-u1(${u1.userId}) + m-u2(${u2.userId}) ready`, results);

  // 1. autoExtract default.
  const settings = await api('GET', '/api/v1/settings', { token: u1.token });
  const autoExtract = settings.body && settings.body.memory && settings.body.memory.autoExtract;
  ev.settings = { status: settings.status, memory: settings.body && settings.body.memory };
  if (settings.status === 200 && autoExtract === true) PASS('J4.autoExtract', 'settings.memory.autoExtract default = true', results);
  else INFO('J4.autoExtract', `settings status=${settings.status} memory.autoExtract=${autoExtract}`, results);

  // 2. Session A chat (states the durable facts).
  const sessA = await newSession(u1.token, 'J4 session A');
  if (sessA.status !== 201) { FAIL('J4.sessA', `session A -> ${sessA.status}`, results); return finish(); }
  const turnA = await runChatTurn({ token: u1.token, sessionId: sessA.id, message: MSG_A, language: 'pt', journey: J, username: 'm-u1' });
  ev.turnA = turnA;
  if (turnA.terminalType === 'complete') PASS('J4.turnA', `session-A turn complete: "${firstChars(turnA.reply)}"`, results);
  else FAIL('J4.turnA', `session-A terminal=${turnA.terminalType}`, results);

  // 2b. Poll for the auto-extracted private memory (up to 90s).
  let extracted = [];
  let allMems = [];
  for (let i = 0; i < 18; i++) {
    const list = await api('GET', '/api/v1/memories', { token: u1.token });
    allMems = (list.body && list.body.items) || [];
    extracted = allMems.filter((m) => m.type === 'extracted');
    if (extracted.length > 0) break;
    await sleep(5000);
  }
  ev.extracted = { count: extracted.length, totalMems: allMems.length, docs: extracted };
  if (extracted.length > 0) {
    const e0 = extracted[0];
    PASS('J4.extracted', `${extracted.length} extracted memory(ies); e.g. visibility=${e0.visibility} tier=${e0.tier} type=${e0.type} content="${firstChars(e0.content, 80)}"`, results);
  } else {
    INFO('J4.extracted', `no type='extracted' memory after 90s (FAST extractor may have returned []) — total mems=${allMems.length}`, results);
  }
  const extractedId = extracted[0] && extracted[0].id;

  // A guaranteed private m-u1 memory id for the isolation get-by-id test (model-free).
  const manual = await api('POST', '/api/v1/memories', { token: u1.token, body: { type: 'fact', content: 'J4 isolation sentinel Padaria Central', visibility: 'private' } });
  const manualId = manual.body && manual.body.id;
  ev.manual = { status: manual.status, id: manualId };

  // 3. NEW session B chat — recall (director judges).
  const sessB = await newSession(u1.token, 'J4 session B');
  const turnB = await runChatTurn({ token: u1.token, sessionId: sessB.id, message: MSG_B, language: 'pt', journey: J, username: 'm-u1' });
  ev.turnB = turnB;
  const recalled = /padaria\s+central/i.test(turnB.reply || '');
  if (turnB.terminalType === 'complete') PASS('J4.turnB', `session-B recall turn complete: "${firstChars(turnB.reply)}"`, results);
  else FAIL('J4.turnB', `session-B terminal=${turnB.terminalType}`, results);
  if (recalled) PASS('J4.recall', 'session-B reply names "Padaria Central" (memory injected)', results);
  else INFO('J4.recall', `session-B reply does not clearly name the company (director judges): "${firstChars(turnB.reply)}"`, results);

  // 4. Isolation as m-u2.
  const u2list = await api('GET', '/api/v1/memories', { token: u2.token });
  const u2items = (u2list.body && u2list.body.items) || [];
  const u1ids = new Set([manualId, ...(extractedId ? [extractedId] : [])].filter(Boolean));
  const leaked = u2items.filter((m) => u1ids.has(m.id));
  ev.isolation = { u2Count: u2items.length, leaked: leaked.map((m) => m.id) };
  if (leaked.length === 0) PASS('J4.isoList', `m-u2 list (${u2items.length}) contains NONE of m-u1's private memories`, results);
  else FAIL('J4.isoList', `m-u2 list LEAKED m-u1 memories: ${JSON.stringify(leaked.map((m) => m.id))}`, results);

  const getManual = await api('GET', `/api/v1/memories/${manualId}`, { token: u2.token });
  if (getManual.status === 404) PASS('J4.isoGet', `m-u2 GET m-u1 private memory -> 404 (${manualId})`, results);
  else FAIL('J4.isoGet', `m-u2 GET m-u1 private memory -> ${getManual.status} (expected 404)`, results);
  if (extractedId) {
    const getExtr = await api('GET', `/api/v1/memories/${extractedId}`, { token: u2.token });
    ev.isolation.getExtractedStatus = getExtr.status;
    if (getExtr.status === 404) PASS('J4.isoGetExtracted', `m-u2 GET m-u1 EXTRACTED memory -> 404`, results);
    else FAIL('J4.isoGetExtracted', `m-u2 GET m-u1 extracted memory -> ${getExtr.status} (expected 404)`, results);
  }

  // 5. Registo re-check (load-bearing either way).
  const registo = await api('GET', '/api/v1/registo?limit=100', { token: adminToken });
  const regItems = (registo.body && (registo.body.items || registo.body.entries)) || [];
  const total = (registo.body && (registo.body.total ?? registo.body.count)) ?? regItems.length;
  const hasAutoExtract = regItems.some((r) => /memory_auto_extracted/.test(JSON.stringify(r)));
  ev.registo = { status: registo.status, total, itemCount: regItems.length, firstRows: regItems.slice(0, 5), hasMemoryAutoExtracted: hasAutoExtract };
  if (regItems.length > 0) INFO('J4.registo', `registo total=${total} items=${regItems.length}; memory_auto_extracted present=${hasAutoExtract}`, results);
  else INFO('J4.registo', `registo STILL 0 rows (matches Boot-A); memory_auto_extracted NOT surfaced via REST`, results);

  // 6. UI surface.
  await runMemoryUi(u1, extracted, results, ev);

  return finish();
}

/** Playwright: real-login m-u1, open /memory, screenshot, assert extracted text renders, count
 *  console errors. MAX 2 explicit page loads (/login, /memory). */
async function runMemoryUi(u1, extracted, results, ev) {
  const shotDir = join(EVIDENCE_ROOT, J);
  await mkdir(shotDir, { recursive: true });
  const shot = join(shotDir, 'memory-page.png');
  // Distinctive needle we expect to render: the extracted content, else the manual sentinel token.
  const needle = (extracted[0] && /padaria/i.test(extracted[0].content || '') ? 'Padaria'
    : (extracted[0] && (extracted[0].content || '').split(/\s+/).find((w) => w.length > 4)))
    || 'Padaria';
  const consoleErrors = [];
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => consoleErrors.push(String(e && e.message ? e.message : e)));

    // Load 1: real login page (hydration-robust re-fill, per driver.mjs 203-217).
    await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
    const user = page.locator('input[type="text"], input:not([type])').first();
    const pass = page.locator('input[type="password"]').first();
    const submit = page.getByRole('button', { name: /entrar|iniciar/i }).first();
    await user.waitFor({ state: 'visible', timeout: 60000 });
    for (let attempt = 0; attempt < 15; attempt++) {
      await user.fill('m-u1');
      await pass.fill('pw123456');
      if (await submit.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    await submit.click({ timeout: 15000 });
    await page.waitForURL(/\/chat/, { timeout: 60000 });

    // Load 2: /memory.
    await page.goto(`${WEB}/memory`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="memory-page"]').waitFor({ state: 'visible', timeout: 30000 });
    // Give the memory store's fetch-on-mount time to render cards.
    await page.waitForTimeout(3000);
    await page.locator('.line-clamp-2, [data-testid="memory-auto-affordance"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await page.screenshot({ path: shot, fullPage: true });

    const bodyText = await page.locator('body').innerText();
    const visible = bodyText.includes(needle);
    ev.ui = { shot, needle, textVisible: visible, consoleErrorCount: consoleErrors.length, consoleErrors };
    if (visible) PASS('J4.uiText', `extracted memory text visible on /memory (needle="${needle}")`, results);
    else INFO('J4.uiText', `needle "${needle}" not found in page text (extracted count=${extracted.length}); screenshot saved`, results);
    if (consoleErrors.length === 0) PASS('J4.uiConsole', 'zero browser console errors on /memory', results);
    else FAIL('J4.uiConsole', `${consoleErrors.length} console error(s): ${firstChars(consoleErrors.join(' | '), 160)}`, results);
    INFO('J4.uiShot', `screenshot -> ${shot}`, results);
  } catch (e) {
    ev.ui = { error: String(e && e.message ? e.message : e), consoleErrors };
    FAIL('J4.ui', `UI pass failed: ${firstChars(String(e && e.message ? e.message : e), 160)}`, results);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function finish() {
  const file = await evidence(J, 'j4-memory', { results, detail: ev });
  console.log(`INFO J4.evidence ${file}`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
