import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-correio - S5 featured-artifact layer of the Correio app.
 *
 * The frozen legal-correio.spec.ts already pins the register flow, the manual
 * state transitions, the comprovativo upload and the graceful CTT indisponível
 * state. This spec covers the NEW, additive DOSSIE ROUND-TRIP deep-link (a
 * URL-parameter contract only - the Expediente is the RECEIVING end, and no
 * dossie edit is required to drive it):
 *
 *  1. /apps/legal-correio/?ref=<registoRef> focuses exactly the carta with that
 *     reference: it seeds the search filter and marks the row "Em foco"
 *     (correio-foco-<id> + correio-foco-badge). This is the reverse leg of the
 *     round-trip - the dossie (or the comprovativo notification) links a carta
 *     by its registoRef and the Expediente lands on it.
 *  2. /apps/legal-correio/?processo=<processoId> filters the expediente to that
 *     process (by its number) - the process-scoped leg of the same contract.
 *  3. The OUTBOUND leg stays honest: attaching a comprovativo to a carta with a
 *     processoId writes a `documentos` row (origem 'legal-correio') AND a spine
 *     notification whose href deep-links into that processo's dossie - so the
 *     round-trip is closed on the spine, not faked.
 *
 * Deterministic + self-cleaning: every row carries the run nonce; afterEach
 * deletes the correio + documentos + notificacoes rows it created. Seeded rows
 * are never deleted.
 */
const APP = legalAppUrl('legal-correio');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-correio');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = {
  __ekoa?: { shared?: SharedApi; deleteFile?: (id: string) => Promise<unknown> };
  __EKOA_APP_ID?: string;
};

const ctx: { nonce: string } = { nonce: '' };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

/* Núcleo seeds the spine; wait until the shared `correio` collection is present. */
async function ensureSeeded(page: Page) {
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await page.waitForFunction(async () => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const rows = await s.list('correio');
    return Array.isArray(rows) && rows.length >= 2;
  }, undefined, { timeout: 30_000 });
}

interface SeedIds { correioId: string; processoId: string; numero: string; ref: string; nonce: string }

/* Seeds a processo + a correio row bound to it, with a known registoRef, so the
 * deep-link (?ref= / ?processo=) has a deterministic target. */
async function seedCarta(page: Page, nonce: string): Promise<SeedIds> {
  return page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const numero = `9600/${Date.now() % 10000}.0T8XCR`;
    const prc = await s.create('processos', {
      numeroProcesso: numero, tribunal: 'Juizo E2E de Lisboa', area: 'Civel', estado: 'ativo', xnonce: n,
    });
    const ref = `RR${String(Date.now()).slice(-9)}PT`;
    const carta = await s.create('correio', {
      tipo: 'carta-registada',
      destinatario: { nome: `Destinatario X ${n}`, morada: 'Rua E2E, 1, Lisboa' },
      conteudoDescricao: `Notificacao round-trip ${n}`,
      registoRef: ref,
      estado: 'expedido',
      datas: { expedido: new Date().toISOString().slice(0, 10) },
      processoId: prc.id,
      xnonce: n,
    });
    return { correioId: String(carta.id), processoId: String(prc.id), numero, ref, nonce: n };
  }, nonce);
}

async function cleanup(page: Page) {
  if (!ctx.nonce) return;
  try {
    await page.evaluate(async (nonce) => {
      const w = window as unknown as SharedWindow;
      const s = w.__ekoa?.shared;
      if (!s) return;
      const safeDel = async (col: string, id: unknown) => { try { await s.delete(col, String(id)); } catch { /* ignore */ } };
      // documentos created as comprovativos in this run (origem legal-correio, name carries nothing;
      // link them via the correio rows we tagged).
      const correio = (await s.list('correio')).filter((r) => typeof r.conteudoDescricao === 'string' && r.conteudoDescricao.includes(nonce));
      for (const r of correio) {
        if (r.comprovativoDocumentoId) {
          const docs = await s.list('documentos');
          const doc = docs.find((d) => String(d.id) === String(r.comprovativoDocumentoId));
          const f = (doc && (doc.ficheiro as Row)) || null;
          if (f && f.fileId && f.appId === w.__EKOA_APP_ID && typeof w.__ekoa?.deleteFile === 'function') {
            try { await w.__ekoa.deleteFile(String(f.fileId)); } catch { /* ignore */ }
          }
          await safeDel('documentos', r.comprovativoDocumentoId);
        }
        await safeDel('correio', r.id);
      }
      // notifications whose href references our processo (best-effort by nonce-tagged processo)
      const procs = (await s.list('processos')).filter((p) => p.xnonce === nonce).map((p) => String(p.id));
      for (const b of await s.list('notificacoes')) {
        const href = String(b.href || '');
        if (procs.some((pid) => href.includes(pid))) await safeDel('notificacoes', b.id);
      }
      for (const pid of procs) await safeDel('processos', pid);
    }, ctx.nonce);
  } catch { /* best-effort */ }
  ctx.nonce = '';
}

