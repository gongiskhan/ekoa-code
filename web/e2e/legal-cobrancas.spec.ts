import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * Cobranças — the debt-recovery satellite (`legal-cobrancas`) over the SHARED
 * spine. Covers, end-to-end through the served app (cortex at /apps/…):
 *
 *  1. AGING: the outstanding portfolio is bucketed by days overdue; the two
 *     seeded pendentes (venc −22, −4) land in 0–30; the paga (−35) is excluded.
 *     The rendered cards match an independent in-browser computation.
 *  2. DETAIL: the seeded "Fatura FT 2026/18" cobrança shows its 2 sent reminders
 *     in the timeline and the next due step (offset 30) as a preview.
 *  3. RECONCILIATION GOLDEN (§3.3): a tagged cobrança → generate the demo MB
 *     reference → simulate the payment callback (?dev=1) → estado 'paga' AND a
 *     conta_corrente credit (origem 'cobranca', matching refExterna, valor
 *     123.45). Running the callback twice stays idempotent (a single credit).
 *  4. DEONTOLOGY: adding a WhatsApp step to a sequence auto-appends the opt-out
 *     line ("responda REMOVER") to its preview.
 *
 * Self-cleaning: every cobrança/credit/sequência a test creates is tagged with a
 * per-test nonce and removed in afterEach, so the seeded spine is never polluted.
 */
const COBRANCAS = legalAppUrl('legal-cobrancas');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'legal-cobrancas');
mkdirSync(SHOTS, { recursive: true });

const SEEDED_VENCIDA = 'Fatura FT 2026/18 - honorários laboral';

type Ctx = { nonce: string };
const ctx: Ctx = { nonce: '' };

async function waitForSpine(page: Page) {
  await page.waitForFunction(() => Boolean((window as unknown as { __ekoa?: { shared?: unknown } }).__ekoa?.shared), undefined, { timeout: 20_000 });
}

/* Opens the Núcleo (it, and only it, seeds the spine) and waits until the
 * cobranças + reminder history are present. */
async function ensureSeeded(page: Page): Promise<void> {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.evaluate(async (vencida) => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } }).__ekoa.shared;
    for (let i = 0; i < 40; i += 1) {
      const [cobrancas, lembretes] = await Promise.all([s.list('cobrancas'), s.list('lembretes_enviados')]);
      const temVencida = cobrancas.some((c) => c.descricao === vencida);
      if (temVencida && lembretes.length >= 2) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('espinha de cobranças não semeada');
  }, SEEDED_VENCIDA);
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async (nonce) => {
      const s = (window as unknown as { __ekoa?: { shared?: {
        list: (c: string) => Promise<Array<Record<string, unknown>>>;
        delete: (c: string, id: string) => Promise<unknown>;
      } } }).__ekoa?.shared;
      if (!s) return;
      const del = async (col: string, pred: (r: Record<string, unknown>) => boolean) => {
        const rows = await s.list(col).catch(() => []);
        for (const r of rows) {
          if (pred(r)) await s.delete(col, r.id as string).catch(() => {});
        }
      };
      const has = (v: unknown) => typeof v === 'string' && v.includes(nonce);
      await del('cobrancas', (r) => has(r.descricao));
      await del('conta_corrente', (r) => has(r.notas));
      await del('sequencias_lembrete', (r) => has(r.nome));
    }, ctx.nonce);
  } catch { /* page may be gone */ }
});

