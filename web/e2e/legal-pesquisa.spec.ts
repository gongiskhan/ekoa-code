import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-pesquisa — Pesquisa Jurídica fundamentada: grounded DGSI/DRE research
 * over the SHARED spine, with VERIFIABLE citations. Covered end-to-end through
 * the served app (cortex at /apps/legal-pesquisa/):
 *
 *  1. Pesquisar renders with the fixed disclaimer visible, zero pageerrors.
 *  2. A live search against the platform route /api/legal-research: on THIS
 *     machine the knowledge index is empty, so the route honestly returns
 *     ok:true / hits:[] with a note. The UI shows the empty-index note and,
 *     crucially, renders ZERO citation chips (the anti-fabrication assertion:
 *     no fabricated citations are ever invented from an empty index).
 *  3. Guardar manual: save a (tagged) pesquisa to the seeded processo
 *     1234/26.0T8LSB -> a `pesquisas` row appears in Histórico AND a `documentos`
 *     nota (origem 'legal-pesquisa') is created and is visible in that processo's
 *     dossiê.
 *  4. The seeded Histórico row renders its DRE citation as a real <a> link whose
 *     href points at diariodarepublica.pt.
 *
 * Deterministic + self-cleaning: every row this spec creates carries the run
 * nonce (in pesquisas.pergunta and, via the note name, in documentos.nome), and
 * afterEach deletes the tagged pesquisas + documentos. Seeded rows are never
 * deleted.
 */
const APP = legalAppUrl('legal-pesquisa');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'legal-pesquisa');
mkdirSync(SHOTS, { recursive: true });

const SEEDED_PERGUNTA = 'Prazo de contestação em acção declarativa comum';
const SEEDED_PROCESSO = '1234/26.0T8LSB';

type Ctx = { nonce: string };
const ctx: Ctx = { nonce: '' };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __ekoa?: { shared?: unknown } }).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/* Opens the Núcleo once (it, and only it, seeds the spine) and waits until the
 * shared `pesquisas` collection holds its seeded row — so the satellite reads a
 * seeded spine regardless of prior state. Idempotent (seedSpine no-ops when the
 * spine already exists). */
async function ensureSeeded(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.waitForFunction(async () => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<unknown[]> } } }).__ekoa.shared;
    const [pesquisas, processos] = await Promise.all([s.list('pesquisas'), s.list('processos')]);
    return Array.isArray(pesquisas) && pesquisas.length >= 1 && Array.isArray(processos) && processos.length >= 1;
  }, undefined, { timeout: 30_000 });
}

/* Reads a shared collection from inside the served app. */
async function listShared(page: Page, collection: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (col) => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } }).__ekoa.shared;
    return s.list(col);
  }, collection);
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async (nonce) => {
      const s = (window as unknown as { __ekoa?: { shared?: { list: (c: string) => Promise<Array<Record<string, unknown>>>; delete: (c: string, id: string) => Promise<unknown> } } }).__ekoa?.shared;
      if (!s || !nonce) return;
      const del = async (col: string, id: unknown) => {
        if (typeof id === 'string' && id) { try { await s.delete(col, id); } catch { /* ignore */ } }
      };
      // Tagged pesquisas (nonce in pergunta) and their dossiê notes (nonce in nome).
      let pesquisas: Array<Record<string, unknown>> = [];
      try { pesquisas = await s.list('pesquisas'); } catch { pesquisas = []; }
      for (const r of pesquisas) {
        if (typeof r.pergunta === 'string' && r.pergunta.includes(nonce)) await del('pesquisas', r.id);
      }
      let documentos: Array<Record<string, unknown>> = [];
      try { documentos = await s.list('documentos'); } catch { documentos = []; }
      for (const d of documentos) {
        if (typeof d.nome === 'string' && d.nome.includes(nonce)) await del('documentos', d.id);
      }
    }, ctx.nonce);
  } catch { /* page may be gone — ignore */ }
  ctx.nonce = '';
});

