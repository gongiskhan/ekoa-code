import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-prazos - S2 deadline layer of the Prazos app over the SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-prazos/):
 *  1. .ics export of pending prazos: deterministic bytes (two consecutive
 *     downloads identical), fixed PRODID, Europe/Lisbon declared, UID derived
 *     from the spine row id (prazo-<id>@ekoa-legal), all-day VEVENT with a
 *     VALARM at D-2 (TRIGGER:-P2D), CRLF-only; 'cumprido' rows and rows
 *     without a valid dataLimite are honestly left out of the file.
 *  2. Ferias judiciais view: engine-derived periods (Pascoa moveis for 2026),
 *     the LOSJ art. 28.º citation, the CIRE contrast note, and the year switch.
 *  3. Memoria de calculo PDF: the frozen golden calculadora flow (2026-06-05
 *     + 5 uteis -> 2026-06-15) exports a real PDF via the platform exportPdf
 *     bridge with a deterministic filename.
 *
 * Deterministic + self-cleaning: injected prazos carry a per-run nonce in the
 * descricao and are deleted in afterEach; the memoria test writes nothing.
 */
const APP = legalAppUrl('legal-prazos');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-prazos');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

const ctx: { nonce: string } = { nonce: '' };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/** Unfold RFC 5545 folded lines so content assertions are not split mid-word. */
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '');
}

async function downloadText(download: { path(): Promise<string | null> }): Promise<string> {
  const p = await download.path();
  return readFileSync(p as string, 'utf-8');
}

test.afterEach(async ({ page }) => {
  if (!ctx.nonce) return;
  try {
    await page.evaluate(async (nonce) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      let rows: Row[] = [];
      try { rows = await s.list('prazos'); } catch { rows = []; }
      for (const r of rows) {
        if (typeof r.descricao === 'string' && r.descricao.includes(nonce)) {
          try { await s.delete('prazos', String(r.id)); } catch { /* ignore */ }
        }
      }
    }, ctx.nonce);
  } catch { /* page may be gone - ignore */ }
  ctx.nonce = '';
});

