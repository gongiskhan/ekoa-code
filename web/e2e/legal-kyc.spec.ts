import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * S-kyc — the KYC / diligência satellite over the SHARED spine (Lei n.º 83/2017).
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-kyc/):
 *  1. The Fichas list renders the seeded ficha (Padaria Central, risco baixo) with
 *     zero pageerrors.
 *  2. Golden THROUGH THE UI: a nova ficha for Construções Horizonte (empresa, país
 *     médio, societário, presencial) scores 10+15+15 = 40, banda médio — the exact
 *     numbers asserted in the DOM.
 *  3. Aplicabilidade: consulta jurídica shows "fora do âmbito" + the art. 4.º fundamento.
 *  4. RCBE paste-back: a multi-beneficiário extract WITH the plural header
 *     "Beneficiários efetivos:" parses to exactly 2 owners (no phantom) with exact names.
 *  5. Aprovar stamps arquivarAte exactly +7 years (art. 51.º), the delete affordance is
 *     absent, and the audit timeline holds criada + aprovada.
 *
 * Deterministic + self-cleaning: test 5 injects its own tagged kyc_ficha + criada
 * evento via window.__ekoa.shared and deletes every referencing row in afterEach; it
 * NEVER touches the seeded ficha. Tests 1-4 rely on the Núcleo seed, which
 * ensureSeeded() guarantees by opening the Núcleo once.
 */
const APP = legalAppUrl('legal-kyc');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 's-kyc');
mkdirSync(SHOTS, { recursive: true });

type Ctx = { nonce: string; fichaIds: string[] };
const ctx: Ctx = { nonce: '', fichaIds: [] };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __ekoa?: { shared?: unknown } }).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/* Opens the Núcleo once (it, and only it, seeds the spine) and waits until the
 * shared clientes + kyc_fichas collections are populated — so the satellite specs
 * read a seeded spine regardless of prior state. Idempotent. */
async function ensureSeeded(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.waitForFunction(async () => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<unknown[]> } } }).__ekoa.shared;
    const [clientes, fichas] = await Promise.all([s.list('clientes'), s.list('kyc_fichas')]);
    return Array.isArray(clientes) && clientes.length >= 6 && Array.isArray(fichas) && fichas.length >= 1;
  }, undefined, { timeout: 30_000 });
}

/* 'YYYY-MM-DD' local. */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* Independent re-implementation of the engine's +7y rule, so the test derives the
 * expected arquivarAte itself rather than trusting the app's own function. */
