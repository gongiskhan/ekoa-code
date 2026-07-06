/* eslint-disable @typescript-eslint/no-explicit-any -- the SSE-injected `window.__ekoa.shared` bridge is an untyped runtime global; spine access in-page is dynamic by nature */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * S?-forms - the FLAGSHIP of the legal wave. Preenchimento Inteligente de
 * Formulários: load an official AcroForm PDF, its fields are detected and
 * fingerprinted, auto-mapped to the shared spine (cliente/processo), filled +
 * flattened by pdf-lib IN THE BROWSER, and exported as a `documentos` row into
 * the dossiê. Re-loading the same PDF is RECOGNIZED by fingerprint (learned
 * layout applied). All PDF work is client-side and deterministic; the AI/vision
 * path for scanned PDFs ships as a clearly-labelled "em preparação" affordance.
 *
 * The suite bootstraps its own cliente + processo via the shared spine (never
 * touching fs), drives the full journey through the UI, asserts the audit row
 * with its ficheiro block, proves the fingerprint recognition, checks the
 * learned mapeamento persists with a bumped versao, and cleans everything up.
 */
const BASE = legalAppUrl('legal-forms');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 's-forms');
mkdirSync(SHOTS, { recursive: true });

const NOME_EXEMPLO = 'Procuração forense (exemplo)';

