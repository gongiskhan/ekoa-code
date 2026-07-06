import { test, expect, Page } from '@playwright/test';
import { legalAppUrl, cortexBase } from './helpers/legal';

/**
 * S3-prazos - the Prazos app is the deadline command center: RADAR (by urgency),
 * CALCULADORA (deterministic CPC engine) and the full LIST. All three read/write
 * the SHARED spine (processos seeded by the Núcleo; prazos written here).
 *
 * Coverage:
 *  1. Calculadora golden value: notificação 2026-06-05 + 5 dias úteis ->
 *     dataLimite 2026-06-15 (skips the 10-Jun feriado + weekends), matching the
 *     engine's committed golden test, then persists to the shared spine.
 *  2. Radar buckets: inject fixtures at today-3/today/today+3/today+20 and assert
 *     each lands in the correct bucket with the right dias-restantes text + origem
 *     badge; vencido shows the art. 139.º multa hint; marcar-cumprido persists
 *     across a hard reload; the 7d/30d window toggle reveals the far bucket.
 */
const APP = legalAppUrl('legal-prazos');

/* 'YYYY-MM-DD' local, offset by `days` from today - mirrors the app's diasRestantes basis. */
function ymd(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as any).__ekoa && (window as any).__ekoa.shared),
    undefined,
    { timeout: 20_000 },
  );
}

// injected fixture ids, cleaned up after each test
let injectedIds: string[] = [];

test.afterEach(async ({ page }) => {
  if (injectedIds.length === 0) return;
  try {
    await page.evaluate(async (ids: string[]) => {
      for (const id of ids) {
        try { await (window as any).__ekoa.shared.delete('prazos', id); } catch { /* ignore */ }
      }
    }, injectedIds);
  } catch { /* page may be gone */ }
  injectedIds = [];
});