function prazoMais7(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const ty = y + 7;
  const isLeap = (ty % 4 === 0 && ty % 100 !== 0) || ty % 400 === 0;
  const dd = m === 2 && d === 29 && !isLeap ? 28 : d;
  return `${ty}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/* Selects the option in a native <select> whose visible text contains `text`. */
async function selectByText(page: Page, testid: string, text: string) {
  const select = page.getByTestId(testid);
  const value = await select.locator('option', { hasText: text }).first().getAttribute('value');
  expect(value, `option "${text}" exists in ${testid}`).toBeTruthy();
  await select.selectOption(value as string);
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ fichaIds }) => {
      const s = (window as unknown as { __ekoa?: { shared?: { list: (c: string) => Promise<Array<Record<string, unknown>>>; delete: (c: string, id: string) => Promise<unknown> } } }).__ekoa?.shared;
      if (!s) return;
      // Delete the injected fichas and every evento that references them. Never
      // the seeded ficha (its id is not in fichaIds).
      let eventos: Array<Record<string, unknown>> = [];
      try { eventos = await s.list('kyc_eventos'); } catch { eventos = []; }
      for (const e of eventos) {
        if (typeof e.fichaId === 'string' && fichaIds.includes(e.fichaId)) {
          try { await s.delete('kyc_eventos', e.id as string); } catch { /* ignore */ }
        }
      }
      for (const id of fichaIds) {
        try { await s.delete('kyc_fichas', id); } catch { /* ignore */ }
      }
    }, { fichaIds: ctx.fichaIds });
  } catch { /* page may be gone - ignore */ }
  ctx.fichaIds = [];
});

test('KYC: a lista de fichas mostra a ficha semeada (Padaria Central, risco baixo), sem erros', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `KYC-${Date.now()}`;

  await ensureSeeded(page);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('fichas-page')).toBeVisible({ timeout: 20_000 });

  const tabela = page.getByTestId('kyc-fichas-tabela');
  await expect(tabela.getByText('Padaria Central', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(tabela.getByText('Risco baixo', { exact: false }).first()).toBeVisible();
  // The conservation banner explains the 7-year rule (why there is no delete).
  await expect(page.getByTestId('kyc-conservacao')).toContainText('7 anos');

  await page.screenshot({ path: `${SHOTS}/fichas.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('KYC: golden pela UI — Construções Horizonte, empresa, país médio, societário -> 10+15+15 = 40, banda médio', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `KYC-${Date.now()}`;

  await ensureSeeded(page);

  await page.goto(`${APP}nova`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('nova-ficha-page')).toBeVisible({ timeout: 20_000 });

  // (0) aplicabilidade: default serviço imobiliário is applicable -> advance.
  await page.getByTestId('kyc-servico-avancar').click();

  // (1) identificação: pick the company + the risk factors from the golden case.
  await expect(page.getByTestId('kyc-cliente')).toBeVisible({ timeout: 15_000 });
  await selectByText(page, 'kyc-cliente', 'Construções Horizonte');
  await page.getByTestId('kyc-tipo').selectOption('empresa');
  await page.getByTestId('kyc-pais').selectOption('medio');
  await page.getByTestId('kyc-natureza').selectOption('societario');
  // relacaoPresencial stays checked (default) -> no +10.
  await page.getByTestId('kyc-avancar').click();

  // (2) risco: the deterministic engine, numbers asserted in the DOM.
  const panel = page.getByTestId('kyc-risco');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('kyc-base')).toHaveText('10');
  await expect(page.getByTestId('kyc-score')).toHaveText('40');
  await expect(page.getByTestId('kyc-banda')).toContainText('médio');
  // The two contributing factors each add +15 (país + natureza).
  await expect(panel.getByText('+15', { exact: true })).toHaveCount(2);
  // The "shows its work" panel spells out the total.
  await expect(page.getByTestId('kyc-explicacao')).toContainText('Score total: 40');

  await page.screenshot({ path: `${SHOTS}/risco-golden.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('KYC: aplicabilidade — consulta jurídica fica fora do âmbito, com fundamento (art. 4.º)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `KYC-${Date.now()}`;

  await page.goto(`${APP}nova`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('nova-ficha-page')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('kyc-servico').selectOption('consulta_juridica');
  await expect(page.getByTestId('kyc-aplica')).toContainText('Fora do âmbito');
  await expect(page.getByTestId('kyc-fundamento')).toContainText('art. 4.º');
  await expect(page.getByTestId('kyc-fundamento')).toContainText('consulta jurídica');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('KYC: RCBE colado — o cabeçalho plural não gera fantasma; extrai exatamente 2 beneficiários', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `KYC-${Date.now()}`;

  await ensureSeeded(page);

  await page.goto(`${APP}nova`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('nova-ficha-page')).toBeVisible({ timeout: 20_000 });

  // Drive to the RCBE step with a company (RCBE applies to legal entities).
  await page.getByTestId('kyc-servico-avancar').click();
  await expect(page.getByTestId('kyc-cliente')).toBeVisible({ timeout: 15_000 });
  await selectByText(page, 'kyc-cliente', 'Construções Horizonte');
  await page.getByTestId('kyc-tipo').selectOption('empresa');
  await page.getByTestId('kyc-avancar').click();
  await expect(page.getByTestId('kyc-risco')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('kyc-risco-avancar').click();

  // Paste an extract whose PLURAL header must NOT open a phantom owner block.
  const extract = [
    'Entidade: Construções Horizonte, S.A.',
    'NIPC: 512334455',
    '',
    'Beneficiários efetivos:',
    '',
    'Beneficiário efetivo n.º 1',
    'Nome: Ana Maria Rebelo Horizonte',
    'NIF: 210000099',
    '',
    'Beneficiário efetivo n.º 2',
    'Nome: Carlos Duarte Horizonte',
    'NIF: 245000188',
  ].join('\n');

  await page.getByTestId('kyc-rcbe-texto').fill(extract);
  await page.getByTestId('kyc-rcbe-parse').click();

  const rcbe = page.getByTestId('kyc-rcbe');
  await expect(rcbe).toBeVisible({ timeout: 15_000 });
  // Exactly two owners — the plural header produced no phantom third row.
  await expect(page.getByTestId('kyc-rcbe-lista').locator('> li')).toHaveCount(2);
  await expect(page.getByTestId('kyc-beneficiario-nome-0')).toHaveValue('Ana Maria Rebelo Horizonte');
  await expect(page.getByTestId('kyc-beneficiario-nome-1')).toHaveValue('Carlos Duarte Horizonte');

  await page.screenshot({ path: `${SHOTS}/rcbe.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('KYC: aprovar carimba o arquivo a +7 anos, sem afordância de eliminação, com auditoria criada+aprovada', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `KYC-${Date.now()}`;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  // Inject a tagged ficha em análise + its criada evento (deterministic, cleaned up).
  const fichaId = await page.evaluate(async ({ nonce }) => {
    const s = (window as unknown as { __ekoa: { shared: {
      list: (c: string) => Promise<Array<Record<string, unknown>>>;
      create: (c: string, d: unknown) => Promise<{ id: string }>;
    } } }).__ekoa.shared;
    const clientes = await s.list('clientes');
    const cli = clientes.find((c) => c.tipo === 'empresa') || clientes[0];
    const ficha = await s.create('kyc_fichas', {
      clienteId: cli.id,
      tipoCliente: 'empresa',
      tipoServico: 'societario',
      pep: false,
      paisRisco: 'medio',
      naturezaOperacao: 'societario',
      relacaoPresencial: true,
      risco: 'medio',
      score: 40,
      riscoBreakdown: [{ fator: 'País de risco', peso: 15, nota: 'teste' }],
      estado: 'em_analise',
      rcbe: { estado: 'pendente' },
      arquivarAte: null,
      __kycTest: nonce,
    });
    await s.create('kyc_eventos', { fichaId: ficha.id, tipo: 'criada', data: new Date().toISOString(), detalhe: 'Ficha criada (teste).' });
    return ficha.id;
  }, { nonce: ctx.nonce });
  ctx.fichaIds.push(fichaId);

  await page.goto(`${APP}ficha/${fichaId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('ficha-detail')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ficha-estado')).toContainText('Em análise');

  // Approve via the UI.
  await page.getByTestId('ficha-aprovar').click();
  await expect(page.getByTestId('ficha-estado')).toContainText('Aprovada', { timeout: 15_000 });

  // arquivarAte is stamped exactly +7 years from today (art. 51.º).
  const today = ymd(new Date());
  const expected = prazoMais7(today);
  const stored = await page.evaluate(async (id) => {
    const s = (window as unknown as { __ekoa: { shared: { get: (c: string, id: string) => Promise<Record<string, unknown> | null> } } }).__ekoa.shared;
    const f = await s.get('kyc_fichas', id);
    return f ? (f.arquivarAte as string | null) : null;
  }, fichaId);
  expect(stored).toBe(expected);

  // The audit timeline holds both events, append-only.
  await expect(page.getByTestId('kyc-evento-criada')).toBeVisible();
  await expect(page.getByTestId('kyc-evento-aprovada')).toBeVisible();

  // No delete affordance anywhere on the ficha (7-year retention) — and the
  // aprovar/recusar actions are gone once decided.
  await expect(page.getByRole('button', { name: /eliminar|apagar|remover/i })).toHaveCount(0);
  await expect(page.getByTestId('ficha-aprovar')).toHaveCount(0);
  await expect(page.getByTestId('ficha-recusar')).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/aprovada.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
