import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-correio — Correio e Notificações: registered-mail tracking over the
 * SHARED spine. Covered end-to-end through the served app (cortex at
 * /apps/legal-correio/):
 *  1. Expediente renders the 2 seeded correio rows, with zero pageerrors.
 *  2. Nova carta flow: register a carta for the seeded cliente Sofia Rebelo
 *     Nunes -> rascunho row with an RR…PT reference -> "Marcar expedido" stamps
 *     datas.expedido -> in the Expediente, "Marcar entregue" flips the estado
 *     badge and stamps datas.entregue (asserted via the shared collection).
 *  3. Comprovativo: attach a small generated file to an expedido carta that has
 *     a processoId -> a `documentos` row with origem 'legal-correio' is created,
 *     linked back via comprovativoDocumentoId, AND visible in the dossiê of that
 *     processo.
 *  4. "Consultar tracking" on a seeded row shows the graceful indisponível state
 *     (this machine has no CTT provider configured), with zero pageerrors.
 *
 * Deterministic + self-cleaning: every row this spec creates carries the run
 * nonce (correio.conteudoDescricao) or is tracked by id, and afterEach deletes
 * the tracked correio + documentos rows. Seeded rows are never deleted.
 */
const APP = legalAppUrl('legal-correio');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'legal-correio');
mkdirSync(SHOTS, { recursive: true });

const SEEDED_REFS = ['RR123456785PT', 'RR223344556PT'];

type Ctx = { nonce: string; correioIds: string[]; docIds: string[] };
const ctx: Ctx = { nonce: '', correioIds: [], docIds: [] };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __ekoa?: { shared?: unknown } }).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/* Opens the Núcleo once (it, and only it, seeds the spine) and waits until the
 * shared `correio` collection holds its 2 seeded rows — so the satellite reads a
 * seeded spine regardless of prior state. Idempotent (seedSpine no-ops when the
 * spine already exists). */
async function ensureSeeded(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.waitForFunction(async () => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<unknown[]> } } }).__ekoa.shared;
    const rows = await s.list('correio');
    return Array.isArray(rows) && rows.length >= 2;
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
    await page.evaluate(async ({ correioIds, docIds, nonce }) => {
      const s = (window as unknown as { __ekoa?: { shared?: { list: (c: string) => Promise<Array<Record<string, unknown>>>; delete: (c: string, id: string) => Promise<unknown> } } }).__ekoa?.shared;
      if (!s) return;
      const del = async (col: string, id: unknown) => {
        if (typeof id === 'string' && id) { try { await s.delete(col, id); } catch { /* ignore */ } }
      };
      for (const id of docIds) await del('documentos', id);
      for (const id of correioIds) await del('correio', id);
      // Nonce sweep: correio rows tagged in the description, plus any documentos
      // whose comprovativo name references a tagged carta (best-effort).
      let correio: Array<Record<string, unknown>> = [];
      try { correio = await s.list('correio'); } catch { correio = []; }
      for (const r of correio) {
        if (typeof r.conteudoDescricao === 'string' && r.conteudoDescricao.includes(nonce)) {
          await del('documentos', r.comprovativoDocumentoId);
          await del('correio', r.id);
        }
      }
    }, ctx);
  } catch { /* page may be gone — ignore */ }
  ctx.correioIds = [];
  ctx.docIds = [];
});

