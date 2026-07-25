import { test, expect, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cortexBase } from './helpers/legal';

/**
 * Document base v2 - the source-linked REDLINE REVIEW surface, end-to-end (2C-S6).
 *
 * The document base's shell has two modes. Authored mode renders `blocks`. Source-linked
 * mode (`documentData.sourceDocument`) drops that entirely and works over an EXISTING Word
 * file the platform holds: it renders the CriticMarkup projection from
 * GET /api/app-docx/projection as a redline preview, and every review action - accept a
 * tracked change, comment on a selection, reply in a thread, resolve the thread - POSTs to
 * /api/app-docx/edits and re-renders from the markdown that comes back. This spec is the
 * regression net for that whole loop, through the REAL served app.
 *
 * LLM-FREE AND HERMETIC BY CONSTRUCTION. No agent is driven and no model is called:
 *
 *  1. The app is the platform's OWN document base scaffold. Its files are copied verbatim
 *     out of api/assets/bases/document/scaffold/ into a temp project (the only edit is
 *     documentData.js, which is what a build agent would write) and registered through
 *     POST /api/dev/register, so the api builds and serves it with the same pipeline and
 *     the same injected context as any generated app. A drift between the shipped base and
 *     this spec is therefore a real defect, not a fixture that rotted.
 *  2. The linked document is seeded DIRECTLY into <EKOA_DATA_DIR>/app-data/{appId}/docx -
 *     the two well-known blobs plus the meta sidecar apps/document-source.ts owns - from a
 *     committed .docx that already carries native tracked changes and a comment thread
 *     (fixtures/contrato-redline.docx, regenerate with scripts/make-redline-fixture.mjs).
 *
 * The proof is the FILE, not the DOM: after the review round-trip the working .docx is
 * downloaded from GET /api/app-docx/current and unzipped, and the OOXML is asserted
 * directly - surviving w:ins/w:del (native track changes) and a word/comments.xml carrying
 * the reply and the selection comment. Zero console errors throughout (§ e2e discipline).
 *
 * The second test is the additive half of the same graft: the SAME shell with no
 * `sourceDocument` must behave exactly as it did before this feature - authored blocks
 * (ekoa-code's own pagebreak/signatures types included), plain toolbar, notes tab, and not
 * one call to /api/app-docx.
 *
 * Runs against the api ALONE (the served-app plane), like the band3 byte-compat specs -
 * no dashboard, no login.
 */

const APP_ID = 'e2e-doc-redline';
const SOURCE_FILE = 'contrato-revisto.docx';
const BASE = cortexBase();
const APP_URL = `${BASE}/apps/${APP_ID}/`;

const REPO_ROOT = resolve(__dirname, '..', '..');
const BASE_SCAFFOLD = join(REPO_ROOT, 'api/assets/bases/document/scaffold/frontend/src');
const FIXTURE = join(__dirname, 'fixtures/contrato-redline.docx');

/**
 * The SAME base scaffold with no `sourceDocument`, i.e. every document app built before
 * this feature existed. Its only job is to prove the graft is additive: authored mode must
 * still render ekoa-code's own block vocabulary (pagebreak + signatures included) and keep
 * the plain "Descarregar Word" toolbar, never touching /api/app-docx.
 */
const AUTHORED_ID = 'e2e-doc-authored';
const AUTHORED_URL = `${BASE}/apps/${AUTHORED_ID}/`;

