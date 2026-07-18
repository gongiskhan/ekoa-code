import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-injuncoes - S3-money layer of the Injunções app (run
 * 20260717-202309-d797918a), on top of the byte-frozen legal-injuncoes spec.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-injuncoes/):
 *  1. ?cobranca= handoff (the target of the Cobranças escalada deep-link):
 *     a real vencida is pre-selected; an invalid/ghost id is honestly flagged
 *     (injuncao-atalho-aviso) instead of silently picking another crédito.
 *     Eligibility is CITED as it changes: DL 62/2013 (comercial, sem limite)
 *     vs DL 269/98, art. 1.º (regime geral até €15.000).
 *  2. Detail lifecycle + requerimento: the trilho card logs 'criada'; the BNI
 *     card links out to the verified official portals (Citius for submission,
 *     Justiça.gov.pt for consultation - manual-first, no fake submission); the
 *     juros/taxa come from the LIVE calculos service and the requerimento
 *     exports as a real conference-minute PDF, leaving a 'requerimento-
 *     exportado' proveniência event in registo_eventos.
 *
 * Deterministic + self-cleaning: fixture rows carry a per-run nonce; the
 * derived rows (injuncoes, calculos, registo_eventos) are removed by FK/diff.
 */
const APP = legalAppUrl('legal-injuncoes');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-injuncoes');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

type Ctx = { nonce: string; clienteIds: string[]; eventosAntes: string[] | null };
const ctx: Ctx = { nonce: '', clienteIds: [], eventosAntes: null };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 90_000 });
}

/** Local 'YYYY-MM-DD' shifted by `dias` into the past. */
function diasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}

