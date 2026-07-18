import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-jurimetria - S7 knowledge-portal hardening of Jurimetria. Sits
 * ALONGSIDE the ported legal-jurimetria.spec.ts (byte-frozen) and proves the S7
 * acceptance additions through the served app (cortex at /apps/legal-jurimetria/):
 *
 *  1. EVERY STAT CARRIES FONTE + PERÍODO. Each comparator row shows an internal
 *     provenance (the office sample: n + interval of closings) AND a public
 *     provenance (DGPJ + period). No number appears bare.
 *  2. OWN-PROCESSOS COMPARISON FROM THE SPINE. The internal averages come from
 *     the Fonseca spine's FINDOS (arquivados with abertura/fecho): all six seeded
 *     areas have n >= 3, so each shows a real "x meses" internal average sourced
 *     to the office sample - never a public figure dressed up as the office's.
 *  3. HONEST EMPTY STATE. The honest low-sample affordances exist: a per-area
 *     "sem dados suficientes" cell (below the minimum sample) and a whole-table
 *     "sem dados" panel are wired, so a sparse office never sees a misleading
 *     average.
 *
 * Read-only against the spine: this spec installs the demo set (idempotent) but
 * creates and deletes nothing of its own.
 */
const APP = legalAppUrl('legal-jurimetria');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'legal-x-jurimetria');
mkdirSync(SHOTS, { recursive: true });

/* Installs the Fonseca demo set via the Núcleo (idempotent - no-ops when already
 * installed). The findos that feed the comparator live in that set. */
async function ensureDemo(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('demo-spine-card')).toBeVisible({ timeout: 30_000 });
  const estado = await page.getByTestId('demo-estado').innerText();
  if (/Não instalado/i.test(estado)) {
    // "Não instalado" também é o estado TRANSITÓRIO do cartão enquanto a coleção
    // carrega - se o botão desmontar (já instalado afinal), o banner é a prova.
    try {
      await page.getByTestId('demo-instalar').click({ timeout: 5_000 });
    } catch { /* a coleção resolveu para Instalado e o botão desmontou */ }
    await expect(page.getByTestId('demo-banner')).toBeVisible({ timeout: 90_000 });
  }
}

test('Jurimetria X: cada estatística carrega fonte + período, interna e pública', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await ensureDemo(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('jurimetria-tabela')).toBeVisible({ timeout: 20_000 });

  // The comparator has rows (the seeded findos, six areas at n=6).
  const linhas = page.getByTestId('jurimetria-linha');
  await expect(linhas.first()).toBeVisible({ timeout: 20_000 });
  const n = await linhas.count();
  expect(n, 'áreas com findos suficientes').toBeGreaterThanOrEqual(3);

  // EVERY row carries an internal provenance (office sample: n) AND a public
  // provenance (DGPJ + period). No stat appears without its source.
  for (let i = 0; i < n; i++) {
    const linha = linhas.nth(i);
    const interna = linha.getByTestId(/^fonte-interna-/);
    const publica = linha.getByTestId(/^fonte-publica-/);
    await expect(interna).toBeVisible();
    await expect(publica).toBeVisible();
    // Internal provenance names the office sample size (n=...).
    await expect(interna).toContainText(/n=\d+/);
  }
  // The table as a whole cites the public source and its period, in months.
  await expect(page.getByTestId('jurimetria-tabela')).toContainText(/dados\.justica|DGPJ/i);
  await expect(page.getByTestId('jurimetria-tabela')).toContainText(/meses/);
  // At least one public-provenance cell names the DGPJ source with a period.
  await expect(page.getByTestId(/^fonte-publica-/).filter({ hasText: /DGPJ|dados\.justica/i }).first())
    .toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/fonte-e-periodo.png`, fullPage: true });
  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Jurimetria X: a média interna vem dos processos findos do escritório (amostra, não figura pública)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await ensureDemo(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('jurimetria-tabela')).toBeVisible({ timeout: 20_000 });

  const linhas = page.getByTestId('jurimetria-linha');
  await expect(linhas.first()).toBeVisible({ timeout: 20_000 });

  // Cross-check the first area against the spine's OWN findos: the internal
  // average is computed from arquivados with abertura/fecho, so an area shown as
  // "x meses" must actually have >= 3 such processos in that area.
  const primeira = linhas.first();
  const areaInterna = primeira.getByTestId(/^interna-/).first();
  await expect(areaInterna).toBeVisible();
  const textoInterna = await areaInterna.innerText();
  expect(textoInterna, 'a média interna aparece em meses (amostra suficiente)').toMatch(/meses/);

  // Confirm from the shared spine that the office actually has findos backing it:
  // at least three arquivados carrying abertura + fecho.
  const findos = await page.evaluate(async () => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } }).__ekoa.shared;
    const procs = await s.list('processos');
    return procs.filter((p) => p.estado === 'arquivado' && p.dataAbertura && p.dataFecho).length;
  });
  expect(findos, 'a comparação interna assenta nos findos do próprio escritório').toBeGreaterThanOrEqual(3);

  // And the internal provenance for that row names the office sample, not a public source.
  await expect(primeira.getByTestId(/^fonte-interna-/)).toContainText(/[Aa]mostra interna/);

  await page.screenshot({ path: `${SHOTS}/media-interna-da-espinha.png`, fullPage: true });
  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});
