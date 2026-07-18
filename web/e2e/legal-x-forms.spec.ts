import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * S4-forms (NEW coverage on top of the byte-frozen legal-forms.spec.ts).
 *
 * Proves the AcroForm autofill end-to-end against a COMMITTED SYNTHETIC fixture PDF
 * (web/e2e/fixtures/requerimento-generico-form.pdf - 7 AcroForm text fields, all
 * example identifiers synthetic and checksum-INVALID by design):
 *  1. UPLOAD a real PDF via the file input -> AcroForm fields detected, template row
 *     created, mapping table rendered with the 7 fields.
 *  2. AUTO-MAPPING heuristic pre-fills origins from the spine (nif/email/morada/
 *     processo/tribunal/nome); the manual-only field stays manual.
 *  3. MAPPING POLISH - the resumo badge counts filled fields; "repor sugestão"
 *     re-applies the heuristic.
 *  4. ARCHIVE - filling + exporting writes a documentos row (origem legal-forms,
 *     tipo pdf) to the spine and offers a download from /api/app-files/.
 *
 * Own spine setup + teardown via window.__ekoa.shared; zero pageerrors asserted.
 */
const BASE = legalAppUrl('legal-forms');
const FIXTURE = resolve(__dirname, 'fixtures', 'requerimento-generico-form.pdf');

// Campos AcroForm da fixture (distintos do exemplo embutido de 5 campos).
const CAMPOS = ['outorgante_nome', 'contribuinte', 'residencia', 'correio_eletronico', 'autos_numero', 'juizo', 'data_requerimento'];

