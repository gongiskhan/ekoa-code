import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-kanban - S1 productivity layer of the Quadro over the SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-kanban/):
 *  1. ?processo= deep-link (the target of the Nucleo's link-kanban) pre-applies
 *     the processo filter; cards of other processos are hidden; each card with a
 *     processo deep-links back into the Nucleo's processo detail.
 *  2. The cliente filter narrows the board via the tarefa's clienteId or, in its
 *     absence, the processo's cliente.
 *  3. Keyboard movement: focusing a card and pressing ArrowRight/ArrowLeft moves
 *     it between columns with the same estado-sync rules as "Mover para", and the
 *     moved card keeps focus.
 *
 * Deterministic + self-cleaning: injected tarefas/processos/clientes carry a
 * per-run nonce and are removed in afterEach. Board-config rows are only READ.
 */
const APP = legalAppUrl('legal-kanban');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-kanban');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown> & { id: string };
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Record<string, unknown>): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

type Ctx = { nonce: string; processoIds: string[]; clienteIds: string[] };
const ctx: Ctx = { nonce: '', processoIds: [], clienteIds: [] };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 20_000 });
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/* Load the Nucleo once so its mount-time seedSpine() populates the shared spine
 * (kanban_boards). Only the Nucleo seeds; the board app never does. */
async function seedSpine(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'networkidle' });
  await expect
    .poll(async () => page.evaluate(async (): Promise<number> => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return 0;
      try { return (await s.list('kanban_boards')).length; } catch { return 0; }
    }), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

async function readTarefaByTitulo(page: Page, titulo: string): Promise<Row | null> {
  return page.evaluate(async (t): Promise<Row | null> => {
    const s = (window as unknown as SharedWindow).__ekoa?.shared;
    if (!s) return null;
    const list = await s.list('tarefas');
    return list.find((r) => r.titulo === t) ?? null;
  }, titulo);
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ nonce, processoIds, clienteIds }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      for (const col of ['tarefas', 'processos', 'clientes']) {
        let rows: Row[] = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          const hit =
            (typeof r.titulo === 'string' && r.titulo.includes(nonce)) ||
            (typeof r.numeroProcesso === 'string' && r.numeroProcesso.includes(nonce)) ||
            (typeof r.nome === 'string' && r.nome.includes(nonce)) ||
            processoIds.includes(r.id) ||
            clienteIds.includes(r.id) ||
            (typeof r.processoId === 'string' && processoIds.includes(r.processoId)) ||
            (typeof r.clienteId === 'string' && clienteIds.includes(r.clienteId));
          if (hit) { try { await s.delete(col, r.id); } catch { /* ignore */ } }
        }
      }
    }, ctx);
  } catch { /* page may be gone - ignore */ }
  ctx.processoIds = [];
  ctx.clienteIds = [];
});

