import { test, expect, type Page } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * S4-citius - the Caixa Citius LIVE inbox over the shared spine.
 *
 * The app is now the lawyer's triage queue: needs-review notifications (written
 * by the engine, whether from email intake or the paste fallback) land in the
 * inbox, and confirming one creates a prazo + an evento on the processo and
 * marks the row processada - while the paste flow at /colar stays intact.
 *
 * HARD RULE proven here: a notification whose data-do-acto could not be parsed
 * keeps Confirmar DISABLED until the user fills a date by hand - a prazo is
 * never committed from a guessed date.
 *
 * Re-runnable: every row this spec creates carries a per-run TAG (in its text /
 * sourceRef); afterEach deletes exactly those rows plus the prazos/eventos they
 * spawned. The seeded processo (1234/26.0T8LSB) is ensured, never deleted.
 */
const BASE = legalAppUrl('legal-citius');
const SEED_PROCESSO = '1234/26.0T8LSB';

let tag = '';

async function waitForShared(page: Page) {
  await page.waitForFunction(() => !!(window as any).__ekoa?.shared, null, { timeout: 20_000 });
}

async function ensureProcesso(page: Page, numero: string): Promise<string> {
  return page.evaluate(async (num) => {
    const api = (window as any).__ekoa.shared;
    const list = (await api.list('processos')) || [];
    const found = list.find((p: any) => (p.numeroProcesso || '').trim() === num);
    if (found) return found.id;
    const created = await api.create('processos', {
      numeroProcesso: num,
      tribunal: 'Juízo Central Cível de Lisboa',
      comarca: 'Lisboa',
      area: 'Cível',
      estado: 'ativo',
    });
    return created.id;
  }, numero);
}

async function injectNotif(page: Page, row: Record<string, unknown>): Promise<string> {
  return page.evaluate(async (r) => {
    const created = await (window as any).__ekoa.shared.create('citius_notificacoes', r);
    return created.id;
  }, row);
}

// Deletes every citius_notificacoes row tagged with `t`, plus the prazos it
// produced, the eventos referencing those prazos/rows, and the bell entries
// pointing at those rows. Idempotent and best-effort.
async function cleanupByTag(page: Page, t: string): Promise<void> {
  await page.evaluate(async (tagStr) => {
    const api = (window as any).__ekoa.shared;
    const notifs = (await api.list('citius_notificacoes')) || [];
    const mine = notifs.filter(
      (n: any) => (n.texto || '').includes(tagStr) || (n.sourceRef || '').includes(tagStr),
    );
    const myIds = new Set(mine.map((n: any) => n.id));
    const prazoIds = new Set<string>();
    for (const n of mine) {
      const ids = Array.isArray(n.prazoIds) ? n.prazoIds : n.prazoId ? [n.prazoId] : [];
      ids.forEach((id: string) => prazoIds.add(id));
    }
    const eventos = (await api.list('eventos')) || [];
    for (const e of eventos) {
      const pid = e?.metadata?.prazoId;
      const nref = e?.metadata?.notificacaoId;
      if ((pid && prazoIds.has(pid)) || (nref && myIds.has(nref))) {
        try { await api.delete('eventos', e.id); } catch { /* best-effort */ }
      }
    }
    for (const id of prazoIds) { try { await api.delete('prazos', id); } catch { /* best-effort */ } }
    const bell = (await api.list('notificacoes')) || [];
    for (const b of bell) {
      if (b?.href && [...myIds].some((id) => String(b.href).includes(String(id)))) {
        try { await api.delete('notificacoes', b.id); } catch { /* best-effort */ }
      }
    }
    for (const n of mine) { try { await api.delete('citius_notificacoes', n.id); } catch { /* best-effort */ } }
  }, t);
}

