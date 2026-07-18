import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-rcbe - S6 additions to the RCBE (beneficial-owner) app, over the SHARED
 * spine. The frozen A-RCBE spec already covers the full entidade -> declaração ->
 * assisted-submission -> comprovativo journey on the demo entity 'Vinhos do
 * Douro, Lda.'. THIS spec covers what S6 added, additively:
 *
 *  1. Beneficiários dedup over the shared spine: the same person can be written
 *     more than once (this module writes the BOs that KYC reads). A duplicate BO
 *     (same NIF) is unified - the screen shows each beneficiário once and states
 *     how many duplicates were folded (rcbe-bo-dedup).
 *  2. Declaração checklist PDF export: once the declaração is prepared, it can be
 *     exported to a real PDF via the platform exportPdf bridge, named
 *     declaracao-rcbe-<nipc>-<YYYY-MM-DD>.pdf.
 *
 * Neither touches the ported journey's testids or flow. The demo entity comes
 * from the demo-spine (installed via the Núcleo card if missing). The injected
 * duplicate BO is tagged and deleted in afterEach; the seeded BOs are left alone.
 */
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-rcbe');
mkdirSync(SHOTS, { recursive: true });

// Demo-spine anchors (demo-spine.js): Vinhos do Douro, Lda. (NIPC 509876543) with 2 BOs.
const ENT_NIPC = '509876543';
const BO_NIF = '198765432'; // Manuel Sarmento Vale - we inject a duplicate of this one.

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

let injectedBoIds: string[] = [];
let createdEntIds: string[] = [];

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/**
 * Ensure the demo spine (Vinhos do Douro entity + its 2 BOs) is installed, using
 * the Núcleo demo card exactly as the frozen spec does. Returns the entity id.
 */
async function ensureDemoEntity(page: Page): Promise<string> {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('demo-spine-card')).toBeVisible({ timeout: 20_000 });
  const estado = await page.getByTestId('demo-estado').innerText();
  if (/Não instalado/i.test(estado)) {
    // "Não instalado" também é o estado TRANSITÓRIO do cartão enquanto a coleção
    // carrega - se o botão desmontar (já instalado afinal), o banner é a prova.
    try {
      await page.getByTestId('demo-instalar').click({ timeout: 5_000 });
    } catch { /* a coleção resolveu para Instalado e o botão desmontou */ }
    await expect(page.getByTestId('demo-banner')).toBeVisible({ timeout: 90_000 });
  }
  await waitForSpine(page);

  const findId = () =>
    page.evaluate(async (nipc) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return '';
      const ents = await s.list('rcbe_entidades');
      const ent = ents.find((e) => String(e.nipc) === nipc);
      return ent ? String(ent.id) : '';
    }, ENT_NIPC);

  await expect.poll(findId, { timeout: 30_000 }).not.toBe('');
  return findId();
}

test.afterEach(async ({ page }) => {
  if (injectedBoIds.length === 0 && createdEntIds.length === 0) return;
  try {
    await page.evaluate(async ({ boIds, entIds }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      for (const id of boIds) {
        try { await s.delete('beneficiarios_efetivos', id); } catch { /* ignore */ }
      }
      for (const id of entIds) {
        try { await s.delete('rcbe_entidades', id); } catch { /* ignore */ }
      }
    }, { boIds: injectedBoIds, entIds: createdEntIds });
  } catch { /* page may be gone */ }
  injectedBoIds = [];
  createdEntIds = [];
});

