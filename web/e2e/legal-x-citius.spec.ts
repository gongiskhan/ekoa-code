import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-citius - S2 triage layer of the Caixa Citius over the SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-citius/):
 *  1. Bulk triage: multi-select in "A rever" confirms ONLY the rows whose
 *     confirmation is unequivocal (processo matched + ato with rule + valid
 *     data do acto); the incomplete row honestly stays for individual review.
 *     Each confirmation writes prazo + evento to the spine ('matched'+prazoId
 *     contract) and the notificacao page deep-links into the Dossie.
 *  2. Multi-notification paste: text with an explicit '---' separator is split
 *     conservatively; each segment runs the engine on its own - one matches
 *     (prazo created), the unknown-processo one goes to review.
 *  3. The email intake panel states honestly what the backend onEmail does and
 *     refuses to do (authenticated sender, forgeable text-only origin, alert
 *     dedup); pasted vs email rows carry the origem badge.
 *
 * Deterministic + self-cleaning: injected notificacoes carry a per-run nonce in
 * their texto; afterEach removes them plus the prazos/eventos/bell rows they
 * produced. The seeded processo (1234/26.0T8LSB) is ensured, never deleted.
 */
const APP = legalAppUrl('legal-citius');
const SEED_PROCESSO = '1234/26.0T8LSB';
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-citius');
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

async function ensureProcesso(page: Page, numero: string): Promise<string> {
  return page.evaluate(async (num) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const list = (await s.list('processos')) || [];
    const found = list.find((p) => String(p.numeroProcesso || '').trim() === num);
    if (found) return String(found.id);
    const created = await s.create('processos', {
      numeroProcesso: num, titulo: `Processo ${num}`, estado: 'ativo',
    });
    return String(created.id);
  }, numero);
}

test.afterEach(async ({ page }) => {
  if (!ctx.nonce) return;
  try {
    await page.evaluate(async (nonce) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const safeList = async (col: string) => { try { return (await s.list(col)) || []; } catch { return []; } };
      const safeDel = async (col: string, id: unknown) => { try { await s.delete(col, String(id)); } catch { /* ignore */ } };

      const notifs = (await safeList('citius_notificacoes'))
        .filter((n) => typeof n.texto === 'string' && n.texto.includes(nonce));
      const notifIds = new Set(notifs.map((n) => String(n.id)));
      const prazoIds = new Set(notifs.map((n) => String(n.prazoId || '')).filter(Boolean));
      for (const n of notifs) await safeDel('citius_notificacoes', n.id);

      for (const p of await safeList('prazos')) {
        const meta = (p.metadata || {}) as Row;
        if (prazoIds.has(String(p.id)) || notifIds.has(String(meta.notificacaoId || ''))) {
          await safeDel('prazos', p.id);
        }
      }
      for (const ev of await safeList('eventos')) {
        const meta = (ev.metadata || {}) as Row;
        if (notifIds.has(String(meta.notificacaoId || '')) || prazoIds.has(String(meta.prazoId || ''))) {
          await safeDel('eventos', ev.id);
        }
      }
      for (const b of await safeList('notificacoes')) {
        const href = String(b.href || '');
        if ([...notifIds].some((id) => href.includes(id))) await safeDel('notificacoes', b.id);
      }
    }, ctx.nonce);
  } catch { /* page may be gone - ignore */ }
  ctx.nonce = '';
});

