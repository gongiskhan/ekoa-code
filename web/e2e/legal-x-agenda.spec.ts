import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-agenda - S1 productivity layer of the staff Agenda over the SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-agenda/):
 *  1. Week .ics export: deterministic bytes (two consecutive downloads are
 *     identical), fixed PRODID, Europe/Lisbon VTIMEZONE, UIDs derived from the
 *     row ids (reserva-<id>@ekoa-legal), CRLF-only line endings; the per-proxima
 *     .ics downloads a single-VEVENT calendar for that reserva.
 *  2. Participant-overlap warning: two occupying reservas of a sessao tipo that
 *     requires the same pessoa, overlapping in time, surface the amber warning
 *     naming that pessoa.
 *  3. Day/week print: the print buttons render and the week print produces a real
 *     PDF download through the platform exportPdf bridge.
 *
 * Deterministic + self-cleaning: fixtures are nonce-tagged (pessoa, sessao tipo,
 * reservas) and removed in afterEach; nothing depends on the seeded rows.
 */
const STAFF = legalAppUrl('legal-agenda');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-agenda');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

type Ctx = { nonce: string };
const ctx: Ctx = { nonce: '' };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/** Local 'YYYY-MM-DD' for today+N (wall clock, matching the app's referential). */
function diaLocal(plusDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + plusDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  try {
    await page.evaluate(async (nonce) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s || !nonce) return;
      const tagged = (v: unknown) => typeof v === 'string' && v.includes(nonce);
      for (const col of ['reservas', 'eventos', 'sessao_tipos', 'pessoas']) {
        let rows: Row[] = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          if (tagged(r.nome) || tagged(r.titulo) || tagged(r.email)) {
            try { await s.delete(col, String(r.id)); } catch { /* ignore */ }
          }
        }
      }
    }, ctx.nonce);
  } catch { /* page may be gone - ignore */ }
});

