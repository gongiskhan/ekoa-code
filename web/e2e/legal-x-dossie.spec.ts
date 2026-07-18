import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-dossie - S5 featured-artifact layer of the Dossie over the SHARED spine.
 *
 * The frozen legal-dossie.spec.ts already pins the print-to-PDF compile tab
 * (data-testid="guardar-pdf" -> window.print). This spec covers the NEW,
 * additive one-click full-dossier export that goes through the platform's
 * exportPdf({ html, filename }) seam instead of the browser print dialog:
 *
 *  1. The Dossie tab exposes a "Dossie completo (PDF)" button (dossie-pdf) that
 *     builds an autonomous HTML document from the spine slices of THIS processo
 *     and hands it to window.__ekoa.exportPdf. We stub exportPdf to capture the
 *     payload and assert the document carries a cover (numero/cliente/counts), a
 *     CRONOLOGIA section, and an INDICE DE DOCUMENTOS - the "impressao de um
 *     clique" the acceptance calls for.
 *  2. The captured cronologia is asserted to be in ASCENDING chronological order
 *     (oldest first) - the deterministic reading order of the processo's history.
 *  3. Document upload writes a real ficheiro block AND a previewable row (the
 *     uploadFile-with-preview path), and the uploaded document then appears in
 *     the exported dossier's document index.
 *
 * Deterministic + self-cleaning: seeds a dedicated processo per run with a
 * per-run nonce, cleans up every spine row (and uploaded blob) it created.
 */
const APP = legalAppUrl('legal-dossie');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-dossie');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  get(collection: string, id: string): Promise<Row | null>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = {
  __ekoa?: { shared?: SharedApi; deleteFile?: (id: string) => Promise<unknown> };
  __EKOA_APP_ID?: string;
};

function makePdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n');
}

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 30_000 },
  );
}

interface SeedIds { clienteId: string; processoId: string; numero: string; nonce: string }

/*
 * Seeds a processo with a cliente, two eventos deliberately created OUT of
 * chronological order (the later one first), and one prazo. The out-of-order
 * insertion is what makes the ascending-ordering assertion meaningful.
 */
async function seedProcesso(page: Page, nonce: string): Promise<SeedIds> {
  return page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const numero = `9500/${Date.now() % 10000}.0T8XDS`;
    const cli = await s.create('clientes', {
      nome: `Cliente Dossie X ${n}`,
      nif: '299000010',
      tipo: 'particular',
      email: `xdossie-${n}@e2e.pt`,
    });
    const prc = await s.create('processos', {
      numeroProcesso: numero,
      tribunal: 'Juizo E2E de Lisboa',
      comarca: 'Lisboa',
      area: 'Civel',
      estado: 'ativo',
      advogadoResponsavel: 'Dra. Teste',
      clienteId: cli.id,
      xnonce: n,
    });
    // Deliberately created later-date first, so a naive "insertion order" would
    // be DESCENDING; the exporter must re-sort to ASCENDING.
    await s.create('eventos', {
      processoId: prc.id, titulo: `Sentenca ${n}`, data: '2026-05-20', tipo: 'sentenca', origem: 'manual', xnonce: n,
    });
    await s.create('eventos', {
      processoId: prc.id, titulo: `Citacao ${n}`, data: '2026-01-10', tipo: 'juntada', origem: 'manual', xnonce: n,
    });
    await s.create('prazos', {
      processoId: prc.id, titulo: `Contestacao ${n}`, dataLimite: '2026-02-10', estado: 'pendente', origem: 'manual', xnonce: n,
    });
    // One honorarios lancamento so the export can prove the Honorarios section
    // reaches the PDF (the full dossier is never a subset of the on-screen tab).
    await s.create('lancamentos', {
      processoId: prc.id, descricao: `Reuniao ${n}`, valor: 250, faturado: false, xnonce: n,
    });
    return { clienteId: String(cli.id), processoId: String(prc.id), numero, nonce: n };
  }, nonce);
}

async function cleanup(page: Page, ids: SeedIds | null) {
  if (!ids) return;
  try {
    await page.evaluate(async (ids) => {
      const w = window as unknown as SharedWindow;
      const s = w.__ekoa?.shared;
      if (!s) return;
      const safeDel = async (col: string, id: unknown) => { try { await s.delete(col, String(id)); } catch { /* ignore */ } };
      for (const col of ['eventos', 'prazos', 'comunicacoes', 'lancamentos']) {
        for (const r of await s.list(col)) if (r.processoId === ids.processoId) await safeDel(col, r.id);
      }
      for (const d of await s.list('documentos')) {
        if (d.processoId === ids.processoId) {
          const f = (d.ficheiro || {}) as Row;
          if (f.fileId && f.appId === w.__EKOA_APP_ID && typeof w.__ekoa?.deleteFile === 'function') {
            try { await w.__ekoa.deleteFile(String(f.fileId)); } catch { /* ignore */ }
          }
          await safeDel('documentos', d.id);
        }
      }
      await safeDel('processos', ids.processoId);
      await safeDel('clientes', ids.clienteId);
    }, ids);
  } catch { /* best-effort */ }
}

