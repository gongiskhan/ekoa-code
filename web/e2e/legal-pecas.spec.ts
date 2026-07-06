import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * S-pecas - Redação de Peças processuais over the SHARED spine.
 *
 * The Peças app drafts procedural documents from a DETERMINISTIC skeleton (there
 * is no live LLM): a header composed from the processo/cliente plus a body from a
 * chosen precedente (with {{chaves}} resolved) or a tipo-specific empty
 * structure. It cites the saved pesquisas as fundamentação, tracks estado, and
 * exports each peça to a .docx recorded in the Dossiê (origem 'legal-pecas') -
 * reusing the exact docx/documentos persist path of Contratos.
 *
 * Covered end-to-end through the served app (cortex at /apps/legal-pecas/):
 *  1. The list renders the seeded peça, opening it shows the fixed disclaimer on
 *     the editor, zero pageerrors.
 *  2. Nova peça wizard: a requerimento on processo 1234/26.0T8LSB with the seeded
 *     precedente composes a skeleton carrying the tribunal, número and cliente.
 *  3. Fundamentação: inserting the seeded pesquisa's citation puts the DRE URL in
 *     the corpo and records {pesquisaId} in peca.fundamentacao.
 *  4. Export .docx: writes a documentos row (origem 'legal-pecas', ficheiro
 *     block) that is visible in the Dossiê.
 *  5. Guardar como precedente creates a precedentes row.
 *
 * Deterministic + self-cleaning: every peça/precedente/documento the suite
 * creates is tagged with a nonce and deleted in afterAll; the seeded spine is
 * guaranteed by opening the Núcleo once (only it seeds).
 */
const APP = legalAppUrl('legal-pecas');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'legal-pecas');
mkdirSync(SHOTS, { recursive: true });

const NONCE = `pec${Date.now().toString(36)}`;
const NUMERO_1234 = '1234/26.0T8LSB';
const TRIBUNAL_1234 = 'Juízo Central Cível de Lisboa';
const CLIENTE_1234 = 'Marília Costa';
const DRE_URL_FRAGMENT = 'diariodarepublica.pt';

// Ids created by the suite, cleaned in afterAll (never touch seeded rows).
const created: { pecaIds: string[]; precedenteIds: string[] } = { pecaIds: [], precedenteIds: [] };

type SharedWin = {
  __ekoa: {
    shared: {
      list: (c: string) => Promise<Record<string, unknown>[]>;
      get: (c: string, id: string) => Promise<Record<string, unknown> | null>;
      create: (c: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>;
      delete: (c: string, id: string) => Promise<boolean>;
    };
  };
};

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __ekoa?: { shared?: unknown } }).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/* Opens the Núcleo once (it, and only it, seeds) and waits until the seeded
 * pecas/precedentes/pesquisas/processos exist - so the satellite reads a seeded
 * spine regardless of prior state. Idempotent. */
async function ensureSeeded(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.waitForFunction(async () => {
    const s = (window as unknown as SharedWin).__ekoa.shared;
    const [proc, pec, prec, pes] = await Promise.all([
      s.list('processos'), s.list('pecas'), s.list('precedentes'), s.list('pesquisas'),
    ]);
    return proc.length > 0 && pec.length > 0 && prec.length > 0 && pes.length > 0;
  }, undefined, { timeout: 30_000 });
}

async function findProcesso1234(page: Page): Promise<{ id: string; clienteId: string }> {
  return page.evaluate(async (numero) => {
    const s = (window as unknown as SharedWin).__ekoa.shared;
    const rows = await s.list('processos');
    const p = rows.find((r) => r.numeroProcesso === numero);
    return { id: String(p?.id || ''), clienteId: String(p?.clienteId || '') };
  }, NUMERO_1234);
}

async function findSeededPrecedente(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const s = (window as unknown as SharedWin).__ekoa.shared;
    const rows = await s.list('precedentes');
    // The seeded firm precedente (a contestação-tipo). Fall back to the first.
    const p = rows.find((r) => String(r.titulo || '').toLowerCase().includes('responsabilidade civil')) || rows[0];
    return String(p?.id || '');
  });
}

async function findSeededPesquisa(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const s = (window as unknown as SharedWin).__ekoa.shared;
    const rows = await s.list('pesquisas');
    const p = rows.find((r) => Array.isArray(r.citacoes) && (r.citacoes as { url?: string }[]).some((c) => String(c.url || '').includes('diariodarepublica')));
    return String(p?.id || '');
  });
}

/* Creates a nonce-tagged peça directly on the spine (fast, deterministic) and
 * tracks it for cleanup. Returns its id. */
