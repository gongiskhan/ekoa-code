import { test, expect } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * RET-CONS - os consumidores chamam o SERVIÇO legal-calculos (fronteira
 * P2-001, sem fórmulas locais): a cobrança vencida ganha "Juros até hoje"
 * calculado pela rota /api/legal/calculos, com troços a citar Avisos, e a
 * memória fica guardada em `calculos` (visível ao editor de peças).
 */

const COBRANCAS = legalAppUrl('legal-cobrancas');

test('cobrança vencida: juros até hoje via serviço de cálculos + memória guardada', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(COBRANCAS, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('cobrancas-page')).toBeVisible({ timeout: 20_000 });

  // Abrir a primeira cobrança pendente vencida da lista.
  await page.getByTestId('cobrancas-linha').first().click();
  await expect(page.getByTestId('cobranca-detalhe')).toBeVisible({ timeout: 15_000 });

  // O cartão "Juros até hoje" existe para cobranças vencidas e calcula via serviço.
  await expect(page.getByTestId('cobranca-juros')).toBeVisible();
  await page.getByTestId('cobranca-juros-calcular').click();
  const total = page.getByTestId('cobranca-juros-total');
  await expect(total).toBeVisible({ timeout: 15_000 });
  await expect(total).toContainText('€');
  await expect(page.getByTestId('cobranca-juros')).toContainText(/troço/i);
  await expect(page.getByTestId('cobranca-juros')).toContainText(/memória guardada/i);

  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});
