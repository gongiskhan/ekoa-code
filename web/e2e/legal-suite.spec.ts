import { test, expect, type Page } from '@playwright/test';
import { cortexBase } from './helpers/legal';

/**
 * S8-suite — the six legal artifacts as ONE suite over the shared spine.
 *
 * A single cross-app journey that a PT lawyer actually walks: open a new matter
 * in the NÚCLEO (cliente + FK-linked processo), jump through the processo's
 * "Abrir dossiê" deep link into the DOSSIÊ, write a nota there, compute and save
 * a CPC deadline in PRAZOS against the SAME processo, watch it surface on the
 * radar, drive the in-spine notifications BELL, and finally see both the nota
 * milestone and the prazo merged in the dossiê CRONOLOGIA. Every app reads and
 * writes the one account-shared namespace (window.__ekoa.shared); nothing here
 * is app-local. The whole journey is re-runnable and cleans up everything it
 * creates in a finally block — including precisely restoring the lida state of
 * any OTHER notification that "marcar todas como lidas" happened to flip, so the
 * shared dev spine is left byte-for-byte as it was found.
 *
 * The apps are served by the shared dev cortex at /apps/legal-*; the journey
 * uses absolute cortex URLs (the frontend baseURL is irrelevant here).
 */
const CORTEX = cortexBase();
const NUCLEO = `${CORTEX}/apps/legal-nucleo/`;

