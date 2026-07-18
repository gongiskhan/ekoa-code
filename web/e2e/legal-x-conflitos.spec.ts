import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-conflitos - S6 additions to the conflict-of-interest check (art. 99.º
 * EOA). The frozen S-conflitos spec covers single-token substring search, the
 * decision flow, and the exact/partial NIF invariant. THIS spec covers what S6
 * added on top, without disturbing any of that:
 *
 *  1. Deterministic ORDER-INDEPENDENT fuzzy match: a query whose words appear in
 *     the record but in a DIFFERENT order (and thus is NOT a substring) still
 *     matches, and the hit is truthfully flagged "aproximada" (h.parcial). A
 *     plain substring query stays exact (no badge). Recall only widens; the
 *     matcher never invents a hit whose words are absent, and NIF matching is
 *     untouched (still exact-only).
 *  2. The lawyer's decision is persisted to the `conflitos_check` collection.
 *  3. The nucleo hook is LINK-ONLY: a cliente hit renders an anchor whose href
 *     deep-links to /apps/legal-nucleo/clientes/<id>. The app never navigates
 *     there itself - we assert the href, we do not follow it.
 *
 * Seed anchors are the Núcleo-seeded 'Padaria Central, Lda.' (nif 510000028) and
 * processo 342/25.7T8SNT, the same conflict pair the frozen spec relies on.
 * conflitos_check rows created here are tagged in notas and deleted in afterEach.
 */
const APP = legalAppUrl('legal-conflitos');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-conflitos');
mkdirSync(SHOTS, { recursive: true });

const SEED_CLIENTE_NIF = '510000028';
const SEED_PROCESSO = '342/25.7T8SNT';
const SEED_NOME = 'Padaria Central, Lda.';

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  update(collection: string, id: string, patch: Row): Promise<unknown>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

let cleanupTags: string[] = [];

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * The spine is seeded only by the Núcleo. Visit it, wait for the Padaria cliente
 * and processo 342 to exist, and heal the intended contraparte on that processo
 * (older seeds may have it null; seedSpine never backfills a non-empty
 * collection). Mirrors the frozen spec so run order does not matter.
 */
async function ensureSeed(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect
    .poll(
      async () =>
        page.evaluate(
          async ({ nif, proc }) => {
            const s = (window as unknown as SharedWindow).__ekoa?.shared;
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

  await page.evaluate(
    async ({ proc, nome, nif }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
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
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      let rows: Row[] = [];
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

test('Conflitos: correspondencia aproximada por palavras fora de ordem (badge "aproximada")', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await ensureSeed(page);
  await verificarPronto(page);

  const termo = page.getByTestId('conflitos-termo');
  const verificar = page.getByTestId('conflitos-verificar');
  const resultado = page.getByTestId('conflitos-resultado');

  // Baseline: exact substring "Padaria" -> cliente hit WITHOUT the aproximada
  // badge (it is a literal substring of 'Padaria Central, Lda.').
  await termo.fill('Padaria');
  await verificar.click();
  await expect(resultado).toBeVisible({ timeout: 10_000 });
  const exato = resultado.locator('[data-hit-tipo="cliente"]').filter({ hasText: SEED_NOME }).first();
  await expect(exato).toBeVisible();
  await expect(exato.getByTestId('conflitos-hit-aproximada')).toHaveCount(0);

  // Fuzzy: reversed word order "central padaria" is NOT a substring of the name,
  // but both words are present -> still a cliente hit, flagged aproximada.
  await termo.fill('');
  await termo.fill('central padaria');
  await verificar.click();
  const aproximado = resultado.locator('[data-hit-tipo="cliente"]').filter({ hasText: SEED_NOME }).first();
  await expect(aproximado).toBeVisible({ timeout: 10_000 });
  await expect(aproximado.getByTestId('conflitos-hit-aproximada')).toBeVisible();
  await expect(aproximado.getByTestId('conflitos-hit-aproximada')).toContainText('aproximada');

  // The matcher never invents matches: words absent from every record -> no hits.
  await termo.fill('');
  await termo.fill('zzqwx yyplk');
  await verificar.click();
  await expect(page.getByTestId('conflitos-sem-hits')).toBeVisible({ timeout: 10_000 });
  await expect(resultado.getByTestId('conflitos-hit')).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/aproximada.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Conflitos: o hook para o Nucleo e apenas uma ligacao (deep-link, sem navegar)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await ensureSeed(page);
  await verificarPronto(page);

  await page.getByTestId('conflitos-termo').fill('Padaria');
  await page.getByTestId('conflitos-verificar').click();
  const resultado = page.getByTestId('conflitos-resultado');
  await expect(resultado).toBeVisible({ timeout: 10_000 });

  // The cliente hit carries a deep-link anchor into the Núcleo. It is a plain
  // href (link-only hook): assert its shape, do not follow it, and confirm the
  // app stays on the conflitos page.
  const clienteHit = resultado.locator('[data-hit-tipo="cliente"]').filter({ hasText: SEED_NOME }).first();
  await expect(clienteHit).toBeVisible();
  const link = clienteHit.getByTestId('conflitos-hit-link');
  await expect(link).toHaveAttribute('href', /^\/apps\/legal-nucleo\/clientes\/.+/);

  // We never navigate; the conflitos page is still mounted.
  await expect(page.getByTestId('verificar-page')).toBeVisible();

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Conflitos: a decisao do advogado fica persistida na coleccao conflitos_check', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const tag = `E2E-XCONF-${Date.now()}`;
  cleanupTags.push(tag);

  await ensureSeed(page);
  await verificarPronto(page);

  // A unique termo runs a search (zero hits is fine) so the decision block shows.
  await page.getByTestId('conflitos-termo').fill(tag);
  await page.getByTestId('conflitos-verificar').click();

  const select = page.getByTestId('conflitos-decisao-select');
  await expect(select).toBeVisible({ timeout: 10_000 });
  await select.selectOption('sem_conflito');

  const decidido = page.getByTestId('conflitos-decidido-por');
  const decididoTag = await decidido.evaluate((el) => el.tagName.toLowerCase());
  if (decididoTag === 'select') {
    await decidido.selectOption({ index: 1 });
  } else {
    await decidido.fill('Dra. Marília');
  }
  await page.getByTestId('conflitos-notas').fill(`Registo de teste ${tag}`);

  await page.getByTestId('conflitos-registar').click();
  await expect(page.getByTestId('conflitos-sucesso')).toBeVisible({ timeout: 10_000 });

  // Assert the row actually landed in the persisted collection (not just the UI).
  const persisted = await page.evaluate(async (t) => {
    const s = (window as unknown as SharedWindow).__ekoa?.shared;
    if (!s) return null;
    const rows = await s.list('conflitos_check');
    const row = rows.find((r) => typeof r.notas === 'string' && (r.notas as string).includes(t));
    return row ? { termo: row.termo, decisao: row.decisao } : null;
  }, tag);
  expect(persisted).not.toBeNull();
  expect(persisted!.termo).toBe(tag);
  expect(persisted!.decisao).toBe('sem_conflito');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
