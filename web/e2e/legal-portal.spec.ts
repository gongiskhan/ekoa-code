/* eslint-disable @typescript-eslint/no-explicit-any -- reaches into the app's injected window.__ekoa bridge (untyped) and drives dynamic shared-collection JSON */
import { test, expect, type Page } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-portal — Portal do Cliente.
 *
 * Duas faces no MESMO app: a face do ESCRITÓRIO (Acessos + Partilhas, dentro do
 * Layout partilhado) e a face do CLIENTE (/cliente, fora do Layout, autenticada
 * pela sessão de app / palavra-passe). O que prova este spec:
 *
 *  (1) as páginas do escritório renderizam sem erros de página;
 *  (2) INVISÍVEL POR OMISSÃO: um cliente acabado de provisionar (via o fluxo de
 *      convite -> definir palavra-passe que o app implementa) inicia sessão e NÃO
 *      vê nenhum número de processo, nome de documento nem nome de outro cliente
 *      — apenas um estado vazio explícito;
 *  (3) o escritório partilha UM documento e o cliente passa a ver EXACTAMENTE
 *      esse item e mais nada;
 *  (4) o cliente envia um documento -> nasce uma linha `documentos` origem
 *      'portal', visível no Dossiê do processo certo, e é escrita uma auditoria
 *      (evento tipo 'portal_acesso');
 *  (5) limpeza etiquetada (linha `utilizadores` + linhas do portal + uploads).
 *
 * Provisionamento: /api/app-sso/set-password exige uma sessão privilegiada
 * pré-existente, pelo que não serve para a PRIMEIRA palavra-passe. O app calcula
 * o hash bcrypt do lado do cliente no passo "definir palavra-passe" (link de
 * convite com token) e grava-o na linha `utilizadores`; o servidor verifica-o no
 * login. Este spec exercita esse fluxo real ponta a ponta.
 */
const BASE = legalAppUrl('legal-portal');
const DOSSIE = legalAppUrl('legal-dossie');
const SENHA = 'Cliente!2026';

type Seed = {
  suffix: number;
  clienteId: string;
  processoId: string;
  numero: string;
  docId: string;
  docNome: string;
  email: string;
  nome: string;
};

