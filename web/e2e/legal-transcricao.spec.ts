import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * A-TRANS - transcrição de audiências vivida de ponta a ponta: carregar a
 * gravação (fixture WAV sintética de 2 vozes), transcrever (motor simulado
 * determinístico via /api/legal/transcricao), corrigir uma palavra, rotular
 * oradores e - a REGRA §3.2.2, testada nas duas direções - gerar o excerto
 * art. 640.º SÓ depois de o trabalho estar marcado como revisto.
 */

const APP = legalAppUrl('legal-transcricao');
const FIXTURE = resolve(__dirname, 'fixtures', 'audiencia-2vozes.wav');

test.describe.serial('transcrição: upload -> mock STT -> revisão -> excerto 640.º gated', () => {
  const pageErrors: string[] = [];

  test.beforeEach(({ page }) => {
    page.on('pageerror', (err) => pageErrors.push(String(err)));
  });

  test.afterEach(() => {
    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toHaveLength(0);
    pageErrors.length = 0;
  });

  test('fluxo completo com o gate do excerto aplicado nas duas direções', async ({ page }) => {
    await page.goto(APP, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('transcricao-nova')).toBeVisible({ timeout: 20_000 });

    // Carregar a gravação sintética.
    await page.getByTestId('transcricao-data').fill('2026-06-27');
    await page.locator('[data-testid="transcricao-carregar"] input[type="file"]').setInputFiles(FIXTURE);

    // O upload navega para o detalhe do trabalho.
    await expect(page.getByTestId('transcricao-detalhe')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('transcricao-audio')).toBeVisible();

    // Transcrever (motor simulado determinístico; sem sistemas externos).
    await page.getByTestId('transcricao-transcrever').click();
    await expect(page.getByTestId('segmentos')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('segmento-row').first()).toContainText('Declaro aberta a audiência');

    // GATE (direção 1): SEM revisto, o gerador está bloqueado.
    await expect(page.getByTestId('transcricao-estado')).toContainText(/por rever/i);
    await expect(page.getByTestId('gerar-excerto')).toBeDisabled();

    // Corrigir uma palavra: "Declaro" -> "Declarou" e voltar (prova a edição).
    await page.getByTestId('primeira-palavra').click();
    await page.getByTestId('correcao-input').fill('Declaro,');
    await page.getByTestId('correcao-aplicar').click();
    await expect(page.getByTestId('segmento-row').first()).toContainText('Declaro,');

    // Rotular oradores (papel + nome entram nos excertos).
    await page.getByTestId('orador-papel-ORADOR_1').selectOption('juiz');
    await page.getByTestId('orador-papel-ORADOR_2').selectOption('testemunha');
    await page.getByTestId('orador-nome-ORADOR_2').fill('António Silva');

    // Marcar revisto -> o gate abre.
    await page.getByTestId('marcar-revisto').click();
    await expect(page.getByTestId('transcricao-estado')).toContainText(/Revisto/i, { timeout: 10_000 });
    await expect(page.getByTestId('gerar-excerto')).toBeEnabled();

    // Selecionar o depoimento da testemunha (segmento 4: "A fatura ficou por pagar…").
    await page.getByTestId('seg-check-4').check();
    await page.getByTestId('gerar-excerto').click();

    // O bloco 640.º carrega ficheiro, tempos início/fim e data da audiência.
    const bloco = page.getByTestId('excerto-bloco');
    await expect(bloco).toBeVisible({ timeout: 10_000 });
    await expect(bloco).toContainText('art. 640.º');
    await expect(bloco).toContainText('audiencia-2vozes.wav');
    await expect(bloco).toContainText('00:02:32.7'); // início do segmento 152.7s
    await expect(bloco).toContainText('27/06/2026');
    await expect(bloco).toContainText('testemunha - António Silva');
    await expect(bloco).toContainText('A fatura ficou por pagar');
  });
});