test.beforeEach(async ({ page }) => {
  tag = `T${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('inbox-page')).toBeVisible({ timeout: 20_000 });
  await waitForShared(page);
  await ensureProcesso(page, SEED_PROCESSO);
});

test.afterEach(async ({ page }) => {
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await waitForShared(page);
    await cleanupByTag(page, tag);
  } catch { /* best-effort cleanup */ }
});

test('Colar: matched notification cria prazo; processo desconhecido -> revisão; idempotente', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.getByTestId('nav-colar').click();
  await expect(page.getByTestId('colar-page')).toBeVisible({ timeout: 15_000 });

  // the example button fills the paste textarea with a realistic notification
  await page.getByTestId('citius-exemplo').click();
  await expect(page.getByTestId('citius-texto')).toHaveValue(/1234\/26\.0T8LSB/);

  const matched = [
    'Citius - Notificação Electrónica',
    `Ref interna ${tag}`,
    `Processo: ${SEED_PROCESSO}`,
    'Fica V. Exa. notificado para apresentar contestação.',
    'Data do acto: 2026-06-05',
  ].join('\n');

  // a notification that MATCHES the seeded processo -> Prazo criado
  await page.getByTestId('citius-texto').fill(matched);
  await page.getByTestId('citius-processar').click();
  await expect(page.getByTestId('citius-resultado')).toContainText(/Prazo criado/i, { timeout: 15_000 });
  await expect(page.getByTestId('citius-resultado')).toContainText(/\d{4}-\d{2}-\d{2}/);

  // RE-PROCESSING the same content is idempotent: no duplicate, no "undefined"
  await page.getByTestId('citius-texto').fill(matched);
  await page.getByTestId('citius-processar').click();
  await expect(page.getByTestId('citius-resultado')).toContainText(/já processada/i, { timeout: 15_000 });
  await expect(page.getByTestId('citius-resultado')).not.toContainText(/undefined/i);

  // a notification for an UNKNOWN processo -> needs review, NEVER a guessed prazo
  await page.getByTestId('citius-texto').fill(
    [
      'Citius - Notificação Electrónica',
      `Ref interna ${tag}`,
      'Processo: 4321/26.9T8ZZZ',
      'Fica V. Exa. notificado para apresentar contestação.',
      'Data do acto: 2026-06-05',
    ].join('\n'),
  );
  await page.getByTestId('citius-processar').click();
  await expect(page.getByTestId('citius-resultado')).toContainText(/Precisa de revisão/i, { timeout: 15_000 });

  // the matched row now shows under "Processadas" in the live inbox
  await page.getByTestId('nav-inbox').click();
  await expect(page.getByTestId('inbox-page')).toBeVisible();
  const processada = page
    .getByTestId('inbox-processadas')
    .getByTestId('citius-item')
    .filter({ hasText: tag })
    .first();
  await expect(processada).toBeVisible({ timeout: 15_000 });
  await expect(processada).toContainText(/Prazo criado/i);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Triagem: associar processo + preencher data + Confirmar cria prazo e evento', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const notifId = await injectNotif(page, {
    estado: 'needs-review',
    motivo: 'processo 4321/26.9T8ZZZ não encontrado',
    numeroProcesso: '4321/26.9T8ZZZ',
    ato: 'Contestação',
    dataActo: null,
    texto: `Citius - Notificação. Ref ${tag}. Processo 4321/26.9T8ZZZ. Fica V. Exa. notificado para apresentar contestação. (data do acto por confirmar)`,
    sourceRef: `e2e-A-${tag}`,
  });

  // it shows up under "A rever"
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForShared(page);
  const row = page.getByTestId('inbox-a-rever').getByTestId('citius-item').filter({ hasText: tag }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();

  await expect(page.getByTestId('notificacao-page')).toBeVisible({ timeout: 15_000 });
  // unmatched processo -> the picker is shown, Confirmar disabled
  await expect(page.getByTestId('confirmar-notificacao')).toBeDisabled();

  // associate the seeded processo
  const opt = page.getByTestId('triage-processo').locator('option', { hasText: SEED_PROCESSO });
  await expect(opt).toBeAttached({ timeout: 10_000 });
  await page.getByTestId('triage-processo').selectOption((await opt.getAttribute('value')) ?? '');

  // STILL disabled: the parsed date was missing -> never auto-commits (HARD RULE)
  await expect(page.getByTestId('confirmar-notificacao')).toBeDisabled();

  // fill the date by hand -> proposal appears (shows its work) + Confirmar enables
  await page.getByTestId('triage-data').fill('2026-06-05');
  await expect(page.getByTestId('prazo-proposta')).toBeVisible();
  await expect(page.getByTestId('proposta-datalimite')).toHaveText(/2026-\d{2}-\d{2}/);
  await expect(page.getByTestId('proposta-passos')).toBeVisible();
  await expect(page.getByTestId('confirmar-notificacao')).toBeEnabled();

  await page.getByTestId('confirmar-notificacao').click();
  await expect(page.getByTestId('resultado-triada')).toContainText(/Prazo criado/i, { timeout: 15_000 });

  // the downstream writes: prazo + evento created, row 'matched'+prazoId (the
  // engine's idempotency contract - blocks re-delivered emails) with prazoIds
  const after = await page.evaluate(async (nid) => {
    const api = (window as any).__ekoa.shared;
    const r = await api.get('citius_notificacoes', nid);
    const prazos = (await api.list('prazos')) || [];
    const eventos = (await api.list('eventos')) || [];
    const prazoIds: string[] = Array.isArray(r.prazoIds) ? r.prazoIds : [];
    const prazo = prazos.find((p: any) => prazoIds.includes(p.id));
    const evento = eventos.find((e: any) => e?.metadata?.notificacaoId === nid);
    return {
      estado: r.estado,
      hasProcesso: !!r.processoId,
      prazoOrigem: prazo?.origem,
      prazoLimite: prazo?.dataLimite,
      prazoOk: !!prazo,
      eventoOk: !!evento,
      eventoTipo: evento?.tipo,
      eventoProcessoOk: evento?.processoId === r.processoId,
    };
  }, notifId);
  expect(after.estado).toBe('matched');
  expect(after.hasProcesso).toBe(true);
  expect(after.prazoOk).toBe(true);
  expect(after.prazoOrigem).toBe('citius');
  expect(after.prazoLimite).toMatch(/^2026-\d{2}-\d{2}$/);
  expect(after.eventoOk).toBe(true);
  expect(after.eventoTipo).toBe('citius-notificacao');
  expect(after.eventoProcessoOk).toBe(true);

  // it now appears under Processadas and in the Histórico
  await page.getByTestId('voltar-caixa').click();
  await expect(page.getByTestId('inbox-page')).toBeVisible();
  await expect(
    page.getByTestId('inbox-processadas').getByTestId('citius-item').filter({ hasText: tag }).first(),
  ).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('nav-historico').click();
  await expect(page.getByTestId('historico-page')).toBeVisible();
  await expect(page.getByTestId('historico-tabela')).toContainText(SEED_PROCESSO);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Regra de ouro: sem data do acto, Confirmar fica desligado até preencher à mão', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await injectNotif(page, {
    estado: 'needs-review',
    motivo: 'data do acto não explícita',
    numeroProcesso: SEED_PROCESSO,
    ato: 'Contestação',
    dataActo: null,
    texto: `Citius - Notificação. Ref ${tag}. Processo ${SEED_PROCESSO}. Fica V. Exa. notificado para contestação. Data do acto ilegível.`,
    sourceRef: `e2e-B-${tag}`,
  });

  // open the triage from the inbox (processo is auto-matched from the number)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForShared(page);
  const row = page.getByTestId('inbox-a-rever').getByTestId('citius-item').filter({ hasText: tag }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByTestId('notificacao-page')).toBeVisible({ timeout: 15_000 });

  // processo auto-matched from the number in the spine -> the ONLY thing missing
  // is the date, so Confirmar is disabled and no proposal is shown
  await expect(page.getByTestId('triage-processo')).not.toHaveValue('');
  await expect(page.getByTestId('confirmar-notificacao')).toBeDisabled();
  await expect(page.getByTestId('prazo-proposta')).toHaveCount(0);

  // fill the date by hand -> proposal + Confirmar enable
  await page.getByTestId('triage-data').fill('2026-06-05');
  await expect(page.getByTestId('prazo-proposta')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('confirmar-notificacao')).toBeEnabled();

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Rejeitar: a notificação sai da fila e fica rejeitada', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const notifId = await injectNotif(page, {
    estado: 'needs-review',
    motivo: 'ato não reconhecido',
    numeroProcesso: '5678/26.1T8PRT',
    ato: null,
    dataActo: null,
    texto: `Citius - Notificação. Ref ${tag}. Processo 5678/26.1T8PRT. Comunicação diversa, sem ato reconhecido.`,
    sourceRef: `e2e-C-${tag}`,
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForShared(page);
  const row = page.getByTestId('inbox-a-rever').getByTestId('citius-item').filter({ hasText: tag }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.getByTestId('notificacao-page')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('rejeitar-notificacao').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Rejeitar' }).click();

  await expect(page.getByTestId('resultado-triada')).toContainText(/rejeitada/i, { timeout: 15_000 });

  const estado = await page.evaluate(
    async (nid) => (await (window as any).__ekoa.shared.get('citius_notificacoes', nid)).estado,
    notifId,
  );
  expect(estado).toBe('rejeitada');

  // it appears under Processadas, not under A rever
  await page.getByTestId('voltar-caixa').click();
  await expect(page.getByTestId('inbox-page')).toBeVisible();
  await expect(
    page.getByTestId('inbox-processadas').getByTestId('citius-item').filter({ hasText: tag }).first(),
  ).toBeVisible({ timeout: 15_000 });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

/**
 * Deep link survives a HARD reload of a sub-path. This relies on the platform
 * injecting `<base href="/apps/<id>/">` (injectAppContext, cortex/src/server.ts)
 * so the relatively-referenced bundle resolves from the app root at any depth;
 * with that in place, a hard load of /notificacao/:id boots the SPA and the
 * basename router resolves the route.
 */
test('Deep link: /notificacao/:id resolve após um refresh forçado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const notifId = await injectNotif(page, {
    estado: 'needs-review',
    motivo: 'data do acto não explícita',
    numeroProcesso: SEED_PROCESSO,
    ato: 'Contestação',
    dataActo: null,
    texto: `Citius - Notificação. Ref ${tag}. Processo ${SEED_PROCESSO}. Deep link.`,
    sourceRef: `e2e-D-${tag}`,
  });

  await page.goto(`${BASE}notificacao/${notifId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('notificacao-page')).toBeVisible({ timeout: 20_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('notificacao-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('triage-processo')).toBeVisible();

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
