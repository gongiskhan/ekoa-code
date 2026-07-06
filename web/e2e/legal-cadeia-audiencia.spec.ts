import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * CADEIA 2 (R-E / §9.3b) - da gravação da audiência à peça de recurso, numa
 * única execução: upload da gravação -> TRANSCRIÇÃO (motor simulado, oradores,
 * tempos por palavra) -> revisão humana -> EXCERTO art. 640.º (só depois de
 * revisto) -> o bloco entra numa PEÇA processual e a peça guarda-o.
 */

const APP_TRANS = legalAppUrl('legal-transcricao');
const APP_PECAS = legalAppUrl('legal-pecas');
const FIXTURE = resolve(__dirname, 'fixtures', 'audiencia-2vozes.wav');

test('cadeia: audiência -> transcrição -> excerto 640.º -> peça', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 1) TRANSCRIÇÃO: upload + motor simulado + revisão + excerto (gate vivido).
  await page.goto(APP_TRANS, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('transcricao-nova')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('transcricao-data').fill('2026-06-27');
  await page.locator('[data-testid="transcricao-carregar"] input[type="file"]').setInputFiles(FIXTURE);
  await expect(page.getByTestId('transcricao-detalhe')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('transcricao-transcrever').click();
  await expect(page.getByTestId('segmentos')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('orador-papel-ORADOR_2').selectOption('testemunha');
  await page.getByTestId('orador-nome-ORADOR_2').fill('António Silva');
  await page.getByTestId('marcar-revisto').click();
  await expect(page.getByTestId('gerar-excerto')).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId('seg-check-4').check();
  await page.getByTestId('gerar-excerto').click();
  const bloco = page.getByTestId('excerto-bloco');
  await expect(bloco).toBeVisible({ timeout: 10_000 });
  const textoExcerto = await bloco.innerText();
  expect(textoExcerto).toContain('art. 640.º');
  expect(textoExcerto).toContain('A fatura ficou por pagar');

  // 2) PEÇA: nova peça, o bloco entra no corpo (o fluxo MVP: copiar e colar),
  //    e a peça guarda com o excerto dentro.
  await page.goto(APP_PECAS, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('pecas-nova').first().click();
  // O modal pede tipo + processo antes de criar.
  const procSel = page.getByTestId('pecas-processo');
  await expect(procSel).toBeVisible({ timeout: 10_000 });
  await procSel.selectOption({ index: 1 });
  await page.getByTestId('pecas-criar').click();
  await expect(page.getByTestId('pecas-editor')).toBeVisible({ timeout: 20_000 });
  const corpo = page.getByTestId('pecas-corpo');
  await expect(corpo).toBeVisible({ timeout: 15_000 });
  const atual = await corpo.inputValue();
  await corpo.fill(`${atual}\n\nIMPUGNAÇÃO DA MATÉRIA DE FACTO (art. 640.º CPC)\n${textoExcerto}\n`);
  await expect(corpo).toHaveValue(/A fatura ficou por pagar/);

  // Guardar explícito - a peça persiste com o excerto na espinha.
  await page.getByTestId('pecas-guardar').click();
  const base = APP_PECAS.split('/apps/')[0];
  await page.waitForTimeout(800);
  const pecas = (await (await page.request.get(`${base}/api/app-shared/pecas`, { headers: { 'X-Ekoa-App-Id': 'legal-pecas' } })).json()).data as Array<{ corpo?: string }>;
  expect(pecas.some((r) => /A fatura ficou por pagar/.test(String(r.corpo)))).toBe(true);

  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});
