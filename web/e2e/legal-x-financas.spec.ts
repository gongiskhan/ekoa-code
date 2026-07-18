import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-financas - S3-money layer of the Finanças app (run
 * 20260717-202309-d797918a), on top of the byte-frozen legal-financas spec.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-financas/):
 *  1. Conta corrente por PROCESSO: the optional processo filter narrows the
 *     extrato and the saldo; movements without processoId are honestly declared
 *     excluded (cc-sem-processo-aviso) instead of silently dropped; the new
 *     "Provisões disponíveis" KPI sums estado 'recebida' saldos in scope.
 *  2. CSV export: a real download whose content opens with the honest
 *     disclaimer line ("não é extrato contabilístico certificado"), names the
 *     processo scope, and carries the signed movement rows.
 *  3. Despesas: per-processo filter plus the honest visible-rows totals line
 *     (total + reembolsáveis of exactly what is on screen).
 *
 * Deterministic + self-cleaning: rows carry a per-run nonce and are deleted in
 * afterEach; the frozen spec's default-filter pins are untouched (this spec
 * always drives its own nonce cliente).
 */
const APP = legalAppUrl('legal-financas');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-financas');
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
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 90_000 });
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ clienteIds, processoIds, nonce }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const cols = ['conta_corrente', 'provisoes', 'despesas', 'notificacoes', 'processos', 'clientes'];
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
            tagged(r.notas) ||
            tagged(r.descricao) ||
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

