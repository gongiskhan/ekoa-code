import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-tempos - S1 productivity layer of the Registo de Tempos over the
 * SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-tempos/):
 *  1. ?processo= deep-link (the target of the Nucleo's link-tempos) preselects
 *     the processo in BOTH the timer form and the manual form; a stale/unknown
 *     id is honestly cleared instead of leaving the select pointing at a ghost.
 *  2. Timer reload persistence: the running timer lives in the spine (estado
 *     'em_curso' + stored inicio), so a full page reload keeps it counting from
 *     the original start instant.
 *  3. Weekly timesheet: the Semana page exports a real PDF via the platform
 *     exportPdf bridge, named folha-tempos-<segunda-feira>.pdf.
 *
 * Deterministic + self-cleaning: rows carry a per-run nonce and are deleted in
 * afterEach (the transfer golden values live in the ported legal-tempos spec).
 */
const APP = legalAppUrl('legal-tempos');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-tempos');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

type Ctx = { nonce: string; clienteIds: string[]; processoIds: string[] };
const ctx: Ctx = { nonce: '', clienteIds: [], processoIds: [] };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 20_000 });
}

/** Local 'YYYY-MM-DD' (the app groups the week by local wall-clock day). */
function hojeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ clienteIds, processoIds, nonce }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const cols = ['registos_tempo', 'lancamentos', 'notificacoes', 'processos', 'clientes'];
      const tagged = (v: unknown) => typeof v === 'string' && nonce !== '' && v.includes(nonce);
      const fk = (v: unknown, ids: string[]) => typeof v === 'string' && ids.includes(v);
      for (const col of cols) {
        let rows: Row[] = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          const hit =
            fk(r.clienteId, clienteIds) ||
            fk(r.processoId, processoIds) ||
            fk(r.id, clienteIds) ||
            fk(r.id, processoIds) ||
            tagged(r.descricao) ||
            tagged(r.corpo) ||
            tagged(r.nome) ||
            tagged(r.numeroProcesso);
          if (hit) { try { await s.delete(col, String(r.id)); } catch { /* ignore */ } }
        }
      }
    }, ctx);
  } catch { /* page may be gone - ignore */ }
  ctx.clienteIds = [];
  ctx.processoIds = [];
});