test('RCBE: beneficiarios duplicados sobre a espinha sao unificados', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const entId = await ensureDemoEntity(page);
  const nonce = `XRC1-${Date.now()}`;

  // Inject a DUPLICATE of an existing BO (same NIF, lower percentagem) onto the
  // same entity. Dedup must fold it: the person still counts once.
  const injected = await page.evaluate(async ({ entId, nipc, nif, n }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const bo = await s.create('beneficiarios_efetivos', {
      entidadeId: entId, entidadeNipc: nipc,
      nome: 'Manuel Sarmento Vale', nif, natureza: 'capital', percentagem: 5,
      notas: n, // teardown marker
    });
    return String(bo.id);
  }, { entId, nipc: ENT_NIPC, nif: BO_NIF, n: nonce });
  injectedBoIds = [injected];

  await page.goto(legalAppUrl('legal-rcbe', `entidade/${entId}`), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('rcbe-detalhe')).toBeVisible({ timeout: 20_000 });

  // Despite the duplicate, the person is shown once (2 seeded BOs, not 3), and
  // the dedup note states duplicates were folded.
  await expect(page.getByTestId('rcbe-bo-row')).toHaveCount(2, { timeout: 10_000 });
  const dedup = page.getByTestId('rcbe-bo-dedup');
  await expect(dedup).toBeVisible({ timeout: 10_000 });
  await expect(dedup).toContainText('unificadas');

  await page.screenshot({ path: `${SHOTS}/dedup.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('RCBE: a declaracao exporta PDF (checklist) via exportPdf', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const entId = await ensureDemoEntity(page);

  await page.goto(legalAppUrl('legal-rcbe', `entidade/${entId}`), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('rcbe-detalhe')).toBeVisible({ timeout: 20_000 });

  // Prepare the declaração so the export button appears.
  await page.getByTestId('rcbe-preparar').click();
  await expect(page.getByTestId('rcbe-declaracao')).toBeVisible({ timeout: 10_000 });

  const exportar = page.getByTestId('rcbe-exportar-pdf');
  await expect(exportar).toBeVisible();
  await expect(exportar).toBeEnabled();

  // The export goes through the platform exportPdf bridge (server-side Chromium
  // render), so allow a generous timeout for the real PDF to come back.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    exportar.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^declaracao-rcbe-.+-\d{4}-\d{2}-\d{2}\.pdf$/);

  await page.screenshot({ path: `${SHOTS}/declaracao-pdf.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('RCBE: declaracao PDF sem beneficiarios cita a direcao de topo com o artigo correto', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const nonce = `XRC3-${Date.now()}`;

  await page.goto(legalAppUrl('legal-rcbe'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  // Entity with NO beneficiaries >= 25%: the exported declaracao must render the
  // senior-management fallback row citing art. 30.º da Lei n.º 83/2017 (the AML
  // law that defines the 25% threshold and the direcao-de-topo fallback), never
  // Lei 89/2017, whose art. 30.º is data protection - a real cite bug once.
  const entId = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const ent = await s.create('rcbe_entidades', {
      nome: `Entidade Sem BOs ${n}`, nipc: '501234569', formaJuridica: 'sociedade', notas: n,
    });
    return String(ent.id);
  }, nonce);
  createdEntIds = [entId];

  await page.goto(legalAppUrl('legal-rcbe', `entidade/${entId}`), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('rcbe-detalhe')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('rcbe-preparar').click();
  await expect(page.getByTestId('rcbe-declaracao')).toBeVisible({ timeout: 10_000 });

  // Stub the platform bridge to capture the compiled HTML instead of downloading.
  await page.evaluate(() => {
    const w = window as unknown as { __ekoa: Record<string, unknown>; __exported: unknown[] };
    w.__exported = [];
    w.__ekoa.exportPdf = async (payload: unknown) => {
      w.__exported.push(payload);
      return { ok: true };
    };
  });
  await page.getByTestId('rcbe-exportar-pdf').click();
  await page.waitForFunction(
    () => ((window as unknown as { __exported?: unknown[] }).__exported || []).length > 0,
    undefined,
    { timeout: 15_000 },
  );
  const html = await page.evaluate(() => {
    const arr = (window as unknown as { __exported: Array<{ html?: string }> }).__exported;
    return String(arr[arr.length - 1].html || '');
  });
  expect(html).toContain('Sem beneficiários a 25% ou mais');
  expect(html, 'direcao-de-topo fallback cites the AML law').toContain('art. 30.º da Lei n.º 83/2017');
  expect(html).not.toContain('art. 30.º, Lei n.º 89/2017');

  await page.screenshot({ path: `${SHOTS}/declaracao-sem-bos.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