/** apps/document-source.ts's own root resolution, mirrored (EKOA_DATA_DIR or ~/.ekoa/data). */
function appDataDir(id: string): string {
  return join(process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data'), 'app-data', id);
}

function docxDir(): string {
  return join(appDataDir(APP_ID), 'docx');
}

const projectDirs: string[] = [];

/**
 * Error tracking with a precise 404 net (regressions-dashboard.spec.ts's pattern): the bare
 * "Failed to load resource" console line carries no URL, so 4xx/5xx are pinned from
 * `response` events BY URL while every OTHER console error (TypeErrors, React crashes)
 * keeps the strict zero bar.
 */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/^Failed to load resource/.test(msg.text())) return; // pinned precisely below
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (r) => {
    if (r.status() < 400) return;
    errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

/**
 * Scaffold the document base into a temp project and hand it to the api's dev-serve build.
 * `documentDataBody` is the object literal a build agent would write into documentData.js -
 * the ONLY file that differs between the two apps; both get the shipped shell byte for byte.
 */
async function registerApp(id: string, name: string, documentDataBody: string): Promise<void> {
  const projectDir = mkdtempSync(join(tmpdir(), `ekoa-${id}-`));
  projectDirs.push(projectDir);
  const src = join(projectDir, 'frontend', 'src');
  mkdirSync(src, { recursive: true });
  for (const file of ['App.jsx', 'index.jsx', 'index.css']) {
    cpSync(join(BASE_SCAFFOLD, file), join(src, file)); // the SHIPPED base shell, verbatim
  }
  writeFileSync(join(src, 'documentData.js'), `const documentData = ${documentDataBody};\n\nexport default documentData;\n`);
  writeFileSync(
    join(projectDir, 'manifest.json'),
    JSON.stringify(
      { id, name, version: '1.0.0', entryPoint: 'frontend/src/index.jsx', outputDir: 'dist/', type: 'jsx-app' },
      null,
      2,
    ),
  );

  const res = await fetch(`${BASE}/api/dev/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, dir: projectDir, name }),
  });
  const body = (await res.json()) as { error?: string; data?: { build?: { success: boolean; errors: string[] } } };
  expect(res.ok, `dev-serve register failed: ${JSON.stringify(body)}`).toBe(true);
  expect(body.data?.build?.success, `base scaffold failed to build: ${JSON.stringify(body.data?.build?.errors)}`).toBe(true);
}

/** Source-linked mode: `blocks` stays empty on purpose - the real .docx is the document. */
const SOURCE_LINKED_DATA = `{
  fileName: 'contrato-revisto',
  title: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS JURÍDICOS',
  subtitle: '',
  sourceDocument: { fileName: '${SOURCE_FILE}' },
  blocks: [],
  notes: [],
}`;

/** Authored mode: every block type the ekoa-code shell renders, pagebreak + signatures included. */
const AUTHORED_DATA = `{
  fileName: 'parecer',
  title: 'PARECER JURÍDICO',
  subtitle: 'Regime das rendas comerciais',
  blocks: [
    { type: 'paragraph', text: 'O presente parecer responde à consulta formulada pela Cliente.' },
    { type: 'heading', text: 'ENQUADRAMENTO' },
    { type: 'clause', title: 'CLÁUSULA 1.ª (OBJETO)', paragraphs: ['A consulta incide sobre a atualização das rendas.'] },
    { type: 'list', items: ['Primeiro fundamento', 'Segundo fundamento'] },
    { type: 'pagebreak' },
    { type: 'paragraph', text: 'Conclusão: a atualização é admissível nos termos contratados.', align: 'center' },
    { type: 'signatures', parties: [{ label: 'A Advogada', detail: 'Cédula 12345L' }, { label: 'A Cliente' }] },
  ],
  notes: [{ heading: 'Âmbito', body: 'Parecer limitado às questões submetidas.' }],
}`;

/** Seed the linked document exactly as apps/document-source.ts stores it. */
function seedSourceDocument(): void {
  const dir = docxDir();
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const bytes = readFileSync(FIXTURE);
  writeFileSync(join(dir, 'document-source.docx'), bytes);
  writeFileSync(join(dir, 'document-current.docx'), bytes);
  writeFileSync(
    join(dir, 'document-meta.json'),
    JSON.stringify({ fileName: SOURCE_FILE, origin: 'e2e-fixture', updatedAt: new Date().toISOString() }, null, 2),
  );
}

/** The working .docx as the toolbar's "Descarregar Word" serves it, unzipped. */
async function currentDocxEntries(): Promise<Record<string, Uint8Array>> {
  const res = await fetch(`${BASE}/api/app-docx/current`, { headers: { 'X-Ekoa-App-Id': APP_ID } });
  expect(res.status, 'GET /api/app-docx/current').toBe(200);
  return unzipSync(new Uint8Array(await res.arrayBuffer()));
}

function xmlOf(entries: Record<string, Uint8Array>, name: string): string {
  const entry = entries[name];
  expect(entry, `${name} missing from the .docx`).toBeTruthy();
  return new TextDecoder().decode(entry as Uint8Array);
}

test.beforeAll(async () => {
  await registerApp(APP_ID, 'Contrato revisto (e2e)', SOURCE_LINKED_DATA);
  await registerApp(AUTHORED_ID, 'Parecer jurídico (e2e)', AUTHORED_DATA);
  seedSourceDocument();
});

test.afterAll(async () => {
  for (const id of [APP_ID, AUTHORED_ID]) {
    await fetch(`${BASE}/api/dev/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => undefined);
  }
  // Leave no per-app residue behind: the whole app-data root, not just the docx subdir.
  for (const id of [APP_ID, AUTHORED_ID]) rmSync(appDataDir(id), { recursive: true, force: true });
  for (const dir of projectDirs) rmSync(dir, { recursive: true, force: true });
});