test('Pesquisa: a página de pesquisa renderiza com o aviso fixo visível, sem erros de página', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `PESQ-${Date.now()}`;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pesquisa-pesquisar-page')).toBeVisible({ timeout: 20_000 });

  // The fixed disclaimer is present and carries the mandatory wording.
  await expect(page.getByTestId('pesquisa-disclaimer').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('pesquisa-disclaimer').first())
    .toContainText('Apoio à investigação jurídica - o advogado revê sempre as fontes.');

  // The query and both source checkboxes are present.
  await expect(page.getByTestId('pesquisa-pergunta')).toBeVisible();
  await expect(page.getByTestId('pesquisa-fonte-dgsi')).toBeVisible();
  await expect(page.getByTestId('pesquisa-fonte-dre')).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/pesquisar.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Pesquisa: uma pesquisa com o índice vazio mostra a nota honesta e ZERO citações fabricadas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `PESQ-${Date.now()}`;

  await ensureSeeded(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('pesquisa-pesquisar-page')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('pesquisa-pergunta').fill('responsabilidade civil extracontratual');
  await page.getByTestId('pesquisa-executar').click();

  // This machine's knowledge index is empty -> the honest empty-index note.
  await expect(page.getByTestId('pesquisa-nota-vazia')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('pesquisa-nota-vazia'))
    .toContainText('A base de conhecimento local está vazia');

  // Anti-fabrication: with an empty index there are ZERO citation chips.
  await expect(page.getByTestId('pesquisa-resultado')).toHaveCount(0);
  await expect(page.getByTestId('pesquisa-citacao')).toHaveCount(0);

  // The Guardar panel is still offered (manual registration is allowed).
  await expect(page.getByTestId('pesquisa-guardar-panel')).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/indice-vazio.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Pesquisa: guardar uma pesquisa manual cria a linha no histórico e a nota do dossiê', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `PESQ-${Date.now()}`;
  const pergunta = `${ctx.nonce} prazo geral de contestação`;

  await ensureSeeded(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('pesquisa-pesquisar-page')).toBeVisible({ timeout: 20_000 });

  // Run a search (empty index) so the Guardar panel appears.
  await page.getByTestId('pesquisa-pergunta').fill(pergunta);
  await page.getByTestId('pesquisa-executar').click();
  await expect(page.getByTestId('pesquisa-guardar-panel')).toBeVisible({ timeout: 20_000 });

  // Save to the seeded processo 1234/26.0T8LSB.
  await page.getByTestId('pesquisa-guardar-processo').selectOption({ label: SEEDED_PROCESSO });
  const processoId = await page.getByTestId('pesquisa-guardar-processo').inputValue();
  expect(processoId, 'a processo id was selected').toBeTruthy();
  await page.getByTestId('pesquisa-guardar').click();

  // The confirmation "Ver no histórico" link confirms the save landed.
  await expect(page.getByTestId('pesquisa-ver-historico')).toBeVisible({ timeout: 15_000 });

  // The pesquisas row was persisted against the chosen processo.
  const pesquisa = (await listShared(page, 'pesquisas')).find((r) => r.pergunta === pergunta) as Record<string, unknown> | undefined;
  expect(pesquisa, 'the pesquisa row was persisted').toBeTruthy();
  expect(pesquisa!.processoId).toBe(processoId);
  expect(pesquisa!.estado).toBe('concluida');

  // A dossiê note (origem legal-pesquisa) was created and bound to the processo.
  const doc = (await listShared(page, 'documentos')).find(
    (d) => typeof d.nome === 'string' && (d.nome as string).includes(ctx.nonce),
  ) as Record<string, unknown> | undefined;
  expect(doc, 'a dossiê nota was created').toBeTruthy();
  expect(doc!.origem).toBe('legal-pesquisa');
  expect(doc!.tipo).toBe('nota');
  expect(doc!.processoId).toBe(processoId);

  // The row shows up in the Histórico.
  await page.goto(`${APP}historico`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pesquisa-historico-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(pergunta, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // And the nota is visible in the dossiê of that processo (Documentos tab).
  await page.goto(legalAppUrl('legal-dossie', `processo/${processoId}`), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('tab-documentos')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('tab-documentos').click();
  await expect(page.getByTestId('documentos-list').getByText('Pesquisa:', { exact: false }).first())
    .toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/guardar-dossie.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Pesquisa: a linha semeada do histórico mostra a citação DRE como ligação para diariodarepublica.pt', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `PESQ-${Date.now()}`;

  await ensureSeeded(page);
  await page.goto(`${APP}historico`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pesquisa-historico-page')).toBeVisible({ timeout: 20_000 });

  // Locate the seeded row and expand it.
  const row = page.locator('li[data-testid^="pesquisa-row-"]').filter({ hasText: SEEDED_PERGUNTA });
  await expect(row.first()).toBeVisible({ timeout: 15_000 });
  await row.first().locator('button[data-testid^="pesquisa-toggle-"]').click();

  // Its citation chip is a real link to the Diário da República.
  const chip = row.first().getByTestId('pesquisa-historico-citacao').first();
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await expect(chip).toContainText('DRE');
  await expect(chip).toHaveAttribute('href', /diariodarepublica\.pt/);

  await page.screenshot({ path: `${SHOTS}/historico-citacao.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
