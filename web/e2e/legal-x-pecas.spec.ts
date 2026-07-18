import { test, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { legalAppUrl, cortexBase } from './helpers/legal';

/**
 * S4-pecas (NEW coverage on top of the byte-frozen legal-pecas.spec.ts).
 *
 * Four acceptance items:
 *  1. COURT HEADER auto-fill - creating a peça from a processo emits a header with
 *     the tribunal + número do processo pre-filled (composeHeader).
 *  2. PRECEDENT insertion - an app-local precedente can be inserted into the editor
 *     corpo, with its {{chaves}} substituted from the current processo/cliente.
 *  3. OUTLINE nav - the editor lists uppercase section headings and jumping to one
 *     moves the corpo textarea selection (deterministic).
 *  4. .docx PARITY - exporting the peça produces a real OOXML zip whose
 *     word/document.xml carries Word styles (parity with contratos).
 *  Plus the modelos->pecas deep-link RECEIVING side (?modelo= opens the criar modal
 *     seeded from the app-local modelo).
 *
 * Own spine setup + teardown via window.__ekoa.shared; zero pageerrors asserted.
 */
const BASE = legalAppUrl('legal-pecas');
const ORIGIN = cortexBase();

test.describe.serial('Peças: cabeçalho + precedente + outline + docx + deep-link', () => {
  const suffix = Date.now().toString(36);
  const tribunal = `Juízo Local Cível de Teste ${suffix}`;
  const numeroProcesso = `5${String(Date.now()).slice(-3)}/26.1T8LSB`;

  const created: {
    clienteId?: string; processoId?: string; precedenteId?: string;
    modeloId?: string; pecaIds: string[]; docIds: string[];
  } = { pecaIds: [], docIds: [] };

  async function seedProcesso(page: import('@playwright/test').Page) {
    const cliente = await page.evaluate((d) => (window as any).__ekoa.shared.create('clientes', d), {
      nome: `Autor Peças ${suffix}`, nif: '123456780',
      email: `pecas-${suffix}@exemplo.pt`, tipo: 'particular', morada: `Rua Peças ${suffix}`,
    });
    created.clienteId = cliente.id;
    const processo = await page.evaluate((a) => (window as any).__ekoa.shared.create('processos', {
      numeroProcesso: a.numeroProcesso, tribunal: a.tribunal, comarca: 'Lisboa',
      area: 'Cível', estado: 'ativo', clienteId: a.clienteId,
    }), { numeroProcesso, tribunal, clienteId: cliente.id });
    created.processoId = processo.id;
    return { cliente, processo };
  }

  test('nova peça: cabeçalho de tribunal preenchido + outline + inserir precedente', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('pecas-page')).toBeVisible({ timeout: 20_000 });
    const { processo } = await seedProcesso(page);

    // Um precedente app-local do MESMO tipo (fica no topo dos "relevantes"), com um
    // placeholder do processo, para inserção resolvida.
    const precedente = await page.evaluate((d) => (window as any).__ekoa.shared.create('precedentes', d), {
      titulo: `Precedente Teste ${suffix}`, tipo: 'contestacao', area: 'Cível',
      corpo: 'DA MATÉRIA DE FACTO\nNos autos {{processo_numero}}, impugna-se o alegado.',
    });
    created.precedenteId = precedente.id;

    // A página carregou as coleções no mount, ANTES da sementeira - recarrega
    // para o select de processos ver o processo semeado.
    await page.reload();
    await expect(page.getByTestId('pecas-page')).toBeVisible({ timeout: 20_000 });

    // Cria a peça pela UI (assistente "Nova peça").
    await page.getByTestId('pecas-nova').click();
    await expect(page.getByTestId('pecas-criar')).toBeVisible();
    await page.getByTestId('pecas-tipo').selectOption('contestacao');
    await page.getByTestId('pecas-processo').selectOption(processo.id);
    await page.getByTestId('pecas-criar').click();

    // Abre no editor (rota /editar/:id).
    await expect(page.getByTestId('pecas-editor')).toBeVisible({ timeout: 15_000 });
    const pecaId = new URL(page.url()).pathname.split('/').pop()!;
    created.pecaIds.push(pecaId);

    // 1) CABEÇALHO: o corpo já traz o tribunal e o número do processo.
    const corpo0 = await page.getByTestId('pecas-corpo').inputValue();
    expect(corpo0, 'tribunal no cabeçalho').toContain(tribunal);
    expect(corpo0, 'número do processo no cabeçalho').toContain(numeroProcesso);

    // 2) OUTLINE: os títulos em maiúsculas aparecem na navegação. O outline[0] é o
    // preâmbulo "EXMO. ..." (offset 0); saltar para um cabeçalho POSTERIOR
    // ("I. POR IMPUGNAÇÃO") coloca o cursor num offset positivo (determinístico).
    await expect(page.getByTestId('pecas-outline')).toBeVisible();
    await expect(page.getByTestId('pecas-outline-0')).toBeVisible();
    const segundoChip = page.getByTestId('pecas-outline-1');
    await expect(segundoChip).toBeVisible();
    await segundoChip.click();
    await expect(async () => {
      const selStart = await page.getByTestId('pecas-corpo').evaluate((el: HTMLTextAreaElement) => el.selectionStart);
      expect(selStart).toBeGreaterThan(0);
    }).toPass({ timeout: 3_000 });

    // 3) PRECEDENTE: inserir acrescenta o corpo com o placeholder resolvido.
    await page.getByTestId(`pecas-inserir-precedente-${precedente.id}`).click();
    await expect(async () => {
      const corpo1 = await page.getByTestId('pecas-corpo').inputValue();
      expect(corpo1).toContain('DA MATÉRIA DE FACTO');
      expect(corpo1).toContain(numeroProcesso);
      expect(corpo1).not.toContain('{{processo_numero}}');
    }).toPass({ timeout: 5_000 });

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('exportar .docx da peça produz OOXML com estilos Word (paridade com contratos)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    expect(created.pecaIds[0], 'peça do teste anterior').toBeTruthy();
    await page.goto(`${BASE}editar/${created.pecaIds[0]}`);
    await expect(page.getByTestId('pecas-editor')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('pecas-exportar').click();
    await expect(page.getByTestId('pecas-export-sucesso')).toBeVisible({ timeout: 20_000 });

    const row = await page.evaluate(
      (pid) => (window as any).__ekoa.shared.list('documentos').then((l: any[]) =>
        l.find((d) => d.origem === 'legal-pecas' && d.processoId === pid)),
      created.processoId,
    );
    expect(row, 'documento exportado').toBeTruthy();
    expect(row.tipo).toBe('docx');
    created.docIds.push(row.id);

    const url: string = row.ficheiro.url;
    const resp = await page.request.get(url.startsWith('http') ? url : `${ORIGIN}${url}`);
    expect(resp.status()).toBe(200);
    const files = unzipSync(new Uint8Array(await resp.body()));
    expect(files['word/document.xml'], 'word/document.xml presente').toBeTruthy();
    const xml = strFromU8(files['word/document.xml']);
    // Estilos Word reais - título do tribunal e cabeçalhos de secção.
    expect(xml).toContain('w:val="Title"');
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain(tribunal);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('deep-link ?modelo= abre o assistente pré-carregado (receber de modelos)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('pecas-page')).toBeVisible({ timeout: 20_000 });

    // Um modelo app-local que servirá de semente (a app de peças lê a coleção modelos).
    const modelo = await page.evaluate((d) => (window as any).__ekoa.shared.create('modelos', d), {
      nome: `Modelo Semente Peça ${suffix}`, area: 'Cível', descricao: 'Semente de peça.',
      corpo: 'PETIÇÃO INICIAL\nExpõe e requer, nos autos {{processo_numero}}.',
      variaveis: [{ chave: 'processo_numero', rotulo: 'Nº', origem: 'processo.numero', obrigatoria: false }],
    });
    created.modeloId = modelo.id;

    await page.goto(`${BASE}?modelo=${modelo.id}`);
    await expect(page.getByTestId('pecas-page')).toBeVisible({ timeout: 15_000 });
    // O assistente abre automaticamente, com o banner da semente.
    await expect(page.getByTestId('pecas-criar')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('pecas-modelo-seed')).toBeVisible();
    await expect(page.getByTestId('pecas-modelo-seed-nome')).toContainText(`Modelo Semente Peça ${suffix}`);

    // Confirmar com o processo do teste e verificar que o corpo da semente entrou.
    await page.getByTestId('pecas-tipo').selectOption('peticao_inicial');
    await page.getByTestId('pecas-processo').selectOption(created.processoId!);
    await page.getByTestId('pecas-criar').click();
    await expect(page.getByTestId('pecas-editor')).toBeVisible({ timeout: 15_000 });
    const pecaId = new URL(page.url()).pathname.split('/').pop()!;
    created.pecaIds.push(pecaId);
    const corpo = await page.getByTestId('pecas-corpo').inputValue();
    expect(corpo, 'corpo da semente').toContain('PETIÇÃO INICIAL');
    expect(corpo, 'placeholder da semente resolvido').toContain(numeroProcesso);

    // O parâmetro ?modelo= foi consumido na página de lista; o editor não o herda.
    expect(page.url()).not.toContain('modelo=');

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE).catch(() => {});
    for (const id of created.docIds) {
      await page.evaluate((i) => (window as any).__ekoa.shared.delete('documentos', i), id).catch(() => {});
    }
    for (const id of created.pecaIds) {
      await page.evaluate((i) => (window as any).__ekoa.shared.delete('pecas', i), id).catch(() => {});
    }
    for (const pair of [
      ['precedentes', created.precedenteId],
      ['modelos', created.modeloId],
      ['processos', created.processoId],
      ['clientes', created.clienteId],
    ] as const) {
      const [coll, id] = pair;
      if (id) await page.evaluate((a) => (window as any).__ekoa.shared.delete(a[0], a[1]), [coll, id]).catch(() => {});
    }
    await page.close();
  });
});
