import { test, expect } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * A-JURI - jurimetria estatística vivida: o comparador interno agrega os
 * processos FINDOS da espinha Fonseca (36 arquivados com abertura/fecho) por
 * área contra as médias públicas citadas (fonte+período), e a ficha de
 * expectativas gera-se com o disclaimer obrigatório. Linguagem: médias,
 * nunca o desfecho de um caso (o audit de strings corre no vitest).
 */

const APP = legalAppUrl('legal-jurimetria');

test('jurimetria: comparador interno vs médias públicas + ficha de expectativas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Garantir a espinha Fonseca (os findos vêm de lá).
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('demo-spine-card')).toBeVisible({ timeout: 20_000 });
  const estado = await page.getByTestId('demo-estado').innerText();
  if (/Não instalado/i.test(estado)) {
    await page.getByTestId('demo-instalar').click();
    await expect(page.getByTestId('demo-banner')).toBeVisible({ timeout: 90_000 });
  }

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('jurimetria-tabela')).toBeVisible({ timeout: 20_000 });

  // O comparador tem linhas (áreas com findos) e cita a fonte pública.
  const linhas = page.getByTestId('jurimetria-linha');
  await expect(linhas.first()).toBeVisible({ timeout: 15_000 });
  expect(await linhas.count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('jurimetria-tabela')).toContainText(/dados\.justica|DGPJ/i);
  await expect(page.getByTestId('jurimetria-tabela')).toContainText(/meses/);

  // Ficha de expectativas com fonte, amostra e disclaimer.
  await page.getByTestId('jurimetria-gerar').click();
  const ficha = page.getByTestId('jurimetria-ficha');
  await expect(ficha).toBeVisible({ timeout: 10_000 });
  await expect(ficha).toContainText(/FICHA DE EXPECTATIVAS/);
  await expect(ficha).toContainText(/Fonte pública/);
  await expect(ficha).toContainText(/médias históricas/i);
  await expect(ficha).toContainText(/Não constituem garantia/i);

  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});
