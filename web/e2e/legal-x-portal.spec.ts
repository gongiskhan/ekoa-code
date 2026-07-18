/* eslint-disable @typescript-eslint/no-explicit-any -- reaches into the app's injected window.__ekoa bridge (untyped) and drives dynamic shared-collection JSON */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-portal - S7 knowledge-portal hardening of the Portal do Cliente. Sits
 * ALONGSIDE the ported legal-portal.spec.ts (byte-frozen) and proves the S7
 * acceptance additions, all on the UI plane (server authz is out of scope here):
 *
 *  1. EXPLICIT-SHARE-ONLY, PROVEN. Two documents are seeded on the client's
 *     processo; only ONE is shared. The client sees exactly the shared document;
 *     the NON-shared document's name never renders anywhere on the authenticated
 *     surface - not in the doc list, not in the timeline, not in the extrato PDF.
 *  2. CLIENT TIMELINE (cronologia). Once something is shared, the timeline
 *     renders drawn ONLY from resolved visibility; a non-shared item can never
 *     enter it (structural guarantee of construirCronologia).
 *  3. BRANDED EXTRATO PDF. The extrato button posts branded HTML to /api/app-pdf;
 *     the payload carries the office brand and lists ONLY the shared item, never
 *     the non-shared one.
 *
 * Deterministic + self-cleaning: the office-side seed is tagged by timestamp and
 * torn down in afterEach (documentos + uploads + portal rows + processo + cliente
 * + the per-app credential row).
 */
const BASE = legalAppUrl('legal-portal');
const SENHA = 'Cliente!2026';
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'legal-x-portal');
mkdirSync(SHOTS, { recursive: true });

type Seed = {
  suffix: number;
  clienteId: string;
  processoId: string;
  numero: string;
  sharedDocId: string;
  sharedDocNome: string;
  secretDocId: string;
  secretDocNome: string;
  email: string;
  nome: string;
};

/* Seeds a cliente + processo + TWO documents with real files. One will be
 * shared, one will be kept secret (never shared) - the explicit-share proof. */
async function seed(page: Page): Promise<Seed> {
  return page.evaluate(async () => {
    const w = window as unknown as { __ekoa: { shared: any; uploadFile: (f: File) => Promise<any> }; __EKOA_APP_ID: string };
    const s = w.__ekoa.shared;
    const suffix = Date.now();
    const nome = `Cliente PortalX ${suffix}`;
    const cli = await s.create('clientes', {
      nome,
      nif: `28${String(suffix).slice(-7)}`,
      email: `portalx${suffix}@e2e.pt`,
      telefone: '+351 900 000 000',
      tipo: 'particular',
    });
    const numero = `9400/${suffix % 10000}.0T8POR`;
    const prc = await s.create('processos', {
      numeroProcesso: numero,
      tribunal: 'Juízo E2E de Lisboa',
      comarca: 'Lisboa',
      area: 'Cível',
      estado: 'ativo',
      clienteId: cli.id,
    });
    const mkDoc = async (label: string) => {
      const fileNome = `${label}-${suffix}.pdf`;
      const file = new File([new Uint8Array([37, 80, 68, 70])], fileNome, { type: 'application/pdf' });
      const up = await w.__ekoa.uploadFile(file);
      const doc = await s.create('documentos', {
        nome: fileNome,
        tipo: 'pdf',
        origem: 'upload',
        processoId: prc.id,
        clienteId: cli.id,
        data: '2026-07-03',
        ficheiro: { fileId: up.id, appId: w.__EKOA_APP_ID, url: up.url, mime: up.type, size: up.size },
        versao: 1,
      });
      return { id: doc.id as string, nome: doc.nome as string };
    };
    const shared = await mkDoc('partilhado');
    const secret = await mkDoc('SEGREDO-NAO-PARTILHADO');
    return {
      suffix,
      clienteId: cli.id,
      processoId: prc.id,
      numero,
      sharedDocId: shared.id,
      sharedDocNome: shared.nome,
      secretDocId: secret.id,
      secretDocNome: secret.nome,
      email: cli.email,
      nome,
    };
  });
}

async function cleanup(page: Page, ids: Seed | null) {
  if (!ids) return;
  try {
    await page.goto(BASE);
    await page.evaluate(async (ids) => {
      const w = window as unknown as { __ekoa: any; __EKOA_APP_ID: string };
      const s = w.__ekoa.shared;
      const appId = w.__EKOA_APP_ID;
      const docs = await s.list('documentos');
      for (const d of docs) {
        if (d.clienteId === ids.clienteId || d.processoId === ids.processoId) {
          if (d.ficheiro && d.ficheiro.appId === appId && d.ficheiro.fileId) {
            try { await w.__ekoa.deleteFile(d.ficheiro.fileId); } catch { /* ignore */ }
          }
          await s.delete('documentos', d.id);
        }
      }
      for (const coll of ['portal_partilhas', 'portal_acessos', 'comunicacoes', 'eventos']) {
        const rows = await s.list(coll);
        for (const r of rows) if (r.clienteId === ids.clienteId) await s.delete(coll, r.id);
      }
      const procs = await s.list('processos');
      for (const p of procs) if (p.id === ids.processoId || p.clienteId === ids.clienteId) await s.delete('processos', p.id);
      await s.delete('clientes', ids.clienteId);
      const users = await w.__ekoa.list('utilizadores');
      for (const u of users) if (u.clienteId === ids.clienteId) await w.__ekoa.delete('utilizadores', u.id);
    }, ids);
  } catch { /* best effort */ }
}

/* Provisions the client end-to-end via the real invite -> set-password -> login
 * flow, landing on the authenticated client face. */