async function criarVencida(page: Page, nonce: string, valor: number) {
  const injected = await page.evaluate(async ({ n, v, vencimento }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente XI ${n}`, nif: '299000005', tipo: 'empresa' });
    const cob = await s.create('cobrancas', {
      clienteId: String(cli.id), descricao: `XI ${n}`, valor: v,
      dataVencimento: vencimento, estado: 'pendente', metodo: 'transferencia',
    });
    return { cli: String(cli.id), cob: String(cob.id) };
  }, { n: nonce, v: valor, vencimento: diasAtras(40) });
  ctx.clienteIds.push(injected.cli);
  return injected;
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ clienteIds, nonce, eventosAntes }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const tagged = (v: unknown) => typeof v === 'string' && nonce !== '' && v.includes(nonce);
      const fk = (v: unknown, ids: string[]) => typeof v === 'string' && ids.includes(v);
      // Injunções derivadas dos nossos clientes primeiro (para apanhar os seus
      // cálculos por injuncaoId), depois as linhas base e os eventos novos.
      let injIds: string[] = [];
      try {
        const injs = await s.list('injuncoes');
        for (const r of injs) {
          if (fk(r.clienteId, clienteIds) || tagged(r.descricao)) {
            injIds.push(String(r.id));
            try { await s.delete('injuncoes', String(r.id)); } catch { /* ignore */ }
          }
        }
      } catch { injIds = []; }
      for (const col of ['calculos', 'prazos', 'tarefas', 'correio']) {
        try {
          for (const r of await s.list(col)) {
            if (fk(r.injuncaoId, injIds)) { try { await s.delete(col, String(r.id)); } catch { /* ignore */ } }
          }
        } catch { /* ignore */ }
      }
      for (const col of ['cobrancas', 'clientes']) {
        try {
          for (const r of await s.list(col)) {
            if (fk(r.clienteId, clienteIds) || fk(r.id, clienteIds) || tagged(r.descricao) || tagged(r.nome)) {
              try { await s.delete(col, String(r.id)); } catch { /* ignore */ }
            }
          }
        } catch { /* ignore */ }
      }
      if (eventosAntes) {
        try {
          const antes = new Set(eventosAntes);
          for (const r of await s.list('registo_eventos')) {
            if (r.app === 'legal-injuncoes' && !antes.has(String(r.id))) {
              try { await s.delete('registo_eventos', String(r.id)); } catch { /* ignore */ }
            }
          }
        } catch { /* ignore */ }
      }
    }, ctx);
  } catch { /* page may be gone - ignore */ }
  ctx.clienteIds = [];
  ctx.eventosAntes = null;
});

test('Injuncoes: o atalho ?cobranca= pre-escolhe o credito, um id fantasma e declarado, e a elegibilidade cita a lei', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XI1-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'injuncao-nova');
  const injected = await criarVencida(page, nonce, 900);

  // Atalho com uma cobrança REAL vencida: fica pré-escolhida na lista.
  await page.goto(`${APP}?cobranca=${injected.cob}`, { waitUntil: 'domcontentloaded' });
  await ready(page, 'injuncao-nova');
  await expect(page.getByTestId('injuncao-cobranca')).toHaveValue(injected.cob, { timeout: 15_000 });

  // Elegibilidade citada: por omissão transação comercial -> DL 62/2013 (sem
  // limite); sem transação comercial -> regime geral DL 269/98 (até €15.000).
  await expect(page.getByTestId('injuncao-elegibilidade')).toContainText('DL 62/2013');
  await page.getByTestId('injuncao-comercial').uncheck();
  await expect(page.getByTestId('injuncao-elegibilidade')).toContainText('DL 269/98');

  await page.screenshot({ path: `${SHOTS}/atalho-elegibilidade.png`, fullPage: true });

  // Atalho com um id FANTASMA: aviso honesto, nada fica escolhido às cegas.
  await page.goto(`${APP}?cobranca=fantasma-${nonce}`, { waitUntil: 'domcontentloaded' });
  await ready(page, 'injuncao-nova');
  await expect(page.getByTestId('injuncao-atalho-aviso')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('injuncao-cobranca')).toHaveValue('');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Injuncoes: trilho de vida, portais oficiais BNI e requerimento em PDF com evento de proveniencia', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XI2-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'injuncao-nova');
  const injected = await criarVencida(page, nonce, 1200);
  ctx.eventosAntes = await page.evaluate(async () => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    try { return (await s.list('registo_eventos')).map((r) => String(r.id)); } catch { return []; }
  });

  await page.goto(`${APP}?cobranca=${injected.cob}`, { waitUntil: 'domcontentloaded' });
  await ready(page, 'injuncao-nova');
  await expect(page.getByTestId('injuncao-cobranca')).toHaveValue(injected.cob, { timeout: 15_000 });
  await page.getByTestId('injuncao-criar').click();
  await ready(page, 'injuncao-detalhe');

  // Trilho de vida: a criação já ficou registada com data.
  await expect(page.getByTestId('injuncao-trilho')).toBeVisible();
  await expect(page.getByTestId('injuncao-trilho-item')).toHaveCount(1);
  await expect(page.getByTestId('injuncao-trilho-item')).toContainText('Criada');

  // Manual-first: a app aponta para os portais oficiais verificados - a
  // submissão eletrónica é no Citius; a consulta em Justiça.gov.pt.
  await expect(page.getByTestId('injuncao-bni-link')).toHaveAttribute('href', /citius\.tribunaisnet\.mj\.pt/);
  await expect(page.getByTestId('injuncao-bni-consulta')).toHaveAttribute('href', /justica\.gov\.pt/);

  // Juros por troços + taxa de justiça vêm do serviço de cálculos (P2-001);
  // cada número chega com a sua fonte (Avisos; RCP com UC).
  await page.getByTestId('injuncao-calcular').click();
  await expect(page.getByTestId('injuncao-juros')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('injuncao-juros')).toContainText('Aviso n.º');
  await expect(page.getByTestId('injuncao-taxa')).toContainText('UC');
  await expect(page.getByTestId('injuncao-total')).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/injuncao-calculada.png`, fullPage: true });

  // Minuta de conferência em PDF real (ponte exportPdf, render no servidor).
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.getByTestId('injuncao-requerimento-pdf').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^requerimento-injuncao .*\.pdf$/i);

  // A exportação deixa proveniência: um evento 'requerimento-exportado'.
  await expect
    .poll(async () => page.evaluate(async (antes) => {
      const s = (window as unknown as SharedWindow).__ekoa!.shared!;
      const set = new Set(antes || []);
      const rows = await s.list('registo_eventos');
      return rows.filter((r) => r.app === 'legal-injuncoes' && r.acao === 'requerimento-exportado' && !set.has(String(r.id))).length;
    }, ctx.eventosAntes), { timeout: 15_000 })
    .toBeGreaterThan(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
