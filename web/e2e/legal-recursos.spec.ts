import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * S8-recursos — the Recursos Humanos satellite over the SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-recursos/):
 *  1. The Pessoas list renders the 5 seeded team members, with zero pageerrors.
 *  2. Dra. Marília's ficha (dataAdmissao 2019-09-01) shows direito 22 dias with
 *     art. 238.º in the "shows its work" explicacao — the deterministic engine.
 *  3. UI golden: a ferias 'pedida' spanning exactly 5 dias úteis does NOT move
 *     the saldo; approving it via the UI drops the saldo by 5 (22 -> 17), live.
 *  4. Health-data minimisation: a 'baixa' hides the notas field and the created
 *     ausência row carries NO `notas` key at all.
 *
 * Deterministic + self-cleaning: tests 3/4 inject their own tagged `pessoas` via
 * window.__ekoa.shared and delete every referencing row in afterEach, so they
 * never depend on (or pollute) the seeded data. Tests 1/2 rely on the Núcleo
 * seed, which ensureSeeded() guarantees by opening the Núcleo once.
 */
const APP = legalAppUrl('legal-recursos');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 's8-recursos');
mkdirSync(SHOTS, { recursive: true });

const SEEDED_NOMES = ['Dra. Marília', 'Dr. Nuno Aparício', 'Dra. Sofia Rebelo', 'Tiago Osório', 'Carla Mendes'];

type Ctx = { nonce: string; pessoaIds: string[] };
const ctx: Ctx = { nonce: '', pessoaIds: [] };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __ekoa?: { shared?: unknown } }).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/* Opens the Núcleo once (it, and only it, calls seedSpine) and waits until the
 * shared `pessoas` collection holds the full team — so the satellite specs read
 * a seeded spine regardless of prior state. Idempotent (seedSpine no-ops when the
 * spine already exists). */
async function ensureSeeded(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.waitForFunction(async () => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<unknown[]> } } }).__ekoa.shared;
    const rows = await s.list('pessoas');
    return Array.isArray(rows) && rows.length >= 5;
  }, undefined, { timeout: 30_000 });
}

/* 'YYYY-MM-DD' local. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* A Monday..Friday range in July of the current year — exactly 5 dias úteis, no
 * fixed national holiday falls in July (the app passes only the fixed feriados). */
function semanaUtilJulho(): { inicio: string; fim: string; year: number } {
  const year = new Date().getFullYear();
  const mon = new Date(year, 6, 6); // 6 July
  while (mon.getDay() !== 1) mon.setDate(mon.getDate() + 1);
  const fri = new Date(mon);
  fri.setDate(mon.getDate() + 4);
  return { inicio: ymd(mon), fim: ymd(fri), year };
}

/* Injects a tagged pessoa admitted two years ago (so direito = 22, art. 238.º)
 * and returns its id, tracked for teardown. */
async function injectPessoa(page: Page): Promise<string> {
  const year = new Date().getFullYear();
  const id = await page.evaluate(async ({ nonce, adm }) => {
    const s = (window as unknown as { __ekoa: { shared: { create: (c: string, d: unknown) => Promise<{ id: string }> } } }).__ekoa.shared;
    const p = await s.create('pessoas', {
      nome: `Teste ${nonce}`,
      nomeCompleto: `Pessoa Teste ${nonce}`,
      papel: 'advogado',
      email: `teste-${nonce}@exemplo.pt`,
      dataAdmissao: adm,
      cpas: true,
      ativo: true,
    });
    return p.id;
  }, { nonce: ctx.nonce, adm: `${year - 2}-01-10` });
  ctx.pessoaIds.push(id);
  return id;
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ pessoaIds, nonce }) => {
      const s = (window as unknown as { __ekoa?: { shared?: { list: (c: string) => Promise<Array<Record<string, unknown>>>; delete: (c: string, id: string) => Promise<unknown> } } }).__ekoa?.shared;
      if (!s) return;
      for (const col of ['ausencias', 'alocacoes', 'pessoas']) {
        let rows: Array<Record<string, unknown>> = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          const hit =
            (typeof r.pessoaId === 'string' && pessoaIds.includes(r.pessoaId)) ||
            (typeof r.id === 'string' && pessoaIds.includes(r.id)) ||
            (typeof r.nome === 'string' && r.nome.includes(nonce));
          if (hit) { try { await s.delete(col, r.id as string); } catch { /* ignore */ } }
        }
      }
    }, ctx);
  } catch { /* page may be gone - ignore */ }
  ctx.pessoaIds = [];
});