test('Agenda: exportar .ics da semana e determinista, Europe/Lisbon, UIDs derivados', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XA1-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(STAFF, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('agenda-page')).toBeVisible({ timeout: 20_000 });

  // Reserva A at 23:00 TODAY is always inside the displayed week; reserva B
  // tomorrow morning is always in the future, so it shows under "Proximas".
  const injected = await page.evaluate(async ({ n, hoje, amanha }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const pes = await s.create('pessoas', { nome: `Pessoa ${n}`, papel: 'advogado', ativo: true });
    const tipo = await s.create('sessao_tipos', {
      nome: `Tipo ${n}`, duracaoMin: 45, preco: null, pagamentoObrigatorio: false,
      local: 'escritorio', bufferMin: 0, publico: false,
      participantesNecessarios: [String(pes.id)],
    });
    const ra = await s.create('reservas', {
      sessaoTipoId: String(tipo.id), inicio: `${hoje}T23:00:00`, fim: `${hoje}T23:45:00`,
      nome: `Cliente A ${n}`, email: `a-${n}@exemplo.pt`, estado: 'confirmada',
    });
    const rb = await s.create('reservas', {
      sessaoTipoId: String(tipo.id), inicio: `${amanha}T09:00:00`, fim: `${amanha}T09:45:00`,
      nome: `Cliente B ${n}`, email: `b-${n}@exemplo.pt`, estado: 'confirmada',
    });
    return { ra: String(ra.id), rb: String(rb.id) };
  }, { n: nonce, hoje: diaLocal(0), amanha: diaLocal(1) });

  await page.goto(STAFF, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('agenda-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('agenda-semana')).toContainText(nonce, { timeout: 15_000 });

  // Two consecutive week exports must be byte-identical (no now()-derived content).
  const [d1] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByTestId('agenda-exportar-ics').click(),
  ]);
  const [d2] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByTestId('agenda-exportar-ics').click(),
  ]);
  expect(d1.suggestedFilename()).toMatch(/^agenda-semana-\d{4}-\d{2}-\d{2}\.ics$/);
  const ics1 = await downloadText(d1);
  const ics2 = await downloadText(d2);
  expect(ics1, 'two consecutive exports are byte-identical').toBe(ics2);

  const plano = unfold(ics1);
  expect(plano).toContain('PRODID:-//Ekoa Legal//Agenda//PT');
  expect(plano).toContain('BEGIN:VTIMEZONE');
  expect(plano).toContain('TZID:Europe/Lisbon');
  expect(plano).toContain(`UID:reserva-${injected.ra}@ekoa-legal`);
  expect(plano).toContain('DTSTART;TZID=Europe/Lisbon:');
  // CRLF-only: no bare LF anywhere in the raw bytes.
  expect(ics1).toContain('\r\n');
  expect(/[^\r]\n/.test(ics1), 'no bare LF line endings').toBe(false);

  // Per-proxima .ics: the upcoming reserva B row offers its own calendar file.
  const proximaB = page.getByTestId('agenda-proxima').filter({ hasText: `Cliente B ${nonce}` });
  await expect(proximaB).toBeVisible({ timeout: 15_000 });
  const [d3] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    proximaB.getByTestId('agenda-proxima-ics').click(),
  ]);
  expect(d3.suggestedFilename()).toBe(`reserva-${injected.rb}.ics`);
  const icsB = unfold(await downloadText(d3));
  expect(icsB).toContain(`UID:reserva-${injected.rb}@ekoa-legal`);
  expect(icsB).toContain('BEGIN:VEVENT');

  await page.screenshot({ path: `${SHOTS}/semana-ics.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Agenda: sobreposicao de participantes entre duas reservas ocupantes gera o aviso', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XA2-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(STAFF, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('agenda-page')).toBeVisible({ timeout: 20_000 });

  // The same pessoa is required by both reservas, and their times overlap.
  await page.evaluate(async ({ n, hoje }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const pes = await s.create('pessoas', { nome: `Pessoa ${n}`, papel: 'advogado', ativo: true });
    const tipo = await s.create('sessao_tipos', {
      nome: `Tipo ${n}`, duracaoMin: 60, preco: null, pagamentoObrigatorio: false,
      local: 'escritorio', bufferMin: 0, publico: false,
      participantesNecessarios: [String(pes.id)],
    });
    await s.create('reservas', {
      sessaoTipoId: String(tipo.id), inicio: `${hoje}T10:00:00`, fim: `${hoje}T11:00:00`,
      nome: `Sobre A ${n}`, email: `sa-${n}@exemplo.pt`, estado: 'confirmada',
    });
    await s.create('reservas', {
      sessaoTipoId: String(tipo.id), inicio: `${hoje}T10:30:00`, fim: `${hoje}T11:30:00`,
      nome: `Sobre B ${n}`, email: `sb-${n}@exemplo.pt`, estado: 'confirmada',
    });
  }, { n: nonce, hoje: diaLocal(0) });

  await page.goto(STAFF, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('agenda-page')).toBeVisible({ timeout: 20_000 });

  const aviso = page.getByTestId('agenda-sobreposicoes');
  await expect(aviso).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByTestId('agenda-sobreposicao').filter({ hasText: `Pessoa ${nonce}` }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/sobreposicoes.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Agenda: imprimir a semana produz um PDF real via exportPdf; ha um botao por dia', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XA3-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(STAFF, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('agenda-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('agenda-semana')).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId('agenda-print-semana')).toBeVisible();
  await expect(page.getByTestId('agenda-print-dia')).toHaveCount(7, { timeout: 15_000 });

  // The week print goes through the platform exportPdf bridge (server-side
  // Chromium render), so allow a generous timeout for the real PDF to come back.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId('agenda-print-semana').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^agenda-semana-\d{4}-\d{2}-\d{2}\.pdf$/);

  await page.screenshot({ path: `${SHOTS}/print.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
