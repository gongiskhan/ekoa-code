import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-apoio — Apoio Judiciário (SADT / SinOA) over the SHARED spine. Covered
 * end-to-end through the served app (cortex at /apps/legal-apoio/):
 *
 *  1. Pedidos renders the seeded pedido (Sofia Rebelo Nunes, nomeação) with the
 *     honest SinOA disclaimer and zero pageerrors.
 *  2. GOLDEN THROUGH THE UI: a novo pedido, then "Registar notificação" with a
 *     FIXED date (2026-09-07, a Monday outside férias judiciais) generates the
 *     two SinOA prazos via the vendored deadline engine. The two data-limites
 *     shown in the panel equal the dates persisted to `prazos` (origem 'apoio'),
 *     and clicking "Registar notificação" a second time does NOT duplicate them
 *     (idempotency guard).
 *  3. A despesa linked to a correio row that has an archived comprovativo renders
 *     that carta's registo reference.
 *  4. The estado transition to "submetido (manual)" shows the manual-only copy
 *     and performs NO network write beyond the shared-data row update (the SinOA
 *     has no API — this app never pretends to submit).
 *  5. The generated prazos surface in legal-prazos (the tagged descrição renders
 *     in "Todos os prazos").
 *
 * Deterministic + self-cleaning: every pedido/correio row this spec creates is
 * tracked by id (or a run nonce), and afterEach deletes them plus every prazo it
 * generated (origem 'apoio'). The seeded pedido, seeded correio and seeded
 * prazos are NEVER touched.
 */
const APP = legalAppUrl('legal-apoio');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'legal-apoio');
mkdirSync(SHOTS, { recursive: true });

// A Monday outside férias judiciais — 5 dias úteis lands on 2026-09-14 and 30
// dias corridos on 2026-10-07 (pinned by the engine's own golden unit tests).
const NOTIF_DATE = '2026-09-07';
const EXPECTED_DL_5UTEIS = '2026-09-14';
const EXPECTED_DL_30DIAS = '2026-10-07';
const DESC_5UTEIS = 'SinOA: registo do pedido (5 dias úteis)';
const DESC_30DIAS = 'SinOA: documentação (30 dias)';

type Ctx = { nonce: string; pedidoIds: string[]; correioIds: string[]; docIds: string[] };
const ctx: Ctx = { nonce: '', pedidoIds: [], correioIds: [], docIds: [] };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __ekoa?: { shared?: unknown } }).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/* Opens the Núcleo once (it, and only it, seeds the spine) and waits until the
 * shared clientes + apoio_judiciario collections are populated — so the
 * satellite reads a seeded spine regardless of prior state. Idempotent. */
async function ensureSeeded(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.waitForFunction(async () => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<unknown[]> } } }).__ekoa.shared;
    const [clientes, pedidos] = await Promise.all([s.list('clientes'), s.list('apoio_judiciario')]);
    return Array.isArray(clientes) && clientes.length >= 6 && Array.isArray(pedidos) && pedidos.length >= 1;
  }, undefined, { timeout: 30_000 });
}

/* Reads a shared collection from inside the served app. */
async function listShared(page: Page, collection: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(async (col) => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } }).__ekoa.shared;
    return s.list(col);
  }, collection);
}