function makePng(): Buffer {
  // 1x1 transparent PNG.
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
}

test.afterEach(async ({ page }) => {
  await cleanup(page);
});

test('Correio: deep-link ?ref= foca a carta correspondente (ida-e-volta a partir do dossie)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `XCR1-${Date.now()}`;

  await ensureSeeded(page);
  const ids = await seedCarta(page, ctx.nonce);

  // Land on the Expediente via the round-trip deep-link.
  await page.goto(`${APP}?ref=${encodeURIComponent(ids.ref)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('correio-expediente-page')).toBeVisible({ timeout: 20_000 });

  // The referenced row is focused: it shows the "Em foco" badge and its ref cell.
  await expect(page.getByTestId(`correio-foco-${ids.correioId}`)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('correio-foco-badge')).toBeVisible();
  await expect(page.getByTestId(`correio-ref-${ids.correioId}`)).toHaveText(ids.ref);
  // The search filter was seeded from the deep-link.
  await expect(page.getByTestId('correio-filtro-texto')).toHaveValue(ids.ref);

  await page.screenshot({ path: `${SHOTS}/deeplink-ref.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Correio: deep-link ?processo= filtra o expediente por numero de processo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `XCR2-${Date.now()}`;

  await ensureSeeded(page);
  const ids = await seedCarta(page, ctx.nonce);

  await page.goto(`${APP}?processo=${encodeURIComponent(ids.processoId)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('correio-expediente-page')).toBeVisible({ timeout: 20_000 });

  // The filter is seeded with the process number and our carta is listed.
  await expect(page.getByTestId('correio-filtro-texto')).toHaveValue(ids.numero);
  await expect(page.getByTestId(`correio-ref-${ids.correioId}`)).toBeVisible({ timeout: 15_000 });
  // Its processo cell deep-links INTO the dossie (the outbound leg's anchor).
  await expect(page.getByTestId(`correio-processo-${ids.correioId}`))
    .toHaveAttribute('href', new RegExp(`/apps/legal-dossie/processo/${ids.processoId}`));

  await page.screenshot({ path: `${SHOTS}/deeplink-processo.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Correio: comprovativo escreve documento na espinha e notificacao que liga ao dossie (fecho do round-trip)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  ctx.nonce = `XCR3-${Date.now()}`;

  await ensureSeeded(page);
  const ids = await seedCarta(page, ctx.nonce);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('correio-expediente-page')).toBeVisible({ timeout: 20_000 });
  // Filter down to our carta so the row is on screen.
  await page.getByTestId('correio-filtro-texto').fill(ids.ref);
  await expect(page.getByTestId(`correio-comprovativo-${ids.correioId}`)).toBeVisible({ timeout: 15_000 });

  // Attach a comprovativo (the hidden file input is shared; clicking the row action arms it).
  await page.getByTestId(`correio-comprovativo-${ids.correioId}`).click();
  await page.getByTestId('correio-comprovativo-input').setInputFiles({
    name: `comprovativo-x-${ctx.nonce}.png`,
    mimeType: 'image/png',
    buffer: makePng(),
  });

  // Spine truth: a documentos row (origem legal-correio) linked to the processo,
  // plus a notification whose href deep-links into that processo's dossie.
  await expect(async () => {
    const state = await page.evaluate(async ({ processoId }) => {
      const s = (window as unknown as SharedWindow).__ekoa!.shared!;
      const docs = await s.list('documentos');
      const doc = docs.find((d) => d.origem === 'legal-correio' && d.processoId === processoId);
      const notifs = await s.list('notificacoes');
      const notif = notifs.find((b) => String(b.href || '').includes(`/apps/legal-dossie/processo/${processoId}`));
      return { hasDoc: Boolean(doc), hasNotif: Boolean(notif) };
    }, { processoId: ids.processoId });
    expect(state.hasDoc, 'comprovativo documento written to spine').toBe(true);
    expect(state.hasNotif, 'notification deep-links into the dossie').toBe(true);
  }).toPass({ timeout: 15_000 });

  await page.screenshot({ path: `${SHOTS}/comprovativo.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