/* 'YYYY-MM-DD' local, offset by `days` from today. */
function ymd(days = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/* Whole days until `dateStr` (negative = overdue) — byte-for-byte the same basis
 * as the apps' shared diasRestantes(), so the radar label we assert matches. */
function diasRestantes(dateStr: string): number {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  let target: Date;
  if (m) {
    target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  } else {
    const d = new Date(dateStr);
    target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

/* The exact human label the radar renders for `d` days remaining. */
function diasLabel(d: number): string {
  if (d === 0) return 'hoje';
  if (d < 0) {
    const n = Math.abs(d);
    return `há ${n} dia${n === 1 ? '' : 's'}`;
  }
  return `em ${d} dia${d === 1 ? '' : 's'}`;
}

type Ids = {
  clienteId: string | null;
  processoId: string | null;
  prazoId: string | null;
  notificacaoId: string | null;
  notifTitulo: string;
  otherUnreadIds: string[];
};

/*
 * Self-contained teardown, run inside a served app so window.__ekoa exists.
 * Deletes every row the journey created (prazos/documentos/eventos of the matter,
 * the matter itself, the cliente, my notification) and — crucially — flips back
 * to unread every OTHER notification that "marcar todas como lidas" marked read,
 * so the shared spine is left exactly as found.
 */
async function cleanup(page: Page, ids: Ids): Promise<void> {
  try {
    await page.evaluate(async (ids) => {
      const s = (window as any).__ekoa && (window as any).__ekoa.shared;
      if (!s) return;
      const del = async (coll: string, id: string) => {
        try {
          await s.delete(coll, id);
        } catch {
          /* ignore */
        }
      };
      if (ids.processoId) {
        for (const coll of ['prazos', 'documentos', 'eventos']) {
          try {
            const list = await s.list(coll);
            for (const row of list) if (row.processoId === ids.processoId) await del(coll, row.id);
          } catch {
            /* ignore */
          }
        }
      }
      // my notification (by id, falling back to the unique título)
      if (ids.notificacaoId) {
        await del('notificacoes', ids.notificacaoId);
      } else {
        try {
          const list = await s.list('notificacoes');
          for (const n of list) if (n.titulo === ids.notifTitulo) await del('notificacoes', n.id);
        } catch {
          /* ignore */
        }
      }
      // restore the pre-existing unread notifications that mark-all-read flipped
      for (const id of ids.otherUnreadIds || []) {
        try {
          await s.update('notificacoes', id, { lida: false });
        } catch {
          /* ignore */
        }
      }
      if (ids.processoId) await del('processos', ids.processoId);
      if (ids.clienteId) await del('clientes', ids.clienteId);
    }, ids);
  } catch {
    /* best-effort */
  }
}

test('legal suite: cliente → processo → dossiê nota → prazo → radar → bell → cronologia, over one shared spine', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const assertClean = (label: string) =>
    expect(pageErrors, `${label} — page errors: ${pageErrors.join(' | ')}`).toHaveLength(0);

  const suffix = Date.now();
  const nome = `Suite E2E ${suffix}`;
  const nif = ('2' + String(suffix % 100000000).padStart(8, '0')).slice(0, 9);
  const telefone = '+3519' + String(suffix % 100000000).padStart(8, '0');
  const email = `suite${suffix}@e2e.pt`;
  const numero = `9${String(suffix % 1000).padStart(3, '0')}/26.0T8SUITE`;
  const notaTitle = `Nota Suite E2E ${suffix}`;
  const notaText = `Estratégia processual da suite E2E ${suffix} — acordo antes da audiência.`;
  const prazoTitulo = `Prazo Suite E2E ${suffix}`;
  const notifTitulo = `Suite E2E ${suffix}`;

  const ids: Ids = {
    clienteId: null,
    processoId: null,
    prazoId: null,
    notificacaoId: null,
    notifTitulo,
    otherUnreadIds: [],
  };

  try {
    // ---------------------------------------------------------------------
    // 1) NÚCLEO — open a new matter: cliente + FK-linked processo.
    // ---------------------------------------------------------------------
    await page.goto(NUCLEO, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('nav-clientes').click();
    await expect(page.getByTestId('clientes-page')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('novo-cliente').click();
    await page.getByTestId('cliente-nome').fill(nome);
    await page.getByTestId('cliente-nif').fill(nif);
    await page.getByTestId('cliente-email').fill(email);
    await page.getByTestId('cliente-telefone').fill(telefone);
    await page.getByTestId('guardar-cliente').click();
    await expect(page).toHaveURL(/\/clientes\/[^/]+$/, { timeout: 15_000 });
    ids.clienteId = page.url().match(/\/clientes\/([^/?#]+)/)?.[1] ?? null;
    expect(ids.clienteId, 'cliente id from URL').toBeTruthy();
    await expect(page.getByTestId('cliente-detail').getByRole('heading', { name: nome })).toBeVisible();

    await page.getByTestId('nav-processos').click();
    await expect(page.getByTestId('processos-page')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('novo-processo').click();
    const opt = page.getByTestId('processo-cliente').locator('option', { hasText: nome });
    await expect(opt).toBeAttached({ timeout: 10_000 });
    await page.getByTestId('processo-cliente').selectOption((await opt.getAttribute('value')) ?? '');
    await page.getByTestId('processo-numero').fill(numero);
    await page.getByTestId('processo-tribunal').fill('Juízo Central Cível de Lisboa');
    await page.getByTestId('guardar-processo').click();
    await expect(page).toHaveURL(/\/processos\/[^/]+$/, { timeout: 15_000 });
    ids.processoId = page.url().match(/\/processos\/([^/?#]+)/)?.[1] ?? null;
    expect(ids.processoId, 'processo id from URL').toBeTruthy();
    await expect(page.getByTestId('processo-detail').getByRole('heading', { name: numero })).toBeVisible();
    assertClean('núcleo');

    // ---------------------------------------------------------------------
    // 2) NÚCLEO processo detail → the "Abrir dossiê" deep link → follow it.
    // ---------------------------------------------------------------------
    const dossieHref = `/apps/legal-dossie/processo/${ids.processoId}`;
    await expect(page.getByTestId('abrir-dossie')).toHaveAttribute('href', dossieHref);
    await page.goto(`${CORTEX}${dossieHref}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });
    assertClean('dossiê deep link');

    // ---------------------------------------------------------------------
    // 3) DOSSIÊ — write a nota on this processo; the documentos row persists.
    // ---------------------------------------------------------------------
    await page.getByTestId('tab-documentos').click();
    await expect(page.getByTestId('documentos-tab')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('nova-nota').click();
    await page.getByPlaceholder('Título da nota').fill(notaTitle);
    await page.getByTestId('nota-texto').fill(notaText);
    await expect(page.getByText('Guardado.').first()).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: 'Concluir' }).click();

    const docsList = page.getByTestId('documentos-list');
    await expect(docsList.getByText(notaTitle)).toBeVisible({ timeout: 15_000 });
    await expect(docsList.getByText(notaText)).toBeVisible();
    assertClean('dossiê documentos');

    // ---------------------------------------------------------------------
    // 4) PRAZOS calculadora — same processo, 10 dias úteis → save a prazo.
    //    Férias judiciais suspension is turned OFF so the deadline is a clean
    //    ~10-business-days-out regardless of the season (otherwise a run during
    //    the 16 Jul–31 Aug / 22 Dec–3 Jan judicial vacation would push the
    //    deadline months out and off the radar's 30-day window).
    // ---------------------------------------------------------------------
    await page.goto(`${CORTEX}/apps/legal-prazos/calculadora`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('calculadora-page')).toBeVisible({ timeout: 20_000 });
    const procOpt = page.getByTestId('prazo-processo').locator(`option[value="${ids.processoId}"]`);
    await expect(procOpt).toBeAttached({ timeout: 15_000 });
    await page.getByTestId('prazo-processo').selectOption(ids.processoId ?? '');
    await page.getByTestId('prazo-data').fill(ymd(0)); // notificação = today
    await page.getByTestId('prazo-titulo').fill(prazoTitulo);
    await page.getByTestId('prazo-dias').fill('10');
    // contagem defaults to 'uteis'; drop the férias suspension for determinism
    await page.getByTestId('prazo-ferias').uncheck();
    await page.getByTestId('calcular').click();
    await expect(page.getByTestId('resultado-datalimite')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('guardar-prazo').click();

    // it landed in the "guardados recentemente" list…
    await expect(page.getByTestId('prazos-lista').getByText(prazoTitulo).first()).toBeVisible({
      timeout: 10_000,
    });
    // …and persisted to the shared spine, FK-linked to the matter.
    let prazo: { id: string; dataLimite: string; processoId: string } | null = null;
    await expect
      .poll(
        async () => {
          prazo = await page.evaluate(
            async ({ t, pid }) => {
              const list = await (window as any).__ekoa.shared.list('prazos');
              const m = list.find(
                (p: any) => p.processoId === pid && (p.titulo === t || p.descricao === t),
              );
              return m ? { id: m.id, dataLimite: m.dataLimite, processoId: m.processoId } : null;
            },
            { t: prazoTitulo, pid: ids.processoId },
          );
          return prazo ? prazo.id : null;
        },
        { timeout: 10_000, message: 'prazo did not persist to the shared spine' },
      )
      .not.toBeNull();
    ids.prazoId = prazo!.id;
    expect(prazo!.processoId).toBe(ids.processoId);
    assertClean('prazos calculadora');

    // ---------------------------------------------------------------------
    // 5) PRAZOS radar — the new prazo appears in its correct urgency band.
    //    ~10 business days out ⇒ 0 < d ≤ 30 and d > 7 ⇒ "Próximos" (30d toggle).
    // ---------------------------------------------------------------------
    const d = diasRestantes(prazo!.dataLimite);
    expect(d, `deadline ${prazo!.dataLimite} should sit within the radar window`).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(30);

    await page.goto(`${CORTEX}/apps/legal-prazos/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('radar-page')).toBeVisible({ timeout: 20_000 });
    if (d > 7) await page.getByTestId('radar-window-30').click();
    const proximos = page.getByTestId('radar-proximos');
    await expect(proximos.getByTestId(`prazo-desc-${ids.prazoId}`)).toHaveText(prazoTitulo, {
      timeout: 15_000,
    });
    await expect(page.getByTestId(`prazo-dias-${ids.prazoId}`)).toHaveText(diasLabel(d));
    await expect(page.getByTestId(`prazo-origem-${ids.prazoId}`)).toHaveText('Manual');
    // the radar deep-links the band back to this exact processo in the Núcleo
    await expect(page.getByTestId(`prazo-processo-link-${ids.prazoId}`)).toHaveAttribute(
      'href',
      new RegExp(`/apps/legal-nucleo/processos/${ids.processoId}`),
    );
    assertClean('prazos radar');

    // ---------------------------------------------------------------------
    // 6) BELL — the in-spine notifications feed, driven on the Núcleo header.
    // ---------------------------------------------------------------------
    await page.goto(NUCLEO, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 20_000 });
    // record which OTHER notifications are currently unread — we must restore
    // exactly these after "marcar todas como lidas" flips them.
    ids.otherUnreadIds = await page.evaluate(async () => {
      const list = await (window as any).__ekoa.shared.list('notificacoes');
      return list.filter((n: any) => !n.lida).map((n: any) => n.id);
    });
    ids.notificacaoId = await page.evaluate(async (payload) => {
      const c = await (window as any).__ekoa.shared.create('notificacoes', payload);
      return (c && c.id) || null;
    }, {
      tipo: 'sistema',
      titulo: notifTitulo,
      corpo: `Notificação da suite E2E ${suffix}`,
      href: '/apps/legal-nucleo/',
      lida: false,
      data: new Date().toISOString(),
    });
    expect(ids.notificacaoId, 'notificação created').toBeTruthy();

    // reload so the bell (loaded once on mount) picks the new notification up
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('bell-badge')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('bell').click();
    const bellMenu = page.getByTestId('bell-menu');
    await expect(bellMenu).toBeVisible();
    // exact match — the notification body also contains the suffix, so a loose
    // substring match would resolve to both the title and the body span.
    await expect(bellMenu.getByText(notifTitulo, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Marcar todas como lidas' }).click();
    await expect(page.getByTestId('bell-badge')).toHaveCount(0, { timeout: 10_000 });
    assertClean('sino de notificações');

    // ---------------------------------------------------------------------
    // 7) DOSSIÊ cronologia — both the nota milestone and the prazo are merged
    //    into this processo's timeline (derived, never persisted as eventos).
    // ---------------------------------------------------------------------
    await page.goto(`${CORTEX}${dossieHref}?tab=cronologia`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('processo-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('cronologia-tab')).toBeVisible({ timeout: 15_000 });
    const timeline = page.getByTestId('cronologia-timeline');
    await expect(timeline).toBeVisible({ timeout: 15_000 });
    await expect(timeline.getByText(`Documento: ${notaTitle}`)).toBeVisible();
    await expect(timeline.getByText(`Prazo: ${prazoTitulo}`)).toBeVisible();
    assertClean('dossiê cronologia');
  } finally {
    await cleanup(page, ids);
  }
});
