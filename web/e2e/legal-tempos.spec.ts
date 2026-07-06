import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-tempos - the Registo de Tempos module over the SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-tempos/):
 *  1. The page renders over the seeded/empty spine with zero page errors and the
 *     recent-registos list surface visible.
 *  2. Timer flow: start the live timer, stop it, and the row lands as estado
 *     'parado' with a computed minutos > 0 (ceil to the minimum billing minute).
 *  3. Transfer golden value: a manual entry of exactly 90 minutos at tarifa 120,
 *     faturável, transferred to honorários writes a lançamentos row with horas
 *     1.5 and valor 180, flips the registo to 'transferido', and the transfer is
 *     idempotent (the button is gone afterwards).
 *
 * Deterministic + self-cleaning: each test tags its rows with a per-run nonce
 * (and injects its own fixtures where FKs matter) and deletes everything that
 * references them in afterEach, so it never depends on (or pollutes) the seed.
 */
const APP = legalAppUrl('legal-tempos');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'tempos');
mkdirSync(SHOTS, { recursive: true });

/** Minimal shape of the platform-injected shared-spine API (window.__ekoa.shared). */
type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  update(collection: string, id: string, patch: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

type Ctx = { nonce: string; clienteIds: string[]; processoIds: string[] };
const ctx: Ctx = { nonce: '', clienteIds: [], processoIds: [] };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 20_000 });
}

test.afterEach(async ({ page }) => {
  // Best-effort teardown of every row that references this run's fixtures - by
  // FK to the injected cliente/processo, by id, or by the nonce carried in a
  // descrição/corpo/número. Covers the registos, the lançamentos they created,
  // and the notificações emitted on transfer.
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

test('Tempos: a página carrega sem erros e mostra a lista de registos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  ctx.nonce = `TMP-${Date.now()}`;

  await page.goto(APP);
  await ready(page, 'registos-page');

  // The recent-registos surface is always present (renders an empty state when
  // there is nothing to show), so the demo anchor and the list are visible.
  await expect(page.getByTestId('tempos-lista')).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/registos.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Tempos: iniciar e parar o temporizador cria um registo parado com minutos > 0', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `TMP-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP);
  await ready(page, 'registos-page');

  // Defensive: clear any timer left running by a previous run so the start form
  // (and its "Iniciar temporizador" button) is present.
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

  const descricao = `Cronometrado ${nonce}`;
  await page.getByTestId('tempos-start-descricao').fill(descricao);
  await page.getByTestId('tempos-iniciar').click();

  // The live timer panel replaces the start form.
  await ready(page, 'tempos-emcurso');
  await expect(page.getByTestId('tempos-cronometro')).toBeVisible();

  await page.getByTestId('tempos-parar').click();

  // The stopped row lands as 'parado' with a computed minutos > 0.
  const st = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const rows = (await s.list('registos_tempo')).filter(
      (r) => typeof r.descricao === 'string' && r.descricao.includes(n),
    );
    const r = rows[0];
    return { count: rows.length, estado: String(r?.estado), minutos: Number(r?.minutos) };
  }, nonce);

  expect(st.count).toBe(1);
  expect(st.estado).toBe('parado');
  expect(st.minutos).toBeGreaterThan(0);

  await page.screenshot({ path: `${SHOTS}/timer-parado.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Tempos: transferir 90 min à tarifa 120 gera lançamento horas 1,5 / valor 180 (idempotente)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `TMP-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP);
  await ready(page, 'registos-page');

  // Inject a tagged cliente + processo so the registo (and the lançamento it
  // spawns) carry real foreign keys.
  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente ${n}`, nif: '299999990', tipo: 'particular' });
    const p = await s.create('processos', { numeroProcesso: `TP-${n}`, clienteId: String(cli.id), estado: 'ativo' });
    return { cli: String(cli.id), p: String(p.id) };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];

  // Fresh load so the manual-entry selects include the just-injected processo.
  await page.goto(APP);
  await ready(page, 'registos-page');

  const descricao = `Manual ${nonce}`;
  await page.getByTestId('tempos-desc').fill(descricao);
  await page.getByTestId('tempos-processo').selectOption(injected.p);
  await page.getByTestId('tempos-minutos').fill('90');
  await page.getByTestId('tempos-tarifa').fill('120');
  // faturável is checked by default.
  await page.getByTestId('tempos-guardar').click();

  // The new registo appears at the top of the list, parado + faturável, with a
  // transfer button.
  const row = page.getByTestId('tempos-registo').filter({ hasText: nonce }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByTestId('tempos-transferir')).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/pre-transfer.png`, fullPage: true });

  await row.getByTestId('tempos-transferir').click();

  // Idempotent: once transferred, the button is gone (no second transfer).
  await expect(row.getByTestId('tempos-transferir')).toHaveCount(0, { timeout: 15_000 });

  // Golden value assertions over the shared API.
  const st = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const lancs = (await s.list('lancamentos')).filter(
      (l) => typeof l.descricao === 'string' && l.descricao.includes(n),
    );
    const regs = (await s.list('registos_tempo')).filter(
      (r) => typeof r.descricao === 'string' && r.descricao.includes(n),
    );
    const l = lancs[0];
    const r = regs[0];
    return {
      lancCount: lancs.length,
      horas: Number(l?.horas),
      valor: Number(l?.valor),
      tipo: String(l?.tipo),
      modo: String(l?.modo),
      estado: String(r?.estado),
      hasLancId: Boolean(r?.lancamentoId),
    };
  }, nonce);

  expect(st.lancCount).toBe(1);
  expect(st.horas).toBe(1.5);
  expect(st.valor).toBe(180);
  expect(st.tipo).toBe('honorario');
  expect(st.modo).toBe('hora');
  expect(st.estado).toBe('transferido');
  expect(st.hasLancId).toBe(true);

  await page.screenshot({ path: `${SHOTS}/post-transfer.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