/* Injects a tagged apoio pedido em preparação for a non-seeded flow, returns its id. */
async function injectPedido(page: Page, nonce: string, patch: Record<string, unknown> = {}): Promise<string> {
  const id = await page.evaluate(async ({ n, p }) => {
    const s = (window as unknown as { __ekoa: { shared: {
      list: (c: string) => Promise<Array<Record<string, unknown>>>;
      create: (c: string, d: unknown) => Promise<{ id: string }>;
    } } }).__ekoa.shared;
    const clientes = await s.list('clientes');
    const cli = clientes[0] || {};
    const row = await s.create('apoio_judiciario', {
      clienteId: cli.id,
      tipoPedido: 'proteccao_juridica',
      estado: 'preparacao',
      datas: { pedido: '2026-07-01' },
      prazosGerados: [],
      honorarios: { fase: 'inicial', despesas: [] },
      __apoioTest: n,
      ...p,
    });
    return row.id;
  }, { n: nonce, p: patch });
  ctx.pedidoIds.push(id);
  return id;
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ pedidoIds, correioIds, docIds, nonce }) => {
      const s = (window as unknown as { __ekoa?: { shared?: {
        list: (c: string) => Promise<Array<Record<string, unknown>>>;
        get: (c: string, id: string) => Promise<Record<string, unknown> | null>;
        delete: (c: string, id: string) => Promise<unknown>;
      } } }).__ekoa?.shared;
      if (!s) return;
      const del = async (col: string, id: unknown) => {
        if (typeof id === 'string' && id) { try { await s.delete(col, id); } catch { /* ignore */ } }
      };
      // Delete the prazos each tracked pedido generated, then the pedido.
      const ids = new Set(pedidoIds);
      // Nonce sweep for pedidos created through the UI (untagged) or tagged.
      let pedidos: Array<Record<string, unknown>> = [];
      try { pedidos = await s.list('apoio_judiciario'); } catch { pedidos = []; }
      for (const p of pedidos) {
        if (p.__apoioTest === nonce) ids.add(p.id as string);
      }
      for (const id of ids) {
        const row = await s.get('apoio_judiciario', id);
        const gerados = row && Array.isArray(row.prazosGerados) ? (row.prazosGerados as string[]) : [];
        for (const pid of gerados) await del('prazos', pid);
        await del('apoio_judiciario', id);
      }
      // Backstop: any lingering prazo with origem 'apoio' (only this app writes them;
      // the seed has none), so a crashed run never leaves an 'apoio' prazo behind.
      let prazos: Array<Record<string, unknown>> = [];
      try { prazos = await s.list('prazos'); } catch { prazos = []; }
      for (const pz of prazos) {
        if (pz.origem === 'apoio') await del('prazos', pz.id);
      }
      for (const id of docIds) await del('documentos', id);
      for (const id of correioIds) await del('correio', id);
    }, ctx);
  } catch { /* page may be gone — ignore */ }
  ctx.pedidoIds = [];
  ctx.correioIds = [];
  ctx.docIds = [];
});

