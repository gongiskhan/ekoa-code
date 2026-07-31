import { test, expect, type APIRequestContext } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * A-RCBE - o lado declarativo do beneficiário efetivo, vivido: carteira com a
 * entidade Fonseca (BOs partilhados com o KYC), calendário com a confirmação
 * anual, declaração pré-preenchida, submissão assistida (4 passos com
 * proveniência ASSERIDA) e comprovativo que fecha a obrigação + lança a avença.
 * Precisa da espinha Fonseca instalada (o harness das demos instala-a; este
 * spec instala-a se faltar, via o cartão do Núcleo).
 */

const APP = legalAppUrl('legal-rcbe');

/**
 * REPETIBILIDADE: este spec CUMPRE a obrigação, por isso uma segunda corrida encontrava-a
 * "Cumprida" e morria na primeira asserção do calendário (/atraso|Pendente|Prevista/). Não era
 * flakiness - era o spec a depender de uma base de dados virgem, o que só é verdade uma vez.
 *
 * A app já sabe repor-se, mas SÓ com uma tour de demonstração activa (`isDemoActive()` em
 * EntidadesPage.jsx); este spec entra directamente na app, sem tour, por isso essa reposição nunca
 * dispara. Em vez de alargar a reposição da app - que a faria correr em uso real, onde apagar
 * artefactos do utilizador seria destrutivo - o spec repõe o SEU próprio estado inicial, pela mesma
 * superfície REST que já usa no fim para verificar a proveniência.
 *
 * Espelha exactamente o que a app faz com uma tour activa: obrigação demo de volta a `em_atraso`,
 * entidade sem declaração, e os artefactos derivados (comprovativos/avenças) removidos. Só toca em
 * linhas marcadas `demo: true`.
 */
async function reporEstadoInicial(request: APIRequestContext, base: string): Promise<void> {
  const H = { 'X-Ekoa-App-Id': 'legal-rcbe' };
  const list = async (c: string): Promise<Array<Record<string, unknown>>> => {
    const res = await request.get(`${base}/api/app-shared/${c}`, { headers: H });
    return ((await res.json()) as { data?: Array<Record<string, unknown>> }).data ?? [];
  };

  const ents = (await list('rcbe_entidades')).filter((e) => e?.demo === true);
  for (const e of ents) {
    await request.put(`${base}/api/app-shared/rcbe_entidades/${e.id}`, {
      headers: H,
      data: { ...e, ultimaDeclaracaoEm: null, passosPortal: {} },
    });
    const obr = (await list('rcbe_obrigacoes')).filter((o) => o?.demo === true && o.entidadeId === e.id);
    for (const o of obr) {
      await request.put(`${base}/api/app-shared/rcbe_obrigacoes/${o.id}`, {
        headers: H,
        data: { ...o, estado: 'em_atraso', cumpridaEm: null },
      });
    }
    for (const col of ['documentos', 'lancamentos']) {
      const derivadas = (await list(col)).filter(
        (r) =>
          r?.demo === true &&
          (r.entidadeId === e.id || /Avença RCBE/i.test(String(r.descricao ?? r.nome ?? ''))),
      );
      for (const r of derivadas) await request.delete(`${base}/api/app-shared/${col}/${r.id}`, { headers: H });
    }
  }
}

test('RCBE completo: entidade -> declaração -> submissão assistida -> comprovativo + avença', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Garantir a espinha Fonseca (a entidade demo vem de lá).
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('demo-spine-card')).toBeVisible({ timeout: 20_000 });
  const estado = await page.getByTestId('demo-estado').innerText();
  if (/Não instalado/i.test(estado)) {
    await page.getByTestId('demo-instalar').click();
    await expect(page.getByTestId('demo-banner')).toBeVisible({ timeout: 90_000 });
  }

  // Repor ANTES de abrir a app: a lista lê o estado ao montar.
  await reporEstadoInicial(page.request, APP.split('/apps/')[0]!);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('rcbe-lista')).toBeVisible({ timeout: 20_000 });

  // A entidade demo (Vinhos do Douro) com 2 BOs partilhados.
  const linha = page.getByTestId('rcbe-row').filter({ hasText: 'Vinhos do Douro' }).first();
  await expect(linha).toBeVisible();
  await expect(linha).toContainText(/2 beneficiário/);
  await linha.locator('a').click();
  await expect(page.getByTestId('rcbe-detalhe')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('rcbe-bo-row')).toHaveCount(2);

  // Calendário mostra obrigação pendente/em atraso.
  await expect(page.getByTestId('rcbe-calendario')).toContainText(/atraso|Pendente|Prevista/i);

  // Declaração pré-preenchida com os BOs e a base legal.
  await page.getByTestId('rcbe-preparar').click();
  const dec = page.getByTestId('rcbe-declaracao');
  await expect(dec).toBeVisible();
  await expect(dec).toContainText('Vinhos do Douro');
  await expect(dec).toContainText(/89\/2017/);
  await expect(dec).toContainText(/Sarmento Vale/);

  // Submissão assistida: 4 passos -> arquivar fecha a obrigação.
  for (let i = 0; i < 4; i += 1) await page.getByTestId(`portal-passo-${i}`).check();
  await expect(page.getByTestId('rcbe-arquivar')).toBeEnabled();
  await page.getByTestId('rcbe-arquivar').click();
  await expect(page.getByTestId('rcbe-obrigacao').filter({ hasText: 'Cumprida' }).first()).toBeVisible({ timeout: 15_000 });

  // Proveniência por passo (§3.2.5) + avença lançada - pela API real.
  const base = APP.split('/apps/')[0];
  const ev = (await (await page.request.get(`${base}/api/app-shared/registo_eventos`, { headers: { 'X-Ekoa-App-Id': 'legal-rcbe' } })).json()).data as Array<{ app?: string; acao?: string }>;
  for (const p of ['portal:passo-1', 'portal:passo-2', 'portal:passo-3', 'portal:passo-4']) {
    expect(ev.some((e) => e.app === 'legal-rcbe' && e.acao === p), `evento ${p}`).toBe(true);
  }
  const lanc = (await (await page.request.get(`${base}/api/app-shared/lancamentos`, { headers: { 'X-Ekoa-App-Id': 'legal-rcbe' } })).json()).data as Array<{ descricao?: string }>;
  expect(lanc.some((l) => /Avença RCBE/i.test(String(l.descricao)))).toBe(true);

  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});
