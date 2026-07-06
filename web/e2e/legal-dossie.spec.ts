import { test, expect, type Page } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * S5-dossiê — the per-processo WORKSPACE.
 *
 * The Dossiê stopped being a read-only print compiler: it is now the workspace
 * for a processo, driven off the SHARED spine (window.__ekoa.shared) plus the
 * app-files API (uploadFile/deleteFile) and delegated Microsoft Graph
 * (graphFetch) for the Office round-trip. This spec seeds a dedicated processo
 * per test and cleans it up, so it never depends on (nor pollutes) the demo
 * spine. It proves: picker → deep-link workspace that survives a hard reload;
 * document upload with a real ficheiro block, download link and delete; note
 * autosave that persists; the M365 Office round-trip (mocked graph endpoints);
 * communication triage (associate); and the merged chronology + print compile.
 */
const BASE = legalAppUrl('legal-dossie');

type SeedIds = { clienteId: string; processoId: string; suffix: number; numero: string };

/* A tiny but valid-enough PDF; the server stores raw bytes, we never render it. */
function makePdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n');
}
function makeDocx(tag: string): Buffer {
  // Not a real zip; the app only moves the bytes around. PK header keeps it plausible.
  return Buffer.from(`PK docx ${tag}`);
}

async function seedProcesso(page: Page): Promise<SeedIds> {
  return await page.evaluate(async () => {
    const s = (window as unknown as { __ekoa: { shared: any } }).__ekoa.shared;
    const suffix = Date.now();
    const numero = `9100/${suffix % 10000}.0T8DOS`;
    const cli = await s.create('clientes', {
      nome: `Cliente Dossiê ${suffix}`,
      nif: '299000001',
      email: `dossie${suffix}@e2e.pt`,
      telefone: '+351 900 111 222',
      tipo: 'particular',
      morada: 'Rua E2E, 1, Lisboa',
    });
    const prc = await s.create('processos', {
      numeroProcesso: numero,
      tribunal: 'Juízo E2E de Lisboa',
      comarca: 'Lisboa',
      area: 'Cível',
      estado: 'ativo',
      advogadoResponsavel: 'Dra. Teste',
      descricao: 'Processo de teste do dossiê (E2E).',
      clienteId: cli.id,
    });
    const iso = (off: number) => {
      const d = new Date();
      d.setDate(d.getDate() + off);
      return d.toISOString().slice(0, 10);
    };
    await s.create('prazos', {
      processoId: prc.id,
      titulo: 'Contestação E2E',
      dataLimite: iso(3),
      estado: 'pendente',
      origem: 'manual',
      regraAplicada: 'Contestação - 10 dias',
    });
    await s.create('eventos', {
      processoId: prc.id,
      titulo: 'Citação E2E',
      data: iso(-5),
      tipo: 'juntada',
      origem: 'manual',
    });
    return { clienteId: cli.id, processoId: prc.id, suffix, numero };
  });
}

