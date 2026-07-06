/* eslint-disable @typescript-eslint/no-explicit-any -- the SSE-injected `window.__ekoa.shared` bridge is an untyped runtime global; spine access in-page is dynamic by nature */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * SV-ASS - legal-assinatura. Envelopes com máquina de estados + certificado de
 * auditoria + arquivo probatório. Dois caminhos conduzidos pela UI real:
 *
 *  1. SIMULADO (caminho feliz completo): criar envelope -> marcar pronto ->
 *     iniciar -> assinar (2 signatários) -> concluído -> certificado renderizado
 *     -> arquivar no dossiê (linhas `assinaturas` + `documentos`). Proveniência
 *     em `registo_eventos` por passo assistido.
 *  2. CMD ORQUESTRADO: a atestação de inscrição na OA em vigor BLOQUEIA o avanço
 *     enquanto desmarcada (test-enforced); com a atestação, cada passo emite um
 *     evento de proveniência e o 4.º passo assina.
 *
 * Bootstrap próprio (cliente + processo + documento) via espinha partilhada;
 * captura de pageerror; limpeza no fim.
 */
const BASE = legalAppUrl('legal-assinatura');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 's-assinatura');
mkdirSync(SHOTS, { recursive: true });

test.describe.serial('Assinatura: envelopes, máquina de estados, certificado e proveniência', () => {
  const suffix = Date.now().toString(36);
  const clienteNif = '210000017';
  const numeroProcesso = `8${String(Date.now()).slice(-3)}/26.9T8LSB`;

  const created: { clienteId?: string; processoId?: string; documentoId?: string; envelopeIds: string[] } = { envelopeIds: [] };

  async function spineList(page: Page, coll: string): Promise<any[]> {
    return page.evaluate((c) => (window as any).__ekoa.shared.list(c), coll);
  }

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE);
    await expect(page.getByTestId('assinatura-envelopes-page')).toBeVisible({ timeout: 20_000 });
    const cliente = await page.evaluate((d) => (window as any).__ekoa.shared.create('clientes', d), {
      nome: `Marília Costa ${suffix}`, nif: clienteNif, email: `marilia-${suffix}@exemplo.pt`,
      telefone: '+351 900 000 000', tipo: 'particular', morada: 'Rua das Flores 12, 1200-192 Lisboa',
    });
    created.clienteId = cliente.id;
    const processo = await page.evaluate((args) => (window as any).__ekoa.shared.create('processos', {
      numeroProcesso: args.numeroProcesso, tribunal: 'Juízo Central Cível de Lisboa', comarca: 'Lisboa',
      area: 'Cível', estado: 'ativo', clienteId: args.clienteId,
    }), { numeroProcesso, clienteId: cliente.id });
    created.processoId = processo.id;
    const documento = await page.evaluate((args) => (window as any).__ekoa.shared.create('documentos', {
      nome: `Procuração forense ${args.suffix}.pdf`, tipo: 'pdf', processoId: args.processoId, clienteId: args.clienteId,
      origem: 'upload', data: new Date().toISOString().slice(0, 10), versao: 1,
    }), { suffix, processoId: processo.id, clienteId: cliente.id });
    created.documentoId = documento.id;
    await page.close();
  });

  test('página de envelopes renderiza sem erros e o calendário 2027 é visível', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('assinatura-envelopes-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('assinatura-calendario-destaque')).toBeVisible();
    await expect(page.getByTestId('assinatura-novo')).toBeVisible();

    // O calendário cita a fonte (Portaria 350-A/2025) e a data-alvo de 2027.
    await page.getByTestId('nav-calendario').click();
    await expect(page.getByTestId('assinatura-calendario-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('assinatura-calendario-fonte')).toContainText(/350-A\/2025/);
    await expect(page.getByTestId('assinatura-fase-desde-2027')).toContainText(/qualificada/i);
    await page.screenshot({ path: `${SHOTS}/calendario.png`, fullPage: true });

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('SIMULADO: criar -> pronto -> iniciar -> assinar x2 -> certificado -> arquivar no dossiê', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // --- Criar via UI a partir do exemplo (procuração forense, 2 signatários simulado) ---
    await page.goto(`${BASE}novo`);
    await expect(page.getByTestId('assinatura-novo-page')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('assinatura-exemplo').click();
    await expect(page.getByTestId('assinatura-doc-escolhido')).toContainText(/Procuração forense/i);
    // Liga ao processo do teste para o arquivo cair no dossiê certo.
    await page.getByTestId('assinatura-processo').selectOption(created.processoId!);
    await page.getByTestId('assinatura-criar').click();

    await page.waitForURL(/\/envelopes\/[^/]+/, { timeout: 20_000 });
    await expect(page.getByTestId('assinatura-detalhe-page')).toBeVisible({ timeout: 15_000 });
    const envId = (page.url().match(/envelopes\/([^/?#]+)/) || [])[1];
    expect(envId, 'id do envelope na URL').toBeTruthy();
    created.envelopeIds.push(envId);
    await expect(page.getByTestId('assinatura-detalhe-estado')).toContainText(/Rascunho/i);

    // --- Máquina de estados ---
    await page.getByTestId('assinatura-marcar-pronto').click();
    await expect(page.getByTestId('assinatura-detalhe-estado')).toContainText(/Pronto/i);
    await page.getByTestId('assinatura-iniciar').click();
    await expect(page.getByTestId('assinatura-detalhe-estado')).toContainText(/Em assinatura/i);

    // --- Assinar os dois signatários (simulado) ---
    await expect(page.getByTestId('assinatura-bloco-assinar')).toBeVisible();
    await page.getByTestId('assinatura-assinar').click();
    await expect(page.getByTestId('assinatura-bloco-assinar')).toBeVisible(); // falta o 2.º
    await page.getByTestId('assinatura-assinar').click();

    // --- Concluído: certificado renderizado ---
    await expect(page.getByTestId('assinatura-detalhe-estado')).toContainText(/Concluído/i, { timeout: 15_000 });
    await expect(page.getByTestId('assinatura-certificado')).toBeVisible();
    await expect(page.getByTestId('assinatura-cert-docs')).toBeVisible();
    await expect(page.getByTestId('assinatura-cert-sigs')).toBeVisible();
    await expect(page.getByTestId('assinatura-trilho')).toBeVisible();
    await expect(page.getByTestId('assinatura-cert-aviso')).toContainText(/não constitui atestação de validade jurídica/i);
    await page.screenshot({ path: `${SHOTS}/certificado.png`, fullPage: true });

    // --- Arquivar no dossiê ---
    await page.getByTestId('assinatura-arquivar').click();
    await expect(page.getByTestId('assinatura-arquivado')).toBeVisible({ timeout: 15_000 });

    // --- Linhas de arquivo criadas na espinha (assinaturas + documentos) ---
    const assinaturas = (await spineList(page, 'assinaturas')).filter((a) => a.envelopeId === envId);
    expect(assinaturas.length, 'uma linha assinaturas para o envelope').toBe(1);
    expect(assinaturas[0].certificado, 'certificado no registo de assinatura').toBeTruthy();

    const docs = (await spineList(page, 'documentos')).filter((d) => d.origem === 'legal-assinatura' && d.envelopeId === envId);
    expect(docs.length, 'um documento de certificado arquivado').toBe(1);
    expect(docs[0].processoId).toBe(created.processoId);
    expect(docs[0].certificado, 'certificado JSON no documento arquivado').toBeTruthy();

    // --- Proveniência: eventos por passo assistido ---
    const eventos = (await spineList(page, 'registo_eventos')).filter((e) => e.envelopeId === envId);
    const acoes = new Set(eventos.map((e) => e.acao));
    for (const a of ['envelope:criado', 'envelope:pronto', 'envelope:iniciado', 'assinatura:simulada', 'envelope:arquivado']) {
      expect(acoes.has(a), `evento de proveniência "${a}"`).toBe(true);
    }
    // Duas assinaturas simuladas registadas (proveniência simulada).
    expect(eventos.filter((e) => e.acao === 'assinatura:simulada').length).toBe(2);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('CMD ORQUESTRADO: a inscrição na OA por atestar BLOQUEIA o avanço; com atestação, cada passo regista proveniência', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // --- Criar um envelope cmd-orquestrado com um signatário advogado ---
    await page.goto(`${BASE}novo`);
    await expect(page.getByTestId('assinatura-novo-page')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('assinatura-doc-spine').selectOption(created.documentoId!);
    await page.getByTestId('assinatura-titulo').fill('Procuração - assinatura qualificada');
    await page.getByTestId('assinatura-metodo').selectOption('cmd-orquestrado');
    await page.getByTestId('assinatura-sig-nome-0').fill('Dra. Marília');
    await page.getByTestId('assinatura-sig-papel-0').selectOption('advogado');
    await page.getByTestId('assinatura-sig-metodo-0').selectOption('cmd-orquestrado');
    await page.getByTestId('assinatura-processo').selectOption(created.processoId!);
    await page.getByTestId('assinatura-criar').click();

    await page.waitForURL(/\/envelopes\/[^/]+/, { timeout: 20_000 });
    await expect(page.getByTestId('assinatura-detalhe-page')).toBeVisible({ timeout: 15_000 });
    const envId = (page.url().match(/envelopes\/([^/?#]+)/) || [])[1];
    created.envelopeIds.push(envId);

    await page.getByTestId('assinatura-marcar-pronto').click();
    await expect(page.getByTestId('assinatura-detalhe-estado')).toContainText(/Pronto/i);
    await page.getByTestId('assinatura-iniciar').click();
    await expect(page.getByTestId('assinatura-cmd-fluxo')).toBeVisible({ timeout: 15_000 });

    // --- OA por atestar: o 1.º passo está BLOQUEADO ---
    await expect(page.getByTestId('assinatura-oa')).not.toBeChecked();
    await expect(page.getByTestId('assinatura-passo-1')).toBeDisabled();
    await page.screenshot({ path: `${SHOTS}/cmd-bloqueado.png`, fullPage: true });

    // --- Atestar a inscrição na OA: o 1.º passo desbloqueia ---
    await page.getByTestId('assinatura-oa').check();
    await expect(page.getByTestId('assinatura-passo-1')).toBeEnabled();

    // --- Percorrer os 4 passos; o 4.º assina ---
    await page.getByTestId('assinatura-passo-1').click();
    await page.getByTestId('assinatura-passo-2').click();
    await page.getByTestId('assinatura-passo-3').click();
    await page.getByTestId('assinatura-passo-4').click();

    await expect(page.getByTestId('assinatura-detalhe-estado')).toContainText(/Concluído/i, { timeout: 15_000 });
    await expect(page.getByTestId('assinatura-certificado')).toBeVisible();

    // --- Proveniência por passo (cmd-orquestrado:passo-1..4) + assinatura qualificada ---
    const eventos = (await spineList(page, 'registo_eventos')).filter((e) => e.envelopeId === envId);
    const acoes = new Set(eventos.map((e) => e.acao));
    for (const n of [1, 2, 3, 4]) {
      expect(acoes.has(`cmd-orquestrado:passo-${n}`), `evento cmd-orquestrado:passo-${n}`).toBe(true);
    }
    expect(acoes.has('assinatura:cmd-orquestrado'), 'evento de assinatura qualificada').toBe(true);

    // O signatário ficou com proveniência manual-assistido.
    const sigEstado = await page.getByTestId('assinatura-sig-estado-0').textContent();
    expect(sigEstado).toMatch(/Assinado/i);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE).catch(() => {});
    await page.evaluate(async (ids) => {
      const shared = (window as any).__ekoa.shared;
      // Envelopes + linhas de arquivo + proveniência do teste.
      for (const id of ids) { try { await shared.delete('envelopes', id); } catch { /* melhor-esforço */ } }
      for (const coll of ['assinaturas', 'documentos', 'registo_eventos']) {
        const list = await shared.list(coll);
        for (const row of list) {
          if (row && ids.includes(row.envelopeId)) { try { await shared.delete(coll, row.id); } catch { /* melhor-esforço */ } }
        }
      }
    }, created.envelopeIds).catch(() => {});
    for (const pair of [['documentos', created.documentoId], ['processos', created.processoId], ['clientes', created.clienteId]] as const) {
      const [coll, cid] = pair;
      if (cid) await page.evaluate((a) => (window as any).__ekoa.shared.delete(a[0], a[1]), [coll, cid]).catch(() => {});
    }
    await page.close();
  });
});