test('Citius: confirmacao em lote so confirma as inequivocas; escreve prazo+evento e liga ao Dossie', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XC1-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await ensureProcesso(page, SEED_PROCESSO);

  // Two complete rows (bulk-confirmable) + one without a recognized ato
  // (must honestly stay in review). Refs also drive the origem badge:
  // equal refs = pasted by hand, distinct refs = email intake.
  const injected = await page.evaluate(async ({ n, num }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const agora = new Date().toISOString();
    const r1 = await s.create('citius_notificacoes', {
      texto: `Notificacao bulk 1 ${n}`, numeroProcesso: num, ato: 'Contestação',
      dataActo: '2026-06-05', estado: 'needs-review', motivo: 'revisão de teste',
      sourceRef: `email-${n}-1`, contentRef: `c-${n}-1`, data: agora,
    });
    const r2 = await s.create('citius_notificacoes', {
      texto: `Notificacao bulk 2 ${n}`, numeroProcesso: num, ato: 'Oposição',
      dataActo: '2026-06-08', estado: 'needs-review', motivo: 'revisão de teste',
      sourceRef: `c-${n}-2`, contentRef: `c-${n}-2`, data: agora,
    });
    const r3 = await s.create('citius_notificacoes', {
      texto: `Notificacao bulk 3 ${n}`, numeroProcesso: num, ato: null,
      dataActo: '2026-06-05', estado: 'needs-review', motivo: 'ato não reconhecido',
      sourceRef: `c-${n}-3`, contentRef: `c-${n}-3`, data: agora,
    });
    return { r1: String(r1.id), r2: String(r2.id), r3: String(r3.id) };
  }, { n: nonce, num: SEED_PROCESSO });

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('inbox-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('bulk-bar')).toBeVisible({ timeout: 15_000 });

  // Origem badges derived from the engine refs - never guessed.
  await expect(page.getByTestId(`citius-origem-${injected.r1}`)).toHaveText('Email');
  await expect(page.getByTestId(`citius-origem-${injected.r2}`)).toHaveText('Colada');

  // Select exactly our three rows (never touch other pending reviews).
  for (const id of [injected.r1, injected.r2, injected.r3]) {
    await page.getByTestId(`bulk-select-${id}`).check();
  }
  await expect(page.getByTestId('bulk-selecionadas')).toContainText('3 selecionadas');
  await expect(page.getByTestId('bulk-selecionadas')).toContainText('2 prontas');

  await page.getByTestId('bulk-confirmar').click();
  const resumo = page.getByTestId('bulk-resultado');
  await expect(resumo).toBeVisible({ timeout: 20_000 });
  await expect(resumo).toContainText('2 confirmadas');
  await expect(resumo).toContainText('1 mantida');

  // Spine truth: each confirmed row is 'matched'+prazoId with its prazo and
  // evento written; the incomplete row is untouched.
  const estado = await page.evaluate(async (ids) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const notifs = await s.list('citius_notificacoes');
    const prazos = await s.list('prazos');
    const eventos = await s.list('eventos');
    const de = (id: string) => notifs.find((n) => String(n.id) === id) as Row;
    const n1 = de(ids.r1); const n2 = de(ids.r2); const n3 = de(ids.r3);
    const prazoDe = (n: Row) => prazos.find((p) => String(p.id) === String(n.prazoId)) as Row | undefined;
    const eventoDe = (n: Row) => eventos.find((ev) => String(((ev.metadata || {}) as Row).notificacaoId || '') === String(n.id));
    return {
      e1: n1?.estado, e2: n2?.estado, e3: n3?.estado,
      p1: prazoDe(n1) ? { dataLimite: prazoDe(n1)!.dataLimite, origem: prazoDe(n1)!.origem } : null,
      p2: prazoDe(n2) ? { dataLimite: prazoDe(n2)!.dataLimite } : null,
      n1Limite: n1?.dataLimite,
      ev1: Boolean(eventoDe(n1)), ev2: Boolean(eventoDe(n2)),
    };
  }, injected);
  expect(estado.e1).toBe('matched');
  expect(estado.e2).toBe('matched');
  expect(estado.e3, 'incomplete row honestly stays in review').toBe('needs-review');
  expect(estado.p1, 'prazo written for r1').not.toBeNull();
  expect(estado.p1?.origem).toBe('citius');
  expect(estado.p1?.dataLimite, 'notif mirrors the prazo dataLimite').toBe(estado.n1Limite);
  expect(estado.p2, 'prazo written for r2').not.toBeNull();
  expect(estado.ev1, 'evento written for r1').toBe(true);
  expect(estado.ev2, 'evento written for r2').toBe(true);

  // The triaged notificacao deep-links into the processo Dossie.
  await page.goto(`${APP}notificacao/${injected.r1}`, { waitUntil: 'domcontentloaded' });
  const dossie = page.getByTestId('abrir-dossie');
  await expect(dossie).toBeVisible({ timeout: 15_000 });
  expect(await dossie.getAttribute('href')).toMatch(/\/apps\/legal-dossie\/processo\/.+/);

  await page.screenshot({ path: `${SHOTS}/bulk.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Citius: colar varias notificacoes separadas por --- processa cada uma por si', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XC2-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(`${APP}colar`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await ensureProcesso(page, SEED_PROCESSO);
  await expect(page.getByTestId('colar-page')).toBeVisible({ timeout: 20_000 });

  // Segment A matches the seeded processo (prazo created); segment B names an
  // unknown processo (review). The nonce inside each texto keeps contentRefs
  // unique across runs (no duplicate suppression from earlier runs).
  const segA = [
    'Citius - Notificação Electrónica',
    `Processo: ${SEED_PROCESSO}`,
    `Referência interna: ${nonce}`,
    'Fica V. Exa. notificado(a) para apresentar contestação no processo supra identificado.',
    'Data do acto: 2026-06-05',
  ].join('\n');
  const segB = [
    'Citius - Notificação Electrónica',
    'Processo: 9999/26.0T8PRT',
    `Referência interna: ${nonce}`,
    'Fica V. Exa. notificado(a) para apresentar contestação no processo supra identificado.',
    'Data do acto: 2026-06-05',
  ].join('\n');

  await page.getByTestId('citius-texto').fill(`${segA}\n---\n${segB}`);
  await page.getByTestId('citius-processar').click();

  const multi = page.getByTestId('citius-multi-resumo');
  await expect(multi).toBeVisible({ timeout: 20_000 });
  await expect(multi).toContainText('2 notificações separadas');
  await expect(multi).toContainText('1 com prazo');
  await expect(multi).toContainText('1 para revisão');
  await expect(page.getByTestId('citius-resultado-seg-0')).toContainText('Prazo criado');
  await expect(page.getByTestId('citius-resultado-seg-1')).toContainText('Precisa de revisão');

  // Spine truth: one matched row with its prazo, one needs-review row for the
  // unknown processo - the engine never guessed.
  const estado = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const notifs = (await s.list('citius_notificacoes'))
      .filter((r) => typeof r.texto === 'string' && r.texto.includes(n));
    const prazos = await s.list('prazos');
    const matched = notifs.find((r) => r.estado === 'matched');
    const review = notifs.find((r) => r.estado === 'needs-review');
    return {
      total: notifs.length,
      matchedTemPrazo: Boolean(matched && prazos.some((p) => String(p.id) === String(matched.prazoId))),
      reviewNumero: review ? review.numeroProcesso : null,
    };
  }, nonce);
  expect(estado.total).toBe(2);
  expect(estado.matchedTemPrazo, 'matched segment wrote its prazo').toBe(true);
  expect(estado.reviewNumero).toBe('9999/26.0T8PRT');

  await page.screenshot({ path: `${SHOTS}/multi-colar.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Citius: painel da intake de email diz honestamente o que o canal faz e recusa', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('inbox-page')).toBeVisible({ timeout: 20_000 });

  const painel = page.getByTestId('citius-email-canal');
  await expect(painel).toBeVisible({ timeout: 15_000 });
  await expect(painel).toContainText('@citius.mj.pt');
  await expect(painel).toContainText('Origem não autenticada');
  await expect(painel).toContainText('Nunca cria prazo');
  await expect(painel).toContainText('alertedAt');

  await page.screenshot({ path: `${SHOTS}/email-canal.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
