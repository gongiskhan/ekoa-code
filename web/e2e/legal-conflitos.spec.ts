import { test, expect, type Page } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * S-conflitos - the Conflitos app is the conflict-of-interest check run before a
 * dossier is opened (art. 99.º EOA). It is DECISION SUPPORT, never a verdict:
 * a client-side search over the SHARED spine (clientes + processos, seeded by the
 * Núcleo) surfaces matches, and the lawyer records the decision into a new
 * `conflitos_check` collection.
 *
 * Coverage, end-to-end through the served app (cortex at /apps/legal-conflitos/):
 *  1. Loads with zero page errors.
 *  2. The seeded-conflict case: searching "Padaria" hits BOTH the cliente
 *     'Padaria Central, Lda.' AND the contraparte of processo 342/25.7T8SNT
 *     (same seeded name); the fold makes "padaria" / "PADARIA" match too.
 *  3. The decision select defaults EMPTY and the register button stays disabled
 *     until a decision is chosen; the art. 99.º positioning note is present;
 *     recording 'conflito_potencial' lands a row in the histórico with the right
 *     badge and responsible.
 *  4. An exact NIF (510000028) hits the cliente; a partial NIF (5100) does not.
 *
 * The seeded rows come from legal-shared/shared.js (CLIENTES_SEED / PROCESSOS_SEED).
 * Each test that records a verification tags its notas so afterEach can delete it.
 */
const APP = legalAppUrl('legal-conflitos');

// Seed anchors — the Núcleo seeds these deterministically.
const SEED_CLIENTE_NIF = '510000028';
const SEED_PROCESSO = '342/25.7T8SNT';
const SEED_NOME = 'Padaria Central, Lda.';

// Minimal shape of the platform-injected shared spine API (window.__ekoa.shared).
type SharedRow = Record<string, unknown>;
interface SharedApi {
  list: (collection: string) => Promise<SharedRow[]>;
  update: (collection: string, id: string, patch: SharedRow) => Promise<unknown>;
  delete: (collection: string, id: string) => Promise<unknown>;
}
type EkoaWindow = Window & { __ekoa?: { shared?: SharedApi } };

// `conflitos_check` rows created by a test, tagged in notas for teardown.
let cleanupTags: string[] = [];

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as EkoaWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/*
 * The shared spine is seeded ONLY by the Núcleo. Visit it to trigger seedSpine()
 * and wait until the Padaria cliente (nif 510000028) and processo 342/25.7T8SNT
 * exist, so the conflict-case assertions have their anchors regardless of the
 * order in which the legal spec files run.
 */
async function ensureSeed(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect
    .poll(
      async () =>
        page.evaluate(
          async ({ nif, proc }) => {
            const s = (window as unknown as EkoaWindow).__ekoa?.shared;
            if (!s) return false;
            const [clientes, processos] = await Promise.all([s.list('clientes'), s.list('processos')]);
            const hasCli = Array.isArray(clientes) && clientes.some((c) => String(c.nif) === nif);
            const hasProc = Array.isArray(processos) && processos.some((p) => p.numeroProcesso === proc);
            return hasCli && hasProc;
          },
          { nif: SEED_CLIENTE_NIF, proc: SEED_PROCESSO },
        ),
      { timeout: 30_000 },
    )
    .toBe(true);

  // Heal the intended seed: processo 342/25.7T8SNT is meant to carry the
  // contraparte 'Padaria Central, Lda.' (same name as a cliente — that IS the
  // conflict). Data seeded before the field was added still has it null, and
  // seedSpine never backfills a non-empty collection, so restore it here. A
  // fresh seed already has it, making this a no-op.
  await page.evaluate(
    async ({ proc, nome, nif }) => {
      const s = (window as unknown as EkoaWindow).__ekoa?.shared;
      if (!s) return;
      const processos = await s.list('processos');
      const p = Array.isArray(processos) ? processos.find((x) => x.numeroProcesso === proc) : null;
      if (p && (!p.contraparte || typeof p.contraparte !== 'object')) {
        try { await s.update('processos', String(p.id), { contraparte: { nome, nif } }); } catch { /* ignore */ }
      }
    },
    { proc: SEED_PROCESSO, nome: SEED_NOME, nif: SEED_CLIENTE_NIF },
  );
}

async function verificarPronto(page: Page) {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('verificar-page')).toBeVisible({ timeout: 20_000 });
  await waitForSpine(page);
}

test.afterEach(async ({ page }) => {
  if (cleanupTags.length === 0) return;
  try {
    await page.evaluate(async (tags) => {
      const s = (window as unknown as EkoaWindow).__ekoa?.shared;
      if (!s) return;
      let rows: SharedRow[] = [];
      try { rows = await s.list('conflitos_check'); } catch { rows = []; }
      for (const r of rows) {
        if (typeof r.notas === 'string' && tags.some((t) => (r.notas as string).includes(t))) {
          try { await s.delete('conflitos_check', String(r.id)); } catch { /* ignore */ }
        }
      }
    }, cleanupTags);
  } catch { /* page may be gone */ }
  cleanupTags = [];
});