async function seedPeca(page: Page, over: Record<string, unknown>): Promise<string> {
  const id = await page.evaluate(async (row) => {
    const s = (window as unknown as SharedWin).__ekoa.shared;
    const created = await s.create('pecas', row);
    return String(created?.id || '');
  }, {
    tipo: 'requerimento',
    titulo: `Peça Teste ${NONCE}`,
    corpo: `Corpo inicial da peça de teste ${NONCE}.`,
    estado: 'rascunho',
    versao: 1,
    fundamentacao: [],
    ...over,
  });
  created.pecaIds.push(id);
  return id;
}

test.describe.serial('Peças: redação determinística + fundamentação + exportação', () => {
  test('1. lista mostra a peça semeada; o editor carrega o aviso fixo; sem pageerrors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await ensureSeeded(page);
    await page.goto(APP);
    await expect(page.getByTestId('pecas-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pecas-lista')).toContainText('Requerimento de junção de documentos', { timeout: 15_000 });

    const seededId = await page.evaluate(async () => {
      const s = (window as unknown as SharedWin).__ekoa.shared;
      const rows = await s.list('pecas');
      const p = rows.find((r) => String(r.titulo || '').includes('junção de documentos')) || rows[0];
      return String(p?.id || '');
    });
    await page.getByTestId(`peca-card-${seededId}`).click();
    await expect(page.getByTestId('pecas-editor')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pecas-editor').locator('[data-demo-target="pecas-disclaimer"]')).toBeVisible();
    await expect(page.getByTestId('pecas-editor').locator('[data-demo-target="pecas-disclaimer"]'))
      .toContainText('o advogado revê sempre');
    await page.screenshot({ path: `${SHOTS}/editor.png`, fullPage: true });

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('2. nova peça (requerimento + precedente) compõe o esqueleto do processo 1234', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await ensureSeeded(page);
    const proc = await findProcesso1234(page);
    expect(proc.id, 'processo 1234/26.0T8LSB semeado').toBeTruthy();
    const precId = await findSeededPrecedente(page);
    expect(precId, 'precedente semeado').toBeTruthy();

    await page.goto(APP);
    await expect(page.getByTestId('pecas-page')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('pecas-nova').click();

    await page.getByTestId('pecas-tipo').selectOption('requerimento');
    await page.getByTestId('pecas-processo').selectOption(proc.id);
    await page.getByTestId('pecas-precedente').selectOption(precId);
    await page.getByTestId('pecas-criar').click();

    await page.waitForURL(/\/editar\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByTestId('pecas-editor')).toBeVisible({ timeout: 15_000 });
    const pecaId = new URL(page.url()).pathname.split('/').pop()!;
    created.pecaIds.push(pecaId);

    const corpo = await page.getByTestId('pecas-corpo').inputValue();
    expect(corpo, 'cabeçalho traz o tribunal do processo').toContain(TRIBUNAL_1234);
    expect(corpo, 'cabeçalho traz o número do processo').toContain(NUMERO_1234);
    expect(corpo, 'cabeçalho identifica o cliente').toContain(CLIENTE_1234);
    await page.screenshot({ path: `${SHOTS}/nova-peca.png`, fullPage: true });

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('3. inserir fundamentação: a citação da pesquisa entra no corpo e fica registada', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await ensureSeeded(page);
    const proc = await findProcesso1234(page);
    const pesquisaId = await findSeededPesquisa(page);
    expect(pesquisaId, 'pesquisa com citação DRE semeada').toBeTruthy();

    const pecaId = await seedPeca(page, { processoId: proc.id, clienteId: proc.clienteId });

    await page.goto(`${APP}editar/${pecaId}`);
    await expect(page.getByTestId('pecas-editor')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('pecas-fundamentacao')).toBeVisible();

    await page.getByTestId(`pecas-inserir-${pesquisaId}`).click();

    // A URL da fonte (DRE) entra no corpo, textualmente.
    await expect(page.getByTestId('pecas-corpo')).toHaveValue(new RegExp(DRE_URL_FRAGMENT));

    // E fica registada em peca.fundamentacao com a referência à pesquisa.
    const fund = await page.evaluate(async (id) => {
      const s = (window as unknown as SharedWin).__ekoa.shared;
      const p = await s.get('pecas', id);
      return (p && (p.fundamentacao as { pesquisaId?: string }[])) || [];
    }, pecaId);
    expect(fund.length, 'uma citação registada').toBeGreaterThan(0);
    expect(fund.some((f) => f.pesquisaId === pesquisaId), 'referência à pesquisa citada').toBe(true);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('4. exportar .docx grava um documento no dossiê (origem legal-pecas)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await ensureSeeded(page);
    const proc = await findProcesso1234(page);
    const pecaId = await seedPeca(page, {
      processoId: proc.id,
      clienteId: proc.clienteId,
      titulo: `Peça Export ${NONCE}`,
      corpo: `EXMO. SENHOR DOUTOR JUIZ DE DIREITO\n\nCorpo da peça de exportação ${NONCE}.`,
    });

    await page.goto(`${APP}editar/${pecaId}`);
    await expect(page.getByTestId('pecas-editor')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('pecas-exportar').click();
    await expect(page.getByTestId('pecas-export-sucesso')).toBeVisible({ timeout: 20_000 });

    const download = page.getByTestId('pecas-download');
    await expect(download).toBeVisible();
    expect(await download.getAttribute('href')).toMatch(/\/api\/app-files\//);
    expect(await download.getAttribute('download')).toMatch(/\.docx$/i);

    // Registo documentos (origem legal-pecas, com bloco ficheiro + FK processoId).
    const docs = await page.evaluate(async (pid) => {
      const s = (window as unknown as SharedWin).__ekoa.shared;
      const list = await s.list('documentos');
      return list.filter((d) => d.origem === 'legal-pecas' && d.processoId === pid) as Record<string, unknown>[];
    }, proc.id);
    const mine = docs.filter((d) => String(d.nome || '').includes(NONCE));
    expect(mine.length, 'exatamente um documento gerado para este teste').toBe(1);
    const row = mine[0] as { tipo?: string; ficheiro?: { fileId?: string; url?: string } };
    expect(row.tipo).toBe('docx');
    expect(row.ficheiro, 'bloco ficheiro presente').toBeTruthy();
    expect(row.ficheiro?.fileId).toBeTruthy();
    expect(row.ficheiro?.url).toMatch(/\/api\/app-files\//);

    // O ficheiro foi REALMENTE carregado e é recuperável (não vazio).
    const fileCheck = await page.evaluate(
      (u) => fetch(u).then((r) => ({ status: r.status, len: r.headers.get('content-length') })),
      row.ficheiro!.url!,
    );
    expect(fileCheck.status).toBe(200);
    expect(Number(fileCheck.len)).toBeGreaterThan(0);

    // Visível no Dossiê do processo.
    await page.goto(legalAppUrl('legal-dossie', `processo/${proc.id}`));
    await expect(page.getByTestId('tab-documentos')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('tab-documentos').click();
    await expect(page.getByTestId('documentos-list')).toContainText(`Peça Export ${NONCE}.docx`, { timeout: 15_000 });
    await page.screenshot({ path: `${SHOTS}/dossie.png`, fullPage: true });

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('5. guardar como precedente cria um precedente novo', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await ensureSeeded(page);
    const proc = await findProcesso1234(page);
    const titulo = `Peça Precedente ${NONCE}`;
    const pecaId = await seedPeca(page, { processoId: proc.id, clienteId: proc.clienteId, titulo, tipo: 'contestacao' });

    await page.goto(`${APP}editar/${pecaId}`);
    await expect(page.getByTestId('pecas-editor')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('pecas-precedente').click();
    await expect(page.locator('.toast').filter({ hasText: /precedente/i }).first()).toBeVisible({ timeout: 8_000 });

    const precs = await page.evaluate(async (t) => {
      const s = (window as unknown as SharedWin).__ekoa.shared;
      const list = await s.list('precedentes');
      return (list.filter((p) => p.titulo === t) as { id: string }[]).map((p) => p.id);
    }, titulo);
    expect(precs.length, 'precedente criado a partir da peça').toBe(1);
    created.precedenteIds.push(...precs);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    try {
      await page.goto(APP).catch(() => {});
      await waitForSpine(page).catch(() => {});
      await page.evaluate(async (args) => {
        const s = (window as unknown as SharedWin).__ekoa.shared;
        // Documentos exportados pelos testes (origem legal-pecas, marca do nonce).
        const docs = await s.list('documentos');
        for (const d of docs) {
          if (d.origem === 'legal-pecas' && String(d.nome || '').includes(args.nonce)) {
            await s.delete('documentos', String(d.id));
          }
        }
        // Precedentes por nonce (guardar-como-precedente) + os rastreados.
        const precs = await s.list('precedentes');
        for (const p of precs) {
          if (String(p.titulo || '').includes(args.nonce)) await s.delete('precedentes', String(p.id));
        }
        for (const id of args.precedenteIds) await s.delete('precedentes', id).catch(() => {});
        // Peças rastreadas.
        for (const id of args.pecaIds) await s.delete('pecas', id).catch(() => {});
      }, { nonce: NONCE, pecaIds: created.pecaIds, precedenteIds: created.precedenteIds }).catch(() => {});
    } finally {
      await page.close();
    }
  });
});
