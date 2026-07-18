import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-pesquisa - S7 knowledge-portal hardening of Pesquisa Jurídica. Sits
 * ALONGSIDE the ported legal-pesquisa.spec.ts (which stays byte-frozen) and
 * proves the S7 acceptance additions, all through the served app
 * (cortex at /apps/legal-pesquisa/):
 *
 *  1. FONTE VERIFICADA EARNED, NÃO FABRICADA. The route /api/legal-research
 *     drops any hit whose URL does not resolve (2xx) and returns an honest note;
 *     on THIS machine the local index is empty, so a live search shows the
 *     honest failure state (empty-index note) and renders ZERO result cards and
 *     ZERO "verificada" badges. The "verificada" badge is never invented.
 *  2. SAVED SEARCHES PER PROCESSO. With searches seeded on two DIFFERENT
 *     processos, the Histórico per-processo filter narrows the list to exactly
 *     the searches of the chosen processo (and back to all).
 *  3. PT CITATION COPY. A seeded DGSI citation whose title carries tribunal +
 *     proc + date renders in the Portuguese forum norm exactly
 *     "Ac. TRL de 12-03-2024, proc. 123/20.0T8LSB", labelled as the acórdão
 *     form, with a copy button; a DRE citation renders as the diploma form.
 *
 * Deterministic + self-cleaning: every row this spec creates carries the run
 * nonce (in pesquisas.pergunta); afterEach deletes the tagged pesquisas. Seeded
 * spine rows are never deleted.
 */
const APP = legalAppUrl('legal-pesquisa');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'legal-x-pesquisa');
mkdirSync(SHOTS, { recursive: true });

/* The two seeded processos this spec pins its saved searches to (both exist in
 * the pesquisa spine seed). Used by the per-processo filter assertions. */
const PROC_A = '1234/26.0T8LSB';
const PROC_B = '5678/26.1T8PRT';

/* The exact Portuguese forum-norm reference the PT-copy assertion pins. The
 * seeded DGSI citation's title carries the tribunal (por extenso), the proc
 * number and the date; citacao-pt.js must reduce it to this canonical string. */
const NORMA_ACORDAO = 'Ac. TRL de 12-03-2024, proc. 123/20.0T8LSB';

type Ctx = { nonce: string };
const ctx: Ctx = { nonce: '' };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __ekoa?: { shared?: unknown } }).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/* Opens the Núcleo once (it seeds the spine) and waits until the shared
 * collections hold their seeded rows, so the satellite reads a seeded spine
 * regardless of prior state. Idempotent. */
async function ensureSeeded(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.waitForFunction(async () => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<unknown[]> } } }).__ekoa.shared;
    const [pesquisas, processos] = await Promise.all([s.list('pesquisas'), s.list('processos')]);
    return Array.isArray(pesquisas) && pesquisas.length >= 1 && Array.isArray(processos) && processos.length >= 2;
  }, undefined, { timeout: 30_000 });
}

/* Resolves a processo id by its numeroProcesso, from inside the served app. */
async function processoId(page: Page, numero: string): Promise<string> {
  return page.evaluate(async (num) => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } }).__ekoa.shared;
    const procs = await s.list('processos');
    const p = procs.find((x) => x.numeroProcesso === num);
    return (p && typeof p.id === 'string') ? p.id : '';
  }, numero);
}

/* Seeds a tagged pesquisa (nonce in pergunta) against a processo, carrying the
 * given citations. Returns the created row id. */
async function seedPesquisa(
  page: Page,
  args: { pergunta: string; procId: string; citacoes: Array<Record<string, unknown>> },
): Promise<void> {
  await page.evaluate(async (a) => {
    const s = (window as unknown as { __ekoa: { shared: { create: (c: string, d: unknown) => Promise<unknown> } } }).__ekoa.shared;
    await s.create('pesquisas', {
      pergunta: a.pergunta,
      executadaEm: new Date().toISOString(),
      resposta: '',
      citacoes: a.citacoes,
      estado: 'concluida',
      processoId: a.procId,
    });
  }, args);
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async (nonce) => {
      const s = (window as unknown as { __ekoa?: { shared?: { list: (c: string) => Promise<Array<Record<string, unknown>>>; delete: (c: string, id: string) => Promise<unknown> } } }).__ekoa?.shared;
      if (!s || !nonce) return;
      let pesquisas: Array<Record<string, unknown>> = [];
      try { pesquisas = await s.list('pesquisas'); } catch { pesquisas = []; }
      for (const r of pesquisas) {
        if (typeof r.pergunta === 'string' && r.pergunta.includes(nonce) && typeof r.id === 'string') {
          try { await s.delete('pesquisas', r.id); } catch { /* ignore */ }
        }
      }
    }, ctx.nonce);
  } catch { /* page may be gone - ignore */ }
  ctx.nonce = '';
});