async function cleanup(page: Page, ids: SeedIds | null) {
  if (!ids) return;
  try {
    await page.evaluate(async (ids) => {
      const w = window as unknown as { __ekoa: any; __EKOA_APP_ID: string };
      const s = w.__ekoa.shared;
      const appId = w.__EKOA_APP_ID;
      const docs = await s.list('documentos');
      for (const d of docs)
        if (d.processoId === ids.processoId) {
          if (d.ficheiro && d.ficheiro.appId === appId && d.ficheiro.fileId) {
            try {
              await w.__ekoa.deleteFile(d.ficheiro.fileId);
            } catch (e) {
              /* ignore */
            }
          }
          // archived versions keep their own files now (resync no longer deletes) — clean them too
          for (const v of Array.isArray(d.versoes) ? d.versoes : []) {
            if (v && v.fileId) {
              try {
                await w.__ekoa.deleteFile(v.fileId);
              } catch (e) {
                /* ignore */
              }
            }
          }
          await s.delete('documentos', d.id);
        }
      const comms = await s.list('comunicacoes');
      for (const c of comms)
        // includes messages bound to ANY matter of this cliente (the isolation test
        // seeds a second processo + a client-level message) so nothing leaks between runs
        if (
          c.processoId === ids.processoId ||
          c.clienteId === ids.clienteId ||
          String(c.sourceRef || '').startsWith(`wamid.E2E-${ids.suffix}`)
        )
          await s.delete('comunicacoes', c.id);
      const evs = await s.list('eventos');
      for (const e of evs) if (e.processoId === ids.processoId) await s.delete('eventos', e.id);
      const przs = await s.list('prazos');
      for (const p of przs) if (p.processoId === ids.processoId) await s.delete('prazos', p.id);
      // delete EVERY processo of this cliente (the isolation test adds an extra one)
      const procs = await s.list('processos');
      for (const p of procs)
        if (p.id === ids.processoId || p.clienteId === ids.clienteId) await s.delete('processos', p.id);
      await s.delete('clientes', ids.clienteId);
    }, ids);
  } catch (e) {
    /* best-effort */
  }
}

async function gotoProcesso(page: Page, id: string, tab?: string) {
  await page.goto(`${BASE}processo/${id}`);
  await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });
  if (tab) await page.getByTestId(`tab-${tab}`).click();
}

let ids: SeedIds | null = null;
let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(BASE);
  await expect(page.getByTestId('picker-page')).toBeVisible({ timeout: 30_000 });
  ids = await seedProcesso(page);
  // refresh the picker so it lists the just-seeded processo
  await page.reload();
  await expect(page.getByTestId('picker-page')).toBeVisible({ timeout: 30_000 });
});

test.afterEach(async ({ page }) => {
  await cleanup(page, ids);
  ids = null;
});

