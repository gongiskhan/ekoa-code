import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, relative, isAbsolute } from 'node:path';

/**
 * Simuladores de Trabalho artifact — correctness gate. Builds the app (esbuild
 * bundles src/main.ts + the committed engine), serves it on a local port, and
 * asserts the simulators compute the exact Código do Trabalho figures with their
 * cited article. Re-runnable: `npx playwright test e2e/simuladores-trabalho.spec.ts`.
 */
const APP_DIR = join(process.cwd(), '..', 'ekoa-data', 'apps', 'simuladores-trabalho');
const PORT = 7733;
let server: http.Server | undefined;

test.beforeAll(async () => {
  const r = spawnSync('node', [join(APP_DIR, 'build.mjs')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`simuladores build failed:\n${r.stderr}\n${r.stdout}`);

  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  server = http.createServer((req, res) => {
    let p = (req.url || '/').split('?')[0];
    if (p === '/') p = '/index.html';
    const fp = join(APP_DIR, p);
    // Confine to APP_DIR: a true relative path that escapes (starts with "..")
    // or is absolute is rejected — startsWith(APP_DIR) alone is prefix-bypassable.
    const rel = relative(APP_DIR, fp);
    if (rel.startsWith('..') || isAbsolute(rel) || !existsSync(fp)) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', types[extname(fp)] || 'application/octet-stream');
    res.end(readFileSync(fp));
  });
  await new Promise<void>((ok) => server!.listen(PORT, ok));
});

test.afterAll(() => {
  server?.close();
});

test('Simuladores compute the exact CT figures with the cited article', async ({ page }) => {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('simuladores-app')).toBeVisible();

  // Compensação: 1000€ base, 1 ano -> 400,00 € (avoids thousands-separator variance)
  await page.getByTestId('sim-comp-retrib').fill('1000');
  await page.getByTestId('sim-comp-anos').fill('1');
  await expect(page.getByTestId('sim-comp-result')).toContainText('400,00');
  await expect(page.getByTestId('sim-comp-result')).toContainText('366'); // art. cited

  // Faltas por falecimento: descendente -> 20 dias; 2.º grau -> 2 dias
  await page.getByTestId('sim-faltas-grau').selectOption('descendente');
  await expect(page.getByTestId('sim-faltas-result')).toContainText('20 dias');
  await page.getByTestId('sim-faltas-grau').selectOption('parente_2grau');
  await expect(page.getByTestId('sim-faltas-result')).toContainText('2 dias');
  await expect(page.getByTestId('sim-faltas-result')).toContainText('251');

  // Férias: March start -> 20 (admissão) / 22 (seguinte) dias úteis
  await page.getByTestId('sim-ferias-data').fill('2026-03-15');
  await expect(page.getByTestId('sim-ferias-result')).toContainText('20 dias');
  await expect(page.getByTestId('sim-ferias-result')).toContainText('22 dias');

  // Aviso prévio: 1 ano -> 30 dias; 3 anos -> 60 dias
  await page.getByTestId('sim-aviso-anos').fill('1');
  await expect(page.getByTestId('sim-aviso-result')).toContainText('30 dias');
  await page.getByTestId('sim-aviso-anos').fill('3');
  await expect(page.getByTestId('sim-aviso-result')).toContainText('60 dias');

  // Trabalho suplementar: 10€/h, 1h + 2h em dia útil -> 40,00 €
  await expect(page.getByTestId('sim-supl-result')).toContainText('40,00');

  expect(errs, `page errors: ${errs.join(' | ')}`).toHaveLength(0);
});
