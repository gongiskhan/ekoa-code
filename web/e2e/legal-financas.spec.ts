import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * S-finanças - the Finanças e Contabilidade module over the SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-financas/):
 *  1. Conta corrente: the client ledger renders with the correct running saldo
 *     (débitos − créditos) computed over injected movements.
 *  2. THE REGULATORY TEST (§3.2.1): /faturacao never emits a certified invoice
 *     natively - no ATCUD / invoice-number generator, the "Emitir fatura
 *     certificada" button is DISABLED with the explanatory copy, and preparing a
 *     faturacao_pedidos request writes NO fiscal metadata onto any documentos row.
 *  3. Despesa flow: a reembolsável despesa, once aprovada, writes a conta_corrente
 *     débito (origem 'despesa') and the ledger reflects it.
 *  4. Provisão: marcar recebida writes a conta_corrente crédito (origem
 *     'pagamento') and the provisão saldo updates.
 *
 * Deterministic + self-cleaning: each test injects its own nonce-tagged spine
 * rows via window.__ekoa.shared and deletes everything referencing them in
 * afterEach, so it never depends on (or pollutes) the seeded data.
 */
const APP = legalAppUrl('legal-financas');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 's-financas');
mkdirSync(SHOTS, { recursive: true });

// Typed view of the shared spine handle the served app injects on window - so
// this spec stays free of `any` (the collection rows are open records).
type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  get(collection: string, id: string): Promise<Row | null>;
  create(collection: string, data: Row): Promise<Row>;
  update(collection: string, id: string, patch: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type EkoaWindow = Window & { __ekoa?: { shared?: SharedApi } };

type Ctx = { nonce: string; clienteIds: string[]; processoIds: string[]; docIds: string[] };
const ctx: Ctx = { nonce: '', clienteIds: [], processoIds: [], docIds: [] };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 20_000 });
}

test.afterEach(async ({ page }) => {
  // Best-effort teardown of every row that references the injected fixtures.
  try {
    await page.evaluate(async ({ clienteIds, processoIds, docIds, nonce }) => {
      const s = (window as EkoaWindow).__ekoa?.shared;
      if (!s) return;
      const cols = ['despesas', 'provisoes', 'conta_corrente', 'faturacao_pedidos', 'documentos', 'processos', 'clientes'];
      for (const col of cols) {
        let rows: Row[] = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          const hit =
            (typeof r.clienteId === 'string' && clienteIds.includes(r.clienteId)) ||
            (typeof r.processoId === 'string' && processoIds.includes(r.processoId)) ||
            (typeof r.documentoId === 'string' && docIds.includes(r.documentoId)) ||
            (typeof r.id === 'string' && (clienteIds.includes(r.id) || processoIds.includes(r.id) || docIds.includes(r.id))) ||
            (typeof r.nome === 'string' && r.nome.includes(nonce)) ||
            (typeof r.descricao === 'string' && r.descricao.includes(nonce)) ||
            (typeof r.notas === 'string' && r.notas.includes(nonce)) ||
            (typeof r.referencia === 'string' && r.referencia.includes(nonce)) ||
            (typeof r.numeroProcesso === 'string' && r.numeroProcesso.includes(nonce));
          if (hit && typeof r.id === 'string') { try { await s.delete(col, r.id); } catch { /* ignore */ } }
        }
      }
    }, ctx);
  } catch { /* page may be gone - ignore */ }
  ctx.clienteIds = [];
  ctx.processoIds = [];
  ctx.docIds = [];
});