test('Conflitos: carrega sem erros de página', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await verificarPronto(page);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Conflitos: "Padaria" acerta cliente + contraparte do processo 342; diacríticos indiferentes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await ensureSeed(page);
  await verificarPronto(page);

  const termo = page.getByTestId('conflitos-termo');
  const resultado = page.getByTestId('conflitos-resultado');

  await termo.fill('Padaria');
  await page.getByTestId('conflitos-verificar').click();
  await expect(resultado).toBeVisible({ timeout: 10_000 });

  // Cliente hit: the seeded 'Padaria Central, Lda.'
  await expect(
    resultado.locator('[data-hit-tipo="cliente"]').filter({ hasText: SEED_NOME }).first(),
  ).toBeVisible();

  // Contraparte hit: same name, referencing processo 342/25.7T8SNT
  const contraparteHit = resultado.locator('[data-hit-tipo="contraparte"]').filter({ hasText: SEED_PROCESSO });
  await expect(contraparteHit.first()).toBeVisible();
  await expect(contraparteHit.first()).toContainText(SEED_NOME);
  await expect(resultado.getByText('Contraparte', { exact: true }).first()).toBeVisible();

  // Diacritics / case: 'padaria' and 'PADARIA' both hit the cliente.
  for (const q of ['padaria', 'PADARIA']) {
    await termo.fill('');
    await termo.fill(q);
    await page.getByTestId('conflitos-verificar').click();
    await expect(
      resultado.locator('[data-hit-tipo="cliente"]').filter({ hasText: SEED_NOME }).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Conflitos: decisão começa vazia + botão bloqueado; regista conflito_potencial no histórico', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const tag = `E2E-CONF-${Date.now()}`;
  cleanupTags.push(tag);

  await ensureSeed(page);
  await verificarPronto(page);

  // A unique termo runs a search (zero hits is fine) so the decision block shows.
  await page.getByTestId('conflitos-termo').fill(tag);
  await page.getByTestId('conflitos-verificar').click();

  // The decision select is EMPTY by default and the register button is disabled.
  const select = page.getByTestId('conflitos-decisao-select');
  await expect(select).toBeVisible({ timeout: 10_000 });
  await expect(select).toHaveValue('');
  await expect(page.getByTestId('conflitos-registar')).toBeDisabled();

  // The art. 99.º positioning note sits under the results.
  await expect(page.getByTestId('conflitos-disclaimer')).toContainText('art. 99.º do EOA');

  // Choose a decision → the button enables.
  await select.selectOption('conflito_potencial');
  await expect(page.getByTestId('conflitos-registar')).toBeEnabled();

  // decididoPor is a pessoas select when the team is seeded, a free-text input otherwise.
  const decidido = page.getByTestId('conflitos-decidido-por');
  const decididoTag = await decidido.evaluate((el) => el.tagName.toLowerCase());
  if (decididoTag === 'select') {
    await decidido.selectOption({ label: 'Dra. Marília' });
  } else {
    await decidido.fill('Dra. Marília');
  }

  await page.getByTestId('conflitos-notas').fill(`Registo de teste ${tag}`);
  await page.getByTestId('conflitos-registar').click();

  // Success state, then the row lands in the histórico with the right badge.
  await expect(page.getByTestId('conflitos-sucesso')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('conflitos-ir-historico').click();
  await expect(page.getByTestId('historico-page')).toBeVisible({ timeout: 10_000 });

  const row = page.getByTestId('conflitos-historico-row').filter({ hasText: tag });
  await expect(row.first()).toBeVisible({ timeout: 10_000 });
  await expect(row.first().getByTestId('conflitos-historico-decisao')).toHaveText('Conflito potencial');
  await expect(row.first()).toContainText('Dra. Marília');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Conflitos: NIF exacto acerta o cliente; NIF parcial não gera correspondência', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await ensureSeed(page);
  await verificarPronto(page);

  const nif = page.getByTestId('conflitos-nif');
  const verificar = page.getByTestId('conflitos-verificar');
  const resultado = page.getByTestId('conflitos-resultado');

  // Exact NIF → cliente hit.
  await nif.fill(SEED_CLIENTE_NIF);
  await verificar.click();
  await expect(resultado).toBeVisible({ timeout: 10_000 });
  await expect(
    resultado.locator('[data-hit-tipo="cliente"]').filter({ hasText: SEED_NOME }).first(),
  ).toBeVisible();

  // Partial NIF → no correspondence at all.
  await nif.fill('');
  await nif.fill('5100');
  await verificar.click();
  await expect(page.getByTestId('conflitos-sem-hits')).toBeVisible({ timeout: 10_000 });
  await expect(resultado.getByTestId('conflitos-hit')).toHaveCount(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