test.describe.serial('Forms: upload AcroForm sintético + auto-mapeamento + arquivo', () => {
  const suffix = Date.now().toString(36);
  const clienteNome = `Requerente Forms ${suffix}`;
  // NIF sintético de checksum inválido por desenho (não valida no módulo 11).
  const clienteNif = '123456780';
  const clienteEmail = `forms-${suffix}@exemplo.pt`;
  const clienteMorada = `Rua Forms ${suffix}, Lisboa`;
  const numeroProcesso = `4${String(Date.now()).slice(-3)}/26.2T8LSB`;

  const created: { clienteId?: string; processoId?: string; templateId?: string; docId?: string } = {};

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE);
    await expect(page.getByTestId('forms-templates-page')).toBeVisible({ timeout: 20_000 });
    const cliente = await page.evaluate((d) => (window as any).__ekoa.shared.create('clientes', d), {
      nome: clienteNome, nif: clienteNif, email: clienteEmail, tipo: 'particular', morada: clienteMorada,
    });
    created.clienteId = cliente.id;
    const processo = await page.evaluate((a) => (window as any).__ekoa.shared.create('processos', {
      numeroProcesso: a.numeroProcesso, tribunal: 'Juízo Local Cível de Teste', comarca: 'Lisboa',
      area: 'Cível', estado: 'ativo', clienteId: a.clienteId,
    }), { numeroProcesso, clienteId: cliente.id });
    created.processoId = processo.id;
    await page.close();
  });

  test('upload da fixture deteta os 7 campos AcroForm e auto-mapeia da espinha', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('forms-templates-page')).toBeVisible({ timeout: 20_000 });

    // Carrega o PDF real pelo input de ficheiro (mesmo caminho de um utilizador).
    await page.getByTestId('forms-file-input').setInputFiles(FIXTURE);

    // Navega para o preenchimento com o modelo criado.
    await expect(page.getByTestId('forms-preencher-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('forms-mapeamento')).toBeVisible({ timeout: 15_000 });
    created.templateId = new URL(page.url()).searchParams.get('template') || undefined;
    expect(created.templateId, 'template criado').toBeTruthy();

    // Os 7 campos AcroForm da fixture aparecem como linhas.
    for (const nome of CAMPOS) {
      await expect(page.getByTestId(`forms-linha-${nome}`)).toBeVisible();
    }

    // Auto-mapeamento heurístico: origens da espinha pré-seleccionadas.
    await expect(page.getByTestId('forms-origem-contribuinte')).toHaveValue('cliente.nif');
    await expect(page.getByTestId('forms-origem-outorgante_nome')).toHaveValue('cliente.nome');
    await expect(page.getByTestId('forms-origem-residencia')).toHaveValue('cliente.morada');
    await expect(page.getByTestId('forms-origem-correio_eletronico')).toHaveValue('cliente.email');
    await expect(page.getByTestId('forms-origem-autos_numero')).toHaveValue('processo.numero');
    await expect(page.getByTestId('forms-origem-juizo')).toHaveValue('processo.tribunal');
    // Campo sem palavra-chave da espinha: fica manual.
    await expect(page.getByTestId('forms-origem-data_requerimento')).toHaveValue('manual');

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('resumo + valores resolvidos, "repor sugestão", e arquivo no dossiê', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    expect(created.templateId, 'template do teste anterior').toBeTruthy();
    await page.goto(`${BASE}preencher?template=${created.templateId}`);
    await expect(page.getByTestId('forms-preencher-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('forms-mapeamento')).toBeVisible({ timeout: 15_000 });

    // Sem cliente ainda: o resumo conta 0 valores resolvidos (as origens da espinha
    // não têm cliente para resolver). Escolhe o cliente e o processo do teste.
    await page.getByTestId('forms-cliente').selectOption(created.clienteId!);
    await page.getByTestId('forms-processo').selectOption(created.processoId!);

    // Com o cliente/processo escolhidos, o NIF e o email resolvem-se ao vivo.
    await expect(page.getByTestId('forms-valor-contribuinte')).toContainText('123 456 780'); // NIF agrupado
    await expect(page.getByTestId('forms-valor-correio_eletronico')).toContainText(clienteEmail);
    await expect(page.getByTestId('forms-valor-autos_numero')).toContainText(numeroProcesso);

    // Resumo: pelo menos os 6 campos da espinha ficam com valor (o manual está vazio).
    await expect(page.getByTestId('forms-mapa-resumo')).toContainText('6 de 7 com valor');

    // Preenche o campo manual (data) e repõe a sugestão para provar o botão polido.
    await page.getByTestId('forms-manual-data_requerimento').fill('2026-07-17');
    await page.getByTestId('forms-repor-sugestao').click();
    // Após repor, as origens da espinha continuam corretas (a heurística é estável).
    await expect(page.getByTestId('forms-origem-contribuinte')).toHaveValue('cliente.nif');

    // Preenche e exporta: arquiva um PDF no dossiê.
    await page.getByTestId('forms-preencher-exportar').click();
    await expect(page.getByTestId('forms-resultado')).toBeVisible({ timeout: 20_000 });
    const download = page.getByTestId('forms-download');
    await expect(download).toBeVisible();
    await expect(download).toHaveAttribute('href', /\/api\/app-files\//);

    // Linha de arquivo na espinha: origem legal-forms, tipo pdf, deste cliente.
    const row = await page.evaluate(
      (cid) => (window as any).__ekoa.shared.list('documentos').then((l: any[]) =>
        l.find((d) => d.origem === 'legal-forms' && d.clienteId === cid)),
      created.clienteId,
    );
    expect(row, 'documento arquivado').toBeTruthy();
    expect(row.tipo).toBe('pdf');
    expect(row.versao).toBe(1);
    created.docId = row.id;

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE).catch(() => {});
    if (created.docId) {
      await page.evaluate((i) => (window as any).__ekoa.shared.delete('documentos', i), created.docId).catch(() => {});
    }
    for (const pair of [
      ['form_templates', created.templateId],
      ['processos', created.processoId],
      ['clientes', created.clienteId],
    ] as const) {
      const [coll, id] = pair;
      if (id) await page.evaluate((a) => (window as any).__ekoa.shared.delete(a[0], a[1]), [coll, id]).catch(() => {});
    }
    await page.close();
  });
});