test('Finanças: conta corrente ledger with correct running saldo (débitos − créditos)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `SF-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP);
  await ready(page, 'conta-corrente-page');

  // Inject a cliente with two movements mirroring the seeded shape for cli(0):
  // débito 885,60 (pré-fatura) then crédito 500,00 (pagamento). Running saldo
  // ends at 885,60 − 500,00 = 385,60.
  const injected = await page.evaluate(async (n) => {
    const s = (window as EkoaWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente ${n}`, nif: '299999990', tipo: 'particular' });
    await s.create('conta_corrente', { clienteId: cli.id, tipo: 'debito', origem: 'pre-fatura', valor: 885.6, data: '2026-01-05', notas: `Pré-fatura ${n}` });
    await s.create('conta_corrente', { clienteId: cli.id, tipo: 'credito', origem: 'pagamento', valor: 500, data: '2026-02-05', refExterna: 'TRF-TEST', notas: `Pagamento ${n}` });
    return { cli: cli.id as string };
  }, nonce);
  ctx.clienteIds = [injected.cli];

  await page.goto(APP);
  await ready(page, 'conta-corrente-page');

  await page.getByTestId('cc-cliente').selectOption(injected.cli);

  await expect(page.getByTestId('cc-debitos')).toContainText('885,60');
  await expect(page.getByTestId('cc-creditos')).toContainText('500,00');
  await expect(page.getByTestId('financas-saldo')).toContainText('385,60');
  await expect(page.getByTestId('cc-ledger')).toBeVisible();

  // The final running-saldo cell equals the KPI.
  const saldoCells = page.getByTestId('cc-saldo-corrente');
  await expect(saldoCells).toHaveCount(2);
  await expect(saldoCells.last()).toContainText('385,60');

  await page.screenshot({ path: `${SHOTS}/conta-corrente.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Finanças: REGULATORY - /faturacao never emits natively; emit disabled; pedido writes no fiscal metadata', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `SF-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP);
  await ready(page, 'conta-corrente-page');

  // Inject a cliente, a processo, and a honorários pré-fatura (documentos origem
  // 'honorarios') - the base a certified-emission pedido is prepared from.
  const injected = await page.evaluate(async (n) => {
    const s = (window as EkoaWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente ${n}`, nif: '510000028', tipo: 'empresa' });
    const p = await s.create('processos', { numeroProcesso: `PF-${n}`, clienteId: cli.id, estado: 'ativo' });
    const doc = await s.create('documentos', { nome: `Pré-fatura ${n}`, tipo: 'nota', origem: 'honorarios', processoId: p.id, clienteId: cli.id, texto: 'Pré-fatura de conferência.', versao: 1, data: '2026-03-01' });
    return { cli: cli.id as string, p: p.id as string, doc: doc.id as string };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];
  ctx.docIds = [injected.doc];

  await page.goto(`${APP}faturacao`);
  await ready(page, 'faturacao-page');

  // (a) The certified-emission button is DISABLED with the explanatory copy.
  await expect(page.getByTestId('financas-emitir-bloqueado')).toBeDisabled();
  await expect(page.getByTestId('fat-bloqueio-copy')).toContainText(
    'A emissão certificada requer a integração InvoiceXpress configurada (AT). A Ekoa não emite faturas nativamente.',
  );

  // (a) The rendered page has NO ATCUD and no invoice-number generator input.
  const visibleText = (await page.getByTestId('faturacao-page').innerText()).toUpperCase();
  expect(visibleText.includes('ATCUD'), 'page must not render ATCUD').toBe(false);
  // No free-standing text/number input that could stand in for an invoice-number
  // generator (the page is selects + buttons only).
  await expect(page.locator('[data-testid="faturacao-page"] input[type="text"], [data-testid="faturacao-page"] input[type="number"]')).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/faturacao-bloqueada.png`, fullPage: true });

  // (b) Preparing a pedido writes a faturacao_pedidos intent row and NO fiscal
  // metadata anywhere in documentos.
  await page.getByTestId('fat-prefatura-select').selectOption(injected.doc);
  await page.getByTestId('financas-pedido-emissao').click();
  await expect(page.getByTestId('fat-pedidos')).toBeVisible({ timeout: 15_000 });

  const state = await page.evaluate(async ({ doc }) => {
    const s = (window as EkoaWindow).__ekoa!.shared!;
    const pedidos = (await s.list('faturacao_pedidos')).filter((p) => p.documentoId === doc);
    const docs = await s.list('documentos');
    const FISCAL = ['atcud', 'numeroFatura', 'numero_fatura', 'qr', 'qrCode', 'invoiceNumber', 'saft', 'hash'];
    const fiscalOnDocs = docs.some((d) => FISCAL.some((k) => Object.prototype.hasOwnProperty.call(d, k)));
    const fiscalOnPedidos = pedidos.some((p) => FISCAL.some((k) => Object.prototype.hasOwnProperty.call(p, k)));
    return {
      pedidoCount: pedidos.length,
      pedidoEstado: (pedidos[0]?.estado as string | undefined) ?? null,
      fiscalOnDocs,
      fiscalOnPedidos,
    };
  }, { doc: injected.doc });

  expect(state.pedidoCount, 'a faturacao_pedidos intent row was created').toBe(1);
  expect(state.pedidoEstado, 'the pedido is pending, not emitted').toBe('emissao_pendente');
  expect(state.fiscalOnDocs, 'no documentos row carries fiscal metadata (atcud/qr/número)').toBe(false);
  expect(state.fiscalOnPedidos, 'the pedido row carries no fiscal metadata either').toBe(false);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Finanças: despesa reembolsável aprovada writes a conta_corrente débito (origem despesa)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `SF-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP);
  await ready(page, 'conta-corrente-page');

  const injected = await page.evaluate(async (n) => {
    const s = (window as EkoaWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente ${n}`, nif: '245901238', tipo: 'particular' });
    const p = await s.create('processos', { numeroProcesso: `DP-${n}`, clienteId: cli.id, estado: 'ativo' });
    return { cli: cli.id as string, p: p.id as string };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];

  await page.goto(`${APP}despesas`);
  await ready(page, 'despesas-page');

  // Register a reembolsável despesa (default reembolsável=on) of 150 on the
  // injected processo.
  await page.getByTestId('financas-despesa-nova').click();
  await page.getByTestId('despesa-processo').selectOption(injected.p);
  await page.getByTestId('despesa-descricao').fill(`Taxa de justiça ${nonce}`);
  await page.getByTestId('despesa-valor').fill('150');
  await page.getByTestId('despesa-guardar').click();

  // Find the just-created despesa id, then approve it via its row action.
  const despesaId = await page.evaluate(async ({ n, cli }) => {
    const s = (window as EkoaWindow).__ekoa!.shared!;
    const d = (await s.list('despesas')).find((x) => x.clienteId === cli && typeof x.descricao === 'string' && x.descricao.includes(n));
    return d ? (d.id as string) : null;
  }, { n: nonce, cli: injected.cli });
  expect(despesaId, 'the despesa was registered').not.toBeNull();

  await page.getByTestId(`despesa-aprovar-${despesaId}`).click();
  await expect(page.getByTestId(`despesa-estado-${despesaId}`)).toContainText('Aprovada', { timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/despesa-aprovada.png`, fullPage: true });

  const debito = await page.evaluate(async ({ cli }) => {
    const s = (window as EkoaWindow).__ekoa!.shared!;
    const rows = (await s.list('conta_corrente')).filter((m) => m.clienteId === cli && m.tipo === 'debito' && m.origem === 'despesa');
    return { count: rows.length, valor: (rows[0]?.valor as number | undefined) ?? null };
  }, { cli: injected.cli });

  expect(debito.count, 'a conta_corrente débito origem=despesa was written on approval').toBe(1);
  expect(debito.valor).toBe(150);

  // The ledger on the conta corrente page reflects the new débito.
  await page.goto(APP);
  await ready(page, 'conta-corrente-page');
  await page.getByTestId('cc-cliente').selectOption(injected.cli);
  await expect(page.getByTestId('financas-saldo')).toContainText('150,00');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Finanças: provisão marcada recebida writes a conta_corrente crédito (origem pagamento)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `SF-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP);
  await ready(page, 'conta-corrente-page');

  const injected = await page.evaluate(async (n) => {
    const s = (window as EkoaWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente ${n}`, nif: '234567891', tipo: 'particular' });
    return { cli: cli.id as string };
  }, nonce);
  ctx.clienteIds = [injected.cli];

  await page.goto(`${APP}provisoes`);
  await ready(page, 'provisoes-page');

  // Ask for a 500 provisão on the injected cliente.
  await page.getByTestId('financas-provisao-nova').click();
  await page.getByTestId('provisao-cliente').selectOption(injected.cli);
  await page.getByTestId('provisao-valor').fill('500');
  await page.getByTestId('provisao-guardar').click();

  const provisaoId = await page.evaluate(async ({ cli }) => {
    const s = (window as EkoaWindow).__ekoa!.shared!;
    const p = (await s.list('provisoes')).find((x) => x.clienteId === cli && x.estado === 'pedida');
    return p ? (p.id as string) : null;
  }, { cli: injected.cli });
  expect(provisaoId, 'the provisão was requested').not.toBeNull();

  await page.getByTestId(`provisao-receber-${provisaoId}`).click();
  await expect(page.getByTestId(`provisao-estado-${provisaoId}`)).toContainText('Recebida', { timeout: 15_000 });
  await expect(page.getByTestId(`provisao-saldo-${provisaoId}`)).toContainText('500,00');

  await page.screenshot({ path: `${SHOTS}/provisao-recebida.png`, fullPage: true });

  const credito = await page.evaluate(async ({ cli }) => {
    const s = (window as EkoaWindow).__ekoa!.shared!;
    const rows = (await s.list('conta_corrente')).filter((m) => m.clienteId === cli && m.tipo === 'credito' && m.origem === 'pagamento');
    return { count: rows.length, valor: (rows[0]?.valor as number | undefined) ?? null };
  }, { cli: injected.cli });

  expect(credito.count, 'a conta_corrente crédito origem=pagamento was written on receipt').toBe(1);
  expect(credito.valor).toBe(500);

  // The credit shows on the conta corrente page.
  await page.goto(APP);
  await ready(page, 'conta-corrente-page');
  await page.getByTestId('cc-cliente').selectOption(injected.cli);
  await expect(page.getByTestId('cc-creditos')).toContainText('500,00');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
