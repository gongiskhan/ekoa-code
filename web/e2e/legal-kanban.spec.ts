import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * S-kanban - the Quadro de Tarefas board over the SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-kanban/):
 *  1. The seeded board renders its lanes and tarefas land in the column whose
 *     estadoMap matches their canonical estado (no kanbanColuna needed).
 *  2. THE architecture assertion: a card created via the UI starts in "Por fazer"
 *     (estado 'aberta'); moving it to "Em curso" (estadoMap 'em_curso') writes
 *     BOTH estado='em_curso' and kanbanColuna='em_curso'; moving it to
 *     "Em revisão" (estadoMap null) writes kanbanColuna='revisao' while the
 *     canonical estado stays 'em_curso' - presentation moves without touching the
 *     estado the Núcleo renders.
 *  3. A card with a processoId deep-links into the Dossiê app.
 *
 * Deterministic + self-cleaning: the tarefas the specs create carry a per-run
 * nonce in the titulo and are deleted in afterEach, so the suite never depends on
 * (nor pollutes) other rows. The board-config rows are only READ.
 */
const APP = legalAppUrl('legal-kanban');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 's-kanban');
mkdirSync(SHOTS, { recursive: true });

// The account-shared namespace the platform injects into every served app.
type SharedRow = Record<string, unknown> & { id: string };
type SharedApi = {
  list: (collection: string) => Promise<SharedRow[]>;
  create: (collection: string, data: Record<string, unknown>) => Promise<SharedRow>;
  delete: (collection: string, id: string) => Promise<boolean>;
};
type EkoaWindow = Window & { __ekoa?: { shared?: SharedApi } };

type Ctx = { nonce: string; processoIds: string[] };
const ctx: Ctx = { nonce: '', processoIds: [] };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 20_000 });
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/*
 * Load the Núcleo once so its mount-time seedSpine() populates the shared spine
 * (kanban_boards + tarefas). Only the Núcleo seeds; the board app never does.
 * Waits until the seeded kanban_boards row is visible in the shared namespace.
 */
async function seedSpine(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'networkidle' });
  await expect
    .poll(async () => page.evaluate(async (): Promise<number> => {
      const s = (window as unknown as EkoaWindow).__ekoa?.shared;
      if (!s) return 0;
      try { return (await s.list('kanban_boards')).length; } catch { return 0; }
    }), { timeout: 20_000 })
    .toBeGreaterThan(0);
}

async function readTarefaByTitulo(page: Page, titulo: string): Promise<SharedRow | null> {
  return page.evaluate(async (t): Promise<SharedRow | null> => {
    const s = (window as unknown as EkoaWindow).__ekoa?.shared;
    if (!s) return null;
    const list = await s.list('tarefas');
    return list.find((r) => r.titulo === t) ?? null;
  }, titulo);
}

test.afterEach(async ({ page }) => {
  // Best-effort teardown of every row that references this run's nonce.
  try {
    await page.evaluate(async ({ nonce, processoIds }) => {
      const s = (window as unknown as EkoaWindow).__ekoa?.shared;
      if (!s) return;
      const cols = ['tarefas', 'processos', 'kanban_boards'];
      for (const col of cols) {
        let rows: SharedRow[] = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          const hit =
            (typeof r.titulo === 'string' && r.titulo.includes(nonce)) ||
            (typeof r.numeroProcesso === 'string' && r.numeroProcesso.includes(nonce)) ||
            (typeof r.nome === 'string' && r.nome.includes(nonce)) ||
            (typeof r.id === 'string' && processoIds.includes(r.id)) ||
            (typeof r.processoId === 'string' && processoIds.includes(r.processoId));
          if (hit) { try { await s.delete(col, r.id); } catch { /* ignore */ } }
        }
      }
    }, ctx);
  } catch { /* page may be gone - ignore */ }
  ctx.processoIds = [];
});