/* Um PDF minúsculo mas plausível; o servidor guarda os bytes crus. */
function pdf(tag: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${tag}\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n`);
}

/* Semeia, na face do escritório, um cliente + processo + um documento com
 * ficheiro real (para o cliente ter um link de descarregar quando partilhado). */
async function seed(page: Page): Promise<Seed> {
  return page.evaluate(async () => {
    const w = window as unknown as { __ekoa: { shared: any; uploadFile: (f: File) => Promise<any> }; __EKOA_APP_ID: string };
    const s = w.__ekoa.shared;
    const suffix = Date.now();
    const nome = `Cliente Portal ${suffix}`;
    const cli = await s.create('clientes', {
      nome,
      nif: `29${String(suffix).slice(-7)}`,
      email: `portal${suffix}@e2e.pt`,
      telefone: '+351 900 000 000',
      tipo: 'particular',
    });
    const numero = `9300/${suffix % 10000}.0T8POR`;
    const prc = await s.create('processos', {
      numeroProcesso: numero,
      tribunal: 'Juízo E2E de Lisboa',
      comarca: 'Lisboa',
      area: 'Cível',
      estado: 'ativo',
      clienteId: cli.id,
    });
    const file = new File([new Uint8Array([37, 80, 68, 70])], `partilhado-${suffix}.pdf`, { type: 'application/pdf' });
    const up = await w.__ekoa.uploadFile(file);
    const doc = await s.create('documentos', {
      nome: `partilhado-${suffix}.pdf`,
      tipo: 'pdf',
      origem: 'upload',
      processoId: prc.id,
      clienteId: cli.id,
      data: '2026-07-03',
      ficheiro: { fileId: up.id, appId: w.__EKOA_APP_ID, url: up.url, mime: up.type, size: up.size },
      versao: 1,
    });
    return {
      suffix,
      clienteId: cli.id,
      processoId: prc.id,
      numero,
      docId: doc.id,
      docNome: doc.nome,
      email: cli.email,
      nome,
    };
  });
}

async function cleanup(page: Page, ids: Seed | null) {
  if (!ids) return;
  try {
    // A limpeza da colecção POR-APP `utilizadores` tem de correr numa página do
    // legal-portal (o app-id resolve a loja por-app). Voltamos à BASE primeiro.
    await page.goto(BASE);
    await page.evaluate(async (ids) => {
      const w = window as unknown as { __ekoa: any; __EKOA_APP_ID: string };
      const s = w.__ekoa.shared;
      const appId = w.__EKOA_APP_ID;

      const docs = await s.list('documentos');
      for (const d of docs) {
        if (d.clienteId === ids.clienteId || d.processoId === ids.processoId) {
          if (d.ficheiro && d.ficheiro.appId === appId && d.ficheiro.fileId) {
            try { await w.__ekoa.deleteFile(d.ficheiro.fileId); } catch { /* ignore */ }
          }
          await s.delete('documentos', d.id);
        }
      }
      for (const coll of ['portal_partilhas', 'portal_acessos', 'comunicacoes', 'eventos']) {
        const rows = await s.list(coll);
        for (const r of rows) if (r.clienteId === ids.clienteId) await s.delete(coll, r.id);
      }
      const procs = await s.list('processos');
      for (const p of procs) if (p.id === ids.processoId || p.clienteId === ids.clienteId) await s.delete('processos', p.id);
      await s.delete('clientes', ids.clienteId);

      // Loja por-app de credenciais.
      const users = await w.__ekoa.list('utilizadores');
      for (const u of users) if (u.clienteId === ids.clienteId) await w.__ekoa.delete('utilizadores', u.id);
    }, ids);
  } catch { /* melhor-esforço */ }
}

/* Provisiona um cliente ponta a ponta pelo fluxo real: Convidar (escritório) ->
 * abrir o link de definir palavra-passe -> definir -> iniciar sessão. Termina com
 * a face do cliente autenticada e o estado vazio visível. */
async function provisionAndSignIn(page: Page, ids: Seed) {
  // 1) Convidar o cliente na face do escritório.
  await page.goto(BASE);
  await expect(page.getByTestId('acessos-page')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('acessos-search').fill(String(ids.suffix));
  await page.getByTestId(`convidar-${ids.clienteId}`).click();

  // 2) Ler o link de uso único e abri-lo.
  const link = await page.getByTestId('convite-link').getAttribute('href');
  expect(link, 'o convite deve gerar um link de definição de palavra-passe').toBeTruthy();
  await page.goto(link as string);
  await expect(page.getByTestId('definir-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('definir-email')).toHaveValue(ids.email);
  await page.getByTestId('definir-password').fill(SENHA);
  await page.getByTestId('definir-password2').fill(SENHA);
  await page.getByTestId('definir-submit').click();
  await expect(page.getByTestId('definir-done')).toBeVisible({ timeout: 20_000 });

  // 3) Iniciar sessão na face do cliente.
  await page.goto(`${BASE}cliente`);
  await expect(page.getByTestId('portal-login')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('login-email').fill(ids.email);
  await page.getByTestId('login-password').fill(SENHA);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('portal-autenticado')).toBeVisible({ timeout: 20_000 });
}

let ids: Seed | null = null;
let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE);
  await expect(page.getByTestId('acessos-page')).toBeVisible({ timeout: 30_000 });
  ids = await seed(page);
  // A lista de acessos carrega os clientes UMA vez; recarrega para ela incluir o
  // cliente acabado de semear (o mesmo padrão do picker do Dossiê).
  await page.reload();
  await expect(page.getByTestId('acessos-page')).toBeVisible({ timeout: 30_000 });
});

test.afterEach(async ({ page }) => {
  await cleanup(page, ids);
  ids = null;
});

test('as faces do escritório (Acessos + Partilhas) renderizam sem erros de página', async ({ page }) => {
  await expect(page.getByTestId('acessos-page')).toBeVisible();
  // A tabela de acessos lista os clientes com o seu estado de portal.
  await page.getByTestId('acessos-search').fill(String(ids!.suffix));
  await expect(page.getByTestId(`convidar-${ids!.clienteId}`)).toBeVisible({ timeout: 15_000 });

  await page.goto(`${BASE}partilhas`);
  await expect(page.getByTestId('partilhas-page')).toBeVisible({ timeout: 20_000 });
  // Um cliente com processo é auto-seleccionado, pelo que o resumo aparece.
  await expect(page.getByTestId('portal-resumo')).toBeVisible({ timeout: 15_000 });

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('portal do cliente: invisível por omissão, partilha explícita e upload auditado para o dossiê', async ({ page }) => {
  await provisionAndSignIn(page, ids!);

  // ---- (2) INVISÍVEL POR OMISSÃO -------------------------------------------
  // Estado vazio explícito, e NADA do processo/documento do próprio cliente (nem
  // de outros clientes) aparece enquanto nada for partilhado.
  await expect(page.getByTestId('portal-vazio')).toBeVisible();
  await expect(page.getByTestId('portal-shared')).toHaveCount(0);
  await expect(page.getByTestId('portal-docs')).toHaveCount(0);

  const regiao = page.getByTestId('portal-autenticado');
  const textoVazio = await regiao.innerText();
  expect(textoVazio, 'número de processo não partilhado nunca aparece').not.toContain(ids!.numero);
  expect(textoVazio, 'nome de documento não partilhado nunca aparece').not.toContain(ids!.docNome);
  expect(textoVazio, 'nomes de outros clientes nunca aparecem').not.toContain('Marília Costa');
  // Sem processo partilhado, a caixa de envio não oferece processos.
  await expect(page.getByTestId('upload-processo')).toHaveCount(0);

  // ---- (3) O ESCRITÓRIO PARTILHA UM DOCUMENTO ------------------------------
  await page.goto(`${BASE}partilhas`);
  await expect(page.getByTestId('partilhas-page')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('partilhas-cliente').selectOption(ids!.clienteId);
  await page.getByTestId('partilhas-processo').selectOption(ids!.processoId);
  await page.getByTestId(`partilhar-doc-${ids!.docId}`).click();
  await expect(page.getByTestId('portal-resumo')).toContainText('1 documento(s)', { timeout: 15_000 });

  // O cliente recarrega e passa a ver EXACTAMENTE esse documento e nada mais.
  await page.goto(`${BASE}cliente`);
  await expect(page.getByTestId('portal-autenticado')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('portal-docs')).toBeVisible();
  await expect(page.getByTestId('portal-doc-item')).toHaveCount(1);
  await expect(page.getByTestId('portal-docs')).toContainText(ids!.docNome);
  await expect(page.getByTestId('portal-vazio')).toHaveCount(0);
  // continua sem estado nem eventos partilhados, e sem outros clientes
  await expect(page.getByTestId('portal-estados')).toHaveCount(0);
  await expect(page.getByTestId('portal-eventos')).toHaveCount(0);
  expect(await page.getByTestId('portal-autenticado').innerText()).not.toContain('Marília Costa');

  // ---- (4) O CLIENTE ENVIA UM DOCUMENTO -> Dossiê + auditoria ---------------
  const nomeUpload = `envio-cliente-${ids!.suffix}.pdf`;
  await page.getByTestId('upload-input').setInputFiles({ name: nomeUpload, mimeType: 'application/pdf', buffer: pdf('portal') });
  await expect(page.getByText('Documento enviado ao escritório.')).toBeVisible({ timeout: 15_000 });

  // nasce a linha `documentos` origem 'portal' ligada ao cliente e ao processo
  const enviado = await page.evaluate(async (nome) => {
    const s = (window as unknown as { __ekoa: { shared: any } }).__ekoa.shared;
    const docs = await s.list('documentos');
    const d = docs.find((x: any) => x.nome === nome);
    return d ? { origem: d.origem, clienteId: d.clienteId, processoId: d.processoId, hasFile: !!(d.ficheiro && d.ficheiro.fileId) } : null;
  }, nomeUpload);
  expect(enviado?.origem).toBe('portal');
  expect(enviado?.clienteId).toBe(ids!.clienteId);
  expect(enviado?.processoId).toBe(ids!.processoId);
  expect(enviado?.hasFile).toBe(true);

  // foi escrita uma auditoria (evento tipo 'portal_acesso') para este cliente
  const auditou = await page.evaluate(async (clienteId) => {
    const s = (window as unknown as { __ekoa: { shared: any } }).__ekoa.shared;
    const evs = await s.list('eventos');
    return evs.some((e: any) => e.tipo === 'portal_acesso' && e.clienteId === clienteId);
  }, ids!.clienteId);
  expect(auditou, 'cada upload do cliente escreve uma auditoria portal_acesso').toBe(true);

  // e o documento aparece no Dossiê do processo certo
  await page.goto(`${DOSSIE}processo/${ids!.processoId}?tab=documentos`);
  await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('documentos-list').getByText(nomeUpload)).toBeVisible({ timeout: 15_000 });

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});