async function provisionAndSignIn(page: Page, ids: Seed) {
  await page.goto(BASE);
  await expect(page.getByTestId('acessos-page')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('acessos-search').fill(String(ids.suffix));
  await page.getByTestId(`convidar-${ids.clienteId}`).click();
  const link = await page.getByTestId('convite-link').getAttribute('href');
  expect(link, 'o convite gera um link de definição de palavra-passe').toBeTruthy();
  await page.goto(link as string);
  await expect(page.getByTestId('definir-page')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('definir-password').fill(SENHA);
  await page.getByTestId('definir-password2').fill(SENHA);
  await page.getByTestId('definir-submit').click();
  await expect(page.getByTestId('definir-done')).toBeVisible({ timeout: 20_000 });
  await page.goto(`${BASE}cliente`);
  await expect(page.getByTestId('portal-login')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('login-email').fill(ids.email);
  await page.getByTestId('login-password').fill(SENHA);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('portal-autenticado')).toBeVisible({ timeout: 20_000 });
}

/* Shares exactly ONE document (the shared one) with the client, on the office face. */
async function shareOneDoc(page: Page, ids: Seed) {
  await page.goto(`${BASE}partilhas`);
  await expect(page.getByTestId('partilhas-page')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('partilhas-cliente').selectOption(ids.clienteId);
  await page.getByTestId('partilhas-processo').selectOption(ids.processoId);
  await page.getByTestId(`partilhar-doc-${ids.sharedDocId}`).click();
  await expect(page.getByTestId('portal-resumo')).toContainText('1 documento(s)', { timeout: 15_000 });
}

let ids: Seed | null = null;
let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE);
  await expect(page.getByTestId('acessos-page')).toBeVisible({ timeout: 30_000 });
  ids = await seed(page);
  await page.reload();
  await expect(page.getByTestId('acessos-page')).toBeVisible({ timeout: 30_000 });
});

test.afterEach(async ({ page }) => {
  await cleanup(page, ids);
  ids = null;
});

test('Portal X: só o partilhado aparece - cronologia e extrato nunca mostram o documento NÃO partilhado', async ({ page }) => {
  await provisionAndSignIn(page, ids!);

  // Invisible by default: nothing shared yet - neither document appears.
  await expect(page.getByTestId('portal-vazio')).toBeVisible();
  let texto = await page.getByTestId('portal-autenticado').innerText();
  expect(texto, 'documento não partilhado nunca aparece').not.toContain(ids!.secretDocNome);
  expect(texto, 'documento ainda não partilhado não aparece').not.toContain(ids!.sharedDocNome);

  // Share exactly one document.
  await shareOneDoc(page, ids!);

  // Client reloads: sees the shared doc and NOT the secret one.
  await page.goto(`${BASE}cliente`);
  await expect(page.getByTestId('portal-autenticado')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('portal-docs')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('portal-doc-item')).toHaveCount(1);
  await expect(page.getByTestId('portal-docs')).toContainText(ids!.sharedDocNome);

  // The client timeline renders, drawn only from resolved visibility.
  await expect(page.getByTestId('portal-cronologia')).toBeVisible({ timeout: 15_000 });
  const cronItens = page.getByTestId('portal-cronologia-item');
  await expect(cronItens.first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('portal-cronologia')).toContainText(ids!.sharedDocNome);

  // THE PROOF: the secret document's name appears NOWHERE on the authenticated
  // surface - not the doc list, not the timeline.
  texto = await page.getByTestId('portal-autenticado').innerText();
  expect(texto, 'o documento NÃO partilhado nunca renderiza').not.toContain(ids!.secretDocNome);

  await page.screenshot({ path: `${SHOTS}/so-o-partilhado.png`, fullPage: true });
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('Portal X: o extrato branded em PDF lista só o partilhado e carrega a marca do escritório', async ({ page }) => {
  await provisionAndSignIn(page, ids!);
  await shareOneDoc(page, ids!);

  await page.goto(`${BASE}cliente`);
  await expect(page.getByTestId('portal-autenticado')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('portal-cronologia')).toBeVisible({ timeout: 15_000 });

  // Intercept the PDF export so we can inspect the branded HTML payload without a
  // real renderer. The extrato posts { html, format, landscape } to /api/app-pdf.
  let pdfHtml = '';
  await page.route('**/api/app-pdf', async (route) => {
    try {
      const body = route.request().postData() || '';
      const parsed = JSON.parse(body);
      pdfHtml = String(parsed.html || '');
    } catch { /* leave empty - assertion below will fail loudly */ }
    // Fulfil with a plausible success envelope so the app's download path is happy.
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, data: { url: 'data:application/pdf;base64,JVBERi0=' } }),
    });
  });

  await page.getByTestId('portal-extrato').click();
  await expect.poll(() => pdfHtml.length, { timeout: 15_000 }).toBeGreaterThan(0);

  // The extrato carries the office brand and lists ONLY the shared document.
  expect(pdfHtml, 'o extrato traz a marca do escritório').toContain('Escritório');
  expect(pdfHtml, 'o extrato lista o documento partilhado').toContain(ids!.sharedDocNome);
  // THE PROOF at the PDF plane: the non-shared document is never in the extrato.
  expect(pdfHtml, 'o extrato NUNCA inclui o documento não partilhado').not.toContain(ids!.secretDocNome);
  // It is a cronologia-shaped document, not a raw dump.
  expect(pdfHtml, 'o extrato é um documento de cronologia de partilhas').toMatch(/Cronologia|Extrato de partilhas/i);

  await page.screenshot({ path: `${SHOTS}/extrato-branded.png`, fullPage: true });
  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});