test('source-linked document: accept, comment, reply and resolve land as native Word markup', async ({ page }) => {
  const errors = trackConsoleErrors(page);

  // ---------------------------------------------------------------- preview
  await page.goto(APP_URL, { waitUntil: 'networkidle' });

  // Source-linked mode is on: the banner names the real file and the toolbar serves IT,
  // not a blocks-generated .docx.
  await expect(page.locator('.doc-source-banner')).toContainText(SOURCE_FILE, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Descarregar Word (alterações registadas)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Descarregar versão limpa' })).toBeVisible();

  // The projection rendered as a redline: the honorários replacement shows as a struck-out
  // old value next to an underlined new one (CriticMarkup {--4.500--}{++5.000++}).
  const sheet = page.locator('main.sheet');
  const honorarios = sheet.locator('p.doc-p').filter({ hasText: 'avença mensal' });
  await expect(honorarios.locator('del.redline-del')).toHaveText('4.500', { timeout: 20_000 });
  await expect(honorarios.locator('ins.redline-ins')).toHaveText('5.000');

  // The fixture carries two INDEPENDENT tracked replacements (4 change entries, paired) and
  // one comment thread.
  const changeChips = sheet.locator('.redline-chip-action');
  await expect(changeChips).toHaveCount(4);
  await expect(sheet.locator('.redline-chip-comment')).toHaveCount(1);

  // ----------------------------------------------------------------- accept
  // Accepting one half also resolves its pair (the chip carries "pairs with Chg:n"), so the
  // honorários replacement disappears from the preview and its new text is no longer marked.
  // Addressed through the paragraph, never by document order: the OTHER pending replacement
  // (aviso prévio) sits earlier in the document.
  const honorariosChips = honorarios.locator('.redline-chip-action');
  await expect(honorariosChips).toHaveCount(2);
  await honorariosChips.first().locator('.redline-chip-label').click();
  await page.getByRole('button', { name: 'Aceitar' }).click();
  await expect(changeChips).toHaveCount(2, { timeout: 20_000 });
  await expect(honorarios).toContainText('avença mensal de EUR 5.000,00');
  await expect(honorarios.locator('del.redline-del, ins.redline-ins')).toHaveCount(0);

  // ---------------------------------------------------- comment on a selection
  // Selecting text in the sheet raises the floating commenter, which sends a `modify` op
  // wrapping the exact selection (new_text === target_text) plus the comment.
  await page.evaluate(() => {
    const target = Array.from(document.querySelectorAll('main.sheet p')).find((el) =>
      (el.textContent || '').includes('duração de um ano'),
    );
    const selection = window.getSelection();
    if (!target || !selection) throw new Error('selection anchor paragraph not found');
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Adicionar comentário' }).click();
  await page.locator('.redline-commenter textarea').fill('Confirmar se a renovação automática foi acordada.');
  await page.getByRole('button', { name: 'Comentar' }).click();
  await expect(sheet.locator('.redline-chip-comment')).toHaveCount(2, { timeout: 20_000 });

  // ------------------------------------------------------- reply and resolve
  // Again by content, not position: the comment just added sits earlier in the document.
  const thread = sheet.locator('.redline-chip-comment').filter({ hasText: 'Falta o prazo de sobrevivência' });
  await expect(thread).toHaveCount(1);
  await thread.getByRole('button', { name: 'Responder' }).click();
  await thread.locator('textarea').fill('Acrescentámos cinco anos após a cessação.');
  await thread.getByRole('button', { name: 'Enviar' }).click();
  await expect(thread).toContainText('Acrescentámos cinco anos após a cessação.', { timeout: 20_000 });

  await thread.getByRole('button', { name: 'Resolver' }).click();
  await expect(thread.locator('.redline-comment-flag')).toHaveText('Resolvido', { timeout: 20_000 });
  await expect(thread.getByRole('button', { name: 'Reabrir' })).toBeVisible();

  // --------------------------------------------------- the file is real Word
  const entries = await currentDocxEntries();
  const documentXml = xmlOf(entries, 'word/document.xml');
  // The SECOND replacement (aviso prévio 30 -> 60 dias) was never accepted, so it is still
  // a native tracked change. Asserted on the ELEMENTS, not on loose substrings: a bare
  // `toContain('60')` cannot fail (w:docGrid carries w:linePitch="360") and would pin
  // nothing at all.
  const insertions = documentXml.match(/<w:ins\b[\s\S]*?<\/w:ins>/g) ?? [];
  const deletions = documentXml.match(/<w:del\b[\s\S]*?<\/w:del>/g) ?? [];
  expect(insertions.some((el) => />60</.test(el)), 'the pending insertion of "60" must still be a w:ins').toBe(true);
  expect(deletions.some((el) => />30</.test(el)), 'the pending deletion of "30" must still be a w:del').toBe(true);
  // Attributed to the fixture's author, as Word's review pane shows it.
  expect(insertions.some((el) => el.includes('w:author="Marta Nunes (Ekoa)"'))).toBe(true);
  // ...and the accepted one is plain text now: its new value survives, its old value is
  // gone, and no w:ins/w:del anywhere still carries either of them.
  expect(documentXml).toContain('5.000');
  expect(documentXml).not.toContain('4.500');
  expect([...insertions, ...deletions].some((el) => el.includes('5.000') || el.includes('4.500'))).toBe(false);

  // Comments are OOXML comments, not annotations bolted onto the projection.
  const commentsXml = xmlOf(entries, 'word/comments.xml');
  expect(commentsXml).toContain('Falta o prazo de sobrevivência');
  expect(commentsXml).toContain('Acrescentámos cinco anos após a cessação.');
  expect(commentsXml).toContain('Confirmar se a renovação automática foi acordada.');
  // Word keeps thread resolution in commentsExtended.xml (w15:done="1").
  expect(xmlOf(entries, 'word/commentsExtended.xml')).toContain('w15:done="1"');

  // A reload re-projects from the persisted file: the review round-trip is durable.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(sheet.locator('.redline-chip-action')).toHaveCount(2, { timeout: 20_000 });
  await expect(sheet.locator('.redline-chip-comment')).toHaveCount(2);
  // Exactly the thread that was resolved carries the flag; the new comment stays open.
  await expect(sheet.locator('.redline-chip-comment.resolved')).toHaveCount(1);
  await expect(sheet.locator('.redline-chip-comment.resolved')).toContainText('Falta o prazo de sobrevivência');

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

/**
 * The additive half of the graft. A document app WITHOUT `sourceDocument` - every document
 * app that existed before this feature - must be untouched by it: the same authored blocks
 * (ekoa-code's own `pagebreak` and `signatures` types included), the same plain toolbar, the
 * same notes tab, and NOT one call to the /api/app-docx plane.
 */
test('authored mode is unchanged by the graft: blocks, toolbar and notes tab, no app-docx traffic', async ({ page }) => {
  const errors = trackConsoleErrors(page);
  const docxCalls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/app-docx')) docxCalls.push(r.url());
  });

  await page.goto(AUTHORED_URL, { waitUntil: 'networkidle' });

  // Authored toolbar: the plain Word button, no source banner, no tracked/clean pair.
  await expect(page.getByRole('button', { name: 'Descarregar Word', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Descarregar PDF' })).toBeEnabled();
  await expect(page.locator('.doc-source-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /alterações registadas|versão limpa/ })).toHaveCount(0);

  // Every block type the shell renders, on the sheet.
  const sheet = page.locator('main.sheet');
  await expect(sheet.locator('h1.doc-title')).toHaveText('PARECER JURÍDICO');
  await expect(sheet.locator('p.doc-subtitle')).toHaveText('Regime das rendas comerciais');
  await expect(sheet.locator('h2.doc-heading')).toHaveText('ENQUADRAMENTO');
  await expect(sheet.locator('section.doc-clause h3.doc-clause-title')).toHaveText('CLÁUSULA 1.ª (OBJETO)');
  await expect(sheet.locator('ul.doc-list li')).toHaveCount(2);
  await expect(sheet.locator('div.page-break')).toHaveCount(1); // ekoa-code's own block type
  await expect(sheet.locator('.doc-signatures .doc-signature')).toHaveCount(2); // ...and this one
  await expect(sheet.locator('.doc-signature-detail')).toHaveText('Cédula 12345L');
  // Nothing from source-linked mode leaked into the authored sheet.
  await expect(sheet.locator('.redline-chip, .redline-ins, .redline-del, .redline-status')).toHaveCount(0);

  // The notes tab still works and still carries its own separate download.
  await page.getByRole('button', { name: 'Nota de alterações' }).click();
  await expect(page.locator('main.notes-sheet .note-heading')).toHaveText('Âmbito');
  await expect(page.getByRole('button', { name: 'Descarregar nota (Word)' })).toBeVisible();

  expect(docxCalls, 'an authored document must never call the app-docx plane').toEqual([]);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