test.describe.serial('Formulários: deteção AcroForm + mapeamento + exportação + reconhecimento', () => {
  const suffix = Date.now().toString(36);
  const clienteNome = `Marília Costa ${suffix}`;
  const clienteNif = '210000017';
  const numeroProcesso = `7${String(Date.now()).slice(-3)}/26.9T8LSB`;

  const created: { clienteId?: string; processoId?: string; templateId?: string } = {};

  // Remove any pre-existing sample template so the flow is deterministic, and
  // return the current sample template (if one survives) — belt-and-braces for
  // parallel workers that may have created it first.
  async function limparExemplos(page: Page) {
    await page.evaluate(async (nome) => {
      const list = await (window as any).__ekoa.shared.list('form_templates');
      for (const t of list) {
        if (t && t.nome === nome) await (window as any).__ekoa.shared.delete('form_templates', t.id);
      }
    }, NOME_EXEMPLO).catch(() => {});
  }

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE);
    await expect(page.getByTestId('forms-templates-page')).toBeVisible({ timeout: 20_000 });
    await limparExemplos(page);
    const cliente = await page.evaluate((d) => (window as any).__ekoa.shared.create('clientes', d), {
      nome: clienteNome, nif: clienteNif, email: `marilia-${suffix}@exemplo.pt`,
      telefone: '+351 900 000 000', tipo: 'particular', morada: 'Rua das Flores 12, 1200-192 Lisboa',
    });
    created.clienteId = cliente.id;
    const processo = await page.evaluate((args) => (window as any).__ekoa.shared.create('processos', {
      numeroProcesso: args.numeroProcesso, tribunal: 'Juízo Central Cível de Lisboa', comarca: 'Lisboa',
      area: 'Cível', estado: 'ativo', clienteId: args.clienteId,
    }), { numeroProcesso, clienteId: cliente.id });
    created.processoId = processo.id;
    await page.close();
  });

  test('página de modelos renderiza sem erros e mostra a nota de IA em preparação', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('forms-templates-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('forms-exemplo')).toBeVisible();
    await expect(page.getByTestId('forms-carregar')).toBeVisible();
    // A capacidade de IA (PDF digitalizados) ship como "em preparação", sem fingir IA.
    await expect(page.getByTestId('forms-ia-nota')).toContainText(/deteção assistida por IA|será ativada/i);
    await page.screenshot({ path: `${SHOTS}/modelos.png`, fullPage: true });

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('FLAGSHIP: usar exemplo → AcroForm (5 campos) → preencher Marília → exporta ao dossiê → reconhece pela impressão digital', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // --- Carregar o exemplo: cria o modelo (AcroForm) e abre-o para preencher ---
    await page.goto(BASE);
    await expect(page.getByTestId('forms-templates-page')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('forms-exemplo').click();
    await page.waitForURL(/\/preencher/, { timeout: 20_000 });
    await expect(page.getByTestId('forms-preencher-page')).toBeVisible({ timeout: 15_000 });

    // O modelo do exemplo existe, é AcroForm e tem 5 campos detetados.
    const template = await page.evaluate((nome) =>
      (window as any).__ekoa.shared.list('form_templates').then((l: any[]) => l.find((t) => t.nome === nome) || null),
    NOME_EXEMPLO);
    expect(template, 'modelo do exemplo criado').toBeTruthy();
    created.templateId = template.id;
    expect(template.tipoPdf).toBe('acroform');
    expect(Array.isArray(template.camposDetectados) ? template.camposDetectados.length : 0).toBe(5);
    expect(template.fingerprint && template.fingerprint.hashCampos, 'impressão digital com hash de campos').toBeTruthy();

    // --- Mapeamento auto-sugerido: nif_requerente → cliente.nif ---
    await expect(page.getByTestId('forms-mapeamento')).toBeVisible();
    await expect(page.getByTestId('forms-origem-nif_requerente')).toHaveValue('cliente.nif');
    await expect(page.getByTestId('forms-origem-nome_requerente')).toHaveValue('cliente.nome');

    // --- Escolher o cliente/processo do teste; o valor do NIF sai formatado ---
    await page.getByTestId('forms-cliente').selectOption(created.clienteId!);
    await page.getByTestId('forms-processo').selectOption(created.processoId!);
    await expect(page.getByTestId('forms-valor-nif_requerente')).toHaveText('210 000 017');
    await page.screenshot({ path: `${SHOTS}/preencher.png`, fullPage: true });

    // --- Preencher e exportar ---
    await page.getByTestId('forms-preencher-exportar').click();
    await expect(page.getByTestId('forms-resultado')).toBeVisible({ timeout: 20_000 });
    const download = page.getByTestId('forms-download');
    await expect(download).toBeVisible();
    expect(await download.getAttribute('href')).toMatch(/\/api\/app-files\//);
    expect(await download.getAttribute('download')).toMatch(/\.pdf$/i);
    await page.screenshot({ path: `${SHOTS}/resultado.png`, fullPage: true });

    // --- Registo `documentos` (origem legal-forms, com bloco ficheiro + FK) ---
    const docs = await page.evaluate(
      (pid) => (window as any).__ekoa.shared.list('documentos').then((list: any[]) =>
        list.filter((d) => d.origem === 'legal-forms' && d.processoId === pid)),
      created.processoId,
    );
    expect(docs.length, 'exatamente um formulário exportado para o processo do teste').toBe(1);
    const row = docs[0];
    expect(row.tipo).toBe('pdf');
    expect(row.clienteId).toBe(created.clienteId);
    expect(row.ficheiro, 'bloco ficheiro presente').toBeTruthy();
    expect(row.ficheiro.fileId).toBeTruthy();
    expect(row.ficheiro.url).toMatch(/\/api\/app-files\//);

    // O PDF preenchido foi REALMENTE carregado e é recuperável (não vazio).
    const fileCheck = await page.evaluate(
      (u) => fetch(u).then((r) => ({ status: r.status, len: r.headers.get('content-length') })),
      row.ficheiro.url,
    );
    expect(fileCheck.status).toBe(200);
    expect(Number(fileCheck.len)).toBeGreaterThan(0);

    // --- Reconhecimento: re-carregar o MESMO exemplo → aviso "Modelo reconhecido" ---
    await page.goto(BASE);
    await expect(page.getByTestId('forms-templates-page')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('forms-exemplo').click();
    await page.waitForURL(/reconhecido=1/, { timeout: 20_000 });
    await expect(page.getByTestId('forms-reconhecido')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('forms-reconhecido')).toContainText(/Modelo reconhecido/i);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('mapeamento editado persiste e a versão do modelo sobe', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    expect(created.templateId, 'modelo do exemplo do teste anterior').toBeTruthy();

    await page.goto(`${BASE}preencher?template=${created.templateId}`);
    await expect(page.getByTestId('forms-preencher-page')).toBeVisible({ timeout: 15_000 });

    // Ler a versão ANTES da edição (a página já carregou o __ekoa da app).
    const versaoAntes = await page.evaluate(
      (id) => (window as any).__ekoa.shared.get('form_templates', id).then((t: any) => (t ? Number(t.versao) || 1 : 0)),
      created.templateId,
    );
    await expect(page.getByTestId('forms-mapeamento')).toBeVisible();

    // Edita a origem de um campo (tribunal → manual) e preenche.
    await page.getByTestId('forms-origem-tribunal').selectOption('manual');
    await page.getByTestId('forms-manual-tribunal').fill('Tribunal indicado à mão');
    await page.getByTestId('forms-cliente').selectOption(created.clienteId!);
    await page.getByTestId('forms-preencher-exportar').click();
    await expect(page.getByTestId('forms-resultado')).toBeVisible({ timeout: 20_000 });

    // A versão subiu e o mapeamento editado foi guardado no modelo.
    const depois = await page.evaluate(
      (id) => (window as any).__ekoa.shared.get('form_templates', id),
      created.templateId,
    );
    expect(Number(depois.versao)).toBeGreaterThan(versaoAntes);
    const linhaTribunal = (depois.mapeamento || []).find((m: any) => m.campo === 'tribunal');
    expect(linhaTribunal, 'linha de mapeamento do campo tribunal').toBeTruthy();
    expect(linhaTribunal.origem).toBe('manual');
    expect(linhaTribunal.valorManual).toBe('Tribunal indicado à mão');

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE).catch(() => {});
    // Documentos exportados pelo teste (origem legal-forms, do cliente do teste).
    await page.evaluate(async (cid) => {
      const docs = await (window as any).__ekoa.shared.list('documentos');
      for (const d of docs) {
        if (d.origem === 'legal-forms' && d.clienteId === cid) {
          try { await (window as any).__ekoa.shared.delete('documentos', d.id); } catch { /* melhor-esforço */ }
        }
      }
    }, created.clienteId).catch(() => {});
    // Modelos do exemplo criados pelo teste.
    await page.evaluate(async (nome) => {
      const list = await (window as any).__ekoa.shared.list('form_templates');
      for (const t of list) {
        if (t && t.nome === nome) {
          try { await (window as any).__ekoa.shared.delete('form_templates', t.id); } catch { /* melhor-esforço */ }
        }
      }
    }, NOME_EXEMPLO).catch(() => {});
    // form_feedback do modelo do teste (se algum foi criado no editor).
    if (created.templateId) {
      await page.evaluate(async (tid) => {
        const list = await (window as any).__ekoa.shared.list('form_feedback');
        for (const f of list) {
          if (f && f.templateId === tid) {
            try { await (window as any).__ekoa.shared.delete('form_feedback', f.id); } catch { /* melhor-esforço */ }
          }
        }
      }, created.templateId).catch(() => {});
    }
    for (const pair of [['processos', created.processoId], ['clientes', created.clienteId]] as const) {
      const [coll, cid] = pair;
      if (cid) await page.evaluate((a) => (window as any).__ekoa.shared.delete(a[0], a[1]), [coll, cid]).catch(() => {});
    }
    await page.close();
  });
});
