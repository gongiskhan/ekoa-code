import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * Agenda — the marcações satellite (staff app `legal-agenda`) + its public
 * booking face (`legal-agenda-reservas`), both over the SHARED spine.
 *
 * Covers, end-to-end through the served apps (cortex at /apps/…):
 *  1. Staff week view renders 7 days and lists the seeded CONFIRMADA reserva in
 *     "Próximas reservas", with zero pageerrors.
 *  2. Tipos page lists the 3 seeded session types and shows a public booking link
 *     for the público ones.
 *  3. PUBLIC FLOW: open the booking page for "Consulta inicial", engine-driven
 *     slots render, book one → pendente_pagamento panel with the mock MB
 *     reference. PRIVACY: the public HTML carries NO team names and NO other
 *     reserva's email.
 *  4. DOUBLE-BOOKING: a slot that another confirmada reserva just took disappears
 *     from the public booking page on reload (engine-driven UI recheck).
 *
 * Self-cleaning: every reserva/evento the tests create is tagged with a nonce and
 * removed in afterEach, so they never pollute the seeded spine.
 */
const STAFF = legalAppUrl('legal-agenda');
const PUBLICA = legalAppUrl('legal-agenda-reservas');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'legal-agenda');
mkdirSync(SHOTS, { recursive: true });

type Ctx = { nonce: string };
const ctx: Ctx = { nonce: '' };

// Seeded team names + the seeded reserva email that must NEVER reach the public page.
const NOMES_EQUIPA = ['Marília', 'Nuno', 'Sofia', 'Tiago', 'Carla'];
const EMAIL_SEED = 'marilia.costa@exemplo.pt';

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __ekoa?: { shared?: unknown } }).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/* Opens the Núcleo once (it, and only it, seeds the spine) and waits until the
 * shared session types are present, then returns the "Consulta inicial" id. */
async function ensureSeededTipo(page: Page): Promise<string> {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  return page.evaluate(async () => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } }).__ekoa.shared;
    // Poll until the seed lands.
    for (let i = 0; i < 40; i += 1) {
      const tipos = await s.list('sessao_tipos');
      const consulta = tipos.find((t) => t.nome === 'Consulta inicial' && t.publico);
      if (consulta) return consulta.id as string;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('sessao_tipos não semeado');
  });
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async (nonce) => {
      const s = (window as unknown as { __ekoa?: { shared?: { list: (c: string) => Promise<Array<Record<string, unknown>>>; delete: (c: string, id: string) => Promise<unknown> } } }).__ekoa?.shared;
      if (!s) return;
      const reservas = await s.list('reservas').catch(() => []);
      const alvo = new Set<string>();
      for (const r of reservas) {
        if (typeof r.nome === 'string' && r.nome.includes(nonce)) { alvo.add(r.id as string); await s.delete('reservas', r.id as string).catch(() => {}); }
      }
      for (const col of ['eventos', 'conta_corrente']) {
        const rows = await s.list(col).catch(() => []);
        for (const row of rows) {
          const hit =
            (typeof row.reservaId === 'string' && alvo.has(row.reservaId)) ||
            (typeof row.titulo === 'string' && row.titulo.includes(nonce));
          if (hit) await s.delete(col, row.id as string).catch(() => {});
        }
      }
    }, ctx.nonce);
  } catch { /* page may be gone */ }
});


/* The public page reads ONLY the sanitized `agenda_publica` collection (privacy
 * fix from the wave review): opening the STAFF AgendaPage publishes/refreshes
 * it. Poll until rows exist so the public tests have slots to offer. */
async function publicarAgendaPublica(page: Page) {
  await page.goto(STAFF, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.waitForFunction(async () => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<unknown[]> } } }).__ekoa.shared;
    const rows = await s.list('agenda_publica');
    return Array.isArray(rows) && rows.length > 0;
  }, undefined, { timeout: 30_000 });
}