/** Seeds a nonce cliente with 2 processos, 4 movements and 2 provisões. */
async function semear(page: Page, nonce: string) {
  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente F ${n}`, nif: '299000005', tipo: 'empresa' });
    const cid = String(cli.id);
    const p1 = await s.create('processos', { numeroProcesso: `XF1-${n}`, clienteId: cid, estado: 'ativo' });
    const p2 = await s.create('processos', { numeroProcesso: `XF2-${n}`, clienteId: cid, estado: 'ativo' });
    const id1 = String(p1.id);
    const id2 = String(p2.id);
    await s.create('conta_corrente', { clienteId: cid, processoId: id1, tipo: 'debito', origem: 'despesa', valor: 100, data: '2026-07-01', notas: `mov1 ${n}` });
    await s.create('conta_corrente', { clienteId: cid, processoId: id1, tipo: 'credito', origem: 'provisao', valor: 40, data: '2026-07-02', notas: `mov2 ${n}` });
    await s.create('conta_corrente', { clienteId: cid, processoId: id2, tipo: 'debito', origem: 'despesa', valor: 200, data: '2026-07-03', notas: `mov3 ${n}` });
    // Movimento ANTIGO sem processoId - só a vista de cliente o mostra.
    await s.create('conta_corrente', { clienteId: cid, tipo: 'debito', origem: 'honorarios', valor: 50, data: '2026-07-04', notas: `mov4 ${n}` });
    await s.create('provisoes', { clienteId: cid, processoId: id1, valor: 300, saldo: 250, estado: 'recebida', descricao: `prov1 ${n}` });
    // Consumida: saldo fora do KPI "disponíveis".
    await s.create('provisoes', { clienteId: cid, processoId: id2, valor: 100, saldo: 0, estado: 'consumida', descricao: `prov2 ${n}` });
    return { cli: cid, p1: id1, p2: id2 };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p1, injected.p2];
  return injected;
}

test('Financas: vista por processo honesta (exclusoes declaradas), provisoes disponiveis e extrato CSV com aviso', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XF1-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'conta-corrente-page');
  const injected = await semear(page, nonce);
  // As colecções carregam no mount - recarrega para as fixtures entrarem.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page, 'conta-corrente-page');

  // Vista de CLIENTE (omissão): os 4 movimentos, saldo 100+200+50-40 = 310,
  // e as provisões 'recebida' de todo o cliente (250 por consumir).
  await page.getByTestId('cc-cliente').selectOption(injected.cli);
  await expect(page.getByTestId('cc-count')).toHaveText('4', { timeout: 15_000 });
  await expect(page.getByTestId('financas-saldo')).toContainText('310,00');
  await expect(page.getByTestId('cc-provisoes')).toContainText('250,00');
  await expect(page.getByTestId('cc-sem-processo-aviso')).toHaveCount(0);

  // Vista por PROCESSO 1: só os 2 movimentos imputados; o movimento sem
  // processoId é declarado excluído em vez de desaparecer em silêncio.
  await page.getByTestId('cc-processo').selectOption(injected.p1);
  await expect(page.getByTestId('cc-count')).toHaveText('2');
  await expect(page.getByTestId('cc-debitos')).toContainText('100,00');
  await expect(page.getByTestId('cc-creditos')).toContainText('40,00');
  await expect(page.getByTestId('financas-saldo')).toContainText('60,00');
  await expect(page.getByTestId('cc-provisoes')).toContainText('250,00');
  await expect(page.getByTestId('cc-sem-processo-aviso')).toContainText('1 movimento deste cliente não tem processo associado');

  await page.screenshot({ path: `${SHOTS}/vista-processo.png`, fullPage: true });

  // CSV do âmbito corrente: download real, com o aviso honesto na cabeça,
  // o processo no título e os movimentos assinados (créditos negativos).
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByTestId('cc-exportar-csv').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^conta-corrente .*\.csv$/i);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv).toContain('não é extrato contabilístico certificado');
  expect(csv).toContain(`- processo XF1-${nonce}`);
  expect(csv).toContain('Data;Tipo;Origem;Descrição;Valor (EUR);Saldo corrente (EUR)');
  expect(csv).toContain(`mov2 ${nonce};-40,00;60,00`);

  // Vista por PROCESSO 2: sem provisões recebidas nesse âmbito - di-lo.
  await page.getByTestId('cc-processo').selectOption(injected.p2);
  await expect(page.getByTestId('cc-count')).toHaveText('1');
  await expect(page.getByTestId('financas-saldo')).toContainText('200,00');
  await expect(page.getByTestId('cc-provisoes')).toContainText('0,00');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Financas: despesas filtram por processo e o total do filtro soma so o que esta a vista', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XF2-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(legalAppUrl('legal-financas', 'despesas'), { waitUntil: 'domcontentloaded' });
  await ready(page, 'despesas-page');

  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const hoje = new Date().toISOString().slice(0, 10);
    const cli = await s.create('clientes', { nome: `Cliente FD ${n}`, nif: '299000005', tipo: 'empresa' });
    const cid = String(cli.id);
    const p1 = await s.create('processos', { numeroProcesso: `XFD1-${n}`, clienteId: cid, estado: 'ativo' });
    const p2 = await s.create('processos', { numeroProcesso: `XFD2-${n}`, clienteId: cid, estado: 'ativo' });
    await s.create('despesas', { processoId: String(p1.id), clienteId: cid, categoria: 'taxas', descricao: `desp1 ${n}`, valor: 30, data: hoje, reembolsavel: true, estado: 'registada' });
    await s.create('despesas', { processoId: String(p2.id), clienteId: cid, categoria: 'deslocacoes', descricao: `desp2 ${n}`, valor: 20, data: hoje, reembolsavel: false, estado: 'registada' });
    return { cli: cid, p1: String(p1.id), p2: String(p2.id) };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p1, injected.p2];

  // As colecções carregam no mount - recarrega para as fixtures entrarem.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page, 'despesas-page');
  await expect(page.getByTestId('despesas-tabela')).toContainText(`desp1 ${nonce}`, { timeout: 15_000 });

  // Filtro por processo: só a despesa imputada fica à vista, e o total honesto
  // soma exactamente o que se vê (30,00 total, 30,00 reembolsável).
  await page.getByTestId('despesas-filtro-processo').selectOption(injected.p1);
  await expect(page.getByTestId('despesas-tabela')).toContainText(`desp1 ${nonce}`);
  await expect(page.getByTestId('despesas-tabela')).not.toContainText(`desp2 ${nonce}`);
  await expect(page.getByTestId('despesas-total-filtro')).toContainText('1 despesa no filtro');
  await expect(page.getByTestId('despesas-total-filtro')).toContainText('30,00');
  await expect(page.getByTestId('despesas-total-filtro')).toContainText('reembolsáveis');

  await page.screenshot({ path: `${SHOTS}/despesas-filtro.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
