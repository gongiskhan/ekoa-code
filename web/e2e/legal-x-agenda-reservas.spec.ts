import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-agenda-reservas - honest states + confirmation .ics on the PUBLIC
 * booking page, over the sanitized shared spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-agenda-reservas/):
 *  1. DEGRADED STATE is honest: when the shared-spine API is unreachable the page
 *     says so ("nao foi possivel ligar") instead of pretending the calendar is
 *     empty, and the retry button recovers once the API is back.
 *  2. A deep-link to a tipo that no longer exists gets an explicit note, not a
 *     silent fallback.
 *  3. A free sessao tipo ("Reuniao de acompanhamento") confirms immediately and
 *     the confirmation panel offers a deterministic .ics for the booked slot.
 *
 * Self-cleaning: reservas (and the eventos they spawn) are nonce-tagged and
 * removed in afterEach.
 */
const PUBLICA = legalAppUrl('legal-agenda-reservas');
const STAFF = legalAppUrl('legal-agenda');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-agenda-reservas');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
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

/* Opens the Nucleo once (it, and only it, seeds the spine) and returns the id of
 * the seeded free+public tipo "Reuniao de acompanhamento". */
async function ensureSeededTipoLivre(page: Page): Promise<string> {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  return page.evaluate(async () => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    for (let i = 0; i < 40; i += 1) {
      const tipos = await s.list('sessao_tipos');
      const livre = tipos.find((t) => t.nome === 'Reunião de acompanhamento' && t.publico);
      if (livre) return String(livre.id);
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('sessao_tipos não semeado');
  });
}

/* The public page reads the sanitized agenda_publica collection; a staff visit
 * publishes/refreshes it. Poll until rows exist so slots can render. */
async function publicarAgendaPublica(page: Page) {
  await page.goto(STAFF, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.waitForFunction(async () => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const rows = await s.list('agenda_publica');
    return Array.isArray(rows) && rows.length > 0;
  }, undefined, { timeout: 30_000 });
}

function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, '');
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async (nonce) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s || !nonce) return;
      const reservas = await s.list('reservas').catch(() => [] as Row[]);
      const alvo = new Set<string>();
      for (const r of reservas) {
        if (typeof r.nome === 'string' && r.nome.includes(nonce)) {
          alvo.add(String(r.id));
          await s.delete('reservas', String(r.id)).catch(() => {});
        }
      }
      for (const col of ['eventos', 'conta_corrente']) {
        const rows = await s.list(col).catch(() => [] as Row[]);
        for (const row of rows) {
          const hit =
            (typeof row.reservaId === 'string' && alvo.has(row.reservaId)) ||
            (typeof row.titulo === 'string' && row.titulo.includes(nonce));
          if (hit) await s.delete(col, String(row.id)).catch(() => {});
        }
      }
    }, ctx.nonce);
  } catch { /* page may be gone - ignore */ }
});

test('Reservas: espinha inacessivel mostra o estado degradado honesto e o repetir recupera', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `XR1-${Date.now()}`;

  // Seed first (unblocked), so the recovery path has tipos to show.
  await ensureSeededTipoLivre(page);

  // Cut ONLY the shared-data API: the app shell loads, the bridge exists, but
  // every collection read fails - the page must say so, not render "no sessions".
  await page.route('**/api/app-shared/**', (route) => route.abort());

  await page.goto(PUBLICA, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('reservas-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reservas-indisponivel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reservas-indisponivel')).toContainText('Não foi possível ligar');
  // The honest degraded state never claims there are simply no sessions.
  await expect(page.getByTestId('reservas-sem-tipos')).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/degradado.png`, fullPage: true });

  // Restore the API and retry from the page itself.
  await page.unroute('**/api/app-shared/**');
  await page.getByTestId('reservas-tentar').click();
  await expect(page.getByTestId('reservas-tipos')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reservas-indisponivel')).toHaveCount(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Reservas: deep-link para um tipo inexistente mostra nota explicita e a lista de tipos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `XR2-${Date.now()}`;

  await ensureSeededTipoLivre(page);

  await page.goto(`${PUBLICA}?tipo=inexistente-${ctx.nonce}`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('reservas-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reservas-tipos')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reservas-tipo-indisponivel')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('reservas-tipo-indisponivel')).toContainText('já não está disponível');

  await page.screenshot({ path: `${SHOTS}/tipo-indisponivel.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Reservas: tipo gratuito confirma de imediato e oferece o .ics da marcacao', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const nonce = `XR3-${Date.now()}`;
  ctx.nonce = nonce;

  const tipoId = await ensureSeededTipoLivre(page);
  await publicarAgendaPublica(page);

  await page.goto(`${PUBLICA}?tipo=${tipoId}`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('reservas-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('rz-tipo-nome')).toHaveText('Reunião de acompanhamento');

  // Engine-driven slots for the free tipo.
  await expect(page.getByTestId('reservas-slots')).toBeVisible({ timeout: 20_000 });
  const primeiroSlot = page.getByTestId('rz-slot').first();
  await expect(primeiroSlot).toBeVisible({ timeout: 15_000 });
  await primeiroSlot.click();

  await expect(page.getByTestId('reservas-form')).toBeVisible();
  await page.getByTestId('rz-nome').fill(`Cliente ${nonce}`);
  await page.getByTestId('rz-email').fill(`cliente-${nonce}@exemplo.pt`);
  await page.getByTestId('rz-telefone').fill('+351 900 000 001');
  await page.getByTestId('reservas-confirmar').click();

  // No price, no pagamentoObrigatorio: the reserva confirms immediately.
  await expect(page.getByTestId('reservas-resultado')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('reservas-estado')).toContainText('confirmada', { ignoreCase: true });
  await expect(page.getByTestId('reservas-confirmada-nota')).toBeVisible();

  // The confirmation offers the calendar file; the UID is derived from the id.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByTestId('reservas-ics').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^reserva-.+\.ics$/);
  const ics = unfold(readFileSync((await download.path()) as string, 'utf-8'));
  expect(ics).toContain('PRODID:-//Ekoa Legal//Agenda//PT');
  expect(ics).toContain('TZID:Europe/Lisbon');
  expect(ics).toContain('BEGIN:VEVENT');
  expect(ics).toContain('UID:reserva-');
  expect(ics).toContain('@ekoa-legal');
  expect(ics).toContain('Reunião de acompanhamento');

  await page.screenshot({ path: `${SHOTS}/confirmada-ics.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