test('Cobranças: envelhecimento por escalões correcto para as linhas semeadas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `CB-${Date.now()}`;

  await ensureSeeded(page);
  await page.goto(COBRANCAS, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('cobrancas-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('cobrancas-aging')).toBeVisible();

  // Independent in-browser computation of the expected buckets from the shared
  // cobranças (outstanding only, bucketed by whole days overdue). This ties the
  // rendered cards to a computation that never touched the app's engine code.
  const expected = await page.evaluate(() => {
    const w = window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } };
    const diasAtraso = (venc: string): number => {
      const m = String(venc || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return NaN;
      const v = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      const t = new Date(); t.setHours(0, 0, 0, 0);
      return Math.round((t.getTime() - v) / 86400000);
    };
    return w.__ekoa.shared.list('cobrancas').then((cobrancas) => {
      const acc: Record<string, { count: number; hasSeed: boolean }> = {
        '0-30': { count: 0, hasSeed: false }, '31-60': { count: 0, hasSeed: false }, '61+': { count: 0, hasSeed: false },
      };
      for (const c of cobrancas) {
        if (c.estado !== 'pendente' && c.estado !== 'parcial') continue;
        const d = diasAtraso(c.dataVencimento as string);
        if (!Number.isFinite(d)) continue;
        const b = d <= 30 ? '0-30' : d <= 60 ? '31-60' : '61+';
        acc[b].count += 1;
        if (c.descricao === 'Fatura FT 2026/18 - honorários laboral' || c.descricao === 'Fatura FT 2026/21 - consulta e parecer') acc[b].hasSeed = true;
      }
      return acc;
    });
  });

  // Both seeded pendentes fall in 0–30; the paga (−35) is excluded from all buckets.
  expect(expected['0-30'].count, 'both seeded pendentes belong to 0–30').toBeGreaterThanOrEqual(2);
  expect(expected['0-30'].hasSeed).toBe(true);
  expect(expected['31-60'].hasSeed).toBe(false);
  expect(expected['61+'].hasSeed).toBe(false);

  // The rendered card counts match the independent computation, bucket for bucket.
  for (const [bucket, tid] of [['0-30', 'aging-0-30'], ['31-60', 'aging-31-60'], ['61+', 'aging-61-mais']] as const) {
    const rendered = Number((await page.getByTestId(`${tid}-count`).innerText()).trim());
    expect(rendered, `card ${bucket} count`).toBe(expected[bucket].count);
  }

  await page.screenshot({ path: `${SHOTS}/aging.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Cobranças: a ficha mostra a timeline de lembretes e o próximo passo devido', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `CB-${Date.now()}`;

  await ensureSeeded(page);
  await page.goto(COBRANCAS, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  const id = await page.evaluate(async (vencida) => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } }).__ekoa.shared;
    const cobrancas = await s.list('cobrancas');
    const alvo = cobrancas.find((c) => c.descricao === vencida);
    return alvo ? (alvo.id as string) : null;
  }, SEEDED_VENCIDA);
  expect(id, 'seeded cobrança id').toBeTruthy();

  await page.goto(`${COBRANCAS}cobranca/${id}`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('cobranca-detalhe')).toBeVisible({ timeout: 20_000 });

  // Timeline: exactly the 2 seeded sent reminders.
  await expect(page.getByTestId('cobrancas-timeline')).toBeVisible();
  await expect(page.getByTestId('lembrete-enviado')).toHaveCount(2);

  // Next due step is the offset-30 one (venc −22 puts 0/7/15 in the past).
  await expect(page.getByTestId('cobrancas-proximo-passo')).toContainText('+30');

  await page.screenshot({ path: `${SHOTS}/detalhe.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Cobranças: reconciliação do pagamento credita a conta corrente e é idempotente', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `CB-${Date.now()}`;

  await ensureSeeded(page);
  await page.goto(COBRANCAS, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  // Create a tagged cobrança (valor 123.45) against the first seeded client.
  const created = await page.evaluate(async (nonce) => {
    const s = (window as unknown as { __ekoa: { shared: {
      list: (c: string) => Promise<Array<Record<string, unknown>>>;
      create: (c: string, d: unknown) => Promise<Record<string, unknown>>;
    } } }).__ekoa.shared;
    const clientes = await s.list('clientes');
    const clienteId = clientes[0]?.id as string;
    const hoje = (() => { const d = new Date(); const mm = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0'); return `${d.getFullYear()}-${mm}-${dd}`; })();
    const row = await s.create('cobrancas', {
      clienteId,
      descricao: `Cobrança teste ${nonce}`,
      valor: 123.45,
      dataVencimento: hoje,
      estado: 'pendente',
      metodo: 'ifthenpay-mb',
    });
    return { id: row.id as string, clienteId };
  }, ctx.nonce);
  expect(created.id).toBeTruthy();

  await page.goto(`${COBRANCAS}cobranca/${created.id}?dev=1`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('cobranca-detalhe')).toBeVisible({ timeout: 20_000 });

  // Generate the demo MB reference, then simulate the provider callback.
  await page.getByTestId('cobrancas-gerar-ref').click();
  await expect(page.getByTestId('mb-referencia')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('cobrancas-simular-callback').click();
  await expect(page.getByTestId('cobranca-reconciliada')).toBeVisible({ timeout: 10_000 });

  // §3.3 assertion: cobrança paga AND a single matching conta_corrente credit.
  const afterFirst = await page.evaluate(async (id) => {
    const s = (window as unknown as { __ekoa: { shared: {
      get: (c: string, id: string) => Promise<Record<string, unknown> | null>;
      list: (c: string) => Promise<Array<Record<string, unknown>>>;
    } } }).__ekoa.shared;
    const norm = (r: unknown) => String(r == null ? '' : r).replace(/\s+/g, '');
    const cobranca = await s.get('cobrancas', id);
    const ref = norm((cobranca?.refPagamento as { referencia?: string } | undefined)?.referencia);
    const conta = await s.list('conta_corrente');
    const creditos = conta.filter((c) => c.origem === 'cobranca' && norm(c.refExterna) === ref);
    return { estado: cobranca?.estado, ref, creditos: creditos.map((c) => ({ valor: c.valor, clienteId: c.clienteId, origem: c.origem })) };
  }, created.id);

  expect(afterFirst.estado).toBe('paga');
  expect(afterFirst.ref).not.toBe('');
  expect(afterFirst.creditos).toHaveLength(1);
  expect(afterFirst.creditos[0].valor).toBe(123.45);
  expect(afterFirst.creditos[0].clienteId).toBe(created.clienteId);

  // Idempotency: run the callback again — still a single credit.
  await page.getByTestId('cobrancas-simular-callback').click();
  await page.waitForTimeout(500);
  const afterSecond = await page.evaluate(async (ref) => {
    const s = (window as unknown as { __ekoa: { shared: { list: (c: string) => Promise<Array<Record<string, unknown>>> } } }).__ekoa.shared;
    const norm = (r: unknown) => String(r == null ? '' : r).replace(/\s+/g, '');
    const conta = await s.list('conta_corrente');
    return conta.filter((c) => c.origem === 'cobranca' && norm(c.refExterna) === ref).length;
  }, afterFirst.ref);
  expect(afterSecond, 'idempotent: exactly one credit after a second callback').toBe(1);

  await page.screenshot({ path: `${SHOTS}/reconciliacao.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Cobranças: um passo WhatsApp acrescenta sempre a opção de saída na pré-visualização', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `CB-${Date.now()}`;

  await page.goto(`${COBRANCAS}sequencias`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('sequencias-page')).toBeVisible({ timeout: 20_000 });

  // Create a tagged sequence so the seeded one is never mutated.
  const nome = `Seq ${ctx.nonce}`;
  await page.getByTestId('seq-nome').fill(nome);
  await page.getByTestId('seq-criar').click();
  const card = page.locator(`[data-testid="sequencia-card"][data-seq-nome="${nome}"]`);
  await expect(card).toBeVisible({ timeout: 10_000 });

  // The fixed deontology notice is present in the editor.
  await expect(card.getByTestId('whatsapp-consent-notice')).toContainText('consentimento prévio');

  // Add a WhatsApp step: the live preview must carry the opt-out line.
  await card.getByTestId('passo-offset').fill('45');
  await card.getByTestId('passo-canal').selectOption('whatsapp');
  await card.getByTestId('passo-template').fill('Exmo.(a) Sr.(a) {{nome}}, a fatura {{descricao}} aguarda regularização.');
  await expect(card.getByTestId('passo-preview-novo')).toContainText('responda REMOVER');

  // Persist it — the saved step's preview also carries the opt-out line.
  await card.getByTestId('passo-adicionar').click();
  await expect(card.getByTestId('passo-preview').filter({ hasText: 'responda REMOVER' })).toHaveCount(1, { timeout: 10_000 });

  await page.screenshot({ path: `${SHOTS}/sequencias-whatsapp.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