test('Pesquisa X: uma pesquisa ao vivo sobre índice vazio mostra o estado de falha honesto e NUNCA um distintivo "verificada" fabricado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `PESQX-${Date.now()}`;

  await ensureSeeded(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('pesquisa-pesquisar-page')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('pesquisa-pergunta').fill('prazo de recurso de apelação');
  await page.getByTestId('pesquisa-executar').click();

  // Honest failure state: the empty-index note (or an honest error) - never a result.
  await expect(page.getByTestId('pesquisa-nota-vazia')).toBeVisible({ timeout: 20_000 });

  // Anti-fabrication: zero result cards, zero citation chips, and - crucially -
  // zero "verificada" badges. A verificada badge is EARNED by a resolving link;
  // with no hits, none can exist.
  await expect(page.getByTestId('pesquisa-resultado')).toHaveCount(0);
  await expect(page.getByTestId('pesquisa-citacao')).toHaveCount(0);
  await expect(page.getByTestId('pesquisa-verificacao')).toHaveCount(0);
  await expect(page.getByText('verificada', { exact: false })).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/falha-honesta.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Pesquisa X: o histórico filtra as pesquisas guardadas POR processo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `PESQX-${Date.now()}`;

  await ensureSeeded(page);
  const idA = await processoId(page, PROC_A);
  const idB = await processoId(page, PROC_B);
  expect(idA, `processo ${PROC_A} existe na espinha`).toBeTruthy();
  expect(idB, `processo ${PROC_B} existe na espinha`).toBeTruthy();

  // Two tagged searches, one per processo, so filtering has something to narrow.
  const perguntaA = `${ctx.nonce} contestação no processo A`;
  const perguntaB = `${ctx.nonce} recurso no processo B`;
  await seedPesquisa(page, { pergunta: perguntaA, procId: idA, citacoes: [] });
  await seedPesquisa(page, { pergunta: perguntaB, procId: idB, citacoes: [] });

  await page.goto(`${APP}historico`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('pesquisa-historico-page')).toBeVisible({ timeout: 20_000 });

  // Both tagged searches are visible under "Todos os processos".
  await expect(page.getByText(perguntaA, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(perguntaB, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // Filter to processo B: only its search remains; processo A's search is gone.
  const filtro = page.getByTestId('pesquisa-filtro-processo');
  await expect(filtro).toBeVisible({ timeout: 15_000 });
  await filtro.selectOption(idB);
  await expect(page.getByText(perguntaB, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(perguntaA, { exact: false })).toHaveCount(0);

  // Filter to processo A: the inverse.
  await filtro.selectOption(idA);
  await expect(page.getByText(perguntaA, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(perguntaB, { exact: false })).toHaveCount(0);

  // Back to all: both return.
  await filtro.selectOption('');
  await expect(page.getByText(perguntaA, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(perguntaB, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/filtro-por-processo.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Pesquisa X: uma citação é copiável na forma portuguesa do foro (acórdão) e a legislação como diploma', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `PESQX-${Date.now()}`;

  await ensureSeeded(page);
  const idA = await processoId(page, PROC_A);
  expect(idA, `processo ${PROC_A} existe na espinha`).toBeTruthy();

  // A DGSI citation whose title carries tribunal (por extenso) + proc + date, and
  // a DRE (legislação) citation. citacao-pt.js reduces the former to the forum
  // norm; the latter to the diploma form. Both always carry a real URL.
  const pergunta = `${ctx.nonce} citação na forma do foro`;
  await seedPesquisa(page, {
    pergunta,
    procId: idA,
    citacoes: [
      {
        fonte: 'DGSI',
        titulo: 'Acórdão do Tribunal da Relação de Lisboa de 12-03-2024, processo 123/20.0T8LSB',
        url: 'https://www.dgsi.pt/jtrl.nsf/e2e-acordao',
        excerto: 'Responsabilidade civil extracontratual - pressupostos.',
      },
      {
        fonte: 'DRE',
        titulo: 'Código Civil - artigo 483.º',
        url: 'https://diariodarepublica.pt/dr/legislacao-consolidada/decreto-lei/1966-e2e',
        excerto: 'Aquele que, com dolo ou mera culpa, violar ilicitamente o direito de outrem...',
      },
    ],
  });

  await page.goto(`${APP}historico`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('pesquisa-historico-page')).toBeVisible({ timeout: 20_000 });

  // Expand the tagged row.
  const row = page.locator('li[data-testid^="pesquisa-row-"]').filter({ hasText: pergunta });
  await expect(row.first()).toBeVisible({ timeout: 15_000 });
  await row.first().locator('button[data-testid^="pesquisa-toggle-"]').click();

  // The PT reference renders EXACTLY in the forum norm, with the acórdão form
  // label and a copy button. Both are inside the row's citation block.
  const norma = row.first().getByTestId('pesquisa-citacao-pt-texto').filter({ hasText: 'Ac. TRL' });
  await expect(norma.first()).toBeVisible({ timeout: 15_000 });
  await expect(norma.first()).toHaveText(NORMA_ACORDAO);

  const acordaoBlock = row.first().getByTestId('pesquisa-citacao-pt').filter({ hasText: 'Ac. TRL' });
  await expect(acordaoBlock.first().getByTestId('pesquisa-copiar-citacao')).toBeVisible();
  await expect(acordaoBlock.first().getByTestId('pesquisa-citacao-pt-forma')).toContainText('acórdão');

  // The DRE citation renders as the diploma form (never invented, carries its URL).
  const diplomaForma = row.first().getByTestId('pesquisa-citacao-pt-forma').filter({ hasText: 'diploma' });
  await expect(diplomaForma.first()).toBeVisible({ timeout: 15_000 });

  // The underlying citation chips remain real links to their sources.
  const links = row.first().getByTestId('pesquisa-historico-citacao');
  await expect(links.first()).toHaveAttribute('href', /dgsi\.pt/);

  await page.screenshot({ path: `${SHOTS}/citacao-pt.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