test('Prazos: calculadora computes a CPC deadline on a shared processo, shows its work, and saves it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${APP}calculadora`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('calculadora-page')).toBeVisible({ timeout: 20_000 });

  // pick a processo from the SHARED spine (seeded by the Núcleo)
  const firstProcesso = page.getByTestId('prazo-processo').locator('option').nth(1);
  await expect(firstProcesso).toBeAttached({ timeout: 15_000 });
  await page.getByTestId('prazo-processo').selectOption(await firstProcesso.getAttribute('value') ?? '');

  // golden input -> known deadline
  await page.getByTestId('prazo-data').fill('2026-06-05');
  await page.getByTestId('prazo-titulo').fill('Contestação');
  await page.getByTestId('prazo-dias').fill('5');
  // contagem defaults to 'uteis'

  await page.getByTestId('calcular').click();

  // the engine computed the correct termo, and shows its work (byte-equal golden)
  const datalimite = page.getByTestId('resultado-datalimite');
  await expect(datalimite).toBeVisible({ timeout: 10_000 });
  await expect(datalimite).toContainText('2026-06-15');
  await expect(page.getByTestId('resultado-passos')).toBeVisible();

  // persist to the shared spine and see it in the recently-saved list
  await page.getByTestId('guardar-prazo').click();
  const lista = page.getByTestId('prazos-lista');
  await expect(lista).toBeVisible({ timeout: 10_000 });
  await expect(lista.getByText('Contestação').first()).toBeVisible({ timeout: 10_000 });
  await expect(lista.getByText('2026-06-15').first()).toBeVisible();

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Prazos: radar buckets fixtures by urgency, shows multa hint, and marcar-cumprido persists', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('radar-page')).toBeVisible({ timeout: 20_000 });
  await waitForSpine(page);

  const suf = Date.now();
  const desc = {
    vencido: `S3 Vencido ${suf}`,
    hoje: `S3 Hoje ${suf}`,
    prox7: `S3 Prox7 ${suf}`,
    prox30: `S3 Prox30 ${suf}`,
  };

  // an existing processo id for the deep-link assertion (spine is seeded by the Núcleo)
  const processoId: string | null = await page.evaluate(async () => {
    const list = await (window as any).__ekoa.shared.list('processos');
    return (Array.isArray(list) && list[0] && list[0].id) || null;
  });

  const fixtures = [
    { descricao: desc.vencido, dataLimite: ymd(-3), estado: 'pendente', origem: 'manual', multaAte: ymd(1), processoId },
    { descricao: desc.hoje, dataLimite: ymd(0), estado: 'pendente', origem: 'citius', processoId },
    { descricao: desc.prox7, dataLimite: ymd(3), estado: 'pendente', origem: 'manual', processoId },
    { descricao: desc.prox30, dataLimite: ymd(20), estado: 'pendente', origem: 'citius', processoId },
  ];

  const ids: string[] = await page.evaluate(async (rows) => {
    const out: string[] = [];
    for (const r of rows) {
      const created = await (window as any).__ekoa.shared.create('prazos', r);
      out.push(created && created.id);
    }
    return out;
  }, fixtures);
  injectedIds = ids.slice();
  const [vencidoId, hojeId, prox7Id, prox30Id] = ids;
  expect(vencidoId && hojeId && prox7Id && prox30Id, 'all fixtures created').toBeTruthy();

  // re-fetch: the radar hooks loaded before injection
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('radar-page')).toBeVisible({ timeout: 20_000 });

  // --- Vencido: red bucket, "há 3 dias", Manual badge, art. 139 multa hint ---
  const vencidoBucket = page.getByTestId('radar-vencidos');
  await expect(vencidoBucket.getByTestId(`prazo-desc-${vencidoId}`)).toHaveText(desc.vencido);
  await expect(page.getByTestId(`prazo-dias-${vencidoId}`)).toHaveText('há 3 dias');
  await expect(page.getByTestId(`prazo-origem-${vencidoId}`)).toHaveText('Manual');
  await expect(page.getByTestId(`prazo-multa-${vencidoId}`)).toContainText('multa até');

  // deep link to the processo in the Núcleo (works on hard reload of that app)
  if (processoId) {
    await expect(page.getByTestId(`prazo-processo-link-${vencidoId}`)).toHaveAttribute(
      'href',
      new RegExp(`/apps/legal-nucleo/processos/${processoId}`),
    );
  }

  // --- Hoje: amber bucket, "hoje", Citius badge ---
  await expect(page.getByTestId('radar-hoje').getByTestId(`prazo-desc-${hojeId}`)).toHaveText(desc.hoje);
  await expect(page.getByTestId(`prazo-dias-${hojeId}`)).toHaveText('hoje');
  await expect(page.getByTestId(`prazo-origem-${hojeId}`)).toHaveText('Citius');

  // --- Próximos 7 dias: today+3 present, today+20 absent (default window) ---
  await expect(page.getByTestId('radar-proximos').getByTestId(`prazo-desc-${prox7Id}`)).toHaveText(desc.prox7);
  await expect(page.getByTestId(`prazo-dias-${prox7Id}`)).toHaveText('em 3 dias');
  await expect(page.getByTestId('radar-proximos').getByTestId(`prazo-desc-${prox30Id}`)).toHaveCount(0);

  // --- Toggle to 30 days: today+20 appears with "em 20 dias" ---
  await page.getByTestId('radar-window-30').click();
  await expect(page.getByTestId('radar-proximos').getByTestId(`prazo-desc-${prox30Id}`)).toHaveText(desc.prox30);
  await expect(page.getByTestId(`prazo-dias-${prox30Id}`)).toHaveText('em 20 dias');

  // --- Marcar cumprido (hoje) with confirm, persists across a hard reload ---
  await page.getByTestId(`marcar-cumprido-${hojeId}`).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Marcar cumprido' }).click();
  await expect(page.getByTestId(`prazo-desc-${hojeId}`)).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('radar-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`prazo-desc-${hojeId}`)).toHaveCount(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Prazos: radar deep link to a Núcleo processo survives a hard reload (base-href)', async ({ page }) => {
  // The radar emits appHref('legal-nucleo', `processos/<id>`). This proves that
  // navigating straight to that deep path and hard-reloading boots the SPA (the
  // platform <base href> fix) rather than 404-ing its assets on a blank page.
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  const processoId: string | null = await page.evaluate(async () => {
    const list = await (window as any).__ekoa.shared.list('processos');
    return (Array.isArray(list) && list[0] && list[0].id) || null;
  });
  test.skip(!processoId, 'no processo in the shared spine to deep-link to');

  const deepPath = `/apps/legal-nucleo/processos/${processoId}`;
  await page.goto(`${cortexBase()}${deepPath}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });

  // URL preserved (no redirect to /) and the Núcleo app shell mounted from the
  // deep path — the shared Layout renders the brand "Núcleo".
  await expect(page).toHaveURL(new RegExp(`/apps/legal-nucleo/processos/${processoId}`));
  await expect(page.locator('.sidebar-brand-text')).toHaveText('Núcleo', { timeout: 20_000 });
});