test('Agenda: a semana mostra 7 dias e a reserva confirmada semeada, sem erros', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `AG-${Date.now()}`;

  await ensureSeededTipo(page);

  await page.goto(STAFF, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('agenda-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('agenda-semana')).toBeVisible();
  expect(await page.getByTestId('agenda-dia').count()).toBe(7);

  // The seeded confirmada reserva (Marília Costa, today+2) shows in "Próximas".
  await expect(page.getByTestId('agenda-proximas')).toContainText('Marília Costa', { timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/staff-semana.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Agenda: a página de tipos lista os 3 tipos semeados e a ligação pública', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `AG-${Date.now()}`;

  await ensureSeededTipo(page);

  await page.goto(`${STAFF}tipos`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('tipos-page')).toBeVisible({ timeout: 20_000 });

  for (const nome of ['Consulta inicial', 'Reunião de acompanhamento', 'Preparação de julgamento']) {
    await expect(page.getByTestId('tipos-lista').getByText(nome, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  }
  expect(await page.getByTestId('tipo-row').count()).toBeGreaterThanOrEqual(3);
  // Público types expose a booking link (Consulta inicial + Reunião = 2).
  expect(await page.getByTestId('tipo-link-publico').count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId('tipo-link-url').first()).toContainText('/apps/legal-agenda-reservas/?tipo=');

  await page.screenshot({ path: `${SHOTS}/staff-tipos.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Reservas (público): fluxo de marcação paga com painel MB e privacidade dos dados da equipa', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `AG-${Date.now()}`;

  const consultaId = await ensureSeededTipo(page);
  await publicarAgendaPublica(page);

  // PRIVACIDADE ao nível da REDE: a página pública não pode sequer PEDIR as
  // colecções privadas - os dados nunca podem chegar ao browser anónimo.
  const pedidosPrivados: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (/\/api\/app-shared\/(reservas|eventos|disponibilidades|ausencias|pessoas)(\?|$|\/)/.test(url)
      && req.method() === 'GET') {
      pedidosPrivados.push(url);
    }
  });

  await page.goto(`${PUBLICA}?tipo=${consultaId}`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('reservas-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('rz-tipo-nome')).toHaveText('Consulta inicial');

  // Engine-driven slots must render (Consulta inicial has overlapping windows).
  await expect(page.getByTestId('reservas-slots')).toBeVisible({ timeout: 20_000 });
  const primeiroSlot = page.getByTestId('rz-slot').first();
  await expect(primeiroSlot).toBeVisible({ timeout: 15_000 });
  expect(await page.getByTestId('rz-slot').count()).toBeGreaterThanOrEqual(1);
  await primeiroSlot.click();

  // Fill the booking form (nonce-tagged) and submit.
  await expect(page.getByTestId('reservas-form')).toBeVisible();
  await page.getByTestId('rz-nome').fill(`Cliente ${ctx.nonce}`);
  await page.getByTestId('rz-email').fill(`cliente-${ctx.nonce}@exemplo.pt`);
  await page.getByTestId('rz-telefone').fill('+351 900 000 000');
  await page.getByTestId('reservas-confirmar').click();

  // Payment required (preço + pagamentoObrigatório) -> pendente_pagamento panel with mock MB ref.
  await expect(page.getByTestId('reservas-resultado')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('reservas-estado')).toContainText('aguardar pagamento', { ignoreCase: true });
  await expect(page.getByTestId('pay-multibanco')).toBeVisible();
  await expect(page.getByTestId('mb-entidade')).toHaveText('11249');
  await expect(page.getByTestId('mb-referencia')).toHaveText('123 456 789');

  // PRIVACY: the public HTML must carry NO team name and NO other reserva's email.
  const html = await page.content();
  for (const nome of NOMES_EQUIPA) {
    expect(html, `public page leaked team name "${nome}"`).not.toContain(nome);
  }
  expect(html, 'public page leaked a seeded reserva email').not.toContain(EMAIL_SEED);
  expect(pedidosPrivados, `public page requested private collections: ${pedidosPrivados.join(', ')}`).toEqual([]);

  await page.screenshot({ path: `${SHOTS}/publica-pagamento.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Reservas (público): guarda anti-duplicação — um horário confirmado por outrem desaparece', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `AG-${Date.now()}`;

  const consultaId = await ensureSeededTipo(page);
  await publicarAgendaPublica(page);

  await page.goto(`${PUBLICA}?tipo=${consultaId}`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('reservas-slots')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('rz-slot').first()).toBeVisible({ timeout: 15_000 });

  // Grab the first offered slot's start instant.
  const alvo = await page.getByTestId('rz-slot').first().getAttribute('data-inicio');
  expect(alvo).toBeTruthy();
  // Compute fim as inicio + duração (30 min for Consulta inicial) for the injected reserva.
  const [d, hm] = (alvo as string).split('T');
  const [h, m] = hm.split(':').map(Number);
  const fimMin = h * 60 + m + 30;
  const fimIso = `${d}T${String(Math.floor(fimMin / 60)).padStart(2, '0')}:${String(fimMin % 60).padStart(2, '0')}:00`;

  // Someone else confirms that exact slot (a CONFIRMADA reserva overlapping it).
  await page.evaluate(async ({ tipo, inicio, fimA, nonce }) => {
    const s = (window as unknown as { __ekoa: { shared: { create: (c: string, d: unknown) => Promise<unknown> } } }).__ekoa.shared;
    await s.create('reservas', { sessaoTipoId: tipo, inicio, fim: fimA, nome: `Bloqueio ${nonce}`, email: `bloq-${nonce}@exemplo.pt`, estado: 'confirmada' });
  }, { tipo: consultaId, inicio: alvo, fimA: fimIso, nonce: ctx.nonce });

  // Republish (staff visit recomputes agenda_publica minus the taken slot),
  // then reload the booking page: the slot must be gone for the next visitor.
  await publicarAgendaPublica(page);
  await page.goto(`${PUBLICA}?tipo=${consultaId}`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('reservas-slots')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('rz-slot').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`[data-testid="rz-slot"][data-inicio="${alvo}"]`)).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/publica-double-booking.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
