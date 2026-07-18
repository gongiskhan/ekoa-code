import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';
import {
  NIF_SINGULAR_VALIDO,
  NIF_SINGULAR_INVALIDO,
} from './fixtures/legal-x-kyc.fixtures';

/**
 * legal-x-kyc - S6 compliance layer of the KYC diligence app over the SHARED
 * spine (Lei n.º 83/2017).
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-kyc/):
 *  1. Loads with zero page errors.
 *  2. NIF/NIPC check-digit validation on the identification step: a SYNTHETIC
 *     check-digit-invalid NIF is flagged (data-nif-valido="false") with the
 *     module-11 reason; a computed-valid NIF passes (data-nif-valido="true").
 *     A company selection validates as NIPC. All fixture numbers are synthetic
 *     and check-digit-invalid BY DESIGN where they represent a rejection.
 *  3. The 7-year conservation posture is visible: the Fichas list carries the
 *     art. 51.º / "7 anos" banner, and the new Radar de conservação view lists
 *     approved fichas by archive date, citing Lei n.º 83/2017.
 *
 * Deterministic + self-cleaning: injected clientes/fichas carry a per-run nonce
 * and are deleted in afterEach. No login (served app). Never fakes a passing NIF.
 */
const APP = legalAppUrl('legal-kyc');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-kyc');
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
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 20_000 });
}

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/** Local 'YYYY-MM-DD'. */
function hojeLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ clienteIds, nonce }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const cols = ['kyc_fichas', 'kyc_eventos', 'beneficiarios_efetivos', 'clientes'];
      const tagged = (v: unknown) => typeof v === 'string' && nonce !== '' && v.includes(nonce);
      const fk = (v: unknown) => typeof v === 'string' && clienteIds.includes(v);
      for (const col of cols) {
        let rows: Row[] = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          if (fk(r.clienteId) || fk(r.id) || tagged(r.nome) || tagged(r.detalhe)) {
            try { await s.delete(col, String(r.id)); } catch { /* ignore */ }
          }
        }
      }
    }, ctx);
  } catch { /* page may be gone */ }
  ctx.clienteIds = [];
});

test('KYC: carrega sem erros de pagina', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'fichas-page');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('KYC: valida o digito de controlo do NIF/NIPC do cliente (sintetico invalido e rejeitado)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XK1-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'fichas-page');
  await waitForSpine(page);

  // Two SYNTHETIC clientes: one particular with a check-digit-INVALID NIF, one
  // with a computed-VALID NIF. The number that must fail is invalid by design.
  const injected = await page.evaluate(async ({ n, nifBad, nifGood }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const mau = await s.create('clientes', { nome: `Cliente KYC MAU ${n}`, nif: nifBad, tipo: 'particular' });
    const bom = await s.create('clientes', { nome: `Cliente KYC BOM ${n}`, nif: nifGood, tipo: 'particular' });
    return { mau: String(mau.id), bom: String(bom.id) };
  }, { n: nonce, nifBad: NIF_SINGULAR_INVALIDO, nifGood: NIF_SINGULAR_VALIDO });
  ctx.clienteIds = [injected.mau, injected.bom];

  // Go to Nova ficha, advance to the identification step.
  await page.goto(legalAppUrl('legal-kyc', 'nova'), { waitUntil: 'domcontentloaded' });
  await ready(page, 'nova-ficha-page');
  await page.getByTestId('kyc-servico-avancar').click();
  const cliente = page.getByTestId('kyc-cliente');
  await expect(cliente).toBeVisible({ timeout: 15_000 });

  // Select the INVALID-NIF cliente -> the check-digit badge flags it false and
  // explains the module-11 mismatch. This must NOT be presented as a pass.
  await cliente.selectOption(injected.mau);
  const check = page.getByTestId('kyc-nif-check');
  await expect(check).toBeVisible({ timeout: 10_000 });
  await expect(check).toHaveAttribute('data-nif-valido', 'false');
  await expect(check).toContainText('inválido');

  await page.screenshot({ path: `${SHOTS}/nif-invalido.png`, fullPage: true });

  // Select the VALID-NIF cliente -> the badge flips to true.
  await cliente.selectOption(injected.bom);
  await expect(check).toHaveAttribute('data-nif-valido', 'true', { timeout: 10_000 });
  await expect(check).toContainText('válido');

  // Flip the client type to empresa: the same valid singular NIF is NOT a valid
  // NIPC (wrong nature class), so the badge must flag it invalid as a NIPC.
  await page.getByTestId('kyc-tipo').selectOption('empresa');
  await expect(check).toHaveAttribute('data-nif-valido', 'false', { timeout: 10_000 });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('KYC: postura de conservacao a 7 anos e radar de conservacao (Lei 83/2017)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XK2-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'fichas-page');
  await waitForSpine(page);

  // The Fichas list carries the standing 7-year conservation banner (art. 51.º).
  const conservacao = page.getByTestId('kyc-conservacao');
  await expect(conservacao).toBeVisible({ timeout: 10_000 });
  await expect(conservacao).toContainText('7 anos');

  // Seed an APPROVED ficha with an archive date so the radar has a row. It is
  // tagged via its cliente nonce and torn down in afterEach.
  const injected = await page.evaluate(async ({ n, hoje }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente RADAR ${n}`, nif: '299000005', tipo: 'particular' });
    const arquivarAte = `${Number(hoje.slice(0, 4)) + 7}${hoje.slice(4)}`; // +7 anos
    await s.create('kyc_fichas', {
      clienteId: String(cli.id), estado: 'aprovada', risco: 'baixo', score: 10,
      arquivarAte, tipoCliente: 'particular', tipoServico: 'imobiliario',
    });
    return { cli: String(cli.id) };
  }, { n: nonce, hoje: hojeLocal() });
  ctx.clienteIds = [injected.cli];

  // Reach the Radar de conservação view via its nav item.
  await page.goto(legalAppUrl('legal-kyc', 'arquivo'), { waitUntil: 'domcontentloaded' });
  await ready(page, 'arquivo-radar-page');
  await expect(page.getByTestId('radar-resumo')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('arquivo-radar-page')).toContainText('Lei n.º 83/2017');

  // The approved ficha shows in the radar as in-conservation.
  const tabela = page.getByTestId('radar-tabela');
  await expect(tabela).toContainText(`Cliente RADAR ${nonce}`, { timeout: 10_000 });
  await expect(tabela.getByTestId('radar-banda-em-conservacao').first()).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/radar.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