test('Recursos: a lista de pessoas mostra a equipa semeada, sem erros de página', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `S8-${Date.now()}`;

  await ensureSeeded(page);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pessoas-page')).toBeVisible({ timeout: 20_000 });

  const lista = page.getByTestId('pessoas-lista');
  for (const nome of SEEDED_NOMES) {
    await expect(lista.getByText(nome, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  }
  // At least the 5 seeded rows (never fewer).
  expect(await page.getByTestId('pessoa-row').count()).toBeGreaterThanOrEqual(5);

  await page.screenshot({ path: `${SHOTS}/pessoas.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Recursos: a ficha da Dra. Marília mostra direito 22 e o art. 238.º na explicação', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `S8-${Date.now()}`;

  await ensureSeeded(page);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pessoas-page')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('pessoa-row').filter({ hasText: 'Dra. Marília' }).first().click();
  await expect(page.getByTestId('pessoa-detail')).toBeVisible({ timeout: 15_000 });

  // Admissão 2019-09-01 -> ano corrente é posterior -> art. 238.º -> 22 dias.
  await expect(page.getByTestId('direito-valor')).toHaveText('22');
  await expect(page.getByTestId('ferias-regra')).toContainText('238');
  await expect(page.getByTestId('ferias-explicacao')).toContainText('238');

  await page.screenshot({ path: `${SHOTS}/marilia-ferias.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Recursos: férias pedida de 5 dias úteis não mexe no saldo; aprovar baixa-o de 22 para 17', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `S8-${Date.now()}`;

  const { inicio, fim } = semanaUtilJulho();

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  const pid = await injectPessoa(page);

  await page.goto(`${APP}pessoa/${pid}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pessoa-detail')).toBeVisible({ timeout: 15_000 });

  // Fresh pessoa (no ausências): direito 22, saldo 22.
  await expect(page.getByTestId('direito-valor')).toHaveText('22');
  await expect(page.getByTestId('saldo-valor')).toHaveText('22');

  // Register a ferias for the Mon..Fri week (5 dias úteis) — created as 'pedida'.
  await page.getByTestId('ausencia-tipo').selectOption('ferias');
  await page.getByTestId('ausencia-inicio').fill(inicio);
  await page.getByTestId('ausencia-fim').fill(fim);
  await page.getByTestId('ausencia-submit').click();

  await expect(page.getByTestId('ausencia-row')).toHaveCount(1, { timeout: 15_000 });
  // 'pedida' does NOT count against the saldo.
  await expect(page.getByTestId('saldo-valor')).toHaveText('22');
  await expect(page.getByTestId('gozados-valor')).toHaveText('0');

  // Approve via the UI -> saldo recomputes live: 22 - 5 = 17.
  await page.getByRole('button', { name: 'Aprovar' }).first().click();
  await expect(page.getByTestId('gozados-valor')).toHaveText('5', { timeout: 15_000 });
  await expect(page.getByTestId('saldo-valor')).toHaveText('17');
  await expect(page.getByTestId('direito-valor')).toHaveText('22');

  await page.screenshot({ path: `${SHOTS}/saldo-aprovado.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Recursos: numa baixa o campo de notas é escondido e nunca persistido', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `S8-${Date.now()}`;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  const pid = await injectPessoa(page);

  await page.goto(`${APP}pessoa/${pid}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pessoa-detail')).toBeVisible({ timeout: 15_000 });

  // Switch the tipo to 'baixa' -> notas field disappears (health-data minimisation).
  await page.getByTestId('ausencia-tipo').selectOption('baixa');
  await expect(page.getByTestId('ausencia-notas')).toHaveCount(0);
  await expect(page.getByTestId('baixa-nota-privacidade')).toBeVisible();

  await page.getByTestId('ausencia-inicio').fill('2026-03-02');
  await page.getByTestId('ausencia-fim').fill('2026-03-04');
  await page.getByTestId('ausencia-submit').click();
  await expect(page.getByTestId('ausencia-row')).toHaveCount(1, { timeout: 15_000 });

  // The persisted row carries NO `notas` key at all.
  const row = await page.evaluate(async (pessoaId) => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } }).__ekoa.shared;
    const rows = await s.list('ausencias');
    return rows.find((a) => a.pessoaId === pessoaId) ?? null;
  }, pid);

  expect(row, 'the baixa ausência was persisted').toBeTruthy();
  expect((row as Record<string, unknown>).tipo).toBe('baixa');
  expect(Object.prototype.hasOwnProperty.call(row, 'notas'), 'baixa row must not carry a notas key').toBe(false);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