/* Installs a stub for window.__ekoa.exportPdf that records every payload it
 * receives on window.__exported, so the test can inspect the generated HTML. */
async function stubExportPdf(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __ekoa: Record<string, unknown>; __exported: unknown[] };
    w.__exported = [];
    w.__ekoa.exportPdf = async (payload: unknown) => {
      w.__exported.push(payload);
      return { ok: true };
    };
  });
}

let ids: SeedIds | null = null;

test.afterEach(async ({ page }) => {
  await cleanup(page, ids);
  ids = null;
});

test('Dossie: exportacao de um clique produz capa + cronologia ascendente + indice de documentos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const nonce = `XD1-${Date.now()}`;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  ids = await seedProcesso(page, nonce);

  await page.goto(`${APP}processo/${ids.processoId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });
  await stubExportPdf(page);

  // Open the Dossie (print) tab where the one-click export lives.
  await page.getByTestId('tab-print').click();
  const botao = page.getByTestId('dossie-pdf');
  await expect(botao).toBeVisible({ timeout: 15_000 });
  await botao.click();

  // exportPdf received exactly one autonomous HTML document with a filename.
  const payload = await page.evaluate(() => {
    const arr = (window as unknown as { __exported: Array<{ html?: string; filename?: string; format?: string }> }).__exported;
    return arr && arr.length ? arr[arr.length - 1] : null;
  });
  expect(payload, 'exportPdf was called with a payload').not.toBeNull();
  const html = String(payload!.html || '');
  expect(payload!.filename, 'filename derives from the processo number').toContain('dossie-');
  expect(html).toContain('<!DOCTYPE html>');

  // Cover: processo number, cliente, and the CRONOLOGIA + document index sections.
  expect(html).toContain(ids.numero);
  expect(html).toContain(`Cliente Dossie X ${nonce}`);
  expect(html).toMatch(/Cronologia do processo/i);
  expect(html).toMatch(/Indice de documentos|Índice de documentos/i);

  // The export mirrors EVERY on-screen dossier section - honorarios included
  // (a strict-subset export was a real bug: the section silently dropped).
  expect(html).toMatch(/Honorários \(resumo\)|Honorarios \(resumo\)/);
  expect(html, 'seeded lancamento total reaches the PDF').toMatch(/250,00/);
  expect(html).toContain('Por faturar');

  // Ascending order: the older "Citacao" event must appear BEFORE the newer
  // "Sentenca" event in the compiled HTML (oldest first).
  const posCitacao = html.indexOf(`Citacao ${nonce}`);
  const posSentenca = html.indexOf(`Sentenca ${nonce}`);
  expect(posCitacao, 'citacao present').toBeGreaterThan(-1);
  expect(posSentenca, 'sentenca present').toBeGreaterThan(-1);
  expect(posCitacao, 'cronologia is ascending (oldest event first)').toBeLessThan(posSentenca);

  await page.screenshot({ path: `${SHOTS}/export.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Dossie: documento carregado ganha bloco ficheiro previsualizavel e entra no indice do PDF', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const nonce = `XD2-${Date.now()}`;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  ids = await seedProcesso(page, nonce);

  await page.goto(`${APP}processo/${ids.processoId}?tab=documentos`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });

  const nomeFicheiro = `prova-x-${nonce}.pdf`;
  await page.getByTestId('upload-input').setInputFiles({
    name: nomeFicheiro,
    mimeType: 'application/pdf',
    buffer: makePdf(),
  });

  const list = page.getByTestId('documentos-list');
  await expect(list.getByText(nomeFicheiro)).toBeVisible({ timeout: 15_000 });
  // A real ficheiro block: a download link to the app-files url and a preview toggle.
  await expect(list.getByTestId('doc-download').first()).toHaveAttribute('href', /\/api\/app-files\/legal-dossie\//);
  await expect(list.getByTestId('doc-preview-toggle').first()).toBeVisible();

  // The uploaded document persisted on the spine with a ficheiro block.
  const ficheiro = await page.evaluate(async (nome) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const docs = await s.list('documentos');
    const d = docs.find((x) => x.nome === nome);
    return d ? (d.ficheiro as Row) : null;
  }, nomeFicheiro);
  expect(ficheiro?.fileId).toBeTruthy();
  expect(ficheiro?.appId).toBe('legal-dossie');

  // Now the one-click export must include this document in its index.
  await stubExportPdf(page);
  await page.getByTestId('tab-print').click();
  await page.getByTestId('dossie-pdf').click();
  const html = await page.evaluate(() => {
    const arr = (window as unknown as { __exported: Array<{ html?: string }> }).__exported;
    return arr && arr.length ? String(arr[arr.length - 1].html || '') : '';
  });
  expect(html).toContain(nomeFicheiro);

  await page.screenshot({ path: `${SHOTS}/upload-index.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