test('Quadro: seeded board renders lanes and tarefas land in estado-mapped columns', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `K1-${Date.now()}`;
  ctx.nonce = nonce;

  await seedSpine(page);

  // The board-config really exists (rendering from the seeded board, not the
  // in-memory default fallback); then inject two controlled tarefas whose estado
  // alone must place them - no kanbanColuna written.
  const boardCount = await page.evaluate(async (): Promise<number> => {
    const s = (window as unknown as EkoaWindow).__ekoa?.shared;
    return s ? (await s.list('kanban_boards')).length : 0;
  });
  expect(boardCount, 'the seeded kanban_boards row exists').toBeGreaterThan(0);

  await page.evaluate(async ({ n, prazo }) => {
    const s = (window as unknown as EkoaWindow).__ekoa?.shared;
    if (!s) return;
    await s.create('tarefas', { titulo: `Aberta ${n}`, responsavel: 'Dra. Teste', prazo, urgencia: 'media', estado: 'aberta', origem: 'kanban' });
    await s.create('tarefas', { titulo: `EmCurso ${n}`, responsavel: 'Dra. Teste', prazo, urgencia: 'alta', estado: 'em_curso', origem: 'kanban' });
  }, { n: nonce, prazo: todayPlus(5) });

  await page.goto(APP, { waitUntil: 'networkidle' });
  await ready(page, 'kanban-board');

  // The seeded board's four lanes render.
  for (const id of ['aberta', 'em_curso', 'revisao', 'concluida']) {
    await expect(page.getByTestId(`kanban-lane-${id}`)).toBeVisible({ timeout: 15_000 });
  }

  // Each injected tarefa sits in the lane whose estadoMap matches its estado.
  await expect(page.getByTestId('kanban-lane-aberta')).toContainText(`Aberta ${nonce}`);
  await expect(page.getByTestId('kanban-lane-em_curso')).toContainText(`EmCurso ${nonce}`);

  await page.screenshot({ path: `${SHOTS}/board.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Quadro: create card in "Por fazer" then move em_curso (syncs estado) then revisao (estado unchanged)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `K2-${Date.now()}`;
  ctx.nonce = nonce;
  const titulo = `Cartao ${nonce}`;

  await seedSpine(page);

  await page.goto(APP, { waitUntil: 'networkidle' });
  await ready(page, 'kanban-board');

  // Create a card via the UI - it enters the "Por fazer" (aberta) lane.
  await page.getByTestId('kanban-novo').click();
  await page.getByTestId('kanban-titulo').fill(titulo);
  await page.getByTestId('kanban-guardar').click();
  await expect(page.getByTestId('kanban-lane-aberta')).toContainText(titulo);

  const card = () => page.getByTestId('kanban-card').filter({ hasText: titulo });

  // Move to "Em curso" (estadoMap 'em_curso'): estado AND kanbanColuna both become em_curso.
  await card().getByTestId('kanban-mover').selectOption('em_curso');
  await expect(page.getByTestId('kanban-lane-em_curso')).toContainText(titulo);
  let state = await readTarefaByTitulo(page, titulo);
  expect(state?.estado, 'estado synced to the mapped column').toBe('em_curso');
  expect(state?.kanbanColuna, 'presentation column recorded').toBe('em_curso');

  // Move to "Em revisão" (estadoMap null): kanbanColuna changes, canonical estado does NOT.
  await card().getByTestId('kanban-mover').selectOption('revisao');
  await expect(page.getByTestId('kanban-lane-revisao')).toContainText(titulo);
  state = await readTarefaByTitulo(page, titulo);
  expect(state?.kanbanColuna, 'card now presented in the revisao column').toBe('revisao');
  expect(state?.estado, 'null-estadoMap column must NOT touch the canonical estado').toBe('em_curso');

  await page.screenshot({ path: `${SHOTS}/moved.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Quadro: a card with a processoId deep-links into the Dossiê', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `K3-${Date.now()}`;
  ctx.nonce = nonce;

  // Bootstrap the shared namespace, then inject a processo + a tarefa on it.
  await page.goto(APP, { waitUntil: 'networkidle' });
  await ready(page, 'kanban-board');

  const injected = await page.evaluate(async ({ n, prazo }): Promise<{ p: string }> => {
    const s = (window as unknown as EkoaWindow).__ekoa?.shared;
    if (!s) return { p: '' };
    const p = await s.create('processos', { numeroProcesso: `K3-${n}`, estado: 'ativo' });
    await s.create('tarefas', { titulo: `Deep ${n}`, processoId: p.id, responsavel: 'Dr. Teste', prazo, urgencia: 'media', estado: 'aberta', origem: 'kanban' });
    return { p: p.id };
  }, { n: nonce, prazo: todayPlus(5) });
  ctx.processoIds = [injected.p];

  await page.goto(APP, { waitUntil: 'networkidle' });
  await ready(page, 'kanban-board');

  const card = page.getByTestId('kanban-card').filter({ hasText: `Deep ${nonce}` });
  await expect(card).toBeVisible({ timeout: 15_000 });
  const link = card.getByTestId('kanban-card-dossie');
  await expect(link).toHaveAttribute('href', new RegExp(`/apps/legal-dossie/processo/${injected.p}$`));

  await page.screenshot({ path: `${SHOTS}/deeplink.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
