import { test, expect } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { legalAppUrl, cortexBase } from './helpers/legal';

/**
 * S4-contratos (NEW coverage on top of the byte-frozen legal-contratos.spec.ts).
 *
 * Three acceptance items the base spec does not cover:
 *  1. .docx QUALITY - the generated document is a real ZIP whose word/document.xml
 *     carries Word heading styles (w:val="Title" / "Heading1") and an automatic
 *     numbered list (<w:numPr>), plus a word/numbering.xml part. This spec fetches
 *     the uploaded .docx bytes and UNZIPS + inspects the XML (not just "a file exists").
 *  2. One-click PROCURAÇÃO FORENSE - the gallery button creates (or reuses) an
 *     app-local procuração modelo citing arts. 44.º/45.º CPC and opens the wizard.
 *  3. Deep-link PREFILL - the wizard reads ?cliente=&processo= and pre-selects step 1
 *     (the receiving side of the modelos->contratos URL-param contract).
 *
 * Own spine setup + teardown via window.__ekoa.shared; zero pageerrors asserted.
 */
const BASE = legalAppUrl('legal-contratos');

test.describe.serial('Contratos: docx-XML + procuração forense + deep-link', () => {
  const suffix = Date.now().toString(36);
  const clienteNome = `Cliente DocX ${suffix}`;
  const clienteNif = '123456780'; // sintético, checksum inválido (dígito de controlo correto seria 9)
  const numeroProcesso = `7${String(Date.now()).slice(-3)}/26.9T8TST`;

  const created: { clienteId?: string; processoId?: string; modeloId?: string; procuracaoId?: string } = {};

  test('geração produz .docx com estilos Word reais (unzip + inspeciona XML)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('galeria-page')).toBeVisible({ timeout: 20_000 });

    // Ambiente: cliente + processo próprios do teste.
    const cliente = await page.evaluate((d) => (window as any).__ekoa.shared.create('clientes', d), {
      nome: clienteNome, nif: clienteNif, email: `docx-${suffix}@exemplo.pt`,
      telefone: '+351 900 000 010', tipo: 'particular', morada: `Rua DocX ${suffix}`,
    });
    created.clienteId = cliente.id;
    const processo = await page.evaluate((a) => (window as any).__ekoa.shared.create('processos', {
      numeroProcesso: a.numeroProcesso, tribunal: 'Juízo Central Cível de Teste', comarca: 'Lisboa',
      area: 'Cível', estado: 'ativo', clienteId: a.clienteId,
    }), { numeroProcesso, clienteId: cliente.id });
    created.processoId = processo.id;

    // Modelo com um TÍTULO em maiúsculas, um cabeçalho de cláusula com rótulo
    // parentético (caixa mista) e um item numerado - exercita as três classes de estilo.
    const modelo = await page.evaluate((d) => (window as any).__ekoa.shared.create('modelos', d), {
      nome: `Minuta DocX ${suffix}`, area: 'Cível', descricao: 'Qualidade Word.',
      corpo: [
        'CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
        '',
        'CLÁUSULA PRIMEIRA (Objecto)',
        '1. O presente contrato tem por objecto {{cliente_nome}}.',
        '',
        'CLÁUSULA SEGUNDA (Prazo)',
        'Vigora por tempo indeterminado.',
      ].join('\n'),
      variaveis: [{ chave: 'cliente_nome', rotulo: 'Nome', origem: 'cliente.nome', obrigatoria: false }],
    });
    created.modeloId = modelo.id;

    // Wizard por deep-link direto.
    await page.goto(`${BASE}gerar/${modelo.id}`);
    await expect(page.getByTestId('gerar-passo1')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('gerar-cliente').selectOption(cliente.id);
    await page.getByTestId('gerar-processo').selectOption(processo.id);
    await page.getByTestId('gerar-continuar').click();
    await expect(page.getByTestId('gerar-passo2')).toBeVisible();
    await page.getByTestId('gerar-continuar').click();
    await expect(page.getByTestId('gerar-passo3')).toBeVisible();
    await page.getByTestId('gerar-confirmar').click();
    await expect(page.getByTestId('gerar-sucesso')).toBeVisible({ timeout: 20_000 });

    // Recupera o registo e o URL do ficheiro carregado.
    const row = await page.evaluate(
      (pid) => (window as any).__ekoa.shared.list('documentos').then((l: any[]) =>
        l.find((d) => d.origem === 'contratos' && d.processoId === pid)),
      processo.id,
    );
    expect(row, 'documento gerado').toBeTruthy();
    expect(row.tipo).toBe('docx');
    const url: string = row.ficheiro.url;

    // Descarrega os bytes do .docx e UNZIP: um .docx é um ZIP OOXML.
    const resp = await page.request.get(url.startsWith('http') ? url : `${cortexBase()}${url}`);
    expect(resp.status()).toBe(200);
    const bytes = new Uint8Array(await resp.body());
    const files = unzipSync(bytes);
    expect(files['word/document.xml'], 'word/document.xml presente').toBeTruthy();
    const xml = strFromU8(files['word/document.xml']);

    // Estilos Word REAIS (não apenas negrito): Título + Heading 1 + lista numerada.
    expect(xml, 'estilo Title (1.ª linha em maiúsculas)').toContain('w:val="Title"');
    expect(xml, 'estilo Heading1 (cabeçalhos de cláusula)').toContain('w:val="Heading1"');
    expect(xml, 'lista numerada automática (w:numPr)').toContain('<w:numPr>');
    expect(files['word/numbering.xml'], 'word/numbering.xml presente').toBeTruthy();
    // O placeholder foi RESOLVIDO no corpo (o nome do cliente entrou no XML).
    expect(xml).toContain(clienteNome);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('procuração forense de um clique cria a minuta (arts. 44.º/45.º CPC) e abre o wizard', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('galeria-page')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('procuracao-forense-rapida').click();
    // Abre o wizard de geração já sobre um modelo de procuração.
    await page.waitForURL(/\/gerar\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByTestId('gerar-passo1')).toBeVisible({ timeout: 15_000 });
    const modeloId = new URL(page.url()).pathname.split('/').pop()!;

    // O modelo criado é uma procuração forense que CITA os artigos do CPC.
    const modelo = await page.evaluate((id) => (window as any).__ekoa.shared.get('modelos', id), modeloId);
    expect(modelo, 'modelo de procuração criado').toBeTruthy();
    expect(String(modelo.nome).toLowerCase()).toContain('procuração forense');
    expect(modelo.corpo).toContain('artigo 44.º');
    expect(modelo.corpo).toContain('artigo 45.º');
    expect((modelo.fonteOriginal || '') + (modelo.corpo || '')).toContain('Código de Processo Civil');
    created.procuracaoId = modelo.id;

    // Reutilização: um segundo clique NÃO cria um segundo modelo (procura pelo nome).
    await page.goto(BASE);
    await expect(page.getByTestId('galeria-page')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('procuracao-forense-rapida').click();
    await page.waitForURL(/\/gerar\/[^/]+$/, { timeout: 15_000 });
    const modeloId2 = new URL(page.url()).pathname.split('/').pop()!;
    expect(modeloId2, 'reutiliza o mesmo modelo (não duplica)').toBe(modeloId);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('deep-link ?cliente=&processo= pré-seleciona o passo 1 do wizard', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('galeria-page')).toBeVisible({ timeout: 20_000 });

    // Precisa de um modelo qualquer e do cliente/processo já criados no 1.º teste.
    expect(created.clienteId && created.processoId && created.modeloId, 'setup do 1.º teste presente').toBeTruthy();

    await page.goto(`${BASE}gerar/${created.modeloId}?cliente=${created.clienteId}&processo=${created.processoId}`);
    await expect(page.getByTestId('gerar-passo1')).toBeVisible({ timeout: 15_000 });
    // O select de cliente e o de processo já vêm preenchidos pelo deep-link.
    await expect(page.getByTestId('gerar-cliente')).toHaveValue(created.clienteId!);
    await expect(page.getByTestId('gerar-processo')).toHaveValue(created.processoId!);
    // Podendo avançar de imediato (a validação passa).
    await page.getByTestId('gerar-continuar').click();
    await expect(page.getByTestId('gerar-passo2')).toBeVisible();

    // Deep-link com um id inválido não parte a página nem inventa seleção.
    await page.goto(`${BASE}gerar/${created.modeloId}?cliente=nao-existe&processo=nao-existe`);
    await expect(page.getByTestId('gerar-passo1')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('gerar-cliente')).toHaveValue('');

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE).catch(() => {});
    if (created.processoId) {
      await page.evaluate(async (pid) => {
        const docs = await (window as any).__ekoa.shared.list('documentos');
        for (const d of docs) {
          if (d.origem === 'contratos' && d.processoId === pid) {
            await (window as any).__ekoa.shared.delete('documentos', d.id);
          }
        }
      }, created.processoId).catch(() => {});
    }
    for (const pair of [
      ['modelos', created.modeloId],
      ['modelos', created.procuracaoId],
      ['processos', created.processoId],
      ['clientes', created.clienteId],
    ] as const) {
      const [coll, id] = pair;
      if (id) await page.evaluate((a) => (window as any).__ekoa.shared.delete(a[0], a[1]), [coll, id]).catch(() => {});
    }
    await page.close();
  });
});
