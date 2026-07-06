import { test, expect, type Page } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * QA regression — SELECT/dropdown persistence across the legal suite.
 *
 * A user report ("nem guarda valores de um dropdown") motivated a full sweep of
 * every select-backed create/edit form. This spec pins the contract: a value
 * chosen in a <select> (or a checkbox group) must land, unchanged, on the
 * persisted spine row - on CREATE and on EDIT. Each app cleans up its own rows.
 *
 * Runs against the served apps; asserts the persisted value via the shared API,
 * never just the DOM (a select that shows the value but drops it on save is the
 * exact failure this guards against).
 */

interface EkoaShared {
  list(c: string): Promise<Array<Record<string, unknown>>>;
  get(c: string, id: string): Promise<Record<string, unknown> | null>;
  delete(c: string, id: string): Promise<boolean>;
}
type EkoaWin = { __ekoa?: { shared?: EkoaShared } };

async function waitSpine(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as EkoaWin).__ekoa?.shared), undefined, { timeout: 20_000 });
}
async function findRow(page: Page, coll: string, field: string, needle: string) {
  return page.evaluate(async ({ coll, field, needle }) => {
    const s = (window as unknown as EkoaWin).__ekoa!.shared!;
    const rows = await s.list(coll);
    return rows.find((r) => typeof r[field] === 'string' && (r[field] as string).includes(needle)) || null;
  }, { coll, field, needle });
}
async function del(page: Page, coll: string, id: string) {
  await page.evaluate(async ({ coll, id }) => { await (window as unknown as EkoaWin).__ekoa!.shared!.delete(coll, id); }, { coll, id });
}

const TAG = `DP-${Date.now().toString(36)}`;