test('Tempos: ?processo= preseleciona os formularios e um id fantasma e limpo com honestidade', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XT1-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'registos-page');

  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente T ${n}`, nif: '299000005', tipo: 'particular' });
    const p = await s.create('processos', { numeroProcesso: `TX-${n}`, clienteId: String(cli.id), estado: 'ativo' });
    return { cli: String(cli.id), p: String(p.id) };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];

  // Deep-link with a REAL processo: both forms preselect it once processos load.
  await page.goto(`${APP}?processo=${injected.p}`, { waitUntil: 'domcontentloaded' });
  await ready(page, 'registos-page');
  await expect(page.getByTestId('tempos-start-processo')).toHaveValue(injected.p, { timeout: 15_000 });
  await expect(page.getByTestId('tempos-processo')).toHaveValue(injected.p, { timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/deep-link.png`, fullPage: true });

  // Deep-link with an UNKNOWN id: once processos load the preselection is cleared
  // (an invalid FK must never ride silently into a created registo).
  await page.goto(`${APP}?processo=fantasma-${nonce}`, { waitUntil: 'domcontentloaded' });
  await ready(page, 'registos-page');
  // Wait until the options are actually loaded (the injected processo is offered),
  // then the value must have settled to empty.
  await expect(page.getByTestId('tempos-start-processo').locator(`option[value="${injected.p}"]`)).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId('tempos-start-processo')).toHaveValue('', { timeout: 15_000 });
  await expect(page.getByTestId('tempos-processo')).toHaveValue('', { timeout: 15_000 });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Tempos: o temporizador sobrevive a um reload e continua a contar do inicio guardado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XT2-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'registos-page');

  // Defensive: clear any timer left running by a previous run so the start form
  // is present.
  await page.evaluate(async () => {
    const s = (window as unknown as SharedWindow).__ekoa?.shared;
    if (!s) return;
    let rows: Row[] = [];
    try { rows = await s.list('registos_tempo'); } catch { rows = []; }
    for (const r of rows) {
      if (r.estado === 'em_curso') { try { await s.delete('registos_tempo', String(r.id)); } catch { /* ignore */ } }
    }
  });
  await page.reload();
  await ready(page, 'registos-page');

  await page.getByTestId('tempos-start-descricao').fill(`Persistente ${nonce}`);
  await page.getByTestId('tempos-iniciar').click();
  await ready(page, 'tempos-emcurso');

  // Let real time pass, then RELOAD: the timer must still be running because its
  // state lives in the spine, and the elapsed display derives from the stored
  // inicio (not from a client-side counter that a reload would zero).
  await page.waitForTimeout(2500);
  await page.reload();
  await ready(page, 'registos-page');
  await ready(page, 'tempos-emcurso');
  await expect(page.getByTestId('tempos-emcurso')).toContainText(`Persistente ${nonce}`);

  const cronometro = await page.getByTestId('tempos-cronometro').innerText();
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(cronometro.trim());
  expect(m, `cronometro renders HH:MM:SS (got "${cronometro}")`).not.toBeNull();
  const segundos = Number(m![1]) * 3600 + Number(m![2]) * 60 + Number(m![3]);
  expect(segundos, 'elapsed time survived the reload').toBeGreaterThanOrEqual(2);

  await page.screenshot({ path: `${SHOTS}/pos-reload.png`, fullPage: true });

  // Stop and confirm the row settles as parado with real minutes.
  await page.getByTestId('tempos-parar').click();
  const readRow = () => page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const rows = (await s.list('registos_tempo')).filter(
      (r) => typeof r.descricao === 'string' && r.descricao.includes(n),
    );
    const r = rows[0];
    return { count: rows.length, estado: String(r?.estado), minutos: Number(r?.minutos) };
  }, nonce);
  await expect.poll(async () => (await readRow()).estado, { timeout: 15_000 }).toBe('parado');
  const st = await readRow();
  expect(st.count).toBe(1);
  expect(st.minutos).toBeGreaterThan(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Tempos: dois cliques no mesmo tick transferem apenas UM lancamento (tranca sincrona)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XT4-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'registos-page');

  // A parado + faturavel registo qualifies for transfer (podeTransferir).
  const injected = await page.evaluate(async ({ n, hoje }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente DT ${n}`, nif: '299000006', tipo: 'particular' });
    const p = await s.create('processos', { numeroProcesso: `DT-${n}`, clienteId: String(cli.id), estado: 'ativo' });
    const r = await s.create('registos_tempo', {
      descricao: `Duplo clique ${n}`, processoId: String(p.id), clienteId: String(cli.id), pessoaId: null,
      inicio: `${hoje}T09:00:00`, fim: `${hoje}T10:00:00`, minutos: 60,
      faturavel: true, tarifaHora: 120, estado: 'parado',
    });
    return { cli: String(cli.id), p: String(p.id), r: String(r.id) };
  }, { n: nonce, hoje: hojeLocal() });
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];

  await page.reload();
  await ready(page, 'registos-page');
  const row = page.locator('tr', { hasText: `Duplo clique ${nonce}` });
  await expect(row.getByTestId('tempos-transferir')).toBeVisible({ timeout: 15_000 });

  // Two DOM clicks dispatched in the SAME JS tick - impossible for a physical
  // mouse, but exactly what a click storm/automation produces. The synchronous
  // ref lock must let only the first through (React state alone re-renders too
  // late to guard this).
  await page.evaluate((n) => {
    const rows = Array.from(document.querySelectorAll('tr'));
    const alvo = rows.find((r) => (r.textContent || '').includes(`Duplo clique ${n}`));
    const btn = alvo && alvo.querySelector<HTMLButtonElement>('[data-testid="tempos-transferir"]');
    if (!btn) throw new Error('botao transferir nao encontrado');
    btn.click();
    btn.click();
  }, nonce);

  // Exactly ONE lancamento for this registo, and the registo settles transferido
  // pointing at it.
  const readState = () => page.evaluate(async (rid) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const lancs = (await s.list('lancamentos')).filter((l) => l.registoTempoId === rid);
    let reg: Row | undefined;
    try { reg = (await s.list('registos_tempo')).find((r) => String(r.id) === rid); } catch { reg = undefined; }
    return { lancCount: lancs.length, estado: String(reg?.estado), lancamentoId: reg?.lancamentoId ? String(reg.lancamentoId) : null };
  }, injected.r);
  await expect.poll(async () => (await readState()).estado, { timeout: 15_000 }).toBe('transferido');
  const fim = await readState();
  expect(fim.lancCount, 'um unico lancamento apesar do duplo dispatch').toBe(1);
  expect(fim.lancamentoId).not.toBeNull();

  await page.screenshot({ path: `${SHOTS}/duplo-clique.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Tempos: a Semana exporta a folha de tempos em PDF real via exportPdf', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XT3-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'registos-page');

  // A stopped registo today lands in the current week's grid.
  await page.evaluate(async ({ n, hoje }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    await s.create('registos_tempo', {
      descricao: `Folha ${n}`, processoId: null, clienteId: null, pessoaId: null,
      inicio: `${hoje}T09:00:00`, fim: `${hoje}T10:30:00`, minutos: 90,
      faturavel: true, tarifaHora: 100, estado: 'parado',
    });
  }, { n: nonce, hoje: hojeLocal() });

  await page.goto(legalAppUrl('legal-tempos', 'semana'), { waitUntil: 'domcontentloaded' });
  await ready(page, 'semana-page');
  await expect(page.getByTestId('semana-grelha')).toContainText(`Folha ${nonce}`, { timeout: 15_000 });

  // The export goes through the platform exportPdf bridge (server-side Chromium
  // render), so allow a generous timeout for the real PDF to come back.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId('semana-exportar-pdf').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^folha-tempos-\d{4}-\d{2}-\d{2}\.pdf$/);

  await page.screenshot({ path: `${SHOTS}/semana-pdf.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