test('Prazos: exportar .ics dos pendentes e determinista, com VALARM D-2 e exclusoes honestas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XP1-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(`${APP}prazos`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('exportar-ics')).toBeVisible({ timeout: 20_000 });

  // A: pendente with a valid dataLimite -> in the file. B: cumprido -> out.
  // C: pendente without dataLimite -> honestly ignored (never a broken VEVENT).
  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const a = await s.create('prazos', {
      descricao: `Prazo A ${n}`, dataLimite: '2026-09-14', estado: 'pendente', origem: 'manual',
    });
    const b = await s.create('prazos', {
      descricao: `Prazo B ${n}`, dataLimite: '2026-09-15', estado: 'cumprido', origem: 'manual',
    });
    const c = await s.create('prazos', {
      descricao: `Prazo C ${n}`, dataLimite: '', estado: 'pendente', origem: 'manual',
    });
    return { a: String(a.id), b: String(b.id), c: String(c.id) };
  }, nonce);

  await page.goto(`${APP}prazos`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('exportar-ics')).toBeEnabled({ timeout: 20_000 });

  // Two consecutive exports must be byte-identical (no now()-derived content).
  const [d1] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByTestId('exportar-ics').click(),
  ]);
  const [d2] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByTestId('exportar-ics').click(),
  ]);
  expect(d1.suggestedFilename()).toBe('prazos-pendentes.ics');
  const ics1 = await downloadText(d1);
  const ics2 = await downloadText(d2);
  expect(ics1, 'two consecutive exports are byte-identical').toBe(ics2);

  const plano = unfold(ics1);
  expect(plano).toContain('PRODID:-//Ekoa Legal//legal-prazos//PT');
  expect(plano).toContain('X-WR-TIMEZONE:Europe/Lisbon');
  expect(plano).toContain('BEGIN:VTIMEZONE');

  // The pending prazo is an all-day VEVENT with the D-2 display alarm.
  expect(plano).toContain(`UID:prazo-${injected.a}@ekoa-legal`);
  expect(plano).toContain('DTSTART;VALUE=DATE:20260914');
  expect(plano).toContain('DTEND;VALUE=DATE:20260915');
  expect(plano).toContain(`SUMMARY:Prazo: Prazo A ${nonce}`);
  expect(plano).toContain('TRIGGER:-P2D');
  expect(plano).toContain(`DESCRIPTION:D-2: Prazo A ${nonce}`);

  // Honest exclusions: the cumprido row and the row without dataLimite are out.
  expect(plano).not.toContain(`UID:prazo-${injected.b}@ekoa-legal`);
  expect(plano).not.toContain(`UID:prazo-${injected.c}@ekoa-legal`);

  // CRLF-only: no bare LF anywhere in the raw bytes.
  expect(ics1).toContain('\r\n');
  expect(/[^\r]\n/.test(ics1), 'no bare LF line endings').toBe(false);

  await page.screenshot({ path: `${SHOTS}/export-ics.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Prazos: vista das ferias judiciais cita a LOSJ art. 28.º e deriva as datas do motor', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${APP}ferias`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('ferias-page')).toBeVisible({ timeout: 20_000 });

  // The legal source is cited verbatim, next to the periods it governs.
  await expect(page.getByTestId('ferias-citacao')).toContainText('Lei n.º 62/2013');
  await expect(page.getByTestId('ferias-citacao')).toContainText('art. 28.º');
  await expect(page.getByTestId('ferias-citacao')).toContainText('CPC art. 138.º');

  // Pin the engine-derived 2026 dates (Pascoa 2026 = 05/04: Ramos 29/03,
  // 2.ª-feira 06/04). The year select carries anoAtual-1..anoAtual+2, so
  // 2026 stays selectable through 2027.
  await page.getByTestId('ferias-ano').selectOption('2026');
  await expect(page.getByTestId('ferias-periodo-pascoa')).toContainText('29 de março de 2026');
  await expect(page.getByTestId('ferias-periodo-pascoa')).toContainText('6 de abril de 2026');
  await expect(page.getByTestId('ferias-periodo-verao')).toContainText('16 de julho de 2026');
  await expect(page.getByTestId('ferias-periodo-verao')).toContainText('31 de agosto de 2026');
  await expect(page.getByTestId('ferias-periodo-natal')).toContainText('22 de dezembro de 2026');
  await expect(page.getByTestId('ferias-periodo-natal')).toContainText('3 de janeiro de 2027');

  // Feriados list is driven by feriadosNacionais() - moveis included.
  await expect(page.getByTestId('ferias-feriados')).toContainText('Corpo de Deus');
  await expect(page.getByTestId('ferias-feriados')).toContainText('Sexta-feira Santa');

  // The CIRE contrast is stated on the page (continuous counting never pauses).
  await expect(page.getByTestId('ferias-page')).toContainText('CIRE art. 9.º n.º 1');

  // Switching the year recomputes the fixed-period dates.
  await page.getByTestId('ferias-ano').selectOption('2027');
  await expect(page.getByTestId('ferias-periodo-natal')).toContainText('22 de dezembro de 2027');

  await page.screenshot({ path: `${SHOTS}/ferias.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Prazos: memoria de calculo do golden exporta um PDF real com nome deterministico', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${APP}calculadora`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('calculadora-page')).toBeVisible({ timeout: 20_000 });

  // Mirror the frozen golden flow: pick a shared processo, then the golden
  // input 2026-06-05 + 5 dias uteis -> 2026-06-15.
  const firstProcesso = page.getByTestId('prazo-processo').locator('option').nth(1);
  await expect(firstProcesso).toBeAttached({ timeout: 15_000 });
  await page.getByTestId('prazo-processo').selectOption((await firstProcesso.getAttribute('value')) ?? '');
  await page.getByTestId('prazo-data').fill('2026-06-05');
  await page.getByTestId('prazo-titulo').fill('Contestação');
  await page.getByTestId('prazo-dias').fill('5');
  await page.getByTestId('calcular').click();
  await expect(page.getByTestId('resultado-datalimite')).toContainText('2026-06-15', { timeout: 10_000 });

  // The memoria goes through the platform exportPdf bridge (server-side
  // Chromium render) - allow a generous timeout for the real PDF.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId('exportar-memoria').click(),
  ]);
  expect(download.suggestedFilename()).toBe('memoria-prazo-2026-06-05-5uteis.pdf');

  await page.screenshot({ path: `${SHOTS}/memoria-pdf.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
