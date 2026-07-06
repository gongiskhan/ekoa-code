import { test, expect, type Page } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * S2-nucleo - the Núcleo CRM hub, end-to-end through the SHARED spine.
 *
 * The app (served by cortex at /apps/legal-nucleo/) seeds the account-shared
 * spine via window.__ekoa.shared and drives a multi-view CRM on top of it:
 * dashboard KPIs + radar, Clientes/Processos lists with detail pages, an RGPD
 * block, a Tarefas board with one-click complete, and a global search. Every
 * write persists in the owner-shared namespace across a hard reload, and every
 * detail route is deep-linkable. Specs tolerate the pre-existing seed data.
 */
const BASE = legalAppUrl('legal-nucleo').replace(/\/$/, '');
const APP = `${BASE}/`;

function attachErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function openDashboard(page: Page) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 20_000 });
}

async function openClientes(page: Page) {
  await page.getByTestId('nav-clientes').click();
  await expect(page.getByTestId('clientes-page')).toBeVisible({ timeout: 15_000 });
}

// Shared-namespace helpers - run inside the served app so window.__ekoa exists.
async function createShared(page: Page, collection: string, data: unknown): Promise<any> {
  return page.evaluate(
    ([c, d]) => (window as any).__ekoa.shared.create(c, d),
    [collection, data] as const,
  );
}
async function deleteShared(page: Page, collection: string, id: string): Promise<void> {
  await page.evaluate(
    ([c, i]) => (window as any).__ekoa.shared.delete(c, i),
    [collection, id] as const,
  );
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('Núcleo: spine seeds + Clientes/Processos CRUD persists (FK-linked)', async ({ page }) => {
  const errors = attachErrors(page);

  await openDashboard(page);

  // The spine is seeded (shared-namespace READ): the two anchor clientes show.
  await openClientes(page);
  await expect(page.getByText('Marília Costa')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Padaria Central, Lda.')).toBeVisible();

  // CREATE a unique cliente (shared-namespace WRITE) → lands on its detail page.
  const nome = `Cliente E2E ${Date.now()}`;
  await page.getByTestId('novo-cliente').click();
  await page.getByTestId('cliente-nome').fill(nome);
  await page.getByTestId('cliente-nif').fill('299999990');
  await page.getByTestId('guardar-cliente').click();
  await expect(page).toHaveURL(/\/clientes\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByTestId('cliente-detail').getByRole('heading', { name: nome })).toBeVisible();

  // PERSISTS across a hard reload (the data lives in the shared namespace).
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('cliente-detail')).toBeVisible({ timeout: 15_000 });
  await openClientes(page);
  await expect(page.getByText(nome)).toBeVisible({ timeout: 15_000 });

  // PROCESSO linked to that cliente (the FK), also in the shared spine.
  await page.getByTestId('nav-processos').click();
  await expect(page.getByTestId('processos-page')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('novo-processo').click();
  const opt = page.getByTestId('processo-cliente').locator('option', { hasText: nome });
  await expect(opt).toBeAttached({ timeout: 10_000 });
  await page.getByTestId('processo-cliente').selectOption(await opt.getAttribute('value') ?? '');
  const numero = `9000/${Date.now() % 1000}.0T8XXX`;
  await page.getByTestId('processo-numero').fill(numero);
  await page.getByTestId('processo-tribunal').fill('Juízo Local Cível de Sintra');
  await page.getByTestId('guardar-processo').click();
  await expect(page).toHaveURL(/\/processos\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByTestId('processo-detail').getByRole('heading', { name: numero })).toBeVisible();

  // HIGIENE: os registos "Cliente E2E <ts>" são artefactos deste teste - sem
  // esta limpeza cada execução deixa um cliente real na espinha e os selects
  // das outras apps (p.ex. o wizard de Contratos) enchem-se de lixo. Varre
  // também fugas de execuções antigas. Corre depois das asserções.
  const clientes = (await page.evaluate(() => (window as any).__ekoa.shared.list('clientes'))) as Array<{ id: string; nome?: string }>;
  const processos = (await page.evaluate(() => (window as any).__ekoa.shared.list('processos'))) as Array<{ id: string; clienteId?: string }>;
  for (const c of clientes.filter((r) => /^Cliente E2E \d+$/.test(String(r.nome)))) {
    for (const p of processos.filter((r) => r.clienteId === c.id)) {
      await deleteShared(page, 'processos', p.id);
    }
    await deleteShared(page, 'clientes', c.id);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Núcleo: dashboard KPI row + radar render', async ({ page }) => {
  const errors = attachErrors(page);
  await openDashboard(page);

  const kpiRow = page.getByTestId('kpi-row');
  await expect(kpiRow).toBeVisible();
  await expect(page.getByTestId('kpi-processos-ativos')).toBeVisible();
  await expect(page.getByTestId('kpi-prazos-vencidos')).toBeVisible();
  await expect(page.getByTestId('kpi-tarefas-hoje')).toBeVisible();
  // KPI values are numeric.
  await expect(page.getByTestId('kpi-processos-ativos-value')).toHaveText(/^\d+$/);

  // Radar shows seeded pending prazos with a deep link into Prazos.
  await expect(page.getByTestId('radar-widget')).toBeVisible();
  await expect(page.getByTestId('radar-ver-todos')).toHaveAttribute('href', '/apps/legal-prazos/');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Núcleo: cliente detail RGPD block saves and persists', async ({ page }) => {
  const errors = attachErrors(page);
  await openDashboard(page);

  const stamp = Date.now();
  const cliente = await createShared(page, 'clientes', {
    nome: `RGPD Teste ${stamp}`, nif: '288888880', tipo: 'particular', email: `rgpd${stamp}@exemplo.pt`,
  });
  expect(cliente?.id).toBeTruthy();

  const consent = todayPlus(0);
  const nota = `Consentimento recolhido em consulta (${stamp}).`;
  try {
    await page.goto(`${BASE}/clientes/${cliente.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('rgpd-block')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('rgpd-base').selectOption('consentimento');
    await page.getByTestId('rgpd-consentimento').fill(consent);
    await page.getByTestId('rgpd-nota').fill(nota);
    await page.getByTestId('rgpd-guardar').click();

    // PERSISTS across a hard reload of the deep link.
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('rgpd-block')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('rgpd-base')).toHaveValue('consentimento');
    await expect(page.getByTestId('rgpd-consentimento')).toHaveValue(consent);
    await expect(page.getByTestId('rgpd-nota')).toHaveValue(nota);
  } finally {
    await deleteShared(page, 'clientes', cliente.id);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Núcleo: processo detail exposes the Abrir dossiê deep link', async ({ page }) => {
  const errors = attachErrors(page);
  await openDashboard(page);

  const stamp = Date.now();
  const cliente = await createShared(page, 'clientes', { nome: `Dossiê Cli ${stamp}`, nif: '277777770', tipo: 'empresa' });
  const processo = await createShared(page, 'processos', {
    numeroProcesso: `700/${stamp % 1000}.0T8DOS`, tribunal: 'Juízo Central Cível do Porto', area: 'Cível', estado: 'ativo', clienteId: cliente.id,
  });
  try {
    await page.goto(`${BASE}/processos/${processo.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('processo-detail')).toBeVisible({ timeout: 15_000 });
    const dossie = page.getByTestId('abrir-dossie');
    await expect(dossie).toBeVisible();
    await expect(dossie).toHaveAttribute('href', `/apps/legal-dossie/processo/${processo.id}`);

    // Hard reload of the deep link still resolves the app bundle + route
    // (relies on the served index.html base tag, not just SPA history).
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('processo-detail')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('abrir-dossie')).toHaveAttribute('href', `/apps/legal-dossie/processo/${processo.id}`);
  } finally {
    await deleteShared(page, 'processos', processo.id);
    await deleteShared(page, 'clientes', cliente.id);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Núcleo: create tarefa lands in the right group and one-click complete persists', async ({ page }) => {
  const errors = attachErrors(page);
  await openDashboard(page);

  await page.getByTestId('nav-tarefas').click();
  await expect(page.getByTestId('tarefas-page')).toBeVisible({ timeout: 15_000 });

  const titulo = `Tarefa E2E ${Date.now()}`;
  await page.getByTestId('nova-tarefa').click();
  await page.getByTestId('tarefa-titulo').fill(titulo);
  await page.getByTestId('tarefa-prazo').fill(todayPlus(3)); // → "Esta semana"
  await page.getByTestId('tarefa-urgencia').selectOption('alta');
  await page.getByTestId('guardar-tarefa').click();

  // Appears in the "Esta semana" group.
  const semana = page.getByTestId('grupo-semana');
  await expect(semana).toBeVisible({ timeout: 15_000 });
  await expect(semana.getByText(titulo)).toBeVisible();

  // One-click complete. Clicking triggers an async update+refresh; the card then
  // leaves the active "Esta semana" group - waiting for that both confirms the
  // completion persisted server-side and guarantees the write finished before we reload.
  await page.getByLabel(`Concluir tarefa: ${titulo}`).click();
  await expect(semana.getByText(titulo)).toHaveCount(0, { timeout: 10_000 });

  // PERSISTS across a hard reload: gone from the active view, present as concluded.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByTestId('tarefas-page')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Concluídas' }).click();
  const concluidas = page.getByTestId('grupo-concluidas');
  await expect(concluidas).toBeVisible({ timeout: 15_000 });
  await expect(concluidas.getByText(titulo)).toBeVisible();

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Núcleo: global search finds a cliente and a processo', async ({ page }) => {
  const errors = attachErrors(page);
  await openDashboard(page);

  const token = `ZZ${Date.now() % 100000}`;
  const cliente = await createShared(page, 'clientes', { nome: `Busca ${token}`, nif: '266666660', tipo: 'particular' });
  const processo = await createShared(page, 'processos', {
    numeroProcesso: `${token}/26.0T8ZZZ`, tribunal: 'Juízo Local de Faro', area: 'Cível', estado: 'ativo', clienteId: cliente.id,
  });
  try {
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 15_000 });

    // Accent-insensitive: an unaccented query matches the accented seed name.
    await page.getByTestId('global-search').fill('marilia');
    await expect(
      page.getByTestId('global-search-result').filter({ hasText: 'Marília Costa' }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('global-search').fill(token);
    const results = page.getByTestId('global-search-result');
    // Scope by kind label - the processo result's subtitle repeats the client
    // name, so filtering on the name alone would match both rows.
    const clienteResult = results.filter({ hasText: 'Cliente' }).filter({ hasText: token });
    const processoResult = results.filter({ hasText: 'Processo' }).filter({ hasText: token });
    await expect(clienteResult).toBeVisible({ timeout: 10_000 });
    await expect(processoResult).toBeVisible();

    // Clicking a result deep-links to the entity.
    await clienteResult.click();
    await expect(page).toHaveURL(new RegExp(`/clientes/${cliente.id}$`), { timeout: 10_000 });
    await expect(page.getByTestId('cliente-detail')).toBeVisible();
  } finally {
    await deleteShared(page, 'processos', processo.id);
    await deleteShared(page, 'clientes', cliente.id);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Núcleo: a processo-only tarefa derives the cliente onto its hub', async ({ page }) => {
  const errors = attachErrors(page);
  await openDashboard(page);

  const stamp = Date.now();
  const cliente = await createShared(page, 'clientes', { nome: `Deriva Cli ${stamp}`, nif: '255555550', tipo: 'empresa' });
  const processo = await createShared(page, 'processos', {
    numeroProcesso: `800/${stamp % 1000}.0T8DER`, tribunal: 'Juízo Local de Aveiro', area: 'Cível', estado: 'ativo', clienteId: cliente.id,
  });
  const titulo = `Tarefa Deriva ${stamp}`;
  try {
    await page.goto(`${BASE}/tarefas`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('tarefas-page')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('nova-tarefa').click();
    await page.getByTestId('tarefa-titulo').fill(titulo);
    // Pick ONLY the processo (no cliente) - the cliente must be derived from it.
    await page.getByTestId('tarefa-processo').selectOption(processo.id);
    await page.getByTestId('tarefa-prazo').fill(todayPlus(2));
    await page.getByTestId('guardar-tarefa').click();
    await expect(page.getByTestId('tarefa-form')).toHaveCount(0, { timeout: 10_000 });

    // The derived clienteId lands the tarefa on the cliente's hub tarefas list.
    await page.goto(`${BASE}/clientes/${cliente.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('cliente-detail')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(titulo)).toBeVisible({ timeout: 10_000 });
  } finally {
    await page.evaluate(async (t) => {
      const list = await window.__ekoa.shared.list('tarefas');
      for (const row of list) if (row.titulo === t) await window.__ekoa.shared.delete('tarefas', row.id);
    }, titulo);
    await deleteShared(page, 'processos', processo.id);
    await deleteShared(page, 'clientes', cliente.id);
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
