/* eslint-disable @typescript-eslint/no-explicit-any -- the SSE-injected `window.__ekoa.shared` bridge is an untyped runtime global; spine access in-page is dynamic by nature */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-assinatura - S5 featured-artifact layer of the Assinatura app.
 *
 * The frozen legal-assinatura.spec.ts (SV-ASS) already pins the state machine,
 * the audit certificate and the honest demo/manual boundaries (the certificate
 * carries the "não constitui atestação de validade jurídica" notice). This spec
 * covers the NEW, additive DETERMINISTIC HASH MANIFEST per envelope:
 *
 *  1. Once an envelope reaches "Concluído", the certificate view renders a
 *     manifest section (assinatura-manifesto) whose hash (assinatura-manifesto-
 *     hash) is a SHA-256 over the canonical serialization of the envelope's
 *     document fingerprints - shown as "sha-256: <64 hex>".
 *  2. DETERMINISM: a hard reload of the same concluded envelope recomputes the
 *     EXACT same manifest hash (the hash covers content, not timestamps or UI
 *     state) - the property the acceptance calls for.
 *  3. On archive, the manifest is persisted onto BOTH the archived `assinaturas`
 *     and `documentos` rows, with the same hash the UI displayed - so the
 *     probative archive carries the fingerprint manifest, not a fresh guess.
 *
 * Self-bootstrapping (cliente + processo + documento) over the shared spine;
 * captures pageerror; cleans up every row it created.
 */
const BASE = legalAppUrl('legal-assinatura');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-assinatura');
mkdirSync(SHOTS, { recursive: true });

const HEX64 = /^sha-256:\s*([0-9a-f]{64})$/;