test('Correio: o expediente mostra as 2 cartas semeadas, sem erros de página', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `CORREIO-${Date.now()}`;

  await ensureSeeded(page);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('correio-expediente-page')).toBeVisible({ timeout: 20_000 });

  // The two seeded references are rendered, and the destinatários are present.
  for (const ref of SEEDED_REFS) {
    await expect(page.getByText(ref, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.getByText('Tribunal Judicial da Comarca de Lisboa', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Construções Horizonte', { exact: false }).first()).toBeVisible();

  // At least the two seeded rows (never fewer).
  expect(await page.locator('[data-testid^="correio-estado-"]').count()).toBeGreaterThanOrEqual(2);

  await page.screenshot({ path: `${SHOTS}/expediente.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Correio: registar uma carta, marcar expedido e depois entregue atualiza o estado e as datas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `CORREIO-${Date.now()}`;
  const conteudo = `Notificação de teste ${ctx.nonce}`;

  await ensureSeeded(page);

  await page.goto(`${APP}nova`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('correio-nova-page')).toBeVisible({ timeout: 20_000 });

  // Pick the seeded cliente (prefills the destinatário) and describe the content.
  await page.getByTestId('correio-nova-cliente').selectOption({ label: 'Sofia Rebelo Nunes' });
  await expect(page.getByTestId('correio-nova-nome')).toHaveValue('Sofia Rebelo Nunes');
  await page.getByTestId('correio-nova-conteudo').fill(conteudo);
  await page.getByTestId('correio-registar').click();

  // The generated reference panel appears with an RR…PT reference.
  await expect(page.getByTestId('correio-ref')).toBeVisible({ timeout: 15_000 });
  const ref = (await page.getByTestId('correio-ref-valor').textContent())?.trim() || '';
  expect(ref).toMatch(/^RR\d{9}PT$/);
  await expect(page.getByTestId('correio-ref-estado')).toHaveText('Rascunho');

  // Capture the created carta id (tracked for teardown).
  const created = (await listShared(page, 'correio')).find((r) => r.conteudoDescricao === conteudo);
  expect(created, 'the registada carta was persisted').toBeTruthy();
  const correioId = created!.id as string;
  ctx.correioIds.push(correioId);

  // Marcar expedido -> estado + datas.expedido.
  await page.getByTestId('correio-marcar-expedido').click();
  await expect(page.getByTestId('correio-ref-estado')).toHaveText('Expedido', { timeout: 15_000 });

  // Over in the Expediente, marcar entregue.
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('correio-expediente-page')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`correio-entregue-${correioId}`).click();
  await expect(page.getByTestId(`correio-estado-${correioId}`)).toHaveText('Entregue', { timeout: 15_000 });

  // The persisted row carries both stamped dates and the final estado.
  const row = (await listShared(page, 'correio')).find((r) => r.id === correioId) as Record<string, unknown> | undefined;
  expect(row, 'carta still present').toBeTruthy();
  expect(row!.estado).toBe('entregue');
  const datas = row!.datas as Record<string, unknown>;
  expect(typeof datas.expedido).toBe('string');
  expect(typeof datas.entregue).toBe('string');

  await page.screenshot({ path: `${SHOTS}/expedido-entregue.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Correio: anexar comprovativo cria um documento origem legal-correio, ligado e visível no dossiê', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `CORREIO-${Date.now()}`;
  const conteudo = `Carta com comprovativo ${ctx.nonce}`;

  await ensureSeeded(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('correio-expediente-page')).toBeVisible({ timeout: 20_000 });

  // Inject an expedido carta bound to a real seeded processo (so the dossiê link
  // resolves), tagged for teardown.
  const { correioId, processoId } = await page.evaluate(async (desc) => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>>; create: (c: string, d: unknown) => Promise<{ id: string }> } } }).__ekoa.shared;
    const processos = await s.list('processos');
    const p = processos[0] || {};
    const row = await s.create('correio', {
      tipo: 'registado',
      destinatario: { nome: 'Destinatário de teste', morada: 'Rua de Teste, 1' },
      conteudoDescricao: desc,
      estado: 'expedido',
      registoRef: 'RR900000001PT',
      custoEstimado: 3.05,
      datas: { expedido: new Date().toISOString().slice(0, 10) },
      processoId: p.id,
      ...(p.clienteId ? { clienteId: p.clienteId } : {}),
    });
    return { correioId: row.id, processoId: p.id as string };
  }, conteudo);
  ctx.correioIds.push(correioId);
  expect(processoId, 'a seeded processo exists to bind the carta').toBeTruthy();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('correio-expediente-page')).toBeVisible({ timeout: 20_000 });

  // Attach a small generated file via the native chooser (the button sets the
  // target row, then opens the hidden input).
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId(`correio-comprovativo-${correioId}`).click(),
  ]);
  await chooser.setFiles({
    name: 'comprovativo-teste.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% comprovativo de teste legal-correio\n'),
  });

  // The carta gains a comprovativoDocumentoId pointing at a legal-correio doc.
  await expect.poll(async () => {
    const row = (await listShared(page, 'correio')).find((r) => r.id === correioId) as Record<string, unknown> | undefined;
    return row && typeof row.comprovativoDocumentoId === 'string' ? 'linked' : 'pending';
  }, { timeout: 20_000 }).toBe('linked');

  const carta = (await listShared(page, 'correio')).find((r) => r.id === correioId) as Record<string, unknown>;
  const docId = carta.comprovativoDocumentoId as string;
  ctx.docIds.push(docId);

  const doc = (await listShared(page, 'documentos')).find((d) => d.id === docId) as Record<string, unknown> | undefined;
  expect(doc, 'comprovativo documento created').toBeTruthy();
  expect(doc!.origem).toBe('legal-correio');
  expect(doc!.processoId).toBe(processoId);
  expect(String(doc!.nome)).toContain('Comprovativo');

  // Visible in the dossiê of that processo (Documentos tab).
  await page.goto(legalAppUrl('legal-dossie', `processo/${processoId}`), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('tab-documentos')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('tab-documentos').click();
  await expect(page.getByTestId('documentos-list').getByText('Comprovativo', { exact: false }).first())
    .toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/comprovativo-dossie.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Correio: consultar tracking mostra o estado indisponível de forma graciosa, sem erros', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `CORREIO-${Date.now()}`;

  await ensureSeeded(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('correio-expediente-page')).toBeVisible({ timeout: 20_000 });

  // Resolve a seeded, already-sent row id (has a "Consultar tracking" action).
  const seededId = await page.evaluate(async (refs) => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } }).__ekoa.shared;
    const rows = await s.list('correio');
    const hit = rows.find((r) => refs.includes(String(r.registoRef)));
    return hit ? (hit.id as string) : null;
  }, SEEDED_REFS);
  expect(seededId, 'a seeded sent carta exists').toBeTruthy();

  await page.getByTestId(`correio-tracking-btn-${seededId}`).click();
  await expect(page.getByTestId('correio-tracking-drawer')).toBeVisible({ timeout: 15_000 });
  // This machine has no CTT provider configured -> graceful indisponível.
  await expect(page.getByTestId('correio-tracking-indisponivel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('correio-tracking-indisponivel'))
    .toContainText('Consulta CTT indisponível');

  await page.screenshot({ path: `${SHOTS}/tracking-indisponivel.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