test('Apoio: os pedidos mostram o pedido semeado e o aviso do SinOA, sem erros', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `APOIO-${Date.now()}`;

  await ensureSeeded(page);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pedidos-page')).toBeVisible({ timeout: 20_000 });

  // The honest disclaimer is always present, with the fixed copy.
  await expect(page.getByTestId('apoio-disclaimer'))
    .toContainText('A submissão é feita pelo advogado no SinOA');

  // The seeded pedido (Sofia Rebelo Nunes) renders in the table.
  const tabela = page.getByTestId('apoio-pedidos-tabela');
  await expect(tabela.getByText('Sofia Rebelo Nunes', { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/pedidos.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Apoio: golden pela UI — registar notificação gera os 2 prazos SinOA e não duplica', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `APOIO-${Date.now()}`;

  await ensureSeeded(page);

  // Novo pedido através da UI.
  await page.goto(`${APP}novo`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('novo-pedido-page')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('apoio-cliente').selectOption({ label: 'Marília Costa' });
  await page.getByTestId('apoio-tipo').selectOption('proteccao_juridica');
  await page.getByTestId('apoio-data').fill('2026-07-02');
  await page.getByTestId('apoio-criar').click();

  // Lands on the detail page; capture the created pedido id (tracked for teardown).
  await page.waitForURL(/\/pedido\//, { timeout: 20_000 });
  const pedidoId = page.url().match(/\/pedido\/([^/?#]+)/)?.[1] as string;
  expect(pedidoId, 'pedido id in URL').toBeTruthy();
  ctx.pedidoIds.push(pedidoId);
  await expect(page.getByTestId('pedido-detail')).toBeVisible({ timeout: 15_000 });

  // Registar a notificação da decisão com a data FIXA -> gera os 2 prazos.
  await page.getByTestId('apoio-notif-data').fill(NOTIF_DATE);
  await page.getByTestId('apoio-notif-registar').click();

  // O painel mostra as duas data-limites do motor.
  const panel = page.getByTestId('apoio-prazos');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  const dl0 = (await page.getByTestId('apoio-prazo-datalimite-0').textContent())?.trim();
  const dl1 = (await page.getByTestId('apoio-prazo-datalimite-1').textContent())?.trim();
  expect(dl0).toBe(EXPECTED_DL_5UTEIS);
  expect(dl1).toBe(EXPECTED_DL_30DIAS);
  await expect(page.getByTestId('apoio-prazo-desc-0')).toHaveText(DESC_5UTEIS);
  await expect(page.getByTestId('apoio-prazo-desc-1')).toHaveText(DESC_30DIAS);

  // Os prazos persistidos (origem 'apoio') têm EXACTAMENTE as datas mostradas.
  const prazosApoio = (await listShared(page, 'prazos')).filter((p) => p.origem === 'apoio');
  expect(prazosApoio).toHaveLength(2);
  const byDesc = new Map(prazosApoio.map((p) => [String(p.descricao), p]));
  expect(byDesc.get(DESC_5UTEIS)?.dataLimite).toBe(dl0);
  expect(byDesc.get(DESC_30DIAS)?.dataLimite).toBe(dl1);

  // O pedido guarda os dois ids gerados e a data da notificação.
  const pedidoRow = (await listShared(page, 'apoio_judiciario')).find((p) => p.id === pedidoId) as Record<string, unknown>;
  expect((pedidoRow.prazosGerados as string[]).length).toBe(2);
  expect((pedidoRow.datas as Record<string, unknown>).notificacao).toBe(NOTIF_DATE);

  // IDEMPOTÊNCIA: registar de novo NÃO duplica.
  await page.getByTestId('apoio-notif-registar').click();
  await expect(page.getByTestId('apoio-notif-registada')).toBeVisible();
  const prazosDepois = (await listShared(page, 'prazos')).filter((p) => p.origem === 'apoio');
  expect(prazosDepois, 'sem duplicação após segundo registo').toHaveLength(2);

  await page.screenshot({ path: `${SHOTS}/prazos-sinoa.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Apoio: despesa com comprovativo de correio mostra a referência de registo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `APOIO-${Date.now()}`;

  await ensureSeeded(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  // Inject a delivered registered letter whose comprovativo is archived (a
  // documentos row), plus a tagged pedido em preparação to receive the despesa.
  const registoRef = 'RR900000042PT';
  const { correioId, docId, pedidoId } = await page.evaluate(async ({ ref, n }) => {
    const s = (window as unknown as { __ekoa: { shared: {
      list: (c: string) => Promise<Array<Record<string, unknown>>>;
      create: (c: string, d: unknown) => Promise<{ id: string }>;
    } } }).__ekoa.shared;
    const clientes = await s.list('clientes');
    const cli = clientes[0] || {};
    const doc = await s.create('documentos', {
      nome: `Comprovativo ${ref}`, tipo: 'pdf', origem: 'legal-correio', clienteId: cli.id, data: '2026-06-20', versao: 1, __apoioTest: n,
    });
    const carta = await s.create('correio', {
      tipo: 'registado_ar',
      destinatario: { nome: 'Tribunal de teste', morada: 'Rua de Teste, 1' },
      conteudoDescricao: `Comprovativo apoio ${n}`,
      estado: 'entregue',
      registoRef: ref,
      comprovativoDocumentoId: doc.id,
      datas: { expedido: '2026-06-18', entregue: '2026-06-20' },
    });
    const pedido = await s.create('apoio_judiciario', {
      clienteId: cli.id, tipoPedido: 'proteccao_juridica', estado: 'preparacao',
      datas: { pedido: '2026-07-01' }, prazosGerados: [], honorarios: { fase: 'inicial', despesas: [] }, __apoioTest: n,
    });
    return { correioId: carta.id, docId: doc.id, pedidoId: pedido.id };
  }, { ref: registoRef, n: ctx.nonce });
  ctx.correioIds.push(correioId);
  ctx.docIds.push(docId);
  ctx.pedidoIds.push(pedidoId);

  await page.goto(`${APP}pedido/${pedidoId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pedido-detail')).toBeVisible({ timeout: 15_000 });

  // Add a despesa linked to the archived comprovativo.
  await page.getByTestId('apoio-despesa-descricao').fill('Certidão permanente');
  await page.getByTestId('apoio-despesa-valor').fill('25');
  await page.getByTestId('apoio-despesa-correio').selectOption({ value: correioId });
  await page.getByTestId('apoio-despesa-add').click();

  // The despesa line renders and shows the carta's registo reference.
  await expect(page.getByTestId('apoio-despesa-0')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('apoio-despesa-comprovativo-0')).toContainText(registoRef);

  // Persisted with the denormalised registoRef.
  const pedidoRow = (await listShared(page, 'apoio_judiciario')).find((p) => p.id === pedidoId) as Record<string, unknown>;
  const despesas = (pedidoRow.honorarios as Record<string, unknown>).despesas as Array<Record<string, unknown>>;
  expect(despesas).toHaveLength(1);
  expect(despesas[0].registoRef).toBe(registoRef);
  expect(despesas[0].correioId).toBe(correioId);

  await page.screenshot({ path: `${SHOTS}/despesa-comprovativo.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Apoio: submeter é manual — mostra a cópia e não escreve fora do dado partilhado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `APOIO-${Date.now()}`;

  await ensureSeeded(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  const pedidoId = await injectPedido(page, ctx.nonce);
  await page.goto(`${APP}pedido/${pedidoId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pedido-detail')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('pedido-estado')).toContainText('Em preparação');

  // Capture every mutating request the "Submeter" action fires.
  const writes: string[] = [];
  const onReq = (r: import('@playwright/test').Request) => {
    const m = r.method();
    if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') writes.push(`${m} ${r.url()}`);
  };
  page.on('request', onReq);
  await page.getByTestId('apoio-submeter').click();
  await expect(page.getByTestId('pedido-estado')).toContainText('Submetido (manual)', { timeout: 15_000 });
  page.off('request', onReq);

  // The only writes are the shared-data row update — no external submit.
  expect(writes.length, `writes: ${writes.join(' | ')}`).toBeGreaterThan(0);
  for (const w of writes) {
    expect(w, `unexpected non-shared-data write: ${w}`).toMatch(/\/api\/app-(shared|data)\//);
  }

  // The manual-only copy is shown, and submetido_manual stamps NOTHING else.
  await expect(page.getByTestId('apoio-disclaimer'))
    .toContainText('A submissão é feita pelo advogado no SinOA');
  const row = (await listShared(page, 'apoio_judiciario')).find((p) => p.id === pedidoId) as Record<string, unknown>;
  expect(row.estado).toBe('submetido_manual');
  expect((row.datas as Record<string, unknown>).decisao).toBeUndefined();

  await page.screenshot({ path: `${SHOTS}/submetido-manual.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Apoio: os prazos gerados aparecem em legal-prazos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `APOIO-${Date.now()}`;

  await ensureSeeded(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  const pedidoId = await injectPedido(page, ctx.nonce);
  await page.goto(`${APP}pedido/${pedidoId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pedido-detail')).toBeVisible({ timeout: 15_000 });

  // Gera os prazos com a data fixa.
  await page.getByTestId('apoio-notif-data').fill(NOTIF_DATE);
  await page.getByTestId('apoio-notif-registar').click();
  await expect(page.getByTestId('apoio-prazos')).toBeVisible({ timeout: 15_000 });

  // Em legal-prazos, na lista completa (o radar só mostra o curto prazo; a data
  // fixa de 2026-09 cai fora da janela de 30 dias, logo aparece em "Todos os
  // prazos"). A descrição tagged do prazo SinOA renderiza.
  await page.goto(legalAppUrl('legal-prazos', 'prazos'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('prazos-list-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(DESC_5UTEIS, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(DESC_30DIAS, { exact: false }).first()).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/prazos-radar.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
