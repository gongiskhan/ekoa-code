import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-transcricao - S5 featured-artifact layer of the Transcrição app.
 *
 * The frozen legal-transcricao.spec.ts (A-TRANS) already pins the upload -> mock
 * STT -> word correction -> speaker labelling -> art. 640.º excerpt gate. This
 * spec covers the NEW, additive KEYBOARD-FIRST review affordances plus the
 * timestamped export, driving them deterministically off a SEEDED transcrição
 * (no STT run needed):
 *
 *  1. The review card exposes a transport bar - play/pause, seek and an
 *     "Inserir marca de tempo" control - and a keyboard-shortcut legend. Both
 *     the button AND the `i` key (with the editor focused, and NOT while a text
 *     field has focus) insert a timestamp marker; the marker row shows a
 *     formatted timestamp and can be removed.
 *  2. The keyboard `i` shortcut is IGNORED while a text input has focus, so it
 *     never steals a keystroke from the word-correction field.
 *  3. Speaker rename PROPAGATES: labelling ORADOR_2 (papel + nome) flows into the
 *     generated art. 640.º excerpt, and the excerpt carries timestamps.
 *
 * Deterministic + self-cleaning: seeds one transcrição row with a tiny built-in
 * two-speaker fixture and a data-URL audio, then deletes it (plus any excerto it
 * produced) afterwards.
 */
const APP = legalAppUrl('legal-transcricao');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-transcricao');
mkdirSync(SHOTS, { recursive: true });

// A 44-byte silent WAV header as a data URL - enough for the <audio> element to
// mount; the review controls never require the media to actually decode.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 30_000 },
  );
}

interface SeedIds { transcricaoId: string; nonce: string }

async function seedTranscricao(page: Page, nonce: string, audioUrl: string): Promise<SeedIds> {
  return page.evaluate(async ({ n, url }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    // Two speakers, word-level timestamps - the same shape the mock STT emits.
    const seg = (speaker: string, start: number, text: string, words: Array<[string, number]>) => {
      const w = words.map(([tok, ts], i) => ({ w: tok, start: ts, end: words[i + 1] ? words[i + 1][1] : Math.round((ts + 0.4) * 10) / 10 }));
      return { speaker, start, end: w.length ? w[w.length - 1].end : start, text, words: w };
    };
    const segmentos = [
      seg('ORADOR_1', 12.4, 'Declaro aberta a audiencia.', [['Declaro', 12.4], ['aberta', 12.9], ['a', 13.3], ['audiencia.', 13.5]]),
      seg('ORADOR_2', 20.0, 'A fatura ficou por pagar.', [['A', 20.0], ['fatura', 20.3], ['ficou', 20.9], ['por', 21.3], ['pagar.', 21.6]]),
    ];
    const row = await s.create('transcricoes', {
      titulo: `Audiencia X ${n}`,
      ficheiroNome: `audiencia-x-${n}.wav`,
      dataAudiencia: '2026-06-27',
      estado: 'transcrito',
      segmentos,
      ficheiro: { url },
      xnonce: n,
    });
    return { transcricaoId: String(row.id), nonce: n };
  }, { n: nonce, url: audioUrl });
}

async function cleanup(page: Page, ids: SeedIds | null) {
  if (!ids) return;
  try {
    await page.evaluate(async (ids) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const safeDel = async (col: string, id: unknown) => { try { await s.delete(col, String(id)); } catch { /* ignore */ } };
      for (const e of await s.list('excertos')) if (e.transcricaoId === ids.transcricaoId) await safeDel('excertos', e.id);
      await safeDel('transcricoes', ids.transcricaoId);
    }, ids);
  } catch { /* best-effort */ }
}

let ids: SeedIds | null = null;

test.afterEach(async ({ page }) => {
  await cleanup(page, ids);
  ids = null;
});

test('Transcricao: transporte keyboard-first insere marcas de tempo (botao e tecla I) e ignora a tecla em campos de texto', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const nonce = `XT1-${Date.now()}`;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  ids = await seedTranscricao(page, nonce, SILENT_WAV);

  await page.goto(`${APP}trabalho/${ids.transcricaoId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('transcricao-detalhe')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('transcricao-audio')).toBeVisible();

  // The transport bar + shortcut legend are present and discoverable.
  await expect(page.getByTestId('transcricao-transporte')).toBeVisible();
  await expect(page.getByTestId('transcricao-play-pause')).toBeVisible();
  await expect(page.getByTestId('transcricao-inserir-marca')).toBeVisible();
  await expect(page.getByTestId('transcricao-atalhos')).toContainText(/inserir marca/i);

  // Button inserts a marker with a formatted timestamp.
  await page.getByTestId('transcricao-inserir-marca').click();
  await expect(page.getByTestId('transcricao-marcadores')).toBeVisible();
  await expect(page.getByTestId('marca-0')).toBeVisible();
  await expect(page.getByTestId('marca-ts-0')).toHaveText(/^\d{2}:\d{2}:\d{2}\.\d$/);

  // Keyboard `i` (editor focused, no text field active) inserts a SECOND marker.
  await page.getByTestId('editor-card').focus();
  await page.getByTestId('editor-card').press('i');
  await expect(page.getByTestId('marca-1')).toBeVisible();

  // The `i` key is IGNORED while a text field has focus: open the correction
  // field (click the first word) and type - no new marker appears.
  await page.getByTestId('primeira-palavra').click();
  const correcao = page.getByTestId('correcao-input');
  await expect(correcao).toBeVisible();
  await correcao.click();
  await correcao.pressSequentially('inserir');
  await expect(correcao).toHaveValue(/inserir/);
  await expect(page.getByTestId('marca-2')).toHaveCount(0);

  // Markers can be removed.
  await page.getByTestId('marca-remover-1').click();
  await expect(page.getByTestId('marca-1')).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/marcadores.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Transcricao: renomear orador propaga para o excerto art. 640.º com timestamps', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const nonce = `XT2-${Date.now()}`;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  ids = await seedTranscricao(page, nonce, SILENT_WAV);

  await page.goto(`${APP}trabalho/${ids.transcricaoId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('transcricao-detalhe')).toBeVisible({ timeout: 20_000 });

  // Label the witness (papel + nome) - the rename must propagate into the excerpt.
  await page.getByTestId('orador-papel-ORADOR_2').selectOption('testemunha');
  await page.getByTestId('orador-nome-ORADOR_2').fill('Antonio Silva');

  // Mark reviewed -> the art. 640.º generator unlocks (frozen gate).
  await page.getByTestId('marcar-revisto').click();
  await expect(page.getByTestId('transcricao-estado')).toContainText(/Revisto/i, { timeout: 10_000 });
  await expect(page.getByTestId('gerar-excerto')).toBeEnabled();

  // Select the witness segment (index 1) and generate.
  await page.getByTestId('seg-check-1').check();
  await page.getByTestId('gerar-excerto').click();

  const bloco = page.getByTestId('excerto-bloco');
  await expect(bloco).toBeVisible({ timeout: 10_000 });
  await expect(bloco).toContainText('art. 640.º');
  // Speaker rename propagated: the excerpt carries the labelled speaker.
  await expect(bloco).toContainText('testemunha - Antonio Silva');
  await expect(bloco).toContainText('A fatura ficou por pagar');
  // Export carries timestamps (HH:MM:SS.s brackets).
  await expect(bloco).toContainText(/\[\d{2}:\d{2}:\d{2}\.\d - \d{2}:\d{2}:\d{2}\.\d\]/);
  await expect(bloco).toContainText('27/06/2026');

  await page.screenshot({ path: `${SHOTS}/excerto.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
