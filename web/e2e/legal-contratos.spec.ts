import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * S7-contratos - the Contratos app is a template-driven document generator:
 * a gallery of modelos (minutas with {{chaves}} mapped to spine origins), an
 * editor, and a 3-step generation wizard that prefills from the picked
 * cliente/processo, produces a .docx, uploads it, and records a `documentos`
 * row (origem 'contratos') visible in the Dossiê.
 *
 * The suite sets up its own cliente + processo via the shared spine (never
 * touching fs), drives the full journey through the UI, asserts the audit row
 * with its ficheiro block + processoId FK, and cleans everything up afterwards.
 * Retains the original docx-generation coverage: a real .docx blob is produced,
 * uploaded, and retrievable.
 */
const BASE = legalAppUrl('legal-contratos');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 's7');
mkdirSync(SHOTS, { recursive: true });

test.describe.serial('Contratos: modelos + wizard + geração', () => {
  const suffix = Date.now().toString(36);
  const clienteNome = `Cliente Teste ${suffix}`;
  const clienteNif = `299${String(Date.now()).slice(-6)}`;
  const clienteMorada = `Rua de Teste ${suffix}, 1000-001 Lisboa`;
  const numeroProcesso = `9${String(Date.now()).slice(-3)}/26.9T8TST`;
  const tribunal = 'Juízo Central Cível de Teste';
  const modeloNome = `Minuta Teste ${suffix}`;
  // Valor manual MULTILINHA - as duas linhas têm de sobreviver \n até à pré-visualização e ao .docx.
  const clausulaL1 = `Primeira linha ${suffix}`;
  const clausulaL2 = `Segunda linha ${suffix}`;
  const clausulaTexto = `${clausulaL1}\n${clausulaL2}`;

  const created: { clienteId?: string; processoId?: string; modeloId?: string } = {};

  test('galeria → editor CRUD (persiste no reload) → wizard prefill/obrigatória/preview → geração grava documento', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // --- Ambiente: abrir o app e semear um cliente + processo próprios do teste ---
    await page.goto(BASE);
    await expect(page.getByTestId('galeria-page')).toBeVisible({ timeout: 20_000 });

    const cliente = await page.evaluate((d) => (window as any).__ekoa.shared.create('clientes', d), {
      nome: clienteNome, nif: clienteNif, email: `teste-${suffix}@exemplo.pt`,
      telefone: '+351 900 000 000', tipo: 'particular', morada: clienteMorada,
    });
    created.clienteId = cliente.id;
    const processo = await page.evaluate((args) => (window as any).__ekoa.shared.create('processos', {
      numeroProcesso: args.numeroProcesso, tribunal: args.tribunal, comarca: 'Lisboa',
      area: 'Cível', estado: 'ativo', clienteId: args.clienteId,
    }), { numeroProcesso, tribunal, clienteId: cliente.id });
    created.processoId = processo.id;

    // --- CRUD do modelo ---
    await page.getByTestId('novo-modelo').click();
    await page.waitForURL(/\/modelos\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByTestId('modelo-editor')).toBeVisible({ timeout: 15_000 });
    const modeloId = new URL(page.url()).pathname.split('/').pop()!;
    created.modeloId = modeloId;

    await page.getByTestId('modelo-nome').fill(modeloNome);
    await page.getByTestId('modelo-area').fill('Cível');
    await page.getByTestId('modelo-descricao').fill('Minuta de teste automatizado.');
    await page.getByTestId('modelo-corpo').fill(
      'CONTRATO DE TESTE\n\nEntre {{cliente_nome}}, adiante o PRIMEIRO OUTORGANTE.\n\nCLÁUSULA ÚNICA\n{{clausula_extra}}',
    );

    // variável 1: cliente_nome (origem da espinha, obrigatória)
    await page.getByTestId('variavel-add').click();
    await page.getByTestId('variavel-chave-0').fill('cliente_nome');
    await page.getByTestId('variavel-rotulo-0').fill('Nome do cliente');
    await page.getByTestId('variavel-origem-0').selectOption('cliente.nome');
    await page.getByTestId('variavel-obrigatoria-0').check();
    // variável 2: clausula_extra (manual, obrigatória)
    await page.getByTestId('variavel-add').click();
    await page.getByTestId('variavel-chave-1').fill('clausula_extra');
    await page.getByTestId('variavel-rotulo-1').fill('Cláusula adicional');
    await page.getByTestId('variavel-origem-1').selectOption('manual');
    await page.getByTestId('variavel-obrigatoria-1').check();

    await page.getByTestId('guardar-modelo').click();
    await expect(page.locator('.toast').filter({ hasText: /guardado/i }).first()).toBeVisible({ timeout: 6_000 });

    // Persiste através de um reload DURO da rota profunda do editor (o <base href>
    // da plataforma faz a rota profunda arrancar correctamente) - os dados
    // re-hidratam do servidor.
    await page.reload();
    await expect(page.getByTestId('modelo-editor')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('modelo-corpo')).toHaveValue(/\{\{cliente_nome\}\}/);
    await expect(page.getByTestId('modelo-corpo')).toHaveValue(/\{\{clausula_extra\}\}/);
    await expect(page.getByTestId('variavel-chave-0')).toHaveValue('cliente_nome');
    await expect(page.getByTestId('variavel-chave-1')).toHaveValue('clausula_extra');
    await page.screenshot({ path: `${SHOTS}/editor.png`, fullPage: true });

    // --- Flush do autosave ao sair: uma edição por gravar NÃO se perde ao navegar ---
    // (o autosave tem 700ms de atraso; sair pelo "Voltar" tem de forçar a gravação)
    const descFlush = `Descrição final ${suffix}`;
    await page.getByTestId('modelo-descricao').fill(descFlush);
    await expect(page.getByTestId('modelo-descricao')).toHaveValue(descFlush); // garante o commit do estado
    await page.getByRole('button', { name: 'Voltar', exact: true }).click(); // NÃO clicámos em "Guardar"
    await expect(page.getByTestId('galeria-page')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`modelo-editar-${modeloId}`).click();
    await expect(page.getByTestId('modelo-editor')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('modelo-descricao')).toHaveValue(descFlush); // re-hidratado do servidor

    // --- Galeria mostra o modelo criado (reload real da rota base) ---
    await page.goto(BASE);
    await expect(page.getByTestId('galeria-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`modelo-card-${modeloId}`)).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/galeria.png`, fullPage: true });

    // --- Wizard de geração (a partir do card da galeria) ---
    await page.getByTestId(`modelo-gerar-${modeloId}`).click();
    await expect(page.getByTestId('gerar-passo1')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('gerar-cliente').selectOption(created.clienteId!);
    await page.getByTestId('gerar-processo').selectOption(created.processoId!);
    await page.getByTestId('gerar-continuar').click();

    // passo 2: variável da espinha pré-preenchida com o valor REAL, só-leitura
    await expect(page.getByTestId('gerar-passo2')).toBeVisible();
    await expect(page.getByTestId('gerar-var-cliente_nome')).toHaveValue(clienteNome);
    expect(await page.getByTestId('gerar-var-cliente_nome').getAttribute('readonly')).not.toBeNull();

    // obrigatória em falta bloqueia o avanço
    await page.getByTestId('gerar-continuar').click();
    await expect(page.getByTestId('gerar-erro')).toBeVisible();
    await expect(page.getByTestId('gerar-passo2')).toBeVisible();

    // preencher a manual obrigatória e avançar
    await page.getByTestId('gerar-var-clausula_extra').fill(clausulaTexto);
    await page.getByTestId('gerar-continuar').click();

    // passo 3: pré-visualização com as substituições aplicadas
    await expect(page.getByTestId('gerar-passo3')).toBeVisible();
    await expect(page.getByTestId('gerar-preview')).toContainText(clienteNome);
    // o valor manual multilinha rende como DUAS linhas distintas (os \n preservados);
    // getByText exact falha se as linhas tivessem sido achatadas num só parágrafo.
    await expect(page.getByTestId('gerar-preview').getByText(clausulaL1, { exact: true })).toBeVisible();
    await expect(page.getByTestId('gerar-preview').getByText(clausulaL2, { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/wizard-preview.png`, fullPage: true });

    // gerar o documento
    await page.getByTestId('gerar-confirmar').click();
    await expect(page.getByTestId('gerar-sucesso')).toBeVisible({ timeout: 20_000 });

    // link de descarga presente e aponta para o ficheiro carregado
    const download = page.getByTestId('gerar-download');
    await expect(download).toBeVisible();
    expect(await download.getAttribute('href')).toMatch(/\/api\/app-files\//);
    expect(await download.getAttribute('download')).toMatch(/\.docx$/i);

    // --- Registo `documentos` (origem contratos, com bloco ficheiro + FK processoId) ---
    const docs = await page.evaluate(
      (pid) => (window as any).__ekoa.shared.list('documentos').then((list: any[]) =>
        list.filter((d) => d.origem === 'contratos' && d.processoId === pid)),
      created.processoId,
    );
    // EXACTAMENTE uma linha para este processo (único do teste): prova que não há
    // dupla-escrita (a trava de reentrância + notify fora do caminho crítico).
    expect(docs.length, 'exactamente um documento gerado para o processo do teste').toBe(1);
    const row = docs[0];
    expect(row.tipo).toBe('docx');
    expect(row.clienteId).toBe(created.clienteId);
    expect(row.ficheiro, 'bloco ficheiro presente').toBeTruthy();
    expect(row.ficheiro.fileId).toBeTruthy();
    expect(row.ficheiro.url).toMatch(/\/api\/app-files\//);
    expect(row.versao).toBe(1);

    // o .docx foi REALMENTE carregado e é recuperável (não vazio)
    const fileCheck = await page.evaluate(
      (u) => fetch(u).then((r) => ({ status: r.status, len: r.headers.get('content-length') })),
      row.ficheiro.url,
    );
    expect(fileCheck.status).toBe(200);
    expect(Number(fileCheck.len)).toBeGreaterThan(0);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('wizard bloqueia a geração quando o corpo tem {{placeholders}} sem variável', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('galeria-page')).toBeVisible({ timeout: 20_000 });

    // Setup próprio (a seed é do Núcleo; aqui criamos os nossos e limpamos no fim).
    const s2 = `${suffix}b`;
    const ids: { clienteId?: string; processoId?: string; modeloId?: string } = {};
    try {
      const cli = await page.evaluate((d) => (window as any).__ekoa.shared.create('clientes', d), {
        nome: `Cliente Bloqueio ${s2}`, nif: `298${String(Date.now()).slice(-6)}`, tipo: 'particular',
        morada: 'Rua de Bloqueio 2', email: `bloq-${s2}@exemplo.pt`, telefone: '+351 900 000 002',
      });
      ids.clienteId = cli.id;
      const prc = await page.evaluate((a) => (window as any).__ekoa.shared.create('processos', {
        numeroProcesso: a.n, tribunal: 'Juízo de Bloqueio', comarca: 'Lisboa', area: 'Cível', estado: 'ativo', clienteId: a.c,
      }), { n: `8${String(Date.now()).slice(-3)}/26.9T8TST`, c: cli.id });
      ids.processoId = prc.id;
      // Modelo com um placeholder MAPEADO ({{cliente_nome}}) e outro SEM variável ({{tribunal_nome}}).
      const mdl = await page.evaluate((d) => (window as any).__ekoa.shared.create('modelos', d), {
        nome: `Modelo Bloqueio ${s2}`, area: 'Cível', descricao: 'Bloqueio por placeholder órfão.',
        corpo: 'CONTRATO\n\nEntre {{cliente_nome}}, no tribunal {{tribunal_nome}}.',
        variaveis: [{ chave: 'cliente_nome', rotulo: 'Nome', origem: 'cliente.nome', obrigatoria: false }],
      });
      ids.modeloId = mdl.id;

      // Deep-link direto ao wizard (hard load da rota profunda).
      await page.goto(`${BASE}gerar/${mdl.id}`);
      await expect(page.getByTestId('gerar-passo1')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('gerar-cliente').selectOption(cli.id);
      await page.getByTestId('gerar-processo').selectOption(prc.id);
      await page.getByTestId('gerar-continuar').click();

      // Sem obrigatórias -> avança direto para a pré-visualização.
      await expect(page.getByTestId('gerar-passo2')).toBeVisible();
      await page.getByTestId('gerar-continuar').click();

      // Passo 3: {{tribunal_nome}} sobra textual -> hint visível + geração bloqueada.
      await expect(page.getByTestId('gerar-passo3')).toBeVisible();
      await expect(page.getByTestId('gerar-preview')).toContainText('{{tribunal_nome}}');
      await expect(page.getByTestId('gerar-placeholders-erro')).toBeVisible();
      await expect(page.getByTestId('gerar-confirmar')).toBeDisabled();

      // Nenhum documento foi criado para este processo.
      const docs = await page.evaluate(
        (pid) => (window as any).__ekoa.shared.list('documentos').then((l: any[]) => l.filter((d) => d.processoId === pid)),
        prc.id,
      );
      expect(docs.length, 'nenhum documento gerado enquanto há placeholders por mapear').toBe(0);

      expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
    } finally {
      for (const pair of [['modelos', ids.modeloId], ['processos', ids.processoId], ['clientes', ids.clienteId]] as const) {
        const [coll, cid] = pair;
        if (cid) await page.evaluate((a) => (window as any).__ekoa.shared.delete(a[0], a[1]), [coll, cid]).catch(() => {});
      }
    }
  });

  test.afterEach(async ({ page }) => {
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
    for (const pair of [['modelos', created.modeloId], ['processos', created.processoId], ['clientes', created.clienteId]] as const) {
      const [coll, id] = pair;
      if (id) {
        await page.evaluate((args) => (window as any).__ekoa.shared.delete(args[0], args[1]), [coll, id]).catch(() => {});
      }
    }
  });
});