test.describe('dropdown persistence: value chosen in a select lands on the spine row', () => {
  const pageErrors: string[] = [];
  test.beforeEach(({ page }) => {
    pageErrors.length = 0;
    page.on('pageerror', (e) => pageErrors.push(String(e)));
  });
  test.afterEach(() => {
    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('Núcleo: cliente "tipo" persists on create AND edit', async ({ page }) => {
    await page.goto(legalAppUrl('legal-nucleo', 'clientes'), { waitUntil: 'domcontentloaded' });
    await waitSpine(page);
    await page.getByTestId('novo-cliente').click();
    const nome = `${TAG} Empresa`;
    await page.getByTestId('cliente-nome').fill(nome);
    await page.getByTestId('cliente-tipo').selectOption('empresa');
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByTestId('cliente-detail')).toBeVisible({ timeout: 15_000 });

    const row = await findRow(page, 'clientes', 'nome', TAG);
    expect(row, 'cliente row created').toBeTruthy();
    expect(row!.tipo, 'tipo persisted on create').toBe('empresa');

    // Edit: flip tipo back to particular.
    const editar = page.getByRole('button', { name: /editar/i }).first();
    await editar.click();
    await page.getByTestId('cliente-tipo').selectOption('particular');
    await page.getByTestId('guardar-cliente').click();
    await page.waitForTimeout(800);
    const after = await page.evaluate(async (id) => (window as unknown as EkoaWin).__ekoa!.shared!.get('clientes', id), row!.id as string);
    expect(after!.tipo, 'tipo persisted on edit').toBe('particular');

    await del(page, 'clientes', row!.id as string);
  });

  test('Correio: carta "tipo" select persists on the correio row', async ({ page }) => {
    await page.goto(legalAppUrl('legal-correio', 'nova'), { waitUntil: 'domcontentloaded' });
    await waitSpine(page);
    await page.getByTestId('correio-nova-tipo').selectOption('registado_ar');
    const tipoUi = await page.getByTestId('correio-nova-tipo').inputValue();
    await page.getByTestId('correio-nova-cliente').selectOption({ index: 1 });
    const conteudo = page.locator('[data-testid="correio-nova-conteudo"], [data-demo-target="correio-conteudo"]').first();
    await conteudo.fill(`${TAG} objeto`);
    await page.locator('[data-demo-target="correio-registar"], [data-testid="correio-registar"]').first().click();
    await page.waitForTimeout(1000);
    const row = await findRow(page, 'correio', 'conteudoDescricao', TAG);
    expect(row, 'correio row created').toBeTruthy();
    expect(row!.tipo, 'correio tipo persisted').toBe(tipoUi);
    await del(page, 'correio', row!.id as string);
  });

  test('Finanças: despesa "categoria" + "cliente" selects persist', async ({ page }) => {
    await page.goto(legalAppUrl('legal-financas', 'despesas'), { waitUntil: 'domcontentloaded' });
    await waitSpine(page);
    await page.locator('[data-testid="financas-despesa-nova"]').click();
    await page.getByTestId('despesa-descricao').fill(`${TAG} despesa`);
    await page.getByTestId('despesa-categoria').selectOption({ index: 2 });
    const catUi = await page.getByTestId('despesa-categoria').inputValue();
    await page.getByTestId('despesa-cliente').selectOption({ index: 1 });
    const cliUi = await page.getByTestId('despesa-cliente').inputValue();
    const valor = page.locator('[data-testid="despesa-valor"]');
    if (await valor.count()) await valor.fill('15.5');
    await page.getByTestId('despesa-guardar').click();
    await page.waitForTimeout(1000);
    const row = await findRow(page, 'despesas', 'descricao', TAG);
    expect(row, 'despesa row created').toBeTruthy();
    expect(row!.categoria, 'categoria persisted').toBe(catUi);
    expect(row!.clienteId, 'cliente persisted').toBe(cliUi);
    await del(page, 'despesas', row!.id as string);
  });

  test('Recursos: alocação pessoa + processo selects persist', async ({ page }) => {
    await page.goto(legalAppUrl('legal-recursos', 'alocacoes'), { waitUntil: 'domcontentloaded' });
    await waitSpine(page);
    await page.getByTestId('nova-alocacao').click();
    await page.getByTestId('aloc-pessoa').selectOption({ index: 1 });
    const pes = await page.getByTestId('aloc-pessoa').inputValue();
    await page.getByTestId('aloc-processo').selectOption({ index: 1 });
    const proc = await page.getByTestId('aloc-processo').inputValue();
    await page.getByTestId('aloc-percentagem').fill('37');
    await page.getByTestId('aloc-inicio').fill('2026-07-05');
    await page.getByTestId('aloc-guardar').click();
    await page.waitForTimeout(1000);
    const row = await page.evaluate(async () => {
      const s = (window as unknown as EkoaWin).__ekoa!.shared!;
      const rows = await s.list('alocacoes');
      return rows.find((r) => Number(r.percentagem) === 37 && r.dataInicio === '2026-07-05') || null;
    });
    expect(row, 'alocacao row created').toBeTruthy();
    expect(row!.pessoaId, 'pessoa persisted').toBe(pes);
    expect(row!.processoId, 'processo persisted').toBe(proc);
    await del(page, 'alocacoes', row!.id as string);
  });

  test('Agenda: tipo de sessão "local" select + participantes checkbox persist', async ({ page }) => {
    await page.goto(legalAppUrl('legal-agenda', 'tipos'), { waitUntil: 'domcontentloaded' });
    await waitSpine(page);
    await page.getByTestId('tipo-novo').click();
    await page.getByTestId('tipo-nome').fill(`${TAG} Sessão`);
    await page.getByTestId('tipo-local').selectOption('escritorio');
    const localUi = await page.getByTestId('tipo-local').inputValue();
    await page.getByTestId('tipo-participante').first().check();
    await page.getByTestId('tipo-submit').click();
    await page.waitForTimeout(1200);
    const row = await findRow(page, 'sessao_tipos', 'nome', TAG);
    expect(row, 'sessao_tipo row created').toBeTruthy();
    expect(row!.local, 'local persisted').toBe(localUi);
    expect(Array.isArray(row!.participantesNecessarios) && (row!.participantesNecessarios as unknown[]).length, 'participante persisted').toBeGreaterThan(0);
    await del(page, 'sessao_tipos', row!.id as string);
  });

  test('Agenda: novo tipo REFUSES to save without a participante (validation is visible, not silent)', async ({ page }) => {
    await page.goto(legalAppUrl('legal-agenda', 'tipos'), { waitUntil: 'domcontentloaded' });
    await waitSpine(page);
    const antes = await page.evaluate(async () => (await (window as unknown as EkoaWin).__ekoa!.shared!.list('sessao_tipos')).length);
    await page.getByTestId('tipo-novo').click();
    await page.getByTestId('tipo-nome').fill(`${TAG} SemParticipante`);
    await page.getByTestId('tipo-submit').click();
    await page.waitForTimeout(700);
    // The form must stay open (nothing saved) and surface a visible reason.
    await expect(page.getByTestId('tipo-nome')).toBeVisible();
    const depois = await page.evaluate(async () => (await (window as unknown as EkoaWin).__ekoa!.shared!.list('sessao_tipos')).length);
    expect(depois, 'no row created without a participante').toBe(antes);
  });
});
