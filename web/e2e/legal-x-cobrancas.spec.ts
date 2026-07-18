import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-cobrancas - S3-money layer of the Cobranças app (run
 * 20260717-202309-d797918a), on top of the byte-frozen legal-cobrancas spec.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-cobrancas/):
 *  1. Aging escalation ruler: each escalão card names its próxima ação with the
 *     legal cite (31-60 interpelação, art. 805.º CC; 61+ injunção, DL 269/98).
 *  2. Carta de interpelação on the detail of a vencida: deterministic engine
 *     letter with the juros fetched from the LIVE legal-calculos service (the
 *     P2-001 boundary - the honest no-service fallback is pinned by the unit
 *     suite cobrancas-carta.test.ts), then exported as a real PDF.
 *  3. Injunção handoff: the escalada card deep-links to the Injunções app with
 *     the cobrança pre-selected (?cobranca=<id> - received by legal-x-injuncoes).
 *
 * Deterministic + self-cleaning: rows carry a per-run nonce and are deleted in
 * afterEach; the frozen spec's seeded aging counts are not asserted here.
 */
const APP = legalAppUrl('legal-cobrancas');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-cobrancas');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

type Ctx = { nonce: string; clienteIds: string[] };
const ctx: Ctx = { nonce: '', clienteIds: [] };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 90_000 });
}

/** Local 'YYYY-MM-DD' shifted by `dias` (negative = past). */
function diasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ clienteIds, nonce }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const cols = ['cobrancas', 'notificacoes', 'clientes'];
      const tagged = (v: unknown) => typeof v === 'string' && nonce !== '' && v.includes(nonce);
      const fk = (v: unknown, ids: string[]) => typeof v === 'string' && ids.includes(v);
      for (const col of cols) {
        let rows: Row[] = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          const hit = fk(r.clienteId, clienteIds) || fk(r.id, clienteIds) || tagged(r.descricao) || tagged(r.nome);
          if (hit) { try { await s.delete(col, String(r.id)); } catch { /* ignore */ } }
        }
      }
    }, ctx);
  } catch { /* page may be gone - ignore */ }
  ctx.clienteIds = [];
});

test('Cobrancas: cada escalao de aging sugere a proxima acao com a sua cita legal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'cobrancas-page');

  await expect(page.getByTestId('aging-0-30-acao')).toContainText('Lembrete');
  await expect(page.getByTestId('aging-31-60-acao')).toContainText('Carta de interpelação');
  await expect(page.getByTestId('aging-31-60-acao')).toContainText('Art. 805.º, n.º 1, do Código Civil');
  await expect(page.getByTestId('aging-61-mais-acao')).toContainText('Injunção');
  await expect(page.getByTestId('aging-61-mais-acao')).toContainText('DL n.º 269/98');

  await page.screenshot({ path: `${SHOTS}/aging-acoes.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Cobrancas: carta de interpelacao com juros do servico, PDF real e atalho para a injuncao', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XC2-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'cobrancas-page');

  // Cobrança vencida há 45 dias (escalão 31-60 -> interpelação).
  const injected = await page.evaluate(async ({ n, vencimento }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente XC ${n}`, nif: '299000005', tipo: 'empresa' });
    const cob = await s.create('cobrancas', {
      clienteId: String(cli.id), descricao: `XC ${n}`, valor: 1500,
      dataVencimento: vencimento, estado: 'pendente', metodo: 'transferencia',
    });
    return { cli: String(cli.id), cob: String(cob.id) };
  }, { n: nonce, vencimento: diasAtras(45) });
  ctx.clienteIds = [injected.cli];

  // As colecções carregam no mount - recarrega para a fixture entrar na lista.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page, 'cobrancas-page');
  await page.locator(`[data-cobranca-descricao="XC ${nonce}"]`).click();
  await ready(page, 'cobranca-detalhe');

  await expect(page.getByTestId('cobranca-escalada')).toBeVisible();
  await expect(page.getByTestId('cobranca-proxima-acao')).toContainText('31-60');
  await expect(page.getByTestId('cobranca-proxima-acao')).toContainText('Carta de interpelação');
  await expect(page.getByTestId('cobranca-proxima-acao')).toContainText('Art. 805.º, n.º 1, do Código Civil');

  // O atalho para a Injunções leva a cobrança pré-escolhida no query string.
  await expect(page.getByTestId('cobranca-injuncao-link')).toHaveAttribute(
    'href',
    `/apps/legal-injuncoes/?cobranca=${injected.cob}`,
  );

  // Gerar a carta: os juros vêm do serviço de cálculos (fronteira P2-001) -
  // com o serviço vivo a carta sai COM juros e a nota di-lo com o Aviso.
  await page.getByTestId('cobranca-carta-gerar').click();
  await expect(page.getByTestId('cobranca-interpelacao-texto')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('cobranca-interpelacao-texto')).toContainText('INTERPELAÇÃO PARA CUMPRIMENTO');
  await expect(page.getByTestId('cobranca-interpelacao-texto')).toContainText('1500,00 EUR');
  await expect(page.getByTestId('cobranca-interpelacao-texto')).toContainText('Decreto-Lei n.º 269/98');
  await expect(page.getByTestId('cobranca-interpelacao-texto')).toContainText('artigo 102.º do Código Comercial');
  await expect(page.getByTestId('cobranca-carta-nota')).toContainText('cita o seu Aviso');
  await expect(page.getByTestId('cobranca-carta-nota')).toContainText('a contar da receção');

  await page.screenshot({ path: `${SHOTS}/carta-gerada.png`, fullPage: true });

  // Exportação pela ponte exportPdf da plataforma (render Chromium no servidor).
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.getByTestId('cobranca-carta-pdf').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^interpelacao .*\.pdf$/i);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