test.describe.serial('Assinatura: manifesto de impressões digitais determinístico por envelope', () => {
  const suffix = Date.now().toString(36);
  const created: { clienteId?: string; processoId?: string; documentoId?: string; envelopeIds: string[] } = { envelopeIds: [] };

  async function spineList(page: Page, coll: string): Promise<any[]> {
    return page.evaluate((c) => (window as any).__ekoa.shared.list(c), coll);
  }

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE);
    await expect(page.getByTestId('assinatura-envelopes-page')).toBeVisible({ timeout: 30_000 });
    const cliente = await page.evaluate((d) => (window as any).__ekoa.shared.create('clientes', d), {
      nome: `Cliente Manifesto ${suffix}`, nif: '210000017', email: `manifesto-${suffix}@exemplo.pt`, tipo: 'particular',
    });
    created.clienteId = cliente.id;
    const processo = await page.evaluate((args) => (window as any).__ekoa.shared.create('processos', {
      numeroProcesso: `8${String(Date.now()).slice(-3)}/26.9T8LSB`, tribunal: 'Juízo Central Cível de Lisboa',
      area: 'Cível', estado: 'ativo', clienteId: args.clienteId,
    }), { clienteId: cliente.id });
    created.processoId = processo.id;
    const documento = await page.evaluate((args) => (window as any).__ekoa.shared.create('documentos', {
      nome: `Procuração forense ${args.suffix}.pdf`, tipo: 'pdf', processoId: args.processoId, clienteId: args.clienteId,
      origem: 'upload', data: new Date().toISOString().slice(0, 10), versao: 1,
    }), { suffix, processoId: processo.id, clienteId: cliente.id });
    created.documentoId = documento.id;
    await page.close();
  });

  test('envelope concluído mostra manifesto SHA-256 determinístico (estável ao recarregar) e arquiva-o', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // --- Criar via UI a partir do exemplo (procuração forense, 2 signatários simulado) ---
    await page.goto(`${BASE}novo`);
    await expect(page.getByTestId('assinatura-novo-page')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('assinatura-exemplo').click();
    await expect(page.getByTestId('assinatura-doc-escolhido')).toContainText(/Procuração forense/i);
    await page.getByTestId('assinatura-processo').selectOption(created.processoId!);
    await page.getByTestId('assinatura-criar').click();

    await page.waitForURL(/\/envelopes\/[^/]+/, { timeout: 20_000 });
    await expect(page.getByTestId('assinatura-detalhe-page')).toBeVisible({ timeout: 15_000 });
    const envId = (page.url().match(/envelopes\/([^/?#]+)/) || [])[1];
    expect(envId, 'id do envelope na URL').toBeTruthy();
    created.envelopeIds.push(envId);

    // --- Máquina de estados até concluído (caminho simulado) ---
    await page.getByTestId('assinatura-marcar-pronto').click();
    await expect(page.getByTestId('assinatura-detalhe-estado')).toContainText(/Pronto/i);
    await page.getByTestId('assinatura-iniciar').click();
    await expect(page.getByTestId('assinatura-detalhe-estado')).toContainText(/Em assinatura/i);
    await page.getByTestId('assinatura-assinar').click();
    await page.getByTestId('assinatura-assinar').click();
    await expect(page.getByTestId('assinatura-detalhe-estado')).toContainText(/Concluído/i, { timeout: 15_000 });

    // --- O manifesto renderiza com um hash SHA-256 de 64 hex ---
    const manifesto = page.getByTestId('assinatura-manifesto');
    await expect(manifesto).toBeVisible({ timeout: 15_000 });
    const hashEl = page.getByTestId('assinatura-manifesto-hash');
    await expect(hashEl).toHaveText(HEX64, { timeout: 15_000 });
    const primeiro = (await hashEl.textContent())?.trim() || '';
    const m1 = primeiro.match(HEX64);
    expect(m1, 'hash é sha-256 de 64 hex').not.toBeNull();
    const hash1 = m1![1];
    await page.screenshot({ path: `${SHOTS}/manifesto.png`, fullPage: true });

    // --- DETERMINISMO: recarregar o mesmo envelope recomputa o MESMO hash ---
    await page.reload();
    await expect(page.getByTestId('assinatura-detalhe-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('assinatura-manifesto-hash')).toHaveText(HEX64, { timeout: 15_000 });
    const segundo = (await page.getByTestId('assinatura-manifesto-hash').textContent())?.trim() || '';
    const hash2 = (segundo.match(HEX64) || [])[1];
    expect(hash2, 'hash estável entre renders (cobre conteúdo, não estado)').toBe(hash1);

    // --- Arquivar: o manifesto persiste nas linhas assinaturas + documentos com o mesmo hash ---
    await page.getByTestId('assinatura-arquivar').click();
    await expect(page.getByTestId('assinatura-arquivado')).toBeVisible({ timeout: 15_000 });

    const assinaturas = (await spineList(page, 'assinaturas')).filter((a) => a.envelopeId === envId);
    expect(assinaturas.length, 'uma linha assinaturas arquivada').toBe(1);
    expect(assinaturas[0].manifesto, 'manifesto no registo de assinatura').toBeTruthy();
    expect(assinaturas[0].manifesto.manifestoHash, 'hash arquivado igual ao apresentado').toBe(hash1);
    expect(assinaturas[0].manifesto.algoritmoManifesto).toBe('sha-256');

    const docs = (await spineList(page, 'documentos')).filter((d) => d.origem === 'legal-assinatura' && d.envelopeId === envId);
    expect(docs.length, 'um documento de certificado arquivado').toBe(1);
    expect(docs[0].manifesto, 'manifesto no documento arquivado').toBeTruthy();
    expect(docs[0].manifesto.manifestoHash).toBe(hash1);
    // O manifesto lista os documentos por ordem canónica, todos com impressão SHA-256.
    expect(Array.isArray(docs[0].manifesto.documentos)).toBe(true);
    expect(docs[0].manifesto.totalDocumentos).toBe(docs[0].manifesto.documentos.length);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE).catch(() => {});
    await page.evaluate(async (ids) => {
      const shared = (window as any).__ekoa.shared;
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