test('picker opens the workspace and the deep link survives a hard reload', async ({ page }) => {
  const id = ids!.processoId;
  await page.getByTestId('picker-search').fill(String(ids!.suffix % 10000));
  const card = page.locator(`[data-testid="picker-card"][data-processo-id="${id}"]`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.click();

  await expect(page).toHaveURL(new RegExp(`/processo/${id}`));
  await expect(page.getByTestId('processo-page')).toBeVisible();
  await expect(page.getByTestId('visao-geral')).toBeVisible();

  // hard reload of the deep link lands back on the same workspace
  await page.reload();
  await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('visao-geral')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/processo/${id}`));

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('upload a document (ficheiro block + download link), then delete with confirm', async ({ page }) => {
  await gotoProcesso(page, ids!.processoId, 'documentos');

  await page.getByTestId('upload-input').setInputFiles({
    name: 'peticao-e2e.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf(),
  });

  const list = page.getByTestId('documentos-list');
  await expect(list.getByText('peticao-e2e.pdf')).toBeVisible({ timeout: 15_000 });

  // the row carries a real ficheiro block: a download link to the app-files url,
  // an origem badge, and a preview toggle (pdf is previewable)
  const dl = list.getByTestId('doc-download').first();
  await expect(dl).toHaveAttribute('href', /\/api\/app-files\/legal-dossie\//);
  await expect(list.getByText('Carregado').first()).toBeVisible();
  await expect(list.getByTestId('doc-preview-toggle').first()).toBeVisible();

  // and the ficheiro block persisted on the row
  const ficheiro = await page.evaluate(async () => {
    const docs = await (window as unknown as { __ekoa: any }).__ekoa.shared.list('documentos');
    const d = docs.find((x: any) => x.nome === 'peticao-e2e.pdf');
    return d && d.ficheiro;
  });
  expect(ficheiro?.fileId).toBeTruthy();
  expect(ficheiro?.appId).toBe('legal-dossie');

  // delete with confirmation
  await list.getByTestId('doc-delete').first().click();
  await page.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(list.getByText('peticao-e2e.pdf')).toHaveCount(0, { timeout: 10_000 });

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('create a note, autosave persists across a reload', async ({ page }) => {
  await gotoProcesso(page, ids!.processoId, 'documentos');

  await page.getByTestId('nova-nota').click();
  const ta = page.getByTestId('nota-texto');
  await expect(ta).toBeVisible();
  const unique = `Nota E2E ${ids!.suffix} - estratégia processual`;
  await ta.fill(unique);
  await expect(page.getByText('Guardado.')).toBeVisible({ timeout: 8_000 });
  await page.getByRole('button', { name: 'Concluir' }).click();

  // reload -> the note (and its text) survives, read back from the spine
  await page.reload();
  await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('tab-documentos').click();
  await expect(page.getByTestId('documentos-list').getByText(unique)).toBeVisible({ timeout: 15_000 });

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('Office round-trip: edit-in-Office links OneDrive, resync bumps the version', async ({ page }) => {
  // stub window.open so we can assert the webUrl was opened
  await page.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = ((url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  // whoami -> a signed-in M365 identity
  await page.route('**/api/app-sso/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { name: 'Dra. Teste', email: 'dra.teste@ekoaai.onmicrosoft.com' } }),
    }),
  );
  // graph: PUT .../content -> a driveItem; GET .../items/itm1/content -> updated bytes
  await page.route('**/api/app-sso/m365/**', (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'itm1', webUrl: 'https://example.sharepoint.com/x' }),
      });
    }
    if (req.method() === 'GET' && /\/items\/itm1\/content/.test(req.url())) {
      return route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: makeDocx('resynced'),
      });
    }
    return route.fulfill({ status: 404, body: '' });
  });

  await gotoProcesso(page, ids!.processoId, 'documentos');

  await page.getByTestId('upload-input').setInputFiles({
    name: 'procuracao-e2e.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: makeDocx('original'),
  });
  const row = page.locator('[data-testid^="doc-row-"]', { hasText: 'procuracao-e2e.docx' });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // signed in -> Office button enabled; clicking uploads + links OneDrive + opens webUrl
  const office = row.getByTestId('editar-office');
  await expect(office).toBeEnabled();
  await office.click();
  await expect(row.getByTestId('ressincronizar')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toContain(
    'https://example.sharepoint.com/x',
  );

  const before = await page.evaluate(async () => {
    const docs = await (window as unknown as { __ekoa: any }).__ekoa.shared.list('documentos');
    const d = docs.find((x: any) => x.nome === 'procuracao-e2e.docx');
    return { m365: d?.m365, v1Url: d?.ficheiro?.url };
  });
  expect(before.m365?.driveItemId).toBe('itm1');
  expect(before.m365?.webUrl).toBe('https://example.sharepoint.com/x');
  expect(before.v1Url).toBeTruthy();

  // resync -> version bumps to 2 and the previous version is archived in versoes[]
  await row.getByTestId('ressincronizar').click();
  await expect(row.getByText(/versão 2/i)).toBeVisible({ timeout: 10_000 });
  const after = await page.evaluate(async () => {
    const docs = await (window as unknown as { __ekoa: any }).__ekoa.shared.list('documentos');
    const d = docs.find((x: any) => x.nome === 'procuracao-e2e.docx');
    return { versao: d?.versao, versoes: d?.versoes, url: d?.ficheiro?.url };
  });
  expect(after.versao).toBe(2);
  expect(Array.isArray(after.versoes) ? after.versoes.length : 0).toBeGreaterThanOrEqual(1);
  // the archived entry keeps the v1 url and it is NOT the current (v2) file
  const archived = after.versoes[after.versoes.length - 1];
  expect(archived.url).toBe(before.v1Url);
  expect(after.url).not.toBe(before.v1Url);
  // and the archived version's file is still fetchable (history stays downloadable)
  const archivedOk = await page.evaluate(async (url) => {
    const res = await (window as unknown as { __ekoa: any }).__ekoa.fetch(url);
    return res.ok;
  }, archived.url);
  expect(archivedOk).toBe(true);

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('communications: associate an unassigned message to this processo', async ({ page }) => {
  const commId = await page.evaluate(async (suffix) => {
    const c = await (window as unknown as { __ekoa: any }).__ekoa.shared.create('comunicacoes', {
      canal: 'whatsapp',
      direction: 'in',
      fromAddr: '+351939000000',
      fromName: 'Contacto E2E',
      body: `Mensagem por associar E2E ${suffix}`,
      sourceRef: `wamid.E2E-${suffix}`,
      receivedAt: new Date().toISOString(),
      status: 'por-associar',
    });
    return c.id as string;
  }, ids!.suffix);

  await gotoProcesso(page, ids!.processoId, 'comunicacoes');
  // The fixture has no affinity with this cliente, so it lives in the
  // "outros contactos" group, COLLAPSED by default (no sender/content shown
  // until explicitly expanded) - assert the collapse, then expand.
  const btn = page.getByTestId(`associar-${commId}`);
  await expect(btn).not.toBeVisible();
  const toggle = page.getByTestId('outras-toggle');
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  await expect(toggle).toContainText('Mostrar mensagens de outros contactos');
  await toggle.click();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  // a confirm dialog appears BEFORE anything is patched — stating sender + target numero
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Associar a este processo?');
  await expect(dialog).toContainText('Contacto E2E');
  await expect(dialog).toContainText(ids!.numero);
  // nothing has been patched yet — the message is still 'por-associar'
  const midway = await page.evaluate(async (commId) => {
    const c = await (window as unknown as { __ekoa: any }).__ekoa.shared.get('comunicacoes', commId);
    return c.status;
  }, commId);
  expect(midway).toBe('por-associar');

  // confirm -> the patch runs
  await dialog.getByRole('button', { name: 'Associar', exact: true }).click();
  await expect(page.getByText('Mensagem associada a este processo.')).toBeVisible({ timeout: 8_000 });

  const patched = await page.evaluate(async (commId) => {
    const c = await (window as unknown as { __ekoa: any }).__ekoa.shared.get('comunicacoes', commId);
    return { status: c.status, processoId: c.processoId };
  }, commId);
  expect(patched.status).toBe('associada');
  expect(patched.processoId).toBe(ids!.processoId);

  // it now appears in the timeline
  await expect(
    page.getByTestId('comunicacoes-timeline').getByText(`Mensagem por associar E2E ${ids!.suffix}`),
  ).toBeVisible();

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('cronologia merges a derived document milestone and a created event', async ({ page }) => {
  await gotoProcesso(page, ids!.processoId, 'documentos');
  await page.getByTestId('upload-input').setInputFiles({
    name: 'anexo-e2e.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf(),
  });
  await expect(page.getByTestId('documentos-list').getByText('anexo-e2e.pdf')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('tab-cronologia').click();
  const timeline = page.getByTestId('cronologia-timeline');
  await expect(timeline).toBeVisible();
  // derived milestone for the uploaded document (never persisted as an evento)
  await expect(timeline.getByText('Documento: anexo-e2e.pdf')).toBeVisible();
  await expect(page.getByTestId('crono-derived').first()).toBeVisible();

  // create a manual event -> shows in the merged timeline
  await page.getByTestId('novo-evento').click();
  const titulo = `Audiência E2E ${ids!.suffix}`;
  await page.getByTestId('evento-titulo').fill(titulo);
  await page.getByTestId('guardar-evento').click();
  await expect(timeline.getByText(titulo)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('crono-evento').first()).toBeVisible();

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('dossiê print tab compiles all sections and fires print-to-PDF', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __printed: boolean }).__printed = false;
    window.print = () => {
      (window as unknown as { __printed: boolean }).__printed = true;
    };
  });
  await gotoProcesso(page, ids!.processoId, 'print');

  await expect(page.getByTestId('ds-dossie')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('ds-titulo')).toContainText(ids!.numero);
  await expect(page.getByTestId('ds-cliente')).toContainText('Cliente Dossiê');
  await expect(page.getByTestId('ds-prazo').first()).toBeVisible(); // prazos section compiled
  await expect(page.getByTestId('ds-evento').first()).toBeVisible(); // cronologia compiled
  await expect(page.getByTestId('ds-comunicacoes')).toBeVisible(); // new comms section present
  await expect(page.getByTestId('ds-documentos')).toBeVisible();

  await page.getByTestId('guardar-pdf').click();
  expect(await page.evaluate(() => (window as unknown as { __printed: boolean }).__printed)).toBe(true);

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('active tab lives in ?tab= and survives a reload', async ({ page }) => {
  const id = ids!.processoId;
  // deep-linking straight to ?tab=documentos opens that tab
  await page.goto(`${BASE}processo/${id}?tab=documentos`);
  await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('documentos-tab')).toBeVisible();
  await expect(page.getByTestId('tab-documentos')).toHaveClass(/is-active/);

  // clicking another tab rewrites the URL
  await page.getByTestId('tab-comunicacoes').click();
  await expect(page).toHaveURL(/[?&]tab=comunicacoes/);
  await expect(page.getByTestId('comunicacoes-tab')).toBeVisible();

  // and that tab survives a hard reload (returns the user where they were)
  await page.reload();
  await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('comunicacoes-tab')).toBeVisible();
  await expect(page.getByTestId('tab-comunicacoes')).toHaveClass(/is-active/);

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});

test('cross-matter isolation: a message on another matter of the same client never leaks in', async ({
  page,
}) => {
  const stamp = Date.now();
  const leakBody = `Mensagem exclusiva do processo B ${stamp}`; // bound to matter B -> must NOT show in A
  const clientBody = `Mensagem ao nivel do cliente ${stamp}`; // no processo -> SHOULD show in A, labelled

  // Seed (while still on the picker) a SECOND matter for the SAME cliente, plus a
  // message bound to it, and a client-level message with no processo.
  await page.evaluate(
    async ({ clienteId, leakBody, clientBody }) => {
      const s = (window as unknown as { __ekoa: any }).__ekoa.shared;
      const pb = await s.create('processos', {
        numeroProcesso: `9200/${Date.now() % 10000}.0T8DOS`,
        tribunal: 'Juízo E2E de Lisboa',
        area: 'Cível',
        estado: 'ativo',
        clienteId,
      });
      await s.create('comunicacoes', {
        canal: 'email',
        direction: 'in',
        fromAddr: 'contraparte-b@e2e.pt',
        fromName: 'Assunto do Processo B',
        subject: 'Processo B',
        body: leakBody,
        receivedAt: new Date().toISOString(),
        status: 'associada',
        clienteId,
        processoId: pb.id,
      });
      await s.create('comunicacoes', {
        canal: 'whatsapp',
        direction: 'in',
        fromAddr: '+351900111222',
        fromName: 'Mensagem ao nível do cliente',
        body: clientBody,
        receivedAt: new Date().toISOString(),
        status: 'associada',
        clienteId,
      });
    },
    { clienteId: ids!.clienteId, leakBody, clientBody },
  );

  await gotoProcesso(page, ids!.processoId, 'comunicacoes');
  const tl = page.getByTestId('comunicacoes-timeline');
  await expect(tl).toBeVisible({ timeout: 15_000 });

  // the client-level message DOES appear in matter A, and it is labelled as such
  await expect(tl.getByText(clientBody)).toBeVisible();
  await expect(page.getByTestId('com-sem-processo').first()).toBeVisible();

  // the message bound to matter B NEVER appears anywhere in matter A's workspace
  await expect(page.getByText(leakBody)).toHaveCount(0);

  // ...nor is it counted on the Comunicações tab badge (count = client-level only = 1)
  await expect(page.getByTestId('tab-comunicacoes').locator('.tab-badge')).toHaveText('1');

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);
});