test('Quadro: ?processo= pre-filtra o quadro e o cartao liga ao detalhe no Nucleo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XK1-${Date.now()}`;
  ctx.nonce = nonce;

  await seedSpine(page);

  const injected = await page.evaluate(async ({ n, prazo }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const p1 = await s.create('processos', { numeroProcesso: `KX-${n}`, estado: 'ativo' });
    const p2 = await s.create('processos', { numeroProcesso: `KY-${n}`, estado: 'ativo' });
    await s.create('tarefas', { titulo: `Alvo ${n}`, processoId: p1.id, responsavel: 'Dra. Teste', prazo, urgencia: 'media', estado: 'aberta', origem: 'kanban' });
    await s.create('tarefas', { titulo: `Outro ${n}`, processoId: p2.id, responsavel: 'Dra. Teste', prazo, urgencia: 'media', estado: 'aberta', origem: 'kanban' });
    return { p1: p1.id, p2: p2.id };
  }, { n: nonce, prazo: todayPlus(5) });
  ctx.processoIds = [injected.p1, injected.p2];

  // Deep-link straight into the filtered board (what the Nucleo's link-kanban does).
  await page.goto(`${APP}?processo=${injected.p1}`, { waitUntil: 'networkidle' });
  await ready(page, 'kanban-board');

  await expect(page.getByTestId('kanban-filtro-processo')).toHaveValue(injected.p1, { timeout: 15_000 });
  const alvo = page.getByTestId('kanban-card').filter({ hasText: `Alvo ${nonce}` });
  await expect(alvo).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('kanban-card').filter({ hasText: `Outro ${nonce}` })).toHaveCount(0);

  // The card deep-links back into the Nucleo's processo detail.
  await expect(alvo.getByTestId('kanban-card-nucleo')).toHaveAttribute(
    'href',
    new RegExp(`/apps/legal-nucleo/processos/${injected.p1}$`),
  );

  await page.screenshot({ path: `${SHOTS}/filtro-processo.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Quadro: o filtro por cliente segue o clienteId da tarefa ou o cliente do processo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XK2-${Date.now()}`;
  ctx.nonce = nonce;

  await seedSpine(page);

  const injected = await page.evaluate(async ({ n, prazo }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente K ${n}`, nif: '299000004', tipo: 'particular' });
    const p = await s.create('processos', { numeroProcesso: `KC-${n}`, clienteId: cli.id, estado: 'ativo' });
    // The card itself carries NO clienteId - the filter must resolve it via the processo.
    await s.create('tarefas', { titulo: `DoCliente ${n}`, processoId: p.id, responsavel: 'Dra. Teste', prazo, urgencia: 'media', estado: 'aberta', origem: 'kanban' });
    await s.create('tarefas', { titulo: `Solto ${n}`, responsavel: 'Dra. Teste', prazo, urgencia: 'media', estado: 'aberta', origem: 'kanban' });
    return { cli: cli.id, p: p.id };
  }, { n: nonce, prazo: todayPlus(5) });
  ctx.processoIds = [injected.p];
  ctx.clienteIds = [injected.cli];

  await page.goto(APP, { waitUntil: 'networkidle' });
  await ready(page, 'kanban-board');

  const doCliente = page.getByTestId('kanban-card').filter({ hasText: `DoCliente ${nonce}` });
  const solto = page.getByTestId('kanban-card').filter({ hasText: `Solto ${nonce}` });
  await expect(doCliente).toBeVisible({ timeout: 15_000 });
  await expect(solto).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('kanban-filtro-cliente').selectOption(injected.cli);
  await expect(doCliente).toBeVisible({ timeout: 15_000 });
  await expect(solto).toHaveCount(0);

  await page.getByTestId('kanban-filtro-cliente').selectOption('all');
  await expect(solto).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/filtro-cliente.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Quadro: setas movem o cartao focado entre colunas com sincronizacao do estado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XK3-${Date.now()}`;
  ctx.nonce = nonce;
  const titulo = `Teclado ${nonce}`;

  await seedSpine(page);

  await page.evaluate(async ({ t, prazo }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    await s.create('tarefas', { titulo: t, responsavel: 'Dra. Teste', prazo, urgencia: 'media', estado: 'aberta', origem: 'kanban' });
  }, { t: titulo, prazo: todayPlus(5) });

  await page.goto(APP, { waitUntil: 'networkidle' });
  await ready(page, 'kanban-board');

  const card = () => page.getByTestId('kanban-card').filter({ hasText: titulo });
  await expect(page.getByTestId('kanban-lane-aberta')).toContainText(titulo, { timeout: 15_000 });

  // ArrowRight: aberta -> em_curso (mapped column, so the canonical estado syncs).
  await card().press('ArrowRight');
  await expect(page.getByTestId('kanban-lane-em_curso')).toContainText(titulo, { timeout: 15_000 });
  await expect
    .poll(async () => (await readTarefaByTitulo(page, titulo))?.estado, { timeout: 15_000 })
    .toBe('em_curso');

  // The moved card keeps keyboard focus, so a second arrow keeps working.
  await expect
    .poll(async () => page.evaluate((t) => {
      const el = document.activeElement as HTMLElement | null;
      return Boolean(el && el.getAttribute('data-testid') === 'kanban-card' && (el.textContent || '').includes(t));
    }, titulo), { timeout: 10_000 })
    .toBe(true);

  await page.screenshot({ path: `${SHOTS}/teclado-direita.png`, fullPage: true });

  // ArrowLeft: em_curso -> aberta (mapped again, estado syncs back).
  await card().press('ArrowLeft');
  await expect(page.getByTestId('kanban-lane-aberta')).toContainText(titulo, { timeout: 15_000 });
  await expect
    .poll(async () => (await readTarefaByTitulo(page, titulo))?.estado, { timeout: 15_000 })
    .toBe('aberta');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
